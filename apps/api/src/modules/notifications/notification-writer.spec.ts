// T005 of specs/005-certification (FR-619, FR-620; R-406): the one writer of `notifications`, over a
// scripted transaction (what it asks of the table, not Postgres). It writes the row with the kind's
// keys on the caller's transaction and enqueues `deliver-notification` only once that transaction
// has committed (the after-commit list bound to it is flushed), never on a rollback; it refuses a
// transaction with no list bound, a payload that is not identifiers, and, by type, any kind but the
// seven of v1.0 (`pnpm typecheck` holds the `@ts-expect-error` lines).
import { describe, expect, it, vi } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { bindToTransaction, RequestLive, unboundBus } from '../../platform/live/live-publisher.js';
import {
  NOTIFICATION_KINDS,
  NotificationWriter,
  type NotificationKind,
  type NotificationRecord,
} from './notification-writer.js';
import { NotificationsRepository } from './notifications.repository.js';

const NOTIFICATION = '0199f6a0-0000-7000-8000-00000000c001';
const USER = '0199f6a0-0000-7000-8000-0000000000a1';
const SESSION = '0199f6a0-0000-7000-8000-00000000f001';

interface Line {
  readonly level: 'info' | 'warn';
  readonly fields: Readonly<Record<string, unknown>>;
}

function worldOf({ enqueueFails = false }: { enqueueFails?: boolean } = {}) {
  const create = vi.fn(async (_args: unknown) => ({ id: NOTIFICATION }));
  const tx = { notification: { create } } as unknown as Transaction;
  const enqueued: string[] = [];
  const lines: Line[] = [];
  const reported: unknown[] = [];
  const log = {
    info: (fields: Readonly<Record<string, unknown>>) => void lines.push({ level: 'info', fields }),
    warn: (fields: Readonly<Record<string, unknown>>) => void lines.push({ level: 'warn', fields }),
  };
  const writer = new NotificationWriter({
    repository: new NotificationsRepository({} as never),
    queue: {
      enqueue: async (id) => {
        if (enqueueFails) throw new Error('queue unreachable');
        enqueued.push(id);
      },
    },
    log,
    report: (error) => void reported.push(error),
  });
  const list = new RequestLive(unboundBus, log);
  return { tx, create, enqueued, lines, reported, writer, list };
}

const reminder: NotificationRecord = {
  userId: USER,
  type: 'session_reminder',
  payload: { sessionId: SESSION },
};

/** Lets the work queued after the commit settle. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

describe('NotificationWriter.record (T005, R-406)', () => {
  it("writes the row with the kind's keys and the ids on the caller's transaction", async () => {
    const world = worldOf();
    const unbind = bindToTransaction(world.tx, world.list);

    await expect(world.writer.record(world.tx, reminder)).resolves.toEqual({
      notificationId: NOTIFICATION,
    });
    unbind();

    expect(world.create).toHaveBeenCalledWith({
      data: {
        userId: USER,
        type: 'session_reminder',
        titleKey: 'notifications.push.session_reminder.title',
        bodyKey: 'notifications.push.session_reminder.body',
        payload: { session_id: SESSION },
      },
      select: { id: true },
    });
  });

  it('enqueues deliver-notification only once the transaction has committed', async () => {
    const world = worldOf();
    const unbind = bindToTransaction(world.tx, world.list);
    await world.writer.record(world.tx, reminder);
    unbind();
    await settled();
    expect(world.enqueued).toEqual([]);

    world.list.flush();
    await settled();

    expect(world.enqueued).toEqual([NOTIFICATION]);
  });

  it('enqueues nothing when the transaction rolls back', async () => {
    const world = worldOf();
    const unbind = bindToTransaction(world.tx, world.list);
    await world.writer.record(world.tx, reminder);
    unbind();

    world.list.drop();
    world.list.flush();
    await settled();

    expect(world.enqueued).toEqual([]);
  });

  it('refuses a transaction with no after-commit list bound, writing nothing (Q-E1-2)', async () => {
    const world = worldOf();

    await expect(world.writer.record(world.tx, reminder)).rejects.toThrow(/after-commit list/);

    expect(world.create).not.toHaveBeenCalled();
    expect(world.lines).toEqual([
      {
        level: 'info',
        fields: { userId: USER, type: 'session_reminder', reason: 'no_after_commit_list' },
      },
    ]);
  });

  it.each([
    ['a name in an identifier field', { sessionId: 'Ahmed Ali' }],
    ['a key that is not an identifier', { sessionId: SESSION, title: 'Reminder' }],
  ])(
    'refuses %s, writing nothing and echoing nothing of it (R-HONEST-5)',
    async (_case, payload) => {
      const world = worldOf();
      const unbind = bindToTransaction(world.tx, world.list);

      const refusal = world.writer.record(world.tx, {
        ...reminder,
        payload: payload as NotificationRecord['payload'],
      });
      await expect(refusal).rejects.toThrow(TypeError);
      await expect(refusal).rejects.not.toThrow(/Ahmed|Reminder/);
      unbind();

      expect(world.create).not.toHaveBeenCalled();
      expect(world.lines[0]?.fields).toEqual({
        userId: USER,
        type: 'session_reminder',
        reason: 'payload_not_ids',
      });
    },
  );

  it('logs and reports an enqueue that fails after the commit, with the id and a reason', async () => {
    const world = worldOf({ enqueueFails: true });
    const unbind = bindToTransaction(world.tx, world.list);
    await world.writer.record(world.tx, reminder);
    unbind();

    world.list.flush();
    await settled();

    expect(world.lines).toEqual([
      {
        level: 'warn',
        fields: { notificationId: NOTIFICATION, reason: 'enqueue_failed', errorName: 'Error' },
      },
    ]);
    expect(world.reported).toHaveLength(1);
  });
});

describe('the seven v1.0 kinds (T005, FR-619, DEC-71)', () => {
  it('are the seven kinds, every other one refused by type', () => {
    expect([...NOTIFICATION_KINDS]).toEqual([
      'session_reminder',
      'cancellation_requested',
      'cancellation_request_accepted',
      'cancellation_request_declined',
      'payment_confirmed',
      'payment_failed',
      'payment_expired',
    ]);

    // @ts-expect-error -- T005: a v1.1 kind is not recorded in v1.0 (R-406)
    const later: NotificationKind = 'new_review';
    // @ts-expect-error -- T005: an expired request sends no push in v1.0 (FR-619)
    const expired: NotificationRecord['type'] = 'cancellation_request_expired';
    // @ts-expect-error -- T005: a payload has no field for text (R-HONEST-5)
    const withText: NotificationRecord['payload'] = { sessionId: SESSION, body: 'Reminder' };
    expect([later, expired, withText]).toHaveLength(3);
  });
});
