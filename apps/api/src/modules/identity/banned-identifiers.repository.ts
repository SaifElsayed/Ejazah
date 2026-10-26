// T097 (FR-155, ERD §2 and §15 rule 35): the queries of `banned_identifiers`, a banned person's
// identifiers kept as keyed hashes past the deletion of their account. Queries only; what is hashed
// and when it is checked are `banned-identifiers.ts`'s.
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

/** One kept identifier: what it was made from, and its keyed hash. */
export interface BannedIdentifierRow {
  readonly kind: 'email' | 'provider';
  readonly identifierHmac: string;
}

export class BannedIdentifiersRepository {
  readonly #database: Pick<Database, 'bannedIdentifier'>;

  constructor(database: Pick<Database, 'bannedIdentifier'>) {
    this.#database = database;
  }

  /** Whether any of `hashes` is kept; one indexed lookup on the unique column. */
  async holdsAny(hashes: readonly string[]): Promise<boolean> {
    if (hashes.length === 0) return false;
    const row = await this.#database.bannedIdentifier.findFirst({
      where: { identifierHmac: { in: [...hashes] } },
      select: { id: true },
    });
    return row !== null;
  }
}

/** Writes the rows on the deletion's transaction; a hash already kept is left as it is (rule 35). */
export async function keepBannedIdentifiers(
  tx: Pick<Transaction, 'bannedIdentifier'>,
  rows: readonly BannedIdentifierRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.bannedIdentifier.createMany({ data: [...rows], skipDuplicates: true });
}
