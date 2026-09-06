# ADR 0002 — Arabic-first, RTL-default design system

**Status:** accepted

## Context
The audience reads Arabic. Treating RTL as a mirror of an LTR design produces
cramped type, wrong-side affordances and broken numerals.

## Decision
Arabic is the source locale and RTL is the default direction. Tokens carry an
Arabic type ramp with its own line heights, plus a separate Quranic face for
ayah text. Layout code uses start and end helpers rather than left and right.

## Consequences
- English is a translation, and is allowed to look like one.
- Every primitive is verified in both directions before it ships.
