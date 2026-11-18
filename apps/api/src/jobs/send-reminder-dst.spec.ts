// 005:T018 (FR-622; R-TIME-1, R-TIME-2, R-TIME-7): the reminder's window is computed from instants,
// never from wall-clock local times, so across Cairo's clock changes each offset reminds exactly that
// many minutes of real time before the session's start, neither an hour early nor an hour late.
//
// The transitions are the ones `packages/time/src/resolve.spec.ts` recorded from the runtime's data
// (Node 24, tz 2025b):
//
//   gap     2025-04-24T22:00:00Z: local 2025-04-25 00:00 (+02:00) becomes 01:00 (+03:00)
//   overlap 2025-10-30T21:00:00Z: local 2025-10-31 00:00 (+03:00) becomes 2025-10-30 23:00 (+02:00)
//
// Two sessions, each starting five minutes after a change, so both offsets reach back across it:
//
//   spring  local 2025-04-25 01:05 (+03:00) = 2025-04-24T22:05:00Z
//           1440 → 2025-04-23T22:05:00Z (local 2025-04-24 00:05, +02:00: 23 wall-clock hours before)
//           15   → 2025-04-24T21:50:00Z (local 2025-04-24 23:50, +02:00, before the gap)
//   autumn  local 2025-10-31 00:05 (+02:00) = 2025-10-30T22:05:00Z
//           1440 → 2025-10-29T22:05:00Z (local 2025-10-30 01:05, +03:00: 25 wall-clock hours before)
//           15   → 2025-10-30T21:50:00Z (local 2025-10-30 23:50, +02:00, the hour's second pass)
//
// A window computed on the wall clock (the local start less the offset, resolved in the zone) is an
// hour late for the spring session and an hour early for the autumn one, at both offsets; one read
// with a fixed +02:00 is an hour late in summer. Each case asserts the session is not reminded a
// second before its instant and is reminded at it. The expected instants are written literally,
// each derived from an offset stated above, and each session's start is checked against
// `resolveLocalDateTime`, as generation resolves it.
import { resolveLocalDateTime } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../platform/db/prisma.repository.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import {
  REMINDER_OFFSETS_SETTING,
  type ReminderSteps,
  REQUEUE_AFTER_SETTING,
  REQUEUE_MAX_AGE_SETTING,
  sendReminder,
} from './send-reminder.js';

const CAIRO = 'Africa/Cairo';
const SESSION = '0199f6a0-0000-7000-8000-00000000d001';
const ENROLLMENT = '0199f6a0-0000-7000-8000-00000000e001';
const TEACHER = '0199f6a0-0000-7000-8000-0000000000a1';
const STUDENT = '0199f6a0-0000-7000-8000-0000000000b1';

interface Case {
  readonly change: 'spring' | 'autumn';
  readonly localDate: string;
  readonly localTime: string;
  readonly startsAt: string;
  readonly offset: 1440 | 15;
  readonly due: string;
  readonly secondBefore: string;
}

const CASES: readonly Case[] = [
  {
    change: 'spring',
    localDate: '2025-04-25',
    localTime: '01:05:00',
    startsAt: '2025-04-24T22:05:00Z',
    offset: 1440,
    due: '2025-04-23T22:05:00Z',
    secondBefore: '2025-04-23T22:04:59Z',
  },
  {
    change: 'spring',
    localDate: '2025-04-25',
    localTime: '01:05:00',
    startsAt: '2025-04-24T22:05:00Z',
    offset: 15,
    due: '2025-04-24T21:50:00Z',
    secondBefore: '2025-04-24T21:49:59Z',
  },
  {
    change: 'autumn',
    localDate: '2025-10-31',
    localTime: '00:05:00',
    startsAt: '2025-10-30T22:05:00Z',
    offset: 1440,
    due: '2025-10-29T22:05:00Z',
    secondBefore: '2025-10-29T22:04:59Z',
  },
  {
    change: 'autumn',
    localDate: '2025-10-31',
    localTime: '00:05:00',
    startsAt: '2025-10-30T22:05:00Z',
    offset: 15,
    due: '2025-10-30T21:50:00Z',
    secondBefore: '2025-10-30T21:49:59Z',
  },
];

function settingsOf(offset: number): SettingsReader {
  const values: Record<string, unknown> = {
    [REMINDER_OFFSETS_SETTING]: [offset],
    [REQUEUE_AFTER_SETTING]: 5,
    [REQUEUE_MAX_AGE_SETTING]: 30,
  };
  return { read: async (key, schema) => schema.parse(values[key]) };
}

/** The users the sweep reminds of `testCase`'s session when it runs at `now`. */
async function remindedAt(testCase: Case, now: string): Promise<string[]> {
  const reminded: string[] = [];
  const steps: ReminderSteps = {
    // The page holds the session whatever the end-time bound: the bound is the index's (its window
    // asked is the unit spec's), and with one offset it would hide an early reminder, so the start's
    // window alone decides here.
    scheduledEndingWithin: async (_tx, _window, cursor) =>
      cursor === undefined
        ? [
            {
              id: SESSION,
              enrollmentId: ENROLLMENT,
              teacherUserId: TEACHER,
              studentUserId: STUDENT,
              startsAt: new Date(testCase.startsAt),
            },
          ]
        : [],
    remindersOf: async () => [],
    insertReminder: async (_tx, row) => {
      reminded.push(row.userId);
      return true;
    },
    unpushedCreatedWithin: async () => [],
  };
  const job = sendReminder({
    database: {
      // `$queryRaw`: the parties' key share (#148 Saif r1, Major 1), which locks nothing here.
      $transaction: (async (work: (tx: Transaction) => Promise<unknown>) =>
        work({ $queryRaw: async () => [] } as unknown as Transaction)) as never,
    },
    settings: settingsOf(testCase.offset),
    writer: { record: async () => ({ notificationId: '0199f6a0-0000-7000-8000-00000000c001' }) },
    queue: { enqueue: async () => undefined },
    log: { info: () => undefined, warn: () => undefined },
    steps,
    clock: () => new Date(now),
  });
  await job.handle({});
  return reminded.sort();
}

describe('send-reminder across Cairo’s clock changes (005:T018, FR-622, R-TIME-1)', () => {
  it.each(CASES)(
    'the $change session is reminded $offset minutes of real time before its start',
    async (testCase) => {
      const resolved = resolveLocalDateTime({
        localDate: testCase.localDate,
        localTime: testCase.localTime,
        timezone: CAIRO,
      });
      expect([resolved.startsAt, resolved.disambiguation]).toEqual([testCase.startsAt, 'exact']);

      expect(await remindedAt(testCase, testCase.secondBefore)).toEqual([]);
      expect(await remindedAt(testCase, testCase.due)).toEqual([STUDENT, TEACHER].sort());
    },
  );
});
