// T103: rate limiting (FR-043, FR-034, R-SEC-6, NFR-SEC-10; contracts/kernel.md "Guards applied
// by default"). Available to any endpoint, and named by default for the four paths the SRS lists:
// authentication, one-time-code issuance, search and payment initiation.
//
// EVERY LIMIT IS A SETTING, read through the kernel's `SettingsReader` (T113) on every check and
// never held as a constant (R-MONEY-12). A limit is a `settings` row whose value is
// `{ "limit": <positive int>, "window_seconds": <positive int> }`; the default rows are planted by
// the seed (T074, the owner's decision of 2026-10-10). A missing or invalid row throws
// `SettingError` before anything is counted, which the error filter answers as the internal error:
// the call fails closed, it is never let through unlimited.
//
// HOW AN ENDPOINT IS LIMITED (T170, review findings SEC-2 and SEC-8). A limit is declared on the
// caller kind, never applied by hand: `publicProcedure({ input, output, rateLimit: { key,
// subjectOf, budget? } })`, required on the public kind (an anonymous endpoint without one does
// not compile) and accepted by the student and teacher kinds. The kind applies `throttle` after
// input validation, from the limiter the request context carries (`surfaces/context.ts`, handed
// in by the HTTP application from `main.ts`), and stamps the key in the procedure's meta. The four
// default keys and the two budgets are `defaultRateLimits`; any other endpoint declares a
// `rate_limit_*` key of its own, planted as a setting by the task that adds it. An endpoint that
// declares nothing is not counted at all. The limiter is one per process, built in `main.ts`.
//
// A BUDGET is a second key the declaration may name, counted under the one constant subject `*`
// with its own settings row, so a path has a platform-wide cap beside the per-subject one: a
// one-time-code flood spread over many numbers still stops. It is checked first, so a refused
// budget counts nothing against the caller's own subject.
//
// WHO IS COUNTED is the endpoint's to name, by what the server knows: the account identifier for
// authentication and the destination for a one-time code (OWASP ASVS 4.0.3 2.2.1 counts per
// account; Twilio Verify limits per phone number), and the authenticated user for search and
// payment initiation. The client's network address is not used: no context carries it yet, and
// which proxy header may be trusted is the hosting decision (research R-18). A subject is hashed
// before it reaches the counter with HMAC-SHA256 under a key derived from ENCRYPTION_KEY by HKDF
// under `ijazah:rate-limit-subject:v1` (listed in platform/crypto/encryption.ts), so no phone,
// email or user id sits in a Redis key in clear and a Redis dump cannot be brute-forced back to
// phone numbers, whose space is small enough to enumerate against a plain hash.
//
// THE COUNTER is a fixed window in Redis, the store ARCHITECTURE §2 reserves for queues and rate
// limits: one script increments the key and, when the key has no expiry yet, gives it the window,
// atomically (the INCR rate-limiter pattern, https://redis.io/docs/latest/commands/incr/). Every
// call counts, refused ones included, so a client that keeps calling stays refused until its
// window ends. A fixed window lets up to twice the limit through around a window's edge, accepted
// for these limits. Losing Redis loses only counts, never a record (ARCHITECTURE §2). A counter
// that fails is not caught here: the call fails with the internal error and is reported.
//
// A REFUSAL is 429 `RATE_LIMITED` in the one error shape (T101; RFC 6585 §4), naming neither the
// subject nor the limit.
import { createHmac, hkdfSync } from 'node:crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { DomainError } from '../errors/domain-error.js';
import type { Logger } from '../logging/logger.js';
import type { SettingsReader } from '../settings/settings-reader.js';

/** The settings key of one limit. */
export type RateLimitKey = `rate_limit_${string}`;

/** The four paths limited by default (NFR-SEC-10) and the two budgets (T170), each by its settings key. */
export const defaultRateLimits = {
  authentication: 'rate_limit_authentication',
  oneTimeCode: 'rate_limit_one_time_code',
  search: 'rate_limit_search',
  paymentInitiation: 'rate_limit_payment_initiation',
  oneTimeCodeBudget: 'rate_limit_one_time_code_budget',
  authenticationBudget: 'rate_limit_authentication_budget',
} as const satisfies Record<string, RateLimitKey>;

/** The one subject a budget is counted under: the whole platform. */
export const BUDGET_SUBJECT = '*';

/** The HKDF label of the key that hashes subjects; registered in platform/crypto/encryption.ts. */
export const RATE_LIMIT_SUBJECT_LABEL = 'ijazah:rate-limit-subject:v1';

const SUBJECT_KEY_BYTES = 32;

/** The key that hashes subjects: 32 bytes derived from ENCRYPTION_KEY (base64) by HKDF-SHA256. */
export function deriveRateLimitSubjectKey(encryptionKey: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(encryptionKey, 'base64'),
      Buffer.alloc(0),
      RATE_LIMIT_SUBJECT_LABEL,
      SUBJECT_KEY_BYTES,
    ),
  );
}

/** What a limit's settings row must hold. */
export const rateLimitSetting = z.object({
  limit: z.int().positive(),
  window_seconds: z.int().positive(),
});

/** Where calls are counted: `RedisRateLimitCounter`, or a fake in a spec. */
export interface RateLimitCounter {
  /**
   * Counts one call under `key` and answers how many the current window holds, this one included.
   * The first call of a window opens it for `windowSeconds`.
   */
  hit(key: string, windowSeconds: number): Promise<number>;
}

export interface RateLimiterDependencies {
  readonly settings: SettingsReader;
  readonly counter: RateLimitCounter;
  /** `deriveRateLimitSubjectKey(ENCRYPTION_KEY)`: what hashes a subject before it is counted. */
  readonly subjectKey: Buffer;
}

export class RateLimiter {
  readonly #settings: SettingsReader;
  readonly #counter: RateLimitCounter;
  readonly #subjectKey: Buffer;

  constructor({ settings, counter, subjectKey }: RateLimiterDependencies) {
    this.#settings = settings;
    this.#counter = counter;
    this.#subjectKey = subjectKey;
  }

  /** Counts one call by `subject` under `key`; refuses it once the window holds more than the limit. */
  async check(key: RateLimitKey, subject: string): Promise<void> {
    if (subject === '') {
      throw new Error(`Rate limit ${key}: the endpoint named no subject; nothing was counted.`);
    }
    const { limit, window_seconds } = await this.#settings.read(key, rateLimitSetting);
    const count = await this.#counter.hit(this.counterKey(key, subject), window_seconds);
    if (count > limit) throw new DomainError('RATE_LIMITED');
  }

  private counterKey(key: RateLimitKey, subject: string): string {
    const digest = createHmac('sha256', this.#subjectKey).update(subject).digest('hex');
    return `rate-limit:${key}:${digest}`;
  }
}

/**
 * What a procedure declares to be limited (T170): the settings key, who is counted, and the
 * platform-wide budget key when the path has one. `TContext` and `TInput` are the kind's own, so a
 * student procedure names its caller and a public one reads its input.
 */
export interface RateLimitDeclaration<TContext, TInput> {
  readonly key: RateLimitKey;
  /** The subject counted: an account identifier, a destination, the authenticated user. */
  readonly subjectOf: (call: { readonly ctx: TContext; readonly input: TInput }) => string;
  readonly budget?: RateLimitKey;
}

/** What the middleware reads of a call: the context's limiter, the validated input and `next`. */
interface ThrottledCall {
  readonly ctx: { readonly rateLimiter: RateLimiter };
  readonly input: unknown;
  readonly next: () => Promise<unknown>;
}

/**
 * The procedure middleware a caller kind applies for a declaration: the budget first, when one is
 * named, then the subject, each refused past its limit before the handler runs.
 */
export function throttle<TOptions extends ThrottledCall>(
  declaration: RateLimitDeclaration<TOptions['ctx'], TOptions['input']>,
): (options: TOptions) => ReturnType<TOptions['next']> {
  const middleware = async (options: TOptions) => {
    const { rateLimiter } = options.ctx;
    if (declaration.budget !== undefined) {
      await rateLimiter.check(declaration.budget, BUDGET_SUBJECT);
    }
    // Only the validated input and the context reach the subject, at runtime as in the type.
    await rateLimiter.check(
      declaration.key,
      declaration.subjectOf({ ctx: options.ctx, input: options.input }),
    );
    return options.next();
  };
  // It answers exactly what `next` answers; an async function's declared type cannot say so.
  return middleware as (options: TOptions) => ReturnType<TOptions['next']>;
}

// INCR, then EXPIRE only when the key has no expiry: on a window's first call, or on a key a
// failure left without one, so no counter outlives its window.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

/** The one command of a Redis client the counter needs. */
export interface ScriptRunner {
  eval(script: string, keyCount: number, ...keysAndArgs: Array<string | number>): Promise<unknown>;
}

/** Counts in Redis, one atomic script per call. */
export class RedisRateLimitCounter implements RateLimitCounter {
  readonly #redis: ScriptRunner;

  constructor(redis: ScriptRunner) {
    this.#redis = redis;
  }

  async hit(key: string, windowSeconds: number): Promise<number> {
    const count = await this.#redis.eval(HIT_SCRIPT, 1, key, windowSeconds);
    if (typeof count !== 'number' || !Number.isInteger(count)) {
      throw new TypeError('The rate-limit counter answered something other than a count.');
    }
    return count;
  }
}

/**
 * The process's limiter: counts in the Redis at `redisUrl`, limits from `settings`, subjects
 * hashed under a key derived from `encryptionKey`. The connection is the configured URL and
 * nothing else, so `rediss://` verifies the certificate as the driver does by default (R-SEC-11).
 * It connects on its first count, so a process that limits nothing yet opens no connection; a
 * connection failure is logged, and the count it fails answers the internal error.
 */
export function createRateLimiter({
  redisUrl,
  settings,
  log,
  encryptionKey,
}: {
  readonly redisUrl: string;
  readonly settings: SettingsReader;
  readonly log: Logger;
  /** ENCRYPTION_KEY (base64), from which the subject key is derived. */
  readonly encryptionKey: string;
}): RateLimiter {
  // A count waits out one reconnection at most, not the driver's default of twenty, so a request
  // is refused promptly while Redis is down.
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', (error: unknown) => log.warn({ err: error }, 'Rate-limit counter unreachable'));
  return new RateLimiter({
    settings,
    counter: new RedisRateLimitCounter(redis),
    subjectKey: deriveRateLimitSubjectKey(encryptionKey),
  });
}
