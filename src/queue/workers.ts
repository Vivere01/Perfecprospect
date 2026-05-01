import { Worker, Job } from 'bullmq';
import { QUEUE_NAME, redisConnection, CollectProfileData, AnalyzeProfileData, ExecuteInteractionData, prospectingQueue } from './index';
import { logger } from '../utils/logger';
import { runCollector } from '../collector';
import { runAnalyzer } from '../analyzer';
import { executeInteractionWorkflow } from '../executor';
import { prisma } from '../db';

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
  
  // Em um cenário real, precisaríamos raspar a bio do usuário aqui se já não tivermos
  // Vamos assumir que recebemos ou raspamos o dado básico.
  
  const result = await runAnalyzer({
    username: data.username,
    followersCount: 1500, // Mockado para exemplo
    bio: 'Barbearia Vivere - Experiência premium', // Mockado para exemplo
    persona: 'FRIENDLY' // Configuração de Persona por Conta
  });

  if (result.passed && result.message) {
    const lead = await prisma.lead.findUnique({ where: { username: data.username }});
    
    if (lead) {
      // Cria a Interação Pendente
      const interaction = await prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: 'DIRECT_MESSAGE',
          content: result.message,
          status: 'PENDING'
        }
      });

      // Enfileira a Execução (Com atraso aleatório brutal para segurança)
      await prospectingQueue.add('EXECUTE_INTERACTION', {
        interactionId: interaction.id,
        leadId: lead.id,
        username: data.username,
        message: result.message
      }, {
        delay: Math.floor(Math.random() * 3600000) // Manda a DM num intervalo de até 1 hora
      });
    }
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
    accountId: 'conta_barbearia_01' // Histórico/Sessão por conta
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
  const worker = new Worker(
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
        case 'EXECUTE_INTERACTION':
          await processExecuteInteraction(job.data as any);
          break;
        default:
          logger.warn(`Unknown job type: ${job.name}`);
      }
    },
    {
      connection: redisConnection,
      concurrency: 2, // Baixa concorrência = mais humano
      limiter: {
        max: 40,
        duration: 24 * 60 * 60 * 1000,
      }
    }
  );

  worker.on('error', (err) => {
    logger.error('Worker encountered an error:', err);
  });

  logger.info('Worker started and listening to queue');
  return worker;
};
