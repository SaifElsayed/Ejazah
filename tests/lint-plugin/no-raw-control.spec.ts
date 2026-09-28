// mobile/no-raw-control (R-MOBILE-6) against a table of code (T037).
//
// A control assembled from the platform's raw parts inside a feature carries its own colour, hit
// target and direction handling. The fixture proves `TextInput` imported from `react-native` and
// rendered; this table proves the other raw parts the header names (every touchable, `Button`,
// `Switch`, `Modal`), the second source that re-exports them (`react-native-gesture-handler`), and
// the two spellings that bind a refused name differently — a namespace import rendered as
// `RN.TextInput`, refused at the element, and a control renamed on import, refused at the import
// — so a feature cannot rename its way around the rule. A plain element is judged by where it
// came from, not by its name, so a primitive called `Button`, a type-only import and an element
// no raw source handed the feature are legal. `View`, `Text`, `ScrollView`, `FlatList` and
// `Image` are layout, not controls, and stay legal; `design/primitives` is where the raw parts are
// composed and is outside the rule's scope, as is anything outside `features/**`.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const field = 'apps/mobile/src/features/shared/search-field.tsx';
const hooks = 'apps/mobile/src/features/shared/use-search-field.ts';

typescriptRuleTester().run('mobile/no-raw-control', loadRule('no-raw-control.js'), {
  valid: [
    {
      name: 'a primitive that happens to be called Button, judged by where it came from',
      code: "import { Button } from '../../design/primitives';\nexport const Row = () => <Button />;",
      filename: field,
    },
    {
      name: 'a type-only import of a raw control, which names a shape and not a control',
      code: "import type { TextInput } from 'react-native';\nexport type Props = Parameters<typeof TextInput>[0];",
      filename: hooks,
    },
    {
      name: 'a raw element with no import binding it, which no raw source handed the feature',
      code: 'declare const Pressable: (props: { readonly onPress: () => void }) => unknown;\nexport const Row = () => <Pressable onPress={() => undefined} />;',
      filename: field,
    },
    {
      name: 'the shared primitive the fixture should have composed',
      code: "import { Field } from '../../design/primitives';\nexport function SearchField(props: { readonly value: string }): unknown {\n  return <Field value={props.value} />;\n}",
      filename: field,
    },
    {
      name: 'the layout parts, which a feature may still use to lay out a screen',
      code: "import { View, Text, ScrollView, FlatList, Image } from 'react-native';\nexport const Screen = (props: { readonly label: string }) => (\n  <ScrollView>\n    <View>\n      <Text>{props.label}</Text>\n    </View>\n  </ScrollView>\n);\nexport const parts = [FlatList, Image];",
      filename: field,
    },
    {
      name: 'a primitive in design/primitives, where the raw parts are composed',
      code: "import { Pressable, TextInput } from 'react-native';\nexport const Field = (props: { readonly value: string }) => <TextInput value={props.value} />;\nexport const Button = () => <Pressable />;",
      filename: 'apps/mobile/src/design/primitives/field.tsx',
    },
    {
      name: 'a route file under app/, which is outside features/',
      code: "import { Modal } from 'react-native';\nexport const Sheet = () => <Modal />;",
      filename: 'apps/mobile/src/app/(student)/sheet.tsx',
    },
    {
      name: 'a file outside apps/mobile',
      code: "import { Pressable } from 'react-native';\nexport const P = Pressable;",
      filename: 'packages/ui/src/pressable.ts',
    },
    {
      name: 'a react-native export that is not a control',
      code: "import { StyleSheet, Platform } from 'react-native';\nexport const isIos = Platform.OS === 'ios';\nexport const sheet = StyleSheet;",
      filename: hooks,
    },
    {
      name: 'a package whose name merely starts alike',
      code: "import { Pressable } from 'react-native-reanimated';\nexport const P = Pressable;",
      filename: hooks,
    },
  ],
  invalid: [
    {
      name: 'the canonical raw input, imported and rendered, refused once',
      code: "import { TextInput } from 'react-native';\nexport function SearchField(props: { readonly value: string }): unknown {\n  return <TextInput value={props.value} />;\n}",
      filename: field,
      errors: [{ messageId: 'rawControl', data: { name: 'TextInput', kind: 'an input' } }],
    },
    {
      name: 'a raw button imported without being rendered',
      code: "import { Pressable } from 'react-native';\nexport const P = Pressable;",
      filename: hooks,
      errors: [{ messageId: 'rawControl', data: { name: 'Pressable', kind: 'a button' } }],
    },
    {
      name: 'every touchable and the platform Button',
      code: "import {\n  TouchableOpacity,\n  TouchableHighlight,\n  TouchableWithoutFeedback,\n  TouchableNativeFeedback,\n  Button,\n} from 'react-native';\nexport const parts = [\n  TouchableOpacity,\n  TouchableHighlight,\n  TouchableWithoutFeedback,\n  TouchableNativeFeedback,\n  Button,\n];",
      filename: hooks,
      errors: 5,
    },
    {
      name: 'a raw switch and a raw modal',
      code: "import { Switch, Modal } from 'react-native';\nexport const parts = [Switch, Modal];",
      filename: hooks,
      errors: [
        { messageId: 'rawControl', data: { name: 'Switch', kind: 'an input' } },
        { messageId: 'rawControl', data: { name: 'Modal', kind: 'a sheet' } },
      ],
    },
    {
      name: 'a touchable from react-native-gesture-handler, which re-exports them',
      code: "import { TouchableOpacity } from 'react-native-gesture-handler';\nexport const T = TouchableOpacity;",
      filename: hooks,
      errors: [{ messageId: 'rawControl', data: { name: 'TouchableOpacity', kind: 'a button' } }],
    },
    {
      name: 'a subpath of react-native-gesture-handler',
      code: "import { TouchableOpacity } from 'react-native-gesture-handler/lib/module/components/touchables';\nexport const T = TouchableOpacity;",
      filename: hooks,
      errors: 1,
    },
    {
      name: 'a namespace import rendered as RN.TextInput, refused at the element',
      code: "import * as RN from 'react-native';\nexport const SearchField = (props: { readonly value: string }) => <RN.TextInput value={props.value} />;",
      filename: field,
      errors: [{ messageId: 'rawControl', data: { name: 'TextInput', kind: 'an input' } }],
    },
    {
      name: 'a control renamed on import, refused once at the import',
      code: "import { TextInput as Field } from 'react-native';\nexport const SearchField = (props: { readonly value: string }) => <Field value={props.value} />;",
      filename: field,
      errors: [{ messageId: 'rawControl', data: { name: 'TextInput', kind: 'an input' } }],
    },
    {
      name: 'a raw input reached through a namespace import, refused at the element',
      code: "import * as RN from 'react-native';\nexport const Field = () => <RN.TextInput value={''} />;",
      filename: field,
      errors: [{ messageId: 'rawControl', data: { name: 'TextInput', kind: 'an input' } }],
    },
    {
      name: 'the same raw element rendered twice, refused at each place it was written',
      code: "import * as RN from 'react-native';\nexport const Form = () => (\n  <RN.View>\n    <RN.TextInput />\n    <RN.Switch />\n  </RN.View>\n);",
      filename: field,
      errors: [
        { messageId: 'rawControl', data: { name: 'TextInput', kind: 'an input' } },
        { messageId: 'rawControl', data: { name: 'Switch', kind: 'an input' } },
      ],
    },
  ],
});
