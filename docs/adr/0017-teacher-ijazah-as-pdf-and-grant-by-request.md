# ADR 0017 — A teacher's own ijazah is a PDF the admin reviews, and a student's ijazah is issued on the teacher's request

**Status:** accepted · **Date:** 2026-10-15 · **Decided by:** the owner, 2026-10-15 · **Amends:** SRS §3.2 FR-VERIFY-1/2, §3.3 (adds FR-PROFILE-11), §3.9.1 (FR-ISNAD-1..7), §3.9.2 (FR-IJAZAH-1, -2, -7, -11, -12; adds FR-IJAZAH-15), §3.11 (FR-ADMIN-2, FR-ADMIN-12; adds FR-ADMIN-19), FR-NOTIF-1, §6, §7, §8, UC-1, UC-7, DEC-09, DEC-41, DEC-42 (adds DEC-57); ERD catalog and certification tables; ADR 0004 (chain length)

## Context

Under SRS §3.9 the teacher types their own chain of transmission name by name,
and the admin verifies it. The teacher then grants a student's ijazah alone.

The owner wants the MVP simpler and more trustworthy:

- **The teacher's own ijazah.** It was issued elsewhere, on another design, and
  is uploaded as a PDF only. This happens when applying, and again when the
  teacher wants to teach another subject. The admin reviews it, and on
  acceptance it joins the teacher's file. Entering an ijazah electronically,
  name by name, is not in the MVP.
- **A student's ijazah.** The teacher asks the administration for it. The
  platform's template is filled with the teacher's data and the student's name,
  the admin accepts the request, and the ijazah becomes the student's.

The certificate template is the one ADR 0004 adopted. Its v2 tree layout is the
working template until the redesign. A chain can be longer than 35 men, and the
system must accept that.

## Decision

### D1 — The teacher's own ijazah is a PDF credential, one per subject

**What the teacher uploads:**

- **When.** At application, one ijazah PDF per subject applied for
  (FR-VERIFY-1/2). After approval, a new subject can be added with its PDF
  (D2).
- **Format.** PDF only, validated and stored like every verification document
  (NFR-SEC-2/3/9).
- **No typed chain.** The teacher types no chain anywhere.

**What the admin does with it:**

- Reviews each credential: approve, reject with a reason, or request another
  document.
- On approval, transcribes from the PDF, once:
  - the riwaya;
  - the tariq, where there is one;
  - the chain, origin first. Each entry is a generation holding one or more
    names (ADR 0004 D3).
- There is no maximum length.

**What the transcription becomes:**

- It is that teacher's verified chain for that subject.
- The teacher's public profile shows it as verified. Only approved credentials
  are shown.
- The teacher cannot edit it. A correction is the admin's, recorded in the
  audit log.

### D2 — A new subject after approval

1. The teacher chooses the subject and uploads its ijazah PDF.
2. The credential waits for review.
3. Once approved, the subject is the teacher's. Packages for it can be
   published, under FR-PAYG-14 as before.
4. A rejected credential leaves the subject unavailable, with the reason shown.

### D3 — A student's ijazah is issued on the teacher's request

**The teacher's request.** The teacher sends it from the student's enrollment,
with:

- the completion date;
- the certificate language (FR-LOC-4).

The subject and the student come from the enrollment.

**What the request needs first:**

- an approved credential for that subject (D1);
- the teacher's signature image (FR-IJAZAH-12);
- a student who is not barred (FR-IJAZAH-9).

**Before sending.** The teacher sees the certificate as it will be filled.

**The admin's review:**

- The admin sees the request and the same filled template:
  - the stored chain, with the teacher appended (FR-ISNAD-7);
  - the student's name;
  - the dates in Hijri and Gregorian.
- **Approve.** This issues the ijazah: certificate number, QR, PDF, then both
  parties are notified.
- **Reject.** This needs a reason, and the teacher is notified.

**Limits on the admin:**

- The admin cannot start a grant. An ijazah is issued only on a teacher's
  request.
- The admin cannot change the chain on a grant. Chain corrections belong to the
  credential (D1).

### D4 — Chains of any length

The template accepts a chain of any length; 35 men is not a limit.

- **Up to 60 generations.** The tree fits one A4 page by tightening its columns
  and type, as ADR 0004 measured: 25, 35 and 60 men each on one page.
- **Beyond 60.** The chain continues on a following page, in the round-1 list
  style, which Typst paginates natively.

The verification page lists the whole chain at any length.

### D5 — Data

- **`teacher_credentials` (new).** It records:
  - teacher;
  - subject;
  - document (→ `verification_documents`);
  - riwaya and tariq;
  - status (pending, approved or rejected);
  - review reason;
  - who reviewed it, and when.
- **`isnad_entries`.** Re-keyed to the credential. One row per generation,
  holding one or more names (ADR 0004 D3). There is no `verification_status`:
  a chain exists only on an approved credential.
- **`ijazah_requests` (new).** It records:
  - enrollment, teacher, student and subject;
  - completion date and language;
  - status (pending, approved or rejected);
  - reason;
  - who decided, and when;
  - the issued ijazah.
- **`ijazahs`.** Gains `request_id` and `issued_by_admin_id`.
  `chain_snapshot_json` stays the immutable record (FR-ISNAD-7).

All of these land with forward migrations in the Phase 1 ERD pass (credentials)
and the Phase 4 pass (requests). Prisma already holds `IsnadEntry` and
`chainSnapshot` in the immutable init migration (ADR 0004 Consequences).

## Consequences

- **SRS.**
  - §3.9.1 is rewritten, along with FR-VERIFY-1/2, FR-IJAZAH-1, -2, -7, -11
    and -12.
  - New requirements: FR-PROFILE-11, FR-IJAZAH-15 and FR-ADMIN-19.
  - FR-ADMIN-2, FR-ADMIN-12 and FR-NOTIF-1 gain the new queues and events.
  - §6, §7, §8, UC-1 and UC-7 change.
  - DEC-09, DEC-41 and DEC-42 are amended, and DEC-57 is added.
- **ERD.** As D5.
- **Design, teacher app:**
  - The application's isnad step becomes one ijazah PDF per subject.
  - «سندي» becomes the teacher's credentials, with «إضافة مادة».
  - Granting becomes «طلب إجازة»: the details, a preview, then sent. The
    enrollment shows the request's status.
- **Design, admin:**
  - The isnad review becomes a credential review (PDF beside the transcription
    form).
  - A new queue reviews grant requests, with the filled template.
- **Design, student.** The certificate is shown as the template page, with its
  PDF.
- **Work.** Phase 4 keeps its slot. The grant becomes a request plus an admin
  issue, which is the same generation code behind one more step.
