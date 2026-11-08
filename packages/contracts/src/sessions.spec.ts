// T011 of specs/004-sessions — the `sessions` schemas of contracts/app-surface.md, "`sessions`"
// (FR-431, FR-434, FR-494, FR-499). Written before the schemas, and run red first.
//
// The caller names the session and nothing else (R-GENDER-4). The session carries its local date,
// local start and zone beside its instants (FR-494). The counterparty is a name or nothing and a
// deleted flag (contracts/README.md, "A deleted party"), and no field the schema does not name
// reaches the other party (R-HONEST-4). The later screens' fields are optional (T021, T028, T026).
// The join answers the provider's address, the token and the instant it stops opening a connection.
import { describe, expect, it } from 'vitest';

import {
  remedyView,
  sessionParty,
  sessionsGetInput,
  sessionsGetOutput,
  sessionsJoinInput,
  sessionsJoinOutput,
} from './sessions.js';

const ids = {
  session: '0199d0a0-0000-7000-8000-0000000000a1',
  enrollment: '0199d0a0-0000-7000-8000-0000000000e1',
};

const got = {
  sessionId: ids.session,
  enrollmentId: ids.enrollment,
  sequenceNumber: 3,
  localDate: '2026-11-08',
  startTimeLocal: '17:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-08T15:00:00.000Z',
  endsAt: '2026-11-08T15:45:00.000Z',
  lengthMinutes: 45,
  status: 'scheduled',
  counterparty: { displayName: 'أحمد سالم', deleted: false },
  join: { opensAt: '2026-11-08T14:50:00.000Z', closesAt: '2026-11-08T15:45:00.000Z' },
} as const;

describe('sessions.get', () => {
  it('takes the session id and nothing of who asks', () => {
    expect(sessionsGetInput.parse({ sessionId: ids.session })).toEqual({ sessionId: ids.session });
    expect(
      sessionsGetInput.parse({ sessionId: ids.session, gender: 'female', userId: ids.enrollment }),
    ).toEqual({ sessionId: ids.session });
    expect(sessionsGetInput.safeParse({ sessionId: 'not-an-id' }).success).toBe(false);
  });

  it('answers the pre-session screen’s data, the later screens’ fields absent', () => {
    expect(sessionsGetOutput.parse(got)).toEqual(got);
  });

  it('names a deleted counterparty with no name', () => {
    const deleted = { ...got, counterparty: { displayName: null, deleted: true } };
    expect(sessionsGetOutput.parse(deleted).counterparty).toEqual({
      displayName: null,
      deleted: true,
    });
    expect(Object.keys(sessionParty.shape).sort()).toEqual(['deleted', 'displayName']);
  });

  it('strips any field it does not name, the private fields of the other party among them', () => {
    const leaked = {
      ...got,
      counterparty: { ...got.counterparty, dateOfBirth: '2012-01-01', isMinor: true },
      outcomeUnderDispute: 'done',
      providerRoomId: 'room',
    };
    const parsed = sessionsGetOutput.parse(leaked);
    expect(parsed).toEqual(got);
    expect(Object.keys(parsed.counterparty).sort()).toEqual(['deleted', 'displayName']);
  });

  it('carries a make-up’s session and the later screens’ fields when they are given', () => {
    const remedy = {
      status: 'proposed',
      kind: 'makeup',
      offeredAt: '2026-11-01T10:00:00.000Z',
      choiceClosesAt: '2026-11-04T10:00:00.000Z',
      proposal: {
        localDate: '2026-11-15',
        startTimeLocal: '17:00',
        timezone: 'Africa/Cairo',
        startsAt: '2026-11-15T15:00:00.000Z',
      },
      canChooseRefund: false,
    } as const;
    const full = {
      ...got,
      makeupFor: { sequenceNumber: 2 },
      cancellation: {
        requestId: ids.enrollment,
        requestedByMe: true,
        reason: 'سفر',
        status: 'pending',
        expiresAt: '2026-11-08T15:00:00.000Z',
      },
      remedy,
      dispute: { status: 'open', raisedByMe: false, closesAt: '2026-11-10T15:45:00.000Z' },
      canRaiseDispute: false,
      disputeClosesAt: '2026-11-10T15:45:00.000Z',
    } as const;
    expect(sessionsGetOutput.parse(full)).toEqual(full);
    expect(remedyView.parse(remedy)).toEqual(remedy);
  });

  it('refuses a status the database does not hold and a length no package sells', () => {
    expect(sessionsGetOutput.safeParse({ ...got, status: 'lapsed' }).success).toBe(false);
    expect(sessionsGetOutput.safeParse({ ...got, lengthMinutes: 50 }).success).toBe(false);
  });

  it('never shows a lapsed remedy', () => {
    const lapsed = {
      status: 'lapsed',
      kind: 'makeup',
      offeredAt: '2026-11-01T10:00:00.000Z',
      choiceClosesAt: '2026-11-04T10:00:00.000Z',
      canChooseRefund: false,
    };
    expect(remedyView.safeParse(lapsed).success).toBe(false);
  });
});

describe('sessions.join', () => {
  it('takes the session id and nothing of who asks', () => {
    expect(sessionsJoinInput.parse({ sessionId: ids.session, role: 'teacher' })).toEqual({
      sessionId: ids.session,
    });
  });

  it('answers the session, the provider’s address, the token and the scheduled end', () => {
    const joined = {
      sessionId: ids.session,
      serverUrl: 'wss://example.livekit.cloud',
      token: 'opaque',
      validUntil: '2026-11-08T15:45:00.000Z',
    };
    expect(sessionsJoinOutput.parse({ ...joined, participantUserId: ids.enrollment })).toEqual(
      joined,
    );
    expect(sessionsJoinOutput.safeParse({ ...joined, token: '' }).success).toBe(false);
  });
});
