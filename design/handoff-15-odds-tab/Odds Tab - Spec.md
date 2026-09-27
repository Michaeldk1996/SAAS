# Match analysis → Odds tab (developer handoff)

Locked 2026-09-26. Source of truth: `Match Analysis Odds LOCKED.dc.html` (working file `Match Analysis v4.dc.html`).
This folder holds a standalone extract, `Odds Tab.dc.html`. Open it in a browser: the markup and logic are copied verbatim from the locked file, with the same demo match and seed, so every number matches the locked tab. The only additions are a wrapper card that stands in for the analysis content pane and a minimal `renderVals`.

Reference renders (demo data, captured in a 914px-wide preview, so the header row and pop-up header wrap earlier than they do on desktop):
- `01-odds-tab.png`: the tab.
- `02-odds-tab.png`: the odds movement pop-up for Pinnacle.

All values below are exact.

## Context
- **Where it sits:** the tab content area of the Match analysis modal. The modal is max-width 1500px, height 88vh, bg #0A0D14, border 1px rgba(255,255,255,0.09), radius 20px. The left nav is 238px with a 1px right border at rgba(255,255,255,0.07).
- **Content pane:** padding 24px 28px, scrolls vertically, so usable width is about 1205px at full modal width.
- **Website theme:** on the website the 12a runtime recolour applies on top (Soft ink, 1.25px hairlines). Build with the source values and the site's theme mapping.
- **Fonts:** Hanken Grotesk for UI text, IBM Plex Mono for every number, caption and tag. Use `-webkit-font-smoothing: antialiased` and `box-sizing: border-box`.
- **Hover transition:** any element marked clickable (`.seg`) transitions background, colour and border-colour over .14s ease.

## Colour tokens used on this tab
| Token | Value | Use |
|---|---|---|
| Player A | #6AAEFF | name, sparkline, pop-up line / square / opening value |
| Player B | #E7E9EE | same, for B |
| Up | #3DD68C | positive net, best price now, Highest |
| Down | #E0616F | negative net, Lowest |
| Text | #E7E9EE | primary |
| Muted 1 | #8B96B5 | open prices, inactive labels |
| Muted 2 | #5B6880 | sub-lines, captions |
| Muted 3 | #4B5672 | margin label |
| Header caps | #AAB3C8 | BOOK / OPEN / NOW / NET |
| Blue | #5B9BFF | BOOKS tag, STEAM chip |
| Sharp heading | #82B4FF | "SHARP" |
| Row / tile bg | #0E1019 | book strips, market tiles, column header, pop-up player panels |
| Row hover bg | #11141F | |
| Pop-up bg | #131623 | pop-up + its stat boxes |
| Segmented bg | #0A0D14 | Market / No-vig track |

## Layout (top → bottom)

### 1 · Filter row
Column wrapper for sections 1 and 2: flex column, gap 14px, margin-bottom 24px.

Row: flex, align center, gap 12px 16px, wraps.
- **Segmented control, Market | No-vig**
  - Track: flex, gap 2px, padding 3px, radius 9px, bg #0A0D14, border 1px rgba(255,255,255,0.09).
  - Item: padding 5px 11px, radius 7px, 11.5px, nowrap.
  - On: weight 700, #E7E9EE, bg rgba(91,155,255,0.16), border 1px rgba(91,155,255,0.22).
  - Off: weight 600, #5B6880, transparent bg and border.
  - Tooltips: Market "Prices as quoted, bookmaker margin included"; No-vig "Margin stripped: prices and probabilities sum to 100%".
- **SAMPLE DATA chip**, pushed right (margin-left auto)
  - Inline-flex, gap 6px, mono 9.5px/600, letter-spacing .14em, #8B96B5.
  - Padding 4px 8px, radius 6px, border 1px **dashed** rgba(255,255,255,0.18).
  - A 5px dot #5B6880 before the text; tooltip "Placeholder prices until the live feed is connected".

### 2 · Market tiles (K5)
- **Grid:** `repeat(auto-fill, minmax(150px, 1fr))`, gap 8px.
- **Tile:** flex column, gap 4px, padding 11px 13px, radius 10px.
  - Unselected: bg #0E1019, border 1.25px rgba(255,255,255,0.1).
  - Selected: bg rgba(91,155,255,0.08), border 1.25px rgba(91,155,255,0.45).
  - Hover: border rgba(106,154,248,0.3).
- **Family label** above the name: mono 9px, letter-spacing .14em, #5B6880, uppercase (WINNER / GAMES / SETS).
- **Name:** 13px. Selected: 700, #E7E9EE. Unselected: 500, #8B96B5.
- **Order:**
  1. Match Winner (Winner)
  2. 1st set winner (Winner)
  3. Game handicap (Games)
  4. Total games (Games)
  5. Set betting (Sets)
  6. Set handicap (Sets)
  7. Tiebreak in match (Sets)
- **Behaviour:** default Match Winner. The other markets are selection only: they highlight but the table data stays Match Winner.

### 3 · Section header
- **Row:** space-between, align center, gap 14px 20px, wraps, margin-bottom 6px.
- **Left** (gap 10px):
  - "BOOKS" tag: 10px/800, letter-spacing .1em, #5B9BFF, border 1px rgba(91,155,255,0.35), radius 6px, padding 4px 9px, transparent bg.
  - Title "Per-book movement": 17px/800.
- **Right, only when a steam move exists** (gap 10px, clickable):
  - "STEAM" chip: 10px/800, letter-spacing .16em, text #06070A on #5B9BFF, radius 6px, padding 4px 9px.
  - Text, 12px #E7E9EE, e.g. "6 of 7 books drifted on J. Sinner".
- **Sub-line:** 13px #5B6880, margin-bottom 14px. The text depends on the price mode:
  - Market: "Prices as quoted. Each book from opening to now, with the net change. Click a book for its odds movement."
  - No-vig: "No-vig prices, margin stripped. …" followed by the same sentence.

### 4 · Book table (T3)
- **Outer:** `overflow-x: auto`. Inner: flex column, gap 6px.
- **Grid columns** (header and rows): `minmax(84px,0.8fr) minmax(0,1.9fr) 48px minmax(0,1.9fr) 48px` = Book · A open→now · A net · B open→now · B net.

**Column header strip (J1 on B2)**
- Padding 12px 20px 11px, radius 12px, bg #0E1019, border 1.25px rgba(255,255,255,0.06).
- Gap 10px 12px, align-items end.
- **Line 1:**
  - Empty cell.
  - Player A name centred over A's open→now column: 13px/700, colour Player A, padding-bottom 8px, border-bottom 1px rgba(255,255,255,0.08) (the grey rule).
  - Empty cell.
  - Player B name, same treatment in Player B colour.
  - Empty cell.
- **Line 2:** "BOOK", then "OPEN" / "NOW", "NET", "OPEN" / "NOW", "NET".
  - All labels: mono 10.5px/700, letter-spacing .12em, #AAB3C8.
  - OPEN / NOW sit inside a sub-grid `minmax(0,1fr) 64px minmax(0,1fr)` with gap 8px: OPEN right-aligned in the first cell, the 64px middle empty, NOW left-aligned in the last cell. This puts each label directly over its value.
  - NET is centred.

**Group heading** (before each group)
- Flex, align center, gap 10px, padding 12px 4px 4px.
- Label: mono 9.5px/700, letter-spacing .18em. SHARP is #82B4FF, SOFT is #8B96B5.
- A trailing hairline follows: flex 1, 1px, rgba(255,255,255,0.06).
- Groups: SHARP = Pinnacle, Betfair. SOFT = bet365, William Hill, Betano, Betsson, 1xBet.

**Book row strip**
- Same grid, gap 12px, align center, padding 12px 20px, radius 12px.
- Bg #0E1019, border 1.25px rgba(255,255,255,0.05), pointer.
- Hover: border rgba(106,154,248,0.25), bg #11141F. Tooltip "Open odds movement". Click opens the pop-up (section 6).
- **Book cell:** column, gap 3px.
  - Name: 13.5px/600.
  - Margin: mono 10px #4B5672. Reads "margin 2.4%", or "margin removed" in No-vig mode.
- **Open→now cell:** grid `minmax(0,1fr) auto minmax(0,1fr)`, align center, gap 8px, nowrap.
  - Open: mono 13px #8B96B5, right-aligned.
  - Sparkline (L3, see below).
  - Now: mono 13.5px/700. #E7E9EE, or Up green #3DD68C when it is the highest "now" price for that player across all books (best price; ties all go green).
- **Net cell:** mono 12.5px/700, centred.
  - Value is now − open, 2 decimals, with a sign ("+0.15", "-0.61"; a hyphen, not a minus sign).
  - Colour Up if ≥ 0, else Down.

**Sparkline L3 (soft-area)**
- SVG 64×22, flex-shrink 0, display block.
- Maps the 9 price snapshots: x = 4 + j/8 × 56, y = 18 − (v − min)/(max − min) × 14.
- The line is a Catmull-Rom → cubic Bézier smooth path with tension 1/6. For each segment p1→q: c1 = p1 + (q − p0)/6 and c2 = q − (p3 − p1)/6, clamping the end points.
- Fill: the same path closed down to y = 21, filled in the player colour at opacity 0.12.
- Stroke: player colour, 1.6px, round cap. No dots, no baseline.

### 5 · Footnote
12px #5B6880, line-height 1.5, margin-top 16px: "Sample data: prices, model values and movements are placeholders until the live feed is connected. Match Winner only. Lines step until a book re-posts."

### 6 · Odds movement pop-up
**Backdrop and box**
- Backdrop: fixed full-screen, z-index 60, rgba(4,5,9,0.62), flex-centred, padding 24px. Click closes.
- Box: width 100%, max-width 1080px, max-height calc(100vh − 48px), scrolls inside. Radius 18px, bg #131623, border 1.25px rgba(255,255,255,0.07), shadow 0 30px 80px rgba(0,0,0,0.55). Padding 20px 22px 16px, flex column, gap 14px. Clicks inside do not close.

**Header** (space-between, align start, gap 16px)
- **Left column** (gap 5px):
  - Line 1 (baseline, gap 10px): book name 18px/800, then "SHARP · MARGIN 2.4%" in mono 9.5px, letter-spacing .14em, #5B6880, uppercase. In No-vig mode it reads "… · MARGIN REMOVED".
  - Line 2: "Odds movement · Decimal odds · as quoted · last 72 hours", 12px #5B6880. "as quoted" becomes "no-vig" in No-vig mode.
- **Close ✕:** 32×32, radius 8px, border 1px rgba(255,255,255,0.1), #8B96B5, 14px. Hover: #E7E9EE, border 0.2.

**Player panels**
- Grid `repeat(auto-fit, minmax(360px, 1fr))`, gap 12px. Two panels (A, B).
- Panel: flex column, gap 12px, padding 16px 16px 14px, radius 14px, bg #0E1019, border 1px rgba(255,255,255,0.05).
- **Panel header** (space-between, baseline):
  - Left: an 8×8 **square** (not a dot) in the player colour, then the name at 14px/700, gap 8px.
  - Right (mono, gap 8px): now price 20px/700, then % change from open, 12px/700, Up/Down colour, 1 decimal with sign ("+10.7%").

**Chart** (SVG viewBox 0 0 480 236, width 100%, height auto)
- **Plot box:** PL 42, PR 12, top 12, bottom 190.
- **Y axis:** a round step from [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1], the first where span/step ≤ 4.
  - lo = floor((min − 8% of span)/step) × step; hi = ceil((max + 8% of span)/step) × step.
  - A dashed gridline (4 4, rgba(255,255,255,0.07)) at every step.
  - Label at x = PL − 8, right-aligned: mono 11px #5B6880, 2 decimals.
- **Baseline:** y = 190, 1px rgba(255,255,255,0.12).
- **X axis:** ticks at snapshots 0, 2, 4, 6, 8.
  - Time "HH:MM": mono 11px #8B96B5 at y = 208.
  - Date "23 Sep": Hanken 10.5px #5B6880 at y = 223, shown only when the day changes from the previous tick.
  - The first tick is start-anchored, the last end-anchored, the rest centred.
- **Series:** smooth path (same Bézier as the sparkline).
  - Area to the baseline in the player colour at opacity 0.07.
  - Line 2px, round cap.
  - End dot r 3.5, fill player colour, stroke #0E1019 2px.

**Stat boxes**
- Grid of 3, gap 8px. Box: column, gap 4px, padding 10px 12px, radius 10px, bg #131623, border 1px rgba(255,255,255,0.05).
- Caption: mono 9px/600, letter-spacing .14em, #5B6880 (OPENING / HIGHEST / LOWEST).
- Value: mono 18px/700. OPENING uses the player colour, HIGHEST Up green, LOWEST Down red.
- Stamp: mono 10.5px #5B6880, nowrap, "23 Sep, 20:28" (day · month short, 24h time).

**Book tabs** (bottom row, wraps, gap 6px)
- One pill per book in table order: padding 5px 10px, radius 4px, 11.5px, nowrap.
- Active: 700, #E7E9EE, bg rgba(91,155,255,0.14), border 1px rgba(91,155,255,0.45).
- Inactive: 500, #8B96B5, border 1px rgba(255,255,255,0.1).
- Clicking a tab switches the pop-up to that book.

## Behaviour and state
| State | Default | Effect |
|---|---|---|
| Price mode | Market | No-vig recomputes every price, margin label, sub-line and pop-up header |
| Market | Match Winner | tile highlight only |
| Pop-up book | none | set by clicking a row or a book tab; the ✕ or the backdrop clears it |

- **STEAM** appears when at least 3 of the 7 books moved the same way on the same player (shortened: now < open; drifted: now > open). If several qualify, the largest count wins.
  - Text: "{n} of 7 books {shortened|drifted} on {player}".
  - In the locked build, clicking it has no visible effect: it writes a book-selection state that nothing on this tab reads any more. Keep the chip; wire it to something only if product asks.

## Data contract (live feed replacing the sample)
**Per book:**
- name
- class (sharp / soft)
- margin
- a time-ordered price series per player: at least open and now. The design uses 9 snapshots; any count works for the charts.
- timestamps for the pop-up axis and the stat-box stamps

**Derived values:**
- **Open:** the first snapshot. **Now:** the last.
- **Net:** now − open.
- **% change:** (now − open) / open.
- **Highest / Lowest:** the max / min of the series, each with its timestamp.
- **Best now:** the highest "now" price across books, per player.
- **No-vig price:** 1 / fair probability, where fair probability = (1/price) / Σ(1/price) across the two players. The sample instead derives both modes from one underlying probability: Market = 1 / (p × (1 + margin)), No-vig = 1 / p.

## Not part of the locked design (dead code in `oddsFor`)
`oddsFor` in the source still computes earlier explorations that the template no LONGER renders. Ignore these when porting:
- sparkline variants: `spark`, `sparkL`, and `midG` variants L1 / L2 / L4 / L5 (only L3 is used)
- the implied-probability `chart` and `chips`
- `model`, `fairValue`, edge values
- pop-up chart variants: `mvChart1/2/4/5`, `mvOpts`, M0–M5
- market selector variants K1–K4: `mkOpts`, `mktGroups`, `mktFams`, `famItems`, `mktLines`, and the line pickers
- book-menu / checkbox props: `booksLabel`, `checked`, pill / cell / zebra colours, `MovW` / `MovL`, `aCellBg`

The template reads only: `priceModes`, `mkts`, `hasSteam`, `steam.text`, `onSteamClick`, `tableSub`, `aName`, `bName`, `aColor`, `bColor`, `groups[].head/c/rows`, the row fields (`name`, `marginLbl`, `aOpen`, `aNow`, `aNumColor`, `aSparkS`, `aDelta`, `aDeltaColor`, `onOpen`, and the `b*` twins), the pop-up fields (`mvOpen`, `mvClose`, `mvStop`, `mvBookName`, `mvBookCls`, `mvBookMargin`, `mvSub`, `mvSplit[]`, `mvBookTabs[]`), and `footNote`.
