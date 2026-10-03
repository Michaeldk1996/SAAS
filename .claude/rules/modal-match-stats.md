# Match analysis — Match Stats tab: founder rulings

Applies to the Match analysis modal's **Match Stats** tab in `bsp-consult-dashboard.html` (score header,
stat ladder, point-by-point log). Dev spec: `design-export/specs/match-stats-tab-spec.md`.
Restored from CLAUDE.md before 011e3e20 (2026-09-21 trim); TEN-312 N13, founder-approved 2026-09-28.
Where this file conflicts with `modal-analysis.md` (TEN-312, 2026-09-28), that file wins; the conflicts
found at restore time are marked inline.

- **Match Stats tone rules — the only outcome mark is tone in the point log (founder ruling 2026-08-01,
  narrowed 2026-08-01).** Exception to "never use hue to indicate *who leads or won* between two players"
  (CLAUDE.md non-negotiables): on the Match Stats tab, **tone — not hue — may mark outcome in the point-log
  game/tiebreak scores only** (winner primary tone / other a dimmer grey tone) — grey tone-levels signalling
  outcome, permitted because *hue carries meaning, tone carries hierarchy*.
  **The score-header names are NOT an outcome mark** — the earlier winner / loser dim was reversed by founder
  ruling (the render never dimmed the loser). Outcome on the score header rides on the score panel itself
  (sets/per-set line), never on the two names. **Identity is unaffected by the result:** a player's identity
  colour in the legend, values and bar fills is fixed by name order, regardless of who won.
  *Superseded colours (TEN-312 D1 + D4, 2026-09-28):* the old values — point-log winner `#e7e9ee` / other
  `#4b5672`; "both score-header names `#e7e9ee`, winner and loser alike"; "player A stays `#6aaeff` and player
  B `#e7e9ee`" — no longer apply. Colours come from `tokens.css` (TEN-376), and both players are neutral on
  every tab: player A white/primary, player B grey; blue is only links, TODAY and selection (D4). The header
  names therefore differ by **identity** (A primary, B grey), still never by outcome.
  **Test:** the two score-header names never change tone with the result; the only permitted tone-marked
  outcome is the point-log game/tiebreak score; a player's identity colour must never change with the result.

## Match Stats tab build (TEN-338, TEN-312 design file `matchStatsFor` / template L2078–2200)
- **Completed / suspended match:** THE shared sheet inline (`maMsSheetHtml` → `fhSheetInit(e, r, 'tab')`), scopes Match ·
  Key stats · Set 1…N · Point by point, opens on Key stats. Header meta = four parts (tournament · surface · round · date),
  a dash where one is missing; surface through `fhSurfName`.
- **Uncompleted match:** the file's block (DF L2079: chart tile, "Match not played yet", the file's line), centred in the
  whole pane. **Live match:** the same block titled "Match in progress" — DESIGN GAP G15 (the file draws no live state).
- **Points won** carries the file's "Winners / unforced errors" row (DF L4272); Key stats reads the same cell.
- **D2 on every sheet %** (`fhGateCell`, n = the rate's own count): n 1–4 → the count ("2/3"), no % and no bar; n 5–9 →
  grey value + bar, "small sample" on hover, footnote `MA_SHEET_GATE_NOTE` under the sheet; 10+ as is. Counts and ratios
  (aces, W/UE, DR, ratings) are not rates and are not gated.
- **Point by point = the file's shape** (`fhPbpSetModel` + `fhSheetPbpHtml`, DF L2150–2195): set tabs always drawn, caption
  "SET n · a-b", one row per game (server ball, LOST SERVE when the server lost the game, running score toned by the game's
  winner, the point sequence with BP), a 7-6 set's "Tiebreak · Set n" strip and one row per point. **SP** whenever the
  leader can win the set on the next point, past 6-6 too; a 10-point tiebreak is recognised from its own sequence.
  **MP on every match point** (founder Q6, 2026-09-29, TEN-312 bbe5c072; supersedes the file's SP-everywhere): a set point
  whose set would give its player the sets needed to win the match (Bo3: 2, Bo5: 3), in a game or any tiebreak incl. a
  match tiebreak; every other set point stays SP; where the point winner can't be decided (G16), no tag. **Test:** fixed
  logs — final-set game MP, final-set tiebreak MP, Bo5 set-4 MP at 2–1, set-1 SP stays SP (mutation: drop the
  sets-needed check → set-1 SP reads MP) — built on TEN-349. Tiebreak points come from the pbp
  shards the guarded cache feeds (TEN-318). The old class-based point log stays for the other match-detail panels only.
- **Bars — design exception:** the 2026-09-24 bar rule (`fhStatBarWidth`), not the file's share-of-total; W/UE and DR are
  numbers only. Reported as ruled, never as a divergence.
- **Shared helpers (DoD 8):** the tab draws no match rows and no tooltip. The old tab sheet (`buildMatchStatsSheet`,
  `msheet*`, `buildMsScoreHead`, the Stats | Point by point sub-tabs) and its CSS are deleted.
- **Test:** `test-ten338-match-stats.mjs` (+ `tools/test-ten338-mutants.js`, 17 mutants). Pixel/structure harness (manual):
  `tools/ten338-match-stats-capture.mjs` (`--theme source`, `--ruled-off`, `--real <dir>` — the design fed OUR model's
  output for real matches) + `tools/ten312-pixel-diff.py --regions` + `tools/ten330-form-structure.py`.

See also: CLAUDE.md "Match-detail view toggle" (Stats | Point by point, no Summary);
`modal-form-h2h.md` "Match stats popup and every match-detail panel" (set control, rates with counts, bars,
Serve/Return rating, point by point follows the header); `modal-analysis.md` "Match stats sheet — every tab".
