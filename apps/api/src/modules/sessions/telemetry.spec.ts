// T033 of specs/004-sessions/tasks.md (FR-477, FR-SESS-9; research R-305, R-323 GAP-2;
// contracts/admin-surface.md, `Telemetry`) — `createTelemetryReader` over a recorded store: the
// schedule as the session holds it (`HH:MM`), every recorded join, leave and room end oldest first
// named by party (an account neither party's left out), each party's connected intervals and the
// two together by T013's rules, the simultaneous seconds the evaluation recorded (never
// recomputed, ADR 0022), who joined by FR-442 under the four settings, and the outage windows.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { AttendanceEvent } from './attendance.rules.js';
import type { TelemetrySession } from './review.repository.js';
import { createTelemetryReader } from './telemetry.js';

const tx = {} as Transaction;
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000b1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b2';
const STRANGER = '0199d0a0-0000-7000-8000-0000000000b3';
const OUTAGE = '0199d0a0-0000-7000-8000-0000000000c1';

const SESSION_ROW: TelemetrySession = {
  id: SESSION,
  enrollmentId: '0199d0a0-0000-7000-8000-0000000000e1',
  localDate: '2026-11-01' as TelemetrySession['localDate'],
  startTimeLocal: '08:00:00' as TelemetrySession['startTimeLocal'],
  timezone: 'Africa/Cairo',
  startsAt: new Date('2026-11-01T06:00:00Z'),
  endsAt: new Date('2026-11-01T07:00:00Z'),
  status: 'under_threshold',
  outcomeUnderDispute: null,
  simultaneousSeconds: 1180,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
};

const EVENTS: readonly AttendanceEvent[] = [
  {
    kind: 'joined',
    userId: TEACHER,
    connectionRef: 'PA_t1',
    occurredAt: new Date('2026-11-01T06:00:05Z'),
  },
  {
    kind: 'joined',
    userId: STUDENT,
    connectionRef: 'PA_s1',
    occurredAt: new Date('2026-11-01T06:10:00Z'),
  },
  {
    kind: 'joined',
    userId: STRANGER,
    connectionRef: 'PA_x',
    occurredAt: new Date('2026-11-01T06:11:00Z'),
  },
  {
    kind: 'left',
    userId: TEACHER,
    connectionRef: 'PA_t1',
    occurredAt: new Date('2026-11-01T06:30:00Z'),
  },
  { kind: 'room_ended', occurredAt: new Date('2026-11-01T07:00:00Z') },
];

const SETTINGS: Readonly<Record<string, number>> = {
  join_window_minutes: 15,
  minimum_connection_seconds: 300,
  attendance_threshold_pct: 80,
  early_join_lead_minutes: 10,
};

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!(key in SETTINGS)) throw new Error(`unexpected setting ${key}`);
    return schema.parse(SETTINGS[key]);
  },
};

describe('createTelemetryReader (FR-477, FR-SESS-9)', () => {
  it('answers the schedule, the events by party, the intervals, the recorded figure, who joined and the outages', async () => {
    const read: string[] = [];
    const reader = createTelemetryReader({
      settings,
      store: {
        attendanceEventsOf: async (_tx, sessionId) => {
          read.push(`events ${sessionId}`);
          return EVENTS;
        },
        outagesOver: async (_tx, window) => {
          read.push(`outages ${window.startsAt.toISOString()} ${window.endsAt.toISOString()}`);
          return [
            {
              id: OUTAGE,
              startsAt: new Date('2026-11-01T06:40:00Z'),
              endsAt: new Date('2026-11-01T06:45:00Z'),
            },
          ];
        },
      },
    });
    expect(await reader.of(tx, SESSION_ROW)).toEqual({
      sessionId: SESSION,
      schedule: {
        localDate: '2026-11-01',
        startTimeLocal: '08:00',
        timezone: 'Africa/Cairo',
        startsAt: '2026-11-01T06:00:00.000Z',
        endsAt: '2026-11-01T07:00:00.000Z',
      },
      status: 'under_threshold',
      events: [
        {
          party: 'teacher',
          type: 'joined',
          occurredAt: '2026-11-01T06:00:05.000Z',
          connectionRef: 'PA_t1',
        },
        {
          party: 'student',
          type: 'joined',
          occurredAt: '2026-11-01T06:10:00.000Z',
          connectionRef: 'PA_s1',
        },
        {
          party: 'teacher',
          type: 'left',
          occurredAt: '2026-11-01T06:30:00.000Z',
          connectionRef: 'PA_t1',
        },
        { party: 'room', type: 'room_ended', occurredAt: '2026-11-01T07:00:00.000Z' },
      ],
      intervals: {
        student: [{ startsAt: '2026-11-01T06:10:00.000Z', endsAt: '2026-11-01T07:00:00.000Z' }],
        teacher: [{ startsAt: '2026-11-01T06:00:05.000Z', endsAt: '2026-11-01T06:30:00.000Z' }],
        together: [{ startsAt: '2026-11-01T06:10:00.000Z', endsAt: '2026-11-01T06:30:00.000Z' }],
      },
      // The figure the evaluation recorded, not the 1200 the intervals measure (ADR 0022).
      simultaneousSeconds: 1180,
      joined: { student: true, teacher: true },
      outages: [
        {
          outageId: OUTAGE,
          startsAt: '2026-11-01T06:40:00.000Z',
          endsAt: '2026-11-01T06:45:00.000Z',
        },
      ],
    });
    expect(read).toEqual([
      `events ${SESSION}`,
      'outages 2026-11-01T06:00:00.000Z 2026-11-01T07:00:00.000Z',
    ]);
  });

  it('answers the recorded figure even where the intervals measure otherwise, and no join for no event', async () => {
    const reader = createTelemetryReader({
      settings,
      store: { attendanceEventsOf: async () => [], outagesOver: async () => [] },
    });
    const answer = await reader.of(tx, { ...SESSION_ROW, simultaneousSeconds: 77 });
    expect(answer.simultaneousSeconds).toBe(77);
    expect(answer.intervals).toEqual({ student: [], teacher: [], together: [] });
    expect(answer.joined).toEqual({ student: false, teacher: false });
    expect(answer.events).toEqual([]);
  });
});
