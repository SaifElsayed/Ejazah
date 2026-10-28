// T037: the admin panel's tRPC client, its only way to the network. It is typed by the API's
// administrator router, imported type-only (as the phone's client is, owner's decision 2026-10-19;
// a value import from the API is refused by lint, eslint.base.js), so a procedure the server does
// not publish is a compile error. A procedure mounted in a later batch (`auth.me`, `auth.signOut`,
// T066) is called by name through `untyped` until then.
//
// THE BEARER is the session token from the tab's sessionStorage (lib/session.ts).
//
// THE REFUSALS move the session, decided on the answer's code and never on its status (owner's
// decision 2026-10-19: ADMIN_SIGN_IN_FAILED is 401 like UNAUTHENTICATED, and a wrong password must
// not sign anyone out):
// - UNAUTHENTICATED: the session is refused (expired, revoked, unknown): it is cleared;
// - MFA_REQUIRED: the session is owed its second factor (kernel.md, `adminProcedure`): step `mfa`;
// - MFA_SETUP_REQUIRED: the administrator never set one up: step `setup`.
// The guard (App.tsx) follows the store, so the page changes with the session. Any other refusal is
// the page's to show.
//
// THE ERROR CODE. The API's error formatter answers `{ error: { code, message, details } }` with the
// code as text (contracts/README.md), where tRPC's client recognises only its own numeric shape, so
// a `TRPCClientError` from this API carries no `shape`; `errorCodeOf` reads the code from the body
// the error keeps (the phone's `errorCodeOf`, note under T033). T071: `errorDetailsOf` reads its
// details as the phone's does (`APPROVAL_BLOCKED`'s reasons, a refused field).
import {
  createTRPCClient,
  createTRPCUntypedClient,
  httpLink,
  type TRPCClient,
  TRPCClientError,
  type TRPCUntypedClient,
} from '@trpc/client';

import type { AdminRouter } from '../../../api/src/surfaces/admin.router';
import type { SessionStep, SessionStore } from './session';

export interface AdminClientOptions {
  /** The administrator surface's tRPC endpoint: the API's origin and `/admin/trpc`. */
  readonly url: string;
  readonly sessions: SessionStore;
  /** The transport; the browser's own unless a test hands one in. */
  readonly fetch?: typeof fetch;
}

export interface AdminClient {
  readonly api: TRPCClient<AdminRouter>;
  /** The same link, by procedure name, for the procedures a later batch mounts. */
  readonly untyped: TRPCUntypedClient<AdminRouter>;
  /** Revokes the session on the server, then clears the tab, whether the server answered or not. */
  signOut(): Promise<void>;
}

const UNAUTHENTICATED = 'UNAUTHENTICATED';

/** The step a refusal sends the session to. */
const STEP_OF_REFUSAL: Readonly<Record<string, SessionStep>> = {
  MFA_REQUIRED: 'mfa',
  MFA_SETUP_REQUIRED: 'setup',
};

export function createAdminClient(options: AdminClientOptions): AdminClient {
  const { url, sessions } = options;
  const transport = options.fetch ?? ((input, init) => fetch(input, init));

  async function send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const session = sessions.read();
    const headers = new Headers(init?.headers);
    if (session === null) headers.delete('authorization');
    else headers.set('authorization', `Bearer ${session.token}`);
    const response = await transport(input, { ...init, headers });
    if (!response.ok) await follow(response);
    return response;
  }

  async function follow(response: Response): Promise<void> {
    const code = await codeOfAnswer(response);
    if (code === undefined) return;
    if (code === UNAUTHENTICATED) {
      sessions.clear();
      return;
    }
    const step = STEP_OF_REFUSAL[code];
    if (step !== undefined) sessions.setStep(step);
  }

  const links = () => [httpLink({ url, fetch: asLinkFetch(send) })];
  const api = createTRPCClient<AdminRouter>({ links: links() });
  const untyped = createTRPCUntypedClient<AdminRouter>({ links: links() });

  return {
    api,
    untyped,
    async signOut() {
      try {
        await untyped.mutation('auth.signOut', {});
      } catch {
        // The tab forgets the session whatever the server answered: the token dies with the tab,
        // and the server's own expiry ends it.
      } finally {
        sessions.clear();
      }
    },
  };
}

/** The transport `httpLink` takes (tRPC names the type but does not export it). */
type LinkFetch = NonNullable<Parameters<typeof httpLink>[0]['fetch']>;

/**
 * The browser's `fetch` as tRPC's link takes it. The link hands `fetch` a request init whose
 * optional members tRPC types as `T | undefined`, which `exactOptionalPropertyTypes` refuses for
 * the DOM's `RequestInit`; the object is the same, so the one cast is here.
 */
function asLinkFetch(
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

/** The details a refusal carries, or none when the error never came from the API or had none. */
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

/** The answer's body a refusal keeps, or undefined when the error never came from the API. */
function bodyOf(error: unknown): unknown {
  if (!(error instanceof TRPCClientError)) return undefined;
  return error.meta?.['responseJSON'] ?? error.cause;
}

async function codeOfAnswer(response: Response): Promise<string | undefined> {
  try {
    const code = codeOf(await response.clone().json());
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

function codeOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}
