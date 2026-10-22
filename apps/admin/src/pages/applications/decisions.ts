// T071 (FR-161, FR-162): what the panel may do with an application, read from its detail as the
// server rules it (admin-surface.md "`applications`"), so a button is never offered that the server
// refuses. Approval waits for the three conditions of `APPROVAL_BLOCKED`, each said by one sentence
// that the disabled button and the server's refusal share (owner's decision at B14b's check).
import type { MessageKey } from '../../i18n';
import type { ApplicationDetail } from './queries';

export type BlockedReason = 'call_not_recorded' | 'credential_undecided' | 'none_approved';

/** The sentence of each reason, for the panel and for the server's `APPROVAL_BLOCKED` alike. */
export const BLOCKED_TEXT: Readonly<Record<BlockedReason, MessageKey>> = {
  call_not_recorded: 'admin.applications.blocked.callNotRecorded',
  credential_undecided: 'admin.applications.blocked.credentialUndecided',
  none_approved: 'admin.applications.blocked.noneApproved',
};

export function isBlockedReason(code: string): code is BlockedReason {
  return code in BLOCKED_TEXT;
}

/** Why `approve` would be refused now: `application-review.service.ts`'s three reasons. */
export function blockedReasons(detail: ApplicationDetail): readonly BlockedReason[] {
  return [
    ...(detail.call.completedOn === undefined ? (['call_not_recorded'] as const) : []),
    ...(detail.credentials.some(({ status }) => status === 'pending' || status === 'needs_document')
      ? (['credential_undecided'] as const)
      : []),
    ...(detail.credentials.some(({ status }) => status === 'approved')
      ? []
      : (['none_approved'] as const)),
  ];
}

export interface Allowed {
  readonly approve: boolean;
  readonly requestInfo: boolean;
  readonly reject: boolean;
  readonly ban: boolean;
  readonly recordCall: boolean;
}

/**
 * The actions an application's status admits: `approve` and `requestInfo` an application in
 * review; `reject` and the call one still open; `ban` one open or rejected.
 */
export function allowedFor(status: ApplicationDetail['status']): Allowed {
  const open = status === 'in_review' || status === 'needs_document';
  return {
    approve: status === 'in_review',
    requestInfo: status === 'in_review',
    reject: open,
    ban: open || status === 'rejected',
    recordCall: open,
  };
}

/** The status badge of an application. */
export const STATUS_TEXT: Readonly<Record<ApplicationDetail['status'], MessageKey>> = {
  in_review: 'admin.status.application.inReview',
  needs_document: 'admin.status.application.waitingOnApplicant',
  approved: 'admin.status.application.approved',
  rejected: 'admin.status.application.rejected',
  banned: 'admin.status.application.banned',
};
