# Design language

## Voice
Calm, unhurried, respectful. This is a place people come to recite, not to be
converted or upsold. No urgency patterns, no streak guilt, no confetti.

## Direction and type
Arabic is the source locale; RTL is the default. English is a translation and
is allowed to look like one.

Three faces, three jobs:
- **Arabic UI** — IBM Plex Sans Arabic. Everything the interface says.
- **Latin UI** — Inter. English copy, numerals in latin contexts.
- **Quranic** — an Uthmanic face, used only for ayah text, at `font.size.ayah`
  with `lineHeight.ayah`. Never for labels, never for headings.

Arabic needs more leading than Latin at the same size. The ramp already
accounts for it; do not tighten it per screen.

## Colour
Deep green is the brand; gold is the accolade colour and is rationed. Gold
appears on ijazah, sanad and certificate surfaces, and almost nowhere else —
that is what makes a grant feel like a grant.

Semantic tokens (`bg`, `surface`, `border`, `text`, `muted`, `primary`) are what
components consume. Palette steps are what semantic tokens consume. A component
that reaches past `semantic` into `color.neutral.700` is a smell; a component
with a hex literal is a review blocker.

Both schemes are first-class. Dark is not a filter over light — it has its own
semantic mapping in `tokens.json`.

## Layout
- 4px base, 8px rhythm. Screens breathe at `space.5` and up.
- Minimum touch target is `size.touchTarget` (44px). No exceptions for icons.
- One primary action per screen. Secondary actions are quieter, not smaller.
- Start and end, never left and right, in every layout decision.

## Motion
`duration.fast` for state changes, `duration.base` for entering surfaces.
Motion confirms; it does not perform. Respect reduce-motion.

## What the two roles feel like
**Student** — guided. The next thing to do is always on screen, and progress is
shown as memorised ground, not as a score.

**Teacher** — in control. Density is welcome: a teacher scanning tomorrow wants
the whole day at once, not a carousel.

Same tokens, same primitives, different density and different defaults. They
never share a screen file.
