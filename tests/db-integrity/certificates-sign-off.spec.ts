// 005:T009 with T010 and T032 — the parties’ certificate link across the sign-off and the revocation
// (FR-607, FR-609, FR-629; R-HONEST-6, SC-604): the integration’s spec after lanes D and E merged
// (B46, the owner’s Q-E3 (a) with the review session’s ruling, 2026-11-17). Over the real tables as
// the application role: `certificates.link` answers `not_ready` to both parties while the ijazah is
// rendered but not signed off, a signed link once `ijazahs.signOff` committed, and `revoked` with no
// link once `ijazahs.revoke` committed; `certificates.list` agrees with each state. The world is
// built as `ijazahs.spec.ts` builds it (its helpers are copied here, R-API-4 keeps specs apart).
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LiveEvent } from '../../packages/contracts/src/index.js';
import {
  type CertificatesService,
  createCertificatesService,
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
let certificates: CertificatesService;
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
  certificates = createCertificatesService({ database, storage, settings, log });
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

/** The parties' answer to `certificates.link`: the link, or the CONFLICT's code. */
async function linkFor(userId: string, ijazahId: string): Promise<string> {
  const outcome = await certificates.link(userId, { ijazahId }).then(
    ({ link }) => link,
    (caught: unknown) => caught,
  );
  if (typeof outcome === 'string') return outcome;
  if (!(outcome instanceof DomainError))
    throw new Error(`expected a DomainError: ${String(outcome)}`);
  return `refused:${outcome.details?.[0]?.code ?? outcome.code}`;
}

async function listed(userId: string, ijazahId: string) {
  const { items } = await certificates.list(userId);
  return items.find((item) => item.ijazahId === ijazahId);
}

describe("the parties' certificate across the sign-off and the revocation (Q-E3, R-HONEST-6)", () => {
  it('answers `not_ready` to both parties until the sign-off, then a signed link to each', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    for (const party of [w.studentId, w.teacherId]) {
      expect(await linkFor(party, w.ijazahId)).toBe('refused:not_ready');
      expect(await listed(party, w.ijazahId)).toMatchObject({ ready: false, revoked: false });
    }
    await signOff(w);
    for (const party of [w.studentId, w.teacherId]) {
      expect(await linkFor(party, w.ijazahId)).toContain(`certificates/${w.ijazahId}/0.pdf`);
      expect(await listed(party, w.ijazahId)).toMatchObject({ ready: true, revoked: false });
    }
  });

  it('answers `revoked` with no link once revoked, though it was signed off', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    await signOff(w);
    await revoke(w);
    for (const party of [w.studentId, w.teacherId]) {
      expect(await linkFor(party, w.ijazahId)).toBe('refused:revoked');
      expect(await listed(party, w.ijazahId)).toMatchObject({ ready: false, revoked: true });
    }
  });

  it('answers `revoked`, never `not_ready`, for one revoked before its sign-off', async () => {
    const w = await world();
    await rendered(w.ijazahId, 0);
    await revoke(w);
    expect(await linkFor(w.studentId, w.ijazahId)).toBe('refused:revoked');
    expect(await codeOf(signOff(w))).toBe('revoked');
  });
});
