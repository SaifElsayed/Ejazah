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
// Path segments, never a root-anchored path (note under T035). Only relative specifiers are
// resolved: a bare specifier is a package, never a path inside another module.
const path = require('node:path');

const { defineRule } = require('../rule');

const DEFAULTS = { moduleRoot: 'apps/api/src/modules' };

function settingsFor(context) {
  const configured = context.settings?.ijazah?.boundaries ?? {};
  return { moduleRoot: configured.moduleRoot ?? DEFAULTS.moduleRoot };
}

function segmentsOf(value) {
  return String(value)
    .split(/[\\/]+/)
    .filter((segment) => segment !== '' && segment !== '.');
}

/** Index just past `needle` where it appears as a run of segments, or -1. */
function after(segments, needle) {
  for (let start = 0; start + needle.length <= segments.length; start += 1) {
    if (needle.every((part, offset) => segments[start + offset] === part)) {
      return start + needle.length;
    }
  }
  return -1;
}

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

function resolveTarget(filename, specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return null;
  const from = String(filename).split('\\').join('/');
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
}

function isRequireCall(node) {
  return (
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length > 0 &&
    node.arguments[0].type === 'Literal'
  );
}

function onEverySpecifier(check) {
  return {
    ImportDeclaration: (node) => check(node.source),
    ExportNamedDeclaration: (node) => check(node.source),
    ExportAllDeclaration: (node) => check(node.source),
    ImportExpression: (node) => check(node.source.type === 'Literal' ? node.source : null),
    TSImportEqualsDeclaration: (node) =>
      check(
        node.moduleReference.type === 'TSExternalModuleReference' &&
          node.moduleReference.expression.type === 'Literal'
          ? node.moduleReference.expression
          : null,
      ),
    CallExpression: (node) => check(isRequireCall(node) ? node.arguments[0] : null),
  };
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
    const { moduleRoot } = settingsFor(context);
    const own = moduleAt(context.filename, moduleRoot);

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value);
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
