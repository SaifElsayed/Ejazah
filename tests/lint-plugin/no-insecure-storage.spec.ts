// mobile/no-insecure-storage (R-MOBILE-10) against a table of code (T039).
//
// The fixture proves a default import of the package from a feature. This table proves the
// storage layer in both shapes it may take — one file, or a folder — and the second way plain
// AsyncStorage arrives: as the legacy export of `react-native`, by name, through a namespace or
// through `require`.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/student/session-token.ts';
const pkg = '@react-native-async-storage/async-storage';

typescriptRuleTester().run('mobile/no-insecure-storage', loadRule('no-insecure-storage.js'), {
  valid: [
    {
      name: 'the storage layer as one file',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/storage.ts',
    },
    {
      name: 'the storage layer as a platform-specific file',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/storage.native.ts',
    },
    {
      name: 'the storage layer as a folder',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/storage/index.ts',
    },
    {
      name: 'a file deeper inside the storage folder',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/storage/keys/preferences.ts',
    },
    {
      name: 'a feature asking the storage layer',
      code: "import { rememberLocale } from '../../lib/storage';\nexport const r = rememberLocale;",
      filename: feature,
    },
    {
      name: 'react-native without the legacy export',
      code: "import { View } from 'react-native';\nimport * as RN from 'react-native';\nexport const x = [View, RN.Text];",
      filename: feature,
    },
    {
      name: 'a package whose name merely starts alike',
      code: "import x from '@react-native-async-storage/async-storage-extras';\nexport default x;",
      filename: feature,
    },
    {
      name: 'a local of the same name',
      code: 'export const AsyncStorage = { ok: true };\nexport const y = AsyncStorage.ok;',
      filename: feature,
    },
    {
      name: 'a file outside the mobile application',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/admin/src/x.ts',
    },
  ],
  invalid: [
    {
      name: 'the fixture: a default import from a feature',
      code: `import AsyncStorage from '${pkg}';\nexport const set = (t: string) => AsyncStorage.setItem('session.token', t);`,
      filename: feature,
      errors: [{ messageId: 'plainStorage', data: { specifier: pkg } }],
    },
    {
      name: 'a file in lib/ beside the storage layer',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/client.ts',
      errors: 1,
    },
    {
      name: 'a file that only shares the layer’s name elsewhere',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/features/shared/storage.ts',
      errors: 1,
    },
    {
      name: 'a file whose name only starts like the layer',
      code: `import AsyncStorage from '${pkg}';\nexport const store = AsyncStorage;`,
      filename: 'apps/mobile/src/lib/storage-debug.ts',
      errors: 1,
    },
    {
      name: 'a subpath of the package',
      code: `import mock from '${pkg}/jest/async-storage-mock';\nexport default mock;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'the package under its former name',
      code: "import AsyncStorage from '@react-native-community/async-storage';\nexport default AsyncStorage;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a named hook of the package',
      code: `import { useAsyncStorage } from '${pkg}';\nexport const u = useAsyncStorage;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'a namespace import',
      code: `import * as Storage from '${pkg}';\nexport const s = Storage;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'a type-only import',
      code: `import type { AsyncStorageStatic } from '${pkg}';\nexport type S = AsyncStorageStatic;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'an inline type import',
      code: `export type S = import('${pkg}').AsyncStorageStatic;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'require',
      code: `const AsyncStorage = require('${pkg}');\nexport default AsyncStorage;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'import = require',
      code: `import AsyncStorage = require('${pkg}');\nexport default AsyncStorage;`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'a dynamic import',
      code: `export const load = () => import('${pkg}');`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'export from',
      code: `export { default } from '${pkg}';`,
      filename: feature,
      errors: 1,
    },
    {
      name: 'the legacy export of react-native, by name',
      code: "import { AsyncStorage } from 'react-native';\nexport const s = AsyncStorage;",
      filename: feature,
      errors: [{ messageId: 'legacyStorage', data: { source: 'react-native' } }],
    },
    {
      name: 'the legacy export, aliased',
      code: "import { AsyncStorage as Store } from 'react-native';\nexport const s = Store;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'the legacy export through a namespace',
      code: "import * as RN from 'react-native';\nexport const s = RN.AsyncStorage;",
      filename: feature,
      errors: [{ messageId: 'legacyStorage', data: { source: 'react-native' } }],
    },
    {
      name: 'the legacy export through a default binding, computed and optional',
      code: "import RN from 'react-native';\nexport const a = RN['AsyncStorage'];\nexport const b = RN?.AsyncStorage;",
      filename: feature,
      errors: 2,
    },
    {
      name: 'the legacy export destructured off the namespace',
      code: "import * as RN from 'react-native';\nconst { AsyncStorage } = RN;\nexport const s = AsyncStorage;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'the legacy export off require',
      code: "const { AsyncStorage } = require('react-native');\nexport const a = AsyncStorage;\nexport const b = require('react-native').AsyncStorage;",
      filename: feature,
      errors: 2,
    },
    {
      name: 'the legacy export re-exported',
      code: "export { AsyncStorage } from 'react-native';",
      filename: feature,
      errors: 1,
    },
  ],
});
