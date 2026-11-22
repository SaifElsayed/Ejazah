// T068: the administrator surface's `applications` namespace (admin-surface.md "`applications` — the
// verification queue"; FR-160 to FR-162, FR-166). The queue's three tabs (in review, waiting on the
// applicant, decided), searchable by the applicant's name or email as typed; the detail with the
// documents, the subjects, the qualification and the call record; the four decisions. A decision's
// choices are the dialog's (screens.md "AdminDecisionDialog"); its note is mandatory except an
// approval's and reaches the applicant as `application_note`. The call is known by its day: the
// panel sends the day and its zone, the zone used only to refuse a day after today there (owner's
// decision 2026-10-22).
import { z } from 'zod';

import { accountStatus, identityDocumentType, teacherApplicationStatus } from '../account.js';
import { subjectSummary } from '../catalog.js';
import { calendarDate, gender, timeZone } from '../onboarding.js';
import { credentialStatus } from '../teacher-credentials.js';
import { adminPage, adminReason, adminSearch } from './admins.js';

export const applicationsTab = z.enum(['in_review', 'waiting', 'decided']);

export const callOutcome = z.enum(['suitable', 'unsuitable']);

/** `AdminDecisionDialog` «سبب الرفض». */
export const rejectReasonChoice = z.enum([
  'name_mismatch',
  'qualification_gap',
  'call_unsuitable',
  'other',
]);

/**
 * `AdminDecisionDialogInfo` «ما المطلوب». Another ijazah is asked for on its credential,
 * `credentials.requestDocument`, which gives the applicant the field to send it (T155).
 * @deprecated `ijazah_unreadable`: the panel no longer offers it; it stays published until the
 * contract gate has a path to deprecate and then remove a value (R-API-9, T154).
 */
export const requestInfoChoice = z.enum([
  'id_unclear',
  'ijazah_unreadable',
  'name_mismatch',
  'other',
]);

/** `AdminDecisionDialog` «سبب الحظر». */
export const banReasonChoice = z.enum(['forged_documents', 'impersonation', 'call_fraud', 'other']);

export const applicationsListInput = z.object({
  tab: applicationsTab,
  search: adminSearch.optional(),
  page: adminPage,
});

export const applicationsListRow = z.object({
  teacherUserId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  gender,
  /** Under eighteen today, computed on read and stored nowhere (FR-132). */
  isMinor: z.boolean(),
  subjects: z.array(subjectSummary),
  callRecordedOn: calendarDate.optional(),
  submittedAt: z.iso.datetime(),
  status: teacherApplicationStatus.exclude(['not_started']),
});

export const applicationsListOutput = z.object({
  rows: z.array(applicationsListRow),
  total: z.int().min(0),
  /** `admin_list_page_size`, so the panel's pager counts the pages (B14b, owner's decision). */
  pageSize: z.int().min(1),
});

export const applicationsGetInput = z.object({ teacherUserId: z.uuid() });

/** An identity request open on the applicant (`users.requireIdentity`, FR-166), for its two actions. */
export const openIdentityRequest = z.object({
  requestId: z.uuid(),
  reason: z.string(),
  requestedAt: z.iso.datetime(),
  document: z
    .object({ documentId: z.uuid(), type: identityDocumentType, submittedAt: z.iso.datetime() })
    .optional(),
});

/**
 * R1a (002:T174; SRS DEC-97; `contracts/admin-surface.md`, the decision history): what one row of the
 * application's history records (`teacher_application_history_action`).
 */
export const applicationHistoryAction = z.enum([
  'approve',
  'reject',
  'request_info',
  'ban',
  'revoke',
]);

/** One decision on the application or one revocation of approval, its note, who and when. */
export const applicationHistoryEntry = z.object({
  action: applicationHistoryAction,
  /** The decision's note; absent on an approval with none. */
  note: z.string().optional(),
  /** The administrator's display name. */
  adminName: z.string(),
  at: z.iso.datetime(),
});

export const applicationsGetOutput = applicationsListRow.extend({
  qualificationSummary: z.string(),
  /** The applicant's IANA zone, which the panel shows as its city. */
  timezoneCity: z.string(),
  /** The account's standing: «طلب إثبات هوية» is offered on an active account alone (B14b-2). */
  accountStatus,
  identityDocument: z.object({
    documentId: z.uuid(),
    type: identityDocumentType,
    uploadedAt: z.iso.datetime(),
  }),
  credentials: z.array(
    z.object({
      credentialId: z.uuid(),
      subject: subjectSummary,
      status: credentialStatus,
      documentId: z.uuid(),
    }),
  ),
  call: z.object({
    completedOn: calendarDate.optional(),
    outcome: callOutcome.optional(),
    notes: z.string().optional(),
  }),
  note: z.string().optional(),
  identityRequest: openIdentityRequest.optional(),
  /**
   * B42b, T075 of specs/004-sessions (the note under T075, Q-O2 (a)): `ban_restore_window_days`,
   * the days a ban's closing holds its slot (DEC-66, DEC-69), for the panel's `{days}` in an approved
   * teacher's ban. Additive (R-API-9).
   */
  banRestoreWindowDays: z.int().positive(),
  /**
   * R1a (002:T174; SRS DEC-97): the application's history, oldest first: each decision's note, kept
   * after a later decision overwrites `note`; the audit log keeps the entries without the text.
   * Additive (R-API-9).
   */
  history: z.array(applicationHistoryEntry),
});

export const applicationsRecordCallInput = z.object({
  teacherUserId: z.uuid(),
  completedOn: calendarDate,
  /** The panel's zone: the day may not be after today there. */
  timeZone,
  outcome: callOutcome,
  notes: z.string().trim().min(1).max(2000),
});

export const applicationsApproveInput = z.object({
  teacherUserId: z.uuid(),
  note: adminReason.optional(),
});

export const applicationsRejectInput = z.object({
  teacherUserId: z.uuid(),
  reasonChoice: rejectReasonChoice,
  note: adminReason,
});

export const applicationsRequestInfoInput = z.object({
  teacherUserId: z.uuid(),
  needed: z.array(requestInfoChoice).min(1),
  note: adminReason,
});

export const applicationsBanInput = z.object({
  teacherUserId: z.uuid(),
  reasonChoice: banReasonChoice,
  note: adminReason,
});
