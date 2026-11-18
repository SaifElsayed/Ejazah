// 005:T017 (FR-619, FR-622, FR-BOOK-8; research R-407; SRS DEC-74; the note under T017): the
// `send-reminder` sweep's decisions, over recorded steps and the notifications module's real writer.
// Every minute, one run at one instant:
//
//   1. THE REMINDERS. For each offset of `reminder_offsets_minutes`, every scheduled session with
//      `scheduled_start_at − offset <= now < scheduled_start_at` and no `session_reminders` row for
//      (session, user, offset) gets one `session_reminder` notification to each party, payload ids
//      only, and its row, on one transaction that binds its own after-commit list, so the push is
//      queued only after the commit and a refused row rolls its notification back. The sessions are
//      read a page at a time, bounded by `now < scheduled_end_at <= now + maxOffset + maxLength`.
//   2. THE RE-SEND (Q-N4 (a)). Every notification with `pushed_at` NULL created in
//      `[now − notification_requeue_max_age_minutes, now − notification_requeue_after_minutes)` is
//      queued again under its own id, a page at a time, one info line per page. An empty window
//      (`after >= max_age`) queues nothing, says so once, and never throws.
//
// Two runs leave what one leaves. The same over the real tables, with the race, is
// `tests/db-integrity/send-reminder.spec.ts`; the window across Cairo's clock changes (T018) is
// `send-reminder-dst.spec.ts`.
import { randomUUID } from 'node:crypto';

import { addMinutes, addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import { NotificationWriter } from '../modules/notifications/index.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import {
  REMINDER_OFFSETS_SETTING,
  type ReminderSteps,
  REQUEUE_AFTER_SETTING,
  REQUEUE_MAX_AGE_SETTING,
  SEND_REMINDER,
  sendReminder,
} from './send-reminder.js';

const NOW = new Date('2026-11-18T08:00:00.000Z');
const MINUTE = 60;
const SECOND = 1;

/** `NOW` moved by `seconds`: the spec's own fixtures, not the job's arithmetic. */
function at(seconds: number): Date {
  return new Date(addSeconds(NOW, seconds));
}

const TEACHER = '0199f6a0-0000-7000-8000-0000000000a1';
const STUDENT = '0199f6a0-0000-7000-8000-0000000000b1';

interface Session {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: 'scheduled' | 'cancelled_by_agreement' | 'completed';
}

interface Notification {
  readonly id: string;
  readonly userId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: Date;
  readonly pushedAt: Date | null;
}

interface Reminder {
  readonly sessionId: string;
  readonly userId: string;
  readonly offsetMinutes: number;
  readonly notificationId: string;
}

/** What one transaction wrote, applied on its commit and forgotten on its rollback. */
interface Staged {
  readonly notifications: Notification[];
  readonly reminders: Reminder[];
  readonly trace: string[];
}

let counter = 0;

/** A session of the two parties starting at `startsAt`, 60 minutes long. */
function session(
  startsAt: Date,
  status: Session['status'] = 'scheduled',
  id: string = uuid(),
  enrollmentId: string = uuid(),
): Session {
  return {
    id,
    enrollmentId,
    teacherUserId: TEACHER,
    studentUserId: STUDENT,
    startsAt,
    endsAt: new Date(addMinutes(startsAt, 60)),
    status,
  };
}

/** A UUID whose order follows the order of creation, as `uuidv7()`'s. */
function uuid(): string {
  counter += 1;
  return `0199f6a0-0000-7000-8000-${String(counter).padStart(12, '0')}`;
}

/** An unpushed notification created at `createdAt`. */
function unpushed(createdAt: Date, pushedAt: Date | null = null): Notification {
  return { id: uuid(), userId: STUDENT, type: 'payment_failed', payload: {}, createdAt, pushedAt };
}

interface Settings {
  readonly offsets?: unknown;
  readonly after?: unknown;
  readonly maxAge?: unknown;
}

function settingsOf({
  offsets = [1440, 15],
  after = 5,
  maxAge = 30,
}: Settings = {}): SettingsReader & {
  keys: string[];
} {
  const values: Record<string, unknown> = {
    [REMINDER_OFFSETS_SETTING]: offsets,
    [REQUEUE_AFTER_SETTING]: after,
    [REQUEUE_MAX_AGE_SETTING]: maxAge,
  };
  return {
    keys: [],
    async read(key, schema) {
      this.keys.push(key);
      if (!(key in values)) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(values[key]);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

interface WorldRows {
  readonly sessions?: Session[];
  readonly notifications?: Notification[];
  readonly reminders?: Reminder[];
  readonly settings?: Settings;
  readonly pageSize?: number;
  /** Runs inside `insertReminder` before it reads the key: another run committing meanwhile. */
  readonly beforeInsert?: (row: Reminder, committed: Reminder[]) => void;
}

function sweepWorld({
  sessions = [],
  notifications = [],
  reminders = [],
  settings = {},
  pageSize = 100,
  beforeInsert,
}: WorldRows = {}) {
  /** The queue, by job id: a second add of one id is the same job. */
  const queued: string[] = [];
  const logs: { level: 'info' | 'warn'; fields: Record<string, unknown>; message: string }[] = [];
  const asked: { sessions: unknown[]; resend: unknown[] } = { sessions: [], resend: [] };
  const committed = { notifications, reminders };
  let transactions = 0;
  let enqueuedDuringTransaction = 0;
  let open = 0;

  /** Each transaction's key shares and notifications, in the order it took them (#148 Major 1). */
  const traces: string[][] = [];
  const stagedOf = (tx: Transaction): Staged => (tx as unknown as { staged: Staged }).staged;
  const database = {
    $transaction: (async (work: (client: Transaction) => Promise<unknown>) => {
      const staged: Staged = { notifications: [], reminders: [], trace: [] };
      // `keyShareRows`' one statement, its ids the first value.
      const $queryRaw = async (_sql: TemplateStringsArray, ids: readonly string[]) => {
        staged.trace.push(`key share ${ids.join(' ')}`);
        return [];
      };
      const tx = { staged, $queryRaw } as unknown as Transaction;
      transactions += 1;
      open += 1;
      try {
        const result = await work(tx);
        committed.notifications.push(...staged.notifications);
        committed.reminders.push(...staged.reminders);
        return result;
      } finally {
        open -= 1;
        if (staged.trace.length > 0) traces.push(staged.trace);
      }
    }) as never,
  };
  const keyOf = (row: Omit<Reminder, 'notificationId'>) =>
    `${row.sessionId}|${row.userId}|${String(row.offsetMinutes)}`;
  const steps: ReminderSteps = {
    scheduledEndingWithin: async (_tx, window, cursor, limit) => {
      asked.sessions.push({ ...window, cursor });
      return sessions
        .filter(
          (one) =>
            one.status === 'scheduled' &&
            one.endsAt > window.after &&
            one.endsAt <= window.upTo &&
            (cursor === undefined || one.id > cursor),
        )
        .sort((one, other) => (one.id < other.id ? -1 : 1))
        .slice(0, limit)
        .map(({ id, enrollmentId, teacherUserId, studentUserId, startsAt }) => ({
          id,
          enrollmentId,
          teacherUserId,
          studentUserId,
          startsAt,
        }));
    },
    remindersOf: async (_tx, sessionIds) =>
      committed.reminders
        .filter((row) => sessionIds.includes(row.sessionId))
        .map(({ sessionId, userId, offsetMinutes }) => ({ sessionId, userId, offsetMinutes })),
    insertReminder: async (tx, row) => {
      beforeInsert?.(row, committed.reminders);
      const staged = stagedOf(tx);
      if ([...committed.reminders, ...staged.reminders].some((one) => keyOf(one) === keyOf(row))) {
        return false;
      }
      staged.reminders.push(row);
      return true;
    },
    unpushedCreatedWithin: async (_tx, window, cursor, limit) => {
      asked.resend.push({ ...window, cursor });
      return committed.notifications
        .filter(
          (one) =>
            one.pushedAt === null &&
            one.createdAt >= window.from &&
            one.createdAt < window.before &&
            (cursor === undefined || one.id > cursor),
        )
        .sort((one, other) => (one.id < other.id ? -1 : 1))
        .slice(0, limit)
        .map(({ id }) => id);
    },
  };
  const log = {
    info: (fields: Record<string, unknown>, message: string) => {
      logs.push({ level: 'info', fields, message });
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      logs.push({ level: 'warn', fields, message });
    },
  };
  const queue = {
    enqueue: async (notificationId: string) => {
      if (open > 0) enqueuedDuringTransaction += 1;
      queued.push(notificationId);
    },
  };
  const writer = new NotificationWriter({
    repository: {
      insert: async (tx, row) => {
        const id = randomUUID();
        stagedOf(tx as Transaction).trace.push(`notification ${row.userId}`);
        stagedOf(tx as Transaction).notifications.push({
          id,
          userId: row.userId,
          type: row.type,
          payload: row.payload,
          createdAt: NOW,
          pushedAt: null,
        });
        return id;
      },
    },
    queue,
    log,
    report: () => undefined,
  });
  const settingsReader = settingsOf(settings);
  const job = sendReminder({
    database,
    settings: settingsReader,
    writer,
    queue,
    log,
    steps,
    clock: () => NOW,
    pageSize,
  });
  return {
    job,
    committed,
    queued,
    logs,
    asked,
    settings: settingsReader,
    traces,
    transactions: () => transactions,
    enqueuedDuringTransaction: () => enqueuedDuringTransaction,
    /** Lets the after-commit enqueues (fire-and-forget in the writer) settle. */
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

type World = ReturnType<typeof sweepWorld>;

async function run(world: World): Promise<void> {
  await world.job.handle({});
  await world.settle();
}

/** The reminders as (session, user, offset), sorted. */
function remindersOf(world: World): string[] {
  return world.committed.reminders
    .map(
      ({ sessionId, userId, offsetMinutes }) => `${sessionId} ${userId} ${String(offsetMinutes)}`,
    )
    .sort();
}

/** The `session_reminder` notifications, without their ids. */
function reminderNotificationsOf(world: World): string[] {
  return world.committed.notifications
    .filter((one) => one.type === 'session_reminder')
    .map((one) => `${one.userId} ${JSON.stringify(one.payload)}`)
    .sort();
}

describe('send-reminder (005:T017)', () => {
  it('is a sweep named send-reminder, every minute, with no payload', () => {
    const { job } = sweepWorld();
    expect([job.name, job.schedule]).toEqual([SEND_REMINDER, '* * * * *']);
  });

  it('reminds at each offset whose window has opened, and not at one not yet due', async () => {
    const s = session(at(20 * MINUTE));
    const world = sweepWorld({ sessions: [s] });

    await run(world);

    expect(remindersOf(world)).toEqual(
      [`${s.id} ${STUDENT} 1440`, `${s.id} ${TEACHER} 1440`].sort(),
    );
  });

  it('reminds at both offsets once both windows have opened', async () => {
    const s = session(at(10 * MINUTE));
    const world = sweepWorld({ sessions: [s] });

    await run(world);

    expect(remindersOf(world)).toEqual(
      [
        `${s.id} ${STUDENT} 1440`,
        `${s.id} ${TEACHER} 1440`,
        `${s.id} ${STUDENT} 15`,
        `${s.id} ${TEACHER} 15`,
      ].sort(),
    );
  });

  it('reminds at exactly start − offset (the window opens on its edge)', async () => {
    const s = session(at(15 * MINUTE));
    const world = sweepWorld({ sessions: [s], settings: { offsets: [15] } });

    await run(world);

    expect(remindersOf(world)).toEqual([`${s.id} ${STUDENT} 15`, `${s.id} ${TEACHER} 15`].sort());
  });

  it('does not remind a second before start − offset', async () => {
    const s = session(at(15 * MINUTE + SECOND));
    const world = sweepWorld({ sessions: [s], settings: { offsets: [15] } });

    await run(world);

    expect(remindersOf(world)).toEqual([]);
  });

  it('does not remind a session starting now (the window closes at the start)', async () => {
    const s = session(NOW);
    const world = sweepWorld({ sessions: [s], settings: { offsets: [1440, 15] } });

    await run(world);

    expect(remindersOf(world)).toEqual([]);
  });

  it('skips a session no longer scheduled', async () => {
    const world = sweepWorld({
      sessions: [session(at(10 * MINUTE), 'cancelled_by_agreement')],
    });

    await run(world);

    expect(remindersOf(world)).toEqual([]);
    expect(world.queued).toEqual([]);
  });

  it('records one session_reminder to each party, ids only, each with its own row', async () => {
    const s = session(at(20 * MINUTE));
    const world = sweepWorld({ sessions: [s], settings: { offsets: [1440] } });

    await run(world);

    const payload = JSON.stringify({ sessionId: s.id, enrollmentId: s.enrollmentId });
    expect(reminderNotificationsOf(world)).toEqual(
      [`${STUDENT} ${payload}`, `${TEACHER} ${payload}`].sort(),
    );
    for (const reminder of world.committed.reminders) {
      const notification = world.committed.notifications.find(
        (one) => one.id === reminder.notificationId,
      );
      expect(notification?.userId).toBe(reminder.userId);
    }
  });

  it('key-shares both parties first in each transaction, in id order, in one call (#148 Saif r1, Major 1)', async () => {
    const LATER_TEACHER = '0199f6a0-0000-7000-8000-0000000000c1';
    const first = session(at(20 * MINUTE));
    const second = { ...session(at(20 * MINUTE)), teacherUserId: LATER_TEACHER };
    const world = sweepWorld({ sessions: [first, second], settings: { offsets: [1440] } });

    await run(world);

    expect(world.traces).toEqual([
      [`key share ${TEACHER} ${STUDENT}`, `notification ${TEACHER}`, `notification ${STUDENT}`],
      [
        `key share ${STUDENT} ${LATER_TEACHER}`,
        `notification ${LATER_TEACHER}`,
        `notification ${STUDENT}`,
      ],
    ]);
  });

  it('queues each reminder’s push under its notification’s id, only after its commit', async () => {
    const s = session(at(20 * MINUTE));
    const world = sweepWorld({ sessions: [s], settings: { offsets: [1440] } });

    await run(world);

    expect(world.queued).toHaveLength(2);
    expect([...world.queued].sort()).toEqual(
      world.committed.notifications.map(({ id }) => id).sort(),
    );
    expect(world.enqueuedDuringTransaction()).toBe(0);
  });

  it('does not remind a party already reminded at that offset, and still reminds the other', async () => {
    const s = session(at(20 * MINUTE));
    const world = sweepWorld({
      sessions: [s],
      settings: { offsets: [1440] },
      reminders: [
        { sessionId: s.id, userId: TEACHER, offsetMinutes: 1440, notificationId: uuid() },
      ],
    });

    await run(world);

    expect(remindersOf(world)).toEqual(
      [`${s.id} ${STUDENT} 1440`, `${s.id} ${TEACHER} 1440`].sort(),
    );
    expect(reminderNotificationsOf(world)).toHaveLength(1);
    expect(world.logs.filter((line) => line.fields.reason === 'already_reminded')).toEqual([]);
  });

  it('rolls a reminder back with its notification when another run recorded it meanwhile', async () => {
    const s = session(at(20 * MINUTE));
    const world = sweepWorld({
      sessions: [s],
      settings: { offsets: [1440] },
      // Another run commits both rows between this run's read and its write.
      beforeInsert: (row, committed) => {
        if (committed.some((one) => one.sessionId === row.sessionId)) return;
        committed.push(
          { sessionId: s.id, userId: TEACHER, offsetMinutes: 1440, notificationId: uuid() },
          { sessionId: s.id, userId: STUDENT, offsetMinutes: 1440, notificationId: uuid() },
        );
      },
    });

    await run(world);

    expect(remindersOf(world)).toHaveLength(2);
    expect(reminderNotificationsOf(world)).toEqual([]);
    expect(world.queued).toEqual([]);
    expect(world.logs.filter((line) => line.fields.reason === 'already_reminded')).toEqual([
      {
        level: 'info',
        fields: { sessionId: s.id, offsetMinutes: 1440, reason: 'already_reminded' },
        message: expect.any(String),
      },
    ]);
  });

  it('reads the sessions through the end-time window now < end <= now + maxOffset + maxLength', async () => {
    const world = sweepWorld({ settings: { offsets: [15, 1440] } });

    await run(world);

    expect(world.asked.sessions).toEqual([
      { after: NOW, upTo: at((1440 + 60) * MINUTE), cursor: undefined },
    ]);
  });

  it('reads the sessions a page at a time, in id order after the last one read', async () => {
    const sessions = [session(at(20 * MINUTE)), session(at(30 * MINUTE)), session(at(40 * MINUTE))];
    const world = sweepWorld({ sessions, settings: { offsets: [1440] }, pageSize: 2 });

    await run(world);

    expect(world.asked.sessions.map((one) => (one as { cursor?: string }).cursor)).toEqual([
      undefined,
      sessions[1]?.id,
    ]);
    expect(remindersOf(world)).toHaveLength(6);
  });

  it('reads no session when no offset is set, and says so', async () => {
    const world = sweepWorld({ sessions: [session(at(10 * MINUTE))], settings: { offsets: [] } });

    await run(world);

    expect(world.asked.sessions).toEqual([]);
    expect(world.logs.filter((line) => line.fields.reason === 'no_reminder_offsets')).toHaveLength(
      1,
    );
  });
});

describe('send-reminder: the re-send of a lost enqueue (005:T017, Q-N4 (a), SRS DEC-74)', () => {
  it('asks for the unpushed rows created in [now − max_age, now − after)', async () => {
    const world = sweepWorld({ settings: { after: 5, maxAge: 30 } });

    await run(world);

    expect(world.asked.resend).toEqual([
      { from: at(-30 * MINUTE), before: at(-5 * MINUTE), cursor: undefined },
    ]);
  });

  it('queues again, under its own id, a row inside the window and none outside it', async () => {
    const inside = unpushed(at(-5 * MINUTE - SECOND));
    const oldest = unpushed(at(-30 * MINUTE));
    const tooYoung = unpushed(at(-5 * MINUTE + SECOND));
    const tooOld = unpushed(at(-30 * MINUTE - SECOND));
    const pushed = unpushed(at(-10 * MINUTE), at(-9 * MINUTE));
    const world = sweepWorld({ notifications: [inside, oldest, tooYoung, tooOld, pushed] });

    await run(world);

    expect([...world.queued].sort()).toEqual([inside.id, oldest.id].sort());
  });

  it('logs one line per page, with its count and its ids range and nothing else', async () => {
    const rows = [1, 2, 3].map((n) => unpushed(at(-10 * MINUTE - n * SECOND)));
    const world = sweepWorld({ notifications: rows, pageSize: 2 });

    await run(world);

    expect(world.queued).toEqual(rows.map(({ id }) => id));
    expect(world.logs.filter((line) => line.fields.reason === 'lost_enqueue_requeued')).toEqual([
      {
        level: 'info',
        fields: {
          count: 2,
          firstId: rows[0]?.id,
          lastId: rows[1]?.id,
          reason: 'lost_enqueue_requeued',
        },
        message: expect.any(String),
      },
      {
        level: 'info',
        fields: {
          count: 1,
          firstId: rows[2]?.id,
          lastId: rows[2]?.id,
          reason: 'lost_enqueue_requeued',
        },
        message: expect.any(String),
      },
    ]);
  });

  it.each([
    ['equal', 30, 30],
    ['after the maximum age', 40, 30],
  ])(
    'queues nothing when the wait is %s, says so once, never throws, and still reminds',
    async (_case, after, maxAge) => {
      const s = session(at(20 * MINUTE));
      const world = sweepWorld({
        sessions: [s],
        notifications: [unpushed(at(-10 * MINUTE))],
        settings: { offsets: [1440], after, maxAge },
      });

      await expect(world.job.handle({})).resolves.toBeUndefined();
      await world.settle();

      expect(world.asked.resend).toEqual([]);
      expect(world.logs.filter((line) => line.fields.reason === 'requeue_window_empty')).toEqual([
        {
          level: 'info',
          fields: { afterMinutes: after, maxAgeMinutes: maxAge, reason: 'requeue_window_empty' },
          message: expect.any(String),
        },
      ]);
      expect(remindersOf(world)).toHaveLength(2);
      expect([...world.queued].sort()).toEqual(
        world.committed.notifications
          .filter((one) => one.type === 'session_reminder')
          .map(({ id }) => id)
          .sort(),
      );
    },
  );

  it('reads its three settings on every run', async () => {
    const world = sweepWorld();

    await run(world);

    expect([...world.settings.keys].sort()).toEqual(
      [REMINDER_OFFSETS_SETTING, REQUEUE_AFTER_SETTING, REQUEUE_MAX_AGE_SETTING].sort(),
    );
  });
});

describe('send-reminder: idempotent (R-API-14)', () => {
  it('leaves after two runs what it leaves after one', async () => {
    const ids = [uuid(), uuid(), uuid(), uuid()];
    const reading = await runOnceAndTwice({
      world: () => {
        const [first = '', second = '', firstEnrollment = '', secondEnrollment = ''] = ids;
        return sweepWorld({
          sessions: [
            session(at(10 * MINUTE), 'scheduled', first, firstEnrollment),
            session(at(20 * MINUTE), 'scheduled', second, secondEnrollment),
          ],
          notifications: [unpushed(at(-10 * MINUTE))],
        });
      },
      run,
      observe: (world) => ({
        reminders: remindersOf(world),
        notifications: reminderNotificationsOf(world),
        // The queue holds one job per id: a second add of an id is the same job.
        queuedIds: new Set(world.queued).size,
        alreadyReminded: world.logs.filter((line) => line.fields.reason === 'already_reminded')
          .length,
      }),
    });

    expect(reading.once).toMatchObject({ queuedIds: 7, alreadyReminded: 0 });
    expect((reading.once as { reminders: string[] }).reminders).toHaveLength(6);
    expect(reading.twice).toEqual(reading.once);
  });
});
