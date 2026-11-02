// Model value ledger — the ONE config (founder brief 2026-11-01). Michael changes the numbers here, and only here.
//
// Edge = model probability × decimal odds − 1, against the bet105 price of the snapshot (see edgeBasis). The tier is never stored: the
// export reads the stored edge through these thresholds, so changing them re-tests the same rows. A tier holds edges in
// [min, max); max null = no upper bound. Below the lowest min = untagged.
module.exports = {
  // Which bet105 price the edge (and so the tier and the first-edge snapshot) is measured against (Michael 2026-11-01:
  // "use the bet105 prices devigged"): 'b105-novig' = the no-vig price of the snapshot's bet105 pair (both sides needed,
  // else no edge); 'b105' = the price as quoted. Profit is always settled at the price as quoted — the price you can bet.
  edgeBasis: 'b105-novig',
  tiers: [
    { name: 'Value',           min: 0.02, max: 0.05 },
    { name: 'Strong value',    min: 0.05, max: 0.10 },
    { name: 'Max value (+++)', min: 0.10, max: 0.15 },
  ],
  // Edges at or above this are treated as a likely model error, not value (Michael 2026-11-02, point 3: backtest edges
  // of 20%+ won 2 of 11 on bet105). Their own group, "Capped (likely model error)", never a tier. null = no cap.
  edgeCap: 0.15,
  // The bet rule Michael agreed (2026-11-02, point 4): only mild edges. Its own "Followed the bet rule" summary line.
  betRule: { min: 0.02, max: 0.05 },
  // A tier's rates (avg CLV, win rate, ROI) need this many settled bets; below it the summary shows the count and a dash.
  minSettledForRates: 30,
  // CLV is read only from a Pinnacle close whose price was last seen at most this many minutes before the start (the
  // site's within-60 rule for a close that feeds a figure, TEN-253 ruling 2). Every close is STORED with its gap; this
  // filter applies at export, so changing it re-tests the same rows. null = every close.
  clvCloseMaxGapMin: 60,
  // A bet105 price is live only while the Kibl worker's heartbeat is at most this old (line-prices.js STALE_MIN).
  b105StaleMin: 3,
  // Settlement waits this long after the start for the archive's Pinnacle close; past it, it settles with CLV a dash.
  closeWaitHours: 24,
};
