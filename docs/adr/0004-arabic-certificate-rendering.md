# ADR 0004 — Arabic certificate rendering: Typst renders the generated ijazah, and a chain generation may hold several names

**Status:** accepted; D3's SRS, ERD and model amendment is pending (Phase 4 cycle), and until it lands FR-ISNAD-2 and the current model govern · **Date:** 2026-10-13 · **Closes:** T124 (FR-070, SC-015; proves FR-IJAZAH-11) · **Amends:** nothing; the changes the decisions need are follow-ups for the Phase 4 cycle, named under Consequences

## Context

A Mode A ijazah is a PDF the platform generates from a standard template (SRS
§3.9.2). It carries the student's and teacher's names, the subject, the grant date,
the teacher's signature, the certificate number, a verification QR and the full
chain of transmission with the granting teacher appended (FR-ISNAD-7). The text is
Arabic, right to left, often fully vowelled, and the chain has no fixed length
(FR-ISNAD-3). PLAN.md makes this spike decide the rendering approach before the
Phase 4 cycle.

Two risks were open: whether a renderer shapes Arabic correctly (joining, the
لا and الله ligatures, hamza seats, vowel marks, ﷺ), and whether a long chain
can be laid out and paginated legibly.

## What the owner decided along the way

| Date | Decision |
| --- | --- |
| 2026-10-13 | The chain is shown from the top down: the Lord of the worlds, Jibril and the Prophet ﷺ at the top, the granting teacher at the bottom, with the teacher appended (FR-ISNAD-7). The spike data was origin-first; the model today numbers `position` from the teacher's own teacher towards the origin (ERD `isnad_entries`), and the two are reconciled in Phase 4 (Consequences) |
| 2026-10-13 | The template adds the top rows itself; the teacher's stored chain starts at the Companions. This was decided for a Qur'an chain; other subjects end elsewhere, and the Phase 4 cycle decides the top rows per subject |
| 2026-10-13 | A4 paper; chains of 35 names and more must work |
| 2026-10-13 | A real Prophet's Mosque ijazah, a single page with the chain drawn as a tree, is the visual reference |
| 2026-10-13 | **A chain entry is one generation and may hold several names** (the Companions in one row, then Zirr and al-Sulami in one row), drawn side by side and joined by a bus line |
| 2026-10-13 | The layout below is a working reference, the closest to the final look. The certificate will be redesigned before production |

## What was tested

| Item | Value |
| --- | --- |
| Data | Four cases: 25, 35 and 60 men for a male student and teacher, and 35 for a female student and teacher (the text's verbs and pronouns change). "Men" counts generations: the 25-man case holds 24 stored generations carrying 29 names, plus the teacher (35: 34 and 39; 60: 59 and 64), and the page's count of men counts generations too. Names above al-Shatibi are the attested top of the Hafs chain; the rest are invented to exercise shaping: لا and الله ligatures, hamza seats, long names, full vowelling and none, alef maqsura, ta marbuta. Every page carries the watermark "نموذج تجريبي — ليست إجازة حقيقية" |
| Font | Amiri 1.003 (SIL Open Font License), regular and bold |
| Engine A | Chromium (Microsoft Edge, headless) printing an HTML page to PDF |
| Engine B | Typst 0.15.1, the template in Typst's own language, the case passed as a JSON input |
| Round 1 | A two-part layout in both engines: page 1 the certificate text, then the chain as a vertical list across following pages with a running header and page numbers |
| Round 2 (v2) | After the reference: one A4 page. Header with the organisation's lines, the title, the riwaya and an emblem; the chain as a tree (two top rows, the generations of the spine centred, then the chain folding into snake rows with red arrows, the grantor at the bottom centre); below it the count of men, the short text with the student's name in red, the closing, the grantor's signature, a seal, the QR and the dated line with the registration number. Built first in HTML, then ported to Typst |
| Fit | The template shrinks the tree's type, then folds it into more columns, until the page holds everything: 3 columns down to 8 pt, 4 to 7.5 pt, 5 to 7 pt, 6 to 6 pt |
| Checks | The QR decoded from the rendered page with `jsQR`; the PDF text layer read with `pdfjs-dist` and searched for five phrases; the pages rendered to images and inspected by eye, by the owner and here |

## What was observed

| Check | Chromium (HTML) | Typst |
| --- | --- | --- |
| Arabic shaping: joining, ligatures, hamza, vowel marks, ﷺ, ﷻ | Correct | Correct |
| Right-to-left layout of the text, the header grid and the tree | Correct | Correct |
| v2 on one page | 25, 35 and 60 men fit | 25, 35 and 60 men fit. Chosen fit: 25 men 3 columns at 9.5 pt; 35 men 3 columns at 8 pt; 60 men 6 columns at 6 pt |
| Round 1 pagination | No running header or page numbers: a full-bleed frame needs a zero page margin, so the footer has nowhere to go | Native running header ("the chain, continued") and page numbers; 35 men took 4 pages, 60 took 5 |
| Time per PDF | About 1.8 s, a browser start each time | 0.09 to 0.67 s for v2 (0.67 s for 60 men, which tries every fit); about 0.1 s in round 1 |
| Size per PDF | 0.8 MB for v2, 1.4 to 2.3 MB in round 1 | 114 to 128 KB for v2 |
| QR | Decodes | Decodes, all four cases |
| Text layer: the student's name, عاصم بن أبي النجود, رسول الله, الشاطبي searched in the PDF | Not found | Not found |
| Text layer: the certificate number | Found | Found |
| Kashida justification | No | No |
| Network at compile time | None | None: the spike template imports no `@preview` package; the QR is an SVG made beforehand |
| Injection | The case is inserted into HTML, so every value must be escaped | The case is read as JSON data and never parsed as markup, as long as the template never passes a value to `eval`; the spike template has no `eval` |

**The text layer.** Neither engine leaves fully vowelled Arabic searchable: the
words are drawn correctly but copy or search as broken sequences. The number
survives. A printed certificate is checked through its QR and the verification
page (FR-IJAZAH-10), not by searching the PDF, so this does not decide between them;
it is recorded so nobody relies on the PDF's text later.

**Type at 60 men.** The page holds 60 men only at 6 pt, legible but small.
Chains of that length are rare; how a much longer chain is shown (a second page
in the round 1 style, which Typst paginates natively, or a smaller tree) belongs
to the redesign.

## Decision

### D1 — Typst renders the Mode A certificate

Both engines shape Arabic correctly, so the choice rests on the rest: Typst is
about three to twenty times faster, its PDFs are about seven times smaller, it runs
as one binary with no browser to start or patch, it paginates with running
headers and page numbers where the full-bleed HTML could not, and it takes the
case as data, so a name cannot inject markup unless the template calls `eval` on it. Phase 4 decides how the API runs it
(the Typst binary in the worker, or a Node binding of the same compiler); either
way it runs in the worker, not in a request.

### D2 — The v2 layout is the working template, not the final design

Phase 4 starts from the v2 Typst template: one A4 page, the chain as a tree from
the top rows down to the grantor, the text, signature, seal, QR and dated
registration line below. The owner will have the certificate redesigned before
production; the redesign changes the drawing, not D1 or D3.

### D3 — A chain generation holds one or more names

A stored chain is an ordered list of generations, and each generation is a list
of one or more names. One name is the usual case; several names share a
generation when the teacher's own chain records them as taking from the same
teacher at the same level (the Companions, then Zirr and al-Sulami, in the Hafs
chain). The certificate draws a multi-name generation as a row of names joined
by a bus line.

## Consequences

- **Follow-ups for the Phase 4 cycle**, outside this task's path, so nothing is
  changed here:
  - SRS FR-ISNAD-2 says each entry is "a position and a transmitter name"; it
    becomes one or more names per position (D3).
  - SRS FR-ISNAD-1 says the chain runs "from their immediate teacher back to the
    origin"; the owner's display order is origin first (above). The wording is
    reconciled with how the chain is stored and shown.
  - ERD `isnad_entries` holds one `transmitter_name` per row under the unique
    rule `(teacher_user_id, subject_id, position)` (ERD §15, rule 7). Either the
    column becomes a list of names, or the rule gains an order within the
    position. `ijazahs.chain_snapshot` takes the same shape.
  - **The shape already exists in code.** `IsnadEntry` in
    `prisma/schema/catalog.prisma` holds one `transmitterName` per row, numbers
    `position` from 1 = the teacher's own teacher ascending to the origin, and is
    unique on teacher, subject and position; `chainSnapshot` is in
    `prisma/schema/certification.prisma`; and the merged migration
    `20261007000000_init` creates the table and its unique index, and is never
    edited (R-DB-1). Phase 4 changes them by a forward migration, after the SRS
    and ERD are amended (R-PROC-2), and reconciles the stored direction with
    FR-ISNAD-1 and the top-down display.
  - SRS §4.3 and §10 name "a server-side PDF renderer with proven Arabic
    shaping"; they can name Typst (D1).
  - The certificate's fields are listed against §3.9.2 and FR-IJAZAH-10: v2
    carries some the SRS does not name (the organisation's lines, the riwaya,
    an emblem, a seal, a registration line). Only Arabic was rendered;
    `ijazahs.language` also allows English, which is untested.
  - Phase 4's template test asserts that no value reaches `eval`, and any Typst
    package the template imports is vendored or pinned, so the worker never
    fetches code at compile time.
  - PLAN.md Phase 4 records D1, D2 and D3's model change. **Phase 4 keeps its
    five days**: D3 changes the shape of a table Phase 4 builds its isnad work
    on anyway, by one forward migration, before any isnad code exists.
- Amiri ships with the renderer. It is under the SIL Open Font License, which
  allows embedding in generated PDFs.
- The spike files (data, the HTML and Typst templates, the checks) stay in the
  developer's scratch folder; Phase 4 writes its template in the repository from
  this ADR, with tests.

## Alternatives rejected

- **Chromium printing HTML.** Correct shaping, but a browser per certificate, megabyte files, no page numbers
  with a full-bleed frame, and every value must be escaped.
- **One name per position, several rows for one generation.** It would draw the
  Companions as a column of five teachers in sequence, which states a chain that
  never existed.

## References

- Typst 0.15.1, [documentation](https://typst.app/docs/)
- Amiri 1.003, [the font and its license](https://github.com/aliftype/amiri)
- SRS §3.9.2 (Mode A), §4.3, §10, FR-ISNAD-1 to FR-ISNAD-7, FR-IJAZAH-10, FR-IJAZAH-11; ERD `isnad_entries`, `ijazahs`, §15; `prisma/schema/catalog.prisma`, `prisma/schema/certification.prisma`; constitution R-DB-1, R-PROC-2; PLAN.md, Phase 4
