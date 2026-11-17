// PUBLIC ENTRY of the certification module (T017). Other modules import this file and nothing below it (R-API-3).
//
// T006 of specs/005-certification (FR-603, FR-608, FR-627, FR-628; the note under T006): the ijazah
// request. Certification imports identity, catalog and booking through their entries (plan.md, the
// module graph); the three modules reach the request only through ports they declare, which
// `main.ts` binds to the service `createIjazahRequestService` builds (`docs/ARCHITECTURE.md:195`):
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
// 005:T007: the administrators' review.
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import {
  generateCertificateNumber,
  generateVerificationToken,
} from '../../platform/guards/identifiers.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { subjectSummariesOf } from '../catalog/index.js';
import { sessionPartiesOf } from '../identity/index.js';
import {
  decisionRequestOf,
  ijazahOfRequest,
  insertIjazah,
  markApproved,
  markRejected,
  requestPage,
} from './ijazah-decision.repository.js';
import {
  type IjazahDecisionLog,
  IjazahDecisionService,
  type IjazahDecisionStore,
  type RenderQueue,
  type RequestDetail,
} from './ijazah-decision.service.js';
// 005:T010: an administrator's ijazahs, their revocation and the bar.
import {
  ijazahPage,
  ijazahRecordOf,
  insertBar,
  liftBar,
  lockIjazahs,
  markRevoked,
  openBarOf,
} from './ijazahs.repository.js';
import { type IjazahsLog, IjazahsService, type IjazahsStore } from './ijazahs.service.js';

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

// 005:T008 (B46, lane B; Q-B1 (a), the owner's word of 2026-11-17): the certificate's rendering,
// for the worker's `render-certificate` job. The render store over `ijazahs` and `ijazah_requests`
// (the source read outside a transaction, the mark on the job's transaction under the ijazah's
// lock), and the template's case and its one render call through the kernel's Typst runner.
export {
  type MarkOutcome,
  markRendered,
  type RenderedMark,
  type RenderSource,
  renderSourceOf,
} from './certificate-render.repository.js';
export {
  type CertificateCase,
  type CertificateGender,
  type CertificateLanguage,
  type PrintedDate,
  renderCertificatePdf,
  type SignatureImage,
  UnsupportedSignatureType,
} from './template/certificate-case.js';

// 005:T007 (B46, lane C; the note under T007, Q7 (a), Q10 (a), Q15 (a)): the administrators' review
// of a request, `ijazahRequests.*` on the administrator surface. Its store reads this module's rows
// and, through their entries, identity's parties and certificate name and catalog's subjects; the
// number and the token are the kernel's (`platform/guards/identifiers.ts`, R-DB-6), the token hashed
// at once (`hashLookupToken`, R-DB-7). `main.ts` binds `renders` to the queue's `render-certificate`
// (`RENDER_CERTIFICATE`, `renderCertificatePayload(ijazahId, generation)`, job id
// `${ijazahId}-${generation}`: BullMQ refuses a `:` in a custom id); the admin module composes it,
// `get` with the standing's reason from its audit log (Q10 (a)).
export const ijazahDecisionStore: IjazahDecisionStore = {
  requestOf: decisionRequestOf,
  page: requestPage,
  ijazahOf: ijazahOfRequest,
  partiesOf: sessionPartiesOf,
  subjectsOf: subjectSummariesOf,
  certificateNameOf,
  lockAccounts,
  lockRequests,
  hasOpenBar,
  insertIjazah,
  markApproved,
  markRejected,
};

/** What the review's service is built over, bound once by `main.ts` through the admin module. */
export interface IjazahDecisionServiceDependencies {
  readonly storage: Pick<StoragePort, 'temporaryLink' | 'remove'>;
  readonly settings: SettingsReader;
  /** The kernel's idempotency, keyed on the administrator kind's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  /** `render-certificate`, enqueued after the approval's commit (contracts/jobs.md). */
  readonly renders: RenderQueue;
  readonly log: IjazahDecisionLog;
}

/** The review's service (T007): `ijazahRequests.list`, `.approve`, `.reject` and `get`'s half. */
export function createIjazahDecisionService({
  storage,
  settings,
  idempotency,
  renders,
  log,
}: IjazahDecisionServiceDependencies): IjazahDecisionService {
  return new IjazahDecisionService({
    store: ijazahDecisionStore,
    storage,
    settings,
    idempotency,
    renders,
    mint: {
      certificateNumber: generateCertificateNumber,
      verificationToken: generateVerificationToken,
      hashToken: hashLookupToken,
    },
    drawId: (tx) => drawRowId(tx),
    clock: clockTimestamp,
    log,
  });
}
export type { IjazahDecisionService, RenderQueue, RequestDetail };

/** 005:T007: the `ijazahRequests` namespace of the administrator surface, mounted by `admin.router.ts`. */
export { ijazahRequestsAdminRouter } from './ijazah-requests-admin.router.js';

// 005:T010 (B46, lane E; FR-609, FR-610; R-412; the note under T010, Q12 (a)): an administrator's
// ijazahs, their revocation and the bar, `ijazahs.*` on the administrator surface. Its store reads
// and locks this module's `ijazahs` and `ijazah_bars`, the parties through identity's entry and the
// subjects through catalog's; the admin module composes it, `main.ts` binding it once.
export const ijazahsStore: IjazahsStore = {
  ijazahOf: ijazahRecordOf,
  page: ijazahPage,
  partiesOf: sessionPartiesOf,
  subjectsOf: subjectSummariesOf,
  lockAccounts,
  lockIjazahs,
  markRevoked,
  openBarOf,
  insertBar,
  liftBar,
};

/** What the ijazahs' service is built over, bound once by `main.ts` through the admin module. */
export interface IjazahsServiceDependencies {
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly settings: SettingsReader;
  /** The kernel's idempotency, keyed on the administrator kind's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly log: IjazahsLog;
}

/** The ijazahs' service (T010): `ijazahs.list`, `.get`, `.revoke`, `.bar`, `.liftBar`. */
export function createIjazahsService({
  storage,
  settings,
  idempotency,
  log,
}: IjazahsServiceDependencies): IjazahsService {
  return new IjazahsService({
    store: ijazahsStore,
    storage,
    settings,
    idempotency,
    drawId: (tx) => drawRowId(tx),
    clock: clockTimestamp,
    log,
  });
}
export type { IjazahsService };

/** 005:T010: the `ijazahs` namespace of the administrator surface, mounted by `admin.router.ts`. */
export { ijazahsAdminRouter } from './ijazahs-admin.router.js';
