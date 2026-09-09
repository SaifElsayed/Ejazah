// The rule factory for the internal plugin (T034).
//
// FR-011 is a naming convention: every rule is named for the constitution rule it enforces, and
// every message ends with that identifier, so a developer reading a failed build goes straight to
// the prohibition in `.specify/memory/constitution.md` and reads why it exists.
//
// A convention each rule author has to remember is not a convention, it is a hope. It is built
// here instead. A rule declares its constitution id once and writes message text without it; this
// factory appends the identifier to every message it registers, so every declared message
// template ends with the identifier and a rule that cites a malformed identifier fails to load at
// all rather than shipping a message no one can follow back. ESLint still accepts a raw
// `context.report({ message })` string this factory never sees; `tests/violations/harness.ts` is
// the runtime guard that catches a reported message which does not carry its identifier.
//
// The factory refuses what it does not understand: a key outside the accepted set throws rather
// than being dropped, so a rule that needs `fixable` or `hasSuggestions` fails at load time here
// instead of crashing inside ESLint at the first fix it tries to produce.
//
// Rule ids and constitution ids are additive-only (R-API-9): a rename breaks the trace from an
// old build log, an old pull request or an old architectural decision back to the prohibition.

// The constitution's own identifier shape: R-<FAMILY>-<number>, e.g. R-API-6, R-MOBILE-11.
// The number carries no leading zero, so `R-API-02` is not an identifier the constitution uses.
const CONSTITUTION_ID = /^R-[A-Z]+-[1-9]\d*$/;

// The two rule sets, split by what a rule needs to run (research R-10):
//   fast      - syntax only; editor and pre-commit hook
//   typeAware - needs the program; pipeline only
const FAST = 'fast';
const TYPE_AWARE = 'typeAware';
const RULE_SETS = [FAST, TYPE_AWARE];

// Everything a rule may declare. A definition key outside this set is refused: silently dropping
// it is how a rule ships without the `meta` ESLint needs to honour its own fixes.
const DEFINITION_KEYS = new Set([
  'constitutionId',
  'description',
  'type',
  'messages',
  'schema',
  'create',
  'fixable',
  'hasSuggestions',
  'deprecated',
  'defaultOptions',
]);

const FIXABLE = ['code', 'whitespace'];
const TYPES = ['problem', 'suggestion', 'layout'];

// `replacedBy` at the top level of `meta` is the legacy shape. ESLint 9.21 moved it inside
// `deprecated`, so a rule declaring it here would be writing a key ESLint no longer reads.
const DEPRECATED_HINT = 'use deprecated: { replacedBy: [...] }';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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
 * @param {'code'|'whitespace'} [definition.fixable]  Required by ESLint before a rule may fix.
 * @param {boolean} [definition.hasSuggestions]       Required by ESLint before a rule may suggest.
 * @param {object|boolean} [definition.deprecated]    Forwarded to `meta`; carries `replacedBy`.
 * @param {Array} [definition.defaultOptions]         Forwarded to `meta` untouched.
 * @returns {{ meta: object, create: Function }}
 */
function defineRule(definition) {
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    throw fail(undefined, 'no definition object was given');
  }

  const {
    constitutionId,
    description,
    type = 'problem',
    messages,
    schema = [],
    create,
    fixable,
    hasSuggestions,
    deprecated,
    defaultOptions,
  } = definition;

  if (typeof constitutionId !== 'string' || !CONSTITUTION_ID.test(constitutionId)) {
    throw fail(constitutionId, `"${constitutionId}" is not a constitution identifier (FR-011)`);
  }

  for (const key of Object.keys(definition)) {
    if (!DEFINITION_KEYS.has(key)) {
      const hint = key === 'replacedBy' ? ` — ${DEPRECATED_HINT}` : '';
      throw fail(constitutionId, `unknown key "${key}"${hint}`);
    }
  }

  if (typeof create !== 'function') {
    throw fail(constitutionId, 'no create() was given');
  }
  if (messages === null || typeof messages !== 'object' || Array.isArray(messages)) {
    throw fail(constitutionId, 'no messages were given — a rule reports through named messages');
  }
  if (fixable !== undefined && !FIXABLE.includes(fixable)) {
    throw fail(constitutionId, `fixable must be ${FIXABLE.join(' or ')}, not "${String(fixable)}"`);
  }
  // An accepted key with a shape ESLint does not read is the same failure as an unknown key, one
  // step later: the rule loads, the metadata is ignored, and nobody learns why.
  if (!TYPES.includes(type)) {
    throw fail(constitutionId, `type must be ${TYPES.join(', ')}, not "${String(type)}"`);
  }
  if (hasSuggestions !== undefined && typeof hasSuggestions !== 'boolean') {
    throw fail(constitutionId, 'hasSuggestions must be a boolean');
  }
  if (description !== undefined && typeof description !== 'string') {
    throw fail(constitutionId, 'description must be a string');
  }
  // ESLint accepts either an array of option schemas or one whole-options JSON Schema object.
  if (!Array.isArray(schema) && !isPlainObject(schema)) {
    throw fail(constitutionId, 'schema must be an array or an object');
  }
  if (deprecated !== undefined && typeof deprecated !== 'boolean' && !isPlainObject(deprecated)) {
    throw fail(constitutionId, 'deprecated must be a boolean or an object');
  }
  if (defaultOptions !== undefined && !Array.isArray(defaultOptions)) {
    throw fail(constitutionId, 'defaultOptions must be an array');
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
    // The identifier is appended, never written by hand: a rule author who ends the text with it
    // gets a message ending in it twice, which is how that mistake is caught here instead of in a
    // log. Only the end is checked, so a message may still cite a neighbouring rule the way the
    // contract does (R-API-10 and R-PROC-7 reference each other).
    if (text.trimEnd().endsWith(constitutionId)) {
      throw fail(
        constitutionId,
        `message "${messageId}" ends with the identifier itself — leave it out, it is appended`,
      );
    }
    suffixed[messageId] = `${text.trim()} ${constitutionId}`;
  }

  const meta = {
    type,
    docs: {
      description: description ?? `Enforces ${constitutionId}`,
      constitution: constitutionId,
    },
    messages: suffixed,
    schema,
  };

  // Present only when declared: an absent key and an `undefined` one read alike to ESLint, but
  // not to a test comparing the exported plugin object.
  if (fixable !== undefined) meta.fixable = fixable;
  if (hasSuggestions !== undefined) meta.hasSuggestions = hasSuggestions;
  if (deprecated !== undefined) meta.deprecated = deprecated;
  if (defaultOptions !== undefined) meta.defaultOptions = defaultOptions;

  return { meta, create };
}

module.exports = { defineRule, FAST, TYPE_AWARE, RULE_SETS };
