// T014 of specs/005-certification (FR-616, FR-617, FR-618; SRS FR-GENDER-4, FR-GENDER-5; research
// R-409): `users.gender`, the declared gender, after the account's creation. Queries only, each on
// the caller's transaction. The one writer is administrators-only: the admin module's correction
// (T014) and fraud ban (T015) call it, under the person's `users` lock they take first; no user
// procedure reaches it (R-GENDER-6, the surfaces' CI test). The write is one conditional update from
// the gender read under that lock, so it never writes over a value it did not read.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'user'>;

/** A declared gender (`gender`, ERD §1). */
export type DeclaredGender = 'male' | 'female';

/** The live person's declared gender; null for none or a deleted one. No lock. */
export async function declaredGenderOf(tx: Client, userId: string): Promise<DeclaredGender | null> {
  const row = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { gender: true },
  });
  return row?.gender ?? null;
}

/**
 * Writes the live person's declared gender `to` while the row still holds `from`; whether it did.
 * The caller holds the person's `users` row (`lockAccount`) and read `from` under it.
 */
export async function setDeclaredGender(
  tx: Client,
  userId: string,
  from: DeclaredGender,
  to: DeclaredGender,
): Promise<boolean> {
  const { count } = await tx.user.updateMany({
    where: { id: userId, deletedAt: null, gender: from },
    data: { gender: to },
  });
  return count === 1;
}
