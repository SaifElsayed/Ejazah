// mobile/no-raw-control  ->  R-MOBILE-6  (fast)
//
// R-MOBILE-6: never build a button, input, card or sheet inside a feature. Compose
// `design/primitives`. A control assembled from the platform's raw parts in a feature carries its
// own colours, its own hit target, its own focus ring and its own direction handling, and every
// one of them drifts from the primitive the moment the primitive changes (FR-007).
//
// WHERE (T037): every file under `apps/mobile/src/features`, the constitution's own scope ("raw
// `Pressable`/`TextInput` banned in `features/**`"). `design/primitives` is where the raw controls
// are composed into the shared ones, so it is the one place they may be named.
//
// WHICH CONTROLS (T037): the raw parts a button, input, card or sheet is built from, as
// `react-native` exports them — `Pressable`, `TouchableOpacity`, `TouchableHighlight`,
// `TouchableWithoutFeedback`, `TouchableNativeFeedback` and `Button` (a button); `TextInput` (an
// input); `Switch` (an input); `Modal` (a sheet). `View`, `Text`, `ScrollView`, `FlatList` and
// `Image` are layout, not controls, and a feature may still lay out a screen; a card is a `View`
// with a token border, which is why the primitive exists and why the raw `View` is not banned —
// the card primitive is a composition, not a wrapped platform part, and review reads for it.
//
// WHAT IS READ (T037): an import specifier binding one of those names from `react-native` (or
// from `react-native-gesture-handler`, which re-exports the touchables), reported at the
// specifier so a renamed import is caught where the name is bound; and a JSX element reached
// through a namespace or default import of one of those sources (`<RN.TextInput>`), reported at
// the element, which is the only place it is written. A plain `<Button>` is judged by where it
// came from, not by its name: the primitive `design/primitives` exports may well be called
// `Button`, and refusing it would refuse the rule's own prescribed fix. Type-only imports name a
// shape, not a control, and are not read.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isUnder } = require('../files');

const FEATURES_TREE = 'apps/mobile/src/features';

const RAW_SOURCES = [/^react-native$/, /^react-native-gesture-handler(\/|$)/];

const RAW_CONTROLS = new Map([
  ['Pressable', 'a button'],
  ['TouchableOpacity', 'a button'],
  ['TouchableHighlight', 'a button'],
  ['TouchableWithoutFeedback', 'a button'],
  ['TouchableNativeFeedback', 'a button'],
  ['Button', 'a button'],
  ['TextInput', 'an input'],
  ['Switch', 'an input'],
  ['Modal', 'a sheet'],
]);

function isRawSource(specifier) {
  return typeof specifier === 'string' && RAW_SOURCES.some((source) => source.test(specifier));
}

/** The last name of a JSX element: `TextInput` in `<TextInput>` and in `<RN.TextInput>`. */
function jsxElementName(nameNode) {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name;
  if (nameNode.type === 'JSXMemberExpression') return nameNode.property.name;
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-6',
  description:
    'Bans the raw platform controls a button, input or sheet is built from in apps/mobile/src/features',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    rawControl:
      '"{{name}}" is {{kind}} built from a raw platform control — compose the shared primitive from design/primitives instead, so the feature carries no colour, hit target or direction of its own',
  },
  create(context) {
    if (!isUnder(context.filename, FEATURES_TREE)) return {};

    // Namespace and default imports of a raw source (`import * as RN from 'react-native'`), so
    // `<RN.TextInput>` is refused at the element, which is the only place it is written.
    const rawNamespaces = new Set();

    function report(node, name) {
      context.report({
        node,
        messageId: 'rawControl',
        data: { name, kind: RAW_CONTROLS.get(name) },
      });
    }

    return {
      ImportDeclaration: (node) => {
        if (!isRawSource(node.source.value)) return;
        // `import type { TextInput } from 'react-native'` names a shape, not a control.
        if (node.importKind === 'type') return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') {
            rawNamespaces.add(specifier.local.name);
            continue;
          }
          if (specifier.importKind === 'type') continue;
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : String(specifier.imported.value);
          if (!RAW_CONTROLS.has(imported)) continue;
          report(specifier, imported);
        }
      },
      JSXOpeningElement: (node) => {
        if (node.name.type !== 'JSXMemberExpression') return;
        const name = jsxElementName(node.name);
        if (name === null || !RAW_CONTROLS.has(name)) return;
        let root = node.name.object;
        while (root.type === 'JSXMemberExpression') root = root.object;
        if (root.type !== 'JSXIdentifier' || !rawNamespaces.has(root.name)) return;
        report(node.name, name);
      },
    };
  },
});
