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
//   Metro reads the source. Only files under `packages/*/src` are rewritten.
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const nativewind = path.dirname(require.resolve('nativewind/package.json'));
const cssInterop = path.dirname(
  require.resolve('react-native-css-interop/package.json', { paths: [nativewind] }),
);

const config = getDefaultConfig(__dirname);
config.resolver.unstable_conditionNames = [
  '@ijazah/source',
  ...(config.resolver.unstable_conditionNames ?? []),
];
const WORKSPACE_SOURCE = /\/packages\/[^/]+\/src\//;
const JS_EXTENSION = /\.js$/;
const resolveDefault = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveDefault ?? context.resolveRequest;
  const origin = context.originModulePath.split(path.sep).join('/');
  if (
    moduleName.startsWith('.') &&
    JS_EXTENSION.test(moduleName) &&
    WORKSPACE_SOURCE.test(origin)
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
