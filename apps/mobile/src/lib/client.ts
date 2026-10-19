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
  /** Called once when the server refuses the session's refresh. */
  readonly onSignedOut: () => void;
  /** The transport; the platform's own unless a test hands one in. */
  readonly fetch?: typeof fetch;
}

export interface ApiClient {
  readonly api: TRPCClient<AppRouter>;
  /** The support address and the Terms version, read once per launch. */
  publicConfig(): Promise<PublicConfig>;
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
  if (!(error instanceof TRPCClientError)) return undefined;
  const body: unknown = error.meta?.['responseJSON'] ?? error.cause;
  const code = codeOf(body);
  return typeof code === 'string' ? code : undefined;
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
