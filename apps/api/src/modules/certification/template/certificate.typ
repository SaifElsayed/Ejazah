// T008 of specs/005-certification (FR-606; FR-IJAZAH-2, FR-IJAZAH-11; R-401; ADR 0004 D1-D3):
// the Mode A certificate, the v2 layout of ADR 0004 D2 as a working template. No emblem and no seal
// (B46 Q8 (a)); no QR before v1.1 (DEC-70). The final look is the design week's (11/21-25).
//
// THE CASE IS DATA. Everything printed comes from `case.json`, written by the job beside this file
// (`certificate-case.ts` is its shape). Every value is a string read from JSON and placed as text:
// this file never passes a value to `eval`, so a name holding Typst markup prints its characters.
// It imports no package: the worker never fetches code at compile time (ADR 0004, Consequences).
//
// THE WORDS are the owner's approved text of 2026-11-17 (`ejazah-tools\b46\certificate-text.md`):
// the student's verbs and pronouns follow the student's declared gender, the grantor's label, the
// closing verb and the English pronoun the teacher's.
//
// THE FIT (FR-IJAZAH-11). Up to 60 generations, one A4 page: the chain's type shrinks and the chain
// folds into more columns until the page holds everything. Beyond 60, or when no fit holds, the
// chain flows onto a following page under a running header, with page numbers, and the text, the
// signature and the dated line follow its end.

#let case = json("case.json")
#let ar = case.language == "ar"
#let male-student = case.studentGender == "male"
#let male-teacher = case.teacherGender == "male"

#let ink = rgb("#1f2a24")
#let accent = rgb("#9b1c1c")
#let rule-color = rgb("#7a6a4f")

#set document(title: if ar { "إجازة" } else { "Ijazah" })
#set text(font: "Amiri", size: 11pt, fill: ink, lang: case.language, dir: if ar { rtl } else { ltr })
#set par(justify: false, leading: 0.75em)

// The words of the approved text, chosen by the two genders.
#let grantor-label = if ar {
  if male-teacher { "المُجيز" } else { "المُجيزة" }
} else { "The grantor" }

#let tariq-ar = if case.tariq == none { "" } else { " من طريق " + case.tariq }
#let tariq-en = if case.tariq == none { "" } else { ", by the tariq of " + case.tariq }

// Labelled so the template spec reads what was placed: the name as one text, never evaluated.
#let student-name = [#text(fill: accent, weight: "bold", case.studentName) <student-name>]

#let body-text = if ar {
  let (verb, title, finished, granted, recite, read-by, counsel, forget, prayer) = if male-student {
    ("قرأ", "الأخُ الكريم", "وأتمّها", "أجزتُه", "يقرأ ويُقرئ", "قرأ به", "وأوصيه", "ينساني", "دعائه")
  } else {
    ("قرأت", "الأختُ الكريمة", "وأتمّتها", "أجزتُها", "تقرأ وتُقرئ", "قرأت به", "وأوصيها", "تنساني", "دعائها")
  }
  [
    #par[الحمدُ لله ربِّ العالمين، والصلاةُ والسلامُ على رسول الله، وبعد:]
    #par[فقد #verb عليَّ #title #student-name #case.subjectName برواية #case.riwaya#tariq-ar، قراءةً تامّةً متقنة، #finished في #case.completionDate.hijri الموافق #case.completionDate.gregorian.]
    #par[وقد #granted بأن #recite بما #read-by عليَّ، بالسند المذكور أعلاه، #counsel بتقوى الله في السرّ والعلن، وألّا #forget من صالح #prayer.]
  ]
} else {
  let (subject-pronoun, object-pronoun, possessive) = if male-student {
    ("he", "him", "his")
  } else {
    ("she", "her", "her")
  }
  [
    #par[Praise be to God, Lord of the worlds, and peace and blessings be upon His Messenger.]
    #par[#student-name has read #case.subjectName to me in the riwaya of #case.riwaya#tariq-en, a complete and accurate reading, which #subject-pronoun completed on #case.completionDate.hijri (#case.completionDate.gregorian).]
    #par[I hereby grant #object-pronoun ijazah to recite and to teach what #subject-pronoun read to me, by the chain of transmission set out above. I counsel #object-pronoun to be mindful of God in private and in public, and to remember me in #possessive prayers.]
  ]
}

#let closing = if ar {
  let verb = if male-teacher { "وكتبه" } else { "وكتبته" }
  [#verb #grantor-label: #text(weight: "bold", case.teacherName)]
} else {
  let pronoun = if male-teacher { "his" } else { "her" }
  [The grantor, #text(weight: "bold", case.teacherName), has set #pronoun signature below.]
}

#let signature = if case.signatureFile == none {
  v(1.6cm)
} else {
  image(case.signatureFile, height: 1.6cm)
}

#let dated-line = if ar {
  [حُرِّرت في #case.issueDate.hijri الموافق #case.issueDate.gregorian — رقم الإجازة: #text(dir: ltr, case.certificateNumber)]
} else {
  [Issued on #case.issueDate.hijri (#case.issueDate.gregorian) · Certificate no. #case.certificateNumber]
}

#let header = grid(
  columns: (1fr, 1.4fr, 1fr),
  align: (start + horizon, center + horizon, end + horizon),
  [
    #text(weight: "bold", if ar { "منصة إجازة" } else { "Ijazah platform" }) \
    #case.subjectName
  ],
  [
    #text(size: 12pt, if ar { "بسم الله الرحمن الرحيم" } else {
      "In the name of God, the Most Gracious, the Most Merciful"
    }) \
    #text(size: 30pt, weight: "bold", fill: accent, if ar { "إجازة" } else { "Ijazah" })
  ],
  [
    #if ar [برواية #case.riwaya] else [In the riwaya of #case.riwaya]
    #if case.tariq != none [ \ #if ar [من طريق #case.tariq] else [by the tariq of #case.tariq]]
  ],
)

#let chain-title = align(center, text(size: 14pt, weight: "bold", if ar { "سند الإجازة" } else {
  "The chain of transmission"
}))

#let count-line = align(center, if ar [عدد رجال السند: #case.generationCount] else [
  Generations in the chain: #case.generationCount
])

// One generation: its names side by side under a bus line when it holds several (ADR 0004 D3).
#let generation-cell(names, size) = {
  let name-box(name) = box(inset: (x: 0.2em, y: 0.15em), text(size: size, name))
  let inner = if names.len() == 1 {
    name-box(names.first())
  } else {
    stack(
      dir: ttb,
      spacing: 0.15em,
      line(length: 100%, stroke: 0.5pt + rule-color),
      grid(columns: names.len(), align: center, ..names.map(name-box)),
    )
  }
  [#metadata(names) <generation>]
  block(
    width: 100%,
    stroke: 0.4pt + rule-color,
    radius: 2pt,
    inset: 0.2em,
    breakable: false,
    align(center + horizon, inner),
  )
}

// A small arrow pointing along the chain: `forward` in the reading direction, or down.
#let arrow(way, size) = {
  let glyph = if way == "down" { "↓" } else if way == "reading" {
    if ar { "←" } else { "→" }
  } else {
    if ar { "→" } else { "←" }
  }
  text(size: size, fill: accent, glyph)
}

// The chain above the grantor as a snake of `cols` generations a row: the first row in the
// reading direction, the next back, each row's end joined to the next by a downward arrow.
#let snake(gens, cols, size) = {
  let rows = gens.chunks(cols)
  let cells = ()
  for (index, row) in rows.enumerate() {
    let forward = calc.even(index)
    let padded = row + ((none,) * (cols - row.len()))
    let ordered = if forward { padded } else { padded.rev() }
    for (position, names) in ordered.enumerate() {
      cells.push(if names == none { [] } else { generation-cell(names, size) })
      if position < cols - 1 {
        let joined = names != none and ordered.at(position + 1) != none
        cells.push(if joined { align(center + horizon, arrow(if forward { "reading" } else { "back" }, size)) } else { [] })
      }
    }
    if index < rows.len() - 1 {
      for position in range(cols * 2 - 1) {
        let end = if forward { cols * 2 - 2 } else { 0 }
        cells.push(if position == end { align(center, arrow("down", size)) } else { [] })
      }
    }
  }
  grid(
    columns: range(cols * 2 - 1).map(i => if calc.even(i) { 1fr } else { 1.2em }),
    row-gutter: 0.15em,
    ..cells,
  )
}

#let grantor-block(size) = align(center, block(width: 45%, {
  [#metadata(case.generations.last()) <generation>]
  if case.generations.len() > 1 { arrow("down", size) }
  v(0.1em, weak: true)
  block(
    width: 100%,
    stroke: 0.8pt + accent,
    radius: 3pt,
    inset: 0.35em,
    align(center, [
      #text(size: size, fill: accent, grantor-label) <grantor-label> \
      #text(size: size * 1.2, weight: "bold", case.generations.last().join(" · "))
    ]),
  )
}))

#let chain(cols, size) = {
  let above = case.generations.slice(0, case.generations.len() - 1)
  if above.len() > 0 { snake(above, cols, size) }
  grantor-block(size)
}

#let closing-block = {
  v(0.6em)
  [#closing <closing>]
  v(0.2em)
  signature
  v(0.4em)
  align(center, text(size: 10pt, dated-line))
}

#let whole(cols, size) = {
  header
  v(0.3em)
  line(length: 100%, stroke: 0.8pt + rule-color)
  chain-title
  chain(cols, size)
  v(0.3em)
  count-line
  v(0.3em)
  [#body-text <body>]
  closing-block
}

#let fits = ((3, 9.5pt), (3, 8pt), (4, 7.5pt), (5, 7pt), (6, 6pt))
#let one-page-limit = 60
#let flow-fit = (2, 11pt)

#let marker(mode) = [#metadata(mode) <layout>]

#set page(
  paper: "a4",
  margin: (x: 1.4cm, top: 1.6cm, bottom: 1.6cm),
  header: context {
    if counter(page).get().first() > 1 {
      align(center, text(size: 10pt, fill: rule-color, if ar { "سند الإجازة (تابع)" } else {
        "The chain of transmission (continued)"
      }))
    }
  },
  footer: context {
    if counter(page).final().first() > 1 {
      align(center, text(size: 9pt, fill: rule-color, counter(page).display("1")))
    }
  },
)

#if case.generations.len() <= one-page-limit {
  layout(region => {
    let chosen = fits.find(((cols, size)) => {
      measure(block(width: region.width, whole(cols, size))).height <= region.height
    })
    if chosen != none {
      marker("one-page")
      whole(..chosen)
    } else {
      marker("flow")
      whole(..flow-fit)
    }
  })
} else {
  marker("flow")
  whole(..flow-fit)
}
