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
// The four routers do not exist yet. Today every student-facing procedure is Phase 1's and is
// exempt below; T028 and T043 add their registrations to `registeredAttacks`, each from its own
// module, as their routers land.
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

/** One attack of one registration in one direction. */
export interface AttackCase {
  readonly title: string;
  readonly path: string;
  readonly kind: AttackKind;
  readonly direction: Direction;
  run(): Promise<void>;
}

function isNotApplicable(entry: Attack | NotApplicable): entry is NotApplicable {
  return typeof entry !== 'function';
}

/** Every applicable attack of every registration, once per direction. */
export function attackCases(registrations: readonly ProcedureAttacks[]): AttackCase[] {
  return registrations.flatMap(({ path, holds, attacks }) =>
    ATTACK_KINDS.flatMap((kind) => {
      const entry = attacks[kind];
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

/** The registered attacks as cases, each registration on the database only (T124). */
export function describeProcedureAttacks(registrations: readonly ProcedureAttacks[]): void {
  for (const registration of registrations) {
    describe(`the attacks on ${registration.path}`, { tags: ['database'] }, () => {
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
export const ATTACKED_ROUTERS = ['discovery', 'booking', 'checkout', 'enrollments'] as const;

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

function callerOf(procedure: unknown): unknown {
  const definition: unknown =
    typeof procedure === 'function' || (typeof procedure === 'object' && procedure !== null)
      ? Reflect.get(procedure, '_def')
      : undefined;
  const meta: unknown =
    typeof definition === 'object' && definition !== null
      ? Reflect.get(definition, 'meta')
      : undefined;
  return typeof meta === 'object' && meta !== null ? Reflect.get(meta, 'caller') : undefined;
}

/** The paths of the procedures a student can reach, sorted. */
export function studentFacingProcedures(router: RouterLike): string[] {
  return Object.entries(router._def.procedures)
    .filter(([, procedure]) => {
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
      failures.push(
        `${path}: a procedure of the ${router} router returns teacher data or acts on a teacher's slot, so it registers its attacks and is never exempt (FR-410, analysis U1)`,
      );
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

// ---------------------------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------------------------

/** Every registration, run by `procedure-harness.spec.ts` in both directions; T028 and T043 add theirs. */
export const registeredAttacks: readonly ProcedureAttacks[] = [];

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
