// T077, the payments half: `POST /webhooks/payment`, the gateway's signed webhook, a raw-body HTTP
// route outside tRPC (FR-PAYG-4, R-MONEY-9; ARCHITECTURE §4 and §8.1 steps 1 and 2).
//
// THE RAW BODY is read here, untouched, because the application's body parser is off (T149): the
// bytes the signature covers are the bytes the port verifies. The route has its own limit, the
// request body limit the surfaces read under (`MAX_REQUEST_BODY_BYTES`, FR-077, handed in by
// `main.ts`): a declared length over it is refused before a byte is read, and a body that grows
// over it while streaming is refused as soon as it does, so a sender cannot make the route buffer
// more than the limit.
//
// VERIFICATION is the kernel's guard core, `verifyInboundEvent`, over the port's own
// `verifyAndParseEvent`; its statuses are the guard's (`webhook-signature.guard.ts`): an absent or
// wrong signature 401, a signed body the port cannot read 400. Only a verified event reaches a
// service: a payout recipient's `recipient-events.service.ts`, a gateway order's
// `order-events.service.ts` (T038), each recording it under its unique provider event id before
// anything acts (R-MONEY-8). Whatever it answers (applied, a replay, a reference nobody holds, an
// order no row holds) is acknowledged with 200, so the gateway stops retrying; a failure while
// recording, or while enqueueing what a paid event asks, is a 500, so the gateway retries the event.
//
// THE ANSWERS leave in the kernel's one error shape (T101) with `Cache-Control: no-store`; after a
// refusal the socket is closed once the answer is flushed, since a refused body may still be
// arriving. A refusal is logged at warn with its code alone, which is what an alert on signature
// failures counts (ARCHITECTURE §12); an unexpected failure is logged with the request's
// correlation identifier and reported (T111). Nothing of the body, the signature or the event is
// ever logged (R-SEC-2).
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { constants } from 'node:http2';

import { DomainError } from '../../platform/errors/domain-error.js';
import { mapError, type MappedError } from '../../platform/errors/error-filter.js';
import { reportError } from '../../platform/errors/reporting.js';
import {
  type InboundEventVerifier,
  verifyInboundEvent,
} from '../../platform/guards/webhook-signature.guard.js';
import { type Logger, requestLogger } from '../../platform/logging/logger.js';
import {
  type GatewayEvent,
  NonFinalEventError,
} from '../../platform/ports/payment/payment.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { isOrderEvent, type OrderEventsService } from './order-events.service.js';
import type { RecipientEventsService } from './recipient-events.service.js';

/** Where the gateway posts its signed events. */
export const PAYMENT_WEBHOOK_PATH = '/webhooks/payment';

/** The two services a verified event is handed to, by what it concerns. */
export interface WebhookEvents {
  readonly recipients: Pick<RecipientEventsService, 'record'>;
  readonly orders: Pick<OrderEventsService, 'record'>;
}

export interface PaymentWebhookDependencies {
  /** The payment port's verify operation. */
  readonly verify: InboundEventVerifier<GatewayEvent>;
  readonly events: WebhookEvents;
  readonly log: Logger;
  /** The largest body read, in bytes (`MAX_REQUEST_BODY_BYTES`). */
  readonly maxBodyBytes: number;
  readonly now?: () => Date;
}

/** The sender went away before its body ended: nothing to answer. */
class BodyAbortedError extends Error {
  constructor() {
    super('The webhook request ended before its body did.');
    this.name = 'BodyAbortedError';
  }
}

const tooLarge = (): DomainError =>
  new DomainError('PAYLOAD_TOO_LARGE', 'The event is larger than allowed.');

function declaredLengthOf(request: IncomingMessage): number | undefined {
  const header = request.headers['content-length'];
  if (header === undefined) return undefined;
  // Digits only: `Number` would read `0x10` or `1e3` as a length.
  const length = Number(header);
  return /^\d+$/.test(header) && Number.isSafeInteger(length) ? length : undefined;
}

/** The body exactly as it came, refused once it passes `maxBodyBytes`. Its listeners leave with it. */
function readRawBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const settle = (outcome: () => void): void => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('close', onClose);
      outcome();
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        request.pause();
        settle(() => reject(tooLarge()));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => settle(() => resolve(Buffer.concat(chunks)));
    const onError = (error: Error): void => settle(() => reject(error));
    const onClose = (): void => settle(() => reject(new BodyAbortedError()));
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('close', onClose);
  });
}

function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: object,
  { close, headers = {} }: { readonly close: boolean; readonly headers?: Record<string, string> },
): void {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  if (close) response.setHeader('connection', 'close');
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.statusCode = status;
  response.end(JSON.stringify(body), () => {
    if (close) request.socket.destroy();
  });
}

/** A refusal: the one shape, then the socket closed once the answer is flushed. */
function refuse(
  request: IncomingMessage,
  response: ServerResponse,
  mapped: MappedError,
  headers?: Record<string, string>,
): void {
  send(
    request,
    response,
    mapped.status,
    { error: mapped.body },
    { close: true, ...(headers === undefined ? {} : { headers }) },
  );
}

export function paymentWebhookRoute({
  verify,
  events,
  log,
  maxBodyBytes,
  now = () => new Date(),
}: PaymentWebhookDependencies): NodeHandler {
  return (request, response) => {
    const correlationId = randomUUID();
    const requestLog = requestLogger(log, correlationId);
    void (async () => {
      try {
        // Mounted under its path, the request's own path is what lies below it: nothing.
        const { pathname } = new URL(request.url ?? '/', 'http://local');
        if (pathname !== '/' && pathname !== '') throw new DomainError('NOT_FOUND');
        if (request.method !== 'POST') {
          // The kernel's shape for a method the route does not take, under 405 (as the uploads answer).
          refuse(
            request,
            response,
            {
              ...mapError(new DomainError('NOT_FOUND')),
              status: constants.HTTP_STATUS_METHOD_NOT_ALLOWED,
            },
            { allow: 'POST' },
          );
          return;
        }
        const declaredLength = declaredLengthOf(request);
        if (declaredLength !== undefined && declaredLength > maxBodyBytes) throw tooLarge();
        const rawBody = await readRawBody(request, maxBodyBytes);
        const receivedAt = now();
        const event = await verifyInboundEvent(verify, rawBody, request.headers, request.url);
        const receipt = { rawBody, receivedAt, signatureVerifiedAt: now() };
        await (isOrderEvent(event)
          ? events.orders.record(event, receipt)
          : events.recipients.record(event, receipt));
        send(request, response, constants.HTTP_STATUS_OK, { received: true }, { close: false });
      } catch (error: unknown) {
        if (error instanceof NonFinalEventError) {
          // T056: the gateway sends the final state in a callback of its own; this one changes nothing.
          requestLog.info(
            {},
            'Payment webhook acknowledged an event that is not final; nothing was recorded',
          );
          send(request, response, constants.HTTP_STATUS_OK, { received: true }, { close: false });
          return;
        }
        if (error instanceof BodyAbortedError) {
          requestLog.info({}, 'Payment webhook aborted by the sender');
          return;
        }
        const mapped = mapError(error);
        if (mapped.unexpected) {
          requestLog.error({ err: error }, 'Unexpected error on the payment webhook');
          reportError(error, correlationId);
        } else {
          requestLog.warn({ code: mapped.body.code }, 'Payment webhook refused');
        }
        refuse(request, response, mapped);
      }
    })();
  };
}
