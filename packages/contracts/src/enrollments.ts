// T049: the `enrollments` namespace of the user surface (specs/003-booking/contracts/app-surface.md
// "`enrollments` and the teacher's lists"; FR-390, FR-392, FR-393, FR-395), and the shapes the
// teacher's lists share with it (`teacher-students.ts`).
//
// A list has two tabs: active (awaiting payment or confirmed) and ended (completed, ended by the
// teacher's absence, or cancelled after it was confirmed). The student names the tab, the page or
// the enrollment, never who asks (R-GENDER-4). Each item carries its next and its last session and
// three counts the server derives from the sessions, never stored (FR-392, R-DB-4): upcoming,
// completed (consumed) and remaining. Every session carries its local date, local start and zone
// beside its instants (R-TIME-6), so the phone shows it in the teacher's zone and the viewer's
// (FR-393). An item carries what `Enrollments`, `EnrollmentDetail` and `Main` draw and nothing else
// (FR-395): the package line without its price, the teacher's name, the status.
import { z } from 'zod';

import { subjectSummary } from './catalog.js';
import { enrollmentSession, enrollmentStatus } from './checkout.js';
import { MAX_SESSION_COUNT, packageTrack, sessionLengthMinutes } from './packages.js';

/** The two tabs of «اشتراكاتي» and «طلابي» (FR-390, FR-391). */
export const enrollmentListTab = z.enum(['active', 'ended']);

/** ERD `session_status` (SRS §3.7.5 and §3.8); this phase writes only `scheduled`. */
export const sessionStatus = z.enum([
  'scheduled',
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
  'under_threshold',
  'provider_outage',
  'cancelled_by_agreement',
  'cancelled_by_admin',
  'disputed',
]);

/**
 * One session as a list shows it: `checkout.status`' session with its status (FR-393), and its id
 * (004:T020; specs/004-sessions/contracts/app-surface.md, "Phase 2's lists, widened additively"), so
 * the phone opens the session's pre-session screen from it. A disputed session's status is
 * `disputed`; the outcome frozen beside it is never answered (R-308).
 */
export const listedSession = enrollmentSession.extend({
  sessionId: z.uuid(),
  status: sessionStatus,
  // 004:T021 (FR-456, FR-495): a cancellation request is pending on the session now, its session
  // still scheduled and not started (specs/004-sessions/contracts/app-surface.md, "Phase 2's lists").
  pendingCancellation: z.boolean(),
});

/** The package line an enrollment shows, from its snapshot: subject, track, sessions, minutes. */
export const enrollmentTerms = z.object({
  subject: subjectSummary,
  track: packageTrack,
  sessionCount: z.int().min(1).max(MAX_SESSION_COUNT),
  sessionDurationMinutes: sessionLengthMinutes,
});

/** A count of sessions the server derived (FR-392). */
const sessionTally = z.int().nonnegative();

/**
 * Where an enrollment stands, derived from its sessions (FR-392): the next session not yet over
 * and the last by sequence number, absent while it has none; the sessions not yet over, those
 * consumed, and those the package still owes.
 */
export const enrollmentProgress = z.object({
  next: listedSession.optional(),
  last: listedSession.optional(),
  upcoming: sessionTally,
  completed: sessionTally,
  remaining: sessionTally,
});

/** A page of the ended tab starts after this enrollment; the active tab is one page. */
export const enrollmentListCursor = z.uuid();

export const enrollmentsListInput = z.object({
  tab: enrollmentListTab,
  cursor: enrollmentListCursor.optional(),
});

/**
 * The other party of an enrollment as Phase 2's lists name them (T007, `003:T090`; FR-426;
 * specs/004-sessions/contracts/README.md, "A deleted party"). A party whose account was deleted
 * has no name (FR-141 erased it): `displayNameOrNull` null and `deleted` true, and the phone draws
 * its stand-in. Added beside `displayName`, which the contract gate keeps a string (R-API-9; the
 * note under T007 of specs/004-sessions/tasks.md). A later output naming a party is new and
 * answers `{ displayName: string | null, deleted: boolean }` instead.
 */
export const listedPartyName = z.object({
  /**
   * @deprecated Since T007: read `displayNameOrNull` and `deleted`. `''` for a deleted party, so
   * an older phone draws no name; it stays published until the contract gate has a path to
   * deprecate and then remove a field (R-API-9).
   */
  displayName: z.string(),
  /** The party's display name; null for a deleted party. */
  displayNameOrNull: z.string().nullable(),
  /** The party's account was deleted (FR-426). */
  deleted: z.boolean(),
});

/** One of the student's enrollments (FR-390). */
export const studentEnrollmentItem = z.object({
  enrollmentId: z.uuid(),
  teacher: z.object({ teacherId: z.uuid(), ...listedPartyName.shape }),
  summary: enrollmentTerms,
  status: enrollmentStatus,
  ...enrollmentProgress.shape,
});

/** The tab's items, active ones by next session; a cursor while more ended ones remain. */
export const enrollmentsListOutput = z.object({
  items: z.array(studentEnrollmentItem),
  nextCursor: enrollmentListCursor.optional(),
});

export const enrollmentsGetInput = z.object({ enrollmentId: z.uuid() });

/** The enrollment and every session of it by sequence number (FR-390). */
export const enrollmentsGetOutput = studentEnrollmentItem.extend({
  sessions: z.array(listedSession),
});

export type EnrollmentListTab = z.infer<typeof enrollmentListTab>;
export type SessionStatus = z.infer<typeof sessionStatus>;
export type ListedSession = z.infer<typeof listedSession>;
export type EnrollmentTerms = z.infer<typeof enrollmentTerms>;
export type ListedPartyName = z.infer<typeof listedPartyName>;
export type EnrollmentProgress = z.infer<typeof enrollmentProgress>;
export type EnrollmentsListInput = z.infer<typeof enrollmentsListInput>;
export type StudentEnrollmentItem = z.infer<typeof studentEnrollmentItem>;
export type EnrollmentsListOutput = z.infer<typeof enrollmentsListOutput>;
export type EnrollmentsGetInput = z.infer<typeof enrollmentsGetInput>;
export type EnrollmentsGetOutput = z.infer<typeof enrollmentsGetOutput>;
