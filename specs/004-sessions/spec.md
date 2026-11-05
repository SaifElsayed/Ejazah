# Feature Specification: Phase 3 — Live sessions

**Feature Branch**: `004-sessions`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Phase 3 of PLAN.md: Live sessions (specs/004-sessions), T106"

## Overview

**Objective, from PLAN.md**: run a session end to end and settle its outcome
from evidence, not from the client.

Phase 2 left a confirmed enrollment with its sessions written as local date,
local start and zone, and both people able to see them. Phase 3 makes a session
happen. Inside the early-join lead before its start, each participant opens a
pre-session screen, receives a token the server minted for that session and
that participant alone, and meets the other in a one-to-one room with audio,
an optional camera and an optional screen share. The video provider's signed
webhooks, and nothing the phone says, record who was connected and when. After
the scheduled end a scheduled job, not a webhook, settles the session into one
of six outcomes by the SRS's table, counts a teacher's absences toward the
enrollment's threshold, and terminates the enrollment when the threshold is
reached. A session not consumed is owed back as a make-up session, or on a
recitation package after the teacher's absence as a refund that an
administrator decides. Either party may ask to cancel a session, and only the
other's acceptance makes it free of cost. Either party may dispute a session, from
its scheduled end until the dispute window closes, and an administrator resolves disputes,
the sessions the job could not settle, and the compensation cases that every
termination opens. The two participants chat inside their enrollment and
exchange documents, never images, and the chat is purged when the enrollment's
last dispute window has closed.

This is the phase in which the gender rule reaches the video room
(R-GENDER-7), attendance becomes the evidence every later outcome rests on
(R-SESS-1), and the platform's money rule is tested hardest: a session's
outcome changes what a student is owed, and still no code of this phase
computes, holds or moves an amount (ADR 0007, FR-DISPUTE-6, FR-MAKEUP-6).

**Who builds it, and how big it is.** As Phases 1 and 2, the owner working
alone with Saif's review session reviewing every batch. The scope is the SRS
ids PLAN.md lists for Phase 3 (FR-SESS-1…19, FR-NOSHOW-1…6, FR-CANCEL-1…7,
FR-MAKEUP-1…6, FR-DISPUTE-1…4), the decisions PLAN.md carries into the phase
(FR-DISPUTE-5/6's administrative compensation, ADR 0009 D5's two times,
FR-AUTH-14's confirmed part, `StandingService`), and the admin surfaces those
requirements cannot work without (FR-ADMIN-6, FR-ADMIN-7 and FR-ADMIN-14), and the user directory of
FR-ADMIN-4, which no phase owned (the owner's decision of 2026-11-05).
Seven working days from day 17; the cycle runs on day 16, 2026-11-05, inside
Phase 2's days, which closed early (`specs/003-booking/tasks.md`, T106).
Whatever cannot fit is stated when it is found and goes to the descope ladder
with its cause; this phase's own rung is in-session file sharing, which goes
before text chat (PLAN.md, "Descope ladder").

**Carried into this phase.** `specs/003-booking/tasks.md` times T059
(FR-AUTH-14's confirmed part) in this phase's first batch, and
`specs/002-identity/tasks.md` times T144 (every suspension and ban through
`StandingService`) for this phase's plan to name; the note under T082 of
`specs/003-booking/tasks.md` says how the closing of a compensation case is
written, and the notes under T026 (PR #117's review, nits 5 and 6) say what a
make-up and a completed enrollment do to a slot. Those tasks keep their ids and
their text there; this specification requires their outcome where a
requirement here depends on it (FR-420 to FR-426). The rest of the
"Not scheduled" row of `specs/003-booking/tasks.md` is reviewed by this cycle
and stays where it is unless the plan times it.

**Scope boundary.** This phase delivers the video adapter behind the port, the
token and the join period, the pre-session screen, the room, attendance from
signed provider webhooks, the evaluation job and the whole session state
machine, the four no-show outcomes and the threshold termination, cancellation
by agreement and by an administrator, make-up sessions and the refund case,
session disputes, the session review queue, the compensation-case queue, the
consequences on sessions of an account's end, and chat with documents. It
delivers no review, no certificate, no user report (FR-SESS-15), no
notification centre, no push and no reminder: those are Phase 4's. It delivers
no money: no amount is computed, stored or moved by this phase, no commission
(T104) and no release of a teacher's share (T105). A control whose action
belongs to a later phase is absent from this phase's screens, never shown
disabled (R-MOBILE-13).

**Provenance.** Every requirement traces to a line in PLAN.md's Phase 3
deliverables, definition of done or decisions carried out there, to an SRS id,
to ADR 0003, ADR 0007, ADR 0009, ADR 0010, ADR 0015 or ADR 0018, to a table or
rule of `docs/ERD.md`, to a rule of the constitution, or to a follow-up in
`specs/002-identity/tasks.md` or `specs/003-booking/tasks.md`. Requirements
come from the SRS, never from the design boards; a behaviour drawn only on a
board is a question for the owner, not a requirement here. What earlier phases
built (the caller kinds, the guards, the settings, `packages/time`, the
consequences entry and `StandingService`, `openCompensationCase`, the upload
port and its content sniffing, the audit log, the admin shell) is named as
given, never re-specified.

**Numbering.** Phase 1 numbers from FR-101 and SC-101, Phase 2 from FR-301 and
SC-301; Phase 2's requirements run to FR-414. This specification numbers its
requirements from FR-420 and its success criteria from SC-401, so that no
citation collides with Phase 2's FR-400 to FR-414.

## Clarifications

### Session 2026-11-05

- Q: Before Phase 4's notifications exist, are the screens the notice for this phase's events? → A: Yes. The screens are the notice, and every event is kept as a durable record that Phase 4's notifications read with no change to this phase's code, as Phase 2 decided for payments (FR-495).
- Q: Does this phase add a student's suspension and ban to `StandingService`? → A: Yes, exactly as FR-ADMIN-5 states: suspending a student cancels every upcoming session and opens a compensation case pending the review; banning a student cancels all upcoming sessions and owes nothing unless the administrator decides otherwise in the case. All of it goes through `StandingService` (FR-421, FR-486).
- Q: How is a video provider outage recorded, so that a session can be settled Provider-Outage? → A: An administrator records the outage window in the panel, audit-logged; the evaluation job reads it; sessions it overlaps that were already settled and are still inside their dispute window move to the session review queue (FR-445).
- Q: Do gender disputes and their consequences on enrollments (FR-GENDER-3 to FR-GENDER-7, FR-ADMIN-8) land in this phase? → A: No. They land in Phase 4, with user reports; Phase 2's two sentences that gave them to Phase 3 are corrected.
- Q: How is a make-up placed when the student does not answer or counter-proposes? → A: *(Superseded by decision 9 of the plan and by the decisions on the analysis below: a decline no longer falls back to the system's proposal at once while the choice window is open, the proposal starts no earlier than the choice window plus one answer window plus the first-session lead, and FR-463 to FR-466 govern.)* Within the choice window (7 days, an admin setting) the student accepts the system's proposal or counter-proposes one of the teacher's active availability slots. The teacher answers a counter-proposal within a new admin setting, «Make-up counter-proposal answer window (hours)», default 72, counted from the counter-proposal even when it came on the choice window's last day. An explicit decline falls back to the system's proposal; no answer makes it a refund of that session, a compensation case with no amount, on either track (the one exception to the ijazah track's make-up-only remedy). Both times stay reserved until the teacher answers or the window ends, and no make-up starts before then. SRS FR-MAKEUP-2 to FR-MAKEUP-4 are amended to say so (FR-463, FR-465, FR-466).
- Q: What happens to a remedy already offered when a dispute changes the session's outcome? → A: A remedy (make-up or refund) is offered only once the outcome is final: the dispute window closed with no dispute, or an administrator resolved the dispute; the choice window counts from then, so no remedy is offered and then withdrawn. SRS FR-MAKEUP-1 and FR-MAKEUP-4 are amended to say so (FR-462 to FR-466).
- Also decided on 2026-11-05: T090 (a deleted party's name) lands in this phase (FR-426); a teacher's deletion cancels their enrollments `account_deleted`, and a suspension, revocation or ban `teacher_suspended` (FR-483, FR-484).

### The plan's decisions, 2026-11-05

The owner answered the plan's fourteen points on 2026-11-05 (`plan.md`, "Decisions recorded"). Where an answer changes a requirement above, the requirement now says so; where it replaces part of the clarify session's answers, that is named here.

- A student's suspension leaves the confirmed enrollments `confirmed` and unable to complete while the `student_suspended` case is open; cleared, the student is owed in the same enrollment the remedy FR-MAKEUP-2 gives; the fault confirmed, the enrollment is cancelled `admin`. A ban cancels the confirmed enrollments `admin` at once (FR-449, FR-486; SRS FR-ADMIN-5).
- A Cancelled-By-Agreement session is final at its acceptance: the make-up is offered at once and the session cannot be disputed, the one exception to the wait for the dispute window (FR-462, FR-473; SRS FR-CANCEL-2, FR-DISPUTE-1, FR-MAKEUP-1).
- A declined counter-proposal no longer falls back to the system's proposal at once, as the clarify session had it: while the choice window is open the student may accept the proposal or counter-propose again, one counter-proposal pending at a time; while one is pending the student may accept the proposal, which withdraws it; once the choice window has closed, a decline books the proposal. Neither the proposal nor a counter-proposal may start before the matter could still be decided (FR-464 to FR-466; SRS FR-MAKEUP-3, FR-MAKEUP-4).
- A dispute may be raised from the scheduled end, before the evaluation too (FR-473; SRS FR-DISPUTE-1).
- The chat is read-only once the enrollment has ended; its documents are PDF and UTF-8 text only; its message rate limit (30 per 60 s), its page size (50) and the cancellation requests' recent period (30 days) are admin settings (FR-459, FR-488, FR-489, FR-491; SRS FR-SESS-6, FR-SESS-7, §3.14).

### The analysis's decisions, 2026-11-05

The owner answered the analysis of the spec, plan and tasks on 2026-11-05 (`plan.md`, "Decisions on the analysis"). Where an answer changes a requirement, the requirement now says so; where it changes a decision above, it is named here.

- A suspended student cleared is owed, for each session the suspension cancelled, what a Teacher-No-Show owes, since the fault was not theirs: on a recitation enrollment a make-up session or a refund at their choice, on an ijazah-track enrollment a make-up session. This replaces the first decision above's "a make-up on either track" (FR-463, FR-486; SRS FR-ADMIN-5).
- A remedy already offered to a student who is then suspended is frozen: a pending counter-proposal is withdrawn and its time released, and the system's proposal's reserved time is released too; at reinstatement a new system proposal is offered with a new full choice window and placed under the same window rule. No remedy is offered to a suspended student; one that comes due meanwhile is offered at reinstatement (FR-462, FR-486; SRS FR-ADMIN-5).
- No make-up starts within the first-session lead (§3.14 «First session lead after confirmation», 24 hours) of the moment it is decided; the system's proposal also avoids every occurrence that overlaps an open payment window of either party; the answer window and the lead are fixed at the proposal's offer (FR-464 to FR-466; SRS FR-MAKEUP-3).
- A remedy is offered only on a confirmed enrollment; a session owed on an enrollment that ended is covered by the compensation case that ending opened, and a student's deletion, which opens none, closes every open make-up remedy with nothing owed (FR-462, FR-478, FR-484).
- No dispute over any cancelled session, by agreement or by an administrator (FR-473; SRS FR-DISPUTE-1).
- The user directory of FR-ADMIN-4 enters this phase (FR-481), and `student_suspended` cases head the compensation-case queue (FR-478).

## User Scenarios & Testing _(mandatory)_

The people served by this phase are a student and a teacher meeting for their
lesson, and an administrator settling what the evidence could not. Each story
is independently demonstrable and names the PLAN.md deliverables it covers.

### User Story 1 - A teacher and a student meet in a live session (Priority: P1)

Within the early-join lead before a session's start, the student and the
teacher each open the session from their enrollment. A pre-session screen
names the other person, the scheduled length, the time in the session's zone
and in their own, and their own microphone and camera state. They enter a
one-to-one room: both always have audio, and each may turn a camera or a
screen share on or off at any time. A dropped connection on mobile data
rejoins the same room with no loss to either person's attendance.

_Covers PLAN.md: "Video adapter behind the port", "Server-side token minting
and join window", "Session room: audio, camera, screen share", "Pre-session
confirmation screen"._

**Why this priority**: It is the product's lesson itself; nothing else of the
phase has evidence to settle until a session can happen.

**Independent Test**: With the video port's stand-in, open a session inside
and outside the join period as each participant, as the other enrollment's
participants, and as an opposite-gender account, and check that only the two
participants receive a token, inside the period only. On two Android phones
over mobile data, hold a session with the provider, switching networks in the
middle.

**Acceptance Scenarios**:

1. **Given** a scheduled session, **When** a participant opens it earlier than the early-join lead before its start, **Then** no token is issued and the screen says when joining opens, in the session's zone and the viewer's (FR-SESS-14, ADR 0009 D5).
2. **Given** the join period has opened, **When** a participant asks to join, **Then** the server checks from its own records that both participants are of the same gender, that the session is scheduled and theirs, and that the teacher may teach, and only then mints a token bound to that session and that participant (FR-SESS-2, FR-SESS-3, R-GENDER-7, R-SESS-5).
3. **Given** a token minted for one session, **When** it is presented for another session or by another participant, **Then** the provider admits nobody with it (FR-SESS-3).
4. **Given** the pre-session screen, **When** it opens, **Then** it shows the counterparty's name, the scheduled length, the start in the session's zone and in the viewer's, and the viewer's own microphone and camera state, with the camera off unless the viewer turns it on (FR-SESS-5, §3.7.2, ADR 0009 D5).
5. **Given** the room, **When** either participant turns their camera or screen share on or off, **Then** it takes effect for them alone, with no permission asked of the server and nothing recorded against the session (§3.7.2).
6. **Given** a participant whose connection drops, **When** they reconnect before the scheduled end, **Then** they return to the same room with a token for the same session, and their connected time continues to accumulate (FR-SESS-18, R-SESS-4).

---

### User Story 2 - The session's outcome is settled from evidence (Priority: P1)

The provider's signed webhooks record each participant's joins and leaves. A
scheduled job runs after the scheduled end, whether or not the last webhook
arrived, and settles the session: Done, Student-No-Show, Teacher-No-Show,
Both-No-Show, or, for the administrator, Under-Threshold or Provider-Outage. A
Done or Student-No-Show session is consumed; a teacher's absence counts toward
the enrollment's threshold, and at the threshold the enrollment's remaining
sessions are cancelled, the enrollment is terminated and a compensation case
opens. When every session of an enrollment is settled and nothing is owed
back, the enrollment is completed.

_Covers PLAN.md: "Attendance webhooks into participant events", "Idempotent
webhook handling", "Evaluation job at scheduled end plus two minutes", "Full
session state machine", "Simultaneous time accumulated across reconnections",
"All four no-show outcomes"._

**Why this priority**: It is the second half of the phase's objective, and the
evidence every remedy and dispute reads (R-SESS-1).

**Independent Test**: With the video port's stand-in, deliver signed
participant events for each row of SRS §3.7.5's table — including a mid-session
disconnect and reconnection, an event delivered twice, events out of order, a
missing final leave event and a bad signature — let the evaluation job run, run
it again, and check each outcome, the no-show count and the termination at the
threshold.

**Acceptance Scenarios**:

1. **Given** a provider webhook, **When** its signature does not verify on the raw body, **Then** it is refused before any handler runs and nothing is written (R-SESS-1, R-SESS-7; the constitution's R-MONEY-9 pattern, as ARCHITECTURE §12's video signature alert assumes).
2. **Given** a participant event delivered twice, **When** both deliveries are handled, **Then** one event is recorded and the accumulated time is unchanged by the second (ERD §15 rule 4, R-API-14).
3. **Given** a session whose scheduled end has passed by the configured evaluation delay, **When** the job runs, **Then** it settles the session by SRS §3.7.5's table from the recorded events alone, even when the final leave event never arrived; run twice, it equals one run (FR-SESS-10, R-SESS-2, R-SESS-3, R-API-14).
4. **Given** both participants connected together for at least the attendance threshold of the scheduled length, counted across reconnections, **When** the session is evaluated, **Then** it is Done and consumed, and the enrollment's remaining count is one less, derived and never stored (FR-SESS-11, FR-SESS-12, FR-SESS-18, R-DB-4).
5. **Given** the teacher joined and the student did not, **When** evaluated, **Then** it is Student-No-Show and consumed; **given** the student joined and the teacher did not, **Then** it is Teacher-No-Show, not consumed, and counted against the teacher; **given** neither joined, **Then** it is Both-No-Show, not consumed, with no count against either (FR-NOSHOW-1, FR-NOSHOW-2, FR-NOSHOW-6).
6. **Given** both joined but together for less than the threshold, or a provider outage recorded over the session, **When** evaluated, **Then** it is Under-Threshold or Provider-Outage, its outcome is frozen and it waits in the administrator's review queue; nothing settles it automatically (FR-SESS-19, R-SESS-6).
7. **Given** an enrollment whose teacher's absences reach the configured threshold, **When** the last of them is settled, **Then** in one transaction its remaining sessions are cancelled by admin, the enrollment is Terminated-No-Show and one compensation case opens on it (FR-NOSHOW-3, FR-NOSHOW-4, FR-DISPUTE-5).

---

### User Story 3 - Either party asks to cancel, and only agreement makes it free (Priority: P2)

A student or a teacher asks to cancel an upcoming session, with a reason. The
other sees the request on the enrollment and accepts or declines it. Accepted,
the session is Cancelled-By-Agreement and a make-up session follows; declined,
or unanswered by the scheduled start, the session stands and ordinary
attendance applies. An administrator may cancel any session, with a reason.

_Covers PLAN.md: "Cancellation by mutual agreement"._

**Why this priority**: The SRS's symmetric cancellation is the only way a
session is released without cost, but a session can run and settle without it.

**Independent Test**: Request, accept, decline and let expire a cancellation
from each side; cancel a session as an administrator; check each status, the
make-up that follows an acceptance, the compensation case that follows the
administrator's cancellation, and the requests counted on each user's
administrative record.

**Acceptance Scenarios**:

1. **Given** an upcoming session, **When** either participant requests its cancellation with a reason, **Then** the request is pending and the other participant sees it with Accept and Decline (FR-CANCEL-1).
2. **Given** a pending request, **When** the counterparty accepts it before the scheduled start, **Then** the session is Cancelled-By-Agreement, no penalty is recorded, both parties' time is freed, and a make-up session is proposed at once; the session's outcome is final and it cannot be disputed (FR-CANCEL-2 and FR-MAKEUP-1 as amended on 2026-11-05, ADR 0010).
3. **Given** a pending request, **When** the counterparty declines it, or the scheduled start arrives with no answer, **Then** the request is declined or expired and the session stands under ordinary attendance (FR-CANCEL-3, FR-CANCEL-4).
4. **Given** any session not yet settled, **When** an administrator cancels it with a mandatory reason, **Then** it is Cancelled-By-Admin, no penalty is recorded, one compensation case opens on the enrollment, and the action is audit-logged (FR-CANCEL-6, FR-DISPUTE-5, FR-ADMIN-17).
5. **Given** a user who requests cancellations repeatedly, **When** an administrator opens that user's record, **Then** the count of their cancellation requests is shown as a trust signal (FR-CANCEL-5).
6. **Given** a student, **When** they look for a way to cancel a whole enrollment, **Then** there is none (FR-CANCEL-7, SRS §13).

---

### User Story 4 - A session not consumed is made up, or refunded by a case (Priority: P2)

After a Teacher-No-Show, a Cancelled-By-Agreement or a Both-No-Show, the
student is owed the session back. On a recitation enrollment after the
teacher's absence, or after a suspension the administrator cleared, the student chooses a make-up session or a
refund; in every other case the remedy is a make-up. Once the session's outcome is final (its dispute window closed, or
a dispute resolved; a cancellation by agreement at its acceptance), the system proposes the enrollment's weekly
slot in the first free week after its last session that starts no earlier than the choice window's close
(`choice_closes_at`) plus the counter-proposal answer window plus the first-session lead, both fixed at the offer
(72 and 24 hours by default), and overlaps no open payment window of either party;
the student accepts or counter-proposes one of the teacher's available
slots, which the teacher accepts or declines within that answer window (no answer makes it a
refund case, on either track); after a decline the student may counter-propose again while the choice window is
open, and may accept the proposal at any time before it closes, even with a counter-proposal pending; with nothing
pending when the choice window ends, the proposal is booked. A refund opens a compensation case with no amount.

_Covers PLAN.md: "Make-up sessions: a session not consumed is made up or
refunded by an admin-decided case that carries no amount (ADR 0018 D2 to D4)"._

**Why this priority**: All sessions are generated at payment, so without it a
session not consumed leaves a paid lesson with no date (SRS §3.8.5); but it
follows an outcome, which Stories 2 and 3 produce.

**Independent Test**: Produce each unconsumed outcome on a recitation and an
ijazah-track enrollment; choose, accept, counter-propose (accepted and
declined), and let the choice window pass; check the make-up session's number,
its link to the session it makes up, the enrollment's new end and slot
release, and the refund case's lack of any amount.

**Acceptance Scenarios**:

1. **Given** a session settled Teacher-No-Show on a recitation enrollment, **When** the student opens it, **Then** they choose a make-up session or a refund; on an ijazah-track enrollment, and for Cancelled-By-Agreement and Both-No-Show on any track, the remedy is a make-up session with no choice; Student-No-Show owes nothing (FR-MAKEUP-1, FR-MAKEUP-2, ADR 0018 D2).
2. **Given** a make-up is owed, **When** it is proposed, **Then** the proposal is the enrollment's weekly slot in the week after its last session, or the first later week in which that slot is free for the teacher and the student, in the enrollment's snapshot zone, overlapping no session, reservation or open payment window of either party, and never one starting before `choice_closes_at` plus the counter-proposal answer window plus the first-session lead, the two fixed at the offer (FR-MAKEUP-3 as amended, R-TIME-2).
3. **Given** a proposal, **When** the student counter-proposes one of the teacher's active availability slots, **Then** the teacher accepts it within the counter-proposal answer window, and it is booked, or declines it, its time is released and, while the choice window is open, the student may accept the proposal or counter-propose again (one pending at a time), the proposal being booked if the choice window has closed; **given** no answer by the end of that window, **Then** the session becomes a refund, one compensation case with no amount, on either track (FR-MAKEUP-2 and FR-MAKEUP-3 as amended).
4. **Given** a proposal with no answer from the student and no counter-proposal pending, **When** the configured choice window ends, **Then** the proposed make-up session is booked; **given** a counter-proposal pending then, **Then** the teacher's answer decides, within its answer window (FR-MAKEUP-4 as amended).
5. **Given** a make-up session booked, **Then** it is an ordinary session of the enrollment, numbered after its last session, recording the session it makes up, extending the enrollment's end and its slot's release, and the original session keeps its outcome (FR-MAKEUP-5, ADR 0018 D3).
6. **Given** the student chooses a refund, **Then** one compensation case opens on the enrollment for that session, carrying no amount, and nothing in the platform computes a share of a price (FR-MAKEUP-6, ADR 0018 D4, ADR 0007).
7. **Given** a session settled Teacher-No-Show and still inside its dispute window, **Then** no remedy is offered yet; **when** the window closes with no dispute, or an administrator resolves a dispute, **Then** the remedy the final outcome owes is offered and the choice window starts, and a resolution to Student-No-Show offers nothing (FR-MAKEUP-1 and FR-MAKEUP-4 as amended).
8. **Given** a counter-proposal pending, **When** the student accepts the system's proposal, **Then** the proposal is booked and the counter-proposal is withdrawn, its time offered to others again (FR-465; the owner's decision of 2026-11-05).
9. **Given** a remedy offered and open, **When** the student's account is suspended, **Then** the remedy is frozen, a pending counter-proposal withdrawn and both reserved times released; **when** the account is reinstated, **Then** a new proposal is offered with a new full choice window under FR-464's rule (FR-486; the owner's decision of 2026-11-05).
10. **Given** an open make-up remedy, **When** the student deletes their account, **Then** the remedy lapses with nothing owed and no case; a refund already chosen keeps its case open (FR-484; the owner's decision of 2026-11-05).

---

### User Story 5 - An administrator settles what the evidence could not (Priority: P2)

Either party may raise a dispute over a session from its scheduled end until
the dispute window closes, never over a cancelled one; the session is marked Disputed and its outcome frozen. The
administrator sees disputes with the session's attendance telemetry and the
enrollment's chat, sees the sessions the job could not settle, and sees the
compensation cases every termination opens, and resolves each with a binding
decision and a reason, audit-logged. Ordering compensation records the
decision; Platform Administration executes it outside the platform.

_Covers PLAN.md: "Admin review queues for under-threshold and outage", and the
decision "Compensation is an administrative matter outside the code path"._

**Why this priority**: Under-Threshold, Provider-Outage and disputes are
frozen until an administrator acts, and every termination's case waits for
one; a session can happen and settle without them.

**Independent Test**: Raise a dispute inside and outside the window; resolve it
each way; resolve an Under-Threshold and a Provider-Outage session; resolve and
dismiss a compensation case; check the session's final outcome, the no-show
count, the audit entries, and that no amount is computed, stored or moved.

**Acceptance Scenarios**:

1. **Given** a session past its scheduled end, settled or not yet evaluated, within the configured dispute window, and not cancelled, **When** either participant raises a dispute with a reason, **Then** the session is Disputed and its outcome — consumed or not, and any no-show attribution — is frozen until resolution, even past the window; after the window, and over a cancelled session, by agreement or by an administrator, at any time, no dispute may be raised (FR-DISPUTE-1 as amended, FR-DISPUTE-4).
2. **Given** an open dispute, **When** the administrator opens it, **Then** they see the session's schedule, every recorded join and leave, the accumulated simultaneous time and, as permitted, the enrollment's chat, and the opening of the chat is audit-logged (FR-DISPUTE-2, FR-SESS-9, FR-SESS-13, FR-ADMIN-17).
3. **Given** an open dispute, **When** the administrator resolves it — upholding the outcome, re-marking the session consumed or not consumed, recording a no-show against either party, ordering compensation, or suspending or banning a party — with a mandatory reason, **Then** the decision is binding, recorded and audit-logged, and ordering compensation moves no money (FR-DISPUTE-3, FR-DISPUTE-6).
4. **Given** a session in Under-Threshold or Provider-Outage, **When** the administrator resolves it with an outcome and a reason, **Then** the session takes that outcome, with what that outcome brings (a count, a remedy), and the action is audit-logged (FR-SESS-19, FR-ADMIN-14).
5. **Given** an open compensation case, **When** the administrator resolves or dismisses it with a note of what Platform Administration did outside the platform, **Then** the case closes at the database's own instant, after the enrollment's row is locked, and carries no amount (FR-DISPUTE-5, FR-DISPUTE-6, FR-ADMIN-7; the note under T082).

---

### User Story 6 - The account's end reaches its sessions (Priority: P2)

When a teacher is suspended, revoked or banned, or deletes their account, they
can no longer join any session, their remaining sessions are cancelled and each
affected enrollment gets a compensation case. When a student deletes their
account, their remaining sessions and confirmed enrollments are cancelled with
no case. When a student is suspended, their upcoming sessions are cancelled, their
enrollments stay confirmed and a compensation case waits for the review: cleared,
they are owed in the same enrollment what a teacher's absence owes (on a recitation
enrollment a make-up or a refund at their choice, on the ijazah track a make-up); at fault,
the enrollment is cancelled. A remedy they were already offered is frozen while the suspension
lasts and offered again, with a full choice window, at reinstatement. When banned, their sessions and enrollments are cancelled and nothing
is owed unless the administrator decides otherwise. Every suspension
and ban goes through `StandingService`.

_Covers PLAN.md's decisions: FR-AUTH-14's confirmed part (T059) and
`StandingService` (T144)._

**Why this priority**: T059 is timed for the phase's first batch (FR-420), so
its priority is not the order it is built in; the story itself is P2 because a
session can happen before it, but a suspended teacher must never join one
(R-SESS-5).

**Independent Test**: Suspend, revoke and ban a teacher with sessions scheduled
and one in progress; delete a teacher's and a student's account with confirmed
enrollments; check tokens refused, sessions cancelled, the enrollments' status
and reason, and one case per affected enrollment, each change in the action's
own transaction.

**Acceptance Scenarios**:

1. **Given** a teacher suspended, revoked or banned, **When** they ask to join any session, scheduled or in progress, **Then** no token is issued and they are removed from a room they are in (FR-SESS-16, R-SESS-5).
2. **Given** that action, **Then** in the same transaction every remaining scheduled session of theirs is Cancelled-By-Admin, freeing both parties' time, and one compensation case opens per affected enrollment (FR-SESS-16, FR-DISPUTE-5, ADR 0010).
3. **Given** a student who deletes their account, **Then** their remaining sessions are Cancelled-By-Admin and their confirmed enrollments cancelled with `account_deleted`, with no compensation case; **given** a teacher who deletes theirs, **Then** FR-SESS-16's effect applies, compensation cases included, their enrollments cancelled with `account_deleted` (FR-AUTH-14, ADR 0015, T059).
4. **Given** a student suspended, **Then** every upcoming session of theirs is Cancelled-By-Admin at that moment, each confirmed enrollment stays confirmed and one compensation case opens on it pending the review; **when** the case clears the student, **Then** each cancelled session is owed in the same enrollment what a Teacher-No-Show owes (on a recitation enrollment a make-up or a refund at the student's choice, on an ijazah-track enrollment a make-up), and **when** it confirms the fault, **Then** the enrollment is cancelled `admin`; **given** a student banned, **Then** all their upcoming sessions and confirmed enrollments are cancelled `admin` at once and nothing is owed unless the administrator decides otherwise in the case; both go through `StandingService` (FR-ADMIN-5 as amended, ADR 0018 D5).

---

### User Story 7 - The two participants chat and exchange documents (Priority: P3)

From confirmation, the student and the teacher of an enrollment exchange text
messages and documents (PDF and UTF-8 text), never an image; once the enrollment
has ended, the chat is read-only. An administrator can
read the chat only for an open dispute (or, from Phase 4, an open report). The
chat is purged once the enrollment is ended and its last dispute window, plus
the configured retention, has passed with nothing open.

_Covers PLAN.md: "In-session chat with document attachments", "Image rejection
by server-side content sniffing", "Chat retention and purge job"._

**Why this priority**: It supports the lesson but is not the lesson; the
descope ladder cuts in-session file sharing before text chat.

**Independent Test**: Send text, a PDF, a text file, an image, an image renamed
with a document's extension, and a document given an image's content; check
that only the documents are accepted, that attachments are served through
expiring links, and that the purge job empties the messages at the right
instant and not while a dispute is open.

**Acceptance Scenarios**:

1. **Given** a confirmed enrollment, **When** either participant sends a text message or a document, **Then** only the other participant of that enrollment receives it, and an attachment is served only through a signed, expiring link (FR-SESS-6, FR-SESS-7, R-SEC-3).
2. **Given** a file that is an image by its extension or by its content, **When** it is sent, **Then** it is refused, whatever the pairing (FR-SESS-8, R-SEC-4, R-SEC-5).
3. **Given** an enrollment ended and its last session's dispute window closed, plus the configured chat retention, with no open dispute or compensation case on it, **When** the purge job runs, **Then** every message's body and attachment are removed and the rows are kept as purged (FR-SESS-13, ERD §15 rule 8).

---

### Edge Cases

- The last participant event of a session is a join with no leave (the leave webhook was lost): the evaluation counts that connection until the provider's room-ended event or the scheduled end, whichever is first, never past the scheduled end (FR-SESS-9, R-SESS-2).
- A participant event arrives after its session was settled: it is recorded with its provider id and changes nothing; only an administrator's resolution changes a settled outcome (R-SESS-6, FR-DISPUTE-3).
- A participant connects in the early-join lead before the start: connected time before the scheduled start counts toward having joined but not toward the simultaneous time, which is counted only between the scheduled start and end (FR-SESS-14, FR-SESS-17, FR-SESS-11).
- A cancellation request is pending when the other party also requests: there is at most one pending request per session; the second party answers the first instead (FR-CANCEL-1).
- A cancellation request is accepted in the same moment the start passes: the start decides; a request answered at or after the scheduled start is expired and the session stands (FR-CANCEL-4).
- The make-up proposal's week falls before the choice window plus one answer window plus the first-session lead would end (the unconsumed session was among the last): the proposal moves to the first free week after that moment (FR-464); it never starts before the matter could still be decided, a counter-proposal made at the choice window's last moment included, nor within the lead of that decision.
- An administrator changes the counter-proposal answer window or the first-session lead while a remedy is open: the remedy keeps the values it was offered with, so no answer window runs past its proposal's start (FR-464; the owner's decision of 2026-11-05).
- The proposal's week overlaps a payment window (an unexpired hold) of the teacher or the student: that week is skipped, as the counter options skip it (FR-464).
- A session settles Teacher-No-Show after its enrollment was terminated, cancelled by a teacher's end or by a student's ban: no remedy is offered on an ended enrollment; the case that ending opened covers the session (FR-462, FR-478).
- A student is suspended with a remedy open: it is frozen and offered again, with a full choice window, at reinstatement; a remedy that comes due while they are suspended waits for the reinstatement (FR-486).
- A counter-proposal is pending when the choice window ends: the teacher's answer decides within its answer window (accepted: booked; declined: the proposal booked; silence: a refund case), so a remedy is decided at the latest 7 days + 72 hours after its offer (FR-466).
- The teacher declines a counter-proposal with the choice window still open: the counter's time is released, and the student may accept the proposal or counter-propose again from options read again at that moment (FR-465).
- A teacher's absence that reaches the threshold leaves make-up sessions booked or proposed: they are cancelled with the rest and their remedies are named in the termination's compensation case (FR-NOSHOW-4).
- A dispute changes a session's outcome (a Teacher-No-Show resolved as a Student-No-Show): no remedy was offered while the outcome could still change, so none is withdrawn; the final outcome decides what is owed (FR-462).
- A dispute is raised between the scheduled end and the evaluation: allowed (FR-DISPUTE-1 as amended on 2026-11-05); the evaluation still records the automatic outcome, frozen under the dispute (FR-DISPUTE-4).
- A setting changes after sessions were settled: the change applies prospectively only and never re-evaluates a settled session (§3.14).
- The time zone data changes between the token and the session: the session's instants are recomputed by Phase 2's job (FR-SESS-20), and the join period and the evaluation read the recomputed instants.
- A student's gender is corrected by an administrator while a session is scheduled: the server's check at token issuance refuses the cross-gender pairing; the enrollment consequences of FR-GENDER-6/7 are Phase 4's (Assumptions).
- An open dispute or compensation case on an ended enrollment: its chat is kept until resolution (FR-SESS-13, FR-AUTH-14).

## Requirements _(mandatory)_

Each requirement names its source. Where a requirement restates an SRS line it
adds only what this phase decides about it. Every number a requirement uses is
a §3.14 setting, named where it is used (R-MONEY-12).

### Functional Requirements

**Carried into this phase**

- **FR-420**: The phase's first batch MUST land T059 of `specs/003-booking/tasks.md`, FR-AUTH-14's confirmed part: a student's deletion cancels their remaining sessions `cancelled_by_admin` and their confirmed enrollments `account_deleted`, with no compensation case; a teacher's deletion has FR-SESS-16's effect (FR-483), compensation cases included, its confirmed enrollments cancelled with `account_deleted` (FR-484) (PLAN.md, Phase 3; the owner's decision of 2026-11-01).
- **FR-421**: Every suspension and ban this phase writes, of a teacher or of a student, the ones a dispute's resolution orders included, MUST go through `StandingService` (T144 of `specs/002-identity/tasks.md`), so that the account's sessions end and the one consequences entry runs on the action's transaction; this phase's session consequences MUST be subscribed to that entry, never called by identity directly (PLAN.md, Phase 3).
- **FR-422**: Closing a compensation case, resolved or dismissed, MUST lock the enrollment's row first and write the case's closing instant with the database's own clock in the same update that closes it, as the note under T082 of `specs/003-booking/tasks.md` states, so that Phase 2's cover rule (FR-362 of `specs/003-booking/spec.md`) reads it.
- **FR-423**: A path that adds or moves an enrollment's final session (a make-up, FR-469) MUST take its slot's lock as Phase 2's `slotInUse` does, and an enrollment that becomes completed MUST free its slot only from the week after its final session plus the configured slot release buffer (FR-BOOK-10, §3.14 "Slot release buffer (weeks)"; the notes under T026 of `specs/003-booking/tasks.md`, PR #117's review, nits 5 and 6).
- **FR-424**: The session code MUST read an enrollment's number and length of sessions from the enrollment's snapshot, never from the package, and nothing in it MAY assume that all of an enrollment's sessions were generated at once (PLAN.md, "After the MVP", the note for Phase 3's cycle).
- **FR-425**: The video adapter MUST be LiveKit's, behind the video port, with the port's stand-in for tests; the places that still name Daily are renamed together in the adapter's task, as ADR 0003's Consequences list them (ADR 0003 D2).
- **FR-426**: Where a participant's account was deleted, every screen of this phase that names them, and the lists Phase 2 built, MUST show a stand-in text instead of an empty name (T090 of `specs/003-booking/tasks.md`; the owner's decision of 2026-11-05).

**Join and the room**

- **FR-430**: All sessions MUST be held in the app through the managed video provider behind the video port; no external meeting link exists (FR-SESS-1, ADR 0003).
- **FR-431**: A token MUST be minted only by the server, only for a participant of a scheduled session, only from the configured early-join lead before the session's start (§3.14 "Early-join lead time (minutes)") until its scheduled end, and bound to that one session and that one participant; a token presented for another session or by another person MUST admit nobody (FR-SESS-3, FR-SESS-14, R-GENDER-7).
- **FR-432**: Before minting, the server MUST check from its own records that both participants are of the same gender, that the teacher's account is active and their approval stands, and that the student's account is active; it MUST refuse otherwise, the refusal to a non-participant being the answer a nonexistent session gets (FR-SESS-2, FR-SESS-16, R-GENDER-1, R-GENDER-7, R-SESS-5).
- **FR-433**: Every participant MUST have audio in every session; camera and screen share MUST be each participant's own choice, off until turned on, and nothing about them MAY be evaluated, stored or minted into a token (FR-SESS-4, §3.7.2).
- **FR-434**: Before entering the room, each participant MUST see a pre-session screen with the counterparty's name, the scheduled length, the start in the session's zone and in the viewer's, and their own microphone and camera state, and MUST be able to grant the microphone there (FR-SESS-5, ADR 0009 D5).
- **FR-435**: A participant whose connection drops MUST be able to rejoin the same session's room until its scheduled end (FR-SESS-18).
- **FR-436**: A room MUST admit at most the session's two participants.

**Attendance evidence and evaluation**

- **FR-440**: Attendance MUST come only from the video provider's webhooks: each webhook MUST have its signature verified on the raw body before any handler runs, and each join and leave MUST be recorded once under the provider's unique, non-null event id with the provider's instant, append-only; a replay MUST be acknowledged with no effect; no client value MAY reach attendance (FR-SESS-9, R-SESS-1, R-SESS-7, R-TIME-6, ERD §15 rules 4 and 21).
- **FR-441**: A session MUST be evaluated by a scheduled job only once its scheduled end has passed by the configured evaluation delay (a §3.14 setting since 2026-11-05, "Session evaluation delay after scheduled end (minutes)", default 2, the constitution's R-SESS-2), never as a webhook reaction, and MUST be evaluated even when no final webhook arrived; the job MUST be idempotent (FR-SESS-10, R-SESS-2, R-SESS-3, R-API-14).
- **FR-442**: A participant MUST count as joined when they have a connection that began no later than the configured join window after the scheduled start (§3.14 "Join window (minutes after start)") and accumulated at least the configured minimum connection duration (§3.14 "Minimum connection duration (seconds)") of connected time between the early-join lead and the scheduled end (FR-SESS-17).
- **FR-443**: Simultaneous connected time MUST be accumulated across every reconnection, only between the scheduled start and the scheduled end, and a connection whose leave was never reported MUST count until the provider's room-ended event or the scheduled end, whichever is first (FR-SESS-18, R-SESS-4).
- **FR-444**: The evaluation MUST settle each session by SRS §3.7.5's table, a recorded provider outage overlapping the session taking precedence over every other row: Done where simultaneous time is at least the configured attendance threshold of the scheduled length (§3.14 "Attendance threshold (%)"); Student-No-Show, Teacher-No-Show and Both-No-Show by who joined; Under-Threshold where both joined below the threshold; Provider-Outage where FR-445 applies (FR-SESS-11, FR-NOSHOW-1, FR-NOSHOW-2, FR-NOSHOW-6).
- **FR-445**: A session overlapping a provider outage MUST be settled Provider-Outage with no no-show counted against either party. LiveKit Cloud sends no outage webhook (ADR 0003), so an outage is recorded by an administrator signed in with the second factor, who enters its window in the panel with a reason, audit-logged; the evaluation job reads the recorded windows; a session the window overlaps that was already settled and is still inside its dispute window moves to the session review queue (SRS §3.7.5; the owner's decision of 2026-11-05).
- **FR-446**: Under-Threshold and Provider-Outage sessions MUST stay frozen in the administrator's session review queue, with no automatic transition out, until an administrator resolves them (FR-SESS-19, R-SESS-6).
- **FR-447**: Done and Student-No-Show MUST consume the session; Teacher-No-Show, Both-No-Show and the two cancellations MUST NOT; the enrollment's remaining and completed sessions and its teacher no-show count MUST be derived from its sessions' outcomes, never stored (FR-SESS-12, FR-NOSHOW-1, FR-NOSHOW-2, FR-NOSHOW-6, R-DB-4).
- **FR-448**: When an enrollment's Teacher-No-Show count reaches the configured threshold (§3.14 "Teacher no-show termination threshold (count)"), its remaining scheduled sessions, make-ups included, MUST be Cancelled-By-Admin, the enrollment set Terminated-No-Show, and one compensation case opened on it naming the remedies left open and the sessions owed but not yet offered a remedy, in one transaction; a session of that enrollment that becomes owed later (its dispute resolved, or its window closing) is covered by the same case and is offered nothing (FR-462, FR-478) (FR-NOSHOW-3, FR-NOSHOW-4, FR-DISPUTE-5; the owner's decision of 2026-11-05).
- **FR-449**: An enrollment MUST become completed when every one of its sessions, make-ups included, has a settled outcome that is not frozen, its last session's dispute window has closed, no `student_suspended` compensation case is open on it (FR-486), and no remedy is owed on it (no remedy awaiting its offer, no make-up awaiting a choice, proposed, counter-proposed, frozen or booked and not yet settled; a refund handed to its compensation case is no longer owed by the enrollment, the case deciding it) (ERD `enrollments.status`; SRS §3.8.5; the owner's decisions of 2026-11-05).

- **FR-450**: A session's settlement MUST record when it was settled and, for an administrator's resolution, which administrator settled it (ERD `sessions.evaluated_at`, `settled_by_admin_id`; FR-SESS-19).

**Cancellation by agreement and by an administrator**

- **FR-456**: Either participant MUST be able to request the cancellation of a session of theirs that is scheduled and not yet started, with a reason; a session MUST have at most one pending request; the counterparty MUST see it and be able to accept or decline it (FR-CANCEL-1).
- **FR-457**: An accepted request MUST set the session Cancelled-By-Agreement, record no penalty against either party, free both parties' time and owe a make-up session (FR-CANCEL-2, FR-MAKEUP-1, ERD §15 rule 19).
- **FR-458**: A declined request MUST leave the session standing; a pending request MUST expire at the session's scheduled start, read as expired from that instant whether or not a job has marked it, and an answer at or after the start MUST be refused (FR-CANCEL-3, FR-CANCEL-4).
- **FR-459**: The administrator's record of a user MUST show how many cancellation requests that user has made, in total and in the configured recent period (§3.14 «Cancellation requests recent period (days)», default 30) (FR-CANCEL-5; the owner's decision of 2026-11-05).
- **FR-460**: An administrator signed in with the second factor MUST be able to cancel any session not yet settled, with a mandatory reason, recording no penalty: the session is Cancelled-By-Admin, one compensation case opens on its enrollment, and the action is audit-logged; the administrator finds the session from the enrollment and session monitor, searchable by student, teacher or date (FR-CANCEL-6, FR-DISPUTE-5, FR-ADMIN-6, FR-ADMIN-17).
- **FR-461**: No path MAY let a student cancel a whole enrollment, and no path MAY reschedule a session (FR-CANCEL-7, SRS §13).

**Make-up sessions and the refund case**

- **FR-462**: A session settled Teacher-No-Show, Cancelled-By-Agreement or Both-No-Show MUST owe one remedy to the student, recorded once per session; Student-No-Show and Done owe nothing; Cancelled-By-Admin owes nothing here, its enrollment's case deciding, except the sessions a student's suspension cancelled when the case clears the student (FR-486). A remedy MUST be offered only on a `confirmed` enrollment: a session owed on an enrollment that has ended — by the threshold termination (FR-448), a teacher's end (FR-483), a student's ban (FR-486) — is offered nothing and is covered by the compensation case that ending opened (FR-478), and on a student's deletion, which opens no case, nothing is owed (FR-484). No remedy MAY be offered while the student's account is suspended: one that comes due meanwhile is offered at reinstatement, and one already open is frozen (FR-486) (the owner's decisions of 2026-11-05). The remedy MUST be offered to the student only once the session's outcome is final: its dispute window (§3.14 «Dispute window (hours)») has closed with no dispute raised, or an administrator has resolved the dispute. A Cancelled-By-Agreement session is final at its acceptance and cannot be disputed (FR-473), so its remedy MUST be offered at once, in the acceptance's own transaction: the one exception to the wait for the dispute window (the owner's decision of 2026-11-05). What is owed follows the final outcome, so a resolution that turns a Teacher-No-Show into a Student-No-Show owes nothing, and no remedy is ever offered and then withdrawn (FR-MAKEUP-1 and FR-CANCEL-2 as amended on 2026-11-05, FR-DISPUTE-3, FR-DISPUTE-4, FR-CANCEL-6, ERD `session_remedies`).
- **FR-463**: On a recitation enrollment after a Teacher-No-Show, and for each session a student's suspension cancelled once the case clears them (FR-486), the student MUST choose a make-up session or a refund; in every other case of FR-462, and in every case on an ijazah-track enrollment, the remedy MUST be a make-up session, with one exception on either track: a counter-proposal the teacher leaves unanswered becomes a refund (FR-465) (FR-MAKEUP-2 as amended on 2026-11-05, ADR 0018 D2, the enrollment's `snapshot_track`).
- **FR-464**: When the remedy is offered (FR-462), the make-up proposal MUST be the enrollment's weekly slot, in the enrollment's snapshot zone, in the week after its last session, or the first later week in which the slot is neither held nor occupied by another enrollment and the occurrence overlaps no session, reservation or open hold (an unexpired payment window) of the teacher or of the student; a week whose occurrence starts before the end of the choice window plus the counter-proposal answer window plus the first-session lead (§3.14 «First session lead after confirmation», 24 hours) MUST move to the first free week after that moment, since a counter-proposal made at the choice window's last moment keeps the matter open until the end of its answer window (FR-466) and no make-up starts within the lead of the moment it is decided. The answer window and the lead MUST be the values those settings have at the offer, recorded on the remedy and used for every counter-proposal of it (FR-465), so that a later change of either setting cannot let an answer window run past the proposal's start. The proposal is fixed at the offer and never moves (FR-MAKEUP-3 as amended on 2026-11-05, FR-BOOK-4, FR-BOOK-5, R-TIME-2; the owner's decisions of 2026-11-05).
- **FR-465**: Before the choice window ends (FR-466), the student MUST be able to accept the proposal or counter-propose one of the teacher's active availability slots, on a date that is free for both parties, of the session's length, with at most one counter-proposal pending at a time. The teacher MUST answer each counter-proposal within the counter-proposal answer window counted from it (a §3.14 row added on 2026-11-05, «Make-up counter-proposal answer window (hours)», default 72), the value fixed at the remedy's offer (FR-464), even when it came on the choice window's last day. The slots offered for a counter-proposal MUST leave out every occurrence that starts before the later of the moment they are read plus that answer window plus the first-session lead fixed at the offer (24 hours by default), and the end of the choice window, so that no counter-proposed time can pass before the teacher answers and none starts within the lead of the teacher's answer, as booking leaves out slots inside «First session lead after confirmation»; they MUST be read again for each counter-proposal. An accepted counter-proposal MUST be booked. A declined one MUST release its time: while the choice window is still open the student MAY accept the proposal or counter-propose again; once the choice window has closed, the system's proposal MUST be booked at once. One left unanswered when its answer window ends MUST become a refund of that session on either track, opening a compensation case with no amount as FR-467. While a counter-proposal is pending, the student MAY accept the system's proposal: the proposal MUST be booked, and the pending counter-proposal MUST be withdrawn and its time released (the owner's decision of 2026-11-05). The pending counter-proposal's time of day is recorded with its date, and every counter-proposal, with its time and its end, is kept in the session's history (FR-495) (FR-MAKEUP-2 and FR-MAKEUP-3 as amended on 2026-11-05, FR-MAKEUP-6, ERD `session_remedies` and `session_events`; the owner's decisions of 2026-11-05).
- **FR-466**: Where the configured choice window (§3.14 "Make-up choice window (days)", default 7), counted from the offer (FR-462), ends with no acceptance and no counter-proposal pending, the proposed make-up MUST be booked; where a counter-proposal is pending when it ends, the teacher's answer decides as FR-465 says, so every remedy is decided at the latest one answer window after the choice window ends. The system's proposal MUST stay reserved for the enrollment from the offer until the remedy is settled (booked, or handed to a case), and a pending counter-proposal's time for its answer window, released at its decline, its withdrawal or the window's end; both MUST be hidden from booking's slots and refused to a hold of the same teacher or student; a frozen remedy (FR-486) reserves nothing. No make-up session MAY start before the matter could still be decided, nor within the first-session lead of the moment it is decided: the system's proposal never before the end of the choice window plus the answer window plus the lead (FR-464), a counter-proposal never before the end of the choice window nor before its own answer window plus the lead could end (FR-465) (FR-MAKEUP-3 and FR-MAKEUP-4 as amended on 2026-11-05; the owner's decisions of 2026-11-05).
- **FR-467**: A refund choice, or a counter-proposal left unanswered (FR-465), MUST open one compensation case on the enrollment for that session, carrying no amount; the case's page names the session and the enrollment and links to the enrollment's orders in the payments monitor, and nothing of this phase computes a session's share of a price (FR-MAKEUP-6, ADR 0018 D4, R-MONEY-5, R-MONEY-6).
- **FR-468**: The database MUST refuse a make-up session that overlaps another session of the same teacher or the same student, and a refused booking MUST leave the remedy open and create nothing (FR-BOOK-5, ERD §15 rule 19).
- **FR-469**: A booked make-up MUST be an ordinary session of the enrollment: numbered after its last session, recording the session it makes up, its local date, local start and zone as the fact and its instants derived by `packages/time`, extending the enrollment's end and its slot's release; the original session MUST keep its outcome (FR-MAKEUP-5, ADR 0009 D1, ADR 0018 D3).

**Disputes, the session review queue and compensation cases**

- **FR-473**: Either participant MUST be able to raise a dispute over a session of theirs, with a reason, from its scheduled end, before the evaluation too, until the configured dispute window after that end closes (§3.14 "Dispute window (hours)", default 72), and never after; a cancelled session, Cancelled-By-Agreement or Cancelled-By-Admin, MUST NOT be disputed, a Cancelled-By-Agreement session being final at its acceptance (FR-462) and a Cancelled-By-Admin one's enrollment case deciding what is owed (FR-460, FR-478); a session MUST have at most one open dispute (FR-DISPUTE-1 as amended on 2026-11-05, twice; the owner's decisions of 2026-11-05).
- **FR-474**: Raising a dispute MUST mark the session Disputed and freeze its outcome — consumed or not, and any no-show attribution — until resolution, even if the dispute window would otherwise have elapsed (FR-DISPUTE-4).
- **FR-475**: The administrator MUST have a disputes queue showing each open dispute with the session's schedule, every recorded join and leave, the accumulated simultaneous time and the outcome under dispute, and the enrollment's chat only while a dispute (or, from Phase 4, a report) on that enrollment is open, each opening of the chat audit-logged (FR-DISPUTE-2, FR-SESS-13, FR-ADMIN-7, FR-ADMIN-17).
- **FR-476**: The administrator MUST be able to resolve a dispute bindingly — uphold the automatic outcome, re-mark the session consumed or not consumed, record a no-show against either party, order compensation, or suspend or ban a party — with a mandatory reason recorded in the audit log; a re-mark or a recorded no-show MUST bring what that outcome brings (the count toward FR-448, a remedy under FR-462); ordering compensation MUST record the decision and move no money; a suspension or a ban MUST go through `StandingService`, the party's account locked before anything else the resolution locks (FR-DISPUTE-3, FR-DISPUTE-6, FR-421), a student's suspension or ban having FR-486's effect.
- **FR-477**: The administrator MUST have a session review queue of Under-Threshold and Provider-Outage sessions with full attendance telemetry, and MUST resolve each by choosing its outcome among Done, Student-No-Show, Teacher-No-Show and Both-No-Show with a mandatory reason, audit-logged; the chosen outcome brings what it brings, and no outcome is set automatically (FR-SESS-19, FR-ADMIN-14, R-SESS-6).
- **FR-478**: The administrator MUST have a compensation-case queue of every case FR-DISPUTE-5 opens — Phase 2's late and duplicate payments, and this phase's terminations, cancellations and refund choices — each naming its enrollment, its reason and the sessions or remedies it covers — the remedies handed to it, the sessions its opening action cancelled, and, for the case an enrollment's end opened (FR-448, FR-483, FR-486), every session of that enrollment owed a remedy that was never offered (FR-462) — with the open `student_suspended` cases shown first so that a suspended student's enrollment, which keeps its slot, is settled fast (the owner's decision of 2026-11-05), and MUST resolve it (compensation ordered) or dismiss it with a mandatory note of what Platform Administration did outside the platform, audit-logged, under FR-422; a case carries no amount, and the payment's refund is recorded only when the gateway reports it (FR-DISPUTE-5, FR-DISPUTE-6, FR-ADMIN-7, FR-PAYG-7).
- **FR-479**: The administrator MUST have an enrollment and session monitor: enrollments with their status and schedule and each session's status, searchable and filterable by student, teacher or date, read-only except for FR-460's cancellation; payment status is shown only as the payments monitor reports it, through its own page (FR-ADMIN-6, R-MONEY-6).
- **FR-480**: Every administrator action of this phase MUST write one immutable audit entry with the actor, the action, the target's non-personal label, the instant and the reason, and MUST be reachable only by an administrator signed in with the second factor (FR-ADMIN-17, NFR-SEC-6, ADR 0021 D2).
- **FR-481**: The administrator MUST have a user directory listing all users, searchable by name, and a user's record showing exactly what SRS FR-ADMIN-4 lists — profile details, role, gender declaration, the minor flag (derived, never stored), verification status and account status — with FR-459's cancellation-request counts; a student's record MUST carry the student's suspend, ban and reinstate actions (FR-486), each with a mandatory reason; a deleted user is named by FR-426's stand-in; reads and actions audit-logged (FR-ADMIN-4, FR-ADMIN-5, FR-ADMIN-17; PLAN.md, Phase 3, the owner's decision of 2026-11-05).

**When an account ends**

- **FR-482**: A teacher whose account is suspended or banned, or whose approval is revoked, MUST be refused any token from that moment, and MUST be removed from any room they are in (FR-SESS-16, R-SESS-5).
- **FR-483**: In the same transaction as that action, every remaining scheduled session of that teacher MUST be Cancelled-By-Admin, their confirmed enrollments cancelled with `teacher_suspended`, and one compensation case opened per affected enrollment, through the consequences entry (FR-SESS-16, FR-DISPUTE-5, FR-VERIFY-8, ERD `enrollments.cancellation_reason`).
- **FR-484**: A student's deletion MUST cancel their remaining sessions Cancelled-By-Admin and their confirmed enrollments `account_deleted`, with no compensation case; every open make-up remedy of theirs (awaiting a choice, proposed, counter-proposed or frozen) MUST lapse, closed with nothing owed and no case, while a remedy whose refund they had already chosen keeps its case open for the administrator (the owner's decision of 2026-11-05); a teacher's deletion MUST have FR-483's effect, its enrollments cancelled `account_deleted` (FR-AUTH-14, ADR 0015 D4, T059).
- **FR-485**: Every cancellation of this group MUST free both parties' time at once and MUST NOT count a no-show against either party (ADR 0010, ERD §15 rule 19).
- **FR-486**: Suspending a student MUST cancel every upcoming session of theirs at the moment of suspension (Cancelled-By-Admin; a suspension has no end date, so no session is left to become a no-show) and open a compensation case per confirmed enrollment, pending the review; each such enrollment MUST stay confirmed, keep its slot, and not complete while its case is open (FR-449). The student cleared (the case resolved, once the account is reinstated, else `STUDENT_SUSPENDED`), the student MUST be owed in the same enrollment, for each session the suspension cancelled, what FR-MAKEUP-2 gives for a Teacher-No-Show, since the fault was not theirs: on a recitation enrollment a make-up session or a refund at the student's choice (FR-463, FR-467), on an ijazah-track enrollment a make-up session, placed as FR-464 to FR-466, a counter-proposal left unanswered becoming a refund. A remedy already offered to the student when the suspension begins MUST be frozen: a pending counter-proposal withdrawn and its time released, the system's proposal's reserved time released too, and nothing advancing while the account is suspended; at reinstatement a new system proposal MUST be offered with a new full choice window, the answer window and the lead read again at that offer, placed under FR-464's rule (the owner's decisions of 2026-11-05). The fault confirmed (the case dismissed), the enrollment MUST be cancelled with the reason `admin` and its slot return to booking. Banning a student MUST cancel all their upcoming sessions and, at once, their confirmed enrollments with the reason `admin`, and owe nothing unless the administrator decides otherwise in the case. The teacher is told through the screens (FR-495), and the freed times return to booking. Both go through `StandingService` on the action's transaction (FR-ADMIN-5 as amended on 2026-11-05, ADR 0018 D5, ADR 0016, FR-421; the owner's decisions of 2026-11-05).

**Chat**

- **FR-488**: The two participants of a confirmed enrollment, and nobody else, MUST be able to exchange text messages scoped to that enrollment, from its confirmation; once the enrollment has ended, its chat MUST be read-only until it is purged (FR-SESS-6 as amended on 2026-11-05; the owner's decision of 2026-11-05).
- **FR-489**: Participants MUST be able to send PDF and UTF-8 text documents, and no other type (Office files can carry macros; they may be added later), within the configured upload size limit and upload rate limit (§3.14 "Upload size limit (bytes)", "Upload rate limit"), stored privately and served only through a signed link valid for the configured time (§3.14 "Signed document link validity (seconds)") (FR-SESS-7 as amended on 2026-11-05, R-SEC-3, NFR-SEC-9; the owner's decision of 2026-11-05).
- **FR-490**: Any file that is an image by its extension or by its content MUST be refused, by the server's content sniffing and never by trust in the client's declared type, regardless of the pairing (FR-SESS-8, R-SEC-4, R-SEC-5).
- **FR-491**: Messages MUST be limited by a configured chat message rate limit (a §3.14 row since 2026-11-05, «Chat message rate limit (per subject, per window)», default 30 per 60 s), so a participant cannot flood the other, and the chat MUST be read a configured page at a time (§3.14 «Chat page size (messages)», default 50) (NFR-SEC-10; the owner's decision of 2026-11-05).
- **FR-492**: The purge job MUST remove every message's body and attachment of an enrollment that is completed, terminated or cancelled once its last session's dispute window has closed plus the configured chat retention (§3.14 "Chat retention beyond dispute window (days)"), unless a dispute, a compensation case or (from Phase 4) a report on that enrollment is open, and then only after it is resolved; purged rows are kept with their purge instant; the job is idempotent (FR-SESS-13, FR-AUTH-14, R-API-14, ERD `chat_messages`).

**Screens, notices, proofs and confinement**

- **FR-494**: Every session time shown by this phase MUST appear twice, in the session's own zone and in the viewer's (ADR 0009 D5, FR-393 of `specs/003-booking/spec.md`).
- **FR-495**: The enrollment screens of both participants MUST show each session's status after settlement, a pending cancellation request with its answer, a remedy waiting for the student's choice or the teacher's answer with its deadline, a dispute's state, and the enrollment's termination; these screens are the notice of each event this phase produces, and every such event MUST also be kept as a durable record naming its enrollment, its session where it has one, its kind and its instant, readable by Phase 4's notifications with no change to this phase's code (FR-SESS-12, FR-NOSHOW-5, FR-CANCEL-1, FR-SESS-16).
- **FR-496**: The adversarial gender suite MUST gain cases for every procedure of this phase that issues a token or reads a session, its chat or its counterparty — by direct call, forged and guessed session ids, another session's token, a token replayed by the other participant, a tampered access token and a client-supplied gender, in both directions, and after an administrator's gender correction — and MUST stay blocking on every commit (R-GENDER-1, R-GENDER-7, NFR-COMP-1).
- **FR-497**: The sessions module MUST NOT reference a price, a payment record or any payment concept, and no wallet, ledger, escrow, balance, share or commission MAY exist; the boundary gate MUST prove it (PLAN.md definition of done, R-MONEY-6).
- **FR-498**: Every operational number of this phase MUST be read from settings (R-MONEY-12): the early-join lead, the join window, the minimum connection duration, the attendance threshold, the evaluation delay, the teacher no-show threshold, the dispute window, the make-up choice window, the make-up counter-proposal answer window, the slot release buffer, the chat retention, the upload size and rate limits, the signed link validity, the chat message rate limit, the chat page size, the cancellation requests' recent period, the admin list page size, the first-session lead, and the video room's empty timeout and departure timeout; SRS §3.14 holds every one, the evaluation delay, the chat message rate limit, the chat page size and the recent period since 2026-11-05, and the video room's two timeouts (defaults 300 s and 20 s) since the analysis the same day (FR-441, FR-459, FR-491; the owner's decisions of 2026-11-05).
- **FR-499**: Every procedure of this phase MUST declare its output schema and pass the contract gate, no one user's minor flag, date of birth, documents or gender-dispute history MAY reach the other, and every Arabic string that holds values MUST follow T123's rule for right-to-left marks (R-HONEST-4, R-API-9, `002:T123`).

### Key Entities _(include if feature involves data)_

All exist in `docs/ERD.md` unless marked new; this phase writes most of them for
the first time, and the plan names any column or check it adds.

- **Session** (`sessions`): one occurrence of an enrollment, with its status in the full machine, its accumulated simultaneous time, its settlement instant and settler, and the session a make-up makes up.
- **Participant event** (`session_participant_events`): one join or leave from a signed provider webhook, append-only, unique by provider event id.
- **Cancellation request** (`cancellation_requests`): a request by either participant, pending, accepted, declined or expired.
- **Session remedy** (`session_remedies`): what a session not consumed is owed — a make-up or a refund case — and where its choice stands, frozen during a student's suspension or lapsed at their deletion; the counter-proposal's time of day and the answer window and lead fixed at the offer are to add.
- **Dispute and compensation case** (`disputes`): a session dispute raised by a participant, or a compensation case opened by the system, each with its resolution, its note and its closing instant; never an amount.
- **Chat message** (`chat_messages`): a text or a document of one enrollment, purged by the retention job.
- **Enrollment** (`enrollments`): its status reaches completed, terminated by no-show or cancelled here.
- **Provider outage** (new): a window during which the video provider was out, recorded by an administrator with a reason (FR-445).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-401**: A session runs end to end in the app on two physical Android phones over mobile data, including a switch between Wi-Fi and mobile data in the middle, and settles Done (PLAN.md definition of done; ADR 0003).
- **SC-402**: Across a mid-session disconnect and reconnection, the accumulated simultaneous time equals the sum of the overlapping connected intervals within the scheduled window, and the outcome is the one SRS §3.7.5 gives, in CI and on the phones (PLAN.md definition of done).
- **SC-403**: A session whose final webhook never arrives is settled within the evaluation delay plus one minute of its scheduled end in 100% of CI runs (PLAN.md definition of done).
- **SC-404**: Student-No-Show, Teacher-No-Show, Both-No-Show and the termination at the teacher no-show threshold are each reached in CI from signed provider events alone (PLAN.md definition of done).
- **SC-405**: A participant event delivered 100 times leaves one recorded event and the same accumulated time; the evaluation job run twice leaves the same outcome and records.
- **SC-406**: In CI, a provider webhook with a wrong or missing signature, or a body changed after signing, is refused in 100% of attempts with nothing written.
- **SC-407**: The adversarial suite refuses a token in 100% of attempts for an opposite-gender account, a non-participant, another session's id, a teacher suspended, revoked or banned, and outside the join period, in both directions, and blocks the merge when a case fails.
- **SC-408**: Every image in a test corpus — by extension, by content, renamed to a document's extension, and a document given an image's content — is refused, and every allowed document is accepted.
- **SC-409**: No code of the sessions module references a price or a payment, and no amount is stored by this phase, proved by the boundary and schema gates (PLAN.md definition of done).
- **SC-410**: Every unconsumed outcome in the suite owes exactly one remedy; every refund choice opens exactly one compensation case with no amount; every make-up booked extends its enrollment's end and slot release.
- **SC-411**: No cancellation request is pending after its session's scheduled start, and no answer given at or after the start changes the session, in 100% of CI runs.
- **SC-412**: A teacher's suspension, revocation, ban or deletion, and a student's deletion, leave no token issuable and every remaining session cancelled with its cases, in one transaction, in 100% of CI runs.
- **SC-413**: Every administrator action of this phase writes one audit entry with its reason, and no administrator action of this phase writes a payment, an amount or an enrollment's confirmation.
- **SC-414**: On the owner's phones over 4G, a participant pressing join is in the room within ten seconds in at least nine of ten attempts, and the owner judges the audio fit for correcting recitation (ADR 0003's observation, FR-SESS-4).

## Assumptions

- The cycle runs on day 16, 2026-11-05, inside Phase 2's days (Phase 2 closed early); implementation starts on day 17, the next working day, and Phase 3 keeps its seven days (PLAN.md; `specs/003-booking/tasks.md`, T106).
- LiveKit Cloud's free plan is the provider for development and testing; its hard cap of free minutes is enough for the phase, and a paid plan is a Phase 6 decision (ADR 0003). Media crosses the border with any provider, a question already with counsel (research R-19).
- The phone needs an Expo development build from the first video task (ADR 0003, Consequences).
- The provider's webhooks reach the development API through the same kind of public tunnel Phase 2 used for the gateway, which passes only the webhook paths and nothing else (the owner's rule for the payment tunnel, extended to the video webhook path).
- The device runs use the two Android phones of ADR 0003's spike; an iPhone run is Phase 6's, as Phase 1's and Phase 2's were (the owner's decision of 2026-10-28 for SC-105).
- Joining is read as FR-442 states: a participant has joined when a connection begun by the end of the join window lasts the minimum connection duration; connected time before the start counts toward joining, not toward the simultaneous time.
- An enrollment is completed only by FR-449; Phase 2's occupancy then frees its slot under FR-423.
- A teacher's suspension, revocation or ban cancels their confirmed enrollments with `teacher_suspended`, the reason the ERD already holds; a teacher reinstated later does not get them back, the compensation case deciding what is owed.
- Session reminders (FR-BOOK-8) and their rescheduling are Phase 4's, with notifications; this phase writes no reminder.
- User reports (FR-SESS-15) and the report queue are Phase 4's (PLAN.md, Phase 4); the chat's retention already honours an open report once reports exist (FR-492).
- Gender disputes and their consequences on enrollments (FR-GENDER-3 to FR-GENDER-7, FR-ADMIN-8) land in Phase 4, with user reports (the owner's decision of 2026-11-05), and are not specified here; the token check of FR-432 already refuses a pairing an administrator's correction made cross-gender.
- The allowed chat document types are PDF and UTF-8 text only (the owner's decision of 2026-11-05; SRS FR-SESS-7 records it: Office files can carry macros, and may be added later); RISK-02 (images inside a PDF) stays accepted.
- No setting is written from code; the new rows (the evaluation delay, the chat message rate limit, the chat page size, the cancellation requests' recent period and the video room's two timeouts, SRS §3.14 since 2026-11-05) are seeded at their defaults and changed in the admin panel (R-PROC-11).
- Saif's review session reviews every batch under the review rules in force; the owner runs SC-401 and SC-414 on the phones.
