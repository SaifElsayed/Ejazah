// T007 of specs/005-certification — the administrators' review over the real tables as the
// application role (FR-604, FR-605, FR-610; research R-402; ADR 0013; the note under T007, Q7 (a),
// Q15 (a); specs/004-sessions/contracts/kernel.md, the ijazah request's row):
//
// - Approve writes one `ijazahs` row: a 16-symbol number, the token's SHA-256 only, `mode`
//   `generated`, `paper_copy_intended` false, the frozen chain, names, riwaya and tariq, the
//   student's certificate name, the request's completion date (never NULL: the render job refuses
//   an ijazah without one) and generation 0's reserved key; the request `approved`. A replay of
//   one key and a concurrent approval under another key each leave one ijazah. A barred student is
//   refused `student_barred` and nothing is written. The render is enqueued only once the
//   approval has committed.
// - Reject writes the reason, clears the copy's key on the transaction and removes its file only
//   after the commit.
// - `EnrollmentIjazahRequests.of`'s approved branch (lane A's follow-up candidate): the request's
//   ijazah id from the real store.
//
// The services are certification's factories over the real stores and the kernel's idempotency,
// on an in-memory storage port; each decision runs on a transaction bound to an after-commit list,
// as the administrator kind binds its own. Each world is committed with accounts of its own;
// nothing is deleted.
//
// Observed red: every case against the service stub; the completion date against the mutant «no
// `completionDate` in `insertIjazah`», the copy's key against «`signatureStorageKey: null` dropped
// from `markRejected`» (lane C's red table).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LiveEvent } from '../../packages/contracts/src/index.js';
import {
  createIjazahDecisionService,
  createIjazahRequestService,
  type IjazahDecisionService,
  type IjazahRequestService,
} from '../../apps/api/src/modules/certification/index';
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
const OPTIONS = { maxWait: 5_000, timeout: 20_000 };
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const STUDENT_NAME = 'مريم بنت أحمد';
const live = { afterCommit: (_to: readonly string[], _event: LiveEvent) => undefined };

/** The storage port in memory (R-API-4: no adapter import). */
function memoryStorage() {
  const objects = new Map<string, { readonly body: Uint8Array; readonly contentType: string }>();
  return {
    async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
      objects.set(key, { body: Uint8Array.from(body), contentType });
    },
    async read(key: string): Promise<{ readonly body: Uint8Array; readonly contentType: string }> {
      const object = objects.get(key);
      if (object === undefined) throw new Error('nothing is stored under this key');
      return object;
    },
    async remove(key: string): Promise<void> {
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
let storage: ReturnType<typeof memoryStorage>;
let requests: IjazahRequestService;
let decisions: IjazahDecisionService;
const enqueued: [string, number][] = [];

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 6,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  storage = memoryStorage();
  const idempotency = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings,
  });
  const log = { info: () => undefined, warn: () => undefined };
  // 005:T032 (rule d): the ijazah re-freeze is tests/db-integrity/ijazahs.spec.ts's.
  requests = createIjazahRequestService({
    database,
    storage,
    idempotency,
    log,
    renders: { enqueue: async () => undefined },
  });
  decisions = createIjazahDecisionService({
    storage,
    settings,
    idempotency,
    renders: {
      enqueue: async (ijazahId, generation) => {
        enqueued.push([ijazahId, generation]);
      },
    },
    log,
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
  readonly adminId: string;
  readonly requestId: string;
  readonly offer: Awaited<ReturnType<typeof makeOffer>>;
}

/**
 * A committed world: an approved teacher with an approved credential (two generations, no tariq)
 * and a signature, a named student, a confirmed ijazah-track enrollment and its pending request,
 * sent through T006's service.
 */
async function world(): Promise<World> {
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
  const studentId = await makeUser(db, { certificate_name: STUDENT_NAME });
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
  const { requestId, status } = await requests.send(
    offer.teacherId,
    {
      enrollmentId,
      completionDate: '2026-11-01',
      language: 'ar',
      idempotencyKey: `probe-request-${randomUUID()}`,
    },
    live,
  );
  expect(status).toBe('pending');
  return { enrollmentId, teacherId: offer.teacherId, studentId, adminId, requestId, offer };
}

/** Runs a decision on a committed transaction bound to its own after-commit list, as the kind does. */
async function decided<T>(work: (tx: Transaction) => Promise<T>): Promise<{
  readonly answer: T;
  readonly list: RequestLive;
}> {
  const list = new RequestLive({ publish: () => undefined }, { warn: () => undefined });
  const answer = await database.$transaction(async (tx) => {
    const unbind = bindToTransaction(tx, list);
    try {
      return await work(tx);
    } finally {
      unbind();
    }
  }, OPTIONS);
  return { answer, list };
}

const approve = (w: World, key = `probe-decision-${randomUUID()}`) =>
  decided((tx) =>
    decisions.approve(tx, w.adminId, { requestId: w.requestId, idempotencyKey: key }),
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

interface IjazahRow {
  readonly id: string;
  readonly certificate_number: string;
  readonly mode: string;
  readonly paper_copy_intended: boolean;
  readonly verification_token_hash: string;
  readonly certificate_storage_key: string;
  readonly chain_snapshot: unknown;
  readonly student_name_printed: string;
  readonly teacher_name_printed: string;
  readonly riwaya_printed: string;
  readonly tariq_printed: string | null;
  readonly completion_date: string | null;
  readonly issued_by_admin_id: string;
  readonly rendered_at: Date | null;
  readonly render_generation: number;
}

async function ijazahsOf(requestId: string): Promise<IjazahRow[]> {
  const { rows } = await db.query<IjazahRow>(
    `SELECT id, certificate_number, mode, paper_copy_intended, verification_token_hash,
            certificate_storage_key, chain_snapshot, student_name_printed, teacher_name_printed,
            riwaya_printed, tariq_printed, to_char(completion_date, 'YYYY-MM-DD') AS completion_date,
            issued_by_admin_id, rendered_at, render_generation
       FROM ijazahs WHERE request_id = $1`,
    [requestId],
  );
  return rows;
}

async function requestRow(id: string) {
  const { rows } = await db.query<{
    status: string;
    reason: string | null;
    decided_by_admin_id: string | null;
    decided_at: Date | null;
    signature_storage_key: string | null;
  }>(
    `SELECT status, reason, decided_by_admin_id, decided_at, signature_storage_key
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

describe('approve issues one ijazah (T007, FR-605, R-402)', () => {
  it('writes the ijazah from the frozen request, its completion date never NULL', async () => {
    const w = await world();
    const { answer } = await approve(w);
    const [row, ...more] = await ijazahsOf(w.requestId);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      id: answer.answer.ijazahId,
      certificate_number: answer.answer.certificateNumber,
      mode: 'generated',
      paper_copy_intended: false,
      certificate_storage_key: `certificates/${answer.answer.ijazahId}/0.pdf`,
      chain_snapshot: [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['عمر بن فاروق']],
      student_name_printed: STUDENT_NAME,
      teacher_name_printed: 'عمر بن فاروق',
      riwaya_printed: 'حفص عن عاصم',
      tariq_printed: null,
      completion_date: '2026-11-01',
      issued_by_admin_id: w.adminId,
      rendered_at: null,
      render_generation: 0,
    });
    expect(row?.certificate_number).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    // The token's SHA-256 in lower-case hex, never the 43-character base64url token itself.
    expect(row?.verification_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await requestRow(w.requestId)).toMatchObject({
      status: 'approved',
      decided_by_admin_id: w.adminId,
    });
  });

  it('writes one ijazah under a replay of one key', async () => {
    const w = await world();
    const key = `probe-decision-${randomUUID()}`;
    const first = await approve(w, key);
    const again = await approve(w, key);
    expect(again.answer).toEqual({ answer: first.answer.answer, replayed: true });
    expect(await ijazahsOf(w.requestId)).toHaveLength(1);
  });

  it('writes one ijazah when two administrators approve at once under two keys', async () => {
    const w = await world();
    const outcomes = await Promise.allSettled([approve(w), approve(w)]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
    expect(await codeOf(Promise.reject(refused.reason))).toBe('not_pending');
    expect(await ijazahsOf(w.requestId)).toHaveLength(1);
  });

  it("refuses student_barred while the student's bar is not lifted, writing nothing (FR-610)", async () => {
    const w = await world();
    await insertRow(db, 'ijazah_bars', {
      user_id: w.studentId,
      reason: 'probe',
      barred_by_admin_id: w.adminId,
      barred_at: '2026-11-17T08:00:00Z',
    });
    expect(await codeOf(approve(w))).toBe('student_barred');
    expect(await ijazahsOf(w.requestId)).toEqual([]);
    expect((await requestRow(w.requestId))?.status).toBe('pending');
  });

  it('enqueues the render of generation 0 only once the approval has committed', async () => {
    const w = await world();
    const { answer, list } = await approve(w);
    await settle();
    expect(enqueued).not.toContainEqual([answer.answer.ijazahId, 0]);
    list.flush();
    await settle();
    expect(enqueued).toContainEqual([answer.answer.ijazahId, 0]);
  });

  it("answers the enrollment's request approved with its ijazah (EnrollmentIjazahRequests.of)", async () => {
    const w = await world();
    const { answer } = await approve(w);
    const read = await database.$transaction((tx) => requests.of(tx, [w.enrollmentId]), OPTIONS);
    expect([...read.entries()]).toEqual([
      [w.enrollmentId, { status: 'approved', ijazahId: answer.answer.ijazahId }],
    ]);
  });

  // The review's MAJOR on lane C (2026-11-17): the ijazah's insert takes FOR KEY SHARE on the
  // teacher's `users` row (its FK), so an approval holding the student alone deadlocks with a send
  // that holds the teacher FOR UPDATE and waits for the student (send locks both, id order,
  // ijazah-request.service.ts). The world's teacher is written before its student on one
  // connection, so its UUIDv7 sorts first (asserted). A second connection holds E1's request row
  // so the approval stops between its account lock and its insert, while the send of E2 takes its
  // accounts; once released, the approval inserts. Locking both parties in one call, id order, the
  // two serialise on the teacher; locking the student alone, one dies of 40P01.
  it('an approval of E1 and a send of E2 between the same parties never deadlock', async () => {
    const w = await world();
    expect(w.teacherId < w.studentId).toBe(true);
    const slotId = await insertRow(db, 'availability_slots', {
      teacher_user_id: w.teacherId,
      day_of_week: 3,
      start_time_local: '11:00:00',
      duration_minutes: 60,
      timezone: 'Africa/Cairo',
      is_active: true,
    });
    const secondEnrollment = await insertRow(db, 'enrollments', {
      ...enrollmentValues(w.offer, w.studentId),
      slot_id: slotId,
      status: 'confirmed',
      confirmed_at: '2026-10-04T08:00:00Z',
      snapshot_track: 'ijazah_track',
    });
    const holder = await connectAsApplication();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM ijazah_requests WHERE id = $1 FOR UPDATE', [w.requestId]);
      const approval = approve(w);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const sending = requests.send(
        w.teacherId,
        {
          enrollmentId: secondEnrollment,
          completionDate: '2026-11-01',
          language: 'ar',
          idempotencyKey: `probe-request-${randomUUID()}`,
        },
        live,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await holder.query('COMMIT');
      const outcomes = await Promise.allSettled([approval, sending]);
      expect(
        outcomes.map((outcome) =>
          outcome.status === 'fulfilled' ? 'fulfilled' : String(outcome.reason),
        ),
      ).toEqual(['fulfilled', 'fulfilled']);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    expect(await ijazahsOf(w.requestId)).toHaveLength(1);
  });
});

describe('reject (T007, FR-604, Q14 (a))', () => {
  it('writes the reason, clears the key on the transaction, removes the file after the commit', async () => {
    const w = await world();
    const copyKey = `ijazah-requests/${w.requestId}/signature.png`;
    expect(await storage.exists(copyKey)).toBe(true);
    const { list } = await decided((tx) =>
      decisions.reject(tx, w.adminId, {
        requestId: w.requestId,
        reason: 'السند لا يطابق',
        idempotencyKey: `probe-decision-${randomUUID()}`,
      }),
    );
    expect(await requestRow(w.requestId)).toMatchObject({
      status: 'rejected',
      reason: 'السند لا يطابق',
      decided_by_admin_id: w.adminId,
      signature_storage_key: null,
    });
    expect(await storage.exists(copyKey)).toBe(true);
    list.flush();
    await settle();
    expect(await storage.exists(copyKey)).toBe(false);
  });

  it('refuses a decided request not_pending', async () => {
    const w = await world();
    await approve(w);
    expect(
      await codeOf(
        decided((tx) =>
          decisions.reject(tx, w.adminId, {
            requestId: w.requestId,
            reason: 'سبب',
            idempotencyKey: `probe-decision-${randomUUID()}`,
          }),
        ),
      ),
    ).toBe('not_pending');
    expect(await ijazahsOf(w.requestId)).toHaveLength(1);
  });

  it('decides once when an approval and a rejection meet on the request lock', async () => {
    const w = await world();
    const outcomes = await Promise.allSettled([
      approve(w),
      decided((tx) =>
        decisions.reject(tx, w.adminId, {
          requestId: w.requestId,
          reason: 'سبب',
          idempotencyKey: `probe-decision-${randomUUID()}`,
        }),
      ),
    ]);
    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(refused).toHaveLength(1);
    expect(await codeOf(Promise.reject(refused[0]?.reason))).toBe('not_pending');
    const { status } = (await requestRow(w.requestId)) ?? {};
    expect(await ijazahsOf(w.requestId)).toHaveLength(status === 'approved' ? 1 : 0);
  });
});
