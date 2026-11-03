// T077, the payments half (FR-191, FR-PAYG-4, FR-PAYG-15; research R-114, R-121): what the payment
// webhook does with an event the port verified on its raw body (R-MONEY-9).
//
// A RECIPIENT EVENT (`recipient_verified`, `recipient_rejected`) is applied in ONE transaction, in
// this order: the event is recorded in `payment_events` under its unique `provider_event_id` first
// (R-MONEY-8), then the verdict is handed to the identity module's entry with the lookup hash of the
// reference the event carried. A provider event id already recorded is a replay: nothing else runs
// and the webhook acknowledges it. Should identity fail, the record is rolled back with it, so the
// gateway's retry finds the event new and applies it whole. The payments module calls identity and
// never the reverse (R-121), and writes no `teacher_profiles` column itself (README, "Never").
//
// A REFERENCE NO TEACHER HOLDS (identity answers false) is still recorded, is reported, and changes
// no row (R-114).
//
// AN ORDER EVENT (`paid`, `failed`, `expired`, `refunded`) is `order-events.service.ts`'s since
// T038, which replaced the branch here that answered it `unexpected_order_event` while no order
// existed (B15 check, the owner's decision 1); the webhook hands each event to its own service, both
// recording under `payment_events`' unique `provider_event_id`.
//
// Nothing of the raw body is logged or reported (R-SEC-2): the log line and the report name the
// provider's event id and the event's type, never the reference, its hash or the reason.
import { createHash } from 'node:crypto';

import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { GatewayEvent } from '../../platform/ports/payment/payment.port.js';
import { PaymentsRepository } from './payments.repository.js';

/** The identity module's two entries and the hash that routes an event to its teacher (R-114). */
export interface RecipientVerdicts {
  readonly payoutRefHash: (recipientRef: string) => string;
  /** False when no teacher holds the reference. */
  readonly markPayoutVerified: (tx: Transaction, refHash: string, at: Date) => Promise<boolean>;
  /** False when no teacher holds the reference. */
  readonly markPayoutRejected: (
    tx: Transaction,
    refHash: string,
    reason: string | undefined,
  ) => Promise<boolean>;
}

export interface RecipientEventsDependencies {
  readonly database: Pick<Database, '$transaction'>;
  readonly identity: RecipientVerdicts;
  readonly log: Pick<Logger, 'warn'>;
  /** The process's error reporting (T111); replaced by a recorder in the specs. */
  readonly report?: (error: Error) => void;
}

/** How the webhook received the event: its raw body, and when it arrived and was verified. */
export interface Receipt {
  readonly rawBody: Buffer;
  readonly receivedAt: Date;
  readonly signatureVerifiedAt: Date;
}

export type RecordOutcome = 'applied' | 'replayed' | 'unmatched';

/** A signed recipient event whose reference no teacher holds (R-114). */
export class UnmatchedRecipientEventError extends Error {
  constructor(providerEventId: string, eventType: string) {
    super(`No teacher holds the recipient of ${eventType} event ${providerEventId}.`);
    this.name = 'UnmatchedRecipientEventError';
  }
}

/** A verified event of a payout recipient. */
export type RecipientEvent = Extract<
  GatewayEvent,
  { type: 'recipient_verified' | 'recipient_rejected' }
>;

export class RecipientEventsService {
  readonly #database: Pick<Database, '$transaction'>;
  readonly #identity: RecipientVerdicts;
  readonly #log: Pick<Logger, 'warn'>;
  readonly #report: (error: Error) => void;

  constructor({ database, identity, log, report = reportError }: RecipientEventsDependencies) {
    this.#database = database;
    this.#identity = identity;
    this.#log = log;
    this.#report = report;
  }

  /** Records `event` and applies its verdict once; what happened, for the webhook to acknowledge. */
  async record(event: RecipientEvent, receipt: Receipt): Promise<RecordOutcome> {
    const outcome = await this.#database.$transaction((tx) => this.#apply(tx, event, receipt));
    if (outcome === 'unmatched') {
      this.#warn(event, 'No teacher holds the recipient of a signed event; it was recorded alone');
      this.#report(new UnmatchedRecipientEventError(event.providerEventId, event.type));
    }
    return outcome;
  }

  async #apply(tx: Transaction, event: RecipientEvent, receipt: Receipt): Promise<RecordOutcome> {
    const recorded = await new PaymentsRepository(tx).recordRecipientEvent({
      providerEventId: event.providerEventId,
      eventType: event.type,
      signatureVerifiedAt: receipt.signatureVerifiedAt,
      payloadHash: createHash('sha256').update(receipt.rawBody).digest('hex'),
      receivedAt: receipt.receivedAt,
    });
    if (!recorded) return 'replayed';
    const refHash = this.#identity.payoutRefHash(event.recipientRef);
    const matched =
      event.type === 'recipient_verified'
        ? await this.#identity.markPayoutVerified(tx, refHash, receipt.signatureVerifiedAt)
        : await this.#identity.markPayoutRejected(tx, refHash, event.reason);
    return matched ? 'applied' : 'unmatched';
  }

  #warn(event: RecipientEvent, message: string): void {
    this.#log.warn({ providerEventId: event.providerEventId, eventType: event.type }, message);
  }
}
