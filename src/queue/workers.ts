import { Worker, Job } from 'bullmq';
import { QUEUE_NAME, INTERACTION_QUEUE_NAME, redisConnection, CollectProfileData, AnalyzeProfileData, ExecuteInteractionData, prospectingQueue, interactionQueue } from './index';
import { logger } from '../utils/logger';
import { runCollector } from '../collector';
import { runAnalyzer } from '../analyzer';
import { executeInteractionWorkflow } from '../executor';
import { prisma } from '../db';
import { fetchProfileInfo } from '../collector/profileFetcher';
import { triggerCollection, flushPendingDMs } from '../index';
import { getBrowserSession } from '../config/browser';
import { discoverSimilarAccounts } from '../executor/actions';

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
      delay: Math.floor(Math.random() * 5000) // espalha a análise em até 5s
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

  if (result.passed && result.message) {
    const lead = await prisma.lead.findFirst({
      where: { username: data.username },
      orderBy: { createdAt: 'desc' },
    });
    
    if (!lead) {
      logger.warn(`[WORKER] Lead @${data.username} aprovado mas não encontrado no BD. Ignorando.`);
      return;
    }

    const existingInteraction = await prisma.interaction.findFirst({
      where: { leadId: lead.id, type: 'DIRECT_MESSAGE' }
    });
    if (existingInteraction) {
      logger.info(`[WORKER] @${data.username} já tem DM registrada (${existingInteraction.status}). Pulando.`);
      return;
    }

    const interaction = await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'DIRECT_MESSAGE',
        content: result.message,
        status: 'PENDING'
      }
    });

    await interactionQueue.add('EXECUTE_INTERACTION', {
      interactionId: interaction.id,
      leadId: lead.id,
      username: data.username,
      message: result.message
    }, {
      delay: Math.floor(Math.random() * 60000)
    });

    logger.info(`[WORKER] ✅ DM enfileirada para @${data.username}`);
  } else {
    logger.info(`[WORKER] @${data.username} não passou na análise. Sem DM.`);
  }
};

const processDiscoverReferences = async (data: { profileUrl: string }) => {
  logger.info(`[WORKER] AI Discovering new references from: ${data.profileUrl}`);
  const { page, close } = await getBrowserSession();

  try {
    await page.goto(data.profileUrl, { waitUntil: 'domcontentloaded' });
    const usernames = await discoverSimilarAccounts(page);
    
    for (const username of usernames.slice(0, 5)) {
      const exists = await prisma.referenceProfile.findUnique({ where: { username } });
      if (exists) continue;

      const info = await fetchProfileInfo(username);
      if (!info) continue;

      const bioLower = (info.bio || '').toLowerCase();
      const isRelevant = bioLower.includes('barber') || bioLower.includes('barbearia') || bioLower.includes('corte');

      if (isRelevant) {
        await prisma.referenceProfile.create({
          data: {
            username,
            url: `https://www.instagram.com/${username}/`,
            type: 'AI_DISCOVERED'
          }
        });
        logger.info(`[WORKER] ✨ Novo perfil de referência descoberto pela IA: @${username}`);
      }
    }
  } catch (error) {
    logger.error(`[WORKER] Erro na descoberta de referências:`, error);
  } finally {
    await close();
  }
};

const processExecuteInteraction = async (data: ExecuteInteractionData & { username: string, message: string }) => {
  logger.info(`[WORKER] Executing interaction for lead: @${data.username}`);
  
  await prisma.interaction.update({
    where: { id: data.interactionId },
    data: { status: 'PROCESSING' }
  });

  const execResult = await executeInteractionWorkflow({
    username: data.username,
    message: data.message,
    accountId: 'default'
  });

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
        case 'DAILY_SEED':
          logger.info('[CRON] ⏰ Job DAILY_SEED disparado! Iniciando coleta...');
          await triggerCollection(job.data.competitors);
          break;
        case 'DAILY_DM_FLUSH':
          logger.info('[CRON] ⏰ Job DAILY_DM_FLUSH disparado! Processando DMs pendentes...');
          await flushPendingDMs();
          break;
        case 'DISCOVER_REFERENCES':
          await processDiscoverReferences(job.data as { profileUrl: string });
          break;
        default:
          logger.warn(`[WORKER] Job desconhecido: ${job.name}`);
      }
    },
    { connection: redisConnection, concurrency: 1 }
  );

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
      concurrency: 1,
      limiter: {
        max: 40,
        duration: 24 * 60 * 60 * 1000,
      }
    }
  );

  prospectingWorker.on('error', (err) => logger.error('Prospecting Worker error:', err));
  interactionWorker.on('error', (err) => logger.error('Interaction Worker error:', err));

  logger.info('Workers started: Prospecting (Unlimited) & Interaction (Max 40/day)');
  return { prospectingWorker, interactionWorker };
};
