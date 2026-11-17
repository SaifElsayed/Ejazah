// T010 of specs/005-certification — an administrator's ijazahs, revocation and the bar over the real
// tables as the application role (FR-609, FR-610; research R-412; R-HONEST-6; ERD §15 rule 10; the
// note under T010, Q12 (a)):
//
// - Revoke writes `revoked_at`, `revoked_reason` and `revoked_by_admin_id` and keeps the row: it is
//   never deleted (the application role holds no DELETE on `ijazahs`) and never soft-deleted; the
//   administrator's list and get answer it `revoked`, never as valid; a second revocation under a
//   new key is refused `already_revoked` (final in v1.0), a replay writes nothing more; and the
//   restore path is open: the enrollment takes a new request (FR-IJAZAH-9).
// - Bar: one open bar per user under the user's `users` lock: two bars at once under two keys leave
//   one open row and refuse the other `already_barred` (`ijazah_bars` has no partial unique); a lift
//   keeps the row as history, and a second bar after it is a second row.
//
// The services are certification's factories over the real stores and the kernel's idempotency, on
// an in-memory storage port; each action runs on a transaction bound to an after-commit list, as the
// administrator kind binds its own. Each world is committed with accounts of its own; nothing is
// deleted.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LiveEvent } from '../../packages/contracts/src/index.js';
import {
  createIjazahDecisionService,
  createIjazahRequestService,
  createIjazahsService,
  type IjazahDecisionService,
  type IjazahRequestService,
  type IjazahsService,
  markRendered,
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
let ijazahs: IjazahsService;
/** 005:T032: every render enqueued, by ijazah and generation. */
const enqueued: [string, number][] = [];
const renders = {
  enqueue: async (ijazahId: string, generation: number) => {
    enqueued.push([ijazahId, generation]);
  },
};

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
  requests = createIjazahRequestService({ database, storage, idempotency, log, renders });
  decisions = createIjazahDecisionService({
    storage,
    settings,
    idempotency,
    renders: { enqueue: async () => undefined },
    log,
  });
  ijazahs = createIjazahsService({ storage, settings, idempotency, log, renders });
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
  readonly ijazahId: string;
  readonly certificateNumber: string;
  readonly credentialId: string;
}

/**
 * A committed world: an approved teacher with an approved credential and a signature, a named
 * student, a confirmed ijazah-track enrollment, its request sent (T006) and approved (T007).
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
  const studentId = await makeUser(db, { certificate_name: 'مريم بنت أحمد' });
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
  await insertRow(db, 'isnad_entries', {
    credential_id: credentialId,
    position: 1,
    names: ['رسول الله ﷺ'],
    created_by_admin_id: adminId,
  });
  const signatureKey = `signatures/${offer.teacherId}/${randomUUID()}.png`;
  await storage.put(signatureKey, SIGNATURE, 'image/png');
  await insertRow(db, 'teacher_signatures', {
    teacher_user_id: offer.teacherId,
    storage_key: signatureKey,
  });
  const { requestId } = await send(offer.teacherId, enrollmentId);
  const { answer } = await acted((tx) =>
    decisions.approve(tx, adminId, { requestId, idempotencyKey: `probe-approve-${randomUUID()}` }),
  );
  return {
    enrollmentId,
    teacherId: offer.teacherId,
    studentId,
    adminId,
    ijazahId: answer.answer.ijazahId,
    certificateNumber: answer.answer.certificateNumber,
    credentialId,
  };
}

const send = (teacherId: string, enrollmentId: string) =>
  requests.send(
    teacherId,
    {
      enrollmentId,
      completionDate: '2026-11-01',
      language: 'ar',
      idempotencyKey: `probe-request-${randomUUID()}`,
    },
    live,
  );

/** Runs an action on a committed transaction bound to its own after-commit list, as the kind does. */
async function acted<T>(work: (tx: Transaction) => Promise<T>): Promise<{
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

const revoke = (w: World, key = `probe-revoke-${randomUUID()}`) =>
  acted((tx) =>
    ijazahs.revoke(tx, w.adminId, {
      ijazahId: w.ijazahId,
      reason: 'خطأ في السند',
      idempotencyKey: key,
    }),
  );

const bar = (adminId: string, userId: string, key = `probe-bar-${randomUUID()}`) =>
  acted((tx) =>
    ijazahs.bar(tx, adminId, { targetUserId: userId, reason: 'تزوير', idempotencyKey: key }),
  );

const lift = (adminId: string, userId: string, key = `probe-lift-${randomUUID()}`) =>
  acted((tx) =>
    ijazahs.liftBar(tx, adminId, { targetUserId: userId, reason: 'خطأ', idempotencyKey: key }),
  );

async function ijazahRow(id: string) {
  const { rows } = await db.query<{
    revoked_at: Date | null;
    revoked_reason: string | null;
    revoked_by_admin_id: string | null;
    deleted_at: Date | null;
  }>(
    `SELECT revoked_at, revoked_reason, revoked_by_admin_id, deleted_at FROM ijazahs WHERE id = $1`,
    [id],
  );
  return rows;
}

/** The cursor naming the ijazah issued just before `id`, if any (ids are UUIDv7, in issue order). */
async function idBefore(id: string): Promise<{ cursor?: string }> {
  const { rows } = await db.query<{ id: string | null }>(
    `SELECT max(id::text) AS id FROM ijazahs WHERE id < $1::uuid`,
    [id],
  );
  const before = rows[0]?.id ?? null;
  return before === null ? {} : { cursor: before };
}

async function barsOf(userId: string) {
  const { rows } = await db.query<{
    reason: string;
    barred_by_admin_id: string;
    lifted_at: Date | null;
    lifted_by_admin_id: string | null;
  }>(
    `SELECT reason, barred_by_admin_id, lifted_at, lifted_by_admin_id
       FROM ijazah_bars WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  const error = await failureOf(call);
  if (!(error instanceof DomainError)) throw new Error(`expected a DomainError: ${String(error)}`);
  return error.details?.[0]?.code ?? error.code;
}

describe('ijazahs.revoke keeps the row and never shows it valid (T010, FR-609, R-HONEST-6)', () => {
  it('writes the revocation, keeps the row, and the list and get answer it `revoked`', async () => {
    const w = await world();
    const { answer } = await revoke(w);
    expect(answer).toEqual({ certificateNumber: w.certificateNumber, replayed: false });
    const [row, ...more] = await ijazahRow(w.ijazahId);
    expect(more).toEqual([]);
    expect(row?.revoked_at).toBeInstanceOf(Date);
    expect(row).toMatchObject({
      revoked_reason: 'خطأ في السند',
      revoked_by_admin_id: w.adminId,
      deleted_at: null,
    });
    // The database keeps every earlier run's ijazahs: the page is read from just before this one.
    const cursor = await idBefore(w.ijazahId);
    const listed = await acted((tx) =>
      ijazahs.list(tx, w.adminId, { status: 'revoked', ...cursor }),
    );
    expect(listed.answer.items[0]).toMatchObject({
      ijazahId: w.ijazahId,
      status: 'revoked',
      revoked: true,
    });
    for (const status of ['preparing', 'rendered', 'signed_off'] as const) {
      const other = await acted((tx) => ijazahs.list(tx, w.adminId, { status, ...cursor }));
      expect(other.answer.items.map(({ ijazahId }) => ijazahId)).not.toContain(w.ijazahId);
    }
    const { answer: detail } = await acted((tx) =>
      ijazahs.get(tx, w.adminId, { ijazahId: w.ijazahId }),
    );
    expect(detail).toMatchObject({
      status: 'revoked',
      revoked: true,
      revokedReason: 'خطأ في السند',
    });
  });

  it('the application role cannot delete an ijazah (ERD §15 rule 10)', async () => {
    const w = await world();
    await revoke(w);
    const error = await failureOf(db.query(`DELETE FROM ijazahs WHERE id = $1`, [w.ijazahId]));
    expect(error).toMatchObject({ code: '42501' });
    expect(await ijazahRow(w.ijazahId)).toHaveLength(1);
  });

  it('is final: a second key is refused `already_revoked`; a replay writes nothing more', async () => {
    const w = await world();
    const key = `probe-revoke-${randomUUID()}`;
    await revoke(w, key);
    const [first] = await ijazahRow(w.ijazahId);
    expect((await revoke(w, key)).answer.replayed).toBe(true);
    expect(await codeOf(revoke(w))).toBe('already_revoked');
    expect(await ijazahRow(w.ijazahId)).toEqual([first]);
  });

  it("the parties' request read says `revoked: true` after it, never its reason (Q-E2 (a))", async () => {
    const w = await world();
    const before = await database.$transaction((tx) => requests.of(tx, [w.enrollmentId]));
    expect(before.get(w.enrollmentId)).toEqual({ status: 'approved', ijazahId: w.ijazahId });
    await revoke(w);
    const after = await database.$transaction((tx) => requests.of(tx, [w.enrollmentId]));
    expect(after.get(w.enrollmentId)).toEqual({
      status: 'approved',
      ijazahId: w.ijazahId,
      revoked: true,
    });
    const { request } = await requests.get(w.teacherId, { enrollmentId: w.enrollmentId });
    expect(request).toMatchObject({ status: 'approved', ijazahId: w.ijazahId, revoked: true });
    expect(JSON.stringify(request)).not.toContain('خطأ في السند');
  });

  it('opens the restore path: the enrollment takes a new request (FR-IJAZAH-9)', async () => {
    const w = await world();
    expect(await codeOf(send(w.teacherId, w.enrollmentId))).toBe('already_issued');
    await revoke(w);
    const { status } = await send(w.teacherId, w.enrollmentId);
    expect(status).toBe('pending');
  });
});

/**
 * The sessions waiting, directly or behind another waiter, on the lock `holderPid` holds (lane C's
 * held-lock technique, `ijazah-decisions.spec.ts`): read from `pg_blocking_pids`, so a waiter queued
 * behind the first waiter of a row lock counts too.
 */
async function waitersOn(holderPid: number): Promise<number> {
  const { rows } = await db.query<{ pid: number; blockers: number[] }>(
    `SELECT pid, pg_blocking_pids(pid) AS blockers
       FROM pg_stat_activity
      WHERE cardinality(pg_blocking_pids(pid)) > 0`,
  );
  const chain = new Set([holderPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const { pid, blockers } of rows) {
      if (!chain.has(pid) && blockers.some((blocker) => chain.has(blocker))) {
        chain.add(pid);
        grew = true;
      }
    }
  }
  return chain.size - 1;
}

/** Polls until `count` sessions wait on `holderPid`, or fails after a bounded wait. */
async function untilWaiting(holderPid: number, count: number): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if ((await waitersOn(holderPid)) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`fewer than ${String(count)} sessions waited on the held lock within 10 s`);
}

describe('ijazahs.bar and .liftBar (T010, FR-610)', () => {
  // The review's ruling on lane E (2026-11-17): `ijazah_bars` has no partial unique, so one open bar
  // per user rests on the user's `users` lock alone. A second connection holds the user's row FOR
  // UPDATE; two bars under two keys start and both wait on it (each at its lock, or, with the lock
  // dropped, at its insert's foreign-key check after reading no open bar); the holder rolls back.
  // With the lock the second bar reads the first's row and is refused; without it both insert.
  it("two bars held at the user's row, then released, leave one open bar (`already_barred`)", async () => {
    const adminId = await makeAdmin(db);
    const userId = await makeUser(db);
    const holder = await connectAsApplication();
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const {
        rows: [held],
      } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const both = [bar(adminId, userId), bar(adminId, userId)];
      await untilWaiting(held!.pid, 2);
      await holder.query('ROLLBACK');
      outcomes = await Promise.allSettled(both);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    const open = (await barsOf(userId)).filter(({ lifted_at }) => lifted_at === null);
    expect(open).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(refused?.reason).toBeInstanceOf(DomainError);
    expect((refused?.reason as DomainError).code).toBe('CONFLICT');
    expect((refused?.reason as DomainError).details?.[0]?.code).toBe('already_barred');
  });

  it('two bars at once under two keys leave one open bar; the other is `already_barred`', async () => {
    const adminId = await makeAdmin(db);
    const userId = await makeUser(db);
    const outcomes = await Promise.allSettled([bar(adminId, userId), bar(adminId, userId)]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(refused?.reason).toBeInstanceOf(DomainError);
    expect((refused?.reason as DomainError).details?.[0]?.code).toBe('already_barred');
    expect(await barsOf(userId)).toEqual([
      { reason: 'تزوير', barred_by_admin_id: adminId, lifted_at: null, lifted_by_admin_id: null },
    ]);
  });

  it('a lift keeps the row; a bar after it is a second row, one open', async () => {
    const adminId = await makeAdmin(db);
    const userId = await makeUser(db);
    await bar(adminId, userId);
    expect(await codeOf(bar(adminId, userId))).toBe('already_barred');
    await lift(adminId, userId);
    expect(await codeOf(lift(adminId, userId))).toBe('not_barred');
    await bar(adminId, userId);
    const rows = await barsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.lifted_at).toBeInstanceOf(Date);
    expect(rows[0]?.lifted_by_admin_id).toBe(adminId);
    expect(rows[1]?.lifted_at).toBeNull();
  });

  it('a barred student is refused at send (FR-610)', async () => {
    const w = await world();
    await revoke(w);
    await bar(w.adminId, w.studentId);
    expect(await codeOf(send(w.teacherId, w.enrollmentId))).toBe('student_barred');
  });

  it('NOT_FOUND for an account that is not there', async () => {
    const adminId = await makeAdmin(db);
    expect(await codeOf(bar(adminId, randomUUID()))).toBe('NOT_FOUND');
  });
});

// 005:T032 (FR-629; R-402, R-403; SC-604; the note under T032, Q7 (a) with the review's amendment).
// The sign-off is the one write of `signed_off_at`; before it a re-render or a correction raises the
// generation, clears the rendering and enqueues the new generation after the commit, an older job
// writing nothing; after it nothing changes the certificate.

/**
 * Records generation `generation`'s PDF as the job does (lane B's mark), at a fixed instant before
 * any sign-off (rule 55: never signed off before the rendering).
 */
const rendered = (ijazahId: string, generation: number) =>
  database.$transaction((tx) =>
    markRendered(tx, {
      ijazahId,
      generation,
      storageKey: `certificates/${ijazahId}/${String(generation)}.pdf`,
      at: new Date('2026-11-01T00:00:00.000Z'),
    }),
  );

const signOff = (w: World, key = `probe-signoff-${randomUUID()}`) =>
  acted((tx) => ijazahs.signOff(tx, w.adminId, { ijazahId: w.ijazahId, idempotencyKey: key }));

const rerender = (w: World) =>
  acted((tx) =>
    ijazahs.rerender(tx, w.adminId, {
      ijazahId: w.ijazahId,
      reason: 'الخط',
      idempotencyKey: `probe-rerender-${randomUUID()}`,
    }),
  );

/** `credentials.correct`'s effect on the row, then the port on an administrator's transaction. */
async function corrected(w: World, holderName: string) {
  await db.query(`UPDATE teacher_credentials SET holder_name = $2 WHERE id = $1`, [
    w.credentialId,
    holderName,
  ]);
  return acted((tx) => requests.refreeze(tx, w.credentialId));
}

/** `users.setCertificateName`'s effect on the row, then the port on the same transaction. */
function renamed(w: World, name: string) {
  return acted(async (tx) => {
    await tx.$executeRaw`UPDATE users SET certificate_name = ${name} WHERE id = ${w.studentId}::uuid`;
    await requests.release(tx, w.studentId);
  });
}

async function printed(id: string) {
  const { rows } = await db.query<{
    chain_snapshot: string[][];
    teacher_name_printed: string;
    student_name_printed: string;
    render_generation: number;
    rendered_at: Date | null;
    signed_off_at: Date | null;
    signed_off_by_admin_id: string | null;
  }>(
    `SELECT chain_snapshot, teacher_name_printed, student_name_printed, render_generation,
            rendered_at, signed_off_at, signed_off_by_admin_id
       FROM ijazahs WHERE id = $1`,
    [id],
  );
  return rows[0];
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('ijazahs.signOff (T032, FR-629, DEC-72)', () => {
  it('is refused `not_rendered` before the rendering, then signs off once rendered', async () => {
    const w = await world();
    expect(await codeOf(signOff(w))).toBe('not_rendered');
    expect((await printed(w.ijazahId))?.signed_off_at).toBeNull();
    await rendered(w.ijazahId, 0);
    await signOff(w);
    const row = await printed(w.ijazahId);
    expect(row?.signed_off_at).toBeInstanceOf(Date);
    expect(row?.signed_off_by_admin_id).toBe(w.adminId);
    expect(await codeOf(signOff(w))).toBe('already_signed_off');
  });

  it('is refused `student_barred` while the student is barred, and signs off once lifted', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    await bar(w.adminId, w.studentId);
    expect(await codeOf(signOff(w))).toBe('student_barred');
    expect((await printed(w.ijazahId))?.signed_off_at).toBeNull();
    await lift(w.adminId, w.studentId);
    await signOff(w);
    expect((await printed(w.ijazahId))?.signed_off_at).toBeInstanceOf(Date);
  });

  it('is refused `revoked` after a revocation', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    await revoke(w);
    expect(await codeOf(signOff(w))).toBe('revoked');
  });
});

describe('ijazahs.rerender (T032, R-402)', () => {
  it("raises the generation after the commit; the older job's mark writes nothing", async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    const { list } = await rerender(w);
    expect(await printed(w.ijazahId)).toMatchObject({ render_generation: 1, rendered_at: null });
    expect(enqueued).not.toContainEqual([w.ijazahId, 1]);
    list.flush();
    await settle();
    expect(enqueued).toContainEqual([w.ijazahId, 1]);
    expect(await rendered(w.ijazahId, 0)).toMatchObject({ outcome: 'stale_generation' });
    expect((await printed(w.ijazahId))?.rendered_at).toBeNull();
    expect(await rendered(w.ijazahId, 1)).toMatchObject({ outcome: 'written' });
  });

  it('is refused once signed off', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    await signOff(w);
    expect(await codeOf(rerender(w))).toBe('already_signed_off');
  });
});

describe("the ports' re-freeze of an ijazah (T032, R-403, SC-604)", () => {
  it('a correction before the sign-off re-freezes the snapshot and re-renders after the commit', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    const { list } = await corrected(w, 'عمر بن الفاروق');
    const row = await printed(w.ijazahId);
    expect(row).toMatchObject({
      teacher_name_printed: 'عمر بن الفاروق',
      render_generation: 1,
      rendered_at: null,
    });
    expect(row?.chain_snapshot.at(-1)).toEqual(['عمر بن الفاروق']);
    expect(enqueued).not.toContainEqual([w.ijazahId, 1]);
    list.flush();
    await settle();
    expect(enqueued).toContainEqual([w.ijazahId, 1]);
  });

  it("a certificate-name change before the sign-off re-freezes the student's printed name", async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    const { list } = await renamed(w, 'مريم بنت أحمد علي');
    expect(await printed(w.ijazahId)).toMatchObject({
      student_name_printed: 'مريم بنت أحمد علي',
      render_generation: 1,
      rendered_at: null,
    });
    expect(enqueued).not.toContainEqual([w.ijazahId, 1]);
    list.flush();
    await settle();
    expect(enqueued).toContainEqual([w.ijazahId, 1]);
  });

  it('after the sign-off a correction and a name change change nothing (SC-604)', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    await signOff(w);
    const before = await printed(w.ijazahId);
    const first = await corrected(w, 'اسم آخر');
    const second = await renamed(w, 'اسم آخر للطالبة');
    first.list.flush();
    second.list.flush();
    await settle();
    expect(await printed(w.ijazahId)).toEqual(before);
    expect(enqueued.filter(([id]) => id === w.ijazahId)).toEqual([]);
  });

  it('a revoked ijazah is never re-frozen', async () => {
    const w = await world();
    await revoke(w);
    const before = await printed(w.ijazahId);
    await corrected(w, 'اسم آخر');
    await renamed(w, 'اسم آخر للطالبة');
    expect(await printed(w.ijazahId)).toEqual(before);
  });
});
