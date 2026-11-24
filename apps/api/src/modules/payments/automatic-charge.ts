// 006:T014 of specs/006-programme (FR-714, FR-716, FR-717; R-509; SRS DEC-110, DEC-113; PR #153
// r1 Major 3, r3 Major 1, r1 Minor 1; Q-1 (a), Q-2 (a) amended, Q-10 (a) adjusted): the automatic
// charge of a programme's saved card, payments' entry the sweep (T015) calls. The sweep decides when;
// this file records the order, charges it, and asks the gateway about it.
//
// ORDER BEFORE CALL (`record`, on the sweep's transaction, the programme's and the enrollment's rows
// held by the caller). The month's order is written `created`, `automatic`, its attempt, with no
// gateway id and `expires_at` = the database's clock + `slot_hold_ttl_minutes` (10); its gross is the
// month's sessions at the offer's per-session price, and its rates are the assessment order's
// (R-511), all `packages/money`'s arithmetic. With no saved card nothing is written (`no_card`). In
// live mode with the teacher's payout account unverified (no payee), the order is written `failed`
// with a `hard` decline and no gateway id instead (ERD §15 rule 72): no gateway call, no expiry, no
// retry, and no `payment_failed` push (the push is the webhook's, through booking's
// `recordOrderFailed`, which this path never reaches). The card's token is decrypted here and kept
// only inside the returned `charge`, never in a field, a log, a job payload or an answer (SC-707).
//
// THE CALL (`charge`, after the caller's commit, once). No transaction is open while the gateway is
// called. The port's first step creates the gateway's order; its id is written on the order in a
// short transaction of its own (`lockOrder`, then the conditional write of `recordGatewayOrderId`),
// and only when that write took is the token payment sent, once: a second call, here or in another
// process, finds the id written and sends nothing. The first step with no answer charged nothing: the
// order is `expired` at once (a soft decline, no inquiry). A refusal before the gateway (`no_payee`,
// `charge_off`: the Moto integration or the API key unset) is recorded `failed`/`hard` with no
// gateway id. A crash between the commit and the call leaves the order `created` with no gateway id:
// no payment can have been sent (the payment waits for the id's write), so the inquiry expires it.
//
// THE INQUIRY (`inquire`, SRS DEC-110, DEC-113 (1)). Before its expiry an order is not asked about
// (`pending`). Past it, an order with no gateway id is expired (no payment was sent). Otherwise the
// gateway is asked by the order's id, with no lock held, and its authenticated answer is recorded
// through the webhook's own order branch (`OrderEventsService.record`: the order's locks, the
// `payment_events` row under the provider event id the signed callback carries, so whichever comes
// second is a replay; a paid answer enqueues the confirm step, a failed one appends `order_failed`
// and its push, and the decline kind is written). «No transaction» expires the order (a soft
// decline). «No answer» changes nothing (no retry follows; the sweep asks again, and its item comes
// after `programme_charge_inquiry_tries`, T015). A failed order with no kind yet (its signed callback
// carries none) is asked for its kind; every other settled order answers what it holds, unasked.
//
// Every outcome writes one info line of ids and a reason, never an amount, a token or a name.
import {
  type Piasters,
  perSession,
  programmeOfferAmounts,
  SESSIONS_PER_PROGRAMME_MONTH,
  teacherShare,
} from '@ijazah/money';
import { addMinutes } from '@ijazah/time';
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import type { Logger } from '../../platform/logging/logger.js';
import {
  ChargeRefusedError,
  type CheckoutPayee,
  type PaymentPort,
} from '../../platform/ports/payment/payment.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { readHoldTerms } from '../booking/index.js';
import { payoutRecipientOf } from '../identity/index.js';
import { assessmentOrderOf } from './checkout.repository.js';
import { ORDER_CURRENCY } from './checkout.service.js';
import type { OrderEventsService } from './order-events.service.js';
import {
  automaticOrderOf,
  closeUnsentAutomaticOrder,
  expireAutomaticOrder,
  insertAutomaticOrder,
  lockOrder,
  programmeCardTokenOf,
  recordGatewayOrderId,
} from './payments.repository.js';
import type { PaymentMode } from './programme-payee.js';
import { PROGRAMME_CARD_TOKEN_COLUMN } from './programme-cards.repository.js';

/** What the sweep hands in for a month's automatic charge. */
export interface AutomaticChargeRequest {
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  /** The month charged, 1 and up. */
  readonly instalmentMonth: number;
  /** 0 for the month's first charge, 1 to 4 for its retries (ERD §15 rule 71). */
  readonly attempt: number;
  /** The offer's frozen total and session count, as booking holds them. */
  readonly offerTotal_piasters: Piasters;
  readonly offerSessionCount: number;
}

/** What `charge` did (this file's head, THE CALL). */
export type ChargeResult = 'sent' | 'not_sent' | 'soft_declined' | 'refused';

/** What `record` wrote. `charge` is called once, after the caller's commit. */
export type RecordedCharge =
  | { readonly outcome: 'no_card' }
  | { readonly outcome: 'refused'; readonly paymentId: string }
  | {
      readonly outcome: 'recorded';
      readonly paymentId: string;
      readonly charge: () => Promise<ChargeResult>;
    };

/** What the inquiry found (this file's head, THE INQUIRY). */
export type InquiryOutcome =
  'pending' | 'paid' | 'declined_soft' | 'declined_hard' | 'none' | 'no_answer';

export interface AutomaticCharges {
  record(tx: Transaction, request: AutomaticChargeRequest): Promise<RecordedCharge>;
  inquire(paymentId: string): Promise<InquiryOutcome>;
}

export interface AutomaticChargeDependencies {
  readonly database: Pick<Database, '$transaction' | 'payment'>;
  readonly payment: Pick<PaymentPort, 'chargeSavedCard' | 'inquireOrder'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly gateway: 'fake' | 'paymob';
  readonly paymentMode: PaymentMode;
  readonly settings: SettingsReader;
  /** The webhook's order branch, which records the inquiry's answers as it records a callback. */
  readonly orderEvents: Pick<OrderEventsService, 'record'>;
  readonly log: Pick<Logger, 'info'>;
  readonly now?: () => Date;
}

const LOG_RECORDED = 'An automatic charge was recorded';
const LOG_CHARGED = 'An automatic charge was sent to the gateway';
const LOG_ASKED = 'The gateway was asked about an automatic charge';

export function createAutomaticCharges(
  dependencies: AutomaticChargeDependencies,
): AutomaticCharges {
  const { database, payment, log } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  const inShort = <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
    database.$transaction((tx) => work(tx as Transaction));

  /** The order no payment was sent for, closed `to`, under its locks. */
  const closeUnsent = (enrollmentId: string, paymentId: string, to: 'expired' | 'failed') =>
    inShort(async (tx) => {
      await lockOrder(tx, { paymentId, enrollmentId });
      return closeUnsentAutomaticOrder(tx, paymentId, to);
    });

  async function chargeOnce(
    order: {
      readonly paymentId: string;
      readonly enrollmentId: string;
      readonly gross_piasters: Piasters;
      readonly expiresAt: Date;
      readonly payee: CheckoutPayee | undefined;
    },
    token: string,
  ): Promise<ChargeResult> {
    const { paymentId, enrollmentId } = order;
    let result: ChargeResult;
    try {
      const charged = await payment.chargeSavedCard(
        paymentId,
        order.gross_piasters,
        ORDER_CURRENCY,
        order.expiresAt,
        token,
        order.payee,
        (gatewayOrderId) =>
          inShort(async (tx) => {
            await lockOrder(tx, { paymentId, enrollmentId });
            return recordGatewayOrderId(tx, paymentId, gatewayOrderId);
          }),
      );
      if (charged.step === 'order_unanswered') {
        await closeUnsent(enrollmentId, paymentId, 'expired');
        result = 'soft_declined';
      } else {
        result = charged.step === 'payment_sent' ? 'sent' : 'not_sent';
      }
    } catch (error: unknown) {
      if (!(error instanceof ChargeRefusedError)) throw error;
      await closeUnsent(enrollmentId, paymentId, 'failed');
      result = 'refused';
    }
    log.info({ enrollmentId, paymentId, reason: result }, LOG_CHARGED);
    return result;
  }

  return {
    async record(tx, request) {
      const { enrollmentId, instalmentMonth, attempt } = request;
      const tokenEncrypted = await programmeCardTokenOf(tx, enrollmentId);
      if (tokenEncrypted === null) {
        log.info({ enrollmentId, instalmentMonth, attempt, reason: 'no_card' }, LOG_RECORDED);
        return { outcome: 'no_card' };
      }
      const [assessment, at, recipientRef] = await Promise.all([
        assessmentOrderOf(tx, enrollmentId),
        clockTimestamp(tx),
        payoutRecipientOf(tx, dependencies.cipher, request.teacherUserId),
      ]);
      const { ttlMinutes } = await readHoldTerms(dependencies.settings, now());
      const gross_piasters = monthGrossOf(request);
      const teacherShare_piasters = teacherShare(
        gross_piasters,
        assessment.teacherShareRatePercent,
      );
      const refused = dependencies.paymentMode === 'live' && recipientRef === null;
      const expiresAt = new Date(addMinutes(at, ttlMinutes));
      const paymentId = await insertAutomaticOrder(tx, {
        enrollmentId,
        gateway: dependencies.gateway,
        gross_piasters,
        currency: ORDER_CURRENCY,
        expiresAt,
        teacherShareRatePercent: assessment.teacherShareRatePercent,
        teacherShare_piasters,
        halfReleaseRatePercent: assessment.halfReleaseRatePercent,
        instalmentMonth,
        attempt,
        status: refused ? 'failed' : 'created',
      });
      log.info(
        {
          enrollmentId,
          paymentId,
          instalmentMonth,
          attempt,
          reason: refused ? 'no_payee' : 'recorded',
        },
        LOG_RECORDED,
      );
      if (refused) return { outcome: 'refused', paymentId };
      const token = dependencies.cipher.decrypt(
        Buffer.from(tokenEncrypted),
        PROGRAMME_CARD_TOKEN_COLUMN,
        enrollmentId,
      );
      const payee =
        recipientRef === null ? undefined : { recipientRef, share_piasters: teacherShare_piasters };
      let called = false;
      return {
        outcome: 'recorded',
        paymentId,
        charge: () => {
          if (called) return Promise.resolve('not_sent');
          called = true;
          return chargeOnce({ paymentId, enrollmentId, gross_piasters, expiresAt, payee }, token);
        },
      };
    },

    async inquire(paymentId) {
      const outcome = await inquireOnce(paymentId);
      log.info({ paymentId, reason: outcome }, LOG_ASKED);
      return outcome;
    },
  };

  async function inquireOnce(paymentId: string): Promise<InquiryOutcome> {
    const order = await automaticOrderOf(database, paymentId);
    if (!order.automatic) throw new Error(`Payment ${paymentId} is not an automatic charge`);
    const settled = settledOutcomeOf(order);
    if (settled !== undefined) return settled;
    if (order.status === 'created' && now().getTime() < order.expiresAt.getTime()) return 'pending';
    const ref = { paymentId, enrollmentId: order.enrollmentId };
    if (order.gatewayOrderId === null) {
      // No id recorded: the token payment was never sent (THE CALL).
      await closeUnsent(order.enrollmentId, paymentId, 'expired');
      return 'none';
    }
    const inquiry = await payment.inquireOrder(order.gatewayOrderId);
    if (inquiry.answer === 'no_answer') return 'no_answer';
    if (inquiry.answer === 'none') {
      if (order.status !== 'created') return 'no_answer';
      await inShort(async (tx) => {
        await lockOrder(tx, ref);
        await expireAutomaticOrder(tx, paymentId);
      });
      return 'none';
    }
    const answeredAt = now();
    await dependencies.orderEvents.record(inquiry.event, {
      rawBody: inquiry.rawBody,
      signatureVerifiedAt: answeredAt,
      receivedAt: answeredAt,
    });
    if (inquiry.event.type === 'paid') return 'paid';
    return inquiry.event.declineKind === 'soft' ? 'declined_soft' : 'declined_hard';
  }
}

/** What a settled order answers without asking; undefined when the gateway must be asked. */
function settledOutcomeOf(order: {
  readonly status: string;
  readonly declineKind: 'soft' | 'hard' | null;
}): InquiryOutcome | undefined {
  switch (order.status) {
    case 'paid':
    case 'refunded':
      return 'paid';
    case 'expired':
      return 'none';
    case 'failed':
      if (order.declineKind === null) return undefined;
      return order.declineKind === 'soft' ? 'declined_soft' : 'declined_hard';
    default:
      return undefined;
  }
}

/** The month's gross: its sessions (4, or what is left in the last month) at the per-session price. */
function monthGrossOf(request: AutomaticChargeRequest): Piasters {
  const before = SESSIONS_PER_PROGRAMME_MONTH * (request.instalmentMonth - 1);
  const sessions = Math.min(SESSIONS_PER_PROGRAMME_MONTH, request.offerSessionCount - before);
  if (sessions < 1) {
    throw new RangeError(`Month ${String(request.instalmentMonth)} is past the offer's sessions`);
  }
  const sessionPrice_piasters = perSession(request.offerTotal_piasters, request.offerSessionCount);
  return programmeOfferAmounts(sessionPrice_piasters, sessions).total_piasters;
}
