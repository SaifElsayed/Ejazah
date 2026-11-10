// T024 of specs/004-sessions/tasks.md (spec FR-439; research R-323 GAP-3; contracts/admin-surface.md,
// `sessions.monitor.get`'s `correctable`) — whether an administrator's correction of an outcome
// nobody disputed would be admitted now, the one function T059's `sessions.review.revise` answers:
// a settled `done` or no-show outcome, its dispute window open (the scheduled end plus
// `dispute_window_hours`, open until that instant), no remedy, never disputed. Each condition apart.
import { describe, expect, it } from 'vitest';

import { isCorrectable } from './outcome-correction.js';

const END = new Date('2026-11-08T10:00:00Z');
const WINDOW = { disputeWindowHours: 72 };
const OPEN = new Date('2026-11-09T10:00:00Z');
const CLOSES = new Date('2026-11-11T10:00:00Z');
const correctable = {
  status: 'done' as const,
  scheduledEndAt: END,
  hasRemedy: false,
  everDisputed: false,
};

describe('isCorrectable (FR-439)', () => {
  it.each(['done', 'student_no_show', 'teacher_no_show', 'both_no_show'] as const)(
    'admits a %s outcome inside its window, with no remedy, never disputed',
    (status) => {
      expect(isCorrectable({ ...correctable, status }, { ...WINDOW, now: OPEN })).toBe(true);
    },
  );

  it.each([
    'scheduled',
    'disputed',
    'under_threshold',
    'provider_outage',
    'cancelled_by_agreement',
    'cancelled_by_admin',
  ] as const)('refuses a %s session', (status) => {
    expect(isCorrectable({ ...correctable, status }, { ...WINDOW, now: OPEN })).toBe(false);
  });

  it('is open until the instant the dispute window closes, and closed from it', () => {
    expect(
      isCorrectable(correctable, { ...WINDOW, now: new Date('2026-11-11T09:59:59.999Z') }),
    ).toBe(true);
    expect(isCorrectable(correctable, { ...WINDOW, now: CLOSES })).toBe(false);
  });

  it('refuses a session with a remedy', () => {
    expect(isCorrectable({ ...correctable, hasRemedy: true }, { ...WINDOW, now: OPEN })).toBe(
      false,
    );
  });

  it('refuses a session ever disputed, its dispute resolved included', () => {
    expect(isCorrectable({ ...correctable, everDisputed: true }, { ...WINDOW, now: OPEN })).toBe(
      false,
    );
  });
});
