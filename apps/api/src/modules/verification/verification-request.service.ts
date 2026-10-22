// T068 (FR-166, DEC-13b): the administrator's demand for an identity document, and the user's answer.
// `users.requireIdentity` opens a request with its reason on an active account and moves the account
// to `verification_required` through identity's standing; the user's `account.identityVerification`
// reads the open request and attaches the document they uploaded (`POST /uploads/documents`);
// `documents.accept` closes it and reactivates the account, only from `verification_required` (owner's
// decision 2026-10-22: an account suspended meanwhile stays suspended); `documents.requestAnother`
// closes it as `replaced`, keeping the document it held (so the documents sweep leaves it, B13b
// review, follow-up 1), and opens a new request with the note as the reason the user reads. The administrator never modifies or replaces a document; `documents.link`
// answers a signed, expiring link to view one (NFR-SEC-3).
//
// The administrator's methods run on the administrator kind's transaction (`tx`); the user's open
// their own through the store (`run`).
import type { identityVerificationGetOutput } from '@ijazah/contracts';
import type { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { DocumentLink, DocumentViewer } from './verification.service.js';

type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';
type DocumentType = 'national_id' | 'passport';

/** A request as the services read it. */
export interface IdentityRequestRecord {
  readonly requestId: string;
  readonly userId: string;
  readonly reason: string;
  readonly status: 'open' | 'satisfied' | 'expired' | 'replaced';
  readonly requestedAt: Date;
  readonly document: {
    readonly documentId: string;
    readonly type: DocumentType;
    readonly submittedAt: Date;
  } | null;
}

/** What the requests read and write, each on the transaction it is handed (`stores.ts`). */
export interface IdentityRequestStore {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  /** The live person's account status, identity's; null for none. */
  accountStatusOf(tx: Transaction, userId: string): Promise<AccountStatus | null>;
  openRequestOf(tx: Transaction, userId: string): Promise<IdentityRequestRecord | null>;
  readRequest(tx: Transaction, requestId: string): Promise<IdentityRequestRecord | null>;
  openRequest(
    tx: Transaction,
    request: { userId: string; adminId: string; reason: string; at: Date },
  ): Promise<string>;
  /** Attaches the document while the request is open with none; whether it did. */
  attachDocument(
    tx: Transaction,
    attachment: { requestId: string; documentId: string; documentType: DocumentType },
  ): Promise<boolean>;
  /** Closes the request while it is open with a document; whether it did. */
  resolve(tx: Transaction, requestId: string, at: Date): Promise<boolean>;
  /**
   * Closes an open request holding a document as `replaced`, keeping the document, and opens a new
   * one with the note as its reason; the new request's id, or null when it was no longer so.
   */
  replace(
    tx: Transaction,
    replacement: { requestId: string; adminId: string; note: string; at: Date },
  ): Promise<string | null>;
  documentsOwnedAmong(
    tx: Transaction,
    userId: string,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>>;
}

/** The standing's two moves, identity's (`standing.service.ts`). */
export interface IdentityStanding {
  requireIdentity(tx: Transaction, userId: string): Promise<boolean>;
  identityAccepted(tx: Transaction, userId: string): Promise<void>;
}

/** The signed link to a document, this module's own (`verification.service.ts`). */
export interface DocumentLinks {
  documentLinkFor(
    tx: Transaction,
    documentId: string,
    viewer: DocumentViewer,
  ): Promise<Pick<DocumentLink, 'url'> & { readonly expiresAt: string }>;
}

export interface VerificationRequestDependencies {
  readonly store: IdentityRequestStore;
  readonly standing: IdentityStanding;
  readonly links: DocumentLinks;
  readonly now?: () => Date;
}

export class VerificationRequestService {
  readonly #store: IdentityRequestStore;
  readonly #standing: IdentityStanding;
  readonly #links: DocumentLinks;
  readonly #now: () => Date;

  constructor(dependencies: VerificationRequestDependencies) {
    this.#store = dependencies.store;
    this.#standing = dependencies.standing;
    this.#links = dependencies.links;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** `users.requireIdentity`: an active account, with no request open; the new request's id. */
  async requireIdentity(
    tx: Transaction,
    adminId: string,
    input: { readonly userId: string; readonly reason: string },
  ): Promise<{ readonly requestId: string }> {
    const status = await this.#store.accountStatusOf(tx, input.userId);
    if (status === null) throw new DomainError('NOT_FOUND');
    if ((await this.#store.openRequestOf(tx, input.userId)) !== null) {
      throw conflict('userId', 'request_open');
    }
    if (status !== 'active') throw conflict('userId', status);
    const requestId = await this.#store.openRequest(tx, {
      userId: input.userId,
      adminId,
      reason: input.reason,
      at: this.#now(),
    });
    // The standing moved meanwhile: the request is rolled back with the call.
    if (!(await this.#standing.requireIdentity(tx, input.userId))) {
      const now = await this.#store.accountStatusOf(tx, input.userId);
      throw conflict('userId', now ?? 'active');
    }
    return { requestId };
  }

  /** `documents.accept`: an open request with its document; the account active again. */
  async accept(
    tx: Transaction,
    _adminId: string,
    input: { readonly requestId: string },
  ): Promise<{ readonly userId: string }> {
    const request = await this.#reviewable(tx, input.requestId);
    if (!(await this.#store.resolve(tx, request.requestId, this.#now()))) {
      await this.#refuseMoved(tx, request.requestId);
    }
    await this.#standing.identityAccepted(tx, request.userId);
    return { userId: request.userId };
  }

  /**
   * `documents.requestAnother`: the request is closed as `replaced`, keeping the document it held,
   * and a new one opens with the note as the reason the person reads; the account stays waiting.
   */
  async requestAnother(
    tx: Transaction,
    adminId: string,
    input: { readonly requestId: string; readonly note: string },
  ): Promise<{ readonly userId: string; readonly requestId: string; readonly documentId: string }> {
    const request = await this.#reviewable(tx, input.requestId);
    const next = await this.#store.replace(tx, {
      requestId: request.requestId,
      adminId,
      note: input.note,
      at: this.#now(),
    });
    if (next === null) return this.#refuseMoved(tx, request.requestId);
    // `#reviewable` answered only a request holding a document.
    return {
      userId: request.userId,
      requestId: next,
      documentId: request.document?.documentId ?? '',
    };
  }

  /** `documents.link`: a signed link to view the document, for the administrator (NFR-SEC-3). */
  async link(
    tx: Transaction,
    adminId: string,
    documentId: string,
  ): Promise<{ readonly url: string; readonly expiresAt: string }> {
    const { url, expiresAt } = await this.#links.documentLinkFor(tx, documentId, {
      kind: 'admin',
      adminId,
    });
    return { url, expiresAt };
  }

  /** The request, open and with a document to review, or the refusal naming why not. */
  async #reviewable(tx: Transaction, requestId: string): Promise<IdentityRequestRecord> {
    const request = await this.#store.readRequest(tx, requestId);
    if (request === null) throw new DomainError('NOT_FOUND');
    if (request.status !== 'open') throw conflict('requestId', request.status);
    if (request.document === null) throw conflict('requestId', 'no_document');
    return request;
  }

  async #refuseMoved(tx: Transaction, requestId: string): Promise<never> {
    await this.#reviewable(tx, requestId);
    throw conflict('requestId', 'open');
  }
}

/** The person's side of a request (`account.identityVerification`), each call its own transaction. */
export class IdentityVerificationService {
  readonly #store: IdentityRequestStore;

  constructor(dependencies: { readonly store: IdentityRequestStore }) {
    this.#store = dependencies.store;
  }

  /** `account.identityVerification.get`: the user's open request, if any. */
  get(userId: string): Promise<z.input<typeof identityVerificationGetOutput>> {
    return this.#store.run(async (tx) => {
      const request = await this.#store.openRequestOf(tx, userId);
      if (request === null) return { open: false };
      return {
        open: true,
        reason: request.reason,
        requestedAt: request.requestedAt.toISOString(),
        ...(request.document === null
          ? {}
          : {
              documentType: request.document.type,
              submittedAt: request.document.submittedAt.toISOString(),
            }),
      };
    });
  }

  /** `account.identityVerification.submit`: the user's own document on their open request. */
  submit(
    userId: string,
    input: { readonly documentType: DocumentType; readonly documentId: string },
  ): Promise<void> {
    return this.#store.run(async (tx) => {
      const request = await this.#store.openRequestOf(tx, userId);
      if (request === null) throw new DomainError('NOT_FOUND');
      const owned = await this.#store.documentsOwnedAmong(tx, userId, [input.documentId]);
      if (!owned.has(input.documentId)) throw new DomainError('DOCUMENT_NOT_OWNED');
      if (request.document !== null) throw conflict('documentId', 'submitted');
      const attached = await this.#store.attachDocument(tx, {
        requestId: request.requestId,
        documentId: input.documentId,
        documentType: input.documentType,
      });
      if (!attached) throw conflict('documentId', 'submitted');
    });
  }
}

function conflict(path: string, code: string): DomainError {
  return new DomainError('CONFLICT', undefined, { details: [{ path, code }] });
}
