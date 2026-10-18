# Quickstart: Validating Phase 1

**Feature**: `specs/002-identity/` · **Date**: 2026-10-17

How to prove Phase 1 works. Unlike Phase 0, this phase has journeys: a person
signs in, a teacher applies, an admin approves. So "working" means two things:
**the journeys complete on a real device**, and **the machines still refuse
what they refuse**. Each section maps to success criteria in
[spec.md](./spec.md). The device steps are the owner's own (SC-101, SC-105);
everything else is a command.

---

## Prerequisites

- Phase 0's quickstart §1 (a running, seeded system); re-run `pnpm db:reset`
  after this phase's migrations land, since the seed gains settings rows.
- A physical iOS device and a physical Android device with Expo's development
  client installed (`docs/RUNBOOK.md`, "Local setup", the mobile section this
  phase adds).
- No third-party credential. The sign-in port and the email port run as
  stand-ins; a development build of the app offers the fake provider token
  behind its development flag, and every mail lands in `.storage/mail/`.

---

## 1. The machines first (SC-104, SC-106, SC-107, SC-113)

```bash
pnpm db:migrate && pnpm db:seed
pnpm db:schema:check
pnpm test:db-integrity          # rules 22 to 32 each refused
pnpm lint && pnpm lint:types     # zero raw colour or spacing outside design/
pnpm check:magic-numbers         # zero literals under the modules
pnpm check:i18n && pnpm check:i18n:admin
pnpm test                        # includes the leak test and the gender-input test
pnpm exec tsx scripts/authz-test-gate.ts
```

**Expected**: every command green; `contract-snapshot.json` lists every
procedure with an output; the leak test and the gender-input test pass; the
authorization-test gate finds every non-public procedure covered.

**Watch one go red**: add a `dateOfBirth` field to any output schema but
`account.me`'s and run the leak test; remove a refusal spec and run the gate.

---

## 2. Sign in and become one account (SC-103)

On the device, in Arabic: continue with the fake Google token → Role →
profile → confirm gender → the student home's empty state. Then:

```bash
pnpm exec tsx scripts/dev/count-person.ts --email <the address>
```

**Expected**: one `users` row, one `auth_identities` row, one `user_roles` row,
one `terms_acceptances` row, one `user_sessions` row. Now sign in on a fresh
install, abandon at the profile step, and run the count again for that address:
**zero rows in every table**. Switch the language from the account tab: the
app follows at once, signed in.

The email path: sign up with an address, read the code from `.storage/mail/`,
complete onboarding; request a reset for an address that does not exist and for
one that does: the same sentence both times.

---

## 3. Apply as a teacher, review as an admin (SC-101, SC-102, SC-108)

**The owner's step (SC-101)**: on each device, from a fresh install, sign in
with the fake provider, choose teacher, confirm, and apply with two subjects,
one identity PDF and two credential PDFs. Time it; under ten minutes. Record
the run.

In the admin panel (`http://localhost:5173`, the seeded admin, the second factor
set up on first sign-in — save the ten codes):

1. Open the application; try **Approve**: disabled, and a direct call answers
   `APPROVAL_BLOCKED` with `call_not_recorded`.
2. Request another document; on the device, see `ApplicationMoreInfo`, re-upload,
   resubmit; the application is back in the queue.
3. Review both credentials: transcribe one and approve it, reject the other
   with a reason. Record the verification call. **Approve** is enabled;
   approve.
4. On the device: `ApplicationApproved` once, then the tabs; the credentials
   page shows one approved chain, read-only, and the rejected one with its
   reason.

```bash
pnpm exec tsx scripts/dev/audit-tail.ts --last 10
```

**Expected**: every action above has an entry with a non-empty `target_label`
of the form «طلب انضمام · {id}», never a name; rename the teacher from the
account tab and read the tail again: the labels are unchanged, the resolved
name beside them is new.

---

## 4. The admin's own sign-in (SC-109)

```bash
pnpm exec tsx scripts/dev/admin-lockout-probe.ts
```

The probe signs in with a wrong password five times, then a sixth, then with
the right password, measuring each answer. **Expected**: the five and the sixth
answer the same body and status; the right password during the lockout answers
the same; the timing spread is within the probe's tolerance; no response
carries a count. After fifteen minutes (or `admin_lockout_minutes` lowered in
the seed for the probe), the right password signs in. Then: sign in with a
recovery code; have a second admin (add one from `/settings/admins`, read the
invite from `.storage/mail/`, set its password) reset the first's second
factor; the first's open session is gone and the next sign-in is setup.

---

## 5. Delete an account (SC-111)

On the device: Account → Delete account → type the word → re-authenticate with
the fake provider → confirm. Then:

```bash
pnpm exec tsx scripts/dev/count-person.ts --user <id>
```

**Expected**: the `users` row has `deleted_at` set and every personal field
null; zero `auth_identities` rows; every `user_sessions` row revoked; the
refresh token the device held answers `UNAUTHENTICATED`; a new sign-up with the
same email succeeds. On the web: `http://localhost:3000/delete-account`, the
address, the code from `.storage/mail/`, the done page; the response headers
carry the CSP and no `Set-Cookie`.

---

## 6. Payout, against the stand-in (SC-110)

On the device, as the approved teacher: `PayoutStart` → register with the
provisional details → `PayoutSetup` (pending). Then:

```bash
pnpm exec tsx scripts/dev/emit-recipient-event.ts --teacher <id> --verdict rejected --reason "name mismatch"
pnpm exec tsx scripts/dev/emit-recipient-event.ts --teacher <id> --verdict verified
pnpm exec tsx scripts/dev/emit-recipient-event.ts --teacher <id> --verdict verified   # the same event id: a replay
```

**Expected**: `PayoutRejected` with the reason and the support address, then
`PayoutVerified`; the replay changes nothing (one `payment_events` row for that
event id). Between the two, a direct call to a `publishable` procedure (none
exists in this phase; the kind's spec stands in) answers `FORBIDDEN`.

---

## 7. Both languages, both platforms (SC-105)

**The owner's step**: on each device, walk every screen of this phase in Arabic
and in English, against its board in `docs/design/frames/`. Record the result
per screen. `pnpm check:i18n` and `pnpm check:i18n:admin` report zero
difference.

---

## 8. The register (SC-112)

Read `specs/001-foundations/checklists/rule-proofs.md` after the re-count task:
R-GENDER-6, R-MOBILE-13, R-HONEST-4, R-GENDER-1 and R-GENDER-3 are proven,
each citing its test; the rows left open name Phases 2 to 4 only. Then:

```bash
pnpm test:adversarial
```

**Expected**: green, with the two inverted subjects shown to bite in both
directions in the suite's own output.

---

## 9. No credentials required (SC-114)

```bash
pnpm test
```

With every provider key unset (the test setup strips them). **Expected**: green.
