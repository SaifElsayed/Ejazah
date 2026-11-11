// T035 of specs/004-sessions (FR-422, FR-478, FR-480, FR-452; R-MONEY-6; research R-312, R-322;
// admin-surface.md, "`cases`"): the administrator surface's `cases` namespace, the compensation-case
// queue and the complaints of a teacher's absence. `cases.list` lists every case, Phase 2's reasons
// included, and every complaint, the open `student_suspended` cases first, then the rest by their
// opening; `cases.get` names what a case covers; `cases.resolve` and `cases.dismiss` close a
// compensation case with a mandatory note (a complaint is `cases.decideComplaint`'s alone, T060).
// No amount crosses anywhere (FR-467, R-MONEY-6): the orders are `/payments`' page, linked by the
// enrollment's id. Additive-only once merged (R-API-9).
import { z } from 'zod';

import { enrollmentStatus } from '../checkout.js';
import { sessionStatus } from '../enrollments.js';
import { idempotencyKey } from '../idempotency-key.js';
import { packageTrack } from '../packages.js';
import { adminReason } from './admins.js';
import { compensationCaseReason, monitorParty, remedyMonitor } from './sessions.js';

/** A case's state (`disputes.status`). */
export const caseStatus = z.enum(['open', 'resolved', 'dismissed']);

/** What a `/cases` row is: a compensation case, or a student's complaint of a teacher's absence. */
export const caseKind = z.enum(['compensation_case', 'absence_complaint']);

/**
 * A page of the list starts after this position: the queue's part (`first`, the open
 * `student_suspended` cases; `rest`, every other row) and the last case of the page before, each
 * part listed by its time-ordered id.
 */
export const casesListCursor = z
  .string()
  .regex(/^(first|rest):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const casesListInput = z.object({
  status: caseStatus.optional(),
  cursor: casesListCursor.optional(),
});

/** One row of the queue, with its enrollment's count and mark (FR-451, for administrators only). */
export const casesListItem = z.object({
  caseId: z.uuid(),
  kind: caseKind,
  enrollmentId: z.uuid(),
  /** A compensation case's reason; absent for a complaint, whose text is `cases.get`'s only. */
  reason: compensationCaseReason.optional(),
  status: caseStatus,
  openedAt: z.iso.datetime(),
  /** The closing instant, the database's clock (FR-422); absent while open. */
  closedAt: z.iso.datetime().optional(),
  teacherNoShows: z.int().nonnegative(),
  /** `teacherNoShows` at `repeated_absence_flag_count` or above (FR-451); nothing follows from it. */
  repeatedAbsence: z.boolean(),
});

export const casesListOutput = z.object({
  items: z.array(casesListItem),
  /** Present while more rows follow the page. */
  nextCursor: casesListCursor.optional(),
});

export const casesGetInput = z.object({ caseId: z.uuid() });

/** The case itself, as the queue's row shows it, with its closing when closed. */
export const caseDetail = casesListItem
  .omit({ teacherNoShows: true, repeatedAbsence: true })
  .extend({
    /** The closing's resolution (`disputes.resolution`); absent while open or with none. */
    resolution: z
      .enum(['compensation_ordered', 'enrollment_ended', 'party_suspended'])
      .optional(),
    /** The administrator's note at the closing; absent while open. */
    note: z.string().optional(),
  });

/** A complaint's decision (T060), read from its closing: `resolved` or `dismissed` and its resolution. */
export const complaintDecision = z.enum(['end_enrollment', 'suspend_teacher', 'close']);

/** A complaint of a teacher's absence: the student's text, its raising and its decision. */
export const caseComplaint = z.object({
  reason: z.string(),
  raisedAt: z.iso.datetime(),
  decision: complaintDecision.optional(),
});

/** The case's enrollment and its parties, with its count and mark (FR-451). */
export const caseEnrollment = z.object({
  enrollmentId: z.uuid(),
  student: monitorParty,
  teacher: monitorParty,
  status: enrollmentStatus,
  track: packageTrack,
  teacherNoShows: z.int().nonnegative(),
  repeatedAbsence: z.boolean(),
});

/** One session the case covers, with its remedy when it has one (no amount, FR-467). */
export const caseCoveredSession = z.object({
  sessionId: z.uuid(),
  sequenceNumber: z.int().positive(),
  status: sessionStatus,
  remedy: z
    .object({
      remedyId: z.uuid(),
      kind: remedyMonitor.shape.kind,
      status: remedyMonitor.shape.status,
    })
    .optional(),
});

export const casesGetOutput = z.object({
  case: caseDetail,
  complaint: caseComplaint.optional(),
  enrollment: caseEnrollment,
  /** By sequence number (research R-312, R-313; C1, I1, U1, U2). */
  covers: z.array(caseCoveredSession),
  /** The enrollment's orders on `/payments`; never an amount here. */
  paymentsLink: z.object({ enrollmentId: z.uuid() }),
});

/** A compensation case closed with the administrator's mandatory note. */
export const casesCloseInput = z.object({ caseId: z.uuid(), note: adminReason });

export const casesResolveInput = casesCloseInput;
export const casesResolveOutput = z.object({ caseId: z.uuid(), status: z.literal('resolved') });

export const casesDismissInput = casesCloseInput;
export const casesDismissOutput = z.object({ caseId: z.uuid(), status: z.literal('dismissed') });

/**
 * T064 (FR-471 (c), FR-493; research R-326; admin-surface.md, `cases.openManual`): an
 * administrator opens a compensation case for a party of any enrollment, in any state; a second
 * opening for the same party while its case is open joins it. With `remedyId` (a remedy is owed to
 * the student, so only with `party: 'student'`), the open remedy is handed to the student's manual
 * case. Keyed: a repeat with the same key answers the first result.
 */
export const casesOpenManualInput = z
  .object({
    enrollmentId: z.uuid(),
    party: z.enum(['student', 'teacher']),
    /** The administrator's reason, the audit entry's (R-326): 1 to 500 characters, not blank. */
    reason: z.string().trim().min(1).max(500),
    idempotencyKey,
    remedyId: z.uuid().optional(),
  })
  .refine(({ party, remedyId }) => remedyId === undefined || party === 'student', {
    message: 'A remedy is owed to the student.',
    path: ['remedyId'],
  });

export const casesOpenManualOutput = z.object({
  caseId: z.uuid(),
  enrollmentId: z.uuid(),
  party: z.enum(['student', 'teacher']),
  status: z.literal('open'),
  /** Whether the opening joined the party's case already open, writing no row. */
  joined: z.boolean(),
  /** The remedy handed to the case, with its session; absent with no `remedyId`. */
  handedRemedy: z.object({ remedyId: z.uuid(), sessionId: z.uuid() }).optional(),
});

export type CaseStatus = z.infer<typeof caseStatus>;
export type CaseKind = z.infer<typeof caseKind>;
export type CasesListInput = z.infer<typeof casesListInput>;
export type CasesListItem = z.infer<typeof casesListItem>;
export type CasesListOutput = z.infer<typeof casesListOutput>;
export type CasesGetInput = z.infer<typeof casesGetInput>;
export type CasesGetOutput = z.infer<typeof casesGetOutput>;
export type CaseDetail = z.infer<typeof caseDetail>;
export type CaseCoveredSession = z.infer<typeof caseCoveredSession>;
export type ComplaintDecision = z.infer<typeof complaintDecision>;
export type CasesCloseInput = z.infer<typeof casesCloseInput>;
export type CasesResolveOutput = z.infer<typeof casesResolveOutput>;
export type CasesDismissOutput = z.infer<typeof casesDismissOutput>;
export type CasesOpenManualInput = z.infer<typeof casesOpenManualInput>;
export type CasesOpenManualOutput = z.infer<typeof casesOpenManualOutput>;
