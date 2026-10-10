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

// T136 (FR-076, NFR-SEC-11): the origins a browser may call the API from, as a comma-separated
// list of bare origins; empty or absent is none. A wildcard is refused here, in the schema itself,
// so no configuration can express one: `*`, or `*` inside an origin, which a URL parser accepts as
// a host. Checked before the origin check, so the refusal says why.
const allowedOrigins = z
  .string()
  .transform((value) => value.split(',').map((entry) => entry.trim()))
  .pipe(
    z.array(
      z
        .string()
        .refine((entry) => !entry.includes('*'), {
          error: 'a wildcard origin is refused; list each origin (NFR-SEC-11)',
          abort: true,
        })
        .pipe(origin),
    ),
  );

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

  // T150 (FR-077): the largest request body either tRPC surface reads; a larger one answers 413.
  // 1 MiB by default. Uploads keep their own limit (NFR-SEC-9).
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),

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

  // Selects the adapter behind the payment port (R-API-4). Real gateway names are added here by their
  // Phase 2 adapter task, together with the DB enum in T059. No default: a deployment must say which
  // gateway it runs (R-HONEST-1).
  PAYMENT_GATEWAY: z.enum(['fake']),
  PAYMENT_GATEWAY_API_KEY: nonEmpty.optional(),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: nonEmpty.optional(),

  // Select the adapter behind the video, push and messaging ports (T121, FR-056). Each has only its
  // stand-in until the phase that first calls the port adds its real member (FR-054), so each
  // defaults to it. A production refusal like PAYMENT_GATEWAY's is not made here (follow-up of T121).
  VIDEO_PROVIDER: z.enum(['fake']).default('fake'),
  PUSH_PROVIDER: z.enum(['fake']).default('fake'),
  SMS_PROVIDER: z.enum(['fake']).default('fake'),

  // Provider credentials are optional: the suite passes with every one unset (FR-054).
  DAILY_API_KEY: nonEmpty.optional(),
  DAILY_WEBHOOK_SECRET: nonEmpty.optional(),
  SMS_PROVIDER_KEY: nonEmpty.optional(),
  EXPO_ACCESS_TOKEN: nonEmpty.optional(),

  PUBLIC_WEBHOOK_ORIGIN: origin.optional(),

  ADMIN_ALLOWED_ORIGINS: allowedOrigins.default([]),

  SENTRY_DSN: httpUrl.optional(),
});

export const envKeys: readonly string[] = Object.keys(envObject.shape);

// T114 (PR #49 review m1): every key is classified once, here. A provider key is a third-party
// service's credential or location; a platform key is the process's own, its database and queue,
// and which adapter serves a port. `satisfies` makes `tsc` refuse a key of the schema left out, or
// one named that the schema does not have, so a new key cannot arrive unclassified. The test runs
// remove every provider key before any test file loads (`tests/support/no-provider-keys.setup.ts`),
// so the suite never sees one (SC-005).
const envKeyKinds = {
  NODE_ENV: 'platform',
  PORT: 'platform',
  LOG_LEVEL: 'platform',
  MAX_REQUEST_BODY_BYTES: 'platform',
  DATABASE_URL_OWNER: 'platform',
  DATABASE_URL: 'platform',
  REDIS_URL: 'platform',
  ENCRYPTION_KEY: 'platform',
  STORAGE_DRIVER: 'platform',
  STORAGE_LOCAL_ROOT: 'platform',
  S3_ENDPOINT: 'provider',
  S3_BUCKET: 'provider',
  S3_REGION: 'provider',
  S3_ACCESS_KEY_ID: 'provider',
  S3_SECRET_ACCESS_KEY: 'provider',
  PAYMENT_GATEWAY: 'platform',
  PAYMENT_GATEWAY_API_KEY: 'provider',
  PAYMENT_GATEWAY_WEBHOOK_SECRET: 'provider',
  VIDEO_PROVIDER: 'platform',
  PUSH_PROVIDER: 'platform',
  SMS_PROVIDER: 'platform',
  DAILY_API_KEY: 'provider',
  DAILY_WEBHOOK_SECRET: 'provider',
  SMS_PROVIDER_KEY: 'provider',
  EXPO_ACCESS_TOKEN: 'provider',
  PUBLIC_WEBHOOK_ORIGIN: 'provider',
  ADMIN_ALLOWED_ORIGINS: 'platform',
  SENTRY_DSN: 'provider',
} as const satisfies Record<keyof typeof envObject.shape, 'provider' | 'platform'>;

type EnvKey = keyof typeof envKeyKinds;

function keysOfKind(kind: 'provider' | 'platform'): readonly EnvKey[] {
  return (Object.keys(envKeyKinds) as EnvKey[]).filter((key) => envKeyKinds[key] === kind);
}

/** Credentials and locations of third-party services: what no test run may hold (SC-005). */
export const providerKeys: readonly EnvKey[] = keysOfKind('provider');

/** The platform's own values. */
export const platformKeys: readonly EnvKey[] = keysOfKind('platform');

// Total: object-level checks keep running after a failed URL check, so the input may be unparseable.
// Undefined means "cannot compare"; the base z.url() check already reports the malformed key.
function username(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined;
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return undefined;
  }
}

export const envSchema = envObject.superRefine((env, ctx) => {
  // The runtime never connects as the owner: a runtime URL copied from the owner line would silently
  // undo every revocation the role migration makes (research R-5). The message never echoes a value.
  const appUser = username(env.DATABASE_URL);
  const ownerUser =
    env.DATABASE_URL_OWNER === undefined ? undefined : username(env.DATABASE_URL_OWNER);
  if (
    env.DATABASE_URL_OWNER !== undefined &&
    (env.DATABASE_URL === env.DATABASE_URL_OWNER ||
      (appUser !== undefined && ownerUser !== undefined && appUser === ownerUser))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message:
        'must not use the owner role; runtime connects as the application role (research R-5)',
    });
  }

  // The stand-in confirms whatever it is told to, so a production deployment running it would take
  // bookings that nobody paid for (R-HONEST-1, T146). Refused here, not in the schema's enum: its
  // rows are real in development and tests (note under T059).
  if (env.NODE_ENV === 'production' && env.PAYMENT_GATEWAY === 'fake') {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_GATEWAY'],
      message: 'the stand-in gateway is refused in production (R-HONEST-1)',
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
