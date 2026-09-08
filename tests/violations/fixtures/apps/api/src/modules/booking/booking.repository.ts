// T021 fixture — VIOLATION of R-API-6: booking's repository queries `payments`, which
// packages/config/module-tables.json assigns to the `payments` module. Holding the client here
// is legal — this is a repository file — so the only prohibition this fixture breaks is the
// ownership one, and `api/no-orm-outside-repository` must stay silent on it.
// Refused by api/table-ownership.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function grossForEnrollment(): Promise<readonly unknown[]> {
  return prisma.payment.findMany({ where: { status: 'paid' } });
}
