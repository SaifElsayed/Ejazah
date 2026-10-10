// T149: the HTTP application — Nest holds the structure, tRPC is the transport (FR-048, FR-041,
// R-API-11, R-SEC-8, R-SEC-2; ARCHITECTURE §7.1, contracts/kernel.md "Two surfaces").
//
// TWO MOUNTS. The user surface (T109 `appRouter`) is served under `/trpc` and the administrator
// surface (`adminRouter`) under `/admin/trpc`, each by its own tRPC handler with its own context
// factory (T106), so no request on one path can reach a procedure of the other. Neither path is a
// prefix of the other. Sessions are not resolved yet: both factories receive none, so every request
// is anonymous until the identity work resolves the user and the administrator sessions.
//
// ONE ERROR SHAPE OUT. On a surface, tRPC sends T107's `toErrorShape`, and the HTTP status is set
// from the same mapping (tRPC would otherwise answer 500 for every error thrown in a procedure).
// Outside both surfaces (an unknown path, a framework failure), a Nest filter sends the same shape
// in the same envelope, `{ error: { code, message, details? } }`, rather than Nest's own. An error
// the mapping marks unexpected is logged on the request's logger, with its correlation identifier,
// and reported (T111); the client sees only the internal error.
//
// NEST LOGS THROUGH THE KERNEL LOGGER (T100), never through the console, so its records carry the
// redaction list like every other. Nest's body parser is off: tRPC reads its own body, and the
// signed-webhook endpoint (T133) must receive the raw body untouched.
//
// HEALTH. `GET /health` and `GET /ready` (T110) are the one Nest controller, outside both surfaces
// and answering for themselves, so a failed readiness check never comes through the filter above.
//
// BROWSER HEADERS. The security headers and the CORS origin allowlist (T136) are registered before
// any route, so every response carries them, on either surface, on the health routes or elsewhere.
//
// `main.ts` builds this application after the configuration validated and is the only caller in
// production; a spec passes fixture routers in place of the real ones.
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
import {
  applySecurityHeaders,
  type SecurityHeadersOptions,
} from './platform/guards/security-headers.middleware.js';
import {
  HealthController,
  READINESS,
  type Readiness,
} from './platform/health/health.controller.js';
import type { Logger } from './platform/logging/logger.js';
import { adminRouter } from './surfaces/admin.router.js';
import { appRouter } from './surfaces/app.router.js';
import {
  type AdminContext,
  type AppContext,
  createAdminContext,
  createAppContext,
} from './surfaces/context.js';
import { toErrorShape } from './surfaces/procedures.js';

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
  /** The routers to mount; the real surfaces (T109) unless a spec passes its own. */
  readonly surfaces?: Surfaces;
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

/** One surface's tRPC handler, mounted by Nest under the surface's path. */
function surfaceHandler<TContext extends Correlated>(
  router: SurfaceRouter<TContext>,
  createContext: () => TContext,
  log: Logger,
): (request: IncomingMessage, response: ServerResponse) => void {
  return createHTTPHandler({
    router,
    createContext: () => createContext() as inferRouterContext<SurfaceRouter<TContext>>,
    onError: ({ error, ctx }) => {
      if (!toErrorShape(error).unexpected) return;
      const cause = error.cause ?? error;
      const context = ctx as TContext | undefined;
      (context?.log ?? log).error({ err: cause }, 'Unexpected error in a procedure');
      reportError(cause, context?.correlationId);
    },
    // tRPC answers 500 for every error a procedure throws; the status follows the kernel's mapping
    // instead. A batch keeps tRPC's own status, since its calls may have failed differently.
    // tRPC also sets its own `Vary`, replacing the `Vary: Origin` of the CORS middleware (T136), so
    // `Origin` is appended back: a cache must not serve one origin's answer to another.
    responseMeta: ({ errors, info }) => {
      const headers = { vary: ['Origin'] };
      const [first] = errors;
      if (first === undefined || info?.isBatchCall === true) return { headers };
      return { status: toErrorShape(first).status, headers };
    },
  });
}

/** The HTTP application with both surfaces mounted, not yet listening. */
export async function createApplication({
  log,
  readiness,
  securityHeaders,
  surfaces = { app: appRouter, admin: adminRouter },
}: ApplicationOptions): Promise<INestApplication> {
  const application = await NestFactory.create(AppModule.with({ readiness }), {
    bodyParser: false,
    logger: new KernelLoggerForNest(log),
    abortOnError: false,
  });
  // Ahead of every route, so each response carries the headers and the allowlist (T136).
  applySecurityHeaders(application, securityHeaders);
  application.useGlobalFilters(new OneErrorShape(log));
  application.use(
    surfacePaths.app,
    surfaceHandler(surfaces.app, () => createAppContext({ session: null, log }), log),
  );
  application.use(
    surfacePaths.admin,
    surfaceHandler(surfaces.admin, () => createAdminContext({ session: null, log }), log),
  );
  return application;
}
