// T155: the `reencrypt-columns` sweep, the step that makes `ENCRYPTION_KEY` rotatable (FR-031,
// R-DB-8, R-SEC-10; docs/RUNBOOK.md, "Leaked credential").
//
// While ENCRYPTION_KEY_PREVIOUS is set, the cipher reads values under both keys and writes under
// the current one. This sweep walks every `_encrypted` column one at a time, in pages of rows in id
// order, and writes each value found under the previous key again under the current one, through
// the repository of the module that owns the table (R-API-6). With no previous key it reads
// nothing, so it is registered in every environment and costs nothing between rotations.
//
// Idempotent and resumable: a value the current key already reads is left as it is, so a second
// run, or a run after one that stopped part way, writes only what is still old (R-API-14). A row is
// written only where it still holds the value read, so a value the application wrote meanwhile,
// always under the current key, is kept. A value neither key reads is counted and passed over, so
// every other value is still written, one naming the current key's id included (the cipher
// decrypts it rather than trust the id; PR #61 review, n1); the run then fails naming each column
// and its count, never the row or the bytes (R-SEC-2), and the previous key is not reported as
// retirable. After a run that leaves no old value, the log says ENCRYPTION_KEY_PREVIOUS can be
// removed and carries `startedAt`, when that run began, so the RUNBOOK's step 3 can tell a run
// begun after every process restarted from one begun before (n3).
import { z } from 'zod';
import {
  type ColumnCipher,
  DecryptionError,
  type EncryptedColumn,
} from '../platform/crypto/encryption.js';
import { defineJob, type Job } from './job.js';

/** Rows read per query: one page of one column. */
export const REENCRYPT_PAGE_SIZE = 100;

/** Values that neither the current nor the previous key reads, counted per column. */
export class UnreadableValuesError extends Error {
  constructor(counts: ReadonlyMap<string, number>) {
    const listed = [...counts].map(([column, count]) => `${column}: ${count}`).join(', ');
    super(`Values under neither ENCRYPTION_KEY nor ENCRYPTION_KEY_PREVIOUS remain (${listed}).`);
    this.name = 'UnreadableValuesError';
  }
}

export interface ReencryptColumnsOptions {
  readonly cipher: Pick<ColumnCipher, 'rotating' | 'reencrypt'>;
  /** Every `_encrypted` column, each from the module that owns its table. */
  readonly columns: readonly EncryptedColumn[];
  readonly log: { info(fields: object, message: string): void };
  readonly pageSize?: number;
}

export function reencryptColumns({
  cipher,
  columns,
  log,
  pageSize = REENCRYPT_PAGE_SIZE,
}: ReencryptColumnsOptions): Job {
  /** Writes one column's old values under the current key; returns how many it could not read. */
  async function reencrypt(column: EncryptedColumn): Promise<number> {
    let unreadable = 0;
    let after: string | undefined;
    for (;;) {
      const page = await column.page(after, pageSize);
      for (const { id, value } of page) {
        let next: Buffer | undefined;
        try {
          next = cipher.reencrypt(value, column.column);
        } catch (error: unknown) {
          if (!(error instanceof DecryptionError)) throw error;
          unreadable += 1;
          continue;
        }
        if (next !== undefined) await column.replace(id, value, next);
      }
      const last = page.at(-1);
      if (last === undefined || page.length < pageSize) return unreadable;
      after = last.id;
    }
  }

  return defineJob({
    name: 'reencrypt-columns',
    payload: z.object({}),
    schedule: '*/10 * * * *',
    run: async () => {
      if (!cipher.rotating) return;
      const startedAt = new Date().toISOString();
      const unreadable = new Map<string, number>();
      for (const column of columns) {
        const count = await reencrypt(column);
        if (count > 0) unreadable.set(column.column, count);
      }
      if (unreadable.size > 0) throw new UnreadableValuesError(unreadable);
      log.info(
        { startedAt, columns: columns.map(({ column }) => column) },
        'Every encrypted value is under ENCRYPTION_KEY; ENCRYPTION_KEY_PREVIOUS can be removed',
      );
    },
  });
}
