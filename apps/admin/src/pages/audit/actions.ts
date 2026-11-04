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
