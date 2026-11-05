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
other's acceptance makes it free of cost. Either party may dispute a settled
session within the dispute window, and an administrator resolves disputes,
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
requirements cannot work without (FR-ADMIN-6, FR-ADMIN-7 and FR-ADMIN-14).
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
- Q: How is a make-up placed when the student does not answer or counter-proposes? → A: The proposed time is reserved for the whole choice window and never starts before the window ends (a week that falls inside it moves to the first week after it in which the slot is free); the student's counter-proposal is limited to the teacher's active availability slots; a teacher who does not answer within the choice window counts as declining, and the system's proposal stands. SRS FR-MAKEUP-3 is amended to say so (FR-464 to FR-466).
- Also decided on 2026-11-05: T090 (a deleted party's name) lands in this phase (FR-426); a teacher's deletion cancels their enrollments `account_deleted`, and a suspension, revocation or ban `teacher_suspended` (FR-483, FR-484).

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

1. **Given** a provider webhook, **When** its signature does not verify on the raw body, **Then** it is refused before any handler runs and nothing is written (R-SESS-1; the constitution's R-MONEY-9 pattern, as ARCHITECTURE §12's video signature alert assumes).
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
2. **Given** a pending request, **When** the counterparty accepts it before the scheduled start, **Then** the session is Cancelled-By-Agreement, no penalty is recorded, both parties' time is freed, and a make-up session is proposed (FR-CANCEL-2, FR-MAKEUP-1, ADR 0010).
3. **Given** a pending request, **When** the counterparty declines it, or the scheduled start arrives with no answer, **Then** the request is declined or expired and the session stands under ordinary attendance (FR-CANCEL-3, FR-CANCEL-4).
4. **Given** any session not yet settled, **When** an administrator cancels it with a mandatory reason, **Then** it is Cancelled-By-Admin, no penalty is recorded, one compensation case opens on the enrollment, and the action is audit-logged (FR-CANCEL-6, FR-DISPUTE-5, FR-ADMIN-17).
5. **Given** a user who requests cancellations repeatedly, **When** an administrator opens that user's record, **Then** the count of their cancellation requests is shown as a trust signal (FR-CANCEL-5).
6. **Given** a student, **When** they look for a way to cancel a whole enrollment, **Then** there is none (FR-CANCEL-7, SRS §13).

---

### User Story 4 - A session not consumed is made up, or refunded by a case (Priority: P2)

After a Teacher-No-Show, a Cancelled-By-Agreement or a Both-No-Show, the
student is owed the session back. On a recitation enrollment after the
teacher's absence the student chooses a make-up session or a refund; in every
other case the remedy is a make-up. The system proposes the enrollment's weekly
slot in the week after its last session, or the first later week it is free;
the student accepts or counter-proposes one of the teacher's available
slots, which the teacher accepts or declines (no answer counts as declining); with no answer by the end of the choice window, the
proposal is booked. A refund opens a compensation case with no amount.

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
2. **Given** a make-up is owed, **When** it is proposed, **Then** the proposal is the enrollment's weekly slot in the week after its last session, or the first later week in which that slot is free for the teacher and the student, in the enrollment's snapshot zone (FR-MAKEUP-3, R-TIME-2).
3. **Given** a proposal, **When** the student counter-proposes one of the teacher's active availability slots, **Then** the teacher accepts it, and it is booked, or declines it or does not answer within the choice window, and the system's proposal stands (FR-MAKEUP-3 as amended).
4. **Given** a proposal with no answer from the student, **When** the configured choice window ends, **Then** the proposed make-up session is booked (FR-MAKEUP-4).
5. **Given** a make-up session booked, **Then** it is an ordinary session of the enrollment, numbered after its last session, recording the session it makes up, extending the enrollment's end and its slot's release, and the original session keeps its outcome (FR-MAKEUP-5, ADR 0018 D3).
6. **Given** the student chooses a refund, **Then** one compensation case opens on the enrollment for that session, carrying no amount, and nothing in the platform computes a share of a price (FR-MAKEUP-6, ADR 0018 D4, ADR 0007).

---

### User Story 5 - An administrator settles what the evidence could not (Priority: P2)

Either party may raise a dispute over a settled session within the dispute
window; the session is marked Disputed and its outcome frozen. The
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

1. **Given** a settled session within the configured dispute window after its scheduled end, **When** either participant raises a dispute with a reason, **Then** the session is Disputed and its outcome — consumed or not, and any no-show attribution — is frozen until resolution, even past the window; after the window no dispute may be raised (FR-DISPUTE-1, FR-DISPUTE-4).
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
no case. When a student is suspended, their upcoming sessions are cancelled and
a compensation case waits for the review; when banned, they are cancelled and
nothing is owed unless the administrator decides otherwise. Every suspension
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
3. **Given** a student who deletes their account, **Then** their remaining sessions are Cancelled-By-Admin and their confirmed enrollments cancelled with `account_deleted`, with no compensation case; **given** a teacher who deletes theirs, **Then** FR-SESS-16's effect applies, compensation cases included (FR-AUTH-14, ADR 0015, T059).
4. **Given** a student suspended, **Then** every upcoming session of theirs is Cancelled-By-Admin at that moment and one compensation case opens pending the review; **given** a student banned, **Then** all their upcoming sessions are cancelled and nothing is owed unless the administrator decides otherwise in the case; both go through `StandingService` (FR-ADMIN-5, ADR 0018 D5).

---

### User Story 7 - The two participants chat and exchange documents (Priority: P3)

From confirmation, the student and the teacher of an enrollment exchange text
messages and documents (PDF and text), never an image. An administrator can
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
- The make-up proposal's week falls before the choice window would end (the unconsumed session was among the last): the proposal moves to the first week after the window in which the slot is free (FR-466); it never starts before the student could still answer it.
- A teacher's absence that reaches the threshold leaves make-up sessions booked or proposed: they are cancelled with the rest and their remedies are named in the termination's compensation case (FR-NOSHOW-4).
- A dispute is raised between the scheduled end and the evaluation: the evaluation still records the automatic outcome, frozen under the dispute (FR-DISPUTE-4).
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

- **FR-420**: The phase's first batch MUST land T059 of `specs/003-booking/tasks.md`, FR-AUTH-14's confirmed part: a student's deletion cancels their remaining sessions `cancelled_by_admin` and their confirmed enrollments `account_deleted`, with no compensation case; a teacher's deletion has FR-SESS-16's effect (FR-483), compensation cases included (PLAN.md, Phase 3; the owner's decision of 2026-11-01).
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

- **FR-440**: Attendance MUST come only from the video provider's webhooks: each webhook MUST have its signature verified on the raw body before any handler runs, and each join and leave MUST be recorded once under the provider's unique, non-null event id with the provider's instant, append-only; a replay MUST be acknowledged with no effect; no client value MAY reach attendance (FR-SESS-9, R-SESS-1, R-TIME-6, ERD §15 rules 4 and 21).
- **FR-441**: A session MUST be evaluated by a scheduled job only once its scheduled end has passed by the configured evaluation delay (a new §3.14 setting, "Session evaluation delay after scheduled end (minutes)", default 2, the constitution's R-SESS-2), never as a webhook reaction, and MUST be evaluated even when no final webhook arrived; the job MUST be idempotent (FR-SESS-10, R-SESS-2, R-SESS-3, R-API-14).
- **FR-442**: A participant MUST count as joined when they have a connection that began no later than the configured join window after the scheduled start (§3.14 "Join window (minutes after start)") and accumulated at least the configured minimum connection duration (§3.14 "Minimum connection duration (seconds)") of connected time between the early-join lead and the scheduled end (FR-SESS-17).
- **FR-443**: Simultaneous connected time MUST be accumulated across every reconnection, only between the scheduled start and the scheduled end, and a connection whose leave was never reported MUST count until the provider's room-ended event or the scheduled end, whichever is first (FR-SESS-18, R-SESS-4).
- **FR-444**: The evaluation MUST settle each session by SRS §3.7.5's table, a recorded provider outage overlapping the session taking precedence over every other row: Done where simultaneous time is at least the configured attendance threshold of the scheduled length (§3.14 "Attendance threshold (%)"); Student-No-Show, Teacher-No-Show and Both-No-Show by who joined; Under-Threshold where both joined below the threshold; Provider-Outage where FR-445 applies (FR-SESS-11, FR-NOSHOW-1, FR-NOSHOW-2, FR-NOSHOW-6).
- **FR-445**: A session overlapping a provider outage MUST be settled Provider-Outage with no no-show counted against either party. LiveKit Cloud sends no outage webhook (ADR 0003), so an outage is recorded by an administrator signed in with the second factor, who enters its window in the panel with a reason, audit-logged; the evaluation job reads the recorded windows; a session the window overlaps that was already settled and is still inside its dispute window moves to the session review queue (SRS §3.7.5; the owner's decision of 2026-11-05).
- **FR-446**: Under-Threshold and Provider-Outage sessions MUST stay frozen in the administrator's session review queue, with no automatic transition out, until an administrator resolves them (FR-SESS-19, R-SESS-6).
- **FR-447**: Done and Student-No-Show MUST consume the session; Teacher-No-Show, Both-No-Show and the two cancellations MUST NOT; the enrollment's remaining and completed sessions and its teacher no-show count MUST be derived from its sessions' outcomes, never stored (FR-SESS-12, FR-NOSHOW-1, FR-NOSHOW-2, FR-NOSHOW-6, R-DB-4).
- **FR-448**: When an enrollment's Teacher-No-Show count reaches the configured threshold (§3.14 "Teacher no-show termination threshold (count)"), its remaining scheduled sessions, make-ups included, MUST be Cancelled-By-Admin, the enrollment set Terminated-No-Show, and one compensation case opened on it naming the remedies left open, in one transaction (FR-NOSHOW-3, FR-NOSHOW-4, FR-DISPUTE-5).
- **FR-449**: An enrollment MUST become completed when every one of its sessions, make-ups included, has a settled outcome that is not frozen, and no remedy is owed on it (no make-up awaiting a choice, proposed, counter-proposed or booked and not yet settled; a refund handed to its compensation case is no longer owed by the enrollment, the case deciding it) (ERD `enrollments.status`; SRS §3.8.5).

- **FR-450**: A session's settlement MUST record when it was settled and, for an administrator's resolution, which administrator settled it (ERD `sessions.evaluated_at`, `settled_by_admin_id`; FR-SESS-19).

**Cancellation by agreement and by an administrator**

- **FR-456**: Either participant MUST be able to request the cancellation of a session of theirs that is scheduled and not yet started, with a reason; a session MUST have at most one pending request; the counterparty MUST see it and be able to accept or decline it (FR-CANCEL-1).
- **FR-457**: An accepted request MUST set the session Cancelled-By-Agreement, record no penalty against either party, free both parties' time and owe a make-up session (FR-CANCEL-2, FR-MAKEUP-1, ERD §15 rule 19).
- **FR-458**: A declined request MUST leave the session standing; a pending request MUST expire at the session's scheduled start, read as expired from that instant whether or not a job has marked it, and an answer at or after the start MUST be refused (FR-CANCEL-3, FR-CANCEL-4).
- **FR-459**: The administrator's record of a user MUST show how many cancellation requests that user has made, in total and in a recent period (FR-CANCEL-5).
- **FR-460**: An administrator signed in with the second factor MUST be able to cancel any session not yet settled, with a mandatory reason, recording no penalty: the session is Cancelled-By-Admin, one compensation case opens on its enrollment, and the action is audit-logged; the administrator finds the session from the enrollment and session monitor, searchable by student, teacher or date (FR-CANCEL-6, FR-DISPUTE-5, FR-ADMIN-6, FR-ADMIN-17).
- **FR-461**: No path MAY let a student cancel a whole enrollment, and no path MAY reschedule a session (FR-CANCEL-7, SRS §13).

**Make-up sessions and the refund case**

- **FR-462**: A session settled Teacher-No-Show, Cancelled-By-Agreement or Both-No-Show MUST owe one remedy to the student, recorded once per session; Student-No-Show and Done owe nothing; Cancelled-By-Admin owes nothing here, its enrollment's case deciding (FR-MAKEUP-1, FR-CANCEL-6, ERD `session_remedies`).
- **FR-463**: On a recitation enrollment after a Teacher-No-Show the student MUST choose a make-up session or a refund; in every other case of FR-462, and in every case on an ijazah-track enrollment, the remedy MUST be a make-up session (FR-MAKEUP-2, ADR 0018 D2, the enrollment's `snapshot_track`).
- **FR-464**: The make-up proposal MUST be the enrollment's weekly slot, in the enrollment's snapshot zone, in the week after its last session, or the first later week in which the slot is neither held nor occupied by another enrollment and the occurrence overlaps no session of the teacher or of the student (FR-MAKEUP-3, FR-BOOK-5, R-TIME-2).
- **FR-465**: The student MUST be able to accept the proposal or counter-propose one of the teacher's active availability slots, on a date that is free for both parties, of the session's length; the teacher MUST be able to accept or decline a counter-proposal within the configured choice window counted from the counter-proposal, a teacher who does not answer within it counting as declining; a declined counter-proposal MUST fall back to the system's proposal; the counter-proposal's time of day is recorded with its date (FR-MAKEUP-3 as amended on 2026-11-05, ERD `session_remedies` note).
- **FR-466**: Where the student has not answered within the configured choice window (§3.14 "Make-up choice window (days)"), counted from the proposal, the proposed make-up MUST be booked; the proposed time MUST stay reserved for the enrollment for the whole choice window, and a proposal MUST NOT start before its choice window ends: a week that falls inside the window moves to the first week after it in which the slot is free (FR-MAKEUP-3 as amended on 2026-11-05, FR-MAKEUP-4).
- **FR-467**: A refund choice MUST open one compensation case on the enrollment for that session, carrying no amount; the case's page names the session and the enrollment and links to the enrollment's orders in the payments monitor, and nothing of this phase computes a session's share of a price (FR-MAKEUP-6, ADR 0018 D4, R-MONEY-5, R-MONEY-6).
- **FR-468**: The database MUST refuse a make-up session that overlaps another session of the same teacher or the same student, and a refused booking MUST leave the remedy open and create nothing (FR-BOOK-5, ERD §15 rule 19).
- **FR-469**: A booked make-up MUST be an ordinary session of the enrollment: numbered after its last session, recording the session it makes up, its local date, local start and zone as the fact and its instants derived by `packages/time`, extending the enrollment's end and its slot's release; the original session MUST keep its outcome (FR-MAKEUP-5, ADR 0009 D1, ADR 0018 D3).

**Disputes, the session review queue and compensation cases**

- **FR-473**: Either participant MUST be able to raise a dispute over a settled session of theirs, with a reason, within the configured dispute window after that session's scheduled end (§3.14 "Dispute window (hours)", default 72), and never after the window closes; a session MUST have at most one open dispute (FR-DISPUTE-1).
- **FR-474**: Raising a dispute MUST mark the session Disputed and freeze its outcome — consumed or not, and any no-show attribution — until resolution, even if the dispute window would otherwise have elapsed (FR-DISPUTE-4).
- **FR-475**: The administrator MUST have a disputes queue showing each open dispute with the session's schedule, every recorded join and leave, the accumulated simultaneous time and the outcome under dispute, and the enrollment's chat only while a dispute (or, from Phase 4, a report) on that enrollment is open, each opening of the chat audit-logged (FR-DISPUTE-2, FR-SESS-13, FR-ADMIN-7, FR-ADMIN-17).
- **FR-476**: The administrator MUST be able to resolve a dispute bindingly — uphold the automatic outcome, re-mark the session consumed or not consumed, record a no-show against either party, order compensation, or suspend or ban a party — with a mandatory reason recorded in the audit log; a re-mark or a recorded no-show MUST bring what that outcome brings (the count toward FR-448, a remedy under FR-462); ordering compensation MUST record the decision and move no money; a suspension or a ban MUST go through `StandingService` (FR-DISPUTE-3, FR-DISPUTE-6, FR-421), a student's suspension or ban having FR-486's effect.
- **FR-477**: The administrator MUST have a session review queue of Under-Threshold and Provider-Outage sessions with full attendance telemetry, and MUST resolve each by choosing its outcome among Done, Student-No-Show, Teacher-No-Show and Both-No-Show with a mandatory reason, audit-logged; the chosen outcome brings what it brings, and no outcome is set automatically (FR-SESS-19, FR-ADMIN-14, R-SESS-6).
- **FR-478**: The administrator MUST have a compensation-case queue of every case FR-DISPUTE-5 opens — Phase 2's late and duplicate payments, and this phase's terminations, cancellations and refund choices — each naming its enrollment, its reason and the sessions or remedies it covers, and MUST resolve it (compensation ordered) or dismiss it with a mandatory note of what Platform Administration did outside the platform, audit-logged, under FR-422; a case carries no amount, and the payment's refund is recorded only when the gateway reports it (FR-DISPUTE-5, FR-DISPUTE-6, FR-ADMIN-7, FR-PAYG-7).
- **FR-479**: The administrator MUST have an enrollment and session monitor: enrollments with their status and schedule and each session's status, searchable and filterable by student, teacher or date, read-only except for FR-460's cancellation; payment status is shown only as the payments monitor reports it, through its own page (FR-ADMIN-6, R-MONEY-6).
- **FR-480**: Every administrator action of this phase MUST write one immutable audit entry with the actor, the action, the target's non-personal label, the instant and the reason, and MUST be reachable only by an administrator signed in with the second factor (FR-ADMIN-17, NFR-SEC-6, ADR 0021 D2).

**When an account ends**

- **FR-482**: A teacher whose account is suspended or banned, or whose approval is revoked, MUST be refused any token from that moment, and MUST be removed from any room they are in (FR-SESS-16, R-SESS-5).
- **FR-483**: In the same transaction as that action, every remaining scheduled session of that teacher MUST be Cancelled-By-Admin, their confirmed enrollments cancelled with `teacher_suspended`, and one compensation case opened per affected enrollment, through the consequences entry (FR-SESS-16, FR-DISPUTE-5, FR-VERIFY-8, ERD `enrollments.cancellation_reason`).
- **FR-484**: A student's deletion MUST cancel their remaining sessions Cancelled-By-Admin and their confirmed enrollments `account_deleted`, with no compensation case; a teacher's deletion MUST have FR-483's effect, its enrollments cancelled `account_deleted` (FR-AUTH-14, ADR 0015 D4, T059).
- **FR-485**: Every cancellation of this group MUST free both parties' time at once and MUST NOT count a no-show against either party (ADR 0010, ERD §15 rule 19).
- **FR-486**: Suspending a student MUST cancel every upcoming session of theirs at the moment of suspension (Cancelled-By-Admin; a suspension has no end date, so no session is left to become a no-show) and open a compensation case pending the review: a cleared student is owed make-up sessions or a refund under FR-MAKEUP-2, and a confirmed fault owes nothing. Banning a student MUST cancel all their upcoming sessions and owe nothing unless the administrator decides otherwise in the case. The teacher is told through the screens (FR-495), and the freed slots return to booking. Both go through `StandingService` on the action's transaction (FR-ADMIN-5, ADR 0018 D5, ADR 0016, FR-421; the owner's decision of 2026-11-05).

**Chat**

- **FR-488**: The two participants of a confirmed enrollment, and nobody else, MUST be able to exchange text messages scoped to that enrollment, from its confirmation until its chat is purged (FR-SESS-6).
- **FR-489**: Participants MUST be able to send PDF and text documents, within the configured upload size limit and upload rate limit (§3.14 "Upload size limit (bytes)", "Upload rate limit"), stored privately and served only through a signed link valid for the configured time (§3.14 "Signed document link validity (seconds)"); the plan names the allowed document types (FR-SESS-7, R-SEC-3, NFR-SEC-9).
- **FR-490**: Any file that is an image by its extension or by its content MUST be refused, by the server's content sniffing and never by trust in the client's declared type, regardless of the pairing (FR-SESS-8, R-SEC-4, R-SEC-5).
- **FR-491**: Messages MUST be limited by a configured chat message rate limit (a new §3.14 row, per subject per window), so a participant cannot flood the other (NFR-SEC-10).
- **FR-492**: The purge job MUST remove every message's body and attachment of an enrollment that is completed, terminated or cancelled once its last session's dispute window has closed plus the configured chat retention (§3.14 "Chat retention beyond dispute window (days)"), unless a dispute, a compensation case or (from Phase 4) a report on that enrollment is open, and then only after it is resolved; purged rows are kept with their purge instant; the job is idempotent (FR-SESS-13, FR-AUTH-14, R-API-14, ERD `chat_messages`).

**Screens, notices, proofs and confinement**

- **FR-494**: Every session time shown by this phase MUST appear twice, in the session's own zone and in the viewer's (ADR 0009 D5, FR-393 of `specs/003-booking/spec.md`).
- **FR-495**: The enrollment screens of both participants MUST show each session's status after settlement, a pending cancellation request with its answer, a remedy waiting for the student's choice or the teacher's answer with its deadline, a dispute's state, and the enrollment's termination; these screens are the notice of each event this phase produces, and every such event MUST also be kept as a durable record naming its enrollment, its session where it has one, its kind and its instant, readable by Phase 4's notifications with no change to this phase's code (FR-SESS-12, FR-NOSHOW-5, FR-CANCEL-1, FR-SESS-16).
- **FR-496**: The adversarial gender suite MUST gain cases for every procedure of this phase that issues a token or reads a session, its chat or its counterparty — by direct call, forged and guessed session ids, another session's token, a token replayed by the other participant, a tampered access token and a client-supplied gender, in both directions, and after an administrator's gender correction — and MUST stay blocking on every commit (R-GENDER-1, R-GENDER-7, NFR-COMP-1).
- **FR-497**: The sessions module MUST NOT reference a price, a payment record or any payment concept, and no wallet, ledger, escrow, balance, share or commission MAY exist; the boundary gate MUST prove it (PLAN.md definition of done, R-MONEY-6).
- **FR-498**: Every operational number of this phase MUST be read from settings (R-MONEY-12): the early-join lead, the join window, the minimum connection duration, the attendance threshold, the evaluation delay, the teacher no-show threshold, the dispute window, the make-up choice window, the slot release buffer, the chat retention, the upload size and rate limits, the signed link validity, the chat message rate limit and the admin list page size; the plan adds the two new rows (FR-441, FR-491) beside §3.14's.
- **FR-499**: Every procedure of this phase MUST declare its output schema and pass the contract gate, no one user's minor flag, date of birth, documents or gender-dispute history MAY reach the other, and every Arabic string that holds values MUST follow T123's rule for right-to-left marks (R-HONEST-4, R-API-9, `002:T123`).

### Key Entities _(include if feature involves data)_

All exist in `docs/ERD.md` unless marked new; this phase writes most of them for
the first time, and the plan names any column or check it adds.

- **Session** (`sessions`): one occurrence of an enrollment, with its status in the full machine, its accumulated simultaneous time, its settlement instant and settler, and the session a make-up makes up.
- **Participant event** (`session_participant_events`): one join or leave from a signed provider webhook, append-only, unique by provider event id.
- **Cancellation request** (`cancellation_requests`): a request by either participant, pending, accepted, declined or expired.
- **Session remedy** (`session_remedies`): what a session not consumed is owed — a make-up or a refund case — and where its choice stands; the counter-proposal's time of day is to add.
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
- The allowed chat document types are PDF and plain text unless the plan, from the SRS's "document/text files", names more; RISK-02 (images inside a PDF) stays accepted.
- No setting is written from code; the two new rows are seeded at their defaults and changed in the admin panel (R-PROC-11).
- Saif's review session reviews every batch under the review rules in force; the owner runs SC-401 and SC-414 on the phones.
