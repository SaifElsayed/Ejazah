// T007 of specs/005-certification — the administrators' review over a store held in memory (FR-604,
// FR-605, FR-610, FR-628; research R-402; ADR 0013; the note under T007, Q7 (a), Q10 (a), Q15 (a)).
//
// - Approve: one ijazah per request under a replay and under a second key; `mode` `generated`,
//   `paper_copy_intended` false; the number and the token minted, the token stored only hashed and
//   never answered or logged; the frozen chain, names, riwaya and tariq copied from the request, the
//   student's printed name read now, the completion date always from the request; generation 0's
//   key reserved; the request `approved`; refused `student_barred` (FR-610, Q7 (a)) and
//   `not_pending`, NOT_FOUND for an unknown request; the kernel row's order (the student's `users`
//   row, then the request, then the reads); the live event and the render's enqueue only after the
//   commit, a failed enqueue logged by ids.
// - Reject: a reason, the request `rejected`, the copy's key cleared on the transaction and its file
//   removed once after the commit, a failed removal logged by ids; refused `not_pending`.
// - List and detail: the queue by status after a cursor, the parties, the subject and the teacher's
//   standing; the detail's frozen certificate, the student's name now and the signature's link.
import type { LiveEvent } from '@ijazah/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { bindToTransaction } from '../../platform/live/live-publisher.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type DecisionParty,
  type DecisionRequest,
  type IjazahDecisionStore,
  IjazahDecisionService,
  type NewIjazah,
  type RequestPageQuery,
} from './ijazah-decision.service.js';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000ad';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const SECOND = '0199d0a0-0000-7000-8000-0000000000f2';
const IJAZAH = '0199d0a0-0000-7000-8000-0000000000b1';
const NUMBER = '7K3MQ9TD2XWB8HRN';
const TOKEN = 'minted-token-0123456789abcdefghijklmnopqrstuv';
const HASH = `sha256(${TOKEN})`;
const KEY = 'decision-key-for-the-spec-0001';
const OTHER_KEY = 'decision-key-for-the-spec-0002';
const COPY_KEY = `ijazah-requests/${REQUEST}/signature.png`;
const NOW = new Date('2026-11-17T12:00:00.000Z');
const CHAIN = [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['عمر بن فاروق']];
const STUDENT_NAME = 'مريم بنت أحمد';

function requestRow(change: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    id: REQUEST,
    enrollmentId: ENROLLMENT,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    subjectId: SUBJECT,
    status: 'pending',
    completionDate: new Date('2026-11-10T00:00:00.000Z'),
    language: 'en',
    chainSnapshot: CHAIN,
    teacherNamePrinted: 'عمر بن فاروق',
    riwayaPrinted: 'حفص عن عاصم',
    tariqPrinted: 'الشاطبية',
    signatureStorageKey: COPY_KEY,
    reason: null,
    decidedAt: null,
    createdAt: new Date('2026-11-17T09:00:00.000Z'),
    ...change,
  };
}

interface HeldRequest extends DecisionRequest {
  decidedByAdminId: string | null;
}

/** The store's world, its calls in order, each write the database would make. */
class MemoryStore implements IjazahDecisionStore {
  readonly calls: string[] = [];
  requests: HeldRequest[] = [{ ...requestRow(), decidedByAdminId: null }];
  readonly ijazahs: NewIjazah[] = [];
  parties = new Map<string, DecisionParty>([
    [TEACHER, { displayName: 'عمر', accountStatus: 'active', teacherApproved: true }],
    [STUDENT, { displayName: 'مريم', accountStatus: 'active', teacherApproved: false }],
  ]);
  certificateName: string | null = STUDENT_NAME;
  barred = false;

  async requestOf(_tx: Transaction, requestId: string) {
    this.calls.push(`read request ${requestId}`);
    return this.requests.find(({ id }) => id === requestId) ?? null;
  }
  async page(_tx: Transaction, { status, after, take }: RequestPageQuery) {
    this.calls.push(`page ${status ?? 'all'} after ${after ?? '-'} take ${take}`);
    return this.requests
      .filter(
        (one) =>
          (status === undefined || one.status === status) &&
          (after === undefined || one.id > after),
      )
      .slice(0, take);
  }
  async ijazahOf(_tx: Transaction, requestId: string) {
    return this.ijazahs.find((one) => one.requestId === requestId)?.id ?? null;
  }
  async partiesOf(_tx: Transaction, userIds: readonly string[]) {
    this.calls.push(`read parties ${userIds.join(',')}`);
    return new Map([...this.parties].filter(([id]) => userIds.includes(id)));
  }
  async subjectsOf(_tx: Transaction, subjectIds: readonly string[]) {
    this.calls.push(`read subjects ${subjectIds.join(',')}`);
    return new Map(
      subjectIds.map((id) => [id, { id, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' }]),
    );
  }
  async certificateNameOf() {
    this.calls.push('read certificate name');
    return this.certificateName;
  }
  async lockAccounts(_tx: Transaction, userIds: readonly string[]) {
    this.calls.push(`lock users ${userIds.join(',')}`);
  }
  async lockRequests(_tx: Transaction, ids: readonly string[]) {
    this.calls.push(`lock requests ${ids.join(',')}`);
  }
  async hasOpenBar() {
    this.calls.push('read bar');
    return this.barred;
  }
  async insertIjazah(_tx: Transaction, row: NewIjazah) {
    this.calls.push('insert ijazah');
    if (this.ijazahs.some((one) => one.requestId === row.requestId)) {
      throw new Error('ijazahs_request_id_key');
    }
    this.ijazahs.push(row);
  }
  async markApproved(_tx: Transaction, requestId: string, adminId: string, at: Date) {
    this.calls.push('approve request');
    const one = this.requests.find(({ id }) => id === requestId);
    if (one?.status !== 'pending') return false;
    Object.assign(one, { status: 'approved', decidedByAdminId: adminId, decidedAt: at });
    return true;
  }
  async markRejected(
    _tx: Transaction,
    requestId: string,
    adminId: string,
    reason: string,
    at: Date,
  ) {
    this.calls.push('reject request');
    const one = this.requests.find(({ id }) => id === requestId);
    if (one === undefined || (one.status !== 'pending' && one.status !== 'awaiting_student_name')) {
      return false;
    }
    Object.assign(one, {
      status: 'rejected',
      reason,
      decidedByAdminId: adminId,
      decidedAt: at,
      signatureStorageKey: null,
    });
    return true;
  }
}

/** The kind's after-commit list, flushed by the spec as the kind does once it commits. */
class AfterCommitList {
  readonly events: { to: readonly string[]; event: LiveEvent }[] = [];
  readonly sent: { to: readonly string[]; event: LiveEvent }[] = [];
  #actions: (() => void)[] = [];
  afterCommit(to: readonly string[], event: LiveEvent): void {
    this.events.push({ to, event });
  }
  afterCommitDo(action: () => void): void {
    this.#actions.push(action);
  }
  flush(): void {
    this.sent.push(...this.events.splice(0));
    for (const action of this.#actions.splice(0)) action();
  }
}

function world() {
  const store = new MemoryStore();
  const lines: { level: 'info' | 'warn'; fields: Record<string, unknown>; message: string }[] = [];
  const enqueued: [string, number][] = [];
  const removed: string[] = [];
  const keys = new Map<string, unknown>();
  const state = { enqueueFails: false, removeFails: false, links: [] as [string, number][] };
  let minted = 0;
  const tx = {} as Transaction;
  const list = new AfterCommitList();
  const unbind = bindToTransaction(tx, list);
  const settings: SettingsReader = {
    read: (async (key: string) => {
      if (key === 'admin_list_page_size') return 2;
      if (key === 'document_link_ttl_seconds') return 300;
      throw new Error(`unread setting ${key}`);
    }) as SettingsReader['read'],
  };
  const service = new IjazahDecisionService({
    store,
    storage: {
      temporaryLink: async (key, seconds) => {
        state.links.push([key, seconds]);
        return `https://storage.example.test/${key}?ttl=${seconds}`;
      },
      remove: async (key) => {
        if (state.removeFails) throw new Error('storage down');
        removed.push(key);
      },
    },
    settings,
    idempotency: {
      runOn: (async (
        txOf: Transaction,
        request: { scope: string; key: string; actorId: string },
        effect: (tx: Transaction) => Promise<unknown>,
      ) => {
        const id = `${request.scope}|${request.actorId}|${request.key}`;
        if (keys.has(id)) return { outcome: keys.get(id), replayed: true };
        const outcome = await effect(txOf);
        keys.set(id, outcome);
        return { outcome, replayed: false };
      }) as never,
    },
    renders: {
      enqueue: async (ijazahId, generation) => {
        if (state.enqueueFails) throw new Error('redis down');
        enqueued.push([ijazahId, generation]);
      },
    },
    mint: {
      certificateNumber: () => NUMBER,
      verificationToken: () => {
        minted += 1;
        return TOKEN;
      },
      hashToken: (token) => `sha256(${token})`,
    },
    drawId: async () => IJAZAH,
    clock: async () => NOW,
    log: {
      info: (fields, message) => lines.push({ level: 'info', fields: { ...fields }, message }),
      warn: (fields, message) => lines.push({ level: 'warn', fields: { ...fields }, message }),
    },
  });
  return {
    store,
    service,
    tx,
    list,
    lines,
    enqueued,
    removed,
    state,
    unbind,
    minted: () => minted,
  };
}

/** Lets the after-commit actions' promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

async function refusalOf(work: Promise<unknown>): Promise<DomainError> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

const codeOf = (error: DomainError) => error.details?.[0]?.code;

let w: ReturnType<typeof world>;
beforeEach(() => {
  w = world();
});

describe('ijazahRequests.approve (FR-605, R-402)', () => {
  it('writes one ijazah from the frozen request, the student named now, mode generated', async () => {
    const { answer, replayed } = await w.service.approve(w.tx, ADMIN, {
      requestId: REQUEST,
      idempotencyKey: KEY,
    });
    expect(answer).toEqual({ ijazahId: IJAZAH, certificateNumber: NUMBER });
    expect(replayed).toBe(false);
    expect(w.store.ijazahs).toEqual([
      {
        id: IJAZAH,
        certificateNumber: NUMBER,
        enrollmentId: ENROLLMENT,
        studentUserId: STUDENT,
        teacherUserId: TEACHER,
        subjectId: SUBJECT,
        mode: 'generated',
        language: 'en',
        chainSnapshot: CHAIN,
        certificateStorageKey: `certificates/${IJAZAH}/0.pdf`,
        paperCopyIntended: false,
        verificationTokenHash: HASH,
        grantedAt: NOW,
        requestId: REQUEST,
        issuedByAdminId: ADMIN,
        studentNamePrinted: STUDENT_NAME,
        teacherNamePrinted: 'عمر بن فاروق',
        riwayaPrinted: 'حفص عن عاصم',
        tariqPrinted: 'الشاطبية',
        completionDate: new Date('2026-11-10T00:00:00.000Z'),
      },
    ]);
  });

  it("always writes the request's completion date (the render job cannot print without one)", async () => {
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    expect(w.store.ijazahs[0]?.completionDate).toEqual(new Date('2026-11-10T00:00:00.000Z'));
  });

  it('moves the request to approved, decided by the administrator, now', async () => {
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    expect(w.store.requests[0]).toMatchObject({
      status: 'approved',
      decidedByAdminId: ADMIN,
      decidedAt: NOW,
      signatureStorageKey: COPY_KEY,
    });
  });

  it('stores the token only hashed, and never answers or logs it (Q15 (a), R-DB-7)', async () => {
    const { answer } = await w.service.approve(w.tx, ADMIN, {
      requestId: REQUEST,
      idempotencyKey: KEY,
    });
    expect(w.minted()).toBe(1);
    const row = w.store.ijazahs[0];
    expect(row?.verificationTokenHash).toBe(HASH);
    expect(row?.verificationTokenHash).not.toBe(TOKEN);
    expect(JSON.stringify(row)).not.toContain(`"${TOKEN}"`);
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(JSON.stringify(w.lines).replaceAll(HASH, '')).not.toContain(TOKEN);
  });

  it('takes the kernel row: both parties in one call, then the request, then reads under them', async () => {
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    expect(w.store.calls).toEqual([
      `read request ${REQUEST}`,
      `lock users ${TEACHER},${STUDENT}`,
      `lock requests ${REQUEST}`,
      `read request ${REQUEST}`,
      'read bar',
      'read certificate name',
      'insert ijazah',
      'approve request',
    ]);
  });

  it('logs the issue by ids and its reason only', async () => {
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    expect(w.lines).toEqual([
      {
        level: 'info',
        fields: { adminId: ADMIN, requestId: REQUEST, ijazahId: IJAZAH, reason: 'approved' },
        message: 'An ijazah was issued',
      },
    ]);
  });

  it('writes one ijazah under a replay of one key, the first answer replayed', async () => {
    const first = await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    w.list.flush();
    await settled();
    const again = await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    w.list.flush();
    await settled();
    expect(again).toEqual({ answer: first.answer, replayed: true });
    expect(w.store.ijazahs).toHaveLength(1);
    expect(w.enqueued).toEqual([[IJAZAH, 0]]);
    expect(w.list.sent).toHaveLength(1);
  });

  it('writes one ijazah when a second administrator approves under another key', async () => {
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    const error = await refusalOf(
      w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: OTHER_KEY }),
    );
    expect([error.code, codeOf(error)]).toEqual(['CONFLICT', 'not_pending']);
    expect(w.store.ijazahs).toHaveLength(1);
  });

  it("refuses student_barred while the student's bar is not lifted (FR-610, Q7 (a))", async () => {
    w.store.barred = true;
    const error = await refusalOf(
      w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY }),
    );
    expect([error.code, codeOf(error)]).toEqual(['CONFLICT', 'student_barred']);
    expect(w.store.ijazahs).toEqual([]);
    expect(w.store.requests[0]?.status).toBe('pending');
    expect(w.lines).toEqual([
      {
        level: 'info',
        fields: { adminId: ADMIN, requestId: REQUEST, reason: 'student_barred' },
        message: 'An ijazah decision was refused',
      },
    ]);
  });

  it.each(['awaiting_student_name', 'approved', 'rejected', 'closed'] as const)(
    'refuses not_pending for a request %s',
    async (status) => {
      w.store.requests = [{ ...requestRow({ status }), decidedByAdminId: null }];
      const error = await refusalOf(
        w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY }),
      );
      expect([error.code, codeOf(error)]).toEqual(['CONFLICT', 'not_pending']);
      expect(w.store.ijazahs).toEqual([]);
    },
  );

  it('answers NOT_FOUND for an unknown request, logged', async () => {
    const error = await refusalOf(
      w.service.approve(w.tx, ADMIN, { requestId: SECOND, idempotencyKey: KEY }),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(w.lines[0]?.fields).toEqual({ adminId: ADMIN, requestId: SECOND, reason: 'not_found' });
  });

  it('enqueues the render and sends the live event only after the commit (R-API-13)', async () => {
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    await settled();
    expect(w.enqueued).toEqual([]);
    expect(w.list.sent).toEqual([]);
    w.list.flush();
    await settled();
    expect(w.enqueued).toEqual([[IJAZAH, 0]]);
    expect(w.list.sent).toEqual([
      { to: [TEACHER, STUDENT], event: { type: 'ijazahRequest', enrollmentId: ENROLLMENT } },
    ]);
  });

  it('logs a failed enqueue by ids and leaves the ijazah issued', async () => {
    w.state.enqueueFails = true;
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    w.list.flush();
    await settled();
    expect(w.store.ijazahs).toHaveLength(1);
    expect(w.lines.at(-1)).toEqual({
      level: 'warn',
      fields: { ijazahId: IJAZAH, requestId: REQUEST, reason: 'enqueue_failed' },
      message: "An issued ijazah's rendering could not be queued",
    });
  });

  it('refuses a transaction no caller kind bound an after-commit list to, writing nothing', async () => {
    w.unbind();
    await expect(
      w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY }),
    ).rejects.toThrow(/after-commit list/);
    expect(w.store.ijazahs).toEqual([]);
  });
});

describe('ijazahRequests.reject (FR-604)', () => {
  const INPUT = { requestId: REQUEST, reason: 'السند لا يطابق', idempotencyKey: KEY };

  it('rejects with the reason, the copy key cleared on the transaction', async () => {
    const { replayed } = await w.service.reject(w.tx, ADMIN, INPUT);
    expect(replayed).toBe(false);
    expect(w.store.requests[0]).toMatchObject({
      status: 'rejected',
      reason: 'السند لا يطابق',
      decidedByAdminId: ADMIN,
      decidedAt: NOW,
      signatureStorageKey: null,
    });
    expect(w.store.calls).toEqual([
      `read request ${REQUEST}`,
      `lock requests ${REQUEST}`,
      `read request ${REQUEST}`,
      'reject request',
    ]);
  });

  it("removes the copy's file once, only after the commit, and sends the event", async () => {
    await w.service.reject(w.tx, ADMIN, INPUT);
    await settled();
    expect(w.removed).toEqual([]);
    w.list.flush();
    await settled();
    expect(w.removed).toEqual([COPY_KEY]);
    expect(w.list.sent).toEqual([
      { to: [TEACHER, STUDENT], event: { type: 'ijazahRequest', enrollmentId: ENROLLMENT } },
    ]);
    await w.service.reject(w.tx, ADMIN, INPUT);
    w.list.flush();
    await settled();
    expect(w.removed).toEqual([COPY_KEY]);
  });

  it('logs a failed removal by ids and leaves the rejection', async () => {
    w.state.removeFails = true;
    await w.service.reject(w.tx, ADMIN, INPUT);
    w.list.flush();
    await settled();
    expect(w.store.requests[0]?.status).toBe('rejected');
    expect(w.lines.at(-1)).toEqual({
      level: 'warn',
      fields: { requestId: REQUEST, reason: 'copy_not_removed' },
      message: "A rejected ijazah request's signature copy could not be removed",
    });
  });

  // The owner's Q-C5 (a), 2026-11-17: a request still waiting for the student's name may be rejected.
  it('rejects a request still waiting for the student name, its key cleared and its file removed after the commit', async () => {
    w.store.requests = [
      { ...requestRow({ status: 'awaiting_student_name' }), decidedByAdminId: null },
    ];
    await w.service.reject(w.tx, ADMIN, INPUT);
    expect(w.store.requests[0]).toMatchObject({
      status: 'rejected',
      reason: 'السند لا يطابق',
      signatureStorageKey: null,
    });
    await settled();
    expect(w.removed).toEqual([]);
    w.list.flush();
    await settled();
    expect(w.removed).toEqual([COPY_KEY]);
  });

  it.each(['approved', 'rejected', 'closed'] as const)(
    'refuses not_pending for a request %s, keeping its copy',
    async (status) => {
      w.store.requests = [{ ...requestRow({ status }), decidedByAdminId: null }];
      const error = await refusalOf(w.service.reject(w.tx, ADMIN, INPUT));
      expect([error.code, codeOf(error)]).toEqual(['CONFLICT', 'not_pending']);
      w.list.flush();
      await settled();
      expect(w.removed).toEqual([]);
    },
  );

  it('answers NOT_FOUND for an unknown request', async () => {
    const error = await refusalOf(w.service.reject(w.tx, ADMIN, { ...INPUT, requestId: SECOND }));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('writes nothing more under a replay of one key', async () => {
    await w.service.reject(w.tx, ADMIN, INPUT);
    w.list.flush();
    await settled();
    const again = await w.service.reject(w.tx, ADMIN, INPUT);
    expect(again).toEqual({ replayed: true });
    expect(w.store.calls.filter((call) => call === 'reject request')).toHaveLength(1);
  });

  it('logs the rejection by ids and its reason code, never the typed reason', async () => {
    await w.service.reject(w.tx, ADMIN, INPUT);
    expect(w.lines).toEqual([
      {
        level: 'info',
        fields: { adminId: ADMIN, requestId: REQUEST, reason: 'rejected' },
        message: 'An ijazah request was rejected',
      },
    ]);
  });
});

describe('ijazahRequests.list', () => {
  beforeEach(() => {
    w.store.requests.push(
      { ...requestRow({ id: SECOND, status: 'approved' }), decidedByAdminId: ADMIN },
      {
        ...requestRow({ id: '0199d0a0-0000-7000-8000-0000000000f3' }),
        decidedByAdminId: null,
      },
    );
  });

  it('answers a page of the admin page size, its next cursor, parties, subject and standing', async () => {
    const page = await w.service.list(w.tx, ADMIN, {});
    expect(page.items.map(({ requestId }) => requestId)).toEqual([REQUEST, SECOND]);
    expect(page.nextCursor).toBe(SECOND);
    expect(page.items[0]).toEqual({
      requestId: REQUEST,
      enrollmentId: ENROLLMENT,
      teacher: { userId: TEACHER, displayName: 'عمر' },
      student: { userId: STUDENT, displayName: 'مريم' },
      subject: { id: SUBJECT, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' },
      status: 'pending',
      sentAt: '2026-11-17T09:00:00.000Z',
      teacherStanding: { status: 'active' },
    });
    expect(w.store.calls).toContain('page all after - take 3');
  });

  it('filters by status after the cursor, with no next cursor on the last page', async () => {
    const page = await w.service.list(w.tx, ADMIN, { status: 'pending', cursor: REQUEST });
    expect(page.items.map(({ requestId }) => requestId)).toEqual([
      '0199d0a0-0000-7000-8000-0000000000f3',
    ]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('names a deleted party null and its standing deleted', async () => {
    w.store.parties.delete(TEACHER);
    w.store.parties.delete(STUDENT);
    const page = await w.service.list(w.tx, ADMIN, {});
    expect(page.items[0]?.teacher).toEqual({ userId: TEACHER, displayName: null });
    expect(page.items[0]?.student).toEqual({ userId: STUDENT, displayName: null });
    expect(page.items[0]?.teacherStanding).toEqual({ status: 'deleted' });
  });
});

describe('ijazahRequests.get, certification half (FR-604, FR-628)', () => {
  it('answers the frozen certificate, the name now and a link to the copy', async () => {
    const detail = await w.service.detail(w.tx, ADMIN, { requestId: REQUEST });
    expect(detail).toMatchObject({
      requestId: REQUEST,
      teacherUserId: TEACHER,
      completionDate: '2026-11-10',
      language: 'en',
      chain: CHAIN,
      teacherNamePrinted: 'عمر بن فاروق',
      studentName: STUDENT_NAME,
      riwaya: 'حفص عن عاصم',
      tariq: 'الشاطبية',
      signatureLink: `https://storage.example.test/${COPY_KEY}?ttl=300`,
      teacherStanding: { status: 'active' },
    });
    expect(w.state.links).toEqual([[COPY_KEY, 300]]);
    expect(detail).not.toHaveProperty('reason');
    expect(detail).not.toHaveProperty('ijazahId');
  });

  it('answers a rejected request with its reason and no link', async () => {
    await w.service.reject(w.tx, ADMIN, {
      requestId: REQUEST,
      reason: 'السند لا يطابق',
      idempotencyKey: KEY,
    });
    const detail = await w.service.detail(w.tx, ADMIN, { requestId: REQUEST });
    expect(detail).toMatchObject({
      status: 'rejected',
      reason: 'السند لا يطابق',
      decidedAt: NOW.toISOString(),
      signatureLink: null,
    });
  });

  it('answers an approved request with its ijazah', async () => {
    await w.service.approve(w.tx, ADMIN, { requestId: REQUEST, idempotencyKey: KEY });
    const detail = await w.service.detail(w.tx, ADMIN, { requestId: REQUEST });
    expect(detail).toMatchObject({ status: 'approved', ijazahId: IJAZAH });
  });

  it('answers NOT_FOUND for an unknown request', async () => {
    const error = await refusalOf(w.service.detail(w.tx, ADMIN, { requestId: SECOND }));
    expect(error.code).toBe('NOT_FOUND');
  });

  it.each([
    [{ accountStatus: 'active', teacherApproved: true }, 'active'],
    [{ accountStatus: 'verification_required', teacherApproved: true }, 'verification_required'],
    [{ accountStatus: 'suspended', teacherApproved: true }, 'suspended'],
    [{ accountStatus: 'active', teacherApproved: false }, 'revoked'],
    [{ accountStatus: 'banned', teacherApproved: false }, 'banned'],
  ])('reads the standing %o as %s', async (party, status) => {
    w.store.parties.set(TEACHER, { displayName: 'عمر', ...party });
    const detail = await w.service.detail(w.tx, ADMIN, { requestId: REQUEST });
    expect(detail.teacherStanding).toEqual({ status });
  });
});
