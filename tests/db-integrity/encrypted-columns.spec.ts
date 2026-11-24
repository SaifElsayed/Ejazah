// T155: the `_encrypted` columns as the `reencrypt-columns` job reaches them, through the
// repositories of the modules that own their tables (R-API-6), against Postgres as the application
// role (FR-031, R-DB-8, R-SEC-10).
//
// Six of the seven: identity's three (the third, `auth_identities.provider_refresh_token_encrypted`,
// since Phase 1's T013), verification's one and payments' two (`payments.checkout_url_encrypted`,
// Phase 2's T004, `002:T134`; `programme_cards.token_encrypted`, 006:T013). The seventh,
// `admin_users.mfa_secret_encrypted`, is
// not reached from here: R-API-4 lets only the three composition files import the admin module
// (T143), and this file is not one of them. Its repository, `modules/admin/admin-users.repository.ts`,
// issues the same two queries on its table.
//
// Each column holds a value written under the old key. Its page holds that row with that value, in
// id order and after the given row; a payout reference that is not set is not a row to rewrite. A
// value is replaced only where the row still holds the one read: a stale value is refused and the
// row is left as it is, which is what keeps a value the application wrote meanwhile. The sweep's
// own behaviour, over these same columns, is `apps/api/src/jobs/reencrypt-columns.spec.ts`.
//
// NOTHING IS LEFT BEHIND: every write runs inside one Prisma interactive transaction that always
// ends by throwing `ROLLBACK`, as in `soft-delete.spec.ts`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEncryptedColumns as identityColumns } from '../../apps/api/src/modules/identity/index.js';
import { createEncryptedColumns as paymentsColumns } from '../../apps/api/src/modules/payments/index.js';
import { createEncryptedColumns as verificationColumns } from '../../apps/api/src/modules/verification/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { connectAsApplication, type Db } from './harness';

const OLD = new ColumnCipher(Buffer.alloc(32, 7).toString('base64'));
const NEW = new ColumnCipher(Buffer.alloc(32, 9).toString('base64'));

let db: Db;
let database: Database;

beforeAll(async () => {
  // The harness proves DATABASE_URL is the application role, never the owner, before anything runs.
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

const ROLLBACK = new Error('rolled back on purpose: the probe leaves no row behind');

async function inClientRollback(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

function newUser(tx: Transaction): Promise<{ id: string }> {
  return tx.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender: 'female',
      dateOfBirth: '1990-01-01T00:00:00Z',
      displayName: 'Probe user',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: 'active',
    },
    select: { id: true },
  });
}

/**
 * One row per column, each holding a value written under the old key, by column. A value is bound
 * to its row (T172), so each row's id is drawn here and given to the insert.
 */
async function plant(tx: Transaction): Promise<Map<string, { id: string; value: Uint8Array }>> {
  const planted = new Map<string, { id: string; value: Uint8Array }>();
  const value = (column: string, id: string) => OLD.encrypt(`secret for ${column}`, column, id);

  const teacher = await newUser(tx);
  const profileId = randomUUID();
  const payout = value('teacher_profiles.payout_account_ref_encrypted', profileId);
  const profile = await tx.teacherProfile.create({
    data: {
      id: profileId,
      userId: teacher.id,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutAccountRefEncrypted: Uint8Array.from(payout),
    },
    select: { id: true },
  });
  planted.set('teacher_profiles.payout_account_ref_encrypted', { id: profile.id, value: payout });

  const deviceId = randomUUID();
  const token = value('device_push_tokens.token_encrypted', deviceId);
  const device = await tx.devicePushToken.create({
    data: {
      id: deviceId,
      userId: teacher.id,
      tokenEncrypted: Uint8Array.from(token),
      tokenHash: `probe-${randomUUID()}`,
      platform: 'android',
      lastSeenAt: new Date('2026-10-12T00:00:00Z'),
    },
    select: { id: true },
  });
  planted.set('device_push_tokens.token_encrypted', { id: device.id, value: token });

  const identityId = randomUUID();
  const refreshToken = value('auth_identities.provider_refresh_token_encrypted', identityId);
  const identity = await tx.authIdentity.create({
    data: {
      id: identityId,
      userId: teacher.id,
      provider: 'apple',
      providerSubject: `probe-${randomUUID()}`,
      providerRefreshTokenEncrypted: Uint8Array.from(refreshToken),
    },
    select: { id: true },
  });
  planted.set('auth_identities.provider_refresh_token_encrypted', {
    id: identity.id,
    value: refreshToken,
  });

  const documentId = randomUUID();
  const storageKey = value('verification_documents.storage_key_encrypted', documentId);
  const document = await tx.verificationDocument.create({
    data: {
      id: documentId,
      userId: teacher.id,
      documentType: 'national_id',
      storageKeyEncrypted: Uint8Array.from(storageKey),
    },
    select: { id: true },
  });
  planted.set('verification_documents.storage_key_encrypted', {
    id: document.id,
    value: storageKey,
  });

  const orderId = randomUUID();
  const checkoutUrl = value('payments.checkout_url_encrypted', orderId);
  const enrollmentId = await newOrder(tx, teacher.id, orderId, checkoutUrl);
  planted.set('payments.checkout_url_encrypted', { id: orderId, value: checkoutUrl });

  // 006:T013: the programme's saved card, keyed by its enrollment (R-510).
  const cardToken = value('programme_cards.token_encrypted', enrollmentId);
  await tx.programmeCard.create({
    data: {
      enrollmentId,
      tokenEncrypted: Uint8Array.from(cardToken),
      last4: '4242',
      brand: 'Visa',
      consentedAt: new Date('2026-11-24T09:00:00Z'),
    },
    select: { enrollmentId: true },
  });
  planted.set('programme_cards.token_encrypted', { id: enrollmentId, value: cardToken });
  return planted;
}

/**
 * A student's enrollment with the teacher, and one gateway order on it holding `checkoutUrl`, or
 * none once the order has left `created` (data-model §2.4). The order is written in SQL so that no
 * name here carries a gateway amount (R-MONEY-6): the amount column takes 0, as the harness's does.
 */
async function newOrder(
  tx: Transaction,
  teacherId: string,
  orderId: string,
  checkoutUrl: Uint8Array | null,
): Promise<string> {
  const student = await newUser(tx);
  const subject = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const offer = await tx.package.create({
    data: {
      teacherUserId: teacherId,
      subjectId: subject.id,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  const slot = await tx.availabilitySlot.create({
    data: {
      teacherUserId: teacherId,
      dayOfWeek: 0,
      startTimeLocal: '1970-01-01T09:00:00Z',
      durationMinutes: 60,
      timezone: 'Africa/Cairo',
      isActive: true,
    },
    select: { id: true },
  });
  const enrollment = await tx.enrollment.create({
    data: {
      studentUserId: student.id,
      teacherUserId: teacherId,
      packageId: offer.id,
      slotId: slot.id,
      snapshotPricePiasters: 100_000n,
      snapshotSessionCount: 4,
      snapshotDurationMinutes: 60,
      snapshotSubjectId: subject.id,
      snapshotSlotTimezone: 'Africa/Cairo',
      status: 'pending_payment',
      purchasedAt: '2026-10-04T07:00:00Z',
      quotedFirstSessionLocalDate: '2026-10-11T00:00:00Z',
    },
    select: { id: true },
  });
  const url = checkoutUrl === null ? null : Buffer.from(checkoutUrl);
  await tx.$executeRaw`
    INSERT INTO payments (id, enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                          status, expires_at, checkout_url_encrypted, updated_at)
    VALUES (${orderId}::uuid, ${enrollment.id}::uuid, 'fake', ${`probe-order-${orderId}`}, 0,
            'EGP', 'created', '2026-10-04T07:10:00Z', ${url}, now())`;
  return enrollment.id;
}

function columnsOver(tx: Transaction) {
  return [...identityColumns(tx), ...verificationColumns(tx), ...paymentsColumns(tx)];
}

type Column = ReturnType<typeof columnsOver>[number];
type Row = { id: string; value: Uint8Array };

const PAGE_SIZE = 2;

/** The uuid one below `id`: no row's id lies between the two. */
function idBelow(id: string): string {
  const hex = (BigInt(`0x${id.replaceAll('-', '')}`) - 1n).toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Up to `pages` pages of the column, as the sweep reads them, the first given the id just below
 * `from` and each later one the last row of the page before. Since no id lies between the two,
 * the row `from` is the first row read if the column pages it at all. Bounded (T080): the database
 * holds every row other specs committed, and reading them all outgrew the case's time.
 */
async function readPages(
  column: Column,
  from: string,
  pages: number,
): Promise<{ after: string; rows: readonly Row[] }[]> {
  const read: { after: string; rows: readonly Row[] }[] = [];
  let after = idBelow(from);
  while (read.length < pages) {
    const rows = await column.page(after, PAGE_SIZE);
    read.push({ after, rows });
    const last = rows.at(-1);
    if (last === undefined || rows.length < PAGE_SIZE) break;
    after = last.id;
  }
  return read;
}

/** The first row the column pages from `from` on: `from`'s own row if it is paged. */
async function firstFrom(column: Column, from: string): Promise<Row | undefined> {
  const [first] = await readPages(column, from, 1);
  return first?.rows[0];
}

describe('the encrypted columns, through their owning modules (T155)', () => {
  it('are the six columns of ERD §0 that identity, verification and payments own', async () => {
    await inClientRollback(async (tx) => {
      expect(columnsOver(tx).map(({ column }) => column)).toEqual([
        'teacher_profiles.payout_account_ref_encrypted',
        'device_push_tokens.token_encrypted',
        'auth_identities.provider_refresh_token_encrypted',
        'verification_documents.storage_key_encrypted',
        'payments.checkout_url_encrypted',
        // 006:T013 (R-510).
        'programme_cards.token_encrypted',
      ]);
    });
  });

  it('page every row holding a value, in id order, each page after the row given', async () => {
    await inClientRollback(async (tx) => {
      const planted = await plant(tx);
      for (const column of columnsOver(tx)) {
        const mine = planted.get(column.column);
        if (mine === undefined) throw new Error(`nothing planted in ${column.column}`);
        const pages = await readPages(column, mine.id, 3);
        for (const { after, rows } of pages) {
          const ids = rows.map(({ id }) => id);
          expect(ids, `${column.column}: in id order`).toEqual([...ids].sort());
          expect(
            ids.every((id) => id > after),
            `${column.column}: after the row given`,
          ).toBe(true);
        }
        const rows = pages.flatMap((page) => page.rows);
        expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length);
        expect(rows[0]?.id, `${column.column}: the planted row`).toBe(mine.id);
        expect(Buffer.from(rows[0]?.value ?? []).equals(Buffer.from(mine.value))).toBe(true);
      }
    });
  });

  // T013: a Google identity carries no refresh token (data-model §1), so its row is not paged.
  it('pass over a Google identity, which holds no refresh token', async () => {
    await inClientRollback(async (tx) => {
      const user = await newUser(tx);
      const google = await tx.authIdentity.create({
        data: { userId: user.id, provider: 'google', providerSubject: `probe-${randomUUID()}` },
        select: { id: true },
      });
      const refreshTokens = columnsOver(tx).find(
        ({ column }) => column === 'auth_identities.provider_refresh_token_encrypted',
      );
      if (refreshTokens === undefined) throw new Error('no refresh token column');
      expect((await firstFrom(refreshTokens, google.id))?.id).not.toBe(google.id);
    });
  });

  it('pass over a teacher whose payout reference is not set', async () => {
    await inClientRollback(async (tx) => {
      const teacher = await newUser(tx);
      const unset = await tx.teacherProfile.create({
        data: {
          userId: teacher.id,
          bio: 'Probe',
          qualificationSummary: 'Probe',
          verificationStatus: 'pending',
        },
        select: { id: true },
      });
      const payout = columnsOver(tx).find(
        ({ column }) => column === 'teacher_profiles.payout_account_ref_encrypted',
      );
      if (payout === undefined) throw new Error('no payout reference column');
      expect((await firstFrom(payout, unset.id))?.id).not.toBe(unset.id);
    });
  });

  // T004: the address is set to NULL once the order leaves `created` (data-model §2.4).
  it('pass over an order whose checkout address is cleared', async () => {
    await inClientRollback(async (tx) => {
      const teacher = await newUser(tx);
      const cleared = randomUUID();
      await newOrder(tx, teacher.id, cleared, null);
      const addresses = columnsOver(tx).find(
        ({ column }) => column === 'payments.checkout_url_encrypted',
      );
      if (addresses === undefined) throw new Error('no checkout address column');
      expect((await firstFrom(addresses, cleared))?.id).not.toBe(cleared);
    });
  });

  it('replace a value only where the row still holds it, as the application role', async () => {
    await inClientRollback(async (tx) => {
      const planted = await plant(tx);
      for (const column of columnsOver(tx)) {
        const mine = planted.get(column.column);
        if (mine === undefined) throw new Error(`nothing planted in ${column.column}`);
        const next = NEW.encrypt(`secret for ${column.column}`, column.column, mine.id);
        const stale = OLD.encrypt('a value the row no longer holds', column.column, mine.id);

        expect(await column.replace(mine.id, stale, next)).toBe(false);
        expect(await column.replace(mine.id, mine.value, next)).toBe(true);
        expect(await column.replace(mine.id, mine.value, next)).toBe(false);
        expect(await column.replace(randomUUID(), mine.value, next)).toBe(false);

        const first = await firstFrom(column, mine.id);
        expect(first?.id, `${column.column}: the planted row`).toBe(mine.id);
        const held = first?.value ?? new Uint8Array();
        expect(Buffer.from(held).equals(next)).toBe(true);
        expect(NEW.decrypt(held, column.column, mine.id)).toBe(`secret for ${column.column}`);
      }
    });
  });
});
