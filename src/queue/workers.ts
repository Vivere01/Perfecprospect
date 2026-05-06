import { Worker, Job } from 'bullmq';
import { QUEUE_NAME, INTERACTION_QUEUE_NAME, redisConnection, CollectProfileData, AnalyzeProfileData, ExecuteInteractionData, prospectingQueue, interactionQueue } from './index';
import { logger } from '../utils/logger';
import { runCollector } from '../collector';
import { runAnalyzer } from '../analyzer';
import { executeInteractionWorkflow } from '../executor';
import { prisma } from '../db';
import { fetchProfileInfo } from '../collector/profileFetcher';
import { triggerCollection, flushPendingDMs } from '../index';

/**
 * WORKER REAL: Integra todos os módulos com as filas
 */

const processCollectProfile = async (data: CollectProfileData) => {
  logger.info(`[WORKER] Collecting profile based on: ${data.source} from ${data.target || data.postUrl}`);
  
  const extractedUsernames = await runCollector({
    sourceUrl: data.postUrl || `https://www.instagram.com/${data.target}/`,
    mode: data.source === 'likes' ? 'LIKERS' : 'FOLLOWERS',
    maxLeads: 20
  });

  // Enfileira a análise para cada username extraído
  for (const username of extractedUsernames) {
    await prospectingQueue.add('ANALYZE_PROFILE', {
      username,
    }, {
      delay: Math.floor(Math.random() * 60000) // espalha a análise em até 60s
    });
  }
};

const processAnalyzeProfile = async (data: AnalyzeProfileData) => {
  logger.info(`[WORKER] Analyzing profile: ${data.username}`);
  
  const profile = await fetchProfileInfo(data.username);
  if (!profile) {
    logger.warn(`[WORKER] Could not fetch profile info for @${data.username}. Skipping.`);
    return;
  }

  const result = await runAnalyzer({
    username: profile.username,
    fullName: profile.fullName,
    bio: profile.bio,
    followersCount: profile.followersCount,
    profileUrl: profile.profileUrl,
    isPrivate: profile.isPrivate,
    persona: 'FRIENDLY'
  });

  // FIX: Busca o lead usando findFirst para garantir que temos o registro
  // criado pelo analyzer (evita condição de corrida com findUnique)
  if (result.passed && result.message) {
    const lead = await prisma.lead.findFirst({
      where: { username: data.username },
      orderBy: { createdAt: 'desc' },
    });
    
    if (!lead) {
      logger.warn(`[WORKER] Lead @${data.username} aprovado mas não encontrado no BD. Ignorando.`);
      return;
    }

    // Verifica se já existe interação para evitar DM duplicada
    const existingInteraction = await prisma.interaction.findFirst({
      where: { leadId: lead.id, type: 'DIRECT_MESSAGE' }
    });
    if (existingInteraction) {
      logger.info(`[WORKER] @${data.username} já tem DM registrada (${existingInteraction.status}). Pulando.`);
      return;
    }

    // Cria a Interação Pendente
    const interaction = await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'DIRECT_MESSAGE',
        content: result.message,
        status: 'PENDING'
      }
    });

    // Enfileira na fila DEDICADA para mensagens (com atraso aleatório humanizado)
    await interactionQueue.add('EXECUTE_INTERACTION', {
      interactionId: interaction.id,
      leadId: lead.id,
      username: data.username,
      message: result.message
    }, {
      delay: Math.floor(Math.random() * 1800000) // spread de até 30min
    });

    logger.info(`[WORKER] ✅ DM enfileirada para @${data.username}`);
  } else {
    logger.info(`[WORKER] @${data.username} não passou na análise. Sem DM.`);
  }
};

const processExecuteInteraction = async (data: ExecuteInteractionData & { username: string, message: string }) => {
  logger.info(`[WORKER] Executing interaction for lead: @${data.username}`);
  
  // Atualiza BD para PROCESSING
  await prisma.interaction.update({
    where: { id: data.interactionId },
    data: { status: 'PROCESSING' }
  });

  const execResult = await executeInteractionWorkflow({
    username: data.username,
    message: data.message,
    accountId: 'default' // Usar a mesma sessão 'default' que foi logada
  });

  // Atualiza BD com o resultado final
  await prisma.interaction.update({
    where: { id: data.interactionId },
    data: { 
      status: execResult.success ? 'COMPLETED' : 'FAILED',
      errorMessage: execResult.reason,
      executedAt: new Date()
    }
  });

  if (execResult.success) {
    await prisma.lead.update({
      where: { id: data.leadId },
      data: { status: 'CONTACTED' }
    });
  }
};

export const startWorker = () => {
  // WORKER DE COLETA/ANÁLISE + handlers dos CRONs diários
  const prospectingWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      logger.info(`Processing job ${job.id} of type ${job.name}`);
      switch (job.name) {
        case 'COLLECT_PROFILE':
          await processCollectProfile(job.data as CollectProfileData);
          break;
        case 'ANALYZE_PROFILE':
          await processAnalyzeProfile(job.data as AnalyzeProfileData);
          break;

        // ─── Jobs do CRON diário ──────────────────────────────────────
        case 'DAILY_SEED':
          logger.info('[CRON] ⏰ Job DAILY_SEED disparado! Iniciando coleta...');
          await triggerCollection(job.data.competitors);
          break;

        case 'DAILY_DM_FLUSH':
          logger.info('[CRON] ⏰ Job DAILY_DM_FLUSH disparado! Processando DMs pendentes...');
          await flushPendingDMs();
          break;

        default:
          logger.warn(`[WORKER] Job desconhecido: ${job.name}`);
      }
    },
    { connection: redisConnection, concurrency: 1 }
  );

  // WORKER DE MENSAGENS (Limite Exato: 40 DMs por dia!)
  const interactionWorker = new Worker(
    INTERACTION_QUEUE_NAME,
    async (job: Job) => {
      logger.info(`Processing INTERACTION job ${job.id}`);
      if (job.name === 'EXECUTE_INTERACTION') {
        await processExecuteInteraction(job.data as any);
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Manda uma mensagem por vez
      limiter: {
        max: 40,
        duration: 24 * 60 * 60 * 1000, // 24 horas
      }
    }
  );

  prospectingWorker.on('error', (err) => logger.error('Prospecting Worker error:', err));
  interactionWorker.on('error', (err) => logger.error('Interaction Worker error:', err));

  logger.info('Workers started: Prospecting (Unlimited) & Interaction (Max 40/day)');
  return { prospectingWorker, interactionWorker };
};
