// T015: declared configuration schema. Validated at startup by config.module.ts; on failure the process
// exits naming the value, before traffic (FR-039). Every key in .env.example is declared here and the
// spec asserts the two sets are equal, so neither can drift from the other.
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { columnKeyId } from '../crypto/encryption.js';

const nonEmpty = z.string().min(1);
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });
const httpUrl = z.url({ protocol: /^https?$/ });

// T001 (Phase 1): one email address, as `SUPPORT_EMAIL` (FR-145) and `EMAIL_FROM` (contracts/ports.md)
// each are. The message never echoes the value (R-SEC-2).
const emailAddress = z.email({ error: 'must be one email address' });

// T001 (contracts/kernel.md, "Session resolution"): the one proxy header whose LAST hop, the one the
// single trusted proxy appended, is the client address; the first hop is written by the client
// itself. A header name and nothing else; set only when exactly one proxy stands in front of the
// API. Absent before launch (research R-18 left the host open), so the socket's peer is used.
const headerName = z
  .string()
  .regex(/^[A-Za-z0-9-]+$/, { error: 'must be one HTTP header name, such as X-Forwarded-For' });

// T001 (contracts/ports.md): the audiences a Google identity token may name, comma-separated.
const googleClientIds = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  )
  .pipe(z.array(nonEmpty).min(1, { error: 'must list at least one client id' }));

// 32 bytes, base64 (research R-8). Required in EVERY environment; there is no development bypass and no
// unencrypted code path (decided 2026-09-07). The message never echoes the value (R-SEC-2).
const encryptionKey = z
  .base64({ error: 'must be base64 (openssl rand -base64 32)' })
  .refine((value) => Buffer.from(value, 'base64').byteLength === 32, {
    error: 'must decode to exactly 32 bytes (openssl rand -base64 32)',
  });

// T056: a gateway's integration id, a positive whole number as its dashboard shows it.
const integrationId = z.coerce
  .number()
  .int({ error: 'must be a whole number' })
  .positive({ error: 'must be a positive whole number' });

// T056 (R-HONEST-1): the keys the gateway selected by `PAYMENT_GATEWAY=paymob` cannot start without.
const paymobKeys = [
  'PAYMENT_GATEWAY_SECRET_KEY',
  'PAYMENT_GATEWAY_PUBLIC_KEY',
  'PAYMENT_GATEWAY_WEBHOOK_SECRET',
  'PAYMENT_GATEWAY_INTEGRATION_ID',
  'PUBLIC_WEBHOOK_ORIGIN',
] as const;

// T056: what marks a live key from the gateway's dashboard (`sk_live`, `pk_live`, under a region's
// prefix such as `egy_`). 003:T109: in live mode a key must carry it (the rule is "live", so a key of
// a shape nobody named is refused as a test key is), and in test mode no key may.
const paymobLiveMarks = {
  PAYMENT_GATEWAY_SECRET_KEY: 'sk_live',
  PAYMENT_GATEWAY_PUBLIC_KEY: 'pk_live',
} as const;

function isEncryptionKey(value: unknown): value is string {
  return encryptionKey.safeParse(value).success;
}

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

// T001 adds the sign-in port's and the email port's selectors (contracts/ports.md): each has only its
// stand-in until the live adapter's task adds it, and each is refused outside development and test
// as the three Phase 0 ones are. T009 adds LiveKit to `VIDEO_PROVIDER`; its stand-in stays refused.
const standInProviderKeys = [
  'VIDEO_PROVIDER',
  'PUSH_PROVIDER',
  'SMS_PROVIDER',
  'SIGN_IN_PROVIDER',
  'EMAIL_PROVIDER',
] as const;

// T009 (research R-302): the keys the provider selected by `VIDEO_PROVIDER=livekit` cannot start
// without. The secret signs the tokens and verifies the webhooks; LiveKit has no other.
const livekitKeys = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;

// T009: the LiveKit project's address, which `sessions.join` hands the app (R-302): `wss://` only.
const livekitUrl = z.url({
  protocol: /^wss$/,
  error: "must be the LiveKit project's wss:// address",
});

const s3Keys = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/** The two modes in which a stand-in adapter may run (T168, review finding SEC-1). */
const standInModes: readonly string[] = ['development', 'test'];

// T023 (B5's watch line; PR #75 review, follow-up 3): the reserved domains an address may carry in
// development and test only, as `.env.example` spells them. Outside those modes an address under
// one is refused as a stand-in is: a copied example would otherwise show the placeholder on four
// screens and send from it. RFC 2606 and RFC 6761 name them.
const reservedTopLevelDomains = /\.(invalid|test|example|localhost)$/;
const reservedExampleDomains = /(^|\.)example\.(com|net|org)$/;
const addressKeys = ['SUPPORT_EMAIL', 'EMAIL_FROM'] as const;

/** Whether `address` is under a reserved domain. */
function isReservedAddress(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  return reservedTopLevelDomains.test(domain) || reservedExampleDomains.test(domain);
}

const envObject = z.object({
  // T168: no default. A configuration copied onto a server without it used to run as development,
  // where every stand-in is accepted; now it is refused naming the key (FR-039, R-HONEST-1).
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // T150 (FR-077): the largest request body either tRPC surface reads; a larger one answers 413.
  // 1 MiB by default. Uploads keep their own limit (NFR-SEC-9).
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),

  // Two roles, two connection strings (research R-5). The owner URL is accepted so a copied .env parses,
  // but the runtime never carries it: config.module.ts strips it from the loaded configuration.
  DATABASE_URL_OWNER: postgresUrl.optional(),
  DATABASE_URL: postgresUrl,
  // T172 (R-DB-8, review finding SC-5): the pool's size and the two session timeouts every
  // connection of the process carries, so no statement runs and no transaction idles without a
  // limit. Milliseconds, as pg sends them to the server.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  REDIS_URL: redisUrl,

  // T171 (FR-052): how many queue deliveries the worker runs at once; four unless set.
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(4),

  ENCRYPTION_KEY: encryptionKey,
  // T155: the key ENCRYPTION_KEY replaced, set only while a rotation runs. Values written under it
  // stay readable until the `reencrypt-columns` job has written each again under ENCRYPTION_KEY;
  // then it is removed (docs/RUNBOOK.md, "Leaked credential").
  ENCRYPTION_KEY_PREVIOUS: encryptionKey.optional(),

  // Storage is the one port with two real implementations from day one (FR-055).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: nonEmpty.default('.storage'),
  // T095: the API's own origin, which local storage's links start with so a contract's `z.url()`
  // takes them and the panel can fetch them. Unset, a local link stays relative.
  API_PUBLIC_ORIGIN: origin.optional(),
  S3_ENDPOINT: httpUrl.optional(),
  S3_BUCKET: nonEmpty.optional(),
  S3_REGION: nonEmpty.optional(),
  S3_ACCESS_KEY_ID: nonEmpty.optional(),
  S3_SECRET_ACCESS_KEY: nonEmpty.optional(),

  // Selects the adapter behind the payment port (R-API-4). Real gateway names are added here by their
  // Phase 2 adapter task, together with the DB enum in T059. No default: a deployment must say which
  // gateway it runs (R-HONEST-1). T056 adds Paymob (FR-371, R-221): its secret key authorises the
  // calls, its public key opens the hosted checkout, the webhook secret is its HMAC secret, and the
  // integration ids name the card integration and, for the split, the auth integration.
  PAYMENT_GATEWAY: z.enum(['fake', 'paymob']),
  // 003:T109 (SRS DEC-87, ADR 0025 D7): the payment mode, required, no default, an environment value
  // the owner sets. `test` takes only the gateway's test keys (and the stand-in) and every app shows
  // «نسخة تجريبية»; `live` takes only live keys and the split integration, and every checkout names
  // a payee (T101). Flipping to `live` during the closed test needs no code change.
  PAYMENT_MODE: z.enum(['test', 'live']),
  PAYMENT_GATEWAY_API_KEY: nonEmpty.optional(),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: nonEmpty.optional(),
  PAYMENT_GATEWAY_SECRET_KEY: nonEmpty.optional(),
  PAYMENT_GATEWAY_PUBLIC_KEY: nonEmpty.optional(),
  PAYMENT_GATEWAY_INTEGRATION_ID: integrationId.optional(),
  PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID: integrationId.optional(),

  // Select the adapter behind the video, push and messaging ports (T121, FR-056). Each has only its
  // stand-in until the phase that first calls the port adds its real member (FR-054), so each
  // defaults to it. Every mode but development and test refuses each stand-in below, as it refuses
  // PAYMENT_GATEWAY's (T153, T168). T009 adds LiveKit to the video port (research R-302). T005 of
  // specs/005-certification adds Expo's push service to the push port (R-405); EXPO_ACCESS_TOKEN
  // stays optional, sent only when the project turns it on.
  VIDEO_PROVIDER: z.enum(['fake', 'livekit']).default('fake'),
  PUSH_PROVIDER: z.enum(['fake', 'expo']).default('fake'),
  SMS_PROVIDER: z.enum(['fake']).default('fake'),

  // T001 (Phase 1, contracts/ports.md): the sign-in port and the email port, `fake` the only member
  // of each until the live adapter's task adds it. `EMAIL_FROM` is the sender the stand-in records: a
  // reserved address by default (RFC 2606); the live sender arrives with the provider chosen at launch.
  // 002:T148 (B50): `live` verifies Google's token against Google's published keys, and requires
  // GOOGLE_CLIENT_IDS; Apple waits for iOS (Q-T4 (a)).
  SIGN_IN_PROVIDER: z.enum(['fake', 'live']).default('fake'),
  EMAIL_PROVIDER: z.enum(['fake']).default('fake'),
  EMAIL_FROM: emailAddress.default('no-reply@ijazah.invalid'),

  // T001 (FR-145, ADR 0021 D4): the support address four screens show, served by the public
  // configuration query. Required in every mode, a valid address, no default, never an admin setting.
  SUPPORT_EMAIL: emailAddress,

  // T001 (contracts/kernel.md): the one proxy header the contexts read the client address from, by
  // its last hop; optional, absent before launch.
  TRUSTED_PROXY: headerName.optional(),

  // Provider credentials are optional: the suite passes with every one unset (FR-054).
  // T009: LiveKit's, read only while VIDEO_PROVIDER is `livekit` (ADR 0003, the Daily rename).
  LIVEKIT_URL: livekitUrl.optional(),
  LIVEKIT_API_KEY: nonEmpty.optional(),
  LIVEKIT_API_SECRET: nonEmpty.optional(),
  SMS_PROVIDER_KEY: nonEmpty.optional(),
  EXPO_ACCESS_TOKEN: nonEmpty.optional(),

  // T008 of specs/005-certification (R-401): the Typst CLI's path, pinned at 0.15.1, which the
  // worker's `render-certificate` job runs. Optional: a missing binary fails the job into its
  // retries, never a request, and the API process never reads it.
  TYPST_BIN: nonEmpty.optional(),

  // T001 (contracts/ports.md): the live sign-in adapter's credentials, each optional and stripped
  // from every test run; nothing reads them while SIGN_IN_PROVIDER is `fake`. 002:T148: `live`
  // requires GOOGLE_CLIENT_IDS (below); no code reads the Apple keys until iOS (Q-T4 (a)).
  GOOGLE_CLIENT_IDS: googleClientIds.optional(),
  APPLE_CLIENT_ID: nonEmpty.optional(),
  APPLE_TEAM_ID: nonEmpty.optional(),
  APPLE_KEY_ID: nonEmpty.optional(),
  APPLE_PRIVATE_KEY: nonEmpty.optional(),

  PUBLIC_WEBHOOK_ORIGIN: origin.optional(),

  ADMIN_ALLOWED_ORIGINS: allowedOrigins.default([]),

  // T066 (research R-110): the Admin panel's own origin, where an invited administrator's password-set
  // link points. Unset, the invite job fails each delivery, visibly, rather than mail a dead link.
  ADMIN_PANEL_ORIGIN: origin.optional(),

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
  DATABASE_POOL_MAX: 'platform',
  DATABASE_STATEMENT_TIMEOUT_MS: 'platform',
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: 'platform',
  REDIS_URL: 'platform',
  QUEUE_CONCURRENCY: 'platform',
  ENCRYPTION_KEY: 'platform',
  ENCRYPTION_KEY_PREVIOUS: 'platform',
  STORAGE_DRIVER: 'platform',
  STORAGE_LOCAL_ROOT: 'platform',
  API_PUBLIC_ORIGIN: 'platform',
  S3_ENDPOINT: 'provider',
  S3_BUCKET: 'provider',
  S3_REGION: 'provider',
  S3_ACCESS_KEY_ID: 'provider',
  S3_SECRET_ACCESS_KEY: 'provider',
  PAYMENT_GATEWAY: 'platform',
  // 003:T109: the owner's environment value, as the gateway's selection is.
  PAYMENT_MODE: 'platform',
  PAYMENT_GATEWAY_API_KEY: 'provider',
  PAYMENT_GATEWAY_WEBHOOK_SECRET: 'provider',
  PAYMENT_GATEWAY_SECRET_KEY: 'provider',
  PAYMENT_GATEWAY_PUBLIC_KEY: 'provider',
  PAYMENT_GATEWAY_INTEGRATION_ID: 'provider',
  PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID: 'provider',
  VIDEO_PROVIDER: 'platform',
  PUSH_PROVIDER: 'platform',
  SMS_PROVIDER: 'platform',
  SIGN_IN_PROVIDER: 'platform',
  EMAIL_PROVIDER: 'platform',
  EMAIL_FROM: 'platform',
  SUPPORT_EMAIL: 'platform',
  TRUSTED_PROXY: 'platform',
  LIVEKIT_URL: 'provider',
  LIVEKIT_API_KEY: 'provider',
  LIVEKIT_API_SECRET: 'provider',
  SMS_PROVIDER_KEY: 'provider',
  EXPO_ACCESS_TOKEN: 'provider',
  // 005:T008: a path on the worker's own machine, no third party's: the template spec reads it in CI.
  TYPST_BIN: 'platform',
  GOOGLE_CLIENT_IDS: 'provider',
  APPLE_CLIENT_ID: 'provider',
  APPLE_TEAM_ID: 'provider',
  APPLE_KEY_ID: 'provider',
  APPLE_PRIVATE_KEY: 'provider',
  PUBLIC_WEBHOOK_ORIGIN: 'provider',
  ADMIN_ALLOWED_ORIGINS: 'platform',
  ADMIN_PANEL_ORIGIN: 'platform',
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

  // A stored value names its key by a one-byte id (T155), so the previous key must not share the
  // current key's. Compared only when both keys are well formed; the key check reports the rest.
  if (
    env.ENCRYPTION_KEY_PREVIOUS !== undefined &&
    isEncryptionKey(env.ENCRYPTION_KEY) &&
    isEncryptionKey(env.ENCRYPTION_KEY_PREVIOUS) &&
    columnKeyId(env.ENCRYPTION_KEY) === columnKeyId(env.ENCRYPTION_KEY_PREVIOUS)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['ENCRYPTION_KEY_PREVIOUS'],
      message:
        'has the same key id as ENCRYPTION_KEY; generate another ENCRYPTION_KEY (openssl rand -base64 32)',
    });
  }

  // The stand-in confirms whatever it is told to, so a deployment running it would take bookings
  // that nobody paid for (R-HONEST-1, T146). Refused here, not in the schema's enum: its rows are
  // real in development and tests (note under T059). The test is "not development or test", never
  // "is production" (T168): a mode added later is refused until it is named as one of the two.
  const standInsAllowed = standInModes.includes(env.NODE_ENV);
  if (!standInsAllowed && env.PAYMENT_GATEWAY === 'fake') {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_GATEWAY'],
      message: 'the stand-in gateway is refused outside development and test (R-HONEST-1)',
    });
  }

  // 003:T109 (SRS DEC-87): the stand-in confirms whatever it is told to, so it is never live.
  if (env.PAYMENT_GATEWAY === 'fake' && env.PAYMENT_MODE === 'live') {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_MODE'],
      message: 'live mode is refused on the stand-in gateway (R-HONEST-1, T109)',
    });
  }

  // T056: Paymob cannot start without its keys and the origin its events are sent to. The key is
  // named, never its value (R-SEC-2).
  //
  // 003:T109 (SRS DEC-87, ADR 0025 D7) replaces PR #125's refusal of Paymob outside development and
  // test, and T056's refusal of its test keys there: the payment mode decides, in every NODE_ENV, so
  // the hosted closed test runs the gateway's test keys. Test mode takes no live key, so no real
  // payment is taken while every app says «نسخة تجريبية»; live mode takes only live keys, and the
  // split integration that sends the teacher's share (T104), so no payment settles whole into the
  // platform's own account (R-MONEY-6). The rule is "live" in live mode, never "not test": a key of a
  // shape nobody named is refused there as a test key is.
  if (env.PAYMENT_GATEWAY === 'paymob') {
    for (const key of paymobKeys) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'required when PAYMENT_GATEWAY=paymob (T056)',
        });
      }
    }
    for (const [key, mark] of Object.entries(paymobLiveMarks) as [
      keyof typeof paymobLiveMarks,
      string,
    ][]) {
      const value = env[key];
      if (value === undefined) continue;
      if (env.PAYMENT_MODE === 'test' && value.includes(mark)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `a live key is refused in test mode; set PAYMENT_MODE=live to take it (T109)`,
        });
      }
      if (env.PAYMENT_MODE === 'live' && !value.includes(mark)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `live mode takes only a live key, which carries ${mark} (R-HONEST-1, T109)`,
        });
      }
    }
    if (env.PAYMENT_MODE === 'live' && env.PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_GATEWAY_SPLIT_INTEGRATION_ID'],
        message:
          "required in live mode: the split sends the teacher's share to the teacher (R-MONEY-6, T104, T109)",
      });
    }
  }

  // 002:T148 (B50): the live sign-in adapter accepts a Google token only for an audience it is
  // given, so it cannot start without one. The key is named, never its value (R-SEC-2).
  if (env.SIGN_IN_PROVIDER === 'live' && env.GOOGLE_CLIENT_IDS === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['GOOGLE_CLIENT_IDS'],
      message: 'required when SIGN_IN_PROVIDER=live (002:T148)',
    });
  }

  // T009: LiveKit cannot start without its address, its key and its secret. The key is named, never
  // its value (R-SEC-2).
  if (env.VIDEO_PROVIDER === 'livekit') {
    for (const key of livekitKeys) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'required when VIDEO_PROVIDER=livekit (T009)',
        });
      }
    }
  }

  // The same for the video, push and messaging stand-ins (T153, FR-056): each answers without
  // reaching anyone, so a deployment would hold no lesson, send no notification and deliver no
  // one-time code while reporting success. Each is refused on its own key.
  if (!standInsAllowed) {
    for (const key of standInProviderKeys) {
      if (env[key] === 'fake') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'the stand-in is refused outside development and test (FR-056)',
        });
      }
    }
  }

  // T023: a reserved address is for development and test only; the key is named, never the value.
  if (!standInsAllowed) {
    for (const key of addressKeys) {
      if (isReservedAddress(env[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'is under a reserved domain, refused outside development and test (T023)',
        });
      }
    }
  }

  if (env.STORAGE_DRIVER !== 's3') return;
  for (const key of s3Keys) {
    if (env[key] === undefined) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=s3' });
    }
  }
});

export type Env = z.infer<typeof envSchema>;
