// B42, T058 (FR-481): how `/users` names what the server answered: a role, an account status and a
// teacher's verification status, each by its catalogue key. B42b, T075: a lift's results and refusals.
import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import { type AdminClient, errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
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

// B42b, T075 of specs/004-sessions (FR-502; DEC-69; N11; admin-surface.md, the lifts): each
// enrollment's result of a lift, and the lift's refusals, in plain words by their code and
// `details.cause`; any other failure the generic words through `errorMessageKey`, which says when to
// try again on `RATE_LIMITED`.

/** Why a lift left one enrollment ended (`banLiftEnrollmentCause`). */
export type LiftCause = NonNullable<LiftedEnrollment['cause']>;

/** One enrollment as a lift left it. */
export type LiftedEnrollment = Awaited<
  ReturnType<AdminClient['api']['students']['liftBan']['mutate']>
>['enrollments'][number];

const LIFT_CAUSE: Readonly<Record<LiftCause, MessageKey>> = {
  not_restorable: 'admin.users.lift.result.notRestorable',
  case_closed: 'admin.users.lift.result.caseClosed',
  party_restricted: 'admin.users.lift.result.partyRestricted',
  slot_inactive: 'admin.users.lift.result.slotInactive',
  slot_changed: 'admin.users.lift.result.slotChanged',
  slot_taken: 'admin.users.lift.result.slotTaken',
  time_taken: 'admin.users.lift.result.timeTaken',
  refunded: 'admin.users.lift.result.refunded',
  gender_mismatch: 'admin.users.lift.result.genderMismatch',
};

/** An enrollment's result: restored, or the cause that left it ended. */
export function liftResult(enrollment: LiftedEnrollment): MessageKey {
  if (enrollment.restored || enrollment.cause === undefined) {
    return 'admin.users.lift.result.restored';
  }
  return LIFT_CAUSE[enrollment.cause];
}

/** A refused lift's words, and the enrollment `restore_failed` names, when it names one. */
export interface LiftFailure extends ErrorMessage {
  readonly enrollmentId?: string;
}

/** The value of a refusal's detail at `path`. */
function detailOf(error: unknown, path: string): string | undefined {
  return errorDetailsOf(error).find((each) => each.path === path)?.code;
}

/** The words of a refused lift (`not_banned`, `not_revoked`, `restore_failed`, `NOT_FOUND`). */
export function liftFailure(error: unknown): LiftFailure {
  switch (errorCodeOf(error)) {
    case 'CONFLICT': {
      const cause = detailOf(error, 'cause');
      if (cause === 'not_banned') return { key: 'admin.users.lift.refused.notBanned' };
      if (cause === 'not_revoked') return { key: 'admin.users.lift.refused.notRevoked' };
      if (cause === 'restore_failed') {
        const enrollmentId = detailOf(error, 'enrollmentId');
        // A second deadlock names no enrollment (Q-D2 (a)).
        return enrollmentId === undefined
          ? { key: 'admin.users.lift.refused.busy' }
          : { key: 'admin.users.lift.refused.restoreFailed', enrollmentId };
      }
      return { key: 'admin.shared.keyReused' };
    }
    case 'NOT_FOUND':
      return { key: 'admin.users.lift.refused.notFound' };
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}
