# Contract: The user surface (Phase 3)

Every procedure below is mounted on `appRouter` and declares `.output(schema)`. "participant" is defined in
[README.md](./README.md). A session or enrollment the caller is not a participant of, one whose counterparty is of the
other gender (the server's records, FR-432), or one that does not exist, answers `NOT_FOUND` with one message and no
field (R-GENDER-2). The adversarial suite covers each procedure in both directions (FR-496).

## `sessions` — the session itself (sessions module)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.get` | participant | `{ sessionId }` | `{ sessionId, enrollmentId, sequenceNumber, makeupFor?: { sequenceNumber }, localDate, startTimeLocal, timezone, startsAt, endsAt, lengthMinutes, status, counterparty: { displayName \| null, deleted }, join: { opensAt, closesAt }, cancellation?: { requestId, requestedByMe, reason, status, expiresAt }, remedy?: RemedyView, dispute?: { status, raisedByMe, closesAt }, canRaiseDispute, disputeClosesAt? }` | The pre-session screen's data (FR-434): the counterparty, the length, the times in the session's zone (the client adds the viewer's); `status` while disputed is `disputed` (the frozen outcome is not shown to the parties); the teacher sees no date of birth, minor flag, document or dispute history (R-HONEST-4) |
| `sessions.join` | participant | `{ sessionId }` | `{ sessionId, serverUrl, token, validUntil }` | FR-431, FR-432: from `startsAt − early_join_lead_minutes` until `endsAt`, a `scheduled` session, both accounts active, the teacher approved, both of one gender, read under both accounts' locks; else `JOIN_NOT_OPEN` (`opensAt`), `JOIN_CLOSED`, `SESSION_NOT_SCHEDULED`, `ACCOUNT_RESTRICTED`, or `NOT_FOUND`. Called again to rejoin (FR-435). The token is never logged (R-SEC-2). Creates the room on first call (idempotent). Writes no attendance |

`RemedyView` = `{ status: 'awaiting_choice' | 'proposed' | 'counter_proposed' | 'booked' | 'refund_case', kind, offeredAt, choiceClosesAt, proposal?: { localDate, startTimeLocal, timezone, startsAt }, counter?: { localDate, startTimeLocal, timezone, startsAt, answerClosesAt }, canChooseRefund, makeupSessionId? }`. The proposal never starts at or before the window it waits on (research R-320).

## `sessions.cancellation` — FR-456 to FR-458

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.cancellation.request` | participant, idempotent | `{ sessionId, reason, idempotencyKey }` | `{ requestId, status: 'pending', expiresAt }` | A `scheduled` session not yet started; `reason` 1 to 500 characters; `CANCELLATION_PENDING` when a request is open (the caller answers it instead); `CANCELLATION_EXPIRED` at or after the start |
| `sessions.cancellation.answer` | participant (the counterparty) | `{ requestId, accept: boolean }` | `{ requestId, status: 'accepted' \| 'declined', sessionStatus }` | The requester answering their own request is `NOT_FOUND`; at or after the start `CANCELLATION_EXPIRED`; accept → `cancelled_by_agreement`, no penalty, a make-up owed (FR-457) |

## `sessions.remedy` — FR-462 to FR-469 (the student, except `answerCounter`)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.remedy.choose` | participant (student) | `{ sessionId, choice: 'makeup' \| 'refund' }` | `RemedyView` | `awaiting_choice` only; `refund` only on a recitation enrollment after a Teacher-No-Show (`CHOICE_NOT_ALLOWED` otherwise); a refund opens or joins the enrollment's `refund_choice` case, no amount (FR-467) |
| `sessions.remedy.accept` | participant (student) | `{ sessionId }` | `RemedyView` with `makeupSessionId` | Books the proposal (FR-469); `MAKEUP_REFUSED` when the database refuses it (the remedy stays open) |
| `sessions.remedy.counterOptions` | participant (student) | `{ sessionId }` | `{ options: [{ slotId, localDate, startTimeLocal, timezone, startsAt }] }` | The teacher's active slots of the session's length, each occurrence free for both parties (sessions, holds, reservations), starting after `choiceClosesAt` and after now + `makeup_counter_answer_hours` (the owner's rule of 2026-11-05, R-320), up to the end of the choice window plus the weeks `booking.slots` reads |
| `sessions.remedy.counter` | participant (student), idempotent | `{ sessionId, slotId, localDate, idempotencyKey }` | `RemedyView` | Must be one of `counterOptions`' answers when written (`SLOT_NOT_OFFERED`); fixes `counter_answer_closes_at`; the proposal moves past it if needed |
| `sessions.remedy.answerCounter` | participant (teacher) | `{ sessionId, accept: boolean }` | `RemedyView` | Before `counter_answer_closes_at` (`REMEDY_NOT_OPEN` after); accept books the counter, decline books the proposal (owner decision 9) |

## `sessions.dispute` — FR-473, FR-474

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `sessions.dispute.raise` | participant, idempotent | `{ sessionId, reason, idempotencyKey }` | `{ disputeId, status: 'open' }` | Within `dispute_window_hours` after `endsAt` (`DISPUTE_WINDOW_CLOSED`); one open per session (`DISPUTE_OPEN`); `SESSION_UNDER_REVIEW` for `under_threshold`/`provider_outage`; the session becomes `disputed` |

## `chat` — chat module (FR-488 to FR-492)

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `chat.list` | participant of the enrollment | `{ enrollmentId, cursor? }` | `{ messages: [{ messageId, mine, body?, attachment?: { filename, mime: 'application/pdf' \| 'text/plain' }, sentAt, purged }], nextCursor? }` | Newest first, `chat_page_size`; readable until purged; no storage key ever |
| `chat.send` | participant of a `confirmed` enrollment, idempotent, `rate_limit_chat_message` | `{ enrollmentId, body, idempotencyKey }` | the message | `body` 1 to 2000 characters; `CHAT_CLOSED` once the enrollment has ended (owner decision 11) |
| `chat.attachmentLink` | participant of the enrollment | `{ messageId }` | `{ url, expiresAt }` | A signed link valid `document_link_ttl_seconds` (R-SEC-3); a purged message is `NOT_FOUND` |
| `POST /uploads/chat` | participant of a `confirmed` enrollment (the upload route) | multipart: `enrollmentId`, `filename`, one file | 201 `{ messageId, attachment, sentAt }` | Kind `chat`: PDF or UTF-8 text by content, any image refused by content or extension (`ATTACHMENT_REFUSED`), `upload_max_bytes`, `rate_limit_upload` (research R-314) |

## Phase 2's lists, widened additively

`enrollments.list/get`, `teacher.students.list/get` and `teacher.today` keep every field and gain: a party's
`deleted` beside a `displayName` that may now be `null` (T090; the field becomes nullable, which the contract gate
reviews as a widening of the output, not a removal — **to confirm** in B34 against `pnpm contract:snapshot`, else a new
`displayNameOrNull` field and the old one deprecated); per session `sessionId` (if absent), `pendingCancellation:
boolean`, `remedyStatus?`, `disputed: boolean`; per enrollment its `status` with `completed` and `terminated_no_show`,
which the enum already holds. The tabs place `completed`, `terminated_no_show` and the new `cancelled` reasons in the
ended tab.

## The public configuration

No addition: the video server's address comes with each token (`serverUrl`), so it is never built into the app.
