// T098 — the two surfaces share nothing, and the user surface's type carries no administrative
// capability (FR-048, SC-012, R-API-11; contracts/kernel.md "Two surfaces").
//
// An administrative capability is a procedure built with the administrator caller kind: its meta
// is `{ surface: 'admin' }`, in the procedure's type and at runtime (T107). Two checks read it:
//
//   in the type   `ProceduresOfSurface` collects the procedures of a router's type whose meta names
//                 a surface, so the user surface's type is asserted to hold no administrator one.
//                 That is the one that matters: a capability in the user surface's type has leaked
//                 into the mobile bundle's vocabulary even if no screen calls it.
//   at runtime    every procedure mounted on a surface is read, so an administrator procedure on the
//                 user surface, a user procedure on the administrator surface, and one procedure
//                 mounted on both are each reported.
//
// The real routers are empty until modules gain procedures, so on them both checks pass without
// proving anything. The fixtures below therefore build routers holding a real procedure of each
// kind: a pair that keeps the surfaces apart, which passes, and routers that leak, which fail, so
// the checks are shown to bite before the real routers give them anything to read.
import type { AnyProcedure, AnyRouter } from '@trpc/server';
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
  administrativeOnUser: string[];
  userOnAdministrator: string[];
  mountedOnBoth: string[];
} {
  const userProcedures = proceduresOf(user);
  const adminProcedures = proceduresOf(administrator);
  const adminSet = new Set(adminProcedures.values());
  return {
    administrativeOnUser: [...userProcedures]
      .filter(([, procedure]) => surfaceOf(procedure) !== 'app')
      .map(([path]) => path),
    userOnAdministrator: [...adminProcedures]
      .filter(([, procedure]) => surfaceOf(procedure) !== 'admin')
      .map(([path]) => path),
    mountedOnBoth: [...userProcedures]
      .filter(([, procedure]) => adminSet.has(procedure))
      .map(([path]) => path),
  };
}

const kept = { administrativeOnUser: [], userOnAdministrator: [], mountedOnBoth: [] };

// A real procedure of each kind, as a module would declare them.
const catalogue = publicProcedure(z.void()).query(() => 'subjects');
const booking = studentProcedure(z.object({ slotId: z.string() })).mutation(() => 'held');
const availability = teacherProcedure(z.void()).query(() => 'slots');
const approval = adminProcedure(z.object({ teacherId: z.string() })).mutation(() => 'approved');

describe('the two surfaces share nothing (T098)', () => {
  it('the real surfaces: no administrative capability in the user surface, in its type or mounted', () => {
    expectTypeOf<ProceduresOfSurface<AppRouter, 'admin'>>().toBeNever();
    expectTypeOf<ProceduresOfSurface<AdminRouter, 'app'>>().toBeNever();
    expect(separation(appRouter, adminRouter)).toEqual(kept);
  });

  it('surfaces built from each kind keep apart: the checks read real procedures and pass', () => {
    const user = createAppRouter({
      catalogue: { list: catalogue },
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

  it('an administrator procedure mounted on the user surface is found in the type and at runtime', () => {
    const leaky = createAppRouter({
      catalogue: { list: catalogue },
      moderation: { approveTeacher: approval },
    });
    const administrator = createAdminRouter({ teachers: { approve: approval } });

    expectTypeOf<ProceduresOfSurface<typeof leaky, 'admin'>>().toEqualTypeOf<typeof approval>();
    expect(separation(leaky, administrator)).toEqual({
      ...kept,
      administrativeOnUser: ['moderation.approveTeacher'],
      mountedOnBoth: ['moderation.approveTeacher'],
    });
  });

  it('a user procedure mounted on the administrator surface is found in the type and at runtime', () => {
    const user = createAppRouter({ catalogue: { list: catalogue } });
    const administrator = createAdminRouter({
      teachers: { approve: approval },
      catalogue: { list: catalogue },
    });

    expectTypeOf<ProceduresOfSurface<typeof administrator, 'app'>>().toEqualTypeOf<
      typeof catalogue
    >();
    expect(separation(user, administrator)).toEqual({
      ...kept,
      userOnAdministrator: ['catalogue.list'],
      mountedOnBoth: ['catalogue.list'],
    });
  });
});
