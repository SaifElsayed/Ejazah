// T005 of specs/005-certification (R-405, P2 (a)): Expo's push service behind the push port,
// selected by `PUSH_PROVIDER=expo`. Built against Expo's documented HTTP/2 API ("Send push
// notifications", the push and receipts endpoints) with `fetch` and no server SDK; it is tried on a
// fake `fetch` and the stand-in only until the owner's P2 acts (`expo-notifications`, FCM in EAS).
//
// DELIVER. One message per call, `POST https://exp.host/--/api/v2/push/send` with a JSON array of
// one: `to` (the device's Expo push token), `title` and `body` (the kind's fixed text in the user's
// language, Q5 (a)) and `data`, the payload of identifiers and nothing else (R-HONEST-5, checked by
// `assertPushPayload` before anything is sent). `EXPO_ACCESS_TOKEN` is sent as a bearer when the
// project turns it on. Expo answers one ticket per message: `ok` with a receipt id, or `error` with
// a code. `DeviceNotRegistered` means the device is gone: the delivery is not failed for it (a retry
// cannot reach it), and the token is reported stale. Any other error code fails the delivery for the
// job's retries, carrying the code alone: Expo's own message quotes the token (R-SEC-2).
//
// STALE TARGETS. A ticket's receipt is read later (`POST …/push/getReceipts` with the ids); a receipt
// whose code is `DeviceNotRegistered` makes its token stale. So the adapter holds the receipt ids it
// was given, per token, until they are read: a receipt not ready yet stays held for the next
// question about that token, and one read (ok or not) is forgotten. What is held lives in this
// process only and is bounded (`MAX_HELD_TICKETS`, the oldest dropped first): a token whose receipt is
// lost to a restart, to another worker process or to the bound is pruned by `purge-stale-push-tokens`
// when it stops being seen, so nothing is lost but promptness. Tokens are held, never logged.
//
// Every request runs under `PUSH_REQUEST_TIMEOUT_MS` and is aborted when it passes; a timeout fails
// the delivery into the queue's retries (R-405). A refusal carries a status or a code, never Expo's
// answer, the token or the credential.
import { z } from 'zod';

import {
  assertPushPayload,
  assertPushTarget,
  type PushMessage,
  type PushPayload,
  type PushPort,
  type PushTarget,
} from './push.port.js';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/**
 * How long a request to Expo waits before it is aborted. A transport number of the kernel, not a
 * setting (R-MONEY-12's exception): an administrator lengthening it from the panel would let one
 * slow provider hold the worker's delivery slots; a timed-out delivery is retried by the queue.
 */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The most receipt ids this process holds before dropping the oldest: it bounds the worker's memory
 * (a protection number of the kernel, R-MONEY-12's exception, as the stand-in's record is bounded).
 */
export const MAX_HELD_TICKETS = 1000;

/** Expo's documented limit of receipt ids in one request. */
const MAX_RECEIPT_IDS_PER_REQUEST = 1000;

/** Expo's code for a device that no longer accepts pushes. */
const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

/** A code Expo documents is letters only; anything else is not repeated. */
const PROVIDER_CODE = /^[A-Za-z]{1,64}$/;

/** Why a request to Expo did not deliver: its HTTP status, a ticket's code, or what kept it from one. */
export type PushRequestStatus = number | 'timeout' | 'unreachable' | 'unreadable' | 'refused';

/** Expo did not take the push. Carries the status and a documented code alone (R-SEC-2). */
export class PushRequestError extends Error {
  readonly status: PushRequestStatus;
  readonly code: string | undefined;

  constructor(status: PushRequestStatus, code?: string) {
    super(
      code === undefined
        ? `Expo's push service did not deliver (${String(status)}).`
        : `Expo's push service refused the push (${code}).`,
    );
    this.name = 'PushRequestError';
    this.status = status;
    this.code = code;
  }
}

const errorDetails = z.object({ error: z.string().optional() }).optional();

const ticketAnswer = z.object({
  data: z
    .array(
      z.discriminatedUnion('status', [
        z.object({ status: z.literal('ok'), id: z.string().min(1) }),
        z.object({ status: z.literal('error'), details: errorDetails }),
      ]),
    )
    .length(1),
});

const receiptsAnswer = z.object({
  data: z.record(z.string(), z.object({ status: z.enum(['ok', 'error']), details: errorDetails })),
});

export interface ExpoPushOptions {
  /** `EXPO_ACCESS_TOKEN`, sent as a bearer when set. */
  readonly accessToken?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

interface HeldTicket {
  readonly token: string;
  readonly receiptId: string;
}

export class ExpoPushAdapter implements PushPort {
  readonly #accessToken: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  /** Receipt ids not read yet, oldest first. */
  #held: HeldTicket[] = [];
  /** Tokens whose ticket said the device is gone, until reported. */
  readonly #unregistered = new Set<string>();

  constructor(options: ExpoPushOptions = {}) {
    this.#accessToken = options.accessToken;
    this.#timeoutMs = options.timeoutMs ?? PUSH_REQUEST_TIMEOUT_MS;
    // Called as a plain function, never as a method of this adapter.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async deliver(target: PushTarget, payload: PushPayload, message: PushMessage): Promise<void> {
    assertPushTarget(target);
    assertPushPayload(payload);
    const answer = ticketAnswer.safeParse(
      await this.#post(SEND_URL, [
        { to: target.token, title: message.title, body: message.body, data: payload },
      ]),
    );
    if (!answer.success) throw new PushRequestError('unreadable');
    const [ticket] = answer.data.data;
    if (ticket === undefined) throw new PushRequestError('unreadable');
    if (ticket.status === 'ok') {
      this.#hold({ token: target.token, receiptId: ticket.id });
      return;
    }
    const code = ticket.details?.error;
    if (code === DEVICE_NOT_REGISTERED) {
      this.#markUnregistered(target.token);
      return;
    }
    throw new PushRequestError('refused', codeOf(code));
  }

  async findStaleTargets(targets: readonly PushTarget[]): Promise<readonly PushTarget[]> {
    const asked = new Set(targets.map((target) => target.token));
    const stale = new Set([...asked].filter((token) => this.#unregistered.has(token)));
    const held = this.#held.filter((ticket) => asked.has(ticket.token));
    for (let from = 0; from < held.length; from += MAX_RECEIPT_IDS_PER_REQUEST) {
      const chunk = held.slice(from, from + MAX_RECEIPT_IDS_PER_REQUEST);
      const answer = receiptsAnswer.safeParse(
        await this.#post(RECEIPTS_URL, { ids: chunk.map((ticket) => ticket.receiptId) }),
      );
      if (!answer.success) throw new PushRequestError('unreadable');
      for (const ticket of chunk) {
        const receipt = answer.data.data[ticket.receiptId];
        // Not ready yet: held for the next question about this token.
        if (receipt === undefined) continue;
        if (receipt.status === 'error' && receipt.details?.error === DEVICE_NOT_REGISTERED) {
          stale.add(ticket.token);
        }
        this.#held = this.#held.filter((kept) => kept.receiptId !== ticket.receiptId);
      }
    }
    for (const token of stale) this.#forget(token);
    return targets.filter((target) => stale.has(target.token));
  }

  #hold(ticket: HeldTicket): void {
    this.#held.push(ticket);
    if (this.#held.length > MAX_HELD_TICKETS) this.#held.shift();
  }

  #markUnregistered(token: string): void {
    this.#unregistered.add(token);
    if (this.#unregistered.size > MAX_HELD_TICKETS) {
      const [oldest] = this.#unregistered;
      if (oldest !== undefined) this.#unregistered.delete(oldest);
    }
  }

  #forget(token: string): void {
    this.#unregistered.delete(token);
    this.#held = this.#held.filter((ticket) => ticket.token !== token);
  }

  async #post(url: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.#accessToken === undefined
            ? {}
            : { authorization: `Bearer ${this.#accessToken}` }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new PushRequestError(timedOut ? 'timeout' : 'unreachable');
    }
    if (!response.ok) {
      // The answer may quote the token; nothing of it is kept.
      await response.body?.cancel();
      throw new PushRequestError(response.status);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new PushRequestError('unreadable');
    }
  }
}

function codeOf(code: string | undefined): string {
  return code !== undefined && PROVIDER_CODE.test(code) ? code : 'unknown';
}
