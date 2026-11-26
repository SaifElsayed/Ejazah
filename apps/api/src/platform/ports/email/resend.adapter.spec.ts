// 002:T177 (SRS DEC-108; the note under T177, (2) to (4)): Resend behind the email port, against a
// fake `fetch` only: no request leaves this machine. The request's documented shape (one POST to the
// send endpoint, the bearer key, JSON, the fixed User-Agent Resend answers 403 without, the body's
// `from`, `to`, `subject`, `text`, `html` when given and `reply_to`), a request cut at
// `EMAIL_REQUEST_TIMEOUT_MS`, and a refusal carrying the status alone: never the answer, the
// address, the subject or the key. The adapter logs nothing (R-SEC-2).
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Mail } from './email.port.js';
import {
  EMAIL_REQUEST_TIMEOUT_MS,
  EmailRequestError,
  ResendEmailAdapter,
} from './resend.adapter.js';

// Placeholders of the shapes Resend and the RUNBOOK give, never a real key (R-SEC-1).
const API_KEY = 're_spec_placeholder';
const options = {
  apiKey: API_KEY,
  from: 'no-reply@send.ijazahapp.com',
  fromName: 'إجازة',
  replyTo: 'support@ijazahapp.com',
};
const mail: Mail = {
  to: 'amr.k@example.invalid',
  subject: 'رمز الدخول',
  text: 'رمز الدخول هو 482913',
};

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

/** An answer whose body records whether it was cancelled. */
function answer(status: number, body: unknown): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(stream, { status }), cancelled: () => cancelled };
}

/** A fake `fetch` answering with `response`, recording what it was sent. */
function fakeFetch(response: Response = new Response(JSON.stringify({ id: 'mail-1' }))) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return response;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

function bodyOf(sent: Sent | undefined): unknown {
  return JSON.parse(String(sent?.init.body));
}

/** Everything an error shows: its message, its own fields, and its text. */
function shownBy(error: unknown): string {
  return `${String(error)} ${JSON.stringify(error)} ${(error as Error).message}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Resend adapter: the request (002:T177)', () => {
  it("posts one mail to Resend's send endpoint: the bearer key, JSON, the fixed User-Agent and the body", async () => {
    const { fetch, sent } = fakeFetch();

    await expect(new ResendEmailAdapter({ ...options, fetch }).deliver(mail)).resolves.toBe(
      undefined,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.resend.com/emails');
    expect(sent[0]?.init.method).toBe('POST');
    expect(sent[0]?.init.headers).toEqual({
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      'user-agent': 'ijazah-api',
    });
    expect(bodyOf(sent[0])).toEqual({
      from: 'إجازة <no-reply@send.ijazahapp.com>',
      to: ['amr.k@example.invalid'],
      subject: 'رمز الدخول',
      text: 'رمز الدخول هو 482913',
      reply_to: 'support@ijazahapp.com',
    });
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends the HTML body when the mail has one', async () => {
    const { fetch, sent } = fakeFetch();

    await new ResendEmailAdapter({ ...options, fetch }).deliver({ ...mail, html: '<p>482913</p>' });

    expect(bodyOf(sent[0])).toMatchObject({ html: '<p>482913</p>', text: mail.text });
  });

  it.each([
    ['two addresses', { to: 'a@example.invalid, b@example.invalid' }],
    ['a display name', { to: 'Amr <a@example.invalid>' }],
    ['an empty subject', { subject: '' }],
    ['an empty text', { text: '' }],
  ])('refuses %s before any request', async (_case, change) => {
    const { fetch, sent } = fakeFetch();

    await expect(
      new ResendEmailAdapter({ ...options, fetch }).deliver({ ...mail, ...change }),
    ).rejects.toThrow(RangeError);
    expect(sent).toEqual([]);
  });
});

describe('the Resend adapter: the timeout (002:T177)', () => {
  it('runs the request under EMAIL_REQUEST_TIMEOUT_MS, ten seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fetch } = fakeFetch();

    await new ResendEmailAdapter({ ...options, fetch }).deliver(mail);

    expect(EMAIL_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(timeout).toHaveBeenCalledWith(EMAIL_REQUEST_TIMEOUT_MS);
  });

  it('fails a request Resend does not answer in time with status timeout, for the caller or the queue', async () => {
    const timedOut = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });

    const delivery = new ResendEmailAdapter({
      ...options,
      fetch: timedOut as unknown as typeof fetch,
    }).deliver(mail);

    await expect(delivery).rejects.toBeInstanceOf(EmailRequestError);
    await expect(delivery).rejects.toMatchObject({ status: 'timeout' });
  });

  it('fails a request that never reached Resend with status unreachable, repeating nothing of the cause', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${mail.to} with ${API_KEY}`);
    });

    const error: unknown = await new ResendEmailAdapter({
      ...options,
      fetch: failing as unknown as typeof fetch,
    })
      .deliver(mail)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailRequestError);
    expect(error).toMatchObject({ status: 'unreachable' });
    expect(shownBy(error)).not.toContain(mail.to);
    expect(shownBy(error)).not.toContain(API_KEY);
  });
});

describe('the Resend adapter: refusals carry the status alone (002:T177, R-SEC-2)', () => {
  it.each([403, 429, 500])(
    'fails on %i with the status only, cancelling the answer and repeating none of it',
    async (status) => {
      // Resend's error answers quote what was sent (an address, a domain); none of it is kept.
      const { response, cancelled } = answer(status, {
        statusCode: status,
        name: 'validation_error',
        message: `The domain of ${mail.to} is not verified; subject ${mail.subject}`,
      });
      const { fetch } = fakeFetch(response);

      const error: unknown = await new ResendEmailAdapter({ ...options, fetch })
        .deliver(mail)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EmailRequestError);
      expect({ ...(error as EmailRequestError) }).toEqual({ name: 'EmailRequestError', status });
      for (const kept of [
        mail.to,
        mail.subject,
        mail.text,
        API_KEY,
        'validation_error',
        'verified',
      ]) {
        expect(shownBy(error)).not.toContain(kept);
      }
      expect(cancelled()).toBe(true);
    },
  );

  it('writes nothing to the console or the process streams, on a delivery or a refusal', async () => {
    const writes = [
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method),
      ),
    ];
    await new ResendEmailAdapter({ ...options, fetch: fakeFetch().fetch }).deliver(mail);
    const refused = fakeFetch(answer(403, { message: mail.to }).response);
    await new ResendEmailAdapter({ ...options, fetch: refused.fetch })
      .deliver(mail)
      .catch(() => undefined);

    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });
});
