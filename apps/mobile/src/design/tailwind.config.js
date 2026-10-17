// Consumes the generated token theme (ARCHITECTURE §6.3, ADR 0020). Never hardcodes a value.
// NativeWind makes the same config real in React Native. `tailwind.theme.json` is written from
// `packages/tokens/tokens.json` by `pnpm tokens:build`; the light scheme is the default palette and
// the dark scheme is applied through the theme provider's CSS variables (design/theme.tsx).
const theme = require('./tailwind.theme.json');

module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    colors: theme.colors.light,
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
