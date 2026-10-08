// T112 — the queue's own decisions, without Redis (FR-052, R-SEC-2, R-SEC-11).
//
// What reaches Redis is BullMQ's; what is decided here is tested here: the connection is built from
// REDIS_URL alone, with no TLS option of its own (a `rediss://` URL verifies the certificate as the
// driver does by default), every sweep is registered on its schedule and no other job is, and a
// failed delivery is logged by its name and identifier, never by its payload.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../platform/logging/logger.js';
import { defineJob } from './job.js';
import { connectionFor, onJobFailed, QUEUE_NAME, scheduleSweeps } from './queue.js';

const noop = async () => {};

describe('the queue (T112)', () => {
  it('connects with the configured URL and nothing that loosens it', () => {
    expect(connectionFor('rediss://cache.internal:6380')).toEqual({
      url: 'rediss://cache.internal:6380',
      maxRetriesPerRequest: null,
    });
  });

  it('has one name, which the worker and every producer share', () => {
    expect(QUEUE_NAME).toBe('jobs');
  });

  it('registers each sweep on its schedule, under its own name, and nothing else', async () => {
    const calls: unknown[] = [];
    const scheduler = {
      upsertJobScheduler: async (id: string, repeat: unknown, template: unknown) => {
        calls.push({ id, repeat, template });
      },
    };
    const jobs = [
      defineJob({ name: 'expire-holds', payload: z.object({}), schedule: '* * * * *', run: noop }),
      defineJob({
        name: 'confirm-enrollment',
        payload: z.object({ enrollmentId: z.uuid() }),
        run: noop,
      }),
    ];

    await scheduleSweeps(scheduler, jobs);

    expect(calls).toEqual([
      {
        id: 'expire-holds',
        repeat: { pattern: '* * * * *' },
        template: { name: 'expire-holds', data: {}, opts: { removeOnComplete: true } },
      },
    ]);
  });

  it('logs a failed delivery by name and identifier, never its payload', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } });
    const enrollmentId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

    onJobFailed(log)(
      { id: '42', name: 'confirm-enrollment', data: { enrollmentId } },
      new Error('boom'),
    );

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({ level: 'error', jobName: 'confirm-enrollment', jobId: '42' });
    expect(lines[0]).not.toContain(enrollmentId);
  });
});
