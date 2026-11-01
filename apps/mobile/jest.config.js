// The phone's render and unit tests (B6; owner's decision 2026-10-19: Jest with jest-expo and
// React Native Testing Library, the toolchain Expo documents, for `apps/mobile` only; the rest of
// the repository stays on Vitest). Run with `pnpm --filter @ijazah/mobile test`.
//
// The repository installs with pnpm's strict, non-hoisted layout (`.npmrc`, research R-1), where a
// package sees only what it declares. jest-expo's setup and React Native's Jest preset require
// packages that a hoisted install would put beside them (`expo-modules-core`, `@babel/runtime`,
// and `react-native-css-interop`, whose JSX runtime NativeWind's Babel preset writes into every
// file), so the test run, and nothing the app ships, also looks in the folders that hold the
// dependencies of `expo`, `react-native` and `nativewind` themselves.
const { realpathSync } = require('node:fs');
const path = require('node:path');

/** The folder that holds a package and its own dependencies in pnpm's virtual store. */
function siblingsOf(name) {
  return path.dirname(path.dirname(realpathSync(require.resolve(`${name}/package.json`))));
}

/** Packages shipped untranspiled, which Babel must compile for the test run. */
const transpiled = [
  '(jest-)?react-native',
  '@react-native(-community)?',
  'expo(nent)?',
  '@expo(nent)?/.*',
  'react-navigation',
  '@react-navigation/.*',
  'react-native-svg',
  'lucide-react-native',
  'nativewind',
  'react-native-css-interop',
  '@formatjs/.*',
  'intl-messageformat',
  'standard-navigation',
];

module.exports = {
  preset: 'jest-expo',
  modulePaths: [
    path.join(__dirname, 'node_modules'),
    siblingsOf('expo'),
    siblingsOf('react-native'),
    siblingsOf('nativewind'),
  ],
  // lucide-react-native publishes an ES module (`.mjs`) under the `react-native` condition, which
  // the preset's transform does not read; the test run takes its CommonJS build instead.
  moduleNameMapper: {
    '^lucide-react-native$': require.resolve('lucide-react-native', { paths: [__dirname] }),
  },
  // T138: the native modules every spec needs mocked (NetInfo).
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.spec.ts?(x)'],
  transformIgnorePatterns: [
    `node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(${transpiled.join('|')}))`,
  ],
};
