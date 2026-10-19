// T024: the upload route helper (FR-151, R-SEC-3, R-SEC-4; public-pages.md "The uploads route";
// kernel.md "Guards applied by default"). The two upload routes of this phase are POSTs of one
// multipart file outside both tRPC surfaces (a procedure's input is JSON), written over this
// helper so each is thin: the helper takes the request through, in order, the method, the user
// bearer (`sessions.user`, as the surfaces do, T017), the standing the route admits (the restricted
// rule of the user kinds, FR-137), the multipart body's first file, the route's `kind`, and T020's
// kinds guard (the uploader counted under `rate_limit_upload`, `upload_max_bytes`, the type decided
// by content), then hands the route's handler the uploader, the kind, the sniffed type and the
// bytes, and answers 201 with what the handler returns as JSON. Every refusal leaves in the
// kernel's one error shape with its status (FR-041); an unexpected failure is logged on the
// request's logger and reported, and the client sees the internal error.
//
// After a refusal the socket is closed once the answer is flushed (`Connection: close`): the
// client may still be sending the file, and a refused body is not read to its end.
//
// It lives beside the surfaces, as the public-configuration router does, because it reads the
// session types and the bearer the surfaces define, and the kernel depends on nothing above it.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DomainError } from '../platform/errors/domain-error.js';
import { mapError, type MappedError } from '../platform/errors/error-filter.js';
import { reportError } from '../platform/errors/reporting.js';
import {
  acceptUploadOfKind,
  type SniffedType,
  type UploadGuard,
  type UploadKind,
} from '../platform/guards/upload.middleware.js';
import { firstFileOf } from '../platform/http/multipart.js';
import { type Logger, requestLogger } from '../platform/logging/logger.js';
import type { NodeHandler } from '../platform/web/route.js';
import {
  type AccountStatus,
  bearerOf,
  clientAddressOf,
  type Role,
  type SessionResolver,
  type UserSession,
} from './context.js';

/** The text fields a multipart upload may carry beside its file, and their size. */
const FIELD_LIMITS = { fields: 4, fieldBytes: 256 } as const;

export interface UploadRouteDependencies {
  /** The user session resolver, as the surfaces are handed it (T017). */
  readonly sessions: SessionResolver<UserSession>;
  /** T020's kinds guard: the settings reader and the limiter. */
  readonly guard: UploadGuard;
  readonly log: Logger;
  readonly trustedProxyHeader?: string;
}

/** Who uploaded, as the session resolved them. */
export interface Uploader {
  readonly userId: string;
  readonly role: Role;
  readonly accountStatus: AccountStatus;
}

/** What a route's handler receives once the guard admitted the file. */
export interface AcceptedUpload<TKind extends UploadKind> {
  readonly uploader: Uploader;
  readonly kind: TKind;
  readonly type: SniffedType;
  readonly bytes: Buffer;
  readonly filename: string | undefined;
}

export interface UploadRoute<TKind extends UploadKind> {
  /** The kind the request names; throws a validation failure for one the route does not take. */
  readonly kindOf: (fields: ReadonlyMap<string, string>) => TKind;
  /** The standings answered `ACCOUNT_RESTRICTED` (FR-137). */
  readonly refuses: readonly AccountStatus[];
  /** Stores the file and answers what the client gets, as JSON with status 201. */
  readonly handle: (upload: AcceptedUpload<TKind>) => Promise<object>;
}

/** A `kindOf` reading the `kind` field, admitting the kinds named and nothing else. */
export function kindField<TKind extends UploadKind>(
  admitted: readonly TKind[],
): (fields: ReadonlyMap<string, string>) => TKind {
  return (fields) => {
    const kind = fields.get('kind');
    if (kind === undefined || !(admitted as readonly string[]).includes(kind)) {
      throw new DomainError('VALIDATION_FAILED', 'The kind is not one this route takes.', {
        details: [{ path: 'kind', code: 'invalid' }],
      });
    }
    return kind as TKind;
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: object,
  headers: Readonly<Record<string, string>> = {},
): void {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

/** A refusal: the one shape, then the socket closed once the answer is flushed. */
function refuse(
  request: IncomingMessage,
  response: ServerResponse,
  mapped: MappedError,
  headers: Readonly<Record<string, string>> = {},
): void {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.setHeader('connection', 'close');
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.statusCode = mapped.status;
  response.end(JSON.stringify({ error: mapped.body }), () => request.socket.destroy());
}

function declaredLengthOf(request: IncomingMessage): number | undefined {
  const header = request.headers['content-length'];
  if (header === undefined) return undefined;
  const length = Number.parseInt(header, 10);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

export function uploadRoute<TKind extends UploadKind>(
  { sessions, guard, log, trustedProxyHeader }: UploadRouteDependencies,
  route: UploadRoute<TKind>,
): NodeHandler {
  return (request, response) => {
    const correlationId = randomUUID();
    const clientAddress = clientAddressOf(
      { remoteAddress: request.socket.remoteAddress, headers: request.headers },
      trustedProxyHeader,
    );
    const requestLog = requestLogger(log, correlationId).child({ clientAddress });
    void (async () => {
      try {
        if (request.method !== 'POST') {
          // The kernel's shape for a method the route does not take, under 405 (as the pages answer).
          refuse(
            request,
            response,
            { ...mapError(new DomainError('NOT_FOUND')), status: 405 },
            { allow: 'POST' },
          );
          return;
        }
        const bearer = bearerOf(request.headers);
        const session = bearer === null ? null : await sessions(bearer);
        if (session === null) throw new DomainError('UNAUTHENTICATED');
        if (route.refuses.includes(session.accountStatus)) {
          throw new DomainError('ACCOUNT_RESTRICTED', undefined, {
            details: [{ path: 'accountStatus', code: session.accountStatus }],
          });
        }
        const file = await firstFileOf(request, FIELD_LIMITS);
        const kind = route.kindOf(file.fields);
        const declaredLength = declaredLengthOf(request);
        const upload = await acceptUploadOfKind(guard, {
          kind,
          uploaderId: session.userId,
          body: file.stream,
          ...(declaredLength === undefined ? {} : { declaredLength }),
        });
        const chunks: Uint8Array[] = [];
        for await (const chunk of upload.body) chunks.push(chunk);
        const result = await route.handle({
          uploader: {
            userId: session.userId,
            role: session.role,
            accountStatus: session.accountStatus,
          },
          kind,
          type: upload.type,
          bytes: Buffer.concat(chunks),
          filename: file.filename,
        });
        sendJson(response, 201, result);
      } catch (error: unknown) {
        const mapped = mapError(error);
        if (mapped.unexpected) {
          requestLog.error({ err: error }, 'Unexpected error on an upload route');
          reportError(error, correlationId);
        }
        refuse(request, response, mapped);
      }
    })();
  };
}
