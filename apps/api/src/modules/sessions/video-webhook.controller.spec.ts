// T012: `POST /webhooks/video`, the raw-body route outside tRPC (FR-440; R-SESS-7; research R-303;
// contracts/video.md, "The webhook"; the guard's header in `platform/guards/webhook-signature.guard.ts`).
//
// Each case is a real HTTP request to a Nest application mounted as `main.ts` mounts its routes (the
// body parser off, the handler under its path), over the video port's stand-in reached through the
// port's entry (R-API-4). Its events come from the stand-in's harness building
// (`video-stand-in.fixtures.ts`, which `tests/support/video-stand-in.ts` binds), posted to this
// route's own path; a body the harness cannot make (a signed body the port cannot read, a signed
// event that is not attendance, a body over the limit) is signed here as the stand-in signs.
// What the route hands an event to is a recorder: what recording does, over the database, is
// `tests/sessions/video-webhook.spec.ts`'s. The log is captured line by line, so "nothing of the
// body is logged" is a sweep over every line.
//
// Statuses: a recorded, replayed or unmatched event 200; an ignored one 200; an absent or wrong
// signature, or a body changed after signing, 401; a signed body the port cannot read 400; a body
// over the limit 413, before it is verified; any other method 405; a path below the route 404; a
// failure while recording 500, so the provider retries.
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import { type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../../platform/logging/logger.js';
import {
  createVideoPort,
  standInVideoWebhookSecret,
  type VideoConfig,
} from '../../platform/ports/video/index.js';
import {
  createVideoStandIn,
  VIDEO_FORGERIES,
  type VideoStandIn,
} from '../../platform/ports/video/video-stand-in.fixtures.js';
import type { ParticipantEvent } from '../../platform/ports/video/video.port.js';
import {
  VIDEO_WEBHOOK_PATH,
  type VideoEventOutcome,
  videoWebhookRoute,
} from './video-webhook.controller.js';

const CONFIG: VideoConfig = {
  VIDEO_PROVIDER: 'fake',
  ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
};
const MAX_BODY_BYTES = 2048;
const SESSION = '01928c3e-7a10-7000-8000-000000000001';
const STUDENT = '01928c3e-7a10-7000-8000-0000000000a1';
const AT = new Date('2026-11-08T17:00:00Z');

const port = createVideoPort(CONFIG);
/** A body signed as the stand-in signs (HMAC-SHA256 in `x-fake-signature`): what the harness cannot make. */
function signed(rawBody: Buffer): { rawBody: Buffer; headers: Record<string, string> } {
  const signature = createHmac('sha256', standInVideoWebhookSecret(CONFIG))
    .update(rawBody)
    .digest('hex');
  return { rawBody, headers: { 'x-fake-signature': signature } };
}

const recorded: ParticipantEvent[] = [];
const lines: string[] = [];
let answer: () => Promise<VideoEventOutcome> = () => Promise.resolve('recorded');

@Module({})
class EmptyModule {}

let application: INestApplication;
let origin: string;
let stand: VideoStandIn;

beforeAll(async () => {
  application = await NestFactory.create(EmptyModule, {
    bodyParser: false,
    logger: false,
    abortOnError: false,
  });
  application.use(
    VIDEO_WEBHOOK_PATH,
    videoWebhookRoute({
      verify: (rawBody, headers) => port.verifyAndParseParticipantEvent(rawBody, headers),
      events: {
        record: (event) => {
          recorded.push(event);
          return answer();
        },
      },
      log: createLogger({ level: 'info', destination: { write: (line) => void lines.push(line) } }),
      maxBodyBytes: MAX_BODY_BYTES,
    }),
  );
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
  stand = createVideoStandIn({ origin, webhookPath: VIDEO_WEBHOOK_PATH, config: CONFIG });
});

afterAll(async () => {
  await application?.close();
});

beforeEach(() => {
  recorded.length = 0;
  lines.length = 0;
  answer = () => Promise.resolve('recorded');
});

async function post(
  rawBody: Buffer,
  headers: Readonly<Record<string, string>>,
  path = VIDEO_WEBHOOK_PATH,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/webhook+json', ...headers },
    body: new Uint8Array(rawBody),
  });
  return { status: response.status, text: await response.text() };
}

/** Nothing of a body, a signature or an id is in any log line. */
function expectNothingLogged(...texts: string[]): void {
  for (const line of lines) {
    for (const text of texts) expect(line).not.toContain(text);
  }
}

const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe(`POST ${VIDEO_WEBHOOK_PATH} (T012, FR-440, R-SESS-7)`, () => {
  it('hands a correctly signed join, sent as application/webhook+json, to the recorder and answers 200', async () => {
    const event = stand.joined(SESSION, STUDENT, { at: AT, connection: 'PA_one' });

    const response = await post(event.rawBody, event.headers);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({ received: true });
    expect(recorded).toEqual([
      {
        providerEventId: event.providerEventId,
        sessionId: SESSION,
        type: 'joined',
        participantUserId: STUDENT,
        connectionRef: 'PA_one',
        occurredAt: AT,
      },
    ]);
    expect(lines).toEqual([]);
  });

  it('hands the room’s end over with no participant', async () => {
    expect(await stand.deliver(stand.roomEnded(SESSION, { at: AT }))).toBe(200);
    expect(recorded).toEqual([
      expect.objectContaining({ sessionId: SESSION, type: 'room_ended', occurredAt: AT }),
    ]);
    expect(recorded[0]).not.toHaveProperty('participantUserId');
  });

  it.each(['replayed', 'unknown_session', 'not_a_party'] as const)(
    'acknowledges an event the recorder answered %s with 200, so the provider stops retrying',
    async (outcome) => {
      answer = () => Promise.resolve(outcome);
      expect(await stand.deliver(stand.left(SESSION, STUDENT, { at: AT }))).toBe(200);
      expect(recorded).toHaveLength(1);
    },
  );

  it('acknowledges a signed event that is not attendance with 200, hands nothing on, and logs one info line of nothing of it', async () => {
    const { rawBody, headers } = signed(
      Buffer.from(
        JSON.stringify({ id: 'fake_vev_track', type: 'track_published', session: SESSION }),
      ),
    );

    const response = await post(rawBody, headers);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({ received: true });
    expect(recorded).toEqual([]);
    expect(logged()).toEqual([
      expect.objectContaining({
        level: 'info',
        msg: 'Video webhook acknowledged an event that is not attendance',
      }),
    ]);
    expectNothingLogged(SESSION, 'fake_vev_track', 'track_published');
  });

  it.each(VIDEO_FORGERIES)(
    'refuses a forgery (%s) with 401, hands nothing on, and logs the refusal by its code alone',
    async (how) => {
      const forged = stand.tamper(stand.joined(SESSION, STUDENT, { at: AT }), how);

      const response = await post(forged.rawBody, forged.headers);

      expect(response.status).toBe(401);
      expect(JSON.parse(response.text)).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'The event signature is absent or invalid.' },
      });
      expect(recorded).toEqual([]);
      expect(logged()).toEqual([
        expect.objectContaining({
          level: 'warn',
          errorCode: 'UNAUTHENTICATED',
          msg: 'Video webhook refused',
        }),
      ]);
      expectNothingLogged(
        SESSION,
        STUDENT,
        forged.providerEventId,
        forged.headers['x-fake-signature'] ?? 'no signature',
      );
    },
  );

  it('refuses a correctly signed body the port cannot read with 400, quoting nothing of it', async () => {
    const { rawBody, headers } = signed(
      Buffer.from(`{"type":"joined","session":"${SESSION}","participant":"${STUDENT}"}`),
    );

    const response = await post(rawBody, headers);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.text)).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'The event could not be read.' },
    });
    expect(recorded).toEqual([]);
    expect(logged()).toEqual([
      expect.objectContaining({ level: 'warn', errorCode: 'VALIDATION_FAILED' }),
    ]);
    expectNothingLogged(SESSION, STUDENT);
  });

  it('refuses a body declared over the limit with 413 before reading or verifying it', async () => {
    const { rawBody, headers } = signed(Buffer.from('x'.repeat(MAX_BODY_BYTES + 1)));

    const response = await post(rawBody, headers);

    expect(response.status).toBe(413);
    expect(JSON.parse(response.text)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(recorded).toEqual([]);
  });

  it('refuses a streamed body that grows over the limit with 413, declaring no length', async () => {
    const chunk = Buffer.alloc(512, 0x61);
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest(`${origin}${VIDEO_WEBHOOK_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/webhook+json', 'transfer-encoding': 'chunked' },
      });
      outgoing.on('response', (incoming) => {
        incoming.resume();
        resolve(incoming.statusCode ?? 0);
      });
      // The route closes the socket after its answer; the remaining chunks may meet a closed pipe.
      outgoing.on('error', (error) => (outgoing.writableEnded ? undefined : reject(error)));
      for (let sent = 0; sent <= MAX_BODY_BYTES; sent += chunk.length) outgoing.write(chunk);
      outgoing.end();
    });

    expect(status).toBe(413);
    expect(recorded).toEqual([]);
  });

  it('answers any other method with 405, naming POST', async () => {
    const response = await fetch(`${origin}${VIDEO_WEBHOOK_PATH}`);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(recorded).toEqual([]);
  });

  it('answers a path below the route with 404', async () => {
    const event = stand.joined(SESSION, STUDENT, { at: AT });

    const response = await post(event.rawBody, event.headers, `${VIDEO_WEBHOOK_PATH}/extra`);

    expect(response.status).toBe(404);
    expect(recorded).toEqual([]);
  });

  it('answers 500 when recording fails, so the provider retries, and logs the failure without the event', async () => {
    answer = () => Promise.reject(new Error('the database is unreachable'));
    const event = stand.left(SESSION, STUDENT, { at: AT, connection: 'PA_secret_connection' });

    const response = await post(event.rawBody, event.headers);

    expect(response.status).toBe(500);
    expect(JSON.parse(response.text)).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Try again later.' },
    });
    expect(lines.some((line) => line.includes('the database is unreachable'))).toBe(true);
    expectNothingLogged(
      SESSION,
      STUDENT,
      'PA_secret_connection',
      event.providerEventId,
      event.headers['x-fake-signature'] ?? 'no signature',
    );
  });
});
