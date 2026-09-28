#!/usr/bin/env node
'use strict';
// TEN-327 — the Edge model Serve / Return re-fit report (founder 2026-09-28: the re-fit stays STAGED;
// "build the report he decides on, covering the last 30 days of completed matches: model fair odds
// before and after, how many picks change (n of N), accuracy before and after with n").
//
// It replays the model (h2h-model/model.js runModel) over every completed ATP match of the window,
// recovered from the git history of matches.json (the working copy only holds ~3 days of results),
// once per formula:
//   before = config as shipped (serve + returnPressure ratingFormula 'legacy', return divisor 15)
//   after  = ratingFormula 'house' on both layers, return divisor = the re-fit (below)
// and nothing else changes between the two runs: same match records, same player snapshots, same
// process. Both runs read TODAY's player snapshots (runModel has no point-in-time mode), so absolute
// accuracy carries lookahead; the before/after DIFFERENCE is like-for-like.
//
// RE-FIT METHOD (the divisor): layer #10's signal is clamp((r1 − r2) / D, ±1). The house return sits
// on a wider scale, so D is re-fitted to keep the layer's signal distribution unchanged: D_house =
// 15 × SD(house gaps) / SD(legacy gaps), over every priceable pairing in the window. A sweep of D
// (Brier / log-loss / hit rate at each value) is reported alongside as the sensitivity check.
//
// Usage: node tools/ten327-refit-report.js [--days 30] [--end 2026-09-28] [--json out.json]
//   Run from a checkout whose career-splits.json carries acesPM/dfPM (the builder emits them from
//   TEN-327 on; the committed file gains them on its next daily refresh). It refuses otherwise.
// Report tool only: writes nothing unless --json is given; nothing regenerates it.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', 30));
const END = arg('--end', new Date().toISOString().slice(0, 10));
const START = new Date(Date.parse(END + 'T00:00:00Z') - DAYS * 864e5).toISOString().slice(0, 10);
const REF = arg('--ref', 'origin/main');

// ── 1. completed matches of the window, from matches.json's git history ──
function completedMatches() {
  const log = execFileSync('git', ['-C', ROOT, 'log', REF, `--since=${START}T00:00:00Z`, '--format=%H %cI', '--', 'matches.json'],
    { encoding: 'utf8', maxBuffer: 64e6 }).trim().split('\n').filter(Boolean);
  // the last commit of each day carries that day's finished matches (they roll off after ~3 days)
  const perDay = new Map();
  for (const l of log) { const [sha, iso] = l.split(' '); const d = iso.slice(0, 10); if (!perDay.has(d)) perDay.set(d, sha); }
  const byId = new Map();
  for (const sha of perDay.values()) {
    let arr;
    try { arr = JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${sha}:matches.json`], { encoding: 'utf8', maxBuffer: 256e6 })); }
    catch (_) { continue; }
    for (const m of arr) {
      if (!/^past-/.test(String(m.id)) || !m.finalScore || !/^p[12]$/.test(m.finalScore.winner || '')) continue;
      if (!(m.date >= START && m.date <= END)) continue;
      if (m.tourBadge && m.tourBadge !== 'ATP') continue;
      byId.set(m.id, m);   // later commits overwrite: the most settled copy of each record wins
    }
  }
  return [...byId.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
}

// ── 2. the model ──
// The house serve reads acesPM / dfPM (tools/build-career-splits.js emits them from TEN-327 on).
// Without them every house serve rating is null and layer #9 would abstain for the wrong reason,
// so refuse rather than report a difference that is only a missing field.
{
  const cs = JSON.parse(fs.readFileSync(path.join(ROOT, 'career-splits.json'), 'utf8')).players || {};
  const rows = Object.values(cs).flatMap((p) => ['career', 'last52'].flatMap((s) => Object.values((p && p[s]) || {})));
  const withPM = rows.filter((r) => r && r.acesPM != null).length;
  if (!withPM) { console.error('career-splits.json carries no acesPM/dfPM — rebuild it with the TEN-327 builder first'); process.exit(2); }
}
const config = require('../h2h-model/config');
const { runModel } = require('../h2h-model/model');
const adj = require('../h2h-model/adjustments');

function setFormula(f, div) {
  config.adjustments.serve.ratingFormula = f;
  config.adjustments.returnPressure.ratingFormula = f;
  config.adjustments.returnPressure.signalDivisor = Object.assign({}, config.adjustments.returnPressure.signalDivisor,
    div != null ? { [f]: div } : {});
}
function run(m) {
  let r;
  try { r = runModel(m); } catch (e) { return { ok: false, why: e.message }; }
  if (!r || !r.ok) return { ok: false, why: (r && r.reason) || 'model declined' };
  const layer = (id) => (r.stage2.adjustments.find((a) => a.id === id) || {});
  return { ok: true, p1: r.stage3.fair.p1.prob, flags: (r.stage3.flags || []).map((f) => `${f.type || f.label}:${f.side}`).sort(),
    l9: layer(9), l10: layer(10) };
}
const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
function score(rows, key) {
  let n = 0, hit = 0, brier = 0, ll = 0;
  for (const r of rows) {
    const p = r[key]; if (p == null) continue;
    const y = r.winner === 'p1' ? 1 : 0, q = Math.min(1 - 1e-6, Math.max(1e-6, p));
    n++; if ((p >= 0.5) === (y === 1)) hit++;
    brier += (p - y) ** 2; ll += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  }
  return { n, hit, hitRate: n ? hit / n : null, brier: n ? brier / n : null, logLoss: n ? ll / n : null };
}

// ── 3. the re-fit: the house divisor that keeps layer #10's signal distribution ──
function ratingGaps(matches, formula) {
  setFormula(formula);
  const gaps = [];
  for (const m of matches) {
    const r = run(m);
    if (!r.ok || !r.l10.detail) continue;
    const mm = /Return rating (-?[\d.]+) vs (-?[\d.]+)/.exec(r.l10.detail);
    if (mm) gaps.push({ id: m.id, gap: Number(mm[1]) - Number(mm[2]) });
  }
  return gaps;
}

function main() {
  const matches = completedMatches().filter((m) => !m.walkover);   // a walkover is not a match played (modal-analysis.md)
  const legacyDiv = (config.adjustments.returnPressure.signalDivisor || {}).legacy || 15;
  const gL = ratingGaps(matches, 'legacy'), gH = ratingGaps(matches, 'house');
  const both = gL.filter((a) => gH.some((b) => b.id === a.id)).map((a) => [a.gap, gH.find((b) => b.id === a.id).gap]);
  const refit = Math.round(legacyDiv * sd(both.map((x) => x[1])) / sd(both.map((x) => x[0])) * 10) / 10;
  const clampShare = (xs, D) => xs.filter((g) => Math.abs(g / D) >= 1).length / xs.length;

  const rows = matches.map((m) => ({ id: m.id, date: m.date, p1: m.p1, p2: m.p2, tour: m.tour, surface: m.surface, winner: m.finalScore.winner, retired: !!m.retired }));
  const sweep = [];
  for (const D of [legacyDiv, 20, 25, 30, refit, 40, 50].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)) {
    setFormula('house', D);
    const key = `h${D}`;
    rows.forEach((r, i) => { const x = run(matches[i]); r[key] = x.ok ? x.p1 : null; if (D === refit) { r.after = x; } });
    sweep.push(Object.assign({ D }, score(rows, key)));
  }
  setFormula('legacy');
  rows.forEach((r, i) => { r.before = run(matches[i]); r.pB = r.before.ok ? r.before.p1 : null; r.pA = r.after && r.after.ok ? r.after.p1 : null; });

  const priced = rows.filter((r) => r.pB != null && r.pA != null);
  const pickB = (r) => (r.pB >= 0.5 ? 'p1' : 'p2'), pickA = (r) => (r.pA >= 0.5 ? 'p1' : 'p2');
  const pickChanged = priced.filter((r) => pickB(r) !== pickA(r));
  const flagChanged = priced.filter((r) => r.before.flags.join() !== r.after.flags.join());
  const withFlagB = priced.filter((r) => r.before.flags.length).length, withFlagA = priced.filter((r) => r.after.flags.length).length;
  const odds = (p) => (p > 0 ? Math.round(100 / p) / 100 : null);
  const moves = priced.map((r) => ({ id: r.id, date: r.date, match: `${r.p1} v ${r.p2}`, surface: r.surface,
    fairP1Before: r.pB, fairP1After: r.pA, oddsP1Before: odds(r.pB), oddsP1After: odds(r.pA), dPP: Math.round((r.pA - r.pB) * 1e4) / 100,
    l10Before: r.before.l10.deltaP1, l10After: r.after.l10.deltaP1, l9Before: r.before.l9.deltaP1, l9After: r.after.l9.deltaP1,
    pickBefore: pickB(r), pickAfter: pickA(r), winner: r.winner, flagsBefore: r.before.flags, flagsAfter: r.after.flags }));
  const absd = moves.map((m) => Math.abs(m.dPP)).sort((a, b) => a - b);
  const q = (p) => absd[Math.min(absd.length - 1, Math.floor(p * absd.length))];
  const layerMean = (k) => { const v = moves.map((m) => m[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + Math.abs(b), 0) / v.length : null; };
  const report = {
    window: { start: START, end: END, completed: matches.length, priced: priced.length, declined: rows.length - priced.length },
    refit: { method: 'D_house = 15 × SD(house gap) / SD(legacy gap), same pairings', pairs: both.length, legacyDiv,
      sdLegacy: sd(both.map((x) => x[0])), sdHouse: sd(both.map((x) => x[1])), divisor: refit,
      clampShareLegacyAt15: clampShare(both.map((x) => x[0]), legacyDiv), clampShareHouseAt15: clampShare(both.map((x) => x[1]), legacyDiv),
      clampShareHouseAtRefit: clampShare(both.map((x) => x[1]), refit) },
    accuracy: { before: score(priced, 'pB'), after: score(priced, 'pA') },
    picks: { n: pickChanged.length, of: priced.length, changed: pickChanged.map((r) => r.id) },
    valueFlags: { matchesChanged: flagChanged.length, of: priced.length, withFlagBefore: withFlagB, withFlagAfter: withFlagA },
    fairMove: { meanAbsPP: absd.reduce((a, b) => a + b, 0) / absd.length, p50: q(0.5), p90: q(0.9), max: absd[absd.length - 1] },
    layerMeanAbsDeltaPP: { l9Before: layerMean('l9Before') * 100, l9After: layerMean('l9After') * 100, l10Before: layerMean('l10Before') * 100, l10After: layerMean('l10After') * 100 },
    sweep, moves,
  };
  const out = arg('--json', null);
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
  const f = (x, d = 4) => (x == null ? '—' : Number(x).toFixed(d));
  console.log(`window ${START}..${END}: ${matches.length} completed (walkovers excluded), ${priced.length} priced by both runs`);
  console.log(`re-fit: ${report.refit.method} over ${both.length} pairs → D = ${refit} (SD legacy ${f(report.refit.sdLegacy, 1)}, house ${f(report.refit.sdHouse, 1)})`);
  console.log(`clamped at ±1: legacy@15 ${f(report.refit.clampShareLegacyAt15 * 100, 1)}%, house@15 ${f(report.refit.clampShareHouseAt15 * 100, 1)}%, house@${refit} ${f(report.refit.clampShareHouseAtRefit * 100, 1)}%`);
  for (const k of ['before', 'after']) { const s = report.accuracy[k]; console.log(`${k.padEnd(6)} n=${s.n} hit ${s.hit}/${s.n} = ${f(s.hitRate * 100, 1)}%  Brier ${f(s.brier)}  log-loss ${f(s.logLoss)}`); }
  console.log(`picks changed: ${pickChanged.length} of ${priced.length}; value-flag sets changed: ${flagChanged.length} of ${priced.length} (flagged before ${withFlagB}, after ${withFlagA})`);
  console.log(`fair-prob move |Δ| pp: mean ${f(report.fairMove.meanAbsPP, 2)}, median ${f(q(0.5), 2)}, p90 ${f(q(0.9), 2)}, max ${f(report.fairMove.max, 2)}`);
  console.log(`mean |layer Δ| pp: #9 ${f(report.layerMeanAbsDeltaPP.l9Before, 2)} → ${f(report.layerMeanAbsDeltaPP.l9After, 2)}, #10 ${f(report.layerMeanAbsDeltaPP.l10Before, 2)} → ${f(report.layerMeanAbsDeltaPP.l10After, 2)}`);
  console.log('sweep (house formula, divisor D):');
  for (const s of sweep) console.log(`  D=${String(s.D).padEnd(5)} n=${s.n} hit ${f(s.hitRate * 100, 1)}%  Brier ${f(s.brier)}  log-loss ${f(s.logLoss)}`);
}
main();
