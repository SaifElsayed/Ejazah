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
// A relative specifier is resolved against the importing file, and a specifier written with the
// path alias the application configures (`apps/mobile/tsconfig.json` declares `"@/*": ["src/*"]`)
// is expanded first, so `@/features/teacher/roster` is refused exactly like `../teacher/roster`.
// Anything else is a package, never a path inside the role tree. Both spellings, the resolver and
// the wall data live in `../specifiers.js` and `packages/config/eslint.boundaries.js`.
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
  constitutionId: 'R-MOBILE-1',
  description: 'Bans the student and teacher feature trees from importing each other',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    crossRole:
      '"{{specifier}}" reaches from the {{from}} tree into the {{to}} tree — the two role trees never import each other, and whatever both roles need belongs in features/shared',
  },
  create(context) {
    const { roleTree, roles, aliases } = settingsFor(context);
    const from = roleOf(context.filename, roleTree);
    if (from === null || !roles.includes(from)) return {};

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value, aliases);
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
