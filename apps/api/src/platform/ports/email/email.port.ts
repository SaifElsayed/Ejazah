// T023: the email port (specs/002-identity/contracts/ports.md "EmailPort", research R-110,
// R-API-5). One operation: deliver a rendered mail to one address. The port takes the subject and
// the bodies, never a template id, so no vendor concept enters it; the identity module renders the
// words (R-110). The body may carry a one-time code, so no implementation logs it, and the logger
// redacts `text`, `html` and `subject` under a mail object (T100, R-SEC-2).

export interface Mail {
  /** One address. */
  readonly to: string;
  readonly subject: string;
  /** The plain-text body; the one every client can read. */
  readonly text: string;
  /** The HTML body, when the mail has one. */
  readonly html?: string;
}

export interface EmailPort {
  /** Deliver `mail` to its one address. */
  deliver(mail: Mail): Promise<void>;
}

// One address, nothing else: no list, no display name, no whitespace. The local part and the
// domain are checked for shape only; whether the mailbox exists is the delivery's answer.
const ONE_ADDRESS = /^[^\s@,;<>()[\]"]+@[^\s@,;<>()[\]"]+\.[^\s@,;<>()[\]"]+$/;

/** Whether `value` is one email address in the form the port takes. */
export function isEmailAddress(value: string): boolean {
  return ONE_ADDRESS.test(value);
}

/** Refuse a mail that is not to one address, or has no subject or no text. Echoes nothing. */
export function assertMail({ to, subject, text }: Mail): void {
  if (!isEmailAddress(to)) {
    throw new RangeError('A mail goes to one email address.');
  }
  if (subject.length === 0) {
    throw new RangeError('A mail has a subject.');
  }
  if (text.length === 0) {
    throw new RangeError('A mail has a text body.');
  }
}
