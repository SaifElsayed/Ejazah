// T068: this module's `verification_requests` (FR-166) and a document's upload moment, each on the
// transaction it is handed. A request is open until accepted (`satisfied`) or replaced by a request
// for another document (`replaced`), which keeps the document it held, so the documents sweep
// (T093) leaves it (B13b review, follow-up 1); its document is the one the user submitted for it. Every write is
// conditional on the state it moves from, so two administrators racing on one request cannot both
// move it; a write answers whether it landed.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { ClosedRequestRecord, IdentityRequestRecord } from './verification-request.service.js';

type Client = Pick<Transaction, 'verificationRequest' | 'verificationDocument'>;

/** The person's open request; null for none. The newest when, against the service's rule, two are. */
export async function openRequestOf(
  tx: Client,
  userId: string,
): Promise<IdentityRequestRecord | null> {
  const row = await tx.verificationRequest.findFirst({
    where: { userId, status: 'open' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      userId: true,
      reason: true,
      status: true,
      createdAt: true,
      documentId: true,
      documentType: true,
      document: { select: { uploadedAt: true } },
    },
  });
  return row === null ? null : recordOf(row);
}

/** The person's latest closed request, by when it closed (T115); null for none. */
export async function lastClosedRequestOf(
  tx: Client,
  userId: string,
): Promise<ClosedRequestRecord | null> {
  const row = await tx.verificationRequest.findFirst({
    where: { userId, status: { not: 'open' } },
    orderBy: [
      { resolvedAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    select: { status: true, resolvedAt: true },
  });
  if (row === null || row.status === 'open') return null;
  return { status: row.status, resolvedAt: row.resolvedAt };
}

/** One request; null when it is not there. */
export async function readRequest(
  tx: Client,
  requestId: string,
): Promise<IdentityRequestRecord | null> {
  const row = await tx.verificationRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      reason: true,
      status: true,
      createdAt: true,
      documentId: true,
      documentType: true,
      document: { select: { uploadedAt: true } },
    },
  });
  return row === null ? null : recordOf(row);
}

/** Opens a request with its reason; its id. */
export async function openRequest(
  tx: Client,
  request: { userId: string; adminId: string; reason: string; at: Date },
): Promise<string> {
  const { id } = await tx.verificationRequest.create({
    data: {
      userId: request.userId,
      requestedByAdminId: request.adminId,
      reason: request.reason,
      status: 'open',
      createdAt: request.at,
    },
    select: { id: true },
  });
  return id;
}

/** Attaches the document while the request is open with none. */
export async function attachDocument(
  tx: Client,
  attachment: { requestId: string; documentId: string; documentType: 'national_id' | 'passport' },
): Promise<boolean> {
  const { count } = await tx.verificationRequest.updateMany({
    where: { id: attachment.requestId, status: 'open', documentId: null },
    data: { documentId: attachment.documentId, documentType: attachment.documentType },
  });
  return count === 1;
}

/** Closes the request while it is open with a document. */
export async function resolveRequest(tx: Client, requestId: string, at: Date): Promise<boolean> {
  const { count } = await tx.verificationRequest.updateMany({
    where: { id: requestId, status: 'open', documentId: { not: null } },
    data: { status: 'satisfied', resolvedAt: at },
  });
  return count === 1;
}

/**
 * Closes an open request that holds a document as `replaced`, the document kept on it, and opens a
 * new request for the same person with the note as its reason; the new request's id, or null when
 * the first was no longer open with a document.
 */
export async function replaceRequest(
  tx: Client,
  replacement: { requestId: string; adminId: string; note: string; at: Date },
): Promise<string | null> {
  const { count } = await tx.verificationRequest.updateMany({
    where: { id: replacement.requestId, status: 'open', documentId: { not: null } },
    data: { status: 'replaced', resolvedAt: replacement.at },
  });
  if (count === 0) return null;
  const replaced = await tx.verificationRequest.findUnique({
    where: { id: replacement.requestId },
    select: { userId: true },
  });
  if (replaced === null) return null;
  return openRequest(tx, {
    userId: replaced.userId,
    adminId: replacement.adminId,
    reason: replacement.note,
    at: replacement.at,
  });
}

/** When the document was uploaded; null when it is not there. */
export async function documentUploadedAt(tx: Client, documentId: string): Promise<Date | null> {
  const row = await tx.verificationDocument.findUnique({
    where: { id: documentId },
    select: { uploadedAt: true },
  });
  return row?.uploadedAt ?? null;
}

function recordOf(row: {
  readonly id: string;
  readonly userId: string;
  readonly reason: string;
  readonly status: IdentityRequestRecord['status'];
  readonly createdAt: Date;
  readonly documentId: string | null;
  readonly documentType: 'national_id' | 'passport' | null;
  readonly document: { readonly uploadedAt: Date } | null;
}): IdentityRequestRecord {
  return {
    requestId: row.id,
    userId: row.userId,
    reason: row.reason,
    status: row.status,
    requestedAt: row.createdAt,
    document:
      row.documentId === null || row.documentType === null || row.document === null
        ? null
        : {
            documentId: row.documentId,
            type: row.documentType,
            submittedAt: row.document.uploadedAt,
          },
  };
}
