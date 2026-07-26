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
const { surfaceCategory, rankOf, loadManualInputs, loadMcpBaseline } = require('./data');
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

// Return rating = return-points-won% + break% (games broken) + break-point
// conversion% WHERE the splits row carries it. `bpConvPct` is dormant today —
// career-splits.json has no BP-conversion field, and the only live bpConverted
// is the current match's own result (target leakage), so it is deliberately not
// sourced from there. Guarded by presence so it folds in automatically the day
// the splits pipeline adds it, without changing anyone's rating until then.
function returnRatingRow(row) {
  if (!row) return null;
  const rp = num(row.rpwPct), br = num(row.brkPct), bpc = num(row.bpConvPct);
  if (rp == null) return null;
  return rp + (br || 0) + (bpc || 0);
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

// Serve sub-rating on ONLY the 3 components a single-event stat sheet carries:
// 1st-serve-in% + 1st-serve-won% + 2nd-serve-won%. Used to compute the
// in-tournament deviation against the SAME-scope season blend so hold%/ace%/df%
// cancel and the re-priced serve rating stays on the full serveRatingRow scale.
function serveSharedRow(row) {
  if (!row) return null;
  const fi = num(row.firstInPct), fw = num(row.firstWonPct), sw = num(row.secondWonPct);
  if (fi == null || fw == null || sw == null) return null;
  return fi + fw + sw;
}

// In-tournament serve tier (#9 top tier): re-price the serve rating using this
// event's COMPLETED earlier rounds. Reads tournament-progression.json (already
// in ctx as ctx.progression — api-tennis per-round 1st-in / 1st-won / 2nd-won %,
// built for the Progression tab), averages the 3 observed serve components over
// the player's finished rounds in the current tournament, and returns a bounded
// nudge = weight x (this-event avg − same-scope season 3-comp blend). Progression
// carries ONLY finished rounds, so every row is strictly earlier than the
// upcoming match being priced (no leakage), and a player with no finished rounds
// yet (R1) yields null => the tier self-hides and serve falls back to season.
function inTournamentServeDelta(ctx, playerObj, splits, surfCat, bucket) {
  const cfg = config.adjustments.serve && config.adjustments.serve.inTournament;
  if (!cfg || !playerObj || !splits) return null;
  const prog = ctx.progression && ctx.progression.tournaments;
  if (!prog) return null;
  const tourName = String((ctx.match && ctx.match.tour) || '').replace(/^ATP\s+/i, '').trim();
  const t = tourName && prog[tourName];
  if (!t || !Array.isArray(t.players)) return null;
  const key = String(playerObj.numericKey);
  const pRow = t.players.find(pp => pp && String(pp.playerKey) === key);
  if (!pRow || !Array.isArray(pRow.rounds)) return null;
  let fi = 0, fw = 0, sw = 0, n = 0;
  for (const r of pRow.rounds) {
    const met = r && r.metrics;
    if (!met) continue;
    const a = num(met.firstServePct), b = num(met.firstServeWonPct), c2 = num(met.secondServeWonPct);
    if (a == null || b == null || c2 == null) continue;
    fi += a; fw += b; sw += c2; n++;
  }
  const minR = num(cfg.minRounds) != null ? cfg.minRounds : 1;
  if (n < minR) return null;
  const itShared = (fi + fw + sw) / n;                 // this-event 3-comp avg
  const seasonShared = blendedRating(splits, surfCat, bucket, serveSharedRow);
  if (seasonShared == null) return null;                // no season baseline to deviate from
  const w = num(cfg.weight) != null ? cfg.weight : 0.5;
  const cap = num(cfg.maxDeltaPP) != null ? cfg.maxDeltaPP : 20;
  const nudge = clamp(w * (itShared - seasonShared), -cap, cap);
  return { nudge: round4(nudge), n, itShared: round4(itShared), seasonShared: round4(seasonShared) };
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
//   • set-score dominance — straight sets = 1.0, Bo5 win-in-four (3-1) = 0.8,
//     any other completed result (2-1 / 3-2) = 0.6 (signed by who won: a
//     straight-sets LOSS is a stronger negative than a 1-3 loss, which is
//     stronger than a 2-3 loss).
// The FILTERED (weight-summed) meeting count N_eff drives a three-tier sample
// system that scales the whole layer's magnitude: Tier 1 (N_eff>=8) full, Tier 2
// (3-7) 45%, Tier 3 (<3) near-zero. Zero *raw* meetings hides the layer entirely
// (res.hidden) so the Bet Confirmation Stack shows no empty H2H row.
// All thresholds/weights come from config.adjustments.h2h (defaults inline as a
// safety net so the function is robust if a knob is ever absent).

// Set-score dominance from an "a - b" result string (already reordered p1-first).
// Three tiers (unsigned magnitude; the caller applies the +/- sign by who won):
//   • straight sets (loser took 0: 2-0 / 3-0)          => 1.0  full dominance
//   • Bo5 win-in-four (winner 3, loser 1: 3-1)         => 0.8  strong but not clean
//   • any other completed win (2-1 / 3-2)              => 0.6  competitive
// Unparseable score but a known winner => a neutral middle default (unknown).
function setDominance(result, dcfg) {
  const D = dcfg || { straight: 1.0, oneDropped: 0.8, competitive: 0.6, unknown: 0.7 };
  if (typeof result !== 'string') return D.unknown;
  const parts = result.split('-').map(s => parseInt(s.trim(), 10));
  if (parts.length !== 2 || parts.some(n => !isFinite(n))) return D.unknown;
  const winnerSets = Math.max(parts[0], parts[1]);
  const loserSets  = Math.min(parts[0], parts[1]);
  if (loserSets === 0) return D.straight;                       // 2-0 / 3-0
  if (winnerSets === 3 && loserSets === 1) return D.oneDropped; // 3-1 (Bo5 win-in-4)
  return D.competitive;                                         // 2-1 / 3-2
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
// 5. RECENT FORM — v2.0 redesign (TEN-8, 2026-07-25).
//    Blends two per-player signals, then takes the differential:
//      Signal A (60%) — SHORT MOMENTUM: last 3-5 matches, recency-weighted
//        (x1.0, .85, .70, .55, .40 most-recent-first).
//      Signal B (40%) — RECENT-FORM QUALITY: last 10 matches OR last 8 weeks
//        (whichever is the larger window), each match weighted by opposition
//        quality (top-10 x2.0 ... Challenger/ITF x0.4). <5 matches => B=0, the
//        player runs on Signal A alone.
//    A SURFACE DISCOUNT (same surface as today x1.0, different x0.30) multiplies
//    each match's weight in BOTH signals before the rate is computed, so a
//    cross-surface result counts for less. Each player's blended form is
//    centred (0.5 win-rate => neutral 0). 14+ days without a competitive match
//    cancels that player's signal (neutral 0, flagged insufficient activity) —
//    the layer still runs off the other player. Magnitude 2.5pp per the spec.
//    A large form gap (|differential| > threshold) is flagged for the summary.
// =========================================================================
// Full per-player breakdown (exported for the validation harness so the exact
// per-match weights are auditable). Returns:
//   { active, S (centred [-1,1]), F ([0,1] blended form), A, B, aOnly,
//     reason, aTrace[], bTrace[] }
function recentFormParts(p, ctx) {
  const c = config.adjustments.recentForm;
  const surfCat = surfaceCategory(ctx.surface);
  const rw = c.recencyWeights || [1.0, 0.85, 0.70, 0.55, 0.40];
  const qw = c.qualityWeights || { top10: 2.0, top50: 1.5, top100: 1.0, beyond100: 0.6, challengerITF: 0.4 };
  const sdSame = num(c.surfaceSameMult) != null ? c.surfaceSameMult : 1.0;
  const sdDiff = num(c.surfaceDiffMult) != null ? c.surfaceDiffMult : 0.30;
  const matchDate = new Date(ctx.match.date || Date.now());

  // Surface discount for a historical match vs today's surface. When today's
  // surface is unknown we cannot discount, so everything counts at 1.0.
  const surfDiscount = (m) => (!surfCat ? 1.0
    : (surfaceCategory(m.surface) === surfCat ? sdSame : sdDiff));

  // Opposition-quality multiplier (Signal B) from the opponent's rank ON the day
  // of that match (rank-at-time sidecar, Step 2a; current-rank fallback). An
  // unrankable opponent is treated as Challenger/ITF-level opposition.
  const qualityMult = (m) => {
    const r = rankOf(m.opponentKey, m.opponent, m.date);
    if (r == null) return qw.challengerITF;
    if (r <= 10) return qw.top10;
    if (r <= 50) return qw.top50;
    if (r <= 100) return qw.top100;
    return qw.beyond100;
  };

  const ms = recentMatchesSorted(p.profile);
  if (!ms.length) return { active: false, S: 0, F: null, reason: 'no recent matches' };

  // --- inactivity: 14+ days since the last COMPETITIVE (non-walkover) match ---
  const lastComp = ms.find(m => !m.walkover);
  if (!lastComp) return { active: false, S: 0, F: null, reason: 'no competitive match' };
  const gapDays = (matchDate - new Date(lastComp.date)) / 86400000;
  if (gapDays >= c.inactivityDays) {
    return { active: false, S: 0, F: null, reason: `inactive ${Math.round(gapDays)}d`, gapDays };
  }

  // --- Signal A: last 3-5 matches, recency x surface weighted ---
  const aMatches = ms.slice(0, rw.length);
  let aNum = 0, aDen = 0; const aTrace = [];
  aMatches.forEach((m, i) => {
    const sd = surfDiscount(m);
    const w = rw[i] * sd;
    aDen += w; if (m.won) aNum += w;
    aTrace.push({ date: m.date, surf: m.surface, won: !!m.won, recW: rw[i], surfD: sd, w: round4(w) });
  });
  const A = aDen > 0 ? aNum / aDen : null;
  if (A == null) return { active: false, S: 0, F: null, reason: 'no Signal A' };

  // --- Signal B: last 10 matches OR last 8 weeks, whichever LARGER ---
  const weeksMs = c.signalBWeeks * 7 * 86400000;
  const inWeeks = ms.filter(m => { const d = matchDate - new Date(m.date); return d >= 0 && d <= weeksMs; });
  const bWindow = Math.max(c.signalBWindow, inWeeks.length);
  const bMatches = ms.slice(0, bWindow);
  let B = null; const bTrace = [];
  if (bMatches.length >= c.signalBMinMatches) {
    let bNum = 0, bDen = 0;
    for (const m of bMatches) {
      const sd = surfDiscount(m);
      const q = qualityMult(m);
      const w = q * sd;
      bDen += w; if (m.won) bNum += w;
      bTrace.push({ date: m.date, opp: m.opponent, rank: rankOf(m.opponentKey, m.opponent, m.date),
                    qMult: q, surfD: sd, w: round4(w), won: !!m.won });
    }
    B = bDen > 0 ? bNum / bDen : null;
  }

  // --- blend within the player; centre at neutral 0.5 win-rate ---
  const aOnly = (B == null);
  const F = aOnly ? A : (c.signalAWeight * A + c.signalBWeight * B);
  const S = clamp(2 * F - 1, -1, 1);
  return { active: true, S, F, A, B, aOnly, nA: aMatches.length, nB: bMatches.length, aTrace, bTrace };
}

function recentForm(ctx) {
  const c = config.adjustments.recentForm;
  const res = base(c.id, 'recentForm', 'Recent form', c.maxMagnitude, 'player-profiles.json:recentForm');
  const f1 = recentFormParts(ctx.p1, ctx), f2 = recentFormParts(ctx.p2, ctx);

  // Nothing to say only when BOTH players lack usable activity.
  if (!f1.active && !f2.active) {
    res.detail = `Insufficient recent activity (${f1.reason} / ${f2.reason}).`;
    return res;
  }

  // Centred-form difference, halved so the max spread maps to full magnitude.
  const signal = clamp((f1.S - f2.S) / 2, -1, 1);

  // Flag a large form gap on the [0,1] blended-form scale (inactive => neutral 0.5).
  const fa = f1.F != null ? f1.F : 0.5, fb = f2.F != null ? f2.F : 0.5;
  const formDiff = Math.abs(fa - fb);
  const flagged = formDiff > c.flagDiffThreshold;

  const conf = (f1.active && f2.active && !f1.aOnly && !f2.aOnly) ? 'med' : 'low';
  const desc = (f) => f.active ? `${Math.round(f.F * 100)}%${f.aOnly ? ' (A only)' : ''}` : `inactive`;
  const out = apply(res, signal, conf,
    `Form ${desc(f1)} vs ${desc(f2)} (A=last${(c.recencyWeights || []).length} recency-wtd, B=quality-wtd; surface-discounted).` +
    (flagged ? ' Significant form gap flagged.' : ''));
  out.formFlag = flagged;          // consumed by the AI summary / admin surfaces
  out.formDiff = round4(formDiff);
  return out;
}

// =========================================================================
// 7. QUALITY-ADJUSTED CAREER FORM (v2.0 rebuild)
//    Pure career signal — no overlap with recent-form (#5). Reads the
//    career-splits `q7` block: per-player [M,W] counts bucketed into three
//    recency eras (<=2yr / 2-4yr / 4yr+), for the overall record, the
//    vs-top-50 record, and the vs-top-50 record on each surface. Opponent rank
//    is taken AT MATCH TIME by the builder (sharper than a current-rank proxy).
//      Signal A (weightA): (career top-50 win% − overall career win%) — does a
//        player raise or fold vs elite? The layer takes the DIFFERENCE of the
//        two players' deviations.
//      Signal B (weightB): (top-50 win% ON THIS SURFACE − overall top-50 win%)
//        — the surface-specific quality ceiling. Again the difference of devs.
//    Win rates are recency-weighted (recencyWeights on the era counts). Each
//    signal is independently sample-damped by its own top-50 match count
//    (dampTiers); below the smallest tier it is zeroed and flagged. Signal B
//    needs >= surfaceFloorM surface top-50 matches to fire. The combined damped
//    deviation-difference is scaled by signalScale into [-1,1].
// =========================================================================
// bucket = [M0,W0,M1,W1,M2,W2]; -> { wr: recency-weighted fraction|null, M: raw }.
function q7weightedWR(bucket, weights) {
  if (!Array.isArray(bucket)) return { wr: null, M: 0 };
  let wNum = 0, wDen = 0, M = 0;
  for (let e = 0; e < 3; e++) {
    const m = bucket[e * 2] || 0, w = bucket[e * 2 + 1] || 0;
    const wt = weights[e];
    wDen += wt * m; wNum += wt * w; M += m;
  }
  return { wr: wDen > 0 ? wNum / wDen : null, M };
}
function q7damp(M, tiers) {
  for (const [floor, factor] of tiers) if (M >= floor) return factor;
  return 0; // below smallest tier -> near-zero + flag
}
function qualityForm(ctx) {
  const c = config.adjustments.qualityForm;
  const res = base(c.id, 'qualityForm', 'Quality-adjusted form', c.maxMagnitude,
    'career-splits.json:q7 (career top-50 form, recency-weighted)');
  const cat = surfaceCategory(ctx.surface); // 'Hard' | 'Clay' | 'Grass' | null
  const W = c.recencyWeights;
  const smallestTier = c.dampTiers[c.dampTiers.length - 1][0];

  function devs(p) {
    const q = p.splits && p.splits.q7;
    if (!q) return null;
    const overall = q7weightedWR(q.overall, W);
    const top50 = q7weightedWR(q.top50, W);
    if (overall.wr == null || top50.wr == null) return null;

    // Signal A: top-50 win% deviation from overall win%.
    const devA = top50.wr - overall.wr;
    const dampA = q7damp(top50.M, c.dampTiers);

    // Signal B: surface top-50 win% vs overall top-50 win% — fires only with
    // enough surface top-50 matches (M >= surfaceFloorM), else contributes 0.
    let devB = 0, dampB = 0, surfM = 0;
    const sb = cat && q.surf50 && q.surf50[cat];
    if (sb) {
      const surf = q7weightedWR(sb, W);
      surfM = surf.M;
      if (surf.wr != null && surf.M >= c.surfaceFloorM) {
        devB = surf.wr - top50.wr;
        dampB = q7damp(surf.M, c.dampTiers);
      }
    }
    return {
      devA, dampA, devB, dampB, top50M: top50.M, surfM,
      lowA: top50.M < smallestTier,       // under 10 career top-50 -> flagged
      lowB: !(surfM >= c.surfaceFloorM),  // under the surface floor
    };
  }

  const a = devs(ctx.p1), b = devs(ctx.p2);
  if (!a || !b) return res;

  const sigA = (a.devA * a.dampA) - (b.devA * b.dampA);
  const sigB = (a.devB * a.dampB) - (b.devB * b.dampB);
  const combined = c.weightA * sigA + c.weightB * sigB;
  const signal = clamp(combined / c.signalScale, -1, 1);

  const fullTier = c.dampTiers[0][0];
  const conf = (a.top50M >= fullTier && b.top50M >= fullTier) ? 'med' : 'low';
  const flagged = a.lowA || b.lowA;
  const pp = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
  const out = apply(res, signal, conf,
    `Career top50 dev ${pp(a.devA)}(${a.top50M}m) vs ${pp(b.devA)}(${b.top50M}m); ` +
    `${cat || 'surface'} top50 dev ${pp(a.devB)}(${a.surfM}m) vs ${pp(b.devB)}(${b.surfM}m).` +
    (flagged ? ' Thin top-50 sample flagged.' : ''));
  out.qualityFlag = flagged;
  return out;
}

// =========================================================================
// 8. W/UE RATIO — archetype-relative Winner/Unforced over/under-performance.
//    Each player's aggregated Winner/Unforced ratio (profile.wue, built in the
//    pipeline from api-tennis per-match W/UE with @ATP_Entry OCR fallback,
//    never mixed within a fixture) is normalised against their playing-style
//    archetype's MCP-charted expectation (mcp-archetype-baseline.json). The
//    edge is the gap between the two players' relative over-performance, so a
//    counter-puncher hitting 1.0 (well above its 0.82 archetype norm) reads as
//    aggressive relative to expectation, not just in absolute terms.
//    SELF-HIDES (returns an un-applied result, NOT gate()) when either player
//    lacks aggregated W/UE — the display filter drops a non-applied winnerUE
//    row, so it never renders a dimmed placeholder. On the all-ATP-250 live
//    board (0% api-tennis W/UE, OCR only for finished Estoril/Kitzbühel) this
//    self-hides board-wide; it fires once a fixture carrying api-tennis W/UE
//    (Slams, and larger events) is priced.
// =========================================================================
function winnerUE(ctx) {
  const c = config.adjustments.winnerUE;
  const res = base(c.id, 'winnerUE', 'Winner / unforced-error ratio',
    c.maxMagnitude, 'player-profiles.json:wue × MCP archetype baseline');
  const w1 = ctx.p1 && ctx.p1.profile && ctx.p1.profile.wue;
  const w2 = ctx.p2 && ctx.p2.profile && ctx.p2.profile.wue;
  // Self-hide when either player has no aggregated W/UE (or a degenerate ratio).
  if (!w1 || !w2 || !(num(w1.ratio) > 0) || !(num(w2.ratio) > 0)) return res;

  const baseline = loadMcpBaseline();
  const arch = (baseline && baseline.archetypes) || {};
  const tb = baseline && baseline.tourBaseline;
  const tourRatio = (tb && tb.unforcedRatePerPt > 0)
    ? tb.winnerRatePerPt / tb.unforcedRatePerPt
    : 0.95;
  // Archetype expectation for a player: their classified style's charted wuRatio,
  // falling back to the whole-tour ratio when the style is unknown/absent.
  const expect = (p) => {
    const skey = p && p.style && p.style.primary;
    const a = skey && arch[skey];
    return (a && num(a.wuRatio) > 0) ? a.wuRatio : tourRatio;
  };
  const b1 = expect(ctx.p1), b2 = expect(ctx.p2);
  const rel1 = w1.ratio / b1, rel2 = w2.ratio / b2; // 1.0 = playing to archetype
  // A 0.30 gap in relative over-performance = full magnitude toward that player.
  const signal = clamp((rel1 - rel2) / 0.30, -1, 1);
  const srcNote = (w1.source === w2.source) ? w1.source : `${w1.source}/${w2.source}`;
  return apply(res, signal, 'med',
    `W/UE ${w1.ratio.toFixed(2)} vs ${w2.ratio.toFixed(2)} — rel-to-archetype ${rel1.toFixed(2)} vs ${rel2.toFixed(2)} (${srcNote}, ${w1.matches}/${w2.matches} matches).`);
}

// =========================================================================
// 9. SERVE STRENGTH — ATP-leaderboard-style serve rating (career + last-52wk,
//    per surface). Each player gets a single rating = 1st-in% + 1st-won% +
//    2nd-won% + hold% + ace% − df%, exactly mirroring the atptour.com serve
//    leaderboard so Michael can cross-check a figure. Built from OUR own
//    career-splits database (pipeline refreshes career + rolling last-52-weeks
//    per surface weekly). last52 is weighted 0.6, career 0.4.
// =========================================================================
// --- Layer #9 serve-reprice helpers ---------------------------------------
// Tournament altitude (metres) via the curated, VERIFIED config map (substring
// match on the tournament name; never a guess — see config.altitudeMeters).
function tournamentAltitude(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  const map = config.altitudeMeters || {};
  for (const key in map) { if (n.includes(key)) return map[key]; }
  return null;
}

// Surface base magnitude (probability points) by court-speed tier:
// grass = Fast, hard = Medium, clay = Slow. Unknown surface -> Medium.
function serveBaseMag(surfCat) {
  const s = (config.adjustments.serve && config.adjustments.serve.baseScalePP) || {};
  if (surfCat === 'Grass') return num(s.Fast) != null ? s.Fast : 0.04;
  if (surfCat === 'Clay')  return num(s.Slow) != null ? s.Slow : 0.02;
  return num(s.Medium) != null ? s.Medium : 0.025; // Hard + unknown surface
}

// Altitude multiplier from the tiered table (thinner air amplifies serve).
// Tiers are ordered high->low; the first threshold the altitude clears wins.
function serveAltitudeMult(alt) {
  if (alt == null) return 1.0;
  const tiers = (config.adjustments.serve && config.adjustments.serve.altitudeTiers) || [];
  for (const t of tiers) { if (alt >= t.minM) return t.mult; }
  return 1.0;
}

function serve(ctx) {
  const c = config.adjustments.serve;
  const CEIL = num(c.maxMagnitude) != null ? c.maxMagnitude : 0.05;
  const res = base(c.id, 'serve', 'Serve strength', CEIL,
    'career-splits.json (career + last-52wk per surface) + config.altitudeMeters');
  const surfCat = surfaceCategory(ctx.surface);
  const bucket = ctx.bestOf === 5 ? 'Best of 5' : 'Best of 3';

  // Per-player serve rating: surface-specific when the surface sample is real
  // (>= surfaceMinM career matches on THIS surface), otherwise the universal
  // (all-surface, format-bucket) rating flagged for a reliability penalty.
  const minM = num(c.surfaceMinM) != null ? c.surfaceMinM : 10;
  function ratingFor(playerObj) {
    const splits = playerObj && playerObj.splits;
    if (!splits) return null;
    const cs = surfCat && splits.career && splits.career[surfCat];
    const sm = cs && num(cs.M) != null ? cs.M : 0;
    let rating = null, reliable = false, effSurf = null;
    if (surfCat && sm >= minM) {
      const r = blendedRating(splits, surfCat, bucket, serveRatingRow);
      if (r != null) { rating = r; reliable = true; effSurf = surfCat; }
    }
    if (rating == null) {
      const u = blendedRating(splits, null, bucket, serveRatingRow); // universal
      if (u == null) return null;
      rating = u; reliable = false; effSurf = null;
    }
    // In-tournament top tier: re-price on this event's completed earlier rounds,
    // deviating against the SAME scope (surface or universal) as the base rating.
    const it = inTournamentServeDelta(ctx, playerObj, splits, effSurf, bucket);
    if (it) rating += it.nudge;
    return { rating, reliable, inTourn: it || null };
  }
  const a = ratingFor(ctx.p1), b = ratingFor(ctx.p2);
  if (!a || !b) return res;

  // Dynamic magnitude = surface base scale x altitude multiplier, capped at CEIL.
  const baseMag = serveBaseMag(surfCat);
  const cspd = ctx.match.courtSpeed;
  let alt = cspd && num(cspd.altitude) != null ? cspd.altitude : null;
  if (alt == null) alt = tournamentAltitude(ctx.match && ctx.match.tour);
  const altMult = serveAltitudeMult(alt);
  const effMag = Math.min(CEIL, baseMag * altMult);
  res.maxMagnitude = round4(effMag);

  // Serve ratings sit ~230-290; a 25-point gap is a decisive serving edge.
  let signal = clamp((a.rating - b.rating) / 25, -1, 1);
  // Reliability penalty when EITHER player is on the universal fallback rating.
  const relDamp = (a.reliable && b.reliable)
    ? 1.0 : (num(c.universalPenalty) != null ? c.universalPenalty : 0.70);
  signal *= relDamp;

  const speed = surfCat === 'Grass' ? 'fast' : surfCat === 'Clay' ? 'slow' : 'medium';
  const altPart = (alt != null && altMult > 1.0) ? `, ${Math.round(alt)}m x${altMult.toFixed(2)}` : '';
  const relPart = relDamp < 1.0 ? ', thin-surface x0.70' : '';
  // In-tournament top tier: note who it re-priced and off how many rounds.
  const itNote = (r) => r.inTourn ? `${r.inTourn.n}r ${r.inTourn.nudge >= 0 ? '+' : ''}${r.inTourn.nudge.toFixed(1)}` : null;
  const ia = itNote(a), ib = itNote(b);
  const itPart = (ia || ib) ? `; in-tourn ${ia || '—'} / ${ib || '—'}` : '';
  return apply(res, signal, 'med',
    `Serve rating ${a.rating.toFixed(1)} vs ${b.rating.toFixed(1)} ` +
    `(${surfCat || bucket}; ${speed} base ${(baseMag * 100).toFixed(1)}pp${altPart}${relPart}; ` +
    `mag ${(effMag * 100).toFixed(1)}pp${itPart}).`);
}

// =========================================================================
// 10. RETURN / PRESSURE — ATP-leaderboard-style return rating (career +
//    last-52wk, per surface). Rating = return-points-won% + break%, mirroring
//    the atptour.com return leaderboard. Built from OUR career-splits database
//    (last52 0.6 / career 0.4). Radar-independent, so it always fires.
// =========================================================================
// --- Layer #10 return-reprice helpers (inverse of serve #9) ----------------
// Surface base magnitude (probability points): return is MOST valuable on slow
// courts, least on fast. clay = Slow, hard = Medium, grass = Fast. Unknown
// surface -> Medium (hard) as the neutral default.
function returnBaseMag(surfCat) {
  const s = (config.adjustments.returnPressure && config.adjustments.returnPressure.baseScalePP) || {};
  if (surfCat === 'Grass') return num(s.Fast) != null ? s.Fast : 0.015;
  if (surfCat === 'Clay')  return num(s.Slow) != null ? s.Slow : 0.03;
  return num(s.Medium) != null ? s.Medium : 0.0175; // Hard + unknown surface
}

// Altitude multiplier: thin air aids the server and BLUNTS the returner, so the
// tiers SUPPRESS (<=1.0). Tiers ordered high->low; first threshold cleared wins.
function returnAltitudeMult(alt) {
  if (alt == null) return 1.0;
  const tiers = (config.adjustments.returnPressure && config.adjustments.returnPressure.altitudeTiers) || [];
  for (const t of tiers) { if (alt >= t.minM) return t.mult; }
  return 1.0;
}

function returnPressure(ctx) {
  const c = config.adjustments.returnPressure;
  const CEIL = num(c.maxMagnitude) != null ? c.maxMagnitude : 0.03;
  const res = base(c.id, 'returnPressure', 'Return / pressure', CEIL,
    'career-splits.json (career + last-52wk per surface) + config.altitudeMeters');
  const surfCat = surfaceCategory(ctx.surface);
  const bucket = ctx.bestOf === 5 ? 'Best of 5' : 'Best of 3';
  const r1 = blendedRating(ctx.p1.splits, surfCat, bucket, returnRatingRow);
  const r2 = blendedRating(ctx.p2.splits, surfCat, bucket, returnRatingRow);
  if (r1 == null || r2 == null) return res;

  // Dynamic magnitude = surface base scale x altitude multiplier, capped at CEIL.
  // Altitude only ever suppresses (mult <= 1.0), so the ceiling binds solely at
  // slow + sea level (3.0pp x 1.00); it is a safety clamp, not a common path.
  const baseMag = returnBaseMag(surfCat);
  const cspd = ctx.match.courtSpeed;
  let alt = cspd && num(cspd.altitude) != null ? cspd.altitude : null;
  if (alt == null) alt = tournamentAltitude(ctx.match && ctx.match.tour);
  const altMult = returnAltitudeMult(alt);
  const effMag = Math.min(CEIL, baseMag * altMult);
  res.maxMagnitude = round4(effMag);

  // Return ratings sit ~50-75; a 15-point gap is a decisive return edge.
  const signal = clamp((r1 - r2) / 15, -1, 1);
  const speed = surfCat === 'Grass' ? 'fast' : surfCat === 'Clay' ? 'slow' : 'medium';
  const altPart = (alt != null && altMult < 1.0) ? `, ${Math.round(alt)}m x${altMult.toFixed(2)}` : '';
  return apply(res, signal, 'med',
    `Return rating ${r1.toFixed(1)} vs ${r2.toFixed(1)} ` +
    `(${surfCat || bucket}, career+52wk; ${speed} base ${(baseMag * 100).toFixed(2)}pp${altPart}; ` +
    `mag ${(effMag * 100).toFixed(2)}pp).`);
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
// Tournament UTC offset (hours) via the curated, VERIFIED config map (substring
// match; never a guess — see config.tournamentUtcOffset). Null => unmapped, so
// the travel factor self-hides rather than inventing a location.
function tournamentTz(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  const map = config.tournamentUtcOffset || {};
  for (const key in map) { if (n.includes(key)) return map[key]; }
  return null;
}

// One player's fatigue "units" over the rolling window = sets played (time on
// court) x the stacked per-player load multipliers. Returns the raw pieces so
// the layer can build an honest, auditable detail string.
function fatigueUnits(p, ctx, c) {
  const matchDate = new Date(ctx.match.date || ctx.match.day || Date.now());
  const windowMs = c.windowDays * 24 * 3600 * 1000;
  const inWin = [];
  for (const m of recentMatchesSorted(p.profile)) {   // sorted most-recent first
    if (m.walkover) continue;                           // a walkover is not court time
    const d = new Date(m.date);
    const diff = matchDate - d;
    if (diff >= 0 && diff <= windowMs) inWin.push({ m, d });
  }
  const sets = inWin.reduce((s, x) => s + parseSets(x.m.result), 0);
  const count = inWin.length;
  const factors = [];
  let mult = 1.0;

  // Short turnaround: minMatches+ in the window AND at least one back-to-back
  // pair. Dates are day-granular (no time-of-day feed), so "<36h" is honestly
  // approximated as consecutive calendar days (rest gap <= restDaysThresh).
  if (count >= c.shortTurnaround.minMatches) {
    const asc = inWin.slice().sort((a, b) => a.d - b.d);
    let backToBack = false;
    for (let i = 1; i < asc.length; i++) {
      const gapDays = Math.round((asc[i].d - asc[i - 1].d) / 86400000);
      if (gapDays <= c.shortTurnaround.restDaysThresh) { backToBack = true; break; }
    }
    if (backToBack) { mult *= c.shortTurnaround.mult; factors.push(`turnaround x${c.shortTurnaround.mult}`); }
  }

  // Surface change: 2+ distinct surfaces across the window (today's included).
  const surfs = new Set(inWin.map((x) => surfaceCategory(x.m.surface)).filter(Boolean));
  const todayCat = surfaceCategory(ctx.surface);
  if (todayCat) surfs.add(todayCat);
  if (surfs.size >= 2) { mult *= c.surfaceChangeMult; factors.push(`surf-switch x${c.surfaceChangeMult}`); }

  // Travel: previous window tournament -> today's, UTC-offset gap >= threshold.
  // Self-hides (no factor) when either venue is unmapped.
  const todayTz = tournamentTz(ctx.match.tour || ctx.match.tournament);
  const prevTz = inWin.length ? tournamentTz(inWin[0].m.tournament) : null;
  const travelKnown = todayTz != null && prevTz != null;
  if (travelKnown && Math.abs(todayTz - prevTz) >= c.travelTzGapH) {
    mult *= c.travelMult; factors.push(`travel x${c.travelMult}`);
  }

  // Age recovery (older = slower). PLACEHOLDER curve — flagged for founder tuning.
  const age = num(p.profile && p.profile.age);
  let ageMult = 1.0;
  if (age != null) { for (const [minAge, mm] of c.ageRecovery) { if (age >= minAge) { ageMult = mm; break; } } }
  if (ageMult !== 1.0) { mult *= ageMult; factors.push(`age ${age} x${ageMult}`); }

  return { sets, count, mult: round4(mult), units: round4(sets * mult), factors, travelKnown };
}

function fatigue(ctx) {
  const c = config.adjustments.fatigue;
  const res = base(c.id, 'fatigue', 'Fatigue (recent load)', c.maxMagnitude, 'player-profiles.json:recentForm');
  const l1 = fatigueUnits(ctx.p1, ctx, c);
  const l2 = fatigueUnits(ctx.p2, ctx, c);
  res.fatigue = { p1: l1, p2: l2 };  // exposed for the validation harness
  if (l1.count === 0 && l2.count === 0) { res.detail = `No matches in last ${c.windowDays}d.`; return res; }

  // Physical toll of TODAY's court scales the whole player gap.
  const todayCat = surfaceCategory(ctx.surface);
  const surfMult = (todayCat && c.surfaceMult[todayCat]) || 1.0;
  const gap = l1.units - l2.units;          // more units => more fatigued
  const adjGap = gap * surfMult;
  const absGap = Math.abs(adjGap);

  // Net (surface-scaled) unit gap -> probability-point band. pp <= maxMagnitude
  // always, so the layer can never breach its cap.
  let pp = 0;
  for (const [minU, ppv] of c.unitBands) { if (absGap >= minU) { pp = ppv; break; } }
  const fmt = (l) => `${l.sets}s/${l.count}m=${l.units.toFixed(1)}u${l.factors.length ? ` [${l.factors.join(', ')}]` : ''}`;
  if (pp === 0) {
    res.detail = `${c.windowDays}d load even on ${todayCat || ctx.surface}: ${fmt(l1)} vs ${fmt(l2)} (gap ${adjGap.toFixed(1)}u < 2).`;
    return res;
  }
  // Favour the FRESHER (lower-units) player: gap>0 (p1 more tired) => -signal.
  const signal = (gap > 0 ? -1 : 1) * (pp / c.maxMagnitude);
  const fresher = gap > 0 ? (ctx.p2.fullName || ctx.p2.abbrName || 'p2') : (ctx.p1.fullName || ctx.p1.abbrName || 'p1');
  return apply(res, signal, 'low',
    `${c.windowDays}d load on ${todayCat || ctx.surface} (x${surfMult}): ${fmt(l1)} vs ${fmt(l2)}; ` +
    `net gap ${adjGap.toFixed(1)}u -> ${(pp * 100).toFixed(1)}pp to ${fresher}.`);
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
// Bo5 ONLY (founder spec TEN-8 2026-07-25). A Bo3 match outputs zero — the
// layer speaks only to Grand-Slam best-of-5. Per player it scores Bo5 OVER/UNDER-
// performance = career Bo5 win% minus a career Bo3 (normal-format) baseline,
// sample-damped by the player's Bo5 match count. The layer signal is the
// DIFFERENCE of the two players' damped over-performance, so a tour-wide Bo5
// effect (Bo5 is Slams-only => tougher fields => a systematic win% drop) cancels
// in the head-to-head, and "both good / both bad nearly cancels" falls out for
// free. maxMagnitude 2.5pp.
// HONEST LIMITS (flagged for founder review): (1) "Expected Bo5 rate from Elo"
// is NOT computable — career-splits stores aggregate win% only, no per-match
// opponent Elo — so the Bo3 career win% stands in as the baseline; (2) a
// "vs top-50" comparison is not built (career-splits carries a "vs. Top 10"
// bucket, not top-50).
function formatSplit(ctx) {
  const c = config.adjustments.formatSplit;
  const res = base(c.id, 'formatSplit', 'Format split (Bo5)', c.maxMagnitude, 'career-splits.json');
  if (ctx.bestOf !== 5) { res.detail = 'Bo3 match — format split applies to Bo5 (Grand Slams) only.'; return res; }
  function perf(p) {
    const career = p.splits && p.splits.career;
    const c5 = career && career['Best of 5'];
    const c3 = career && career['Best of 3'];
    if (!c5 || (c5.M || 0) < c.minM || num(c5.winPct) == null) return null; // hidden below Bo5 floor
    if (!c3 || num(c3.winPct) == null) return null;                          // need a Bo3 baseline
    let damp = 0;
    for (const [minM, d] of c.dampTiers) { if ((c5.M || 0) >= minM) { damp = d; break; } }
    const over = c5.winPct - c3.winPct;
    return { raw: c5.winPct, base: c3.winPct, over, M: c5.M, damp, val: over * damp };
  }
  const a = perf(ctx.p1), b = perf(ctx.p2);
  res.formatSplit = { p1: a, p2: b };  // exposed for the validation harness
  if (!a || !b) { res.detail = `Insufficient Bo5 sample (need ${c.minM}+ Bo5 matches both sides).`; return res; }
  const signal = clamp((a.val - b.val) / c.signalScale, -1, 1);
  const desc = (l) => `${Math.round(l.raw * 10) / 10}%-${Math.round(l.base * 10) / 10}%=${fmtPct(l.over)} (M${l.M}, x${l.damp})`;
  return apply(res, signal, 'low', `Bo5 vs Bo3 baseline: ${desc(a)} vs ${desc(b)}.`);
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
module.exports = { runAll, clamp, h2h, setDominance, winnerUE, recentFormParts, qualityForm, fatigue, fatigueUnits, serve, inTournamentServeDelta, serveSharedRow };
