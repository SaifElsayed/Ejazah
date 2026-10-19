// T102: the queries of the idempotency mechanism, over the kernel's one table, `idempotency_keys`
// (ERD §12, ADR 0008 D2; the platform owns it in module-tables.json). The rules are in
// idempotency.service.ts; this file only reads and writes rows.
//
// The transaction is Prisma's interactive one on the process's single client, at Postgres's
// default READ COMMITTED: a concurrent claim of the same (scope, actor_id, key) waits on the unique index
// until the first transaction ends, then fails with a unique violation (P2002) if it committed,
// which is answered here as `KeyTakenError`. Nothing in this file logs a row or its `response`.
import { Prisma } from '@prisma/client';
import type { Database, Transaction } from '../db/prisma.repository.js';
import {
  type IdempotencyStore,
  KeyTakenError,
  type NewKey,
  type StoredKey,
  type StoredOutcome,
} from './idempotency.service.js';

const UNIQUE_VIOLATION = 'P2002';

const storedKey = {
  id: true,
  scope: true,
  actorId: true,
  key: true,
  requestHash: true,
  status: true,
  response: true,
  expiresAt: true,
} as const;

export class IdempotencyRepository implements IdempotencyStore<Transaction> {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.#database.$transaction(work);
  }

  async find(
    tx: Transaction,
    scope: string,
    actorId: string,
    key: string,
  ): Promise<StoredKey | null> {
    return tx.idempotencyKey.findUnique({
      where: { scope_actorId_key: { scope, actorId, key } },
      select: storedKey,
    });
  }

  async claim(tx: Transaction, key: NewKey): Promise<string> {
    try {
      const row = await tx.idempotencyKey.create({
        data: { ...key, status: 'in_progress' },
        select: { id: true },
      });
      return row.id;
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new KeyTakenError();
      }
      throw error;
    }
  }

  async complete(tx: Transaction, id: string, response: StoredOutcome): Promise<void> {
    await tx.idempotencyKey.update({
      where: { id },
      data: { status: 'completed', response: { outcome: response.outcome } },
    });
  }

  // `deleteMany`, not `delete`: a concurrent caller may have removed the same expired row first, and
  // the claim that follows, not this removal, decides who runs (PR #47 review, n2).
  async remove(tx: Transaction, id: string): Promise<void> {
    await tx.idempotencyKey.deleteMany({ where: { id } });
  }

  async removeExpired(now: Date): Promise<number> {
    const { count } = await this.#database.idempotencyKey.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return count;
  }
}
