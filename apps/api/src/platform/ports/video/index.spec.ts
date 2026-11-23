// T121: the video port's entry picks the adapter from `VIDEO_PROVIDER`. The stand-in's webhook
// secret is derived from `ENCRYPTION_KEY`, so no credential is needed (SC-005) and every process of
// one deployment verifies what another signed. T009: `livekit` serves LiveKit from `LIVEKIT_URL`,
// `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, the secret both signing tokens and verifying webhooks;
// the stand-in reads none of them. Building the adapter makes no request.
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { addHours } from '@ijazah/time';
import { describe, expect, it } from 'vitest';
import { EventSignatureError } from '../inbound-event.js';
import { FakeVideoAdapter } from './fake.adapter.js';
import { createVideoPort, type VideoConfig } from './index.js';
import { LiveKitVideoAdapter } from './livekit.adapter.js';

const SESSION = '01928c3e-7a10-7000-8000-000000000001';
const STUDENT = '01928c3e-7a10-7000-8000-0000000000a1';
const base: VideoConfig = {
  VIDEO_PROVIDER: 'fake',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
// Generated at each run; no key is written here (R-SEC-1).
const livekit: VideoConfig = {
  ...base,
  VIDEO_PROVIDER: 'livekit',
  LIVEKIT_URL: 'wss://video.ijazah.invalid',
  LIVEKIT_API_KEY: `APIspec${randomBytes(6).toString('hex')}`,
  LIVEKIT_API_SECRET: randomBytes(32).toString('base64url'),
};

describe('video selection (T121, FR-056)', () => {
  it('serves the stand-in when VIDEO_PROVIDER is fake', () => {
    expect(createVideoPort(base)).toBeInstanceOf(FakeVideoAdapter);
  });

  it('serves the stand-in when VIDEO_PROVIDER is fake, even with the LiveKit keys set', () => {
    expect(createVideoPort({ ...livekit, VIDEO_PROVIDER: 'fake' })).toBeInstanceOf(
      FakeVideoAdapter,
    );
  });

  it('serves LiveKit when VIDEO_PROVIDER is livekit (T009)', () => {
    expect(createVideoPort(livekit)).toBeInstanceOf(LiveKitVideoAdapter);
  });

  it.each(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const)(
    'refuses LiveKit without %s, naming the key and never a value (T009)',
    (key) => {
      const { [key]: _omitted, ...without } = livekit;

      expect(() => createVideoPort(without)).toThrow(`VIDEO_PROVIDER=livekit needs ${key}.`);
      expect(() => createVideoPort(without)).not.toThrow(livekit.LIVEKIT_API_SECRET ?? '');
    },
  );

  it('two processes holding one ENCRYPTION_KEY verify what the other signed, and no other', async () => {
    const signer = createVideoPort(base) as FakeVideoAdapter;
    await signer.createRoom(SESSION, { emptyTimeoutSeconds: 300, departureTimeoutSeconds: 20 });
    const { rawBody, headers } = signer.participantEvent(SESSION, STUDENT, 'joined');
    const elsewhere = createVideoPort({
      ...base,
      ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    });

    await expect(
      createVideoPort(base).verifyAndParseParticipantEvent(rawBody, headers),
    ).resolves.toMatchObject({ type: 'joined', participantUserId: STUDENT });
    await expect(elsewhere.verifyAndParseParticipantEvent(rawBody, headers)).rejects.toThrow(
      EventSignatureError,
    );
  });
});

// 004:T084 (SRS DEC-102, NFR-SEC-13; the note under T084, (2)): a session's media key, 32 bytes,
// HMAC-SHA-256 of the session's id under `VIDEO_MEDIA_KEY_SECRET`; in development and test, with the
// variable unset, under a stand-in secret derived from `ENCRYPTION_KEY` by HKDF under its own label,
// never a constant and never the provider's secret. Every token carries it, from either adapter.
// The expected keys are computed here from `node:crypto`, not through the port.
describe('the session’s media key (T084)', () => {
  const OTHER_SESSION = '01928c3e-7a10-7000-8000-000000000002';
  const TEACHER = '01928c3e-7a10-7000-8000-0000000000b1';
  const UNTIL = { validUntil: new Date(addHours(new Date(), 1)) };
  const TIMEOUTS = { emptyTimeoutSeconds: 300, departureTimeoutSeconds: 20 };
  // Generated at each run; no key is written here (R-SEC-1).
  const mediaSecret = randomBytes(32).toString('base64');
  const hmac = (secret: Buffer | string, sessionId: string) =>
    createHmac('sha256', secret).update(sessionId).digest('base64');
  const standInSecret = (encryptionKey: string) =>
    Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(encryptionKey, 'base64'),
        Buffer.alloc(0),
        'ijazah:video-media-key:v1',
        32,
      ),
    );
  const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

  async function keyOf(config: VideoConfig, sessionId: string, userId = STUDENT) {
    const port = createVideoPort(config);
    await port.createRoom(sessionId, TIMEOUTS);
    return (await port.createSessionToken(sessionId, userId, UNTIL)).mediaKey;
  }

  it('gives both participants of one session the same key, 32 bytes', async () => {
    const port = createVideoPort(base);
    await port.createRoom(SESSION, TIMEOUTS);
    const student = await port.createSessionToken(SESSION, STUDENT, UNTIL);
    const teacher = await port.createSessionToken(SESSION, TEACHER, UNTIL);

    expect(student.mediaKey).toMatch(BASE64_32);
    expect(teacher.mediaKey).toBe(student.mediaKey);
  });

  it('gives another session a different key', async () => {
    const one = await keyOf(base, SESSION);
    const other = await keyOf(base, OTHER_SESSION);

    expect(one).toMatch(BASE64_32);
    expect(other).toMatch(BASE64_32);
    expect(other).not.toBe(one);
  });

  it('is HMAC-SHA-256 of the session id under VIDEO_MEDIA_KEY_SECRET when it is set', async () => {
    const config: VideoConfig = { ...base, VIDEO_MEDIA_KEY_SECRET: mediaSecret };

    expect(await keyOf(config, SESSION)).toBe(hmac(Buffer.from(mediaSecret, 'base64'), SESSION));
  });

  it('is derived from ENCRYPTION_KEY under its own label when the secret is unset, never a constant', async () => {
    const elsewhere = Buffer.alloc(32, 9).toString('base64');

    expect(await keyOf(base, SESSION)).toBe(hmac(standInSecret(base.ENCRYPTION_KEY), SESSION));
    expect(await keyOf({ ...base, ENCRYPTION_KEY: elsewhere }, SESSION)).toBe(
      hmac(standInSecret(elsewhere), SESSION),
    );
  });

  it('LiveKit’s token carries the key under VIDEO_MEDIA_KEY_SECRET, never under LIVEKIT_API_SECRET', async () => {
    const config: VideoConfig = { ...livekit, VIDEO_MEDIA_KEY_SECRET: mediaSecret };
    const token = await createVideoPort(config).createSessionToken(SESSION, STUDENT, UNTIL);
    const providerSecret = livekit.LIVEKIT_API_SECRET ?? '';

    expect(token.mediaKey).toBe(hmac(Buffer.from(mediaSecret, 'base64'), SESSION));
    expect(token.mediaKey).not.toBe(hmac(providerSecret, SESSION));
    expect(token.mediaKey).not.toBe(hmac(Buffer.from(providerSecret, 'base64url'), SESSION));
  });

  it('LiveKit without the secret (development) derives it from ENCRYPTION_KEY as the stand-in does', async () => {
    const token = await createVideoPort(livekit).createSessionToken(SESSION, STUDENT, UNTIL);

    expect(token.mediaKey).toBe(hmac(standInSecret(base.ENCRYPTION_KEY), SESSION));
  });
});
