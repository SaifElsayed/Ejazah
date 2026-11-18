// T137 — rate limiting (FR-043, R-SEC-6, NFR-SEC-10; contracts/kernel.md "Guards applied by
// default").
//
// Each case calls a fixture user surface through the same middleware as over HTTP: one procedure
// for each of the four default paths (authentication, one-time code, search, payment initiation),
// one that applies no limit, and one that opts in with a limit of its own. A refusal is read through
// `toErrorShape`, the mapping the HTTP application sends, so "throttled" means 429 `RATE_LIMITED`
// in the one error shape.
//
// The limits are settings rows read through the kernel's `SettingsReader` (T113): the keys and
// their defaults are the owner's decision, shared with the seed (T074). The reader here is a fake
// that behaves as the admin module's does, so a missing or invalid row fails closed. The counter is
// an in-memory fake of `RateLimitCounter`; the Redis counter's own script is asserted at the end
// against a fake client, since no test needs a Redis.
//
// T170 (review findings SEC-2, SEC-8): a limit is declared on the caller kind, `rateLimit: { key,
// subjectOf, budget? }`, never applied by hand, and the kind applies it from the limiter the request
// context carries. A `budget` is a second key counted under the one constant subject `*`, so a path
// has a platform-wide cap beside its per-subject one; it is checked first, so a refused budget
// counts nothing per subject. The counter key hashes the subject with HMAC-SHA256 under a key
// derived from ENCRYPTION_KEY, so a Redis dump cannot be brute-forced back to phone numbers.
import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../logging/logger.js';
import { SettingError, type SettingsReader } from '../settings/settings-reader.js';
import { createAppContext, type UserSession } from '../../surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  toErrorShape,
} from '../../surfaces/procedures.js';
import {
  BUDGET_SUBJECT,
  defaultRateLimits,
  deriveRateLimitSubjectKey,
  createRateLimiter,
  RATE_LIMIT_SUBJECT_LABEL,
  type RateLimitCounter,
  type RateLimitLog,
  RateLimiter,
  RedisRateLimitCounter,
  SIGNED_IN_DEFAULT_RATE_LIMIT,
} from './rate-limit.guard.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';

/** The settings store, as the admin module answers it: missing or refused rows fail closed. */
class FakeSettings implements SettingsReader {
  readonly values = new Map<string, unknown>();
  readonly reads: string[] = [];

  async read<T>(key: string, schema: z.ZodType<T>): Promise<T> {
    this.reads.push(key);
    if (!this.values.has(key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(this.values.get(key));
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  }
}

/**
 * Counts per key; a window is recorded, never elapsed, so no case depends on the clock. Its
 * remaining time to live answers `remaining` (T062), and each such read is counted.
 */
class FakeCounter implements RateLimitCounter {
  readonly counts = new Map<string, number>();
  readonly windows: number[] = [];
  remaining: () => Promise<number> = async () => 30_500;
  remainingReads = 0;

  async hit(key: string, windowSeconds: number): Promise<number> {
    this.windows.push(windowSeconds);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }

  remainingMilliseconds(): Promise<number> {
    this.remainingReads += 1;
    return this.remaining();
  }
}

type LogLine = readonly [Readonly<Record<string, unknown>>, string];

/** A log that keeps what the limiter writes, by fields and message (T062). */
function recordingLog(): RateLimitLog & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return { lines, warn: (fields, message) => void lines.push([{ ...fields }, message]) };
}

const PHONE = '+201001234567';
const OTHER_PHONE = '+201009876543';
const THIRD_PHONE = '+201005555555';
const REPORT_LIMIT = 'rate_limit_report_user';
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const clientAddress = '203.0.113.7';
const OTHER_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const someone = { kind: 'identifier', value: 'someone' } as const;

const student: UserSession = {
  userId: '0199c1a0-0000-7000-8000-000000000001',
  sessionId: '0199c1a0-0000-7000-8000-000000000002',
  role: 'student',
  accountStatus: 'active',
  gender: 'male',
  preferredLanguage: 'ar',
};

function fixture(
  options: {
    readonly limit?: number;
    readonly windowSeconds?: number;
    readonly budgetLimit?: number;
    readonly defaultLimit?: number;
  } = {},
) {
  const settings = new FakeSettings();
  const counter = new FakeCounter();
  const limiterLog = recordingLog();
  const limiter = new RateLimiter({
    settings,
    counter,
    subjectKey: deriveRateLimitSubjectKey(ENCRYPTION_KEY),
    log: limiterLog,
  });
  const window = { limit: options.limit ?? 3, window_seconds: options.windowSeconds ?? 60 };
  for (const key of [...Object.values(defaultRateLimits), REPORT_LIMIT]) {
    settings.values.set(key, window);
  }
  settings.values.set(SIGNED_IN_DEFAULT_RATE_LIMIT, {
    limit: options.defaultLimit ?? 1_000,
    window_seconds: 60,
  });
  if (options.budgetLimit !== undefined) {
    const budget = { limit: options.budgetLimit, window_seconds: 3600 };
    settings.values.set(defaultRateLimits.authenticationBudget, budget);
    settings.values.set(defaultRateLimits.oneTimeCodeBudget, budget);
  }

  const phoneInput = z.object({ phone: z.string() });
  const text = z.string();
  const router = createAppRouter({
    signIn: publicProcedure({
      input: phoneInput,
      output: text,
      rateLimit: {
        key: defaultRateLimits.authentication,
        subjectOf: ({ input }) => input.phone,
        ...(options.budgetLimit === undefined
          ? {}
          : { budget: defaultRateLimits.authenticationBudget }),
      },
    }).mutation(() => 'signed-in'),
    requestCode: publicProcedure({
      input: phoneInput,
      output: text,
      rateLimit: {
        key: defaultRateLimits.oneTimeCode,
        subjectOf: ({ input }) => input.phone,
        ...(options.budgetLimit === undefined
          ? {}
          : { budget: defaultRateLimits.oneTimeCodeBudget }),
      },
    }).mutation(() => 'sent'),
    search: studentProcedure({
      input: z.void(),
      output: text,
      rateLimit: { key: defaultRateLimits.search, subject: 'caller' },
    }).query(() => 'results'),
    startCheckout: studentProcedure({
      input: z.void(),
      output: text,
      rateLimit: { key: defaultRateLimits.paymentInitiation, subject: 'caller' },
    }).mutation(() => 'checkout'),
    // A student procedure that declares no limit: counted by the signed-in default (T062).
    profile: studentProcedure({ input: phoneInput, output: text }).query(() => 'profile'),
    reportUser: studentProcedure({
      input: z.void(),
      output: text,
      rateLimit: { key: REPORT_LIMIT, subject: 'caller' },
    }).mutation(() => 'reported'),
    nobody: publicProcedure({
      input: z.void(),
      output: text,
      rateLimit: { key: defaultRateLimits.search, subjectOf: () => '' },
    }).query(() => 'nobody'),
  });

  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  // The services the user surface's context carries (T038): nothing here reads one.
  const services = {
    settings: {
      read: async () => {
        throw new Error('no setting is read here');
      },
    },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    catalog: unusedCatalogServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat: unusedChatServices,
    certification: unusedCertificationServices,
    moderation: unusedModerationServices,
  };
  const callerFor = createAppCallerFactory(router);
  const anonymous = () =>
    callerFor(
      createAppContext({ session: null, log, rateLimiter: limiter, clientAddress, services }),
    );
  const signedIn = () =>
    callerFor(
      createAppContext({ session: student, log, rateLimiter: limiter, clientAddress, services }),
    );
  return { settings, counter, limiter, anonymous, signedIn, log: limiterLog };
}

type Fixture = ReturnType<typeof fixture>;

/** The status and body the HTTP application would send for this call, or 200 when it passes. */
async function outcome(call: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    return { status: 200, body: await call() };
  } catch (error: unknown) {
    if (!(error instanceof TRPCError)) throw error;
    const mapped = toErrorShape(error);
    return { status: mapped.status, body: mapped.body };
  }
}

// The fake counter's window has 30 500 ms left, so every refusal says 31 s (T062).
const throttled = {
  status: 429,
  body: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Try again later.',
    details: [{ path: 'retryAfterSeconds', code: '31' }],
  },
};

const defaultPaths: ReadonlyArray<{
  readonly path: string;
  readonly key: string;
  readonly call: (f: Fixture) => Promise<unknown>;
}> = [
  {
    path: 'authentication',
    key: 'rate_limit_authentication',
    call: (f) => f.anonymous().signIn({ phone: PHONE }),
  },
  {
    path: 'one-time code',
    key: 'rate_limit_one_time_code',
    call: (f) => f.anonymous().requestCode({ phone: PHONE }),
  },
  { path: 'search', key: 'rate_limit_search', call: (f) => f.signedIn().search() },
  {
    path: 'payment initiation',
    key: 'rate_limit_payment_initiation',
    call: (f) => f.signedIn().startCheckout(),
  },
];

describe('rate limiting (T137, FR-043, R-SEC-6)', () => {
  it('names the four default paths and the two budgets by the settings keys the seed plants (T074, T170)', () => {
    expect(defaultRateLimits).toEqual({
      authentication: 'rate_limit_authentication',
      oneTimeCode: 'rate_limit_one_time_code',
      search: 'rate_limit_search',
      paymentInitiation: 'rate_limit_payment_initiation',
      oneTimeCodeBudget: 'rate_limit_one_time_code_budget',
      authenticationBudget: 'rate_limit_authentication_budget',
    });
  });

  it.each(defaultPaths)('throttles the $path path beyond its configured limit', async (path) => {
    const f = fixture({ limit: 3 });

    for (let call = 1; call <= 3; call += 1) {
      expect((await outcome(() => path.call(f))).status).toBe(200);
    }
    expect(await outcome(() => path.call(f))).toEqual(throttled);
    expect(await outcome(() => path.call(f))).toEqual(throttled);
    expect(f.settings.reads.every((key) => key === path.key)).toBe(true);
  });

  it('counts an endpoint that declares no limit under the signed-in default only (T062)', async () => {
    const f = fixture({ limit: 1, defaultLimit: 50 });

    for (let call = 1; call <= 50; call += 1) {
      expect(await outcome(() => f.signedIn().profile({ phone: PHONE }))).toEqual({
        status: 200,
        body: 'profile',
      });
    }
    // Read once and held (T062): the default's setting is the one the limiter keeps for 60 s.
    expect(f.settings.reads).toEqual([SIGNED_IN_DEFAULT_RATE_LIMIT]);
    const keys = [...f.counter.counts.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(SIGNED_IN_DEFAULT_RATE_LIMIT);
  });

  it('throttles an endpoint outside the four once it declares a key of its own, at that key’s limit', async () => {
    const f = fixture({ limit: 3 });
    f.settings.values.set(REPORT_LIMIT, { limit: 2, window_seconds: 3600 });

    expect((await outcome(() => f.signedIn().reportUser())).status).toBe(200);
    expect((await outcome(() => f.signedIn().reportUser())).status).toBe(200);
    expect(await outcome(() => f.signedIn().reportUser())).toEqual(throttled);
    expect(f.settings.reads).toEqual([REPORT_LIMIT, REPORT_LIMIT, REPORT_LIMIT]);
    expect(f.counter.windows).toEqual([3600, 3600, 3600]);
  });

  it('reads the limit from settings on every call, never from a constant', async () => {
    const f = fixture({ limit: 2 });
    const signIn = () => f.anonymous().signIn({ phone: PHONE });

    expect((await outcome(signIn)).status).toBe(200);
    expect((await outcome(signIn)).status).toBe(200);
    expect(await outcome(signIn)).toEqual(throttled);

    // An administrator raises the limit; the next call is judged by the new value.
    f.settings.values.set(defaultRateLimits.authentication, { limit: 5, window_seconds: 60 });
    expect((await outcome(signIn)).status).toBe(200);
    expect(f.settings.reads).toHaveLength(4);
  });

  it('opens each window with the length the setting names', async () => {
    const f = fixture({ limit: 10, windowSeconds: 900 });

    await outcome(() => f.anonymous().signIn({ phone: PHONE }));
    f.settings.values.set(defaultRateLimits.authentication, { limit: 10, window_seconds: 600 });
    await outcome(() => f.anonymous().signIn({ phone: PHONE }));

    expect(f.counter.windows).toEqual([900, 600]);
  });

  it('counts each subject apart, and each path apart for the same subject', async () => {
    const f = fixture({ limit: 1 });

    expect((await outcome(() => f.anonymous().signIn({ phone: PHONE }))).status).toBe(200);
    expect(await outcome(() => f.anonymous().signIn({ phone: PHONE }))).toEqual(throttled);
    expect((await outcome(() => f.anonymous().signIn({ phone: OTHER_PHONE }))).status).toBe(200);
    expect((await outcome(() => f.anonymous().requestCode({ phone: PHONE }))).status).toBe(200);

    expect((await outcome(() => f.signedIn().search())).status).toBe(200);
    expect((await outcome(() => f.signedIn().startCheckout())).status).toBe(200);
    expect(await outcome(() => f.signedIn().search())).toEqual(throttled);
  });

  it('keeps no subject in clear in the counter key', async () => {
    const f = fixture();

    await outcome(() => f.anonymous().signIn({ phone: PHONE }));
    await outcome(() => f.signedIn().search());

    const keys = [...f.counter.counts.keys()];
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain(PHONE);
      expect(key).not.toContain('1001234567');
      expect(key).not.toContain(student.userId);
    }
  });

  it('refuses without naming the subject or the limit', async () => {
    const f = fixture({ limit: 7 });
    const signIn = () => f.anonymous().signIn({ phone: PHONE });
    for (let call = 1; call <= 7; call += 1) await outcome(signIn);

    const { body } = await outcome(signIn);
    expect(JSON.stringify(body)).not.toContain(PHONE);
    expect(JSON.stringify(body)).not.toContain('7');
  });

  describe('fails closed', () => {
    it('answers the internal error, and counts nothing, when the setting is missing', async () => {
      const f = fixture();
      f.settings.values.delete(defaultRateLimits.authentication);

      const { status, body } = await outcome(() => f.anonymous().signIn({ phone: PHONE }));
      expect(status).toBe(500);
      expect(body).toEqual({
        code: 'INTERNAL',
        message: 'Something went wrong. Try again later.',
      });
      expect(f.counter.counts.size).toBe(0);
    });

    it.each([
      ['a zero limit', { limit: 0, window_seconds: 60 }],
      ['a negative limit', { limit: -1, window_seconds: 60 }],
      ['a fractional limit', { limit: 1.5, window_seconds: 60 }],
      ['a zero window', { limit: 5, window_seconds: 0 }],
      ['no window', { limit: 5 }],
      ['a limit written as text', { limit: '5', window_seconds: 60 }],
      ['a bare number', 5],
    ])('answers the internal error, and counts nothing, for %s', async (_, stored) => {
      const f = fixture();
      f.settings.values.set(defaultRateLimits.search, stored);

      expect((await outcome(() => f.signedIn().search())).status).toBe(500);
      expect(f.counter.counts.size).toBe(0);
    });

    it('refuses a call whose subject is empty rather than counting everyone under one key', async () => {
      const f = fixture();

      expect((await outcome(() => f.anonymous().nobody())).status).toBe(500);
      expect(f.counter.counts.size).toBe(0);
    });

    it('answers the internal error when the counter cannot count', async () => {
      const settings = new FakeSettings();
      settings.values.set(defaultRateLimits.search, { limit: 5, window_seconds: 60 });
      const limiter = new RateLimiter({
        settings,
        counter: {
          hit: async () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
          },
        },
        subjectKey: deriveRateLimitSubjectKey(ENCRYPTION_KEY),
      });

      await expect(
        limiter.check(defaultRateLimits.search, someone, 'discovery.browse'),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });
});

describe('a platform-wide budget beside the per-subject limit (T170, review finding SEC-8)', () => {
  it('counts every subject under one key, and refuses at its limit whoever calls', async () => {
    const f = fixture({ limit: 10, budgetLimit: 3 });
    const signIn = (phone: string) => f.anonymous().signIn({ phone });

    expect((await outcome(() => signIn(PHONE))).status).toBe(200);
    expect((await outcome(() => signIn(OTHER_PHONE))).status).toBe(200);
    expect((await outcome(() => signIn(THIRD_PHONE))).status).toBe(200);
    // A fourth caller, under its own per-subject limit, is refused by the budget.
    expect(await outcome(() => signIn('+201007777777'))).toEqual(throttled);
    expect(await outcome(() => signIn(PHONE))).toEqual(throttled);

    const budgetKey = [...f.counter.counts.keys()].find((key) =>
      key.includes(defaultRateLimits.authenticationBudget),
    );
    expect(budgetKey).toBeDefined();
    expect(f.counter.counts.get(budgetKey ?? '')).toBe(5);
    expect(
      f.settings.reads.filter((key) => key === defaultRateLimits.authenticationBudget),
    ).toHaveLength(5);
  });

  it('is checked first, so a refused budget counts nothing against the caller’s own subject', async () => {
    const f = fixture({ limit: 10, budgetLimit: 1 });

    expect((await outcome(() => f.anonymous().signIn({ phone: PHONE }))).status).toBe(200);
    expect(await outcome(() => f.anonymous().signIn({ phone: OTHER_PHONE }))).toEqual(throttled);

    const perSubject = [...f.counter.counts.entries()].filter(
      ([key]) => !key.includes(defaultRateLimits.authenticationBudget),
    );
    expect(perSubject).toHaveLength(1);
    expect(perSubject[0]?.[1]).toBe(1);
    // The refused call read the budget and nothing else.
    expect(f.settings.reads.at(-1)).toBe(defaultRateLimits.authenticationBudget);
  });

  it('is counted under one constant subject, apart from every caller', async () => {
    const f = fixture({ limit: 10, budgetLimit: 10 });
    await outcome(() => f.anonymous().requestCode({ phone: PHONE }));
    await outcome(() => f.anonymous().requestCode({ phone: OTHER_PHONE }));

    const keys = [...f.counter.counts.keys()];
    expect(keys).toHaveLength(3);
    expect(keys.filter((key) => key.includes(defaultRateLimits.oneTimeCodeBudget))).toHaveLength(1);
    expect(BUDGET_SUBJECT).toBe('*');
  });

  it('fails closed when the budget row is missing, before the per-subject limit is read', async () => {
    const f = fixture({ limit: 10, budgetLimit: 10 });
    f.settings.values.delete(defaultRateLimits.authenticationBudget);

    expect((await outcome(() => f.anonymous().signIn({ phone: PHONE }))).status).toBe(500);
    expect(f.counter.counts.size).toBe(0);
    expect(f.settings.reads).toEqual([defaultRateLimits.authenticationBudget]);
  });
});

describe('the counter key is an HMAC of the subject (T170, review finding SEC-2)', () => {
  it('derives the subject key from ENCRYPTION_KEY under its own label, 32 bytes unlike the key itself', () => {
    expect(RATE_LIMIT_SUBJECT_LABEL).toBe('ijazah:rate-limit-subject:v1');
    const derived = deriveRateLimitSubjectKey(ENCRYPTION_KEY);
    expect(derived).toHaveLength(32);
    expect(derived.equals(Buffer.from(ENCRYPTION_KEY, 'base64'))).toBe(false);
    expect(derived.equals(deriveRateLimitSubjectKey(ENCRYPTION_KEY))).toBe(true);
    expect(derived.equals(deriveRateLimitSubjectKey(OTHER_ENCRYPTION_KEY))).toBe(false);
  });

  it('hashes one subject differently under two keys, and the same under one key', async () => {
    const counter = new FakeCounter();
    const limiterOf = (encryptionKey: string) => {
      const settings = new FakeSettings();
      settings.values.set(defaultRateLimits.search, { limit: 100, window_seconds: 60 });
      return new RateLimiter({
        settings,
        counter,
        subjectKey: deriveRateLimitSubjectKey(encryptionKey),
      });
    };

    const phone = { kind: 'identifier', value: PHONE } as const;
    await limiterOf(ENCRYPTION_KEY).check(defaultRateLimits.search, phone, 'auth.signIn');
    await limiterOf(OTHER_ENCRYPTION_KEY).check(defaultRateLimits.search, phone, 'auth.signIn');
    await limiterOf(ENCRYPTION_KEY).check(defaultRateLimits.search, phone, 'auth.signIn');

    expect(counter.counts.size).toBe(2);
    expect([...counter.counts.values()].sort()).toEqual([1, 2]);
    for (const key of counter.counts.keys()) {
      expect(key).not.toContain(PHONE);
      expect(key).not.toContain('1001234567');
    }
  });
});

describe('the Redis counter (T103)', () => {
  function client(reply: unknown, remaining: unknown = 30_500) {
    const calls: unknown[][] = [];
    return {
      calls,
      eval: async (...args: unknown[]) => {
        calls.push(args);
        return reply;
      },
      pttl: async (key: string) => {
        calls.push(['PTTL', key]);
        return remaining as number;
      },
    };
  }

  it('counts with one script that increments and opens the window only on a key without one', async () => {
    const redis = client(4);
    const counter = new RedisRateLimitCounter(redis);

    expect(await counter.hit('rate-limit:rate_limit_search:abc', 60)).toBe(4);

    expect(redis.calls).toHaveLength(1);
    const [script, keyCount, key, windowSeconds] = redis.calls[0] ?? [];
    expect(script).toEqual(expect.stringContaining("redis.call('INCR', KEYS[1])"));
    expect(script).toEqual(expect.stringContaining("redis.call('EXPIRE', KEYS[1], ARGV[1])"));
    expect(script).toEqual(expect.stringContaining("redis.call('TTL', KEYS[1])"));
    expect([keyCount, key, windowSeconds]).toEqual([1, 'rate-limit:rate_limit_search:abc', 60]);
  });

  it('refuses a reply that is not a count', async () => {
    const counter = new RedisRateLimitCounter(client('OK'));

    await expect(counter.hit('rate-limit:rate_limit_search:abc', 60)).rejects.toThrow(TypeError);
  });

  it('reads the remaining time with one PTTL on the key, and refuses a reply that is not a number (T062)', async () => {
    const redis = client(4, 12_345);
    expect(await new RedisRateLimitCounter(redis).remainingMilliseconds('rate-limit:k:abc')).toBe(
      12_345,
    );
    expect(redis.calls).toEqual([['PTTL', 'rate-limit:k:abc']]);
    await expect(
      new RedisRateLimitCounter(client(4, 'OK')).remainingMilliseconds('rate-limit:k:abc'),
    ).rejects.toThrow(TypeError);
  });
});

describe("the process's limiter (T103)", () => {
  it('refuses the call, and logs, when its Redis cannot be reached', async () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } });
    const settings = new FakeSettings();
    settings.values.set(defaultRateLimits.search, { limit: 5, window_seconds: 60 });
    // Port 1 on the loopback address: nothing listens there.
    const limiter = createRateLimiter({
      redisUrl: 'redis://127.0.0.1:1',
      settings,
      log,
      encryptionKey: ENCRYPTION_KEY,
    });

    await expect(
      limiter.check(defaultRateLimits.search, someone, 'discovery.browse'),
    ).rejects.toThrow();
    expect(lines.some((line) => line.includes('Rate-limit counter unreachable'))).toBe(true);
  });
});

// T062 (FR-470; SRS NFR-SEC-12; research R-321, «The signed-in rate limits», items 1 to 7;
// contracts/kernel.md, "Rate limits"): the signed-in default limit, the first refusal logged once
// per subject and window, and the refusal's time.
describe('the signed-in default limit (T062, FR-470, NFR-SEC-12)', () => {
  const user = { kind: 'user', userId: '0199c1a0-0000-7000-8000-00000000000a' } as const;

  /** A limiter over its own two counters and a clock the case moves (R-321, item 4). */
  function defaultFixture(defaultCounter: RateLimitCounter = new FakeCounter()) {
    const settings = new FakeSettings();
    settings.values.set(SIGNED_IN_DEFAULT_RATE_LIMIT, { limit: 2, window_seconds: 60 });
    settings.values.set(defaultRateLimits.search, { limit: 2, window_seconds: 60 });
    const counter = new FakeCounter();
    const clock = { now: 0 };
    const log = recordingLog();
    const limiter = new RateLimiter({
      settings,
      counter,
      defaultCounter,
      subjectKey: deriveRateLimitSubjectKey(ENCRYPTION_KEY),
      log,
      monotonicNow: () => clock.now,
    });
    const check = () => limiter.check(SIGNED_IN_DEFAULT_RATE_LIMIT, user, 'enrollments.list');
    return { settings, counter, clock, log, limiter, check };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a procedure with no limit RATE_LIMITED past the default’s setting', async () => {
    const f = fixture({ limit: 10, defaultLimit: 2 });

    expect((await outcome(() => f.signedIn().profile({ phone: PHONE }))).status).toBe(200);
    expect((await outcome(() => f.signedIn().profile({ phone: PHONE }))).status).toBe(200);
    expect(await outcome(() => f.signedIn().profile({ phone: PHONE }))).toMatchObject({
      status: 429,
      body: { code: 'RATE_LIMITED' },
    });
  });

  it('never counts a procedure that declares its own limit under the default', async () => {
    const f = fixture({ limit: 10, defaultLimit: 1 });

    for (let call = 1; call <= 5; call += 1) {
      expect((await outcome(() => f.signedIn().search())).status).toBe(200);
    }
    expect(f.settings.reads).not.toContain(SIGNED_IN_DEFAULT_RATE_LIMIT);
    expect([...f.counter.counts.keys()].every((key) => key.includes('rate_limit_search'))).toBe(
      true,
    );
  });

  it('counts on its own counter, apart from the declared limits’ counter', async () => {
    const defaultCounter = new FakeCounter();
    const f = defaultFixture(defaultCounter);

    await f.check();
    await f.limiter.check(defaultRateLimits.search, user, 'discovery.browse');

    expect([...defaultCounter.counts.keys()]).toHaveLength(1);
    expect([...defaultCounter.counts.keys()][0]).toContain(SIGNED_IN_DEFAULT_RATE_LIMIT);
    expect([...f.counter.counts.keys()]).toHaveLength(1);
    expect([...f.counter.counts.keys()][0]).toContain('rate_limit_search');
  });

  it('lets the call through when its counter rejects, and opens the breaker with one warning', async () => {
    let hits = 0;
    const f = defaultFixture({
      hit: async () => {
        hits += 1;
        throw new Error('Stream isn’t writeable and enableOfflineQueue options is false');
      },
    });

    await expect(f.check()).resolves.toBeUndefined();
    await expect(f.check()).resolves.toBeUndefined();
    f.clock.now = 9_999;
    await expect(f.check()).resolves.toBeUndefined();

    expect(hits).toBe(1);
    expect(f.log.lines).toEqual([
      [{ key: SIGNED_IN_DEFAULT_RATE_LIMIT }, expect.stringMatching(/breaker/i)],
    ]);
  });

  it('lets the call through when its counter never answers within 100 ms', async () => {
    vi.useFakeTimers();
    let hits = 0;
    const f = defaultFixture({
      hit: () => {
        hits += 1;
        return new Promise<number>(() => undefined);
      },
    });

    let settled = false;
    const pending = f.check().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    expect(hits).toBe(1);
    expect(f.log.lines).toHaveLength(1);
  });

  it('skips the counter until 10 s have passed, then counts again: closed by a count, reopened by a failure', async () => {
    let failing = true;
    let hits = 0;
    const f = defaultFixture({
      hit: async () => {
        hits += 1;
        if (failing) throw new Error('ETIMEDOUT');
        return 1;
      },
    });

    await f.check();
    f.clock.now = 9_999;
    await f.check();
    expect(hits).toBe(1);

    f.clock.now = 10_000;
    await f.check();
    expect(hits).toBe(2);
    expect(f.log.lines).toHaveLength(2);

    failing = false;
    f.clock.now = 20_000;
    await f.check();
    await f.check();
    expect(hits).toBe(4);
    expect(f.log.lines).toHaveLength(2);
  });

  it('a declared limit refuses the call when its counter rejects: the internal error, never let through', async () => {
    const settings = new FakeSettings();
    settings.values.set(defaultRateLimits.search, { limit: 5, window_seconds: 60 });
    const limiter = new RateLimiter({
      settings,
      counter: {
        hit: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
        },
      },
      defaultCounter: new FakeCounter(),
      subjectKey: deriveRateLimitSubjectKey(ENCRYPTION_KEY),
      log: recordingLog(),
    });

    await expect(limiter.check(defaultRateLimits.search, user, 'discovery.browse')).rejects.toThrow(
      'ECONNREFUSED',
    );
  });

  it('refuses the call when the default’s row is missing or invalid, never letting it through', async () => {
    const defaultCounter = new FakeCounter();
    const f = defaultFixture(defaultCounter);
    f.settings.values.delete(SIGNED_IN_DEFAULT_RATE_LIMIT);

    await expect(f.check()).rejects.toBeInstanceOf(SettingError);
    f.settings.values.set(SIGNED_IN_DEFAULT_RATE_LIMIT, { limit: 0, window_seconds: 60 });
    await expect(f.check()).rejects.toBeInstanceOf(SettingError);
    expect(defaultCounter.counts.size).toBe(0);
  });

  it('holds the default’s setting for 60 s, and never holds a refused read', async () => {
    const f = defaultFixture();
    f.settings.values.delete(SIGNED_IN_DEFAULT_RATE_LIMIT);
    await expect(f.check()).rejects.toBeInstanceOf(SettingError);
    f.settings.values.set(SIGNED_IN_DEFAULT_RATE_LIMIT, { limit: 100, window_seconds: 60 });

    await f.check();
    f.clock.now = 59_999;
    f.settings.values.set(SIGNED_IN_DEFAULT_RATE_LIMIT, { limit: 1, window_seconds: 60 });
    await f.check();
    await f.check();
    expect(f.settings.reads).toEqual([SIGNED_IN_DEFAULT_RATE_LIMIT, SIGNED_IN_DEFAULT_RATE_LIMIT]);

    f.clock.now = 60_000;
    await expect(f.check()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(f.settings.reads).toHaveLength(3);
  });

  it('reads every declared limit on every check: only the default is held', async () => {
    const f = defaultFixture();

    await f.limiter.check(defaultRateLimits.search, user, 'discovery.browse');
    await f.limiter.check(defaultRateLimits.search, user, 'discovery.browse');

    expect(f.settings.reads).toEqual([defaultRateLimits.search, defaultRateLimits.search]);
  });
});

describe('the first refusal of a subject in a window is logged once (T062, R-321 item 6)', () => {
  const procedure = 'sessions.complaint.raise';
  const subjects = [
    {
      name: 'a user',
      subject: { kind: 'user', userId: '0199c1a0-0000-7000-8000-00000000000b' },
      record: { procedure, userId: '0199c1a0-0000-7000-8000-00000000000b' },
    },
    {
      name: 'an administrator',
      subject: { kind: 'administrator', adminId: '0199c1a0-0000-7000-8000-00000000000c' },
      record: { procedure, adminId: '0199c1a0-0000-7000-8000-00000000000c' },
    },
    {
      name: 'an identifier',
      subject: { kind: 'identifier', value: PHONE },
      record: { procedure, subjectDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
    },
    {
      name: 'a budget',
      subject: { kind: 'budget' },
      record: { procedure, budget: REPORT_LIMIT },
    },
  ] as const;

  function limited() {
    const settings = new FakeSettings();
    settings.values.set(REPORT_LIMIT, { limit: 2, window_seconds: 60 });
    const counter = new FakeCounter();
    const log = recordingLog();
    const limiter = new RateLimiter({
      settings,
      counter,
      subjectKey: deriveRateLimitSubjectKey(ENCRYPTION_KEY),
      log,
    });
    return { limiter, log, counter };
  }

  it.each(subjects)(
    'writes exactly one record for $name, of its allowed fields only, and nothing within the limit or after',
    async ({ subject, record }) => {
      const { limiter, log } = limited();
      const check = () => limiter.check(REPORT_LIMIT, subject, procedure);

      await check();
      await check();
      expect(log.lines).toEqual([]);

      await expect(check()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(log.lines).toEqual([[record, 'rate limit refused']]);
      expect(Object.keys(log.lines[0]?.[0] ?? {}).sort()).toEqual(Object.keys(record).sort());

      await expect(check()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      await expect(check()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(log.lines).toHaveLength(1);
    },
  );

  it.each([PHONE, 'Someone@Example.org'])(
    'never writes an identifier’s raw value, serialised (%s)',
    async (value) => {
      const { limiter, log, counter } = limited();
      const subject = { kind: 'identifier', value } as const;
      for (let call = 1; call <= 3; call += 1) {
        await limiter.check(REPORT_LIMIT, subject, procedure).catch(() => undefined);
      }

      const written = JSON.stringify(log.lines);
      expect(log.lines).toHaveLength(1);
      expect(written).not.toContain(value);
      expect(written).not.toContain(value.toLowerCase());
      expect(written).not.toContain('1001234567');
      // The digest is the counter key's own, never the value.
      const [key] = [...counter.counts.keys()];
      expect(key).toContain(String(log.lines[0]?.[0].subjectDigest));
    },
  );

  it('logs the default limit’s first refusal by the caller’s id too', async () => {
    const settings = new FakeSettings();
    settings.values.set(SIGNED_IN_DEFAULT_RATE_LIMIT, { limit: 1, window_seconds: 60 });
    const log = recordingLog();
    const limiter = new RateLimiter({
      settings,
      counter: new FakeCounter(),
      subjectKey: deriveRateLimitSubjectKey(ENCRYPTION_KEY),
      log,
    });
    const subject = { kind: 'administrator', adminId: 'admin-9' } as const;

    await limiter.check(SIGNED_IN_DEFAULT_RATE_LIMIT, subject, 'audit.list');
    await expect(
      limiter.check(SIGNED_IN_DEFAULT_RATE_LIMIT, subject, 'audit.list'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      limiter.check(SIGNED_IN_DEFAULT_RATE_LIMIT, subject, 'audit.list'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(log.lines).toEqual([
      [{ procedure: 'audit.list', adminId: 'admin-9' }, 'rate limit refused'],
    ]);
  });

  it('counts a user, an administrator and an identifier of one id apart (user:<id>, admin:<id>)', async () => {
    const { limiter, counter } = limited();
    await limiter.check(REPORT_LIMIT, { kind: 'user', userId: 'same-id' }, procedure);
    await limiter.check(REPORT_LIMIT, { kind: 'administrator', adminId: 'same-id' }, procedure);
    await limiter.check(REPORT_LIMIT, { kind: 'identifier', value: 'same-id' }, procedure);

    expect(counter.counts.size).toBe(3);
  });
});

describe('a refusal says when to try again (T062; the sixth analysis, item 6)', () => {
  const subject = { kind: 'user', userId: 'student-r' } as const;

  function refusing(remaining: () => Promise<number>, onDefault = false) {
    const settings = new FakeSettings();
    const key = onDefault ? SIGNED_IN_DEFAULT_RATE_LIMIT : REPORT_LIMIT;
    settings.values.set(key, { limit: 1, window_seconds: 60 });
    const counter = new FakeCounter();
    counter.remaining = remaining;
    const limiter = new RateLimiter({
      settings,
      counter,
      subjectKey: deriveRateLimitSubjectKey(ENCRYPTION_KEY),
      log: recordingLog(),
    });
    const check = () => limiter.check(key, subject, 'chat.send');
    return { counter, check };
  }

  async function refusalOf(check: () => Promise<void>) {
    try {
      await check();
    } catch (error: unknown) {
      return toErrorShape(new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: error }));
    }
    throw new Error('the call was expected to be refused');
  }

  it.each([false, true])(
    'carries retryAfterSeconds, the key’s remaining time rounded up to whole seconds (default: %s)',
    async (onDefault) => {
      const { counter, check } = refusing(async () => 30_500, onDefault);

      await check();
      expect(counter.remainingReads).toBe(0);
      const refused = await refusalOf(check);

      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again later.',
        details: [{ path: 'retryAfterSeconds', code: '31' }],
      });
      expect(counter.remainingReads).toBe(1);
    },
  );

  it.each([
    ['fails', () => Promise.reject(new Error('ECONNRESET'))],
    ['answers no expiry', async () => -1],
    ['answers no key', async () => -2],
    ['answers zero', async () => 0],
  ])('refuses RATE_LIMITED with no details when the PTTL %s', async (_, remaining) => {
    const { check } = refusing(remaining);
    await check();

    const refused = await refusalOf(check);
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again later.',
    });
  });

  it('refuses RATE_LIMITED with no details when the PTTL never answers within 100 ms, and opens no breaker', async () => {
    vi.useFakeTimers();
    try {
      const { counter, check } = refusing(() => new Promise<number>(() => undefined), true);
      await check();

      const pending = refusalOf(check);
      await vi.advanceTimersByTimeAsync(100);
      expect((await pending).body).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again later.',
      });
      // No breaker opened: the next call is counted, and refused again with its time.
      counter.remaining = async () => 1_000;
      expect((await refusalOf(check)).body).toMatchObject({
        details: [{ path: 'retryAfterSeconds', code: '1' }],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
