// T024 of specs/004-sessions/tasks.md (research R-311, R-323 GAP-4; data-model.md §2.3, D1;
// contracts/admin-surface.md, `RemedyMonitor`) — a remedy's two derived deadlines, computed when read
// and never stored (R-DB-4), at their boundaries: a pending counter-proposal's `answerClosesAt`,
// `counter_proposed_at` plus the remedy's own `snapshot_answer_window_hours` (the one function D1
// names, which T031's `RemedyView` and T032's sweep reuse); and `bookingRetriedUntil`, for a remedy
// `proposed` or `awaiting_choice` whose choice window has closed, the proposal's start less the
// remedy's `snapshot_first_session_lead_hours`.
import { describe, expect, it } from 'vitest';

import { answerClosesAt, bookingRetriedUntil } from './remedy-deadlines.js';

const CHOICE_CLOSES = new Date('2026-11-17T10:00:00Z');
const PROPOSAL = new Date('2026-11-22T08:00:00Z');

describe('answerClosesAt (D1)', () => {
  it("is the counter-proposal's instant plus the remedy's own answer window", () => {
    expect(
      answerClosesAt({
        counterProposedAt: new Date('2026-11-10T09:30:00Z'),
        snapshotAnswerWindowHours: 72,
      }),
    ).toEqual(new Date('2026-11-13T09:30:00Z'));
  });

  it('counts whole hours of an instant, a clock change in between moving nothing', () => {
    // Cairo leaves summer time on the last Friday of October; the instant's hours do not move.
    expect(
      answerClosesAt({
        counterProposedAt: new Date('2026-10-29T21:00:00Z'),
        snapshotAnswerWindowHours: 24,
      }),
    ).toEqual(new Date('2026-10-30T21:00:00Z'));
  });
});

describe('bookingRetriedUntil (GAP-4, FR-468)', () => {
  const remedy = (status: 'awaiting_choice' | 'proposed' | 'counter_proposed' | 'booked') => ({
    status,
    choiceClosesAt: CHOICE_CLOSES,
    proposalStartsAt: PROPOSAL,
    snapshotFirstSessionLeadHours: 24,
  });

  it.each(['proposed', 'awaiting_choice'] as const)(
    'for a %s remedy past its choice window is the proposal less the lead',
    (status) => {
      expect(bookingRetriedUntil(remedy(status), new Date('2026-11-18T00:00:00Z'))).toEqual(
        new Date('2026-11-21T08:00:00Z'),
      );
    },
  );

  it('is present from the instant the choice window closes, and absent the instant before', () => {
    expect(bookingRetriedUntil(remedy('proposed'), CHOICE_CLOSES)).toEqual(
      new Date('2026-11-21T08:00:00Z'),
    );
    expect(
      bookingRetriedUntil(remedy('proposed'), new Date('2026-11-17T09:59:59.999Z')),
    ).toBeUndefined();
  });

  it.each(['counter_proposed', 'booked'] as const)('is absent for a %s remedy', (status) => {
    expect(bookingRetriedUntil(remedy(status), new Date('2026-11-18T00:00:00Z'))).toBeUndefined();
  });

  it('is absent with no proposal', () => {
    expect(
      bookingRetriedUntil(
        { ...remedy('proposed'), proposalStartsAt: undefined },
        new Date('2026-11-18T00:00:00Z'),
      ),
    ).toBeUndefined();
  });
});
