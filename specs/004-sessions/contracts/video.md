# Contract: The video boundary (Phase 3)

## The port, as this phase calls it

`VideoPort` (`apps/api/src/platform/ports/video/video.port.ts`) keeps its domain names (R-API-5) and widens additively:

| Operation | Called by | When |
|---|---|---|
| `createRoom(sessionId)` → room reference | `sessions.join` | After the join's transaction commits, before minting; idempotent |
| `createSessionToken(sessionId, participantUserId, { validUntil })` → `JoinToken` | `sessions.join` | After `createRoom`; `validUntil` = the session's `scheduled_end_at`; the token is bound to one session and one participant by `bindJoinToken` (R-GENDER-7) |
| `endRoom(sessionId)` | the `evaluate-sessions` sweep, for a cancelled session inside its join period (FR-482) | Idempotent |
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
   and answers 200 (R-SESS-1, SC-405). Nothing else: the evaluation reads the events later (R-SESS-2).
5. 200 `{ received: true }`; a failure while recording 500, so the provider retries.

The public tunnel used for device runs passes only `POST /webhooks/payment` and `POST /webhooks/video` through its
proxy, with the raw body unchanged, a body limit of 64 KB, and 404 for everything else (the owner's tunnel rule).

## The LiveKit adapter (`livekit.adapter.ts`)

`livekit-server-sdk` 2.19.2. Configuration: `VIDEO_PROVIDER=livekit`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET` (secrets: never logged, Gitleaks-scanned, R-SEC-1). Room: name = session id, `maxParticipants: 2`.
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
