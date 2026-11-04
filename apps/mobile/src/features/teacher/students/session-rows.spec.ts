// T051 (screens.md, «Lists», decision 21): `TeacherEnrollment`'s sessions as rows. Sessions of one
// status in a row of three or more collapse into one range; one or two stay rows of their own. The
// next session is always a row of its own, drawn first in weight, so a range never hides it.
import type { ListedSession, SessionStatus } from '@ijazah/contracts';
import { describe, expect, it } from '@jest/globals';

import { sessionRows } from './session-rows';

function session(sequenceNumber: number, status: SessionStatus = 'scheduled'): ListedSession {
  const day = String(sequenceNumber).padStart(2, '0');
  return {
    sequenceNumber,
    localDate: `2026-12-${day}`,
    startTimeLocal: '18:00',
    timezone: 'Africa/Cairo',
    startsAt: `2026-12-${day}T16:00:00.000Z`,
    endsAt: `2026-12-${day}T16:45:00.000Z`,
    status,
  };
}

const shape = (rows: ReturnType<typeof sessionRows>) =>
  rows.map((row) =>
    row.kind === 'range'
      ? `${row.first.sequenceNumber}-${row.last.sequenceNumber}`
      : `${row.session.sequenceNumber}${row.next ? '*' : ''}`,
  );

describe('sessionRows', () => {
  it('collapses three or more of one status into a range, the next one standing alone', () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => session(n));
    expect(shape(sessionRows(sessions, 1))).toEqual(['1*', '2-8']);
  });

  it('keeps one or two of a status as rows of their own', () => {
    const sessions = [
      session(1, 'done'),
      session(2, 'done'),
      session(3, 'teacher_no_show'),
      session(4),
      session(5),
    ];
    expect(shape(sessionRows(sessions, 4))).toEqual(['1', '2', '3', '4*', '5']);
  });

  it('breaks a range where the status changes', () => {
    const sessions = [
      session(1, 'done'),
      session(2, 'done'),
      session(3, 'done'),
      session(4),
      session(5),
      session(6),
      session(7),
    ];
    expect(shape(sessionRows(sessions, 4))).toEqual(['1-3', '4*', '5-7']);
  });

  it('collapses every session when none is next, as on an ended enrollment', () => {
    const sessions = [1, 2, 3].map((n) => session(n, 'done'));
    expect(shape(sessionRows(sessions, undefined))).toEqual(['1-3']);
    const range = sessionRows(sessions, undefined)[0];
    expect(range?.kind === 'range' ? range.status : undefined).toBe('done');
  });

  it('draws nothing for an enrollment without sessions', () => {
    expect(sessionRows([], undefined)).toEqual([]);
  });
});
