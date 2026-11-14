// T082 of specs/004-sessions/tasks.md — `sessions.endEnrollment`'s rules over a recorded store (FR-513;
// SRS FR-CANCEL-10, DEC-68; contracts/admin-surface.md, `sessions.endEnrollment`; contracts/kernel.md,
// the direct end's row). What the database holds is `tests/db-integrity/enrollment-end.spec.ts`'.
//
// Keyed on the call's transaction (`runOn`, scope `sessions.endEnrollment`, the administrator as
// actor, the input without its key as what was asked). The order inside the transaction (N7): with
// `release` the teacher's slots key and the slot first; the enrollment locked and read again; the
// refusals; `cancel` with the party reason; T004's hand-off with `caseOf` opening the `admin_ended`
// case; with `release` booking's release core; a paused enrollment's `teacher_suspended` case
// closed, covered by the new case; `enrollment` to both parties after the commit; one info line of
// ids, never either text. Each refusal writes nothing, in one info line of ids and its cause marked
// «logged»: `NOT_FOUND`, `CONFLICT` `enrollment_not_confirmed`, `CONFLICT` `complaint_open` naming
// the complaint.
import type { SessionsEndEnrollmentInput } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { LiveMessage } from '../../platform/live/live-bus.js';
import {
  bindToTransaction,
  type LivePublisher,
  RequestLive,
} from '../../platform/live/live-publisher.js';
import { createEnrollmentEnd, type EnrollmentEndStore } from './enrollment-end.service.js';
import type { EnrollmentStatus, EnrollmentTerms } from './enrollment-side.port.js';

const ADMIN = '0199d0a0-0000-7000-8000-00000000a001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000a002';
const TEACHER = '0199d0a0-0000-7000-8000-00000000a003';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000a0e5';
const SLOT = '0199d0a0-0000-7000-8000-00000000a0f1';
const NEW_CASE = '0199d0a0-0000-7000-8000-00000000a0c2';
const COMPLAINT = '0199d0a0-0000-7000-8000-00000000a0c1';
const PAUSED_CASE = '0199d0a0-0000-7000-8000-00000000a0c3';
const SESSION = '0199d0a0-0000-7000-8000-00000000a051';
const REMEDY = '0199d0a0-0000-7000-8000-00000000a052';
const KEY = 'end-attempt-0000000001';
const AT = new Date('2026-11-14T09:00:00Z');
const RELEASED_AT = new Date('2026-11-14T09:00:01Z');
const PARTY_REASON = 'تعذر استمرار الاشتراك';
const INTERNAL_NOTE = 'ملاحظة داخلية لا يراها أحد';

function terms(status: EnrollmentStatus): EnrollmentTerms {
  return {
    id: ENROLLMENT,
    status,
    slotId: SLOT,
    track: 'recitation',
    timezone: 'Africa/Cairo',
    durationMinutes: 60,
    sessionCount: 4,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
  };
}

interface Given {
  /** The enrollment as each read answers it; null for none. */
  readonly reads?: readonly (EnrollmentStatus | null)[];
  readonly complaint?: string;
  readonly cancelled?: boolean;
  readonly pausedCase?: string;
  readonly replayed?: boolean;
  /** What the release core answers. */
  readonly releasedAt?: Date | null;
}

const WRITES = new Set([
  'cancel',
  'cancelRemaining',
  'openEndCase',
  'releaseHeldSlot',
  'closeCase',
]);

function world(given: Given = {}) {
  const calls: unknown[][] = [];
  const lines: Record<string, unknown>[] = [];
  const reads = [...(given.reads ?? ['confirmed', 'confirmed'])];
  const store: EnrollmentEndStore = {
    keyShareAccounts: async (_tx, userIds) => void calls.push(['keyShareAccounts', userIds]),
    lockTeacherSlots: async (_tx, userId) => void calls.push(['lockTeacherSlots', userId]),
    lockSlot: async (_tx, slotId) => void calls.push(['lockSlot', slotId]),
    openComplaintOf: async (_tx, enrollmentId) => {
      calls.push(['openComplaintOf', enrollmentId]);
      return given.complaint ?? null;
    },
    openEndCase: async (_tx, enrollmentId) => {
      calls.push(['openEndCase', enrollmentId]);
      return { caseId: NEW_CASE, opened: true };
    },
    cancelRemaining: async (_tx, enrollmentIds, now, caseOf) => {
      calls.push(['cancelRemaining', enrollmentIds, now]);
      const caseId = await caseOf(ENROLLMENT);
      return {
        cancelledSessionIds: [SESSION],
        handedRemedyIds: [REMEDY],
        lapsedRemedyIds: [],
        caseOf: new Map([[ENROLLMENT, caseId]]),
      };
    },
    pausedCaseOf: async (_tx, enrollmentId) => {
      calls.push(['pausedCaseOf', enrollmentId]);
      return given.pausedCase ?? null;
    },
    closeCase: async (_tx, caseId, closing) => {
      calls.push(['closeCase', caseId, closing]);
      return AT;
    },
  };
  const end = createEnrollmentEnd({
    enrollments: {
      enrollmentFor: async (_tx, id) => {
        calls.push(['enrollmentFor', id]);
        const status = reads.length > 0 ? reads.shift() : 'confirmed';
        return status === null || status === undefined ? null : terms(status);
      },
      lockEnrollments: async (_tx, ids) => void calls.push(['lockEnrollments', ids]),
      cancel: async (_tx, id, reason, partyReason) => {
        calls.push(['cancel', id, reason, partyReason]);
        return given.cancelled ?? true;
      },
      releaseHeldSlot: async (_tx, id) => {
        calls.push(['releaseHeldSlot', id]);
        return given.releasedAt === undefined ? RELEASED_AT : given.releasedAt;
      },
    },
    idempotency: {
      runOn: async (tx, request, effect) => {
        calls.push(['runOn', request]);
        if (given.replayed === true) {
          return {
            outcome: {
              enrollmentId: ENROLLMENT,
              caseId: NEW_CASE,
              slot: 'hold',
              cancelledSessions: 1,
            } as never,
            replayed: true,
          };
        }
        return { outcome: await effect(tx), replayed: false };
      },
    },
    log: {
      info: ((fields: object, msg: string) => void lines.push({ ...fields, msg })) as never,
    },
    clock: async () => {
      calls.push(['clock']);
      return AT;
    },
    store,
  });
  const ask = (
    input: Partial<SessionsEndEnrollmentInput> = {},
    tx: Transaction = {} as Transaction,
  ) =>
    end.endEnrollment(tx, ADMIN, {
      enrollmentId: ENROLLMENT,
      partyReason: PARTY_REASON,
      internalNote: INTERNAL_NOTE,
      slot: 'hold',
      idempotencyKey: KEY,
      ...input,
    });
  const writes = () => calls.filter(([name]) => WRITES.has(String(name)));
  return { calls, lines, ask, writes };
}

async function refusalOf(attempt: Promise<unknown>) {
  const thrown: unknown = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a refusal, got ${String(thrown)}`);
  return { code: thrown.code, details: thrown.details, logged: isRefusalLogged(thrown) };
}

const REQUEST = {
  scope: 'sessions.endEnrollment',
  key: KEY,
  actorId: ADMIN,
  input: {
    enrollmentId: ENROLLMENT,
    partyReason: PARTY_REASON,
    internalNote: INTERNAL_NOTE,
    slot: 'hold',
  },
};

/** No log line carries either text (the owner's rule). */
function textless(lines: readonly Record<string, unknown>[]): boolean {
  const written = JSON.stringify(lines);
  return !written.includes(PARTY_REASON) && !written.includes(INTERNAL_NOTE);
}

describe('sessions.endEnrollment with slot hold (FR-513)', () => {
  it('locks the enrollment, reads it again, cancels it with the party reason and hands its sessions and remedies to the admin_ended case', async () => {
    const one = world();
    expect(await one.ask()).toEqual({
      answer: { enrollmentId: ENROLLMENT, caseId: NEW_CASE, slot: 'hold', cancelledSessions: 1 },
      replayed: false,
    });
    expect(one.calls).toEqual([
      ['runOn', REQUEST],
      ['enrollmentFor', ENROLLMENT],
      ['lockEnrollments', [ENROLLMENT]],
      ['enrollmentFor', ENROLLMENT],
      ['openComplaintOf', ENROLLMENT],
      ['cancel', ENROLLMENT, 'admin', PARTY_REASON],
      ['clock'],
      ['cancelRemaining', [ENROLLMENT], AT],
      ['openEndCase', ENROLLMENT],
      ['pausedCaseOf', ENROLLMENT],
    ]);
    expect(one.lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        caseId: NEW_CASE,
        slot: 'hold',
        cancelledSessions: 1,
        handedRemedies: 1,
        msg: 'An enrollment was ended by an administrator',
      },
    ]);
    expect(textless(one.lines)).toBe(true);
  });

  it('keys the call with the input without its key; a note left out is left out of what was asked', async () => {
    const one = world();
    await one.ask({ internalNote: undefined });
    const { internalNote: _note, ...asked } = REQUEST.input;
    expect(one.calls[0]).toEqual(['runOn', { ...REQUEST, input: asked }]);
  });

  it('answers a replay the first result and runs nothing', async () => {
    const one = world({ replayed: true });
    expect((await one.ask()).replayed).toBe(true);
    expect(one.calls).toEqual([['runOn', REQUEST]]);
    expect(one.lines).toEqual([]);
  });
});

describe('sessions.endEnrollment with slot release (FR-513; T070’s release in the same transaction)', () => {
  it('takes both accounts’ key-share, the teacher’s slots key and the slot before the enrollment, and releases through booking’s core after the hand-off', async () => {
    const one = world();
    expect((await one.ask({ slot: 'release' })).answer).toEqual({
      enrollmentId: ENROLLMENT,
      caseId: NEW_CASE,
      slot: 'release',
      cancelledSessions: 1,
    });
    expect(one.calls.slice(1)).toEqual([
      ['enrollmentFor', ENROLLMENT],
      // Q-E1 (a): both accounts key-shared first, in id order.
      ['keyShareAccounts', [STUDENT, TEACHER].sort()],
      ['lockTeacherSlots', TEACHER],
      ['lockSlot', SLOT],
      ['lockEnrollments', [ENROLLMENT]],
      ['enrollmentFor', ENROLLMENT],
      ['openComplaintOf', ENROLLMENT],
      ['cancel', ENROLLMENT, 'admin', PARTY_REASON],
      ['clock'],
      ['cancelRemaining', [ENROLLMENT], AT],
      ['openEndCase', ENROLLMENT],
      ['releaseHeldSlot', ENROLLMENT],
      ['pausedCaseOf', ENROLLMENT],
    ]);
    expect(one.lines).toEqual([expect.objectContaining({ slot: 'release', caseId: NEW_CASE })]);
  });

  it('throws, as no refusal, when the core does not release the slot it holds', async () => {
    const one = world({ releasedAt: null });
    const thrown: unknown = await one.ask({ slot: 'release' }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(DomainError);
  });
});

describe('sessions.endEnrollment refusals, each writing nothing (FR-513)', () => {
  it('an enrollment that does not exist: NOT_FOUND, no lock', async () => {
    const one = world({ reads: [null] });
    expect(await refusalOf(one.ask())).toEqual({
      code: 'NOT_FOUND',
      details: undefined,
      logged: true,
    });
    expect(one.writes()).toEqual([]);
    expect(one.calls.map(([name]) => name)).toEqual(['runOn', 'enrollmentFor']);
    expect(one.lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        errorCode: 'NOT_FOUND',
        cause: 'not_found',
        msg: 'An enrollment end was refused',
      },
    ]);
  });

  it('gone once locked: NOT_FOUND', async () => {
    const one = world({ reads: ['confirmed', null] });
    expect((await refusalOf(one.ask())).code).toBe('NOT_FOUND');
    expect(one.writes()).toEqual([]);
  });

  it.each<EnrollmentStatus>(['pending_payment', 'completed', 'terminated_no_show', 'cancelled'])(
    'an enrollment %s once locked: CONFLICT enrollment_not_confirmed',
    async (status) => {
      const one = world({ reads: ['confirmed', status] });
      expect(await refusalOf(one.ask())).toEqual({
        code: 'CONFLICT',
        details: [{ path: 'cause', code: 'enrollment_not_confirmed' }],
        logged: true,
      });
      expect(one.writes()).toEqual([]);
      expect(one.lines).toEqual([
        {
          adminId: ADMIN,
          enrollmentId: ENROLLMENT,
          errorCode: 'CONFLICT',
          cause: 'enrollment_not_confirmed',
          msg: 'An enrollment end was refused',
        },
      ]);
    },
  );

  it('a complaint of the teacher’s absence open on it: CONFLICT complaint_open naming the complaint (Q-R6 (a))', async () => {
    const one = world({ complaint: COMPLAINT });
    expect(await refusalOf(one.ask({ slot: 'release' }))).toEqual({
      code: 'CONFLICT',
      details: [
        { path: 'cause', code: 'complaint_open' },
        { path: 'caseId', code: COMPLAINT },
      ],
      logged: true,
    });
    expect(one.writes()).toEqual([]);
    expect(one.lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        caseId: COMPLAINT,
        errorCode: 'CONFLICT',
        cause: 'complaint_open',
        msg: 'An enrollment end was refused',
      },
    ]);
    expect(textless(one.lines)).toBe(true);
  });

  it('a move refused under the lock: CONFLICT enrollment_not_confirmed, nothing after it', async () => {
    const one = world({ cancelled: false });
    expect((await refusalOf(one.ask())).details).toEqual([
      { path: 'cause', code: 'enrollment_not_confirmed' },
    ]);
    expect(one.writes()).toEqual([['cancel', ENROLLMENT, 'admin', PARTY_REASON]]);
  });
});

// T071 (the note under T082, B42a): a paused enrollment's open `teacher_suspended` case is closed the
// same way, covered by the `admin_ended` case.
describe('sessions.endEnrollment on a paused enrollment (T071’s widened U2)', () => {
  it('closes its teacher_suspended case resolved compensation_ordered ended_meanwhile, covered by the new case', async () => {
    const one = world({ pausedCase: PAUSED_CASE });
    await one.ask();
    expect(one.calls.slice(-2)).toEqual([
      ['pausedCaseOf', ENROLLMENT],
      [
        'closeCase',
        PAUSED_CASE,
        {
          status: 'resolved',
          resolution: 'compensation_ordered',
          note: 'ended_meanwhile',
          adminId: ADMIN,
          coveredBy: NEW_CASE,
        },
      ],
    ]);
    expect(one.lines.map(({ msg }) => msg)).toEqual([
      'A paused enrollment’s teacher_suspended case closed by its end',
      'An enrollment was ended by an administrator',
    ]);
    expect(one.lines[0]).toEqual(expect.objectContaining({ end: 'admin_ended' }));
  });
});

/** What the call added to the list, sent or not. */
let added: LiveMessage[] = [];

/** The administrator kind's after-commit point, as `complaint-decision.service.spec.ts` runs it. */
async function asAdministratorKind(
  work: (tx: Transaction) => Promise<unknown>,
  commitFails = false,
): Promise<LiveMessage[]> {
  const published: LiveMessage[] = [];
  const live = new RequestLive(
    { publish: (message) => void published.push(message) },
    { warn: () => undefined },
  );
  const tx = {} as Transaction;
  added = [];
  const recording: LivePublisher = {
    afterCommit: (to, event, scope) => {
      added.push({ to: [...to], event });
      live.afterCommit(to, event, scope);
    },
  };
  const unbind = bindToTransaction(tx, recording);
  try {
    await work(tx);
    if (commitFails) throw new Error('the audit write failed');
    live.flush();
  } catch {
    live.drop();
  } finally {
    unbind();
  }
  return published;
}

describe('sessions.endEnrollment: the live event (T066)', () => {
  it('sends enrollment to both parties once, after the commit', async () => {
    const { ask } = world();
    expect(await asAdministratorKind((tx) => ask({}, tx))).toEqual([
      { to: [STUDENT, TEACHER], event: { type: 'enrollment', enrollmentId: ENROLLMENT } },
    ]);
  });

  it('sends nothing on a refusal or a rollback', async () => {
    const refused = world({ complaint: COMPLAINT });
    expect(await asAdministratorKind((tx) => refused.ask({}, tx))).toEqual([]);
    expect(added).toEqual([]);
    const rolledBack = world();
    expect(await asAdministratorKind((tx) => rolledBack.ask({}, tx), true)).toEqual([]);
  });
});
