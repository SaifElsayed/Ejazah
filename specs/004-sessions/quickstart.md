# Quickstart: Validating Phase 3

**Feature**: `specs/004-sessions/` · **Date**: 2026-11-05

How to prove Phase 3 works: **a session runs on two phones and settles from the provider's signed events alone**, and
**the machines refuse what they refuse** — a token across genders or sessions, a forged or replayed event, an
evaluation before the end, an image in chat, an amount anywhere. Each section names the success criteria of
[spec.md](./spec.md) it proves. The device runs are the owner's, on the two Android phones of ADR 0003's spike (an
iPhone run is Phase 6's).

---

## Prerequisites

- Phase 2's quickstart prerequisites, on `develop` after this phase's batches merge.
- **Tests and probes run on the integrity database only** (`ijazah_integrity`, both URLs checked), never on `ijazah`:
  a spec that writes to a database runs only with `IJAZAH_DB_SPECS=1` beside the two `ijazah_integrity` URLs (T124, the
  owner's decisions of 2026-11-01). The database is migrated and seeded fresh, not reset (B19d).
- Before the first batch's migration runs on `ijazah`, the rows data-model §6 names are counted, then `pnpm db:migrate`
  and `pnpm db:seed` (the seventeen new settings rows of data-model §4, and the `teacher_no_show_threshold` row deleted
  by the migration; the panel and the jobs fail closed on a missing one). The seed inserts only the rows that are
  missing, so on a database already seeded `chat_retention_days` keeps its old value, 0, until an administrator changes
  it to 30 in the panel: no code writes a setting (R-PROC-11; data-model §4).
- `VIDEO_PROVIDER=fake` for every automated run: no provider credential in the suite (as SC-302 was for the gateway).
- For the device runs: a LiveKit Cloud project on the **free Build plan** (a hard cap: requests fail, nothing is billed;
  ADR 0003), its `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in `.env` only (R-SEC-1); the development
  build with the LiveKit packages (research R-316), installed on both phones. No paid infrastructure.
- **The tunnel** (device runs only): a cloudflared quick tunnel to a proxy, never to the API (the API runs with
  `SIGN_IN_PROVIDER=fake`): the proxy passes only `POST /webhooks/payment` and `POST /webhooks/video`, raw body and query
  unchanged, refuses a body over 64 KB and answers 404 to everything else. Before LiveKit's dashboard (Settings →
  Webhooks) is given `<tunnel>/webhooks/video`, check from outside: `GET /health` answers 404 and an unsigned
  `POST /webhooks/video` is refused by the API itself. Close the tunnel, the proxy, the API and the worker after the
  run, and delete the webhook from the dashboard.

---

## 1. The machines first (SC-403 to SC-413, SC-415, SC-416)

```text
pnpm typecheck && pnpm lint                       # no-money-vocabulary over sessions and chat; R-TIME-1; R-GENDER-4/5
pnpm test                                         # unit, contract, the double-run specs of the four new jobs
pnpm test:db-integrity                            # rules 40–48, the lock paths, the make-up and hold races
pnpm test:adversarial                             # every Phase 3 procedure, both directions, token replay
pnpm contract:snapshot --check --base origin/develop
pnpm check:authz && pnpm check:i18n
pnpm --filter @ijazah/time test                   # the interval operations' properties
```

Expected:

- With the video stand-in harness ([contracts/video.md](./contracts/video.md)): each row of SRS §3.7.5's table reached
  from signed events alone; a mid-session disconnect and reconnection sums its overlaps (SC-402); a session with no
  final leave settles within the evaluation delay plus one minute (SC-403); five Teacher-No-Shows on one enrollment
  leave it `confirmed`, each absence owed its remedy, and only mark it for administrators, the count read and never
  stored (SC-404, FR-448, FR-451); an event delivered 100 times leaves one row and the same
  outcome, and the job run twice leaves the same records (SC-405); a wrong or missing signature, or a body changed after
  signing, is refused with nothing written (SC-406).
- The adversarial suite refuses a token for the other gender, a non-participant, another session's id, a teacher
  suspended, revoked or banned, and outside the join period, in both directions, and after an administrator's gender
  correction (SC-407).
- The image corpus (`tests/fixtures/chat-corpus/`: every image type the sniffer names, an image renamed `.pdf` or
  `.txt`, a PDF renamed `.png`, a text file with a binary byte) is refused; PDFs and UTF-8 text are accepted (SC-408).
- The boundary and schema gates find no price, payment or amount in `modules/sessions` or `modules/chat` (SC-409).
- Every unconsumed outcome owes one remedy; every refund is handed to one case with no amount, the enrollment's open
  case of its reason or a new one; every booked make-up extends the
  enrollment's end and its slot's release (SC-410). No proposal, counter option or reserved time starts before the
  window it waits on, nor within the first-session lead of the moment it is decided; no proposal overlaps an open
  payment window of either party; a settings change after an offer moves none of that remedy's bounds (research R-320).
- No request is pending after the start, and an answer at or after it changes nothing (SC-411).
- A teacher's suspension, revocation, ban or deletion and a student's deletion leave no token issuable and the
  remaining sessions cancelled with their cases, in one transaction (SC-412).
- Every administrator action writes one audit entry with its reason; none writes a payment, an amount or a
  confirmation (SC-413).
- A second complaint on an enrollment with one open is refused `COMPLAINT_OPEN`, two at once leave one; a student over
  `rate_limit_absence_complaint` is refused `RATE_LIMITED` with nothing written; each of the three decisions writes its
  audit entry and event (SC-415).
- A restore inside the window recreates exactly the sessions still owed, the first no earlier than the first-session
  lead after it, and offers again the remedies its case held under the window rule; every refusal cause writes
  nothing, `slot_changed` among them (the slot moved while the enrollment was closed); a repeated key returns the first
  answer; `confirmed_at` is never written (SC-416, SC-413).
- The rate limits (FR-470): a signed-in procedure that declares no limit is refused `RATE_LIMITED` past the default;
  a procedure with its own limit is not counted by the default; with the counter failing, the default lets the call
  through and its breaker skips counting, while a declared limit refuses; the default's settings row missing refuses
  the call; `disputes.revise` and `sessions.restore` over their own limit are refused with no transaction opened;
  the seed plants the five rows (the default and the four administrator limits), the default at 160 per 60 s (research R-325); a subject's first refusal in a window writes one log record with only its allowed
  fields (a user or administrator by id and the procedure; any other subject by the procedure and its keyed digest,
  never the raw subject; a budget by the procedure and its key), and a second refusal in that window writes none.
  `users.list`, `sessions.monitor.list` and `teacher.students.list` over `rate_limit_search` are refused, with the
  counter failing too (the fourth analysis, C2).
- The manual case (FR-493): `cases.openManual` opens a case on an enrollment in each state, joins the open one of the
  same party, hands an open remedy to the student's case (both reserved times released, one `remedy_handed_to_case`
  row) and refuses a remedy no longer open, a missing enrollment, a reused key with another input and a call over its
  limit, each writing nothing; a manual case, open and then closed, on an enrollment waiting for payment leaves its paid
  order's confirmation and late branch as with no case, and opens no `duplicate_payment` case (research R-326).
- The administrator's control inventory (research R-323): `sessions.review.revise` corrects an undisputed outcome
  inside its window with one `outcome_corrected` row and refuses each other case (`RULING_FINAL`, `DISPUTE_OPEN`,
  `CONFLICT` `ruled` or `not_settled`, `SESSION_UNDER_REVIEW`, a reused key, the limit), writing nothing; every release
  and conversion of a hold writes its `release_reason`; a time zone data change writes one `instants_reresolved` row
  per session moved or kept back, and a refused commit none; `sessions.monitor.get` answers the enrollment's timeline
  and each session's remedy, a refused booking with its `bookingRetriedUntil`; a teacher's acceptance of a counter that
  the database refuses writes one `counter_booking_refused` row and no `counter_withdrawn` (the fourth analysis, A1);
  `expire-cancellation-requests` racing an acceptance, and a re-resolution racing the evaluation, end with no deadlock
  (L1); a cancellation request, and a decline, racing an administrator's `sessions.cancel` on the same session end
  with no deadlock, each having locked the enrollment before the session (the fifth analysis, L2).
- The live channel (research R-324; FR-427 to FR-429): `live.events` refuses an anonymous caller and a restricted
  standing, and an open over `rate_limit_live_channel`; a fourth stream of one account ends the oldest; a chat between
  A and B and a cancellation on their session reach A and B and never C; nothing is sent when the producing
  transaction rolls back; a suspension ends the person's streams after its `account` event; a stream ends at its access
  token's expiry; **shutdown with streams open completes and never waits on one** (the owner's hard condition); the
  contract snapshot records `live.events`' event schema; the RUNBOOK holds the RSS measured with 500 streams.

## 2. A session on the stand-in, end to end (US1, US2)

With `VIDEO_PROVIDER=fake`, a confirmed enrollment from Phase 2's quickstart §4 whose first session is near:

1. `sessions.get` before the lead: `join.opensAt` in the session's zone; `sessions.join` answers `JOIN_NOT_OPEN`.
2. Inside the lead: `sessions.join` as each participant answers a token bound to that session and that person; as
   another student, `NOT_FOUND`.
3. The harness delivers both joins, a teacher's drop and rejoin, and no final leave; after the end plus the delay, the
   session is `done` with the overlaps summed; the enrollment's remaining count is one less (derived).

## 3. The video provider, from the development machine (B34's adapter run)

With `VIDEO_PROVIDER=livekit` and the free project: `sessions.join` creates the room (`maxParticipants: 2`); a third
token is refused by the provider; the webhook through the tunnel records `participant_joined` and `participant_left`
with their connection; a forged POST is refused. **Check and record** whether a token minted before `endRoom` can
re-create the room (research R-313), and if it can and no setting turns that off, that `removeParticipant` removes a
restricted participant from it; and that webhooks are delivered on the free plan (not stated in LiveKit's pricing).

## 4. On two phones over mobile data (SC-401, SC-414) — the owner's run

On the vivo and the realme, Etisalat mobile data, the development build:

1. As the teacher and the student, open the session inside the lead: the pre-session screen names the other person,
   the length, the start in both zones, the microphone and camera state, camera off (FR-434). When the first joins,
   the other's still-open pre-session screen says so within seconds without a reload, and a chat message sent from one
   phone appears on the other's open chat (the live channel, FR-427).
2. Join; recite and correct; turn each camera on and off; share a screen from one phone.
3. Switch one phone from Wi-Fi to mobile data and back mid-session; close the app on one phone and reopen it: back in
   the same room (FR-435).
4. After the end plus the delay: `done` on both phones' enrollment screens; the review panel shows the joins, leaves
   and simultaneous time.
5. Ten joins on 4G: the room within ten seconds in at least nine; the owner judges the audio fit for correcting
   recitation (SC-414).

## 5. Cancellation and make-ups (US3, US4)

On the phones, against the stand-in's sessions: request a cancellation from each side; accept, decline and let one
expire at the start. At the acceptance (the owner's decision 5; the session cannot be disputed): the make-up's
proposal, in a week starting no earlier than the choice window's close plus 72 hours plus the 24-hour lead and
overlapping no payment window either party has open; counter-propose one of the teacher's slots (none offered
before the later of now + 72 + 24 hours and the choice window's end); the teacher declines it,
counter-propose again (a second one refused while the first is pending), and the teacher accepts; on another remedy,
accept the proposal while a counter-proposal is pending (the counter withdrawn, its time offered to others again); let
a choice window pass with nothing pending (the proposal booked), and an answer window pass (a refund case with no
amount), once inside the choice window and once after it. On a recitation enrollment after a Teacher-No-Show: choose a
refund.

## 6. The administrator (US5, US6)

In the panel: raise a dispute from the phone and resolve it each way; resolve one before its dispute window closes
(no remedy until the window has closed), raise a second dispute on it and resolve that, revise the ruling with a
reason (the session's outcome moved, the earlier ruling still on the dispute, one `dispute_revised` event, the answer
naming a suspension or ban the ruling made and left in place) and try to revise once the window has closed
(`RULING_FINAL`); resolve an Under-Threshold session and a
Provider-Outage one; record an outage window over a settled session (it moves to the review queue); cancel a session
(one case); resolve and dismiss a case (its closing instant is the database's); suspend a student (sessions cancelled, the enrollment still
confirmed, a case at the head of `/cases`, an open remedy frozen with its pending counter withdrawn), reinstate them
(the frozen remedy offered again with a full choice window) and resolve the case (on a recitation enrollment the
choice of a make-up or a refund, on the ijazah track a make-up), suspend another, reinstate them, accept a make-up, and dismiss
the case (the enrollment cancelled, the make-up cancelled, every remedy still owed in a new `student_fault_confirmed`
case and none in the case dismissed); ban a student (sessions and enrollments cancelled, a case); delete a student's account with a make-up
remedy open (lapsed, no case) and one whose refund was chosen (its case kept, and the deleted student's photo and
documents kept in storage until that case is closed, then removed by `erase-deleted-files`' next run: FR-487); while
that case is open, open it on `/cases`: its «held files» section lists the photo and the documents with no link, and
each view press opens one link that stops working after `document_link_ttl_seconds` and writes one `held_file.view`
audit entry; once the case is closed the section is refused, and after the job's next run a link asked for the file
answers `NOT_FOUND`; on `/users`, search a user by name and
open their record (FR-ADMIN-4's fields and the cancellation-request counts; a student's suspend, ban and reinstate);
read a dispute's chat (one `chat.read` audit entry per read). On a confirmed enrollment, complain of the teacher's
absence from the phone (the button then reads «شكوتك قيد المراجعة» and a second complaint is refused); in `/cases`,
close one complaint, suspend the teacher on another, and end the enrollment on a third (its sessions cancelled, a new
case holding what it owes); on `/sessions`, see an enrollment with five Teacher-No-Shows marked and still confirmed,
and on `/users` the teacher's record listing it; restore the ended enrollment (its sessions back from the nearest week
at least 24 hours away, its remedies offered again, its case closed «restored») and try a restore after the window
(`RESTORE_REFUSED`, `window_closed`), and one after moving the slot to another hour while the enrollment was
closed (`slot_changed`). On `/sessions`, read an enrollment's timeline and a settled session's telemetry, and correct an undisputed outcome
inside its window (its remedy offered only after the window). Open a case manually from `/cases` on a completed
enrollment for the teacher, and from
`/sessions` on an enrollment with an open make-up, handing that remedy to the student's case (the make-up's reserved
time free again in booking). The audit log shows one entry per action with its reason.

## 7. Chat (US7)

Send text, a PDF, a text file, a photo, a photo renamed `.pdf`, and a PDF renamed `.jpg`: only the documents arrive; an
attachment opens through a link that stops working after `document_link_ttl_seconds`. With the clock of a test
enrollment past its last dispute window plus the retention (`chat_retention_days`, 30 by default), `purge-chat` empties the messages and keeps the rows; with
a dispute open it keeps them.

## 8. The register and the close

Each batch records its run in its tasks' notes, with the outputs kept (the owner's rule of 2026-11-01). The phase
closes with a run of §1 to §7 on the last batch's commit, the carried tasks checked (T059, `002:T144`, T090, the
notes under T026 and T082; T107 was done in the cycle, `9c710e3`), and PLAN.md's Phase 3 section given its
close date.
