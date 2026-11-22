// T056, T057, T068: what the application, the credentials, the review and the identity requests read
// and write, in one place, and the real stores composed from the owners' entries (R-121, R-API-6):
// the application's columns are the identity module's (`teacher_profiles`), the credential rows and
// the subjects the catalog module's, the documents and the requests this module's own. Every method runs on the transaction it is handed, so
// a call's reads and writes commit together; a conditional write answers whether it wrote.
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import {
  activeSubjectsAmong,
  addCredential,
  closeUndecidedCredentials,
  type CredentialRow,
  credentialsOfTeachers,
  grantSubjects,
  listCredentials,
  type NewCredentialRow,
  replaceCredentialDocument,
} from '../catalog/index.js';
import {
  applicantsCount,
  applicantsPage,
  type ApplicationChange,
  type ApplicationRecord,
  decideApplication,
  lockAccount,
  lockApplication,
  readApplicant,
  readApplication,
  readStanding,
  recordApplicationCall,
  recordApplicationHistory,
  setApplication,
} from '../identity/index.js';
import type { ApplicationReviewStore } from './application-review.service.js';
import type { IdentityRequestStore } from './verification-request.service.js';
import { documentSizes, documentsOwnedAmong } from './verification.repository.js';
import {
  attachDocument,
  documentUploadedAt,
  lastClosedRequestOf,
  openRequest,
  openRequestOf,
  readRequest,
  replaceRequest,
  resolveRequest,
} from './verification-requests.repository.js';

export type { ApplicationChange, ApplicationRecord };

/** A credential as the services read it: the catalog module's row with its subject and chain. */
export type CredentialRecord = CredentialRow;

/** A credential row to write. */
export type NewCredential = NewCredentialRow;

export interface VerificationStores {
  /** Runs `work` in one transaction: committed if it resolves, rolled back if it throws. */
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  /** Locks the account's `users` row until the transaction ends, identity's (T142). */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /** Locks the application's row until the transaction ends, identity's (T161). */
  lockApplication(tx: Transaction, userId: string): Promise<void>;
  /** The applicant's application, or null before the profile exists. */
  readApplication(tx: Transaction, userId: string): Promise<ApplicationRecord | null>;
  /** Writes the change while the application is in the state it requires; whether it wrote. */
  setApplication(tx: Transaction, userId: string, change: ApplicationChange): Promise<boolean>;
  /** Of `ids`, the subjects of the admin's list that are active. */
  activeSubjectsAmong(tx: Transaction, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** Every credential of the teacher, oldest first. */
  credentialsOf(tx: Transaction, userId: string): Promise<CredentialRecord[]>;
  addCredential(tx: Transaction, row: NewCredential): Promise<string>;
  /** Takes a new PDF for the teacher's credential while it waits on one; whether it did. */
  replaceCredentialDocument(
    tx: Transaction,
    replacement: { credentialId: string; teacherUserId: string; documentId: string },
  ): Promise<boolean>;
  /** Of `ids`, the documents `userId` uploaded. */
  documentsOwnedAmong(
    tx: Transaction,
    userId: string,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>>;
  /** The recorded size of each of `ids` that has one. */
  documentSizes(tx: Transaction, ids: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

/** The stores over the process's database. */
export function createVerificationStores(database: Database): VerificationStores {
  const { run } = transactionsOver(database);
  return {
    run,
    lockAccount,
    lockApplication,
    readApplication,
    setApplication,
    activeSubjectsAmong,
    credentialsOf: listCredentials,
    addCredential,
    replaceCredentialDocument,
    documentsOwnedAmong,
    documentSizes,
  };
}

/**
 * The application review's store (T068): the applicants and their decisions are identity's, the
 * credentials and the subjects catalog's, the identity document and the requests this module's own.
 */
export function createApplicationReviewStore(): ApplicationReviewStore {
  return {
    page: applicantsPage,
    count: applicantsCount,
    lockAccount,
    lockApplication,
    read: readApplicant,
    credentialsOf: async (tx, userIds) =>
      (await credentialsOfTeachers(tx, userIds)).map((row) => ({
        credentialId: row.id,
        teacherUserId: row.teacherUserId,
        subject: row.subject,
        status: row.status,
        documentId: row.documentId,
        submittedWithApplication: row.submittedWithApplication,
        createdAt: row.createdAt,
      })),
    documentUploadedAt,
    openRequestOf: async (tx, userId) => {
      const request = await openRequestOf(tx, userId);
      if (request === null) return null;
      return {
        requestId: request.requestId,
        reason: request.reason,
        requestedAt: request.requestedAt.toISOString(),
        ...(request.document === null
          ? {}
          : {
              document: {
                documentId: request.document.documentId,
                type: request.document.type,
                submittedAt: request.document.submittedAt.toISOString(),
              },
            }),
      };
    },
    recordCall: recordApplicationCall,
    decide: decideApplication,
    grantSubjects,
    closeCredentials: closeUndecidedCredentials,
    // R1a (002:T174): the application's history, through identity's one entry.
    recordHistory: recordApplicationHistory,
  };
}

/** The identity requests' store (T068), the account's status read through identity's entry. */
export function createIdentityRequestStore(database: Database): IdentityRequestStore {
  const { run } = transactionsOver(database);
  return {
    run,
    lockAccount,
    accountStatusOf: async (tx, userId) => (await readStanding(tx, userId))?.accountStatus ?? null,
    openRequestOf,
    lastClosedRequestOf,
    readRequest,
    openRequest,
    attachDocument,
    resolve: resolveRequest,
    replace: replaceRequest,
    documentsOwnedAmong,
  };
}
