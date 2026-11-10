// T027 of specs/004-sessions/tasks.md (FR-466; research R-311, "Reservation"; R-320, H3; the notes
// under T027, Q7 (a)) — the times open remedies reserve, as `reservedTimesOf` answers them over a
// faked store: the system's proposal on its `proposed_date` at the enrollment's slot's local start
// in the enrollment's zone, for the session's length; a pending counter-proposal on its own date,
// start and zone during its answer window only (`answerClosesAt`, D1, at the database's clock, Q8);
// each time named by its remedy and its session; only the times overlapping the window asked about.
// Which statuses reserve (a `frozen` one does not) is the query's, shown on Postgres by
// `tests/db-integrity/remedy-reservations.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentTerms } from './enrollment-side.port.js';
import type { ReservingRemedyRow } from './reservations.repository.js';
import { reservedTimesOf, type ReservationStore } from './reservations.service.js';

const tx = {} as Transaction;
const CAIRO = 'Africa/Cairo';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const SLOT = '0199d0a0-0000-7000-8000-0000000000b1';
const COUNTER_SLOT = '0199d0a0-0000-7000-8000-0000000000b2';
const REMEDY = '0199d0a0-0000-7000-8000-0000000000c1';
const SESSION = '0199d0a0-0000-7000-8000-0000000000d1';

const TERMS: EnrollmentTerms = {
  id: ENROLLMENT,
  status: 'confirmed',
  slotId: SLOT,
  track: 'recitation',
  timezone: CAIRO,
  durationMinutes: 60,
  sessionCount: 4,
};

/** A whole year, so the window filters nothing unless a case narrows it. */
const YEAR = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') };

function row(values: Partial<ReservingRemedyRow> = {}): ReservingRemedyRow {
  return {
    remedyId: REMEDY,
    sessionId: SESSION,
    enrollmentId: ENROLLMENT,
    status: 'proposed',
    proposedDate: new Date('2026-12-03T00:00:00Z'),
    counter: null,
    snapshotAnswerWindowHours: 72,
    ...values,
  };
}

function storeOf(
  rows: readonly ReservingRemedyRow[],
  now = new Date('2026-11-20T10:00:00Z'),
): ReservationStore & { asked: string[][]; clockReads: number } {
  const store = {
    asked: [] as string[][],
    clockReads: 0,
    reservingRemediesOf: async (_tx: Transaction, userIds: readonly string[]) => {
      store.asked.push([...userIds]);
      return rows;
    },
    // The enrollment's slot, Thursday 09:00 Cairo.
    slotOf: async (_tx: Transaction, slotId: string) =>
      slotId === SLOT
        ? {
            id: SLOT,
            dayOfWeek: 4,
            startTimeLocal: '09:00:00',
            durationMinutes: 60,
            timezone: CAIRO,
            isActive: true,
            createdAt: new Date('2026-01-01T00:00:00Z'),
          }
        : null,
    clock: async () => {
      store.clockReads += 1;
      return now;
    },
  };
  return store;
}

const reads = {
  enrollmentFor: async (_tx: Transaction, id: string) => (id === ENROLLMENT ? TERMS : null),
};

const COUNTER = {
  slotId: COUNTER_SLOT,
  date: new Date('2026-12-06T00:00:00Z'),
  startTimeLocal: new Date('1970-01-01T18:30:00Z'),
  timezone: CAIRO,
  proposedAt: new Date('2026-11-19T10:00:00Z'),
};

describe('reservedTimesOf (T027, FR-466, H3, Q7 (a))', () => {
  it("answers a proposal at the enrollment's slot's local start in its zone, for the session's length, named by its remedy and session", async () => {
    const store = storeOf([row()]);
    const times = await reservedTimesOf(tx, [TEACHER, STUDENT], YEAR, reads, store);
    expect(times).toEqual([
      {
        remedyId: REMEDY,
        sessionId: SESSION,
        startsAt: new Date('2026-12-03T07:00:00Z'),
        endsAt: new Date('2026-12-03T08:00:00Z'),
      },
    ]);
    expect(store.asked).toEqual([[STUDENT, TEACHER].sort()]);
  });

  it('answers an awaiting_choice remedy’s proposal, which the refund sits beside', async () => {
    const times = await reservedTimesOf(
      tx,
      [STUDENT],
      YEAR,
      reads,
      storeOf([row({ status: 'awaiting_choice' })]),
    );
    expect(times.map(({ remedyId }) => remedyId)).toEqual([REMEDY]);
  });

  it('answers a pending counter-proposal beside the proposal while its answer window is open', async () => {
    const store = storeOf([row({ status: 'counter_proposed', counter: COUNTER })]);
    const times = await reservedTimesOf(tx, [STUDENT], YEAR, reads, store);
    expect(times).toEqual([
      {
        remedyId: REMEDY,
        sessionId: SESSION,
        startsAt: new Date('2026-12-03T07:00:00Z'),
        endsAt: new Date('2026-12-03T08:00:00Z'),
      },
      {
        remedyId: REMEDY,
        sessionId: SESSION,
        startsAt: new Date('2026-12-06T16:30:00Z'),
        endsAt: new Date('2026-12-06T17:30:00Z'),
      },
    ]);
    expect(store.clockReads).toBe(1);
  });

  it('frees the counter from the instant its answer window closes, by the database’s clock (D1, Q8)', async () => {
    const closes = new Date('2026-11-22T10:00:00Z');
    const before = await reservedTimesOf(
      tx,
      [STUDENT],
      YEAR,
      reads,
      storeOf(
        [row({ status: 'counter_proposed', counter: COUNTER })],
        new Date('2026-11-22T09:59:59.999Z'),
      ),
    );
    const at = await reservedTimesOf(
      tx,
      [STUDENT],
      YEAR,
      reads,
      storeOf([row({ status: 'counter_proposed', counter: COUNTER })], closes),
    );
    expect(before).toHaveLength(2);
    expect(at.map(({ startsAt }) => startsAt)).toEqual([new Date('2026-12-03T07:00:00Z')]);
  });

  it('reads no clock when no counter is pending', async () => {
    const store = storeOf([row()]);
    await reservedTimesOf(tx, [STUDENT], YEAR, reads, store);
    expect(store.clockReads).toBe(0);
  });

  it('answers only the times overlapping the window, a range holding its start and not its end', async () => {
    const store = storeOf([row()]);
    const touching = {
      from: new Date('2026-12-03T08:00:00Z'),
      to: new Date('2026-12-04T00:00:00Z'),
    };
    const inside = { from: new Date('2026-12-03T07:59:00Z'), to: new Date('2026-12-04T00:00:00Z') };
    expect(await reservedTimesOf(tx, [STUDENT], touching, reads, store)).toEqual([]);
    expect(await reservedTimesOf(tx, [STUDENT], inside, reads, store)).toHaveLength(1);
  });

  it("resolves the proposal on its own date across Cairo's April change, never by adding weeks (R-TIME-2)", async () => {
    // Cairo moves to summer time on the last Friday of April 2027 (the 30th): Thursday 04-29 09:00
    // is still UTC+2, Thursday 05-06 09:00 already UTC+3.
    const times = await reservedTimesOf(
      tx,
      [STUDENT],
      { from: new Date('2027-01-01T00:00:00Z'), to: new Date('2028-01-01T00:00:00Z') },
      reads,
      storeOf([
        row({ proposedDate: new Date('2027-04-29T00:00:00Z') }),
        row({ remedyId: SESSION, proposedDate: new Date('2027-05-06T00:00:00Z') }),
      ]),
    );
    expect(times.map(({ startsAt }) => startsAt)).toEqual([
      new Date('2027-04-29T07:00:00Z'),
      new Date('2027-05-06T06:00:00Z'),
    ]);
  });

  it('asks nothing for no person', async () => {
    const store = storeOf([row()]);
    expect(await reservedTimesOf(tx, [], YEAR, reads, store)).toEqual([]);
    expect(store.asked).toEqual([]);
  });
});
