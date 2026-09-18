# Handoff: Stennisfy — Player Profile

## Overview

The Player Profile is the page a member lands on after picking a player from **Players**. It answers, top to bottom: who is this, what state is he in right now, how has he been going, what does each dimension of his record look like, and what are the three findings worth knowing. Every number carries a denominator; every rate is gated on sample size; nothing is sold.

Page order is **locked** (layout "9e", 2026-09-16):

1. Back link
2. **Header** — avatar, name, ATP rank pill, archetype, country · age, four live-state cells
3. **Recent-form ribbon** — win rate, W/L strip, last six results as chips, "Full ledger →"
4. *(on demand)* **Full ledger** — filters, strip, event-grouped match rows, opens under the ribbon
5. **Eight stat boxes** — "Explore the profile", 4 × 2 grid; each opens a modal
6. **Key insights** — three cards
7. Overlays: stat-box modal, match sheet, hold/break heatmap, full-screen match page

Do not reorder, merge or restyle these blocks. Small data/copy fixes only.

## About the design files

The files in this bundle are **design references created in HTML** — a working prototype of the intended look and behaviour, not production code to lift. The task is to **recreate this design in the target codebase's own environment** (React, Vue, Svelte, native — whatever is established) using its existing patterns, component library and data layer.

The prototype's authoring format (`.dc.html`, `<x-dc>`, `<sc-for>`, `<sc-if>`, `renderVals()`, `{{ hole }}`) is a design-prototype format. Do not port it. Read it as a spec: the template (top of each file) is the markup and styling — every style is inline, so every value you need is on the element; the script at the bottom is the data model and behaviour.

**All data is placeholder.** Player is `P. Martinez`, ATP 136, Spain, 29, "Counter Puncher / Solid Defender". Records, ledgers, curves and heatmaps are hard-coded constants or seeded pseudo-random generators (`rng()`, `curve()`, `calGrid()`, `styleMatches()`…). Wire real data; keep every display rule below. Note the prototype's numbers do **not** reconcile across boxes (e.g. career reads 85–43 in one place and 369–309 in another) — that is placeholder drift, not a design rule. Production must reconcile per §7 of `STENNISFY-DESIGN-INSTRUCTIONS.md`.

### Dead code — do not build

`Player Profile.dc.html` carries earlier blocks that are no longer reachable. Ignore them:

| Template / logic | Status |
|---|---|
| `careerOpen`, `careerSeasons`, `_syncFormHeight`, `careerRef` | old side-by-side career card — removed from layout |
| `marketOpen`, `marketBlurb`, `winTabs`, `winSlider`, `reliability`, `bySplit`, `marketMetrics`, `bySurface`, `tiltLabel` | old inline market section — now lives inside the Market edge modal |
| `splitsOpen`, `l52Open`, `splitSections`, `splitPanel*`, `splitResults*` | old inline splits — now inside the Splits modal (fed via `boxVals.splits`) |
| `formSquares`, `formGroups`, `formMatches`, `formExpanded`, `formToggleLabel`, `formListOverflow` | superseded by `ledgerOpen` + ribbon; the ledger's own "See all N results" button is still live |
| `tourListOpen`, `tourResults` at page level | the tournament list lives in the box modal; only `tourDetailOpen` (the full-width expanded event) is live at page level |
| `Player Profile Layout Explorations.dc.html` | option boards, not a screen |

## Fidelity

**High fidelity.** Colours, typography, spacing, grid tracks and states are final and exact. Every value below is taken verbatim from `Player Profile.dc.html` and `Player Stat Boxes.dc.html`. Where this README and the file disagree, the file wins.

---

## 1 · Page frame

```
body          background #06070a; font-family 'Hanken Grotesk'; color #e7e9ee; -webkit-font-smoothing antialiased
outer         display flex; align-items flex-start; min-height 100vh
sidebar wrap  position sticky; top 0; height 100vh; overflow-y auto; flex none   (hidden when embedded)
main          flex 1; min-width 0; max-width 1440px; padding 26px 34px 70px;
              display flex; flex-direction column; gap 22px
```

Sidebar: 250px, `App Sidebar.dc.html`, active item **Players**. Included for frame context only.

**Back link.** `display inline-flex; gap 9px; font 13.5px/600; color #5b6880; align-self flex-start`. 16px chevron-left icon (stroke currentColor 1.7). Click → back to Players list.

---

## 2 · Header

```
container   border-bottom 1px solid rgba(255,255,255,0.08); padding-bottom 26px;
            display flex; align-items flex-start; gap 28px; flex-wrap wrap
```

**Avatar** — 118×118 wrapper, `position relative; flex none`.
- Disc: `border-radius 50%; background linear-gradient(155deg, rgba(91,155,255,0.22), rgba(91,155,255,0.05)); border 1px solid rgba(91,155,255,0.35)`. Initials centered, IBM Plex Mono 34px/700 `#6aaeff`. Initials = first letter of each surname word, max 2, uppercase (`P. Martinez` → `M`).
- Rank badge: `position absolute; bottom -8px; left 50%; translateX(-50%); background #5b9bff; color #fff; mono 12px/700; border-radius 999px; padding 3px 11px; border 2px solid #06070a`. Text = ATP rank number.

**Identity** — `flex 1; min-width 280px; column; gap 11px`.
- Row 1: name `44px/800; letter-spacing -0.02em; line-height 1; white-space nowrap` + pill `ATP No. 136` — `mono 13px/600; color #5b6880; background rgba(159,178,212,0.1); border 1px solid rgba(159,178,212,0.32); radius 8px; padding 6px 12px; nowrap`. Row is `flex; align-items center; gap 16px; wrap`.
- Row 2: archetype `18px/700 #e7e9ee`.
- Row 3: `Spain` · 1×13px divider `rgba(255,255,255,0.16)` · `Age 29` — `14px #5b6880; gap 14px`.

**Live state** — `flex none; align-self stretch; display flex; align-items stretch`. Four cells, each:
```
cell      column; justify-content flex-end; gap 6px; padding 0 20px; border-left 1px solid rgba(255,255,255,0.09)
label     mono 9.5px/600; letter-spacing 0.14em; uppercase; #5b6880; nowrap
value     mono 15px/700; color per cell; nowrap
sub       12px #5b6880; nowrap; may contain a link (#5b9bff, hover #8bb8ff, no underline)
```
| Label | Value | Colour | Sub |
|---|---|---|---|
| Current run | `W3` | `#3dd68c` for a win run, `#e0616f` for a loss run | `since 12 Sep` |
| Last played | `4 days ago` | `#e8ecf4` | `Tokyo R64` |
| Next match | `Tomorrow · Tokyo R32` | `#e8ecf4` | `vs ` + opponent link → head-to-head |
| Season | `46.7%` | `#e8ecf4` | `14–16` |

Next-match fallbacks: fixture known but opponent unknown → value = event, sub `vs —`; no fixture → value `—` in `#4b5672`, sub `no fixture on record`.

---

## 3 · Recent-form ribbon

```
card    background #0a0d14; border 1px solid rgba(255,255,255,0.09); radius 12px; padding 16px 22px;
        display grid; grid-template-columns auto minmax(180px,1.2fr) auto minmax(0,2fr) auto; gap 22px; align-items center
```

| Col | Content |
|---|---|
| 1 | eyebrow `Recent form` (`.cap` spec) over `mono 22px/700 line-height 1`: rate in `#5b9bff` + record `13px/600 #5b6880` (e.g. **60%** 12–8). nowrap |
| 2 | W/L strip: `flex; gap 4px`, each cell `flex 1; height 22px; radius 5px; mono 10px/700`, W = `bg rgba(61,214,140,0.22) / #3dd68c`, L = `bg rgba(224,97,111,0.22) / #e0616f`. Below: eyebrow `last 18 · oldest → most recent`, nowrap |
| 3 | 1×44px vertical rule `rgba(255,255,255,0.09)` |
| 4 | last six results as chips, `flex; gap 8px; overflow hidden; mask-image linear-gradient(90deg,#000 82%,transparent)` so the row fades rather than clips. Chip: `flex; gap 8px; padding 7px 10px; border 1px solid rgba(255,255,255,0.08); radius 8px; nowrap; flex none; cursor pointer; hover border rgba(91,155,255,0.35)`. Inside: 20×20 W/L tile (`radius 5px; mono 10px/700; bg rgba(61,214,140,0.16)/#3dd68c` or `rgba(224,97,111,0.16)/#e0616f`) + column {opponent `12px/700`, meta `mono 10px #5b6880` = `Event Rd · score`}. Click → **match sheet** (§8) |
| 5 | `Full ledger →` / `Hide ledger` — `12.5px/700 #5b9bff; hover #8bb8ff; nowrap`. Toggles §4 |

Strip and rate use the **same filtered set** as the ledger (last 18 matches after the ledger's surface + price filters).

---

## 4 · Full ledger (toggled from the ribbon)

Card `#0a0d14; border rgba(255,255,255,0.09); radius 12px; padding 22px 24px; column`.

- Title row: `Recent form` 20px/800 · right: `mono 12px #5b6880` with rate in `#5b9bff 700` — `60% win · 18 matches`.
- **Surface filters** (`flex; gap 6px; wrap; margin-bottom 16px`): `All · Grass · Hard · Clay`. Chip `12px; padding 7px 13px; radius 8px`. On: `700; #e7e9ee; bg rgba(91,155,255,0.22); border rgba(91,155,255,0.45)`. Off: `600; #5b6880; transparent; border rgba(255,255,255,0.12)`. Multi-select; `All` is on when nothing else is.
- Strip: same as ribbon but `height 26px`. Under it, left eyebrow `oldest → most recent`; right: legend (10px squares Win/Loss at 0.22 alpha, 11px `#4b5672`), 1×14 divider, then **price filters** `Favourite · Underdog` — chip `11.5px/600; padding 5px 10px; radius 8px` with an 11px check-square (`#5b9bff` when on, `rgba(255,255,255,0.22)` border when off). On style: `#e7e9ee; bg rgba(91,155,255,0.18); border rgba(91,155,255,0.45)`.
- Empty state: `border 1px dashed rgba(255,255,255,0.12); radius 10px; padding 26px; center; 13px #5b6880` — `No matches with these filters.`
- **Event groups.** Header row per event: `grid 52px minmax(150px,1fr) 44px minmax(160px,0.9fr) 48px 48px; gap 10px; bg rgba(91,155,255,0.12); radius 7px; padding 7px 8px; margin-top 12px`. Cols 1–2 span: 7×7 surface square (`#4db8ff` hard, `#e8a84e` clay, `#2ab8a0` grass) + event name `12.5px/800`; then eyebrows `Rd · Result · H · A` (`8.5px #8b96b5`, H/A right-aligned).
- **Match row** (same grid; `padding 8px; border-bottom rgba(255,255,255,0.05); radius 6px; hover bg rgba(255,255,255,0.03); cursor pointer`): date `mono 11px #5b6880` · `Left – Right` `13px` (winner `700 #e7e9ee`, loser `400 #8b96b5`, dash `#3f4860`) · round `mono 10.5px #5b6880` · score `mono 11px #8b96b5` (ellipsis) · H and A closing odds `mono 12px/700 right`. Odds colour: the subject's own price white `#e7e9ee`, opponent's `#5b6880`. Click → **match sheet** (§8).
- Footer: centered `See all 18 results` / `Show less` — `13px/700 #5b9bff; padding 10px 18px; border 1px solid rgba(91,155,255,0.35); radius 11px; hover bg rgba(91,155,255,0.08)`. Collapsed list is `overflow-y auto`.

---

## 5 · Eight stat boxes ("Explore the profile")

Owned by `Player Stat Boxes.dc.html`. Page passes `vals` (headline/support overrides per key, plus the whole `splits` payload).

Header row: eyebrow `Explore the profile` (`mono 10.5px/600; 0.14em; uppercase; #4b5672`) · right `Click a box for the full breakdown` `12px #4b5672`.

Grid: `repeat(4, minmax(0,1fr)); gap 12px`. ≤1400px → still 4; ≤1100px → 2; ≤720px → 1.

**Box** — `position relative; bg #0a0d14; border 1px solid rgba(255,255,255,0.09); radius 10px; padding 18px 16px; column; gap 7px; min-height 140px; cursor pointer; hover border rgba(91,155,255,0.35); transition border-color .14s`.
- Icon 18×18 top-right (`top 14px; right 14px; color rgba(91,155,255,0.3)`; path per box, stroke 1.5).
- Headline `mono 700 #fff line-height 1; padding-right 28px`. Size rule: ≤10 chars **30px**, 11–16 chars **23px**, >16 chars **19px**.
- Title `13.5px/700; margin-top 4px`.
- Support `10.5px #4b5672; line-height 1.4; margin-top auto`.

| # | key | Title | Headline | Support | Icon path |
|---|---|---|---|---|---|
| 1 | career | Career record | `369–309` | `54.4% · all surfaces` | `M6 4h8v3a4 4 0 01-8 0V4ZM10 11v3M7.5 16.5h5` |
| 2 | tourn | Record per tournament | `14` | `tournaments on record` | `M4 5h12v4a6 6 0 01-12 0V5ZM10 15v2M7 18h6` |
| 3 | season | Calendar record | `14–16` | `2026 season · win rate 46.7%` | `M4 3h12v14H4zM4 7h12M8 3v14` |
| 4 | speed | Court speed | `Fast courts` | `72% · 31–12 · 43 matches` | `M3 14c3-6 11-6 14 0M10 4v3M6 6l2 2M14 6l-2 2` |
| 5 | styles | Versus playing styles | `Counter Puncher / Solid Defender` | `style signature · tour average 50` | `M10 3v14M4 7l6-4 6 4v6l-6 4-6-4Z` |
| 6 | splits | Splits | `Grand Slams` | `best split · 57.8% · 116 matches` | `M4 15V9M8 15V5M12 15v-4M16 15V7` |
| 7 | market | Market edge | `−1.87%` | `flat-stake yield · 537 priced · tour −3.79%` | `M3 13l4-5 3 3 4-6 3 4M3 17h14` |
| 8 | profile | Playing profile | `46.7%` | `win rate this season · all surfaces` | `M4 15V9M8 15V5M12 15v-4M16 15V7` |

(Headlines 1, 3, 5, 8 come from the page via `vals`; the rest are the box defaults.)

### 5.1 Modal shell (all boxes)

```
scrim   position fixed; inset 0; bg rgba(4,5,9,0.76); backdrop-filter blur(3px); z 60;
        flex; align-items flex-start; justify-content center; padding 28px 20px; overflow-y auto; fadeIn .16s
card    width 100%; max-width per box; bg #0a0d14; border 1px solid rgba(91,155,255,0.24); radius 16px;
        overflow hidden; modalIn .2s cubic-bezier(.2,.7,.3,1) (fade + 10px rise)
head    flex; gap 13px; padding 20px 22px; border-bottom 1px solid rgba(255,255,255,0.08)
        icon 34×34 radius 10 bg rgba(91,155,255,0.14) #5b9bff · title 17px/800 · subtitle 12.5px #5b6880
        close 32×32 radius 9 bg rgba(255,255,255,0.05) border rgba(255,255,255,0.09) #8b96b5 (hover #e7e9ee)
body    padding 20px 22px 24px
```
Click on scrim closes; click inside stops propagation. Max widths: career **820**, tourn **1120**, season **1180**, speed **1120**, styles **820**, splits **900**, market **1080**, profile **820**.

Subtitles: career `All-time record, by surface, indoors and by season` · tourn `Career win–loss at every event he has played` · season `Where in the calendar his results sit · 678 matches · 2016–2026` · speed `Win rate by court pace band` · styles `Win rate by opposing archetype · minimum 5 matches` · splits `Record and win rate by surface, level, format, round and opponent` · market `How the market has priced him, and what backing him flat has returned` · profile `Serve and return against the tour average`.

### 5.2 Career record (modal)

**A. Rows by surface.** Header: eyebrow `Career by surface` / `2026 by surface` (`mono 10px/600 0.12em #4b5672`) + scope segmented `Career | 2026` right-aligned (`bg #0a0d13; border rgba(255,255,255,0.09); radius 9; padding 2`; item `padding 5px 12px; radius 7; 11px`; on `700 #e7e9ee bg rgba(91,155,255,0.16) border rgba(91,155,255,0.4)`).

Row (`grid minmax(0,1fr) 300px 58px; gap 16px; radius 10px; padding 13px 16px; border 1px solid`): name `14px/700` + meta `mono 11.5px #4b5672` (record · n) · 16px bar track `rgba(255,255,255,0.04)` with fill · right column: units `mono 12px/700` (P&L, green/red) over win% `mono 19px/700`. Rows: Hard, Clay, Grass, Indoors. Click a row → detail card underneath (`bg #06070a; border rgba(91,155,255,0.3); radius 10; padding 13px 15px`) with title, span eyebrow, P&L right, and a match grid `16px 64px 1.1fr 1fr 38px 104px 48px 48px 58px` — cols W/L · Date · Opponent · Event · Rd · Score · Price · Opp · P&L. Rows are clickable → match sheet.

**B. Record by season.** Title `Record by season` 20px/800 · eyebrow `Wins / losses` right. Helper `Click any record to browse those matches — a surface cell for that surface alone, the year for all of them.` 13px #5b6880.
Grid `auto repeat(5,minmax(0,1fr)); gap 0 14px`. Head eyebrows `9px 0.18em`: Year (#4b5672) · Total (#8b96b5) · Clay (#e8a84e) · Hard (#4db8ff) · Indoors (#c6ccdb) · Grass (#3dd68c), right-aligned. Year cell `mono 13px/700`, total `mono 14px/700 tabular`, surface cells `mono 13px tabular`, `padding 11px 0; border-top rgba(255,255,255,0.05)`. Values are `W/L`. Missing → `—` in `#3f4860`. Years before debut: `not yet on tour` italic left-aligned `#3f4860`, not clickable. Footer `Career` row `border-top rgba(255,255,255,0.18); padding 15px 0 13px; 700`. Clicking a cell opens a drill (`grid-column 1/-1; bg #06070a; border rgba(91,155,255,0.3); radius 11; padding 15px 17px`) — title, record, note (`Showing 12 of 46 · scroll for more` / `All N matches`), `Close`; scrolling list `max-height 340px`, grid `46px 12px 1.15fr 38px 40px 1.35fr 48px 48px` — Date · W/L dot · Opponent · Rd · Sets · Set scores · H · A, sticky head, event group rows. Clicking the same cell again closes.

### 5.3 Record per tournament (modal)

Helper `Search a tournament to see Jodar's full career win–loss record there.` (placeholder copy — use the player's short name). Search field: `bg #06070a; border rgba(255,255,255,0.09); radius 12; padding 14px 18px`, 17px magnifier, input `14px #e7e9ee`, placeholder `Search a tournament...`. Filters the list live.

Table head `grid minmax(0,1.6fr) 74px 96px 56px 52px 58px; gap 0 14px` — `Tournament · Surface · Best result · W–L · Win% · Backing` (eyebrow `9px 0.1em #4b5672`). List `max-height calc(100vh − 250px); min-height 420px; overflow-y auto`. Row `padding 11px 10px; border-top rgba(255,255,255,0.06); hover bg rgba(255,255,255,0.02)`: name `13.5px/700` · surface `mono 11px #5b6880` · best `12px #8b96b5` · W–L `mono 13px/700 right` · win% `mono 12px right` (colour per §9) · backing yield `mono 12px right` green/red.

Row click expands a detail (`bg #06070a; border rgba(91,155,255,0.3); radius 10; margin 7px 0 9px; padding 13px 15px`): name + meta, **five tiles** (`grid 5; gap 10`; tile `#0a0d14; border rgba(255,255,255,0.09); radius 11; padding 14px 15px; centered; eyebrow · mono 23px/700 · sub 10.5px #4b5672`) then a scrolling match grid `48px 12px 1.1fr 36px 40px 1.3fr 46px 46px` with edition group rows. Tiles for a **Grand Slam**: `W–L record`, `Grand Slam career`, `Over 3.5 sets · this event`, `Over 3.5 sets · other majors`, `Win rate`. For any other tier: `W–L record`, `Titles won`, `Best result`, `Last played`, `Win rate`.

Also: when a tournament is selected, the **page** shows the same detail full-width directly under the boxes (`tourDetailOpen`) with a 40×40 trophy icon, `19px/800` title, tier · surface pill, `×` close, `Fixtures by edition` list where each fixture row expands into the match panel (Summary / Stats / Points tabs — see §8.2).

### 5.4 Calendar record (modal)

Top: segmented `Calendar | Streaks` (`bg #0a0d13; radius 9; padding 3`; item `6px 14px; 12px`).

**Calendar tab.**
- Four **career tiles** (`grid 4; gap 12`; `#0a0d14; radius 12; padding 15px 16px; centered`): eyebrow · `mono 26px/700` value · pp line (`mono 11px`: signed pp in colour, meta, mark) · repeat line.
- `Calendar form · career` eyebrow + surface segmented `All surfaces | Hard | Clay | Grass | Indoors`.
- **Heat grid** `86px repeat(12, minmax(0,1fr)); gap 0 6px; min-width 880px; max-height 400px; scroll`. Sticky header row (months) and sticky year column, `#0a0d14`. Cell `mono 11.5px; padding 7px 0; center` showing `W–L`; background tint by win rate (green `rgba(61,214,140,…)` above, red `rgba(224,97,111,…)` below, neutral `rgba(255,255,255,…)`). Hover classes: win cells → `rgba(61,214,140,0.42)` + inset 1px ring 0.75; loss → red equivalent; neutral → white 0.14. Cursor pointer where n>0. Click → **cell drill** (`#06070a; border rgba(91,155,255,0.3); radius 10; padding 13px 15px`): title (e.g. `March 2025`), record, total P&L right, `tourLine` eyebrow, grid `14px 44px 1.1fr 1.3fr 1fr 62px 62px 72px; gap 20px` — W/L · Rd · Event · Opponent · Score · Home · Away · P&L; rows clickable → match sheet.
- **Findings strip** (3 columns, `border rgba(255,255,255,0.09); radius 10`): eyebrow · name + `mono` value + mark · sub eyebrow. E.g. `Best month · March · 71% · n=…`.
- **Month footer** (same 13-col grid): `Swing` (season spans colour bars, labels like `Clay swing`), a 66px up/down bar chart around a mid rule (bars `9px` wide, green up / red down; dot `5px #4b5672` when too thin), rows `Month`, `n`, `Yield`, `Vs other months` (signed pp, `700` when |pp| big), `Consistent` (11 mini dots one per year, 6px tall, plus short label).
- Note 11px #5b6880.

**Streaks tab.**
- Four streak tiles (`Longest win run`, `Longest loss run`, `Current`, …) same tile spec, `26px/700 #fff` + sub.
- `Run timeline · career order` + run count. Scrollable bar timeline: bars `width 6px; gap 1px; height 140px` around a mid rule; win runs grow up in green, loss runs down in red; below, year ticks `border-left rgba(255,255,255,0.09); 9.5px 0.12em`. Click a bar → **run detail** (`#06070a; border rgba(91,155,255,0.3); radius 10; padding 12px 14px`): title `W5 · Barcelona → Madrid`, span eyebrow, P&L right; grid `14px 36px 1.1fr 1fr 104px 48px 48px 56px; gap 0 14px` — W/L · Rd · Event · Opponent · Score · Home · Away · P&L. Otherwise the hint `Click a run for its matches` in `10px 0.1em #4b5672`.
- **What follows a run · career** card: grid `118px 176px minmax(56px,.6fr) minmax(76px,1fr) minmax(86px,1fr) minmax(72px,.8fr)`. Head eyebrows `9.5px 0.2em #3f4860`. Row: state `15px/800` (e.g. `After W3+`) · record `mono 11px #8b96b5` + rate `mono 13px` + mark, with a 5px two-tone bar (green share over red track) · n `mono 11px #5b6880` · yield `mono 12px` + mark · **vs baseline** `mono 17px/700` coloured · priced n. Baseline row `All matches` in `#8b96b5` with `border-top rgba(255,255,255,0.09)`. Note under it.

Season note (both tabs): `Rates show at full size from five matches up; under five show W–L only and a dash for the rate. Last 10 spans months and always shows the ten most recent.`

### 5.5 Court speed (modal)

Surface chips `All · Hard · Clay · Grass · Indoors` (`6px 13px; radius 8; 11.5px`; on `bg rgba(91,155,255,0.16) border rgba(91,155,255,0.4)`; off `border rgba(255,255,255,0.08)`).

Two columns `268px minmax(0,1fr); gap 18px`.
- **Band list** (`gap 6px`): bands `Very slow · Slow · Medium · Fast · Very fast`. Band card `grid 1fr auto; gap 10; radius 9; padding 11px 13px; border 1px solid`: name `13px/700` + meta `mono 10.5px #4b5672` (`31–12 · 43 matches`), win% `mono 15px/700` right, P&L units `mono 10px/700` top-right. Selected band: `bg rgba(91,155,255,0.10); border rgba(91,155,255,0.4)`. Bands under 5 matches: name `#3f4860`, pct `—`, `cursor default`, do not open. Footer `Career` totals row (`border-top rgba(255,255,255,0.09)`): matches, units (+ `on N listed` 9px), win%.
- **Selected band panel** `#06070a; border rgba(91,155,255,0.3); radius 10; overflow hidden`. Head `padding 13px 16px; border-bottom rgba(255,255,255,0.07)`: `Fast courts` 13.5px/700 · record mono 11.5px #8b96b5 · note 10.5px #4b5672 (right) · units 12.5px/700. Body `height calc(100vh − 340px); min 340; max 560; scroll; padding 12px 18px`; grid `52px 12px 1.1fr 38px 44px 1.3fr 48px 48px` — Date · dot · Opponent · Rd · Sets · Set scores · H · A, grouped by event; rows clickable → match sheet. Empty: dashed box `No matches …`.
- Note: `Very fast courts have three matches on record, short of the five-match minimum — the band reads as a dash and does not open.`

### 5.6 Versus playing styles (modal)

**Bubble chart card** (`#06070a; border rgba(255,255,255,0.08); radius 12; padding 20px 22px 16px`). Eyebrow `Win rate by archetype · bubble size is match count`. Layout `52px 1fr`, plot `height 240px; border-left/bottom rgba(255,255,255,0.12)`. Y axis 40–80% (ticks 80/70/60/50/40, `10px #4b5672`, gridlines `rgba(255,255,255,0.05)`), **even** rule at 50% `rgba(255,255,255,0.28)` with `even` label. Rotated `Win rate` label. X: archetypes spaced evenly serve-first → baseline-first, plus `All Court Elite` at 92% right of a dashed divider (86%). Bubble: `size 16 + n/47·22 px; radius 50%; bg rgba(91,155,255, 0.25…1 by win rate); border rgba(91,155,255,0.5)`; value label `mono 12px/700 #e7e9ee` above. X labels are abbreviations (`BS`, `BS+FS`, `BS+CB`, `AB`, `SB`, `ACE`) in `mono 9.5px 0.08em`, hover/active lifts them (`bg`, `700`, blue underline). Foot labels `Serve · Baseline · Archetype`. Clicking a bubble or label toggles that archetype's row detail and smooth-scrolls to it.

**Row list** — same row spec as §5.2A (`1fr 300px 58px`). Rows: Big Server, Big Server + First Strike, Big Server + Complete Baseliner, Attacking Baseliner, Solid Baseliner, All Court Elite, plus two under-minimum rows kept with dashes. Total row `Career` with units + pct in `600`. Detail grid `16px 64px 1.1fr 1fr 38px 104px 48px 48px 58px` (W/L · Date · Opponent · Event · Rd · Score · Price · Opp · P&L). Note: `Click an archetype for the matches behind it. Two sit below the five-match minimum and stay listed with a dash rather than dropping out — an absent row reads as an absent opponent.`

### 5.7 Splits (modal)

Top bar: scope segmented `Career | Last 52 weeks` · eyebrow scope sub (`Every tour match on record · 212 matches` / `Rolling 12-month form · 21 matches`) · right segmented `Results | Sets | Service`.

Groups (always these five, this order, these labels): **Surface** Hard/Clay/Grass · **Level** Grand Slams/Masters/Other Tours · **Format** Best of 5/Best of 3 · **By round** Finals/Semi-finals/Quarter-finals · **Opponent** vs. Righties/vs. Lefties/vs. Top 10. Group label = eyebrow spanning the grid, `padding 14px 0 6px; border-top rgba(255,255,255,0.06)`. Row `padding 7px 0; border-top rgba(255,255,255,0.04)`, label `12.5px/700 nowrap`.

| Tab | Grid | Columns (right-aligned, eyebrow head) |
|---|---|---|
| Results | `minmax(84px,1.25fr) repeat(4,1fr)` | Record `mono 11.5 #8b96b5` · Matches `mono 11.5 #5b6880` · Win rate `mono 12.5` coloured · **Vs avg** `mono 14/700` signed pp coloured |
| Sets | same | Tiebreaks % · Games % · Sets % · **Vs avg** |
| Service | `… repeat(5,1fr)` | Matches · Aces · Dbl faults · Holds · Breaks (all `mono 11.5`) |

Legend under table (`11.5px #4b5672`):
- results: `Record and matches played · win rate · vs avg is the gap to this player's average win rate across all splits`
- sets: `TB% tiebreaks won · GM% games won · SET% sets won · VS AVG is the gap to this player's average set win rate · hover a row for raw counts`
- service: `Matches served · aces and double faults as a share of service points · holds and breaks as a share of games · hover a row for the raw win-loss counts`

In the L52 scope, Grass / Finals / Semi-finals have no matches → `—` and `no matches on record`.

### 5.8 Market edge (modal)

Summary line `mono 11px 0.06em #5b6880` — `All priced matches · 537 priced · median odds 1.62 · tour baseline −3.79%`.

**Three role cards** (`grid 3; gap 14`; `radius 12; padding 18px 20px; column; gap 14; cursor pointer`): `All matches · As favourite · As underdog`. Label `17px/800` + matches `mono 13px/700`. Two figures `mono 24px/700` (Yield, coloured) and (At 1u flat, coloured) with `9px 0.12em #4b5672` captions. **Divergence bar** `height 9px; bg rgba(255,255,255,0.05); radius 5`, centre tick `2px rgba(255,255,255,0.3)`, fill grows left (red) or right (green) from centre. Footer `Vs tour −3.79%` 13.5px #8b96b5 · gap `mono 21px/700` coloured. Selected card: `bg rgba(91,155,255,0.08); border rgba(91,155,255,0.4)`; others `border rgba(255,255,255,0.08)`. Selection filters price sensitivity and the chart.

**Price sensitivity** (`border rgba(255,255,255,0.08); radius 12; padding 18px 20px 16px`). Title 17px/800 · `Select a card above to filter`. Grid `minmax(96px,1.1fr) 52px 66px 62px minmax(120px,1.4fr) 74px; gap 10`. Head `10px/600 #5b6880` — n · Record · Win rate · Yield vs break even · Yield; `border-bottom rgba(255,255,255,0.12)`. Groups `Favourite` / `Underdog` (eyebrow `9.5px/700 0.14em #8b96b5` + n). Bands `Under 1.50 · 1.50–2.00 · 2.00–3.00 · Over 3.00`, row `padding 9px 4px; border-bottom rgba(255,255,255,0.05)`: label `14px/700`, n and record `mono 12.5/700 #8b96b5`, win% `mono 13/700`, divergence bar, yield `mono 14/700` coloured. Selected row `bg rgba(91,155,255,0.08)`. Row click → detail (`#06070a; border rgba(91,155,255,0.3); radius 11; padding 14px 16px`) with title/record/note/`Close`, grid `14px 44px 1.1fr 1.2fr 1fr 56px 56px 66px` — W/L · Date · Opponent · Event · Score · Price · Opp · P&L; rows → match sheet. Price note under.

**Book note** box (`border rgba(255,255,255,0.07); radius 10; padding 14px 16px; 12.5px #5b6880`).

**Cumulative profit chart** (`border rgba(255,255,255,0.08); radius 12; padding 18px 20px 14px`). Title (`Cumulative profit · backing`) + `Flat 1u per match at closing odds · N`; right: total `mono 24px/700` coloured + `Profit at 1u flat`. Filter buttons (`mono 11px uppercase; padding 8px 13px; radius 7`) — `Back | Fade`, plus surface. Plot `300px` tall: 46px Y-axis labels (`mono 10.5 #4b5672`), gridlines `rgba(255,255,255,0.05)`, zero rule `rgba(255,255,255,0.28)`, SVG `viewBox 0 0 1000 300 preserveAspectRatio none`: area fill (`rgba(61,214,140,0.12)` / red equivalent) + 2px line (green if final ≥ 0, red otherwise, `vector-effect non-scaling-stroke`). X ticks are seasons. Caption `Horizontal: season · Vertical: cumulative units · the bright rule is break even` (`9.5px 0.1em #3f4860`). Smoothing and series rules follow `design_handoff_database/CHARTS.md`.

### 5.9 Playing profile (modal)

Segmented `General stats | Trading stats` (`bg #0a0d13; radius 10; padding 3`; item `7px 14px; radius 8; 12px`).

**General stats.**
- **Player DNA** card (`#06070a; border rgba(255,255,255,0.08); radius 12; padding 18px 20px 16px`). Eyebrow `Player DNA` · scope `Last 52 | Career` · legend right (14×2 solid `#5b9bff` = player, 14px dashed `#5b6880` = Tour average). Radar `456×272` container, SVG `336×272` at `left 60px`, centre (168,132): 4 concentric web polygons `rgba(255,255,255,0.07)`, 5 spokes, tour polygon `stroke #5b6880 1.6 dasharray 5 4`, player polygon `fill rgba(91,155,255,0.16) stroke #5b9bff 1.8`. Axis labels `mono 9.5px/600 0.1em uppercase #8b96b5` at spoke ends; value labels `mono 10.5px/700 #5b9bff` on chip `rgba(6,7,10,0.85)`. Axes: Serve · Return · Pressure · Baseline · Net (five ratings). Under it a table `1fr 74px 70px 62px` — `Raw rating · Player · Δ vs tour · Tour` (`12px #8b96b5` label, `mono 12` player `#e8ecf4`, delta `mono 12/700` coloured, tour `mono 11 #5b6880`). Note eyebrow `#4b5672`.
- **Metric tiles** in three sections with eyebrow heads `Serve`, `Return`, `Under pressure` (`10px/600 0.12em #4b5672`). Grid `repeat(auto-fit, minmax(216px,1fr)); gap 10`. Tile `#06070a; radius 10; padding 14px 15px; centered; border 1px solid` — value `mono 21px` + delta `mono 15px/700` coloured, label `12.5px/600 #c6ccdb`, `tour average X%` + mark `9px 0.12em`. Tile border turns `rgba(91,155,255,0.35)` when the delta is favourable, `rgba(224,97,111,0.3)` when adverse, `rgba(255,255,255,0.07)` when level (|Δ| < 0.15).
  - Serve: First serve in 62.1 (tour 60) · First serve points won 68.4 (70) · Second serve points won 51.7 (50) · Ace rate 4.4 (7) · Double fault rate 3.7 (2.5, **lower is better**)
  - Return: 1st serve return points won 29.4 (30) · 2nd serve return points won 51.2 (50) · Return games won 24.1 (22) · Break points converted 43.6 (40)
  - Under pressure: Break points converted 43.6 (40) · Break points saved 62.5 (65) · Tie breaks won 54.5 (50) · Deciding sets won 47.8 (50)
  - Note: `Figures rest on 132 matches with detailed stats. The delta carries the sign colour; a downward marker means lower is better. Break points converted appears in both Return and Under pressure — one figure, two readings. Anything not held reads as a dash.`

**Trading stats.** Title `Situational` 20px/800. **Hold / break heatmap** launcher row (`#06070a; border rgba(255,255,255,0.09); radius 11; padding 13px 15px; hover border rgba(91,155,255,0.35)`): 30×30 grid icon, `Hold / break heatmap` 13.5/700 + `hold and break by service-game pair, set by set`, right: overall label `mono 13/700 #e8ecf4` + `Open ›`. Then a grouped table `1fr 62px 62px 48px 62px` — `Record · Rate · Tour · Vs tour`. Groups (expandable, caret rotates 90°, eyebrow title): `Set outcomes`, `Match state`, `Score state`, … Row: label `12.5 #c6ccdb` + mark, record `mono 12`, rate `mono` (size shrinks and greys for small n), tour `mono 11`, vs `mono 700` coloured. Note: `Situational rows rest on the 68 matches with set-by-set data on record, not the full 678-match career shown in Career record. Tour figures are the ATP field average for the same situation over the same window. Situations are counted per match, so a match can appear in several rows.`

**Hold / break heatmap overlay** (z 70, scrim `rgba(3,5,9,0.72)`, card `max-width 760; #0a0d14; border rgba(91,155,255,0.3); radius 14; padding 22px 24px; shadow 0 30px 80px rgba(0,0,0,0.6)`). Title, scope eyebrow pill, `Hold | Break` segmented, `×`. Subject name `15px/700 #5b9bff` + overall pill. Grid `126px 78px 10px repeat(5,1fr); gap 8px 7px`: row label (`1st svc game … 6th+ svc game`, sub `mono 9.5 #5b9bff`), **Global** cell (`border rgba(255,255,255,0.08); radius 9; padding 10px 0`, value `mono 14/700`, fraction `mono 9`), 1×34 divider, S1–S5 cells (`radius 9`, bg heat-tinted, value + fraction/raw). Note under.

---

## 6 · Key insights

Title `Key insights` 22px/800 `-0.015em`, `margin-bottom 16px`. Grid `repeat(3,1fr); gap 16px; align stretch`.

Card `height 100%; #0a0d14; border rgba(255,255,255,0.09); radius 12; padding 24px 24px 26px; column; gap 16px`:
- Icon 36×36 `radius 13px`, bg/colour per insight: positive `rgba(61,214,140,0.14)/#3dd68c`, negative `rgba(224,97,111,0.14)/#e0616f`. 16px stroked path.
- Title `18.5px/800 -0.01em; line-height 1.25; #fff`.
- Body `13.5px #5b6880; line-height 1.7`.

Placeholder copy (exact):
1. **Handles left-handers well** — `58.3% vs lefties (14-10) against 38.7% vs righties (72-114) — a +19.6pp swing where the tour averages +1.3pp. He is 18.3pp better against left-handers than the field.` (green, icon `M4 7l4 4 3-3 5 6M13 14h3v-3` mirrored up)
2. **Trending down on career form** — `23.8% over the last 52 weeks (5-16) against 41% career — running 17.2pp below his own long-run level.` (red, `M4 7l4 4 3-3 5 6M13 14h3v-3`)
3. **Underperforms at Masters** — `Wins 27.8% at Masters (10-26) against a 41% career rate — 13.3pp below his own baseline.` (red, `M4 15V9M8 15V5M12 15v-4M16 15V7`)

Rule for production: each insight is a split whose win rate differs from the player's own baseline by the largest |pp| with n ≥ 10; state the split rate, its record, the comparison and the signed gap. No adjectives.

---

## 7 · Interactions & state

| State | Type | Trigger | Effect |
|---|---|---|---|
| `formSel` | `{all?,grass?,hard?,clay?,fav?,dog?}` | ledger chips | filters ledger + ribbon strip/rate/chips |
| `ledgerOpen` | bool | ribbon link | shows §4 under the ribbon; label flips |
| `formExpanded` | bool | ledger footer button | list `overflow visible` vs capped |
| `sheetMatch` | match id | ribbon chip, ledger row, any drill row | opens **match sheet** (§8.1) |
| `openMatch` + `matchPage` | id, bool | tournament fixture row | inline match panel; `matchPage` = full-screen version |
| `statMode` / `statSet` / `statPtSet` | `summary|stats|points`, set index | tabs in match panel | |
| `tourSel` | tournament key | box modal row / page list | opens page-level full-width detail |
| Box: `open` | key or null | box click / scrim / × | which modal |
| Box: `careerScope` `Career|2026`, `drill`, `drillMatch` | | career modal | |
| Box: `seasonTab`, `calSurf`, `calCell`, `runSel` | | calendar modal | |
| Box: `speedSurf`, `speedBand` | | speed modal | |
| Box: `styleOpen`, `styleTick`, `styleMatch` | | styles modal | |
| Box: `splitScope`, `splitTab` (page-side `scope`, `splitTab`) | | splits modal | |
| Box: `mkCard`, `mkBand`, `mkFilter`, `side back|fade` | | market modal | |
| Box: `profTab`, `dnaScope`, `hbOpen`, `hbMode hold|break`, situational group open flags | | profile modal | |
| Box: `sheetId` | | any drill row | match sheet inside modal (z 60) |

Motion: `.14s ease` on background/color/border-color; carets `transform .14–.16s`; modal `fadeIn .16s` + `modalIn .2s cubic-bezier(.2,.7,.3,1)`. Nothing else animates.

Hover: rows `rgba(255,255,255,0.03)`; boxes/cards border `rgba(91,155,255,0.35)`; links `#8bb8ff`; `.plink`/`.lnk` underline; close buttons text `#e7e9ee`.

Every overlay closes on scrim click and on its × button. Opening a second drill closes the first; clicking the open item again closes it.

---

## 8 · Match views

### 8.1 Match sheet (overlay, z 60)

Scrim `rgba(3,5,9,0.72)`; card `max-width 760px; #0a0d14; border rgba(91,155,255,0.3); radius 14; padding 22px 24px 26px; gap 16; shadow 0 30px 80px rgba(0,0,0,0.6)`.
- Head: `P. Martinez v {opp}` 17px/800 · header line `mono 11px 0.06em #5b6880` (event · round · date · surface) · right: result `mono 14/700` (W green / L red) + price line `mono 10.5 #5b6880` (`1.80 v 2.05 · +0.80u`) · ×.
- **Dominance ratio** strip (`#06070a; border rgba(255,255,255,0.08); radius 10; padding 13px 16px; grid 1fr auto 1fr`): player DR `mono 24/700 #5b9bff` · label `10px/700 0.16em #8b96b5` · opponent DR `mono 24/700 #e7e9ee` right.
- Sections `Service · Return · Points won` — title band (`center; mono 9.5/700 0.18em #5b6880; #06070a; border rgba(255,255,255,0.07); radius 8; padding 8px 0`). Each stat row: `grid 1fr auto 1fr` — player value `mono 15/700 #5b9bff` + sub `mono 10 #4b5672` (fraction) · label `mono 9.5 0.14em #8b96b5` · opponent sub + value `mono 15/700 #e7e9ee`; under it two 7px bars from centre (`rgba(255,255,255,0.05)` tracks; left fill `#5b9bff`, right `rgba(255,255,255,0.75)`).
- Rows — Service: Serve rating, Aces, Double faults, 1st serve %, 1st serve points won, 2nd serve points won, Break points saved. Return: Return rating, 1st return points won, 2nd return points won, Break points converted. Points won: Winners, Unforced errors, Net points won, Service points won, Return points won, Pressure points, Total points won.

### 8.2 Match panel (inline under a tournament fixture; also full-screen `matchPage`)

Container `#080b12; border rgba(255,255,255,0.09); radius 12; padding 16px 16px 8px`. Centered segmented `Summary | Stats | Points` (`padding 8px 15px; 12.5px`).
- **Summary**: meta line `mono 11 #4b5672`; `Score` eyebrow; per-player rows (dot for server, name `13.5/700`, sets-won tile `mono 15/700; padding 2px 0; radius 5; bg` tint for winner, per-set games `mono 13/700 #5b6880` with tiebreak superscript `9px`); `Match time` row with total + per-set durations. Content `max-width 560px; centered`.
- **Stats**: set segmented (`Match | Set 1 | Set 2 …`), player names row (`13px/700`, player `#6aaeff`), `Service` band, stat rows with label centered + `lower is better` hint where relevant, two 6px bars (`#6aaeff` left, `#e7e9ee` right).
- **Points**: set segmented; per set a label band (`mono 11 0.16em; #0a0d14; radius 9; padding 11px`); per game a block (`padding 16px 4px; border-bottom rgba(255,255,255,0.07)`) with `grid 1fr auto 1fr` score (`mono 18/700`, server icon 13px, `LOST SERVE` badge `9.5/700 0.08em #e0616f bg rgba(224,97,111,0.1) border rgba(224,97,111,0.34) radius 5`), then the point sequence `mono 12 #5b6880` with `BP` (amber `#e8a84e`) / `SP` (blue) badges `8.5px`. Tiebreak sub-block `10px 0.16em` label + per-point rows.

Full-screen variant: `position fixed; inset 0; z 80; #06070a; scroll`; inner `max-width 1000px; padding 26px 34px 70px`; `‹ Back to profile` link; title `A v B` 26px/800 with `v` in `#3f4860`; meta `mono 12 #5b6880`.

---

## 9 · Data rules (non-negotiable)

- **Sample gate.** n ≥ 10 → rate full size `#e7e9ee`. 5–9 → rate `#5b6880`, smaller, `small sample` mark. < 5 → no rate, W–L only, `too few matches for a rate` / band or row does not open. 0 → `—` and `no matches on record`.
- **Not wired → `—` in `#4b5672`.** Never `0`, never `0%`.
- **Signed values.** Deltas/yields/P&L: `> +2` (or > 0.5 pt) `#3dd68c`, `< −2` `#e0616f`, else `#8b96b5`. Minus is U+2212 `−`, ranges use en dash `–`, separators are `·`.
- **Win-rate colour** in tables: ≥ 55% `#5b9bff`, otherwise `#c6ccdb`; vs career baseline: above → green, > 5 below → red, else `#e7e9ee`.
- **Surface colours** are semantic and fixed: clay `#e8a84e`, hard `#4db8ff`, indoors `#c6ccdb`, grass `#3dd68c` (ledger uses `#2ab8a0` for grass squares — align to `#3dd68c` in production).
- **Splits reconcile** to the career total; pooled figures weight by match count.
- Every rate shows its record and n next to it.

---

## 10 · Design tokens

Colours — page `#06070a` · card `#0a0d14` · control well `#0a0d13` · inner drill `#06070a` · match panel `#080b12` · border `rgba(255,255,255,0.09)` · subtle `0.05–0.07` · strong `0.12–0.18` · accent `#5b9bff` (bright `#6aaeff`, hover `#8bb8ff`) · accent fills `rgba(91,155,255,0.08 / 0.12 / 0.16 / 0.22)` · accent borders `rgba(91,155,255,0.22 / 0.3 / 0.35 / 0.4 / 0.45)` · text `#e7e9ee` · bright `#e8ecf4` / `#fff` · secondary `#8b96b5` · neutral value `#c6ccdb` · label `#5b6880` · faint `#4b5672` · ghost `#3f4860` · positive `#3dd68c` · negative `#e0616f` · amber `#e8a84e` · pill grey `rgba(159,178,212,0.1)` / border `0.32`.

Type — Hanken Grotesk 400/500/600/700/800 (UI) · IBM Plex Mono 400/500/600/700 (every number, code, date, tag, eyebrow). Eyebrow (`.cap`): `mono 9.5px/600; letter-spacing 0.16em (0.12–0.18 in places); uppercase; #5b6880`.

Scale — name 44/800 · section 20–22/800 · modal title 17/800 · card label 17/800 · box headline mono 30/23/19 · tile figure mono 26/700 · big figure mono 24/700 · body 13–13.5 · row label 12.5–14/700 · mono value 11–15 · meta 10.5–12 `#4b5672`/`#5b6880`.

Radii — 16 modal · 12 card · 10–11 inner card/control · 9 pill/segment well · 8 chip · 7 segment item · 5 W/L tile · 4 bar.

Spacing — page gap 22 · card padding 22×24 · modal body 20×22 · tile padding 15×16 · grid gap 12 (boxes) / 16 (insights) / 10 (tiles) · row padding 7–13.

Shadows — none except the overlay card `0 30px 80px rgba(0,0,0,0.6)` and the 1px hover ring.

---

## 11 · Assets

No raster assets. All icons are inline 20×20 stroked SVG paths listed in §5 and §6. Fonts from Google Fonts: `Hanken+Grotesk:wght@400;500;600;700;800`, `IBM+Plex+Mono:wght@400;500;600;700`.

## 12 · Files

| File | What it holds |
|---|---|
| `Player Profile.dc.html` | page frame, header, ribbon, ledger, insights, tournament detail, match panel, match sheet; page logic |
| `Player Stat Boxes.dc.html` | the eight boxes, every modal, hold/break heatmap, in-modal match sheet; box logic |
| `App Sidebar.dc.html` | sidebar, frame context only |
| `STENNISFY-DESIGN-INSTRUCTIONS.md` | product-wide visual and data rules — read first |
| `support.js` | prototype runtime — lets the `.dc.html` files open in a browser; not for porting |

Open `Player Profile.dc.html` directly in a browser to see the live prototype.
