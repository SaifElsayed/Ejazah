// T077: the payments module's queries (ERD §7, ADR 0007). Phase 1 writes one: the record of a signed
// payout-recipient event in `payment_events`. Queries only, each on the transaction it is handed;
// `recipient-events.service.ts` holds the rules.
//
// The insert is `INSERT … ON CONFLICT DO NOTHING` (Prisma's `skipDuplicates`), so a replayed
// `provider_event_id` is refused by the unique NOT NULL column itself and leaves the transaction
// usable: the caller learns "replay" from a count of zero (FR-PAYG-4, R-MONEY-8). A delivery racing
// the same event waits on the unique index until the first transaction ends, then counts zero if it
// committed. The table is append-only (`20261007000500_append_only_tables`), so nothing here updates
// or deletes a row.
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'paymentEvent'>;

/** A signed recipient event as it is kept: never the body, only its hash (R-SEC-2). */
export interface RecipientEventRecord {
  readonly providerEventId: string;
  readonly eventType: 'recipient_verified' | 'recipient_rejected';
  readonly signatureVerifiedAt: Date;
  readonly payloadHash: string;
  readonly receivedAt: Date;
}

export class PaymentsRepository {
  readonly #tx: Client;

  constructor(tx: Client) {
    this.#tx = tx;
  }

  /**
   * Records a recipient event, with no payment (rule 20: `payment_id` is NULL exactly for a
   * recipient event). False when its provider event id is already recorded: a replay.
   */
  async recordRecipientEvent(event: RecipientEventRecord): Promise<boolean> {
    const { count } = await this.#tx.paymentEvent.createMany({
      data: [{ ...event, paymentId: null }],
      skipDuplicates: true,
    });
    return count === 1;
  }
}
