// T098 — the two surfaces share nothing, and the user surface's type carries no administrative
// capability (FR-048, SC-012, R-API-11; contracts/kernel.md "Two surfaces").
//
// An administrative capability is a procedure built with the administrator caller kind: its meta
// is `{ surface: 'admin' }`, in the procedure's type and at runtime (T107). Three checks read it:
//
//   where mounted  `createAppRouter` and `createAdminRouter` accept only their own surface's
//                  procedures (T107's `SurfaceRecord`), so a procedure of the other surface, or one
//                  built on any other tRPC instance, does not compile where it is mounted. The leak
//                  fixtures below each carry the `@ts-expect-error` that proves it.
//   in the type    `ProceduresOfSurface` collects the procedures of a router's type whose meta names
//                  a surface, so the user surface's type is asserted to hold no administrator one:
//                  a capability in that type has leaked into the mobile bundle's vocabulary even if
//                  no screen calls it.
//   at runtime     every procedure mounted on a surface is read, so a procedure not built for the
//                  surface, and one procedure mounted on both, are each reported.
//
// The two type checks are enforced by `pnpm typecheck` (CI stage 1), not by vitest: `expectTypeOf`
// and `@ts-expect-error` do nothing at runtime, so this file passes under vitest even with a type
// check broken, and fails `tsc`.
//
// The real routers are empty until modules gain procedures, so on them the checks pass without
// proving anything. The fixtures below therefore build routers holding a real procedure of each
// kind: a pair that keeps the surfaces apart, which passes, and routers that leak, which fail, so
// the checks are shown to bite before the real routers give them anything to read.
import { type AnyProcedure, type AnyRouter, initTRPC } from '@trpc/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { type AdminRouter, adminRouter } from './admin.router.js';
import { type AppRouter, appRouter } from './app.router.js';
import {
  adminProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  teacherProcedure,
} from './procedures.js';

/** The procedures of a router record, at any depth, whose meta names `TSurface`. */
type ProceduresIn<TRecord, TSurface> = {
  [K in keyof TRecord]: TRecord[K] extends AnyProcedure
    ? TRecord[K]['meta'] extends { readonly surface: TSurface }
      ? TRecord[K]
      : never
    : TRecord[K] extends AnyRouter
      ? ProceduresIn<TRecord[K]['_def']['record'], TSurface>
      : ProceduresIn<TRecord[K], TSurface>;
}[keyof TRecord];

/** The procedures a router's type carries for one surface; `never` when it carries none. */
type ProceduresOfSurface<
  TRouter extends AnyRouter,
  TSurface extends 'app' | 'admin',
> = ProceduresIn<TRouter['_def']['record'], TSurface>;

/** Every procedure a router serves, by its dotted path. */
function proceduresOf(router: AnyRouter): ReadonlyMap<string, AnyProcedure> {
  return new Map(Object.entries(router._def.procedures as Record<string, AnyProcedure>));
}

function surfaceOf(procedure: AnyProcedure): unknown {
  return (procedure._def.meta as { surface?: unknown } | undefined)?.surface;
}

/** What keeps the two surfaces apart, as the paths that break it. Every list is empty when it holds. */
function separation(
  user: AnyRouter,
  administrator: AnyRouter,
): {
  notOfUserSurface: string[];
  notOfAdministratorSurface: string[];
  mountedOnBoth: string[];
} {
  const userProcedures = proceduresOf(user);
  const adminProcedures = proceduresOf(administrator);
  const adminSet = new Set(adminProcedures.values());
  return {
    notOfUserSurface: [...userProcedures]
      .filter(([, procedure]) => surfaceOf(procedure) !== 'app')
      .map(([path]) => path),
    notOfAdministratorSurface: [...adminProcedures]
      .filter(([, procedure]) => surfaceOf(procedure) !== 'admin')
      .map(([path]) => path),
    mountedOnBoth: [...userProcedures]
      .filter(([, procedure]) => adminSet.has(procedure))
      .map(([path]) => path),
  };
}

const kept = { notOfUserSurface: [], notOfAdministratorSurface: [], mountedOnBoth: [] };

// A real procedure of each kind, as a module would declare them.
const catalogue = publicProcedure({
  input: z.void(),
  output: z.string(),
  rateLimit: { key: 'rate_limit_search', subjectOf: () => 'anyone' },
}).query(() => 'subjects');
const booking = studentProcedure({
  input: z.object({ slotId: z.string() }),
  output: z.string(),
}).mutation(() => 'held');
const availability = teacherProcedure({ input: z.void(), output: z.string() }).query(
  () => 'slots',
);
const approval = adminProcedure({
  input: z.object({ teacherId: z.string() }),
  output: z.string(),
}).mutation(() => 'approved');
// A procedure built around the caller kinds, on a tRPC instance of its own.
const stray = initTRPC.create().procedure.query(() => 'stray');

describe('the two surfaces share nothing (T098)', () => {
  it('the real surfaces: no administrative capability in the user surface, in its type or mounted', () => {
    expectTypeOf<ProceduresOfSurface<AppRouter, 'admin'>>().toBeNever();
    expectTypeOf<ProceduresOfSurface<AdminRouter, 'app'>>().toBeNever();
    expect(separation(appRouter, adminRouter)).toEqual(kept);
  });

  it('surfaces built from each kind keep apart: the checks read real procedures and pass', () => {
    const user = createAppRouter({
      // A module's own router, built for the same surface, mounts like a procedure.
      catalogue: createAppRouter({ list: catalogue }),
      booking,
      availability,
    });
    const administrator = createAdminRouter({ teachers: { approve: approval } });

    expect(proceduresOf(user).size).toBe(3);
    expect(proceduresOf(administrator).size).toBe(1);
    expectTypeOf<ProceduresOfSurface<typeof user, 'admin'>>().toBeNever();
    expectTypeOf<ProceduresOfSurface<typeof administrator, 'app'>>().toBeNever();
    expectTypeOf<ProceduresOfSurface<typeof administrator, 'admin'>>().toEqualTypeOf<
      typeof approval
    >();
    expect(separation(user, administrator)).toEqual(kept);
  });

  // T170: a declared rate limit is stamped in the procedure's meta beside its surface, so what a
  // surface serves can be read for its limits as it is read for its surface.
  it('a procedure’s meta names its surface and, when declared, its rate limit (T170)', () => {
    const user = createAppRouter({ catalogue: { list: catalogue }, booking, availability });
    const metaOf = (path: string) =>
      (proceduresOf(user).get(path)?._def.meta ?? undefined) as
        | { surface: string; rateLimit?: string }
        | undefined;
    expect(metaOf('catalogue.list')).toEqual({ surface: 'app', rateLimit: 'rate_limit_search' });
    expect(metaOf('booking')).toEqual({ surface: 'app' });
    expect(metaOf('availability')).toEqual({ surface: 'app' });
  });

  it('the type collector finds a procedure of the named surface at any depth', () => {
    type Leaky = {
      catalogue: { list: typeof catalogue };
      moderation: { approve: typeof approval };
    };
    expectTypeOf<ProceduresIn<Leaky, 'admin'>>().toEqualTypeOf<typeof approval>();
    expectTypeOf<ProceduresIn<Leaky, 'app'>>().toEqualTypeOf<typeof catalogue>();
  });

  it('an administrator procedure mounted on the user surface does not compile, and is found at runtime', () => {
    const leaky = createAppRouter({
      catalogue: { list: catalogue },
      // @ts-expect-error -- T098: an administrator procedure cannot be mounted on the user surface
      moderation: { approveTeacher: approval },
    });
    const administrator = createAdminRouter({ teachers: { approve: approval } });

    expect(separation(leaky, administrator)).toEqual({
      ...kept,
      notOfUserSurface: ['moderation.approveTeacher'],
      mountedOnBoth: ['moderation.approveTeacher'],
    });
  });

  it('a user procedure mounted on the administrator surface does not compile, and is found at runtime', () => {
    const user = createAppRouter({ catalogue: { list: catalogue } });
    const administrator = createAdminRouter({
      teachers: { approve: approval },
      // @ts-expect-error -- T098: a user procedure cannot be mounted on the administrator surface
      catalogue: { list: catalogue },
    });

    expect(separation(user, administrator)).toEqual({
      ...kept,
      notOfAdministratorSurface: ['catalogue.list'],
      mountedOnBoth: ['catalogue.list'],
    });
  });

  it('a procedure built on another tRPC instance does not compile on either surface, and is found at runtime', () => {
    const user = createAppRouter({
      // @ts-expect-error -- T098: not built by a user caller kind
      stray,
    });
    const administrator = createAdminRouter({
      // @ts-expect-error -- T098: not built by the administrator caller kind
      stray,
    });

    expect(separation(user, administrator)).toEqual({
      notOfUserSurface: ['stray'],
      notOfAdministratorSurface: ['stray'],
      mountedOnBoth: ['stray'],
    });
  });
});
