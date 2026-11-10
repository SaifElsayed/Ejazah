// T033 — the one overlap check the hold and the booking sheet share (FR-351, FR-BOOK-5; PR #118's
// review, round 1, Minor 2; B29's conflict check, 2026-11-03): every one of the package's sessions on
// a slot, not its first alone, against the student's and the teacher's own sessions, read once over
// the window all of them span. Over the real tables, `tests/db-integrity/holds.spec.ts` (the third
// session overlapping) and `tests/db-integrity/booking-slots.spec.ts`.
import { type DayOfWeek, firstOccurrenceAfter } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SessionTime } from '../sessions/index.js';
import {
  busyBetween,
  freeOfPartiesSessions,
  overlapsAny,
  packageSessionsOn,
  type SessionParties,
  windowOfRuns,
} from './session-overlap.service.js';

const tx = {} as Transaction;
const CAIRO = 'Africa/Cairo';
const parties: SessionParties = {
  studentUserId: '0199d0a0-0000-7000-8000-0000000000e1',
  teacherUserId: '0199d0a0-0000-7000-8000-0000000000e2',
};
/** Tuesday 2026-11-03, 10:00 in Cairo. */
const TUESDAY = new Date('2026-11-03T08:00:00Z');
const thursday = {
  id: 'thursday',
  dayOfWeek: 4,
  startTimeLocal: '09:00:00',
  durationMinutes: 60,
  timezone: CAIRO,
};
const saturday = { ...thursday, id: 'saturday', dayOfWeek: 6, startTimeLocal: '10:00:00' };

const session = (startsAt: string, endsAt: string): SessionTime => ({
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
});

const runOf = (slot: typeof thursday, count = 4) =>
  packageSessionsOn(
    slot,
    firstOccurrenceAfter({ ...slot, dayOfWeek: slot.dayOfWeek as DayOfWeek }, TUESDAY, 24),
    count,
  );

describe('packageSessionsOn (R-209)', () => {
  it("is the package's count of consecutive weeks from the first, the first included", () => {
    expect(runOf(thursday).map((one) => one.requestedLocalDate)).toEqual([
      '2026-11-05',
      '2026-11-12',
      '2026-11-19',
      '2026-11-26',
    ]);
  });
});

describe('overlapsAny', () => {
  const run = runOf(thursday);

  it('finds a session overlapping the third occurrence, not only the first', () => {
    expect(overlapsAny(run, [session('2026-11-19T07:30:00Z', '2026-11-19T08:30:00Z')])).toBe(true);
  });

  it('keeps sessions that only touch an occurrence, end to start', () => {
    expect(
      overlapsAny(run, [
        session('2026-11-19T06:00:00Z', '2026-11-19T07:00:00Z'),
        session('2026-11-19T08:00:00Z', '2026-11-19T09:00:00Z'),
      ]),
    ).toBe(false);
  });
});

describe('windowOfRuns', () => {
  it('spans the earliest start to the latest end of every run', () => {
    const window = windowOfRuns([runOf(thursday), runOf(saturday, 2)]);
    expect(window.from.toISOString()).toBe('2026-11-05T07:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-11-26T08:00:00.000Z');
  });
});

describe('freeOfPartiesSessions (FR-351, FR-BOOK-5)', () => {
  it('reads both parties’ sessions once over the window and leaves out a candidate any of whose sessions overlaps one', async () => {
    const reads: unknown[] = [];
    const candidates = [
      { name: 'thursday', sessions: runOf(thursday) },
      { name: 'saturday', sessions: runOf(saturday) },
    ];
    const free = await freeOfPartiesSessions(
      tx,
      async (_tx, asked, window) => {
        reads.push([asked, window.from.toISOString(), window.to.toISOString()]);
        // The teacher's or the student's: the read answers both, as one list.
        return [session('2026-11-26T07:15:00Z', '2026-11-26T07:45:00Z')];
      },
      parties,
      candidates,
    );
    expect(free.map(({ name }) => name)).toEqual(['saturday']);
    expect(reads).toEqual([[parties, '2026-11-05T07:00:00.000Z', '2026-11-28T09:00:00.000Z']]);
  });

  it('reads nothing when there is no candidate', async () => {
    let read = false;
    const free = await freeOfPartiesSessions(
      tx,
      async () => {
        read = true;
        return [];
      },
      parties,
      [],
    );
    expect(free).toEqual([]);
    expect(read).toBe(false);
  });
});

describe('busyBetween (T027, FR-466, H3): the parties’ sessions and the times open remedies reserve', () => {
  it('answers both, reading the reservations of the two people over the same window', async () => {
    const asked: unknown[] = [];
    const window = { from: new Date('2026-12-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') };
    const read = busyBetween({
      sessionsBetween: async () => [session('2026-12-10T07:00:00Z', '2026-12-10T08:00:00Z')],
      reservedTimesOf: async (_tx, userIds, asking) => {
        asked.push([userIds, asking]);
        return [
          {
            remedyId: 'remedy',
            sessionId: 'session',
            ...session('2026-12-03T07:00:00Z', '2026-12-03T08:00:00Z'),
          },
        ];
      },
    });
    const times = await read(tx, parties, window);
    expect(times.map(({ startsAt }) => startsAt.toISOString())).toEqual([
      '2026-12-10T07:00:00.000Z',
      '2026-12-03T07:00:00.000Z',
    ]);
    expect(asked).toEqual([[[parties.studentUserId, parties.teacherUserId], window]]);
  });

  it('leaves out a candidate whose session falls on a reserved time, as the sheet and the hold read it', async () => {
    const first = firstOccurrenceAfter({ ...thursday, dayOfWeek: 4 as DayOfWeek }, TUESDAY, 24);
    const sessions = packageSessionsOn(thursday, first, 4);
    const third = sessions[2];
    const read = busyBetween({
      sessionsBetween: async () => [],
      reservedTimesOf: async () =>
        third === undefined
          ? []
          : [
              {
                remedyId: 'remedy',
                sessionId: 'session',
                ...session(third.startsAt, third.endsAt),
              },
            ],
    });
    expect(await freeOfPartiesSessions(tx, read, parties, [{ sessions }])).toEqual([]);
  });
});
