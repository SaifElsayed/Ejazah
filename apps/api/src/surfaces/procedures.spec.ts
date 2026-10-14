// The caller kinds of T107, called in process through the same middleware as over HTTP (FR-047,
// FR-050, R-API-12; contracts/kernel.md "Caller kinds"). Added by Saif's review of PR #43 (m2):
// the 403 branch and the administrator kind's refusal cannot be reached over HTTP until sessions
// are resolved, so they are reached here with a fixture session handed to the context factory.
//
// The administrator kind's audited call is T099's, in admin-procedure.spec.ts (T108 replaced the
// refusal this file held until then); here only its 401 is reached.
//
// T169 (review finding SEC-3, owner's decision 2026-10-10): every kind takes `{ input, output }`
// and applies both parsers, so a procedure cannot be declared without an output schema, zod strips
// what the schema does not name before it leaves, and an output that fails its schema is the
// internal error, unexpected, never a 400 carrying the response's own paths.
import { type AnyProcedure, TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import { DomainError } from '../platform/errors/domain-error.js';
import {
  defaultRateLimits,
  type RateLimitCounter,
  RateLimiter,
} from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
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

const secret = 'date-of-birth-1990-01-01';

/** A limiter over an in-memory counter and one settings row per key (T170). */
function limiterOf(limit: number): { limiter: RateLimiter; counter: RateLimitCounter & { hits: number } } {
  const settings: SettingsReader = {
    read: async (key, schema) => {
      if (!key.startsWith('rate_limit_')) throw new SettingError(key, 'missing');
      return schema.parse({ limit, window_seconds: 60 });
    },
  };
  const counts = new Map<string, number>();
  const counter = {
    hits: 0,
    hit: async (key: string) => {
      counter.hits += 1;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    },
  };
  return { limiter: new RateLimiter({ settings, counter, subjectKey: Buffer.alloc(32, 1) }), counter };
}

const { limiter: rateLimiter } = limiterOf(1_000);

/** A public procedure's declaration where the case is not about limiting. */
const unlimitedInTest = { key: defaultRateLimits.search, subjectOf: () => 'anyone' } as const;

const user = createAppRouter({
  whoAmI: studentProcedure({
    input: z.void(),
    output: z.object({ userId: z.string(), gender: z.enum(['male', 'female']) }),
  }).query(({ ctx }) => ({
    userId: ctx.caller.userId,
    gender: ctx.caller.gender,
    // A field the output schema does not name: stripped before it leaves (R-HONEST-4).
    dateOfBirth: secret,
  })),
  mySlots: teacherProcedure({ input: z.void(), output: z.string() }).query(() => 'slots'),
  echo: publicProcedure({
    input: z.object({ n: z.number() }),
    output: z.object({ n: z.number(), locale: z.string() }),
    rateLimit: unlimitedInTest,
  }).query(({ input, ctx }) => ({ n: input.n, locale: ctx.locale })),
  // A handler whose result fails its own output schema.
  broken: publicProcedure({
    input: z.void(),
    output: z.object({ count: z.number() }),
    rateLimit: unlimitedInTest,
  }).query(() => ({ count: 'seven' }) as unknown as { count: number }),
});

const approved = vi.fn(() => 'approved');
// An anonymous call is refused before a transaction is opened, so neither part is reached.
const administration = {
  transactions: { run: () => Promise.reject(new Error('no transaction is expected here')) },
  auditWriter: { write: () => Promise.reject(new Error('no audit write is expected here')) },
};
const administrator = createAdminRouter({
  approve: adminProcedure({
    input: z.object({ teacherId: z.string() }),
    output: z.string(),
  }).mutation(approved),
});

const callUser = createAppCallerFactory(user);
const callAdministrator = createAdminCallerFactory(administrator);

/** The kernel's answer to a failed call, as the surface would send it. */
async function refusal(
  call: () => Promise<unknown>,
): Promise<{ status: number; code: string; details: unknown; unexpected: boolean }> {
  try {
    await call();
  } catch (error: unknown) {
    if (!(error instanceof TRPCError)) throw error;
    const { status, body, unexpected } = toErrorShape(error);
    return { status, code: body.code, details: body.details, unexpected };
  }
  throw new Error('the call was expected to be refused');
}

describe('the caller kinds (T107)', () => {
  it('a student or teacher kind refuses an anonymous caller with 401, before the role check', async () => {
    const anonymous = callUser(createAppContext({ session: null, log, rateLimiter }));
    expect(await refusal(() => anonymous.whoAmI())).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(await refusal(() => anonymous.mySlots())).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('a caller without the role active is refused with 403', async () => {
    const caller = callUser(createAppContext({ session: student, log, rateLimiter }));
    expect(await refusal(() => caller.mySlots())).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('a caller holding the role reaches the handler with the narrowed caller', async () => {
    const caller = callUser(createAppContext({ session: student, log, rateLimiter }));
    expect(await caller.whoAmI()).toEqual({ userId: 'student-1', gender: 'female' });
  });

  it('every kind validates its input before the handler', async () => {
    const caller = callUser(createAppContext({ session: null, log, rateLimiter }));
    expect(await caller.echo({ n: 7 })).toEqual({ n: 7, locale: 'ar' });
    expect(await refusal(() => caller.echo({ n: 'seven' } as never))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      unexpected: false,
    });
  });

  it('a kind cannot be declared without its input schema', () => {
    // @ts-expect-error -- T107: every caller kind requires its input schema
    expect(() => publicProcedure({ output: z.void(), rateLimit: unlimitedInTest })).toThrow();
  });

  it('the administrator kind refuses an anonymous request with 401, and carries no limiter', async () => {
    const anonymous = callAdministrator(createAdminContext({ session: null, log, administration }));
    expect(await refusal(() => anonymous.approve({ teacherId: 't1' }))).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(approved).not.toHaveBeenCalled();
  });
});

describe('every kind applies its output schema (T169, R-HONEST-4, R-API-9)', () => {
  it('a kind cannot be declared without its output schema', () => {
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => publicProcedure({ input: z.void(), rateLimit: unlimitedInTest })).toThrow();
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => studentProcedure({ input: z.void() })).toThrow();
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => teacherProcedure({ input: z.void() })).toThrow();
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => adminProcedure({ input: z.void() })).toThrow();
    // @ts-expect-error -- T107, T169: a kind takes its two schemas, not a bare input
    expect(() => publicProcedure(z.void())).toThrow();
  });

  it('parses the handler’s result through it, so a field the schema does not name is stripped', async () => {
    const caller = callUser(createAppContext({ session: student, log, rateLimiter }));
    const answer = await caller.whoAmI();
    expect(answer).toEqual({ userId: 'student-1', gender: 'female' });
    expect(JSON.stringify(answer)).not.toContain(secret);
    expect(JSON.stringify(answer)).not.toContain('dateOfBirth');
  });

  it('answers an output that fails its schema as the internal error, unexpected, never 400 with the response’s paths', async () => {
    const caller = callUser(createAppContext({ session: null, log, rateLimiter }));
    const answer = await refusal(() => caller.broken());
    expect(answer).toEqual({ status: 500, code: 'INTERNAL', details: undefined, unexpected: true });
  });

  it('maps a ZodError by the code tRPC wrapped it under: a failed output is internal, a failed input is validation', () => {
    // The error as a parser raises it, which is what tRPC wraps.
    const { error: issue } = z.object({ count: z.number() }).safeParse({ count: 'seven' });
    expect(issue).toBeInstanceOf(ZodError);
    const output = toErrorShape(
      new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Output validation failed',
        cause: issue,
      }),
    );
    expect(output.status).toBe(500);
    expect(output.body).toEqual({
      code: 'INTERNAL',
      message: 'Something went wrong. Try again later.',
    });
    expect(output.unexpected).toBe(true);

    const input = toErrorShape(new TRPCError({ code: 'BAD_REQUEST', cause: issue }));
    expect(input.status).toBe(400);
    expect(input.body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid.',
      details: [{ path: 'count', code: 'invalid_type' }],
    });
    expect(input.unexpected).toBe(false);
  });

  it('still maps a DomainError thrown by a handler by the error, whatever code tRPC wrapped it under', () => {
    const wrapped = toErrorShape(
      new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: new DomainError('NOT_FOUND') }),
    );
    expect(wrapped.status).toBe(404);
    expect(wrapped.body.code).toBe('NOT_FOUND');
    expect(wrapped.unexpected).toBe(false);
  });
});

describe('a rate limit is declared on the kind (T170, FR-043, R-SEC-6)', () => {
  it('a public kind without a declaration is a type error, and does not build', () => {
    // @ts-expect-error -- T170: an anonymous endpoint declares its rate limit (R-SEC-6)
    expect(() => publicProcedure({ input: z.void(), output: z.string() })).toThrow(/rate limit/);
  });

  it('applies a declared limit before the handler, from the limiter the context carries', async () => {
    const handler = vi.fn(() => 'sent');
    const limited = createAppRouter({
      requestCode: publicProcedure({
        input: z.object({ phone: z.string() }),
        output: z.string(),
        rateLimit: { key: defaultRateLimits.oneTimeCode, subjectOf: ({ input }) => input.phone },
      }).mutation(handler),
      mine: studentProcedure({
        input: z.void(),
        output: z.string(),
        rateLimit: { key: defaultRateLimits.search, subjectOf: ({ ctx }) => ctx.caller.userId },
      }).query(() => 'mine'),
    });
    const { limiter, counter } = limiterOf(1);
    const call = createAppCallerFactory(limited);
    const anonymous = call(createAppContext({ session: null, log, rateLimiter: limiter }));
    const signedIn = call(createAppContext({ session: student, log, rateLimiter: limiter }));

    expect(await anonymous.requestCode({ phone: '+201001234567' })).toBe('sent');
    expect(await refusal(() => anonymous.requestCode({ phone: '+201001234567' }))).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      unexpected: false,
    });
    expect(handler).toHaveBeenCalledTimes(1);

    expect(await signedIn.mine()).toBe('mine');
    expect(await refusal(() => signedIn.mine())).toMatchObject({ status: 429 });
    expect(counter.hits).toBe(4);
  });

  it('stamps the key in the procedure’s meta, beside the surface', () => {
    const limited = createAppRouter({
      search: studentProcedure({
        input: z.void(),
        output: z.string(),
        rateLimit: { key: defaultRateLimits.search, subjectOf: ({ ctx }) => ctx.caller.userId },
      }).query(() => 'results'),
      unlimited: studentProcedure({ input: z.void(), output: z.string() }).query(() => 'free'),
    });
    const metaOf = (path: string) =>
      (limited._def.procedures as Record<string, AnyProcedure>)[path]?._def.meta;
    expect(metaOf('search')).toEqual({ surface: 'app', rateLimit: 'rate_limit_search' });
    expect(metaOf('unlimited')).toEqual({ surface: 'app' });
  });
});
