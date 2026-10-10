// T107: the four caller kinds — public, student, teacher, administrator — and the only way to
// declare a procedure (FR-047, FR-050, R-API-11, R-API-12, R-SEC-8; contracts/kernel.md
// "Caller kinds", ARCHITECTURE §7.2).
//
// EACH KIND TAKES ITS INPUT SCHEMA as its argument, so a procedure cannot be declared without one
// and validation cannot be skipped: a procedure that takes nothing says so with `z.void()`. The base
// builders are not exported, so a procedure cannot be built around the kinds.
//
// A KIND NARROWS THE CONTEXT, it never mints: the student and teacher kinds refuse an anonymous
// caller (401) and a caller without the role active (403), then hand the handler a context whose
// `caller` is not null. The gender it carries is the `RequesterGender` the request context minted
// from the session (T106); nothing here builds one.
//
// TWO tRPC INSTANCES, one per surface, because the two contexts are separate types (R-SEC-8). Each
// stamps its procedures with the surface's meta, in the type and at runtime, so an administrative
// capability is recognisable wherever it is mounted (T098): `{ surface: 'admin' }` exists only on
// the administrator instance, and the user instance's meta type cannot express it. Each surface's
// router accepts only its own surface's procedures (`SurfaceRecord`), so a procedure of the other
// surface, or one built on any other tRPC instance, does not compile where it is mounted.
//
// THE ADMINISTRATOR KIND FAILS CLOSED until T108 gives it its audit record (R-API-12): after
// authenticating the administrator it refuses before any handler runs, so no administrative action
// exists, even for a moment, without the audit write around it.
//
// ONE ERROR FORMATTER on both instances: `toErrorShape`, which sends T101's `mapError` result and
// nothing else, so a tRPC error carries no stack, path or default shape (FR-041, R-API-8).
//
// The teacher kind admits a caller holding the teacher role, as the kernel contract words it.
// Whether an unapproved teacher's role counts as active is the session's to say when identity
// resolves sessions.
import {
  type AnyTRPCProcedure,
  type AnyTRPCRouter,
  initTRPC,
  TRPCError,
  type TRPCProcedureBuilder,
  type TRPCUnsetMarker,
} from '@trpc/server';
import type { z } from 'zod';
import { DomainError, type ErrorCode } from '../platform/errors/domain-error.js';
import { mapError, type MappedError } from '../platform/errors/error-filter.js';
import type { AdminContext, AdministratorCaller, AppContext, Role, UserCaller } from './context.js';

/** The meta of every user-surface procedure. */
export interface AppMeta {
  readonly surface: 'app';
}

/** The meta of every administrator-surface procedure: what makes it an administrative capability. */
export interface AdminMeta {
  readonly surface: 'admin';
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
 * does not parse) by its code. Everything else is the internal error.
 */
export function toErrorShape(error: TRPCError): MappedError {
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
  .create({ ...formatter, defaultMeta: { surface: 'app' }, isServer: true });

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

/** Calls a user-surface router in process, through the same middleware as over HTTP. */
export const createAppCallerFactory = app.createCallerFactory;

/** Calls an administrator-surface router in process, through the same middleware as over HTTP. */
export const createAdminCallerFactory = admin.createCallerFactory;

/**
 * What a caller kind returns: a builder over the surface's context with its input already set, to
 * be finished with `.query` or `.mutation`. Named because the declaration output must name it.
 */
type CallerKind<TContext, TMeta, TNarrowed, TIn, TOut> = TRPCProcedureBuilder<
  TContext,
  TMeta,
  TNarrowed,
  TIn,
  TOut,
  TRPCUnsetMarker,
  TRPCUnsetMarker,
  false
>;

/** Admits an authenticated user holding `role`, and narrows the context to that caller. */
function requireRole(role: Role) {
  return app.middleware(({ ctx, next }) => {
    if (ctx.caller === null) throw new DomainError('UNAUTHENTICATED');
    if (!ctx.caller.activeRoles.has(role)) throw new DomainError('FORBIDDEN');
    const caller: UserCaller = ctx.caller;
    return next({ ctx: { caller } });
  });
}

const requireAdministrator = admin.middleware(({ ctx, next }) => {
  if (ctx.administrator === null) throw new DomainError('UNAUTHENTICATED');
  return next({ ctx: { administrator: ctx.administrator } });
});

// Until T108: an administrative action without its audit record must not run (R-API-12).
const refuseUntilAudited = admin.middleware(() => {
  throw new Error(
    'The administrator caller kind has no audit writer yet (T108); refusing before the handler runs (R-API-12).',
  );
});

/** Anyone, authenticated or not. */
export function publicProcedure<TIn, TOut>(
  input: z.ZodType<TOut, TIn>,
): CallerKind<AppContext, AppMeta, object, TIn, TOut> {
  return app.procedure.input(input);
}

/** A caller holding the student role, active. */
export function studentProcedure<TIn, TOut>(
  input: z.ZodType<TOut, TIn>,
): CallerKind<AppContext, AppMeta, { caller: UserCaller }, TIn, TOut> {
  return app.procedure.use(requireRole('student')).input(input);
}

/** A caller holding the teacher role, active. */
export function teacherProcedure<TIn, TOut>(
  input: z.ZodType<TOut, TIn>,
): CallerKind<AppContext, AppMeta, { caller: UserCaller }, TIn, TOut> {
  return app.procedure.use(requireRole('teacher')).input(input);
}

/** An authenticated administrator. Exists on the administrator surface only (R-API-11). */
export function adminProcedure<TIn, TOut>(
  input: z.ZodType<TOut, TIn>,
): CallerKind<AdminContext, AdminMeta, { administrator: AdministratorCaller }, TIn, TOut> {
  return admin.procedure.use(requireAdministrator).use(refuseUntilAudited).input(input);
}
