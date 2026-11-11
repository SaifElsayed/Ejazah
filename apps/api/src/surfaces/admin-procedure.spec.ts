// T099 — an administrative action cannot complete without its audit record, because the
// administrator caller kind writes it, and an action whose audit write fails leaves none of its own
// writes behind (FR-049, R-API-12; contracts/kernel.md "Caller kinds").
//
// The procedures are called in process through `createAdminCallerFactory`, the same middleware as
// over HTTP, with a fixture administrator session handed to the context factory, since no
// administrator session is resolved over HTTP yet. The database is an in-memory fake whose
// transactions behave as Postgres's do here: a write is kept only when its transaction commits, and
// a throw anywhere inside leaves nothing. The action's own write and the audit row are staged on the
// transaction object the handler and the audit writer each receive, so "together" is asserted as
// "on the one transaction, committed or discarded as one".
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  type AuditRecord,
  type AuditWriter,
  AuditWriterUnboundError,
  requireAuditWriter,
} from '../platform/audit/audit-writer.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import type { Transactions } from '../platform/db/transaction.repository.js';
import { DomainError } from '../platform/errors/domain-error.js';
import { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { createAdminContext } from './context.js';
import { unusedAdminServices } from './services.fixtures.js';
import {
  adminProcedure,
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from './procedures.js';

const log = createLogger({ level: 'fatal' });

type Row =
  | { readonly table: 'teacher_approvals'; readonly teacherId: string }
  | { readonly table: 'audit_logs'; readonly record: AuditRecord };

/** A database whose transactions keep their writes only on commit. */
class FakeDatabase implements Transactions {
  readonly committed: Row[] = [];
  readonly #pending = new WeakMap<object, Row[]>();
  opened = 0;

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    this.opened += 1;
    const tx = {};
    const staged: Row[] = [];
    this.#pending.set(tx, staged);
    const result = await work(tx as Transaction); // a throw leaves `staged` uncommitted
    this.committed.push(...staged);
    return result;
  }

  /** Writes `row` inside `tx`; anything but an open transaction of this database refuses. */
  stage(tx: Transaction, row: Row): void {
    const staged = this.#pending.get(tx);
    if (staged === undefined) throw new Error('not an open transaction of this database');
    staged.push(row);
  }
}

function writerOver(database: FakeDatabase): AuditWriter {
  return {
    write: async (tx, record) => {
      database.stage(tx, { table: 'audit_logs', record });
    },
  };
}

const failingWriter: AuditWriter = {
  write: async () => {
    throw new Error('audit_logs refused the insert');
  },
};

const approval = {
  action: 'teacher.approve',
  targetType: 'teacher_profile',
  targetId: '0199d0a0-0000-7000-8000-000000000001',
  before: { status: 'pending' },
  after: { status: 'approved' },
} as const;

const handlerRan = vi.fn();

/** A record whose target is of a kind the label renderer knows (T021). */
const disabling = {
  action: 'admin.disable',
  targetType: 'admin',
  targetId: '0199d0a0-0000-7000-8000-000000000007',
  reason: 'left the team',
} as const;

/** A fixture administrator surface; every handler writes through the transaction it is handed. */
function surfaceOver(database: FakeDatabase) {
  const approvalCall = { input: z.object({ teacherId: z.string() }), output: z.string() };
  return createAdminRouter({
    approve: adminProcedure(approvalCall).mutation(({ input, ctx }) => {
      handlerRan();
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      ctx.audit.record(approval);
      return 'approved';
    }),
    approveUnaudited: adminProcedure(approvalCall).mutation(({ input, ctx }) => {
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      return 'approved';
    }),
    approveThenRefuse: adminProcedure(approvalCall).mutation(({ input, ctx }) => {
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      ctx.audit.record(approval);
      throw new DomainError('CONFLICT');
    }),
    approveMany: adminProcedure({
      input: z.object({ teacherIds: z.array(z.string()) }),
      output: z.number(),
    }).mutation(({ input, ctx }) => {
      for (const teacherId of input.teacherIds) {
        database.stage(ctx.tx, { table: 'teacher_approvals', teacherId });
        ctx.audit.record({ ...approval, reason: `batch of ${input.teacherIds.length}` });
      }
      return input.teacherIds.length;
    }),
    viewUnaudited: adminProcedure({ input: z.void(), output: z.string() }).query(() => 'seen'),
    // B39 (the note under T059): a repeat answered from its key's row records no second entry.
    approveReplayed: adminProcedure(approvalCall).mutation(({ ctx }) => {
      ctx.audit.replayed();
      return 'approved';
    }),
    approveRecordedAndReplayed: adminProcedure(approvalCall).mutation(({ input, ctx }) => {
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      ctx.audit.record(approval);
      ctx.audit.replayed();
      return 'approved';
    }),
    disable: adminProcedure(approvalCall).mutation(({ input, ctx }) => {
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      ctx.audit.record(disabling);
      return 'disabled';
    }),
    // T062: an administrator limit of its own, the administrator the kind authenticated as subject.
    restore: adminProcedure({
      ...approvalCall,
      rateLimit: { key: 'rate_limit_enrollment_restore', subject: 'caller' },
    }).mutation(({ input, ctx }) => {
      handlerRan();
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      ctx.audit.record(approval);
      return 'restored';
    }),
    disableUnlabelled: adminProcedure(approvalCall).mutation(({ input, ctx }) => {
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      // A target the renderer refuses: no identifier at all.
      ctx.audit.record({ ...disabling, targetId: '' });
      return 'disabled';
    }),
  });
}

/** A limiter whose every row is `limit` per 60 s, over an in-memory counter (T062). */
function limiterAt(limit: number): RateLimiter {
  const counts = new Map<string, number>();
  return new RateLimiter({
    settings: { read: async (_key, schema) => schema.parse({ limit, window_seconds: 60 }) },
    counter: {
      hit: async (key) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count;
      },
    },
    subjectKey: Buffer.alloc(32, 2),
  });
}

function callerOver(
  database: FakeDatabase,
  auditWriter: AuditWriter,
  adminId: string | null,
  rateLimiter: RateLimiter = limiterAt(1_000),
) {
  const context = createAdminContext({
    // The second factor is verified on every session here; its refusal is T016's, in procedures.spec.ts.
    session: adminId === null ? null : { adminId, sessionId: 'session-1', mfaVerified: true },
    log,
    administration: { transactions: database, auditWriter },
    services: unusedAdminServices,
    rateLimiter,
    clientAddress: '203.0.113.7',
  });
  return createAdminCallerFactory(surfaceOver(database))(context);
}

/** The kernel's answer to a failed call: its status and code, as the surface would send them. */
async function refusal(call: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await call();
  } catch (error: unknown) {
    if (!(error instanceof TRPCError)) throw error;
    const { status, body } = toErrorShape(error);
    return { status, code: body.code };
  }
  throw new Error('the call was expected to be refused');
}

const internal = { status: 500, code: 'INTERNAL' };

describe('the administrator caller kind writes its own audit record (T099, FR-049)', () => {
  it('completes an action with its audit record, both committed together', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1');

    expect(await caller.approve({ teacherId: 't1' })).toBe('approved');

    expect(database.opened).toBe(1);
    expect(database.committed).toEqual([
      { table: 'teacher_approvals', teacherId: 't1' },
      { table: 'audit_logs', record: { adminId: 'admin-1', ...approval } },
    ]);
  });

  it('takes the actor from the server-held session, never from the action', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-7');

    await caller.approve({ teacherId: 't1' });

    expect(database.committed[1]).toEqual({
      table: 'audit_logs',
      record: expect.objectContaining({ adminId: 'admin-7' }),
    });
  });

  it('refuses an action that describes no audit record, and keeps none of its writes', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1');

    expect(await refusal(() => caller.approveUnaudited({ teacherId: 't1' }))).toEqual(internal);
    expect(database.committed).toEqual([]);
  });

  it('refuses a read that describes no audit record as well, so no administrative path is unaudited', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1');

    expect(await refusal(() => caller.viewUnaudited())).toEqual(internal);
    expect(database.committed).toEqual([]);
  });

  it("leaves none of the action's writes behind when the audit write fails", async () => {
    handlerRan.mockClear();
    const database = new FakeDatabase();
    const caller = callerOver(database, failingWriter, 'admin-1');

    expect(await refusal(() => caller.approve({ teacherId: 't1' }))).toEqual(internal);
    expect(handlerRan).toHaveBeenCalledOnce();
    expect(database.committed).toEqual([]);
  });

  it("writes no audit record for an action that failed, and answers with the action's own error", async () => {
    const database = new FakeDatabase();
    const write = vi.fn(writerOver(database).write);
    const caller = callerOver(database, { write }, 'admin-1');

    expect(await refusal(() => caller.approveThenRefuse({ teacherId: 't1' }))).toEqual({
      status: 409,
      code: 'CONFLICT',
    });
    expect(write).not.toHaveBeenCalled();
    expect(database.committed).toEqual([]);
  });

  it('writes every record an action describes, in order, in its one transaction', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1');

    expect(await caller.approveMany({ teacherIds: ['t1', 't2'] })).toBe(2);

    expect(database.opened).toBe(1);
    expect(database.committed.map((row) => row.table)).toEqual([
      'teacher_approvals',
      'teacher_approvals',
      'audit_logs',
      'audit_logs',
    ]);
  });

  // B39 (the note under T059, Q1 (a)): a repeat answered from its idempotency key's row records no
  // entry, the first call's being the record; the kind admits it only when the handler says so. A
  // call that says neither is still refused (the case above).
  it('admits a call that recorded no entry when the handler marks it a replay, writing no audit row', async () => {
    const database = new FakeDatabase();
    const write = vi.fn(writerOver(database).write);
    const caller = callerOver(database, { write }, 'admin-1');

    expect(await caller.approveReplayed({ teacherId: 't1' })).toBe('approved');

    expect(database.opened).toBe(1);
    expect(write).not.toHaveBeenCalled();
    expect(database.committed).toEqual([]);
  });

  it('writes the entries of a call that records them and also marks a replay, as usual', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1');

    expect(await caller.approveRecordedAndReplayed({ teacherId: 't1' })).toBe('approved');

    expect(database.committed).toEqual([
      { table: 'teacher_approvals', teacherId: 't1' },
      { table: 'audit_logs', record: { adminId: 'admin-1', ...approval } },
    ]);
  });

  it('opens no transaction for an anonymous request, refused with 401', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), null);

    expect(await refusal(() => caller.approve({ teacherId: 't1' }))).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(database.opened).toBe(0);
  });

  it('opens no transaction for an input that does not validate, refused with 400', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1');

    expect(await refusal(() => caller.approve({ teacherId: 1 } as never))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(database.opened).toBe(0);
  });
});

// T062 (FR-470; research R-321, items 1 and 2): the administrator kind's own `rateLimit`, applied
// after the administrator and the input are checked and before the kind opens its transaction, and
// the signed-in default where none is declared, so a refused call opens none and writes nothing.
describe('the administrator kind is rate limited before its transaction (T062, FR-470)', () => {
  it('refuses a call over its declared limit RATE_LIMITED, with no transaction opened and nothing written', async () => {
    handlerRan.mockClear();
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1', limiterAt(1));

    expect(await caller.restore({ teacherId: 't1' })).toBe('restored');
    expect(database.opened).toBe(1);
    expect(await refusal(() => caller.restore({ teacherId: 't2' }))).toEqual({
      status: 429,
      code: 'RATE_LIMITED',
    });

    expect(database.opened).toBe(1);
    expect(handlerRan).toHaveBeenCalledOnce();
    expect(database.committed).toEqual([
      { table: 'teacher_approvals', teacherId: 't1' },
      { table: 'audit_logs', record: { adminId: 'admin-1', ...approval } },
    ]);
  });

  it('refuses a call with no limit of its own past the default, with no transaction opened', async () => {
    const database = new FakeDatabase();
    const caller = callerOver(database, writerOver(database), 'admin-1', limiterAt(1));

    expect(await caller.approve({ teacherId: 't1' })).toBe('approved');
    expect(await refusal(() => caller.approve({ teacherId: 't2' }))).toEqual({
      status: 429,
      code: 'RATE_LIMITED',
    });
    expect(database.opened).toBe(1);
  });

  it('stamps the declared key in the procedure’s meta, and none where the default applies', () => {
    const router = surfaceOver(new FakeDatabase());
    const metaOf = (path: string) =>
      (router._def.procedures as Record<string, { _def: { meta?: unknown } }>)[path]?._def.meta;

    expect(metaOf('restore')).toEqual({
      surface: 'admin',
      rateLimit: 'rate_limit_enrollment_restore',
    });
    expect(metaOf('approve')).toEqual({ surface: 'admin' });
  });
});

describe('an empty label rolls the action back (T021, FR-180)', () => {
  /**
   * A writer that refuses as the admin module's does (`modules/admin/audit.repository.ts`, proven
   * in its own spec): the label is rendered from the type and the id before the insert, and a
   * target without an identifier is thrown at, not written. The surfaces may not import the admin
   * module (R-API-3, R-API-4), so the refusal is mirrored here and the kind's answer is the case.
   */
  function labelling(database: FakeDatabase) {
    const inserts: Array<Record<string, unknown>> = [];
    const writer: AuditWriter = {
      write: async (tx, record) => {
        if (record.targetId === '') {
          throw new Error('The audit target label was refused: the identifier is empty (FR-180).');
        }
        inserts.push({ ...record, targetLabel: `مشرف · ${record.targetId}` });
        database.stage(tx, { table: 'audit_logs', record });
      },
    };
    return { writer, inserts };
  }

  it('a labelled action commits with its record', async () => {
    const database = new FakeDatabase();
    const { writer, inserts } = labelling(database);
    await callerOver(database, writer, 'admin-1').disable({ teacherId: 't-1' });
    expect(inserts).toHaveLength(1);
    expect(database.committed).toHaveLength(2);
  });

  it('an empty label rolls the action back: refused before the insert, nothing committed, answered as unexpected', async () => {
    const database = new FakeDatabase();
    const { writer, inserts } = labelling(database);
    const caller = callerOver(database, writer, 'admin-1');
    expect(await refusal(() => caller.disableUnlabelled({ teacherId: 't-2' }))).toEqual({
      status: 500,
      code: 'INTERNAL',
    });
    expect(inserts).toEqual([]);
    expect(database.committed).toEqual([]);
    expect(database.opened).toBe(1);
  });

  it('a handler cannot pass a label', () => {
    // @ts-expect-error -- T021: `AuditEntry.targetLabel` is `never`; the writer renders it.
    const entry: AuditRecord = { ...disabling, adminId: 'admin-1', targetLabel: 'مشرف · typed' };
    expect(entry.targetLabel).toBe('مشرف · typed');
  });
});

describe('the audit writer must be bound before the process starts (T108)', () => {
  it('refuses to start without one', () => {
    expect(() => requireAuditWriter(undefined)).toThrow(AuditWriterUnboundError);
  });

  it('hands back the bound writer', () => {
    const writer = writerOver(new FakeDatabase());
    expect(requireAuditWriter(writer)).toBe(writer);
  });
});

// T061 of specs/004-sessions (L5; research R-321, «The deferred overlap check and a deadlock»;
// contracts/kernel.md, `runRetryingDeadlockOnce` and `adminProcedure`): the kind's optional
// deadlock declaration, which only `sessions.restore` makes. Declared, the call's whole transaction,
// its audit entry with it, runs through T002's `runRetryingDeadlockOnce`: a deadlock at a statement
// (thrown by the handler) or at the commit is retried once in a new transaction, each writing one
// warn line `{ operation, attempt, enrollmentId }`; a second answers the declared refusal with
// nothing kept and one line more. Undeclared, or any other failure, nothing is retried.
describe('the administrator kind retries a declared deadlock once (T061, L5)', () => {
  const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';

  /** The adapter's deadlock refusal, as `db-errors.ts` reads it. */
  const deadlock = () =>
    Object.assign(new Error('deadlock detected'), {
      name: 'DriverAdapterError',
      cause: { originalCode: '40P01', originalMessage: 'deadlock detected' },
    });

  /** Refuses at the commit while `failCommits` lasts, as a deferred check would. */
  class CommitFailingDatabase extends FakeDatabase {
    failCommits = 0;
    override async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      if (this.failCommits === 0) return super.run(work);
      this.failCommits -= 1;
      // The work runs; its commit is refused, so nothing it staged is kept.
      return super.run(async (tx) => {
        await work(tx);
        throw deadlock();
      });
    }
  }

  const call = { input: z.object({ enrollmentId: z.string() }), output: z.string() };
  const declaration = {
    operation: 'sessions.restore',
    ids: (input: { enrollmentId: string }) => ({ enrollmentId: input.enrollmentId }),
    refusal: () =>
      new DomainError('RESTORE_REFUSED', undefined, {
        details: [{ path: 'cause', code: 'time_taken' }],
      }),
  };

  function surfaceFor(database: FakeDatabase, failStatements: { count: number }) {
    return createAdminRouter({
      restore: adminProcedure({ ...call, deadlock: declaration }).mutation(({ input, ctx }) => {
        handlerRan();
        database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.enrollmentId });
        ctx.audit.record(approval);
        if (failStatements.count > 0) {
          failStatements.count -= 1;
          throw deadlock();
        }
        return 'restored';
      }),
      undeclared: adminProcedure(call).mutation(({ input, ctx }) => {
        database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.enrollmentId });
        ctx.audit.record(approval);
        if (failStatements.count > 0) {
          failStatements.count -= 1;
          throw deadlock();
        }
        return 'restored';
      }),
      conflict: adminProcedure({ ...call, deadlock: declaration }).mutation(({ ctx }) => {
        database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: 'x' });
        throw new DomainError('CONFLICT');
      }),
    });
  }

  function callerFor(database: FakeDatabase, failStatements: { count: number }) {
    const lines: Record<string, unknown>[] = [];
    const context = createAdminContext({
      session: { adminId: 'admin-1', sessionId: 'session-1', mfaVerified: true },
      log: createLogger({
        level: 'info',
        destination: { write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) },
      }),
      administration: { transactions: database, auditWriter: writerOver(database) },
      services: unusedAdminServices,
      rateLimiter: limiterAt(1_000),
      clientAddress: '203.0.113.7',
    });
    return {
      lines,
      caller: createAdminCallerFactory(surfaceFor(database, failStatements))(context),
    };
  }

  const deadlockLines = (lines: readonly Record<string, unknown>[]) =>
    lines
      .filter(({ operation }) => operation !== undefined)
      .map(({ operation, attempt, attempts, enrollmentId, msg }) => ({
        operation,
        attempt,
        attempts,
        enrollmentId,
        msg,
      }));

  const line = (attempt: number | undefined, attempts: number | undefined, msg: string) => ({
    operation: 'sessions.restore',
    attempt,
    attempts,
    enrollmentId: ENROLLMENT,
    msg,
  });

  it('retries a deadlock at a statement once in a new transaction, keeping one action and one audit entry', async () => {
    handlerRan.mockClear();
    const database = new FakeDatabase();
    const { caller, lines } = callerFor(database, { count: 1 });
    expect(await caller.restore({ enrollmentId: ENROLLMENT })).toBe('restored');
    expect(handlerRan).toHaveBeenCalledTimes(2);
    expect(database.opened).toBe(2);
    expect(database.committed).toEqual([
      { table: 'teacher_approvals', teacherId: ENROLLMENT },
      { table: 'audit_logs', record: { ...approval, adminId: 'admin-1' } },
    ]);
    expect(deadlockLines(lines)).toEqual([line(1, undefined, 'Transaction deadlocked')]);
  });

  it('retries a deadlock at the commit once', async () => {
    const database = new CommitFailingDatabase();
    database.failCommits = 1;
    const { caller, lines } = callerFor(database, { count: 0 });
    expect(await caller.restore({ enrollmentId: ENROLLMENT })).toBe('restored');
    expect(database.opened).toBe(2);
    expect(database.committed).toHaveLength(2);
    expect(deadlockLines(lines)).toEqual([line(1, undefined, 'Transaction deadlocked')]);
  });

  it('answers a second deadlock the declared refusal, nothing kept, the two deadlock lines and the refusal’s', async () => {
    const database = new FakeDatabase();
    const { caller, lines } = callerFor(database, { count: 2 });
    const thrown: unknown = await caller
      .restore({ enrollmentId: ENROLLMENT })
      .catch((error: unknown) => error);
    const { status, body } = toErrorShape(thrown as TRPCError);
    expect([status, body.code]).toEqual([409, 'RESTORE_REFUSED']);
    expect(body).toMatchObject({ details: [{ path: 'cause', code: 'time_taken' }] });
    expect(database.opened).toBe(2);
    expect(database.committed).toEqual([]);
    expect(deadlockLines(lines)).toEqual([
      line(1, undefined, 'Transaction deadlocked'),
      line(2, undefined, 'Transaction deadlocked'),
      line(undefined, 2, 'Refused after a second deadlock'),
    ]);
  });

  it('does not retry a deadlock on a procedure that declares none', async () => {
    const database = new FakeDatabase();
    const { caller, lines } = callerFor(database, { count: 1 });
    expect(await refusal(() => caller.undeclared({ enrollmentId: ENROLLMENT }))).toEqual(internal);
    expect(database.opened).toBe(1);
    expect(database.committed).toEqual([]);
    expect(deadlockLines(lines)).toEqual([]);
  });

  it('does not retry any other failure of a declared procedure', async () => {
    const database = new FakeDatabase();
    const { caller } = callerFor(database, { count: 0 });
    expect(await refusal(() => caller.conflict({ enrollmentId: ENROLLMENT }))).toEqual({
      status: 409,
      code: 'CONFLICT',
    });
    expect(database.opened).toBe(1);
    expect(database.committed).toEqual([]);
  });
});
