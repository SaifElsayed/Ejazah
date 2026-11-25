// 006:T017 of specs/006-programme (FR-723, FR-725, FR-727; R-513; SRS DEC-112 (3); contracts/
// app-surface.md `programme.request`, admin-surface.md `programmes.decide`; kernel.md, 006:T017's
// row) — the teacher's stop request and an administrator's decision on it, over a recorded store:
// - `programme.request` `stop`: refused `too_early` before `paused_at` + `programme_stop_request_days`
//   (7) on the database's clock, `request_open` while a stop is open, `not_paused` while the programme
//   is not paused; otherwise the open `stop` with the teacher's reason, its teacher the enrollment's;
//   the locks in kernel.md's order before any read that decides; one line of ids and a reason, never
//   the reason's text; `enrollment` to both parties after the commit;
// - `programmes.decide` on a `stop`: `decline` closes the item and ends nothing; `extend` is refused
//   `decision_not_allowed`; approving it while the programme is no longer paused is refused
//   `not_open`; approving it ends the programme `programme_stopped` through booking's own end.
// The rows over the real tables, the release and the races are `tests/db-integrity/
// programme-stop.spec.ts`'.
import type { ProgrammeRequestInput } from '@ijazah/contracts';
import type { ProgrammesDecideInput } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { DomainError } from '../../platform/errors/domain-error.js';
import { bindToTransaction, type LivePublisher } from '../../platform/live/live-publisher.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { SessionPartyRecord } from '../identity/index.js';
import type { ProgrammeEndStore } from './programme-close.service.js';
import type { ProgrammeRequestRow } from './programme-requests.repository.js';
import type { AutomaticOrderFacts } from './programmes.rules.js';
import {
  createProgrammeDecisions,
  type ProgrammeChargeDecisionPayments,
  type ProgrammeChargeDecisionStore,
  type ProgrammeDecisionStore,
  type ProgrammeReopenStore,
  type ProgrammeRequestStore,
  requestProgramme,
  type StoppedProgrammeRow,
} from './programme-requests.service.js';
import type { ProgrammeFacts, ProgrammeState } from './programmes.repository.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000017a1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000017a2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000017a3';
const REQUEST = '0199d0a0-0000-7000-8000-0000000017a4';
const ADMIN = '0199d0a0-0000-7000-8000-0000000017a5';
const OTHER_TEACHER = '0199d0a0-0000-7000-8000-0000000017a6';
const REASON = 'الطالب متأخر عن السداد منذ أسبوعين';
const PAUSED_AT = new Date('2026-11-10T16:00:00Z');
/** `paused_at` + 7 days of 24 hours: the first instant a stop is taken. */
const SEVEN_DAYS_ON = new Date('2026-11-17T16:00:00Z');
const tx = {} as Transaction;

function settingsOf(values: Record<string, unknown>, read: string[] = []): SettingsReader {
  return {
    read: async (key, schema) => {
      read.push(key);
      return schema.parse(values[key]);
    },
  };
}

function factsOf(state: ProgrammeState, status: ProgrammeFacts['status'] = 'confirmed') {
  return {
    enrollmentId: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status,
    state,
    offerDueAt: null,
    payByAt: null,
  } satisfies ProgrammeFacts;
}

interface RequestWorld {
  readonly state?: ProgrammeState;
  readonly status?: ProgrammeFacts['status'];
  readonly pausedAt?: Date | null;
  readonly now?: Date;
  readonly open?: boolean;
  readonly days?: number;
  readonly caller?: string;
}

function requestWorld({
  state = 'paused',
  status = 'confirmed',
  pausedAt = PAUSED_AT,
  now = SEVEN_DAYS_ON,
  open = false,
  days = 7,
  caller = TEACHER,
}: RequestWorld = {}) {
  const calls: string[] = [];
  const inserted: unknown[] = [];
  const lines: [Readonly<Record<string, unknown>>, string][] = [];
  const signals: [readonly string[], unknown][] = [];
  const read: string[] = [];
  const store: ProgrammeRequestStore = {
    programmeFactsOf: async () => {
      calls.push('facts');
      return factsOf(state, status);
    },
    lockAccount: async (_tx, userId) => {
      calls.push(`lock users ${userId}`);
    },
    lockProgramme: async (_tx, id) => {
      calls.push(`lock programmes ${id}`);
    },
    lockEnrollment: async (_tx, id) => {
      calls.push(`lock enrollments ${id}`);
    },
    pausedAtOf: async () => {
      calls.push('paused_at');
      return state === 'paused' ? pausedAt : null;
    },
    openRequestExists: async (_tx, _id, kind) => {
      calls.push(`open ${kind}`);
      return open;
    },
    insertRequest: async (_tx, item) => {
      calls.push('insert');
      inserted.push(item);
      return REQUEST;
    },
  };
  const ask = (input: Partial<Omit<ProgrammeRequestInput, 'idempotencyKey'>> = {}) =>
    requestProgramme(
      tx,
      caller,
      { enrollmentId: ENROLLMENT, kind: 'stop', reason: REASON, ...input },
      { afterCommit: (users, signal) => signals.push([users, signal]) },
      {
        log: { info: (fields, message) => lines.push([fields, message]) },
        settings: settingsOf({ programme_stop_request_days: days }, read),
        clock: async () => now,
        store,
      },
    );
  return { calls, inserted, lines, signals, read, ask };
}

async function causeOf(call: Promise<unknown>): Promise<string> {
  try {
    return `answered ${JSON.stringify(await call)}`;
  } catch (error: unknown) {
    const { code, details } = error as DomainError;
    return details?.[0]?.code ?? code ?? String(error);
  }
}

describe('programme.request stop (006:T017, FR-723, R-513)', () => {
  it('takes a stop from paused_at + 7 days: the open stop with the reason, its teacher the enrollment’s', async () => {
    const { ask, inserted, read } = requestWorld();
    await expect(ask()).resolves.toStrictEqual({ requestId: REQUEST });
    expect(inserted).toEqual([
      { enrollmentId: ENROLLMENT, teacherUserId: TEACHER, kind: 'stop', reason: REASON },
    ]);
    expect(read).toEqual(['programme_stop_request_days']);
  });

  it('takes the locks in kernel.md’s order before the reads that decide, the insert last', async () => {
    const { ask, calls } = requestWorld();
    await ask();
    expect(calls).toEqual([
      'facts',
      `lock users ${TEACHER}`,
      `lock programmes ${ENROLLMENT}`,
      `lock enrollments ${ENROLLMENT}`,
      'facts',
      'paused_at',
      'open stop',
      'insert',
    ]);
  });

  it('refuses too_early one second before paused_at + 7 days, writing nothing', async () => {
    const { ask, inserted } = requestWorld({ now: new Date('2026-11-17T15:59:59Z') });
    expect(await causeOf(ask())).toBe('too_early');
    expect(inserted).toEqual([]);
  });

  it('counts the days from the setting: 3 days takes a stop on day 3', async () => {
    const { ask } = requestWorld({ days: 3, now: new Date('2026-11-13T16:00:00Z') });
    await expect(ask()).resolves.toStrictEqual({ requestId: REQUEST });
  });

  it('refuses request_open while a stop is open, writing nothing', async () => {
    const { ask, inserted } = requestWorld({ open: true });
    expect(await causeOf(ask())).toBe('request_open');
    expect(inserted).toEqual([]);
  });

  it.each(['active', 'offered', 'awaiting_offer', 'closed'] as const)(
    'refuses not_paused on a programme %s, writing nothing',
    async (state) => {
      const { ask, inserted } = requestWorld({ state });
      expect(await causeOf(ask())).toBe('not_paused');
      expect(inserted).toEqual([]);
    },
  );

  it('refuses not_paused once the enrollment is no longer confirmed', async () => {
    const { ask, inserted } = requestWorld({ status: 'cancelled' });
    expect(await causeOf(ask())).toBe('not_paused');
    expect(inserted).toEqual([]);
  });

  it('answers another teacher’s programme NOT_FOUND before any lock', async () => {
    const { ask, calls } = requestWorld({ caller: OTHER_TEACHER });
    expect(await causeOf(ask())).toBe('NOT_FOUND');
    expect(calls).toEqual(['facts']);
  });

  it('logs one line of ids and a reason, never the teacher’s words; a refusal its cause', async () => {
    const taken = requestWorld();
    await taken.ask();
    expect(taken.lines).toEqual([
      [
        { teacherUserId: TEACHER, enrollmentId: ENROLLMENT, requestId: REQUEST, reason: 'stop' },
        'A programme stop was requested',
      ],
    ]);
    const early = requestWorld({ now: PAUSED_AT });
    await causeOf(early.ask());
    expect(early.lines).toEqual([
      [
        { teacherUserId: TEACHER, enrollmentId: ENROLLMENT, reason: 'too_early' },
        'A programme request was refused',
      ],
    ]);
    expect(JSON.stringify([...taken.lines, ...early.lines])).not.toContain(REASON);
  });

  it('sends `enrollment` to both parties after the commit, and nothing on a refusal', async () => {
    const taken = requestWorld();
    await taken.ask();
    expect(taken.signals).toEqual([
      [[STUDENT, TEACHER], { type: 'enrollment', enrollmentId: ENROLLMENT }],
    ]);
    const early = requestWorld({ now: PAUSED_AT });
    await causeOf(early.ask());
    expect(early.signals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The decision on a stop.

function decisionWorld(state: ProgrammeState = 'paused', { pending = false } = {}) {
  const decided: unknown[] = [];
  const ended: string[] = [];
  const pendingRead: string[] = [];
  const item: ProgrammeRequestRow = {
    id: REQUEST,
    enrollmentId: ENROLLMENT,
    teacherUserId: TEACHER,
    kind: 'stop',
    status: 'open',
    reason: REASON,
  };
  const store: ProgrammeDecisionStore = {
    requestById: async () => item,
    lockProgramme: async () => undefined,
    lockEnrollment: async () => undefined,
    programmeFactsOf: async () => factsOf(state),
    decideRequest: async (_tx, requestId, decision) => {
      decided.push({ requestId, ...decision });
      return true;
    },
    assessmentOutcome: async () => {
      throw new Error('a stop reads no assessment');
    },
    writeOfferDue: async () => {
      throw new Error('a stop writes no offer deadline');
    },
    writePayBy: async () => {
      throw new Error('a stop writes no pay-by');
    },
    sessionsPending: async (_tx, id) => {
      pendingRead.push(id);
      return pending;
    },
  };
  // Booking's own end, stood in; the close hook's rows are the DB spec's.
  const end: ProgrammeEndStore = {
    moveToCancelled: async (_tx, id, reason) => {
      ended.push(`cancelled ${id} ${reason}`);
      return true;
    },
    cancelRemainingSessions: async (_tx, id) => {
      ended.push(`sessions ${id}`);
    },
    recordCancelled: async (_tx, id, reason) => {
      ended.push(`event ${id} ${reason}`);
    },
  };
  // The close hook's two writes, on a stand-in transaction.
  const hookTx = {
    programme: {
      findMany: async () => [{ enrollmentId: ENROLLMENT }],
      updateMany: async () => ({ count: 1 }),
    },
    programmeRequest: { updateMany: async () => ({ count: 0 }) },
  } as unknown as Transaction;
  const decisions = createProgrammeDecisions({
    idempotency: {
      runOn: async (keyed, _request, effect) => ({ outcome: await effect(keyed), replayed: false }),
    },
    settings: settingsOf({}),
    deleteProgrammeCard: async (_tx, id) => {
      ended.push(`card ${id}`);
    },
    log: { info: () => undefined },
    clock: async () => SEVEN_DAYS_ON,
    store,
    end,
  });
  const decide = (decision: ProgrammesDecideInput['decision']) =>
    decisions.decide(hookTx, ADMIN, {
      requestId: REQUEST,
      decision,
      idempotencyKey: 'stop-decision-0001',
    });
  return { decided, ended, pendingRead, decide };
}

describe('programmes.decide on a stop (006:T017, FR-725, R-513)', () => {
  it('approving it ends the programme programme_stopped through booking’s own end and the close hook', async () => {
    const { decide, decided, ended } = decisionWorld();
    await expect(decide('approve')).resolves.toMatchObject({ answer: { status: 'approved' } });
    expect(decided).toEqual([
      { requestId: REQUEST, status: 'approved', adminId: ADMIN, at: SEVEN_DAYS_ON },
    ]);
    expect(ended).toEqual([
      `cancelled ${ENROLLMENT} programme_stopped`,
      `sessions ${ENROLLMENT}`,
      `event ${ENROLLMENT} programme_stopped`,
      `card ${ENROLLMENT}`,
    ]);
  });

  it('declining it closes the item declined and ends nothing', async () => {
    const { decide, decided, ended } = decisionWorld();
    await expect(decide('decline')).resolves.toMatchObject({ answer: { status: 'declined' } });
    expect(decided).toEqual([
      { requestId: REQUEST, status: 'declined', adminId: ADMIN, at: SEVEN_DAYS_ON },
    ]);
    expect(ended).toEqual([]);
  });

  it('refuses extending a stop decision_not_allowed, writing nothing', async () => {
    const { decide, decided, ended } = decisionWorld();
    expect(await causeOf(decide('extend'))).toBe('decision_not_allowed');
    expect([...decided, ...ended]).toEqual([]);
  });

  it.each(['active', 'closed'] as const)(
    'refuses approving a stop not_open once the programme is %s, writing nothing',
    async (state) => {
      const { decide, decided, ended } = decisionWorld(state);
      expect(await causeOf(decide('approve'))).toBe('not_open');
      expect([...decided, ...ended]).toEqual([]);
    },
  );

  // Q-e4 (b), the owner's worked example: month 1 is 4 × 250 EGP; session 5, a teacher's no-show,
  // has its make-up set for 12/03; the administrator approves the stop on 11/30: refused, so the
  // student never loses the 250 EGP session to a stop.
  it('refuses approving a stop sessions_pending while a session is scheduled or a remedy open, writing nothing', async () => {
    const { decide, decided, ended, pendingRead } = decisionWorld('paused', { pending: true });
    expect(await causeOf(decide('approve'))).toBe('sessions_pending');
    expect([...decided, ...ended]).toEqual([]);
    expect(pendingRead).toEqual([ENROLLMENT]);
  });

  it('still takes a decline while a session is pending', async () => {
    const { decide, decided } = decisionWorld('paused', { pending: true });
    await expect(decide('decline')).resolves.toMatchObject({ answer: { status: 'declined' } });
    expect(decided).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T021 (B-P4's conflict check, Q-1 (a) amended, the owner, 2026-11-25; SRS DEC-113; kernel.md,
// 006:T021's row; PR #160 r1 FU1): the decision on a `charge_unknown` item. Approve and extend only
// (no «confirm paid»: a payment is confirmed only by the gateway). Under the programme's row, then the
// enrollment's, then the month's automatic order's (payments' entry), the order's status is read:
// still `created` → approve writes it `expired` through payments' entry (a soft decline, no gateway
// call) and marks the month's first failure at the decision's instant, so the retries start from it;
// extend writes the item `extended` and nothing else. An order already answered (or none) → refused
// `charge_answered`, nothing written, one line of ids and the cause. Example: month 3, 1,000 EGP,
// charged Thu 18:31, the item at 19:31; Fri 10:00 the administrator finds nothing in Paymob and
// approves: the order expired, retry 1 Sat 10:00.
const PAYMENT = '0199d0a0-0000-7000-8000-0000000017b1';
const FRIDAY_1000 = new Date('2026-11-27T08:00:00Z');
/** The decision's idempotency key, a plain label (no secret). */
const CHARGE_DECISION = 'charge-decision-0001';

function chargeWorld({
  seen = 'created',
  locked = seen,
  automatic = true,
}: {
  readonly seen?: AutomaticOrderFacts['status'];
  readonly locked?: string | null;
  readonly automatic?: boolean;
} = {}) {
  const calls: string[] = [];
  const decided: unknown[] = [];
  const lines: [Readonly<Record<string, unknown>>, string][] = [];
  const item: ProgrammeRequestRow = {
    id: REQUEST,
    enrollmentId: ENROLLMENT,
    teacherUserId: TEACHER,
    kind: 'charge_unknown',
    status: 'open',
    reason: null,
  };
  const store: ProgrammeDecisionStore = {
    requestById: async () => item,
    lockProgramme: async (_tx, id) => {
      calls.push(`lock programmes ${id}`);
    },
    lockEnrollment: async (_tx, id) => {
      calls.push(`lock enrollments ${id}`);
    },
    programmeFactsOf: async () => factsOf('active'),
    decideRequest: async (_tx, requestId, decision) => {
      calls.push('decide item');
      decided.push({ requestId, ...decision });
      return true;
    },
    assessmentOutcome: async () => {
      throw new Error('a charge decision reads no assessment');
    },
    writeOfferDue: async () => {
      throw new Error('a charge decision writes no offer deadline');
    },
    writePayBy: async () => {
      throw new Error('a charge decision writes no pay-by');
    },
    sessionsPending: async () => {
      throw new Error('a charge decision reads no session');
    },
  };
  const chargeStore: ProgrammeChargeDecisionStore = {
    monthsPaidOf: async (_tx, id) => {
      calls.push(`months paid ${id}`);
      return 2;
    },
    writeFirstFailure: async (_tx, id, at) => {
      calls.push(`first failure ${id} ${at.toISOString()}`);
      return true;
    },
  };
  const charges: ProgrammeChargeDecisionPayments = {
    monthOrders: async (_tx, id, month) => {
      calls.push(`month ${String(month)} of ${id}`);
      return {
        cardSaved: true,
        payable: false,
        processing: false,
        automatic: automatic
          ? {
              paymentId: PAYMENT,
              status: seen,
              expiresAt: new Date('2026-11-26T16:41:00Z'),
              declineKind: null,
              attempt: 0,
              failedAt: null,
            }
          : null,
      };
    },
    lockOrder: async (_tx, ref) => {
      calls.push(`lock payments ${ref.paymentId} of ${ref.enrollmentId}`);
      return locked;
    },
    expireOrder: async (_tx, paymentId) => {
      calls.push(`expire ${paymentId}`);
      return true;
    },
  };
  const decisions = createProgrammeDecisions({
    idempotency: {
      runOn: async (keyed, _request, effect) => ({ outcome: await effect(keyed), replayed: false }),
    },
    settings: settingsOf({}),
    deleteProgrammeCard: async () => {
      throw new Error('a charge decision deletes no card');
    },
    log: { info: (fields, message) => lines.push([fields, message]) },
    clock: async () => FRIDAY_1000,
    store,
    chargeStore,
    charges,
  });
  const decide = (decision: ProgrammesDecideInput['decision']) =>
    decisions.decide(tx, ADMIN, {
      requestId: REQUEST,
      decision,
      idempotencyKey: CHARGE_DECISION,
    });
  return { calls, decided, lines, decide };
}

describe('programmes.decide on a charge_unknown item (006:T021, Q-1 (a) amended)', () => {
  it('approving it, the order still created: the locks in kernel.md’s order, the order expired, the first failure at the decision', async () => {
    const { decide, decided, calls } = chargeWorld();
    await expect(decide('approve')).resolves.toMatchObject({ answer: { status: 'approved' } });
    expect(calls).toEqual([
      `lock programmes ${ENROLLMENT}`,
      `lock enrollments ${ENROLLMENT}`,
      `months paid ${ENROLLMENT}`,
      `month 3 of ${ENROLLMENT}`,
      `lock payments ${PAYMENT} of ${ENROLLMENT}`,
      'decide item',
      `expire ${PAYMENT}`,
      `first failure ${ENROLLMENT} ${FRIDAY_1000.toISOString()}`,
    ]);
    expect(decided).toEqual([
      { requestId: REQUEST, status: 'approved', adminId: ADMIN, at: FRIDAY_1000 },
    ]);
  });

  it('extending it, the order still created: the item extended, the order and the month untouched', async () => {
    const { decide, decided, calls } = chargeWorld();
    await expect(decide('extend')).resolves.toMatchObject({ answer: { status: 'extended' } });
    expect(decided).toEqual([
      { requestId: REQUEST, status: 'extended', adminId: ADMIN, at: FRIDAY_1000 },
    ]);
    expect(calls.filter((call) => /^(expire|first failure)/.test(call))).toEqual([]);
  });

  it('refuses a decline decision_not_allowed: approve and extend only, no «confirm paid»', async () => {
    const { decide, decided, calls } = chargeWorld();
    expect(await causeOf(decide('decline'))).toBe('decision_not_allowed');
    expect(decided).toEqual([]);
    expect(calls.filter((call) => /^(expire|first failure)/.test(call))).toEqual([]);
  });

  it.each([
    ['paid', 'paid', 'approve'],
    ['failed', 'failed', 'extend'],
    ['expired', 'expired', 'approve'],
  ] as const)(
    'refuses charge_answered once the order is %s, writing nothing (%s, %s)',
    async (seen, locked, decision) => {
      const { decide, decided, calls, lines } = chargeWorld({ seen, locked });
      expect(await causeOf(decide(decision))).toBe('charge_answered');
      expect(decided).toEqual([]);
      expect(calls.filter((call) => /^(expire|first failure|decide)/.test(call))).toEqual([]);
      expect(lines).toEqual([
        [
          { adminId: ADMIN, requestId: REQUEST, enrollmentId: ENROLLMENT, reason: 'charge_answered' },
          'A programme decision was refused',
        ],
      ]);
    },
  );

  it('refuses charge_answered when the gateway answered between the read and the order’s lock', async () => {
    const { decide, decided, calls } = chargeWorld({ seen: 'created', locked: 'paid' });
    expect(await causeOf(decide('approve'))).toBe('charge_answered');
    expect(decided).toEqual([]);
    expect(calls).toContain(`lock payments ${PAYMENT} of ${ENROLLMENT}`);
    expect(calls.filter((call) => /^(expire|first failure|decide)/.test(call))).toEqual([]);
  });

  // PR #160 r1 FU1: the last month recorded paid leaves the next month with no automatic order.
  it('refuses charge_answered when the month has no automatic order any more', async () => {
    const { decide, decided } = chargeWorld({ automatic: false });
    expect(await causeOf(decide('extend'))).toBe('charge_answered');
    expect(decided).toEqual([]);
  });

  it('logs one line of ids and the decision, never an amount or a card detail', async () => {
    const { decide, lines } = chargeWorld();
    await decide('approve');
    expect(lines).toEqual([
      [
        {
          adminId: ADMIN,
          requestId: REQUEST,
          enrollmentId: ENROLLMENT,
          kind: 'charge_unknown',
          paymentId: PAYMENT,
          reason: 'approved',
        },
        'A programme item was decided',
      ],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T017 — `programmes.reopen` (FR-725, FR-727; R-513; admin-surface.md `programmes.reopen`;
// kernel.md, 006:T017's row): a `programme_stopped` programme back to `paused`, `paused_at` the
// reopen's instant, under the slot's lock (both accounts, the teacher's slots' key, the slot, then
// the programme and the enrollment, kernel.md's order), refused as restore is: `party_restricted`
// (an account not active, the teacher's approval gone), `gender_mismatch` (either direction),
// `slot_taken` (another hold or enrollment uses the weekly time); and the owner's additions of
// 2026-11-24: `not_stopped`, `slot_inactive`, `time_taken` (another booking of a party over the
// weekly time's coming weeks); a refusal writes nothing.

const SLOT = '0199d0a0-0000-7000-8000-0000000017a7';
const REOPENED_AT = new Date('2026-11-26T10:00:00Z');
const ADMIN_REASON = 'سدد الطالب المتأخرات خارج التطبيق';

interface ReopenWorld {
  readonly student?: Partial<SessionPartyRecord>;
  readonly teacher?: Partial<SessionPartyRecord>;
  readonly taken?: boolean;
  readonly replayed?: boolean;
  /** The programme's row as read, a stopped one by default. */
  readonly closing?: Partial<StoppedProgrammeRow>;
  /** The weekly time: active by default; `inactive` or `gone`. */
  readonly slot?: 'active' | 'inactive' | 'gone';
  /** The parties' busy times the store answers. */
  readonly busy?: readonly { readonly startsAt: Date; readonly endsAt: Date }[];
}

const party = (overrides: Partial<SessionPartyRecord> = {}): SessionPartyRecord => ({
  gender: 'male',
  accountStatus: 'active',
  teacherApproved: false,
  displayName: 'Probe',
  ...overrides,
});

function reopenWorld({
  student = {},
  teacher = {},
  taken = false,
  replayed = false,
  closing = {},
  slot = 'active',
  busy = [],
}: ReopenWorld = {}) {
  const calls: string[] = [];
  const lines: [Readonly<Record<string, unknown>>, string][] = [];
  const signals: [readonly string[], unknown][] = [];
  const windows: { from: Date; to: Date }[] = [];
  const stopped: StoppedProgrammeRow = {
    enrollmentId: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    slotId: SLOT,
    status: 'cancelled',
    cancellationReason: 'programme_stopped',
    state: 'closed',
    timezone: 'Africa/Cairo',
    // 40 sessions, month 1 paid: 36 weekly sessions to come.
    monthsPaid: 1,
    offerSessionCount: 40,
    ...closing,
  };
  const reopenStore: ProgrammeReopenStore = {
    programmeOf: async () => {
      calls.push('programme');
      return stopped;
    },
    lockAccounts: async (_tx, ids) => {
      calls.push(`lock users ${ids.join(',')}`);
    },
    lockTeacherSlots: async (_tx, id) => {
      calls.push(`lock teacher-slots ${id}`);
    },
    lockSlot: async (_tx, id) => {
      calls.push(`lock availability_slots ${id}`);
    },
    lockProgramme: async (_tx, id) => {
      calls.push(`lock programmes ${id}`);
    },
    lockEnrollment: async (_tx, id) => {
      calls.push(`lock enrollments ${id}`);
    },
    partiesOf: async () => {
      calls.push('parties');
      return new Map([
        [STUDENT, party(student)],
        [TEACHER, party({ teacherApproved: true, ...teacher })],
      ]);
    },
    slotOf: async () => {
      calls.push('slot');
      return slot === 'gone'
        ? null
        : {
            id: SLOT,
            dayOfWeek: 4,
            startTimeLocal: '09:00:00',
            durationMinutes: 60,
            timezone: 'Africa/Cairo',
            isActive: slot === 'active',
            createdAt: PAUSED_AT,
          };
    },
    slotTaken: async (_tx, _slotId, at) => {
      calls.push(`occupancy at ${at.toISOString()}`);
      return taken;
    },
    busyTimesOf: async (_tx, parties, window) => {
      calls.push(`busy ${parties.studentUserId},${parties.teacherUserId}`);
      windows.push(window);
      return busy;
    },
    reopenEnrollment: async (_tx, id) => {
      calls.push(`write enrollment ${id}`);
      return true;
    },
    reopenProgramme: async (_tx, id, pausedAt) => {
      calls.push(`write programme ${id} paused ${pausedAt.toISOString()}`);
      return true;
    },
    recordReopened: async (_tx, id, occurredAt) => {
      calls.push(`event ${id} ${occurredAt.toISOString()}`);
    },
  };
  const keyed: unknown[] = [];
  const decisions = createProgrammeDecisions({
    idempotency: {
      runOn: async (on, request, effect) => {
        keyed.push(request);
        return replayed
          ? { outcome: { state: 'paused' } as never, replayed: true }
          : { outcome: await effect(on), replayed: false };
      },
    },
    settings: settingsOf({}),
    deleteProgrammeCard: async () => {
      throw new Error('a reopen deletes no card');
    },
    log: { info: (fields, message) => lines.push([fields, message]) },
    clock: async () => REOPENED_AT,
    reopenStore,
  });
  const reopenTx = {} as Transaction;
  bindToTransaction(reopenTx, {
    afterCommit: (users: readonly string[], signal: unknown) => signals.push([users, signal]),
  } as unknown as LivePublisher);
  const reopen = () =>
    decisions.reopen(reopenTx, ADMIN, {
      enrollmentId: ENROLLMENT,
      reason: ADMIN_REASON,
      idempotencyKey: 'programme-reopen-0001',
    });
  const writes = () => calls.filter((call) => /^(write|event)/.test(call));
  return { calls, lines, signals, keyed, windows, reopen, writes };
}

/**
 * The 36 coming Thursdays 09:00–10:00 Cairo after the reopen (Thursday 2026-11-26 12:00 Cairo):
 * the first 2026-12-03 (UTC+2, 07:00Z), the last 2027-08-05 (Egypt's summer time, UTC+3, 06:00Z),
 * each resolved on its own date.
 */
const FIRST_WEEK = {
  startsAt: new Date('2026-12-03T07:00:00Z'),
  endsAt: new Date('2026-12-03T08:00:00Z'),
};
const LAST_WEEK_END = new Date('2027-08-05T07:00:00Z');

describe('programmes.reopen: the refusals the owner added (006:T017; Q-e2 (a), Q-e3 (b), Q-e6)', () => {
  it.each([
    [
      'still paused',
      { state: 'paused' as const, status: 'confirmed' as const, cancellationReason: null },
    ],
    ['closed by a lapse', { cancellationReason: 'offer_lapsed' as const }],
    ['closed by an administrator’s end', { cancellationReason: 'admin' as const }],
  ])('refuses not_stopped on a programme %s, writing nothing', async (_name, closing) => {
    const { reopen, writes } = reopenWorld({ closing });
    expect(await causeOf(reopen())).toBe('not_stopped');
    expect(writes()).toEqual([]);
  });

  it.each([
    ['deactivated', 'inactive' as const],
    ['removed', 'gone' as const],
  ])(
    'refuses slot_inactive with the weekly time %s since the stop, writing nothing',
    async (_name, slot) => {
      const { reopen, writes } = reopenWorld({ slot });
      expect(await causeOf(reopen())).toBe('slot_inactive');
      expect(writes()).toEqual([]);
    },
  );

  it('reads both parties’ busy times over the 36 coming weeks of the weekly time, each resolved on its own date', async () => {
    const { reopen, windows, calls } = reopenWorld();
    await reopen();
    expect(calls).toContain(`busy ${STUDENT},${TEACHER}`);
    expect(windows).toEqual([{ from: FIRST_WEEK.startsAt, to: LAST_WEEK_END }]);
  });

  it('refuses time_taken when another booking of a party overlaps one coming week, writing nothing', async () => {
    const { reopen, writes } = reopenWorld({
      busy: [
        { startsAt: new Date('2027-02-04T07:30:00Z'), endsAt: new Date('2027-02-04T08:30:00Z') },
      ],
    });
    expect(await causeOf(reopen())).toBe('time_taken');
    expect(writes()).toEqual([]);
  });

  it('reopens when a booking only touches a coming week (a range holds its start, not its end)', async () => {
    const { reopen, writes } = reopenWorld({
      busy: [{ startsAt: new Date('2026-12-03T06:00:00Z'), endsAt: FIRST_WEEK.startsAt }],
    });
    await expect(reopen()).resolves.toMatchObject({ answer: { state: 'paused' } });
    expect(writes()).toHaveLength(3);
  });
});

describe('programmes.reopen (006:T017, FR-725, R-513)', () => {
  it('reopens a stopped programme paused since the reopen’s instant, answering paused', async () => {
    const { reopen, writes } = reopenWorld();
    await expect(reopen()).resolves.toStrictEqual({
      answer: { state: 'paused' },
      replayed: false,
      enrollmentId: ENROLLMENT,
    });
    expect(writes()).toEqual([
      `write enrollment ${ENROLLMENT}`,
      `write programme ${ENROLLMENT} paused ${REOPENED_AT.toISOString()}`,
      `event ${ENROLLMENT} ${REOPENED_AT.toISOString()}`,
    ]);
  });

  it('takes the locks in kernel.md’s order, the slot’s before the programme’s, then reads under them', async () => {
    const { reopen, calls } = reopenWorld();
    await reopen();
    const [first, second] = [STUDENT, TEACHER].sort();
    expect(calls.slice(0, 7)).toEqual([
      'programme',
      `lock users ${first},${second}`,
      `lock teacher-slots ${TEACHER}`,
      `lock availability_slots ${SLOT}`,
      `lock programmes ${ENROLLMENT}`,
      `lock enrollments ${ENROLLMENT}`,
      'programme',
    ]);
  });

  it.each([
    ['the student suspended', { student: { accountStatus: 'suspended' as const } }],
    ['the student banned', { student: { accountStatus: 'banned' as const } }],
    ['the teacher suspended', { teacher: { accountStatus: 'suspended' as const } }],
    ['the teacher’s approval gone', { teacher: { teacherApproved: false } }],
  ])('refuses party_restricted with %s, writing nothing', async (_name, world) => {
    const { reopen, writes } = reopenWorld(world);
    expect(await causeOf(reopen())).toBe('party_restricted');
    expect(writes()).toEqual([]);
  });

  it.each([
    ['a female student with a male teacher', { student: { gender: 'female' as const } }],
    ['a male student with a female teacher', { teacher: { gender: 'female' as const } }],
  ])('refuses gender_mismatch for %s, writing nothing', async (_name, world) => {
    const { reopen, writes } = reopenWorld(world);
    expect(await causeOf(reopen())).toBe('gender_mismatch');
    expect(writes()).toEqual([]);
  });

  it('refuses slot_taken while another hold or enrollment uses the weekly time, writing nothing', async () => {
    const { reopen, writes, calls } = reopenWorld({ taken: true });
    expect(await causeOf(reopen())).toBe('slot_taken');
    expect(writes()).toEqual([]);
    expect(calls).toContain(`occupancy at ${REOPENED_AT.toISOString()}`);
  });

  it('is keyed on the call’s transaction (programmes.reopen, the administrator as actor); a replay writes nothing', async () => {
    const { reopen, keyed, writes } = reopenWorld({ replayed: true });
    await expect(reopen()).resolves.toMatchObject({ replayed: true, enrollmentId: ENROLLMENT });
    expect(keyed).toEqual([
      {
        scope: 'programmes.reopen',
        key: 'programme-reopen-0001',
        actorId: ADMIN,
        input: { enrollmentId: ENROLLMENT, reason: ADMIN_REASON },
      },
    ]);
    expect(writes()).toEqual([]);
  });

  it('logs one line of ids and a reason, never the administrator’s words, and signals both parties', async () => {
    const done = reopenWorld();
    await done.reopen();
    expect(done.lines).toEqual([
      [
        { adminId: ADMIN, enrollmentId: ENROLLMENT, reason: 'reopened' },
        'A programme was reopened',
      ],
    ]);
    expect(done.signals).toEqual([
      [[STUDENT, TEACHER], { type: 'enrollment', enrollmentId: ENROLLMENT }],
    ]);
    const taken = reopenWorld({ taken: true });
    await causeOf(taken.reopen());
    expect(taken.lines).toEqual([
      [
        { adminId: ADMIN, enrollmentId: ENROLLMENT, reason: 'slot_taken' },
        'A programme reopen was refused',
      ],
    ]);
    expect(taken.signals).toEqual([]);
    expect(JSON.stringify([...done.lines, ...taken.lines])).not.toContain(ADMIN_REASON);
  });
});
