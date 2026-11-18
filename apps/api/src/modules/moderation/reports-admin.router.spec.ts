// T011 of specs/005-certification — the administrator surface's `reports` namespace as it is served
// (contracts/admin-surface.md, `reports.*`; FR-612; research R-408). Every procedure is the
// administrator kind: it refuses an anonymous caller and an unverified second factor, reaching no
// service and writing nothing; the session's administrator is the actor. The audit entries:
// `reports.listed` on the reader, `report.viewed` and `report.resolved` (with the note) on the
// report (`user_report` + its id, never a name); a replayed resolution records none. The calls run
// under the signed-in default limit (admin-surface.md: «default»). What the actions do is
// `user-report.service.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../platform/audit/audit-writer.js';
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
import { reportsAdminRouter } from './reports-admin.router.js';

const ADMIN = '0199d0a0-0000-7000-8000-00000000d0ad';
const REPORT = '0199d0a0-0000-7000-8000-00000000d0f1';
const REPORTER = '0199d0a0-0000-7000-8000-00000000d0a1';
const REPORTED = '0199d0a0-0000-7000-8000-00000000d0a2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000d0e1';
const KEY = 'resolve-key-for-the-spec-0001';
const TX = { tx: 'admin' };

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const router = createAdminRouter({ reports: reportsAdminRouter });
const callerFor = createAdminCallerFactory(router);
type Caller = ReturnType<typeof callerFor>;

const ITEM = {
  reportId: REPORT,
  context: 'chat',
  status: 'open',
  reporterUserId: REPORTER,
  reportedUserId: REPORTED,
  sessionId: null,
  enrollmentId: ENROLLMENT,
  createdAt: '2026-11-18T09:00:00.000Z',
};

function surface({ replayed = false } = {}) {
  const reached: [string, unknown, unknown, unknown][] = [];
  const reports = {
    list: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['list', tx, adminId, input]);
      return { items: [{ ...ITEM, reason: 'not on the list' }] };
    },
    get: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['get', tx, adminId, input]);
      return { ...ITEM, reason: 'كلام غير لائق', resolution: null };
    },
    resolve: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['resolve', tx, adminId, input]);
      return { replayed };
    },
  };
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'reports' ? reports : Reflect.get(target, name, receiver),
  }) as AdminSurfaceServices;
  const written: AuditRecord[] = [];
  const counted: unknown[][] = [];
  const as = (session: AdminSession | null): Caller =>
    callerFor(
      createAdminContext({
        session,
        log,
        administration: {
          transactions: {
            run: async <T>(work: (tx: typeof TX) => Promise<T>): Promise<T> => work(TX),
          },
          auditWriter: {
            write: async (_tx: typeof TX, record: AuditRecord) => {
              written.push(record);
            },
          },
        } as never,
        services,
        rateLimiter: {
          check: async (key: string, subject: unknown, procedure: string) => {
            counted.push([key, subject, procedure]);
          },
        } as unknown as RateLimiter,
        clientAddress: '203.0.113.9',
      }),
    );
  return {
    reached,
    written,
    counted,
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

const calls = {
  'reports.list': (caller: Caller) => caller.reports.list({}),
  'reports.get': (caller: Caller) => caller.reports.get({ reportId: REPORT }),
  'reports.resolve': (caller: Caller) =>
    caller.reports.resolve({
      reportId: REPORT,
      outcome: 'actioned',
      note: 'تم التنبيه',
      idempotencyKey: KEY,
    }),
} as const;

describe('the administrator kind', () => {
  it.each(Object.keys(calls) as (keyof typeof calls)[])(
    '%s refuses an anonymous caller (UNAUTHENTICATED) and an unverified second factor (MFA_REQUIRED), reaching nothing',
    async (path) => {
      const s = surface();
      expect(await codeOf(calls[path](s.as(null)))).toBe('UNAUTHENTICATED');
      expect(
        await codeOf(calls[path](s.as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: false }))),
      ).toBe('MFA_REQUIRED');
      expect(s.reached).toEqual([]);
      expect(s.written).toEqual([]);
    },
  );

  it.each(Object.keys(calls) as (keyof typeof calls)[])(
    '%s runs under the signed-in default limit, the administrator as subject',
    async (path) => {
      const s = surface();
      await calls[path](s.verified());
      expect(s.counted).toEqual([
        ['rate_limit_signed_in_default', { kind: 'administrator', adminId: ADMIN }, path],
      ]);
    },
  );
});

describe('reports.list and .get (FR-612)', () => {
  it('lists the open reports unless said, through the service, audited on the reader, no reason', async () => {
    const s = surface();
    const page = await s.verified().reports.list({});
    expect(page).toEqual({ items: [ITEM] });
    expect(s.reached).toEqual([['list', TX, ADMIN, { status: 'open' }]]);
    expect(s.written).toEqual([
      { action: 'reports.listed', targetType: 'admin', targetId: ADMIN, adminId: ADMIN },
    ]);
  });

  it('opens a report through the service, audited on the report by its id', async () => {
    const s = surface();
    const detail = await s.verified().reports.get({ reportId: REPORT });
    expect(detail).toMatchObject({ reportId: REPORT, reason: 'كلام غير لائق', resolution: null });
    expect(s.reached).toEqual([['get', TX, ADMIN, { reportId: REPORT }]]);
    expect(s.written).toEqual([
      { action: 'report.viewed', targetType: 'user_report', targetId: REPORT, adminId: ADMIN },
    ]);
  });
});

describe('reports.resolve (FR-612)', () => {
  it('resolves through the service, audited on the report with the note', async () => {
    const s = surface();
    await s.verified().reports.resolve({
      reportId: REPORT,
      outcome: 'dismissed',
      note: ' لا مخالفة ',
      idempotencyKey: KEY,
    });
    expect(s.reached).toEqual([
      [
        'resolve',
        TX,
        ADMIN,
        { reportId: REPORT, outcome: 'dismissed', note: 'لا مخالفة', idempotencyKey: KEY },
      ],
    ]);
    expect(s.written).toEqual([
      {
        action: 'report.resolved',
        targetType: 'user_report',
        targetId: REPORT,
        reason: 'لا مخالفة',
        adminId: ADMIN,
      },
    ]);
  });

  it('a replay records no second entry', async () => {
    const s = surface({ replayed: true });
    await calls['reports.resolve'](s.verified());
    expect(s.reached).toHaveLength(1);
    expect(s.written).toEqual([]);
  });

  it('refuses a resolution with no note BAD_REQUEST before the service', async () => {
    const s = surface();
    expect(
      await codeOf(
        s
          .verified()
          .reports.resolve({ reportId: REPORT, outcome: 'actioned', idempotencyKey: KEY } as never),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(s.reached).toEqual([]);
  });
});
