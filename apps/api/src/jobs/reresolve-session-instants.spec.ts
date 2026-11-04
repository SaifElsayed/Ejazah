// T048 — the `reresolve-session-instants` job (R-210, FR-370, ADR 0009 D3, ERD §15 rule 19), over
// recorded steps. At worker start and daily, it reads the runtime's `process.versions.tz`:
//
//   - the same as the last run's: nothing runs;
//   - another: every scheduled session's instants are recomputed on one transaction whose first
//     statement defers the overlap constraints, the moved sessions that would overlap restored by the
//     run and reported to error tracking after the commit (FR-051), and the version recorded as the
//     last run's only after it (and after the reminders, Phase 4's hook);
//   - a commit refused by a concurrent write (an overlap constraint at the commit) reruns the run;
//     any other failure fails the job for the queue's retry, and the version is not recorded.
//
// Two runs leave what one leaves. The same over the real tables is
// `tests/db-integrity/reresolve-session-instants.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Reresolution } from '../modules/sessions/index.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import type { JobRun, JobRuns } from '../platform/idempotency/job-runs.repository.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import {
  RERESOLUTION_ATTEMPTS,
  RERESOLVE_SESSION_INSTANTS,
  reresolveSessionInstants,
  type ReresolutionSteps,
  SessionsKeptAtPreviousInstants,
  TZDATA_RERESOLVE_SCOPE,
} from './reresolve-session-instants.js';

const NOW = new Date('2026-11-04T08:00:00Z');
const RETENTION_HOURS = 24;
const TX = {} as Transaction;

/** The refusal of a commit by an overlap constraint, as the adapter throws it (T006). */
function refusedAtCommit(): Error {
  return Object.assign(new Error('refused'), {
    name: 'DriverAdapterError',
    cause: {
      originalCode: '23P01',
      originalMessage:
        'conflicting key value violates exclusion constraint "sessions_student_no_overlap"',
    },
  });
}

interface World {
  /** What happened, in order. */
  readonly calls: string[];
  /** Each session's cached hour, by id: what the run recomputes. */
  readonly cached: Map<string, number>;
  /** Each session's hour as the current data resolves it. */
  readonly resolved: ReadonlyMap<string, number>;
  /** The recorded runs. */
  readonly recorded: JobRun[];
  readonly reports: Error[];
  /** Commits refused before one is accepted. */
  refusals: number;
  /** A failure thrown by the run, not a refusal. */
  failure?: Error;
  /** The sessions the run restores. */
  restored: readonly string[];
  readonly transactionOptions: unknown[];
}

function worldOf(values: Partial<Pick<World, 'refusals' | 'failure' | 'restored'>> = {}): World {
  return {
    calls: [],
    cached: new Map([
      ['a', 6],
      ['b', 6],
    ]),
    resolved: new Map([
      ['a', 7],
      ['b', 7],
    ]),
    recorded: [],
    reports: [],
    refusals: 0,
    restored: [],
    transactionOptions: [],
    ...values,
  };
}

function settingsOf(hours: unknown): SettingsReader {
  return {
    async read(key, schema) {
      if (key !== 'idempotency_key_ttl_hours') throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(hours);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function runsOf(world: World, last: string | null = null): JobRuns {
  return {
    async lastKey(scope, now) {
      world.calls.push(`lastKey:${scope}:${now.toISOString()}`);
      return world.recorded.at(-1)?.key ?? last;
    },
    async record(run) {
      world.calls.push(`record:${run.key}`);
      world.recorded.push(run);
    },
  };
}

/** The run's steps over the world: a transaction's writes are kept only when it commits. */
function jobOf(world: World, options: { readonly version?: string; readonly last?: string } = {}) {
  let pending: Map<string, number> | undefined;
  const steps: ReresolutionSteps = {
    async defer() {
      world.calls.push('defer');
    },
    async reresolve(): Promise<Reresolution> {
      world.calls.push('reresolve');
      if (world.failure !== undefined) throw world.failure;
      pending = new Map(world.cached);
      const moved: string[] = [];
      for (const [id, hour] of world.resolved) {
        if (world.restored.includes(id) || pending.get(id) === hour) continue;
        pending.set(id, hour);
        moved.push(id);
      }
      return { moved, restored: world.restored };
    },
  };
  const database = {
    async $transaction<T>(work: (tx: Transaction) => Promise<T>, transactionOptions?: unknown) {
      world.calls.push('transaction');
      world.transactionOptions.push(transactionOptions);
      const answer = await work(TX);
      if (world.refusals > 0) {
        world.refusals -= 1;
        world.calls.push('refused');
        throw refusedAtCommit();
      }
      for (const [id, hour] of pending ?? []) world.cached.set(id, hour);
      world.calls.push('commit');
      return answer;
    },
  };
  return reresolveSessionInstants({
    database: database as never,
    runs: runsOf(world, options.last ?? null),
    settings: settingsOf(RETENTION_HOURS),
    steps,
    tzVersion: () => options.version ?? '2026a',
    report: (error) => {
      world.calls.push('report');
      world.reports.push(error);
    },
    clock: () => NOW,
  });
}

describe('reresolve-session-instants: when it runs (ADR 0009 D3)', () => {
  it('is a sweep under its name, daily, run with no payload', () => {
    const job = jobOf(worldOf());
    expect(job.name).toBe(RERESOLVE_SESSION_INSTANTS);
    expect(job.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it('a version the last run did not have: one transaction, the constraints deferred first, then the version recorded', async () => {
    const world = worldOf();

    await jobOf(world, { version: '2026a', last: '2025b' }).handle({});

    expect(world.calls).toEqual([
      `lastKey:${TZDATA_RERESOLVE_SCOPE}:${NOW.toISOString()}`,
      'transaction',
      'defer',
      'reresolve',
      'commit',
      'record:2026a',
    ]);
    expect(Object.fromEntries(world.cached)).toEqual({ a: 7, b: 7 });
    expect(world.recorded).toEqual([
      {
        scope: TZDATA_RERESOLVE_SCOPE,
        key: '2026a',
        expiresAt: new Date('2026-11-05T08:00:00Z'),
      },
    ]);
    // The whole run holds one transaction past Prisma's five seconds (rule 19).
    expect(world.transactionOptions).toEqual([{ timeout: expect.any(Number) }]);
  });

  it('a first run, no version recorded yet: it runs', async () => {
    const world = worldOf();
    await jobOf(world, { version: '2026a' }).handle({});
    expect(world.calls).toContain('reresolve');
    expect(world.recorded.map(({ key }) => key)).toEqual(['2026a']);
  });

  it('the version of the last run: nothing runs and nothing is recorded', async () => {
    const world = worldOf();

    await jobOf(world, { version: '2026a', last: '2026a' }).handle({});

    expect(world.calls).toEqual([`lastKey:${TZDATA_RERESOLVE_SCOPE}:${NOW.toISOString()}`]);
    expect(Object.fromEntries(world.cached)).toEqual({ a: 6, b: 6 });
  });

  it('refuses to run when the runtime names no time zone data version', async () => {
    const world = worldOf();
    const job = reresolveSessionInstants({
      database: {} as never,
      runs: runsOf(world),
      settings: settingsOf(RETENTION_HOURS),
      tzVersion: () => undefined,
      clock: () => NOW,
    });
    await expect(job.handle({})).rejects.toThrow(/process\.versions\.tz/);
    expect(world.recorded).toEqual([]);
  });
});

describe('reresolve-session-instants: an overlap and a refused commit (ERD §15 rule 19)', () => {
  it('reports the restored sessions once, after the commit, and the rest commits', async () => {
    const world = worldOf({ restored: ['b'] });

    await jobOf(world, { version: '2026a', last: '2025b' }).handle({});

    expect(world.calls.slice(-3)).toEqual(['commit', 'report', 'record:2026a']);
    expect(Object.fromEntries(world.cached)).toEqual({ a: 7, b: 6 });
    const [report] = world.reports;
    expect(report).toBeInstanceOf(SessionsKeptAtPreviousInstants);
    expect(report && (report as SessionsKeptAtPreviousInstants).sessionIds).toEqual(['b']);
    expect(report?.message).toContain('2026a');
    expect(world.reports).toHaveLength(1);
  });

  it('reports nothing when no session was restored', async () => {
    const world = worldOf();
    await jobOf(world, { version: '2026a', last: '2025b' }).handle({});
    expect(world.reports).toEqual([]);
  });

  it('a commit refused by a concurrent write reruns the run, the version recorded once', async () => {
    const world = worldOf({ refusals: 1 });

    await jobOf(world, { version: '2026a', last: '2025b' }).handle({});

    expect(world.calls.filter((call) => call === 'transaction')).toHaveLength(2);
    expect(world.calls.slice(1)).toEqual([
      'transaction',
      'defer',
      'reresolve',
      'refused',
      'transaction',
      'defer',
      'reresolve',
      'commit',
      'record:2026a',
    ]);
    expect(Object.fromEntries(world.cached)).toEqual({ a: 7, b: 7 });
  });

  it(`refused at every one of its ${String(RERESOLUTION_ATTEMPTS)} attempts: it fails for the queue, nothing recorded`, async () => {
    const world = worldOf({ refusals: RERESOLUTION_ATTEMPTS });

    await expect(
      jobOf(world, { version: '2026a', last: '2025b' }).handle({}),
    ).rejects.toMatchObject({ name: 'DriverAdapterError' });

    expect(world.calls.filter((call) => call === 'transaction')).toHaveLength(
      RERESOLUTION_ATTEMPTS,
    );
    expect(world.recorded).toEqual([]);
    expect(Object.fromEntries(world.cached)).toEqual({ a: 6, b: 6 });
  });

  it('any other failure is not rerun: it fails for the queue, nothing recorded or reported', async () => {
    const world = worldOf({ failure: new Error('the database went away') });

    await expect(jobOf(world, { version: '2026a', last: '2025b' }).handle({})).rejects.toThrow(
      'the database went away',
    );

    expect(world.calls.filter((call) => call === 'transaction')).toHaveLength(1);
    expect(world.recorded).toEqual([]);
    expect(world.reports).toEqual([]);
  });
});

describe('reresolve-session-instants is idempotent (R-API-14)', () => {
  it('two runs leave what one leaves', async () => {
    const reading = await runOnceAndTwice({
      world: () => worldOf({ restored: ['b'] }),
      run: (world) => jobOf(world, { version: '2026a', last: '2025b' }).handle({}),
      observe: (world) => ({
        cached: Object.fromEntries(world.cached),
        recorded: world.recorded.at(-1),
        reports: world.reports.map((error) => error.message),
      }),
    });
    expect(reading.twice).toEqual(reading.once);
  });

  it('a second run under another version moves nothing more', async () => {
    const world = worldOf();
    await jobOf(world, { version: '2026a', last: '2025b' }).handle({});
    const after = Object.fromEntries(world.cached);

    await jobOf(world, { version: '2026b' }).handle({});

    expect(Object.fromEntries(world.cached)).toEqual(after);
    expect(world.recorded.map(({ key }) => key)).toEqual(['2026a', '2026b']);
  });
});
