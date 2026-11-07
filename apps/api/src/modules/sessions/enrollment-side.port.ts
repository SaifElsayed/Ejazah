// T008 of specs/004-sessions/tasks.md (research R-301; contracts/kernel.md, "The composition root"):
// what sessions needs of an enrollment that only booking can answer. Booking imports sessions, so
// sessions may not import booking; sessions' services take this port instead, and `main.ts` and
// `worker.ts` bind it to booking's `createEnrollmentSide()`, as catalog's `CatalogUse` is bound
// (Phase 2's R-207). Sessions reads no booking table (R-API-6): an enrollment's number and length of
// sessions come from its snapshot through `enrollmentFor`, never from its package (FR-424), and
// nothing here assumes every session of an enrollment was generated at once.
//
// THE LOCKS (T005's rules; `platform/db/row-lock.ts`). Every function runs on the caller's
// transaction and takes no lock it does not name. `lockEnrollments` is the one that names one: the
// `enrollments` rows, `FOR UPDATE`, id order, one statement, in the enrollments' place of the one
// order. The four moves expect the caller to hold the enrollment's lock taken so, and every lock
// earlier in the order before it: the move's own update and its `enrollment_events` row (which
// references the enrollment and no account) then touch only the row already held. The reads take
// no lock; a path that decides on what they answer locks first and reads again (rule 1).
//
// THE MOVES (data-model.md §3, "Enrollment, this phase's moves"). Each is conditional on the state
// the caller read under its locks: the update is applied only from its one source state, and a call
// from any other state changes nothing, writes no event and answers `false`, so the caller refuses
// with its own error and log line. A move applied writes its one `enrollment_events` row in the
// same transaction and answers `true`.
//
// The enums are written out, since only a repository may import the database client (R-API-2);
// booking's repository answers the database's values as these types, so a member the schema gains
// and these lack fails the typecheck there.
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** `enrollments.status` (ERD §5, `enrollment_status`). */
export type EnrollmentStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'terminated_no_show'
  | 'cancelled';

/** `cancellation_reason`, of an enrollment and of its `cancelled` row (ADR 0010 D7). */
export type EnrollmentCancellationReason =
  | 'payment_expired'
  | 'payment_failed'
  | 'admin'
  | 'gender_correction'
  | 'teacher_suspended'
  | 'slot_unavailable'
  | 'checkout_abandoned'
  | 'account_deleted';

/** `snapshot_track`, the package's track frozen at purchase (ADR 0018 D1, `package_track`). */
export type EnrollmentTrack = 'recitation' | 'ijazah_track';

/** `enrollment_events.kind` (data-model.md §2.8, `enrollment_event_kind`). */
export type EnrollmentEventKind =
  | 'confirmed'
  | 'order_failed'
  | 'cancelled'
  | 'completed'
  | 'terminated_no_show'
  | 'restored';

/** What `enrollmentFor` answers: the enrollment's snapshot, its slot and its status (R-301). */
export interface EnrollmentTerms {
  readonly id: string;
  readonly status: EnrollmentStatus;
  /** Its weekly slot, `enrollments.slot_id`; the slot's own columns are catalog's. */
  readonly slotId: string;
  /** `snapshot_track` (ADR 0018 D1). */
  readonly track: EnrollmentTrack;
  /** `snapshot_slot_timezone`, the zone every session of it is resolved in (R-TIME-2). */
  readonly timezone: string;
  /** `snapshot_duration_minutes`, each session's length (FR-424). */
  readonly durationMinutes: number;
  /** `snapshot_session_count`, the number of sessions bought (FR-424). */
  readonly sessionCount: number;
}

/**
 * One `enrollment_events` row as the monitor's timeline shows it (T024; research R-323, GAP-1):
 * its kind, its reason when it is a cancellation, and its instant. No `payment_id` crosses (FR-497):
 * the orders stay on `/payments`.
 */
export interface EnrollmentEventEntry {
  readonly kind: EnrollmentEventKind;
  readonly cancellationReason?: EnrollmentCancellationReason;
  readonly occurredAt: Date;
}

/**
 * Which enrollments `enrollmentPage` lists (T024; the third analysis, U3): every condition given
 * holds at once; one left out does not filter. An empty list of ids matches no enrollment.
 */
export interface EnrollmentPageFilter {
  readonly status?: EnrollmentStatus;
  readonly studentUserIds?: readonly string[];
  readonly teacherUserIds?: readonly string[];
  readonly enrollmentIds?: readonly string[];
}

/** One enrollment of a page: its parties, its status, its track and its snapshot count. */
export interface EnrollmentPageItem {
  readonly enrollmentId: string;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly status: EnrollmentStatus;
  readonly track: EnrollmentTrack;
  readonly sessionCount: number;
}

/** A page of `admin_list_page_size` enrollments, newest first; `nextCursor` while more follow. */
export interface EnrollmentPage {
  readonly items: readonly EnrollmentPageItem[];
  readonly nextCursor?: string;
}

export interface EnrollmentSide {
  /** The enrollment's snapshot, slot and status, with no lock; null when there is none (T148). */
  enrollmentFor(tx: Transaction, id: string): Promise<EnrollmentTerms | null>;
  /** Locks the enrollments' rows, `FOR UPDATE`, id order, in one statement (T005). */
  lockEnrollments(tx: Transaction, ids: readonly string[]): Promise<void>;
  /**
   * `confirmed` → `terminated_no_show`, with one `terminated_no_show` row: an administrator's
   * decision (a) on a student's complaint (T060, FR-453). No count or threshold calls it (R-322).
   */
  terminateNoShow(tx: Transaction, id: string): Promise<boolean>;
  /** `confirmed` → `completed`, with one `completed` row (T015, FR-449). */
  complete(tx: Transaction, id: string): Promise<boolean>;
  /**
   * `terminated_no_show`, or `cancelled` with the reason `admin`, → `confirmed`, with one
   * `restored` row: an administrator's restore (T061, FR-454, R-322). `cancellation_reason` is
   * cleared and `confirmed_at` left as it is (R-HONEST-1). Which closing may be restored (its case,
   * its window) is the caller's to check.
   */
  restore(tx: Transaction, id: string): Promise<boolean>;
  /**
   * `confirmed` → `cancelled` with the reason `admin`, with one `cancelled` row naming it: a
   * suspended student's fault confirmed (T036, R-313).
   */
  cancel(tx: Transaction, id: string, reason: 'admin'): Promise<boolean>;
  /** The enrollment's `enrollment_events` rows, oldest first, with no lock (T024, GAP-1). */
  eventsOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentEventEntry[]>;
  /**
   * A keyset page by id, newest first, of `admin_list_page_size` enrollments matching `filter`,
   * after `cursor` (the last id of the page before), with no lock (T024; R-API-6).
   */
  enrollmentPage(
    tx: Transaction,
    filter: EnrollmentPageFilter,
    cursor?: string,
  ): Promise<EnrollmentPage>;
}
