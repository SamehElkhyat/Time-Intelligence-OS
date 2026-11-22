import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment loading and validation. The process refuses to start with an
 * invalid configuration instead of failing later at an arbitrary call site.
 */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const bool = z.preprocess((v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v), z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SESSION_IDLE_TIMEOUT_HOURS: z.coerce.number().int().min(1).default(168),
  /** Default per-address request budget per minute. Credential endpoints have their own, much stricter limits. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(600),
  COOKIE_SECURE: bool.default(false),
  /** Escape hatch for running the production build over plain http://localhost (docker compose demo). Never set it on a real deployment. */
  ALLOW_INSECURE_COOKIES: bool.default(false),
  /**
   * SameSite policy of the session cookie. `lax` suits the default same-origin /api setup. `none` is only for a
   * deployment where the browser calls the API on a different site, and browsers reject it unless COOKIE_SECURE=true.
   */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(1).default(40),
  // The model's reasoning counts toward this limit, so keep it generous.
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(16000).default(4096),
  AI_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  OTEL_SERVICE_NAME: z.string().default('timeflow-backend'),
  SWAGGER_ENABLED: bool.default(true),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const envFile = resolve(process.cwd(), '.env');
  // Real environment variables always win over the .env file.
  if (existsSync(envFile) && process.env.NODE_ENV !== 'test') {
    const before = { ...process.env };
    process.loadEnvFile(envFile);
    Object.assign(process.env, before);
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE && !parsed.data.ALLOW_INSECURE_COOKIES) {
    throw new Error('COOKIE_SECURE must be true in production (set ALLOW_INSECURE_COOKIES=true only for a local http://localhost demo)');
  }
  if (parsed.data.COOKIE_SAMESITE === 'none' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true: browsers discard a SameSite=None cookie that is not Secure, so nobody could sign in');
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached configuration. */
export function resetEnvCache(): void {
  cached = undefined;
}
