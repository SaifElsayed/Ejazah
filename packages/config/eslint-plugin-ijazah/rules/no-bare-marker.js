// proc/no-bare-marker  ->  R-PROC-8  (fast)
//
// R-PROC-8: never commit commented-out code or a bare TODO. TODOs carry a ticket reference or do
// not exist. A marker with no ticket is a promise with no owner and no date; commented-out code is
// a decision not taken, kept where it will confuse the next reader and never run again (FR-062).
// The constitution's mechanism is "`no-warning-comments` configured"; that core rule refuses every
// marker and knows nothing of tickets or dead code, so this rule is the configured form.
//
// WHAT IS A MARKER (T041): `TODO`, `FIXME`, `XXX`, `HACK` or `BUG`, in any case, at the START of a
// comment (after whitespace, a block comment's `*` gutter or a JSDoc `@`), the way the core
// `no-warning-comments` reads them by default. A marker in the middle of a sentence — "the bug
// that ships silently", "a bare TODO" — is prose about a marker, not a marker, and a rule that
// refused it would refuse its own header and the constitution's wording. A comment is bare when it
// carries no ticket reference as `../justification.js` defines one — a Spec Kit task, a Jira-style
// key or a GitHub number; never a constitution id. `// TODO(IJZ-231): release the hold` passes;
// `// TODO: release the hold` does not. A marker needs a ticket, not a reason: the ticket is where
// the reason lives.
//
// WHAT IS COMMENTED-OUT CODE (T041): a run of consecutive line comments, or one block comment,
// that (a) carries a code signal — a statement terminator, a brace, a call, an assignment, an
// arrow, or a leading keyword such as `import`, `export`, `return`, `const` — and (b) parses as
// TypeScript when the comment markers are removed into at least one statement that is more than a
// bare word or literal. All three are needed: a one-word comment parses as an expression
// statement, a prose sentence can end in a semicolon ("chose;"), and a label followed by a word
// (`fallback: null;`) parses too, but none of them is a declaration, a call, a return or a
// control statement, which is what dead code is made of. A run is split at lines carrying no
// signal, so a prose paragraph followed by dead code is read as prose and then as code, and only
// the code is refused. Directive comments (`eslint-`, `@ts-`,
// `prettier-ignore`, `@vite-ignore`, `c8`, `istanbul`, `#region`), `/** doc */` blocks and
// shebangs are never read as code.
//
// The parser is `@typescript-eslint/parser`, the one the fast set already runs, asked to parse
// with JSX and then without it, since a TypeScript generic and a JSX tag can only be told apart
// by trying. A comment run that fails both is prose.
//
// No folder is exempt. Every comment in every file is read.
const { defineRule } = require('../rule');
const { hasTicket } = require('../justification');

// At the start of the comment only: after whitespace, a block comment's `*` gutters (a JSDoc tag sits
// on its second line, after `*\n *`) or a JSDoc `@`.
const MARKER = /^[\s*]*@?(TODO|FIXME|XXX|HACK|BUG)\b/i;

const DIRECTIVE =
  /^\s*(?:eslint-|@ts-|prettier-ignore|@vite-ignore|c8 |v8 |istanbul |#region|#endregion|@jsx|@__PURE__|global |globals |exported |sourceMappingURL)/;

// A line that could be a line of code rather than a line of prose. Prose rarely ends in `;` or
// `{`, opens a call, assigns, or begins with a keyword.
const CODE_SIGNAL =
  /[;{}]\s*$|^\s*[}\])]+[;,]?\s*$|=>|[\w$\]]\s*\([^)]*\)\s*[;{]?\s*$|^\s*[\w$.[\]]+\s*[+\-*/]?=\s*[^=]|^\s*(?:import|export|return|const|let|var|function|async|await|if|else|for|while|switch|case|class|interface|type|enum|throw|try|catch|finally|yield|new|delete|declare|abstract|readonly|public|private|protected|static|namespace|module)\b/;

let parser = null;
function loadParser() {
  if (parser === null) parser = require('@typescript-eslint/parser');
  return parser;
}

/** A statement dead code is made of, as opposed to a word or a literal that happens to parse. */
function isMoreThanAWord(statement) {
  let node = statement;
  while (node.type === 'LabeledStatement') node = node.body;
  if (node.type !== 'ExpressionStatement') return node.type !== 'EmptyStatement';
  const expression = node.expression;
  return (
    expression.type !== 'Identifier' &&
    expression.type !== 'Literal' &&
    expression.type !== 'TemplateLiteral'
  );
}

function parses(text) {
  const { parse } = loadParser();
  for (const jsx of [true, false]) {
    try {
      const program = parse(text, {
        jsx,
        range: false,
        loc: false,
        comment: false,
        tokens: false,
        errorOnUnknownASTType: false,
      });
      if (program.body.some(isMoreThanAWord)) return true;
    } catch {
      // Not code in this dialect; try the other.
    }
  }
  return false;
}

function isDirective(text) {
  return DIRECTIVE.test(text);
}

module.exports = defineRule({
  constitutionId: 'R-PROC-8',
  description:
    'Bans a marker comment carrying no ticket reference, and a block of commented-out code',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    bareMarker:
      '"{{marker}}" carries no ticket reference — a marker is a promise, and the ticket is who owns it; write "{{marker}}(<ticket>): …" or delete the marker',
    commentedOutCode:
      'commented-out code — a decision not taken; delete it, version control remembers, and if it is coming back the ticket says when',
  },
  create(context) {
    const sourceCode = context.sourceCode;

    function checkMarkers(comment) {
      const match = MARKER.exec(comment.value);
      if (match === null) return;
      if (hasTicket(comment.value)) return;
      context.report({
        loc: comment.loc,
        messageId: 'bareMarker',
        data: { marker: match[1].toUpperCase() },
      });
    }

    function reportCode(first, last) {
      context.report({
        loc: { start: first.loc.start, end: last.loc.end },
        messageId: 'commentedOutCode',
      });
    }

    /** Lines of a block comment with a leading `*` gutter removed. */
    function blockLines(comment) {
      return comment.value.split(/\r?\n/).map((line) => line.replace(/^\s*\*\s?/, ''));
    }

    function checkBlock(comment) {
      if (comment.value.startsWith('*')) return; // a `/** doc */` block
      if (isDirective(comment.value)) return;
      const lines = blockLines(comment);
      if (!lines.some((line) => CODE_SIGNAL.test(line))) return;
      if (parses(lines.join('\n'))) reportCode(comment, comment);
    }

    /** Consecutive line comments, split where a line carries no code signal. */
    function checkLineRun(run) {
      let segment = [];
      const flush = () => {
        if (segment.length > 0 && parses(segment.map((c) => c.value).join('\n'))) {
          reportCode(segment[0], segment[segment.length - 1]);
        }
        segment = [];
      };
      for (const comment of run) {
        const text = comment.value;
        const continuesCode =
          !isDirective(text) &&
          (CODE_SIGNAL.test(text) ||
            // A closing line of a block already opened, or an empty line inside it.
            (segment.length > 0 && /^\s*$/.test(text)));
        if (continuesCode) {
          segment.push(comment);
        } else {
          flush();
        }
      }
      flush();
    }

    return {
      Program: () => {
        const comments = sourceCode.getAllComments();
        let run = [];
        let previous = null;
        for (const comment of comments) {
          checkMarkers(comment);
          if (comment.type === 'Shebang') continue;
          if (comment.type === 'Block') {
            checkLineRun(run);
            run = [];
            previous = null;
            checkBlock(comment);
            continue;
          }
          // A line comment continues the run when it sits on the very next line.
          if (previous !== null && comment.loc.start.line !== previous.loc.end.line + 1) {
            checkLineRun(run);
            run = [];
          }
          run.push(comment);
          previous = comment;
        }
        checkLineRun(run);
      },
    };
  },
});
