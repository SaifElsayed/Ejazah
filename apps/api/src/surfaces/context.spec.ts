// T162 — the two surfaces' contexts cannot stand in for each other (R-SEC-8, FR-032, US2 scenario 11).
//
// Each context carries a discriminant, `surface`, so the separation holds by design: a field added
// to one context tomorrow, or removed from the other, cannot make them assignable. The `@ts-expect-
// error` lines are the proof and `pnpm typecheck` enforces them (each tsconfig includes the spec
// files): if either assignment ever compiles, the directive is unused and the build fails.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createLogger } from '../platform/logging/logger.js';
import type { Transactions } from '../platform/db/transaction.repository.js';
import type { AuditWriter } from '../platform/audit/audit-writer.js';
import {
  type AdminContext,
  type AppContext,
  createAdminContext,
  createAppContext,
} from './context.js';

const log = createLogger({ level: 'fatal' });
const administration = {
  transactions: {} as Transactions,
  auditWriter: {} as AuditWriter,
};

describe('the user and administrator contexts (T162, R-SEC-8)', () => {
  it('each names its surface, set by its own factory', () => {
    expect(createAppContext({ session: null, log }).surface).toBe('app');
    expect(createAdminContext({ session: null, log, administration }).surface).toBe('admin');
    expectTypeOf<AppContext['surface']>().toEqualTypeOf<'app'>();
    expectTypeOf<AdminContext['surface']>().toEqualTypeOf<'admin'>();
  });

  it('neither is assignable to the other, in either direction', () => {
    const app: AppContext = createAppContext({ session: null, log });
    const admin: AdminContext = createAdminContext({ session: null, log, administration });

    // @ts-expect-error -- T162: a user context is never an administrator context (R-SEC-8).
    const asAdmin: AdminContext = app;
    // @ts-expect-error -- T162: an administrator context is never a user context (R-SEC-8).
    const asApp: AppContext = admin;

    expectTypeOf<AppContext>().not.toMatchTypeOf<AdminContext>();
    expectTypeOf<AdminContext>().not.toMatchTypeOf<AppContext>();
    expect([asAdmin.surface, asApp.surface]).toEqual(['app', 'admin']);
  });

  it('a context that has every field of the other but its own surface is still refused', () => {
    const app = createAppContext({ session: null, log });
    // Every field the administrator context has, added to a user context, except its surface.
    const widened = { ...app, administrator: null, administration };

    // @ts-expect-error -- T162: the discriminant alone keeps the two apart (R-SEC-8).
    const asAdmin: AdminContext = widened;
    expect(asAdmin.surface).toBe('app');
  });
});
