// T013 of specs/005-certification — the administrator surface's `genderFlags` namespace as this
// module's router serves it (contracts/admin-surface.md, `genderFlags.*`; FR-614, FR-615; research
// R-409; the note under T013, Q-G1 (a)). Written before the router, run red against its stub. Every
// procedure is the administrator kind: it refuses an anonymous caller and an unverified second
// factor, reaching no service and writing nothing; the session's administrator is the actor. Reads
// run under the signed-in default limit, mutations under `rate_limit_gender_decision`. The audit
// entries: `gender_flags.listed` on the reader, `gender_flag.viewed`, `.raised` and `.dismissed`
// (the last two with the reason) on the flagged person (`user` + id, never a name), each naming the
// flag in `after: { flagId }` (the review's ruling 3(1)); a replay records none. What the
// actions do is `gender-decisions.service.spec.ts`'s and moderation's.
import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../platform/audit/audit-writer.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import {
  type AdminSession,
  type AdminSurfaceServices,
  createAdminContext,
} from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { genderFlagsAdminRouter } from './gender-flags.router.js';

const ADMIN = '0199d0a0-0000-7000-8000-00000000d1ad';
const FLAG = '0199d0a0-0000-7000-8000-00000000d1f1';
const RAISER = '0199d0a0-0000-7000-8000-00000000d1a1';
const FLAGGED = '0199d0a0-0000-7000-8000-00000000d1a2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000d1e1';
const KEY = 'flag-decision-key-for-the-spec-0002';
const REASON = 'سبب القرار';
const TX = { tx: 'admin' };

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const router = createAdminRouter({ genderFlags: genderFlagsAdminRouter });
const callerFor = createAdminCallerFactory(router);
type Caller = ReturnType<typeof callerFor>;

const ITEM = {
  flagId: FLAG,
  flaggedUserId: FLAGGED,
  raisedByUserId: RAISER,
  reportId: null,
  status: 'open',
  createdAt: '2026-11-18T09:00:00.000Z',
};

// 005:T023 (B49, Q-G1 (b)): the preview is a count and one line per enrollment.
const PREVIEW = {
  count: 1,
  lines: [
    {
      enrollmentId: ENROLLMENT,
      subject: { id: '0199d0a0-0000-7000-8000-00000000d1d1', nameAr: 'التجويد', nameEn: 'Tajweed' },
      sessions: 8,
      counterpart: { userId: RAISER, displayName: null },
    },
  ],
};

function surface({
  replayed = false,
  raiseRefusal,
}: { replayed?: boolean; raiseRefusal?: Error } = {}) {
  const reached: [string, unknown, unknown, unknown][] = [];
  const genderFlags = {
    list: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['list', tx, adminId, input]);
      return { items: [{ ...ITEM, reason: 'not on the list', gender: 'male' }] };
    },
    get: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['get', tx, adminId, input]);
      return {
        ...ITEM,
        reason: REASON,
        resolution: null,
        correctionWouldEnd: PREVIEW,
        gender: 'male',
      };
    },
    raise: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['raise', tx, adminId, input]);
      if (raiseRefusal !== undefined) throw raiseRefusal;
      return { flagId: FLAG, replayed };
    },
    dismiss: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['dismiss', tx, adminId, input]);
      return { flaggedUserId: FLAGGED, replayed };
    },
    // 005:T014.
    correct: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['correct', tx, adminId, input]);
      return { flaggedUserId: FLAGGED, from: 'male', to: 'female', endedEnrollments: 2, replayed };
    },
    // 005:T015.
    fraudBan: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['fraudBan', tx, adminId, input]);
      return {
        flaggedUserId: FLAGGED,
        from: 'female',
        to: 'male',
        accountStatus: 'active',
        replayed,
      };
    },
  };
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'genderFlags' ? genderFlags : Reflect.get(target, name, receiver),
  }) as AdminSurfaceServices;
  const written: AuditRecord[] = [];
  const counted: unknown[][] = [];
  const as = (session: AdminSession | null): Caller =>
    callerFor(
      createAdminContext({
        session,
        log,
        administration: {
          transactions: {
            run: async <T>(work: (tx: typeof TX) => Promise<T>): Promise<T> => work(TX),
          },
          auditWriter: {
            write: async (_tx: typeof TX, record: AuditRecord) => {
              written.push(record);
            },
          },
        } as never,
        services,
        rateLimiter: {
          check: async (key: string, subject: unknown, procedure: string) => {
            counted.push([key, subject, procedure]);
          },
        } as unknown as RateLimiter,
        clientAddress: '203.0.113.9',
      }),
    );
  return {
    reached,
    written,
    counted,
    as,
    verified: () => as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: true }),
  };
}

async function bodyOf(call: Promise<unknown>): Promise<unknown> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body;
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

const calls = {
  'genderFlags.list': (caller: Caller) => caller.genderFlags.list({}),
  'genderFlags.get': (caller: Caller) => caller.genderFlags.get({ flagId: FLAG }),
  'genderFlags.raise': (caller: Caller) =>
    caller.genderFlags.raise({ targetUserId: FLAGGED, reason: REASON, idempotencyKey: KEY }),
  'genderFlags.dismiss': (caller: Caller) =>
    caller.genderFlags.dismiss({ flagId: FLAG, reason: REASON, idempotencyKey: KEY }),
  // 005:T014.
  'genderFlags.correct': (caller: Caller) =>
    caller.genderFlags.correct({ flagId: FLAG, reason: REASON, idempotencyKey: KEY }),
  // 005:T015.
  'genderFlags.fraudBan': (caller: Caller) =>
    caller.genderFlags.fraudBan({ flagId: FLAG, reason: REASON, idempotencyKey: KEY }),
} as const;

type Path = keyof typeof calls;
const PATHS = Object.keys(calls) as Path[];

const limits: Record<Path, string> = {
  'genderFlags.list': 'rate_limit_signed_in_default',
  'genderFlags.get': 'rate_limit_signed_in_default',
  'genderFlags.raise': 'rate_limit_gender_decision',
  'genderFlags.dismiss': 'rate_limit_gender_decision',
  'genderFlags.correct': 'rate_limit_gender_decision',
  'genderFlags.fraudBan': 'rate_limit_gender_decision',
};

describe('the administrator kind', () => {
  it.each(PATHS)(
    '%s refuses an anonymous caller (UNAUTHENTICATED) and an unverified second factor (MFA_REQUIRED), reaching nothing',
    async (path) => {
      const s = surface();
      expect(await codeOf(calls[path](s.as(null)))).toBe('UNAUTHENTICATED');
      expect(
        await codeOf(calls[path](s.as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: false }))),
      ).toBe('MFA_REQUIRED');
      expect(s.reached).toEqual([]);
      expect(s.written).toEqual([]);
    },
  );

  it.each(PATHS)('%s is counted under its limit, the administrator as subject', async (path) => {
    const s = surface();
    await calls[path](s.verified());
    expect(s.counted).toEqual([[limits[path], { kind: 'administrator', adminId: ADMIN }, path]]);
  });
});

describe('genderFlags.list and .get (FR-615)', () => {
  it('lists the open flags unless said, audited on the reader, with no reason and no gender', async () => {
    const s = surface();
    expect(await s.verified().genderFlags.list({})).toEqual({ items: [ITEM] });
    expect(s.reached).toEqual([['list', TX, ADMIN, { status: 'open' }]]);
    expect(s.written).toEqual([
      { action: 'gender_flags.listed', targetType: 'admin', targetId: ADMIN, adminId: ADMIN },
    ]);
  });

  it('opens a flag with the preview, audited on the flagged person, with no gender', async () => {
    const s = surface();
    expect(await s.verified().genderFlags.get({ flagId: FLAG })).toEqual({
      ...ITEM,
      reason: REASON,
      resolution: null,
      correctionWouldEnd: PREVIEW,
    });
    expect(s.written).toEqual([
      {
        action: 'gender_flag.viewed',
        targetType: 'user',
        targetId: FLAGGED,
        after: { flagId: FLAG },
        adminId: ADMIN,
      },
    ]);
  });
});

describe('genderFlags.raise and .dismiss (FR-614, FR-615)', () => {
  it('raises through the service, answers the flag, audited on the person with the reason', async () => {
    const s = surface();
    expect(await calls['genderFlags.raise'](s.verified())).toEqual({ flagId: FLAG });
    expect(s.reached).toEqual([
      ['raise', TX, ADMIN, { targetUserId: FLAGGED, reason: REASON, idempotencyKey: KEY }],
    ]);
    expect(s.written).toEqual([
      {
        action: 'gender_flag.raised',
        targetType: 'user',
        targetId: FLAGGED,
        reason: REASON,
        after: { flagId: FLAG },
        adminId: ADMIN,
      },
    ]);
  });

  it('dismisses through the service, audited on the flagged person with the reason', async () => {
    const s = surface();
    await calls['genderFlags.dismiss'](s.verified());
    expect(s.reached).toEqual([
      ['dismiss', TX, ADMIN, { flagId: FLAG, reason: REASON, idempotencyKey: KEY }],
    ]);
    expect(s.written).toEqual([
      {
        action: 'gender_flag.dismissed',
        targetType: 'user',
        targetId: FLAGGED,
        reason: REASON,
        after: { flagId: FLAG },
        adminId: ADMIN,
      },
    ]);
  });

  it.each(['genderFlags.raise', 'genderFlags.dismiss'] as const)(
    'a replayed %s records no second entry',
    async (path) => {
      const s = surface({ replayed: true });
      await calls[path](s.verified());
      expect(s.reached).toHaveLength(1);
      expect(s.written).toEqual([]);
    },
  );

  it('answers a report about another person CONFLICT report_target_mismatch, auditing nothing', async () => {
    const s = surface({
      raiseRefusal: new DomainError('CONFLICT', undefined, {
        details: [{ path: 'reportId', code: 'report_target_mismatch' }],
      }),
    });
    expect(await bodyOf(calls['genderFlags.raise'](s.verified()))).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'reportId', code: 'report_target_mismatch' }],
    });
    expect(s.written).toEqual([]);
  });

  it('refuses a dismissal with no reason before the service', async () => {
    const s = surface();
    expect(
      await codeOf(
        s.verified().genderFlags.dismiss({ flagId: FLAG, idempotencyKey: KEY } as never),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(s.reached).toEqual([]);
  });
});

// 005:T014 (FR-616; research R-409; the note under T014, Q-G6 (a)): the correction answers how many
// enrollments it ended and nothing else; its audit entry, `gender.corrected` on the person with the
// reason, carries the declared gender before and after (the evidence, Q-G6 (a); never a log line)
// and the flag (ruling 3(1)); a replay records none. Written before the procedure, run red.
describe('genderFlags.correct (FR-616)', () => {
  it('corrects through the service, answers the count, audited on the person with the gender before and after', async () => {
    const s = surface();
    expect(await calls['genderFlags.correct'](s.verified())).toEqual({ endedEnrollments: 2 });
    expect(s.reached).toEqual([
      ['correct', TX, ADMIN, { flagId: FLAG, reason: REASON, idempotencyKey: KEY }],
    ]);
    expect(s.written).toEqual([
      {
        action: 'gender.corrected',
        targetType: 'user',
        targetId: FLAGGED,
        reason: REASON,
        before: { gender: 'male' },
        after: { gender: 'female', flagId: FLAG },
        adminId: ADMIN,
      },
    ]);
  });

  it('a replayed correction records no second entry', async () => {
    const s = surface({ replayed: true });
    await calls['genderFlags.correct'](s.verified());
    expect(s.reached).toHaveLength(1);
    expect(s.written).toEqual([]);
  });
});

// 005:T015 (FR-617; the note under T015, Q-G5 (b), Q-G6 (a)): the fraud ban answers nothing; its
// entry, `gender.fraud_banned` on the person with the reason (so the teacher's standing reason
// reads it), carries the gender and the account status before and after, and the flag; never the
// applicant's note. A replay records none. Written before the procedure, run red.
describe('genderFlags.fraudBan (FR-617)', () => {
  it('bans through the service, audited on the person with the gender and the standing before and after', async () => {
    const s = surface();
    expect(
      await s.verified().genderFlags.fraudBan({
        flagId: FLAG,
        reason: REASON,
        applicantNote: 'تم رفض الطلب',
        idempotencyKey: KEY,
      }),
    ).toBeUndefined();
    expect(s.reached).toEqual([
      [
        'fraudBan',
        TX,
        ADMIN,
        { flagId: FLAG, reason: REASON, applicantNote: 'تم رفض الطلب', idempotencyKey: KEY },
      ],
    ]);
    expect(s.written).toEqual([
      {
        action: 'gender.fraud_banned',
        targetType: 'user',
        targetId: FLAGGED,
        reason: REASON,
        before: { gender: 'female', accountStatus: 'active' },
        after: { gender: 'male', accountStatus: 'banned', flagId: FLAG },
        adminId: ADMIN,
      },
    ]);
  });

  it('a replayed fraud ban records no second entry', async () => {
    const s = surface({ replayed: true });
    await calls['genderFlags.fraudBan'](s.verified());
    expect(s.reached).toHaveLength(1);
    expect(s.written).toEqual([]);
  });
});
