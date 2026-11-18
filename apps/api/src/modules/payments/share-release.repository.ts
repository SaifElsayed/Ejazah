// 003:T105 (ADR 0025 D2, SRS DEC-81, DEC-89; ERD §7, §15 rules 62 to 64): the queries of the releases
// of a teacher's share, over payments' own tables (`payments`, `teacher_share_releases`, R-API-6).
// Every read is bounded: a page of `take` rows in id order, or the rows of the enrollments asked.
//
// THE WRITE IS ONCE BY THE DATABASE. A due release is inserted `ON CONFLICT DO NOTHING` on the unique
// `(enrollment_id, milestone)` (rule 62, Prisma's `skipDuplicates`), so two sweeps at once, or a sweep
// run twice, write one row; the insert answers only the rows it wrote, for the sweep's one log line
// each. The mark is one conditional update `WHERE marked_at IS NULL` (rule 63's pair set together),
// so two marks at once mark once: the second updates nothing.
import type { ShareReleaseMilestone } from '@ijazah/contracts';
import { type Piasters, piasters, toPlainNumber } from '@ijazah/money';

import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'payment' | 'teacherShareRelease'>;

/** The statuses of an order the gateway was paid on (a refunded one included, T102). */
const PAID_STATUSES = ['paid', 'refunded'] as const;

/** An order that carries a teacher's share. */
export interface ShareOrderRow {
  readonly paymentId: string;
  readonly enrollmentId: string;
  readonly share_piasters: Piasters;
  readonly sharePercent: number;
  readonly halfPercent: number | null;
  readonly refunded_piasters: Piasters;
}

/** A release as written. */
export interface ReleaseRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly milestone: ShareReleaseMilestone;
  readonly amount_piasters: Piasters;
  readonly dueAt: Date;
  readonly markedAt: Date | null;
}

/** A release to write once it falls due. */
export interface DueRelease {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly milestone: ShareReleaseMilestone;
  readonly amount_piasters: Piasters;
  readonly dueAt: Date;
}

interface SelectedOrder {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherSharePiasters: bigint | null;
  readonly teacherShareRatePercent: number | null;
  readonly halfReleaseRatePercent: number | null;
  readonly refundedPiasters: bigint;
}

/** An order read with a share, or null for one created before the commission (rule 52's pair). */
function shareOrderOf(row: SelectedOrder): ShareOrderRow | null {
  if (row.teacherSharePiasters === null || row.teacherShareRatePercent === null) return null;
  return {
    paymentId: row.id,
    enrollmentId: row.enrollmentId,
    share_piasters: piasters(Number(row.teacherSharePiasters)),
    sharePercent: row.teacherShareRatePercent,
    halfPercent: row.halfReleaseRatePercent,
    refunded_piasters: piasters(Number(row.refundedPiasters)),
  };
}

interface SelectedRelease {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly milestone: ShareReleaseMilestone;
  readonly amountPiasters: bigint;
  readonly dueAt: Date;
  readonly markedAt: Date | null;
}

function releaseOf(row: SelectedRelease): ReleaseRow {
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    teacherUserId: row.teacherUserId,
    milestone: row.milestone,
    amount_piasters: piasters(Number(row.amountPiasters)),
    dueAt: row.dueAt,
    markedAt: row.markedAt,
  };
}

/**
 * A page of the paid orders with a share above nothing, after `after` in id order: the sweep's
 * candidates. Over the primary key.
 */
export async function shareOrdersAfter(
  tx: Client,
  after: string | undefined,
  take: number,
): Promise<readonly ShareOrderRow[]> {
  const rows = await tx.payment.findMany({
    where: {
      status: { in: [...PAID_STATUSES] },
      teacherSharePiasters: { gt: 0n },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      enrollmentId: true,
      teacherSharePiasters: true,
      teacherShareRatePercent: true,
      halfReleaseRatePercent: true,
      refundedPiasters: true,
    },
  });
  return rows.flatMap((row) => shareOrderOf(row) ?? []);
}

/**
 * Of `enrollmentIds`, each one's order that carries its share: its first paid order with a share, by
 * the time-ordered id (Q-B1-10 (a): the one that confirmed it; a duplicate is refunded through its
 * own case). Over `payments_enrollment_id_idx`, bounded by the enrollments asked.
 */
export async function shareOrdersOf(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, ShareOrderRow>> {
  const first = new Map<string, ShareOrderRow>();
  if (enrollmentIds.length === 0) return first;
  const rows = await tx.payment.findMany({
    where: {
      enrollmentId: { in: [...enrollmentIds] },
      status: { in: [...PAID_STATUSES] },
      teacherSharePiasters: { not: null },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      teacherSharePiasters: true,
      teacherShareRatePercent: true,
      halfReleaseRatePercent: true,
      refundedPiasters: true,
    },
  });
  for (const row of rows) {
    const order = shareOrderOf(row);
    if (order !== null && !first.has(order.enrollmentId)) first.set(order.enrollmentId, order);
  }
  return first;
}

/** A page of the orders with a refund recorded and a share, after `after` in id order. */
export async function refundedShareOrdersAfter(
  tx: Client,
  after: string | undefined,
  take: number,
): Promise<readonly ShareOrderRow[]> {
  const rows = await tx.payment.findMany({
    where: {
      refundedPiasters: { gt: 0n },
      teacherSharePiasters: { not: null },
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      enrollmentId: true,
      teacherSharePiasters: true,
      teacherShareRatePercent: true,
      halfReleaseRatePercent: true,
      refundedPiasters: true,
    },
  });
  return rows.flatMap((row) => shareOrderOf(row) ?? []);
}

/** Of `enrollmentIds`, the orders with a refund recorded and a share, in id order. */
export async function refundedShareOrdersOf(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<readonly ShareOrderRow[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.payment.findMany({
    where: {
      enrollmentId: { in: [...enrollmentIds] },
      refundedPiasters: { gt: 0n },
      teacherSharePiasters: { not: null },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      teacherSharePiasters: true,
      teacherShareRatePercent: true,
      halfReleaseRatePercent: true,
      refundedPiasters: true,
    },
  });
  return rows.flatMap((row) => shareOrderOf(row) ?? []);
}

/** Of `enrollmentIds`, their written releases, in id order; over the unique's leading column. */
export async function releasesOf(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<readonly ReleaseRow[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.teacherShareRelease.findMany({
    where: { enrollmentId: { in: [...enrollmentIds] } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      milestone: true,
      amountPiasters: true,
      dueAt: true,
      markedAt: true,
    },
  });
  return rows.map(releaseOf);
}

/** A page of every written release, after `after` in id order: the payouts list's figures. */
export async function releasesAfter(
  tx: Client,
  after: string | undefined,
  take: number,
): Promise<readonly ReleaseRow[]> {
  const rows = await tx.teacherShareRelease.findMany({
    where: after === undefined ? {} : { id: { gt: after } },
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      milestone: true,
      amountPiasters: true,
      dueAt: true,
      markedAt: true,
    },
  });
  return rows.map(releaseOf);
}

/**
 * Writes the due releases, each at most once (rule 62, `ON CONFLICT DO NOTHING`); answers the rows
 * this call wrote, none of those another write had already made.
 */
export async function insertDueReleases(
  tx: Client,
  releases: readonly DueRelease[],
): Promise<readonly ReleaseRow[]> {
  if (releases.length === 0) return [];
  const rows = await tx.teacherShareRelease.createManyAndReturn({
    data: releases.map(({ enrollmentId, teacherUserId, milestone, amount_piasters, dueAt }) => ({
      enrollmentId,
      teacherUserId,
      milestone,
      amountPiasters: BigInt(toPlainNumber(amount_piasters)),
      dueAt,
    })),
    skipDuplicates: true,
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      milestone: true,
      amountPiasters: true,
      dueAt: true,
      markedAt: true,
    },
  });
  return rows.map(releaseOf);
}

/** The release of that id, or null. */
export async function releaseById(tx: Client, releaseId: string): Promise<ReleaseRow | null> {
  const row = await tx.teacherShareRelease.findUnique({
    where: { id: releaseId },
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      milestone: true,
      amountPiasters: true,
      dueAt: true,
      markedAt: true,
    },
  });
  return row === null ? null : releaseOf(row);
}

/**
 * Marks the release executed in the gateway's dashboard: `marked_at` and `marked_by_admin_id`
 * together (rule 63), only while unmarked. True when this call marked it.
 */
export async function markRelease(
  tx: Client,
  {
    releaseId,
    adminId,
    at,
  }: { readonly releaseId: string; readonly adminId: string; readonly at: Date },
): Promise<boolean> {
  const { count } = await tx.teacherShareRelease.updateMany({
    where: { id: releaseId, markedAt: null },
    data: { markedAt: at, markedByAdminId: adminId },
  });
  return count === 1;
}
