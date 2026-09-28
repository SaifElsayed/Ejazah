// proc/require-suppression-reason  ->  R-PROC-7  (fast)
//
// R-PROC-7: never disable a lint rule inline without a justification comment and a ticket. A
// suppression is allowed — the rule may be wrong about one line — but an unexplained one is a
// hole in the wall with no record of who cut it or when it closes (FR-008). Type escape hatches
// are R-API-10 and `api/require-escape-hatch-reason`; the two rules share one idea of a
// justification and report under different identifiers because a message can end with only one.
//
// WHAT IS A SUPPRESSION (T041): an `eslint-disable`, `eslint-disable-line` or
// `eslint-disable-next-line` comment, line or block. `eslint-enable` re-opens the wall and needs no
// reason of its own.
//
// WHERE THE REASON GOES (T041): after ESLint's own ` -- ` separator, which is the only place
// ESLint reads it as a description. Everything before the separator is parsed as a list of rule
// names, so a reason written there is a configuration error ("Definition for rule 'because' was
// not found"), not a justification. The description must satisfy `../justification.js`: a ticket
// and two words of reason.
//
//   // eslint-disable-next-line ijazah/db/no-weak-random -- shuffling a demo list, not an id, IJZ-231
//
// A blanket `eslint-disable` naming no rule is not refused here as long as it carries a reason:
// that is R-PROC-7 as written. It is the widest hole a file can cut, and review reads for it.
//
// The fixture, `modules/verification/review-code.ts`, suppresses `ijazah/db/no-weak-random` on a
// line that genuinely violates it, so the directive is used, and this is the only rule left to
// report the file (note under T025–T026).
//
// No folder is exempt. Every file in the repository is read.
const { defineRule } = require('../rule');
const { isJustification } = require('../justification');

const DISABLE_DIRECTIVE = /^\s*eslint-disable(?:-next-line|-line)?\b/;
const DESCRIPTION_SEPARATOR = /\s--\s/;

module.exports = defineRule({
  constitutionId: 'R-PROC-7',
  description:
    'Requires every eslint-disable directive to carry a justification and a ticket after the -- separator',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    noDescription:
      'this "{{directive}}" carries no justification and no ticket — a suppression is a debt record, so add " -- <why>, <ticket>" after the rule name (e.g. "-- shuffling a demo list, not an id, IJZ-231")',
    weakDescription:
      'this "{{directive}}" description names no ticket or gives no reason — a suppression is a debt record, so say why the rule is wrong here and where the debt is tracked (e.g. "-- shuffling a demo list, not an id, IJZ-231")',
  },
  create(context) {
    return {
      Program: () => {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = DISABLE_DIRECTIVE.exec(comment.value);
          if (match === null) continue;
          const directive = match[0].trim();
          const separator = DESCRIPTION_SEPARATOR.exec(comment.value);
          if (separator === null) {
            context.report({ loc: comment.loc, messageId: 'noDescription', data: { directive } });
            continue;
          }
          const description = comment.value.slice(separator.index + separator[0].length);
          if (isJustification(description)) continue;
          context.report({ loc: comment.loc, messageId: 'weakDescription', data: { directive } });
        }
      },
    };
  },
});
