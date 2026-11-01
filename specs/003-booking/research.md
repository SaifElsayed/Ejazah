# Research: Phase 2 — Catalog, discovery, booking

**Date**: 2026-10-31 · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Each decision below resolves a question the specification leaves to the plan. Numbered R-201 to R-222 so that a
citation never collides with Phase 0's R-1… or Phase 1's R-101 to R-121. Every decision was taken against the code
as it stands on `develop` f2389ff (read on 2026-10-31); where it names existing code, the path is given.

---

## R-201 — The visibility predicate lives in `identity`, and catalog filters by its answer

**Decision.** The five conjuncts of SRS §3.7.1 read only `users` (gender, `deleted_at`, `account_status`,
`display_name`) and `teacher_profiles` (`verification_status`, `payout_verified_at`), both `identity`'s tables
(`packages/config/module-tables.json`). So the predicate is implemented once, in
`apps/api/src/modules/identity/visible-teachers.repository.ts`, as two methods that take a required
`RequesterGender` (`platform/guards/requester-gender.ts`) and nothing that could widen it:

- `visibleTeachers(tx, requester, { purpose: 'discover' | 'book', teacherIds?, namePrefix? })` → the public fields of
  each visible teacher (id, display name, gender, photo key, bio, qualification summary, rating, review count);
- `visibleTeacherPage(tx, requester, { candidateIds, namePrefix?, minRating?, after?, limit })` → the same rows for one
  page of discovery, in R-204's order (the owner's decisions of 2026-11-01, analysis C2): the order's keys are identity's columns, so identity orders
  and pages them; catalog passes only the ids its own tables allow;
- `isVisibleTeacher(tx, requester, teacherId, purpose)` → the same row or `null`.

`purpose: 'discover'` applies the five conjuncts; `'book'` adds `account_status = 'active'` (T143). Both are exported
from `identity/index.ts`. `catalog` (discovery, the profile) and `booking` (the hold, the slots) call them and then
filter their own tables by the returned ids (`teacher_user_id = ANY($ids)`); a `null` becomes the not-found answer
(R-202). Counts per subject are computed by catalog over the same candidate set the cards use (a visible teacher with
an active package in that subject), so they are after the predicate by construction (R-GENDER-3) and match the list
(SC-310; PR #109's review, follow-up 1).

**Rationale.** R-API-6 forbids catalog to reach `users` or `teacher_profiles`; R-GENDER-5's lint rule
(`eslint-plugin-ijazah/rules/require-requester-gender.js`) checks exactly a `*.repository.*` method whose return type
names a teacher, so the identity repository is where the rule bites. The two-step read (identity's visible set, then
catalog's tables) is the form the module walls allow; at the launch cohort's size (hundreds of teachers per gender)
the visible set is one indexed read.

**Alternatives considered.** A database view `visible_teachers` read by catalog: one query, but a view over another
module's tables is a back door the module-tables gate does not see. Copying gender and status into catalog: a cached
copy (R-DB-4) that a suspension must remember to update — the drift the predicate exists to prevent. Scaling past
the two-step read (a join through a view owned by identity) waits for a measured slow query (ARCHITECTURE §17, R-DB-9).

## R-202 — Not found is one shape, and the adversarial suite targets procedures

**Decision.** Every student-facing procedure that names a teacher, a package or a slot by id resolves it through
R-201 first; an invisible owner answers `NOT_FOUND` with the same message and no field, exactly as an id that never
existed (R-GENDER-1/2). `tests/adversarial/gender.spec.ts` gains a procedure-level harness: it seeds the case table's
teachers (both genders, every excluded state including `suspended`, `banned` and, for booking only,
`verification_required`), calls each Phase 2 procedure through the real router as a male and as a female student, and
asserts the visible set, the counts, the 404 for every excluded id, and the absence of any excluded id anywhere in the
serialized response. Phase 1's `VisibilitySubject` table gains the catalog/identity implementation as a subject, so the
inverted subjects keep biting it (FR-211 of Phase 1). The three `it.todo`s at lines 296–302 (404 not 403, crafted
pagination, facets) become cases.

**Alternatives considered.** Testing the repository only: misses a service that forgets to call it (the reason
ARCHITECTURE §10 has three layers).

## R-203 — Name search folds Arabic spelling in the database

**Decision.** No column (PR #109's review, M5; the owner's decision of 2026-11-01): a stored fold would be a derived value R-DB-4 does not
list. `ijazah_fold` is an `IMMUTABLE` SQL function declared by the migration: `lower()`, then `translate()` of أإآ→ا, ى ئ→ي, ؤ→و, ة→ه,
then `regexp_replace` removing the tashkeel range (U+064B–U+065F, U+0670) and tatweel (U+0640). No index: R-DB-9
asks for a measured slow query first, and T057 measures (analysis C1). One kernel query, `idsWithFoldedNamePrefix(tx, candidateIds, typed)` in
`platform/db/folded-name.ts` (raw SQL stays there, R-API-6), applies the one function to both sides,
`ijazah_fold(display_name) LIKE ijazah_fold($typed) || '%' ESCAPE '\'`, the typed text's `%`, `_` and `\` escaped by
`platform/db/like-literal.ts` first, so that a typed `%` or `_` matches only itself (a spec); identity's repository
restricts its page to the ids it returns. The
highlight is computed on the server as the length of the matched prefix in the original name's characters, returned
with the result; the phone marks it. Subject search uses the same function over `subjects.name_ar`/`name_en`, no index
(a few dozen rows).

**Rationale.** One fold, in one place, applied identically to both sides, is the only way FR-333's "same normalisation
on the stored name and the typed text" holds; the fold runs in the query, so it cannot drift
from the name and nothing derived is stored (R-DB-4).

**Alternatives considered.** Folding in TypeScript on both sides: two implementations to keep equal, and no index.
`unaccent`: an extension whose rules are Latin-centred and do not do أ→ا. Trigram search: a different feature (infix,
fuzzy) than the prefix the SRS asks for.

## R-204 — Discovery's shape: one service in catalog, two procedures

**Decision.** `catalog/discovery.service.ts` serves `discovery.browse` (a subject tab or all, the filters, a cursor) and
`discovery.teacher` (the profile). Search is `browse` with a `query`. A page is `discovery_page_size` cards (a new
setting, default 20), keyset-paged on one total order (the owner's decision of 2026-11-01):
`average_rating DESC NULLS LAST`, `review_count DESC`, `display_name ASC`, then the teacher's id `ASC`. The order's keys
are identity's columns (`teacher_profiles`, `users`), so the page is ordered and cut by identity's
`visibleTeacherPage` (R-201) through Prisma, `orderBy: { averageRating: { sort: 'desc', nulls: 'last' } }` as
`modules/verification/verification-requests.repository.ts` line 42 already writes it; catalog computes the candidate
ids its own tables allow (subject, track, riwaya, an active package) among the visible ones and builds the cards of the
page it gets back (the owner's decisions of 2026-11-01, analysis C2; `COALESCE` would need raw SQL outside `platform/db/`, and gives the same order since a
rating runs 1 to 5). A teacher with no review has a NULL `average_rating`, which PostgreSQL sorts first in a descending
order unless told otherwise, so `NULLS LAST` is written in the ORDER BY and its NULL branch in the keyset condition: after
a cursor with a rating, the next rows are a lower rating, or the same rating and a lower count (and so on), or a NULL
rating; after a cursor with a NULL rating, only NULL-rated rows with a lower count, or the same count and a later name,
or the same name and a later id. The id comes last because names repeat: on the name alone a page boundary between two
teachers of one name, rating and count could repeat a card or skip one. The cursor carries the four values, the name
compared in the collation the ORDER BY uses. Three specs: a teacher with no review comes after every teacher with one;
two teachers of one name, rating and count on either side of a page boundary each appear exactly once across the two
pages; a page whose last row is a teacher with no review is followed by a page that repeats and skips no one, since
the next page is cut from that row and that is where `NULLS LAST` can go wrong (the owner's decision of 2026-11-01). A
single 5-star review ranking
above 4.9 from a hundred is a known weakness of this order, recorded as a follow-up in `tasks.md` and not changed now.
Each card carries
the teacher's subjects, track badges (from active packages), the lowest price per session (R-212) and the nearest free
slot (R-205). The subject tabs' counts come with the first page. The riwaya filter's values come from
`discovery.filters({ subjectId })`: the distinct `teacher_credentials.riwaya` of approved credentials of visible
teachers in that subject, folded for matching and shown as typed; the riwaya is never shown on a card or a profile
in this phase (FR-335, FR-336). The rating filter reads `teacher_profiles.average_rating` through R-201's fields.
Every query is under `rate_limit_search`.

**Rationale.** FR-332 to FR-338. One procedure for browse and search keeps the predicate on one path.

## R-205 — The nearest free slot and the booking sheet's slots are booking's

**Decision.** A slot is *offerable* to a student when it is active, its teacher passes R-201 with `purpose: 'book'`,
its length equals the package's, it has no active hold, and it is not *occupied*. A slot is occupied while an
enrollment on it is `pending_payment`, or is `confirmed` and the week after its last session plus
`slot_release_buffer_weeks` has not begun (FR-BOOK-10). The last session's date is read from `sessions` through
`sessions/index.ts` (`lastSessionDateOf(tx, enrollmentIds)`), so booking never reads that table. The booking sheet
(`booking.slots`) also removes the slots whose first occurrence overlaps one of the student's own scheduled sessions,
and returns each slot's preview: first and last session dates by R-209's rule from now. The discovery card's nearest
free slot is the minimum preview first-session instant over the teacher's offerable slots of the lengths of their
active packages, computed by booking for the page's teachers (at most a page). Catalog must not depend on booking, which depends on
catalog, so the discovery procedures are composed in a thin `discovery` router in `booking` that calls catalog's
discovery service for the cards and booking's own reads for the nearest slots, both under the same visible set.

**Rationale.** FR-350, FR-394 and FR-335 need holds, enrollments and sessions, which catalog cannot read. Deriving
occupancy keeps R-DB-4 (no stored "booked" flag on a slot).

**Alternatives considered.** A `booked_until` column on the slot: a cached value with three writers (confirmation,
make-ups in Phase 3, cancellations), the drift R-DB-4 forbids.

## R-206 — A teacher's slots never overlap, checked under a lock

**Decision.** Saving or reactivating a slot takes a transaction-scoped advisory lock on the teacher
(`platform/db/row-lock.ts`, `lockKey(tx, 'teacher-slots', teacherUserId)`, the kernel's raw-SQL helper; R-API-6 keeps
`pg_advisory_xact_lock` there), reads the teacher's other active slots, and refuses an overlap. Overlap is computed on
the week as a circle of 10 080 minutes: a slot is the interval `[d·1440 + start, d·1440 + start + length)` taken modulo
10 080, so Sunday 23:30 for 60 minutes covers `[1410, 1470)` and Saturday 23:30 wraps to `[10 050, 10 080) ∪ [0, 30)`.
All slots of one teacher share the teacher's zone at creation; a slot created before a zone change keeps its zone, and
two slots in different zones are compared in the newer slot's zone for the week of the save, by `packages/time`
(a new export, `weeklyIntervalsOverlap`). The same lock is taken by the slot edit of R-207, and the database's session
exclusion constraints (ERD §15 rule 19) stay the second line (FR-317).

**Rationale.** The owner's decision of 2026-10-31: whole-week overlap in the teacher's zone, the database as second
line. The lock makes two saves at the same moment serialize, so the second line is reached only by a path the lock
does not cover (none in this phase).

**Alternatives considered.** An exclusion constraint on `availability_slots` over an `int4range` of week minutes: it
cannot express the wrap from Saturday to Sunday as one range, and it would need a generated column per slot.

## R-207 — A slot in use keeps its day, time and length

**Decision.** `teacher.slots.update` changes day, time or length only when no active hold and no enrollment in
`pending_payment` or `confirmed` uses the slot; it reads that through booking's entry
(`slotInUse(tx, slotId)`, through the port below) under the lock of R-206, and `checkout.hold` takes the same lock before it inserts, so an
edit and a hold cannot cross. Deactivation is always allowed (FR-314). A package's track and length are frozen once an
enrollment exists, read the same way (`packageHasEnrollment`), and its price change applies to later purchases
because enrollments hold the snapshot (FR-312).

**Rationale.** FR-318, FR-312. Catalog must ask whether a slot or a package is in use without importing booking, so
the check is a dependency inversion: catalog's slot and package services take a `CatalogUse` port (`slotInUse`,
`packageHasEnrollment`) that `main.ts` binds to booking's entry, as Phase 1's `AccountConsequences` registry binds its
subscribers (research R-121 of Phase 1).

## R-208 — Checkout is orchestrated by `payments`; booking owns holds and enrollments

**Decision.** The module graph of this phase: `identity` imports none; `catalog` imports `identity`; `sessions` imports
none (it receives what it generates); `moderation` imports none (it opens a case on an enrollment id); `booking`
imports `identity`, `catalog` and `sessions`; `payments` imports `booking`, `identity` and `moderation`. The student's
checkout procedures (`checkout.hold`, `checkout.pay`, `checkout.retry`, `checkout.status`, `checkout.current`) live in
`payments/checkout.router.ts`, because FR-BOOK-12's new checkout must call `PaymentPort.cancelCheckout` before it may
place a hold, and Pay must call `createCheckout` outside any transaction (ARCHITECTURE §8.1). Every write to
`slot_holds` and `enrollments` is a function of `booking/index.ts` taking the caller's `tx`:
`placeHold`, `releaseHoldsBeforePlacing`, `createEnrollmentOnHold`, `holdStillActive` (the conditional update),
`confirmEnrollment`, `releaseAndCancel`, `cancelPending`, and `recordOrderFailed` for the order events of R-214. ARCHITECTURE §8.1 is followed step by step.

**Rationale.** The README of `payments` already gives it "student: start checkout"; putting the port calls and the
hold writes in one module would make one of them read the other's tables.

## R-209 — Generation: requested local dates, the 24-hour lead, and what the student was shown

**Decision.** `packages/time` gains `firstOccurrenceAfter(slot, { notBefore: UtcInstant, leadHours })` returning the
first local date whose resolved start is at least `leadHours` after `notBefore`, and `resolveOccurrences` gains the
requested local date and time on each `Occurrence` (`requestedLocalDate`, `requestedStartTimeLocal`), because ADR 0009
D1 stores what was asked for, not where a gap moved it. `sessions/generation.service.ts`
(`generateForEnrollment(tx, { enrollmentId, teacherUserId, studentUserId, slot, count, confirmedAt })`) writes one row
per occurrence: `scheduled_date_local` and `scheduled_start_time_local` the requested values, `timezone` the
snapshot's, `scheduled_start_at`/`scheduled_end_at` the resolved cache. The lead is the setting
`first_session_lead_hours` (default 24). At Pay, the enrollment records `quoted_first_session_local_date`: the first
date the student was shown, computed from Pay's instant; the success screen compares it with session 1's
`scheduled_date_local` and says the first session moved when they differ (FR-386).

**Rationale.** FR-368, FR-386, ADR 0009 D1–D2. Keeping the quoted date on the server makes FR-386 hold after an app
restart and on the Confirming path; it is a snapshot of what was shown, not a derived value.

**Alternatives considered.** The phone remembering the date it showed: lost on restart, and a client-held value on a
screen about payment (R-HONEST-1's spirit).

## R-210 — The time zone re-resolution job

**Decision.** `apps/api/src/jobs/reresolve-session-instants.ts` (the `tzdata-reresolve` of ADR 0009 D3) runs at worker
start and daily: it reads `process.versions.tz`, claims an `idempotency_keys` row of scope `tzdata-reresolve` keyed by
that version only after a run commits, recomputes every `scheduled` session's instants in one transaction with the
exclusion constraints deferred (`platform/db/deferred-constraints.ts`, raw SQL in the kernel), and handles a moved
session that would overlap as ERD §15 rule 19 says. Reminders do not exist yet (Phase 4).

**Rationale.** FR-370. No code exists today (searched 2026-10-31).

## R-211 — Session generation proves itself with properties

**Decision.** `fast-check` joins `packages/time`'s dev dependencies. Properties over every zone of
`TIME_ZONE_CITIES` and random slots, lengths and start dates: each occurrence's requested local date is the anchor
plus seven days per step; each resolved start, read back in the zone, is the requested wall time unless the
disambiguation is `shifted_forward`; no two occurrences of one slot overlap. Example tests pin Cairo's 2026 and 2027
changes, the gap and the repeat (SC-303, R-TIME-7).

## R-212 — Money: one division, and the pound format

**Decision.** `packages/money` gains `perSession(total_piasters, sessionCount): Piasters` — integer division rounded
half up to the piaster, for display only (FR-337) — and `lowest(amounts)`; the phone and the panel gain
`formatPounds(amount_piasters, locale)` in their `lib/formatters.ts` (`Intl.NumberFormat`, two decimals in the panel,
none when whole on the phone, `common.format.price`). The package's comment that no operation exists until a
requirement names it is honoured: FR-337 names it.

## R-213 — The stand-in behaves as a gateway at the boundary

**Decision.** `FakePaymentAdapter` (`platform/ports/payment/fake.adapter.ts`) keeps its in-memory orders and its
signing, and gains:

1. A hosted checkout page, `GET /stand-in/checkout/:gatewayOrderId`, served by the API only while
   `PAYMENT_GATEWAY=fake` (refused outside development and test, as `fake` is, `env.schema.ts` lines 322–333),
   with «ادفع» and «فشل الدفع» buttons. Each posts to the page, which signs the matching event with the stand-in's secret
   and sends it **over HTTP** to `POST /webhooks/payment` at the API's own base URL, then shows "return to the app"
   (`ijazah://checkout/return`).
2. A test harness, `tests/support/gateway-stand-in.ts`, that drives a listening app over HTTP: `deliver(event)`,
   `deliverTwice`, `deliverInOrder(events)` (any order), `deliverAfter(event, hook)` (after a hold is expired or
   released), and `tamper` (wrong secret, missing header, body changed after signing). It is the only way the suite
   produces gateway events; no spec calls the webhook's service directly (SC-302).
3. `cancelCheckout` answers configurable per order in tests (`cancelled`, `paid`, `in_progress`, `unsupported`), so
   FR-BOOK-12's three branches are reachable.
4. `recipient_verified`/`recipient_rejected` through the same harness, replacing the hand-built events of
   `recipient-events.spec.ts` (`scripts/dev/emit-recipient-event.ts` already POSTs; it moves onto the harness).

**Rationale.** FR-372 to FR-374, the owner's decision of 2026-10-31.

## R-214 — The webhook records order events and enqueues confirmation

**Decision.** `payments/order-events.service.ts` handles a verified order event in one transaction: insert
`payment_events` (unique `provider_event_id`; a duplicate writes nothing and is answered 200, but a duplicate `paid`
event still enqueues `confirm-enrollment`, so an enqueue lost after a commit is recovered by the gateway's retry;
PR #109's review, M2), then move the `payments` row
monotonically — `created → paid | failed | expired`, `paid → refunded`; a `failed` or `expired` arriving after `paid`
changes nothing — recording transaction id, fee and net only from a `paid` event, and after commit enqueue
`confirm-enrollment({ paymentId })` with the job id `paymentId` for a `paid` event and `expire-pending-payments` work for nothing (the sweep finds
it). A `failed` event appends an `order_failed` outcome through booking's entry, `booking.recordOrderFailed(tx,
enrollmentId, paymentId)`, since `enrollment_events` is booking's table (R-216, R-API-6). The recipient branch of `recipient-events.service.ts`
is unchanged.

## R-215 — `confirm-enrollment`, the expiry sweeps, and their idempotence

**Decision.** Three jobs (`apps/api/src/jobs/`), each with a `runOnceAndTwice` spec:

- `confirm-enrollment({ paymentId })`: ARCHITECTURE §8.1 verbatim. It locks the enrollment row (`lockRows`), returns
  if it is confirmed by this order or a compensation case exists for it; if its `confirmed` event names another order (the
  student paid twice) it opens a `duplicate_payment` case and leaves the enrollment as it is (FR-375); if R-219 cancelled
  it, it takes the refusal branch at once (`party_restricted`, FR-362); before a late branch it checks the parties with
  no new rule, the teacher by R-201's predicate with `purpose: 'book'` and the student by `account_status = 'active'`,
  and takes the refusal branch (`party_restricted`) if either fails; otherwise it then tries one transaction (hold conversion by conditional
  update, or the late branch's release-and-re-hold; `booking.confirmEnrollment`; `sessions.generateForEnrollment`); on a
  database refusal (unique violation on `slot_holds`, exclusion violation on `sessions`) it rolls back and runs the
  refusal transaction (release, `slot_unavailable`, `moderation.openCompensationCase`, a `cancelled` outcome).
- `expire-pending-payments` (every minute): ARCHITECTURE §8.1's enrollment-keyed release, never for an enrollment with a
  `paid` order. It also recovers a lost enqueue by the order, not by the enrollment's status: every `paid` order older than `checkout_confirmation_timeout_seconds` whose enrollment is not `confirmed` and has no compensation case is handed to `confirm-enrollment` (job id `paymentId`, through `payments`' entry), whatever the enrollment's status. A new
  checkout (FR-BOOK-12) or another student's hold (FR-351) may have cancelled that enrollment meanwhile; the job then
  confirms it by the late branch or opens one compensation case by the refusal branch, so a paid enrollment never stays
  cancelled without one (PR #109's review, M2 and round 2 N1).
- `expire-holds` (every minute): releases expired holds with no enrollment.

Their cadence is a cron in the job declaration, as Phase 1's sweeps; every window they read is a setting (R-MONEY-12).

## R-216 — Outcomes are rows of their own

**Decision.** A new append-only table `enrollment_events` (owned by `booking`): `id`, `enrollment_id`, `kind`
(`confirmed` · `order_failed` · `cancelled`), `cancellation_reason` (the enrollment enum, set exactly when `kind` is
`cancelled`), `occurred_at`. UPDATE, DELETE and TRUNCATE are revoked from the application role, as for
`payment_events` (ERD §15 rule 21). Every confirmation, every failed order, every cancellation with each of FR-363's
reasons and `account_deleted` writes one row in the transaction that made it. Phase 4's notification job reads rows
newer than its cursor; nothing in Phase 2's code changes for it (FR-385).

**Rationale.** `payment_events` records what the gateway sent, and is append-only by design; `audit_logs` records what
an administrator did. An outcome of the platform's own job is neither. Reading `enrollments`' current columns would
lose a cancellation that a late payment reverses (FR-PAYG-19).

**Alternatives considered.** A generic outbox: the same table with a less honest name; the queue alone: not durable
across a Redis loss (Phase 0's rule that Redis holds nothing whose loss diverges from the database).

## R-217 — The phone's checkout: hosted page, return, foreground and a bounded schedule

**Decision.** `expo-web-browser` (`openAuthSessionAsync(checkoutUrl, 'ijazah://checkout/return')`) opens the hosted
page in the system browser sheet; its promise resolving is "returned from the hosted checkout". Processing reads
`checkout.status` every `checkout_processing_poll_seconds` (2) until `checkout_confirmation_timeout_seconds` (15);
released with the Confirming state, the enrollment screen and the home read it every
`checkout_confirming_poll_seconds` (30) for at most `checkout_confirming_poll_window_minutes` (10) from the release,
then show FR-384's message. An `AppState` listener reads again on `active`. TanStack Query's `refetchInterval`
returning `false` past the window implements the bound. The four numbers reach the phone through
`platform.publicConfig`, whose output gains them (additive, R-API-9). The countdown on Checkout reads the order's
`expiresAt` from the server and the phone's clock; the difference is computed by a new `@ijazah/time/calendar` export,
`secondsUntil(instant, now)` (R-TIME-1), and keeps running offline (FR-358). Offline is detected by
`@react-native-community/netinfo` feeding TanStack Query's `onlineManager`, so `OfflineBanner` shows (the MainOffline
pattern, used for the first time).

## R-218 — Teachers: profile, packages, slots, students, today

**Decision.** The teacher's public profile fields are identity's columns (`teacher_profiles.bio`,
`qualification_summary`; `users.photo_key`), so `teacher.profile.get/update` live in identity
(`identity/teacher-profile.router.ts`); T158 adds the account tab's entry to the existing `account.updateProfile` for
the display name. Packages and slots are catalog's (`teacher.packages.*`, `teacher.slots.*`, kind
`teacherProcedure({ admits: 'approved' })`: drafting is allowed before payout verification, FR-315). «طلابي» and
«اليوم» are booking's reads (`teacher.students.list/get`, `teacher.today`), the student's name searched through the
kernel's `idsWithFoldedNamePrefix` (R-203). A package's subject must be one of the
teacher's `teacher_subjects` (FR-311, FR-PROFILE-11 as amended).

## R-219 — Account terminations reach holds and pending enrollments

**Decision.** `booking` subscribes to identity's `AccountConsequences` (Phase 1, R-121): on any termination of a
student (`suspended`, `banned`, `account_deleted`) it releases the student's active hold and cancels a
`pending_payment` enrollment on it (`account_deleted` for a deletion, `admin` for a suspension or ban); on a
teacher's (`suspended`, `banned`, `approval_revoked`, `account_deleted`) it releases holds on the teacher's slots and
cancels their pending enrollments (`teacher_suspended`, or `account_deleted`). Each writes an `enrollment_events` row.
A paid event that still arrives for an enrollment cancelled here takes FR-PAYG-19's refusal branch at once: it stays
cancelled and one compensation case is opened (FR-362). FR-PAYG-6 and FR-BOOK-9 are amended to list these releases
(the owner's decision of 2026-11-01, citing FR-VERIFY-8).
FR-AUTH-14's remaining part is not this subscriber's: a deleted student's remaining sessions cancelled
`cancelled_by_admin` and their confirmed enrollments cancelled `account_deleted`, with no compensation case; a deleted
teacher's deletion with FR-SESS-16's effect, compensation cases included. Confirmed enrollments and sessions first exist
in this phase, but cancelling a session is Phase 3's (FR-SESS-16, ADR 0015 D4, ADR 0018 D5), so that part is a task of
its own in `tasks.md`, timed Phase 3's first batch (the owner's decision of 2026-11-01), and falls to neither phase by
omission.

**Rationale.** Phase 1's deletion writes no enrollment (`identity/deletion.service.ts` line 195 calls the registry;
no subscriber touches booking). Without this a deleted student's hold would block a slot until it expires, and a
pending enrollment would outlive its student.

## R-220 — The admin's payments monitor

**Decision.** `payments/payments-admin.router.ts` mounted at `payments` on the admin router: `payments.list`
(status filter, search by order id or student name, keyset pages of `admin_list_page_size`) and `payments.get`
(the order, its events as a timeline, its enrollment summary). Student names come through identity's entry; the
enrollment summary through booking's. Both are `adminProcedure` reads; an `adminProcedure` requires an audit entry
(`procedures.ts` line 535), so each read writes one `payments.viewed` entry with the order as target, as Phase 1's
document viewer does. `AdminNav` gains the entry; `/payments` the page (`DataTable`, `Toolbar`, `FilterChips`,
`Pager`, `Split`, `Timeline`).

## R-221 — The real adapter, if the answers arrive

**Decision.** Nothing in this plan depends on the gateway's identity: the port's operations are those ARCHITECTURE
§3.5 names. If OPEN-11's written answers arrive before the last batch, that batch adds the gateway's member to
`PaymentGateway`, its adapter beside the stand-in, its configuration keys and the sandbox run; otherwise the task is
written into `tasks.md` with its timing before Phase 6 (FR-371).

## R-222 — What Phase 1's follow-ups ask of this plan

**Decision.** The first batches land T123, T126, T129, T133 to T141, T160 and T162 (FR-301). Two of them meet this
plan: T140's migration carries the column checks of [data-model.md](./data-model.md) §2, and since the owner's
decisions of 2026-10-31 it writes `price_piasters > 0` (not `>= 0`) and the lengths `IN (30, 45, 60)` (where T140 left
"durations > 0" open); T140's line is amended to say so. T126's locks are the first use of the kernel's row-lock
helper (`platform/db/row-lock.ts`), which R-206, R-207 and R-215 use too. T142 and T161 land before discovery reads
`teacher_subjects` and before this phase reads the application's states. T145 strips a photo's metadata before
R-204's cards show it. T146's timeouts precede R-217. T143 has no code to change: Phase 1 wrote no predicate, so it is
implemented by writing R-201's repository with the fifth conjunct and its adversarial cases, before any code reads it.
No code of this phase suspends or bans an account (R-219 only reacts to identity's registry, which `StandingService`
calls), so T144's part here is this plan naming it; it stays open for Phase 3's plan.
