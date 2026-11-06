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
//
// T002 (Phase 3, specs/004-sessions/contracts/README.md "Errors"; FR-422, FR-452, FR-454, FR-499):
// the codes the sessions phase adds, by the same reading: a refusal by the state of a session, a
// request, a remedy, a dispute, a case or an enrollment is 409; a refund asked where only a make-up
// is owed is a refusal of the caller's entitlement, 403; a chat file of a type the chat does not
// take is 400, as the upload guard's `VALIDATION_FAILED` for a type it does not accept.

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
  // B29 (T036, the owner's decisions of 2026-11-03): Pay on a package that is no longer what the
  // student saw (deactivated, or its price, session count, length or track changed), refused before
  // any order with nothing written. The package as it now is travels in details, one issue per
  // field: `summary.price_piasters`, `summary.sessionCount`, `summary.sessionDurationMinutes` and
  // `summary.track`, each `code` the current value as text, or `package` with `inactive`.
  SUMMARY_CHANGED: { status: 409, message: 'This package has changed since you saw it.' },
  // Phase 3 (T002). The join opens later: `opensAt` in details.
  JOIN_NOT_OPEN: { status: 409, message: 'This session cannot be joined yet.' },
  JOIN_CLOSED: { status: 409, message: 'This session can no longer be joined.' },
  SESSION_NOT_SCHEDULED: { status: 409, message: 'This session is no longer scheduled.' },
  // The other party's request is open: `requestId` in details.
  CANCELLATION_PENDING: { status: 409, message: 'A cancellation request is already open.' },
  CANCELLATION_EXPIRED: { status: 409, message: 'This cancellation request has expired.' },
  DISPUTE_WINDOW_CLOSED: { status: 409, message: 'The time to dispute this session has ended.' },
  DISPUTE_OPEN: { status: 409, message: 'A dispute of this session is open.' },
  SESSION_UNDER_REVIEW: { status: 409, message: 'This session is under review.' },
  // Any cancelled session, by agreement or by an administrator.
  NOT_DISPUTABLE: { status: 409, message: 'This session cannot be disputed.' },
  // On the user surface and on the administrator surface (`cases.openManual`).
  REMEDY_NOT_OPEN: { status: 409, message: 'This make-up is no longer open.' },
  COUNTER_PENDING: { status: 409, message: 'A proposed time is waiting for an answer.' },
  // A refund where only a make-up is owed.
  CHOICE_NOT_ALLOWED: { status: 403, message: 'This choice is not available.' },
  // A counter-proposal outside the options.
  SLOT_NOT_OFFERED: { status: 409, message: 'This time is not among the options.' },
  // The database refused the booking, by an overlap or a deadlock on the retry too; the remedy
  // stays open.
  MAKEUP_REFUSED: { status: 409, message: 'This make-up could not be booked.' },
  // An image, or a type the chat does not take.
  ATTACHMENT_REFUSED: { status: 400, message: 'This file cannot be sent in the chat.' },
  CHAT_CLOSED: { status: 409, message: 'This chat is closed.' },
  // A suspended student's case closed as cleared before the account is reinstated.
  STUDENT_SUSPENDED: { status: 409, message: 'The student is still suspended.' },
  // A ruling's revision after the dispute window closed or once a remedy exists: `cause` in details.
  RULING_FINAL: { status: 409, message: 'This ruling can no longer be revised.' },
  // A ruling a later dispute's resolution replaced.
  RULING_SUPERSEDED: { status: 409, message: 'A later ruling replaced this one.' },
  // A complaint of the teacher's absence is already open on the enrollment.
  COMPLAINT_OPEN: { status: 409, message: 'A complaint is already open.' },
  // `cause` in details: not_restorable, window_closed, case_closed, party_restricted,
  // slot_inactive, slot_changed, slot_taken, time_taken.
  RESTORE_REFUSED: { status: 409, message: 'This enrollment cannot be restored.' },
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
