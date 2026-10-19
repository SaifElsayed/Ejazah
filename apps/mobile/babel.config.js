// T031: Expo's Babel preset with NativeWind's JSX runtime, so `className` on a React Native view
// becomes a style from `src/design/tailwind.config.js` (ADR 0020 D7). Jest reads the same file.
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
