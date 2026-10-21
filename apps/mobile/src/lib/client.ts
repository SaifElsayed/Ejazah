// T033: the shared tRPC client, the only way to the network (R-MOBILE-11). It is typed by the API's
// router type, imported type-only (owner's decision 2026-10-19; a value import from the API is
// refused by lint, eslint.base.js), so a procedure the server does not publish is a compile error.
//
// THE SESSION. The access token travels as a bearer. An answer whose code is UNAUTHENTICATED is
// refreshed once through `auth.refresh` with the stored refresh token (the schemas T038 publishes in
// contracts/auth.ts) and the call is sent again with the new token; calls refused together share
// one refresh. A refresh the server refuses (UNAUTHENTICATED) clears the session and calls
// `onSignedOut`; any other failure of the refresh (INTERNAL, RATE_LIMITED, offline) keeps the
// session, and the call fails as any offline call does. The
// decision is made on the error's `code`, never on the HTTP status: SIGN_IN_FAILED and
// ONBOARDING_TOKEN_INVALID are 401 too (note under T018). `auth.refresh` is mounted in B10, so it
// is called by name through an untyped client and its answer parsed with `refreshOutput`.
//
// THE ERROR CODE. The API's error formatter answers `{ error: { code, message, details } }` with
// the code as text (contracts/README.md), where tRPC's client recognises only its own shape (a
// numeric JSON-RPC code), so a `TRPCClientError` from this API carries no `shape`. `errorCodeOf`
// reads the code from the answer's body the error keeps; screens switch on it, never on a message
// or a status.
//
// THE UPLOADS (T058). A PDF goes to `POST /uploads/documents` as multipart, the `kind` before the
// file (public-pages.md "The uploads route"), through the same bearer and the same one refresh as
// a call; the answer is the document's id. A refusal arrives in the API's one error shape and is
// raised as `ApiRefusal`, whose code `errorCodeOf` reads as it reads a call's.
//
// THE PUBLIC CONFIGURATION. `platform.publicConfig` (`supportEmail`, `termsVersion`) is read once
// per launch and cached; a failed read is not cached, so the next screen tries again.
import { type PublicConfig, publicConfigOutput, refreshOutput } from '@ijazah/contracts';
import {
  createTRPCClient,
  createTRPCUntypedClient,
  httpLink,
  TRPCClientError,
  type TRPCClient,
} from '@trpc/client';

import type { AppRouter } from '../../../api/src/surfaces/app.router';
import type { SessionStore } from './storage';

export interface ApiClientOptions {
  /** The user surface's tRPC endpoint: the API's origin and `/trpc`. */
  readonly url: string;
  readonly sessions: SessionStore;
  /** `POST /uploads/documents` on the API's origin (T058). */
  readonly documentsUploadUrl?: string;
  /** Called once when the server refuses the session's refresh. */
  readonly onSignedOut: () => void;
  /** The transport; the platform's own unless a test hands one in. */
  readonly fetch?: typeof fetch;
}

export interface ApiClient {
  readonly api: TRPCClient<AppRouter>;
  /** The support address and the Terms version, read once per launch. */
  publicConfig(): Promise<PublicConfig>;
  /** Uploads a PDF the person picked; the document's id (T058). */
  uploadDocument(kind: DocumentKind, file: LocalFile): Promise<string>;
}

/** What an upload is for: the identity document or an ijazah (`POST /uploads/documents`). */
export type DocumentKind = 'identity' | 'credential';

/** A file on the device, as the document picker hands it. */
export interface LocalFile {
  readonly uri: string;
  readonly name: string;
}

/** A refusal of a call made outside tRPC (an upload), in the API's one error shape. */
export class ApiRefusal extends Error {
  readonly body: unknown;

  constructor(body: unknown) {
    super('The API refused the request');
    this.name = 'ApiRefusal';
    this.body = body;
  }
}

const UNAUTHENTICATED = 'UNAUTHENTICATED';
const STATUS_UNAUTHORIZED = 401;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { url, sessions, onSignedOut } = options;
  const transport = options.fetch ?? fetch;

  // The refresh goes without a bearer and without the retry below.
  const refresher = createTRPCUntypedClient({
    links: [httpLink({ url, fetch: asFetchEsque(transport) })],
  });
  let refreshing: Promise<boolean> | null = null;

  async function refreshOnce(): Promise<boolean> {
    const current = await sessions.read();
    if (current === null) return false;
    try {
      const answer = await refresher.mutation('auth.refresh', {
        refreshToken: current.refreshToken,
      });
      await sessions.write(refreshOutput.parse(answer));
      return true;
    } catch (error) {
      // Only a refused token signs out (FR-135 answers every refusal UNAUTHENTICATED); a failure of
      // the server, a throttle, or no answer at all keeps the session (review of B6, finding 1).
      if (errorCodeOf(error) === UNAUTHENTICATED) {
        await sessions.clear();
        onSignedOut();
        return false;
      }
      throw error;
    }
  }

  function refresh(): Promise<boolean> {
    refreshing ??= refreshOnce().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const session = await sessions.read();
    const headers = new Headers(init?.headers);
    if (session === null) headers.delete('authorization');
    else headers.set('authorization', `Bearer ${session.accessToken}`);
    return transport(input, { ...init, headers });
  }

  const sessionFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const first = await send(input, init);
    if (first.status !== STATUS_UNAUTHORIZED || !(await isUnauthenticated(first))) return first;
    if (!(await refresh().catch(() => false))) return first;
    return send(input, init);
  };

  const api = createTRPCClient<AppRouter>({
    links: [httpLink({ url, fetch: asFetchEsque(sessionFetch) })],
  });

  let config: Promise<PublicConfig> | null = null;
  return {
    api,
    async uploadDocument(kind, file) {
      const target = options.documentsUploadUrl;
      if (target === undefined) throw new Error('uploadDocument: no documents upload URL');
      const body = new FormData();
      body.append('kind', kind);
      // React Native's FormData takes a file as its uri, name and type.
      body.append('file', {
        uri: file.uri,
        name: file.name,
        type: 'application/pdf',
      } as unknown as Blob);
      const response = await sessionFetch(target, { method: 'POST', body });
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ApiRefusal(answer);
      return documentIdOf(answer);
    },
    publicConfig() {
      config ??= api.platform.publicConfig
        .query()
        .then((answer) => publicConfigOutput.parse(answer))
        .catch((error: unknown) => {
          config = null;
          throw error;
        });
      return config;
    },
  };
}

/** The transport `httpLink` takes (tRPC names the type but does not export it). */
type LinkFetch = NonNullable<Parameters<typeof httpLink>[0]['fetch']>;

/**
 * The platform's `fetch` as tRPC's link takes it. The link hands `fetch` a request init whose
 * optional members tRPC types as `T | undefined`, which `exactOptionalPropertyTypes` refuses for
 * the DOM's `RequestInit`; the object is the same, so the one cast is here.
 */
function asFetchEsque(
  transport: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): LinkFetch {
  return (input, init) => transport(input, init as RequestInit | undefined);
}

/**
 * The API's error code (`UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION_FAILED`, …) a failed call
 * carries, or undefined when the error never came from the API (offline, a timeout, a bug).
 */
export function errorCodeOf(error: unknown): string | undefined {
  const code = codeOf(bodyOf(error));
  return typeof code === 'string' ? code : undefined;
}

/** One detail of an API error: the field and the reason (contracts/README.md "Errors"). */
export interface ErrorDetail {
  readonly path: string;
  readonly code: string;
}

/**
 * The details a failed call carries (`EMAIL_IN_USE_BY_OTHER_METHOD`'s method, a refused field), or
 * none when the error never came from the API or carried none.
 */
export function errorDetailsOf(error: unknown): readonly ErrorDetail[] {
  const body = bodyOf(error);
  if (typeof body !== 'object' || body === null || !('error' in body)) return [];
  const { error: answer } = body;
  if (typeof answer !== 'object' || answer === null || !('details' in answer)) return [];
  const { details } = answer;
  if (!Array.isArray(details)) return [];
  return details.filter(
    (detail): detail is ErrorDetail =>
      typeof detail === 'object' &&
      detail !== null &&
      typeof (detail as ErrorDetail).path === 'string' &&
      typeof (detail as ErrorDetail).code === 'string',
  );
}

/** The uploads route's answer: the document's id. */
function documentIdOf(answer: unknown): string {
  if (typeof answer === 'object' && answer !== null && 'documentId' in answer) {
    const { documentId } = answer;
    if (typeof documentId === 'string') return documentId;
  }
  throw new Error('uploadDocument: the answer carries no document id');
}

/** The answer's body a refusal keeps, or undefined when the error never came from the API. */
function bodyOf(error: unknown): unknown {
  if (error instanceof ApiRefusal) return error.body;
  if (!(error instanceof TRPCClientError)) return undefined;
  return error.meta?.['responseJSON'] ?? error.cause;
}

/** True when the answer's tRPC error carries the UNAUTHENTICATED code. */
async function isUnauthenticated(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.clone().json();
    return codeOf(body) === UNAUTHENTICATED;
  } catch {
    return false;
  }
}

function codeOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}
