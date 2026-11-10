// T022 — the `expire-cancellation-requests` sweep (FR-458; SC-411; research R-310; contracts/
// kernel.md, "Jobs"): a sweep under its name, every minute, run with no payload; each run expires
// every pending request whose session has started, through sessions' expiry. The rules are
// `modules/sessions/cancellation-expiry.service.spec.ts`'; the job over the real tables, with its
// double-run spec and «no request pending after its start», is
// `tests/sessions/expire-cancellation-requests.spec.ts`. Written before the job, and run red first.
import { describe, expect, it } from 'vitest';

import type { CancellationExpiry } from '../modules/sessions/index.js';
import {
  EVERY_MINUTE,
  EXPIRE_CANCELLATION_REQUESTS,
  expireCancellationRequests,
} from './expire-cancellation-requests.js';
import { scheduleSweeps } from './queue.js';

function recorded(): { readonly calls: string[]; readonly expiry: CancellationExpiry } {
  const calls: string[] = [];
  return {
    calls,
    expiry: {
      expireStarted: async () => {
        calls.push('expireStarted');
        return { expired: [], failed: [] };
      },
    },
  };
}

describe('expire-cancellation-requests: the sweep (R-310)', () => {
  it('is a sweep under its name, every minute, run with no payload', () => {
    const job = expireCancellationRequests({ expiry: recorded().expiry });

    expect(job.name).toBe(EXPIRE_CANCELLATION_REQUESTS);
    expect(EXPIRE_CANCELLATION_REQUESTS).toBe('expire-cancellation-requests');
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
      [expireCancellationRequests({ expiry: recorded().expiry })],
    );

    expect(registered).toEqual([
      {
        id: 'expire-cancellation-requests',
        pattern: '* * * * *',
        name: 'expire-cancellation-requests',
        data: {},
      },
    ]);
  });

  it('a run expires the started sessions’ pending requests', async () => {
    const { calls, expiry } = recorded();

    await expireCancellationRequests({ expiry }).handle({});

    expect(calls).toEqual(['expireStarted']);
  });
});
