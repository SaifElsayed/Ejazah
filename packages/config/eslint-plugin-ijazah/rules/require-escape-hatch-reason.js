// api/require-escape-hatch-reason  ->  R-API-10  (fast)
//
// R-API-10: never use `any`, `as any` or `@ts-ignore` without an inline justification comment and
// a ticket reference. An escape hatch is not banned — sometimes a vendor's typings are wrong and
// the fix is theirs — but an undocumented one is a permanent exception nobody can find again,
// while a documented one is a debt record with a name on it (FR-008). Lint suppressions are the
// same idea under R-PROC-7 and a separate rule, because a message can end with only one identifier.
//
// WHAT COUNTS AS A JUSTIFICATION (T041): decided once in `../justification.js` for this rule,
// R-PROC-7 and R-PROC-8 — a ticket (a Spec Kit task `T041`, a Jira-style key `IJZ-231`, a GitHub
// `#123`; never a constitution id) and at least two words of reason, in one comment on the hatch's
// own line or the line immediately above it.
//
// WHAT IS A HATCH (T041):
//
//   - the `any` type, wherever it is written: an annotation (`x: any`), a cast (`x as any`, `<any>x`),
//     a type argument (`Array<any>`), a generic default, a return type. Each `any` is one hatch and
//     is justified on its own; two on one line share the line's comment.
//   - `@ts-ignore`, and with it `@ts-nocheck`, which is `@ts-ignore` for a whole file, and
//     `@ts-expect-error`, which is the better spelling of the same suppression and still needs to
//     say why an error is expected. The reason may follow the directive in the same comment
//     (`// @ts-ignore the vendor typings omit the callback, IJZ-231`) or sit on the line above.
//
// `unknown` is not a hatch; it is the honest type. A double cast through `unknown` narrows
// without a hatch and is a review matter.
//
// No folder is exempt. A test that casts to `any` to reach a private is the same undocumented
// exception as a service that does.
const { defineRule } = require('../rule');
const { isJustification, isJustified } = require('../justification');

const TS_DIRECTIVE = /^\s*@ts-(ignore|nocheck|expect-error)\b/;

module.exports = defineRule({
  constitutionId: 'R-API-10',
  description:
    'Requires a justification comment and a ticket beside every any and every @ts-ignore, @ts-nocheck or @ts-expect-error',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    anyWithoutReason:
      '"any" with no justification and no ticket — an escape hatch is a debt record, so say why the type cannot be named and where the debt is tracked, on this line or the one above (e.g. "// vendor payload is untyped until FR-074 lands, IJZ-231")',
    directiveWithoutReason:
      '"@ts-{{directive}}" with no justification and no ticket — a suppressed compiler error is a debt record, so say why it is suppressed and where the debt is tracked, in the same comment or the line above (e.g. "// @ts-ignore vendor typings omit the callback, IJZ-231")',
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      TSAnyKeyword: (node) => {
        if (isJustified(sourceCode, node)) return;
        context.report({ node, messageId: 'anyWithoutReason' });
      },
      Program: () => {
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          const match = TS_DIRECTIVE.exec(comment.value);
          if (match === null) continue;
          if (isJustification(comment.value)) continue;
          // The line above may carry the reason instead.
          const above = comments.find(
            (candidate) =>
              candidate !== comment && candidate.loc.end.line === comment.loc.start.line - 1,
          );
          if (above !== undefined && isJustification(above.value)) continue;
          context.report({
            loc: comment.loc,
            messageId: 'directiveWithoutReason',
            data: { directive: match[1] },
          });
        }
      },
    };
  },
});
