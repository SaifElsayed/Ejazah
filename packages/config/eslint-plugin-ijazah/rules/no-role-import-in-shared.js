// boundaries/no-role-import-in-shared  ->  R-MOBILE-2  (fast)
//
// R-MOBILE-2: `features/shared/` is what both roles may depend on, so it depends on neither. A
// shared file that reaches into `student/` or `teacher/` turns the shared tree into a third role
// and quietly couples the two it exists to keep apart (FR-004). The prohibition is symmetric, so
// T020 declares a fixture per role tree and this rule refuses both.
//
// DECISION (T035) — a rule of the internal plugin rather than `eslint-plugin-boundaries`
// configuration, so the reported rule id is the id the contract publishes; see the header of
// `no-cross-role-import.js` for the reasoning and `packages/config/eslint.boundaries.js` for the
// wall data this rule reads through `settings`.
//
// Path segments, never a root-anchored path (note under T035). Only relative specifiers are
// resolved: a bare specifier is a package, never a path inside the role tree.
const path = require('node:path');

const { defineRule } = require('../rule');

const DEFAULTS = {
  roleTree: 'apps/mobile/src/features',
  roles: ['student', 'teacher'],
  sharedRole: 'shared',
};

function settingsFor(context) {
  const configured = context.settings?.ijazah?.boundaries ?? {};
  return {
    roleTree: configured.roleTree ?? DEFAULTS.roleTree,
    roles: configured.roles ?? DEFAULTS.roles,
    sharedRole: configured.sharedRole ?? DEFAULTS.sharedRole,
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
  constitutionId: 'R-MOBILE-2',
  description: 'Bans the shared feature tree from importing either role tree',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    roleInShared:
      '"{{specifier}}" reaches from features/shared into the {{to}} tree — shared code is what both roles may depend on, so it depends on neither; move what is needed down into shared',
  },
  create(context) {
    const { roleTree, roles, sharedRole } = settingsFor(context);
    if (roleOf(context.filename, roleTree) !== sharedRole) return {};

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value);
      if (target === null) return;

      const to = roleOf(target, roleTree);
      if (to === null || !roles.includes(to)) return;

      context.report({
        node: sourceNode,
        messageId: 'roleInShared',
        data: { specifier: String(sourceNode.value), to },
      });
    });
  },
});
