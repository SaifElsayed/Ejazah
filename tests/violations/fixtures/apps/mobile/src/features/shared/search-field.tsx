// T022 fixture — VIOLATION of R-MOBILE-6: a raw platform control built inside a feature instead
// of composing `design/primitives`. The value arrives as a prop, so no string literal reaches a
// text position and R-MOBILE-7 has nothing to say here.
// Refused by mobile/no-raw-control.
import { TextInput } from 'react-native';

export function SearchField(props: { readonly value: string }): unknown {
  return <TextInput value={props.value} />;
}
