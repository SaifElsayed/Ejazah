// T063 of specs/004-sessions: the three branches of the after-commit publisher no other spec reaches
// (the owner's decision of 2026-11-09): an empty list of recipients, a thrown value that is not an
// `Error`, and a transaction that cannot be bound. What a request's list does otherwise is
// `surfaces/live.http.spec.ts`'.
import { describe, expect, it, vi } from 'vitest';

import { InProcessLiveBus } from './live-bus.js';
import { bindToTransaction, publisherOn, RequestLive, unboundBus } from './live-publisher.js';

const USER = '0199d0a0-0000-7000-8000-00000000a0a1';
const OTHER = '0199d0a0-0000-7000-8000-00000000a0a2';

function request() {
  const bus = new InProcessLiveBus();
  const warn = vi.fn();
  return { bus, warn, live: new RequestLive(bus, { warn }) };
}

describe('the after-commit publisher (T063)', () => {
  it('publishes nothing on the flush of an event added for no one', () => {
    const { bus, live } = request();
    const publish = vi.spyOn(bus, 'publish');

    live.afterCommit([], { type: 'account' });
    live.flush();

    expect(publish).not.toHaveBeenCalled();
  });

  it('logs a thrown value that is not an Error as unknown, with eventType and recipients and nothing else', () => {
    const { bus, live, warn } = request();
    const thrown: unknown = 'a thrown string that must not be logged';
    vi.spyOn(bus, 'publish').mockImplementation(() => {
      throw thrown;
    });

    live.afterCommit([USER, OTHER], { type: 'account' });
    live.flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({
      eventType: 'account',
      recipients: 2,
      errorName: 'unknown',
    });
  });

  it.each([[undefined], [null], ['not a transaction'], [42]])(
    'binds nothing to a transaction that cannot be bound (%s), and publisherOn answers undefined',
    (tx) => {
      const { live } = request();

      const unbind = bindToTransaction(tx, live);

      expect(publisherOn(tx)).toBeUndefined();
      expect(() => unbind()).not.toThrow();
    },
  );
});

// Nit 8 of PR #130's review, round 1 (B40a; the review session's Q2 (a)): one `unboundBus`, beside
// `RequestLive`, for a context or a route built without the process's bus.
describe('the unbound bus (B40a, nit 8)', () => {
  it('sends what it is handed nowhere, hears nothing, and its stop does nothing', () => {
    const heard = vi.fn();
    const stop = unboundBus.subscribe(heard);
    unboundBus.publish({ to: [USER], event: { type: 'account' } });
    expect(heard).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('is what a request’s list over no bus flushes into, without a warn line', () => {
    const warn = vi.fn();
    const live = new RequestLive(unboundBus, { warn });
    live.afterCommit([USER], { type: 'account' });
    expect(() => live.flush()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
