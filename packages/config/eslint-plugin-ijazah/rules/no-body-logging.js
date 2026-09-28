// sec/no-body-logging  ->  R-SEC-2  (fast)
//
// R-SEC-2: never log a request body, OTP, token, session id, document URL, payout identifier,
// payment payload, card fragment or gateway credential. A log line lives longer than a session,
// is copied to more places than the database, and is read by more people than the row (FR-010).
// The constitution's lint mechanism is "logger calls with raw `req.body` banned", with review
// behind it, and the logger's own declared redaction list (T100) is the runtime net.
//
// WHAT IS A LOGGER CALL (T040): a call whose callee is a member named `log`, `info`, `warn`,
// `error`, `debug`, `trace`, `fatal`, `verbose` or `silly` on any receiver — `logger.info`,
// `console.error`, `this.log.debug`, `ctx.logger.warn` — or a bare `log(...)`. The fast set has no
// types (research R-10), so the method name is the whole signal; a `list.error(...)` on something
// that is not a logger is a name a reviewer would question anyway.
//
// WHAT IS RAW (T040): an argument that IS the request body — `req.body`, `request.body`,
// `ctx.req.body`, `opts.request.body`: a member named `body` on an object named `req` or
// `request`, wherever that object sits in a chain — either directly, or wrapped in an object
// literal (`{ body: req.body }`), a spread, an array, a template literal or a `JSON.stringify(...)`
// call, at any depth of those wrappers. The prohibition is about the body itself; a field picked
// out of it (`req.body.enrollmentId`) is a value the code has already decided is loggable, and
// that decision is review's to check, so it is not refused.
//
// The other prohibited values R-SEC-2 names are recognised by the name of what is passed, since a
// name is all the syntax carries: an identifier or member whose words include `otp`, `token`,
// `secret`, `password`, `credential`, `authorization`, `cookie`, `card`, `payout`,
// `sessionId`/`session_id`, or `documentUrl`/`document_url`. `session` alone is a teaching session
// here and is not in the list; `token` catches `sessionToken`, `refresh_token` and `pushToken`
// alike, and `tokenCount`, which is a heuristic's price. The word list is exported so the logger's
// redaction list (T100) can be checked against the same names.
//
// No folder is exempt. Every file in the repository is read.
const { defineRule } = require('../rule');
const { wordsOf } = require('../names');

const LOGGER_METHODS = new Set([
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'fatal',
  'verbose',
  'silly',
]);

const REQUEST_OBJECTS = new Set(['req', 'request']);

// Single words and two-word pairs (both words must appear) naming a value the constitution lists.
const SENSITIVE_WORDS = [
  'otp',
  'token',
  'secret',
  'password',
  'credential',
  'authorization',
  'cookie',
  'card',
  'payout',
];
const SENSITIVE_PAIRS = [
  ['session', 'id'],
  ['document', 'url'],
];

function propertyName(node) {
  if (node.computed) {
    return node.property.type === 'Literal' && typeof node.property.value === 'string'
      ? node.property.value
      : null;
  }
  return node.property.type === 'Identifier' ? node.property.name : null;
}

/** The last name of a chain: `req` in `ctx.req`, `request` in `opts.request`. */
function tailName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return propertyName(node);
  if (node.type === 'ThisExpression') return 'this';
  return null;
}

function isRequestBody(node) {
  if (node.type !== 'MemberExpression' || propertyName(node) !== 'body') return false;
  const owner = tailName(node.object);
  return owner !== null && REQUEST_OBJECTS.has(owner);
}

function sensitiveWordIn(name) {
  const words = wordsOf(name);
  const single = SENSITIVE_WORDS.find((word) => words.includes(word));
  if (single !== undefined) return single;
  const pair = SENSITIVE_PAIRS.find((parts) => parts.every((part) => words.includes(part)));
  return pair === undefined ? null : pair.join('_');
}

function isJsonStringify(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'JSON' &&
    propertyName(node.callee) === 'stringify'
  );
}

/** The values an argument carries into the log, looking through the wrappers a body hides in. */
function carriedValues(node) {
  if (node === null || node === undefined) return [];
  switch (node.type) {
    case 'ObjectExpression':
      return node.properties.flatMap((property) =>
        property.type === 'SpreadElement'
          ? carriedValues(property.argument)
          : carriedValues(property.value),
      );
    case 'ArrayExpression':
      return node.elements.flatMap((element) => carriedValues(element));
    case 'SpreadElement':
      return carriedValues(node.argument);
    case 'TemplateLiteral':
      return node.expressions.flatMap((expression) => carriedValues(expression));
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
    case 'AwaitExpression':
      return carriedValues(node.expression ?? node.argument);
    case 'CallExpression':
      return isJsonStringify(node) ? node.arguments.flatMap((arg) => carriedValues(arg)) : [node];
    default:
      return [node];
  }
}

function isLoggerCall(node) {
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name === 'log';
  if (callee.type !== 'MemberExpression') return false;
  const name = propertyName(callee);
  return name !== null && LOGGER_METHODS.has(name);
}

module.exports = defineRule({
  constitutionId: 'R-SEC-2',
  description:
    'Bans a logger call receiving the raw request body or a value named as a secret, token, code or credential',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    requestBody:
      'the raw request body is logged — a body carries codes, tokens and documents, so log the fields the handler has decided are loggable, never the body itself',
    sensitiveValue:
      '"{{name}}" is logged and its name says it is a {{word}} — a log line outlives the session and is read by more people than the row, so it never carries one',
  },
  create(context) {
    return {
      CallExpression: (node) => {
        if (!isLoggerCall(node)) return;
        for (const argument of node.arguments) {
          for (const value of carriedValues(argument)) {
            if (isRequestBody(value)) {
              context.report({ node: value, messageId: 'requestBody' });
              continue;
            }
            const name = tailName(value);
            if (name === null || name === 'this') continue;
            const word = sensitiveWordIn(name);
            if (word === null) continue;
            context.report({ node: value, messageId: 'sensitiveValue', data: { name, word } });
          }
        }
      },
    };
  },
});
