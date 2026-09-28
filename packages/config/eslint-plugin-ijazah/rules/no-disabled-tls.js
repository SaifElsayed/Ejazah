// sec/no-disabled-tls  ->  R-SEC-11  (fast)
//
// R-SEC-11: never disable TLS verification, even locally, even "temporarily". A connection that
// skips certificate verification is a connection to whoever is in the middle, and the local
// "just for now" is the one that gets committed (FR-009). The constitution names
// `rejectUnauthorized: false` "and equivalents"; the note under T025–T026 leaves how far the
// equivalents reach to this task.
//
// DECISION (T040) — what is refused, everywhere in the repository (no folder is exempt: a test
// that switches verification off to talk to a stand-in is the local "temporarily" the rule names):
//
//   - `rejectUnauthorized` as a property or an assignment target with any value other than the
//     literal `true`. Not only `false`: `rejectUnauthorized: process.env.NODE_ENV === 'production'`
//     and `rejectUnauthorized: config.tls.verify` are the same switch with a longer wire, and "in
//     any environment" means there is no environment for the switch to select. Omitting the
//     property is the correct spelling (the default verifies); writing `true` is legal.
//   - `strictSSL`, the same option under the name the `request` family used, on the same terms.
//   - `NODE_TLS_REJECT_UNAUTHORIZED` anywhere in code — an assignment to it, a read of it, or the
//     string naming it. Setting it to `'0'` disables verification for the whole process; there is
//     no value of it a program should be writing, and a program has no reason to read it.
//   - a `checkServerIdentity` that cannot fail: an arrow or function with an empty body, a body
//     that only returns nothing, or an expression body of `undefined` or `null`. That is the
//     agent-accepts-any-certificate spelling. A `checkServerIdentity` that pins a certificate and
//     can throw or return an error is legal.
//   - `insecureHTTPParser: true`, which is a different kind of "insecure" but is in the same
//     options object for the same reason, and `secureProtocol`/`minVersion` are not read: a
//     protocol floor is a configuration decision, not a verification switch.
//
// A database connection string's `sslmode` is not read either: a URL is configuration, held by
// the kernel's config schema (T099), not by the linter. Adding a spelling here is additive.
//
// This rule reads every file in the repository. A property, a class field and an assignment are all
// switches; a destructuring pattern (`const { rejectUnauthorized } = options`) reads one and sets
// nothing, and is not refused. Keys are matched by their written name, quoted
// or bare, so `'rejectUnauthorized': false` and `["rejectUnauthorized"]` are refused with the bare
// spelling; a type declaration (`readonly rejectUnauthorized: boolean`) declares a shape and is
// not a value, so the fixture's interface is legal and its object literal is the violation.
const { defineRule } = require('../rule');

const VERIFICATION_SWITCHES = new Set(['rejectUnauthorized', 'strictSSL']);
// Held as a pattern rather than a string so this file does not name the switch in code and
// refuse itself; `.test` and `.source` are the only reads.
const PROCESS_SWITCH = /^NODE_TLS_REJECT_UNAUTHORIZED$/;

function nameOf(key, computed) {
  if (computed) return key.type === 'Literal' && typeof key.value === 'string' ? key.value : null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

function isLiteralTrue(node) {
  return node.type === 'Literal' && node.value === true;
}

function isNothing(node) {
  if (node === null || node === undefined) return true;
  if (node.type === 'Identifier' && node.name === 'undefined') return true;
  if (node.type === 'Literal' && node.value === null) return true;
  return node.type === 'UnaryExpression' && node.operator === 'void';
}

/** A function that accepts every certificate: it cannot throw and returns nothing. */
function cannotFail(fn) {
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return false;
  if (fn.body.type !== 'BlockStatement') return isNothing(fn.body);
  const statements = fn.body.body;
  if (statements.length === 0) return true;
  return statements.every(
    (statement) => statement.type === 'ReturnStatement' && isNothing(statement.argument),
  );
}

module.exports = defineRule({
  constitutionId: 'R-SEC-11',
  description: 'Bans every spelling of disabled transport security verification, in every file',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    verificationOff:
      '"{{name}}" is set to something other than true — transport security verification is never switched off or made conditional, in any environment; omit the option and let the default verify',
    processSwitch:
      '"NODE_TLS_REJECT_UNAUTHORIZED" disables verification for the whole process — it is never written, read or named in code, in any environment',
    acceptsAnyCertificate:
      '"checkServerIdentity" cannot fail, so every certificate is accepted — a pinning check that can throw is legal, a no-op is verification switched off',
    insecureParser:
      '"insecureHTTPParser" is enabled — the lenient parser accepts malformed responses and is never switched on',
  },
  create(context) {
    function checkSwitch(node, name, value) {
      if (VERIFICATION_SWITCHES.has(name)) {
        if (!isLiteralTrue(value)) {
          context.report({ node, messageId: 'verificationOff', data: { name } });
        }
        return;
      }
      if (name === 'checkServerIdentity' && cannotFail(value)) {
        context.report({ node, messageId: 'acceptsAnyCertificate' });
        return;
      }
      if (name === 'insecureHTTPParser' && isLiteralTrue(value)) {
        context.report({ node, messageId: 'insecureParser' });
      }
    }

    return {
      Property: (node) => {
        // `const { rejectUnauthorized } = options` reads the option; it sets nothing.
        if (node.parent.type === 'ObjectPattern') return;
        const name = nameOf(node.key, node.computed);
        if (name === null) return;
        checkSwitch(node, name, node.value);
      },
      PropertyDefinition: (node) => {
        if (node.value === null || node.value === undefined) return;
        const name = nameOf(node.key, node.computed);
        if (name === null) return;
        checkSwitch(node, name, node.value);
      },
      AssignmentExpression: (node) => {
        if (node.left.type !== 'MemberExpression') return;
        const name = nameOf(node.left.property, node.left.computed);
        if (name === null) return;
        checkSwitch(node, name, node.right);
      },
      Identifier: (node) => {
        if (PROCESS_SWITCH.test(node.name)) {
          context.report({ node, messageId: 'processSwitch' });
        }
      },
      Literal: (node) => {
        if (typeof node.value === 'string' && PROCESS_SWITCH.test(node.value)) {
          context.report({ node, messageId: 'processSwitch' });
        }
      },
      TemplateElement: (node) => {
        if ((node.value.cooked ?? node.value.raw).includes(PROCESS_SWITCH.source.slice(1, -1))) {
          context.report({ node, messageId: 'processSwitch' });
        }
      },
    };
  },
});
