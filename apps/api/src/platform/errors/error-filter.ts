// T101: the global error filter (FR-041, R-API-8, R-SEC-9, R-GENDER-2; contracts/kernel.md).
//
// Everything thrown below a surface — domain errors, validation failures, database errors,
// provider errors, unhandled exceptions — goes through `mapError`, and only its result is sent.
// R-API-8 and R-SEC-9 hold because there is no second path to a response, not because each handler
// sanitises. The body is built field by field from the code table, never by spreading the error,
// so a stack, a cause, a query or a vendor code cannot ride along.
//
// DECISION (T101) — a plain function rather than a framework filter class. The request surfaces
// arrive with the caller kinds and the routers (T107, T109); each installs this one function as its
// single error formatter. The filter itself depends on no framework, so the shape is fixed and
// tested before any surface exists.
import { ZodError } from 'zod';
import {
  DomainError,
  type ErrorCode,
  type ErrorShape,
  errorCodes,
  ForbiddenProfileError,
} from './domain-error.js';

export interface MappedError {
  readonly status: number;
  readonly body: ErrorShape;
  /**
   * True when the error was not one a feature meant to report. The surface logs it with its
   * correlation identifier and reports it (T111); the client sees only the internal error.
   */
  readonly unexpected: boolean;
}

function shaped(code: ErrorCode, message?: string, details?: ErrorShape['details']): MappedError {
  const body: ErrorShape =
    details === undefined
      ? { code, message: message ?? errorCodes[code].message }
      : { code, message: message ?? errorCodes[code].message, details };
  return { status: errorCodes[code].status, body, unexpected: code === 'INTERNAL' };
}

/** The one response for whatever was thrown. */
export function mapError(error: unknown): MappedError {
  // A forbidden profile is an absent profile from outside (R-GENDER-2): same status, same body.
  if (error instanceof ForbiddenProfileError) return shaped('NOT_FOUND');

  if (error instanceof DomainError) {
    // A feature-thrown INTERNAL is still a generic internal error to the client.
    if (error.code === 'INTERNAL') return shaped('INTERNAL');
    return shaped(error.code, error.message, error.details);
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
    }));
    return shaped('VALIDATION_FAILED', undefined, details);
  }

  return shaped('INTERNAL');
}
