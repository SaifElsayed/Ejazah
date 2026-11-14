// T072 of specs/004-sessions/tasks.md (FR-502, FR-503; SRS FR-ADMIN-5 as amended, FR-GENDER-6,
// DEC-69; the note under T072: N1, Q6 (a), Q7 (a), Q9 (a), Q10 (a)): what a lift owes the
// enrollments its ban or revocation closed, over an enrollment side, a store and a restore core
// held in memory. The closings by the one closing rule, the counterparties read with no lock; under
// identity's `users` lock, the teachers' keys ascending, the slots, the enrollments, the sessions and
// the remedies each in one call, each closing read again; then, in id order, the genders compared
// and each enrollment restored through `restoreClosed`, one refused before its first write left
// ended with its cause, one refused after it refusing the whole lift `restore_failed`. And the hold's
// end `users.get` answers. The real rows are `tests/db-integrity/ban-lift.spec.ts`'.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { EnrollmentCase } from '../moderation/index.js';
import { type BanLiftSide, type BanLiftStore, createBanLift } from './ban-lift.service.js';
import type {
  EnrollmentEventEntry,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentTerms,
} from './enrollment-side.port.js';
import type { RestoreSession } from './restore.repository.js';
import type { PartyStanding } from './sessions.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-00000000d0a1';
const STUDENT = '0199d0a0-0000-7000-8000-00000000d051';
const TEACHER_A = '0199d0a0-0000-7000-8000-00000000d0t1';
const TEACHER_B = '0199d0a0-0000-7000-8000-00000000d0t2';
const NOW = new Date('2026-11-13T08:00:00Z');
const OPENED = new Date('2026-11-01T08:00:00Z');

const eid = (n: number) => `0199d0a0-0000-7000-8000-00000000d1${String(n).padStart(2, '0')}`;
const slotOf = (n: number) => `0199d0a0-0000-7000-8000-00000000d2${String(n).padStart(2, '0')}`;

interface Row {
  item: EnrollmentPageItem;
  slotId: string;
  events: EnrollmentEventEntry[];
  cases: EnrollmentCase[];
  sessions: RestoreSession[];
  /** T074 FU4: `confirmed_at` set; false for a checkout abandoned before any payment. */
  confirmed?: boolean;
}

let rows: Map<string, Row>;
/** T074 FU4: each page's filter, and each read of the cases by the enrollments asked. */
let pages: EnrollmentPageFilter[];
let caseReads: (readonly string[])[];
let genders: Map<string, 'male' | 'female'>;
let journal: string[];
let lines: { level: string; fields: Record<string, unknown> }[];
let refusals: Map<string, Error>;
/** A closing that moves under the lock: the enrollment's case closed once the enrollments lock. */
let closesUnderLock: string | undefined;

const banClosing = (n: number, teacher: string, extra: Partial<Row> = {}): Row => ({
  item: {
    enrollmentId: eid(n),
    studentUserId: STUDENT,
    teacherUserId: teacher,
    status: 'cancelled',
    track: 'recitation',
    sessionCount: 4,
    // T074 FU4: the last cancellation's reason and the release, read from the columns.
    cancellationReason: 'admin',
    slotReleasedAt: null,
  },
  slotId: slotOf(n),
  events: [{ kind: 'cancelled', cancellationReason: 'admin', occurredAt: OPENED }],
  cases: [{ caseId: `case-${n}`, reason: 'student_banned', status: 'open', createdAt: OPENED }],
  sessions: [
    {
      id: `s-${n}`,
      sequenceNumber: 1,
      status: 'cancelled_by_admin',
      makeupForSessionId: null,
      scheduledDateLocal: OPENED,
      scheduledStartTimeLocal: OPENED,
      timezone: 'Africa/Cairo',
      remedy: n === 2 ? { id: `r-${n}`, status: 'frozen', kind: 'makeup', caseId: null } : null,
    },
  ],
  ...extra,
});

const teacherClosing = (n: number, student: string): Row => ({
  ...banClosing(n, TEACHER_A),
  item: {
    ...banClosing(n, TEACHER_A).item,
    studentUserId: student,
    cancellationReason: 'teacher_suspended',
  },
  events: [{ kind: 'cancelled', cancellationReason: 'teacher_suspended', occurredAt: OPENED }],
  cases: [{ caseId: `case-${n}`, reason: 'teacher_ended', status: 'open', createdAt: OPENED }],
});

beforeEach(() => {
  rows = new Map();
  genders = new Map([
    [STUDENT, 'female'],
    [TEACHER_A, 'female'],
    [TEACHER_B, 'female'],
  ]);
  journal = [];
  lines = [];
  refusals = new Map();
  closesUnderLock = undefined;
  pages = [];
  caseReads = [];
});

const plant = (...planted: Row[]) => {
  for (const row of planted) rows.set(row.item.enrollmentId, row);
};

const store: BanLiftStore = {
  lockTeacherSlots: async (_tx, id) => void journal.push(`key:${id}`),
  lockSlots: async (_tx, ids) => void journal.push(`slots:${ids.join(',')}`),
  lockSessions: async (_tx, ids) => void journal.push(`sessions:${ids.join(',')}`),
  lockRemedies: async (_tx, ids) => void journal.push(`remedies:${ids.join(',')}`),
  sessionsOf: async (_tx, id) => rows.get(id)?.sessions ?? [],
  casesAmong: async (_tx, ids) => {
    caseReads.push(ids);
    return new Map(ids.map((id) => [id, rows.get(id)?.cases ?? []]));
  },
  partiesOf: async (_tx, ids) =>
    new Map(
      ids.map((id): [string, PartyStanding] => [
        id,
        {
          gender: genders.get(id) ?? 'female',
          accountStatus: 'active',
          teacherApproved: true,
          displayName: 'Probe',
        },
      ]),
    ),
};

const settings: SettingsReader = {
  read: async (key, schema) =>
    schema.parse({ ban_restore_window_days: 14, enrollment_restore_window_days: 7 }[key]),
};

/** A marked refusal stands for one thrown after the restore's first write. */
const afterWrite = new WeakSet<object>();

function lift() {
  return createBanLift({
    enrollments: {
      enrollmentPage: async (_tx, filter) => {
        pages.push(filter);
        return {
          items: [...rows.values()]
            .filter(
              ({ item, confirmed }) =>
                (filter.status === undefined || item.status === filter.status) &&
                (filter.everConfirmed !== true || confirmed !== false) &&
                (filter.enrollmentIds?.includes(item.enrollmentId) ?? true) &&
                (filter.studentUserIds?.includes(item.studentUserId) ?? true) &&
                (filter.teacherUserIds?.includes(item.teacherUserId) ?? true),
            )
            .map(({ item }) => item)
            .sort((one, other) => (one.enrollmentId < other.enrollmentId ? 1 : -1)),
        };
      },
      enrollmentFor: async (_tx, id): Promise<EnrollmentTerms | null> => {
        const row = rows.get(id);
        if (row === undefined) return null;
        return {
          id,
          status: row.item.status,
          slotId: row.slotId,
          track: 'recitation',
          timezone: 'Africa/Cairo',
          durationMinutes: 60,
          sessionCount: 4,
          studentUserId: row.item.studentUserId,
          teacherUserId: row.item.teacherUserId,
        };
      },
      lockEnrollments: async (_tx, ids) => {
        journal.push(`enrollments:${ids.join(',')}`);
        const closing = closesUnderLock === undefined ? undefined : rows.get(closesUnderLock);
        if (closing !== undefined) {
          closing.cases = closing.cases.map((one) => ({ ...one, status: 'dismissed' }));
        }
      },
    },
    restore: {
      restoreClosed: async (_tx, adminId, enrollmentId, now) => {
        journal.push(`restore:${enrollmentId}:${adminId}:${now.toISOString()}`);
        const refusal = refusals.get(enrollmentId);
        if (refusal !== undefined) throw refusal;
        return { restored: true };
      },
    },
    settings,
    log: {
      info: (fields: Record<string, unknown>) => void lines.push({ level: 'info', fields }),
      warn: (fields: Record<string, unknown>) => void lines.push({ level: 'warn', fields }),
    },
    clock: async () => {
      journal.push('clock');
      return NOW;
    },
    refusedAfterWrite: (error) =>
      typeof error === 'object' && error !== null && afterWrite.has(error),
    store,
  });
}

const restoreRefused = (cause: string) =>
  new DomainError('RESTORE_REFUSED', undefined, { details: [{ path: 'cause', code: cause }] });

async function thrownBy(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

const restoredOf = (userId: string, side: BanLiftSide, locked: readonly string[]) =>
  lift().restoreClosed(tx, ADMIN, userId, side, locked);

describe('the closings a lift reads (the one closing rule)', () => {
  it('a student’s: the teachers of the enrollments its ban closed, case open, sorted and once each', async () => {
    plant(
      banClosing(1, TEACHER_B),
      banClosing(2, TEACHER_A),
      banClosing(3, TEACHER_A),
      // A ban's closing whose case was closed: not the lift's.
      banClosing(4, TEACHER_B, {
        item: {
          ...banClosing(4, TEACHER_B).item,
          teacherUserId: '0199d0a0-0000-7000-8000-00000000d0t9',
        },
        cases: [
          { caseId: 'case-4', reason: 'student_banned', status: 'resolved', createdAt: OPENED },
        ],
      }),
      // A complaint's closing: not a ban's.
      banClosing(5, TEACHER_B, {
        item: {
          ...banClosing(5, TEACHER_B).item,
          teacherUserId: '0199d0a0-0000-7000-8000-00000000d0t8',
        },
        cases: [
          {
            caseId: 'case-5',
            reason: 'student_fault_confirmed',
            status: 'open',
            createdAt: OPENED,
          },
        ],
      }),
    );
    expect(await lift().counterpartiesOf(tx, STUDENT, 'student')).toEqual([TEACHER_A, TEACHER_B]);
  });

  it('a teacher’s: the students of the enrollments its ban or revocation closed (teacher_ended)', async () => {
    const other = '0199d0a0-0000-7000-8000-00000000d052';
    plant(teacherClosing(1, other), teacherClosing(2, STUDENT), banClosing(3, TEACHER_A));
    expect(await lift().counterpartiesOf(tx, TEACHER_A, 'teacher')).toEqual(
      [STUDENT, other].sort(),
    );
  });

  it('never a deletion’s closing, its teacher_ended case open', async () => {
    plant({
      ...teacherClosing(1, STUDENT),
      item: { ...teacherClosing(1, STUDENT).item, cancellationReason: 'account_deleted' },
      events: [{ kind: 'cancelled', cancellationReason: 'account_deleted', occurredAt: OPENED }],
    });
    expect(await lift().counterpartiesOf(tx, TEACHER_A, 'teacher')).toEqual([]);
  });
});

describe('restoreClosed: the locks, then each enrollment in id order', () => {
  it('takes the teachers’ keys ascending, the slots, the enrollments, the sessions and the remedies each in one call, reads the clock, then restores in id order', async () => {
    plant(banClosing(2, TEACHER_B), banClosing(1, TEACHER_A), banClosing(3, TEACHER_A));
    const locked = [STUDENT, TEACHER_A, TEACHER_B].sort();
    expect(await restoredOf(STUDENT, 'student', locked)).toEqual([
      { enrollmentId: eid(1), restored: true },
      { enrollmentId: eid(2), restored: true },
      { enrollmentId: eid(3), restored: true },
    ]);
    expect(journal).toEqual([
      `key:${[TEACHER_A, TEACHER_B].sort()[0]}`,
      `key:${[TEACHER_A, TEACHER_B].sort()[1]}`,
      `slots:${[slotOf(1), slotOf(2), slotOf(3)].join(',')}`,
      `enrollments:${[eid(1), eid(2), eid(3)].join(',')}`,
      'sessions:s-1,s-2,s-3',
      'remedies:r-2',
      'clock',
      `restore:${eid(1)}:${ADMIN}:${NOW.toISOString()}`,
      `restore:${eid(2)}:${ADMIN}:${NOW.toISOString()}`,
      `restore:${eid(3)}:${ADMIN}:${NOW.toISOString()}`,
    ]);
    expect(lines).toEqual([
      {
        level: 'info',
        fields: { adminId: ADMIN, userId: STUDENT, side: 'student', restored: 3, refused: 0 },
      },
    ]);
  });

  it('takes no lock and restores nothing when the ban closed nothing', async () => {
    expect(await restoredOf(STUDENT, 'student', [STUDENT])).toEqual([]);
    expect(journal).toEqual([]);
  });

  it('leaves out a closing that moved under the lock (its case closed meanwhile)', async () => {
    plant(banClosing(1, TEACHER_A), banClosing(2, TEACHER_A));
    closesUnderLock = eid(1);
    expect(await restoredOf(STUDENT, 'student', [STUDENT, TEACHER_A].sort())).toEqual([
      { enrollmentId: eid(2), restored: true },
    ]);
  });

  it('throws before any write when a counterparty was not locked, with one warn line of ids', async () => {
    plant(banClosing(1, TEACHER_A));
    const thrown = await thrownBy(restoredOf(STUDENT, 'student', [STUDENT]));
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(DomainError);
    expect(journal.some((entry) => entry.startsWith('restore:'))).toBe(false);
    expect(lines).toEqual([
      {
        level: 'warn',
        fields: {
          adminId: ADMIN,
          userId: STUDENT,
          enrollmentId: eid(1),
          counterpartyId: TEACHER_A,
        },
      },
    ]);
  });
});

describe('restoreClosed: what each enrollment answers (Q7 (a), Q10 (a))', () => {
  it('a pairing whose genders differ is left ended gender_mismatch, never restored, with one line', async () => {
    plant(banClosing(1, TEACHER_A), banClosing(2, TEACHER_B));
    genders.set(TEACHER_A, 'male');
    expect(await restoredOf(STUDENT, 'student', [STUDENT, TEACHER_A, TEACHER_B].sort())).toEqual([
      { enrollmentId: eid(1), restored: false, cause: 'gender_mismatch' },
      { enrollmentId: eid(2), restored: true },
    ]);
    expect(journal.filter((entry) => entry.startsWith('restore:'))).toEqual([
      `restore:${eid(2)}:${ADMIN}:${NOW.toISOString()}`,
    ]);
    expect(lines[0]).toEqual({
      level: 'info',
      fields: { adminId: ADMIN, userId: STUDENT, enrollmentId: eid(1), reason: 'gender_mismatch' },
    });
  });

  it.each(['slot_taken', 'party_restricted', 'time_taken', 'refunded', 'case_closed'])(
    'a restore refused %s before its first write leaves that one ended, and the lift goes on',
    async (cause) => {
      plant(banClosing(1, TEACHER_A), banClosing(2, TEACHER_A));
      refusals.set(eid(1), restoreRefused(cause));
      expect(await restoredOf(STUDENT, 'student', [STUDENT, TEACHER_A].sort())).toEqual([
        { enrollmentId: eid(1), restored: false, cause },
        { enrollmentId: eid(2), restored: true },
      ]);
    },
  );

  it.each([
    [
      'no_free_week',
      new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'no_free_week' }],
      }),
    ],
    ['the exclusion’s time_taken', restoreRefused('time_taken')],
  ])(
    'a restore refused after its first write (%s) refuses the whole lift restore_failed, naming the enrollment, with one line',
    async (_name, refusal) => {
      plant(banClosing(1, TEACHER_A), banClosing(2, TEACHER_A));
      afterWrite.add(refusal);
      refusals.set(eid(2), refusal);
      const thrown = await thrownBy(restoredOf(STUDENT, 'student', [STUDENT, TEACHER_A].sort()));
      expect(thrown).toBeInstanceOf(DomainError);
      expect([
        (thrown as DomainError).code,
        (thrown as DomainError).details,
        isRefusalLogged(thrown),
      ]).toEqual([
        'CONFLICT',
        [
          { path: 'cause', code: 'restore_failed' },
          { path: 'enrollmentId', code: eid(2) },
        ],
        true,
      ]);
      expect(lines).toEqual([
        {
          level: 'info',
          fields: {
            adminId: ADMIN,
            userId: STUDENT,
            enrollmentId: eid(2),
            errorCode: 'CONFLICT',
            reason: 'restore_failed',
          },
        },
      ]);
    },
  );

  it('lets an error that is no refusal through unchanged', async () => {
    plant(banClosing(1, TEACHER_A));
    const boom = new Error('the database went away');
    refusals.set(eid(1), boom);
    expect(await thrownBy(restoredOf(STUDENT, 'student', [STUDENT, TEACHER_A].sort()))).toBe(boom);
  });
});

describe('slotHeldUntilOf: users.get’s enrollmentsSlotHeldUntil (Q9 (a))', () => {
  it('the latest hold end among the held ban closings, each the case’s opening plus ban_restore_window_days', async () => {
    const later = new Date('2026-11-05T08:00:00Z');
    plant(banClosing(1, TEACHER_A), {
      ...banClosing(2, TEACHER_B),
      cases: [{ caseId: 'case-2', reason: 'student_banned', status: 'open', createdAt: later }],
    });
    expect(await lift().slotHeldUntilOf(tx, STUDENT)).toEqual(new Date('2026-11-19T08:00:00Z'));
  });

  it('a teacher’s: its teacher_ended closings', async () => {
    plant(teacherClosing(1, STUDENT));
    expect(await lift().slotHeldUntilOf(tx, TEACHER_A)).toEqual(new Date('2026-11-15T08:00:00Z'));
  });

  it('null for none held: a released slot, a closed case, or no closing', async () => {
    plant(
      {
        ...banClosing(1, TEACHER_A),
        item: { ...banClosing(1, TEACHER_A).item, slotReleasedAt: NOW },
        events: [
          { kind: 'cancelled', cancellationReason: 'admin', occurredAt: OPENED },
          { kind: 'slot_released', occurredAt: NOW },
        ],
      },
      {
        ...banClosing(2, TEACHER_A),
        cases: [
          { caseId: 'case-2', reason: 'student_banned', status: 'dismissed', createdAt: OPENED },
        ],
      },
    );
    expect(await lift().slotHeldUntilOf(tx, STUDENT)).toBeNull();
    expect(await lift().slotHeldUntilOf(tx, '0199d0a0-0000-7000-8000-00000000d0ff')).toBeNull();
  });
});

// T074 FU4 (PR #139's review, round 1, follow-up 4; the note under T074, Q-O3 (a)): the closings are
// read in pages of the enrollments confirmed at some point only (an abandoned or a failed checkout
// is never one), each page's cases in one call of moderation's `compensationCasesAmong`, the last
// cancellation's reason and the release from the enrollment's columns as `slotUses` reads them;
// no enrollment's events read. The answers are unchanged.
describe('the closings read in pages, the cases once per page (T074 FU4)', () => {
  it('asks only the enrollments confirmed at some point; an abandoned checkout is never a closing', async () => {
    plant(banClosing(1, TEACHER_A), {
      ...banClosing(2, TEACHER_B),
      confirmed: false,
      item: { ...banClosing(2, TEACHER_B).item, cancellationReason: 'checkout_abandoned' },
    });
    expect(await lift().counterpartiesOf(tx, STUDENT, 'student')).toEqual([TEACHER_A]);
    expect(pages).toEqual([
      { status: 'cancelled', everConfirmed: true, studentUserIds: [STUDENT] },
    ]);
    expect(caseReads).toEqual([[eid(1)]]);
  });

  it('reads the cases of a page in one call, and the events of none', async () => {
    plant(banClosing(1, TEACHER_A), banClosing(2, TEACHER_B), banClosing(3, TEACHER_A));
    const counted = lift();
    expect(await counted.counterpartiesOf(tx, STUDENT, 'student')).toEqual([TEACHER_A, TEACHER_B]);
    expect(caseReads).toEqual([[eid(3), eid(2), eid(1)]]);
    for (const row of rows.values()) row.events = [];
    expect(await counted.slotHeldUntilOf(tx, STUDENT)).toEqual(new Date('2026-11-15T08:00:00Z'));
  });

  it('takes the last cancellation’s reason from the column: a ban’s closing with no event still read', async () => {
    plant({ ...banClosing(1, TEACHER_A), events: [] });
    expect(await lift().counterpartiesOf(tx, STUDENT, 'student')).toEqual([TEACHER_A]);
  });

  it('takes the release from slot_released_at: a released closing holds nothing, with or without its row', async () => {
    plant({
      ...banClosing(1, TEACHER_A),
      item: { ...banClosing(1, TEACHER_A).item, slotReleasedAt: NOW },
    });
    expect(await lift().slotHeldUntilOf(tx, STUDENT)).toBeNull();
  });

  it('reads the closings again under the enrollments’ lock in one page of their ids and one read of their cases', async () => {
    plant(banClosing(1, TEACHER_A), banClosing(2, TEACHER_B));
    await restoredOf(STUDENT, 'student', [STUDENT, TEACHER_A, TEACHER_B].sort());
    expect(pages.at(-1)).toEqual({ enrollmentIds: [eid(1), eid(2)] });
    expect(caseReads.at(-1)).toEqual([eid(2), eid(1)]);
  });
});
