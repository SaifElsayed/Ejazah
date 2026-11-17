// T101 of specs/003-booking/tasks.md (B-M1; ADR 0025 D2, SRS DEC-80; Q-B2 (a)) — identity's
// `payoutRecipientOf`, the gateway recipient a checkout splits the teacher's share to, over the real
// `teacher_profiles` as the application role: the reference is decrypted only when the gateway
// verified the account (`payout_verified_at` set); a registration still pending, a rejected one, a
// teacher with no registration and a person with no profile answer none.
//
// Observed red: every case against the module before the function existed; the pending and rejected
// cases against mutant M-B10 (the verified check removed), restored and `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  payoutRecipientOf,
  payoutRefHash,
} from '../../apps/api/src/modules/identity/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { connectAsApplication, type Db, insertRow, makeUser } from './harness';

const cipher = new ColumnCipher(Buffer.alloc(32, 11).toString('base64'));
const PAYOUT_COLUMN = 'teacher_profiles.payout_account_ref_encrypted';

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
  await db?.end();
});

/** A teacher whose profile holds a registered reference in the state given; the reference returned. */
async function teacher(
  state: 'verified' | 'pending' | 'rejected' | 'none',
): Promise<{ userId: string; ref: string }> {
  const userId = await makeUser(db);
  await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
  const profileId = randomUUID();
  const ref = `spec_rcp_${randomUUID()}`;
  await insertRow(db, 'teacher_profiles', {
    id: profileId,
    user_id: userId,
    bio: 'سيرة المعلّم',
    qualification_summary: 'إجازة في حفص',
    photo_key: `profiles/${randomUUID()}.jpg`,
    verification_status: 'approved',
    approved_at: '2026-11-01T09:00:00Z',
    ...(state === 'none'
      ? {}
      : {
          payout_account_ref_encrypted: Buffer.from(cipher.encrypt(ref, PAYOUT_COLUMN, profileId)),
          payout_account_ref_hash: payoutRefHash(ref),
          payout_configured_at: '2026-11-02T09:00:00Z',
        }),
    ...(state === 'verified' ? { payout_verified_at: '2026-11-03T09:00:00Z' } : {}),
    ...(state === 'rejected' ? { payout_rejected_reason: 'account closed' } : {}),
  });
  return { userId, ref };
}

describe("the teacher's payout recipient for a checkout's split (T101, Q-B2 (a))", () => {
  it('decrypts the reference of a verified account', async () => {
    const { userId, ref } = await teacher('verified');

    expect(await payoutRecipientOf(database, cipher, userId)).toBe(ref);
  });

  it('answers none while the registration waits for the gateway', async () => {
    const { userId } = await teacher('pending');

    expect(await payoutRecipientOf(database, cipher, userId)).toBeNull();
  });

  it('answers none for a rejected account', async () => {
    const { userId } = await teacher('rejected');

    expect(await payoutRecipientOf(database, cipher, userId)).toBeNull();
  });

  it('answers none for a teacher with no registration and for a person with no profile', async () => {
    const { userId } = await teacher('none');

    expect(await payoutRecipientOf(database, cipher, userId)).toBeNull();
    expect(await payoutRecipientOf(database, cipher, await makeUser(db))).toBeNull();
  });
});
