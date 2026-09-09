// boundaries/no-cross-role-import  ->  R-MOBILE-1  (fast)
//
// R-MOBILE-1: the student tree and the teacher tree never import each other. Anything both roles
// need moves to `features/shared/`. The wall is symmetric, so this rule refuses both directions;
// T020 declares a fixture per direction precisely so a half-built wall stays red (FR-004).
//
// DECISION (T035) — this is a rule of the internal plugin, not `eslint-plugin-boundaries`
// configuration. The contract publishes the id `boundaries/no-cross-role-import`, the harness
// credits a case only when the reported rule id equals the published id, and the library reports
// under its own ids (`boundaries/element-types`). A rule of ours is the only way the published id
// can appear in a build log, which is what FR-011 is for. The wall's data still lives in one
// place, `packages/config/eslint.boundaries.js`, and reaches this rule as flat-config `settings`.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
//
// Only a relative specifier is resolved. A bare specifier is a package, never a path inside the
// role tree; a tsconfig path alias (`@/features/teacher/...`) would need the resolver this fast
// rule does not have, and none is configured in `apps/mobile` today.
const path = require('node:path');

const { defineRule } = require('../rule');

const DEFAULTS = {
  roleTree: 'apps/mobile/src/features',
  roles: ['student', 'teacher'],
};

function settingsFor(context) {
  const configured = context.settings?.ijazah?.boundaries ?? {};
  return {
    roleTree: configured.roleTree ?? DEFAULTS.roleTree,
    roles: configured.roles ?? DEFAULTS.roles,
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

function roleOf(value, roleTree) {
  const segments = segmentsOf(value);
  const at = after(segments, segmentsOf(roleTree));
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

/** Every syntax that names a module, so a rule cannot be walked around by writing the import differently. */
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
  constitutionId: 'R-MOBILE-1',
  description: 'Bans the student and teacher feature trees from importing each other',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    crossRole:
      '"{{specifier}}" reaches from the {{from}} tree into the {{to}} tree — the two role trees never import each other, and whatever both roles need belongs in features/shared',
  },
  create(context) {
    const { roleTree, roles } = settingsFor(context);
    const from = roleOf(context.filename, roleTree);
    if (from === null || !roles.includes(from)) return {};

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value);
      if (target === null) return;

      const to = roleOf(target, roleTree);
      if (to === null || to === from || !roles.includes(to)) return;

      context.report({
        node: sourceNode,
        messageId: 'crossRole',
        data: { specifier: String(sourceNode.value), from, to },
      });
    });
  },
});
