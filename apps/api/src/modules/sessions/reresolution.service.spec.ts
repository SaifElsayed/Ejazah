// T048 — the re-resolution of scheduled sessions' cached instants (R-210, FR-370, ADR 0009 D2–D3,
// ERD §15 rule 19), over an in-memory store:
//
//   - a scheduled session's instants are recomputed from its stored local date, start and zone by
//     `packages/time`, the end being the start plus its enrollment's length; a session whose cache
//     already equals that is not written;
//   - every scheduled session is read, a page at a time, whatever its cached start says;
//   - a moved session that overlaps another session of its teacher or its student that the
//     constraints count is restored to its previous instants, and so is one a restoration makes
//     overlap, while every other moved session stays moved;
//   - a session no longer scheduled when it is written is left as it is.
//
// The same over the real tables, with the constraints deferred and the job around it, is
// `tests/db-integrity/reresolve-session-instants.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  type PartiedSession,
  type ReresolutionStore,
  reresolveScheduledSessions,
  type SessionInstants,
  type SessionSchedule,
} from './reresolution.service.js';

const TX = {} as Transaction;
const CAIRO = 'Africa/Cairo';
const PAGE = 2;

interface Row extends SessionSchedule {
  status: 'scheduled' | 'done' | 'cancelled_by_admin';
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}

/** One session row; by default a Sunday 09:00 Cairo session of 2026-11-08 cached correctly (07:00Z). */
function row(id: string, values: Partial<Row> = {}): Row {
  return {
    id,
    enrollmentId: `enrollment-${id}`,
    teacherUserId: `teacher-${id}`,
    studentUserId: `student-${id}`,
    scheduledDateLocal: '2026-11-08',
    scheduledStartTimeLocal: '09:00:00',
    timezone: CAIRO,
    scheduledStartAt: new Date('2026-11-08T07:00:00Z'),
    scheduledEndAt: new Date('2026-11-08T08:00:00Z'),
    status: 'scheduled',
    ...values,
  };
}

/** A store over `rows`, recording what was asked of it. */
function storeOver(rows: Row[], options: { readonly statusOnWrite?: Row['status'] } = {}) {
  const pages: (string | undefined)[] = [];
  const writes: SessionInstants[][] = [];
  const counted = (session: Row) => session.status !== 'cancelled_by_admin';
  const store: ReresolutionStore = {
    async scheduledAfter(_tx, after, limit) {
      pages.push(after);
      return rows
        .filter((session) => session.status === 'scheduled')
        .filter((session) => after === undefined || session.id > after)
        .toSorted((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit)
        .map((session) => ({ ...session }));
    },
    async setInstants(_tx, sessions) {
      writes.push([...sessions]);
      const written: string[] = [];
      for (const next of sessions) {
        const session = rows.find((candidate) => candidate.id === next.id);
        if (options.statusOnWrite !== undefined && session !== undefined) {
          session.status = options.statusOnWrite;
        }
        if (session?.status !== 'scheduled') continue;
        session.scheduledStartAt = next.scheduledStartAt;
        session.scheduledEndAt = next.scheduledEndAt;
        written.push(session.id);
      }
      return written;
    },
    async countedOverlapping(_tx, sessions) {
      return rows
        .filter(counted)
        .filter((other) =>
          sessions.some(
            (session: PartiedSession) =>
              other.id !== session.id &&
              (other.teacherUserId === session.teacherUserId ||
                other.studentUserId === session.studentUserId) &&
              other.scheduledStartAt < session.scheduledEndAt &&
              other.scheduledEndAt > session.scheduledStartAt,
          ),
        )
        .map((other) => ({ ...other }));
    },
  };
  return { store, pages, writes };
}

/** Each enrollment's length: sixty minutes unless named. */
function lengths(minutes: Readonly<Record<string, number>> = {}) {
  const asked: string[][] = [];
  return {
    asked,
    lengthsOf: async (_tx: Transaction, enrollmentIds: readonly string[]) => {
      asked.push([...enrollmentIds]);
      return new Map(enrollmentIds.map((id) => [id, minutes[id] ?? 60]));
    },
  };
}

const instantsOf = (session: Row) => [
  session.scheduledStartAt.toISOString(),
  session.scheduledEndAt.toISOString(),
];

describe('reresolveScheduledSessions: the cache recomputed from the schedule (ADR 0009 D2–D3)', () => {
  it('moves a session whose cache differs to its local fields’ instant, plus its enrollment’s length', async () => {
    // Cached as if Cairo were +03:00 that day: 06:00Z; the data says +02:00, so 07:00Z.
    const stale = row('a', {
      scheduledStartAt: new Date('2026-11-08T06:00:00Z'),
      scheduledEndAt: new Date('2026-11-08T07:00:00Z'),
    });
    const rows = [stale];
    const { store } = storeOver(rows);

    const outcome = await reresolveScheduledSessions(TX, {
      store,
      lengthsOf: lengths({ 'enrollment-a': 45 }).lengthsOf,
      pageSize: PAGE,
    });

    expect(outcome).toEqual({ moved: ['a'], restored: [] });
    expect(instantsOf(stale)).toEqual(['2026-11-08T07:00:00.000Z', '2026-11-08T07:45:00.000Z']);
  });

  it('resolves a gap week from what was asked: Friday 2027-04-30 00:30 lands at 01:30 (+03:00)', async () => {
    const gap = row('a', {
      scheduledDateLocal: '2027-04-30',
      scheduledStartTimeLocal: '00:30:00',
      scheduledStartAt: new Date('2027-04-29T21:30:00Z'),
      scheduledEndAt: new Date('2027-04-29T22:30:00Z'),
    });
    const { store } = storeOver([gap]);

    await reresolveScheduledSessions(TX, { store, lengthsOf: lengths().lengthsOf, pageSize: PAGE });

    expect(instantsOf(gap)).toEqual(['2027-04-29T22:30:00.000Z', '2027-04-29T23:30:00.000Z']);
  });

  it('writes nothing when every cache already equals its resolution', async () => {
    const { store, writes } = storeOver([row('a'), row('b'), row('c')]);

    const outcome = await reresolveScheduledSessions(TX, {
      store,
      lengthsOf: lengths().lengthsOf,
      pageSize: PAGE,
    });

    expect(outcome).toEqual({ moved: [], restored: [] });
    expect(writes).toEqual([]);
  });

  it('reads every scheduled session a page at a time, after the last id read, whatever its cache says', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      row(id, {
        // Every cache an hour early, the past and the future alike (ADR 0009 D3).
        scheduledStartAt: new Date('2026-11-08T06:00:00Z'),
        scheduledEndAt: new Date('2026-11-08T07:00:00Z'),
        teacherUserId: `teacher-${id}`,
      }),
    );
    const { store, pages } = storeOver(rows);
    const { asked, lengthsOf } = lengths();

    const outcome = await reresolveScheduledSessions(TX, { store, lengthsOf, pageSize: PAGE });

    expect(pages).toEqual([undefined, 'b', 'd']);
    expect(asked).toEqual([
      ['enrollment-a', 'enrollment-b'],
      ['enrollment-c', 'enrollment-d'],
      ['enrollment-e'],
    ]);
    expect(outcome.moved).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('leaves a session that is no longer scheduled when it is written', async () => {
    const stale = row('a', {
      scheduledStartAt: new Date('2026-11-08T06:00:00Z'),
      scheduledEndAt: new Date('2026-11-08T07:00:00Z'),
    });
    const { store } = storeOver([stale], { statusOnWrite: 'done' });

    const outcome = await reresolveScheduledSessions(TX, {
      store,
      lengthsOf: lengths().lengthsOf,
      pageSize: PAGE,
    });

    expect(outcome).toEqual({ moved: [], restored: [] });
    expect(instantsOf(stale)).toEqual(['2026-11-08T06:00:00.000Z', '2026-11-08T07:00:00.000Z']);
  });
});

describe('reresolveScheduledSessions: a moved session that would overlap is restored (rule 19)', () => {
  /** The teacher's other session, Sunday 2026-11-08 09:30–10:30 in Cairo, counted and unmoved. */
  const neighbour = (status: Row['status'] = 'done') =>
    row('n', {
      teacherUserId: 'teacher-shared',
      scheduledStartTimeLocal: '09:30:00',
      scheduledStartAt: new Date('2026-11-08T07:30:00Z'),
      scheduledEndAt: new Date('2026-11-08T08:30:00Z'),
      status,
    });

  /** A session cached at 06:00Z (one hour early) whose resolution, 07:00Z, meets the neighbour. */
  const movedIntoNeighbour = () =>
    row('a', {
      teacherUserId: 'teacher-shared',
      scheduledStartAt: new Date('2026-11-08T06:00:00Z'),
      scheduledEndAt: new Date('2026-11-08T07:00:00Z'),
    });

  /** Another of the run's sessions, of other parties, moved too. */
  const elsewhere = () =>
    row('b', {
      scheduledStartAt: new Date('2026-11-08T06:00:00Z'),
      scheduledEndAt: new Date('2026-11-08T07:00:00Z'),
    });

  it('restores the overlapping one to its previous instants while the rest stays moved', async () => {
    const moved = movedIntoNeighbour();
    const other = elsewhere();
    const { store } = storeOver([moved, other, neighbour()]);

    const outcome = await reresolveScheduledSessions(TX, {
      store,
      lengthsOf: lengths().lengthsOf,
      pageSize: PAGE,
    });

    expect(outcome).toEqual({ moved: ['b'], restored: ['a'] });
    expect(instantsOf(moved)).toEqual(['2026-11-08T06:00:00.000Z', '2026-11-08T07:00:00.000Z']);
    expect(instantsOf(other)).toEqual(['2026-11-08T07:00:00.000Z', '2026-11-08T08:00:00.000Z']);
  });

  it('counts the other session as the constraints do: a cancelled one frees its time', async () => {
    const moved = movedIntoNeighbour();
    const { store } = storeOver([moved, neighbour('cancelled_by_admin')]);

    const outcome = await reresolveScheduledSessions(TX, {
      store,
      lengthsOf: lengths().lengthsOf,
      pageSize: PAGE,
    });

    expect(outcome).toEqual({ moved: ['a'], restored: [] });
  });

  it('keeps back-to-back sessions that move together moved, restoring only the one that meets another', async () => {
    // The student's two sessions an hour early, back to back: both move by an hour together and stay
    // back to back. The teacher of the first also has `n` at 09:30, so the first is restored to
    // 06:00–07:00Z; the second, moved to 08:00–09:00Z, meets nothing and stays.
    const first = row('a', {
      teacherUserId: 'teacher-shared',
      studentUserId: 'student-shared',
      scheduledStartAt: new Date('2026-11-08T06:00:00Z'),
      scheduledEndAt: new Date('2026-11-08T07:00:00Z'),
    });
    const second = row('b', {
      studentUserId: 'student-shared',
      scheduledStartTimeLocal: '10:00:00',
      scheduledStartAt: new Date('2026-11-08T07:00:00Z'),
      scheduledEndAt: new Date('2026-11-08T08:00:00Z'),
    });
    const { store } = storeOver([first, second, neighbour()]);

    const outcome = await reresolveScheduledSessions(TX, {
      store,
      lengthsOf: lengths().lengthsOf,
      pageSize: PAGE,
    });

    expect(outcome).toEqual({ moved: ['b'], restored: ['a'] });
    expect(instantsOf(second)).toEqual(['2026-11-08T08:00:00.000Z', '2026-11-08T09:00:00.000Z']);
  });

  it('restores a moved session that meets a restored one, until none meets another', async () => {
    // `a` meets the neighbour once moved (07:00–08:00Z) and is restored to 06:00–07:00Z; `b`, of `a`'s
    // student, is cached 05:00–06:00Z and resolves to 06:00–07:00Z (08:00 local): back to back with
    // `a` moved, it meets `a` restored, so it is restored too.
    const first = movedIntoNeighbour();
    const mate = row('b', {
      studentUserId: first.studentUserId,
      scheduledStartTimeLocal: '08:00:00',
      scheduledStartAt: new Date('2026-11-08T05:00:00Z'),
      scheduledEndAt: new Date('2026-11-08T06:00:00Z'),
    });
    const { store } = storeOver([first, mate, neighbour()]);

    const outcome = await reresolveScheduledSessions(TX, {
      store,
      lengthsOf: lengths().lengthsOf,
      pageSize: PAGE,
    });

    expect(outcome).toEqual({ moved: [], restored: ['a', 'b'] });
    expect(instantsOf(mate)).toEqual(['2026-11-08T05:00:00.000Z', '2026-11-08T06:00:00.000Z']);
  });
});
