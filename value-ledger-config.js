// Model value ledger — the ONE config (founder brief 2026-11-01). Michael changes the numbers here, and only here.
//
// Edge = model probability × decimal odds − 1, against the bet105 price of the snapshot. The tier is never stored: the
// export reads the stored edge through these thresholds, so changing them re-tests the same rows. A tier holds edges in
// [min, max); max null = no upper bound. Below the lowest min = untagged.
module.exports = {
  tiers: [
    { name: 'Value',           min: 0.02, max: 0.05 },
    { name: 'Strong value',    min: 0.05, max: 0.10 },
    { name: 'Max value (+++)', min: 0.10, max: null },
  ],
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
