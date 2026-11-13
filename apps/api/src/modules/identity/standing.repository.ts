// T068: an account's standing as the administrator changes it (FR-165, FR-166, FR-162), over this
// module's `users` and `teacher_profiles`. Every write is conditional on the state it moves from,
// decided by the database, so two administrators racing on one person cannot both move it; a write
// answers whether it landed. Each runs on the administrator kind's transaction it is handed.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

type Client = Pick<Transaction, 'user' | 'teacherProfile'>;

export type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';

/** A live person's standing, the teacher's when there is a profile. */
export interface Standing {
  readonly accountStatus: AccountStatus;
  readonly teacher: {
    readonly verificationStatus:
      'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
    readonly applicationStatus:
      'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved' | null;
  } | null;
}

/** A decision on the profile: who decided, when, and the note the person sees when there is one. */
export interface ProfileDecision {
  readonly adminId: string;
  readonly at: Date;
  readonly note: string;
}

/** The live person's standing; null for a person not there or deleted. */
export async function readStanding(tx: Client, userId: string): Promise<Standing | null> {
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      accountStatus: true,
      teacherProfile: { select: { verificationStatus: true, applicationStatus: true } },
    },
  });
  if (user === null) return null;
  return { accountStatus: user.accountStatus, teacher: user.teacherProfile };
}

/**
 * Locks the account's `users` row until the transaction ends (T126): a move that reads the standing
 * before it writes takes it first, so a concurrent move on the account waits, then reads what this
 * one left.
 */
export async function lockAccount(tx: Transaction, userId: string): Promise<void> {
  await lockRows(tx, 'users', [userId]);
}

/** Moves the live account from one of `from` to `to`; whether it did. */
export async function moveAccountStatus(
  tx: Client,
  userId: string,
  from: readonly AccountStatus[],
  to: AccountStatus,
): Promise<boolean> {
  const { count } = await tx.user.updateMany({
    where: { id: userId, deletedAt: null, accountStatus: { in: [...from] } },
    data: { accountStatus: to },
  });
  return count === 1;
}

/**
 * Revokes an approved teacher's approval: `revoked`, and the application `rejected` with the reason
 * as the note, so the teacher lands on `ApplicationRejected` and returns through `reapply`.
 */
export async function revokeTeacherApproval(
  tx: Client,
  userId: string,
  decision: ProfileDecision,
): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: { userId, verificationStatus: 'approved' },
    data: {
      verificationStatus: 'revoked',
      applicationStatus: 'rejected',
      applicationNote: decision.note,
      applicationDecidedAt: decision.at,
      applicationDecidedByAdminId: decision.adminId,
    },
  });
  return count === 1;
}

/** A profile's two statuses, as T069's `*_before_ban` columns keep them through a ban (T072). */
export interface ProfileStatuses {
  readonly verificationStatus: NonNullable<Standing['teacher']>['verificationStatus'];
  readonly applicationStatus: NonNullable<Standing['teacher']>['applicationStatus'];
}

/**
 * A ban on the profile: an approved teacher's, or an applicant's with the decision. T072: `before`,
 * the statuses read under the application's lock, kept in T069's two columns for the lift.
 */
export type ProfileBan = { readonly before: ProfileStatuses } & (
  { readonly kind: 'teacher' } | ({ readonly kind: 'applicant' } & ProfileDecision)
);

/**
 * Bans the profile: a teacher approved or whose approval was revoked, or an open or rejected
 * application (`in_review`, `needs_document`, `rejected`) with the note the applicant sees. T072:
 * the statuses before the ban written to `verification_status_before_ban` and
 * `application_status_before_ban`, conditional on the profile still holding them.
 */
export async function banTeacherProfile(
  tx: Client,
  userId: string,
  ban: ProfileBan,
): Promise<boolean> {
  const { before } = ban;
  const kept = {
    verificationStatusBeforeBan: before.verificationStatus,
    applicationStatusBeforeBan: before.applicationStatus,
  };
  const held = {
    verificationStatus: before.verificationStatus,
    applicationStatus: before.applicationStatus,
  };
  const { count } =
    ban.kind === 'teacher'
      ? await tx.teacherProfile.updateMany({
          where: {
            userId,
            AND: [{ verificationStatus: { in: ['approved', 'revoked'] } }, held],
          },
          data: { verificationStatus: 'banned', ...kept },
        })
      : await tx.teacherProfile.updateMany({
          where: {
            userId,
            AND: [{ applicationStatus: { in: ['in_review', 'needs_document', 'rejected'] } }, held],
          },
          data: {
            verificationStatus: 'banned',
            applicationStatus: 'banned',
            applicationNote: ban.note,
            applicationDecidedAt: ban.at,
            applicationDecidedByAdminId: ban.adminId,
            ...kept,
          },
        });
  return count === 1;
}

/**
 * T072 (FR-502; SRS DEC-66): bans the live account from one of `from`, writing `banned_at` (rule 50:
 * a ban's instant only on a banned account) in the same statement; whether it did.
 */
export async function banAccountStatus(
  tx: Client,
  userId: string,
  from: readonly AccountStatus[],
  at: Date,
): Promise<boolean> {
  const { count } = await tx.user.updateMany({
    where: { id: userId, deletedAt: null, accountStatus: { in: [...from] } },
    data: { accountStatus: 'banned', bannedAt: at },
  });
  return count === 1;
}

/**
 * T072: lifts the live account's ban to `to`, `banned_at` cleared in the same statement (rule 50);
 * whether it did.
 */
export async function liftAccountBanStatus(
  tx: Client,
  userId: string,
  to: Exclude<AccountStatus, 'banned'>,
): Promise<boolean> {
  const { count } = await tx.user.updateMany({
    where: { id: userId, deletedAt: null, accountStatus: 'banned' },
    data: { accountStatus: to, bannedAt: null },
  });
  return count === 1;
}

/**
 * T072: the profile's statuses before its ban (T069's two columns); null when the profile has none
 * or holds none (a profile banned before T069 wrote them, which no launched app has).
 */
export async function readStatusesBeforeBan(
  tx: Client,
  userId: string,
): Promise<ProfileStatuses | null> {
  const profile = await tx.teacherProfile.findUnique({
    where: { userId },
    select: { verificationStatusBeforeBan: true, applicationStatusBeforeBan: true },
  });
  if (profile?.verificationStatusBeforeBan == null) return null;
  return {
    verificationStatus: profile.verificationStatusBeforeBan,
    applicationStatus: profile.applicationStatusBeforeBan,
  };
}

/**
 * T072: a banned profile back to its statuses before the ban, the two columns cleared; the
 * application's note and decision instant left as history. Whether it did.
 */
export async function liftTeacherProfileBan(
  tx: Client,
  userId: string,
  before: ProfileStatuses,
): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: {
      userId,
      verificationStatus: 'banned',
      verificationStatusBeforeBan: before.verificationStatus,
    },
    data: {
      verificationStatus: before.verificationStatus,
      applicationStatus: before.applicationStatus,
      verificationStatusBeforeBan: null,
      applicationStatusBeforeBan: null,
    },
  });
  return count === 1;
}

/**
 * T072 (FR-502): a revoked teacher's approval back, the profile and the application `approved`; the
 * revocation's note and decision instant left as history. Whether it did.
 */
export async function restoreTeacherApproval(tx: Client, userId: string): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: { userId, verificationStatus: 'revoked' },
    data: { verificationStatus: 'approved', applicationStatus: 'approved' },
  });
  return count === 1;
}
