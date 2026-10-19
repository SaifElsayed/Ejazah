// Violation fixture for db/no-unfiltered-relation-read (R-DB-3, T026). An enrollment's sessions
// read with the soft-deleted ones: the relation carries no `where: { deletedAt: null }`.
import type { PrismaClient } from '@prisma/client';

export function enrollmentWithSessions(database: PrismaClient, id: string) {
  return database.enrollment.findUnique({ where: { id }, include: { sessions: true } });
}
