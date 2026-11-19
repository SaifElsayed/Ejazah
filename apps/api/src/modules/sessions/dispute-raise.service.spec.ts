// T026 of specs/004-sessions/tasks.md — `sessions.dispute.raise`'s rules over a recorded store
// (FR-473, FR-474, FR-495; research R-308; contracts/app-surface.md, "`sessions.dispute`";
// contracts/kernel.md, the «dispute raised» row). What the database holds (the one open dispute, the
// race of two raises, a second dispute after a resolution) is `tests/db-integrity/session-dispute.spec.ts`'.
//
// Keyed by the client's idempotency key; the window read before the transaction; the raiser, the
// enrollment and the session locked in that order and the session read again under them; then the
// refusals in order (another's or the other gender's session NOT_FOUND, a restricted raiser
// ACCOUNT_RESTRICTED, a cancelled session NOT_DISPUTABLE, one under review SESSION_UNDER_REVIEW, one
// disputed DISPUTE_OPEN, outside `[endsAt, endsAt + dispute_window_hours)` DISPUTE_WINDOW_CLOSED),
// each writing nothing and one line marked «logged»; else the dispute opened through moderation,
// the session marked `disputed` from the status read, and one `dispute_raised` event.
import type { SessionStatus } from '@ijazah/contracts';
import { addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import { createLogger } from '../../platform/logging/logger.js';
import { createDisputeRaise, type DisputeRaiseStore } from './dispute-raise.service.js';
import type { PartySessionRow } from './sessions.repository.js';
import type { PartyStanding } from './sessions.service.js';

const tx = { tx: 'the keyed transaction' } as unknown as Transaction;
const STUDENT = '0199d0a0-0000-7000-8000-00000000e001';
const TEACHER = '0199d0a0-0000-7000-8000-00000000e002';
const STRANGER = '0199d0a0-0000-7000-8000-00000000e003';
const SESSION = '0199d0a0-0000-7000-8000-00000000e0a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e0e1';
const DISPUTE = '0199d0a0-0000-7000-8000-00000000e0d1';
const KEY = 'dispute-key-0000000001';
const ENDS_AT = new Date('2026-11-08T08:00:00Z');
const WINDOW_HOURS = 72;
/** The window's close: 72 hours after the end. */
const CLOSES_AT = new Date('2026-11-11T08:00:00Z');
const INSIDE = new Date('2026-11-09T10:00:00Z');

const second = (at: Date, seconds: number) => new Date(addSeconds(at, seconds));

function sessionRow(status: SessionStatus): PartySessionRow {
  return {
    id: SESSION,
    enrollmentId: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    sequenceNumber: 2,
    makeupForSequenceNumber: null,
    localDate: '2026-11-08' as PartySessionRow['localDate'],
    startTimeLocal: '09:00:00' as PartySessionRow['startTimeLocal'],
    timezone: 'Africa/Cairo',
    startsAt: new Date('2026-11-08T07:00:00Z'),
    endsAt: ENDS_AT,
    status,
  };
}

const standing = (overrides: Partial<PartyStanding> = {}): PartyStanding => ({
  gender: 'female',
  accountStatus: 'active',
  teacherApproved: false,
  displayName: 'Probe',
  ...overrides,
});

interface World {
  readonly status: SessionStatus;
  /** The session as read under the locks, when it differs from the first read. */
  readonly lockedStatus?: SessionStatus | null;
  readonly parties?: ReadonlyMap<string, PartyStanding>;
  readonly opened?: string | null;
  readonly at?: Date;
}

function harness(world: World) {
  const calls: unknown[][] = [];
  const lines: Array<Record<string, unknown>> = [];
  const runs: unknown[] = [];
  const settingsRead: string[] = [];
  let reads = 0;
  const store: DisputeRaiseStore = {
    sessionOfParty: async (handed, sessionId, userId) => {
      expect(handed).toBe(tx);
      calls.push(['sessionOfParty', sessionId, userId]);
      reads += 1;
      if (userId !== STUDENT && userId !== TEACHER) return null;
      if (reads > 1 && world.lockedStatus !== undefined) {
        return world.lockedStatus === null ? null : sessionRow(world.lockedStatus);
      }
      return sessionRow(world.status);
    },
    partiesOf: async (_tx, userIds) => {
      calls.push(['partiesOf', [...userIds]]);
      return (
        world.parties ??
        new Map([
          [STUDENT, standing()],
          [TEACHER, standing({ teacherApproved: true })],
        ])
      );
    },
    lockRaiser: async (_tx, userId) => {
      calls.push(['lock users', userId]);
    },
    lockSession: async (_tx, sessionId) => {
      calls.push(['lock sessions', sessionId]);
    },
    openDispute: async (_tx, dispute) => {
      calls.push(['openDispute', dispute]);
      return world.opened === undefined ? DISPUTE : world.opened;
    },
    markDisputed: async (_tx, sessionId, from) => {
      calls.push(['markDisputed', sessionId, from]);
      return true;
    },
    recordEvents: async (_tx, events) => {
      calls.push(['recordEvents', events]);
    },
  };
  const raise = createDisputeRaise({
    idempotency: {
      run: async (request, effect) => {
        runs.push(request);
        return effect(tx);
      },
    },
    settings: {
      read: async (key, schema) => {
        settingsRead.push(key);
        return schema.parse(WINDOW_HOURS);
      },
    },
    enrollments: {
      lockEnrollments: async (_tx, ids) => {
        calls.push(['lock enrollments', [...ids]]);
      },
    },
    clock: async (handed) => {
      expect(handed).toBe(tx);
      return world.at ?? INSIDE;
    },
    store,
  });
  const log = createLogger({
    level: 'info',
    destination: { write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) },
  });
  const raiseAs = (userId: string, sessionId = SESSION) =>
    raise.raiseDispute({ userId }, { sessionId, reason: 'المعلم لم يحضر', idempotencyKey: KEY }, log);
  const writes = () =>
    calls.filter(([name]) => ['openDispute', 'markDisputed', 'recordEvents'].includes(String(name)));
  const ownFields = (record: Record<string, unknown>) => {
    const { level, time, pid, hostname, msg, ...own } = record;
    void [level, time, pid, hostname, msg];
    return own;
  };
  return { calls, lines, runs, settingsRead, raiseAs, writes, ownFields };
}

/** The refusal `attempt` threw: its code, its details, and whether it was marked «logged». */
async function refusalOf(attempt: Promise<unknown>) {
  const error: unknown = await attempt.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof DomainError)) throw new Error(`not refused: ${String(error)}`);
  return { code: error.code, logged: isRefusalLogged(error) };
}

describe('sessions.dispute.raise (T026, FR-473, FR-474)', () => {
  it('opens the dispute, marks the session disputed from its outcome and records dispute_raised, under the raiser, the enrollment and the session locked in that order', async () => {
    const world = harness({ status: 'teacher_no_show' });
    expect(await world.raiseAs(STUDENT)).toEqual({ disputeId: DISPUTE, status: 'open' });

    expect(world.calls).toEqual([
      ['sessionOfParty', SESSION, STUDENT],
      ['lock users', STUDENT],
      ['lock enrollments', [ENROLLMENT]],
      ['lock sessions', SESSION],
      ['sessionOfParty', SESSION, STUDENT],
      ['partiesOf', [STUDENT, TEACHER]],
      [
        'openDispute',
        {
          enrollmentId: ENROLLMENT,
          sessionId: SESSION,
          raisedByUserId: STUDENT,
          reason: 'المعلم لم يحضر',
        },
      ],
      ['markDisputed', SESSION, 'teacher_no_show'],
      [
        'recordEvents',
        [{ enrollmentId: ENROLLMENT, sessionId: SESSION, kind: 'dispute_raised', occurredAt: INSIDE }],
      ],
    ]);
    expect(world.lines.map((line) => line['msg'])).toEqual(['A session dispute was raised']);
    expect(world.ownFields(world.lines[0] ?? {})).toEqual({
      sessionId: SESSION,
      disputeId: DISPUTE,
      userId: STUDENT,
    });
  });

  it('keys the raise by the client key, the caller as actor and the session and reason as input, and reads the window before the transaction', async () => {
    const world = harness({ status: 'done' });
    await world.raiseAs(TEACHER);
    expect(world.runs).toEqual([
      {
        scope: 'sessions.dispute.raise',
        key: KEY,
        actorId: TEACHER,
        input: { sessionId: SESSION, reason: 'المعلم لم يحضر' },
      },
    ]);
    expect(world.settingsRead).toEqual(['dispute_window_hours']);
  });

  it('raises a session still scheduled past its end, before the evaluation, from scheduled', async () => {
    const world = harness({ status: 'scheduled' });
    await world.raiseAs(STUDENT);
    expect(world.calls).toContainEqual(['markDisputed', SESSION, 'scheduled']);
  });

  it('raises each settled outcome, and again a session whose earlier dispute was resolved inside its window (G1)', async () => {
    for (const status of ['done', 'student_no_show', 'teacher_no_show', 'both_no_show'] as const) {
      const world = harness({ status });
      expect(await world.raiseAs(TEACHER), status).toEqual({ disputeId: DISPUTE, status: 'open' });
      expect(world.calls).toContainEqual(['markDisputed', SESSION, status]);
    }
  });

  it('admits the raise from the scheduled end itself to one second before the window closes', async () => {
    for (const at of [ENDS_AT, second(CLOSES_AT, -1)]) {
      const world = harness({ status: 'done', at });
      expect(await world.raiseAs(STUDENT), at.toISOString()).toEqual({
        disputeId: DISPUTE,
        status: 'open',
      });
    }
  });

  it('refuses DISPUTE_WINDOW_CLOSED before the scheduled end and from the window close on, writing nothing', async () => {
    for (const [at, reason] of [
      [second(ENDS_AT, -1), 'before_end'],
      [CLOSES_AT, 'window_closed'],
      [second(CLOSES_AT, 3600), 'window_closed'],
    ] as const) {
      const world = harness({ status: 'scheduled', at });
      expect(await refusalOf(world.raiseAs(STUDENT)), at.toISOString()).toEqual({
        code: 'DISPUTE_WINDOW_CLOSED',
        logged: true,
      });
      expect(world.writes()).toEqual([]);
      expect(world.lines.map(world.ownFields)).toEqual([
        { sessionId: SESSION, userId: STUDENT, errorCode: 'DISPUTE_WINDOW_CLOSED', reason },
      ]);
    }
  });

  it('refuses NOT_DISPUTABLE for any cancelled session, by agreement or by an administrator, inside the window too', async () => {
    for (const status of ['cancelled_by_agreement', 'cancelled_by_admin'] as const) {
      const world = harness({ status });
      expect(await refusalOf(world.raiseAs(STUDENT)), status).toEqual({
        code: 'NOT_DISPUTABLE',
        logged: true,
      });
      expect(world.writes()).toEqual([]);
      expect(world.lines.map(world.ownFields)).toEqual([
        { sessionId: SESSION, userId: STUDENT, errorCode: 'NOT_DISPUTABLE', reason: 'cancelled' },
      ]);
    }
  });

  // 003:T112 (the owner's Q-B (a)): a postponed session is never disputed, as a cancelled one.
  it('refuses NOT_DISPUTABLE for a postponed session (003:T112)', async () => {
    const world = harness({ status: 'postponed' });
    expect(await refusalOf(world.raiseAs(STUDENT))).toEqual({ code: 'NOT_DISPUTABLE', logged: true });
    expect(world.writes()).toEqual([]);
    expect(world.lines.map(world.ownFields)).toEqual([
      { sessionId: SESSION, userId: STUDENT, errorCode: 'NOT_DISPUTABLE', reason: 'cancelled' },
    ]);
  });

  it('refuses SESSION_UNDER_REVIEW for under_threshold and provider_outage', async () => {
    for (const status of ['under_threshold', 'provider_outage'] as const) {
      const world = harness({ status });
      expect(await refusalOf(world.raiseAs(TEACHER)), status).toEqual({
        code: 'SESSION_UNDER_REVIEW',
        logged: true,
      });
      expect(world.writes()).toEqual([]);
      expect(world.lines.map(world.ownFields)).toEqual([
        { sessionId: SESSION, userId: TEACHER, errorCode: 'SESSION_UNDER_REVIEW', reason: 'under_review' },
      ]);
    }
  });

  it('refuses DISPUTE_OPEN for a session already disputed, outside the window too, writing nothing', async () => {
    for (const at of [INSIDE, second(CLOSES_AT, 3600)]) {
      const world = harness({ status: 'disputed', at });
      expect(await refusalOf(world.raiseAs(STUDENT))).toEqual({ code: 'DISPUTE_OPEN', logged: true });
      expect(world.writes()).toEqual([]);
      expect(world.lines.map(world.ownFields)).toEqual([
        { sessionId: SESSION, userId: STUDENT, errorCode: 'DISPUTE_OPEN', reason: 'dispute_open' },
      ]);
    }
  });

  it('refuses DISPUTE_OPEN when the database finds one open (rule 46), marking nothing and recording nothing', async () => {
    const world = harness({ status: 'done', opened: null });
    expect(await refusalOf(world.raiseAs(STUDENT))).toEqual({ code: 'DISPUTE_OPEN', logged: true });
    expect(world.writes().map(([name]) => name)).toEqual(['openDispute']);
    expect(world.lines.map(world.ownFields)).toEqual([
      { sessionId: SESSION, userId: STUDENT, errorCode: 'DISPUTE_OPEN', reason: 'dispute_open' },
    ]);
  });

  it("refuses NOT_FOUND, before any lock, for a session the caller is not a party of or one that does not exist", async () => {
    const world = harness({ status: 'done' });
    expect(await refusalOf(world.raiseAs(STRANGER))).toEqual({ code: 'NOT_FOUND', logged: true });
    expect(world.calls).toEqual([['sessionOfParty', SESSION, STRANGER]]);
    expect(world.lines.map(world.ownFields)).toEqual([
      { sessionId: SESSION, userId: STRANGER, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
    ]);
  });

  it('refuses NOT_FOUND when the session is gone once the locks are held', async () => {
    const world = harness({ status: 'done', lockedStatus: null });
    expect(await refusalOf(world.raiseAs(STUDENT))).toEqual({ code: 'NOT_FOUND', logged: true });
    expect(world.writes()).toEqual([]);
  });

  it('decides on the session read again under the locks, never the first read', async () => {
    const world = harness({ status: 'done', lockedStatus: 'cancelled_by_admin' });
    expect(await refusalOf(world.raiseAs(STUDENT))).toEqual({ code: 'NOT_DISPUTABLE', logged: true });
    const settled = harness({ status: 'scheduled', lockedStatus: 'student_no_show' });
    await settled.raiseAs(STUDENT);
    expect(settled.calls).toContainEqual(['markDisputed', SESSION, 'student_no_show']);
  });

  it("refuses NOT_FOUND, as a nonexistent session, when the counterparty's recorded gender differs, in both directions", async () => {
    for (const [own, other] of [
      ['female', 'male'],
      ['male', 'female'],
    ] as const) {
      const world = harness({
        status: 'done',
        parties: new Map([
          [STUDENT, standing({ gender: own })],
          [TEACHER, standing({ gender: other, teacherApproved: true })],
        ]),
      });
      expect(await refusalOf(world.raiseAs(STUDENT)), own).toEqual({ code: 'NOT_FOUND', logged: true });
      expect(world.writes()).toEqual([]);
      expect(world.lines.map(world.ownFields)).toEqual([
        { sessionId: SESSION, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'gender_differs' },
      ]);
    }
  });

  it('refuses ACCOUNT_RESTRICTED when the raiser is suspended or banned, or the teacher no longer approved, under the lock', async () => {
    for (const [raiser, party, reason] of [
      [STUDENT, standing({ accountStatus: 'suspended' }), 'party_not_active'],
      [STUDENT, standing({ accountStatus: 'banned' }), 'party_not_active'],
      [TEACHER, standing({ teacherApproved: false }), 'teacher_not_approved'],
    ] as const) {
      const parties = new Map([
        [STUDENT, standing()],
        [TEACHER, standing({ teacherApproved: true })],
      ]);
      parties.set(raiser, party);
      const world = harness({ status: 'done', parties });
      expect(await refusalOf(world.raiseAs(raiser)), reason).toEqual({
        code: 'ACCOUNT_RESTRICTED',
        logged: true,
      });
      expect(world.writes()).toEqual([]);
      expect(world.lines.map(world.ownFields)).toEqual([
        { sessionId: SESSION, userId: raiser, errorCode: 'ACCOUNT_RESTRICTED', reason },
      ]);
    }
  });

  it("raises over a deleted or restricted counterparty's session: only the raiser's own standing is read", async () => {
    const world = harness({
      status: 'teacher_no_show',
      parties: new Map([[STUDENT, standing()]]),
    });
    expect(await world.raiseAs(STUDENT)).toEqual({ disputeId: DISPUTE, status: 'open' });
    const banned = harness({
      status: 'teacher_no_show',
      parties: new Map([
        [STUDENT, standing()],
        [TEACHER, standing({ accountStatus: 'banned', teacherApproved: false })],
      ]),
    });
    expect(await banned.raiseAs(STUDENT)).toEqual({ disputeId: DISPUTE, status: 'open' });
  });
});
