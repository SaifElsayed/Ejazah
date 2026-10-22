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
// endpoint without one does not compile) and accepted by the signed-in user kinds. After the input
// is validated, the kind applies `throttle` from the limiter the request context carries, budget
// first and then the subject, and stamps the key in the procedure's meta beside its surface, so
// what a surface serves can be read for its limits (surfaces.spec.ts).
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
import {
  type AnyTRPCProcedure,
  type AnyTRPCRouter,
  initTRPC,
  TRPCError,
  type TRPCProcedureBuilder,
  type TRPCUnsetMarker,
} from '@trpc/server';
import { type z, ZodError } from 'zod';
import type { AuditEntry, AuditTrail } from '../platform/audit/audit-writer.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode } from '../platform/errors/domain-error.js';
import { mapError, type MappedError } from '../platform/errors/error-filter.js';
import {
  type RateLimitDeclaration,
  type RateLimitKey,
  throttle,
} from '../platform/guards/rate-limit.guard.js';
import type {
  AccountStatus,
  AdminContext,
  AdministratorCaller,
  AppContext,
  Role,
  UserCaller,
} from './context.js';

/** The meta of every user-surface procedure. */
/** The user surface's caller kinds, as the meta names them. */
export type AppCallerKind = 'public' | 'user' | 'student' | 'teacher';

export interface AppMeta {
  readonly surface: 'app';
  /**
   * The procedure's caller kind, recorded in the contract snapshot so the R-MOBILE-13 gate reads
   * which procedures are not public from a file (T028, research R-115).
   */
  readonly caller: AppCallerKind;
  /** The settings key of the procedure's declared rate limit, when it declares one (T170). */
  readonly rateLimit?: RateLimitKey;
}

/** The meta of every administrator-surface procedure: what makes it an administrative capability. */
export interface AdminMeta {
  readonly surface: 'admin';
  /** The settings key of the anonymous kind's rate limit (T017). */
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
 * wrapping one of ours is mapped by its cause; one tRPC raised itself (an unknown path, a body that
 * does not parse) by its code. An output that failed its schema (a `ZodError` tRPC wrapped as
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
  errorFormatter: ({ error }: { error: TRPCError }) => toErrorShape(error).body,
};

const app = initTRPC
  .context<AppContext>()
  .meta<AppMeta>()
  // Every kind stamps its caller; the default is the guarded one, so a procedure that somehow
  // skipped a kind would be held by the R-MOBILE-13 gate rather than read as public (T028).
  .create({ ...formatter, defaultMeta: { surface: 'app', caller: 'user' }, isServer: true });

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

/** The public kind's declaration: an anonymous endpoint always names its limit (R-SEC-6). */
export interface PublicProcedureDeclaration<TIn, TInOut, TOutIn, TOutOut> extends ProcedureSchemas<
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  readonly rateLimit: RateLimitDeclaration<AppContext, TInOut>;
}

/** The administrator surface's anonymous kind: the same rule as the user surface's (R-SEC-6). */
export interface AdminPublicProcedureDeclaration<
  TIn,
  TInOut,
  TOutIn,
  TOutOut,
> extends ProcedureSchemas<TIn, TInOut, TOutIn, TOutOut> {
  readonly rateLimit: RateLimitDeclaration<AdminContext, TInOut>;
}

/** The meta a user-surface procedure is stamped with: its surface, and its limit's key when declared. */
function appMeta(
  caller: AppCallerKind,
  rateLimit: RateLimitDeclaration<never, never> | undefined,
): AppMeta {
  return rateLimit === undefined
    ? { surface: 'app', caller }
    : { surface: 'app', caller, rateLimit: rateLimit.key };
}

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
    .meta(appMeta('public', rateLimit))
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
): CallerKind<AppContext, AppMeta, { caller: UserCaller }, TIn, TInOut, TOutIn, TOutOut> {
  const builder = app.procedure
    .meta(appMeta(role ?? 'user', rateLimit))
    .use(requireUser({ role, admitsRestricted }))
    .input(input)
    .output(output);
  return rateLimit === undefined ? builder : builder.use(throttle(rateLimit));
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
    .meta(appMeta('teacher', rateLimit))
    .use(requireUser({ role: 'teacher', admitsRestricted }))
    .use(requireStanding(admits))
    .input(input)
    .output(output);
  return rateLimit === undefined ? builder : builder.use(throttle(rateLimit));
}

/** What an administrator handler receives beyond the surface's context (T108). */
export interface AuditedCall {
  readonly administrator: AdministratorCaller;
  /** The call's one transaction: every write of the action goes through it. */
  readonly tx: Transaction;
  /** Where the action records what it touched; at least one record, or the call is refused. */
  readonly audit: AuditTrail;
}

/**
 * An authenticated administrator with the second factor verified, every call audited in its own
 * transaction (FR-049, FR-170, R-API-12). Exists on the administrator surface only (R-API-11).
 */
export function adminProcedure<TIn, TInOut, TOutIn, TOutOut>({
  input,
  output,
}: ProcedureSchemas<TIn, TInOut, TOutIn, TOutOut>): CallerKind<
  AdminContext,
  AdminMeta,
  AuditedCall,
  TIn,
  TInOut,
  TOutIn,
  TOutOut
> {
  return admin.procedure
    .use(requireAdministrator)
    .input(input)
    .output(output)
    .use(({ ctx, next }) => {
      const { transactions, auditWriter } = ctx.administration;
      return transactions.run(async (tx) => {
        const entries: AuditEntry[] = [];
        const audit: AuditTrail = { record: (entry) => void entries.push(entry) };
        const result = await next({ ctx: { tx, audit } });
        // tRPC hands a failure back as a result; thrown, it rolls the transaction back.
        if (!result.ok) throw result.error;
        if (entries.length === 0) {
          throw new Error(
            'An administrative call recorded no audit entry; nothing it wrote is kept (FR-049, R-API-12).',
          );
        }
        for (const entry of entries) {
          await auditWriter.write(tx, { ...entry, adminId: ctx.administrator.adminId });
        }
        return result;
      });
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
    .input(input)
    .output(output)
    .use(throttle(rateLimit));
}
