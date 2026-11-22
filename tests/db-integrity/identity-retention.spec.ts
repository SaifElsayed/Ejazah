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
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { addDays } from '../../packages/time/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  eraseDeletedFiles,
  type ErasedFileStore,
} from '../../apps/api/src/jobs/erase-deleted-files.js';
import { createOngoingEnrollments } from '../../apps/api/src/modules/booking/index.js';
import { createDocumentReferences as catalogReferences } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  createDocumentReferences as identityReferences,
  createIdentityServices,
  identityDocumentsDecidedBefore,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createDocumentErasure,
  createDocumentsUploadRoute,
  createIdentityRetentionSweep,
  createVerificationServices,
  documentErasureConsequence,
  type IdentityRetentionStore,
  identityRetentionStore,
} from '../../apps/api/src/modules/verification/index.js';
import { hashPassword } from '../../apps/api/src/platform/crypto/hashing.js';
import { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures.js';
import { multipart, pdfBytes } from '../../apps/api/src/surfaces/upload-fixtures.js';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { transactionsOver } from '../../apps/api/src/platform/db/transaction.repository.js';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader.js';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeAdmin,
  makeSubject,
  makeUser,
} from './harness';

const KEY = Buffer.alloc(32, 7).toString('base64');
const cipher = new ColumnCipher(KEY);
const DOCUMENT_COLUMN = 'verification_documents.storage_key_encrypted';

const SETTINGS: Readonly<Record<string, unknown>> = {
  identity_document_retention_days: 90,
  ban_restore_window_days: 14,
  // The owner-approved addition (Q-C1-2): the upload route, the submission and the deletion.
  upload_max_bytes: 65_536,
  rate_limit_upload: { limit: 1000, window_seconds: 60 },
  document_unreferenced_max_per_user: 30,
  idempotency_key_ttl_hours: 24,
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
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

/** The storage port: every removal recorded, a put accepted, a link minted for its key. */
const storage = {
  removed: [] as string[],
  async remove(key: string) {
    this.removed.push(key);
  },
  async put() {
    return undefined;
  },
  async temporaryLink(key: string) {
    return `https://storage.invalid/${key}`;
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

// ---------------------------------------------------------------------------------------------
// The owner-approved R1a addition (Q-C1-2 (a), «موافق على الاتنين» of 2026-11-22; SRS DEC-67,
// FR-AUTH-14; spec FR-508 of specs/004-sessions): an identity document reaches the database through
// `POST /uploads/documents` as kind `identity`, stored as `other` until a submission names its kind;
// a teacher once approved keeps every identity document they submitted at the deletion, the one an
// earlier submission named and a later one replaced included, and a teacher never approved keeps
// none. ⚠️ It decides which files survive a deletion; the files not kept are removed for good.
describe('a deleted teacher once approved keeps every identity document submitted (Q-C1-2, DEC-67) ⚠️', () => {
  const PASSWORD = 'a long probe passphrase 176';
  const sessionsByBearer = new Map<string, string>();
  let server: Server;
  let origin: string;
  let subjectId: string;
  let verification: ReturnType<typeof createVerificationServices>;
  let identity: ReturnType<typeof createIdentityServices>;

  beforeAll(async () => {
    const log = createLogger({ level: 'info', destination: { write: () => undefined } });
    const rateLimiter = new RateLimiter({
      settings,
      counter: { hit: async () => 1 },
      subjectKey: Buffer.alloc(32, 3),
    });
    const route = createDocumentsUploadRoute({
      database,
      cipher,
      references: [identityReferences(database), catalogReferences(database)],
      sessions: async (bearer: string) => {
        const userId = sessionsByBearer.get(bearer);
        return userId === undefined
          ? null
          : {
              userId,
              sessionId: `session-${userId}`,
              role: 'teacher',
              gender: 'male',
              preferredLanguage: 'ar',
              accountStatus: 'active',
            };
      },
      guard: { settings, rateLimiter },
      log,
      storage,
      settings,
    });
    server = createServer((request, response) => void route(request, response));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    subjectId = await makeSubject(db);
    const idempotency = new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    });
    verification = createVerificationServices({ database, storage, cipher, settings, idempotency });
    const consequences = new AccountConsequences();
    consequences.subscribe(documentErasureConsequence());
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
      log: { warn: () => undefined, info: () => undefined },
      payment: { registerPayoutRecipient: unreachable },
      idempotency,
      consequences,
      fileErasures: [createDocumentErasure({ database, cipher, storage })],
      report: () => undefined,
      ongoingEnrollments: createOngoingEnrollments({ settings }),
      openIjazahRequests: { count: async () => 0 },
      openCases: { count: async () => 0 },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Uploads a PDF of `kind` as `userId` through the real route; the document's id. */
  async function upload(userId: string, kind: 'identity' | 'credential'): Promise<string> {
    const bearer = `bearer-${userId}`;
    sessionsByBearer.set(bearer, userId);
    const payload = multipart([
      { name: 'kind', value: kind },
      { name: 'file', filename: 'document.pdf', type: 'application/pdf', bytes: pdfBytes() },
    ]);
    // Mounted at `/uploads/documents` by main.ts, the route itself answers the mount (`/`).
    const response = await fetch(`${origin}/`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': payload.contentType },
      body: new Uint8Array(payload.body),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { documentId: string }).documentId;
  }

  /**
   * An applicant who submits through the real service, is asked for a document and sends a new
   * identity document in its place; `approved` then approves the application.
   */
  async function teacher(approved: boolean) {
    const userId = await makeUser(db, { password_hash: await hashPassword(PASSWORD) });
    await insertRow(db, 'user_roles', { user_id: userId, role: 'teacher', status: 'active' });
    const first = await upload(userId, 'identity');
    const credential = await upload(userId, 'credential');
    await verification.application.submit(userId, {
      idempotencyKey: randomUUID(),
      subjectIds: [subjectId],
      credentials: [{ subjectId, documentId: credential }],
      qualificationSummary: 'إجازة في حفص',
      identityDocument: { type: 'national_id', documentId: first },
    });
    await db.query(
      `UPDATE teacher_profiles SET application_status = 'needs_document' WHERE user_id = $1`,
      [userId],
    );
    const second = await upload(userId, 'identity');
    await verification.application.resubmit(userId, { identityDocumentId: second });
    if (approved) {
      await db.query(
        `UPDATE teacher_profiles
            SET application_status = 'approved', verification_status = 'approved', approved_at = now()
          WHERE user_id = $1`,
        [userId],
      );
    }
    return { userId, first, second, credential };
  }

  async function remove(userId: string) {
    await identity.deletion.deleteAccount(userId, {
      confirmation: 'DELETE',
      reauth: { kind: 'password', password: PASSWORD },
      idempotencyKey: randomUUID(),
    });
  }

  it('keeps the replaced identity document and the current one, each with the kind its submission named', async () => {
    const person = await teacher(true);
    await remove(person.userId);
    for (const id of [person.first, person.second, person.credential]) {
      expect(await marks(id)).toEqual({ erased: false, kept: true, has_key: true });
    }
    const { rows } = await db.query<{ document_type: string }>(
      'SELECT document_type FROM verification_documents WHERE id = ANY($1::uuid[])',
      [[person.first, person.second]],
    );
    expect(rows.map(({ document_type }) => document_type)).toEqual(['national_id', 'national_id']);
  });

  it('keeps the identity document an approved teacher sent for an identity request, with its kind', async () => {
    const person = await teacher(true);
    await insertRow(db, 'verification_requests', {
      user_id: person.userId,
      requested_by_admin_id: admin,
      reason: 'Probe reason',
      status: 'open',
    });
    const sent = await upload(person.userId, 'identity');
    await verification.identityVerification.submit(person.userId, {
      documentType: 'passport',
      documentId: sent,
    });
    await remove(person.userId);
    expect(await marks(sent)).toEqual({ erased: false, kept: true, has_key: true });
    const { rows } = await db.query<{ document_type: string }>(
      'SELECT document_type FROM verification_documents WHERE id = $1',
      [sent],
    );
    expect(rows).toEqual([{ document_type: 'passport' }]);
  });

  it('keeps nothing of a teacher never approved: every identity document erased (T176 unchanged)', async () => {
    const person = await teacher(false);
    await remove(person.userId);
    for (const id of [person.first, person.second, person.credential]) {
      const row = await marks(id);
      expect(row?.erased).toBe(true);
      expect(row?.kept).toBe(false);
    }
  });
});
