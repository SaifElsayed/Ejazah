// PUBLIC ENTRY of the payments module (ADR 0007 D4). Other modules import this file and nothing below it (R-API-3).
// Owns payments and payment_events; hosts the raw-body webhook endpoint outside tRPC. The jobs
// confirm-enrollment and expire-pending-payments (`apps/api/src/jobs/`) read and move its orders through this
// entry, and the confirm job confirms the enrollment through booking's entry; payments never writes enrollments.
//
// Phase 1 (T077): the webhook route alone, which records a signed payout-recipient event and hands
// its verdict to the identity module's entries (payments imports identity, never the reverse; R-121).
// Phase 2 (T038): the route's order branch, which records an order event, moves the order, appends a
// failed order's outcome through booking's entry, and enqueues `confirm-enrollment` on a paid one.
// Phase 2 (T036): the student's `checkout` procedures, the gateway's orders created outside any
// transaction and recorded through booking's holds and enrollments (R-208).
import type {
  CheckoutHandover,
  CheckoutHoldInput,
  CheckoutHoldOutput,
  CheckoutContinueInput,
  CheckoutCurrentOutput,
  CheckoutPayInput,
  CheckoutPayOutput,
  CheckoutRetryInput,
  CheckoutStatusInput,
  CheckoutStatusOutput,
  ProgrammeCheckoutOutput,
  ProgrammePayInput,
  TeacherDuesGetOutput,
} from '@ijazah/contracts';
// 003:T110: the case's amount, the monitor's third read.
import type { PaymentsCaseAmountOutput } from '@ijazah/contracts/admin';

import type { ColumnCipher, EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
// 003:T105: the teacher's read runs on a transaction of its own.
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { PaymentPort } from '../../platform/ports/payment/payment.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import {
  type PaymentOutcomeNotices,
  type ProgrammeLog,
  recordOrderFailed,
} from '../booking/index.js';
import {
  lockPayoutHolder,
  markPayoutRejected,
  markPayoutVerified,
  payoutRefHash,
} from '../identity/index.js';
import type { PaymentGateway } from './checkout.repository.js';
import { type CheckoutStudent, CheckoutService, checkoutStepsOver } from './checkout.service.js';
import { type ConfirmationQueue, OrderEventsService } from './order-events.service.js';
import { caseAmount } from './case-amount.service.js';
import { checkoutAddresses } from './payments.repository.js';
import { PaymentsMonitorService } from './payments-monitor.service.js';
// 003:T105: the payouts' reads and mark.
import { createPayouts, type Payouts, payoutsStoreOver } from './payouts.service.js';
import { RecipientEventsService } from './recipient-events.service.js';
import { PAYMENT_WEBHOOK_PATH, paymentWebhookRoute } from './webhook.controller.js';

export { PAYMENT_WEBHOOK_PATH };
export type { ConfirmationQueue };

/**
 * `POST /webhooks/payment` (T077, T038), over the payment port, the identity module's two entries,
 * booking's `recordOrderFailed`, and the queue `confirm-enrollment` is enqueued on. 005:T016:
 * `notices`, the payment pushes' port (`NotificationWriter`, bound by `main.ts`), through which a
 * failed order's outcome records its `payment_failed` push.
 */
export function createPaymentWebhookRoute({
  database,
  payment,
  log,
  maxBodyBytes,
  confirmations,
  notices,
  report,
}: {
  readonly database: Database;
  readonly payment: Pick<PaymentPort, 'verifyAndParseEvent'>;
  readonly log: Logger;
  /** `MAX_REQUEST_BODY_BYTES`. */
  readonly maxBodyBytes: number;
  /** Enqueues `confirm-enrollment({ paymentId })` under the job id `paymentId` (R-214). */
  readonly confirmations: ConfirmationQueue;
  /** 005:T016: the payment pushes' port. */
  readonly notices: PaymentOutcomeNotices;
  /** The process's error reporting by default (T111); a recorder in the specs. */
  readonly report?: (error: Error) => void;
}): NodeHandler {
  const reporting = report === undefined ? {} : { report };
  return paymentWebhookRoute({
    verify: (rawBody, headers, query) => payment.verifyAndParseEvent(rawBody, headers, query),
    events: {
      recipients: new RecipientEventsService({
        database,
        identity: { markPayoutVerified, markPayoutRejected, lockPayoutHolder, payoutRefHash },
        log,
        ...reporting,
      }),
      orders: new OrderEventsService({
        database,
        booking: {
          recordOrderFailed: (tx, enrollmentId, paymentId, occurredAt) =>
            recordOrderFailed(tx, enrollmentId, paymentId, occurredAt, notices),
        },
        confirmations,
        log,
        ...reporting,
      }),
    },
    log,
    maxBodyBytes,
  });
}

/** The payments module's `_encrypted` column, for the `reencrypt-columns` job (T004, 002:T134, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'payment'>,
): readonly EncryptedColumn[] {
  return [checkoutAddresses(database)];
}

/**
 * Each enrollment's order standing, payments' answer to booking's release of a hold (T033, FR-363):
 * the `orders` a caller of booking's hold functions hands in, on the caller's transaction, after the
 * enrollments' locks (T005).
 */
export { orderStandingsOf } from './order-standing.repository.js';

/**
 * What the `confirm-enrollment` job reads of its paid order (T039, R-215): the order's enrollment,
 * with no lock, and, under the locks the job takes through booking's `lockForConfirmation` (whose
 * `orders` is `orderStandingsOf` above), the order's status and when its paid event was recorded.
 */
export { orderEnrollmentOf, type PaidOrder, paidOrderOf } from './confirmation-order.repository.js';
/**
 * 006:T005 (R-502, FR-701): the order's kind, its instalment's month and its per-order marker, read
 * by the confirm job under the same locks as the order's status.
 */
export { type OrderTerms, orderTermsOf } from './payments.repository.js';
/**
 * 006:T006 (R-502, FR-718; V-3): the months and the rest the confirm job already processed, and its
 * per-order marker `payments.confirmed_at`, written once, under the orders' locks.
 */
export {
  markOrderConfirmed,
  type ProcessedProgrammeOrder,
  processedProgrammeOrdersOf,
} from './payments.repository.js';

/**
 * What `expire-pending-payments` reads and writes of the orders (T040, FR-364; PR #109's review, M2
 * and round 2 N1), on the caller's transaction: a page of the `created` orders past their expiry,
 * their move to `expired` under the orders' locks, and a page of the `paid` orders whose paid event
 * was recorded before an instant, each with its enrollment, for the hand-off to `confirm-enrollment`
 * through the `ConfirmationQueue` above.
 */
export {
  expiredOrderIds,
  markOrdersExpired,
  type PaidOrderRef,
  paidOrdersRecordedBefore,
} from './order-expiry.repository.js';

/**
 * T073 of specs/004-sessions (FR-507; the note under T073, Q4 (a), Q6 (a), N3): payments' answer to
 * the restore's `EnrollmentPayments` port (sessions' `enrollment-payments.port.ts`), whether any order
 * of an enrollment is `refunded` or, since 003:T102 (Q-3 (a)), has any refund recorded
 * (`refunded_piasters > 0`), read with no lock on the restore's transaction, which holds the
 * enrollment's lock that every order move takes first. `main.ts` hands it to the admin module's
 * `createAdminServices` (`enrollmentPayments`), so sessions reads no payment table (R-301).
 */
export { refundedOf } from './enrollment-refund.repository.js';

/**
 * The `checkout` procedures' services (T036, R-208), bound once by `main.ts` and carried by the
 * request context; `checkoutRouter` is mounted under `checkout` by `app.router.ts`.
 */
export interface CheckoutServices {
  hold(student: CheckoutStudent, input: CheckoutHoldInput): Promise<CheckoutHoldOutput>;
  pay(student: CheckoutStudent, input: CheckoutPayInput): Promise<CheckoutPayOutput>;
  retry(student: CheckoutStudent, input: CheckoutRetryInput): Promise<CheckoutHandover>;
  current(student: CheckoutStudent): Promise<CheckoutCurrentOutput>;
  continue(student: CheckoutStudent, input: CheckoutContinueInput): Promise<CheckoutHandover>;
  status(student: CheckoutStudent, input: CheckoutStatusInput): Promise<CheckoutStatusOutput>;
  /**
   * 006:T009 (FR-710 to FR-713, R-509): `programme.pay`, the first payment of a programme's rest,
   * mounted by booking's `programmesRouter`; `log` takes its refusals' lines.
   */
  programmePay(
    student: CheckoutStudent,
    input: ProgrammePayInput,
    log: ProgrammeLog,
  ): Promise<ProgrammeCheckoutOutput>;
}

export { checkoutRouter } from './checkout.router.js';
// 003:T104 (Q-A3 (a)): the teacher's share setting, which `platform.publicConfig` answers too.
export { TEACHER_SHARE_SETTING } from './checkout.service.js';
export type { CheckoutStudent };

/**
 * The checkout over the process's client, the kernel's idempotency, the payment port and the column
 * cipher (T036): the gateway's orders recorded with their address encrypted (R-DB-8). 005:T016:
 * `notices`, the payment pushes' port, for the placement's releases (a cancelled order pushes nothing).
 */
export function createCheckoutServices({
  database,
  settings,
  idempotency,
  payment,
  cipher,
  gateway,
  notices,
  now,
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'completed'>;
  readonly payment: Pick<PaymentPort, 'createCheckout' | 'cancelCheckout'>;
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  readonly gateway: PaymentGateway;
  /** 005:T016: the payment pushes' port. */
  readonly notices: PaymentOutcomeNotices;
  readonly now?: () => Date;
}): CheckoutServices {
  const service = new CheckoutService({
    settings,
    idempotency,
    payment,
    cipher,
    gateway,
    steps: checkoutStepsOver(database, cipher, notices, now),
    ...(now === undefined ? {} : { now }),
  });
  return {
    hold: (student, input) => service.hold(student, input),
    pay: (student, input) => service.pay(student, input),
    retry: (student, input) => service.retry(student, input),
    current: (student) => service.current(student),
    continue: (student, input) => service.continue(student, input),
    status: (student, input) => service.status(student, input),
    programmePay: (student, input, log) => service.programmePay(student, input, log),
  };
}

/**
 * The admin's payments monitor (T052, FR-400 to FR-402, R-220): `paymentsAdminRouter` is mounted
 * under `payments` by `admin.router.ts`, and its two reads are composed into the admin module's
 * services, which `main.ts` binds to the administrator surface. Nothing in it writes (FR-401).
 */
export { paymentsAdminRouter } from './payments-admin.router.js';
export { type PaymentsMonitorStore, paymentsMonitorStore } from './payments-monitor.service.js';

/**
 * The monitor over the module's queries and the owners' entries, its page size from settings; and
 * 003:T110's third read, `caseAmount` (ADR 0025 D4, SRS DEC-85, DEC-86): what a compensation case
 * that closes an enrollment shows, so `admin/index.ts`'s composition carries it unchanged.
 */
export function createPaymentsMonitorService(dependencies: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): Pick<PaymentsMonitorService, 'list' | 'get'> & {
  caseAmount(tx: Transaction, caseId: string): Promise<PaymentsCaseAmountOutput>;
} {
  const monitor = new PaymentsMonitorService(dependencies);
  return {
    list: (tx, query) => monitor.list(tx, query),
    get: (tx, paymentId) => monitor.get(tx, paymentId),
    caseAmount: (tx, caseId) => caseAmount(tx, caseId),
  };
}

// ---------------------------------------------------------------------------------------------
// 003:T105 (ADR 0025 D2, SRS DEC-81, DEC-89; the notes under T105): the releases of a teacher's
// share at milestones. `createShareReleaseSweep`, built and scheduled by
// `jobs/release-teacher-shares.ts`, writes each release once when it falls due; `payoutsAdminRouter`
// («تحويلات المعلمين», mounted under `payouts` by `admin.router.ts`) lists, shows and marks them, and
// `teacherDuesRouter` («مستحقاتي», mounted under `teacher.dues` by `app.router.ts`) answers the
// teacher his own. The platform's code makes no release call (N1).
export { payoutsAdminRouter } from './payouts-admin.router.js';
export { teacherDuesRouter } from './teacher-dues.router.js';
export {
  createShareReleaseSweep,
  type ReleaseReads,
  type ShareReleaseRun,
  type ShareReleaseSweep,
  type ShareReleaseSweepDependencies,
} from './share-release.service.js';
export { IJAZAH_HALF_RELEASE_SETTING } from './checkout.service.js';
/**
 * The written releases of some enrollments, each with `markedAt` once an administrator marked it
 * executed in the gateway's dashboard; with no lock, on the caller's transaction. T110's case amount
 * reads an ijazah dropout's «released» part from the marked ones (the note under T110).
 */
export { type ReleaseRow, releasesOf } from './share-release.repository.js';

/** The administrator's four procedures on the kind's transaction (`AdminSurfaceServices.payouts`). */
export type AdminPayouts = Pick<Payouts, 'list' | 'get' | 'mark' | 'unmark'>;

/** The teacher's read, on a transaction of its own (`AppServices.teacherDues`). */
export interface TeacherDues {
  get(teacherUserId: string): Promise<TeacherDuesGetOutput>;
}

/** Both surfaces' payouts over the process's client, settings, idempotency, cipher and log. */
export function createPayoutServices({
  database,
  settings,
  idempotency,
  cipher,
  log,
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly log: Pick<Logger, 'info'>;
}): { readonly admin: AdminPayouts; readonly teacher: TeacherDues } {
  const payouts = createPayouts({ settings, idempotency, store: payoutsStoreOver(cipher), log });
  const transactions = transactionsOver(database);
  return {
    admin: {
      list: (tx, adminId, input) => payouts.list(tx, adminId, input),
      get: (tx, adminId, teacherUserId) => payouts.get(tx, adminId, teacherUserId),
      mark: (tx, adminId, input) => payouts.mark(tx, adminId, input),
      // The undo of a mark made in error (the owner, 2026-11-18).
      unmark: (tx, adminId, input) => payouts.unmark(tx, adminId, input),
    },
    teacher: {
      get: (teacherUserId) => transactions.run((tx) => payouts.teacherDues(tx, teacherUserId)),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 003:T110 (ADR 0025 D4): the orders a compensation case's amount is computed from, the enrollment's
// paid orders with a share, with no lock; `payments.caseAmount` reads it on the call's transaction
// (`createPaymentsMonitorService` above), and the database spec reads it here.
export { caseOrdersOf } from './case-amount.repository.js';

// 005:T016 (the follow-up under T016 on the push's key share, fixed in B48): the checkout's steps over
// the process's client, which `createCheckoutServices` composes; exported so the gateway-cancelled
// order's transaction (`recordCancelled`) is reached alone by
// `tests/db-integrity/payment-notices-race.spec.ts` (R-API-3).
export { checkoutStepsOver } from './checkout.service.js';

// ---------------------------------------------------------------------------------------------
// 006:T007 (FR-705; R-506, R-507; analyze K-5): an offer's amounts from `packages/money`, which
// `main.ts` hands to booking's programme services (booking imports nothing of payments, R-208).
export { type ProgrammeOfferAmounts, programmeOfferAmountsOf } from './programme-amounts.js';

// ---------------------------------------------------------------------------------------------
// 006:T008 (FR-706b, FR-716; SRS DEC-101; R-510; B-P2's conflict check, Q-2 (a)): «unverified in
// live mode», the one entry T008's `pay_blocked` window, T016 and T018 read, over the payment mode the
// composition root hands in; and `deleteProgrammeCard`, which booking's close hook calls on every
// close, a stub until T013 (booking imports nothing of payments, R-208: the root hands both in).
export { createProgrammePayee, type PaymentMode, type ProgrammePayee } from './programme-payee.js';
export { deleteProgrammeCard } from './programme-cards.js';

// 006:T009 (FR-BOOK-12, R-509): the orders a first payment's check and a new hold read, exported so
// `tests/db-integrity/programme-months.spec.ts`' races reach them through the entry (R-API-3), as
// `checkoutStepsOver` is above.
export {
  checkoutOrdersAmong,
  heldOrdersOf,
  payableProgrammeOrderAmong,
} from './checkout.repository.js';
