// T119: the push port (contracts/ports.md). Named for what the product does, never a provider
// (R-API-5): reach a user's device, and learn which devices the provider no longer accepts.
//
// Reachable only from the queued notification job (R-API-15, FR-057): `api/no-push-outside-job`
// refuses every other file that names this folder.
//
// R-HONEST-5 is held twice. By type: the payload has a field for the notification's id and for the
// enrollment and session it concerns (the deep-link data of ERD `notifications.payload`), and no
// field for a name or a message's text, which the application renders in the user's language
// (FR-NOTIF-3). At run time: `assertPushPayload` accepts exactly those keys, each a UUID (ERD §0,
// every key is a UUID), so a name smuggled into an identifier field is refused before anything is
// sent. The refusal never echoes the value. An identifier another notification needs is added here,
// additively, by the phase that sends it.
import { z } from 'zod';

/** A device the provider can reach. The token is presented to the provider, never logged (R-SEC-2). */
export interface PushTarget {
  /** The provider's push token, decrypted from `device_push_tokens.token_encrypted`. */
  readonly token: string;
  readonly platform: 'ios' | 'android';
}

/** Identifiers for deep-linking, and nothing else (R-HONEST-5). */
export interface PushPayload {
  readonly notificationId: string;
  readonly enrollmentId?: string;
  readonly sessionId?: string;
}

export interface PushPort {
  /** Reach the user on one device. Delivery is queued and retried by the job (FR-NOTIF-4). */
  deliver(target: PushTarget, payload: PushPayload): Promise<void>;
  /** Of `targets`, those the provider no longer accepts, so their tokens can be pruned. */
  findStaleTargets(targets: readonly PushTarget[]): Promise<readonly PushTarget[]>;
}

const payloadSchema = z.strictObject({
  notificationId: z.uuid(),
  enrollmentId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
});

/** Refuse a payload carrying anything but identifiers. Echoes nothing of what it was handed. */
export function assertPushPayload(payload: PushPayload): void {
  if (!payloadSchema.safeParse(payload).success) {
    throw new TypeError(
      'A push payload carries identifiers for deep-linking only: notificationId, and optionally enrollmentId and sessionId, each a UUID (R-HONEST-5).',
    );
  }
}

/** Refuse a target with no token. */
export function assertPushTarget(target: PushTarget): void {
  if (target.token.length === 0) throw new RangeError('A push target has a token.');
}
