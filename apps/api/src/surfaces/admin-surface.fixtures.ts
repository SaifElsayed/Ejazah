// T068: the administrator surface's context for a router spec outside the admin module, which builds
// its caller over its own namespaces (`createAdminCallerFactory`), so each call goes through the
// administrator kind's middleware as over HTTP
// (the input schema, the kind's refusals, one transaction and its audit entries, the output
// schema); the transaction is a stand-in the spec's services never read, and the audit writer
// records what the kind would insert, kept only when the call resolves. The session is handed in, as
// the admin module's resolver would yield it; the services a spec does not hand in throw when reached.
import type { AuditRecord } from '../platform/audit/audit-writer.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import {
  type AdminContext,
  type AdminSession,
  type AdminSurfaceServices,
  createAdminContext,
} from './context.js';
import { unusedAdminServices } from './services.fixtures.js';

/** The verified administrator a spec acts as. */
export const SPEC_ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';

/** Stands in for the call's transaction. */
export const SPEC_TX = {} as Transaction;

const log = createLogger({ level: 'info', destination: { write: () => undefined } });

/** The session of `SPEC_ADMIN`, second factor verified. */
export const VERIFIED: AdminSession = {
  adminId: SPEC_ADMIN,
  sessionId: SPEC_ADMIN,
  mfaVerified: true,
};

export interface AdminContexts {
  /** The audit records the kind wrote, in order; nothing of a refused call. */
  readonly written: AuditRecord[];
  readonly contextFor: (session: AdminSession | null) => AdminContext;
}

export function adminContextsOver(given: Partial<AdminSurfaceServices>): AdminContexts {
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      typeof name === 'string' && name in given
        ? given[name as keyof AdminSurfaceServices]
        : Reflect.get(target, name, receiver),
  }) as AdminSurfaceServices;
  const written: AuditRecord[] = [];
  const pending: AuditRecord[] = [];
  const administration = {
    transactions: {
      run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
        pending.length = 0;
        const answer = await work(SPEC_TX);
        written.push(...pending);
        return answer;
      },
    },
    auditWriter: {
      write: async (_tx: Transaction, record: AuditRecord) => {
        pending.push(record);
      },
    },
  };
  // Every administrator call is counted by the signed-in default since T062 (FR-470); the limit
  // itself is the kernel's spec's, so this limiter admits every call.
  const rateLimiter = { check: async () => undefined } as unknown as RateLimiter;
  return {
    written,
    contextFor: (session) =>
      createAdminContext({
        session,
        log,
        administration,
        services,
        rateLimiter,
        clientAddress: '203.0.113.9',
      }),
  };
}
