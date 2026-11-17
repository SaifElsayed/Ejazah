// T119: the push stand-in. It checks what it is handed and sends nothing; the provider's view of
// which devices it no longer accepts is set by `markStale`, as the provider would learn it. T122: it
// records each operation it was asked to do and fails one when told. T005 of
// specs/005-certification (Q5 (a)): a delivery records its message, the kind's fixed text.
import { StandIn } from '../stand-in.js';
import {
  assertPushPayload,
  assertPushTarget,
  type PushMessage,
  type PushPayload,
  type PushPort,
  type PushTarget,
} from './push.port.js';

export class FakePushAdapter extends StandIn<PushPort> implements PushPort {
  readonly #stale = new Set<string>();

  deliver(target: PushTarget, payload: PushPayload, message: PushMessage): Promise<void> {
    const failure = this.attempt('deliver', [target, payload, message]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      assertPushTarget(target);
      assertPushPayload(payload);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    return Promise.resolve();
  }

  findStaleTargets(targets: readonly PushTarget[]): Promise<readonly PushTarget[]> {
    const failure = this.attempt('findStaleTargets', [targets]);
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve(targets.filter((target) => this.#stale.has(target.token)));
  }

  /** The provider stops accepting this device token. */
  markStale(token: string): void {
    this.#stale.add(token);
  }
}
