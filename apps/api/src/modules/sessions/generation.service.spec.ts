// T034 — session generation's dates (R-209, FR-368, ADR 0009 D1–D2): consecutive weeks at the slot's
// weekday and local start in the enrollment's snapshot zone, the first being the slot's first
// occurrence that starts at least `first_session_lead_hours` after the confirmation
// (`firstOccurrenceAfter`, the rule booking's nearest slot shows a student before paying), numbered
// from one, the requested local date, start and zone stored as the fact and the two instants as the
// cache `packages/time` resolved. Cairo's 2026 changes are read from the runtime's tz data, as
// `packages/time/src/first-occurrence.spec.ts` pins them: the gap at Friday 2026-04-24 00:00, the
// repeat at Thursday 2026-10-29 24:00. The database's refusal of an overlap is
// `tests/db-integrity/session-generation.spec.ts`'s.
import { firstOccurrenceAfter } from '@ijazah/time';
import { describe, expect, it, vi } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  type EnrollmentToSchedule,
  generateForEnrollment,
  type ScheduledSession,
  sessionsFor,
} from './generation.service.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000e2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000e3';
const CAIRO = 'Africa/Cairo';
const LEAD = 24;

function enrollment(
  slot: EnrollmentToSchedule['slot'],
  values: Partial<Omit<EnrollmentToSchedule, 'slot'>> = {},
): EnrollmentToSchedule {
  return {
    id: ENROLLMENT,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    snapshotSessionCount: 4,
    snapshotDurationMinutes: 60,
    snapshotSlotTimezone: CAIRO,
    slot,
    ...values,
  };
}

/** What a session's row says: its number, the requested local fields and the cached instants. */
const scheduleOf = (session: ScheduledSession) => [
  session.sequenceNumber,
  `${session.scheduledDateLocal} ${session.scheduledStartTimeLocal}`,
  session.scheduledStartAt,
  session.scheduledEndAt,
];

describe('sessionsFor: the first session (FR-368)', () => {
  /** Thursday 10:00 in Cairo, +02:00 since the October change. */
  const thursdayTen = enrollment({ dayOfWeek: 4, startTimeLocal: '10:00:00' });

  it('takes a session exactly the lead after the confirmation', () => {
    // Wednesday 2026-11-04 10:00 in Cairo; 24 hours on is Thursday 10:00, the slot itself.
    const [first] = sessionsFor(thursdayTen, new Date('2026-11-04T08:00:00Z'), LEAD);
    expect(first?.scheduledDateLocal).toBe('2026-11-05');
    expect(first?.scheduledStartAt).toBe('2026-11-05T08:00:00Z');
  });

  it('moves to the next week when the slot starts just under the lead after it', () => {
    const [first] = sessionsFor(thursdayTen, new Date('2026-11-04T08:00:01Z'), LEAD);
    expect(first?.scheduledDateLocal).toBe('2026-11-12');
    expect(first?.scheduledStartAt).toBe('2026-11-12T08:00:00Z');
  });

  it('reads the lead it is given, the setting’s value', () => {
    const confirmedAt = new Date('2026-11-04T08:00:00Z');
    expect(sessionsFor(thursdayTen, confirmedAt, 0)[0]?.scheduledDateLocal).toBe('2026-11-05');
    expect(sessionsFor(thursdayTen, confirmedAt, 48)[0]?.scheduledDateLocal).toBe('2026-11-12');
  });

  it('is the session booking’s nearest slot shows for the same instant, across the April gap', () => {
    // nearest-slot.service.spec.ts's case: Thursday 2026-04-23 10:00 (+02:00), 24 hours on is
    // Friday 11:00 (+03:00), so that week's Friday 10:00 is too soon.
    const fridayTen = enrollment({ dayOfWeek: 5, startTimeLocal: '10:00:00' });
    const confirmedAt = new Date('2026-04-23T08:00:00Z');
    const [first] = sessionsFor(fridayTen, confirmedAt, LEAD);
    const shown = firstOccurrenceAfter(
      { dayOfWeek: 5, startTimeLocal: '10:00:00', durationMinutes: 60, timezone: CAIRO },
      confirmedAt,
      LEAD,
    );
    expect(first?.scheduledDateLocal).toBe('2026-05-01');
    expect(first?.scheduledStartAt).toBe('2026-05-01T07:00:00Z');
    expect([first?.scheduledDateLocal, first?.scheduledStartAt]).toEqual([
      shown.requestedLocalDate,
      shown.startsAt,
    ]);
  });
});

describe('sessionsFor: consecutive weeks, numbered from one (FR-368)', () => {
  it('places every session on the slot’s weekday and local start, one per week', () => {
    const sessions = sessionsFor(
      enrollment({ dayOfWeek: 4, startTimeLocal: '10:00:00' }),
      new Date('2026-11-04T08:00:00Z'),
      LEAD,
    );
    expect(sessions.map(scheduleOf)).toEqual([
      [1, '2026-11-05 10:00:00', '2026-11-05T08:00:00Z', '2026-11-05T09:00:00Z'],
      [2, '2026-11-12 10:00:00', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z'],
      [3, '2026-11-19 10:00:00', '2026-11-19T08:00:00Z', '2026-11-19T09:00:00Z'],
      [4, '2026-11-26 10:00:00', '2026-11-26T08:00:00Z', '2026-11-26T09:00:00Z'],
    ]);
  });

  it('writes the snapshot’s count and length', () => {
    const sessions = sessionsFor(
      enrollment(
        { dayOfWeek: 0, startTimeLocal: '18:00:00' },
        { snapshotSessionCount: 2, snapshotDurationMinutes: 45 },
      ),
      new Date('2026-11-04T08:00:00Z'),
      LEAD,
    );
    expect(sessions.map(scheduleOf)).toEqual([
      [1, '2026-11-08 18:00:00', '2026-11-08T16:00:00Z', '2026-11-08T16:45:00Z'],
      [2, '2026-11-15 18:00:00', '2026-11-15T16:00:00Z', '2026-11-15T16:45:00Z'],
    ]);
  });

  it('keeps a slot that crosses midnight on its own local date, whatever the UTC date', () => {
    // Thursday 23:30 for an hour ends Friday 00:30; Saturday 01:00 in Cairo is Friday in UTC.
    const lateThursday = sessionsFor(
      enrollment({ dayOfWeek: 4, startTimeLocal: '23:30:00' }, { snapshotSessionCount: 2 }),
      new Date('2026-11-04T08:00:00Z'),
      LEAD,
    );
    expect(lateThursday.map(scheduleOf)).toEqual([
      [1, '2026-11-05 23:30:00', '2026-11-05T21:30:00Z', '2026-11-05T22:30:00Z'],
      [2, '2026-11-12 23:30:00', '2026-11-12T21:30:00Z', '2026-11-12T22:30:00Z'],
    ]);

    const earlySaturday = sessionsFor(
      enrollment({ dayOfWeek: 6, startTimeLocal: '01:00:00' }, { snapshotSessionCount: 1 }),
      new Date('2026-11-04T08:00:00Z'),
      LEAD,
    );
    expect(earlySaturday.map(scheduleOf)).toEqual([
      [1, '2026-11-07 01:00:00', '2026-11-06T23:00:00Z', '2026-11-07T00:00:00Z'],
    ]);
  });
});

describe('sessionsFor: Cairo’s 2026 changes (ADR 0009 D1, R-TIME-7)', () => {
  it('stores the requested Friday 00:30 across the April gap, the instant shifted past it', () => {
    // Wednesday 2026-04-15 14:00 in Cairo; 24 hours on is Thursday 14:00, so Friday 04-17 is first.
    const sessions = sessionsFor(
      enrollment({ dayOfWeek: 5, startTimeLocal: '00:30:00' }),
      new Date('2026-04-15T12:00:00Z'),
      LEAD,
    );
    expect(sessions.map(scheduleOf)).toEqual([
      [1, '2026-04-17 00:30:00', '2026-04-16T22:30:00Z', '2026-04-16T23:30:00Z'],
      // 00:30 never happens on 2026-04-24; it lands at 01:30 (+03:00), the request kept.
      [2, '2026-04-24 00:30:00', '2026-04-23T22:30:00Z', '2026-04-23T23:30:00Z'],
      [3, '2026-05-01 00:30:00', '2026-04-30T21:30:00Z', '2026-04-30T22:30:00Z'],
      [4, '2026-05-08 00:30:00', '2026-05-07T21:30:00Z', '2026-05-07T22:30:00Z'],
    ]);
  });

  it('takes the first of a repeated Thursday 23:30 in October', () => {
    // Tuesday 2026-10-20 15:00 in Cairo (+03:00); the first Thursday is 10-22.
    const sessions = sessionsFor(
      enrollment({ dayOfWeek: 4, startTimeLocal: '23:30:00' }),
      new Date('2026-10-20T12:00:00Z'),
      LEAD,
    );
    expect(sessions.map(scheduleOf)).toEqual([
      [1, '2026-10-22 23:30:00', '2026-10-22T20:30:00Z', '2026-10-22T21:30:00Z'],
      // 23:30 happens twice on 2026-10-29: 20:30Z (+03:00) is taken, never 21:30Z (+02:00).
      [2, '2026-10-29 23:30:00', '2026-10-29T20:30:00Z', '2026-10-29T21:30:00Z'],
      [3, '2026-11-05 23:30:00', '2026-11-05T21:30:00Z', '2026-11-05T22:30:00Z'],
      [4, '2026-11-12 23:30:00', '2026-11-12T21:30:00Z', '2026-11-12T22:30:00Z'],
    ]);
  });
});

/** A transaction whose `session.createMany` is `createMany`, as a repository spec fakes one. */
function transactionWith(createMany: ReturnType<typeof vi.fn>): Transaction {
  return { session: { createMany } } as unknown as Transaction;
}

describe('generateForEnrollment: the rows written (ADR 0009 D1–D2)', () => {
  const thursdayTen = enrollment(
    { dayOfWeek: 4, startTimeLocal: '10:00:00' },
    { snapshotSessionCount: 2 },
  );
  const confirmedAt = new Date('2026-11-04T08:00:00Z');

  it('writes every session in one statement: the local fields as the fact, the instants as the cache', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const written = await generateForEnrollment(
      transactionWith(createMany),
      thursdayTen,
      confirmedAt,
      LEAD,
    );

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]).toEqual({
      data: [
        {
          enrollmentId: ENROLLMENT,
          teacherUserId: TEACHER,
          studentUserId: STUDENT,
          sequenceNumber: 1,
          // A `date` column is the day's midnight in UTC, a `time` column the epoch's day.
          scheduledDateLocal: new Date('2026-11-05T00:00:00Z'),
          scheduledStartTimeLocal: new Date('1970-01-01T10:00:00Z'),
          timezone: CAIRO,
          scheduledStartAt: new Date('2026-11-05T08:00:00Z'),
          scheduledEndAt: new Date('2026-11-05T09:00:00Z'),
          status: 'scheduled',
        },
        {
          enrollmentId: ENROLLMENT,
          teacherUserId: TEACHER,
          studentUserId: STUDENT,
          sequenceNumber: 2,
          scheduledDateLocal: new Date('2026-11-12T00:00:00Z'),
          scheduledStartTimeLocal: new Date('1970-01-01T10:00:00Z'),
          timezone: CAIRO,
          scheduledStartAt: new Date('2026-11-12T08:00:00Z'),
          scheduledEndAt: new Date('2026-11-12T09:00:00Z'),
          status: 'scheduled',
        },
      ],
    });
    expect(written.map(scheduleOf)).toEqual([
      [1, '2026-11-05 10:00:00', '2026-11-05T08:00:00Z', '2026-11-05T09:00:00Z'],
      [2, '2026-11-12 10:00:00', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z'],
    ]);
  });

  it('stores the request, not where the gap moved it, in the snapshot’s zone', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await generateForEnrollment(
      transactionWith(createMany),
      enrollment({ dayOfWeek: 5, startTimeLocal: '00:30:00' }, { snapshotSessionCount: 1 }),
      new Date('2026-04-22T12:00:00Z'),
      LEAD,
    );
    expect(createMany.mock.calls[0]?.[0]).toMatchObject({
      data: [
        {
          scheduledDateLocal: new Date('2026-04-24T00:00:00Z'),
          scheduledStartTimeLocal: new Date('1970-01-01T00:30:00Z'),
          timezone: CAIRO,
          scheduledStartAt: new Date('2026-04-23T22:30:00Z'),
          scheduledEndAt: new Date('2026-04-23T23:30:00Z'),
        },
      ],
    });
  });

  it('rethrows the database’s refusal and answers nothing', async () => {
    const refused = new Error('exclusion violation');
    const createMany = vi.fn().mockRejectedValue(refused);
    await expect(
      generateForEnrollment(transactionWith(createMany), thursdayTen, confirmedAt, LEAD),
    ).rejects.toBe(refused);
    expect(createMany).toHaveBeenCalledTimes(1);
  });
});

// T061 of specs/004-sessions (FR-424, FR-455; research R-322, step 4): the generation widened
// additively with a count and a first sequence number, so a restore creates the sessions it still
// owes, numbered after the last; nothing assumes every session was generated at once.
describe('sessionsFor and generateForEnrollment: a count and a first sequence number (T061)', () => {
  const thursdayTen = enrollment({ dayOfWeek: 4, startTimeLocal: '10:00:00' });
  const restoredAt = new Date('2026-11-04T08:00:00Z');

  it('places `count` consecutive weekly sessions from the first after the lead, numbered from the first number given', () => {
    const plan = { count: 2, firstSequenceNumber: 6 };
    expect(sessionsFor(thursdayTen, restoredAt, LEAD, plan).map(scheduleOf)).toEqual([
      [6, '2026-11-05 10:00:00', '2026-11-05T08:00:00Z', '2026-11-05T09:00:00Z'],
      [7, '2026-11-12 10:00:00', '2026-11-12T08:00:00Z', '2026-11-12T09:00:00Z'],
    ]);
  });

  it('places none and writes nothing for a count of none', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const plan = { count: 0, firstSequenceNumber: 5 };
    expect(sessionsFor(thursdayTen, restoredAt, LEAD, plan)).toEqual([]);
    expect(
      await generateForEnrollment(transactionWith(createMany), thursdayTen, restoredAt, LEAD, plan),
    ).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('writes the planned rows in one statement, numbered after the last', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const written = await generateForEnrollment(
      transactionWith(createMany),
      thursdayTen,
      restoredAt,
      LEAD,
      { count: 1, firstSequenceNumber: 9 },
    );
    expect(written.map(({ sequenceNumber }) => sequenceNumber)).toEqual([9]);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(
      (createMany.mock.calls[0]?.[0] as { data: { sequenceNumber: number }[] }).data.map(
        ({ sequenceNumber }) => sequenceNumber,
      ),
    ).toEqual([9]);
  });

  it('keeps the snapshot’s count from one with no plan, as before', () => {
    expect(
      sessionsFor(thursdayTen, restoredAt, LEAD).map(({ sequenceNumber }) => sequenceNumber),
    ).toEqual([1, 2, 3, 4]);
  });
});

describe('generateForEnrollment: a programme month on each session (006:T006; R-507)', () => {
  const thursdayTen = enrollment({ dayOfWeek: 4, startTimeLocal: '10:00:00' });
  const paidAt = new Date('2026-11-04T08:00:00Z');

  it('writes each planned session with its month, numbered after the last', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    await generateForEnrollment(transactionWith(createMany), thursdayTen, paidAt, LEAD, {
      count: 3,
      firstSequenceNumber: 4,
      months: [1, 2, 2],
    });
    const data = (
      createMany.mock.calls[0]?.[0] as {
        data: { sequenceNumber: number; programmeMonth?: number }[];
      }
    ).data;
    expect(
      data.map(({ sequenceNumber, programmeMonth }) => [sequenceNumber, programmeMonth]),
    ).toEqual([
      [4, 1],
      [5, 2],
      [6, 2],
    ]);
  });

  it('writes no month on a plan that names none, as before', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await generateForEnrollment(transactionWith(createMany), thursdayTen, paidAt, LEAD, {
      count: 1,
      firstSequenceNumber: 1,
    });
    const [row] = (createMany.mock.calls[0]?.[0] as { data: object[] }).data;
    expect(row).not.toHaveProperty('programmeMonth');
  });
});
