# Production pass — shared rules for every agent

S = `C:/Users/amrkn/AppData/Local/Temp/claude/D--Ejazah/c3bd6a6a-9b5f-4684-afd6-90b8324af08a/scratchpad`
Read first, fully: `S/BRIEF.md` (phone build rules), `S/BRIEF-ADMIN.md` (admin build rules), then
`S/ijazah-design/project/ds/ijazah/components.css` (the whole vocabulary; note the new last section
"Production states": `.empty-state`, `.input--error`, `.otp__cell--error`, `.banner--danger`, `.banner--info`,
`.state-hero`, `.choice` (+`__mark`, `--selected`, `--danger`), `.certificate-preview` (+`__title`, `__footer`,
`--revoked`), `.signature-pad` (+`--done`), `.pager` (+`__page`, `__page--current`), `.doc-viewer` (+`__page`),
`.dialog--wide`, `.list__row--selected`, `.list__row--danger`), `icons.json` (new: chevron-down pencil pen-line
wifi-off video mic-off refresh-cw info file-text triangle-alert eye-off user-x rotate-ccw globe share key-round
hourglass circle-check circle-x scale copy ellipsis-vertical bell-off).
Requirements: `D:/ej-ijazah/docs/SRS.md`, `D:/ej-ijazah/docs/ERD.md`. Every board's current text is in `S/audit/all.txt`.

Build, lint, check, look exactly as BRIEF.md says (`node tools/mkboard.js Name "Title" light frags/Name.html`
for phone; admin boards add `1440 900`). Every board you create or touch must end `lint: clean` and `RESULT {}`.
**Never edit**: components.css, tokens.*, icons.json, tools/, canvas.json, or any frag not assigned to you.
If a class is truly missing, use the closest one and list the gap in your report. Delete your PNGs.

## Product rules (from the SRS; do not invent beyond them)
- **A package has no name.** ERD `packages` = subject, session count, duration, price, is_active. Show a package as
  «حفظ القرآن · 8 جلسات · 45 دقيقة» (or shorter «حفظ القرآن · 8 جلسات» in tight rows). Remove names like
  «تسميع أسبوعي» / «مراجعة مكثفة» from every screen you own. Packages are «فعّالة» or «موقوفة» (no draft/archived tabs).
- **Subjects** are an admin list (`subjects.name_ar`). Use exactly: «حفظ القرآن», «التجويد», «القراءات». The riwaya and tariq belong to a teacher's approved credential
  (ADR 0017) and appear with that credential and its ijazahs («حفص عن عاصم · من طريق الشاطبية»); never on packages or
  filters. No scope («جزء عمّ»). Discovery filters only by subject.
- **Enrollment status words** (same everywhere, app and admin): Pending-Payment «بانتظار الدفع», Confirmed «جارٍ»,
  Completed «مكتمل», Terminated-No-Show «انتهى لغياب المعلم», Cancelled «ملغى». A «قيد التأكيد» badge only for the
  ProcessingDelayed case.
- **Session status words**: Scheduled «قادمة», Done «تمت», Student-No-Show «غياب الطالب», Teacher-No-Show «غياب المعلم»,
  Both-No-Show «لم يحضر أحد (لا تُحتسب)», Under-Threshold and Provider-Outage → user sees «قيد المراجعة» (admin sees
  «أقل من حد الحضور» / «انقطاع الخدمة»), Cancelled-By-Agreement «أُلغيت بالاتفاق», Cancelled-By-Admin «ألغتها الإدارة»,
  Disputed «محل نزاع».
- **Cancellation** = a request with a reason; the other party accepts or declines; it expires at the session start.
  No refund button anywhere for users; reimbursement is an admin compensation case.
- **No rescheduling, no enrollment cancellation by the student, no wallet/balance/earnings, no recording, no guardian,
  no uploaded certificates, no phone sign-in.** (SRS §13.)
- **Formats**: Latin digits everywhere; percent «%»; money in the app «1,200 ج.م»; money in admin tables always two
  decimals «1,200.00 ج.م»; progress «3 من 8»; dates «الأربعاء 4 نوفمبر» (Gregorian, Arabic month names, never numeric
  like 12/03/2004); time zone shown as a city «القاهرة», never `Africa/Cairo`.
- **Terms**: the join lead/window is «مهلة الدخول»; «جلسة» (session), «اشتراك» (enrollment), «باقة» (package),
  «إجازة» (ijazah), «سند» (isnad). Female forms for female people («طالبة», «معلمة»).
- **Isnad display** (owner decision 2026-10-13, as on the certificate): origin first — رسول الله ﷺ at the top, descending generation by generation to the teacher at the bottom.
- **No backend leaks on screen**: no requirement ids, no snake_case values, no webhook/server/signature/idempotency/
  encryption wording, no `evt_` ids, no designer notes. Write what the person needs to know, in plain Arabic.
  Admin may see order references (IJZ-…), transaction ids (TXN-…), audit ids (AUD-…).
- **Every href must point to a board that exists** (list them with `ls S/ijazah-design/project/*.dc.html`, plus the
  boards other agents are creating, listed in your prompt). An action that opens a sheet/dialog links to that board.
  A control that only changes state in place (toggle, segmented, filter chip) is a `<button>`, not a dead link.
  Never `href="#..."`.
- **Personas** (keep consistent): student يوسف أحمد (male, Google sign-in, yousef@gmail.com, joined 2 فبراير 2026);
  teacher الشيخ أحمد المصري (male, approved, payout verified). Email/password flows (EmailSignIn/Up, Otp, Reset,
  SignInConflict) use the persona خالد منصور khaled.mansour@example.com. Phone "now" = الأربعاء 4 نوفمبر 2026;
  admin "now" = الخميس 15 أكتوبر 2026.

## Report back (short)
Boards created (name, title, size), boards edited, every href target you used that you did not create, every gap
(missing class) with the class you would add, and anything in the SRS you could not satisfy.
