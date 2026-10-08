// T121: the video port's entry picks the adapter from `VIDEO_PROVIDER`. The stand-in's webhook
// secret is derived from `ENCRYPTION_KEY`, so no credential is needed (SC-005) and every process of
// one deployment verifies what another signed. `DAILY_WEBHOOK_SECRET` belongs to the real provider's
// adapter (Phase 3) and is not read here.
import { describe, expect, it } from 'vitest';
import { EventSignatureError } from '../inbound-event.js';
import { FakeVideoAdapter } from './fake.adapter.js';
import { createVideoPort, type VideoConfig } from './index.js';

const SESSION = '01928c3e-7a10-7000-8000-000000000001';
const STUDENT = '01928c3e-7a10-7000-8000-0000000000a1';
const base: VideoConfig = {
  VIDEO_PROVIDER: 'fake',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('video selection (T121, FR-056)', () => {
  it('serves the stand-in when VIDEO_PROVIDER is fake', () => {
    expect(createVideoPort(base)).toBeInstanceOf(FakeVideoAdapter);
  });

  it('two processes holding one ENCRYPTION_KEY verify what the other signed, and no other', async () => {
    const signer = createVideoPort(base) as FakeVideoAdapter;
    await signer.createRoom(SESSION);
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
