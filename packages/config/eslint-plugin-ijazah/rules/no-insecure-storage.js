// mobile/no-insecure-storage  ->  R-MOBILE-10  (fast)
//
// R-MOBILE-10: never store a token, session or anything sensitive in plain AsyncStorage.
// SecureStore only. AsyncStorage is an unencrypted file on the device; what a feature writes
// there, a backup, a rooted phone or another build of the application can read (FR-006).
//
// The mechanism the constitution names is the import: AsyncStorage is a name only the storage
// layer may know, so a feature that wants to remember something has to ask that layer, and the
// layer decides what is sensitive.
//
// DECISION (T039) — the storage layer is `apps/mobile/src/lib/storage`, the path R-MOBILE-10 and
// ARCHITECTURE §6.1 name. The scaffold file was `lib/secure-storage.ts`; it was renamed to
// `lib/storage.ts` in the same commit as this rule so the constitution, the rule and the tree
// agree (note under T039). The layer may be that one file or grow into a folder: `lib/storage.ts`,
// `lib/storage.native.ts`, `lib/storage/index.ts` and anything below `lib/storage/` are all
// inside it. Every other file under `apps/mobile/src` is read.
//
// WHAT IS REFUSED
//
//   the package   `@react-native-async-storage/async-storage`, its former name
//                 `@react-native-community/async-storage`, and any subpath of either, in every
//                 syntax that names a module: `import`, `import type`, `export … from`,
//                 `import()`, `require`, `import x = require(…)` and `type T = import('…')`.
//   the legacy    `AsyncStorage` as an export of `react-native`: named (`import { AsyncStorage }`,
//   export        aliased too), through a namespace or default binding (`RN.AsyncStorage`,
//                 `RN['AsyncStorage']`), destructured off that binding or off
//                 `require('react-native')`, and re-exported.
//
// WHAT IS NOT REFUSED, and is review's. Another unencrypted store (`react-native-mmkv` without a
// key, a file written with `expo-file-system`): the constitution names AsyncStorage, and whether
// a value is sensitive is a judgement a rule cannot make. A store re-exported by a module of
// one's own, and a `react-native` namespace handed to another variable: both need the program
// this fast rule does not have (research R-10).
//
// The file is matched by path segments, never by a root-anchored path (note under T035).
const { defineRule } = require('../rule');
const { onLibraryMembers } = require('../library');
const { isAt, mobileFile } = require('../mobile');
const { onEverySpecifier } = require('../specifiers');
const { mergeVisitors } = require('../syntax');

const STORAGE_PACKAGES = [
  /^@react-native-async-storage\/async-storage(\/|$)/,
  /^@react-native-community\/async-storage(\/|$)/,
];

const LEGACY_SOURCE = 'react-native';
const LEGACY_EXPORT = 'AsyncStorage';

module.exports = defineRule({
  constitutionId: 'R-MOBILE-10',
  description: 'Bans AsyncStorage in apps/mobile/src outside lib/storage',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    plainStorage:
      '"{{specifier}}" is plain AsyncStorage — go through lib/storage, because AsyncStorage is an unencrypted file and only the storage layer decides what may be written to it',
    legacyStorage:
      '"AsyncStorage" from "{{source}}" is plain AsyncStorage — go through lib/storage, because AsyncStorage is an unencrypted file and only the storage layer decides what may be written to it',
  },
  create(context) {
    const file = mobileFile(context.filename);
    if (file === null || isAt(file, ['lib'], 'storage')) return {};

    const packages = onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const specifier = sourceNode.value;
      if (typeof specifier !== 'string') return;
      if (!STORAGE_PACKAGES.some((pattern) => pattern.test(specifier))) return;
      context.report({ node: sourceNode, messageId: 'plainStorage', data: { specifier } });
    });

    const legacy = onLibraryMembers({
      isSource: (specifier) => specifier === LEGACY_SOURCE,
      isName: (name) => name === LEGACY_EXPORT,
      report(node, _name, source) {
        context.report({ node, messageId: 'legacyStorage', data: { source } });
      },
      // `export * from 'react-native'` is refused by R-MOBILE-6, which owns that spelling.
      reportAll() {},
    });

    return mergeVisitors(packages, legacy);
  },
});
