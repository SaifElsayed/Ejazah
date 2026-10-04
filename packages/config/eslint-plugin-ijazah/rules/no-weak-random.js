// db/no-weak-random  ->  R-DB-6  (fast)
//
// R-DB-6: never issue a sequential or guessable identifier for anything public — certificate
// numbers, verification tokens. Crypto-random. `Math.random` is a predictable generator: a third
// party who sees one certificate number can work out the next. The runtime guard is the
// generation utility in `platform/` (T105); this rule is the lint half, which keeps the weak
// generator out of the code altogether so nobody has to judge which identifiers are public
// (FR-045).
//
// The rule is not scoped to a tree: a guessable value is as wrong in a script or a seed as in a
// module, and a test that needs variation takes it from a seeded source it controls.
//
// WHAT IS REFUSED
//
//   Math.random        a reference, called or not: `Math.random()`, `Math['random']()`,
//                      `Math?.random()`, `const r = Math.random`, and the same through the object
//                      that holds the global — `globalThis.Math.random()`, `window.Math.random()`;
//                      and `random` destructured off `Math` (`const { random } = Math`,
//                      `const { random: r } = globalThis.Math`).
//   pseudoRandomBytes  the non-cryptographic export of Node's `crypto`, from `crypto` or
//                      `node:crypto`: named import (aliased too), namespace or default member
//                      (`crypto.pseudoRandomBytes`), destructured off the binding or off
//                      `require`.
//   nanoid/non-secure  the entry of `nanoid` that is documented as built on `Math.random`, in
//                      every syntax that names a module.
//
// `Math` is the global only when nothing in the file binds the name: a parameter or an import
// called `Math` is that binding.
//
// WHAT IS NOT SEEN, and is review's. `Math` handed to another variable first
// (`const M = Math; M.random()`); a weak generator inside a dependency; an identifier that is
// guessable without being random at all (a counter, a timestamp). This rule runs without types
// (research R-10), and "is this identifier public" is the runtime utility's job.
const { defineRule } = require('../rule');
const { globalNamed } = require('../globals');
const { onLibraryMembers } = require('../library');
const { onEverySpecifier } = require('../specifiers');
const { keyName, mergeVisitors, propertyName } = require('../syntax');

const MATH = new Set(['Math']);
const WEAK_METHOD = 'random';

const CRYPTO_SOURCES = new Set(['crypto', 'node:crypto']);
const WEAK_CRYPTO_EXPORT = 'pseudoRandomBytes';

const WEAK_PACKAGES = [/^nanoid\/non-secure(\/|$)/];

module.exports = defineRule({
  constitutionId: 'R-DB-6',
  description: 'Bans Math.random, crypto.pseudoRandomBytes and nanoid/non-secure',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    weakRandom:
      '"{{name}}" is not cryptographically random — use the generation utility in platform/, because a value drawn from a predictable generator can be guessed from its neighbours',
  },
  create(context) {
    const { sourceCode } = context;

    function report(node, name) {
      context.report({ node, messageId: 'weakRandom', data: { name } });
    }

    function checkPattern(pattern, source) {
      if (pattern.type !== 'ObjectPattern') return;
      if (globalNamed(sourceCode, source, MATH) === null) return;
      for (const property of pattern.properties) {
        if (property.type === 'Property' && keyName(property) === WEAK_METHOD) {
          report(property.key, 'Math.random');
        }
      }
    }

    const math = {
      MemberExpression(node) {
        if (propertyName(node) !== WEAK_METHOD) return;
        if (globalNamed(sourceCode, node.object, MATH) !== null) report(node, 'Math.random');
      },
      VariableDeclarator(node) {
        if (node.init !== null) checkPattern(node.id, node.init);
      },
      AssignmentExpression(node) {
        checkPattern(node.left, node.right);
      },
    };

    const crypto = onLibraryMembers({
      isSource: (specifier) => CRYPTO_SOURCES.has(specifier),
      isName: (name) => name === WEAK_CRYPTO_EXPORT,
      report(node, name, source) {
        report(node, `${name} from ${source}`);
      },
      reportAll() {},
    });

    const packages = onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const specifier = sourceNode.value;
      if (typeof specifier !== 'string') return;
      if (WEAK_PACKAGES.some((pattern) => pattern.test(specifier))) report(sourceNode, specifier);
    });

    return mergeVisitors(math, crypto, packages);
  },
});
