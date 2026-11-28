// T031: Metro for the phone. Three additions to Expo's defaults:
// - `@ijazah/source`: the workspace packages (`@ijazah/contracts`) publish built JavaScript under
//   `dist/` and their TypeScript source under this export condition; Metro resolves the source,
//   as Vitest, Jest and `tsx` do, so the phone never needs a build of the package first (watch line
//   for B6 under T018).
// - NativeWind, reading the stylesheet that holds the Tailwind layers.
// - `react-native-css-interop` reachable from every file: NativeWind's Babel preset rewrites the
//   JSX of each module it compiles, React Native's own included, to import that runtime, and the
//   repository's strict, non-hoisted install (`.npmrc`, research R-1) shows a package only to what
//   declares it. The fallback is the copy NativeWind itself depends on.
// - A relative `./x.js` inside a workspace package's TypeScript source resolves to `./x.ts`: the
//   packages are written for Node's module resolution (NodeNext), which names the emitted file, and
//   Metro reads the source. Only files under this repository's `packages/*/src` are rewritten.
//
// R3 T183 (Q-5 (a)): the base is Sentry's, Expo's defaults with debug ids written into the bundle
// and its map, so the maps an EAS release build uploads resolve a crash report's stack; the
// resolver rules and NativeWind go on top of it, as on Expo's own before.
const path = require('node:path');

const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');

const nativewind = path.dirname(require.resolve('nativewind/package.json'));
const cssInterop = path.dirname(
  require.resolve('react-native-css-interop/package.json', { paths: [nativewind] }),
);

const config = getSentryExpoConfig(__dirname);
config.resolver.unstable_conditionNames = [
  '@ijazah/source',
  ...(config.resolver.unstable_conditionNames ?? []),
];
// Anchored at this repository's `packages/`, so a dependency laid out the same way under
// `node_modules` is never rewritten (review of B6, finding 14).
const packagesRoot = `${path.resolve(__dirname, '..', '..').split(path.sep).join('/')}/packages/`;
const WORKSPACE_SOURCE = /^[^/]+\/src\//;
const JS_EXTENSION = /\.js$/;
const resolveDefault = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveDefault ?? context.resolveRequest;
  const origin = context.originModulePath.split(path.sep).join('/');
  if (
    moduleName.startsWith('.') &&
    JS_EXTENSION.test(moduleName) &&
    origin.startsWith(packagesRoot) &&
    WORKSPACE_SOURCE.test(origin.slice(packagesRoot.length))
  ) {
    return resolve(context, moduleName.replace(JS_EXTENSION, '.ts'), platform);
  }
  return resolve(context, moduleName, platform);
};
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native-css-interop': cssInterop,
};

module.exports = withNativeWind(config, {
  input: './src/design/global.css',
  configPath: './src/design/tailwind.config.js',
});
