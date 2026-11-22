// T052 — what the admin's payments monitor asks of booking (FR-400, R-220), over a store faked in
// memory: a page of orders' enrollments by id, and one enrollment's package line, status, progress
// derived from its sessions (FR-392) and outcomes. The queries run on the database in
// `modules/payments/payments-monitor.repository.spec.ts`.
import { addMinutes } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
import type {
  EnrollmentHoldRow,
  OrderEnrollmentRow,
  OutcomeRow,
} from './order-enrollments.repository.js';
import {
  monitoredEnrollmentOf,
  type OrderEnrollmentsStore,
  orderEnrollmentPartiesAmong,
} from './order-enrollments.service.js';

const tx = {} as Transaction;
const NOW = new Date('2026-11-10T12:00:00Z');

const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const E1 = '0199d0a0-0000-7000-8000-0000000000e1';
const E2 = '0199d0a0-0000-7000-8000-0000000000e2';
const ORDER = '0199d0a0-0000-7000-8000-0000000000f1';

const subject = { id: SUBJECT, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' };

function row(id: string, overrides: Partial<OrderEnrollmentRow> = {}): OrderEnrollmentRow {
  return {
    id,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status: 'confirmed',
    cancellationReason: null,
    snapshotSubjectId: SUBJECT,
    snapshotTrack: 'ijazah_track',
    snapshotSessionCount: 4,
    snapshotDurationMinutes: 45,
    ...overrides,
  };
}

function session(
  sequenceNumber: number,
  startsAt: string,
  status: EnrollmentSessionRow['status'],
): EnrollmentSessionRow {
  const start = new Date(startsAt);
  return {
    id: `0199d0a0-0000-7000-8000-${String(sequenceNumber).padStart(12, '0')}`,
    sequenceNumber,
    localDate: startsAt.slice(0, 10) as EnrollmentSessionRow['localDate'],
    startTimeLocal: '14:00:00' as EnrollmentSessionRow['startTimeLocal'],
    timezone: 'Africa/Cairo',
    startsAt: start,
    endsAt: new Date(addMinutes(start, 45)),
    status,
  };
}

function storeOf(
  rows: readonly OrderEnrollmentRow[],
  sessions: readonly EnrollmentSessionRow[] = [],
  outcomes: readonly OutcomeRow[] = [],
  holds: readonly EnrollmentHoldRow[] = [],
): OrderEnrollmentsStore & { readonly asked: unknown[][] } {
  const asked: unknown[][] = [];
  return {
    asked,
    enrollmentsAmong: async (_tx, ids) => {
      asked.push(['enrollmentsAmong', ids]);
      return rows.filter(({ id }) => ids.includes(id));
    },
    outcomesOf: async (_tx, enrollmentId) => {
      asked.push(['outcomesOf', enrollmentId]);
      return outcomes;
    },
    holdsOf: async (_tx, enrollmentId) => {
      asked.push(['holdsOf', enrollmentId]);
      return holds;
    },
    sessionsOf: async (_tx, ids) => new Map(ids.map((id) => [id, sessions] as const)),
    subjectsOf: async (_tx, ids) =>
      new Map(ids.filter((id) => id === SUBJECT).map((id) => [id, subject] as const)),
  };
}

describe('orderEnrollmentPartiesAmong', () => {
  it('answers each enrollment’s student and status by id, reading each id once', async () => {
    const store = storeOf([row(E1), row(E2, { status: 'cancelled' })]);
    const parties = await orderEnrollmentPartiesAmong(tx, [E1, E2, E1], store);
    expect(parties.get(E1)).toEqual({ studentUserId: STUDENT, status: 'confirmed' });
    expect(parties.get(E2)).toEqual({ studentUserId: STUDENT, status: 'cancelled' });
    expect(store.asked).toEqual([['enrollmentsAmong', [E1, E2]]]);
  });

  it('leaves out an enrollment no read returns', async () => {
    const parties = await orderEnrollmentPartiesAmong(tx, [E1], storeOf([]));
    expect(parties.size).toBe(0);
  });
});

describe('monitoredEnrollmentOf', () => {
  it('answers the snapshot’s package line, the status, and the progress derived from the sessions', async () => {
    const outcomes: OutcomeRow[] = [
      {
        kind: 'confirmed',
        cancellationReason: null,
        paymentId: ORDER,
        occurredAt: new Date('2026-11-01T10:00:00Z'),
      },
    ];
    const store = storeOf(
      [row(E1)],
      [
        session(1, '2026-11-03T12:00:00.000Z', 'done'),
        session(2, '2026-11-05T12:00:00.000Z', 'student_no_show'),
        session(3, '2026-11-07T12:00:00.000Z', 'teacher_no_show'),
        session(4, '2026-11-17T12:00:00.000Z', 'scheduled'),
      ],
      outcomes,
    );
    expect(await monitoredEnrollmentOf(tx, E1, NOW, store)).toEqual({
      enrollmentId: E1,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      status: 'confirmed',
      summary: { subject, track: 'ijazah_track', sessionCount: 4, sessionDurationMinutes: 45 },
      completed: 2,
      total: 4,
      outcomes,
      holds: [],
    });
  });

  // T024 of specs/004-sessions (R-323 GAP-8): the enrollment's holds, oldest first as read, each
  // with its release and its reason when recorded; a hold released before the reason existed has none.
  it('answers the enrollment’s holds, with and without a release reason', async () => {
    const holds: EnrollmentHoldRow[] = [
      {
        id: '0199d0a0-0000-7000-8000-0000000000d1',
        placedAt: new Date('2026-10-01T10:00:00Z'),
        expiresAt: new Date('2026-10-01T10:45:00Z'),
        releasedAt: new Date('2026-10-01T10:46:00Z'),
        releaseReason: null,
      },
      {
        id: '0199d0a0-0000-7000-8000-0000000000d2',
        placedAt: new Date('2026-11-01T09:00:00Z'),
        expiresAt: new Date('2026-11-01T09:45:00Z'),
        releasedAt: new Date('2026-11-01T09:10:00Z'),
        releaseReason: 'converted',
      },
      {
        id: '0199d0a0-0000-7000-8000-0000000000d3',
        placedAt: new Date('2026-11-09T09:00:00Z'),
        expiresAt: new Date('2026-11-09T09:45:00Z'),
        releasedAt: null,
        releaseReason: null,
      },
    ];
    const store = storeOf([row(E1)], [], [], holds);
    const answer = await monitoredEnrollmentOf(tx, E1, NOW, store);
    expect(answer?.holds).toEqual(holds);
    expect(store.asked).toContainEqual(['holdsOf', E1]);
  });

  it('carries a cancelled enrollment’s reason, and none otherwise', async () => {
    const cancelled = await monitoredEnrollmentOf(
      tx,
      E1,
      NOW,
      storeOf([row(E1, { status: 'cancelled', cancellationReason: 'slot_unavailable' })]),
    );
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
    });
    const confirmed = await monitoredEnrollmentOf(tx, E1, NOW, storeOf([row(E1)]));
    expect(confirmed).not.toHaveProperty('cancellationReason');
  });

  it('answers null for an enrollment no read returns, asking nothing more', async () => {
    const store = storeOf([]);
    expect(await monitoredEnrollmentOf(tx, E1, NOW, store)).toBeNull();
    expect(store.asked).toEqual([['enrollmentsAmong', [E1]]]);
  });
});

describe('a one-session enrollment, an assessment (006:T005, U-8)', () => {
  it('answers its one session of 30 minutes as one of one once delivered', async () => {
    const store = storeOf(
      [row(E1, { snapshotSessionCount: 1, snapshotDurationMinutes: 30 })],
      [session(1, '2026-11-03T12:00:00.000Z', 'done')],
    );
    expect(await monitoredEnrollmentOf(tx, E1, NOW, store)).toMatchObject({
      summary: { sessionCount: 1, sessionDurationMinutes: 30 },
      completed: 1,
      total: 1,
    });
  });
});
