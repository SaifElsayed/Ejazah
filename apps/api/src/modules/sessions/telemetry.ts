// T033 of specs/004-sessions/tasks.md (FR-477, FR-SESS-9; research R-305, R-323 GAP-2;
// contracts/admin-surface.md, `Telemetry`): a session's connection record as the administrator reads
// it, `sessions.review.get`'s answer and `disputes.get`'s `telemetry` (T034). Read with no lock and
// nothing written: the record decides nothing.
//
// - The schedule: the session's local date, local start and zone, and its instants (FR-494).
// - Every recorded join and leave and the room's end (`session_participant_events`), oldest first,
//   each named by its party (the session's own copies of its two accounts, ADR 0010).
// - The intervals: each party's connected time and the two together, by T013's rules
//   (`attendance.rules.ts`, `connectedIntervals`), the same spans the evaluation measures.
// - The simultaneous seconds: the figure the evaluation recorded and decided the outcome on
//   (`sessions.simultaneous_connected_seconds`, ADR 0022), never recomputed, so the administrator
//   reads the number the outcome was decided on; 0 for a session never evaluated.
// - Who joined, by FR-442 (T013's `evaluateAttendance`, the four attendance settings read now).
// - The outage windows overlapping the session (FR-445).
// - 004:T084 (SRS DEC-105; the owner's Q-C1-2 (a)): the session's encryption failures, oldest first,
//   each the side whose phone could not encrypt and when (`session_events` `encryption_failed`).
import type { Telemetry, TelemetryEvent } from '@ijazah/contracts/admin';
import type { Interval } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type AttendanceEvent,
  type AttendanceSettings,
  connectedIntervals,
  evaluateAttendance,
} from './attendance.rules.js';
import { attendanceEventsOf } from './evaluation.repository.js';
import { ATTENDANCE_SETTINGS } from './evaluation.service.js';
import { outagesOver, type RecordedOutage, type TelemetrySession } from './review.repository.js';
import { type EncryptionFailureRow, encryptionFailuresOf } from './session-events.repository.js';

const wholeNonNegative = z.int().nonnegative();
const positive = z.number().positive();

/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';

/** What the telemetry reads, each on the caller's transaction with no lock. */
export interface TelemetryStore {
  attendanceEventsOf(tx: Transaction, sessionId: string): Promise<readonly AttendanceEvent[]>;
  outagesOver(tx: Transaction, window: Interval): Promise<readonly RecordedOutage[]>;
  /** T084: the session's encryption failures, oldest first. */
  encryptionFailuresOf(
    tx: Transaction,
    sessionId: string,
  ): Promise<readonly EncryptionFailureRow[]>;
}

export const telemetryStore: TelemetryStore = {
  attendanceEventsOf,
  outagesOver,
  encryptionFailuresOf,
};

export interface TelemetryReader {
  /** The session's connection record (this file's head). */
  of(tx: Transaction, session: TelemetrySession): Promise<Telemetry>;
}

const iso = (instant: Date): string => instant.toISOString();

const spans = (intervals: readonly Interval[]) =>
  intervals.map(({ startsAt, endsAt }) => ({ startsAt: iso(startsAt), endsAt: iso(endsAt) }));

/** One recorded event as the record shows it; an account that is neither party is left out. */
function eventOf(event: AttendanceEvent, session: TelemetrySession): TelemetryEvent | null {
  if (event.kind === 'room_ended') {
    return { party: 'room', type: 'room_ended', occurredAt: iso(event.occurredAt) };
  }
  const party =
    event.userId === session.studentUserId
      ? 'student'
      : event.userId === session.teacherUserId
        ? 'teacher'
        : null;
  if (party === null) return null;
  return {
    party,
    type: event.kind,
    occurredAt: iso(event.occurredAt),
    connectionRef: event.connectionRef,
  };
}

export function createTelemetryReader({
  settings,
  store = telemetryStore,
}: {
  readonly settings: SettingsReader;
  readonly store?: TelemetryStore;
}): TelemetryReader {
  const attendanceSettings = async (): Promise<AttendanceSettings> => ({
    joinWindowMinutes: await settings.read(ATTENDANCE_SETTINGS.joinWindowMinutes, wholeNonNegative),
    minimumConnectionSeconds: await settings.read(
      ATTENDANCE_SETTINGS.minimumConnectionSeconds,
      wholeNonNegative,
    ),
    attendanceThresholdPct: await settings.read(
      ATTENDANCE_SETTINGS.attendanceThresholdPct,
      positive,
    ),
    earlyJoinLeadMinutes: await settings.read(
      ATTENDANCE_SETTINGS.earlyJoinLeadMinutes,
      wholeNonNegative,
    ),
  });

  return {
    of: async (tx, session) => {
      const window: Interval = { startsAt: session.startsAt, endsAt: session.endsAt };
      // One transaction runs one statement at a time, so its reads are awaited in turn.
      const events = await store.attendanceEventsOf(tx, session.id);
      const outages = await store.outagesOver(tx, window);
      const failures = await store.encryptionFailuresOf(tx, session.id);
      const rules = await attendanceSettings();
      const attendanceWindow = {
        ...window,
        teacherUserId: session.teacherUserId,
        studentUserId: session.studentUserId,
        outages,
      };
      const attendance = evaluateAttendance(events, attendanceWindow, rules);
      const intervals = connectedIntervals(events, attendanceWindow);
      return {
        sessionId: session.id,
        schedule: {
          localDate: session.localDate,
          startTimeLocal: session.startTimeLocal.slice(0, -SECONDS.length),
          timezone: session.timezone,
          startsAt: iso(session.startsAt),
          endsAt: iso(session.endsAt),
        },
        status: session.status,
        events: events.flatMap((event) => eventOf(event, session) ?? []),
        intervals: {
          student: spans(intervals.student),
          teacher: spans(intervals.teacher),
          together: spans(intervals.together),
        },
        simultaneousSeconds: session.simultaneousSeconds,
        joined: { student: attendance.studentJoined, teacher: attendance.teacherJoined },
        outages: outages.map(({ id, startsAt, endsAt }) => ({
          outageId: id,
          startsAt: iso(startsAt),
          endsAt: iso(endsAt),
        })),
        encryptionFailures: failures.map(({ party, occurredAt }) => ({
          party,
          occurredAt: iso(occurredAt),
        })),
      };
    },
  };
}
