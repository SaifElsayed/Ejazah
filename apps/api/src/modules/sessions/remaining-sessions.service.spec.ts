// T004 of specs/004-sessions/tasks.md (`003:T059`, FR-420, FR-484, FR-485, FR-495; research R-312,
// R-313) — `cancelRemainingSessions`, the one hand-off every enrollment's end uses, over a recorded
// store. What the record lets a spec see plainly: the order of the locks after the enrollments' the
// caller holds (the sessions in one statement, then the remedies, then the case the caller opens),
// each session cancelled by an administrator with one event naming its enrollment's case, the open
// remedies handed to that case or, where the caller opens none (a student's deletion), lapsed, each
// with its event, and a remedy already handed to a case left alone. The same over the real tables,
// through booking's termination subscriber, is `tests/db-integrity/termination.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  cancelRemainingSessions,
  type FreezeStore,
  freezeOpenRemedies,
  type RemainingSessionsStore,
} from './remaining-sessions.service.js';
import type { SessionEventRecord } from './session-events.repository.js';

const tx = {} as Transaction;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ENROLLMENT_A = id(1);
const ENROLLMENT_B = id(2);
const NOW = new Date('2026-11-06T10:00:00Z');

interface World {
  readonly sessions: { id: string; enrollmentId: string }[];
  readonly remedies: { id: string; sessionId: string; enrollmentId: string }[];
}

function recorded(world: World) {
  const journal: string[] = [];
  const events: SessionEventRecord[] = [];
  const store: RemainingSessionsStore = {
    scheduledSessionsOf: async (_tx, enrollmentIds) => {
      journal.push(`read sessions ${enrollmentIds.join(',')}`);
      return world.sessions.filter(({ enrollmentId }) => enrollmentIds.includes(enrollmentId));
    },
    openRemediesOf: async (_tx, enrollmentIds) => {
      journal.push(`read remedies ${enrollmentIds.join(',')}`);
      return world.remedies.filter(({ enrollmentId }) => enrollmentIds.includes(enrollmentId));
    },
    lockRows: async (_tx, table, ids) => {
      journal.push(`lock ${table} ${ids.join(',')}`);
    },
    cancelByAdmin: async (_tx, ids) => {
      journal.push(`cancel ${ids.join(',')}`);
    },
    handToCase: async (_tx, ids, caseId, at) => {
      expect(at).toBe(NOW);
      journal.push(`hand ${ids.join(',')} to ${caseId}`);
    },
    lapse: async (_tx, ids, at) => {
      expect(at).toBe(NOW);
      journal.push(`lapse ${ids.join(',')}`);
    },
    recordEvents: async (_tx, rows) => {
      journal.push(`events ${rows.length}`);
      events.push(...rows);
    },
  };
  return { journal, events, store };
}

describe('cancelRemainingSessions (T004, R-313)', () => {
  it('locks the sessions in one call in id order, then the remedies, then asks each enrollment’s case, then writes', async () => {
    const { journal, store } = recorded({
      sessions: [
        { id: id(12), enrollmentId: ENROLLMENT_B },
        { id: id(11), enrollmentId: ENROLLMENT_A },
      ],
      remedies: [{ id: id(21), sessionId: id(10), enrollmentId: ENROLLMENT_A }],
    });
    const asked: string[] = [];
    await cancelRemainingSessions(
      tx,
      [ENROLLMENT_B, ENROLLMENT_A, ENROLLMENT_A],
      NOW,
      async (enrollmentId) => {
        asked.push(enrollmentId);
        journal.push(`case of ${enrollmentId}`);
        return enrollmentId === ENROLLMENT_A ? id(31) : id(32);
      },
      store,
    );
    expect(asked).toEqual([ENROLLMENT_A, ENROLLMENT_B]);
    expect(journal).toEqual([
      `read sessions ${ENROLLMENT_A},${ENROLLMENT_B}`,
      `lock sessions ${id(11)},${id(12)}`,
      `read sessions ${ENROLLMENT_A},${ENROLLMENT_B}`,
      `read remedies ${ENROLLMENT_A},${ENROLLMENT_B}`,
      `lock session_remedies ${id(21)}`,
      `read remedies ${ENROLLMENT_A},${ENROLLMENT_B}`,
      `case of ${ENROLLMENT_A}`,
      `case of ${ENROLLMENT_B}`,
      `cancel ${id(11)},${id(12)}`,
      `hand ${id(21)} to ${id(31)}`,
      'events 3',
    ]);
  });

  it('writes one cancelled_by_admin row per session naming its enrollment’s case, and one hand-off row per remedy', async () => {
    const { events, store } = recorded({
      sessions: [
        { id: id(11), enrollmentId: ENROLLMENT_A },
        { id: id(12), enrollmentId: ENROLLMENT_B },
      ],
      remedies: [{ id: id(21), sessionId: id(10), enrollmentId: ENROLLMENT_A }],
    });
    const ended = await cancelRemainingSessions(
      tx,
      [ENROLLMENT_A, ENROLLMENT_B],
      NOW,
      async (enrollmentId) => (enrollmentId === ENROLLMENT_A ? id(31) : null),
      store,
    );
    expect(events).toEqual([
      {
        enrollmentId: ENROLLMENT_A,
        sessionId: id(11),
        kind: 'cancelled_by_admin',
        caseId: id(31),
        occurredAt: NOW,
      },
      {
        enrollmentId: ENROLLMENT_B,
        sessionId: id(12),
        kind: 'cancelled_by_admin',
        caseId: null,
        occurredAt: NOW,
      },
      {
        enrollmentId: ENROLLMENT_A,
        sessionId: id(10),
        kind: 'remedy_handed_to_case',
        occurredAt: NOW,
      },
    ]);
    expect(ended).toEqual({
      cancelledSessionIds: [id(11), id(12)],
      handedRemedyIds: [id(21)],
      lapsedRemedyIds: [],
      caseOf: new Map([
        [ENROLLMENT_A, id(31)],
        [ENROLLMENT_B, null],
      ]),
    });
  });

  it('where the caller opens no case (a student’s deletion): every open remedy lapsed, one remedy_lapsed row each', async () => {
    const { journal, events, store } = recorded({
      sessions: [],
      remedies: [
        { id: id(22), sessionId: id(14), enrollmentId: ENROLLMENT_B },
        { id: id(21), sessionId: id(13), enrollmentId: ENROLLMENT_A },
      ],
    });
    const ended = await cancelRemainingSessions(
      tx,
      [ENROLLMENT_A, ENROLLMENT_B],
      NOW,
      async () => null,
      store,
    );
    expect(journal).toContain(`lapse ${id(21)},${id(22)}`);
    expect(journal.some((line) => line.startsWith('hand '))).toBe(false);
    expect(events.map(({ kind, sessionId }) => [kind, sessionId])).toEqual([
      ['remedy_lapsed', id(13)],
      ['remedy_lapsed', id(14)],
    ]);
    expect(ended.lapsedRemedyIds).toEqual([id(21), id(22)]);
  });

  it('hands each remedy to its own enrollment’s case, one statement per case', async () => {
    const { journal, store } = recorded({
      sessions: [],
      remedies: [
        { id: id(21), sessionId: id(13), enrollmentId: ENROLLMENT_A },
        { id: id(22), sessionId: id(14), enrollmentId: ENROLLMENT_B },
        { id: id(23), sessionId: id(15), enrollmentId: ENROLLMENT_A },
      ],
    });
    await cancelRemainingSessions(
      tx,
      [ENROLLMENT_A, ENROLLMENT_B],
      NOW,
      async (enrollmentId) => (enrollmentId === ENROLLMENT_A ? id(31) : id(32)),
      store,
    );
    expect(journal.filter((line) => line.startsWith('hand '))).toEqual([
      `hand ${id(21)},${id(23)} to ${id(31)}`,
      `hand ${id(22)} to ${id(32)}`,
    ]);
  });

  it('a remedy no longer open once its lock is held is left as it is', async () => {
    const world = {
      sessions: [],
      remedies: [{ id: id(21), sessionId: id(13), enrollmentId: ENROLLMENT_A }],
    };
    const { journal, events, store } = recorded(world);
    const openRemediesOf = store.openRemediesOf;
    let reads = 0;
    const racing: RemainingSessionsStore = {
      ...store,
      openRemediesOf: async (t, ids) => {
        reads += 1;
        // Another path handed it over while this one waited on its lock.
        return reads === 1 ? openRemediesOf(t, ids) : [];
      },
    };
    await cancelRemainingSessions(tx, [ENROLLMENT_A], NOW, async () => id(31), racing);
    expect(journal.some((line) => line.startsWith('hand ') || line.startsWith('lapse '))).toBe(
      false,
    );
    expect(events).toEqual([]);
  });

  it('sessions and no open remedy: the sessions locked and cancelled, no remedy locked, handed or lapsed', async () => {
    const { journal, events, store } = recorded({
      sessions: [{ id: id(11), enrollmentId: ENROLLMENT_A }],
      remedies: [],
    });
    const ended = await cancelRemainingSessions(tx, [ENROLLMENT_A], NOW, async () => id(31), store);
    expect(journal).toEqual([
      `read sessions ${ENROLLMENT_A}`,
      `lock sessions ${id(11)}`,
      `read sessions ${ENROLLMENT_A}`,
      `read remedies ${ENROLLMENT_A}`,
      `read remedies ${ENROLLMENT_A}`,
      `cancel ${id(11)}`,
      'events 1',
    ]);
    expect(events.map(({ kind }) => kind)).toEqual(['cancelled_by_admin']);
    expect(ended).toMatchObject({ handedRemedyIds: [], lapsedRemedyIds: [] });
  });

  it('nothing at all for no enrollment: no read, no lock, no case asked', async () => {
    const { journal, store } = recorded({ sessions: [], remedies: [] });
    const asked: string[] = [];
    await cancelRemainingSessions(
      tx,
      [],
      NOW,
      async (enrollmentId) => {
        asked.push(enrollmentId);
        return null;
      },
      store,
    );
    expect(journal).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("cancelRemainingSessions with remedies: 'lockOnly' (T005, a student's suspension)", () => {
  it('locks the remedies in their place, before the case, and neither hands nor lapses them', async () => {
    const { journal, events, store } = recorded({
      sessions: [{ id: id(11), enrollmentId: ENROLLMENT_A }],
      remedies: [{ id: id(21), sessionId: id(10), enrollmentId: ENROLLMENT_A }],
    });
    const ended = await cancelRemainingSessions(
      tx,
      [ENROLLMENT_A],
      NOW,
      async (enrollmentId) => {
        journal.push(`case of ${enrollmentId}`);
        return id(31);
      },
      store,
      { remedies: 'lockOnly' },
    );
    expect(journal).toEqual([
      `read sessions ${ENROLLMENT_A}`,
      `lock sessions ${id(11)}`,
      `read sessions ${ENROLLMENT_A}`,
      `read remedies ${ENROLLMENT_A}`,
      `lock session_remedies ${id(21)}`,
      `read remedies ${ENROLLMENT_A}`,
      `case of ${ENROLLMENT_A}`,
      `cancel ${id(11)}`,
      'events 1',
    ]);
    expect(events).toEqual([
      {
        enrollmentId: ENROLLMENT_A,
        sessionId: id(11),
        kind: 'cancelled_by_admin',
        caseId: id(31),
        occurredAt: NOW,
      },
    ]);
    expect(ended).toEqual({
      cancelledSessionIds: [id(11)],
      handedRemedyIds: [],
      lapsedRemedyIds: [],
      caseOf: new Map([[ENROLLMENT_A, id(31)]]),
    });
  });

  it("the default stays 'hand'", async () => {
    const { journal, store } = recorded({
      sessions: [],
      remedies: [{ id: id(21), sessionId: id(10), enrollmentId: ENROLLMENT_A }],
    });
    await cancelRemainingSessions(tx, [ENROLLMENT_A], NOW, async () => id(31), store, {});
    expect(journal).toContain(`hand ${id(21)} to ${id(31)}`);
  });
});

interface FreezeWorld {
  remedies: { id: string; sessionId: string; enrollmentId: string; counterPending: boolean }[];
}

function freezing(world: FreezeWorld) {
  const journal: string[] = [];
  const events: SessionEventRecord[] = [];
  const store: FreezeStore = {
    freezableRemediesOf: async (_tx, enrollmentIds) => {
      journal.push(`read freezable ${enrollmentIds.join(',')}`);
      return world.remedies.filter(({ enrollmentId }) => enrollmentIds.includes(enrollmentId));
    },
    lockRows: async (_tx, table, ids) => {
      journal.push(`lock ${table} ${ids.join(',')}`);
    },
    freeze: async (_tx, ids) => {
      journal.push(`freeze ${ids.join(',')}`);
    },
    recordEvents: async (_tx, rows) => {
      journal.push(`events ${rows.length}`);
      events.push(...rows);
    },
  };
  return { journal, events, store };
}

describe('freezeOpenRemedies (T005, R-311 "Frozen", the owner’s decision C3)', () => {
  it('locks the remedies in one call in id order, reads them again, freezes them in one statement, then writes the rows', async () => {
    const { journal, store } = freezing({
      remedies: [
        { id: id(22), sessionId: id(14), enrollmentId: ENROLLMENT_B, counterPending: false },
        { id: id(21), sessionId: id(13), enrollmentId: ENROLLMENT_A, counterPending: false },
      ],
    });
    await freezeOpenRemedies(tx, [ENROLLMENT_B, ENROLLMENT_A], NOW, store);
    expect(journal).toEqual([
      `read freezable ${ENROLLMENT_A},${ENROLLMENT_B}`,
      `lock session_remedies ${id(21)},${id(22)}`,
      `read freezable ${ENROLLMENT_A},${ENROLLMENT_B}`,
      `freeze ${id(21)},${id(22)}`,
      'events 2',
    ]);
  });

  it('writes one remedy_frozen row per remedy, and one counter_withdrawn row before it for a pending counter-proposal', async () => {
    const { events, store } = freezing({
      remedies: [
        { id: id(21), sessionId: id(13), enrollmentId: ENROLLMENT_A, counterPending: true },
        { id: id(22), sessionId: id(14), enrollmentId: ENROLLMENT_A, counterPending: false },
      ],
    });
    const frozen = await freezeOpenRemedies(tx, [ENROLLMENT_A], NOW, store);
    expect(events).toEqual([
      { enrollmentId: ENROLLMENT_A, sessionId: id(13), kind: 'counter_withdrawn', occurredAt: NOW },
      { enrollmentId: ENROLLMENT_A, sessionId: id(13), kind: 'remedy_frozen', occurredAt: NOW },
      { enrollmentId: ENROLLMENT_A, sessionId: id(14), kind: 'remedy_frozen', occurredAt: NOW },
    ]);
    expect(frozen).toEqual({
      frozenRemedyIds: [id(21), id(22)],
      withdrawnCounterRemedyIds: [id(21)],
    });
  });

  it('a remedy no longer freezable once its lock is held is left as it is, and a pending counter is judged again under the lock', async () => {
    const world: FreezeWorld = {
      remedies: [
        { id: id(21), sessionId: id(13), enrollmentId: ENROLLMENT_A, counterPending: true },
        { id: id(22), sessionId: id(14), enrollmentId: ENROLLMENT_A, counterPending: false },
      ],
    };
    const { journal, events, store } = freezing(world);
    let reads = 0;
    const racing: FreezeStore = {
      ...store,
      freezableRemediesOf: async (t, ids) => {
        reads += 1;
        if (reads === 2) {
          // Meanwhile the teacher declined the counter on 21 and 22 was booked.
          world.remedies = [
            { id: id(21), sessionId: id(13), enrollmentId: ENROLLMENT_A, counterPending: false },
          ];
        }
        return store.freezableRemediesOf(t, ids);
      },
    };
    const frozen = await freezeOpenRemedies(tx, [ENROLLMENT_A], NOW, racing);
    expect(journal).toContain(`freeze ${id(21)}`);
    expect(events.map(({ kind, sessionId }) => [kind, sessionId])).toEqual([
      ['remedy_frozen', id(13)],
    ]);
    expect(frozen).toEqual({ frozenRemedyIds: [id(21)], withdrawnCounterRemedyIds: [] });
  });

  it('nothing at all for no enrollment, and no lock or write when nothing is freezable', async () => {
    const empty = freezing({ remedies: [] });
    expect(await freezeOpenRemedies(tx, [], NOW, empty.store)).toEqual({
      frozenRemedyIds: [],
      withdrawnCounterRemedyIds: [],
    });
    expect(empty.journal).toEqual([]);
    await freezeOpenRemedies(tx, [ENROLLMENT_A], NOW, empty.store);
    expect(empty.journal).toEqual([`read freezable ${ENROLLMENT_A}`]);
  });
});
