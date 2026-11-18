// T010 of specs/005-certification: an administrator's ijazahs' queries over this module's `ijazahs`
// and `ijazah_bars` (FR-609, FR-610; research R-412; ERD §8, §15 rule 10), each on the transaction
// it is handed (R-API-6). The rules are `ijazahs.service.ts`'s. A revocation writes three columns and
// never deletes the row (the application role holds no DELETE on `ijazahs`, rule 10, and nothing here
// sets `deleted_at`); its write is conditional on the row being unrevoked, so a revocation is never
// written twice. `ijazah_bars` has no partial unique: one open bar per user is held by the user's
// `users` lock, which the service takes before `openBarOf`.
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import type { IjazahPageQuery, IjazahRecord, NewIjazahBar } from './ijazahs.service.js';

type Client = Pick<Transaction, 'ijazah' | 'ijazahBar'>;

/** The administrator's status as a filter: revoked first, then signed off, then rendered. */
const STATUS_WHERE: Readonly<
  Record<NonNullable<IjazahPageQuery['status']>, Prisma.IjazahWhereInput>
> = {
  revoked: { revokedAt: { not: null } },
  signed_off: { revokedAt: null, signedOffAt: { not: null } },
  rendered: { revokedAt: null, signedOffAt: null, renderedAt: { not: null } },
  preparing: { revokedAt: null, signedOffAt: null, renderedAt: null },
};

/** The ijazah, revoked or not; a soft-deleted one left out. */
export function ijazahRecordOf(tx: Client, ijazahId: string): Promise<IjazahRecord | null> {
  return tx.ijazah.findFirst({
    where: { id: ijazahId, deletedAt: null },
    select: {
      id: true,
      certificateNumber: true,
      enrollmentId: true,
      requestId: true,
      teacherUserId: true,
      studentUserId: true,
      subjectId: true,
      language: true,
      chainSnapshot: true,
      studentNamePrinted: true,
      teacherNamePrinted: true,
      riwayaPrinted: true,
      tariqPrinted: true,
      completionDate: true,
      grantedAt: true,
      renderGeneration: true,
      renderedAt: true,
      certificateStorageKey: true,
      signedOffAt: true,
      revokedAt: true,
      revokedReason: true,
    },
  });
}

/**
 * One page of the ijazahs in the order of issue (the id is a UUIDv7), after `after`, by status when
 * one is given; revoked ones included, a soft-deleted one left out.
 */
export function ijazahPage(
  tx: Client,
  { status, after, take }: IjazahPageQuery,
): Promise<readonly IjazahRecord[]> {
  return tx.ijazah.findMany({
    where: {
      deletedAt: null,
      ...(status === undefined ? {} : STATUS_WHERE[status]),
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      certificateNumber: true,
      enrollmentId: true,
      requestId: true,
      teacherUserId: true,
      studentUserId: true,
      subjectId: true,
      language: true,
      chainSnapshot: true,
      studentNamePrinted: true,
      teacherNamePrinted: true,
      riwayaPrinted: true,
      tariqPrinted: true,
      completionDate: true,
      grantedAt: true,
      renderGeneration: true,
      renderedAt: true,
      certificateStorageKey: true,
      signedOffAt: true,
      revokedAt: true,
      revokedReason: true,
    },
  });
}

/** Locks the ijazahs, FOR UPDATE, in id order, one statement (the kernel row's last lock). */
export function lockIjazahs(tx: Transaction, ids: readonly string[]): Promise<void> {
  return lockRows(tx, 'ijazahs', ids);
}

/** Revokes an unrevoked ijazah with its reason and administrator; whether it did. Never a delete. */
export async function markRevoked(
  tx: Client,
  ijazahId: string,
  adminId: string,
  reason: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.ijazah.updateMany({
    where: { id: ijazahId, revokedAt: null, deletedAt: null },
    data: { revokedAt: at, revokedReason: reason, revokedByAdminId: adminId },
  });
  return count === 1;
}

/** The user's open bar's id (not lifted), or null; read under the user's lock. */
export async function openBarOf(tx: Client, userId: string): Promise<string | null> {
  const row = await tx.ijazahBar.findFirst({
    where: { userId, liftedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Writes a bar (FR-610). */
export async function insertBar(tx: Client, bar: NewIjazahBar): Promise<void> {
  await tx.ijazahBar.create({
    data: {
      id: bar.id,
      userId: bar.userId,
      reason: bar.reason,
      barredByAdminId: bar.barredByAdminId,
      barredAt: bar.barredAt,
    },
    select: { id: true },
  });
}

/** Lifts an open bar, the row kept as history; whether it did. */
export async function liftBar(
  tx: Client,
  barId: string,
  adminId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.ijazahBar.updateMany({
    where: { id: barId, liftedAt: null },
    data: { liftedAt: at, liftedByAdminId: adminId },
  });
  return count === 1;
}

// 005:T032 (FR-629; R-402; ERD §15 rule 55): the sign-off and the re-render, each conditional on the
// row's state read under its lock, so neither is written twice nor after a sign-off or revocation.

/** Signs off a rendered, unsigned, unrevoked ijazah (rule 55: instant and administrator together). */
export async function markSignedOff(
  tx: Client,
  ijazahId: string,
  adminId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.ijazah.updateMany({
    where: {
      id: ijazahId,
      signedOffAt: null,
      revokedAt: null,
      deletedAt: null,
      renderedAt: { not: null },
    },
    data: { signedOffAt: at, signedOffByAdminId: adminId },
  });
  return count === 1;
}

/** Raises an unsigned, unrevoked ijazah's generation by one and clears its rendering. */
export async function markRerendered(tx: Client, ijazahId: string): Promise<boolean> {
  const { count } = await tx.ijazah.updateMany({
    where: { id: ijazahId, signedOffAt: null, revokedAt: null, deletedAt: null },
    data: { renderGeneration: { increment: 1 }, renderedAt: null },
  });
  return count === 1;
}
