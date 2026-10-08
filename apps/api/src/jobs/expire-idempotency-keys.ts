// T102: the `expire-idempotency-keys` sweep (FR-042, ADR 0008 D2; ARCHITECTURE §5 jobs).
//
// Deletes every idempotency key past its `expires_at`, through the kernel's idempotency service;
// the rule of what has expired lives there, not here. Each row carries its own expiry, written
// from the retention setting when the key was claimed, so the sweep reads no setting. It is
// idempotent by construction: a second run finds nothing more to delete. It runs every hour; an
// expired row left until then is already treated as unused by the service, so the cadence decides
// only how long dead rows take space.
import { z } from 'zod';
import type { IdempotencyService } from '../platform/idempotency/idempotency.service.js';
import { defineJob, type Job } from './job.js';

export function expireIdempotencyKeys(
  idempotency: Pick<IdempotencyService<unknown>, 'sweepExpired'>,
): Job {
  return defineJob({
    name: 'expire-idempotency-keys',
    payload: z.object({}),
    schedule: '0 * * * *',
    run: async () => {
      await idempotency.sweepExpired();
    },
  });
}
