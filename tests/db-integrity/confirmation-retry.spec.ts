// T040 (the owner's decision of 2026-11-03): a `confirm-enrollment` that failed all its attempts is
// retried, not lost. BullMQ's `add` does nothing for a job id still in the failed set, so both the
// webhook's enqueue and the sweep's hand-off go through `addOrRetry` (`jobs/queue.ts`), which
// retries a failed job of that id with its attempts counted afresh and writes one log line.
//
//   - a job that failed all its attempts (the database unreachable, say), then the sweep: it is
//     retried and the enrollment ends confirmed;
//   - the same failed job retried by the webhook (a replayed paid event) and by the sweep at the
//     same moment runs once.
//
// Over Redis (`REDIS_URL`, as stage 4 of CI has it since PR #120's pipeline), on a queue named
// after the spec and a random id of the run, so two runs, or a development worker, sharing one Redis
// never touch its jobs (the database probes run one file at a time), with the queue's own defaults
// (three attempts, backoff from one second); the queue's keys are removed at the end, by that name
// and nothing else. The queue is paused while the two callers race, so neither retry is run before
// both have returned.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONFIRM_ENROLLMENT, confirmEnrollment } from '../../apps/api/src/jobs/confirm-enrollment';
import { expirePendingPayments } from '../../apps/api/src/jobs/expire-pending-payments';
import type { Job } from '../../apps/api/src/jobs/job';
import {
  addOrRetry,
  connectionFor,
  defaultJobOptions,
  openQueue,
  startWorker,
} from '../../apps/api/src/jobs/queue';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import { confirmationWorld, NOW } from './confirmation-world';
import {
  expirySettings,
  listenWebhook,
  plantOrder,
  sweepInstant,
  type Webhook,
} from './expiry-world';

// 005:T016 (rule d): the payment and cancellation pushes' port, which records nothing here.
const NO_PUSH = { record: async () => undefined };

const QUEUE = `confirmation-retry-spec-${randomUUID()}`;

let database: Database;
let webhook: Webhook;
let queue: ReturnType<typeof openQueue>;
let worker: ReturnType<typeof startWorker>;
/** While true, every run fails as an unreachable database would make it. */
let broken = false;
/** Every run the worker started, by payment id. */
const runs = new Map<string, number>();
/** The helper's log lines. */
const lines: string[] = [];

const log = createLogger({ level: 'info', destination: { write: (line) => lines.push(line) } });
/** The orders of this spec's worlds: the sweep is global, and only these reach the spec's queue. */
const mine = new Set<string>();
const confirmations = {
  enqueue: async (paymentId: string) => {
    if (!mine.has(paymentId)) return;
    await addOrRetry(
      queue,
      { name: CONFIRM_ENROLLMENT, data: { paymentId }, jobId: paymentId },
      log,
    );
  },
};

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url === undefined || url === '') throw new Error('REDIS_URL is not set in the environment');
  return url;
}

beforeAll(async () => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  const connection = connectionFor(redisUrl());
  queue = openQueue(connection, QUEUE);
  const job = confirmEnrollment({ database, settings: expirySettings, notices: NO_PUSH, clock: () => NOW });
  // The job as the worker registers it, counting its runs and failing while `broken`.
  const counted: Job = {
    name: CONFIRM_ENROLLMENT,
    schedule: undefined,
    handle: async (data) => {
      const { paymentId } = data as { paymentId: string };
      runs.set(paymentId, (runs.get(paymentId) ?? 0) + 1);
      if (broken) throw new Error('The database was unreachable');
      await job.handle(data);
    },
  };
  worker = startWorker({
    connection,
    jobs: [counted],
    log: createLogger({ level: 'fatal', destination: { write: () => undefined } }),
    concurrency: 4,
    name: QUEUE,
  });
  webhook = await listenWebhook(database, confirmations);
}, 60_000);

afterAll(async () => {
  await webhook?.close();
  await worker?.close();
  if (queue !== undefined) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  if (database !== undefined) await closeDatabase(database);
});

const { world, order, enrollmentOf } = confirmationWorld(() => database);

/** Polls `condition` every tenth of a second, for at most thirty seconds. */
async function until(condition: () => Promise<boolean>, what: string): Promise<void> {
  for (let poll = 0; poll < 300; poll += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting until ${what}`);
}

const sweep = () =>
  expirePendingPayments({
    notices: NO_PUSH,
    database,
    settings: expirySettings,
    confirmations,
    clock: sweepInstant,
  }).handle({});

const retryLines = () =>
  lines.filter((line) => (JSON.parse(line) as { msg?: string }).msg === 'A failed job is retried');

/** A paid order whose `confirm-enrollment` failed all its attempts: its ids. */
async function failedConfirmation() {
  const on = await world();
  const { gatewayOrderId, paymentId } = await plantOrder(webhook, order, on.enrollmentId);
  mine.add(paymentId);
  const paid = webhook.stand.paid(gatewayOrderId);
  broken = true;
  expect(await webhook.stand.deliver(paid)).toBe(200);
  await until(
    async () => (await queue.getJob(paymentId))?.isFailed() ?? false,
    'the job failed all its attempts',
  );
  expect(runs.get(paymentId)).toBe(defaultJobOptions.attempts);
  broken = false;
  return { on, paid, paymentId };
}

describe('a confirm-enrollment that failed all its attempts (the owner’s decision of 2026-11-03)', () => {
  it('is retried by the sweep, and the enrollment ends confirmed', async () => {
    const { on, paymentId } = await failedConfirmation();
    expect((await enrollmentOf(on.enrollmentId)).status).toBe('pending_payment');
    lines.length = 0;

    await sweep();
    await until(
      async () => (await enrollmentOf(on.enrollmentId)).status === 'confirmed',
      'the enrollment is confirmed',
    );

    expect(runs.get(paymentId)).toBe(defaultJobOptions.attempts + 1);
    expect(retryLines().map((line) => JSON.parse(line) as Record<string, unknown>)).toEqual([
      expect.objectContaining({
        jobName: CONFIRM_ENROLLMENT,
        jobId: paymentId,
        reason: 'The database was unreachable',
      }),
    ]);
  }, 90_000);

  it('retried by the webhook and by the sweep at the same moment, runs once', async () => {
    const { on, paid, paymentId } = await failedConfirmation();
    lines.length = 0;

    await queue.pause();
    const [status] = await Promise.all([webhook.stand.deliver(paid), sweep()]);
    expect(status).toBe(200);
    await queue.resume();
    await until(
      async () => (await enrollmentOf(on.enrollmentId)).status === 'confirmed',
      'the enrollment is confirmed',
    );
    await until(async () => (await queue.getJob(paymentId)) === undefined, 'the job is done');

    expect(runs.get(paymentId)).toBe(defaultJobOptions.attempts + 1);
    expect(retryLines()).toHaveLength(1);
  }, 90_000);
});
