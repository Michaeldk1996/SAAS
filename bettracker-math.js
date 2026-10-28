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
  var PERIODS = { '30d': 'Last 30 days', '90d': 'Last 90 days', season: 'Season', custom: 'Custom range' };
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
  function dow(d) { return DN[(d.getDay() + 6) % 7]; }

  // ── per bet ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // P/L in % of bankroll: won → stake × (odds − 1); lost → −stake; void and pending → 0 (pending is never in a sum).
  function pl(b) { var r = b.res; if (!r || r === 'void') return 0; return r === 'won' ? b.stake * (b.odds - 1) : -b.stake; }
  // CLV = your price ÷ closing price − 1; null without a close.
  function clv(b) { return num(b.close) && b.close > 0 ? b.odds / b.close - 1 : null; }

  // The reference's stats(), over the settled bets of `list` in the order given — with the ROI ruling.
  function stats(list) {
    var s = list.filter(isSettled);
    var profit = 0, staked = 0, stakedWL = 0, w = 0, l = 0, v = 0, clvS = 0, clvN = 0, beat = 0, cum = 0, peak = 0, dd = 0, ddIdx = -1, run = 0, worst = 0, wrun = 0, best = 0;
    s.forEach(function (b, i) {
      var r = b.res, p = pl(b);
      profit += p; staked += b.stake;
      if (r === 'won') { w++; stakedWL += b.stake; } else if (r === 'lost') { l++; stakedWL += b.stake; } else v++;
      var c = clv(b); if (c !== null) { clvS += c; clvN++; if (c > 0) beat++; }
      cum += p; if (cum > peak) peak = cum; if (peak - cum > dd) { dd = peak - cum; ddIdx = i; }
      if (r === 'lost') { run++; if (run > worst) worst = run; wrun = 0; } else if (r === 'won') { run = 0; wrun++; if (wrun > best) best = wrun; }
    });
    return { n: s.length, profit: profit, staked: staked, stakedWL: stakedWL, roi: stakedWL ? profit / stakedWL : null, w: w, l: l, v: v,
      clv: clvN ? clvS / clvN : null, clvN: clvN, beat: beat, dd: dd, ddIdx: ddIdx, worst: worst, best: best, winRate: (w + l) ? w / (w + l) : null };
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

  // ── segments ────────────────────────────────────────────────────────────────────────────────────────────────────
  function band(o) { return o <= 1.35 ? BANDS[0] : o <= 1.6 ? BANDS[1] : o <= 1.9 ? BANDS[2] : o <= 2.2 ? BANDS[3] : o <= 2.6 ? BANDS[4] : o <= 3.2 ? BANDS[5] : BANDS[6]; }
  function key(b, dim) {
    if (dim === 'odds') return band(b.odds);
    if (dim === 'level') return LEVEL[b.level];
    if (dim === 'timing') return b.timing === 'live' ? 'Live' : 'Pre-match';
    if (dim === 'situation') return b.tilt ? 'After two losses that day' : 'Normal rhythm';
    if (dim === 'dow') return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][b.date.getDay()];
    return b[dim];
  }
  function group(list, dim) {
    var g = {}, order = [];
    list.forEach(function (b) { if (!isSettled(b)) return; var k = key(b, dim); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(b); });
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
    // 3 · third-or-later bet on a day already down two
    var st = stats(settled.filter(function (b) { return b.tilt; })), calm = stats(settled.filter(function (b) { return !b.tilt; }));
    var tilt = { label: 'Third bet after two losses', value: st.n ? st.roi : null, n: st.n, rest: calm,
      verdict: st.n < m ? 'EARLY · n=' + st.n : st.roi < -0.05 ? 'TILT' : 'UNDER CONTROL',
      tone: st.n < m ? 'amber' : st.roi < -0.05 ? 'neg' : 'pos',
      fig: st.n ? sgn(st.roi === null ? null : st.roi * 100) : DASH, ok: st.n >= m ? st.roi >= -0.05 : null };
    var checks = [close, chase, tilt];
    var judged = checks.filter(function (c) { return c.ok !== null; }), bad = judged.filter(function (c) { return !c.ok; }).length;
    return { checks: checks, judged: judged.length, bad: bad, n: settled.length, minN: m,
      badge: judged.length ? bad + '/' + judged.length : '', badgeTone: bad ? 'neg' : 'pos' };
  }

  // ── staking plans (README §7, the reference's PLANS; f(bet, cumulative %, previous {res, st})) ─────────────────────
  var PLANS = [
    { name: 'Flat 1%', sub: 'every bet at 1% of the starting bankroll', f: function () { return 1; } },
    { name: 'Flat 2%', sub: 'every bet at 2% of the starting bankroll', f: function () { return 2; } },
    { name: 'Compounding 1%', sub: '1% of the bankroll as it stands · cumulative', f: function (b, cum) { return Math.max(0, 1 * (1 + cum / 100)); } },
    { name: 'To win 1%', sub: 'stake = 1% ÷ (odds − 1) · same profit on every winner', f: function (b) { return Math.min(5, 1 / (b.odds - 1)); } },
    { name: '¼ Kelly on CLV', sub: 'sized on the close you did not know yet · hindsight', f: function (b) { var c = clv(b); if (c === null || c <= 0) return 0; return Math.min(3, 25 * c / (b.odds - 1)); } },
    { name: 'Double after a loss', sub: '1%, doubled after each loss, back to 1% on a win · cap 8%', f: function (b, cum, prev) { return prev === null ? 1 : prev.res === 'lost' ? Math.min(8, prev.st * 2) : 1; } }
  ];
  var YOUR_STAKES = { name: 'Your stakes', sub: 'as logged', f: function (b) { return b.stake; } };
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
  // The stake hint once a plan is applied (the reference's planStake); null = the plan needs the odds first / no plan.
  function planStake(name, settledAll, odds) {
    var cumNow = settledAll.reduce(function (a, b) { return a + pl(b); }, 0), last = settledAll[settledAll.length - 1] || null, o = odds > 1 ? odds : null;
    return name === 'Flat 1%' ? 1 : name === 'Flat 2%' ? 2 : name === 'Compounding 1%' ? Math.max(0, 1 * (1 + cumNow / 100))
      : name === 'To win 1%' ? (o ? Math.min(5, 1 / (o - 1)) : null)
      : name === 'Double after a loss' ? (last ? (last.res === 'lost' ? Math.min(8, last.stake * 2) : 1) : 1) : null;
  }

  // ── calendar heat (README §5): a settled day's cell alpha from its P/L in % of bankroll ──────────────────────────
  function heatAlpha(plPct) { return Math.min(1, 0.3 + Math.abs(plPct) / 3 * 0.7); }

  // ── period + filters ────────────────────────────────────────────────────────────────────────────────────────────
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function parseDay(s) { var p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  // Last 30 / 90 days · Season (1 January →) · Custom (inclusive dates); `today` is a local-midnight Date.
  function periodWindow(per, range, today) {
    var from = per === '30d' ? addDays(today, -30) : per === '90d' ? addDays(today, -90) : per === 'custom' ? parseDay(range.from) : new Date(today.getFullYear(), 0, 1);
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
  function periodPhrase(per, win, range) {
    return per === 'season' ? 'whole season' : per === 'custom' ? fmtD(win.from) + ' → ' + fmtD(parseDay(range.to)) : 'last ' + per.replace('d', ' days');
  }
  // `all` = the bankroll's bets, oldest first; `list` = the period + filters; `perList` = the period only.
  function headMeta(all, list, perList, per, win, range, nFilters, today) {
    var first = all.length ? all[0].date : today, pending = list.filter(function (b) { return !isSettled(b); }).length;
    return all.filter(isSettled).length + ' settled since ' + fmtD(first) + ' · ' + pending + ' pending · stakes in % of bankroll · ' + periodPhrase(per, win, range) + ' shown'
      + (nFilters ? ' · ' + nFilters + ' filter' + (nFilters > 1 ? 's' : '') + ' on, ' + list.length + ' of ' + perList.length + ' bets' : '');
  }
  // Pending first, then date desc, then id desc.
  function sortLedger(list) {
    return list.slice().sort(function (a, b) { return (isSettled(b) ? 0 : 1) - (isSettled(a) ? 0 : 1) || b.date - a.date || b.id - a.id; });
  }
  function ledgerFilter(sorted, lf, month) {
    return sorted.filter(function (b) {
      var r = b.res, okR = lf === 'all' || (lf === 'pending' ? !r : r === lf), okM = month === null || month === undefined || b.date.getMonth() === month;
      return okR && okM;
    });
  }
  // The month chips: All + one per month with bets, newest first; P/L over the chip's settled bets, dash when none.
  function ledgerMonths(list) {
    var g = {}; list.forEach(function (b) { var k = b.date.getMonth(); (g[k] = g[k] || []).push(b); });
    var chip = function (k, label, arr) { var s = stats(arr); return { month: k, label: label, n: arr.length, pl: s.n ? sgn(s.profit) : DASH, plKind: s.n ? kind(s.profit) : 'lab' }; };
    return [chip(null, 'All', list)].concat(Object.keys(g).map(Number).sort(function (a, b) { return b - a; }).map(function (k) { return chip(k, MON[k], g[k]); }));
  }
  var LEDGER_ROWS = 14;
  function ledgerMeta(shown, n) { return shown + ' of ' + n + ' bets in the period · pending first · settle a bet and every figure above recomputes'; }
  function ledgerFoot(n) { return 'Showing ' + Math.min(LEDGER_ROWS, n) + ' of ' + n + ' · a result you settle here can be undone until you lock it · a locked result (blue tick) is frozen for good'; }
  function betMeta(b) {
    return b.tour + ' · ' + LEVEL[b.level] + ' · ' + b.surface + (b.type && b.type !== 'Single' ? ' · ' + b.type + ' · ' + b.legs + ' legs' : '')
      + (b.timing === 'live' ? ' · Live' : '') + (b.tilt ? ' · after two losses' : '');
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
    var hint = valid
      ? 'You post: ' + form.type.toLowerCase() + ' · ' + text + ' · ' + market + ' @ ' + odds.toFixed(2) + ' · ' + book + ' · ' + stake + '% of bankroll · '
        + (form.timing === 'live' ? 'live, in play' : 'pre-match') + ' · wins → +' + (stake * (odds - 1)).toFixed(2) + '% · loses → ' + MINUS + stake.toFixed(2)
        + '%. It lands as pending; settle it in the ledger, then lock it.'
      : 'Every leg needs its text and odds (1.01 or more); a stake between 0.1 and 10%, a market and a bookmaker are required — type your own when the lists do not have them. Type and Pre-match / Live are stored with the bet.';
    return { valid: valid, legsOk: ok, odds: odds, oddsText: ok ? odds.toFixed(2) : DASH, market: market, book: book, stake: stake, text: text, hint: hint };
  }
  // The pending bet a valid form posts (the reference's onPost): today's date, close null, tilt false.
  function newBet(form, bankId, date, id) {
    var c = formCheck(form); if (!c.valid) return null;
    return { id: id, date: date, tour: String(form.tour).trim() || DASH, level: form.level, surface: form.surface, market: c.market, line: null, book: c.book,
      odds: c.odds, close: null, stake: c.stake, res: null, timing: form.timing, type: form.type, legs: form.legs.length, text: c.text, bank: bankId, tilt: false, pending: true };
  }

  var api = {
    DASH: DASH, MINUS: MINUS, EN: EN, MIN_SAMPLE: MIN_SAMPLE, MIN_FLOOR: MIN_FLOOR, LEVEL: LEVEL, LEVEL_KEYS: LEVEL_KEYS, SURFACES: SURFACES, BANDS: BANDS,
    DAYS: DAYS, DN: DN, MON: MON, MONTHS: MONTHS, DIMS: DIMS, PERIODS: PERIODS, MARKETS: MARKETS, BOOKS: BOOKS, TYPES: TYPES, PLANS: PLANS, YOUR_STAKES: YOUR_STAKES,
    LEDGER_ROWS: LEDGER_ROWS,
    sgn: sgn, kind: kind, fmtD: fmtD, dow: dow, isSettled: isSettled, pl: pl, clv: clv, stats: stats, cumulative: cumulative, heroFigures: heroFigures,
    band: band, key: key, group: group, minN: minN, segments: segments, discipline: discipline,
    plan: plan, simulate: simulate, planStake: planStake, heatAlpha: heatAlpha,
    addDays: addDays, parseDay: parseDay, periodWindow: periodWindow, inPeriod: inPeriod, passFilters: passFilters, applyFilters: applyFilters, filterCount: filterCount,
    isLocked: isLocked, certText: certText, periodPhrase: periodPhrase, headMeta: headMeta, sortLedger: sortLedger, ledgerFilter: ledgerFilter,
    ledgerMonths: ledgerMonths, ledgerMeta: ledgerMeta, ledgerFoot: ledgerFoot, betMeta: betMeta, bankCard: bankCard,
    fitLegs: fitLegs, legsOk: legsOk, combinedOdds: combinedOdds, legsNote: legsNote, formCheck: formCheck, newBet: newBet
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BetTrackerMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
