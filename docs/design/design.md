# Design language

## Voice

Calm, unhurried, respectful. This is a place people come to recite, not to be converted or
upsold. No urgency patterns, no streak guilt, no confetti. Status words are the vocabulary in
`source/BRIEF-PROD.md`; copy rules are `source/BRIEF-COPY.md`; the copy itself is the i18n
catalogue (ADR 0020 D6).

## Direction and type

Arabic is the source locale; RTL is the default. English is a translation and is allowed to look
like one. The admin panel is Arabic by default and English on a switch (ADR 0014).

Three faces, three jobs (`font.family`):

- **Arabic UI** — IBM Plex Sans Arabic. Everything the interface says.
- **Latin UI** — Inter. English copy; and inside Arabic, the runs that must stay LTR and Latin:
  emails, certificate numbers, order references, counts in the admin tables (`.ltr`, `.text-latin`).
- **Quranic** — Amiri Quran, used only for ayah text, the certificate title and the signature,
  at `text.ayah` with its own line height. Never for labels, never for headings.

The ramp (`text.*`): display 32 · title-1 24 · title-2 20 · title-3 18 · headline 16 · body-lg 16 ·
body 14 · callout 13 · caption 12 · micro 11 · ayah 24. Arabic needs more leading than Latin at the
same size; the ramp's line ratios (1.4 to 1.7, 2.1 for ayah) already account for it. Do not tighten
them per screen. Weights: regular 400, medium 500, bold 700.

## Colour

Deep green is the brand; gold is the accolade colour and is rationed. Gold appears on ijazah, sanad
and certificate surfaces (`color.accent*`, `Card accent`, `Badge accent`) and almost nowhere else —
that is what makes a grant feel like a grant. Stars are drawn in `color.rating` (near-black on
light, near-white on dark), never gold.

Semantic tokens (`bg`, `surface*`, `border*`, `text*`, `primary*`, `accent*`, `warning*`,
`danger*`, `rating*`, `live`, `scrim`, `hover`, `focus-ring`, `skeleton`) are what components
consume. Palette steps are what semantic tokens consume. A component that reaches past the semantic
layer into `palette.neutral.700` is a smell; a component with a hex literal is a review blocker.

Both schemes are first-class. Dark is not a filter over light — it has its own semantic mapping in
`tokens.json` (`color.dark`), and the live session is always drawn on it.

## Layout

- 4px base, 8px rhythm (`space.*`: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Screens breathe at
  `layout.gutter` (20) on the sides and `space.5` between groups.
- Minimum touch target is `size.touch` (44). No exceptions for icons. The admin panel's compact
  density (`density.compact`) is 36.
- Controls: `size.control-lg` 52 for the primary action and inputs, `size.control-md` 44 for the
  rest; list rows 52; radii xs 4 · sm 8 · md 12 (controls, cards) · lg 16 · xl 20 (sheets, hero
  cards) · full.
- One primary action per screen. Secondary actions are quieter, not smaller.
- A screen is: the status bar, one header (`AppHeader` for a tab root, `NavHeader` for a pushed
  screen), the body, then either the `TabBar` or an `ActionBar`. A sheet sits over a scrim.
- Start and end, never left and right, in every layout decision.

## Motion

`duration.fast` (120ms) for state changes, `duration.base` (200ms) for entering surfaces (scrim,
dialog, admin detail panel), `duration.slow` (280ms) for a sheet. Easings: standard, enter, exit.
A press gives slightly (`motion.press-scale`). Motion confirms; it does not perform. Respect
reduce-motion: everything stops.

## States

Every interactive element has hover (pointer devices only), keyboard focus (one ring everywhere,
`shadow.focus`, never on a mouse click), pressed and disabled. Every list has a loading shape
(Skeleton), an empty state (EmptyState: what is missing, why, the one next step), and an error
(a danger Banner with a retry). Every field has an error. Offline is a banner on the home screen
with the cached content dimmed, not a blank screen. A confirmation after an action is a Toast.

## Iconography

Lucide, by name, from `packages/tokens/icons.json`; 1.75 stroke by default, 2 for a selected tab
and checks, 2.5 for a small check; filled stars; the Apple and Google marks solid. Chevrons and
arrows point along the reading direction and mirror in RTL through the direction helper, never by
hand.

## What the two roles feel like

**Student** — guided. The next thing to do is always on screen, and progress is shown as sessions
completed out of the package, not as a score.

**Teacher** — in control. Density is welcome: a teacher scanning tomorrow wants the whole day at
once, not a carousel.

Same tokens, same primitives, different density and different defaults. They never share a screen
file.

**Admin** — the same system on a desktop: a sidebar of queues, a list beside the selected record's
panel, binding actions behind a dialog that asks for a reason, every action audited.
