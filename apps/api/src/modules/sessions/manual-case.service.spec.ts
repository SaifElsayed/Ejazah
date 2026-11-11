// T064 of specs/004-sessions/tasks.md (FR-471 (c), FR-493; SRS FR-ADMIN-20 (c); research R-326;
// contracts/admin-surface.md, `cases.openManual`; contracts/kernel.md, the two manual-case rows; the
// notes under T064) — `createManualCase` over recorded stores, the kernel's `IdempotencyService`
// over an in-memory key store, and T030's real `createRemedyCase` over a recorded store:
//
//   - with no remedy, on an enrollment in each state, for each party: the key claimed first, then
//     the enrollment's lock (`lockCasesOf`'s row, through `EnrollmentSide.lockEnrollments`), the
//     enrollment read again under it, then moderation's `openCompensationCase` with
//     `admin_opened_for_student` or `admin_opened_for_teacher`; a second opening joins (`joined`);
//   - with `remedyId`: the remedy read with no lock and refused `NOT_FOUND` when it is none or of
//     another enrollment, before any lock (the note under T064, F6); then T030's `handOff` with
//     `admin_opened_for_student`, from each of the four open statuses, `frozen` included, its `kind`
//     left as it is, both reserved times released by `handOver` (its counter columns cleared;
//     `tests/db-integrity/manual-case.spec.ts` reads them over the real tables);
//   - each refusal writes nothing and one info line of ids and its cause, marked «logged»;
//   - keyed through `runOn` on the caller's transaction (the note under T064, Q1 (a)): a repeated key
//     answers the first result, `replayed`, and writes nothing; the same key with another input is
//     `CONFLICT`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import {
  type IdempotencyStore,
  IdempotencyService,
  KeyTakenError,
  type NewKey,
  type StoredKey,
} from '../../platform/idempotency/idempotency.service.js';
import type { CompensationReason } from '../moderation/index.js';
import type { RemedyStatus } from './completion.repository.js';
import type { EnrollmentStatus, EnrollmentTerms } from './enrollment-side.port.js';
import { createManualCase, type ManualCaseInput } from './manual-case.service.js';
import type { RemedyToHandOff } from './remedy-case.repository.js';
import { createRemedyCase, type RemedyCaseStore } from './remedy-case.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const OTHER_ADMIN = '0199d0a0-0000-7000-8000-0000000000a2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000800';
const OTHER_ENROLLMENT = '0199d0a0-0000-7000-8000-000000000801';
const STUDENT = '0199d0a0-0000-7000-8000-000000000901';
const TEACHER = '0199d0a0-0000-7000-8000-000000000902';
const SESSION = '0199d0a0-0000-7000-8000-000000000600';
const REMEDY = '0199d0a0-0000-7000-8000-000000000700';
const CASE = '0199d0a0-0000-7000-8000-000000000500';
const KEY = 'manual-case-attempt-0001';
const OTHER_KEY = 'manual-case-attempt-0002';
const DECIDED_AT = new Date('2026-11-11T09:00:00.123Z');
const REASON = 'شكوى الطالب عبر الهاتف';

const STATES: readonly EnrollmentStatus[] = [
  'pending_payment',
  'confirmed',
  'completed',
  'terminated_no_show',
  'cancelled',
];
const OPEN: readonly RemedyStatus[] = ['awaiting_choice', 'proposed', 'counter_proposed', 'frozen'];
const NOT_OPEN: readonly RemedyStatus[] = ['booked', 'refund_case', 'lapsed'];

function terms(status: EnrollmentStatus): EnrollmentTerms {
  return {
    id: ENROLLMENT,
    status,
    slotId: '0199d0a0-0000-7000-8000-000000000300',
    track: 'recitation',
    timezone: 'Africa/Cairo',
    durationMinutes: 60,
    sessionCount: 4,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
  };
}

function remedyRow(status: RemedyStatus, enrollmentId = ENROLLMENT): RemedyToHandOff {
  return {
    id: REMEDY,
    sessionId: SESSION,
    enrollmentId,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status,
    kind: 'makeup',
  };
}

/** The kernel's key store in memory: a claim is kept at once, as a committed call's would be. */
class KeyStore implements IdempotencyStore<Transaction> {
  readonly keys = new Map<string, StoredKey>();
  #ids = 0;

  async transaction<T>(work: (inner: Transaction) => Promise<T>): Promise<T> {
    return work(tx);
  }

  async find(_tx: Transaction, scope: string, actorId: string, key: string) {
    return this.keys.get(`${scope}|${actorId}|${key}`) ?? null;
  }

  async claim(_tx: Transaction, row: NewKey): Promise<string> {
    const name = `${row.scope}|${row.actorId}|${row.key}`;
    if (this.keys.has(name)) throw new KeyTakenError();
    this.#ids += 1;
    const id = `key-${this.#ids}`;
    this.keys.set(name, { ...row, id, status: 'in_progress', response: null });
    return id;
  }

  async claimUnlessTaken(inner: Transaction, row: NewKey): Promise<string | null> {
    try {
      return await this.claim(inner, row);
    } catch (error: unknown) {
      if (error instanceof KeyTakenError) return null;
      throw error;
    }
  }

  async complete(_tx: Transaction, id: string, response: unknown): Promise<void> {
    for (const [name, row] of this.keys) {
      if (row.id === id) this.keys.set(name, { ...row, status: 'completed', response });
    }
  }

  async remove(_tx: Transaction, id: string): Promise<void> {
    for (const [name, row] of this.keys) if (row.id === id) this.keys.delete(name);
  }

  async removeExpired(): Promise<number> {
    return 0;
  }
}

interface World {
  enrollment: EnrollmentStatus | null;
  remedy: RemedyToHandOff | null;
  /** Whether the enrollment's case of the reason is already open (a join). */
  caseOpen?: boolean;
}

function harness(world: World) {
  const calls: string[] = [];
  const lines: Record<string, unknown>[] = [];
  const log = { info: (fields: Record<string, unknown>) => void lines.push(fields) };
  const keys = new KeyStore();
  const idempotency = new IdempotencyService<Transaction>({
    store: {
      transaction: keys.transaction.bind(keys),
      find: keys.find.bind(keys),
      claim: keys.claim.bind(keys),
      claimUnlessTaken: async (inner, row) => {
        calls.push('claim key');
        return keys.claimUnlessTaken(inner, row);
      },
      complete: keys.complete.bind(keys),
      remove: keys.remove.bind(keys),
      removeExpired: keys.removeExpired.bind(keys),
    },
    settings: { read: async (_key, schema) => schema.parse(24) },
    clock: () => new Date('2026-11-11T08:00:00Z'),
  });
  const openCase = async (_tx: Transaction, enrollmentId: string, reason: CompensationReason) => {
    calls.push(`open case ${reason} on ${enrollmentId === ENROLLMENT ? 'enrollment' : 'other'}`);
    return { caseId: CASE, opened: world.caseOpen !== true };
  };
  const remedyStore: RemedyCaseStore = {
    remedyToHandOff: async () => {
      calls.push('read remedy');
      return world.remedy;
    },
    lockAccounts: async (_tx, ids) => void calls.push(`lock users ${ids.join(',')}`),
    lockTeacherSlots: async () => void calls.push('lock teacher-slots'),
    lockEnrollments: async () => void calls.push('lock enrollments'),
    lockSessions: async () => void calls.push('lock sessions'),
    lockRemedies: async () => void calls.push('lock session_remedies'),
    openCase,
    handOver: async (_tx, remedyId, from, write) => {
      calls.push(`hand over ${remedyId === REMEDY ? 'remedy' : 'other'} from ${from.join('|')}`);
      expect(write).toEqual({ caseId: CASE, decidedAt: DECIDED_AT });
      return world.remedy !== null && from.includes(world.remedy.status);
    },
    recordEvents: async (_tx, events) => {
      for (const event of events) calls.push(`event ${event.kind}`);
      expect(events).toEqual([
        {
          enrollmentId: ENROLLMENT,
          sessionId: SESSION,
          kind: 'remedy_handed_to_case',
          occurredAt: DECIDED_AT,
        },
      ]);
    },
  };
  const manualCase = createManualCase({
    enrollments: {
      enrollmentFor: async (_tx, id) => {
        calls.push('read enrollment');
        return world.enrollment === null || id !== ENROLLMENT ? null : terms(world.enrollment);
      },
      lockEnrollments: async (_tx, ids) => void calls.push(`lock enrollments ${ids.join(',')}`),
    },
    idempotency,
    log,
    store: {
      remedyToHandOff: remedyStore.remedyToHandOff,
      openCase,
    },
    remedyCase: createRemedyCase({ log, clock: async () => DECIDED_AT, store: remedyStore }),
  });
  return { manualCase, calls, lines, keys };
}

function input(overrides: Partial<ManualCaseInput> = {}): ManualCaseInput {
  return {
    enrollmentId: ENROLLMENT,
    party: 'student',
    reason: REASON,
    idempotencyKey: KEY,
    ...overrides,
  };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown;
}

/** The writes a call made: a case opened, a remedy handed over, an event. */
const writesOf = (calls: readonly string[]) =>
  calls.filter((call) => /^(open case|hand over|event)/.test(call));

describe('cases.openManual with no remedy (FR-493, R-326)', () => {
  const combinations = STATES.flatMap((state) =>
    (['student', 'teacher'] as const).map((party) => [state, party] as const),
  );

  it.each(combinations)(
    'on a %s enrollment for the %s: the key, the lock, the enrollment again, then the case',
    async (state, party) => {
      const { manualCase, calls, lines } = harness({ enrollment: state, remedy: null });
      const { answer, replayed } = await manualCase.openManual(tx, ADMIN, input({ party }));
      expect(replayed).toBe(false);
      expect(answer).toEqual({
        caseId: CASE,
        enrollmentId: ENROLLMENT,
        party,
        status: 'open',
        joined: false,
      });
      expect(calls).toEqual([
        'claim key',
        `lock enrollments ${ENROLLMENT}`,
        'read enrollment',
        `open case admin_opened_for_${party} on enrollment`,
      ]);
      expect(lines).toEqual([]);
    },
  );

  it('joins the open case of the same party: joined, no row written by the opening', async () => {
    const { manualCase } = harness({ enrollment: 'confirmed', remedy: null, caseOpen: true });
    const { answer } = await manualCase.openManual(tx, ADMIN, input({ party: 'teacher' }));
    expect(answer).toMatchObject({ caseId: CASE, party: 'teacher', joined: true });
    expect(answer).not.toHaveProperty('handedRemedy');
  });

  it('refuses an enrollment that does not exist NOT_FOUND, read under its lock, writing nothing', async () => {
    const { manualCase, calls, lines } = harness({ enrollment: null, remedy: null });
    const refused = await refusalOf(manualCase.openManual(tx, ADMIN, input()));
    expect(refused.code).toBe('NOT_FOUND');
    expect(isRefusalLogged(refused)).toBe(true);
    expect(writesOf(calls)).toEqual([]);
    expect(calls).toEqual(['claim key', `lock enrollments ${ENROLLMENT}`, 'read enrollment']);
    expect(lines).toEqual([
      {
        adminId: ADMIN,
        enrollmentId: ENROLLMENT,
        errorCode: 'NOT_FOUND',
        reason: 'no_enrollment',
      },
    ]);
  });
});

describe('cases.openManual with remedyId: the remedy handed to the student’s manual case (GAP-5)', () => {
  it.each(OPEN)(
    'hands a %s remedy over in T030’s order, kind unchanged, both times released',
    async (status) => {
      const { manualCase, calls, lines } = harness({
        enrollment: 'confirmed',
        remedy: remedyRow(status),
      });
      const { answer, replayed } = await manualCase.openManual(
        tx,
        ADMIN,
        input({ remedyId: REMEDY }),
      );
      expect(replayed).toBe(false);
      expect(answer).toEqual({
        caseId: CASE,
        enrollmentId: ENROLLMENT,
        party: 'student',
        status: 'open',
        joined: false,
        handedRemedy: { remedyId: REMEDY, sessionId: SESSION },
      });
      expect(calls).toEqual([
        'claim key',
        'read enrollment',
        'read remedy',
        // T030's hand-off: the remedy read again, then the one order (kernel.md's second row).
        'read remedy',
        `lock users ${[STUDENT, TEACHER].sort().join(',')}`,
        'lock teacher-slots',
        'lock enrollments',
        'lock sessions',
        'lock session_remedies',
        'read remedy',
        'open case admin_opened_for_student on enrollment',
        // The four open statuses; `handOver` clears the counter's columns (H3, rule 42).
        'hand over remedy from awaiting_choice|proposed|counter_proposed|frozen',
        'event remedy_handed_to_case',
      ]);
      expect(lines).toEqual([]);
    },
  );

  it('joins the student’s open manual case', async () => {
    const { manualCase } = harness({
      enrollment: 'confirmed',
      remedy: remedyRow('frozen'),
      caseOpen: true,
    });
    const { answer } = await manualCase.openManual(tx, ADMIN, input({ remedyId: REMEDY }));
    expect(answer).toMatchObject({ joined: true, handedRemedy: { remedyId: REMEDY } });
  });

  it.each([
    ['no such remedy', null, 'no_remedy'],
    [
      'a remedy of another enrollment',
      remedyRow('awaiting_choice', OTHER_ENROLLMENT),
      'not_of_enrollment',
    ],
  ] as const)(
    'refuses %s NOT_FOUND before any lock, writing nothing',
    async (_name, remedy, cause) => {
      const { manualCase, calls, lines } = harness({ enrollment: 'confirmed', remedy });
      const refused = await refusalOf(
        manualCase.openManual(tx, ADMIN, input({ remedyId: REMEDY })),
      );
      expect(refused.code).toBe('NOT_FOUND');
      expect(isRefusalLogged(refused)).toBe(true);
      expect(calls).toEqual(['claim key', 'read enrollment', 'read remedy']);
      expect(lines).toEqual([
        {
          adminId: ADMIN,
          enrollmentId: ENROLLMENT,
          remedyId: REMEDY,
          errorCode: 'NOT_FOUND',
          reason: cause,
        },
      ]);
    },
  );

  it('refuses an enrollment that does not exist NOT_FOUND before the remedy is read', async () => {
    const { manualCase, calls } = harness({ enrollment: null, remedy: remedyRow('proposed') });
    const refused = await refusalOf(manualCase.openManual(tx, ADMIN, input({ remedyId: REMEDY })));
    expect(refused.code).toBe('NOT_FOUND');
    expect(calls).toEqual(['claim key', 'read enrollment']);
  });

  it.each(NOT_OPEN)(
    'refuses a %s remedy REMEDY_NOT_OPEN, writing nothing, logged once',
    async (status) => {
      const { manualCase, calls, lines } = harness({
        enrollment: 'confirmed',
        remedy: remedyRow(status),
      });
      const refused = await refusalOf(
        manualCase.openManual(tx, ADMIN, input({ remedyId: REMEDY })),
      );
      expect(refused.code).toBe('REMEDY_NOT_OPEN');
      expect(isRefusalLogged(refused)).toBe(true);
      expect(writesOf(calls)).toEqual([]);
      // T030's one line, naming the manual reason.
      expect(lines).toEqual([
        expect.objectContaining({
          remedyId: REMEDY,
          enrollmentId: ENROLLMENT,
          caseReason: 'admin_opened_for_student',
          errorCode: 'REMEDY_NOT_OPEN',
          reason: 'not_open',
        }),
      ]);
    },
  );
});

describe('cases.openManual is keyed on the call’s transaction (ADR 0008; the note under T064, Q1 (a))', () => {
  it('answers a repeated key the first result, replayed, writing nothing', async () => {
    const { manualCase, calls } = harness({
      enrollment: 'confirmed',
      remedy: remedyRow('proposed'),
    });
    const first = await manualCase.openManual(tx, ADMIN, input({ remedyId: REMEDY }));
    const before = calls.length;
    const again = await manualCase.openManual(tx, ADMIN, input({ remedyId: REMEDY }));
    expect(again).toEqual({ answer: first.answer, replayed: true });
    expect(calls.slice(before)).toEqual([]);
  });

  it('keys by the administrator: another administrator’s same key is a call of its own', async () => {
    const { manualCase, calls } = harness({ enrollment: 'confirmed', remedy: null });
    await manualCase.openManual(tx, ADMIN, input());
    const other = await manualCase.openManual(tx, OTHER_ADMIN, input());
    expect(other.replayed).toBe(false);
    expect(writesOf(calls)).toHaveLength(2);
  });

  it('refuses the same key with another input CONFLICT, writing nothing', async () => {
    const { manualCase, calls } = harness({ enrollment: 'confirmed', remedy: null });
    await manualCase.openManual(tx, ADMIN, input());
    const before = calls.length;
    const refused = await refusalOf(manualCase.openManual(tx, ADMIN, input({ reason: 'سبب آخر' })));
    expect(refused.code).toBe('CONFLICT');
    expect(calls.slice(before)).toEqual([]);
  });

  it('keys the input without its key: a new key is a new call', async () => {
    const { manualCase, keys } = harness({ enrollment: 'confirmed', remedy: null });
    await manualCase.openManual(tx, ADMIN, input());
    await manualCase.openManual(tx, ADMIN, input({ idempotencyKey: OTHER_KEY }));
    expect([...keys.keys.values()].map(({ scope, actorId }) => [scope, actorId])).toEqual([
      ['cases.openManual', ADMIN],
      ['cases.openManual', ADMIN],
    ]);
  });
});
