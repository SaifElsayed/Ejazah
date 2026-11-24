// 006:T015 of specs/006-programme/tasks.md (R-508, R-509; SRS DEC-110, DEC-113; Q-1 (a)) — the
// `advance-programmes` job over a stand-in sweep: every minute, with no payload; a page at a time;
// a suspended programme left out; the windows' step for an unpaid offer, the month steps for a paid
// programme; the gateway asked before the steps and the survey read again after it; a recorded
// order's gateway call made after its step resolved (its commit), never inside it; one programme's
// failure logged by its id and reported, the rest still run; and the double run (R-API-14) over a
// world whose steps read the state they move from.
import { describe, expect, it } from 'vitest';

import { ADVANCE_PROGRAMMES, advanceProgrammes, type ProgrammeSweep } from './advance-programmes.js';
import { runOnceAndTwice } from './double-run.js';
import { EVERY_MINUTE } from './expire-cancellation-requests.js';

const A = '019a4a00-0000-7000-8000-0000000000a1';
const B = '019a4a00-0000-7000-8000-0000000000a2';
const C = '019a4a00-0000-7000-8000-0000000000a3';
const PAYMENT = '019a4a00-0000-7000-8000-0000000000f1';

interface World {
  /** The month's automatic order: none, recorded and unanswered, or answered. */
  order: 'none' | 'recorded' | 'answered';
  calls: string[];
  errors: Error[];
  lines: Readonly<Record<string, unknown>>[];
}

function sweepOf(world: World, change: Partial<ProgrammeSweep> = {}): ProgrammeSweep {
  let inStep = false;
  return {
    page: async (after) => {
      world.calls.push(`page after ${after ?? '-'}`);
      return after === undefined
        ? [
            { enrollmentId: A, state: 'offered' },
            { enrollmentId: B, state: 'active' },
            { enrollmentId: C, state: 'paused' },
          ]
        : [];
    },
    suspended: async () => new Set([C]),
    windows: {
      step: async (enrollmentId) => {
        world.calls.push(`windows ${enrollmentId === A ? 'A' : '?'}`);
        return 'none';
      },
    },
    months: {
      survey: async () => {
        world.calls.push('survey');
        if (world.order === 'recorded') return { ask: PAYMENT, steps: ['item'] };
        return { ask: null, steps: world.order === 'none' ? ['due'] : [] };
      },
      step: async (step) => {
        inStep = true;
        world.calls.push(`step ${step}`);
        try {
          if (step !== 'due' || world.order !== 'none') return { action: 'none' };
          world.order = 'recorded';
          return {
            action: 'due',
            charge: async () => {
              world.calls.push(inStep ? 'charge INSIDE the step' : 'charge after commit');
            },
          };
        } finally {
          inStep = false;
        }
      },
    },
    inquire: async (paymentId) => {
      world.calls.push(`inquire ${paymentId === PAYMENT ? 'the order' : '?'}`);
      world.order = 'answered';
      return 'paid';
    },
    ...change,
  };
}

function jobOver(world: World, change: Partial<ProgrammeSweep> = {}, pageSize?: number) {
  return advanceProgrammes({
    sweep: sweepOf(world, change),
    log: { error: (fields) => world.lines.push(fields) },
    report: (error) => world.errors.push(error),
    ...(pageSize === undefined ? {} : { pageSize }),
  });
}

const fresh = (order: World['order'] = 'none'): World => ({
  order,
  calls: [],
  errors: [],
  lines: [],
});

describe('advance-programmes (006:T015; R-508)', () => {
  it('runs every minute with no payload', () => {
    const job = jobOver(fresh());
    expect([job.name, job.schedule]).toEqual([ADVANCE_PROGRAMMES, EVERY_MINUTE]);
  });

  it('runs the windows’ step for an offer, the month steps for a paid programme, none for a suspended one', async () => {
    const world = fresh();
    await jobOver(world).handle({});
    expect(world.calls).toEqual([
      'page after -',
      'windows A',
      'survey',
      'step due',
      'charge after commit',
    ]);
  });

  it('red first: asks the gateway before the steps, with no step open, and reads the survey again', async () => {
    const world = fresh('recorded');
    await jobOver(world).handle({});
    expect(world.calls.slice(2)).toEqual(['survey', 'inquire the order', 'survey']);
  });

  it('the gateway’s call is made after its step resolved, never inside it', async () => {
    const world = fresh();
    await jobOver(world).handle({});
    expect(world.calls).toContain('charge after commit');
    expect(world.calls).not.toContain('charge INSIDE the step');
  });

  it('pages by the last enrollment id until a short page', async () => {
    const world = fresh();
    await jobOver(world, {}, 3).handle({});
    expect(world.calls.filter((call) => call.startsWith('page'))).toEqual([
      'page after -',
      `page after ${C}`,
    ]);
  });

  it('red first: one programme’s failure is logged by its id and reported; the next still runs', async () => {
    const world = fresh();
    await jobOver(world, {
      windows: {
        step: async () => {
          throw new Error('boom');
        },
      },
    }).handle({});
    expect(world.lines).toEqual([{ enrollmentId: A }]);
    expect(world.errors.map(({ message }) => message)).toEqual(['boom']);
    expect(world.calls).toContain('step due');
  });

  it('double run: the second run records nothing more and calls the gateway no second time (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => fresh(),
      run: async (world) => {
        // The gateway answers nothing about the recorded order: it stays unanswered.
        await jobOver(world, { inquire: async () => 'no_answer' }).handle({});
      },
      observe: (world) => ({
        order: world.order,
        charges: world.calls.filter((call) => call.startsWith('charge')).length,
      }),
    });
    expect(twice).toEqual(once);
    expect(once).toEqual({ order: 'recorded', charges: 1 });
  });
});
