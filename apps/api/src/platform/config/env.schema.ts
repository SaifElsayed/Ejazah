// T015: declared configuration schema. Validated at startup by config.module.ts; on failure the process
// exits naming the value, before traffic (FR-039). Every key in .env.example is declared here and the
// spec asserts the two sets are equal, so neither can drift from the other.
import { Buffer } from 'node:buffer';
import { z } from 'zod';

const nonEmpty = z.string().min(1);
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });
const httpUrl = z.url({ protocol: /^https?$/ });

// 32 bytes, base64 (research R-8). Required in EVERY environment; there is no development bypass and no
// unencrypted code path (decided 2026-09-07). The message never echoes the value (R-SEC-2).
const encryptionKey = z
  .base64({ error: 'must be base64 (openssl rand -base64 32)' })
  .refine((value) => Buffer.from(value, 'base64').byteLength === 32, {
    error: 'must decode to exactly 32 bytes (openssl rand -base64 32)',
  });

// Scheme and host only, no path, no trailing slash: the value is joined to webhook routes.
// Checks keep running after the URL check fails, so the refine must not throw on garbage.
const origin = httpUrl.refine((value) => URL.canParse(value) && new URL(value).origin === value, {
  error: 'must be a bare origin: scheme and host, no path, no trailing slash',
});

const s3Keys = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

const envObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Two roles, two connection strings (research R-5). The owner URL is accepted so a copied .env parses,
  // but the runtime never carries it: config.module.ts strips it from the loaded configuration.
  DATABASE_URL_OWNER: postgresUrl.optional(),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,

  ENCRYPTION_KEY: encryptionKey,

  // Storage is the one port with two real implementations from day one (FR-055).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: nonEmpty.default('.storage'),
  S3_ENDPOINT: httpUrl.optional(),
  S3_BUCKET: nonEmpty.optional(),
  S3_REGION: nonEmpty.optional(),
  S3_ACCESS_KEY_ID: nonEmpty.optional(),
  S3_SECRET_ACCESS_KEY: nonEmpty.optional(),

  // Mirrors the PaymentGateway enum in prisma/schema/base.prisma; the real gateway (OPEN-11) is added
  // with its Phase 2 adapter. No default: a deployment must say which gateway it runs (R-HONEST-1).
  PAYMENT_GATEWAY: z.enum(['fake']),
  PAYMENT_GATEWAY_API_KEY: nonEmpty.optional(),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: nonEmpty.optional(),

  // Provider credentials are optional: the suite passes with every one unset (FR-054).
  DAILY_API_KEY: nonEmpty.optional(),
  DAILY_WEBHOOK_SECRET: nonEmpty.optional(),
  SMS_PROVIDER_KEY: nonEmpty.optional(),
  EXPO_ACCESS_TOKEN: nonEmpty.optional(),

  PUBLIC_WEBHOOK_ORIGIN: origin.optional(),

  SENTRY_DSN: httpUrl.optional(),
});

export const envKeys: readonly string[] = Object.keys(envObject.shape);

// Both values already passed the URL check, so `new URL` cannot throw here.
function username(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

export const envSchema = envObject.superRefine((env, ctx) => {
  // The runtime never connects as the owner: a runtime URL copied from the owner line would silently
  // undo every revocation the role migration makes (research R-5). The message never echoes a value.
  if (
    env.DATABASE_URL_OWNER !== undefined &&
    (env.DATABASE_URL === env.DATABASE_URL_OWNER ||
      username(env.DATABASE_URL) === username(env.DATABASE_URL_OWNER))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message:
        'must not use the owner role; runtime connects as the application role (research R-5)',
    });
  }

  if (env.STORAGE_DRIVER !== 's3') return;
  for (const key of s3Keys) {
    if (env[key] === undefined) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=s3' });
    }
  }
});

export type Env = z.infer<typeof envSchema>;
