// T026 of specs/004-sessions/tasks.md — the dispute fields the parties' screens read (FR-473, FR-495;
// contracts/app-surface.md, `sessions.get`'s `dispute`, `canRaiseDispute` and `disputeClosesAt`, and
// the lists' `disputed`), at every boundary: the window's two ends to the second, each status, the
// latest dispute open or closed and by whom. The main session joins them to `sessions.get` and the
// lists at the integration (the B37 row of tasks.md's «Batches»).
import type { SessionStatus } from '@ijazah/contracts';
import { addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SessionDisputeState } from '../moderation/index.js';
import { createDisputeView, disputeFieldsOf, isDisputed } from './dispute-view.js';

const VIEWER = '0199d0a0-0000-7000-8000-00000000f001';
const OTHER = '0199d0a0-0000-7000-8000-00000000f002';
const DISPUTE = '0199d0a0-0000-7000-8000-00000000f0d1';
const ENDS_AT = new Date('2026-11-08T08:00:00Z');
const CLOSES_AT = '2026-11-11T08:00:00.000Z';
const INSIDE = new Date('2026-11-09T10:00:00Z');
const HOURS = 72;

const second = (at: Date | string, seconds: number) =>
  new Date(addSeconds(new Date(at), seconds));
const fieldsAt = (
  status: SessionStatus,
  at: Date,
  latest?: SessionDisputeState,
) => disputeFieldsOf({ status, endsAt: ENDS_AT }, latest, VIEWER, at, HOURS);

describe('disputeFieldsOf (T026)', () => {
  it('lets a settled session be disputed from its scheduled end to one second before the window closes, and no longer', () => {
    expect(fieldsAt('done', second(ENDS_AT, -1))).toEqual({
      canRaiseDispute: false,
      disputeClosesAt: CLOSES_AT,
    });
    for (const at of [ENDS_AT, INSIDE, second(CLOSES_AT, -1)]) {
      expect(fieldsAt('done', at), at.toISOString()).toEqual({
        canRaiseDispute: true,
        disputeClosesAt: CLOSES_AT,
      });
    }
    for (const at of [new Date(CLOSES_AT), second(CLOSES_AT, 1)]) {
      expect(fieldsAt('done', at), at.toISOString()).toEqual({
        canRaiseDispute: false,
        disputeClosesAt: CLOSES_AT,
      });
    }
  });

  it('lets each settled outcome, and a session still scheduled past its end, be disputed inside the window', () => {
    for (const status of [
      'scheduled',
      'done',
      'student_no_show',
      'teacher_no_show',
      'both_no_show',
    ] as const) {
      expect(fieldsAt(status, INSIDE).canRaiseDispute, status).toBe(true);
    }
  });

  it('never offers the raise for a session under review or disputed, which keep their window', () => {
    for (const status of ['under_threshold', 'provider_outage', 'disputed'] as const) {
      expect(fieldsAt(status, INSIDE), status).toEqual({
        canRaiseDispute: false,
        disputeClosesAt: CLOSES_AT,
      });
    }
  });

  it('gives a cancelled session neither the raise nor a window, by agreement or by an administrator', () => {
    for (const status of ['cancelled_by_agreement', 'cancelled_by_admin'] as const) {
      expect(fieldsAt(status, INSIDE), status).toEqual({ canRaiseDispute: false });
    }
  });

  // 003:T112 (the owner's Q-B (a)): a postponed session as a cancelled one.
  it('gives a postponed session neither the raise nor a window (003:T112)', () => {
    expect(fieldsAt('postponed', INSIDE)).toEqual({ canRaiseDispute: false });
  });

  it("names the latest dispute's state, whether the viewer raised it, and the window's close", () => {
    expect(
      fieldsAt('disputed', INSIDE, { disputeId: DISPUTE, status: 'open', raisedByUserId: VIEWER }),
    ).toEqual({
      dispute: { status: 'open', raisedByMe: true, closesAt: CLOSES_AT },
      canRaiseDispute: false,
      disputeClosesAt: CLOSES_AT,
    });
    expect(
      fieldsAt('disputed', INSIDE, { disputeId: DISPUTE, status: 'open', raisedByUserId: OTHER })
        .dispute,
    ).toEqual({ status: 'open', raisedByMe: false, closesAt: CLOSES_AT });
  });

  it('offers the raise again after a resolution while the window is open (G1), the resolved dispute still named', () => {
    for (const status of ['resolved', 'dismissed'] as const) {
      expect(
        fieldsAt('student_no_show', INSIDE, { disputeId: DISPUTE, status, raisedByUserId: OTHER }),
        status,
      ).toEqual({
        dispute: { status, raisedByMe: false, closesAt: CLOSES_AT },
        canRaiseDispute: true,
        disputeClosesAt: CLOSES_AT,
      });
    }
  });

  it('reads a dispute with no raiser as not the viewer’s', () => {
    expect(
      fieldsAt('done', INSIDE, { disputeId: DISPUTE, status: 'resolved', raisedByUserId: null })
        .dispute?.raisedByMe,
    ).toBe(false);
  });
});

describe('isDisputed (T026, the lists’ `disputed`)', () => {
  it('is true for a disputed session only', () => {
    const statuses: SessionStatus[] = [
      'scheduled',
      'done',
      'student_no_show',
      'teacher_no_show',
      'both_no_show',
      'under_threshold',
      'provider_outage',
      'cancelled_by_agreement',
      'cancelled_by_admin',
      'disputed',
    ];
    expect(statuses.filter(isDisputed)).toEqual(['disputed']);
  });
});

describe('createDisputeView (T026)', () => {
  const tx = { tx: 'the read' } as unknown as Transaction;
  const SESSION_A = '0199d0a0-0000-7000-8000-00000000f0a1';
  const SESSION_B = '0199d0a0-0000-7000-8000-00000000f0a2';

  it('reads the window once, the database clock once and the latest disputes of all the sessions in one call', async () => {
    const asked: unknown[][] = [];
    const view = createDisputeView({
      settings: {
        read: async (key, schema) => {
          asked.push(['setting', key]);
          return schema.parse(HOURS);
        },
      },
      clock: async (handed) => {
        expect(handed).toBe(tx);
        asked.push(['clock']);
        return INSIDE;
      },
      latestOf: async (handed, ids) => {
        expect(handed).toBe(tx);
        asked.push(['latest', [...ids]]);
        return new Map([
          [SESSION_A, { disputeId: DISPUTE, status: 'open', raisedByUserId: VIEWER }],
        ]);
      },
    });

    const fields = await view.ofSessions(
      tx,
      [
        { id: SESSION_A, status: 'disputed', endsAt: ENDS_AT },
        { id: SESSION_B, status: 'done', endsAt: ENDS_AT },
      ],
      VIEWER,
    );

    expect(asked).toEqual([
      ['setting', 'dispute_window_hours'],
      ['clock'],
      ['latest', [SESSION_A, SESSION_B]],
    ]);
    expect(fields).toEqual(
      new Map([
        [
          SESSION_A,
          {
            dispute: { status: 'open', raisedByMe: true, closesAt: CLOSES_AT },
            canRaiseDispute: false,
            disputeClosesAt: CLOSES_AT,
          },
        ],
        [SESSION_B, { canRaiseDispute: true, disputeClosesAt: CLOSES_AT }],
      ]),
    );
  });

  it('asks nothing for no session', async () => {
    const view = createDisputeView({
      settings: { read: async () => Promise.reject(new Error('no setting is read')) },
      clock: async () => Promise.reject(new Error('no clock is read')),
      latestOf: async () => Promise.reject(new Error('no dispute is read')),
    });
    expect(await view.ofSessions(tx, [], VIEWER)).toEqual(new Map());
  });
});
