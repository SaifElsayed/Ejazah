// B15 (T075): the `payment_events` rows the recipient-event specs read back, and nothing a request
// ever runs. Only a payments repository may reach the payments tables (R-API-6), so the specs reach
// them through this one, as identity's `payout-rows.repository.ts` does for its own.
import type { Database } from '../../../platform/db/prisma.repository.js';

/** One recorded event, as the specs compare it. */
export interface EventRow {
  readonly paymentId: string | null;
  readonly providerEventId: string;
  readonly eventType: string;
  readonly signatureVerifiedAt: Date;
  readonly payloadHash: string;
  readonly receivedAt: Date;
}

export class EventRows {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** The rows stored under a provider's event id: one, or none. */
  of(providerEventId: string): Promise<EventRow[]> {
    return this.#database.paymentEvent.findMany({
      where: { providerEventId },
      select: {
        paymentId: true,
        providerEventId: true,
        eventType: true,
        signatureVerifiedAt: true,
        payloadHash: true,
        receivedAt: true,
      },
    });
  }
}
