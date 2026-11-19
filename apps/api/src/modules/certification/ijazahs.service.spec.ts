// T010 of specs/005-certification — an administrator's ijazahs over a store held in memory (FR-609,
// FR-610; research R-412; R-HONEST-6; the note under T010, Q12 (a)).
//
// - List and get: every ijazah, revoked or not; a revoked one is `revoked` whatever else it holds,
//   never `signed_off`, `rendered` or `preparing` (never shown as valid); the status filter; the
//   page size from `admin_list_page_size` and the cursor; `get`'s frozen certificate and a signed
//   link to the current generation's PDF once rendered, revoked or not (R-412), none before.
// - Revoke: a reason; `revoked_at`, `revoked_reason`, `revoked_by_admin_id` written, the row never
//   deleted; the ijazah locked, then read (rule 1); refused `already_revoked` (final in v1.0, no
//   un-revoke, Q12 (a)) and NOT_FOUND; keyed, a replay writing and publishing nothing; the live event
//   `ijazahRequest` to both parties only after the commit.
// - Bar and liftBar: the user's `users` row locked, then the open bar read under it; one open bar per
//   user (`already_barred`), a lift only of an open bar (`not_barred`); NOT_FOUND for an account
//   that is not there; keyed. Every refusal one info line of ids and its reason.
// - 005:T022 (B49, Q-P2 (b)) barred: the open bars as the store answers them (newest first), by
//   `admin_list_page_size` before the cursor; each with the student's name (null once deleted), the
//   reason, the instant and the administrator by the names the admin module hands in; one read of
//   each, no lock, no line.
import type { LiveEvent } from '@ijazah/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { bindToTransaction } from '../../platform/live/live-publisher.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { DecisionParty } from './ijazah-decision.service.js';
import {
  type IjazahPageQuery,
  type IjazahRecord,
  IjazahsService,
  type IjazahsStore,
  type NewIjazahBar,
  type OpenBarPageQuery,
} from './ijazahs.service.js';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000ad';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const IJAZAH = '0199d0a0-0000-7000-8000-0000000000b1';
const SECOND = '0199d0a0-0000-7000-8000-0000000000b2';
const THIRD = '0199d0a0-0000-7000-8000-0000000000b3';
const BAR = '0199d0a0-0000-7000-8000-0000000000d1';
// 005:T022: two later bars and a second administrator.
const BAR_2 = '0199d0a0-0000-7000-8000-0000000000d2';
const BAR_3 = '0199d0a0-0000-7000-8000-0000000000d3';
const OTHER_ADMIN = '0199d0a0-0000-7000-8000-0000000000ae';
const NUMBER = '7K3MQ9TD2XWB8HRN';
const KEY = 'decision-key-for-the-spec-0001';
const OTHER_KEY = 'decision-key-for-the-spec-0002';
const NOW = new Date('2026-11-17T12:00:00.000Z');
const CHAIN = [['رسول الله ﷺ'], ['عمر بن فاروق']];
const PDF_KEY = `certificates/${IJAZAH}/1.pdf`;

function ijazahRow(change: Partial<IjazahRecord> = {}): IjazahRecord {
  return {
    id: IJAZAH,
    certificateNumber: NUMBER,
    enrollmentId: ENROLLMENT,
    requestId: REQUEST,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    subjectId: SUBJECT,
    language: 'ar',
    chainSnapshot: CHAIN,
    studentNamePrinted: 'مريم بنت أحمد',
    teacherNamePrinted: 'عمر بن فاروق',
    riwayaPrinted: 'حفص عن عاصم',
    tariqPrinted: null,
    completionDate: new Date('2026-11-10T00:00:00.000Z'),
    grantedAt: new Date('2026-11-17T09:00:00.000Z'),
    renderGeneration: 1,
    renderedAt: new Date('2026-11-17T09:05:00.000Z'),
    certificateStorageKey: PDF_KEY,
    signedOffAt: new Date('2026-11-17T10:00:00.000Z'),
    revokedAt: null,
    revokedReason: null,
    ...change,
  };
}

interface HeldIjazah extends IjazahRecord {
  revokedByAdminId: string | null;
  deleted: boolean;
}

interface HeldBar extends NewIjazahBar {
  liftedAt: Date | null;
  liftedByAdminId: string | null;
}

function statusOf(one: IjazahRecord): string {
  if (one.revokedAt !== null) return 'revoked';
  if (one.signedOffAt !== null) return 'signed_off';
  if (one.renderedAt !== null) return 'rendered';
  return 'preparing';
}

/** The store's world, its calls in order, each write the database would make. */
class MemoryStore implements IjazahsStore {
  readonly calls: string[] = [];
  ijazahs: HeldIjazah[] = [{ ...ijazahRow(), revokedByAdminId: null, deleted: false }];
  bars: HeldBar[] = [];
  parties = new Map<string, DecisionParty>([
    [TEACHER, { displayName: 'عمر', accountStatus: 'active', teacherApproved: true }],
    [STUDENT, { displayName: 'مريم', accountStatus: 'active', teacherApproved: false }],
  ]);

  async ijazahOf(_tx: Transaction, ijazahId: string) {
    this.calls.push(`read ijazah ${ijazahId}`);
    return this.ijazahs.find(({ id, deleted }) => id === ijazahId && !deleted) ?? null;
  }
  async page(_tx: Transaction, { status, after, take }: IjazahPageQuery) {
    this.calls.push(`page ${status ?? 'all'} after ${after ?? '-'} take ${take}`);
    return this.ijazahs
      .filter(
        (one) =>
          !one.deleted &&
          (status === undefined || statusOf(one) === status) &&
          (after === undefined || one.id > after),
      )
      .slice(0, take);
  }
  async partiesOf(_tx: Transaction, userIds: readonly string[]) {
    this.calls.push(`read parties ${userIds.join(',')}`);
    return new Map([...this.parties].filter(([id]) => userIds.includes(id)));
  }
  async subjectsOf(_tx: Transaction, subjectIds: readonly string[]) {
    return new Map(
      subjectIds.map((id) => [id, { id, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' }]),
    );
  }
  async lockAccounts(_tx: Transaction, userIds: readonly string[]) {
    this.calls.push(`lock users ${userIds.join(',')}`);
  }
  async lockIjazahs(_tx: Transaction, ids: readonly string[]) {
    this.calls.push(`lock ijazahs ${ids.join(',')}`);
  }
  async markRevoked(_tx: Transaction, ijazahId: string, adminId: string, reason: string, at: Date) {
    this.calls.push('revoke ijazah');
    const one = this.ijazahs.find(({ id }) => id === ijazahId);
    if (one === undefined || one.revokedAt !== null) return false;
    Object.assign(one, { revokedAt: at, revokedReason: reason, revokedByAdminId: adminId });
    return true;
  }
  async openBarOf(_tx: Transaction, userId: string) {
    this.calls.push(`read open bar ${userId}`);
    return this.bars.find((bar) => bar.userId === userId && bar.liftedAt === null)?.id ?? null;
  }
  async insertBar(_tx: Transaction, bar: NewIjazahBar) {
    this.calls.push('insert bar');
    this.bars.push({ ...bar, liftedAt: null, liftedByAdminId: null });
  }
  async liftBar(_tx: Transaction, barId: string, adminId: string, at: Date) {
    this.calls.push('lift bar');
    const one = this.bars.find(({ id }) => id === barId);
    if (one === undefined || one.liftedAt !== null) return false;
    Object.assign(one, { liftedAt: at, liftedByAdminId: adminId });
    return true;
  }
  // 005:T032.
  async hasOpenBar(_tx: Transaction, userId: string) {
    this.calls.push(`read bar ${userId}`);
    return this.bars.some((bar) => bar.userId === userId && bar.liftedAt === null);
  }
  async markSignedOff(_tx: Transaction, ijazahId: string, adminId: string, at: Date) {
    this.calls.push('sign off ijazah');
    const one = this.ijazahs.find(({ id }) => id === ijazahId);
    // The database's check (`ijazahs_signed_off_check`) and the write's condition.
    if (one === undefined || one.signedOffAt !== null || one.revokedAt !== null) return false;
    if (one.renderedAt === null) throw new Error('ijazahs_signed_off_check');
    Object.assign(one, { signedOffAt: at, signedOffByAdminId: adminId });
    return true;
  }
  async markRerendered(_tx: Transaction, ijazahId: string) {
    this.calls.push('rerender ijazah');
    const one = this.ijazahs.find(({ id }) => id === ijazahId);
    if (one === undefined || one.signedOffAt !== null || one.revokedAt !== null) return false;
    Object.assign(one, { renderGeneration: one.renderGeneration + 1, renderedAt: null });
    return true;
  }
  // 005:T022: the open bars, newest first (the repository's order), before the cursor.
  async openBars(_tx: Transaction, { after, take }: OpenBarPageQuery) {
    this.calls.push(`page open bars after ${after ?? '-'} take ${take}`);
    return this.bars
      .filter((bar) => bar.liftedAt === null && (after === undefined || bar.id < after))
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, take);
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
  const keys = new Map<string, unknown>();
  const links: [string, number][] = [];
  const enqueued: [string, number][] = [];
  const state = { enqueueFails: false };
  // 005:T022: the administrators' names the admin module hands in, and each read of them.
  const adminNamesAsked: string[][] = [];
  const adminNameOf = new Map([
    [ADMIN, 'أحمد'],
    [OTHER_ADMIN, 'خالد'],
  ]);
  const tx = {} as Transaction;
  const list = new AfterCommitList();
  bindToTransaction(tx, list);
  const settings: SettingsReader = {
    read: (async (key: string) => {
      if (key === 'admin_list_page_size') return 2;
      if (key === 'document_link_ttl_seconds') return 300;
      throw new Error(`unread setting ${key}`);
    }) as SettingsReader['read'],
  };
  const service = new IjazahsService({
    store,
    storage: {
      temporaryLink: async (key, seconds) => {
        links.push([key, seconds]);
        return `https://storage.example.test/${key}?ttl=${seconds}`;
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
    drawId: async () => BAR,
    clock: async () => NOW,
    log: {
      info: (fields, message) => lines.push({ level: 'info', fields: { ...fields }, message }),
      warn: (fields, message) => lines.push({ level: 'warn', fields: { ...fields }, message }),
    },
    renders: {
      enqueue: async (ijazahId, generation) => {
        if (state.enqueueFails) throw new Error('redis down');
        enqueued.push([ijazahId, generation]);
      },
    },
    adminNames: async (_tx, adminIds) => {
      adminNamesAsked.push([...adminIds]);
      return new Map(adminIds.map((id) => [id, adminNameOf.get(id) ?? '']));
    },
  });
  return { store, service, tx, list, lines, links, enqueued, state, adminNamesAsked };
}

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

describe('ijazahs.list (R-412, R-HONEST-6)', () => {
  it('answers each ijazah with its status, rendering and revocation', async () => {
    const page = await w.service.list(w.tx, ADMIN, {});
    expect(page.items).toEqual([
      {
        ijazahId: IJAZAH,
        certificateNumber: NUMBER,
        enrollmentId: ENROLLMENT,
        requestId: REQUEST,
        teacher: { userId: TEACHER, displayName: 'عمر' },
        student: { userId: STUDENT, displayName: 'مريم' },
        subject: { id: SUBJECT, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' },
        language: 'ar',
        grantedAt: '2026-11-17T09:00:00.000Z',
        status: 'signed_off',
        rendered: true,
        revoked: false,
        renderGeneration: 1,
        signedOffAt: '2026-11-17T10:00:00.000Z',
        revokedAt: null,
      },
    ]);
  });

  it('never shows a revoked ijazah as valid: signed off and rendered, it is still `revoked`', async () => {
    w.store.ijazahs[0] = {
      ...w.store.ijazahs[0]!,
      revokedAt: new Date('2026-11-17T11:00:00.000Z'),
      revokedReason: 'خطأ في السند',
    };
    const [row] = (await w.service.list(w.tx, ADMIN, {})).items;
    expect(row?.status).toBe('revoked');
    expect(row?.revoked).toBe(true);
    expect(row?.revokedAt).toBe('2026-11-17T11:00:00.000Z');
  });

  it('names the three earlier states: preparing, rendered, signed off', async () => {
    w.store.ijazahs = [
      {
        ...ijazahRow({ renderedAt: null, signedOffAt: null }),
        revokedByAdminId: null,
        deleted: false,
      },
      {
        ...ijazahRow({ id: SECOND, signedOffAt: null }),
        revokedByAdminId: null,
        deleted: false,
      },
    ];
    const items = (await w.service.list(w.tx, ADMIN, {})).items;
    expect(items.map(({ status, rendered }) => [status, rendered])).toEqual([
      ['preparing', false],
      ['rendered', true],
    ]);
  });

  it('pages by `admin_list_page_size` after the cursor, the status filter handed to the store', async () => {
    w.store.ijazahs = [IJAZAH, SECOND, THIRD].map((id) => ({
      ...ijazahRow({ id }),
      revokedByAdminId: null,
      deleted: false,
    }));
    const first = await w.service.list(w.tx, ADMIN, { status: 'signed_off' });
    expect(first.items.map(({ ijazahId }) => ijazahId)).toEqual([IJAZAH, SECOND]);
    expect(first.nextCursor).toBe(SECOND);
    const second = await w.service.list(w.tx, ADMIN, { status: 'signed_off', cursor: SECOND });
    expect(second.items.map(({ ijazahId }) => ijazahId)).toEqual([THIRD]);
    expect(second.nextCursor).toBeUndefined();
    expect(w.store.calls).toContain(`page signed_off after ${SECOND} take 3`);
  });
});

describe('ijazahs.get (R-412)', () => {
  it('answers the frozen certificate and a signed link to the rendered PDF', async () => {
    const detail = await w.service.get(w.tx, ADMIN, { ijazahId: IJAZAH });
    expect(detail).toMatchObject({
      ijazahId: IJAZAH,
      certificateNumber: NUMBER,
      status: 'signed_off',
      completionDate: '2026-11-10',
      chain: CHAIN,
      studentNamePrinted: 'مريم بنت أحمد',
      teacherNamePrinted: 'عمر بن فاروق',
      riwaya: 'حفص عن عاصم',
      tariq: null,
      revokedReason: null,
      pdfLink: `https://storage.example.test/${PDF_KEY}?ttl=300`,
    });
    expect(w.links).toEqual([[PDF_KEY, 300]]);
  });

  it('a revoked ijazah: `revoked` with its reason, and the administrator still has the PDF', async () => {
    w.store.ijazahs[0] = {
      ...w.store.ijazahs[0]!,
      revokedAt: new Date('2026-11-17T11:00:00.000Z'),
      revokedReason: 'خطأ في السند',
    };
    const detail = await w.service.get(w.tx, ADMIN, { ijazahId: IJAZAH });
    expect(detail.status).toBe('revoked');
    expect(detail.revoked).toBe(true);
    expect(detail.revokedReason).toBe('خطأ في السند');
    expect(detail.pdfLink).not.toBeNull();
  });

  it('answers no link before the rendering (the key names a file not yet written)', async () => {
    w.store.ijazahs[0] = { ...w.store.ijazahs[0]!, renderedAt: null, signedOffAt: null };
    const detail = await w.service.get(w.tx, ADMIN, { ijazahId: IJAZAH });
    expect(detail.pdfLink).toBeNull();
    expect(detail.status).toBe('preparing');
    expect(w.links).toEqual([]);
  });

  it('NOT_FOUND for an unknown or deleted ijazah, logged', async () => {
    w.store.ijazahs[0]!.deleted = true;
    const error = await refusalOf(w.service.get(w.tx, ADMIN, { ijazahId: IJAZAH }));
    expect(error.code).toBe('NOT_FOUND');
    expect(w.lines).toContainEqual(
      expect.objectContaining({
        fields: { adminId: ADMIN, ijazahId: IJAZAH, reason: 'not_found' },
      }),
    );
  });
});

describe('ijazahs.revoke (FR-609, Q12 (a))', () => {
  const revoke = (key = KEY) =>
    w.service.revoke(w.tx, ADMIN, {
      ijazahId: IJAZAH,
      reason: 'خطأ في السند',
      idempotencyKey: key,
    });

  it('writes the revocation with its reason and administrator, and keeps the row', async () => {
    const { certificateNumber, replayed } = await revoke();
    expect(certificateNumber).toBe(NUMBER);
    expect(replayed).toBe(false);
    expect(w.store.ijazahs).toHaveLength(1);
    expect(w.store.ijazahs[0]).toMatchObject({
      revokedAt: NOW,
      revokedReason: 'خطأ في السند',
      revokedByAdminId: ADMIN,
      deleted: false,
    });
    expect(w.lines).toContainEqual(
      expect.objectContaining({ fields: { adminId: ADMIN, ijazahId: IJAZAH, reason: 'revoked' } }),
    );
  });

  it('locks the ijazah, then reads it under the lock (rule 1)', async () => {
    await revoke();
    const locked = w.store.calls.indexOf(`lock ijazahs ${IJAZAH}`);
    expect(locked).toBeGreaterThanOrEqual(0);
    expect(w.store.calls.slice(locked + 1)).toEqual([`read ijazah ${IJAZAH}`, 'revoke ijazah']);
  });

  it('is final: a second revocation under a new key is refused `already_revoked`', async () => {
    await revoke();
    const error = await refusalOf(revoke(OTHER_KEY));
    expect(error.code).toBe('CONFLICT');
    expect(codeOf(error)).toBe('already_revoked');
    expect(w.lines).toContainEqual(
      expect.objectContaining({
        fields: { adminId: ADMIN, ijazahId: IJAZAH, reason: 'already_revoked' },
      }),
    );
  });

  it('a replay under its key writes and publishes nothing more', async () => {
    await revoke();
    w.list.flush();
    const calls = w.store.calls.length;
    const again = await revoke();
    expect(again.replayed).toBe(true);
    expect(w.store.calls).toHaveLength(calls);
    w.list.flush();
    expect(w.list.sent).toHaveLength(1);
  });

  it('NOT_FOUND for an unknown ijazah', async () => {
    w.store.ijazahs = [];
    expect((await refusalOf(revoke())).code).toBe('NOT_FOUND');
  });

  it('publishes `ijazahRequest` to both parties only after the commit', async () => {
    await revoke();
    expect(w.list.sent).toEqual([]);
    w.list.flush();
    expect(w.list.sent).toEqual([
      { to: [TEACHER, STUDENT], event: { type: 'ijazahRequest', enrollmentId: ENROLLMENT } },
    ]);
  });
});

describe('ijazahs.bar and .liftBar (FR-610)', () => {
  const bar = (key = KEY) =>
    w.service.bar(w.tx, ADMIN, { targetUserId: STUDENT, reason: 'تزوير', idempotencyKey: key });
  const lift = (key = KEY) =>
    w.service.liftBar(w.tx, ADMIN, { targetUserId: STUDENT, reason: 'خطأ', idempotencyKey: key });

  it('bars a user: the `users` row locked first, then the open bar read, then the row written', async () => {
    expect((await bar()).replayed).toBe(false);
    expect(w.store.bars).toEqual([
      {
        id: BAR,
        userId: STUDENT,
        reason: 'تزوير',
        barredByAdminId: ADMIN,
        barredAt: NOW,
        liftedAt: null,
        liftedByAdminId: null,
      },
    ]);
    const locked = w.store.calls.indexOf(`lock users ${STUDENT}`);
    expect(locked).toBeGreaterThanOrEqual(0);
    expect(w.store.calls.indexOf(`read open bar ${STUDENT}`)).toBeGreaterThan(locked);
    expect(w.store.calls.indexOf('insert bar')).toBeGreaterThan(locked);
  });

  it('one open bar per user: a second is refused `already_barred`, nothing written', async () => {
    await bar();
    const error = await refusalOf(bar(OTHER_KEY));
    expect(error.code).toBe('CONFLICT');
    expect(codeOf(error)).toBe('already_barred');
    expect(w.store.bars).toHaveLength(1);
    expect(w.lines).toContainEqual(
      expect.objectContaining({
        fields: { adminId: ADMIN, userId: STUDENT, reason: 'already_barred' },
      }),
    );
  });

  it('a replay of the bar writes nothing more', async () => {
    await bar();
    expect((await bar()).replayed).toBe(true);
    expect(w.store.bars).toHaveLength(1);
  });

  it('NOT_FOUND for an account that is not there', async () => {
    w.store.parties.delete(STUDENT);
    expect((await refusalOf(bar())).code).toBe('NOT_FOUND');
    expect(w.store.bars).toEqual([]);
  });

  it("lifts the open bar, kept as history, under the user's lock", async () => {
    await bar();
    expect((await lift(OTHER_KEY)).replayed).toBe(false);
    expect(w.store.bars[0]).toMatchObject({ liftedAt: NOW, liftedByAdminId: ADMIN });
    const calls = w.store.calls.slice(w.store.calls.lastIndexOf(`lock users ${STUDENT}`));
    expect(calls).toEqual([
      `lock users ${STUDENT}`,
      `read parties ${STUDENT}`,
      `read open bar ${STUDENT}`,
      'lift bar',
    ]);
  });

  it('refuses a lift with no open bar `not_barred`', async () => {
    const error = await refusalOf(lift());
    expect(error.code).toBe('CONFLICT');
    expect(codeOf(error)).toBe('not_barred');
  });

  it('bars again after a lift: the history keeps both rows', async () => {
    await bar();
    await lift('lift-key-for-the-spec-000001');
    await bar('bar-key-for-the-spec-0000002');
    expect(w.store.bars).toHaveLength(2);
    expect(w.store.bars.filter(({ liftedAt }) => liftedAt === null)).toHaveLength(1);
  });
});

// 005:T032 (FR-629; R-402; the note under T032, Q7 (a) with the review's amendment).
describe('ijazahs.signOff (FR-629, DEC-72)', () => {
  const signOff = (key = KEY) =>
    w.service.signOff(w.tx, ADMIN, { ijazahId: IJAZAH, idempotencyKey: key });
  const unsigned = (change: Partial<IjazahRecord> = {}) => {
    w.store.ijazahs[0] = { ...w.store.ijazahs[0]!, signedOffAt: null, ...change };
  };
  const barStudent = () =>
    w.store.bars.push({
      id: BAR,
      userId: STUDENT,
      reason: 'تزوير',
      barredByAdminId: ADMIN,
      barredAt: NOW,
      liftedAt: null,
      liftedByAdminId: null,
    });

  it('signs off a rendered ijazah: the instant and the administrator, the number answered', async () => {
    unsigned();
    const { certificateNumber, replayed } = await signOff();
    expect(certificateNumber).toBe(NUMBER);
    expect(replayed).toBe(false);
    expect(w.store.ijazahs[0]).toMatchObject({ signedOffAt: NOW, signedOffByAdminId: ADMIN });
    expect(w.lines).toContainEqual(
      expect.objectContaining({
        fields: { adminId: ADMIN, ijazahId: IJAZAH, reason: 'signed_off' },
      }),
    );
  });

  it("takes the student's `users` lock, then the ijazah's, then reads the bar under them", async () => {
    unsigned();
    await signOff();
    const at = w.store.calls.indexOf(`lock users ${STUDENT}`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(w.store.calls.slice(at)).toEqual([
      `lock users ${STUDENT}`,
      `lock ijazahs ${IJAZAH}`,
      `read ijazah ${IJAZAH}`,
      `read bar ${STUDENT}`,
      'sign off ijazah',
    ]);
  });

  it.each([
    ['not_rendered', { renderedAt: null }],
    ['revoked', { revokedAt: new Date('2026-11-17T11:00:00.000Z'), revokedReason: 'خطأ' }],
  ] as const)('refuses %s, writing nothing', async (code, change) => {
    unsigned(change);
    const error = await refusalOf(signOff());
    expect(error.code).toBe('CONFLICT');
    expect(codeOf(error)).toBe(code);
    expect(w.store.calls).not.toContain('sign off ijazah');
    expect(w.store.ijazahs[0]?.signedOffAt).toBeNull();
    expect(w.lines).toContainEqual(
      expect.objectContaining({ fields: { adminId: ADMIN, ijazahId: IJAZAH, reason: code } }),
    );
  });

  it('refuses `already_signed_off` under a new key', async () => {
    unsigned();
    await signOff();
    const error = await refusalOf(signOff(OTHER_KEY));
    expect(codeOf(error)).toBe('already_signed_off');
  });

  it('refuses `student_barred` while the student holds an open bar (Q7 (a))', async () => {
    unsigned();
    barStudent();
    const error = await refusalOf(signOff());
    expect(error.code).toBe('CONFLICT');
    expect(codeOf(error)).toBe('student_barred');
    expect(w.store.ijazahs[0]?.signedOffAt).toBeNull();
    expect(w.lines).toContainEqual(
      expect.objectContaining({
        fields: { adminId: ADMIN, ijazahId: IJAZAH, reason: 'student_barred' },
      }),
    );
  });

  it('publishes `ijazahRequest` to both parties only after the commit; a replay writes nothing', async () => {
    unsigned();
    await signOff();
    expect(w.list.sent).toEqual([]);
    w.list.flush();
    expect(w.list.sent).toEqual([
      { to: [TEACHER, STUDENT], event: { type: 'ijazahRequest', enrollmentId: ENROLLMENT } },
    ]);
    const calls = w.store.calls.length;
    expect((await signOff()).replayed).toBe(true);
    expect(w.store.calls).toHaveLength(calls);
    w.list.flush();
    expect(w.list.sent).toHaveLength(1);
  });

  it('NOT_FOUND for an unknown ijazah', async () => {
    w.store.ijazahs = [];
    expect((await refusalOf(signOff())).code).toBe('NOT_FOUND');
  });
});

describe('ijazahs.rerender (FR-629, R-402)', () => {
  const rerender = (key = KEY) =>
    w.service.rerender(w.tx, ADMIN, { ijazahId: IJAZAH, reason: 'الخط', idempotencyKey: key });
  const unsigned = (change: Partial<IjazahRecord> = {}) => {
    w.store.ijazahs[0] = { ...w.store.ijazahs[0]!, signedOffAt: null, ...change };
  };

  it('raises the generation and clears the rendering, the ijazah locked then read', async () => {
    unsigned();
    const { certificateNumber } = await rerender();
    expect(certificateNumber).toBe(NUMBER);
    expect(w.store.ijazahs[0]).toMatchObject({ renderGeneration: 2, renderedAt: null });
    const at = w.store.calls.indexOf(`lock ijazahs ${IJAZAH}`);
    expect(w.store.calls.slice(at)).toEqual([
      `lock ijazahs ${IJAZAH}`,
      `read ijazah ${IJAZAH}`,
      'rerender ijazah',
    ]);
  });

  it('enqueues the new generation only after the commit, once under a replay', async () => {
    unsigned();
    await rerender();
    expect(w.enqueued).toEqual([]);
    w.list.flush();
    await settled();
    expect(w.enqueued).toEqual([[IJAZAH, 2]]);
    expect((await rerender()).replayed).toBe(true);
    w.list.flush();
    await settled();
    expect(w.enqueued).toEqual([[IJAZAH, 2]]);
  });

  it('logs a lost enqueue by ids: the ijazah stays unrendered and visible as such', async () => {
    unsigned();
    w.state.enqueueFails = true;
    await rerender();
    w.list.flush();
    await settled();
    expect(w.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        fields: { ijazahId: IJAZAH, generation: 2, reason: 'enqueue_failed' },
      }),
    );
  });

  it.each([
    ['already_signed_off', { signedOffAt: new Date('2026-11-17T10:00:00.000Z') }],
    ['revoked', { revokedAt: new Date('2026-11-17T11:00:00.000Z'), revokedReason: 'خطأ' }],
  ] as const)('is refused %s, writing and enqueuing nothing', async (code, change) => {
    unsigned(change);
    const error = await refusalOf(rerender());
    expect(codeOf(error)).toBe(code);
    expect(w.store.calls).not.toContain('rerender ijazah');
    w.list.flush();
    await settled();
    expect(w.enqueued).toEqual([]);
  });
});

/** Lets the after-commit actions' promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// 005:T022 (B49, Q-P2 (b)): the barred list, so a student barred with no ijazah has a page to lift
// the bar from.
describe('ijazahs.barred (FR-610, Q-P2 (b))', () => {
  const heldBar = (id: string, change: Partial<HeldBar> = {}): HeldBar => ({
    id,
    userId: STUDENT,
    reason: 'تزوير',
    barredByAdminId: ADMIN,
    barredAt: NOW,
    liftedAt: null,
    liftedByAdminId: null,
    ...change,
  });

  it("answers each open bar: the student's name, the reason, when, and the administrator by name", async () => {
    w.store.bars = [heldBar(BAR)];
    expect(await w.service.barred(w.tx, ADMIN, {})).toEqual({
      items: [
        {
          barId: BAR,
          student: { userId: STUDENT, displayName: 'مريم' },
          reason: 'تزوير',
          barredAt: NOW.toISOString(),
          barredBy: { adminId: ADMIN, displayName: 'أحمد' },
        },
      ],
    });
  });

  it("names the barring administrator, not the reader, nor the student's teacher", async () => {
    w.store.bars = [heldBar(BAR, { barredByAdminId: OTHER_ADMIN })];
    const [row] = (await w.service.barred(w.tx, ADMIN, {})).items;
    expect(row?.barredBy).toEqual({ adminId: OTHER_ADMIN, displayName: 'خالد' });
  });

  it("keeps a deleted student's bar, the name null", async () => {
    w.store.parties.delete(STUDENT);
    w.store.bars = [heldBar(BAR)];
    const [row] = (await w.service.barred(w.tx, ADMIN, {})).items;
    expect(row?.student).toEqual({ userId: STUDENT, displayName: null });
  });

  it('pages by `admin_list_page_size`, newest first, the cursor handed to the store', async () => {
    w.store.bars = [heldBar(BAR), heldBar(BAR_2, { userId: TEACHER }), heldBar(BAR_3)];
    const first = await w.service.barred(w.tx, ADMIN, {});
    expect(first.items.map(({ barId }) => barId)).toEqual([BAR_3, BAR_2]);
    expect(first.nextCursor).toBe(BAR_2);
    const second = await w.service.barred(w.tx, ADMIN, { cursor: BAR_2 });
    expect(second.items.map(({ barId }) => barId)).toEqual([BAR]);
    expect(second).not.toHaveProperty('nextCursor');
    expect(w.store.calls.filter((call) => call.startsWith('page open bars'))).toEqual([
      'page open bars after - take 3',
      `page open bars after ${BAR_2} take 3`,
    ]);
  });

  it('reads the students and the administrators once each, takes no lock and writes no line', async () => {
    w.store.bars = [heldBar(BAR), heldBar(BAR_2)];
    await w.service.barred(w.tx, ADMIN, {});
    expect(w.adminNamesAsked).toEqual([[ADMIN]]);
    expect(w.store.calls.filter((call) => call.startsWith('read parties'))).toEqual([
      `read parties ${STUDENT}`,
    ]);
    expect(w.store.calls.some((call) => call.startsWith('lock'))).toBe(false);
    expect(w.lines).toEqual([]);
  });
});
