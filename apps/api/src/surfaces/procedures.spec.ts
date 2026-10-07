// The caller kinds of T107, called in process through the same middleware as over HTTP (FR-047,
// FR-050, R-API-12; contracts/kernel.md "Caller kinds"). Added by Saif's review of PR #43 (m2):
// the 403 branch and the administrator kind's refusal cannot be reached over HTTP until sessions
// are resolved, so they are reached here with a fixture session handed to the context factory.
//
// The administrator case holds only until T108: that task replaces the refusal with the audit
// write, and this case with T099's.
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../platform/logging/logger.js';
import { createAdminContext, createAppContext, type UserSession } from './context.js';
import {
  adminProcedure,
  createAdminCallerFactory,
  createAdminRouter,
  createAppCallerFactory,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  teacherProcedure,
  toErrorShape,
} from './procedures.js';

const log = createLogger({ level: 'fatal' });

const student: UserSession = {
  userId: 'student-1',
  activeRoles: ['student'],
  gender: 'female',
  preferredLanguage: 'en',
};

const user = createAppRouter({
  whoAmI: studentProcedure(z.void()).query(({ ctx }) => ({
    userId: ctx.caller.userId,
    gender: ctx.caller.gender,
  })),
  mySlots: teacherProcedure(z.void()).query(() => 'slots'),
  echo: publicProcedure(z.object({ n: z.number() })).query(({ input, ctx }) => ({
    n: input.n,
    locale: ctx.locale,
  })),
});

const approved = vi.fn(() => 'approved');
const administrator = createAdminRouter({
  approve: adminProcedure(z.object({ teacherId: z.string() })).mutation(approved),
});

const callUser = createAppCallerFactory(user);
const callAdministrator = createAdminCallerFactory(administrator);

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

describe('the caller kinds (T107)', () => {
  it('a student or teacher kind refuses an anonymous caller with 401, before the role check', async () => {
    const anonymous = callUser(createAppContext({ session: null, log }));
    expect(await refusal(() => anonymous.whoAmI())).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(await refusal(() => anonymous.mySlots())).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('a caller without the role active is refused with 403', async () => {
    const caller = callUser(createAppContext({ session: student, log }));
    expect(await refusal(() => caller.mySlots())).toEqual({ status: 403, code: 'FORBIDDEN' });
  });

  it('a caller holding the role reaches the handler with the narrowed caller', async () => {
    const caller = callUser(createAppContext({ session: student, log }));
    expect(await caller.whoAmI()).toEqual({ userId: 'student-1', gender: 'female' });
  });

  it('every kind validates its input before the handler', async () => {
    const caller = callUser(createAppContext({ session: null, log }));
    expect(await caller.echo({ n: 7 })).toEqual({ n: 7, locale: 'ar' });
    expect(await refusal(() => caller.echo({ n: 'seven' } as never))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
  });

  it('a kind cannot be declared without its input schema', () => {
    // @ts-expect-error -- T107: every caller kind requires its input schema
    expect(() => publicProcedure()).toThrow();
  });

  it('the administrator kind refuses an anonymous request with 401', async () => {
    const anonymous = callAdministrator(createAdminContext({ session: null, log }));
    expect(await refusal(() => anonymous.approve({ teacherId: 't1' }))).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('the administrator kind refuses an authenticated administrator before the handler, until T108', async () => {
    const caller = callAdministrator(createAdminContext({ session: { adminId: 'admin-1' }, log }));
    expect(await refusal(() => caller.approve({ teacherId: 't1' }))).toEqual({
      status: 500,
      code: 'INTERNAL',
    });
    expect(approved).not.toHaveBeenCalled();
  });
});
