'use strict';

/**
 * adjustments.js — Stage 2: the adjustment layers.
 *
 * Model v2.0 (Step 1): layers #6 (round/stage) and #14 (court speed/altitude)
 * were removed. 14 active layers remain (13 green + 1 gated: #8 W/UE). Retired
 * layer ids (6, 14) are NOT reused so historical output stays comparable.
 *
 * Each adjustment is a pure function of the match context and returns a
 * standard shape:
 *   {
 *     id, key, name,
 *     applied,        // did it contribute? (false when data missing/gated)
 *     gated,          // true if the data source itself is not yet reliable
 *     direction,      // 'p1' | 'p2' | 'neutral'
 *     signal,         // [-1,+1] from p1's perspective
 *     deltaP1,        // signal * maxMagnitude (probability points)
 *     maxMagnitude,
 *     confidence,     // 'high' | 'med' | 'low' | 'none'
 *     detail,         // short human-readable explanation
 *     source,         // which data file(s) fed it
 *   }
 *
 * Design notes to avoid DOUBLE-COUNTING ELO:
 *  - ELO already encodes raw skill and surface skill (Stage 1). So the
 *    "surface", "serve", "return", "format" adjustments are written as
 *    *relative-to-own-baseline* or *percentile-gap* signals — they add the
 *    texture ELO can't see, not the skill ELO already saw.
 */

const config = require('./config');
const { surfaceCategory, rankOf, loadManualInputs } = require('./data');
const { pinnacleSeries, bookSeries, preMatchCutoffMs } = require('./price');

// ---- small helpers --------------------------------------------------------
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const round4 = (x) => Math.round(x * 1e4) / 1e4;

function base(id, key, name, maxMagnitude, source) {
  return {
    id, key, name, maxMagnitude, source,
    applied: false, gated: false, direction: 'neutral',
    signal: 0, deltaP1: 0, confidence: 'none', detail: 'No data.',
  };
}

// Turn a computed signal into a finished result object.
function apply(res, signal, confidence, detail) {
  signal = clamp(signal, -1, 1);
  res.signal = round4(signal);
  res.deltaP1 = round4(signal * res.maxMagnitude);
  res.applied = signal !== 0;
  res.direction = signal > 0 ? 'p1' : (signal < 0 ? 'p2' : 'neutral');
  res.confidence = confidence;
  res.detail = detail;
  return res;
}

function gate(res, reason) {
  res.gated = true;
  res.applied = false;
  res.confidence = 'none';
  res.detail = `GATED — ${reason}`;
  return res;
}

// career category accessor: prefer career, then last52
function careerCat(splits, cat) {
  if (!splits) return null;
  return (splits.career && splits.career[cat]) ||
         (splits.last52 && splits.last52[cat]) || null;
}

function parseSets(result) {
  // "2 - 0" -> total sets played = 2; "0 - 2" -> 2; "2 - 1" -> 3
  if (!result || typeof result !== 'string') return 0;
  const nums = result.match(/\d+/g);
  if (!nums) return 0;
  return nums.slice(0, 2).reduce((a, b) => a + parseInt(b, 10), 0);
}

function recentMatchesSorted(profile) {
  const arr = (profile && profile.recentForm && profile.recentForm.matches) || [];
  return arr.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---- serve / return ratings (ATP-leaderboard style) -----------------------
// One number per player, built from OUR own career-splits database (already
// refreshed weekly by the pipeline: career + rolling last-52-weeks, per
// surface). Mirrors the ATP serve/return leaderboards so Michael can sanity-
// check a player's figure against atptour.com.

// Serve rating = 1st-serve-in% + 1st-serve-won% + 2nd-serve-won%
//              + service-games-held% + ace% − double-fault%.
function serveRatingRow(row) {
  if (!row) return null;
  const fi = num(row.firstInPct), fw = num(row.firstWonPct), sw = num(row.secondWonPct),
        hl = num(row.hldPct), a = num(row.aPct), df = num(row.dfPct);
  if (fi == null || fw == null || sw == null || hl == null) return null;
  return fi + fw + sw + hl + (a || 0) - (df || 0);
}

// Return rating = return-points-won% + break% (games broken).
function returnRatingRow(row) {
  if (!row) return null;
  const rp = num(row.rpwPct), br = num(row.brkPct);
  if (rp == null) return null;
  return rp + (br || 0);
}

// Blend a per-surface rating: last-52-weeks (0.6) + career (0.4) — recent
// weighted higher per Michael's spec ("especially the last 52 weeks per
// surface"). Falls back to the format bucket (Bo3/Bo5) when the surface row is
// absent, and degrades to whichever single scope exists.
function blendedRating(splits, surfCat, bestOfBucket, ratingFn) {
  if (!splits) return null;
  const pick = (scope) => {
    const s = splits[scope];
    if (!s) return null;
    return (surfCat && s[surfCat]) || (bestOfBucket && s[bestOfBucket]) || null;
  };
  const l = ratingFn(pick('last52'));
  const c = ratingFn(pick('career'));
  if (l != null && c != null) return 0.6 * l + 0.4 * c;
  return l != null ? l : (c != null ? c : null);
}

// A player's genuine CAREER overall win% (percentage points), summed from the
// full-career surface totals in player-profiles kpis (Clay+Hard+Grass). This is
// the correct baseline for the surface (#4) and round (#6) layers — the old
// kpis.All figure is only a ~30-match recent window and mis-scales the edge.
function careerOverallWR(profile) {
  const k = profile && profile.kpis;
  if (!k) return null;
  let won = 0, lost = 0;
  for (const s of ['Clay', 'Hard', 'Grass']) {
    const rec = k[s] && k[s].record;
    if (rec && num(rec.won) != null && num(rec.lost) != null) { won += rec.won; lost += rec.lost; }
  }
  const tot = won + lost;
  return tot > 0 ? (won / tot) * 100 : null;
}

// =========================================================================
// 1. STYLE MATCHUP — matchup-matrix.json (archetype vs archetype)
// =========================================================================
function styleMatchup(ctx) {
  const c = config.adjustments.styleMatchup;
  const res = base(c.id, 'styleMatchup', 'Style matchup', c.maxMagnitude, 'matchup-matrix.json');
  const a1 = ctx.p1.style && ctx.p1.style.primary;
  const a2 = ctx.p2.style && ctx.p2.style.primary;
  if (!a1 || !a2) return res; // one side unclassified
  const mm = ctx.matchupMatrix;
  const cell = mm && mm.matrix && mm.matrix[a1] && mm.matrix[a1][a2];
  if (!cell || cell.pct == null) return res;
  const n = cell.n || 0;
  const minN = (mm.minSampleN || 20);
  if (n < minN) {
    res.detail = `${a1} vs ${a2}: n=${n} < floor ${minN}, not applied.`;
    return res;
  }
  // pct = win% of p1 archetype vs p2 archetype. 50 = neutral.
  const signal = (cell.pct - 50) / 50;
  const conf = n >= 500 ? 'high' : (n >= 100 ? 'med' : 'low');
  return apply(res, signal, conf,
    `${a1} beats ${a2} ${cell.pct}% (n=${n}) historically.`);
}

// =========================================================================
// 2. SUBJECTIVE INPUT — Michael's manual read (passthrough)
// =========================================================================
function subjective(ctx) {
  const c = config.adjustments.subjective;
  const res = base(c.id, 'subjective', 'Subjective input', c.maxMagnitude, 'manual-inputs.json:subjective');
  // Priority: an explicit runtime signal (CLI --subj) wins; otherwise fall back
  // to a persisted moderator value in manual-inputs.json keyed by match id.
  // A subjective row is { signal: -1..+1 } from p1's (left player's) view.
  let s = num(ctx.subjectiveSignal);
  if (s == null || s === 0) {
    const matchId = ctx.match && ctx.match.id;
    const subj = (loadManualInputs() || {}).subjective || {};
    const row = matchId != null ? subj[String(matchId)] : null;
    if (row && num(row.signal) != null) s = clamp(row.signal, -1, 1);
  }
  if (s == null || s === 0) {
    res.detail = 'No manual input (default neutral).';
    return res;
  }
  return apply(res, s, 'med', `Manual read applied (${s > 0 ? '+' : ''}${s}).`);
}

// =========================================================================
// 3. H2H RECORD — dominance-weighted head-to-head (v2.0 redesign)
// =========================================================================
// Each prior meeting is scored three ways and the scores MULTIPLY:
//   • surface filter   — same surface as this match = 1.0, different/unknown = 0.25
//   • recency filter   — <=2y = 1.0, 2-4y = 0.6, >4y = 0.2
//   • set-score dominance — straight-sets result = 1.0, any other completed
//     result = 0.6 (signed by who won: a straight-sets LOSS is a stronger
//     negative than a deciding-set loss).
// The FILTERED (weight-summed) meeting count N_eff drives a three-tier sample
// system that scales the whole layer's magnitude: Tier 1 (N_eff>=8) full, Tier 2
// (3-7) 45%, Tier 3 (<3) near-zero. Zero *raw* meetings hides the layer entirely
// (res.hidden) so the Bet Confirmation Stack shows no empty H2H row.
// All thresholds/weights come from config.adjustments.h2h (defaults inline as a
// safety net so the function is robust if a knob is ever absent).

// Set-score dominance from an "a - b" result string (already reordered p1-first).
// Straight sets (loser took 0 sets: 2-0 / 3-0) => full dominance. Any other
// completed win (2-1, 3-2, and Bo5 win-in-4 3-1) => competitive. Unparseable
// score but a known winner => a neutral middle default.
// NOTE: 3-1 (Bo5 win-in-four) is bucketed as "competitive" under the two-value
// spec; flagged for Michael if he later wants an intermediate weight.
function setDominance(result, dcfg) {
  const D = dcfg || { straight: 1.0, competitive: 0.6, unknown: 0.7 };
  if (typeof result !== 'string') return D.unknown;
  const parts = result.split('-').map(s => parseInt(s.trim(), 10));
  if (parts.length !== 2 || parts.some(n => !isFinite(n))) return D.unknown;
  const loserSets = Math.min(parts[0], parts[1]);
  return loserSets === 0 ? D.straight : D.competitive;
}

function h2h(ctx) {
  const c = config.adjustments.h2h;
  const res = base(c.id, 'h2h', 'H2H record', c.maxMagnitude, 'matches.json:h2h.matches');

  const h = ctx.match.h2h;
  const meetings = (h && Array.isArray(h.matches)) ? h.matches : [];
  // Zero prior meetings => hide the layer entirely (spec: no empty H2H row).
  if (meetings.length === 0) { res.hidden = true; res.detail = 'No prior meetings.'; return res; }

  // Config knobs (with inline defaults as a safety net).
  const sW  = c.surfaceWeight || { same: 1.0, diff: 0.25 };
  const rY  = c.recencyYears  || { recent: 2, mid: 4 };
  const rW  = c.recencyWeight || { recent: 1.0, mid: 0.6, old: 0.2 };
  const tM  = c.tierMult      || { t1: 1.0, t2: 0.45, t3: 0.10 };
  const t1N = (c.tier1MinN != null) ? c.tier1MinN : 8;
  const t2N = (c.tier2MinN != null) ? c.tier2MinN : 3;

  const matchCat = surfaceCategory(ctx.surface);
  const nowMs = Date.parse(ctx.match && ctx.match.date);
  const refMs = isFinite(nowMs) ? nowMs : Date.now();
  const YEAR_MS = 365.25 * 24 * 3600 * 1000;

  let wSum = 0;    // Σ filter weight  => effective (filtered) sample size N_eff
  let domSum = 0;  // Σ filter weight × signed dominance
  let sameSurf = 0, recent2y = 0;
  for (const m of meetings) {
    // surface filter — same surface only when both categories are known and equal
    const mCat = surfaceCategory(m.surface);
    const surfW = (matchCat && mCat && mCat === matchCat) ? sW.same : sW.diff;
    if (surfW === sW.same) sameSurf++;

    // recency filter — default to the oldest band if the date is unparseable
    let recW = rW.old;
    const mMs = Date.parse(m.date);
    if (isFinite(mMs)) {
      const ageY = (refMs - mMs) / YEAR_MS;
      recW = ageY <= rY.recent ? rW.recent : (ageY <= rY.mid ? rW.mid : rW.old);
      if (ageY <= rY.recent) recent2y++;
    }

    // set-score dominance, signed by who won this meeting
    const dom = setDominance(m.result, c.dominance);
    const signed = (m.p1Won ? 1 : -1) * dom;

    const w = surfW * recW;
    wSum += w;
    domSum += w * signed;
  }

  // Filtered sample size selects the tier / magnitude multiplier.
  const nEff = wSum;
  let tier, tierMult, conf;
  if (nEff >= t1N)      { tier = 1; tierMult = tM.t1; conf = 'high'; }
  else if (nEff >= t2N) { tier = 2; tierMult = tM.t2; conf = 'med';  }
  else                  { tier = 3; tierMult = tM.t3; conf = 'low';  }

  // Weight-averaged signed dominance in [-1,1], then scaled by the tier.
  const domAvg = wSum > 0 ? (domSum / wSum) : 0;
  const signal = clamp(domAvg * tierMult, -1, 1);

  const w1 = meetings.filter(m => m.p1Won).length;
  const w2 = meetings.length - w1;
  const detail = `H2H ${w1}-${w2} (${meetings.length} meeting${meetings.length === 1 ? '' : 's'}; `
    + `${sameSurf} on ${matchCat || 'surface'}, ${recent2y} in last 2y; `
    + `Nₑₓ ${nEff.toFixed(1)}, tier ${tier}).`;

  const out = apply(res, signal, conf, detail);
  // Meetings exist => always show the row, even for a balanced (0-signal) record.
  out.applied = true;
  return out;
}

// =========================================================================
// 4. SURFACE RECORD — surface win% relative to each player's own baseline
// (relative-to-baseline avoids double-counting the surface ELO in Stage 1)
// =========================================================================
// The surface FIGURE is a blend of the player's career surface win%, their
// last-52-weeks surface win%, and their recent form ON that surface (career
// 0.4 / last52 0.4 / recent 0.2, renormalised over what's available). Kept as a
// gap RELATIVE to each player's true career baseline so the surface ELO already
// counted in Stage 1 is not double-counted.
function surfaceFigure(p, surfCat) {
  const parts = [];
  const cRow = p.splits && p.splits.career && p.splits.career[surfCat];
  const lRow = p.splits && p.splits.last52 && p.splits.last52[surfCat];
  if (cRow && num(cRow.winPct) != null) parts.push({ w: 0.4, v: cRow.winPct });
  if (lRow && num(lRow.winPct) != null) parts.push({ w: 0.4, v: lRow.winPct });
  const ms = recentMatchesSorted(p.profile)
    .filter(m => surfaceCategory(m.surface) === surfCat)
    .slice(0, 12);
  if (ms.length >= 4) {
    const wr = (ms.filter(m => m.won).length / ms.length) * 100;
    parts.push({ w: 0.2, v: wr });
  }
  if (!parts.length) return null;
  const wsum = parts.reduce((s, x) => s + x.w, 0);
  return parts.reduce((s, x) => s + x.w * x.v, 0) / wsum;
}
function surface(ctx) {
  const c = config.adjustments.surface;
  const res = base(c.id, 'surface', 'Surface record', c.maxMagnitude,
    'career-splits.json + player-profiles.json:recentForm');
  const cat = surfaceCategory(ctx.surface);
  if (!cat) return res;
  function surfEdge(p) {
    const fig = surfaceFigure(p, cat);
    const baseWR = careerOverallWR(p.profile);
    if (fig == null || baseWR == null) return null;
    return { edge: fig - baseWR, fig };
  }
  const e1 = surfEdge(ctx.p1), e2 = surfEdge(ctx.p2);
  if (!e1 || !e2) return res;
  const signal = clamp((e1.edge - e2.edge) / 30, -1, 1); // 30-pt relative gap = full
  return apply(res, signal, 'med',
    `${cat} record ${Math.round(e1.fig)}% vs ${Math.round(e2.fig)}% (career+52wk+form, vs own career baseline).`);
}

// =========================================================================
// 5. RECENT FORM — last-N results (all levels incl. Challenger/ITF)
// =========================================================================
function recentForm(ctx) {
  const c = config.adjustments.recentForm;
  const res = base(c.id, 'recentForm', 'Recent form', c.maxMagnitude, 'player-profiles.json:recentForm');
  const N = config.recentFormN;
  function form(p) {
    const ms = recentMatchesSorted(p.profile).slice(0, N);
    if (ms.length === 0) return null;
    const wins = ms.filter(m => m.won).length;
    return { rate: wins / ms.length, wins, n: ms.length };
  }
  const f1 = form(ctx.p1), f2 = form(ctx.p2);
  if (!f1 || !f2) return res;
  const signal = (f1.rate - f2.rate); // both in [0,1] => diff in [-1,1]
  const conf = (f1.n >= N && f2.n >= N) ? 'med' : 'low';
  return apply(res, signal, conf,
    `Last ${f1.n}: ${f1.wins}W vs last ${f2.n}: ${f2.wins}W.`);
}

// =========================================================================
// 7. QUALITY-ADJUSTED RECENT FORM
//    Signal 1 (primary): last-10 win rate vs top-50 opponents compared to the
//      last-10 overall win rate — rewards beating quality, discounts padding
//      a record against lower-ranked players.
//    Signal 2 (secondary): top-20 wins on THIS surface, recency-weighted
//      (last 52 weeks count more than older career wins).
//    Opponent rank = current rank via player-profiles (proxy for match-day).
// =========================================================================
function qualityForm(ctx) {
  const c = config.adjustments.qualityForm;
  const res = base(c.id, 'qualityForm', 'Quality-adjusted form', c.maxMagnitude,
    'player-profiles.json:recentForm + rank');
  const cat = surfaceCategory(ctx.surface);
  const now = new Date(ctx.match.date || Date.now());
  const wk52Ms = 52 * 7 * 24 * 3600 * 1000;

  function signals(p) {
    const ms = recentMatchesSorted(p.profile);
    if (ms.length === 0) return null;
    // --- Signal 1: quality-adjusted last-10 ---
    const last10 = ms.slice(0, 10);
    const overallWR = last10.filter(m => m.won).length / last10.length;
    const vsTop50 = last10.filter(m => {
      const r = rankOf(m.opponentKey, m.opponent, m.date); // opponent's rank ON that match date
      return r != null && r <= 50;
    });
    let s1 = 0, s1conf = false;
    if (vsTop50.length >= 2) {
      const top50WR = vsTop50.filter(m => m.won).length / vsTop50.length;
      s1 = top50WR - overallWR;      // positive => better vs quality than overall
      s1conf = vsTop50.length >= 3;
    } else {
      // no top-50 opposition recently => mild discount if form is high & soft
      s1 = -0.15 * overallWR;
    }
    // --- Signal 2: recency-weighted top-20 wins on this surface ---
    let s2 = 0;
    if (cat) {
      for (const m of ms) {
        if (!m.won) continue;
        if (surfaceCategory(m.surface) !== cat) continue;
        const r = rankOf(m.opponentKey, m.opponent, m.date); // opponent's rank ON that match date
        if (r == null || r > 20) continue;
        const age = now - new Date(m.date);
        s2 += age <= wk52Ms ? 1.0 : 0.4; // recent worth more than old career win
      }
    }
    return { s1, s2, s1conf, top50n: vsTop50.length };
  }

  const a = signals(ctx.p1), b = signals(ctx.p2);
  if (!a || !b) return res;

  // Signal 1 differential (each s1 roughly in [-1,1]); Signal 2 differential
  // squashed (a 3-big-win edge ~ full secondary signal).
  const sig1 = clamp(a.s1 - b.s1, -1, 1);
  const sig2 = clamp((a.s2 - b.s2) / 3, -1, 1);
  const w2 = c.signal2Weight;
  const signal = clamp((1 - w2) * sig1 + w2 * sig2, -1, 1);
  const conf = (a.s1conf && b.s1conf) ? 'med' : 'low';
  return apply(res, signal, conf,
    `Top50 last10: ${pctRate(a)} vs ${pctRate(b)}; surface top20 wins ${a.s2.toFixed(1)} vs ${b.s2.toFixed(1)}.`);
}
function pctRate(s) { return `${s.top50n} quality games`; }

// =========================================================================
// 8. W/UE RATIO — inert unless Michael supplies values in manual-inputs.json
//    Schema: { "wue": { "<numericKey>": { "winners": n, "unforced": n } } }
// =========================================================================
function winnerUE(ctx) {
  const c = config.adjustments.winnerUE;
  const res = base(c.id, 'winnerUE', 'Winner / unforced-error ratio',
    c.maxMagnitude, 'manual-inputs.json:wue');
  const manual = (loadManualInputs() || {}).wue || {};
  function ratio(p) {
    const row = p.numericKey != null ? manual[String(p.numericKey)] : null;
    if (!row || num(row.winners) == null || num(row.unforced) == null || row.unforced <= 0) return null;
    return row.winners / row.unforced;
  }
  const r1 = ratio(ctx.p1), r2 = ratio(ctx.p2);
  if (r1 == null || r2 == null) return gate(res, c.gateReason);
  // ratio ~1.0 is break-even; scale the difference
  const signal = clamp((r1 - r2) / 1.0, -1, 1);
  return apply(res, signal, 'med',
    `W/UE ${r1.toFixed(2)} vs ${r2.toFixed(2)} (manual input).`);
}

// =========================================================================
// 9. SERVE STRENGTH — ATP-leaderboard-style serve rating (career + last-52wk,
//    per surface). Each player gets a single rating = 1st-in% + 1st-won% +
//    2nd-won% + hold% + ace% − df%, exactly mirroring the atptour.com serve
//    leaderboard so Michael can cross-check a figure. Built from OUR own
//    career-splits database (pipeline refreshes career + rolling last-52-weeks
//    per surface weekly). last52 is weighted 0.6, career 0.4.
// =========================================================================
function serve(ctx) {
  const c = config.adjustments.serve;
  const res = base(c.id, 'serve', 'Serve strength',
    c.maxMagnitude, 'career-splits.json (career + last-52wk per surface)');
  const surfCat = surfaceCategory(ctx.surface);
  const bucket = ctx.bestOf === 5 ? 'Best of 5' : 'Best of 3';
  const r1 = blendedRating(ctx.p1.splits, surfCat, bucket, serveRatingRow);
  const r2 = blendedRating(ctx.p2.splits, surfCat, bucket, serveRatingRow);
  if (r1 == null || r2 == null) return res;
  // Serve ratings sit ~230-290; a 25-point gap is a decisive serving edge.
  const signal = clamp((r1 - r2) / 25, -1, 1);
  return apply(res, signal, 'med',
    `Serve rating ${r1.toFixed(1)} vs ${r2.toFixed(1)} (${surfCat || bucket}, career+52wk).`);
}

// =========================================================================
// 10. RETURN / PRESSURE — ATP-leaderboard-style return rating (career +
//    last-52wk, per surface). Rating = return-points-won% + break%, mirroring
//    the atptour.com return leaderboard. Built from OUR career-splits database
//    (last52 0.6 / career 0.4). Radar-independent, so it always fires.
// =========================================================================
function returnPressure(ctx) {
  const c = config.adjustments.returnPressure;
  const res = base(c.id, 'returnPressure', 'Return / pressure', c.maxMagnitude,
    'career-splits.json (career + last-52wk per surface)');
  const surfCat = surfaceCategory(ctx.surface);
  const bucket = ctx.bestOf === 5 ? 'Best of 5' : 'Best of 3';
  const r1 = blendedRating(ctx.p1.splits, surfCat, bucket, returnRatingRow);
  const r2 = blendedRating(ctx.p2.splits, surfCat, bucket, returnRatingRow);
  if (r1 == null || r2 == null) return res;
  // Return ratings sit ~50-75; a 15-point gap is a decisive return edge.
  const signal = clamp((r1 - r2) / 15, -1, 1);
  return apply(res, signal, 'med',
    `Return rating ${r1.toFixed(1)} vs ${r2.toFixed(1)} (${surfCat || bucket}, career+52wk).`);
}

// =========================================================================
// 11. FATIGUE — recent workload + turnaround (favours the fresher man).
//    Three ingredients per player over the rolling window:
//      • time on court  — total sets played (proxy for minutes; no duration
//        feed exists, so sets is the honest available measure);
//      • matches played — count in the window;
//      • turnaround     — hours since the player's most recent match.
//    A heavier load AND a shorter turnaround both raise the fatigue score;
//    the fresher player gets the edge.
// =========================================================================
function fatigue(ctx) {
  const c = config.adjustments.fatigue;
  const res = base(c.id, 'fatigue', 'Fatigue (recent load)', c.maxMagnitude, 'player-profiles.json:recentForm');
  const matchDate = new Date(ctx.match.date || ctx.match.day || Date.now());
  const windowMs = config.fatigueWindowDays * 24 * 3600 * 1000;
  function load(p) {
    const ms = recentMatchesSorted(p.profile);
    let sets = 0, count = 0, lastMs = null;
    for (const m of ms) {
      const d = new Date(m.date);
      const diff = matchDate - d;
      if (diff >= 0 && diff <= windowMs) {
        sets += parseSets(m.result); count++;
        if (lastMs == null || d > lastMs) lastMs = d;
      }
    }
    const turnaroundH = lastMs ? (matchDate - lastMs) / 3600000 : null;
    // Score = time on court (sets) + short-rest penalty. A turnaround under 48h
    // adds up to +3 (ramping from 0 at 48h to +3 at ~12h or less).
    let score = sets;
    if (turnaroundH != null && turnaroundH < 48) {
      score += clamp((48 - turnaroundH) / 12, 0, 3);
    }
    return { sets, count, turnaroundH, score };
  }
  const l1 = load(ctx.p1), l2 = load(ctx.p2);
  if (l1.count === 0 && l2.count === 0) { res.detail = 'No matches in window.'; return res; }
  // Heavier score => more fatigue => favour the fresher opponent.
  const signal = clamp((l2.score - l1.score) / 10, -1, 1);
  const t1 = l1.turnaroundH != null ? `last ${Math.round(l1.turnaroundH)}h` : 'rested';
  const t2 = l2.turnaroundH != null ? `last ${Math.round(l2.turnaroundH)}h` : 'rested';
  return apply(res, signal, 'low',
    `${config.fatigueWindowDays}d load: ${l1.sets} sets/${l1.count}m (${t1}) vs ${l2.sets} sets/${l2.count}m (${t2}).`);
}

// =========================================================================
// 12. WEATHER / CONDITIONS — wind hurts big servers, heat rewards movers
// =========================================================================
// Humidity + rain reinforce the SAME physics as heat/wind (heavy, slow, wet
// conditions reward the mover and blunt the server), at reduced weight. Founder
// spec TEN-8 2026-07-24; humidity/rain sign+weights are a physics-consistent
// first cut, gated for founder confirm before live merge. maxMagnitude (#12 =
// 0.03) still caps the layer, so extra inputs cannot exceed its designed ceiling.
const WEATHER_HUMID_MULT = 0.5;  // humidity effect vs heat (weaker, same sign)
const WEATHER_RAIN_MULT  = 0.5;  // rain effect vs heat (weaker, same sign)

// Open-Meteo WMO weathercodes that mean liquid precipitation (drizzle/rain/
// showers/thunder). Snow (71-77, 85-86) is excluded — irrelevant to ATP play.
function isRainCode(code) {
  return code != null && (
    (code >= 51 && code <= 67) ||   // drizzle + rain
    (code >= 80 && code <= 82) ||   // rain showers
    (code >= 95 && code <= 99)      // thunderstorm
  );
}

function weather(ctx) {
  const c = config.adjustments.weather;
  const res = base(c.id, 'weather', 'Weather / conditions', c.maxMagnitude, 'matches.json:weather / style-radar.json');
  const w = ctx.match.weather;
  if (!w) return res;
  const temp = num(w.temperature), wind = num(w.windSpeed), humidity = num(w.humidity);
  const r1 = ctx.p1.radar, r2 = ctx.p2.radar;
  if (!r1 || !r2) { res.detail = 'Reliable style radar unavailable for a player.'; return res; }
  let signal = 0;
  const parts = [];
  if (wind != null && wind > 20) {
    const windFactor = clamp((wind - 20) / 20, 0, 1);
    const serveGap = ((num(r1.serve) || 50) - (num(r2.serve) || 50)) / 100;
    signal += -windFactor * serveGap; // bigger server penalised in wind
    parts.push(`wind ${wind}km/h`);
  }
  if (temp != null && temp > 30) {
    const heatFactor = clamp((temp - 30) / 10, 0, 1);
    const moveGap = ((num(r1.movement) || 50) - (num(r2.movement) || 50)) / 100;
    signal += heatFactor * moveGap; // better mover rewarded in heat
    parts.push(`heat ${temp}\u00b0C`);
  }
  if (humidity != null && humidity > 70) {
    const humFactor = clamp((humidity - 70) / 30, 0, 1);
    const moveGap = ((num(r1.movement) || 50) - (num(r2.movement) || 50)) / 100;
    signal += WEATHER_HUMID_MULT * humFactor * moveGap; // heavy damp air rewards the mover
    parts.push(`humidity ${humidity}%`);
  }
  // Rain — FORECAST-WINDOW ONLY. Localise the match-day forecast entry; if none
  // is present/available (historical match, or no forecast) rain self-hides.
  const day = Array.isArray(w.week) ? w.week.find((d) => d && d.isMatch) : null;
  if (!w.historical && day && day.available !== false) {
    const precipPct = num(day.rain);          // precipitation probability, %
    // Combine weathercode + probability: precip probability is the base; a rain
    // weathercode floors it at 0.5 so a confirmed-rain day still fires even when
    // the probability field is low or absent.
    let rainProb = precipPct != null ? clamp(precipPct / 100, 0, 1) : 0;
    if (isRainCode(day.code)) rainProb = Math.max(rainProb, 0.5);
    if (rainProb > 0) {
      const serveGap = ((num(r1.serve) || 50) - (num(r2.serve) || 50)) / 100;
      const moveGap  = ((num(r1.movement) || 50) - (num(r2.movement) || 50)) / 100;
      // Wet/heavy court: reward the mover AND dampen the bigger server.
      signal += WEATHER_RAIN_MULT * rainProb * ((moveGap - serveGap) / 2);
      parts.push(`rain ~${Math.round(rainProb * 100)}%`);
    }
  }
  if (parts.length === 0) { res.detail = 'Neutral conditions.'; return res; }
  return apply(res, signal, 'low', `Conditions: ${parts.join(', ')}.`);
}

// =========================================================================
// 13. FORMAT SPLIT — Bo3 vs Bo5 (format-preference relative to other format)
// =========================================================================
function formatSplit(ctx) {
  const c = config.adjustments.formatSplit;
  const res = base(c.id, 'formatSplit', 'Format split (Bo3/Bo5)', c.maxMagnitude, 'career-splits.json');
  const thisFmt = ctx.bestOf === 5 ? 'Best of 5' : 'Best of 3';
  const otherFmt = ctx.bestOf === 5 ? 'Best of 3' : 'Best of 5';
  function fmtEdge(p) {
    const a = careerCat(p.splits, thisFmt), b = careerCat(p.splits, otherFmt);
    if (!a || !b) return null;
    if ((a.M || 0) < 10 || (b.M || 0) < 10) return null; // need samples in both
    if (num(a.winPct) == null || num(b.winPct) == null) return null;
    return a.winPct - b.winPct; // better at THIS format than the other
  }
  const e1 = fmtEdge(ctx.p1), e2 = fmtEdge(ctx.p2);
  if (e1 == null || e2 == null) { res.detail = 'Insufficient Bo3/Bo5 sample.'; return res; }
  const signal = clamp((e1 - e2) / 30, -1, 1);
  return apply(res, signal, 'low',
    `${thisFmt} edge: ${fmtPct(e1)} vs ${fmtPct(e2)}.`);
}

// =========================================================================
// 15. CLUTCH RATING — clutch-rating.json clutch index
// =========================================================================
function clutch(ctx) {
  const c = config.adjustments.clutch;
  const res = base(c.id, 'clutch', 'Clutch rating', c.maxMagnitude, 'clutch-rating.json');
  const c1 = ctx.p1.clutch, c2 = ctx.p2.clutch;
  if (!c1 || !c2 || num(c1.clutchIndex) == null || num(c2.clutchIndex) == null) return res;
  const signal = clamp((c1.clutchIndex - c2.clutchIndex) / c.divisor, -1, 1);
  const conf = (c1.confidence === 'high' && c2.confidence === 'high') ? 'med' : 'low';
  return apply(res, signal, conf,
    `Clutch ${Math.round(c1.clutchIndex)} vs ${Math.round(c2.clutchIndex)}.`);
}

// =========================================================================
// 17. ODDS MARKET MOVEMENT — Pinnacle opening vs current (lowest weight)
// =========================================================================
// ATP-level gate (#17 upgrade 4): line movement is only informative in a liquid
// ATP main-tour market. Challenger/ITF/Futures/WTA books are thin and noisy, so
// the layer is gated below tour level rather than reading noise as signal. Feed
// is ATP-only, so an unknown/blank tour is NOT gated (fail-open for the tour we
// serve); only explicit sub-tour markers gate out.
function isAtpLevel(match) {
  const tour = String(match.tour || '').toLowerCase();
  if (!tour) return true;
  return !/challenger|\bch\b|itf|\bm15\b|\bm25\b|futures|\bwta\b/.test(tour);
}

// Timing weight (#17 upgrade 2): a Pinnacle move that lands LATE (within
// lateWindowHours of the scheduled start) is sharper than early opening drift.
// Split the pre-match series at the late-window edge and weight by the fraction
// of the total move that happened late. Degrades to weight 1 when we can't tell
// the time (never penalise for missing timestamps).
function timingWeight(pin, match, c) {
  const cutoff = preMatchCutoffMs(match);
  const ticks = pin.ticks.filter(t => t.ts != null && t.vfP1 != null);
  if (cutoff == null || ticks.length < 3) return { weight: 1, late: false, label: 'timing n/a' };
  const lateEdge = cutoff - c.lateWindowHours * 3600 * 1000;
  let mid = null;
  for (const t of ticks) { if (t.ts <= lateEdge) mid = t; }
  if (!mid) return { weight: 1, late: true, label: 'move late' }; // all ticks inside late window
  const earlyShift = Math.abs(mid.vfP1 - pin.opening.vfP1);
  const lateShift = Math.abs(pin.current.vfP1 - mid.vfP1);
  const denom = earlyShift + lateShift;
  const lateFrac = denom > 1e-9 ? lateShift / denom : 0;
  const weight = c.timingFloor + (1 - c.timingFloor) * lateFrac;
  return { weight, late: lateFrac >= 0.5, label: `${Math.round(lateFrac * 100)}% late` };
}

// Steam detection (#17 upgrade 3): cross-book agreement on the move direction.
// Count books whose own pre-match vig-free line moved the same way as Pinnacle
// (steam = coordinated sharp money) vs against it. Full weight when >= steamMinBooks
// agree; a lone Pinnacle move is discounted (steamLoneMult), partial agreement
// sits in between (steamMidMult).
function steamFactor(match, pinDir, c) {
  const books = (match.oddsMovement && match.oddsMovement.books)
    ? Object.keys(match.oddsMovement.books) : [];
  const thresh = c.minMove * 0.5;
  let agree = 0, oppose = 0;
  for (const b of books) {
    const s = bookSeries(match, b);
    if (!s || Math.abs(s.shift) < thresh) continue; // flat/absent book: not a mover
    if (Math.sign(s.shift) === pinDir) agree++; else oppose++;
  }
  const total = agree + oppose;
  const confirmed = agree >= c.steamMinBooks && agree > oppose;
  let mult;
  if (confirmed) mult = 1.0;
  else if (total <= 1) mult = c.steamLoneMult;   // only Pinnacle moved
  else mult = c.steamMidMult;                     // partial cross-book agreement
  return { agree, oppose, total, mult, confirmed };
}

function oddsMovement(ctx) {
  const c = config.adjustments.oddsMovement;
  const res = base(c.id, 'oddsMovement', 'Odds market movement', c.maxMagnitude, 'matches.json:oddsMovement');
  // Honest, machine-visible data-block: reverse-line-move is not built (no
  // public-betting % in any licensed feed). Surfaced, never faked.
  res.reverseLineMove = c.reverseLineMove;

  // (4) ATP-level gate
  if (!isAtpLevel(ctx.match)) {
    return gate(res, 'below ATP tour level \u2014 market too thin for movement to be informative');
  }

  // (5) no-line flag \u2014 no clean pre-match Pinnacle tick history to read.
  const pin = bookSeries(ctx.match, 'Pinnacle');
  if (!pin) {
    res.noLine = true;
    res.detail = 'No clean pre-match Pinnacle line (no-line) \u2014 movement signal unavailable.';
    return res;
  }

  const shift = pin.shift;                 // + => market moved toward p1
  const absShift = Math.abs(shift);

  // (1) move-size threshold \u2014 a vig-free move under minMove is book noise.
  if (absShift < c.minMove) {
    res.detail = `Pinnacle move ${fmtPct(shift * 100)} < ${fmtPct(c.minMove * 100)} threshold \u2014 treated as noise.`;
    return res; // signal stays 0 (dead-zone)
  }
  const span = Math.max(c.fullMove - c.minMove, 1e-6);
  const raw = Math.sign(shift) * clamp((absShift - c.minMove) / span, 0, 1);

  // (2) timing weight and (3) steam detection
  const timing = timingWeight(pin, ctx.match, c);
  const steam = steamFactor(ctx.match, Math.sign(shift), c);

  const signal = clamp(raw * timing.weight * steam.mult, -1, 1);
  const conf = steam.confirmed ? (timing.late ? 'med' : 'low') : 'low';
  const detail =
    `Pinnacle p1 ${fmtPct(pin.opening.vfP1 * 100)}\u2192${fmtPct(pin.current.vfP1 * 100)} ` +
    `(${steam.agree}/${steam.total} books ${steam.confirmed ? 'steam' : 'no steam'}, ${timing.label}).`;
  return apply(res, signal, conf, detail);
}

// ---- formatting helper ----------------------------------------------------
function fmtPct(x) {
  if (x == null) return 'n/a';
  const s = x >= 0 ? '+' : '';
  return `${s}${Math.round(x * 10) / 10}%`;
}

// ---- registry (order = display order, roughly the weight hierarchy) -------
// Model v2.0 (Step 1): layers #6 (roundStage) and #14 (courtSpeed) removed.
// 14 active layers remain (13 green + 1 gated: #8 winnerUE).
const ALL = [
  styleMatchup, subjective, h2h, surface, recentForm,
  qualityForm, winnerUE,
  serve, returnPressure, fatigue, weather, formatSplit,
  clutch, oddsMovement,
];

function runAll(ctx) {
  return ALL.map(fn => fn(ctx));
}

// h2h + setDominance exported for unit tests (pure fns; today's live board is
// all Tier 3, so the tier-1/2 + dominance paths can only be exercised directly).
module.exports = { runAll, clamp, h2h, setDominance };
