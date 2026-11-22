// T016 of specs/004-sessions (FR-445, FR-480, FR-495; R-TIME-6; research R-307): the administrator
// surface's `sessions.outages` procedures (admin-surface.md, "`sessions`"). A window during which
// the video provider was out, recorded by an administrator with the second factor and a mandatory
// reason (LiveKit Cloud sends no outage event, ADR 0003). The window crosses as the administrator's
// local date and time and an IANA zone, never an instant (R-TIME-6, `time/no-client-timestamp`):
// the server resolves both ends with `packages/time`. A recorded window is never edited (data-model
// §2.5, rule 44); no procedure here changes or removes one.
import { z } from 'zod';

import { enrollmentCancellationReason, enrollmentStatus } from '../checkout.js';
import { sessionStatus } from '../enrollments.js';
import { idempotencyKey } from '../idempotency-key.js';
import { calendarDate, timeZone } from '../onboarding.js';
import { packageTrack } from '../packages.js';
import { slotStartTimeLocal } from '../slots.js';
import { adminReason, adminSearch } from './admins.js';

/** One end of the window: a calendar date and a wall-clock time (`HH:MM`), in the input's zone. */
export const outageWallClock = z.object({ localDate: calendarDate, localTime: slotStartTimeLocal });

export const outagesRecordInput = z.object({
  start: outageWallClock,
  end: outageWallClock,
  timezone: timeZone,
  reason: adminReason,
});

export const outagesRecordOutput = z.object({
  outageId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** The settled sessions inside their dispute window this record moved to `provider_outage`. */
  reclassified: z.int().nonnegative(),
});

/** A page of the list starts after this window; windows are listed by their time-ordered id. */
export const outagesListCursor = z.uuid();

export const outagesListInput = z.object({ cursor: outagesListCursor.optional() });

/** The administrator who recorded a window. */
export const outageRecorder = z.object({ adminId: z.uuid(), displayName: z.string() });

export const outagesListItem = z.object({
  outageId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string(),
  recordedBy: outageRecorder,
});

export const outagesListOutput = z.object({
  items: z.array(outagesListItem),
  /** Present while more windows follow the page. */
  nextCursor: outagesListCursor.optional(),
});

// T023 of specs/004-sessions (FR-460, FR-480, FR-485; SC-413; admin-surface.md, `sessions.cancel`):
// an administrator's cancellation of a session not yet settled, with a mandatory reason. The
// session becomes `cancelled_by_admin` with no penalty, and one `admin_cancellation` compensation
// case on its enrollment is opened or joined; its id is answered as `caseId`. Only a `scheduled`
// session is cancelled: any other, a `disputed` one included (its ruling is FR-476's path), is
// refused `SESSION_NOT_SCHEDULED`; a session that does not exist is `NOT_FOUND`.
export const sessionsCancelInput = z.object({ sessionId: z.uuid(), reason: adminReason });

export const sessionsCancelOutput = z.object({
  sessionId: z.uuid(),
  status: z.literal('cancelled_by_admin'),
  /** The `admin_cancellation` case opened, or the open one joined. */
  caseId: z.uuid(),
});

export type SessionsCancelInput = z.infer<typeof sessionsCancelInput>;
export type SessionsCancelOutput = z.infer<typeof sessionsCancelOutput>;

// T024 of specs/004-sessions (FR-479, FR-480, FR-451, FR-439; R-MONEY-6; research R-322, R-323 GAP-1
// and GAP-4; admin-surface.md, `sessions.monitor.list/get`, `TimelineEvent`, `RemedyMonitor`): the
// enrollment and session monitor, read-only (the cancellation is `sessions.cancel`'s). Every derived
// value is computed when read and never stored (R-DB-4): `completed`, `remaining`, `teacherNoShows`
// and its mark `repeatedAbsence`, `restorableUntil`, `cancellable`, `correctable`, and each remedy's
// `answerClosesAt` and `bookingRetriedUntil`. No amount, payment record or payment id crosses
// (FR-497): payment status is `/payments`' page. A party is named as this phase names one, with
// its id for the panel's links (`Party`, FR-426: a deleted account has no name).

/** A party of an enrollment (admin-surface.md, `Party`). */
export const monitorParty = z.object({
  userId: z.uuid(),
  /** The party's display name; null for a deleted party. */
  displayName: z.string().nullable(),
  /** The party's account was deleted (FR-426). */
  deleted: z.boolean(),
});

/** A page of the list starts after this enrollment; enrollments are listed by their time-ordered id. */
export const sessionsMonitorCursor = z.uuid();

export const sessionsMonitorListInput = z.object({
  status: enrollmentStatus.optional(),
  /** The start of the student's name, folded (R-203). */
  student: adminSearch.optional(),
  /** The start of the teacher's name, folded (R-203). */
  teacher: adminSearch.optional(),
  /** Enrollments with a session on or after this local date, in the session's own zone. */
  from: calendarDate.optional(),
  /** Enrollments with a session on or before this local date, in the session's own zone. */
  to: calendarDate.optional(),
  cursor: sessionsMonitorCursor.optional(),
});

/** A session's schedule as the monitor shows it: its local date, start and zone, and its instant. */
export const monitorSessionTime = z.object({
  sessionId: z.uuid(),
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
});

/** One enrollment of the list (FR-479; FR-451's count and mark, for administrators only). */
export const sessionsMonitorListItem = z.object({
  enrollmentId: z.uuid(),
  student: monitorParty,
  teacher: monitorParty,
  status: enrollmentStatus,
  track: packageTrack,
  sessionCount: z.int().min(1),
  /** Sessions consumed (FR-392). */
  completed: z.int().nonnegative(),
  /** The snapshot's count less those consumed. */
  remaining: z.int().nonnegative(),
  teacherNoShows: z.int().nonnegative(),
  /** `teacherNoShows` at `repeated_absence_flag_count` or above (FR-451); nothing follows from it. */
  repeatedAbsence: z.boolean(),
  /** The earliest scheduled session not yet over. */
  nextSession: monitorSessionTime.optional(),
});

export const sessionsMonitorListOutput = z.object({
  items: z.array(sessionsMonitorListItem),
  /** Present while more enrollments follow the page. */
  nextCursor: sessionsMonitorCursor.optional(),
});

export const sessionsMonitorGetInput = z.object({ enrollmentId: z.uuid() });

/** The enrollment of `sessions.monitor.get`: the list's fields with the restore window's end. */
export const monitorEnrollment = sessionsMonitorListItem.omit({ nextSession: true }).extend({
  /**
   * The closing case's opening plus `enrollment_restore_window_days`, present only for an
   * enrollment `sessions.restore` could admit by its closing and its case (FR-454, R-322); it may
   * already have passed, the restore then refused `window_closed`.
   * @deprecated T073 (SRS DEC-69; R-322's step 2 retired): no restore is refused for its time. Kept
   * (R-API-9), answered with the hold's end (`slotHeldUntil`'s instant, a release leaving it) for
   * every closing R-322's step 1 admits with its case open, a ban's and a teacher's ban's or
   * revocation's included; a past instant does not mean the restore is refused. Read `slotHeldUntil`.
   */
  restorableUntil: z.iso.datetime().optional(),
  // T070 (FR-503; SRS FR-CANCEL-9, DEC-69): the hold of the enrollment's weekly slot.
  /**
   * The closing case's opening plus the window of the closing's kind (`enrollment_restore_window_days`,
   * or `ban_restore_window_days` for a ban's or a revocation's), present while the closing is
   * restorable by the one closing rule (its case open) and the slot was not released; it may already
   * have passed, the slot then free.
   */
  slotHeldUntil: z.iso.datetime().optional(),
  /** The instant an administrator released the held slot (`enrollments.releaseSlot`), if one did. */
  slotReleasedAt: z.iso.datetime().optional(),
  /**
   * T082 of specs/004-sessions (the note under T082, Q-O1 (a)): `enrollment_restore_window_days`,
   * the days a direct end's closing holds its slot (DEC-69), for the panel's `{days}` in the end's
   * dialog. Additive (R-API-9).
   */
  enrollmentRestoreWindowDays: z.int().positive(),
});

/** A time a remedy names, in its own zone (FR-494). */
const monitorRemedyTime = z.object({
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
});

/** A session's remedy as the administrator sees it (admin-surface.md, `RemedyMonitor`; GAP-4). */
export const remedyMonitor = z.object({
  remedyId: z.uuid(),
  kind: z.enum(['makeup', 'refund']),
  status: z.enum([
    'awaiting_choice',
    'proposed',
    'counter_proposed',
    'booked',
    'refund_case',
    'frozen',
    'lapsed',
  ]),
  offeredAt: z.iso.datetime(),
  choiceClosesAt: z.iso.datetime(),
  /** The system's proposal: the enrollment's slot's local start on its date, in the enrollment's zone. */
  proposal: monitorRemedyTime.optional(),
  /** The pending counter-proposal only; `answerClosesAt` computed when read (D1). */
  counter: monitorRemedyTime
    .extend({ proposedAt: z.iso.datetime(), answerClosesAt: z.iso.datetime() })
    .optional(),
  caseId: z.uuid().optional(),
  decidedAt: z.iso.datetime().optional(),
  /** A refused booking of the proposal, retried until then (FR-468): «booking refused, retried until …». */
  bookingRetriedUntil: z.iso.datetime().optional(),
});

/** One session of the enrollment (admin-surface.md, `sessions.monitor.get`). */
export const monitorSession = z.object({
  sessionId: z.uuid(),
  sequenceNumber: z.int().positive(),
  /** The session this one makes up for, when it is a make-up (ADR 0018 D3). */
  makeupFor: z.object({ sessionId: z.uuid(), sequenceNumber: z.int().positive() }).optional(),
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: sessionStatus,
  /** The outcome frozen while the session is `disputed` (R-308). */
  outcomeUnderDispute: sessionStatus.optional(),
  /** `sessions.cancel` would be admitted: the session is `scheduled` (FR-460). */
  cancellable: z.boolean(),
  /** `sessions.review.revise` would be admitted now (FR-439). */
  correctable: z.boolean(),
  remedy: remedyMonitor.optional(),
});

/** A compensation case's reason (`disputes.reason`, the closed list of moderation's cases). */
export const compensationCaseReason = z.enum([
  'slot_unavailable',
  'party_restricted',
  'duplicate_payment',
  'absence_termination',
  'admin_cancellation',
  'teacher_ended',
  'student_suspended',
  'student_banned',
  'student_fault_confirmed',
  'refund_choice',
  'counter_unanswered',
  'makeup_refused',
  'admin_opened_for_student',
  'admin_opened_for_teacher',
  // T071 (FR-504): a teacher's suspension pauses the enrollment; added, additively (R-API-9).
  'teacher_suspended',
  // T082 (FR-513; SRS FR-CANCEL-10): an administrator's direct end; added, additively (R-API-9).
  'admin_ended',
  // 005:T014 (B47; FR-616, FR-GENDER-7): a gender correction's end, one case per enrollment it
  // ended; added, additively (R-API-9).
  'gender_correction',
  // 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): an administrator's direct end on a teacher's
  // complaint against the student (`sessionsEndEnrollmentInput`'s `cause`); added, additively
  // (R-API-9).
  'student_complaint_ended',
]);

/** One compensation case of the enrollment, newest first (a complaint is `/cases`'). */
export const monitorCase = z.object({
  caseId: z.uuid(),
  reason: compensationCaseReason,
  status: z.enum(['open', 'resolved', 'dismissed']),
});

/** One cancellation request of the enrollment's sessions, newest first, as its row records it. */
export const monitorCancellationRequest = z.object({
  requestId: z.uuid(),
  sessionId: z.uuid(),
  requestedBy: z.enum(['student', 'teacher']),
  reason: z.string(),
  status: z.enum(['pending', 'accepted', 'declined', 'expired']),
  createdAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().optional(),
});

/** `enrollment_event_kind` and `session_event_kind`, a timeline row's kind by its source. */
export const timelineEventKind = z.enum([
  'confirmed',
  'order_failed',
  'cancelled',
  'completed',
  'terminated_no_show',
  'restored',
  'settled',
  'cancellation_requested',
  'cancellation_accepted',
  'cancellation_declined',
  'cancellation_expired',
  'cancelled_by_admin',
  'remedy_offered',
  'counter_proposed',
  'counter_accepted',
  'counter_declined',
  'counter_withdrawn',
  'remedy_frozen',
  'makeup_booked',
  'remedy_handed_to_case',
  'remedy_lapsed',
  'dispute_raised',
  'dispute_resolved',
  'dispute_revised',
  'review_resolved',
  'outage_reclassified',
  'complaint_raised',
  'complaint_decided',
  'outcome_corrected',
  'instants_reresolved',
  'counter_booking_refused',
  // B42a's T069 (Q-69-1 (a), additive, R-API-9): two `enrollment_event_kind` values, a held slot's
  // release (T070) and a hold's end (T074).
  'slot_released',
  'slot_hold_ended',
  // 003:T112 (SRS FR-POSTPONE-1, DEC-90; Q-2 (a)): the `session_event_kind` value a postponement
  // writes for each session it moves; added, additively (R-API-9).
  'postponed',
  // 006:T003 (ADR 0024; ERD changelog row 65): the four `enrollment_event_kind` values of a
  // programme, its offer, pause, resumption and reopen; added, additively (R-API-9).
  'programme_offered',
  'programme_paused',
  'programme_resumed',
  'programme_reopened',
]);

/**
 * One row of the enrollment's timeline (admin-surface.md, `TimelineEvent`; GAP-1): an
 * `enrollment_events` row (its kind and reason; no payment id, FR-497) or a `session_events` row
 * (its kind and the columns its kind sets).
 */
export const timelineEvent = z.object({
  source: z.enum(['enrollment', 'session']),
  kind: timelineEventKind,
  sessionId: z.uuid().optional(),
  caseId: z.uuid().optional(),
  cancellationReason: enrollmentCancellationReason.optional(),
  outcomeBefore: sessionStatus.optional(),
  outcomeAfter: sessionStatus.optional(),
  previousStartAt: z.iso.datetime().optional(),
  occurredAt: z.iso.datetime(),
});

export const sessionsMonitorGetOutput = z.object({
  enrollment: monitorEnrollment,
  /** By sequence number. */
  sessions: z.array(monitorSession),
  cases: z.array(monitorCase),
  cancellationRequests: z.array(monitorCancellationRequest),
  /** Newest first; at one instant, the session rows before the enrollment's. */
  events: z.array(timelineEvent),
});

export type MonitorParty = z.infer<typeof monitorParty>;
export type SessionsMonitorListInput = z.infer<typeof sessionsMonitorListInput>;
export type SessionsMonitorListItem = z.infer<typeof sessionsMonitorListItem>;
export type SessionsMonitorListOutput = z.infer<typeof sessionsMonitorListOutput>;
export type SessionsMonitorGetInput = z.infer<typeof sessionsMonitorGetInput>;
export type SessionsMonitorGetOutput = z.infer<typeof sessionsMonitorGetOutput>;
export type MonitorEnrollment = z.infer<typeof monitorEnrollment>;
export type MonitorSession = z.infer<typeof monitorSession>;
export type RemedyMonitor = z.infer<typeof remedyMonitor>;
export type TimelineEvent = z.infer<typeof timelineEvent>;

// T033 of specs/004-sessions (FR-446, FR-450, FR-477, FR-480; R-SESS-6; research R-323 GAP-2;
// admin-surface.md, `sessions.review.list/get/resolve` and `Telemetry`): the review queue. The queue
// lists the sessions `under_threshold` or `provider_outage`, which wait for an administrator's
// outcome (no automatic transition leaves them); the telemetry is read for any session no longer
// `scheduled` (a `scheduled` one is refused `CONFLICT`, `details.cause` `not_settled`); the
// resolution writes one of the four outcomes with a mandatory reason, a session not under review
// refused `CONFLICT`, `details.cause` `not_under_review` (the owner's decision of 2026-11-11, Q2).

/** A page of the queue starts after this session; sessions are listed by their time-ordered id. */
export const sessionsReviewCursor = z.uuid();

export const sessionsReviewListInput = z.object({ cursor: sessionsReviewCursor.optional() });

/** The two statuses the queue holds (R-SESS-6). */
export const reviewStatus = z.enum(['under_threshold', 'provider_outage']);

/** A session's two parties, each named as this phase names one (FR-426). */
export const sessionParties = z.object({ student: monitorParty, teacher: monitorParty });

export const sessionsReviewListItem = z.object({
  sessionId: z.uuid(),
  enrollmentId: z.uuid(),
  status: reviewStatus,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** The figure the evaluation decided the outcome on (ADR 0022). */
  simultaneousSeconds: z.int().nonnegative(),
  parties: sessionParties,
});

export const sessionsReviewListOutput = z.object({
  items: z.array(sessionsReviewListItem),
  /** Present while more sessions follow the page. */
  nextCursor: sessionsReviewCursor.optional(),
});

export const sessionsReviewGetInput = z.object({ sessionId: z.uuid() });

/** One recorded participant event or the room's end (`session_participant_events`). */
export const telemetryEvent = z.object({
  party: z.enum(['student', 'teacher', 'room']),
  type: z.enum(['joined', 'left', 'room_ended']),
  occurredAt: z.iso.datetime(),
  /** The provider's connection; absent on `room_ended`. */
  connectionRef: z.string().optional(),
});

/** A span of connected time, start included, end excluded. */
export const telemetryInterval = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});

/** A recorded provider outage window overlapping the session (FR-445). */
export const telemetryOutage = z.object({
  outageId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});

/**
 * A session's connection record (admin-surface.md, `Telemetry`; FR-SESS-9): its schedule, every
 * recorded join and leave and the room's end, oldest first, each party's connected intervals and
 * the two together from T013's rules, the simultaneous seconds the evaluation recorded, who joined
 * by FR-442, and the outage windows overlapping it.
 */
export const telemetry = z.object({
  sessionId: z.uuid(),
  schedule: z.object({
    localDate: calendarDate,
    startTimeLocal: slotStartTimeLocal,
    timezone: timeZone,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  }),
  status: sessionStatus,
  events: z.array(telemetryEvent),
  intervals: z.object({
    student: z.array(telemetryInterval),
    teacher: z.array(telemetryInterval),
    together: z.array(telemetryInterval),
  }),
  simultaneousSeconds: z.int().nonnegative(),
  joined: z.object({ student: z.boolean(), teacher: z.boolean() }),
  outages: z.array(telemetryOutage),
});

export const sessionsReviewGetOutput = telemetry;

/** The four outcomes an administrator writes (R-SESS-6, FR-446). */
export const adminOutcome = z.enum(['done', 'student_no_show', 'teacher_no_show', 'both_no_show']);

export const sessionsReviewResolveInput = z.object({
  sessionId: z.uuid(),
  outcome: adminOutcome,
  reason: adminReason,
});

export const sessionsReviewResolveOutput = z.object({ sessionId: z.uuid(), status: adminOutcome });

export type SessionsReviewListInput = z.infer<typeof sessionsReviewListInput>;
export type SessionsReviewListItem = z.infer<typeof sessionsReviewListItem>;
export type SessionsReviewListOutput = z.infer<typeof sessionsReviewListOutput>;
export type SessionsReviewGetInput = z.infer<typeof sessionsReviewGetInput>;
export type Telemetry = z.infer<typeof telemetry>;
export type TelemetryEvent = z.infer<typeof telemetryEvent>;
export type TelemetryInterval = z.infer<typeof telemetryInterval>;
export type AdminOutcome = z.infer<typeof adminOutcome>;
export type SessionsReviewResolveInput = z.infer<typeof sessionsReviewResolveInput>;
export type SessionsReviewResolveOutput = z.infer<typeof sessionsReviewResolveOutput>;

// T059 of specs/004-sessions (spec FR-439; SRS FR-ADMIN-20 (b); research R-323 GAP-3;
// admin-surface.md, `sessions.review.revise`): an administrator's correction of an outcome nobody
// disputed, inside the dispute window and before any remedy. Keyed by `idempotencyKey` (scope
// `sessions.review.revise`).
export const sessionsReviewReviseInput = z.object({
  sessionId: z.uuid(),
  outcome: adminOutcome,
  reason: adminReason,
  idempotencyKey,
});

export const sessionsReviewReviseOutput = z.object({
  sessionId: z.uuid(),
  sessionStatus: adminOutcome,
  previousStatus: adminOutcome,
});

export type SessionsReviewReviseInput = z.infer<typeof sessionsReviewReviseInput>;
export type SessionsReviewReviseOutput = z.infer<typeof sessionsReviewReviseOutput>;

// T061 of specs/004-sessions (FR-454, FR-455, FR-470; SRS FR-CANCEL-8; research R-322, «The
// restore»; ADR 0023 D4; admin-surface.md, `sessions.restore`): an administrator restores an
// enrollment an administrator's decision closed, at any time while its case is open (T073, DEC-69),
// with a mandatory reason, keyed under the administrator's idempotency key. Refused
// `RESTORE_REFUSED` with `details.cause` one of nine causes (T073 added `refunded`; `window_closed`
// is `@deprecated`, never produced), writing nothing. No amount crosses and `confirmed_at` is never
// written.

/**
 * Why a restore was refused (R-322, steps 1 to 6). T073 (FR-507; SRS FR-CANCEL-8 as amended,
 * DEC-66, DEC-69): `window_closed` is never produced since step 2 was retired, kept (R-API-9); the
 * ninth cause, `refunded`, an order of the enrollment refunded at the gateway, added at the end.
 */
export const restoreRefusalCause = z.enum([
  'not_restorable',
  /** @deprecated T073 (DEC-69): never produced; no restore is refused for its time (R-API-9). */
  'window_closed',
  'case_closed',
  'party_restricted',
  'slot_inactive',
  'slot_changed',
  'slot_taken',
  'time_taken',
  // T073 (FR-507; the note under T073, Q4 (a)): any order of the enrollment refunded.
  'refunded',
  // 005:T014 (B47; FR-617; research R-409): step 3, the pairing's two declared genders differ,
  // whatever closed the enrollment (DEC-69); added, additively (R-API-9).
  'gender_mismatch',
  // 006:T003 (R-513, G-1; admin-surface.md, `sessions.restore` changed): a programme's enrollment is
  // never restored (a stopped one is reopened by `programmes.reopen`); added, additively (R-API-9).
  'programme_enrollment',
]);

export const sessionsRestoreInput = z.object({
  enrollmentId: z.uuid(),
  reason: adminReason,
  idempotencyKey,
});

/** One session the restore created, its local date, start and zone beside its instant. */
export const restoredSession = z.object({
  sessionId: z.uuid(),
  sequenceNumber: z.int().positive(),
  localDate: calendarDate,
  startTimeLocal: slotStartTimeLocal,
  timezone: timeZone,
  startsAt: z.iso.datetime(),
});

export const sessionsRestoreOutput = z.object({
  enrollmentId: z.uuid(),
  status: z.literal('confirmed'),
  sessionsCreated: z.array(restoredSession),
  /** The remedies the closing's case held, offered again. */
  remediesOffered: z.int().nonnegative(),
  /** The closing's case, closed `dismissed` with the note `restored`. */
  caseId: z.uuid(),
});

export type RestoreRefusalCause = z.infer<typeof restoreRefusalCause>;
export type SessionsRestoreInput = z.infer<typeof sessionsRestoreInput>;
export type SessionsRestoreOutput = z.infer<typeof sessionsRestoreOutput>;

// T082 of specs/004-sessions (FR-513; SRS FR-CANCEL-10, DEC-68; admin-surface.md,
// `sessions.endEnrollment`): an administrator ends a `confirmed` enrollment directly, with a reason
// both parties are shown and an optional internal note kept in the audit entry only, the slot held
// through the restore window or released at once, keyed under the administrator's idempotency key.
// Refused `CONFLICT` with `details.cause` `enrollment_not_confirmed` or `complaint_open` (the open
// complaint named beside it, `{ path: 'caseId', code: <id> }`, Q-R6 (a)), `NOT_FOUND` and
// `RATE_LIMITED`, each writing nothing. No amount crosses (R-MONEY-6); restorable at any time
// through `sessions.restore` (DEC-69).

/** What the end does with the enrollment's weekly slot: held through the window, or released. */
export const enrollmentEndSlot = z.enum(['hold', 'release']);

/**
 * 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): why the administrator ends the enrollment, by the
 * case reason the end opens: `admin_ended`, the direct end as T082 built it (the default), or
 * `student_complaint_ended`, the close on a teacher's complaint against the student (made by a
 * report, `reports.create`), whose case closes as a complaint close (T105's release, T110's
 * amounts). Additive (R-API-9).
 */
export const enrollmentEndCause = z.enum(['admin_ended', 'student_complaint_ended']);

/**
 * Why an end was refused, as `CONFLICT`'s `details.cause`: the enrollment not `confirmed`, or a
 * complaint of the teacher's absence open on it (decided through `cases.decideComplaint`, Q5 (a)),
 * which the refusal names beside its cause (`{ path: 'caseId', code: <the complaint's id> }`).
 */
export const enrollmentEndRefusalCause = z.enum(['enrollment_not_confirmed', 'complaint_open']);

/** The reason both parties are shown, and the internal note: each at most 500 characters. */
export const ENROLLMENT_END_TEXT_MAX_LENGTH = 500;

export const sessionsEndEnrollmentInput = z.object({
  enrollmentId: z.uuid(),
  /** Shown to both parties (`endedByAdmin.reason`); 1 to 500 characters, not blank. */
  partyReason: z.string().trim().min(1).max(ENROLLMENT_END_TEXT_MAX_LENGTH),
  /** Kept in the audit entry only, never shown to a party nor logged. */
  internalNote: z.string().trim().max(ENROLLMENT_END_TEXT_MAX_LENGTH).optional(),
  /**
   * Hold or release the weekly slot; ignored on the cause `student_complaint_ended`, which always
   * releases it (003:T112, Q-4 (a); PR #151's review, round 1, Major 2 (a)). The answer's `slot`
   * is the one the end made.
   */
  slot: enrollmentEndSlot.default('hold'),
  /** 003:T112 (Q-4 (a)): the end's cause; today's direct end by default. */
  cause: enrollmentEndCause.default('admin_ended'),
  idempotencyKey,
});

export const sessionsEndEnrollmentOutput = z.object({
  enrollmentId: z.uuid(),
  /**
   * The `admin_ended` case opened (or joined), holding the sessions owed and every open remedy; on
   * the cause `student_complaint_ended` (003:T112), the case of that reason.
   */
  caseId: z.uuid(),
  slot: enrollmentEndSlot,
  /** The remaining `scheduled` sessions the end cancelled (`cancelled_by_admin`). */
  cancelledSessions: z.int().nonnegative(),
});

export type EnrollmentEndSlot = z.infer<typeof enrollmentEndSlot>;
export type EnrollmentEndCause = z.infer<typeof enrollmentEndCause>;
export type EnrollmentEndRefusalCause = z.infer<typeof enrollmentEndRefusalCause>;
export type SessionsEndEnrollmentInput = z.infer<typeof sessionsEndEnrollmentInput>;
export type SessionsEndEnrollmentOutput = z.infer<typeof sessionsEndEnrollmentOutput>;
