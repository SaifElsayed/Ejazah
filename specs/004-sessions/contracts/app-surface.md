# Contract: The user surface (Phase 3)

Every procedure below is mounted on `appRouter` and declares `.output(schema)`. "participant" is defined in
[README.md](./README.md). A session or enrollment the caller is not a participant of, one whose counterparty is of the
other gender (the server's records, FR-432), or one that does not exist, answers `NOT_FOUND` with one message and no
field (R-GENDER-2). The adversarial suite covers each procedure in both directions (FR-496).

## `sessions` — the session itself (sessions module)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.get` | participant | `{ sessionId }` | `{ sessionId, enrollmentId, sequenceNumber, makeupFor?: { sequenceNumber }, localDate, startTimeLocal, timezone, startsAt, endsAt, lengthMinutes, status, counterparty: { displayName \| null, deleted }, join: { opensAt, closesAt }, cancellation?: { requestId, requestedByMe, reason, status, expiresAt }, remedy?: RemedyView, dispute?: { status, raisedByMe, closesAt }, canRaiseDispute?, disputeClosesAt?, counterpartyInRoom: boolean }` | The pre-session screen's data (FR-434): the counterparty, the length, the times in the session's zone (the client adds the viewer's); `status` while disputed is `disputed` (the frozen outcome is not shown to the parties); the teacher sees no date of birth, minor flag, document or dispute history (R-HONEST-4). `counterpartyInRoom` (the owner's decision of 2026-11-05, research R-324): from the recorded participant events by R-304's per-connection rule, a `joined` connection of the counterparty with no later `left` for its `connection_ref` and no `room_ended` after it; a hint, no provider call per read (FR-427) |
| `sessions.join` | participant | `{ sessionId }` | `{ sessionId, serverUrl, token, validUntil }` | The room created with `video_empty_timeout_seconds` and `video_departure_timeout_seconds` (settings, R-302). FR-431, FR-432: from `startsAt − early_join_lead_minutes` until `endsAt`, a `scheduled` session, both accounts active, the teacher approved, both of one gender, read under both accounts' locks; else `JOIN_NOT_OPEN` (`opensAt`), `JOIN_CLOSED`, `SESSION_NOT_SCHEDULED`, `ACCOUNT_RESTRICTED`, or `NOT_FOUND`. Called again to rejoin (FR-435). The token is never logged (R-SEC-2). Creates the room on first call (idempotent). Writes no attendance |

`RemedyView` = `{ status: 'awaiting_choice' | 'proposed' | 'counter_proposed' | 'frozen' | 'booked' | 'refund_case', kind, offeredAt, choiceClosesAt, proposal?: { localDate, startTimeLocal, timezone, startsAt }, counter?: { localDate, startTimeLocal, timezone, startsAt, answerClosesAt }, canChooseRefund, makeupSessionId? }`. `counter` is the pending counter-proposal only; earlier ones are in the session's history (`session_events`). `counter.answerClosesAt` is computed when read, `counter_proposed_at` + A, by the one function the procedures and `advance-remedies` use; no column stores it (the owner's decision of 2026-11-05 on the second analysis, D1). With A and L the answer window and the first-session lead fixed on the remedy at its offer: the proposal never starts before `choiceClosesAt` + A + L, and no counter option before max(now + A + L, `choiceClosesAt`) (the owner's decision 9, H1 and H2, with the lead and the snapshot decided on the analysis; research R-320). A `frozen` remedy (the student is suspended) shows no proposal and accepts nothing; a `lapsed` one is never shown, its student being deleted. `canChooseRefund` is true only on a recitation enrollment: after a Teacher-No-Show, and for a session a cleared student's suspension cancelled on a recitation enrollment (the third analysis, A1).

## `sessions.cancellation` — FR-456 to FR-458

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.cancellation.request` | participant, idempotent | `{ sessionId, reason, idempotencyKey }` | `{ requestId, status: 'pending', expiresAt }` | A `scheduled` session not yet started; `reason` 1 to 500 characters; `CANCELLATION_PENDING` when a request is open (the caller answers it instead); `CANCELLATION_EXPIRED` at or after the start |
| `sessions.cancellation.answer` | participant (the counterparty) | `{ requestId, accept: boolean }` | `{ requestId, status: 'accepted' \| 'declined', sessionStatus }` | The requester answering their own request is `NOT_FOUND`; at or after the start `CANCELLATION_EXPIRED`; a session no longer `scheduled` (cancelled by another path) `SESSION_NOT_SCHEDULED`, nothing written (follow-up 3 of PR #126's review); accept → `cancelled_by_agreement`, no penalty, the make-up offered in the same transaction (final at acceptance, never disputed: the owner's decision 5; FR-457) |

## `sessions.remedy` — FR-462 to FR-469 (the student, except `answerCounter`)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.remedy.choose` | participant (student) | `{ sessionId, choice: 'makeup' \| 'refund' }` | `RemedyView` | `awaiting_choice` only; `refund` only on a recitation enrollment, after a Teacher-No-Show or for a session a cleared student's suspension cancelled (`CHOICE_NOT_ALLOWED` otherwise; A1); a refund opens or joins the enrollment's `refund_choice` case, no amount (FR-467) |
| `sessions.remedy.accept` | participant (student) | `{ sessionId }` | `RemedyView` with `makeupSessionId` | Books the proposal (FR-469), from `awaiting_choice`, `proposed` or `counter_proposed`; a pending counter-proposal is withdrawn and its time released (the owner's decision of 2026-11-05); `MAKEUP_REFUSED` when the database refuses it (the remedy stays open) |
| `sessions.remedy.counterOptions` | participant (student) | `{ sessionId }` | `{ options: [{ slotId, localDate, startTimeLocal, timezone, startsAt }] }` | The teacher's active slots of the session's length, each occurrence free for both parties (sessions, holds, reservations), none starting before max(now + A + L, `choiceClosesAt`), A and L the remedy's fixed answer window and first-session lead (H2 of the owner's decision 9 with the analysis's lead, R-320), up to the end of the choice window plus the weeks `booking.slots` reads; read again after each decline (H4) |
| `sessions.remedy.counter` | participant (student), idempotent | `{ sessionId, slotId, localDate, idempotencyKey }` | `RemedyView` | Before `choiceClosesAt` (`REMEDY_NOT_OPEN` after), one pending at a time (`COUNTER_PENDING`); must be one of `counterOptions`' answers when written (`SLOT_NOT_OFFERED`); records `counter_proposed_at` = now, its answer window closing at now + A, the remedy's fixed answer window, computed when read (`answerClosesAt`), never stored (D1); the proposal never moves (H1); a `frozen` remedy answers `REMEDY_NOT_OPEN` |
| `sessions.remedy.answerCounter` | participant (teacher) | `{ sessionId, accept: boolean }` | `RemedyView` | Before `answerClosesAt`, the same computation (`REMEDY_NOT_OPEN` after); accept books the counter, and an acceptance the database refuses answers `MAKEUP_REFUSED` and releases the counter as a decline does, recorded as one `counter_booking_refused` row, never `counter_withdrawn`, so it is not read as the student's acceptance of the proposal (the third analysis, A3; the owner's decision of 2026-11-06 on the fourth analysis, A1); decline releases the counter's time and returns the remedy to `proposed` while the choice window is open, the student free to accept or counter-propose again, and books the proposal once it has closed (the owner's decision 9) |

## `sessions.dispute` — FR-473, FR-474

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.dispute.raise` | participant, idempotent | `{ sessionId, reason, idempotencyKey }` | `{ disputeId, status: 'open' }` | From `endsAt`, before the evaluation too, until `dispute_window_hours` after it (`DISPUTE_WINDOW_CLOSED`); one open per session (`DISPUTE_OPEN`); `SESSION_UNDER_REVIEW` for `under_threshold`/`provider_outage`; `NOT_DISPUTABLE` for any cancelled session, by agreement or by an administrator (the owner's decision 5; SRS FR-DISPUTE-1 as amended on the analysis); the session becomes `disputed`. A session whose earlier dispute an administrator resolved may be disputed again inside its window, no remedy existing before the window closes (the third analysis, G1) |

## `sessions.complaint` — FR-452 (the student; the owner's decision of 2026-11-05, no automatic termination)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.complaint.raise` | participant (student), `rate_limit_absence_complaint` | `{ enrollmentId, reason }` | `{ complaintId, status: 'open' }` | SRS FR-NOSHOW-4, research R-322. A `confirmed` enrollment of the caller's; `reason` 1 to 500 characters, mandatory; one open per enrollment, held by `disputes_one_open_complaint_per_enrollment_key` (`COMPLAINT_OPEN`, the open one's id in `details`); one `session_events` row `complaint_raised`. **Rate limit**, as this file's README asks of whatever can be flooded: `rateLimit: { key: 'rate_limit_absence_complaint', subject: 'caller' }`, the student from the kind's own context (kernel.md, `RateLimitDeclaration`), the per-user form `booking.slots` and `checkout.*` take in T062, applied by the kind after the input is validated and before any transaction, so a call over the limit is refused `RATE_LIMITED` with nothing written; apart from the one-open rule. Locks: kernel.md's complaint row. The administrator decides it (`cases.decideComplaint`, admin-surface.md) |

## `chat` — chat module (FR-488 to FR-492)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `chat.list` | participant of the enrollment | `{ enrollmentId, cursor? }` | `{ messages: [{ messageId, mine, body?, attachment?: { filename, mime: 'application/pdf' \| 'text/plain' }, sentAt, purged }], nextCursor? }` | Newest first, `chat_page_size`; readable until purged; no storage key ever |
| `chat.send` | participant of a `confirmed` enrollment, idempotent, `rate_limit_chat_message` | `{ enrollmentId, body, idempotencyKey }` | the message | `body` 1 to 2000 characters; `CHAT_CLOSED` once the enrollment has ended: read-only until the purge (the owner's decision 11) |
| `chat.attachmentLink` | participant of the enrollment | `{ messageId }` | `{ url, expiresAt }` | A signed link valid `document_link_ttl_seconds` (R-SEC-3); a purged message is `NOT_FOUND` |
| `POST /uploads/chat` | participant of a `confirmed` enrollment (the upload route) | multipart: `enrollmentId`, `filename`, one file | 201 `{ messageId, attachment, sentAt }` | Kind `chat`: PDF or UTF-8 text by content, nothing else (the owner's decision 12; no Office file), any image refused by content or extension (`ATTACHMENT_REFUSED`), `upload_max_bytes`, `rate_limit_upload` (research R-314) |

## `live` — the live channel (FR-427 to FR-429, FR-437, FR-438; research R-324; the owner's decision of 2026-11-05)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `live.events` | user (student and teacher), a **subscription** over Server-Sent Events, `rate_limit_live_channel` | none (`z.void()`) | a stream of `LiveEvent` | `GET /trpc/live.events` on the existing mount; the token in the `Authorization` header only (`connectionParams` stays refused); a restricted standing refused as every user kind refuses it. **Rate limit**: `rateLimit: { key: 'rate_limit_live_channel', subject: 'caller' }` (10 per 60 s), failing closed; a refused opening is `RATE_LIMITED` with `retryAfterSeconds` in its details (kernel.md, "Rate limits"; the sixth analysis, item 6). At most `live_channel_max_connections_per_user` (3) streams per account, the oldest ended when one more opens. Every yielded event is parsed by `liveEvent`. A ping comment every 25 s; the stream ends at the expiry of the access token it opened with, at once after an `account` event, on the user's sign-out (that sign-in session's streams), when its bounded queue overflows, and before the API stops on shutdown. No replay: on every (re)start the app reads its open screens again |

`LiveEvent` (`packages/contracts/src/live.ts`), a discriminated union on `type`, each addressed by the server to user
ids the producing transaction read and sent after it commits:

| `type` | Fields | Means | Sent by (to) |
|---|---|---|---|
| `session` | `sessionId`, `enrollmentId` | read `sessions.get` and the enrollment's screens again | the video webhook's `participant_joined`, `participant_left`, `participant_connection_aborted`, `room_finished` (the other participant; `room_finished` both); `sessions.cancellation.request` (the counterparty) and `.answer` (the requester); `sessions.cancel` (both) |
| `enrollment` | `enrollmentId` | read the enrollment's screens and lists again | an enrollment closed (a complaint's decision (a), a confirmed fault) or restored (both); sessions cancelled by an account's end (the other party) |
| `chat` | `enrollmentId`, `message` | `message` in `chat.list`'s item shape, `mine` for the recipient; merged into the open chat's first page by `messageId` | `chat.send`, `POST /uploads/chat` (both parties) |
| `account` | none | read `account.me` again; the server then ends the stream | `StandingService` (suspension, ban, revocation), a student's standing, a deletion, a sign-out (the person) |

Not sent live, read when the screen opens (FR-438): remedies, disputes, complaints, outcomes, an enrollment's
completion, a cancellation request's expiry and Phase 2's payment confirmation (still polled). The app's «expired» on a
pending request, from `cancellation.expiresAt`, is display only; a refused answer (`CANCELLATION_EXPIRED`) reads the
screen again.

## Phase 2's lists, widened additively

`enrollments.list/get`, `teacher.students.list/get` and `teacher.today` keep every field and gain: a party's
`deleted` beside a `displayName` that may now be `null` (T090; the field becomes nullable, which the contract gate
reviews as a widening of the output, not a removal — **to confirm** in B34 against `pnpm contract:snapshot`, else a new
`displayNameOrNull` field and the old one deprecated); per session `sessionId` (if absent), `pendingCancellation:
boolean`, `remedyStatus?`, `disputed: boolean`; per enrollment its `status` with `completed` and `terminated_no_show`,
which the enum already holds, and, on `enrollments.get`, `complaintOpen: boolean`, so the student's complaint button
reads «شكوتك قيد المراجعة» while their complaint is open (FR-452; booking reads it through moderation's entry). A
restored enrollment (FR-455) is `confirmed` again and returns to the active tab. The tabs place `completed`, `terminated_no_show` and the new `cancelled` reasons in the
ended tab.

`teacher.students.list`, the teacher's search of their students by name, declares Phase 1's `rate_limit_search` (60 per
60 s, no budget, as `booking.slots` does), the teacher as subject, failing closed; over it `RATE_LIMITED`. Phase 2
declared none, so the default would have counted it and failed open (R-SEC-6; the owner's decision of 2026-11-06 on the
fourth analysis, C2; kernel.md, "Rate limits").

## The public configuration

No addition: the video server's address comes with each token (`serverUrl`), so it is never built into the app.
