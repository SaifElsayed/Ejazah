// T024 fixture — VIOLATION of R-TIME-1, the other half of the mechanism: a datetime library
// reached outside `packages/time`. The polyfill is a real dependency of that package and is
// confined to it, behind the project's own types, so replacing it later stays an internal
// change (research R-4). An import here is that confinement broken.
// Refused by time/no-datetime-outside-package.
import { Temporal } from '@js-temporal/polyfill';

export function sessionInstant(isoInstant: string): string {
  return Temporal.Instant.from(isoInstant).toString();
}
