// What counts as a justification, and what counts as a ticket (T041).
//
// R-API-10, R-PROC-7 and R-PROC-8 each ask for the same two things beside an escape hatch or a
// marker: a reason, and a ticket that will remove it. T026 left the syntax to this task (note
// under T025–T026), and three rules that each decided it alone would decide it three ways. It is
// decided here, once.
//
// A TICKET is something that can be closed:
//
//   T041, T044-T047      a Spec Kit task id, or a range of them (`specs/*/tasks.md`)
//   #123                 a GitHub issue or pull request
//   SCRUM-51, IJZ-231    a tracker key: upper-case project, a dash, a number
//
// A SPECIFICATION OR GOVERNANCE ID IS NEVER A TICKET. `R-API-10`, `FR-012`, `FR-NOTIF-4`,
// `NFR-SEC-2`, `SC-003`, `ADR-0007`, `OPEN-11`, `DEC-48`, `RISK-01`, `UC-4` and `SRS-IDN-1` name a
// rule, a requirement or a decision. Citing the rule one is breaking is not a plan to stop
// breaking it, and none of them is ever closed. The first seven prefixes are the ones the
// constitution, the SRS and the specs use for rules, requirements, criteria, decisions and open
// items; RISK, UC and SRS are the SRS's remaining id families and are refused for the same
// reason. A standards name of the same shape (`UTF-8`, `SHA-256`, `ISO-8601`) is not a ticket
// either.
//
// A JUSTIFICATION is a ticket plus at least two words of reason. One word ("temporary", "hack")
// is a label, not a reason. A word is anything carrying a letter, in any script, that is not
// itself a ticket or a specification id.
//
// Text is split on whitespace and punctuation, keeping `-` and `#` inside a token, so
// `T030/FR-012:` reads as the ticket `T030` and the specification id `FR-012`, and `FR-NOTIF-4`
// stays one token that is not a ticket rather than falling apart into `NOTIF-4`.

const SPEC_PREFIXES = new Set(['R', 'FR', 'NFR', 'SC', 'ADR', 'OPEN', 'DEC', 'RISK', 'UC', 'SRS']);

// Upper-case names that are followed by a number and are not a tracker project.
const STANDARDS = new Set([
  'UTF',
  'SHA',
  'MD',
  'ISO',
  'RFC',
  'AES',
  'RSA',
  'ES',
  'HTTP',
  'TLS',
  'SSL',
  'IEEE',
  'ECMA',
  'UTC',
  'GMT',
  'WCAG',
  'OWASP',
]);

const TASK_ID = /^T\d{3,4}$/;
const ISSUE = /^#\d+$/;
const TRACKER_KEY = /^([A-Z][A-Z0-9]+)-(\d+)$/;
const SPEC_PART = /^[A-Z0-9*]+$/;
const LETTER = /\p{L}/u;

function tokensOf(text) {
  return String(text)
    .split(/[^\p{L}\p{N}#*-]+/u)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token !== '');
}

function isSpecId(token) {
  const parts = token.split('-');
  if (parts.length < 2 || !SPEC_PREFIXES.has(parts[0])) return false;
  return parts.slice(1).every((part) => SPEC_PART.test(part));
}

function isTicket(token) {
  if (ISSUE.test(token)) return true;
  if (TASK_ID.test(token)) return true;

  const range = token.split('-');
  if (range.length === 2 && range.every((part) => TASK_ID.test(part))) return true;

  const key = TRACKER_KEY.exec(token);
  if (key === null) return false;
  return !SPEC_PREFIXES.has(key[1]) && !STANDARDS.has(key[1]);
}

/** `{ ticket, words }`: the first ticket in the text, or null, and how many words of reason. */
function justificationOf(text) {
  let ticket = null;
  let words = 0;
  for (const token of tokensOf(text)) {
    if (isTicket(token)) {
      ticket ??= token;
    } else if (!isSpecId(token) && LETTER.test(token)) {
      words += 1;
    }
  }
  return { ticket, words };
}

/** A ticket and at least two words of reason. */
function isJustified(text) {
  const { ticket, words } = justificationOf(text);
  return ticket !== null && words >= 2;
}

function hasTicket(text) {
  return justificationOf(text).ticket !== null;
}

/** The syntax, for a message: one place to change if the syntax changes. */
const EXPECTED =
  'a ticket (a task id such as T041, #123, or a tracker key such as SCRUM-51) and at least two words of reason; a rule or requirement id such as R-API-10 or FR-012 is not a ticket';

module.exports = { EXPECTED, hasTicket, isJustified, isTicket, justificationOf };
