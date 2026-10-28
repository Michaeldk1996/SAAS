# Handoff: Bet Tracker (Stennisfy · member bankroll page)

**Status: LOCKED 2026-10-28.** Build exactly what is in `Bet Tracker Page.dc.html`. No visual change without Michael's explicit unlock.

## Overview
The Bet Tracker is the member's own bankroll ledger inside the Stennisfy site: log a bet, settle it, lock the result, and read the season back like a coach would — profit curve, ROI / CLV / drawdown tiles, where the edge is and where it leaks, discipline checks against the closing line, a staking-plan replay, a 26-week heat calendar and a certified ledger.

It sits in the site sidebar under a fourth group **Betting** → **Picks** (Stennisfy's picks for the member) · **Bet Tracker** (what the member does with them). Night theme only.

## About the design files
Every file in this bundle is a **design reference written in HTML** (a Design Component prototype). It is not production code to copy. Recreate the design in the Stennisfy codebase's existing environment (React + the site's token set), using its established component patterns. The HTML is the pixel truth; the README is the spec; the demo data generator shows the shapes and the maths.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii, grid tracks, copy and every formula are final. Match them 1:1.

---

## Files in this bundle
- `Bet Tracker Page.dc.html` — **the page** (standalone, fluid column 960–1340px). Template = lines 19–417, logic class = lines 419–760. Read the logic class for every formula; it is the reference implementation.
- `OFFICIAL VERSION 1.dc.html` — the site shell. Shows where the page mounts (nav group `Betting`, `pgTracker` branch), the sidebar nav styles, and the token set the rest of the site uses.
- `Picks.dc.html` — the sibling Picks page (already handed off separately in `design_handoff_picks/`); included so the Betting group can be built as one unit.
- `Certified Mark Options.dc.html` — the five seal treatments; **1b Rosette** is the chosen one.
- `Premium Pass Options.dc.html` + `Bet Tracker Page 1a–1e.dc.html` — the five colour passes; **1b Quiet ink** is the chosen one and *is* `Bet Tracker Page.dc.html`. The others are reference only.
- `Section Refinements.dc.html`, `Breakdown Box Options.dc.html`, `Hero Box Options.dc.html`, `Curve Filter Options.dc.html`, `Filters Box Options.dc.html` — option sheets that led to the locked choices (reference only).
- `assets/` — site fonts are Google Fonts (see Tokens); the only image is the site ring logo used by the shell.

---

## Where it lives in the shell
- Sidebar group order: Analyse · Research · Insights · **Betting** (Picks, Bet Tracker). Short label for the compact rail: "Tracker". Icon path (20×20 viewBox, stroke 1.6): `M3.5 5.5h13v9h-13zM3.5 9h13M6.5 12h3M13 5.5v9`.
- Host: `flex:1; min-width:0; height:<content height>; overflow:auto; background:#05060A`. The page is **not** recoloured by the light theme engine — night only.
- The page column: `width:100%; max-width:1340px; min-width:960px`, centred, section padding `32px 40px 60px`, background `#05060A`.

---

## Design tokens (Quiet ink pass — final)

**Fonts** (Google Fonts): `Hanken Grotesk` 400–800 for all UI text; `IBM Plex Mono` 400–800 for every figure, odds, %, counts, chips. Load both with `display=swap`.

**Surfaces**
- Page `#05060A`
- Card `#0E1019` + `box-shadow: inset 0 1px 0 rgba(143,170,255,0.03)` + `border: 1px solid rgba(255,255,255,0.05)` + radius 12
- Inner tile / table head band / inputs `#0A0D14` + `1px rgba(255,255,255,0.05)` (inputs use `0.10`), radius 8–9
- Menu pop / modal sheet `#0C0E16` + `1px rgba(255,255,255,0.10)` + radius 10 (modal 14, border 1.25px 6%) + `box-shadow: 0 12px 28px rgba(0,0,0,0.45)`
- Selected pill / segment `#131623` (menus, month chips, triggers) or `#1B2031` (Type/Placed/ledger filter/view segments, plan chips)
- Hairline `rgba(255,255,255,0.05)`; stronger hairline / selected edge `rgba(255,255,255,0.16)`; idle pill edge `rgba(255,255,255,0.06)`
- Row hover `rgba(255,255,255,0.03)`; pending ledger row `rgba(106,154,248,0.05)`

**Ink**
- Primary `#FFFFFF`; body / secondary figures `#E7E9EE`; labels + meta `#A3AABE`; pill idle text `#c6ccdb`; zero-count pill `rgba(198,204,219,0.4)`
- Links / blue text `#6A9AF8` (header seal badge, Lock button, Export CSV, Restore, + Add a leg); menu footer links `#5B9BFF`
- Positive `#5CCB84`; negative `#E06266`; warning / EARLY `#E8A84E`; neutral-zero `#E7E9EE`
- Ring blue `#007AFF` — curve, your-stakes line, Log-a-bet / Post / Apply buttons (hover `#3A60E8`), seal

**Type scale**
- Section title 16/800 white · section sub 12.5 `#A3AABE`
- Caps label 10.5/700, letter-spacing 0.10em, uppercase `#A3AABE` (table heads use 10px)
- Hero profit 48/800 mono, letter-spacing −0.02em, line-height 1
- Verdict P/L 34/800 mono · dial figure 19/800 mono · tile figure 18/800 mono · ledger odds + P/L 14/800 mono
- Body 12–13.5; chips 10/700 mono letter-spacing 0.08em

**Radii**: cards 12 · tiles 8–9 · menus 10 · menu rows 7 · chips 6 · heat cells 4 · buttons 8–10.

---

## Page anatomy (top → bottom)

### 1. Bankrolls strip
Caps head "Bankrolls" + sub "One ledger each · pick one and the whole page follows · figures over the bankroll's whole life". Horizontal scroll row: one card per live bankroll (300px, card tone, `padding 14 16 12`), selected card border `rgba(0,122,255,0.65)` else 5% white. Card: name 14/700 + meta "N settled" / "no bets yet" + **Archive** ghost button (10.5/700 caps 0.06em, 1px 10% ring); two inner tiles ROI · Profit % (figure 18/800 mono, sign-coloured). Trailing dashed "Add bankroll" card (200px, `1px dashed rgba(255,255,255,0.18)`, + in a 28px ring).
Archived row (only when any): caps "Archived" + pills (26px, inner tone) `name · meta · Restore (#6A9AF8) · Delete (#E06266)`. Delete only possible once archived. Demo bankrolls: "Tennis 2026" (main) and "Challenger lab" (all Challenger bets).

### 2. Header
Left: caps "Bet Tracker" → bankroll name 26/800 + **Certified badge** → meta line 13 `#A3AABE`:
`{settled} settled since {first date} · {pending} pending · stakes in % of bankroll · {period phrase} shown[ · N filters on, x of y bets]`.
Right: **+ Log a bet** button (36px, `#007AFF`, white 13/700, radius 10) → toggles to "Close".

**Certified badge** (height 24, `rgba(0,122,255,0.12)` fill, `1px rgba(0,122,255,0.35)` ring, radius 7, text 11.5/700 `#6A9AF8`): seal + `Certified · {locked} of {settled} results locked` (or "Certified ledger · nothing settled yet"). Title: "Every locked result is frozen — it cannot be edited or deleted. The blue seal on a ledger row marks a locked result."

**The seal (1b Rosette, final)** = `#007AFF` square clipped by a 12-point scallop, white tick stroke 3.2 at 7px:
`clip-path: polygon(100% 50%, 92.5% 59.3%, 93.3% 75%, 81% 81%, 75% 93.3%, 59.3% 92.5%, 50% 100%, 40.7% 92.5%, 25% 93.3%, 19% 81%, 6.7% 75%, 7.5% 59.3%, 0% 50%, 7.5% 40.7%, 6.7% 25%, 19% 19%, 25% 6.7%, 40.7% 7.5%, 50% 0%, 59.3% 7.5%, 75% 6.7%, 81% 19%, 93.3% 25%, 92.5% 40.7%)`; tick path `M5 12l5 5 9-10` in a 24 viewBox. **12px** in the header badge, **13px** on locked ledger rows.

### 3. Log-a-bet panel (toggled)
Card with `1px rgba(0,122,255,0.35)` ring. Head: caps "Log a bet · {bankroll}" left; right: "Type" segment **Single · Combination · Parlay** + "Placed" segment **Pre-match · Live · in play** (segments: inner-tone track radius 9 pad 3, item 5×12 radius 7 12/700, on = `#1B2031` white, off = transparent `#A3AABE`).
Legs: grid `58px minmax(0,1fr) 110px 24px` gap 10 — caps label ("Bet" for Single, "Leg n" otherwise), text input, odds input (mono), × remove (Parlay only, when > 2 legs). Parlay shows "+ Add a leg" (`#6A9AF8`). `legsNote` under: Single "One selection, one price." · Combination "Two legs, one ticket — the odds multiply: a × b = c. All legs must win." · Parlay same for any number.
Rows: `Tournament (text) · Level (select) · Surface (select)` grid `minmax(0,1fr) 150px 150px …`; `Market (select) · Bookmaker (select)`; `Odds (read-only, computed) · Stake · % (mono input) · Post bet`. Inputs 34px, `#0A0D14`, 1px 10% ring, radius 8, 13px.
- Level options: Grand Slam · Masters 1000 · ATP 500 · ATP 250 · Davis Cup · Challenger (stored keys Slam / 1000 / 500 / 250 / Cup / Chall).
- Surface: Hard · Indoor hard · Clay · Grass.
- Market (11 + Other): Match winner · Set winner · First set winner · Games handicap · Sets handicap · Total games · Total sets · Correct score (sets) · Tiebreak in match · Player to win a set · Outright · "Other — type it".
- Bookmaker (22 + Other): bet105 · Pinnacle · bet365 · Betfair Exchange · Betfair Sportsbook · Unibet · Betway · William Hill · 888sport · bwin · Ladbrokes · Betsson · Stake · Napoleon · Circus · Golden Palace · Betcenter · Tipico · Winamax · Superbet · Polymarket · Kalshi · "Other — type it". Choosing Other reveals a typed field under the row.
- Combined odds = product of leg odds, 2 dp, read-only, "—" until all legs valid.
- Stake hint when a plan is applied: "{plan} says x.xx%" + **Use** link that fills the stake.
- **Validation**: every leg has text + odds ≥ 1.01; stake 0.1–10; market and bookmaker non-empty. Post button is `#007AFF` when valid, else `#131623` with grey text and does nothing.
- Hint sentence (12px): valid → `You post: {type} · {legs joined with " + "} · {market} @ {odds} · {book} · {stake}% of bankroll · {pre-match | live, in play} · wins → +x.xx% · loses → −y.yy%. It lands as pending; settle it in the ledger, then lock it.` Invalid → "Every leg needs its text and odds (1.01 or more); a stake between 0.1 and 10%, a market and a bookmaker are required — type your own when the lists do not have them. Type and Pre-match / Live are stored with the bet."
- Posting appends a pending bet (today's date, `close: null`) to the current bankroll, closes the panel, resets legs / tournament / stake / typed fields (type, level, surface, market, book, timing persist).

### 4. Hero box (Headline first)
Card `padding 22 24 18`. Top row: left caps "Profit · % of bankroll" + **48px mono profit** (sign-coloured) + "{n} settled · {staked}% staked in total" 14 `#E7E9EE`. Right cluster: curve meta "N bets · peak +x% · now +y%" 11.5 grey → **Period trigger** → **Filters trigger** → **View segment**.

Triggers (30px, radius 9, 12.5): `on` = `#131623` + 16% ring + `#E7E9EE` 700; `off` = `#0A0D14` + 6% ring + `#c6ccdb` 600; ▼ 9px grey. Period is "on" while its menu is open or the period ≠ Season; Filters while open or any filter set.
- Period menu (220px, right-aligned): Last 30 days · Last 90 days · Season (default) · Custom range. Rows 6×9 radius 7 12.5, selected row `#0A0D14` 700 + ✓. Custom reveals two `type=date` inputs (mono 12, `color-scheme:dark`) inside the menu; picking a non-custom row closes the menu.
- Filters menu (560px, two columns): groups **Level · Odds band · Surface · Market**. Each row = label · count (mono 10.5 grey) · ✓. Count = bets that row would leave given the *other* groups' filters (cross-adjusted). Zero-count rows grey 40%. Footer: "{x} of {y} bets in the period · a count is what that row would leave given the others" + **Reset filters** (`#5B9BFF`; also resets period to Season). Trigger label: "Filters" / "Filters · A · B" / "Filters · A · B · +N".
- View segment (`#0C0E16` track, 1px 10% ring, radius 9, pad 2, items 0×12 radius 7 12.5): **Results · Insights {bad/judged mono badge, red if bad>0 else green} · Staking {green 6px dot when a plan is applied}**. Default Results.

Curve: 262px box, SVG `viewBox 0 0 1292 240` stretched to 100% width (`preserveAspectRatio=none`), plot x 44→1288, y 12→222. Y ticks every 1 / 2 / 5 / 10 % depending on span, dashed `3 4` 6% white, zero line solid 22%; labels mono 10 absolutely positioned left (36px, right-aligned). X labels = first bet of each month, 10.5 grey at `top 246px`, left in % of 1292. Area fill `linear-gradient #007AFF 22% → 0`; line `#007AFF` 2.2; deepest-drawdown point = 3.5px circle filled card tone with `#E06266` 2px stroke; last point = 4px white dot. Note row under: "○ red = deepest drawdown" + "deepest drawdown −x.x% on {date}".

Stat tiles: 7 across (`repeat(7, minmax(0,1fr))` gap 8, hairline above, pad-top 14), inner tone, `padding 10 14`, radius 9: caps label · 18/800 mono figure · 11 sub.
ROI "profit ÷ total staked" · Record "{n} settled · {v} void" value `W–L` · Win rate "won ÷ (won + lost)" · Avg CLV "beat the close {beat} of {n}" · Max drawdown "peak to trough, % of bankroll" (red) · Best run "consecutive wins" ("5 won") · Worst run "consecutive losses" ("4 lost"). Missing → "—".

### 5. View: Results (default)

**Ledger.** Head: "Ledger" 16/800 + "{shown} of {n} bets in the period · pending first · settle a bet and every figure above recomputes". Right: segment **All · Pending · Won · Lost** (card-tone track, radius 10). Month chips row (horizontal scroll): "All" + one chip per month with bets (min-width 92, pad 8×12, radius 9; label 12.5/700 + count mono 10.5; P/L mono 12/800 sign-coloured; on = `#131623` + 16% ring white, off = `#0A0D14` + 6% ring `#c6ccdb`). Table card: head band 28px inner tone; grid `84px minmax(0,1.6fr) minmax(0,1fr) 64px 48px 48px 56px 50px 150px 64px` gap 12, pad 0 16 — Date · Bet · Market · Book · Odds · Close · CLV · Stake · Result · P/L. Rows 50px, hairline, hover 3%, pending rows `rgba(106,154,248,0.05)`.
Row cells: date 12.5/600 + weekday 10.5 grey · bet text 13.5/700 white + meta 11.5 grey ("{tour} · {level} · {surface}[ · Combination · 2 legs][ · Live][ · after two losses]") · market (+ line) 12 `#E7E9EE` · book 12 grey · odds 14/800 mono · close 12.5 mono · CLV 12/700 mono sign-coloured · stake 12.5/700 mono "1.5%" · Result lane · P/L 14/800 mono sign-coloured.
Result lane — pending: three outlined buttons **WON** (green 45% ring, hover 14% fill) · **LOST** (red) · **VOID** (18% white). Settled this session: "undo" 11 grey + **Lock** (22px, `1px rgba(0,122,255,0.5)`, `#6A9AF8` 10.5/700) + state chip. Locked: state chip + **13px seal**. State chips (20px, mono 10/700 0.08em, radius 6): WON `rgba(92,203,132,0.14)` / 40% ring / `#5CCB84`; LOST `rgba(224,98,102,0.14)` / 40% / `#E06266`; VOID 5% white / 18% / `#A3AABE`.
Rules: historical rows are locked by default; a result settled in-session can be undone until locked; lock is irreversible. Sort: pending first, then date desc, then id desc. Shows 14 rows; footer "Showing 14 of N · a result you settle here can be undone until you lock it · a locked result (blue tick) is frozen for good" + **Export CSV →** (`#6A9AF8`; export itself is on the handoff list).

**Calendar.** Head "Calendar" + sub "Last 26 weeks, one cell a day · the figure is that day's result in € on a 10,000 € bankroll · hover a day for its bets, click to pin the record. Months on the right over the whole season — click one for its full record." Grid `minmax(0,1fr) 400px` gap 12.
Heat card: month labels row (14px tall, left offset 34px, each at `week × 32px`); day labels Mon…Sun (24px col, 28px rows, 10.5 grey); cells 28×28 radius 4, `grid-auto-flow:column; grid-template-rows:repeat(7,28px); gap 4`, 26 columns ending on the current week. Cell colour: no bets `rgba(255,255,255,0.04)`; future transparent; pending-only `rgba(106,154,248,0.35)` with "·"; settled day → green / red at alpha `min(1, 0.3 + |P/L %| / 3 × 0.7)`, flat 12% white; figure = that day's P/L in **€** (P/L % × 100), mono 9/700, white 92%. Hover ring `0 0 0 1px rgba(255,255,255,0.45)` + pop-up (360px, menu tone, `pointer-events:none`, flips side after week 14): "{Weekday} {d Mon}" + "{n} settled · {p} pending · W–L · +x.x% = +N €", rows text/meta · result caps · P/L. Click pins → ring `0 0 0 2px #FFFFFF` + a record box under the grid (inner tone, radius 10): head title + sub + **Close** (`#5B9BFF`), rows grid `minmax(0,1fr) 70px 60px`. Footer: "{days} betting days this season · {green} finished up · {rest} down or flat" + legend "loss ■■□■■ win · figure = € that day" (reds 85% / 35%, 5% white, greens 35% / 85%).
Months table (400px card): head Month · Bets · ROI · P/L (grid `minmax(0,1fr) 44px 120px 70px`), rows 38px clickable (open month row 4% white): name 13/600, count mono 12.5, **ROI bar** (8px track 5% white, centre tick 1px 18%, fill from centre, clipped at ±40% → 50% width each side, green/red), P/L mono 13/800.

**Month pop-up** (fixed overlay `rgba(3,5,9,0.72)`, sheet max 960px, `#0C0E16`, radius 14, `padding 20 22 14`): title "October 2026" 17/800 + mono sub "{n} settled bets · W–L[–v void] · {staked}% staked"; ✕ 30px ghost; 4 stat tiles P/L · ROI · Win rate · Avg CLV; full-bleed table (grid `50px 10px minmax(0,1.6fr) minmax(0,1fr) 46px 46px 50px 48px 48px 56px`, head Date · · Bet · Market · Price · Close · CLV · Stake · Result · P/L) with an 8px result square (radius 2) per row; foot "Settled bets only · P/L and stake in % of bankroll · CLV = your price ÷ closing price − 1 · click outside to close". Click outside or ✕ closes.

### 6. View: Insights

**Where it works · where it leaks.** Sub "{n} settled bets in the period, cut eight ways · in order | sorted by P/L · every row carries its count".
Three **verdict cards** (`repeat(3, minmax(0,1fr))` gap 12, card tone, `padding 16 18 14`, 48px spacer at the foot): caps kind in its colour (**Your edge** green · **Your leak** red · **Blind spot** amber `#E8A84E`) + "{segment title} · {n} bets" right; **34px mono P/L**; sentence 15/700 white; figures row on a hairline: Record · ROI · CLV (caps 10 + mono 13/700). Behind the foot: the segment's own cumulative curve (SVG 380×70 stretched, 84px tall, opacity 0.35, line 1.5 in the kind colour, fill 35%).
Sentences: edge → "{seg} is where you beat the market[ — the close agrees]." · leak → "{seg} cost you half your profit | is your biggest leak[ and the close went against you]." · blind spot → "{seg}: EARLY · n={n}, trending wrong." Empty copy: "No segment with {minN}+ bets is clearly profitable yet." / "No losing segment with {minN}+ bets in this period." / "Nothing under the sample floor is trending wrong."
Segment titles by cut: market → name · surface → "{name} courts" · odds → "Odds {band}" · level → name · timing → "{Pre-match|Live} bets" · situation → name · weekday → "{Day} bets". Bookmaker is **not** a strength/leak cut.

**Breakdown box** (card): head row — "Breakdown" 14/800 · "by" · **cut trigger** (same trigger chrome; menu 220px left-aligned, 8 rows each with its segment count mono + ✓) · right: "{n} bets · W–L · ROI x · P/L y". Cuts in order: Market · Surface · Odds band · Level · Bookmaker · Timing · Situation · Weekday (default Market). Column head 30px on a hairline (no band): `{cut noun}` · Bets · W–L · "ROI · −40 ‥ +40" (centred) · ROI · CLV · P/L; grid `4px minmax(0,1.2fr) 60px 80px minmax(200px,1fr) 80px 70px 80px` gap 12 pad 18. Rows 46px: 4×22 ROI-colour mark · name 13.5/700 · n mono 12.5/600 · W–L grey · ROI bar (as months) · ROI 13/800 · CLV 12/600 · P/L 13/800. Order: Odds band and Weekday in natural order; every other cut by P/L desc. Total row 40px on `#0A0D14`: "All · {cut}" caps 11 · n · W–L · (blank bar) · ROI · CLV · P/L. Foot: "ROI bar clipped at ±40% · CLV = your price ÷ closing price − 1, over bets with a close · P/L in % of bankroll".
Fixed vocab: odds bands **1.10 – 1.35 · 1.36 – 1.60 · 1.61 – 1.90 · 1.91 – 2.20 · 2.21 – 2.60 · 2.61 – 3.20 · 3.21 and up**; levels Grand Slam · Masters 1000 · ATP 500 · ATP 250 · Davis Cup · Challenger; surfaces Hard · Indoor hard · Clay · Grass; timing Pre-match / Live; situation "After two losses that day" / "Normal rhythm"; weekdays Monday → Sunday.

**Discipline** (one strip). Sub "Skill shows in the closing line and the stakes long before it shows in the P/L." Card head: caps "Discipline · {period lowercase}" + "{bad} of {judged} checks need work · {n} bets[ · k not judged yet]" (count mono, red if bad > 0 else green). Three columns (`repeat(3)`, right hairlines), each `grid 110px minmax(0,1fr)` gap 14: **dial** = SVG 200×110 at 110×61: track arc `M20 100 A80 80 0 0 1 180 100` 6% white stroke 10 round; target zone 20% white stroke 10; value arc in the verdict colour; figure 19/800 mono centred at the base. Right: label 13/700 · verdict caps 11/700 0.08em in colour · `short` line 11.5 grey. Full `body` on hover (title).
1. **Closing line** — figure "{beat%}%" "of bets beat the close"; verdict ≥55 REAL EDGE (green) · 48–54 COIN FLIP (amber) · else PAYING TOO MUCH (red); zone 55–100%; short "{beat} of {n} priced bets beat the close · target 55%+".
2. **Stake after a loss** — figure "×{ratio}" (avg stake after a loss ÷ after a win); >1.15 CHASING (red) · <0.85 SHRINKING (amber) · else STEADY (green); dial maps 0.5–2.0, zone 0.85–1.15.
3. **Third bet after two losses** — figure = ROI on those bets; n < minN → "EARLY · n=x" (amber) · ROI < −5% TILT (red) · else UNDER CONTROL (green); dial maps ROI −30…+30%, zone from the rest-of-ledger ROI upward; short "{n} bets at ROI x · the rest run y over m".
`minSample` default **15** (tweakable 5–40; floor 5). The word "thin" is never used — "EARLY · n=x".

### 7. View: Staking
Head "Staking strategy" + sub "Same bets and results, only the stake changes · pick a plan, read it against your stakes, apply it to this bankroll." Right: when applied "{plan} is on for {bankroll} · the next bet you log is pre-sized" + **Remove** (`#5B9BFF`); **Apply {plan} to this bankroll** button (30px, `#007AFF`) → "Applied to {bankroll}" (`#131623`, grey, 10% ring).
Plan chips (one selectable, default **Compounding 1%**): 8px swatch + name; on = `#1B2031` white 20% ring, off transparent grey 6% ring; hover title = `how`. Plans + colours: Flat 1% `#8FB8FF` · Flat 2% `#C9DDFF` · Compounding 1% `#E7E9EE` · To win 1% `#5B9BFF` · ¼ Kelly on CLV `#A3AABE` · Double after a loss `#E06266`. Your stakes `#007AFF`.
Stake rules: Flat 1 / Flat 2 → constant; Compounding 1% → `max(0, 1 × (1 + cum/100))`; To win 1% → `min(5, 1/(odds−1))`; ¼ Kelly on CLV → `clv ≤ 0 ? 0 : min(3, 25 × clv / (odds−1))` (hindsight — uses the close); Double after a loss → 1, ×2 after each loss, back to 1 on a win, cap 8.
Card: head "— Your stakes vs — {plan} · {plan sub}" + right "{n} bets · cumulative % of the starting bankroll · shaded = the gap · plan ahead by up to x%, behind by up to y%". Chart 250px, SVG `0 0 1256 226` 100% wide, plot x 36→1256, y 6→220; fill **between** the two lines (`rgba(92,203,132,0.08)` if the plan ends higher, else `rgba(224,98,102,0.08)`); your line `#007AFF` 2.2, plan line 2 in its colour; y ticks mono 10 at left 18px. **Delta strip** (4 columns, hairlines): End · Max drawdown · Worst month · Biggest single loss — "you → plan" (13 grey → 16/800 white) + signed diff 12/700 green if better. **Three explainer cells**: Your stakes `how` · {plan} `how` + `when` · "The difference" = `You averaged a% a bet (lo–hi%), the plan b% (lo–hi%)[, skipping k of n bets]. Same results: ±x% at the end, drawdown y% shallower|deeper.` Foot note: "Same bets and results, only the stake changes. A plan is judged on the whole season, not the end figure alone: read End together with Max drawdown and Biggest single loss. The Kelly line uses the closing price you did not know at the time — a ceiling, not a plan."

---

## Formulas (reference = the logic class)
- Stakes everywhere in **% of bankroll**, never units or €, except the calendar's € figure on a 10,000 € bankroll.
- P/L per bet: won → `stake × (odds − 1)`; lost → `−stake`; void → 0; pending → excluded.
- ROI = profit ÷ total staked. Win rate = won ÷ (won + lost). Record "W–L", void count in the sub.
- CLV = `odds ÷ close − 1`; Avg CLV over bets with a close; "beat the close" = CLV > 0.
- Max drawdown = largest peak-to-trough on the cumulative % curve (settled bets in date order within the filtered period); Best / Worst run = longest consecutive won / lost.
- Period windows: Last 30 days · Last 90 days · Season (Jan 1 →) · Custom (inclusive dates). Filters AND across groups, OR within a group; counts in the menu are cross-adjusted.
- Segment eligibility: n ≥ minSample; strengths = profit > 0 and ROI > 3%, top 3 by profit; leaks = profit < 0, top 3 by loss; blind spot = worst-P/L segment with 5 ≤ n < minSample and ROI < 0. "Normal rhythm" is never a segment.
- Certified: a bet is locked when it has a result and is either historical (not posted this session) or explicitly locked. Header count = locked ÷ settled over the bankroll.
- Switching bankroll resets filters (period kept). Settling / undoing a result recomputes every figure on the page immediately.

## State
`period · range{from,to} · filters{level,odds,surface,market} · menu (period|filters|dim|null) · view (results|insights|staking) · dim · bank · banks[] · archived{} · extra[] (posted bets) · settled{} · locked{} · lf (ledger filter) · ledgerMonth · openMonth · hoverDay · openDay · vsPlan · appliedPlan · logOpen · form{type,timing,legs[],tour,level,surface,market,marketOther,book,bookOther,stake}`.

## Data contract (per bet)
`{ id, date, tour, level: Slam|1000|500|250|Cup|Chall, surface, market, line|null, book, odds, close|null, stake (% of bankroll), res: won|lost|void|null, timing: pre|live, type: Single|Combination|Parlay, legs: n, text, bank, tilt (3rd+ bet on a day already down two), pending }`. Close is written in by the price archive (Pinnacle close) once the match is live; "—" until then.

## Handoff list (not in the design — build decisions pending)
Export CSV · CLV for outrights (dash until ruled) · bankroll rename · deposits / withdrawals · live close feed into pending bets · a Picks analytics page that builds on this data.
