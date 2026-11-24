// 006:T013 of specs/006-programme (R-510; FR-713, FR-719; SC-707; B-P3's conflict check, Q-4 (a)):
// payments' saved card of a programme, the rules over `programme-cards.repository.ts`.
//
// THE CARD'S WRITE. A signed `card_saved` event is recorded by the webhook's order branch
// (`order-events.service.ts`) under its unique provider event id, on a transaction that holds the
// order's enrollment, then the order (`lockOrder`). On that same transaction, after the event's row,
// the card is written only when both hold, read under those locks:
//   - the paying order carries the student's consent to save it (`payments.card_consent_at`, ERD
//     §15 rule 82; the gateway's own page may offer to save a card the student never agreed to
//     here, `paymob-docs.md` §1), copied into `consented_at`;
//   - the programme is not closed (R-510: the row is deleted at the close): booking's entry answers
//     the student's programmes not closed (R-API-6). Every close takes the enrollment's row before it
//     writes `closed` (kernel.md, 006:T008), so a close either committed before the event took the
//     enrollment (the event reads it closed) or waits for the event's commit and then deletes the
//     card it wrote.
// Otherwise the event stays recorded and no card is written. The token is encrypted by the column
// cipher under `programme_cards.token_encrypted`, the enrollment's id bound (R-DB-8), and reaches no
// log, no job payload and no answer (SC-707): each outcome logs one info line of ids and a reason.
// A later card saved on the programme replaces the row («change card»).
//
// THE DELETION (006:T008's entry, now real). Booking's close hook, a teacher's suspension and T016's
// «off» call `deleteProgrammeCard` on their own transaction, the programme's row already held; it
// deletes that enrollment's row and no other. The caller writes the line of ids and the reason
// (booking's `closeProgrammes`, `deleteSuspendedCards`).
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { GatewayEvent } from '../../platform/ports/payment/payment.port.js';
import { activeProgrammeEnrollmentsOf, orderEnrollmentPartiesAmong } from '../booking/index.js';
import { type OrderRef, PaymentsRepository } from './payments.repository.js';
import {
  deleteProgrammeCardRow,
  PROGRAMME_CARD_TOKEN_COLUMN,
  upsertProgrammeCard,
} from './programme-cards.repository.js';

/** A verified `card_saved` event: the gateway's word that it saved the order's card. */
export type SavedCard = Extract<GatewayEvent, { readonly type: 'card_saved' }>;

/** What the writer did with a saved card. */
export type CardOutcome = 'saved' | 'no_consent' | 'programme_closed';

/** Writes a recorded `card_saved` event's card, on the webhook's transaction. */
export interface ProgrammeCardWriter {
  save(tx: Transaction, order: OrderRef, card: SavedCard): Promise<CardOutcome>;
}

export interface ProgrammeCardWriterDependencies {
  readonly cipher: Pick<ColumnCipher, 'encrypt'>;
  readonly log: Pick<Logger, 'info'>;
}

/** The card's write (this file's head), over the column cipher and the webhook's log. */
export function createProgrammeCardWriter({
  cipher,
  log,
}: ProgrammeCardWriterDependencies): ProgrammeCardWriter {
  return {
    save: async (tx, order, card) => {
      const outcome = await writeCard(tx, order, card, cipher);
      log.info(
        {
          paymentId: order.paymentId,
          enrollmentId: order.enrollmentId,
          providerEventId: card.providerEventId,
          reason: outcome,
        },
        outcome === 'saved'
          ? 'A programme’s card was saved'
          : 'A saved card was recorded and no card was written',
      );
      return outcome;
    },
  };
}

async function writeCard(
  tx: Transaction,
  order: OrderRef,
  card: SavedCard,
  cipher: Pick<ColumnCipher, 'encrypt'>,
): Promise<CardOutcome> {
  const consentedAt = await new PaymentsRepository(tx).cardConsentOf(order.paymentId);
  if (consentedAt === null) return 'no_consent';
  if (!(await programmeOpen(tx, order.enrollmentId))) return 'programme_closed';
  await upsertProgrammeCard(tx, {
    enrollmentId: order.enrollmentId,
    tokenEncrypted: cipher.encrypt(card.token, PROGRAMME_CARD_TOKEN_COLUMN, order.enrollmentId),
    last4: card.last4,
    brand: card.brand,
    consentedAt,
  });
  return 'saved';
}

/** Whether the enrollment's programme is one of its student's not closed (booking's entry). */
async function programmeOpen(tx: Transaction, enrollmentId: string): Promise<boolean> {
  const party = (await orderEnrollmentPartiesAmong(tx, [enrollmentId])).get(enrollmentId);
  if (party === undefined) return false;
  return (await activeProgrammeEnrollmentsOf(tx, party.studentUserId)).includes(enrollmentId);
}

/** Where no cipher is bound: a saved card cannot be stored encrypted, so it fails loudly. */
export const unboundProgrammeCards: ProgrammeCardWriter = {
  save: () => Promise.reject(new Error('No programme card writer is bound to the webhook.')),
};

/**
 * Deletes the programme's saved card, if any, on the caller's transaction (this file's head); the
 * caller holds the programme's row and writes the line of ids and the reason.
 */
export const deleteProgrammeCard: (tx: Transaction, enrollmentId: string) => Promise<void> = async (
  tx,
  enrollmentId,
) => {
  await deleteProgrammeCardRow(tx, enrollmentId);
};
