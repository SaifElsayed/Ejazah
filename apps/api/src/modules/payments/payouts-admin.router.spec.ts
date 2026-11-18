// 003:T105 — the administrator surface's `payouts` namespace as it is served (SRS DEC-89; the note
// under T105). Every procedure is the administrator kind: each refuses an anonymous caller and one
// whose second factor is not verified, reaching no service and writing nothing. Each signed-in call
// writes exactly its one audit entry: `payouts.listed` naming the reader, `payouts.viewed` naming the
// teacher, `payout_release.marked` naming the marked release's teacher (`user`); a replayed mark
// writes none. The output schema strips what it does not name. What the reads answer and what the
// mark refuses are `payouts.service.spec.ts`'s; the mark once under a race is
// `tests/db-integrity/payout-mark-race.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { AuditRecord } from '../../platform/audit/audit-writer.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
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
import { payoutsAdminRouter } from './payouts-admin.router.js';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const router = createAdminRouter({ payouts: payoutsAdminRouter });
const callerFor = createAdminCallerFactory(router);
type PayoutsCaller = ReturnType<typeof callerFor>;

const ADMIN = '0199d0a0-0000-7000-8000-00000000ad01';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a1';
const RELEASE = '0199d0a0-0000-7000-8000-0000000000b1';
const KEY = 'mark-key-0000000001';
const REASON = 'marked by mistake: the transfer did not go through';
const TX = { stand: 'in' };

const FIGURES = {
  held_piasters: 700_000,
  dueNow_piasters: 700_000,
  paid_piasters: 0,
  paidThisMonth_piasters: 0,
  takenOff_piasters: 70_000,
} as const;

interface Surface {
  readonly written: AuditRecord[];
  readonly reached: unknown[][];
  readonly as: (session: AdminSession | null) => PayoutsCaller;
  readonly verified: () => PayoutsCaller;
}

function surfaceOver(replayed = false): Surface {
  const reached: unknown[][] = [];
  const payouts: AdminSurfaceServices['payouts'] = {
    list: async (tx, adminId, input) => {
      reached.push(['list', tx, adminId, input]);
      return {
        totals: FIGURES,
        items: [{ ...FIGURES, teacher: { userId: TEACHER, displayName: 'سارة' }, extra: 'x' }],
      } as never;
    },
    get: async (tx, adminId, teacherUserId) => {
      reached.push(['get', tx, adminId, teacherUserId]);
      return {
        teacher: { userId: TEACHER, displayName: 'سارة' },
        figures: FIGURES,
        releases: [],
        deductions: [],
        payoutReference: 'rcp_secret',
      } as never;
    },
    mark: async (tx, adminId, input) => {
      reached.push(['mark', tx, adminId, input]);
      return { teacherUserId: TEACHER, replayed };
    },
    unmark: async (tx, adminId, input) => {
      reached.push(['unmark', tx, adminId, input]);
      return { teacherUserId: TEACHER, replayed };
    },
  };
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'payouts' ? payouts : Reflect.get(target, name, receiver),
  }) as AdminSurfaceServices;
  const written: AuditRecord[] = [];
  const pending: AuditRecord[] = [];
  const administration = {
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
  const rateLimiter = { check: async () => undefined } as unknown as RateLimiter;
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

describe('the administrator kind', () => {
  const calls = {
    'payouts.list': (caller: PayoutsCaller) => caller.payouts.list({}),
    'payouts.get': (caller: PayoutsCaller) => caller.payouts.get({ teacherUserId: TEACHER }),
    'payouts.mark': (caller: PayoutsCaller) =>
      caller.payouts.mark({ releaseId: RELEASE, idempotencyKey: KEY }),
    'payouts.unmark': (caller: PayoutsCaller) =>
      caller.payouts.unmark({ releaseId: RELEASE, reason: REASON, idempotencyKey: KEY }),
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

describe('payouts.list', () => {
  it('reads on the call’s transaction, writes its payouts.listed entry naming the reader, and strips what its schema does not name', async () => {
    const surface = surfaceOver();
    const page = await surface.verified().payouts.list({ dueOnly: true });

    expect(surface.reached).toEqual([['list', TX, ADMIN, { dueOnly: true }]]);
    expect(surface.written).toEqual([
      { adminId: ADMIN, action: 'payouts.listed', targetType: 'admin', targetId: ADMIN },
    ]);
    expect(page.items[0]).not.toHaveProperty('extra');
  });
});

describe('payouts.get', () => {
  it('writes its payouts.viewed entry naming the teacher, and never answers the reference itself', async () => {
    const surface = surfaceOver();
    const detail = await surface.verified().payouts.get({ teacherUserId: TEACHER });

    expect(surface.written).toEqual([
      { adminId: ADMIN, action: 'payouts.viewed', targetType: 'user', targetId: TEACHER },
    ]);
    expect(detail).not.toHaveProperty('payoutReference');
  });
});

describe('payouts.mark («تم الصرف»)', () => {
  it('marks on the call’s transaction with the session’s administrator, audited on the teacher', async () => {
    const surface = surfaceOver();
    await surface.verified().payouts.mark({ releaseId: RELEASE, idempotencyKey: KEY });

    expect(surface.reached).toEqual([
      ['mark', TX, ADMIN, { releaseId: RELEASE, idempotencyKey: KEY }],
    ]);
    expect(surface.written).toEqual([
      { adminId: ADMIN, action: 'payout_release.marked', targetType: 'user', targetId: TEACHER },
    ]);
  });

  it('writes no second entry on a replay', async () => {
    const surface = surfaceOver(true);
    await surface.verified().payouts.mark({ releaseId: RELEASE, idempotencyKey: KEY });

    expect(surface.written).toEqual([]);
  });

  it('refuses a mark with no key as VALIDATION_FAILED, reaching nothing', async () => {
    const surface = surfaceOver();
    expect(await codeOf(surface.verified().payouts.mark({ releaseId: RELEASE } as never))).toBe(
      'VALIDATION_FAILED',
    );
    expect(surface.reached).toEqual([]);
  });
});

describe('payouts.unmark: a mark made in error undone (DEC-89)', () => {
  it('unmarks on the call’s transaction, audited on the teacher with its reason', async () => {
    const surface = surfaceOver();
    await surface
      .verified()
      .payouts.unmark({ releaseId: RELEASE, reason: REASON, idempotencyKey: KEY });

    expect(surface.reached).toEqual([
      ['unmark', TX, ADMIN, { releaseId: RELEASE, reason: REASON, idempotencyKey: KEY }],
    ]);
    expect(surface.written).toEqual([
      {
        adminId: ADMIN,
        action: 'payout_release.unmarked',
        targetType: 'user',
        targetId: TEACHER,
        reason: REASON,
      },
    ]);
  });

  it('writes no second entry on a replay', async () => {
    const surface = surfaceOver(true);
    await surface
      .verified()
      .payouts.unmark({ releaseId: RELEASE, reason: REASON, idempotencyKey: KEY });

    expect(surface.written).toEqual([]);
  });

  it('refuses an unmark with no reason, or an empty one, as VALIDATION_FAILED, reaching nothing', async () => {
    const surface = surfaceOver();
    for (const reason of [undefined, '', '   ']) {
      expect(
        await codeOf(
          surface
            .verified()
            .payouts.unmark({ releaseId: RELEASE, reason, idempotencyKey: KEY } as never),
        ),
      ).toBe('VALIDATION_FAILED');
    }
    expect(surface.reached).toEqual([]);
  });
});

describe('payouts.mark’s own limit (rate_limit_payout_mark, 10 per 60 s per administrator)', () => {
  it('refuses a call over the limit RATE_LIMITED before the transaction opens', async () => {
    const keysRead: string[] = [];
    const counts = new Map<string, number>();
    const rateLimiter = new RateLimiter({
      settings: {
        read: async (key, schema) => {
          keysRead.push(key);
          return schema.parse({ limit: 1, window_seconds: 60 });
        },
      },
      counter: {
        hit: async (key) => {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return count;
        },
      },
      subjectKey: Buffer.alloc(32, 3),
    });
    let transactions = 0;
    const written: AuditRecord[] = [];
    const reached: unknown[] = [];
    const payouts: Pick<AdminSurfaceServices['payouts'], 'mark'> = {
      mark: async (_tx, adminId) => {
        reached.push(adminId);
        return { teacherUserId: TEACHER, replayed: false };
      },
    };
    const context = () =>
      createAdminContext({
        session: { adminId: ADMIN, sessionId: ADMIN, mfaVerified: true },
        log,
        administration: {
          transactions: {
            run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
              transactions += 1;
              return work({} as Transaction);
            },
          },
          auditWriter: { write: async (_tx, record) => void written.push(record) },
        },
        services: new Proxy(unusedAdminServices, {
          get: (target, name, receiver) =>
            name === 'payouts' ? payouts : Reflect.get(target, name, receiver),
        }),
        rateLimiter,
        clientAddress: '203.0.113.9',
      });
    await callerFor(context()).payouts.mark({ releaseId: RELEASE, idempotencyKey: KEY });
    expect(
      await codeOf(callerFor(context()).payouts.mark({ releaseId: RELEASE, idempotencyKey: KEY })),
    ).toBe('RATE_LIMITED');
    expect(keysRead).toContain('rate_limit_payout_mark');
    expect(transactions).toBe(1);
    expect(reached).toEqual([ADMIN]);
    expect(written).toHaveLength(1);
  });
});

describe('payouts.unmark’s limit, the same rate_limit_payout_mark', () => {
  it('refuses a call over the limit RATE_LIMITED before the transaction opens', async () => {
    const keysRead: string[] = [];
    const counts = new Map<string, number>();
    const rateLimiter = new RateLimiter({
      settings: {
        read: async (key, schema) => {
          keysRead.push(key);
          return schema.parse({ limit: 1, window_seconds: 60 });
        },
      },
      counter: {
        hit: async (key) => {
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return count;
        },
      },
      subjectKey: Buffer.alloc(32, 3),
    });
    let transactions = 0;
    const written: AuditRecord[] = [];
    const reached: unknown[] = [];
    const payouts: Pick<AdminSurfaceServices['payouts'], 'unmark'> = {
      unmark: async (_tx, adminId) => {
        reached.push(adminId);
        return { teacherUserId: TEACHER, replayed: false };
      },
    };
    const context = () =>
      createAdminContext({
        session: { adminId: ADMIN, sessionId: ADMIN, mfaVerified: true },
        log,
        administration: {
          transactions: {
            run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
              transactions += 1;
              return work({} as Transaction);
            },
          },
          auditWriter: { write: async (_tx, record) => void written.push(record) },
        },
        services: new Proxy(unusedAdminServices, {
          get: (target, name, receiver) =>
            name === 'payouts' ? payouts : Reflect.get(target, name, receiver),
        }),
        rateLimiter,
        clientAddress: '203.0.113.9',
      });
    await callerFor(context()).payouts.unmark({
      releaseId: RELEASE,
      reason: REASON,
      idempotencyKey: KEY,
    });
    expect(
      await codeOf(
        callerFor(context()).payouts.unmark({
          releaseId: RELEASE,
          reason: REASON,
          idempotencyKey: KEY,
        }),
      ),
    ).toBe('RATE_LIMITED');
    expect(keysRead).toContain('rate_limit_payout_mark');
    expect(transactions).toBe(1);
    expect(reached).toEqual([ADMIN]);
    expect(written).toHaveLength(1);
  });
});
