// boundaries/no-adapter-import  ->  R-API-4  (adapter half, fast)
//
// R-API-4 carries two prohibitions under one identifier and two rules cite it
// (contracts/lint-rules.md, "Two notes on identifier traceability"). This is the adapter half: a
// concrete provider implementation stays inside its port folder, and everything else depends on
// the port. The domain never knows a vendor's name — which adapter serves a port is configuration
// (FR-004). The other half, the upward import into `admin`, is `no-upward-admin-import.js`, and
// each message states which half broke so a build log naming R-API-4 is never ambiguous.
//
// DECISION (T035) — a rule of the internal plugin rather than `eslint-plugin-boundaries`
// configuration, so the reported rule id is the id the contract publishes; see the header of
// `no-cross-role-import.js`.
//
// An adapter is a file whose basename ends `.adapter`, with or without a source extension
// (`fake.adapter`, `fake.adapter.ts`), sitting under `platform/ports/<port>/`. The port entry
// (`payment.port`) and the folder index are not adapters and stay importable from anywhere, which
// is the whole point: the port is the name the rest of the application is allowed to speak.
//
// A file inside the same port folder may name its own adapter — that folder is where the vendor
// lives, and its index is what wires the selected one.
//
// Path segments, never a root-anchored path (note under T035). A relative specifier is resolved
// against the importing file and a configured path alias is expanded first; anything else is a
// package, never a path inside the port tree. The resolver and the wall data live in
// `../specifiers.js` and `packages/config/eslint.boundaries.js`.
const { defineRule } = require('../rule');
const {
  after,
  onEverySpecifier,
  resolveTarget,
  segmentsOf,
  settingsFor,
} = require('../specifiers');

// `fake.adapter`, `fake.adapter.ts`, `paymob.adapter.mts`. Not `payment.port`, not `index`.
const ADAPTER_BASENAME = /\.adapter(\.[^.]+)?$/;

/** `{ port, rest }` for a path inside the port root, else null. */
function portAt(value, portRoot) {
  const segments = segmentsOf(value);
  const at = after(segments, segmentsOf(portRoot));
  if (at === -1 || at >= segments.length) return null;
  return { port: segments[at], rest: segments.slice(at + 1) };
}

module.exports = defineRule({
  constitutionId: 'R-API-4',
  description: 'Bans importing a concrete adapter outside its own port folder',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011). "adapter" says which of
    // the two halves this identifier carries was broken.
    outsidePortFolder:
      '"{{specifier}}" names a concrete adapter of the {{port}} port — depend on the port instead, because which adapter serves it is configuration and only its own folder may know a vendor name',
  },
  create(context) {
    const { portRoot, aliases } = settingsFor(context);
    const own = portAt(context.filename, portRoot);

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value, aliases);
      if (target === null) return;

      const imported = portAt(target, portRoot);
      if (imported === null || imported.rest.length === 0) return;
      if (!ADAPTER_BASENAME.test(imported.rest.at(-1))) return;
      // Inside the port's own folder the vendor is at home.
      if (own !== null && own.port === imported.port) return;

      context.report({
        node: sourceNode,
        messageId: 'outsidePortFolder',
        data: { specifier: String(sourceNode.value), port: imported.port },
      });
    });
  },
});
