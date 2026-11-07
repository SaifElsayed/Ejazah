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
import type { Config } from '../../config/config.module.js';
import { deriveStandInSecret } from '../inbound-event.js';
import { FakeVideoAdapter } from './fake.adapter.js';
import { LiveKitVideoAdapter } from './livekit.adapter.js';
import type { VideoPort } from './video.port.js';

export type VideoConfig = Pick<
  Config,
  'VIDEO_PROVIDER' | 'ENCRYPTION_KEY' | 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'
>;

const STAND_IN_SECRET_LABEL = 'ijazah:video-stand-in-webhook:v1';

export function createVideoPort(config: VideoConfig): VideoPort {
  switch (config.VIDEO_PROVIDER) {
    case 'fake':
      return new FakeVideoAdapter({
        webhookSecret: deriveStandInSecret(config.ENCRYPTION_KEY, STAND_IN_SECRET_LABEL),
      });
    case 'livekit':
      return new LiveKitVideoAdapter({
        url: required(config.LIVEKIT_URL, 'LIVEKIT_URL'),
        apiKey: required(config.LIVEKIT_API_KEY, 'LIVEKIT_API_KEY'),
        apiSecret: required(config.LIVEKIT_API_SECRET, 'LIVEKIT_API_SECRET'),
      });
  }
}

function required(value: string | undefined, key: keyof VideoConfig): string {
  if (value === undefined) throw new Error(`VIDEO_PROVIDER=livekit needs ${key}.`);
  return value;
}
