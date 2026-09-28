// mobile/no-direct-network  ->  R-MOBILE-11  (fast)
//
// R-MOBILE-11: never call `fetch` or axios directly. All server communication goes through the
// tRPC client. The client in `lib/client.ts` is where the base URL, the session header, the error
// mapping and the retry policy live; a bare `fetch` in a feature has none of them and a second
// copy of whichever it reinvents (FR-006).
//
// WHERE (T039): every file under `apps/mobile/src` that is not under `apps/mobile/src/lib`. The
// constitution's scope is `features/**`; the route tree under `app/` and `design/` are held to the
// same line because a layout file that fetches is the same bypass. `lib/` is where the client is
// built, and building a client means calling the network primitives, so it is the one exempt tree.
//
// WHAT IS REFUSED (T039):
//
//   - a call to the global `fetch` — `fetch(url)`, `globalThis.fetch(url)`, `window.fetch(url)`,
//     `self.fetch(url)` — when `fetch` is not a binding the file declares itself (a parameter or
//     local named `fetch` is somebody's injected client, not the global);
//   - `new XMLHttpRequest()`, `new WebSocket()` and `new EventSource()`: the older and the
//     streaming spellings of the same direct call;
//   - an import, in every spelling `../specifiers.js` knows, of a network library — `axios`, `ky`,
//     `got`, `superagent`, `node-fetch`, `cross-fetch`, `isomorphic-fetch`, `whatwg-fetch`,
//     `undici`, `graphql-request`, `@apollo/client`, `urql` — or of `@trpc/client` and
//     `@trpc/react-query`, which is how a feature would build a client of its own instead of
//     importing the one in `lib/`.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');
const { isRequireCall, onEverySpecifier } = require('../specifiers');

const MOBILE_TREE = 'apps/mobile/src';
const LIB_TREE = 'apps/mobile/src/lib';

const NETWORK_LIBRARIES = [
  /^axios(\/|$)/,
  /^ky(\/|$)/,
  /^got(\/|$)/,
  /^superagent(\/|$)/,
  /^node-fetch(\/|$)/,
  /^cross-fetch(\/|$)/,
  /^isomorphic-fetch(\/|$)/,
  /^whatwg-fetch(\/|$)/,
  /^undici(\/|$)/,
  /^graphql-request(\/|$)/,
  /^@apollo\/client(\/|$)/,
  /^urql(\/|$)/,
  /^@urql\//,
  /^@trpc\/client(\/|$)/,
  /^@trpc\/react-query(\/|$)/,
];

const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self']);
const DIRECT_CONSTRUCTORS = new Set(['XMLHttpRequest', 'WebSocket', 'EventSource']);

function isNetworkLibrary(specifier) {
  return (
    typeof specifier === 'string' && NETWORK_LIBRARIES.some((library) => library.test(specifier))
  );
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-11',
  description:
    'Bans direct network calls and network library imports in apps/mobile outside lib/, where the tRPC client lives',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    directCall:
      '"{{name}}" reaches the network directly — every server call goes through the tRPC client in lib/, which carries the base URL, the session and the error mapping',
    library:
      '"{{specifier}}" is a network library — every server call goes through the tRPC client in lib/, which carries the base URL, the session and the error mapping',
  },
  create(context) {
    if (!isUnder(context.filename, MOBILE_TREE)) return {};
    if (isUnder(context.filename, LIB_TREE)) return {};

    /** True when the identifier resolves to no binding in this file, i.e. it is the global. */
    function isGlobal(identifier) {
      const scope = context.sourceCode.getScope(identifier);
      const reference = scope.references.find((candidate) => candidate.identifier === identifier);
      if (reference === undefined) return true;
      return reference.resolved === null || reference.resolved.defs.length === 0;
    }

    function checkSpecifier(sourceNode) {
      if (sourceNode === null || sourceNode === undefined) return;
      if (!isNetworkLibrary(sourceNode.value)) return;
      context.report({
        node: sourceNode,
        messageId: 'library',
        data: { specifier: String(sourceNode.value) },
      });
    }

    return {
      ...onEverySpecifier(checkSpecifier),
      CallExpression: (node) => {
        // The spread above also reads `CallExpression` for `require('axios')`; this handler
        // replaces it, so the require check is repeated here rather than lost.
        if (isRequireCall(node)) {
          checkSpecifier(node.arguments[0]);
          return;
        }
        const callee = node.callee;
        if (callee.type === 'Identifier' && callee.name === 'fetch' && isGlobal(callee)) {
          context.report({ node: callee, messageId: 'directCall', data: { name: 'fetch' } });
          return;
        }
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          GLOBAL_OBJECTS.has(callee.object.name) &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'fetch'
        ) {
          context.report({
            node: callee,
            messageId: 'directCall',
            data: { name: `${callee.object.name}.fetch` },
          });
        }
      },
      NewExpression: (node) => {
        const callee = node.callee;
        if (
          callee.type === 'Identifier' &&
          DIRECT_CONSTRUCTORS.has(callee.name) &&
          isGlobal(callee)
        ) {
          context.report({ node: callee, messageId: 'directCall', data: { name: callee.name } });
        }
      },
    };
  },
});
