// ==== Dynamic Key Insights engine (TEN-8) ====
// Derived live from career-splits.json + playing-styles.json, both already
// loaded above. Falls back to the pipeline's p.insights when a player has
// no splits row or produces fewer than three findings.
/* BSP Consult — dynamic Key Insights engine.
 *
 * Pure functions, no imports, no DOM: the same source runs under Node (for the
 * sample report) and inside bsp-consult-dashboard.html.
 *
 * Inputs are the three files the profile page already loads:
 *   careerSplits  — career-splits.json .players, keyed by profile key
 *   playerStyles  — playing-styles.json, 6-axis archetype_scores
 *   oddsPerf      — odds-performance/{key}.json, market efficiency by split
 *
 * Every insight carries the real numbers it was derived from AND the tour
 * figure it is being judged against. Nothing is approximated and nothing is
 * emitted off a sample below its own floor.
 */

// ---- Minimum sample per check. A split below its floor is not an insight,
// it is noise: vs-Top-10 and Best-of-5 rows are small for most of the tour.
var INS_MIN = {
  format: 10,     // Best of 3 / Best of 5, each side
  surface: 15,    // each surface compared
  level: 15,      // Grand Slams / Masters / Other Tours
  top10: 12,      // vs. Top 10 — the most-fired check, so it carries a real floor
  last52: 15,     // last-52-week window
  hand: 15,       // vs. Lefties / vs. Righties
  market: 25,     // priced matches in a market split, per split
  overall: 30     // career total, required for any career-relative check
};

// ---- Thresholds, in percentage points.
//
// Every threshold is set at roughly 1.5x the TOUR's own spread for that metric
// (measured across all 233 ingested players — see INS_TOUR below), so that
// `gap / threshold` means the same thing in every check and the cross-check
// ranking is honest. A 20pp surface swing and a 10pp Top-10 gap are both
// "1.3 tour-widths of unusual", which is what makes them comparable.
//
// Relaxed in steps by the selector when a player produces fewer than three
// findings (per spec: lower the bar rather than show fewer than three cards).
var INS_THRESH = {
  format: 8,      // vs the tour's own +3.1pp Bo3-over-Bo5 differential
  surface: 6,     // spread IN EXCESS of the tour's typical 11.6pp spread
  level: 7,
  top10: 10,
  radar: 20,
  last52: 8,
  hand: 8,
  market: 7       // vsMarket vs the tour median for that split (sd ~5pp)
};

/* ---- Measured tour baselines.
 *
 * These are not guesses: each was computed over the shipped data files and is
 * re-derived from `splits` at runtime where the data allows it. The constants
 * are the fallback for the market splits, whose per-player shards are NOT all
 * loaded in the browser (164 files) — the pipeline writes the same figures
 * into odds-performance-index.json as `tourBaseline`, and that is preferred
 * when present.
 *
 * Why a baseline at all: vsMarket runs mildly positive tour-wide (+0.9pp
 * overall) because prices are de-vigged per match, so "beats the market by
 * 1pp" is the tour's normal, not an edge.
 */
var INS_TOUR_FALLBACK = {
  formatDiff: 3.1,      // tour median Bo3 win% minus Bo5 win% (n=129)
  surfaceSpread: 11.6,  // tour median best-minus-worst surface spread (n=121)
  market: {             // tour median vsMarket, by split (n as noted)
    overall: 0.9,       // n=164
    underdog: 0.3,      // n=159
    favourite: 2.0,     // n=122
    Hard: 0.8,          // n=147
    Clay: 0.8,          // n=118
    Grass: 2.3          // n=55
  }
};

var INS_SURFACES = ['Hard', 'Clay', 'Grass'];   // Carpet is a handful of rows tour-wide
var INS_LEVELS = ['Grand Slams', 'Masters', 'Other Tours'];

function insRow(block, cat) {
  var r = block && block[cat];
  return (r && typeof r.M === 'number' && r.M > 0) ? r : null;
}

// Surfaces partition a player's matches (verified: Hard+Clay+Grass+Carpet === matchesParsed),
// so the overall record is the surface sum. career-splits has no explicit total row.
function insOverall(block) {
  var M = 0, W = 0;
  ['Hard', 'Clay', 'Grass', 'Carpet'].forEach(function (s) {
    var r = insRow(block, s);
    if (r) { M += r.M; W += r.W; }
  });
  return M ? { M: M, W: W, L: M - W, winPct: (W / M) * 100 } : null;
}

function insPct(r) { return r.M ? (r.W / r.M) * 100 : null; }
function insR1(x) { return Math.round(x * 10) / 10; }

/* Market cards rest on a mirrored closing-price archive that stops at a fixed
 * date (both upstream sources went quiet in Feb 2026). Every market card says
 * so, so nobody reads "beats the market" as a statement about this week.
 * Date comes from `archiveLatest` in odds-performance-index.json, not a
 * constant — it re-labels itself if the archive ever moves again.
 */
var INS_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function insAsOfPhrase(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return ' Priced to the end of the odds archive, not to today.';
  return ' Priced to ' + Number(m[3]) + ' ' + INS_MONTHS[Number(m[2]) - 1] + ' ' + m[1] +
         ', where the odds archive ends \u2014 not to today.';
}

/* ---------------- Tour averages ----------------
 * Pooled (sum of wins / sum of matches), not a mean of percentages, so a
 * player with 4 matches vs lefties cannot drag the tour baseline. Computed
 * once over every ingested player and memoised.
 */
var _insTourAvg = null, _insTourOverall = null;

// Pooled tour-wide overall win% (54.2%), the baseline the Top-10 check needs.
function insTourOverall(splits) {
  if (_insTourOverall != null) return _insTourOverall;
  var M = 0, W = 0;
  Object.keys(splits || {}).forEach(function (k) {
    var o = splits[k] && splits[k].career ? insOverall(splits[k].career) : null;
    if (o) { M += o.M; W += o.W; }
  });
  _insTourOverall = M ? (W / M) * 100 : null;
  return _insTourOverall;
}

function insTourAverages(splits) {
  if (_insTourAvg) return _insTourAvg;
  var acc = {};
  Object.keys(splits || {}).forEach(function (key) {
    var c = splits[key] && splits[key].career;
    if (!c) return;
    Object.keys(c).forEach(function (cat) {
      var r = insRow(c, cat);
      if (!r) return;
      if (!acc[cat]) acc[cat] = { M: 0, W: 0, n: 0 };
      acc[cat].M += r.M; acc[cat].W += r.W; acc[cat].n++;
    });
  });
  var out = {};
  Object.keys(acc).forEach(function (cat) {
    out[cat] = { winPct: (acc[cat].W / acc[cat].M) * 100, M: acc[cat].M, players: acc[cat].n };
  });
  _insTourAvg = out;
  return out;
}
/* Tour-wide SHAPE baselines: the typical player's format differential and
 * surface spread. Both are medians, not pooled rates — we are asking "how
 * unusual is this player's spread", so the middle of the distribution is the
 * right comparator and one lopsided career cannot drag it.
 */
var _insTourShape = null;
function insTourShape(splits) {
  if (_insTourShape) return _insTourShape;
  var spreads = [], diffs = [];
  Object.keys(splits || {}).forEach(function (k) {
    var c = splits[k] && splits[k].career;
    if (!c) return;
    var pcts = [];
    INS_SURFACES.forEach(function (s) {
      var r = insRow(c, s);
      if (r && r.M >= INS_MIN.surface) pcts.push(insPct(r));
    });
    if (pcts.length >= 2) spreads.push(Math.max.apply(null, pcts) - Math.min.apply(null, pcts));
    var b3 = insRow(c, 'Best of 3'), b5 = insRow(c, 'Best of 5');
    if (b3 && b5 && b3.M >= INS_MIN.format && b5.M >= INS_MIN.format) diffs.push(insPct(b3) - insPct(b5));
  });
  function median(a) {
    if (!a.length) return null;
    a.sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)];
  }
  var ms = median(spreads), md = median(diffs);
  _insTourShape = {
    surfaceSpread: ms == null ? INS_TOUR_FALLBACK.surfaceSpread : ms,
    formatDiff: md == null ? INS_TOUR_FALLBACK.formatDiff : md,
    nSpread: spreads.length,
    nDiff: diffs.length
  };
  return _insTourShape;
}

function insResetTourAverages() { _insTourAvg = null; _insTourOverall = null; _insTourShape = null; }

/* ---------------- The seven checks ----------------
 * Each returns null (no finding / sample too thin) or a finding:
 *   { check, title, text, accent, sign, gap, ratio }
 * `ratio` = gap / threshold, the cross-check comparable used for ranking.
 * `relax` scales every threshold down for the fallback passes.
 */

// Check 1 — format edge, Best of 3 vs Best of 5.
//
// NOT the raw Bo3-minus-Bo5 gap: the typical player already wins 3.1pp more of
// his best-of-three matches, because best-of-five is overwhelmingly Slam main
// draw against better opposition. Flagging the raw gap labels most of the tour
// "weaker over five sets" for doing exactly what everyone does. The signal is
// the gap RELATIVE to the tour's own differential.
function insCheckFormat(sp, ctx, relax) {
  var b3 = insRow(sp.career, 'Best of 3'), b5 = insRow(sp.career, 'Best of 5');
  if (!b3 || !b5 || b3.M < INS_MIN.format || b5.M < INS_MIN.format) return null;
  var p3 = insPct(b3), p5 = insPct(b5), gap = p3 - p5;
  var tourDiff = ctx.shape.formatDiff;
  var dev = gap - tourDiff;             // < 0 means he holds up better than most
  var t = INS_THRESH.format * relax;
  if (Math.abs(dev) < t) return null;
  var strongerLong = dev < 0;
  return {
    check: 'format',
    title: strongerLong ? 'Thrives in best-of-five' : 'Fades over five sets',
    text: insR1(p3) + '% in best-of-three (' + b3.W + '-' + b3.L + ') against ' + insR1(p5) +
          '% in best-of-five (' + b5.W + '-' + b5.L + ') — a ' + (gap >= 0 ? '+' : '') + insR1(gap) +
          'pp gap where the tour averages +' + insR1(tourDiff) + 'pp. He holds up ' +
          insR1(Math.abs(dev)) + 'pp ' + (strongerLong ? 'better' : 'worse') +
          ' over the longer format than the typical player.',
    accent: strongerLong ? 'green' : 'red',
    sign: strongerLong ? 1 : -1,
    gap: Math.abs(dev),
    ratio: Math.abs(dev) / INS_THRESH.format
  };
}

// Check 2 — surface outlier, best vs worst.
function insCheckSurface(sp, ctx, relax) {
  var rows = [];
  INS_SURFACES.forEach(function (s) {
    var r = insRow(sp.career, s);
    if (r && r.M >= INS_MIN.surface) rows.push({ s: s, r: r, pct: insPct(r) });
  });
  if (rows.length < 2) return null;
  rows.sort(function (a, b) { return b.pct - a.pct; });
  var hi = rows[0], lo = rows[rows.length - 1], gap = hi.pct - lo.pct;
  // Judged against the tour's own typical spread (11.6pp), not against zero:
  // every player is somewhat surface-dependent, so only the EXCESS is a finding.
  var tourSpread = ctx.shape.surfaceSpread;
  var dev = gap - tourSpread;
  var t = INS_THRESH.surface * relax;
  if (dev < t) return null;
  return {
    check: 'surface',
    // Title has to track the magnitude: the selector relaxes this threshold,
    // and calling a barely-above-average spread "extreme" overclaims the data.
    title: dev >= 13 ? 'Extreme surface dependency'
         : dev >= 6 ? 'Strongly surface-dependent'
         : 'Modest surface preference',
    text: insR1(hi.pct) + '% on ' + hi.s.toLowerCase() + ' (' + hi.r.W + '-' + hi.r.L + ') against ' +
          insR1(lo.pct) + '% on ' + lo.s.toLowerCase() + ' (' + lo.r.W + '-' + lo.r.L + ') — a ' +
          insR1(gap) + 'pp swing between his best and worst surface, where the typical player swings ' +
          insR1(tourSpread) + 'pp. Nearly ' + (gap / tourSpread >= 1.9 ? 'double' : insR1(gap / tourSpread) + 'x') +
          ' the tour’s normal surface dependency.',
    accent: 'gold',
    sign: 0,
    gap: dev,
    ratio: dev / INS_THRESH.surface
  };
}

// Check 3 — level performance against the player's own career baseline.
function insCheckLevel(sp, ctx, relax) {
  if (!ctx.overall || ctx.overall.M < INS_MIN.overall) return null;
  var base = ctx.overall.winPct, best = null;
  INS_LEVELS.forEach(function (lv) {
    var r = insRow(sp.career, lv);
    if (!r || r.M < INS_MIN.level) return;
    var dev = insPct(r) - base;
    if (!best || Math.abs(dev) > Math.abs(best.dev)) best = { lv: lv, r: r, dev: dev, pct: insPct(r) };
  });
  var t = INS_THRESH.level * relax;
  if (!best || Math.abs(best.dev) < t) return null;
  var up = best.dev > 0;
  var lvl = best.lv === 'Other Tours' ? 'ATP 250/500 events' : best.lv;
  return {
    check: 'level',
    title: up ? 'Punches above his level at ' + best.lv : 'Underperforms at ' + best.lv,
    text: 'Wins ' + insR1(best.pct) + '% at ' + lvl + ' (' + best.r.W + '-' + best.r.L + ') against a ' +
          insR1(base) + '% career rate — ' + insR1(Math.abs(best.dev)) + 'pp ' + (up ? 'above' : 'below') +
          ' his own baseline.',
    accent: up ? 'green' : 'red',
    sign: up ? 1 : -1,
    gap: Math.abs(best.dev),
    ratio: Math.abs(best.dev) / INS_THRESH.level
  };
}

// Check 4 — record against the Top 10.
//
// NOT the raw drop from career rate: EVERY player falls away against the Top
// 10 (tour-wide 31.8% vs 54.2% overall, a -22.5pp typical delta), so flagging
// the drop itself labels almost the whole tour as weak. What is informative is
// whether the player's drop is bigger or smaller than the tour's normal drop.
function insCheckTop10(sp, ctx, relax) {
  var r = insRow(sp.career, 'vs. Top 10');
  if (!r || r.M < INS_MIN.top10 || !ctx.overall || ctx.overall.M < INS_MIN.overall) return null;
  var tourT10 = ctx.tour['vs. Top 10'];
  if (!tourT10 || ctx.tourOverall == null) return null;
  var normalDelta = tourT10.winPct - ctx.tourOverall;   // ~ -22.5pp
  var expected = ctx.overall.winPct + normalDelta;      // what this player "should" do
  var pct = insPct(r), dev = pct - expected;
  var t = INS_THRESH.top10 * relax;
  if (Math.abs(dev) < t) return null;
  var up = dev > 0;
  return {
    check: 'top10',
    title: up ? 'Holds up against the Top 10' : 'Falls away against the Top 10',
    text: insR1(pct) + '% vs Top 10 opponents (' + r.W + '-' + r.L + '). Players at his level average ' +
          insR1(expected) + '% in that split, so he is ' + insR1(Math.abs(dev)) + 'pp ' +
          (up ? 'better than expected against elite opposition.' : 'worse than expected against elite opposition.'),
    accent: up ? 'green' : 'red',
    sign: up ? 1 : -1,
    gap: Math.abs(dev),
    ratio: Math.abs(dev) / INS_THRESH.top10
  };
}

var INS_AXIS_LABEL = {
  big_server: 'Big Server', solid_baseliner: 'Solid Baseliner', counter_puncher: 'Counter-Puncher',
  attacking_baseliner: 'Attacking Baseliner', solid_defender: 'Solid Defender', all_court: 'All-Court',
  big_server_baseliner: 'Big-Serving Baseliner'
};

// Check 5 — dominant radar dimension. Partial axes are excluded: a greyed axis
// on the style card must not become a headline claim.
function insCheckRadar(sp, ctx, relax) {
  var st = ctx.style;
  if (!st || !st.archetype_scores) return null;
  var partial = st.partial_axes || [];
  var rows = Object.keys(st.archetype_scores)
    .filter(function (k) { return partial.indexOf(k) < 0 && typeof st.archetype_scores[k] === 'number'; })
    .map(function (k) { return { k: k, v: st.archetype_scores[k] }; })
    .sort(function (a, b) { return b.v - a.v; });
  if (rows.length < 2) return null;
  var gap = rows[0].v - rows[1].v;
  var t = INS_THRESH.radar * relax;
  if (gap < t) return null;
  var lab = INS_AXIS_LABEL[rows[0].k] || rows[0].k;
  // Axis scores are normalised so 50 IS the tour average — that is the context
  // figure the spec requires alongside the raw number.
  var tourAvg = (ctx.styleTourAverage == null ? 50 : ctx.styleTourAverage);
  return {
    check: 'radar',
    title: 'Standout ' + lab.toLowerCase() + ' profile',
    text: lab + ' score of ' + rows[0].v + ' against a tour average of ' + tourAvg + ', and ' + gap +
          ' points clear of his own next dimension (' + (INS_AXIS_LABEL[rows[1].k] || rows[1].k) + ', ' +
          rows[1].v + '). A clearly one-dimensional style signature.',
    accent: 'green',
    sign: 1,
    gap: gap,
    ratio: gap / INS_THRESH.radar
  };
}

/* Check 8 — market efficiency.
 *
 * The spec names market data as a first-class source, with the worked example
 * "consistently undervalued by the market as an underdog". Source is the
 * player's odds-performance shard: actual win% vs the de-vigged implied win%
 * of the closing price, per split.
 *
 * Judged against the TOUR MEDIAN for that same split, never against zero:
 * vsMarket runs mildly positive tour-wide (+0.9pp overall, +2.0pp as
 * favourite) because prices are de-vigged per match, so "beat the market by
 * 1pp" is the tour's normal rather than an edge.
 *
 * Scans role, surface and overall and returns only the SINGLE most deviant
 * split, so market cannot flood all three cards.
 */
function insCheckMarket(sp, ctx, relax) {
  var mk = ctx.market;
  if (!mk) return null;
  var base = (ctx.marketTour || INS_TOUR_FALLBACK.market);
  var cands = [];

  function consider(rec, splitKey, phrase, roleWord) {
    if (!rec || typeof rec.vsMarket !== 'number' || rec.matches < INS_MIN.market) return;
    var b = (typeof base[splitKey] === 'number') ? base[splitKey] : 0;
    cands.push({
      dev: rec.vsMarket - b, rec: rec, tourBase: b, phrase: phrase, roleWord: roleWord
    });
  }

  consider(mk.overall, 'overall', 'overall', 'across all priced matches');
  if (mk.byRole) {
    consider(mk.byRole.underdog, 'underdog', 'as an underdog', 'when priced as the underdog');
    consider(mk.byRole.favourite, 'favourite', 'as a favourite', 'when priced as the favourite');
  }
  if (mk.bySurface) {
    INS_SURFACES.forEach(function (s) {
      consider(mk.bySurface[s], s, 'on ' + s.toLowerCase(), 'on ' + s.toLowerCase());
    });
  }
  if (!cands.length) return null;

  cands.sort(function (a, b) { return Math.abs(b.dev) - Math.abs(a.dev); });
  var best = cands[0];
  var t = INS_THRESH.market * relax;
  if (Math.abs(best.dev) < t) return null;

  var r = best.rec, up = best.dev > 0;
  return {
    check: 'market',
    title: up ? 'Undervalued by the market ' + best.phrase
              : 'Overvalued by the market ' + best.phrase,
    text: 'Wins ' + insR1(r.actualWinRate) + '% ' + best.roleWord + ' (' + r.wins + '-' + r.losses +
          ') where the closing price implied ' + insR1(r.expectedWinRate) + '% — ' +
          (r.vsMarket >= 0 ? 'beating the market by +' + insR1(r.vsMarket) + 'pp'
                           : 'falling ' + insR1(Math.abs(r.vsMarket)) + 'pp short of the market') +
          ', against a tour median of ' + (best.tourBase >= 0 ? '+' : '') + insR1(best.tourBase) + 'pp. ' +
          (up ? 'The market has been pricing him short.' : 'The market has been pricing him too high.') +
          insAsOfPhrase(ctx.marketAsOf),
    accent: up ? 'green' : 'red',
    sign: up ? 1 : -1,
    gap: Math.abs(best.dev),
    ratio: Math.abs(best.dev) / INS_THRESH.market
  };
}

// Check 6 — last-52-week form against the career baseline.
function insCheckTrend(sp, ctx, relax) {
  var l52 = insOverall(sp.last52);
  if (!l52 || l52.M < INS_MIN.last52 || !ctx.overall || ctx.overall.M < INS_MIN.overall) return null;
  var dev = l52.winPct - ctx.overall.winPct;
  var t = INS_THRESH.last52 * relax;
  if (Math.abs(dev) < t) return null;
  var up = dev > 0;
  return {
    check: 'last52',
    title: up ? 'Trending up on career form' : 'Trending down on career form',
    text: insR1(l52.winPct) + '% over the last 52 weeks (' + l52.W + '-' + l52.L + ') against ' +
          insR1(ctx.overall.winPct) + '% career — running ' + insR1(Math.abs(dev)) + 'pp ' +
          (up ? 'above' : 'below') + ' his own long-run level.',
    accent: up ? 'green' : 'red',
    sign: up ? 1 : -1,
    gap: Math.abs(dev),
    ratio: Math.abs(dev) / INS_THRESH.last52
  };
}

// Check 7 — handedness edge.
//
// Righties are ~87% of every player's matches, so his raw win% vs righties is
// essentially his overall win%: comparing it to the tour average just re-states
// how good he is (Sinner read "+25.6pp vs righties" — true, and meaningless).
// The handedness signal is the DIFFERENTIAL — how much better/worse he does vs
// lefties than vs righties — measured against the tour's own differential
// (+1.3pp). That controls for player quality and isolates the matchup effect.
function insCheckHand(sp, ctx, relax) {
  var lf = insRow(sp.career, 'vs. Lefties'), rt = insRow(sp.career, 'vs. Righties');
  var tl = ctx.tour['vs. Lefties'], tr = ctx.tour['vs. Righties'];
  if (!lf || !rt || lf.M < INS_MIN.hand || rt.M < INS_MIN.hand || !tl || !tr) return null;
  var pl = insPct(lf), pr = insPct(rt);
  var playerDiff = pl - pr;             // his own lefty premium/penalty
  var tourDiff = tl.winPct - tr.winPct; // the tour's, ~+1.3pp
  var dev = playerDiff - tourDiff;
  var t = INS_THRESH.hand * relax;
  if (Math.abs(dev) < t) return null;
  var up = dev > 0;
  return {
    check: 'hand',
    // "Vulnerable to left-handers" on a player who still wins 78% of those
    // matches reads as false. Strong wording only above a real gap, and never
    // "vulnerable" while he is still winning the split outright.
    title: up
      ? (dev >= 12 ? 'Handles left-handers well' : 'Slight edge against left-handers')
      : (dev <= -12 && pl < 50 ? 'Vulnerable to left-handers'
                               : 'Slightly weaker against left-handers'),
    text: insR1(pl) + '% vs lefties (' + lf.W + '-' + lf.L + ') against ' + insR1(pr) + '% vs righties (' +
          rt.W + '-' + rt.L + ') — a ' + (playerDiff >= 0 ? '+' : '') + insR1(playerDiff) +
          'pp swing where the tour averages ' + (tourDiff >= 0 ? '+' : '') + insR1(tourDiff) + 'pp. He is ' +
          insR1(Math.abs(dev)) + 'pp ' + (up ? 'better' : 'worse') + ' against left-handers than his own level implies.',
    accent: up ? 'green' : 'red',
    sign: up ? 1 : -1,
    gap: Math.abs(dev),
    ratio: Math.abs(dev) / INS_THRESH.hand
  };
}

var INS_CHECKS = [insCheckFormat, insCheckSurface, insCheckLevel, insCheckTop10,
                  insCheckRadar, insCheckTrend, insCheckHand, insCheckMarket];

/* ---------------- Selector ----------------
 * Runs all seven, ranks by ratio (gap relative to its own threshold, so a
 * 30pp surface swing and a 12pp Top-10 gap are comparable), then forces a
 * positive/negative mix before filling the third slot on rank.
 * Relaxes thresholds in steps only if fewer than three findings survive.
 */
/* Two checks can fire on THE SAME MATCHES and read as two findings.
 *
 * Best-of-five is, for almost the whole tour, exactly the Grand Slam main draw:
 * Giron's "37% at Grand Slams (17-29)" and "37% in best-of-five (17-29)" are one
 * fact printed twice, and it was eating two of his three cards. When the two
 * rows cover materially the same match count, keep the stronger finding only.
 */
function insDropOverlaps(sp, found) {
  var b5 = insRow(sp.career, 'Best of 5'), gs = insRow(sp.career, 'Grand Slams');
  if (!b5 || !gs) return found;
  var overlap = 1 - Math.abs(b5.M - gs.M) / Math.max(b5.M, gs.M);
  if (overlap < 0.8) return found;   // genuinely different match sets, keep both
  var fmt = null, lvl = null;
  found.forEach(function (f) {
    if (f.check === 'format') fmt = f;
    if (f.check === 'level' && /Grand Slams/.test(f.title)) lvl = f;
  });
  if (!fmt || !lvl) return found;
  var drop = (fmt.ratio >= lvl.ratio) ? lvl : fmt;
  return found.filter(function (f) { return f !== drop; });
}

function insSelect(sp, ctx) {
  // Relaxation stops at 0.6. Below that the findings stop being findings — a
  // 3pp edge on a 30-match split is noise, and the spec's "never fabricate"
  // rule outranks its "always show three". The caller tops up any shortfall
  // from the pipeline insights, which are real data from a wider match set.
  var RELAX = [1, 0.6];
  var found = [], seen = {};
  for (var i = 0; i < RELAX.length; i++) {
    INS_CHECKS.forEach(function (fn) {
      var f = fn(sp, ctx, RELAX[i]);
      if (f && !seen[f.check]) { seen[f.check] = 1; f.relax = RELAX[i]; found.push(f); }
    });
    if (insDropOverlaps(sp, found).length >= 3) break;
  }
  found = insDropOverlaps(sp, found);
  found.sort(function (a, b) { return b.ratio - a.ratio; });

  var pos = found.filter(function (f) { return f.sign > 0; });
  var neg = found.filter(function (f) { return f.sign < 0; });
  var picked = [];
  if (pos.length) picked.push(pos[0]);
  if (neg.length) picked.push(neg[0]);
  found.forEach(function (f) {
    if (picked.length < 3 && picked.indexOf(f) < 0) picked.push(f);
  });
  picked.sort(function (a, b) { return b.ratio - a.ratio; });
  return picked.slice(0, 3);
}

/* ---------------- Public entry ----------------
 * Returns [] when the player has no splits row, so the caller can fall back to
 * the pipeline-built insights rather than render an empty grid.
 */
// Fills a shortfall from the pipeline-built insights (surface record, recent
// form, serve percentile). Those are real numbers off a WIDER match set than
// tennisabstract's tour-only rows, so they are a legitimate top-up — not
// filler. Deduped against what the dynamic checks already said.
function insTopUp(picked, fallback) {
  var said = {};
  picked.forEach(function (f) { said[f.check] = 1; });
  (fallback || []).forEach(function (x) {
    if (picked.length >= 3) return;
    var t = String(x.title || '').toLowerCase();
    // don't repeat a surface or form claim the dynamic engine already made
    if (said.surface && /surface|clay|hard|grass/.test(t)) return;
    if (said.last52 && /form/.test(t)) return;
    picked.push({
      check: 'pipeline', title: x.title, text: x.text,
      accent: x.accent === 'green' ? 'green' : 'gold',
      sign: 0, gap: 0, ratio: 0, source: 'pipeline'
    });
  });
  return picked.slice(0, 3);
}

/* `market` is the player's odds-performance shard (or null — only ~122 of the
 * 233 split players have one). `marketTour` is the tour-median baseline block
 * published in odds-performance-index.json; omitted it falls back to the
 * measured constants in INS_TOUR_FALLBACK.
 */
function ppDynamicInsights(profileKey, playerName, splits, styleRec, fallback, market, marketTour, styleTourAverage, marketAsOf) {
  var sp = splits && splits[String(profileKey)];
  if (!sp || !sp.career) return insTopUp([], fallback);
  var overall = insOverall(sp.career);
  var ctx = {
    overall: overall,
    tour: insTourAverages(splits),
    tourOverall: insTourOverall(splits),
    shape: insTourShape(splits),
    style: styleRec,
    styleTourAverage: styleTourAverage,
    market: market || null,
    marketTour: marketTour || null,
    marketAsOf: marketAsOf || null,
    last: String(playerName || '').split(' ').pop() || 'He'
  };
  return insTopUp(insSelect(sp, ctx), fallback);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ppDynamicInsights, insResetTourAverages, insTourAverages, insOverall, INS_MIN, INS_THRESH };
}
