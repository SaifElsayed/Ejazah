// T133: the webhook signature guard (FR-074, R-MONEY-9; ARCHITECTURE §8.1 step 1). An inbound
// provider event is verified on its raw body before any handler runs, and a request that does not
// verify never reaches one, so nothing is written for it.
//
// THE GUARD VERIFIES NOTHING ITSELF. It hands the raw body and the headers to the port's own verify
// operation (`PaymentPort.verifyAndParseEvent`, `VideoPort.verifyAndParseParticipantEvent`), which
// knows its provider's signature scheme and compares in constant time (`timingSafeEqual` in each
// stand-in). The guard compares nothing, so it has no comparison of its own to make constant-time.
// On success it puts the verified event on the request, and the handler reads it with
// `verifiedEventOf`, never parsing the body a second time.
//
// STATUSES, mapped once here and answered by the kernel's one error shape (T101):
//   - `EventSignatureError` (absent or invalid signature), and every other throw or rejection of the
//     verifier, synchronous or not: 401 `UNAUTHENTICATED`. ARCHITECTURE §8.1 already says "bad
//     signature → 401". An unexpected failure is refused the same way, failing closed: it did not
//     verify.
//   - `MalformedEventError` (signed, but not a body the port reads): 400 `VALIDATION_FAILED`. Only a
//     holder of the signing secret can reach it, so the distinction tells an outsider nothing.
//     Stripe answers 400 for an unreadable payload (docs.stripe.com/webhooks, "Verify webhook
//     signatures with official libraries"); it answers 400 for a bad signature too, where this
//     project keeps the 401 its architecture chose. A provider retries on any non-2xx either way.
//   - No raw body on the request: the route was wired without capturing it, the server's own fault.
//     A plain error, so the filter answers 500 `INTERNAL` and reports it, and nothing is verified.
// No refusal carries the original error as its cause or quotes it: a parser's message can quote the
// body, and the body is never logged (R-SEC-2). The guard logs nothing.
//
// CAPTURING THE RAW BODY is the webhook route's own wiring (the payments module, Phase 2): the
// application's body parser is off (T149), so the route reads its body untouched, with its own size
// limit, and sets `request.rawBody` to the bytes before this guard runs. Replay is not this guard's:
// the provider's event id is stored under a unique NOT NULL column before anything acts (R-MONEY-8).
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { DomainError } from '../errors/domain-error.js';
import { MalformedEventError } from '../ports/inbound-event.js';

/** A port's verify operation: the raw body and headers in, the verified event out, or a refusal. */
export type InboundEventVerifier<T> = (
  rawBody: Buffer,
  headers: Readonly<Record<string, string | undefined>>,
) => Promise<T>;

/** A webhook request: its raw body as captured by the route, and the event once verified. */
export interface WebhookRequest extends IncomingMessage {
  rawBody?: Buffer;
  verifiedEvent?: unknown;
}

/** Only single-valued headers reach a verifier; a list (a repeated header Node keeps apart) does not. */
function singleValued(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') flat[name] = value;
  }
  return flat;
}

/** Verify `rawBody` through `verify`, answering the event or the refusal its failure deserves. */
export async function verifyInboundEvent<T>(
  verify: InboundEventVerifier<T>,
  rawBody: unknown,
  headers: IncomingHttpHeaders,
): Promise<T> {
  if (!Buffer.isBuffer(rawBody)) {
    throw new Error('The webhook route did not capture the raw body; nothing was verified.');
  }
  try {
    // Awaited inside the try, so a verifier that throws synchronously is refused like one that rejects.
    return await verify(rawBody, singleValued(headers));
  } catch (error: unknown) {
    if (error instanceof MalformedEventError) {
      throw new DomainError('VALIDATION_FAILED', 'The event could not be read.');
    }
    throw new DomainError('UNAUTHENTICATED', 'The event signature is absent or invalid.');
  }
}

/** Refuses a webhook request whose raw body does not verify, before its handler runs. */
export class WebhookSignatureGuard<T> implements CanActivate {
  constructor(private readonly verify: InboundEventVerifier<T>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WebhookRequest>();
    request.verifiedEvent = await verifyInboundEvent(this.verify, request.rawBody, request.headers);
    return true;
  }
}

/** The event the guard verified for this request. Only a route behind the guard may call it. */
export function verifiedEventOf<T>(request: WebhookRequest): T {
  if (request.verifiedEvent === undefined) {
    throw new Error('No verified event: the route is not behind the webhook signature guard.');
  }
  return request.verifiedEvent as T;
}
