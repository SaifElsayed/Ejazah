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

// T081 of specs/004-sessions (the note under T081, Q-O2 (a); tasks.md's Not-scheduled item (13)'s
// `afterCommitDo`): a request's list also takes work, run once its work has committed, after its
// events, each failure caught and reported; dropped with the events on a rollback; run once.
describe('the work after the commit (T081)', () => {
  it('runs each action once, after the events, when the list is flushed', () => {
    const { bus, live } = request();
    const order: string[] = [];
    vi.spyOn(bus, 'publish').mockImplementation(() => void order.push('event'));
    live.afterCommitDo(() => void order.push('first'));
    live.afterCommit([USER], { type: 'account' });
    live.afterCommitDo(() => void order.push('second'));

    expect(order).toEqual([]);
    live.flush();
    live.flush();

    expect(order).toEqual(['event', 'first', 'second']);
  });

  it('drops every action with the events on a rollback', () => {
    const { live } = request();
    const action = vi.fn();
    live.afterCommitDo(action);
    live.drop();
    live.flush();

    expect(action).not.toHaveBeenCalled();
  });

  it('reports an action that throws and still runs the next one', () => {
    const bus = new InProcessLiveBus();
    const report = vi.fn();
    const live = new RequestLive(bus, { warn: vi.fn() }, report);
    const failure = new Error('the work failed');
    const next = vi.fn();
    live.afterCommitDo(() => {
      throw failure;
    });
    live.afterCommitDo(next);

    expect(() => live.flush()).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    expect(next).toHaveBeenCalledOnce();
  });

  it('is reached through the transaction the list is bound to (publisherOn)', () => {
    const { live } = request();
    const tx = {};
    const action = vi.fn();
    const unbind = bindToTransaction(tx, live);
    publisherOn(tx)?.afterCommitDo?.(action);
    unbind();
    live.flush();

    expect(action).toHaveBeenCalledOnce();
  });
});
