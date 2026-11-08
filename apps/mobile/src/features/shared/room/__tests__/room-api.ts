// T018 and T019 of specs/004-sessions: the API as the pre-session screen's and the room's specs see
// it: the shared double (`features/shared/__tests__/api-double.ts`) with `sessions.get` and
// `sessions.join` beside its procedures, each a mock answering what each case says.
import type { SessionsGetOutput, SessionsJoinOutput } from '@ijazah/contracts';
import { jest } from '@jest/globals';

import { type FakeApi, fakeApi, type FakeProcedures } from '../../__tests__/api-double';

export interface SessionProcedures {
  readonly get: { readonly query: jest.Mock<(input: unknown) => Promise<SessionsGetOutput>> };
  readonly join: { readonly mutate: jest.Mock<(input: unknown) => Promise<SessionsJoinOutput>> };
}

export interface RoomApi {
  readonly sessions: SessionProcedures;
  readonly api: FakeProcedures & { readonly sessions: SessionProcedures };
  /** What `useApi()` returns. */
  readonly value: FakeApi['value'] & {
    readonly client: FakeApi['value']['client'] & {
      readonly api: FakeProcedures & { readonly sessions: SessionProcedures };
    };
  };
}

export function roomApi(): RoomApi {
  const base = fakeApi();
  const sessions: SessionProcedures = {
    get: { query: jest.fn<(input: unknown) => Promise<SessionsGetOutput>>() },
    join: { mutate: jest.fn<(input: unknown) => Promise<SessionsJoinOutput>>() },
  };
  const api = { ...base.api, sessions };
  return {
    sessions,
    api,
    value: { ...base.value, client: { ...base.value.client, api } },
  };
}

export const SESSION_ID = '0193a6f0-0000-7000-8000-0000000000c1';
export const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
export const CAIRO = 'Africa/Cairo';
export const DUBAI = 'Asia/Dubai';

/** A scheduled 45-minute session on Wednesday 2026-11-11 at 18:00 in Cairo (16:00 UTC). */
export function session(of: Partial<SessionsGetOutput> = {}): SessionsGetOutput {
  return {
    sessionId: SESSION_ID,
    enrollmentId: ENROLLMENT_ID,
    sequenceNumber: 3,
    localDate: '2026-11-11',
    startTimeLocal: '18:00',
    timezone: CAIRO,
    startsAt: '2026-11-11T16:00:00.000Z',
    endsAt: '2026-11-11T16:45:00.000Z',
    lengthMinutes: 45,
    status: 'scheduled',
    counterparty: { displayName: 'يوسف أحمد', deleted: false },
    join: { opensAt: '2026-11-11T15:45:00.000Z', closesAt: '2026-11-11T16:45:00.000Z' },
    ...of,
  };
}

/** `sessions.join`'s answer for the session above. */
export function grant(of: Partial<SessionsJoinOutput> = {}): SessionsJoinOutput {
  return {
    sessionId: SESSION_ID,
    serverUrl: 'wss://video.ijazah.test',
    token: 'token-1',
    validUntil: '2026-11-11T16:45:00.000Z',
    ...of,
  };
}
