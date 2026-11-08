// T014 — the `evaluate-sessions` sweep (FR-441, FR-482; R-SESS-2; research R-306, R-313;
// contracts/kernel.md, "Jobs"): a sweep under its name, every minute, run with no payload; each run
// ends the rooms of the cancelled sessions in their join period, then settles every session due,
// through sessions' evaluation. The rules are `modules/sessions/evaluation.service.spec.ts`'s; the
// job over the real tables, through T010's harness, with its double-run spec, is
// `tests/sessions/evaluate-sessions.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Evaluation } from '../modules/sessions/index.js';
import { EVALUATE_SESSIONS, EVERY_MINUTE, evaluateSessions } from './evaluate-sessions.js';
import { scheduleSweeps } from './queue.js';

function recorded(): { readonly calls: string[]; readonly evaluation: Evaluation } {
  const calls: string[] = [];
  return {
    calls,
    evaluation: {
      settleDue: async () => {
        calls.push('settleDue');
        return { settled: [], failed: [] };
      },
      endCancelledRooms: async () => {
        calls.push('endCancelledRooms');
        return [];
      },
    },
  };
}

describe('evaluate-sessions: the sweep (R-306)', () => {
  it('is a sweep under its name, every minute, run with no payload', () => {
    const job = evaluateSessions({ evaluation: recorded().evaluation });

    expect(job.name).toBe(EVALUATE_SESSIONS);
    expect(EVALUATE_SESSIONS).toBe('evaluate-sessions');
    expect(job.schedule).toBe(EVERY_MINUTE);
    expect(EVERY_MINUTE).toBe('* * * * *');
  });

  it('is registered through upsertJobScheduler under its name, as every sweep is', async () => {
    const registered: unknown[] = [];
    await scheduleSweeps(
      {
        upsertJobScheduler: async (id, repeat, template) => {
          registered.push({
            id,
            pattern: repeat.pattern,
            name: template.name,
            data: template.data,
          });
        },
      },
      [evaluateSessions({ evaluation: recorded().evaluation })],
    );

    expect(registered).toEqual([
      { id: 'evaluate-sessions', pattern: '* * * * *', name: 'evaluate-sessions', data: {} },
    ]);
  });

  it('a run ends the cancelled sessions’ rooms, then settles the sessions due', async () => {
    const { calls, evaluation } = recorded();

    await evaluateSessions({ evaluation }).handle({});

    expect(calls).toEqual(['endCancelledRooms', 'settleDue']);
  });
});
