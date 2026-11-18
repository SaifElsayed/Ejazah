// T048 (R-210, FR-370, FR-SESS-20, ADR 0009 D3, ADR 0010, ERD §15 rule 19): the
// `reresolve-session-instants` job, the `tzdata-reresolve` of ADR 0009 D3. The worker adds it once
// at its start, and it runs daily on a cron pattern in code, as every sweep's.
//
// WHEN. It reads the runtime's time zone data version, `process.versions.tz`, and compares it with
// the last run's, kept by the kernel as an `idempotency_keys` row of the scope `tzdata-reresolve`
// keyed by the version (ADR 0009 D3, R-210): the same version, nothing runs. That row expires with
// the retention every key carries (`idempotency_key_ttl_hours`, ADR 0008 D2), after which a run
// recomputes again and, the data unchanged, writes nothing.
//
// WHAT. Every scheduled session's cached instants recomputed from its local date, start and zone
// (sessions' `reresolveScheduledSessions`, the lengths read through booking's entry), in ONE
// transaction for the whole run whose first statement defers the two overlap constraints
// (`withDeferredSessionConstraints`): a uniform shift of back-to-back sessions commits, and one run,
// not one per teacher, since a student links teachers (ADR 0010). That transaction is long on
// purpose, so it is given its own timeout rather than Prisma's five seconds. Before it commits, the
// moved sessions that would overlap another session the constraints count are restored to their
// previous instants (sessions' rule), and after the commit they are reported to error tracking
// (FR-051) for an operator, once, so a refused and rerun commit does not report them twice.
//
// T014 (research R-323, GAP-6; contracts/kernel.md's `reresolve-session-instants` row, L1): on the
// same transaction, sessions' run locks the differing sessions' enrollments, then those sessions,
// and writes one `session_events` row `instants_reresolved` per session moved and per session kept
// back, at the database's clock (`clockTimestamp`), so a refused commit writes none.
//
// A REFUSED COMMIT. A write committed by another transaction during the run can still make the
// deferred check refuse the commit; the run is then run again, from a fresh read, up to
// `RERESOLUTION_ATTEMPTS` times in all, and after that it fails for the queue's retry (T171). Any
// other failure fails at once, for the queue.
//
// AFTER. Nothing is rescheduled for the reminders (ADR 0009 D3; 005:T017, research R-407): the
// `send-reminder` sweep reads the committed instants every minute, so a moved session is reminded
// from its new start. Then the version is recorded, so a run that stopped before it runs again, which
// is harmless: the recomputation is a function of the stored local fields (R-API-14).
import { addHours } from '@ijazah/time';
import { z } from 'zod';

import { sessionLengthsOf } from '../modules/booking/index.js';
import {
  type Reresolution,
  reresolutionStore,
  reresolveScheduledSessions,
} from '../modules/sessions/index.js';
import { clockTimestamp } from '../platform/db/db-clock.js';
import { isExclusionViolation } from '../platform/db/db-errors.js';
import { withDeferredSessionConstraints } from '../platform/db/deferred-constraints.js';
import type { Database, Transaction } from '../platform/db/prisma.repository.js';
import { reportError } from '../platform/errors/reporting.js';
import { IDEMPOTENCY_RETENTION_SETTING } from '../platform/idempotency/idempotency.service.js';
import type { JobRuns } from '../platform/idempotency/job-runs.repository.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const RERESOLVE_SESSION_INSTANTS = 'reresolve-session-instants';

/** The scope its runs are keyed under (ADR 0009 D3). */
export const TZDATA_RERESOLVE_SCOPE = 'tzdata-reresolve';

/** Daily, at 03:40 UTC, beside the other daily sweep's 03:30. */
export const DAILY = '40 3 * * *';

/** How many sessions are read, and checked for an overlap, at a time. */
export const RERESOLUTION_PAGE_SIZE = 200;

/** How many times a run is tried when its commit is refused by a concurrent write. */
export const RERESOLUTION_ATTEMPTS = 3;

/** How long the run's one transaction may stay open (rule 19's one transaction for the whole run). */
export const RERESOLUTION_TIMEOUT_MS = 120_000;

const retentionHours = z.number().int().positive();

/** The moved sessions kept at their previous instants, for an operator (FR-051). Ids only. */
export class SessionsKeptAtPreviousInstants extends Error {
  readonly sessionIds: readonly string[];

  constructor(version: string, sessionIds: readonly string[]) {
    super(
      `${String(sessionIds.length)} scheduled session(s) kept at their previous instants after the ` +
        `time zone data changed to ${version}: the recomputed time overlaps another session of the ` +
        `same teacher or student (ERD §15 rule 19). Sessions: ${sessionIds.join(', ')}`,
    );
    this.name = 'SessionsKeptAtPreviousInstants';
    this.sessionIds = sessionIds;
  }
}

/** The run's two steps on its transaction. */
export interface ReresolutionSteps {
  /** Defers the two overlap constraints to the commit; the transaction's first statement. */
  defer(tx: Transaction): Promise<void>;
  /** Recomputes every scheduled session's instants, restoring those that would overlap. */
  reresolve(tx: Transaction): Promise<Reresolution>;
}

/** The steps over the kernel's helper and sessions' and booking's entries (R-API-6). */
export const reresolutionSteps: ReresolutionSteps = {
  defer: withDeferredSessionConstraints,
  reresolve: (tx) =>
    reresolveScheduledSessions(tx, {
      store: reresolutionStore,
      lengthsOf: sessionLengthsOf,
      pageSize: RERESOLUTION_PAGE_SIZE,
      clock: clockTimestamp,
    }),
};

export interface ReresolveSessionInstantsOptions {
  readonly database: Pick<Database, '$transaction'>;
  /** The kernel's record of the last run (`jobRunsOver`). */
  readonly runs: JobRuns;
  /** Reads `idempotency_key_ttl_hours` for the recorded run's expiry. */
  readonly settings: SettingsReader;
  readonly steps?: ReresolutionSteps;
  /** The runtime's time zone data version; `process.versions.tz` unless a spec sets one. */
  readonly tzVersion?: () => string | undefined;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The clock; the system clock unless a spec sets one. */
  readonly clock?: () => Date;
}

/**
 * Whether `error` is the commit refused by one of the two overlap constraints. Only that refusal
 * is rerun inside the job. A `40P01` deadlock at the deferred commit, against a generation insert
 * of an overlapping session, is not: it leaves the run, and the queue's retry runs the job again.
 */
function refusedByOverlap(error: unknown): boolean {
  return (
    isExclusionViolation(error, 'sessions_teacher_no_overlap') ||
    isExclusionViolation(error, 'sessions_student_no_overlap')
  );
}

/** The run on one transaction, rerun while a concurrent write refuses its commit. */
async function committedRun(
  database: Pick<Database, '$transaction'>,
  steps: ReresolutionSteps,
): Promise<Reresolution> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.$transaction(
        async (tx) => {
          await steps.defer(tx);
          return steps.reresolve(tx);
        },
        { timeout: RERESOLUTION_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      if (attempt < RERESOLUTION_ATTEMPTS && refusedByOverlap(error)) continue;
      throw error;
    }
  }
}

export function reresolveSessionInstants({
  database,
  runs,
  settings,
  steps = reresolutionSteps,
  tzVersion = () => process.versions.tz,
  report = reportError,
  clock = () => new Date(),
}: ReresolveSessionInstantsOptions): Job {
  return defineJob({
    name: RERESOLVE_SESSION_INSTANTS,
    payload: z.object({}),
    schedule: DAILY,
    run: async () => {
      const version = tzVersion();
      if (version === undefined) {
        throw new Error('The runtime names no time zone data version (process.versions.tz)');
      }
      if ((await runs.lastKey(TZDATA_RERESOLVE_SCOPE, clock())) === version) return;
      const hours = await settings.read(IDEMPOTENCY_RETENTION_SETTING, retentionHours);

      const { restored } = await committedRun(database, steps);

      if (restored.length > 0) report(new SessionsKeptAtPreviousInstants(version, restored));
      // 005:T017 (R-407): no reminder is rescheduled here; `send-reminder` reads the committed
      // instants, so the moved sessions are reminded from their new starts (ADR 0009 D3).
      await runs.record({
        scope: TZDATA_RERESOLVE_SCOPE,
        key: version,
        expiresAt: new Date(addHours(clock(), hours)),
      });
    },
  });
}
