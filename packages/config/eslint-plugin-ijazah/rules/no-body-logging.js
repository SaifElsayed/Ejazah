// sec/no-body-logging  ->  R-SEC-2  (fast)
//
// R-SEC-2: never log a request body, OTP, token, session ID, document URL, payout identifier,
// payment payload, card fragment or gateway credential. Logs are copied, shipped, searched and
// screenshotted; what is written to one has left the system (FR-010, FR-040).
//
// The constitution's mechanism is "logger calls with raw `req.body` banned", with review behind
// it; FR-010 widens the build-time refusal to "a raw request body or another prohibited value".
// This rule is that refusal. The logger's own redaction list (T100) is the second net, for a
// value nested where no rule can see it.
//
// A LOGGER CALL is a call to `log`, `info`, `warn`, `error`, `debug`, `trace`, `fatal`, `verbose`,
// `notice`, `http`, `silly`, `alert`, `crit`, `emerg` or `child` on something that reads as a
// logger: a name whose words include `log` or `logger` — `logger`, `log`, `this.logger`,
// `this.#logger`, `ctx.log`, `req.log`, `auditLogger`, `getLogger()`, `logger.child({ … })`. The
// level names are those of the console, pino, Nest, winston and syslog. EVERY method called on
// `console` is a logger call, whatever its name (`console.dir`, `console.table`,
// `console.assert`, `console[level]`): each one prints its arguments (review of PR #29, M2). The
// call itself may be optional (`logger?.info(…)`). `Math.log(x)` is not one: `Math` does not read
// as a logger.
//
// WHAT IS REFUSED among the arguments
//
//   the request   `req.body`, `req.rawBody`, `req.headers` and `req.cookies` handed over whole,
//                 where the object reads as a request: its last word is `req` or `request`
//                 (`req`, `request`, `ctx.req`, `this.request`, `incomingRequest`). The body is
//                 the constitution's own example; the header and cookie bags are how a token and
//                 an authentication session reach a log. A field picked out of one
//                 (`req.body.locale`, `req.headers['user-agent']`) is judged by its own name.
//   the request   an identifier, or the last name of a member access, that is exactly `input` or
//   input         `rawInput`, handed over whole: `logger.info(input)`, `logger.info({ input })`,
//                 `this.logger.log(input)`, `ctx.rawInput`, `opts.input`. In a tRPC procedure
//                 that name is the request body after parsing, and it is the same payload under
//                 the framework's word for it (review of PR #29, m1). A field picked out of it
//                 (`input.locale`) is judged by its own name. A call to a function or method
//                 named exactly `getRawInput`, awaited or not, is the same payload under the
//                 spelling tRPC v11 gives it and is refused the same way:
//                 `logger.info(await opts.getRawInput())`,
//                 `logger.info({ raw: await getRawInput() })` (second review of PR #29, nit 4).
//                 No other call is read. A bare `payload` is NOT refused:
//                 the word also names a job's data and a notification's deep-link ids, and it is
//                 refused only beside `payment`, `gateway` or `webhook`, below.
//   a prohibited  an identifier, a member or an object key whose name carries one of the values
//   value         R-SEC-2 lists (words compared whole, camelCase and snake_case alike):
//                   one-time code      otp, totp; mfa with code; code with verification, reset,
//                                      login, or with both one and time
//                   token              token
//                   session ID         authorization, cookie; or `session` with `auth`
//                   request body       body with request, req or raw
//                   payment payload    payload with payment, gateway or webhook
//                   document URL       url, uri or link with document, doc, signed, certificate,
//                                      attachment, download, upload or presigned
//                   payout identifier  payout with ref, reference, account or recipient;
//                                      recipient with ref or reference
//                   card fragment      cvv, cvc; or card with number, pan, last, last4, digits,
//                                      expiry, bin, fragment or holder
//                   credential         password, passwd, secret, credential; or key with api,
//                                      private, signing, secret, encryption, webhook or access
//
// Each is found through optional chaining (`req?.body`), the TypeScript wrappers, a conditional
// (`debug ? req.body : null`), `||`, `&&`, `??`, a spread, a nested object or array at any depth
// (`{ ctx: { payload: req.body } }`), a template literal, a `+` and `JSON.stringify(…)`, and a
// private member reads as its name: `this.#refreshToken` is `refreshToken` (M1).
//
// WHERE THE VOCABULARY COMES FROM (second review of PR #29, minor 3). Each word above is one the
// project's own documents use for a value R-SEC-2 lists; nothing is added on a guess.
//
//   recipient with ref      the payout identifier is "the gateway's recipient reference"
//   or reference            (FR-PAYG-13), the port's `RecipientRef` (ARCHITECTURE §3.4), stored as
//                           `teacher_profiles.payout_account_ref_encrypted` (R-DB-8).
//   totp; mfa with code     administrators sign in with mandatory multi-factor authentication
//                           (FR-ADMIN-1, NFR-SEC-6; ERD `admin_users.mfa_secret_encrypted`), and
//                           the code typed at sign-in is a one-time code. `mfa` with `secret` was
//                           already refused, as a credential, by `secret`.
//   code with verification, signup verification, sign-in and password reset each send a one-time
//   reset, login, one+time  code (FR-AUTH-1, FR-AUTH-6; ERD `otp_codes.purpose`: signup, login,
//                           password_reset, and `code_hash`, "never store the code plain").
//   url with certificate,   R-SEC-3: signed, expiring URLs for "documents, certificates, chat
//   attachment, download,   attachments, photos"; FR-IJAZAH-10: certificate PDFs "served from
//   upload or presigned     non-guessable, expiring signed URLs". A URL to fetch or to store such
//                           a file is the access to it for as long as it lives.
//
// A bare `code` stays legal: an error code, a country code and a status code are what a log line
// is for. The price of the pairs is stated plainly: a name carrying both words is refused whatever
// else it carries, so `loginErrorCode` reads as a login code. Rename it or log a fact about it.
//
// AMBIGUOUS NAMES THAT ARE NOT REFUSED, and that the logger's redaction list (T100) must carry,
// beside `card` (below):
//
//   event, gatewayEvent   the parsed payment payload is the port's `GatewayEvent`
//                         (ARCHITECTURE §3.4), and `event` is also every other event in the code;
//   code                  bare, it may be the one-time code itself (`{ code }` in the OTP flow);
//   storageKey,           see "storage_key" under the domain vocabulary, below.
//   storage_key
//
// This vocabulary and the redaction list of T100 name the same values and should come from one
// shared list, so that neither can drift from the other. That sharing is not built here.
//
// A NAME THAT SAYS WHEN, HOW MANY OR WHETHER is not the value (review of PR #29, m2). A name is
// not prohibited when its last word is `at`, `count` or `attempts`, or its first word is `has` or
// `is`: `tokenExpiresAt`, `passwordChangedAt`, `otp_expires_at`, `otpAttempts`, `tokenCount`,
// `hasToken`, `isTokenValid`, `resetCodeAttempts`, `hasTotp`, `verificationCodeExpiresAt`. These
// are the ERD's own shapes (`otp_codes.expires_at`, `attempt_count`). A name ending in `id` is
// NOT exempt: an authentication session's id is one of the values R-SEC-2 lists, so
// `authSessionId` stays refused.
//
// A KEY WHOSE VALUE CANNOT CARRY THE SECRET is not judged, and that value is not read further
// (m2). There are exactly four such values:
//
//   a fact             a boolean literal, a negation or a comparison: `hasToken: !!token`
//   a string literal   `{ token: 'present' }`, `{ password: '[redacted]' }`: text written in the
//                      source, not a value that arrived
//   Boolean(x)         `{ token: Boolean(token) }`
//   a redaction call   a call whose function name carries the word `redact`, `mask`, `hash`,
//                      `fingerprint` or `obfuscate`: `{ token: redact(token) }`,
//                      `{ cardNumber: maskCard(pan) }`, `{ token: hashToken(token) }`
//
// Every other call still has its key judged: `{ token: String(token) }`, `{ token: getToken() }`
// and `{ password: decrypt(stored) }` are refused, because the name says what the call returns.
//
// DOMAIN VOCABULARY THAT THIS RULE DOES NOT REFUSE (decided here, because the words collide):
//
//   sessionId, session_id   a TEACHING session's key (ERD `sessions.id`). "Session ID" in R-SEC-2
//                           is the authentication session, matched only as `session` with `token`
//                           or with `auth`.
//   payoutVerifiedAt,       ERD columns that say when, not which account. `payout` is refused
//   payout_configured_at    only beside ref, reference, account or recipient.
//   idempotencyKey          a `key` is refused only beside a word that makes it a secret.
//   storage_key,            NOT JUDGED by this rule, for the same reason, which is not the same
//   storageKey              as loggable. A verification document's storage reference is an
//                           encrypted column (ERD §3, `verification_documents.storage_key_encrypted`,
//                           R-DB-8: a national-ID reference is never stored unencrypted), while
//                           other storage keys are plain text (`teacher_signatures.storage_key`).
//                           The name alone does not say which one it is, so the logger's
//                           redaction list (T100) must cover it.
//   hasToken: !!token       a key whose value is a boolean literal, a negation or a comparison
//                           records a fact about the value, not the value (and see the two
//                           sections above).
//
// WHAT IS NOT SEEN, and is review's (the constitution keeps review behind this rule). A value
// renamed first (`const { body } = req; logger.info(body)`, `const data = input`); a value
// wrapped in a call other than `JSON.stringify` and handed over under no telling name —
// `logger.info(util.inspect(req.body))`, `logger.info(String(token))`: the arguments of a call
// are not read, because a redaction helper is the one legitimate wrapper and looks the same; the
// whole request object (`logger.info({ req })`), which the logger's serialiser and redaction list
// own; a logger reached under another name; a bare `log(…)` or `debug(…)` function; a field named
// by a bare `card` (`req.body.card`, `{ card: req.body.card }`), because `card` alone also names
// a profile card or a UI card and is refused only beside a word that makes it a payment card, so
// the logger's redaction list (T100) must carry `card`. This rule runs without types
// (research R-10).
const { defineRule } = require('../rule');
const { alternatives, keyName, propertyName, staticString, unwrap } = require('../syntax');
const { hasAny, wordSetOf, wordsOf } = require('../words');

const LOG_METHODS = new Set([
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'fatal',
  'verbose',
  'notice',
  'http',
  'silly',
  'alert',
  'crit',
  'emerg',
  'child',
]);
const CONSOLE = 'console';
const LOGGER_WORDS = ['log', 'logger'];
const REQUEST_WORDS = ['req', 'request'];
const REQUEST_BAGS = new Set(['body', 'rawBody', 'headers', 'cookies']);
// The parsed request body under the framework's own name for it (m1).
const REQUEST_INPUTS = new Set(['input', 'rawInput']);
// The call that hands back the same body in tRPC v11 (second review, nit 4).
const REQUEST_INPUT_READ = 'getRawInput';

// A name ending or starting with one of these says when, how many or whether (m2).
const FACT_LAST_WORDS = new Set(['at', 'count', 'attempts']);
const FACT_FIRST_WORDS = new Set(['has', 'is']);
// A call to a function named with one of these returns something that is not the secret (m2).
const REDACTION_WORDS = ['redact', 'mask', 'hash', 'fingerprint', 'obfuscate'];

// What makes a URL the access to a stored file: R-SEC-3 and FR-IJAZAH-10 (header).
const STORED_FILE_WORDS = [
  'document',
  'doc',
  'signed',
  'certificate',
  'attachment',
  'download',
  'upload',
  'presigned',
];

/** What a name says it holds, in R-SEC-2's own terms, or null. */
function prohibitedKind(name) {
  const ordered = wordsOf(name);
  if (FACT_LAST_WORDS.has(ordered.at(-1)) || FACT_FIRST_WORDS.has(ordered[0])) return null;

  const words = wordSetOf(name);

  if (hasAny(words, ['otp', 'totp'])) return 'a one-time code';
  if (words.has('code')) {
    if (hasAny(words, ['mfa', 'verification', 'reset', 'login'])) return 'a one-time code';
    if (words.has('one') && words.has('time')) return 'a one-time code';
  }
  if (words.has('token')) return 'a token';
  if (hasAny(words, ['authorization', 'cookie'])) return 'a session identifier';
  if (words.has('session') && words.has('auth')) return 'a session identifier';
  if (words.has('body') && hasAny(words, ['request', 'req', 'raw'])) return 'a request body';
  if (words.has('payload') && hasAny(words, ['payment', 'gateway', 'webhook'])) {
    return 'a payment payload';
  }
  if (hasAny(words, ['url', 'uri', 'link']) && hasAny(words, STORED_FILE_WORDS)) {
    return 'a document URL';
  }
  if (words.has('payout') && hasAny(words, ['ref', 'reference', 'account', 'recipient'])) {
    return 'a payout identifier';
  }
  if (words.has('recipient') && hasAny(words, ['ref', 'reference'])) return 'a payout identifier';
  if (hasAny(words, ['cvv', 'cvc'])) return 'a card fragment';
  if (
    words.has('card') &&
    hasAny(words, [
      'number',
      'pan',
      'last',
      'last4',
      'digits',
      'expiry',
      'bin',
      'fragment',
      'holder',
    ])
  ) {
    return 'a card fragment';
  }
  if (hasAny(words, ['password', 'passwd', 'secret', 'credential'])) return 'a credential';
  if (
    words.has('key') &&
    hasAny(words, ['api', 'private', 'signing', 'secret', 'encryption', 'webhook', 'access'])
  ) {
    return 'a credential';
  }
  return null;
}

function readsAs(name, words) {
  return typeof name === 'string' && hasAny(wordSetOf(name), words);
}

function isLoggerName(name) {
  return name === CONSOLE || readsAs(name, LOGGER_WORDS);
}

/** `console`, or the same object through what holds it (`globalThis.console`). */
function isConsole(node) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined) return false;
  if (inner.type === 'Identifier') return inner.name === CONSOLE;
  return inner.type === 'MemberExpression' && propertyName(inner) === CONSOLE;
}

function isLogger(node) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined) return false;
  if (inner.type === 'Identifier') return isLoggerName(inner.name);
  if (inner.type === 'MemberExpression') return isLoggerName(propertyName(inner));
  if (inner.type !== 'CallExpression') return false;

  const callee = unwrap(inner.callee);
  if (callee.type === 'Identifier') return isLoggerName(callee.name);
  if (callee.type !== 'MemberExpression') return false;
  return isLoggerName(propertyName(callee)) || isLogger(callee.object);
}

/** The bag a member access hands over whole (`body`, `headers`, …) when its object is a request. */
function requestBagOf(member) {
  const bag = propertyName(member);
  if (bag === null || !REQUEST_BAGS.has(bag)) return null;
  const holder = unwrap(member.object);
  if (holder.type === 'Identifier') return readsAs(holder.name, REQUEST_WORDS) ? bag : null;
  if (holder.type === 'MemberExpression') {
    return readsAs(propertyName(holder), REQUEST_WORDS) ? bag : null;
  }
  return null;
}

/** The name a call's function goes by: `redact` in `redact(x)`, `mask` in `pii.mask(x)`. */
function calleeName(call) {
  const callee = unwrap(call.callee);
  if (callee.type === 'Identifier') return callee.name;
  return callee.type === 'MemberExpression' ? propertyName(callee) : null;
}

/**
 * A value that cannot carry the secret its key names: a fact about it, a string written in the
 * source, `Boolean(x)`, or what a redaction helper returns. Nothing else, and no other call.
 */
function isFact(node) {
  const inner = unwrap(node);
  if (inner.type === 'Literal' && typeof inner.value === 'boolean') return true;
  if (staticString(inner) !== null) return true;
  if (inner.type === 'UnaryExpression') return inner.operator === '!';
  if (inner.type === 'CallExpression') {
    const name = calleeName(inner);
    if (name === null) return false;
    return name === 'Boolean' || hasAny(wordSetOf(name), REDACTION_WORDS);
  }
  if (inner.type !== 'BinaryExpression') return false;
  return ['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'].includes(
    inner.operator,
  );
}

function isJsonStringify(call) {
  const callee = unwrap(call.callee);
  if (callee.type !== 'MemberExpression' || propertyName(callee) !== 'stringify') return false;
  const holder = unwrap(callee.object);
  return holder.type === 'Identifier' && holder.name === 'JSON';
}

module.exports = defineRule({
  constitutionId: 'R-SEC-2',
  description:
    'Bans handing a logger the raw request body, headers or cookies, or a value whose name says it is a prohibited one',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    requestBag:
      '"{{text}}" hands the logger the raw request {{bag}} — log the fields you need by name, because a log line leaves the system and this carries whatever the client sent',
    requestInput:
      '"{{text}}" hands the logger the whole request input — log the fields you need by name, because a log line leaves the system and this carries whatever the client sent',
    prohibitedValue:
      '"{{name}}" reads as {{kind}} and is handed to a logger — leave it out or log a fact about it, because a log line leaves the system',
  },
  create(context) {
    const { sourceCode } = context;

    function checkName(node, name) {
      if (typeof name !== 'string') return;
      const kind = prohibitedKind(name);
      if (kind !== null)
        context.report({ node, messageId: 'prohibitedValue', data: { name, kind } });
    }

    function reportInput(node) {
      context.report({
        node,
        messageId: 'requestInput',
        data: { text: sourceCode.getText(node) },
      });
    }

    function inspect(argument) {
      const pending = [argument];
      while (pending.length > 0) {
        const next = pending.pop();
        if (next === null || next === undefined) continue;
        if (next.type === 'SpreadElement') {
          pending.push(next.argument);
          continue;
        }

        for (const leaf of alternatives(next)) {
          if (leaf.type === 'Identifier') {
            if (REQUEST_INPUTS.has(leaf.name)) reportInput(leaf);
            else checkName(leaf, leaf.name);
          } else if (leaf.type === 'MemberExpression') {
            const bag = requestBagOf(leaf);
            if (bag !== null) {
              context.report({
                node: leaf,
                messageId: 'requestBag',
                data: { text: sourceCode.getText(leaf), bag },
              });
            } else if (REQUEST_INPUTS.has(propertyName(leaf))) {
              reportInput(leaf);
            } else {
              checkName(leaf, propertyName(leaf));
            }
          } else if (leaf.type === 'ObjectExpression') {
            for (const property of leaf.properties) {
              if (property.type !== 'Property') {
                pending.push(property);
                continue;
              }
              if (!isFact(property.value)) {
                // A shorthand `{ token }` is one name, reported once, at the value.
                if (!property.shorthand) checkName(property.key, keyName(property));
                pending.push(property.value);
              }
            }
          } else if (leaf.type === 'ArrayExpression') {
            pending.push(...leaf.elements);
          } else if (leaf.type === 'TemplateLiteral') {
            pending.push(...leaf.expressions);
          } else if (leaf.type === 'AwaitExpression') {
            pending.push(leaf.argument);
          } else if (leaf.type === 'BinaryExpression' && leaf.operator === '+') {
            pending.push(leaf.left, leaf.right);
          } else if (leaf.type === 'CallExpression') {
            if (calleeName(leaf) === REQUEST_INPUT_READ) reportInput(leaf);
            else if (isJsonStringify(leaf)) pending.push(leaf.arguments[0]);
          }
        }
      }
    }

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') return;
        // Every method of the console prints its arguments; elsewhere the level names decide.
        if (!isConsole(callee.object)) {
          const method = propertyName(callee);
          if (method === null || !LOG_METHODS.has(method)) return;
          if (!isLogger(callee.object)) return;
        }
        for (const argument of node.arguments) inspect(argument);
      },
    };
  },
});
