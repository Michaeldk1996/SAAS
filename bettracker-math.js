/* bettracker-math.js — the Bet Tracker's figures, as pure functions (no DOM, no storage, no fetch).
 *
 * Ported 1:1 from the logic class of `design_handoff_bet_tracker/Bet Tracker Page.dc.html` (LOCKED 2026-10-28;
 * README §Formulas) — stats · key · segments · discipline · staking plans · heat alpha · period · filters · the
 * Log-a-bet form — with these rulings on top of the reference:
 *   - ROI = profit ÷ (won + lost stakes). A void stake is not in the denominator (Bet Tracker T1 brief, change 2 — the
 *     Picks ruling; the reference adds every settled stake). "Staked in total" still counts every settled stake.
 *   - Missing is a dash, never a zero: ROI with nothing won or lost, win rate with no W/L, a discipline check with no
 *     input are null (the reference returns 0, or judges an empty check).
 * Bets carry `date` as a local-midnight Date and `res` (won | lost | void | null). Colours are kinds
 * (pos | neg | zero | lab), never values — tokens.css owns every colour.
 *
 * Loaded by the dashboard as a classic script (window.BetTrackerMath) and by node tests (module.exports).
 * Tests: tools/test-bettracker-math.mjs (the reference's demo seed — its generator lives in that test only).
 */
(function (root) {
  'use strict';

  var DASH = '—', MINUS = '−', EN = '–';
  var MIN_SAMPLE = 15, MIN_FLOOR = 5;
  var LEVEL = { Slam: 'Grand Slam', '1000': 'Masters 1000', '500': 'ATP 500', '250': 'ATP 250', Cup: 'Davis Cup', Chall: 'Challenger' };
  var LEVEL_KEYS = ['Slam', '1000', '500', '250', 'Cup', 'Chall'];
  var SURFACES = ['Hard', 'Indoor hard', 'Clay', 'Grass'];
  var BANDS = ['1.10 – 1.35', '1.36 – 1.60', '1.61 – 1.90', '1.91 – 2.20', '2.21 – 2.60', '2.61 – 3.20', '3.21 and up'];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DIMS = [['market', 'Market', 'Market'], ['surface', 'Surface', 'Surface'], ['odds', 'Odds band', 'Odds taken'], ['level', 'Level', 'Tournament level'],
    ['book', 'Bookmaker', 'Bookmaker'], ['timing', 'Timing', 'Pre-match / Live'], ['situation', 'Situation', 'Situation'], ['dow', 'Weekday', 'Weekday']];
  var PERIODS = { '30d': 'Last 30 days', '90d': 'Last 90 days', season: 'Season', all: 'All time', custom: 'Custom range' };
  var MARKETS = ['Match winner', 'Set winner', 'First set winner', 'Games handicap', 'Sets handicap', 'Total games', 'Total sets',
    'Correct score (sets)', 'Tiebreak in match', 'Player to win a set', 'Outright'];
  var BOOKS = ['bet105', 'Pinnacle', 'bet365', 'Betfair Exchange', 'Betfair Sportsbook', 'Unibet', 'Betway', 'William Hill', '888sport', 'bwin',
    'Ladbrokes', 'Betsson', 'Stake', 'Napoleon', 'Circus', 'Golden Palace', 'Betcenter', 'Tipico', 'Winamax', 'Superbet', 'Polymarket', 'Kalshi'];
  var TYPES = ['Single', 'Combination', 'Parlay'];

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function isSettled(b) { return !!(b && b.res); }

  // ── formatting (the reference's sgn / col) ──────────────────────────────────────────────────────────────────────
  function sgn(x, d, u) {
    if (x === null || x === undefined || !isFinite(x)) return DASH;
    d = d == null ? 1 : d; u = u == null ? '%' : u;
    return (x > 0 ? '+' : x < 0 ? MINUS : '') + Math.abs(x).toFixed(d) + u;
  }
  function kind(x) { return x === null || x === undefined || !isFinite(x) ? 'lab' : x > 0 ? 'pos' : x < 0 ? 'neg' : 'zero'; }
  function fmtD(d) { return d.getDate() + ' ' + MON[d.getMonth()]; }
  // With the year when it is not `today`'s (an imported ledger spans seasons: "14 Jan 2022"; the reference is one season).
  function fmtDY(d, today) { return fmtD(d) + (today && d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : ''); }
  // A calendar month as one number (year × 12 + month): month groups never merge two seasons' Januaries.
  function ym(d) { return d.getFullYear() * 12 + d.getMonth(); }
  function ymLabel(k, multiYear) { return MON[k % 12] + (multiYear ? ' ' + Math.floor(k / 12) : ''); }
  function ymName(k) { return MONTHS[k % 12] + ' ' + Math.floor(k / 12); }
  function dow(d) { return DN[(d.getDay() + 6) % 7]; }

  // ── per bet ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // P/L in % of bankroll: won → stake × (odds − 1); lost → −stake; void and pending → 0 (pending is never in a sum).
  function pl(b) { var r = b.res; if (!r || r === 'void') return 0; return r === 'won' ? b.stake * (b.odds - 1) : -b.stake; }
  // CLV = your price ÷ closing price − 1; null without a close.
  function clv(b) { return num(b.close) && b.close > 0 ? b.odds / b.close - 1 : null; }

  // The reference's stats(), over the settled bets of `list` in the order given — with the ROI ruling.
  function stats(list) {
    var s = list.filter(isSettled);
    var profit = 0, staked = 0, stakedWL = 0, w = 0, l = 0, v = 0, clvS = 0, clvN = 0, beat = 0, cum = 0, peak = 0, dd = 0, ddIdx = -1, run = 0, worst = 0, wrun = 0, best = 0,
      bestEnd = null, worstEnd = null, wRuns = [], lRuns = [];
    s.forEach(function (b, i) {
      var r = b.res, p = pl(b);
      profit += p; staked += b.stake;
      if (r === 'won') { w++; stakedWL += b.stake; } else if (r === 'lost') { l++; stakedWL += b.stake; } else v++;
      var c = clv(b); if (c !== null) { clvS += c; clvN++; if (c > 0) beat++; }
      cum += p; if (cum > peak) peak = cum; if (peak - cum > dd) { dd = peak - cum; ddIdx = i; }
      // v26: a run's end date is the bet that set the record; a void leaves both runs as they are
      if (r === 'lost') { if (wrun > 0) wRuns.push(wrun); run++; if (run > worst) { worst = run; worstEnd = b.date; } wrun = 0; }
      else if (r === 'won') { if (run > 0) lRuns.push(run); run = 0; wrun++; if (wrun > best) { best = wrun; bestEnd = b.date; } }
    });
    if (wrun > 0) wRuns.push(wrun); if (run > 0) lRuns.push(run);
    return { n: s.length, profit: profit, staked: staked, stakedWL: stakedWL, roi: stakedWL ? profit / stakedWL : null, w: w, l: l, v: v,
      clv: clvN ? clvS / clvN : null, clvN: clvN, beat: beat, dd: dd, ddIdx: ddIdx, worst: worst, best: best, bestEnd: bestEnd, worstEnd: worstEnd,
      avgW: avg(wRuns), avgL: avg(lRuns), wRunsN: wRuns.length, lRunsN: lRuns.length, winRate: (w + l) ? w / (w + l) : null };
  }

  // The cumulative % curve over the settled bets (starts at 0): curve meta "N bets · peak +x% · now +y%".
  function cumulative(list) {
    var pts = [0], c = 0; list.filter(isSettled).forEach(function (b) { c += pl(b); pts.push(c); });
    return { pts: pts, n: pts.length - 1, peak: Math.max.apply(null, pts), low: Math.min.apply(null, pts), now: c };
  }

  // The seven hero tiles + the profit headline (README §4) — built in T1 as figures only; the hero box is not drawn yet.
  function heroFigures(S) {
    return {
      profit: S.n ? sgn(S.profit) : DASH,
      roi: sgn(S.roi === null ? null : S.roi * 100),
      record: S.w + EN + S.l, voids: S.v,
      winRate: S.winRate === null ? DASH : (S.winRate * 100).toFixed(0) + '%',
      avgClv: S.clv === null ? DASH : sgn(S.clv * 100), beat: S.beat, clvN: S.clvN,
      maxDrawdown: S.dd ? MINUS + S.dd.toFixed(1) + '%' : DASH,
      bestRun: S.best ? S.best + ' won' : DASH, worstRun: S.worst ? S.worst + ' lost' : DASH
    };
  }

  // ── the hero (README 7.1, v26): the seven tiles and the profit headline, as the page prints them ─────────────────
  // Avg CLV with no close in the period: "—" over "no closing prices" (never "0 of 0"). Record and Win rate are green above
  // the break-even win rate at the period's average price (1 ÷ avg odds), red below; Best / Worst run carry the month
  // the record run ended ("Apr 2026").
  function monYear(d) { return d ? MON[d.getMonth()] + ' ' + d.getFullYear() : ''; }
  function heroTiles(S, list) {
    var F = heroFigures(S), sl = (list || []).filter(isSettled), avgOdds = sl.length ? sl.reduce(function (a, b) { return a + b.odds; }, 0) / sl.length : 0;
    var beWR = avgOdds ? 1 / avgOdds : 0, wrKind = (S.w + S.l) ? (S.winRate > beWR ? 'pos' : S.winRate < beWR ? 'neg' : 'zero') : 'lab';
    return {
      profit: F.profit, profitKind: S.n ? kind(S.profit) : 'lab', profitSub: S.n + ' settled · ' + S.staked.toFixed(1) + '% staked in total',
      rows: [
        { label: 'ROI', sub: 'profit ÷ total staked', value: F.roi, kind: S.roi === null ? 'lab' : kind(S.roi), when: '' },
        { label: 'Record', sub: S.n + ' settled · ' + S.v + ' void', value: F.record, kind: wrKind, when: '' },
        { label: 'Win rate', sub: avgOdds ? 'break-even ' + (beWR * 100).toFixed(0) + '% at avg ' + avgOdds.toFixed(2) : 'won ÷ (won + lost)', value: F.winRate, kind: wrKind, when: '' },
        { label: 'Avg CLV', sub: S.clvN ? 'beat the close ' + S.beat + ' of ' + S.clvN : 'no closing prices', value: F.avgClv, kind: kind(S.clv), when: '' },
        { label: 'Max drawdown', sub: 'peak to trough, % of bankroll', value: F.maxDrawdown, kind: S.dd ? 'neg' : 'lab', when: '' },
        { label: 'Best run', sub: S.wRunsN ? 'avg winning run ' + S.avgW.toFixed(1) + ' · ' + S.wRunsN + ' runs' : 'consecutive wins', value: F.bestRun, kind: S.best ? 'pos' : 'lab', when: monYear(S.bestEnd) },
        { label: 'Worst run', sub: S.lRunsN ? 'avg losing run ' + S.avgL.toFixed(1) + ' · ' + S.lRunsN + ' runs' : 'consecutive losses', value: F.worstRun, kind: S.worst ? 'neg' : 'lab', when: monYear(S.worstEnd) }
      ]
    };
  }
  // The curve (README 7.1): viewBox 0 0 1292 240, plot x 44→1288, y 12→222; y ticks every 1 / 2 / 5 / 10 % by span, the
  // zero line solid; x labels at the first bet of each month (the reference's — F3 removed the per-year labels); the
  // deepest drawdown point and the last point. F2 (Michael's unlock): the range runs min(0, lowest) → max(0, highest)
  // and each side the curve reaches carries a tick — a side shorter than one step is stretched to its first tick.
  // T9 (Michael 2026-10-29): at most CURVE_MAX_TICKS y ticks — the span's own step (1 / 2 / 5 / 10 %) steps up through
  // 20 / 50 % (then 100, 200, 500 …) until the range carries no more than that, the zero line always among them.
  // CURVE_PX: the label strip is 1286px wide at the 1340 column (measured), the viewBox 1292 units.
  var CURVE_LABEL_GAP = 70, CURVE_PX = 1286 / 1292, CURVE_MAX_TICKS = 8, CURVE_STEPS = [1, 2, 5, 10, 20, 50];
  function curveTickCount(mn, mx, step) { return Math.floor(mx / step + 1e-9) - Math.ceil(mn / step - 1e-9) + 1; }
  function curveStep(mn, mx) {
    var sp = (mx - mn) || 1, base = sp > 40 ? 10 : sp > 16 ? 5 : sp > 8 ? 2 : 1;
    for (var i = CURVE_STEPS.indexOf(base); ; i++) {
      var step = i < CURVE_STEPS.length ? CURVE_STEPS[i] : [100, 200, 500][(i - CURVE_STEPS.length) % 3] * Math.pow(10, Math.floor((i - CURVE_STEPS.length) / 3));
      var a = mn < 0 && mn > -step ? -step : mn, b = mx > 0 && mx < step ? step : mx;
      if (curveTickCount(a, b, step) <= CURVE_MAX_TICKS) return step;
    }
  }
  function curveScale(pts) {
    var mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0));
    for (var k = 0; k < 3; k++) {
      var step = curveStep(mn, mx);
      if (mx > 0 && mx < step) mx = step;
      if (mn < 0 && mn > -step) mn = -step;
      if (curveStep(mn, mx) === step) break;
    }
    return { mn: mn, mx: mx, span: (mx - mn) || 1, step: curveStep(mn, mx) };
  }
  function heroCurve(list, today) {
    var settled = list.filter(isSettled), S = stats(settled), pts = [0], cum = 0;
    settled.forEach(function (b) { cum += pl(b); pts.push(cum); });
    var sc = curveScale(pts), L = 44, R = 1288, T = 12, B = 222, mn = sc.mn, mx = sc.mx, span = sc.span, step = sc.step;
    var X = function (i) { return L + (R - L) * i / Math.max(1, pts.length - 1); }, Y = function (v) { return T + (B - T) * (mx - v) / span; };
    var path = pts.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
    var area = path + ' L' + R + ' ' + Y(0).toFixed(1) + ' L' + L + ' ' + Y(0).toFixed(1) + ' Z';
    var yTicks = [];
    for (var v = Math.ceil(mn / step) * step; v <= mx + 1e-9; v += step) {
      var vv = Math.round(v * 1e6) / 1e6;
      yTicks.push({ y: Y(vv).toFixed(1), top: (Y(vv) - 5).toFixed(1) + 'px', label: (vv > 0 ? '+' : vv < 0 ? MINUS : '') + Math.abs(vv) + '%', zero: vv === 0 });
    }
    // T9 (Michael 2026-10-29, re-ruled: always, short ledgers too): the candidates stay the first bet of each month; a label
    // is drawn only CURVE_LABEL_GAP px (at the 1340 column) right of the last one drawn. On a ledger that crosses a year a
    // January label carries its year.
    var cand = [], lastM = -1, multiYear = settled.length > 0 && settled[0].date.getFullYear() !== settled[settled.length - 1].date.getFullYear();
    settled.forEach(function (b, i) {
      var m = b.date.getMonth(), mk = b.date.getFullYear() * 12 + m;
      if (mk !== lastM) { lastM = mk; cand.push({ x: X(i + 1), label: MON[m] + (multiYear && m === 0 ? ' ' + b.date.getFullYear() : '') }); }
    });
    var xTicks = [], lastX = -Infinity;
    cand.forEach(function (c) {
      if ((c.x - lastX) * CURVE_PX < CURVE_LABEL_GAP) return; lastX = c.x;
      xTicks.push({ left: (c.x / 1292 * 100).toFixed(2) + '%', label: c.label });
    });
    var ddI = S.ddIdx + 1;
    return { n: settled.length, path: settled.length ? path : '', area: settled.length ? area : '', yTicks: yTicks, xTicks: xTicks,
      lastX: X(pts.length - 1).toFixed(1), lastY: Y(pts[pts.length - 1]).toFixed(1), hasLast: settled.length > 0,
      ddX: ddI > 0 ? X(ddI).toFixed(1) : null, ddY: ddI > 0 ? Y(pts[ddI]).toFixed(1) : null,
      meta: settled.length + ' bets · peak ' + (settled.length ? sgn(Math.max.apply(null, pts)) : DASH) + ' · now ' + (settled.length ? sgn(cum) : DASH),
      ddNote: S.ddIdx >= 0 ? 'deepest drawdown ' + MINUS + S.dd.toFixed(1) + '% on ' + fmtDY(settled[S.ddIdx].date, today) : '',
      pts: pts, settled: settled, L: L, R: R, X: X, Y: Y };
  }
  // Curve hover (v26): the point nearest the pointer's x (fx in viewBox units); point 0 = before the first bet.
  function curveHover(C, fx, today) {
    var n = C.pts.length; if (!n) return null;
    var i = Math.max(0, Math.min(n - 1, Math.round((fx - C.L) / (C.R - C.L) * (n - 1)))), hb = i > 0 ? C.settled[i - 1] : null, hx = C.X(i), pct = hx / 1292 * 100;
    var r = hb ? hb.res : null, p = hb ? pl(hb) : 0;
    return { i: i, left: pct.toFixed(2) + '%', top: C.Y(C.pts[i]).toFixed(1) + 'px', flip: pct > 58,
      date: hb ? fmtDY(hb.date, today) : 'Season start', idx: i + ' of ' + C.settled.length, cum: sgn(C.pts[i]), cumKind: kind(C.pts[i]),
      bet: hb ? { text: hb.text, meta: [hb.tour, LEVEL[hb.level] || hb.level].filter(present).concat('@ ' + hb.odds.toFixed(2)).join(' · '),
        stake: 'stake ' + hb.stake.toFixed(1) + '% · ' + (r === 'won' ? 'WON' : r === 'lost' ? 'LOST' : 'VOID'), pl: sgn(p), plKind: kind(p),
        resKind: r === 'won' ? 'pos' : r === 'lost' ? 'neg' : 'lab' } : null };
  }
  // A display part that is really there: not empty, not the dash a blank field was stored as (F5).
  function present(x) { return x != null && String(x).trim() !== '' && String(x).trim() !== DASH; }
  // The Filters menu (README §4): Level · Odds band · Surface · Market, each row's count cross-adjusted over the period.
  var FILTER_MARKETS = ['Match winner', 'Games handicap', 'Total games'];
  function filterMenu(all, perList, F) {
    var markets = FILTER_MARKETS.concat(all.map(function (b) { return b.market; }).filter(function (m, i, a) { return m && a.indexOf(m) === i && FILTER_MARKETS.indexOf(m) < 0; }));
    var defs = [['level', 'Level', LEVEL_KEYS.map(function (k) { return LEVEL[k]; })], ['odds', 'Odds band', BANDS], ['surface', 'Surface', SURFACES], ['market', 'Market', markets]];
    return defs.map(function (d) {
      return { key: d[0], label: d[1], opts: d[2].map(function (o) { var n = filterCount(perList, F, d[0], o); return { label: o, n: n, on: F[d[0]].indexOf(o) >= 0, zero: n === 0 }; }) };
    });
  }
  function nFilters(F) { return F.level.length + F.odds.length + F.surface.length + F.market.length; }
  function filtersLabel(F) {
    var sel = [].concat(F.level, F.odds, F.surface, F.market);
    return sel.length ? 'Filters · ' + (sel.length > 2 ? sel.slice(0, 2).join(' · ') + ' · +' + (sel.length - 2) : sel.join(' · ')) : 'Filters';
  }
  function filtersFoot(list, perList) { return list.length + ' of ' + perList.length + ' bets in the period · a count is what that row would leave given the others'; }

  // ── segments ────────────────────────────────────────────────────────────────────────────────────────────────────
  function band(o) { return o <= 1.35 ? BANDS[0] : o <= 1.6 ? BANDS[1] : o <= 1.9 ? BANDS[2] : o <= 2.2 ? BANDS[3] : o <= 2.6 ? BANDS[4] : o <= 3.2 ? BANDS[5] : BANDS[6]; }
  // A blank field (an imported row the token table did not fill) has no key: it is in no group of that cut and never
  // passes that cut's filter — never an "Unknown" row (T4 brief: not without the founder's ruling).
  function key(b, dim) {
    if (dim === 'odds') return band(b.odds);
    if (dim === 'level') return LEVEL[b.level] || null;
    if (dim === 'timing') return b.timing === 'live' ? 'Live' : 'Pre-match';
    if (dim === 'situation') return b.tilt ? 'After two losses that day' : 'Normal rhythm';
    if (dim === 'dow') return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][b.date.getDay()];
    return b[dim] ? b[dim] : null;
  }
  function group(list, dim) {
    var g = {}, order = [];
    list.forEach(function (b) { if (!isSettled(b)) return; var k = key(b, dim); if (k === null) return; if (!g[k]) { g[k] = []; order.push(k); } g[k].push(b); });
    return order.map(function (name) { return { name: name, dim: dim, bs: g[name], s: stats(g[name]) }; });
  }
  function minN(minSample) { return Math.max(MIN_FLOOR, minSample == null ? MIN_SAMPLE : minSample); }
  // Eligibility: n ≥ minSample; strengths = profit > 0 and ROI > 3%, top 3 by profit; leaks = profit < 0, top 3 by loss;
  // blind spot = the worst-P/L segment with 5 ≤ n < minSample and ROI < 0. "Normal rhythm" is never a segment, and
  // Bookmaker is never a strength / leak cut (the reference's dim lists, verbatim).
  function segments(list, minSample) {
    var m = minN(minSample), segs = [], early = [];
    ['market', 'surface', 'odds', 'level', 'timing', 'situation', 'dow'].forEach(function (d) {
      group(list, d).forEach(function (g) { if (g.s.n >= m && g.name !== 'Normal rhythm') segs.push(g); });
    });
    ['market', 'surface', 'odds', 'level', 'timing', 'situation'].forEach(function (d) {
      group(list, d).forEach(function (g) { if (g.s.n < m && g.s.n >= MIN_FLOOR && g.name !== 'Normal rhythm' && g.s.roi < 0) early.push(g); });
    });
    var strengths = segs.filter(function (g) { return g.s.profit > 0 && g.s.roi > 0.03; }).sort(function (a, b) { return b.s.profit - a.s.profit; }).slice(0, 3);
    var leaks = segs.filter(function (g) { return g.s.profit < 0; }).sort(function (a, b) { return a.s.profit - b.s.profit; }).slice(0, 3);
    early.sort(function (a, b) { return a.s.profit - b.s.profit; });
    return { minN: m, strengths: strengths, leaks: leaks, blind: early[0] || null };
  }

  // ── discipline (README §6, the reference's disc[]) over the settled bets of the period, date order ───────────────
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function discipline(list, minSample) {
    var m = minN(minSample), settled = list.filter(isSettled), S = stats(settled);
    // 1 · closing line
    var beatPct = S.clvN ? S.beat / S.clvN * 100 : null;
    var close = { label: 'Closing line', value: beatPct,
      verdict: beatPct === null ? DASH : beatPct >= 55 ? 'REAL EDGE' : beatPct >= 48 ? 'COIN FLIP' : 'PAYING TOO MUCH',
      tone: beatPct === null ? 'lab' : beatPct >= 55 ? 'pos' : beatPct >= 48 ? 'amber' : 'neg',
      fig: beatPct === null ? DASH : beatPct.toFixed(0) + '%', ok: beatPct === null ? null : beatPct >= 55 };
    // 2 · stake after a loss ÷ after a win
    var afterLoss = [], afterWin = [];
    settled.forEach(function (b, i) { if (i === 0) return; var pr = settled[i - 1].res; if (pr === 'lost') afterLoss.push(b.stake); else if (pr === 'won') afterWin.push(b.stake); });
    var aL = avg(afterLoss), aW = avg(afterWin), ratio = afterLoss.length && aW ? aL / aW : null;
    var chase = { label: 'Stake after a loss', value: ratio, afterLoss: aL, afterWin: aW, nLoss: afterLoss.length, nWin: afterWin.length,
      verdict: ratio === null ? DASH : ratio > 1.15 ? 'CHASING' : ratio < 0.85 ? 'SHRINKING' : 'STEADY',
      tone: ratio === null ? 'lab' : ratio > 1.15 ? 'neg' : ratio < 0.85 ? 'amber' : 'pos',
      fig: ratio === null ? DASH : '×' + ratio.toFixed(2), ok: ratio === null ? null : ratio <= 1.15 && ratio >= 0.85 };
    // 3 · stake consistency (v26): largest stake ÷ average stake — EVEN ≤ ×1.5 · UNEVEN ≤ ×2 · WENT BIG above
    var stakes = settled.map(function (b) { return b.stake; }), n = settled.length, maxSt = n ? Math.max.apply(null, stakes) : 0, avgSt = avg(stakes), spread = avgSt ? maxSt / avgSt : null;
    var bigB = settled.filter(function (b) { return b.stake >= avgSt * 1.5; });
    var cons = { label: 'Stake consistency', value: n ? spread : null, maxSt: maxSt, avgSt: avgSt, n: n, big: bigB.length, bigS: stats(bigB), evenS: stats(settled.filter(function (b) { return b.stake < avgSt * 1.5; })),
      verdict: !n ? DASH : spread > 2 ? 'WENT BIG' : spread > 1.5 ? 'UNEVEN' : 'EVEN',
      tone: !n ? 'lab' : spread > 2 ? 'neg' : spread > 1.5 ? 'amber' : 'pos',
      fig: n ? '×' + spread.toFixed(2) : DASH, ok: n ? spread <= 1.5 : null };
    var checks = [close, chase, cons];
    var judged = checks.filter(function (c) { return c.ok !== null; }), bad = judged.filter(function (c) { return !c.ok; }).length;
    return { checks: checks, judged: judged.length, bad: bad, n: settled.length, minN: m,
      badge: judged.length ? bad + '/' + judged.length : '', badgeTone: bad ? 'neg' : 'pos' };
  }

  // ── Insights (README §6): verdict cards · Breakdown · the discipline dials ──────────────────────────────────────
  function segTitle(g) {
    return { market: g.name, surface: g.name + ' courts', odds: 'Odds ' + g.name.toLowerCase(), level: g.name, book: g.name + ' prices', situation: g.name, dow: g.name + ' bets', timing: g.name + ' bets' }[g.dim];
  }
  // A segment's own cumulative curve, 380 × 70 (date order).
  function segCurve(bs) {
    var o = bs.slice().sort(function (a, b) { return a.date - b.date; }), a = [0], c = 0;
    o.forEach(function (b) { c += pl(b); a.push(c); });
    var mn = Math.min.apply(null, a.concat(0)), mx = Math.max.apply(null, a.concat(0)), sp = (mx - mn) || 1;
    var Y = function (v) { return 4 + 62 * (mx - v) / sp; };
    var p = a.map(function (v, i) { return (i ? 'L' : 'M') + (i * 380 / Math.max(1, a.length - 1)).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
    return { path: p, area: p + ' L380 70 L0 70 Z' };
  }
  function verdicts(list, minSample) {
    var settled = list.filter(isSettled), S = stats(settled), G = segments(settled, minSample), m = G.minN;
    var figs = function (g) { return [{ l: 'Record', v: g.s.w + EN + g.s.l, kind: 'ink' }, { l: 'ROI', v: sgn(g.s.roi === null ? null : g.s.roi * 100), kind: g.s.roi === null ? 'lab' : kind(g.s.roi) },
      { l: 'CLV', v: g.s.clv === null ? DASH : sgn(g.s.clv * 100), kind: kind(g.s.clv) }]; };
    var card = function (k, tone, g, title, empty) {
      return g ? Object.assign({ kind: k, tone: tone, seg: segTitle(g) + ' · ' + g.s.n + ' bets', pl: sgn(g.s.profit), plKind: kind(g.s.profit), title: title, figs: figs(g), empty: false }, segCurve(g.bs))
        : { kind: k, tone: tone, seg: '', pl: DASH, plKind: 'lab', title: empty, figs: [], path: '', area: '', empty: true };
    };
    var e = G.strengths[0], l = G.leaks[0];
    // v26: the third card is the pair variant — the best and the worst odds band with m+ bets, read against each other
    var bandRow = function (g, tone, dash) { return { band: g.name, n: 'n=' + g.s.n, rec: g.s.w + EN + g.s.l, roi: sgn(g.s.roi === null ? null : g.s.roi * 100), roiKind: g.s.roi === null ? 'lab' : kind(g.s.roi),
      clv: g.s.clv === null ? DASH : sgn(g.s.clv * 100), clvKind: kind(g.s.clv), tone: tone, dash: dash }; };
    var priceCard = function () {
      var bands = group(settled, 'odds').filter(function (g) { return g.s.n >= m; }).sort(function (x, y) { return (y.s.roi || 0) - (x.s.roi || 0); });
      if (bands.length < 2) return { kind: 'Your price range', tone: 'link2', seg: '', pl: DASH, plKind: 'lab', title: 'Two odds bands with ' + m + '+ bets are needed to compare prices.', figs: [], path: '', area: '', empty: true, pair: false };
      var best = bands[0], worst = bands[bands.length - 1], gap = ((best.s.roi || 0) - (worst.s.roi || 0)) * 100, bc = segCurve(best.bs), wc = segCurve(worst.bs);
      return { kind: 'Your price range', tone: 'link2', seg: 'best v worst odds band', pl: (gap > 0 ? '+' : '') + gap.toFixed(1) + ' pp', plKind: 'pos',
        title: 'You earn most at ' + best.name + ((worst.s.roi || 0) < 0 ? ' and lose at ' + worst.name : ' and least at ' + worst.name) + (best.s.clv !== null && worst.s.clv !== null && best.s.clv > worst.s.clv ? ' — the close agrees.' : '.'),
        figs: [], pair: true, rows: [bandRow(best, 'pos', 'solid'), bandRow(worst, 'neg', 'dashed')], path: bc.path, area: bc.area, path2: wc.path, empty: false };
    };
    return [
      card('Your edge', 'pos', e, e ? segTitle(e) + ' is where you beat the market' + (e.s.clv > 0 ? ' — the close agrees' : '') + '.' : '', 'No segment with ' + m + '+ bets is clearly profitable yet.'),
      card('Your leak', 'neg', l, l ? segTitle(l) + ' ' + (l.s.profit < -S.profit / 2 && S.profit > 0 ? 'cost you half your profit' : 'is your biggest leak') + (l.s.clv !== null && l.s.clv < 0 ? ' and the close went against you.' : '.') : '',
        'No losing segment with ' + m + '+ bets in this period.'),
      priceCard()
    ];
  }
  // The Breakdown box: one cut's rows (Odds band and Weekday in natural order, every other cut by P/L desc), the
  // total row, the cut menu's segment counts. A bet with no value for the cut is in no row (counted in `left`).
  function breakdown(list, dim) {
    var settled = list.filter(isSettled), order = dim === 'odds' ? BANDS : dim === 'dow' ? DAYS : null;
    var rows = group(settled, dim).sort(function (a, b) { return order ? order.indexOf(a.name) - order.indexOf(b.name) : b.s.profit - a.s.profit; }).map(function (g) {
      return { name: g.name, n: g.s.n, wl: g.s.w + EN + g.s.l, roi: sgn(g.s.roi === null ? null : g.s.roi * 100), roiKind: g.s.roi === null ? 'lab' : kind(g.s.roi),
        clv: g.s.clv === null ? DASH : sgn(g.s.clv * 100), clvKind: kind(g.s.clv), pl: sgn(g.s.profit), plKind: kind(g.s.profit), bar: roiBar(g.s.roi) };
    });
    var T = stats(settled), d = DIMS.filter(function (x) { return x[0] === dim; })[0];
    return { rows: rows, head: d[2], label: d[1], totLabel: 'All · ' + d[1].toLowerCase(), left: settled.filter(function (b) { return key(b, dim) === null; }).length,
      tot: { n: T.n, wl: T.w + EN + T.l, roi: sgn(T.roi === null ? null : T.roi * 100), roiKind: T.roi === null ? 'lab' : kind(T.roi), clv: T.clv === null ? DASH : sgn(T.clv * 100), clvKind: kind(T.clv),
        pl: T.n ? sgn(T.profit) : DASH, plKind: T.n ? kind(T.profit) : 'lab' },
      meta: T.n + ' settled bets in the period, cut eight ways · ' + (order ? 'in order' : 'sorted by P/L') + ' · every row carries its count',
      foot: 'ROI bar clipped at ±40% · CLV = your price ÷ closing price − 1, over bets with a close · P/L in % of bankroll',
      menu: DIMS.map(function (x) { return { key: x[0], label: x[1], count: group(settled, x[0]).length, on: x[0] === dim }; }) };
  }
  // The Market pop-up (v26, a Market-cut row's ›): one market split by its line (Match winner: by the price taken),
  // six tiles and the lines table. `list` = the period + filters, as the Breakdown box.
  function marketDetail(list, name, periodLabel) {
    var bs = list.filter(function (b) { return isSettled(b) && key(b, 'market') === name; }), s = stats(bs), isMW = name === 'Match winner';
    var lineKey = function (b) { return !isMW ? (b.line || DASH) : b.odds < 1.5 ? 'Under 1.50' : b.odds < 2 ? '1.50 – 1.99' : b.odds < 2.6 ? '2.00 – 2.59' : '2.60 and up'; };
    var lm = {}; bs.forEach(function (b) { var k = lineKey(b); (lm[k] = lm[k] || []).push(b); });
    var lineNum = function (k) { var m = String(k).replace('−', '-').match(/-?[\d.]+/); return m ? parseFloat(m[0]) : 0; };
    var sortL = function (a, b) { if (isMW) return lineNum(a) - lineNum(b); var ao = /^Over/.test(a), bo = /^Over/.test(b); if (ao !== bo) return ao ? -1 : 1; return lineNum(a) - lineNum(b); };
    var lines = Object.keys(lm).sort(sortL).map(function (k) {
      var ls = stats(lm[k]), avgO = lm[k].reduce(function (x, b) { return x + b.odds; }, 0) / lm[k].length;
      return { name: k, sub: 'avg @ ' + avgO.toFixed(2), n: ls.n, wl: ls.w + EN + ls.l, roi: sgn(ls.roi === null ? null : ls.roi * 100), roiKind: ls.roi === null ? 'lab' : kind(ls.roi),
        clv: ls.clv === null ? DASH : sgn(ls.clv * 100), clvKind: kind(ls.clv), pl: sgn(ls.profit), plKind: kind(ls.profit), profit: ls.profit, bar: roiBar(ls.roi) };
    });
    // ranked on the printed P/L (1 dp), so a tie goes to the line listed first — the reference's own order
    var shown = function (x) { return parseFloat(x.pl.replace(MINUS, '-')); };
    var bestL = lines.slice().sort(function (a, b) { return shown(b) - shown(a); })[0], worstL = lines.slice().sort(function (a, b) { return shown(a) - shown(b); })[0];
    var avgOdds = bs.length ? bs.reduce(function (x, b) { return x + b.odds; }, 0) / bs.length : 0, avgStake = bs.length ? s.staked / bs.length : 0, wr = s.w + s.l ? Math.round(100 * s.w / (s.w + s.l)) : null;
    var by = function (re) { return bs.filter(function (b) { return re.test(b.line || ''); }); };
    var pf = function (x) { return sgn(stats(x).profit); };
    var side = name === 'Total games' ? (function () { var o = by(/^Over/), u = by(/^Under/); return { l: 'Over v Under', v: o.length + ' · ' + u.length, k: 'ink', sub: 'over ' + pf(o) + ' · under ' + pf(u) }; })()
      : name === 'Games handicap' ? (function () { var mi = by(/^[−-]/), pl2 = by(/^\+/); return { l: 'Giving v taking', v: mi.length + ' · ' + pl2.length, k: 'ink', sub: 'giving ' + pf(mi) + ' · taking ' + pf(pl2) }; })()
      : (function () { var fv = bs.filter(function (b) { return b.odds < 2; }), dg = bs.filter(function (b) { return b.odds >= 2; }); return { l: 'Favourites v dogs', v: fv.length + ' · ' + dg.length, k: 'ink', sub: 'favs ' + pf(fv) + ' · dogs ' + pf(dg) }; })();
    var stats6 = [
      { l: 'Win rate', v: wr === null ? DASH : wr + '%', k: 'ink', sub: s.w + ' of ' + (s.w + s.l) },
      { l: 'Avg odds', v: avgOdds ? avgOdds.toFixed(2) : DASH, k: 'ink', sub: 'break-even ' + (avgOdds ? Math.round(100 / avgOdds) + '%' : DASH) },
      { l: 'Avg CLV', v: s.clv === null ? DASH : sgn(s.clv * 100), k: kind(s.clv), sub: 'beat the close ' + s.beat + ' of ' + s.clvN },
      { l: 'Avg stake', v: avgStake ? avgStake.toFixed(2) + '%' : DASH, k: 'ink', sub: s.staked.toFixed(1) + '% staked in total' },
      side,
      { l: isMW ? 'Best price band' : 'Best line', v: bestL ? bestL.name : DASH, k: 'pos', sub: bestL ? bestL.pl + ' · ' + bestL.n + ' bets' : '' }];
    var foot = isMW ? 'Match winner has no line — the split is by the price you took. ' + (worstL && worstL !== bestL ? 'Weakest band: ' + worstL.name + ' at ' + worstL.pl + ' over ' + worstL.n + ' bets.' : '')
      : lines.length + ' lines hit in ' + name + ' · ' + bs.length + ' settled bets. ' + (worstL && worstL !== bestL ? 'Weakest line: ' + worstL.name + ' at ' + worstL.pl + ' over ' + worstL.n + ' bets.' : '');
    return { title: name, sub: bs.length + ' settled bets · ' + s.w + EN + s.l + ' · ROI ' + sgn(s.roi === null ? null : s.roi * 100) + ' · P/L ' + sgn(s.profit) + ' · ' + periodLabel,
      subHead: isMW ? 'Price band' : 'Line', stats: stats6, lines: lines, foot: foot };
  }
  // The dial geometry (SVG 200 × 110): the value arc from the left end, and a target zone.
  function arcD(t) { var a = Math.PI * (1 - Math.max(0, Math.min(1, t))); return 'M20 100 A80 80 0 0 1 ' + (100 + 80 * Math.cos(a)).toFixed(1) + ' ' + (100 - 80 * Math.sin(a)).toFixed(1); }
  function zoneD(a, b) { var p = Math.PI * (1 - a), q = Math.PI * (1 - b); return 'M' + (100 + 80 * Math.cos(p)).toFixed(1) + ' ' + (100 - 80 * Math.sin(p)).toFixed(1) + ' A80 80 0 0 1 ' + (100 + 80 * Math.cos(q)).toFixed(1) + ' ' + (100 - 80 * Math.sin(q)).toFixed(1); }
  // The Discipline strip: discipline() + each dial's arc, zone, short line and hover body (the reference's copy).
  function disciplineView(list, minSample, periodLabel) {
    var D = discipline(list, minSample), settled = list.filter(isSettled), S = stats(settled);
    var withClv = settled.filter(function (b) { return clv(b) !== null; }), sp = stats(withClv.filter(function (b) { return clv(b) > 0; })), sn = stats(withClv.filter(function (b) { return clv(b) <= 0; }));
    var r2 = function (x) { return x === null ? DASH : sgn(x * 100); };
    var c = D.checks[0], k = D.checks[1], t = D.checks[2];
    var stakes = settled.map(function (b) { return b.stake; });
    c.arc = arcD(c.value === null ? 0 : c.value / 100); c.zone = zoneD(0.55, 1);
    c.short = S.beat + ' of ' + S.clvN + ' priced bets beat the close · target 55%+';
    c.body = S.beat + ' of ' + S.clvN + ' priced bets closed shorter than you took them. Bets that beat the close ran at ROI ' + r2(sp.roi) + '; the ones that didn\'t ran at ' + r2(sn.roi) + '. The close is the sharpest number you can measure yourself against.';
    k.arc = arcD(k.value === null ? 0 : (k.value - 0.5) / 1.5); k.zone = zoneD((0.85 - 0.5) / 1.5, (1.15 - 0.5) / 1.5);
    var pc = function (x, n) { return n ? x.toFixed(2) + '%' : DASH; };
    k.short = pc(k.afterLoss, k.nLoss) + ' after a loss vs ' + pc(k.afterWin, k.nWin) + ' after a win (n=' + k.nLoss + ' / ' + k.nWin + ') · target ×0.85 – ×1.15';
    k.body = 'Average stake ' + pc(k.afterLoss, k.nLoss) + ' after a losing bet against ' + pc(k.afterWin, k.nWin) + ' after a winning one (n=' + k.nLoss + ' / ' + k.nWin + '). A plan sets the stake before the match, not after the last result. Largest single stake '
      + (stakes.length ? Math.max.apply(null, stakes).toFixed(1) + '%' : DASH) + ' vs an average of ' + (stakes.length ? avg(stakes).toFixed(2) + '%' : DASH) + '.';
    t.arc = arcD(t.n ? (t.value - 1) / 2 : 0); t.zone = zoneD(0, (1.5 - 1) / 2);
    t.short = t.n ? 'Largest ' + t.maxSt.toFixed(1) + '% vs average ' + t.avgSt.toFixed(2) + '% · ' + t.big + ' of ' + t.n + ' bets over 1.5× · target ≤ ×1.5' : 'No settled bets in the period.';
    t.body = 'Your largest stake was ' + t.maxSt.toFixed(1) + '% against an average of ' + t.avgSt.toFixed(2) + '% over ' + t.n + ' bets. ' + t.big + ' bet' + (t.big === 1 ? '' : 's') + ' went in at 1.5× your average or more and ran at ROI '
      + r2(t.bigS.roi) + '; the rest ran at ' + r2(t.evenS.roi) + '. A plan sizes every bet the same way — the biggest stake should never be the one you remember.';
    D.head = 'Discipline · ' + periodLabel.toLowerCase();
    D.sum = D.bad + ' of ' + D.judged; D.sumKind = D.judged ? (D.bad ? 'neg' : 'pos') : 'lab';
    D.sumTxt = 'check' + (D.judged === 1 ? '' : 's') + ' need' + (D.bad === 1 ? 's' : '') + ' work · ' + D.n + ' bets' + (D.judged < 3 ? ' · ' + (3 - D.judged) + ' not judged yet' : '');
    return D;
  }

  // ── staking plans (README §7, the reference's PLANS; f(bet, cumulative %, previous {res, st})) ─────────────────────
  // `sw` = the swatch's token (tokens.css), how / when = the reference's explainer copy.
  var PLANS = [
    { name: 'Flat 1%', sw: 'tracker-plan-flat1', sub: 'every bet at 1% of the starting bankroll', f: function () { return 1; },
      how: '1% of the starting bankroll on every bet. The stake never moves.', when: 'The baseline: if your stakes cannot beat it, your sizing is costing you money.' },
    { name: 'Flat 2%', sw: 'tracker-plan-flat2', sub: 'every bet at 2% of the starting bankroll', f: function () { return 2; },
      how: 'Flat 1% at double the size. Same shape, twice the profit and twice the drawdown.', when: 'Only for an edge already proven at 1% — a 10-bet losing run costs 20%.' },
    { name: 'Compounding 1%', sw: 'text', sub: '1% of the bankroll as it stands · cumulative', f: function (b, cum) { return Math.max(0, 1 * (1 + cum / 100)); },
      how: '1% of the bankroll as it stands, so stakes grow when winning and shrink when losing.', when: 'Faster growth on a winning season; the biggest stakes land right after the best run.' },
    { name: 'To win 1%', sw: 'tracker-link-2', sub: 'stake = 1% ÷ (odds − 1) · same profit on every winner', f: function (b) { return Math.min(5, 1 / (b.odds - 1)); },
      how: 'Stake = 1% ÷ (odds − 1): every winner adds exactly 1%. Short prices get big stakes, cap 5%.', when: 'Smooth when your edge sits on favourites; a losing 1.25 shot costs 4%.' },
    { name: '¼ Kelly on CLV', sw: 'text-label', sub: 'sized on the close you did not know yet · hindsight', f: function (b) { var c = clv(b); if (c === null || c <= 0) return 0; return Math.min(3, 25 * c / (b.odds - 1)); },
      how: 'A quarter Kelly stake sized on how far the close moved your way; no stake when it did not. Cap 3%.', when: 'Hindsight — the ceiling to measure against, not a plan you can follow.' },
    { name: '½ Kelly on model', sw: 'tracker-plan-model', sub: 'sized on the Stennisfy fair price at posting · cap 3%',
      f: function (b) { if (!b.fair) return 0; var p = 1 / b.fair, k = b.odds - 1, fs = (p * k - (1 - p)) / k; return fs <= 0 ? 0 : Math.min(3, 50 * fs); },
      how: 'Half Kelly on the edge your own fair price showed at posting: stake = ½ × (p·(odds−1) − (1−p)) ÷ (odds−1). No stake when the model saw no edge. Cap 3%. No hindsight — the close is not used.',
      when: 'Honest Kelly — if this line beats your stakes, your model is sizing better than your gut; if it trails, the model is overconfident.' },
    { name: 'Odds-banded', sw: 'tracker-plan-banded', sub: '1.5% under 1.60 · 1% to 2.20 · 0.5% above', f: function (b) { return b.odds < 1.60 ? 1.5 : b.odds <= 2.20 ? 1 : 0.5; },
      how: 'Stake falls as the price rises: 1.5% under 1.60, 1% up to 2.20, 0.5% above. Every bet risks about the same swing.', when: 'Read it against your Odds-band breakdown — it helps when your longer prices are the leak.' },
    // Confidence tiers: not shown until Log a bet carries a Confidence field (Michael's ruling, 2026-10-29) — the stake
    // rule is kept and tested; CONFIDENCE_TIERS turns the chip on.
    { name: 'Confidence tiers', sw: 'tracker-plan-conf', hidden: true, sub: '1 · 2 · 3 units = 0.5 · 1 · 1.5% · inferred from your stake band', f: function (b) { return b.stake <= 1 ? 0.5 : b.stake <= 1.5 ? 1 : 1.5; },
      how: 'Three fixed sizes — 1 unit 0.5%, 2 units 1%, 3 units 1.5% — read off the stake band you logged until Log-a-bet carries a Confidence field. Shows whether the bets you sized big earned the size.',
      when: 'If this trails Flat 1%, your confidence is not information; if it leads, keep the tiers and make the field explicit.' },
    { name: 'Double after a loss', sw: 'neg', sub: '1%, doubled after each loss, back to 1% on a win · cap 8%', f: function (b, cum, prev) { return prev === null ? 1 : prev.res === 'lost' ? Math.min(8, prev.st * 2) : 1; },
      how: '1%, doubled after every loss, back to 1% on a win. Cap 8%.', when: 'The chase — wins the money back until the run that takes 15% in four bets.' }
  ];
  var YOUR_STAKES = { name: 'Your stakes', sw: 'tracker-ring', sub: 'as logged', f: function (b) { return b.stake; }, how: 'The stakes you actually logged — sized by feel, confidence and the bet before.' };
  var DEFAULT_PLAN = 'Compounding 1%', CONFIDENCE_TIERS = false;
  function shownPlans() { return PLANS.filter(function (p) { return !p.hidden || CONFIDENCE_TIERS; }); }
  function plan(name) { if (name === YOUR_STAKES.name) return YOUR_STAKES; for (var i = 0; i < PLANS.length; i++) if (PLANS[i].name === name) return PLANS[i]; return null; }
  // Replays the settled bets under a plan: same results, only the stake changes.
  function simulate(settled, name) {
    var p = plan(name); if (!p) return null;
    var c = 0, pk = 0, dd = 0, prev = null, arr = [0], sts = [];
    settled.forEach(function (b) {
      var r = b.res, s = p.f(b, c, prev);
      c += r === 'won' ? s * (b.odds - 1) : r === 'lost' ? -s : 0;
      arr.push(c); if (c > pk) pk = c; if (pk - c > dd) dd = pk - c; prev = { res: r, st: s }; sts.push(s);
    });
    return { name: p.name, arr: arr, end: c, dd: dd, sts: sts };
  }
  // The Staking view (README §7): your stakes vs one plan over the period's settled bets, date order — chart (SVG
  // 0 0 1256 226, plot x 36→1256, y 6→220), the gap fill, the delta strip, the explainers, the plan chips.
  function stakingView(list, planName) {
    var settled = list.filter(isSettled), other = plan(planName) ? planName : DEFAULT_PLAN, oP = plan(other);
    var yL = simulate(settled, YOUR_STAKES.name), oL = simulate(settled, other);
    var all = yL.arr.concat(oL.arr), mn = Math.min.apply(null, all.concat(0)), mx = Math.max.apply(null, all.concat(0)), span = (mx - mn) || 1;
    var SY = function (v) { return 6 + 214 * (mx - v) / span; }, SX = function (i) { return 36 + 1220 * i / Math.max(1, settled.length); };
    var step = span > 200 ? 50 : span > 80 ? 20 : span > 40 ? 10 : span > 16 ? 5 : span > 8 ? 2 : 1, ticks = [];
    for (var v = Math.ceil(mn / step) * step; v <= mx + 1e-9; v += step) { var vv = Math.round(v * 1e6) / 1e6; ticks.push({ y: SY(vv).toFixed(1), top: (SY(vv) - 5).toFixed(1) + 'px', label: (vv > 0 ? '+' : vv < 0 ? MINUS : '') + Math.abs(vv) + '%', zero: vv === 0 }); }
    var toPath = function (a) { return a.map(function (x, i) { return (i ? 'L' : 'M') + SX(i).toFixed(1) + ' ' + SY(x).toFixed(1); }).join(' '); };
    var area = toPath(yL.arr) + ' ' + oL.arr.slice().reverse().map(function (x, j) { return 'L' + SX(oL.arr.length - 1 - j).toFixed(1) + ' ' + SY(x).toFixed(1); }).join(' ') + ' Z';
    var worstMonth = function (arr) { var m = {}; settled.forEach(function (b, i) { var k = ym(b.date); m[k] = (m[k] || 0) + (arr[i + 1] - arr[i]); }); var vals = Object.keys(m).map(function (k) { return m[k]; }); return vals.length ? Math.min.apply(null, vals) : 0; };
    var bigLoss = function (arr) { var w = 0; for (var i = 1; i < arr.length; i++) w = Math.min(w, arr[i] - arr[i - 1]); return w; };
    var dRow = function (l, a, b) { var d = b - a; return { l: l, a: sgn(a), b: sgn(b), d: (d > 0 ? '+' : d < 0 ? MINUS : '') + Math.abs(d).toFixed(1), kind: d === 0 ? 'lab' : d > 0 ? 'pos' : 'neg' }; };
    var gap = oL.arr.map(function (x, i) { return x - yL.arr[i]; }), gMax = Math.max.apply(null, gap), gMin = Math.min.apply(null, gap);
    var st = function (a) { return { avg: avg(a), lo: a.length ? Math.min.apply(null, a) : 0, hi: a.length ? Math.max.apply(null, a) : 0 }; };
    var y = st(yL.sts), o = st(oL.sts.filter(function (x) { return x > 0; })), skipped = oL.sts.filter(function (x) { return x === 0; }).length, ahead = oL.end - yL.end;
    // A plan that places no bet (¼ Kelly with no closing prices) has no result: every plan figure is a dash, never 0.0%.
    var none = !oL.sts.some(function (x) { return x > 0; });
    if (none) dRow = function (l, a) { return { l: l, a: sgn(a), b: DASH, d: DASH, kind: 'lab' }; };
    return { n: settled.length, other: other, otherSub: oP.sub, otherSw: oP.sw, yourHow: YOUR_STAKES.how, otherHow: oP.how, otherWhen: oP.when, skipped: skipped,
      yTicks: ticks, yourPath: toPath(yL.arr), otherPath: none ? '' : toPath(oL.arr), area: none ? '' : area, areaKind: oL.end >= yL.end ? 'pos' : 'neg', none: none,
      meta: settled.length + ' bets · cumulative % of the starting bankroll',
      gapTxt: none ? 'plan ahead by up to ' + DASH + ', behind by up to ' + DASH : 'plan ahead by up to ' + gMax.toFixed(1) + '%, behind by up to ' + Math.abs(gMin).toFixed(1) + '%',
      deltas: [dRow('End', yL.end, oL.end), dRow('Max drawdown', -yL.dd, -oL.dd), dRow('Worst month', worstMonth(yL.arr), worstMonth(oL.arr)), dRow('Biggest single loss', bigLoss(yL.arr), bigLoss(oL.arr))],
      diffTxt: 'You averaged ' + y.avg.toFixed(2) + '% a bet (' + y.lo.toFixed(1) + '–' + y.hi.toFixed(1) + '%), the plan ' + (oL.sts.some(function (x) { return x > 0; }) ? o.avg.toFixed(2) + '% (' + o.lo.toFixed(1) + '–' + o.hi.toFixed(1) + '%)' : DASH)
        + (skipped ? ', skipping ' + skipped + ' of ' + settled.length + ' bets' : '') + '. Same results: ' + (none ? DASH + ' at the end, drawdown ' + DASH + '.' : (ahead >= 0 ? '+' : MINUS) + Math.abs(ahead).toFixed(1) + '% at the end, drawdown '
        + Math.abs(oL.dd - yL.dd).toFixed(1) + '% ' + (oL.dd <= yL.dd ? 'shallower' : 'deeper') + '.'),
      note: 'Same bets and results, only the stake changes. A plan is judged on the whole season, not the end figure alone: read End together with Max drawdown and Biggest single loss. The Kelly line uses the closing price you did not know at the time — a ceiling, not a plan.',
      plans: shownPlans().map(function (p) { return { name: p.name, how: p.how, sw: p.sw, on: p.name === other }; }) };
  }
  // The stake hint once a plan is applied (the reference's planStake); null = the plan needs the odds first / no plan.
  function planStake(name, settledAll, odds) {
    var cumNow = settledAll.reduce(function (a, b) { return a + pl(b); }, 0), last = settledAll[settledAll.length - 1] || null, o = odds > 1 ? odds : null;
    return name === 'Flat 1%' ? 1 : name === 'Flat 2%' ? 2 : name === 'Compounding 1%' ? Math.max(0, 1 * (1 + cumNow / 100))
      : name === 'To win 1%' ? (o ? Math.min(5, 1 / (o - 1)) : null)
      : name === 'Double after a loss' ? (last ? (last.res === 'lost' ? Math.min(8, last.stake * 2) : 1) : 1) : null;
  }

  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // The ROI bar: fill from the centre, clipped at ±40% → 50% of the track each side; no ROI → no bar.
  function roiBar(roi) {
    if (roi === null || roi === undefined) return { left: '50%', width: '0%', kind: 'lab' };
    var w = Math.min(Math.abs(roi), 0.4) / 0.4 * 50;
    return { left: (roi >= 0 ? 50 : 50 - w) + '%', width: w + '%', kind: roi >= 0 ? 'pos' : 'neg' };
  }
  // ── calendar · month cards (v26 README 7.4, chosen 2026-10-29) ─────────────────────────────────────────────────
  // € on a 10,000 € bankroll = P/L % × 100, rounded, true minus, thousands comma.
  function eur(p) { var e = Math.round(p * 100); return (e > 0 ? '+' : e < 0 ? MINUS : '') + Math.abs(e).toLocaleString('en-US'); }
  // The mini-calendar tint: three alpha steps on |P/L| in % — under 1.2 → 0.30, under 2.8 → 0.55, else 0.90; zero = flat.
  function tint(p) { var a = Math.abs(p); return { tone: p > 0 ? 'pos' : p < 0 ? 'neg' : 'flat', alpha: a < 1.2 ? 0.3 : a < 2.8 ? 0.55 : 0.9 }; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function dayRow(b) {
    var r = b.res;
    return { text: b.text, meta: [b.tour, b.market].filter(present).concat('@ ' + b.odds.toFixed(2), b.stake + '%').join(' · '),
      res: r ? r.toUpperCase() : 'PENDING', resKind: r === 'won' ? 'pos' : r === 'lost' ? 'neg' : r === 'void' ? 'lab' : 'link2',
      pl: r ? sgn(pl(b)) : DASH, plKind: r ? kind(pl(b)) : 'lab' };
  }
  // `bets` = the bankroll's bets in the shown period (the reference's season ledger; at All time every month a tile).
  // Month keys are ym() so a multi-year ledger keeps its years apart. openKey = the month whose planner is open (null =
  // none); hovKey = the day key under the pointer. `phrase` names the span in the meta line ("this season").
  function calendarView(bets, today, openKey, hovKey, phrase) {
    var byD = {}, byM = {};
    bets.forEach(function (b) {
      var k = dayKey(b.date), r = b.res; (byD[k] = byD[k] || { pl: 0, n: 0, pend: 0, w: 0, l: 0, bets: [] }).bets.push(b);
      if (r) { byD[k].pl += pl(b); byD[k].n++; if (r === 'won') byD[k].w++; else if (r === 'lost') byD[k].l++; } else byD[k].pend++;
      var m = ym(b.date); (byM[m] = byM[m] || []).push(b);
    });
    var keys = Object.keys(byM).map(Number).sort(function (x, y) { return x - y; });
    var cards = keys.map(function (k) {
      var y = Math.floor(k / 12), m = k % 12, settled = byM[k].filter(isSettled), s = settled.length ? stats(settled) : { n: 0, w: 0, l: 0, profit: 0, roi: null };
      var fd = (new Date(y, m, 1).getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate(), rows = [], dd = 0;
      for (var r = 0; r < 6; r++) {
        var cells = [];
        for (var c = 0; c < 7; c++) {
          var idx = r * 7 + c - fd, inM = idx >= 0 && idx < dim, d = new Date(y, m, 1 + idx), v = inM ? byD[dayKey(d)] : null, fut = d > today;
          if (v && v.n) dd++;
          var t = v && v.n ? tint(v.pl) : null;
          cells.push({ kind: !inM || fut ? 'out' : !v ? 'none' : v.pend && !v.n ? 'pend' : t.tone, alpha: t ? t.alpha : null, today: inM && sameDay(d, today),
            t: inM ? DN[c] + ' ' + fmtDY(d, today) + (v && v.n ? ' · ' + sgn(v.pl) + ' = ' + eur(v.pl) + ' €' : v && v.pend ? ' · ' + v.pend + ' pending' : fut ? '' : ' · no bets') : '' });
        }
        rows.push(cells);
      }
      return { key: k, name: MONTHS[m] + ' ' + y, pl: s.n ? sgn(s.profit) : DASH, plKind: s.n ? kind(s.profit) : 'lab', sub: s.n + ' bets · ' + s.w + EN + s.l + ' · ' + dd + ' betting days',
        roi: s.n ? sgn(s.roi === null ? null : s.roi * 100) : DASH, roiKind: s.n ? kind(s.roi) : 'lab', on: openKey === k, rows: rows };
    });
    var open = null;
    if (openKey !== null && byM[openKey]) {
      var y2 = Math.floor(openKey / 12), m2 = openKey % 12, settled2 = byM[openKey].filter(isSettled), s2 = settled2.length ? stats(settled2) : null;
      var fd2 = (new Date(y2, m2, 1).getDay() + 6) % 7, dim2 = new Date(y2, m2 + 1, 0).getDate(), rowsN = Math.ceil((fd2 + dim2) / 7), prow = [], dayList = [];
      for (var r2 = 0; r2 < rowsN; r2++) {
        var cells2 = [], wpl = 0, wn = 0, any = false;
        for (var c2 = 0; c2 < 7; c2++) {
          var idx2 = r2 * 7 + c2 - fd2, inM2 = idx2 >= 0 && idx2 < dim2, d2 = new Date(y2, m2, 1 + idx2), hk = dayKey(d2), v2 = inM2 ? byD[hk] : null, has = !!(v2 && (v2.n || v2.pend)), last = r2 >= rowsN - 2;
          if (v2 && v2.n) { wpl += v2.pl; wn += v2.n; any = true; dayList.push({ d: d2, c: c2, v: v2 }); }
          cells2.push({ key: hk, dt: String(d2.getDate()), dtKind: !inM2 ? 'out' : has ? 'has' : 'none', fig: v2 && v2.n ? eur(v2.pl) : v2 && v2.pend ? '·' : '', figKind: v2 && v2.n ? kind(v2.pl) : 'lab',
            bg: !inM2 ? 'out' : v2 && v2.n ? (v2.pl > 0 ? 'pos' : v2.pl < 0 ? 'neg' : 'flat') : v2 && v2.pend ? 'pend' : 'empty', today: inM2 && sameDay(d2, today), has: has,
            // W–L counts losses — a void is neither (the reference's w–(n−w) reads a void as a loss; no void on its seed)
            sub: has ? (v2.n ? v2.n + ' settled' + (v2.pend ? ' · ' + v2.pend + ' pending' : '') + ' · ' + v2.w + EN + v2.l : v2.pend + ' pending') : '',
            short: has ? (v2.n ? v2.w + EN + v2.l : v2.pend + ' pend.') : '', showPop: has && hovKey === hk, right: c2 > 3, above: last,
            title: DN[c2] + ' ' + fmtDY(d2, today), rows: has ? v2.bets.map(dayRow) : [] });
        }
        prow.push({ cells: cells2, pl: any ? eur(wpl) : DASH, plKind: any ? kind(wpl) : 'lab', n: any ? wn + (wn === 1 ? ' bet' : ' bets') : '', wpl: wpl, any: any });
      }
      var bd = dayList.length ? dayList.reduce(function (p, x) { return x.v.pl > p.v.pl ? x : p; }, dayList[0]) : null;
      var wd = dayList.length ? dayList.reduce(function (p, x) { return x.v.pl < p.v.pl ? x : p; }, dayList[0]) : null;
      var wks = prow.filter(function (x) { return x.any; }), bw = wks.length ? wks.reduce(function (p, x) { return x.wpl > p.wpl ? x : p; }, wks[0]) : null;
      var wr = s2 && s2.w + s2.l ? Math.round(100 * s2.w / (s2.w + s2.l)) + '%' : DASH;
      open = { key: openKey, title: MONTHS[m2] + ' ' + y2, sub: s2 ? s2.n + ' settled bets · ' + s2.w + EN + s2.l + (s2.v ? EN + s2.v + ' void' : '') + ' · ' + dayList.length + ' betting days' : 'No settled bets yet', rows: prow,
        stats: [
          { l: 'P/L', v: s2 ? sgn(s2.profit) : DASH, k: s2 ? kind(s2.profit) : 'lab', s: '' },
          { l: 'ROI', v: s2 ? sgn(s2.roi === null ? null : s2.roi * 100) : DASH, k: s2 ? kind(s2.roi) : 'lab', s: '' },
          { l: 'Win rate', v: wr, k: 'ink', s: '' },
          { l: 'Avg CLV', v: s2 && s2.clv !== null ? sgn(s2.clv * 100) : DASH, k: s2 ? kind(s2.clv) : 'lab', s: '' },
          { l: 'Best day', v: bd ? eur(bd.v.pl) + ' €' : DASH, k: bd ? kind(bd.v.pl) : 'lab', s: bd ? DN[bd.c] + ' ' + fmtDY(bd.d, today) : '' },
          { l: 'Worst day', v: wd ? eur(wd.v.pl) + ' €' : DASH, k: wd ? kind(wd.v.pl) : 'lab', s: wd ? DN[wd.c] + ' ' + fmtDY(wd.d, today) : '' },
          { l: 'Best week', v: bw ? eur(bw.wpl) + ' €' : DASH, k: bw ? kind(bw.wpl) : 'lab', s: bw ? bw.n : '' },
          { l: 'Up days', v: dayList.filter(function (x) { return x.v.pl > 0; }).length + ' of ' + dayList.length, k: 'ink', s: '' }] };
    }
    var days = Object.keys(byD).map(function (k) { return byD[k]; }), daysWith = days.filter(function (v) { return v.n; }).length, green = days.filter(function (v) { return v.pl > 0; }).length;
    var SA = stats(bets.filter(isSettled));
    return { cards: cards, keys: keys, open: open, meta: daysWith + ' betting days ' + (phrase || 'this season') + ' · ' + green + ' finished up · ' + (daysWith - green) + ' down or flat',
      sumSub: SA.n + ' bets · ' + SA.w + EN + SA.l, sumPl: sgn(SA.profit), sumKind: kind(SA.profit) };
  }
  function monthPop(k, bets, today) {
    var list = bets.slice().sort(function (a, b) { return b.date - a.date || b.id - a.id; }), st = stats(list);
    return { title: ymName(k), sub: st.n + ' settled bets · ' + st.w + EN + st.l + (st.v ? EN + st.v + ' void' : '') + ' · ' + st.staked.toFixed(1) + '% staked',
      stats: [{ l: 'P/L', v: sgn(st.profit), kind: kind(st.profit) }, { l: 'ROI', v: sgn(st.roi === null ? null : st.roi * 100), kind: st.roi === null ? 'lab' : kind(st.roi) },
        { l: 'Win rate', v: st.w + st.l ? Math.round(100 * st.w / (st.w + st.l)) + '%' : DASH, kind: st.w + st.l ? 'ink' : 'lab' },
        { l: 'Avg CLV', v: st.clv === null ? DASH : sgn(st.clv * 100), kind: kind(st.clv) }],
      rows: list.map(function (b) {
        var c = clv(b);
        return { date: fmtDY(b.date, today), resKind: b.res === 'won' ? 'pos' : b.res === 'lost' ? 'neg' : 'lab', text: b.text, meta: [b.tour, LEVEL[b.level], b.surface].filter(present).join(' · '),
          market: b.market ? b.market + (b.line ? ' ' + b.line : '') : DASH, odds: b.odds.toFixed(2), close: b.close ? b.close.toFixed(2) : DASH,
          clv: c === null ? DASH : sgn(c * 100), clvKind: kind(c), stake: b.stake.toFixed(1) + '%', res: b.res.toUpperCase(), pl: sgn(pl(b)), plKind: kind(pl(b)) };
      }) };
  }

  // ── period + filters ────────────────────────────────────────────────────────────────────────────────────────────
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function parseDay(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  // Last 30 / 90 days · Season (1 January →) · Custom (inclusive dates); `today` is a local-midnight Date.
  function periodWindow(per, range, today) {
    var from = per === '30d' ? addDays(today, -30) : per === '90d' ? addDays(today, -90) : per === 'custom' ? parseDay(range.from) : per === 'all' ? new Date(1970, 0, 1) : new Date(today.getFullYear(), 0, 1);
    var to = per === 'custom' ? new Date(parseDay(range.to).getTime() + 86399999) : new Date(2100, 0, 1);
    return { from: from, to: to };
  }
  function inPeriod(list, win) { return list.filter(function (b) { return b.date >= win.from && b.date <= win.to; }); }
  // AND across groups, OR within a group; `except` leaves one group out (the cross-adjusted menu counts).
  function passFilters(b, F, except) { return Object.keys(F).every(function (k) { return k === except || !F[k].length || F[k].indexOf(key(b, k)) >= 0; }); }
  function applyFilters(list, F) { return list.filter(function (b) { return passFilters(b, F, null); }); }
  function filterCount(perList, F, k, opt) { return perList.filter(function (b) { return passFilters(b, F, k) && key(b, k) === opt; }).length; }

  // ── certification + ledger ──────────────────────────────────────────────────────────────────────────────────────
  // A result is locked once the store has stamped lockedAt (explicit Lock, or a historical result — bettracker-store).
  function isLocked(b) { return isSettled(b) && !!b.lockedAt; }
  function certText(all) {
    var s = all.filter(isSettled), n = s.filter(isLocked).length;
    return s.length ? 'Certified · ' + n + ' of ' + s.length + ' results locked' : 'Certified ledger · nothing settled yet';
  }
  function periodPhrase(per, win, range, today) {
    return per === 'season' ? 'whole season' : per === 'all' ? 'whole bankroll, since the first bet' : per === 'custom' ? fmtDY(win.from, today) + ' → ' + fmtDY(parseDay(range.to), today) : 'last ' + per.replace('d', ' days');
  }
  // `all` = the bankroll's bets, oldest first; `list` = the period + filters; `perList` = the period only.
  function headMeta(all, list, perList, per, win, range, nFilters, today) {
    var first = all.length ? all[0].date : today, pending = list.filter(function (b) { return !isSettled(b); }).length;
    return all.filter(isSettled).length + ' settled since ' + fmtDY(first, today) + ' · ' + pending + ' pending · stakes in % of bankroll · ' + periodPhrase(per, win, range, today) + ' shown'
      + (nFilters ? ' · ' + nFilters + ' filter' + (nFilters > 1 ? 's' : '') + ' on, ' + list.length + ' of ' + perList.length + ' bets' : '');
  }
  // Pending first, then date desc, then id desc.
  function sortLedger(list) {
    return list.slice().sort(function (a, b) { return (isSettled(b) ? 0 : 1) - (isSettled(a) ? 0 : 1) || b.date - a.date || b.id - a.id; });
  }
  function ledgerFilter(sorted, lf, month) {
    return sorted.filter(function (b) {
      var r = b.res, okR = lf === 'all' || (lf === 'pending' ? !r : r === lf), okM = month === null || month === undefined || ym(b.date) === month;
      return okR && okM;
    });
  }
  // The month chips: All + one per month with bets, newest first; P/L over the chip's settled bets, dash when none.
  // A chip is a calendar month (ym); its label adds the year only when the list spans more than one year.
  function ledgerMonths(list) {
    var g = {}, years = {}; list.forEach(function (b) { var k = ym(b.date); (g[k] = g[k] || []).push(b); years[b.date.getFullYear()] = 1; });
    var multi = Object.keys(years).length > 1;
    var chip = function (k, label, arr) { var s = stats(arr); return { month: k, label: label, n: arr.length, pl: s.n ? sgn(s.profit) : DASH, plKind: s.n ? kind(s.profit) : 'lab' }; };
    return [chip(null, 'All', list)].concat(Object.keys(g).map(Number).sort(function (a, b) { return b - a; }).map(function (k) { return chip(k, ymLabel(k, multi), g[k]); }));
  }
  var LEDGER_ROWS = 14;
  function ledgerMeta(shown, n) { return shown + ' of ' + n + ' bets in the period · pending first · settle a bet and every figure above recomputes'; }
  function ledgerFoot(n) { return 'Showing ' + Math.min(LEDGER_ROWS, n) + ' of ' + n + ' · a result you settle here can be undone until you lock it · a locked result (blue tick) is frozen for good'; }
  // A field the bet does not carry (an import the token table did not fill) reads as a dash, never "undefined".
  function betMeta(b) {
    // F5: tour · level · surface joins the parts that are there — no leading " · ", no dash for a blank tournament
    return [b.tour, LEVEL[b.level], b.surface].filter(present).concat(b.type && b.type !== 'Single' ? [b.type, b.legs + ' legs'] : [])
      .concat(b.timing === 'live' ? ['Live'] : []).concat(b.tilt ? ['after two losses'] : []).join(' · ');
  }
  // A bankroll card: figures over the bankroll's whole life.
  function bankCard(bets) {
    var s = stats(bets);
    return { n: s.n, meta: s.n ? s.n + ' settled' : 'no bets yet', roi: s.n ? sgn(s.roi === null ? null : s.roi * 100) : DASH, roiKind: s.n ? kind(s.roi) : 'lab',
      profit: s.n ? sgn(s.profit) : DASH, profitKind: s.n ? kind(s.profit) : 'lab', archivedMeta: s.n ? s.n + ' settled · ' + sgn(s.profit) : 'empty' };
  }

  // ── Log a bet (README §3) ───────────────────────────────────────────────────────────────────────────────────────
  function fitLegs(legs, type) {
    var n = type === 'Single' ? 1 : type === 'Combination' ? 2 : Math.max(2, legs.length), out = legs.slice(0, n);
    while (out.length < n) out.push({ text: '', odds: '' });
    return out;
  }
  function legOdds(legs) { return legs.map(function (lg) { return parseFloat(lg.odds); }); }
  function legsOk(legs) { var o = legOdds(legs); return legs.every(function (lg, i) { return String(lg.text).trim().length > 0 && o[i] >= 1.01; }); }
  // Product of the legs, 2 dp; NaN ("—") until every leg is valid.
  function combinedOdds(legs) { return legsOk(legs) ? +legOdds(legs).reduce(function (a, o) { return a * o; }, 1).toFixed(2) : NaN; }
  function legsNote(form) {
    var ok = legsOk(form.legs), o = legOdds(form.legs), c = combinedOdds(form.legs);
    var prod = ok ? ': ' + o.map(function (x) { return x.toFixed(2); }).join(' × ') + ' = ' + c.toFixed(2) : '';
    return form.type === 'Single' ? 'One selection, one price.'
      : form.type === 'Combination' ? 'Two legs, one ticket — the odds multiply' + (ok ? prod : ' (e.g. 1.30 × 1.20 = 1.56)') + '. All legs must win.'
      : 'Any number of legs, one ticket — the odds multiply' + prod + '. All legs must win.';
  }
  function formCheck(form) {
    var ok = legsOk(form.legs), odds = combinedOdds(form.legs);
    var market = form.market === 'Other' ? String(form.marketOther).trim() : form.market, book = form.book === 'Other' ? String(form.bookOther).trim() : form.book;
    var stake = parseFloat(form.stake), valid = ok && stake >= 0.1 && stake <= 10 && market.length > 0 && book.length > 0;
    var text = form.legs.map(function (lg) { return String(lg.text).trim(); }).join(' + ');
    var hint = valid ? 'Ready — the ticket on the right is what gets posted.' : 'Every leg needs text and odds (1.01+) · stake 0.1 – 10% · a market and a bookmaker.';
    return { valid: valid, legsOk: ok, odds: odds, oddsText: ok ? odds.toFixed(2) : DASH, market: market, book: book, stake: stake, text: text, hint: hint };
  }
  // The Ticket (v26 Log a bet, right column): what Post bet will write, field by field; "—" until it is there.
  function ticket(form) {
    var c = formCheck(form), st = c.stake > 0 ? c.stake : null;
    return { sel: c.text || 'Your selection', hasSel: !!c.text, ctx: [String(form.tour).trim() || 'Tournament', LEVEL[form.level] || form.level, form.surface].join(' · '),
      type: form.type + ' · ' + (form.timing === 'live' ? 'live' : 'pre-match'), market: c.market || DASH, book: c.book || DASH,
      odds: c.legsOk ? c.odds.toFixed(2) : DASH, stake: st ? st.toFixed(2) + '% of bankroll' : DASH,
      win: c.valid ? '+' + (c.stake * (c.odds - 1)).toFixed(2) + '%' : DASH, winKind: c.valid ? 'pos' : 'lab',
      lose: c.valid ? MINUS + c.stake.toFixed(2) + '%' : DASH, loseKind: c.valid ? 'neg' : 'lab' };
  }
  // The pending bet a valid form posts (the reference's onPost): today's date, close null, tilt false.
  function newBet(form, bankId, date, id) {
    var c = formCheck(form); if (!c.valid) return null;
    return { id: id, date: date, tour: String(form.tour).trim() || DASH, level: form.level, surface: form.surface, market: c.market, line: null, book: c.book,
      odds: c.odds, close: null, fair: null, stake: c.stake, res: null, timing: form.timing, type: form.type, legs: form.legs.length, text: c.text, bank: bankId, tilt: false, pending: true };
  }

  var api = {
    DASH: DASH, MINUS: MINUS, EN: EN, MIN_SAMPLE: MIN_SAMPLE, MIN_FLOOR: MIN_FLOOR, LEVEL: LEVEL, LEVEL_KEYS: LEVEL_KEYS, SURFACES: SURFACES, BANDS: BANDS,
    DAYS: DAYS, DN: DN, MON: MON, MONTHS: MONTHS, DIMS: DIMS, PERIODS: PERIODS, MARKETS: MARKETS, BOOKS: BOOKS, TYPES: TYPES, PLANS: PLANS, YOUR_STAKES: YOUR_STAKES,
    LEDGER_ROWS: LEDGER_ROWS,
    segTitle: segTitle, segCurve: segCurve, verdicts: verdicts, breakdown: breakdown, arcD: arcD, zoneD: zoneD, disciplineView: disciplineView,
    calendarView: calendarView, tint: tint, eur: eur, dayRow: dayRow, monthPop: monthPop, roiBar: roiBar, dayKey: dayKey,
    heroTiles: heroTiles, heroCurve: heroCurve, filterMenu: filterMenu, nFilters: nFilters, filtersLabel: filtersLabel, filtersFoot: filtersFoot,
    sgn: sgn, kind: kind, fmtD: fmtD, fmtDY: fmtDY, ym: ym, ymLabel: ymLabel, ymName: ymName, dow: dow, isSettled: isSettled, pl: pl, clv: clv, stats: stats, cumulative: cumulative, heroFigures: heroFigures,
    band: band, key: key, group: group, minN: minN, segments: segments, discipline: discipline,
    plan: plan, simulate: simulate, stakingView: stakingView, DEFAULT_PLAN: DEFAULT_PLAN, planStake: planStake,
    addDays: addDays, parseDay: parseDay, periodWindow: periodWindow, inPeriod: inPeriod, passFilters: passFilters, applyFilters: applyFilters, filterCount: filterCount,
    isLocked: isLocked, certText: certText, periodPhrase: periodPhrase, headMeta: headMeta, sortLedger: sortLedger, ledgerFilter: ledgerFilter,
    ledgerMonths: ledgerMonths, ledgerMeta: ledgerMeta, ledgerFoot: ledgerFoot, betMeta: betMeta, bankCard: bankCard,
    fitLegs: fitLegs, legsOk: legsOk, combinedOdds: combinedOdds, legsNote: legsNote, formCheck: formCheck, newBet: newBet,
    marketDetail: marketDetail, shownPlans: shownPlans, CONFIDENCE_TIERS: CONFIDENCE_TIERS, curveScale: curveScale, CURVE_LABEL_GAP: CURVE_LABEL_GAP, CURVE_PX: CURVE_PX, CURVE_MAX_TICKS: CURVE_MAX_TICKS, curveHover: curveHover, ticket: ticket, present: present, monYear: monYear
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BetTrackerMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
