# Certification redesign (ADR 0017) — shared brief

S = `C:/Users/amrkn/AppData/Local/Temp/claude/D--Ejazah/c3bd6a6a-9b5f-4684-afd6-90b8324af08a/scratchpad`
Read first: `S/BRIEF.md`, `S/BRIEF-PROD.md` (product/format rules), `S/BRIEF-COPY.md` (no backend mechanics in copy),
and for admin `S/BRIEF-ADMIN.md`. The decision: `D:/ej-ijazah/docs/adr/0017-teacher-ijazah-as-pdf-and-grant-by-request.md`
and SRS §3.9 in `D:/ej-ijazah/docs/SRS.md`. Read the whole of `ijazah-design/project/ds/ijazah/components.css`.

## The new model (owner's decision)
- A teacher's OWN ijazah is a **PDF**, one per subject, uploaded at application or when adding a subject later.
  The teacher types **no chain**. The admin reviews the PDF, approves/rejects/requests another document, and on approval
  transcribes once: riwaya (e.g. «حفص عن عاصم»), tariq (e.g. «الشاطبية», optional), and the chain origin-first as
  **generations**, each holding one or more names (the Companions are one generation of several names). No maximum length.
- A STUDENT's ijazah: the teacher **requests** it from the student's enrollment (completion date + certificate language),
  sees the filled certificate, sends. The admin sees the same filled certificate and **approves** (issued, both notified)
  or **rejects with a reason**. The admin cannot start a grant or change the chain on a request. Needs: approved credential
  for the subject, signature uploaded, student not barred.
- The certificate is the agreed template (A4 portrait, tree chain, Hijri + Gregorian dates, signature, seal, QR, number).
  Show it with the component `.certificate-page` holding
  `<img class="certificate-page__image" src="/_blob/442cea3ed62d4e620fed1cca3317fff6" alt="…">` (that is the real template
  page; use exactly this src). `.certificate-page--revoked` dims it; `--compact` makes a thumbnail.
- Riwaya is real data now (on the credential): show «حفظ القرآن · برواية حفص عن عاصم» where the ijazah is named.
- Persona data: teacher الشيخ أحمد المصري — approved credential «حفظ القرآن · حفص عن عاصم · من طريق الشاطبية» (34 generations
  + the teacher = 35 men), and «التجويد» credential **قيد المراجعة**. Student يوسف أحمد, completed enrollment for the request.
  Certificate number on the template image: 7K3M-Q9TD-2XWB-8HRN (use this number for the حفظ القرآن ijazah everywhere).

## Board renames already done (use the new names; old names no longer exist)
Isnad→TeacherCredentials · ApplyIsnad→ApplyIjazah · Granting→IjazahRequest · GrantingPreview→IjazahRequestPreview ·
GrantingDone→IjazahRequestSent · GrantingBlocked→IjazahRequestBlocked · AdminIsnad→AdminCredentials.
New admin nav items exist: «مراجعة الإجازات» (AdminCredentials), «طلبات الإجازة» (AdminIjazahRequests).

Build each board: `node tools/mkboard.js <Name> "<Title>" light frags/<Name>.html [1440 900]` (new boards) or
`node tools/rebuild.js <Name>` only if the name is unique as a prefix (it matches by prefix!) — safest is mkboard with the
title from `ijazah-design/project/canvas.json` (new boards: your own title). `node tools/lint.js <Name>` → clean;
`sh tools/check.sh <Name>` → `RESULT {}`. Never edit components.css, tokens, icons, tools/, canvas.json, or other agents'
boards. Memory is limited: at most one screenshot at a time, delete PNGs. Report: boards created/edited, hrefs to boards you
did not create, class gaps.
