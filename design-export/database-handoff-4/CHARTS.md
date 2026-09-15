# Database — cumulative profit charts

Build spec for the four line charts on the Database page: the **Tour** chart, the
**Tournaments** chart (same component, different data), and the three **Players**
charts (one main + a pair of small multiples).

Pixel reference: `Database.dc.html` in this folder — Tour/Tournaments chart at
the `showTourChart` block, Players charts at the `showPlayerCharts` block.

Everything below is exact. Colours, strokes and offsets are not approximate.

---

## 1 · What was wrong before

For context, so the same thing is not rebuilt:

- Both series were blue (`#5b9bff` solid + `#4db8ff` dashed) — indistinguishable
  at a glance, and the dash pattern added noise to an already noisy line.
- Lines were plotted raw at 1.4–1.6px: a hairball, not a trend.
- The zero line was `rgba(255,255,255,0.22)` at 1px — the single most important
  reference on the chart was the faintest thing on it.
- End values were unboxed text sitting on gridlines, with no marker on the line
  and no collision handling.
- Grid labels were 10.5–11px `#5b6880`, below the readable floor for a figure
  a member is meant to compare.

---

## 2 · Series colours

| Series | Stroke | Area fill |
|---|---|---|
| Favourites (Tour / Tournaments) | `#5b9bff` | `rgba(91,155,255,0.11)` |
| Underdogs (Tour / Tournaments) | `#c6ccdb` | `rgba(198,204,219,0.07)` |
| Any Players-tab series | `#5b9bff` | `rgba(91,155,255,0.11)` |

Rules:

- Two series in one frame → blue + light. **Never two blues, never a dash.**
- The Players charts are all one player, so the second colour would carry no
  meaning: every Players series is blue.
- The end-value figure in a Players panel header keeps the signed colours
  (`#3dd68c` positive, `#e0616f` negative). The **line** is never green or red.

---

## 3 · Stroke and smoothing

| | Stroke width |
|---|---|
| Tour/Tournaments — Favourites | `2.6` |
| Tour/Tournaments — Underdogs | `2` |
| Players — main chart | `2.6` |
| Players — pair panels | `2.2` |

All lines: `stroke-linejoin="round"`, `stroke-linecap="round"`,
`vector-effect="non-scaling-stroke"`, `fill="none"`.

**Smoothing (required).** Plot a centred moving average with a **±3 sample
window**, with the first and last values forced back to the raw values so the
endpoints stay exact:

```
smooth(vals, k = 3):
  out[i] = mean(vals[max(0, i-k) … min(n-1, i+k)])
  out[0] = vals[0]
  out[n-1] = vals[n-1]
```

The area path and the end marker both use the smoothed series. Without this the
chart is unreadable; with a wider window it stops looking like real data.

---

## 4 · Plot geometry

The svg is drawn in a fixed user-space viewBox and stretched to the container
with `preserveAspectRatio="none"`, so x is always `0…1000` and y is `0…viewBox
height`. `overflow:visible` is set so end markers can sit on the edge.

| | Tour / Tournaments | Players main | Players pair |
|---|---|---|---|
| viewBox | `0 0 1000 300` | `0 0 1000 200` | `0 0 1000 200` |
| Rendered plot height | `400px` | `360px` | `230px` |
| Y-axis label column | `70px` | `52px` | `52px` |
| Gap between axis column and plot | `12px` | `12px` | `12px` |
| Right label column | `104px` + `12px` gap | none | none |
| X-tick row margin | `10px 116px 0 82px` | `10px 0 0 64px` | `10px 0 0 64px` |

Layout is `display:flex; gap:12px` — axis column (`flex:none`), plot
(`flex:1; min-width:0`), and for the Tour chart a third `104px` column holding
the end plates. The plot div is the positioning context for everything drawn on
the plot: **do not put the plot in a padded parent and position overlays against
that parent** — percentage offsets then include the padding and land in the
wrong place.

---

## 5 · Layer order inside the svg

Bottom to top, exactly:

1. **Loss tint** — `<rect x="0" y="{zeroY}" width="1000" height="{lossH}"
   fill="rgba(255,255,255,0.014)">`.
   `lossH = viewBoxHeight − zeroY`. **Not** the full viewBox height: with
   `overflow:visible` a full-height rect spills below the plot and out of the
   card.
2. **Horizontal gridlines** — one per y-axis step, `rgba(255,255,255,0.06)`, 1px.
3. **Vertical gridlines** — one per x tick, `rgba(255,255,255,0.045)`, 1px.
4. **Area fills** — favourites first, then underdogs (so the deeper series reads
   through). `stroke="none"`, fill per §2.
5. **Zero line** — `rgba(255,255,255,0.40)`, `stroke-width="1.5"`.
6. **Book seam** (Tour/Tournaments only) — vertical dashed line at the seam x,
   `rgba(232,168,78,0.75)`, 1px, `stroke-dasharray="4 4"`.
7. **Lines** — underdogs first, then favourites on top.

All lines carry `vector-effect="non-scaling-stroke"` so the non-uniform stretch
does not thicken them.

### Area path

Close the line down to the zero line, not to the bottom of the plot:

```
area(vals, top, bot, H, zeroY, x0):
  pts = poly(vals, top, bot, H, x0)        // "x,y x,y …"
  fx  = x of first point, lx = x of last point
  return "M fx,zeroY L <pts joined by ' L '> L lx,zeroY Z"
```

`x0` is the fractional x where a late-starting series begins (a Players series
with `dataFrom` later than the shared domain start keeps the shared domain and
leaves its left stretch empty). The area must start and end at that series' own
x range, not at 0 and 1000.

---

## 6 · Overlays on the plot (HTML, not svg)

Positioned absolutely inside the plot div.

**Break-even label** — Tour/Tournaments and Players main only:

```
left:8px; top:{zeroTop}; transform:translateY(-50%);
padding:2px 7px; border-radius:5px; background:#0a0d14;
font: 9.5px/600 'IBM Plex Mono', letter-spacing:0.14em; text-transform:uppercase;
color:#8b96b5;
text: "Break even"
```

`zeroTop` is `zeroY / viewBoxHeight` as a percentage.

**Book seam label** — Tour/Tournaments only:

```
left:{seamLeft}; top:-9px; transform:translateX(-50%);
padding:2px 7px; border-radius:5px; background:#0a0d14;
font: 9.5px/600 'IBM Plex Mono', letter-spacing:0.12em; text-transform:uppercase;
color:#e8a84e; white-space:nowrap;
text: "Bet365"
```

`seamLeft` is the seam fraction as a percentage of the plot width. The opaque
`#0a0d14` background is what makes both labels legible over gridlines.

**End marker** — every chart, one per series:

```
right:-4.5px; top:{endTop}; margin-top:-4.5px;
width/height: 9px (8px, margin-top:-4px, on the Players pair panels)
border-radius:50%; background:{series stroke};
box-shadow:0 0 0 3px #0a0d14;
```

The `-4.5px` right offset centres the dot on the plot's right edge; the box
shadow punches it out of whatever it sits on.

---

## 7 · End-value plates (Tour / Tournaments only)

In the `104px` right column, `position:absolute; left:0; right:0;
top:{endTop}; transform:translateY(-50%)`.

```
padding:7px 9px; border-radius:9px;
Favourites: background rgba(91,155,255,0.11);  border 1px rgba(91,155,255,0.3)
Underdogs:  background rgba(198,204,219,0.08); border 1px rgba(198,204,219,0.24)

line 1 — series name: 11px / 700
         Favourites #82b4ff · Underdogs #c6ccdb
line 2 — value: 16px mono / 700 / line-height 1 / #e7e9ee, margin-top 3px
         rounded units with thousands separator, "u" suffix, e.g. -311u
```

**Collision handling.** A plate is ~54px tall. Convert both end values to
percentages of the plot height; if they are closer than `54 / plotHeight`,
re-centre them on their midpoint ±half that gap, then clamp to `4%…96%`. The
**dot** keeps the true value's position — only the plate moves.

The Players panels do not use plates: their end value already sits in the panel
header, right-aligned, 19px mono / 700 (15px on the pair panels), in the signed
colour.

---

## 8 · Axes

**Y axis.** One label per gridline, right-aligned in the axis column,
`transform:translateY(-50%)`.

| | Size | Weight | Colour |
|---|---|---|---|
| Tour/Tournaments | `11.5px` mono | 500 | `#8b96b5` |
| Players main | `11.5px` mono | 500 | `#8b96b5` |
| Players pair | `11px` mono | 500 | `#8b96b5` |

Positive values are labelled `+250u`, zero is bare `0`, negatives `-250u`, all
with thousands separators. Step is chosen so the span carries at most ten
gridlines, from `[10, 25, 50, 100, 250, 500, 1000, 2500]`.

**X axis.** Absolute-positioned labels at each tick fraction,
`transform:translateX(-50%)`, `11.5px` mono `#8b96b5` (`11px` on the pair
panels). Tour/Tournaments tick every two seasons, 2010→2026. Players main every
2 seasons, pair panels every 4 (they are ~166px wide and a 2-year pitch
collides). Below the Tour/Tournaments tick row sits a `10px` mono eyebrow,
600, `letter-spacing:0.14em`, uppercase, `#5b6880`: `SEASON`.

---

## 9 · Card frame and copy

Unchanged from the rest of the page: `#0a0d14`, `1px solid
rgba(255,255,255,0.09)`, `border-radius:12px`, `padding:16px 18px`.

Tour/Tournaments header row is `display:flex; align-items:baseline;
justify-content:space-between; gap:14px`:

- Title left: `19px / 800 / letter-spacing:-0.01em` — "Cumulative profit, flat 1u"
- Legend right: `12px #8b96b5`, `display:flex; gap:18px`. Each item is
  `display:inline-flex; align-items:center; gap:7px` with a swatch
  `width:18px; height:3px; border-radius:2px` in the series colour. **Swatches
  are solid bars, not dashes.**

Under the header: `11px` mono `#5b6880` — "Units returned on a flat 1-unit
stake, cumulative — below zero is a loss."

Footnote below the chart, for any view whose data crosses the book change:

```
margin:16px 0 0; padding-left:12px;
border-left:2px solid rgba(232,168,78,0.55);
font-size:12.5px; line-height:1.6; color:#8b96b5; max-width:820px;
"Book change at 2026 (Pinnacle → Bet365, wider margin) — the step is a book
artefact, not a market move."
```

The amber left rule ties the note to the amber seam line and its label. Keep
all three the same colour family.

---

## 10 · Retired — do not build

- The old right-hand **"Cumulative profit"** panel (`showProfit: false` in the
  reference, `grid-column` driven, "Match index (chronological) · flat 1u"
  caption). It is dead in the reference and must not appear in the build.
- Dashed series lines anywhere.
- The `#4db8ff` series colour. It no longer appears in any chart.

---

## 11 · Data the chart needs

Per series, per view (Tour + each level/surface/round/year filter combination,
each tournament, each player panel):

```
series: {
  label:    "Favourites" | "Underdogs" | panel title,
  points:   [cumulative units after each settled match, chronological],
  domain:   { from: 2010, to: 2026 },     // seasons spanned by the x axis
  dataFrom: 2016 | null,                  // first season with coverage, if later
  seam:     0.9600 | null                 // fraction of the series at which the
}                                         // priced book changes, for the marker
```

`points` is cumulative, in units, on a flat 1-unit stake, and may be at match
resolution — the front end smooths it for display. The axis domain comes from
the min and max across **all** series in a frame so panels share one scale.
`seam` is `matchesOnOldBook / totalMatches`.
