// T126 — an identity request and a reinstatement of the same account never cross, and the audit's
// `before` of suspend, ban, recordCall and reject is read under a lock of the row it describes. Each
// move takes the kernel's row lock (`platform/db/row-lock.ts`) at the start of its transaction: the
// account's `users` row for opening an identity request, `reinstate`, `suspend` and `ban`, the
// application's `teacher_profiles` row for recording the call and `reject`. T164 adds `approve`,
// `requestInfo` and `applications.ban` (the account's row first, then the application's), and the
// identity document's `accept` and `requestAnother` (the account's row). Wherever one transaction
// takes both, the account's row comes first (the owner's decision of 2026-11-01). T161 adds the
// resubmission and a credential's document request, both on the application's row; T142 a
// credential's approval, on the same row, against a revocation. Both approvals lock the account
// before the application, since their grant references the teacher's `users` row and a ban holds
// it while it waits on the application (the owner's decision of 2026-11-01).
//
// HOW A RACE IS STAGED, as `booking-concurrency.spec.ts` stages it. Transaction A runs its move and
// stays open; transaction B starts its move and is seen waiting on a lock by a watcher reading
// `pg_stat_activity`, so the order is decided by the database, not by timing; then A commits and B
// ends. Every probe asserts what B read, through what it answered or what it left: without the lock
// at the start, B reads the committed state from before A and decides on it, which is the crossing
// T126 names. A and B commit, so the rows are real; each probe writes a person of its own, and the
// parents stay as the other probes here leave theirs. All three connections are the application
// role: PostgreSQL hides the wait of another role's session from a non-superuser.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCredentialReviewService,
  revokeSubjects,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  lockAccount,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createIdentityRequestStore,
  createVerificationAdminServices,
  createVerificationServices,
  openRequestOf,
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
  makeSubject,
  makeUser,
} from './harness';

let db: Db;
let watcher: Db;
let database: Database;
let standing: StandingService;
let review: ReturnType<typeof createVerificationAdminServices>;
let credentials: ReturnType<typeof createCredentialReviewService>;

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
  credentials = createCredentialReviewService({ settings: { read: unused } });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  await closeDatabase(database);
});

/** A committed person with a submitted application in the given states; the user's id. */
async function teacher(values: {
  accountStatus: 'active' | 'suspended';
  applicationStatus: 'in_review' | 'needs_document' | 'approved';
}): Promise<string> {
  const userId = await makeUser(db, { account_status: values.accountStatus });
  const documentId = await insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: 'national_id',
    storage_key_encrypted: Buffer.from('probe'),
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: userId,
    bio: '',
    qualification_summary: 'إجازة في حفص',
    verification_status: values.applicationStatus === 'approved' ? 'approved' : 'pending',
    application_status: values.applicationStatus,
    application_submitted_at: '2026-10-18T09:00:00Z',
    identity_document_id: documentId,
    identity_document_type: 'national_id',
  });
  return userId;
}

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

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

/**
 * A runs `first` and stays open; B runs `second` and is seen waiting; A commits. Answers how B
 * ended: its value, or what it threw.
 */
async function race<T>(
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<T>,
): Promise<{ readonly value: T } | { readonly thrown: unknown }> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = (): void => undefined;
  const firstRan = new Promise<void>((resolve) => {
    ran = resolve;
  });
  const a = database.$transaction(async (tx) => {
    await first(tx);
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
      (value) => ({ value }),
      (thrown: unknown) => ({ thrown }),
    );
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
    await a;
  }
  return b;
}

async function accountStatusOf(userId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ account_status: string }>(
    'SELECT account_status FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.account_status;
}

async function openRequestsOf(userId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM verification_requests WHERE user_id = $1 AND status = 'open'`,
    [userId],
  );
  return Number(rows[0]?.count ?? '0');
}

describe('an identity request and a reinstatement of the same account (T126)', () => {
  it('a request waits for a reinstatement holding the account, then opens on the active account', async () => {
    const userId = await teacher({ accountStatus: 'suspended', applicationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const ended = await race(
      (tx) => standing.reinstate(tx, adminId, userId),
      (tx) => review.documents.requireIdentity(tx, adminId, { userId, reason: 'بلاغ' }),
    );
    expect(ended).toMatchObject({ value: { requestId: expect.any(String) } });
    expect(await accountStatusOf(userId)).toBe('verification_required');
    expect(await openRequestsOf(userId)).toBe(1);
  });

  it('a reinstatement waits for a request written under the account’s lock, then lands on verification_required', async () => {
    // A writes the request as `requireIdentity` writes it: the account's lock first, then the row.
    const userId = await teacher({ accountStatus: 'suspended', applicationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const requests = createIdentityRequestStore(database);
    const ended = await race(
      async (tx) => {
        await lockAccount(tx, userId);
        await requests.openRequest(tx, { userId, adminId, reason: 'بلاغ', at: new Date() });
      },
      (tx) => standing.reinstate(tx, adminId, userId),
    );
    expect(ended).toEqual({
      value: {
        before: { accountStatus: 'suspended' },
        after: { accountStatus: 'verification_required' },
      },
    });
    expect(await accountStatusOf(userId)).toBe('verification_required');
    expect(await openRequestsOf(userId)).toBe(1);
  });
});

describe("the audit's before, read under the account's lock (T126)", () => {
  it('suspend waits for an identity request and answers verification_required as its before', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const ended = await race(
      (tx) => review.documents.requireIdentity(tx, adminId, { userId, reason: 'بلاغ' }),
      (tx) => standing.suspend(tx, adminId, userId),
    );
    expect(ended).toEqual({
      value: {
        before: { accountStatus: 'verification_required' },
        after: { accountStatus: 'suspended' },
      },
    });
  });

  it('ban waits for an identity request and answers verification_required as its before', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const ended = await race(
      (tx) => review.documents.requireIdentity(tx, adminId, { userId, reason: 'بلاغ' }),
      (tx) => standing.ban(tx, adminId, userId),
    );
    expect(ended).toMatchObject({
      value: {
        before: { accountStatus: 'verification_required' },
        after: { accountStatus: 'banned' },
      },
    });
  });
});

describe("the audit's before, read under the application's lock (T126)", () => {
  const call = (outcome: 'suitable' | 'unsuitable') =>
    ({
      completedOn: '2026-10-22',
      timeZone: 'Africa/Cairo',
      outcome,
      notes: 'أجاب عن الأسئلة',
    }) as const;

  it('recordCall waits for another call being recorded and answers that call as its before', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'in_review' });
    const adminId = await makeAdmin(db);
    const ended = await race(
      (tx) =>
        review.applications.recordCall(tx, adminId, {
          teacherUserId: userId,
          ...call('unsuitable'),
        }),
      (tx) =>
        review.applications.recordCall(tx, adminId, { teacherUserId: userId, ...call('suitable') }),
    );
    expect(ended).toEqual({
      value: {
        before: { completedOn: '2026-10-22', outcome: 'unsuitable' },
        after: { completedOn: '2026-10-22', outcome: 'suitable' },
      },
    });
  });

  it('reject waits for a request for information and answers needs_document as its before', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'in_review' });
    const adminId = await makeAdmin(db);
    const ended = await race(
      (tx) =>
        review.applications.requestInfo(tx, adminId, {
          teacherUserId: userId,
          needed: ['other'],
          note: 'صورة أوضح',
        }),
      (tx) =>
        review.applications.reject(tx, adminId, {
          teacherUserId: userId,
          reasonChoice: 'other',
          note: 'لم يُرسل المطلوب',
        }),
    );
    expect(ended).toEqual({
      value: { before: { status: 'needs_document' }, after: { status: 'rejected' } },
    });
  });
});

/**
 * A committed credential sent with the teacher's application, approved by `adminId` when one is
 * given, else pending; its id and its subject's.
 */
async function applicationCredential(
  userId: string,
  approvedBy?: string,
): Promise<{ readonly credentialId: string; readonly subjectId: string }> {
  const subjectId = await makeSubject(db);
  const documentId = await insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: 'credential',
    storage_key_encrypted: Buffer.from('probe'),
  });
  const credentialId = await insertRow(db, 'teacher_credentials', {
    teacher_user_id: userId,
    subject_id: subjectId,
    document_id: documentId,
    submitted_with_application: true,
    // The application's credentials share its submission's instant (`teacher()` above).
    created_at: '2026-10-18T09:00:00Z',
    ...(approvedBy === undefined
      ? { status: 'pending' }
      : {
          status: 'approved',
          reviewed_by_admin_id: approvedBy,
          reviewed_at: '2026-10-18T09:00:00Z',
        }),
  });
  return { credentialId, subjectId };
}

/** A committed open identity request holding a document the person uploaded; its id. */
async function requestWithDocument(userId: string, adminId: string): Promise<string> {
  const documentId = await insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: 'passport',
    storage_key_encrypted: Buffer.from('probe'),
  });
  const requests = createIdentityRequestStore(database);
  return database.$transaction(async (tx) => {
    const requestId = await requests.openRequest(tx, {
      userId,
      adminId,
      reason: 'بلاغ',
      at: new Date(),
    });
    await requests.attachDocument(tx, { requestId, documentId, documentType: 'passport' });
    return requestId;
  });
}

describe("the application's other decisions, under its lock (T164)", () => {
  it('ban waits for a request for information and answers needs_document as its before', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'in_review' });
    const adminId = await makeAdmin(db);
    const ended = await race(
      (tx) =>
        review.applications.requestInfo(tx, adminId, {
          teacherUserId: userId,
          needed: ['other'],
          note: 'صورة أوضح',
        }),
      (tx) =>
        review.applications.ban(tx, adminId, {
          teacherUserId: userId,
          reasonChoice: 'other',
          note: 'وثائق مزورة',
        }),
    );
    expect(ended).toEqual({
      value: { before: { status: 'needs_document' }, after: { status: 'banned' } },
    });
  });

  it('approve waits for the call being recorded, then approves on it', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'in_review' });
    const adminId = await makeAdmin(db);
    const { subjectId } = await applicationCredential(userId, adminId);
    const ended = await race(
      (tx) =>
        review.applications.recordCall(tx, adminId, {
          teacherUserId: userId,
          completedOn: '2026-10-22',
          timeZone: 'Africa/Cairo',
          outcome: 'suitable',
          notes: 'أجاب عن الأسئلة',
        }),
      (tx) => review.applications.approve(tx, adminId, { teacherUserId: userId }),
    );
    expect(ended).toEqual({
      value: {
        before: { status: 'in_review' },
        after: { status: 'approved' },
        subjectIds: [subjectId],
      },
    });
  });
});

describe("the identity document's decisions, under the account's lock (T164)", () => {
  it('a reinstatement waits for an acceptance, then lands active with no request open', async () => {
    const userId = await teacher({ accountStatus: 'suspended', applicationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const requestId = await requestWithDocument(userId, adminId);
    const ended = await race(
      (tx) => review.documents.accept(tx, adminId, { requestId }),
      (tx) => standing.reinstate(tx, adminId, userId),
    );
    expect(ended).toEqual({
      value: { before: { accountStatus: 'suspended' }, after: { accountStatus: 'active' } },
    });
    expect(await accountStatusOf(userId)).toBe('active');
    expect(await openRequestsOf(userId)).toBe(0);
  });
});

async function applicationStatusOf(userId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ application_status: string }>(
    'SELECT application_status FROM teacher_profiles WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.application_status;
}

/**
 * The applicant's application service with `tx` as its own transaction, so the race's B is the
 * resubmission as the phone calls it: it opens its transaction through the client's `$transaction`.
 */
function applicationIn(tx: Transaction) {
  const inside = new Proxy(database, {
    get: (target, key) =>
      key === '$transaction'
        ? <T>(work: (held: Transaction) => Promise<T>): Promise<T> => work(tx)
        : Reflect.get(target, key),
  });
  return createVerificationServices({
    database: inside,
    storage: { temporaryLink: unused },
    cipher: { decrypt: () => unused() as never },
    settings: { read: unused },
    idempotency: { run: unused },
  }).application;
}

describe("a resubmission and a credential's document request (T161)", () => {
  it('a resubmission waits for a document request, then is refused while the credential waits', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'needs_document' });
    const adminId = await makeAdmin(db);
    const { credentialId } = await applicationCredential(userId);
    const identityDocumentId = await insertRow(db, 'verification_documents', {
      user_id: userId,
      document_type: 'national_id',
      storage_key_encrypted: Buffer.from('probe'),
    });
    const ended = await race(
      (tx) => credentials.requestDocument(tx, adminId, { credentialId, reason: 'الختم غير واضح' }),
      (tx) => applicationIn(tx).resubmit(userId, { identityDocumentId }),
    );
    expect(ended).toMatchObject({ thrown: { code: 'APPLICATION_INCOMPLETE' } });
    expect(await applicationStatusOf(userId)).toBe('needs_document');
  });
});

async function subjectsOf(userId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM teacher_subjects WHERE teacher_user_id = $1',
    [userId],
  );
  return Number(rows[0]?.count ?? '0');
}

describe("a credential's approval and a revocation (T142)", () => {
  it('an approval waits for a revocation, then grants no subject to the teacher no longer approved', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const { credentialId } = await applicationCredential(userId);
    const ended = await race(
      (tx) => standing.revokeApproval(tx, adminId, userId, 'وثائق لا تطابق'),
      (tx) =>
        credentials.approve(tx, adminId, {
          credentialId,
          holderName: 'عمر بن فاروق',
          riwaya: 'حفص عن عاصم',
          chain: [{ names: ['رسول الله ﷺ'] }, { names: ['جبريل'] }],
        }),
    );
    expect(ended).toMatchObject({ value: { after: { holderName: 'عمر بن فاروق' } } });
    expect(await subjectsOf(userId)).toBe(0);
  });
});

type Ended<T> = { readonly value: T } | { readonly thrown: string };

/** A settled transaction: its value, or the message of what it threw. */
function settled<T>(transaction: Promise<T>): Promise<Ended<T>> {
  return transaction.then(
    (value) => ({ value }),
    (thrown: unknown) => ({ thrown: thrown instanceof Error ? thrown.message : String(thrown) }),
  );
}

/**
 * `tx` as a move sees it, except that granting subjects (`teacherSubject.createMany`, whose foreign
 * key to `users` takes a key-share lock on the teacher's row) first says it was reached and waits
 * for `resumed`, so the move pauses holding every lock it took before the grant.
 */
function pausedBeforeGrant(tx: Transaction, reached: () => void, resumed: Promise<void>) {
  const bound = (target: object, key: string | symbol): unknown => {
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  };
  return new Proxy(tx, {
    get: (target, key) => {
      if (key !== 'teacherSubject') return bound(target, key);
      const subjects = target.teacherSubject;
      return new Proxy(subjects, {
        get: (inner, name) =>
          name === 'createMany'
            ? async (...args: unknown[]): Promise<unknown> => {
                reached();
                await resumed;
                return (inner.createMany as (...given: unknown[]) => Promise<unknown>)(...args);
              }
            : bound(inner, name),
      });
    },
  });
}

/**
 * A runs `first` up to its grant of subjects and pauses there; B runs `second` and is seen waiting;
 * A resumes. Answers how each ended: without the account's lock first, A's grant then waits on B's
 * account lock while B waits on A's application lock, and PostgreSQL aborts one (40P01).
 */
async function raceAtGrant<T>(
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<T>,
): Promise<{ readonly first: Ended<unknown>; readonly second: Ended<T> }> {
  let resume = (): void => undefined;
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let reach = (): void => undefined;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const a = settled(
    database.$transaction((tx) => first(pausedBeforeGrant(tx, reach, resumed)), OPTIONS),
  );
  await Promise.race([reached, a]);
  let pidOfB = (_pid: number): void => undefined;
  const bStarted = new Promise<number>((resolve) => {
    pidOfB = resolve;
  });
  const b = settled(
    database.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pidOfB(row?.pid ?? 0);
      return second(tx);
    }, OPTIONS),
  );
  try {
    await seenWaiting(await bStarted);
  } finally {
    resume();
  }
  return { first: await a, second: await b };
}

describe('an approval and a ban of the same teacher, the account locked first (T164, T142)', () => {
  it('applications.approve and teachers.ban: the ban waits, then bans the teacher approved', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'in_review' });
    const adminId = await makeAdmin(db);
    const { subjectId } = await applicationCredential(userId, adminId);
    await db.query(
      `UPDATE teacher_profiles SET verification_call_completed_on = '2026-10-22',
              verification_call_outcome = 'suitable' WHERE user_id = $1`,
      [userId],
    );
    const ended = await raceAtGrant(
      (tx) => review.applications.approve(tx, adminId, { teacherUserId: userId }),
      (tx) => standing.ban(tx, adminId, userId),
    );
    expect(ended).toEqual({
      first: {
        value: {
          before: { status: 'in_review' },
          after: { status: 'approved' },
          subjectIds: [subjectId],
        },
      },
      second: {
        value: {
          before: { accountStatus: 'active' },
          after: { accountStatus: 'banned' },
          applicationStatus: 'approved',
        },
      },
    });
    expect(await accountStatusOf(userId)).toBe('banned');
  });

  it('credentials.approve and teachers.ban: the ban waits, then bans the teacher the subject went to', async () => {
    const userId = await teacher({ accountStatus: 'active', applicationStatus: 'approved' });
    const adminId = await makeAdmin(db);
    const { credentialId } = await applicationCredential(userId);
    const ended = await raceAtGrant(
      (tx) =>
        credentials.approve(tx, adminId, {
          credentialId,
          holderName: 'عمر بن فاروق',
          riwaya: 'حفص عن عاصم',
          chain: [{ names: ['رسول الله ﷺ'] }, { names: ['جبريل'] }],
        }),
      (tx) => standing.ban(tx, adminId, userId),
    );
    expect(ended).toMatchObject({
      first: { value: { after: { holderName: 'عمر بن فاروق' } } },
      second: {
        value: {
          before: { accountStatus: 'active' },
          after: { accountStatus: 'banned' },
          applicationStatus: 'approved',
        },
      },
    });
    expect(await accountStatusOf(userId)).toBe('banned');
    expect(await subjectsOf(userId)).toBe(1);
  });
});
