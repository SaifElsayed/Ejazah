// T033: the shared tRPC client, the only way to the network (R-MOBILE-11). It is typed by the API's
// router type, imported type-only (owner's decision 2026-10-19; a value import from the API is
// refused by lint, eslint.base.js), so a procedure the server does not publish is a compile error.
//
// THE SESSION. The access token travels as a bearer. An answer whose code is UNAUTHENTICATED is
// refreshed once through `auth.refresh` with the stored refresh token (the schemas T038 publishes in
// contracts/auth.ts) and the call is sent again with the new token; calls refused together share
// one refresh. A refresh the server refuses (UNAUTHENTICATED) clears the session and calls
// `onSignedOut`; any other failure of the refresh (INTERNAL, RATE_LIMITED, offline) keeps the
// session, and the call fails as any offline call does. T156: the refresh of a stored token is one
// per runtime, not per client, since a launch after the back key can mount a second screen tree,
// and its own client, in the runtime the first still holds; and a refusal of a token the store no
// longer holds (another refresh replaced it) is no sign-out, the call is sent again instead. The
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
// raised as `ApiRefusal`, whose code `errorCodeOf` reads as it reads a call's. The profile photo
// (T084) goes to `POST /uploads/photos` the same way, one JPEG or PNG under a fixed name, and the
// answer is the signed link to it (`{ photoUrl }`). T100: on the phone the global `fetch` is
// `expo/fetch`, whose multipart encoder takes a part that is a string, a Blob or an object with
// `bytes()`, and throws on React Native's `{ uri, name, type }`; so a file part is its fixed name,
// its type and a `bytes()` that reads the picked file through expo-file-system when it is sent.
// 005:T019 (FR-601): the teacher's signature goes to `POST /uploads/signature` as the photo does, one
// JPEG or PNG under the photo's fixed name, and the answer is when it was uploaded (`{ uploadedAt }`);
// the image itself is read through `teacher.signature.get`'s signed link.
//
// THE TIMEOUTS (T146). Every request takes a timeout, the refresh among them: a call or a refresh
// within `CALL_TIMEOUT_MS`, an upload within `UPLOAD_TIMEOUT_MS`. A request past it is aborted
// and fails as an unreachable server's does, with no API code; a refresh that hangs thus fails,
// the calls waiting on it are freed with the session kept, and the next call refreshes afresh.
//
// THE LIVE CHANNEL (T065 of specs/004-sessions; research R-324, item 2). A subscription goes through
// tRPC's `httpSubscriptionLink` (a `splitLink`) over lib/live.ts' EventSource, on the bare transport
// and never through `timed()`, which reads the whole body and aborts after `CALL_TIMEOUT_MS`; the
// EventSource reads the bearer from the session store at each open. Every other call goes as above.
// A refused opening reaches the subscriber as the link hands it, its body in the error's `cause`,
// which `errorCodeOf` and `errorDetailsOf` read as they read a call's.
//
// THE RETRY RULE (T065; research R-325, item 3). The query cache retries only a failure with no API
// code (no answer: offline, a timeout), up to TanStack's default three; an API refusal, `RATE_LIMITED`
// included, is never sent again by itself, or one refusal would count four times against a limit.
//
// THE PUBLIC CONFIGURATION. `platform.publicConfig` (`supportEmail`, `termsVersion`) is read once
// per launch and cached; a failed read is not cached, so the next screen tries again.
import {
  type ChatUploadOutput,
  chatUploadOutput,
  type PublicConfig,
  publicConfigOutput,
  refreshOutput,
  type SignatureUploadOutput,
  signatureUploadOutput,
} from '@ijazah/contracts';
import {
  createTRPCClient,
  createTRPCUntypedClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
  type TRPCClient,
} from '@trpc/client';
import { File } from 'expo-file-system';

import type { AppRouter } from '../../../api/src/surfaces/app.router';
import { liveEventSource } from './live';
import type { SessionStore } from './storage';

export interface ApiClientOptions {
  /** The user surface's tRPC endpoint: the API's origin and `/trpc`. */
  readonly url: string;
  readonly sessions: SessionStore;
  /** `POST /uploads/documents` on the API's origin (T058). */
  readonly documentsUploadUrl?: string;
  /** `POST /uploads/photos` on the API's origin (T084). */
  readonly photosUploadUrl?: string;
  /** `POST /uploads/chat` on the API's origin (004:T045). */
  readonly chatUploadUrl?: string;
  /** `POST /uploads/signature` on the API's origin (005:T019). */
  readonly signatureUploadUrl?: string;
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
  /** Uploads the profile photo the person picked; the signed link to it (T084). */
  uploadPhoto(file: LocalPhoto): Promise<string>;
  /**
   * Sends a PDF or a text document the person picked to an enrollment's chat, under the name the
   * chat shows; the message it became (004:T045).
   */
  uploadChatDocument(
    enrollmentId: string,
    filename: string,
    file: LocalChatFile,
  ): Promise<ChatUploadOutput>;
  /** Uploads the teacher's signature image the person picked; when it was uploaded (005:T019). */
  uploadSignature(file: LocalPhoto): Promise<SignatureUploadOutput>;
}

/** What an upload is for: the identity document or an ijazah (`POST /uploads/documents`). */
export type DocumentKind = 'identity' | 'credential';

/** A file on the device, as the document picker hands it. */
export interface LocalFile {
  readonly uri: string;
  readonly name: string;
}

/** An image on the device, as the picker hands it, with the type it reported. */
export interface LocalPhoto extends LocalFile {
  readonly mimeType: string;
}

/** A document on the device for the chat, as the picker hands it, with the type it reported. */
export interface LocalChatFile {
  readonly uri: string;
  readonly mimeType: string;
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

/** How long a call, the refresh among them, waits for its answer before it fails (T146). */
export const CALL_TIMEOUT_MS = 30_000;
/** How long an upload waits for its answer: a 10 MiB file (NFR-SEC-9) over a slow network (T146). */
export const UPLOAD_TIMEOUT_MS = 120_000;

/** The refreshes on their way, by the refresh token they present: one per token in the runtime (T156). */
const refreshesInFlight = new Map<string, Promise<boolean>>();

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { url, sessions, onSignedOut } = options;
  const transport = options.fetch ?? fetch;

  // The refresh goes without a bearer and without the retry below, and within its timeout (T146).
  const refresher = createTRPCUntypedClient({
    links: [httpLink({ url, fetch: asFetchEsque(timed(transport, CALL_TIMEOUT_MS)) })],
  });
  async function refreshOnce(presented: string): Promise<boolean> {
    try {
      const answer = await refresher.mutation('auth.refresh', { refreshToken: presented });
      await sessions.write(refreshOutput.parse(answer));
      return true;
    } catch (error) {
      // Only a refused token signs out (FR-135 answers every refusal UNAUTHENTICATED); a failure of
      // the server, a throttle, or no answer at all keeps the session (review of B6, finding 1).
      if (errorCodeOf(error) === UNAUTHENTICATED) {
        // A token another refresh has replaced meanwhile was refused, not the session (T156).
        const stored = await sessions.read();
        if (stored !== null && stored.refreshToken !== presented) return true;
        await sessions.clear();
        onSignedOut();
        return false;
      }
      throw error;
    }
  }

  async function refresh(): Promise<boolean> {
    const current = await sessions.read();
    if (current === null) return false;
    const presented = current.refreshToken;
    const pending = refreshesInFlight.get(presented);
    if (pending !== undefined) return pending;
    const started = refreshOnce(presented).finally(() => {
      refreshesInFlight.delete(presented);
    });
    refreshesInFlight.set(presented, started);
    return started;
  }

  /** The session's transport: each send, the retry after a refresh among them, within `timeoutMs`. */
  function sessionFetchWithin(timeoutMs: number): Transport {
    const sendTimed = timed(transport, timeoutMs);
    async function send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const session = await sessions.read();
      const headers = new Headers(init?.headers);
      if (session === null) headers.delete('authorization');
      else headers.set('authorization', `Bearer ${session.accessToken}`);
      return sendTimed(input, { ...init, headers });
    }
    return async (input, init) => {
      const first = await send(input, init);
      if (first.status !== STATUS_UNAUTHORIZED || !(await isUnauthenticated(first))) return first;
      if (!(await refresh().catch(() => false))) return first;
      return send(input, init);
    };
  }
  const sessionFetch = sessionFetchWithin(CALL_TIMEOUT_MS);
  const uploadFetch = sessionFetchWithin(UPLOAD_TIMEOUT_MS);

  const api = createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: httpSubscriptionLink({
          url,
          EventSource: liveEventSource({
            sessions,
            fetch: (target, init) => transport(target, init),
          }),
        }),
        false: httpLink({ url, fetch: asFetchEsque(sessionFetch) }),
      }),
    ],
  });

  let config: Promise<PublicConfig> | null = null;
  return {
    api,
    async uploadDocument(kind, file) {
      const target = options.documentsUploadUrl;
      if (target === undefined) throw new Error('uploadDocument: no documents upload URL');
      const body = new FormData();
      body.append('kind', kind);
      // Expo's FormData keeps the part as it is; expo/fetch reads its name, type and bytes.
      body.append('file', filePart(file) as unknown as Blob);
      const response = await uploadFetch(target, { method: 'POST', body });
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ApiRefusal(answer);
      return documentIdOf(answer);
    },
    async uploadPhoto(file) {
      const target = options.photosUploadUrl;
      if (target === undefined) throw new Error('uploadPhoto: no photos upload URL');
      const body = new FormData();
      body.append('file', photoPart(file) as unknown as Blob);
      const response = await uploadFetch(target, { method: 'POST', body });
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ApiRefusal(answer);
      return photoUrlOf(answer);
    },
    async uploadChatDocument(enrollmentId, filename, file) {
      const target = options.chatUploadUrl;
      if (target === undefined) throw new Error('uploadChatDocument: no chat upload URL');
      // The two fields precede the file (contracts/app-surface.md, `POST /uploads/chat`).
      const body = new FormData();
      body.append('enrollmentId', enrollmentId);
      body.append('filename', filename);
      body.append('file', chatPart(file) as unknown as Blob);
      const response = await uploadFetch(target, { method: 'POST', body });
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ApiRefusal(answer);
      return chatUploadOutput.parse(answer);
    },
    async uploadSignature(file) {
      const target = options.signatureUploadUrl;
      if (target === undefined) throw new Error('uploadSignature: no signature upload URL');
      const body = new FormData();
      body.append('file', photoPart(file) as unknown as Blob);
      const response = await uploadFetch(target, { method: 'POST', body });
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ApiRefusal(answer);
      return signatureUploadOutput.parse(answer);
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

/** A transport: the platform's `fetch`, or the one a test hands in. */
type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * The transport within a timeout (T146). Past `timeoutMs` the request is aborted and the call fails
 * with an error that carries no API code, as an unreachable server's does, whether or not the
 * transport heeds its signal; the caller's own signal (tRPC's cancellation) still aborts it. The
 * timer and the listener go as soon as the call settles.
 */
function timed(transport: Transport, timeoutMs: number): Transport {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const controller = new AbortController();
      const caller = init?.signal ?? undefined;
      const cancel = () => controller.abort(caller?.reason);
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        caller?.removeEventListener('abort', cancel);
        settle();
      };
      const timer = setTimeout(() => {
        const timedOut = new Error(`The call had no answer within ${timeoutMs} ms`);
        timedOut.name = 'TimeoutError';
        controller.abort(timedOut);
        finish(() => reject(timedOut));
      }, timeoutMs);
      if (caller?.aborted === true) cancel();
      else caller?.addEventListener('abort', cancel);
      transport(input, { ...init, signal: controller.signal })
        .then(async (response) => {
          // The answer has come when its body is read, not its headers (PR #112, round 1, Minor 4).
          const body = await response.text();
          const { status, statusText, headers } = response;
          return new Response(body === '' ? null : body, { status, statusText, headers });
        })
        .then(
          (response) => finish(() => resolve(response)),
          (error: unknown) => finish(() => reject(error)),
        );
    });
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

/** TanStack's default number of retries, kept for a failure with no API code. */
const NETWORK_RETRIES = 3;

/** The query cache's `retry` rule: a failure with no API code only, never a refusal (T065). */
export function retryNetworkFailure(failureCount: number, error: unknown): boolean {
  return errorCodeOf(error) === undefined && failureCount < NETWORK_RETRIES;
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

/** The name every upload carries: the server discards it, and the person's file name stays here. */
export const UPLOAD_FILE_NAME = 'document.pdf';

/**
 * A multipart file part as expo/fetch encodes it: the name and type it sends, and the file's bytes,
 * read from the device only when the request is sent (T100).
 */
export interface UploadPart {
  readonly name: string;
  readonly type: string;
  bytes(): Promise<Uint8Array>;
}

/**
 * The multipart file part of an upload: a fixed name rather than the person's, which may carry
 * their name (owner's decision 2026-10-21; review of B11b, round 1, finding 3), and the file's bytes.
 */
export function filePart(file: LocalFile): UploadPart {
  return {
    name: UPLOAD_FILE_NAME,
    type: 'application/pdf',
    bytes: () => new File(file.uri).bytes(),
  };
}

/**
 * The name every photo carries, by the type the picker reported: the server decides the type again
 * by content and keeps no name (owner's decision 2026-10-27, T100).
 */
export const UPLOAD_PHOTO_NAMES = { jpeg: 'photo.jpg', png: 'photo.png' } as const;

/** The multipart part of a photo: a fixed name, the type the picker reported, and its bytes. */
export function photoPart(file: LocalPhoto): UploadPart {
  const name = file.mimeType === 'image/png' ? UPLOAD_PHOTO_NAMES.png : UPLOAD_PHOTO_NAMES.jpeg;
  return { name, type: file.mimeType, bytes: () => new File(file.uri).bytes() };
}

/**
 * The names a chat document carries, by the type the picker reported (004:T045): the server
 * decides the type again by content and stores the name the chat shows, sent as its own field.
 */
export const UPLOAD_CHAT_NAMES = { pdf: 'document.pdf', text: 'document.txt' } as const;

const TEXT_PLAIN = 'text/plain';
const APPLICATION_PDF = 'application/pdf';

/** The multipart part of a chat document: a fixed name, its type, and its bytes. */
export function chatPart(file: LocalChatFile): UploadPart {
  const text = file.mimeType === TEXT_PLAIN;
  return {
    name: text ? UPLOAD_CHAT_NAMES.text : UPLOAD_CHAT_NAMES.pdf,
    type: text ? TEXT_PLAIN : APPLICATION_PDF,
    bytes: () => new File(file.uri).bytes(),
  };
}

/** The photos route's answer: the signed link to the new photo. */
function photoUrlOf(answer: unknown): string {
  if (typeof answer === 'object' && answer !== null && 'photoUrl' in answer) {
    const { photoUrl } = answer;
    if (typeof photoUrl === 'string') return photoUrl;
  }
  throw new Error('uploadPhoto: the answer carries no photo link');
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
