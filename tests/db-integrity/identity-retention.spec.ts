// R1a, `specs/002-identity/tasks.md` T176 (SRS §3.14, DEC-100, DEC-67; the note under T176, Q-3 (a);
// contracts/kernel.md of specs/004-sessions, the document sweep's row) — the identity retention
// sweep over the real tables as the application role: verification's queries, identity's entries
// read again under the kernel's real locks, the conditional mark, and the hourly
// `erase-deleted-files` removing the file of a marked live-account document through a storage fake.
//
// The applicants' page is identity's `identityDocumentsDecidedBefore` (Q-C1-1 (a), the owner's
// «موافق على الاتنين» of 2026-11-22) and the requests' page verification's query, both real, their
// rows narrowed to this probe's people so no other probe's row is touched. ⚠️ Automatic: the hourly job's removal leaves no way back.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { addDays } from '../../packages/time/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  eraseDeletedFiles,
  type ErasedFileStore,
} from '../../apps/api/src/jobs/erase-deleted-files.js';
import {
  createDocumentErasure,
  createIdentityRetentionSweep,
  type IdentityRetentionStore,
  identityRetentionStore,
} from '../../apps/api/src/modules/verification/index.js';
import { identityDocumentsDecidedBefore } from '../../apps/api/src/modules/identity/index.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import { connectAsApplication, type Db, insertRow, makeAdmin, makeUser } from './harness';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const DOCUMENT_COLUMN = 'verification_documents.storage_key_encrypted';

const SETTINGS: Readonly<Record<string, unknown>> = {
  identity_document_retention_days: 90,
  ban_restore_window_days: 14,
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

/** The storage port: every removal recorded. */
const storage = {
  removed: [] as string[],
  async remove(key: string) {
    this.removed.push(key);
  },
};

const daysAgo = (days: number) => new Date(addDays(new Date(), -days));

let db: Db;
let database: Database;
let admin: string;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 3,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  admin = await makeAdmin(db);
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

interface Probe {
  readonly userId: string;
  readonly documentId: string;
  readonly key: string;
}

/** An identity document of `userId`'s holding its key (uploaded as the route types it, `other`). */
async function documentOf(userId: string, values: Record<string, unknown> = {}) {
  const id = randomUUID();
  const key = `documents/${id}.pdf`;
  await insertRow(db, 'verification_documents', {
    id,
    user_id: userId,
    document_type: 'other',
    storage_key_encrypted: Buffer.from(cipher.encrypt(key, DOCUMENT_COLUMN, id)),
    uploaded_at: daysAgo(400),
    ...values,
  });
  return { id, key };
}

/** An applicant whose application is `status`, decided `days` ago, its profile pointing at its document. */
async function applicant(
  status: 'rejected' | 'banned' | 'needs_document',
  days: number,
  options: { readonly approved?: boolean } = {},
): Promise<Probe & { readonly profileId: string }> {
  const userId = await makeUser(db);
  await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
  const document = await documentOf(userId);
  const profileId = randomUUID();
  await insertRow(db, 'teacher_profiles', {
    id: profileId,
    user_id: userId,
    bio: '',
    qualification_summary: 'إجازة في حفص',
    verification_status: options.approved === true ? 'revoked' : 'pending',
    application_submitted_at: daysAgo(days + 10),
    application_status: status,
    application_decided_at: daysAgo(days),
    application_decided_by_admin_id: admin,
    identity_document_id: document.id,
    identity_document_type: 'national_id',
    ...(options.approved === true ? { approved_at: daysAgo(days + 5) } : {}),
  });
  return { userId, profileId, documentId: document.id, key: document.key };
}

/** A person whose identity request is `status`, closed `days` ago, holding its document. */
async function requester(
  status: 'satisfied' | 'replaced' | 'open',
  days: number,
  options: { readonly approved?: boolean } = {},
): Promise<Probe> {
  const userId = await makeUser(db);
  const document = await documentOf(userId);
  if (options.approved === true) {
    await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
    await insertRow(db, 'teacher_profiles', {
      user_id: userId,
      bio: '',
      qualification_summary: 'إجازة في حفص',
      verification_status: 'approved',
      application_status: 'approved',
      approved_at: daysAgo(300),
    });
  }
  await insertRow(db, 'verification_requests', {
    user_id: userId,
    requested_by_admin_id: admin,
    reason: 'Probe reason',
    status,
    document_id: document.id,
    document_type: 'national_id',
    created_at: daysAgo(days + 1),
    ...(status === 'open' ? {} : { resolved_at: daysAgo(days) }),
  });
  return { userId, documentId: document.id, key: document.key };
}

async function marks(id: string) {
  const { rows } = await db.query<{ erased: boolean; kept: boolean; has_key: boolean }>(
    `SELECT erased_at IS NOT NULL AS erased, kept_at IS NOT NULL AS kept,
            storage_key_encrypted IS NOT NULL AS has_key
       FROM verification_documents WHERE id = $1`,
    [id],
  );
  return rows[0];
}

const MARKED = { erased: true, kept: false, has_key: true };
const UNTOUCHED = { erased: false, kept: false, has_key: true };

/**
 * The real store, its applicants' page this probe's own (as identity's entry will list them) and its
 * requests' page the real query narrowed to this probe's people.
 */
function storeFor(
  applicants: readonly (Probe & { readonly profileId: string })[],
  people: readonly Probe[],
): IdentityRetentionStore {
  const mine = new Set([...applicants, ...people].map(({ userId }) => userId));
  const real = identityRetentionStore;
  return {
    ...real,
    applicationsDue: async (tx, cutoffs, after, limit) =>
      (await real.applicationsDue(tx, cutoffs, after, limit)).filter(({ userId }) =>
        mine.has(userId),
      ),
    requestsDue: async (tx, decidedBefore, after, limit) =>
      (await real.requestsDue(tx, decidedBefore, after, limit)).filter(({ userId }) =>
        mine.has(userId),
      ),
  };
}

function sweepFor(
  store: IdentityRetentionStore,
  lines: object[],
  held: ReadonlySet<string> = new Set(),
) {
  return createIdentityRetentionSweep({
    transactions: transactionsOver(database),
    settings,
    held: async (userIds) => new Set(userIds.filter((id) => held.has(id))),
    log: { info: (entry: object) => void lines.push(entry), error: () => undefined },
    // Large enough that this probe's narrowed requests' page is never a short page by the filter.
    pageSize: 100_000,
    report: () => undefined,
    store,
  });
}

describe('erase-identity-documents over the real tables (T176) ⚠️', () => {
  it('marks a rejected and a banned applicant’s document on day 91, a satisfied and a replaced request’s; never an approved teacher’s, a day-89 one or an open one', async () => {
    const rejected = await applicant('rejected', 91);
    const banned = await applicant('banned', 91);
    const early = await applicant('rejected', 89);
    const waiting = await applicant('needs_document', 120);
    // Approved, revoked, reapplied and rejected again: `approved_at` stays (DEC-67).
    const reapplied = await applicant('rejected', 91, { approved: true });
    const satisfied = await requester('satisfied', 91);
    const replaced = await requester('replaced', 91);
    const recent = await requester('satisfied', 89);
    const open = await requester('open', 0);
    const approvedRequest = await requester('satisfied', 91, { approved: true });
    const applicants = [rejected, banned, early, waiting, reapplied];
    const people = [satisfied, replaced, recent, open, approvedRequest];
    const lines: object[] = [];

    const run = await sweepFor(storeFor(applicants, people), lines).run();

    expect(new Set(run.erased)).toEqual(
      new Set([rejected, banned, satisfied, replaced].map(({ documentId }) => documentId)),
    );
    expect(run.failed).toEqual([]);
    for (const probe of [rejected, banned, satisfied, replaced]) {
      expect(await marks(probe.documentId)).toEqual(MARKED);
    }
    for (const probe of [early, waiting, reapplied, recent, open, approvedRequest]) {
      expect(await marks(probe.documentId)).toEqual(UNTOUCHED);
    }
    expect(lines).toContainEqual({
      documentId: rejected.documentId,
      userId: rejected.userId,
      reason: 'application_rejected',
    });
    expect(lines).toContainEqual({
      documentId: replaced.documentId,
      userId: replaced.userId,
      reason: 'request_replaced',
    });

    // Run again: nothing more is marked and no line is written (R-API-14).
    const again: object[] = [];
    expect((await sweepFor(storeFor(applicants, people), again).run()).erased).toEqual([]);
    expect(again).toEqual([]);
  });

  it('the requests’ query lists a decided request’s document by its closing, never an open, a recent or an erased one', async () => {
    const due = await requester('satisfied', 91);
    const recent = await requester('replaced', 89);
    const open = await requester('open', 0);
    const erased = await requester('satisfied', 91);
    await db.query('UPDATE verification_documents SET erased_at = now() WHERE id = $1', [
      erased.documentId,
    ]);
    const store = identityRetentionStore;
    const listed = await database.$transaction((tx) =>
      store.requestsDue(tx, daysAgo(90), undefined, 100_000),
    );
    const ids = new Set(listed.map(({ documentId }) => documentId));
    expect(ids.has(due.documentId)).toBe(true);
    for (const probe of [recent, open, erased]) expect(ids.has(probe.documentId)).toBe(false);
  });

  it('skips a document whose owner an open matter holds', async () => {
    const probe = await requester('satisfied', 91);
    const run = await sweepFor(storeFor([], [probe]), [], new Set([probe.userId])).run();
    expect(run.erased).toEqual([]);
    expect(await marks(probe.documentId)).toEqual(UNTOUCHED);
  });

  it('identity’s page lists the live applicants never approved by the cutoffs: rejected and banned, never approved, open or recent', async () => {
    const rejected = await applicant('rejected', 91);
    const banned = await applicant('banned', 91);
    const bannedRecent = await applicant('banned', 50);
    const early = await applicant('rejected', 20);
    const waiting = await applicant('needs_document', 120);
    const reapplied = await applicant('rejected', 120, { approved: true });
    const listed = await database.$transaction((tx) =>
      identityDocumentsDecidedBefore(
        tx,
        { rejectedBefore: daysAgo(30), bannedBefore: daysAgo(90) },
        undefined,
        100_000,
      ),
    );
    const ids = new Set(listed.map(({ documentId }) => documentId));
    for (const probe of [rejected, banned]) expect(ids.has(probe.documentId)).toBe(true);
    for (const probe of [bannedRecent, early, waiting, reapplied]) {
      expect(ids.has(probe.documentId)).toBe(false);
    }
    expect(listed.find(({ documentId }) => documentId === rejected.documentId)).toEqual({
      profileId: rejected.profileId,
      userId: rejected.userId,
      documentId: rejected.documentId,
    });
  });

  it('two runs at once mark each document once, serialised on its locks', async () => {
    const a = await applicant('rejected', 120);
    const b = await requester('satisfied', 120);
    const lines: object[] = [];
    const [one, two] = await Promise.all([
      sweepFor(storeFor([a], [b]), lines).run(),
      sweepFor(storeFor([a], [b]), lines).run(),
    ]);
    expect([...one.erased, ...two.erased].sort()).toEqual([a.documentId, b.documentId].sort());
    expect(lines).toHaveLength(2);
  });

  it('the mark refuses a kept document and an erased one, writing nothing (C1-5)', async () => {
    const userId = await makeUser(db);
    const kept = await documentOf(userId, { kept_at: daysAgo(1) });
    const erased = await documentOf(userId, { erased_at: daysAgo(1) });
    const at = new Date();
    // The store's mark is verification's `markIdentityDocumentErased`.
    const mark = identityRetentionStore.markErased;
    expect(await database.$transaction((tx) => mark(tx, kept.id, at))).toBe(false);
    expect(await database.$transaction((tx) => mark(tx, erased.id, at))).toBe(false);
    expect(await marks(kept.id)).toEqual({ erased: false, kept: true, has_key: true });
    const { rows } = await db.query<{ erased_at: Date }>(
      'SELECT erased_at FROM verification_documents WHERE id = $1',
      [erased.id],
    );
    expect(rows[0]?.erased_at.getTime()).not.toBe(at.getTime());
  });

  it('erase-deleted-files removes the file of a marked live-account document and clears its key, waiting while it is held', async () => {
    const probe = await requester('satisfied', 91);
    const other = await requester('replaced', 91);
    await sweepFor(storeFor([], [probe, other]), []).run();
    const ids = new Set([probe.documentId, other.documentId]);
    const erasure = createDocumentErasure({ database, cipher, storage });
    // The real store, narrowed to this probe's two documents so no other probe's file is touched.
    const store: ErasedFileStore = {
      pendingPage: async (after, limit) =>
        (await erasure.pendingPage(after, limit)).filter(({ id }) => ids.has(id)),
      clearKey: (file) => erasure.clearKey(file),
    };
    const held = new Set([other.userId]);
    const job = eraseDeletedFiles({
      stores: [store],
      storage,
      held: async (userIds) => new Set(userIds.filter((id) => held.has(id))),
      pageSize: 100_000,
    });
    await job.handle({});

    expect(storage.removed).toContain(probe.key);
    expect(storage.removed).not.toContain(other.key);
    expect(await marks(probe.documentId)).toEqual({ erased: true, kept: false, has_key: false });
    expect(await marks(other.documentId)).toEqual(MARKED);

    held.clear();
    await job.handle({});
    expect(storage.removed).toContain(other.key);
    expect(await marks(other.documentId)).toEqual({ erased: true, kept: false, has_key: false });
  });
});
