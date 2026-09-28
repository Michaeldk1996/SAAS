# Stennisfy — Design & Build Instructions

Standing instructions for any agent working on the Stennisfy product. Read this
before touching a file. Everything here is derived from the live design at
`BSP CONSULT FINAL DARK THEME/Stennisfy Website.html`.

---

## 1 · What the product is

Stennisfy is an ATP tennis analytics dashboard for members who want an edge on a
match. It is an analyst's tool, not a betting site and not a sports-news site.
The reader is assumed to be numerate, to know the tour, and to be looking for the
one number that changes their read of a matchup.

Consequences for design:

- **Density is a feature.** Members want many numbers on one screen. Do not
  space things out to feel "clean" — space them so they can be scanned.
- **Every number needs a denominator.** `62% · W31–L19 · n=50`, never a bare 62%.
- **Comparison over decoration.** A number's value comes from what it sits next
  to. General matrix beside personal record. Player A beside player B.
- **No hype copy.** Label things flatly: "Career record", "Historical by
  surface", "leans +7 pts to the attacking baseliner".

---

## 2 · Visual system

### Colour

| Role | Value |
|---|---|
| Page background | `#06070a` |
| Card / panel surface | `#0a0d14` |
| Standard border | `1px solid rgba(255,255,255,0.09)` |
| Inner / subtle border | `1px solid rgba(255,255,255,0.06–0.07)` |
| Accent blue | `#5b9bff` (hover / link hover `#82b4ff`, bright `#6aaeff`) |
| Accent blue fills | `rgba(91,155,255,0.13–0.22)` |
| Accent blue borders | `rgba(91,155,255,0.22)` / `0.35` when emphasised |
| Primary text | `#e7e9ee` |
| Secondary text | `#8b96b5` |
| Label / muted | `#5b6880` |
| Faint / not-wired | `#4b5672` |
| Positive | `#3dd68c` |
| Negative | `#e0616f` |
| Surface — clay | `#e8a84e` |
| Surface — hard | `#4db8ff` |
| Surface — indoors | `#c6ccdb` |
| Surface — grass | `#3dd68c` |

Rules:

- Only one accent. Blue carries selection, links, active state and emphasis.
  Green and red are reserved for signed values (deltas, profit, form).
- Surface colours are semantic. Clay is always `#e8a84e`. Never re-use a surface
  colour for anything that is not that surface.
- No gradient backgrounds except the two that exist: the plan card
  (`linear-gradient(160deg,rgba(91,155,255,0.14),rgba(47,107,216,0.03))`) and the
  court-speed scale (`linear-gradient(90deg,#1a2338,#2a3f66,#2f6bd8)`).

### Type

Two families, loaded together:

```
Hanken Grotesk — 400 500 600 700 800   (UI, labels, prose)
IBM Plex Mono  — 400 500 600 700       (every number, every code, every tag)
```

**Any figure a member might compare goes in IBM Plex Mono.** Records, win rates,
odds, ranks, dates, n-counts, deltas, player codes (ATB, CTR). Prose, headings
and button labels are Hanken Grotesk.

Scale in use:

| Use | Spec |
|---|---|
| Page title | 29px / 800 / `letter-spacing:-0.015em` |
| Hero figure | 52px mono / 700 / `line-height:0.9` / `-0.02em` |
| Section headline | 23px / 800 |
| Card headline figure | 26–30px mono / 700–800 / `line-height:1` |
| Body | 13–13.5px |
| Card value | 14–16px mono / 700 |
| Meta / support | 11–12.5px, colour `#5b6880` |
| **Eyebrow label (the `.cap` spec)** | 9.5–11px mono, 600, `letter-spacing:0.12–0.16em`, `text-transform:uppercase`, colour `#5b6880` |

The eyebrow label is the signature of the design. Every card, panel and column
header uses it. Do not invent a second label style.

### Shape & space

- Radii: `16px` outer cards, `12px` panels, `10–11px` inner cards and controls,
  `9px` pills and segmented wrappers, `7px` segment items.
- Padding: `20–22px` outer cards, `14–18px` panels, `13–16px` inner rows.
- Gaps: `22px` between page sections, `10–14px` between cards, `6–8px` inside
  a control.
- Always lay out sibling groups with `display:flex` / `grid` + `gap`. Never
  space with margins on each child or with source whitespace.

### Motion

Transitions are `.14s ease` on `background`, `color`, `border-color`. Cards lift
`translateY(-2px)` on hover with a `0 0 0 1px rgba(91,155,255,0.2)` ring. Panels
enter with `sigIn` (`.2s cubic-bezier(.2,.7,.3,1)`, fade + 6px rise). Nothing
else animates.

---

## 3 · Component patterns

Reuse these. Do not invent a new pattern for a problem one of them solves.

**Card.** `#0a0d14`, `1px solid rgba(255,255,255,0.09)`, radius 12, padding
`22px 24px`. An eyebrow label, then content. Sub-sections inside a card are
separated by `margin-top:18px; padding-top:16px; border-top:1px solid
rgba(255,255,255,0.08)` — not by nesting another card.

**Stat tile.** `#0a0d14`, radius 10, padding `15px 16px`. Eyebrow label, then a
mono figure, then a support line. Three or four across in a grid.

**Segmented control.** Outer `#06070a` or `#0a0d14`, `1px solid
rgba(255,255,255,0.09)`, radius 9–11, padding 2–4, `width:fit-content`. Items:
padding `5px 11–12px`, radius 7, 11px. Selected item gets
`rgba(91,155,255,0.16)` fill, `rgba(91,155,255,0.22)` border, `#e7e9ee` text,
weight 700; unselected is transparent with `#5b6880` text, weight 600. Use it
for scope (Career / Last 52 weeks), view type, and surface.

**Expandable row.** Header row with a 9px caret that rotates 90° when open
(`transition:transform .16s`), label + meta on the left, figure on the right.
Detail rows sit below a top border, indented to clear the caret, one line each:
label · record · n · rate. This is the career-by-surface pattern; use it
anywhere a total decomposes.

**Table / matrix.** Fixed-width columns with `justify-content:start;
width:fit-content; margin:0 auto` so it reads as a block, not a stretched grid.
Mono headers in the eyebrow spec, right-aligned numeric cells, a `2px solid
rgba(255,255,255,0.14)` rule above the totals row.

**Modal.** Full-screen scrim, card at `820px` for a single-column drill,
`1280px` when it carries side-by-side content. Opens with a context strip of key
metrics, then the detail. Content scrolls inside a capped-height pane; the modal
frame does not grow past the viewport. Everything inside a modal shares one
content width (e.g. 640px, centered) so headings, tables and notes align.

**Comparison block.** Two mirrored cards side by side in
`repeat(auto-fit,minmax(210px,1fr))`, one per player, each in that player's
colour, each ending with the same bottom-bordered line so the two are directly
comparable.

---

## 4 · Navigation & structure

Fixed 250px sidebar, main column `padding:30px 40px 70px`, `max-width:1360px`,
sections stacked with `gap:22px`. Sidebar items are icon + label; the active one
gets `rgba(91,155,255,0.13)` fill, `rgba(91,155,255,0.34)` border, white text
and a blue icon.

Nav order is fixed:

1. Matches
2. Live
3. Trading Report
4. Series
5. Players
6. Head to Head
7. Tournaments
8. Database
9. Entry Lists
10. Stennisfy Model
11. Playing Styles
12. News

Account (profile, billing, logout) sits at the bottom of the sidebar and opens
as its own view with a "‹ Back to matches" escape, not as a modal.

---

## 5 · Data rules — non-negotiable

**Sample size gates every rate.**

| n | Show |
|---|---|
| ≥ 10 | percentage at full size, `#e7e9ee` |
| 5–9 | percentage greyed `#5b6880`, smaller, with a "small sample" note |
| < 5 | no percentage — W–L only, plus "too few matches for a rate" |
| 0 | an em dash `—` and "no matches on record" |

**A number that is not wired shows an em dash `—` in `#4b5672`.** Never a zero,
never a plausible-looking default, never `0%`. If placeholder data is on screen,
say so in a `10.5px #4b5672` note.

**Splits must reconcile.** Surface, level, round and format breakdowns sum to
the career total. Pooled figures weight their comparison by match count, not by
a flat average.

**Deltas are the payoff.** When a personal number sits beside a general one,
show the difference, signed, coloured: `> +2` green, `< -2` red, otherwise
`#8b96b5`. The delta is often the most useful figure on the card — give it
weight 700 and 15px.

**Surface defaults to today's surface** wherever a match is in context, with an
all-surfaces option.

---

## 6 · Writing

- Labels are nouns, sentence case or the eyebrow caps: "Career by surface",
  "Historical by surface", "Personally", "Dimension edge".
- Findings are stated, not sold: "leans +7 pts to the attacking baseliner",
  "2022, 2021 — not yet on tour".
- Levels are always named the same way: Grand Slams, Masters, ATP 500, ATP 250,
  Other tours.
- Never editorialise a number in copy. Put the number next to its comparison and
  let the reader draw the conclusion.

---

## 7 · Build conventions

- Everything is a Design Component: one `Name.dc.html`, template + logic class.
- **Inline styles only.** No stylesheets, no CSS classes for layout. The only
  things in `<helmet><style>` are the font links, body reset, `@keyframes`, and
  the handful of hover/scrollbar classes that already exist (`.seg`, `.nav`,
  `.row`, `.pcard`, `.mcard`, `.plink`, `.oddlink`, `.wirerow`, `.sigtoggle`).
- Compute in `renderVals()`, never in a template hole. `{{ }}` takes dotted
  paths only.
- Static styles are written literally in the template. A `{{ }}` hole in a
  `style` attribute is only for a genuinely live runtime value.
- Set `hint-placeholder-count` on every `<sc-for>` and `hint-placeholder-val` on
  every `<sc-if>`.
- Before a substantial revision, copy the file to a `... BACKUP` or `v2` name so
  the agreed version survives.
- The live site is a bundle. Editing a component does not update
  `Stennisfy Website.html` — rebundle from `_bundle-src.dc.html` after any change
  that should appear there, and never edit the bundle by hand.

---

## 8 · Don't

- Don't add a second accent colour, a second label style, or a second card radius.
- Don't use emoji, gradient hero backgrounds, or drop shadows beyond the 1px
  hover ring.
- Don't draw imagery in SVG beyond icons, sparklines, bars and scales.
- Don't turn a small edit into a redesign. Change what was asked, leave the rest
  byte-for-byte.
- Don't show a rate on fewer than five matches. Don't show a zero for missing
  data. These are the two errors that make the product look wrong to an analyst.
