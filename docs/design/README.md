# docs/design

The design of the product, kept in the repository so that it survives any tool and so that the
code is implemented from it rather than beside it (ADR 0020).

| Path                                         | What                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design.md`                                  | The design language: voice, direction, type, colour, layout, motion, states.                                                                                                                                                                                                                                                                                                                                            |
| `components.md`                              | The component contracts: every primitive and feature component, its props, variants, states and the tokens it consumes. The phone app's typed contracts are `apps/mobile/src/design/primitives/`.                                                                                                                                                                                                                       |
| `screens.md`                                 | The screen inventory: every board → its route, feature folder, requirement ids, data, actions and states. The implementation map.                                                                                                                                                                                                                                                                                       |
| `frames/`                                    | The 168 boards (`*.dc.html`), the canvas layout (`canvas.json`) and the design-system files the boards load (`ds/ijazah/`: `tokens.css`, `components.css`, `icons.json`, `tokens.json`). `tokens.json`, `tokens.css` and `icons.json` there are GENERATED from `packages/tokens/` by `pnpm tokens:build`; `components.css` is the stylesheet the boards are drawn with and the visual specification of every component. |
| `source/frags/`                              | The source of every board: its body without the device chrome. A board is rebuilt from here.                                                                                                                                                                                                                                                                                                                            |
| `source/parts/`                              | The admin dialogs composed over a page (`tools/compose.js`).                                                                                                                                                                                                                                                                                                                                                            |
| `source/tools/`                              | The board tooling (below).                                                                                                                                                                                                                                                                                                                                                                                              |
| `source/FACTS.md`                            | The canonical sample data every board agrees with (people, dates, amounts, chains).                                                                                                                                                                                                                                                                                                                                     |
| `source/BRIEF*.md`                           | The design briefs: formats, status vocabulary, copy rules, the admin panel, the certificate.                                                                                                                                                                                                                                                                                                                            |
| `source/inventory.json`, `source/alltext.md` | Generated: one entry per board, and the visible text of every board.                                                                                                                                                                                                                                                                                                                                                    |

## Where the same design lives in Claude

- The design canvas (all boards, with notes per section): the Design artifact
  https://claude.ai/artifact/CgK35FemR3GqYq8H6UZ524 — a published copy of `frames/`.
- The design system (tokens, components with live previews, icons, the brand book): the Design System
  artifact https://claude.ai/artifact/2cu7cfXXC99NBQrKWoUDBd — built from `packages/tokens/` and
  `frames/ds/ijazah/components.css`.

The repository is the source. When the design changes, change `source/frags/` (or `packages/tokens/`),
rebuild, then republish both artifacts from the rebuilt files.

## The tooling (`source/tools/`, Node, no dependencies)

```bash
node docs/design/source/tools/rebuild.js            # every board from frags/, title and size from canvas.json
node docs/design/source/tools/rebuild.js Admin      # only the boards whose id starts with Admin
node docs/design/source/tools/lint.js               # no raw colour, size or font in any board; every icon from the registry
node docs/design/source/tools/relayout.js           # lays the boards out in sections on the canvas, with the section notes (notes.json)
node docs/design/source/tools/gen-discovery.js      # regenerates the four Discovery boards from one generator (then rebuild)
node docs/design/source/tools/compose.js AdminConfirmDialog AdminIjazahRequests   # a dialog over its page (then rebuild)
node docs/design/source/tools/build-docs.js         # regenerates frags/DesignLanguage.html from the tokens and icons (then rebuild)
node docs/design/source/tools/inventory.js          # source/inventory.json
node docs/design/source/tools/dump.js               # source/alltext.md
node docs/design/source/tools/gallery2.js out.html Main,TeacherHome   # an HTML page showing boards side by side (check mode: add `check`)
node docs/design/source/tools/serve.js docs/design  # a static server to open frames/*.dc.html in a browser
```

`mkboard.js` is what `rebuild.js` calls for one board: it wraps a fragment in the device chrome,
replaces `{{SB}}` (status bar), `{{icon:name:size[:modifier]}}` (an icon from the registry),
`{{TABS:student|teacher|student-en:Active}}` (a tab bar) and `{{ADMINNAV:Active:ar|en}}` (the admin
sidebar).

Rules every board obeys (`lint.js` holds them): no literal colour, size or font — only tokens; every
icon from `icons.json`; every navigating button links to a board; the sample data is `FACTS.md`'s.
