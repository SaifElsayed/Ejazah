// T070 of specs/004-sessions (FR-503; SRS FR-CANCEL-9, DEC-69; contracts/admin-surface.md,
// `enrollments.releaseSlot`; contracts/kernel.md, the release's row) — an administrator releases the
// slot a closed enrollment holds through its window, over a recorded store. The locks in kernel.md's
// order (`lockKey('teacher-slots')`, the slot, the enrollment), the enrollment read again under them;
// a restorable closing inside its window released (`slot_released_at` and one `slot_released` row,
// both the database's instant), each closing's window read from its kind's setting; each refusal
// (`CONFLICT` `slot_not_held`: not closed, not restorable, the hold over, already released; and
// `NOT_FOUND`) writing nothing, with one info line of ids and a reason, never the administrator's
// text; the call keyed through `runOn` (scope `enrollments.releaseSlot`, the input without its key), a
// replay answered as recorded and writing nothing. The kernel's replay and `CONFLICT` on another
// input, and the race with a hold, are `tests/db-integrity/slot-hold.spec.ts`'.
import { addDays } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { EnrollmentCase } from '../moderation/index.js';
import {
  createHeldSlotRelease,
  type HeldEnrollment,
  type SlotReleaseStore,
} from './slot-release.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000e01';
const TEACHER = '0199d0a0-0000-7000-8000-000000000902';
const SLOT = '0199d0a0-0000-7000-8000-000000000903';
const CASE = '0199d0a0-0000-7000-8000-000000000c01';
const KEY = 'release-attempt-0000001';
const REASON = 'الطالب لن يعود، والموعد مطلوب لغيره';
/** The database's clock at the release. */
const NOW = new Date('2026-11-13T09:00:00Z');
const SETTINGS: Record<string, number> = {
  enrollment_restore_window_days: 14,
  ban_restore_window_days: 5,
};

const daysBefore = (days: number) => new Date(addDays(NOW, -days));

const enrollment = (overrides: Partial<HeldEnrollment> = {}): HeldEnrollment => ({
  id: ENROLLMENT,
  teacherUserId: TEACHER,
  slotId: SLOT,
  status: 'cancelled',
  confirmedAt: new Date('2026-10-01T09:00:00Z'),
  cancellationReason: 'admin',
  slotReleasedAt: null,
  ...overrides,
});

const endCase = (
  reason: string,
  createdAt = daysBefore(3),
  status: EnrollmentCase['status'] = 'open',
): EnrollmentCase => ({ caseId: CASE, reason, status, createdAt });

interface WorldOptions {
  /** What the read with no lock sees; the read under the locks sees `locked` when given. */
  readonly seen?: HeldEnrollment | null;
  readonly locked?: HeldEnrollment | null;
  readonly cases?: readonly EnrollmentCase[];
  readonly replayed?: boolean;
}

function world(options: WorldOptions = {}) {
  const calls: string[] = [];
  const writes: unknown[][] = [];
  const lines: Record<string, unknown>[] = [];
  const keyed: unknown[] = [];
  const settingsRead: string[] = [];
  const seen = options.seen === undefined ? enrollment() : options.seen;
  const locked = options.locked === undefined ? seen : options.locked;
  let reads = 0;
  const store: SlotReleaseStore = {
    enrollmentOf: async (_tx, id) => {
      calls.push(`read ${id}`);
      reads += 1;
      return reads === 1 ? seen : locked;
    },
    lockTeacherSlots: async (_tx, teacherUserId) => void calls.push(`key ${teacherUserId}`),
    lockSlot: async (_tx, slotId) => void calls.push(`slot ${slotId}`),
    lockEnrollment: async (_tx, id) => void calls.push(`enrollment ${id}`),
    casesOf: async (_tx, id) => {
      calls.push(`cases ${id}`);
      return [...(options.cases ?? [endCase('student_fault_confirmed')])];
    },
    markReleased: async (_tx, id, at) => {
      writes.push(['markReleased', id, at]);
      return true;
    },
    recordEvents: async (_tx, outcomes) => void writes.push(['recordEvents', outcomes]),
  };
  const settings: SettingsReader = {
    read: async (key, schema) => {
      settingsRead.push(key);
      return schema.parse(SETTINGS[key]);
    },
  };
  const release = createHeldSlotRelease({
    idempotency: {
      runOn: (async (
        _tx: Transaction,
        request: unknown,
        effect: (keyedTx: Transaction) => Promise<unknown>,
      ) => {
        keyed.push(request);
        if (options.replayed === true) {
          return {
            outcome: { enrollmentId: ENROLLMENT, slotReleasedAt: NOW.toISOString() },
            replayed: true,
          };
        }
        return { outcome: await effect(tx), replayed: false };
      }) as never,
    },
    settings,
    log: {
      info: ((fields: Record<string, unknown>, msg: string) =>
        void lines.push({ ...fields, msg })) as never,
    },
    clock: async () => NOW,
    store,
  });
  return {
    calls,
    writes,
    lines,
    keyed,
    settingsRead,
    releaseSlot: () =>
      release.releaseSlot(tx, ADMIN, {
        enrollmentId: ENROLLMENT,
        reason: REASON,
        idempotencyKey: KEY,
      }),
  };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a refusal');
  return thrown;
}

describe('enrollments.releaseSlot, the release (FR-503; SRS FR-CANCEL-9)', () => {
  it('locks the teacher’s slots key, the slot and the enrollment in that order, reads it again under them, and releases', async () => {
    const { calls, writes, lines, releaseSlot } = world();
    const { answer, replayed } = await releaseSlot();
    expect(replayed).toBe(false);
    expect(answer).toEqual({ enrollmentId: ENROLLMENT, slotReleasedAt: NOW.toISOString() });
    expect(calls).toEqual([
      `read ${ENROLLMENT}`,
      `key ${TEACHER}`,
      `slot ${SLOT}`,
      `enrollment ${ENROLLMENT}`,
      `read ${ENROLLMENT}`,
      `cases ${ENROLLMENT}`,
    ]);
    expect(writes).toEqual([
      ['markReleased', ENROLLMENT, NOW],
      ['recordEvents', [{ kind: 'slot_released', enrollmentId: ENROLLMENT, occurredAt: NOW }]],
    ]);
    expect(lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        caseId: CASE,
        kind: 'student_fault_confirmed',
        msg: 'A held slot was released',
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(REASON);
  });

  it.each<[string, HeldEnrollment, EnrollmentCase, string]>([
    [
      'a complaint’s',
      enrollment({ status: 'terminated_no_show', cancellationReason: null }),
      endCase('absence_termination', daysBefore(13)),
      'enrollment_restore_window_days',
    ],
    ['a ban’s', enrollment(), endCase('student_banned', daysBefore(4)), 'ban_restore_window_days'],
    [
      'a teacher’s ban or revocation',
      enrollment({ cancellationReason: 'teacher_suspended' }),
      endCase('teacher_ended', daysBefore(4)),
      'ban_restore_window_days',
    ],
  ])('releases %s closing inside its own window', async (_name, closed, closing, setting) => {
    const { writes, settingsRead, releaseSlot } = world({ seen: closed, cases: [closing] });
    await releaseSlot();
    expect(writes).toHaveLength(2);
    expect(settingsRead).toEqual([setting]);
  });

  it('keys the call through runOn on the call’s transaction, scope enrollments.releaseSlot, the input without its key', async () => {
    const { keyed, releaseSlot } = world();
    await releaseSlot();
    expect(keyed).toEqual([
      {
        scope: 'enrollments.releaseSlot',
        key: KEY,
        actorId: ADMIN,
        input: { enrollmentId: ENROLLMENT, reason: REASON },
      },
    ]);
  });

  it('answers a replay its recorded answer and writes nothing', async () => {
    const { writes, calls, releaseSlot } = world({ replayed: true });
    expect(await releaseSlot()).toEqual({
      answer: { enrollmentId: ENROLLMENT, slotReleasedAt: NOW.toISOString() },
      replayed: true,
    });
    expect(writes).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('each refusal writes nothing (CONFLICT slot_not_held, NOT_FOUND)', () => {
  it.each<[string, string, WorldOptions]>([
    [
      'a confirmed enrollment',
      'not_closed',
      { seen: enrollment({ status: 'confirmed', cancellationReason: null }) },
    ],
    [
      'a cancellation no payment confirmed',
      'not_closed',
      { seen: enrollment({ confirmedAt: null, cancellationReason: 'payment_expired' }) },
    ],
    [
      'a completed enrollment',
      'not_closed',
      { seen: enrollment({ status: 'completed', cancellationReason: null }) },
    ],
    [
      'a deletion’s closing',
      'not_restorable',
      {
        seen: enrollment({ cancellationReason: 'account_deleted' }),
        cases: [endCase('teacher_ended')],
      },
    ],
    [
      'a gender correction’s closing',
      'not_restorable',
      {
        seen: enrollment({ cancellationReason: 'gender_correction' }),
        cases: [endCase('teacher_ended')],
      },
    ],
    [
      'a closing whose case is closed',
      'not_restorable',
      { cases: [endCase('student_fault_confirmed', daysBefore(1), 'dismissed')] },
    ],
    ['a closing with no end case', 'not_restorable', { cases: [] }],
    [
      'a fault’s closing past its window',
      'hold_over',
      { cases: [endCase('student_fault_confirmed', daysBefore(14))] },
    ],
    [
      'a ban’s closing past the ban window',
      'hold_over',
      { cases: [endCase('student_banned', daysBefore(5))] },
    ],
    [
      'a slot already released',
      'already_released',
      { seen: enrollment({ slotReleasedAt: daysBefore(1) }) },
    ],
    [
      'a slot released while the call waited on the locks (read again under them)',
      'already_released',
      { seen: enrollment(), locked: enrollment({ slotReleasedAt: NOW }) },
    ],
  ])('refuses %s CONFLICT slot_not_held (%s)', async (_name, reason, options) => {
    const { writes, lines, releaseSlot } = world(options);
    const refusal = await refusalOf(releaseSlot());
    expect(refusal.code).toBe('CONFLICT');
    expect(refusal.details).toEqual([{ path: 'cause', code: 'slot_not_held' }]);
    expect(writes).toEqual([]);
    expect(lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        errorCode: 'CONFLICT',
        cause: 'slot_not_held',
        reason,
        msg: 'A held slot release was refused',
      },
    ]);
  });

  it('refuses an enrollment that does not exist NOT_FOUND, locking and writing nothing', async () => {
    const { writes, lines, calls, releaseSlot } = world({ seen: null });
    expect((await refusalOf(releaseSlot())).code).toBe('NOT_FOUND');
    expect(calls).toEqual([`read ${ENROLLMENT}`]);
    expect(writes).toEqual([]);
    expect(lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        errorCode: 'NOT_FOUND',
        cause: 'not_found',
        msg: 'A held slot release was refused',
      },
    ]);
  });
});
