// T013 (FR-442, FR-443, FR-444; R-SESS-4; research R-305): a session's outcome from its recorded
// attendance, decided once by the evaluation (T014) after the scheduled end. Pure: no database, no
// clock, no setting read and no log; the caller hands in the session's events
// (`session_participant_events`), its window, the outage windows overlapping it (`provider_outages`)
// and the four settings, and writes what comes back. Instant arithmetic is `@ijazah/time`'s
// (R-TIME-1); here only whole seconds are compared.
//
// 1. Per connection (`connection_ref`): an interval from its `joined` to its first later `left`; a
//    `left` with no open interval ignored; a connection never left closing at the first `room_ended`
//    at or after its join, or at the scheduled end, whichever is first; nothing past the scheduled
//    end. A connection beginning at or after the scheduled end is dropped here, before any of T003's
//    operations sees it: `intervalsOf` refuses an inverted interval with `TimeError`, which would
//    fail the evaluation every minute and leave the session unevaluated (R-SESS-2; the owner's
//    decision of 2026-11-06 on T003's signatures).
// 2. Per participant: the union of their connections.
// 3. Joined (FR-442): a connection began no later than start + `joinWindowMinutes`, and the union
//    within [start − `earlyJoinLeadMinutes`, end] measures at least `minimumConnectionSeconds`.
// 4. Simultaneous (FR-443, R-SESS-4): the intersection of the two unions, clipped to [start, end].
// 5. The outcome by SRS §3.7.5's table, an outage window overlapping [start, end] first; `done` at
//    ⌈`attendanceThresholdPct` % × length⌉ seconds or more.
//
// TIES at one second (LiveKit's resolution, R-305): every instant is floored to its second before
// anything is compared, and within one connection a `left` sorts before a `joined` of the same
// second. R-305's other half, `joined` before `left` for different connections, changes nothing
// here: intervals are paired per connection, and touching intervals of one participant unite.
// Sorting on the second and the kind alone makes the result independent of the events' order and
// of a duplicate (a second `joined` while open, or a second `left` while closed, is ignored). As
// R-305 is written, a connection whose `joined` and `left` fall in one second stays open: its leave
// sorts first and finds nothing open.
import type { SessionStatus } from '@ijazah/contracts';
import {
  addMinutes,
  addSeconds,
  clip,
  intersect,
  type Interval,
  measureSeconds,
  union,
  unixSeconds,
} from '@ijazah/time';

/**
 * One `session_participant_events` row as the rules read it: `kind` is its `event_type`. A
 * participant's event carries its `user_id` and `connection_ref`; `room_ended` carries neither (ERD
 * §15 rule 41).
 */
export type AttendanceEvent =
  | {
      readonly kind: 'joined' | 'left';
      readonly userId: string;
      readonly connectionRef: string;
      readonly occurredAt: Date;
    }
  | { readonly kind: 'room_ended'; readonly occurredAt: Date };

/**
 * The session being evaluated: its scheduled start and end (`sessions.scheduled_start_at` and
 * `scheduled_end_at`), its two participants, and the `provider_outages` windows the caller found
 * overlapping it (any given that do not overlap are ignored).
 */
export interface AttendanceWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly outages: readonly Interval[];
}

/** The settings `join_window_minutes`, `minimum_connection_seconds`, `attendance_threshold_pct`, `early_join_lead_minutes`. */
export interface AttendanceSettings {
  readonly joinWindowMinutes: number;
  readonly minimumConnectionSeconds: number;
  readonly attendanceThresholdPct: number;
  readonly earlyJoinLeadMinutes: number;
}

/** The six settled rows of SRS §3.7.5's table. */
export type AttendanceOutcome = Extract<
  SessionStatus,
  | 'done'
  | 'student_no_show'
  | 'teacher_no_show'
  | 'both_no_show'
  | 'under_threshold'
  | 'provider_outage'
>;

/**
 * The evaluation's answer: the outcome, the simultaneous seconds it was decided on (written once to
 * `sessions.simultaneous_connected_seconds`, R-DB-4), and who joined by FR-442.
 */
export interface Attendance {
  readonly outcome: AttendanceOutcome;
  readonly simultaneousSeconds: number;
  readonly teacherJoined: boolean;
  readonly studentJoined: boolean;
}

/** The epoch, from which a span's whole seconds count (`unixSeconds`). */
const EPOCH = new Date(0);

/** Within one connection's second, a `left` before a `joined` (R-305). */
const TIE_RANK = { left: 0, joined: 1 } as const;

interface Mark {
  readonly second: number;
  readonly kind: 'joined' | 'left';
}

/** A span of whole epoch seconds, `[start, end)`. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/** A span's instants, built by `@ijazah/time` (R-TIME-1). */
function intervalOf(span: Span): Interval {
  return {
    startsAt: new Date(addSeconds(EPOCH, span.start)),
    endsAt: new Date(addSeconds(EPOCH, span.end)),
  };
}

/**
 * One connection's spans (step 1), each ending at the scheduled end at the latest, a span beginning
 * at or after it dropped. `roomEnds` is sorted.
 */
function connectionSpans(marks: Mark[], roomEnds: readonly number[], endSecond: number): Span[] {
  marks.sort((a, b) => a.second - b.second || TIE_RANK[a.kind] - TIE_RANK[b.kind]);
  const spans: Span[] = [];
  let open: number | undefined;
  for (const mark of marks) {
    if (mark.kind === 'joined') {
      open ??= mark.second;
    } else if (open !== undefined) {
      spans.push({ start: open, end: mark.second });
      open = undefined;
    }
  }
  if (open !== undefined) {
    const from = open;
    const roomEnd = roomEnds.find((second) => second >= from);
    spans.push({ start: from, end: Math.min(roomEnd ?? endSecond, endSecond) });
  }
  return spans
    .filter((span) => span.start < endSecond)
    .map((span) => ({ start: span.start, end: Math.min(span.end, endSecond) }));
}

/** Each participant's connections' spans, keyed by user id (steps 1 and 2's input). */
function spansByUser(events: readonly AttendanceEvent[], endSecond: number): Map<string, Span[]> {
  const roomEnds = events
    .filter((event) => event.kind === 'room_ended')
    .map((event) => unixSeconds(event.occurredAt))
    .sort((a, b) => a - b);
  const connections = new Map<string, { userId: string; marks: Mark[] }>();
  for (const event of events) {
    if (event.kind === 'room_ended') continue;
    // A connection belongs to one user; keyed by both so a reference repeated across users stays apart.
    const key = JSON.stringify([event.userId, event.connectionRef]);
    let connection = connections.get(key);
    if (connection === undefined) {
      connection = { userId: event.userId, marks: [] };
      connections.set(key, connection);
    }
    connection.marks.push({ second: unixSeconds(event.occurredAt), kind: event.kind });
  }
  const byUser = new Map<string, Span[]>();
  for (const { userId, marks } of connections.values()) {
    const spans = connectionSpans(marks, roomEnds, endSecond);
    byUser.set(userId, [...(byUser.get(userId) ?? []), ...spans]);
  }
  return byUser;
}

interface Participation {
  readonly union: Interval[];
  readonly joined: boolean;
}

/** A participant's union (step 2) and whether they joined (step 3). */
function participationOf(
  spans: readonly Span[],
  window: AttendanceWindow,
  settings: AttendanceSettings,
): Participation {
  const lastJoinSecond = unixSeconds(
    new Date(addMinutes(window.startsAt, settings.joinWindowMinutes)),
  );
  const joinBounds: Interval = {
    startsAt: new Date(addMinutes(window.startsAt, -settings.earlyJoinLeadMinutes)),
    endsAt: window.endsAt,
  };
  const connected = union(spans.map(intervalOf));
  const beganInWindow = spans.some((span) => span.start <= lastJoinSecond);
  const joined =
    beganInWindow &&
    measureSeconds(clip(connected, joinBounds)) >= settings.minimumConnectionSeconds;
  return { union: connected, joined };
}

/**
 * A session's outcome from its recorded attendance (research R-305; FR-442, FR-443, FR-444). Never
 * throws for any order, duplicate or timing of the events, including a connection begun in the last
 * second or after the end; the window and the outages must not be inverted (the database's checks).
 */
export function evaluateAttendance(
  events: readonly AttendanceEvent[],
  window: AttendanceWindow,
  settings: AttendanceSettings,
): Attendance {
  const scheduled: Interval = { startsAt: window.startsAt, endsAt: window.endsAt };
  const byUser = spansByUser(events, unixSeconds(window.endsAt));
  const teacher = participationOf(byUser.get(window.teacherUserId) ?? [], window, settings);
  const student = participationOf(byUser.get(window.studentUserId) ?? [], window, settings);
  const simultaneousSeconds = measureSeconds(
    clip(intersect(teacher.union, student.union), scheduled),
  );
  const thresholdSeconds = Math.ceil(
    (settings.attendanceThresholdPct * measureSeconds([scheduled])) / 100,
  );
  return {
    outcome: outcomeOf(
      clip(window.outages, scheduled).length > 0,
      teacher.joined,
      student.joined,
      simultaneousSeconds >= thresholdSeconds,
    ),
    simultaneousSeconds,
    teacherJoined: teacher.joined,
    studentJoined: student.joined,
  };
}

/** SRS §3.7.5's table, the outage first (FR-444). */
function outcomeOf(
  outage: boolean,
  teacherJoined: boolean,
  studentJoined: boolean,
  reachedThreshold: boolean,
): AttendanceOutcome {
  if (outage) return 'provider_outage';
  if (teacherJoined && studentJoined) return reachedThreshold ? 'done' : 'under_threshold';
  if (teacherJoined) return 'student_no_show';
  if (studentJoined) return 'teacher_no_show';
  return 'both_no_show';
}
