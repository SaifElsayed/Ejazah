// T174 of specs/002-identity/tasks.md (R1a; SRS DEC-97, FR-AUTH-14; ERD §4 `teacher_credential_history`,
// changelog row 63, §15 rules 68 and 69; the note under T174, Q-2 (a)) — the credential's history over
// the real table, as the application role.
//
// - THE WRITER AND THE READER. `credentialHistory.record` inserts one row on the decision's
//   transaction; `listOf` reads a credential's rows oldest first, the administrator by name.
// - RULE 68. A note on every decision but an approval, never blank, at most 1,000 characters; the
//   transcription `before` exactly on a correction, `after` exactly on an approval and a correction.
// - RULE 69. `ijazah_app` can neither UPDATE nor TRUNCATE the table; DELETE stays, for the erasure.
// - THE GUARD (Q-2 (a), the owner's addition). `eraseOfTeacher` deletes the history of a teacher never
//   approved and throws, deleting nothing, for a teacher once approved (`approved_at` set); the real
//   consequence (`catalogDeletionConsequence`, `account_deleted`) on an approved teacher keeps the
//   history, the name and the chain, so a wrong answer from the caller is caught too (the review
//   session, 2026-11-22).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  catalogDeletionConsequence,
  credentialHistory,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import {
  attempt,
  connectAsApplication,
  type Db,
  inRollback,
  insertRow,
  makeAdmin,
  makeCredential,
  makeSubject,
  makeUser,
  SQLSTATE,
} from './harness';

let db: Db;
let database: Database;
let adminId: string;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  adminId = await makeAdmin(db);
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
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

/** What `probe` threw on its rolled-back transaction, or `undefined` when it threw nothing. */
async function thrownBy(probe: (tx: Transaction) => Promise<unknown>): Promise<unknown> {
  let thrown: unknown;
  try {
    await database.$transaction(async (tx) => {
      await probe(tx);
      throw ROLLED_BACK;
    });
  } catch (error: unknown) {
    thrown = error;
  }
  return thrown === ROLLED_BACK ? undefined : thrown;
}

/** A committed teacher profile, approved (`approved_at` set) or a rejected applicant never approved. */
async function teacher(approved: boolean): Promise<string> {
  const userId = await makeUser(db);
  await insertRow(db, 'teacher_profiles', {
    user_id: userId,
    bio: '',
    qualification_summary: 'Probe',
    verification_status: approved ? 'approved' : 'rejected',
    application_status: approved ? 'approved' : 'rejected',
    approved_at: approved ? '2026-09-01T00:00:00Z' : null,
  });
  return userId;
}

const HOLDER = 'عمر بن فاروق';

/** A committed approved credential of the teacher's, transcribed, with one generation of its chain. */
async function transcribed(teacherUserId: string): Promise<string> {
  const credentialId = await makeCredential(db, {
    teacherId: teacherUserId,
    subjectId: await makeSubject(db),
    status: 'approved',
    admin: adminId,
  });
  await db.query(
    `UPDATE teacher_credentials SET holder_name = $2, riwaya = 'حفص عن عاصم', tariq = 'الشاطبية'
      WHERE id = $1`,
    [credentialId, HOLDER],
  );
  await insertRow(db, 'isnad_entries', {
    credential_id: credentialId,
    position: 1,
    names: ['رسول الله ﷺ'],
    created_by_admin_id: adminId,
  });
  return credentialId;
}

const BEFORE = {
  holderName: HOLDER,
  riwaya: 'حفص عن عاصم',
  tariq: 'الشاطبية',
  chain: [{ position: 1, names: ['رسول الله ﷺ'] }],
};
const AFTER = { ...BEFORE, holderName: 'عمر بن فاروق الأنصاري' };

const APPROVED_AT = new Date('2026-10-22T10:00:00Z');
const CORRECTED_AT = new Date('2026-10-23T10:00:00Z');

/** Commits an approval with its note and a correction with its reason on the credential. */
async function approvedThenCorrected(credentialId: string): Promise<void> {
  await database.$transaction(async (tx) => {
    await credentialHistory.record(tx, {
      credentialId,
      action: 'approve',
      note: 'السند مقروء كاملًا',
      after: BEFORE,
      adminId,
      at: APPROVED_AT,
    });
  });
  await database.$transaction(async (tx) => {
    await credentialHistory.record(tx, {
      credentialId,
      action: 'correct',
      note: 'الاسم كما في الملف',
      before: BEFORE,
      after: AFTER,
      adminId,
      at: CORRECTED_AT,
    });
  });
}

async function historyCount(credentialId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM teacher_credential_history WHERE credential_id = $1',
    [credentialId],
  );
  return Number(rows[0]?.count);
}

describe('record and listOf', () => {
  it('records each decision on its transaction and reads them oldest first, the administrator by name', async () => {
    const credentialId = await transcribed(await teacher(true));
    await approvedThenCorrected(credentialId);
    const history = await rolledBack((tx) => credentialHistory.listOf(tx, credentialId));
    expect(history).toEqual([
      {
        action: 'approve',
        note: 'السند مقروء كاملًا',
        before: null,
        after: BEFORE,
        adminName: 'Probe administrator',
        at: APPROVED_AT,
      },
      {
        action: 'correct',
        note: 'الاسم كما في الملف',
        before: BEFORE,
        after: AFTER,
        adminName: 'Probe administrator',
        at: CORRECTED_AT,
      },
    ]);
  });

  it("reads one credential's rows only", async () => {
    const owner = await teacher(true);
    const credentialId = await transcribed(owner);
    const other = await transcribed(owner);
    await approvedThenCorrected(other);
    expect(await rolledBack((tx) => credentialHistory.listOf(tx, credentialId))).toEqual([]);
    expect(await historyCount(other)).toBe(2);
  });
});

describe('rule 68: the note and the transcription, refused by the database', () => {
  const note = (length: number) => 'س'.repeat(length);
  it.each([
    ['a rejection without a note', { action: 'reject', note: null }, 'note_check'],
    [
      'a request for a document with a blank note',
      { action: 'request_document', note: '   ' },
      'note_check',
    ],
    [
      'a correction whose reason is over 1,000 characters',
      { action: 'correct', note: note(1001), before: BEFORE, after: AFTER },
      'note_check',
    ],
    [
      'an approval holding a before',
      { action: 'approve', note: null, before: BEFORE, after: AFTER },
      'transcription_check',
    ],
    ['an approval without its after', { action: 'approve', note: null }, 'transcription_check'],
    [
      'a correction without its before',
      { action: 'correct', note: 'سبب', after: AFTER },
      'transcription_check',
    ],
    [
      'a rejection holding an after',
      { action: 'reject', note: 'سبب', after: AFTER },
      'transcription_check',
    ],
  ] as const)('refuses %s', async (_case, row, check) => {
    const credentialId = await transcribed(await teacher(true));
    const thrown = await thrownBy((tx) =>
      credentialHistory.record(tx, { credentialId, adminId, at: APPROVED_AT, ...row }),
    );
    expect(String(thrown)).toContain(`teacher_credential_history_${check}`);
  });

  it('admits a note of exactly 1,000 characters on a rejection', async () => {
    const credentialId = await transcribed(await teacher(true));
    const count = await rolledBack(async (tx) => {
      await credentialHistory.record(tx, {
        credentialId,
        action: 'reject',
        note: note(1000),
        adminId,
        at: APPROVED_AT,
      });
      return tx.teacherCredentialHistory.count({ where: { credentialId } });
    });
    expect(count).toBe(1);
  });
});

describe('rule 69: written once, never edited', () => {
  it.each([
    [
      'UPDATE',
      'UPDATE teacher_credential_history SET note = note WHERE credential_id = $1',
      SQLSTATE.insufficientPrivilege,
    ],
    ['TRUNCATE', 'TRUNCATE teacher_credential_history', SQLSTATE.insufficientPrivilege],
    // Kept for the erasure of a teacher never approved alone (Q-2 (a)).
    ['DELETE', 'DELETE FROM teacher_credential_history WHERE credential_id = $1', null],
  ] as const)(
    '%s by the application role: refused, but the erasure’s DELETE',
    async (_verb, sql, refusal) => {
      const credentialId = await transcribed(await teacher(true));
      await approvedThenCorrected(credentialId);
      const params = sql.includes('$1') ? [credentialId] : [];
      const code = await inRollback(db, (inside) => attempt(inside, sql, params));
      expect(code).toBe(refusal);
      expect(await historyCount(credentialId)).toBe(2);
    },
  );
});

describe('the guard: the history of a teacher once approved is never erased (Q-2 (a))', () => {
  it("eraseOfTeacher deletes the history of a teacher never approved, and another teacher's stays", async () => {
    const applicant = await teacher(false);
    const mine = await transcribed(applicant);
    const theirs = await transcribed(await teacher(false));
    await approvedThenCorrected(mine);
    await approvedThenCorrected(theirs);
    const left = await rolledBack(async (tx) => {
      await credentialHistory.eraseOfTeacher(tx, applicant);
      return [
        await tx.teacherCredentialHistory.count({ where: { credentialId: mine } }),
        await tx.teacherCredentialHistory.count({ where: { credentialId: theirs } }),
      ];
    });
    expect(left).toEqual([0, 2]);
  });

  it('eraseOfTeacher throws for a teacher once approved and deletes nothing', async () => {
    const approved = await teacher(true);
    const credentialId = await transcribed(approved);
    await approvedThenCorrected(credentialId);
    let counted: number | undefined;
    const thrown = await thrownBy(async (tx) => {
      await credentialHistory.eraseOfTeacher(tx, approved).catch(async (error: unknown) => {
        counted = await tx.teacherCredentialHistory.count({ where: { credentialId } });
        throw error;
      });
    });
    expect(thrown).toBeInstanceOf(Error);
    expect(counted).toBe(2);
    expect(await historyCount(credentialId)).toBe(2);
  });

  it("the real consequence on an approved teacher's deletion keeps the history, the name and the chain", async () => {
    const approved = await teacher(true);
    const credentialId = await transcribed(approved);
    await approvedThenCorrected(credentialId);
    const kept = await rolledBack(async (tx) => {
      await catalogDeletionConsequence()(tx, approved, 'account_deleted');
      return {
        history: await tx.teacherCredentialHistory.count({ where: { credentialId } }),
        credential: await tx.teacherCredential.findUnique({
          where: { id: credentialId },
          select: { holderName: true, riwaya: true, tariq: true },
        }),
        chain: await tx.isnadEntry.count({ where: { credentialId } }),
      };
    });
    expect(kept).toEqual({
      history: 2,
      credential: { holderName: HOLDER, riwaya: 'حفص عن عاصم', tariq: 'الشاطبية' },
      chain: 1,
    });
  });

  it.each(['suspended', 'approval_revoked', 'banned'] as const)(
    "the consequence leaves a never-approved teacher's history and transcription on %s",
    async (cause) => {
      const applicant = await teacher(false);
      const credentialId = await transcribed(applicant);
      await approvedThenCorrected(credentialId);
      const kept = await rolledBack(async (tx) => {
        await catalogDeletionConsequence()(tx, applicant, cause);
        return [
          await tx.teacherCredentialHistory.count({ where: { credentialId } }),
          (await tx.teacherCredential.findUnique({ where: { id: credentialId } }))?.holderName,
        ];
      });
      expect(kept).toEqual([2, HOLDER]);
    },
  );
});
