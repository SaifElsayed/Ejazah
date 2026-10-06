// T100: the shared structured logger (FR-040, R-SEC-2, research R-17).
//
// JSON lines through pino, the redaction list declared here, and a correlation identifier on every
// record of a request. Two nets cover R-SEC-2 together (contracts/kernel.md, "Logging"):
// `sec/no-body-logging` refuses a logger call handed a prohibited value by name, and this list
// removes one nested where no rule can see it — any depth, inside arrays, in bound fields too.
//
// DECISION (T100) — pino, the structured logger of the Node ecosystem, with redaction done by key
// name at every depth in its `formatters`, rather than by its own `redact` paths. pino's paths are
// fixed and its wildcard reaches one level, so a list of paths would name the places a secret is
// expected and miss the place it actually turns up. Sentry's server-side scrubbing works the same
// way, by key name at any depth.
//
// THE WORDS are those `sec/no-body-logging` reads for R-SEC-2 (its header), so the lint rule and
// this list name the same values: a key's words are compared whole, camelCase, snake_case and
// kebab-case alike, and, as the rule's `wordSetOf` reads them, a plural as its singular (`tokens`,
// `credentials`) and a word without its trailing number (`token2`). On top of the rule's list, the four names its header hands to this one
// because they are too ambiguous to refuse at build time: a bare `code` (it may be the one-time
// code itself), `card`, an `event` (the parsed gateway payload is a `GatewayEvent`) and a storage
// key. A bare `body` is redacted too: whatever object carries it, a message body may hold a code.
// The rule's loggable vocabulary stays loggable: a teaching session's `sessionId`, a classification
// code (`errorCode`, `statusCode`) and a name that says when, how many or whether
// (`tokenExpiresAt`, `otpAttempts`, `hasToken`). One shared list for both is not built (note in the
// rule's header); a word added to one belongs in the other.
import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger } from 'pino';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export const REDACTED = '[redacted]';

/**
 * The redaction list: a key is redacted when its words include every word of one entry.
 * Each line names the R-SEC-2 value it stands for.
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
    ].map((file) => [noun, file]),
  ),
  ['storage', 'key'],
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
  // The same values written as one word, which no camelCase or snake_case split can separate
  // (review of PR #35, m4): beyond the rule's list, so this net is the wider of the two. `sessionid`
  // is the cookie spelling of an authentication session; a teaching session is `sessionId`.
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

/**
 * Words that redact a key only as its last word: `event` and `gatewayEvent` hold the parsed gateway
 * payload, while `eventType` or `eventId` says which event it was.
 */
export const redactedLastWords: readonly string[] = ['event'];

// A name ending or starting with one of these says when, how many or whether, not the value.
const FACT_LAST_WORDS = new Set(['at', 'count', 'attempts']);
const FACT_FIRST_WORDS = new Set(['has', 'is']);
// `code` directly after one of these classifies what happened: an error code, a status code.
const CLASSIFICATION_WORDS = new Set(['error', 'status', 'result', 'reason', 'http']);

function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/**
 * The forms a word answers to, as the lint rule's `wordSetOf` reads them: the word, its singular
 * (`tokens` is `token`), and the word without a trailing number (`token2` is `token`).
 */
function formsOf(word: string): string[] {
  const forms = [word];
  if (word.length > 1 && word.endsWith('s')) forms.push(word.slice(0, -1));
  const unnumbered = word.replace(/[0-9]+$/, '');
  if (unnumbered !== '' && unnumbered !== word) forms.push(unnumbered);
  return forms;
}

/** Whether a key's value is one R-SEC-2 keeps out of a log. */
export function isRedactedKey(name: string): boolean {
  const words = wordsOf(name);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return false;
  if (FACT_LAST_WORDS.has(last) || FACT_FIRST_WORDS.has(first)) return false;

  const present = new Set(words.flatMap(formsOf));
  // Every `code` (or `codes`) in the name is a classification code: judge the name without it.
  const classified = words.every(
    (word, index) =>
      !formsOf(word).includes('code') || CLASSIFICATION_WORDS.has(words[index - 1] ?? ''),
  );
  if (classified) present.delete('code');

  if (formsOf(last).some((form) => redactedLastWords.includes(form))) return true;
  return redactedKeys.some((entry) => entry.every((word) => present.has(word)));
}

/**
 * A copy of `value` with every redacted key's value replaced; the caller's object is untouched.
 *
 * An Error, under any key, is first written as pino writes one — type, message, stack and the
 * `cause` chain — and then redacted, so the root cause of a failure survives. A value with its own
 * `toJSON` (a `Date`, a `URL`, a library object) is read through it first, so what is redacted is
 * what would be written. Only a reference back up the current path is `[circular]`; the same object
 * reached twice side by side is written twice.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, new Set());
}

function redactValue(value: unknown, path: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) return '[circular]';

  let readable: unknown = value;
  if (value instanceof Error) {
    readable = pino.stdSerializers.errWithCause(value);
  } else if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    readable = (value as { toJSON: () => unknown }).toJSON();
    if (readable === null || typeof readable !== 'object') return readable;
  }

  path.add(value);
  try {
    if (Array.isArray(readable)) return readable.map((item) => redactValue(item, path));
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(readable as object)) {
      out[key] = isRedactedKey(key) ? REDACTED : redactValue(inner, path);
    }
    return out;
  } finally {
    path.delete(value);
  }
}

export interface LoggerOptions {
  readonly level: LogLevel;
  /** Where the lines go; standard output when absent. */
  readonly destination?: DestinationStream;
}

/**
 * The process's logger. Every module logs through this one, never through `console`.
 *
 * pino formats a child's bindings without the `bindings` formatter (it resets it for speed), so
 * `child` is wrapped on the root to redact them first; every descendant inherits the wrapper.
 */
export function createLogger(options: LoggerOptions): Logger {
  const logger = pino(
    {
      level: options.level,
      timestamp: pino.stdTimeFunctions.isoTime,
      // `redact` has already written every Error, so pino must not serialize `err` a second time
      // (it would read the plain object as an Error of type "Object" and drop the cause chain).
      serializers: { err: (err: unknown) => err },
      formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => redact(bindings) as Record<string, unknown>,
        log: (record) => redact(record) as Record<string, unknown>,
      },
    },
    options.destination,
  );
  const child = logger.child;
  logger.child = function redactedChild(this: Logger, bindings, childOptions) {
    return child.call(this, redact(bindings) as typeof bindings, childOptions);
  } as Logger['child'];
  return logger;
}

/** A child carrying the request's correlation identifier on every record it writes. */
export function requestLogger(base: Logger, correlationId: string): Logger {
  return base.child({ correlationId });
}
