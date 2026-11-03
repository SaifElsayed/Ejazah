// T162 — the two surfaces' contexts cannot stand in for each other (R-SEC-8, FR-032, US2 scenario 11).
//
// Each context carries a discriminant, `surface`, so the separation holds by design: a field added
// to one context tomorrow, or removed from the other, cannot make them assignable. The `@ts-expect-
// error` lines are the proof and `pnpm typecheck` enforces them (each tsconfig includes the spec
// files): if either assignment ever compiles, the directive is unused and the build fails.
//
// T016 — what the contexts read of a Phase 1 session and of the request (specs/002-identity/
// contracts/kernel.md "Session resolution", data-model §6): the bearer token the resolvers take,
// the one role and the account's standing the caller carries, the administrator's second-factor
// state, and `clientAddress`: the socket's peer, or the trusted proxy header's LAST hop and never
// the first, which the client writes itself. The request logger carries the address reduced to
// its network (R-SEC-2).
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createLogger } from '../platform/logging/logger.js';
import type { Transactions } from '../platform/db/transaction.repository.js';
import type { AuditWriter } from '../platform/audit/audit-writer.js';
import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import {
  type AdminContext,
  type AppContext,
  bearerOf,
  clientAddressOf,
  createAdminContext,
  createAppContext,
  type UserSession,
} from './context.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCheckoutServices,
  unusedCatalogServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from './services.fixtures.js';

const log = createLogger({ level: 'fatal' });
const administration = {
  transactions: {} as Transactions,
  auditWriter: {} as AuditWriter,
};
const rateLimiter = {} as RateLimiter;
const clientAddress = '203.0.113.7';

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
  catalog: unusedCatalogServices,
  teacherProfile: unusedTeacherProfileServices,
  discovery: unusedDiscoveryServices,
  booking: unusedBookingServices,
  checkout: unusedCheckoutServices,
};

const appSource = { session: null, log, rateLimiter, clientAddress, services };
const adminSource = {
  session: null,
  log,
  administration,
  services: unusedAdminServices,
  rateLimiter,
  clientAddress,
};

describe('the user and administrator contexts (T162, R-SEC-8)', () => {
  it('each names its surface, set by its own factory', () => {
    expect(createAppContext(appSource).surface).toBe('app');
    expect(createAdminContext(adminSource).surface).toBe('admin');
    expectTypeOf<AppContext['surface']>().toEqualTypeOf<'app'>();
    expectTypeOf<AdminContext['surface']>().toEqualTypeOf<'admin'>();
  });

  it('neither is assignable to the other, in either direction', () => {
    const app: AppContext = createAppContext(appSource);
    const admin: AdminContext = createAdminContext(adminSource);

    // @ts-expect-error -- T162: a user context is never an administrator context (R-SEC-8).
    const asAdmin: AdminContext = app;
    // @ts-expect-error -- T162: an administrator context is never a user context (R-SEC-8).
    const asApp: AppContext = admin;

    expectTypeOf<AppContext>().not.toMatchTypeOf<AdminContext>();
    expectTypeOf<AdminContext>().not.toMatchTypeOf<AppContext>();
    expect([asAdmin.surface, asApp.surface]).toEqual(['app', 'admin']);
  });

  it('a context that has every field of the other but its own surface is still refused', () => {
    const app = createAppContext(appSource);
    // Every field the administrator context has, added to a user context, except its surface.
    const widened = { ...app, administrator: null, administration };

    // @ts-expect-error -- T162: the discriminant alone keeps the two apart (R-SEC-8).
    const asAdmin: AdminContext = widened;
    expect(asAdmin.surface).toBe('app');
  });
});

describe('what the contexts read of a session (T016, FR-108, data-model §6)', () => {
  const teacher: UserSession = {
    userId: 'teacher-1',
    sessionId: 'session-9',
    role: 'teacher',
    accountStatus: 'verification_required',
    gender: 'male',
    preferredLanguage: 'en',
    teacher: {
      verificationStatus: 'approved',
      payoutVerified: true,
      applicationStatus: 'approved',
    },
  };

  it('the user caller carries the one role, the standing, the session and the teacher standing', () => {
    const context = createAppContext({ ...appSource, session: teacher });
    expect(context.caller).toEqual({
      userId: 'teacher-1',
      sessionId: 'session-9',
      role: 'teacher',
      accountStatus: 'verification_required',
      gender: 'male',
      teacher: {
        verificationStatus: 'approved',
        payoutVerified: true,
        applicationStatus: 'approved',
      },
    });
    expect(context.locale).toBe('en');
    expect(context.clientAddress).toBe(clientAddress);
  });

  it('a student carries no teacher standing, and an anonymous request no caller', () => {
    const { teacher: _standing, ...rest } = teacher;
    const student: UserSession = { ...rest, role: 'student' };
    expect(createAppContext({ ...appSource, session: student }).caller).not.toHaveProperty(
      'teacher',
    );
    expect(createAppContext(appSource).caller).toBeNull();
  });

  it('the administrator caller carries whether the second factor was verified, and the context the limiter', () => {
    const context = createAdminContext({
      ...adminSource,
      session: { adminId: 'admin-1', sessionId: 'session-1', mfaVerified: false },
    });
    expect(context.administrator).toEqual({
      adminId: 'admin-1',
      sessionId: 'session-1',
      mfaVerified: false,
    });
    expect(context.rateLimiter).toBe(rateLimiter);
    expect(context.clientAddress).toBe(clientAddress);
  });
});

describe('the bearer token and the client address (T016, T017; contracts/kernel.md)', () => {
  it('reads the bearer token from the Authorization header and nothing else', () => {
    expect(bearerOf({ authorization: 'Bearer abc.def' })).toBe('abc.def');
    expect(bearerOf({ authorization: 'bearer abc.def' })).toBe('abc.def');
    expect(bearerOf({ authorization: 'Basic abc' })).toBeNull();
    expect(bearerOf({ authorization: 'Bearer' })).toBeNull();
    expect(bearerOf({ authorization: 'Bearer ' })).toBeNull();
    expect(bearerOf({})).toBeNull();
    // Two headers (a list, which Node never produces for Authorization) is not one bearer.
    expect(bearerOf({ authorization: ['Bearer a', 'Bearer b'] as unknown as string })).toBeNull();
  });

  const socket = '198.51.100.20';

  it('is the socket’s peer when no proxy is trusted, whatever header the client sends', () => {
    expect(
      clientAddressOf({ remoteAddress: socket, headers: { 'x-forwarded-for': '203.0.113.9' } }),
    ).toBe(socket);
  });

  it('is the trusted header’s last hop, the one the proxy appended; a client-supplied first hop is never the subject', () => {
    const forged = '1.2.3.4';
    const address = clientAddressOf(
      {
        remoteAddress: socket,
        headers: { 'x-forwarded-for': `${forged}, 203.0.113.9, 203.0.113.10` },
      },
      'X-Forwarded-For',
    );
    expect(address).toBe('203.0.113.10');
    expect(address).not.toBe(forged);
    expect(
      clientAddressOf(
        { remoteAddress: socket, headers: { 'x-real-ip': ' 203.0.113.11 ' } },
        'X-Real-IP',
      ),
    ).toBe('203.0.113.11');
  });

  it('is the socket’s peer when the key is set but the header is absent or empty', () => {
    expect(clientAddressOf({ remoteAddress: socket, headers: {} }, 'X-Forwarded-For')).toBe(socket);
    expect(
      clientAddressOf(
        { remoteAddress: socket, headers: { 'x-forwarded-for': ' , ' } },
        'X-Forwarded-For',
      ),
    ).toBe(socket);
  });

  it('names a socket without a peer address as unknown, so a limit still counts it under one subject', () => {
    expect(clientAddressOf({ remoteAddress: undefined, headers: {} })).toBe('unknown');
  });

  it('the request logger carries the address reduced to its network, never the address (R-SEC-2)', () => {
    const lines: string[] = [];
    const sink = createLogger({
      level: 'info',
      destination: { write: (line) => lines.push(line) },
    });
    createAppContext({ ...appSource, log: sink, clientAddress: '203.0.113.77' }).log.info('hello');
    createAdminContext({
      ...adminSource,
      log: sink,
      clientAddress: '2001:db8:85a3:8d3:1319:8a2e:370:7348',
    }).log.info('hello');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"clientAddress":"203.0.113.0/24"');
    expect(lines[0]).not.toContain('203.0.113.77');
    expect(lines[1]).toContain('"clientAddress":"2001:db8:85a3::/48"');
    expect(lines[1]).not.toContain('7348');
  });
});
