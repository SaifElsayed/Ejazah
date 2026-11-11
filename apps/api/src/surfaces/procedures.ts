// T107: the caller kinds — public, student, user, teacher, administrator, administrator-public — and
// the only way to declare a procedure (FR-047, FR-050, R-API-11, R-API-12, R-SEC-8;
// contracts/kernel.md "Caller kinds", specs/002-identity/contracts/kernel.md "The caller kinds",
// ARCHITECTURE §7.2).
//
// EACH KIND TAKES ITS TWO SCHEMAS, `{ input, output }`, so a procedure cannot be declared without
// either and neither validation can be skipped: a procedure that takes nothing says so with
// `z.void()`. The output schema is applied beside the input one (T169, owner's decision
// 2026-10-10): what the handler returns is parsed by it before it leaves, so zod strips a field the
// schema does not name (R-HONEST-4), the contract snapshot records the fields the schema names and
// nothing inferred from the handler (R-API-9), and a result that fails its schema is the internal
// error, unexpected, never a validation failure carrying the response's own paths. The base
// builders are not exported, so a procedure cannot be built around the kinds.
//
// A KIND NARROWS THE CONTEXT, it never mints: the signed-in kinds refuse an anonymous caller (401),
// a caller without the role (403) and, unless the procedure says `admitsRestricted`, a suspended or
// banned account (`ACCOUNT_RESTRICTED`, FR-137; T017), then hand the handler a context whose
// `caller` is not null. The teacher kind also declares the standing it admits (R-106, FR-108,
// FR-192): `admits: 'applicant'` is any teacher-role holder, `'approved'` a verified one,
// `'publishable'` a verified one with a verified payout account; a procedure without the
// declaration does not compile, and the standing below the declared one is refused with
// `FORBIDDEN`. Standing comes from the session the resolver read on this request (FR-108), so a
// suspension takes effect on the next call. The gender it carries is the `RequesterGender` the
// request context minted from the session (T106); nothing here builds one.
//
// A RATE LIMIT IS DECLARED ON THE KIND, never applied by hand (T170, FR-043, R-SEC-6):
// `rateLimit: { key, subjectOf, budget? }`, required on the two anonymous kinds (an anonymous
// endpoint without one does not compile) and accepted by every signed-in kind, the administrator's
// included (T062 of specs/004-sessions, FR-470), which also accept `subject: 'caller'`: the caller
// the kind authenticated (`user:<userId>`, `admin:<adminId>`), never a value the endpoint computes.
// After the input is validated, the kind applies `throttle` from the limiter the request context
// carries, budget first and then the subject, and stamps the key in the procedure's meta beside its
// surface, so what a surface serves can be read for its limits (surfaces.spec.ts). EVERY SIGNED-IN
// KIND GIVEN NO `rateLimit` applies `throttleDefault` at the same place (T062; SRS NFR-SEC-12):
// `rate_limit_signed_in_default`, the caller as subject, stamped nowhere since nothing is declared.
// The administrator kind applies either before the `.use` that opens its transaction, so a refused
// call opens none and writes nothing. tRPC's `path` names the call in a refusal's record.
//
// TWO tRPC INSTANCES, one per surface, because the two contexts are separate types (R-SEC-8). Each
// stamps its procedures with the surface's meta, in the type and at runtime, so an administrative
// capability is recognisable wherever it is mounted (T098): `{ surface: 'admin' }` exists only on
// the administrator instance, and the user instance's meta type cannot express it. Each surface's
// router accepts only its own surface's procedures (`SurfaceRecord`), so a procedure of the other
// surface, or one built on any other tRPC instance, does not compile where it is mounted.
//
// THE ADMINISTRATOR KIND REQUIRES THE SECOND FACTOR (T017, FR-170): a session whose second factor
// is unverified is refused with `MFA_REQUIRED` before any transaction opens; `MFA_SETUP_REQUIRED`
// is the sign-in's answer for an unenrolled administrator, who holds no verified session either.
//
// THE ADMINISTRATOR KIND WRITES ITS OWN AUDIT RECORD (T108, FR-049, R-API-12). After authenticating
// the administrator and validating the input, it opens one transaction through `platform/db/` and
// hands it to the handler as `ctx.tx`, with `ctx.audit` on which the handler records what its
// action touched. When the handler returns, the kind writes those records through the bound
// `AuditWriter` on the same transaction, then commits; the actor is the session's administrator.
// So the action's writes and its audit rows commit or roll back together: a handler that fails, a
// call that recorded nothing and an audit write that fails each leave nothing behind. A read is an
// administrative call like any other and is audited the same way. This file neither imports
// `modules/admin` nor queries `audit_logs` (R-API-4, R-API-6): the writer is the admin module's,
// reached through the context.
//
// THE ADMINISTRATOR-PUBLIC KIND (T017) is the administrator surface's anonymous kind: sign-in, the
// second factor and the password-set link, and nothing else (a test of the admin router asserts
// its public procedures are exactly `auth.*`). It names its rate limit as the user surface's public
// kind does, applied from the limiter the administrator context carries.
//
// ONE ERROR FORMATTER on both instances: `toErrorShape`, which sends T101's `mapError` result and
// nothing else, so a tRPC error carries no stack, path or default shape (FR-041, R-API-8). tRPC
// wraps an input that failed its schema as `BAD_REQUEST` with the `ZodError` as cause, and an
// output that failed its schema as `INTERNAL_SERVER_ERROR` with the `ZodError` as cause; the first
// is the validation failure with its paths, the second the internal error (T169).
//
// AN INPUT THAT CANNOT BE READ IS THE CLIENT'S (T108). tRPC reads the input lazily, when the schema
// asks for it, and wraps a body or GET `input` that is not JSON as `BAD_REQUEST` with the parser's
// SyntaxError as cause, which the formatter cannot tell from a SyntaxError our own schema or
// handler throws. So every kind reads the raw input itself, after its authentication and
// immediately before its schema, and answers a failure of that read `VALIDATION_FAILED`: decided by
// where it failed, never by the error's type, so a SyntaxError of ours stays the internal error.
// `inputsReadUnguarded` names a procedure built without it.
import {
  type AnyTRPCProcedure,
  type AnyTRPCRouter,
  initTRPC,
  TRPCError,
  type TRPCProcedureBuilder,
  type TRPCUnsetMarker,
} from '@trpc/server';
import { z, ZodError } from 'zod';
import type { AuditEntry, AuditTrail } from '../platform/audit/audit-writer.js';
import { isDeadlock } from '../platform/db/db-errors.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import {
  type DeadlockIds,
  runRetryingDeadlockOnce,
} from '../platform/db/transaction.repository.js';
import { DomainError, type ErrorCode } from '../platform/errors/domain-error.js';
import { mapError, type MappedError } from '../platform/errors/error-filter.js';
import { isRefusalLogged, markRefusalLogged } from '../platform/errors/logged-refusal.js';
import {
  type CallerSubject,
  type IdentifierRateLimit,
  type RateLimitDeclaration,
  type RateLimitKey,
  throttle,
  throttleDefault,
} from '../platform/guards/rate-limit.guard.js';
import {
  LIVE_PING_INTERVAL_MS,
  LIVE_RECONNECT_AFTER_INACTIVITY_MS,
} from '../platform/live/live-constants.js';
import { bindToTransaction } from '../platform/live/live-publisher.js';
import type { Logger } from '../platform/logging/logger.js';
import type {
  AccountStatus,
  AdminContext,
  AdministratorCaller,
  AppContext,
  Role,
  UserCaller,
} from './context.js';

/** The meta of every user-surface procedure. */
/**
 * The user surface's caller kinds, as the meta names them. `participant` (T011 of
 * specs/004-sessions; contracts/README.md, "Callers") is a session's or an enrollment's student or
 * teacher; which of the two people the caller is, the service decides.
 */
export type AppCallerKind = 'public' | 'user' | 'student' | 'teacher' | 'participant';

export interface AppMeta {
  readonly surface: 'app';
  /**
   * The procedure's caller kind, recorded in the contract snapshot so the R-MOBILE-13 gate reads
   * which procedures are not public from a file (T028, research R-115).
   */
  readonly caller: AppCallerKind;
  /** The settings key of the procedure's declared rate limit, when it declares one (T170). */
  readonly rateLimit?: RateLimitKey;
  /**
   * A subscription's per-yield schema (T063): its output parser describes the stream it returns,
   * not what it yields, so the contract snapshot records this one in its place (R-API-9, R-324).
   */
  readonly events?: z.ZodType;
}

/** The meta of every administrator-surface procedure: what makes it an administrative capability. */
export interface AdminMeta {
  readonly surface: 'admin';
  /** The settings key of the procedure's declared rate limit: the anonymous kind's (T017), or T062's. */
  readonly rateLimit?: RateLimitKey;
}

/** tRPC's own failures that carry no error of ours, by the kernel code they answer with. */
const transportCodes: Partial<Record<TRPCError['code'], ErrorCode>> = {
  PARSE_ERROR: 'VALIDATION_FAILED',
  BAD_REQUEST: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_SUPPORTED: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  TOO_MANY_REQUESTS: 'RATE_LIMITED',
};

/**
 * The one response for a failed procedure call: T101's mapping of what was thrown. A tRPC error
 * wrapping one of ours is mapped by its cause; one tRPC raised itself with no cause (an unknown
 * path) by its code. An input that cannot be read reaches here already wrapping our
 * `VALIDATION_FAILED`, from the kinds' input guard (T108), so a cause tRPC's own reading left is
 * never mapped here. An output that failed its schema (a `ZodError` tRPC wrapped as
 * `INTERNAL_SERVER_ERROR`, T169) is the internal error, unexpected: the paths are the response's,
 * not the client's. Everything else is the internal error.
 */
export function toErrorShape(error: TRPCError): MappedError {
  if (error.code === 'INTERNAL_SERVER_ERROR' && error.cause instanceof ZodError) {
    return mapError(error);
  }
  if (error.cause !== undefined && !(error.cause instanceof TRPCError)) {
    return mapError(error.cause);
  }
  const code = transportCodes[error.code];
  return mapError(code === undefined ? error : new DomainError(code));
}

const formatter = {
  errorFormatter: ({ error }: { error: TRPCError }) => {
    const { body, status } = toErrorShape(error);
    // tRPC's node adapter's own exception handler reads `shape.data.httpStatus`, and its throw where
    // that is missing ends the process (T108). Non-enumerable, so no response body carries it.
    return Object.defineProperty({ ...body }, 'data', { value: { httpStatus: status } });
  },
};

const app = initTRPC
  .context<AppContext>()
  .meta<AppMeta>()
  // Every kind stamps its caller; the default is the guarded one, so a procedure that somehow
  // skipped a kind would be held by the R-MOBILE-13 gate rather than read as public (T028).
  .create({
    ...formatter,
    defaultMeta: { surface: 'app', caller: 'user' },
    isServer: true,
    // The live channel's Server-Sent Events (T063; research R-324, item 8): a ping comment on
    // every open stream, and the client's restart of a stream silent too long; both numbers are
    // the kernel's (`platform/live/live-constants.ts`), never written here.
    sse: {
      ping: { enabled: true, intervalMs: LIVE_PING_INTERVAL_MS },
      client: { reconnectAfterInactivityMs: LIVE_RECONNECT_AFTER_INACTIVITY_MS },
    },
  });

const admin = initTRPC
  .context<AdminContext>()
  .meta<AdminMeta>()
  .create({ ...formatter, defaultMeta: { surface: 'admin' }, isServer: true });

/**
 * What a surface's router may hold, at any depth: procedures whose meta is that surface's, plain
 * records of them, and routers built for that surface. A procedure of the other surface, or one
 * built on any other tRPC instance (whose meta is not the surface's), is a compile error where it
 * is mounted (R-API-11, R-API-7); T098 checks the same at runtime.
 */
export type SurfaceRecord<TMeta> = {
  readonly [key: string]:
    | (AnyTRPCProcedure & { readonly meta: TMeta })
    | (AnyTRPCRouter & { readonly _def: { readonly _config: { $types: { meta: TMeta } } } })
    | SurfaceRecord<TMeta>;
};

/** Builds the user surface's router (T109); it accepts user-surface procedures only. */
export function createAppRouter<TRecord extends SurfaceRecord<AppMeta>>(record: TRecord) {
  return app.router(record);
}

/** Builds the administrator surface's router (T109); it accepts administrator procedures only. */
export function createAdminRouter<TRecord extends SurfaceRecord<AdminMeta>>(record: TRecord) {
  return admin.router(record);
}

/**
 * Merges user-surface routers into one namespace (T068: `account` is identity's router and the
 * verification module's `identityVerification`, R-121).
 */
export const mergeAppRouters = app.mergeRouters;

/**
 * Names every procedure of `router` whose input schema is not immediately preceded by the kinds'
 * input guard (T108): one built on a kind that omits it would answer an unreadable input 500.
 */
export function inputsReadUnguarded(router: AnyTRPCRouter): string[] {
  const procedures = Object.entries(router._def.procedures as Record<string, AnyTRPCProcedure>);
  return procedures
    .filter(([, procedure]) => {
      // tRPC keeps the chain on the definition without typing it there.
      const { middlewares = [] } = procedure._def as { readonly middlewares?: readonly unknown[] };
      const schema = middlewares.findIndex(
        (middleware) => (middleware as { readonly _type?: string })._type === 'input',
      );
      return schema < 1 || !inputGuards.has(middlewares[schema - 1]);
    })
    .map(([path]) => path)
    .sort();
}

/** Calls a user-surface router in process, through the same middleware as over HTTP. */
export const createAppCallerFactory = app.createCallerFactory;

/** Calls an administrator-surface router in process, through the same middleware as over HTTP. */
export const createAdminCallerFactory = admin.createCallerFactory;

/**
 * What a caller kind returns: a builder over the surface's context with its input and output
 * already set, to be finished with `.query` or `.mutation`. Named because the declaration output
 * must name it.
 */
type CallerKind<TContext, TMeta, TNarrowed, TIn, TInOut, TOutIn, TOutOut> = TRPCProcedureBuilder<
  TContext,
  TMeta,
  TNarrowed,
  TIn,
  TInOut,
  TOutIn,
  TOutOut,
  false
>;

/** What every kind takes: the schema of what the client sends and of what the handler returns. */
export interface ProcedureSchemas<TIn, TInOut, TOutIn, TOutOut> {
  readonly input: z.ZodType<TInOut, TIn>;
  readonly output: z.ZodType<TOutOut, TOutIn>;
}

/** The context a signed-in user's procedure reads: the surface's, with its caller present. */
type SignedInContext = AppContext & { readonly caller: UserCaller };

/**
 * What a signed-in user kind takes: its schemas, its rate limit when it has one (T170), and
 * whether a suspended or banned account may call it (FR-137; the account read, sign-out, deletion
 * and the restricted screen's data say so; nothing else does).
 */
export interface AppProcedureDeclaration<
  TIn,
  TInOut,
  TOutIn,
  TOutOut,
  TContext,
> extends ProcedureSchemas<TIn, TInOut, TOutIn, TOutOut> {
  readonly rateLimit?: RateLimitDeclaration<TContext, TInOut>;
  readonly admitsRestricted?: boolean;
}

/** The standings the teacher kind can admit, lowest first (R-106). */
export type TeacherStandingAdmitted = 'applicant' | 'approved' | 'publishable';

/** The teacher kind's declaration: `admits` is required, so no teacher procedure has two meanings. */
export interface TeacherProcedureDeclaration<
  TIn,
  TInOut,
  TOutIn,
  TOutOut,
> extends AppProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut, SignedInContext> {
  readonly admits: TeacherStandingAdmitted;
}

/**
 * The public kind's declaration: an anonymous endpoint always names its limit (R-SEC-6), and its
 * subject is always a value it names, since it has no caller (T062).
 */
export interface PublicProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut> extends ProcedureSchemas<
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  readonly rateLimit: IdentifierRateLimit<AppContext, TInOut>;
}

/** The administrator surface's anonymous kind: the same rule as the user surface's (R-SEC-6). */
export interface AdminPublicProcedureDeclaration<
  TIn,
  TInOut,
  TOutIn,
  TOutOut,
> extends ProcedureSchemas<TIn, TInOut, TOutIn, TOutOut> {
  readonly rateLimit: IdentifierRateLimit<AdminContext, TInOut>;
}

/** The context an administrator's procedure reads once the kind admitted the caller (T062). */
type AdministratorContext = AdminContext & { readonly administrator: AdministratorCaller };

/** The administrator kind's declaration: its schemas, and its own limit when it has one (T062). */
export interface AdminProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut> extends ProcedureSchemas<
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  readonly rateLimit?: RateLimitDeclaration<AdministratorContext, TInOut>;
  /**
   * T061 of specs/004-sessions (L5; contracts/kernel.md, `adminProcedure`): the call's whole
   * transaction run through T002's `runRetryingDeadlockOnce`, a deadlock retried once in a new one
   * and a second answering `refusal()`. Optional; only `sessions.restore` declares it (the owner's
   * confirmation of 2026-11-06 on the small check).
   */
  readonly deadlock?: DeadlockDeclaration<TInOut>;
}

/** What a deadlock's retry is logged with and refused by (T002's `DeadlockTrace`, T061). */
export interface DeadlockDeclaration<TInput> {
  /** The procedure, as T002's `warn` lines name it. */
  readonly operation: string;
  /** The closed ids of those lines, from the call's input. */
  readonly ids: (input: TInput) => DeadlockIds;
  /** The caller's clear refusal after a second deadlock. */
  readonly refusal: () => Error;
}

/** A signed-in user as the limiter counts them: `user:<userId>` (T062). */
const userSubject = (ctx: SignedInContext): CallerSubject => ({
  kind: 'user',
  userId: ctx.caller.userId,
});

/** An administrator as the limiter counts them: `admin:<adminId>`, apart from every user (T062). */
const administratorSubject = (ctx: AdministratorContext): CallerSubject => ({
  kind: 'administrator',
  adminId: ctx.administrator.adminId,
});

/**
 * A subscription's output schema (T063): the stream its handler returns, which tRPC's output
 * parser checks is one, and `events`, the schema of each event it yields, which the kind stamps in
 * the meta for the contract snapshot. tRPC parses no yielded value (https://trpc.io/docs/server/
 * subscriptions), so the handler parses each one by `events` itself before it is sent.
 */
export function eventStream<TEvent>(events: z.ZodType<TEvent>): z.ZodType<AsyncIterable<TEvent>> {
  const stream = z.custom<AsyncIterable<TEvent>>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Partial<AsyncIterable<TEvent>>)[Symbol.asyncIterator] === 'function',
    { message: 'A subscription answers a stream of events.' },
  );
  streamedEvents.set(stream, events);
  return stream;
}

/** The per-yield schema of each `eventStream` output, by that output's schema. */
const streamedEvents = new WeakMap<object, z.ZodType>();

/**
 * The meta a user-surface procedure is stamped with: its surface, its limit's key when declared,
 * and a subscription's per-yield schema.
 */
function appMeta(
  caller: AppCallerKind,
  rateLimit: { readonly key: RateLimitKey } | undefined,
  output: object,
): AppMeta {
  const events = streamedEvents.get(output);
  return {
    surface: 'app',
    caller,
    ...(rateLimit === undefined ? {} : { rateLimit: rateLimit.key }),
    ...(events === undefined ? {} : { events }),
  };
}

/**
 * The user kinds' after-commit point (T063; Saif's review of PR #126, round 1, follow-up 4): they
 * open no transaction, their services committing their own, so the request's live events go out
 * once the handler resolves, and none when it throws or is refused.
 */
const flushLiveAfterHandler = app.middleware(async ({ ctx, next }) => {
  const result = await next();
  if (result.ok) ctx.live.flush();
  else ctx.live.drop();
  return result;
});

/** The two standings every user kind refuses unless it says otherwise (FR-137, kernel.md). */
const RESTRICTED_STANDINGS: ReadonlySet<AccountStatus> = new Set(['suspended', 'banned']);

/**
 * Admits an authenticated user, of `role` when one is named, whose account is not restricted
 * unless the procedure admits one; narrows the context to that caller. The order is the
 * contract's: anonymous first (401), then the role (403), then the standing (`ACCOUNT_RESTRICTED`).
 */
function requireUser({
  role,
  admitsRestricted,
}: {
  role: Role | undefined;
  admitsRestricted: boolean;
}) {
  return app.middleware(({ ctx, next }) => {
    if (ctx.caller === null) throw new DomainError('UNAUTHENTICATED');
    if (role !== undefined && ctx.caller.role !== role) throw new DomainError('FORBIDDEN');
    if (!admitsRestricted && RESTRICTED_STANDINGS.has(ctx.caller.accountStatus)) {
      throw new DomainError('ACCOUNT_RESTRICTED', undefined, {
        details: [{ path: 'accountStatus', code: ctx.caller.accountStatus }],
      });
    }
    const caller: UserCaller = ctx.caller;
    return next({ ctx: { caller } });
  });
}

/** After the teacher role: refuses the standing below the declared one with `FORBIDDEN` (R-106). */
function requireStanding(admits: TeacherStandingAdmitted) {
  return app.middleware(({ ctx, next }) => {
    const caller = ctx.caller;
    if (caller === null) throw new DomainError('UNAUTHENTICATED');
    const approved = caller.teacher?.verificationStatus === 'approved';
    const publishable = approved && caller.teacher?.payoutVerified === true;
    if (admits === 'approved' && !approved) throw new DomainError('FORBIDDEN');
    if (admits === 'publishable' && !publishable) throw new DomainError('FORBIDDEN');
    return next({ ctx: { caller } });
  });
}

/** An authenticated administrator whose second factor was verified on this session (FR-170). */
const requireAdministrator = admin.middleware(({ ctx, next }) => {
  if (ctx.administrator === null) throw new DomainError('UNAUTHENTICATED');
  if (!ctx.administrator.mfaVerified) throw new DomainError('MFA_REQUIRED');
  const administrator: AdministratorCaller = ctx.administrator;
  return next({ ctx: { administrator } });
});

/**
 * Reads the request's raw input as tRPC reads it, so a failure of that read is answered here
 * (T108). `getRawInput` runs only tRPC's own reading of the request (the body or the GET `input`,
 * then JSON), never a schema or a handler of ours, so its failure is the client's input that
 * cannot be read: `VALIDATION_FAILED`, logged once at info with the request's correlation id and
 * nothing of the input or of the parser's message (which can quote the body, R-SEC-2), and never
 * reported. A body past the limit stays tRPC's `PAYLOAD_TOO_LARGE` (T150). The value is cached by
 * tRPC, so the schema reads it again without a second read. The refusal carries no cause (T129):
 * the read's failure quotes the body, and the logger writes an error's cause chain.
 */
async function readInput(getRawInput: () => Promise<unknown>, log: Logger): Promise<void> {
  try {
    await getRawInput();
  } catch (failure) {
    if (failure instanceof TRPCError && failure.code === 'PAYLOAD_TOO_LARGE') throw failure;
    log.info(
      { errorCode: 'VALIDATION_FAILED', reason: 'input_unreadable' },
      'A request whose input could not be read was refused',
    );
    const refusal = new TRPCError({
      code: 'BAD_REQUEST',
      cause: new DomainError('VALIDATION_FAILED'),
    });
    throw markRefusalLogged(refusal);
  }
}

/**
 * Whether this refusal's line was already written where it was refused (T062's follow-up from B34;
 * `app.module.ts`' `onError`), so the handler's one-place refusal log writes no second line for the
 * one call: the input guard's unreadable input (T108), marked on the error it throws, or a module's
 * own logged refusal, marked on the error tRPC wraps as this error's cause (PR #130's review, round
 * 1, Minor 4; `platform/errors/logged-refusal.ts`).
 */
export function isRefusalLoggedByKind(error: TRPCError): boolean {
  return isRefusalLogged(error) || isRefusalLogged(error.cause);
}

/** The user surface's input guard: after the kind's authentication, before its schema (T108). */
const readAppInput = app.middleware(async ({ ctx, getRawInput, next }) => {
  await readInput(getRawInput, ctx.log);
  return next();
});

/** The administrator surface's input guard, as the user surface's (T108). */
const readAdminInput = admin.middleware(async ({ ctx, getRawInput, next }) => {
  await readInput(getRawInput, ctx.log);
  return next();
});

/** The middleware every kind runs immediately before its input schema (T108). */
const inputGuards: ReadonlySet<unknown> = new Set<unknown>([
  ...readAppInput._middlewares,
  ...readAdminInput._middlewares,
]);

/** Anyone, authenticated or not; always rate limited, by the declaration it carries. */
export function publicProcedure<TIn, TInOut, TOutIn, TOutOut>({
  input,
  output,
  rateLimit,
}: PublicProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut>): CallerKind<
  AppContext,
  AppMeta,
  object,
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  // The type already requires it; a declaration that slipped past the compiler is refused here.
  if (rateLimit === undefined) {
    throw new Error('A public procedure declares its rate limit (R-SEC-6, T170).');
  }
  return app.procedure
    .meta(appMeta('public', rateLimit, output))
    .use(readAppInput)
    .input(input)
    .output(output)
    .use(throttle(rateLimit));
}

/** A signed-in kind's builder: the user middleware, the schemas, the limit when declared. */
function signedIn<TIn, TInOut, TOutIn, TOutOut>(
  {
    input,
    output,
    rateLimit,
    admitsRestricted = false,
  }: AppProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut, SignedInContext>,
  role: Role | undefined,
  kind: AppCallerKind = role ?? 'user',
): CallerKind<AppContext, AppMeta, { caller: UserCaller }, TIn, TInOut, TOutIn, TOutOut> {
  const builder = app.procedure
    .meta(appMeta(kind, rateLimit, output))
    .use(flushLiveAfterHandler)
    .use(requireUser({ role, admitsRestricted }))
    .use(readAppInput)
    .input(input)
    .output(output);
  return rateLimit === undefined
    ? builder.use(throttleDefault(userSubject))
    : builder.use(throttle(rateLimit, userSubject));
}

/** A caller holding the student role. */
export function studentProcedure<TIn, TInOut, TOutIn, TOutOut>(
  declaration: AppProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut, SignedInContext>,
): CallerKind<AppContext, AppMeta, { caller: UserCaller }, TIn, TInOut, TOutIn, TOutOut> {
  return signedIn(declaration, 'student');
}

/**
 * Any authenticated person of either role, for what both roles share: the account, sign-out,
 * deletion, identity verification (T017; specs/002-identity/contracts/kernel.md).
 */
export function userProcedure<TIn, TInOut, TOutIn, TOutOut>(
  declaration: AppProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut, SignedInContext>,
): CallerKind<AppContext, AppMeta, { caller: UserCaller }, TIn, TInOut, TOutIn, TOutOut> {
  return signedIn(declaration, undefined);
}

/**
 * A participant (T011 of specs/004-sessions; contracts/README.md, "Callers"): an authenticated
 * person of either role, a suspended or banned account refused `ACCOUNT_RESTRICTED` before the
 * service as every user kind refuses it. Whether the caller is one of the two people of the session
 * or enrollment named is the service's to decide, from the caller's own id: anyone else answers
 * `NOT_FOUND` with the shape a nonexistent id gets (R-GENDER-2, FR-432).
 */
export function participantProcedure<TIn, TInOut, TOutIn, TOutOut>(
  declaration: AppProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut, SignedInContext>,
): CallerKind<AppContext, AppMeta, { caller: UserCaller }, TIn, TInOut, TOutIn, TOutOut> {
  return signedIn(declaration, undefined, 'participant');
}

/** A caller holding the teacher role, of the standing the declaration admits (R-106). */
export function teacherProcedure<TIn, TInOut, TOutIn, TOutOut>({
  admits,
  ...declaration
}: TeacherProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut>): CallerKind<
  AppContext,
  AppMeta,
  { caller: UserCaller },
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  // The type already requires it; a declaration that slipped past the compiler is refused here.
  if (admits === undefined) {
    throw new Error('A teacher procedure declares the standing it admits (R-106, T017).');
  }
  const { input, output, rateLimit, admitsRestricted = false } = declaration;
  const builder = app.procedure
    .meta(appMeta('teacher', rateLimit, output))
    .use(flushLiveAfterHandler)
    .use(requireUser({ role: 'teacher', admitsRestricted }))
    .use(requireStanding(admits))
    .use(readAppInput)
    .input(input)
    .output(output);
  return rateLimit === undefined
    ? builder.use(throttleDefault(userSubject))
    : builder.use(throttle(rateLimit, userSubject));
}

/** What an administrator handler receives beyond the surface's context (T108). */
export interface AuditedCall {
  readonly administrator: AdministratorCaller;
  /** The call's one transaction: every write of the action goes through it. */
  readonly tx: Transaction;
  /**
   * Where the action records what it touched; at least one record, or the call is refused unless it
   * marks itself a keyed call's replay (`replayed()`).
   */
  readonly audit: AuditTrail;
}

/**
 * An authenticated administrator with the second factor verified, every call audited in its own
 * transaction (FR-049, FR-170, R-API-12). Exists on the administrator surface only (R-API-11). Its
 * declared limit, or the signed-in default, is checked before the transaction opens (T062, FR-470).
 */
export function adminProcedure<TIn, TInOut, TOutIn, TOutOut>({
  input,
  output,
  rateLimit,
  deadlock,
}: AdminProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut>): CallerKind<
  AdminContext,
  AdminMeta,
  AuditedCall,
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  const meta: AdminMeta =
    rateLimit === undefined ? { surface: 'admin' } : { surface: 'admin', rateLimit: rateLimit.key };
  const builder = admin.procedure
    .meta(meta)
    .use(requireAdministrator)
    .use(readAdminInput)
    .input(input)
    .output(output);
  return (
    rateLimit === undefined
      ? builder.use(throttleDefault(administratorSubject))
      : builder.use(throttle(rateLimit, administratorSubject))
  ).use(async ({ ctx, next, input: called }) => {
    const { transactions, auditWriter } = ctx.administration;
    // T061: a declared deadlock retry reruns the whole transaction, its audit entry with it.
    const run = <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
      deadlock === undefined
        ? transactions.run(work)
        : runRetryingDeadlockOnce(transactions, work, deadlock.refusal, {
            log: ctx.log,
            operation: deadlock.operation,
            ids: deadlock.ids(called as TInOut),
          });
    const result = await run(async (tx) => {
      // Each attempt starts with an empty after-commit list: a declared deadlock's retry reruns the
      // whole transaction, so what a rolled-back attempt queued is never sent (T061, T063).
      ctx.live.drop();
      // A service handed only `tx` reaches this request's after-commit list through it (T063).
      const unbind = bindToTransaction(tx, ctx.live);
      try {
        const entries: AuditEntry[] = [];
        let replayed = false;
        const audit: AuditTrail = {
          record: (entry) => void entries.push(entry),
          replayed: () => {
            replayed = true;
          },
        };
        const answered = await next({ ctx: { tx, audit } });
        // tRPC hands a failure back as a result; thrown, it rolls the transaction back. A declared
        // deadlock at a statement is thrown as the database's own, for the retry to read (T061).
        if (!answered.ok) {
          throw deadlock !== undefined && isDeadlock(answered.error.cause)
            ? answered.error.cause
            : answered.error;
        }
        // A replay of a keyed call records nothing: the first call's entry is the record (B39).
        if (entries.length === 0 && !replayed) {
          throw new Error(
            'An administrative call recorded no audit entry; nothing it wrote is kept (FR-049, R-API-12).',
          );
        }
        for (const entry of entries) {
          await auditWriter.write(tx, { ...entry, adminId: ctx.administrator.adminId });
        }
        return answered;
      } finally {
        unbind();
      }
    }).catch((error: unknown) => {
      // Rolled back: nothing the call added is sent (T063).
      ctx.live.drop();
      throw error;
    });
    // THE ADMINISTRATOR KIND'S AFTER-COMMIT POINT (T063; contracts/kernel.md, `LivePublisher`):
    // `transactions.run` has committed, so the request's live events go out now, and only now.
    ctx.live.flush();
    return result;
  });
}

/**
 * Anyone, on the administrator surface: sign-in, the second factor and the password-set link
 * (T017). Always rate limited, by the declaration it carries, from the administrator context's
 * limiter. Exists on the administrator surface only (R-API-11).
 */
export function adminPublicProcedure<TIn, TInOut, TOutIn, TOutOut>({
  input,
  output,
  rateLimit,
}: AdminPublicProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut>): CallerKind<
  AdminContext,
  AdminMeta,
  object,
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  // The type already requires it; a declaration that slipped past the compiler is refused here.
  if (rateLimit === undefined) {
    throw new Error('An administrator-public procedure declares its rate limit (R-SEC-6, T017).');
  }
  return admin.procedure
    .meta({ surface: 'admin', rateLimit: rateLimit.key })
    .use(readAdminInput)
    .input(input)
    .output(output)
    .use(throttle(rateLimit));
}
