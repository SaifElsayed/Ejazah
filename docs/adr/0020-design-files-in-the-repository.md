# ADR 0020 — The design lives in the repository: one token source, generated outputs, component contracts, a screen inventory and a copy catalogue

**Status:** accepted · **Date:** 2026-10-17 · **Decided by:** the owner, 2026-10-17 · **Amends:** ARCHITECTURE §5 (repository layout), §6.3 (the design system); docs/design (replaced in full) · **Builds on:** [ADR 0002](0002-arabic-first-rtl-design-system.md) (Arabic-first tokens), [ADR 0014](0014-admin-shares-the-design-system-and-is-bilingual.md) D1 (one design system for both apps; "where the token source lives is decided with the design files")

## Context

The product's design was finished as 183 boards on a design canvas: every screen of the student,
the teacher, the shared session surfaces, the public web pages and the admin panel, in Arabic with
English and dark variants, drawn with one stylesheet whose every value is a token. The canvas lived
in a tool session; its sources (fragments, generators, the sample-data facts) lived in a temporary
folder. The repository held an earlier, much smaller design (`docs/design/frames/`), an empty
`apps/mobile/src/design/` waiting for "values from Phase 1", and ADR 0014's open question of where
the shared token source lives.

The owner wants implementation to proceed from documents the code can follow without
interpretation, a design system that a future feature extends rather than imitates, and a design
that can be changed in one place.

## Decision

### D1 — One token source: `packages/tokens/`

`packages/tokens/tokens.json` is the single source of every colour (a palette and two semantic
schemes, `light` and `dark`, with the same keys in the same order), spacing step, radius, border
width, font family and weight, text style (size and line ratio), control and media size, icon size
and stroke, shadow, opacity, duration, easing, motion distance, layout constant and the compact
density overrides. `packages/tokens/icons.json` is the icon registry: a Lucide name and the drawing
the boards inline. Nothing reads either file at runtime.

### D2 — Generated outputs, checked for drift

`pnpm tokens:build` (`scripts/build-tokens.ts`) writes, from the two sources:

| File                                                                   | Reader                                                                                                                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/design/tokens.ts`                                     | the phone app (ARCHITECTURE §6.3): a typed `as const` object, lengths and durations as numbers, the pixel line height per text style, shadows as layers, both schemes |
| `apps/mobile/src/design/tailwind.theme.json`                           | `apps/mobile/src/design/tailwind.config.js` (NativeWind)                                                                                                              |
| `apps/mobile/src/design/icons.ts`, `apps/admin/src/design/icons.ts`    | the two apps' icon components: the icon names and the directional ones                                                                                                |
| `apps/admin/src/design/tokens.css`                                     | the admin panel, as CSS custom properties: `:root`/light, `[data-theme="dark"]`, `[data-density="compact"]` (ADR 0014 D1)                                             |
| `docs/design/frames/ds/ijazah/tokens.json`, `tokens.css`, `icons.json` | the design boards                                                                                                                                                     |

`pnpm check:generated` regenerates every one of them in memory and refuses a committed copy that
differs (R-PROC-9), as it already does for the contract snapshot and the lockfile. Changing the
brand colour is one line in `tokens.json`, one command, one commit.

### D3 — The design itself is in the repository and rebuildable

`docs/design/frames/` holds the 183 boards and their canvas layout; `docs/design/source/` holds
every board's fragment, the admin dialog parts, the generators (`rebuild`, `lint`, `relayout`,
`gen-discovery`, `compose`, `build-docs`, `inventory`, `dump`, `gallery2`, `serve`), the sample-data
facts and the design briefs. A board is rebuilt from its fragment byte for byte; the board linter
refuses a literal colour, size or font and an icon outside the registry. The earlier frames are
removed. The Design artifact and the Design System artifact in Claude are published copies for
viewing; the repository is the source (`docs/design/README.md`).

### D4 — Component contracts, in full

`docs/design/components.md` lists every component the boards use, by the primitive or feature
component it becomes, with its props, variants, states and the tokens it consumes;
`apps/mobile/src/design/primitives/` holds the same contracts as TypeScript prop interfaces. The set
is the design's, not the six names ARCHITECTURE §6.3 listed as examples: Text, Icon, Button,
IconButton, TextLink, Segmented, Chip, Slot, CheckRow, Choice, Picker, Select, CategoryTabs, Badge,
Banner, Toast, EmptyState, Skeleton, Spinner, Card, Section, List, Summary, Stats, Avatar, IconTile,
Field, Input, InputGroup, Otp, Upload, FileRow, StarInput, Rating, SignaturePad, Steps, Progress,
Timeline, Meter, Sheet, Dialog, AppHeader, NavHeader, PageIntro, Brand, ActionBar, TabBar, SearchRow,
FilterChips. Feature components (TeacherCard, Chain, ChainInput, Agenda, DayBlock, Notice, Chat
bubble, the live-session pieces, CertificatePreview) and the admin layout pieces (Console, Sidebar,
Page, Split, DataTable, Panel, KeyValue, DocThumb, QueueCard, Pager) are listed with the same
precision and live in features or in the admin app. The admin panel implements the same contracts
on shadcn/ui themed by the CSS variables (ADR 0014 D1).

The component implementations are Phase 1 work under Spec Kit tasks; this ADR ships the contracts,
not the code (owner's decision, 2026-10-17).

### D5 — The screen inventory is the implementation map

`docs/design/screens.md` lists every board: its route (Expo Router under the `(auth)`, `(student)`
and `(teacher)` groups, shared routes outside them, the public web pages, the admin SPA paths), its
kind (tab root, screen, sheet or dialog on a route, a state of a route), its feature folder, the
requirement ids it realises, the data it shows, every action and its destination, and the states it
needs. The route and folder conventions in it are the ones the app uses; a screen is implemented at
the route the inventory names.

### D6 — The copy catalogue

Every string the boards show is in `apps/mobile/src/i18n/ar.json` with its translation in
`en.json`, nested by `area.screen.element`, shared words under `common.*` and status words under
`status.*`. Arabic is the source text (ADR 0002); the English is the translation. Values with data
in them are ICU MessageFormat templates (`{name}`, `{count, plural, …}`). An Arabic plural carries
the five CLDR forms `one`, `two`, `few`, `many` and `other`, and `zero` only where the design draws
a sentence for zero; a missing `zero` falls back to `other` by ICU. Sample data (names, dates,
amounts, codes) is never in the catalogue. The admin panel has its own
pair, `apps/admin/src/i18n/ar.json` and `en.json`, under `admin.*` (ADR 0014 D2). The parity check
holds both pairs, each by its own script: `pnpm check:i18n` the phone pair and
`pnpm check:i18n:admin` the admin pair.

### D7 — What stays for Phase 1

The primitives' React Native code, the theme and direction providers (`theme.tsx`, NativeWind
variables per scheme), the `Icon` component over `lucide-react-native`, the i18n runtime and its
message-format library, and the admin panel's component layer. Each is a Spec Kit task that
implements a contract or a catalogue this ADR fixes; none redesigns.

## Consequences

- **ARCHITECTURE.** §5 lists `packages/tokens/` and the new shape of `docs/design/`; §6.3 says the
  source is `packages/tokens/tokens.json`, that `tokens.ts` is generated, and that the primitives
  are the design's set.
- **Gates.** `check:generated` covers eight more files. The admin pair gets its own parity script,
  `check:i18n:admin`, beside `check:i18n`.
- **Work.** A design change is a change to `source/frags/` or `tokens.json`, a rebuild, a lint and a
  republish of the two artifacts; a new feature starts from `components.md` and `screens.md`.
- **Open.** Where the public web pages (certificate verification, account deletion) are served is
  not decided here. The three proposal boards (an alternative home, teacher day and teacher students
  list) stay on the canvas as proposals until the owner decides. Both were decided afterwards: the
  public pages' home is [ADR 0021](0021-design-consequences-for-data-and-configuration.md) D5, and
  the three proposal boards were retired on 2026-10-17 (decision sheet row 38).
