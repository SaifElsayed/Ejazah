// T008 of specs/004-sessions/tasks.md — the queries behind `EnrollmentSide`, over a recorded
// client: what each statement asks, and how its rows are answered. The coverage step leaves the
// db-integrity specs out (PR #127's CI), so each branch is run here; the same over the real tables
// is `tests/db-integrity/enrollment-side.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { recordEnrollmentEvents } from './enrollment-events.repository.js';
import {
  activeHoldsAmong,
  enrollmentEventsOf,
  enrollmentsPage,
  enrollmentTermsById,
  moveEnrollment,
} from './enrollment-side.repository.js';
import { slotUses } from './slot-occupancy.repository.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-08T09:00:00Z');

type Client = Pick<Transaction, 'enrollment' | 'enrollmentEvent'>;

function recorded(answers: { findUnique?: unknown; updateMany?: number; findMany?: unknown[] }) {
  const calls: { method: string; args: unknown }[] = [];
  const record = (method: string, answer: unknown) => async (args: unknown) => {
    calls.push({ method, args });
    return answer;
  };
  const client = {
    enrollment: {
      findUnique: record('enrollment.findUnique', answers.findUnique ?? null),
      updateMany: record('enrollment.updateMany', { count: answers.updateMany ?? 0 }),
      findMany: record('enrollment.findMany', answers.findMany ?? []),
    },
    enrollmentEvent: {
      findMany: record('enrollmentEvent.findMany', answers.findMany ?? []),
      createMany: record('enrollmentEvent.createMany', { count: 0 }),
    },
  } as unknown as Client;
  return { client, calls };
}

describe('enrollmentTermsById (T008)', () => {
  it('answers the snapshot, the slot and the status under the port names', async () => {
    const { client, calls } = recorded({
      findUnique: {
        id: id(1),
        status: 'confirmed',
        slotId: id(2),
        snapshotTrack: 'ijazah_track',
        snapshotSlotTimezone: 'Africa/Cairo',
        snapshotDurationMinutes: 45,
        snapshotSessionCount: 12,
      },
    });
    expect(await enrollmentTermsById(client, id(1))).toEqual({
      id: id(1),
      status: 'confirmed',
      slotId: id(2),
      track: 'ijazah_track',
      timezone: 'Africa/Cairo',
      durationMinutes: 45,
      sessionCount: 12,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({ where: { id: id(1) } });
  });

  it('answers null for no enrollment', async () => {
    expect(await enrollmentTermsById(recorded({}).client, id(1))).toBeNull();
  });
});

describe('moveEnrollment (T008)', () => {
  it('updates only from the sources, never writing confirmed_at, and answers whether it moved', async () => {
    const { client, calls } = recorded({ updateMany: 1 });
    expect(
      await moveEnrollment(
        client,
        id(1),
        [{ status: 'terminated_no_show' }, { status: 'cancelled', cancellationReason: 'admin' }],
        { status: 'confirmed', cancellationReason: null },
      ),
    ).toBe(true);
    expect(calls).toEqual([
      {
        method: 'enrollment.updateMany',
        args: {
          where: {
            id: id(1),
            OR: [
              { status: 'terminated_no_show' },
              { status: 'cancelled', cancellationReason: 'admin' },
            ],
          },
          data: { status: 'confirmed', cancellationReason: null },
        },
      },
    ]);
  });

  it('answers false when no row was in a source state', async () => {
    const { client } = recorded({ updateMany: 0 });
    expect(
      await moveEnrollment(client, id(1), [{ status: 'confirmed' }], {
        status: 'completed',
        cancellationReason: null,
      }),
    ).toBe(false);
  });
});

describe('enrollmentEventsOf (T008, R-323 GAP-1, FR-497)', () => {
  it('reads oldest first with no payment, and leaves a reason out where there is none', async () => {
    const { client, calls } = recorded({
      findMany: [
        { kind: 'confirmed', cancellationReason: null, occurredAt: AT },
        { kind: 'cancelled', cancellationReason: 'admin', occurredAt: AT },
      ],
    });
    const events = await enrollmentEventsOf(client, id(1));
    expect(events).toStrictEqual([
      { kind: 'confirmed', occurredAt: AT },
      { kind: 'cancelled', cancellationReason: 'admin', occurredAt: AT },
    ]);
    expect(calls[0]?.args).toEqual({
      where: { enrollmentId: id(1) },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { kind: true, cancellationReason: true, occurredAt: true },
    });
  });
});

describe('enrollmentsPage (T008, U3)', () => {
  const row = {
    id: id(5),
    studentUserId: id(6),
    teacherUserId: id(7),
    status: 'completed',
    snapshotTrack: 'recitation',
    snapshotSessionCount: 4,
  };

  it('with no filter and no cursor: every enrollment, newest first, up to take', async () => {
    const { client, calls } = recorded({ findMany: [row] });
    expect(await enrollmentsPage(client, {}, undefined, 3)).toEqual([
      {
        enrollmentId: id(5),
        studentUserId: id(6),
        teacherUserId: id(7),
        status: 'completed',
        track: 'recitation',
        sessionCount: 4,
      },
    ]);
    expect(calls[0]?.args).toMatchObject({ where: { AND: [] }, orderBy: { id: 'desc' }, take: 3 });
  });

  it('every condition given at once, and the ids before the cursor', async () => {
    const { client, calls } = recorded({ findMany: [] });
    await enrollmentsPage(
      client,
      {
        status: 'confirmed',
        studentUserIds: [id(6)],
        teacherUserIds: [id(7)],
        enrollmentIds: [id(5), id(4)],
      },
      id(9),
      26,
    );
    expect(calls[0]?.args).toMatchObject({
      where: {
        AND: [{ id: { in: [id(5), id(4)] } }, { id: { lt: id(9) } }],
        status: 'confirmed',
        studentUserId: { in: [id(6)] },
        teacherUserId: { in: [id(7)] },
      },
      take: 26,
    });
  });
});

describe("recordEnrollmentEvents' Phase 3 kinds (T008)", () => {
  it('writes completed, terminated_no_show and restored with neither an order nor a reason', async () => {
    const { client, calls } = recorded({});
    await recordEnrollmentEvents(client, [
      { kind: 'completed', enrollmentId: id(1), occurredAt: AT },
      { kind: 'terminated_no_show', enrollmentId: id(2), occurredAt: AT },
      { kind: 'restored', enrollmentId: id(3), occurredAt: AT },
      { kind: 'cancelled', enrollmentId: id(4), cancellationReason: 'admin', occurredAt: AT },
      { kind: 'confirmed', enrollmentId: id(5), paymentId: id(55), occurredAt: AT },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toStrictEqual({
      data: [
        { enrollmentId: id(1), kind: 'completed', occurredAt: AT },
        { enrollmentId: id(2), kind: 'terminated_no_show', occurredAt: AT },
        { enrollmentId: id(3), kind: 'restored', occurredAt: AT },
        { enrollmentId: id(4), kind: 'cancelled', cancellationReason: 'admin', occurredAt: AT },
        { enrollmentId: id(5), kind: 'confirmed', paymentId: id(55), occurredAt: AT },
      ],
    });
  });
});

describe('activeHoldsAmong (T008, F5)', () => {
  function holdsClient() {
    const calls: unknown[] = [];
    const client = {
      slotHold: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ slotId: id(11), sessionCount: 4, expiresAt: AT }];
        },
      },
    } as unknown as Pick<Transaction, 'slotHold'>;
    return { client, calls };
  }

  it("reads the students' own and the slots' active holds, even past their expiry", async () => {
    const { client, calls } = holdsClient();
    expect(
      await activeHoldsAmong(client, { studentUserIds: [id(1)], slotIds: [id(11), id(12)] }),
    ).toEqual([{ slotId: id(11), sessionCount: 4, expiresAt: AT }]);
    expect(calls).toEqual([
      {
        where: {
          releasedAt: null,
          OR: [{ studentUserId: { in: [id(1)] } }, { slotId: { in: [id(11), id(12)] } }],
        },
        orderBy: { id: 'asc' },
        select: { slotId: true, sessionCount: true, expiresAt: true },
      },
    ]);
  });

  it('leaves out an empty side, and asks nothing when both are empty', async () => {
    const { client, calls } = holdsClient();
    await activeHoldsAmong(client, { studentUserIds: [id(1)], slotIds: [] });
    expect(calls[0]).toMatchObject({
      where: { releasedAt: null, OR: [{ studentUserId: { in: [id(1)] } }] },
    });
    expect(await activeHoldsAmong(client, { studentUserIds: [], slotIds: [] })).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("slotUses leaving out the asking enrollment (T008, R-205; the owner's decision of 2026-11-07)", () => {
  it("reads the slot's other enrollments only, and every one without an exception", async () => {
    const calls: unknown[] = [];
    const client = {
      slotHold: { findMany: async () => [] },
      enrollment: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [];
        },
      },
    } as unknown as Pick<Transaction, 'slotHold' | 'enrollment'>;
    await slotUses(client, [id(2)], id(1));
    await slotUses(client, [id(2)]);
    expect(calls[0]).toMatchObject({
      where: { slotId: { in: [id(2)] }, id: { not: id(1) } },
    });
    expect(calls[1]).toMatchObject({ where: { slotId: { in: [id(2)] } } });
    expect((calls[1] as { where: object }).where).not.toHaveProperty('id');
  });
});
