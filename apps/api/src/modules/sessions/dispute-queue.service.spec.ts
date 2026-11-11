// T034 of specs/004-sessions/tasks.md (FR-451, FR-475; research R-308; contracts/admin-surface.md,
// `disputes.list` and `disputes.get`) — `createDisputeQueue` over a recorded store. The list: the
// open disputes first, then the closed ones from their start, a page of `admin_list_page_size`
// with a cursor while more follow, the cursor's own status telling which part continues; each item
// with who raised it, the frozen outcome and its enrollment's Teacher-No-Show count and mark. The
// detail: the dispute, its session's telemetry and `chatAvailable` from the open dispute alone; no
// session dispute, `NOT_FOUND` with one line. Over the real tables:
// `tests/db-integrity/dispute-resolution.spec.ts`.
import type { SessionStatus } from '@ijazah/contracts';
import type { Telemetry } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { SessionDisputeRow } from '../moderation/index.js';
import { createDisputeQueue, type DisputeQueueStore } from './dispute-queue.service.js';
import type { TelemetrySession } from './review.repository.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000b1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b2';
const E1 = '0199d0a0-0000-7000-8000-0000000000e1';
const E2 = '0199d0a0-0000-7000-8000-0000000000e2';

/** Each probe dispute's raising, by its number. */
const RAISED_AT = [
  '2026-11-01T09:00:00Z',
  '2026-11-02T09:00:00Z',
  '2026-11-03T09:00:00Z',
  '2026-11-04T09:00:00Z',
];

const dispute = (
  n: number,
  status: SessionDisputeRow['status'],
  enrollmentId = E1,
): SessionDisputeRow => ({
  id: `0199d0a0-0000-7000-8000-0000000000d${String(n)}`,
  enrollmentId,
  sessionId: `0199d0a0-0000-7000-8000-00000000005${String(n)}`,
  raisedByUserId: n % 2 === 0 ? TEACHER : STUDENT,
  reason: 'سبب',
  status,
  createdAt: new Date(RAISED_AT[n - 1] ?? '2026-11-09T09:00:00Z'),
  resolution: status === 'open' ? null : 'upheld',
  resolutionNotes: status === 'open' ? null : 'ملاحظة',
  resolvedAt: status === 'open' ? null : new Date('2026-11-09T10:00:00Z'),
});

const OPEN = [dispute(1, 'open'), dispute(2, 'open', E2)];
const CLOSED = [dispute(4, 'resolved'), dispute(3, 'resolved')];
const TELEMETRY = { sessionId: OPEN[0]?.sessionId } as Telemetry;

function world({ pageSize = 3, flag = 2 } = {}) {
  const journal: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  const all = [...OPEN, ...CLOSED];
  const store: DisputeQueueStore = {
    disputeOf: async (_tx, id) => all.find((row) => row.id === id) ?? null,
    disputesPage: async (_tx, group, after, limit) => {
      journal.push(`${group} after ${after ?? '-'} limit ${String(limit)}`);
      const rows = group === 'open' ? OPEN : CLOSED;
      const from = after === undefined ? 0 : rows.findIndex((row) => row.id === after) + 1;
      return rows.slice(from, from + limit);
    },
    disputedSessionsAmong: async (_tx, ids) =>
      new Map(
        ids.map((id) => [
          id,
          {
            id,
            enrollmentId: E1,
            studentUserId: STUDENT,
            teacherUserId: TEACHER,
            outcomeUnderDispute: id.endsWith('51') ? ('teacher_no_show' as SessionStatus) : null,
          },
        ]),
      ),
    teacherNoShowCountsOf: async (_tx, ids) => {
      journal.push(`counts ${ids.join(',')}`);
      return new Map([[E1, 2]]);
    },
    telemetrySession: async (_tx, sessionId) =>
      ({
        id: sessionId,
        enrollmentId: E1,
        studentUserId: STUDENT,
        teacherUserId: TEACHER,
        outcomeUnderDispute: 'done',
      }) as TelemetrySession,
  };
  const settings: SettingsReader = {
    read: async (key) => {
      if (key === 'admin_list_page_size') return pageSize as never;
      if (key === 'repeated_absence_flag_count') return flag as never;
      throw new Error(`unexpected setting ${key}`);
    },
  };
  const service = createDisputeQueue({
    telemetry: {
      of: async (_tx, session) => {
        journal.push(`telemetry ${session.id}`);
        return TELEMETRY;
      },
    },
    settings,
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Parameters<typeof createDisputeQueue>[0]['log'],
    store,
  });
  return { service, journal, logged };
}

describe('disputes.list (FR-475, FR-451)', () => {
  it('answers the open disputes first, then the closed ones, with a cursor while more follow', async () => {
    const { service, journal } = world({ pageSize: 3 });
    const page = await service.list(tx, ADMIN, {});
    expect(page.items.map(({ disputeId }) => disputeId)).toEqual([
      OPEN[0]?.id,
      OPEN[1]?.id,
      CLOSED[0]?.id,
    ]);
    expect(page.nextCursor).toBe(CLOSED[0]?.id);
    expect(journal).toEqual([
      'open after - limit 4',
      'closed after - limit 2',
      `counts ${E1},${E2}`,
    ]);
    expect(page.items[0]).toEqual({
      disputeId: OPEN[0]?.id,
      sessionId: OPEN[0]?.sessionId,
      raisedBy: 'student',
      raisedAt: '2026-11-01T09:00:00.000Z',
      outcomeUnderDispute: 'teacher_no_show',
      teacherNoShows: 2,
      repeatedAbsence: true,
    });
    expect(page.items[1]).toEqual({
      disputeId: OPEN[1]?.id,
      sessionId: OPEN[1]?.sessionId,
      raisedBy: 'teacher',
      raisedAt: '2026-11-02T09:00:00.000Z',
      teacherNoShows: 0,
      repeatedAbsence: false,
    });
  });

  it('continues the closed part after a closed cursor, and the open part after an open one', async () => {
    const closed = world({ pageSize: 3 });
    const after = await closed.service.list(tx, ADMIN, { cursor: CLOSED[0]?.id });
    expect(after.items.map(({ disputeId }) => disputeId)).toEqual([CLOSED[1]?.id]);
    expect(after.nextCursor).toBeUndefined();
    expect(closed.journal[0]).toBe(`closed after ${String(CLOSED[0]?.id)} limit 4`);

    const open = world({ pageSize: 1 });
    const next = await open.service.list(tx, ADMIN, { cursor: OPEN[0]?.id });
    expect(next.items.map(({ disputeId }) => disputeId)).toEqual([OPEN[1]?.id]);
    expect(next.nextCursor).toBe(OPEN[1]?.id);
    expect(open.journal[0]).toBe(`open after ${String(OPEN[0]?.id)} limit 2`);
  });
});

describe('disputes.get (FR-475)', () => {
  it('answers the open dispute, its session’s telemetry and chatAvailable', async () => {
    const { service, journal } = world();
    const answer = await service.get(tx, ADMIN, { disputeId: String(OPEN[0]?.id) });
    expect(answer).toEqual({
      dispute: {
        disputeId: OPEN[0]?.id,
        sessionId: OPEN[0]?.sessionId,
        enrollmentId: E1,
        raisedBy: 'student',
        reason: 'سبب',
        status: 'open',
        raisedAt: '2026-11-01T09:00:00.000Z',
        outcomeUnderDispute: 'done',
      },
      telemetry: TELEMETRY,
      chatAvailable: true,
    });
    expect(journal).toEqual([`telemetry ${String(OPEN[0]?.sessionId)}`]);
  });

  it('answers a resolved dispute with its ruling, the chat no longer available', async () => {
    const { service } = world();
    const answer = await service.get(tx, ADMIN, { disputeId: String(CLOSED[0]?.id) });
    expect(answer.chatAvailable).toBe(false);
    expect(answer.dispute).toMatchObject({
      status: 'resolved',
      resolution: 'upheld',
      resolutionNotes: 'ملاحظة',
      resolvedAt: '2026-11-09T10:00:00.000Z',
    });
  });

  it('refuses a dispute that is no session dispute, or none, NOT_FOUND with one line', async () => {
    const { service, logged } = world();
    const missing = '0199d0a0-0000-7000-8000-0000000000d9';
    const thrown: unknown = await service.get(tx, ADMIN, { disputeId: missing }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('NOT_FOUND');
    expect(isRefusalLogged(thrown)).toBe(true);
    expect(logged).toEqual([
      {
        fields: { adminId: ADMIN, disputeId: missing, errorCode: 'NOT_FOUND', cause: 'not_found' },
        message: 'A disputes queue call was refused',
      },
    ]);
  });
});
