// T038: the catalog module's `subjects` rows as the public list reads them (FR-182, ADR 0021 D1).
// Queries only. Apart from `catalog.repository.ts`, which serves discovery and the teacher list
// across the gender line and stays under the gender suite gate (T163); this file returns no
// teacher, so it is excepted from that gate by name (`scripts/suite-gate.paths.ts`).
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'subject'>;

/** Of `ids`, the active subjects, on `tx` (T056: an application chooses from the admin's list). */
export async function activeSubjectsAmong(
  tx: Pick<Transaction, 'subject'>,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  const rows = await tx.subject.findMany({
    where: { id: { in: [...ids] }, isActive: true },
    select: { id: true },
  });
  return new Set(rows.map(({ id }) => id));
}

export interface SubjectRow {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

export class SubjectsRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** The active subjects, both names, in the order they were created (the seed's order). */
  listActive(): Promise<SubjectRow[]> {
    return this.#database.subject.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, nameAr: true, nameEn: true },
    });
  }
}
