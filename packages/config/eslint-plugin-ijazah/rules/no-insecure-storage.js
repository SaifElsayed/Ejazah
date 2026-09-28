// mobile/no-insecure-storage  ->  R-MOBILE-10  (fast)
//
// R-MOBILE-10: never store a token, session or anything sensitive in plain AsyncStorage.
// SecureStore only. AsyncStorage is a plain file on the device, readable by anything that can read
// the sandbox and by anyone with the unlocked phone; the secure store is the keychain. The
// mechanism the constitution names is an import ban — "AsyncStorage import banned outside
// `lib/storage`" — because the fast rule set cannot tell a token from a preference, so it is the
// storage layer, not the call, that is confined (FR-006).
//
// DECISION (T039) — the secure storage layer is `apps/mobile/src/lib/storage`, the constitution's
// wording. The scaffold had `apps/mobile/src/lib/secure-storage.ts` (note under T039); the
// constitution is the document a lint message is traced to, so the file moved to match the rule
// rather than the rule and the constitution moving to match a placeholder. `lib/storage.ts` and
// `lib/storage/index.ts` both satisfy the path, so the layer may grow into a folder without
// touching this rule. The fixture, `features/student/session-token.ts`, writes from a feature and
// is refused under either name.
//
// WHAT IS REFUSED (T039): every import spelling `../specifiers.js` knows of the AsyncStorage
// package — `@react-native-async-storage/async-storage` and any subpath of it — and of the legacy
// `AsyncStorage` export of `react-native`. An import of `expo-secure-store` outside `lib/storage`
// is the right store reached the wrong way and is a review matter, not this rule's: the
// prohibition is about the plain store.
//
// WHERE (T039): every file under `apps/mobile` — the route tree under `app/`, `features/**`,
// `design/` and `lib/` alike — except the storage layer itself.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isAt, isUnder } = require('../files');
const { onEverySpecifier } = require('../specifiers');

const MOBILE_TREE = 'apps/mobile';
const STORAGE_LAYER = 'apps/mobile/src/lib/storage';

const ASYNC_STORAGE_PACKAGE = /^@react-native-async-storage\/async-storage(\/|$)/;

module.exports = defineRule({
  constitutionId: 'R-MOBILE-10',
  description: 'Bans importing plain AsyncStorage in apps/mobile outside lib/storage',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    insecureStorage:
      '"{{specifier}}" is plain on-device storage — anything a feature stores goes through lib/storage, which keeps sensitive values in the secure store',
  },
  create(context) {
    if (!isUnder(context.filename, MOBILE_TREE)) return {};
    if (isAt(context.filename, STORAGE_LAYER)) return {};

    function check(sourceNode) {
      if (sourceNode === null || sourceNode === undefined) return;
      if (typeof sourceNode.value !== 'string') return;
      if (!ASYNC_STORAGE_PACKAGE.test(sourceNode.value)) return;
      context.report({
        node: sourceNode,
        messageId: 'insecureStorage',
        data: { specifier: sourceNode.value },
      });
    }

    return {
      ...onEverySpecifier(check),
      ImportDeclaration: (node) => {
        check(node.source);
        // The legacy export: `import { AsyncStorage } from 'react-native'`.
        if (node.source.value !== 'react-native') return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : String(specifier.imported.value);
          if (imported !== 'AsyncStorage') continue;
          context.report({
            node: specifier,
            messageId: 'insecureStorage',
            data: { specifier: 'react-native AsyncStorage' },
          });
        }
      },
    };
  },
});
