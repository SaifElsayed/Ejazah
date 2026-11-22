// T174 (SRS DEC-97, FR-AUTH-14; ERD §4 `teacher_credential_history`, changelog row 63, §15 rules 68
// and 69; the note under T174, Q-2 (a)): the credential's history of decisions and corrections, this
// module's table, each query on the caller's transaction.
//
// - `record` inserts one row on the decision's transaction, after the decision's conditional write,
//   which already holds the credential's row (the insert's foreign key names it: T005's rule). The
//   database holds the note and the transcription's presence (rule 68).
// - `listOf` reads a credential's rows oldest first, each administrator by name, for `credentials.get`.
// - `eraseOfTeacher` is the only DELETE on the table (rule 69 keeps DELETE granted for it alone, a
//   spec reads `apps/api/src` for any other): the rows of the credentials of a teacher never approved,
//   on the deletion's transaction under the account's lock. It reads `approved_at` itself, through
//   identity's entry, and throws for a teacher once approved, deleting nothing, whatever its caller
//   decided (the owner's guard, Q-2 (a)): a teacher once approved keeps the history with no end date.
import { adminCredentialTranscription } from '@ijazah/contracts/admin';
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { everApprovedTeacher } from '../identity/index.js';
import type {
  HistoryEntry,
  HistoryRow,
  HistoryTranscription,
} from './credential-review.service.js';

type Client = Pick<Transaction, 'teacherCredentialHistory'>;

/** The refusal of the guard: a teacher once approved keeps the history (Q-2 (a)). */
export class KeptHistoryError extends Error {
  constructor() {
    super('The credential history of a teacher once approved is kept; nothing was erased.');
    this.name = 'KeptHistoryError';
  }
}

async function record(tx: Client, entry: HistoryEntry): Promise<void> {
  await tx.teacherCredentialHistory.create({
    data: {
      credentialId: entry.credentialId,
      action: entry.action,
      note: entry.note,
      ...(entry.before === undefined ? {} : { before: jsonOf(entry.before) }),
      ...(entry.after === undefined ? {} : { after: jsonOf(entry.after) }),
      adminId: entry.adminId,
      createdAt: entry.at,
    },
  });
}

async function listOf(tx: Client, credentialId: string): Promise<HistoryRow[]> {
  const rows = await tx.teacherCredentialHistory.findMany({
    where: { credentialId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      action: true,
      note: true,
      before: true,
      after: true,
      createdAt: true,
      admin: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    action: row.action,
    note: row.note,
    before: transcriptionOf(row.before),
    after: transcriptionOf(row.after),
    adminName: row.admin.displayName,
    at: row.createdAt,
  }));
}

async function eraseOfTeacher(
  tx: Client & Pick<Transaction, 'teacherProfile'>,
  teacherUserId: string,
): Promise<void> {
  if (await everApprovedTeacher(tx, teacherUserId)) throw new KeptHistoryError();
  await tx.teacherCredentialHistory.deleteMany({
    where: { credential: { teacherUserId } },
  });
}

/** The credential's history: its writer, its reader and its one erasure (T174). */
export const credentialHistory = { record, listOf, eraseOfTeacher } as const;

function jsonOf(transcription: HistoryTranscription): Prisma.InputJsonObject {
  return {
    holderName: transcription.holderName,
    riwaya: transcription.riwaya,
    tariq: transcription.tariq,
    chain: transcription.chain.map(({ position, names }) => ({ position, names: [...names] })),
  };
}

/** A stored transcription as this module wrote it (`jsonOf`), parsed; null where the row holds none. */
function transcriptionOf(value: Prisma.JsonValue): HistoryTranscription | null {
  return value === null ? null : adminCredentialTranscription.parse(value);
}
