// 006:T008 of specs/006-programme (R-510; FR-706b; data-model.md «State transitions»; Q-2 (a)) — the
// close hook: the programmes among the enrollments not yet closed set `closed` at the database's
// instant, their open items `withdrawn` (a `pay_blocked` item among them, FR-706b), payments'
// `deleteProgrammeCard` called for each (a stub until T013, its call asserted here), one line of ids
// and the reason each; an enrollment that is no programme, or one already closed, touches nothing.
// The rows over the real tables are `tests/db-integrity/programme-windows.spec.ts`'.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { closeProgrammes, type ProgrammeCloseStore } from './programme-close.service.js';

const PROGRAMME = '0199d0a0-0000-7000-8000-00000000c0e1';
const OTHER_PROGRAMME = '0199d0a0-0000-7000-8000-00000000c0e2';
const PLAIN = '0199d0a0-0000-7000-8000-00000000c0e3';
const NOW = new Date('2026-11-25T16:00:01Z');
const tx = {} as Transaction;

function hookWorld(open: readonly string[]) {
  const calls: string[] = [];
  const lines: [Readonly<Record<string, unknown>>, string][] = [];
  const store: ProgrammeCloseStore = {
    closeProgrammeRows: async (_tx, ids, closedAt) => {
      calls.push(`close ${ids.join(',')} at ${closedAt.toISOString()}`);
      return ids.filter((id) => open.includes(id));
    },
    withdrawOpenRequests: async (_tx, ids) => {
      calls.push(`withdraw ${ids.join(',')}`);
      return ids.length;
    },
  };
  const close = (ids: readonly string[], cause = 'offer_declined') =>
    closeProgrammes(tx, ids, cause, {
      deleteProgrammeCard: async (_tx, id) => {
        calls.push(`card ${id}`);
      },
      log: { info: (fields, message) => lines.push([fields, message]) },
      clock: async () => NOW,
      store,
    });
  return { calls, lines, close };
}

describe('the close hook (006:T008, R-510, Q-2 (a))', () => {
  it('closes the programme, withdraws its open items, then deletes its card through payments’ entry', async () => {
    const { calls, close } = hookWorld([PROGRAMME]);
    await expect(close([PROGRAMME])).resolves.toStrictEqual([PROGRAMME]);
    expect(calls).toEqual([
      `close ${PROGRAMME} at ${NOW.toISOString()}`,
      `withdraw ${PROGRAMME}`,
      `card ${PROGRAMME}`,
    ]);
  });

  it('calls the card stub once per programme closed, and for no enrollment that is no programme', async () => {
    const { calls, close } = hookWorld([PROGRAMME, OTHER_PROGRAMME]);
    await close([PROGRAMME, PLAIN, OTHER_PROGRAMME]);
    expect(calls.filter((call) => call.startsWith('card'))).toEqual([
      `card ${PROGRAMME}`,
      `card ${OTHER_PROGRAMME}`,
    ]);
    expect(calls).toContain(`withdraw ${PROGRAMME},${OTHER_PROGRAMME}`);
  });

  it('writes nothing more and calls nothing when no programme closed', async () => {
    const { calls, lines, close } = hookWorld([]);
    await expect(close([PLAIN])).resolves.toStrictEqual([]);
    expect(calls).toEqual([`close ${PLAIN} at ${NOW.toISOString()}`]);
    expect(lines).toEqual([]);
  });

  it('logs one line of ids and the reason for each programme closed', async () => {
    const { lines, close } = hookWorld([PROGRAMME]);
    await close([PROGRAMME], 'teacher_suspended');
    expect(lines).toEqual([
      [{ enrollmentId: PROGRAMME, reason: 'teacher_suspended' }, 'A programme was closed'],
    ]);
  });
});
