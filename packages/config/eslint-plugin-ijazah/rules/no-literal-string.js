// mobile/no-literal-string  ->  R-MOBILE-7  (fast)
//
// R-MOBILE-7: never hardcode a user-facing string. Every string goes through an i18n key, in both
// `ar.json` and `en.json`. A literal in a view ships untranslatable English into an Arabic-first
// application, and the key-parity check in the pipeline cannot see a string that never became a
// key (FR-006, FR-LOC-1).
//
// The constitution's mechanism is "no string literals in JSX text positions". A text position is
// where a string reaches the screen: the text between two tags, an expression between two tags,
// and the props a control shows or reads aloud.
//
// WHAT IS REFUSED — a string carrying at least one letter, of any script (Arabic included), in:
//
//   <Text>No teachers yet.</Text>                 text between tags
//   <Text>{'No teachers yet.'}</Text>             a literal in an expression between tags
//   <Text>{ok ? 'Yes' : 'No'}</Text>              either arm of a conditional
//   <Text>{t('x') || 'Fallback'}</Text>           the fallback of `||`, `&&` and `??`
//   <Text>{`Hello ${name}`}</Text>                a template literal whose own text has a letter
//   <Text>{'Hello ' + name}</Text>                an operand of `+`
//   <Text>{['Mon', 'Tue'].join(', ')}</Text>      an element of an array that is rendered or joined
//   <Field placeholder="Search" />                a user-visible prop, as a string or an expression
//
// each read through optional chaining and the TypeScript wrappers (`'Yes' as const`).
//
// The user-visible props are a fixed list (below): the text, label and accessibility props of
// React Native and of the primitives this application plans. `className`, `testID`, `name`,
// `href`, `key` and every other prop carry identifiers, not prose, and are never read. A string
// with no letter in it — `'—'`, `': '`, `'12'` — is punctuation or a number and is not refused.
//
// DECISION (T038) — where it applies. Every file under `apps/mobile/src`, `design/` included,
// because a primitive with a hardcoded label is shown to the same user. Test files (`*.spec.*`,
// `*.test.*`, `__tests__/`) are NOT read: the rule's own words are "user-facing string", and a
// string in a test is rendered to no user. The Admin panel is English-only by decision (FR-LOC-5)
// and is outside this rule.
//
// WHAT IS NOT REFUSED, and is review's or the pipeline's. A string that reaches the screen
// through a call (`Alert.alert('Saved')`, `toast.show('Saved')`, a navigation option object) or a
// variable (`const label = 'Save'` rendered as `{label}`): neither is a JSX text position, and
// following a value needs the program this fast rule does not have (research R-10). A prop
// outside the list. Whether a key exists in both language files is the pipeline's parity check.
//
// The file is matched by path segments, never by a root-anchored path (note under T035).
const { defineRule } = require('../rule');
const { isTestFile, mobileFile } = require('../mobile');
const { alternatives, propertyName, unwrap } = require('../syntax');

const LETTER = /\p{L}/u;

// Props whose value a user reads or hears.
const VISIBLE_PROPS = new Set([
  'placeholder',
  'title',
  'subtitle',
  'label',
  'text',
  'message',
  'description',
  'caption',
  'hint',
  'helperText',
  'errorText',
  'errorMessage',
  'emptyText',
  'headerTitle',
  'tabBarLabel',
  'buttonText',
  'confirmText',
  'cancelText',
  'alt',
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
]);

const MAX_QUOTED = 40;

function quoted(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_QUOTED ? `${flat.slice(0, MAX_QUOTED)}…` : flat;
}

/** `{ node, text }` for every literal an expression can put on screen. */
function visibleLiterals(expression) {
  const found = [];
  const pending = [expression];

  while (pending.length > 0) {
    for (const leaf of alternatives(pending.pop())) {
      if (leaf.type === 'Literal') {
        if (typeof leaf.value === 'string' && LETTER.test(leaf.value)) {
          found.push({ node: leaf, text: leaf.value });
        }
      } else if (leaf.type === 'TemplateLiteral') {
        const text = leaf.quasis.map((quasi) => quasi.value.cooked ?? '').join('…');
        if (LETTER.test(text)) found.push({ node: leaf, text });
      } else if (leaf.type === 'BinaryExpression' && leaf.operator === '+') {
        pending.push(leaf.left, leaf.right);
      } else if (leaf.type === 'ArrayExpression') {
        pending.push(...leaf.elements.filter((element) => element !== null));
      } else if (leaf.type === 'CallExpression') {
        const callee = unwrap(leaf.callee);
        if (callee.type === 'MemberExpression' && propertyName(callee) === 'join') {
          pending.push(callee.object);
        }
      }
    }
  }
  return found;
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-7',
  description:
    'Bans string literals in JSX text positions and user-visible props in apps/mobile/src',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    literalText:
      '"{{text}}" is a hardcoded user-facing string — use an i18n key present in both ar.json and en.json, because a literal cannot be translated',
    literalProp:
      '"{{text}}" is a hardcoded user-facing string in "{{prop}}" — use an i18n key present in both ar.json and en.json, because a literal cannot be translated',
  },
  create(context) {
    if (mobileFile(context.filename) === null || isTestFile(context.filename)) return {};

    function isChild(node) {
      return node.parent.type === 'JSXElement' || node.parent.type === 'JSXFragment';
    }

    return {
      JSXText(node) {
        if (!LETTER.test(node.value)) return;
        context.report({ node, messageId: 'literalText', data: { text: quoted(node.value) } });
      },
      JSXExpressionContainer(node) {
        if (!isChild(node) || node.expression.type === 'JSXEmptyExpression') return;
        for (const literal of visibleLiterals(node.expression)) {
          context.report({
            node: literal.node,
            messageId: 'literalText',
            data: { text: quoted(literal.text) },
          });
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.value === null) return;
        const prop = node.name.name;
        if (!VISIBLE_PROPS.has(prop)) return;

        const expression =
          node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        if (expression.type === 'JSXEmptyExpression') return;

        for (const literal of visibleLiterals(expression)) {
          context.report({
            node: literal.node,
            messageId: 'literalProp',
            data: { text: quoted(literal.text), prop },
          });
        }
      },
    };
  },
});
