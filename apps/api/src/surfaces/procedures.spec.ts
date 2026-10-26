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
//
// T016 (Phase 1, specs/002-identity/contracts/kernel.md "The caller kinds"): the session carries one
// role and the account's standing, resolved on every request (FR-108). `userProcedure` admits either
// role; `teacherProcedure` declares what it admits (R-106) and a declaration without `admits` does
// not compile; every user kind refuses a suspended or banned account with `ACCOUNT_RESTRICTED`
// unless it says `admitsRestricted` (FR-137); the administrator kind refuses a session whose second
// factor is unverified with `MFA_REQUIRED` (FR-170); `adminPublicProcedure` is anonymous, exists on
// the administrator instance only and names its rate limit, applied from the limiter the
// administrator context carries.
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
import {
  type AdminSession,
  createAdminContext,
  createAppContext,
  type UserSession,
} from './context.js';
import {
  adminProcedure,
  adminPublicProcedure,
  createAdminCallerFactory,
  createAdminRouter,
  createAppCallerFactory,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  teacherProcedure,
  toErrorShape,
  userProcedure,
} from './procedures.js';
import {
  unusedAdminServices,
  unusedIdentityServices,
  unusedVerificationServices,
} from './services.fixtures.js';

const log = createLogger({ level: 'fatal' });
const clientAddress = '203.0.113.7';

const student: UserSession = {
  userId: 'student-1',
  sessionId: 'session-1',
  role: 'student',
  accountStatus: 'active',
  gender: 'female',
  preferredLanguage: 'en',
};

/** A teacher-role holder whose application is still in review: standing `applicant` only. */
const applicant: UserSession = {
  userId: 'teacher-1',
  sessionId: 'session-2',
  role: 'teacher',
  accountStatus: 'active',
  gender: 'female',
  preferredLanguage: 'ar',
  teacher: { verificationStatus: 'pending', payoutVerified: false, applicationStatus: 'in_review' },
};

const approved: UserSession = {
  ...applicant,
  userId: 'teacher-2',
  sessionId: 'session-3',
  teacher: { verificationStatus: 'approved', payoutVerified: false, applicationStatus: 'approved' },
};

const publishable: UserSession = {
  ...approved,
  userId: 'teacher-3',
  sessionId: 'session-4',
  teacher: { verificationStatus: 'approved', payoutVerified: true, applicationStatus: 'approved' },
};

const suspended: UserSession = { ...student, userId: 'student-2', accountStatus: 'suspended' };
const banned: UserSession = { ...student, userId: 'student-3', accountStatus: 'banned' };
const verificationRequired: UserSession = {
  ...student,
  userId: 'student-4',
  accountStatus: 'verification_required',
};

const verifiedAdmin: AdminSession = { adminId: 'admin-1', sessionId: 'session-1', mfaVerified: true };
const unverifiedAdmin: AdminSession = { adminId: 'admin-1', sessionId: 'session-1', mfaVerified: false };

const secret = 'date-of-birth-1990-01-01';

/** A limiter over an in-memory counter and one settings row per key (T170). */
function limiterOf(limit: number): {
  limiter: RateLimiter;
  counter: RateLimitCounter & { hits: number };
} {
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
  return {
    limiter: new RateLimiter({ settings, counter, subjectKey: Buffer.alloc(32, 1) }),
    counter,
  };
}

const { limiter: rateLimiter } = limiterOf(1_000);

// The services the user surface's context carries (T038): nothing here reads one.
const services = {
  settings: {
    read: async () => {
      throw new Error('no setting is read here');
    },
  },
  publicConfig: { supportEmail: 'support@ijazah.invalid' },
  subjects: { listActive: async () => [] },
  identity: unusedIdentityServices,
  verification: unusedVerificationServices,
};

/** The user surface's context for a fixture session, as the HTTP application builds one. */
function appContext(session: UserSession | null, limiter: RateLimiter = rateLimiter) {
  return createAppContext({ session, log, rateLimiter: limiter, clientAddress, services });
}

// An anonymous call, and a call refused before the handler, open no transaction and write nothing.
const administration = {
  transactions: { run: () => Promise.reject(new Error('no transaction is expected here')) },
  auditWriter: { write: () => Promise.reject(new Error('no audit write is expected here')) },
};

/** The administrator surface's context for a fixture session. */
function adminContext(session: AdminSession | null, limiter: RateLimiter = rateLimiter) {
  return createAdminContext({
    session,
    log,
    administration,
    services: unusedAdminServices,
    rateLimiter: limiter,
    clientAddress,
  });
}

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
  mySlots: teacherProcedure({ admits: 'applicant', input: z.void(), output: z.string() }).query(
    () => 'slots',
  ),
  publish: teacherProcedure({ admits: 'approved', input: z.void(), output: z.string() }).query(
    () => 'published',
  ),
  listPackages: teacherProcedure({
    admits: 'publishable',
    input: z.void(),
    output: z.string(),
  }).query(() => 'packages'),
  // What both roles share: the account read, sign-out, deletion (contracts/kernel.md).
  account: userProcedure({
    input: z.void(),
    output: z.object({ userId: z.string(), role: z.enum(['student', 'teacher']) }),
  }).query(({ ctx }) => ({ userId: ctx.caller.userId, role: ctx.caller.role })),
  // The restricted screen's data: a suspended account may still read it (FR-137).
  standing: userProcedure({
    admitsRestricted: true,
    input: z.void(),
    output: z.string(),
  }).query(({ ctx }) => ctx.caller.accountStatus),
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

const approve = vi.fn(() => 'approved');
const signIn = vi.fn(() => 'signed in');
const administrator = createAdminRouter({
  approve: adminProcedure({
    input: z.object({ teacherId: z.string() }),
    output: z.string(),
  }).mutation(approve),
  signIn: adminPublicProcedure({
    input: z.object({ email: z.string() }),
    output: z.string(),
    rateLimit: { key: defaultRateLimits.authentication, subjectOf: ({ input }) => input.email },
  }).mutation(signIn),
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
    const anonymous = callUser(appContext(null));
    expect(await refusal(() => anonymous.whoAmI())).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(await refusal(() => anonymous.mySlots())).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('a caller without the role is refused with 403', async () => {
    const caller = callUser(appContext(student));
    expect(await refusal(() => caller.mySlots())).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    const teacher = callUser(appContext(applicant));
    expect(await refusal(() => teacher.whoAmI())).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('a caller holding the role reaches the handler with the narrowed caller', async () => {
    const caller = callUser(appContext(student));
    expect(await caller.whoAmI()).toEqual({ userId: 'student-1', gender: 'female' });
  });

  it('every kind validates its input before the handler', async () => {
    const caller = callUser(appContext(null));
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

  it('the administrator kind refuses an anonymous request with 401', async () => {
    const anonymous = callAdministrator(adminContext(null));
    expect(await refusal(() => anonymous.approve({ teacherId: 't1' }))).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(approve).not.toHaveBeenCalled();
  });
});

describe('the Phase 1 kinds (T016, FR-108, FR-137, FR-170; contracts/kernel.md)', () => {
  it('`userProcedure` admits either role and refuses an anonymous caller', async () => {
    expect(await callUser(appContext(student)).account()).toEqual({
      userId: 'student-1',
      role: 'student',
    });
    expect(await callUser(appContext(applicant)).account()).toEqual({
      userId: 'teacher-1',
      role: 'teacher',
    });
    expect(await refusal(() => callUser(appContext(null)).account())).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('a teacher kind cannot be declared without `admits`', () => {
    // @ts-expect-error -- T016, R-106: a teacher procedure declares what standing it admits
    expect(() => teacherProcedure({ input: z.void(), output: z.string() })).toThrow(/admits/);
  });

  it("an applicant is refused by `admits: 'approved'`, and an approved teacher by `'publishable'`", async () => {
    const asApplicant = callUser(appContext(applicant));
    expect(await asApplicant.mySlots()).toBe('slots');
    expect(await refusal(() => asApplicant.publish())).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(await refusal(() => asApplicant.listPackages())).toMatchObject({ status: 403 });

    const asApproved = callUser(appContext(approved));
    expect(await asApproved.publish()).toBe('published');
    expect(await refusal(() => asApproved.listPackages())).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });

    expect(await callUser(appContext(publishable)).listPackages()).toBe('packages');
  });

  it("`admits: 'publishable'` refuses an approved teacher whose payout is unverified and admits one whose payout is verified (T076, FR-192)", async () => {
    expect(await refusal(() => callUser(appContext(approved)).listPackages())).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(await callUser(appContext(publishable)).listPackages()).toBe('packages');
  });

  it("`admits: 'publishable'` refuses a verified teacher again once a new payout account is registered, and `'approved'` still admits them (T076, FR-193)", async () => {
    // The standing the resolver reads on the next request after a replacement: the verified instant
    // cleared. The same through the real resolution, over the database: payout.service.spec.ts.
    const replaced: UserSession = {
      ...publishable,
      teacher: {
        verificationStatus: 'approved',
        payoutVerified: false,
        applicationStatus: 'approved',
      },
    };
    const asReplaced = callUser(appContext(replaced));
    expect(await refusal(() => asReplaced.listPackages())).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(await asReplaced.publish()).toBe('published');
  });

  it('a suspended account is refused with `ACCOUNT_RESTRICTED` unless the procedure `admitsRestricted`', async () => {
    for (const session of [suspended, banned]) {
      const caller = callUser(appContext(session));
      const refused = await refusal(() => caller.whoAmI());
      expect(refused).toMatchObject({
        status: 403,
        code: 'ACCOUNT_RESTRICTED',
        details: [{ path: 'accountStatus', code: session.accountStatus }],
        unexpected: false,
      });
      expect(await refusal(() => caller.account())).toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
      // The restricted screen reads its own standing.
      expect(await caller.standing()).toBe(session.accountStatus);
    }
    // Every kind of this phase admits a `verification_required` account (Phase 2's booking kind
    // refuses it, FR-137).
    expect(await callUser(appContext(verificationRequired)).whoAmI()).toMatchObject({
      userId: 'student-4',
    });
    // The role is checked first: a suspended teacher's teacher procedure is the restricted refusal,
    // a suspended teacher's student procedure is the role's.
    const suspendedTeacher: UserSession = { ...applicant, accountStatus: 'suspended' };
    expect(await refusal(() => callUser(appContext(suspendedTeacher)).mySlots())).toMatchObject({
      code: 'ACCOUNT_RESTRICTED',
    });
    expect(await refusal(() => callUser(appContext(suspendedTeacher)).whoAmI())).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('an admin procedure refuses a session whose second factor is unverified with `MFA_REQUIRED`', async () => {
    const unverified = callAdministrator(adminContext(unverifiedAdmin));
    expect(await refusal(() => unverified.approve({ teacherId: 't1' }))).toMatchObject({
      status: 403,
      code: 'MFA_REQUIRED',
      unexpected: false,
    });
    expect(approve).not.toHaveBeenCalled();
    // A verified session reaches the transaction (refused here by the fixture, so unexpected).
    const verified = callAdministrator(adminContext(verifiedAdmin));
    expect(await refusal(() => verified.approve({ teacherId: 't1' }))).toMatchObject({
      status: 500,
      unexpected: true,
    });
  });

  it('`adminPublicProcedure` requires a rate limit and exists only on the admin instance', async () => {
    // @ts-expect-error -- T016: an anonymous administrator endpoint declares its rate limit (R-SEC-6)
    expect(() => adminPublicProcedure({ input: z.void(), output: z.string() })).toThrow(
      /rate limit/,
    );

    const anonymousSignIn = adminPublicProcedure({
      input: z.void(),
      output: z.string(),
      rateLimit: {
        key: defaultRateLimits.authentication,
        subjectOf: ({ ctx }) => ctx.clientAddress,
      },
    }).mutation(() => 'in');
    // @ts-expect-error -- T016: an administrator-surface procedure cannot be mounted on the user surface (R-API-11)
    expect(() => createAppRouter({ anonymousSignIn })).not.toThrow();
    const metaOf = (path: string) =>
      (administrator._def.procedures as Record<string, AnyProcedure>)[path]?._def.meta;
    expect(metaOf('signIn')).toEqual({ surface: 'admin', rateLimit: 'rate_limit_authentication' });

    // Anonymous: the call reaches the handler.
    expect(await callAdministrator(adminContext(null)).signIn({ email: 'a@b.c' })).toBe(
      'signed in',
    );
    expect(signIn).toHaveBeenCalledTimes(1);

    // Its limit is applied from the limiter the administrator context carries.
    const { limiter, counter } = limiterOf(1);
    const limited = callAdministrator(adminContext(null, limiter));
    expect(await limited.signIn({ email: 'x@y.z' })).toBe('signed in');
    expect(await refusal(() => limited.signIn({ email: 'x@y.z' }))).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    expect(counter.hits).toBe(2);
  });
});

describe('every kind applies its output schema (T169, R-HONEST-4, R-API-9)', () => {
  it('a kind cannot be declared without its output schema', () => {
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => publicProcedure({ input: z.void(), rateLimit: unlimitedInTest })).toThrow();
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => studentProcedure({ input: z.void() })).toThrow();
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => teacherProcedure({ admits: 'applicant', input: z.void() })).toThrow();
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => userProcedure({ input: z.void() })).toThrow();
    // @ts-expect-error -- T169: every caller kind requires its output schema
    expect(() => adminProcedure({ input: z.void() })).toThrow();
    // @ts-expect-error -- T107, T169: a kind takes its two schemas, not a bare input
    expect(() => publicProcedure(z.void())).toThrow();
  });

  it('parses the handler’s result through it, so a field the schema does not name is stripped', async () => {
    const caller = callUser(appContext(student));
    const answer = await caller.whoAmI();
    expect(answer).toEqual({ userId: 'student-1', gender: 'female' });
    expect(JSON.stringify(answer)).not.toContain(secret);
    expect(JSON.stringify(answer)).not.toContain('dateOfBirth');
  });

  it('answers an output that fails its schema as the internal error, unexpected, never 400 with the response’s paths', async () => {
    const caller = callUser(appContext(null));
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
      // The user kind accepts a declaration as the student and teacher kinds do (`account.delete`).
      erase: userProcedure({
        input: z.void(),
        output: z.string(),
        rateLimit: {
          key: defaultRateLimits.authentication,
          subjectOf: ({ ctx }) => ctx.caller.userId,
        },
      }).mutation(() => 'erased'),
    });
    const { limiter, counter } = limiterOf(1);
    const call = createAppCallerFactory(limited);
    const anonymous = call(appContext(null, limiter));
    const signedIn = call(appContext(student, limiter));

    expect(await anonymous.requestCode({ phone: '+201001234567' })).toBe('sent');
    expect(await refusal(() => anonymous.requestCode({ phone: '+201001234567' }))).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      unexpected: false,
    });
    expect(handler).toHaveBeenCalledTimes(1);

    expect(await signedIn.mine()).toBe('mine');
    expect(await refusal(() => signedIn.mine())).toMatchObject({ status: 429 });
    expect(await signedIn.erase()).toBe('erased');
    expect(await refusal(() => signedIn.erase())).toMatchObject({ status: 429 });
    expect(counter.hits).toBe(6);
  });

  it('stamps the key in the procedure’s meta, beside the surface and the caller kind', () => {
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
    expect(metaOf('search')).toEqual({
      surface: 'app',
      caller: 'student',
      rateLimit: 'rate_limit_search',
    });
    expect(metaOf('unlimited')).toEqual({ surface: 'app', caller: 'student' });
  });

  it('names each kind in the meta, so the R-MOBILE-13 gate reads it from the snapshot (T028)', () => {
    const router = createAppRouter({
      open: publicProcedure({
        input: z.void(),
        output: z.string(),
        rateLimit: unlimitedInTest,
      }).query(() => 'open'),
      any: userProcedure({ input: z.void(), output: z.string() }).query(() => 'any'),
      learner: studentProcedure({ input: z.void(), output: z.string() }).query(() => 'learner'),
      teaching: teacherProcedure({
        input: z.void(),
        output: z.string(),
        admits: 'applicant',
      }).query(() => 'teaching'),
    });
    const callerOf = (path: string) =>
      (
        (router._def.procedures as Record<string, AnyProcedure>)[path]?._def.meta as
          { caller?: string } | undefined
      )?.caller;
    expect(['open', 'any', 'learner', 'teaching'].map(callerOf)).toEqual([
      'public',
      'user',
      'student',
      'teacher',
    ]);
  });
});
