// T033: the one network path (R-MOBILE-11). The tRPC client sends the access token as a bearer;
// an answer of UNAUTHENTICATED is refreshed once through `auth.refresh` (the schema T038
// publishes) and the call retried; a refused refresh signs the person out. The decision is made on
// the error's `code`, never on the status: SIGN_IN_FAILED and ONBOARDING_TOKEN_INVALID are 401 too
// (note under T018). `platform.publicConfig` is read once and cached.
import { describe, expect, it, jest } from '@jest/globals';

import { createApiClient, errorCodeOf } from './client';
import type { SessionStore, SessionTokens } from './storage';

const url = 'https://api.test/trpc';

interface Call {
  readonly path: string;
  readonly bearer: string | null;
  readonly input: unknown;
}

type Handler = (call: Call) => { status: number; body: unknown };

/** A server speaking tRPC's HTTP protocol over the fetch the client is given. */
function fakeServer(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(typeof input === 'string' ? input : input.toString());
    const path = target.pathname.replace('/trpc/', '');
    const headers = new Headers(init?.headers);
    const authorization = headers.get('authorization');
    const raw =
      init?.method === 'POST' ? init.body : (target.searchParams.get('input') ?? undefined);
    const call: Call = {
      path,
      bearer: authorization === null ? null : authorization.replace(/^Bearer /, ''),
      input: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

const ok = (data: unknown) => ({ status: 200, body: { result: { data } } });
const refused = (code: string, status = 401) => ({
  status,
  body: { error: { code, message: 'refused' } },
});

function memorySessions(initial: SessionTokens | null) {
  let current = initial;
  const store: SessionStore = {
    read: async () => current,
    write: async (tokens) => {
      current = tokens;
    },
    clear: async () => {
      current = null;
    },
  };
  return { store, current: () => current };
}

const subjects = { subjects: [] };

/** The API's error code a rejected call carries. */
async function codeOfRejection(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
  } catch (error) {
    return errorCodeOf(error);
  }
  throw new Error('the call did not reject');
}

describe('the API client', () => {
  it('sends the stored access token as a bearer', async () => {
    const server = fakeServer(() => ok(subjects));
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const client = createApiClient({
      url,
      sessions: sessions.store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    await expect(client.api.catalog.subjects.list.query()).resolves.toEqual(subjects);
    expect(server.calls.map((call) => call.bearer)).toEqual(['a1']);
  });

  it('sends no bearer without a session', async () => {
    const server = fakeServer(() => ok(subjects));
    const client = createApiClient({
      url,
      sessions: memorySessions(null).store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    await client.api.catalog.subjects.list.query();
    expect(server.calls[0]?.bearer).toBeNull();
  });

  it('refreshes once on UNAUTHENTICATED, stores the new pair and retries with it', async () => {
    const server = fakeServer((call) => {
      if (call.path === 'auth.refresh') return ok({ accessToken: 'a2', refreshToken: 'r2' });
      return call.bearer === 'a2' ? ok(subjects) : refused('UNAUTHENTICATED');
    });
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const onSignedOut = jest.fn();
    const client = createApiClient({
      url,
      sessions: sessions.store,
      onSignedOut,
      fetch: server.fetch,
    });
    await expect(client.api.catalog.subjects.list.query()).resolves.toEqual(subjects);
    expect(server.calls.map((call) => call.path)).toEqual([
      'catalog.subjects.list',
      'auth.refresh',
      'catalog.subjects.list',
    ]);
    expect(server.calls[1]).toMatchObject({ bearer: null, input: { refreshToken: 'r1' } });
    expect(sessions.current()).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('refreshes once for calls refused together', async () => {
    const server = fakeServer((call) => {
      if (call.path === 'auth.refresh') return ok({ accessToken: 'a2', refreshToken: 'r2' });
      return call.bearer === 'a2' ? ok(subjects) : refused('UNAUTHENTICATED');
    });
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const client = createApiClient({
      url,
      sessions: sessions.store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    await Promise.all([
      client.api.catalog.subjects.list.query(),
      client.api.catalog.subjects.list.query(),
    ]);
    expect(server.calls.filter((call) => call.path === 'auth.refresh')).toHaveLength(1);
  });

  it('signs out when the refresh is refused, and the call fails', async () => {
    const server = fakeServer((call) =>
      call.path === 'auth.refresh' ? refused('UNAUTHENTICATED') : refused('UNAUTHENTICATED'),
    );
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const onSignedOut = jest.fn();
    const client = createApiClient({
      url,
      sessions: sessions.store,
      onSignedOut,
      fetch: server.fetch,
    });
    expect(await codeOfRejection(client.api.catalog.subjects.list.query())).toBe('UNAUTHENTICATED');
    expect(sessions.current()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['INTERNAL', 500],
    ['RATE_LIMITED', 429],
    ['VALIDATION_FAILED', 400],
  ])(
    'keeps the session when the refresh answers %s, a failure and not a refusal (review of B6, 1)',
    async (code, status) => {
      const server = fakeServer((call) =>
        call.path === 'auth.refresh' ? refused(code, status) : refused('UNAUTHENTICATED'),
      );
      const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
      const onSignedOut = jest.fn();
      const client = createApiClient({
        url,
        sessions: sessions.store,
        onSignedOut,
        fetch: server.fetch,
      });
      await expect(client.api.catalog.subjects.list.query()).rejects.toBeDefined();
      expect(sessions.current()).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
      expect(onSignedOut).not.toHaveBeenCalled();
    },
  );

  it('never refreshes on another 401 code', async () => {
    const server = fakeServer(() => refused('SIGN_IN_FAILED'));
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const onSignedOut = jest.fn();
    const client = createApiClient({
      url,
      sessions: sessions.store,
      onSignedOut,
      fetch: server.fetch,
    });
    expect(await codeOfRejection(client.api.catalog.subjects.list.query())).toBe('SIGN_IN_FAILED');
    expect(server.calls.map((call) => call.path)).toEqual(['catalog.subjects.list']);
    expect(sessions.current()).not.toBeNull();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('never refreshes without a session', async () => {
    const server = fakeServer(() => refused('UNAUTHENTICATED'));
    const onSignedOut = jest.fn();
    const client = createApiClient({
      url,
      sessions: memorySessions(null).store,
      onSignedOut,
      fetch: server.fetch,
    });
    await expect(client.api.catalog.subjects.list.query()).rejects.toBeDefined();
    expect(server.calls).toHaveLength(1);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('keeps the session when the refresh cannot reach the server', async () => {
    const server = fakeServer((call) => {
      if (call.path === 'auth.refresh') throw new TypeError('Network request failed');
      return refused('UNAUTHENTICATED');
    });
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const onSignedOut = jest.fn();
    const client = createApiClient({
      url,
      sessions: sessions.store,
      onSignedOut,
      fetch: server.fetch,
    });
    await expect(client.api.catalog.subjects.list.query()).rejects.toBeDefined();
    expect(sessions.current()).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('reads the code of an API error, and none from an error that never reached the server', async () => {
    const server = fakeServer((call) => {
      if (call.path === 'catalog.subjects.list') return refused('NOT_FOUND', 404);
      throw new TypeError('Network request failed');
    });
    const client = createApiClient({
      url,
      sessions: memorySessions(null).store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    expect(await codeOfRejection(client.api.catalog.subjects.list.query())).toBe('NOT_FOUND');
    expect(await codeOfRejection(client.api.platform.publicConfig.query())).toBeUndefined();
    expect(errorCodeOf(new Error('plain'))).toBeUndefined();
  });

  it('reads the public configuration once and caches it', async () => {
    const config = { supportEmail: 'support@ijazah.app', termsVersion: '2026-10-01' };
    const server = fakeServer(() => ok(config));
    const client = createApiClient({
      url,
      sessions: memorySessions(null).store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    await expect(client.publicConfig()).resolves.toEqual(config);
    await expect(client.publicConfig()).resolves.toEqual(config);
    expect(server.calls.map((call) => call.path)).toEqual(['platform.publicConfig']);
  });

  it('does not cache a failed read of the public configuration', async () => {
    let first = true;
    const config = { supportEmail: 'support@ijazah.app', termsVersion: '2026-10-01' };
    const server = fakeServer(() => {
      if (first) {
        first = false;
        return refused('INTERNAL', 500);
      }
      return ok(config);
    });
    const client = createApiClient({
      url,
      sessions: memorySessions(null).store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    await expect(client.publicConfig()).rejects.toBeDefined();
    await expect(client.publicConfig()).resolves.toEqual(config);
  });

  it('refuses a public configuration outside its schema', async () => {
    const server = fakeServer(() => ok({ supportEmail: 'not an address', termsVersion: '' }));
    const client = createApiClient({
      url,
      sessions: memorySessions(null).store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    await expect(client.publicConfig()).rejects.toBeDefined();
  });
});
