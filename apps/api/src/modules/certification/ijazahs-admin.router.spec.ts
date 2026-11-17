// T010 of specs/005-certification — the administrator surface's `ijazahs` namespace as it is served
// (contracts/admin-surface.md, `ijazahs.*`; FR-609, FR-610; R-412). Every procedure is the
// administrator kind: it refuses an anonymous caller and an unverified second factor, reaching no
// service and writing nothing; the session's administrator is the actor. The audit entries:
// `ijazahs.listed` on the reader, `ijazah.viewed` on the ijazah by its number at every opening of its
// PDF link, `ijazah.revoked` on the ijazah by its number with the reason, `ijazah_bar.set` and
// `ijazah_bar.lifted` on the user with the reason; a replayed write records none. The three writes are
// counted under `rate_limit_ijazah_decision` before any transaction opens and need a reason; the
// outputs keep no key and no token hash. What the actions do is `ijazahs.service.spec.ts`'s.
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
import { ijazahsAdminRouter } from './ijazahs-admin.router.js';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000ad';
const IJAZAH = '0199d0a0-0000-7000-8000-0000000000b1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const NUMBER = '7K3MQ9TD2XWB8HRN';
const KEY = 'decision-key-for-the-spec-0001';
const TX = { tx: 'admin' };

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const router = createAdminRouter({ ijazahs: ijazahsAdminRouter });
const callerFor = createAdminCallerFactory(router);
type Caller = ReturnType<typeof callerFor>;

const ROW = {
  ijazahId: IJAZAH,
  certificateNumber: NUMBER,
  enrollmentId: ENROLLMENT,
  requestId: REQUEST,
  teacher: { userId: TEACHER, displayName: 'عمر' },
  student: { userId: STUDENT, displayName: 'مريم' },
  subject: { id: SUBJECT, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' },
  language: 'ar',
  grantedAt: '2026-11-17T09:00:00.000Z',
  status: 'revoked',
  rendered: true,
  revoked: true,
  renderGeneration: 0,
  signedOffAt: null,
  revokedAt: '2026-11-17T11:00:00.000Z',
};

const DETAIL = {
  ...ROW,
  completionDate: '2026-11-10',
  chain: [['رسول الله ﷺ'], ['عمر بن فاروق']],
  studentNamePrinted: 'مريم بنت أحمد',
  teacherNamePrinted: 'عمر بن فاروق',
  riwaya: 'حفص عن عاصم',
  tariq: null,
  revokedReason: 'خطأ في السند',
  pdfLink: 'https://storage.example.test/signed',
  certificateStorageKey: `certificates/${IJAZAH}/0.pdf`,
  verificationTokenHash: 'a'.repeat(64),
};

function surface({ replayed = false } = {}) {
  const reached: [string, unknown, unknown, unknown][] = [];
  const ijazahs = {
    list: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['list', tx, adminId, input]);
      return { items: [ROW] };
    },
    get: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['get', tx, adminId, input]);
      return DETAIL;
    },
    revoke: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['revoke', tx, adminId, input]);
      return { certificateNumber: NUMBER, replayed };
    },
    bar: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['bar', tx, adminId, input]);
      return { replayed };
    },
    liftBar: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['liftBar', tx, adminId, input]);
      return { replayed };
    },
  };
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'ijazahs' ? ijazahs : Reflect.get(target, name, receiver),
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
  'ijazahs.list': (caller: Caller) => caller.ijazahs.list({}),
  'ijazahs.get': (caller: Caller) => caller.ijazahs.get({ ijazahId: IJAZAH }),
  'ijazahs.revoke': (caller: Caller) =>
    caller.ijazahs.revoke({ ijazahId: IJAZAH, reason: 'خطأ في السند', idempotencyKey: KEY }),
  'ijazahs.bar': (caller: Caller) =>
    caller.ijazahs.bar({ targetUserId: STUDENT, reason: 'تزوير', idempotencyKey: KEY }),
  'ijazahs.liftBar': (caller: Caller) =>
    caller.ijazahs.liftBar({ targetUserId: STUDENT, reason: 'خطأ', idempotencyKey: KEY }),
} as const;

const writes = ['revoke', 'bar', 'liftBar'] as const;

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

describe('ijazahs.list and .get (R-412)', () => {
  it('lists through the service, a revoked row answered revoked, audited on the reader', async () => {
    const s = surface();
    const page = await s.verified().ijazahs.list({ status: 'revoked' });
    expect(page.items[0]).toMatchObject({ status: 'revoked', revoked: true });
    expect(s.reached).toEqual([['list', TX, ADMIN, { status: 'revoked' }]]);
    expect(s.written).toEqual([
      { action: 'ijazahs.listed', targetType: 'admin', targetId: ADMIN, adminId: ADMIN },
    ]);
  });

  it('audits every opening of the PDF link on the ijazah by its number; no key, no hash', async () => {
    const s = surface();
    const caller = s.verified();
    const detail = await caller.ijazahs.get({ ijazahId: IJAZAH });
    await caller.ijazahs.get({ ijazahId: IJAZAH });
    expect(detail.pdfLink).toBe('https://storage.example.test/signed');
    expect(detail).not.toHaveProperty('certificateStorageKey');
    expect(detail).not.toHaveProperty('verificationTokenHash');
    const entry = {
      action: 'ijazah.viewed',
      targetType: 'ijazah',
      targetId: NUMBER,
      adminId: ADMIN,
    };
    expect(s.written).toEqual([entry, entry]);
  });
});

describe('ijazahs.revoke, .bar and .liftBar (FR-609, FR-610)', () => {
  it('revokes through the service, audited on the ijazah by its number with the reason', async () => {
    const s = surface();
    await s
      .verified()
      .ijazahs.revoke({ ijazahId: IJAZAH, reason: ' خطأ في السند ', idempotencyKey: KEY });
    expect(s.reached).toEqual([
      ['revoke', TX, ADMIN, { ijazahId: IJAZAH, reason: 'خطأ في السند', idempotencyKey: KEY }],
    ]);
    expect(s.written).toEqual([
      {
        action: 'ijazah.revoked',
        targetType: 'ijazah',
        targetId: NUMBER,
        reason: 'خطأ في السند',
        adminId: ADMIN,
      },
    ]);
  });

  it.each([
    ['bar', 'ijazah_bar.set', 'تزوير'],
    ['liftBar', 'ijazah_bar.lifted', 'خطأ'],
  ] as const)('%s is audited on the user with the reason', async (name, action, reason) => {
    const s = surface();
    await calls[`ijazahs.${name}`](s.verified());
    expect(s.reached).toEqual([
      [name, TX, ADMIN, { targetUserId: STUDENT, reason, idempotencyKey: KEY }],
    ]);
    expect(s.written).toEqual([
      { action, targetType: 'user', targetId: STUDENT, reason, adminId: ADMIN },
    ]);
  });

  it.each(writes)('records no entry for a replayed %s', async (name) => {
    const s = surface({ replayed: true });
    await calls[`ijazahs.${name}`](s.verified());
    expect(s.written).toEqual([]);
  });

  it.each(writes)(
    'counts %s under rate_limit_ijazah_decision before any transaction opens',
    async (name) => {
      const s = surface();
      expect(await codeOf(calls[`ijazahs.${name}`](s.verified(true)))).toBe('RATE_LIMITED');
      expect(s.counted).toEqual([
        [
          'rate_limit_ijazah_decision',
          { kind: 'administrator', adminId: ADMIN },
          `ijazahs.${name}`,
        ],
      ]);
      expect(s.opened()).toBe(0);
      expect(s.reached).toEqual([]);
    },
  );

  it.each([
    ['revoke', { ijazahId: IJAZAH, idempotencyKey: KEY }],
    ['revoke', { ijazahId: IJAZAH, reason: '  ', idempotencyKey: KEY }],
    ['bar', { targetUserId: STUDENT, idempotencyKey: KEY }],
    ['liftBar', { targetUserId: STUDENT, reason: 'خطأ' }],
  ] as const)('refuses %s without a reason or a key as VALIDATION_FAILED', async (name, input) => {
    const s = surface();
    expect(await codeOf(s.verified().ijazahs[name](input as never))).toBe('VALIDATION_FAILED');
    expect(s.reached).toEqual([]);
  });
});
