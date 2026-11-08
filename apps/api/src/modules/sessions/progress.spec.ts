// T049 — an enrollment's progress, derived from its sessions and never stored (FR-392, R-DB-4,
// ERD `enrollments`: `sessions_remaining` = the snapshot's count less the sessions consumed).
// Consumed are `done` and `student_no_show` (SRS §3.8.3, FR-NOSHOW-1); a teacher's absence, both
// absent, a cancellation, a review or a dispute consumes nothing until it is settled so. Upcoming
// are the scheduled sessions not yet over, the next the earliest of them; the last is the final
// session by sequence number.
import { addMinutes } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { EnrollmentSessionRow } from './sessions.repository.js';
import { sessionProgress } from './progress.js';

const NOW = new Date('2026-11-10T12:00:00Z');

function session(
  sequenceNumber: number,
  startsAt: string,
  status: EnrollmentSessionRow['status'] = 'scheduled',
): EnrollmentSessionRow {
  const start = new Date(startsAt);
  return {
    sequenceNumber,
    localDate: startsAt.slice(0, 10),
    startTimeLocal: '14:00:00',
    timezone: 'Africa/Cairo',
    startsAt: start,
    endsAt: new Date(addMinutes(start, 60)),
    status,
  };
}

describe('sessionProgress (FR-392)', () => {
  it('has no next or last session, nothing upcoming or completed, and the whole package remaining before generation', () => {
    expect(sessionProgress([], { sessionCount: 8, now: NOW })).toEqual({
      upcoming: 0,
      completed: 0,
      remaining: 8,
    });
  });

  it('takes the earliest scheduled session not yet over as next, and the final one by sequence as last', () => {
    const sessions = [
      session(1, '2026-11-03T12:00:00Z', 'done'),
      session(2, '2026-11-10T11:30:00Z'),
      session(3, '2026-11-17T12:00:00Z'),
      session(4, '2026-11-24T12:00:00Z'),
    ];
    const progress = sessionProgress(sessions, { sessionCount: 4, now: NOW });
    // Session 2 began half an hour ago and ends in half an hour: it is still the next.
    expect(progress.next).toBe(sessions[1]);
    expect(progress.last).toBe(sessions[3]);
    expect(progress.upcoming).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.remaining).toBe(3);
  });

  it('counts done and student_no_show as consumed, and nothing else', () => {
    const statuses = [
      'done',
      'student_no_show',
      'teacher_no_show',
      'both_no_show',
      'under_threshold',
      'provider_outage',
      'cancelled_by_agreement',
      'cancelled_by_admin',
      'disputed',
    ] as const;
    const sessions = statuses.map((status, index) =>
      session(index + 1, `2026-10-0${String(index + 1)}T12:00:00Z`, status),
    );
    const progress = sessionProgress(sessions, { sessionCount: 10, now: NOW });
    expect(progress.completed).toBe(2);
    expect(progress.remaining).toBe(8);
    expect(progress.upcoming).toBe(0);
    expect(progress.next).toBeUndefined();
  });

  it('counts a disputed session by its frozen outcome: done and student_no_show consumed (T014, R-308, K7)', () => {
    const frozen = ['done', 'student_no_show', 'teacher_no_show', 'both_no_show'] as const;
    const sessions = [
      ...frozen.map((outcomeUnderDispute, index) => ({
        ...session(index + 1, `2026-10-0${String(index + 1)}T12:00:00Z`, 'disputed'),
        outcomeUnderDispute,
      })),
      // Disputed before the evaluation: no outcome frozen yet, nothing consumed.
      session(5, '2026-10-05T12:00:00Z', 'disputed'),
    ];
    const progress = sessionProgress(sessions, { sessionCount: 8, now: NOW });
    expect(progress.completed).toBe(2);
    expect(progress.remaining).toBe(6);
  });

  it('does not count a scheduled session already over as upcoming, nor take it as next', () => {
    const sessions = [session(1, '2026-11-09T12:00:00Z'), session(2, '2026-11-16T12:00:00Z')];
    const progress = sessionProgress(sessions, { sessionCount: 2, now: NOW });
    expect(progress.next).toBe(sessions[1]);
    expect(progress.upcoming).toBe(1);
    expect(progress.completed).toBe(0);
  });

  it('takes the next by its instant, whatever the sequence: a make-up placed before a later session', () => {
    const makeup = session(5, '2026-11-12T12:00:00Z');
    const sessions = [session(4, '2026-11-17T12:00:00Z'), makeup];
    expect(sessionProgress(sessions, { sessionCount: 4, now: NOW }).next).toBe(makeup);
    expect(sessionProgress(sessions, { sessionCount: 4, now: NOW }).last).toBe(makeup);
  });

  it('never answers a negative remaining', () => {
    const sessions = [
      session(1, '2026-11-03T12:00:00Z', 'done'),
      session(2, '2026-11-04T12:00:00Z', 'done'),
    ];
    expect(sessionProgress(sessions, { sessionCount: 1, now: NOW }).remaining).toBe(0);
  });
});
