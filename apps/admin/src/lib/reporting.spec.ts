// R3 T183: the panel's crash reports (Q-5 (a), `r3\research\build-ops.md` §1). With no
// `VITE_SENTRY_DSN` Sentry is never started, so the tests, a development server and a build without
// the key send nothing. With one, Sentry starts with every collector of personal data off (Sentry
// 11's `dataCollection`, as the API's), no replay and no tracing, the build's environment
// (development by default) and the surface's tag. Every event and breadcrumb leaves through the
// API's redaction list (kept equal by `tests/pipeline/scrub-parity.spec.ts`), without the request's
// body, cookies or query and with the user's id only; an expected outcome (a refusal carrying the
// API's code, `UPDATE_REQUIRED`, a call with no answer) is never sent. The administrator is set as
// `{ id }` once the session is verified and cleared when it ends.
//
// No case makes a network call: `@sentry/react` is a recording stand-in. The module's on/off state
// lives in the module, so each case loads a fresh copy of it.
import type * as SentryModule from '@sentry/react';
import type * as TrpcClient from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionStore } from './session';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
}));

type Sentry = typeof SentryModule;
type Reporting = typeof import('./reporting');
type Options = NonNullable<Parameters<Sentry['init']>[0]>;
type SentEvent = Parameters<NonNullable<Options['beforeSend']>>[0];

let Sentry: Sentry;
let reporting: Reporting;
// Loaded after the reset with the module under test, so an error is of the class its client knows.
let TRPCClientError: typeof TrpcClient.TRPCClientError;

beforeEach(async () => {
  vi.resetModules();
  // A mocked module's factory runs once: its calls are cleared here, not by the reset.
  vi.clearAllMocks();
  Sentry = await import('@sentry/react');
  reporting = await import('./reporting');
  ({ TRPCClientError } = await import('@trpc/client'));
});

const dsn = 'https://public@example.invalid/1';
const planted = 'S3NSITIVE-value-7c2e';
const ADMIN = '0193a6f0-0000-7000-8000-0000000000a1';

function refusal(code: string): Error {
  return new TRPCClientError('refused', {
    meta: { responseJSON: { error: { code, message: 'refused', details: [] } } },
  });
}

/** The options `initReporting` handed to `Sentry.init`. */
function initOptions(): Options {
  const call = vi.mocked(Sentry.init).mock.calls[0];
  expect(call, 'Sentry.init was called').toBeDefined();
  return call?.[0] ?? {};
}

function started(environment?: string, routeOf = () => '/applications'): Options {
  expect(reporting.initReporting({ dsn, environment }, routeOf)).toBe(true);
  return initOptions();
}

/** What `beforeSend` makes of `event` for `error`: null when it is not sent. */
function sent(error: unknown, event: SentEvent = { type: undefined }): SentEvent | null {
  // The module's `beforeSend` answers at once; Sentry's type allows a promise too.
  return started().beforeSend?.(event, { originalException: error }) as SentEvent | null;
}

/** A key spelled from one entry of the list, camel-cased: `['payout', 'ref']` → `payoutRef`. */
function keyOf(words: readonly string[]): string {
  return words
    .map((word, index) => (index === 0 ? word : (word[0]?.toUpperCase() ?? '') + word.slice(1)))
    .join('');
}

function plantedKeys(): Record<string, unknown> {
  const keys = [...reporting.redactedKeys.map(keyOf), 'password', 'sessionToken', 'otp'];
  return Object.fromEntries(keys.map((key) => [key, planted]));
}

const noAnswer = (name: string) => Object.assign(new Error('no answer'), { name });

describe('with no VITE_SENTRY_DSN', () => {
  it('never starts Sentry, an empty value included, and sends nothing', () => {
    expect(reporting.initReporting({ dsn: undefined, environment: 'production' })).toBe(false);
    expect(reporting.initReporting({ dsn: '', environment: 'production' })).toBe(false);
    reporting.reportCrash(new Error('render'), 'stack');
    reporting.setReportingUser(ADMIN);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.setUser).not.toHaveBeenCalled();
  });
});

describe('with a DSN', () => {
  it('starts once with every collector of personal data off', () => {
    const options = started('production');
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(options.dsn).toBe(dsn);
    expect(options.dataCollection).toEqual({
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

  it('adds no replay and no tracing', () => {
    const options = started('production');
    for (const off of [
      'tracesSampleRate',
      'tracesSampler',
      'replaysSessionSampleRate',
      'replaysOnErrorSampleRate',
      'integrations',
    ]) {
      expect(options).not.toHaveProperty(off);
    }
  });

  it('takes the build’s environment, development when it is unset or unknown', () => {
    expect(started('closed-test').environment).toBe('closed-test');
    for (const environment of [undefined, '', 'staging']) {
      vi.mocked(Sentry.init).mockClear();
      expect(reporting.initReporting({ dsn, environment })).toBe(true);
      expect(initOptions().environment).toBe('development');
    }
  });

  it('tags the surface', () => {
    expect(started().initialScope).toEqual({ tags: { surface: 'admin' } });
  });
});

describe('beforeSend: expected outcomes are not sent', () => {
  it('drops a refusal carrying the API’s code', () => {
    expect(sent(refusal('NOT_FOUND'))).toBeNull();
    expect(sent(refusal('MFA_REQUIRED'))).toBeNull();
  });

  it('drops UPDATE_REQUIRED', () => {
    expect(sent(refusal('UPDATE_REQUIRED'))).toBeNull();
  });

  it('drops a call that had no answer: offline', () => {
    expect(sent(TRPCClientError.from(new TypeError('Failed to fetch')))).toBeNull();
    expect(sent(new TypeError('NetworkError when attempting to fetch resource.'))).toBeNull();
  });

  it('drops a call that had no answer: aborted or past its timeout', () => {
    expect(sent(TRPCClientError.from(noAnswer('AbortError')))).toBeNull();
    expect(sent(noAnswer('TimeoutError'))).toBeNull();
  });

  it('keeps an unexpected error, tagged with the route’s path and its own code', () => {
    expect(sent(new TypeError('x is undefined'))).toMatchObject({
      tags: { route: '/applications' },
    });
    const coded = Object.assign(new Error('pdf'), { code: 'ERR_PDF' });
    expect(sent(coded)).toMatchObject({ tags: { 'error.code': 'ERR_PDF' } });
  });
});

describe('beforeSend: what an event carries', () => {
  it('redacts every key of the API’s list at any depth, keeping the key', () => {
    const event = sent(new Error('bug'), {
      type: undefined,
      extra: { level1: { level2: plantedKeys(), harmless: 'kept' } },
      contexts: { app: plantedKeys() },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(planted);
    expect(text).toContain('kept');
    expect(text).toContain('"password":"[redacted]"');
  });

  it('drops the request’s body, cookies and query', () => {
    const event = sent(new Error('bug'), {
      type: undefined,
      request: {
        url: `https://admin.example.invalid/payouts?teacher=${planted}`,
        method: 'GET',
        data: { note: planted },
        cookies: { sid: planted },
        query_string: `teacher=${planted}`,
      },
    });
    expect(event?.request).toEqual({ url: 'https://admin.example.invalid/payouts', method: 'GET' });
  });

  it('keeps the user’s id only', () => {
    const event = sent(new Error('bug'), {
      type: undefined,
      user: { id: ADMIN, email: 'a@example.invalid', username: 'sara', ip_address: '10.0.0.1' },
    });
    expect(event?.user).toEqual({ id: ADMIN });
  });

  it('carries the bundle’s debug ids untouched, so the maps resolve', () => {
    const debugMeta = {
      images: [
        {
          type: 'sourcemap' as const,
          code_file: 'https://admin.example.invalid/a.js',
          debug_id: 'd',
        },
      ],
    };
    expect(sent(new Error('bug'), { type: undefined, debug_meta: debugMeta })?.debug_meta).toEqual(
      debugMeta,
    );
  });
});

describe('beforeBreadcrumb', () => {
  it('redacts the list’s keys and drops a call’s query', () => {
    const breadcrumb = started().beforeBreadcrumb?.(
      {
        category: 'fetch',
        data: {
          url: `https://api.example.invalid/admin/trpc/x?input=${planted}`,
          ...plantedKeys(),
        },
      },
      {},
    );
    expect(breadcrumb?.category).toBe('fetch');
    expect(breadcrumb?.data?.['url']).toBe('https://api.example.invalid/admin/trpc/x');
    expect(JSON.stringify(breadcrumb)).not.toContain(planted);
  });
});

describe('the administrator', () => {
  it('sets the user as { id } only, and clears it', () => {
    started();
    reporting.setReportingUser(ADMIN);
    reporting.setReportingUser(null);
    expect(vi.mocked(Sentry.setUser).mock.calls).toEqual([[{ id: ADMIN }], [null]]);
  });

  it('follows the session: the id once verified (a restored one included), cleared at sign-out', async () => {
    started();
    const sessions = createSessionStore(() => window.sessionStorage);
    sessions.write({ token: 'restored', step: 'verified' });
    const adminIdOf = vi.fn(async () => ADMIN);
    reporting.followReportingUser(sessions, adminIdOf);
    await vi.waitFor(() => expect(Sentry.setUser).toHaveBeenLastCalledWith({ id: ADMIN }));
    sessions.clear();
    expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
    sessions.write({ token: 'next', step: 'mfa' });
    sessions.setStep('verified');
    await vi.waitFor(() => expect(adminIdOf).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(Sentry.setUser).toHaveBeenLastCalledWith({ id: ADMIN }));
  });

  it('asks nothing while reporting is off', () => {
    const sessions = createSessionStore(() => window.sessionStorage);
    sessions.write({ token: 'restored', step: 'verified' });
    const adminIdOf = vi.fn(async () => ADMIN);
    reporting.followReportingUser(sessions, adminIdOf);
    expect(adminIdOf).not.toHaveBeenCalled();
  });

  it('reports a render error with its component stack', () => {
    started();
    const error = new Error('render');
    reporting.reportCrash(error, '\n    at Child');
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      contexts: { react: { componentStack: '\n    at Child' } },
    });
  });
});
