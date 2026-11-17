// T069: the catalog module's `credentials` namespace as the administrator surface serves it, for its
// router spec. Each call goes through the administrator kind's middleware as over HTTP (the input
// schema, the kind's refusals, one transaction and its audit entries, the output schema); the
// transaction is a stand-in the memory store never reads, and the audit writer records what the
// kind would insert. The session is handed in, as the admin module's resolver would yield it.
import type { AuditRecord } from '../../platform/audit/audit-writer.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import {
  type AdminSession,
  type AdminSurfaceServices,
  createAdminContext,
} from '../../surfaces/context.js';
import { createAdminCallerFactory, createAdminRouter } from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { CredentialReviewService } from './credential-review.service.js';
import { credentialsAdminRouter } from './credentials-admin.router.js';
import { ADMIN, type MemoryReviewStore, TX } from './credential-review.fixtures.js';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });

/** The namespace mounted as `admin.router.ts` mounts it. */
const router = createAdminRouter({ credentials: credentialsAdminRouter });
const callerFor = createAdminCallerFactory(router);

export type CredentialsCaller = ReturnType<typeof callerFor>;

export const NOW = new Date('2026-10-22T10:00:00Z');

/** The page size the spec's settings answer: the router spec reads no more than one row. */
const PAGE_SIZE = 1;

export interface CredentialsSurface {
  /** The audit records the kind wrote, in order; nothing of a refused call. */
  readonly written: AuditRecord[];
  readonly as: (session: AdminSession | null) => CredentialsCaller;
  /** The verified administrator `ADMIN`. */
  readonly verified: () => CredentialsCaller;
}

export function surfaceOver(store: MemoryReviewStore): CredentialsSurface {
  const credentials = new CredentialReviewService({
    store,
    settings: {
      read: async (key, schema) => {
        if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
        return schema.parse(PAGE_SIZE);
      },
    },
    now: () => NOW,
    // T006 of specs/005-certification: the correction's re-freeze, which these specs do not assert.
    openRequestsRefreeze: { refreeze: async () => undefined },
  });
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'credentials' ? credentials : Reflect.get(target, name, receiver),
  }) as AdminSurfaceServices;
  const written: AuditRecord[] = [];
  const pending: AuditRecord[] = [];
  const administration = {
    // One "transaction": the records join the written list only when the work resolves.
    transactions: {
      run: async <T>(work: (tx: typeof TX) => Promise<T>): Promise<T> => {
        pending.length = 0;
        const answer = await work(TX);
        written.push(...pending);
        return answer;
      },
    },
    auditWriter: {
      write: async (_tx: typeof TX, record: AuditRecord) => {
        pending.push(record);
      },
    },
  };
  // Every administrator call is counted by the signed-in default since T062 (FR-470); the limit
  // itself is the kernel's spec's, so this limiter admits every call.
  const rateLimiter = { check: async () => undefined } as unknown as RateLimiter;
  const as = (session: AdminSession | null) =>
    callerFor(
      createAdminContext({
        session,
        log,
        administration,
        services,
        rateLimiter,
        clientAddress: '203.0.113.9',
      }),
    );
  return {
    written,
    as,
    verified: () => as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: true }),
  };
}
