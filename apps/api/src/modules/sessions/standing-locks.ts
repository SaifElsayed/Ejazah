// The locks a standing move takes before `StandingService` and its consequences run on them
// (contracts/kernel.md, the `party_*` row and the row «a complaint decided (b)»; `003:T005`'s
// rules), one function for both paths that move a party's standing from sessions: a dispute
// resolved `party_suspended` or `party_banned` (T034, `dispute-resolution.service.ts`) and a
// complaint decided `suspend_teacher` (T060, `complaint-decision.service.ts`). Moved here from
// `dispute-resolution.service.ts` unchanged in what it locks, its parameters generalized for a
// complaint, which names no session (the owner's decision of 2026-11-11 on B40's conflict check,
// Q4 (a)), so a later change to a suspension's consequences touches one lock order.
//
// THE ORDER. The party's `users` row (identity's `lockAccount`), for a teacher banned their
// `teacher_profiles` row (`lockApplication`, L-A), then, read under the account's lock (every path
// that confirms an enrollment of the account locks it first), the party's confirmed enrollments;
// the slots' keys of every teacher concerned, ascending (the party's own id and, for a student,
// each of their teachers', as booking's subscriber takes them, L1); the party's active holds, the
// ones the subscriber releases, in one call (booking's `lockActiveHoldsOf`; the owner's decision of
// 2026-11-11 on lane A's questions, item 3); the matter's enrollment, the holds' enrollments and
// the party's confirmed ones in one call; the matter's session, when it names one, and the party's
// remaining `scheduled` sessions in one call; their open remedies in one call. Each call is in id
// order. The caller takes `disputes` after: the ruling its dispute's lock, the complaint's closing
// its conditional update. `StandingService` and its consequences then run on these locks: its
// account and application locks and the subscriber's keys, holds, enrollments, sessions and
// remedies are ones already held, so no session is taken after one with a greater id (F1).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import type {
  EnrollmentPageItem,
  EnrollmentSide,
  EnrollmentStatus,
} from './enrollment-side.port.js';
import type { OpenRemedy, RemainingSession } from './remaining-sessions.repository.js';

/** An account's active holds, locked, and the enrollments they were placed for (booking's). */
export interface LockedHolds {
  readonly holdIds: readonly string[];
  readonly enrollmentIds: readonly string[];
}

/**
 * Booking's `lockActiveHoldsOf` (kernel.md's `party_*` row; the owner's decision of 2026-11-11 on
 * lane A's questions, item 3), handed in by the admin module's composition, since sessions reads
 * no booking table and booking already depends on sessions' entry (R-API-6).
 */
export type LockActiveHolds = (tx: Transaction, userId: string) => Promise<LockedHolds>;

/** The locks and reads a standing move takes, each on the caller's transaction. */
export interface StandingLockStore {
  /** Identity's account lock. */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /** Identity's application lock, after the account (L-A). */
  lockApplication(tx: Transaction, userId: string): Promise<void>;
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  scheduledSessionsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<readonly RemainingSession[]>;
  openRemediesOf(tx: Transaction, enrollmentIds: readonly string[]): Promise<readonly OpenRemedy[]>;
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
}

/** What the locks are taken for: the party, the move and the matter's own rows. */
export interface StandingLockTarget {
  readonly party: 'student' | 'teacher';
  readonly partyUserId: string;
  /** A ban: a teacher's `teacher_profiles` row is taken after the account (L-A). */
  readonly banned: boolean;
  /** The dispute's or the complaint's enrollment. */
  readonly enrollmentId: string;
  /** The dispute's session; a complaint names none. */
  readonly sessionId?: string;
}

export interface StandingLockDependencies {
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments' | 'enrollmentPage'>;
  readonly lockActiveHolds: LockActiveHolds;
  readonly store: StandingLockStore;
}

/**
 * The party's enrollments a standing move locks. A read filter (`EnrollmentPageFilter`, the `where`
 * of `EnrollmentSide.enrollmentPage`), never a write: the confirmation gate
 * (`tests/pipeline/confirmation-path.spec.ts`) reads any `status: 'confirmed'` literal as a write,
 * so the value is a named constant, as `remedy-offer.sweep.ts` reads it (the owner's decision of
 * 2026-11-10; the follow-up under T034).
 */
const CONFIRMED: EnrollmentStatus = 'confirmed';

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** The party's confirmed enrollments, every page, read under the account's lock. */
async function confirmedOf(
  tx: Transaction,
  enrollments: StandingLockDependencies['enrollments'],
  role: 'student' | 'teacher',
  userId: string,
): Promise<readonly EnrollmentPageItem[]> {
  const filter =
    role === 'student'
      ? { status: CONFIRMED, studentUserIds: [userId] }
      : { status: CONFIRMED, teacherUserIds: [userId] };
  const all: EnrollmentPageItem[] = [];
  let cursor: string | undefined;
  // Bounded: each page moves past its last id, and the party's enrollments are finite.
  for (;;) {
    const page = await enrollments.enrollmentPage(tx, filter, cursor);
    all.push(...page.items);
    if (page.nextCursor === undefined) return all;
    cursor = page.nextCursor;
  }
}

/** A standing move's locks, in kernel.md's `party_*` row's order (this file's head). */
export async function lockForStanding(
  tx: Transaction,
  { enrollments, lockActiveHolds, store }: StandingLockDependencies,
  { party, partyUserId, banned, enrollmentId, sessionId }: StandingLockTarget,
): Promise<void> {
  await store.lockAccount(tx, partyUserId);
  if (party === 'teacher' && banned) await store.lockApplication(tx, partyUserId);
  const confirmed = await confirmedOf(tx, enrollments, party, partyUserId);
  for (const key of sortedUnique([partyUserId, ...confirmed.map((e) => e.teacherUserId)])) {
    await store.lockTeacherSlots(tx, key);
  }
  const holds = await lockActiveHolds(tx, partyUserId);
  const confirmedIds = sortedUnique(confirmed.map((e) => e.enrollmentId));
  await enrollments.lockEnrollments(
    tx,
    sortedUnique([enrollmentId, ...holds.enrollmentIds, ...confirmedIds]),
  );
  const remaining = await store.scheduledSessionsOf(tx, confirmedIds);
  await store.lockRows(
    tx,
    'sessions',
    sortedUnique([...(sessionId === undefined ? [] : [sessionId]), ...remaining.map((s) => s.id)]),
  );
  const remedies = await store.openRemediesOf(tx, confirmedIds);
  if (remedies.length > 0) {
    await store.lockRows(tx, 'session_remedies', sortedUnique(remedies.map((r) => r.id)));
  }
}
