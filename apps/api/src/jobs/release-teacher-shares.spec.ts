// 003:T105 — the `release-teacher-shares` sweep (ADR 0025 D2, SRS DEC-81): a sweep under its name, on
// `close-slot-holds`' schedule (hourly at minute 35), run with no payload; each run is payments'
// share release sweep, whose rules and double run are its own spec's
// (`modules/payments/share-release.service.spec.ts`), and whose race is
// `tests/db-integrity/share-release-race.spec.ts`. Written before the job, run red first on a stub.
import { describe, expect, it } from 'vitest';

import type { ShareReleaseSweep } from '../modules/payments/index.js';
import { scheduleSweeps } from './queue.js';
import {
  RELEASE_TEACHER_SHARES,
  releaseTeacherShares,
  SHARE_RELEASE_PAGE_SIZE,
} from './release-teacher-shares.js';

function recorded(): { readonly calls: string[]; readonly sweep: ShareReleaseSweep } {
  const calls: string[] = [];
  return {
    calls,
    sweep: {
      run: async () => {
        calls.push('run');
        return { written: [], failed: [] };
      },
    },
  };
}

describe('release-teacher-shares: the due sweep (003:T105)', () => {
  it('is a sweep under its name, hourly at minute 35 as close-slot-holds, reading in pages', () => {
    const job = releaseTeacherShares({ sweep: recorded().sweep });
    expect(job.name).toBe(RELEASE_TEACHER_SHARES);
    expect(RELEASE_TEACHER_SHARES).toBe('release-teacher-shares');
    expect(job.schedule).toBe('35 * * * *');
    expect(SHARE_RELEASE_PAGE_SIZE).toBeGreaterThan(0);
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
      [releaseTeacherShares({ sweep: recorded().sweep })],
    );
    expect(registered).toEqual([
      {
        id: 'release-teacher-shares',
        pattern: '35 * * * *',
        name: 'release-teacher-shares',
        data: {},
      },
    ]);
  });

  it('runs the sweep once per run', async () => {
    const { calls, sweep } = recorded();
    const job = releaseTeacherShares({ sweep });
    await job.handle({});
    await job.handle({});
    expect(calls).toEqual(['run', 'run']);
  });
});
