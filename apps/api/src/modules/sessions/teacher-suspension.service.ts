// T071 of specs/004-sessions/tasks.md (FR-504; SRS FR-SESS-16 as amended; research R-313's table;
// the two notes under T071: Q5 (a) widened by the review session, Q5.2 (a), Q5.3 (a), Q6 (a) and N2;
// contracts/kernel.md, the rows «a teacher's suspension, the pause», «an end of a paused
// enrollment» and «a teacher's reinstatement»): what a teacher's suspension that pauses owes after
// the pause itself, which booking's subscriber runs as a student's suspension's (the enrollments
// kept `confirmed` with their slots, their upcoming sessions `cancelled_by_admin` naming one
// `teacher_suspended` case each, their open remedies frozen).
//
// AN END OF A PAUSED ENROLLMENT (`closePausedCaseOnEnd`). Any end of an enrollment paused by a
// teacher's suspension closes its open `teacher_suspended` case in the end's transaction: `resolved`,
// resolution `compensation_ordered`, the fixed note `ended_meanwhile`, `covered_by_case_id` the
// end's case (rule 49 as T069 widened it; none when the end opened none), the ending
// administrator's id, through moderation's `closeCase`, so the sessions the suspension cancelled are
// the end's case's through T035's `covers` (U2, `suspension-case.service.ts`). Rule 46 is not
// relaxed: `enrollment_ended` stays an absence complaint's. The callers: booking's subscriber (a
// teacher's ban or revocation, P1 and P2, a student's ban, P3), a complaint decided (a) (P6) and a
// `student_suspended` case's fault confirmed (P7). The case is read under the enrollment's lock,
// which every caller holds and every case closing takes, so it cannot close meanwhile. One info line
// of ids per case closed; nothing when none is open.
//
// THE REINSTATEMENT (`createTeacherReinstatement`, handed to identity's `StandingService` as its
// `reinstatement`, Q6 (a)). `studentsOf`: the teacher's `confirmed` enrollments, paged through
// `EnrollmentSide` (sessions reads no booking table, R-301), those with an open `teacher_suspended`
// case (moderation's entry; each page's cases in one read of `compensationCasesAmong`, T074 FU4),
// read with no lock, and their students. `resume`, once identity holds
// `users` (the teacher and those students, one call, id order) and has moved the teacher: the
// teacher's `lockKey('teacher-slots')`, the paused enrollments in one call, each read again under
// its lock (still `confirmed`, its case still open; one an end closed meanwhile is left out), the
// sessions each case's suspension cancelled (its `cancelled_by_admin` events naming the case, still
// with no remedy) in one call, their remedies in one call, each offered through T028's `offerLocked`
// with `clearedSuspension` (recitation `awaiting_choice`, ijazah track `proposed`), then each case
// closed `resolved`, `compensation_ordered`, the note `reinstated`. The frozen remedies are not
// offered here: T028's sweep offers them on its next run, its standing read finding neither party
// suspended (N2). When an offer finds no free week, the whole reinstatement is refused `CONFLICT`
// `no_free_week` and nothing is written (T036's precedent, Q5 (a)), the offer's own warn line
// written. A paused enrollment whose student identity did not lock (a suspension committed between
// the read and the lock, which a reinstatement on a stale screen alone could race) throws before any
// write, with one warn line of ids, and the administrator retries. A paused enrollment whose student
// is suspended refuses the whole reinstatement `STUDENT_SUSPENDED` (Q-B1 (a), the review session's
// ruling of 2026-11-13; T036's precedent), read under the accounts' locks before any offer, nothing
// written, one info line of ids.
//
// THE LOCKS (`003:T005`'s rules). Every lock after `users` in the one order: the key, `enrollments`,
// `sessions`, `session_remedies`, then `disputes` (the cases closed through `closeCase`, whose
// enrollment lock is the one held). `offerLocked` re-locks nothing (`remedy-offer.service.ts`): its
// rows are held. The offers' inserts reference the sessions and the enrollments held, no account.
//
// THE LOG (the owner's rule). A refusal: one info line of ids and its reason, marked «logged». Each
// offer: its `offeredLine`, on the transaction once the cases are closed (T036's precedent, F8).
// The reinstatement: one info line of ids and counts. No note, name or free text.
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Logger } from '../../platform/logging/logger.js';
import { readStanding } from '../identity/index.js';
import {
  type CaseClosing,
  closeCase,
  compensationCasesAmong,
  openCaseOf,
} from '../moderation/index.js';
import type {
  EnrollmentPageFilter,
  EnrollmentSide,
  EnrollmentStatus,
} from './enrollment-side.port.js';
import { lockSessions, lockTeacherSlots } from './remedy-case.repository.js';
import { type Offered, offeredLine, type RemedyOffer } from './remedy-offer.service.js';
import { lockRemediesOfSessions, sessionsToOfferOf } from './suspension-case.repository.js';

/** The case a teacher's suspension opens on each enrollment it pauses (R-313's table). */
export const PAUSED_CASE_REASON = 'teacher_suspended';
/** The fixed note of a paused enrollment's case closed by an end (Q5 (a) widened). */
export const ENDED_MEANWHILE_NOTE = 'ended_meanwhile';
/** The fixed note of a paused enrollment's case closed by the teacher's reinstatement. */
export const REINSTATED_NOTE = 'reinstated';

/**
 * The enrollments the reinstatement pages. A read filter, never a write: the confirmation gate
 * (`tests/pipeline/confirmation-path.spec.ts`) reads a `status: 'confirmed'` literal as a write, so
 * the value is a named constant, as `remedy-offer.sweep.ts` names it.
 */
const CONFIRMED: EnrollmentStatus = 'confirmed';

/** What closing a paused enrollment's case reads and writes, through moderation's entry. */
export interface PausedCaseStore {
  /** The enrollment's open `teacher_suspended` case, null for none; the caller holds its lock. */
  pausedCaseOf(tx: Transaction, enrollmentId: string): Promise<string | null>;
  /** Moderation's `closeCase`: the closing instant, null when the case is not open. */
  closeCase(tx: Transaction, caseId: string, closing: CaseClosing): Promise<Date | null>;
}

export const pausedCaseStore: PausedCaseStore = {
  pausedCaseOf: (tx, enrollmentId) => openCaseOf(tx, enrollmentId, PAUSED_CASE_REASON),
  closeCase,
};

/** An end of a paused enrollment, as its caller names it. */
export interface PausedEnd {
  /** The administrator who ended the enrollment, written as the closing's (rule 46). */
  readonly adminId: string;
  readonly enrollmentId: string;
  /** The end's case, which owes the paused sessions; null when the end opened none. */
  readonly endCaseId: string | null;
  /** The end, as its log line names it: a termination cause or a decision, never free text. */
  readonly end: string;
}

/**
 * Closes the paused enrollment's open `teacher_suspended` case for its end (this file's head), on
 * the end's transaction under the enrollment's lock the caller holds; the case closed, or null when
 * none was open.
 */
export async function closePausedCaseOnEnd(
  tx: Transaction,
  store: PausedCaseStore,
  log: Pick<Logger, 'info'>,
  { adminId, enrollmentId, endCaseId, end }: PausedEnd,
): Promise<string | null> {
  const caseId = await store.pausedCaseOf(tx, enrollmentId);
  if (caseId === null) return null;
  const closing: CaseClosing = {
    status: 'resolved',
    resolution: 'compensation_ordered',
    note: ENDED_MEANWHILE_NOTE,
    adminId,
    ...(endCaseId === null ? {} : { coveredBy: endCaseId }),
  };
  if ((await store.closeCase(tx, caseId, closing)) === null) {
    throw new Error('paused case: a case read open under the enrollment’s lock did not close');
  }
  log.info(
    { adminId, enrollmentId, caseId, coveredByCaseId: endCaseId, end },
    'A paused enrollment’s teacher_suspended case closed by its end',
  );
  return caseId;
}

/** What the reinstatement reads, locks and writes besides the enrollment side; faked in a spec. */
export interface TeacherReinstatementStore extends PausedCaseStore {
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  lockRemediesOfSessions(tx: Transaction, sessionIds: readonly string[]): Promise<void>;
  /** Q-B1 (a): identity's, the account's status, read under its lock; null for none. */
  accountStatusOf(tx: Transaction, userId: string): Promise<string | null>;
  /** The sessions the case's suspension cancelled, owed an offer, in id order. */
  sessionsToOffer(tx: Transaction, caseId: string): Promise<readonly string[]>;
  /**
   * T074 FU4: of `enrollmentIds`, each one's open `teacher_suspended` case, as `pausedCaseOf`
   * answers it (the oldest open), in one read with no lock; an enrollment with none is absent.
   */
  pausedCasesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

/** T074 FU4: each enrollment's open `teacher_suspended` case, the oldest open as `openCaseOf`'s. */
async function pausedCasesAmongOf(
  tx: Transaction,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const cases = await compensationCasesAmong(tx, enrollmentIds);
  const paused = new Map<string, string>();
  for (const [enrollmentId, all] of cases) {
    // Newest first: the last open one is the oldest, the one `openCaseOf` answers.
    const open = all.filter(
      ({ reason, status }) => reason === PAUSED_CASE_REASON && status === 'open',
    );
    const oldest = open.at(-1);
    if (oldest !== undefined) paused.set(enrollmentId, oldest.caseId);
  }
  return paused;
}

export const teacherReinstatementStore: TeacherReinstatementStore = {
  ...pausedCaseStore,
  pausedCasesAmong: pausedCasesAmongOf,
  lockTeacherSlots,
  lockSessions,
  lockRemediesOfSessions,
  accountStatusOf: async (tx, userId) => (await readStanding(tx, userId))?.accountStatus ?? null,
  sessionsToOffer: sessionsToOfferOf,
};

/** Identity's `ReinstatementDependency`, structurally (identity imports no other module). */
export interface TeacherReinstatement {
  /** The students of the teacher's paused enrollments, read with no lock. */
  studentsOf(tx: Transaction, teacherUserId: string): Promise<readonly string[]>;
  /** The offers and the cases' closing, the accounts `lockedUserIds` held (this file's head). */
  resume(
    tx: Transaction,
    adminId: string,
    teacherUserId: string,
    lockedUserIds: readonly string[],
  ): Promise<void>;
}

/** A paused enrollment: its student and its open `teacher_suspended` case. */
interface PausedEnrollment {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly caseId: string;
}

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

export function createTeacherReinstatement({
  enrollments,
  offers,
  log,
  store = teacherReinstatementStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentPage' | 'lockEnrollments' | 'enrollmentFor'>;
  /** T028's offer, built with the process's logger, which writes its no-free-week warn line. */
  readonly offers: Pick<RemedyOffer, 'offerLocked'>;
  readonly log: Pick<Logger, 'info' | 'warn'>;
  readonly store?: TeacherReinstatementStore;
}): TeacherReinstatement {
  /** The teacher's paused enrollments, read with no lock, in id order. */
  const pausedOf = async (tx: Transaction, teacherUserId: string): Promise<PausedEnrollment[]> => {
    const filter: EnrollmentPageFilter = { status: CONFIRMED, teacherUserIds: [teacherUserId] };
    const paused: PausedEnrollment[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await enrollments.enrollmentPage(tx, filter, cursor);
      // T074 FU4: the page's open cases in one read, none per enrollment.
      const cases =
        page.items.length === 0
          ? new Map<string, string>()
          : await store.pausedCasesAmong(
              tx,
              page.items.map(({ enrollmentId }) => enrollmentId),
            );
      for (const { enrollmentId, studentUserId } of page.items) {
        const caseId = cases.get(enrollmentId);
        if (caseId !== undefined) paused.push({ enrollmentId, studentUserId, caseId });
      }
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    return paused.sort((one, other) => (one.enrollmentId < other.enrollmentId ? -1 : 1));
  };

  return {
    studentsOf: async (tx, teacherUserId) =>
      sortedUnique((await pausedOf(tx, teacherUserId)).map(({ studentUserId }) => studentUserId)),

    resume: async (tx, adminId, teacherUserId, lockedUserIds) => {
      const seen = await pausedOf(tx, teacherUserId);
      const closedCaseIds: string[] = [];
      const offered: Offered[] = [];
      if (seen.length > 0) {
        await store.lockTeacherSlots(tx, teacherUserId);
        await enrollments.lockEnrollments(
          tx,
          seen.map(({ enrollmentId }) => enrollmentId),
        );
        // Read again under the enrollments' locks, which every end and every case closing takes.
        const paused: PausedEnrollment[] = [];
        for (const one of seen) {
          if ((await enrollments.enrollmentFor(tx, one.enrollmentId))?.status !== CONFIRMED) continue;
          const caseId = await store.pausedCaseOf(tx, one.enrollmentId);
          if (caseId === null) continue;
          paused.push({ ...one, caseId });
        }
        const locked = new Set(lockedUserIds);
        for (const { enrollmentId, studentUserId } of paused) {
          if (locked.has(studentUserId)) continue;
          log.warn(
            { adminId, teacherUserId, enrollmentId, studentUserId },
            'A teacher’s reinstatement found a paused enrollment whose student was not locked',
          );
          throw new Error('teacher reinstatement: a paused enrollment’s student was not locked');
        }
        // Q-B1 (a): a student still suspended, T028's offer would postpone every session of the
        // enrollment; refused with that standing, read under the accounts' locks before any offer.
        for (const { enrollmentId, studentUserId } of paused) {
          if ((await store.accountStatusOf(tx, studentUserId)) !== 'suspended') continue;
          log.info(
            {
              adminId,
              teacherUserId,
              enrollmentId,
              studentUserId,
              errorCode: 'STUDENT_SUSPENDED',
              reason: 'student_suspended',
            },
            'A teacher’s reinstatement was refused',
          );
          throw markRefusalLogged(new DomainError('STUDENT_SUSPENDED'));
        }
        const sessionsOf = new Map<string, string>();
        for (const { enrollmentId, caseId } of paused) {
          for (const sessionId of await store.sessionsToOffer(tx, caseId)) {
            sessionsOf.set(sessionId, enrollmentId);
          }
        }
        const sessionIds = sortedUnique([...sessionsOf.keys()]);
        if (sessionIds.length > 0) {
          await store.lockSessions(tx, sessionIds);
          await store.lockRemediesOfSessions(tx, sessionIds);
        }
        for (const sessionId of sessionIds) {
          const offer = await offers.offerLocked(tx, sessionId, { clearedSuspension: true });
          if (offer === null) {
            log.info(
              {
                adminId,
                teacherUserId,
                enrollmentId: sessionsOf.get(sessionId),
                sessionId,
                errorCode: 'CONFLICT',
                reason: 'no_free_week',
              },
              'A teacher’s reinstatement was refused',
            );
            throw markRefusalLogged(
              new DomainError('CONFLICT', undefined, {
                details: [{ path: 'cause', code: 'no_free_week' }],
              }),
            );
          }
          offered.push(offer);
        }
        const closing: CaseClosing = {
          status: 'resolved',
          resolution: 'compensation_ordered',
          note: REINSTATED_NOTE,
          adminId,
        };
        for (const { caseId } of paused) {
          if ((await store.closeCase(tx, caseId, closing)) === null) {
            throw new Error('teacher reinstatement: a case read open under its lock did not close');
          }
          closedCaseIds.push(caseId);
        }
      }
      for (const offer of offered) offeredLine(log, offer);
      log.info(
        {
          adminId,
          teacherUserId,
          enrollments: closedCaseIds.length,
          offeredSessions: offered.length,
          closedCaseIds,
        },
        'A teacher’s reinstatement resumed the paused enrollments',
      );
    },
  };
}
