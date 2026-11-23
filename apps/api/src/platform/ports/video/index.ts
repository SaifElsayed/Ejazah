// T121: the video port's entry. Which adapter serves the port is `VIDEO_PROVIDER` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4).
//
// The stand-in signs its participant events under a secret derived from `ENCRYPTION_KEY`, so no
// credential is needed (SC-005) and every process of one deployment verifies what another signed.
// The LiveKit keys are the real provider's and are not read for it.
//
// T009: `livekit` serves LiveKit (`livekit.adapter.ts`) from `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
// `LIVEKIT_API_SECRET`; the secret signs the tokens and verifies the webhooks, LiveKit having no
// separate webhook secret (research R-302). The configuration refuses `livekit` without the three
// (T009), and this entry refuses again, naming the key, so no caller can build it half-set.
//
// 004:T084 (SRS DEC-102; the note under T084, (2)): both adapters key the session media keys their
// tokens carry under `VIDEO_MEDIA_KEY_SECRET`, the platform's own secret, never the provider's. The
// configuration requires it outside development and test (`env.schema.ts`); there, unset, its
// stand-in is derived from `ENCRYPTION_KEY` by HKDF under its own label, never a constant, so every
// process of one deployment answers one session the same key.
import type { Config } from '../../config/config.module.js';
import { deriveSubkey, type HkdfLabel } from '../../crypto/encryption.js';
import { deriveStandInSecret } from '../inbound-event.js';
import { FakeVideoAdapter } from './fake.adapter.js';
import { LiveKitVideoAdapter } from './livekit.adapter.js';
import type { VideoPort } from './video.port.js';

export type VideoConfig = Pick<
  Config,
  | 'VIDEO_PROVIDER'
  | 'ENCRYPTION_KEY'
  | 'LIVEKIT_URL'
  | 'LIVEKIT_API_KEY'
  | 'LIVEKIT_API_SECRET'
  | 'VIDEO_MEDIA_KEY_SECRET'
>;

const STAND_IN_SECRET_LABEL = 'ijazah:video-stand-in-webhook:v1';
const MEDIA_KEY_STAND_IN_LABEL = 'ijazah:video-media-key:v1' satisfies HkdfLabel;

/** T084: the secret the session media keys are keyed under, as this file's head says. */
function mediaKeySecretOf(config: VideoConfig): Buffer {
  return config.VIDEO_MEDIA_KEY_SECRET === undefined
    ? deriveSubkey(config.ENCRYPTION_KEY, MEDIA_KEY_STAND_IN_LABEL)
    : Buffer.from(config.VIDEO_MEDIA_KEY_SECRET, 'base64');
}

/**
 * The secret the stand-in signs and verifies its events under, as above. Exported for the harness's
 * fixtures (T010, `video-stand-in.fixtures.ts`), which sign what the API verifies without repeating
 * the label.
 */
export function standInVideoWebhookSecret(config: Pick<VideoConfig, 'ENCRYPTION_KEY'>): string {
  return deriveStandInSecret(config.ENCRYPTION_KEY, STAND_IN_SECRET_LABEL);
}

export function createVideoPort(config: VideoConfig): VideoPort {
  switch (config.VIDEO_PROVIDER) {
    case 'fake':
      return new FakeVideoAdapter({
        webhookSecret: standInVideoWebhookSecret(config),
        mediaKeySecret: mediaKeySecretOf(config),
      });
    case 'livekit':
      return new LiveKitVideoAdapter({
        url: required(config.LIVEKIT_URL, 'LIVEKIT_URL'),
        apiKey: required(config.LIVEKIT_API_KEY, 'LIVEKIT_API_KEY'),
        apiSecret: required(config.LIVEKIT_API_SECRET, 'LIVEKIT_API_SECRET'),
        mediaKeySecret: mediaKeySecretOf(config),
      });
  }
}

function required(value: string | undefined, key: keyof VideoConfig): string {
  if (value === undefined) throw new Error(`VIDEO_PROVIDER=livekit needs ${key}.`);
  return value;
}
