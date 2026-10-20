// T037: the admin panel's tRPC client. The bearer is the session token from the tab's
// sessionStorage; the refusals are read by their code from the answer's body, never by the status
// (owner's decision 2026-10-19: ADMIN_SIGN_IN_FAILED is 401 too), and they move the session: a
// refused session (UNAUTHENTICATED) is cleared, an unverified one is sent to its second factor.
import { TRPCClientError } from '@trpc/client';
import { describe, expect, it, vi } from 'vitest';

import { createAdminClient, errorCodeOf } from './client';
import { createSessionStore } from './session';

const URL = 'https://api.example.test/admin/trpc';

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const refusal = (code: string, status: number) =>
  answer(status, { error: { code, message: code, details: [] } });

function setUp(response: () => Response) {
  const sessions = createSessionStore(() => window.sessionStorage);
  const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response());
  const client = createAdminClient({ url: URL, sessions, fetch: transport });
  const bearerOf = (call = 0) =>
    new Headers(transport.mock.calls[call]?.[1]?.headers).get('authorization');
  return { sessions, transport, client, bearerOf };
}

describe('the admin client', () => {
  it('sends the session token as the bearer, and no bearer without a session', async () => {
    const { sessions, client, bearerOf } = setUp(() =>
      answer(200, { result: { data: { adminId: 'a' } } }),
    );
    await client.untyped.query('auth.me');
    expect(bearerOf(0)).toBeNull();
    sessions.write({ token: 'session-token', step: 'verified' });
    await expect(client.untyped.query('auth.me')).resolves.toEqual({ adminId: 'a' });
    expect(bearerOf(1)).toBe('Bearer session-token');
  });

  it('clears a session the server refuses (UNAUTHENTICATED)', async () => {
    const { sessions, client } = setUp(() => refusal('UNAUTHENTICATED', 401));
    sessions.write({ token: 'expired', step: 'verified' });
    const error = await client.untyped.query('auth.me').catch((caught: unknown) => caught);
    expect(errorCodeOf(error)).toBe('UNAUTHENTICATED');
    expect(sessions.read()).toBeNull();
  });

  it('keeps the session on any other 401: a failed sign-in is not a sign-out', async () => {
    const { sessions, client } = setUp(() => refusal('ADMIN_SIGN_IN_FAILED', 401));
    sessions.write({ token: 'pending', step: 'mfa' });
    const error = await client.untyped
      .mutation('auth.signIn', {})
      .catch((caught: unknown) => caught);
    expect(errorCodeOf(error)).toBe('ADMIN_SIGN_IN_FAILED');
    expect(sessions.read()).toEqual({ token: 'pending', step: 'mfa' });
  });

  it.each([
    ['MFA_REQUIRED', 'mfa'],
    ['MFA_SETUP_REQUIRED', 'setup'],
  ] as const)('sends a session refused %s to its step (%s)', async (code, step) => {
    const { sessions, client } = setUp(() => refusal(code, 403));
    sessions.write({ token: 'token', step: 'verified' });
    await client.untyped.query('auth.me').catch(() => undefined);
    expect(sessions.read()).toEqual({ token: 'token', step });
  });

  it('leaves the session alone on a refusal that is not about it (FORBIDDEN, NOT_FOUND)', async () => {
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
    ] as const) {
      const { sessions, client } = setUp(() => refusal(code, status));
      sessions.write({ token: 'token', step: 'verified' });
      await client.untyped.query('auth.me').catch(() => undefined);
      expect(sessions.read(), code).toEqual({ token: 'token', step: 'verified' });
    }
  });

  it('signs out on the server with the bearer, and clears the tab even when the server fails', async () => {
    const { sessions, client, bearerOf } = setUp(() => refusal('INTERNAL', 500));
    sessions.write({ token: 'token', step: 'verified' });
    await client.signOut();
    expect(bearerOf(0)).toBe('Bearer token');
    expect(sessions.read()).toBeNull();
  });
});

describe('errorCodeOf', () => {
  it('reads the API’s text code from the answer, and nothing from an error the API never sent', async () => {
    const { client } = setUp(() => refusal('RATE_LIMITED', 429));
    expect(
      errorCodeOf(await client.untyped.query('auth.me').catch((caught: unknown) => caught)),
    ).toBe('RATE_LIMITED');
    expect(errorCodeOf(new Error('offline'))).toBeUndefined();
    expect(errorCodeOf(new TRPCClientError('no body'))).toBeUndefined();
  });
});
