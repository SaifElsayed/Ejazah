// mobile/no-raw-color  ->  R-MOBILE-4  (fast)
//
// R-MOBILE-4: never write a raw hex colour, rgb value or numeric spacing in a feature file.
// Tokens only. Colour and spacing exist once, in `design/tokens.ts`, and reach every other file
// as a token; a literal anywhere else is a second source of truth, and changing the brand colour
// stops being one line (ARCHITECTURE §6.3, FR-006).
//
// DECISION (T037) — where it applies. The rule sentence says "in a feature file" and its
// enforcement cell says "outside `design/`"; ARCHITECTURE §6.3 says the same ("Lint bans hex
// colours and raw numeric spacing outside `design/`"). The cell is the wider and the one a
// machine can hold, so every file under `apps/mobile/src` is read except those under `design/`:
// a colour in a route file under `app/` or in `lib/` is the same second source of truth.
//
// WHAT IS REFUSED
//
//   colour   a hex colour of three, four, six or eight digits, and `rgb(`, `rgba(`, `hsl(` or
//            `hsla(`, in any string literal or template literal text. The constitution's regex
//            names hex and rgb; hsl is the same value in another notation (decided here).
//   spacing  a number other than zero, or a string that is a number with an optional px, rem, em,
//            pt or dp unit, as the value of a margin, padding or gap style key or JSX prop
//            (`padding`, `marginTop`, `paddingHorizontal`, `gap`, `rowGap`, `columnGap`), read
//            through `cond ? 8 : 16`, `a ?? 8`, a minus sign and the TypeScript wrappers. After
//            `margin` or `padding` only a direction counts: `Top`, `Bottom`, `Left`, `Right`,
//            `Start`, `End`, `Horizontal`, `Vertical`, `Block`, `Inline`, `BlockStart`,
//            `BlockEnd`, `InlineStart` and `InlineEnd`; a name that merely starts with the word
//            (`paddingToken`, `marginOfError`) is not a spacing key (review of PR #29, N6). And a
//            Tailwind arbitrary spacing class (`p-[13px]`, `-mx-[7px]`, `gap-[3px]`), which is
//            the same raw number in class form. The scale classes (`p-4`) are tokens: the
//            Tailwind configuration consumes `tokens.ts`.
//
// A `#` IS A COLOUR ONLY WHERE A VALUE STANDS. It is read as one when the run is the whole
// literal, when it directly follows `[`, `(`, `,`, `:` or `=` (`bg-[#0f766e]`, `color:#fff`), or
// when it follows a space and the word before it is a number with a unit, another colour, a
// border style, a lower-case `property:` or ends in `,` or `(` (`1px solid #ccc`). A `#` after a
// `/` is a URL fragment or a deep link, and a `#` after any other word is prose ("Order #123");
// neither is refused.
//
// WHAT IS NOT REFUSED, and is review's. A named colour (`'red'`); a colour assembled at run time
// (`'#' + hex`); zero, which is no spacing; a percentage, which is a proportion and not a step of
// the scale; radii, font sizes and dimensions, which the constitution's cell does not name; a
// spacing value held in a variable first, because this rule runs without types (research R-10).
//
// TWO RECORDED LIMITS (review of PR #29, N6). Spacing computed in place, `{ padding: 4 * 2 }`, is
// not a literal and is not read: the operands of an expression are not followed. A colour written
// as text between two tags, `<Text>#fff</Text>`, is JSX text, not a string literal, and is not
// read either; as soon as such text carries a letter it is a hardcoded string, which R-MOBILE-7
// refuses.
//
// COST ON A VERY LONG STRING (review of PR #29, N5). For every `#` run of a colour's length that
// follows a space, the text before it is trimmed and split again, so one literal holding many
// thousands of such runs costs time that grows with the square of its length. Source written by
// hand holds no such literal, so this is recorded rather than rewritten.
//
// The file is matched by path segments, never by a root-anchored path (note under T035); the
// reading of the mobile tree is shared with the other `mobile/*` rules in `../mobile.js`.
const { defineRule } = require('../rule');
const { mobileFile } = require('../mobile');
const { alternatives, keyName } = require('../syntax');

const HEX_RUN = /#[0-9a-fA-F]+/g;
const HEX_LENGTHS = new Set([3, 4, 6, 8]);
const HEX_COLOR = /^#[0-9a-fA-F]+$/;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?)\(/i;

// A character a value directly follows inside a class or a declaration.
const VALUE_OPENERS = new Set(['[', '(', ',', ':', '=']);
const NUMBER_WITH_UNIT = /^-?(?:\d+(?:\.\d+)?|\.\d+)[a-z%]*$/;
const CSS_PROPERTY = /^[a-z-]+:$/;
const BORDER_STYLES = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'inset',
  'outset',
  'groove',
  'ridge',
]);

// After `margin` or `padding`, only a direction makes a spacing key (N6).
const SPACING_KEY =
  /^(?:margin|padding)(?:Top|Bottom|Left|Right|Start|End|Horizontal|Vertical|Block(?:Start|End)?|Inline(?:Start|End)?)?$/;
const GAP_KEYS = new Set(['gap', 'rowGap', 'columnGap']);
const SPACING_STRING = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|pt|dp)?$/;
const ARBITRARY_SPACING = /^(?:[mp][trblxyse]?|gap|gap-[xy]|space-[xy])-\[/;

function isHexColor(run) {
  return HEX_COLOR.test(run) && HEX_LENGTHS.has(run.length - 1);
}

/** True when the word before a space-separated `#` run reads as part of a style value. */
function isValueWord(word) {
  if (word === undefined || word === '') return false;
  if (isHexColor(word) || NUMBER_WITH_UNIT.test(word) || CSS_PROPERTY.test(word)) return true;
  if (BORDER_STYLES.has(word)) return true;
  return word.endsWith(',') || word.endsWith('(');
}

/** The first hex colour standing where a value stands, or null. */
function hexColorIn(text) {
  for (const match of text.matchAll(HEX_RUN)) {
    const run = match[0];
    if (!HEX_LENGTHS.has(run.length - 1)) continue;

    const next = text[match.index + run.length];
    if (next !== undefined && /[\w-]/.test(next)) continue;

    const before = text.slice(0, match.index);
    if (before.trim() === '') return run;

    const previous = before.at(-1);
    if (VALUE_OPENERS.has(previous)) return run;
    if (!/\s/.test(previous)) continue;

    const words = before.trim().split(/\s+/);
    if (isValueWord(words.at(-1))) return run;
  }
  return null;
}

/** The utility of a class token, with its variants, `!` and leading minus removed. */
function utilityOf(token) {
  const bracket = token.indexOf('[');
  const head = bracket === -1 ? token : token.slice(0, bracket);
  let utility = token.slice(head.lastIndexOf(':') + 1);
  if (utility.startsWith('!')) utility = utility.slice(1);
  if (utility.startsWith('-')) utility = utility.slice(1);
  return utility;
}

function arbitrarySpacingIn(text) {
  return (
    text
      .split(/\s+/)
      .find((token) => token.includes('[') && ARBITRARY_SPACING.test(utilityOf(token))) ?? null
  );
}

function isSpacingKey(name) {
  return typeof name === 'string' && (SPACING_KEY.test(name) || GAP_KEYS.has(name));
}

/** The raw spacing an expression can evaluate to, as source text, or null. */
function rawSpacingOf(valueNode) {
  for (const leaf of alternatives(valueNode)) {
    let numeric = leaf;
    let sign = '';
    if (leaf.type === 'UnaryExpression' && (leaf.operator === '-' || leaf.operator === '+')) {
      numeric = leaf.argument;
      sign = leaf.operator === '-' ? '-' : '';
    }
    if (numeric.type !== 'Literal') continue;
    if (typeof numeric.value === 'number' && numeric.value !== 0) return `${sign}${numeric.value}`;
    if (
      typeof numeric.value === 'string' &&
      SPACING_STRING.test(numeric.value) &&
      Number.parseFloat(numeric.value) !== 0
    ) {
      return numeric.value;
    }
  }
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-4',
  description:
    'Bans raw hex, rgb and hsl colours and raw margin, padding and gap values in apps/mobile/src outside design/',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    rawColor:
      '"{{value}}" is a raw colour — take it from the design tokens, because a colour written outside design/ is a second source of truth',
    rawSpacing:
      '"{{value}}" is raw spacing on "{{name}}" — take the step from the design tokens, because a number written outside design/ is a second scale',
    arbitrarySpacing:
      '"{{value}}" is raw spacing in a class — use a step of the scale, which the Tailwind configuration takes from the design tokens',
  },
  create(context) {
    const file = mobileFile(context.filename);
    if (file === null || file.area === 'design') return {};

    function checkText(node, text) {
      if (typeof text !== 'string' || text === '') return;

      const hex = hexColorIn(text);
      const fn = hex === null ? COLOR_FUNCTION.exec(text) : null;
      if (hex !== null) {
        context.report({ node, messageId: 'rawColor', data: { value: hex } });
      } else if (fn !== null) {
        context.report({ node, messageId: 'rawColor', data: { value: fn[0] } });
      }

      const arbitrary = arbitrarySpacingIn(text);
      if (arbitrary !== null) {
        context.report({ node, messageId: 'arbitrarySpacing', data: { value: arbitrary } });
      }
    }

    function checkSpacing(name, valueNode) {
      if (!isSpacingKey(name) || valueNode === null || valueNode === undefined) return;
      const raw = rawSpacingOf(valueNode);
      if (raw === null) return;
      context.report({ node: valueNode, messageId: 'rawSpacing', data: { value: raw, name } });
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
        checkSpacing(keyName(node), node.value);
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.value === null) return;
        const value =
          node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        if (value.type === 'JSXEmptyExpression') return;
        checkSpacing(node.name.name, value);
      },
    };
  },
});
