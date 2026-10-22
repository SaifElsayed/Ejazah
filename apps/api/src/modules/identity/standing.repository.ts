// T068: an account's standing as the administrator changes it (FR-165, FR-166, FR-162), over this
// module's `users` and `teacher_profiles`. Every write is conditional on the state it moves from,
// decided by the database, so two administrators racing on one person cannot both move it; a write
// answers whether it landed. Each runs on the administrator kind's transaction it is handed.
import type { Transaction } from '../../platform/db/prisma.repository.js';

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

/** A ban on the profile: an approved teacher's, or an applicant's with the decision. */
export type ProfileBan =
  { readonly kind: 'teacher' } | ({ readonly kind: 'applicant' } & ProfileDecision);

/**
 * Bans the profile: a teacher approved or whose approval was revoked, or an open or rejected
 * application (`in_review`, `needs_document`, `rejected`) with the note the applicant sees.
 */
export async function banTeacherProfile(
  tx: Client,
  userId: string,
  ban: ProfileBan,
): Promise<boolean> {
  const { count } =
    ban.kind === 'teacher'
      ? await tx.teacherProfile.updateMany({
          where: { userId, verificationStatus: { in: ['approved', 'revoked'] } },
          data: { verificationStatus: 'banned' },
        })
      : await tx.teacherProfile.updateMany({
          where: { userId, applicationStatus: { in: ['in_review', 'needs_document', 'rejected'] } },
          data: {
            verificationStatus: 'banned',
            applicationStatus: 'banned',
            applicationNote: ban.note,
            applicationDecidedAt: ban.at,
            applicationDecidedByAdminId: ban.adminId,
          },
        });
  return count === 1;
}
