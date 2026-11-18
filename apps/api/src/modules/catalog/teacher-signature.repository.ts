// T003 of specs/005-certification: the `teacher_signatures` rows (FR-601, SRS FR-IJAZAH-12; research
// R-411; ERD, `teacher_signatures`, `teacher_user_id` unique). Queries only (R-API-6), each on the
// caller's client: the teacher's current row, and the one row written by the teacher's unique,
// inserted the first time and replaced after. The storage key is plain in its column, as
// `users.photo_key` is, and is served only through a signed link (R-SEC-3). The lock that makes the
// read and the write one decision is the service's.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'teacherSignature'>;

/** A teacher's current signature: its row, its file's key and when it was uploaded. */
export interface SignatureRow {
  readonly id: string;
  readonly storageKey: string;
  readonly uploadedAt: Date;
}

/** What one upload writes. */
export interface SignatureWrite {
  readonly teacherUserId: string;
  readonly storageKey: string;
  readonly uploadedAt: Date;
}

/** The teacher's current signature, or null. */
export function signatureOf(client: Client, teacherUserId: string): Promise<SignatureRow | null> {
  return client.teacherSignature.findUnique({
    where: { teacherUserId },
    select: { id: true, storageKey: true, uploadedAt: true },
  });
}

/** The teacher's one row, inserted or replaced by the unique, with the key and the instant given. */
export function writeSignature(client: Client, write: SignatureWrite): Promise<SignatureRow> {
  return client.teacherSignature.upsert({
    where: { teacherUserId: write.teacherUserId },
    create: write,
    update: { storageKey: write.storageKey, uploadedAt: write.uploadedAt },
    select: { id: true, storageKey: true, uploadedAt: true },
  });
}

/** 005:T031: a signature row as the kept data's erasure reads it: its owner and its file's key. */
export interface SignatureFileRow {
  readonly id: string;
  readonly teacherUserId: string;
  readonly storageKey: string;
}

/**
 * 005:T031 (FR-631; Q-D3 (a)): a page of every signature row, in id order after `after`, at most
 * `limit`, with no lock; verification's `createKeptSignatureErasure` keeps the ones no longer kept.
 */
export function signaturesPage(
  client: Client,
  after: string | undefined,
  limit: number,
): Promise<SignatureFileRow[]> {
  return client.teacherSignature.findMany({
    where: after === undefined ? {} : { id: { gt: after } },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, teacherUserId: true, storageKey: true },
  });
}

/**
 * 005:T031 (FR-631; Q-D3 (a)) ⚠️ final: deletes the row once its file is gone, only where it still
 * holds the key whose file was removed; whether it did (DELETE is granted on the table).
 */
export async function deleteSignatureHolding(
  client: Client,
  { id, storageKey }: Pick<SignatureFileRow, 'id' | 'storageKey'>,
): Promise<boolean> {
  const { count } = await client.teacherSignature.deleteMany({ where: { id, storageKey } });
  return count === 1;
}
