// T101: the one error shape, `{ code, message, details? }`, and the errors a feature may throw
// (FR-041, R-API-8, R-SEC-9; contracts/kernel.md "Error shape").
//
// A feature never builds a response for a failure: it throws a `DomainError` naming one of the
// stable codes below, and the error filter turns it, and everything else, into the one shape. The
// codes are the machine strings a client switches on, so they are never a database or vendor code;
// the message is safe to display and the client localises by code.

/** One field-level validation problem: where, and what kind. Never the value that was sent. */
export interface FieldIssue {
  readonly path: string;
  readonly code: string;
}

/** The only shape that leaves the system. */
export interface ErrorShape {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: readonly FieldIssue[];
}

/** Each stable code, its HTTP status and the message a client sees when the thrower gives none. */
export const errorCodes = {
  VALIDATION_FAILED: { status: 400, message: 'The request is not valid.' },
  UNAUTHENTICATED: { status: 401, message: 'Sign in to continue.' },
  FORBIDDEN: { status: 403, message: 'This action is not allowed.' },
  NOT_FOUND: { status: 404, message: 'Not found.' },
  CONFLICT: { status: 409, message: 'The request conflicts with the current state.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request is too large.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Try again later.' },
  INTERNAL: { status: 500, message: 'Something went wrong. Try again later.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof errorCodes;

/** A failure a feature means to report. Its message must be safe to show; it is shown as written. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly FieldIssue[] | undefined;

  constructor(
    code: ErrorCode,
    message: string = errorCodes[code].message,
    options: { readonly details?: readonly FieldIssue[]; readonly cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DomainError';
    this.code = code;
    this.details = options.details;
  }
}

/**
 * A profile the requester may not see (R-GENDER-2). Thrown instead of a 403 by whatever finds the
 * profile hidden; the filter answers it exactly as an absent profile, so "forbidden" and "absent"
 * cannot be told apart from outside, and no caller can answer 403 by hand.
 */
export class ForbiddenProfileError extends Error {
  constructor() {
    super('A profile hidden from the requester.');
    this.name = 'ForbiddenProfileError';
  }
}
