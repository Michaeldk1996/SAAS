# Match Stats tab — dev handoff spec (Stennisfy, Match Analysis modal)

Everything a developer (or Claude Code) needs to rebuild the Match Stats tab exactly. All styles are inline in the source; values below are exact.

## Fonts
- UI text: 'Hanken Grotesk', sans-serif (body default)
- All numerals / scores / point tokens: 'IBM Plex Mono', monospace

## Color tokens
| Token | Value | Used for |
|---|---|---|
| page/card bg | `#0a0d14` | header card, section title bands, segmented-control track (`#0a0d13` on the two control tracks) |
| hairline | `rgba(255,255,255,0.09)` | all borders |
| hairline soft | `rgba(255,255,255,0.07)` | game row separators |
| hairline softer | `rgba(255,255,255,0.05)` | tiebreak row separators |
| text primary | `#e7e9ee` | scores, winner name, player B value color, B bar fill |
| text muted | `#5b6880` | labels, date, per-set line, FINISHED, loser name, sub-fractions |
| text faint | `#4b5672` | section titles, stat labels, serve icon, N/A values |
| comma faint | `#4a5261` | commas between point tokens |
| player A accent | `#6aaeff` | A legend name, A value color, A bar fill |
| legend dot A | `#5b9bff` (`aColor`) / dot B `#6aaeff` (`bColor`) | 9px legend dots |
| accent selected | text `#e7e9ee`, bg `rgba(91,155,255,0.22)`, border `rgba(91,155,255,0.45)` | active segmented button |
| negative (LOST SERVE / BP) | text `#e0616f`, bg `rgba(224,97,111,0.15)`, border `rgba(224,97,111,0.3)` | match-event badges (deliberate exception: red = match event here, not data quality) |
| SP badge | text `#e7e9ee`, bg `rgba(255,255,255,0.04)`, border `rgba(255,255,255,0.09)` | set-point badge (neutral, never red) |
| bar track | `rgba(255,255,255,0.09)` | stat bar background |
| avatar A | bg `rgba(91,155,255,0.14)`, initials `#6aaeff` |
| avatar B | bg `rgba(123,145,180,0.14)`, initials `#5b6880` |
| empty-state icon chip | bg `rgba(91,155,255,0.1)`, border `rgba(91,155,255,0.22)`, icon `#5b9bff` |

## Layout
Content column: `max-width:720px; margin:0 auto`.

### 1. Empty state (match not completed)
Centered column, min-height 340px, gap 12px: 52px chip (radius 14) with bar-chart icon; "Match not played yet" 17px/700; sub-copy 13px `#5b6880`, max-width 340px, line-height 1.55.

### 2. Score header (completed only) — Flashscore-style
Grid `1fr auto 1fr`, gap 16, bg `#0a0d14`, border hairline, radius 12, padding `18px 22px 16px`, margin-bottom 16.
- Side columns (centered, min-width 0): 52px circle avatar (initials 16px/700, colors above) + player name 13.5px/700, ellipsized, clickable → player profile. Name color: winner `#e7e9ee`, loser `#5b6880`.
- Center column (gap 7, all nowrap): date 10.5px `#5b6880` ls .06em → sets score Mono 36px/700 ls .06em `#e7e9ee` (e.g. `2–1`, en dash) → per-set line Mono 12px/700 ls .08em `#5b6880` (e.g. `7-6, 3-6, 6-4`, hyphens+commas) → `FINISHED` 9.5px uppercase ls .16em `#5b6880`.

### 3. View toggle
Centered pill track: inline-flex, gap 4, bg `#0a0d13`, hairline border, radius 8, padding 3. Buttons: 11.5px, padding `6px 12px`, radius 6. Two views only: **Stats** (default) · **Point by point**. (Summary view was removed — no match-time data in API.) Active = accent-selected colors, weight 700; inactive = `#5b6880`/transparent, weight 600.

### 4. Scope filter
Same track style (padding 2; buttons 10.5px, padding `4px 10px`). Stats view: `Match | Set 1..N` (Match default). Point-by-point view: `Set 1..N` only, no Match option — if scope was "match", coerce to Set 1.

### 5. Legend row
Space-between, margin-bottom 4: left = 9px dot `#5b9bff` + A name 14px/700 `#6aaeff`; right = B name 14px/700 `#e7e9ee` + 9px dot `#6aaeff`.

### 6. Stats view
Caption "STAT COMPARISON" 10px uppercase ls .06em `#4b5672`, centered, margin-bottom 14.
Section title band: bg `#0a0d14`, hairline border, radius 9, centered 10px ls .06em `#4b5672`, padding 10, margin `20px 0 16px`. Rows stacked gap 18.

Sections & rows (A value left, label center, B value right):
- SERVICE: Aces, Double faults, 1st serve %, 1st serve points won, 2nd serve points won, Break points saved
- RETURN: 1st return points won, 2nd return points won, Break points converted
- POINTS: Winners, Unforced errors, Total points won

Row anatomy: value Mono 14px/700 (A `#6aaeff`, B `#e7e9ee`; min-width 56px, B right-aligned); percentage rows show fraction sub-line Mono 10.5px `#5b6880` e.g. `(43/51)`; label 11px uppercase ls .06em `#4b5672` centered.
Bar: height 7, two halves with 2px gap, track `rgba(255,255,255,0.09)`; left half radius `4 0 0 4`, fill `#6aaeff` grows from center (justify-content:flex-end); right half radius `0 4 4 0`, fill `#e7e9ee` from center. Widths = each player's share of A+B in %. N/A rows (`—` in `#4b5672`) render no bar.

### 7. Point-by-point view
Per selected set:
- Set band: bg `#0a0d14`, hairline border, radius 9, Mono 11px ls .16em `#e7e9ee`, padding 11, margin `16px 0 6px`, text `POINT BY POINT · SET N`.
- Game row: padding `20px 4px`, bottom border `rgba(255,255,255,0.07)`.
  - Score line: grid `1fr auto 1fr`, gap 12. Center: running games `gA · gB` Mono 20px/700; game-winner side `#e7e9ee`, other `#4b5672`; middle dot `#5b6880` 16px. Server side shows 13px tennis-ball icon stroke `#4b5672` (circle r9 + two arcs). If server lost the game, a `LOST SERVE` badge on their side: Mono 9.5px/700 ls .08em, negative colors, radius 5, padding `3px 8px`.
  - Point tokens: centered wrapping row, gap 5; tokens Mono 12.5px `#e7e9ee` like `15:0`, `40:A`, separated by commas `#4a5261`. Break point → `BP` badge 8.5px/700 negative colors, radius 4, padding `1px 5px`. Set point on last token → `SP` badge, SP colors.
- Tiebreak (7-6 sets): band like set band but 10px `#5b6880`, text `Tiebreak · Set N`, margin `12px 0 4px`. Rows: grid `1fr auto 1fr`, padding `11px 4px`, border-bottom `rgba(255,255,255,0.05)`; center `a · b` Mono 18px/700 (point-winner `#e7e9ee`, other `#4b5672`); serve icon switches per tiebreak serving order (point 1 = first server, then every 2 points); `LOST SERVE` on mini-break, `SP` (spA/spB) when a player is one point from the set.

## Data contract (replace seeded generators wholesale)
- Header: player names, initials, winner flag, date string, per-set scores `[{a,b}...]`.
- Stats per scope (match + each set): the 12 stat rows above; counts, percentages and fractions `(won/total)`.
- Point by point: per set, ordered games with server, running game score, and point-token sequence with BP/SP flags; tiebreak point log `{a, b, server, lostServe, sp}` per point.
- State: `view` ('stats'|'points', default 'stats'), `scope` ('match'|'setN', default 'match'; coerce 'match'→'set1' when view='points').

---

## Operator corrections (founder ruling, 2026-08-01)

The body above is the founder's handoff spec, saved verbatim. The founder issued four
corrections to it in the same message; where a correction below disagrees with a value in the
body, **the correction wins**. Precedence overall: on a *measurable* value (size/weight/colour/
padding/radius/gap) the `computed-styles.json` extraction is authority; on *structure / anatomy /
state / data-contract* the spec body is source.

1. **Legend dots.** Body says dot A `#5b9bff`, dot B `#6aaeff` — wrong (paints B in A's colour).
   **Correct: dot A `#6aaeff`, dot B `#e7e9ee`**, matching the names and bar fills. (§5 and the
   "legend dot" token row are superseded by this.)
2. **Avatars are photos, not initials.** Ignore the avatar background/initials colours in the
   token table. Use real player photos; initials are a fallback only where no photo exists, taking
   A `#6aaeff` / B `#e7e9ee`.
3. **Winner/loser tone is a scoped exception.** The header names (winner `#e7e9ee` / loser
   `#5b6880`) and game scores (winner / other) mark outcome by **tone, not hue**; identity hue is
   unaffected. Recorded in the CLAUDE.md rulings ledger (Stat display line).
4. **`#4a5261`** (comma between point tokens) is a **named palette token** — `--mc-comma-faint` —
   not a loose literal. (`#0a0d13`, the control track, is likewise named `--mc-track`.)

Resolved flag rulings folded into the build: §4 control-track capsule restored on **both** control
rows; §9 group-header recessed box kept (modal-scoped); §7 label drops the `· SET N` suffix; the
point-by-point set/tiebreak divider bands are unified onto the group-header box treatment.
