// T007 of specs/005-certification — the administrator surface's `ijazahRequests` namespace as it is
// served (contracts/admin-surface.md, `ijazahRequests.*`; FR-604, FR-605, FR-628). Every procedure
// is the administrator kind: it refuses an anonymous caller and an unverified second factor,
// reaching no service and writing nothing; the session's administrator is the actor. The audit
// entries: `ijazah_requests.listed` on the reader, `ijazah_request.viewed` on the request,
// `ijazah.issued` on the ijazah by its number and `ijazah_request.rejected` with the reason; a
// replayed decision records none. `approve` and `reject` are counted under
// `rate_limit_ijazah_decision` before any transaction opens; `reject` needs a reason; `get`'s output
// keeps no key. What the decisions do is `ijazah-decision.service.spec.ts`'s.
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
import { ijazahRequestsAdminRouter } from './ijazah-requests-admin.router.js';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000ad';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const IJAZAH = '0199d0a0-0000-7000-8000-0000000000b1';
const NUMBER = '7K3MQ9TD2XWB8HRN';
const KEY = 'decision-key-for-the-spec-0001';
const TX = { tx: 'admin' };

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const router = createAdminRouter({ ijazahRequests: ijazahRequestsAdminRouter });
const callerFor = createAdminCallerFactory(router);
type Caller = ReturnType<typeof callerFor>;

const ROW = {
  requestId: REQUEST,
  enrollmentId: ENROLLMENT,
  teacher: { userId: TEACHER, displayName: 'عمر' },
  student: { userId: STUDENT, displayName: 'مريم' },
  subject: { id: SUBJECT, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' },
  status: 'pending',
  sentAt: '2026-11-17T09:00:00.000Z',
  teacherStanding: { status: 'active' },
};

const DETAIL = {
  ...ROW,
  teacherUserId: TEACHER,
  completionDate: '2026-11-10',
  language: 'ar',
  chain: [['رسول الله ﷺ'], ['عمر بن فاروق']],
  teacherNamePrinted: 'عمر بن فاروق',
  studentName: 'مريم بنت أحمد',
  riwaya: 'حفص عن عاصم',
  tariq: null,
  signatureLink: 'https://storage.example.test/signed',
  signatureStorageKey: `ijazah-requests/${REQUEST}/signature.png`,
  teacherStanding: { status: 'suspended', reason: 'شكوى متكررة' },
};

function surface({ replayed = false } = {}) {
  const reached: [string, unknown, unknown, unknown][] = [];
  const ijazahRequests = {
    list: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['list', tx, adminId, input]);
      return { items: [ROW] };
    },
    get: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['get', tx, adminId, input]);
      return DETAIL;
    },
    approve: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['approve', tx, adminId, input]);
      return { answer: { ijazahId: IJAZAH, certificateNumber: NUMBER }, replayed };
    },
    reject: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['reject', tx, adminId, input]);
      return { replayed };
    },
  };
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'ijazahRequests' ? ijazahRequests : Reflect.get(target, name, receiver),
  }) as AdminSurfaceServices;
  const written: AuditRecord[] = [];
  const counted: unknown[][] = [];
  let opened = 0;
  const as = (session: AdminSession | null, limited = false): Caller =>
    callerFor(
      createAdminContext({
        session,
        log,
        administration: {
          transactions: {
            run: async <T>(work: (tx: typeof TX) => Promise<T>): Promise<T> => {
              opened += 1;
              return work(TX);
            },
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
            if (limited) throw new DomainError('RATE_LIMITED');
          },
        } as unknown as RateLimiter,
        clientAddress: '203.0.113.9',
      }),
    );
  return {
    reached,
    written,
    counted,
    opened: () => opened,
    as,
    verified: (limited = false) =>
      as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: true }, limited),
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
  'ijazahRequests.list': (caller: Caller) => caller.ijazahRequests.list({}),
  'ijazahRequests.get': (caller: Caller) => caller.ijazahRequests.get({ requestId: REQUEST }),
  'ijazahRequests.approve': (caller: Caller) =>
    caller.ijazahRequests.approve({ requestId: REQUEST, idempotencyKey: KEY }),
  'ijazahRequests.reject': (caller: Caller) =>
    caller.ijazahRequests.reject({ requestId: REQUEST, reason: 'سبب', idempotencyKey: KEY }),
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
});

describe('ijazahRequests.list and .get', () => {
  it('lists through the service with the session administrator, audited on the reader', async () => {
    const s = surface();
    expect(await s.verified().ijazahRequests.list({ status: 'pending' })).toEqual({ items: [ROW] });
    expect(s.reached).toEqual([['list', TX, ADMIN, { status: 'pending' }]]);
    expect(s.written).toEqual([
      { action: 'ijazah_requests.listed', targetType: 'admin', targetId: ADMIN, adminId: ADMIN },
    ]);
  });

  it('gets the request audited on it, its output keeping no key and no teacher id', async () => {
    const s = surface();
    const detail = await s.verified().ijazahRequests.get({ requestId: REQUEST });
    expect(detail).not.toHaveProperty('signatureStorageKey');
    expect(detail).not.toHaveProperty('teacherUserId');
    expect(detail.teacherStanding).toEqual({ status: 'suspended', reason: 'شكوى متكررة' });
    expect(s.written).toEqual([
      {
        action: 'ijazah_request.viewed',
        targetType: 'ijazah_request',
        targetId: REQUEST,
        adminId: ADMIN,
      },
    ]);
  });
});

describe('ijazahRequests.approve and .reject', () => {
  it('approves through the service, the issue audited on the ijazah by its number', async () => {
    const s = surface();
    expect(
      await s.verified().ijazahRequests.approve({ requestId: REQUEST, idempotencyKey: KEY }),
    ).toEqual({ ijazahId: IJAZAH, certificateNumber: NUMBER });
    expect(s.reached).toEqual([
      ['approve', TX, ADMIN, { requestId: REQUEST, idempotencyKey: KEY }],
    ]);
    expect(s.written).toEqual([
      { action: 'ijazah.issued', targetType: 'ijazah', targetId: NUMBER, adminId: ADMIN },
    ]);
  });

  it('rejects with the reason into the entry', async () => {
    const s = surface();
    await s
      .verified()
      .ijazahRequests.reject({
        requestId: REQUEST,
        reason: ' السند لا يطابق ',
        idempotencyKey: KEY,
      });
    expect(s.reached).toEqual([
      ['reject', TX, ADMIN, { requestId: REQUEST, reason: 'السند لا يطابق', idempotencyKey: KEY }],
    ]);
    expect(s.written).toEqual([
      {
        action: 'ijazah_request.rejected',
        targetType: 'ijazah_request',
        targetId: REQUEST,
        reason: 'السند لا يطابق',
        adminId: ADMIN,
      },
    ]);
  });

  it.each(['approve', 'reject'] as const)(
    'records no second entry for a replayed %s, answering the first',
    async (decision) => {
      const s = surface({ replayed: true });
      const answer = await calls[`ijazahRequests.${decision}`](s.verified());
      expect(s.written).toEqual([]);
      if (decision === 'approve') {
        expect(answer).toEqual({ ijazahId: IJAZAH, certificateNumber: NUMBER });
      }
    },
  );

  it.each([
    ['no reason', { requestId: REQUEST, idempotencyKey: KEY }],
    ['a blank reason', { requestId: REQUEST, reason: '  ', idempotencyKey: KEY }],
    ['no key', { requestId: REQUEST, reason: 'سبب' }],
  ])('refuses a rejection with %s as VALIDATION_FAILED, reaching nothing', async (_case, input) => {
    const s = surface();
    expect(await codeOf(s.verified().ijazahRequests.reject(input as never))).toBe(
      'VALIDATION_FAILED',
    );
    expect(s.reached).toEqual([]);
  });

  it.each(['approve', 'reject'] as const)(
    'counts %s under rate_limit_ijazah_decision before any transaction opens',
    async (decision) => {
      const s = surface();
      expect(await codeOf(calls[`ijazahRequests.${decision}`](s.verified(true)))).toBe(
        'RATE_LIMITED',
      );
      expect(s.counted).toEqual([
        [
          'rate_limit_ijazah_decision',
          { kind: 'administrator', adminId: ADMIN },
          `ijazahRequests.${decision}`,
        ],
      ]);
      expect(s.opened()).toBe(0);
      expect(s.reached).toEqual([]);
    },
  );
});
