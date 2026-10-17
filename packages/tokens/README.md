# @ijazah/tokens

The one source every colour, size, type value, motion value and icon name comes from
(ADR 0002, ADR 0014 D1, ADR 0020).

- `tokens.json` — the palette, the two colour schemes (`color.light`, `color.dark`, same keys in the
  same order), spacing, radii, border widths, font families and weights, the text ramp, control and
  media sizes, icon sizes and strokes, shadows, opacities, durations, easings, motion distances, the
  layout constants the design frames and the admin panel use, and the compact density overrides.
  A value written `{palette.green.600}` is an alias of another token.
- `icons.json` — the icon registry: a Lucide name (lucide.dev) → the SVG drawing the design boards
  inline. The app uses the names, not the drawings.

Nothing reads these two files at runtime. `pnpm tokens:build` (`scripts/build-tokens.ts`) writes
from them, and `pnpm check:generated` refuses a drifted copy:

| Generated                                                          | Read by                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `apps/mobile/src/design/tokens.ts`                                 | the phone app's theme provider and primitives            |
| `apps/mobile/src/design/tailwind.theme.json`                       | `apps/mobile/src/design/tailwind.config.js` (NativeWind) |
| `apps/mobile/src/design/icons.ts`                                  | the phone app's `Icon` primitive                         |
| `apps/admin/src/design/tokens.css`                                 | the admin panel, as CSS custom properties                |
| `apps/admin/src/design/icons.ts`                                   | the admin panel's icon component                         |
| `docs/design/frames/ds/ijazah/{tokens.json,tokens.css,icons.json}` | the design boards                                        |

To change the brand colour, a size or a font: edit `tokens.json`, run `pnpm tokens:build`, commit
everything it wrote. To add an icon: add it to `icons.json` (its Lucide name and drawing), rebuild.
