// T121: the video port's entry picks the adapter from `VIDEO_PROVIDER`. The stand-in's webhook
// secret is derived from `ENCRYPTION_KEY`, so no credential is needed (SC-005) and every process of
// one deployment verifies what another signed. T009: `livekit` serves LiveKit from `LIVEKIT_URL`,
// `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, the secret both signing tokens and verifying webhooks;
// the stand-in reads none of them. Building the adapter makes no request.
import { randomBytes } from 'node:crypto';
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
