// T126 — an identity request and a reinstatement of the same account never cross, and the audit's
// `before` of suspend, ban, recordCall and reject is read under a lock of the row it describes. Each
// move takes the kernel's row lock (`platform/db/row-lock.ts`) at the start of its transaction: the
// account's `users` row for opening an identity request, `reinstate`, `suspend` and `ban`, the
// application's `teacher_profiles` row for recording the call and `reject`.
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

import { revokeSubjects } from '../../apps/api/src/modules/catalog/index.js';
import {
  AccountConsequences,
  lockAccount,
  StandingService,
  standingStoreOver,
} from '../../apps/api/src/modules/identity/index.js';
import {
  createIdentityRequestStore,
  createVerificationAdminServices,
  openRequestOf,
} from '../../apps/api/src/modules/verification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { connectAsApplication, type Db, insertRow, makeAdmin, makeUser } from './harness';

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

/** A committed person with a submitted application in the given states; the user's id. */
async function teacher(values: {
  accountStatus: 'active' | 'suspended';
  applicationStatus: 'in_review' | 'approved';
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
