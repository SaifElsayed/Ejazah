// T009 of specs/005-certification: the parties' reads of this module's `ijazahs` and the student's
// public credentials (FR-607, FR-609; research R-412; the note under T009, Q9 (a); FR-IJAZAH-4,
// R-HONEST-6), each on the client it is handed (R-API-6). The rules are `certificates.service.ts`'s.
// A soft-deleted ijazah is left out of every read (ERD's soft deletion; revocation is not deletion).
// Each read is covered by an index of the table: `ijazahs_student_user_id_idx`,
// `ijazahs_teacher_user_id_idx` and the primary key.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { CertificateRow } from './certificates.service.js';

type Client = Pick<Transaction, 'ijazah'>;

/** One of the student's credentials (FR-IJAZAH-4): signed off and unrevoked. */
export interface PublicCredential {
  readonly ijazahId: string;
  readonly subjectId: string;
  readonly teacherNamePrinted: string;
  readonly grantedAt: Date;
  readonly signedOffAt: Date;
}

/**
 * The ijazahs whose student or granting teacher is `userId`, newest first (the id is a UUIDv7). The
 * caller's own rows, unpaged as `teacher.packages.list` is (contracts/app-surface.md: `list` takes
 * no input): one ijazah per request, at most one unrevoked per enrollment.
 */
export function certificatesOfParty(
  tx: Client,
  userId: string,
): Promise<readonly CertificateRow[]> {
  return tx.ijazah.findMany({
    where: { OR: [{ studentUserId: userId }, { teacherUserId: userId }], deletedAt: null },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      subjectId: true,
      teacherNamePrinted: true,
      grantedAt: true,
      signedOffAt: true,
      revokedAt: true,
      certificateStorageKey: true,
    },
  });
}

/** The ijazah by its id, or null; a soft-deleted one null. */
export function certificateById(tx: Client, ijazahId: string): Promise<CertificateRow | null> {
  return tx.ijazah.findFirst({
    where: { id: ijazahId, deletedAt: null },
    select: {
      id: true,
      studentUserId: true,
      teacherUserId: true,
      subjectId: true,
      teacherNamePrinted: true,
      grantedAt: true,
      signedOffAt: true,
      revokedAt: true,
      certificateStorageKey: true,
    },
  });
}

/**
 * The student's public credentials (FR-IJAZAH-4, the note under T009): only the ijazahs an
 * administrator signed off and nobody revoked (FR-IJAZAH-8, R-HONEST-6), in the order they were
 * issued. No v1.0 surface reads it; the public page is T028 (v1.1).
 */
export async function publicCredentialsOf(
  tx: Client,
  studentUserId: string,
): Promise<readonly PublicCredential[]> {
  const rows = await tx.ijazah.findMany({
    where: { studentUserId, deletedAt: null, signedOffAt: { not: null }, revokedAt: null },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      subjectId: true,
      teacherNamePrinted: true,
      grantedAt: true,
      signedOffAt: true,
    },
  });
  return rows.map(({ id, signedOffAt, ...rest }) => {
    // The query's own filter holds it; an unsigned row here is a broken read, never one to hide.
    if (signedOffAt === null) throw new Error('public credentials: an ijazah not signed off');
    return { ijazahId: id, ...rest, signedOffAt };
  });
}
