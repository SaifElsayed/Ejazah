// mobile/no-physical-direction  ->  R-MOBILE-5  (fast)
//
// R-MOBILE-5: never use a directional utility — `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`,
// `right-*`, `text-left`, `text-right`. Logical only: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`,
// `end-*`, `text-start`, `text-end`. The application is Arabic-first and every screen renders in
// both directions; a physical side pins a layout to one script, and the bug shows up only on the
// other one (FR-006). Icon flipping is R-MOBILE-14 and is reviewed, not linted.
//
// WHERE (T037): every file under `apps/mobile/src/features`, the constitution's own scope
// ("class-name regex ban in `features/**`"). `design/` composes the primitives and `lib/direction.ts`
// is where a direction is resolved on purpose, so neither is read.
//
// WHAT IS READ (T037): every string literal and template chunk in the file, not only a `className`
// attribute, because class lists are as often assembled in a `cn(...)` call or an array as written
// inline. A string is split into class tokens on whitespace; a token is stripped of its variant
// prefixes (`md:`, `hover:`, `rtl:`) and of a leading `-` (a negative margin) before it is compared,
// so `-ml-2` and `md:hover:pl-4` are refused with `ml-2`. The constitution lists eight families;
// `border-l-*`, `border-r-*`, `rounded-l-*`, `rounded-r-*`, `rounded-tl-*`, `rounded-tr-*`,
// `rounded-bl-*`, `rounded-br-*`, `scroll-ml-*`, `scroll-mr-*`, `scroll-pl-*`, `scroll-pr-*`,
// `float-left`, `float-right`, `clear-left` and `clear-right` are the same prohibition on a
// different property and are refused with them; each has a logical spelling (`border-s-*`,
// `rounded-s-*`, `float-start`).
//
// The same prohibition in a React Native style object is `marginLeft`, `paddingRight`, `left`,
// `right`, `borderLeftWidth`, `borderTopRightRadius` (the exact style keys React Native defines, so
// a domain object's `leftArrow` or `RightPanel` is not read as a style) and `textAlign: 'left'`,
// whose logical forms
// are `marginStart`, `paddingEnd`, `start`, `end`, `borderStartWidth`, `borderTopEndRadius` and
// `textAlign: 'start'`. A style key or a `textAlign` value naming a physical side is refused too,
// so moving from class names to a style object is not a way around the rule.
//
// A user-facing string in a feature is R-MOBILE-7's problem, so a sentence that happens to contain
// `right-hand` is not the false positive it would be elsewhere: it is already refused as a literal.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');

const FEATURES_TREE = 'apps/mobile/src/features';

// A class token after variant prefixes and a leading minus are stripped.
const PHYSICAL_CLASS =
  /^(?:(?:m|p|scroll-m|scroll-p)[lr]-\S+|border-[lr](?:-\S+)?|rounded-[tb]?[lr](?:-\S+)?|(?:left|right)-\S+|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right))$/;

// The logical spelling for each refused family, quoted in the message.
const LOGICAL_HINTS = [
  [/^m[lr]-/, 'ms-* / me-*'],
  [/^p[lr]-/, 'ps-* / pe-*'],
  [/^scroll-m[lr]-/, 'scroll-ms-* / scroll-me-*'],
  [/^scroll-p[lr]-/, 'scroll-ps-* / scroll-pe-*'],
  [/^border-/, 'border-s-* / border-e-*'],
  [/^rounded-/, 'rounded-s-* / rounded-e-* (rounded-ss-*, rounded-ee-* for a corner)'],
  [/^left-/, 'start-*'],
  [/^right-/, 'end-*'],
  [/^text-/, 'text-start / text-end'],
  [/^float-/, 'float-start / float-end'],
  [/^clear-/, 'clear-start / clear-end'],
];

// React Native style keys naming a physical side, with the logical key each should be.
const PHYSICAL_STYLE_KEY =
  /^(?:(?:margin|padding)(?:Left|Right)|border(?:Left|Right)(?:Width|Color|Style)?|border(?:Top|Bottom)(?:Left|Right)Radius|left|right)$/;

function classTokensOf(text) {
  return text.split(/\s+/).filter((token) => token !== '');
}

function stripVariants(token) {
  let stripped = token;
  for (;;) {
    const colon = stripped.indexOf(':');
    if (colon === -1) break;
    stripped = stripped.slice(colon + 1);
  }
  return stripped.startsWith('-') ? stripped.slice(1) : stripped;
}

function hintFor(token) {
  const found = LOGICAL_HINTS.find(([family]) => family.test(token));
  return found === undefined ? 'the logical equivalent' : found[1];
}

function logicalKeyFor(key) {
  return key
    .replace(/Left/g, 'Start')
    .replace(/Right/g, 'End')
    .replace(/^left$/, 'start')
    .replace(/^right$/, 'end');
}

function propertyName(key, computed) {
  if (computed) return key.type === 'Literal' && typeof key.value === 'string' ? key.value : null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-5',
  description:
    'Bans physical direction utilities and style keys in apps/mobile/src/features; logical ones only',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    className:
      '"{{token}}" pins the layout to one script — use {{logical}}, which follows the reading direction',
    styleKey:
      '"{{key}}" pins the layout to one script — use "{{logical}}", which follows the reading direction',
    textAlign:
      'textAlign "{{value}}" pins the text to one script — use "{{logical}}", which follows the reading direction',
  },
  create(context) {
    if (!isUnder(context.filename, FEATURES_TREE)) return {};

    function checkText(node, text) {
      for (const raw of classTokensOf(text)) {
        const token = stripVariants(raw);
        if (!PHYSICAL_CLASS.test(token)) continue;
        context.report({
          node,
          messageId: 'className',
          data: { token: raw, logical: hintFor(token) },
        });
        return;
      }
    }

    return {
      Literal: (node) => {
        if (typeof node.value === 'string') checkText(node, node.value);
      },
      TemplateElement: (node) => {
        checkText(node, node.value.cooked ?? node.value.raw);
      },
      Property: (node) => {
        const name = propertyName(node.key, node.computed);
        if (name === null) return;
        if (PHYSICAL_STYLE_KEY.test(name)) {
          context.report({
            node: node.key,
            messageId: 'styleKey',
            data: { key: name, logical: logicalKeyFor(name) },
          });
          return;
        }
        if (
          name === 'textAlign' &&
          node.value.type === 'Literal' &&
          (node.value.value === 'left' || node.value.value === 'right')
        ) {
          context.report({
            node: node.value,
            messageId: 'textAlign',
            data: {
              value: node.value.value,
              logical: node.value.value === 'left' ? 'start' : 'end',
            },
          });
        }
      },
    };
  },
});
