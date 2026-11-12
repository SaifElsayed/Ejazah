// B42, T058 (FR-481): how `/users` names what the server answered: a role, an account status and a
// teacher's verification status, each by its catalogue key.
import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import type { UserRecord, UserRow } from './queries';

export type Role = NonNullable<UserRow['role']>;
type AccountStatus = UserRow['accountStatus'];
type VerificationStatus = NonNullable<UserRecord['verificationStatus']>;

interface Drawn {
  readonly label: MessageKey;
  readonly tone: StatusTone;
}

export const ACCOUNT_STATUS: Readonly<Record<AccountStatus, Drawn>> = {
  active: { label: 'admin.status.account.active', tone: 'success' },
  suspended: { label: 'admin.status.account.suspended', tone: 'danger' },
  verification_required: { label: 'admin.status.account.verificationPending', tone: 'warning' },
  banned: { label: 'admin.status.account.banned', tone: 'danger' },
};

export const VERIFICATION_STATUS: Readonly<Record<VerificationStatus, MessageKey>> = {
  pending: 'admin.users.record.verificationStatus.pending',
  approved: 'admin.users.record.verificationStatus.approved',
  rejected: 'admin.users.record.verificationStatus.rejected',
  suspended: 'admin.users.record.verificationStatus.suspended',
  banned: 'admin.users.record.verificationStatus.banned',
  revoked: 'admin.users.record.verificationStatus.revoked',
};

const ROLE: Readonly<Record<Role, MessageKey>> = {
  student: 'admin.common.role.student',
  teacher: 'admin.common.role.teacher',
};

/** A role's words; an account with none says so. */
export function roleLabel(role: Role | null): MessageKey {
  return role === null ? 'admin.users.directory.noRole' : ROLE[role];
}
