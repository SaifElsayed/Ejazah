// mobile/no-raw-color  ->  R-MOBILE-4  (fast)
//
// R-MOBILE-4: never write a raw hex colour, rgb value or numeric spacing in a feature file. Tokens
// only. Colour, spacing, radii and typography have one source, `apps/mobile/src/design/tokens.ts`
// (ARCHITECTURE §6.3, ADR 0002), and a literal in a feature is a second source of truth that
// drifts the first time the design changes (FR-006).
//
// WHERE (T037): every file under `apps/mobile/src` that is not under `apps/mobile/src/design`,
// which is the constitution's own scope ("outside `design/`"). The route files under `app/` and
// the shared `lib/` are as much feature code as `features/**` for this purpose: a colour written
// in a layout file is the same second source of truth. `design/` is the one folder where a value
// may be written, because it is where the token is defined.
//
// WHAT IS A COLOUR (T037): a string carrying `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` as a whole
// token — the regex the constitution names, bounded so `#1` in prose and an i18n key like
// `student.home#3` are not colours — or a `rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`, `lab(`,
// `lch(`, `oklab(`, `oklch(` or `color(` functional notation. A Tailwind arbitrary value is the
// same literal in square brackets, so `bg-[#0f766e]` and `text-[rgb(15,118,110)]` are refused by
// the same test; a named colour (`red`, `slate-500`) is a token or a class, not a literal, and
// is legal.
//
// WHAT IS RAW SPACING (T037): a numeric literal as the value of a spacing property in a style
// object — margin, padding, gap, inset and the position offsets, in every React Native spelling
// (`marginTop`, `paddingHorizontal`, `columnGap`, `start`) — and a Tailwind arbitrary spacing
// value such as `p-[12px]`, `mt-[8]` or `gap-[1.5rem]`. Zero is not a spacing value: `margin: 0`
// removes spacing rather than choosing an amount, and a token for "none" would be a token for
// nothing. A negative literal is read through its unary minus. Width, height, radii and font
// sizes are also token-carried values but are not "spacing" and are left to review here, so a
// measured width for an image is not a build error; the header of `design/tokens.ts` is where
// that scope would widen.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');

const MOBILE_TREE = 'apps/mobile/src';
const DESIGN_TREE = 'apps/mobile/src/design';

// A whole hex token: 3, 4, 6 or 8 hex digits after `#`, not followed by another word character.
const HEX_COLOR = /(^|[^\w&])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i;
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

// `p-[12px]`, `-mt-[8]`, `gap-x-[1.5rem]`, `inset-[4px]`: a spacing utility with an arbitrary
// value. A colour utility with an arbitrary value is caught by the colour test above.
const ARBITRARY_SPACING =
  /(?:^|\s|:)-?(?:[mp][xytrblse]?|gap(?:-[xy])?|inset(?:-[xy])?|space-[xy]|top|bottom|left|right|start|end)-\[[^\]]*\d[^\]]*\]/;

const SPACING_PROPERTIES = new Set([
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginStart',
  'marginEnd',
  'marginHorizontal',
  'marginVertical',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingStart',
  'paddingEnd',
  'paddingHorizontal',
  'paddingVertical',
  'paddingBlock',
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInline',
  'paddingInlineStart',
  'paddingInlineEnd',
  'gap',
  'rowGap',
  'columnGap',
  'inset',
  'insetBlock',
  'insetBlockStart',
  'insetBlockEnd',
  'insetInline',
  'insetInlineStart',
  'insetInlineEnd',
  'top',
  'bottom',
  'left',
  'right',
  'start',
  'end',
]);

function propertyName(key, computed) {
  if (computed) return key.type === 'Literal' && typeof key.value === 'string' ? key.value : null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

/** A numeric literal, with or without a unary minus, other than zero. */
function nonZeroNumber(node) {
  let value = node;
  if (value.type === 'UnaryExpression' && value.operator === '-') value = value.argument;
  if (value.type !== 'Literal' || typeof value.value !== 'number') return null;
  return value.value === 0 ? null : value;
}

function colourIn(text) {
  const hex = HEX_COLOR.exec(text);
  if (hex !== null) return hex[0].replace(/^[^#]/, '');
  const functional = FUNCTIONAL_COLOR.exec(text);
  if (functional !== null) return functional[0];
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-4',
  description:
    'Bans raw hex, rgb and functional colour literals and numeric spacing values in apps/mobile outside design/',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    color:
      '"{{value}}" is a raw colour — colour lives in design/tokens.ts and reaches a feature as a token, never as a literal',
    spacing:
      '"{{property}}: {{value}}" is raw spacing — spacing lives in design/tokens.ts and reaches a feature as a token, never as a literal',
    arbitrarySpacing:
      '"{{value}}" is a raw spacing value in a class name — spacing lives in design/tokens.ts and reaches a feature as a token, never as a literal',
  },
  create(context) {
    if (!isUnder(context.filename, MOBILE_TREE)) return {};
    if (isUnder(context.filename, DESIGN_TREE)) return {};

    function checkText(node, text) {
      const colour = colourIn(text);
      if (colour !== null) {
        context.report({ node, messageId: 'color', data: { value: colour } });
        return;
      }
      const spacing = ARBITRARY_SPACING.exec(text);
      if (spacing !== null) {
        context.report({
          node,
          messageId: 'arbitrarySpacing',
          data: { value: spacing[0].trim().replace(/^:/, '') },
        });
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
        if (name === null || !SPACING_PROPERTIES.has(name)) return;
        const literal = nonZeroNumber(node.value);
        if (literal === null) return;
        context.report({
          node: node.value,
          messageId: 'spacing',
          data: { property: name, value: context.sourceCode.getText(node.value) },
        });
      },
    };
  },
});
