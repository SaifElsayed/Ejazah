// T144 — error reporting (FR-051, FR-040, FR-054, R-SEC-2; T111).
//
// With no `SENTRY_DSN` reporting stays off: nothing is initialised and `reportError` sends nothing,
// so a fresh checkout and the test suite need no credential (FR-054). With one, the SDK is started
// with every collector of an R-SEC-2 value off, and every event and breadcrumb passes the logger's
// redaction list on its way out (FR-040): `scrubEvent` drops the request body and cookies and, at any
// depth, replaces the value of every key the list names with `[redacted]`, keeping the key.
//
// No case makes a network call: `@sentry/node` is replaced by a recording stand-in, so `init` and
// `captureException` are observed rather than run. The module's on/off state lives in the module,
// so each case loads a fresh copy of it.
import type * as SentryModule from '@sentry/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTED, redactedKeys, redactedLastWords } from '../logging/logger.js';

vi.mock('@sentry/node', () => ({ init: vi.fn(), captureException: vi.fn() }));

type Sentry = typeof SentryModule;
type Reporting = typeof import('./reporting.js');

let Sentry: Sentry;
let reporting: Reporting;

beforeEach(async () => {
  vi.resetModules();
  Sentry = await import('@sentry/node');
  reporting = await import('./reporting.js');
});

const dsn = 'https://public@example.invalid/1';
const planted = 'S3NSITIVE-value-7c2e';

/** The options `initReporting` handed to `Sentry.init`. */
function initOptions(): SentryModule.NodeOptions {
  const call = vi.mocked(Sentry.init).mock.calls[0];
  expect(call, 'Sentry.init was called').toBeDefined();
  return call?.[0] ?? {};
}

/** A key spelled from one entry of the logger's list, camel-cased: `['payout', 'ref']` → `payoutRef`. */
function keyOf(words: readonly string[]): string {
  return words
    .map((word, index) => (index === 0 ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join('');
}

const listedKeys = [
  ...redactedKeys.map(keyOf),
  ...redactedLastWords.map((word) => `gateway_${word}`),
];

/** Every listed key planted three levels down, beside a harmless value. */
function plantedAtDepth(): Record<string, unknown> {
  return {
    level1: {
      level2: {
        level3: Object.fromEntries(listedKeys.map((key) => [key, planted])),
        harmless: 'kept',
      },
    },
  };
}

function expectRedactedAtDepth(value: unknown): void {
  const level3 = (value as { level1: { level2: { level3: Record<string, unknown> } } }).level1
    .level2.level3;
  for (const key of listedKeys) expect(level3[key], key).toBe(REDACTED);
  expect(Object.keys(level3).sort()).toEqual([...listedKeys].sort());
  expect(JSON.stringify(value)).not.toContain(planted);
  expect(JSON.stringify(value)).toContain('kept');
}

describe('with no SENTRY_DSN reporting stays off (FR-054)', () => {
  it('initialises nothing', () => {
    expect(reporting.initReporting({ dsn: undefined, environment: 'test' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('sends nothing, before or after an attempt to initialise', () => {
    reporting.reportError(new Error('before'), 'correlation-1');
    reporting.initReporting({ dsn: undefined, environment: 'development' });
    reporting.reportError(new Error('after'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('with a SENTRY_DSN (FR-051)', () => {
  it('initialises once with the configured DSN and environment', () => {
    expect(reporting.initReporting({ dsn, environment: 'production' })).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(initOptions()).toMatchObject({ dsn, environment: 'production' });
  });

  // R3 T183 (Q-5 (a)): the two optional keys of env.schema.ts.
  const lastInit = (): SentryModule.NodeOptions =>
    vi.mocked(Sentry.init).mock.calls.at(-1)?.[0] ?? {};

  it('sends to SENTRY_ENVIRONMENT’s environment when it is set, else to NODE_ENV’s', () => {
    reporting.initReporting({ dsn, environment: 'production', sentryEnvironment: 'closed-test' });
    expect(lastInit().environment).toBe('closed-test');
    reporting.initReporting({ dsn, environment: 'production', sentryEnvironment: undefined });
    expect(lastInit().environment).toBe('production');
  });

  it('names the deploy’s release when SENTRY_RELEASE is set, and none otherwise', () => {
    reporting.initReporting({ dsn, environment: 'production', release: 'deb6b02' });
    expect(lastInit().release).toBe('deb6b02');
    reporting.initReporting({ dsn, environment: 'production' });
    expect(lastInit()).not.toHaveProperty('release');
  });

  it('turns off every collector of a value R-SEC-2 keeps out', () => {
    reporting.initReporting({ dsn, environment: 'production' });
    expect(initOptions().dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    });
  });

  it('reports an error, tagged with the correlation identifier when there is one', () => {
    reporting.initReporting({ dsn, environment: 'production' });
    const tagged = new Error('tagged');
    const untagged = new Error('untagged');
    reporting.reportError(tagged, 'correlation-2');
    reporting.reportError(untagged);
    expect(Sentry.captureException).toHaveBeenNthCalledWith(1, tagged, {
      tags: { correlationId: 'correlation-2' },
    });
    expect(Sentry.captureException).toHaveBeenNthCalledWith(2, untagged, undefined);
  });

  it('scrubs every event on its way out', () => {
    reporting.initReporting({ dsn, environment: 'production' });
    const event: SentryModule.ErrorEvent = {
      type: undefined,
      request: { data: { password: planted }, cookies: { session: planted }, url: '/x' },
      extra: plantedAtDepth(),
    };
    const sent = initOptions().beforeSend?.(event, {});
    expect(sent).toEqual(reporting.scrubEvent(event));
    expect(JSON.stringify(sent)).not.toContain(planted);
  });

  it('redacts every breadcrumb the same way, at any depth, keeping the keys', () => {
    reporting.initReporting({ dsn, environment: 'production' });
    const breadcrumb: SentryModule.Breadcrumb = { category: 'http', data: plantedAtDepth() };
    const kept = initOptions().beforeBreadcrumb?.(breadcrumb, {});
    expect(kept?.category).toBe('http');
    expectRedactedAtDepth(kept?.data);
  });
});

describe('scrubEvent (FR-040, R-SEC-2)', () => {
  it('drops the request body and cookies', () => {
    const scrubbed = reporting.scrubEvent({
      request: {
        data: '{"otp":"123456"}',
        cookies: { sid: planted },
        method: 'POST',
        url: '/auth',
      },
    });
    expect(scrubbed.request).toEqual({ method: 'POST', url: '/auth' });
  });

  it('redacts, at any depth, the value of every key the logger’s list names, keeping the key', () => {
    const scrubbed = reporting.scrubEvent({
      extra: plantedAtDepth(),
      contexts: { app: plantedAtDepth() },
    });
    expectRedactedAtDepth(scrubbed.extra);
    expectRedactedAtDepth(scrubbed.contexts?.['app']);
  });

  it('redacts request headers, list items and the breadcrumbs carried in the event', () => {
    const scrubbed = reporting.scrubEvent({
      request: { headers: { authorization: `Bearer ${planted}`, 'x-correlation-id': 'c-1' } },
      extra: { attempts: [{ token: planted }, { harmless: 'kept' }] },
      breadcrumbs: [{ message: 'login', data: { otp: planted } }],
    });
    expect(scrubbed.request?.headers).toEqual({
      authorization: REDACTED,
      'x-correlation-id': 'c-1',
    });
    expect(scrubbed.extra).toEqual({ attempts: [{ token: REDACTED }, { harmless: 'kept' }] });
    expect(scrubbed.breadcrumbs).toEqual([{ message: 'login', data: { otp: REDACTED } }]);
  });

  it('leaves the caller’s event untouched', () => {
    const event = { request: { data: planted }, extra: { token: planted } };
    reporting.scrubEvent(event);
    expect(event).toEqual({ request: { data: planted }, extra: { token: planted } });
  });
});
