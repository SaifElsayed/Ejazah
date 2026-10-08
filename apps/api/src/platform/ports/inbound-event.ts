// T118: how a port refuses an inbound provider event, shared by the payment port and the video port
// (contracts/ports.md, FR-074, R-MONEY-9). Each port verifies the signature on the raw body and parses
// it in one operation; when that fails it rejects with one of the two errors below, and the webhook
// signature guard (T133) answers each with its own status. Neither error carries the body, a header
// or the parser's own message, which can quote the body (R-SEC-2).

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
