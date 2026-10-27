# Picks page — pixel spec (LOCKED 2026-10-27, night only)

Source of truth: `reference/Picks LOCKED 2026-10-27.dc.html` (open it in a browser; `reference/support.js` + `reference/assets/` sit next to it). Every value below was read from that file. Where this document and the file disagree, the file wins.

The reference canvas shows boards **1a–1k**. Only these are the product:

| Board | What it is | Build |
|---|---|---|
| 1a | Today · Upcoming · with picks (shell, header, controls, bets box, cards) | yes |
| 1b | Today · empty | yes |
| 1c | Completed · Sun 26 · settled day | yes |
| 1d | Today · non-Pro (blurred) | yes |
| 1e | Record view (ledger) | yes |
| 1f / 1f2 / 1f3 | Post-a-pick drawer: live price · search + manual · outright | yes (admin) |
| 1g / 1h | Drawer posted-editable / frozen | yes (admin) |
| 1i | Card lifecycle at 664px (posted · live · won · lost · void · blurred · outright) | the same card, all states |
| 1j | Mobile 390 card | yes |
| 1k | Small things: Bets today tile · "+ Pick" on match card · nav dot · admin badge · thin strip · chips | yes |

Everything else that exists in the logic class (`turn2` layouts, `turn3` summary variants a–d, `turn4` note variants a/c/d/e, `symBoard`, `resOpts`, `duoOpts`, `trailOpts`, `withMkt` Market box) is a **rejected exploration kept for reference** — do not build it.

---

## 0. Global

- Fonts: **Hanken Grotesk** 400/500/600/700/800 (UI), **IBM Plex Mono** 400–800 (every number, time, price, tag, chip). Google Fonts link in the reference. `-webkit-font-smoothing:antialiased`, `box-sizing:border-box` everywhere.
- Page background `#090B12` with a header glow: `radial-gradient(ellipse 1500px 640px at 720px -120px, rgba(52,70,170,0.22) 0%, rgba(0,0,0,0) 100%)` layered over `#090B12`. Text default `#FFFFFF`.
- Links `#6A9AF8`, hover `#FFFFFF` + underline.
- Keyframe `pkpulse` (LIVE dot): `0% box-shadow 0 0 0 0 rgba(234,249,40,0.45) · 70% 0 0 0 6px rgba(234,249,40,0) · 100% 0 0 0 0 rgba(234,249,40,0)`, `1.6s ease-out infinite`. (Kept in code; the LIVE chip is not used on the card — see §5.1.)
- Review widths: **Mac 1512** (default) and **Review 1440**. Card width at 1512 = **664px** (two per row). Page min-height on the artboard 980px.

### Colour tokens used on this page

| Role | Value |
|---|---|
| Page | `#090B12` |
| Card / box / header / drawer | `#10131D` |
| Lost card fill | `#0E1119` |
| Inner / input / table head band | `#0D1017` |
| Segment / chip / avatar / rail hover | `#171B28` |
| Selected segment / chip / selected chip bg | `#1B2031` |
| Sidebar pill | `#121520` |
| White ink | `#FFFFFF` |
| Soft ink | `#DDE0EA` |
| Grey ink / caps labels | `#A3AABE` |
| Dim grey (source text, tooltips) | `#5B6880` |
| Lost-set figure | `#8b96b5` |
| Accent (pick bar, nav badge, form bars) | `#007AFF` |
| Primary button / Pro ring | `#2F52D6` (hover `#3A5EE6`) |
| Link blue | `#6A9AF8` |
| Green (won, shortened, +) | `#5CCB84` |
| Red (lost, drifted, −) | `#E06266` |
| Amber (thin, MANUAL, edit banner) | `#E8A84E` |
| Live yellow (dot) | `#EAF928` |
| PRO chip ink | `#F2F3F7` |
| Hairline | `rgba(255,255,255,0.06)` (rows `0.05`, table head `0.08`) |
| Card top light | `box-shadow: inset 0 1px 0 rgba(143,170,255,0.05)` on every card / box / header |

### Recurring atoms

- **Caps label**: Hanken 10.5px / 700 / letter-spacing 0.10em / uppercase / `#A3AABE`. Inside table head rows: 10px (same otherwise). Trail labels: 9.5px.
- **Type tag** (WINNER · HANDICAP · TOTALS · OUTRIGHT): inline-flex, height 20, padding 0 8, radius 6, mono 10/700/0.08em. WINNER/HANDICAP/TOTALS = bg `#171B28`, border 1px `rgba(255,255,255,0.08)`, ink `#DDE0EA`. OUTRIGHT = bg `#1B2031`, border 1px `rgba(255,255,255,0.18)`, ink `#FFFFFF`.
- **State chip**: same box as the type tag (h20, pad 0 8, r6, mono 10/700/0.08em). POSTED hh:mm = `#171B28` / `rgba(255,255,255,0.08)` / `#DDE0EA`. WON = `rgba(92,203,132,0.14)` / `rgba(92,203,132,0.40)` / `#5CCB84`. LOST = `rgba(224,98,102,0.14)` / `rgba(224,98,102,0.40)` / `#E06266`. VOID = `#171B28` / `rgba(255,255,255,0.08)` / `#A3AABE`. (LIVE = `#171B28` / `rgba(255,255,255,0.12)` / `#FFFFFF` + 7px `#EAF928` pulsing dot, gap 6 — exists in the chip set, but a live card still shows POSTED hh:mm.)
- **PRO chip**: mono 9/700/0.12em `#F2F3F7`, 1px `#2F52D6` border, radius 20, padding 2 8.
- **FAV badge**: Hanken 10/700/0.10em `#A3AABE`, bg `#171B28`, radius 5, padding 2 6.
- **Round chip**: mono 10.5/600 `#A3AABE`, bg `#171B28`, radius 5, padding 2 6. Time: mono 11.5 `#A3AABE`. Surface: Hanken 11/600 `#A3AABE`. Tournament: Hanken 11 `#A3AABE`, ellipsis.
- **Avatar**: 30×30 circle `#171B28`, Hanken 10.5/700 initials, ink `#DDE0EA` (dimmed side `#A3AABE`). Sidebar user avatar 36×36 mono 10.5/700 white.
- **Segmented control**: track `#171B28`, radius 9–10, padding 3, gap 2–3; segment radius 7–8, 1px border; selected = bg `#1B2031`, border `rgba(255,255,255,0.10)`, white; idle = transparent, `#A3AABE`.
- **Link action** ("Open match →", "Unlock today's picks →", "‹ Back to picks"): Hanken 12.5/700 `#6A9AF8`.
- **Result square** (ledger only): 8×8, radius 2, `#5CCB84` / `#E06266`.

---

## 1. Shell (sidebar) — identical to OFFICIAL VERSION 1

`<aside>` width 92, padding 30 0 30 16. Inner pill: flex column, padding 16 12 14, radius 38, bg `#121520`, shadow `inset 0 1px 0 rgba(143,170,255,0.05), 0 18px 40px rgba(0,0,0,0.35)`. Logo `ring-transparent.png` 34×34, margin 0 0 14 9.

Nav groups (gap 14 between groups, 4 inside): **Analyse** Matches · **Picks** · Live · Trading Report · Dropping Odds · Series · **Research** Players · Head to Head · Tournaments · Database · **Insights** Stennisfy Model · Playing Styles · News. Item = 48px tall, padding 0 13, radius 14, 20×20 stroke icon 1.6 (paths in the reference `NAV`), hover bg `#171B28`. Active (Picks) = white icon + bg `radial-gradient(ellipse 76px 40px at 26px 50%, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0) 100%)`. Locked items (Trading Report, Stennisfy Model) icon `#5B6880` + 16px lock disc `#171B28` at top −8 / left 12 with 2px `#121520` ring. Live badge: `#007AFF` pill, min 18×18, radius 9, mono 10/700 white, top −9 / left 12, 2px `#121520` ring. **New-pick dot** on Picks: 9px circle `#007AFF`, top −4 / right −5, 2px `#121520` ring; stored per member, clears on opening Picks.

Bottom stack (margin-top auto, gap 4, padding-top 8): theme toggle 44px row (18px moon icon `#A3AABE`); **Pro CTA** (non-Pro only) 36px circle `#2F52D6`, "Pro" 10/800 white; user avatar 36px `#171B28` mono 10.5/700 white ("AM" member, "MS" admin). **Admin badge**: 15px white disc at right −3 / bottom −3, 2px `#121520` ring, 9px shield stroke `#0B0C13` 2.2. Title/flyout: "michael · Admin" / "alex.morgan · Pro | Free plan".

`<main>` flex 1, padding **30px 40px 70px**, column gap **22px**.

---

## 2. Header + Record strip

Box: bg `#10131D`, top light, radius 12, padding **18px 26px**, flex, space-between, gap 28.

- Left: "Picks" Hanken 24/800, letter-spacing −0.015em, line-height 1.1; sub "Hand-picked daily from the Stennisfy model and strategy." 13px `#DDE0EA`, nowrap ellipsis; gap 5.
- Right (`align-items:flex-end; gap:22px`):
  - Period segment (`30 d · 90 d · Season`): track `#171B28` r9 pad 3 gap 2, `margin-bottom:1px`; segment pad 5 10, r7, 11.5/700.
  - Stat group (clickable → Record view; hover bg `rgba(255,255,255,0.04)`, radius 8, padding 2 10 2 0, margin-right −10, gap **26**): four stats + Settled. Each = caps label (10.5) over mono **15/700** value, right-aligned, gap 4. Order: **Record** (`W–L`, white) · **Profit** (`+x.x%` signed colour) · **ROI** (`±x.x%`) · **Avg CLV** (`±x.x%`) · **Settled** (`n` `#A3AABE` + 13px Hanken "›").
  - **Thin rule**: fewer than 20 settled in the period → all four values "—" in white and Settled reads `n=7 · thin` in **amber `#E8A84E`**.

---

## 3. Controls row

Row 1 (`inline-flex; gap 12; align-self flex-start`):
- Tabs **Upcoming · Completed**: track `#171B28` r10 pad 3 gap 3; segment pad 7 14, r8, 12.5px, selected 700 white `#1B2031` + `rgba(255,255,255,0.10)` border, idle 600 `#A3AABE`.
- `‹` / `›` buttons 30×30 r8 `#171B28`, 14px `#A3AABE`, hover white.
- Dates (`Sat 25 · Sun 26 · Today · Tue 28`), gap 4: pad 8 12 9, 13.5px, selected 700 white + 2px white bottom border; idle 600 `#A3AABE`, transparent border, hover white.

Row 2 (`flex; gap 12`): "All tournaments" pill pad 9 16 r10 12.5/600 `#171B28` `#A3AABE`; search field flex 1, `#171B28`, r10, pad 10 14, 15px magnifier (`#A3AABE` 1.6), 13px `#A3AABE` "Search for a player…".

Tab switch resets nothing else; tournament + date persist (shell rule).

---

## 4. Bets box (one box, full width, above the cards)

Shown when the day has **more than one** pick and the view is cards. Bg `#10131D`, top light, 1px `rgba(255,255,255,0.06)`, radius 12, overflow hidden.

Head row: padding 10 16, hairline under; left caps title, right 12px `#A3AABE` nowrap meta.
- Upcoming title: `Today · 5 bets` (or `Sun 26 · 3 bets`; singular "bet"). Meta: `5.0% staked · 2 outright · posted time · line @ bet105 price · stake`.
- Completed title: `Sun 26 · settled · 4 bets`. Meta: `2–1 · 1 void · 4.5% staked` (void part only if any).

Settled days add a **caps head row** on the box fill (**transparent**, not `#0D1017`): height 28, pad 0 16, hairline under, grid `92px 360px 56px 44px 64px` gap 0 12: Type · Bet · Price (right) · Stake (right) · Result (right), 10px caps.

Rows: height **50**, padding 0 16, grid `92px 360px 56px 44px {64px settled | 0px upcoming}` gap 0 12, hairline `rgba(255,255,255,0.05)` between rows (last row transparent), hover `rgba(255,255,255,0.03)`.
1. Type tag.
2. Two lines, gap 2: bet line Hanken **13.5/700 white** ellipsis (blurred for non-Pro); under it 11.5px `#A3AABE`: `{mono postedAt} · {tournament round · hh:mm}` (outrights: tournament only).
3. Price: mono **15/800 white**, right (blurred for non-Pro).
4. Stake: mono 12/700 `#DDE0EA`, right, e.g. `1.5%`.
5. Settled only: WON / LOST / VOID chip, `justify-self:end`.

Bet-line text rule: Match winner → `{Surname} to win`; Games handicap → `{Surname} +2.5 games`; Total games → `Over 22.5 games`; Outright → `{Surname} · {market_text}`.

---

## 5. Pick card (664px at 1512; two per row, grid `repeat(2, minmax(0,1fr))` gap 12, `align-items:start`)

Card: bg `#10131D` (**lost → `#0E1119`**), top light, 1px `rgba(255,255,255,0.06)` border, radius **14**, overflow hidden. Lost and void cards render the body + note at **opacity 0.78** (header and footer stay full).

### 5.1 Header — padding 11 16, hairline under, nowrap, gap 6 8
Order left→right: ★ star (24×24 hit area, margin −4 0 −4 −6, r7, hover `#171B28`; 14px star, stroke 1.5 `#A3AABE`, filled white when on) · **type tag** · surface 11/600 · tournament 11 (ellipsis, the only shrinking item) · round chip · time mono 11.5. Right group (`margin-left:auto; gap 8`): **P/L** mono 12.5/800 (settled only: `+1.02%` green / `−1%` red / `0%` grey for void) · **state chip**. Outright cards: no surface, no round chip, no time — type tag OUTRIGHT then event name. No LIVE chip anywhere on the card: a live card shows `POSTED hh:mm`.

### 5.2 Body — grid `minmax(0,1fr) 1px {300px | 224px settled}` gap 0 16, padding 10 16 8, items centred
Left column (gap 2), one row per player (outright: one row):
- row = relative, flex, gap 11, padding 5 0 5 12; **pick bar** absolute left 0, top/bottom 6, width 3, radius 2, `#007AFF` on the picked side (transparent otherwise).
- avatar 30 · name Hanken 14, weight: picked 700 / other 600; settled: winner 800, loser 600 and loser ink `#A3AABE` (+ avatar ink `#A3AABE`) · FAV badge on the side with the lower **live** price · **line tag** on the picked side for handicap/totals: mono 10.5/700 white on `#1B2031`, 1px `rgba(255,255,255,0.10)`, r5, pad 2 6 (`+2.5 games` / `Over 22.5`).
- **Score block (settled only, right end of the row, `flex:none`)** = Today's Matches Completed grammar: sets-won tile 26×26 r6 mono 14 (winner: bg `rgba(255,255,255,0.09)`, inset ring `rgba(255,255,255,0.10)`, white 700; loser: bg `rgba(255,255,255,0.045)`, no ring, `#A3AABE` 500) · 1×20 hairline `rgba(255,255,255,0.08)` margin 0 8 · set cells 24×24 r5 gap 3 mono 13.5, **coloured per set**: won set white 700 on `rgba(255,255,255,0.08)`, lost set `#8b96b5` 500 on `rgba(255,255,255,0.025)`; tiebreak score as 8px/500 superscript at top 1 / right 1 on the tiebreak winner's cell only. Retired set: nobody "won" it (both cells lost-style).

Divider: 1px `rgba(255,255,255,0.06)`, `align-self:stretch`.

Right column (gap 9):
- **Bet line**: `{bet line 13.5/700 white, ellipsis}` `@ 12px #A3AABE` `{posted mono 16/800 white}` `bet105 mono 10.5 #A3AABE`, baseline, gap 7, nowrap.
- **Trail** (match bets only):
  - Posted / live: grid `auto minmax(8px,1fr) auto minmax(8px,1fr) auto minmax(8px,1fr) auto`, gap 3 6. Row 1 = prices + 2px r1 segments; row 2 = caps 9.5 labels under each price (grid-column 1/3/5/7). Open mono 14/600 `#A3AABE` · Posted 14/700 white · **Now 15/800 white** · Close 14/700 (white if present, `#A3AABE` for "—"). Label "Now" while `status = posted`, **"Last"** once live.
  - Settled (won/lost/void): three stops `Open → Posted → Close`, grid `auto minmax(8px,1fr) auto minmax(8px,1fr) auto`; Open 14/600 grey · Posted 14/700 white · **Close 15/800** (carries the big weight).
  - Segment colours: Open→Posted always `rgba(255,255,255,0.14)`. Posted→Now, Now→Close (and Posted→Close on settled): `#5CCB84` when the later price is **lower**, `#E06266` when higher, `rgba(255,255,255,0.28)` when equal, `rgba(255,255,255,0.14)` when either end is null.
- **Meta line** 11.5px `#A3AABE`, gap 6: `CLV {±x.x% mono 12/700 signed colour | — grey} · Stennisfy {fair odds mono 12/700 white} · Stake {x% mono 12/700 white}`. Stennisfy = `1 ÷ model chance` to 2 dp (e.g. 58% → `1.72`), "—" when no model; blurred for non-Pro.
- **Outright** right column: bet line, then two 11.5px grey lines: `Posted 08:50 · bet105 · Stake {0.5% white mono 700}` and `Settles 16 Nov · no open / now / close for outrights`. Nothing else (no CLV).

### 5.3 Analysis (note) — hidden until opened
No text in the body by default. Footer-left control `Read the analysis ▾` / `Hide analysis ▾(rotated 180°)`: Hanken 12.5/700/0.02em white, chevron 11px/400 `#A3AABE`, `transition: transform .16s`. Open → full note in a block `padding 2px 16px 12px`, 13px / line-height 1.45 `#DDE0EA`, `white-space:pre-line; text-wrap:pretty`, above the footer. Void cards append ` · ret. 2-3 set 1 · void (Pinnacle rule)` to the text. Note ≤ 2,000 chars.

### 5.4 Footer — padding 10 16, hairline above, space-between
Left: the analysis toggle (+ admin-only `Edit · 6 min left` 11.5/700 grey, gap 16). Right: `Open match →` link 12.5/700 `#6A9AF8`. Non-Pro gated card: left = PRO chip + `Unlock today's picks →` (gap 10) instead of the toggle.

### 5.5 Gating (non-Pro, status posted/live, today only)
Whole left player column, the whole right column and the note get `filter: blur(5px); user-select: none`. Header, chips and footer stay readable. Settled cards are **never** blurred. Empty day: no upsell.

### 5.6 Whole card click → Match analysis (Upcoming opens Key factors, Completed opens Match Stats; ret/wo → Key factors). Star, analysis toggle, player names stop propagation.

---

## 6. Empty panel
Bg `#10131D`, top light, radius 12, padding 34 26, centred: title 14/700 white, optional sub 12.5 `#A3AABE` (gap 6).
- Upcoming · Today, no picks: **"No bets posted yet today"** (only line, also for non-Pro).
- Completed · Today: "No bets settled yet today." + "Today's picks are under Upcoming until their match ends."
- Future date: "No bets posted yet for Tue 28." · other past day: "No bets this day."

---

## 7. Record view (ledger)
Replaces controls + cards (header stays). Top row: `‹ Back to picks` 13/700 `#6A9AF8` · right 12.5 `#A3AABE` `Last 30 d · settled picks only · {n mono} rows`.

Table box `#10131D` r12. Grid everywhere: `82px minmax(0,1.7fr) minmax(0,1.3fr) 66px 66px 74px minmax(0,1fr) 72px`, gap 0 12, padding 0 16.
- Head: padding 10 16, bg `#0D1017`, 1px `rgba(255,255,255,0.08)` under; caps 10.5 labels **Date · Match · Pick · Posted · Close · CLV · Result · P/L**, clickable; active column white + 9px `#6A9AF8` ▼/▲ (gap 5); Posted/Close/CLV/P/L right-aligned.
- Rows: height 38, hairline `rgba(255,255,255,0.05)`, hover `rgba(255,255,255,0.03)`. Date mono 11.5 grey (`27 Oct`) · Match 12.5/600 white `A v B` + 11px grey `Tournament · Round` · Pick 12.5/700 white + 11px grey market (+ line) · Posted mono 12.5/700 white · Close mono 12.5/600 `#DDE0EA` · CLV mono 12/700 signed · Result = 8px square + mono 11.5 `#DDE0EA` `W · 6-4 7-5` · P/L mono 12.5/800 signed.
- Total row: height 40, bg `#0D1017`: caps "Total" · `112 settled · Last 30 d` 12px grey · CLV avg mono 12/700 signed · `W–L · ROI ±x.x%` mono 12 `#DDE0EA` · Σ P/L mono 13/800 signed.
- Default sort: date, newest first; clicking the same head flips; a new head sorts descending.

---

## 8. Post-a-pick drawer (admin only)

Backdrop `rgba(5,6,10,0.55)` over the page (click closes). Drawer: absolute right, **width 440**, full height, bg `#10131D`, shadow `-24px 0 60px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.06)`, scrolls.

Header: padding 20 22 14, hairline under. Title 18/800 (−0.01em) `Post a pick` / `Edit pick` / `Pick · frozen`; under it the match meta row (surface 11/600 · tournament 11 · round chip · `Mon 27 · 20:30` mono 11.5) gap 8. Close × 28×28 r8 `#171B28` 15px grey (hover white).

Banner (edit / frozen only): margin 14 22 0, padding 9 12, r9, 7px dot, 12px text. Edit: bg `rgba(232,168,78,0.10)`, border `rgba(232,168,78,0.35)`, white text, amber dot, right link **Void pick…** 700 white — "Posted 09:41 at 2.02 · editable for 6 more minutes · note and stake only". Frozen: bg `#0D1017`, border 6% white, grey text, dot `#5B6880` — "Posted 09:41 at 2.02 · the 10-minute window closed at 09:51".

Body: column gap 18, padding 18 22 22. Every section label = caps 10.5.

1. **Match** (new, non-outright): label + `Cancel` (11.5/700 grey) when the search is open. Search panel: r10, bg `#0D1017`, 1px 10% white; input row h40 (14px magnifier, 13px white input, placeholder "Search today's matches — player or tournament"); hit rows h46, grid `minmax(0,1fr) 40px 40px` gap 10, pad 0 12: `A v B` 13/700 white + `Tournament R32 · 20:30` 11 grey; bet105 prices per side mono 12/700 `#DDE0EA`; current match bg `#171B28`; hover `#171B28`; max 6 hits; foot 10.5 `#5B6880` "Today's slate · bet105 per side · matches leave the list at scheduled start". Selecting a hit closes the search and resets selection/line/price.
2. **Selection · click a player** (`margin-top:-12px` when the search is closed) + right link `Change match` 11.5/700 `#6A9AF8`. Two rows gap 4: pad 8 12 8 14, r10, 1px border; selected bg `#171B28` + 10% border, idle transparent + 5% border, hover border 14%; 3px accent bar left (r 0 2 2 0, top/bottom 9) on the selection; avatar 30; name 14 (700 selected white / 600 `#DDE0EA`); FAV; price mono **17/800** + `bet105` mono 10.5 grey. Edit/frozen: section at opacity 0.55, pointer-events none.
3. **Market** chips `Match winner · Games handicap · Total games · Outright` + text input "Other market, e.g. Set handicap" (flex 1, min 120, h32, r7, `#0D1017`, 1px 10% → 14% when filled, 12.5/600). Chip: pad 7 10, r7, 12/700; selected `#1B2031` + 14% border white; idle `#171B28` grey.
   - **Line** (handicap / totals): chips mono 12/700 — handicap suggestions `−3.5 −2.5 −1.5` for the favourite side, `+1.5 +2.5 +3.5` for the other; totals `Over 22.5 · Under 22.5`; + mono input "Other line, e.g. +4.5 / Over 23.5" (h32). Note 11px grey: "Chips = lines Kibl quotes on bet105 right now (11:41). Type any other line in the box — +3, +4, Over 23.5 … — and the price is typed too." / "No feed for this market — type the line and the price."
   - **Outright** (market = Outright): no match search, no players; 2-col grid gap 6 of inputs h36 r8 `#0D1017` 10% border 13px: Event (full width) · Selection (700) · Settles (mono) · What wins (full width).
   - **Bookmaker** chips `bet105 · Pinnacle · bet365 · Other` (+ "Book name" input when Other), margin-top 4.
4. **Price**:
   - Live (bet105 + a Kibl line): label `Price · live bet105, read-only`; box pad 10 14 r10 `#0D1017` 6% border: price mono **22/800** white · `bet105 · Berrettini · Match winner` 12/600 `#DDE0EA` + stamp mono 11 grey `11:41:14` · refresh button 30×30 r8 `#171B28` (white 15px arrow icon, hover `#1B2031`). Note 11.5 grey: "Live bet105 price — read-only; refresh if it has moved. Pick another book or type a line Kibl doesn't quote to enter a price by hand."
   - Manual (any other book, typed line, typed market, outright): label `Price · typed`; box pad 8 8 8 14, border 10% (→ `rgba(224,98,102,0.5)` when the typed value isn't > 1): mono 22/800 input (width 84, placeholder 2.10, inputmode decimal) · `{Book} · {Surname} · {Market} {line}` 12/600 + `typed by you · decimal odds` mono 11 grey · **MANUAL** tag mono 9/700/0.12em `#E8A84E`, 1px `rgba(232,168,78,0.45)`, r20, pad 3 8. Note: "Typed price — not from a feed. Stored with source = manual and shown on the card as {Book}; CLV still runs against the Pinnacle close."
   - Edit/frozen: label `Posted price · locked`, lock icon 30×30 in place of refresh, note "Price can never change after posting."
5. **Stake · % of bankroll**: input box 120×44 r10 `#0D1017` 10% border, mono 20/800 + `%` mono 13/700 grey; helper 11.5 grey right of it: `Wins → +1.1% · loses → −1% · at 2.10` (amber `#E8A84E` when invalid: "Stake is % of bankroll, 0.1 to 10" / "Type the stake in % of bankroll"). Frozen: opacity 0.55, no pointer.
6. **Note** + counter mono 11 `{n} / 2,000` (amber past 1,900). Textarea rows 6, min-height 88, pad 10 12, r10, `#0D1017`, 8% border, 13px/1.45 `#DDE0EA`, placeholder "Why this pick — the full analysis, 6 to 10 sentences", vertical resize.
7. **You post** summary (new only): pad 9 12 r9 `#0D1017` 6% border, caps 10 "You post" + 700 white `{selection} to win @ 2.10 bet105 · 1%` (ellipsis).
8. Actions (gap 10, padding-top 4): primary h40 r10 `#2F52D6` 13/700 white, flex 1, **opacity 0.5 until valid** (`Post pick` / `Save changes`); secondary h40 pad 0 16 r10 `#171B28` 8% border `#DDE0EA` (`Save as draft` / `Cancel`). Frozen: one h40 inner box with lock icon "Frozen · posted 09:41 · nothing can change".
9. Foot 11.5 grey: new — "Drafts are visible only to you and are never counted. A posted pick can be edited for 10 minutes (note and stake only) and voided with a reason; after that it is frozen." · edit — "Voiding asks for a reason; a voided pick shows VOID · 0u and stays in the ledger."

Validation: Post enabled when a price exists (> 1), stake 0.1–10, the search is closed, and (outright) Event + Selection are filled. Changing match / player / market / line clears the typed price.

**No Context block** (removed on user request).

---

## 9. Mobile card (390 viewport, 16px page padding)
Same card, header padding 11 14 (no star, no type tag; surface · tournament · round · time · P/L · chip). Players block padding 8 14 4, rows padding 6 0 6 12. Then an inner panel `margin 6 14 0; padding 10 12; r10; bg #0D1017` holding the bet line, the four-stop trail and the CLV · Stennisfy · Stake line. Note opens between panel and footer (padding 10 14 12). Footer padding 10 14 (margin-top 10 when the note is closed, 0 when open).

---

## 10. Small things (board 1k)

- **Bets today tile** (Today's Matches insight tile → Picks): card `#10131D`, 1px 7% white, r12, pad 14 18 15, gap 8. Head: caps "Bets today" · right `[PRO chip] Unlock today's picks →` 11/600 `#6A9AF8` (Pro: `Open picks →` grey). Body `flex gap 18`: `{count mono 22/800} bets today 14/700` · column flex 1 with `border-left 1px 8% white; padding-left 14; margin-top 2; gap 4`, one line per match pick: `{tournament} {round}` 12 grey left · right span `{selection 12.5/700} {price mono 12.5/800}` **blurred (5px, no select) for non-Pro**. Outrights excluded. Empty: count "—", "No bets posted yet today" 12.5 grey.
- **"+ Pick" on the Upcoming match card footer** (admin only, also in the analysis modal header): h26, pad 0 10, r7, bg `#1B2031`, 1px 12% white (hover 28%), 12/700 white, mono 13 "+" gap 5; sits left of "See full analysis →" (gap 14). Opens the drawer pre-filled.
- **State chips** demo set: POSTED 09:41 · LIVE · WON · LOST · VOID (values in §0).

---

## 11. Computations (never typed, never accepted from a client)

```
fair(p, q)        = (1/p) / ((1/p) + (1/q))                 // margin-removed chance of the picked side
clv               = posted × fair(close, opp_close) − 1       // null when close or opp_close missing → "—"
pl_pct            = won → stake × (posted − 1) · lost → −stake · void → 0   (% of bankroll)
model fair odds   = 1 / (model_pct / 100), 2 dp                // "—" when no model run
FAV               = the side with the lower *current* price (now vs opp_now)
Record (period)   = settled rows (won · lost · void) with age ≤ 30 / 90 / season
  W–L · Profit Σ pl_pct (1 dp) · ROI = Σ pl_pct ÷ Σ stake · Avg CLV over rows with a close
  n < 20 → every stat "—", Settled = "n=N · thin" amber
Formats           f2 = 2 dp or "—"; pct = sign + 1 dp + "%" (true minus U+2212); u = sign + ≤2 dp trimmed + "%"
Sign colour       > 0 #5CCB84 · < 0 #E06266 · 0 / null #A3AABE
Trail segment     later < earlier → green · > → red · = → 28% white · missing → 14% white; Open→Posted always 14%
Status chip       posted / live → "POSTED hh:mm"; won / lost / void words
```

Dates/times Europe/Brussels. Price trail sources: Open = bet105 first sighting · Posted = bet105 at post (locked) · Now = bet105 live, freezes at match start (label Last) · Close = Pinnacle close (bet365 where ruled); Close is "—" until the match is live/over. Outrights: no trail, CLV dash until a closing-line rule is agreed.
