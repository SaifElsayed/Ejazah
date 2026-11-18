// T063 of specs/004-sessions — the live channel over HTTP (FR-427 to FR-429; contracts/app-surface.md,
// "`live`"; contracts/kernel.md, "The live channel"; research R-324; quickstart.md §1, §4).
//
// The application is built as `main.ts` builds it, with the real `live.events` router, a real
// registry over the in-process bus, a real limiter over an in-memory counter, and fixture session
// resolvers; every case opens real Server-Sent Event streams with `fetch` and reads their frames.
// Fixture procedures stand in for the producers T066 adds: a user-kind call that adds an event to
// its request's list (sent when it resolves, never when it throws), and an administrator call that
// adds one through the transaction it is handed, as `StandingService` does (sent once the
// transaction commits, never on a rollback). The sign-out is the real `auth.signOut`.
import type { INestApplication } from '@nestjs/common';
import type { LiveEvent } from '@ijazah/contracts';
import { addHours, addSeconds } from '@ijazah/time';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApplication } from '../app.module.js';
import { authRouter } from '../modules/identity/index.js';
import type { IdentityServices } from '../modules/identity/index.js';
import { DomainError } from '../platform/errors/domain-error.js';
import {
  LIVE_CHANNEL_RATE_LIMIT,
  type RateLimitCounter,
  RateLimiter,
} from '../platform/guards/rate-limit.guard.js';
import { apiStopSequence } from '../platform/lifecycle/shutdown.js';
import { InProcessLiveBus } from '../platform/live/live-bus.js';
import { LIVE_STREAM_QUEUE_BOUND } from '../platform/live/live-constants.js';
import { publisherOn } from '../platform/live/live-publisher.js';
import { LiveRegistry } from '../platform/live/live-registry.js';
import { createLogger } from '../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import type { AdminSession, UserSession } from './context.js';
import { liveRouter } from './live.router.js';
import {
  adminProcedure,
  createAdminRouter,
  createAppRouter,
  userProcedure,
} from './procedures.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from './services.fixtures.js';

const A = '0199d0a0-0000-7000-8000-00000000a0a1';
const C = '0199d0a0-0000-7000-8000-00000000c0c1';
const SUSPENDED = '0199d0a0-0000-7000-8000-00000000d0d1';
const SHORT = '0199d0a0-0000-7000-8000-00000000e0e1';
const SESSION = '0199d0a0-0000-7000-8000-0000000051a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e1a1';
const ADMIN = '0199d0a0-0000-7000-8000-00000000ad01';

const sessionSignal: LiveEvent = { type: 'session', sessionId: SESSION, enrollmentId: ENROLLMENT };

function sessionOf(userId: string, sessionId: string, extra: Partial<UserSession> = {}): UserSession {
  return {
    userId,
    sessionId,
    role: 'student',
    gender: 'female',
    preferredLanguage: 'ar',
    accountStatus: 'active',
    accessExpiresAt: new Date(addHours(new Date(), 1)),
    ...extra,
  };
}

/** Bearer tokens of the fixture sessions; each names the device it stands for. */
const bearers: Record<string, () => UserSession> = {
  'a-phone': () => sessionOf(A, 'a-phone-session'),
  'a-tablet': () => sessionOf(A, 'a-tablet-session'),
  'a-laptop': () => sessionOf(A, 'a-laptop-session'),
  'a-fourth': () => sessionOf(A, 'a-fourth-session'),
  'c-phone': () => sessionOf(C, 'c-phone-session'),
  suspended: () => sessionOf(SUSPENDED, 's-session', { accountStatus: 'suspended' }),
  // An access token that expires three seconds after it is presented.
  short: () => sessionOf(SHORT, 'short-session', { accessExpiresAt: new Date(addSeconds(new Date(), 3)) }),
};

const adminSession: AdminSession = { adminId: ADMIN, sessionId: 'admin-session', mfaVerified: true };

/** The window's counts, in memory; the live channel's limit refused at will (T062). */
class Counter implements RateLimitCounter {
  readonly #counts = new Map<string, number>();
  refuseLive = false;

  async hit(key: string): Promise<number> {
    // The cases open many streams for A; the channel's limit is refused only when a case says so.
    if (key.includes(LIVE_CHANNEL_RATE_LIMIT)) return this.refuseLive ? 11 : 1;
    const count = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, count);
    return count;
  }

  async remainingMilliseconds(): Promise<number> {
    return 30_500;
  }
}

const rows: Record<string, unknown> = {
  rate_limit_live_channel: { limit: 10, window_seconds: 60 },
  rate_limit_signed_in_default: { limit: 1_000, window_seconds: 60 },
  live_channel_max_connections_per_user: 3,
};
const settings: SettingsReader = {
  read: async <T>(key: string, schema: z.ZodType<T>): Promise<T> => {
    if (!(key in rows)) throw new SettingError(key, 'missing');
    return schema.parse(rows[key]);
  },
};

const lines: string[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } });

/** A fixture user surface: the live channel, the real sign-out, and two producers. */
const app = createAppRouter({
  live: liveRouter,
  auth: authRouter,
  fixture: {
    // A user-kind call that adds an event for `to`; it throws after adding when told.
    poke: userProcedure({
      input: z.object({
        to: z.array(z.string()),
        throws: z.boolean().optional(),
        count: z.number().optional(),
        invalid: z.boolean().optional(),
      }),
      output: z.void(),
    }).mutation(({ ctx, input }) => {
      const event = input.invalid === true
        ? ({ type: 'enrollment', enrollmentId: 'not an id', body: 'a message body' } as unknown as LiveEvent)
        : sessionSignal;
      for (let sent = 0; sent < (input.count ?? 1); sent += 1) ctx.live.afterCommit(input.to, event);
      if (input.throws === true) throw new DomainError('CONFLICT');
    }),
  },
});

/** A fixture administrator surface: an action that ends a person's streams as a standing change does. */
const admin = createAdminRouter({
  restrict: adminProcedure({
    input: z.object({ userId: z.string(), rollBack: z.boolean().optional() }),
    output: z.void(),
  }).mutation(({ ctx, input }) => {
    publisherOn(ctx.tx)?.afterCommit([input.userId], { type: 'account' });
    ctx.audit.record({
      action: 'student.suspend',
      targetType: 'user',
      targetId: input.userId,
      reason: 'a reason',
      before: {},
      after: {},
    });
    if (input.rollBack === true) throw new DomainError('CONFLICT');
  }),
});

interface Frame {
  readonly event: string | undefined;
  readonly data: string;
}

interface OpenStream {
  readonly frames: Frame[];
  readonly ended: () => boolean;
  readonly close: () => void;
  /** The events the stream carried, parsed, connection and pings left out. */
  readonly events: () => unknown[];
  readonly errors: () => Array<Record<string, unknown>>;
}

let application: INestApplication;
let origin: string;
let registry: LiveRegistry;
let bus: InProcessLiveBus;
let counter: Counter;
let committed: number;
let stopped = false;

beforeAll(async () => {
  bus = new InProcessLiveBus();
  registry = new LiveRegistry({ bus, settings, log });
  counter = new Counter();
  committed = 0;
  application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 64 * 1024,
    administration: {
      transactions: {
        run: async (work) => {
          const answer = await work({} as never);
          committed += 1;
          return answer;
        },
      },
      auditWriter: { write: async () => undefined },
    },
    rateLimiter: new RateLimiter({ settings, counter, subjectKey: Buffer.alloc(32, 6), log }),
    sessions: {
      user: async (bearer) => bearers[bearer]?.() ?? null,
      admin: async (bearer) => (bearer === 'admin' ? adminSession : null),
    },
    services: {
      settings,
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => [] },
      identity: { sessions: { signOut: async () => undefined } } as unknown as IdentityServices,
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
    },
    adminServices: unusedAdminServices,
    surfaces: { app, admin },
    live: { bus, registry },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  // The shutdown case stops the application itself.
  if (stopped) return;
  registry?.endAll();
  await application?.close();
});

/** Opens `live.events` as the phone does: a GET with the bearer in the header, never in the URL. */
async function open(bearer: string | null, url = '/trpc/live.events'): Promise<OpenStream> {
  const controller = new AbortController();
  const response = await fetch(`${origin}${url}`, {
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    signal: controller.signal,
  });
  const frames: Frame[] = [];
  let ended = false;
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const read = await reader?.read();
        if (read === undefined || read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          const raw = buffer.slice(0, end).replace(/^\n+/, '');
          buffer = buffer.slice(end + 2);
          if (raw !== '') {
            const event = /^event: (.*)$/m.exec(raw)?.[1];
            const data = /^data: (.*)$/m.exec(raw)?.[1] ?? '';
            frames.push({ event, data });
          }
          end = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Aborted by the case itself.
    }
    ended = true;
  })();
  const stream: OpenStream = {
    frames,
    ended: () => ended,
    close: () => controller.abort(),
    events: () =>
      frames.filter((frame) => frame.event === undefined).map((frame) => JSON.parse(frame.data)),
    errors: () =>
      frames
        .filter((frame) => frame.event === 'serialized-error')
        .map((frame) => JSON.parse(frame.data) as Record<string, unknown>),
  };
  // Opened once the server's first frame is in (or the stream ended at once).
  await vi.waitFor(() => expect(frames.length > 0 || ended).toBe(true));
  return stream;
}

async function call(path: string, bearer: string, input: unknown): Promise<number> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(input),
  });
  await response.arrayBuffer();
  return response.status;
}

/** The registry's lines written since `from`: its own fields only. */
function endedLines(from: number): Array<Record<string, unknown>> {
  return lines
    .slice(from)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record['msg'] === 'A live stream was ended by the server')
    .map(({ level, time, pid, hostname, msg, ...own }) => {
      void [level, time, pid, hostname, msg];
      return own;
    });
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe('who may open the live channel (T063, FR-428)', () => {
  it('refuses an anonymous caller UNAUTHENTICATED, and opens no stream', async () => {
    const stream = await open(null);
    await vi.waitFor(() => expect(stream.ended()).toBe(true));
    expect(stream.errors().map((error) => error['code'])).toEqual(['UNAUTHENTICATED']);
    expect(registry.count()).toBe(0);
  });

  it('refuses a suspended account ACCOUNT_RESTRICTED, as every user kind refuses it', async () => {
    const stream = await open('suspended');
    await vi.waitFor(() => expect(stream.ended()).toBe(true));
    expect(stream.errors()).toEqual([
      expect.objectContaining({
        code: 'ACCOUNT_RESTRICTED',
        details: [{ path: 'accountStatus', code: 'suspended' }],
      }),
    ]);
    expect(registry.count(SUSPENDED)).toBe(0);
  });

  it('refuses an open over rate_limit_live_channel RATE_LIMITED, saying when to try again', async () => {
    counter.refuseLive = true;
    try {
      const stream = await open('c-phone');
      await vi.waitFor(() => expect(stream.ended()).toBe(true));
      expect(stream.errors()).toEqual([
        expect.objectContaining({
          code: 'RATE_LIMITED',
          details: [{ path: 'retryAfterSeconds', code: '31' }],
        }),
      ]);
      expect(registry.count(C)).toBe(0);
    } finally {
      counter.refuseLive = false;
    }
  });

  it('refuses a token in the URL: connectionParams never reach the surface', async () => {
    const params = encodeURIComponent(JSON.stringify({ token: 'a-phone' }));
    const response = await fetch(`${origin}/trpc/live.events?connectionParams=${params}`);
    expect(response.status).toBe(400);
    await response.arrayBuffer();
    expect(registry.count(A)).toBe(0);
  });
});

describe('what a stream carries (T063, FR-427)', () => {
  it('answers Server-Sent Events, its socket closed when it ends', async () => {
    const response = await fetch(`${origin}/trpc/live.events`, {
      headers: { authorization: 'Bearer c-phone' },
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('connection')).toBe('close');
    await response.body?.cancel();
    await vi.waitFor(() => expect(registry.count(C)).toBe(0));
  });

  it('sends an event addressed to A to A’s streams only, never to C’s', async () => {
    const phone = await open('a-phone');
    const tablet = await open('a-tablet');
    const other = await open('c-phone');

    expect(await call('/trpc/fixture.poke', 'c-phone', { to: [A] })).toBe(200);

    await vi.waitFor(() => expect(phone.events()).toEqual([sessionSignal]));
    await vi.waitFor(() => expect(tablet.events()).toEqual([sessionSignal]));
    await settle();
    expect(other.events()).toEqual([]);
    for (const stream of [phone, tablet, other]) stream.close();
    await vi.waitFor(() => expect(registry.count()).toBe(0));
  });

  it('sends nothing when the user-kind call throws, nor when the administrator’s transaction rolls back', async () => {
    const phone = await open('a-phone');

    expect(await call('/trpc/fixture.poke', 'c-phone', { to: [A], throws: true })).toBe(409);
    const before = committed;
    expect(await call('/admin/trpc/restrict', 'admin', { userId: A, rollBack: true })).toBe(409);
    expect(committed).toBe(before);

    await settle();
    expect(phone.events()).toEqual([]);
    expect(phone.ended()).toBe(false);
    phone.close();
    await vi.waitFor(() => expect(registry.count()).toBe(0));
  });

  it('never sends an event that does not parse, and logs no payload of it', async () => {
    const from = lines.length;
    const phone = await open('a-phone');

    expect(await call('/trpc/fixture.poke', 'c-phone', { to: [A], invalid: true })).toBe(200);
    expect(await call('/trpc/fixture.poke', 'c-phone', { to: [A] })).toBe(200);

    await vi.waitFor(() => expect(phone.events()).toEqual([sessionSignal]));
    expect(lines.slice(from).join('\n')).not.toContain('a message body');
    phone.close();
    await vi.waitFor(() => expect(registry.count()).toBe(0));
  });
});

describe('what ends a stream (T063, FR-428, FR-429)', () => {
  it('ends the oldest when a fourth opens, writing one { userId, reason } line', async () => {
    const from = lines.length;
    const oldest = await open('a-phone');
    const second = await open('a-tablet');
    const third = await open('a-laptop');

    const fourth = await open('a-fourth');

    await vi.waitFor(() => expect(oldest.ended()).toBe(true));
    expect(oldest.frames.at(-1)?.event).toBe('return');
    expect(registry.count(A)).toBe(3);
    expect(endedLines(from)).toEqual([{ userId: A, reason: 'connection_cap' }]);
    for (const stream of [second, third, fourth]) stream.close();
    await vi.waitFor(() => expect(registry.count()).toBe(0));
  });

  it('ends a stream whose queue overflows, writing one { userId, reason } line', async () => {
    const from = lines.length;
    const phone = await open('a-phone');

    // One call adds more events than a stream holds, all sent at once on its resolve.
    expect(
      await call('/trpc/fixture.poke', 'c-phone', { to: [A], count: LIVE_STREAM_QUEUE_BOUND + 1 }),
    ).toBe(200);

    await vi.waitFor(() => expect(phone.ended()).toBe(true));
    expect(registry.count(A)).toBe(0);
    expect(endedLines(from)).toEqual([{ userId: A, reason: 'queue_overflow' }]);
  });

  it('a suspension’s `account` reaches the person’s every stream, then ends them: one account_restricted line each', async () => {
    const from = lines.length;
    const phone = await open('a-phone');
    const tablet = await open('a-tablet');
    const other = await open('c-phone');

    expect(await call('/admin/trpc/restrict', 'admin', { userId: A })).toBe(200);

    for (const stream of [phone, tablet]) {
      await vi.waitFor(() => expect(stream.ended()).toBe(true));
      expect(stream.events()).toEqual([{ type: 'account' }]);
    }
    expect(other.ended()).toBe(false);
    expect(endedLines(from)).toEqual([
      { userId: A, reason: 'account_restricted' },
      { userId: A, reason: 'account_restricted' },
    ]);
    other.close();
    await vi.waitFor(() => expect(registry.count()).toBe(0));
  });

  it('a deletion’s `account`, published after its commit, ends the person’s streams', async () => {
    const phone = await open('a-phone');

    bus.publish({ to: [A], event: { type: 'account' } });

    await vi.waitFor(() => expect(phone.ended()).toBe(true));
    expect(phone.events()).toEqual([{ type: 'account' }]);
  });

  it('a sign-out ends that sign-in session’s streams only, writing no line', async () => {
    const from = lines.length;
    const phone = await open('a-phone');
    const tablet = await open('a-tablet');

    expect(await call('/trpc/auth.signOut', 'a-phone', {})).toBe(200);

    await vi.waitFor(() => expect(phone.ended()).toBe(true));
    expect(phone.events()).toEqual([{ type: 'account' }]);
    await settle();
    expect(tablet.ended()).toBe(false);
    expect(endedLines(from)).toEqual([]);
    tablet.close();
    await vi.waitFor(() => expect(registry.count()).toBe(0));
  });

  it('ends a stream when the access token it opened with expires, writing no line', async () => {
    const from = lines.length;
    const short = await open('short');
    expect(short.ended()).toBe(false);

    await vi.waitFor(() => expect(short.ended()).toBe(true), { timeout: 8_000 });
    expect(registry.count(SHORT)).toBe(0);
    expect(endedLines(from)).toEqual([]);
  }, 15_000);

  it('writes no token and no event payload in any line', () => {
    const written = lines.join('\n');
    for (const bearer of Object.keys(bearers)) {
      expect(written).not.toContain(`Bearer ${bearer}`);
    }
    expect(written).not.toContain(ENROLLMENT);
    expect(written).not.toContain(SESSION);
  });
});

describe('shutdown with streams open (T063, FR-429, the owner’s hard condition)', () => {
  it('completes without waiting on a stream, writing one { streamsEnded } line with the count', async () => {
    const from = lines.length;
    const streams = [await open('a-phone'), await open('a-tablet'), await open('c-phone')];
    expect(registry.count()).toBe(3);

    const started = performance.now();
    stopped = true;
    await apiStopSequence({ live: registry, application, afterwards: [] })();

    expect(performance.now() - started).toBeLessThan(2_000);
    for (const stream of streams) await vi.waitFor(() => expect(stream.ended()).toBe(true));
    const shutdown = lines
      .slice(from)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => 'streamsEnded' in record);
    expect(shutdown.map((record) => record['streamsEnded'])).toEqual([3]);
  });
});
