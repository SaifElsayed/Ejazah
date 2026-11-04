// T048 (ADR 0009 D3, research R-210): a job's last completed run, kept as an `idempotency_keys`
// row of the job's scope, the worker as its actor, the run's key as its key (the time zone
// re-resolution job keys its run by `process.versions.tz` under the scope `tzdata-reresolve`). The
// kernel owns the table (ADR 0008 D2), so the job reaches it here (R-API-6).
//
// ONE ROW PER SCOPE. Recording a run removes the scope's earlier rows and writes the new one in one
// transaction, so the row read is the last run's, whatever ran before it. Two workers recording the
// same key at once: the second waits on the unique index (scope, actor_id, key) until the first
// commits and is then refused; its run is recorded all the same, so the refusal is answered as done.
// The row carries the expiry every key carries (the retention setting, ADR 0008 D2), and a row past
// it counts as no run, as the idempotency service counts an expired key as unused.
import { hash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import type { Database } from '../db/prisma.repository.js';

/** The actor a job's run is keyed under: the worker, not a person. */
export const JOB_ACTOR = 'worker';

const UNIQUE_VIOLATION = 'P2002';

/** A completed run of a job: its scope, its key and when the row expires. */
export interface JobRun {
  readonly scope: string;
  readonly key: string;
  readonly expiresAt: Date;
}

/** A job's runs, as the kernel keeps them. */
export interface JobRuns {
  /** The key of the scope's last run not expired at `now`, or null when there is none. */
  lastKey(scope: string, now: Date): Promise<string | null>;
  /** Records `run` as the scope's last. */
  record(run: JobRun): Promise<void>;
}

/** The hash of what the run was keyed on: the scope and the key. */
function runHash(scope: string, key: string): string {
  return hash('sha256', JSON.stringify({ scope, key }), 'hex');
}

/** A job's runs over the kernel's `idempotency_keys` table. */
export function jobRunsOver(database: Pick<Database, 'idempotencyKey' | '$transaction'>): JobRuns {
  return {
    async lastKey(scope, now) {
      const row = await database.idempotencyKey.findFirst({
        where: { scope, actorId: JOB_ACTOR, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { key: true },
      });
      return row?.key ?? null;
    },
    async record({ scope, key, expiresAt }) {
      try {
        await database.$transaction(async (tx) => {
          await tx.idempotencyKey.deleteMany({ where: { scope, actorId: JOB_ACTOR } });
          await tx.idempotencyKey.create({
            data: {
              scope,
              actorId: JOB_ACTOR,
              key,
              requestHash: runHash(scope, key),
              status: 'completed',
              expiresAt,
            },
            select: { id: true },
          });
        });
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === UNIQUE_VIOLATION
        ) {
          return;
        }
        throw error;
      }
    },
  };
}
