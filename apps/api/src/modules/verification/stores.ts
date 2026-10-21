// T056, T057: what the application and the credentials services read and write, in one place, and
// the real stores composed from the owners' entries (R-121, R-API-6): the application's columns are
// the identity module's (`teacher_profiles`), the credential rows and the subjects the catalog
// module's, the documents this module's own. Every method runs on the transaction it is handed, so
// a call's reads and writes commit together; a conditional write answers whether it wrote.
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import {
  activeSubjectsAmong,
  addCredential,
  type CredentialRow,
  listCredentials,
  type NewCredentialRow,
  replaceCredentialDocument,
} from '../catalog/index.js';
import {
  type ApplicationChange,
  type ApplicationRecord,
  readApplication,
  setApplication,
} from '../identity/index.js';
import { documentSizes, documentsOwnedAmong } from './verification.repository.js';

export type { ApplicationChange, ApplicationRecord };

/** A credential as the services read it: the catalog module's row with its subject and chain. */
export type CredentialRecord = CredentialRow;

/** A credential row to write. */
export type NewCredential = NewCredentialRow;

export interface VerificationStores {
  /** Runs `work` in one transaction: committed if it resolves, rolled back if it throws. */
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
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
