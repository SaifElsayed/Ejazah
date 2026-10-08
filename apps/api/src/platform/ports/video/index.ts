// T121: the video port's entry. Which adapter serves the port is `VIDEO_PROVIDER` in the loaded
// configuration, never a code change (FR-056); `ports.module.ts` calls this once at startup, and
// nothing else names an adapter (R-API-4). The real provider's member and its case, with its
// credentials, are added by the Phase 3 adapter task.
//
// The stand-in signs its participant events under a secret derived from `ENCRYPTION_KEY`, so no
// credential is needed (SC-005) and every process of one deployment verifies what another signed.
// `DAILY_WEBHOOK_SECRET` is the real provider's and is not read here.
import type { Config } from '../../config/config.module.js';
import { deriveStandInSecret } from '../inbound-event.js';
import { FakeVideoAdapter } from './fake.adapter.js';
import type { VideoPort } from './video.port.js';

export type VideoConfig = Pick<Config, 'VIDEO_PROVIDER' | 'ENCRYPTION_KEY'>;

const STAND_IN_SECRET_LABEL = 'ijazah:video-stand-in-webhook:v1';

export function createVideoPort(config: VideoConfig): VideoPort {
  switch (config.VIDEO_PROVIDER) {
    case 'fake':
      return new FakeVideoAdapter({
        webhookSecret: deriveStandInSecret(config.ENCRYPTION_KEY, STAND_IN_SECRET_LABEL),
      });
  }
}
