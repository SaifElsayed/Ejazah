// T067 — the administrator surface as `admin.router.ts` mounts it: its anonymous procedures are
// exactly the six of `auth.*` that sign an administrator in (admin-surface.md; FR-170, R-SEC-8).
// Proven by behaviour rather than by a list: every procedure the surface serves is called with no
// session and no input. The administrator kind refuses before it reads the input, so each of its
// procedures answers UNAUTHENTICATED; the anonymous kind reads the input first, so each of its
// procedures answers the validation failure instead. No service is reached either way.
import { describe, expect, it, vi } from 'vitest';

import type { RateLimiter } from '../platform/guards/rate-limit.guard.js';
import { createLogger } from '../platform/logging/logger.js';
import { adminRouter } from './admin.router.js';
import { createAdminContext } from './context.js';
import { createAdminCallerFactory, toErrorShape } from './procedures.js';
import { unusedAdminServices } from './services.fixtures.js';

const log = createLogger({ level: 'fatal' });

const context = createAdminContext({
  session: null,
  log,
  administration: {
    transactions: { run: () => Promise.reject(new Error('no transaction is opened here')) },
    auditWriter: { write: () => Promise.reject(new Error('no entry is written here')) },
  } as never,
  services: unusedAdminServices,
  rateLimiter: { check: vi.fn(async () => undefined) } as unknown as RateLimiter,
  clientAddress: '203.0.113.9',
});

const caller = createAdminCallerFactory(adminRouter)(context) as unknown as Record<string, unknown>;

/** The procedure at `path` on the caller, as a function of its input. */
function procedureAt(path: string): (input: unknown) => Promise<unknown> {
  const found = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller);
  return found as (input: unknown) => Promise<unknown>;
}

async function codeOf(path: string): Promise<string> {
  const thrown: unknown = await procedureAt(path)(undefined).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error(`${path} answered an anonymous call with no input`);
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('the administrator surface’s anonymous procedures (T067)', () => {
  it('are exactly the six sign-in procedures of auth.*; every other one refuses an anonymous caller', async () => {
    const paths = Object.keys(adminRouter._def.procedures).sort();
    expect(paths.length).toBeGreaterThan(6);
    const anonymous: string[] = [];
    for (const path of paths) {
      const code = await codeOf(path);
      if (code !== 'UNAUTHENTICATED') {
        expect(code).toBe('VALIDATION_FAILED');
        anonymous.push(path);
      }
    }
    expect(anonymous).toEqual([
      'auth.mfa.recover',
      'auth.mfa.setup.begin',
      'auth.mfa.setup.confirm',
      'auth.mfa.verify',
      'auth.setPassword',
      'auth.signIn',
    ]);
  });
});
