import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  STOCKFISH_PATH: z.string().default('stockfish'),
  ENGINE_POOL_SIZE: z.coerce.number().int().min(1).max(16).default(2),
  ENGINE_MAX_QUEUE: z.coerce.number().int().min(0).max(200).default(20),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  BOT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  ANALYSIS_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(240),
  ANALYSIS_MAX_MS: z.coerce.number().int().min(100).max(30000).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
