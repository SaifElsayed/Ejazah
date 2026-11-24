// 006:T015 of specs/006-programme/tasks.md (FR-714, FR-717, FR-721; research R-508, R-509; SRS
// DEC-110, DEC-113; B-P3's conflict check, Q-1 (a), Q-3 (a), Q-8 (a); contracts/jobs.md, the
// `advance-programmes` row; kernel.md, 006:T015's row): the programmes' sweep, every minute,
// registered by `worker.ts` through `scheduleSweeps` (its `006:` block).
//
// EACH RUN, a page at a time (`PROGRAMME_PAGE_SIZE`, by enrollment id): booking's page of the
// programmes the sweep may act on (`awaiting_offer`; `offered` past `pay_by_at`; a monthly `active`
// or `paused` one with a month to pay whose due point is unset or reached), its enrollment
// `confirmed`; those with an open `teacher_suspended` or `student_suspended` case left out (a
// suspension pauses, analyze N-1; every step reads it again under its locks). Then each programme on
// its own, its failure caught, logged by its id and reported, so one programme never stops the run:
// - `awaiting_offer` or `offered`: booking's windows' step (T008's `createProgrammeWindows`): the
//   `no_offer` item, the `pay_blocked` item or the lapse, none while a programme order is payable or
//   paid and not yet processed («pending», A-1; Q-8 (a));
// - `active` or `paused`: booking's month steps (`createProgrammeMonths`). Their survey (no lock)
//   names the month's automatic order to ask about on this minute: the gateway is asked through
//   payments' `inquire` with no lock held (at the order's expiry, then every 10 minutes; a failure's
//   kind on the next minute), its answer recorded by payments through the webhook's own branch; the
//   survey is read again; then each step the survey names (`item`, `retry`, `due`, `pause`), each in
//   a transaction of its own under the programme's row lock; a step that recorded an automatic order
//   hands back its gateway call, which runs here after that step's commit, once, never under a lock
//   (R-509).
//
// ⚠️ AUTOMATIC, every minute: a charge started (due, retry), an inquiry's answer applied, the
// `charge_unknown` item opened or withdrawn, a first failure written, a pause, a lapse. Each writes
// one info line of ids and a reason in its own module (no card detail, no amount, no name).
//
// IDEMPOTENT (R-API-14): every step reads the state it moves from under its lock (an order recorded
// for the month, the failure written, the item open or withdrawn, the programme paused or closed),
// so a second run, or two runs at once, change nothing more; an automatic order's gateway call is
// sent once by payments (the order's id recorded before the payment).
import { z } from 'zod';

import { EVERY_MINUTE } from './expire-cancellation-requests.js';
import { defineJob, type Job } from './job.js';

/** The job's name. */
export const ADVANCE_PROGRAMMES = 'advance-programmes';

/** How many programmes each page of the sweep takes (as `REMEDY_PAGE_SIZE`). */
export const PROGRAMME_PAGE_SIZE = 200;

/** A programme the sweep may act on, as booking's page answers it. */
export interface SweptRow {
  readonly enrollmentId: string;
  readonly state: 'awaiting_offer' | 'offered' | 'active' | 'paused' | 'closed';
}

/** What the sweep runs, bound in `worker.ts` over booking's, moderation's and payments' entries. */
export interface ProgrammeSweep {
  /** Booking's page after `after`, at most `take` (the database's clock). */
  page(after: string | undefined, take: number): Promise<readonly SweptRow[]>;
  /** Of `enrollmentIds`, those with an open suspension case (moderation's, no lock). */
  suspended(enrollmentIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Booking's windows' step, one programme in a transaction of its own. */
  readonly windows: { step(enrollmentId: string): Promise<string> };
  /** Booking's month steps. */
  readonly months: {
    survey(
      enrollmentId: string,
    ): Promise<{ readonly ask: string | null; readonly steps: readonly string[] } | null>;
    step(
      step: string,
      enrollmentId: string,
      context: { readonly askedNoAnswer: boolean },
    ): Promise<{ readonly action: string; readonly charge?: () => Promise<unknown> }>;
  };
  /** Payments' inquiry about an automatic order, with no lock (lane b's `inquire`). */
  inquire(paymentId: string): Promise<string>;
}

export interface AdvanceProgrammesOptions {
  readonly sweep: ProgrammeSweep;
  readonly log: { error(fields: Readonly<Record<string, unknown>>, message: string): void };
  /** Error tracking. */
  readonly report: (error: Error) => void;
  readonly pageSize?: number;
}

const WINDOW_STATES: ReadonlySet<SweptRow['state']> = new Set(['awaiting_offer', 'offered']);
const MONTH_STATES: ReadonlySet<SweptRow['state']> = new Set(['active', 'paused']);

export function advanceProgrammes({
  sweep,
  log,
  report,
  pageSize = PROGRAMME_PAGE_SIZE,
}: AdvanceProgrammesOptions): Job {
  /** One paid programme: the ask, the survey again, then its steps and their calls after commit. */
  async function month(enrollmentId: string): Promise<void> {
    let survey = await sweep.months.survey(enrollmentId);
    if (survey === null) return;
    let askedNoAnswer = false;
    if (survey.ask !== null) {
      askedNoAnswer = (await sweep.inquire(survey.ask)) === 'no_answer';
      survey = await sweep.months.survey(enrollmentId);
      if (survey === null) return;
    }
    for (const step of survey.steps) {
      const done = await sweep.months.step(step, enrollmentId, { askedNoAnswer });
      // The step's transaction has committed: the gateway is called with no lock held (R-509).
      if (done.charge !== undefined) await done.charge();
    }
  }

  async function one({ enrollmentId, state }: SweptRow): Promise<void> {
    try {
      if (WINDOW_STATES.has(state)) await sweep.windows.step(enrollmentId);
      if (MONTH_STATES.has(state)) await month(enrollmentId);
    } catch (error: unknown) {
      log.error({ enrollmentId }, 'A programme step failed');
      report(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return defineJob({
    name: ADVANCE_PROGRAMMES,
    payload: z.object({}),
    schedule: EVERY_MINUTE,
    run: async () => {
      let after: string | undefined;
      for (;;) {
        const page = await sweep.page(after, pageSize);
        const paused = await sweep.suspended(page.map(({ enrollmentId }) => enrollmentId));
        // One programme at a time: each step holds one connection of the pool.
        for (const row of page) {
          if (!paused.has(row.enrollmentId)) await one(row);
        }
        if (page.length < pageSize) return;
        after = page.at(-1)?.enrollmentId;
      }
    },
  });
}
