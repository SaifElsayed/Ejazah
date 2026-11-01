// T056: the teacher's application (FR-150, FR-152, FR-155; app-surface.md "`teacher.application`").
//
// An application holds the subjects from the admin's list, a qualification sentence, one identity
// document and one ijazah PDF per chosen subject, each a document the applicant uploaded. What the
// input alone decides is refused before anything is read: a subject chosen twice, a PDF for a
// subject not chosen, one document named twice (`VALIDATION_FAILED`), a chosen subject without its
// PDF (`APPLICATION_INCOMPLETE`). Then, on one transaction: the state the call moves from, the
// subjects active, every document the applicant's own (`DOCUMENT_NOT_OWNED`, for one that does not
// exist too, so an id tells nothing of another person's), and the writes: the profile's application
// `in_review` (identity's entry) and one pending credential per subject sent with it (catalog's).
// Each write is conditional on the state it moves from, so a call that lost a race is `CONFLICT`
// and leaves nothing.
//
// `submit` is keyed (`idempotent-procedures.ts`): it runs inside the kernel's idempotency
// transaction, so a retry answers the first outcome. `reapply` opens a new application from
// `rejected` only, the earlier credentials kept as history (FR-155); `resubmit` replaces what a
// request for a document asked for and returns the application to the queue, refused while a
// credential the reviewer asked for is left unreplaced. A banned application is `FORBIDDEN`
// everywhere: the banned account sees the restricted screen (FR-137), never this one.
import type {
  ApplicationGetOutput,
  ApplicationReapplyInput,
  ApplicationResubmitInput,
  ApplicationSubmitInput,
} from '@ijazah/contracts';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { ApplicationRecord, CredentialRecord, VerificationStores } from './stores.js';

export interface ApplicationServiceDependencies {
  readonly stores: VerificationStores;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly now?: () => Date;
}

const invalid = (path: string, code: string) =>
  new DomainError('VALIDATION_FAILED', undefined, { details: [{ path, code }] });

/** The states a call may move the application from; anything else is `CONFLICT`. */
function moving(application: ApplicationRecord | null, from: ApplicationRecord['status']): void {
  const status = application?.status ?? null;
  if (status === 'banned') throw new DomainError('FORBIDDEN');
  if (status !== from) throw new DomainError('CONFLICT');
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/** Whether the credential was sent with the application submitted at `submittedAt`. */
function ofApplication(credential: CredentialRecord, submittedAt: Date): boolean {
  return credential.submittedWithApplication && credential.createdAt >= submittedAt;
}

export class ApplicationService {
  readonly #stores: VerificationStores;
  readonly #idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly #now: () => Date;

  constructor({ stores, idempotency, now = () => new Date() }: ApplicationServiceDependencies) {
    this.#stores = stores;
    this.#idempotency = idempotency;
    this.#now = now;
  }

  /** The status screen in each drawn state (FR-152). */
  get(userId: string): Promise<ApplicationGetOutput> {
    return this.#stores.run(async (tx) => {
      const application = await this.#stores.readApplication(tx, userId);
      const status = application?.status ?? null;
      if (application === null || status === null) {
        return { status: 'not_started', callRecorded: false, approvedShown: false };
      }
      if (status === 'banned') throw new DomainError('FORBIDDEN');
      const { submittedAt, note, decidedAt } = application;
      const credentials =
        submittedAt === null
          ? []
          : (await this.#stores.credentialsOf(tx, userId)).filter((credential) =>
              ofApplication(credential, submittedAt),
            );
      const subjects = new Set(credentials.map(({ subjectId }) => subjectId));
      const noted = status === 'needs_document' || status === 'rejected';
      return {
        status,
        ...(submittedAt === null ? {} : { submittedAt: submittedAt.toISOString() }),
        ...(subjects.size === 0 ? {} : { subjectCount: subjects.size }),
        ...(noted && note !== null ? { note } : {}),
        callRecorded: application.callRecorded,
        ...((noted || status === 'approved') && decidedAt !== null
          ? { decidedAt: decidedAt.toISOString() }
          : {}),
        approvedShown: application.approvedShownAt !== null,
      };
    });
  }

  /** The first application (FR-150); keyed, so a retry answers the first outcome. */
  async submit(userId: string, input: ApplicationSubmitInput): Promise<void> {
    const { idempotencyKey, ...application } = input;
    this.#checkApplication(application);
    await this.#idempotency.run(
      {
        scope: 'teacher.application.submit',
        key: idempotencyKey,
        actorId: userId,
        input: application,
      },
      async (tx) => {
        await this.#open(tx, userId, application, null);
        return null;
      },
    );
  }

  /** A new application after a rejection, the earlier one kept in history (FR-155). */
  async reapply(userId: string, input: ApplicationReapplyInput): Promise<void> {
    this.#checkApplication(input);
    await this.#stores.run(async (tx) => {
      // The account's lock first, the order a ban takes it (T142, the owner's decision of
      // 2026-11-01): the new credentials reference the teacher's `users` row, so holding only the
      // application, their insert would wait on a ban holding the account while the ban waits on
      // the application.
      await this.#stores.lockAccount(tx, userId);
      await this.#open(tx, userId, input, 'rejected');
    });
  }

  /** What a request for a document asked for, replaced; the application returns to the queue. */
  async resubmit(userId: string, input: ApplicationResubmitInput): Promise<void> {
    const replacements = input.credentials ?? [];
    if (hasDuplicate(replacements.map(({ credentialId }) => credentialId))) {
      throw invalid('credentials', 'duplicate');
    }
    const documents = [
      ...(input.identityDocumentId === undefined ? [] : [input.identityDocumentId]),
      ...replacements.map(({ documentId }) => documentId),
    ];
    if (hasDuplicate(documents)) throw invalid('documents', 'duplicate');

    await this.#stores.run(async (tx) => {
      // The application's lock first (T161): a request for a credential's document meanwhile
      // commits before the credentials are read, so one it set waiting is seen still waiting.
      await this.#stores.lockApplication(tx, userId);
      const application = await this.#stores.readApplication(tx, userId);
      moving(application, 'needs_document');
      await this.#ownedOrRefused(tx, userId, documents);

      const credentials = await this.#stores.credentialsOf(tx, userId);
      for (const { credentialId } of replacements) {
        const credential = credentials.find(({ id }) => id === credentialId);
        if (credential === undefined) throw new DomainError('NOT_FOUND');
        if (credential.status !== 'needs_document') {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'credentials', code: 'not_requested' }],
          });
        }
      }
      for (const { credentialId, documentId } of replacements) {
        const replaced = await this.#stores.replaceCredentialDocument(tx, {
          credentialId,
          teacherUserId: userId,
          documentId,
        });
        if (!replaced) throw new DomainError('CONFLICT');
      }
      const replacedIds = new Set(replacements.map(({ credentialId }) => credentialId));
      const submittedAt = application?.submittedAt ?? null;
      const stillWaiting = credentials.some(
        (credential) =>
          credential.status === 'needs_document' &&
          !replacedIds.has(credential.id) &&
          submittedAt !== null &&
          ofApplication(credential, submittedAt),
      );
      if (stillWaiting) throw new DomainError('APPLICATION_INCOMPLETE');

      const returned = await this.#stores.setApplication(tx, userId, {
        kind: 'resubmit',
        identityDocumentId: input.identityDocumentId,
      });
      if (!returned) throw new DomainError('CONFLICT');
    });
  }

  /** The once-only `ApplicationApproved` was shown (FR-152); a repeat changes nothing. */
  markApprovedShown(userId: string): Promise<void> {
    return this.#stores.run(async (tx) => {
      const application = await this.#stores.readApplication(tx, userId);
      if (application?.status !== 'approved') throw new DomainError('CONFLICT');
      if (application.approvedShownAt !== null) return;
      await this.#stores.setApplication(tx, userId, { kind: 'approvedShown', at: this.#now() });
    });
  }

  /** What the input alone decides: no subject twice, one PDF per chosen subject, no document twice. */
  #checkApplication(application: ApplicationReapplyInput): void {
    const { subjectIds, credentials, identityDocument } = application;
    if (hasDuplicate(subjectIds)) throw invalid('subjectIds', 'duplicate');
    const withPdf = credentials.map(({ subjectId }) => subjectId);
    if (hasDuplicate(withPdf)) throw invalid('credentials', 'duplicate');
    if (withPdf.some((subjectId) => !subjectIds.includes(subjectId))) {
      throw invalid('credentials', 'not_chosen');
    }
    const documents = [
      identityDocument.documentId,
      ...credentials.map(({ documentId }) => documentId),
    ];
    if (hasDuplicate(documents)) throw invalid('documents', 'duplicate');
    if (subjectIds.some((subjectId) => !withPdf.includes(subjectId))) {
      throw new DomainError('APPLICATION_INCOMPLETE', undefined, {
        details: [{ path: 'credentials', code: 'missing' }],
      });
    }
  }

  /** Opens the application from `from` on `tx`, with one pending credential per subject. */
  async #open(
    tx: Transaction,
    userId: string,
    application: ApplicationReapplyInput,
    from: null | 'rejected',
  ): Promise<void> {
    moving(await this.#stores.readApplication(tx, userId), from);
    const active = await this.#stores.activeSubjectsAmong(tx, application.subjectIds);
    if (application.subjectIds.some((subjectId) => !active.has(subjectId))) {
      throw invalid('subjectIds', 'unknown');
    }
    await this.#ownedOrRefused(tx, userId, [
      application.identityDocument.documentId,
      ...application.credentials.map(({ documentId }) => documentId),
    ]);

    const submittedAt = this.#now();
    const opened = await this.#stores.setApplication(tx, userId, {
      kind: 'open',
      from,
      qualificationSummary: application.qualificationSummary,
      identityDocumentId: application.identityDocument.documentId,
      identityDocumentType: application.identityDocument.type,
      submittedAt,
    });
    if (!opened) throw new DomainError('CONFLICT');
    for (const { subjectId, documentId } of application.credentials) {
      await this.#stores.addCredential(tx, {
        teacherUserId: userId,
        subjectId,
        documentId,
        submittedWithApplication: true,
        createdAt: submittedAt,
      });
    }
  }

  /** Refuses with `DOCUMENT_NOT_OWNED` unless every one of `ids` is the person's own upload. */
  async #ownedOrRefused(tx: Transaction, userId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const owned = await this.#stores.documentsOwnedAmong(tx, userId, ids);
    if (ids.some((id) => !owned.has(id))) throw new DomainError('DOCUMENT_NOT_OWNED');
  }
}
