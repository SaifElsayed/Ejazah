// T021 fixture — VIOLATION of R-API-2: a service holds a query. Services decide; repositories
// fetch, and the database client is a name only a `*.repository.ts` file may know.
// Refused by api/no-orm-outside-repository.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function enrollmentsForStudent(): Promise<readonly unknown[]> {
  return prisma.enrollment.findMany({ where: { deletedAt: null } });
}
