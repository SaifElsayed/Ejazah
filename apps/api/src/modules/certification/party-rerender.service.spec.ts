// T014 of specs/005-certification — a party's unsigned ijazahs re-rendered after a change of their
// declared gender (Q-G4 (a); SC-604; R-402), over a store and a queue held in memory, on a transaction
// bound to an after-commit list as the administrator kind binds it. Written before the service, run
// red against its stub, each negative case red under its named mutant (lane D's `mutants\`).
//
// - none to re-render: nothing locked, nothing enqueued, no list needed;
// - the unsigned ijazahs read, then locked, then re-rendered, in that order; each new generation
//   enqueued once the list is flushed (the commit), never before, and never on a drop (a rollback);
// - a transaction with no after-commit list refused before any lock or write;
// - a lost enqueue logged `enqueue_failed` by ids; no line carries a gender.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { bindToTransaction, RequestLive } from '../../platform/live/live-publisher.js';
import { createPartyRerender, type PartyRerenderStore } from './party-rerender.service.js';

const PERSON = '0199d0a0-0000-7000-8000-00000000e0a1';
const I1 = '0199d0a0-0000-7000-8000-00000000e0f1';
const I2 = '0199d0a0-0000-7000-8000-00000000e0f2';

let calls: [string, unknown][];
let enqueued: [string, number][];
let lines: { level: string; fields: Record<string, unknown>; message: string }[];
let issued: string[];
let failEnqueue: boolean;

beforeEach(() => {
  calls = [];
  enqueued = [];
  lines = [];
  issued = [I1, I2];
  failEnqueue = false;
});

const store: PartyRerenderStore = {
  unsignedOfParty: async (_tx, userId) => {
    calls.push(['unsignedOfParty', userId]);
    return issued;
  },
  lockIjazahs: async (_tx, ids) => {
    calls.push(['lockIjazahs', ids]);
  },
  rerender: async (_tx, ids) => {
    calls.push(['rerender', ids]);
    return ids.map((id, index) => ({ id, generation: index + 2 }));
  },
};

const log = {
  info: (fields: Record<string, unknown>, message: string) =>
    void lines.push({ level: 'info', fields, message }),
  warn: (fields: Record<string, unknown>, message: string) =>
    void lines.push({ level: 'warn', fields, message }),
} as never;

const renders = {
  enqueue: async (id: string, generation: number) => {
    if (failEnqueue) throw new Error('queue down');
    enqueued.push([id, generation]);
  },
};

const service = createPartyRerender({ renders, log, store });

/** A transaction bound to an after-commit list, as the administrator kind binds its own. */
function boundTx() {
  const tx = {} as Transaction;
  const live = new RequestLive({ publish: () => undefined }, log);
  const unbind = bindToTransaction(tx, live);
  return { tx, live, unbind };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('rerenderOfParty', () => {
  it('re-renders nothing and needs no list when the person has no unsigned ijazah', async () => {
    issued = [];
    expect(await service.rerenderOfParty({} as Transaction, PERSON)).toEqual([]);
    expect(calls).toEqual([['unsignedOfParty', PERSON]]);
  });

  it('reads, then locks, then re-renders, and enqueues each new generation only after the commit', async () => {
    const { tx, live, unbind } = boundTx();
    expect(await service.rerenderOfParty(tx, PERSON)).toEqual([
      { id: I1, generation: 2 },
      { id: I2, generation: 3 },
    ]);
    expect(calls).toEqual([
      ['unsignedOfParty', PERSON],
      ['lockIjazahs', [I1, I2]],
      ['rerender', [I1, I2]],
    ]);
    await settle();
    expect(enqueued).toEqual([]);
    live.flush();
    await settle();
    expect(enqueued).toEqual([
      [I1, 2],
      [I2, 3],
    ]);
    unbind();
  });

  it('enqueues nothing when the transaction rolls back', async () => {
    const { tx, live, unbind } = boundTx();
    await service.rerenderOfParty(tx, PERSON);
    live.drop();
    live.flush();
    await settle();
    expect(enqueued).toEqual([]);
    unbind();
  });

  it('refuses a transaction with no after-commit list before any lock or write', async () => {
    await expect(service.rerenderOfParty({} as Transaction, PERSON)).rejects.toThrow(
      /after-commit list/,
    );
    expect(calls).toEqual([['unsignedOfParty', PERSON]]);
    expect(lines).toEqual([
      {
        level: 'info',
        fields: { userId: PERSON, reason: 'no_after_commit_list' },
        message: 'An ijazah re-render was refused',
      },
    ]);
  });

  it('logs a lost enqueue by ids, and no line carries a gender', async () => {
    failEnqueue = true;
    const { tx, live, unbind } = boundTx();
    await service.rerenderOfParty(tx, PERSON);
    live.flush();
    await settle();
    expect(lines.filter(({ level }) => level === 'warn')).toEqual([
      {
        level: 'warn',
        fields: { ijazahId: I1, generation: 2, reason: 'enqueue_failed' },
        message: "A re-rendered ijazah's rendering could not be queued",
      },
      {
        level: 'warn',
        fields: { ijazahId: I2, generation: 3, reason: 'enqueue_failed' },
        message: "A re-rendered ijazah's rendering could not be queued",
      },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/male/);
    unbind();
  });
});
