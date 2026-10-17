# ADR 0014 — The admin panel uses the app's design system and is in Arabic and English

**Status:** accepted · **Date:** 2026-10-14 · **Decided by:** the owner, 2026-10-14 · **Amends:** SRS §2 (Admin web panel), FR-LOC-5, DEC-31 (adds DEC-54); ARCHITECTURE §2 stack table, §6.5, "What we are not doing"

## Context

The SRS (FR-LOC-5, DEC-31) made the admin panel English only. ARCHITECTURE §6.5
went further: the panel was to share nothing visual with the phone app, using
plain shadcn defaults.

The owner wants one product look and both languages on the web too. The
platform's operators read Arabic first, as its users do.

## Decision

### D1 — One design system for both apps

There is one source of tokens: colours, type, spacing, radii, sizes and icon
names. The phone app and the admin panel both consume it.

- **Phone app.** It reads the tokens through `apps/mobile/src/design/tokens.ts`.
- **Admin panel.** It reads them as CSS variables.
- **Shared contracts.** The two apps implement the same component contracts
  (`docs/design/components.md`), each in its own platform code. Button, Badge,
  Card, Input, Segmented and Sheet look and behave alike.
- **shadcn/ui.** It stays as the admin's behaviour base (accessible dialogs,
  menus, tables), themed by the shared tokens. Its default theme is not used.
- **Gold.** The rule that gold is for ijazah and isnad surfaces holds in the
  admin panel too.

### D2 — The admin panel is in Arabic and English

Arabic is the default, laid out right to left. English is laid out left to
right. The language switches without signing out, as FR-LOC-3 requires of the
app.

User content stays exactly as the user typed it, in any language: names,
reasons, chat lines and isnad names.

### D3 — What does not change

- **Separate admin API.** The admin panel stays a separate Vite SPA on its own
  router (`adminRouter`). An admin capability is still unreachable from the
  phone app.
- **Admin sign-in.** It stays separate from app sign-in, with mandatory
  multi-factor authentication (FR-ADMIN-1).
- **Audit log.** Every admin action still writes an audit entry (FR-ADMIN-17).

## Consequences

- **SRS.** The §2 Admin web panel line changes. FR-LOC-5 is rewritten. DEC-31
  is amended and DEC-54 is added.
- **ARCHITECTURE.** The stack row, §6.5 and the "no shared design system" line
  change.
- **Work.**
  - The token source moves where both apps can read it. Where it lives is
    decided with the design files.
  - The admin panel needs an Arabic and an English message catalogue and RTL
    layout.
  - Both are Phase 0 or Phase 1 setup work, not new screens.
- **Design.** The admin pages are drawn on the same canvas with the same
  `ds/ijazah` tokens and components, plus the layout pieces only a desktop needs
  (sidebar, data table, detail panel, dialog).
