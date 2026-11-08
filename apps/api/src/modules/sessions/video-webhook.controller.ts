// T012: `POST /webhooks/video`, the video provider's signed webhook, a raw-body HTTP route outside
// tRPC (FR-440; R-SESS-1, R-SESS-7; research R-303, R-304; contracts/video.md, "The webhook"),
// shaped as the payment webhook (`modules/payments/webhook.controller.ts`).
//
// THE RAW BODY is read here, untouched, because the application's body parser is off (T149): the
// bytes the signature covers are the bytes the port verifies (LiveKit's JWT carries the body's
// SHA-256). The route has the request body limit the surfaces read under (`MAX_REQUEST_BODY_BYTES`,
// handed in by `main.ts`): a declared length over it is refused before a byte is read, and a body
// that grows over it while streaming is refused as soon as it does. LiveKit's
// `application/webhook+json` is accepted, as any content type is: the port reads the bytes.
//
// VERIFICATION is the kernel's guard core, `verifyInboundEvent`, over the port's
// `verifyAndParseParticipantEvent`, before anything else runs: an absent or wrong signature 401, a
// signed body the port cannot read 400, nothing written for either (SC-406).
//
// WHAT IS RECORDED (R-304). A signed event that is not attendance (`ignored`) is acknowledged with
// 200 and recorded nowhere. A session that does not exist, or an identity that is not one of its
// two participants, is acknowledged with 200, written nowhere and reported to error tracking. Any
// other event is inserted into `session_participant_events` in one transaction under its provider
// event id, a duplicate writing nothing and answering 200 (R-SESS-1, SC-405); nothing else is done,
// the evaluation reading the events later (R-SESS-2), so an event for a settled session is recorded
// and changes nothing. A failure while recording is a 500, so the provider retries.
//
// THE LOCKS (contracts/kernel.md's two `POST /webhooks/video` rows; the owner's decision of
// 2026-11-06 on the sixth analysis, H1). A participant's event takes the participant's `users` row
// `FOR KEY SHARE` (`keyShareRows`) before the insert, never the enrollment and nothing `FOR UPDATE`:
// the insert's two foreign keys key-share the session first and the account second
// (`20261101050220_append_only_foreign_keys_restrict`), so without it the insert would hold the
// session while waiting on an account that a teacher's suspension holds `FOR UPDATE` before it locks
// the session, and the two would deadlock. `room_ended` has no participant and takes nothing before
// its insert, whose one key-share is the session's. The session's two participants are read with no
// lock: they never change.
//
// LOGGING (R-SEC-2). Nothing of the body, the header or the event is logged, but for two lines: a
// refusal at warn with its code alone, which the video signature alert counts (ARCHITECTURE §12);
// and a `participant_joined` from someone who is not a party, one warn line `{ sessionId, eventId }`
// (the note under T012 of 2026-11-07: LiveKit Cloud does not enforce `maxParticipants`), never the
// identity. An event for no session, or a leave from someone who is not a party, writes one warn
// line with its reason code alone; the report to error tracking names the provider's event id and
// the session's id, never the identity. An unexpected failure is logged with the request's
// correlation identifier and reported (T111).
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { constants } from 'node:http2';

import { z } from 'zod';

import { isUniqueViolation } from '../../platform/db/db-errors.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { mapError, type MappedError } from '../../platform/errors/error-filter.js';
import { reportError } from '../../platform/errors/reporting.js';
import {
  type InboundEventVerifier,
  verifyInboundEvent,
} from '../../platform/guards/webhook-signature.guard.js';
import { type Logger, requestLogger } from '../../platform/logging/logger.js';
import type { IgnoredEvent, ParticipantEvent } from '../../platform/ports/video/video.port.js';
import type { NodeHandler } from '../../platform/web/route.js';
import {
  insertParticipantEvent,
  keyShareRows,
  sessionPartiesOf,
} from './participant-events.repository.js';

/** Where the video provider posts its signed events (contracts/video.md, "The webhook"). */
export const VIDEO_WEBHOOK_PATH = '/webhooks/video';

/** What became of a verified attendance event; every one is acknowledged with 200. */
export type VideoEventOutcome = 'recorded' | 'replayed' | 'unknown_session' | 'not_a_party';

/** A signed event that names no session, or an identity that is not one of its participants (R-304). */
export class UnmatchedVideoEventError extends Error {
  constructor(
    reason: 'unknown_session' | 'not_a_party',
    providerEventId: string,
    sessionId: string,
  ) {
    super(`Video event ${providerEventId} for session ${sessionId} was not recorded: ${reason}.`);
    this.name = 'UnmatchedVideoEventError';
  }
}

const sessionIdShape = z.uuid();

export interface ParticipantEventsDependencies {
  readonly transactions: Transactions;
  readonly log: Pick<Logger, 'warn'>;
  /** The process's error reporting (T111); replaced by a recorder in the specs. */
  readonly report?: (error: Error) => void;
}

/** Records a verified attendance event once (R-SESS-1, R-304), in one transaction. */
export class ParticipantEventsService {
  readonly #transactions: Transactions;
  readonly #log: Pick<Logger, 'warn'>;
  readonly #report: (error: Error) => void;

  constructor({ transactions, log, report = reportError }: ParticipantEventsDependencies) {
    this.#transactions = transactions;
    this.#log = log;
    this.#report = report;
  }

  async record(event: ParticipantEvent): Promise<VideoEventOutcome> {
    // A room the platform did not name: no session has that id, and the database is not asked.
    const outcome = sessionIdShape.safeParse(event.sessionId).success
      ? await this.#recordOnce(event)
      : 'unknown_session';
    if (outcome === 'unknown_session' || outcome === 'not_a_party') this.#unmatched(event, outcome);
    return outcome;
  }

  async #recordOnce(event: ParticipantEvent): Promise<VideoEventOutcome> {
    try {
      return await this.#transactions.run(async (tx) => {
        const parties = await sessionPartiesOf(tx, event.sessionId);
        if (parties === null) return 'unknown_session';
        let userId: string | null = null;
        if (event.type !== 'room_ended') {
          const participant = event.participantUserId;
          if (participant !== parties.teacherUserId && participant !== parties.studentUserId) {
            return 'not_a_party';
          }
          userId = participant;
          // The account's key-share before the insert's own, in the account's place of the order.
          await keyShareRows(tx, 'users', [participant]);
        }
        await insertParticipantEvent(tx, {
          providerEventId: event.providerEventId,
          sessionId: event.sessionId,
          eventType: event.type,
          userId,
          connectionRef: userId === null ? null : (event.connectionRef ?? null),
          occurredAt: event.occurredAt,
        });
        return 'recorded';
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error, 'session_participant_events_provider_event_id_key')) {
        return 'replayed';
      }
      throw error;
    }
  }

  #unmatched(event: ParticipantEvent, reason: 'unknown_session' | 'not_a_party'): void {
    if (reason === 'not_a_party' && event.type === 'joined') {
      this.#log.warn(
        { sessionId: event.sessionId, eventId: event.providerEventId },
        'Video webhook: someone who is not a party joined the room; nothing was recorded',
      );
    } else {
      this.#log.warn({ reason }, 'Video webhook acknowledged an event it did not record');
    }
    this.#report(new UnmatchedVideoEventError(reason, event.providerEventId, event.sessionId));
  }
}

export interface VideoWebhookDependencies {
  /** The video port's verify operation. */
  readonly verify: InboundEventVerifier<ParticipantEvent | IgnoredEvent>;
  readonly events: Pick<ParticipantEventsService, 'record'>;
  readonly log: Logger;
  /** The largest body read, in bytes (`MAX_REQUEST_BODY_BYTES`). */
  readonly maxBodyBytes: number;
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

const acknowledge = (request: IncomingMessage, response: ServerResponse): void =>
  send(request, response, constants.HTTP_STATUS_OK, { received: true }, { close: false });

export function videoWebhookRoute({
  verify,
  events,
  log,
  maxBodyBytes,
}: VideoWebhookDependencies): NodeHandler {
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
        const event = await verifyInboundEvent(verify, rawBody, request.headers, request.url);
        if ('kind' in event) {
          requestLog.info({}, 'Video webhook acknowledged an event that is not attendance');
        } else {
          await events.record(event);
        }
        acknowledge(request, response);
      } catch (error: unknown) {
        if (error instanceof BodyAbortedError) {
          requestLog.info({}, 'Video webhook aborted by the sender');
          return;
        }
        const mapped = mapError(error);
        if (mapped.unexpected) {
          requestLog.error({ err: error }, 'Unexpected error on the video webhook');
          reportError(error, correlationId);
        } else {
          // `errorCode`: the logger redacts a bare `code`, which may be a one-time code (logger.ts).
          requestLog.warn({ errorCode: mapped.body.code }, 'Video webhook refused');
        }
        refuse(request, response, mapped);
      }
    })();
  };
}
