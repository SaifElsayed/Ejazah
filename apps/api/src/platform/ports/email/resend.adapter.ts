// 002:T177 (SRS DEC-108; the note under T177, (2) to (4); Q-1 (a), Q-2 (a)): Resend behind the email
// port, selected by `EMAIL_PROVIDER=resend`. Built against Resend's documented API (read once on the
// owner's word, 2026-11-26) with `fetch` and no SDK, as the Expo adapter is; tried on a fake `fetch`
// only until the owner makes the key on the server.
//
// DELIVER. One mail per call, `POST https://api.resend.com/emails` with the key as a bearer, JSON,
// and a fixed `User-Agent` (Resend answers 403 to a request without one): `from` is EMAIL_FROM_NAME
// and EMAIL_FROM joined as `<name> <address>`, `to` the mail's one address, `subject`, `text`, `html`
// only when the mail has one, and `reply_to` SUPPORT_EMAIL, so a reply reaches the support mailbox.
// `assertMail` refuses a mail not to one address, or with no subject or text, before any request.
//
// FAILURE. The request runs under `EMAIL_REQUEST_TIMEOUT_MS` and is aborted when it passes. Any
// answer but a success fails the delivery with its status alone; one cut by the timeout fails with
// `timeout`, one that never reached Resend with `unreachable`. Resend's answer quotes what it was
// sent, so it is cancelled unread, and nothing of the mail, the address or the key enters an error.
// The adapter logs nothing; its callers keep their own handling (the invite job retries through the
// queue, a code mail logs one warn line). The port has no idempotency key, so none is sent.
import { assertMail, type EmailPort, type Mail } from './email.port.js';

const SEND_URL = 'https://api.resend.com/emails';

/** What the API names itself to Resend: a product, no version, no person. */
const USER_AGENT = 'ijazah-api';

/**
 * How long a request to Resend waits before it is aborted. A transport number of the kernel, not a
 * setting (R-MONEY-12's exception, as `PUSH_REQUEST_TIMEOUT_MS`): an administrator lengthening it
 * would let one slow provider hold a code mail or the worker's delivery slot.
 */
export const EMAIL_REQUEST_TIMEOUT_MS = 10_000;

/** Why a request to Resend did not deliver: its HTTP status, or what kept it from one. */
export type EmailRequestStatus = number | 'timeout' | 'unreachable';

/** Resend did not take the mail. Carries the status alone (R-SEC-2). */
export class EmailRequestError extends Error {
  readonly status: EmailRequestStatus;

  constructor(status: EmailRequestStatus) {
    super(`Resend did not take the mail (${String(status)}).`);
    this.name = 'EmailRequestError';
    this.status = status;
  }
}

export interface ResendEmailOptions {
  /** `EMAIL_PROVIDER_KEY`, sent as a bearer. */
  readonly apiKey: string;
  /** `EMAIL_FROM`: the sending address, on the verified domain. */
  readonly from: string;
  /** `EMAIL_FROM_NAME`: the name the inbox shows beside it. */
  readonly fromName: string;
  /** `SUPPORT_EMAIL`: where a reply goes. */
  readonly replyTo: string;
  readonly fetch?: typeof fetch;
}

export class ResendEmailAdapter implements EmailPort {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #replyTo: string;
  readonly #fetch: typeof fetch;

  constructor(options: ResendEmailOptions) {
    this.#apiKey = options.apiKey;
    this.#from = `${options.fromName} <${options.from}>`;
    this.#replyTo = options.replyTo;
    // Called as a plain function, never as a method of this adapter.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async deliver(mail: Mail): Promise<void> {
    assertMail(mail);
    let response: Response;
    try {
      response = await this.#fetch(SEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          from: this.#from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          ...(mail.html === undefined ? {} : { html: mail.html }),
          reply_to: this.#replyTo,
        }),
        signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new EmailRequestError(timedOut ? 'timeout' : 'unreachable');
    }
    // Neither answer is read: a success's id is not kept, and a refusal may quote the mail.
    await response.body?.cancel();
    if (!response.ok) {
      throw new EmailRequestError(response.status);
    }
  }
}
