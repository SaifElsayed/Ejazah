# Designing Ijazah admin web pages

First read `BRIEF.md` in the same folder: the tools, the rules, the "no literal values" law and the build/lint/check/look
loop all apply unchanged. This file adds what is specific to the admin web panel.

## What the admin panel is
A desktop web app (1440×900 boards) for the platform's internal operators. Decided by the owner (ADR 0014): it uses
the **same design system** as the phone app (same tokens, colours, components; gold only for ijazah/isnad surfaces) and
is in **Arabic (default, RTL) and English (LTR)**. User content (names, reasons, chat lines, isnad names) stays exactly as
typed — mostly Arabic — even on English pages (wrap such runs in `<bdi>` on English pages).

## Reference
- `frags/AdminApplications.html` — the reference admin page. Copy its structure exactly:
  `<div class="console" dir="rtl" data-theme="light">` → `{{ADMINNAV:<ThisBoard>:ar}}` → `<main class="page">` →
  `page-header` → `page-body` → `toolbar` → `split` (`split__list` with `table-wrap`/`table`, and `split__detail` with a `panel`:
  `panel__header`, `panel__body` of `section`s with `group-label` headings, `panel__footer` with actions and `panel__note`).
- The admin components are at the end of `ijazah-design/project/ds/ijazah/components.css` (section "Admin web"):
  `console sidebar nav-item page page-header page-body toolbar split table-wrap table table__row--selected table__num
  table__end table__wrap table-footer panel kv kv--3 kv__item kv__label kv__value doc-thumb queue-card meter dialog auth-card`.
  Everything else (btn, badge, segmented, chip, field, input, list, summary, banner, card, avatar, icon-tile, timeline,
  chain, stats…) is the same as on the phone.
- Build: `node tools/mkboard.js <Board> "<canvas title>" light frags/<Board>.html 1440 900`. The canvas entry already exists
  (titles are in `ijazah-design/project/canvas.json`; use that title).
- `{{ADMINNAV:<ActiveBoard>:ar|en}}` draws the sidebar with the active item and the language switch. For an English page use
  `dir="ltr"` on the root and `:en`.

## Rules for admin pages
- Every destructive or binding action (reject, ban, suspend, revoke, bar, resolve a dispute, correct gender, remove a review
  comment, change a setting) needs a reason; show the reason field in the panel or dialog, and say it is recorded in the
  audit log. Never show an action the SRS does not give the admin (no "grant ijazah", no "refund", no "edit document").
- Money: read-only. No button anywhere moves, holds or refunds money. Amounts in EGP (ج.م), from the gateway record.
- Lists are `table`s; the selected row has `table__row--selected` and its detail is the `panel` on the side.
  Filters that pick one state are a `segmented`; free filters are `chip`s; search is `input-group input-group--surface toolbar__search`.
- Status = `badge`. Data counts in the sidebar must match the page (the sidebar shows: applications 3, disputes 2,
  gender 1, session review 2, reports 4, reviews 1).
- Dates: today is Thursday 15 October 2026. Times are Cairo time.
- Keep data consistent with the phone screens and with each other. People and facts to reuse:
  - Teachers: الشيخ أحمد السيد (verified isnad, حفص عن عاصم, rating 4.9 from 86, packages تسميع أسبوعي 8×45د 1,200 ج.م and
    مراجعة مكثفة 12×60د 2,160 ج.م), الشيخ محمود فتحي (التجويد), الشيخ خالد عبد العزيز (isnad not verified), الشيخ عمر حسن.
  - Students: يوسف محمد (yousef@example.com, male, Cairo, signed in with Google; enrolled in تسميع أسبوعي with الشيخ أحمد السيد,
    Wednesdays 6:00 م, 8 sessions 14 Oct → 2 Dec, order IJZ-2026-004812 paid 13 Oct 2:14 م, 3 of 8 done at the time of the
    phone screens), سعيد منصور (مراجعة مكثفة, 12/12 done), عمر سامي, حسن إبراهيم (asked to cancel a session), عبد الرحمن علي,
    مصطفى كمال, زياد طارق.
  - Applicants: الشيخ ياسر حمدي, الشيخة منى عبد الرحمن (in review), الشيخ إبراهيم صالح (more info requested on 15 Oct:
    unclear back of ID + the tajweed ijazah).
  - Certificate numbers: 16 Crockford base32 chars as 4-4-4-4, e.g. `7K4Q-MZ2A-H8MN-B2XN` (حفظ جزء عمّ, granted by
    الشيخ أحمد السيد to يوسف محمد after مراجعة جزء عمّ, 21 Aug 2026) and `B2XN-H8MN-7K4Q-QW3R` (التجويد, الشيخ محمود فتحي, 3 May 2026).
  - The admin signed in is سارة عادل (Sara Adel).
- Settings are exactly SRS §3.14 with their defaults: attendance threshold 70%, join window 10 min, minimum connection
  60 s, early-join lead 15 min, teacher no-show termination 2, dispute window 72 h, checkout hold/order TTL 10 min,
  hold grace 5 min, checkout confirmation timeout 15 s, idempotency key retention 24 h, slot release buffer 0 weeks,
  reminder offsets 24h and 15m, chat retention beyond the dispute window 0 days, currency EGP. Changes apply only from
  now on (never retroactively) and are audit-logged.
- Session statuses (ERD): scheduled, done, student_no_show, teacher_no_show, both_no_show, under_threshold,
  provider_outage, cancelled_by_agreement, cancelled_by_admin. Enrollment statuses: pending_payment, confirmed,
  completed, terminated_no_show, cancelled. Payment statuses: created, paid, failed, expired, refunded; webhook events:
  paid, failed, expired, refunded, recipient_verified, recipient_rejected. Dispute resolutions: upheld, re_marked,
  no_show_recorded, compensation_ordered, party_suspended, party_banned. Gender flag outcomes: corrected (honest error:
  non-compliant enrollments are cancelled and compensation cases open), fraud_ban (account banned, all enrollments
  cancelled, compensation cases open), dismissed. Report contexts: session, profile, chat. Account status: active,
  suspended, verification_required, banned; each role (student, teacher) can be suspended on its own.
- If the page does not fit, the table may be cut (show "x من y" in `table-footer`) and the panel body may continue
  below the fold (it scrolls), but the panel footer with the actions must be visible.

When done, report per board: lint and check results, any content you had to decide, and any component gap
(do not edit shared files).
