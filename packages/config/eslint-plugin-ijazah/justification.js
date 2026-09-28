// What counts as a justification and a ticket (T041, for R-API-10, R-PROC-7 and R-PROC-8).
//
// Three prohibitions ask for the same two things: an escape hatch may exist only with a reason
// and a ticket beside it (R-API-10 for `any` and `@ts-ignore`, R-PROC-7 for `eslint-disable`),
// and a marker comment may exist only with a ticket (R-PROC-8). The note under T025–T026 left the
// syntax undecided on purpose — no fixture carries a passing example — so it is decided here,
// once, and the three rules read it from here.
//
// DECISION (T041) — a ticket reference is any of:
//
//   T037        a Spec Kit task id, three or more digits, as `specs/*/tasks.md` numbers them
//   IJZ-123     a Jira-style key — two or more capitals or digits, a dash, a number. The
//               requirement ids of the SRS and the spec (`FR-043`, `FR-NOTIF-4`) have this shape
//               too, and a requirement is a traceable reference in this repository: commits and
//               pull requests already cite them.
//   #123        a GitHub issue or pull request number
//
// A constitution rule id is NOT a ticket. `R-API-10` names the prohibition, not the debt record
// the constitution's governance section asks for ("a debt record, not a permanent exception"),
// so `// R-API-10` beside an `any` explains nothing. The Jira form is therefore refused when it
// is preceded by `R-`, which is how `API-10` inside `R-API-10` is left unmatched while `IJZ-10`
// on its own is not.
//
// DECISION (T041) — a justification is prose beside the ticket, not the ticket alone. A comment
// reading `// T041` says where the debt is recorded and nothing about why the hatch is open; two
// words of reason is the floor, so `// gateway sends an untyped payload, T041` passes and
// `// T041` does not. The rules read the words of the comment with the ticket and any directive
// removed, so the words of `@ts-ignore` or `eslint-disable-next-line` never count as the reason,
// and neither does a rule id (`ijazah/db/no-weak-random`) or a path.
//
// The shape a passing comment takes, recorded here because the fixtures deliberately carry none
// (each is described in prose so this header is not itself a block of commented-out code, which
// R-PROC-8 refuses):
//
//   for a cast to any, the line above it reads
//        gateway payloads are untyped until FR-074 lands, IJZ-231
//   for a compiler suppression, the directive's own comment reads
//        @ts-ignore the vendor typings omit the callback, IJZ-231
//   for a lint suppression, the description after ESLint's separator reads (the directive itself
//   is not spelled out here, since ESLint would read this header as one)
//        <directive> ijazah/db/no-weak-random -- shuffling a demo list, not an id, IJZ-231
//   for a marker, the ticket sits in the marker's parentheses
//        TODO(IJZ-231): release the hold once the order expires
//
// For an `eslint-disable` directive the reason has to follow ESLint's own ` -- ` separator:
// everything before it is read by ESLint as a list of rule names, so a reason written there is a
// configuration error, not a justification.

const TICKET = /\bT\d{3,}\b|(?<![\w#-])#\d+\b|(?<![A-Z]-)\b[A-Z][A-Z0-9]+-\d+\b/g;

// Directive words that never count as prose: the hatch's own spelling.
const DIRECTIVES =
  /@ts-(?:ignore|expect-error|nocheck)|eslint-(?:disable(?:-next-line|-line)?|enable)/g;

const MINIMUM_REASON_WORDS = 2;

function ticketsIn(text) {
  return String(text).match(TICKET) ?? [];
}

function hasTicket(text) {
  return ticketsIn(text).length > 0;
}

/**
 * Words of reason in the text once the ticket and the directive are removed. A word of prose
 * carries letters (Latin or Arabic); a token carrying a slash is a rule id or a path, not a reason.
 */
function reasonWordsIn(text) {
  return String(text)
    .replace(TICKET, ' ')
    .replace(DIRECTIVES, ' ')
    .split(/\s+/)
    .filter((token) => token !== '' && !token.includes('/') && /[A-Za-z؀-ۿ]{2,}/.test(token));
}

/** A ticket and at least two words of reason, in one comment. */
function isJustification(text) {
  return hasTicket(text) && reasonWordsIn(text).length >= MINIMUM_REASON_WORDS;
}

/**
 * The comments that can justify a node: one ending on the node's line (before or after it) or on
 * the line immediately above it. A justification three lines up, past unrelated code, justifies
 * something else.
 */
function commentsBeside(sourceCode, node) {
  const startLine = node.loc.start.line;
  return sourceCode
    .getAllComments()
    .filter(
      (comment) => comment.loc.end.line === startLine || comment.loc.end.line === startLine - 1,
    );
}

function isJustified(sourceCode, node) {
  return commentsBeside(sourceCode, node).some((comment) => isJustification(comment.value));
}

module.exports = {
  TICKET,
  commentsBeside,
  hasTicket,
  isJustification,
  isJustified,
  reasonWordsIn,
  ticketsIn,
};
