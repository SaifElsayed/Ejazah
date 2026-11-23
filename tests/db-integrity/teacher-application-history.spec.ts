// R1a (002:T174; SRS DEC-97; ERD §2 `teacher_application_history`, §15 rules 67 and 69; the note
// under T174, Q-2 (a)) — the application's history over the real table,
// `20261122111346_teacher_decision_histories` applied.
//
//   - identity's entry: `recordApplicationHistory` writes one row on the teacher's profile, and
//     `applicationHistoryOf` reads them oldest first with the administrator's display name;
//   - RULE 67: a blank note, a note over 1,000 characters and a decision other than approve with no
//     note are refused by the database (23514); an approval with no note is written;
//   - RULE 69: the application role cannot UPDATE a row or TRUNCATE the table (42501); DELETE stays,
//     the erasure's (`eraseOf`, whose refusal of a teacher once approved is
//     `application-history.repository.spec.ts`'s, and the deletion's use `account-deletion.spec.ts`'s);
//   - the decisions as `main.ts` composes them (verification's review over identity's standing): a
//     request for information followed by an approval keeps the request's text in the approved
//     teacher's history (the line's red);
//   - A RACE PER INSERT PATH: approve, reject, requestInfo, an applicant's ban and a revocation, each
//     run twice at once on one teacher, staged as `account-locks.spec.ts` stages a race: A decides and
//     stays open, B is seen waiting on the lock A holds (`pg_stat_activity`), A commits, B reads the
//     moved application and is refused `CONFLICT`; one row is written, not two.
//   - R1b (002:T186; the note under T186): an ever-approved teacher's call notes survive a
//     reapplication (identity's `open`), and a new call first writes them as one `call_replaced`
//     row (2,000 characters whole, rule 67 as amended), then replaces them; an applicant never
//     approved keeps none and writes none; two calls at once keep each replaced note once.
//
// The parents are committed (a person, a profile, an administrator), as the other probes leave
// theirs; the probes of the entry and the checks run on one transaction they roll back, the
// decisions and the races commit. Every connection is the application role.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  applicationHistoryOf,
  recordApplicationHistory,
  setApplication,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createVerificationAdminServices,
  openRequestOf,
} from '../../apps/api/src/modules/verification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  attempt,
  connectAsApplication,
  type Db,
  inRollback,
  insertRow,
  makeAdmin,
  makeSubject,
  makeUser,
  SQLSTATE,
} from './harness';

let db: Db;
let watcher: Db;
let database: Database;
let standing: StandingService;
let review: ReturnType<typeof createVerificationAdminServices>;

const unused = async (): Promise<never> => {
  throw new Error('not used by these probes');
};

beforeAll(async () => {
  [db, watcher] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  standing = new StandingService({
    store: standingStoreOver(database),
    consequences: new AccountConsequences(),
    revokeSubjects,
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
  });
  review = createVerificationAdminServices({
    database,
    storage: { temporaryLink: unused },
    cipher: { decrypt: () => unused() as never },
    settings: { read: unused },
    standing,
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one Prisma transaction and rolls back whatever it wrote. */
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

/** A committed applicant's profile and an administrator named `adminName`; the ids. */
async function world(adminName = 'Probe administrator') {
  const userId = await makeUser(db);
  const profileId = await insertRow(db, 'teacher_profiles', {
    user_id: userId,
    bio: '',
    qualification_summary: 'إجازة في حفص',
    verification_status: 'pending',
    application_status: 'in_review',
    application_submitted_at: '2026-10-18T09:00:00Z',
  });
  const adminId = await makeAdmin(db);
  await db.query('UPDATE admin_users SET display_name = $2 WHERE id = $1', [adminId, adminName]);
  return { userId, profileId, adminId };
}

describe("identity's entry", () => {
  it('writes one row per decision on the profile and reads them oldest first, each with its administrator', async () => {
    const { userId, profileId, adminId } = await world('أ. سعاد');
    const other = await makeAdmin(db);
    await db.query(`UPDATE admin_users SET display_name = 'أ. خالد' WHERE id = $1`, [other]);
    const asked = new Date('2026-11-20T09:00:00Z');
    const approved = new Date('2026-11-21T09:00:00Z');
    const [history, rows] = await rolledBack(async (tx) => {
      // Recorded newest first, so the order read is the instant's, not the insert's.
      await recordApplicationHistory(tx, {
        teacherUserId: userId,
        action: 'approve',
        note: null,
        adminId: other,
        at: approved,
      });
      await recordApplicationHistory(tx, {
        teacherUserId: userId,
        action: 'request_info',
        note: 'أرسل صورة أوضح للهوية',
        adminId,
        at: asked,
      });
      return [
        await applicationHistoryOf(tx, userId),
        await tx.teacherApplicationHistory.findMany({
          where: { teacherProfileId: profileId },
          select: { id: true },
        }),
      ] as const;
    });
    expect(rows).toHaveLength(2);
    expect(history).toEqual([
      { action: 'request_info', note: 'أرسل صورة أوضح للهوية', adminName: 'أ. سعاد', at: asked },
      { action: 'approve', note: null, adminName: 'أ. خالد', at: approved },
    ]);
  });

  it("reads none of another teacher's rows", async () => {
    const mine = await world();
    const theirs = await world();
    const history = await rolledBack(async (tx) => {
      await recordApplicationHistory(tx, {
        teacherUserId: theirs.userId,
        action: 'reject',
        note: 'لا تطابق',
        adminId: theirs.adminId,
        at: new Date('2026-11-21T09:00:00Z'),
      });
      return applicationHistoryOf(tx, mine.userId);
    });
    expect(history).toEqual([]);
  });
});

describe('rule 67: the note', () => {
  const insert = (
    probe: Db,
    values: { profileId: string; adminId: string },
    action: string,
    note: string | null,
  ) =>
    attempt(
      probe,
      `INSERT INTO teacher_application_history (teacher_profile_id, action, note, admin_id)
       VALUES ($1, $2::teacher_application_history_action, $3, $4)`,
      [values.profileId, action, note, values.adminId],
    );

  it('refuses a blank note, a note over 1,000 characters, and a decision but approve with none', async () => {
    const w = await world();
    await inRollback(db, async (probe) => {
      expect(await insert(probe, w, 'reject', '   ')).toBe(SQLSTATE.checkViolation);
      expect(await insert(probe, w, 'request_info', 'ن'.repeat(1001))).toBe(
        SQLSTATE.checkViolation,
      );
      for (const action of ['reject', 'request_info', 'ban', 'revoke']) {
        expect(await insert(probe, w, action, null)).toBe(SQLSTATE.checkViolation);
      }
      expect(await insert(probe, w, 'approve', '')).toBe(SQLSTATE.checkViolation);
    });
  });

  it('writes an approval with no note, and a note of exactly 1,000 characters', async () => {
    const w = await world();
    await inRollback(db, async (probe) => {
      expect(await insert(probe, w, 'approve', null)).toBeNull();
      expect(await insert(probe, w, 'reject', 'ن'.repeat(1000))).toBeNull();
    });
  });
});

describe('rule 69: written once, deleted by the erasure alone', () => {
  it('refuses the application role an UPDATE of a row and a TRUNCATE of the table', async () => {
    const w = await world();
    await inRollback(db, async (probe) => {
      const id = await insertRow(probe, 'teacher_application_history', {
        teacher_profile_id: w.profileId,
        action: 'reject',
        note: 'سبب',
        admin_id: w.adminId,
      });
      expect(
        await attempt(probe, `UPDATE teacher_application_history SET note = 'غيره' WHERE id = $1`, [
          id,
        ]),
      ).toBe(SQLSTATE.insufficientPrivilege);
      expect(await attempt(probe, 'TRUNCATE teacher_application_history')).toBe(
        SQLSTATE.insufficientPrivilege,
      );
      // DELETE stays granted, for the erasure of a teacher never approved (Q-2 (a)).
      expect(
        await attempt(probe, 'DELETE FROM teacher_application_history WHERE id = $1', [id]),
      ).toBeNull();
    });
  });

  it('refuses a key update of the profile or the administrator a row references (ON UPDATE RESTRICT)', async () => {
    const w = await world();
    await inRollback(db, async (probe) => {
      await insertRow(probe, 'teacher_application_history', {
        teacher_profile_id: w.profileId,
        action: 'reject',
        note: 'سبب',
        admin_id: w.adminId,
      });
      expect(
        await attempt(probe, 'UPDATE teacher_profiles SET id = gen_random_uuid() WHERE id = $1', [
          w.profileId,
        ]),
      ).toBe(SQLSTATE.restrictViolation);
      expect(
        await attempt(probe, 'UPDATE admin_users SET id = gen_random_uuid() WHERE id = $1', [
          w.adminId,
        ]),
      ).toBe(SQLSTATE.restrictViolation);
    });
  });
});

/** The committed rows of the teacher's history, oldest first. */
async function historyRows(userId: string): Promise<{ action: string; note: string | null }[]> {
  const { rows } = await db.query<{ action: string; note: string | null }>(
    `SELECT h.action, h.note FROM teacher_application_history h
       JOIN teacher_profiles p ON p.id = h.teacher_profile_id
      WHERE p.user_id = $1 ORDER BY h.created_at, h.id`,
    [userId],
  );
  return rows;
}

/**
 * A committed applicant whose application is `status`, its call recorded and one credential sent
 * with it, approved; the ids.
 */
async function decidable(
  status: 'in_review' | 'approved' = 'in_review',
): Promise<{ readonly userId: string; readonly adminId: string }> {
  const { userId, adminId } = await world();
  const approved = status === 'approved';
  await db.query(
    `UPDATE teacher_profiles SET application_status = $2, verification_status = $3,
            verification_call_completed_on = '2026-10-20', verification_call_outcome = 'suitable',
            approved_at = $4, approved_by_admin_id = $5
      WHERE user_id = $1`,
    [
      userId,
      status,
      approved ? 'approved' : 'pending',
      approved ? '2026-10-21T09:00:00Z' : null,
      approved ? adminId : null,
    ],
  );
  const documentId = await insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: 'credential',
    storage_key_encrypted: Buffer.from('probe'),
  });
  await insertRow(db, 'teacher_credentials', {
    teacher_user_id: userId,
    subject_id: await makeSubject(db),
    document_id: documentId,
    submitted_with_application: true,
    // The application's credentials share its submission's instant (`world()`).
    created_at: '2026-10-18T09:00:00Z',
    status: 'approved',
    reviewed_by_admin_id: adminId,
    reviewed_at: '2026-10-18T09:00:00Z',
  });
  return { userId, adminId };
}

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

/** Resolves once backend `pid` waits on a lock; fails after about two seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

/**
 * A runs `decide` and stays open; B runs `second` (`decide` unless named, R1b 002:T186) and is seen
 * waiting; A commits. How B ended.
 */
async function twiceAtOnce(
  decide: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<unknown> = decide,
): Promise<{ readonly code: string } | { readonly value: unknown }> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = (): void => undefined;
  const firstRan = new Promise<void>((resolve) => {
    ran = resolve;
  });
  const a = database.$transaction(async (tx) => {
    await decide(tx);
    ran();
    await released;
  }, OPTIONS);
  // A that fails before it is held is reported, not left waiting.
  await Promise.race([firstRan, a]);
  let pidOfB = (_pid: number): void => undefined;
  const bStarted = new Promise<number>((resolve) => {
    pidOfB = resolve;
  });
  const b = database
    .$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pidOfB(row?.pid ?? 0);
      return second(tx);
    }, OPTIONS)
    .then(
      (value: unknown) => ({ value }),
      (thrown: unknown) => ({ code: (thrown as { code?: string }).code ?? String(thrown) }),
    );
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
    await a;
  }
  return b;
}

describe('the decisions write the history, as composed', () => {
  it("a request for information followed by an approval keeps the request's text in the approved teacher's history", async () => {
    const { userId, adminId } = await decidable();
    const note = 'صورة الهوية غير واضحة، أرسل صورة أوضح';
    await database.$transaction((tx) =>
      review.applications.requestInfo(tx, adminId, {
        teacherUserId: userId,
        needed: ['id_unclear'],
        note,
      }),
    );
    // The applicant's resubmission returns the application to review.
    await db.query(
      `UPDATE teacher_profiles SET application_status = 'in_review' WHERE user_id = $1`,
      [userId],
    );
    await database.$transaction((tx) =>
      review.applications.approve(tx, adminId, { teacherUserId: userId }),
    );
    const { rows } = await db.query<{ application_note: string | null; approved_at: Date | null }>(
      'SELECT application_note, approved_at FROM teacher_profiles WHERE user_id = $1',
      [userId],
    );
    expect(rows[0]?.application_note).toBeNull();
    expect(rows[0]?.approved_at).not.toBeNull();
    expect(await historyRows(userId)).toEqual([
      { action: 'request_info', note },
      { action: 'approve', note: null },
    ]);
  });
});

type Decide = (userId: string, adminId: string) => (tx: Transaction) => Promise<unknown>;

const PATHS: readonly (readonly [
  string,
  'in_review' | 'approved',
  Decide,
  { readonly action: string; readonly note: string },
])[] = [
  [
    'approve',
    'in_review',
    (userId, adminId) => (tx) =>
      review.applications.approve(tx, adminId, { teacherUserId: userId, note: 'مرحبًا' }),
    { action: 'approve', note: 'مرحبًا' },
  ],
  [
    'reject',
    'in_review',
    (userId, adminId) => (tx) =>
      review.applications.reject(tx, adminId, {
        teacherUserId: userId,
        reasonChoice: 'other',
        note: 'لا يكفي',
      }),
    { action: 'reject', note: 'لا يكفي' },
  ],
  [
    'requestInfo',
    'in_review',
    (userId, adminId) => (tx) =>
      review.applications.requestInfo(tx, adminId, {
        teacherUserId: userId,
        needed: ['other'],
        note: 'أرسل الوثيقة',
      }),
    { action: 'request_info', note: 'أرسل الوثيقة' },
  ],
  [
    "an applicant's ban",
    'in_review',
    (userId, adminId) => (tx) =>
      review.applications.ban(tx, adminId, {
        teacherUserId: userId,
        reasonChoice: 'forged_documents',
        note: 'وثيقة معدَّلة',
      }),
    { action: 'ban', note: 'وثيقة معدَّلة' },
  ],
  [
    'a revocation',
    'approved',
    (userId, adminId) => (tx) => standing.revokeApproval(tx, adminId, userId, 'شكوى موثّقة'),
    { action: 'revoke', note: 'شكوى موثّقة' },
  ],
];

describe('a race per insert path: one decision wins, one row', () => {
  it.each(PATHS)(
    '%s twice at once: the second waits, is refused, and one row is written',
    async (_path, status, decide, row) => {
      const { userId, adminId } = await decidable(status);
      expect(await twiceAtOnce(decide(userId, adminId))).toEqual({ code: 'CONFLICT' });
      expect(await historyRows(userId)).toEqual([row]);
    },
  );
});

// R1b (002:T186; SRS DEC-97; the note under T186, (1) to (3)): a teacher once approved (`approved_at`
// set, kept by the revocation) keeps the call's notes through a reapplication; a call recorded on the
// new application first writes them to the history as one `call_replaced` row, then replaces them.
describe("R1b: an ever-approved teacher's call notes are kept (T186)", () => {
  const EARLIER = 'تحقّقت من الهوية والإجازة في المكالمة';
  const LATER = 'مكالمة الطلب الجديد: أجاب عن الأسئلة';

  /** The call's notes on the profile now. */
  async function notesOf(userId: string): Promise<string | null> {
    const { rows } = await db.query<{ verification_call_notes: string | null }>(
      'SELECT verification_call_notes FROM teacher_profiles WHERE user_id = $1',
      [userId],
    );
    return rows[0]?.verification_call_notes ?? null;
  }

  /** The `call_replaced` rows of the teacher's history, oldest first, with who and when. */
  async function replacedRows(
    userId: string,
  ): Promise<{ note: string | null; admin_id: string; created_at: Date }[]> {
    const { rows } = await db.query<{ note: string | null; admin_id: string; created_at: Date }>(
      `SELECT h.note, h.admin_id, h.created_at FROM teacher_application_history h
         JOIN teacher_profiles p ON p.id = h.teacher_profile_id
        WHERE p.user_id = $1 AND h.action = 'call_replaced' ORDER BY h.created_at, h.id`,
      [userId],
    );
    return rows;
  }

  /** A committed teacher once approved whose call's notes are `notes`, revoked: `rejected`. */
  async function revokedTeacher(notes: string): Promise<string> {
    const { userId, adminId } = await decidable('approved');
    await db.query('UPDATE teacher_profiles SET verification_call_notes = $2 WHERE user_id = $1', [
      userId,
      notes,
    ]);
    await database.$transaction((tx) =>
      standing.revokeApproval(tx, adminId, userId, 'شكوى موثّقة'),
    );
    return userId;
  }

  /**
   * A committed applicant never approved whose call's notes are `notes`, in `status`; the ids.
   */
  async function neverApproved(
    status: 'in_review' | 'rejected',
    notes: string,
  ): Promise<{ readonly userId: string; readonly adminId: string }> {
    const ids = await decidable('in_review');
    await db.query(
      `UPDATE teacher_profiles SET verification_call_notes = $2, application_status = $3,
              verification_status = $4
        WHERE user_id = $1`,
      [ids.userId, notes, status, status === 'rejected' ? 'rejected' : 'pending'],
    );
    return ids;
  }

  /** A committed teacher once approved, reapplied, whose open application holds `notes`; the ids. */
  async function everApprovedInReview(
    notes: string,
  ): Promise<{ readonly userId: string; readonly adminId: string }> {
    const ids = await decidable('approved');
    await db.query(
      `UPDATE teacher_profiles SET verification_call_notes = $2, application_status = 'in_review',
              verification_status = 'pending'
        WHERE user_id = $1`,
      [ids.userId, notes],
    );
    return ids;
  }

  /** Identity's `open` from `rejected`, committed, as a reapplication writes it; whether it wrote. */
  async function reapply(userId: string): Promise<boolean> {
    const identityDocumentId = await insertRow(db, 'verification_documents', {
      user_id: userId,
      document_type: 'national_id',
      storage_key_encrypted: Buffer.from('probe'),
    });
    return database.$transaction((tx) =>
      setApplication(tx, userId, {
        kind: 'open',
        from: 'rejected',
        qualificationSummary: 'إجازة في حفص',
        identityDocumentId,
        identityDocumentType: 'national_id',
        submittedAt: new Date('2026-11-23T09:00:00Z'),
      }),
    );
  }

  const recordCall = (userId: string, adminId: string, notes: string) => (tx: Transaction) =>
    review.applications.recordCall(tx, adminId, {
      teacherUserId: userId,
      completedOn: '2026-11-20',
      timeZone: 'Africa/Cairo',
      outcome: 'suitable',
      notes,
    });

  it('an ever-approved teacher, revoked, reapplies: the notes stay as written', async () => {
    const userId = await revokedTeacher(EARLIER);
    expect(await reapply(userId)).toBe(true);
    expect(await notesOf(userId)).toBe(EARLIER);
  });

  it('then a new call: one call_replaced row holds the earlier notes, by the recorder, now; the column the new ones', async () => {
    const userId = await revokedTeacher(EARLIER);
    await reapply(userId);
    const recorder = await makeAdmin(db);
    const before = new Date();
    await database.$transaction(recordCall(userId, recorder, LATER));
    const after = new Date();
    const rows = await replacedRows(userId);
    expect(rows.map(({ note, admin_id }) => ({ note, admin_id }))).toEqual([
      { note: EARLIER, admin_id: recorder },
    ]);
    const at = rows[0]?.created_at.getTime() ?? 0;
    expect(at).toBeGreaterThanOrEqual(before.getTime());
    expect(at).toBeLessThanOrEqual(after.getTime());
    expect(await notesOf(userId)).toBe(LATER);
  });

  it('keeps a 2,000-character earlier note whole (rule 67 on call_replaced)', async () => {
    const long = 'ن'.repeat(2000);
    const { userId, adminId } = await everApprovedInReview(long);
    await database.$transaction(recordCall(userId, adminId, LATER));
    expect((await replacedRows(userId)).map(({ note }) => note)).toEqual([long]);
  });

  it('a never-approved applicant reapplies: the notes are cleared, as today', async () => {
    const { userId } = await neverApproved('rejected', EARLIER);
    expect(await reapply(userId)).toBe(true);
    expect(await notesOf(userId)).toBeNull();
  });

  it("a never-approved applicant's new call writes no history row", async () => {
    const { userId, adminId } = await neverApproved('in_review', EARLIER);
    await database.$transaction(recordCall(userId, adminId, LATER));
    expect(await replacedRows(userId)).toEqual([]);
    expect(await notesOf(userId)).toBe(LATER);
  });

  it('two calls at once: the second waits on the application, and the history holds each replaced note once', async () => {
    const { userId, adminId } = await everApprovedInReview(EARLIER);
    const third = 'المكالمة الثالثة';
    expect(
      await twiceAtOnce(recordCall(userId, adminId, LATER), recordCall(userId, adminId, third)),
    ).toEqual({ value: expect.anything() });
    expect((await replacedRows(userId)).map(({ note }) => note)).toEqual([EARLIER, LATER]);
    expect(await notesOf(userId)).toBe(third);
  });
});
