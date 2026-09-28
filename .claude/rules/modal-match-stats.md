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
  B `#e7e9ee`" — no longer apply. Colours come from the modal token file (D1), and both players are neutral on
  every tab: player A white/primary, player B grey; blue is only links, TODAY and selection (D4). The header
  names therefore differ by **identity** (A primary, B grey), still never by outcome.
  **Test:** the two score-header names never change tone with the result; the only permitted tone-marked
  outcome is the point-log game/tiebreak score; a player's identity colour must never change with the result.

See also: CLAUDE.md "Match-detail view toggle" (Stats | Point by point, no Summary);
`modal-form-h2h.md` "Match stats popup and every match-detail panel" (set control, rates with counts, bars,
Serve/Return rating, point by point follows the header); `modal-analysis.md` "Match stats sheet — every tab".
