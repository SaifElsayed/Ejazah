# Component contracts

A contract is the props a component accepts and the decisions it refuses to
delegate. If a screen needs a colour, a font or a radius, the answer is a new
variant here, not a style override there.

## Primitives — `apps/mobile/src/design/primitives/`

### Text
`variant`: display · title · body · caption · ayah
`weight`: regular · medium · bold
`tone`: default · muted · primary · danger

Picks the Arabic or Latin face from the active locale. `ayah` switches to the
Quranic face and its own line height. No screen sets `fontFamily`.

### Button
`label`, `variant` (primary · secondary · ghost · danger), `size` (sm · md · lg),
`loading`, `disabled`.

Never accepts a colour. Height is never below `size.touchTarget`. Loading keeps
the label width so the layout does not jump.

### Card
`padded`, `elevation` (flat or raised). A container, not a layout engine — it
does not decide its own margins.

### Input
`label` (required, used as the accessibility label), `error`, `hint`.
`error` is already-localised copy; the component never maps an error code.

### Sheet
`open`, `onClose`, `title`, `snapPoints`. Every modal flow uses this. A raw
`Modal` in a feature is a review blocker.

### Badge
`label`, `tone` (neutral · success · warning · danger · accent).
`accent` is the gold tone and is reserved for ijazah and sanad surfaces.

## Feature components

Live under `features/<side>/<feature>/components/` and may compose primitives
freely. They may not be imported across the student and teacher boundary — if
two sides need the same component, it moves to `features/shared/`.

## Checklist before a component ships
- Reads correctly in RTL and LTR.
- Reads correctly in light and dark.
- Every colour comes from a semantic token.
- Touch targets meet the minimum.
- Arabic and English copy both fit without truncation at the longest string.
- Has an accessibility label, and a state a screen reader can announce.
