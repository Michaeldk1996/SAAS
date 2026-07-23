'use strict';

/**
 * calibrate.js — INTERNAL R&D. Joint weight-fit for the reconstructable
 * Stage-2 adjustment layers, on the large Sackmann historical set.
 *
 * WHAT IT DOES
 * ------------
 * 1. Walks the Sackmann match set forward in time (strict point-in-time: every
 *    feature for a match is computed from ONLY the matches that happened before
 *    it — no lookahead).
 * 2. For each match it reconstructs:
 *      - the Stage-1 ELO base probability (production blend, as in backtest.js),
 *        converted to a base logit that is the regression OFFSET;
 *      - a signal in [-1,+1] for each adjustment layer that can be honestly
 *        rebuilt from this dataset (see LAYERS below). Layers with too little
 *        history for a given match ABSTAIN (signal 0) — exactly like the live
 *        engine gates on missing data.
 * 3. Fits a logistic regression   logit(p_p1) = b0 + bBase*baseLogit + Σ bk*sk
 *    by Newton's method (IRLS). Working in LOGIT space is the statistically
 *    correct way to weight signals; the live engine adds them in probability
 *    space, so each fitted bk is also translated to a suggested probability-
 *    space maxMagnitude (dP ≈ 0.25·b near p=0.5) to compare against config.js.
 * 4. Splits by time (train early years / test recent years) and reports
 *    out-of-sample Brier/log-loss for base-only vs base+layers, against the
 *    Pinnacle market Brier as the target.
 *
 * IMPORTANT CAVEATS (honesty per CLAUDE.md — no overclaiming)
 * ----------------------------------------------------------
 *  - These reconstructions are DEFINITIONALLY CLOSE but not identical to the
 *    live layers. e.g. recent form here is TOUR-LEVEL ONLY (Sackmann has no
 *    Challenger/ITF), whereas the live model's #5 explicitly includes them.
 *    Treat the fitted magnitudes as calibration GUIDANCE for config.js, not as
 *    drop-in weights.
 *  - Only reconstructable layers are fit. #1 style-matchup IS fit here (from the
 *    current-snapshot matchup-matrix.json + playing-styles.json — see the CAVEAT
 *    on loadStyle(): it is not strictly point-in-time). #2 subjective, #8 W/UE,
 *    #12 weather, #15 clutch, #17 odds-movement have no usable historical source
 *    here and are NOT fit (they keep their placeholders). (#6 round-stage and
 *    #14 court-speed were removed entirely in Model v2.0 Step 1.)
 *  - Sackmann tennis_atp is CC BY-NC-SA (non-commercial). Internal R&D only.
 *
 * USAGE
 *  node h2h-model/calibrate.js                  # train 2011-2020, test 2021-2025
 *  node h2h-model/calibrate.js 2011 2019 2020 2025
 *                                               # trainStart trainEnd testStart testEnd
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const ROOT = path.join(__dirname, '..');
const TML_DIR = path.join(ROOT, 'tml-cache');
const ODDS_DIR = path.join(ROOT, 'odds-archive');

// ---------- CSV + name/surface helpers (self-contained on purpose) ----------
function readCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const lines = txt.split('\n').filter(l => l.length);
  const header = lines[0].split(',');
  const idx = {}; header.forEach((h, i) => { idx[h] = i; });
  return { idx, rows: lines.slice(1).map(l => l.split(',')) };
}
const alpha = s => (s || '').replace(/[^a-z]/gi, '').toLowerCase();
const tmSurname = s => { const t = (s || '').trim().split(/\s+/).filter(Boolean); return alpha(t[t.length - 1]); };
const oaSurname = s => alpha((s || '').trim().split(/\s+/)[0]);
function surfKey(s) {
  const t = (s || '').trim().toLowerCase();
  if (t.startsWith('clay')) return 'clay';
  if (t.startsWith('grass')) return 'grass';
  if (t.startsWith('carpet')) return 'hard';
  return 'hard';
}
function countSets(score) {
  if (!score) return 2;
  const sets = (score.match(/\d+-\d+/g) || []).length;
  return sets || 2;
}
function dayNum(yyyymmdd) {
  const s = String(yyyymmdd);
  const y = +s.slice(0, 4), m = +s.slice(4, 6) || 1, d = +s.slice(6, 8) || 1;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// ---------- style matchup (archetype vs archetype) --------------------------
// Mirrors adjustments.js#styleMatchup: signal = (matrixPct - 50)/50, where
// matrixPct is the historical win% of p1's primary archetype vs p2's, gated on
// the matrix cell's sample floor.
//
// CAVEAT (why this one differs from the other layers): matchup-matrix.json and
// playing-styles.json are CURRENT-SNAPSHOT files computed over the full
// 2000-2026 window, so this layer is NOT strictly point-in-time. Playing style
// is a slow-moving structural trait, so applying today's archetype to a past
// match is a fair approximation — but the matrix aggregates outcomes that
// include the very matches we score (each is ~1/70k of the pool, so leakage is
// small but non-zero). Read the fitted #1 coefficient with that in mind.
function loadStyle() {
  const mmPath = path.join(ROOT, 'matchup-matrix.json');
  const psPath = path.join(ROOT, 'playing-styles.json');
  if (!fs.existsSync(mmPath) || !fs.existsSync(psPath)) {
    return { matrix: null, primaryBySurname: new Map(), minN: 20 };
  }
  const mm = JSON.parse(fs.readFileSync(mmPath, 'utf8'));
  const ps = JSON.parse(fs.readFileSync(psPath, 'utf8'));
  // surname -> primary archetype. Drop surnames that resolve to >1 distinct
  // primary (ambiguous, e.g. two different players share a surname) -> abstain.
  const seen = new Map();
  for (const p of (ps.players || [])) {
    if (!p.name || !p.primary) continue;
    const sn = tmSurname(p.name); // "C. Alcaraz" -> "alcaraz"
    if (!sn) continue;
    if (!seen.has(sn)) seen.set(sn, new Set());
    seen.get(sn).add(p.primary);
  }
  const primaryBySurname = new Map();
  for (const [sn, set] of seen) if (set.size === 1) primaryBySurname.set(sn, [...set][0]);
  return { matrix: mm.matrix || null, primaryBySurname, minN: mm.minSampleN || 20 };
}
const STYLE = loadStyle();

// ---------- point-in-time ELO (same as backtest.js) -------------------------
const K = 32, BASE = 1500;
class Elo {
  constructor() { this.all = new Map(); this.surf = new Map(); }
  getAll(p) { return this.all.has(p) ? this.all.get(p) : BASE; }
  getSurf(p, s) { const k = p + '|' + s; return this.surf.has(k) ? this.surf.get(k) : BASE; }
  static prob(a, b) { return 1 / (1 + Math.pow(10, (b - a) / config.eloDivisor)); }
  update(w, l, s) {
    const rw = this.getAll(w), rl = this.getAll(l), ew = Elo.prob(rw, rl);
    this.all.set(w, rw + K * (1 - ew)); this.all.set(l, rl - K * (1 - ew));
    const kw = w + '|' + s, kl = l + '|' + s, sw = this.getSurf(w, s), sl = this.getSurf(l, s), es = Elo.prob(sw, sl);
    this.surf.set(kw, sw + K * (1 - es)); this.surf.set(kl, sl - K * (1 - es));
  }
}
function baseProb(elo, a, b, surface) {
  const w = config.eloBlend;
  const rawA = elo.getAll(a), rawB = elo.getAll(b);
  const surfA = elo.getSurf(a, surface), surfB = elo.getSurf(b, surface);
  const pRaw = Elo.prob(rawA, rawB), pSurf = Elo.prob(surfA, surfB);
  const p5050 = Elo.prob((rawA + surfA) / 2, (rawB + surfB) / 2);
  return w.raw * pRaw + w.surface * pSurf + w.blend * p5050;
}

// ---------- per-player rolling state (point-in-time) ------------------------
function newState() {
  return {
    all: { w: 0, p: 0 },
    surf: {}, round: {}, fmt: {},
    last5: [], last20: [],
    serve: { ace: 0, svpt: 0, firstIn: 0, firstWon: 0, matches: 0 },
    recent: [], // {day, sets}
  };
}
const rate = (o, min) => (o && o.p >= min ? o.w / o.p : null);
const clamp1 = x => Math.max(-1, Math.min(1, x));

// ---------- LAYERS: signal from p1's perspective, or null to abstain --------
// Each takes the two players' state objects + match context, returns [-1,1]|null.
const LAYERS = [
  { id: 1, key: 'styleMatchup', min: 0, scale: 1, fn: (s1, s2, ctx) => {
      const a1 = ctx.a1, a2 = ctx.a2;
      if (!a1 || !a2 || !STYLE.matrix) return null;
      const cell = STYLE.matrix[a1] && STYLE.matrix[a1][a2];
      if (!cell || cell.pct == null || (cell.n || 0) < STYLE.minN) return null;
      return clamp1((cell.pct - 50) / 50);
    } },
  { id: 4, key: 'surface', min: 10, scale: 0.30, fn: (s1, s2, ctx) => {
      const a = rate(s1.surf[ctx.surface], 10), b = rate(s2.surf[ctx.surface], 10);
      return (a == null || b == null) ? null : clamp1((a - b) / 0.30);
    } },
  { id: 5, key: 'recentForm', min: 3, scale: 0.6, fn: (s1, s2) => {
      if (s1.last5.length < 3 || s2.last5.length < 3) return null;
      const a = s1.last5.reduce((x, y) => x + y, 0) / s1.last5.length;
      const b = s2.last5.reduce((x, y) => x + y, 0) / s2.last5.length;
      return clamp1((a - b) / 0.6);
    } },
  { id: 3, key: 'h2h', min: 2, scale: 1, fn: (s1, s2, ctx) => {
      const h = ctx.h2h; if (!h || (h.a + h.b) < 2) return null;
      return clamp1((h.a - h.b) / (h.a + h.b));
    } },
  // NOTE (2026-07): this harness can only reconstruct DILUTED CAREER serve from
  // Sackmann (ace% + first-serve-win% accumulated across all conditions). It
  // cannot see the live model's tier-1 (this-tournament) or tier-2 (last-3-on-
  // surface) serve, which have no deep historical archive. So the fit here will
  // structurally UNDER-weight serve. We deliberately override the fitted value:
  // production config.serve.maxMagnitude is pinned to 0.035, not the ~0.02 this
  // fit suggests. Keep this layer for directional sanity only.
  { id: 9, key: 'serve', min: 10, scale: 1, fn: (s1, s2) => {
      if (s1.serve.matches < 10 || s2.serve.matches < 10) return null;
      const idx = s => (0.5 * (s.ace / Math.max(1, s.svpt)) / 0.08) + (0.5 * (s.firstWon / Math.max(1, s.firstIn)) / 0.72);
      // normalise: ace~8% full, first-serve-win centred ~72%; use differential
      const a = (s1.serve.ace / Math.max(1, s1.serve.svpt)), b = (s2.serve.ace / Math.max(1, s2.serve.svpt));
      const fa = (s1.serve.firstWon / Math.max(1, s1.serve.firstIn)), fb = (s2.serve.firstWon / Math.max(1, s2.serve.firstIn));
      return clamp1(0.5 * (a - b) / 0.04 + 0.5 * (fa - fb) / 0.10);
    } },
  { id: 11, key: 'fatigue', min: 0, scale: 1, fn: (s1, s2, ctx) => {
      const load = st => st.recent.filter(r => ctx.day - r.day <= config.fatigueWindowDays).reduce((x, r) => x + r.sets, 0);
      const a = load(s1), b = load(s2);
      if (a === 0 && b === 0) return null;
      return clamp1((b - a) / 15); // fresher p1 (less load) => positive
    } },
  // #6 roundStage removed in Model v2.0 (Step 1).
  { id: 7, key: 'qualityForm', min: 5, scale: 0.5, fn: (s1, s2) => {
      const topRate = st => { const t = st.last20.filter(x => x.oppRank && x.oppRank <= 50); return t.length >= 5 ? t.reduce((a, x) => a + x.won, 0) / t.length : null; };
      const a = topRate(s1), b = topRate(s2);
      return (a == null || b == null) ? null : clamp1((a - b) / 0.5);
    } },
  { id: 13, key: 'formatSplit', min: 8, scale: 0.2, fn: (s1, s2, ctx) => {
      const over = st => { const f = rate(st.fmt[ctx.bestOf], 8), o = rate(st.all, 10); return (f == null || o == null) ? null : f - o; };
      const a = over(s1), b = over(s2);
      return (a == null || b == null) ? null : clamp1((a - b) / 0.20);
    } },
];

// ---------- load spine ------------------------------------------------------
function loadSpine(y0, y1) {
  const out = [];
  for (let y = y0; y <= y1; y++) {
    const f = path.join(TML_DIR, y + '.csv');
    if (!fs.existsSync(f)) continue;
    const { idx, rows } = readCsv(f);
    for (const r of rows) {
      const wn = r[idx.winner_name], ln = r[idx.loser_name];
      if (!wn || !ln) continue;
      out.push({
        year: y, date: +r[idx.tourney_date] || y * 10000, matchNum: +r[idx.match_num] || 0,
        wId: r[idx.winner_id] || wn, lId: r[idx.loser_id] || ln,
        wSurname: tmSurname(wn), lSurname: tmSurname(ln),
        surface: surfKey(r[idx.surface]),
        round: (r[idx.round] || '').trim() || 'NA',
        bestOf: (+r[idx.best_of] === 5) ? 5 : 3,
        wRank: +r[idx.winner_rank] || null, lRank: +r[idx.loser_rank] || null,
        sets: countSets(r[idx.score]),
        wServe: { ace: +r[idx.w_ace] || 0, svpt: +r[idx.w_svpt] || 0, firstIn: +r[idx.w_1stIn] || 0, firstWon: +r[idx.w_1stWon] || 0, has: r[idx.w_svpt] !== '' && r[idx.w_svpt] != null },
        lServe: { ace: +r[idx.l_ace] || 0, svpt: +r[idx.l_svpt] || 0, firstIn: +r[idx.l_1stIn] || 0, firstWon: +r[idx.l_1stWon] || 0, has: r[idx.l_svpt] !== '' && r[idx.l_svpt] != null },
      });
    }
  }
  out.sort((a, b) => a.date - b.date || a.matchNum - b.matchNum);
  return out;
}
function loadMarket(y0, y1) {
  const map = new Map();
  for (let y = y0; y <= y1; y++) {
    const f = path.join(ODDS_DIR, y + '.csv'); if (!fs.existsSync(f)) continue;
    const { idx, rows } = readCsv(f); const ym = new Map();
    for (const r of rows) {
      const psw = parseFloat(r[idx.psw]), psl = parseFloat(r[idx.psl]);
      if (!(psw > 1) || !(psl > 1)) continue;
      const iw = 1 / psw, il = 1 / psl;
      const key = oaSurname(r[idx.winner]) + '|' + oaSurname(r[idx.loser]);
      if (!ym.has(key)) ym.set(key, iw / (iw + il));
    }
    map.set(y, ym);
  }
  return map;
}

// ---------- linear algebra: solve + invert small matrices -------------------
function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => row.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
  for (let col = 0; col < n; col++) {
    let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col] || 1e-12;
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) if (r !== col) { const f = A[r][col]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j]; }
  }
  return A.map(row => row.slice(n));
}
const sigmoid = z => 1 / (1 + Math.exp(-z));

// Newton / IRLS logistic regression with tiny L2 (not on intercept).
function fitLogistic(X, y, lambda = 1.0, iters = 30) {
  const n = X.length, d = X[0].length;
  let w = new Array(d).fill(0);
  let H = null;
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = X[i]; let z = 0; for (let j = 0; j < d; j++) z += w[j] * xi[j];
      const p = sigmoid(z), wgt = Math.max(1e-6, p * (1 - p)), err = p - y[i];
      for (let j = 0; j < d; j++) {
        g[j] += err * xi[j];
        for (let k = 0; k < d; k++) H[j][k] += wgt * xi[j] * xi[k];
      }
    }
    for (let j = 1; j < d; j++) { g[j] += lambda * w[j]; H[j][j] += lambda; } // L2 skip intercept
    const Hinv = invert(H);
    const step = new Array(d).fill(0);
    for (let j = 0; j < d; j++) for (let k = 0; k < d; k++) step[j] += Hinv[j][k] * g[k];
    let maxStep = 0; for (let j = 0; j < d; j++) { w[j] -= step[j]; maxStep = Math.max(maxStep, Math.abs(step[j])); }
    if (maxStep < 1e-8) break;
  }
  const Hinv = invert(H);
  const se = Hinv.map((row, j) => Math.sqrt(Math.max(0, row[j])));
  return { w, se };
}

// ---------- build feature rows ----------------------------------------------
function buildRows(spine, market, scoreFromYear) {
  const elo = new Elo();
  const st = new Map();
  const h2hMap = new Map();
  const get = id => { if (!st.has(id)) st.set(id, newState()); return st.get(id); };
  const h2hKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;

  const rows = []; // {y, baseLogit, signals:[], active:[], year, mktKey, mkt}
  const activeCount = LAYERS.map(() => 0);

  for (const m of spine) {
    const s1state = get(m.wId), s2state = get(m.lId);
    if (m.date >= scoreFromYear * 10000) {
      // orientation: even match_num => p1 = winner (y=1)
      const asWinner = (m.matchNum % 2) === 0;
      const p1 = asWinner ? m.wId : m.lId, p2 = asWinner ? m.lId : m.wId;
      const s1 = get(p1), s2 = get(p2);
      const y = asWinner ? 1 : 0;

      const p = Math.min(0.999, Math.max(0.001, baseProb(elo, p1, p2, m.surface)));
      const baseLogit = Math.log(p / (1 - p));

      const hk = h2hMap.get(h2hKey(p1, p2)) || { a: 0, b: 0 };
      // orient h2h to p1
      const h2hP1 = (h2hKey(p1, p2) === p1 + '|' + p2) ? { a: hk.a, b: hk.b } : { a: hk.b, b: hk.a };
      const p1Sn = asWinner ? m.wSurname : m.lSurname;
      const p2Sn = asWinner ? m.lSurname : m.wSurname;
      const ctx = {
        surface: m.surface, round: m.round, bestOf: m.bestOf, day: dayNum(m.date), h2h: h2hP1,
        a1: STYLE.primaryBySurname.get(p1Sn), a2: STYLE.primaryBySurname.get(p2Sn),
      };

      const signals = [], active = [];
      LAYERS.forEach((L, i) => {
        let v = L.fn(s1, s2, ctx);
        if (v == null || !isFinite(v)) { signals.push(0); active.push(0); }
        else { signals.push(v); active.push(1); activeCount[i]++; }
      });

      const ym = market.get(m.year);
      const mkRaw = ym && ym.get(m.wSurname + '|' + m.lSurname); // prob winner wins
      const mkt = mkRaw == null ? null : (asWinner ? mkRaw : 1 - mkRaw);

      rows.push({ y, baseLogit, signals, year: m.year, mkt });
    }

    // ---- update state AFTER recording (point-in-time) ----
    const uW = get(m.wId), uL = get(m.lId);
    // overall
    uW.all.w++; uW.all.p++; uL.all.p++;
    // surface
    (uW.surf[m.surface] = uW.surf[m.surface] || { w: 0, p: 0 }); uW.surf[m.surface].w++; uW.surf[m.surface].p++;
    (uL.surf[m.surface] = uL.surf[m.surface] || { w: 0, p: 0 }); uL.surf[m.surface].p++;
    // round
    (uW.round[m.round] = uW.round[m.round] || { w: 0, p: 0 }); uW.round[m.round].w++; uW.round[m.round].p++;
    (uL.round[m.round] = uL.round[m.round] || { w: 0, p: 0 }); uL.round[m.round].p++;
    // format
    (uW.fmt[m.bestOf] = uW.fmt[m.bestOf] || { w: 0, p: 0 }); uW.fmt[m.bestOf].w++; uW.fmt[m.bestOf].p++;
    (uL.fmt[m.bestOf] = uL.fmt[m.bestOf] || { w: 0, p: 0 }); uL.fmt[m.bestOf].p++;
    // last5
    uW.last5.push(1); if (uW.last5.length > 5) uW.last5.shift();
    uL.last5.push(0); if (uL.last5.length > 5) uL.last5.shift();
    // last20 vs opp rank
    uW.last20.push({ won: 1, oppRank: m.lRank }); if (uW.last20.length > 20) uW.last20.shift();
    uL.last20.push({ won: 0, oppRank: m.wRank }); if (uL.last20.length > 20) uL.last20.shift();
    // serve career
    if (m.wServe.has) { uW.serve.ace += m.wServe.ace; uW.serve.svpt += m.wServe.svpt; uW.serve.firstIn += m.wServe.firstIn; uW.serve.firstWon += m.wServe.firstWon; uW.serve.matches++; }
    if (m.lServe.has) { uL.serve.ace += m.lServe.ace; uL.serve.svpt += m.lServe.svpt; uL.serve.firstIn += m.lServe.firstIn; uL.serve.firstWon += m.lServe.firstWon; uL.serve.matches++; }
    // fatigue recent
    const dn = dayNum(m.date);
    uW.recent.push({ day: dn, sets: m.sets }); uL.recent.push({ day: dn, sets: m.sets });
    uW.recent = uW.recent.filter(r => dn - r.day <= config.fatigueWindowDays);
    uL.recent = uL.recent.filter(r => dn - r.day <= config.fatigueWindowDays);
    // h2h
    const key = h2hKey(m.wId, m.lId);
    const rec = h2hMap.get(key) || { a: 0, b: 0 };
    if (key === m.wId + '|' + m.lId) rec.a++; else rec.b++;
    h2hMap.set(key, rec);

    elo.update(m.wId, m.lId, m.surface);
  }
  return { rows, activeCount };
}

// ---------- scoring ---------------------------------------------------------
function brierLL(rows, predict) {
  let b = 0, ll = 0, c = 0, n = 0;
  for (const r of rows) { const p = Math.min(0.999999, Math.max(1e-6, predict(r))); b += (p - r.y) ** 2; ll += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); if ((p >= 0.5) === (r.y === 1)) c++; n++; }
  return { brier: b / n, ll: ll / n, acc: c / n, n };
}

// ---------- main ------------------------------------------------------------
function main() {
  const a = process.argv.slice(2).filter(x => /^\d{4}$/.test(x)).map(Number);
  const trainStart = a[0] || 2011, trainEnd = a[1] || 2020, testStart = a[2] || 2021, testEnd = a[3] || 2025;
  const y0 = Math.min(trainStart, 2010) - 0; // include a warm-up year before trainStart
  const warm = trainStart - 1;

  console.log(`\nLayer weight-fit — train ${trainStart}-${trainEnd}, test ${testStart}-${testEnd} (warm-up from ${warm})`);
  console.log(`Base = production Stage-1 ELO blend; layers reconstructed point-in-time.\n`);

  const spine = loadSpine(warm, testEnd);
  const market = loadMarket(warm, testEnd);
  const { rows, activeCount } = buildRows(spine, market, trainStart);

  const train = rows.filter(r => r.year >= trainStart && r.year <= trainEnd);
  const test = rows.filter(r => r.year >= testStart && r.year <= testEnd);
  console.log(`Rows: ${rows.length} total, ${train.length} train, ${test.length} test.`);
  console.log('Layer activity (fraction of scored matches where the signal fired):');
  LAYERS.forEach((L, i) => console.log(`  #${String(L.id).padStart(2)} ${L.key.padEnd(12)} ${(activeCount[i] / rows.length * 100).toFixed(0)}%`));

  // design matrices: [1, baseLogit, s1..sK]
  const toX = r => [1, r.baseLogit, ...r.signals];
  const Xtr = train.map(toX), ytr = train.map(r => r.y);
  const { w, se } = fitLogistic(Xtr, ytr, 1.0);

  const predFull = r => sigmoid(toX(r).reduce((s, x, j) => s + w[j] * x, 0));
  const predBase = r => sigmoid(w0.b0 + w0.bBase * r.baseLogit);

  // base-only refit (intercept + base) for a fair baseline
  const Xb = train.map(r => [1, r.baseLogit]);
  const fb = fitLogistic(Xb, ytr, 1.0);
  const w0 = { b0: fb.w[0], bBase: fb.w[1] };

  console.log('\n--- fitted coefficients (logit space) ---');
  console.log('  term            beta      se      z       suggest maxMag   config maxMag');
  const names = ['intercept', 'baseLogit', ...LAYERS.map(L => `#${L.id} ${L.key}`)];
  for (let j = 0; j < w.length; j++) {
    const z = w[j] / (se[j] || 1e-9);
    let extra = '';
    if (j >= 2) {
      const L = LAYERS[j - 2];
      const suggest = 0.25 * w[j]; // dP per full signal near p=0.5
      const cfg = config.adjustments[L.key] ? config.adjustments[L.key].maxMagnitude : null;
      extra = `   ${(suggest >= 0 ? '+' : '') + suggest.toFixed(3).padStart(6)}          ${cfg == null ? 'n/a' : cfg.toFixed(3)}`;
    }
    console.log(`  ${names[j].padEnd(14)} ${w[j].toFixed(3).padStart(6)}  ${se[j].toFixed(3)}  ${z.toFixed(1).padStart(5)}${extra}`);
  }
  console.log('  (|z|>2 ≈ significant. suggest maxMag = 0.25·beta, a probability-space');
  console.log('   translation to compare against config.js; negative => signal is');
  console.log('   inversely predictive on this dataset and should be reviewed.)');

  // out-of-sample
  const tB = brierLL(test, predBase), tF = brierLL(test, predFull);
  const mktRows = test.filter(r => r.mkt != null);
  const tM = mktRows.length ? brierLL(mktRows, r => r.mkt) : null;
  const tBonMkt = mktRows.length ? brierLL(mktRows, predBase) : null;
  const tFonMkt = mktRows.length ? brierLL(mktRows, predFull) : null;

  console.log('\n--- out-of-sample (test years) ---');
  console.log(`  base only (recalibrated ELO):  Brier ${tB.brier.toFixed(4)}  logloss ${tB.ll.toFixed(4)}  acc ${(tB.acc * 100).toFixed(1)}%`);
  console.log(`  base + fitted layers:          Brier ${tF.brier.toFixed(4)}  logloss ${tF.ll.toFixed(4)}  acc ${(tF.acc * 100).toFixed(1)}%`);
  const impr = (tB.brier - tF.brier) / tB.brier * 100;
  console.log(`  layers change Brier by ${(impr >= 0 ? '-' : '+')}${Math.abs(impr).toFixed(1)}% (negative sign = improvement)`);
  if (tM) {
    console.log(`\n  on the ${mktRows.length}-match subset with a Pinnacle line:`);
    console.log(`    base only:          Brier ${tBonMkt.brier.toFixed(4)}`);
    console.log(`    base + layers:      Brier ${tFonMkt.brier.toFixed(4)}`);
    console.log(`    Pinnacle (target):  Brier ${tM.brier.toFixed(4)}`);
    const gap0 = tBonMkt.brier - tM.brier, gap1 = tFonMkt.brier - tM.brier;
    const closed = gap0 > 0 ? (1 - gap1 / gap0) * 100 : 0;
    console.log(`    gap to market closed by layers: ${closed.toFixed(0)}%  (${gap0.toFixed(4)} -> ${gap1.toFixed(4)})`);
  }
  console.log('');
}

main();
