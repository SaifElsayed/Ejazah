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
//
// THE `code` OF A SERIALIZED ERROR IS KEPT (T173, the logger item of the code review): the object
// pino writes for an Error (`type`, `message`, `stack`, the `cause` chain) carries the error's own
// `code`, a classification an operator reads first (`ECONNREFUSED`, `57014`), never a one-time
// code. It is copied through on that object and on each error of its cause chain only; a bare
// `code` anywhere else, an object the error carries under another key included, stays redacted.
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
      // T037: the gateway's hosted checkout, which may carry a payment token (data-model §2.4.1).
      'checkout',
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

/**
 * The fields of a mail that are redacted, inside an object whose key names a mail (T023, R-SEC-2):
 * a rendered mail's text, HTML and subject may carry a one-time code. The same names outside a
 * mail object stay: a log line's `text`, a rate limit's `subject`. A mail object is one under a
 * key whose words include `mail` or `email` (`mail`, `mails`, `emailDelivery`), an array of them
 * included.
 */
export const mailObjectWords: readonly string[] = ['mail', 'email'];
export const mailFieldWords: readonly string[] = ['text', 'html', 'subject'];

/** Whether a key names a mail object, so its `text`, `html` and `subject` are redacted. */
export function isMailKey(name: string): boolean {
  const present = new Set(wordsOf(name).flatMap(formsOf));
  return mailObjectWords.some((word) => present.has(word));
}

/** Whether a key, under a mail object, is one of the mail's redacted fields. */
function isMailField(name: string): boolean {
  const words = wordsOf(name);
  return words.length === 1 && mailFieldWords.includes(words[0] ?? '');
}

/**
 * Keys that hold a client's address (T017, R-SEC-2): written as the address's network, never the
 * address, so a request can be told from its neighbours and no record names a person's address.
 * A key is one when its words include every word of one entry.
 */
export const addressKeys: readonly (readonly string[])[] = [
  ['client', 'address'],
  ['remote', 'address'],
  ['peer', 'address'],
  ['ip'],
  // The proxy-header spellings (PR #79 review): `forwardedFor`, `x-forwarded-for`, `forwarded`.
  ['forwarded'],
  ['addr'],
];

/** Whether a key's value is an address, to be written as its network. */
export function isAddressKey(name: string): boolean {
  const words = wordsOf(name);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return false;
  // A name that says how many or whether (`ipCount`, `hasIp`) holds no address, as for a secret.
  if (FACT_LAST_WORDS.has(last) || FACT_FIRST_WORDS.has(first)) return false;
  const present = new Set(words.flatMap(formsOf));
  return addressKeys.some((entry) => entry.every((word) => present.has(word)));
}

/** The eight groups of an IPv6 address, each as written, or null when the text is not one. */
function ipv6Groups(address: string): string[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const right = halves.length === 2 && halves[1] !== '' ? (halves[1] ?? '').split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''));
}

/**
 * The network an address belongs to: the /24 of an IPv4 address (an IPv4-mapped IPv6 address
 * included), the /48 of an IPv6 address; anything else is redacted outright.
 */
export function networkOf(address: unknown): string {
  if (typeof address !== 'string') return REDACTED;
  const text = address.trim().replace(/^::ffff:/i, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(text);
  if (v4 !== null) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const groups = ipv6Groups(text);
  if (groups === null) return REDACTED;
  return `${groups[0]}:${groups[1]}:${groups[2]}::/48`;
}

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
  return redactValue(value, new Set(), false, false);
}

/** A key the serialized form of an Error keeps as written: its classification code. */
const ERROR_CLASSIFICATION_KEY = 'code';
/** The key under which pino's serializer writes the next error of the cause chain. */
const ERROR_CAUSE_KEY = 'cause';

function redactValue(
  value: unknown,
  path: Set<object>,
  serializedError: boolean,
  underMail: boolean,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) return '[circular]';

  let readable: unknown = value;
  let isError = serializedError;
  if (value instanceof Error) {
    readable = pino.stdSerializers.errWithCause(value);
    isError = true;
  } else if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    readable = (value as { toJSON: () => unknown }).toJSON();
    if (readable === null || typeof readable !== 'object') return readable;
  }

  path.add(value);
  try {
    if (Array.isArray(readable)) {
      return readable.map((item) => redactValue(item, path, false, underMail));
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(readable as object)) {
      if (isError && key === ERROR_CLASSIFICATION_KEY) {
        out[key] = redactValue(inner, path, false, false);
      } else if (isRedactedKey(key) || (underMail && isMailField(key))) {
        out[key] = REDACTED;
      } else if (isAddressKey(key)) {
        out[key] = networkOf(inner);
      } else {
        // The cause chain is a chain of serialized errors; any other object the error carries is not.
        out[key] = redactValue(inner, path, isError && key === ERROR_CAUSE_KEY, isMailKey(key));
      }
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
