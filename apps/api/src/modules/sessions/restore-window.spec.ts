// T024 of specs/004-sessions/tasks.md (FR-454; research R-322, R-323 P3-25; contracts/admin-surface.md,
// `sessions.monitor.get`'s `restorableUntil`) — the restore window's end, derived and never stored
// (R-DB-4): the closing case's opening plus `enrollment_restore_window_days`, days of 24 hours (the
// owner's decision of 2026-11-10 on B37 lane B's Q7), one function T061's `window_closed` reads too.
import { describe, expect, it } from 'vitest';

import { restorableUntil } from './restore-window.js';

describe('restorableUntil (FR-454, R-322)', () => {
  it("is the case's opening plus the window's days of 24 hours", () => {
    expect(restorableUntil(new Date('2026-11-10T09:15:30Z'), 7)).toEqual(
      new Date('2026-11-17T09:15:30Z'),
    );
  });

  it('counts 24 hours a day over a clock change', () => {
    // Cairo leaves summer time on 2026-10-30; the window's days are an instant's, not the wall's.
    expect(restorableUntil(new Date('2026-10-29T10:00:00Z'), 2)).toEqual(
      new Date('2026-10-31T10:00:00Z'),
    );
  });
});
