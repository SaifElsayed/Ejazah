// T056: the identity module's entries for the teacher's application (data-model §3, R-121). The
// application is a state of the identity module's `teacher_profiles` row, while its rules (what an
// application holds, which state may move to which) are the verification module's, which calls
// these on its own transaction so the profile and the credentials commit together.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  type ApplicationRecord,
  ApplicationRepository,
  type OpenedApplication,
} from './application.repository.js';

export type {
  ApplicationRecord,
  ApplicationStatus,
  OpenedApplication,
} from './application.repository.js';

/** A change to the application, each from the one state it may move from. */
export type ApplicationChange =
  | ({ readonly kind: 'open' } & OpenedApplication)
  | { readonly kind: 'resubmit'; readonly identityDocumentId?: string | undefined }
  | { readonly kind: 'approvedShown'; readonly at: Date };

type Client = Pick<Transaction, 'teacherProfile'>;

/** The applicant's application on `tx`, or null before the profile exists. */
export function readApplication(tx: Client, userId: string): Promise<ApplicationRecord | null> {
  return new ApplicationRepository(tx).read(userId);
}

/**
 * Writes `change` on `tx` while the application is in the state it moves from (`open` from none or
 * `rejected`, `resubmit` from `needs_document`, `approvedShown` from `approved` not yet shown);
 * whether it wrote. Nothing is written otherwise.
 */
export function setApplication(
  tx: Client,
  userId: string,
  change: ApplicationChange,
): Promise<boolean> {
  const applications = new ApplicationRepository(tx);
  switch (change.kind) {
    case 'open':
      return applications.open(userId, change);
    case 'resubmit':
      return applications.resubmit(userId, change.identityDocumentId);
    case 'approvedShown':
      return applications.markApprovedShown(userId, change.at);
  }
}
