// 006:T018 (FR-726, FR-727; app-surface.md `programme.get`, admin-surface.md `programmes.queue` and
// `programmes.get`) — the reads over stores stood in memory: what each answers and to whom.
//   - `programme.get`: the two parties only (anyone else NOT_FOUND, as an unknown id); the card to
//     the student alone and never its token (SC-707); `payeePending` as payments' entry answers it;
//     `payBlocked`, `teacherUnavailable`, `chargePending`, `renewOpen` and the due point derived from
//     the paid month's sessions;
//   - `programmes.queue`: oldest first in pages, a `no_offer` item with whether the assessment was
//     held, a `pay_blocked` one with whether the payout account is verified now;
//   - `programmes.get`: the orders by kind, the items with their reasons, `cardSaved` a boolean, and
//     whether the assessment was held on a closed programme with no `assessment` release.
// The rows against Postgres are `tests/db-integrity/programme-reads.spec.ts`'.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  checkedProgrammeRenew,
  createProgrammeAdminReads,
  type ProgrammeAdminReadPayments,
  type ProgrammeAdminReadStore,
  type ProgrammeReadPayments,
  type ProgrammeReadStore,
  type ProgrammeRenewStore,
  readProgramme,
} from './programmes.service.js';
import type {
  ProgrammeMonthRow,
  ProgrammeRequestView,
  ProgrammeView,
} from './programmes.repository.js';
import type { AutomaticOrderFacts, MonthOrders } from './programmes.rules.js';

const tx = {} as Transaction;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ENROLLMENT = id(1);
const STUDENT = id(2);
const TEACHER = id(3);
const STRANGER = id(4);
const NOW = new Date('2026-12-10T10:00:00Z');
/** Month 2's last session ends on 2026-12-12 at 18:00: the due point. */
const DUE = new Date('2026-12-12T18:00:00Z');
const EARLY_DAYS = 3;
/** §3.14: `programme_stop_request_days` (7) and `programme_pay_reminder_hours` (12, DEC-114). */
const STOP_DAYS = 7;
const REMINDER_HOURS = 12;

const VIEW: ProgrammeView = {
  enrollmentId: ENROLLMENT,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  status: 'confirmed',
  state: 'active',
  offerDueAt: new Date('2026-10-02T10:00:00Z'),
  payByAt: new Date('2026-10-03T10:00:00Z'),
  offer: {
    level: 'يحفظ جزء عم',
    readiness: 'جاهز',
    expectedLength: 'عشرة أشهر',
    offeredAt: new Date('2026-10-01T10:00:00Z'),
    durationMinutes: 45,
    sessionCount: 40,
    total_piasters: piasters(1_000_000),
  },
  plan: 'monthly',
  monthsPaid: 2,
  monthCount: 10,
  pausedAt: null,
  closedAt: null,
};

const SESSIONS = [
  { programmeMonth: 1, endsAt: new Date('2026-11-14T18:00:00Z') },
  { programmeMonth: 2, endsAt: DUE },
  { programmeMonth: 2, endsAt: new Date('2026-12-05T18:00:00Z') },
];

const NO_ORDERS: MonthOrders = {
  cardSaved: false,
  payable: false,
  processing: false,
  automatic: null,
};

/** The month's automatic order, `created` and unexpired unless changed. */
function automaticOrder(change: Partial<AutomaticOrderFacts> = {}): AutomaticOrderFacts {
  return {
    paymentId: id(7),
    status: 'created',
    expiresAt: new Date('2026-12-10T10:05:00Z'),
    declineKind: null,
    attempt: 0,
    failedAt: null,
    ...change,
  };
}

/** The same programme as the renewal's check reads it. */
function monthRowOf(view: ProgrammeView): ProgrammeMonthRow {
  return {
    enrollmentId: view.enrollmentId,
    studentUserId: view.studentUserId,
    teacherUserId: view.teacherUserId,
    status: view.status,
    state: view.state,
    plan: view.plan,
    monthsPaid: view.monthsPaid,
    monthCount: view.monthCount,
    nextDueAt: null,
    firstFailureAt: null,
    retriesDone: 0,
    slotId: id(6),
    timezone: 'Africa/Cairo',
    offerSessionCount: 40,
    offerTotal_piasters: piasters(1_000_000),
  };
}

function readStoreOf(overrides: Partial<ProgrammeReadStore> = {}): ProgrammeReadStore {
  return {
    viewOf: async (_tx, enrollmentId) => (enrollmentId === ENROLLMENT ? VIEW : null),
    sessionsOf: async () => SESSIONS,
    payBlockedOpen: async () => false,
    standingOf: async () => ({
      accountStatus: 'active',
      teacher: { verificationStatus: 'approved', applicationStatus: 'approved' },
    }),
    clock: async () => NOW,
    openCaseOf: async () => null,
    ...overrides,
  } as ProgrammeReadStore;
}

function paymentsOf(overrides: Partial<ProgrammeReadPayments> = {}): ProgrammeReadPayments {
  return {
    payee: { unverifiedInLiveMode: async () => false },
    monthOrders: async () => ({ ...NO_ORDERS, cardSaved: true }),
    // A stand-in that knows more than it should say: the read hands on last4 and brand alone.
    cardOf: async () =>
      ({ last4: '4242', brand: 'Visa', token: 'placeholder-card-token' }) as {
        last4: string;
        brand: string;
      },
    ...overrides,
  };
}

const read = (
  userId: string,
  {
    store = readStoreOf(),
    payments = paymentsOf(),
    enrollmentId = ENROLLMENT,
  }: { store?: ProgrammeReadStore; payments?: ProgrammeReadPayments; enrollmentId?: string } = {},
) =>
  readProgramme(tx, userId, enrollmentId, {
    payments,
    earlyDays: EARLY_DAYS,
    stopDays: STOP_DAYS,
    reminderHours: REMINDER_HOURS,
    store,
  });

describe('programme.get (006:T018, FR-726)', () => {
  it('answers the student the programme, the offer, the months and the saved card', async () => {
    expect(await read(STUDENT)).toStrictEqual({
      state: 'active',
      offerDueAt: '2026-10-02T10:00:00.000Z',
      payBy: '2026-10-03T10:00:00.000Z',
      offer: {
        level: 'يحفظ جزء عم',
        readiness: 'جاهز',
        expectedLength: 'عشرة أشهر',
        durationMinutes: 45,
        sessionCount: 40,
        total_piasters: piasters(1_000_000),
        sessionPrice_piasters: piasters(25_000),
        offeredAt: '2026-10-01T10:00:00.000Z',
      },
      plan: 'monthly',
      monthsPaid: 2,
      monthCount: 10,
      nextDueAt: DUE.toISOString(),
      paused: null,
      renewOpen: false,
      chargePending: false,
      payeePending: false,
      payBlocked: false,
      teacherUnavailable: false,
      card: { last4: '4242', brand: 'Visa' },
      // 006:T019, T020 (B-P4): neither instant on an active programme.
      stopRequestFrom: null,
      payReminderFrom: null,
    });
  });

  // 006:T020 (B-P4's conflict check, Q-2 (a), the owner, 2026-11-25; SRS DEC-112): the teacher's stop
  // button shows from `paused_at` + `programme_stop_request_days` (7), `too_early`'s own rule; null
  // unless paused, and to the student. Example: paused Mon 23 Nov 18:00 Cairo → Mon 30 Nov 18:00.
  describe('stopRequestFrom (006:T020, Q-2 (a))', () => {
    const pausedAt = new Date('2026-11-23T16:00:00Z');
    const paused: ProgrammeView = { ...VIEW, state: 'paused', pausedAt };
    const store = readStoreOf({ viewOf: async () => paused });

    it('answers the teacher paused_at + 7 days on a paused programme', async () => {
      expect((await read(TEACHER, { store })).stopRequestFrom).toBe('2026-11-30T16:00:00.000Z');
    });

    it('answers the student null on the same programme', async () => {
      expect((await read(STUDENT, { store })).stopRequestFrom).toBeNull();
    });

    it('answers the teacher null on a programme not paused', async () => {
      expect((await read(TEACHER)).stopRequestFrom).toBeNull();
    });
  });

  // 006:T019 (Q-5 (b), SRS DEC-114, FR-708): the «pay before» line shows from `payBy` −
  // `programme_pay_reminder_hours` (12) while `offered`, to both parties; null otherwise. The
  // example: offer Mon 18:00, `payBy` Wed 25 Nov 18:00 Cairo, the line from Wed 06:00.
  describe('payReminderFrom (006:T019, Q-5 (b))', () => {
    const offered: ProgrammeView = {
      ...VIEW,
      state: 'offered',
      payByAt: new Date('2026-11-25T16:00:00Z'),
      plan: null,
      monthsPaid: 0,
    };
    const store = readStoreOf({ viewOf: async () => offered });

    it('answers payBy − 12 hours on an offered programme, to both parties', async () => {
      expect((await read(STUDENT, { store })).payReminderFrom).toBe('2026-11-25T04:00:00.000Z');
      expect((await read(TEACHER, { store })).payReminderFrom).toBe('2026-11-25T04:00:00.000Z');
    });

    it('takes the hours the setting holds, 47 its most', async () => {
      const answer = await readProgramme(tx, STUDENT, ENROLLMENT, {
        payments: paymentsOf(),
        earlyDays: EARLY_DAYS,
        stopDays: STOP_DAYS,
        reminderHours: 47,
        store,
      });
      expect(answer.payReminderFrom).toBe('2026-11-23T17:00:00.000Z');
    });

    it('answers null once the programme left offered, its payBy kept', async () => {
      expect(VIEW.payByAt).not.toBeNull();
      expect((await read(STUDENT)).payReminderFrom).toBeNull();
    });
  });

  it('answers the teacher the same programme with no card (SC-707)', async () => {
    const answer = await read(TEACHER);
    expect(answer.card).toBeNull();
    expect(answer.nextDueAt).toBe(DUE.toISOString());
    expect(JSON.stringify(answer)).not.toMatch(/4242|Visa|placeholder-card-token/);
  });

  it('hands the student the last four digits and the brand only, never the token (SC-707)', async () => {
    expect(JSON.stringify(await read(STUDENT))).not.toMatch(/placeholder-card-token|token/);
  });

  it('answers NOT_FOUND to anyone but its two parties, as an unknown id', async () => {
    await expect(read(STRANGER)).rejects.toEqual(new DomainError('NOT_FOUND'));
    await expect(read(STUDENT, { enrollmentId: id(9) })).rejects.toEqual(
      new DomainError('NOT_FOUND'),
    );
  });

  it('says payeePending as payments answers it: true in live mode unverified, false in test mode', async () => {
    const live = paymentsOf({ payee: { unverifiedInLiveMode: async () => true } });
    expect((await read(STUDENT, { payments: live })).payeePending).toBe(true);
    const test = paymentsOf({ payee: { unverifiedInLiveMode: async () => false } });
    expect((await read(STUDENT, { payments: test })).payeePending).toBe(false);
  });

  it('says payBlocked while a pay_blocked item is open', async () => {
    const store = readStoreOf({ payBlockedOpen: async () => true });
    expect((await read(STUDENT, { store })).payBlocked).toBe(true);
  });

  it.each([
    ['gone', null, true],
    ['suspended', 'suspended', true],
    ['banned', 'banned', true],
    ['active', 'active', false],
  ] as const)(
    'says teacherUnavailable when the teacher is %s',
    async (_name, status, unavailable) => {
      const store = readStoreOf({
        standingOf: async (_tx, userId) => {
          expect(userId).toBe(TEACHER);
          return status === null
            ? null
            : { accountStatus: status, teacher: { verificationStatus: 'approved' } };
        },
      } as Partial<ProgrammeReadStore>);
      expect((await read(STUDENT, { store })).teacherUnavailable).toBe(unavailable);
    },
  );

  // Q-f2 (a), the owner, 2026-11-24: pending while the order is `created`, until the gateway
  // answers, expired or not. Example: 1,000 EGP charged at 18:00, expiring at 18:10 unanswered.
  it('says chargePending while the month’s automatic order is created, expired or not, until it is answered', async () => {
    for (const [status, expiresAt, pending] of [
      ['created', new Date('2026-12-10T10:05:00Z'), true],
      ['created', new Date('2026-12-10T09:50:00Z'), true],
      ['failed', new Date('2026-12-10T10:05:00Z'), false],
      ['expired', new Date('2026-12-10T09:50:00Z'), false],
    ] as const) {
      const payments = paymentsOf({
        monthOrders: async (_tx, enrollmentId, month) => {
          expect([enrollmentId, month]).toEqual([ENROLLMENT, 3]);
          return { ...NO_ORDERS, automatic: automaticOrder({ status, expiresAt }) };
        },
      });
      expect((await read(STUDENT, { payments })).chargePending).toBe(pending);
    }
  });

  // Q-f3 (a), the owner, 2026-11-24: `renewOpen` is «programme.renew would be accepted now». Each
  // branch is held against the renewal's own check (`checkedProgrammeRenew`) on the same facts, and
  // the read adds `payeePending` (the checkout's refusal before the gateway).
  describe('renewOpen is programme.renew’s own answer (Q-f3 (a))', () => {
    interface Branch {
      readonly name: string;
      readonly view?: ProgrammeView;
      readonly month?: MonthOrders;
      readonly now?: Date;
      readonly suspension?: string;
      readonly payeePending?: boolean;
      readonly open: boolean;
    }
    const card = { ...NO_ORDERS, cardSaved: true };
    const branches: readonly Branch[] = [
      { name: 'no card, from the early days before the due point: renew now', open: true },
      {
        name: 'no card, before the early days',
        now: new Date('2026-12-09T17:59:00Z'),
        open: false,
      },
      { name: 'a card saved and no failure', month: card, open: false },
      {
        name: 'a card saved after a failed charge: pay now, change card',
        month: { ...card, automatic: automaticOrder({ status: 'failed', declineKind: 'soft' }) },
        open: true,
      },
      {
        name: 'a card saved after an expired charge: pay now, change card',
        month: { ...card, automatic: automaticOrder({ status: 'expired' }) },
        open: true,
      },
      {
        name: 'a charge pending, expired and unanswered',
        month: {
          ...card,
          automatic: automaticOrder({ expiresAt: new Date('2026-12-10T09:50:00Z') }),
        },
        open: false,
      },
      { name: 'a suspension open', suspension: 'teacher_suspended', open: false },
      { name: 'payeePending, renew now otherwise', payeePending: true, open: false },
      { name: 'paid in full', view: { ...VIEW, plan: 'in_full', monthsPaid: 10 }, open: false },
      { name: 'every month paid', view: { ...VIEW, monthsPaid: 10 }, open: false },
      { name: 'closed', view: { ...VIEW, state: 'closed', closedAt: NOW }, open: false },
    ];

    it.each(branches)('$name', async (branch) => {
      const view = branch.view ?? VIEW;
      const month = branch.month ?? NO_ORDERS;
      const now = branch.now ?? NOW;
      const openCaseOf = async (_tx: Transaction, _id: string, reason: string) =>
        branch.suspension === reason ? id(8) : null;
      const answer = await read(STUDENT, {
        store: readStoreOf({ viewOf: async () => view, clock: async () => now, openCaseOf }),
        payments: paymentsOf({
          monthOrders: async () => month,
          cardOf: async () => (month.cardSaved ? { last4: '4242', brand: 'Visa' } : null),
          payee: { unverifiedInLiveMode: async () => branch.payeePending === true },
        }),
      });
      const renewStore: ProgrammeRenewStore = {
        programmeMonthOf: async () => monthRowOf(view),
        lockRows: async () => undefined,
        ownActiveHold: async () => null,
        activeHoldsByIds: async () => [],
        openCaseOf,
        clock: async () => now,
        sessionsOf: async () => SESSIONS,
      };
      const accepted = await checkedProgrammeRenew(
        tx,
        { studentUserId: STUDENT, enrollmentId: ENROLLMENT },
        {
          orders: async () => new Map(),
          monthOrders: async () => month,
          earlyDays: EARLY_DAYS,
          log: { info: () => undefined },
          store: renewStore,
        },
      ).then(
        () => true,
        () => false,
      );
      expect(answer.renewOpen).toBe(branch.open);
      expect(answer.renewOpen).toBe(accepted && branch.payeePending !== true);
    });
  });

  it('answers a programme awaiting its offer with no offer, no month and no due point', async () => {
    const awaiting: ProgrammeView = {
      ...VIEW,
      state: 'awaiting_offer',
      payByAt: null,
      offer: null,
      plan: null,
      monthsPaid: 0,
      monthCount: null,
    };
    const answer = await read(STUDENT, { store: readStoreOf({ viewOf: async () => awaiting }) });
    expect(answer).toMatchObject({
      state: 'awaiting_offer',
      offer: null,
      plan: null,
      monthsPaid: 0,
      monthCount: null,
      nextDueAt: null,
      renewOpen: false,
      chargePending: false,
    });
  });

  it('says since when a paused programme is paused', async () => {
    const paused = {
      ...VIEW,
      state: 'paused' as const,
      pausedAt: new Date('2026-12-13T09:00:00Z'),
    };
    const answer = await read(TEACHER, { store: readStoreOf({ viewOf: async () => paused }) });
    expect(answer.paused).toEqual({ since: '2026-12-13T09:00:00.000Z' });
  });
});

// ---------------------------------------------------------------------------------------------
// The administrator's reads.

const PAGE_SIZE = 2;
const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
    return schema.parse(PAGE_SIZE);
  },
};

const NAMES = new Map([
  [STUDENT, 'آمال'],
  [TEACHER, 'المعلمة سارة'],
]);

/** When the n-th item was created: the n-th of November at 10:00. */
const CREATED = ['2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z', '2026-11-03T10:00:00Z'];

const item = (n: number, overrides: Partial<ProgrammeRequestView> = {}): ProgrammeRequestView => ({
  id: id(100 + n),
  enrollmentId: ENROLLMENT,
  kind: 'no_offer',
  reason: null,
  status: 'open',
  createdAt: new Date(CREATED[n - 1] ?? '2026-11-09T10:00:00Z'),
  decidedAt: null,
  ...overrides,
});

function adminStoreOf(overrides: Partial<ProgrammeAdminReadStore> = {}) {
  const asked: unknown[][] = [];
  const store: ProgrammeAdminReadStore = {
    viewOf: async (_tx, enrollmentId) => (enrollmentId === ENROLLMENT ? VIEW : null),
    sessionsOf: async () => SESSIONS,
    requestsOf: async () => [],
    openItemsPage: async (_tx, kind, after, take) => {
      asked.push(['openItemsPage', kind, after, take]);
      return [item(1, { kind }), item(2, { kind }), item(3, { kind })]
        .filter(({ id: itemId }) => after === undefined || itemId > after)
        .slice(0, take);
    },
    pausedPage: async (_tx, after, take) => {
      asked.push(['pausedPage', after, take]);
      return [{ enrollmentId: ENROLLMENT, pausedAt: new Date('2026-11-20T10:00:00Z') }];
    },
    programmesAmong: async (_tx, ids) =>
      new Map(
        ids.map((one) => [
          one,
          {
            enrollmentId: one,
            studentUserId: STUDENT,
            teacherUserId: TEACHER,
            state: 'paused' as const,
            pausedAt: new Date('2026-11-20T10:00:00Z'),
          },
        ]),
      ),
    assessmentOutcome: async () => ({
      kind: 'delivered',
      endsAt: new Date('2026-09-30T10:30:00Z'),
    }),
    namesOf: async (_tx, ids) => {
      asked.push(['namesOf', [...ids].sort()]);
      return new Map(ids.flatMap((one) => (NAMES.has(one) ? [[one, NAMES.get(one)!]] : [])));
    },
    clock: async () => NOW,
    ...overrides,
  };
  return { store, asked };
}

function adminPaymentsOf(overrides: Partial<ProgrammeAdminReadPayments> = {}) {
  return {
    payee: { unverifiedInLiveMode: async () => true },
    // A stand-in that knows more than it should say: only whether a card is saved is read.
    monthOrders: async () =>
      ({
        ...NO_ORDERS,
        cardSaved: true,
        last4: '4242',
        token: 'placeholder-card-token',
      }) as MonthOrders,
    ordersOf: async () => [
      {
        id: id(11),
        kind: 'assessment' as const,
        instalmentMonth: null,
        status: 'paid' as const,
        automatic: false,
        declineKind: null,
        createdAt: new Date('2026-09-25T10:00:00Z'),
      },
      {
        id: id(12),
        kind: 'instalment' as const,
        instalmentMonth: 3,
        status: 'failed' as const,
        automatic: true,
        declineKind: 'hard' as const,
        createdAt: new Date('2026-12-12T18:01:00Z'),
      },
    ],
    assessmentReleased: async () => false,
    ...overrides,
  } satisfies ProgrammeAdminReadPayments;
}

const adminReads = (
  store: ProgrammeAdminReadStore,
  payments: ProgrammeAdminReadPayments = adminPaymentsOf(),
) => createProgrammeAdminReads({ settings, payments, store });

describe('programmes.queue (006:T018, FR-727)', () => {
  it('lists the paused programmes longest paused first, with since when, one more read than the page', async () => {
    const { store, asked } = adminStoreOf();
    expect(await adminReads(store).queue(tx, { filter: 'paused' })).toEqual({
      items: [
        {
          enrollmentId: ENROLLMENT,
          teacher: { displayName: 'المعلمة سارة' },
          student: { displayName: 'آمال' },
          state: 'paused',
          pausedSince: '2026-11-20T10:00:00.000Z',
          request: null,
          payeeVerifiedNow: null,
        },
      ],
    });
    expect(asked[0]).toEqual(['pausedPage', undefined, PAGE_SIZE + 1]);
  });

  it('lists a kind’s open items oldest first, a cursor only while more follow', async () => {
    const { store, asked } = adminStoreOf();
    const reads = adminReads(store);
    const first = await reads.queue(tx, { filter: 'stop' });
    expect(first.items.map(({ request }) => request?.requestId)).toEqual([id(101), id(102)]);
    expect(first.nextCursor).toBe(id(102));
    const rest = await reads.queue(tx, { filter: 'stop', cursor: id(102) });
    expect(rest.items.map(({ request }) => request?.requestId)).toEqual([id(103)]);
    expect(rest).not.toHaveProperty('nextCursor');
    expect(asked.filter(([name]) => name === 'openItemsPage')).toEqual([
      ['openItemsPage', 'stop', undefined, PAGE_SIZE + 1],
      ['openItemsPage', 'stop', id(102), PAGE_SIZE + 1],
    ]);
  });

  it('says on a no_offer item whether the assessment was held, and on no other', async () => {
    const held = adminStoreOf();
    const offerItems = await adminReads(held.store).queue(tx, { filter: 'no_offer' });
    expect(offerItems.items[0]?.request).toMatchObject({ kind: 'no_offer', assessmentHeld: true });
    const ended = adminStoreOf({
      assessmentOutcome: async () => ({ kind: 'ended', endsAt: new Date('2026-09-30T10:30:00Z') }),
    });
    const notHeld = await adminReads(ended.store).queue(tx, { filter: 'no_offer' });
    expect(notHeld.items[0]?.request).toMatchObject({ assessmentHeld: false });
    const stops = await adminReads(held.store).queue(tx, { filter: 'stop' });
    expect(stops.items[0]?.request).not.toHaveProperty('assessmentHeld');
  });

  it('says on a pay_blocked item whether the payout account is verified now, and null on others', async () => {
    const { store } = adminStoreOf();
    const blocked = await adminReads(store).queue(tx, { filter: 'pay_blocked' });
    expect(blocked.items[0]?.payeeVerifiedNow).toBe(false);
    const verified = adminPaymentsOf({ payee: { unverifiedInLiveMode: async () => false } });
    const now = await adminReads(store, verified).queue(tx, { filter: 'pay_blocked' });
    expect(now.items[0]?.payeeVerifiedNow).toBe(true);
    const unknown = await adminReads(store).queue(tx, { filter: 'charge_unknown' });
    expect(unknown.items[0]).toMatchObject({
      request: { kind: 'charge_unknown' },
      payeeVerifiedNow: null,
    });
  });

  it('carries a stop’s reason as the teacher wrote it', async () => {
    const { store } = adminStoreOf({
      openItemsPage: async () => [item(1, { kind: 'stop', reason: 'الطالب متأخر منذ أسبوعين' })],
    });
    const answer = await adminReads(store).queue(tx, { filter: 'stop' });
    expect(answer.items[0]?.request).toEqual({
      requestId: id(101),
      kind: 'stop',
      reason: 'الطالب متأخر منذ أسبوعين',
      status: 'open',
      createdAt: '2026-11-01T10:00:00.000Z',
    });
  });
});

describe('programmes.get (006:T018, FR-727)', () => {
  it('answers the programme, its orders by kind, its items with their reasons and cardSaved', async () => {
    const decided = item(1, {
      reason: 'أرسل المعلم أن الطالب غير مستعد',
      status: 'extended',
      decidedAt: new Date('2026-11-02T10:00:00Z'),
    });
    const { store } = adminStoreOf({ requestsOf: async () => [decided] });
    expect(await adminReads(store).get(tx, ENROLLMENT)).toStrictEqual({
      enrollmentId: ENROLLMENT,
      teacher: { displayName: 'المعلمة سارة' },
      student: { displayName: 'آمال' },
      state: 'active',
      offerDueAt: '2026-10-02T10:00:00.000Z',
      payBy: '2026-10-03T10:00:00.000Z',
      offer: {
        level: 'يحفظ جزء عم',
        readiness: 'جاهز',
        expectedLength: 'عشرة أشهر',
        durationMinutes: 45,
        sessionCount: 40,
        total_piasters: piasters(1_000_000),
        sessionPrice_piasters: piasters(25_000),
        offeredAt: '2026-10-01T10:00:00.000Z',
      },
      plan: 'monthly',
      monthsPaid: 2,
      monthCount: 10,
      nextDueAt: DUE.toISOString(),
      pausedAt: null,
      closedAt: null,
      orders: [
        {
          paymentId: id(11),
          kind: 'assessment',
          status: 'paid',
          automatic: false,
          createdAt: '2026-09-25T10:00:00.000Z',
        },
        {
          paymentId: id(12),
          kind: 'instalment',
          instalmentMonth: 3,
          status: 'failed',
          automatic: true,
          declineKind: 'hard',
          createdAt: '2026-12-12T18:01:00.000Z',
        },
      ],
      requests: [
        {
          requestId: id(101),
          kind: 'no_offer',
          reason: 'أرسل المعلم أن الطالب غير مستعد',
          status: 'extended',
          createdAt: '2026-11-01T10:00:00.000Z',
          decidedAt: '2026-11-02T10:00:00.000Z',
          assessmentHeld: true,
        },
      ],
      cardSaved: true,
    });
  });

  it('answers cardSaved as a boolean only, never a card detail (SC-707)', async () => {
    const { store } = adminStoreOf();
    const answer = await adminReads(store).get(tx, ENROLLMENT);
    expect(answer.cardSaved).toBe(true);
    expect(JSON.stringify(answer)).not.toMatch(/4242|placeholder-card-token|last4|token/);
  });

  it('says the assessment was not held on a closed programme with no assessment release', async () => {
    const closed: ProgrammeView = {
      ...VIEW,
      state: 'closed',
      closedAt: NOW,
      plan: null,
      monthsPaid: 0,
    };
    const { store } = adminStoreOf({
      viewOf: async () => closed,
      assessmentOutcome: async () => ({ kind: 'ended', endsAt: new Date('2026-09-30T10:30:00Z') }),
    });
    expect((await adminReads(store).get(tx, ENROLLMENT)).assessmentHeld).toBe(false);
    const released = adminPaymentsOf({ assessmentReleased: async () => true });
    expect(await adminReads(store, released).get(tx, ENROLLMENT)).not.toHaveProperty(
      'assessmentHeld',
    );
    const { store: open } = adminStoreOf();
    expect(await adminReads(open).get(tx, ENROLLMENT)).not.toHaveProperty('assessmentHeld');
  });

  it('answers NOT_FOUND for an enrollment with no programme', async () => {
    const { store } = adminStoreOf();
    await expect(adminReads(store).get(tx, id(9))).rejects.toEqual(new DomainError('NOT_FOUND'));
  });
});
