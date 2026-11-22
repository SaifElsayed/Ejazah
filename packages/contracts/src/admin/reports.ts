// T011 of specs/005-certification: the administrator surface's `reports` namespace
// (contracts/admin-surface.md, `reports.*`; FR-612; research R-408; the note under T011, Q-R3 (a)).
//
// The queue lists reports by status, the open ones unless said, a report id as the cursor (a UUIDv7,
// so the order is the order of reporting); each item carries its context and the session or
// enrollment it came from, the evidence an administrator opens. `get` adds the reporter's reason and,
// once resolved, the outcome, the administrator's note (`user_reports.resolution_notes`), when and
// by whom. `resolve` marks an open report `actioned` or `dismissed` with a note, keyed
// (`idempotencyKey`), and is refused `already_resolved` once it is not open. The people are ids
// only: the panel reads their names where it shows them. Additive only once merged (R-API-9).
import { z } from 'zod';

import { idempotencyKey } from '../idempotency-key.js';
import { reportContext } from '../reports.js';
import { adminReason } from './admins.js';
import { disputesChatOutput } from './disputes.js';

/** A report's state (`user_report_status`, ERD §10). */
export const reportStatus = z.enum(['open', 'actioned', 'dismissed']);

/** How an administrator closes a report (FR-612). */
export const reportOutcome = z.enum(['actioned', 'dismissed']);

/** `reports.resolve`'s refusal, CONFLICT with this code: the report is no longer open. */
export const reportResolveRefusal = z.enum(['already_resolved']);

export const adminReportsListInput = z.object({
  /** The queue's open reports unless said. */
  status: reportStatus.default('open'),
  /** The last report id of the previous page. */
  cursor: z.uuid().optional(),
});

export const adminReportsListItem = z.object({
  reportId: z.uuid(),
  context: reportContext,
  status: reportStatus,
  reporterUserId: z.uuid(),
  reportedUserId: z.uuid(),
  /** A session report's session (the evidence link); null otherwise. */
  sessionId: z.uuid().nullable(),
  /** A session or chat report's enrollment, set by the server (R-408); null for a profile. */
  enrollmentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const adminReportsListOutput = z.object({
  items: z.array(adminReportsListItem),
  nextCursor: z.uuid().optional(),
});

export const adminReportsGetInput = z.object({ reportId: z.uuid() });

/** A report's closing: the outcome, the administrator's note, when and by whom (FR-612). */
export const reportResolution = z.object({
  outcome: reportOutcome,
  note: z.string().nullable(),
  resolvedAt: z.iso.datetime(),
  resolvedByAdminId: z.uuid(),
});

export const adminReportsGetOutput = adminReportsListItem.extend({
  /** The reporter's words, free text (Q-R8 (a)). */
  reason: z.string(),
  resolution: reportResolution.nullable(),
  /** 005:T034: an open report that names an enrollment opens its chat (`reports.chat`). */
  chatAvailable: z.boolean(),
});

export const adminReportsResolveInput = z.object({
  reportId: z.uuid(),
  outcome: reportOutcome,
  note: adminReason,
  idempotencyKey,
});

// 005:T034 (R1a; SRS FR-SESS-13 as amended, DEC-100; the note under T034): an open session or chat
// report's enrollment chat, read-only. The input names the enrollment the panel was shown, so a
// report and an enrollment that do not belong together are refused; the page is `disputes.chat`'s.
export const adminReportsChatInput = z.object({
  reportId: z.uuid(),
  enrollmentId: z.uuid(),
  /** The last message id of the previous page. */
  cursor: z.uuid().optional(),
});

export const adminReportsChatOutput = disputesChatOutput;

export type ReportStatus = z.infer<typeof reportStatus>;
export type ReportOutcome = z.infer<typeof reportOutcome>;
export type ReportResolveRefusal = z.infer<typeof reportResolveRefusal>;
export type AdminReportsListInput = z.infer<typeof adminReportsListInput>;
export type AdminReportsListItem = z.infer<typeof adminReportsListItem>;
export type AdminReportsListOutput = z.infer<typeof adminReportsListOutput>;
export type AdminReportsGetInput = z.infer<typeof adminReportsGetInput>;
export type AdminReportsGetOutput = z.infer<typeof adminReportsGetOutput>;
export type AdminReportsResolveInput = z.infer<typeof adminReportsResolveInput>;
export type AdminReportsChatInput = z.infer<typeof adminReportsChatInput>;
export type AdminReportsChatOutput = z.infer<typeof adminReportsChatOutput>;
