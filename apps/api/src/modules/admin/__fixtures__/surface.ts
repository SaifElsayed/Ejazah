// T067: the admin module's routers as the administrator surface serves them, for the router specs.
// Each call goes through the caller kinds' middleware exactly as over HTTP: the input schema, the
// kind's refusals, the declared rate limit, one transaction and its audit entries, the output
// schema. The limiter records what it was asked to count and refuses a key past the count a spec
// gives it, so a spec reads the key and the subject of every count and can stand a throttle in
// front of the lockout. A signed-in caller is the one the module's own resolver reads from a bearer.
import { vi } from 'vitest';

import type { Database } from '../../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../../platform/db/transaction.repository.js';
import { DomainError } from '../../../platform/errors/domain-error.js';
import type { RateLimiter, RateLimitSubject } from '../../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../../platform/logging/logger.js';
import {
  type AdminSession,
  type AdminSurfaceServices,
  createAdminContext,
} from '../../../surfaces/context.js';
import { createAdminCallerFactory, createAdminRouter } from '../../../surfaces/procedures.js';
import { unusedAdminServices } from '../../../surfaces/services.fixtures.js';
import { AuditQueryService } from '../audit-query.service.js';
import { AuditRepository } from '../audit.repository.js';
import { adminsRouter } from '../admins.router.js';
import { auditRouter } from '../audit.router.js';
import { authRouter } from '../auth.router.js';
import { HomeService } from '../home.service.js';
import { homeRouter } from '../home.router.js';
import type { AdminWorld } from './admin.js';

export const SPEC_CLIENT = '203.0.113.9';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });

/** The four namespaces, mounted as `admin.router.ts` mounts them. */
export const adminSurfaceRouter = createAdminRouter({
  auth: authRouter,
  admins: adminsRouter,
  audit: auditRouter,
  home: homeRouter,
});

/** A procedure's meta, as the contract snapshot and the gates read it. */
export function metaOf(path: string): unknown {
  const procedures = adminSurfaceRouter._def.procedures as unknown as Record<
    string,
    { readonly _def: { readonly meta?: unknown } }
  >;
  return procedures[path]?._def.meta;
}

const callerFor = createAdminCallerFactory(adminSurfaceRouter);

export type AdminCaller = ReturnType<typeof callerFor>;

export interface AdminSurface {
  /** Every count asked for, as `[key, subject]`, in order, refused ones included. */
  readonly counts: () => unknown[][];
  readonly anonymous: () => AdminCaller;
  /** The caller a bearer resolves to; anonymous when the resolver refuses it. */
  readonly bearing: (sessionToken: string) => Promise<AdminCaller>;
}

export function surfaceOf(
  world: AdminWorld,
  database: Database,
  options: { readonly refuseAfter?: Readonly<Record<string, number>> } = {},
): AdminSurface {
  const seen = new Map<string, number>();
  const check = vi.fn(async (key: string, _subject: RateLimitSubject, _procedure: string) => {
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const limit = options.refuseAfter?.[key];
    if (limit !== undefined && count > limit) throw new DomainError('RATE_LIMITED');
  });
  const rateLimiter = { check } as unknown as RateLimiter;
  const audit = new AuditQueryService({ settings: world.settings });
  const services: AdminSurfaceServices = {
    auth: world.auth,
    sessions: world.sessions,
    admins: world.admins,
    audit,
    home: new HomeService({
      settings: world.settings,
      audit,
      queues: {
        applications: async () => ({ open: 0, oldestSubmittedAt: null, waitingOnApplicant: 0 }),
        credentials: async () => ({ open: 0, addedSubjects: 0, oldestSubmittedAt: null }),
      },
      now: world.clock.now,
    }),
    // The catalog module's review has its own router spec (`catalog/credentials-admin.router.spec.ts`).
    credentials: unusedAdminServices.credentials,
    applications: unusedAdminServices.applications,
    documents: unusedAdminServices.documents,
    teachers: unusedAdminServices.teachers,
    students: unusedAdminServices.students,
    payments: unusedAdminServices.payments,
    // The outage windows have their own router spec (`sessions/sessions-admin.router.spec.ts`).
    outages: unusedAdminServices.outages,
    // The sessions module's cancellation and monitor have their own router spec (the same file).
    sessionCancel: unusedAdminServices.sessionCancel,
    monitor: unusedAdminServices.monitor,
    // The review queue and the disputes queue have their own router specs (T033, T034).
    review: unusedAdminServices.review,
    disputes: unusedAdminServices.disputes,
  };
  const administration = {
    transactions: transactionsOver(database),
    auditWriter: new AuditRepository(),
  };
  const as = (session: AdminSession | null) =>
    callerFor(
      createAdminContext({
        session,
        log,
        administration,
        services,
        rateLimiter,
        clientAddress: SPEC_CLIENT,
      }),
    );
  return {
    // Each subject read back as the text it is counted under (T062): the budget's `*`, an identifier
    // itself, an administrator by id.
    counts: () => check.mock.calls.map(([key, subject]) => [key, countedText(subject)]),
    anonymous: () => as(null),
    bearing: async (sessionToken: string) => as(await world.sessions.resolve(sessionToken)),
  };
}

/** Signs `admin` in through the surface and passes the second factor: the verified session's token. */
export async function verifiedToken(
  surface: AdminSurface,
  world: AdminWorld,
  admin: { readonly adminId: string; readonly email: string; readonly password: string },
): Promise<string> {
  const { sessionToken } = await surface.anonymous().auth.signIn({
    email: admin.email,
    password: admin.password,
  });
  await surface
    .anonymous()
    .auth.mfa.verify({ sessionToken, code: await world.currentCode(admin.adminId) });
  return sessionToken;
}

/** The text a subject is counted under, as the endpoints named it before T062's subject kinds. */
function countedText(subject: RateLimitSubject): string {
  switch (subject.kind) {
    case 'budget':
      return '*';
    case 'identifier':
      return subject.value;
    case 'user':
      return subject.userId;
    case 'administrator':
      return subject.adminId;
  }
}
