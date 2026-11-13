// T002 of specs/004-sessions/tasks.md — a deadlock retried once (the owner's decision of 2026-11-06
// on the sixth analysis, L5; contracts/kernel.md, "Locks and refusals"; research R-321).
//
// `runRetryingDeadlockOnce` runs the work through `Transactions.run`; a first deadlock runs it once
// more in a new transaction, a second throws the caller's refusal, anything else is rethrown as it
// came, and there is never a third run. Every deadlock writes one `warn` line, `{ operation,
// attempt, ...ids }`, and the refusal one more, `{ operation, attempts: 2, ...ids }`: no other
// field, never the error's text. The deadlock is the adapter's error as the database spec recorded
// it (`tests/db-integrity/db-errors.spec.ts`); without a database here, a stand-in of its shape.
import { describe, expect, it } from 'vitest';

import type { Transaction } from './prisma.repository.js';
import {
  type DeadlockTrace,
  runRetryingDeadlockOnce,
  type Transactions,
} from './transaction.repository.js';

/** The adapter's deadlock at a statement, under Prisma's `meta`, as a raw write throws it. */
function deadlock(): Error {
  return Object.assign(new Error('Raw query failed. Code: `40P01`.'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '40P01',
          originalMessage: 'deadlock detected',
          kind: 'postgres',
          code: '40P01',
        },
      },
    },
  });
}

class Refused extends Error {}

/** Transactions whose runs answer, in turn, the outcomes given: a value or an error thrown. */
function transactionsAnswering(outcomes: readonly (string | Error)[]): {
  readonly transactions: Transactions;
  readonly runs: () => number;
} {
  let run = 0;
  const transactions: Transactions = {
    run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
      const outcome = outcomes[run];
      run += 1;
      await work({} as Transaction);
      if (outcome instanceof Error) throw outcome;
      return outcome as T;
    },
  };
  return { transactions, runs: () => run };
}

interface Line {
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

function tracing(ids: DeadlockTrace['ids']): {
  readonly trace: DeadlockTrace;
  readonly lines: Line[];
} {
  const lines: Line[] = [];
  return {
    lines,
    trace: {
      log: { warn: (fields, message) => void lines.push({ fields: { ...fields }, message }) },
      operation: 'sessions.remedy.accept',
      ids,
    },
  };
}

const REMEDY = '0199d0a0-0000-7000-8000-0000000000a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';

describe('runRetryingDeadlockOnce (T002, L5)', () => {
  it('one deadlock, then success: two runs, the result, one warn line', async () => {
    const { transactions, runs } = transactionsAnswering([deadlock(), 'booked']);
    const { trace, lines } = tracing({ remedyId: REMEDY });
    await expect(
      runRetryingDeadlockOnce(
        transactions,
        async () => 'unused',
        () => new Refused(),
        trace,
      ),
    ).resolves.toBe('booked');
    expect(runs()).toBe(2);
    expect(lines).toEqual([
      {
        fields: { operation: 'sessions.remedy.accept', attempt: 1, remedyId: REMEDY },
        message: 'Transaction deadlocked',
      },
    ]);
  });

  it('two deadlocks: two runs, the refusal, three warn lines', async () => {
    const { transactions, runs } = transactionsAnswering([deadlock(), deadlock(), 'never']);
    const { trace, lines } = tracing({ enrollmentId: ENROLLMENT });
    await expect(
      runRetryingDeadlockOnce(
        transactions,
        async () => 'unused',
        () => new Refused(),
        trace,
      ),
    ).rejects.toBeInstanceOf(Refused);
    expect(runs()).toBe(2);
    expect(lines).toEqual([
      {
        fields: { operation: 'sessions.remedy.accept', attempt: 1, enrollmentId: ENROLLMENT },
        message: 'Transaction deadlocked',
      },
      {
        fields: { operation: 'sessions.remedy.accept', attempt: 2, enrollmentId: ENROLLMENT },
        message: 'Transaction deadlocked',
      },
      {
        fields: { operation: 'sessions.remedy.accept', attempts: 2, enrollmentId: ENROLLMENT },
        message: 'Refused after a second deadlock',
      },
    ]);
  });

  it('another error: one run, that error unchanged, no line', async () => {
    const other = new Error('sessions_teacher_no_overlap');
    const { transactions, runs } = transactionsAnswering([other, 'never']);
    const { trace, lines } = tracing({ remedyId: REMEDY });
    await expect(
      runRetryingDeadlockOnce(
        transactions,
        async () => 'unused',
        () => new Refused(),
        trace,
      ),
    ).rejects.toBe(other);
    expect(runs()).toBe(1);
    expect(lines).toEqual([]);
  });

  it('a deadlock then another error: the other error, unchanged, after one line', async () => {
    const other = new Error('a unique violation');
    const { transactions, runs } = transactionsAnswering([deadlock(), other]);
    const { trace, lines } = tracing({ remedyId: REMEDY });
    await expect(
      runRetryingDeadlockOnce(
        transactions,
        async () => 'unused',
        () => new Refused(),
        trace,
      ),
    ).rejects.toBe(other);
    expect(runs()).toBe(2);
    expect(lines).toHaveLength(1);
  });

  it('each line carries exactly its fields, never an id the caller slipped in beside the closed ones', async () => {
    const { transactions } = transactionsAnswering([deadlock(), deadlock()]);
    const ids = { remedyId: REMEDY, userId: 'a person', statement: 'SELECT 1' };
    const { trace, lines } = tracing(ids as unknown as DeadlockTrace['ids']);
    await expect(
      runRetryingDeadlockOnce(
        transactions,
        async () => 'unused',
        () => new Refused(),
        trace,
      ),
    ).rejects.toBeInstanceOf(Refused);
    expect(lines.map(({ fields }) => Object.keys(fields).sort())).toEqual([
      ['attempt', 'operation', 'remedyId'],
      ['attempt', 'operation', 'remedyId'],
      ['attempts', 'operation', 'remedyId'],
    ]);
  });

  it('hands each run its own transaction, the work run once per attempt', async () => {
    const { transactions } = transactionsAnswering([deadlock(), 'done']);
    const { trace } = tracing({ remedyId: REMEDY });
    let worked = 0;
    await runRetryingDeadlockOnce(
      transactions,
      async () => {
        worked += 1;
        return 'unused';
      },
      () => new Refused(),
      trace,
    );
    expect(worked).toBe(2);
  });

  // T072 of specs/004-sessions (the owner’s word on B42a lane D’s Q-D2, 2026-11-13): a lift names
  // only the account it lifts, so its lines carry that `userId` and nothing else.
  it('a lift’s lines carry the account it names, `userId`, and only it', async () => {
    const { transactions } = transactionsAnswering([deadlock(), deadlock()]);
    const ids = { userId: ENROLLMENT, statement: 'SELECT 1' };
    const { trace, lines } = tracing(ids as unknown as DeadlockTrace['ids']);
    await expect(
      runRetryingDeadlockOnce(
        transactions,
        async () => 'unused',
        () => new Refused(),
        trace,
      ),
    ).rejects.toBeInstanceOf(Refused);
    expect(lines.map(({ fields }) => fields)).toEqual([
      { operation: 'sessions.remedy.accept', attempt: 1, userId: ENROLLMENT },
      { operation: 'sessions.remedy.accept', attempt: 2, userId: ENROLLMENT },
      { operation: 'sessions.remedy.accept', attempts: 2, userId: ENROLLMENT },
    ]);
  });
});
