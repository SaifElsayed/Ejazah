// R3 T183: the phone's crash reports, to Sentry (`docs/ARCHITECTURE.md` §12; Q-5 (a),
// `r3\research\build-ops.md` §1).
//
// `initReporting` is called once per process by the root layout. With no `EXPO_PUBLIC_SENTRY_DSN`
// in the build's environment it starts nothing, and every other call here does nothing, so a fresh
// checkout, the tests and a build without the key send nothing. With one, Sentry starts with
// personal data off (`sendDefaultPii`), no replay, screenshot, view hierarchy or tracing, and
// release health on (the SDK's default); release and dist stay the SDK's own (the package name,
// the version and the version code), so the maps EAS uploads match. `environment` is
// `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (development, closed-test or production; development otherwise).
//
// An event leaves the phone as an API log line does, so R-SEC-2 applies: every event and breadcrumb
// goes through the API's redaction list (`apps/api/src/platform/logging/logger.ts` `redactedKeys`,
// copied here word for word; `tests/pipeline/scrub-parity.spec.ts` keeps the lists equal), the
// request's body, cookies and query are dropped (a tRPC read carries its input in the query), and
// the user keeps its id only. The bundle's debug ids (`debug_meta`) pass untouched: they name files,
// and the uploaded maps are found by them.
//
// An expected outcome is not reported: a refusal carrying the API's code (the API reports what it
// did not expect itself; `UPDATE_REQUIRED` among them) and a call with no answer (offline, aborted,
// past its timeout). Tags: `surface`, `app.build` (the version code, `expo-application`), an
// error's own `code` as `error.code`, and the route's name (never its values). No `correlationId`:
// the API does not return its correlation id to the client.
import * as Sentry from '@sentry/react-native';
import * as Application from 'expo-application';

import { errorCodeOf } from './client';

type Options = NonNullable<Parameters<typeof Sentry.init>[0]>;
type SentEvent = Parameters<NonNullable<Options['beforeSend']>>[0];
type Breadcrumb = Parameters<NonNullable<Options['beforeBreadcrumb']>>[0];

export type ReportingEnvironment = 'development' | 'closed-test' | 'production';

const ENVIRONMENTS: readonly ReportingEnvironment[] = ['development', 'closed-test', 'production'];
const DEFAULT_ENVIRONMENT: ReportingEnvironment = 'development';
const SURFACE = 'app';

export interface ReportingConfig {
  /** `EXPO_PUBLIC_SENTRY_DSN`; reporting is off when absent or empty. */
  readonly dsn: string | undefined;
  /** `EXPO_PUBLIC_SENTRY_ENVIRONMENT`. */
  readonly environment: string | undefined;
}

/** The build's values, inlined by Expo's Babel preset from the build machine's environment. */
function buildConfig(): ReportingConfig {
  return {
    dsn: process.env['EXPO_PUBLIC_SENTRY_DSN'],
    environment: process.env['EXPO_PUBLIC_SENTRY_ENVIRONMENT'],
  };
}

/**
 * The API's redaction list (`logger.ts` `redactedKeys`), word for word: a key is redacted when its
 * words include every word of one entry.
 */
export const redactedKeys: readonly (readonly string[])[] = [
  // request body
  ['body'],
  // one-time code (a bare `code` included; a classification code is kept, below)
  ['otp'],
  ['totp'],
  ['code'],
  // token, and the authentication session
  ['token'],
  ['authorization'],
  ['cookie'],
  ['session', 'auth'],
  // payment payload
  ['payload', 'payment'],
  ['payload', 'gateway'],
  ['payload', 'webhook'],
  // document URL: a URL that is the access to a stored file (R-SEC-3), and the storage key itself
  ...['url', 'uri', 'link'].flatMap((noun) =>
    [
      'document',
      'doc',
      'signed',
      'certificate',
      'attachment',
      'download',
      'upload',
      'presigned',
      'photo',
      'signature',
      'checkout',
    ].map((file) => [noun, file]),
  ),
  ['storage', 'key'],
  ['media', 'key'],
  // payout identifier
  ['payout', 'ref'],
  ['payout', 'reference'],
  ['payout', 'account'],
  ['payout', 'recipient'],
  ['recipient', 'ref'],
  ['recipient', 'reference'],
  // card fragment
  ['card'],
  ['cvv'],
  ['cvc'],
  // credential
  ['password'],
  ['passwd'],
  ['secret'],
  ['credential'],
  ...['api', 'private', 'signing', 'secret', 'encryption', 'webhook', 'access'].map((kind) => [
    'key',
    kind,
  ]),
  // The same values written as one word.
  ['apikey'],
  ['accesstoken'],
  ['refreshtoken'],
  ['idtoken'],
  ['authtoken'],
  ['sessionid'],
  ['jwt'],
  ['passphrase'],
  ['pan'],
  ['last4'],
];

const REDACTED = '[redacted]';
// As the API's list reads a name (logger.ts): one ending or starting with these says when, how many
// or whether; `code` directly after one of the classification words is an error or status code.
const FACT_LAST_WORDS = new Set(['at', 'count', 'attempts']);
const FACT_FIRST_WORDS = new Set(['has', 'is']);
const CLASSIFICATION_WORDS = new Set(['error', 'status', 'result', 'reason', 'http']);

function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/** The word, its singular and the word without a trailing number (`tokens`, `token2`). */
function formsOf(word: string): string[] {
  const forms = [word];
  if (word.length > 1 && word.endsWith('s')) forms.push(word.slice(0, -1));
  const unnumbered = word.replace(/[0-9]+$/, '');
  if (unnumbered !== '' && unnumbered !== word) forms.push(unnumbered);
  return forms;
}

function isRedactedKey(name: string): boolean {
  const words = wordsOf(name);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return false;
  if (FACT_LAST_WORDS.has(last) || FACT_FIRST_WORDS.has(first)) return false;
  const present = new Set(words.flatMap(formsOf));
  const classified = words.every(
    (word, index) =>
      !formsOf(word).includes('code') || CLASSIFICATION_WORDS.has(words[index - 1] ?? ''),
  );
  if (classified) present.delete('code');
  return redactedKeys.some((entry) => entry.every((word) => present.has(word)));
}

/** A copy of `value` with every redacted key's value replaced, at any depth. */
function redact(value: unknown, path: Set<object> = new Set()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) return '[circular]';
  path.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redact(item, path));
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isRedactedKey(key) ? REDACTED : redact(inner, path);
    }
    return out;
  } finally {
    path.delete(value);
  }
}

/** `url` without its query and fragment. */
function withoutQuery(url: string): string {
  return url.replace(/[?#][^]*$/, '');
}

/** The event as it may leave: redacted, the request's body, cookies and query dropped, the id only. */
function scrubEvent(event: SentEvent): SentEvent {
  const { debug_meta: debugMeta, ...rest } = event;
  // A copy: what is deleted below is the copy's.
  const scrubbed = redact(rest) as SentEvent;
  const { request, user } = scrubbed;
  if (request !== undefined) {
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.url !== undefined) request.url = withoutQuery(request.url);
  }
  if (user !== undefined) {
    if (user.id === undefined) delete scrubbed.user;
    else scrubbed.user = { id: user.id };
  }
  return debugMeta === undefined ? scrubbed : { ...scrubbed, debug_meta: debugMeta };
}

// PR #163 r1 Major 2: the categories of a tap's breadcrumb (`Sentry.wrap`'s touch boundary and its
// rage-tap detector, @sentry/react-native 8.28.0). Their `message`, each `path` entry's `label` and
// the rage tap's `node` and `route` carry the text on screen (a name, often a minor's, an e-mail, a
// chat line), so a tap's breadcrumb is rebuilt from what names a component only.
const TAP_CATEGORIES: ReadonlySet<string> = new Set(['touch', 'ui.multiClick']);
const COMPONENT_FIELDS = ['name', 'element', 'file'] as const;

/** A touched component's names, with no text from the screen. */
function componentOf(entry: unknown): Record<string, string> {
  const component: Record<string, string> = {};
  if (typeof entry !== 'object' || entry === null) return component;
  for (const field of COMPONENT_FIELDS) {
    const value = (entry as Record<string, unknown>)[field];
    if (typeof value === 'string') component[field] = value;
  }
  return component;
}

/** A tap's breadcrumb as it may leave: its kind, its time, the components touched, the tap count. */
function tapBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const { category, type, level, timestamp, data } = breadcrumb;
  const path = data?.['path'];
  const clickCount = data?.['clickCount'];
  const kept: Record<string, unknown> = {};
  if (Array.isArray(path)) kept['path'] = path.map(componentOf);
  if (typeof clickCount === 'number') kept['clickCount'] = clickCount;
  return {
    ...(category === undefined ? {} : { category }),
    ...(type === undefined ? {} : { type }),
    ...(level === undefined ? {} : { level }),
    ...(timestamp === undefined ? {} : { timestamp }),
    data: kept,
  };
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== undefined && TAP_CATEGORIES.has(breadcrumb.category)) {
    return redact(tapBreadcrumb(breadcrumb)) as Breadcrumb;
  }
  const scrubbed = redact(breadcrumb) as Breadcrumb;
  const url = scrubbed.data?.['url'];
  if (scrubbed.data !== undefined && typeof url === 'string') {
    scrubbed.data = { ...scrubbed.data, url: withoutQuery(url) };
  }
  return scrubbed;
}

// A call with no answer, as lib/client.ts and the platform's fetch fail it: aborted, past its
// timeout (`timed()`), or no connection.
const NO_ANSWER_NAMES = new Set(['AbortError', 'TimeoutError']);
const NO_CONNECTION = /network request failed|failed to fetch|network ?error/i;
/** How far down an error's `cause` chain a call's failure is looked for. */
const CAUSE_DEPTH = 4;

function isNoAnswer(error: unknown): boolean {
  let link: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH && typeof link === 'object' && link !== null; depth++) {
    const { name, message, cause } = link as { name?: unknown; message?: unknown; cause?: unknown };
    if (typeof name === 'string' && NO_ANSWER_NAMES.has(name)) return true;
    if (name === 'TypeError' && typeof message === 'string' && NO_CONNECTION.test(message)) {
      return true;
    }
    link = cause;
  }
  return false;
}

/** Whether `error` is an outcome the app expects: never reported. */
function isExpected(error: unknown): boolean {
  return errorCodeOf(error) !== undefined || isNoAnswer(error);
}

/** An error's own `code` (a native module's), when it carries one as text. */
function ownCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

const beforeSend: NonNullable<Options['beforeSend']> = (event, hint) => {
  const error = hint.originalException;
  if (isExpected(error)) return null;
  const code = ownCodeOf(error);
  const tagged =
    code === undefined ? event : { ...event, tags: { ...event.tags, 'error.code': code } };
  return scrubEvent(tagged);
};

function environmentOf(value: string | undefined): ReportingEnvironment {
  return ENVIRONMENTS.find((environment) => environment === value) ?? DEFAULT_ENVIRONMENT;
}

let enabled = false;

/** Starts Sentry when the build carries a DSN. Returns whether it is on. */
export function initReporting(config: ReportingConfig = buildConfig()): boolean {
  if (config.dsn === undefined || config.dsn === '') return false;
  const build = Application.nativeBuildVersion;
  Sentry.init({
    dsn: config.dsn,
    environment: environmentOf(config.environment),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    initialScope: { tags: { surface: SURFACE, ...(build === null ? {} : { 'app.build': build }) } },
    beforeSend,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  enabled = true;
  return true;
}

/** Reports a render error the root's boundary caught, with React's component stack. */
export function reportCrash(error: unknown, componentStack?: string | null): void {
  if (!enabled) return;
  Sentry.captureException(error, { contexts: { react: { componentStack } } });
}

/** The signed-in account, as its id only; null at sign-out. */
export function setReportingUser(id: string | null): void {
  if (!enabled) return;
  Sentry.setUser(id === null ? null : { id });
}

/** The route's name, its segments as the file tree names them (`[id]`, never the id). */
export function setReportingRoute(segments: readonly string[]): void {
  if (!enabled) return;
  Sentry.setTag('route', `/${segments.join('/')}`);
}
