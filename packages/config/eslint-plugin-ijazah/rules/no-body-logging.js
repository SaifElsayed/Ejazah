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
// A LOGGER CALL is a call to `log`, `info`, `warn`, `error`, `debug`, `trace`, `fatal`, `verbose`
// or `child` on something that reads as a logger: `console`, or a name whose words include `log`
// or `logger` — `logger`, `log`, `this.logger`, `ctx.log`, `req.log`, `auditLogger`,
// `getLogger()`, `logger.child({ … })`. The call itself may be optional (`logger?.info(…)`).
// `Math.log(x)` is not one: `Math` does not read as a logger.
//
// WHAT IS REFUSED among the arguments
//
//   the request   `req.body`, `req.rawBody`, `req.headers` and `req.cookies` handed over whole,
//                 where the object reads as a request: its last word is `req` or `request`
//                 (`req`, `request`, `ctx.req`, `this.request`, `incomingRequest`). The body is
//                 the constitution's own example; the header and cookie bags are how a token and
//                 an authentication session reach a log. A field picked out of one
//                 (`req.body.locale`, `req.headers['user-agent']`) is judged by its own name.
//   a prohibited  an identifier, a member or an object key whose name carries one of the values
//   value         R-SEC-2 lists (words compared whole, camelCase and snake_case alike):
//                   one-time code      otp
//                   token              token
//                   session ID         authorization, cookie; or `session` with `auth`
//                   request body       body with request, req or raw
//                   payment payload    payload with payment, gateway or webhook
//                   document URL       url, uri or link with document, doc or signed
//                   payout identifier  payout with ref, reference, account or recipient
//                   card fragment      cvv, cvc; or card with number, pan, last, last4, digits,
//                                      expiry, bin, fragment or holder
//                   credential         password, passwd, secret, credential; or key with api,
//                                      private, signing, secret, encryption, webhook or access
//
// Each is found through optional chaining (`req?.body`), the TypeScript wrappers, a conditional
// (`debug ? req.body : null`), `||`, `&&`, `??`, a spread, a nested object or array at any depth
// (`{ ctx: { payload: req.body } }`), a template literal, a `+` and `JSON.stringify(…)`.
//
// DOMAIN VOCABULARY THAT STAYS LOGGABLE (decided here, because the words collide):
//
//   sessionId, session_id   a TEACHING session's key (ERD `sessions.id`). "Session ID" in R-SEC-2
//                           is the authentication session, matched only as `session` with `token`
//                           or with `auth`.
//   payoutVerifiedAt,       ERD columns that say when, not which account. `payout` is refused
//   payout_configured_at    only beside ref, reference, account or recipient.
//   idempotencyKey,         a `key` is refused only beside a word that makes it a secret.
//   storage_key
//   hasToken: !!token       a key whose value is a boolean literal, a negation or a comparison
//                           records a fact about the value, not the value.
//
// WHAT IS NOT SEEN, and is review's (the constitution keeps review behind this rule). A value
// renamed first (`const { body } = req; logger.info(body)`); a value wrapped in a call other than
// `JSON.stringify` — `util.inspect(req.body)`, `String(token)`, a redaction helper, which is the
// one legitimate wrapper and looks the same; the whole request object (`logger.info({ req })`),
// which the logger's serialiser and redaction list own; a logger reached under another name; a
// bare `log(…)` or `debug(…)` function; a field named by a bare `card` (`req.body.card`), because
// `card` alone also names a profile card or a UI card and is refused only beside a word that makes
// it a payment card. This rule runs without types (research R-10).
const { defineRule } = require('../rule');
const { alternatives, keyName, propertyName, unwrap } = require('../syntax');
const { hasAny, wordSetOf } = require('../words');

const LOG_METHODS = new Set([
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'fatal',
  'verbose',
  'child',
]);
const LOGGER_WORDS = ['log', 'logger'];
const REQUEST_WORDS = ['req', 'request'];
const REQUEST_BAGS = new Set(['body', 'rawBody', 'headers', 'cookies']);

/** What a name says it holds, in R-SEC-2's own terms, or null. */
function prohibitedKind(name) {
  const words = wordSetOf(name);

  if (words.has('otp')) return 'a one-time code';
  if (words.has('token')) return 'a token';
  if (hasAny(words, ['authorization', 'cookie'])) return 'a session identifier';
  if (words.has('session') && words.has('auth')) return 'a session identifier';
  if (words.has('body') && hasAny(words, ['request', 'req', 'raw'])) return 'a request body';
  if (words.has('payload') && hasAny(words, ['payment', 'gateway', 'webhook'])) {
    return 'a payment payload';
  }
  if (hasAny(words, ['url', 'uri', 'link']) && hasAny(words, ['document', 'doc', 'signed'])) {
    return 'a document URL';
  }
  if (words.has('payout') && hasAny(words, ['ref', 'reference', 'account', 'recipient'])) {
    return 'a payout identifier';
  }
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
  return name === 'console' || readsAs(name, LOGGER_WORDS);
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

/** A value that states a fact about something rather than carrying it. */
function isFact(node) {
  const inner = unwrap(node);
  if (inner.type === 'Literal') return typeof inner.value === 'boolean';
  if (inner.type === 'UnaryExpression') return inner.operator === '!';
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
            checkName(leaf, leaf.name);
          } else if (leaf.type === 'MemberExpression') {
            const bag = requestBagOf(leaf);
            if (bag !== null) {
              context.report({
                node: leaf,
                messageId: 'requestBag',
                data: { text: sourceCode.getText(leaf), bag },
              });
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
          } else if (leaf.type === 'CallExpression' && isJsonStringify(leaf)) {
            pending.push(leaf.arguments[0]);
          }
        }
      }
    }

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') return;
        const method = propertyName(callee);
        if (method === null || !LOG_METHODS.has(method)) return;
        if (!isLogger(callee.object)) return;
        for (const argument of node.arguments) inspect(argument);
      },
    };
  },
});
