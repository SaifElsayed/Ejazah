// proc/no-bare-marker  ->  R-PROC-8  (fast)
//
// R-PROC-8: never commit commented-out code or a bare marker comment. A marker carries a ticket
// reference or does not exist. A marker with no ticket is a promise nobody is holding, and
// commented-out code is a second version of the file that no test, type check or review reads
// (FR-062).
//
// The constitution's mechanism is "`no-warning-comments` configured". That rule can refuse a
// marker or allow it; it cannot ask for a ticket, and it knows nothing of commented-out code, so
// both halves are implemented here under the one published id (FR-011).
//
// HALF ONE — a marker with no ticket. The markers are the words TODO, FIXME, HACK and XXX; a
// comment is a marker comment when one of them
//
//   - opens the COMMENT ITSELF, as a whole word, in any letter case: a comment reading
//     "todo fix this" or "fixme later", or opening with a capitalised "Todo", is a marker
//     (review of the pull request for T037–T042, item m9). The start of the comment is what is
//     left once its own decoration is off: whitespace, line breaks and the characters `*`, `/`
//     and `!`, so the first words of a `/** … */` block count wherever its gutter puts them,
//     and so do those of a `///` or `//!` comment; or
//   - is written as a JSDoc tag, `@todo` or `@fixme` (and the same for the other two words), at
//     the start of the comment or of ANY line of a block comment; or
//   - appears anywhere, in any case, directly followed by `:` or `(`, with no space between.
//
// A bare marker word that opens a LATER line of a block comment is not a marker (second review of
// PR #29, nit 2): a block whose second line happens to begin "todo items for the teacher" is a
// sentence that wrapped there. Nor is a marker word in the MIDDLE of a line, with no `:` or `(`
// after it: a remark that goes on to say "… TODO remove" after its own label is read as prose.
// Both are the reading of core `no-warning-comments` with `location: 'start'`, the mechanism the
// constitution names, which looks at the start of each comment and not of each of its lines; it
// is why the opening position can afford to ignore case.
//
// Every `//` comment is a comment of its own and is judged at its own start, however many stand
// in a row: a second `//` line that begins with a marker word is a marker. Prose that wraps
// there is reworded or moved into one block comment.
//
// It is refused unless the same comment carries a ticket: a task id (`T041`), `#123`, or a
// tracker key (`SCRUM-51`). A rule or requirement id is never a ticket; the syntax is decided in
// `../justification.js` and shared with R-API-10 and R-PROC-7. The same comment means the same
// `//` line or the same `/* */` block: a ticket two lines further down belongs to another
// comment.
//
// A sentence that merely mentions a marker word mid-line is prose and is not refused, and neither
// is `it.todo(…)`, which is code; a comment that quotes that call (`.todo(`, after a dot) is prose
// about code and is not a marker either.
//
// HALF TWO — commented-out code. A run of comments is refused when the whole of it is code:
//
//   - it is one `/* */` block, or consecutive `//` comments that each stand alone on their line;
//   - at least one of its lines ends in `;`, `{` or `}`;
//   - its text, as a whole, parses with the file's own parser, as a module or as a function body;
//   - and what it parses to is a statement that does something: a declaration, an import or
//     export, a control-flow statement, or a call, `new`, `await`, assignment or update.
//
// PROSE IS ALMOST NEVER REFUSED AS CODE, and the four conditions are how. A sentence does not
// parse. A comment that explains and then shows an example does not parse as a whole, so
// documentation with a code sample in it stays legal. A lone word or name (`deprecated`, `x.y`),
// a label followed by a word (`Note: important`) and a bare expression parse but do nothing, and
// are not refused. The cost is stated honestly: commented-out code directly under a sentence in
// the same run of comments is not seen, and neither is a fragment that does not parse on its own
// (two lines out of the middle of an object literal).
//
// THE PROSE THAT IS REFUSED, stated plainly (m9). A short comment that happens to be a complete
// statement IS refused, because nothing in its text tells it from code. Two shapes are known:
//
//   a lead-in and a call     a line reading: e.g. foo();      the abbreviation's dots parse as
//                                                              member access, so this is a call
//   an equation              a line reading: keys = values;   an assignment
//
// Both end in `;` and parse to a statement that does something. Write the code part in
// backticks and it is prose again: "e.g. `foo()`;" no longer parses, and "`keys = values`;" is a
// bare template literal, which does nothing. Dropping the final `;` works too. No exemption is
// made for an "e.g." or "i.e." lead-in: a line of real commented-out code can follow one in the
// same run, and the rule could not tell the two apart.
//
// The rule reads every file. Directive comments (`eslint-…`, `@ts-…`) are not code and are the
// business of R-PROC-7 and R-API-10.
const { defineRule } = require('../rule');
const { hasTicket } = require('../justification');
const { unwrap } = require('../syntax');

const MARKERS = ['TODO', 'FIXME', 'HACK', 'XXX'];
const WORDS = MARKERS.join('|');
// Opening the comment itself, after its decoration, in any case, with or without the JSDoc `@`
// (m9; second review, nit 2).
const OPENING_MARKER = new RegExp(`^[\\s*/!]*@?(${WORDS})(?![\\w-])`, 'i');
// The JSDoc tag at the start of any line of a block comment, after the gutter. Spaces and tabs
// only, never a line break, so each line is read once.
const TAG_LINE = new RegExp(`^[ \\t*]*@(${WORDS})(?![\\w-])`, 'im');
const TAGGED_MARKER = new RegExp(`(?<![\\w.-])(${WORDS})[:(]`, 'i');

const CODE_LINE_ENDINGS = new Set([';', '{', '}']);

function endsLikeCode(line) {
  return CODE_LINE_ENDINGS.has(line.trimEnd().at(-1));
}

const STATEMENTS = new Set([
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'TryStatement',
  'ReturnStatement',
  'ThrowStatement',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
  'TSDeclareFunction',
  'TSImportEqualsDeclaration',
  'TSExportAssignment',
]);

const EFFECTS = new Set([
  'CallExpression',
  'NewExpression',
  'AwaitExpression',
  'AssignmentExpression',
  'UpdateExpression',
  'YieldExpression',
]);

function doesSomething(statement) {
  if (STATEMENTS.has(statement.type)) return true;
  if (statement.type !== 'ExpressionStatement') return false;
  // A directive prologue (`'use strict';`) is an expression statement holding a string.
  const expression = unwrap(statement.expression);
  return EFFECTS.has(expression.type);
}

/** The marker a comment carries, or null. */
function markerIn(comment) {
  const text = comment.value;
  const match =
    OPENING_MARKER.exec(text) ??
    (comment.type === 'Block' ? TAG_LINE.exec(text) : null) ??
    TAGGED_MARKER.exec(text);
  return match === null ? null : match[1].toUpperCase();
}

/** The text of a comment as its author wrote the lines, without the `*` gutter of a block. */
function linesOf(comment) {
  if (comment.type === 'Line') return [comment.value];
  return comment.value.split('\n').map((line) => line.replace(/^\s*\*?/, ''));
}

module.exports = defineRule({
  constitutionId: 'R-PROC-8',
  description:
    'Bans a marker comment with no ticket, and a run of comments that is commented-out code',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    bareMarker:
      'This {{marker}} carries no ticket — add a task id such as T041, #123 or a tracker key such as SCRUM-51 to the same comment, or remove it; a rule or requirement id is not a ticket',
    commentedCode:
      'This comment is commented-out code — delete it, because version control already keeps the old version and nothing type-checks or tests a comment',
  },
  create(context) {
    const { sourceCode } = context;
    const parser = context.languageOptions.parser;
    const jsx = /\.[cm]?[jt]sx$/.test(context.filename);

    function parses(text) {
      if (parser === null || parser === undefined) return null;
      const options = {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx },
        range: false,
        loc: false,
        comment: false,
        tokens: false,
      };
      try {
        const result =
          typeof parser.parseForESLint === 'function'
            ? parser.parseForESLint(text, options).ast
            : parser.parse(text, options);
        return result;
      } catch {
        return null;
      }
    }

    /** True when the text is, as a whole, code that does something. */
    function isCode(text) {
      const asModule = parses(text);
      if (asModule !== null) return asModule.body.some(doesSomething);

      // `return` and `await` are legal only inside a function.
      const asBody = parses(`async function __commented__() {\n${text}\n}`);
      if (asBody === null || asBody.body.length !== 1) return false;
      const [wrapper] = asBody.body;
      if (wrapper.type !== 'FunctionDeclaration') return false;
      return wrapper.body.body.some(doesSomething);
    }

    function standsAlone(comment) {
      const before = sourceCode.getTokenBefore(comment, { includeComments: true });
      return before === null || before.loc.end.line < comment.loc.start.line;
    }

    /** Runs of comments that read as one: a block, or adjacent stand-alone line comments. */
    function runsOf(comments) {
      const runs = [];
      let current = null;
      for (const comment of comments) {
        const joins =
          current !== null &&
          comment.type === 'Line' &&
          current.at(-1).type === 'Line' &&
          standsAlone(comment) &&
          standsAlone(current.at(-1)) &&
          comment.loc.start.line === current.at(-1).loc.end.line + 1;
        if (joins) {
          current.push(comment);
        } else {
          current = [comment];
          runs.push(current);
        }
      }
      return runs;
    }

    return {
      Program() {
        const comments = sourceCode
          .getAllComments()
          .filter((comment) => comment.type !== 'Shebang');

        for (const comment of comments) {
          const marker = markerIn(comment);
          if (marker === null || hasTicket(comment.value)) continue;
          context.report({ loc: comment.loc, messageId: 'bareMarker', data: { marker } });
        }

        for (const run of runsOf(comments)) {
          const lines = run.flatMap(linesOf);
          if (!lines.some(endsLikeCode)) continue;
          if (!isCode(lines.join('\n'))) continue;
          context.report({
            loc: { start: run[0].loc.start, end: run.at(-1).loc.end },
            messageId: 'commentedCode',
          });
        }
      },
    };
  },
});
