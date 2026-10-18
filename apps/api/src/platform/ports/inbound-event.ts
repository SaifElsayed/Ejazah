// T118: how a port refuses an inbound provider event, shared by the payment port and the video port
// (contracts/ports.md, FR-074, R-MONEY-9). Each port verifies the signature on the raw body and parses
// it in one operation; when that fails it rejects with one of the two errors below, and the webhook
// signature guard (T133) answers each with its own status. Neither error carries the body, a header
// or the parser's own message, which can quote the body (R-SEC-2).
//
// `deriveStandInSecret` (T121) gives a stand-in that signs its own events a secret when no webhook
// secret is configured: HKDF over the column encryption key under a label of the stand-in's own,
// with only `node:crypto` (R-SEC-7), as the local storage link key is derived (note under T116),
// through the kernel's one derivation over its registered labels (T005).
import { deriveSubkey, type HkdfLabel } from '../crypto/encryption.js';

/** A stand-in's webhook secret, derived from `ENCRYPTION_KEY` under its own registered label. */
export function deriveStandInSecret(encryptionKey: string, label: HkdfLabel): string {
  return deriveSubkey(encryptionKey, label).toString('hex');
}

/** An inbound event whose signature is absent or does not hold. The webhook answers 401. */
export class EventSignatureError extends Error {
  constructor() {
    super('The event signature is absent or invalid.');
    this.name = 'EventSignatureError';
  }
}

/**
 * A correctly signed event the port cannot read: the provider sent a shape this port does not know.
 * Only a holder of the signing secret can reach it. The webhook answers 400.
 */
export class MalformedEventError extends Error {
  constructor() {
    super('The event is signed but its body is not one this port reads.');
    this.name = 'MalformedEventError';
  }
}
