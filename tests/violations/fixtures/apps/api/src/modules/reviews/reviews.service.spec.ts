// T026 fixture — VIOLATION of R-PROC-10, the focused half: a test marked exclusive. `.only`
// leaves the file green while every other case in it stops running, which is the failure mode
// the constitution names — a suite reporting success for tests nobody executed.
// The file is named `*.spec.ts` because that is what the rule has to recognise as a test file,
// and the root `vitest.config.ts` excludes `tests/violations/fixtures/**` for exactly that
// reason: the fixture must look like a test to the linter and be invisible to the runner.
// The skipped half carries its own fixture,
// `modules/notifications/notifications.service.spec.ts`.
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
