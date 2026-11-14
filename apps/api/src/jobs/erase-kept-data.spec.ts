// T077 of specs/004-sessions/tasks.md — the `erase-kept-data` sweep (FR-509; SRS FR-ADMIN-21; the note
// under T077, Q-R3 (a); contracts/kernel.md, "Jobs"): a sweep under its name, daily at 04:25 (03:30,
// 03:40 and 04:10 are other jobs'), run with no payload; each run is verification's kept data erasure
// sweep (`modules/verification/kept-data.sweep.ts`), whose rules and double run are its own spec's;
// over the real tables, `tests/db-integrity/kept-data.spec.ts`. Written before the job, and run red
// first against a stub. ⚠️ Automatic and final.
import { describe, expect, it } from 'vitest';

import type { KeptDataErasureSweep } from '../modules/verification/index.js';
import {
  DAILY_AT_04_25,
  ERASE_KEPT_DATA,
  eraseKeptData,
  KEPT_DATA_PAGE_SIZE,
} from './erase-kept-data.js';
import { scheduleSweeps } from './queue.js';

function recorded(): { readonly calls: string[]; readonly sweep: KeptDataErasureSweep } {
  const calls: string[] = [];
  return {
    calls,
    sweep: {
      run: async () => {
        calls.push('run');
        return { erased: [], failed: [] };
      },
    },
  };
}

describe('erase-kept-data: the sweep (T077, FR-509)', () => {
  it('is a sweep under its name, daily at 04:25, run with no payload, reading in pages', () => {
    const job = eraseKeptData({ sweep: recorded().sweep });
    expect(job.name).toBe(ERASE_KEPT_DATA);
    expect(ERASE_KEPT_DATA).toBe('erase-kept-data');
    expect(DAILY_AT_04_25).toBe('25 4 * * *');
    expect(job.schedule).toBe('25 4 * * *');
    expect(KEPT_DATA_PAGE_SIZE).toBeGreaterThan(0);
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
      [eraseKeptData({ sweep: recorded().sweep })],
    );
    expect(registered).toEqual([
      { id: 'erase-kept-data', pattern: '25 4 * * *', name: 'erase-kept-data', data: {} },
    ]);
  });

  it('runs the sweep once per run', async () => {
    const { calls, sweep } = recorded();
    const job = eraseKeptData({ sweep });
    await job.handle({});
    await job.handle({});
    expect(calls).toEqual(['run', 'run']);
  });
});
