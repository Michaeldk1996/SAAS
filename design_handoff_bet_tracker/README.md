# Handoff: Bet Tracker page (Stennisfy · night theme)

> **Prompt for Claude Code — read this first**
>
> Rebuild the Bet Tracker page **pixel-perfect** in the Stennisfy codebase (night theme only). The file `Bet Tracker Page.dc.html` in this folder is the **single source of truth**: every element in it is inline-styled, so every colour, size, radius, gap, font and weight you need is literally in the markup, and every number on screen is computed in the `class Component` block at the bottom of the same file. When this README and the HTML disagree, **the HTML wins**. Open the HTML in a browser (it needs `support.js` beside it, included) and compare your build side by side at **1340 px** column width — that is the review width.
>
> Do NOT ship the HTML. Recreate it with the project's own stack (React components, the existing design tokens / Tailwind config / CSS modules — whatever the repo already uses), wire it to the real bets API, and keep the exact look. Everything below is the map; the HTML is the territory.

---

## 1. Overview

A member's bankroll page, read like a coach reads it: every bet you logged, settled and locked, with the season told four ways — the **profit curve**, a **ledger**, a **calendar**, and three analysis views (**Where it works · where it leaks**, **Discipline**, **Staking strategy**). Picks on the site are Stennisfy's; this page tracks the member's own money, in **% of bankroll everywhere** (the only € figures are the calendar day cells, shown on a 10,000 € bankroll).

Sidebar placement: group **Betting** → **Picks** · **Bet Tracker** (short label "Tracker"). The page is embedded in the site shell with `overflow:auto`, background `#05060A`, no recolouring — **night only** (no light version).

## 2. About the design files

The files in this bundle are **design references written in HTML** — a working prototype of the intended look and behaviour, not production code. The task is to recreate them in the target codebase's environment using its established patterns and libraries. The logic class in the HTML is readable plain JavaScript; port the **formulas** (they are the spec for every figure on the page), not the rendering.

## 3. Fidelity

**High-fidelity.** Final colours, type, spacing, copy and interactions. Match 1:1.

## 4. Files

- `Bet Tracker Page.dc.html` — **the page** (template on top, `class Component` logic below; the template uses `{{ holes }}` filled by `renderVals()`; `<sc-for>` = loop, `<sc-if>` = conditional; `style-hover` = `:hover` styles).
- `support.js` — runtime needed only to open the prototype in a browser.
- `Calendar Options.dc.html` — the five calendar candidates (1e "Month cards" was chosen and is what the page now carries; keep for context only).
- `Bet Tracker.dc.html` — comparison canvas (1a = the same page inside a card; turn 2 = the Bet-analytix reference screenshots rebuilt). Reference only.

## 5. Design tokens (night)

**Fonts** (Google Fonts): `Hanken Grotesk` 400/500/600/700/800 = every UI text; `IBM Plex Mono` 400–800 = every number (prices, %, counts, dates in menus). Nothing else. `-webkit-font-smoothing:antialiased`.

**Surfaces**
- Page `#05060A`
- Card `#0E1019` + `border:1px solid rgba(255,255,255,0.05)` + `box-shadow:inset 0 1px 0 rgba(143,170,255,0.03)` + radius `12px`
- Inner tile / table head band / footers `#0A0D14` (+ `1px rgba(255,255,255,0.05–0.06)` ring, radius 8–10)
- Menu / pop-up sheet `#0C0E16` + `1px rgba(255,255,255,0.10)` + radius 10 + `0 12px 28–32px rgba(0,0,0,0.45)`
- Modal sheet `#0C0E16` + `1.25px rgba(255,255,255,0.06)` + radius 14; backdrop `rgba(3,5,9,0.72)`
- Selected pill / row `#131623` + `1px rgba(255,255,255,0.16)`; selected segment in a segmented control `#1B2031`
- Hairline `rgba(255,255,255,0.05)` (tables `0.05`, stronger `0.06–0.08`); row hover `rgba(255,255,255,0.03)`

**Ink**
- White `#FFFFFF` (titles, names, big figures) · body `#E7E9EE` · muted / labels `#A3AABE` · pill off-state text `#c6ccdb` · zero-count `rgba(198,204,219,0.4)` · header sub `#DDE0EA`
- Links / actions `#5B9BFF` (menus, "Reset filters", "Full record →", "+ Add a leg"), header-style links `#6A9AF8` (Restore, Export CSV, certified badge text)

**Signals**
- Positive `#5CCB84` · negative `#E06266` · amber (early / warning) `#E8A84E` · pending blue `#6A9AF8` / `rgba(106,154,248,0.35)` · primary `#007AFF` (buttons, curve, seal) · button hover `#3A60E8`
- Chips: WON `rgba(92,203,132,0.14)` fill + `rgba(92,203,132,0.40)` ring + `#5CCB84` text; LOST same with `224,98,102`; VOID `rgba(255,255,255,0.05)` / `0.18` / `#A3AABE`.

**Type scale** (size / weight): page title 24/800 `-0.015em`; section title 16/800; card title 15/800; hero figure 48/800 mono `-0.02em` line-height 1; verdict figure 34/800 mono; month-card figure 24/800 mono; tile figure 18/800 mono; body 13; meta 12.5 / 12 / 11.5 / 11 `#A3AABE`; caps labels **10.5px / 700 / 0.10em / uppercase / `#A3AABE`** (table heads 10px); chips 10px/700/0.08em mono.

**Radii**: cards 12 · tiles/inputs 8 · menus 10 · pills 9 (30 px high) / 7 (chips) · modal 14 · bars 2 · day cells 7 · mini calendar cells 4.

**Controls**: pill trigger = 30 px high, padding 0 12, radius 9, font 12.5; off = `#0A0D14` + 6 % ring + `#c6ccdb` 600; on = `#131623` + 16 % ring + `#E7E9EE` 700. Segmented control = `#0C0E16` + 10 % ring, radius 9, padding 2, 30 px; selected segment `#1B2031` white 700. Primary button = 36 px, `#007AFF`, radius 10, 13/700 white. Inputs = 36 px, `#0A0D14`, `1px rgba(255,255,255,0.10)`, radius 8, 13 px, `color-scheme:dark` on date inputs.

**Certified seal** (everywhere): `#007AFF` square `clip-path:polygon(…)` 12-point scallop (the exact polygon is in the HTML), white tick SVG `stroke-width:3.2`, 7 px; 12 px in the header badge, 13 px on locked ledger rows.

## 6. Page layout

- Column: `width:100%; max-width:1340px; min-width:960px`, centred, page padding `32px 40px 60px`, vertical gap between blocks `28px`; inside a block title→content gap `12px`.
- Order (top → bottom): **Hero canvas** → **Log a bet** panel (when open) → view switch content: **Results** (Ledger → Calendar) · **Insights** (Where it works → Discipline) · **Staking** (Staking strategy). Month pop-up and band pop-up are fixed modals.

## 7. Blocks, exactly

### 7.1 Hero canvas (one card, padding 22 26 18, gap 16)
1. **Header row** — "Bet Tracker" 24/800 + **Certified badge** (24 px pill, `rgba(0,122,255,0.12)` fill, `rgba(0,122,255,0.35)` ring, 11.5/700 `#6A9AF8`, seal 12 px, copy "Certified · N of M results locked"; tooltip on title: "Every locked result is frozen — it cannot be edited or deleted. The blue seal on a ledger row marks a locked result."). Second line 13 px `#DDE0EA`: **bankroll name** 700 white · headMeta. Right: **"+ Log a bet"** primary button (toggles to "Close" when the panel is open).
2. **Bankrolls strip** — caps "Bankrolls" + sub "One ledger each · pick one and the whole page follows · figures over the bankroll's whole life". Cards 300 px wide, `#0A0D14`, radius 12, padding 14 16 12: name 14/700 · meta 11 grey · **Archive** ghost chip (10.5/700/0.06em, 10 % ring, radius 6); two tiles (`#0E1019`, radius 8, padding 8 10) **ROI** and **Profit %**, 18/800 mono sign-coloured. Selected bankroll = 16 % ring (`bk.bd`). Dashed **"+ Add bankroll"** 200 px card (`1px dashed rgba(255,255,255,0.18)`). **Archived** row under the strip: 26 px chips name + mono meta + **Restore** (`#6A9AF8`) / **Delete** (`#E06266`, only possible once archived).
3. **Headline row** (hairline above, padding-top 18) — left: caps "Profit · % of bankroll", figure **48/800 mono** sign-coloured + 14 px sentence `#E7E9EE`. Right, one 30 px row: curve meta 11.5 grey · **All time** pill · **Period** trigger (`Last 30 days · Last 90 days · Season · Custom range` — menu 220 px, rows 6×9 radius 7, ✓ 12 px; Custom shows two date inputs inside the menu) · **Filters** trigger with sliders icon, label reads "Filters" / "Filters · ATP 250 · Hard" / "+N" — menu 560 px, two columns, groups **Level · Odds band · Surface · Market**, every row = label · cross-adjusted mono count · ✓, footer "N of M bets" + **Reset filters**; · **view switch** segmented `Results | Insights {bad of judged} | Staking`.
4. **Curve** — box 262 px high; SVG `viewBox 0 0 1292 240`, `preserveAspectRatio:none`, width 100 %; y gridlines from x 44 → 1288 (dashed except zero); area fill gradient `#007AFF` 0.22 → 0; line `#007AFF` 2.2; **deepest drawdown** = 3.5 r circle `#0E1019` fill + `#E06266` 2 px ring; last point 4 r white. Y tick labels 36 px wide right-aligned mono 10 at left; x month labels at `top:246px` 10.5 px, positions in %. Hover: 1 px vertical `rgba(255,255,255,0.22)`, 10 px blue dot with 2 px white ring, tooltip 236 px (`#0A0D14`, 10 % ring, radius 10) = date · "#idx" · cumulative 20/800 mono + "bankroll" · if a bet: 8 px result square + bet text 12.5/700 · meta · stake · signed P/L. Under the curve: "○ red = deepest drawdown" · ddNote, 11 px grey.
5. **Stat tiles** — 7 across (`repeat(7,minmax(0,1fr))`, gap 8, hairline above, padding-top 14), tile `#0A0D14` radius 9 padding 10 14: caps label · 18/800 mono value + 11/600 grey "when" · 11 px sub. Tiles: **ROI · Record · Win rate · Avg CLV · Max drawdown · Best run · Worst run**.

### 7.2 Log a bet (card, grid `minmax(0,1fr) 300px`, right column = Ticket on `#0A0D14`)
Left (padding 18 20 20, gap 16): title "Log a bet" + bankroll name, ✕ 28 px. **Selection**: Type segmented `Single · Combination · Parlay` + Placed `Pre-match · Live · in play` (both `#0A0D14` + 6 % ring, radius 9, padding 3; chips 6×12 radius 7, 12/700). Legs: grid `minmax(0,1fr) 120px 24px`, text input + **Odds** mono 700 input + remove ×; "+ Add a leg" (Parlay) + `legsNote`. Rules: Single = 1 leg · Combination = exactly 2 · Parlay = 2+; combined odds multiply and show read-only. **Details** (hairline above): `Tournament | Level (Grand Slam · Masters 1000 · ATP 500 · ATP 250 · Davis Cup · Challenger) | Surface (Hard · Indoor hard · Clay · Grass)` grid `1fr 140px 140px`; `Market` (11 tennis markets + "Other — type it") | `Bookmaker` (22 books + "Other — type it"); "Other" reveals a typed field. **Stake** row grid `150px 140px 1fr`: "Stake · % of bankroll" mono input · read-only odds box (label "Odds" or "Combined odds") · validation hint (11.5, grey; "Ready — the ticket on the right is what gets posted." when valid). Validation: every leg text + odds ≥ 1.01, stake 0.1–10, market + book set.
Right **Ticket** (padding 18 20 20, gap 14): caps "Ticket" · mono "PENDING" `#5B9BFF`; selection 16/800 (placeholder "Your selection" `#5E667C`) + context line; key/value rows 9 px padded on 6 % hairlines (Type · Market · Book · Odds · Stake, mono 12/700 values); two tiles **Wins** / **Loses** 16/800 mono (+x% green / −y% red); **Post bet** 38 px button (dim until valid) + "Posts as pending · settle in the ledger, then lock". Posting prepends a pending bet into the current bankroll.

### 7.3 Ledger (Results view)
Head: "Ledger" 16/800 + meta; right segmented filter `All · Pending · Won · Lost` (card tone, 7 % ring, radius 10, padding 3; selected `#1B2031`). **Month chips** row (scrollable): min-width 92, padding 8 12, radius 9: label 12.5/700 + mono count · mono 12/800 P/L; "All" first; selected `#131623` + 16 % ring.
Table card: grid **`84px minmax(0,1.6fr) minmax(0,1fr) 64px 48px 48px 56px 50px 150px 64px`**, gap 0 12, padding 0 16; head 28 px on `#0A0D14` (Date · Bet · Market · Book · Odds · Close · CLV · Stake · Result · P/L); rows **50 px**: date 12.5/600 + weekday 10.5 · bet text 13.5/700 + meta 11.5 (`tour · level · surface [· type · legs]`) · market 12 · book 12 grey · odds **14/800 mono white** · close 12.5 mono · CLV 12/700 sign-coloured · stake 12.5/700 · Result lane: **pending** = three 24 px outline buttons WON / LOST / VOID (mono 10/700/0.08em, sign-coloured rings at 45 %); **settled this session** = "undo" 11 grey + **Lock** 22 px outline (`rgba(0,122,255,0.5)`, `#6A9AF8`) + result chip; **locked** = chip + 13 px seal (frozen for good); pending rows tinted `rgba(106,154,248,0.05)`. Footer: ledgerFoot + "Export CSV →". Shows 14 rows.

### 7.4 Calendar (Results view) — "Month cards" (chosen 2026-10-29)
Title "Calendar" + sub "One tile a month, one cell a day · click a month for its record · hover a day for the bets we took · day figures in € on a 10,000 € bankroll."
Card (padding 18 22 18, gap 14): head line = `calendar.meta` ("N betting days this season · x finished up · y down or flat") left, "Season · N bets · W–L" + mono 14/800 season P/L right (nowrap).
**Month tiles** grid `repeat(3,minmax(0,1fr))` gap 12 — one per month that has bets, ascending. Tile `#0A0D14` + 6 % ring, radius 10, padding 14 16, `display:flex; gap:18px`, hover ring 14 %; **selected** = `#131623` + 16 % ring. Left: mini calendar `repeat(7,24px)` gap 4 — weekday letters `M T W T F S S` 9.5/700 grey 80 %, then 6 rows of **20 px cells radius 4**: outside month transparent · future transparent · past no-bet `rgba(255,255,255,0.04)` · pending-only `rgba(106,154,248,0.35)` · settled day tinted by P/L with **three alpha steps** (|P/L| < 1.2 % → 0.30, < 2.8 % → 0.55, else 0.90; green `92,203,132`, red `224,98,102`, zero `rgba(255,255,255,0.14)`), today = `0 0 0 1px rgba(255,255,255,0.4)` ring; title tooltip "Fri 2 Oct · +2.7% = +270 €". Right: month name 13.5/700 · **P/L 24/800 mono** sign-coloured (margin-top 6) · sub 11.5 grey "41 bets · 23–18 · 18 betting days" · foot on a hairline: caps "ROI" + mono 12.5/700 ROI + ▾/▴.
**Open-month panel** (click a tile; current month open by default; click again or Close collapses): `#0A0D14` + 6 % ring radius 10 (no overflow clipping — pop-ups escape). Head 12×18: month 14/800 + sub "N settled bets · W–L[–V void] · d betting days" · right **"Full record →"** (`#5B9BFF`, opens the month pop-up 7.5) · **Close** grey. Body grid `minmax(0,1fr) 300px`:
- Planner (padding 14 18 16): head row `repeat(7,minmax(0,1fr)) 96px` caps Mon…Sun + "Week" on a 6 % hairline; week rows gap 4; **day box 58 px radius 7 padding 7 10**: date 11/600 (in-month with bets `#E7E9EE`, in-month without `rgba(163,170,190,0.7)`, outside `0.3`), bottom row = short "W–L" (or "2 pend.") 10 px grey left + **€ figure mono 13/700** sign-coloured right; fill 9 % green/red for settled days, `rgba(106,154,248,0.10)` pending-only, `rgba(255,255,255,0.02)` in-month empty; today = inset 1 px 45 % white ring. **Week cell** `#0E1019` + 5 % ring: "n bets" 10 grey + week net € mono 14/800.
- **Hover a betting day** → pop-up 380 px (`#0C0E16`, 10 % ring, radius 10, shadow, padding 10 12, `pointer-events:none`) anchored below the cell (above it for the last two rows; left-aligned for Mon–Thu, right-aligned Fri–Sun): title "Thu 29 Oct" 12.5/700 · sub "2 settled · 1 pending · 2–0" 11 grey; one row per bet grid `1fr 54px 56px`: bet text 12/600 + meta 10.5 grey ("Vienna · Match winner · @ 1.70 · 2%") · WON/LOST/VOID/PENDING 9.5/700/0.08em coloured · signed P/L % mono 12/800.
- Stats column (padding 14 16 16, 2-col grid gap 8): tiles `#0E1019` radius 8 padding 10 12 — caps label · 16/800 mono value · 10.5 sub (min-height 13): **P/L · ROI · Win rate · Avg CLV · Best day (€, "Thu 17 Sep") · Worst day (€) · Best week (€, "n bets") · Up days ("12 of 18")**.

### 7.5 Month pop-up (fixed modal, max-width 960)
Title "October 2026" 17/800 + mono sub "N settled bets · W–L · x% staked"; 4 stat tiles (P/L · ROI · Win rate · Avg CLV); ledger of that month's settled bets (date · result square · text + meta · market · odds · close · CLV · stake · result · P/L); foot "Settled bets only · P/L and stake in % of bankroll · CLV = your price ÷ closing price − 1 · click outside to close". Exact grids in the HTML (`monthPop`).

### 7.6 Where it works · where it leaks (Insights view)
Title + `bdMeta`. **Three verdict cards** `repeat(3,1fr)` gap 12 (card tone, padding 16 18 14, `overflow:hidden`): caps kind coloured (**Your edge** green = top strength · **Your leak** red = top leak · **Blind spot** amber = worst-P/L segment with 5 ≤ n < floor) + segment name right; **P/L 34/800 mono**; sentence 15/700 white; foot row on a hairline = Record · ROI · CLV (caps 10 label + mono 13/700), or for pair cards two legend rows; the segment's own cumulative curve drawn faint (`opacity:0.35`, 84 px tall) behind the foot; 48 px spacer.
**Breakdown table** card: head 12×18 "Breakdown" 14/800 · "by" · **cut trigger** (pill, menu 220 px of the 8 cuts with mono segment counts + ✓: Market · Odds band · Surface · Level · Tournament · Bookmaker is NOT a cut · Timing · Weekday · Situation) · right "N bets · W–L · ROI x · P/L y". Column head 30 px on a hairline: `4px minmax(0,1.2fr) 60px 80px minmax(200px,1fr) 80px 70px 80px` gap 12 padding 18 — (mark) · cut name · Bets · W–L · "ROI · −40 ‥ +40" · ROI · CLV · P/L. Rows **46 px**: 4×22 ROI-colour mark radius 2 · name 13.5/700 (+ › when expandable → band pop-up) · mono counts · centred signed bar (8 px track 5 % white, centre tick 18 %, fill ±40 % full scale) · ROI 13/800 · CLV 12/600 · P/L 13/800. Total row 40 px on `#0A0D14` "All · surface". `bdFoot` note 11.5 under. Orders: odds bands in price order 1.10–1.35 … 3.21 and up; weekdays Mon→Sun; others by P/L. Levels order Grand Slam · Masters 1000 · ATP 500 · ATP 250 · Davis Cup · Challenger. Surfaces Hard · Indoor hard · Clay · Grass.
**Band pop-up** (max-width 1000): 6 stat tiles + lines table (`minmax(0,1.2fr) 60px 80px minmax(160px,1fr) 80px 70px 80px`).

### 7.7 Discipline (Insights view) — one strip
Title "Discipline" + "Skill shows in the closing line and the stakes long before it shows in the P/L." Card: head 12×18 caps "Discipline · {period}" · right `{bad} of {judged}` mono coloured + "checks need work · N bets". Three columns `repeat(3,1fr)` separated by 5 % hairlines, each grid `110px 1fr` gap 14, padding 14 18: **dial** = SVG `viewBox 0 0 200 110` at 110×61: track `M20 100 A80 80 0 0 1 180 100` 6 % white 10 px round caps · **target zone** 20 % white 10 px · value arc in the verdict colour 10 px; figure **19/800 mono** centred at the dial foot. Text: label 13/700 · verdict 11/700/0.08em coloured · `short` 11.5 grey (full `body` on hover via title). Dials:
1. **Closing line** — figure = % of priced bets that beat the close; verdict REAL EDGE ≥ 55 (green) · COIN FLIP ≥ 48 (amber) · PAYING TOO MUCH (red); zone 55→100 %.
2. **Stake after a loss** — figure "×ratio" = avg stake after a losing bet ÷ after a winning bet; STEADY 0.85–1.15 (green) · SHRINKING < 0.85 (amber) · CHASING > 1.15 (red); arc maps 0.5→2.0; zone 0.85–1.15.
3. **Stake consistency** — figure "×spread" = largest stake ÷ average stake; EVEN ≤ 1.5 (green) · UNEVEN ≤ 2 (amber) · WENT BIG > 2 (red); arc maps 1→3; zone 1→1.5; short "Largest 3.0% vs average 1.21% · 14 of 212 bets over 1.5× · target ≤ ×1.5".
`ok:null` = not judged (counts as "not judged yet" in the head).

### 7.8 Staking strategy (Staking view)
Title + "Same bets and results, only the stake changes · pick a plan and read it against your stakes." **Plan chips** (padding 4 10, radius 7, 12/600, 8 px colour swatch radius 2; selected `#1B2031` white + 16 % ring; off transparent grey + 6 % ring; `title` = how). Exactly one plan is compared with "Your stakes" (state `vsPlan`, default **Compounding 1%**). Plans, in order, with colour and stake rule per bet (stake in % of starting bankroll; `cum` = cumulative %; `prev` = previous bet):
- **Your stakes** `#007AFF` — as logged
- **Flat 1%** `#8FB8FF` — 1
- **Flat 2%** `#C9DDFF` — 2
- **Compounding 1%** `#E7E9EE` — `max(0, 1·(1+cum/100))`
- **To win 1%** `#5B9BFF` — `min(5, 1/(odds−1))`
- **¼ Kelly on CLV** `#A3AABE` — `clv ≤ 0 → 0`, else `min(3, 25·clv/(odds−1))` (hindsight)
- **½ Kelly on model** `#B48CFF` — p = 1/fair (Stennisfy fair price at posting), k = odds−1, `f = (p·k−(1−p))/k`, stake `f ≤ 0 → 0` else `min(3, 50·f)`; no fair price → 0
- **Odds-banded** `#7FD6C2` — odds < 1.60 → 1.5 · ≤ 2.20 → 1 · else 0.5
- **Confidence tiers** `#F0C27A` — logged stake ≤ 1 → 0.5 · ≤ 1.5 → 1 · else 1.5 (until Log-a-bet has a Confidence field)
- **Double after a loss** `#E06266` — 1; after a loss `min(8, prev·2)`; back to 1 on a win
Replay: `cum += won ? st·(odds−1) : lost ? −st : 0` over settled bets in date order; track peak / max drawdown.
Card: head 12×18 = "▬ Your stakes vs ▬ {plan} · {plan sub}" + right "N bets · cumulative % of the starting bankroll · shaded = the gap · plan ahead by up to x%, behind by up to y%". Chart box 250 px (padding 14 18 10), SVG `viewBox 0 0 1256 226`, y gridlines from x 36, your line `#007AFF` 2.2, plan line its colour 2, **fill between the lines** green 8 % if the plan ends higher else red 8 %; y labels mono 10 at left 18 px. **Delta strip** `repeat(4,1fr)` on a hairline: caps label · "you → plan" (mono 13 grey → 16/800 white) + signed diff mono 12/700 green/red: **End · Max drawdown · Worst month · Biggest single loss**. Then three text cells (Your stakes how · plan how + when · The difference) 12 px `#E7E9EE` 1.45, and a 11.5 grey note on a hairline.

## 8. Data model & formulas (port exactly)

Bet: `{id, date, tour, level ('Slam'|'1000'|'500'|'250'|'Cup'|'Chall'), surface, market, line?, book, odds, close?, fair?, stake (% of bankroll), res ('won'|'lost'|'void'|null), text, timing ('pre'|'live'), type ('Single'|'Combination'|'Parlay'), legs?, bank, pending, locked}`.
- `pl(b)` = won → `stake·(odds−1)` · lost → `−stake` · void → 0 (all in % of bankroll)
- `clv(b)` = `close ? odds/close − 1 : null` (CLV = your price ÷ closing price − 1); "beat the close" = clv > 0
- `stats(list)` over settled bets in order: n, profit Σpl, staked Σstake, **roi = profit/staked**, w/l/v, clv avg over priced bets, clvN, beat, max drawdown (peak − cum, index), best/worst run + their end dates, winRate = w/(w+l)
- Odds bands (inclusive upper): ≤1.35 · ≤1.60 · ≤1.90 · ≤2.20 · ≤2.60 · ≤3.20 · above → labels `1.10 – 1.35 … 3.21 and up`
- Period: Last 30 days · Last 90 days · Season (default, from 1 Jan) · All time · Custom (two dates). Filters cross-adjust their counts (each group's counts computed with the other groups applied). Every count carries its denominator; thin samples flagged as "EARLY · n=x" (the word "thin" is never used); `minSample` floor default 15 (prop, 5–40).
- Calendar € = `round(pl · 100)` on a 10,000 € bankroll; tint steps on |pl| in %.
- Certified: a locked result is immutable; header badge counts `locked of settled`.
- Never fabricate: a missing value renders as "—".

## 9. State
`period, range{from,to}, filters{level[],odds[],surface[],market[]}, menu ('period'|'filters'|'dim'|null), view ('results'|'insights'|'staking'), bank, banks[], archived{}, extra[] (posted bets), settled{id:res}, locked{id:true}, lf ('all'|'pending'|'won'|'lost'), ledgerMonth, openMonth (modal), calOpen (month index, default current month), calHov (day key), dim (breakdown cut), openBand, vsPlan, logOpen, form{…}`. Curve hover is local state. Menus close on outside click; modals on backdrop click; pop-ups are hover-only.

## 10. Interactions summary
Bankroll card click → whole page follows · Archive / Restore / Delete · "+ Log a bet" toggles panel · Post bet → pending row at the top of the ledger · WON / LOST / VOID → settled (undo available) → **Lock** → seal, frozen · Period / Filters / cut menus · view switch · curve hover tooltip · ledger month chips + result filter · month tile click → open panel; day hover → bets pop-up; "Full record →" → month modal · breakdown row › → band modal · plan chip → compare · tooltips via `title` on dials, plan chips, mini-calendar cells.

## 11. Assets
No images. Icons are inline SVG paths in the HTML (sliders icon in the Filters trigger, tick in the seal). Fonts from Google Fonts.

## 12. Open items (not design decisions — report, don't invent)
Export CSV behaviour; "Confidence" field on Log-a-bet (then Confidence tiers reads the real field); `fair` price source for ½ Kelly on model = the Stennisfy fair price stored at posting; Challenger / Davis Cup rows without closing prices stay "—".
