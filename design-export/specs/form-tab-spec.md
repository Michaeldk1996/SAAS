# Form tab — dev handoff spec (Stennisfy, Match Analysis modal)

Handoff for Claude Code: rebuild the Form tab of the Match Analysis modal exactly. All styling is inline; values below are exact. Dark theme.

## Fonts
- UI text: 'Hanken Grotesk', sans-serif
- All numerals (scores, percentages, dates, W-L): 'IBM Plex Mono', monospace

## Color tokens
| Token | Value | Used for |
|---|---|---|
| card bg | `#0a0d14` | recent-matches card, form score card base |
| group header bg | `#11161f` | tournament header rows |
| hairline | `rgba(255,255,255,0.09)` | card borders, sets/games divider |
| row hairline | `rgba(255,255,255,0.04)` | match row separators, group header top border |
| text primary | `#e7e9ee` | winner name, winner sets number, winning game scores, W-L |
| text soft | `#dfe3ea` | opponent name when opponent won |
| text dim | `#8b94a8` | losing player's name |
| text muted | `#5b6880` | labels, loser sets number, losing game scores, captions |
| text faint | `#4b5672` | dates, "← most recent" |
| player A accent | `#6aaeff` / `#5b9bff` | player identity, chevrons, links |
| win | `#3dd68c`, pill bg `rgba(61,214,140,0.14)` | W pill, win pills in last-10 strip |
| loss | `#e0616f`, pill bg `rgba(224,97,111,0.14)` | L pill, loss pills |

## Structure
Two-column grid (`1fr 1fr`, gap 24), one panel per player. Each panel top-to-bottom:

### 1. Form score card
Radius 16, padding `20px 22px`, per-player bg/border (player A gets a subtle accent tint card, B neutral).
- Player name 15px/700 (links to player profile).
- Row: win rate `70%` Mono 40px/800 + caption "LAST 10 WIN RATE" 11px uppercase ls .12em `#5b6880`; right-aligned W-L `7-3` Mono 22px/700 + "last 10 · W-L" 11px `#5b6880`.
- Last-10 strip: flex gap 4, each pill flex:1 height 7 radius 4, win `#3dd68c` / loss `#e0616f` (older pills at reduced opacity). Caption "← most recent" 9px `#4b5672`.

### 2. "RECENT MATCHES" header row
Space-between, margin `18px 0 10px`: label 11px uppercase ls .14em `#5b6880`; right "40 on record" 11px `#5b6880`.

### 3. Recent matches card
Border hairline, radius 14, bg `#0a0d14`, overflow hidden. Contents grouped by consecutive tournament:

**Tournament header row**: bg `#11161f`, border-top row-hairline, padding `11px 16px`, flex gap 10: tournament name 12.5px/700 · surface 11px/500 in surface color (Clay `#d08a5a`-family, Hard blue, Grass green — use existing SC map) · right-aligned group record `2-1` Mono 12px `#5b6880`.

**Match row** (Flashscore-style, the core of this handoff): clickable, padding `10px 16px 10px 14px`, border-top row-hairline, flex gap 11:
- Date `21.07` Mono 11px `#4b5672`, fixed 38px.
- Two-line score grid: `grid-template-columns: minmax(0,1fr) 20px 1px auto`, rows auto auto, column-gap 8, row-gap 7, align center. Line 1 = opponent, line 2 = player. NO avatars.
  - Name 12.5px, ellipsized. Winner of the match: weight 700, color `#e7e9ee` (player) / `#dfe3ea` (opponent). Loser: weight 400, color `#8b94a8`.
  - Sets-won number: centered in the fixed 20px column, Mono 13px/800. Winner `#e7e9ee`, loser `#5b6880`.
  - Divider: 1px column spanning both rows (`grid-row:1/3`), `rgba(255,255,255,0.09)`.
  - Game scores: flex run of fixed 16px-wide centered cells, Mono 12px/700; set winner's games `#e7e9ee`, loser's `#5b6880`. Tiebreak games may carry a superscript (9px).
- **Column alignment rule (critical)**: pad every row's game cells to the list's MAX set count with empty transparent cells so the sets number, divider, and game-score start hold one fixed x-position down the whole list; two-set matches leave the third column empty. Both lines in a row share identical columns.
- W/L pill: 22×22, radius 6, 11px/800; W `#3dd68c` on `rgba(61,214,140,0.14)`, L `#e0616f` on `rgba(224,97,111,0.14)`.
- Chevron `›` 13px `#5b9bff`, 14px wide; `▾` when expanded.

### 4. Expanded match detail (row click)
Panel bg `#090d15`, border-top `rgba(255,255,255,0.05)`, padding 16. Header: headline `Winner def. Loser · Tournament` Mono 9px uppercase ls .12em `#5b6880`, right per-set line `7-6, 3-6, 6-4` Mono 12px `#e7e9ee`.
Inside: mini match-detail with a centered view toggle — **Stats | Point by point only (no Summary view — removed product-wide, no match-duration data in API)**; scope pills (Match | Set N for stats; Set N only for point-by-point); stat bar rows and point-by-point rendering follow the Match Stats tab spec (`match-stats-tab-spec.md`) — same colors, same segmented-control styles (active: `#e7e9ee` on `rgba(91,155,255,0.22)` border `rgba(91,155,255,0.45)`; inactive `#5b6880`).

### 5. Show more
If >5 tournament groups' worth of rows: footer link "Show N more matches" / "Show fewer", 12.5px/600 `#5b9bff`.

## Info banner (top of tab, above both panels)
"Form reflects who's playing better right now — the score, W-L and pills cover each player's last 10 completed matches (fewer if less history exists). The list below goes back further, most recent first." 13px `#5b6880`, hairline card.

## Data contract (replace seeded generators)
Per player: name, last-10 win rate %, W-L, last-10 results (win/loss, most recent first), total matches on record; match list (most recent first): date (DD.MM), tournament, surface, opponent, won flag, per-set games for both players (+ tiebreak scores), and per-match detail (stat rows per scope + point-by-point log) when available.
State: expanded match id (one at a time), show-all flag per panel, per-match view/scope selections.
