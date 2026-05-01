import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Reusable Redis Connection
export const redisConnection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
});

export const QUEUE_NAME = 'prospecting_queue';

// The Queue instance
export const prospectingQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s -> 10s -> 20s
    },
    removeOnComplete: 100, // keep last 100 successful jobs
    removeOnFail: 500,     // keep last 500 failed jobs
  },
});

export const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redisConnection });

queueEvents.on('completed', ({ jobId }) => {
  logger.info(`Job ${jobId} completed successfully`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`Job ${jobId} failed`, { failedReason });
});

export type JobTypes = 
  | 'COLLECT_PROFILE'
  | 'ANALYZE_PROFILE'
  | 'EXECUTE_INTERACTION';

export interface CollectProfileData {
  source: 'followers' | 'likes';
  target?: string;
  postUrl?: string;
}

export interface AnalyzeProfileData {
  leadId: string;
  username: string;
}

export interface ExecuteInteractionData {
  interactionId: string;
  leadId: string;
}
