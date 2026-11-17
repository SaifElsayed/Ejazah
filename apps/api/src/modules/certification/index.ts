// PUBLIC ENTRY of the certification module (T017). Other modules import this file and nothing below it (R-API-3).
//
// T006 of specs/005-certification (FR-603, FR-608, FR-627, FR-628; the note under T006): the ijazah
// request. Certification imports identity, catalog and booking through their entries (plan.md, the
// module graph); the three modules reach the request only through ports they declare, which
// `main.ts` binds to the service `createIjazahRequestService` builds (`docs/ARCHITECTURE.md:197`):
//   - identity's `AwaitingNameRelease` → `release`;
//   - catalog's `OpenRequestsRefreeze` → `refreeze`;
//   - booking's `EnrollmentIjazahRequests` → `of`;
//   - identity's `AccountConsequences` → `deletionConsequence()`, subscribed once.
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { drawRowId } from '../../platform/db/row-id.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { ijazahEnrollmentOf } from '../booking/index.js';
import {
  approvedCredentialChainById,
  approvedCredentialChainOf,
  lockedCredentialChainOf,
  teacherSignatureOf,
} from '../catalog/index.js';
import { accountTimezone, certificateNameOf, readStanding } from '../identity/index.js';
import {
  closeOpen,
  hasOpenBar,
  hasOpenRequest,
  hasUnrevokedIjazah,
  insertRequest,
  latestRequestsAmong,
  lockAccounts,
  lockEnrollment,
  lockRequests,
  openRequestsOfCredential,
  openRequestsOfStudent,
  refreezeOpen,
  releaseAwaiting,
} from './ijazah-request.repository.js';
import {
  type IjazahRequestLog,
  IjazahRequestService,
  type IjazahRequestStore,
} from './ijazah-request.service.js';

/**
 * The request's store: this module's rows and locks, and the reads of booking (the enrollment),
 * catalog (the credential's chain, the signature's row) and identity (the standing, the zone, the
 * certificate name) through their entries. Exported for the probe of its queries and locks
 * (`tests/db-integrity/ijazah-requests.spec.ts`).
 */
export const ijazahRequestStore: IjazahRequestStore = {
  enrollmentOf: ijazahEnrollmentOf,
  standingOf: readStanding,
  timezoneOf: accountTimezone,
  chainOf: approvedCredentialChainOf,
  lockedChainOf: lockedCredentialChainOf,
  chainById: approvedCredentialChainById,
  certificateNameOf,
  signatureKeyOf: async (tx, teacherUserId) =>
    (await teacherSignatureOf(tx, teacherUserId))?.storageKey ?? null,
  lockAccounts,
  lockEnrollment,
  lockRequests,
  hasOpenBar,
  hasOpenRequest,
  hasUnrevokedIjazah,
  insert: insertRequest,
  latestAmong: latestRequestsAmong,
  openOfStudent: openRequestsOfStudent,
  openOfCredential: openRequestsOfCredential,
  releaseAwaiting,
  refreezeOpen,
  closeOpen,
};

/** What the request's service is built over, bound once by `main.ts`. */
export interface IjazahRequestServiceDependencies {
  readonly database: Database;
  readonly storage: Pick<StoragePort, 'read' | 'put' | 'remove'>;
  /** The kernel's idempotency: `send` is keyed in its own transaction (`run`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'completed'>;
  readonly log: IjazahRequestLog;
}

/**
 * The request's service, built once by `main.ts`: `teacher.ijazahRequests.*` through
 * `CertificationServices`, and the four bindings this file's head names.
 */
export function createIjazahRequestService({
  database,
  storage,
  idempotency,
  log,
}: IjazahRequestServiceDependencies): IjazahRequestService {
  return new IjazahRequestService({
    transactions: transactionsOver(database),
    store: ijazahRequestStore,
    storage,
    idempotency,
    drawId: () => drawRowId(database),
    clock: clockTimestamp,
    log,
  });
}
export type { IjazahRequestService };

/** The certification module's services on the user surface (T006): `teacher.ijazahRequests.*`. */
export interface CertificationServices {
  readonly ijazahRequests: Pick<IjazahRequestService, 'preview' | 'send' | 'get'>;
}

/** The `teacher.ijazahRequests` namespace, mounted by `app.router.ts`. */
export { ijazahRequestsRouter } from './ijazah-requests.router.js';
