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
  /** HS256 signing key for access tokens. Must be long and random in production (Render generates it). */
  JWT_SECRET: z.string().min(32).default('dev-only-insecure-secret-change-me-0123456789'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  MIGRATE_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Per-IP/minute limit for creating and joining online games. */
  ONLINE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  /** How often the server checks for timed-out / abandoned online games. */
  ONLINE_SWEEP_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  WS_RATE_PER_SECOND: z.coerce.number().int().min(1).max(1000).default(20),
  WS_AUTH_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.startsWith('dev-only-')) {
    throw new Error('Invalid environment: JWT_SECRET must be set to a real secret in production');
  }
  return parsed.data;
}
