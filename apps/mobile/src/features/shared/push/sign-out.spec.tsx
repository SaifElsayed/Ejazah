// R3 (specs/005-certification T020's follow-up Q-T3; FR-623, «a signed-out user's tokens are
// removed»): the sign-out removes the device's push token held by the binding, with the session
// still open, before it revokes the session. Best effort: a failed removal never holds the sign-out,
// and with no token held nothing is sent.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { getSession, setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../__tests__/api-double';
import { useAccountActions } from '../account';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('../auth/providers', () => ({ signOutProviders: async () => undefined }));

let mockHeld: string | null = null;
jest.mock('./binding', () => {
  const actual = jest.requireActual<typeof import('./binding')>('./binding');
  return { ...actual, heldPushToken: () => mockHeld };
});

const TOKEN = 'ExponentPushToken[device-1]';
const remove = jest.fn(async (_input: { token: string }) => undefined);
/** The order the sign-out's calls reach the server and the device in. */
const order: string[] = [];

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

async function signOut(): Promise<void> {
  const { result } = await renderHook(() => useAccountActions(), { wrapper });
  await act(() => result.current.signOut());
}

beforeEach(async () => {
  mockApi = fakeApi();
  await mockApi.sessions.store.write(tokens);
  setSession({ kind: 'signed-in', landing: 'student_home' });
  order.length = 0;
  remove.mockReset();
  remove.mockImplementation(async () => {
    order.push('remove');
  });
  Object.assign(mockApi.api.account, { pushToken: { remove: { mutate: remove } } });
  mockApi.api.auth.signOut.mutate.mockImplementation(async () => {
    order.push('signOut');
  });
  mockHeld = TOKEN;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the sign-out and the push token (FR-623)', () => {
  it('removes the held token before the session is revoked, then signs out', async () => {
    await signOut();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({ token: TOKEN });
    expect(order).toEqual(['remove', 'signOut']);
    expect(mockApi.sessions.current()).toBeNull();
    expect(getSession()).toEqual({ kind: 'signed-out' });
  });

  it('still signs out when the removal fails', async () => {
    remove.mockRejectedValue(apiError('INTERNAL'));
    await signOut();
    expect(mockApi.api.auth.signOut.mutate).toHaveBeenCalledTimes(1);
    expect(mockApi.sessions.current()).toBeNull();
    expect(getSession()).toEqual({ kind: 'signed-out' });
  });

  it('sends nothing to remove when no token is held, and signs out', async () => {
    mockHeld = null;
    await signOut();
    expect(remove).not.toHaveBeenCalled();
    expect(mockApi.sessions.current()).toBeNull();
    expect(getSession()).toEqual({ kind: 'signed-out' });
  });
});
