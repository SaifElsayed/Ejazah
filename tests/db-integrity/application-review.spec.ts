// T068 — the application review's, the identity requests' and the standing's queries over the real
// tables (identity's `applicants.repository.ts`, `application.repository.ts` and
// `standing.repository.ts`; verification's `verification-requests.repository.ts`; catalog's
// `revokeSubjects`, and `closeUndecidedCredentials` with the documents queue and the teacher's list
// it changes, T122), each reached through its module's entry. The parents (a person, an
// administrator, a document, a subject) are committed first, as every probe here writes them; each
// probe then runs the queries on one transaction it rolls back. The queue is a whole table other
// probes fill while this one runs, so each probe names its applicant with a token of its own.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  credentialReviewStore,
  listCredentials,
  revokeSubjects,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  applicantsCount,
  applicantsPage,
  decideApplication,
  readApplicant,
  recordApplicationCall,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createApplicationReviewStore,
  createIdentityRequestStore,
} from '../../apps/api/src/modules/verification/index.js';
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

/** A committed applicant with an identity document and a profile in `status`; the ids. */
async function applicant(
  values: {
    displayName?: string;
    email?: string;
    status?: 'in_review' | 'needs_document' | 'approved';
    verificationStatus?: 'pending' | 'approved';
  } = {},
) {
  const userId = await makeUser(db, {
    ...(values.displayName === undefined ? {} : { display_name: values.displayName }),
    ...(values.email === undefined ? {} : { email: values.email }),
  });
  const documentId = await insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: 'national_id',
    storage_key_encrypted: Buffer.from('probe'),
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: userId,
    bio: '',
    qualification_summary: 'إجازة في حفص',
    verification_status: values.verificationStatus ?? 'pending',
    application_status: values.status ?? 'in_review',
    application_submitted_at: '2026-10-18T09:00:00Z',
    identity_document_id: documentId,
    identity_document_type: 'national_id',
  });
  return { userId, documentId };
}

const CALL = {
  completedOn: new Date('2026-10-21T00:00:00Z'),
  outcome: 'unsuitable' as const,
  notes: 'لم يُجب عن الأسئلة',
};

describe('the applications queue', () => {
  it('searches the name or the email, `%` as itself and in any case, and leaves out a deleted person', async () => {
    const token = randomUUID().slice(0, 8);
    const byName = await applicant({ displayName: `Omar ${token} 50%` });
    await applicant({ displayName: `omar ${token} 500` });
    const byEmail = await applicant({ email: `haddad-${token}@example.invalid` });
    const gone = await applicant({ displayName: `Omar ${token} 50% gone` });
    await db.query('UPDATE users SET deleted_at = now() WHERE id = $1', [gone.userId]);
    const [named, mailed, count] = await rolledBack(
      async (tx) =>
        [
          await applicantsPage(tx, { tab: 'in_review', search: `OMAR ${token} 50%` }, 0, 10),
          await applicantsPage(tx, { tab: 'in_review', search: `HADDAD-${token}` }, 0, 10),
          await applicantsCount(tx, { tab: 'in_review', search: `omar ${token}` }),
        ] as const,
    );
    expect(named.map((row) => row.userId)).toEqual([byName.userId]);
    expect(mailed.map((row) => row.userId)).toEqual([byEmail.userId]);
    expect(count).toBe(2);
    expect(named[0]).toMatchObject({ status: 'in_review', gender: 'male', callCompletedOn: null });
  });

  it('puts each status in its tab', async () => {
    const token = randomUUID().slice(0, 8);
    const waiting = await applicant({ displayName: `w ${token}`, status: 'needs_document' });
    const decided = await applicant({ displayName: `d ${token}`, status: 'approved' });
    const [inWaiting, inDecided, inReview] = await rolledBack(
      async (tx) =>
        [
          await applicantsPage(tx, { tab: 'waiting', search: token }, 0, 10),
          await applicantsPage(tx, { tab: 'decided', search: token }, 0, 10),
          await applicantsCount(tx, { tab: 'in_review', search: token }),
        ] as const,
    );
    expect(inWaiting.map((row) => row.userId)).toEqual([waiting.userId]);
    expect(inDecided.map((row) => row.userId)).toEqual([decided.userId]);
    expect(inReview).toBe(0);
  });
});

describe('the decisions', () => {
  it('records the call as a day and refuses approval until it is recorded', async () => {
    const { userId, documentId } = await applicant();
    const adminId = await makeAdmin(db);
    const at = new Date('2026-10-22T10:00:00Z');
    const [early, recorded, approved, detail] = await rolledBack(
      async (tx) =>
        [
          await decideApplication(tx, userId, { kind: 'approve', adminId, at, note: null }),
          await recordApplicationCall(tx, userId, CALL),
          await decideApplication(tx, userId, { kind: 'approve', adminId, at, note: 'مرحبًا' }),
          await readApplicant(tx, userId),
        ] as const,
    );
    expect([early, recorded, approved]).toEqual([false, true, true]);
    expect(detail).toMatchObject({
      status: 'approved',
      callCompletedOn: new Date('2026-10-21T00:00:00Z'),
      callOutcome: 'unsuitable',
      callNotes: 'لم يُجب عن الأسئلة',
      note: 'مرحبًا',
      identityDocumentId: documentId,
      qualificationSummary: 'إجازة في حفص',
      accountStatus: 'active',
    });
  });

  it('requests information only in review, rejects from waiting, and moves nothing decided', async () => {
    const { userId } = await applicant();
    const adminId = await makeAdmin(db);
    const at = new Date('2026-10-22T10:00:00Z');
    const outcomes = await rolledBack(async (tx) => [
      await decideApplication(tx, userId, { kind: 'request_info', adminId, at, note: 'أوضح' }),
      await decideApplication(tx, userId, { kind: 'request_info', adminId, at, note: 'أوضح' }),
      await decideApplication(tx, userId, { kind: 'reject', adminId, at, note: 'مرفوض' }),
      await decideApplication(tx, userId, { kind: 'reject', adminId, at, note: 'مرفوض' }),
      await recordApplicationCall(tx, userId, CALL),
      (await readApplicant(tx, userId))?.status,
    ]);
    expect(outcomes).toEqual([true, false, true, false, false, 'rejected']);
  });
});

describe("a rejection's undecided credentials (T122)", () => {
  it('rejects the undecided ones with the note, out of the documents queue, and keeps a decided one', async () => {
    const token = randomUUID().slice(0, 8);
    const { userId } = await applicant({ displayName: `closed ${token}` });
    const adminId = await makeAdmin(db);
    const pending = await makeCredential(db, {
      teacherId: userId,
      subjectId: await makeSubject(db),
    });
    const waiting = await makeCredential(db, {
      teacherId: userId,
      subjectId: await makeSubject(db),
      status: 'needs_document',
    });
    const approved = await makeCredential(db, {
      teacherId: userId,
      subjectId: await makeSubject(db),
      status: 'approved',
    });
    const at = new Date('2026-10-22T10:00:00Z');
    const [moved, again, listed, queued, counted, reviewers] = await rolledBack(
      async (tx) =>
        [
          await createApplicationReviewStore().closeCredentials(tx, {
            credentialIds: [pending, waiting, approved],
            reason: 'المؤهل لا يغطي ورش',
            adminId,
            at,
          }),
          await createApplicationReviewStore().closeCredentials(tx, {
            credentialIds: [pending, waiting],
            reason: 'مرة ثانية',
            adminId,
            at,
          }),
          await listCredentials(tx, userId),
          await credentialReviewStore.page(tx, { status: 'pending', search: token }, 0, 10),
          await credentialReviewStore.count(tx, { status: 'needs_document', search: token }),
          await tx.teacherCredential.findMany({
            where: { id: { in: [pending, approved] } },
            select: { id: true, reviewedByAdminId: true },
          }),
        ] as const,
    );
    expect([moved, again, queued, counted]).toEqual([2, 0, [], 0]);
    const byId = new Map(listed.map((row) => [row.id, row]));
    for (const id of [pending, waiting]) {
      expect(byId.get(id)).toMatchObject({
        status: 'rejected',
        reviewReason: 'المؤهل لا يغطي ورش',
        reviewedAt: at,
      });
    }
    expect(byId.get(approved)).toMatchObject({ status: 'approved', reviewReason: null });
    expect(byId.get(approved)?.reviewedAt).not.toEqual(at);
    expect(reviewers.find((row) => row.id === pending)?.reviewedByAdminId).toBe(adminId);
    expect(reviewers.find((row) => row.id === approved)?.reviewedByAdminId).not.toBe(adminId);
  });
});

describe('the identity requests', () => {
  it('opens a request, attaches one document, replaces the request keeping it, and accepts the next', async () => {
    const userId = await makeUser(db);
    const adminId = await makeAdmin(db);
    const document = (type: string) =>
      insertRow(db, 'verification_documents', {
        user_id: userId,
        document_type: type,
        storage_key_encrypted: Buffer.from('probe'),
      });
    const first = await document('passport');
    const second = await document('national_id');
    const store = createIdentityRequestStore(database);
    const review = createApplicationReviewStore();
    const at = new Date('2026-10-22T10:00:00Z');
    const steps = await rolledBack(async (tx) => {
      const requestId = await store.openRequest(tx, { userId, adminId, reason: 'بلاغ', at });
      const before = [
        await store.resolve(tx, requestId, at),
        await store.attachDocument(tx, { requestId, documentId: first, documentType: 'passport' }),
        await store.attachDocument(tx, {
          requestId,
          documentId: second,
          documentType: 'national_id',
        }),
        (await review.openRequestOf(tx, userId))?.document?.documentId,
      ] as unknown[];
      const next = await store.replace(tx, {
        requestId,
        adminId,
        note: 'الوجه الخلفي غير واضح',
        at,
      });
      if (next === null) throw new Error('the request was not replaced');
      const replaced = await store.readRequest(tx, requestId);
      return [
        ...before,
        await store.replace(tx, { requestId, adminId, note: 'مرة أخرى', at }),
        replaced?.status,
        replaced?.document?.documentId,
        (await store.openRequestOf(tx, userId))?.reason,
        await store.attachDocument(tx, {
          requestId: next,
          documentId: second,
          documentType: 'national_id',
        }),
        await store.resolve(tx, next, at),
        await store.openRequestOf(tx, userId),
        (await store.readRequest(tx, next))?.status,
      ];
    });
    expect(steps).toEqual([
      false,
      true,
      false,
      first,
      null,
      'replaced',
      first,
      'الوجه الخلفي غير واضح',
      true,
      true,
      null,
      'satisfied',
    ]);
  });
});

describe('the standing', () => {
  it("bans an applicant with the note, ends the person's sessions and moves the account", async () => {
    const { userId } = await applicant();
    const adminId = await makeAdmin(db);
    await db.query(
      `INSERT INTO user_sessions (user_id, refresh_token_hash, issued_at, expires_at, updated_at)
       VALUES ($1, $2, now(), now() + interval '1 day', now())`,
      [userId, `probe-${randomUUID()}`],
    );
    const store = standingStoreOver(database);
    const at = new Date('2026-10-22T10:00:00Z');
    const [banned, moved, revoked, standing, again] = await rolledBack(
      async (tx) =>
        [
          await store.banProfile(tx, userId, { kind: 'applicant', adminId, at, note: 'معدَّلة' }),
          await store.moveAccount(tx, userId, ['active'], 'banned'),
          await store.revokeSessions(tx, userId, 'account_banned', at),
          await store.read(tx, userId),
          await store.banProfile(tx, userId, { kind: 'teacher' }),
        ] as const,
    );
    expect([banned, moved, revoked, again]).toEqual([true, true, 1, false]);
    expect(standing).toEqual({
      accountStatus: 'banned',
      teacher: { verificationStatus: 'banned', applicationStatus: 'banned' },
    });
  });

  it("revokes an approval with the note and removes the teacher's subjects", async () => {
    const { userId } = await applicant({ status: 'approved', verificationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const subjectId = await makeSubject(db);
    await insertRow(db, 'teacher_subjects', { teacher_user_id: userId, subject_id: subjectId });
    const store = standingStoreOver(database);
    const at = new Date('2026-10-22T10:00:00Z');
    const [revoked, again, subjects, detail, bannedAfter, standingAfter] = await rolledBack(
      async (tx) => {
        const first = await store.revokeApproval(tx, userId, { adminId, at, note: 'شكوى' });
        const second = await store.revokeApproval(tx, userId, { adminId, at, note: 'شكوى' });
        await revokeSubjects(tx, userId);
        return [
          first,
          second,
          await tx.teacherSubject.count({ where: { teacherUserId: userId } }),
          await readApplicant(tx, userId),
          // A revoked teacher can still be banned (B13b review, follow-up 3).
          await store.banProfile(tx, userId, { kind: 'teacher' }),
          (await store.read(tx, userId))?.teacher?.verificationStatus,
        ] as const;
      },
    );
    expect([revoked, again, subjects]).toEqual([true, false, 0]);
    expect(detail).toMatchObject({ status: 'rejected', note: 'شكوى' });
    expect([bannedAfter, standingAfter]).toEqual([true, 'banned']);
  });
});
