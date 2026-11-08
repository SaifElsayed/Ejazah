// T013 (FR-442, FR-443, FR-444; R-SESS-4; research R-305): the attendance rules, one example per
// rule of the task and per row of SRS §3.7.5's table, R-SESS-4's CI test (SC-402), and the session
// joined in its last second and after its end evaluated as usual with no error. Every instant is a
// whole second after the scheduled start of a sixty-minute session, under the seed's defaults
// (`prisma/seed.ts:96-99`: threshold 70 %, join window 10 minutes, minimum connection 60 seconds,
// early-join lead 15 minutes), so the threshold is ⌈0.7 × 3600⌉ = 2520 seconds.
import { addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import {
  type AttendanceEvent,
  type AttendanceSettings,
  type AttendanceWindow,
  evaluateAttendance,
} from './attendance.rules.js';

const START = new Date('2026-11-08T17:00:00Z');
const LENGTH = 3_600;
const TEACHER = '0190a000-0000-7000-8000-000000000001';
const STUDENT = '0190a000-0000-7000-8000-000000000002';

const SETTINGS: AttendanceSettings = {
  joinWindowMinutes: 10,
  minimumConnectionSeconds: 60,
  attendanceThresholdPct: 70,
  earlyJoinLeadMinutes: 15,
};

/** The instant `second` seconds after the scheduled start. */
function at(second: number): Date {
  return new Date(addSeconds(START, second));
}

function window(outages: [number, number][] = []): AttendanceWindow {
  return {
    startsAt: at(0),
    endsAt: at(LENGTH),
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    outages: outages.map(([from, to]) => ({ startsAt: at(from), endsAt: at(to) })),
  };
}

function joined(userId: string, connectionRef: string, second: number): AttendanceEvent {
  return { kind: 'joined', userId, connectionRef, occurredAt: at(second) };
}

function left(userId: string, connectionRef: string, second: number): AttendanceEvent {
  return { kind: 'left', userId, connectionRef, occurredAt: at(second) };
}

function roomEnded(second: number): AttendanceEvent {
  return { kind: 'room_ended', occurredAt: at(second) };
}

/** A connection of `userId` from `from` to `to`, its own reference. */
function connection(userId: string, ref: string, from: number, to: number): AttendanceEvent[] {
  return [joined(userId, ref, from), left(userId, ref, to)];
}

const TEACHER_WHOLE = connection(TEACHER, 't1', 0, LENGTH);

describe('evaluateAttendance: SRS §3.7.5 table (FR-444)', () => {
  it('Done: both connected together for the whole session', () => {
    expect(
      evaluateAttendance(
        [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, LENGTH)],
        window(),
        SETTINGS,
      ),
    ).toEqual({
      outcome: 'done',
      simultaneousSeconds: 3_600,
      teacherJoined: true,
      studentJoined: true,
    });
  });

  it('Done at exactly ⌈threshold × length⌉ seconds together, Under-Threshold one second below', () => {
    const atThreshold = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, 2_520)];
    expect(evaluateAttendance(atThreshold, window(), SETTINGS)).toMatchObject({
      outcome: 'done',
      simultaneousSeconds: 2_520,
    });
    const below = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, 2_519)];
    expect(evaluateAttendance(below, window(), SETTINGS)).toMatchObject({
      outcome: 'under_threshold',
      simultaneousSeconds: 2_519,
    });
  });

  it('rounds the threshold up: 70 % of 3601 seconds needs 2521', () => {
    const longer: AttendanceWindow = { ...window(), endsAt: at(3_601) };
    const events = [...connection(TEACHER, 't1', 0, 3_601), ...connection(STUDENT, 's1', 0, 2_520)];
    expect(evaluateAttendance(events, longer, SETTINGS).outcome).toBe('under_threshold');
    const enough = [...connection(TEACHER, 't1', 0, 3_601), ...connection(STUDENT, 's1', 0, 2_521)];
    expect(evaluateAttendance(enough, longer, SETTINGS).outcome).toBe('done');
  });

  it('Student-No-Show: the teacher joined and the student never did', () => {
    expect(evaluateAttendance(TEACHER_WHOLE, window(), SETTINGS)).toEqual({
      outcome: 'student_no_show',
      simultaneousSeconds: 0,
      teacherJoined: true,
      studentJoined: false,
    });
  });

  it('Teacher-No-Show: the student joined and the teacher never did', () => {
    expect(evaluateAttendance(connection(STUDENT, 's1', 0, LENGTH), window(), SETTINGS)).toEqual({
      outcome: 'teacher_no_show',
      simultaneousSeconds: 0,
      teacherJoined: false,
      studentJoined: true,
    });
  });

  it('Both-No-Show: no event at all', () => {
    expect(evaluateAttendance([], window(), SETTINGS)).toEqual({
      outcome: 'both_no_show',
      simultaneousSeconds: 0,
      teacherJoined: false,
      studentJoined: false,
    });
  });

  it('Under-Threshold: both joined, together below the threshold', () => {
    const events = [
      ...connection(TEACHER, 't1', 0, 1_800),
      ...connection(STUDENT, 's1', 0, LENGTH),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS)).toEqual({
      outcome: 'under_threshold',
      simultaneousSeconds: 1_800,
      teacherJoined: true,
      studentJoined: true,
    });
  });

  it('Provider-Outage: an outage overlapping the session comes before every other row', () => {
    const done = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, LENGTH)];
    expect(evaluateAttendance(done, window([[1_000, 1_100]]), SETTINGS)).toEqual({
      outcome: 'provider_outage',
      simultaneousSeconds: 3_600,
      teacherJoined: true,
      studentJoined: true,
    });
    expect(evaluateAttendance([], window([[-600, 1]]), SETTINGS).outcome).toBe('provider_outage');
    expect(
      evaluateAttendance(TEACHER_WHOLE, window([[LENGTH - 1, LENGTH + 600]]), SETTINGS).outcome,
    ).toBe('provider_outage');
  });

  it('an outage touching the session but not overlapping it (half-open) changes nothing', () => {
    const done = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, LENGTH)];
    expect(
      evaluateAttendance(
        done,
        window([
          [-600, 0],
          [LENGTH, LENGTH + 600],
        ]),
        SETTINGS,
      ).outcome,
    ).toBe('done');
  });
});

describe('evaluateAttendance: joined (FR-442)', () => {
  it('joined with a connection begun at the join window’s last second, not one second later', () => {
    const inWindow = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 600, LENGTH)];
    expect(evaluateAttendance(inWindow, window(), SETTINGS).studentJoined).toBe(true);
    const late = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 601, LENGTH)];
    expect(evaluateAttendance(late, window(), SETTINGS)).toMatchObject({
      outcome: 'student_no_show',
      studentJoined: false,
      simultaneousSeconds: 2_999,
    });
  });

  it('joined at the minimum connection, not one second below it', () => {
    const enough = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, 60)];
    expect(evaluateAttendance(enough, window(), SETTINGS).studentJoined).toBe(true);
    const short = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, 59)];
    expect(evaluateAttendance(short, window(), SETTINGS)).toMatchObject({
      outcome: 'student_no_show',
      studentJoined: false,
    });
  });

  it('counts connected time from the early-join lead toward joining, not toward the simultaneous time', () => {
    const early = [
      ...connection(TEACHER, 't1', -120, -60),
      ...connection(STUDENT, 's1', -120, -60),
    ];
    expect(evaluateAttendance(early, window(), SETTINGS)).toEqual({
      outcome: 'under_threshold',
      simultaneousSeconds: 0,
      teacherJoined: true,
      studentJoined: true,
    });
  });

  it('counts nothing before the early-join lead toward joining', () => {
    const tooEarly = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', -1_000, -850)];
    expect(evaluateAttendance(tooEarly, window(), SETTINGS).studentJoined).toBe(false);
    const straddling = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', -1_000, -840)];
    expect(evaluateAttendance(straddling, window(), SETTINGS).studentJoined).toBe(true);
  });

  it('adds a participant’s connections together toward the minimum', () => {
    const two = [
      ...TEACHER_WHOLE,
      ...connection(STUDENT, 's1', 0, 30),
      ...connection(STUDENT, 's2', 100, 130),
    ];
    expect(evaluateAttendance(two, window(), SETTINGS).studentJoined).toBe(true);
  });
});

describe('evaluateAttendance: connections (FR-443, R-305)', () => {
  it('R-SESS-4 (SC-402): a disconnect and reconnection yields the sum of the overlaps', () => {
    const events = [
      ...connection(TEACHER, 't1', 0, 2_000),
      ...connection(TEACHER, 't2', 2_100, LENGTH),
      ...connection(STUDENT, 's1', 0, 1_200),
      ...connection(STUDENT, 's2', 1_260, LENGTH),
    ];
    // [0, 1200) + [1260, 2000) + [2100, 3600) = 1200 + 740 + 1500.
    expect(evaluateAttendance(events, window(), SETTINGS)).toMatchObject({
      outcome: 'done',
      simultaneousSeconds: 3_440,
    });
  });

  it('counts a reconnection overlapping the old connection once', () => {
    const events = [
      ...TEACHER_WHOLE,
      ...connection(STUDENT, 's1', 0, 2_000),
      ...connection(STUDENT, 's2', 1_500, LENGTH),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(3_600);
  });

  it('ignores a leave with no open interval', () => {
    const events = [
      ...TEACHER_WHOLE,
      left(STUDENT, 's0', 100),
      ...connection(STUDENT, 's1', 0, 1_000),
      left(STUDENT, 's1', 2_000),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(1_000);
  });

  it('closes a connection never left at the first room end after it', () => {
    const events = [
      ...TEACHER_WHOLE,
      roomEnded(-300),
      joined(STUDENT, 's1', 0),
      roomEnded(3_000),
      roomEnded(3_300),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS)).toMatchObject({
      outcome: 'done',
      simultaneousSeconds: 3_000,
    });
  });

  it('closes a connection never left at the scheduled end when no room end follows it', () => {
    const events = [...TEACHER_WHOLE, roomEnded(-300), joined(STUDENT, 's1', 0)];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(3_600);
  });

  it('counts nothing past the scheduled end, however late the leave', () => {
    const events = [
      ...connection(TEACHER, 't1', 0, LENGTH + 900),
      ...connection(STUDENT, 's1', 0, LENGTH + 600),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(3_600);
  });

  it('counts nothing before the scheduled start toward the simultaneous time', () => {
    const events = [
      ...connection(TEACHER, 't1', -600, 1_000),
      ...connection(STUDENT, 's1', -600, 1_000),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(1_000);
  });

  it('ignores an event of a user who is neither participant', () => {
    const events = [
      ...TEACHER_WHOLE,
      ...connection('0190a000-0000-7000-8000-000000000009', 'x1', 0, LENGTH),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS).outcome).toBe('student_no_show');
  });

  it('keys an interval by its connection, so events delivered out of order pair the same', () => {
    const inOrder = [
      ...TEACHER_WHOLE,
      joined(STUDENT, 's1', 0),
      joined(STUDENT, 's2', 1_000),
      left(STUDENT, 's1', 1_200),
      left(STUDENT, 's2', 3_000),
    ];
    expect(evaluateAttendance([...inOrder].reverse(), window(), SETTINGS)).toEqual(
      evaluateAttendance(inOrder, window(), SETTINGS),
    );
    expect(evaluateAttendance(inOrder, window(), SETTINGS).simultaneousSeconds).toBe(3_000);
  });

  it('changes nothing for a duplicated event', () => {
    const events = [...TEACHER_WHOLE, ...connection(STUDENT, 's1', 0, 2_600)];
    const duplicated = [...events, ...events, roomEnded(3_300), roomEnded(3_300)];
    expect(evaluateAttendance(duplicated, window(), SETTINGS)).toEqual(
      evaluateAttendance([...events, roomEnded(3_300)], window(), SETTINGS),
    );
  });
});

describe('evaluateAttendance: R-305’s tie order at one second', () => {
  it('a leave and a join of the same connection in one second: the leave first, so a rejoin on that connection loses no time', () => {
    const events = [
      ...TEACHER_WHOLE,
      joined(STUDENT, 's1', 0),
      joined(STUDENT, 's1', 1_000),
      left(STUDENT, 's1', 1_000),
      left(STUDENT, 's1', 2_600),
    ];
    // [0, 1000) closed by the leave, [1000, 2600) opened by the join after it.
    expect(evaluateAttendance(events, window(), SETTINGS)).toMatchObject({
      outcome: 'done',
      simultaneousSeconds: 2_600,
    });
  });

  it('a join and a leave of the same connection in one second: the leave sorts first and is ignored, so the connection stays open', () => {
    // R-305's order as written: in the join's own second the leave sorts first, with nothing open.
    const events = [...TEACHER_WHOLE, left(STUDENT, 's1', 100), joined(STUDENT, 's1', 100)];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(3_500);
  });

  it('ties within a second are judged on the whole second, whatever the milliseconds', () => {
    const events = [
      ...TEACHER_WHOLE,
      joined(STUDENT, 's1', 0),
      {
        kind: 'left',
        userId: STUDENT,
        connectionRef: 's1',
        occurredAt: new Date('2026-11-08T17:16:40.900Z'),
      },
      {
        kind: 'joined',
        userId: STUDENT,
        connectionRef: 's1',
        occurredAt: new Date('2026-11-08T17:16:40.100Z'),
      },
      left(STUDENT, 's1', 2_600),
    ] satisfies AttendanceEvent[];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(2_600);
  });

  it('two connections, one leaving in the second the other joins: no gap between them', () => {
    const events = [
      ...TEACHER_WHOLE,
      joined(STUDENT, 's2', 1_000),
      left(STUDENT, 's1', 1_000),
      joined(STUDENT, 's1', 0),
      left(STUDENT, 's2', LENGTH),
    ];
    expect(evaluateAttendance(events, window(), SETTINGS).simultaneousSeconds).toBe(3_600);
  });
});

describe('evaluateAttendance: a connection at or after the scheduled end (R-SESS-2)', () => {
  it('evaluates as usual, with no error, when a participant joins in the session’s last second', () => {
    const events = [...TEACHER_WHOLE, joined(STUDENT, 's1', LENGTH - 1)];
    expect(evaluateAttendance(events, window(), SETTINGS)).toEqual({
      outcome: 'student_no_show',
      simultaneousSeconds: 1,
      teacherJoined: true,
      studentJoined: false,
    });
  });

  it('evaluates as usual, with no error, when a participant joins after its end', () => {
    for (const events of [
      [...TEACHER_WHOLE, joined(STUDENT, 's1', LENGTH)],
      [...TEACHER_WHOLE, joined(STUDENT, 's1', LENGTH + 30), left(STUDENT, 's1', LENGTH + 90)],
      [...TEACHER_WHOLE, roomEnded(LENGTH + 5), joined(STUDENT, 's1', LENGTH + 30)],
    ]) {
      expect(evaluateAttendance(events, window(), SETTINGS)).toEqual({
        outcome: 'student_no_show',
        simultaneousSeconds: 0,
        teacherJoined: true,
        studentJoined: false,
      });
    }
  });
});
