// T093: the catalog module's `teacher_credentials` rows as the verification module's unreferenced
// documents read them (R-API-6): which of a set of documents a credential points at. T057 adds the
// rows as the teacher's application and credentials read and write them through this module's
// entry (R-121): a teacher's credentials with their subject and, once approved, their chain; a new
// pending credential; a new PDF for one waiting on a document, conditional on that state so two
// requests cannot both take it; and the subjects an approved credential grants (`teacher_subjects`,
// for the admin's approval). Queries only, each on the client or transaction it is handed. T065 adds
// the admin home's credentials card, counts only.
// It returns no teacher, only a teacher's own rows, so it is excepted from the gender suite gate by
// name (`apps/api/src/modules/catalog/credentials*`, `scripts/suite-gate.paths.ts`).
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'teacherCredential'>;

/** A credential with its subject and its chain, origin first (empty until an approval writes it). */
export interface CredentialRow {
  readonly id: string;
  readonly subjectId: string;
  readonly subject: { readonly id: string; readonly nameAr: string; readonly nameEn: string };
  readonly documentId: string;
  readonly status: 'pending' | 'needs_document' | 'approved' | 'rejected';
  readonly submittedWithApplication: boolean;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewReason: string | null;
  readonly holderName: string | null;
  readonly riwaya: string | null;
  readonly tariq: string | null;
  readonly chain: readonly { readonly position: number; readonly names: readonly string[] }[];
}

/** A credential to write: pending until reviewed. */
export interface NewCredentialRow {
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly documentId: string;
  readonly submittedWithApplication: boolean;
  /** The application's submission for a credential sent with it, so the two share one instant. */
  readonly createdAt: Date;
}

/** Every credential of the teacher, oldest first, on `tx`. */
export async function listCredentials(
  tx: Pick<Transaction, 'teacherCredential'>,
  teacherUserId: string,
): Promise<CredentialRow[]> {
  const rows = await tx.teacherCredential.findMany({
    where: { teacherUserId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      subjectId: true,
      subject: { select: { id: true, nameAr: true, nameEn: true } },
      documentId: true,
      status: true,
      submittedWithApplication: true,
      createdAt: true,
      reviewedAt: true,
      reviewReason: true,
      holderName: true,
      riwaya: true,
      tariq: true,
      isnadEntries: { orderBy: { position: 'asc' }, select: { position: true, names: true } },
    },
  });
  return rows.map(({ isnadEntries, ...row }) => ({ ...row, chain: isnadEntries }));
}

/** Writes a pending credential on `tx`; its id. */
export async function addCredential(
  tx: Pick<Transaction, 'teacherCredential'>,
  row: NewCredentialRow,
): Promise<string> {
  const { id } = await tx.teacherCredential.create({
    data: { ...row, status: 'pending' },
    select: { id: true },
  });
  return id;
}

/**
 * Takes a new PDF for the teacher's credential on `tx` while it waits on one; the credential waits
 * for review again. Whether it did.
 */
export async function replaceCredentialDocument(
  tx: Pick<Transaction, 'teacherCredential'>,
  replacement: { credentialId: string; teacherUserId: string; documentId: string },
): Promise<boolean> {
  const { count } = await tx.teacherCredential.updateMany({
    where: {
      id: replacement.credentialId,
      teacherUserId: replacement.teacherUserId,
      status: 'needs_document',
    },
    data: { documentId: replacement.documentId, status: 'pending' },
  });
  return count === 1;
}

/** What closes a rejected application's undecided credentials (T122): their ids, the reason, who, when. */
export interface CredentialClosure {
  readonly credentialIds: readonly string[];
  readonly reason: string;
  readonly adminId: string;
  readonly at: Date;
}

/**
 * Rejects those of the credentials still `pending` or `needs_document`, with the rejection's note as
 * their reason, its administrator and its moment (T122). The write is conditional on that status, so
 * a credential decided a moment before keeps its decision. How many it moved.
 */
export async function closeUndecidedCredentials(
  tx: Pick<Transaction, 'teacherCredential'>,
  closure: CredentialClosure,
): Promise<number> {
  if (closure.credentialIds.length === 0) return 0;
  const { count } = await tx.teacherCredential.updateMany({
    where: {
      id: { in: [...closure.credentialIds] },
      status: { in: ['pending', 'needs_document'] },
    },
    data: {
      status: 'rejected',
      reviewReason: closure.reason,
      reviewedByAdminId: closure.adminId,
      reviewedAt: closure.at,
    },
  });
  return count;
}

/**
 * T174 (SRS DEC-97, FR-AUTH-14): blanks every credential of the teacher, the holder's name, the
 * riwaya, the tariq and the review reason, then deletes their chains, on the deletion's transaction.
 * The rows stay (their documents and reviewers point at them); no CHECK binds the four columns (the
 * note under T174, (1)). Only the deletion of a teacher never approved calls it
 * (`credentials-erasure.ts`).
 */
export async function blankTranscriptionsOfTeacher(
  tx: Pick<Transaction, 'teacherCredential' | 'isnadEntry'>,
  teacherUserId: string,
): Promise<void> {
  await tx.teacherCredential.updateMany({
    where: { teacherUserId },
    data: { holderName: null, riwaya: null, tariq: null, reviewReason: null },
  });
  await tx.isnadEntry.deleteMany({ where: { credential: { teacherUserId } } });
}

/**
 * The teacher whose credentials the documents queue holds, beside `deletedAt: null` (T121): not a
 * banned account (T122). One condition for the queue's list (`credential-review.repository.ts`) and
 * the admin home's count (`readCredentialQueue`); nothing is written on the credentials.
 */
export const UNBANNED_TEACHER = { accountStatus: { not: 'banned' } } as const;

/** Makes the subjects the teacher's on `tx`; a subject already theirs is kept as it is. */
export async function grantSubjects(
  tx: Pick<Transaction, 'teacherSubject'>,
  teacherUserId: string,
  subjectIds: readonly string[],
): Promise<void> {
  await tx.teacherSubject.createMany({
    data: subjectIds.map((subjectId) => ({ teacherUserId, subjectId })),
    skipDuplicates: true,
  });
}

export class CredentialsRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Of `documentIds`, those a credential points at. */
  async documentsAmong(documentIds: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.#database.teacherCredential.findMany({
      where: { documentId: { in: [...documentIds] } },
      select: { documentId: true },
    });
    return new Set(rows.map(({ documentId }) => documentId));
  }
}

/**
 * The admin home's credentials card (T065, FR-176): how many credentials wait for review, and how
 * many of them are for a subject added after approval rather than sent with the application, and
 * when the oldest of them was sent (the card's age, B14d).
 */
export async function readCredentialQueue(tx: Pick<Transaction, 'teacherCredential'>): Promise<{
  readonly open: number;
  readonly addedSubjects: number;
  readonly oldestSubmittedAt: Date | null;
}> {
  // A deleted (T121) or banned (T122) account's credential is not in the review list, so the card
  // does not count it.
  const pending = { status: 'pending', teacher: { deletedAt: null, ...UNBANNED_TEACHER } } as const;
  const [open, addedSubjects, oldest] = await Promise.all([
    tx.teacherCredential.count({ where: pending }),
    tx.teacherCredential.count({ where: { ...pending, submittedWithApplication: false } }),
    tx.teacherCredential.aggregate({ where: pending, _min: { createdAt: true } }),
  ]);
  return { open, addedSubjects, oldestSubmittedAt: oldest._min.createdAt };
}

/**
 * The credentials of several teachers at once, oldest first, for the applications queue (T068): the
 * verification module keeps those sent with each current application (FR-160).
 */
export async function credentialsOfTeachers(
  tx: Pick<Transaction, 'teacherCredential'>,
  teacherUserIds: readonly string[],
): Promise<(CredentialRow & { readonly teacherUserId: string })[]> {
  const rows = await tx.teacherCredential.findMany({
    where: { teacherUserId: { in: [...teacherUserIds] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      teacherUserId: true,
      subjectId: true,
      subject: { select: { id: true, nameAr: true, nameEn: true } },
      documentId: true,
      status: true,
      submittedWithApplication: true,
      createdAt: true,
      reviewedAt: true,
      reviewReason: true,
      holderName: true,
      riwaya: true,
      tariq: true,
      isnadEntries: { orderBy: { position: 'asc' }, select: { position: true, names: true } },
    },
  });
  return rows.map(({ isnadEntries, ...row }) => ({ ...row, chain: isnadEntries }));
}

/**
 * Removes every subject of the teacher (T068, `teachers.revokeApproval`): a subject is the
 * teacher's only while approved (FR-153); a new approval grants them again.
 */
export async function revokeSubjects(
  tx: Pick<Transaction, 'teacherSubject'>,
  teacherUserId: string,
): Promise<void> {
  await tx.teacherSubject.deleteMany({ where: { teacherUserId } });
}
