// B39 (the note under T059 in specs/004-sessions/tasks.md, the owner's decision of 2026-11-11, Q1
// (a)): `IdempotencyService.runOn` claims a key on the caller's transaction, the administrator
// kind's, with `INSERT … ON CONFLICT DO NOTHING`, so a concurrent duplicate waits on the first
// claim and never aborts its own transaction.
//
// Two transactions key one request through the real repository. A claims the key and stays open;
// B is seen waiting on a lock in `pg_stat_activity`; A then commits or rolls back. A is held at two
// points, each probed: inside its effect, after the claim and before `complete`, and after `runOn`
// answered, before its commit (B37's lesson, the follow-up under T021: a probe holds its first path
// at every stage a second path could meet it). What is asserted:
//
//   - A committed: both answer A's outcome, B as a replay; B's effect never ran; one row is stored;
//     and a statement B runs after `runOn` succeeds, so B's transaction was not aborted;
//   - A rolled back: B claims the key, runs its own effect and stores its outcome; one row.
//
// Each probe keys with an actor of its own and removes its rows afterwards.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IdempotentProcedure } from '../../packages/contracts/src/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import { connectAsApplication, type Db } from './harness';

let watcher: Db;
let database: Database;
let service: IdempotencyService<Transaction>;
const actors: string[] = [];

// A keyed procedure of packages/contracts (idempotent-procedures.ts); the actor makes the row ours.
const SCOPE: IdempotentProcedure = 'teacher.application.submit';
const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

beforeAll(async () => {
  watcher = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  service = new IdempotencyService({
    store: new IdempotencyRepository(database),
    settings: { read: async (_key, schema) => schema.parse(24) },
  });
});

afterAll(async () => {
  if (database !== undefined && actors.length > 0) {
    await database.idempotencyKey.deleteMany({ where: { scope: SCOPE, actorId: { in: actors } } });
  }
  await watcher?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** Resolves once backend `pid` waits on a lock; fails after about two seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

type Settled<T> = { readonly value: T } | { readonly thrown: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ value }),
    (thrown: unknown) => ({ thrown }),
  );
}

type Hold = 'inside the effect' | 'after runOn, before the commit';
type Ending = 'commits' | 'rolls back';

class RolledBack extends Error {}

/**
 * A keys `request` and is held at `hold`; B keys the same request and is seen waiting; A then ends
 * as `ending` says. Answers how each ended, what B saw after `runOn`, and how often B's effect ran.
 */
async function race(hold: Hold, ending: Ending) {
  const actorId = randomUUID();
  actors.push(actorId);
  const request = { scope: SCOPE, key: randomUUID(), actorId, input: { slotId: 'slot-9' } };

  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = (): void => undefined;
  const aHeld = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holdHere = async (): Promise<void> => {
    held();
    await released;
  };

  const a = settle(
    database.$transaction(async (tx) => {
      const answer = await service.runOn(tx, request, async () => {
        if (hold === 'inside the effect') await holdHere();
        return { by: 'A' };
      });
      if (hold === 'after runOn, before the commit') await holdHere();
      if (ending === 'rolls back') throw new RolledBack('A rolls back');
      return answer;
    }, OPTIONS),
  );
  await Promise.race([aHeld, a]);

  let bEffects = 0;
  let pidOfB = (_pid: number): void => undefined;
  const bStarted = new Promise<number>((resolve) => {
    pidOfB = resolve;
  });
  const b = settle(
    database.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pidOfB(row?.pid ?? 0);
      const answer = await service.runOn(tx, request, async () => {
        bEffects += 1;
        return { by: 'B' };
      });
      // A statement after the claim: an aborted transaction would refuse it (25P02).
      const [alive] = await tx.$queryRaw<{ alive: number }[]>`SELECT 1 AS alive`;
      return { answer, alive: alive?.alive };
    }, OPTIONS),
  );
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
  }

  return { a: await a, b: await b, bEffects: () => bEffects, actorId };
}

async function storedRows(actorId: string) {
  return database.idempotencyKey.findMany({
    where: { scope: SCOPE, actorId },
    select: { status: true, response: true },
  });
}

describe('two transactions key one request through runOn (B39, the note under T059)', () => {
  it.each<Hold>(['inside the effect', 'after runOn, before the commit'])(
    'A held %s commits: B waits, then replays A’s outcome on a transaction still alive, one row stored',
    async (hold) => {
      const { a, b, bEffects, actorId } = await race(hold, 'commits');

      expect(a).toEqual({ value: { outcome: { by: 'A' }, replayed: false } });
      expect(b).toEqual({ value: { answer: { outcome: { by: 'A' }, replayed: true }, alive: 1 } });
      expect(bEffects()).toBe(0);
      expect(await storedRows(actorId)).toEqual([
        { status: 'completed', response: { outcome: { by: 'A' } } },
      ]);
    },
  );

  it.each<Hold>(['inside the effect', 'after runOn, before the commit'])(
    'A held %s rolls back: B waits, then claims the key and runs its own effect, one row stored',
    async (hold) => {
      const { a, b, bEffects, actorId } = await race(hold, 'rolls back');

      expect(a).toMatchObject({ thrown: expect.any(RolledBack) });
      expect(b).toEqual({ value: { answer: { outcome: { by: 'B' }, replayed: false }, alive: 1 } });
      expect(bEffects()).toBe(1);
      expect(await storedRows(actorId)).toEqual([
        { status: 'completed', response: { outcome: { by: 'B' } } },
      ]);
    },
  );
});
