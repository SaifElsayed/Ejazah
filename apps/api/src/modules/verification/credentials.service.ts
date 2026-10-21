// T057: the teacher's credentials after approval (FR-153, FR-PROFILE-11, FR-ISNAD-5; app-surface.md
// "`teacher.credentials`"). The rows are the catalog module's, read and written through its entry;
// the documents and their links are this module's (R-121).
//
// `list` answers every credential of the teacher, oldest first, with its subject and its dates. The
// transcription an administrator wrote at approval (holder, riwaya, tariq, the chain origin first)
// is answered on an approved credential only (FR-ISNAD-5), the reviewer's reason while it waits on a
// document or after a rejection, and the PDF's size when its upload recorded one. `add` writes a
// pending credential for a subject that has none approved or waiting (a rejected one stays as
// history); the subject becomes the teacher's only on approval. `replaceDocument` takes a new PDF
// for a credential waiting on one; `documentLink` mints a signed, expiring link to the teacher's own
// PDF. Another teacher's credential is `NOT_FOUND`: a request names the caller's rows only.
import type {
  CredentialsAddInput,
  CredentialsReplaceDocumentInput,
  CredentialSummary,
} from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { CredentialRecord, VerificationStores } from './stores.js';
import type { DocumentLink, VerificationService } from './verification.service.js';

export interface CredentialsServiceDependencies {
  readonly stores: VerificationStores;
  readonly links: Pick<VerificationService, 'documentLinkFor'>;
  readonly now?: () => Date;
}

/** The statuses that hold a subject: a second credential for it waits on this one. */
const HOLDING: ReadonlySet<CredentialRecord['status']> = new Set([
  'pending',
  'needs_document',
  'approved',
]);

function summaryOf(credential: CredentialRecord, sizeBytes: number | undefined): CredentialSummary {
  const approved = credential.status === 'approved';
  const noted = credential.status === 'needs_document' || credential.status === 'rejected';
  const present = <K extends string>(key: K, value: string | null) =>
    value === null ? {} : ({ [key]: value } as Record<K, string>);
  return {
    credentialId: credential.id,
    subject: credential.subject,
    status: credential.status,
    submittedAt: credential.createdAt.toISOString(),
    ...(credential.reviewedAt === null ? {} : { reviewedAt: credential.reviewedAt.toISOString() }),
    ...(approved ? present('riwaya', credential.riwaya) : {}),
    ...(approved ? present('tariq', credential.tariq) : {}),
    ...(approved ? present('holderName', credential.holderName) : {}),
    ...(approved && credential.chain.length > 0
      ? { chain: credential.chain.map(({ position, names }) => ({ position, names: [...names] })) }
      : {}),
    ...(noted ? present('note', credential.reviewReason) : {}),
    document: sizeBytes === undefined ? {} : { sizeBytes },
  };
}

export class CredentialsService {
  readonly #stores: VerificationStores;
  readonly #links: Pick<VerificationService, 'documentLinkFor'>;
  readonly #now: () => Date;

  constructor({ stores, links, now = () => new Date() }: CredentialsServiceDependencies) {
    this.#stores = stores;
    this.#links = links;
    this.#now = now;
  }

  list(userId: string): Promise<CredentialSummary[]> {
    return this.#stores.run(async (tx) => {
      const credentials = await this.#stores.credentialsOf(tx, userId);
      const sizes = await this.#stores.documentSizes(
        tx,
        credentials.map(({ documentId }) => documentId),
      );
      return credentials.map((credential) =>
        summaryOf(credential, sizes.get(credential.documentId)),
      );
    });
  }

  add(userId: string, input: CredentialsAddInput): Promise<{ credentialId: string }> {
    return this.#stores.run(async (tx) => {
      const active = await this.#stores.activeSubjectsAmong(tx, [input.subjectId]);
      if (!active.has(input.subjectId)) {
        throw new DomainError('VALIDATION_FAILED', undefined, {
          details: [{ path: 'subjectId', code: 'unknown' }],
        });
      }
      await this.#owned(tx, userId, input.documentId);
      const credentials = await this.#stores.credentialsOf(tx, userId);
      const held = credentials.some(
        ({ subjectId, status }) => subjectId === input.subjectId && HOLDING.has(status),
      );
      if (held) {
        throw new DomainError('CONFLICT', undefined, {
          details: [{ path: 'subjectId', code: 'credential_exists' }],
        });
      }
      const credentialId = await this.#stores.addCredential(tx, {
        teacherUserId: userId,
        subjectId: input.subjectId,
        documentId: input.documentId,
        submittedWithApplication: false,
        createdAt: this.#now(),
      });
      return { credentialId };
    });
  }

  replaceDocument(userId: string, input: CredentialsReplaceDocumentInput): Promise<void> {
    return this.#stores.run(async (tx) => {
      const credential = await this.#own(tx, userId, input.credentialId);
      if (credential.status !== 'needs_document') throw new DomainError('CONFLICT');
      await this.#owned(tx, userId, input.documentId);
      const replaced = await this.#stores.replaceCredentialDocument(tx, {
        credentialId: input.credentialId,
        teacherUserId: userId,
        documentId: input.documentId,
      });
      if (!replaced) throw new DomainError('CONFLICT');
    });
  }

  documentLink(userId: string, input: { credentialId: string }): Promise<DocumentLink> {
    return this.#stores.run(async (tx) => {
      const credential = await this.#own(tx, userId, input.credentialId);
      return this.#links.documentLinkFor(tx, credential.documentId, { kind: 'user', userId });
    });
  }

  /** The caller's own credential; another's, or none, is `NOT_FOUND`. */
  async #own(tx: Transaction, userId: string, credentialId: string): Promise<CredentialRecord> {
    const credentials = await this.#stores.credentialsOf(tx, userId);
    const credential = credentials.find(({ id }) => id === credentialId);
    if (credential === undefined) throw new DomainError('NOT_FOUND');
    return credential;
  }

  async #owned(tx: Transaction, userId: string, documentId: string): Promise<void> {
    const owned = await this.#stores.documentsOwnedAmong(tx, userId, [documentId]);
    if (!owned.has(documentId)) throw new DomainError('DOCUMENT_NOT_OWNED');
  }
}
