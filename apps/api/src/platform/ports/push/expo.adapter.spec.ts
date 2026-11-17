// T005 of specs/005-certification (R-405): Expo's push service behind the push port, against a fake
// `fetch` only: no request leaves this machine. The request's documented shape (the endpoint, the
// message's `to`, `title`, `body` and `data`, the bearer when the access token is set), a request
// cut at `PUSH_REQUEST_TIMEOUT_MS` into the job's retries, a ticket's and a receipt's
// `DeviceNotRegistered` reported as a stale target, and a refusal that never repeats the token.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExpoPushAdapter,
  MAX_HELD_TICKETS,
  PUSH_REQUEST_TIMEOUT_MS,
  PushRequestError,
} from './expo.adapter.js';
import type { PushMessage, PushPayload, PushTarget } from './push.port.js';

const NOTIFICATION = '01928c3e-7a10-7000-8000-00000000c001';
const SESSION = '01928c3e-7a10-7000-8000-00000000f001';
const phone: PushTarget = { token: 'ExponentPushToken[spec-phone]', platform: 'android' };
const tablet: PushTarget = { token: 'ExponentPushToken[spec-tablet]', platform: 'ios' };
const payload: PushPayload = { notificationId: NOTIFICATION, sessionId: SESSION };
const message: PushMessage = { title: 'Session reminder', body: 'Your session starts soon.' };

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fake `fetch` answering each request with the next answer, recording what it was sent. */
function fakeFetch(...answers: readonly (readonly [number, unknown])[]) {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    const [status, body] = queue.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

const ok = (id: string) => [200, { data: [{ status: 'ok', id }] }] as const;

function bodyOf(sent: Sent): unknown {
  return JSON.parse(String(sent.init.body));
}

function headersOf(sent: Sent): Record<string, string> {
  return sent.init.headers as Record<string, string>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Expo push adapter: the request (T005, R-405)', () => {
  it("posts one message to Expo's push endpoint: the token, the fixed text and the ids as data", async () => {
    const { fetch, sent } = fakeFetch(ok('receipt-1'));

    await new ExpoPushAdapter({ fetch }).deliver(phone, payload, message);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(sent[0]?.init.method).toBe('POST');
    expect(headersOf(sent[0] as Sent)).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    expect(bodyOf(sent[0] as Sent)).toEqual([
      { to: phone.token, title: message.title, body: message.body, data: payload },
    ]);
    expect(sent[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends EXPO_ACCESS_TOKEN as a bearer when it is set', async () => {
    const { fetch, sent } = fakeFetch(ok('receipt-1'));

    await new ExpoPushAdapter({ fetch, accessToken: 'expo-spec-token' }).deliver(
      phone,
      payload,
      message,
    );

    expect(headersOf(sent[0] as Sent).authorization).toBe('Bearer expo-spec-token');
  });

  it.each([
    ['a name in an identifier field', { notificationId: NOTIFICATION, sessionId: 'Ahmed Ali' }],
    ['a key that is not an identifier', { notificationId: NOTIFICATION, title: 'Reminder' }],
  ])('refuses %s before any request (R-HONEST-5)', async (_case, bad) => {
    const { fetch, sent } = fakeFetch(ok('receipt-1'));

    await expect(
      new ExpoPushAdapter({ fetch }).deliver(phone, bad as PushPayload, message),
    ).rejects.toThrow(TypeError);
    expect(sent).toEqual([]);
  });
});

describe('the Expo push adapter: the timeout (T005, R-405)', () => {
  it('runs every request under PUSH_REQUEST_TIMEOUT_MS', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fetch } = fakeFetch(ok('receipt-1'));

    await new ExpoPushAdapter({ fetch }).deliver(phone, payload, message);

    expect(timeout).toHaveBeenCalledWith(PUSH_REQUEST_TIMEOUT_MS);
  });

  it('fails a delivery Expo does not answer in time, for the queue to retry', async () => {
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const adapter = new ExpoPushAdapter({
      fetch: hanging as unknown as typeof fetch,
      timeoutMs: 20,
    });

    const delivery = adapter.deliver(phone, payload, message);

    await expect(delivery).rejects.toBeInstanceOf(PushRequestError);
    await expect(delivery).rejects.toMatchObject({ status: 'timeout' });
  }, 2_000);
});

describe('the Expo push adapter: refusals (T005, R-SEC-2)', () => {
  it("fails on a ticket's error code other than DeviceNotRegistered, naming the code and never the token", async () => {
    const { fetch } = fakeFetch([
      200,
      {
        data: [
          {
            status: 'error',
            message: `"${phone.token}" is sending too many messages`,
            details: { error: 'MessageRateExceeded' },
          },
        ],
      },
    ]);

    const delivery = new ExpoPushAdapter({ fetch }).deliver(phone, payload, message);

    await expect(delivery).rejects.toMatchObject({
      status: 'refused',
      code: 'MessageRateExceeded',
    });
    await expect(delivery).rejects.not.toThrow(/spec-phone/);
  });

  it('fails on an HTTP refusal with its status alone', async () => {
    const { fetch } = fakeFetch([401, { errors: [{ message: `bad token ${phone.token}` }] }]);

    const delivery = new ExpoPushAdapter({ fetch }).deliver(phone, payload, message);

    await expect(delivery).rejects.toMatchObject({ status: 401 });
    await expect(delivery).rejects.not.toThrow(/spec-phone/);
  });
});

describe('the Expo push adapter: stale targets (T005, R-405)', () => {
  it("reports a target stale on its ticket's DeviceNotRegistered, without failing the delivery", async () => {
    const { fetch, sent } = fakeFetch([
      200,
      { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] },
    ]);
    const adapter = new ExpoPushAdapter({ fetch });

    await expect(adapter.deliver(phone, payload, message)).resolves.toBeUndefined();

    expect(await adapter.findStaleTargets([phone, tablet])).toEqual([phone]);
    expect(sent).toHaveLength(1);
    expect(await adapter.findStaleTargets([phone])).toEqual([]);
  });

  it("reports a target stale on a DeviceNotRegistered receipt, reading Expo's receipts by id", async () => {
    const { fetch, sent } = fakeFetch(ok('receipt-phone'), ok('receipt-tablet'), [
      200,
      {
        data: {
          'receipt-phone': { status: 'error', details: { error: 'DeviceNotRegistered' } },
          'receipt-tablet': { status: 'ok' },
        },
      },
    ]);
    const adapter = new ExpoPushAdapter({ fetch });
    await adapter.deliver(phone, payload, message);
    await adapter.deliver(tablet, payload, message);

    expect(await adapter.findStaleTargets([phone, tablet])).toEqual([phone]);

    expect(sent[2]?.url).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(bodyOf(sent[2] as Sent)).toEqual({ ids: ['receipt-phone', 'receipt-tablet'] });
    // Both receipts were read: nothing is asked again.
    expect(await adapter.findStaleTargets([phone, tablet])).toEqual([]);
    expect(sent).toHaveLength(3);
  });

  it('holds a receipt not ready yet, and reads it at the next question', async () => {
    const { fetch, sent } = fakeFetch(
      ok('receipt-phone'),
      [200, { data: {} }],
      [
        200,
        {
          data: { 'receipt-phone': { status: 'error', details: { error: 'DeviceNotRegistered' } } },
        },
      ],
    );
    const adapter = new ExpoPushAdapter({ fetch });
    await adapter.deliver(phone, payload, message);

    expect(await adapter.findStaleTargets([phone])).toEqual([]);
    expect(await adapter.findStaleTargets([phone])).toEqual([phone]);
    expect(bodyOf(sent[2] as Sent)).toEqual({ ids: ['receipt-phone'] });
  });

  it('asks nothing when it holds no receipt for the targets', async () => {
    const { fetch, sent } = fakeFetch();

    expect(await new ExpoPushAdapter({ fetch }).findStaleTargets([phone, tablet])).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('holds at most MAX_HELD_TICKETS receipt ids, dropping the oldest', async () => {
    const answers = Array.from({ length: MAX_HELD_TICKETS + 1 }, (_, i) => ok(`receipt-${i}`));
    const { fetch, sent } = fakeFetch(...answers, [200, { data: {} }]);
    const adapter = new ExpoPushAdapter({ fetch });
    for (let i = 0; i <= MAX_HELD_TICKETS; i += 1) {
      await adapter.deliver(phone, payload, message);
    }

    await adapter.findStaleTargets([phone]);

    const asked = bodyOf(sent[MAX_HELD_TICKETS + 1] as Sent) as { ids: string[] };
    expect(asked.ids).toHaveLength(MAX_HELD_TICKETS);
    expect(asked.ids[0]).toBe('receipt-1');
  });
});
