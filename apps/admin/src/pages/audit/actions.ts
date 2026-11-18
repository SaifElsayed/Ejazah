// T073 (FR-175, FR-176): how the panel names a log entry, for the audit and the home. The stored
// action (`teacher.suspend`) by the catalogue's sentence, the board's own where it draws the action
// (T067's note: the keys were named for the board's rows; the mapping is the page's); an action the
// panel does not know yet is shown as stored. The target by its type and its current name, the type
// alone when it has none (ADR 0021: the stored label is not shown in place of the name), and a link
// to its page where this phase has one.
import type { MessageKey, useT } from '../../i18n';
import type { AdminClient } from '../../lib/client';

export type AuditRow = Awaited<
  ReturnType<AdminClient['api']['audit']['list']['query']>
>['rows'][number];

const ACTION_TEXT: Readonly<Record<string, MessageKey>> = {
  'admin.add': 'admin.audit.actions.adminAdd',
  'admin.disable': 'admin.audit.actions.adminDisable',
  'admin.reset_mfa': 'admin.audit.actions.adminResetMfa',
  'admin.regenerate_recovery_codes': 'admin.audit.actions.adminRegenerateRecoveryCodes',
  'admin.sign_out': 'admin.audit.actions.adminSignOut',
  'application.approve': 'admin.audit.actions.applicationApprove',
  'application.ban': 'admin.audit.actions.applicationBan',
  'application.reject': 'admin.audit.actions.rejectApplication',
  'application.request_info': 'admin.audit.actions.requestMoreInfo',
  'application.record_call': 'admin.audit.actions.recordVerificationCall',
  'credential.approve': 'admin.audit.actions.approveTeacherCredential',
  'credential.reject': 'admin.audit.actions.credentialReject',
  'credential.request_document': 'admin.audit.actions.credentialRequestDocument',
  'credential.correct': 'admin.audit.actions.credentialCorrect',
  'document.view': 'admin.audit.actions.documentView',
  'payments.listed': 'admin.audit.actions.paymentsListed',
  'payments.viewed': 'admin.audit.actions.paymentsViewed',
  'teacher.approve': 'admin.audit.actions.teacherApprove',
  'teacher.ban': 'admin.audit.actions.teacherBan',
  'teacher.reinstate': 'admin.audit.actions.teacherReinstate',
  'teacher.revoke': 'admin.audit.actions.teacherRevoke',
  'teacher.suspend': 'admin.audit.actions.teacherSuspend',
  'user.require_identity': 'admin.audit.actions.userRequireIdentity',
  'verification_request.accept': 'admin.audit.actions.verificationRequestAccept',
  'verification_request.request_another': 'admin.audit.actions.verificationRequestRequestAnother',
  // Phase 3's T002 (specs/004-sessions/contracts/admin-surface.md, "The audit actions' names";
  // the owner's decision of 2026-11-06, M3): the twenty-eight actions the phase records.
  'sessions.monitor.listed': 'admin.audit.actions.sessionsMonitorListed',
  'sessions.monitor.viewed': 'admin.audit.actions.sessionsMonitorViewed',
  'sessions.review.listed': 'admin.audit.actions.sessionsReviewListed',
  'sessions.review.viewed': 'admin.audit.actions.sessionsReviewViewed',
  'provider_outages.listed': 'admin.audit.actions.providerOutagesListed',
  'disputes.listed': 'admin.audit.actions.disputesListed',
  'dispute.viewed': 'admin.audit.actions.disputeViewed',
  'cases.listed': 'admin.audit.actions.casesListed',
  'case.viewed': 'admin.audit.actions.caseViewed',
  'users.listed': 'admin.audit.actions.usersListed',
  'user.viewed': 'admin.audit.actions.userViewed',
  'chat.read': 'admin.audit.actions.chatRead',
  'dispute.held_files_listed': 'admin.audit.actions.disputeHeldFilesListed',
  'held_file.view': 'admin.audit.actions.heldFileView',
  'session.cancelled': 'admin.audit.actions.sessionCancelled',
  'enrollment.restored': 'admin.audit.actions.enrollmentRestored',
  'session.review_resolved': 'admin.audit.actions.sessionReviewResolved',
  'session.outcome_corrected': 'admin.audit.actions.sessionOutcomeCorrected',
  'provider_outage.recorded': 'admin.audit.actions.providerOutageRecorded',
  'dispute.resolved': 'admin.audit.actions.disputeResolved',
  'dispute.revised': 'admin.audit.actions.disputeRevised',
  'case.resolved': 'admin.audit.actions.caseResolved',
  'case.dismissed': 'admin.audit.actions.caseDismissed',
  'case.opened_manually': 'admin.audit.actions.caseOpenedManually',
  'complaint.decided': 'admin.audit.actions.complaintDecided',
  'student.suspend': 'admin.audit.actions.studentSuspend',
  'student.ban': 'admin.audit.actions.studentBan',
  'student.reinstate': 'admin.audit.actions.studentReinstate',
  // B42b, T075 of specs/004-sessions (the follow-ups under T070 and T072): T070's release and
  // T072's three lifts.
  'enrollment.slot_released': 'admin.audit.actions.enrollmentSlotReleased',
  'student.ban_lifted': 'admin.audit.actions.studentBanLifted',
  'teacher.ban_lifted': 'admin.audit.actions.teacherBanLifted',
  'teacher.revocation_lifted': 'admin.audit.actions.teacherRevocationLifted',
  // B42c, T083 of specs/004-sessions (Q-R7 (a)): T082's direct end, T077's kept document opened and
  // its erase date set, cleared and carried out, and T081's deletion at the owner's request.
  'enrollment.ended_by_admin': 'admin.audit.actions.enrollmentEndedByAdmin',
  'kept_document.view': 'admin.audit.actions.keptDocumentView',
  // 005:T031 of specs/005-certification (Q-D2 (a)): a deleted teacher's kept signature opened.
  'kept_signature.view': 'admin.audit.actions.keptSignatureView',
  'teacher.kept_data.erase_date_set': 'admin.audit.actions.teacherKeptDataEraseDateSet',
  'teacher.kept_data.erase_date_cleared': 'admin.audit.actions.teacherKeptDataEraseDateCleared',
  'teacher.kept_data.erased': 'admin.audit.actions.teacherKeptDataErased',
  'user.deleted_by_admin': 'admin.audit.actions.userDeletedByAdmin',
  // 005:T007 of B46 (Q-C3 (a)): the administrators' review of an ijazah request.
  'ijazah_requests.listed': 'admin.audit.actions.ijazahReview.listed',
  'ijazah_request.viewed': 'admin.audit.actions.ijazahReview.viewed',
  'ijazah.issued': 'admin.audit.actions.ijazahReview.issued',
  'ijazah_request.rejected': 'admin.audit.actions.ijazahReview.rejected',
  // 005:T010 of B46 (Q-E4 (a)): an administrator's ijazahs, their revocation and the bar.
  'ijazahs.listed': 'admin.audit.actions.ijazahReview.ijazahsListed',
  'ijazah.viewed': 'admin.audit.actions.ijazahReview.ijazahViewed',
  'ijazah.revoked': 'admin.audit.actions.ijazahReview.ijazahRevoked',
  'ijazah_bar.set': 'admin.audit.actions.ijazahReview.barSet',
  'ijazah_bar.lifted': 'admin.audit.actions.ijazahReview.barLifted',
  // 005:T032 of B46 (Q-E4 (a)): the sign-off and the re-render.
  'ijazah.signed_off': 'admin.audit.actions.ijazahReview.ijazahSignedOff',
  'ijazah.rerendered': 'admin.audit.actions.ijazahReview.ijazahRerendered',
};

const TARGET_TEXT: Readonly<Record<AuditRow['targetType'], MessageKey>> = {
  user: 'admin.audit.targets.user',
  teacher_application: 'admin.audit.targets.teacherApplication',
  credential: 'admin.audit.targets.credential',
  document: 'admin.audit.targets.document',
  verification_request: 'admin.audit.targets.verificationRequest',
  admin: 'admin.audit.targets.admin',
  setting: 'admin.audit.targets.setting',
  payment: 'admin.audit.targets.payment',
  enrollment: 'admin.audit.targets.enrollment',
  dispute: 'admin.audit.targets.dispute',
  session: 'admin.audit.targets.session',
  provider_outage: 'admin.audit.targets.providerOutage',
  // 005:T007 of B46 (Q-C3 (a)).
  ijazah_request: 'admin.audit.targets.ijazahReview.request',
  ijazah: 'admin.audit.targets.ijazahReview.ijazah',
};

type Translate = ReturnType<typeof useT>;

/** The action as the panel names it; as stored when the panel names it not. */
export function actionText(action: string, t: Translate): string {
  const key = ACTION_TEXT[action];
  return key === undefined ? action : t(key);
}

/** The target by its type and its current name, or its type alone. */
export function targetText(row: Pick<AuditRow, 'targetType' | 'targetName'>, t: Translate): string {
  const type = t(TARGET_TEXT[row.targetType]);
  return row.targetName === undefined
    ? type
    : t('admin.audit.targetNamed', { type, name: row.targetName });
}

/** The target's page in this phase: an application's, a credential's or a payment order's. */
export function targetHref(row: Pick<AuditRow, 'targetType' | 'targetId'>): string | undefined {
  switch (row.targetType) {
    case 'teacher_application':
      return `/applications?teacher=${row.targetId}`;
    case 'credential':
      return `/credentials?credential=${row.targetId}`;
    case 'payment':
      return `/payments?payment=${row.targetId}`;
    default:
      return undefined;
  }
}
