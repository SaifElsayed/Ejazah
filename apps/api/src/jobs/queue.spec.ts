// T112 — the queue's own decisions, without Redis (FR-052, R-SEC-2, R-SEC-11).
//
// What reaches Redis is BullMQ's; what is decided here is tested here: the connection is built from
// REDIS_URL alone, with no TLS option of its own (a `rediss://` URL verifies the certificate as the
// driver does by default), every sweep is registered on its schedule and no other job is, and a
// failed delivery is logged by its name and identifier, never by its payload.
//
// T171 (review finding SEC-4): the queue's shared defaults carry retry and bounded failure, every
// sweep is registered with the same defaults, and the worker is built with the configured
// concurrency. BullMQ's `Queue` and `Worker` open a connection as they are built, so both are
// replaced here by classes that record what they were built with; nothing reaches Redis.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../platform/logging/logger.js';
import { defineJob } from './job.js';
import {
  connectionFor,
  defaultJobOptions,
  onJobFailed,
  openQueue,
  QUEUE_NAME,
  scheduleSweeps,
  startWorker,
} from './queue.js';

vi.mock('bullmq', () => {
  class Queue {
    constructor(
      readonly name: string,
      readonly opts: unknown,
    ) {}
  }
  class Worker {
    readonly listeners: string[] = [];
    constructor(
      readonly name: string,
      readonly processor: unknown,
      readonly opts: unknown,
    ) {}
    on(event: string): this {
      this.listeners.push(event);
      return this;
    }
  }
  return { Queue, Worker };
});

const noop = async () => {};
const connection = connectionFor('redis://127.0.0.1:1');
const silent = createLogger({ level: 'info', destination: { write: () => undefined } });

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
        template: { name: 'expire-holds', data: {}, opts: defaultJobOptions },
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

describe('retry, bounded failure and concurrency (T171, FR-052, R-API-14)', () => {
  it('declares three attempts, exponential backoff from one second, no kept completion and a bounded failure set', () => {
    expect(defaultJobOptions).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: { count: 1000 },
    });
  });

  it('builds the queue with those defaults for every job added', () => {
    const queue = openQueue(connection) as unknown as { name: string; opts: unknown };
    expect(queue.name).toBe(QUEUE_NAME);
    expect(queue.opts).toEqual({ connection, defaultJobOptions });
  });

  it('registers every sweep with the same defaults, so a failed sweep is retried too', async () => {
    const templates: { opts: unknown }[] = [];
    const scheduler = {
      upsertJobScheduler: async (_id: string, _repeat: unknown, template: { opts: unknown }) => {
        templates.push(template);
      },
    };
    const sweeps = ['expire-holds', 'expire-idempotency-keys', 'reencrypt-columns'].map((name) =>
      defineJob({ name, payload: z.object({}), schedule: '*/5 * * * *', run: noop }),
    );

    await scheduleSweeps(scheduler, sweeps);

    expect(templates).toHaveLength(3);
    for (const template of templates) expect(template.opts).toEqual(defaultJobOptions);
  });

  it('builds the worker with the configured concurrency, listening for failures', () => {
    const worker = startWorker({
      connection,
      jobs: [],
      log: silent,
      concurrency: 7,
    }) as unknown as {
      name: string;
      opts: unknown;
      listeners: string[];
    };
    expect(worker.name).toBe(QUEUE_NAME);
    expect(worker.opts).toEqual({ connection, concurrency: 7 });
    expect(worker.listeners).toEqual(['failed', 'error']);
  });
});
