// T052 — the administrator surface's `payments` namespace as it is served (admin-surface.md; FR-400
// to FR-402, R-220). Both procedures are the administrator kind: each refuses an anonymous caller
// and one whose second factor is not verified, reaching no service and writing nothing (FR-402);
// each signed-in call writes exactly its one audit entry, `payments.listed` naming the reader and
// `payments.viewed` naming the order, and a refused one writes none. Both are queries, and the
// namespace has no other procedure (FR-401). The output schema strips what it does not name. What
// the reads answer is `payments-monitor.service.spec.ts`'s; that nothing else is written on the
// database is `payments-monitor.repository.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../platform/audit/audit-writer.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import {
  type AdminSession,
  type AdminSurfaceServices,
  createAdminContext,
} from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { paymentsAdminRouter } from './payments-admin.router.js';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const router = createAdminRouter({ payments: paymentsAdminRouter });
const callerFor = createAdminCallerFactory(router);
type PaymentsCaller = ReturnType<typeof callerFor>;

const ADMIN = '0199d0a0-0000-7000-8000-00000000ad01';
const ORDER = '0199d0a0-0000-7000-8000-0000000000f1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const TX = { stand: 'in' };

const ITEM = {
  paymentId: ORDER,
  gatewayOrderId: 'fake_order_1',
  createdAt: '2026-11-03T10:00:00.000Z',
  student: { displayName: 'آمال علي' },
  gross_piasters: 120_000,
  status: 'created',
  enrollmentCancelled: false,
} as const;

const DETAIL = {
  paymentId: ORDER,
  gatewayOrderId: 'fake_order_1',
  status: 'created',
  createdAt: '2026-11-03T10:00:00.000Z',
  gross_piasters: 120_000,
  currency: 'EGP',
  student: { displayName: 'آمال علي' },
  enrollment: {
    enrollmentId: ENROLLMENT,
    summary: {
      subject: { id: '0199d0a0-0000-7000-8000-0000000000c1', nameAr: 'تجويد', nameEn: 'Tajweed' },
      track: 'recitation',
      sessionCount: 8,
      sessionDurationMinutes: 60,
    },
    teacher: { displayName: 'المعلمة سارة' },
    status: 'pending_payment',
    completed: 0,
    total: 8,
  },
  events: [],
  outcomes: [],
  paidOrders: [],
} as const;

interface Surface {
  readonly written: AuditRecord[];
  readonly reached: unknown[][];
  readonly as: (session: AdminSession | null) => PaymentsCaller;
  readonly verified: () => PaymentsCaller;
}

function surfaceOver(payments: Partial<AdminSurfaceServices['payments']> = {}): Surface {
  const reached: unknown[][] = [];
  const monitor: AdminSurfaceServices['payments'] = {
    list: async (tx, query) => {
      reached.push(['list', tx, query]);
      return { items: [{ ...ITEM, checkoutUrl: 'https://gateway.invalid/pay' }] as never };
    },
    get: async (tx, paymentId) => {
      reached.push(['get', tx, paymentId]);
      return { ...DETAIL, checkoutUrlEncrypted: 'secret' } as never;
    },
    ...payments,
  };
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'payments' ? monitor : Reflect.get(target, name, receiver),
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
  const rateLimiter = {
    check: async () => {
      throw new DomainError('INTERNAL');
    },
  } as unknown as RateLimiter;
  const as = (session: AdminSession | null) =>
    callerFor(
      createAdminContext({
        session,
        log,
        administration: administration as never,
        services,
        rateLimiter,
        clientAddress: '203.0.113.9',
      }),
    );
  return {
    written,
    reached,
    as,
    verified: () => as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: true }),
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('the administrator kind (FR-402)', () => {
  const calls = {
    'payments.list': (caller: PaymentsCaller) => caller.payments.list({}),
    'payments.get': (caller: PaymentsCaller) => caller.payments.get({ paymentId: ORDER }),
  } as const;

  it.each(Object.keys(calls) as (keyof typeof calls)[])(
    '%s refuses an anonymous caller and an unverified second factor, reaching nothing and writing nothing',
    async (path) => {
      const surface = surfaceOver();
      expect(await codeOf(calls[path](surface.as(null)))).toBe('UNAUTHENTICATED');
      expect(
        await codeOf(
          calls[path](surface.as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: false })),
        ),
      ).toBe('MFA_REQUIRED');
      expect(surface.reached).toEqual([]);
      expect(surface.written).toEqual([]);
    },
  );
});

describe('a read and nothing else (FR-401)', () => {
  it('the namespace is exactly payments.list and payments.get, both queries', () => {
    const procedures = paymentsAdminRouter._def.procedures as unknown as Record<
      string,
      { readonly _def: { readonly type: string } }
    >;
    expect(Object.keys(procedures).sort()).toEqual(['get', 'list']);
    for (const procedure of Object.values(procedures)) expect(procedure._def.type).toBe('query');
  });
});

describe('payments.list', () => {
  it('reads on the call’s transaction and writes exactly its payments.listed entry, naming the reader', async () => {
    const surface = surfaceOver();
    await surface.verified().payments.list({ status: 'paid', search: 'آمال' });
    expect(surface.reached).toEqual([['list', TX, { status: 'paid', search: 'آمال' }]]);
    expect(surface.written).toEqual([
      { adminId: ADMIN, action: 'payments.listed', targetType: 'admin', targetId: ADMIN },
    ]);
  });

  it('answers only the fields its schema names', async () => {
    const answer = await surfaceOver().verified().payments.list({});
    expect(answer).toEqual({ items: [ITEM] });
  });

  it('refuses a malformed cursor, an unknown status and an empty search as VALIDATION_FAILED, writing nothing', async () => {
    const surface = surfaceOver();
    for (const input of [{ cursor: 'not-an-id' }, { status: 'settled' }, { search: '   ' }]) {
      expect(await codeOf(surface.verified().payments.list(input as never))).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(surface.reached).toEqual([]);
    expect(surface.written).toEqual([]);
  });
});

describe('payments.get', () => {
  it('writes exactly its payments.viewed entry, naming the order', async () => {
    const surface = surfaceOver();
    await surface.verified().payments.get({ paymentId: ORDER });
    expect(surface.reached).toEqual([['get', TX, ORDER]]);
    expect(surface.written).toEqual([
      { adminId: ADMIN, action: 'payments.viewed', targetType: 'payment', targetId: ORDER },
    ]);
  });

  it('answers only the fields its schema names: no checkout address leaves the server', async () => {
    const answer = await surfaceOver().verified().payments.get({ paymentId: ORDER });
    expect(answer).toEqual(DETAIL);
  });

  it('keeps nothing of a refused read: an unknown order answers NOT_FOUND and writes no entry', async () => {
    const surface = surfaceOver({
      get: async () => {
        throw new DomainError('NOT_FOUND');
      },
    });
    expect(await codeOf(surface.verified().payments.get({ paymentId: ORDER }))).toBe('NOT_FOUND');
    expect(surface.written).toEqual([]);
  });
});
