// T026 fixture — VIOLATION of R-PROC-10, the skipped half: a failing test silenced instead of
// fixed. Named `*.spec.ts` and excluded from the runner for the same reason as its pair,
// `modules/reviews/reviews.service.spec.ts`, which carries the focused half.
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
