// T103: rate limiting (FR-043, FR-034, R-SEC-6, NFR-SEC-10; contracts/kernel.md "Guards applied
// by default"). Available to any endpoint, and named by default for the four paths the SRS lists:
// authentication, one-time-code issuance, search and payment initiation.
//
// EVERY LIMIT IS A SETTING, read through the kernel's `SettingsReader` (T113) on every check and
// never held as a constant (R-MONEY-12). A limit is a `settings` row whose value is
// `{ "limit": <positive int>, "window_seconds": <positive int> }`; the default rows are planted by
// the seed (T074, the owner's decision of 2026-10-10). A missing or invalid row throws
// `SettingError` before anything is counted, which the error filter answers as the internal error:
// the call fails closed, it is never let through unlimited. ONE EXCEPTION (T062 of
// specs/004-sessions; research R-321, item 3): the signed-in default's row is held in process memory
// for up to `DEFAULT_LIMIT_SETTING_HOLD_MS` after a read that succeeded; a read that throws is never
// held, and refuses the call.
//
// HOW AN ENDPOINT IS LIMITED (T170, review findings SEC-2 and SEC-8). A limit is declared on the
// caller kind, never applied by hand: `publicProcedure({ input, output, rateLimit: { key,
// subjectOf, budget? } })`, required on the public kind (an anonymous endpoint without one does
// not compile) and accepted by the signed-in kinds, which also accept `subject: 'caller'` (T062): the
// subject is then the caller the kind authenticated, never a value an endpoint computes. The kind
// applies `throttle` after input validation, from the limiter the request context carries
// (`surfaces/context.ts`, handed in by the HTTP application from `main.ts`), and stamps the key in
// the procedure's meta. The four default keys and the two budgets are `defaultRateLimits`; any
// other endpoint declares a `rate_limit_*` key of its own, planted as a setting by the task that
// adds it. The limiter is one per process, built in `main.ts`.
//
// THE SIGNED-IN DEFAULT (T062, FR-470, SRS NFR-SEC-12; research R-321, items 2 to 5): every
// signed-in kind (student, user, teacher, participant, administrator) given no `rateLimit` applies
// `throttleDefault` where `throttle` would be, one key, `rate_limit_signed_in_default`, the caller as
// subject (`user:<userId>` or `admin:<adminId>`). A procedure that declares a limit is counted by it
// only. The default counts on a second counter of its own (`createRateLimiter`'s second client),
// raced against `DEFAULT_LIMIT_COUNTER_TIMEOUT_MS`; a failure or a timeout lets the call through
// uncounted and opens a breaker for `DEFAULT_LIMIT_BREAKER_MS` with one warning, so a Redis outage
// logs one line per period. It is the one limit that fails open: every declared limit fails closed.
//
// A BUDGET is a second key the declaration may name, counted under the one constant subject `*`
// with its own settings row, so a path has a platform-wide cap beside the per-subject one: a
// one-time-code flood spread over many numbers still stops. It is checked first, so a refused
// budget counts nothing against the caller's own subject.
//
// WHO IS COUNTED is a `RateLimitSubject` (T062): a user or an administrator, filled only by the
// signed-in kinds from the context they authenticated; an identifier, any value an endpoint names
// (the account identifier for authentication and the destination for a one-time code: OWASP ASVS
// 4.0.3 2.2.1 counts per account; Twilio Verify limits per phone number; the client's address for a
// public page); or the budget. The kind of the subject decides what a refusal's record may hold, so
// an endpoint cannot have a phone number logged as a user id. A subject is hashed before it reaches
// the counter with HMAC-SHA256 under a key derived from ENCRYPTION_KEY by HKDF under
// `ijazah:rate-limit-subject:v1` (listed in platform/crypto/encryption.ts), so no phone, email or
// user id sits in a Redis key in clear and a Redis dump cannot be brute-forced back to phone
// numbers, whose space is small enough to enumerate against a plain hash.
//
// THE COUNTER is a fixed window in Redis, the store ARCHITECTURE §2 reserves for queues and rate
// limits: one script increments the key and, when the key has no expiry yet, gives it the window,
// atomically (the INCR rate-limiter pattern, https://redis.io/docs/latest/commands/incr/). Every
// call counts, refused ones included, so a client that keeps calling stays refused until its
// window ends. A fixed window lets up to twice the limit through around a window's edge, accepted
// for these limits. Losing Redis loses only counts, never a record (ARCHITECTURE §2). A declared
// limit's counter that fails is not caught here: the call fails with the internal error.
//
// A REFUSAL is 429 `RATE_LIMITED` in the one error shape (T101; RFC 6585 §4), naming neither the
// subject nor the limit. It says when to try again (T062; the owner's decision of 2026-11-06 on the
// sixth analysis, item 6): once the count is past the limit, and only then, the counter key's
// remaining time to live is read (one PTTL, raced against the same timer), and a positive answer
// travels as `details: [{ path: 'retryAfterSeconds', code: '<whole seconds, rounded up>' }]`; a read
// that fails, times out or answers no expiry leaves the refusal without details, and never lets
// the call through.
//
// THE FIRST REFUSAL IS LOGGED (T062; SRS NFR-SEC-12; research R-321, item 6): when the count is
// exactly the limit plus one, one `warn` line, `rate limit refused`, whose fields are exactly
// `{ procedure, userId }`, `{ procedure, adminId }`, `{ procedure, subjectDigest }` (the counter
// key's HMAC, never the value) or `{ procedure, budget }` by the subject's kind; nothing for a later
// refusal in that window, so a flood writes one record per subject per window.
import { createHmac } from 'node:crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { deriveSubkey, type HkdfLabel } from '../crypto/encryption.js';
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

/** Every signed-in call that declares no limit (T062, FR-470; seeded by T001 at 150 per 60 s). */
export const SIGNED_IN_DEFAULT_RATE_LIMIT = 'rate_limit_signed_in_default' satisfies RateLimitKey;

/**
 * The opening of the live channel, `live.events`, per user (T063, FR-428; SRS §3.14 «Live channel
 * open rate limit», seeded by T001 at 10 per 60 s). Declared, so it fails closed.
 */
export const LIVE_CHANNEL_RATE_LIMIT = 'rate_limit_live_channel' satisfies RateLimitKey;

/**
 * How long the default's setting is held after a read (R-321, item 3). A named constant under
 * R-MONEY-12's exception (constitution 2.6.0), not a setting: a long hold changed from the panel
 * would keep a changed limit unseen on every signed-in call.
 */
export const DEFAULT_LIMIT_SETTING_HOLD_MS = 60_000;

/**
 * How long the default's count may take before the call goes through uncounted (R-321, item 4). A
 * named constant (R-MONEY-12's exception): a long timeout set from the panel would hold every
 * signed-in call on a failing counter.
 */
export const DEFAULT_LIMIT_COUNTER_TIMEOUT_MS = 100;

/**
 * How long the default counts nothing once its counter failed (R-321, item 4). A named constant
 * (R-MONEY-12's exception): a short breaker set from the panel would hammer a failing Redis.
 */
export const DEFAULT_LIMIT_BREAKER_MS = 10_000;

/** The one subject a budget is counted under: the whole platform. */
export const BUDGET_SUBJECT = '*';

/** The HKDF label of the key that hashes subjects; registered in platform/crypto/encryption.ts. */
export const RATE_LIMIT_SUBJECT_LABEL = 'ijazah:rate-limit-subject:v1' satisfies HkdfLabel;

/** The key that hashes subjects: 32 bytes derived from ENCRYPTION_KEY (base64) by HKDF-SHA256 (T005). */
export function deriveRateLimitSubjectKey(encryptionKey: string): Buffer {
  return deriveSubkey(encryptionKey, RATE_LIMIT_SUBJECT_LABEL);
}

/** What a limit's settings row must hold. */
export const rateLimitSetting = z.object({
  limit: z.int().positive(),
  window_seconds: z.int().positive(),
});

type RateLimitSettingValue = z.infer<typeof rateLimitSetting>;

/**
 * Who is counted (T062; research R-321, item 6). `user` and `administrator` are filled by the
 * signed-in kinds from the context they authenticated, and nowhere else; `identifier` is any value an
 * endpoint names; `budget` is the platform-wide budget's one subject.
 */
export type RateLimitSubject =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'administrator'; readonly adminId: string }
  | { readonly kind: 'identifier'; readonly value: string }
  | { readonly kind: 'budget' };

/** The caller a signed-in kind authenticated, as a subject. */
export type CallerSubject = Extract<RateLimitSubject, { kind: 'user' | 'administrator' }>;

/** Where calls are counted: `RedisRateLimitCounter`, or a fake in a spec. */
export interface RateLimitCounter {
  /**
   * Counts one call under `key` and answers how many the current window holds, this one included.
   * The first call of a window opens it for `windowSeconds`.
   */
  hit(key: string, windowSeconds: number): Promise<number>;
  /**
   * The key's remaining time to live in milliseconds, as Redis's PTTL answers it (negative for no
   * expiry or no key; T062). Read on a refusal only. A counter without it gives a refusal no time.
   */
  remainingMilliseconds?(key: string): Promise<number>;
}

/** What the limiter writes: the first refusal's record and the default breaker's warning (T062). */
export interface RateLimitLog {
  warn(fields: Readonly<Record<string, string>>, message: string): void;
}

export interface RateLimiterDependencies {
  readonly settings: SettingsReader;
  /** The declared limits' counter: its failure is the internal error (fails closed). */
  readonly counter: RateLimitCounter;
  /** The signed-in default's own counter (R-321, item 4); `counter` when not given. */
  readonly defaultCounter?: RateLimitCounter;
  /** `deriveRateLimitSubjectKey(ENCRYPTION_KEY)`: what hashes a subject before it is counted. */
  readonly subjectKey: Buffer;
  /**
   * Where a subject's first refusal and the breaker's warning are written (T062; Saif's review of
   * PR #126, round 1, follow-up 5). `createRateLimiter` always gives the process's logger; nothing
   * is written when a spec gives none.
   */
  readonly log?: RateLimitLog;
  /** A monotonic clock in milliseconds, for the hold and the breaker; `performance.now` by default. */
  readonly monotonicNow?: () => number;
}

/** A count or a remaining time that took longer than the timer allows. */
class TimedOut extends Error {
  constructor() {
    super(`The counter did not answer within ${String(DEFAULT_LIMIT_COUNTER_TIMEOUT_MS)} ms.`);
  }
}

/** `work`, or a rejection once `DEFAULT_LIMIT_COUNTER_TIMEOUT_MS` has passed; the timer is cleared. */
function withinTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut()), DEFAULT_LIMIT_COUNTER_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The text a subject is counted under; `user:` and `admin:` keep the two principals apart. */
function countedAs(subject: RateLimitSubject): string {
  switch (subject.kind) {
    case 'user':
      return subject.userId === '' ? '' : `user:${subject.userId}`;
    case 'administrator':
      return subject.adminId === '' ? '' : `admin:${subject.adminId}`;
    case 'identifier':
      return subject.value;
    case 'budget':
      return BUDGET_SUBJECT;
  }
}

export class RateLimiter {
  readonly #settings: SettingsReader;
  readonly #counter: RateLimitCounter;
  readonly #defaultCounter: RateLimitCounter;
  readonly #subjectKey: Buffer;
  readonly #log: RateLimitLog | undefined;
  readonly #now: () => number;
  /** The default's setting and when it was read; never a failed read (R-321, item 3). */
  #heldDefault: { readonly value: RateLimitSettingValue; readonly readAt: number } | undefined;
  /** Until when the default counts nothing, after its counter failed (R-321, item 4). */
  #breakerUntil: number | undefined;

  constructor({
    settings,
    counter,
    defaultCounter,
    subjectKey,
    log,
    monotonicNow,
  }: RateLimiterDependencies) {
    this.#settings = settings;
    this.#counter = counter;
    this.#defaultCounter = defaultCounter ?? counter;
    this.#subjectKey = subjectKey;
    this.#log = log;
    this.#now = monotonicNow ?? (() => performance.now());
  }

  /**
   * Counts one call by `subject` under `key`; refuses it once the window holds more than the limit.
   * `procedure` names the call in the first refusal's record: tRPC's path, or a route's fixed name.
   */
  async check(key: RateLimitKey, subject: RateLimitSubject, procedure: string): Promise<void> {
    const counted = countedAs(subject);
    if (counted === '') {
      throw new Error(`Rate limit ${key}: the endpoint named no subject; nothing was counted.`);
    }
    if (key === SIGNED_IN_DEFAULT_RATE_LIMIT) {
      await this.#checkDefault(subject, counted, procedure);
      return;
    }
    const { limit, window_seconds } = await this.#settings.read(key, rateLimitSetting);
    const digest = this.#digest(counted);
    const counterKey = `rate-limit:${key}:${digest}`;
    const count = await this.#counter.hit(counterKey, window_seconds);
    if (count <= limit) return;
    if (count === limit + 1) this.#logRefusal(key, subject, digest, procedure);
    throw await this.#refusal(this.#counter, counterKey);
  }

  /** The default: its held setting, its own counter under the timer, and the breaker. */
  async #checkDefault(
    subject: RateLimitSubject,
    counted: string,
    procedure: string,
  ): Promise<void> {
    const { limit, window_seconds } = await this.#defaultSetting();
    if (this.#breakerUntil !== undefined && this.#now() < this.#breakerUntil) return;
    this.#breakerUntil = undefined;
    const digest = this.#digest(counted);
    const counterKey = `rate-limit:${SIGNED_IN_DEFAULT_RATE_LIMIT}:${digest}`;
    let count: number;
    try {
      count = await withinTimeout(this.#defaultCounter.hit(counterKey, window_seconds));
    } catch {
      // Fails open (R-321, item 4): the call goes through, and the breaker's one warning says so.
      this.#breakerUntil = this.#now() + DEFAULT_LIMIT_BREAKER_MS;
      this.#log?.warn(
        { key: SIGNED_IN_DEFAULT_RATE_LIMIT },
        'Rate-limit breaker opened: the signed-in default lets calls through uncounted',
      );
      return;
    }
    if (count <= limit) return;
    if (count === limit + 1) {
      this.#logRefusal(SIGNED_IN_DEFAULT_RATE_LIMIT, subject, digest, procedure);
    }
    throw await this.#refusal(this.#defaultCounter, counterKey);
  }

  /** The default's row, read again once the hold has passed; a `SettingError` is never held. */
  async #defaultSetting(): Promise<RateLimitSettingValue> {
    const held = this.#heldDefault;
    const now = this.#now();
    if (held !== undefined && now - held.readAt < DEFAULT_LIMIT_SETTING_HOLD_MS) {
      return held.value;
    }
    const value = await this.#settings.read(SIGNED_IN_DEFAULT_RATE_LIMIT, rateLimitSetting);
    this.#heldDefault = { value, readAt: now };
    return value;
  }

  /** `RATE_LIMITED`, with the window's remaining whole seconds when the counter can say them. */
  async #refusal(counter: RateLimitCounter, counterKey: string): Promise<DomainError> {
    const seconds = await this.#retryAfterSeconds(counter, counterKey);
    return seconds === undefined
      ? new DomainError('RATE_LIMITED')
      : new DomainError('RATE_LIMITED', undefined, {
          details: [{ path: 'retryAfterSeconds', code: String(seconds) }],
        });
  }

  async #retryAfterSeconds(
    counter: RateLimitCounter,
    counterKey: string,
  ): Promise<number | undefined> {
    if (counter.remainingMilliseconds === undefined) return undefined;
    try {
      const milliseconds = await withinTimeout(counter.remainingMilliseconds(counterKey));
      return milliseconds > 0 ? Math.ceil(milliseconds / 1000) : undefined;
    } catch {
      // The refusal stands without its time; it never lets the call through (T062).
      return undefined;
    }
  }

  /** The first refusal's one record: the procedure and what the subject's kind allows, no more. */
  #logRefusal(
    key: RateLimitKey,
    subject: RateLimitSubject,
    digest: string,
    procedure: string,
  ): void {
    const fields =
      subject.kind === 'user'
        ? { procedure, userId: subject.userId }
        : subject.kind === 'administrator'
          ? { procedure, adminId: subject.adminId }
          : subject.kind === 'identifier'
            ? { procedure, subjectDigest: digest }
            : { procedure, budget: key };
    this.#log?.warn(fields, 'rate limit refused');
  }

  #digest(counted: string): string {
    return createHmac('sha256', this.#subjectKey).update(counted).digest('hex');
  }
}

/** A declared limit whose subject is the caller a signed-in kind authenticated (T062). */
export interface CallerRateLimit {
  readonly key: RateLimitKey;
  readonly subject: 'caller';
  readonly budget?: RateLimitKey;
}

/**
 * A declared limit whose subject is a value the endpoint names, always counted as an `identifier`
 * (T170, T062). `TContext` and `TInput` are the kind's own, so a public procedure reads its input.
 */
export interface IdentifierRateLimit<TContext, TInput> {
  readonly key: RateLimitKey;
  /** The subject counted: an account identifier, a destination, a client address. */
  readonly subjectOf: (call: { readonly ctx: TContext; readonly input: TInput }) => string;
  readonly budget?: RateLimitKey;
}

/**
 * What a procedure declares to be limited (T170, T062): the settings key, who is counted, and the
 * platform-wide budget key when the path has one. `subject: 'caller'` is accepted by the signed-in
 * kinds only; the anonymous kinds take an `IdentifierRateLimit`.
 */
export type RateLimitDeclaration<TContext, TInput> =
  CallerRateLimit | IdentifierRateLimit<TContext, TInput>;

/** What the middleware reads of a call: the context's limiter, the validated input, tRPC's path. */
interface ThrottledCall {
  readonly ctx: { readonly rateLimiter: RateLimiter };
  readonly input: unknown;
  readonly path: string;
  readonly next: () => Promise<unknown>;
}

/**
 * The procedure middleware a caller kind applies for a declaration: the budget first, when one is
 * named, then the subject, each refused past its limit before the handler runs. `callerOf` is the
 * signed-in kind's own reading of the caller it authenticated; a `'caller'` declaration without one
 * does not build.
 */
export function throttle<TOptions extends ThrottledCall>(
  declaration: RateLimitDeclaration<TOptions['ctx'], TOptions['input']>,
  callerOf?: (ctx: TOptions['ctx']) => CallerSubject,
): (options: TOptions) => ReturnType<TOptions['next']> {
  if ('subject' in declaration && callerOf === undefined) {
    throw new Error(`Rate limit ${declaration.key}: 'caller' is a signed-in kind's subject only.`);
  }
  const middleware = async (options: TOptions) => {
    const { rateLimiter } = options.ctx;
    if (declaration.budget !== undefined) {
      await rateLimiter.check(declaration.budget, { kind: 'budget' }, options.path);
    }
    // Only the validated input and the context reach the subject, at runtime as in the type.
    const subject: RateLimitSubject =
      'subject' in declaration
        ? (callerOf as (ctx: TOptions['ctx']) => CallerSubject)(options.ctx)
        : {
            kind: 'identifier',
            value: declaration.subjectOf({ ctx: options.ctx, input: options.input }),
          };
    await rateLimiter.check(declaration.key, subject, options.path);
    return options.next();
  };
  // It answers exactly what `next` answers; an async function's declared type cannot say so.
  return middleware as (options: TOptions) => ReturnType<TOptions['next']>;
}

/**
 * The middleware a signed-in kind applies where it was given no `rateLimit` (T062, FR-470): the
 * signed-in default, the caller as subject, tRPC's path as the procedure.
 */
export function throttleDefault<TOptions extends ThrottledCall>(
  callerOf: (ctx: TOptions['ctx']) => CallerSubject,
): (options: TOptions) => ReturnType<TOptions['next']> {
  const middleware = async (options: TOptions) => {
    await options.ctx.rateLimiter.check(
      SIGNED_IN_DEFAULT_RATE_LIMIT,
      callerOf(options.ctx),
      options.path,
    );
    return options.next();
  };
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

/** The two commands of a Redis client the counter needs. */
export interface ScriptRunner {
  eval(script: string, keyCount: number, ...keysAndArgs: Array<string | number>): Promise<unknown>;
  pttl(key: string): Promise<number>;
}

/** Counts in Redis, one atomic script per call; a refusal's time is one PTTL on the same client. */
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

  async remainingMilliseconds(key: string): Promise<number> {
    const remaining: unknown = await this.#redis.pttl(key);
    if (typeof remaining !== 'number' || !Number.isInteger(remaining)) {
      throw new TypeError('The rate-limit counter answered something other than a time to live.');
    }
    return remaining;
  }
}

/**
 * The process's limiter: counts in the Redis at `redisUrl`, limits from `settings`, subjects
 * hashed under a key derived from `encryptionKey`. The connection is the configured URL and
 * nothing else, so `rediss://` verifies the certificate as the driver does by default (R-SEC-11).
 * Two clients of the one URL (T062; research R-321, item 4): the declared limits' connects on its
 * first count, so a connection failure is logged and the count it fails answers the internal
 * error; the signed-in default's connects when the limiter is built, since every process that
 * builds one serves signed-in calls, and fails a command at once while the connection is down, so
 * the default fails open within its timer.
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
  // No queue while down, no retry, no command waiting past the default's timer (ioredis 5.11.1).
  const fast = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: DEFAULT_LIMIT_COUNTER_TIMEOUT_MS,
  });
  fast.on('error', (error: unknown) =>
    log.warn({ err: error }, 'Signed-in default rate-limit counter unreachable'),
  );
  return new RateLimiter({
    settings,
    counter: new RedisRateLimitCounter(redis),
    defaultCounter: new RedisRateLimitCounter(fast),
    subjectKey: deriveRateLimitSubjectKey(encryptionKey),
    log,
  });
}
