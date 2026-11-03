// T112: the queue — BullMQ over Redis (plan.md, ARCHITECTURE §2, research R-14; FR-052).
//
// One queue, named `jobs`. Producers add a job by its name with an identifiers-only payload; the
// worker process (`src/worker.ts`) runs each delivery through the dispatch of `job.ts`, which picks
// the job by name and checks its payload. A sweep is registered as a job scheduler under its own
// name, so registering it again on every start replaces the schedule instead of adding a second.
//
// Redis holds nothing whose loss would diverge from the database (ARCHITECTURE §2): a job's effect
// is in Postgres and every job is idempotent, so a delivery lost or repeated changes nothing that
// matters. A completed job is removed at once, so finished work does not accumulate in Redis.
//
// RETRY AND BOUNDED FAILURE (T171, review finding SEC-4): every delivery, a sweep's included, is
// attempted three times with exponential backoff from one second, which is safe because every job
// is idempotent (R-API-14); a delivery that fails them all stays in the failed set for an operator,
// and that set is bounded by a count so a broken job cannot fill Redis. The worker runs
// `QUEUE_CONCURRENCY` deliveries at once, from the configuration. These numbers are the queue's
// own operation, not a product setting: they live here in the kernel, outside the magic-number
// gate's root (R-MONEY-12 governs `modules/`).
//
// A JOB ADDED BY ITS ID (B29, T040; the owner's decision of 2026-11-03): BullMQ's `add` does
// nothing for an id still in the failed set, so `addOrRetry` retries such a job instead, and every
// producer of a job added under its own id (`confirm-enrollment`, by the webhook and by the sweep)
// adds it through that function.
//
// The connection is the configured URL and nothing else: `rediss://` gives TLS with the
// certificate verified, as the driver does by default, and no option here loosens it (R-SEC-11).
import { type ConnectionOptions, type DefaultJobOptions, Queue, Worker } from 'bullmq';
import { reportError } from '../platform/errors/reporting.js';
import type { Logger } from '../platform/logging/logger.js';
import { createDispatcher, type Job, type JobPayload } from './job.js';

export const QUEUE_NAME = 'jobs';

/** The options every job and every sweep is added with (T171). */
export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: { count: 1000 },
} as const satisfies DefaultJobOptions;

export function connectionFor(redisUrl: string): ConnectionOptions {
  // A worker's blocking read must wait out a Redis restart rather than fail; BullMQ requires null.
  return { url: redisUrl, maxRetriesPerRequest: null };
}

/**
 * The producer side: what adds jobs and registers sweeps. `name` is the one queue's unless a spec
 * names a queue of its own, so it never meets a running worker's jobs.
 */
export function openQueue(connection: ConnectionOptions, name: string = QUEUE_NAME): Queue {
  return new Queue(name, { connection, defaultJobOptions });
}

/** A job of the queue as `addOrRetry` reads it: BullMQ's `Job`, in the members it needs. */
export interface HeldJob {
  readonly failedReason: string;
  isFailed(): Promise<boolean>;
  retry(state: 'failed', options: { readonly resetAttemptsMade: boolean }): Promise<void>;
}

/** The members of a queue `addOrRetry` needs: BullMQ's `Queue` has them. */
export interface RetryingQueue {
  add(name: string, data: JobPayload, options: { readonly jobId: string }): Promise<unknown>;
  getJob(jobId: string): Promise<HeldJob | undefined>;
}

/** A job added under its own id, so a second add of the id while it is held is the same job. */
export interface IdentifiedJob {
  readonly name: string;
  readonly data: JobPayload;
  readonly jobId: string;
}

/** BullMQ's codes for a retry that found the job gone, or no longer in the failed state. */
const JOB_NOT_EXIST = -1;
const JOB_NOT_IN_STATE = -3;

function bullCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'number' ? error.code : undefined;
}

/**
 * Adds `job` under its id, or, when a job of that id failed all its attempts, retries that one with
 * its attempts counted afresh (B29, T040; the owner's decision of 2026-11-03). BullMQ's `add` does
 * nothing for an id still in the failed set, so a job that failed would never run again; a waiting
 * or running job of the id stays deduplicated by the add. Each retry writes one line naming the job
 * and the failed job's reason, never its payload (R-SEC-2). Two callers at once retry it once: the
 * second's retry finds it no longer failed and does nothing more; one that finds it removed adds it.
 */
export async function addOrRetry(
  queue: RetryingQueue,
  job: IdentifiedJob,
  log: Pick<Logger, 'warn'>,
): Promise<void> {
  const held = await queue.getJob(job.jobId);
  if (held === undefined || !(await held.isFailed())) {
    await queue.add(job.name, job.data, { jobId: job.jobId });
    return;
  }
  const reason = held.failedReason;
  try {
    await held.retry('failed', { resetAttemptsMade: true });
  } catch (error) {
    const code = bullCode(error);
    if (code === JOB_NOT_IN_STATE) return;
    if (code !== JOB_NOT_EXIST) throw error;
    await queue.add(job.name, job.data, { jobId: job.jobId });
    return;
  }
  log.warn({ jobName: job.name, jobId: job.jobId, reason }, 'A failed job is retried');
}

/** The one method of a queue that registering sweeps needs. */
export interface SweepScheduler {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string },
    template: { name: string; data: Record<string, never>; opts: typeof defaultJobOptions },
  ): Promise<unknown>;
}

/** Registers every job that carries a schedule; a job without one runs only when added. */
export async function scheduleSweeps(queue: SweepScheduler, jobs: readonly Job[]): Promise<void> {
  await Promise.all(
    jobs.flatMap(({ name, schedule }) =>
      schedule === undefined
        ? []
        : [
            queue.upsertJobScheduler(
              name,
              { pattern: schedule },
              { name, data: {}, opts: defaultJobOptions },
            ),
          ],
    ),
  );
}

interface FailedDelivery {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
}

/** A failed delivery, logged by its name and identifier and reported; its payload is never logged. */
export function onJobFailed(log: Logger): (job: FailedDelivery | undefined, error: Error) => void {
  return (job, error) => {
    log.error({ err: error, jobName: job?.name, jobId: job?.id }, 'A job failed');
    reportError(error);
  };
}

export interface WorkerOptions {
  readonly connection: ConnectionOptions;
  readonly jobs: readonly Job[];
  readonly log: Logger;
  /** How many deliveries run at once: `QUEUE_CONCURRENCY` (T171). */
  readonly concurrency: number;
  /** The one queue's name unless a spec names its own (as `openQueue`'s). */
  readonly name?: string;
}

/** The consumer side: runs every delivery of the queue through the registered jobs. */
export function startWorker({
  connection,
  jobs,
  log,
  concurrency,
  name = QUEUE_NAME,
}: WorkerOptions): Worker {
  const dispatch = createDispatcher(jobs);
  const worker = new Worker(name, (job) => dispatch({ name: job.name, data: job.data }), {
    connection,
    concurrency,
  });
  worker.on('failed', onJobFailed(log));
  worker.on('error', (error) => {
    log.error({ err: error }, 'The queue worker failed');
    reportError(error);
  });
  return worker;
}
