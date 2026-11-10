// T028 — the `advance-remedies` sweep (FR-462, FR-449; research R-311; contracts/kernel.md, "Jobs"):
// a sweep under its name, every minute, run with no payload; each run is sessions' remedy advance
// (`modules/sessions/remedy-offer.sweep.ts`), whose rules are its own spec's. Over the real tables,
// with its double-run spec (one remedy per session), `tests/db-integrity/remedy-offer.spec.ts`.
// Written before the job, and run red first.
import { describe, expect, it } from 'vitest';

import type { RemedyAdvance } from '../modules/sessions/index.js';
import { ADVANCE_REMEDIES, advanceRemedies, REMEDY_PAGE_SIZE } from './advance-remedies.js';
import { EVERY_MINUTE } from './expire-cancellation-requests.js';
import { scheduleSweeps } from './queue.js';

function recorded(): { readonly calls: string[]; readonly advance: RemedyAdvance } {
  const calls: string[] = [];
  return {
    calls,
    advance: {
      run: async () => {
        calls.push('run');
        return {
          offered: [],
          reoffered: [],
          handedOff: [],
          booked: [],
          retried: [],
          completed: [],
          failed: [],
        };
      },
    },
  };
}

describe('advance-remedies: the sweep (R-311)', () => {
  it('is a sweep under its name, every minute, run with no payload, reading in pages', () => {
    const job = advanceRemedies({ advance: recorded().advance });
    expect(job.name).toBe(ADVANCE_REMEDIES);
    expect(ADVANCE_REMEDIES).toBe('advance-remedies');
    expect(job.schedule).toBe(EVERY_MINUTE);
    expect(REMEDY_PAGE_SIZE).toBeGreaterThan(0);
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
      [advanceRemedies({ advance: recorded().advance })],
    );
    expect(registered).toEqual([
      { id: 'advance-remedies', pattern: '* * * * *', name: 'advance-remedies', data: {} },
    ]);
  });

  it('runs the advance once per run', async () => {
    const { calls, advance } = recorded();
    const job = advanceRemedies({ advance });
    await job.handle({});
    await job.handle({});
    expect(calls).toEqual(['run', 'run']);
  });
});
