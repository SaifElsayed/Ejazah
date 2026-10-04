// mobile/no-direct-network  ->  R-MOBILE-11  (fast)
//
// R-MOBILE-11: never call `fetch` or axios directly. All server communication goes through the
// tRPC client. The shared client in `lib/` is where the base URL, the session, the error mapping
// and the minimum-version gate live; a request made beside it has none of them, and is a request
// the server's contract never typed (FR-006).
//
// DECISION (T039) — where it applies. The cell says "`fetch` banned in `features/**`"; the rule
// sentence says all server communication goes through the client, and the client lives in `lib/`
// (ARCHITECTURE §6.1: "lib/ — trpc client, storage, guards"). Every file under `apps/mobile/src`
// is read except those under `lib/`, so a route file under `app/` cannot make the call a feature
// may not.
//
// WHAT IS REFUSED
//
//   the globals   any reference — not only a call — to the runtime's `fetch`, `XMLHttpRequest`,
//                 `WebSocket` and `EventSource`: `fetch(url)`, `fetch.call(…)`, `const f = fetch`,
//                 `new WebSocket(url)`, `typeof fetch`. The same global through the object that
//                 holds it is the same global: `globalThis.fetch`, `window.fetch`, `self.fetch`,
//                 `global.fetch`, dotted or computed with a string (`globalThis['fetch']`),
//                 through optional chaining and the TypeScript wrappers.
//   the package   `axios` and any subpath of it, the client the constitution names, in every
//                 syntax that names a module (`import`, `import type`, `export … from`,
//                 `import()`, `require`, `import x = require(…)`, `type T = import('…')`).
//
// A name is the global only when nothing in the file binds it: a parameter, a variable or an
// import called `fetch` is that binding, and calling it is legal. A type position
// (`let socket: WebSocket`) reaches nothing and is not refused.
//
// WHAT IS NOT REFUSED, and is review's. Another HTTP client package: the constitution names
// `fetch` and axios, and a list of every client that will ever exist is not a rule. A holder
// handed on first (`const g = globalThis; g.fetch(url)`): following a value needs the program this
// fast rule does not have (research R-10). Network access a native module performs itself.
//
// The file is matched by path segments, never by a root-anchored path (note under T035).
const { defineRule } = require('../rule');
const { heldGlobal, unboundReferences } = require('../globals');
const { mobileFile } = require('../mobile');
const { onEverySpecifier } = require('../specifiers');
const { mergeVisitors } = require('../syntax');

const NETWORK_GLOBALS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']);
const CLIENT_PACKAGES = [/^axios(\/|$)/];

module.exports = defineRule({
  constitutionId: 'R-MOBILE-11',
  description:
    'Bans fetch, XMLHttpRequest, WebSocket, EventSource and axios in apps/mobile/src outside lib/',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    directGlobal:
      '"{{name}}" reaches the network directly — go through the tRPC client in lib/, which carries the base URL, the session and the error mapping a bare request has none of',
    clientPackage:
      '"{{specifier}}" is a network client — go through the tRPC client in lib/, which carries the base URL, the session and the error mapping a second client has none of',
  },
  create(context) {
    const file = mobileFile(context.filename);
    if (file === null || file.area === 'lib') return {};

    const { sourceCode } = context;

    const globals = {
      Program() {
        for (const identifier of unboundReferences(sourceCode, NETWORK_GLOBALS)) {
          context.report({
            node: identifier,
            messageId: 'directGlobal',
            data: { name: identifier.name },
          });
        }
      },
      MemberExpression(node) {
        const name = heldGlobal(sourceCode, node, NETWORK_GLOBALS);
        if (name !== null) context.report({ node, messageId: 'directGlobal', data: { name } });
      },
    };

    const packages = onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const specifier = sourceNode.value;
      if (typeof specifier !== 'string') return;
      if (!CLIENT_PACKAGES.some((pattern) => pattern.test(specifier))) return;
      context.report({ node: sourceNode, messageId: 'clientPackage', data: { specifier } });
    });

    return mergeVisitors(globals, packages);
  },
});
