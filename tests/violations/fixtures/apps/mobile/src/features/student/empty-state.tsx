// T022 fixture — VIOLATION of R-MOBILE-7: a user-facing string literal in a view text position.
// Every string is a key present in both ar.json and en.json; a literal ships untranslatable
// English into an Arabic-first application.
// Refused by mobile/no-literal-string.
import { Text } from '../../design/primitives';

export function EmptyState(): unknown {
  return <Text>No teachers match your filters yet.</Text>;
}
