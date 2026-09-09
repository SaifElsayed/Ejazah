// boundaries/no-upward-admin-import  ->  R-API-4  (upward half, fast)
//
// R-API-4 carries two prohibitions under one identifier and two rules cite it
// (contracts/lint-rules.md, "Two notes on identifier traceability"). This is the upward half:
// dependencies point inward and nothing points at `admin`. A domain module that imports the
// administrative module inverts the dependency and makes the domain unusable without it (FR-004).
// The other half, a concrete adapter named outside its port folder, is `no-adapter-import.js`, and
// each message states which half broke so a build log naming R-API-4 is never ambiguous.
//
// DECISION (T035) — a rule of the internal plugin rather than `eslint-plugin-boundaries`
// configuration, so the reported rule id is the id the contract publishes; see the header of
// `no-cross-role-import.js`.
//
// The public entry is refused along with everything below it: `../admin` is as upward as
// `../admin/admin.service`. Reaching below the entry is separately a deep import (R-API-3), which
// is why this rule looks only at which module the import lands in. Admin's own files may of course
// import admin.
//
// Path segments, never a root-anchored path (note under T035). Only relative specifiers are
// resolved: a bare specifier is a package, never a path inside another module.
const path = require('node:path');

const { defineRule } = require('../rule');

const DEFAULTS = { moduleRoot: 'apps/api/src/modules', adminModule: 'admin' };

function settingsFor(context) {
  const configured = context.settings?.ijazah?.boundaries ?? {};
  return {
    moduleRoot: configured.moduleRoot ?? DEFAULTS.moduleRoot,
    adminModule: configured.adminModule ?? DEFAULTS.adminModule,
  };
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

function moduleOf(value, moduleRoot) {
  const segments = segmentsOf(value);
  const at = after(segments, segmentsOf(moduleRoot));
  return at === -1 || at >= segments.length ? null : segments[at];
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
  constitutionId: 'R-API-4',
  description: 'Bans a domain module from importing upward into the administrative module',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011). "upward import into
    // admin" says which of the two halves this identifier carries was broken.
    upwardIntoAdmin:
      '"{{specifier}}" is an upward import into admin from the {{module}} module — dependencies point inward and nothing points at the administrative module, so let admin call down instead',
  },
  create(context) {
    const { moduleRoot, adminModule } = settingsFor(context);
    const own = moduleOf(context.filename, moduleRoot);
    if (own === null || own === adminModule) return {};

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value);
      if (target === null) return;
      if (moduleOf(target, moduleRoot) !== adminModule) return;

      context.report({
        node: sourceNode,
        messageId: 'upwardIntoAdmin',
        data: { specifier: String(sourceNode.value), module: own },
      });
    });
  },
});
