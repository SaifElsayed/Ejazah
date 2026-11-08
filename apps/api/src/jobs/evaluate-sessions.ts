// T014 of specs/004-sessions/tasks.md (FR-441, FR-446, FR-447, FR-450, FR-482, FR-495; R-SESS-2,
// R-SESS-3, R-SESS-6; research R-306, R-308, R-313, R-323 GAP-7; contracts/kernel.md, "Jobs"): the
// `evaluate-sessions` sweep, every minute, registered by `worker.ts` through `scheduleSweeps`
// (`queue.upsertJobScheduler` under its name, as every sweep is).
//
// Each run ends, first, the room of every cancelled session still inside its join period that has
// no `room_ended` row (`endRoom` alone, one `video room ended` line `{ sessionId }` per call), then
// settles every session whose scheduled end plus `session_evaluation_delay_minutes` has passed by
// the database's clock, each in its own transaction under the enrollment's and the session's locks,
// with T015's completion check: sessions' evaluation (`modules/sessions/evaluation.service.ts`),
// whose head holds the rules. The rooms come first: a cancelled session's participant leaves the
// room within the sweep's minute (FR-482), however many sessions are due.
//
// Run twice, it leaves what one run leaves (R-API-14): a session is settled once, by the
// `evaluated_at` guard read under its locks, with one `settled` row; a room ended stays ended, a
// second `endRoom` changing nothing; no enrollment is ended, since no count is checked (R-322).
import { z } from 'zod';

import {
  type Completion,
  createEvaluation,
  type EnrollmentSide,
  type Evaluation,
  type EvaluationStore,
} from '../modules/sessions/index.js';
import type { Database } from '../platform/db/prisma.repository.js';
import { transactionsOver } from '../platform/db/transaction.repository.js';
import type { Logger } from '../platform/logging/logger.js';
import type { VideoPort } from '../platform/ports/video/video.port.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const EVALUATE_SESSIONS = 'evaluate-sessions';

/** Every minute (R-306): a session is settled within the delay plus one minute (SC-403). */
export const EVERY_MINUTE = '* * * * *';

/** How many due sessions are read at a time. */
export const EVALUATION_PAGE_SIZE = 200;

/** What the job's evaluation is built over, in `worker.ts`. */
export interface EvaluateSessionsDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  /** Sessions' `EnrollmentSide`, bound to booking's `createEnrollmentSide({ settings })`. */
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  /** Sessions' `createCompletion({ enrollments, settings, log })` (T015). */
  readonly completion: Completion;
  readonly video: Pick<VideoPort, 'endRoom'>;
  readonly log: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The evaluation's store; the module's unless a spec narrows it to its own rows. */
  readonly store?: EvaluationStore;
}

function evaluationOver({
  database,
  settings,
  enrollments,
  completion,
  video,
  log,
  report,
  store,
}: EvaluateSessionsDependencies): Evaluation {
  return createEvaluation({
    transactions: transactionsOver(database),
    enrollments,
    completion,
    video,
    settings,
    log,
    pageSize: EVALUATION_PAGE_SIZE,
    ...(report === undefined ? {} : { report }),
    ...(store === undefined ? {} : { store }),
  });
}

export function evaluateSessions(
  options: EvaluateSessionsDependencies | { readonly evaluation: Evaluation },
): Job {
  const evaluation = 'evaluation' in options ? options.evaluation : evaluationOver(options);
  return defineJob({
    name: EVALUATE_SESSIONS,
    payload: z.object({}),
    schedule: EVERY_MINUTE,
    run: async () => {
      await evaluation.endCancelledRooms();
      await evaluation.settleDue();
    },
  });
}
