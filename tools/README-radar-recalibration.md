# Task 11 — Player-DNA radar recalibration

Recalibrates the six-axis "Player DNA" radar off **real, empirical percentiles**
from the Match Charting Project (MCP), replacing the old hand-set linear bounds
in `computeDnaScores` (`bsp-pipeline.js`). A score of 80 now means "better than
80% of charted ATP players on that axis" — not an arbitrary rescale.

## Part 1 — the percentile engine (DONE, this branch)

- `tools/build-radar-calibration.js` — reads MCP `charting-m-stats-*.csv`,
  computes pooled per-player rates on all six axes, and writes
  `radar-calibration.json` (101-quantile breakpoints per axis + a per-player
  percentile radar + a `sufficient` flag).
- `tools/radar-coverage-report.js` — joins the artifact to the live
  `matches.json` universe by surname+initial and writes `radar-coverage.json`.

Regenerate: `RADAR_MCP_DIR=/path/to/mcp node tools/build-radar-calibration.js`
(MCP: `git clone --filter=blob:none --sparse github.com/JeffSackmann/tennis_MatchChartingProject`,
then `git sparse-checkout set --no-cone 'charting-m-stats-*.csv'`).

### Axes (all real MCP data)
| Axis | Metric | Source |
|---|---|---|
| Serve | (1st+2nd serve pts won) / serve pts | Overview |
| Return | return pts won / return pts | Overview |
| Baseline | winners / (winners+unforced) | Overview |
| Clutch | break pts saved / break pts faced | Overview |
| Net play | net pts won / net pts | NetPoints |
| Movement / Defense | long-rally (7+ shot) win rate — **PROXY** | Rally |

**Movement is a proxy.** MCP is shot-charting, not player tracking. The axis is
labelled "Movement / Defense" and must never be presented as measured movement.

### Coverage gate (the real constraint)
Population: 1002 charted men, **251** with ≥10 matches. Against the live
76-player universe: **28 reliable / 37 thin (<10) / 11 no MCP data → 48/76 must
degrade.** The engine emits `sufficient:false` for every under-covered player so
the UI can grey out / hide the radar rather than draw a confident shape from 2
matches. Verified face-valid: Sinner serve 94 / return 98, Djokovic return 98 /
movement 96, Tsitsipas return 37, Fritz serve 96 / return 44.

## Parts 2–4 — remaining (next slice, this branch)

2. **Pipeline wiring** — in `bsp-pipeline.js`, join each live player to the
   calibration by normalized name (reuse `radar-coverage-report.js`'s
   surname+initial matcher), and when `sufficient`, replace `dna.All` with the
   six MCP percentiles + set `dnaSource:'mcp'` and `dnaSufficiency`.
3. **Dashboard degradation** — in `ppDnaVals` / `ppRadarSvg`
   (`bsp-consult-dashboard.html`): render all six real axes when MCP-backed,
   relabel axis 4 "Movement / Defense", and grey-out / "limited data" badge for
   `sufficient:false` players instead of the current mean-substitution proxy.
4. **Card benchmarks + odds-bracket chart** — recalibrate the Serve/Return card
   baselines off the same percentiles. (Part 4's odds-bracket chart uses stored
   closing odds, not MCP, so it is independent.)
