// T069 — the credential review's queries over the real tables (`credential-review.repository.ts`,
// reached through the catalog module's entry as `credentialReviewStore`;
// FR-163, FR-164, rule 23, rule 28, R-DB-3; a banned account's left out of the queue, T122). The parents a credential needs (a person, a subject, an
// administrator, the PDF's document) and the credentials themselves are committed first, as every
// probe here writes them; each probe then runs the repository on one transaction it rolls back. The
// queue is a whole table other probes fill while this one runs, so each probe names its teacher with
// a token of its own and searches by it.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCredentialReviewService,
  credentialReviewStore,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeAdmin,
  makeCredential,
  makeSubject,
  makeUser,
} from './harness';

const store = credentialReviewStore;

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    // T174: two raced transactions, and a third connection for the reads between them.
    poolMax: 3,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db.end();
  await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
async function rolledBack<T>(probe: (tx: Transaction) => Promise<T>): Promise<T> {
  let answer: { readonly value: T } | undefined;
  try {
    await database.$transaction(async (tx) => {
      answer = { value: await probe(tx) };
      throw ROLLED_BACK;
    });
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
  if (answer === undefined) throw new Error('the probe answered nothing');
  return answer.value;
}

/** A committed teacher named `displayName` and a committed subject. */
async function teacherAndSubject(displayName: string) {
  return {
    teacherId: await makeUser(db, { display_name: displayName }),
    subjectId: await makeSubject(db),
  };
}

const CHAIN = [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['زر بن حبيش']] as const;

function approval(credentialId: string, adminId: string) {
  return {
    credentialId,
    holderName: 'عمر بن فاروق',
    riwaya: 'حفص عن عاصم',
    tariq: null,
    chain: CHAIN,
    adminId,
    at: new Date('2026-10-22T10:00:00Z'),
  };
}

describe('the queue', () => {
  it("lists a tab by the teacher's name, `%` as itself and in any case", async () => {
    const token = randomUUID().slice(0, 8);
    const percent = await teacherAndSubject(`Omar ${token} 50%`);
    const digits = await teacherAndSubject(`omar ${token} 500`);
    const first = await makeCredential(db, { ...percent });
    await makeCredential(db, { ...digits });
    await makeCredential(db, { ...percent, status: 'rejected' });
    const [rows, count] = await rolledBack(
      async (tx) =>
        [
          await store.page(tx, { status: 'pending', search: `OMAR ${token} 50%` }, 0, 10),
          await store.count(tx, { status: 'pending', search: `OMAR ${token} 50%` }),
        ] as const,
    );
    expect(count).toBe(1);
    expect(rows.map((row) => row.id)).toEqual([first]);
    expect(rows[0]).toMatchObject({
      teacher: { userId: percent.teacherId, displayName: `Omar ${token} 50%` },
      subject: { id: percent.subjectId },
      submittedWithApplication: true,
      status: 'pending',
    });
  });

  it("leaves out a soft-deleted teacher's credentials (R-DB-3)", async () => {
    const token = randomUUID().slice(0, 8);
    const gone = await teacherAndSubject(`gone ${token}`);
    const credentialId = await makeCredential(db, { ...gone });
    await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [gone.teacherId]);
    const [count, record] = await rolledBack(
      async (tx) =>
        [
          await store.count(tx, { status: 'pending', search: `gone ${token}` }),
          await store.read(tx, credentialId),
        ] as const,
    );
    expect(count).toBe(0);
    expect(record).toBeNull();
  });
});

describe("a banned account's credentials (T122)", () => {
  it('leaves them out of the queue and its count, and writes nothing on them', async () => {
    const token = randomUUID().slice(0, 8);
    const banned = await teacherAndSubject(`banned ${token}`);
    const credentialId = await makeCredential(db, { ...banned });
    await db.query("UPDATE users SET account_status = 'banned' WHERE id = $1", [banned.teacherId]);
    const [rows, count, record] = await rolledBack(
      async (tx) =>
        [
          await store.page(tx, { status: 'pending', search: `banned ${token}` }, 0, 10),
          await store.count(tx, { status: 'pending', search: `banned ${token}` }),
          await tx.teacherCredential.findUnique({
            where: { id: credentialId },
            select: { status: true },
          }),
        ] as const,
    );
    expect([rows, count]).toEqual([[], 0]);
    expect(record).toEqual({ status: 'pending' });
  });
});

describe('approval', () => {
  it('approves a pending credential and writes its chain origin first, with its reviewer', async () => {
    const parents = await teacherAndSubject('probe teacher');
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...parents });
    const [outcome, record, page] = await rolledBack(async (tx) => [
      await store.approve(tx, approval(credentialId, adminId)),
      await store.read(tx, credentialId),
      await store.page(tx, { status: 'approved', search: 'probe teacher' }, 0, 50),
    ]);
    expect(outcome).toBe('approved');
    // The decided tab's row carries its review's moment (the «وُثّقت» column; B14c).
    expect(page.find((row) => row.id === credentialId)?.reviewedAt).toBeInstanceOf(Date);
    expect(record).toMatchObject({
      status: 'approved',
      holderName: 'عمر بن فاروق',
      riwaya: 'حفص عن عاصم',
      tariq: null,
      reviewReason: null,
      reviewedByName: 'Probe administrator',
      chain: [
        { position: 1, names: ['رسول الله ﷺ'] },
        { position: 2, names: ['جبريل', 'أبي بن كعب'] },
        { position: 3, names: ['زر بن حبيش'] },
      ],
    });
  });

  it('answers moved for a credential no longer pending, writing nothing', async () => {
    const parents = await teacherAndSubject('probe teacher');
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...parents, status: 'rejected' });
    const [outcome, record] = await rolledBack(async (tx) => [
      await store.approve(tx, approval(credentialId, adminId)),
      await store.read(tx, credentialId),
    ]);
    expect(outcome).toBe('moved');
    expect(record).toMatchObject({ status: 'rejected', chain: [] });
  });

  it("answers taken when rule 23's partial unique refuses a second approved credential", async () => {
    const parents = await teacherAndSubject('probe teacher');
    const adminId = await makeAdmin(db);
    await makeCredential(db, { ...parents, status: 'approved', admin: adminId });
    const second = await makeCredential(db, { ...parents });
    const outcome = await rolledBack((tx) => store.approve(tx, approval(second, adminId)));
    expect(outcome).toBe('taken');
  });
});

describe('decisions and corrections', () => {
  it('moves a credential only from the states the decision names', async () => {
    const parents = await teacherAndSubject('probe teacher');
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...parents });
    const decision = {
      credentialId,
      reason: 'الصفحة الأخيرة ناقصة',
      adminId,
      at: new Date('2026-10-22T10:00:00Z'),
    };
    const [requested, again, record] = await rolledBack(async (tx) => [
      await store.decide(tx, { ...decision, from: ['pending'], to: 'needs_document' }),
      await store.decide(tx, { ...decision, from: ['pending'], to: 'needs_document' }),
      await store.read(tx, credentialId),
    ]);
    expect([requested, again]).toEqual([true, false]);
    expect(record).toMatchObject({
      status: 'needs_document',
      reviewReason: 'الصفحة الأخيرة ناقصة',
      reviewedByName: 'Probe administrator',
    });
  });

  it("replaces an approved credential's chain and fields, and refuses one not approved", async () => {
    const parents = await teacherAndSubject('probe teacher');
    const adminId = await makeAdmin(db);
    const approved = await makeCredential(db, { ...parents });
    const pending = await makeCredential(db, { ...(await teacherAndSubject('probe teacher')) });
    const correction = {
      holderName: 'عمر بن فاروق الأنصاري',
      riwaya: 'حفص عن عاصم',
      tariq: 'الشاطبية',
      chain: [['رسول الله ﷺ'], ['جبريل']],
      adminId,
    };
    const [corrected, refused, record] = await rolledBack(async (tx) => {
      await store.approve(tx, approval(approved, adminId));
      return [
        await store.correct(tx, { credentialId: approved, ...correction }),
        await store.correct(tx, { credentialId: pending, ...correction }),
        await store.read(tx, approved),
      ] as const;
    });
    expect([corrected, refused]).toEqual([true, false]);
    expect(record).toMatchObject({
      holderName: 'عمر بن فاروق الأنصاري',
      tariq: 'الشاطبية',
      chain: [
        { position: 1, names: ['رسول الله ﷺ'] },
        { position: 2, names: ['جبريل'] },
      ],
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T174 (R1a; SRS DEC-97; ERD `teacher_credential_history`; the note under T174, (4)): each decision
// on a credential writes one history row in its transaction, through the service as the admin
// module composes it. A race spec per insert path: two decisions on one credential at once, each in
// its own committed transaction, both begun before either writes; one wins and one row is written.
// Two corrections at once both land, the second reading, under the credential's lock, the
// transcription the first left: its `before` is the first one's `after`. A request for another
// document that moves the application writes the credential's row only, none in the application's.
describe('the history: one row per decision, raced (T174)', () => {
  const review = createCredentialReviewService({
    settings: { read: async (_key, schema) => schema.parse(50) },
    // 005:T006: the correction's re-freeze, which this probe does not assert.
    openRequestsRefreeze: { refreeze: async () => undefined },
  });

  function barrier(parties: number): () => Promise<void> {
    let waiting = 0;
    let release: () => void = () => undefined;
    const all = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      waiting += 1;
      if (waiting === parties) release();
      return all;
    };
  }

  /** Each call on its own committed transaction, all begun before any of them runs. */
  async function raced(calls: readonly ((tx: Transaction) => Promise<unknown>)[]) {
    const meet = barrier(calls.length);
    return Promise.allSettled(
      calls.map((call) =>
        database.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1`;
            await meet();
            return call(tx);
          },
          { timeout: 30_000 },
        ),
      ),
    );
  }

  const codesOf = (outcomes: readonly PromiseSettledResult<unknown>[]) =>
    outcomes
      .map((outcome) =>
        outcome.status === 'fulfilled' ? 'ok' : String((outcome.reason as { code?: unknown }).code),
      )
      .sort();

  async function historyOf(credentialId: string) {
    const { rows } = await db.query<{
      action: string;
      note: string | null;
      before: unknown;
      after: unknown;
    }>(
      `SELECT action, note, before, after FROM teacher_credential_history
        WHERE credential_id = $1 ORDER BY created_at, id`,
      [credentialId],
    );
    return rows;
  }

  const TRANSCRIPTION = {
    holderName: 'عمر بن فاروق',
    riwaya: 'حفص عن عاصم',
    chain: [{ names: ['رسول الله ﷺ'] }, { names: ['جبريل'] }],
  };

  it('two approvals at once: one wins, one CONFLICT, one row', async () => {
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...(await teacherAndSubject('race')) });
    const outcomes = await raced([
      (tx) => review.approve(tx, adminId, { credentialId, ...TRANSCRIPTION }),
      (tx) => review.approve(tx, adminId, { credentialId, ...TRANSCRIPTION, note: 'ثانٍ' }),
    ]);
    expect(codesOf(outcomes)).toEqual(['CONFLICT', 'ok']);
    expect((await historyOf(credentialId)).map(({ action }) => action)).toEqual(['approve']);
  });

  it.each([
    ['two rejections', 'reject', 'reject'],
    ['two requests for a document', 'requestDocument', 'requestDocument'],
  ] as const)('%s at once: one wins, one CONFLICT, one row', async (_case, first, second) => {
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...(await teacherAndSubject('race')) });
    const outcomes = await raced([
      (tx) => review[first](tx, adminId, { credentialId, reason: 'السبب الأول' }),
      (tx) => review[second](tx, adminId, { credentialId, reason: 'السبب الثاني' }),
    ]);
    expect(codesOf(outcomes)).toEqual(['CONFLICT', 'ok']);
    expect(await historyOf(credentialId)).toHaveLength(1);
  });

  // Both orders are decisions in sequence once each waits on the account (Q-A2-1): a rejection first
  // leaves the request CONFLICT; a request first leaves the credential waiting, which a rejection
  // may still end, so both land, in that order. One row per decision that landed, either way.
  it('a rejection and a request for a document at once: one row per decision that landed, in its order', async () => {
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...(await teacherAndSubject('race')) });
    const outcomes = await raced([
      (tx) => review.reject(tx, adminId, { credentialId, reason: 'السبب الأول' }),
      (tx) => review.requestDocument(tx, adminId, { credentialId, reason: 'السبب الثاني' }),
    ]);
    const actions = (await historyOf(credentialId)).map(({ action }) => action);
    if (codesOf(outcomes).includes('CONFLICT')) {
      expect(codesOf(outcomes)).toEqual(['CONFLICT', 'ok']);
      expect(actions).toEqual(['reject']);
    } else {
      expect(actions).toEqual(['request_document', 'reject']);
    }
  });

  it('an approval and a rejection at once: one wins, one CONFLICT, one row', async () => {
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...(await teacherAndSubject('race')) });
    const outcomes = await raced([
      (tx) => review.approve(tx, adminId, { credentialId, ...TRANSCRIPTION }),
      (tx) => review.reject(tx, adminId, { credentialId, reason: 'الختم غير واضح' }),
    ]);
    expect(codesOf(outcomes)).toEqual(['CONFLICT', 'ok']);
    expect(await historyOf(credentialId)).toHaveLength(1);
  });

  it('two corrections at once: both land, and the second’s before is the first’s after', async () => {
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...(await teacherAndSubject('race')) });
    await database.$transaction((tx) =>
      review.approve(tx, adminId, { credentialId, ...TRANSCRIPTION, tariq: 'الشاطبية' }),
    );
    const outcomes = await raced([
      (tx) =>
        review.correct(tx, adminId, { credentialId, holderName: 'عمر الأنصاري', reason: 'الاسم' }),
      (tx) =>
        review.correct(tx, adminId, { credentialId, riwaya: 'ورش عن نافع', reason: 'الرواية' }),
    ]);
    expect(codesOf(outcomes)).toEqual(['ok', 'ok']);
    const corrections = (await historyOf(credentialId)).filter(
      ({ action }) => action === 'correct',
    );
    expect(corrections).toHaveLength(2);
    expect(corrections[1]?.before).toEqual(corrections[0]?.after);
    expect(corrections[1]?.after).toMatchObject({
      holderName: 'عمر الأنصاري',
      riwaya: 'ورش عن نافع',
    });
  });

  it("a request for a document that moves the application writes the credential's row only", async () => {
    const adminId = await makeAdmin(db);
    const parents = await teacherAndSubject('moves');
    const profileId = await insertRow(db, 'teacher_profiles', {
      user_id: parents.teacherId,
      bio: '',
      qualification_summary: 'Probe',
      verification_status: 'pending',
      application_status: 'in_review',
      application_submitted_at: '2026-10-20T09:00:00Z',
    });
    const credentialId = await makeCredential(db, { ...parents });
    await database.$transaction((tx) =>
      review.requestDocument(tx, adminId, { credentialId, reason: 'الصفحة الأخيرة ناقصة' }),
    );
    const { rows } = await db.query<{ status: string; count: string }>(
      `SELECT p.application_status AS status,
              (SELECT count(*) FROM teacher_application_history h
                WHERE h.teacher_profile_id = p.id)::text AS count
         FROM teacher_profiles p WHERE p.id = $1`,
      [profileId],
    );
    expect(rows).toEqual([{ status: 'needs_document', count: '0' }]);
    expect(await historyOf(credentialId)).toEqual([
      { action: 'request_document', note: 'الصفحة الأخيرة ناقصة', before: null, after: null },
    ]);
  });
});
