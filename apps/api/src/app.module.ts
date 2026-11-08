// T149: the HTTP application — Nest holds the structure, tRPC is the transport (FR-048, FR-041,
// R-API-11, R-SEC-8, R-SEC-2; ARCHITECTURE §7.1, contracts/kernel.md "Two surfaces").
//
// TWO MOUNTS. The user surface (T109 `appRouter`) is served under `/trpc` and the administrator
// surface (`adminRouter`) under `/admin/trpc`, each by its own tRPC handler with its own context
// factory (T106), so no request on one path can reach a procedure of the other. Neither path is a
// prefix of the other.
//
// SESSIONS (T017; specs/002-identity/contracts/kernel.md "Session resolution"). The application
// takes two resolvers at construction, `sessions.user` and `sessions.admin`, handed in by
// `main.ts` from the identity and admin modules' public entries, and calls the surface's one per
// request with the bearer token of the `Authorization` header before the context is built; a
// request without a bearer, or one the resolver answers null for, is anonymous. Standing is read on
// every request, nothing is cached (FR-108). Until the identity work lands its resolvers (T047,
// T066), `main.ts` passes stand-ins that answer null, so every request is anonymous in production
// and `tests/pipeline/built-entrypoints.spec.ts` boots the built `main.js` as before.
//
// THE CLIENT'S ADDRESS (T017) is read once per request by `clientAddressOf`: the socket's peer,
// or the last hop of the one proxy header `TRUSTED_PROXY` names, never the first hop the client
// writes itself. Both contexts carry it, and the public-page helper (T019) counts its limit by it.
//
// ONE ERROR SHAPE OUT. On a surface, tRPC sends T107's `toErrorShape`, and the HTTP status is set
// from the same mapping (tRPC would otherwise answer 500 for every error thrown in a procedure).
// Outside both surfaces (an unknown path, a framework failure), a Nest filter sends the same shape
// in the same envelope, `{ error: { code, message, details? } }`, rather than Nest's own. An error
// the mapping marks unexpected is logged on the request's logger, with its correlation identifier,
// and reported (T111); the client sees only the internal error. A request whose input cannot be
// read is the client's, never unexpected (T108): the caller kinds answer a body or GET `input` that
// is not JSON `VALIDATION_FAILED`, and each surface's handler refuses the same way, before tRPC and
// without reading the body, what tRPC would fail on before any procedure runs; each refusal is one
// info line with its correlation id and nothing of the body, never reported. Every other expected
// refusal of a procedure (T062's follow-up from B34) is one info line too, written by the handler's
// `onError` for both surfaces: `{ procedure, errorCode }` and the caller's `userId` or `adminId`,
// never an input, a name or a message; a `RATE_LIMITED` is left to the limiter, which logs a
// subject's first refusal in a window only (SRS NFR-SEC-12).
//
// NEST LOGS THROUGH THE KERNEL LOGGER (T100), never through the console, so its records carry the
// redaction list like every other. Nest's body parser is off: tRPC reads its own body, and the
// signed-webhook endpoint (T133) must receive the raw body untouched.
//
// HEALTH. `GET /health` and `GET /ready` (T110) are the one Nest controller, outside both surfaces
// and answering for themselves, so a failed readiness check never comes through the filter above.
//
// BODY LIMIT. Each surface reads at most `MAX_REQUEST_BODY_BYTES` of a request body (T150, FR-077);
// a larger one is refused with 413 `PAYLOAD_TOO_LARGE` before it is read whole.
//
// AUDITING. The administrator surface's context carries the transactions and the bound audit writer
// (T108), so every administrative call runs in one transaction with its audit record written there.
// They are a required option: the application cannot be built with an administrator surface and no
// writer.
//
// RATE LIMITING. The user surface's context carries the process's rate limiter (T170), from which
// the caller kinds apply each procedure's declared limit. It is a required option too: the
// application cannot be built with a user surface and no limiter.
//
// BROWSER HEADERS. The security headers and the CORS origin allowlist (T136) are registered before
// any route, so every response carries them, on either surface, on the health routes or elsewhere.
//
// UPLOAD ROUTES (T024). Each handler of `routes` is mounted under its own path, beside the
// surfaces and the pages: the two multipart upload routes, each written over the surfaces' upload
// helper, which applies the bearer, the standing and the kinds guard itself.
//
// PUBLIC PAGES (T019, ADR 0021 D5). The design's two stylesheets are always served under
// `/public/design/`, and each page of `webRoutes` is mounted under its own path through the
// kernel's helper (`platform/web/route.ts`): the strict policy, no cookie, the anonymous limit per
// client address, `?lang=en`. Neither is a surface, and a surface's path is never a page's.
//
// SHUTDOWN HOOKS. The application listens for SIGTERM and SIGINT itself (T173), so a provider's
// `onApplicationShutdown` runs on a signal and `close()` is never run twice: Nest runs one shutdown
// per cycle whether a signal or `main.ts`'s own stop sequence asks first, and the sequence exits
// the process once the database is closed too.
//
// `main.ts` builds this application after the configuration validated and is the only caller in
// production; a spec passes fixture routers in place of the real ones.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type DynamicModule,
  type ExceptionFilter,
  HttpException,
  type INestApplication,
  type LoggerService,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AnyTRPCRouter, inferRouterContext } from '@trpc/server';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { DomainError, type ErrorCode } from './platform/errors/domain-error.js';
import { mapError, type MappedError } from './platform/errors/error-filter.js';
import { reportError } from './platform/errors/reporting.js';
import type { RateLimiter } from './platform/guards/rate-limit.guard.js';
import {
  applySecurityHeaders,
  type SecurityHeadersOptions,
} from './platform/guards/security-headers.middleware.js';
import {
  HealthController,
  READINESS,
  type Readiness,
} from './platform/health/health.controller.js';
import { type Logger, requestLogger } from './platform/logging/logger.js';
import {
  DESIGN_ASSETS_PATH,
  designAssetsRoute,
  type NodeHandler,
  webRoute,
  type WebRoute,
} from './platform/web/route.js';
import { adminRouter } from './surfaces/admin.router.js';
import { appRouter } from './surfaces/app.router.js';
import {
  type AdminContext,
  type AdminSurfaceServices,
  type AppContext,
  type AppServices,
  type Administration,
  bearerOf,
  clientAddressOf,
  createAdminContext,
  createAppContext,
  type SessionResolver,
  type SessionResolvers,
} from './surfaces/context.js';
import { isRefusalLoggedByKind, toErrorShape } from './surfaces/procedures.js';

/**
 * The root module. Each module registers here as it gains a controller or a provider. Its
 * providers are values the process built at start (the readiness check, T110), so it is created
 * with them rather than declared once.
 */
@Module({})
export class AppModule {
  static with({ readiness }: { readonly readiness: Readiness }): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: READINESS, useValue: readiness }],
    };
  }
}

/** Where each surface is served. */
export const surfacePaths = { app: '/trpc', admin: '/admin/trpc' } as const;

/** A router of one surface: its context type is the surface's own (R-SEC-8). */
type SurfaceRouter<TContext> = AnyTRPCRouter & {
  _def: { _config: { $types: { ctx: TContext } } };
};

export interface Surfaces {
  readonly app: SurfaceRouter<AppContext>;
  readonly admin: SurfaceRouter<AdminContext>;
}

export interface ApplicationOptions {
  /** The process's logger (T100). */
  readonly log: Logger;
  /** What `GET /ready` asks of the database (T110). */
  readonly readiness: Readiness;
  /** The browser security headers and the origin allowlist, from the configuration (T136). */
  readonly securityHeaders: SecurityHeadersOptions;
  /** `MAX_REQUEST_BODY_BYTES`: the largest body either surface reads (T150). */
  readonly maxRequestBodyBytes: number;
  /** The transactions and the bound audit writer every administrative call runs with (T108). */
  readonly administration: Administration;
  /** The process's rate limiter, which every call of either surface carries (T170, T017). */
  readonly rateLimiter: RateLimiter;
  /** The two session resolvers, called once per request from the bearer token (T017). */
  readonly sessions: SessionResolvers;
  /** The services the user surface's procedures read, bound once by `main.ts` (T038). */
  readonly services: AppServices;
  /** The admin module's services the administrator surface's procedures read, bound by `main.ts` (T067). */
  readonly adminServices: AdminSurfaceServices;
  /** `TRUSTED_PROXY`: the one proxy header whose last hop is the client's address, when set (T017). */
  readonly trustedProxyHeader?: string;
  /** The routers to mount; the real surfaces (T109) unless a spec passes its own. */
  readonly surfaces?: Surfaces;
  /** The public pages, each under its own path (T019); the stylesheets are served regardless. */
  readonly webRoutes?: Readonly<Record<string, WebRoute>>;
  /** The upload routes, each a handler under its own path (T024). */
  readonly routes?: Readonly<Record<string, NodeHandler>>;
}

/** Nest's own records, written through the kernel logger. */
class KernelLoggerForNest implements LoggerService {
  constructor(private readonly kernel: Logger) {}

  log(message: unknown, context?: string): void {
    this.kernel.info({ context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.kernel.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.kernel.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.kernel.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.kernel.trace({ context }, String(message));
  }

  fatal(message: unknown, context?: string): void {
    this.kernel.fatal({ context }, String(message));
  }
}

/** Nest's statuses by the kernel code they answer with; any other is the internal error. */
const frameworkCodes: Readonly<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

function send(response: ServerResponse, mapped: MappedError): void {
  response.statusCode = mapped.status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ error: mapped.body }));
}

/** Everything thrown outside the two surfaces leaves in the kernel's one shape (FR-041). */
@Catch()
class OneErrorShape implements ExceptionFilter {
  constructor(private readonly log: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const code =
      exception instanceof HttpException ? frameworkCodes[exception.getStatus()] : undefined;
    const mapped = mapError(code === undefined ? exception : new DomainError(code));
    if (mapped.unexpected) {
      this.log.error({ err: exception }, 'Unexpected error outside the surfaces');
      reportError(exception);
    }
    send(host.switchToHttp().getResponse<ServerResponse>(), mapped);
  }
}

interface Correlated {
  readonly correlationId: string;
  readonly log: Logger;
}

/** A request a surface refuses before tRPC: the kernel code it answers, and why (T108). */
interface Refusal {
  readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND';
  readonly reason: string;
}

/**
 * The methods tRPC serves and can carry: its node adapter builds a fetch `Request`, which refuses
 * TRACE (T108). A preflight never reaches here: the browser headers (T136) answer OPTIONS.
 */
const SURFACE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST']);

/** One call's procedure path: names of letters, digits and `_`, joined by single dots. */
const PROCEDURE_PATH = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

/**
 * The URL tRPC's node adapter builds for `request` (its `createURL`: the scheme, the `Host` header
 * or `:authority`, `localhost` when neither), or null where building it throws.
 */
function urlAsTrpcBuildsIt(request: IncomingMessage): URL | null {
  const encrypted = 'encrypted' in request.socket && request.socket.encrypted === true;
  const protocol = request.headers[':scheme'] === 'https' || encrypted ? 'https:' : 'http:';
  const host = request.headers.host ?? request.headers[':authority'] ?? 'localhost';
  return URL.parse(request.url ?? '/', `${protocol}//${String(host)}`);
}

/**
 * Whether the path after the surface's mount names procedures as tRPC reads it: decoded, split at
 * commas for a batch, each call a well-formed name. An unknown well-formed name is tRPC's 404.
 */
function pathRefusal(url: URL): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return 'path_not_decodable';
  }
  const calls = url.searchParams.get('batch') === '1' ? path.split(',') : [path];
  return calls.every((call) => PROCEDURE_PATH.test(call)) ? undefined : 'path_malformed';
}

/**
 * Why tRPC would fail on `request` before any procedure runs, judged from its method, URL and
 * headers alone, or undefined when it would not (T108). The body is never read here. A method
 * tRPC does not serve answers as tRPC's own unsupported method does, 404; the rest are the client's
 * input that cannot be read, 400: a URL tRPC cannot build or cannot carry (credentials in it), a
 * request carrying `connectionParams`, which neither surface uses, a procedure path that does not
 * decode or is not well formed, and a request other than GET or HEAD whose content type is not
 * JSON, by tRPC's own predicate. A HEAD request whose URL builds is tRPC's 204 whatever it carries.
 */
function refusalOf(request: IncomingMessage): Refusal | undefined {
  if (!SURFACE_METHODS.has(request.method ?? '')) {
    return { code: 'NOT_FOUND', reason: 'method_not_supported' };
  }
  const invalid = (reason: string): Refusal => ({ code: 'VALIDATION_FAILED', reason });
  const url = urlAsTrpcBuildsIt(request);
  if (url === null) return invalid('url_not_parsable');
  if (url.username !== '' || url.password !== '') return invalid('url_carries_credentials');
  if (request.method === 'HEAD') return undefined;
  if (url.searchParams.has('connectionParams')) return invalid('connection_params');
  const path = pathRefusal(url);
  if (path !== undefined) return invalid(path);
  const json = request.headers['content-type']?.startsWith('application/json') === true;
  if (request.method !== 'GET' && !json) return invalid('content_type_not_json');
  return undefined;
}

/** Who made a refused call, as its log line names them: a user's id, an administrator's, or no one. */
type ActorOf<TContext> = (
  context: TContext,
) => { readonly userId: string } | { readonly adminId: string } | Record<string, never>;

const appActor: ActorOf<AppContext> = (context) =>
  context.caller === null ? {} : { userId: context.caller.userId };

const adminActor: ActorOf<AdminContext> = (context) =>
  context.administrator === null ? {} : { adminId: context.administrator.adminId };

/** One surface's tRPC handler, mounted by Nest under the surface's path. */
function surfaceHandler<TContext extends Correlated>(
  router: SurfaceRouter<TContext>,
  createContext: (request: IncomingMessage) => Promise<TContext>,
  log: Logger,
  maxBodySize: number,
  actorOf: ActorOf<TContext>,
): (request: IncomingMessage, response: ServerResponse) => void {
  // tRPC tells a subscription's refused open twice, once by its call and once by its stream (its
  // `resolveResponse`), with the one error: each is written once.
  const told = new WeakSet<object>();
  const handler = createHTTPHandler({
    router,
    // A body past the limit is refused as it streams in, never read whole (T150, FR-077):
    // tRPC's PAYLOAD_TOO_LARGE, answered 413 in the one shape and not reported as unexpected.
    maxBodySize,
    // Neither client batches (both use `httpLink`), so a batch is refused whole before any call's
    // input is read: tRPC's `BAD_REQUEST`, answered 400 `VALIDATION_FAILED` (T108).
    allowBatching: false,
    createContext: async ({ req }) =>
      (await createContext(req)) as inferRouterContext<SurfaceRouter<TContext>>,
    onError: ({ error, ctx, path }) => {
      if (told.has(error)) return;
      told.add(error);
      const mapped = toErrorShape(error);
      const context = ctx as TContext | undefined;
      const requestLog = context?.log ?? log;
      if (!mapped.unexpected) {
        // Every expected refusal, one info line in this one place (T062's follow-up from B34): the
        // procedure, the code and who called, never an input, a name or a message. A rate limit's
        // refusal is the limiter's to log, once per subject and window (SRS NFR-SEC-12).
        // An unreadable input is logged by the kinds' input guard, with its reason (T108).
        if (mapped.body.code === 'RATE_LIMITED' || isRefusalLoggedByKind(error)) return;
        requestLog.info(
          {
            procedure: path ?? 'unknown',
            errorCode: mapped.body.code,
            ...(context === undefined ? {} : actorOf(context)),
          },
          'A procedure call was refused',
        );
        return;
      }
      const cause = error.cause ?? error;
      requestLog.error({ err: cause }, 'Unexpected error in a procedure');
      reportError(cause, context?.correlationId);
    },
    // tRPC answers 500 for every error a procedure throws; the status follows the kernel's mapping
    // instead. With batching off, a response carries at most one error, a refused batch included.
    // tRPC also sets its own `Vary`, replacing the `Vary: Origin` of the CORS middleware (T136), so
    // `Origin` is appended back: a cache must not serve one origin's answer to another.
    responseMeta: ({ errors }) => {
      const headers = { vary: ['Origin'] };
      const [first] = errors;
      if (first === undefined) return { headers };
      return { status: toErrorShape(first).status, headers };
    },
  });
  // What tRPC would fail on before any procedure is refused here, before it, with the input
  // guard's log line (T108): the client's request, never reported. Some of these, reaching tRPC,
  // would fail in its node adapter's own exception handler instead of answering in our shape.
  return (request, response) => {
    // That handler ends a response tRPC already ended when a write failed (T108): the second
    // `res.end` emits `ERR_STREAM_WRITE_AFTER_END` as `'error'`, which unheard ends the process.
    // Only listened to, never written; nothing of the request is logged.
    response.on('error', (error: NodeJS.ErrnoException) => {
      log.warn(
        { errorCode: error.code, errorMessage: error.message },
        'A surface response failed to write',
      );
    });
    const refusal = refusalOf(request);
    if (refusal === undefined) {
      handler(request, response);
      return;
    }
    requestLogger(log, randomUUID()).info(
      { errorCode: refusal.code, reason: refusal.reason },
      'A request tRPC could not read was refused',
    );
    send(response, mapError(new DomainError(refusal.code)));
  };
}

/** The HTTP application with both surfaces mounted, not yet listening. */
export async function createApplication({
  log,
  readiness,
  securityHeaders,
  maxRequestBodyBytes,
  administration,
  rateLimiter,
  sessions,
  services,
  adminServices,
  trustedProxyHeader,
  surfaces = { app: appRouter, admin: adminRouter },
  webRoutes = {},
  routes = {},
}: ApplicationOptions): Promise<INestApplication> {
  const clientAddress = (request: IncomingMessage): string =>
    clientAddressOf(
      { remoteAddress: request.socket.remoteAddress, headers: request.headers },
      trustedProxyHeader,
    );
  // The surface's resolver, once per request, from the bearer token; no bearer, no call.
  const resolve = async <TSession>(
    resolver: SessionResolver<TSession>,
    request: IncomingMessage,
  ): Promise<TSession | null> => {
    const bearer = bearerOf(request.headers);
    return bearer === null ? null : resolver(bearer);
  };
  const application = await NestFactory.create(AppModule.with({ readiness }), {
    bodyParser: false,
    logger: new KernelLoggerForNest(log),
    abortOnError: false,
  });
  // The two signals a process is stopped with, the same two `onShutdown` listens for (T173).
  application.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  // Ahead of every route, so each response carries the headers and the allowlist (T136).
  applySecurityHeaders(application, securityHeaders);
  application.useGlobalFilters(new OneErrorShape(log));
  application.use(
    surfacePaths.app,
    surfaceHandler(
      surfaces.app,
      async (request) =>
        createAppContext({
          session: await resolve(sessions.user, request),
          log,
          rateLimiter,
          clientAddress: clientAddress(request),
          services,
        }),
      log,
      maxRequestBodyBytes,
      appActor,
    ),
  );
  application.use(
    surfacePaths.admin,
    surfaceHandler(
      surfaces.admin,
      async (request) =>
        createAdminContext({
          session: await resolve(sessions.admin, request),
          log,
          administration,
          services: adminServices,
          rateLimiter,
          clientAddress: clientAddress(request),
        }),
      log,
      maxRequestBodyBytes,
      adminActor,
    ),
  );
  // The public pages and the design's stylesheets, beside the surfaces (T019, ADR 0021 D5).
  application.use(DESIGN_ASSETS_PATH, designAssetsRoute());
  const pages = {
    rateLimiter,
    log,
    ...(trustedProxyHeader === undefined ? {} : { trustedProxyHeader }),
  };
  // Express matches a mount by prefix, so the longest path is mounted first: `/delete-account/
  // confirm` reaches its own handler ahead of `/delete-account`, whatever order the pages are
  // declared in (PR #79 review, finding 2).
  const longestFirst = Object.entries(webRoutes).sort(([a], [b]) => b.length - a.length);
  for (const [path, route] of longestFirst) {
    application.use(path, webRoute(pages, route));
  }
  // The upload routes (T024), longest path first for the same reason.
  const handlersLongestFirst = Object.entries(routes).sort(([a], [b]) => b.length - a.length);
  for (const [path, handler] of handlersLongestFirst) {
    application.use(path, handler);
  }
  return application;
}
