import type { ReactNode } from 'react';

/**
 * T035: what a person typed (a name, a reason, an email), shown exactly as typed in any language
 * and isolated for direction (FR-175, ADR 0014 D2): a `<bdi>`, so an English name in an Arabic line
 * or an Arabic one in an English line neither reorders the sentence around it nor is reordered.
 */
export function UserText({ children }: { readonly children: ReactNode }) {
  return <bdi>{children}</bdi>;
}
