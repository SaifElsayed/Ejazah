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
import { createLogger } from '../platform/logging/logger.js';
import { createAdminContext } from './context.js';
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

/** A fixture administrator surface; every handler writes through the transaction it is handed. */
function surfaceOver(database: FakeDatabase) {
  return createAdminRouter({
    approve: adminProcedure(z.object({ teacherId: z.string() })).mutation(({ input, ctx }) => {
      handlerRan();
      database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
      ctx.audit.record(approval);
      return 'approved';
    }),
    approveUnaudited: adminProcedure(z.object({ teacherId: z.string() })).mutation(
      ({ input, ctx }) => {
        database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
        return 'approved';
      },
    ),
    approveThenRefuse: adminProcedure(z.object({ teacherId: z.string() })).mutation(
      ({ input, ctx }) => {
        database.stage(ctx.tx, { table: 'teacher_approvals', teacherId: input.teacherId });
        ctx.audit.record(approval);
        throw new DomainError('CONFLICT');
      },
    ),
    approveMany: adminProcedure(z.object({ teacherIds: z.array(z.string()) })).mutation(
      ({ input, ctx }) => {
        for (const teacherId of input.teacherIds) {
          database.stage(ctx.tx, { table: 'teacher_approvals', teacherId });
          ctx.audit.record({ ...approval, reason: `batch of ${input.teacherIds.length}` });
        }
        return input.teacherIds.length;
      },
    ),
    viewUnaudited: adminProcedure(z.void()).query(() => 'seen'),
  });
}

function callerOver(database: FakeDatabase, auditWriter: AuditWriter, adminId: string | null) {
  const context = createAdminContext({
    session: adminId === null ? null : { adminId },
    log,
    administration: { transactions: database, auditWriter },
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

describe('the audit writer must be bound before the process starts (T108)', () => {
  it('refuses to start without one', () => {
    expect(() => requireAuditWriter(undefined)).toThrow(AuditWriterUnboundError);
  });

  it('hands back the bound writer', () => {
    const writer = writerOver(new FakeDatabase());
    expect(requireAuditWriter(writer)).toBe(writer);
  });
});
