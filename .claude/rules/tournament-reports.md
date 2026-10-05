# Tournaments → Reports (Round comparison, Player progression, Head-to-head)

Applies to the Reports section of the Tournaments page (`tourx*` in `bsp-consult-dashboard.html`), which reads
`tournament-progression.json` (rebuilt by `bsp-pipeline.js` `buildTournamentProgression` on every pipeline tick, not
committed). The design rules for the view (grey ramp, metric bars, card order) are `design-export/README.md` §Tournaments.

## Round comparison
- **A selected round lists every player with a box score in that round: winners and losers** (founder, TEN-386,
  2026-10-05: "I expected the 4 QF losers (Zverev, Rublev, Khachanov, Cerundolo) to show under Round comparison → QF").
  This replaces the July winners-only rule (314c8298). "All rounds" = the latest round with any box score.
  **Test:** Beijing 2026 QF shows 8 rows (4 W, 4 L); `tools/test-ten386-round-comparison.js`.
- **Each row carries the round's outcome as a W/L letter** (Mono 11px 700, `--pos` W / `--neg` L, the Player Profile's
  result marker; foundation.md allows green/red for result markers). The name is never dimmed for losing.
  **Test:** the letter is the first element of the row's name cell; the surname stays `--text`.
- **The outcome is the draw-structure `maxWonIdx`** (`tourxBuildTournament`: round labels + the event_winner-derived
  `eliminated` flag), never `resultDisplay` (first-player oriented) and never "does the next round have a box score".
  A walkover or stat-less next match must leave a won round as W. *Exception:* when `eliminated` is unknown (null), the
  player's latest round prints no letter; earlier rounds read W.
  **Test:** `test-ten386-round-comparison.js` (walkover and unknown-flag fixtures).
- *Known limit:* when a player's LOSING match has no stats, the pipeline drops it, so the round before it reads L.
