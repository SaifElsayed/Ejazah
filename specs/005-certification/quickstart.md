# Quickstart: validating Phase 4 (lightened)

Run on `ijazah_integrity` only (`. ejazah-tools/test-env.sh`, `IJAZAH_DB_SPECS=1`), with `PUSH_PROVIDER=fake`,
`VIDEO_PROVIDER=fake` and the Typst binary on the path (`TYPST_BIN`, R-401). Contracts:
[app-surface.md](contracts/app-surface.md), [admin-surface.md](contracts/admin-surface.md), [jobs.md](contracts/jobs.md).

## 1. The machines
- `pnpm typecheck`, `pnpm lint` (CI), `pnpm contract:snapshot --check --base develop`.
- The changed modules' specs, `pnpm test:adversarial`, the jobs' double-run specs, and the template spec (chains of 1,
  25, 60 and 61 generations, a hostile name).

## 2. The certificate, end to end
1. A seeded approved teacher with an approved credential and an ijazah-track enrollment: `teacher.ijazahRequests.send`
   with no signature answers `no_signature`.
2. Upload a signature; send again. With no certificate name the request is `awaiting_student_name`; the student sets
   it; the request becomes `pending`.
3. Ban the teacher; the request stays `pending`, and `ijazahRequests.get` shows the standing (FR-628).
4. Approve as an administrator. The ijazah row exists with its number, frozen chain and names; `render-certificate`
   runs, and `certificates.link` answers `not_ready` to both parties. Delete the teacher as an administrator: refused
   `pending_ijazah_requests` (FR-630).
5. As the administrator, open the PDF from `ijazahs.get` and call `ijazahs.signOff`: `certificates.link` now opens the
   PDF for both parties. A third user gets NOT_FOUND.
6. Revoke it: both parties see `revoked: true`, `certificates.link` answers `revoked`, and the student's public
   credentials no longer list it.
7. Bar the student: a new request answers `student_barred`; lift the bar: accepted.

## 3. Reports and gender
1. Report from a session, a chat and a visible profile; a sixth report within a day answers `RATE_LIMITED`.
2. A report on a session holds its chat past `purge-chat`'s window.
3. Flag a student with two enrollments and correct their gender: both enrollments end `gender_correction`, a case
   each, and `sessions.restore` refuses them.
4. Flag a teacher and find fraud: the teacher is banned, every counterparty enrollment has a case under the ban's own reason (`student_banned` or `teacher_ended`, R-409), and
   lifting the ban checks each pairing.

## 4. Push (stand-in, then the phones on 11/20 if P2's build exists)
1. Register a token; book a session 25 hours ahead; at 24 hours `session_reminder` is recorded once per party and
   delivered once. A second sweep run writes nothing.
2. Request a cancellation: `cancellation_requested` to the other party; answer it: `cancellation_request_accepted` or
   `_declined` to the requester.
3. Confirm, fail and expire a payment on the gateway's stand-in: one notification each.
4. Mark the stand-in failing: delivery retries, and the request that produced the notification succeeded.

## 5. Settings
Change `chat_retention_days` and `rate_limit_user_report` from the panel. A value outside its bounds is refused; a
valid one is audited with before and after, and the next read uses it.
