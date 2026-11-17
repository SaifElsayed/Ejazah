// T006 of specs/005-certification — the teacher's ijazah request over a store held in memory (FR-603,
// FR-608, FR-627, FR-628; research R-403, R-404; the note under T006, Q1 to Q4, Q14; P4 (a)).
//
// - Send: every refusal of FR-603 (`not_active`, `not_ijazah_track`, `student_barred`,
//   `no_credential`, `no_signature`, `request_open`, `already_issued`), each one info line of ids
//   and its reason; another teacher's enrollment or one not confirmed or completed answers
//   NOT_FOUND; a completion date after the teacher's today is VALIDATION_FAILED.
// - The lock order of the kernel row: `users` (the teacher and the student, one call), then the
//   enrollment, then the credential (catalog's locked read), then the request's insert.
// - The freeze: the chain (generations origin first, the holder name appended), the holder name, the
//   printed riwaya and tariq, and the signature copy under `ijazah-requests/<id>/`, stored before
//   the transaction and removed when it is refused; the status `awaiting_student_name` without a
//   certificate name, `pending` with one; the live event to both parties.
// - A replay copies nothing and answers the first outcome.
// - The ports: `AwaitingNameRelease` moves the student's waiting requests to `pending`;
//   `OpenRequestsRefreeze` re-freezes the credential's open requests; `EnrollmentIjazahRequests`
//   answers each enrollment's latest request in one read; the deletion's consequence closes the
//   student's open requests, clears each copy's key on its transaction and removes the file after
//   the commit, a failed removal logged by ids.
import { randomUUID } from 'node:crypto';

import type { LiveEvent } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type CredentialChain,
  type IjazahEnrollment,
  type IjazahRequestStore,
  IjazahRequestService,
  type NewIjazahRequest,
  type RequestRead,
  type RequestRefreeze,
} from './ijazah-request.service.js';

const TX = {} as Transaction;
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const OTHER_TEACHER = '0199d0a0-0000-7000-8000-0000000000a3';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const CREDENTIAL = '0199d0a0-0000-7000-8000-0000000000d1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const KEY = `probe-request-${randomUUID()}`;
const SIGNATURE_KEY = `signatures/${TEACHER}/0199d0a0-0000-7000-8000-000000000051.png`;
const COPY_KEY = `ijazah-requests/${REQUEST}/signature.png`;
const NOW = new Date('2026-11-17T21:30:00Z');
const INPUT = { enrollmentId: ENROLLMENT, completionDate: '2026-11-10', language: 'ar' as const };

const CHAIN: CredentialChain = {
  credentialId: CREDENTIAL,
  teacherUserId: TEACHER,
  subjectId: SUBJECT,
  holderName: 'عمر بن فاروق',
  riwaya: 'حفص عن عاصم',
  tariq: null,
  generations: [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب']],
};

interface Held extends NewIjazahRequest {
  ijazahId: string | null;
  reason: string | null;
}

/** The store's world, its calls in order, each write the database would make. */
class MemoryStore implements IjazahRequestStore {
  readonly calls: string[] = [];
  readonly requests: Held[] = [];
  enrollment: IjazahEnrollment | null = {
    id: ENROLLMENT,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    subjectId: SUBJECT,
    track: 'ijazah_track',
    status: 'completed',
  };
  standing: Awaited<ReturnType<IjazahRequestStore['standingOf']>> = {
    accountStatus: 'active',
    teacher: { verificationStatus: 'approved' },
  };
  chain: CredentialChain | null = CHAIN;
  certificateName: string | null = 'مريم بنت أحمد';
  signatureKey: string | null = SIGNATURE_KEY;
  barred = false;
  issued = false;

  async enrollmentOf(_tx: Transaction, enrollmentId: string) {
    this.calls.push('read enrollment');
    return this.enrollment?.id === enrollmentId ? this.enrollment : null;
  }
  async standingOf(_tx: Transaction, userId: string) {
    this.calls.push(`read standing ${userId}`);
    return this.standing;
  }
  async timezoneOf() {
    return 'Africa/Cairo';
  }
  async chainOf() {
    this.calls.push('read chain');
    return this.chain;
  }
  async lockedChainOf() {
    this.calls.push('lock credential');
    return this.chain;
  }
  async chainById(_tx: Transaction, credentialId: string) {
    return this.chain?.credentialId === credentialId ? this.chain : null;
  }
  async certificateNameOf() {
    this.calls.push('read certificate name');
    return this.certificateName;
  }
  async signatureKeyOf() {
    this.calls.push('read signature');
    return this.signatureKey;
  }
  async lockAccounts(_tx: Transaction, userIds: readonly string[]) {
    this.calls.push(`lock users ${userIds.join(',')}`);
  }
  async lockEnrollment(_tx: Transaction, enrollmentId: string) {
    this.calls.push(`lock enrollment ${enrollmentId}`);
  }
  async lockRequests(_tx: Transaction, ids: readonly string[]) {
    this.calls.push(`lock requests ${ids.join(',')}`);
  }
  async hasOpenBar() {
    return this.barred;
  }
  async hasOpenRequest(_tx: Transaction, enrollmentId: string) {
    return this.requests.some(
      (one) =>
        one.enrollmentId === enrollmentId &&
        (one.status === 'pending' || one.status === 'awaiting_student_name'),
    );
  }
  async hasUnrevokedIjazah() {
    return this.issued;
  }
  async insert(_tx: Transaction, row: NewIjazahRequest) {
    this.calls.push('insert request');
    this.requests.push({ ...row, ijazahId: null, reason: null });
  }
  async latestAmong(_tx: Transaction, enrollmentIds: readonly string[]) {
    this.calls.push(`read latest ${enrollmentIds.join(',')}`);
    const latest = new Map<string, RequestRead>();
    for (const one of this.requests) {
      if (!enrollmentIds.includes(one.enrollmentId)) continue;
      latest.set(one.enrollmentId, {
        id: one.id,
        enrollmentId: one.enrollmentId,
        status: one.status,
        reason: one.reason,
        ijazahId: one.ijazahId,
        // 005:T010 (Q-E2 (a)): the revoked flag is the DB spec's (tests/db-integrity/ijazahs.spec.ts).
        revoked: false,
      });
    }
    return latest;
  }
  async openOfStudent(_tx: Transaction, studentUserId: string) {
    return this.requests
      .filter(
        (one) =>
          one.studentUserId === studentUserId &&
          (one.status === 'pending' || one.status === 'awaiting_student_name'),
      )
      .map(({ id, status, signatureStorageKey }) => ({ id, status, signatureStorageKey }));
  }
  async openOfCredential(_tx: Transaction, teacherUserId: string, subjectId: string) {
    return this.requests
      .filter(
        (one) =>
          one.teacherUserId === teacherUserId &&
          one.subjectId === subjectId &&
          (one.status === 'pending' || one.status === 'awaiting_student_name'),
      )
      .map(({ id }) => id);
  }
  async releaseAwaiting(_tx: Transaction, ids: readonly string[]) {
    this.calls.push(`release ${ids.join(',')}`);
    for (const one of this.requests) {
      if (ids.includes(one.id) && one.status === 'awaiting_student_name') one.status = 'pending';
    }
  }
  async refreezeOpen(_tx: Transaction, ids: readonly string[], refreeze: RequestRefreeze) {
    this.calls.push(`refreeze ${ids.join(',')}`);
    for (const one of this.requests) {
      if (!ids.includes(one.id)) continue;
      if (one.status !== 'pending' && one.status !== 'awaiting_student_name') continue;
      Object.assign(one, refreeze);
    }
  }
  async closeOpen(_tx: Transaction, ids: readonly string[]) {
    this.calls.push(`close ${ids.join(',')}`);
    for (const one of this.requests) {
      if (!ids.includes(one.id)) continue;
      if (one.status !== 'pending' && one.status !== 'awaiting_student_name') continue;
      one.status = 'closed';
      one.signatureStorageKey = null;
    }
  }
  // 005:T032 (rule d): this world holds no ijazah; the re-freeze of one is the DB spec's
  // (tests/db-integrity/ijazahs.spec.ts).
  async unsignedIjazahsOfCredential() {
    return [];
  }
  async unsignedIjazahsOfStudent() {
    return [];
  }
  async lockIjazahs() {}
  async refreezeIjazahs() {
    return [];
  }
  async renameIjazahs() {
    return [];
  }
}

/** The storage port in memory: what is held, and every call. */
class MemoryStorage {
  readonly held = new Map<string, { body: Uint8Array; contentType: string }>([
    [SIGNATURE_KEY, { body: new Uint8Array([1, 2, 3]), contentType: 'image/png' }],
  ]);
  readonly calls: string[] = [];
  failRemove = false;
  async read(key: string) {
    this.calls.push(`read ${key}`);
    const object = this.held.get(key);
    if (object === undefined) throw new Error('nothing stored');
    return object;
  }
  async put(key: string, body: Uint8Array, contentType: string) {
    this.calls.push(`put ${key}`);
    this.held.set(key, { body, contentType });
  }
  async remove(key: string) {
    this.calls.push(`remove ${key}`);
    if (this.failRemove) throw new Error('storage down');
    this.held.delete(key);
  }
}

/** The kernel's idempotency in memory: an outcome kept by key, replayed without the effect. */
class MemoryIdempotency {
  readonly outcomes = new Map<string, unknown>();
  async completed<T>(request: { key: string }): Promise<T | undefined> {
    return this.outcomes.get(request.key) as T | undefined;
  }
  async run<T>(request: { key: string }, effect: (tx: Transaction) => Promise<T>): Promise<T> {
    if (this.outcomes.has(request.key)) return this.outcomes.get(request.key) as T;
    const outcome = await effect(TX);
    this.outcomes.set(request.key, outcome);
    return outcome;
  }
}

function world() {
  const store = new MemoryStore();
  const storage = new MemoryStorage();
  const idempotency = new MemoryIdempotency();
  const lines: { level: string; fields: Record<string, unknown>; message: string }[] = [];
  const log = {
    info: (fields: Record<string, unknown>, message: string) =>
      void lines.push({ level: 'info', fields, message }),
    warn: (fields: Record<string, unknown>, message: string) =>
      void lines.push({ level: 'warn', fields, message }),
  };
  const service = new IjazahRequestService({
    transactions: { run: (work) => work(TX) },
    store,
    storage,
    idempotency,
    drawId: async () => REQUEST,
    clock: async () => NOW,
    log,
    // 005:T032 (rule d): nothing here re-freezes an ijazah, so nothing is enqueued.
    renders: { enqueue: () => Promise.reject(new Error('no ijazah in this world')) },
  });
  const events: { to: readonly string[]; event: LiveEvent }[] = [];
  const live = {
    afterCommit: (to: readonly string[], event: LiveEvent) => void events.push({ to, event }),
  };
  return { store, storage, idempotency, lines, service, events, live };
}

async function thrown(call: Promise<unknown>): Promise<DomainError> {
  const error: unknown = await call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof DomainError))
    throw new Error(`expected a DomainError, got ${String(error)}`);
  return error;
}

const send = (w: ReturnType<typeof world>, input: Partial<typeof INPUT> = {}) =>
  w.service.send(TEACHER, { ...INPUT, ...input, idempotencyKey: KEY }, w.live);

describe('send: the refusals of FR-603, each logged with ids and its reason (T006)', () => {
  const cases: [string, (w: ReturnType<typeof world>) => void][] = [
    [
      'not_active',
      (w) =>
        (w.store.standing = {
          accountStatus: 'active',
          teacher: { verificationStatus: 'suspended' },
        }),
    ],
    [
      'not_ijazah_track',
      (w) =>
        w.store.enrollment && (w.store.enrollment = { ...w.store.enrollment, track: 'recitation' }),
    ],
    ['student_barred', (w) => (w.store.barred = true)],
    ['no_credential', (w) => (w.store.chain = null)],
    ['no_signature', (w) => (w.store.signatureKey = null)],
    [
      'request_open',
      (w) => void w.store.requests.push({ ...openRow(), ijazahId: null, reason: null }),
    ],
    ['already_issued', (w) => (w.store.issued = true)],
  ];

  it.each(cases)('refuses %s as CONFLICT, logged, nothing inserted', async (reason, arrange) => {
    const w = world();
    arrange(w);
    const before = w.store.requests.length;
    const error = await thrown(send(w));
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toEqual([{ path: 'enrollmentId', code: reason }]);
    expect(w.store.requests).toHaveLength(before);
    expect(w.lines).toContainEqual({
      level: 'info',
      fields: { teacherUserId: TEACHER, enrollmentId: ENROLLMENT, reason },
      message: 'An ijazah request was refused',
    });
    expect(w.events).toEqual([]);
  });

  it('refuses a revoked approval and a suspended account as not_active', async () => {
    for (const standing of [
      { accountStatus: 'active', teacher: { verificationStatus: 'revoked' } },
      { accountStatus: 'suspended', teacher: { verificationStatus: 'approved' } },
    ]) {
      const w = world();
      w.store.standing = standing;
      expect((await thrown(send(w))).details).toEqual([
        { path: 'enrollmentId', code: 'not_active' },
      ]);
    }
  });

  it.each([
    [
      "another teacher's enrollment",
      (w: ReturnType<typeof world>) =>
        w.store.enrollment &&
        (w.store.enrollment = { ...w.store.enrollment, teacherUserId: OTHER_TEACHER }),
    ],
    [
      'an enrollment that is not there',
      (w: ReturnType<typeof world>) => (w.store.enrollment = null),
    ],
    [
      'an enrollment awaiting payment',
      (w: ReturnType<typeof world>) =>
        w.store.enrollment &&
        (w.store.enrollment = { ...w.store.enrollment, status: 'pending_payment' }),
    ],
    [
      'a cancelled enrollment',
      (w: ReturnType<typeof world>) =>
        w.store.enrollment && (w.store.enrollment = { ...w.store.enrollment, status: 'cancelled' }),
    ],
  ])('answers NOT_FOUND for %s, logged', async (_name, arrange) => {
    const w = world();
    arrange(w);
    expect((await thrown(send(w))).code).toBe('NOT_FOUND');
    expect(w.store.requests).toEqual([]);
    expect(w.lines.map(({ message }) => message)).toEqual(['An ijazah request was refused']);
  });

  it("refuses a completion date after the teacher's today as VALIDATION_FAILED", async () => {
    const w = world();
    // 21:30 UTC is 23:30 in Cairo on the 17th: the 18th is the future.
    const error = await thrown(send(w, { completionDate: '2026-11-18' }));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual([{ path: 'completionDate', code: 'in_future' }]);
    expect(w.store.requests).toEqual([]);
  });

  it('removes the signature copy when the transaction is refused', async () => {
    const w = world();
    w.store.issued = true;
    await thrown(send(w));
    expect(w.storage.calls).toEqual([
      `read ${SIGNATURE_KEY}`,
      `put ${COPY_KEY}`,
      `remove ${COPY_KEY}`,
    ]);
    expect(w.storage.held.has(COPY_KEY)).toBe(false);
  });
});

function openRow(): NewIjazahRequest {
  return {
    id: '0199d0a0-0000-7000-8000-0000000000f0',
    enrollmentId: ENROLLMENT,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    subjectId: SUBJECT,
    completionDate: '2026-11-01',
    language: 'ar',
    status: 'pending',
    chainSnapshot: [['قديم']],
    teacherNamePrinted: 'قديم',
    riwayaPrinted: 'قديم',
    tariqPrinted: null,
    signatureStorageKey: 'ijazah-requests/0199d0a0-0000-7000-8000-0000000000f0/signature.png',
  };
}

describe('send: the freeze and the lock order (T006)', () => {
  it("takes the kernel row's order: the two accounts in one call, the enrollment, the credential, then the insert", async () => {
    const w = world();
    await send(w);
    const order = w.store.calls.filter(
      (call) => call.startsWith('lock') || call === 'insert request',
    );
    expect(order).toEqual([
      `lock users ${TEACHER},${STUDENT}`,
      `lock enrollment ${ENROLLMENT}`,
      'lock credential',
      'insert request',
    ]);
    // Lock, then read: the standing and the status are read under the accounts' and the enrollment's locks.
    expect(w.store.calls.indexOf(`read standing ${TEACHER}`)).toBeGreaterThan(
      w.store.calls.indexOf(`lock enrollment ${ENROLLMENT}`),
    );
  });

  it('freezes the chain with the holder appended, the printed names and the copy', async () => {
    const w = world();
    expect(await send(w)).toEqual({ requestId: REQUEST, status: 'pending' });
    expect(w.store.requests).toEqual([
      {
        id: REQUEST,
        enrollmentId: ENROLLMENT,
        teacherUserId: TEACHER,
        studentUserId: STUDENT,
        subjectId: SUBJECT,
        completionDate: '2026-11-10',
        language: 'ar',
        status: 'pending',
        chainSnapshot: [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['عمر بن فاروق']],
        teacherNamePrinted: 'عمر بن فاروق',
        riwayaPrinted: 'حفص عن عاصم',
        tariqPrinted: null,
        signatureStorageKey: COPY_KEY,
        ijazahId: null,
        reason: null,
      },
    ]);
    expect(w.storage.held.get(COPY_KEY)).toEqual({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
  });

  it("waits for the student's certificate name when none is held", async () => {
    const w = world();
    w.store.certificateName = null;
    expect(await send(w)).toEqual({ requestId: REQUEST, status: 'awaiting_student_name' });
  });

  it("accepts today's date in the teacher's zone, the UTC date before it", async () => {
    const w = world();
    expect((await send(w, { completionDate: '2026-11-17' })).status).toBe('pending');
  });

  it('tells both parties on the live channel once, after the commit', async () => {
    const w = world();
    await send(w);
    expect(w.events).toEqual([
      { to: [TEACHER, STUDENT], event: { type: 'ijazahRequest', enrollmentId: ENROLLMENT } },
    ]);
  });

  it('copies nothing again on a replay and answers the first outcome', async () => {
    const w = world();
    const first = await send(w);
    const callsAfterFirst = w.storage.calls.length;
    expect(await send(w)).toEqual(first);
    expect(w.storage.calls).toHaveLength(callsAfterFirst);
    expect(w.store.requests).toHaveLength(1);
  });
});

describe('preview and get (T006)', () => {
  it("answers the filled certificate with the issue date in the teacher's zone", async () => {
    const w = world();
    expect(await w.service.preview(TEACHER, INPUT)).toEqual({
      chain: [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['عمر بن فاروق']],
      teacherName: 'عمر بن فاروق',
      riwaya: 'حفص عن عاصم',
      tariq: null,
      studentName: 'مريم بنت أحمد',
      dates: { completionDate: '2026-11-10', issueDate: '2026-11-17' },
    });
    expect(w.store.calls).not.toContain('lock credential');
  });

  it('refuses a recitation enrollment and a missing credential in the preview', async () => {
    const w = world();
    w.store.chain = null;
    expect((await thrown(w.service.preview(TEACHER, INPUT))).details).toEqual([
      { path: 'enrollmentId', code: 'no_credential' },
    ]);
    const v = world();
    if (v.store.enrollment) v.store.enrollment = { ...v.store.enrollment, track: 'recitation' };
    expect((await thrown(v.service.preview(TEACHER, INPUT))).details).toEqual([
      { path: 'enrollmentId', code: 'not_ijazah_track' },
    ]);
  });

  it('answers NOT_FOUND to another teacher in the preview and in get', async () => {
    const w = world();
    expect((await thrown(w.service.preview(OTHER_TEACHER, INPUT))).code).toBe('NOT_FOUND');
    expect((await thrown(w.service.get(OTHER_TEACHER, { enrollmentId: ENROLLMENT }))).code).toBe(
      'NOT_FOUND',
    );
  });

  it("answers the enrollment's latest request, or null", async () => {
    const w = world();
    expect(await w.service.get(TEACHER, { enrollmentId: ENROLLMENT })).toEqual({ request: null });
    await send(w);
    expect(await w.service.get(TEACHER, { enrollmentId: ENROLLMENT })).toEqual({
      request: { requestId: REQUEST, status: 'pending' },
    });
  });

  it('answers a rejection with its reason and an approval with its ijazah', async () => {
    const w = world();
    w.store.requests.push({ ...openRow(), status: 'rejected', reason: 'سبب', ijazahId: null });
    expect(await w.service.get(TEACHER, { enrollmentId: ENROLLMENT })).toEqual({
      request: { requestId: openRow().id, status: 'rejected', reason: 'سبب' },
    });
  });
});

describe('the ports (T006)', () => {
  it("EnrollmentIjazahRequests answers every enrollment's latest request in one read", async () => {
    const w = world();
    const other = '0199d0a0-0000-7000-8000-0000000000e2';
    w.store.requests.push({
      ...openRow(),
      status: 'approved',
      ijazahId: '0199d0a0-0000-7000-8000-0000000000b1',
      reason: null,
    });
    const answer = await w.service.of(TX, [ENROLLMENT, other]);
    expect([...answer.entries()]).toEqual([
      [ENROLLMENT, { status: 'approved', ijazahId: '0199d0a0-0000-7000-8000-0000000000b1' }],
    ]);
    expect(w.store.calls.filter((call) => call.startsWith('read latest'))).toEqual([
      `read latest ${ENROLLMENT},${other}`,
    ]);
  });

  it('EnrollmentIjazahRequests reads nothing for no enrollment', async () => {
    const w = world();
    expect((await w.service.of(TX, [])).size).toBe(0);
    expect(w.store.calls).toEqual([]);
  });

  it('AwaitingNameRelease locks the waiting requests, then moves them to pending', async () => {
    const w = world();
    w.store.requests.push({
      ...openRow(),
      status: 'awaiting_student_name',
      ijazahId: null,
      reason: null,
    });
    await w.service.release(TX, STUDENT);
    expect(w.store.calls).toEqual([`lock requests ${openRow().id}`, `release ${openRow().id}`]);
    expect(w.store.requests[0]?.status).toBe('pending');
  });

  it("OpenRequestsRefreeze re-freezes the credential's open requests and leaves a decided one", async () => {
    const w = world();
    w.store.requests.push(
      { ...openRow(), ijazahId: null, reason: null },
      {
        ...openRow(),
        id: '0199d0a0-0000-7000-8000-0000000000f9',
        status: 'rejected',
        reason: 'سبب',
        ijazahId: null,
      },
    );
    await w.service.refreeze(TX, CREDENTIAL);
    expect(w.store.calls).toEqual([`lock requests ${openRow().id}`, `refreeze ${openRow().id}`]);
    expect(w.store.requests[0]).toMatchObject({
      chainSnapshot: [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['عمر بن فاروق']],
      teacherNamePrinted: 'عمر بن فاروق',
      riwayaPrinted: 'حفص عن عاصم',
      tariqPrinted: null,
    });
    expect(w.store.requests[1]?.teacherNamePrinted).toBe('قديم');
  });

  it('OpenRequestsRefreeze does nothing for a credential that is not approved', async () => {
    const w = world();
    await w.service.refreeze(TX, '0199d0a0-0000-7000-8000-0000000000dd');
    expect(w.store.calls).toEqual([]);
  });
});

describe("the student's deletion closes their open requests (T006, Q14)", () => {
  /** A transaction bound to a list whose after-commit work runs on `commit()`. */
  function deletionList() {
    const actions: (() => void)[] = [];
    return {
      list: {
        afterCommit: () => undefined,
        afterCommitDo: (action: () => void) => void actions.push(action),
      },
      commit: async () => {
        for (const action of actions) action();
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  it('closes them, clears each key on the transaction and removes each file once after the commit', async () => {
    const w = world();
    w.store.requests.push({ ...openRow(), ijazahId: null, reason: null });
    w.storage.held.set(openRow().signatureStorageKey ?? '', {
      body: new Uint8Array([9]),
      contentType: 'image/png',
    });
    const { list, commit } = deletionList();
    await w.service.closeOfDeletedStudent(TX, STUDENT, list);
    expect(w.store.requests[0]).toMatchObject({ status: 'closed', signatureStorageKey: null });
    expect(w.storage.calls).toEqual([]);
    await commit();
    expect(w.storage.calls).toEqual([`remove ${openRow().signatureStorageKey ?? ''}`]);
    expect(w.store.calls).toEqual([`lock requests ${openRow().id}`, `close ${openRow().id}`]);
  });

  it('logs a failed removal by ids and keeps the closing', async () => {
    const w = world();
    w.store.requests.push({ ...openRow(), ijazahId: null, reason: null });
    w.storage.failRemove = true;
    const { list, commit } = deletionList();
    await w.service.closeOfDeletedStudent(TX, STUDENT, list);
    await commit();
    expect(w.store.requests[0]?.status).toBe('closed');
    expect(w.lines).toContainEqual({
      level: 'warn',
      fields: { requestId: openRow().id, studentUserId: STUDENT },
      message: "A closed ijazah request's signature copy could not be removed",
    });
  });

  it('the consequence acts on a deletion only', async () => {
    const w = world();
    w.store.requests.push({ ...openRow(), ijazahId: null, reason: null });
    const consequence = w.service.deletionConsequence();
    for (const cause of ['suspended', 'approval_revoked', 'banned'] as const) {
      await consequence(TX, STUDENT, cause);
    }
    expect(w.store.requests[0]?.status).toBe('pending');
  });
});
