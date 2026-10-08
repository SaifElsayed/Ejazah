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
// The connection is the configured URL and nothing else: `rediss://` gives TLS with the
// certificate verified, as the driver does by default, and no option here loosens it (R-SEC-11).
import { type ConnectionOptions, Queue, Worker } from 'bullmq';
import { reportError } from '../platform/errors/reporting.js';
import type { Logger } from '../platform/logging/logger.js';
import { createDispatcher, type Job } from './job.js';

export const QUEUE_NAME = 'jobs';

const completedJobs = { removeOnComplete: true } as const;

export function connectionFor(redisUrl: string): ConnectionOptions {
  // A worker's blocking read must wait out a Redis restart rather than fail; BullMQ requires null.
  return { url: redisUrl, maxRetriesPerRequest: null };
}

/** The producer side: what adds jobs and registers sweeps. */
export function openQueue(connection: ConnectionOptions): Queue {
  return new Queue(QUEUE_NAME, { connection, defaultJobOptions: completedJobs });
}

/** The one method of a queue that registering sweeps needs. */
export interface SweepScheduler {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string },
    template: { name: string; data: Record<string, never>; opts: typeof completedJobs },
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
              { name, data: {}, opts: completedJobs },
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
}

/** The consumer side: runs every delivery of the queue through the registered jobs. */
export function startWorker({ connection, jobs, log }: WorkerOptions): Worker {
  const dispatch = createDispatcher(jobs);
  const worker = new Worker(QUEUE_NAME, (job) => dispatch({ name: job.name, data: job.data }), {
    connection,
  });
  worker.on('failed', onJobFailed(log));
  worker.on('error', (error) => {
    log.error({ err: error }, 'The queue worker failed');
    reportError(error);
  });
  return worker;
}
