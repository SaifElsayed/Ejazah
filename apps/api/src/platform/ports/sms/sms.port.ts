// T120: the messaging port (contracts/ports.md): one-time codes and critical alerts. Named for what
// the product does, never a provider (R-API-5). The text may carry a one-time code, so no
// implementation logs it, and the logger redacts a `code`, `otp` or `body` key wherever one
// appears (T100, R-SEC-2).
export interface SmsPort {
  /** Send `text` to `destination`, a number in international form (E.164, e.g. `+201000000000`). */
  send(destination: string, text: string): Promise<void>;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** Refuse a destination that is not in international form, and an empty text. Echoes neither. */
export function assertMessage(destination: string, text: string): void {
  if (!E164.test(destination)) {
    throw new RangeError('A destination is a number in international form (E.164).');
  }
  if (text.length === 0) {
    throw new RangeError('A message has text.');
  }
}
