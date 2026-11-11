// T059 of specs/004-sessions/tasks.md (SRS FR-DISPUTE-7; FR-472; research R-308, «A ruling's
// revision») — whether a session dispute's ruling may be revised now, the one rule `disputes.revise`
// and `disputes.get`'s `revisable` read: refused `SESSION_UNDER_REVIEW` (an outage reclassified the
// session), `DISPUTE_OPEN` (this dispute or another of the session open), `RULING_FINAL`
// (`window_closed`, open until the scheduled end plus `dispute_window_hours` and closed from it,
// then `remedy_offered`), `RULING_SUPERSEDED` (a later dispute of the session resolved), in that
// order; admitted otherwise.
import { describe, expect, it } from 'vitest';

import { type RevisableRuling, revisionRefusal } from './ruling-revision.js';

const END = new Date('2026-11-08T10:00:00Z');
const OPEN = { disputeWindowHours: 72, now: new Date('2026-11-09T10:00:00Z') };
const CLOSED = { disputeWindowHours: 72, now: new Date('2026-11-11T10:00:00Z') };
const FIRST = { id: '0199d0a0-0000-7000-8000-0000000000d1', status: 'resolved' as const };
const LATER = { id: '0199d0a0-0000-7000-8000-0000000000d2', status: 'resolved' as const };
const ruling: RevisableRuling = {
  dispute: FIRST,
  disputes: [FIRST],
  status: 'teacher_no_show',
  scheduledEndAt: END,
  hasRemedy: false,
};

describe('revisionRefusal (FR-472)', () => {
  it.each(['done', 'student_no_show', 'teacher_no_show', 'both_no_show'])(
    'admits a %s ruling inside its window, with no remedy, the session’s last ruling',
    (status) => {
      expect(revisionRefusal({ ...ruling, status }, OPEN)).toBeNull();
    },
  );

  it('admits a revised ruling again (the earlier revision changed the outcome only)', () => {
    expect(revisionRefusal({ ...ruling, status: 'done' }, OPEN)).toBeNull();
  });

  it.each(['under_threshold', 'provider_outage'])(
    'refuses a session reclassified %s SESSION_UNDER_REVIEW, before anything else',
    (status) => {
      expect(
        revisionRefusal({ ...ruling, status, hasRemedy: true, disputes: [FIRST, LATER] }, CLOSED),
      ).toEqual({ code: 'SESSION_UNDER_REVIEW' });
    },
  );

  it('refuses DISPUTE_OPEN while this dispute is open, or another of the session, even past the window', () => {
    const open = { ...FIRST, status: 'open' as const };
    expect(
      revisionRefusal({ ...ruling, dispute: open, disputes: [open], status: 'disputed' }, CLOSED),
    ).toEqual({ code: 'DISPUTE_OPEN' });
    const second = { ...LATER, status: 'open' as const };
    expect(
      revisionRefusal({ ...ruling, disputes: [FIRST, second], status: 'disputed' }, OPEN),
    ).toEqual({ code: 'DISPUTE_OPEN' });
  });

  it('refuses RULING_FINAL window_closed from the window’s close, before remedy_offered, and both before a later ruling', () => {
    const atClose = { disputeWindowHours: 72, now: new Date('2026-11-11T10:00:00Z') };
    const justBefore = { disputeWindowHours: 72, now: new Date('2026-11-11T09:59:59.999Z') };
    expect(revisionRefusal(ruling, justBefore)).toBeNull();
    expect(
      revisionRefusal({ ...ruling, hasRemedy: true, disputes: [FIRST, LATER] }, atClose),
    ).toEqual({ code: 'RULING_FINAL', cause: 'window_closed' });
    expect(revisionRefusal({ ...ruling, hasRemedy: true, disputes: [FIRST, LATER] }, OPEN)).toEqual(
      { code: 'RULING_FINAL', cause: 'remedy_offered' },
    );
  });

  it('refuses RULING_SUPERSEDED when a later dispute of the session was resolved, and admits the later one', () => {
    expect(revisionRefusal({ ...ruling, disputes: [FIRST, LATER] }, OPEN)).toEqual({
      code: 'RULING_SUPERSEDED',
    });
    expect(
      revisionRefusal({ ...ruling, dispute: LATER, disputes: [FIRST, LATER] }, OPEN),
    ).toBeNull();
  });
});
