// 006:T008 of specs/006-programme (FR-706a; R-505; Q-3 (a) amended) — session 1's outcome chain:
// delivered at session 1's or its delivered make-up's scheduled end; waiting while a make-up is
// pending or to be offered; ended, with no make-up pending, at the last session's scheduled end. The
// read over the real tables is `tests/db-integrity/programme-windows.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { type ChainSession, assessmentOutcomeOf } from './assessment-outcome.js';

const MONDAY_END = new Date('2026-11-23T16:00:00Z');
const THURSDAY_END = new Date('2026-11-26T16:00:00Z');
const SATURDAY_END = new Date('2026-11-28T16:00:00Z');

function session(
  sequenceNumber: number,
  status: ChainSession['status'],
  endsAt: Date,
  change: Partial<ChainSession> = {},
): ChainSession {
  return {
    id: `0199d0a0-0000-7000-8000-0000000009${String(sequenceNumber).padStart(2, '0')}`,
    sequenceNumber,
    status,
    endsAt,
    makeupForSessionId: null,
    remedyStatus: null,
    ...change,
  };
}

const first = (status: ChainSession['status'], change: Partial<ChainSession> = {}) =>
  session(1, status, MONDAY_END, change);
const makeupOf = (
  of: ChainSession,
  sequenceNumber: number,
  status: ChainSession['status'],
  endsAt: Date,
) => session(sequenceNumber, status, endsAt, { makeupForSessionId: of.id });

describe('session 1’s outcome chain (006:T008, R-505, Q-3 (a) amended)', () => {
  it('is delivered at session 1’s scheduled end when it is done or the student’s no-show', () => {
    for (const status of ['done', 'student_no_show'] as const) {
      expect(assessmentOutcomeOf([first(status)])).toStrictEqual({
        kind: 'delivered',
        endsAt: MONDAY_END,
      });
    }
  });

  it('waits while session 1 is scheduled, and while there is no session 1', () => {
    expect(assessmentOutcomeOf([first('scheduled')])).toStrictEqual({ kind: 'waiting' });
    expect(assessmentOutcomeOf([])).toStrictEqual({ kind: 'waiting' });
  });

  it('follows the make-up: re-resolved a teacher’s no-show, the make-up delivered Thursday (the owner’s example)', () => {
    const one = first('teacher_no_show', { remedyStatus: 'booked' });
    expect(assessmentOutcomeOf([one, makeupOf(one, 2, 'done', THURSDAY_END)])).toStrictEqual({
      kind: 'delivered',
      endsAt: THURSDAY_END,
    });
  });

  it('waits while the make-up is scheduled, its remedy open, or its remedy not yet offered', () => {
    const one = first('teacher_no_show', { remedyStatus: 'booked' });
    expect(assessmentOutcomeOf([one, makeupOf(one, 2, 'scheduled', THURSDAY_END)])).toStrictEqual({
      kind: 'waiting',
    });
    for (const remedyStatus of [
      'awaiting_choice',
      'proposed',
      'counter_proposed',
      'frozen',
    ] as const) {
      expect(assessmentOutcomeOf([first('teacher_no_show', { remedyStatus })])).toStrictEqual({
        kind: 'waiting',
      });
    }
    for (const status of [
      'teacher_no_show',
      'both_no_show',
      'cancelled_by_agreement',
      'postponed',
    ] as const) {
      expect(assessmentOutcomeOf([first(status)])).toStrictEqual({ kind: 'waiting' });
    }
  });

  it('follows a chain of make-ups to the last, a make-up’s own no-show made up again', () => {
    const one = first('both_no_show', { remedyStatus: 'booked' });
    const two = makeupOf(one, 2, 'teacher_no_show', THURSDAY_END);
    const twoBooked = { ...two, remedyStatus: 'booked' as const };
    expect(
      assessmentOutcomeOf([
        one,
        twoBooked,
        makeupOf(twoBooked, 3, 'student_no_show', SATURDAY_END),
      ]),
    ).toStrictEqual({ kind: 'delivered', endsAt: SATURDAY_END });
  });

  it('ends with no make-up pending: a remedy lapsed or handed to a refund case, at its scheduled end (N-2)', () => {
    for (const remedyStatus of ['lapsed', 'refund_case'] as const) {
      expect(assessmentOutcomeOf([first('teacher_no_show', { remedyStatus })])).toStrictEqual({
        kind: 'ended',
        endsAt: MONDAY_END,
      });
    }
    const one = first('teacher_no_show', { remedyStatus: 'booked' });
    expect(
      assessmentOutcomeOf(
        [one, makeupOf(one, 2, 'both_no_show', THURSDAY_END)].map((row) =>
          row.sequenceNumber === 2 ? { ...row, remedyStatus: 'lapsed' as const } : row,
        ),
      ),
    ).toStrictEqual({ kind: 'ended', endsAt: THURSDAY_END });
  });

  it('ends at its scheduled end while unsettled: a dispute, a review or an outage (R-505)', () => {
    for (const status of ['disputed', 'under_threshold', 'provider_outage'] as const) {
      expect(assessmentOutcomeOf([first(status)])).toStrictEqual({
        kind: 'ended',
        endsAt: MONDAY_END,
      });
    }
  });

  it('ends at its scheduled end when cancelled by an administrator with no remedy', () => {
    expect(assessmentOutcomeOf([first('cancelled_by_admin')])).toStrictEqual({
      kind: 'ended',
      endsAt: MONDAY_END,
    });
  });

  it('reads no other session than session 1 and its make-ups', () => {
    const later = session(2, 'done', SATURDAY_END);
    expect(assessmentOutcomeOf([first('scheduled'), later])).toStrictEqual({ kind: 'waiting' });
  });
});
