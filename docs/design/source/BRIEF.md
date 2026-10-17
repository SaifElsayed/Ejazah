# Converting Ijazah screens to the design system

Work directory (call it S): `C:/Users/amrkn/AppData/Local/Temp/claude/D--Ejazah/c3bd6a6a-9b5f-4684-afd6-90b8324af08a/scratchpad`
Use the Bash tool (Git Bash) with `cd "$S"` style absolute paths. A static server already runs on http://127.0.0.1:48731 (do not start or stop it).

## Goal
Each phone screen of the Ijazah app (Arabic, RTL, 390×844) was drawn with inline hex colours and pixel values.
Rebuild your assigned screens so that **every** colour, size, radius, font size and spacing comes from the
design system, with no literal values, and every element is a named component. Keep the content.

## The design system (read all three before writing anything)
- `ijazah-design/project/ds/ijazah/tokens.json` — every value. (`tokens.css` is generated from it.)
- `ijazah-design/project/ds/ijazah/components.css` — every component class. Read it fully; it is the vocabulary.
- `ijazah-design/project/ds/ijazah/icons.json` — the only icons allowed (Lucide names).

Reference screens already converted (read their fragments in `frags/` and copy their patterns exactly):
- `frags/Welcome.html` — header-less flow screen (`screen__body--bare`), segmented language switch, sign-in buttons.
- `frags/Main.html` — student tab root: `app-header`, cards, progress, stats, `{{TABS:student:Main}}`.
- `frags/TeacherHome.html` — teacher tab root: `app-header`, flush body, agenda, `{{TABS:teacher:TeacherHome}}`.
- `frags/Granting.html` — pushed flow screen: `nav-header` with back + steps, field, segmented, check-row, `action-bar`.
- `frags/BookingSheet.html` — bottom sheet over a dimmed screen: `behind-sheet`, `scrim`, `sheet`, `slot`, `banner`.
- `frags/SessionRoom.html` — dark screen (`data-theme="dark"`), video tiles, call controls.

## How to build a screen
1. Read the old screen: `old/<Name>.dc.html` (the original with inline styles). Keep its title, every piece of
   copy, every link (`href`), every `aria-*` label and the same data, unless the fixes below say otherwise.
2. Write `frags/<Name>.html` — just the root `<div class="screen" dir="rtl" data-theme="light|dark">…</div>`.
   Placeholders: `{{SB}}` = status bar (first child, always), `{{icon:NAME:SIZE[:medium|heavy|solid|filled]}}`
   = an icon from icons.json (sizes xs sm md lg xl 2xl), `{{TABS:student|teacher:ActiveBoardName}}` = the tab bar.
   A screen with state (only WriteReview) also gets `frags/<Name>.js` holding the `class Component extends DCLogic {…}`.
3. Build: `node tools/mkboard.js <Name> "<old <title> text>" light frags/<Name>.html`
4. Lint: `node tools/lint.js <Name>` → must print `lint: clean`.
5. Check: `sh tools/check.sh <Name>` → must print `RESULT {}` (no clipping, no touch target under 44px,
   body not overflowing). If the body overflows because the list is long, cut the least important repeated
   item rather than shrinking anything.
6. Look: `sh tools/shot.sh shot-<Name>.png <Name> 420 900` then Read the PNG and compare with the old screen
   (`sh tools/shot.sh old-<Name>.png <Name> 420 900` does NOT work for old files; just reason from the old markup).
   Fix anything that looks broken. Delete your PNGs when done.

## Rules (these are what the review checks)
- No `style` attribute except layout that cannot be a class, and then only with `var(--…)` values. No colour,
  font, padding, margin, gap, radius, border or shadow inline. Use `gap-*`, `row`, `stack`, `grow`, `push`, etc.
- No hex, no px, no `<style>`. Never edit `components.css`, `tokens.json`, `icons.json`, `tools/` or any other
  screen. If something truly cannot be expressed, use the closest existing component and list the gap in your
  final report (name the screen, the element, and the class you would add).
- Headers: a tab root uses `app-header` (title at the start, actions at the end). A pushed screen uses `nav-header`
  (back or close, title, optional trailing action, optional `steps`). No header has a bottom border.
- Bottom: `action-bar` only when the body scrolls under it; a screen whose content fits ends its body with the
  buttons (`push` to drop them to the bottom).
- Buttons: `btn btn--primary|secondary|ghost|danger|add` + `btn--md` (44) or default (52) + `btn--block`/`btn--grow`.
  One primary action per screen. Text-only actions are `btn--ghost` (green) — never a grey or black button.
- Exclusive choices (language, role tab, filter between two or three states, gender) are always `segmented`.
  Multi-select or filter tags are `chip`/`chip--selected`. Times are `slot`. There is no black selected state anywhere.
- People are `avatar` (always round); things are `icon-tile`. Statuses are `badge--*`.
- Gold (`accent`) is only for ijazah, isnad (sanad) and certificate surfaces. Rating stars use `.rating` (never gold).
- Inputs: `field` > `field__label` + `input` (+ `input--ltr` for email/password/dates) + `field__hint`.
  Focused state: `input--focused`. OTP: `otp` > `otp__cell` (+ `--filled` / `--active`).
- Icons: back = `chevron-right` (RTL), forward/disclosure = `chevron-left`, send = `arrow-left`. No `transform`.
- Gutter is `--layout-gutter` (20px) everywhere, via `screen__body` or `gutter`.

## Content fixes that apply to your screens
- **Certificates are generated by the platform only.** Teacher-uploaded ijazahs are out of the MVP. Remove any
  "uploaded by teacher" certificate, label or option.
- **Certificate number** is 16 Crockford base32 characters shown as four groups: e.g. `7K4Q-MZ2A-H8MN-B2XN`,
  in `ltr certificate-number`. There is no human-typed verification code: verification is by the QR code on the
  certificate (icon `qr-code`), which opens the public verification page.
- The slot hold starts when checkout opens and lasts 10 minutes (then 5 minutes of grace).
- Language selection is the same `segmented` control everywhere (العربية / English).
