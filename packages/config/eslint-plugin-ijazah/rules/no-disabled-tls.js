// sec/no-disabled-tls  ->  R-SEC-11  (fast)
//
// R-SEC-11: never disable TLS verification, even locally, even "temporarily". A connection that
// does not verify its peer is encrypted to whoever answered, and the switch that turned
// verification off for one afternoon is the switch that ships (FR-009).
//
// The constitution's cell names `rejectUnauthorized: false` "and equivalents". T026 left how far
// the equivalents reach to this task (note under T025–T026).
//
// DECISION (T040) — the equivalents are the other switches Node itself and its common HTTP clients
// read to skip verifying the peer. Every LITERAL SPELLING of each is refused:
//
//   rejectUnauthorized   anything but absent or the literal `true`. `false`, `0`, a variable, an
//   strictSSL            environment read and the shorthand `{ rejectUnauthorized }` are all
//                        refused: verification is not something configuration decides. Read as an
//                        object key (identifier or quoted, so `Object.assign(o, { … })` and
//                        `new Agent({ … })` are covered), a class field, private or not
//                        (`#rejectUnauthorized = false`), an assignment
//                        (`o.rejectUnauthorized = …`, `o['strictSSL'] = …`,
//                        `this.#rejectUnauthorized = …`) and through
//                        `Object.defineProperty` / `Reflect.set` with the name as a string.
//   the environment      `NODE_TLS_REJECT_UNAUTHORIZED`, Node's process-wide switch, named
//   switch               anywhere in code: as an identifier, a property, a quoted key or a string
//                        that is exactly the name. Reading it is refused with writing it; there
//                        is no reason to ask whether verification is off except to honour the
//                        answer.
//   checkServerIdentity  a function that cannot fail. Node treats a falsy return as "the
//                        certificate matches" and only a returned error or a throw as a refusal,
//                        so a function written in place is legal only when it can do one of the
//                        two (review of PR #29, m3):
//                          - an arrow with an expression body hands on what the expression
//                            evaluates to, so `(h, c) => tls.checkServerIdentity(h, c)` is legal
//                            and `() => undefined`, `() => null`, `() => void check()` and a
//                            falsy literal are not;
//                          - a block body is legal only when it holds a `throw`, or a `return`
//                            of something other than `undefined`, `null`, `void …`, a falsy
//                            literal or nothing. A block that only CALLS something
//                            (`{ tls.checkServerIdentity(h, c); }`, `{ logger.debug('skip'); }`)
//                            drops the answer and accepts every host: it is refused. The usual
//                            wrapper, `const e = tls.checkServerIdentity(h, c); if (e) return e;`,
//                            returns the answer and is legal.
//                        A value that is not a function written in place (a reference to a
//                        function defined elsewhere) is not judged.
//   insecureHTTPParser   anything but absent or the literal `false`. A lenient parser is not a
//                        certificate switch; it is refused here by decision. The contract row
//                        this rule implements reads "transport security verification", and a
//                        parser that accepts malformed framing is what request smuggling needs.
//                        The repository owner accepted it under R-SEC-11 on 2026-10-04 (review
//                        of PR #29, m5); naming it in the text of R-SEC-11 itself is proposed
//                        for a later change to the constitution.
//   a connection string  a string literal, or the text of a template literal, containing
//                        `sslaccept=accept_invalid_certs` (Prisma) or `sslmode=no-verify`
//                        (node-postgres), in any letter case, or the environment switch written
//                        as an assignment, `NODE_TLS_REJECT_UNAUTHORIZED=0`, anywhere inside a
//                        longer string such as a command line (review of PR #29, m4).
//                        `sslmode=disable` is NOT refused: it turns TLS off altogether, which is
//                        what a local database without certificates needs, and is a different
//                        decision from keeping TLS and not verifying the peer.
//
// The value is read through the TypeScript wrappers (`false as boolean`).
//
// THE OTHER HALF (m4). A connection URL normally arrives in an environment variable
// (`DATABASE_URL`, `REDIS_URL`), where no lint rule can read it: this rule sees only what is
// written in source. Refusing `sslaccept=accept_invalid_certs` and `sslmode=no-verify` in a value
// that arrives at run time belongs to the environment validation at boot, the schema of T015
// (`apps/api/src/platform/config/env.schema.ts`), which is the other half of this prohibition.
//
// The file under lint is every file: the rule is not scoped to a tree, because a transport is
// configured in a port adapter, a script and a test alike. The interface member
// `rejectUnauthorized: boolean` is a type, not a value, and is not refused.
//
// WHAT IS NOT SEEN, and is review's. An option reached through a variable or a spread
// (`const off = { rejectUnauthorized: false }` IS seen, at the literal; `{ ...optionsFromEnv }`
// is not). A name built at run time. A `checkServerIdentity` assigned from a variable. Flags
// passed to another program (`curl -k`, `NODE_OPTIONS`). A connection string assembled from
// parts, or read from the environment (above). This rule runs without types (research R-10) and
// none of those is a literal spelling.
const { defineRule } = require('../rule');
const {
  containsNode,
  isFunction,
  keyName,
  propertyName,
  staticString,
  unwrap,
} = require('../syntax');

// Options that must be absent or the literal `true`.
const VERIFY_OPTIONS = new Set(['rejectUnauthorized', 'strictSSL']);
// Option that must be absent or the literal `false`.
const INSECURE_PARSER = 'insecureHTTPParser';
const IDENTITY_CHECK = 'checkServerIdentity';

// Node's process-wide switch. Assembled rather than written out so that this file, which the
// rule also lints, does not name the thing it refuses.
const ENVIRONMENT_SWITCH = ['NODE', 'TLS', 'REJECT', 'UNAUTHORIZED'].join('_');
// The switch written as an assignment inside a longer string, such as a command line.
const ENVIRONMENT_SWITCH_OFF = `${ENVIRONMENT_SWITCH}=0`;

// Connection-string parameters that keep TLS and stop verifying the peer, lower-case. Assembled
// for the same reason as the switch above.
const UNVERIFIED_PARAMETERS = [
  ['sslaccept', 'accept_invalid_certs'].join('='),
  ['sslmode', 'no-verify'].join('='),
];

function isLiteral(node, value) {
  const inner = unwrap(node);
  return inner !== null && inner !== undefined && inner.type === 'Literal' && inner.value === value;
}

function isFalsyValue(node) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined) return true;
  if (inner.type === 'Identifier') return inner.name === 'undefined';
  if (inner.type === 'UnaryExpression') return inner.operator === 'void';
  if (inner.type !== 'Literal') return false;
  return inner.value === null || inner.value === false || inner.value === 0 || inner.value === '';
}

module.exports = defineRule({
  constitutionId: 'R-SEC-11',
  description:
    'Bans switching off TLS peer verification: rejectUnauthorized, strictSSL, the Node environment switch, a checkServerIdentity that cannot fail, insecureHTTPParser',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    verificationOff:
      '"{{name}}" must be absent or the literal true — transport security verification is never switched off or left to configuration, in any environment',
    environmentSwitch:
      '"{{name}}" is the process-wide switch that turns certificate verification off — it is never read or written, in any environment',
    identityUnchecked:
      '"checkServerIdentity" here cannot fail, so it accepts a certificate issued for any host — leave the default check in place or call it',
    insecureParser:
      '"insecureHTTPParser" must be absent or the literal false — a lenient parser accepts requests a strict peer would refuse',
    unverifiedConnection:
      '"{{parameter}}" in a connection string keeps TLS and stops verifying the peer — remove it, because a connection that does not verify its peer is encrypted to whoever answered',
  },
  create(context) {
    const { sourceCode } = context;

    /**
     * True for a function that has no way to refuse a certificate: it neither throws nor hands
     * back anything Node would read as an error. A call whose answer is dropped refuses nothing.
     */
    function cannotFail(fn) {
      if (fn.body.type !== 'BlockStatement') {
        const body = unwrap(fn.body);
        return isFalsyValue(body);
      }
      return !containsNode(sourceCode, fn.body, (node) => {
        if (node.type === 'ThrowStatement') return true;
        return node.type === 'ReturnStatement' && !isFalsyValue(node.argument);
      });
    }

    function checkOption(reportNode, name, valueNode) {
      if (typeof name !== 'string') return;

      if (VERIFY_OPTIONS.has(name)) {
        if (!isLiteral(valueNode, true)) {
          context.report({ node: reportNode, messageId: 'verificationOff', data: { name } });
        }
        return;
      }
      if (name === INSECURE_PARSER) {
        if (!isLiteral(valueNode, false)) {
          context.report({ node: reportNode, messageId: 'insecureParser' });
        }
        return;
      }
      if (name === IDENTITY_CHECK) {
        const fn = unwrap(valueNode);
        if (isFunction(fn) && cannotFail(fn)) {
          context.report({ node: reportNode, messageId: 'identityUnchecked' });
        }
      }
    }

    function checkEnvironmentName(node, name) {
      if (name !== ENVIRONMENT_SWITCH) return;
      context.report({ node, messageId: 'environmentSwitch', data: { name } });
    }

    /** What a string says beyond being a name: the switch assigned, or an unverified connection. */
    function checkText(node, text) {
      if (typeof text !== 'string') return;
      if (text.includes(ENVIRONMENT_SWITCH_OFF)) {
        context.report({
          node,
          messageId: 'environmentSwitch',
          data: { name: ENVIRONMENT_SWITCH },
        });
      }
      const lower = text.toLowerCase();
      for (const parameter of UNVERIFIED_PARAMETERS) {
        if (lower.includes(parameter)) {
          context.report({ node, messageId: 'unverifiedConnection', data: { parameter } });
        }
      }
    }

    return {
      Property(node) {
        if (node.parent.type !== 'ObjectExpression') return;
        checkOption(node, keyName(node), node.value);
      },
      PropertyDefinition(node) {
        if (node.value === null || node.value === undefined) return;
        checkOption(node, keyName(node), node.value);
      },
      AssignmentExpression(node) {
        const target = unwrap(node.left);
        if (target.type !== 'MemberExpression') return;
        checkOption(node, propertyName(target), node.right);
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression' || node.arguments.length < 2) return;
        const holder = unwrap(callee.object);
        if (holder.type !== 'Identifier') return;
        const method = propertyName(callee);
        const name = staticString(node.arguments[1]);
        if (name === null) return;

        if (holder.name === 'Reflect' && method === 'set') {
          checkOption(node, name, node.arguments[2]);
          return;
        }
        if (method !== 'defineProperty') return;
        if (holder.name !== 'Object' && holder.name !== 'Reflect') return;

        const descriptor = unwrap(node.arguments[2]);
        const value =
          descriptor !== undefined && descriptor !== null && descriptor.type === 'ObjectExpression'
            ? descriptor.properties.find(
                (property) => property.type === 'Property' && keyName(property) === 'value',
              )
            : undefined;
        // A descriptor this rule cannot read (a getter, a variable) is not the literal `true`.
        checkOption(node, name, value === undefined ? node : value.value);
      },
      Identifier(node) {
        checkEnvironmentName(node, node.name);
      },
      Literal(node) {
        if (typeof node.value !== 'string') return;
        checkEnvironmentName(node, node.value);
        checkText(node, node.value);
      },
      TemplateElement(node) {
        if (node.parent.expressions.length === 0) checkEnvironmentName(node, node.value.cooked);
        checkText(node, node.value.cooked);
      },
    };
  },
});
