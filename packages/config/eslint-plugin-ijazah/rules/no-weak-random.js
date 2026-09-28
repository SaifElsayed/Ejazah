// db/no-weak-random  ->  R-DB-6  (fast)
//
// R-DB-6: never issue a sequential or guessable identifier for anything public — certificate
// numbers, verification tokens. Crypto-random. `Math.random()` is seeded from the clock and its
// state can be recovered from a handful of outputs, so a certificate number drawn from it lets
// a third party verifying one certificate enumerate the rest (FR-010). The constitution holds
// this rule twice: a runtime utility in `platform/crypto` generates identifiers properly, and this
// lint bans the weak source so nothing else does.
//
// WHAT IS REFUSED (T040), everywhere in the repository:
//
//   - `Math.random`, referenced in any way — called, passed as a value, read through
//     `Math['random']`. The constitution names it; a reference that is not a call is a call
//     deferred.
//   - `crypto.pseudoRandomBytes`, Node's own deprecated non-cryptographic source, by name on any
//     receiver and as a named import.
//   - an import, in every spelling `../specifiers.js` knows, of `nanoid/non-secure`, `seedrandom`,
//     `random-seed`, `chance` or `pure-rand`: libraries whose whole purpose is a predictable
//     sequence. The deterministic seed (T074) needs deterministic data, not a random source; a
//     library that is deterministic by construction is a generator, not randomness, and belongs
//     to that task's decision, recorded there if it needs one.
//
// No folder is exempt. A UI shuffle or a jitter in a retry backoff wants randomness too, and
// `crypto.randomInt` and `crypto.getRandomValues` serve them at no cost; a rule with a
// "harmless" exemption is a rule with an argument attached to every use.
//
// A `Math.random` under an `eslint-disable` directive carrying a reason and a ticket is how an
// exception is recorded, and R-PROC-7 (`proc/require-suppression-reason`) is what holds that
// directive to the reason.
const { defineRule } = require('../rule');
const { onEverySpecifier } = require('../specifiers');

const WEAK_LIBRARIES = [
  /^nanoid\/non-secure(\/|$)/,
  /^seedrandom(\/|$)/,
  /^random-seed(\/|$)/,
  /^chance(\/|$)/,
  /^pure-rand(\/|$)/,
];

function propertyName(node) {
  if (node.computed) {
    return node.property.type === 'Literal' && typeof node.property.value === 'string'
      ? node.property.value
      : null;
  }
  return node.property.type === 'Identifier' ? node.property.name : null;
}

module.exports = defineRule({
  constitutionId: 'R-DB-6',
  description: 'Bans non-cryptographic randomness everywhere',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    weakSource:
      '"{{name}}" is not cryptographic randomness — its sequence can be recovered from its outputs, so anything public drawn from it is guessable; use the identifier utility in platform/crypto, or crypto.randomInt and crypto.getRandomValues',
    weakLibrary:
      '"{{specifier}}" is a predictable random source — anything public drawn from it is guessable; use the identifier utility in platform/crypto, or crypto.randomInt and crypto.getRandomValues',
  },
  create(context) {
    function checkSpecifier(sourceNode) {
      if (sourceNode === null || sourceNode === undefined) return;
      if (typeof sourceNode.value !== 'string') return;
      if (!WEAK_LIBRARIES.some((library) => library.test(sourceNode.value))) return;
      context.report({
        node: sourceNode,
        messageId: 'weakLibrary',
        data: { specifier: sourceNode.value },
      });
    }

    return {
      ...onEverySpecifier(checkSpecifier),
      ImportDeclaration: (node) => {
        checkSpecifier(node.source);
        // `import { pseudoRandomBytes } from 'node:crypto'` — the name with no receiver.
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : String(specifier.imported.value);
          if (imported !== 'pseudoRandomBytes') continue;
          context.report({
            node: specifier,
            messageId: 'weakSource',
            data: { name: 'pseudoRandomBytes' },
          });
        }
      },
      MemberExpression: (node) => {
        const name = propertyName(node);
        if (name === null) return;
        if (name === 'random' && node.object.type === 'Identifier' && node.object.name === 'Math') {
          context.report({ node, messageId: 'weakSource', data: { name: 'Math.random' } });
          return;
        }
        if (name === 'pseudoRandomBytes') {
          context.report({ node, messageId: 'weakSource', data: { name: 'pseudoRandomBytes' } });
        }
      },
    };
  },
});
