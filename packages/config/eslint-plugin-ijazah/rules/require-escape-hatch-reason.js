// api/require-escape-hatch-reason  ->  R-API-10  (fast)
//
// R-API-10: never use `any`, `as any` or `@ts-ignore` without an inline justification comment and
// a ticket reference. An escape hatch is a debt record, not a resolution (constitution,
// "Compliance review"): the type checker is switched off at that point, and the comment is the
// only thing that says why and when it comes back on (FR-008). The hatch is not banned; an
// undocumented one is. Lint escape hatches are the neighbouring rule, R-PROC-7.
//
// The constitution names two mechanisms, `no-explicit-any` and `ban-ts-comment` with a description
// requirement. Neither can ask for a ticket or tell a ticket from a rule id, so both halves are
// implemented here and report under the one published id (FR-011).
//
// WHAT IS REFUSED
//
//   any           every `any` type, wherever it is written: `x: any`, `as any`, `<any>x`,
//                 `Array<any>`, `Record<string, any>`, a return type, a generic default.
//   a directive   `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck`, in a line comment or a
//                 block comment. `ban-ts-comment` treats the three alike, and FR-008 says "a
//                 suppressed type error": `@ts-expect-error` suppresses one exactly as
//                 `@ts-ignore` does, and differs only in complaining when there is nothing left
//                 to suppress.
//
// unless it carries a justification. The syntax is decided in `../justification.js` and shared
// with R-PROC-7 and R-PROC-8: a ticket — a task id (`T041`), `#123`, or a tracker key
// (`SCRUM-51`) — plus at least two words of reason. A rule or requirement id (`R-API-10`,
// `FR-012`, `FR-NOTIF-4`, `ADR-0007`) is never a ticket.
//
// WHERE THE JUSTIFICATION IS READ
//
//   for `any`        in a comment on the same line, or in the comments directly above that line:
//                    one or more comments that each stand alone on their lines, with no blank
//                    line and no code between them and the `any`. A comment that trails code on
//                    its own line justifies that line only, never the line under it.
//   for a directive  in the directive's own comment, after the directive, which is where
//                    `ban-ts-comment` reads a description:
//                    `@ts-expect-error T030/FR-012: a plain number is not assignable`. For a
//                    block comment the directive and its description are the last line, as the
//                    compiler reads it.
//
// WHAT IS NOT SEEN, and is review's. Whether the reason is true, and whether the ticket exists.
// An `any` that arrives from a dependency's types or from `JSON.parse`, which is not written
// here. `unknown`, `never` and a cast through `unknown` are not escape hatches under R-API-10 and
// are not read. A JavaScript file has no type syntax, so only its directives are read.
const { defineRule } = require('../rule');
const { EXPECTED, isJustified } = require('../justification');

const DIRECTIVE = /^@ts-(ignore|expect-error|nocheck)(?![\w-])/;

/** `{ name, description }` for a compiler directive comment, else null. */
function directiveOf(comment) {
  let line;
  if (comment.type === 'Line') {
    // The compiler also reads `/// @ts-ignore`.
    line = comment.value.replace(/^\/+/, '').trimStart();
  } else {
    const lines = comment.value.split('\n');
    line = lines.at(-1).replace(/^[\s*/]+/, '');
  }
  const match = DIRECTIVE.exec(line);
  if (match === null) return null;
  return { name: `@ts-${match[1]}`, description: line.slice(match[0].length) };
}

module.exports = defineRule({
  constitutionId: 'R-API-10',
  description:
    'Requires a ticket and a reason beside every any, @ts-ignore, @ts-expect-error and @ts-nocheck',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    unjustifiedAny: `"any" switches the type checker off here with no justification — on this line or directly above it, write ${EXPECTED}`,
    unjustifiedDirective: `"{{name}}" suppresses a type error with no justification — after it, in the same comment, write ${EXPECTED}`,
  },
  create(context) {
    const { sourceCode } = context;
    const comments = sourceCode.getAllComments();

    /** True when nothing but whitespace comes before the comment on its first line. */
    function standsAlone(comment) {
      const before = sourceCode.getTokenBefore(comment, { includeComments: true });
      return before === null || before.loc.end.line < comment.loc.start.line;
    }

    /** Text of every comment that speaks for a line: those on it, and the block directly above. */
    function commentsFor(line) {
      const texts = [];
      for (const comment of comments) {
        if (comment.loc.start.line <= line && comment.loc.end.line >= line) {
          texts.push(comment.value);
        }
      }

      let expected = line - 1;
      for (let index = comments.length - 1; index >= 0; index -= 1) {
        const comment = comments[index];
        if (comment.loc.end.line > expected) continue;
        if (comment.loc.end.line < expected || !standsAlone(comment)) break;
        texts.push(comment.value);
        expected = comment.loc.start.line - 1;
      }
      return texts.join('\n');
    }

    return {
      Program() {
        for (const comment of comments) {
          const directive = directiveOf(comment);
          if (directive === null || isJustified(directive.description)) continue;
          context.report({
            loc: comment.loc,
            messageId: 'unjustifiedDirective',
            data: { name: directive.name },
          });
        }
      },
      TSAnyKeyword(node) {
        if (isJustified(commentsFor(node.loc.start.line))) return;
        context.report({ node, messageId: 'unjustifiedAny' });
      },
    };
  },
});
