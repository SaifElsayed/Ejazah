// T026 fixture — VIOLATION of R-PROC-10, the skipped half: a test marked skipped. This is the
// route the constitution closes explicitly — a failing test is fixed, never silenced to get a
// green run — and it is the route this whole inverted suite would take if the discipline ever
// slipped.
// Paired with `modules/reviews/reviews.service.spec.ts`, which carries the focused half; a rule
// that refuses one and shrugs at the other is half a rule, as T020 says of the mobile walls.
// Excluded from the runner by the root `vitest.config.ts`, and named `*.spec.ts` so the rule can
// recognise it as a test file.
// Refused by proc/no-focused-or-skipped-test.
import { describe, expect, it } from 'vitest';

interface NotificationRow {
  readonly readAt: string | null;
}

function unreadCount(notifications: readonly NotificationRow[]): number {
  return notifications.filter((notification) => notification.readAt === null).length;
}

describe('notification summary', () => {
  it.skip('counts only unread notifications', () => {
    expect(unreadCount([{ readAt: null }, { readAt: '' }])).toBe(1);
  });
});
