// T011 — the adversarial procedure harness (R-202, FR-410, SC-304; analysis U1; R-GENDER-1/2/3).
//
// Phase 1's suite (`gender.spec.ts`) attacks the visibility predicate as a function. A service that
// forgets to call it passes that suite, so Phase 2 attacks the procedures themselves (R-202,
// ARCHITECTURE §10): every student-facing procedure that returns teacher data or acts on a
// teacher's slot registers its attacks here and runs them through the real user-surface router.
//
// WHAT A REGISTRATION IS. A `ProcedureAttacks` names the procedure's path, the rules it holds, and
// one entry per attack kind of FR-410: a direct call, a forged id, a guessed id, a tampered token
// and a client-supplied gender. The record's type names every kind, so a registration that forgets
// one does not compile; a kind that cannot apply (a procedure that takes no id has nothing to forge)
// is written `notApplicable(reason)`, and a blank reason is refused. Each attack is a function of a
// `Direction` and asserts on its own; the harness runs it once as a male requester against female
// teachers and once as a female requester against male teachers (FR-064), never one direction alone.
// The world each attack calls into (teachers seeded in both genders and every excluded state) is
// the registration's own: every registration seeds rows and calls the real router, so the runner
// tags each with `database` and it runs only with `IJAZAH_DB_SPECS=1` (T124).
//
// NOT FOUND IS ONE SHAPE (R-GENDER-2). `expectAnswersAsNonexistent` calls the procedure once for an
// excluded teacher and once for an id that never existed, maps both refusals through the surface's
// one error formatter, and requires the same status and the same body: 404, `NOT_FOUND`, its one
// message, and no `details`, so nothing in the answer tells the two apart.
//
// WHAT MUST BE REGISTERED (FR-410, analysis U1). The procedures are read from the real `appRouter`:
// every one whose caller kind a student reaches (`public`, `user`, `student`; a procedure with no
// caller kind is read as reachable, the safe side), never a `teacher` one, which refuses a student
// (R-MOBILE-13's gate proves that). Every procedure of the `discovery`, `booking`, `checkout` and
// `enrollments` routers must be registered and cannot be exempt. Every other one must be registered
// or listed in `exemptProcedures` with its reason, so a later procedure whose output names a
// teacher or that acts on a teacher's slot fails the spec until someone decides which it is; an
// entry naming no such procedure fails too, so the lists cannot drift from the surface.
//
// Phase 1's student-facing procedures are exempt below. T028 registers `discovery`'s three from
// `discovery.attacks.ts`, and T043 the booking, checkout and enrollments procedures from a module of
// their own, each added to `registeredAttacks` in `registered-attacks.ts` as its router lands.
//
// T052 of specs/004-sessions (FR-496, SC-407; Q2 (a)): the `sessions`, `chat` and `live` routers
// join the ones that cannot be exempt, and their registrations are `SessionProcedureAttacks`, which
// also give FR-496's three kinds (`SESSION_ATTACK_KINDS`); `sessionKindFailures` fails one written
// without them. The declared limits T052 names are read from the real routers' meta
// (`declaredLimitFailures` over `DECLARED_LIMITS`), so a stamp lost or changed fails the spec.
import { $Enums } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { mapError, type MappedError } from '../../apps/api/src/platform/errors/error-filter.js';
import { toErrorShape } from '../../apps/api/src/surfaces/procedures.js';

type Gender = $Enums.Gender;

// ---------------------------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------------------------

/** One requester gender against the other: every attack runs in both (FR-064). */
export interface Direction {
  readonly name: string;
  readonly requester: Gender;
  readonly other: Gender;
}

export const directions: readonly Direction[] = [
  {
    name: 'a male requester against female teachers',
    requester: $Enums.Gender.male,
    other: $Enums.Gender.female,
  },
  {
    name: 'a female requester against male teachers',
    requester: $Enums.Gender.female,
    other: $Enums.Gender.male,
  },
];

// ---------------------------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------------------------

/** FR-410's attacks: a direct call, forged and guessed ids, a tampered token, a client-supplied gender. */
export const ATTACK_KINDS = [
  'directCall',
  'forgedId',
  'guessedId',
  'tamperedToken',
  'clientSuppliedGender',
] as const;

export type AttackKind = (typeof ATTACK_KINDS)[number];

/** One attack, in one direction; it asserts on its own and rejects when the procedure leaks. */
export type Attack = (direction: Direction) => Promise<void>;

/** An attack kind the procedure gives nothing to aim at, with the reason. */
export interface NotApplicable {
  readonly notApplicable: string;
}

export function notApplicable(reason: string): NotApplicable {
  return { notApplicable: reason };
}

/** A student-facing procedure's attacks, one per kind. */
export interface ProcedureAttacks {
  /** The procedure's path on the user surface, as `appRouter` flattens it (`discovery.teacher`). */
  readonly path: string;
  /** The rules the attacks hold, printed with each case. */
  readonly holds: string;
  readonly attacks: Readonly<Record<AttackKind, Attack | NotApplicable>>;
}

/**
 * T052 of specs/004-sessions (Q2 (a)): the three attacks FR-496 names beyond FR-410's five, which
 * every registration of the `sessions`, `chat` and `live` routers gives (Phase 2's are unchanged).
 *
 *   otherSessionToken      another session's token: a join token is bound to its own session, so
 *                          holding one opens no other.
 *   replayedToken          a token replayed by the other participant: each party's token names that
 *                          party, never the other.
 *   afterGenderCorrection  after an administrator's gender correction, the corrected record decides
 *                          (`users.gender` changed in the world, the note under T011, K2).
 */
export const SESSION_ATTACK_KINDS = [
  'otherSessionToken',
  'replayedToken',
  'afterGenderCorrection',
] as const;

export type SessionAttackKind = (typeof SESSION_ATTACK_KINDS)[number];

/** A registration of the `sessions`, `chat` or `live` router: FR-410's five and FR-496's three. */
export interface SessionProcedureAttacks {
  readonly path: string;
  readonly holds: string;
  readonly attacks: Readonly<Record<AttackKind | SessionAttackKind, Attack | NotApplicable>>;
}

/** Any registration the harness runs. */
export type Registration = ProcedureAttacks | SessionProcedureAttacks;

/** One attack of one registration in one direction. */
export interface AttackCase {
  readonly title: string;
  readonly path: string;
  readonly kind: AttackKind | SessionAttackKind;
  readonly direction: Direction;
  run(): Promise<void>;
}

function isNotApplicable(entry: Attack | NotApplicable): entry is NotApplicable {
  return typeof entry !== 'function';
}

/** The entry a registration gives `kind`, or undefined when it gives none. */
function entryOf(
  registration: Registration,
  kind: AttackKind | SessionAttackKind,
): Attack | NotApplicable | undefined {
  const entry: unknown = Reflect.get(registration.attacks, kind);
  return typeof entry === 'function' || (typeof entry === 'object' && entry !== null)
    ? (entry as Attack | NotApplicable)
    : undefined;
}

/** Every applicable attack of every registration, once per direction. */
export function attackCases(registrations: readonly Registration[]): AttackCase[] {
  return registrations.flatMap((registration) =>
    [...ATTACK_KINDS, ...SESSION_ATTACK_KINDS].flatMap((kind) => {
      const { path, holds } = registration;
      const entry = entryOf(registration, kind);
      if (entry === undefined) {
        // A Phase 2 registration gives none of FR-496's three; a missing one of a Phase 3
        // registration is `sessionKindFailures`' to report.
        if ((SESSION_ATTACK_KINDS as readonly string[]).includes(kind)) return [];
        throw new Error(`${path}: ${kind} is not registered (FR-410)`);
      }
      if (isNotApplicable(entry)) {
        if (entry.notApplicable.trim() === '') {
          throw new Error(`${path}: ${kind} is marked not applicable without a reason (FR-410)`);
        }
        return [];
      }
      return directions.map((direction) => ({
        title: `${path}, ${kind}: ${direction.name} (${holds})`,
        path,
        kind,
        direction,
        run: () => entry(direction),
      }));
    }),
  );
}

/** How long one attack may run: the first case of a registration seeds the world (T028). */
const ATTACK_TIMEOUT_MS = 180_000;

/** The registered attacks as cases, each registration on the database only (T124). */
export function describeProcedureAttacks(registrations: readonly Registration[]): void {
  for (const registration of registrations) {
    const options = { tags: ['database'], timeout: ATTACK_TIMEOUT_MS };
    describe(`the attacks on ${registration.path}`, options, () => {
      for (const attackCase of attackCases([registration])) {
        it(attackCase.title, () => attackCase.run());
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Not found is one shape
// ---------------------------------------------------------------------------------------------

/** A tRPC error as the surface's formatter takes it; the harness reaches tRPC only through the API. */
type SurfaceError = Parameters<typeof toErrorShape>[0];

function isSurfaceError(error: unknown): error is SurfaceError {
  return error instanceof Error && error.name === 'TRPCError';
}

/** What the client would receive for a refused call: the one formatter's status and body. */
async function refusalOf(call: () => Promise<unknown>, which: string): Promise<MappedError> {
  try {
    await call();
  } catch (error) {
    return isSurfaceError(error) ? toErrorShape(error) : mapError(error);
  }
  throw new Error(`${which} answered where it must be refused as not found (R-GENDER-2)`);
}

/**
 * An excluded teacher answers exactly as a nonexistent one: both refused, 404, the same body, and
 * no field in it (R-GENDER-2, R-202).
 */
export async function expectAnswersAsNonexistent(
  excluded: () => Promise<unknown>,
  nonexistent: () => Promise<unknown>,
): Promise<void> {
  const absent = await refusalOf(nonexistent, 'the nonexistent id');
  expect(absent.status, 'a nonexistent id answers 404 (R-GENDER-2)').toBe(404);
  expect(absent.body.code).toBe('NOT_FOUND');
  expect(Object.keys(absent.body).sort(), 'a not-found body carries no field').toEqual([
    'code',
    'message',
  ]);
  const hidden = await refusalOf(excluded, 'the excluded teacher');
  expect(
    { status: hidden.status, body: hidden.body },
    'an excluded teacher answers exactly as a nonexistent one (R-GENDER-2)',
  ).toStrictEqual({ status: absent.status, body: absent.body });
}

// ---------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------

/** The routers whose every procedure returns teacher data or acts on a teacher's slot (FR-410). */
const SLOT_ROUTERS = ['discovery', 'booking', 'checkout', 'enrollments'] as const;

/**
 * T052 of specs/004-sessions: the routers whose every procedure issues a token or reads a session,
 * its chat or its counterparty (FR-496): `sessions` with its `cancellation`, `remedy`, `dispute`
 * and `complaint`, `chat`, and `live` (`live.events` delivers chat to a person, contracts/kernel.md
 * "Gates").
 */
const SESSION_ROUTERS = ['sessions', 'chat', 'live'] as const;

/** The routers none of whose procedures can be exempt. */
export const ATTACKED_ROUTERS = [...SLOT_ROUTERS, ...SESSION_ROUTERS] as const;

/** A student-facing procedure outside the attacked routers that names no teacher, and why. */
export interface Exemption {
  readonly path: string;
  readonly reason: string;
}

/** A tRPC router as the harness reads it: its flattened procedures, keyed by path. */
export interface RouterLike {
  readonly _def: { readonly procedures: object };
}

/** The caller kinds a student can never reach: the procedure refuses the role first. */
const NOT_STUDENT_FACING: ReadonlySet<string> = new Set(['teacher']);

/** One field of a procedure's meta, as its kind stamped it. */
function metaField(procedure: unknown, field: 'caller' | 'rateLimit'): unknown {
  const definition: unknown =
    typeof procedure === 'function' || (typeof procedure === 'object' && procedure !== null)
      ? Reflect.get(procedure, '_def')
      : undefined;
  const meta: unknown =
    typeof definition === 'object' && definition !== null
      ? Reflect.get(definition, 'meta')
      : undefined;
  return typeof meta === 'object' && meta !== null ? Reflect.get(meta, field) : undefined;
}

function callerOf(procedure: unknown): unknown {
  return metaField(procedure, 'caller');
}

function isSessionRouterPath(path: string): boolean {
  return (SESSION_ROUTERS as readonly string[]).includes(path.split('.')[0] ?? '');
}

/**
 * The paths of the procedures a student can reach, and every procedure of `sessions`, `chat` and
 * `live` whatever its caller kind, sorted. FR-496 protects both directions, so a teacher-kind
 * procedure there must be registered too (#142 r1, Major 1).
 */
export function studentFacingProcedures(router: RouterLike): string[] {
  return Object.entries(router._def.procedures)
    .filter(([path, procedure]) => {
      if (isSessionRouterPath(path)) return true;
      const caller = callerOf(procedure);
      return typeof caller !== 'string' || !NOT_STUDENT_FACING.has(caller);
    })
    .map(([path]) => path)
    .sort();
}

function attackedRouterOf(path: string): string | undefined {
  const router = path.split('.')[0] ?? '';
  return (ATTACKED_ROUTERS as readonly string[]).includes(router) ? router : undefined;
}

/** Why a procedure of `router` is never exempt. */
function neverExemptBecause(router: string): string {
  return (SESSION_ROUTERS as readonly string[]).includes(router)
    ? `issues a token or reads a session, its chat or its counterparty, so it registers its attacks and is never exempt (FR-496, FR-410, T052)`
    : `returns teacher data or acts on a teacher's slot, so it registers its attacks and is never exempt (FR-410, analysis U1)`;
}

/** Why the surface's student-facing procedures and the two lists disagree, one line per path. */
export function coverageFailures(
  procedures: readonly string[],
  registered: readonly string[],
  exempt: readonly Exemption[],
): string[] {
  const reachable = new Set(procedures);
  const isRegistered = new Set(registered);
  const exemption = new Map(exempt.map((entry) => [entry.path, entry]));
  const failures: string[] = [];

  for (const path of procedures) {
    const router = attackedRouterOf(path);
    const exempted = exemption.get(path);
    if (router !== undefined && !isRegistered.has(path)) {
      failures.push(`${path}: a procedure of the ${router} router ${neverExemptBecause(router)}`);
      continue;
    }
    if (isRegistered.has(path) && exempted !== undefined) {
      failures.push(`${path}: both registered and exempt; it is one or the other (FR-410)`);
      continue;
    }
    if (!isRegistered.has(path) && exempted === undefined) {
      failures.push(
        `${path}: neither registered nor exempt: register its attacks if its output names a teacher or it acts on a teacher's slot, otherwise list it as exempt with its reason (FR-410, analysis U1)`,
      );
      continue;
    }
    if (exempted !== undefined && exempted.reason.trim() === '') {
      failures.push(`${path}: exempt without a reason (analysis U1)`);
    }
  }

  const listed = [...new Set([...registered, ...exempt.map((entry) => entry.path)])];
  for (const path of listed.filter((entry) => !reachable.has(entry)).sort()) {
    failures.push(
      `${path}: listed by the harness but not a student-facing procedure of the user surface`,
    );
  }
  return failures.sort();
}

/**
 * T052 (Q2 (a)): each registration of the `sessions`, `chat` or `live` router that does not give
 * one of FR-496's three kinds, an attack or `notApplicable` with its reason, one line per kind. The
 * type refuses a `SessionProcedureAttacks` without one; this catches a Phase 3 registration written
 * as a Phase 2 one.
 */
export function sessionKindFailures(registrations: readonly Registration[]): string[] {
  const failures: string[] = [];
  for (const registration of registrations) {
    const router = registration.path.split('.')[0] ?? '';
    if (!(SESSION_ROUTERS as readonly string[]).includes(router)) continue;
    for (const kind of SESSION_ATTACK_KINDS) {
      const entry = entryOf(registration, kind);
      if (entry === undefined) {
        failures.push(
          `${registration.path}: a procedure of the ${router} router registers ${kind}, an attack or not applicable with its reason (FR-496, T052)`,
        );
      } else if (isNotApplicable(entry) && entry.notApplicable.trim() === '') {
        failures.push(
          `${registration.path}: ${kind} is marked not applicable without a reason (FR-496, T052)`,
        );
      }
    }
  }
  return failures.sort();
}

// ---------------------------------------------------------------------------------------------
// The declared limits
// ---------------------------------------------------------------------------------------------

/** A procedure whose meta must carry `key` as its declared limit, and where that was decided. */
export interface DeclaredLimit {
  /** The procedure's path on its surface, as the router flattens it. */
  readonly path: string;
  /** The settings key its kind stamps in the meta's `rateLimit`. */
  readonly key: `rate_limit_${string}`;
  readonly source: string;
}

/**
 * Why each `expected` procedure's meta does not carry its declared key, one line per path: read
 * from the real router's `_def.procedures`, the meta `AppMeta.rateLimit` or `AdminMeta.rateLimit`
 * its kind stamped, so a stamp removed or changed in a router fails here (T052, G1).
 */
export function declaredLimitFailures(
  router: RouterLike,
  expected: readonly DeclaredLimit[],
): string[] {
  const failures: string[] = [];
  for (const { path, key, source } of expected) {
    const procedure: unknown = Reflect.get(router._def.procedures, path);
    if (procedure === undefined) {
      failures.push(`${path}: not a procedure of the surface; ${source} names it`);
      continue;
    }
    const declared = metaField(procedure, 'rateLimit');
    if (declared === undefined) {
      failures.push(`${path}: declares no limit, where ${source} requires ${key}`);
    } else if (declared !== key) {
      failures.push(`${path}: declares ${String(declared)}, where ${source} requires ${key}`);
    }
  }
  return failures.sort();
}

const LINE = 'T052’s line (the owner’s decision of 2026-11-06, G1)';
const SEARCH = 'T052’s line, the three name searches (the owner’s decision of 2026-11-06, G4)';
const FOLLOW_UP = 'T052’s follow-up (B42c’s conflict check, Q-R16 (a))';

/**
 * Every limit T052's line and its follow-up name, per surface: the user kinds' `rateLimit` and the
 * administrator kind's `AdminMeta.rateLimit`.
 */
export const DECLARED_LIMITS: {
  readonly app: readonly DeclaredLimit[];
  readonly admin: readonly DeclaredLimit[];
} = {
  app: [
    { path: 'sessions.complaint.raise', key: 'rate_limit_absence_complaint', source: LINE },
    { path: 'live.events', key: 'rate_limit_live_channel', source: LINE },
    { path: 'teacher.students.list', key: 'rate_limit_search', source: SEARCH },
  ],
  admin: [
    { path: 'disputes.revise', key: 'rate_limit_dispute_revision', source: LINE },
    { path: 'sessions.restore', key: 'rate_limit_enrollment_restore', source: LINE },
    { path: 'sessions.review.revise', key: 'rate_limit_outcome_correction', source: LINE },
    { path: 'cases.openManual', key: 'rate_limit_manual_compensation_case', source: LINE },
    { path: 'sessions.monitor.list', key: 'rate_limit_search', source: SEARCH },
    { path: 'users.list', key: 'rate_limit_search', source: SEARCH },
    { path: 'enrollments.releaseSlot', key: 'rate_limit_slot_release', source: FOLLOW_UP },
    { path: 'students.liftBan', key: 'rate_limit_ban_lift', source: FOLLOW_UP },
    { path: 'teachers.liftBan', key: 'rate_limit_ban_lift', source: FOLLOW_UP },
    { path: 'teachers.liftRevocation', key: 'rate_limit_ban_lift', source: FOLLOW_UP },
    {
      path: 'teachers.keptData.documentLink',
      key: 'rate_limit_kept_document_link',
      source: FOLLOW_UP,
    },
    {
      path: 'teachers.keptData.setEraseDate',
      key: 'rate_limit_kept_data_erase_date',
      source: FOLLOW_UP,
    },
    {
      path: 'teachers.keptData.eraseNow',
      key: 'rate_limit_kept_data_erase_now',
      source: FOLLOW_UP,
    },
    { path: 'users.delete', key: 'rate_limit_admin_user_delete', source: FOLLOW_UP },
    { path: 'sessions.endEnrollment', key: 'rate_limit_enrollment_end', source: FOLLOW_UP },
  ],
};

// ---------------------------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------------------------

// The registrations themselves are listed in `registered-attacks.ts` (T028): each is written in a
// module of its own that imports this file, so the list that imports them lives outside it.

const SIGN_IN =
  'signs in or holds a session; returns tokens and the caller’s own landing, never a teacher';
const OWN_ACCOUNT =
  'acts on the caller’s own account only; names no other user and touches no slot';

/**
 * Phase 1's student-facing procedures: none returns teacher data or acts on a teacher's slot. Taken
 * in the narrow reading of T011 ("later" is after this task): a procedure here that comes to name a
 * teacher moves to `registeredAttacks` in the task that changes it.
 */
export const exemptProcedures: readonly Exemption[] = [
  // T004 of specs/005-certification (rule d): the student's own certificate name; answers it alone.
  { path: 'account.certificateName.set', reason: OWN_ACCOUNT },
  { path: 'account.delete', reason: OWN_ACCOUNT },
  {
    path: 'account.identityVerification.get',
    reason: 'the caller’s own identity-verification request; names no teacher',
  },
  {
    path: 'account.identityVerification.submit',
    reason: 'uploads the caller’s own identity document; names no teacher',
  },
  {
    path: 'account.me',
    reason:
      'the caller’s own account; its `teacher` field is the caller’s own application when the caller is a teacher, never another user',
  },
  // T005 of specs/005-certification (rule d): the caller's own push token; answers nothing.
  { path: 'account.pushToken.register', reason: OWN_ACCOUNT },
  { path: 'account.pushToken.remove', reason: OWN_ACCOUNT },
  { path: 'account.reportDeviceTimezone', reason: OWN_ACCOUNT },
  { path: 'account.setLanguage', reason: OWN_ACCOUNT },
  { path: 'account.setTimezone', reason: OWN_ACCOUNT },
  { path: 'account.updateProfile', reason: OWN_ACCOUNT },
  { path: 'auth.email.requestPasswordReset', reason: SIGN_IN },
  { path: 'auth.email.requestSignUpCode', reason: SIGN_IN },
  { path: 'auth.email.resetPassword', reason: SIGN_IN },
  { path: 'auth.email.signIn', reason: SIGN_IN },
  { path: 'auth.email.verifySignUpCode', reason: SIGN_IN },
  { path: 'auth.providerNonce', reason: SIGN_IN },
  { path: 'auth.refresh', reason: SIGN_IN },
  { path: 'auth.signInWithProvider', reason: SIGN_IN },
  { path: 'auth.signOut', reason: SIGN_IN },
  {
    path: 'catalog.subjects.list',
    reason:
      'the active subjects’ ids and names only; counts per subject are discovery’s, after the predicate (R-201)',
  },
  {
    path: 'onboarding.complete',
    reason: 'creates the caller’s own account; returns its tokens and landing',
  },
  { path: 'onboarding.requestEmailCode', reason: SIGN_IN },
  {
    path: 'platform.publicConfig',
    reason: 'the public configuration (support address, terms version); names no user',
  },
];
