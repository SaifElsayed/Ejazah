// R1a (002:T174; SRS DEC-97, FR-AUTH-14, FR-ADMIN-17 as amended; ERD §2 `teacher_application_history`,
// §15 rules 67 and 69; the note under T174, Q-2 (a)): the application's history, one row per
// decision on the application (approve, reject, a request for information, a ban) and per revocation
// of approval, with its note, the administrator and the instant. The audit entry records only that a
// note was given; the text is here, so an earlier note survives a later decision overwriting
// `application_note`. Queries only, each on the transaction it is handed.
//
// THE LOCK. Every writer already holds the profile FOR UPDATE (`row-lock.ts`, `users` then
// `teacher_profiles`): verification's approve, reject and requestInfo through `lockApplication`,
// standing's ban and revocation after the account's lock. `record` takes no lock of its own and
// reads no `users` row: the profile's id never changes, and the insert's foreign-key check takes the
// key-share lock on the profile this transaction already holds.
//
// THE ERASURE (Q-2 (a)). UPDATE and TRUNCATE are revoked from `ijazah_app` (rule 69); DELETE stays,
// for the deletion of a teacher never approved alone (an applicant never approved keeps nothing). So
// `eraseOf` reads `approved_at` under the account's lock the deletion holds and refuses, by throwing,
// a teacher once approved, whose history is kept with no end date (DEC-97). Nothing else deletes from
// the table (`application-history.repository.spec.ts` reads the source).
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'teacherProfile' | 'teacherApplicationHistory'>;

/** `teacher_application_history_action`. */
export type ApplicationHistoryAction = 'approve' | 'reject' | 'request_info' | 'ban' | 'revoke';

/** One decision to record: whose application, what, its note (null only on approve), who and when. */
export interface ApplicationHistoryEntry {
  readonly teacherUserId: string;
  readonly action: ApplicationHistoryAction;
  readonly note: string | null;
  readonly adminId: string;
  readonly at: Date;
}

/** One recorded decision as the panel reads it. */
export interface ApplicationHistoryRow {
  readonly action: ApplicationHistoryAction;
  readonly note: string | null;
  readonly adminName: string;
  readonly at: Date;
}

/** Inserts the decision's row on the teacher's profile, which the caller holds locked. */
export async function record(tx: Client, entry: ApplicationHistoryEntry): Promise<void> {
  const profile = await tx.teacherProfile.findUnique({
    where: { userId: entry.teacherUserId },
    select: { id: true },
  });
  // A decision lands only on a profile, so a missing one is a caller's error, never a refusal.
  if (profile === null) throw new Error('application history: no teacher profile to record on');
  await tx.teacherApplicationHistory.create({
    data: {
      teacherProfileId: profile.id,
      action: entry.action,
      note: entry.note,
      adminId: entry.adminId,
      createdAt: entry.at,
    },
    select: { id: true },
  });
}

/**
 * The teacher's history, oldest first, each row with the administrator's display name through its
 * relation to `admin_users` (as `catalog/credential-review.repository.ts` reads its reviewer's).
 * One teacher's decisions, on the `(teacher_profile_id, created_at)` index.
 */
export async function listOf(tx: Client, teacherUserId: string): Promise<ApplicationHistoryRow[]> {
  const rows = await tx.teacherApplicationHistory.findMany({
    where: { teacherProfile: { userId: teacherUserId } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { action: true, note: true, createdAt: true, admin: { select: { displayName: true } } },
  });
  return rows.map(({ action, note, createdAt, admin }) => ({
    action,
    note,
    adminName: admin.displayName,
    at: createdAt,
  }));
}

/**
 * Deletes the history of a teacher never approved (`approved_at` null), read under the account's
 * lock the deletion holds; how many rows it deleted, none for a person with no profile. Throws for a
 * teacher once approved, deleting nothing (the owner's guard, Q-2 (a)).
 */
export async function eraseOf(tx: Client, teacherUserId: string): Promise<number> {
  const profile = await tx.teacherProfile.findUnique({
    where: { userId: teacherUserId },
    select: { id: true, approvedAt: true },
  });
  if (profile === null) return 0;
  if (profile.approvedAt !== null) {
    throw new Error('application history: a teacher once approved keeps it (DEC-97)');
  }
  const { count } = await tx.teacherApplicationHistory.deleteMany({
    where: { teacherProfileId: profile.id },
  });
  return count;
}
