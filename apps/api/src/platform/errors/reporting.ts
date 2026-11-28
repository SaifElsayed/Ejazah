// T111: error reporting to Sentry, the destination PLAN.md and ARCHITECTURE §"Error tracking" name
// (FR-051, research R-17).
//
// `initReporting` is called once per process by the entrypoints (main.ts, worker.ts) with the
// validated configuration; `reportError` is what a surface calls for an error the filter marks
// `unexpected` (T101), and what the worker calls for a failed job. With no `SENTRY_DSN` reporting is
// off and both calls do nothing, so the test suite and a fresh checkout need no credential (FR-054).
//
// An event leaves the system just as a log line does, so R-SEC-2 applies to it: user data, cookies,
// headers, bodies, query strings, database query data, queue arguments and local variables are not
// collected, the request body and cookies are dropped again if present, and every other part of
// the event and every breadcrumb goes through the logger's redaction list, one list for both (T100).
// `userInfo: false` stops only inference: a later `Sentry.setUser` must pass `{ id }` and nothing
// else (review of PR #35, n7).
//
// Not here: uploading source maps on build (ARCHITECTURE) needs a build step and an auth token, so
// it belongs to the build and deploy work (T081, T092). Tracing is deliberately not enabled
// (research R-17).
import * as Sentry from '@sentry/node';
import { redact } from '../logging/logger.js';

export interface ReportingOptions {
  /** `SENTRY_DSN`; reporting is off when absent. */
  readonly dsn: string | undefined;
  readonly environment: 'development' | 'test' | 'production';
  /** R3 T183: `SENTRY_ENVIRONMENT`, the events' environment in place of `environment` when set. */
  readonly sentryEnvironment?: 'development' | 'closed-test' | 'production' | undefined;
  /** R3 T183: `SENTRY_RELEASE`, the deploy's git SHA; the events name no release without it. */
  readonly release?: string | undefined;
}

let enabled = false;

/** An event with the request body and cookies dropped and every redacted key removed. */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  const scrubbed = redact(event) as T;
  if (scrubbed.request !== undefined) {
    delete scrubbed.request.data;
    delete scrubbed.request.cookies;
  }
  return scrubbed;
}

/** Turns reporting on when a DSN is configured. Returns whether it is on. */
export function initReporting(options: ReportingOptions): boolean {
  if (options.dsn === undefined) return false;
  Sentry.init({
    dsn: options.dsn,
    environment: options.sentryEnvironment ?? options.environment,
    ...(options.release === undefined ? {} : { release: options.release }),
    // Sentry 11 collects bodies, query data, queue arguments, GraphQL and AI payloads and local
    // variables by default; each is a place an R-SEC-2 value lives, so each is off, and what remains
    // is scrubbed below. Kept on purpose: the source lines around each stack frame
    // (`frameContextLines`), which are this repository's own code, never request data.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => redact(breadcrumb) as Sentry.Breadcrumb,
  });
  enabled = true;
  return true;
}

/** Reports an unexpected error, tagged with the request's correlation identifier when there is one. */
export function reportError(error: unknown, correlationId?: string): void {
  if (!enabled) return;
  Sentry.captureException(
    error,
    correlationId === undefined ? undefined : { tags: { correlationId } },
  );
}
