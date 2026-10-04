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
//
// WHAT IS NOT REFUSED: `t('a')` alone; a template literal that is only the call; and a call given
// its values, `t('greeting', { name })`, which is the form the rule asks for.
//
// WHAT IS NOT SEEN, and is review's. A fragment stored first and joined later
// (`const hello = t('a'); hello + name`), and a translation function imported under another name
// (`import { t as tr }`): following a value or an alias needs the program this fast rule does not
// have (research R-10). Two `<Text>` elements placed side by side to form one sentence.
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

module.exports = defineRule({
  constitutionId: 'R-MOBILE-8',
  description:
    'Bans joining a translation call to anything in apps/mobile/src; interpolate within one key',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    concatenated:
      'A translated fragment is joined with {{how}} to build a sentence — use one key with interpolation, because a fixed order of parts breaks right-to-left layout and Arabic grammar',
  },
  create(context) {
    if (mobileFile(context.filename) === null) return {};

    function report(node, how) {
      context.report({ node, messageId: 'concatenated', data: { how } });
    }

    return {
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
