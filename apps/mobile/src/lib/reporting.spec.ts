// R3 T183: the phone's crash reports (Q-5 (a), `r3\research\build-ops.md` §1). With no
// `EXPO_PUBLIC_SENTRY_DSN` Sentry is never started, so a fresh checkout, the tests and a build
// without the key send nothing. With one, Sentry starts with personal data off, no replay, no
// screenshot, no view hierarchy and no tracing, release and dist left to the SDK, the build's
// environment (development by default) and two tags, the surface and the build number. Every event
// and breadcrumb leaves through the API's redaction list (logger.ts `redactedKeys`, kept equal by
// `tests/pipeline/scrub-parity.spec.ts`), without the request's body, cookies or query and with the
// user's id only; an expected outcome (a refusal carrying the API's code, `UPDATE_REQUIRED`, a call
// with no answer) is never sent.
//
// No case makes a network call: `@sentry/react-native` is a recording stand-in, so `init` and its
// options are observed rather than run. The module's on/off state lives in the module, so each case
// loads a fresh copy of it.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as SentryModule from '@sentry/react-native';
import type * as TrpcClient from '@trpc/client';

import type * as ApiDouble from '../features/shared/__tests__/api-double';

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('expo-application', () => ({ nativeBuildVersion: '7' }));

type Sentry = typeof SentryModule;
type Reporting = typeof import('./reporting');
type Options = NonNullable<Parameters<Sentry['init']>[0]>;
type SentEvent = Parameters<NonNullable<Options['beforeSend']>>[0];

let Sentry: Sentry;
let reporting: Reporting;
// Loaded after the reset with the module under test, so an error is of the class its client knows.
let TRPCClientError: typeof TrpcClient.TRPCClientError;
let apiError: typeof ApiDouble.apiError;

beforeEach(() => {
  jest.resetModules();
  Sentry = require('@sentry/react-native') as Sentry;
  reporting = require('./reporting') as Reporting;
  ({ TRPCClientError } = require('@trpc/client') as typeof TrpcClient);
  ({ apiError } = require('../features/shared/__tests__/api-double') as typeof ApiDouble);
});

const dsn = 'https://public@example.invalid/1';
const planted = 'S3NSITIVE-value-7c2e';

/** The options `initReporting` handed to `Sentry.init`. */
function initOptions(): Options {
  const call = jest.mocked(Sentry.init).mock.calls[0];
  expect(call).toBeDefined();
  return call?.[0] ?? {};
}

function started(environment?: string): Options {
  expect(reporting.initReporting({ dsn, environment })).toBe(true);
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
  const keys = [...reporting.redactedKeys.map(keyOf), 'password', 'accessToken', 'otp'];
  return Object.fromEntries(keys.map((key) => [key, planted]));
}

const noAnswer = (name: string) => Object.assign(new Error('no answer'), { name });

describe('with no EXPO_PUBLIC_SENTRY_DSN', () => {
  it('never starts Sentry, an empty value included, and sends nothing', () => {
    expect(reporting.initReporting({ dsn: undefined, environment: 'production' })).toBe(false);
    expect(reporting.initReporting({ dsn: '', environment: 'production' })).toBe(false);
    reporting.reportCrash(new Error('render'), 'stack');
    reporting.setReportingUser('0193a6f0-0000-7000-8000-000000000001');
    reporting.setReportingRoute(['(student)', '(tabs)']);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.setUser).not.toHaveBeenCalled();
    expect(Sentry.setTag).not.toHaveBeenCalled();
  });
});

describe('with a DSN', () => {
  it('starts once with personal data off', () => {
    const options = started('production');
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(options.dsn).toBe(dsn);
    expect(options.sendDefaultPii).toBe(false);
  });

  it('turns off replay, screenshots, the view hierarchy and tracing; keeps release health', () => {
    const options = started('production');
    expect(options.attachScreenshot).toBe(false);
    expect(options.attachViewHierarchy).toBe(false);
    for (const off of [
      'tracesSampleRate',
      'tracesSampler',
      'replaysSessionSampleRate',
      'replaysOnErrorSampleRate',
      'integrations',
      'enableAutoSessionTracking',
    ]) {
      expect(options).not.toHaveProperty(off);
    }
  });

  it('leaves release and dist to the SDK', () => {
    const options = started('production');
    expect(options).not.toHaveProperty('release');
    expect(options).not.toHaveProperty('dist');
  });

  it('takes the build’s environment, development when it is unset or unknown', () => {
    expect(started('closed-test').environment).toBe('closed-test');
    for (const environment of [undefined, '', 'staging']) {
      jest.mocked(Sentry.init).mockClear();
      expect(reporting.initReporting({ dsn, environment })).toBe(true);
      expect(initOptions().environment).toBe('development');
    }
  });

  it('tags the surface and the build number', () => {
    expect(started().initialScope).toEqual({ tags: { surface: 'app', 'app.build': '7' } });
  });
});

describe('beforeSend: expected outcomes are not sent', () => {
  it('drops a refusal carrying the API’s code', () => {
    expect(sent(apiError('NOT_FOUND'))).toBeNull();
    expect(sent(apiError('RATE_LIMITED'))).toBeNull();
  });

  it('drops UPDATE_REQUIRED', () => {
    expect(sent(apiError('UPDATE_REQUIRED'))).toBeNull();
  });

  it('drops a call that had no answer: offline', () => {
    expect(sent(TRPCClientError.from(new TypeError('Network request failed')))).toBeNull();
    expect(sent(new TypeError('Network request failed'))).toBeNull();
  });

  it('drops a call that had no answer: aborted or past its timeout', () => {
    expect(sent(TRPCClientError.from(noAnswer('TimeoutError')))).toBeNull();
    expect(sent(noAnswer('AbortError'))).toBeNull();
  });

  it('keeps an unexpected error, tagged with its own code when it carries one', () => {
    expect(sent(new TypeError('undefined is not an object'))).not.toBeNull();
    const coded = Object.assign(new Error('native'), { code: 'ERR_UNAVAILABLE' });
    expect(sent(coded)).toMatchObject({ tags: { 'error.code': 'ERR_UNAVAILABLE' } });
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
        url: `https://api.example.invalid/trpc/x?input=${planted}`,
        method: 'GET',
        data: { note: planted },
        cookies: { sid: planted },
        query_string: `input=${planted}`,
      },
    });
    expect(event?.request).toEqual({ url: 'https://api.example.invalid/trpc/x', method: 'GET' });
  });

  it('keeps the user’s id only', () => {
    const event = sent(new Error('bug'), {
      type: undefined,
      user: { id: 'user-1', email: 'a@example.invalid', username: 'amal', ip_address: '10.0.0.1' },
    });
    expect(event?.user).toEqual({ id: 'user-1' });
  });

  it('carries the bundle’s debug ids untouched, so the maps resolve', () => {
    const debugMeta = {
      images: [
        { type: 'sourcemap' as const, code_file: 'app:///index.android.bundle', debug_id: 'd-1' },
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
        data: { url: `https://api.example.invalid/trpc/x?input=${planted}`, ...plantedKeys() },
      },
      {},
    );
    expect(breadcrumb?.category).toBe('fetch');
    expect(breadcrumb?.data?.['url']).toBe('https://api.example.invalid/trpc/x');
    expect(JSON.stringify(breadcrumb)).not.toContain(planted);
  });

  // PR #163 r1 Major 2: a tap's breadcrumb, as `Sentry.wrap`'s touch boundary and its rage-tap
  // detector write it (8.28.0 `touchevents.js`, `ragetap.js`), carries the text on screen: a name, an
  // e-mail, a chat line. Only the component names leave.
  it('keeps a tap’s component names and drops the text on screen', () => {
    const name = 'أمل عادل';
    const email = 'amal@example.com';
    const path = [
      { name: 'TeacherCard', label: name, file: 'TeacherCard.tsx', element: 'RCTView' },
      { name: 'Pressable', label: email },
    ];
    const touch = started().beforeBreadcrumb?.(
      {
        category: 'touch',
        type: 'user',
        level: 'info',
        message: `Touch event within element: ${name}`,
        data: { path },
      },
      {},
    );
    const rage = started().beforeBreadcrumb?.(
      {
        category: 'ui.multiClick',
        type: 'default',
        message: email,
        data: {
          clickCount: 3,
          metric: true,
          route: 'teacher/students/[id]',
          node: {
            id: 0,
            tagName: 'RCTView',
            textContent: '',
            attributes: { 'sentry-label': name },
          },
          path,
        },
      },
      {},
    );
    for (const breadcrumb of [touch, rage]) {
      expect(JSON.stringify(breadcrumb)).not.toContain(name);
      expect(JSON.stringify(breadcrumb)).not.toContain(email);
      expect(breadcrumb?.message).toBeUndefined();
      expect(breadcrumb?.data?.['path']).toEqual([
        { name: 'TeacherCard', file: 'TeacherCard.tsx', element: 'RCTView' },
        { name: 'Pressable' },
      ]);
    }
    expect(touch).toMatchObject({ category: 'touch', type: 'user', level: 'info' });
    expect(rage).toMatchObject({ category: 'ui.multiClick', data: { clickCount: 3 } });
  });
});

describe('the scope', () => {
  it('sets the user as { id } only, and clears it at sign-out', () => {
    started();
    reporting.setReportingUser('0193a6f0-0000-7000-8000-000000000001');
    reporting.setReportingUser(null);
    expect(jest.mocked(Sentry.setUser).mock.calls).toEqual([
      [{ id: '0193a6f0-0000-7000-8000-000000000001' }],
      [null],
    ]);
  });

  it('tags the route’s name, as the file tree names it, never its values', () => {
    started();
    reporting.setReportingRoute(['(student)', 'teacher', '[id]']);
    expect(Sentry.setTag).toHaveBeenCalledWith('route', '/(student)/teacher/[id]');
  });

  it('reports a render error with its component stack', () => {
    started();
    const error = new Error('render');
    reporting.reportCrash(error, '\n    in Child');
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      contexts: { react: { componentStack: '\n    in Child' } },
    });
  });
});
