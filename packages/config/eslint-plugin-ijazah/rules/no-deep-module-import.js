// boundaries/no-deep-module-import  ->  R-API-3  (fast)
//
// R-API-3: a module is reached only through its public entry. Importing
// `../catalog/catalog.service` binds the caller to how catalog is built rather than to what it
// promises, and the export list stops being the module's contract (FR-004). If the entry does not
// export what the caller needs, the fix is to add the export to the owning module, with its own
// test, not to reach past it.
//
// DECISION (T035) — a rule of the internal plugin rather than `eslint-plugin-boundaries`
// configuration, so the reported rule id is the id the contract publishes; see the header of
// `no-cross-role-import.js`.
//
// What counts as the public entry: the module folder itself (`../catalog`) and its index file
// (`../catalog/index`, with or without an extension). Anything deeper is refused. An import
// *within* the same module is normal internal wiring and is not this rule's business.
//
// The importing file does not have to be a module file. `platform` or a surface reaching into
// `modules/catalog/catalog.service` breaks the same wall for the same reason, so the rule asks
// only where the import lands, and exempts the one case the prohibition does not cover.
//
// Path segments, never a root-anchored path (note under T035). A relative specifier is resolved
// against the importing file and a configured path alias is expanded first; anything else is a
// package, never a path inside another module. The resolver and the wall data live in
// `../specifiers.js` and `packages/config/eslint.boundaries.js`.
const path = require('node:path');

const { defineRule } = require('../rule');
const {
  after,
  onEverySpecifier,
  resolveTarget,
  segmentsOf,
  settingsFor,
} = require('../specifiers');

/** `{ name, rest }` for a path inside the module root, else null. `rest` is what follows the module folder. */
function moduleAt(value, moduleRoot) {
  const segments = segmentsOf(value);
  const at = after(segments, segmentsOf(moduleRoot));
  if (at === -1 || at >= segments.length) return null;
  return { name: segments[at], rest: segments.slice(at + 1) };
}

function isPublicEntry(rest) {
  if (rest.length === 0) return true;
  if (rest.length > 1) return false;
  const basename = rest[0];
  return basename.slice(0, basename.length - path.extname(basename).length) === 'index';
}

module.exports = defineRule({
  constitutionId: 'R-API-3',
  description: 'Bans importing a module below its public entry',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    belowEntry:
      '"{{specifier}}" reaches inside the {{module}} module — import a module only through its public entry, and if the export is missing add it there rather than reaching past it',
  },
  create(context) {
    const { moduleRoot, aliases } = settingsFor(context);
    const own = moduleAt(context.filename, moduleRoot);

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value, aliases);
      if (target === null) return;

      const imported = moduleAt(target, moduleRoot);
      if (imported === null) return;
      // Internal wiring inside one module is not a wall.
      if (own !== null && own.name === imported.name) return;
      if (isPublicEntry(imported.rest)) return;

      context.report({
        node: sourceNode,
        messageId: 'belowEntry',
        data: { specifier: String(sourceNode.value), module: imported.name },
      });
    });
  },
});
