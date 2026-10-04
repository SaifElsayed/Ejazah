// proc/require-suppression-reason  ->  R-PROC-7  (fast)
//
// R-PROC-7: never disable a lint rule inline without a justification comment and ticket. A
// suppression is a debt record, not a resolution (constitution, "Compliance review"): it turns a
// machine-held rule back into a remembered one at that line, and the comment is the only thing
// that says why and when the machine takes it back (FR-008). Type escape hatches are the
// neighbouring rule, R-API-10.
//
// WHAT IS REFUSED — an ESLint directive that switches a rule off and carries no justification:
//
//   a block comment opening with `eslint-disable`
//   a line or block comment opening with `eslint-disable-line` or `eslint-disable-next-line`
//   a block comment opening with `eslint` followed by rule settings (an inline configuration)
//
// whether it names rules or is bare and disables all of them. `eslint-enable` switches nothing
// off and needs no reason. A line comment opening with a plain `eslint-disable` is not a
// directive to ESLint and suppresses nothing, so it is not read.
//
// THE JUSTIFICATION comes after ESLint's own ` -- ` separator, inside the directive's comment,
// because that is the only text ESLint itself treats as a description rather than as a rule
// name. It must be a ticket plus at least two words of reason; the syntax is decided in
// `../justification.js` and shared with R-API-10 and R-PROC-8. A rule or requirement id is never
// a ticket.
//
// WHERE THE REPORT IS PLACED, and why it matters. ESLint drops any report located inside the
// range a directive covers, when the directive is bare or names the reporting rule. A bare
// directive reported at its own position would therefore suppress the report about itself:
// `eslint-disable-line` covers its whole line, and a block `eslint-disable` covers everything
// from its first character. So the report is placed at the nearest position before the directive
// that no directive in the file covers — the directive itself when it only names other rules,
// else the character before it, else the start of the line above, and so on upward — and the
// message says which line the directive is on. Two bare directives on consecutive lines are both
// reported, each above the pair.
//
// A directive at the very first character of the file (or `eslint-disable-line` on line 1) has
// nothing before it. Found by experiment against ESLint 10 (T041): a report located before the
// first character — line 1, column -1 — is not covered by any directive and is delivered, shown
// as `1:0`. The rule uses that position as its last resort, and `tests/lint-plugin/
// require-suppression-reason.spec.ts` proves it through the real `Linter`, with inline
// configuration on, so an ESLint that starts validating report locations turns that spec red
// rather than silently reopening the hole.
//
// WHAT THIS RULE CANNOT SEE — one case, stated plainly. An inline configuration comment that
// turns THIS rule off (`eslint` followed by this rule's id set to `off`) is applied by ESLint
// before any rule runs, for the whole file, so the rule never executes there and nothing it could
// report would be delivered. Closing that needs a mechanism outside the linter's rules: a text
// gate in the pipeline over the source (the T081 pattern), and
// `linterOptions.reportUnusedDisableDirectives: 'error'` so a directive that suppresses nothing
// cannot linger. Both belong to the configuration and pipeline tasks, not to T041.
//
// Whether the reason is true and whether the ticket exists are review's.
const { defineRule } = require('../rule');
const { EXPECTED, isJustified } = require('../justification');

const KEYWORD =
  /^(eslint-disable-next-line|eslint-disable-line|eslint-disable|eslint-enable|eslint)(?=\s|$)/;
// ESLint splits a directive from its description on this, and so does this rule.
const SEPARATOR = /\s-{2,}\s/;
const CONFIGURED_RULE = /([\w@/-]+)["']?\s*:/g;

const BLOCK = 'block';
const LINE = 'line';
const NEXT_LINE = 'next-line';
const ENABLE = 'enable';
const CONFIG = 'config';

const KIND = {
  'eslint-disable': BLOCK,
  'eslint-disable-line': LINE,
  'eslint-disable-next-line': NEXT_LINE,
  'eslint-enable': ENABLE,
  eslint: CONFIG,
};

/** The directive a comment is, as ESLint would read it, or null. */
function directiveOf(comment) {
  const value = comment.value.trim();
  const [head, ...description] = value.split(SEPARATOR);
  const keyword = KEYWORD.exec(head);
  if (keyword === null) return null;

  const kind = KIND[keyword[1]];
  // ESLint honours only the two line-scoped directives in a `//` comment.
  if (comment.type === 'Line' && kind !== LINE && kind !== NEXT_LINE) return null;
  // A line-scoped directive spread over several lines is an error to ESLint, not a directive.
  if (kind === LINE && comment.loc.start.line !== comment.loc.end.line) return null;

  const body = head.slice(keyword[0].length).trim();
  let rules;
  if (kind === CONFIG) {
    if (body === '') return null;
    rules = new Set([...body.matchAll(CONFIGURED_RULE)].map((match) => match[1]));
  } else {
    const named = body
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
    // No rule named means every rule.
    rules = named.length === 0 ? null : new Set(named);
  }

  return {
    kind,
    name: keyword[1],
    rules,
    description: description.join(' -- '),
    start: comment.loc.start,
    end: comment.loc.end,
    comment,
  };
}

// Before the first character of the file, where no directive reaches: see the header.
const BEFORE_FILE = { line: 1, column: -1 };

function isBefore(a, b) {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

module.exports = defineRule({
  constitutionId: 'R-PROC-7',
  description: 'Requires a ticket and a reason after " -- " in every eslint-disable directive',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    unjustified: `The "{{name}}" on line {{line}} switches a rule off with no justification — after " -- ", in the same comment, write ${EXPECTED}`,
  },
  create(context) {
    const { sourceCode } = context;
    const ownId = context.id;

    return {
      Program() {
        const directives = sourceCode
          .getAllComments()
          .map(directiveOf)
          .filter((directive) => directive !== null);

        const touchesThisRule = (directive) =>
          directive.rules === null || directive.rules.has(ownId);

        // The range each directive silences this rule over, as ESLint computes it.
        const silenced = [];
        for (const directive of directives) {
          if (!touchesThisRule(directive)) continue;
          if (directive.kind === LINE) {
            silenced.push({ line: directive.start.line });
          } else if (directive.kind === NEXT_LINE) {
            silenced.push({ line: directive.end.line + 1 });
          } else if (directive.kind === BLOCK) {
            const enable = directives.find(
              (candidate) =>
                candidate.kind === ENABLE &&
                touchesThisRule(candidate) &&
                isBefore(directive.start, candidate.start),
            );
            silenced.push({
              from: directive.start,
              to: enable === undefined ? null : enable.start,
            });
          }
        }

        function isSilenced(position) {
          return silenced.some((range) => {
            if (range.line !== undefined) return range.line === position.line;
            if (isBefore(position, range.from)) return false;
            return range.to === null || isBefore(position, range.to);
          });
        }

        /** The nearest position at or before the directive that no directive silences. */
        function reportable(directive) {
          const { start } = directive;
          if (!isSilenced(start)) return directive.comment.loc;

          const candidates = [];
          if (start.column > 0) candidates.push({ line: start.line, column: start.column - 1 });
          for (let line = start.line - 1; line >= 1; line -= 1) {
            candidates.push({ line, column: 0 });
          }
          const position = candidates.find((candidate) => !isSilenced(candidate)) ?? BEFORE_FILE;
          return { start: position, end: position };
        }

        for (const directive of directives) {
          if (directive.kind === ENABLE) continue;
          if (isJustified(directive.description)) continue;
          context.report({
            loc: reportable(directive),
            messageId: 'unjustified',
            data: { name: directive.name, line: String(directive.start.line) },
          });
        }
      },
    };
  },
});
