// mobile/no-raw-control (R-MOBILE-6) against a table of code (T037).
//
// The fixture proves a named import of `TextInput`. This table proves the spellings that name the
// same control without that import — an alias, a namespace in JSX, a destructuring off the
// namespace or off `require` — and the gesture-handler buttons, which are how a hand-built button
// usually arrives once `Pressable` is refused.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const feature = 'apps/mobile/src/features/shared/search-field.tsx';
const primitive = 'apps/mobile/src/design/primitives/button.tsx';

typescriptRuleTester().run('mobile/no-raw-control', loadRule('no-raw-control.js'), {
  valid: [
    {
      name: 'a primitive wraps the raw control',
      code: "import { Pressable } from 'react-native';\nexport const Button = Pressable;",
      filename: primitive,
    },
    {
      name: 'a feature composing a primitive',
      code: "import { Button } from '../../design/primitives';\nexport const B = Button;",
      filename: feature,
    },
    {
      name: 'layout elements are not controls',
      code: "import { View, Text, ScrollView, FlatList } from 'react-native';\nexport const x = [View, Text, ScrollView, FlatList];",
      filename: feature,
    },
    {
      name: 'a type-only import builds nothing',
      code: "import type { TextInput } from 'react-native';\nexport type Ref = TextInput;",
      filename: feature,
    },
    {
      name: 'an inline type-only specifier',
      code: "import { View, type TextInput } from 'react-native';\nexport type Ref = TextInput;\nexport const V = View;",
      filename: feature,
    },
    {
      name: 'a namespace used for layout only',
      code: "import * as RN from 'react-native';\nexport const V = () => <RN.View />;",
      filename: feature,
    },
    {
      name: 'a toggle is not one of the four things R-MOBILE-6 names',
      code: "import { Switch } from 'react-native';\nimport * as RN from 'react-native';\nexport const x = [Switch, RN.Switch];",
      filename: feature,
    },
    {
      name: 'a deep path to something that is not a control',
      code: "import View from 'react-native/Libraries/Components/View/View';\nexport const V = View;",
      filename: feature,
    },
    {
      name: 'a type-only deep import builds nothing',
      code: "import type TextInput from 'react-native/Libraries/Components/TextInput/TextInput';\nexport type Ref = TextInput;\nexport type P = import('react-native/Libraries/Components/Pressable/Pressable').default;",
      filename: feature,
    },
    {
      name: 'the default export under a name, used for layout only',
      code: "import { default as RN } from 'react-native';\nexport const V = () => <RN.View />;",
      filename: feature,
    },
    {
      name: 'a deep path inside design/',
      code: "import Pressable from 'react-native/Libraries/Components/Pressable/Pressable';\nexport const Button = Pressable;",
      filename: primitive,
    },
    {
      name: 'a control of the same name from another library',
      code: "import { Button } from 'some-ui-kit';\nexport const B = Button;",
      filename: feature,
    },
    {
      name: 'a member of the same name on something else',
      code: 'export const B = theme.Button;',
      filename: feature,
    },
    {
      name: 'a file outside the mobile application',
      code: "import { Pressable } from 'react-native';\nexport const P = Pressable;",
      filename: 'packages/contracts/src/x.ts',
    },
    {
      name: 'gesture-handler things that are not controls',
      code: "import { GestureDetector, Gesture } from 'react-native-gesture-handler';\nexport const g = [GestureDetector, Gesture];",
      filename: feature,
    },
  ],
  invalid: [
    {
      name: 'the fixture: a named import',
      code: "import { TextInput } from 'react-native';\nexport const F = () => <TextInput />;",
      filename: feature,
      errors: [{ messageId: 'rawControl', data: { control: 'TextInput', source: 'react-native' } }],
    },
    {
      name: 'an aliased import',
      code: "import { Pressable as Tap } from 'react-native';\nexport const F = () => <Tap />;",
      filename: feature,
      errors: [{ messageId: 'rawControl', data: { control: 'Pressable', source: 'react-native' } }],
    },
    {
      name: 'every control in the family',
      code: "import { Button, TouchableOpacity, TouchableHighlight, TouchableWithoutFeedback, TouchableNativeFeedback, Modal } from 'react-native';\nexport const x = [Button, TouchableOpacity, TouchableHighlight, TouchableWithoutFeedback, TouchableNativeFeedback, Modal];",
      filename: feature,
      errors: 6,
    },
    {
      name: 'a deep path whose last segment is a control',
      code: "import Pressable from 'react-native/Libraries/Components/Pressable/Pressable';\nexport const P = Pressable;",
      filename: feature,
      errors: [
        {
          messageId: 'rawControl',
          data: {
            control: 'Pressable',
            source: 'react-native/Libraries/Components/Pressable/Pressable',
          },
        },
      ],
    },
    {
      name: 'a deep path through require, a dynamic import and a re-export',
      code: "const TextInput = require('react-native/Libraries/Components/TextInput/TextInput');\nexport const load = () => import('react-native/Libraries/Components/Touchable/TouchableOpacity');\nexport { default as Sheet } from 'react-native/Libraries/Modal/Modal';\nexport const T = TextInput;",
      filename: feature,
      errors: 3,
    },
    {
      name: 'the default export under a name is the namespace',
      code: "import { default as RN } from 'react-native';\nexport const F = () => <RN.Pressable />;\nexport const b = RN.TextInput;",
      filename: feature,
      errors: [
        { messageId: 'rawControl', data: { control: 'Pressable', source: 'react-native' } },
        { messageId: 'rawControl', data: { control: 'TextInput', source: 'react-native' } },
      ],
    },
    {
      name: 'a route file under app/',
      code: "import { Pressable } from 'react-native';\nexport default Pressable;",
      filename: 'apps/mobile/src/app/(student)/index.tsx',
      errors: 1,
    },
    {
      name: 'a namespace in JSX',
      code: "import * as RN from 'react-native';\nexport const F = () => <RN.Pressable></RN.Pressable>;",
      filename: feature,
      errors: [{ messageId: 'rawControl', data: { control: 'Pressable', source: 'react-native' } }],
    },
    {
      name: 'a default binding in JSX',
      code: "import RN from 'react-native';\nexport const F = () => <RN.TextInput />;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a namespace member access, dotted and computed',
      code: "import * as RN from 'react-native';\nexport const a = RN.Pressable;\nexport const b = RN['TextInput'];",
      filename: feature,
      errors: 2,
    },
    {
      name: 'a namespace behind optional chaining and a cast',
      code: "import * as RN from 'react-native';\nexport const a = RN?.Pressable;\nexport const b = (RN as any).Modal;",
      filename: feature,
      errors: 2,
    },
    {
      name: 'destructured off the namespace',
      code: "import * as RN from 'react-native';\nconst { Pressable, View } = RN;\nexport const x = [Pressable, View];",
      filename: feature,
      errors: [{ messageId: 'rawControl', data: { control: 'Pressable', source: 'react-native' } }],
    },
    {
      name: 'destructured and renamed off require',
      code: "const { TextInput: Field } = require('react-native');\nexport const F = Field;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'read straight off require',
      code: "export const P = require('react-native').Pressable;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'a binding assigned from require',
      code: "const RN = require('react-native');\nexport const F = () => <RN.Pressable />;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'import = require',
      code: "import RN = require('react-native');\nexport const P = RN.Pressable;",
      filename: feature,
      errors: 1,
    },
    {
      name: 'the gesture-handler buttons',
      code: "import { RectButton, BaseButton, BorderlessButton } from 'react-native-gesture-handler';\nexport const x = [RectButton, BaseButton, BorderlessButton];",
      filename: feature,
      errors: [
        {
          messageId: 'rawControl',
          data: { control: 'RectButton', source: 'react-native-gesture-handler' },
        },
        {
          messageId: 'rawControl',
          data: { control: 'BaseButton', source: 'react-native-gesture-handler' },
        },
        {
          messageId: 'rawControl',
          data: { control: 'BorderlessButton', source: 'react-native-gesture-handler' },
        },
      ],
    },
    {
      name: 'the gesture-handler touchables and text input',
      code: "import { TouchableOpacity, TextInput } from 'react-native-gesture-handler';\nexport const x = [TouchableOpacity, TextInput];",
      filename: feature,
      errors: 2,
    },
    {
      name: 're-exported by name',
      code: "export { Pressable } from 'react-native';",
      filename: feature,
      errors: 1,
    },
    {
      name: 're-exported wholesale',
      code: "export * from 'react-native';",
      filename: feature,
      errors: [{ messageId: 'everyControl', data: { source: 'react-native' } }],
    },
  ],
});
