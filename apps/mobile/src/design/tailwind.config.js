// Consumes the generated token theme (ARCHITECTURE §6.3, ADR 0020). Never hardcodes a value.
// NativeWind makes the same config real in React Native. `tailwind.theme.json` is written from
// `packages/tokens/tokens.json` by `pnpm tokens:build`.
//
// T031: a colour class names a CSS variable, `--color-<token>`, never a value. `ThemeProvider`
// (design/theme.tsx) sets the variables of the scheme in force through NativeWind's `vars()`, so
// `bg-primary` is the light primary in light and the dark primary in dark from one class. The
// variables' names are the semantic tokens; `colorVariables` in theme.tsx writes the same names.
const path = require('node:path');

const theme = require('./tailwind.theme.json');

const colors = Object.fromEntries(
  Object.keys(theme.colors.light).map((name) => [name, `var(--color-${name})`]),
);

module.exports = {
  content: [path.join(__dirname, '..', '**', '*.{ts,tsx}')],
  presets: [require('nativewind/preset')],
  theme: {
    colors,
    spacing: theme.spacing,
    borderRadius: theme.borderRadius,
    borderWidth: theme.borderWidth,
    fontFamily: theme.fontFamily,
    fontWeight: theme.fontWeight,
    fontSize: theme.fontSize,
    boxShadow: theme.boxShadow,
    opacity: theme.opacity,
    transitionDuration: theme.transitionDuration,
    transitionTimingFunction: theme.transitionTimingFunction,
    extend: {
      width: { ...theme.size, ...theme.media, ...theme.iconSize },
      height: { ...theme.size, ...theme.media, ...theme.iconSize },
      minHeight: theme.size,
      strokeWidth: theme.strokeWidth,
    },
  },
  plugins: [],
};
