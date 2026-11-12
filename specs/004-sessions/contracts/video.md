# Contract: The video boundary (Phase 3)

## The port, as this phase calls it

`VideoPort` (`apps/api/src/platform/ports/video/video.port.ts`) keeps its domain names (R-API-5) and widens additively:

| Operation | Called by | When |
|---|---|---|
| `createRoom(sessionId, { emptyTimeoutSeconds, departureTimeoutSeconds })` → room reference (widened) | `sessions.join` | After the join's transaction commits, before minting; idempotent; the two timeouts from the settings `video_empty_timeout_seconds` and `video_departure_timeout_seconds` (R-302; the owner's decision of 2026-11-05 on the analysis, K2) |
| `createSessionToken(sessionId, participantUserId, { validUntil })` → `JoinToken` | `sessions.join` | After `createRoom`; `validUntil` = the session's `scheduled_end_at`; the token is bound to one session and one participant by `bindJoinToken` (R-GENDER-7) |
| `endRoom(sessionId)` | the `evaluate-sessions` sweep, twice in each run: first for a cancelled session inside its join period (FR-482); then, after the settlement, for a session due a close at its scheduled end (FR-501, T067): someone joined it and no `room_ended` is recorded at or after the latest join, its `scheduled_end_at` plus `room_close_grace_minutes` is at or before the database's clock, and that plus `room_close_retry_minutes` is after it, whatever its status (the owner's decisions of 2026-11-11 on B40a's conflict check, Q5 to Q8) | Idempotent (the adapter takes the provider's `not_found` as success). The sweep writes one structured `info` line per call, `video room ended`: `{ sessionId }` only for a cancelled session, `{ sessionId, reason: 'scheduled_end' }` exactly for a close at the scheduled end; a failed call, from either caller, one `warn` line `video room not ended` `{ sessionId, reason: 'end_room_failed' }`, reported to error tracking, the run going on; the close's own failure (a missing setting, a failed read) one `error` line `video room close failed` with no id, reported, the settlement already done. One line per `removeParticipant` call, `video participant removed`, `{ sessionId, userId }`. Never a token, a name or an address; no row, the provider's `room_ended` event the durable record (research R-323, GAP-7; the owner's decision of 2026-11-05) |
| `removeParticipant(sessionId, userId)` (only if T009 finds that room creation on join cannot be turned off) | the same sweep, for each restricted participant of such a session, before `endRoom` (FR-482; research R-313; the analysis, K3) | Idempotent: an absent participant or room is not an error; LiveKit's `RoomServiceClient.removeParticipant`, a server-API call |
| `verifyAndParseParticipantEvent(rawBody, headers)` → `ParticipantEvent` | `POST /webhooks/video` | Before any handler; `EventSignatureError` → 401, `MalformedEventError` → 400 |

`ParticipantEvent` widens to `{ providerEventId, sessionId, type: 'joined' | 'left' | 'room_ended', participantUserId?,
connectionRef?, occurredAt }` — the participant and the connection present exactly when `type` is not `room_ended`. An
event the port does not treat as attendance answers a third kind, `{ kind: 'ignored' }`, which the webhook acknowledges
with 200 and records nowhere.

## The webhook (`POST /webhooks/video`, sessions module)

1. Read the raw body up to the request body limit; refuse a larger declared length before reading.
2. Verify through `verifyInboundEvent` over the port (LiveKit: `WebhookReceiver.receive(body, Authorization)`, never
   `skipAuth`); 401 or 400 and nothing written on failure.
3. `ignored` → 200. A session that does not exist, or an identity that is not one of its two participants → 200,
   written nowhere, reported to error tracking.
4. In one transaction: insert into `session_participant_events` under `provider_event_id`; a duplicate writes nothing
   and answers 200 (R-SESS-1, SC-405). Nothing else is written: the evaluation reads the events later (R-SESS-2).
   Once that transaction has committed, and only for an event it recorded (T065; research R-324, item 6; the owner's
   decision of 2026-11-11 on B40a's conflict check, Q14 (a)), one `session` `{ sessionId, enrollmentId }` is published
   through the live bus, a hint, to the other participant for a `joined` or a `left` and to both for a `room_ended`;
   nothing for a duplicate, an `ignored` event, an unknown session or an identity that is no participant, and nothing
   on a rollback. A publish that fails is logged at warn, `{ eventType, errorName }` without its payload, never
   retried, and changes no answer.
5. 200 `{ received: true }`; a failure while recording 500, so the provider retries.

The public tunnel used for device runs passes only `POST /webhooks/payment` and `POST /webhooks/video` through its
proxy, with the raw body unchanged, a body limit of 64 KB, and 404 for everything else (the owner's tunnel rule).

## The LiveKit adapter (`livekit.adapter.ts`)

`livekit-server-sdk` 2.19.2. Configuration: `VIDEO_PROVIDER=livekit`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET` (secrets: never logged, Gitleaks-scanned, R-SEC-1). Room: name = session id, `maxParticipants: 2`, `emptyTimeout` and `departureTimeout` from the two settings.
Token: identity = the user's id, `ttl` to `validUntil`, grant `roomJoin`, `room`, `canPublish`, `canSubscribe`, no
data, no create, no admin. Event mapping: research R-304. Its spec runs against recorded LiveKit payloads signed with a
test key, never the network (ARCHITECTURE §13, "Ports").

## The stand-in and its harness

`FakeVideoAdapter` (exists) widens to the new event types, `connectionRef` and `validUntil`. The harness
`tests/support/video-stand-in.ts` is the only way a spec produces a video event, over HTTP to the real webhook, as the
gateway's harness is (Phase 2, SC-302):

| Call | Effect |
|---|---|
| `joined(session, user, { at, connection? })`, `left(session, user, { at, connection? })`, `roomEnded(session, { at })` | A signed event with a fresh provider event id |
| `deliver(event)`, `deliverTwice(event)`, `deliverTimes(event, n)` | POST it; `n` for SC-405's hundred |
| `deliverInOrder([e1, e2, …])` | In the order given, whatever order they happened in |
| `tamper(event, 'wrong_secret' \| 'no_signature' \| 'body_changed')` | A forged variant (SC-406) |
| `scenario(session, rows)` | The events of a row of SRS §3.7.5's table, a reconnection, a lost final leave (SC-402 to SC-404) |
