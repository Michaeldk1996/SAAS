'use strict';

/**
 * adjustments.js — Stage 2: the 17 adjustment layers.
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
const { pinnacleSeries } = require('./price');

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

// Altitude (metres) of a tournament name via the curated config map (substring,
// case-insensitive). Returns null when the venue is not in the reference list.
function tournamentAltitude(name) {
  const s = String(name || '').toLowerCase();
  if (!s) return null;
  const map = config.altitudeMeters || {};
  for (const key of Object.keys(map)) {
    if (s.includes(key)) return map[key];
  }
  return null;
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
// 3. H2H RECORD — career head-to-head balance
// =========================================================================
function h2h(ctx) {
  const c = config.adjustments.h2h;
  const res = base(c.id, 'h2h', 'H2H record', c.maxMagnitude, 'matches.json:h2h');
  const h = ctx.match.h2h;
  if (!h) return res;
  const w1 = h.p1Wins || 0, w2 = h.p2Wins || 0, total = w1 + w2;
  if (total === 0) { res.detail = 'No prior meetings.'; return res; }
  // balance in [-1,1], damped by sample (few meetings => weaker signal)
  const balance = (w1 - w2) / total;
  const damp = Math.min(1, total / 4); // full weight at 4+ meetings
  const conf = total >= 4 ? 'med' : 'low';
  return apply(res, balance * damp, conf, `H2H ${w1}-${w2} (${total} meetings).`);
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
// 6. ROUND / STAGE PERFORMANCE — over/underperformance at THIS match's round
//    vs the player's own overall win%. career-splits now carries R128..F round
//    categories, so we compare each player's win% at the current round against
//    their own baseline (relative-to-self avoids re-counting the ELO Stage 1
//    already saw). Sample-damped; abstains on unknown round or thin samples.
// =========================================================================
// Map a matches.json round label ("... - 1/16-finals") to a career-splits
// round category. European nomenclature: 1/8=R16, 1/16=R32, 1/32=R64, 1/64=R128.
function roundBucket(roundLabel) {
  const s = String(roundLabel || '').toLowerCase();
  if (s.includes('1/64')) return 'Round of 128';
  if (s.includes('1/32')) return 'Round of 64';
  if (s.includes('1/16')) return 'Round of 32';
  if (s.includes('1/8')) return 'Round of 16';
  if (s.includes('quarter')) return 'Quarter-finals';
  if (s.includes('semi')) return 'Semi-finals';
  if (s.includes('final')) return 'Finals'; // plain "final" (semi/quarter caught above)
  return null; // round-robin / unknown
}
function roundStage(ctx) {
  const c = config.adjustments.roundStage;
  const res = base(c.id, 'roundStage', 'Round / stage performance', c.maxMagnitude, 'career-splits.json:rounds');
  const bucket = roundBucket(ctx.match.tournamentRound);
  if (!bucket) { res.detail = 'Round not identifiable from schedule.'; return res; }
  // Round win% = half career + half last-52-weeks at this round (renormalised
  // when one scope is missing), compared to the player's TRUE career baseline
  // (not the old ~30-match kpis.All window, which mis-scaled the edge).
  function stageEdge(p) {
    const cRow = p.splits && p.splits.career && p.splits.career[bucket];
    const lRow = p.splits && p.splits.last52 && p.splits.last52[bucket];
    const parts = [];
    if (cRow && num(cRow.winPct) != null) parts.push({ w: 0.5, v: cRow.winPct });
    if (lRow && num(lRow.winPct) != null) parts.push({ w: 0.5, v: lRow.winPct });
    if (!parts.length) return null;
    const wsum = parts.reduce((s, x) => s + x.w, 0);
    const roundWR = parts.reduce((s, x) => s + x.w * x.v, 0) / wsum;
    // Sample gate/damp uses the career row (the robust one), else last52.
    const M = (cRow && num(cRow.M) != null) ? cRow.M
            : (lRow && num(lRow.M) != null) ? lRow.M : null;
    if (M == null) return null;
    const baseWR = careerOverallWR(p.profile);
    if (baseWR == null) return null;
    return { edge: roundWR - baseWR, M, wr: roundWR };
  }
  const e1 = stageEdge(ctx.p1), e2 = stageEdge(ctx.p2);
  if (!e1 || !e2) { res.detail = `No ${bucket} sample for a player.`; return res; }
  if (e1.M < c.minRoundM || e2.M < c.minRoundM) {
    res.detail = `${bucket} sample too thin (${e1.M} / ${e2.M}).`;
    return res;
  }
  // Damp by the smaller sample so a 6-match row doesn't swing as hard as a 40.
  const damp = clamp(Math.min(e1.M, e2.M) / c.fullDampM, 0, 1);
  const signal = clamp((e1.edge - e2.edge) / 30, -1, 1) * damp; // 30-pt gap = full
  const conf = (Math.min(e1.M, e2.M) >= c.fullDampM) ? 'med' : 'low';
  return apply(res, signal, conf,
    `${bucket} vs own baseline: ${fmtPct(e1.edge)} (${e1.M}m) vs ${fmtPct(e2.edge)} (${e2.M}m).`);
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
      const r = rankOf(m.opponentKey, m.opponent);
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
        const r = rankOf(m.opponentKey, m.opponent);
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
function weather(ctx) {
  const c = config.adjustments.weather;
  const res = base(c.id, 'weather', 'Weather / conditions', c.maxMagnitude, 'matches.json:weather / style-radar.json');
  const w = ctx.match.weather;
  if (!w) return res;
  const temp = num(w.temperature), wind = num(w.windSpeed);
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
// 14. COURT SPEED — two independent dimensions, both radar-free (they use the
//    serve/return ratings and recent-form history, which are always available):
//      A. ALTITUDE — when the venue sits above the altitude threshold (>350m),
//         the player who historically performs BETTER at high-altitude events
//         (win% at >350m tournaments vs their overall recent win%) is favoured.
//      B. FAST / SLOW — from abstractSpeed: a fast court rewards the stronger
//         server (serve rating gap), a slow court rewards the stronger returner
//         (return rating gap).
//    Signals from both dimensions add; the layer abstains when neither fires.
// =========================================================================
function courtSpeed(ctx) {
  const c = config.adjustments.courtSpeed;
  const res = base(c.id, 'courtSpeed', 'Court speed / altitude', c.maxMagnitude,
    'matches.json:courtSpeed + config.altitudeMeters / career-splits.json');
  const cs = ctx.match.courtSpeed;
  const surfCat = surfaceCategory(ctx.surface);
  const bucket = ctx.bestOf === 5 ? 'Best of 5' : 'Best of 3';
  let signal = 0;
  const parts = [];

  // --- A. Altitude affinity ---------------------------------------------
  const threshold = num(config.altitudeThresholdM) != null ? config.altitudeThresholdM : 350;
  let alt = cs && num(cs.altitude) != null ? cs.altitude : null;
  if (alt == null) alt = tournamentAltitude(ctx.match && ctx.match.tour); // map fallback
  if (alt != null && alt > threshold) {
    function altEdge(p) {
      const ms = recentMatchesSorted(p.profile);
      if (!ms.length) return null;
      const hi = ms.filter(m => {
        const a = tournamentAltitude(m.tournament);
        return a != null && a > threshold;
      });
      if (hi.length < 4) return null; // need a real altitude sample
      const hiWR = hi.filter(m => m.won).length / hi.length;
      const allWR = ms.filter(m => m.won).length / ms.length;
      return hiWR - allWR; // altitude over/under-performance vs own norm
    }
    const a1 = altEdge(ctx.p1), a2 = altEdge(ctx.p2);
    if (a1 != null && a2 != null) {
      signal += clamp((a1 - a2) / 0.5, -1, 1) * 0.6; // altitude dimension weight
      parts.push(`altitude ${Math.round(alt)}m`);
    } else {
      parts.push(`altitude ${Math.round(alt)}m (thin history)`);
    }
  }

  // --- B. Fast / slow surface -------------------------------------------
  const as = cs && num(cs.abstractSpeed);
  if (as != null) {
    if (as >= 0.9) { // fast court => reward the server
      const s1 = blendedRating(ctx.p1.splits, surfCat, bucket, serveRatingRow);
      const s2 = blendedRating(ctx.p2.splits, surfCat, bucket, serveRatingRow);
      if (s1 != null && s2 != null) {
        signal += clamp((s1 - s2) / 25, -1, 1) * clamp((as - 0.9) / 0.15 + 0.4, 0, 1) * 0.5;
        parts.push(`fast (${as})`);
      }
    } else if (as <= 0.82) { // slow court => reward the returner
      const r1 = blendedRating(ctx.p1.splits, surfCat, bucket, returnRatingRow);
      const r2 = blendedRating(ctx.p2.splits, surfCat, bucket, returnRatingRow);
      if (r1 != null && r2 != null) {
        signal += clamp((r1 - r2) / 15, -1, 1) * clamp((0.82 - as) / 0.15 + 0.4, 0, 1) * 0.5;
        parts.push(`slow (${as})`);
      }
    }
  }

  if (signal === 0) {
    res.detail = parts.length ? `Neutral (${parts.join(', ')}).` : 'Neutral court/altitude.';
    return res;
  }
  return apply(res, clamp(signal, -1, 1), 'low', `Court: ${parts.join(', ')}.`);
}

// =========================================================================
// 15. CLUTCH RATING — clutch-rating.json clutch index
// =========================================================================
function clutch(ctx) {
  const c = config.adjustments.clutch;
  const res = base(c.id, 'clutch', 'Clutch rating', c.maxMagnitude, 'clutch-rating.json');
  const c1 = ctx.p1.clutch, c2 = ctx.p2.clutch;
  if (!c1 || !c2 || num(c1.clutchIndex) == null || num(c2.clutchIndex) == null) return res;
  const signal = clamp((c1.clutchIndex - c2.clutchIndex) / 40, -1, 1);
  const conf = (c1.confidence === 'high' && c2.confidence === 'high') ? 'med' : 'low';
  return apply(res, signal, conf,
    `Clutch ${Math.round(c1.clutchIndex)} vs ${Math.round(c2.clutchIndex)}.`);
}

// =========================================================================
// 17. ODDS MARKET MOVEMENT — Pinnacle opening vs current (lowest weight)
// =========================================================================
function impliedFromDecimal(price) {
  const p = num(price);
  return p && p > 1 ? 1 / p : null;
}
function vigFreeP1(price1, price2) {
  const i1 = impliedFromDecimal(price1), i2 = impliedFromDecimal(price2);
  if (i1 == null || i2 == null) return null;
  return i1 / (i1 + i2);
}
function oddsMovement(ctx) {
  const c = config.adjustments.oddsMovement;
  const res = base(c.id, 'oddsMovement', 'Odds market movement', c.maxMagnitude, 'matches.json:oddsMovement');
  // Use the settlement-filtered Pinnacle two-way line (opening vs current),
  // compared on a vig-free basis so overround changes don't create noise.
  const s = pinnacleSeries(ctx.match);
  if (!s) return res;
  const openP1 = vigFreeP1(s.opening.p1, s.opening.p2);
  const curP1 = vigFreeP1(s.current.p1, s.current.p2);
  if (openP1 == null || curP1 == null) return res;
  const shift = curP1 - openP1; // positive => market moved toward p1
  const signal = clamp(shift / 0.10, -1, 1); // a 10-pt implied move = full
  if (signal === 0) { res.detail = 'No line movement.'; return res; }
  return apply(res, signal, 'low',
    `Pinnacle: p1 vig-free ${fmtPct(openP1 * 100)}\u2192${fmtPct(curP1 * 100)}.`);
}

// ---- formatting helper ----------------------------------------------------
function fmtPct(x) {
  if (x == null) return 'n/a';
  const s = x >= 0 ? '+' : '';
  return `${s}${Math.round(x * 10) / 10}%`;
}

// ---- registry (order = display order, roughly the weight hierarchy) -------
const ALL = [
  styleMatchup, subjective, h2h, surface, recentForm,
  roundStage, qualityForm, winnerUE,
  serve, returnPressure, fatigue, weather, formatSplit,
  courtSpeed, clutch, oddsMovement,
];

function runAll(ctx) {
  return ALL.map(fn => fn(ctx));
}

module.exports = { runAll, clamp };
