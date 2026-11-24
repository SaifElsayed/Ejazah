// 006:T013 of specs/006-programme (R-510; FR-713, FR-719; ERD §7 `programme_cards`): the queries of
// a programme's saved card, each on the transaction it is handed; `programme-cards.ts` holds the
// rules. One row per programme, keyed by its enrollment. The token arrives here encrypted only
// (`ColumnCipher`, R-DB-8) and no query returns it but the `reencrypt-columns` job's page, which
// hands the stored bytes back to the cipher.
import type { EncryptedColumn, EncryptedValue } from '../../platform/crypto/encryption.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'programmeCard'>;

/** The column the token is encrypted under, the row id (the enrollment's) bound (R-DB-8). */
export const PROGRAMME_CARD_TOKEN_COLUMN = 'programme_cards.token_encrypted';

/** A saved card as it is written: the token already encrypted. */
export interface ProgrammeCardRow {
  readonly enrollmentId: string;
  readonly tokenEncrypted: Uint8Array;
  readonly last4: string;
  readonly brand: string;
  readonly consentedAt: Date;
}

/**
 * Writes the programme's card, or replaces the one it has («change card», R-510: a later saved card
 * replaces the row). The caller holds the enrollment's row.
 */
export async function upsertProgrammeCard(tx: Client, card: ProgrammeCardRow): Promise<void> {
  const values = {
    tokenEncrypted: Uint8Array.from(card.tokenEncrypted),
    last4: card.last4,
    brand: card.brand,
    consentedAt: card.consentedAt,
  };
  await tx.programmeCard.upsert({
    where: { enrollmentId: card.enrollmentId },
    create: { enrollmentId: card.enrollmentId, ...values },
    update: values,
    select: { enrollmentId: true },
  });
}

/** Deletes the programme's card; whether a row was there. The caller holds the programme's row. */
export async function deleteProgrammeCardRow(tx: Client, enrollmentId: string): Promise<boolean> {
  const { count } = await tx.programmeCard.deleteMany({ where: { enrollmentId } });
  return count === 1;
}

/**
 * `programme_cards.token_encrypted` for the `reencrypt-columns` job (002:T134, R-API-6), as
 * `checkoutAddresses` is: every row holds a value, paged in id order, and a value is written only
 * where the row still holds the one read, so a card replaced or deleted meanwhile stays as it is.
 */
export function programmeCardTokens(database: Client): EncryptedColumn {
  const cards = database.programmeCard;
  return {
    column: PROGRAMME_CARD_TOKEN_COLUMN,
    page: async (after, limit) => {
      const rows = await cards.findMany({
        where: after === undefined ? {} : { enrollmentId: { gt: after } },
        orderBy: { enrollmentId: 'asc' },
        take: limit,
        select: { enrollmentId: true, tokenEncrypted: true },
      });
      return rows.map(({ enrollmentId, tokenEncrypted }): EncryptedValue => ({
        id: enrollmentId,
        value: tokenEncrypted,
      }));
    },
    replace: async (enrollmentId, stored, next) => {
      const { count } = await cards.updateMany({
        where: { enrollmentId, tokenEncrypted: { equals: Uint8Array.from(stored) } },
        data: { tokenEncrypted: Uint8Array.from(next) },
      });
      return count === 1;
    },
  };
}

/** 006:T018 (app-surface.md `programme.get`): the student's saved card as it is shown. */
export interface ProgrammeCardShown {
  readonly last4: string;
  readonly brand: string;
}

/**
 * 006:T018 (R-510, SC-707): the programme's saved card's last four digits and brand, or null; the
 * token is never selected, so it never leaves the row. By the primary key, with no lock.
 */
export async function programmeCardOf(
  tx: Client,
  enrollmentId: string,
): Promise<ProgrammeCardShown | null> {
  const row = await tx.programmeCard.findUnique({
    where: { enrollmentId },
    select: { last4: true, brand: true },
  });
  return row === null ? null : { last4: row.last4, brand: row.brand };
}
