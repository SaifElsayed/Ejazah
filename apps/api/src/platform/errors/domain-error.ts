// T101: the one error shape, `{ code, message, details? }`, and the errors a feature may throw
// (FR-041, R-API-8, R-SEC-9; contracts/kernel.md "Error shape").
//
// A feature never builds a response for a failure: it throws a `DomainError` naming one of the
// stable codes below, and the error filter turns it, and everything else, into the one shape. The
// codes are the machine strings a client switches on, so they are never a database or vendor code;
// the message is safe to display and the client localises by code.
//
// T018 (Phase 1, specs/002-identity/contracts/README.md "Errors"): the codes the identity phase
// adds, each a stable string with one message, so what the client is told never depends on which
// of several causes applied (a wrong email or a wrong password, a wrong, expired or spent code, a
// short, long or breached password, wrong credentials or a locked account). Where the contract
// says "with … in details", the detail travels as a `FieldIssue` — `path` names what the detail
// is about and `code` carries it — so the shape stays the one shape (R-API-9).
//
// T003 (Phase 2, specs/003-booking/contracts/README.md "Errors"): the codes the booking phase adds.
// The contract states no HTTP status; each takes the status of the Phase 1 code it resembles: a
// refusal by the caller's own standing or entitlement is 403 (as `ACCOUNT_RESTRICTED`,
// `DOCUMENT_NOT_OWNED`), a refusal by the current state of a teacher, slot, hold, order or package
// is 409 (as `APPROVAL_BLOCKED`).

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
  // Phase 1 (T018). The restricted standing travels as `details: [{ path: 'accountStatus', code }]`.
  ACCOUNT_RESTRICTED: { status: 403, message: 'This account is restricted.' },
  // The method travels as `details: [{ path: 'email', code: 'google' | 'apple' | 'email' }]`.
  EMAIL_IN_USE_BY_OTHER_METHOD: {
    status: 409,
    message: 'This email is already used with another sign-in method.',
  },
  SIGN_IN_FAILED: { status: 401, message: 'The email or password is not correct.' },
  CODE_INVALID: { status: 400, message: 'The code is not valid.' },
  ONBOARDING_TOKEN_INVALID: { status: 401, message: 'Start the sign-in again.' },
  PASSWORD_WEAK: { status: 400, message: 'Choose a stronger password.' },
  ADMIN_SIGN_IN_FAILED: { status: 401, message: 'Sign-in failed.' },
  MFA_REQUIRED: { status: 403, message: 'Verify the second factor to continue.' },
  MFA_SETUP_REQUIRED: { status: 403, message: 'Set up two-step verification to continue.' },
  // T066: the administrator's password-set link altered, expired, used, or for a disabled account.
  INVITE_INVALID: { status: 400, message: 'This link is not valid. Ask for a new invitation.' },
  // The blocking reasons travel as `details: [{ path: 'application', code: reason }, …]`.
  APPROVAL_BLOCKED: { status: 409, message: 'The application cannot be approved yet.' },
  APPLICATION_INCOMPLETE: { status: 409, message: 'The application is not complete.' },
  DOCUMENT_NOT_OWNED: { status: 403, message: 'This document is not yours.' },
  // Phase 2 (T003). A visible teacher whose account is not active (T143).
  NOT_BOOKABLE: { status: 409, message: 'This teacher cannot be booked now.' },
  // The student's own account is `verification_required` (FR-VERIFY-10).
  ACCOUNT_NOT_ACTIVE: { status: 403, message: 'This account cannot book now.' },
  // The hold was refused: the slot is held, occupied or overlapping.
  SLOT_TAKEN: { status: 409, message: 'This slot was just taken.' },
  // FR-BOOK-12; `enrollmentId`, `state` (`processing` | `payable`) and `expiresAt` in details.
  PREVIOUS_CHECKOUT: { status: 409, message: 'A previous checkout is not finished.' },
  HOLD_EXPIRED: { status: 409, message: 'The time to pay has ended.' },
  // Retry or continue past the last moment an order may be created on the hold.
  ORDER_NOT_PAYABLE: { status: 409, message: 'This order can no longer be paid.' },
  SUBJECT_NOT_APPROVED: { status: 403, message: 'This subject is not approved for you.' },
  // The other slot's id in details.
  SLOT_OVERLAP: { status: 409, message: 'This slot overlaps another of your slots.' },
  SLOT_IN_USE: { status: 409, message: 'This slot is in use and cannot change.' },
  // Track or length after the package's first enrollment.
  PACKAGE_FROZEN: { status: 409, message: 'The track and length cannot change now.' },
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
