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
// Path segments, never a root-anchored path (note under T035). A relative specifier is resolved
// against the importing file and the application's path alias is expanded first
// (`apps/mobile/tsconfig.json` declares `"@/*": ["src/*"]`), so `@/features/student/x` is refused
// exactly like `../student/x`; anything else is a package, never a path inside the role tree.
const { defineRule } = require('../rule');
const {
  after,
  onEverySpecifier,
  resolveTarget,
  segmentsOf,
  settingsFor,
} = require('../specifiers');

function roleOf(value, roleTree) {
  const segments = segmentsOf(value);
  const at = after(segments, segmentsOf(roleTree));
  return at === -1 || at >= segments.length ? null : segments[at];
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
    const { roleTree, roles, sharedRole, aliases } = settingsFor(context);
    if (roleOf(context.filename, roleTree) !== sharedRole) return {};

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value, aliases);
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
