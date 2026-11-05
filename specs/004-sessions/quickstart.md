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
  and `pnpm db:seed` (the five new settings; the panel and the jobs fail closed on a missing one).
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

## 1. The machines first (SC-403 to SC-413)

```text
pnpm typecheck && pnpm lint                       # no-money-vocabulary over sessions and chat; R-TIME-1; R-GENDER-4/5
pnpm test                                         # unit, contract, the double-run specs of the four new jobs
pnpm test:db-integrity                            # rules 40–47, the lock paths, the make-up and hold races
pnpm test:adversarial                             # every Phase 3 procedure, both directions, token replay
pnpm contract:snapshot --check --base origin/develop
pnpm check:authz && pnpm check:i18n
pnpm --filter @ijazah/time test                   # the interval operations' properties
```

Expected:

- With the video stand-in harness ([contracts/video.md](./contracts/video.md)): each row of SRS §3.7.5's table reached
  from signed events alone; a mid-session disconnect and reconnection sums its overlaps (SC-402); a session with no
  final leave settles within the evaluation delay plus one minute (SC-403); the threshold termination at the second
  Teacher-No-Show cancels the rest and opens one case (SC-404); an event delivered 100 times leaves one row and the same
  outcome, and the job run twice leaves the same records (SC-405); a wrong or missing signature, or a body changed after
  signing, is refused with nothing written (SC-406).
- The adversarial suite refuses a token for the other gender, a non-participant, another session's id, a teacher
  suspended, revoked or banned, and outside the join period, in both directions, and after an administrator's gender
  correction (SC-407).
- The image corpus (`tests/fixtures/chat-corpus/`: every image type the sniffer names, an image renamed `.pdf` or
  `.txt`, a PDF renamed `.png`, a text file with a binary byte) is refused; PDFs and UTF-8 text are accepted (SC-408).
- The boundary and schema gates find no price, payment or amount in `modules/sessions` or `modules/chat` (SC-409).
- Every unconsumed outcome owes one remedy; every refund opens one case with no amount; every booked make-up extends the
  enrollment's end and its slot's release (SC-410). No proposal, counter option or reserved time starts before the
  window it waits on (research R-320).
- No request is pending after the start, and an answer at or after it changes nothing (SC-411).
- A teacher's suspension, revocation, ban or deletion and a student's deletion leave no token issuable and the
  remaining sessions cancelled with their cases, in one transaction (SC-412).
- Every administrator action writes one audit entry with its reason; none writes a payment, an amount or a
  confirmation (SC-413).

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
re-create the room (research R-313); and that webhooks are delivered on the free plan (not stated in LiveKit's pricing).

## 4. On two phones over mobile data (SC-401, SC-414) — the owner's run

On the vivo and the realme, Etisalat mobile data, the development build:

1. As the teacher and the student, open the session inside the lead: the pre-session screen names the other person,
   the length, the start in both zones, the microphone and camera state, camera off (FR-434).
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
proposal, in a week starting no earlier than the choice window plus 72 hours; counter-propose one of the teacher's
slots (none offered before the later of now + 72 hours and the choice window's end); the teacher declines it,
counter-propose again (a second one refused while the first is pending), and the teacher accepts; on another remedy,
accept the proposal while a counter-proposal is pending (the counter withdrawn, its time offered to others again); let
a choice window pass with nothing pending (the proposal booked), and an answer window pass (a refund case with no
amount), once inside the choice window and once after it. On a recitation enrollment after a Teacher-No-Show: choose a
refund.

## 6. The administrator (US5, US6)

In the panel: raise a dispute from the phone and resolve it each way; resolve an Under-Threshold session and a
Provider-Outage one; record an outage window over a settled session (it moves to the review queue); cancel a session
(one case); resolve and dismiss a case (its closing instant is the database's); suspend a student (sessions cancelled, the enrollment still
confirmed, a case), reinstate them and resolve the case (the make-ups offered), suspend another and dismiss its case
(the enrollment cancelled); ban a student (sessions and enrollments cancelled, a case); open a user's record (the cancellation-request counts); read a dispute's chat (one `chat.read`
audit entry per read). The audit log shows one entry per action with its reason.

## 7. Chat (US7)

Send text, a PDF, a text file, a photo, a photo renamed `.pdf`, and a PDF renamed `.jpg`: only the documents arrive; an
attachment opens through a link that stops working after `document_link_ttl_seconds`. With the clock of a test
enrollment past its last dispute window plus the retention, `purge-chat` empties the messages and keeps the rows; with
a dispute open it keeps them.

## 8. The register and the close

Each batch records its run in its tasks' notes, with the outputs kept (the owner's rule of 2026-11-01). The phase
closes with a run of §1 to §7 on the last batch's commit, the carried tasks checked (T059, `002:T144`, T090, T107, the
notes under T026 and T082), and PLAN.md's Phase 3 section given its close date.
