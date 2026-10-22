// T069 — the credential review's queries over the real tables (`credential-review.repository.ts`,
// reached through the catalog module's entry as `credentialReviewStore`;
// FR-163, FR-164, rule 23, rule 28, R-DB-3). The parents a credential needs (a person, a subject, an
// administrator, the PDF's document) and the credentials themselves are committed first, as every
// probe here writes them; each probe then runs the repository on one transaction it rolls back. The
// queue is a whole table other probes fill while this one runs, so each probe names its teacher with
// a token of its own and searches by it.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { credentialReviewStore } from '../../apps/api/src/modules/catalog/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  connectAsApplication,
  type Db,
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
    poolMax: 2,
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

describe('approval', () => {
  it('approves a pending credential and writes its chain origin first, with its reviewer', async () => {
    const parents = await teacherAndSubject('probe teacher');
    const adminId = await makeAdmin(db);
    const credentialId = await makeCredential(db, { ...parents });
    const [outcome, record] = await rolledBack(async (tx) => [
      await store.approve(tx, approval(credentialId, adminId)),
      await store.read(tx, credentialId),
    ]);
    expect(outcome).toBe('approved');
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
