// T076 of specs/004-sessions/tasks.md (FR-508; SRS FR-AUTH-14 as amended, DEC-67; ADR 0015 as
// amended; the note under T076, N1, N2, Q-O8 (a), Q-R9) — what a deleted teacher once approved
// keeps, over the real tables as the application role, through the deletion `main.ts` composes
// (identity's `eraseAccount`, verification's `documentErasureConsequence`, the files after the
// commit).
//
// - A teacher ever approved (`approved_at` set), whatever the standing since (active, suspended,
//   banned, revoked), keeps the identity documents, the credential documents and the payout
//   reference (`kept_at` on each and on the profile), and loses the bio, the qualification summary,
//   the photo and every other document. A teacher never approved and a student keep nothing.
// - Every ordinary reader answers a kept document as none: the link (`readDocument`) and the
//   unreferenced-documents purge's list (Q-O8 (a)). The held-files read lists one inside an open
//   matter and opens it there (Q-R9 (i)); `erase-deleted-files` never touches one.
// - The payout hash is unique among the live profiles only (rule 27 as widened): a gateway verdict
//   and the rejection's lock reach the live profile only, the kept row unchanged, and a new account
//   may register the payout account a kept profile holds (Q-E (a)).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AccountConsequences,
  createIdentityServices,
  lockPayoutHolder,
  markPayoutRejected,
  markPayoutVerified,
  payoutRefHash,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createDisputeHeldFiles,
  createDocumentErasure,
  createUnreferencedDocuments,
  documentErasureConsequence,
  VerificationService,
} from '../../apps/api/src/modules/verification/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import { connectAsApplication, type Db, insertRow, makeUser } from './harness';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const DOCUMENT_COLUMN = 'verification_documents.storage_key_encrypted';
const PAYOUT_COLUMN = 'teacher_profiles.payout_account_ref_encrypted';
const PASSWORD = 'a long probe passphrase 76';
const APPROVED_AT = '2026-11-01T09:00:00Z';
const CONFIGURED_AT = '2026-11-02T09:00:00Z';
const VERIFIED_AT = '2026-11-03T09:00:00Z';

const SETTINGS: Readonly<Record<string, unknown>> = {
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
  idempotency_key_ttl_hours: 24,
  document_link_ttl_seconds: 300,
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

/** The storage port: every removal recorded, every link minted for the key it is handed. */
const storage = {
  removed: [] as string[],
  async remove(key: string) {
    this.removed.push(key);
  },
  async temporaryLink(key: string) {
    return `https://storage.invalid/${key}`;
  },
};

/** The recipient reference the next registration answers. */
let nextRecipientRef = '';

let db: Db;
let database: Database;
let identity: ReturnType<typeof createIdentityServices>;
let erasure: ReturnType<typeof createDocumentErasure>;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 3,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const consequences = new AccountConsequences();
  consequences.subscribe(documentErasureConsequence());
  erasure = createDocumentErasure({ database, cipher, storage });
  const unreachable = () => Promise.reject(new Error('probe: not reached'));
  identity = createIdentityServices({
    database,
    settings,
    encryptionKey: KEY,
    cipher,
    marks: new MemorySingleUseMarks(() => new Date()),
    signIn: {
      verifyIdentityToken: unreachable,
      exchangeAuthorization: unreachable,
      revoke: unreachable,
    },
    email: { deliver: async () => undefined },
    storage,
    log: { warn: () => undefined },
    payment: { registerPayoutRecipient: async () => nextRecipientRef },
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    consequences,
    fileErasures: [erasure],
    report: () => undefined,
  });
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

type DocumentType = 'national_id' | 'passport' | 'credential' | 'other';

interface Teacher {
  readonly userId: string;
  readonly photoKey: string;
  readonly documents: Readonly<Record<DocumentType, { readonly id: string; readonly key: string }>>;
}

/** A document of `userId`'s holding its key, encrypted under this probe's cipher. */
async function documentOf(userId: string, type: DocumentType, values: Record<string, unknown> = {}) {
  const id = randomUUID();
  const key = `documents/${id}.pdf`;
  await insertRow(db, 'verification_documents', {
    id,
    user_id: userId,
    document_type: type,
    storage_key_encrypted: Buffer.from(cipher.encrypt(key, DOCUMENT_COLUMN, id)),
    ...values,
  });
  return { id, key };
}

/**
 * A teacher with a photo, a bio, a qualification summary, a verified payout reference and one
 * document of each kind; `approved` writes `approved_at`, and the standing is the one given.
 */
async function teacher(
  approved: boolean,
  standing: { readonly accountStatus: string; readonly verificationStatus: string },
): Promise<Teacher> {
  const photoKey = `photos/${randomUUID()}.jpg`;
  const userId = await makeUser(db, {
    password_hash: await hashPassword(PASSWORD),
    photo_key: photoKey,
    account_status: standing.accountStatus,
  });
  await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
  const profileId = randomUUID();
  const ref = `spec_rcp_${randomUUID()}`;
  await insertRow(db, 'teacher_profiles', {
    id: profileId,
    user_id: userId,
    bio: 'سيرة المعلّم',
    qualification_summary: 'إجازة في حفص',
    photo_key: `profiles/${randomUUID()}.jpg`,
    verification_status: standing.verificationStatus,
    ...(approved ? { approved_at: APPROVED_AT } : {}),
    payout_account_ref_encrypted: Buffer.from(cipher.encrypt(ref, PAYOUT_COLUMN, profileId)),
    payout_account_ref_hash: payoutRefHash(ref),
    payout_configured_at: CONFIGURED_AT,
    payout_verified_at: VERIFIED_AT,
  });
  return {
    userId,
    photoKey,
    documents: {
      national_id: await documentOf(userId, 'national_id'),
      passport: await documentOf(userId, 'passport'),
      credential: await documentOf(userId, 'credential'),
      other: await documentOf(userId, 'other'),
    },
  };
}

function remove(userId: string) {
  return identity.deletion.deleteAccount(userId, {
    confirmation: 'DELETE',
    reauth: { kind: 'password', password: PASSWORD },
    idempotencyKey: randomUUID(),
  });
}

async function profileRow(userId: string) {
  const { rows } = await db.query<{
    bio: string;
    qualification_summary: string;
    photo_key: string | null;
    has_ref: boolean;
    payout_account_ref_hash: string | null;
    payout_configured_at: Date | null;
    payout_verified_at: Date | null;
    kept: boolean;
  }>(
    `SELECT bio, qualification_summary, photo_key,
            payout_account_ref_encrypted IS NOT NULL AS has_ref, payout_account_ref_hash,
            payout_configured_at, payout_verified_at, kept_at IS NOT NULL AS kept
       FROM teacher_profiles WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

async function documentRow(id: string) {
  const { rows } = await db.query<{ kept: boolean; erased: boolean; has_key: boolean }>(
    `SELECT kept_at IS NOT NULL AS kept, erased_at IS NOT NULL AS erased,
            storage_key_encrypted IS NOT NULL AS has_key
       FROM verification_documents WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function photoKeyOf(userId: string): Promise<string | null | undefined> {
  const { rows } = await db.query<{ photo_key: string | null }>(
    'SELECT photo_key FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.photo_key;
}

const KEPT = { kept: true, erased: false, has_key: true };
const GONE = { kept: false, erased: true, has_key: false };

/**
 * Waits for the deletion's work after the commit: every document of the person kept or gone, and
 * the photo's key cleared. No file of this probe's is left erased with its key.
 */
async function settled(person: Teacher): Promise<void> {
  await vi.waitFor(async () => {
    for (const { id } of Object.values(person.documents)) {
      const row = await documentRow(id);
      expect(row?.kept === true || row?.has_key === false).toBe(true);
    }
    expect(await photoKeyOf(person.userId)).toBeNull();
  });
}

describe('a teacher ever approved keeps the identity and credential documents and the payout reference (T076, FR-508)', () => {
  it.each([
    ['active', { accountStatus: 'active', verificationStatus: 'approved' }],
    ['suspended', { accountStatus: 'suspended', verificationStatus: 'approved' }],
    ['banned', { accountStatus: 'banned', verificationStatus: 'banned' }],
    ['revoked', { accountStatus: 'active', verificationStatus: 'revoked' }],
  ])(
    '%s: keeps the three and the payout reference, loses the bio, the qualification summary, the photo and the other documents',
    async (_standing, standing) => {
      const person = await teacher(true, standing);
      const before = await profileRow(person.userId);
      await remove(person.userId);
      await settled(person);

      expect(await profileRow(person.userId)).toEqual({
        bio: '',
        qualification_summary: '',
        photo_key: null,
        has_ref: true,
        payout_account_ref_hash: before?.payout_account_ref_hash,
        payout_configured_at: new Date(CONFIGURED_AT),
        payout_verified_at: new Date(VERIFIED_AT),
        kept: true,
      });
      for (const type of ['national_id', 'passport', 'credential'] as const) {
        expect(await documentRow(person.documents[type].id)).toEqual(KEPT);
      }
      await vi.waitFor(async () => {
        expect(await documentRow(person.documents.other.id)).toEqual(GONE);
        expect(await photoKeyOf(person.userId)).toBeNull();
      });
      expect(storage.removed).toEqual(
        expect.arrayContaining([person.documents.other.key, person.photoKey]),
      );
      for (const type of ['national_id', 'passport', 'credential'] as const) {
        expect(storage.removed).not.toContain(person.documents[type].key);
      }
    },
  );

  it('a teacher never approved keeps nothing: the payout reference blanked, every document erased', async () => {
    const person = await teacher(false, { accountStatus: 'active', verificationStatus: 'pending' });
    await remove(person.userId);
    await settled(person);

    expect(await profileRow(person.userId)).toEqual({
      bio: '',
      qualification_summary: '',
      photo_key: null,
      has_ref: false,
      payout_account_ref_hash: null,
      payout_configured_at: null,
      payout_verified_at: null,
      kept: false,
    });
    await vi.waitFor(async () => {
      for (const type of ['national_id', 'passport', 'credential', 'other'] as const) {
        expect(await documentRow(person.documents[type].id)).toEqual(GONE);
      }
    });
  });

  it('a student keeps nothing: every document erased', async () => {
    const userId = await makeUser(db, { password_hash: await hashPassword(PASSWORD) });
    await insertRow(db, 'user_roles', { user_id: userId, role: 'student', status: 'active' });
    const identityDocument = await documentOf(userId, 'national_id');
    const passport = await documentOf(userId, 'passport');
    await remove(userId);
    await vi.waitFor(async () => {
      expect(await documentRow(identityDocument.id)).toEqual(GONE);
      expect(await documentRow(passport.id)).toEqual(GONE);
    });
  });
});

/** A deleted person's kept document, written as the deletion leaves it (rule 34: kept, key held). */
async function keptDocument(values: Record<string, unknown> = {}) {
  const userId = await makeUser(db);
  await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
  await db.query('UPDATE users SET deleted_at = now(), email = NULL WHERE id = $1', [userId]);
  const document = await documentOf(userId, 'national_id', { kept_at: APPROVED_AT, ...values });
  return { userId, document };
}

describe('every ordinary reader answers a kept document as none (T076; Q-O8 (a), Q-R9)', () => {
  it('mints no link to it, not even for an administrator (`readDocument`)', async () => {
    const { document } = await keptDocument();
    const links = new VerificationService({ storage, cipher, settings });
    await database.$transaction(async (tx) => {
      await expect(
        links.documentLinkFor(tx, document.id, { kind: 'admin', adminId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('the unreferenced-documents purge never lists it (Q-O8 (a))', async () => {
    // Uploaded before every other probe's rows, so the window holds only this probe's document.
    const { document } = await keptDocument({ uploaded_at: '1999-06-01T00:00:00Z' });
    const purge = createUnreferencedDocuments({ database, cipher, references: [] });
    const listed = await purge.listUnreferencedUploadedBefore(new Date('1999-06-02T00:00:00Z'));
    expect(listed.map(({ id }) => id)).not.toContain(document.id);
  });

  it('the held-files read lists it inside an open matter and opens it there (Q-R9 (i))', async () => {
    const { userId, document } = await keptDocument();
    const held = createDisputeHeldFiles({ database, storage, cipher, settings });
    await database.$transaction(async (tx) => {
      expect(await held.heldFilesOf(tx, [userId])).toContainEqual({
        fileRef: `document:${document.id}`,
        kind: 'national_id',
        ownerUserId: userId,
        uploadedAt: expect.any(Date),
      });
      expect(await held.heldFileLink(tx, [userId], `document:${document.id}`)).toEqual({
        url: `https://storage.invalid/${document.key}`,
        expiresAt: expect.any(String),
      });
    });
  });

  it('`erase-deleted-files` never lists it, and the deletion’s file erasure never removes it', async () => {
    const { userId, document } = await keptDocument();
    const pending = await erasure.pendingPage(undefined, 10_000);
    expect(pending.map(({ id }) => id)).not.toContain(document.id);
    await erasure.eraseFilesOf(userId);
    expect(storage.removed).not.toContain(document.key);
    expect(await documentRow(document.id)).toEqual(KEPT);
  });
});

/** A profile of a new account's holding the reference `ref`, kept (`kept_at`) or live. */
async function profileHolding(ref: string, kept: boolean): Promise<string> {
  const userId = await makeUser(db);
  await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
  if (kept) {
    await db.query('UPDATE users SET deleted_at = now(), email = NULL WHERE id = $1', [userId]);
  }
  const profileId = randomUUID();
  await insertRow(db, 'teacher_profiles', {
    id: profileId,
    user_id: userId,
    bio: kept ? '' : 'سيرة',
    qualification_summary: kept ? '' : 'إجازة',
    verification_status: 'approved',
    approved_at: APPROVED_AT,
    payout_account_ref_encrypted: Buffer.from(cipher.encrypt(ref, PAYOUT_COLUMN, profileId)),
    payout_account_ref_hash: payoutRefHash(ref),
    payout_configured_at: CONFIGURED_AT,
    ...(kept ? { kept_at: APPROVED_AT } : {}),
  });
  return userId;
}

async function payoutOf(userId: string) {
  const { rows } = await db.query<{
    payout_verified_at: Date | null;
    payout_rejected_reason: string | null;
  }>(
    'SELECT payout_verified_at, payout_rejected_reason FROM teacher_profiles WHERE user_id = $1',
    [userId],
  );
  return rows[0];
}

describe('the payout hash binds the live profiles only (T076; rule 27 as widened, Q-E (a))', () => {
  it('a verified and a rejected verdict each reach the live profile only, the kept row unchanged', async () => {
    const ref = `spec_rcp_${randomUUID()}`;
    // The kept profile first, so a read that ignored `kept_at` would find it first.
    const kept = await profileHolding(ref, true);
    const live = await profileHolding(ref, false);
    const hash = payoutRefHash(ref);
    const at = new Date('2026-11-05T10:00:00Z');

    expect(await database.$transaction((tx) => markPayoutVerified(tx, hash, at))).toBe(true);
    expect(await payoutOf(live)).toEqual({ payout_verified_at: at, payout_rejected_reason: null });
    expect(await payoutOf(kept)).toEqual({ payout_verified_at: null, payout_rejected_reason: null });

    expect(
      await database.$transaction((tx) => markPayoutRejected(tx, hash, 'Account closed')),
    ).toBe(true);
    expect(await payoutOf(live)).toEqual({
      payout_verified_at: null,
      payout_rejected_reason: 'Account closed',
    });
    expect(await payoutOf(kept)).toEqual({ payout_verified_at: null, payout_rejected_reason: null });
  });

  it('the rejection’s lock takes the live holder’s account, never the kept one’s', async () => {
    const ref = `spec_rcp_${randomUUID()}`;
    const kept = await profileHolding(ref, true);
    const live = await profileHolding(ref, false);
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = (): void => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const locked = database.$transaction(
      async (tx) => {
        await lockPayoutHolder(tx, payoutRefHash(ref));
        held();
        await released;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await holding;
    const other = await connectAsApplication();
    try {
      const tryLock = async (userId: string) => {
        await other.query('BEGIN');
        try {
          await other.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE NOWAIT', [userId]);
          return 'free';
        } catch {
          return 'held';
        } finally {
          await other.query('ROLLBACK');
        }
      };
      expect(await tryLock(live)).toBe('held');
      expect(await tryLock(kept)).toBe('free');
    } finally {
      release();
      await locked;
      await other.end();
    }
  });

  it('a new account registers the payout account a deleted teacher’s kept profile still holds', async () => {
    const person = await teacher(true, { accountStatus: 'active', verificationStatus: 'approved' });
    const keptHash = (await profileRow(person.userId))?.payout_account_ref_hash;
    await remove(person.userId);
    await settled(person);
    expect((await profileRow(person.userId))?.payout_account_ref_hash).toBe(keptHash);

    const newcomer = await makeUser(db);
    await insertRow(db, 'user_roles', { user_id: newcomer, role: 'teacher', status: 'active' });
    await insertRow(db, 'teacher_profiles', {
      user_id: newcomer,
      bio: 'سيرة',
      qualification_summary: 'إجازة',
      verification_status: 'approved',
      approved_at: APPROVED_AT,
    });
    // The gateway answers the same recipient for the same account.
    const { rows } = await db.query<{ encrypted: Buffer; id: string }>(
      'SELECT payout_account_ref_encrypted AS encrypted, id FROM teacher_profiles WHERE user_id = $1',
      [person.userId],
    );
    const [kept] = rows;
    if (kept === undefined) throw new Error('no kept profile');
    nextRecipientRef = cipher.decrypt(kept.encrypted, PAYOUT_COLUMN, kept.id);
    await identity.payout.register(newcomer, {
      details: { holderName: 'Spec Teacher', method: 'bank_account', accountNumber: 'EG001' },
      idempotencyKey: randomUUID(),
    });
    expect((await profileRow(newcomer))?.payout_account_ref_hash).toBe(keptHash);
    expect((await profileRow(person.userId))?.payout_account_ref_hash).toBe(keptHash);
  });
});
