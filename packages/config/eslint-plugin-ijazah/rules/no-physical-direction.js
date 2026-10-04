// mobile/no-physical-direction  ->  R-MOBILE-5  (fast)
//
// R-MOBILE-5: never use directional utilities — `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`,
// `right-*`, `text-left`, `text-right`. Logical only: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`,
// `end-*`, `text-start`, `text-end`. The application is Arabic-first, so "left" is the trailing
// edge for most of its users; a physical direction pins a layout to one script, and two weeks of
// it is a rewrite of every screen (ARCHITECTURE §6.4, FR-006).
//
// DECISION (T037) — where it applies. The rule sentence carries no folder and its enforcement
// cell says "class-name regex ban in `features/**`". Every file under `apps/mobile/src` is read,
// `design/` included: a primitive that pins a margin to the left breaks every feature composing
// it, which is the worst place for the mistake, and the sentence itself exempts nothing.
//
// WHAT IS REFUSED
//
//   classes  the constitution's eight, in any string literal or template literal text, with
//            their variants (`md:ml-4`, `rtl:pr-2`), the important mark (`!ml-4`) and the
//            negative form (`-ml-4`). A token is read as a class only when what follows the dash
//            is a real Tailwind value: a number (`4`, `0.5`), a fraction (`1/2`), `px`, `auto`,
//            `full`, `screen`, or an arbitrary value in brackets or parentheses. `left-arrow`
//            and `right-aligned-icon` are names, not classes, and stay legal.
//   styles   the same eight written as style keys or JSX props: `marginLeft`, `marginRight`,
//            `paddingLeft`, `paddingRight` with any value; `left` and `right` when the value is a
//            number or a string, read through a conditional, `??`, a minus sign and the
//            TypeScript wrappers; `textAlign` when a value it can take is `'left'` or `'right'`,
//            so `textAlign: 'left' as const` is refused.
//
// WHAT IS NOT REFUSED, and is review's. Physical utilities the constitution's list does not name
// (`rounded-l-*`, `border-r-*`, `float-left`): adding them is an amendment to R-MOBILE-5, not a
// decision for a rule. A class assembled at run time from a template (`ml-` followed by `${n}`).
// `left: someVariable`, because `{ left, right }` is also how a pair of operands is spelled and
// this rule runs without types. A directional icon flipped by hand is R-MOBILE-14, review-only.
//
// The file is matched by path segments, never by a root-anchored path (note under T035).
const { defineRule } = require('../rule');
const { mobileFile } = require('../mobile');
const { alternatives, keyName } = require('../syntax');

// Physical utility prefix -> the logical one the constitution names for it.
const LOGICAL_CLASS = {
  ml: 'ms',
  mr: 'me',
  pl: 'ps',
  pr: 'pe',
  left: 'start',
  right: 'end',
};
const TEXT_ALIGN_CLASS = { 'text-left': 'text-start', 'text-right': 'text-end' };

// What may follow the dash in a real Tailwind spacing or inset utility.
const TAILWIND_VALUE = /^(?:\d+(?:\.\d+)?|\d+\/\d+|px|auto|full|screen|\[.+\]|\(.+\))$/;

// Style keys that are physical whatever their value.
const LOGICAL_KEY = {
  marginLeft: 'marginStart',
  marginRight: 'marginEnd',
  paddingLeft: 'paddingStart',
  paddingRight: 'paddingEnd',
};
// Style keys that are physical only when they hold a position, not a pair of operands.
const INSET_KEY = { left: 'start', right: 'end' };
const TEXT_ALIGN_VALUE = { left: 'start', right: 'end' };

/** The utility of a class token, with its variants, `!` and leading minus removed. */
function utilityOf(token) {
  const bracket = token.search(/[[(]/);
  const head = bracket === -1 ? token : token.slice(0, bracket);
  let utility = token.slice(head.lastIndexOf(':') + 1);
  if (utility.startsWith('!')) utility = utility.slice(1);
  if (utility.endsWith('!')) utility = utility.slice(0, -1);
  if (utility.startsWith('-')) utility = utility.slice(1);
  return utility;
}

/** `{ found, logical }` for the first physical class in a string, or null. */
function physicalClassIn(text) {
  for (const token of text.split(/\s+/)) {
    if (token === '') continue;
    const utility = utilityOf(token);

    if (Object.hasOwn(TEXT_ALIGN_CLASS, utility)) {
      return { found: token, logical: TEXT_ALIGN_CLASS[utility] };
    }

    const dash = utility.indexOf('-');
    if (dash === -1) continue;
    const prefix = utility.slice(0, dash);
    if (!Object.hasOwn(LOGICAL_CLASS, prefix)) continue;
    const value = utility.slice(dash + 1);
    if (!TAILWIND_VALUE.test(value)) continue;
    return { found: token, logical: `${LOGICAL_CLASS[prefix]}-${value}` };
  }
  return null;
}

function isPositionLiteral(leaf) {
  const value =
    leaf.type === 'UnaryExpression' && (leaf.operator === '-' || leaf.operator === '+')
      ? leaf.argument
      : leaf;
  return (
    value.type === 'Literal' && (typeof value.value === 'number' || typeof value.value === 'string')
  );
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-5',
  description:
    'Bans physical direction utilities and style keys in apps/mobile/src; logical ones only',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    physicalClass:
      '"{{found}}" is a physical direction — write "{{logical}}", because left is the trailing edge in Arabic and a physical utility pins the layout to one script',
    physicalStyle:
      '"{{found}}" is a physical direction — write "{{logical}}", because left is the trailing edge in Arabic and a physical style pins the layout to one script',
  },
  create(context) {
    if (mobileFile(context.filename) === null) return {};

    function checkText(node, text) {
      if (typeof text !== 'string' || text === '') return;
      const physical = physicalClassIn(text);
      if (physical !== null) context.report({ node, messageId: 'physicalClass', data: physical });
    }

    function checkStyle(node, name, valueNode) {
      if (typeof name !== 'string') return;

      if (Object.hasOwn(LOGICAL_KEY, name)) {
        context.report({
          node,
          messageId: 'physicalStyle',
          data: { found: name, logical: LOGICAL_KEY[name] },
        });
        return;
      }
      if (valueNode === null || valueNode === undefined) return;
      const leaves = alternatives(valueNode);

      if (Object.hasOwn(INSET_KEY, name) && leaves.some(isPositionLiteral)) {
        context.report({
          node,
          messageId: 'physicalStyle',
          data: { found: name, logical: INSET_KEY[name] },
        });
        return;
      }

      if (name !== 'textAlign') return;
      const physical = leaves.find(
        (leaf) =>
          leaf.type === 'Literal' &&
          typeof leaf.value === 'string' &&
          Object.hasOwn(TEXT_ALIGN_VALUE, leaf.value),
      );
      if (physical === undefined) return;
      context.report({
        node: physical,
        messageId: 'physicalStyle',
        data: {
          found: `textAlign: '${physical.value}'`,
          logical: `textAlign: '${TEXT_ALIGN_VALUE[physical.value]}'`,
        },
      });
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkText(node, node.value);
      },
      TemplateElement(node) {
        checkText(node, node.value.cooked);
      },
      Property(node) {
        if (node.parent.type !== 'ObjectExpression') return;
        checkStyle(node.key, keyName(node), node.value);
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const value =
          node.value !== null && node.value.type === 'JSXExpressionContainer'
            ? node.value.expression
            : node.value;
        if (value !== null && value.type === 'JSXEmptyExpression') return;
        checkStyle(node.name, node.name.name, value);
      },
    };
  },
});
