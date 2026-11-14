// T074 of specs/004-sessions/tasks.md — the `close-slot-holds` sweep (FR-505; the note under T074,
// Q-R1 (a); contracts/kernel.md, "Jobs"): a sweep under its name, hourly at minute 35, run with no
// payload; each run is booking's slot hold end sweep (`modules/booking/slot-hold-end.sweep.ts`),
// whose rules are its own spec's. Over the real tables, with its double-run spec (one row per held
// closing whose hold ended), `tests/db-integrity/paused-hold-end.spec.ts`. Written before the job,
// and run red first against a stub.
import { describe, expect, it } from 'vitest';

import type { SlotHoldEndSweep } from '../modules/booking/index.js';
import {
  CLOSE_SLOT_HOLDS,
  closeSlotHolds,
  EVERY_HOUR_AT_35,
  SLOT_HOLD_PAGE_SIZE,
} from './close-slot-holds.js';
import { scheduleSweeps } from './queue.js';

function recorded(): { readonly calls: string[]; readonly sweep: SlotHoldEndSweep } {
  const calls: string[] = [];
  return {
    calls,
    sweep: {
      run: async () => {
        calls.push('run');
        return { recorded: [], failed: [] };
      },
    },
  };
}

describe('close-slot-holds: the sweep (FR-505)', () => {
  it('is a sweep under its name, hourly at minute 35, run with no payload, reading in pages', () => {
    const job = closeSlotHolds({ sweep: recorded().sweep });
    expect(job.name).toBe(CLOSE_SLOT_HOLDS);
    expect(CLOSE_SLOT_HOLDS).toBe('close-slot-holds');
    expect(EVERY_HOUR_AT_35).toBe('35 * * * *');
    expect(job.schedule).toBe('35 * * * *');
    expect(SLOT_HOLD_PAGE_SIZE).toBeGreaterThan(0);
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
      [closeSlotHolds({ sweep: recorded().sweep })],
    );
    expect(registered).toEqual([
      { id: 'close-slot-holds', pattern: '35 * * * *', name: 'close-slot-holds', data: {} },
    ]);
  });

  it('runs the sweep once per run', async () => {
    const { calls, sweep } = recorded();
    const job = closeSlotHolds({ sweep });
    await job.handle({});
    await job.handle({});
    expect(calls).toEqual(['run', 'run']);
  });
});
