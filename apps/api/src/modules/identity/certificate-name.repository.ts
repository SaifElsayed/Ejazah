// T004 of specs/005-certification (FR-602; ADR 0019 D1): the certificate name's queries over this
// module's `users` and `user_roles` (R-API-2), each on the transaction it is handed. The account's
// lock is `standing.repository.ts`' `lockAccount`; the rules are `certificate-name.service.ts`'s.
// Nothing here reads or writes `ijazahs`: an issued certificate prints its own snapshot.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'user'>;

/** The live account's certificate name and whether its one role is `student`; null for none or deleted. */
export async function certificateNameHolderOf(
  tx: Client,
  userId: string,
): Promise<{ readonly student: boolean; readonly certificateName: string | null } | null> {
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { certificateName: true, roles: { select: { role: true } } },
  });
  if (user === null) return null;
  return {
    student: user.roles[0]?.role === 'student',
    certificateName: user.certificateName,
  };
}

/** Writes the account's certificate name (the caller holds the account's lock). */
export async function writeCertificateName(
  tx: Client,
  userId: string,
  name: string,
): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { certificateName: name } });
}
