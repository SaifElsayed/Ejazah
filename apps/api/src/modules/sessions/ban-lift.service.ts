// T072 of specs/004-sessions/tasks.md (FR-502, FR-503; SRS FR-ADMIN-5 as amended, FR-GENDER-6,
// DEC-66, DEC-69; the note under T072: N1, Q6 (a), Q7 (a), Q9 (a), Q10 (a); the owner's word on
// B42a lane D's Q-D1, «موافق», 2026-11-13; contracts/kernel.md, the lifts' row): what a lift owes
// the enrollments its ban or revocation closed, handed to identity's `StandingService` as its `lift`
// (identity imports no other module, docs/ARCHITECTURE.md §4), and the hold's end `users.get` answers.
//
// THE CLOSINGS. A student's ban closes each confirmed enrollment `cancelled` `admin` with an open
// `student_banned` case; a teacher's ban or revocation, `cancelled` `teacher_suspended` with an open
// `teacher_ended` case (booking's subscriber). Which enrollments a lift reads is T070's one closing
// rule (`closingOf`, `restore-window.ts`) over each of the person's `cancelled` enrollments, paged
// through `EnrollmentSide` (sessions reads no booking table, R-301), its last cancellation's reason
// (its events) and its latest end case (moderation's entry): the kind the lift's side names, its
// case open. A deletion's or a gender correction's closing is never one (T073, Q10 (a)).
//
// `counterpartiesOf`: those enrollments' other parties, read with no lock, for identity's one
// `users` call. `restoreClosed`, once identity holds `users` (the person and those counterparties,
// in id order) and a teacher's profile, and has moved the person: the teachers' `lockKey`s in
// ascending teacher id (L1), the enrollments' slots in one call, the enrollments in one call, each
// read again under its lock (still the ban's closing, its case open; one a restore or a case's
// closing took meanwhile left out; a counterparty identity did not lock throws before any write,
// with one warn line of ids, and the administrator retries), their sessions in one call and those
// sessions' remedies in one call; the database's clock read under them; then, in id order, each
// enrollment's two genders compared (`partiesOf`, as `chat.service.ts`' `sameGender` reads them;
// Q10 (a)), a pairing that differs left ended `gender_mismatch`, every other restored through T073's
// `restoreClosed`, whose own locks are all held, so it never waits. `disputes` come last, each
// closing's case closed by the restore through `closeCase`, whose enrollment lock is the one held.
//
// Q7 (a): a restore refused before its first write (`RESTORE_REFUSED` with any cause, the
// restore's own line written) leaves that one enrollment ended with its case open, the answer naming
// the cause, and the lift goes on; one refused after its first write (`isRefusedAfterWrite`:
// `no_free_week`, or the database's exclusion at the insert) refuses the whole lift `CONFLICT`
// `restore_failed` naming the enrollment (`details: [{ path: 'cause', code: 'restore_failed' },
// { path: 'enrollmentId', code: <id> }]`), with one info line of ids, nothing written: Prisma gives no
// savepoint, so the transaction rolls back whole. The administrator may release that slot (T070) or
// retry.
//
// THE HOLD (`slotHeldUntilOf`, Q9 (a)): the latest hold end among the account's closings a ban or a
// revocation made (the student's `student_banned`, the teacher's `teacher_ended`), each still held
// (its case open, no `slot_released` row after the closing, as the monitor's `slotHeldUntil` reads
// it), each through T070's `restorableUntil` (the closing case's opening plus
// `ban_restore_window_days`), never `banned_at` plus the setting; null for none. It may have passed.
//
// THE LOG (the owner's rule): `gender_mismatch` and `restore_failed` one info line of ids and the
// reason each; the lift one info line of ids and counts. No name, note or free text.
import type { BanLiftEnrollmentCause } from '@ijazah/contracts/admin';
import { banLiftEnrollmentCause } from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { sessionPartiesOf } from '../identity/index.js';
import { compensationCasesOf, type EnrollmentCase } from '../moderation/index.js';
import type {
  EnrollmentEventEntry,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentSide,
  EnrollmentStatus,
} from './enrollment-side.port.js';
import { lockSlots } from './makeup-booking.repository.js';
import { lockRemedies, lockSessions, lockTeacherSlots } from './remedy-case.repository.js';
import { type RestoreSession, restoreSessionsOf } from './restore.repository.js';
import { isRefusedAfterWrite, type Restore } from './restore.service.js';
import {
  type Closing,
  type ClosingKind,
  closingOf,
  latestEndCaseOf,
  restorableUntil,
  windowDaysOf,
} from './restore-window.js';
import type { PartyStanding } from './sessions.service.js';

/** Whose enrollments a lift reads: the student's or the teacher's (identity's `LiftSide`). */
export type BanLiftSide = 'student' | 'teacher';

/** One enrollment the ban or the revocation closed, as the lift left it (identity's). */
export interface BanLiftResult {
  readonly enrollmentId: string;
  readonly restored: boolean;
  readonly cause?: BanLiftEnrollmentCause;
}

/** What the lift locks and reads besides the enrollment side; faked in a spec. */
export interface BanLiftStore {
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSlots(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRemedies(tx: Transaction, ids: readonly string[]): Promise<void>;
  sessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly RestoreSession[]>;
  /** Moderation's: the enrollment's compensation cases, newest first. */
  casesOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentCase[]>;
  /** Identity's: each party's standing and gender. */
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PartyStanding>>;
}

export const banLiftStore: BanLiftStore = {
  lockTeacherSlots,
  lockSlots,
  lockSessions,
  lockRemedies,
  sessionsOf: restoreSessionsOf,
  casesOf: compensationCasesOf,
  partiesOf: sessionPartiesOf,
};

/** Identity's `LiftDependency` less the grant, structurally (identity imports no other module). */
export interface BanLift {
  counterpartiesOf(tx: Transaction, userId: string, side: BanLiftSide): Promise<readonly string[]>;
  restoreClosed(
    tx: Transaction,
    adminId: string,
    userId: string,
    side: BanLiftSide,
    lockedUserIds: readonly string[],
  ): Promise<readonly BanLiftResult[]>;
  /** `users.get`'s `enrollmentsSlotHeldUntil` (this file's head, «THE HOLD»); null for none. */
  slotHeldUntilOf(tx: Transaction, userId: string): Promise<Date | null>;
}

export interface BanLiftDependencies {
  readonly enrollments: Pick<
    EnrollmentSide,
    'enrollmentPage' | 'eventsOf' | 'enrollmentFor' | 'lockEnrollments'
  >;
  /** T073's core, its dependencies bound once (`createRestore`). */
  readonly restore: Pick<Restore, 'restoreClosed'>;
  /** The two window settings, read through `windowDaysOf` when a hold's end is asked. */
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info' | 'warn'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  /** Whether a restore's refusal came after its first write (`isRefusedAfterWrite`). */
  readonly refusedAfterWrite?: (error: unknown) => boolean;
  readonly store?: BanLiftStore;
}

/** A closed enrollment of the lift: its parties, its slot and its closing. */
interface ClosedEnrollment {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly closing: Closing;
  readonly events: readonly EnrollmentEventEntry[];
}

/** The enrollments a ban or a revocation closes are `cancelled`: a read filter, never a write. */
const CANCELLED: EnrollmentStatus = 'cancelled';

/** The closing each side's ban or revocation makes (this file's head, «THE CLOSINGS»). */
const KIND_OF: Readonly<Record<BanLiftSide, ClosingKind>> = {
  student: 'student_banned',
  teacher: 'teacher_ended',
};

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();
const byId = (one: { readonly enrollmentId: string }, other: { readonly enrollmentId: string }) =>
  one.enrollmentId < other.enrollmentId ? -1 : 1;

/** The last cancellation's reason, from the events (oldest first); null for none. */
function lastCancellationReasonOf(events: readonly EnrollmentEventEntry[]): string | null {
  return events.filter(({ kind }) => kind === 'cancelled').at(-1)?.cancellationReason ?? null;
}

/** Whether a `slot_released` row follows the enrollment's last closing (the monitor's reading). */
function releasedSinceClosing(events: readonly EnrollmentEventEntry[]): boolean {
  const closedAt = events.findLastIndex(
    ({ kind }) => kind === 'cancelled' || kind === 'terminated_no_show',
  );
  return events.slice(closedAt + 1).some(({ kind }) => kind === 'slot_released');
}

const LIFT_REFUSED = 'A lift was refused';

export function createBanLift({
  enrollments,
  restore,
  settings,
  log,
  clock = clockTimestamp,
  refusedAfterWrite = isRefusedAfterWrite,
  store = banLiftStore,
}: BanLiftDependencies): BanLift {
  /** The enrollment's closing as the one closing rule reads it, if the side's kind with its case open. */
  const closedBy = async (
    tx: Transaction,
    item: Pick<EnrollmentPageItem, 'enrollmentId' | 'status'>,
    side: BanLiftSide,
  ): Promise<{ closing: Closing; events: readonly EnrollmentEventEntry[] } | null> => {
    const [events, cases] = await Promise.all([
      enrollments.eventsOf(tx, item.enrollmentId),
      store.casesOf(tx, item.enrollmentId),
    ]);
    const closing = closingOf({
      status: item.status,
      lastCancellationReason: lastCancellationReasonOf(events),
      endCase: latestEndCaseOf(cases),
    });
    if (closing?.kind !== KIND_OF[side] || !closing.restorable) return null;
    return { closing, events };
  };

  /** The person's enrollments the side's ban or revocation closed, read with no lock, in id order. */
  const closedOf = async (
    tx: Transaction,
    userId: string,
    side: BanLiftSide,
  ): Promise<ClosedEnrollment[]> => {
    const filter: EnrollmentPageFilter =
      side === 'student'
        ? { status: CANCELLED, studentUserIds: [userId] }
        : { status: CANCELLED, teacherUserIds: [userId] };
    const closed: ClosedEnrollment[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await enrollments.enrollmentPage(tx, filter, cursor);
      for (const item of page.items) {
        const found = await closedBy(tx, item, side);
        if (found === null) continue;
        closed.push({
          enrollmentId: item.enrollmentId,
          studentUserId: item.studentUserId,
          teacherUserId: item.teacherUserId,
          ...found,
        });
      }
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    return closed.sort(byId);
  };

  const otherParty = (one: ClosedEnrollment, side: BanLiftSide): string =>
    side === 'student' ? one.teacherUserId : one.studentUserId;

  /** Restores one enrollment, or names the cause a refusal before the first write gave. */
  const restoreOne = async (
    tx: Transaction,
    adminId: string,
    userId: string,
    { enrollmentId, studentUserId, teacherUserId }: ClosedEnrollment,
    now: Date,
  ): Promise<BanLiftResult> => {
    // Q10 (a): the pairing's two genders, as the chat compares them, before any restore.
    const parties = await store.partiesOf(tx, sortedUnique([studentUserId, teacherUserId]));
    const student = parties.get(studentUserId);
    const teacher = parties.get(teacherUserId);
    if (student !== undefined && teacher !== undefined && student.gender !== teacher.gender) {
      log.info(
        { adminId, userId, enrollmentId, reason: 'gender_mismatch' },
        'A lift left an enrollment ended',
      );
      return { enrollmentId, restored: false, cause: 'gender_mismatch' };
    }
    try {
      await restore.restoreClosed(tx, adminId, enrollmentId, now);
      return { enrollmentId, restored: true };
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) throw error;
      if (refusedAfterWrite(error)) {
        log.info(
          { adminId, userId, enrollmentId, errorCode: 'CONFLICT', reason: 'restore_failed' },
          LIFT_REFUSED,
        );
        throw markRefusalLogged(
          new DomainError('CONFLICT', undefined, {
            details: [
              { path: 'cause', code: 'restore_failed' },
              { path: 'enrollmentId', code: enrollmentId },
            ],
          }),
        );
      }
      // A cause found before the first write: the restore wrote its line; the enrollment stays.
      const cause = banLiftEnrollmentCause.safeParse(
        error.details?.find(({ path }) => path === 'cause')?.code,
      );
      if (error.code !== 'RESTORE_REFUSED' || !cause.success) throw error;
      return { enrollmentId, restored: false, cause: cause.data };
    }
  };

  return {
    counterpartiesOf: async (tx, userId, side) =>
      sortedUnique((await closedOf(tx, userId, side)).map((one) => otherParty(one, side))),

    restoreClosed: async (tx, adminId, userId, side, lockedUserIds) => {
      const seen = await closedOf(tx, userId, side);
      if (seen.length === 0) {
        log.info({ adminId, userId, side, restored: 0, refused: 0 }, 'A lift restored enrollments');
        return [];
      }
      const terms = await Promise.all(
        seen.map(async ({ enrollmentId }) => enrollments.enrollmentFor(tx, enrollmentId)),
      );
      const slotIds = terms.flatMap((one) => (one === null ? [] : [one.slotId]));
      // L1: each teacher's key in ascending teacher id, then the slots and the enrollments.
      for (const teacherUserId of sortedUnique(seen.map(({ teacherUserId }) => teacherUserId))) {
        await store.lockTeacherSlots(tx, teacherUserId);
      }
      await store.lockSlots(tx, sortedUnique(slotIds));
      await enrollments.lockEnrollments(
        tx,
        seen.map(({ enrollmentId }) => enrollmentId),
      );
      // Read again under the enrollments' locks, which every case closing and every restore take.
      const closed: ClosedEnrollment[] = [];
      for (const one of seen) {
        const now = await enrollments.enrollmentFor(tx, one.enrollmentId);
        if (now === null) continue;
        const found = await closedBy(
          tx,
          { enrollmentId: one.enrollmentId, status: now.status },
          side,
        );
        if (found !== null) closed.push({ ...one, ...found });
      }
      const locked = new Set(lockedUserIds);
      for (const one of closed) {
        if (locked.has(otherParty(one, side))) continue;
        log.warn(
          {
            adminId,
            userId,
            enrollmentId: one.enrollmentId,
            counterpartyId: otherParty(one, side),
          },
          'A lift found a closed enrollment whose other party was not locked',
        );
        throw new Error('ban lift: a closed enrollment’s other party was not locked');
      }
      const sessions = (
        await Promise.all(closed.map(({ enrollmentId }) => store.sessionsOf(tx, enrollmentId)))
      ).flat();
      await store.lockSessions(tx, sortedUnique(sessions.map(({ id }) => id)));
      const remedies = (
        await Promise.all(closed.map(({ enrollmentId }) => store.sessionsOf(tx, enrollmentId)))
      )
        .flat()
        .flatMap(({ remedy }) => (remedy === null ? [] : [remedy.id]));
      if (remedies.length > 0) await store.lockRemedies(tx, sortedUnique(remedies));
      const now = await clock(tx);
      const results: BanLiftResult[] = [];
      for (const one of closed) results.push(await restoreOne(tx, adminId, userId, one, now));
      log.info(
        {
          adminId,
          userId,
          side,
          restored: results.filter(({ restored }) => restored).length,
          refused: results.filter(({ restored }) => !restored).length,
        },
        'A lift restored enrollments',
      );
      return results;
    },

    slotHeldUntilOf: async (tx, userId) => {
      const windowDays = windowDaysOf(settings);
      let latest: Date | null = null;
      for (const side of ['student', 'teacher'] as const) {
        for (const { closing, events } of await closedOf(tx, userId, side)) {
          if (releasedSinceClosing(events)) continue;
          const until = await restorableUntil(
            closing.closingCase.createdAt,
            closing.kind,
            windowDays,
          );
          if (latest === null || until.getTime() > latest.getTime()) latest = until;
        }
      }
      return latest;
    },
  };
}
