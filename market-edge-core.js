/*
 * market-edge-core.js — TEN-310. The compute behind the Match analysis → Market edge tab.
 *
 * One pure module, loaded by the dashboard (<script src>, window.MarketEdgeCore) and required by
 * Node (tests, tools/ten310-market-edge-counts.mjs). No DOM, no fetch, no Date.now: every input is
 * passed in, so the same rows give the same figures in the browser and in the suite.
 *
 * INPUT: normalised rows, one per match, from the player's own side. The page builds them from
 * career-history/{key}.json (dates, set scores, eventKey, RET/W/O flags) joined to
 * match-closes/{key}.json through the Form/H2H price picker (fhCloseFor → fhPickBook:
 * Pinnacle close, else Bet365 close, one book and one source per match). Fields read here:
 *   day (UTC day number), date, won, price, oppPrice, book ('P'|'B'|null), src,
 *   wo, ret, complete, bo (3|5), sets ([[own, opp, tb]…] finished sets only → `done`),
 *   pS, oS, tot, diff, tbN, alt (non-standard format reason or null), rr (round rank)
 *
 * PROVISIONAL (founder has not ruled; TEN-310 §4.2 / §4.5 — report, don't resolve):
 *   ME_THIN_FLOOR = 5          a rate (Won, Yield, line %) needs n >= 5, else "—"
 *   ME_NEEDS = 'sumPrice'      Needs = n / Σ price (exact flat-stake break-even)
 */
(function (root) {
  'use strict';

  const ME_THIN_FLOOR = 5;
  const ME_NEEDS = 'sumPrice';

  // The eight bands, half-open [lo, hi) in thousandths, so no price can fall between two bands
  // (1.205 is in 1.01 – 1.20; 1.21 is in 1.21 – 1.40). Favourite = price < 2.00; 2.00 is underdog.
  // `mid` is the design's midpoint (label ends averaged, 6.00 + = 7.5) — kept only for the
  // §4.2 comparison, never rendered.
  const BANDS = [
    { gk: 'fav', label: '1.01 – 1.20', lo: 1010, hi: 1210, mid: (1.01 + 1.20) / 2 },
    { gk: 'fav', label: '1.21 – 1.40', lo: 1210, hi: 1410, mid: (1.21 + 1.40) / 2 },
    { gk: 'fav', label: '1.41 – 1.64', lo: 1410, hi: 1650, mid: (1.41 + 1.64) / 2 },
    { gk: 'fav', label: '1.65 – 1.99', lo: 1650, hi: 2000, mid: (1.65 + 1.99) / 2 },
    { gk: 'dog', label: '2.00 – 2.49', lo: 2000, hi: 2500, mid: (2.00 + 2.49) / 2 },
    { gk: 'dog', label: '2.50 – 3.49', lo: 2500, hi: 3500, mid: (2.50 + 3.49) / 2 },
    { gk: 'dog', label: '3.50 – 5.99', lo: 3500, hi: 6000, mid: (3.50 + 5.99) / 2 },
    { gk: 'dog', label: '6.00 +', lo: 6000, hi: Infinity, mid: 7.5 },
  ];
  const milli = (p) => Math.round(Number(p) * 1000);
  /** Band index of a decimal price, or -1 (no price, or below the 1.01 floor). */
  function bandOf(price) {
    if (price == null || !(Number(price) >= 1.01)) return -1;
    const m = milli(price);
    for (let i = 0; i < BANDS.length; i++) if (m >= BANDS[i].lo && m < BANDS[i].hi) return i;
    return -1;
  }
  const isFavPrice = (price) => price != null && milli(price) < 2000;

  /** Flat 1u P&L of one row in integer cents (a decimal price is exact in cents). */
  function plCents(r) { return r.won ? Math.round(Number(r.price) * 100) - 100 : -100; }

  // ---- populations -------------------------------------------------------------------------
  /** Match-winner population (band table + profit chart): a closing price, and the match was
   *  played to a result. Walkovers never; retirements follow the player-profile Market edge
   *  settlement (build-market-edge.js drops every Tennis-Data row whose comment is not
   *  "Completed"), so a retired match is not settled here either. Bo5 counts. */
  function whyNotPriced(r) {
    if (r.wo) return 'walkover';
    if (r.price == null || r.oppPrice == null || !r.book) return 'unpriced';
    if (r.retSettle) return 'retired';
    if (bandOf(r.price) < 0) return 'unpriced';
    return '';
  }
  const inWinner = (r) => whyNotPriced(r) === '';
  /** Derived-lines population: a priced match-winner row that is also a completed best-of-3
   *  with every set a standard, finished set. Reasons in the order they are counted. */
  function whyNotBo3(r) {
    const w = whyNotPriced(r);
    if (w) return w;
    if (r.alt) return 'format';                   // NextGen short sets, team events (Laver Cup …)
    if (r.bo !== 3) return 'bo5';
    // the stored set list must be the whole match: as many finished sets as the result counts
    if (!r.setsOk || !r.complete) return 'set scores incomplete';
    // A real best-of-3 set never passes 7 games; a match-tiebreak decider (10-8, [1-0]) does not
    // look like a set at all. Either one = non-standard format.
    if (r.sets.some((x) => Math.max(x[0], x[1]) > 7 || Math.max(x[0], x[1]) < 6)) return 'format';
    return '';
  }
  const inBo3 = (r) => whyNotBo3(r) === '';

  // ---- scope -------------------------------------------------------------------------------
  /** Rows strictly before the reference day (the match's own day); Last 52 weeks = the 364 days
   *  before it. `day` is a UTC day number. */
  function inScope(r, scope, refDay) {
    if (r.day == null || !(r.day < refDay)) return false;
    return scope === 'l52' ? r.day >= refDay - 364 : true;
  }

  // ---- aggregates --------------------------------------------------------------------------
  function summarise(rows, floor) {
    const f = floor == null ? ME_THIN_FLOOR : floor;
    let w = 0, cents = 0, priceMilli = 0;
    rows.forEach((r) => { if (r.won) w++; cents += plCents(r); priceMilli += milli(r.price); });
    const n = rows.length, rateOk = n > 0 && n >= f;
    return {
      n, w, l: n - w, plCents: cents, units: cents / 100,
      won: rateOk ? w / n : null,
      yield: rateOk ? cents / 100 / n : null,
      // Needs (provisional ME_NEEDS): the win rate at which flat 1u on these exact prices breaks
      // even — Σ over the band of (q · price − 1) = 0 ⇒ q = n / Σ price. Algebraically equal to
      // 1 / (mean price). Shown at any n > 0: it is a property of the prices, not of the results.
      needs: n ? n / (priceMilli / 1000) : null,
    };
  }
  /** The three Needs candidates of §4.2, per band: (a) 100 / design midpoint, (b) 100 / mean
   *  closing price, (c) n / Σ price. (b) and (c) are the same number by algebra. */
  function needsCandidates(rows, bi) {
    const n = rows.length, sum = rows.reduce((s, r) => s + milli(r.price), 0) / 1000;
    return { a: 1 / BANDS[bi].mid, b: n ? 1 / (sum / n) : null, c: n ? n / sum : null, n };
  }

  // Round rank, for matches that share a date (pre-2021 career rows carry the tournament's
  // start date on every round): earlier rounds first, so a cumulative line walks a draw in order.
  const RR = { Q: 0, R128: 1, R64: 2, R32: 3, R16: 4, RR: 4.5, QF: 5, SF: 6, BR: 6.5, F: 7 };
  const roundRank = (code) => (RR[code] != null ? RR[code] : 4.5);
  const byDate = (a, b) => (a.day - b.day) || (roundRank(a.round) - roundRank(b.round));

  /** Everything the tab shows for one player in one scope. `todayPrice` = the header's price or null. */
  function playerModel(rows, opts) {
    const o = opts || {};
    const floor = o.floor == null ? ME_THIN_FLOOR : o.floor;
    const scoped = rows.filter((r) => inScope(r, o.scope, o.refDay));
    const priced = scoped.filter(inWinner).slice().sort(byDate);
    const bo3 = priced.filter(inBo3);
    const bandRows = BANDS.map(() => []);
    priced.forEach((r) => bandRows[bandOf(r.price)].push(r));
    const bands = bandRows.map((rs, i) => Object.assign({ i, rows: rs.slice().reverse() }, BANDS[i], summarise(rs, floor)));
    const tb = o.todayPrice != null ? bandOf(o.todayPrice) : -1;
    // cumulative profit, oldest → newest, integer cents. The line starts at break even on the day
    // of the first priced match (the design's cum = [0, …]), then one point per match.
    let cum = 0;
    const series = priced.length ? [{ day: priced[0].day, c: 0 }] : [];
    priced.forEach((r) => { cum += plCents(r); series.push({ day: r.day, c: cum }); });
    // counts for the report and the pill
    const why = {};
    scoped.forEach((r) => { const k = whyNotPriced(r) || 'priced'; why[k] = (why[k] || 0) + 1; });
    const whyBo3 = {};
    priced.forEach((r) => { const k = whyNotBo3(r) || 'bo3'; whyBo3[k] = (whyBo3[k] || 0) + 1; });
    const book = { P: priced.filter((r) => r.book === 'P').length, B: priced.filter((r) => r.book === 'B').length };
    const lines = o.todayPrice == null ? null : lineModel(bo3, tb, o.todayPrice, o.surname || '', floor);
    return {
      scoped: scoped.length, priced, bo3, bands, tb, series, why, whyBo3, book,
      units: cum / 100, lastDate: priced.length ? priced[priced.length - 1].date : null, lines,
    };
  }

  // ---- derived lines -----------------------------------------------------------------------
  /** Six lines, favourite set when today's price < 2.00, else the underdog set. Every rule reads
   *  finished sets only (`sets` of a Bo3-complete row are all finished). */
  function lineDefs(fav, surname) {
    const gd = (r) => r.sets.reduce((s, x) => s + x[0] - x[1], 0);
    const tg = (r) => r.sets.reduce((s, x) => s + x[0] + x[1], 0);
    const tb = (r) => r.sets.some((x) => Math.max(x[0], x[1]) === 7 && Math.min(x[0], x[1]) === 6);
    const s1 = (r) => r.sets[0][0] > r.sets[0][1];
    const sur = surname ? surname + ' ' : '';
    return fav
      ? [['Wins match', (r) => !!r.won], ['Wins set 1', s1], ['Wins 2–0', (r) => !!r.won && r.sets.length === 2],
        [sur + '−3.5 games', (r) => gd(r) >= 4], ['Over 22.5 games', (r) => tg(r) > 22.5], ['Tiebreak in match', tb]]
      : [['Wins match', (r) => !!r.won], ['Wins set 1', s1], ['Wins a set', (r) => r.sets.some((x) => x[0] > x[1])],
        [sur + '+3.5 games', (r) => gd(r) >= -3], ['Over 22.5 games', (r) => tg(r) > 22.5], ['Tiebreak in match', tb]];
  }
  function lineModel(bo3, tb, todayPrice, surname, floor) {
    const inBand = tb >= 0 ? bo3.filter((r) => bandOf(r.price) === tb) : [];
    const defs = lineDefs(isFavPrice(todayPrice), surname);
    const rows = defs.map(([label, fn], li) => {
      const aC = bo3.filter(fn).length, bC = inBand.filter(fn).length;
      const aOk = bo3.length > 0 && bo3.length >= floor, bOk = inBand.length > 0 && inBand.length >= floor;
      return { li, label, fn, aC, aN: bo3.length, bC, bN: inBand.length,
        aPct: aOk ? Math.round(aC / bo3.length * 100) : null, bPct: bOk ? Math.round(bC / inBand.length * 100) : null };
    });
    // the two most covered lines in today's band (by in-band rate), ties keep line order
    const top = rows.filter((r) => r.bPct != null).slice().sort((u, v) => v.bPct - u.bPct).slice(0, 2);
    rows.forEach((r) => { r.top = top.indexOf(r) >= 0; r.diff = r.bPct != null && r.aPct != null ? r.bPct - r.aPct : null; });
    return { rows, inBand, all: bo3, tb, fav: isFavPrice(todayPrice) };
  }

  // ---- profit chart geometry (shared time axis) -------------------------------------------
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** x in [0, 1000] = the match DATE on one axis for both players; y from the design's range rule. */
  function chartModel(seriesA, seriesB, scope) {
    const all = seriesA.concat(seriesB);
    if (!all.length) return null;
    const d0 = Math.min.apply(null, all.map((p) => p.day)), d1 = Math.max.apply(null, all.map((p) => p.day));
    const span = Math.max(1, d1 - d0);
    const X = (day) => (day - d0) / span * 1000;
    const vals = all.map((p) => p.c / 100).concat([0]);
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const pad = (hi - lo) * 0.12 + 0.5; lo -= pad; hi += pad;
    const H = 200, Y = (v) => (hi - v) / (hi - lo) * H;
    const rng = hi - lo, stp = rng > 60 ? 20 : rng > 30 ? 10 : rng > 12 ? 5 : rng > 5 ? 2 : 1;
    const grid = [];
    for (let v = Math.ceil(lo / stp) * stp; v <= hi; v += stp) grid.push({ v, y: Y(v) });
    // Six labels at even fractions of the real date range. Career: the year at each position;
    // Last 52 weeks: the month. A label always names the date that sits under it.
    const ticks = [0, 1, 2, 3, 4, 5].map((i) => {
      const day = d0 + span * i / 5, dt = new Date(Math.round(day) * 86400000);
      const label = scope === 'l52' ? MON[dt.getUTCMonth()] : String(dt.getUTCFullYear());
      return { f: i / 5, x: i / 5 * 1000, label, key: dt.getUTCFullYear() * 12 + (scope === 'l52' ? dt.getUTCMonth() : 0) };
    });
    // a short range would name the same year (or the same month of the same year) twice: repeats stay blank
    ticks.forEach((t, i) => { if (i && ticks.slice(0, i).some((u) => u.key === t.key)) t.label = ''; });
    const mk = (s) => s.length ? { pts: s.map((p) => [X(p.day), Y(p.c / 100)]), end: s[s.length - 1].c / 100, n: s.length } : null;
    return { d0, d1, lo, hi, H, zeroY: Y(0), grid, ticks, a: mk(seriesA), b: mk(seriesB) };
  }

  const api = { ME_THIN_FLOOR, ME_NEEDS, BANDS, bandOf, isFavPrice, plCents, whyNotPriced, whyNotBo3, inWinner, inBo3,
    inScope, summarise, needsCandidates, roundRank, byDate, playerModel, lineDefs, lineModel, chartModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketEdgeCore = api;
})(typeof window !== 'undefined' ? window : this);
