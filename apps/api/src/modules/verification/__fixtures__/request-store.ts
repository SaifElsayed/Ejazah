// T064: the identity requests' store held in memory, for `verification-request.service.spec.ts`. It
// keeps the database's rules (a write moves only the state it names), so the service's own rules are
// what the spec proves; the real queries are probed in `tests/db-integrity/application-review.spec.ts`.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../../platform/db/prisma.repository.js';
import type {
  IdentityRequestRecord,
  IdentityRequestStore,
} from '../verification-request.service.js';

export const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
export const UPLOADED = new Date('2026-10-21T08:00:00Z');

/** Stands in for the call's transaction, which the memory store never reads. */
export const TX = {} as Transaction;

type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';

interface Held {
  id: string;
  userId: string;
  reason: string;
  status: 'open' | 'satisfied' | 'expired' | 'replaced';
  documentId: string | null;
  documentType: 'national_id' | 'passport' | null;
  createdAt: Date;
  resolvedAt: Date | null;
  requestedBy: string;
}

export class MemoryRequestStore implements IdentityRequestStore {
  readonly accounts = new Map<string, AccountStatus>();
  readonly #requests: Held[] = [];
  readonly #documents = new Map<string, string>();

  /** A live person; the id. */
  person(accountStatus: AccountStatus = 'active'): string {
    const userId = randomUUID();
    this.accounts.set(userId, accountStatus);
    return userId;
  }

  /** A document `userId` uploaded; its id. */
  upload(userId: string): string {
    const documentId = randomUUID();
    this.#documents.set(documentId, userId);
    return documentId;
  }

  requests(userId: string): Held[] {
    return this.#requests.filter((request) => request.userId === userId);
  }

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work(TX);
  }

  async accountStatusOf(_tx: Transaction, userId: string): Promise<AccountStatus | null> {
    return this.accounts.get(userId) ?? null;
  }

  async openRequestOf(_tx: Transaction, userId: string): Promise<IdentityRequestRecord | null> {
    const held = this.#requests.find(
      (request) => request.userId === userId && request.status === 'open',
    );
    return held === undefined ? null : recordOf(held);
  }

  async readRequest(_tx: Transaction, requestId: string): Promise<IdentityRequestRecord | null> {
    const held = this.#requests.find((request) => request.id === requestId);
    return held === undefined ? null : recordOf(held);
  }

  async openRequest(
    _tx: Transaction,
    request: { userId: string; adminId: string; reason: string; at: Date },
  ): Promise<string> {
    const id = randomUUID();
    this.#requests.push({
      id,
      userId: request.userId,
      reason: request.reason,
      status: 'open',
      documentId: null,
      documentType: null,
      createdAt: request.at,
      resolvedAt: null,
      requestedBy: request.adminId,
    });
    return id;
  }

  async attachDocument(
    _tx: Transaction,
    attachment: { requestId: string; documentId: string; documentType: 'national_id' | 'passport' },
  ): Promise<boolean> {
    const held = this.#requests.find((request) => request.id === attachment.requestId);
    if (held?.status !== 'open' || held.documentId !== null) return false;
    Object.assign(held, {
      documentId: attachment.documentId,
      documentType: attachment.documentType,
    });
    return true;
  }

  async resolve(_tx: Transaction, requestId: string, at: Date): Promise<boolean> {
    const held = this.#requests.find((request) => request.id === requestId);
    if (held?.status !== 'open' || held.documentId === null) return false;
    Object.assign(held, { status: 'satisfied', resolvedAt: at });
    return true;
  }

  async replace(
    tx: Transaction,
    replacement: { requestId: string; adminId: string; note: string; at: Date },
  ): Promise<string | null> {
    const held = this.#requests.find((request) => request.id === replacement.requestId);
    if (held?.status !== 'open' || held.documentId === null) return null;
    Object.assign(held, { status: 'replaced', resolvedAt: replacement.at });
    return this.openRequest(tx, {
      userId: held.userId,
      adminId: replacement.adminId,
      reason: replacement.note,
      at: replacement.at,
    });
  }

  async documentsOwnedAmong(
    _tx: Transaction,
    userId: string,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    return new Set(ids.filter((id) => this.#documents.get(id) === userId));
  }
}

function recordOf(held: Held): IdentityRequestRecord {
  return {
    requestId: held.id,
    userId: held.userId,
    reason: held.reason,
    status: held.status,
    requestedAt: held.createdAt,
    document:
      held.documentId === null || held.documentType === null
        ? null
        : { documentId: held.documentId, type: held.documentType, submittedAt: UPLOADED },
  };
}
