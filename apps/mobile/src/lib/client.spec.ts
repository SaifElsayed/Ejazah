// T033: the one network path (R-MOBILE-11). The tRPC client sends the access token as a bearer;
// an answer of UNAUTHENTICATED is refreshed once through `auth.refresh` (the schema T038
// publishes) and the call retried; a refused refresh signs the person out. The decision is made on
// the error's `code`, never on the status: SIGN_IN_FAILED and ONBOARDING_TOKEN_INVALID are 401 too
// (note under T018). `platform.publicConfig` is read once and cached.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import {
  CALL_TIMEOUT_MS,
  chatPart,
  createApiClient,
  errorCodeOf,
  errorDetailsOf,
  filePart,
  photoPart,
  retryNetworkFailure,
  UPLOAD_CHAT_NAMES,
  UPLOAD_FILE_NAME,
  UPLOAD_PHOTO_NAMES,
  UPLOAD_TIMEOUT_MS,
} from './client';
import type { SessionStore, SessionTokens } from './storage';

// expo-file-system's `File` is a native module; here it reads the same known bytes for any path.
const mockFileBytes = '%PDF-1.7 the picked file';
const mockOpened: string[] = [];
jest.mock('expo-file-system', () => ({
  File: class {
    constructor(uri: string) {
      mockOpened.push(uri);
    }

    bytes(): Promise<Uint8Array> {
      return Promise.resolve(new TextEncoder().encode(mockFileBytes));
    }
  },
}));

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

  // T156: a launch after the back key can hold two screen trees, each with its own client, over one store.
  it('refreshes once for calls of two clients over the same store refused together', async () => {
    const server = fakeServer((call) => {
      if (call.path === 'auth.refresh') return ok({ accessToken: 'a2', refreshToken: 'r2' });
      return call.bearer === 'a2' ? ok(subjects) : refused('UNAUTHENTICATED');
    });
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const onSignedOut = jest.fn();
    const [first, second] = [0, 1].map(() =>
      createApiClient({ url, sessions: sessions.store, onSignedOut, fetch: server.fetch }),
    );
    await expect(
      Promise.all([
        first?.api.catalog.subjects.list.query(),
        second?.api.catalog.subjects.list.query(),
      ]),
    ).resolves.toEqual([subjects, subjects]);
    expect(server.calls.filter((call) => call.path === 'auth.refresh')).toHaveLength(1);
    expect(sessions.current()).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('keeps the session when the refused token is no longer the stored one, and sends the call again', async () => {
    const sessions = memorySessions({ accessToken: 'a1', refreshToken: 'r1' });
    const server = fakeServer((call) => {
      if (call.path === 'auth.refresh') {
        // Another refresh rotated r1 and stored its answer before this refusal came back.
        void sessions.store.write({ accessToken: 'a3', refreshToken: 'r3' });
        return refused('UNAUTHENTICATED');
      }
      return call.bearer === 'a3' ? ok(subjects) : refused('UNAUTHENTICATED');
    });
    const onSignedOut = jest.fn();
    const client = createApiClient({
      url,
      sessions: sessions.store,
      onSignedOut,
      fetch: server.fetch,
    });
    await expect(client.api.catalog.subjects.list.query()).resolves.toEqual(subjects);
    expect(sessions.current()).toEqual({ accessToken: 'a3', refreshToken: 'r3' });
    expect(onSignedOut).not.toHaveBeenCalled();
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
    const config = {
      supportEmail: 'support@ijazah.app',
      termsVersion: '2026-10-01',
      teacherSharePercent: 70,
      paymentMode: 'test',
      checkout: {
        confirmationTimeoutSeconds: 15,
        processingPollSeconds: 2,
        confirmingPollSeconds: 30,
        confirmingPollWindowMinutes: 10,
      },
    };
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
    const config = {
      supportEmail: 'support@ijazah.app',
      termsVersion: '2026-10-01',
      teacherSharePercent: 70,
      paymentMode: 'test',
      checkout: {
        confirmationTimeoutSeconds: 15,
        processingPollSeconds: 2,
        confirmingPollSeconds: 30,
        confirmingPollWindowMinutes: 10,
      },
    };
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
      name: 'document.pdf',
      type: 'application/pdf',
      bytes: expect.any(Function),
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
      name: UPLOAD_PHOTO_NAMES.png,
      type: 'image/png',
      bytes: expect.any(Function),
    });
    expect(photoPart({ ...photo, mimeType: 'image/jpeg' })).toEqual({
      name: UPLOAD_PHOTO_NAMES.jpeg,
      type: 'image/jpeg',
      bytes: expect.any(Function),
    });
    expect(UPLOAD_PHOTO_NAMES).toEqual({ jpeg: 'photo.jpg', png: 'photo.png' });
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

// 005:T019 (FR-601; contracts/app-surface.md, `POST /uploads/signature`): the teacher's signature goes
// as the photo does, one JPEG or PNG under the photo's fixed name with the type the picker reported,
// through the same bearer; the answer is when it was uploaded, parsed by its contract.
describe('the signature upload (005:T019)', () => {
  const signatureUrl = 'https://api.test/uploads/signature';
  const image = {
    uri: 'file:///cache/my-signature.png',
    name: 'my-signature.png',
    mimeType: 'image/png',
  };

  function server(answer: () => { status: number; body: unknown }) {
    const uploads: { bearer: string | null; parts: [string, unknown][] }[] = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(signatureUrl);
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
      ...(withUrl ? { signatureUploadUrl: signatureUrl } : {}),
      onSignedOut: jest.fn(),
      fetch: fetchImpl,
    });
  }

  it('posts the one image with the bearer and answers when it was uploaded', async () => {
    const fake = server(() => ({ status: 201, body: { uploadedAt: '2026-11-18T10:00:00.000Z' } }));
    await expect(clientOver(fake.fetch).uploadSignature(image)).resolves.toEqual({
      uploadedAt: '2026-11-18T10:00:00.000Z',
    });
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.bearer).toBe('a1');
    expect(fake.uploads[0]?.parts.map(([name]) => name)).toEqual(['file']);
  });

  it('sends the image under the photo’s fixed name with the type the picker reported, never the person’s name', async () => {
    const fake = server(() => ({ status: 201, body: { uploadedAt: '2026-11-18T10:00:00.000Z' } }));
    // Jest's FormData keeps a part as text, so the part is read where the client appends it.
    const appended = jest.spyOn(FormData.prototype, 'append');
    try {
      await clientOver(fake.fetch).uploadSignature(image);
      expect(appended.mock.calls).toEqual([
        ['file', { name: UPLOAD_PHOTO_NAMES.png, type: 'image/png', bytes: expect.any(Function) }],
      ]);
    } finally {
      appended.mockRestore();
    }
  });

  it('refuses an answer its contract does not admit', async () => {
    const fake = server(() => ({ status: 201, body: { uploadedAt: 'yesterday' } }));
    await expect(clientOver(fake.fetch).uploadSignature(image)).rejects.toThrow();
  });

  it('raises a refusal whose code is read as a call’s is', async () => {
    const fake = server(() => ({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', message: 'refused' } },
    }));
    const refusal = await clientOver(fake.fetch)
      .uploadSignature(image)
      .catch((error: unknown) => error);
    expect(errorCodeOf(refusal)).toBe('VALIDATION_FAILED');
  });

  it('refuses to upload when the client was given no signature address', async () => {
    const fake = server(() => ({ status: 201, body: { uploadedAt: '2026-11-18T10:00:00.000Z' } }));
    await expect(clientOver(fake.fetch, false).uploadSignature(image)).rejects.toThrow(
      'no signature upload URL',
    );
    expect(fake.uploads).toEqual([]);
  });
});

// 004:T045 (FR-489, FR-490; contracts/app-surface.md, `POST /uploads/chat`): a chat document goes as
// multipart, the enrollment and the name the chat shows before the file, through the same bearer and
// the same one refresh as a call; the answer is the message it became, parsed by its contract. The
// file part carries a fixed name and the type the picker reported; the server decides the type by
// content (never trusting this one).
describe('the chat document upload (004:T045)', () => {
  const chatUrl = 'https://api.test/uploads/chat';
  const enrollmentId = '0193a6f0-0000-7000-8000-0000000000e1';
  const text = { uri: 'file:///cache/notes.txt', mimeType: 'text/plain' };
  const answer = {
    messageId: '0193a6f0-0000-7000-8000-0000000000f1',
    attachment: { filename: 'ملاحظات.txt', mime: 'text/plain' },
    sentAt: '2026-11-12T10:00:00.000Z',
  };

  function server(upload: (bearer: string | null) => { status: number; body: unknown }) {
    const uploads: { bearer: string | null; parts: [string, unknown][] }[] = [];
    const trpc = fakeServer((call) =>
      call.path === 'auth.refresh' ? ok({ accessToken: 'a2', refreshToken: 'r2' }) : ok(subjects),
    );
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== chatUrl) return trpc.fetch(input, init);
      const authorization = new Headers(init?.headers).get('authorization');
      const form = init?.body as {
        readonly _parts?: [string, unknown][];
        readonly entries?: () => Iterable<[string, unknown]>;
      };
      uploads.push({
        bearer: authorization === null ? null : authorization.replace(/^Bearer /, ''),
        parts: form._parts ?? [...(form.entries?.() ?? [])],
      });
      const { status, body } = upload(uploads.at(-1)?.bearer ?? null);
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
      ...(withUrl ? { chatUploadUrl: chatUrl } : {}),
      onSignedOut: jest.fn(),
      fetch: fetchImpl,
    });
    return { client, sessions };
  }

  it('posts the enrollment and the name before the file, with the bearer, and answers the message', async () => {
    const fake = server(() => ({ status: 201, body: answer }));
    const { client } = clientOver(fake.fetch);
    await expect(client.uploadChatDocument(enrollmentId, 'ملاحظات.txt', text)).resolves.toEqual(
      answer,
    );
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.bearer).toBe('a1');
    expect(fake.uploads[0]?.parts.map(([name]) => name)).toEqual([
      'enrollmentId',
      'filename',
      'file',
    ]);
    expect(fake.uploads[0]?.parts.slice(0, 2).map(([, value]) => value)).toEqual([
      enrollmentId,
      'ملاحظات.txt',
    ]);
  });

  it('refreshes once on UNAUTHENTICATED and sends the document again with the new bearer', async () => {
    const fake = server((bearer) =>
      bearer === 'a1' ? refused('UNAUTHENTICATED') : { status: 201, body: answer },
    );
    const { client, sessions } = clientOver(fake.fetch);
    await expect(client.uploadChatDocument(enrollmentId, 'notes.txt', text)).resolves.toEqual(
      answer,
    );
    expect(fake.uploads.map(({ bearer }) => bearer)).toEqual(['a1', 'a2']);
    expect(fake.trpc.calls.map(({ path }) => path)).toEqual(['auth.refresh']);
    expect(sessions.current()).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it.each(['ATTACHMENT_REFUSED', 'CHAT_CLOSED', 'RATE_LIMITED'])(
    'raises a refusal %s whose code is read as a call’s is',
    async (code) => {
      const fake = server(() => ({ status: 400, body: { error: { code, message: 'refused' } } }));
      const refusal = await clientOver(fake.fetch)
        .client.uploadChatDocument(enrollmentId, 'notes.txt', text)
        .catch((error: unknown) => error);
      expect(errorCodeOf(refusal)).toBe(code);
    },
  );

  it('refuses an answer outside the contract, never handing it on as a message', async () => {
    const fake = server(() => ({ status: 201, body: { ...answer, attachment: undefined } }));
    await expect(
      clientOver(fake.fetch).client.uploadChatDocument(enrollmentId, 'notes.txt', text),
    ).rejects.toThrow();
  });

  it('sends a text document as document.txt and a PDF as document.pdf, each with its type', () => {
    expect(UPLOAD_CHAT_NAMES).toEqual({ pdf: 'document.pdf', text: 'document.txt' });
    expect(chatPart(text)).toEqual({
      name: 'document.txt',
      type: 'text/plain',
      bytes: expect.any(Function),
    });
    expect(chatPart({ uri: 'file:///cache/a.pdf', mimeType: 'application/pdf' })).toEqual({
      name: 'document.pdf',
      type: 'application/pdf',
      bytes: expect.any(Function),
    });
  });

  it('refuses to upload when the client was given no chat uploads address', async () => {
    const fake = server(() => ({ status: 201, body: answer }));
    await expect(
      clientOver(fake.fetch, false).client.uploadChatDocument(enrollmentId, 'notes.txt', text),
    ).rejects.toThrow('no chat upload URL');
    expect(fake.uploads).toEqual([]);
  });
});

// T100: on the phone the global `fetch` is `expo/fetch`, whose multipart encoder takes a part that
// is a string, a Blob or an object with `bytes()`, and throws on React Native's `{ uri, name, type }`
// (`Unsupported FormDataPart implementation`). The body the client builds is run through Expo's own
// encoder over React Native's FormData with Expo's patch, as on the device.
describe('the multipart body expo/fetch sends (T100)', () => {
  const documentsUrl = 'https://api.test/uploads/documents';
  const photosUrl = 'https://api.test/uploads/photos';
  const boundary = 'ExpoBoundaryT100';

  type Encoder = (form: FormData, boundary?: string) => Promise<{ body: Uint8Array }>;
  const { convertFormDataAsync } = jest.requireActual<{ convertFormDataAsync: Encoder }>(
    'expo/src/winter/fetch/convertFormData',
  );
  const { installFormDataPatch } = jest.requireActual<{
    installFormDataPatch: (formData: typeof FormData) => unknown;
  }>('expo/src/winter/FormData');
  const ReactNativeFormData = jest.requireActual<{ default: typeof FormData }>(
    'react-native/Libraries/Network/FormData',
  ).default;
  installFormDataPatch(ReactNativeFormData);

  const jestFormData = globalThis.FormData;
  beforeAll(() => {
    globalThis.FormData = ReactNativeFormData;
  });
  afterAll(() => {
    globalThis.FormData = jestFormData;
  });

  /** The multipart body the upload would carry, as text, encoded by expo/fetch's encoder. */
  async function encodedUpload(send: (client: ReturnType<typeof createApiClient>) => unknown) {
    let form: FormData | undefined;
    const fetchImpl = jest.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      form = init?.body as FormData;
      return new Response(JSON.stringify({ documentId: 'd-1', photoUrl: 'https://files.test/p' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createApiClient({
      url,
      sessions: memorySessions({ accessToken: 'a1', refreshToken: 'r1' }).store,
      documentsUploadUrl: documentsUrl,
      photosUploadUrl: photosUrl,
      chatUploadUrl: 'https://api.test/uploads/chat',
      onSignedOut: jest.fn(),
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await send(client);
    if (form === undefined) throw new Error('the upload was not sent');
    const { body } = await convertFormDataAsync(form, boundary);
    return new TextDecoder().decode(body);
  }

  it('encodes the document as document.pdf with its bytes, never the picked name', async () => {
    const picked = { uri: 'file:///cache/sara-adel-id.pdf', name: 'sara-adel-id.pdf' };
    const body = await encodedUpload((client) => client.uploadDocument('identity', picked));
    expect(body).toContain('content-disposition: form-data; name="kind"\r\n\r\nidentity\r\n');
    expect(body).toContain(
      'content-disposition: form-data; name="file"; filename="document.pdf"\r\n' +
        'content-type: application/pdf\r\n\r\n' +
        `${mockFileBytes}\r\n`,
    );
    expect(mockOpened).toContain(picked.uri);
    expect(body).not.toContain('sara-adel-id');
  });

  it.each([
    ['image/jpeg', 'photo.jpg', 'IMG_0007.jpg'],
    ['image/png', 'photo.png', 'IMG_0008.png'],
  ])('encodes a %s photo as %s with its bytes, never the picked name', async (type, name, own) => {
    const picked = { uri: `file:///cache/${own}`, name: own, mimeType: type };
    const body = await encodedUpload((client) => client.uploadPhoto(picked));
    expect(body).toContain(
      `content-disposition: form-data; name="file"; filename="${name}"\r\n` +
        `content-type: ${type}\r\n\r\n` +
        `${mockFileBytes}\r\n`,
    );
    expect(mockOpened).toContain(picked.uri);
    expect(body).not.toContain(own);
  });

  // 004:T045: the chat's answer is not this helper's, so the call's rejection is set aside; the
  // body it sent is what is read.
  it('encodes a chat document under its fixed name with its bytes, after the enrollment and the name', async () => {
    const picked = { uri: 'file:///cache/hifz-notes.txt', mimeType: 'text/plain' };
    const body = await encodedUpload((client) =>
      client
        .uploadChatDocument('0193a6f0-0000-7000-8000-0000000000e1', 'ملاحظات.txt', picked)
        .catch(() => undefined),
    );
    expect(body).toContain(
      'content-disposition: form-data; name="enrollmentId"\r\n\r\n' +
        '0193a6f0-0000-7000-8000-0000000000e1\r\n',
    );
    expect(body.indexOf('name="filename"')).toBeLessThan(body.indexOf('name="file";'));
    expect(body).toContain(
      'content-disposition: form-data; name="file"; filename="document.txt"\r\n' +
        'content-type: text/plain\r\n\r\n' +
        `${mockFileBytes}\r\n`,
    );
    expect(mockOpened).toContain(picked.uri);
    expect(body).not.toContain('hifz-notes');
  });
});

// T146: every call the client makes takes a timeout, the refresh among them. A call whose answer
// never comes fails as an unreachable server's does (no API code), and a refresh that hangs fails
// too, so the calls waiting on the runtime's one refresh (T156) are freed and the next call starts
// a fresh one. The clock is Jest's; a hung transport answers only to its signal, as fetch does.
// The timeout lasts until the answer's body is read, not until its headers come (PR #112's review,
// round 1, Minor 4): a stalled answer has headers and a body that never comes.
describe('the timeouts (T146)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  type Answer = { status: number; body: unknown } | Stuck;
  /** Where a request sticks: before its headers (`hang`), or after them, in its body (`stall`). */
  type Stuck = 'hang' | 'stall';
  const stuck: Stuck[] = ['hang', 'stall'];
  type Settled = 'pending' | 'resolved' | 'rejected';

  /** An answer whose headers came and whose body never does. */
  function stalledAnswer(): Response {
    const never = () => new Promise<never>(() => undefined);
    const answer = {
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: never,
      text: never,
      arrayBuffer: never,
      clone: () => answer,
    };
    return answer as unknown as Response;
  }

  /** A transport that answers by `answer`, or hangs until its signal aborts, as fetch does. */
  function transport(answer: (target: string) => Answer) {
    const paths: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const target = String(input);
      paths.push(new URL(target).pathname.replace('/trpc/', ''));
      const signal = init?.signal ?? undefined;
      signals.push(signal);
      const answered = answer(target);
      if (answered === 'hang') {
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
        });
      }
      if (answered === 'stall') return stalledAnswer();
      return new Response(JSON.stringify(answered.body), {
        status: answered.status,
        headers: { 'content-type': 'application/json' },
      });
    });
    return { paths, signals, fetch: fetchImpl as unknown as typeof fetch };
  }

  /** Whether the promise has settled, once every timer due now has run. */
  async function stateOf(promise: Promise<unknown>): Promise<Settled> {
    let state: Settled = 'pending';
    promise.then(
      () => (state = 'resolved'),
      () => (state = 'rejected'),
    );
    await jest.advanceTimersByTimeAsync(0);
    return state;
  }

  type Client = ReturnType<typeof createApiClient>;

  function clientOver(fetchImpl: typeof fetch, sessions: SessionStore, onSignedOut = jest.fn()) {
    return createApiClient({
      url,
      sessions,
      documentsUploadUrl: 'https://api.test/uploads/documents',
      photosUploadUrl: 'https://api.test/uploads/photos',
      onSignedOut,
      fetch: fetchImpl,
    });
  }

  it.each(stuck)(
    'fails a call that sticks (%s) once its timeout passes, as an offline call fails',
    async (mode) => {
      const hung = transport(() => mode);
      const client = clientOver(hung.fetch, memorySessions(null).store);
      const call = client.api.catalog.subjects.list.query();
      const caught = call.catch((error: unknown) => error);

      await jest.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
      expect(await stateOf(call)).toBe('pending');
      await jest.advanceTimersByTimeAsync(1);
      expect(await stateOf(call)).toBe('rejected');
      expect(errorCodeOf(await caught)).toBeUndefined();
      expect(hung.signals[0]?.aborted).toBe(true);
    },
  );

  const uploads: [string, (client: Client) => Promise<string>][] = [
    [
      'document',
      (client) =>
        client.uploadDocument('identity', { uri: 'file:///cache/id.pdf', name: 'id.pdf' }),
    ],
    [
      'photo',
      (client) =>
        client.uploadPhoto({ uri: 'file:///cache/p.png', name: 'p.png', mimeType: 'image/png' }),
    ],
  ];

  it.each(stuck.flatMap((mode) => uploads.map(([kind, send]) => [mode, kind, send] as const)))(
    'fails an upload that sticks (%s, %s) once its timeout passes',
    async (mode, _kind, send) => {
      const hung = transport(() => mode);
      const client = clientOver(
        hung.fetch,
        memorySessions({ accessToken: 'a1', refreshToken: 'r1' }).store,
      );
      const upload = send(client);
      const caught = upload.catch((error: unknown) => error);

      await jest.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
      expect(await stateOf(upload)).toBe('pending');
      await jest.advanceTimersByTimeAsync(1);
      expect(await stateOf(upload)).toBe('rejected');
      expect(errorCodeOf(await caught)).toBeUndefined();
      expect(hung.signals[0]?.aborted).toBe(true);
    },
  );

  it.each(stuck)(
    'fails a refresh that sticks (%s), frees the calls waiting on it, and the next call refreshes afresh',
    async (mode) => {
      let refreshes = 0;
      const hung = transport((target) => {
        if (target.endsWith('/auth.refresh')) {
          refreshes += 1;
          return refreshes === 1 ? mode : ok({ accessToken: 'a146b', refreshToken: 'r146b' });
        }
        return refused('UNAUTHENTICATED');
      });
      // Tokens of this test alone: the runtime's refreshes are keyed by the token presented (T156).
      const sessions = memorySessions({ accessToken: 'a146', refreshToken: `r146-${mode}` });
      const onSignedOut = jest.fn();
      // Two screen trees' clients over one store share the runtime's one refresh (T156).
      const clients = [0, 1].map(() => clientOver(hung.fetch, sessions.store, onSignedOut));
      const waiting = clients.map((client) => client.api.catalog.subjects.list.query());
      const outcomes = waiting.map((call) => call.catch((error: unknown) => error));

      await jest.advanceTimersByTimeAsync(0);
      expect(hung.paths.filter((path) => path === 'auth.refresh')).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
      expect(await Promise.all(waiting.map((call) => stateOf(call)))).toEqual([
        'rejected',
        'rejected',
      ]);
      await Promise.all(outcomes);
      // A refresh that never answered is no refusal: the session stays (review of B6, finding 1).
      expect(sessions.current()).toEqual({ accessToken: 'a146', refreshToken: `r146-${mode}` });
      expect(onSignedOut).not.toHaveBeenCalled();

      // The next call is not held by the hung refresh: it starts its own, which answers.
      const next = clients[0]?.api.catalog.subjects.list.query().catch(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
      await next;
      expect(refreshes).toBe(2);
      expect(sessions.current()).toEqual({ accessToken: 'a146b', refreshToken: 'r146b' });
    },
  );

  it("passes the caller's own cancellation through to the transport", async () => {
    const hung = transport(() => 'hang');
    const client = clientOver(hung.fetch, memorySessions(null).store);
    const cancel = new AbortController();
    const call = client.api.catalog.subjects.list.query(undefined, { signal: cancel.signal });
    const caught = call.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(0);
    cancel.abort();
    expect(await stateOf(call)).toBe('rejected');
    expect(errorCodeOf(await caught)).toBeUndefined();
    expect(hung.signals[0]?.aborted).toBe(true);
  });
});

// T065 of specs/004-sessions (research R-324, items 2 and 8; R-325, item 3): the live channel's
// subscription goes through its own link and its own EventSource, never through `timed()`, and a
// refused opening reaches the subscriber as `httpSubscriptionLink` hands it, its code and its
// `retryAfterSeconds` read through `errorCodeOf` and `errorDetailsOf`. The query cache retries only
// a failure with no API code: a refusal, `RATE_LIMITED` included, is never sent again by itself.
describe('the live channel’s subscription (T065)', () => {
  const encoder = new TextEncoder();

  /** A server answering `live.events` with the frames `frames` writes, the stream left open. */
  function streamingServer(frames: string, server = fakeServer(() => ok(subjects))) {
    const opens: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const target = typeof input === 'string' ? input : input.toString();
      if (!target.includes('live.events')) return server.fetch(input, init);
      opens.push({ url: target, init });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(frames));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    return { opens, server, fetch: fetchImpl as unknown as typeof fetch };
  }

  function clientOver(fetchImpl: typeof fetch) {
    return createApiClient({
      url,
      sessions: memorySessions({ accessToken: 'a65', refreshToken: 'r65' }).store,
      onSignedOut: jest.fn(),
      fetch: fetchImpl,
    });
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens `live.events` as a GET stream with the bearer in its header, while a call still goes as before', async () => {
    const streaming = streamingServer('event: connected\ndata: {}\n\n');
    const client = clientOver(streaming.fetch);
    const started = new Promise<void>((resolve) => {
      const subscription = client.api.live.events.subscribe(undefined, {
        onStarted: () => {
          subscription.unsubscribe();
          resolve();
        },
      });
    });
    await started;
    await expect(client.api.catalog.subjects.list.query()).resolves.toEqual(subjects);

    expect(streaming.opens).toHaveLength(1);
    const [open] = streaming.opens;
    expect(open?.url).toBe(`${url}/live.events`);
    const headers = new Headers(open?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer a65');
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(open?.url).not.toContain('a65');
    expect(streaming.server.calls.map((call) => call.path)).toEqual(['catalog.subjects.list']);
  });

  it('keeps the stream past CALL_TIMEOUT_MS: no call timeout aborts it', async () => {
    jest.useFakeTimers();
    const streaming = streamingServer('event: connected\ndata: {}\n\n');
    const client = clientOver(streaming.fetch);
    const onError = jest.fn();
    const onStarted = jest.fn();
    const subscription = client.api.live.events.subscribe(undefined, { onStarted, onError });
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 1_000);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(streaming.opens[0]?.init?.signal?.aborted).toBe(false);
    subscription.unsubscribe();
  });

  it('hands a refused opening to the subscriber with its code and retryAfterSeconds', async () => {
    const refusal = {
      code: 'RATE_LIMITED',
      message: 'Too many requests.',
      details: [{ path: 'retryAfterSeconds', code: '31' }],
    };
    const streaming = streamingServer(
      `event: connected\ndata: {}\n\nevent: serialized-error\ndata: ${JSON.stringify(refusal)}\n\n`,
    );
    const client = clientOver(streaming.fetch);
    const error = await new Promise<unknown>((resolve) => {
      client.api.live.events.subscribe(undefined, { onError: resolve });
    });
    expect(errorCodeOf(error)).toBe('RATE_LIMITED');
    expect(errorDetailsOf(error)).toEqual([{ path: 'retryAfterSeconds', code: '31' }]);
  });
});

describe('the query cache’s retry rule (T065, R-325 item 3)', () => {
  it('retries a failure with no API code, up to TanStack’s three', () => {
    const offline = new TypeError('Network request failed');
    expect([0, 1, 2, 3].map((failures) => retryNetworkFailure(failures, offline))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('never retries an API refusal, RATE_LIMITED included', async () => {
    for (const code of ['RATE_LIMITED', 'NOT_FOUND', 'INTERNAL', 'UNAUTHENTICATED']) {
      const server = fakeServer(() => refused(code, code === 'RATE_LIMITED' ? 429 : 400));
      const client = createApiClient({
        url,
        sessions: memorySessions(null).store,
        onSignedOut: jest.fn(),
        fetch: server.fetch,
      });
      const error = await client.api.catalog.subjects.list.query().catch((caught) => caught);
      expect(errorCodeOf(error)).toBe(code);
      expect(retryNetworkFailure(0, error)).toBe(false);
    }
  });
});
