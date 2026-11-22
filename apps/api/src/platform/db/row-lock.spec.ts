// T126 — the kernel's row lock without a database: the one statement each table is locked with, its
// ids as one bound array, the order that keeps two callers from deadlocking, and no statement for no
// ids. The lock against Postgres, as the application role, with a second transaction seen waiting on
// it, is `tests/db-integrity/account-locks.spec.ts`; a kernel spec may not write the identity
// module's rows the lock needs (R-API-6, `api/table-ownership`).
//
// T005 widens the union to `availability_slots` and `enrollments` and adds the advisory lock of a
// scope and an id (R-206). Without a database: the statements. Against Postgres, as the application
// role (T124: skipped unless IJAZAH_DB_SPECS=1): the two new tables' statement is accepted, and a
// second caller of the advisory lock waits for the first and goes on once it commits or rolls back,
// seen waiting by `pg_stat_activity` as `booking-concurrency.spec.ts` stages a race, so the order is
// the database's, not timing's. The advisory lock needs no row, so these specs write none.
//
// T033 widens the union to `slot_holds` and `payments` (B29's conflict check, the owner's decision
// of 2026-11-03): their statements, and against Postgres that the application role may run them.
//
// T077 of specs/004-sessions (Q-R4 (a); contracts/kernel.md, the kept data's row) widens it to
// `verification_documents`, after `teacher_profiles`: its statement, and that the role may run it.
//
// B46 of specs/005-certification (Q3 (a); contracts/kernel.md, the ijazah request's row) widens it to
// `ijazah_requests` and `ijazahs`, after `payments`: their statements, and that the role may run them.
//
// B46 lane A (T006; the owner's Q-A1 (a), 2026-11-17) widens it to `teacher_credentials`, between
// `payments` and `ijazah_requests`: the send's chain read locks the approved credential it freezes.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from './prisma.repository.js';
import {
  type KeySharedTable,
  keyShareRows,
  type LockedTable,
  type LockScope,
  lockKey,
  lockRows,
} from './row-lock.js';
import { specDatabaseUrl } from './spec-database.fixtures.js';

interface Sent {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A transaction that records each tagged raw statement it is handed, and answers no rows. */
function recordingTransaction(): { readonly tx: Transaction; readonly sent: Sent[] } {
  const sent: Sent[] = [];
  const record = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    sent.push({ text: strings.join('$'), values });
    return [];
  };
  const tx = { $queryRaw: record, $executeRaw: record } as unknown as Transaction;
  return { tx, sent };
}

const IDS = ['0199d0a0-0000-7000-8000-000000000002', '0199d0a0-0000-7000-8000-000000000001'];

describe('lockRows (T126, T005)', () => {
  it.each<LockedTable>([
    'users',
    'teacher_profiles',
    // T077 of specs/004-sessions (Q-R4 (a)): a deleted teacher's kept documents, after the profile.
    'verification_documents',
    'availability_slots',
    'slot_holds',
    'enrollments',
    'sessions',
    'session_remedies',
    'cancellation_requests',
    'disputes',
    'payments',
    // B46 lane A (T006, Q-A1 (a)): the credential a request freezes, before the request.
    'teacher_credentials',
    // B46 (specs/005-certification, Q3 (a); contracts/kernel.md, the ijazah row): a request, then its ijazah, after the payments.
    'ijazah_requests',
    'ijazahs',
  ])(
    'locks the rows of %s by id, in id order, FOR UPDATE, the ids bound as one uuid array',
    async (table) => {
      const { tx, sent } = recordingTransaction();
      await lockRows(tx, table, IDS);
      expect(sent).toEqual([
        {
          text: `SELECT 1 FROM ${table} WHERE id = ANY($::uuid[]) ORDER BY id FOR UPDATE`,
          values: [IDS],
        },
      ]);
    },
  );

  // 006:T006 of specs/006-programme (the owner's approval of 2026-11-22; kernel.md, the confirm
  // step's row): a programme is keyed by its enrollment, after the holds and before the enrollments.
  it('locks the rows of programmes by enrollment id, in that order, FOR UPDATE, the ids bound as one uuid array', async () => {
    const { tx, sent } = recordingTransaction();
    await lockRows(tx, 'programmes', IDS);
    expect(sent).toEqual([
      {
        text: 'SELECT 1 FROM programmes WHERE enrollment_id = ANY($::uuid[]) ORDER BY enrollment_id FOR UPDATE',
        values: [IDS],
      },
    ]);
  });

  it('sends no statement for no ids', async () => {
    const { tx, sent } = recordingTransaction();
    await lockRows(tx, 'users', []);
    expect(sent).toEqual([]);
  });
});

describe('keyShareRows (T002 of specs/004-sessions, H1)', () => {
  it('key-shares the accounts by id, in id order, FOR KEY SHARE, the ids bound as one uuid array', async () => {
    const { tx, sent } = recordingTransaction();
    await keyShareRows(tx, 'users', IDS);
    expect(sent).toEqual([
      {
        text: 'SELECT 1 FROM users WHERE id = ANY($::uuid[]) ORDER BY id FOR KEY SHARE',
        values: [IDS],
      },
    ]);
  });

  it('sends no statement for no ids, and takes a table from the closed union only', async () => {
    const { tx, sent } = recordingTransaction();
    await keyShareRows(tx, 'users', []);
    expect(sent).toEqual([]);
    // @ts-expect-error T002: `KeySharedTable` is `users` only
    const outside: KeySharedTable = 'sessions';
    expect(outside).toBe('sessions');
  });
});

describe('lockKey (T005, R-206)', () => {
  it('takes the transaction-scoped advisory lock of the scope and the id, each hashed, both bound', async () => {
    const { tx, sent } = recordingTransaction();
    await lockKey(tx, 'teacher-slots', IDS[0] ?? '');
    expect(sent).toEqual([
      {
        text: 'SELECT pg_advisory_xact_lock(hashtext($), hashtext($))',
        values: ['teacher-slots', IDS[0]],
      },
    ]);
  });

  it('takes a scope from the closed union only', () => {
    const scopes: LockScope[] = ['teacher-slots'];
    // @ts-expect-error T005: a scope outside the closed union does not compile
    const outside: LockScope = 'teacher-packages';
    expect(scopes).not.toContain(outside);
  });
});

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

class RolledBack extends Error {}

// T124: skipped unless IJAZAH_DB_SPECS=1.
describe(
  'the locks against Postgres, as the application role (T005)',
  { tags: ['database'] },
  () => {
    let database: Database;
    beforeAll(() => {
      database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
        poolMax: 4,
        statementTimeoutMs: 30_000,
        idleInTransactionTimeoutMs: 30_000,
      });
    });
    afterAll(async () => {
      await closeDatabase(database);
    });

    /** Resolves once backend `pid` waits on an advisory lock; fails after about two seconds. */
    async function seenWaitingOnAdvisoryLock(pid: number): Promise<void> {
      for (let look = 0; look < 100; look += 1) {
        const rows = await database.$queryRaw<{ waiting: boolean }[]>`
        SELECT wait_event_type = 'Lock' AND wait_event = 'advisory' AS waiting
          FROM pg_stat_activity WHERE pid = ${pid}`;
        if (rows[0]?.waiting === true) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`backend ${String(pid)} never waited on an advisory lock`);
    }

    /**
     * A transaction that takes the lock of `id` and stays open until released, then commits, or rolls
     * back by throwing; `held` resolves once it holds the lock, `ended` once it has ended.
     */
    function first(id: string, ending: 'commit' | 'rollback', log: string[]) {
      let release = (): void => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let hold = (): void => undefined;
      const holding = new Promise<void>((resolve) => {
        hold = resolve;
      });
      const ended = database
        .$transaction(async (tx) => {
          await lockKey(tx, 'teacher-slots', id);
          hold();
          await released;
          if (ending === 'rollback') throw new RolledBack();
        }, OPTIONS)
        .catch((thrown: unknown) => {
          if (!(thrown instanceof RolledBack)) throw thrown;
        })
        .then(() => void log.push(`first ${ending === 'commit' ? 'committed' : 'rolled back'}`));
      // A first transaction that fails before it holds is reported, not left waiting.
      return { held: Promise.race([holding, ended]), ended, release };
    }

    /** A transaction that takes the lock of `id`; `pid` resolves with its backend once it has begun. */
    function second(id: string, log: string[]) {
      let begun = (_pid: number): void => undefined;
      const pid = new Promise<number>((resolve) => {
        begun = resolve;
      });
      const ended = database.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        begun(row?.pid ?? 0);
        await lockKey(tx, 'teacher-slots', id);
        log.push('second locked');
      }, OPTIONS);
      return { pid, ended };
    }

    it.each<LockedTable>([
      'availability_slots',
      'slot_holds',
      'enrollments',
      'payments',
      // T077 of specs/004-sessions (Q-R4 (a)).
      'verification_documents',
      // B46 lane A (T006, Q-A1 (a)).
      'teacher_credentials',
      // B46 of specs/005-certification (Q3 (a)).
      'ijazah_requests',
      'ijazahs',
    ])('lockRows on %s is a statement the application role may run', async (table) => {
      await expect(
        database.$transaction((tx) => lockRows(tx, table, [randomUUID()]), OPTIONS),
      ).resolves.toBeUndefined();
    });

    it.each(['commit', 'rollback'] as const)(
      'a second caller of the same scope and id waits on the first, and goes on once it ends at %s',
      async (ending) => {
        const id = randomUUID();
        const log: string[] = [];
        const a = first(id, ending, log);
        await a.held;
        const b = second(id, log);
        try {
          // Seen waiting while the first holds: the two serialise.
          await seenWaitingOnAdvisoryLock(await b.pid);
        } finally {
          a.release();
        }
        // The second takes the lock once the first ends (it would wait out its timeout otherwise).
        // Which client hears first after the end is the network's, so the log's order is not asserted.
        await Promise.all([a.ended, b.ended]);
        expect(new Set(log)).toEqual(
          new Set([`first ${ending === 'commit' ? 'committed' : 'rolled back'}`, 'second locked']),
        );
      },
    );

    it('a caller of another id does not wait on the first', async () => {
      const log: string[] = [];
      const a = first(randomUUID(), 'commit', log);
      await a.held;
      try {
        await second(randomUUID(), log).ended;
      } finally {
        a.release();
      }
      await a.ended;
      expect(log).toEqual(['second locked', 'first committed']);
    });
  },
);
