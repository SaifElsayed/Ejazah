// T013's fast-check properties (research R-305): the result does not depend on the events' order
// or on a duplicate; a reconnection never lowers simultaneous time; a lost leave changes nothing
// past the end. Seeds are fixed (3013 and up), so a run is reproducible; a failure prints its seed
// and path. Instants are whole seconds after the scheduled start of a sixty-minute session, from 20
// minutes before it to 10 minutes after its end; the settings are drawn too.
import fc from 'fast-check';
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
const EARLIEST = -1_200;
const LATEST = LENGTH + 600;
const NUM_RUNS = 500;

function at(second: number): Date {
  return new Date(addSeconds(START, second));
}

const secondArbitrary = fc.integer({ min: EARLIEST, max: LATEST });
const userArbitrary = fc.constantFrom(TEACHER, STUDENT);
/** Few references, so connections share them and joins and leaves pair. */
const refArbitrary = fc.constantFrom('c1', 'c2', 'c3');

const participantEventArbitrary: fc.Arbitrary<AttendanceEvent> = fc
  .tuple(
    fc.constantFrom('joined' as const, 'left' as const),
    userArbitrary,
    refArbitrary,
    secondArbitrary,
  )
  .map(([kind, userId, connectionRef, second]) => ({
    kind,
    userId,
    connectionRef,
    occurredAt: at(second),
  }));

function roomEndedArbitrary(min: number): fc.Arbitrary<AttendanceEvent> {
  return fc
    .integer({ min, max: LATEST })
    .map((second) => ({ kind: 'room_ended' as const, occurredAt: at(second) }));
}

function eventsArbitrary(roomEndsFrom: number): fc.Arbitrary<AttendanceEvent[]> {
  return fc.array(
    fc.oneof(
      { arbitrary: participantEventArbitrary, weight: 8 },
      { arbitrary: roomEndedArbitrary(roomEndsFrom), weight: 1 },
    ),
    { maxLength: 20 },
  );
}

const windowArbitrary: fc.Arbitrary<AttendanceWindow> = fc
  .array(
    fc
      .tuple(secondArbitrary, fc.integer({ min: 1, max: 900 }))
      .map(([from, length]) => ({ startsAt: at(from), endsAt: at(from + length) })),
    { maxLength: 2 },
  )
  .map((outages) => ({
    startsAt: at(0),
    endsAt: at(LENGTH),
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    outages,
  }));

const settingsArbitrary: fc.Arbitrary<AttendanceSettings> = fc.record({
  joinWindowMinutes: fc.integer({ min: 0, max: 20 }),
  minimumConnectionSeconds: fc.integer({ min: 0, max: 300 }),
  attendanceThresholdPct: fc.integer({ min: 0, max: 100 }),
  earlyJoinLeadMinutes: fc.integer({ min: 0, max: 30 }),
});

function runs(seed: number) {
  return { seed, numRuns: NUM_RUNS };
}

describe('evaluateAttendance: properties (R-305)', () => {
  it('does not depend on the events’ order', () => {
    fc.assert(
      fc.property(
        eventsArbitrary(EARLIEST).chain((events) =>
          fc.tuple(
            fc.constant(events),
            fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length }),
          ),
        ),
        windowArbitrary,
        settingsArbitrary,
        ([events, shuffled], window, settings) => {
          expect(evaluateAttendance(shuffled, window, settings)).toEqual(
            evaluateAttendance(events, window, settings),
          );
        },
      ),
      runs(3013),
    );
  });

  it('does not depend on a duplicate', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.oneof(participantEventArbitrary, roomEndedArbitrary(EARLIEST)), {
            minLength: 1,
            maxLength: 20,
          })
          .chain((events) =>
            fc
              .tuple(fc.nat({ max: events.length - 1 }), fc.nat({ max: events.length }))
              .map(([which, where]) => {
                const copy = { ...(events[which] as AttendanceEvent) };
                return [events, [...events.slice(0, where), copy, ...events.slice(where)]] as const;
              }),
          ),
        windowArbitrary,
        settingsArbitrary,
        ([events, duplicated], window, settings) => {
          expect(evaluateAttendance(duplicated, window, settings)).toEqual(
            evaluateAttendance(events, window, settings),
          );
        },
      ),
      runs(3014),
    );
  });

  it('a reconnection never lowers simultaneous time', () => {
    fc.assert(
      fc.property(
        eventsArbitrary(EARLIEST),
        userArbitrary,
        secondArbitrary,
        fc.option(secondArbitrary, { nil: undefined }),
        windowArbitrary,
        settingsArbitrary,
        (events, userId, from, to, window, settings) => {
          // A new connection of one participant: its own reference, a join, and a leave or none.
          const reconnection: AttendanceEvent[] = [
            { kind: 'joined', userId, connectionRef: 'reconnection', occurredAt: at(from) },
            ...(to === undefined
              ? []
              : [
                  {
                    kind: 'left' as const,
                    userId,
                    connectionRef: 'reconnection',
                    occurredAt: at(to),
                  },
                ]),
          ];
          const before = evaluateAttendance(events, window, settings);
          const after = evaluateAttendance([...events, ...reconnection], window, settings);
          expect(after.simultaneousSeconds).toBeGreaterThanOrEqual(before.simultaneousSeconds);
        },
      ),
      runs(3015),
    );
  });

  it('a lost leave at or after the end changes nothing (the room ending, if at all, at or after it)', () => {
    fc.assert(
      fc.property(
        eventsArbitrary(LENGTH),
        userArbitrary,
        refArbitrary,
        fc.integer({ min: LENGTH, max: LATEST }),
        windowArbitrary,
        settingsArbitrary,
        (events, userId, connectionRef, second, window, settings) => {
          const leave: AttendanceEvent = {
            kind: 'left',
            userId,
            connectionRef,
            occurredAt: at(second),
          };
          expect(evaluateAttendance(events, window, settings)).toEqual(
            evaluateAttendance([...events, leave], window, settings),
          );
        },
      ),
      runs(3016),
    );
  });

  it('counts nothing past the scheduled end, and never throws', () => {
    fc.assert(
      fc.property(
        eventsArbitrary(EARLIEST),
        windowArbitrary,
        settingsArbitrary,
        (events, window, settings) => {
          expect(
            evaluateAttendance(events, window, settings).simultaneousSeconds,
          ).toBeLessThanOrEqual(LENGTH);
        },
      ),
      runs(3017),
    );
  });
});
