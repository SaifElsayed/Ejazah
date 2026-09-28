// mobile/no-insecure-storage (R-MOBILE-10) against a table of code (T039).
//
// The rule is an import ban on the plain store, confined to one layer. The fixture proves the
// canonical default import from a feature; this table proves the spellings that walk around it —
// the package's subpaths, the two type-only forms, `require`, `export from`, the dynamic import and
// the legacy `AsyncStorage` export of `react-native` — and the three path decisions the header
// records: the storage layer is exempt whether it is the file `lib/storage.ts` or the folder
// `lib/storage/`, the scaffold's `lib/secure-storage.ts` is not that layer and is refused, and the
// route tree under `app/` and `design/` are held to the same line as `features/`.
//
// What is deliberately not refused has a row too: `expo-secure-store` outside the layer is the
// right store reached the wrong way and is review's, not this rule's.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/student/session-token.ts';
const storageFile = 'apps/mobile/src/lib/storage.ts';
const storageFolder = 'apps/mobile/src/lib/storage/index.ts';
const scaffoldName = 'apps/mobile/src/lib/secure-storage.ts';
const route = 'apps/mobile/src/app/(student)/index.tsx';
const design = 'apps/mobile/src/design/theme-preference.ts';

const asyncStorage = '@react-native-async-storage/async-storage';

typescriptRuleTester().run('mobile/no-insecure-storage', loadRule('no-insecure-storage.js'), {
  valid: [
    {
      name: 'the storage layer written as a file, which wraps the plain store',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: storageFile,
    },
    {
      name: 'the storage layer grown into a folder',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: storageFolder,
    },
    {
      name: 'a file beside the layer’s index, inside the folder',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/storage/keys.ts',
    },
    {
      name: 'a feature asking the storage layer instead',
      code: "import { storage } from '@/lib/storage';\nexport const s = storage;",
      filename: feature,
    },
    {
      name: 'the secure store outside the layer, which is review’s matter and not this rule’s',
      code: "import * as SecureStore from 'expo-secure-store';\nexport const s = SecureStore;",
      filename: feature,
    },
    {
      name: 'another export of react-native, which is not the legacy store',
      code: "import { Platform } from 'react-native';\nexport const p = Platform;",
      filename: feature,
    },
    {
      name: 'a package whose name merely starts alike',
      code: `import { x } from '${asyncStorage}-extras';\nexport const y = x;`,
      filename: feature,
    },
    {
      name: 'a file outside apps/mobile, which the rule does not read',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: 'packages/contracts/src/storage-shape.ts',
    },
  ],
  invalid: [
    {
      name: 'the canonical package from a feature, the fixture’s spelling',
      code: `import AsyncStorage from '${asyncStorage}';\n\nexport async function rememberSessionToken(token: string): Promise<void> {\n  await AsyncStorage.setItem('session.token', token);\n}`,
      filename: feature,
      errors: [{ messageId: 'insecureStorage', data: { specifier: asyncStorage } }],
    },
    {
      name: 'a subpath of the package',
      code: `import mock from '${asyncStorage}/jest/async-storage-mock';\nexport const m = mock;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'a type-only import',
      code: `import type { AsyncStorageStatic } from '${asyncStorage}';\nexport type S = AsyncStorageStatic;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'a type-only import written as an import type node',
      code: `export type S = import('${asyncStorage}').AsyncStorageStatic;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'export from',
      code: `export { default as storage } from '${asyncStorage}';`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'a dynamic import',
      code: `export const load = () => import('${asyncStorage}');`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'require',
      code: `const AsyncStorage = require('${asyncStorage}');\nexport default AsyncStorage;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'import = require',
      code: `import AsyncStorage = require('${asyncStorage}');\nexport default AsyncStorage;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'the legacy export of react-native',
      code: "import { AsyncStorage } from 'react-native';\nexport const store = AsyncStorage;",
      filename: feature,
      errors: [{ messageId: 'insecureStorage', data: { specifier: 'react-native AsyncStorage' } }],
    },
    {
      name: 'the legacy export renamed on import',
      code: "import { AsyncStorage as Store } from 'react-native';\nexport const store = Store;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'the scaffold’s secure-storage.ts, which is not the layer the constitution names',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: scaffoldName,
      errors: 1,
    },
    {
      name: 'a route file, held to the same line as a feature',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: route,
      errors: 1,
    },
    {
      name: 'a design file, held to the same line as a feature',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: design,
      errors: 1,
    },
    {
      name: 'a lib file that is not the storage layer',
      code: `import AsyncStorage from '${asyncStorage}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/client.ts',
      errors: 1,
    },
  ],
});
