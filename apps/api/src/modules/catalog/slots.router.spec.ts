// T019 — the `teacher.slots` namespace as the user surface serves it (app-surface.md "`teacher.slots`
// — catalog"; FR-313, FR-315). Every procedure is the teacher kind admitting an approved teacher
// (drafting before payout verification, FR-315): an anonymous caller is UNAUTHENTICATED, a student
// and an applicant FORBIDDEN, a suspended or banned teacher ACCOUNT_RESTRICTED, and none of them
// reaches the service; an input outside the contract is VALIDATION_FAILED before it does. The
// authorization gate (T028, R-MOBILE-13) reads these cases by path. The list is handed the session's
// gender, with which the service asks the predicate whether the teacher is published (T069, FR-315).
// What the service answers is slots.service.spec.ts's.
import { vi } from 'vitest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { type AppServices, createAppContext, type UserSession } from '../../surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import type { TeacherSlots } from './slots.service.js';
import { slotsRouter } from './slots.router.js';

// T018's packages, which no slot procedure reaches (merged beside T019 in B25).
const unusedPackages = new Proxy(
  {},
  {
    get: () => {
      throw new Error('catalog.packages is not used by the slots router');
    },
  },
) as AppServices['catalog']['packages'];

const CALLER = '0199d0a0-0000-7000-8000-0000000000b1';
const SLOT = '0199d0a0-0000-7000-8000-0000000000d1';
const KEY = 'spec-slot-key-00000001';

const router = createAppRouter({ teacher: createAppRouter({ slots: slotsRouter }) });
const callerFor = createAppCallerFactory(router);

type Standing = 'student' | 'applicant' | 'approved' | 'suspended teacher' | 'banned teacher';

function sessionOf(standing: Standing): UserSession {
  const base = {
    userId: CALLER,
    sessionId: '0199d0a0-0000-7000-8000-0000000000c2',
    gender: 'female' as const,
    preferredLanguage: 'ar' as const,
  };
  if (standing === 'student') return { ...base, role: 'student', accountStatus: 'active' };
  const applicant = standing === 'applicant';
  return {
    ...base,
    role: 'teacher',
    accountStatus:
      standing === 'suspended teacher'
        ? 'suspended'
        : standing === 'banned teacher'
          ? 'banned'
          : 'active',
    teacher: {
      verificationStatus: applicant ? 'pending' : 'approved',
      payoutVerified: false,
      applicationStatus: applicant ? 'in_review' : 'approved',
    },
  };
}

const answered = {
  id: SLOT,
  dayOfWeek: 0,
  startTimeLocal: '23:30',
  durationMinutes: 60,
  timezone: 'Africa/Cairo',
  isActive: true,
  state: 'free',
} as const;

let calls: unknown[][];
let slots: TeacherSlots;
beforeEach(() => {
  calls = [];
  slots = {
    list: async (...args) => {
      calls.push(['list', ...args]);
      return { published: false, timezone: 'Africa/Cairo', slots: [answered] };
    },
    create: async (...args) => {
      calls.push(['create', ...args]);
      return answered;
    },
    update: async (...args) => {
      calls.push(['update', ...args]);
      return { ...answered, isActive: false, state: 'disabled' };
    },
  };
});

function as(session: UserSession | null) {
  const services: AppServices = {
    settings: { read: async () => Promise.reject(new Error('no setting in this spec')) },
    publicConfig: { supportEmail: 'support@ijazah.invalid' },
    subjects: { listActive: async () => [] },
    identity: unusedIdentityServices,
    verification: unusedVerificationServices,
    teacherProfile: unusedTeacherProfileServices,
    discovery: unusedDiscoveryServices,
    booking: unusedBookingServices,
    checkout: unusedCheckoutServices,
    sessions: unusedSessionsServices,
    catalog: { slots, packages: unusedPackages },
  };
  return callerFor(
    createAppContext({
      session,
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
      rateLimiter: { check: vi.fn(async () => undefined) } as unknown as RateLimiter,
      clientAddress: '203.0.113.9',
      services,
    }),
  );
}

type Caller = ReturnType<typeof as>;

function procedures(caller: Caller) {
  return {
    'teacher.slots.list': () => caller.teacher.slots.list(),
    'teacher.slots.create': () =>
      caller.teacher.slots.create({
        dayOfWeek: 0,
        startTimeLocal: '23:30',
        durationMinutes: 60,
        idempotencyKey: KEY,
      }),
    'teacher.slots.update': () => caller.teacher.slots.update({ slotId: SLOT, isActive: false }),
  };
}

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

/** The code the HTTP application answers a refused call with (the kernel's error filter, R-API-8). */
async function codeOf(call: Promise<unknown>): Promise<unknown> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('the namespace', () => {
  it("refuses an anonymous caller UNAUTHENTICATED: 'teacher.slots.list', 'teacher.slots.create', 'teacher.slots.update'", async () => {
    for (const [path, call] of Object.entries(procedures(as(null)))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses a student FORBIDDEN: 'teacher.slots.list', 'teacher.slots.create', 'teacher.slots.update'", async () => {
    for (const [path, call] of Object.entries(procedures(as(sessionOf('student'))))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses an applicant FORBIDDEN, since slots follow approval: 'teacher.slots.list', 'teacher.slots.create', 'teacher.slots.update'", async () => {
    for (const [path, call] of Object.entries(procedures(as(sessionOf('applicant'))))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(calls).toEqual([]);
  });

  it("refuses a suspended or a banned teacher ACCOUNT_RESTRICTED: 'teacher.slots.list', 'teacher.slots.create', 'teacher.slots.update'", async () => {
    for (const standing of ['suspended teacher', 'banned teacher'] as const) {
      for (const [path, call] of Object.entries(procedures(as(sessionOf(standing))))) {
        await expect(call(), path).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(calls).toEqual([]);
  });
});

describe('an approved teacher, payout verified or not (FR-315)', () => {
  it("hands 'teacher.slots.list', 'teacher.slots.create' and 'teacher.slots.update' the caller's id and the input", async () => {
    const caller = as(sessionOf('approved'));
    await expect(caller.teacher.slots.list()).resolves.toEqual({
      published: false,
      timezone: 'Africa/Cairo',
      slots: [answered],
    });
    await expect(
      caller.teacher.slots.create({
        dayOfWeek: 0,
        startTimeLocal: '23:30',
        durationMinutes: 60,
        idempotencyKey: KEY,
      }),
    ).resolves.toEqual(answered);
    await expect(caller.teacher.slots.update({ slotId: SLOT, isActive: false })).resolves.toEqual({
      ...answered,
      isActive: false,
      state: 'disabled',
    });
    expect(calls).toEqual([
      ['list', CALLER, 'female'],
      [
        'create',
        CALLER,
        { dayOfWeek: 0, startTimeLocal: '23:30', durationMinutes: 60, idempotencyKey: KEY },
      ],
      ['update', CALLER, { slotId: SLOT, isActive: false }],
    ]);
  });

  it("lists with the session's gender, whichever it is: 'teacher.slots.list'", async () => {
    await as(sessionOf('approved')).teacher.slots.list();
    await as({ ...sessionOf('approved'), gender: 'male' }).teacher.slots.list();
    expect(calls).toEqual([
      ['list', CALLER, 'female'],
      ['list', CALLER, 'male'],
    ]);
  });

  it("refuses a length, a start or a day outside the contract VALIDATION_FAILED: 'teacher.slots.create', 'teacher.slots.update'", async () => {
    const caller = as(sessionOf('approved'));
    const create = {
      dayOfWeek: 0,
      startTimeLocal: '23:30',
      durationMinutes: 60,
      idempotencyKey: KEY,
    };
    for (const bad of [
      { durationMinutes: 50 },
      { startTimeLocal: '23:30:00' },
      { startTimeLocal: '2026-11-08T21:30:00Z' },
      { dayOfWeek: 7 },
    ]) {
      expect(await codeOf(caller.teacher.slots.create({ ...create, ...bad } as never))).toBe(
        'VALIDATION_FAILED',
      );
      expect(await codeOf(caller.teacher.slots.update({ slotId: SLOT, ...bad } as never))).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(
      await codeOf(caller.teacher.slots.update({ slotId: 'not-a-uuid', isActive: true })),
    ).toBe('VALIDATION_FAILED');
    expect(calls).toEqual([]);
  });
});
