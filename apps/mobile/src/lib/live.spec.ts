// T065 of specs/004-sessions (research R-324, item 2): the phone's EventSource for the live channel,
// tRPC's `EventSourceLike` over the platform's `fetch` (`expo/fetch` on the phone) and
// `eventsource-parser`. It parses the stream as it arrives, across chunks, the server's ping among
// the events; it never reads the body whole and never goes through `timed()` (lib/client.ts), so no
// call timeout cuts it; the bearer is read from the session store at each open and never written in
// the URL; and it does not reconnect by itself: the channel reopens it.
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { CALL_TIMEOUT_MS } from './client';
import { liveEventSource } from './live';
import type { SessionTokens } from './storage';

const URL_OF_CHANNEL = 'https://api.ijazah.test/trpc/live.events';

/** A response body the case writes chunk by chunk, as a stream arrives. */
function streamedBody() {
  const encoder = new TextEncoder();
  const queued: Uint8Array[] = [];
  let waiting: ((read: { done: boolean; value?: Uint8Array }) => void) | undefined;
  let ended = false;
  const reader = {
    read: jest.fn(
      () =>
        new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
          const next = queued.shift();
          if (next !== undefined) resolve({ done: false, value: next });
          else if (ended) resolve({ done: true });
          else waiting = resolve;
        }),
    ),
    cancel: jest.fn(async () => undefined),
  };
  const deliver = (read: { done: boolean; value?: Uint8Array }) => {
    const resolve = waiting;
    waiting = undefined;
    resolve?.(read);
  };
  return {
    body: { getReader: () => reader },
    reader,
    write(text: string) {
      const chunk = encoder.encode(text);
      if (waiting === undefined) queued.push(chunk);
      else deliver({ done: false, value: chunk });
    },
    end() {
      ended = true;
      if (waiting !== undefined) deliver({ done: true });
    },
  };
}

type Body = ReturnType<typeof streamedBody>;

/** A response whose whole-body readers are spies: none may be called. */
function streamResponse(body: Body, status = 200, type = 'text/event-stream') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': type }),
    body: body.body,
    text: jest.fn(),
    json: jest.fn(),
    arrayBuffer: jest.fn(),
    blob: jest.fn(),
  };
}

/** The transport, answering each open with the response `answer` makes. */
function transportOf(answer: () => ReturnType<typeof streamResponse>) {
  const responses: ReturnType<typeof streamResponse>[] = [];
  const send = jest.fn(async (_url: string, _init: RequestInit) => {
    const response = answer();
    responses.push(response);
    return response as unknown as Response;
  });
  return { send, responses };
}

function sessionsHolding(tokens: SessionTokens | null) {
  let held = tokens;
  return {
    read: jest.fn(async () => held),
    hold(next: SessionTokens | null) {
      held = next;
    },
  };
}

/** Lets the open's promises (the store's read, the transport, each read of the body) run. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1' };

afterEach(() => {
  jest.useRealTimers();
});

describe('the live channel’s EventSource (T065, R-324 item 2)', () => {
  it('parses a stream across chunks: tRPC’s `connected`, then an event split in two', async () => {
    const body = streamedBody();
    const { send } = transportOf(() => streamResponse(body));
    const Source = liveEventSource({ sessions: sessionsHolding(TOKENS), fetch: send });
    const source = new Source(URL_OF_CHANNEL);
    const connected: unknown[] = [];
    const messages: unknown[] = [];
    source.addEventListener('connected', (event) => connected.push(event));
    source.addEventListener('message', (event) => messages.push(event));
    await settle();
    expect(source.readyState).toBe(source.OPEN);

    body.write('event: connected\ndata: {"reconnectAfterInactivityMs":60000}\n\n');
    body.write('data: {"type":"session","sessionId":"0193a6f0-0000-7000-8000-0000000000c1",');
    await settle();
    expect(messages).toEqual([]);
    body.write('"enrollmentId":"0193a6f0-0000-7000-8000-0000000000e1"}\nid: 7\n\n');
    await settle();

    expect(connected).toEqual([
      expect.objectContaining({ data: '{"reconnectAfterInactivityMs":60000}' }),
    ]);
    expect(messages).toEqual([
      expect.objectContaining({
        data: '{"type":"session","sessionId":"0193a6f0-0000-7000-8000-0000000000c1","enrollmentId":"0193a6f0-0000-7000-8000-0000000000e1"}',
        lastEventId: '7',
      }),
    ]);
    source.close();
  });

  it('hands the server’s ping to its own listener, never as a message; a comment is ignored', async () => {
    const body = streamedBody();
    const { send } = transportOf(() => streamResponse(body));
    const source = new (liveEventSource({ sessions: sessionsHolding(TOKENS), fetch: send }))(
      URL_OF_CHANNEL,
    );
    const pings = jest.fn();
    const messages = jest.fn();
    source.addEventListener('ping', pings);
    source.addEventListener('message', messages);
    await settle();
    body.write('event: ping\ndata: \n\n: a comment line\n\n');
    await settle();
    expect(pings).toHaveBeenCalledTimes(1);
    expect(messages).not.toHaveBeenCalled();
    source.close();
  });

  it('never reads the body whole: each event arrives while the body is still open', async () => {
    const body = streamedBody();
    const { send, responses } = transportOf(() => streamResponse(body));
    const source = new (liveEventSource({ sessions: sessionsHolding(TOKENS), fetch: send }))(
      URL_OF_CHANNEL,
    );
    const messages = jest.fn();
    source.addEventListener('message', messages);
    await settle();
    body.write('data: {"type":"account"}\n\n');
    await settle();
    expect(messages).toHaveBeenCalledTimes(1);
    const [response] = responses;
    expect(response?.text).not.toHaveBeenCalled();
    expect(response?.json).not.toHaveBeenCalled();
    expect(response?.arrayBuffer).not.toHaveBeenCalled();
    expect(response?.blob).not.toHaveBeenCalled();
    source.close();
    expect(body.reader.cancel).toHaveBeenCalled();
  });

  it('is cut by no call timeout: past CALL_TIMEOUT_MS the request is not aborted and events still arrive', async () => {
    jest.useFakeTimers();
    const body = streamedBody();
    const { send } = transportOf(() => streamResponse(body));
    const source = new (liveEventSource({ sessions: sessionsHolding(TOKENS), fetch: send }))(
      URL_OF_CHANNEL,
    );
    const messages = jest.fn();
    source.addEventListener('message', messages);
    await settle();
    await jest.advanceTimersByTimeAsync(CALL_TIMEOUT_MS * 3);
    const signal = send.mock.calls[0]?.[1].signal;
    expect(signal?.aborted).toBe(false);
    body.write('data: {"type":"account"}\n\n');
    await settle();
    expect(messages).toHaveBeenCalledTimes(1);
    expect(source.readyState).toBe(source.OPEN);
    source.close();
    expect(signal?.aborted).toBe(true);
  });

  it('reads the bearer from the session store at each open, in the header and never in the URL', async () => {
    const sessions = sessionsHolding(TOKENS);
    const { send } = transportOf(() => streamResponse(streamedBody()));
    const Source = liveEventSource({ sessions, fetch: send });
    const first = new Source(URL_OF_CHANNEL);
    await settle();
    sessions.hold({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    const second = new Source(URL_OF_CHANNEL);
    await settle();

    const sent = send.mock.calls.map(([url, init]) => ({
      url,
      authorization: new Headers(init.headers).get('authorization'),
      method: init.method ?? 'GET',
    }));
    expect(sent).toEqual([
      { url: URL_OF_CHANNEL, authorization: 'Bearer access-1', method: 'GET' },
      { url: URL_OF_CHANNEL, authorization: 'Bearer access-2', method: 'GET' },
    ]);
    expect(sessions.read).toHaveBeenCalledTimes(2);
    first.close();
    second.close();
  });

  it('does not reconnect by itself: a body that ends closes it and says so once', async () => {
    const body = streamedBody();
    const { send } = transportOf(() => streamResponse(body));
    const source = new (liveEventSource({ sessions: sessionsHolding(TOKENS), fetch: send }))(
      URL_OF_CHANNEL,
    );
    const errors: number[] = [];
    source.addEventListener('error', () => errors.push(source.readyState));
    await settle();
    body.end();
    await settle();
    expect(errors).toEqual([source.CLOSED]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('closes on an answer that is not a stream, without reading it, and on a transport that fails', async () => {
    const refused = streamedBody();
    const notStream = transportOf(() => streamResponse(refused, 502, 'text/html'));
    const first = new (liveEventSource({
      sessions: sessionsHolding(TOKENS),
      fetch: notStream.send,
    }))(URL_OF_CHANNEL);
    const firstErrors = jest.fn();
    first.addEventListener('error', firstErrors);
    await settle();
    expect(firstErrors).toHaveBeenCalledTimes(1);
    expect(first.readyState).toBe(first.CLOSED);
    expect(notStream.responses[0]?.text).not.toHaveBeenCalled();

    const offline = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const second = new (liveEventSource({ sessions: sessionsHolding(TOKENS), fetch: offline }))(
      URL_OF_CHANNEL,
    );
    const secondErrors = jest.fn();
    second.addEventListener('error', secondErrors);
    await settle();
    expect(secondErrors).toHaveBeenCalledTimes(1);
    expect(second.readyState).toBe(second.CLOSED);
    expect(offline).toHaveBeenCalledTimes(1);
  });

  it('sends nothing after close(): a later chunk reaches no listener', async () => {
    const body = streamedBody();
    const { send } = transportOf(() => streamResponse(body));
    const source = new (liveEventSource({ sessions: sessionsHolding(TOKENS), fetch: send }))(
      URL_OF_CHANNEL,
    );
    const messages = jest.fn();
    const errors = jest.fn();
    source.addEventListener('message', messages);
    source.addEventListener('error', errors);
    await settle();
    source.close();
    body.write('data: {"type":"account"}\n\n');
    body.end();
    await settle();
    expect(messages).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(source.readyState).toBe(source.CLOSED);
  });
});
