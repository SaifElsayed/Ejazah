// T016 of specs/004-sessions/tasks.md (FR-445, R-307; contracts/kernel.md, "outage record") —
// `createOutageServices` over a recorded store: the window resolved from wall clocks in its zone,
// the overlapped sessions found with no lock, then their enrollments locked in one call, then the
// sessions in one call, each in id order, read again under the locks, reclassified with one
// `outage_reclassified` event each, then T015's completion check per enrollment; the scheduled
// sessions the window overlaps that have ended are locked with them and read again, so a sweep
// settling one is waited on (PR #129's review, Minor 1; the race itself:
// `tests/db-integrity/outage-evaluation-race.spec.ts`); a zone the time package refuses, or an end not after the start, refused `VALIDATION_FAILED` with one log line
// and nothing read or written. Over the real tables: `tests/db-integrity/outages.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { OverlappedSession } from './outages.repository.js';
import { createOutageServices, type OutageStore } from './outages.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-08T10:00:00Z');

const INPUT = {
  start: { localDate: '2026-11-06', localTime: '10:00' },
  end: { localDate: '2026-11-06', localTime: '11:30' },
  timezone: 'Africa/Cairo',
  reason: 'انقطاع',
};

const settings: SettingsReader = {
  read: async (key, schema) =>
    schema.parse(({ dispute_window_hours: 72, admin_list_page_size: 2 } as Record<string, number>)[key]),
};

function world(
  found: readonly OverlappedSession[],
  again: readonly OverlappedSession[] = found,
  ended: readonly OverlappedSession[] = [],
) {
  const journal: string[] = [];
  const logged: unknown[][] = [];
  let reads = 0;
  const store: OutageStore = {
    reclassifiableSessions: async (_tx, window, endedAfter, ids) => {
      expect(window).toEqual({
        startsAt: new Date('2026-11-06T08:00:00Z'),
        endsAt: new Date('2026-11-06T09:30:00Z'),
      });
      expect(endedAfter).toEqual(new Date('2026-11-05T10:00:00Z'));
      reads += 1;
      journal.push(ids === undefined ? 'find' : `read again ${ids.join(',')}`);
      return reads === 1 ? found : again;
    },
    endedScheduledSessions: async (_tx, window, endedBy) => {
      expect(window).toEqual({
        startsAt: new Date('2026-11-06T08:00:00Z'),
        endsAt: new Date('2026-11-06T09:30:00Z'),
      });
      expect(endedBy).toEqual(AT);
      journal.push('find ended scheduled');
      return ended;
    },
    lockSessions: async (_tx, ids) => {
      journal.push(`lock sessions ${ids.join(',')}`);
    },
    reclassify: async (_tx, ids) => {
      journal.push(`reclassify ${ids.join(',')}`);
    },
    insertOutage: async (_tx, outage) => {
      expect(outage.recordedByAdminId).toBe(ADMIN);
      journal.push('insert outage');
      return id(99);
    },
    recordEvents: async (_tx, events) => {
      journal.push(
        `events ${events.map((event) => `${event.kind}:${event.sessionId ?? ''}`).join(',')}`,
      );
    },
    outagesPage: async (_tx, cursor, take) => {
      journal.push(`page ${cursor ?? '-'} ${String(take)}`);
      return [1, 2, 3].map((n) => ({
        outageId: id(n),
        startsAt: new Date('2026-11-06T08:00:00Z'),
        endsAt: new Date('2026-11-06T09:30:00Z'),
        reason: 'سبب',
        recordedByAdminId: ADMIN,
      }));
    },
  };
  const services = createOutageServices({
    enrollments: {
      lockEnrollments: async (_tx, ids) => {
        journal.push(`lock enrollments ${ids.join(',')}`);
      },
    },
    completion: {
      completeIfDue: async (_tx, enrollmentId) => {
        journal.push(`complete? ${enrollmentId}`);
        return false;
      },
    },
    settings,
    log: {
      info: (...args: unknown[]) => {
        logged.push(args);
      },
    } as unknown as Parameters<typeof createOutageServices>[0]['log'],
    adminNames: async (_tx, ids) => new Map(ids.map((one) => [one, 'المشرف'])),
    clock: async () => AT,
    store,
  });
  return { services, journal, logged };
}

describe('outages.record (T016, FR-445, R-307)', () => {
  it('locks the enrollments, then the sessions, reads them again, reclassifies with one event each, then checks completion', async () => {
    const { services, journal, logged } = world(
      [
        { id: id(12), enrollmentId: id(2) },
        { id: id(11), enrollmentId: id(1) },
        { id: id(13), enrollmentId: id(1) },
      ],
      [
        { id: id(11), enrollmentId: id(1) },
        { id: id(12), enrollmentId: id(2) },
      ],
    );
    expect(await services.record(tx, ADMIN, INPUT)).toEqual({
      outageId: id(99),
      startsAt: '2026-11-06T08:00:00.000Z',
      endsAt: '2026-11-06T09:30:00.000Z',
      reclassified: 2,
    });
    expect(journal).toEqual([
      'find',
      'find ended scheduled',
      `lock enrollments ${id(1)},${id(2)}`,
      `lock sessions ${id(11)},${id(12)},${id(13)}`,
      `read again ${id(11)},${id(12)},${id(13)}`,
      'insert outage',
      `reclassify ${id(11)},${id(12)}`,
      `events outage_reclassified:${id(11)},outage_reclassified:${id(12)}`,
      `complete? ${id(1)}`,
      `complete? ${id(2)}`,
    ]);
    expect(logged).toEqual([
      [
        { outageId: id(99), sessionIds: [id(11), id(12)] },
        'Outage window recorded and its sessions reclassified',
      ],
    ]);
  });

  it('records a window over no settled and no ended scheduled session, locking nothing', async () => {
    const { services, journal } = world([]);
    expect((await services.record(tx, ADMIN, INPUT)).reclassified).toBe(0);
    expect(journal).toEqual(['find', 'find ended scheduled', 'insert outage']);
  });

  it('locks the ended scheduled sessions with the settled ones, in one call each, reads them all again, and moves those settled meanwhile', async () => {
    const { services, journal } = world(
      [{ id: id(13), enrollmentId: id(3) }],
      // Under the locks: 11 settled by a sweep that committed first; 12 still scheduled.
      [
        { id: id(11), enrollmentId: id(1) },
        { id: id(13), enrollmentId: id(3) },
      ],
      [
        { id: id(12), enrollmentId: id(2) },
        { id: id(11), enrollmentId: id(1) },
      ],
    );
    expect((await services.record(tx, ADMIN, INPUT)).reclassified).toBe(2);
    expect(journal).toEqual([
      'find',
      'find ended scheduled',
      `lock enrollments ${id(1)},${id(2)},${id(3)}`,
      `lock sessions ${id(11)},${id(12)},${id(13)}`,
      `read again ${id(11)},${id(12)},${id(13)}`,
      'insert outage',
      `reclassify ${id(11)},${id(13)}`,
      `events outage_reclassified:${id(11)},outage_reclassified:${id(13)}`,
      `complete? ${id(1)}`,
      `complete? ${id(3)}`,
    ]);
  });

  it('locks an ended scheduled session alone and leaves it scheduled when no sweep settled it', async () => {
    const { services, journal } = world([], [], [{ id: id(12), enrollmentId: id(2) }]);
    expect((await services.record(tx, ADMIN, INPUT)).reclassified).toBe(0);
    expect(journal).toEqual([
      'find',
      'find ended scheduled',
      `lock enrollments ${id(2)}`,
      `lock sessions ${id(12)}`,
      `read again ${id(12)}`,
      'insert outage',
    ]);
  });

  it.each([
    ['an end at its start', { ...INPUT, end: INPUT.start }, 'end_not_after_start', 'end'],
    [
      'an end before its start',
      { ...INPUT, end: { localDate: '2026-11-05', localTime: '23:00' } },
      'end_not_after_start',
      'end',
    ],
    ['a zone the time package refuses', { ...INPUT, timezone: 'Mars/Olympus' }, 'unknown_zone', 'timezone'],
  ])('refuses %s VALIDATION_FAILED with one log line, nothing read or written', async (_name, input, reason, path) => {
    const { services, journal, logged } = world([{ id: id(11), enrollmentId: id(1) }]);
    await expect(services.record(tx, ADMIN, input)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path }],
    });
    expect(journal).toEqual([]);
    expect(logged).toEqual([[{ adminId: ADMIN, reason }, 'Outage window refused']]);
  });
});

describe('outages.list (T016)', () => {
  it('answers a page of admin_list_page_size, newest first, each with its recorder, and the cursor while more follow', async () => {
    const { services, journal } = world([]);
    const page = await services.list(tx, { cursor: id(50) });
    expect(journal).toEqual([`page ${id(50)} 3`]);
    expect(page.items.map(({ outageId }) => outageId)).toEqual([id(1), id(2)]);
    expect(page.items[0]).toEqual({
      outageId: id(1),
      startsAt: '2026-11-06T08:00:00.000Z',
      endsAt: '2026-11-06T09:30:00.000Z',
      reason: 'سبب',
      recordedBy: { adminId: ADMIN, displayName: 'المشرف' },
    });
    expect(page.nextCursor).toBe(id(2));
  });
});
