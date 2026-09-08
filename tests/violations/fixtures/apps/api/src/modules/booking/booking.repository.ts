// T021 fixture — VIOLATION of R-API-6: booking's repository queries `reviews`, which
// packages/config/module-tables.json assigns to the `reviews` module. Holding the client here
// is legal — this is a repository file — so the only prohibition this fixture breaks is the
// ownership one, and `api/no-orm-outside-repository` must stay silent on it.
// Refused by api/table-ownership.
//
// The table read here is deliberately money-free. An earlier version read `payments` from a
// function named `grossForEnrollment`, which `boundaries/no-money-vocabulary` (R-MONEY-6, ADR
// 0007 half) will also refuse once T035 lands: money-carrying records live only in `payments`
// and no other module reads a money amount. Two rules on one fixture would let the R-API-6 case
// go green for the wrong reason, and it breaks the one-rule-per-file convention this tree
// relies on. `reviews` is owned by another module and carries no money vocabulary, so the
// ownership violation is the only thing left to refuse.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function publishedForTeacher(): Promise<readonly unknown[]> {
  return prisma.review.findMany({ where: { published: true } });
}
