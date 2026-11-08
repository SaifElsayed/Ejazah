// T010: the video stand-in's test harness, the test tree's entry (contracts/video.md, "The stand-in
// and its harness"; FR-440; SC-402 to SC-406). The only way a spec produces a video event: it holds
// the stand-in's secret and the listening API's address, builds each event signed as the provider
// would (`joined`, `left`, `roomEnded`), delivers it over HTTP to `POST /webhooks/video`
// (`deliver`, `deliverTwice`, `deliverTimes`, `deliverInOrder`), and forges it (`tamper`).
// `scenario(session, row)` builds the events of a row of SRS §3.7.5's table, a reconnection and a
// lost final leave under the seed's default settings; the Provider-Outage row is not among them,
// since an outage window an administrator records causes it, not a video event (the fixtures'
// header).
//
// The building is `apps/api/src/platform/ports/video/video-stand-in.fixtures.ts` (its header says
// why it lives there, as `003:T013` placed the gateway's); this entry binds it to the webhook's
// path. The sessions module has no such constant yet: the route is T012's
// (`modules/sessions/video-webhook.controller.ts`), so the path is written here as the contract
// names it until that task gives the module one to import, as `gateway-stand-in.ts` imports
// `PAYMENT_WEBHOOK_PATH`.
import {
  createVideoStandIn,
  type VideoStandIn,
  type VideoStandInOptions,
} from '../../apps/api/src/platform/ports/video/video-stand-in.fixtures';

export {
  type ParticipantEventAt,
  type RoomEndedAt,
  type ScenarioSession,
  VIDEO_FORGERIES,
  VIDEO_SCENARIOS,
  type VideoForgery,
  type VideoScenario,
  type VideoStandIn,
  type VideoStandInEvent,
} from '../../apps/api/src/platform/ports/video/video-stand-in.fixtures';

/** `POST /webhooks/video` (contracts/video.md, "The webhook"). */
export const VIDEO_WEBHOOK_PATH = '/webhooks/video';

/** The harness for the API listening on `origin`, its video port built from `config`. */
export function videoStandIn(options: Omit<VideoStandInOptions, 'webhookPath'>): VideoStandIn {
  return createVideoStandIn({ ...options, webhookPath: VIDEO_WEBHOOK_PATH });
}
