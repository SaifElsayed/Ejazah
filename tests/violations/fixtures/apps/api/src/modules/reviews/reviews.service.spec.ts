// T026 fixture — VIOLATION of R-PROC-10, the focused half: `.only` leaves the file green while
// every other case in it stops running. Named `*.spec.ts` because that is what the rule must
// recognise, and excluded from the runner by the root `vitest.config.ts` so it cannot silence
// this suite. The skipped half is `modules/notifications/notifications.service.spec.ts`.
// Refused by proc/no-focused-or-skipped-test.
import { describe, expect, it } from 'vitest';

interface ReviewRow {
  readonly published: boolean;
}

function publishedCount(reviews: readonly ReviewRow[]): number {
  return reviews.filter((review) => review.published).length;
}

describe('review summary', () => {
  it.only('counts only published reviews', () => {
    expect(publishedCount([{ published: true }, { published: false }])).toBe(1);
  });
});
