// mobile/no-translated-concat  ->  R-MOBILE-8  (fast)
//
// R-MOBILE-8: never concatenate translated fragments to build a sentence. Use interpolation within
// one key. Concatenation fixes the order of the parts in code, and word order is exactly what
// Arabic grammar and right-to-left rendering need to be free to change; one key with `{{name}}` in
// it lets each language put the name where it belongs (FR-006). The constitution calls the lint
// mechanism a heuristic — "string `+` with i18n calls" — and names review as the second net.
//
// WHERE (T038): every file under `apps/mobile/src`, the same scope as `mobile/no-literal-string`:
// a sentence is assembled wherever a screen's text is prepared, which is as often a hook in
// `features/**` as the render itself.
//
// WHAT IS A TRANSLATION (T038): a call whose callee is `t` or ends in `.t` — `t('key')`,
// `i18n.t('key')`, `useTranslation().t('key')` — the shape `apps/mobile/src/i18n/index.ts` exports
// and the one every i18n library settles on. A helper of one's own that wraps `t()` is not
// recognised by syntax, which is what the constitution's "heuristic" and its review mechanism
// already allow for.
//
// WHAT IS CONCATENATION (T038): a translation as an operand of `+` or `+=`, at any depth of a
// chain of `+` — `t('a') + t('b')`, `t('a') + ' ' + name`, `label += t('suffix')`; a translation
// as an expression inside a template literal that carries anything else — `${t('hello')} ${name}`
// (a template holding a single translation and nothing but whitespace around it is a wrapper, not
// a sentence); and a translation inside an array that is joined — `[t('a'), t('b')].join(' ')`.
// Each is one sentence built from parts, and each has the same fix: one key, with interpolation.
//
// A translation whose argument is itself concatenated (`t('teacher.' + kind)`) is a dynamic key,
// which is a different problem — the parity check cannot see it — and is not this rule's.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');

const MOBILE_TREE = 'apps/mobile/src';

function isTranslationCall(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') return callee.name === 't';
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 't'
  );
}

/** The leaves of a `+` chain, so `t('a') + ' ' + name` is read as three operands. */
function operandsOf(node) {
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [...operandsOf(node.left), ...operandsOf(node.right)];
  }
  return [node];
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-8',
  description: 'Bans building a sentence by concatenating translated fragments in apps/mobile',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    concatenation:
      'a translation is concatenated into a sentence — word order belongs to each language, so use one key with interpolation instead of joining fragments',
    template:
      'a translation is interpolated into a template with other text — word order belongs to each language, so use one key with interpolation instead of joining fragments',
    joined:
      'translations are joined into a sentence — word order belongs to each language, so use one key with interpolation instead of joining fragments',
  },
  create(context) {
    if (!isUnder(context.filename, MOBILE_TREE)) return {};

    return {
      BinaryExpression: (node) => {
        if (node.operator !== '+') return;
        // Report the outermost `+` of a chain once, not every nested `+` inside it, and let the
        // `+=` visitor own a chain that is its right-hand side.
        if (node.parent.type === 'BinaryExpression' && node.parent.operator === '+') return;
        if (node.parent.type === 'AssignmentExpression' && node.parent.operator === '+=') return;
        if (!operandsOf(node).some(isTranslationCall)) return;
        context.report({ node, messageId: 'concatenation' });
      },
      AssignmentExpression: (node) => {
        if (node.operator !== '+=') return;
        if (!operandsOf(node.right).some(isTranslationCall)) return;
        context.report({ node, messageId: 'concatenation' });
      },
      TemplateLiteral: (node) => {
        const translations = node.expressions.filter(isTranslationCall);
        if (translations.length === 0) return;
        const otherExpressions = node.expressions.length - translations.length;
        const text = node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
        // A lone translation wrapped in a template is a wrapper, not a sentence.
        if (translations.length === 1 && otherExpressions === 0 && text.trim() === '') return;
        context.report({ node, messageId: 'template' });
      },
      CallExpression: (node) => {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'join' ||
          callee.object.type !== 'ArrayExpression'
        ) {
          return;
        }
        if (
          !callee.object.elements.some((element) => element !== null && isTranslationCall(element))
        ) {
          return;
        }
        context.report({ node, messageId: 'joined' });
      },
    };
  },
});
