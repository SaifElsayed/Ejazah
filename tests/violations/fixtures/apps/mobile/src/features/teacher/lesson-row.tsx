// T022 fixture — VIOLATION of R-MOBILE-5: a physical direction utility. `text-left` pins the
// alignment to one script; Arabic-first layout needs the logical `text-start`.
// The primitive is composed from `design/`, so R-MOBILE-6 has nothing to say here.
// Refused by mobile/no-physical-direction.
import { Text } from '../../design/primitives';

export function LessonRow(props: { readonly label: string }): unknown {
  return <Text className="text-left">{props.label}</Text>;
}
