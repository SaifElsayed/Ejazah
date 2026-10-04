// mobile/no-raw-control  ->  R-MOBILE-6  (fast)
//
// R-MOBILE-6: never build a button, input, card or sheet inside a feature. Compose
// `design/primitives`. A raw platform control carries no token, no direction and no accessibility
// default, so every feature that builds its own button builds a slightly different one (FR-007).
//
// DECISION (T037) — where it applies. The rule says "inside a feature" and its cell says "raw
// `Pressable`/`TextInput` banned in `features/**`"; the place the controls are allowed is
// `design/`, where the primitives wrap them. Every file under `apps/mobile/src` outside `design/`
// is read, so a route file under `app/` cannot build the button a feature may not.
//
// DECISION (T037) — which controls. The cell names `Pressable` and `TextInput` as its examples;
// the rule names the four things built from them. The list below is every pressable, text entry
// and modal surface `react-native` exports, and the same family from
// `react-native-gesture-handler`, whose `RectButton`, `BaseButton` and `BorderlessButton` are the
// usual way a hand-built button arrives. `View`, `Text` and `ScrollView` are not controls: a card
// is a `View`, and a `View` cannot be refused, so "card" stays with review.
//
// DECISION (review of PR #29, N7) — `Switch` is NOT on the list. R-MOBILE-6 names a button, an
// input, a card and a sheet; a toggle is none of the four, and refusing it would be a prohibition
// the constitution does not carry. If the design system grows a toggle primitive, adding `Switch`
// here follows an amendment to R-MOBILE-6, not the other way round (note under T037).
//
// WHAT IS REFUSED, in every spelling this rule can see without types:
//
//   import { Pressable } from 'react-native'            named, and aliased (`Pressable as P`)
//   import * as RN from 'react-native'  … <RN.Pressable>  namespace or default binding, in JSX
//                                                        and in a member access, `RN['Pressable']`
//   const { Pressable } = RN                             destructured off that binding
//   const { TextInput } = require('react-native')        destructured off `require`
//   require('react-native').Pressable                    read straight off `require`
//   export { Pressable } from 'react-native'             re-exported, and `export *`, which
//                                                        hands every control on at once
//   import { default as RN } from 'react-native'         the default export under a name of
//                                                        one's own is the namespace: <RN.Pressable>
//   import P from 'react-native/Libraries/Components/Pressable/Pressable'
//                                                        a deep path into the library whose last
//                                                        segment is a control, in every syntax
//                                                        that names a module (`import`,
//                                                        `export … from`, `import()`, `require`,
//                                                        `import x = require(…)`)
//
// A named import is reported once, at the import, not at every use of the binding. A namespace
// access is reported where it is written, which is the only place the control is named.
//
// WHAT IS NOT REFUSED, and is review's. A type-only import (`import type { TextInput }` for a
// ref's type builds nothing; the same holds for a type-only deep import and for
// `type T = import('…')`). A namespace handed to another variable first (`const X = RN`), a
// dynamic `import('react-native')`, and a control re-exported by a module of one's own: following
// those needs the program this fast rule does not have (research R-10). A control from any other
// library.
//
// The spellings are read once, in `../library.js`, which `mobile/no-insecure-storage` shares.
// The file is matched by path segments, never by a root-anchored path (note under T035).
const { defineRule } = require('../rule');
const { onLibraryMembers } = require('../library');
const { mobileFile } = require('../mobile');
const { onEverySpecifier } = require('../specifiers');
const { mergeVisitors } = require('../syntax');

const SOURCES = new Set(['react-native', 'react-native-gesture-handler']);
// Where `react-native` keeps the file each control is defined in (N7).
const DEEP_PREFIX = 'react-native/Libraries/';

const RAW_CONTROLS = new Set([
  'Pressable',
  'TextInput',
  'Button',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Modal',
  'RectButton',
  'BaseButton',
  'BorderlessButton',
  'RawButton',
]);

/** The control a deep path into `react-native` names by its last segment, or null. */
function deepControlOf(specifier) {
  if (!specifier.startsWith(DEEP_PREFIX)) return null;
  const last = specifier.slice(specifier.lastIndexOf('/') + 1);
  const dot = last.indexOf('.');
  const name = dot === -1 ? last : last.slice(0, dot);
  return RAW_CONTROLS.has(name) ? name : null;
}

/** True when the syntax naming the module is erased by the compiler and builds nothing. */
function isTypeOnly(sourceNode) {
  const { parent } = sourceNode;
  if (parent.type === 'TSImportType' || parent.type === 'TSLiteralType') return true;
  return parent.importKind === 'type' || parent.exportKind === 'type';
}

module.exports = defineRule({
  constitutionId: 'R-MOBILE-6',
  description:
    'Bans raw platform controls in apps/mobile/src outside design/; compose design/primitives',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    rawControl:
      '"{{control}}" from "{{source}}" is a raw platform control — compose a primitive from design/primitives, because a control built outside design/ carries no token, direction or accessibility default',
    everyControl:
      'export * from "{{source}}" hands every raw platform control on — export the primitives from design/primitives instead',
  },
  create(context) {
    const file = mobileFile(context.filename);
    if (file === null || file.area === 'design') return {};

    const members = onLibraryMembers({
      isSource: (specifier) => SOURCES.has(specifier),
      isName: (name) => RAW_CONTROLS.has(name),
      report(node, control, source) {
        context.report({ node, messageId: 'rawControl', data: { control, source } });
      },
      reportAll(node, source) {
        context.report({ node, messageId: 'everyControl', data: { source } });
      },
    });

    const deepPaths = onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const source = sourceNode.value;
      if (typeof source !== 'string' || isTypeOnly(sourceNode)) return;
      const control = deepControlOf(source);
      if (control === null) return;
      context.report({ node: sourceNode, messageId: 'rawControl', data: { control, source } });
    });

    return mergeVisitors(members, deepPaths);
  },
});
