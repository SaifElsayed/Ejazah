// T137 — rate limiting (FR-043, R-SEC-6, NFR-SEC-10; contracts/kernel.md "Guards applied by
// default").
//
// Each case calls a fixture user surface through the same middleware as over HTTP: one procedure
// for each of the four default paths (authentication, one-time code, search, payment initiation),
// one that applies no limit, and one that opts in with a limit of its own. A refusal is read through
// `toErrorShape`, the mapping the HTTP application sends, so "throttled" means 429 `RATE_LIMITED`
// in the one error shape.
//
// The limits are settings rows read through the kernel's `SettingsReader` (T113): the four keys and
// their defaults are the owner's decision, shared with the seed (T074). The reader here is a fake
// that behaves as the admin module's does, so a missing or invalid row fails closed. The counter is
// an in-memory fake of `RateLimitCounter`; the Redis counter's own script is asserted at the end
// against a fake client, since no test needs a Redis.
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
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
  defaultRateLimits,
  createRateLimiter,
  type RateLimitCounter,
  RateLimiter,
  RedisRateLimitCounter,
  throttle,
} from './rate-limit.guard.js';

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

/** Counts per key; a window is recorded, never elapsed, so no case depends on the clock. */
class FakeCounter implements RateLimitCounter {
  readonly counts = new Map<string, number>();
  readonly windows: number[] = [];

  async hit(key: string, windowSeconds: number): Promise<number> {
    this.windows.push(windowSeconds);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }
}

const PHONE = '+201001234567';
const OTHER_PHONE = '+201009876543';
const REPORT_LIMIT = 'rate_limit_report_user';

const student: UserSession = {
  userId: '0199c1a0-0000-7000-8000-000000000001',
  activeRoles: ['student'],
  gender: 'male',
  preferredLanguage: 'ar',
};

function fixture(options: { readonly limit?: number; readonly windowSeconds?: number } = {}) {
  const settings = new FakeSettings();
  const counter = new FakeCounter();
  const limiter = new RateLimiter({ settings, counter });
  const window = { limit: options.limit ?? 3, window_seconds: options.windowSeconds ?? 60 };
  for (const key of [...Object.values(defaultRateLimits), REPORT_LIMIT]) {
    settings.values.set(key, window);
  }

  const phoneInput = z.object({ phone: z.string() });
  const text = z.string();
  const router = createAppRouter({
    signIn: publicProcedure({ input: phoneInput, output: text })
      .use(throttle(limiter, defaultRateLimits.authentication, ({ input }) => input.phone))
      .mutation(() => 'signed-in'),
    requestCode: publicProcedure({ input: phoneInput, output: text })
      .use(throttle(limiter, defaultRateLimits.oneTimeCode, ({ input }) => input.phone))
      .mutation(() => 'sent'),
    search: studentProcedure({ input: z.void(), output: text })
      .use(throttle(limiter, defaultRateLimits.search, ({ ctx }) => ctx.caller.userId))
      .query(() => 'results'),
    startCheckout: studentProcedure({ input: z.void(), output: text })
      .use(throttle(limiter, defaultRateLimits.paymentInitiation, ({ ctx }) => ctx.caller.userId))
      .mutation(() => 'checkout'),
    profile: publicProcedure({ input: phoneInput, output: text }).query(() => 'profile'),
    reportUser: studentProcedure({ input: z.void(), output: text })
      .use(throttle(limiter, REPORT_LIMIT, ({ ctx }) => ctx.caller.userId))
      .mutation(() => 'reported'),
    nobody: publicProcedure({ input: z.void(), output: text })
      .use(throttle(limiter, defaultRateLimits.search, () => ''))
      .query(() => 'nobody'),
  });

  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const callerFor = createAppCallerFactory(router);
  const anonymous = () => callerFor(createAppContext({ session: null, log }));
  const signedIn = () => callerFor(createAppContext({ session: student, log }));
  return { settings, counter, anonymous, signedIn };
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

const throttled = {
  status: 429,
  body: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
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
  it('names the four default paths by the settings keys the seed plants (T074)', () => {
    expect(defaultRateLimits).toEqual({
      authentication: 'rate_limit_authentication',
      oneTimeCode: 'rate_limit_one_time_code',
      search: 'rate_limit_search',
      paymentInitiation: 'rate_limit_payment_initiation',
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

  it('leaves an endpoint outside the four untouched: no setting read, nothing counted', async () => {
    const f = fixture({ limit: 1 });

    for (let call = 1; call <= 50; call += 1) {
      expect(await outcome(() => f.anonymous().profile({ phone: PHONE }))).toEqual({
        status: 200,
        body: 'profile',
      });
    }
    expect(f.settings.reads).toEqual([]);
    expect(f.counter.counts.size).toBe(0);
  });

  it('throttles an endpoint outside the four once it opts in, at the limit of its own key', async () => {
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
      });

      await expect(limiter.check(defaultRateLimits.search, 'someone')).rejects.toThrow(
        'ECONNREFUSED',
      );
    });
  });
});

describe('the Redis counter (T103)', () => {
  function client(reply: unknown) {
    const calls: unknown[][] = [];
    return {
      calls,
      eval: async (...args: unknown[]) => {
        calls.push(args);
        return reply;
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
});

describe("the process's limiter (T103)", () => {
  it('refuses the call, and logs, when its Redis cannot be reached', async () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } });
    const settings = new FakeSettings();
    settings.values.set(defaultRateLimits.search, { limit: 5, window_seconds: 60 });
    // Port 1 on the loopback address: nothing listens there.
    const limiter = createRateLimiter({ redisUrl: 'redis://127.0.0.1:1', settings, log });

    await expect(limiter.check(defaultRateLimits.search, 'someone')).rejects.toThrow();
    expect(lines.some((line) => line.includes('Rate-limit counter unreachable'))).toBe(true);
  });
});
