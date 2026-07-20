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
  const res = base(c.id, 'subjective', 'Subjective input', c.maxMagnitude, 'manual');
  const s = num(ctx.subjectiveSignal);
  if (s == null || s === 0) {
    res.detail = 'No manual input (default neutral).';
    return res;
  }
  return apply(res, s, 'med', `Manual override applied (${s > 0 ? '+' : ''}${s}).`);
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
function surface(ctx) {
  const c = config.adjustments.surface;
  const res = base(c.id, 'surface', 'Surface record', c.maxMagnitude, 'player-profiles.json:kpis');
  const cat = surfaceCategory(ctx.surface);
  if (!cat) return res;
  function surfEdge(p) {
    const k = p.profile && p.profile.kpis;
    if (!k || !k.All || !k[cat]) return null;
    const all = num(k.All.winRate), surf = num(k[cat].winRate);
    if (all == null || surf == null) return null;
    return surf - all; // how much better than own average on this surface
  }
  const e1 = surfEdge(ctx.p1), e2 = surfEdge(ctx.p2);
  if (e1 == null || e2 == null) return res;
  const signal = clamp((e1 - e2) / 30, -1, 1); // 30-pt relative gap = full
  return apply(res, signal, 'med',
    `${cat} vs own baseline: ${fmtPct(e1)} vs ${fmtPct(e2)}.`);
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
  // win% at this round vs the player's own overall baseline (kpis.All)
  function stageEdge(p) {
    const row = careerCat(p.splits, bucket);
    if (!row || num(row.M) == null || num(row.winPct) == null) return null;
    const baseWR = p.profile && p.profile.kpis && p.profile.kpis.All
      && num(p.profile.kpis.All.winRate);
    if (baseWR == null) return null;
    return { edge: row.winPct - baseWR, M: row.M, wr: row.winPct };
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
// 9. SERVE STRENGTH — serve radar percentile (career serve% fallback)
// =========================================================================
function serve(ctx) {
  const c = config.adjustments.serve;
  const res = base(c.id, 'serve', 'Serve strength', c.maxMagnitude, 'style-radar.json / career-splits.json');
  function serveRating(p) {
    if (p.radar && num(p.radar.serve) != null) return { v: p.radar.serve, src: 'radar' };
    const cat = careerCat(p.splits, surfaceCategory(ctx.surface)) || careerCat(p.splits, 'Best of 3');
    if (cat && num(cat.spwPct) != null) return { v: cat.spwPct, src: 'career-spw' };
    return null;
  }
  const s1 = serveRating(ctx.p1), s2 = serveRating(ctx.p2);
  if (!s1 || !s2) return res;
  // radar is a 0-100 percentile; career spw is ~50-70 raw. Only compare like
  // with like — if the sources differ, dampen confidence.
  const sameSrc = s1.src === s2.src;
  const scale = s1.src === 'radar' ? 60 : 15;
  const signal = clamp((s1.v - s2.v) / scale, -1, 1);
  return apply(res, sameSrc ? signal : signal * 0.5, sameSrc ? 'med' : 'low',
    `Serve ${Math.round(s1.v)} vs ${Math.round(s2.v)} (${s1.src}).`);
}

// =========================================================================
// 10. RETURN / PRESSURE — return radar percentile (career return% fallback)
// =========================================================================
function returnPressure(ctx) {
  const c = config.adjustments.returnPressure;
  const res = base(c.id, 'returnPressure', 'Return / pressure', c.maxMagnitude, 'style-radar.json / career-splits.json');
  function ret(p) {
    if (p.radar && num(p.radar.return) != null) return { v: p.radar.return, src: 'radar' };
    const cat = careerCat(p.splits, surfaceCategory(ctx.surface)) || careerCat(p.splits, 'Best of 3');
    if (cat && num(cat.rpwPct) != null) return { v: cat.rpwPct, src: 'career-rpw' };
    return null;
  }
  const r1 = ret(ctx.p1), r2 = ret(ctx.p2);
  if (!r1 || !r2) return res;
  const sameSrc = r1.src === r2.src;
  const scale = r1.src === 'radar' ? 60 : 12;
  const signal = clamp((r1.v - r2.v) / scale, -1, 1);
  return apply(res, sameSrc ? signal : signal * 0.5, sameSrc ? 'med' : 'low',
    `Return ${Math.round(r1.v)} vs ${Math.round(r2.v)} (${r1.src}).`);
}

// =========================================================================
// 11. FATIGUE — match/set load in the last N days (favours the fresher man)
// =========================================================================
function fatigue(ctx) {
  const c = config.adjustments.fatigue;
  const res = base(c.id, 'fatigue', 'Fatigue (14-day load)', c.maxMagnitude, 'player-profiles.json:recentForm');
  const matchDate = new Date(ctx.match.date || ctx.match.day || Date.now());
  const windowMs = config.fatigueWindowDays * 24 * 3600 * 1000;
  function load(p) {
    const ms = recentMatchesSorted(p.profile);
    let sets = 0, count = 0;
    for (const m of ms) {
      const d = new Date(m.date);
      const diff = matchDate - d;
      if (diff >= 0 && diff <= windowMs) { sets += parseSets(m.result); count++; }
    }
    return { sets, count };
  }
  const l1 = load(ctx.p1), l2 = load(ctx.p2);
  if (l1.count === 0 && l2.count === 0) { res.detail = 'No matches in window.'; return res; }
  // heavier load => negative for that player => favour the fresher one
  const signal = clamp((l2.sets - l1.sets) / 8, -1, 1);
  return apply(res, signal, 'low',
    `Last ${config.fatigueWindowDays}d load: ${l1.sets} sets (${l1.count}m) vs ${l2.sets} sets (${l2.count}m).`);
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
// 14. COURT SPEED — fast rewards serve, slow rewards return/movement
// =========================================================================
function courtSpeed(ctx) {
  const c = config.adjustments.courtSpeed;
  const res = base(c.id, 'courtSpeed', 'Court speed', c.maxMagnitude, 'matches.json:courtSpeed / style-radar.json');
  const cs = ctx.match.courtSpeed;
  const r1 = ctx.p1.radar, r2 = ctx.p2.radar;
  if (!cs) return res;
  if (!r1 || !r2) { res.detail = 'Reliable style radar unavailable for a player.'; return res; }
  const as = num(cs.abstractSpeed);
  let signal = 0, label = cs.category || '';
  if (as != null) {
    if (as >= 0.9) { // fast
      const serveGap = ((num(r1.serve) || 50) - (num(r2.serve) || 50)) / 100;
      signal = serveGap * clamp((as - 0.9) / 0.15 + 0.5, 0, 1);
      label = `fast (${as})`;
    } else if (as <= 0.82) { // slow
      const g = ((num(r1.return) || 50) + (num(r1.movement) || 50)
               - (num(r2.return) || 50) - (num(r2.movement) || 50)) / 200;
      signal = g * clamp((0.82 - as) / 0.15 + 0.5, 0, 1);
      label = `slow (${as})`;
    }
  }
  if (signal === 0) { res.detail = `Neutral speed (${label}).`; return res; }
  return apply(res, signal, 'low', `Court ${label}.`);
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
// 16. H2H TREND — recency-weighted direction of the head-to-head
// =========================================================================
function h2hTrend(ctx) {
  const c = config.adjustments.h2hTrend;
  const res = base(c.id, 'h2hTrend', 'H2H trend', c.maxMagnitude, 'matches.json:h2h');
  const ms = (ctx.match.h2h && ctx.match.h2h.matches) || [];
  if (ms.length === 0) return res;
  const sorted = ms.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  let wsum = 0, tot = 0;
  sorted.forEach((m, i) => {
    const w = Math.pow(0.6, i); // most recent meeting weighted 1, then 0.6, 0.36...
    wsum += (m.p1Won ? 1 : -1) * w;
    tot += w;
  });
  if (tot === 0) return res;
  const signal = clamp(wsum / tot, -1, 1);
  const last = sorted[0];
  return apply(res, signal, sorted.length >= 3 ? 'med' : 'low',
    `Most recent: ${last.p1Won ? 'p1' : 'p2'} won (${last.date}).`);
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
  courtSpeed, clutch, h2hTrend, oddsMovement,
];

function runAll(ctx) {
  return ALL.map(fn => fn(ctx));
}

module.exports = { runAll, clamp };
