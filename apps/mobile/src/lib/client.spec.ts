// T033: the one network path (R-MOBILE-11). The tRPC client sends the access token as a bearer;
// an answer of UNAUTHENTICATED is refreshed once through `auth.refresh` (the schema T038
// publishes) and the call retried; a refused refresh signs the person out. The decision is made on
// the error's `code`, never on the status: SIGN_IN_FAILED and ONBOARDING_TOKEN_INVALID are 401 too
// (note under T018). `platform.publicConfig` is read once and cached.
import { describe, expect, it, jest } from '@jest/globals';

import {
  createApiClient,
  errorCodeOf,
  errorDetailsOf,
  filePart,
  photoPart,
  UPLOAD_FILE_NAME,
  UPLOAD_PHOTO_NAME,
} from './client';
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

  it("reads the details of an API error, the sign-in conflict's method among them (T050)", async () => {
    const server = fakeServer(() => ({
      status: 409,
      body: {
        error: {
          code: 'EMAIL_IN_USE_BY_OTHER_METHOD',
          message: 'refused',
          details: [{ path: 'email', code: 'google' }],
        },
      },
    }));
    const client = createApiClient({
      url,
      sessions: memorySessions(null).store,
      onSignedOut: jest.fn(),
      fetch: server.fetch,
    });
    const error = await client.api.catalog.subjects.list.query().catch((caught: unknown) => caught);
    expect(errorDetailsOf(error)).toEqual([{ path: 'email', code: 'google' }]);
    expect(errorDetailsOf(new Error('plain'))).toEqual([]);
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

// T058: `POST /uploads/documents` through the same session. The route reads the `kind` before the
// file (apps/api/src/platform/http/multipart.ts), so the order is part of the contract; the answer
// is the document's id, and a refusal in the API's one error shape is read as a call's is (review
// of B11b, round 1, finding 2).
describe('the documents upload', () => {
  const uploadsUrl = 'https://api.test/uploads/documents';
  const file = { uri: 'file:///cache/ijazah.pdf', name: 'ijazah.pdf' };

  /** The multipart parts as the client appended them, in order: React Native's FormData, or Node's under Jest. */
  function partsOf(body: unknown): [string, unknown][] {
    const form = body as {
      readonly _parts?: [string, unknown][];
      readonly entries?: () => Iterable<[string, unknown]>;
    };
    if (form._parts !== undefined) return form._parts;
    if (form.entries !== undefined) return [...form.entries()];
    throw new Error('the upload was not sent as multipart');
  }

  /** The tRPC server for the refresh, and the uploads route beside it. */
  function server(upload: (bearer: string | null) => { status: number; body: unknown }) {
    const uploads: { bearer: string | null; parts: [string, unknown][] }[] = [];
    const trpc = fakeServer((call) =>
      call.path === 'auth.refresh' ? ok({ accessToken: 'a2', refreshToken: 'r2' }) : ok(subjects),
    );
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== uploadsUrl) return trpc.fetch(input, init);
      const authorization = new Headers(init?.headers).get('authorization');
      const bearer = authorization === null ? null : authorization.replace(/^Bearer /, '');
      uploads.push({ bearer, parts: partsOf(init?.body) });
      const { status, body } = upload(bearer);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
    return { uploads, trpc, fetch: fetchImpl as unknown as typeof fetch };
  }

  function clientOver(fetchImpl: typeof fetch, withUrl = true) {
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const client = createApiClient({
      url,
      sessions: sessions.store,
      ...(withUrl ? { documentsUploadUrl: uploadsUrl } : {}),
      onSignedOut: jest.fn(),
      fetch: fetchImpl,
    });
    return { client, sessions };
  }

  it('posts the kind before the file, with the bearer, and answers the document id', async () => {
    const fake = server(() => ({ status: 201, body: { documentId: 'd-1' } }));
    const { client } = clientOver(fake.fetch);
    await expect(client.uploadDocument('credential', file)).resolves.toBe('d-1');
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.bearer).toBe('a1');
    expect(fake.uploads[0]?.parts.map(([name]) => name)).toEqual(['kind', 'file']);
    expect(fake.uploads[0]?.parts[0]?.[1]).toBe('credential');
  });

  it('refreshes once on UNAUTHENTICATED and sends the file again with the new bearer', async () => {
    const fake = server((bearer) =>
      bearer === 'a1' ? refused('UNAUTHENTICATED') : { status: 201, body: { documentId: 'd-2' } },
    );
    const { client, sessions } = clientOver(fake.fetch);
    await expect(client.uploadDocument('identity', file)).resolves.toBe('d-2');
    expect(fake.uploads.map(({ bearer }) => bearer)).toEqual(['a1', 'a2']);
    expect(fake.trpc.calls.map(({ path }) => path)).toEqual(['auth.refresh']);
    expect(sessions.current()).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('raises a refusal whose code and details are read as a call’s are', async () => {
    const fake = server(() => ({
      status: 409,
      body: {
        error: {
          code: 'CONFLICT',
          message: 'refused',
          details: [{ path: 'documents', code: 'too_many' }],
        },
      },
    }));
    const { client } = clientOver(fake.fetch);
    const refusal = await client
      .uploadDocument('credential', file)
      .catch((error: unknown) => error);
    expect(errorCodeOf(refusal)).toBe('CONFLICT');
    expect(errorDetailsOf(refusal)).toEqual([{ path: 'documents', code: 'too_many' }]);
  });

  it('names every file document.pdf, never the person’s file name', () => {
    expect(UPLOAD_FILE_NAME).toBe('document.pdf');
    expect(filePart({ uri: 'file:///cache/sara-adel-id.pdf', name: 'sara-adel-id.pdf' })).toEqual({
      uri: 'file:///cache/sara-adel-id.pdf',
      name: 'document.pdf',
      type: 'application/pdf',
    });
  });

  it('refuses to upload when the client was given no uploads address', async () => {
    const fake = server(() => ({ status: 201, body: { documentId: 'd-3' } }));
    const { client } = clientOver(fake.fetch, false);
    await expect(client.uploadDocument('credential', file)).rejects.toThrow(
      'no documents upload URL',
    );
    expect(fake.uploads).toEqual([]);
  });
});

describe('the photo upload (T084)', () => {
  const photosUrl = 'https://api.test/uploads/photos';
  const photo = { uri: 'file:///cache/IMG_0001.png', name: 'IMG_0001.png', mimeType: 'image/png' };

  function server(answer: () => { status: number; body: unknown }) {
    const uploads: { bearer: string | null; parts: [string, unknown][] }[] = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(photosUrl);
      const authorization = new Headers(init?.headers).get('authorization');
      const form = init?.body as {
        readonly _parts?: [string, unknown][];
        readonly entries?: () => Iterable<[string, unknown]>;
      };
      uploads.push({
        bearer: authorization === null ? null : authorization.replace(/^Bearer /, ''),
        parts: form._parts ?? [...(form.entries?.() ?? [])],
      });
      const { status, body } = answer();
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
    return { uploads, fetch: fetchImpl as unknown as typeof fetch };
  }

  function clientOver(fetchImpl: typeof fetch, withUrl = true) {
    return createApiClient({
      url,
      sessions: memorySessions({ accessToken: 'a1', refreshToken: 'r1' }).store,
      ...(withUrl ? { photosUploadUrl: photosUrl } : {}),
      onSignedOut: jest.fn(),
      fetch: fetchImpl,
    });
  }

  it('posts the one image with the bearer and answers the signed link', async () => {
    const fake = server(() => ({
      status: 201,
      body: { photoUrl: 'https://files.test/p.png?s=1' },
    }));
    await expect(clientOver(fake.fetch).uploadPhoto(photo)).resolves.toBe(
      'https://files.test/p.png?s=1',
    );
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.bearer).toBe('a1');
    expect(fake.uploads[0]?.parts.map(([name]) => name)).toEqual(['file']);
  });

  it('sends the image under a fixed name with the type the picker reported', () => {
    expect(photoPart(photo)).toEqual({
      uri: 'file:///cache/IMG_0001.png',
      name: UPLOAD_PHOTO_NAME,
      type: 'image/png',
    });
    expect(UPLOAD_PHOTO_NAME).toBe('photo');
  });

  it('raises a refusal whose code is read as a call’s is', async () => {
    const fake = server(() => ({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', message: 'refused' } },
    }));
    const refusal = await clientOver(fake.fetch)
      .uploadPhoto(photo)
      .catch((error: unknown) => error);
    expect(errorCodeOf(refusal)).toBe('VALIDATION_FAILED');
  });

  it('refuses to upload when the client was given no photos address', async () => {
    const fake = server(() => ({ status: 201, body: { photoUrl: 'x' } }));
    await expect(clientOver(fake.fetch, false).uploadPhoto(photo)).rejects.toThrow(
      'no photos upload URL',
    );
    expect(fake.uploads).toEqual([]);
  });
});
