import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(), // Mantido para embeddings se necessário
  DEEPSEEK_API_KEY: z.string(), // Nova chave para o DeepSeek V4
  INSTAGRAM_USERNAME: z.string(),
  INSTAGRAM_PASSWORD: z.string(),
  BROWSER_HEADLESS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
