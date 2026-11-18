// T006 of specs/005-certification — the ijazah request over the real tables as the application role
// (FR-603, FR-608, FR-627; research R-403, R-404; the note under T006, Q1 to Q4, Q14, Q-A1 to Q-A4;
// specs/004-sessions/contracts/kernel.md, the ijazah request's row):
//
// - A send freezes, in one row: the chain origin first with the holder name appended, the holder
//   name, the riwaya and the tariq (NULL when the credential names none), the signature copy's key
//   under `ijazah-requests/<id>/` (its file stored beside the teacher's own), `pending` with a
//   certificate name, `awaiting_student_name` without one; a second send is `request_open` and an
//   enrollment with an unrevoked ijazah `already_issued`, nothing written for either.
// - The credential's lock (Q-A1 (a)): a send while a correction holds the credential waits for it,
//   then freezes the corrected chain; without the lock it would freeze the old one.
// - The correction's re-freeze (P4 (a), Q-A4 (a)): `credentials.correct` re-freezes the open
//   request's chain, holder name, riwaya and tariq on its own transaction.
// - The certificate name's release (T004's port, now bound): the waiting request moves to `pending`;
//   005:T019 (Q-T1 (a)): its `ijazahRequest` event reaches both parties once the list flushes, on
//   the student's own set and on an administrator's change alike.
// - The student's deletion (Q14 (a)): the open request closed and its key cleared on the
//   transaction, its file removed only after the commit.
// - `EnrollmentIjazahRequests.of`: each enrollment's latest request, with its ijazah once approved.
//
// The service is certification's factory over the real store and the kernel's idempotency, on an
// in-memory storage port. Each world is committed with accounts of its own; nothing is deleted.
//
// Observed red: the re-freeze case against the mutant «the call dropped from
// `credential-review.service.ts`' `correct`», and the lock case against the mutant «no
// `lockRows(tx, 'teacher_credentials', …)` in `lockedCredentialChainOf`» (REPORT.md's red table).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LiveEvent } from '../../packages/contracts/src/index.js';
import { createCredentialReviewService } from '../../apps/api/src/modules/catalog/index';
import {
  createIjazahRequestService,
  type IjazahRequestService,
} from '../../apps/api/src/modules/certification/index';
import { createCertificateNameService } from '../../apps/api/src/modules/identity/index';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import type { LiveMessage } from '../../apps/api/src/platform/live/live-bus';
import { bindToTransaction, RequestLive } from '../../apps/api/src/platform/live/live-publisher';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import {
  connectAsApplication,
  type Db,
  enrollmentValues,
  insertRow,
  makeAdmin,
  makeCredential,
  makeOffer,
  makeUser,
} from './harness';

const SETTINGS: Readonly<Record<string, unknown>> = {
  idempotency_key_ttl_hours: 24,
  admin_list_page_size: 20,
};
const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};
const OPTIONS = { maxWait: 5_000, timeout: 20_000 };
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const live = { afterCommit: (_to: readonly string[], _event: LiveEvent) => undefined };

/** The storage port in memory: what is stored, and every call in order (R-API-4: no adapter import). */
function recordingStorage() {
  const objects = new Map<string, { readonly body: Uint8Array; readonly contentType: string }>();
  const calls: { readonly operation: string; readonly args: readonly unknown[] }[] = [];
  return {
    calls,
    async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
      calls.push({ operation: 'put', args: [key] });
      objects.set(key, { body: Uint8Array.from(body), contentType });
    },
    async read(key: string): Promise<{ readonly body: Uint8Array; readonly contentType: string }> {
      calls.push({ operation: 'read', args: [key] });
      const object = objects.get(key);
      if (object === undefined) throw new Error('nothing is stored under this key');
      return object;
    },
    async remove(key: string): Promise<void> {
      calls.push({ operation: 'remove', args: [key] });
      objects.delete(key);
    },
    async exists(key: string): Promise<boolean> {
      return objects.has(key);
    },
    async temporaryLink(key: string, seconds: number): Promise<string> {
      return `https://files.invalid/${key}?expires=${String(seconds)}`;
    },
  };
}

let db: Db;
let database: Database;
let storage: ReturnType<typeof recordingStorage>;
let requests: IjazahRequestService;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  storage = recordingStorage();
  requests = createIjazahRequestService({
    database,
    storage,
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    log: { info: () => undefined, warn: () => undefined },
    // 005:T032 (rule d): the ijazah re-freeze is tests/db-integrity/ijazahs.spec.ts's.
    renders: { enqueue: async () => undefined },
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

interface World {
  readonly enrollmentId: string;
  readonly teacherId: string;
  readonly studentId: string;
  readonly subjectId: string;
  readonly credentialId: string;
  readonly adminId: string;
  readonly signatureKey: string;
}

/**
 * A committed world: an approved, active teacher with an approved credential (a two-generation
 * chain, no tariq) and a signature, a student, and a confirmed ijazah-track enrollment between them.
 */
async function world(certificateName: string | null = 'مريم بنت أحمد'): Promise<World> {
  const offer = await makeOffer(db);
  const adminId = await makeAdmin(db);
  const identityDocument = await insertRow(db, 'verification_documents', {
    user_id: offer.teacherId,
    document_type: 'national_id',
    storage_key_encrypted: Buffer.from('probe'),
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: offer.teacherId,
    bio: '',
    qualification_summary: 'إجازة في حفص',
    verification_status: 'approved',
    application_status: 'approved',
    application_submitted_at: '2026-10-18T09:00:00Z',
    identity_document_id: identityDocument,
    identity_document_type: 'national_id',
  });
  const studentId = await makeUser(db, { certificate_name: certificateName });
  await insertRow(db, 'user_roles', { user_id: studentId, role: 'student', status: 'active' });
  const enrollmentId = await insertRow(db, 'enrollments', {
    ...enrollmentValues(offer, studentId),
    status: 'confirmed',
    confirmed_at: '2026-10-04T08:00:00Z',
    snapshot_track: 'ijazah_track',
  });
  const credentialId = await makeCredential(db, {
    teacherId: offer.teacherId,
    subjectId: offer.subjectId,
    status: 'approved',
    admin: adminId,
  });
  await db.query(`UPDATE teacher_credentials SET holder_name = $2, riwaya = $3 WHERE id = $1`, [
    credentialId,
    'عمر بن فاروق',
    'حفص عن عاصم',
  ]);
  for (const [position, names] of [
    [1, ['رسول الله ﷺ']],
    [2, ['جبريل', 'أبي بن كعب']],
  ] as const) {
    await insertRow(db, 'isnad_entries', {
      credential_id: credentialId,
      position,
      names: [...names],
      created_by_admin_id: adminId,
    });
  }
  const signatureKey = `signatures/${offer.teacherId}/${randomUUID()}.png`;
  await storage.put(signatureKey, SIGNATURE, 'image/png');
  await insertRow(db, 'teacher_signatures', {
    teacher_user_id: offer.teacherId,
    storage_key: signatureKey,
  });
  return {
    enrollmentId,
    teacherId: offer.teacherId,
    studentId,
    subjectId: offer.subjectId,
    credentialId,
    adminId,
    signatureKey,
  };
}

const send = (w: World) =>
  requests.send(
    w.teacherId,
    {
      enrollmentId: w.enrollmentId,
      completionDate: '2026-11-01',
      language: 'ar',
      idempotencyKey: `probe-request-${randomUUID()}`,
    },
    live,
  );

/** 005:T019 (Q-T1): the certificate name's service over the real port of this file's requests. */
function namesService() {
  return createCertificateNameService({
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    log: { info: () => undefined },
    awaitingNameRelease: { release: (tx, studentUserId) => requests.release(tx, studentUserId) },
  });
}

/** 005:T019 (Q-T1): a request's list whose flush records what it publishes. */
function recordingList() {
  const published: LiveMessage[] = [];
  const list = new RequestLive(
    { publish: (message) => void published.push(message) },
    { warn: () => undefined },
  );
  return { list, published };
}

interface RequestRow {
  readonly status: string;
  readonly chain_snapshot: unknown;
  readonly teacher_name_printed: string;
  readonly riwaya_printed: string;
  readonly tariq_printed: string | null;
  readonly signature_storage_key: string | null;
  readonly subject_id: string;
  readonly student_user_id: string;
}

async function requestRow(id: string): Promise<RequestRow | undefined> {
  const { rows } = await db.query<RequestRow>(
    `SELECT status, chain_snapshot, teacher_name_printed, riwaya_printed, tariq_printed,
            signature_storage_key, subject_id, student_user_id
       FROM ijazah_requests WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof DomainError)) throw new Error(`expected a DomainError: ${String(error)}`);
  return error.details?.[0]?.code ?? error.code;
}

describe('send freezes the request (T006)', () => {
  it('writes the chain with the holder appended, the printed names and the copy', async () => {
    const w = await world();
    const { requestId, status } = await send(w);
    expect(status).toBe('pending');
    expect(await requestRow(requestId)).toEqual({
      status: 'pending',
      chain_snapshot: [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['عمر بن فاروق']],
      teacher_name_printed: 'عمر بن فاروق',
      riwaya_printed: 'حفص عن عاصم',
      tariq_printed: null,
      signature_storage_key: `ijazah-requests/${requestId}/signature.png`,
      subject_id: w.subjectId,
      student_user_id: w.studentId,
    });
    const copy = await storage.read(`ijazah-requests/${requestId}/signature.png`);
    expect(copy).toEqual({ body: SIGNATURE, contentType: 'image/png' });
  });

  it("waits for the student's name, then T004's release moves it to pending", async () => {
    const w = await world(null);
    const { requestId, status } = await send(w);
    expect(status).toBe('awaiting_student_name');
    // 005:T019 (Q-T1, rule d): the student's own set is handed the request's list.
    const { list, published } = recordingList();
    await namesService().setOwn(
      w.studentId,
      { name: 'مريم بنت أحمد', idempotencyKey: `probe-name-${randomUUID()}` },
      list,
    );
    expect((await requestRow(requestId))?.status).toBe('pending');
    // 005:T019 (Q-T1 (a)): the release's event to both parties, sent only once the list flushes.
    expect(published).toEqual([]);
    list.flush();
    expect(published).toEqual([
      {
        to: [w.teacherId, w.studentId],
        event: { type: 'ijazahRequest', enrollmentId: w.enrollmentId },
      },
    ]);
  });

  it("publishes the release on an administrator's change too, through the kind's list (005:T019, Q-T1)", async () => {
    const w = await world(null);
    await send(w);
    const { list, published } = recordingList();
    // As the administrator kind runs `users.setCertificateName` (surfaces/procedures.ts:715).
    await database.$transaction(async (tx) => {
      const unbind = bindToTransaction(tx, list);
      try {
        await namesService().setByAdministrator(tx, w.adminId, {
          targetUserId: w.studentId,
          name: 'مريم بنت أحمد',
          reason: 'طلب الطالبة تصحيح الاسم عبر الدعم',
          idempotencyKey: `probe-name-${randomUUID()}`,
        });
      } finally {
        unbind();
      }
    }, OPTIONS);
    list.flush();
    expect(published).toEqual([
      {
        to: [w.teacherId, w.studentId],
        event: { type: 'ijazahRequest', enrollmentId: w.enrollmentId },
      },
    ]);
  });

  it('refuses a second send request_open and writes nothing, its copy removed', async () => {
    const w = await world();
    await send(w);
    const before = await db.query(`SELECT id FROM ijazah_requests WHERE enrollment_id = $1`, [
      w.enrollmentId,
    ]);
    const callsBefore = storage.calls.length;
    expect(await codeOf(send(w))).toBe('request_open');
    const after = await db.query(`SELECT id FROM ijazah_requests WHERE enrollment_id = $1`, [
      w.enrollmentId,
    ]);
    expect(after.rows).toEqual(before.rows);
    // The refused send's copy was put, then removed (the stand-in keeps its recent calls).
    const calls = storage.calls.slice(callsBefore - storage.calls.length);
    const put = calls.find(({ operation }) => operation === 'put');
    const copyKey = put?.args[0];
    expect(typeof copyKey).toBe('string');
    expect(calls.map(({ operation }) => operation)).toEqual(['read', 'put', 'remove']);
    expect(await storage.exists(String(copyKey))).toBe(false);
  });

  it('refuses already_issued for an enrollment with an ijazah not revoked', async () => {
    const w = await world();
    await insertRow(db, 'ijazahs', {
      certificate_number: `probe-${randomUUID()}`,
      enrollment_id: w.enrollmentId,
      student_user_id: w.studentId,
      teacher_user_id: w.teacherId,
      subject_id: w.subjectId,
      mode: 'generated',
      language: 'ar',
      certificate_storage_key: `certificates/${randomUUID()}/0.pdf`,
      paper_copy_intended: false,
      verification_token_hash: `probe-${randomUUID()}`,
      granted_at: '2026-11-02T09:00:00Z',
      student_name_printed: 'مريم بنت أحمد',
      teacher_name_printed: 'عمر بن فاروق',
      riwaya_printed: 'حفص عن عاصم',
    });
    expect(await codeOf(send(w))).toBe('already_issued');
  });
});

describe("the credential's lock and the correction's re-freeze (T006, Q-A1 (a), Q-A4 (a))", () => {
  const corrections = () =>
    createCredentialReviewService({
      settings,
      openRequestsRefreeze: { refreeze: (tx, credentialId) => requests.refreeze(tx, credentialId) },
    });

  it("re-freezes the open request's chain, holder name, riwaya and tariq on the correction", async () => {
    const w = await world();
    const { requestId } = await send(w);
    await database.$transaction(
      (tx) =>
        corrections().correct(tx, w.adminId, {
          credentialId: w.credentialId,
          holderName: 'عمر بن فاروق الأنصاري',
          riwaya: 'ورش عن نافع',
          tariq: 'الأزرق',
          chain: [{ names: ['رسول الله ﷺ'] }, { names: ['جبريل'] }],
          reason: 'تصحيح النقل',
        }),
      OPTIONS,
    );
    expect(await requestRow(requestId)).toMatchObject({
      chain_snapshot: [['رسول الله ﷺ'], ['جبريل'], ['عمر بن فاروق الأنصاري']],
      teacher_name_printed: 'عمر بن فاروق الأنصاري',
      riwaya_printed: 'ورش عن نافع',
      tariq_printed: 'الأزرق',
    });
  });

  it('a send while a correction holds the credential waits, then freezes the corrected chain', async () => {
    const w = await world();
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const correction = database.$transaction(async (tx) => {
      await corrections().correct(tx, w.adminId, {
        credentialId: w.credentialId,
        holderName: 'عمر بن فاروق الأنصاري',
        reason: 'تصحيح الاسم',
      });
      holding();
      await released;
    }, OPTIONS);
    await held;
    const sending = send(w);
    await seenWaitingOnLock();
    release();
    await correction;
    const { requestId } = await sending;
    expect((await requestRow(requestId))?.teacher_name_printed).toBe('عمر بن فاروق الأنصاري');
  });
});

/** Resolves once some backend of the application role waits on a row lock; fails after ~5 s. */
async function seenWaitingOnLock(): Promise<void> {
  for (let look = 0; look < 250; look += 1) {
    const { rows } = await db.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database() AND usename = current_user`,
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('no backend waited on a lock');
}

describe("the student's deletion and the enrollment reads (T006, Q14 (a), Q4 (a))", () => {
  it('closes the open request, clears its key on the transaction, removes the file after the commit', async () => {
    const w = await world();
    const { requestId } = await send(w);
    const copyKey = `ijazah-requests/${requestId}/signature.png`;
    const list = new RequestLive({ publish: () => undefined }, { warn: () => undefined });
    await database.$transaction(async (tx) => {
      const unbind = bindToTransaction(tx, list);
      try {
        await requests.deletionConsequence()(tx, w.studentId, 'account_deleted');
      } finally {
        unbind();
      }
      expect(await storage.exists(copyKey)).toBe(true);
    }, OPTIONS);
    expect(await requestRow(requestId)).toMatchObject({
      status: 'closed',
      signature_storage_key: null,
    });
    expect(await storage.exists(copyKey)).toBe(true);
    list.flush();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await storage.exists(copyKey)).toBe(false);
    expect(await storage.exists(w.signatureKey)).toBe(true);
  });

  it("answers each enrollment's latest request in one read", async () => {
    // One after the other: the probe's client runs one query at a time.
    const first = await world();
    const second = await world();
    await send(first);
    const answer = await database.$transaction(
      (tx) => requests.of(tx, [first.enrollmentId, second.enrollmentId]),
      OPTIONS,
    );
    expect([...answer.entries()]).toEqual([[first.enrollmentId, { status: 'pending' }]]);
  });
});
