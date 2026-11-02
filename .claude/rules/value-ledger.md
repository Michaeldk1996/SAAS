# Model value ledger (founder brief 2026-11-01)

Applies to `supabase/migrations/20261101090000_model_value_ledger.sql`, `value-ledger-config.js`, `tools/value-ledger.mjs`
(the one writer), `.github/workflows/value-ledger.yml` and the pipeline step "Model value ledger". It only READS the model,
its anchor, the bet105 stream, the Pinnacle close archive, Picks and the Bet Tracker — never changes them. No page shows it
yet (founder: tiers or marks on the match card / Model page come later, once the data supports them).

## What is stored — each line is a test (`tools/test-value-ledger.mjs`, `tools/test-value-ledger-sql.py`)
- **Rows are only ever added.** Supabase tables `value_ledger_snapshot`, `value_ledger_mark`, `value_ledger_settlement`:
  service_role SELECT + INSERT only, triggers refuse UPDATE / DELETE / TRUNCATE for every role (the owner included), RLS
  on with no policy. A correction is a new settlement row whose `supersedes` names the old one. No nightly job, rebuild or
  backfill regenerates it. **Test:** the SQL test on a real Postgres (every write path refused; guard negative controls) and
  the scan: only the allow-listed files name a ledger table, and none updates, deletes, truncates, upserts or drops (mutants).
- **Snapshots:** every pipeline data run, for each upcoming board match the model priced THIS run (not started, not
  frozen), each side: model fair prob + odds, base state → `price_kind` full (state 2) · alt-anchor (state 1) · elo-only
  (state 3), the Model page's display gate (`shown_on_page`), layers applied of 14, the frozen Pinnacle anchor + its time,
  the latest api-tennis Pinnacle read + its time, the bet105 match-winner price from `line_prices_current` + its Kibl insert
  time (live only while the worker heartbeat is ≤ 3 min old; otherwise null with the reason), edge vs bet105 and vs
  Pinnacle. A missing price is null with its reason, never another book.
- **Edge = model probability × the NO-VIG bet105 price − 1** (Michael 2026-11-01: "use the bet105 prices devigged";
  `value-ledger-config.js` `edgeBasis: 'b105-novig'`, both sides of the pair needed, else no edge; `'b105'` = as quoted).
  Profit is always at the price as quoted. The value tier is NEVER stored: the export works the edge from the stored
  prices and reads it through `tiers` (Value 2–5% · Strong value 5–10% · Max value (+++) 10%+, below 2% untagged), so a
  basis or threshold change re-tests the same rows. **The export derives the first-edge snapshot on that basis** (the
  earliest positive edge at or before the last-pre-start snapshot); the stored `first_edge` marks are the record of what
  each run saw. **Test:** `tools/test-value-ledger.mjs` (basis switch re-tiers the same rows; derived first edge).
- **Key snapshots (marks):** `first_edge` = the first snapshot of a match-side with a positive edge vs bet105 (any size);
  `last_pre_start` = the last snapshot strictly before the VERIFIED start (the archive export's start, else the card's
  actual start — never the schedule). One per kind per match-side.
- **Settlements:** per mark, once the board has the result: the Pinnacle close from this run's `pinnacle-closes.json`
  (oriented by player keys), its time and gap to the start, CLV = bet105 price × no-vig close − 1 (`picks-core.js` `clv`),
  the result on Pinnacle's rules (`settlement.js` `settleBet`: a retirement stands once the first set was completed, else
  void; a walkover void), flat-1u profit at the snapshot's bet105 price. No close 24 h after the start → CLV null; no
  bet105 price → profit null. Never estimated.
- **Export** (`value-ledger.yml` mode export → a new dated CSV in the private ops repo `value-ledger/`): opens with the
  tier summary per key snapshot × price kind × tier (bets, avg CLV, win rate, profit, ROI, each with its count; < 30
  settled bets → the count and a dash for the rates), then every row. Elo-only and alt-anchor rows are their own rows in
  every summary, never mixed with full-model rows. CLV is counted only from a close seen ≤ `clvCloseMaxGapMin` (60) before
  the start; every close is stored with its gap.

## Not the Model page's "value" (report, don't resolve)
The Model page's chip reads `h2h-model/config.js` `value.sharpEdge` 0.03 ("Sharp Value": fair prob − Pinnacle vig-free prob
≥ 3pp) and `value.softEdge` 0.05 ("Soft Book Value": fair prob − 1/best soft price ≥ 5pp) — probability gaps, not the
ledger's expected-value edge vs bet105. Which applies on screen is Michael's call.

## Historical backtest — reconstructed from records, never in the ledger (Michael 2026-11-01)
`tools/value-backtest.mjs --out FILE.csv` (run by hand; reads the board's git history, so not a pipeline step). One row per
side of every match the model priced at full model since 23 Jul 2026, frozen at its first full-model read (`admin-log.json`
`valueSnapshot`, never recomputed). Entry price: bet105 at that moment (the Kibl archive, last price per side at or before
the snapshot; both sides → no-vig) where it exists (from 19 Sep), else Pinnacle's no-vig price from the snapshot
(fair − edge vs Pinnacle). Result: the board's (retirement rules via `settlement.js`), else the log's score (retirement
unknown, said in the row). CLV only vs a verified board close. Summaries per price source — bet105 (as quoted) and
Pinnacle no-vig (no margin: not bettable, flatters the result) are never pooled — by tier, by Sharp Value (`h2h-model/config.js`
`value.sharpEdge`, the Model page's flag) and by month; under 30 bets the counts only. The file says "RECONSTRUCTED FROM
RECORDS" on its first line and goes to the private ops repo `value-ledger/backtest/`. **Test:** `tools/test-value-backtest.mjs`.

## Edge cap, bet rule, model calibration (Michael 2026-11-02, after the backtest)
- **Edge cap:** an edge of `edgeCap` (15%) or more is "Capped (likely model error)" — its own group, never a tier; Max
  value is 10–15%. **Bet rule:** `betRule` 2–5% — the backtest's "Followed the bet rule" line. Both in `value-ledger-config.js`.
  **Test:** `tools/test-value-ledger.mjs`, `tools/test-value-backtest.mjs`.
- **Calibration:** `h2h-model/config.js` `calibration` {enabled, temperature 1.3} — stage 3 prices
  sigmoid(logit(adjustedP1) / T); stage 2 keeps the raw probability and stage 3 records it (`stage3.calibration.rawP1`); the
  ledger snapshot keeps it in `detail.calibration`. **LIVE** by founder ruling on the go-live report (2026-11-02; last 30
  days, out of sample: log-loss 0.6467 → 0.6417, Brier 0.2282 → 0.2259, Sharp Value flags 87 of 386 sides changed);
  rollback = `enabled: false`, one commit. Frozen pre-match prices of started matches never change. **Test:** `h2h-model/test-h2h.js`
  "Stage 3 calibration".

## bet105 open and close (Michael 2026-11-02: "the bet105 timestamp should help … results on the opening and closing price")
- **Each settlement stores bet105's open and close for its side** (`detail.b105`): the worker's open (`line_prices_current`
  `open_price`, Kibl time) and its live-flip close (`close_price`, both sides), else the Kibl archive's first price and last
  pre-match price before the verified start (`price_history`). Each names its source and time; none → a dash.
- **The export** adds per key snapshot: profit at bet105's OPEN, at the SNAPSHOT and at bet105's CLOSE (same bets, all three
  prices present) and CLV vs bet105's no-vig close (timestamped to the start, so no 60-min rule; the Pinnacle CLV keeps its
  rule). The backtest carries the same block. **Test:** `tools/test-value-ledger.mjs` "bet105 open / close",
  `tools/test-value-backtest.mjs`.
