// The rule factory for the internal plugin (T034).
//
// FR-011 is a naming convention: every rule is named for the constitution rule it enforces, and
// every message ends with that identifier, so a developer reading a failed build goes straight to
// the prohibition in `.specify/memory/constitution.md` and reads why it exists.
//
// A convention each rule author has to remember is not a convention, it is a hope. It is built
// here instead. A rule declares its constitution id once and writes message text without it; this
// factory appends the identifier to every message it registers. There is no way to declare a
// message that breaks the trace, and a rule that cites a malformed identifier fails to load at
// all rather than shipping a message no one can follow back.
//
// Rule ids and constitution ids are additive-only (R-API-9): a rename breaks the trace from an
// old build log, an old pull request or an old architectural decision back to the prohibition.

// The constitution's own identifier shape: R-<FAMILY>-<number>, e.g. R-API-6, R-MOBILE-11.
const CONSTITUTION_ID = /^R-[A-Z]+-\d+$/;

// The two rule sets, split by what a rule needs to run (research R-10):
//   fast      - syntax only; editor and pre-commit hook
//   typeAware - needs the program; pipeline only
const FAST = 'fast';
const TYPE_AWARE = 'typeAware';
const RULE_SETS = [FAST, TYPE_AWARE];

function fail(constitutionId, detail) {
  return new Error(`eslint-plugin-ijazah (${constitutionId ?? 'unknown rule'}): ${detail}`);
}

/**
 * Builds an ESLint rule whose metadata satisfies FR-011 by construction.
 *
 * @param {object} definition
 * @param {string} definition.constitutionId  The prohibition this rule enforces, e.g. 'R-API-6'.
 * @param {object} definition.messages        Message id to text, written WITHOUT the identifier;
 *                                            the identifier is appended here.
 * @param {Function} definition.create        The rule body. Required: a rule that silently
 *                                            reported nothing would look implemented.
 * @param {string} [definition.description]   Defaults to `Enforces <constitutionId>`.
 * @param {string} [definition.type]          ESLint rule type; defaults to 'problem'.
 * @param {Array} [definition.schema]         Option schema; defaults to none.
 * @returns {{ meta: object, create: Function }}
 */
function defineRule(definition) {
  const {
    constitutionId,
    description,
    type = 'problem',
    messages,
    schema = [],
    create,
  } = definition;

  if (typeof constitutionId !== 'string' || !CONSTITUTION_ID.test(constitutionId)) {
    throw fail(constitutionId, `"${constitutionId}" is not a constitution identifier (FR-011)`);
  }
  if (typeof create !== 'function') {
    throw fail(constitutionId, 'no create() was given');
  }
  if (messages === null || typeof messages !== 'object') {
    throw fail(constitutionId, 'no messages were given — a rule reports through named messages');
  }

  const entries = Object.entries(messages);
  if (entries.length === 0) {
    throw fail(constitutionId, 'no messages were given — a rule reports through named messages');
  }

  const suffixed = {};
  for (const [messageId, text] of entries) {
    if (typeof text !== 'string' || text.trim() === '') {
      throw fail(constitutionId, `message "${messageId}" has no text`);
    }
    // The identifier is appended, never written by hand: a rule author who spells it out gets a
    // message ending in it twice, which is how that mistake is caught here instead of in a log.
    if (text.includes(constitutionId)) {
      throw fail(
        constitutionId,
        `message "${messageId}" writes the identifier itself — leave it out, it is appended`,
      );
    }
    suffixed[messageId] = `${text.trim()} ${constitutionId}`;
  }

  return {
    meta: {
      type,
      docs: {
        description: description ?? `Enforces ${constitutionId}`,
        constitution: constitutionId,
      },
      messages: suffixed,
      schema,
    },
    create,
  };
}

module.exports = { defineRule, FAST, TYPE_AWARE, RULE_SETS, CONSTITUTION_ID };
