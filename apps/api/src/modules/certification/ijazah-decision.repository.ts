// T007 of specs/005-certification: the administrators' review's queries over this module's
// `ijazah_requests` and `ijazahs` (FR-604, FR-605; research R-402; ERD §8, §15 rules 54, 55 and 58),
// each on the transaction it is handed (R-API-6). The rules are `ijazah-decision.service.ts`'s; the
// locks are T006's (`ijazah-request.repository.ts`), in the kernel row's order. Each decision's write
// is conditional on the request's state, so a request decided meanwhile is never decided twice; and
// `ijazahs.request_id` is unique, so the database refuses a second ijazah of one request whatever the
// code does.
import type { Prisma } from '@prisma/client';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { DecisionRequest, NewIjazah, RequestPageQuery } from './ijazah-decision.service.js';

type Client = Pick<Transaction, 'ijazahRequest' | 'ijazah'>;

/** An open request: waiting for the student's name, or pending the administrators' decision. */
const OPEN = ['awaiting_student_name', 'pending'] as const;

/** The request as a decision reads it, or null. */
export function decisionRequestOf(tx: Client, requestId: string): Promise<DecisionRequest | null> {
  return tx.ijazahRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      studentUserId: true,
      subjectId: true,
      status: true,
      completionDate: true,
      language: true,
      chainSnapshot: true,
      teacherNamePrinted: true,
      riwayaPrinted: true,
      tariqPrinted: true,
      signatureStorageKey: true,
      reason: true,
      decidedAt: true,
      createdAt: true,
    },
  });
}

/**
 * One page of the queue, in the order the requests were sent (the id is a UUIDv7), after `after`;
 * by its status when one is given (the `(status, created_at)` index, data-model.md).
 */
export function requestPage(
  tx: Client,
  { status, after, take }: RequestPageQuery,
): Promise<readonly DecisionRequest[]> {
  return tx.ijazahRequest.findMany({
    where: {
      ...(status === undefined ? {} : { status }),
      ...(after === undefined ? {} : { id: { gt: after } }),
    },
    orderBy: { id: 'asc' },
    take,
    select: {
      id: true,
      enrollmentId: true,
      teacherUserId: true,
      studentUserId: true,
      subjectId: true,
      status: true,
      completionDate: true,
      language: true,
      chainSnapshot: true,
      teacherNamePrinted: true,
      riwayaPrinted: true,
      tariqPrinted: true,
      signatureStorageKey: true,
      reason: true,
      decidedAt: true,
      createdAt: true,
    },
  });
}

/** The ijazah issued from the request, a soft-deleted one left out; null otherwise. */
export async function ijazahOfRequest(tx: Client, requestId: string): Promise<string | null> {
  const row = await tx.ijazah.findFirst({
    where: { requestId, deletedAt: null },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Writes the issued ijazah (R-402): one per request, `request_id` unique. */
export async function insertIjazah(tx: Client, row: NewIjazah): Promise<void> {
  await tx.ijazah.create({
    data: {
      id: row.id,
      certificateNumber: row.certificateNumber,
      enrollmentId: row.enrollmentId,
      studentUserId: row.studentUserId,
      teacherUserId: row.teacherUserId,
      subjectId: row.subjectId,
      mode: row.mode,
      language: row.language,
      chainSnapshot: row.chainSnapshot as Prisma.InputJsonValue,
      certificateStorageKey: row.certificateStorageKey,
      paperCopyIntended: row.paperCopyIntended,
      verificationTokenHash: row.verificationTokenHash,
      grantedAt: row.grantedAt,
      requestId: row.requestId,
      issuedByAdminId: row.issuedByAdminId,
      studentNamePrinted: row.studentNamePrinted,
      teacherNamePrinted: row.teacherNamePrinted,
      riwayaPrinted: row.riwayaPrinted,
      tariqPrinted: row.tariqPrinted,
      completionDate: row.completionDate,
    },
    select: { id: true },
  });
}

/** Moves a pending request to `approved` (rule 54: decided by and at, together); whether it did. */
export async function markApproved(
  tx: Client,
  requestId: string,
  adminId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.ijazahRequest.updateMany({
    where: { id: requestId, status: 'pending' },
    data: { status: 'approved', decidedByAdminId: adminId, decidedAt: at },
  });
  return count === 1;
}

/**
 * Moves an open request to `rejected` with its reason (rule 54), its copy's key cleared (Q14 (a):
 * the file is removed after the commit); whether it did.
 */
export async function markRejected(
  tx: Client,
  requestId: string,
  adminId: string,
  reason: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.ijazahRequest.updateMany({
    where: { id: requestId, status: { in: [...OPEN] } },
    data: {
      status: 'rejected',
      reason,
      decidedByAdminId: adminId,
      decidedAt: at,
      signatureStorageKey: null,
    },
  });
  return count === 1;
}
