// T022 — a stand-in for `react-native` and for the JSX namespace, so the `.tsx` fixtures
// compile inside the fixture program. `apps/mobile` declares no React Native yet (T006 is a
// tree, not a runtime) and nothing links a package into `tests/violations/fixtures/`. The
// R-MOBILE-6 fixture imports the raw `TextInput` it is forbidden to use; the case is `fast`
// and never needs the type. Only what the fixtures touch is declared.
declare module 'react-native' {
  export interface TextInputProps {
    readonly value?: string;
  }
  export function TextInput(props: TextInputProps): unknown;
}

declare namespace JSX {
  // Element type of any JSX expression in the fixture tree; fixtures return `unknown`.
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
}
