# Tournaments → Reports (Round comparison, Player progression, Head-to-head) — rebuild, founder 2026-11-15

Applies to `tournaments-reports.js` (`window.TTReports`) and the page helpers it reads from `bsp-consult-dashboard.html`
(`tourxBuildTournament`, `TOURX_METRICS`, `tourxRoundOutcome`, `tourxPlayerScore`, `tourxSetsToWin`, `tourxReportYear`).
Design = the handoff's `Tournament Reports.dc.html`, `isReports` section only (the `isOverview` section is dead); the
tab-wide rulings (design wins, colours via `--tt-*`, every figure ours or a dash, n on hover, city keys, night only) are in
`tournaments.md`. Rationale: `BUILD-NOTES.md` "2026-11-15 — Tournaments tab rebuild". **Test (whole file):**
`tools/test-tt-reports.mjs` executes the shipped module on a real-data fixture (Stockholm 2026), with mutants.

## Layout (the design)
- **One filter card** (rows: Tournament with the "?" help at its right end · Report · Quarter · Reached (Player progression)
  · Round (Round comparison, default QF) / Rounds through (Player progression, default the last round) · Players (chips
  "Q1" + surname + ✕, "+ Add player", "Show all") · Metrics (ten pills + "All metrics"). Head-to-head: Tournament · Report ·
  Players (two pickers + "Swap"), no Quarter and no round scope. Changing the Quarter resets the player picks. **No title or
  helper sentence** between the filter card and the report cards. **Test:** "RC filter rows", "PP filter rows", "H2H filter
  rows", "the \"?\" sits at the end of the Tournament row", "no title / helper sentence".
- **Round comparison:** one card per stat; inside, one block per quarter ("Quarter n"), rows ranked inside the quarter
  (rank restarts at 1). The best of the round = the blue bar (`--tt-blue`), the quarter leader white 36%, the rest white 16%;
  the dashed line = the others' average. **Player progression:** one heat matrix per stat, rows grouped by quarter and
  ranked by the player's average; the best cell of each round highlighted; the Avg column never prints "(n)"; heat cells drop
  the "%" (the Avg keeps it). **Head-to-head:** whole tournament; default pair = the champion first ("Champion" in the
  picker); one row per stat with the better figure white 800 and the other muted 500 (tab exception, `tournaments.md`) and
  one line leaning from the centre toward the better player (blue = player one, `--text` = player two). **Test:** "exactly
  one blue (best of round) bar per RC card", "quarters run 1 → 4", "the rank restarts at 1", "heat Avg never prints (n)",
  "% heat cells drop the %", "H2H default pair".
- **Match sheet** (a bar or a heat cell): "Player v Opponent", meta "City year · round · surface · …", the ten stats for both
  players, a missing figure "—". **Test:** "sheet".

## Data
- **Source:** `tournament-progression.json` through `tourxBuildTournament` (per-round metrics, opponents, results) plus its
  `matches[]` (winner, set scores, point counts). **No box score = no round:** a round whose metrics carry no figure is
  dropped and a player with no such round is left out (no estimated rounds, no name without data). **Test:**
  `tools/test-ten386-round-comparison.js` "a player whose rounds carry no box score is left out".
- **The ten stats, in this order:** Serve rating · 1st serve % · 1st serve points won · 2nd serve points won · Return rating
  · Dominance ratio · Pressure points · Winners (per point) · Unforced errors (per point, "lower is better") · Winners /
  unforced errors ratio. Ratings print whole, % one decimal, ratios and per-point figures two decimals — **Winners and
  unforced errors are per point (0.19), never a %**. Dominance is exact from the match point counts. A match with 0 break
  points faced or chances: Pressure points "—"; 0 break-point chances: Return rating "—". **Test:** "Winners are per point",
  "pct figures carry one decimal", "Dominance is exact", "a 0-break-point match: Pressure points is a dash".
- **Quarters only from the official draw:** `WueSheet.playerQuarter(WueSheet.cachedDraw(name), playerKey)` (`draws.json`
  positions). **A player with no draw quarter goes in a "Quarter —" group** (chip "Q—"), never a guessed quarter (no
  QMAP, no seeding, no finishing order); with no posted draw every group is "Quarter —" and the four Quarter pills carry a
  dash. **Test:** `tools/test-tt-reports.mjs` "no draw → every group is Quarter —" + "quarters come only from
  WueSheet.playerQuarter"; `tools/test-reports-quarters.js`.
- **Quarter pill = the quarter's player who won his quarter-final**; a dash while it is unplayed. **Test:** "Quarter 1 pill",
  "an unplayed quarter-final → the Quarter pill is a dash".
- **Every player of the round is ranked inside his quarter, losers included** (founder 2026-11-15; reverses the 2026-10-24
  winners-only ruling). A player missing that figure sits last, unranked. **Test:** "QF lists every player with a QF box
  score, losers included".
- **Round avg / Field avg = the mean of the rows shown**, its n in the hover (founder 2026-11-15, the design). **Test:**
  "Round avg = mean of the rows shown", "Field avg row present".
- **Reached / Rounds through (Player progression):** Reached = Any round + the last three rounds, keeping only players who
  reached it; Rounds through drops the later columns. Default = every player, rounds through the final. **Test:** "Reached
  pills", "Reached SF keeps only players who reached the SF", "Rounds through QF drops the SF / F columns", "PP default";
  `tools/test-progression-seed.js`.
- **Who won a round = the draw structure** (`tourxRoundOutcome`: round labels + the `eliminated` flag), never
  `resultDisplay`. **Set scores are oriented to the player** only when the outcome is known and the match completed (higher
  count = sets to win: 3 at a Grand Slam, else 2; an R128 ladder of unknown tier orients nothing); a retirement prints the
  outcome word with no score. **Test:** `tools/test-progression-seed.js`, `tools/test-ten386-round-comparison.js` "score
  orientation" + "an R128 ladder of unknown tier".
- **Head-to-head 52-week hover** ("His last 52 weeks: 290 (+8 here)", never a visible line) = `dna-apitennis-ratings.json`
  `players[key].surfaces.All.last52` for six stats; "—" for Pressure points, Winners, Unforced errors and W/UE (no source,
  no approximation). The tournament figure's hover states its n. Footer "These figures cover {City} {Year} only" + "Open
  the full head to head ›" (`sfGoToH2H` + `stn_h2h_pair`, `tournaments.md`). **Test:** "52 wk hover", "the hover states n",
  "footer + button carry both api-tennis keys", "no visible 52-week line".
- **City key, not the event name:** the tournament pills and the sheet meta print the city key as the design does.
  **Test:** `test-ten402-r2n.mjs` r2.4.
- `tourxRating` (Database → Ratings Elo) stays for the Head to Head page; Reports prints no Elo. **Test:**
  `tools/test-ten386-round-comparison.js` "tourxRating".
- *Open (not ruled):* a Round comparison tie lights the first row only while Player progression lights every tied cell (both
  as the prototype); Pressure points' Round avg sits near 50% by construction.
