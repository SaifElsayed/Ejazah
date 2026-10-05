// mobile/no-translated-concat  ->  R-MOBILE-8  (fast)
//
// R-MOBILE-8: never concatenate translated fragments to build a sentence. Use interpolation within
// one key. Concatenation fixes the order of the parts in code, and the order of the parts is
// exactly what right-to-left layout and Arabic grammar need to be free to change; a sentence
// assembled from fragments is correct in one language at most (FR-006).
//
// The constitution calls this mechanism a heuristic ("string `+` with i18n calls") and keeps
// review behind it. The heuristic here is: a translation call may be rendered whole, and may be
// handed values to interpolate, but may not be joined to anything.
//
// A TRANSLATION CALL is a call to `t`, or to a method named `t` on anything: `t('k')`,
// `i18n.t('k')`, `props.t('k')`, `i18n['t']('k')`, each also through optional chaining
// (`t?.('k')`, `i18n?.t('k')`) and the TypeScript wrappers.
//
// WHAT IS REFUSED — a translation call as a part of:
//
//   t('a') + t('b')            `+`, at any depth of a chain, and inside either arm of a
//   t('a') + ' ' + name          conditional or `||`, `&&`, `??` that is itself an operand
//   label += t('a')            `+=`
//   `${t('a')} ${name}`        a template literal with any other part: text, or a second `${}`
//   [t('a'), t('b')].join(' ') a joined array of two or more elements
//   t('a').concat(name)        `.concat`, as the receiver or as an argument
//   <Text>{t('a')} {t('b')}</Text>           laid side by side as children of one JSX element
//   <Text>{t('greeting')}, {name}!</Text>      or fragment (review of PR #29, m7), below
//
// SIDE BY SIDE IN JSX, precisely. The children of one element or fragment are read together. A
// child is a PART OF THE SENTENCE when it is
//
//   - JSX text with at least one character that is not whitespace (`, `, `!`, `:`), or
//   - an expression container that can put text on screen: anything except a comment
//     (`{/* … */}`), a string of whitespace only (`{' '}`), `null`, `undefined`, `true`, `false`,
//     and a JSX element or fragment. A conditional is read by its two arms and `a && b` by `b`,
//     so `{loading && <Spinner />}` is not a part and `{count}` is.
//
// The element is refused, once, when it holds two or more parts and one of them is a translation
// call. So `{t('a')} {t('b')}`, `{t('a')}{' '}{t('b')}` and `{t('greeting')}, {name}!` are
// refused: the order and the punctuation are fixed in the markup. `{t('label')}<Icon />`,
// `{t('a')}{' '}<Icon />` and `{t('a')}` alone are legal: an element is not text, and whitespace
// beside an element fixes no word order. A call beside a translation (`{t('title')}{rows.map(…)}`)
// is read as a part, because without types a list of elements cannot be told from a string; give
// the translation an element of its own.
//
// WHAT IS NOT REFUSED: `t('a')` alone; a template literal that is only the call; and a call given
// its values, `t('greeting', { name })`, which is the form the rule asks for.
//
// WHAT IS NOT SEEN, and is review's. A fragment stored first and joined later
// (`const hello = t('a'); hello + name`), and a translation function imported under another name
// (`import { t as tr }`): following a value or an alias needs the program this fast rule does not
// have (research R-10). Two `<Text>` elements placed side by side to form one sentence, and a
// translation followed by an element that carries the rest of it (`{t('by')} <Bold>{name}</Bold>`).
//
// DECISION (T038) — where it applies: every file under `apps/mobile/src`. The Admin panel has no
// translations (FR-LOC-5) and the API renders none: a notification stores keys and the device
// renders them (ERD `notifications.title_key`).
//
// The file is matched by path segments, never by a root-anchored path (note under T035).
const { defineRule } = require('../rule');
const { mobileFile } = require('../mobile');
const { alternatives, propertyName, unwrap, wrapped } = require('../syntax');

const TRANSLATE = 't';

function isTranslation(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = unwrap(node.callee);
  if (callee.type === 'Identifier') return callee.name === TRANSLATE;
  return callee.type === 'MemberExpression' && propertyName(callee) === TRANSLATE;
}

/** True when a value the expression can take is a translation call, or a `+` chain holding one. */
function carriesTranslation(expression) {
  const pending = [expression];
  while (pending.length > 0) {
    for (const leaf of alternatives(pending.pop())) {
      if (isTranslation(leaf)) return true;
      if (leaf.type === 'BinaryExpression' && leaf.operator === '+') {
        pending.push(leaf.left, leaf.right);
      }
    }
  }
  return false;
}

/** True when an expression between two tags can put text on screen (header, "side by side"). */
function canRenderText(expression) {
  const inner = unwrap(expression);
  switch (inner.type) {
    case 'JSXEmptyExpression':
    case 'JSXElement':
    case 'JSXFragment':
      return false;
    case 'Literal':
      if (typeof inner.value === 'string') return inner.value.trim() !== '';
      return inner.value !== null && typeof inner.value !== 'boolean';
    case 'TemplateLiteral':
      return (
        inner.expressions.length > 0 ||
        inner.quasis.some((quasi) => (quasi.value.cooked ?? '').trim() !== '')
      );
    case 'Identifier':
      return inner.name !== 'undefined';
    case 'ConditionalExpression':
      return canRenderText(inner.consequent) || canRenderText(inner.alternate);
    case 'LogicalExpression':
      if (inner.operator === '&&') return canRenderText(inner.right);
      return canRenderText(inner.left) || canRenderText(inner.right);
    default:
      return true;
  }
}

/** True when a JSX child is a part of the sentence its parent renders. */
function isSentencePart(child) {
  if (child.type === 'JSXText') return /\S/.test(child.value);
  return child.type === 'JSXExpressionContainer' && canRenderText(child.expression);
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-8',
  description:
    'Bans joining a translation call to anything in apps/mobile/src; interpolate within one key',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    concatenated:
      'A translated fragment is joined with {{how}} to build a sentence — use one key with interpolation, because a fixed order of parts breaks right-to-left layout and Arabic grammar',
    sideBySide:
      'A translated fragment sits beside other text or values in one element — put the punctuation, the values and their order inside the translation with interpolation, because a fixed order of parts breaks right-to-left layout and Arabic grammar',
  },
  create(context) {
    if (mobileFile(context.filename) === null) return {};

    function report(node, how) {
      context.report({ node, messageId: 'concatenated', data: { how } });
    }

    function checkChildren(node) {
      const parts = node.children.filter(isSentencePart);
      if (parts.length < 2) return;
      const translated = parts.find(
        (part) => part.type === 'JSXExpressionContainer' && carriesTranslation(part.expression),
      );
      if (translated !== undefined) context.report({ node: translated, messageId: 'sideBySide' });
    }

    return {
      JSXElement: checkChildren,
      JSXFragment: checkChildren,
      BinaryExpression(node) {
        if (node.operator !== '+') return;
        // The outermost `+` of a chain speaks for the chain.
        const parent = wrapped(node).parent;
        if (parent.type === 'BinaryExpression' && parent.operator === '+') return;
        if (carriesTranslation(node)) report(node, '"+"');
      },
      AssignmentExpression(node) {
        if (node.operator !== '+=') return;
        if (carriesTranslation(node.right)) report(node, '"+="');
      },
      TemplateLiteral(node) {
        if (!node.expressions.some(carriesTranslation)) return;
        const hasText = node.quasis.some((quasi) => quasi.value.raw !== '');
        if (node.expressions.length > 1 || hasText) report(node, 'a template literal');
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') return;
        const method = propertyName(callee);
        const receiver = unwrap(callee.object);

        if (method === 'join') {
          if (receiver.type !== 'ArrayExpression' || receiver.elements.length < 2) return;
          const joined = receiver.elements.some(
            (element) => element !== null && carriesTranslation(element),
          );
          if (joined) report(node, '".join()"');
          return;
        }

        if (method !== 'concat') return;
        const receiverIsList = receiver.type === 'ArrayExpression';
        if (
          carriesTranslation(receiver) ||
          (!receiverIsList && node.arguments.some(carriesTranslation))
        ) {
          report(node, '".concat()"');
        }
      },
    };
  },
});
