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
- **Edge = model probability × decimal odds − 1.** The value tier is NEVER stored: the export reads the stored edge
  through `value-ledger-config.js` `tiers` (Value 2–5% · Strong value 5–10% · Max value (+++) 10%+, below 2% untagged), so
  a threshold change re-tests the same rows.
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
