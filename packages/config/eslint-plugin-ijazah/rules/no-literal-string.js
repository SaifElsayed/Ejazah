// mobile/no-literal-string  ->  R-MOBILE-7  (fast)
//
// R-MOBILE-7: never hardcode a user-facing string. Every string goes through an i18n key, present
// in both `ar.json` and `en.json`. The application is Arabic-first; a literal in a view ships
// untranslatable text to every user, and the key-parity check in CI can only count keys that
// exist (FR-006). The mechanism the constitution names is "no string literals in JSX text
// positions", and this rule is that mechanism; key parity is a pipeline gate, not a lint rule.
//
// WHERE (T038): every file under `apps/mobile/src`. The constitution names no exempt folder for
// this prohibition — a primitive in `design/` with a hardcoded placeholder is as untranslatable
// as a screen with one — and `i18n/` holds JSON and the lookup, never a view.
//
// WHAT IS A TEXT POSITION (T038):
//
//   - JSX text between tags: `<Text>No teachers yet.</Text>`.
//   - A string or expression-free template written as a JSX child in braces:
//     `<Text>{'No teachers yet.'}</Text>`, `<Text>{`No teachers yet.`}</Text>`.
//   - A string value of an attribute the user reads or hears: `placeholder`, `title`, `label`,
//     `accessibilityLabel`, `accessibilityHint`, `alt`, `aria-label`, `aria-placeholder`,
//     `aria-description`, `headerTitle`, `tabBarLabel`, `errorMessage`, `helperText`.
//     A `testID`, a `className`, a `key` or a `name` is read by a machine and is legal.
//
// WHAT IS NOT USER-FACING (T038): a string carrying no letters in any script — `·`, `—`, `/`,
// `12:00`, `%` — is punctuation or a number the formatter already localised, and is legal in a
// text position. Whitespace-only JSX text is layout. A `t('student.home.empty')` call is the legal
// form and is an expression, not a literal, so it is never read; a literal passed as the argument
// of `t()` is the key itself and is not in a text position.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');

const MOBILE_TREE = 'apps/mobile/src';

const TEXT_ATTRIBUTES = new Set([
  'placeholder',
  'title',
  'label',
  'accessibilityLabel',
  'accessibilityHint',
  'alt',
  'aria-label',
  'aria-placeholder',
  'aria-description',
  'headerTitle',
  'tabBarLabel',
  'errorMessage',
  'helperText',
]);

// A letter in any script: Latin, Arabic and everything else Unicode calls a letter.
const HAS_LETTER = /\p{L}/u;

function isUserFacing(text) {
  return typeof text === 'string' && HAS_LETTER.test(text);
}

function quoted(text) {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed;
}

/** The literal text of a child expression when it is a string with nothing computed in it. */
function literalTextOf(expression) {
  if (expression.type === 'Literal' && typeof expression.value === 'string') {
    return expression.value;
  }
  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
  }
  return null;
}

function attributeName(node) {
  if (node.name.type === 'JSXIdentifier') return node.name.name;
  if (node.name.type === 'JSXNamespacedName')
    return `${node.name.namespace.name}:${node.name.name.name}`;
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-7',
  description: 'Bans a user-facing string literal in a JSX text position in apps/mobile',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    text: '"{{text}}" is a user-facing string written into the view — every string is an i18n key present in both ar.json and en.json, read through t()',
    attribute:
      '"{{text}}" in {{attribute}} is a user-facing string written into the view — every string is an i18n key present in both ar.json and en.json, read through t()',
  },
  create(context) {
    if (!isUnder(context.filename, MOBILE_TREE)) return {};

    return {
      JSXText: (node) => {
        if (!isUserFacing(node.value)) return;
        context.report({ node, messageId: 'text', data: { text: quoted(node.value) } });
      },
      JSXExpressionContainer: (node) => {
        // A child in braces; an attribute value in braces is read by the attribute visitor.
        if (node.parent.type !== 'JSXElement' && node.parent.type !== 'JSXFragment') return;
        const text = literalTextOf(node.expression);
        if (text === null || !isUserFacing(text)) return;
        context.report({ node, messageId: 'text', data: { text: quoted(text) } });
      },
      JSXAttribute: (node) => {
        const name = attributeName(node);
        if (name === null || !TEXT_ATTRIBUTES.has(name) || node.value === null) return;
        const text =
          node.value.type === 'JSXExpressionContainer'
            ? literalTextOf(node.value.expression)
            : literalTextOf(node.value);
        if (text === null || !isUserFacing(text)) return;
        context.report({
          node: node.value,
          messageId: 'attribute',
          data: { text: quoted(text), attribute: name },
        });
      },
    };
  },
});
