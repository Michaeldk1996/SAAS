# Match analysis → Market edge tab (handoff for Paperclip)

Locked 2026-09-27. Source of truth: `Match Analysis Market Edge LOCKED.dc.html` (working file `Match Analysis v5.dc.html`; also carried by `Match Analysis Progression v1.dc.html`, which is what the live bundle mounts).

## What's in this folder
- `Market Edge Tab.dc.html` — standalone extract. Open it in a browser (keep `support.js` next to it). Markup and `meFor` logic are copied verbatim from the locked file with the same demo match, so every number matches the locked tab. Only edits: a wrapper `<section>` standing in for the content pane, a minimal `renderVals`, and dead review-only variant branches removed from the template.
- `01-derived-lines.png` — default view (Derived lines, Career).
- `02-price-sensitivity.png` — Match winner view, Price sensitivity card.
- `03-profit-chart.png` — Match winner view, Profit at 1u flat chart.
- `04-band-popup.png` — band pop-up (Sinner, 1.41–1.64, today's band).
- `05-line-popup.png` — line pop-up (Sinner · Wins match).

Renders were captured in a ~914px preview with a DOM renderer; a few small chips (SAMPLE DATA, TODAY'S BAND, the NOT COVERED stat label) wrap in the PNGs only. They are single-line (`white-space` fits) in a real browser — trust the extract, not the PNG, for those.

All values below are exact.

## Context
- **Where it sits:** tab content area of the Match analysis modal (content pane padding 24px 28px). Market edge is the last tab in the left menu (icon path `M4 16l4-5 3 3 5-7 4 5M4 20h16`).
- **Column:** flex column, gap 14px, **max-width 1040px, centred** (`margin:0 auto`).
- **Theme:** on the website the 12a runtime recolour applies on top (Soft ink #10121B page, 1.25px hairlines). Build with the source values and the site's theme mapping.
- **Fonts:** Hanken Grotesk (UI text), IBM Plex Mono (every number, caption, column header, tag). `-webkit-font-smoothing: antialiased`, `box-sizing: border-box`.
- **Clickable (`.seg`):** transitions background, colour, border-colour over .14s ease. Row hover bg rgba(255,255,255,0.03).
- **Pre-match only.** No live data. Everything is sample data today.

## Colour tokens
| Token | Value | Use |
|---|---|---|
| Text | #E7E9EE | primary, player A line, win bar |
| Player B line | #6B7590 | chart line B (fill rgba(107,117,144,0.05)) |
| Player A fill | rgba(231,233,238,0.08) | chart area A |
| Up | #3DD68C | positive units / yield, win square, Covered |
| Down | #E0616F | negative units / yield, loss square |
| Muted 1 | #8B96B5 | captions, card titles, event names, chart labels |
| Muted 2 | #5B6880 | sub-lines, dates, inactive seg text, Needs, Not covered |
| Muted 3 | #4B5672 | column headers, footnotes, stat labels |
| Blue | #5B9BFF | TODAY tag, "In band" header, TODAY'S BAND chip |
| Card | #0E1019 | cards, pop-ups |
| Inner / track | #0C0E16 | segmented track, stat boxes |
| Selection wash | rgba(91,155,255,0.06) bg + inset 1px rgba(91,155,255,0.25) | today's band row |
| Seg on | bg rgba(91,155,255,0.16), border rgba(91,155,255,0.22), #E7E9EE 700 | |
| Seg off | transparent, border transparent, #5B6880 600 | |
| Top-2 line highlight | bg rgba(255,255,255,0.05), border rgba(255,255,255,0.16) | In band cell of the two most covered lines |

Palette rule: players are one colour (white / grey); green and red only mean +/−; blue only for TODAY, links and selection.

## Shared pieces
- **Segmented control:** inline-flex, gap 3px, bg #0C0E16, border 1px rgba(255,255,255,0.06), radius 8px, padding 2px. Item: padding 5px 12px, radius 6px, 12px, nowrap, border 1px (seg on/off above).
- **Card:** bg #0E1019, border 1.25px rgba(255,255,255,0.06), radius 14px, padding 20px 22px, column gap 16px.
- **Card title:** mono 10px/700, letter-spacing .16em, uppercase, #8B96B5.
- **Column header:** mono 9px, letter-spacing .1em, uppercase, #4B5672.
- **Footnote:** 11px #4B5672.
- **Hint (right of card header):** 11.5px #5B6880.

## 1 · Top row
Row, space-between, gap 10px 16px, wrap.
- Left: view segmented **Match winner | Derived lines** (default **Derived lines**).
- Right: "SAMPLE DATA" pill — mono 9.5px/600, .12em, #5B6880, border 1px rgba(255,255,255,0.1), radius 999px, padding 2px 8px.

Below: grid, gap 14px, align start, one column. Match winner shows cards 2 + 3 stacked; Derived lines shows card 4.

## 2 · Price sensitivity card (Match winner)
Header row (baseline, space-between, wrap, gap 10px): left = title "PRICE SENSITIVITY" + scope segmented **Last 52 weeks | Career** (default **Career**) with gap 12px; right = hint "Click a band for every match priced in it".

Players grid: `repeat(auto-fit, minmax(min(460px,100%),1fr))`, gap 16px (side by side on desktop, stacked when narrow). Per player:
- Name 13px/700, padding-bottom 8px.
- Column header row: grid `minmax(92px,1fr) minmax(110px,1.4fr) 52px 52px 56px`, gap 0 8px, padding 0 8px 7px, bottom border 1px rgba(255,255,255,0.09). Headers: Price · Wins · losses · Won (right) · Needs (right) · 1u stake (right).
- Group label "AS FAVOURITE" / "AS UNDERDOG": mono 9px/700, .14em, uppercase, #8B96B5, padding 10px 8px 4px.
- **Band row** (same grid, padding 7px 8px, radius 7px, clickable when n > 0):
  - Price label mono 11.5px/700 nowrap ("1.41 – 1.64"); today's band adds "TODAY" mono 8.5px/700 .1em #5B9BFF (gap 6px).
  - Split bar: flex 1, height 7px, gap 2px; win part width = win % in #E7E9EE (radius 3px 0 0 3px), rest flex 1 rgba(231,233,238,0.25) (radius 0 3px 3px 0). Then W–L "63–31" mono 10px #8B96B5, min-width 48px, right, gap 8px.
  - Won mono 11.5px/700 right ("67%", "—" when n = 0).
  - Needs mono 11px #5B6880 right = round(100 / band mid price).
  - 1u stake mono 11.5px/700 right, green / red / #8B96B5 for "—"; format "+2.0u", "−1.5u" (true minus sign U+2212).
  - Today's band: bg rgba(91,155,255,0.06) + `box-shadow: inset 0 0 0 1px rgba(91,155,255,0.25)`. Others transparent.
- Bands: As favourite 1.01–1.20 · 1.21–1.40 · 1.41–1.64 · 1.65–1.99; As underdog 2.00–2.49 · 2.50–3.49 · 3.50–5.99 · 6.00 +. Mid price = (lo+hi)/2, 6.00 + uses 7.5. Today's band = band containing the player's price today.
- Footnote: "Won = win rate at closing odds in the band. Needs = break-even win rate at the band's average price. 1u stake = profit backing him 1u on every match in the band. Career." (last word = scope label).

## 3 · Profit at 1u flat card (Match winner)
- Header (flex-end, space-between, wrap, gap 12px 20px): title "PROFIT AT 1U FLAT"; legend per player (gap 22px): 16×3 swatch radius 2 in line colour · name 13px/700 · "412 priced" mono 10.5px #5B6880 · end value mono 14px/700 green/red ("+4.3u").
- Chart row (gap 12px): Y-label column 52px × 300px, labels mono 11.5px/500 #8B96B5 right-aligned, vertically centred on grid lines ("+10u", "0", "−10u"; step 1/2/5/10/20 chosen from range: >60→20, >30→10, >12→5, >5→2, else 1). Plot flex 1, height 300px, SVG viewBox 0 0 1000 200, `preserveAspectRatio="none"`, all strokes `vector-effect: non-scaling-stroke`:
  - Loss zone below zero: rect fill rgba(255,255,255,0.014).
  - Horizontal grid rgba(255,255,255,0.06) 1px; vertical ticks rgba(255,255,255,0.045) 1px.
  - Areas (from zero line to series) per player in fill colour; B drawn first, A on top.
  - Break-even line at 0: rgba(255,255,255,0.40), 1.5px.
  - Lines: A #E7E9EE 2.6px, B #6B7590 2px, round joins/caps.
  - "BREAK EVEN" chip: absolute left 8px on the zero line, padding 2px 7px, radius 5px, bg #0E1019, mono 9.5px/600 .14em uppercase #8B96B5.
  - End dots: 9px circle in line colour at right edge (right −4.5px), `box-shadow: 0 0 0 3px #0E1019`.
  - Y range = min/max of both series and 0, padded by 12% of range + 0.5.
- X labels row: margin −6px 0 0 64px, height 16px, mono 11.5px #8B96B5, six labels evenly spaced (first left-aligned, last right-aligned, others centred). Career "2016 2018 2020 2022 2024 2026"; Last 52 weeks "Oct Dec Feb Apr Jun Sep". Each line spans the full width over that player's own matches.
- Footnote: "Cumulative units, flat 1u at closing odds on every priced match, oldest to newest; each line spans that player's own matches. The bright rule is break even. Career."

## 4 · Derived lines card (Derived lines view)
Header: title "DERIVED LINES AT TODAY'S PRICE" + the same scope segmented; hint "Click a line for the matches behind it".

Players grid as in section 2. Per player:
- Header row (baseline, space-between, padding-bottom 8px): name 13px/700; "In band = 1.41 – 1.64 · n=94" mono 10px #5B6880.
- Column header: grid `minmax(0,1.1fr) 104px 104px 44px`, gap 0 10px, padding 0 10px 7px, bottom border 1px rgba(255,255,255,0.09). Line · All (right) · **In band (right, #5B9BFF)** · Diff (right).
- **Line row** (same grid, padding 7px 10px, bottom border 1px rgba(255,255,255,0.05), radius 6px, clickable):
  - Label 12.5px/600.
  - All: "287/412 · 70%" mono 11px #5B6880, right, nowrap.
  - In band: "63/94 · 67%" mono 12px/700, justify-self end, padding 3px 8px, radius 6px, border 1px; top-2 most covered lines (by in-band rate) get the highlight bg/border, the rest transparent. When in-band n < 5: "— · n=3" and no diff.
  - Diff: mono 11px/700 right, in-band % − all % as "+5" / "−3" / "±0", green / red / #8B96B5.
- Lines — favourite (price < 2.00): Wins match · Wins set 1 · Wins 2–0 · "[Surname] −3.5 games" (game diff ≥ 4) · Over 22.5 games · Tiebreak in match (any 7-6/6-7 set). Underdog: Wins match · Wins set 1 · Wins a set · "[Surname] +3.5 games" (game diff ≥ −3) · Over 22.5 games · Tiebreak in match.
- Coverage is computed from set scores (Bo3), not settled line markets, so no yield.
- Footnote: "Coverage from set scores, not settled line markets, so no yield is shown. In band = matches priced in the same band as today. Highlighted = the two most covered lines in today's band. Career."

## 5 · Band pop-up (click a band row)
- Overlay: fixed inset 0, z-index 85, bg rgba(3,5,9,0.72), flex start-centred, padding 40px 24px, scrolls. Click outside closes.
- Box: max-width 860px, bg #0E1019, border 1.25px rgba(255,255,255,0.08), radius 14px, padding 20px 22px 14px, column gap 16px.
- Header: title "J. Sinner · priced 1.41 – 1.64" 17px/800, −0.01em; today's band adds chip "TODAY'S BAND" mono 9px/700 .12em #5B9BFF, border 1px rgba(91,155,255,0.35), radius 999px, padding 2px 8px (gap 10px). Sub "As favourite · Career · closing odds · sample data" mono 10.5px #5B6880. ✕ button 30×30, radius 8px, border 1px rgba(255,255,255,0.12), 13px #8B96B5; hover #E7E9EE / border rgba(255,255,255,0.22).
- Stat boxes: grid 5 cols, gap 8px; box bg #0C0E16, border 1px rgba(255,255,255,0.05), radius 10px, padding 10px 12px, gap 4px; label = column-header style; value mono 16px/700 nowrap. Record "W63–L31" white · Won "67.0%" white · Needs "65.6%" #8B96B5 · Yield "+2.1%" green/red · At 1u flat "+2.0u" green/red.
- Table (bleeds to box edges: margin 0 −22px): header row grid `64px 10px minmax(0,1.3fr) minmax(0,1fr) 34px minmax(0,0.9fr) 46px 42px 56px`, gap 0 8px, padding 7px 28px 6px, top border 1px rgba(255,255,255,0.06), bottom 1px rgba(255,255,255,0.09): Date · (square) · Opponent · Event · Rd · Score · Price (r) · Opp (r) · P&L (r).
- Row (wrapper padding 0 22px; row padding 6px, radius 6px, bottom border 1px rgba(255,255,255,0.03), clickable): date "21.12.25" mono 10.5px #5B6880 · 8×8 square radius 2px green/red · opponent 12px ellipsis · event 11.5px #8B96B5 ellipsis · round mono 10px #5B6880 · score "5-7 6-2 3-6" mono 10.5px #8B96B5 · price mono 11px/700 right · opp price mono 10.5px #5B6880 right · P&L mono 11px/700 right green/red ("+0.47u", "−1.00u"). Every match in the band, newest first. Selected row bg rgba(91,155,255,0.1).
- Footnote: "Every match with a closing price in this band, newest first. Flat 1u stake. Click a match for its stats."

## 6 · Line pop-up (click a line row)
Same overlay and box as section 5.
- Header: "J. Sinner · Wins match" 17px/800; sub "All priced matches · Career · Bo3 · sample data" (in-band: "Priced 1.41 – 1.64 (today's band) · …"); ✕.
- Row (space-between, wrap, gap 10px): segmented **All matches | In today's band** (default All, resets to All each time a line is opened); three stat boxes (gap 8px, min-width 84px, padding 8px 12px, gap 3px, value mono 15px/700): Covered "287 of 412" · Rate "70%" · Not covered "125" (#8B96B5).
- Table: grid `64px 10px minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.9fr) 46px 96px`: Date · square · Opponent · Event · Score · Price (r) · Line (r). Row styles as section 5; last cell text only: "Covered" mono 10.5px/700 green, "Not covered" #5B6880. No row tint.
- Footnote: "Coverage is read from set scores, not a settled line market. Square = match result. Click a match for its stats."

## 7 · Interactions / state
| State key | Values | Default |
|---|---|---|
| `meView` | `winner` / `lines` | `lines` |
| `meScope` | `l52` / `career` (shared by all cards and pop-ups) | `career` |
| `meBand` | `a0`…`b7` (player + band index) or null | null |
| `meLine` | `a|0`…`b|5` or null | null |
| `meLineScope` | `all` / `band` | `all` |
| `maFormSheet` | match id | — |

- Match rows in both pop-ups open the shared, locked match stats sheet (z-index 90, above the pop-up) — same sheet as Form / H2H / Playing style. Build it from `Match Analysis Match Stats LOCKED.dc.html`. In the extract the click only sets `maFormSheet` (row highlight), the sheet itself is not included.
- Bands with n = 0 are not clickable.
- Switching scope re-computes every figure, the chart and the X labels.

## 8 · Data (for the real feed)
Per player, per scope: priced matches with closing price (Pinnacle), opponent closing price, date, event, round, set scores, result. From that:
- Band = bucket of the player's closing price. W–L, Won = W/n, Needs = 100/mid, Yield = Σ P&L / n, 1u stake = Σ P&L (win = price − 1, loss = −1).
- Profit chart = cumulative P&L oldest → newest.
- Line coverage = share of matches where the set-score rule holds; In band = same, restricted to today's band.
Sample W–L in the mock is re-derived from target band yields so records and yields agree; opponents / events are generated.

## 9 · Ignore in `meFor`
Leftover review scaffolding that the locked template never reads: `palTabs`, `layTabs`, `lvTabs`, `pvTabs`, `pop.bgTabs`, `pop.pvTabs`, `pop.cum`, `pop.hist`, `pop.groups`, `linePop.cvTabs`, `today`, `roles`, `linePairs`, `book`. `PK = 'a'` (One colour palette) and `LY = 'a'` (stacked layout) are fixed.
