// 006:T008 of specs/006-programme (R-513; I-2 (a); FR-706a, FR-706b, FR-709; data-model.md
// «programme_requests»): booking's queries on `programme_requests`, each on the caller's transaction.
// Queries only; the rules are `programme-requests.service.ts`' and `programmes.service.ts`'. The
// caller holds the programme's row lock (`lockRows(tx, 'programmes', …)`), the lock every writer of
// an enrollment's items takes first, so one item's reads and writes cannot interleave with another's.
//
// Bounded: an enrollment's items are few (one open per kind, rule 79; a closed one per deadline at
// most), read over `programme_requests_enrollment_id_idx`; a decision reads one row by its id.
import type { ProgrammeRequestKind, ProgrammeRequestStatus } from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'programmeRequest'>;

/** One item as a decision reads it: its enrollment and teacher come from the row, never the input. */
export interface ProgrammeRequestRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly kind: ProgrammeRequestKind;
  readonly status: ProgrammeRequestStatus;
  /**
   * The teacher's reason on a `stop`; 006:T008 (SRS DEC-112) the administrator's recorded reason on
   * a decided `no_offer` item; null otherwise. Read back for T018's queue and programme.
   */
  readonly reason: string | null;
}

/** The item `requestId`, or null for an unknown id. */
export async function requestById(
  tx: Client,
  requestId: string,
): Promise<ProgrammeRequestRow | null> {
  return tx.programmeRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      kind: true,
      status: true,
      reason: true,
    },
  });
}

/** Whether an item of `kind` is open on the enrollment (rule 79: at most one). */
export async function openRequestExists(
  tx: Client,
  enrollmentId: string,
  kind: ProgrammeRequestKind,
): Promise<boolean> {
  const row = await tx.programmeRequest.findFirst({
    where: { enrollmentId, kind, status: 'open' },
    select: { id: true },
  });
  return row !== null;
}

/** The latest item of `kind`'s creation instant, whatever its status; null for none («once per deadline»). */
export async function lastRequestAt(
  tx: Client,
  enrollmentId: string,
  kind: ProgrammeRequestKind,
): Promise<Date | null> {
  const row = await tx.programmeRequest.findFirst({
    where: { enrollmentId, kind },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

/** The latest `extended` item of `kind`'s decision instant; null for none (an extension's start). */
export async function lastExtendedAt(
  tx: Client,
  enrollmentId: string,
  kind: 'no_offer' | 'pay_blocked',
): Promise<Date | null> {
  const row = await tx.programmeRequest.findFirst({
    where: { enrollmentId, kind, status: 'extended', decidedAt: { not: null } },
    orderBy: { decidedAt: 'desc' },
    select: { decidedAt: true },
  });
  return row?.decidedAt ?? null;
}

/** A new open item; its enrollment and teacher are the enrollment's (R-513). Its id. */
export async function insertRequest(
  tx: Client,
  item: {
    readonly enrollmentId: string;
    readonly teacherUserId: string;
    readonly kind: ProgrammeRequestKind;
    /** Mandatory for `stop` and `refusal` (rule 80); none on the sweep's items. */
    readonly reason?: string;
  },
): Promise<string> {
  const { id } = await tx.programmeRequest.create({
    data: {
      enrollmentId: item.enrollmentId,
      teacherUserId: item.teacherUserId,
      kind: item.kind,
      status: 'open',
      ...(item.reason === undefined ? {} : { reason: item.reason }),
    },
    select: { id: true },
  });
  return id;
}

/**
 * The open item decided: `approved`, `declined` or `extended`, the administrator and the instant set
 * together (rule 81), by one conditional update `WHERE status = 'open'`; whether it moved.
 */
export async function decideRequest(
  tx: Client,
  requestId: string,
  decision: {
    readonly status: 'approved' | 'declined' | 'extended';
    readonly adminId: string;
    readonly at: Date;
    /** 006:T008 (SRS DEC-112): a `no_offer` decision's reason, written to the item's `reason`. */
    readonly reason?: string;
  },
): Promise<boolean> {
  const { count } = await tx.programmeRequest.updateMany({
    where: { id: requestId, status: 'open' },
    data: {
      status: decision.status,
      decidedByAdminId: decision.adminId,
      decidedAt: decision.at,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    },
  });
  return count === 1;
}

/** Every open item of the enrollments `withdrawn`, by one conditional update (the close hook). */
export async function withdrawOpenRequests(
  tx: Client,
  enrollmentIds: readonly string[],
): Promise<number> {
  if (enrollmentIds.length === 0) return 0;
  const { count } = await tx.programmeRequest.updateMany({
    where: { enrollmentId: { in: [...enrollmentIds] }, status: 'open' },
    data: { status: 'withdrawn' },
  });
  return count;
}
