# Handoff: Match analysis (Progression v1 — every tab)

For Paperclip. Source of truth: `Match Analysis Progression v1.dc.html` in this folder (656 KB, 5 370 lines: template + logic). It carries **every locked Match analysis tab** as of 2026-09-27: Key factors (original), News, Playing style, Form, H2H, Match Stats, Progression, Overview, Tournament, Weather, Odds, Market edge, plus every pop-up they open.

Build it **pixel-perfect**. Everything below is exact; where this README summarises, the file is the answer — every value (px, hex, weight, letter-spacing, radius, opacity) is inline in the markup, and every number shown is computed in the logic class. Nothing is hidden in stylesheets except the `<helmet><style>` block at the top of the file (hover rules, the H2H `:has()` dim rules, scrollbars, the `sigIn` keyframe).

## 1 · About the design files

The files here are **design references written in HTML** (Design Components). They are prototypes showing exact look and behaviour, not production code to paste. Recreate them in the app's existing stack (React + the shell's theme runtime), using the shell's components where they already exist (segmented control, hairline card, mono caption, match row, pop-up frame).

Fidelity: **hi-fi, locked.** Do not redesign, re-space, re-colour or "improve". Sample data throughout (see §9); wire the real data behind the same shapes.

Open `Match Analysis Progression v1.dc.html` in a browser (needs `support.js`, `Match Detail.dc.html`, `Database.dc.html` beside it). It opens on **Progression**; the left menu switches tabs. Review-only controls (STATE switchers, SAMPLE DATA chips, "THRESHOLDS TBD" chip) are marked in each tab section; drop them in production unless told otherwise.

Already-written detailed specs for three tabs are in `specs/` and remain valid (they were written against the same locked designs): `Weather Tab - Paperclip.md`, `Odds Tab - Spec.md`, `Market Edge Tab - Paperclip.md`. This README covers the rest in the same depth and cross-references those.

Screens (full-height captures of the modal at 1296 px wide, 1×, night source palette) are in `screens/`. Filenames start with the tab number; `P*` = pop-ups.

## 2 · Frame

The modal (`analysisOpen`):
- Overlay: fixed inset 0, `rgba(4,5,8,0.72)`, flex centred, padding 24px. Click outside closes.
- Modal: width min(1300px, 100%), height min(92vh, 1100px), background `#0a0d14`, border 1px `rgba(255,255,255,0.09)`, radius 22px, shadow `0 30px 80px rgba(0,0,0,0.6)`, overflow hidden, column flex.
- Header (76px): padding 22px 28px 18px; "Match analysis" 22px/800 `#e7e9ee` letter-spacing −0.01em; sub `mm.tourn · round long form` 13px `#8b96b5` (roundLong map: R32 → 1/16-finals, R16 → 1/8-finals, QF → Quarter-finals, SF → Semi-finals, F → Final); ✕ button 34×34, radius 10, bg `rgba(255,255,255,0.05)`, border 1px `rgba(255,255,255,0.09)`, icon 14px stroke `#8b96b5`; hover bg 0.09.
- Body: grid `214px minmax(0,1fr)`, hairline 1px `rgba(255,255,255,0.06)` between header and body and between menu and content.
- Left menu: padding 22px 14px; items 40px tall, padding 0 12px, radius 10, gap 12, icon 16px stroke 1.7 (paths in `TABS`), label 14px/600. Active: bg `rgba(91,155,255,0.12)`, label `#fff`, icon `#5b9bff`. Inactive: label `#5b6880`, icon `#4b5672`; hover bg `rgba(255,255,255,0.04)` label `#e7e9ee` (`.nav` rule). After a hairline: "Download report" 14px/600 `#5b9bff` with a 16px download icon.
- Tab order (top → bottom): Key factors · News · Playing style · Form · H2H · Match Stats · Progression · Overview · Tournament · Weather · Odds · Market edge.
- Content column: padding 26px 28px 40px, `overflow-y:auto`, scrollbar 10px thumb `rgba(255,255,255,0.08)` radius 6.
- Default tab: `props.initialTab` (shell passes the last-used tab; falls back to Progression standalone).

Shell contract (bundle): the shell mounts this component with `match` (raw match spec: `{tourn, round, surface, when, a:{name, odds, score?, won?}, b:{…}, live?, retired?, walkover?}`), `initial-tab`, `on-close`, `on-open-player(name)`. Player names anywhere are links that call `onOpenPlayer` (stopPropagation + preventDefault).

## 3 · Theme — read this before colouring anything

The source file is written in the **pre-theme palette** (card `#0E1019`, text `#e7e9ee`, blue `#5b9bff`, green `#3dd68c`, red `#e0616f`, amber `#e8a84e`). On the website a runtime theme table maps those to the chosen site theme. **Implement with tokens, not the literal hex in the file.** Mapping (2026-09-28, chosen but not yet locked — the Portal file `Portal 24b Night 26f Day.dc.html` is the reference):

| Role | In source file | Night 24b | Day 26f |
|---|---|---|---|
| Page | `#06070a` / `#0a0d14` (modal bg) | `#191B24` | `#1E202B` |
| Card / header / stat box | `#0E1019`, `#0a0d14` | `#14151D` | `#181922` |
| Inner box (nested in a card) | `#0C0E16`, `#0f1420` | `#181922` | `#1C1E28` |
| Raised / pop-up surface | `#131623` | `#1B1C27` | `#20222E` |
| Hover fill | `rgba(255,255,255,0.04)` | `#20222E` | `#262836` |
| Selected segment / active nav tile | `rgba(91,155,255,0.12–0.22)` wash | `#222431` + white text | `#292B3A` + white text |
| Hairline (card, row) | `rgba(255,255,255,0.06–0.09)` | `rgba(255,255,255,0.05)` | same |
| Hairline soft (inner) | `rgba(255,255,255,0.05)` | `rgba(255,255,255,0.035)` | same |
| Hairline strong (pop-up, table header) | `rgba(255,255,255,0.10–0.16)` | `rgba(255,255,255,0.10)` | same |
| Open / selected card outline | `rgba(91,155,255,0.35–0.45)` | `rgba(157,179,242,0.30)` | same |
| Text primary | `#e7e9ee` | `#FFFFFF` | same |
| Text secondary | `#aab3c8`, `#8b96b5` | `#DDE0EA` | same |
| Labels / captions / dim | `#5b6880`, `#4b5672` | `#A3AABE` | same |
| Bars, fills, chart lines, today dot | `#5b9bff` / `#6aaeff` (fills) | `#5B82E8` | same |
| Links, accent text, current-set, TODAY tag | `#5b9bff` / `#6aaeff` (text) | `#9DB3F2` | same |
| Positive / W / live dot | `#3dd68c` | `#5CCB84` | same |
| Negative / L | `#e0616f` | `#E06266` | same |
| Amber (Weather severity only) | `#e8a84e` | keep `#E8A84E` — Weather is the one place amber is allowed until Michael sets thresholds | same |
| Pro / CTA button | — | `#2F52D6` | same |
| Header glow | — | `radial-gradient(ellipse 1100px 420px at 720px -60px, rgba(52,70,170,0.24) 0%, transparent 100%)` | glow alpha 0.16 |

Rules: blue is structure and links; green/red appear **only** on signed values, W/L marks and the live state; surfaces (Hard/Clay/Grass) are neutral text; no gradients on cards. The site follows the OS setting with a Night / Day / Auto override in the sidebar; the modal must re-theme live.

Fonts: **Hanken Grotesk** 400/500/600/700/800 for UI text; **IBM Plex Mono** 400–700 for every number, date, odds, caption and tag. `-webkit-font-smoothing:antialiased`. Caption style used everywhere ("mono caps"): mono 9–11px, weight 600–700, letter-spacing 0.12–0.14em, uppercase, label colour.

## 4 · Shared components

### 4.1 Segmented control (`seg`)
Row, gap 2px, padding 3px, radius 10, bg inner-box, border 1px hairline-soft. Item: padding 6px 12px, radius 8, 12.5px; selected 700 primary text on the selected tile; unselected 600 label colour, transparent. Every tab uses it (Form filters, Overview tier, Market edge view/scope, Playing style DNA window, Match Stats sheet tabs).

### 4.2 Tournament-tab match row (used by Form recent matches, H2H meetings, Tournament records, Overview pop-ups, Playing-style meetings, Market-edge pop-ups)
Sticky column header on top (mono caps 9px `#5b6880`): DATE · (square) · OPPONENT · RD · SETS · SET SCORES · H · A (or Price · Opp where noted). Group header per tournament: event name 13px/700 primary + meta in mono 11px label ("surface · W–L", or "Won · 5–0", "Second round · 1–1"). Row: grid `52px 14px minmax(0,1fr) 44px 56px minmax(0,1.2fr) 56px 56px`, height 29px, padding 0 6px, hover `rgba(255,255,255,0.015)`. Cells: date mono 11px label ("24.07."); W/L square 8×8 radius 2 green/red; opponent 13px/600 primary (link); round mono 11px label; sets mono 12.5px/700 in green/red ("2 - 0"); set scores mono 12px secondary ("7-6, 6-3", tiebreak in brackets, "ret." suffix); H / A mono 12px, own price 700 primary when favourite else 500 label. Selected row (its sheet open) bg `rgba(91,155,255,0.1)`.

### 4.3 Match stats sheet (pop-up) — `mkSheet(mm, scopeKey, pbpKey)`
Opened by any match row / dot / cell across all tabs via `maFormSheet: mid` (Form, H2H, Overview, Market edge, Tournament, Progression `_pgSheet`, Playing style `_psSheet` all register into one `sheetMap`). Fixed overlay `rgba(4,5,8,0.72)`; box max 1000px, bg raised `#131623`, border 1px `rgba(255,255,255,0.10)`, radius 18, padding 22px 24px, scrolls inside; ✕ top-right 30×30.
Header 2a: meta line mono 11px label ("ATP Washington · Hard · Quarter-finals · Jul 20, 2026"); avatars 48px (initials, ring 2px in player colour) with closing-odds badge (mono 11px/700 on inner box, radius 6) under each; names 17px/700; sets score centred 44px/800 mono, winner primary / loser label; set chips under it (mono 12px, inner box, radius 6, tiebreak in brackets); "[Winner] won 6-4 4-6 7-6" pill (mono caps 9.5px, inner box, hairline; "ret." on retirements; set count from the row).
Tabs (seg): Match · Key stats · Set 1…N · Point by point. Opens on **Key stats**.
- Key stats: header strip "KEY STATS" (mono caps on inner box, full width); six rows: Dominance ratio · Serve rating · Return rating · Winners / total points · Unforced errors / total points · Winners / unforced errors. Row: A value mono 19px/700 blue-link colour (+ "(28/210)" mono 11px label), centred label mono caps, B value primary; under it two half-bars from centre (track `rgba(255,255,255,0.08)` 6px radius 3, fills A blue / B `#c9cdd9`), lengths proportional to value share.
- Match / Set N: Points won section (Total, Service, Return, Break points, Winners, Unforced errors, Winners / unforced errors), Serve section (1st %, 1st won, 2nd won, aces, DF), Return section — same row style; dominance box only on Match/Set tabs.
- Point by point: per set, game rows (server icon, game score, running set score); 7-6 sets show games to 6-6 then a "TIEBREAK · SET N" strip and one row per point with running score, serve ball, LOST SERVE / SP tags.
Screens: `P1-…key-stats`, `P1b-…point-by-point`, `P1c-…match-stats`, `P6-progression-box-match-sheet`. Match Stats **tab** renders the same sheet inline (§5.6).

### 4.4 Pop-up frame (Overview, Market edge, Odds movement)
Fixed overlay as above; box bg `#0E1019` (Overview / Market edge) or `#131623` (Odds movement), border 1px `rgba(255,255,255,0.08)`, radius 18, padding 22px 24px, max-width 900 / 1000 / 1080px per pop-up, max-height 90vh, scrolls inside. Title 17px/700 + mono caps subtitle; ✕ 30×30 top-right; Esc and outside-click close; inner clicks `stopPropagation`.

### 4.5 Hot lines (one component, Form + H2H — `hotFor`)
Best-covered line per family (Handicap / Totals / Sets & tiebreaks) by default; "Show all lines (N)" toggles the full list grouped by family, link text becomes "Best line per family". Line row: name 13px/600 (+ "MOST COVERED" tag on the top line, washed `rgba(91,155,255,0.06)` + 25% outline), count "7/9" mono 12px, cover bar (track 0.08, fill blue), rate mono 13px/700, then the dot strip: one 10px dot per meeting (blue filled = covered, blue outline = not covered, 6px grey = not eligible: RET / Bo5), oldest → newest, tooltip "tournament year · round", click → sheet. Column headers over the dots: tournament code + year (H2H) or code + date (Form), opponent on hover. Hovering a line dims that player's non-covered matches to 0.32 (`.h2wrap:has(.hl-N:hover) .h2m`). Family group tabs All · Totals · Game handicap · Set handicap · Sets & tiebreaks (Form only, `maFormHotGroup`). Screens `06b`, `06c`, `07b`.

## 5 · Tabs

### 5.1 Key factors (`keyFactorsFor`, `KV = 'o'`) — screen `03-key-factors.png`
Original card design; the redesign is on hold (Michael designs it). Grid `repeat(auto-fill, minmax(300px,1fr))` gap 12 of factor cards (card surface, radius 14, padding 16 18): mono caps title, two-line reading, footnote. The file also carries five hidden layouts (`analysis.kf.v.a…e`) and `kf2For` data — **ignore them**, build `v.o` only.

### 5.2 News (`newsFor`) — screens `04-news.png`, `04b-news-article-expanded.png`
- Filter: seg **All | Sinner | Alcaraz** (player surnames), left; article count right in mono caps.
- Group header per player: name 13.5px/700 primary + count "· 7" label + hairline to the right.
- Row: padding 12px 0, hairline below; headline 14px/600 primary ("Sample: …"), meta mono 11px label "source · time ago"; chevron right. Click expands **in place, one at a time** (`maNewsOpen`): body two paragraphs 13.5px/1.55 secondary, padding 6px 0 14px.
- Empty: "No news for this match yet." 13px label centred, padding 40px. Standalone reads empty when `window.STENNISFY_NEWS` is absent; the file ships 14 sample articles.

### 5.3 Playing style (`ps2For`) — screens `05-playing-style.png`, `05b-…-meetings-profile-open.png`
Order top → bottom:
1. **Style matchup** card: archetype per player (18px/800) + secondary tag chip (mono caps 9px, inner box); centre line "Counterpunchers beat Attacking Baseliners" 13px secondary; split bar 8px (A 52% primary fill / B 48% `rgba(231,233,238,0.7)`), 50% coin-flip tick 1×14px white 0.4; lean pill mono caps under it; three surface tiles Clay / Hard / Grass (inner box, radius 10, padding 10 12, name 12px/700 + record mono 12px), today's surface washed `rgba(91,155,255,0.10)` + 30% outline.
2. **Personal record vs this style**: one clickable box per player (card, radius 14, padding 16 18): "W–L" 22px/800 mono, "rate · n" mono 12px label, tug-from-centre bar (wins primary / losses 70% white, "+N wins" / "+N losses" mono caps under the bar), "Matrix avg X% · deviation" 12px label, link "Show career meetings (N)" 12.5px/700 link colour. Open box: wash `rgba(91,155,255,0.08)` + 35% outline (`psMeetA` / `psMeetB`).
3. **Career meetings vs this style** (only for open boxes; side by side, equal height): Tournament-tab rows grouped by tournament (§4.2); rows → sheet.
4. **Playing style DNA** card: seg **Last 52 weeks | Career** (`psDnaWin`); five-axis radar 320×320 (axes Serve, Return, Under pressure, Dominance ratio, Surface Elo; rings at 20/40/60/80/100 `rgba(255,255,255,0.06)`; A polygon primary stroke 1.5 + fill 0.12; B dashed `6 4` 70% white); axis labels are HTML overlays: name 12px/700 + both raw values mono 11px under it (A primary, B label). "Show player profile" drop-down (`psProf`) inside the card: mirrored percentile bars per axis (A left, B right, track 0.08, fill primary / 70%), raw value mono 12px, ▴/▾ Δ vs 2024–now in green/red (no Δ on Career).
No "Style dimensions" view in production (`view` fixed to `ratings`). Both players white; blue for links / today / selection.

### 5.4 Form (`formFor`) — screens `06-form.png`, `06b-form-data-and-hot-lines-open.png`, `06c-form-all-lines.png`
Filter bar (row, gap 10, wrap): surface seg **All | Hard | Clay | Grass** (`maFormSurf`); role seg **All | As favourite | As underdog** (`maFormRole`, default All); window control: mode switch **Matches | Days** (`maFormWin`) then seg **Last 5 / 10 / 15 / 20** (`maFormN`, default 10) or **10 / 20 / 30 / 60 days** (`maFormDays`, default 30). Right: SAMPLE DATA chip (review only).
Card header 5c per player (two columns `minmax(0,1fr) minmax(0,1fr)` gap 14): name 15px/700 + mono caps "LAST 10 · ALL · ALL ROLES", W–L 26px/800 mono, win rate + "flat 1u ±X.Xu" mono 12px (signed colour).
**Form bar**: one bar per match, oldest → newest (most recent right; empty slots `rgba(255,255,255,0.07)` on the left when fewer than N), W bars 28px tall green, L bars 18px red at 0.9 alpha; each match's closing price mono 10px label under its bar; hover tooltip (`.elotip`): "W · v Opp · Tournament · R16 · date · 6-4 6-3"; click → sheet. Caption "oldest → newest" mono 9px.
**"Show form data"** toggle (centred link 12.5px/700, chevron; `maFormCard`): drop-down rows in a two-player grid — Median odd · Median opp odd · Opposition Elo (avg opponent Elo) · Flat 1u · Elo change; then Fatigue group: Load · Matches 7d / 14d. Row: label 12.5px secondary left, value mono 13px/700 right, hairline between.
**"Show hot lines"** toggle (`maFormHot`, window label right): per player stacked; header = name 14.5px/700 with mono caps "LAST 10 · ALL · ALL ROLES" underneath (no avatar, no median odd, no short-odds chip); then the Hot lines component (§4.5) with column headers "code + date".
**Recent matches**: Tournament-tab rows (§4.2), sticky header, grouped by event with "surface · W–L" meta; "Show more" link after the window (`maFormMore0/1`).

### 5.5 H2H (`h2hV2For`) — screens `07-h2h.png`, `07b-h2h-hard-filter-all-lines.png`, `07c-h2h-one-meeting.png`, `07d-h2h-surface-with-no-meetings.png`, `07e-h2h-no-meetings.png`
- **STATE switcher** (dashed box, review only): 9 meetings / 1 meeting / No meetings / Loading (`h2State`). Remove in production; the state comes from data.
- Surface filter (seg with counts "All 9 · Hard 7 · Clay 2 · Grass 0"; 0-meeting surfaces greyed, unclickable), note "filters everything below" 12px label.
- **Record card** (full width, follows the filter): title mono caps "OVERALL" / "ON HARD"; link "Meetings ↓" right (scrolls to the list without resetting the filter); centre: A name 15px/700 · A count 34px/800 mono in a 30px circle inner box · dash · B count · B name; **tug bar** 8px radius 4 track `rgba(255,255,255,0.08)`: grows from a centre line (1×14px) toward the leader, width = margin / total × 50%; fill primary for the leader (Alcaraz white at 70%); under it "+N Surname" / "Level" mono 12px/700 + "· 9 meetings" label. Surface with 0 meetings: "0 — 0", "No meetings · 0 meetings", list shows "No meetings on clay." (screen 07d).
- Stats row (three inner boxes): Sets won · Tiebreaks · Deciding sets, each "A – B" mono 20px/700 + caption.
- **Price range** card: header "Price range · Closing odds · Pinnacle" + SAMPLE chip + "N of M meetings priced"; per player card (`#0C0E16`, 5% hairline, radius 12, padding 14 16): Lowest / Average / Highest (mono 18px/700 + event + year 11px label), simple lowest→highest bar 6px with one white "Today" dot (10px, white ring). Hovering a figure pops every priced close (newest first; lowest/highest tagged); lowest/highest also highlight their meeting in the list and click to its sheet. n=1: single price only; 0 priced: "No closing odds on record for these meetings" with dashes.
- **Hot lines** (§4.5; headers = tournament code + year, dot legend under, no median label; dots blue `#5b9bff`).
- **Meetings**: Tournament-tab rows (§4.2) from Sinner's side, group header = event + year bold + surface, columns Round / Sets / Home / Away centred over their values, footnote "Home = Sinner's closing price, Away = Alcaraz's". Sinner and his values white everywhere; Alcaraz white with bars at 70%.
- One meeting: same cards with n=1 copy; Loading: three skeleton cards (0.06 blocks, pulse).

### 5.6 Match Stats (`matchStatsFor`) — screens `08-match-stats-key-stats.png`, `08b-…-point-by-point.png`, `08c-…-match-view.png`
Completed matches: the §4.3 sheet **inline** (no overlay, no ✕), 9% white outline, max 760px centred, opens on Key stats, **no set chips under the score on this tab** (the pop-up keeps them). State keys `maMsScope` / `maMsPbpSet` (separate from the pop-up's). Uncompleted matches: card with "Match not played yet" 14px secondary centred, padding 48px.

### 5.7 Progression (`progressionFor`) — screens `01-progression.png`, `01b-…-round-highlight-metric-filter.png`, `01c-progression-r1-empty.png`, `01d-progression-facing-final.png`, `P6-…-match-sheet.png`
- **FACING switcher** row (review only — production reads the match's round): mono caps "FACING" + chips R1 R2 R3 R4 QF SF F + "QF · Alcaraz bye" (bye case). Chip: mono 11px/700, padding 5 9, radius 7, border 1px 0.08; selected = Raised ink `#131623` + 16% white outline, primary text. SAMPLE DATA chip right.
- Title "Tournament progression" 20px/800 + tournament 20px/600 `#8fa3d9`-ish accent (link colour); sub "Facing the quarter-final · 4 rounds played each · this match excluded" 13px label. Prior rounds = rounds before the one faced. **R1 shows "No progression yet"** card (screen 01c).
- **Road card** (Soft ink card, radius 14, padding 18 20): caption "ROAD TO THE QUARTER-FINAL" mono caps + right hint "Click a round to highlight it on every chart · click a match for its stats" 11.5px label. Timeline layout C: A row above a round line, B row below, always R1 → F, 7 equal columns (`repeat(7, minmax(0,1fr))` gap 10). Player row label: name 14px/700 + "4–0 · sets 8–2" mono 11px label.
  - Played round box: inner box `#0C0E16`, radius 10, padding 12 12 10, border 1px 0.05, equal heights, footer pinned: opponent 13px/700 (link), style 11.5px secondary clamped to 2 lines, score mono 12px primary, then hairline and footer row: own price v opp price (mono 11px, own 700 primary, opp label) + "DR 1.68" mono 10.5px label. Hover outline 22% blue; **click → sheet** (`_pgSheet`). Tooltip "R1 · beat M. Kecmanovic 3-6 6-3 7-5 · click for match stats".
  - This match: Raised ink `#131623` box, 16% outline: "vs C. Alcaraz", style, "THIS MATCH" mono caps blue in the score slot, "1.54 v 2.62" + "not played".
  - Later rounds: placeholder boxes, content blurred (`filter: blur(3px)`, opacity 0.35), round label inside.
  - Bye: box reads "Bye" centred.
  - Round line between the rows: 1px 0.08 with round chips (mono 10px, inner box) at each column; clicked chip (`maPgHi`) → Raised ink + 16% outline, that round's boxes keep full opacity and the others fade to 0.35, and every metric table highlights that column (screen 01b).
- **Metrics** section: caption "METRICS · ROUND BY ROUND" + right hint "Highlighted cell = better of the two that round · click a cell for match stats". Filter row: "METRICS" mono caps + chips (Dominance ratio, Serve rating, Return rating, 1st serve %, 1st serve points won, 2nd serve points won, Winners / unforced errors, Winners, Pressure points) — chip on-state Soft ink + 16% outline, off-state transparent + 0.08 border label text; "All metrics" reset link appears when filtered (`maPgMet`, `metReset`).
- Metric tables: 3 per row (`repeat(3, minmax(0,1fr))` gap 12), order Dominance · Serve rating · Return rating / 1st serve % · 1st serve pts won · 2nd serve pts won / W/UE · Winners · Pressure points. Card: title mono caps; header row mono 9px label R1 R2 R3 R4 AVG; two player rows (size B: 84px name column, 28px cells): name 12px/600 truncated with a 2px player bar on the left (A primary, B `#9aa3b5`), cells mono 12px; **better cell per round** = 700 on inner box `#0C0E16` radius 5; AVG 700 with "(n)" when fewer rounds; DRAW avg row italic mono 10px label under a hairline. Cells click → sheet.
- Palette Uniform (players `#e7e9ee` / `#9aa3b5`). No legend, no Read box.

### 5.8 Overview (`overviewFor`) — screens `02-overview.png`, `P5-overview-season-surface-popup.png`, `P5b-overview-year-total-popup.png`
- Two player columns (`repeat(2, minmax(0,1fr))` gap 22). Per player a **Soft ink career card** (`#10121B`, 9% hairline, radius 16, padding 20 22): name 15px/700 + "CAREER RECORD" mono caps + hairline; career W–L 31px/800 mono + "53%" 14px/700 + "CAREER WIN" mono caps; tier seg **All | ATP | Challenger & ITF** on its own row (one shared `maOvTier`); surface bars: label 13px (Clay / Hard / Grass, neutral), bar 6px track 0.08 fill blue, "146-126 · 54%" mono 12px label; footnote "Bar length = win rate on that surface" 10.5px.
- "THIS SEASON · BY SURFACE" mono caps; rows Hard / Clay / Grass / Indoor: surface 13px, W–L mono 13px/700, rate, avg price; **rows are clickable** → pop-up.
- Yearly table: header YEAR · CLAY · HARD · GRASS · TOTAL mono caps; one row per year 2016 → 2026 (year mono 12px, cells "10-11" mono 12.5px, Total 700); **every cell and Total is clickable** → pop-up; hover cell bg 0.04.
- **Pop-up** (§4.4, `#0E1019`, 8% hairline, max 900px, `maOvCell = "playerIdx|year|surface"`): title "J. Sinner · Hard · 2026" 17px/700, sub "ATP · closing odds · sample data" mono caps; 4 stat boxes Record / Win rate / Avg price / At 1u flat (inner box, radius 10, padding 12 14, value mono 20px/700, signed colour on 1u); every match newest first in Tournament-tab rows: Date · W/L · Opponent · Event (+ surface on Total) · Rd · Sets · Set scores · Price · Opp; rows → sheet (`_ovSheet`).

### 5.9 Tournament (`tournamentFor`) — screens `09-tournament.png`, `09b-tournament-earlier-editions.png`, `09c-tournament-court-speed-panel.png`
- Header card: 56px tournament tile (initial letter, `#0f3a8a`-ish blue, radius 12), name 24px/800 + "Washington, US" 13px label; surface as plain text right 15px/700 in surface colour → **neutral text under the theme** (no pill); meta grid 4 cells (CATEGORY · COURT SPEED · ALTITUDE · ROUND: caption mono caps + value 15px/700) on inner box with 1px dividers; reading paragraph 13.5px/1.6 secondary.
- "Show court speed & market" drop-down button centred (seg-style, chevron; `maRoi`): opens the **Database · Tournament view embedded** as an overlay panel (`Database.dc.html`, `embedded`, `hide-header`, `initial-tab="Tournaments"`, `initial-tournament=tourn`): title "Washington · favourites and underdogs", mono "flat 1u · yields by price band", Close button; Favourites / Underdogs band tables + cumulative-profit chart. That page is separately locked (`Database LOCKED`); reuse the built Database component.
- "RECORD AT WASHINGTON" mono caps + hint "Career main-draw record at this event, newest edition first. Click a match for its stats."
- Per player card: name 15px/700 (link) + "21 matches · 7 editions" mono right; **five stat tiles** (`repeat(5, minmax(0,1fr))` gap 12) on `#0E1019` with 1.25px 6% hairline, radius 12, padding 14: caption mono caps 9px, value mono 23px/700, sub 11px label — W–L RECORD ("17–4", "81% · main draw"), BEST RESULT (short form Won / F / SF / QF / R2 / R1, year under), SETS WON ("69%", "35 of 51 sets"), LAST PLAYED ("2025", "7 editions listed"), BACKING ("+5.9u" signed colour, "+22.8pt vs market" one line). Then Tournament-tab rows grouped per edition ("Washington 2025 · Won · 5–0"; withdrawals as "Washington 2024 · Withdrawal" header only); "Show 4 earlier editions" link (`maTourMore`).

### 5.10 Weather (`weatherFor`, `wxFor`) — screens `10-weather-state-c.png`, `10b-…-a-calm.png`, `10c-…-d-indoor.png`, `10d-…-e-unavailable.png`
**Full spec: `specs/Weather Tab - Paperclip.md`** (exact and current). Summary: STATE switcher + "THRESHOLDS TBD — MICHAEL" chip (review; the chip stays until cut-offs exist); week strip (7 day cards, severity top edge, MATCH · 18:00 badge, days 4+ dimmed with LOW CONFIDENCE, "Forecast updated 2h ago · [source]"); legend; "AT MATCH TIME" verdict line; lead tile (worst factor, `#131623`, severity outline, big value, two metric boxes, EFFECT ON PLAY) + compact tiles (Heat / Rain / Conditions-pace with FROM TOURNAMENT tag and AS USUAL / PLAYS QUICKER / PLAYS SLOWER); all-neutral → four equal tiles; indoor → single panel; unavailable → dashes + banner. Severity scale neutral → amber `#E8A84E` → red `#E0616F` is the **only** place amber is used.

### 5.11 Odds (`oddsFor`) — screens `11-odds.png`, `11b-odds-novig-market-selected.png`, `P2-odds-movement-popup.png`
**Full spec: `specs/Odds Tab - Spec.md`.** Summary: filter row (seg **Market | No-vig**, `maOddsNovig`; SAMPLE DATA); market tiles K5 (Match Winner, 1st set winner, Game handicap, Total games, Set betting, Set handicap, Tiebreak in match — family label above name; selected washed blue; `maMarket`, selection-only, data stays Match Winner); "Per-book movement" card (BOOKS tag + title + STEAM chip, sub "…Click a book for its odds movement"); table T3: floating `#0E1019` row strips, SHARP / SOFT headings with trailing hairline; header J1 on B2 strip (1.25px 6% hairline): player names centred over their open→now cell with a grey rule, OPEN / NOW labels, NET centred; cells open (grey) · L3 soft-area sparkline in player colour · now (bold, best price green). Clicking a strip → **odds movement pop-up** (`maMvBook`; `#131623`, max 1080px): book name + class + margin, ✕; one panel per player (name, now + % change, smooth area chart with round-step odds axis and HH:MM time axis, date only on day change; Opening / Highest / Lowest boxes with value + "24 Sep, 19:04"); book tabs at the bottom switch the book.

### 5.12 Market edge (`meFor`) — screens `12-market-edge-match-winner.png`, `12b-…-derived-lines.png`, `P3-…-band-popup.png`, `P4-…-line-popup-today-band.png`
**Full spec: `specs/Market Edge Tab - Paperclip.md`.** Summary: seg **Match winner | Derived lines** (`meView`); SAMPLE DATA. Match winner → **Price sensitivity** card (header seg **Last 52 weeks | Career**, `meScope`; per player AS FAVOURITE / AS UNDERDOG bands; row = price label + TODAY tag, wins/losses split bar + W–L, Won, Needs, 1u stake signed; today's band outlined; click → **band pop-up** `#0E1019`: "J. Sinner · priced 1.41–1.64" + TODAY'S BAND, 5 stat boxes Record / Won / Needs / Yield / At 1u flat, every match newest first, rows → sheet) → **Profit at 1u flat** chart (Database chart type; A `#e7e9ee` solid, B grey; break-even rule + BREAK EVEN chip; end dots; legend with "412 priced −1.4u"). Derived lines → per player table Line · All · In band · Diff ("63/94 · 67%"), in-band cell washed only on the two most covered lines; click → **line pop-up** with seg **All matches | In today's band** (`meLineScope`), Covered / Rate / Not covered boxes, rows with text-only "Covered" (green 700) / "Not covered" (grey). Palette: white/grey players, green/red only for +/−, blue for TODAY + links. No Today's price box, no Yield by role, no Live trading tab.

## 6 · Interactions & motion
- Tab switch: instant; the content column resets scroll to top. Remember the last tab per session (shell `S.maTab`).
- Pop-ups and sheets: overlay fade 120ms; box `sigIn` (opacity 0 → 1, translateY −6 → 0, 200ms cubic-bezier(.2,.7,.3,1)). Esc and outside click close; ✕ closes. One pop-up at a time; the sheet may open **on top of** a pop-up (Overview / Market edge rows) — z-order: pop-up 50, sheet 60.
- Hovers: rows 0.015 wash; cards/boxes 22% blue outline (120ms); `.oddlink` 18% wash; `.pcard` lift −2px + 45% outline; nav 0.04 wash. Tooltips (`.elotip-pop`): 120ms opacity, raised surface, 8% hairline, mono 11px.
- Hot-line hover dims non-covered dots/rows to 0.32 (120ms).
- Links (player names): colour link, no underline; hover lighter; navigate to the player profile via `onOpenPlayer`.
- Segmented controls: 140ms bg/color/border transitions.
- Sticky column headers in every match list (top:0 inside the scroll container, card bg, hairline below).
- Keyboard: focus-visible outline 2px `rgba(91,155,255,0.35)` offset 2 on cards (`.mcard`).

## 7 · State
Root: `maTab`. Per tab (all optional, default in brackets):
- Form: `maFormSurf` (all) · `maFormRole` (all) · `maFormWin` (n) · `maFormN` (10) · `maFormDays` (30) · `maFormCard` (false) · `maFormHot` (false) · `maFormHotGroup` (all) · `maFormHotAll0/1` (false) · `maFormMore0/1` (false) · `maFormSheet` (null → sheet mid) · `maFormScope` (match) · `maFormPbpSet` (s1).
- H2H: `h2Surf` (all) · `h2AllLines` (false) · `h2State` (review).
- Match Stats: `maMsScope` (key) · `maMsPbpSet` (s1).
- Progression: `maPgFc` (review; production = match round) · `maPgHi` (null) · `maPgMet` (null = all; object of metric keys) · `maPgBox`.
- Overview: `maOvTier` (all) · `maOvCell` (null → "idx|year|surface").
- Tournament: `maTourMore` (false) · `maRoi` (false).
- Weather: `maWxState` (review). Odds: `maOddsNovig` (false) · `maMarket` (Match Winner) · `maMvBook` (null). Market edge: `meView` (lines in file; ship **winner** first) · `meScope` (career) · `meBand` (null) · `meLine` (null) · `meLineScope` (all).
- Playing style: `psMeetA/psMeetB` (false) · `psProf` (false) · `psDnaWin` (w52). News: `maNewsFilter` (all) · `maNewsOpen` (null).
Ignore every `*Var`, `*V`, `*Pal`, `*Lay`, `*Lv`, `*Pv`, `*Cv`, `*Nv`, `*Tv`, `*Gv`, `*Fv`, `*Bg` key — those are design-review switchers fixed by constants in the file (`KV='o'`, `PK='cur'`, `TV='b'`, etc.). Build only the branch those constants select.

## 8 · Data contracts (what each tab needs)
- Match: as in §2 shell contract; `completed` = `a.score != null`; set scores split on spaces; `setsWon` derived.
- Form: per player last-N matches `{mid, date, tourn, surface, round, opp, oppElo, won, setArr[[a,b,(tb)]], price, oppPrice, isFav, ret}`; fatigue `{load, m7, m14}`; Elo change.
- H2H: meetings `{mid, date, tourn, year, surface, round, winnerSide, setArr, homePrice, awayPrice, bo, ret}`.
- Match stats sheet: per match `{meta, setArr, stats by scope (match, s1…sN): points, serve, return, winners, UE, DR, serve/return ratings, pressure}`, point-by-point per set (games + tiebreak points).
- Progression: draw for both players `{round, opp, oppStyle, setArr, ownPrice, oppPrice, DR, metrics{9 keys}}`, draw averages per metric per round.
- Overview: career W–L per tier/surface, season by surface, yearly W–L by surface, match lists per (year, surface).
- Tournament: tournament meta (category, court speed index + label, altitude), per player editions with matches, best result, sets, backing units vs market.
- Weather / Odds / Market edge: see the specs in `specs/`.
- Playing style: archetype + secondary tag per player, matchup matrix rate, personal record vs style with match list, five ratings (52w + career) and percentile deltas.

## 9 · Sample data
Demo match: ATP Washington · QF · Hard · Jul 20, 2026 18:00 · J. Sinner 1.54 (won 6-4 4-6 7-6) v C. Alcaraz 2.62. Every figure is generated in the logic class (seeded pseudo-random, `mkPr`) or hard-coded sample tables; "SAMPLE DATA" chips mark it. Alcaraz's playing-style meetings are "Sample opponent" rows. News headlines start with "Sample:". None of these numbers are real.

## 10 · Files
- `Match Analysis Progression v1.dc.html` — the design (template + `class Component` with `mkAnalysis`, `formFor`, `h2hV2For`, `matchStatsFor`, `mkSheet`, `progressionFor`, `overviewFor`, `tournamentFor`, `weatherFor`, `oddsFor`, `meFor`, `ps2For`, `newsFor`, `keyFactorsFor`).
- `Match Detail.dc.html` — legacy inline match detail (only used by the hidden Key-factor variants; not needed for `v.o`).
- `Database.dc.html` — embedded by the Tournament tab's "Show court speed & market" panel (already locked and handed off separately).
- `support.js` — runtime to open the .dc.html files locally.
- `STENNISFY-DESIGN-INSTRUCTIONS.md` — standing design rules.
- `specs/` — full written specs for Weather, Odds, Market edge.
- `screens/` — reference captures (see §1).

## 11 · Note for Paperclip
Weather, Odds and Market edge were already handed off (specs in `specs/`); use this pass to re-verify them against the live file — the only intended changes since are the theme mapping in §3 (they are otherwise unchanged and locked). Everything else here (Key factors original, News, Playing style, Form, H2H, Match Stats, Progression, Overview, Tournament, the shared sheet and pop-ups) is new to code. Where a value in this README and the file disagree, the file wins; where the file's hex and §3 disagree, §3 wins (theme tokens). Questions → Michael.
