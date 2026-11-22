// R1a, `specs/002-identity/tasks.md` T176 (SRS §3.14, DEC-100; the note under T176; contracts/kernel.md
// of specs/004-sessions, "Jobs", the `erase-identity-documents` row) — the sweep under its name, daily
// at 04:40 (03:30, 03:40, 04:10 and 04:25 are other daily jobs'), run with no payload; each run is
// verification's identity retention sweep (`modules/verification/identity-retention.sweep.ts`),
// whose rules and double run are its own spec's; over the real tables,
// `tests/db-integrity/identity-retention.spec.ts`. Written before the job, and run red first against
// a stub. ⚠️ Automatic: after the hourly `erase-deleted-files` removes a file, there is no way back.
import { describe, expect, it } from 'vitest';

import type { IdentityRetentionSweep } from '../modules/verification/index.js';
import {
  DAILY_AT_04_40,
  ERASE_IDENTITY_DOCUMENTS,
  eraseIdentityDocuments,
  IDENTITY_RETENTION_PAGE_SIZE,
} from './erase-identity-documents.js';
import { scheduleSweeps } from './queue.js';

function recorded(): { readonly calls: string[]; readonly sweep: IdentityRetentionSweep } {
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

describe('erase-identity-documents: the sweep (T176, SRS §3.14)', () => {
  it('is a sweep under its name, daily at 04:40, run with no payload, reading in pages', () => {
    const job = eraseIdentityDocuments({ sweep: recorded().sweep });
    expect(job.name).toBe(ERASE_IDENTITY_DOCUMENTS);
    expect(ERASE_IDENTITY_DOCUMENTS).toBe('erase-identity-documents');
    expect(DAILY_AT_04_40).toBe('40 4 * * *');
    expect(job.schedule).toBe('40 4 * * *');
    expect(IDENTITY_RETENTION_PAGE_SIZE).toBe(200);
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
      [eraseIdentityDocuments({ sweep: recorded().sweep })],
    );
    expect(registered).toEqual([
      {
        id: 'erase-identity-documents',
        pattern: '40 4 * * *',
        name: 'erase-identity-documents',
        data: {},
      },
    ]);
  });

  it('runs the sweep once per run', async () => {
    const { calls, sweep } = recorded();
    const job = eraseIdentityDocuments({ sweep });
    await job.handle({});
    await job.handle({});
    expect(calls).toEqual(['run', 'run']);
  });
});
