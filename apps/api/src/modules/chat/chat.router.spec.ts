// T037 of specs/004-sessions — `chat.list` and `chat.send` as the user surface serves them
// (contracts/app-surface.md, "`chat`"; contracts/README.md, "Callers"; FR-488, FR-491).
//
// Both are the participant kind: an anonymous caller is UNAUTHENTICATED and a suspended or banned
// account, student or teacher, ACCOUNT_RESTRICTED, none of them reaching the service. The service
// is handed the caller's own account and the validated input, never anything else the input says
// (R-GENDER-4); what it answers is parsed by the output schema, which strips any field it does not
// name (no storage key, no sender id); its NOT_FOUND reaches the client with no field. `chat.send`
// is counted under its own limit, `rate_limit_chat_message`, per caller (FR-491); `chat.list`
// under the signed-in default. The authorization gate (R-MOBILE-13) reads these cases by path.
// What the service decides is chat.service.spec.ts'.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type RateLimiter,
  SIGNED_IN_DEFAULT_RATE_LIMIT,
} from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { CHAT_MESSAGE_RATE_LIMIT, chatRouter } from './chat.router.js';
import type { ChatServices } from './chat.service.js';

const CALLER = '0199d0a0-0000-7000-8000-00000000d001';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000d0e1';
const NOWHERE = '0199d0a0-0000-7000-8000-00000000d0ff';
const MESSAGE = '0199d0a0-0000-7000-8000-00000000d0f1';
const KEY = 'chat-send-key-0199d0a0';

const surfaceRouter = createAppRouter({ chat: chatRouter });
const callerFor = createAppCallerFactory(surfaceRouter);
type Caller = ReturnType<typeof callerFor>;

type Who =
  | 'student'
  | 'teacher'
  | 'suspended student'
  | 'banned student'
  | 'suspended teacher'
  | 'banned teacher';

function sessionOf(who: Who): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-00000000d0f9',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  const accountStatus = who.startsWith('suspended')
    ? 'suspended'
    : who.startsWith('banned')
      ? 'banned'
      : 'active';
  if (who.endsWith('teacher')) {
    return {
      ...base,
      role: 'teacher',
      accountStatus,
      teacher: {
        verificationStatus: accountStatus === 'active' ? 'approved' : accountStatus,
        payoutVerified: true,
        applicationStatus: 'approved',
      },
    };
  }
  return { ...base, role: 'student', accountStatus };
}

const item = {
  messageId: MESSAGE,
  mine: true,
  body: 'السلام عليكم',
  sentAt: '2026-11-11T10:00:00.000Z',
  purged: false,
};

let calls: unknown[][];
let limited: unknown[][];

const chat: ChatServices = {
  list: async (caller, input) => {
    calls.push(['list', caller, input]);
    if (input.enrollmentId !== ENROLLMENT) throw new DomainError('NOT_FOUND');
    // Fields no schema names, as a careless service might add them: stripped.
    return {
      messages: [{ ...item, senderUserId: CALLER, attachmentKey: 'chat/x.pdf' }],
      nextCursor: MESSAGE,
    } as never;
  },
  send: async (caller, input) => {
    calls.push(['send', caller, input]);
    if (input.enrollmentId !== ENROLLMENT) throw new DomainError('NOT_FOUND');
    return { ...item, body: input.body, senderUserId: CALLER } as never;
  },
};

beforeEach(() => {
  calls = [];
  limited = [];
});

function callerAs(session: UserSession | null): Caller {
  const services = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    catalog: unusedCatalogServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    chat,
  } satisfies AppServices;
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const rateLimiter = {
    check: vi.fn(async (...args: unknown[]) => {
      limited.push(args);
    }),
  } as unknown as RateLimiter;
  return callerFor(
    createAppContext({ session, log, rateLimiter, clientAddress: '203.0.113.9', services }),
  );
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

/** The kernel's one shape of what `call` threw. */
async function shapeOf(call: Promise<unknown>): Promise<ReturnType<typeof toErrorShape>> {
  const thrown: unknown = await call.catch((error: unknown) => error);
  return toErrorShape(thrown as Parameters<typeof toErrorShape>[0]);
}

const procedures = {
  'chat.list': (caller: Caller, enrollmentId = ENROLLMENT) => caller.chat.list({ enrollmentId }),
  'chat.send': (caller: Caller, enrollmentId = ENROLLMENT) =>
    caller.chat.send({ enrollmentId, body: 'السلام عليكم', idempotencyKey: KEY }),
} as const;

describe("'chat.list' (T037)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'chat.list'", async () => {
    await expect(procedures['chat.list'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it.each(['suspended student', 'banned student', 'suspended teacher', 'banned teacher'] as const)(
    "refuses a %s ACCOUNT_RESTRICTED before the service: 'chat.list'",
    async (who) => {
      await expect(procedures['chat.list'](callerAs(sessionOf(who)))).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
      expect(calls).toEqual([]);
    },
  );

  it.each(['student', 'teacher'] as const)(
    "hands the service the %s's own account and the enrollment, the answer stripped to the contract: 'chat.list'",
    async (who) => {
      expect(await procedures['chat.list'](callerAs(sessionOf(who)))).toEqual({
        messages: [item],
        nextCursor: MESSAGE,
      });
      expect(calls).toEqual([['list', { userId: CALLER }, { enrollmentId: ENROLLMENT }]]);
    },
  );

  it("answers the service's NOT_FOUND with no field: 'chat.list'", async () => {
    const { status, body } = await shapeOf(
      procedures['chat.list'](callerAs(sessionOf('student')), NOWHERE),
    );
    expect(status).toBe(404);
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  });

  it("refuses an input that is not an enrollment id VALIDATION_FAILED before the service: 'chat.list'", async () => {
    const { body } = await shapeOf(
      callerAs(sessionOf('student')).chat.list({ enrollmentId: 'mine' }),
    );
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(calls).toEqual([]);
  });

  it("is counted under the signed-in default: 'chat.list'", async () => {
    await procedures['chat.list'](callerAs(sessionOf('student')));
    expect(limited.map(([key]) => key)).toEqual([SIGNED_IN_DEFAULT_RATE_LIMIT]);
  });
});

describe("'chat.send' (T037)", () => {
  it("refuses an anonymous caller UNAUTHENTICATED before the service: 'chat.send'", async () => {
    await expect(procedures['chat.send'](callerAs(null))).rejects.toEqual(
      refused('UNAUTHENTICATED'),
    );
    expect(calls).toEqual([]);
  });

  it.each(['suspended student', 'banned student', 'suspended teacher', 'banned teacher'] as const)(
    "refuses a %s ACCOUNT_RESTRICTED before the service: 'chat.send'",
    async (who) => {
      await expect(procedures['chat.send'](callerAs(sessionOf(who)))).rejects.toEqual(
        refused('ACCOUNT_RESTRICTED'),
      );
      expect(calls).toEqual([]);
    },
  );

  it.each(['student', 'teacher'] as const)(
    "hands the service the %s's own account and the input with its key, the answer stripped: 'chat.send'",
    async (who) => {
      expect(await procedures['chat.send'](callerAs(sessionOf(who)))).toEqual(item);
      expect(calls).toEqual([
        [
          'send',
          { userId: CALLER },
          { enrollmentId: ENROLLMENT, body: 'السلام عليكم', idempotencyKey: KEY },
        ],
      ]);
    },
  );

  it("answers the service's NOT_FOUND with no field: 'chat.send'", async () => {
    const { status, body } = await shapeOf(
      procedures['chat.send'](callerAs(sessionOf('teacher')), NOWHERE),
    );
    expect(status).toBe(404);
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
  });

  it("refuses a blank body VALIDATION_FAILED before the service: 'chat.send'", async () => {
    const { body } = await shapeOf(
      callerAs(sessionOf('student')).chat.send({
        enrollmentId: ENROLLMENT,
        body: '   ',
        idempotencyKey: KEY,
      }),
    );
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(calls).toEqual([]);
  });

  it("is counted under rate_limit_chat_message per caller, not the default: 'chat.send'", async () => {
    await procedures['chat.send'](callerAs(sessionOf('student')));
    expect(CHAT_MESSAGE_RATE_LIMIT).toBe('rate_limit_chat_message');
    expect(limited).toEqual([
      [CHAT_MESSAGE_RATE_LIMIT, { kind: 'user', userId: CALLER }, 'chat.send'],
    ]);
  });
});
