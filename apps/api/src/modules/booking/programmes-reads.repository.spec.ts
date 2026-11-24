// 006:T018 (FR-726, FR-727) — booking's reads of a programme, its items and the administrator's
// queue, over a recording stand-in of the client: the queries asked (a soft-deleted enrollment left
// out, the queue's open items oldest first after the cursor, the paused programmes longest paused
// first) and the rows answered (the offer only once offered, N without the assessment). The rows
// against Postgres are `tests/db-integrity/programme-reads.spec.ts`'.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  openItemsPage,
  pausedPage,
  programmeRequestsOf,
  programmeViewOf,
  queuedProgrammesAmong,
} from './programmes.repository.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000018e1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000018a1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000018b1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000018c1';
const AT = new Date('2026-11-24T10:00:00Z');

function clientOf(answers: Record<string, unknown>) {
  const calls: [string, unknown][] = [];
  const answer = (name: string) => async (query: unknown) => {
    calls.push([name, query]);
    return answers[name];
  };
  const client = {
    programme: { findFirst: answer('programme.findFirst'), findMany: answer('programme.findMany') },
    programmeRequest: { findMany: answer('programmeRequest.findMany') },
  } as unknown as Pick<Transaction, 'programme' | 'programmeRequest'>;
  return { client, calls };
}

const OFFERED_ROW = {
  state: 'active',
  offerDueAt: AT,
  payByAt: AT,
  level: 'يحفظ جزء عم',
  readiness: 'جاهز',
  expectedLength: 'عشرة أشهر',
  offeredAt: AT,
  paymentPlan: 'monthly',
  monthsPaid: 2,
  monthCount: 10,
  pausedAt: null,
  closedAt: null,
  enrollment: {
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status: 'confirmed',
    snapshotSessionCount: 41,
    snapshotDurationMinutes: 45,
    snapshotPricePiasters: 1_000_000n,
  },
};

describe('programmeViewOf (006:T018)', () => {
  it('reads the programme of an undeleted enrollment by its key, the offer with N and its total', async () => {
    const { client, calls } = clientOf({ 'programme.findFirst': OFFERED_ROW });
    expect(await programmeViewOf(client, ENROLLMENT)).toStrictEqual({
      enrollmentId: ENROLLMENT,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      status: 'confirmed',
      state: 'active',
      offerDueAt: AT,
      payByAt: AT,
      offer: {
        level: 'يحفظ جزء عم',
        readiness: 'جاهز',
        expectedLength: 'عشرة أشهر',
        offeredAt: AT,
        durationMinutes: 45,
        sessionCount: 40,
        total_piasters: piasters(1_000_000),
      },
      plan: 'monthly',
      monthsPaid: 2,
      monthCount: 10,
      pausedAt: null,
      closedAt: null,
    });
    expect(calls[0]?.[1]).toMatchObject({
      where: { enrollmentId: ENROLLMENT, enrollment: { deletedAt: null } },
    });
  });

  it('answers no offer before one was sent, the snapshot still the assessment’s', async () => {
    const awaiting = {
      ...OFFERED_ROW,
      state: 'awaiting_offer',
      level: null,
      readiness: null,
      expectedLength: null,
      offeredAt: null,
      paymentPlan: null,
      monthsPaid: 0,
      monthCount: null,
      enrollment: { ...OFFERED_ROW.enrollment, snapshotSessionCount: 1 },
    };
    const { client } = clientOf({ 'programme.findFirst': awaiting });
    expect(await programmeViewOf(client, ENROLLMENT)).toMatchObject({
      state: 'awaiting_offer',
      offer: null,
      plan: null,
    });
  });

  it('answers null for an enrollment with no programme, or a soft-deleted one', async () => {
    const { client } = clientOf({ 'programme.findFirst': null });
    expect(await programmeViewOf(client, ENROLLMENT)).toBeNull();
  });
});

describe('the items (006:T018)', () => {
  const ITEM = {
    id: REQUEST,
    enrollmentId: ENROLLMENT,
    kind: 'no_offer',
    reason: 'لم يرسل المعلم عرضًا',
    status: 'approved',
    createdAt: AT,
    decidedAt: AT,
  };

  it('reads a programme’s items oldest first, each with its reason', async () => {
    const { client, calls } = clientOf({ 'programmeRequest.findMany': [ITEM] });
    expect(await programmeRequestsOf(client, ENROLLMENT)).toEqual([ITEM]);
    expect(calls[0]?.[1]).toMatchObject({
      where: { enrollmentId: ENROLLMENT },
      orderBy: { id: 'asc' },
    });
  });

  it('reads a page of the open items of a kind, oldest first after the cursor, of undeleted enrollments', async () => {
    const { client, calls } = clientOf({ 'programmeRequest.findMany': [ITEM] });
    expect(await openItemsPage(client, 'charge_unknown', REQUEST, 21)).toEqual([ITEM]);
    expect(calls[0]?.[1]).toMatchObject({
      where: {
        status: 'open',
        kind: 'charge_unknown',
        enrollment: { deletedAt: null },
        id: { gt: REQUEST },
      },
      orderBy: { id: 'asc' },
      take: 21,
    });
    await openItemsPage(client, 'stop', undefined, 21);
    expect((calls[1]?.[1] as { where: object }).where).not.toHaveProperty('id');
  });
});

describe('pausedPage (006:T018)', () => {
  const PAUSED = [{ enrollmentId: ENROLLMENT, pausedAt: AT }];

  it('reads the paused programmes longest paused first, of undeleted enrollments', async () => {
    const { client, calls } = clientOf({ 'programme.findMany': PAUSED });
    expect(await pausedPage(client, undefined, 21)).toEqual(PAUSED);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({
      where: { state: 'paused', enrollment: { deletedAt: null } },
      orderBy: [{ pausedAt: 'asc' }, { enrollmentId: 'asc' }],
      take: 21,
    });
  });

  it('continues after the cursor’s programme by its pause, the id breaking a tie', async () => {
    const { client, calls } = clientOf({
      'programme.findFirst': { pausedAt: AT },
      'programme.findMany': PAUSED,
    });
    await pausedPage(client, ENROLLMENT, 21);
    expect(calls[0]).toEqual([
      'programme.findFirst',
      { where: { enrollmentId: ENROLLMENT, state: 'paused' }, select: { pausedAt: true } },
    ]);
    expect(calls[1]?.[1]).toMatchObject({
      where: { OR: [{ pausedAt: { gt: AT } }, { pausedAt: AT, enrollmentId: { gt: ENROLLMENT } }] },
    });
  });

  it('starts again when the cursor’s programme is no longer paused', async () => {
    const { client, calls } = clientOf({ 'programme.findFirst': null, 'programme.findMany': [] });
    await pausedPage(client, ENROLLMENT, 21);
    expect((calls[1]?.[1] as { where: object }).where).not.toHaveProperty('OR');
  });
});

describe('queuedProgrammesAmong (006:T018)', () => {
  it('reads the queued programmes’ parties, state and pause in one query, by enrollment id', async () => {
    const { client, calls } = clientOf({
      'programme.findMany': [
        {
          enrollmentId: ENROLLMENT,
          state: 'paused',
          pausedAt: AT,
          enrollment: { studentUserId: STUDENT, teacherUserId: TEACHER },
        },
      ],
    });
    const found = await queuedProgrammesAmong(client, [ENROLLMENT, REQUEST]);
    expect([...found.entries()]).toEqual([
      [
        ENROLLMENT,
        {
          enrollmentId: ENROLLMENT,
          studentUserId: STUDENT,
          teacherUserId: TEACHER,
          state: 'paused',
          pausedAt: AT,
        },
      ],
    ]);
    expect(calls[0]?.[1]).toMatchObject({
      where: { enrollmentId: { in: [ENROLLMENT, REQUEST] }, enrollment: { deletedAt: null } },
    });
  });

  it('reads nothing for no enrollment', async () => {
    const { client, calls } = clientOf({});
    expect((await queuedProgrammesAmong(client, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
