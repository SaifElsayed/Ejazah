// T112: a queued job, the one shape every job in this folder has (FR-052, R-API-14, R-SEC-2).
//
// A job is a name, a schema for its payload and a handler. The payload carries identifiers only:
// BullMQ keeps the data of a failed job in Redis, and the logger redacts by key name, so any other
// value in it would sit outside both nets (R-SEC-2). The handler reads everything else itself
// through the modules' public entries, so a job never carries its own copy of a rule and a late
// run reads the current state rather than a stale one.
//
// Every handler is idempotent: run twice, it leaves what one run leaves (R-API-14). Each job's own
// spec proves it with `runOnceAndTwice` (double-run.ts), calling the handler directly.
import type { z } from 'zod';

/** A job's payload: identifiers, each a string. */
export type JobPayload = Readonly<Record<string, string>>;

export interface JobDefinition<TPayload extends JobPayload> {
  /** The stable name the queue carries: kebab-case, as the job's file is named. */
  readonly name: string;
  /** What the payload must hold; checked before the handler runs. */
  readonly payload: z.ZodType<TPayload>;
  /** A cron pattern, for a sweep that runs on its own and needs no payload. */
  readonly schedule?: string;
  /** One delivery. Idempotent: a second run with the same payload changes nothing (R-API-14). */
  readonly run: (payload: TPayload) => Promise<void>;
}

/** A job as the queue sees it. */
export interface Job {
  readonly name: string;
  readonly schedule: string | undefined;
  handle(data: unknown): Promise<void>;
}

const KEBAB_CASE = /^[a-z]+(-[a-z]+)*$/;

export function defineJob<TPayload extends JobPayload>(definition: JobDefinition<TPayload>): Job {
  const { name, payload, schedule, run } = definition;
  if (!KEBAB_CASE.test(name)) {
    throw new Error(`A job's name is kebab-case, as its file is: "${name}"`);
  }
  // A scheduled run is created by the queue with an empty payload, so a sweep must accept one.
  if (schedule !== undefined && !payload.safeParse({}).success) {
    throw new Error(`A scheduled job runs with no payload, and "${name}" requires one`);
  }
  return {
    name,
    schedule,
    handle: async (data) => run(payload.parse(data)),
  };
}

export interface Delivery {
  readonly name: string;
  readonly data: unknown;
}

/** The function the worker hands every delivery to: one job per name, and no guessing. */
export function createDispatcher(jobs: readonly Job[]): (delivery: Delivery) => Promise<void> {
  const byName = new Map<string, Job>();
  for (const job of jobs) {
    if (byName.has(job.name)) throw new Error(`Two jobs are named "${job.name}"`);
    byName.set(job.name, job);
  }
  return async ({ name, data }) => {
    const job = byName.get(name);
    if (job === undefined) throw new Error(`No job is named "${name}"`);
    await job.handle(data);
  };
}
