// T024 of specs/005-certification — the administrator surface's `settings` namespace as this
// module's router serves it (contracts/admin-surface.md, `settings.list` and `settings.update`;
// FR-624; SRS FR-ADMIN-9, DEC-73; research R-410; the note under T024). Written before the router,
// run red against its stub. Both procedures are the administrator kind: they refuse an anonymous
// caller and an unverified second factor, reaching no service and writing nothing; the session's
// administrator is the actor. `list` runs under the signed-in default limit and is audited
// `settings.listed` on the reader; `update` under `rate_limit_settings_update`, keyed, a reason
// required, audited `setting.changed` on the key (`setting` + the key) with the reason and the
// value before and after; a replay records no entry, and a refusal none. What the actions do is
// `settings.service.spec.ts`'s.
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
import { settingsAdminRouter } from './settings.router.js';

const ADMIN = '0199d0a0-0000-7000-8000-00000000a024';
const KEY = 'settings-update-key-for-the-spec-03';
const REASON = 'سبب التعديل';
const TX = { tx: 'admin' };

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const router = createAdminRouter({ settings: settingsAdminRouter });
const callerFor = createAdminCallerFactory(router);
type Caller = ReturnType<typeof callerFor>;

const ITEM = {
  key: 'chat_page_size',
  value: 50,
  bounds: { shape: 'number', value: { min: 1, minExclusive: false, max: null } },
  unit: 'count',
  group: 'notifications',
  srsRow: 'Chat page size (messages)',
};

const UPDATE = { key: 'chat_page_size', value: 40, reason: REASON, idempotencyKey: KEY };

function surface({
  replayed = false,
  refusal,
}: { readonly replayed?: boolean; readonly refusal?: Error } = {}) {
  const reached: unknown[][] = [];
  const settings = {
    list: async (tx: unknown, adminId: string) => {
      reached.push(['list', tx, adminId]);
      return { items: [{ ...ITEM, schema: 'not on the list' }] };
    },
    update: async (tx: unknown, adminId: string, input: unknown) => {
      reached.push(['update', tx, adminId, input]);
      if (refusal !== undefined) throw refusal;
      return { key: 'chat_page_size', before: 50, after: 40, replayed };
    },
  };
  const services = new Proxy(unusedAdminServices, {
    get: (target, name, receiver) =>
      name === 'settings' ? settings : Reflect.get(target, name, receiver),
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

async function bodyOf(call: Promise<unknown>): Promise<{ code: string; details?: unknown }> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as {
    code: string;
    details?: unknown;
  };
}

const calls = {
  'settings.list': (caller: Caller) => caller.settings.list(),
  'settings.update': (caller: Caller) => caller.settings.update(UPDATE),
} as const;

type Path = keyof typeof calls;
const PATHS = Object.keys(calls) as Path[];

const limits: Record<Path, string> = {
  'settings.list': 'rate_limit_signed_in_default',
  'settings.update': 'rate_limit_settings_update',
};

describe('the administrator kind', () => {
  it.each(PATHS)(
    '%s refuses an anonymous caller (UNAUTHENTICATED) and an unverified second factor (MFA_REQUIRED), reaching nothing',
    async (path) => {
      const s = surface();
      expect((await bodyOf(calls[path](s.as(null)))).code).toBe('UNAUTHENTICATED');
      expect(
        (await bodyOf(calls[path](s.as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: false }))))
          .code,
      ).toBe('MFA_REQUIRED');
      expect(s.reached).toEqual([]);
      expect(s.written).toEqual([]);
    },
  );

  it.each(PATHS)('%s is counted under its limit, the administrator as subject', async (path) => {
    const s = surface();
    await calls[path](s.verified());
    expect(s.counted).toEqual([[limits[path], { kind: 'administrator', adminId: ADMIN }, path]]);
  });
});

describe('settings.list (FR-624)', () => {
  it('answers every setting the service lists, audited settings.listed on the reader', async () => {
    const s = surface();
    expect(await s.verified().settings.list()).toEqual({ items: [ITEM] });
    expect(s.reached).toEqual([['list', TX, ADMIN]]);
    expect(s.written).toEqual([
      { action: 'settings.listed', targetType: 'admin', targetId: ADMIN, adminId: ADMIN },
    ]);
  });
});

describe('settings.update (FR-624)', () => {
  it('changes through the service and answers the key and the value, audited setting.changed on the key with the reason, before and after', async () => {
    const s = surface();
    expect(await calls['settings.update'](s.verified())).toEqual({
      key: 'chat_page_size',
      value: 40,
    });
    expect(s.reached).toEqual([['update', TX, ADMIN, UPDATE]]);
    expect(s.written).toEqual([
      {
        action: 'setting.changed',
        targetType: 'setting',
        targetId: 'chat_page_size',
        reason: REASON,
        before: { value: 50 },
        after: { value: 40 },
        adminId: ADMIN,
      },
    ]);
  });

  it('a replay answers the first change and records no second entry', async () => {
    const s = surface({ replayed: true });
    expect(await calls['settings.update'](s.verified())).toEqual({
      key: 'chat_page_size',
      value: 40,
    });
    expect(s.reached).toHaveLength(1);
    expect(s.written).toEqual([]);
  });

  it('refuses a change with no reason, or a blank one, before the service, writing nothing', async () => {
    const s = surface();
    const { reason: _reason, ...noReason } = UPDATE;
    expect((await bodyOf(s.verified().settings.update(noReason as never))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await bodyOf(s.verified().settings.update({ ...UPDATE, reason: '  ' }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(s.reached).toEqual([]);
    expect(s.written).toEqual([]);
    await calls['settings.update'](s.verified());
    expect(s.reached).toHaveLength(1);
  });

  it('answers the service’s refusal with its code, auditing nothing', async () => {
    const s = surface({
      refusal: new DomainError('VALIDATION_FAILED', undefined, {
        details: [{ path: 'value', code: 'out_of_bounds' }],
      }),
    });
    expect(await bodyOf(calls['settings.update'](s.verified()))).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'value', code: 'out_of_bounds' }],
    });
    expect(s.written).toEqual([]);
  });
});
