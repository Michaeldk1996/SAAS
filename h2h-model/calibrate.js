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
// tml-cache is gitignored and lives only in the main checkout; a worktree reads it from there.
const TML_DIR = process.env.TML_DIR || [path.join(ROOT, 'tml-cache'), path.join(ROOT, '..', 'bsp-consult-project', 'tml-cache')]
  .find(d => fs.existsSync(d)) || path.join(ROOT, 'tml-cache');
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
// Live rule (TEN-419 / modal-playing-style.md): playing-styles.json archetype_label is the
// one label; matrix[labelA][labelB] = {pct, n, w}; signal = (pct - 50)/50 only when n >= 30;
// a mirror (same label) is 0.
const STYLE_MIN_N = 30;
function loadStyle() {
  const mmPath = path.join(ROOT, 'matchup-matrix.json');
  const psPath = path.join(ROOT, 'playing-styles.json');
  if (!fs.existsSync(mmPath) || !fs.existsSync(psPath)) {
    throw new Error('matchup-matrix.json / playing-styles.json missing in ' + ROOT);
  }
  const mm = JSON.parse(fs.readFileSync(mmPath, 'utf8'));
  const ps = JSON.parse(fs.readFileSync(psPath, 'utf8'));
  // surname -> label. Drop surnames that resolve to >1 distinct label (two players share it) -> abstain.
  const seen = new Map();
  for (const p of (ps.players || [])) {
    if (!p.name || !p.archetype_label) continue;
    const sn = tmSurname(p.name); // "C. Alcaraz" -> "alcaraz"
    if (!sn) continue;
    if (!seen.has(sn)) seen.set(sn, new Set());
    seen.get(sn).add(p.archetype_label);
  }
  const primaryBySurname = new Map();
  for (const [sn, set] of seen) if (set.size === 1) primaryBySurname.set(sn, [...set][0]);
  if (!mm.matrix || !primaryBySurname.size) throw new Error('style files carry no matrix / no archetype_label');
  return { matrix: mm.matrix, primaryBySurname, minN: STYLE_MIN_N };
}
const STYLE = loadStyle();

// ---------- court speed band (layer #18) ------------------------------------
// COURT_CONDITIONS, courtSpeedCategory, courtConditionsFor and COURT_CONDITIONS_ALIASES are
// sliced verbatim from bsp-pipeline.js (requiring it would run the pipeline).
const CS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  const grab = re => { const m = src.match(re); if (!m) throw new Error('court-speed slice failed: ' + re); return m[0]; };
  const code = [
    grab(/const COURT_CONDITIONS = \{[\s\S]*?\n\};/),
    grab(/function courtSpeedCategory\(speed\) \{[\s\S]*?\n\}/),
    grab(/function courtConditionsFor\(tournamentName\) \{[\s\S]*?\n\}/),
    grab(/const COURT_CONDITIONS_ALIASES = \{[^\n]*\};/),
  ].join('\n') + '\n;({ COURT_CONDITIONS, courtSpeedCategory, courtConditionsFor });';
  return require('vm').runInNewContext(code, {});
})();
// Sackmann spells some events differently from api-tennis. Each entry is the same venue.
// The season finals map to Turin only from 2021 (2009-2020 = London O2, not in the table).
const SACK_EVENT = { "Queen's Club": 'London', 'Rio De Janeiro': 'Rio de Janeiro', 'Winston Salem': 'Winston-Salem' };
const FINALS = new Set(['Tour Finals', 'ATP Finals', 'ATP Tour Finals']);
function courtKeyFor(name, year) {
  if (/olympic/i.test(name)) return null; // a different venue ('London Olympics' = Wimbledon, 'Paris Olympics' = RG)
  if (FINALS.has(name)) return year >= 2021 ? 'Turin' : null;
  // Canada alternates: to 2019 Toronto even / Montreal odd; from 2021 Toronto odd / Montreal even.
  if (name === 'Canada Masters') return ((year <= 2019) === (year % 2 === 0)) ? 'Toronto' : 'Montreal';
  const c = CS.courtConditionsFor(SACK_EVENT[name] || name);
  return c ? c.key : null;
}


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
    yr: [], // {day, won, band} — last 364 days, for #18
    vs: {}, // opponent archetype_label -> {w, p}, career from the warm-up year (#1 personal)
  };
}
const rate = (o, min) => (o && o.p >= min ? o.w / o.p : null);
const clamp1 = x => Math.max(-1, Math.min(1, x));
// #1 style record (personal): his win rate vs the opponent's label minus his overall rate,
// shrunk by n/(n+20), 0 when n < 10. Point-in-time: st holds only matches before this one.
const styleRecordTerm = (st, oppLabel) => {
  const r = st.vs[oppLabel];
  if (!r || r.p < 10 || !st.all.p) return 0;
  return (r.w / r.p - st.all.w / st.all.p) * r.p / (r.p + 20);
};

// ---------- LAYERS: signal from p1's perspective, or null to abstain --------
// Each takes the two players' state objects + match context, returns [-1,1]|null.
const LAYERS = [
  { id: 1, key: 'styleMatchup', min: 0, scale: 1, fn: (s1, s2, ctx) => {
      const a1 = ctx.a1, a2 = ctx.a2;
      if (!a1 || !a2 || !STYLE.matrix) return null;
      if (a1 === a2) return 0; // mirror
      const cell = STYLE.matrix[a1] && STYLE.matrix[a1][a2];
      if (!cell || cell.pct == null || (cell.n || 0) < STYLE.minN) return null;
      return clamp1((cell.pct - 50) / 50);
    } },
  { id: 19, key: 'styleRecord', min: 10, scale: 0.20, fn: (s1, s2, ctx) => {
      if (!ctx.a1 || !ctx.a2) return null;
      const t1 = styleRecordTerm(s1, ctx.a2), t2 = styleRecordTerm(s2, ctx.a1);
      if (t1 === 0 && t2 === 0) return null;
      return clamp1((t1 - t2) / 0.20);
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
  // #18 court speed record (live spec): per player, win rate in THIS event's band over the
  // previous 52 weeks minus his win rate over all matches in the same 52 weeks, shrunk by
  // n_band/(n_band+15), 0 when n_band < 5; signal = clamp((t1 - t2)/0.20). Abstain with no band
  // or both terms 0.
  { id: 18, key: 'courtSpeedRecord', min: 5, scale: 0.20, fn: (s1, s2, ctx) => {
      if (!ctx.band) return null;
      const term = st => {
        const yr = st.yr.filter(r => ctx.day - r.day <= 364);
        const b = yr.filter(r => r.band === ctx.band);
        if (b.length < 5) return 0;
        const gap = b.reduce((x, r) => x + r.won, 0) / b.length - yr.reduce((x, r) => x + r.won, 0) / yr.length;
        return gap * b.length / (b.length + 15);
      };
      const t1 = term(s1), t2 = term(s2);
      if (t1 === 0 && t2 === 0) return null;
      return clamp1((t1 - t2) / 0.20);
    } },
  { id: 13, key: 'formatSplit', min: 8, scale: 0.2, fn: (s1, s2, ctx) => {
      const over = st => { const f = rate(st.fmt[ctx.bestOf], 8), o = rate(st.all, 10); return (f == null || o == null) ? null : f - o; };
      const a = over(s1), b = over(s2);
      return (a == null || b == null) ? null : clamp1((a - b) / 0.20);
    } },
];

// #19 (personal style record) did not help out of sample (fit-report-style2.md, 20 Nov 2026):
// out of the default run; CAL_STYLE_RECORD=1 puts it back for a re-check.
if (!process.env.CAL_STYLE_RECORD) LAYERS.splice(LAYERS.findIndex(L => L.id === 19), 1);

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
        tourney: r[idx.tourney_name] || '', venueSig: (r[idx.surface] || '') + '|' + (r[idx.indoor] || ''),
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
  // Band = the table's speed for this venue. The table measures today's court (2023-25), so a
  // row only gets it when the event is still played on the same surface + indoor/outdoor as in
  // its latest season on file (Stuttgart clay to 2014, Acapulco clay to 2013 get none) — the
  // live join's own "different event" guard (venueAndCourtSpeedFor).
  const latestSig = new Map();
  for (const m of out) { m.courtKey = courtKeyFor(m.tourney, m.year); if (m.courtKey) latestSig.set(m.courtKey, m.venueSig); }
  for (const m of out) {
    m.band = (m.courtKey && latestSig.get(m.courtKey) === m.venueSig)
      ? CS.courtSpeedCategory(CS.COURT_CONDITIONS[m.courtKey].speed) : null;
  }
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
        band: m.band, surface: m.surface, round: m.round, bestOf: m.bestOf, day: dayNum(m.date), h2h: h2hP1,
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

      const row = { y, baseLogit, signals, active, year: m.year, mkt, band: m.band, turin: m.courtKey === 'Turin',
        r1: asWinner ? m.wRank : m.lRank, r2: asWinner ? m.lRank : m.wRank };
      if (ctx.a1 && ctx.a2) row.sr = { date: m.date, tourney: m.tourney, p1: p1Sn, p2: p2Sn, a1: ctx.a1, a2: ctx.a2,
        t1: styleRecordTerm(s1, ctx.a2), t2: styleRecordTerm(s2, ctx.a1), n1: (s1.vs[ctx.a2] || {}).p || 0, n2: (s2.vs[ctx.a1] || {}).p || 0,
        r1: s1.vs[ctx.a2] ? s1.vs[ctx.a2].w + '-' + (s1.vs[ctx.a2].p - s1.vs[ctx.a2].w) : '0-0', r2: s2.vs[ctx.a1] ? s2.vs[ctx.a1].w + '-' + (s2.vs[ctx.a1].p - s2.vs[ctx.a1].w) : '0-0',
        o1: s1.all.w / (s1.all.p || 1), o2: s2.all.w / (s2.all.p || 1), base: 1 / (1 + Math.exp(-baseLogit)) };
      rows.push(row);
    }

    // ---- update state AFTER recording (point-in-time) ----
    const uW = get(m.wId), uL = get(m.lId);
    // overall
    uW.all.w++; uW.all.p++; uL.all.p++;
    // personal record vs the opponent's (today's) label; unknown label -> nothing recorded
    const lLab = STYLE.primaryBySurname.get(m.lSurname), wLab = STYLE.primaryBySurname.get(m.wSurname);
    if (lLab) { const r = (uW.vs[lLab] = uW.vs[lLab] || { w: 0, p: 0 }); r.w++; r.p++; }
    if (wLab) { const r = (uL.vs[wLab] = uL.vs[wLab] || { w: 0, p: 0 }); r.p++; }
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
    // 52-week band record (#18); kept on the match day, read by days <= 364 before the scored match
    uW.yr.push({ day: dn, won: 1, band: m.band }); uL.yr.push({ day: dn, won: 0, band: m.band });
    uW.yr = uW.yr.filter(r => dn - r.day <= 364); uL.yr = uL.yr.filter(r => dn - r.day <= 364);
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
  layerReport(rows, train, test);
}

// ---------- per-layer report: coverage, coefficient, with / without -------------
// fitEval: fit [1, base, signals at cols] on trainRows, score on testRows.
function fitEval(trainRows, testRows, cols) {
  const toX = r => [1, r.baseLogit, ...cols.map(i => r.signals[i])];
  const f = fitLogistic(trainRows.map(toX), trainRows.map(r => r.y), 1.0);
  const s = brierLL(testRows, r => sigmoid(toX(r).reduce((a, x, j) => a + f.w[j] * x, 0)));
  return { w: f.w, se: f.se, ...s };
}
function layerReport(rows, train, test) {
  const all = LAYERS.map((_, i) => i);
  const fmt = r => `logloss ${r.ll.toFixed(4)}  Brier ${r.brier.toFixed(4)}  (n ${r.n})`;
  const pct = (a, b) => (b ? (a / b * 100).toFixed(1) : '—') + '%';
  const bandCount = rs => { const c = {}; rs.forEach(r => { const k = r.band || 'none'; c[k] = (c[k] || 0) + 1; }); return c; };
  console.log('--- court-speed band coverage (scored rows) ---');
  console.log('  train', JSON.stringify(bandCount(train)), ' test', JSON.stringify(bandCount(test)));
  const out = { train: train.length, test: test.length, bands: { train: bandCount(train), test: bandCount(test) }, layers: {} };
  for (const id of [1, 19, 18].filter(id => LAYERS.some(L => L.id === id))) {
    const i = LAYERS.findIndex(L => L.id === id), L = LAYERS[i];
    const act = rs => rs.filter(r => r.active[i]).length;
    const nz = rs => rs.filter(r => r.active[i] && r.signals[i] !== 0).length;
    const joint = fitEval(train, test, all);
    const without = fitEval(train, test, all.filter(j => j !== i));
    const base = fitEval(train, test, []);
    const alone = fitEval(train, test, [i]);
    const o = {
      key: L.key,
      active: { train: act(train), trainNonzero: nz(train), test: act(test), testNonzero: nz(test) },
      joint: { beta: joint.w[2 + i], se: joint.se[2 + i] }, alone: { beta: alone.w[2], se: alone.se[2] },
      oos: { allLayers: joint, allButThis: without, base, baseThis: alone },
    };
    // fit on the rows where the layer is active only
    const trA = train.filter(r => r.active[i]), teA = test.filter(r => r.active[i]);
    if (trA.length > 50 && teA.length > 50) o.activeOnly = { base: fitEval(trA, teA, []), baseThis: fitEval(trA, teA, [i]) };
    out.layers[id] = o;
    console.log(`\n--- #${id} ${L.key} ---`);
    console.log(`  active: train ${o.active.train}/${train.length} (${pct(o.active.train, train.length)}), nonzero ${o.active.trainNonzero}; test ${o.active.test}/${test.length} (${pct(o.active.test, test.length)}), nonzero ${o.active.testNonzero}`);
    console.log(`  joint beta ${o.joint.beta.toFixed(3)} ± ${o.joint.se.toFixed(3)} -> suggest maxMag ${(0.25 * o.joint.beta).toFixed(3)}; alone beta ${o.alone.beta.toFixed(3)} ± ${o.alone.se.toFixed(3)}`);
    console.log(`  all layers:        ${fmt(joint)}`);
    console.log(`  all but #${id}:       ${fmt(without)}`);
    console.log(`  base only:         ${fmt(base)}`);
    console.log(`  base + #${id} only:   ${fmt(alone)}`);
    if (o.activeOnly) { console.log(`  active rows only: base ${fmt(o.activeOnly.base)} | base+#${id} ${fmt(o.activeOnly.baseThis)}`); }
  }
  capSweep(train, test, out);
  // #19 personal vs #1 generic: joint without generic, with generic, and the two alone together
  if (LAYERS.some(L => L.id === 19)) {
    const i1 = LAYERS.findIndex(L => L.id === 1), i19 = LAYERS.findIndex(L => L.id === 19);
    const noGen = all.filter(j => j !== i1), noBoth = all.filter(j => j !== i1 && j !== i19);
    const P = {
      jointNoGeneric: fitEval(train, test, noGen), jointNoGenericNoPersonal: fitEval(train, test, noBoth),
      genericPlusPersonal: fitEval(train, test, [i1, i19]), genericOnly: fitEval(train, test, [i1]),
    };
    const at = (f, cols, i) => ({ beta: f.w[2 + cols.indexOf(i)], se: f.se[2 + cols.indexOf(i)] });
    P.b19NoGen = at(P.jointNoGeneric, noGen, i19);
    P.b19WithGen = at(P.genericPlusPersonal, [i1, i19], i19); P.b1WithPers = at(P.genericPlusPersonal, [i1, i19], i1);
    out.personal = P;
    console.log('\n--- #19 personal vs #1 generic ---');
    console.log(`  joint (all but #1) beta #19 ${P.b19NoGen.beta.toFixed(3)} ± ${P.b19NoGen.se.toFixed(3)}`);
    console.log(`  all but #1:          ${fmt(P.jointNoGeneric)}`);
    console.log(`  all but #1 and #19:  ${fmt(P.jointNoGenericNoPersonal)}`);
    console.log(`  base + #1 + #19:     ${fmt(P.genericPlusPersonal)}  beta #1 ${P.b1WithPers.beta.toFixed(3)} ± ${P.b1WithPers.se.toFixed(3)}, #19 ${P.b19WithGen.beta.toFixed(3)} ± ${P.b19WithGen.se.toFixed(3)}`);
    console.log(`  base + #1:           ${fmt(P.genericOnly)}`);
    const ex = test.filter(r => r.sr && r.active[i19] && r.sr.t1 !== 0 && r.sr.t2 !== 0).sort((a, b) => Math.abs(b.signals[i19]) - Math.abs(a.signals[i19]));
    const pick = [ex[0], ex[Math.floor(ex.length / 4)], ex[Math.floor(ex.length / 2)]].filter(Boolean);
    out.examples = pick.map(r => ({ ...r.sr, y: r.y, signal: r.signals[i19], generic: r.signals[i1] }));
    console.log('  examples:', JSON.stringify(out.examples));
  }
  // Fast-band only (founder: fast courts like the ATP Finals)
  const i18 = LAYERS.findIndex(L => L.id === 18);
  const trF = train.filter(r => r.band === 'Fast'), teF = test.filter(r => r.band === 'Fast');
  const all18 = all.filter(j => j !== i18);
  const F = {
    train: trF.length, test: teF.length,
    active: { train: trF.filter(r => r.active[i18]).length, test: teF.filter(r => r.active[i18]).length },
    base: fitEval(trF, teF, []), base18: fitEval(trF, teF, [i18]),
    allBut18: fitEval(trF, teF, all18), all: fitEval(trF, teF, all),
  };
  F.beta = F.base18.w[2]; F.se = F.base18.se[2]; F.betaJoint = F.all.w[2 + i18]; F.seJoint = F.all.se[2 + i18];
  const trFA = trF.filter(r => r.active[i18]), teFA = teF.filter(r => r.active[i18]);
  F.activeOnly = { base: fitEval(trFA, teFA, []), base18: fitEval(trFA, teFA, [i18]) };
  F.activeOnly.beta = F.activeOnly.base18.w[2]; F.activeOnly.se = F.activeOnly.base18.se[2];
  // Turin finals in test (2021-25)
  F.turinTest = test.filter(r => r.band === 'Fast' && r.turin).length;
  out.fast = F;
  console.log(`\n--- Fast band only (train ${trF.length}, test ${teF.length}; #18 active ${F.active.train} / ${F.active.test}) ---`);
  console.log(`  base:               ${fmt(F.base)}`);
  console.log(`  base + #18:         ${fmt(F.base18)}   beta ${F.beta.toFixed(3)} ± ${F.se.toFixed(3)}`);
  console.log(`  all but #18:        ${fmt(F.allBut18)}`);
  console.log(`  all layers:         ${fmt(F.all)}   beta #18 ${F.betaJoint.toFixed(3)} ± ${F.seJoint.toFixed(3)}`);
  console.log(`  #18-active Fast rows: base ${fmt(F.activeOnly.base)} | base+#18 ${fmt(F.activeOnly.base18)} beta ${F.activeOnly.beta.toFixed(3)} ± ${F.activeOnly.se.toFixed(3)}`);
  if (process.env.CAL_JSON) fs.writeFileSync(process.env.CAL_JSON, JSON.stringify(out, null, 1));
}

// ---------- #1 cap sweep in probability space (live engine rule) ------------------
// adjusted = clamp(base + signal × cap, probFloor, probCeil), then the rank-tier ceiling
// (model.js tierProbCeil). "base" = the Elo base recalibrated on train; "base+layers" = the
// logistic fit of base + every other layer (#1 out) on train, used as the base the cap adds to.
// Bands = the base-only probability of the player #1 favours (sign of the signal).
function capSweep(train, test, out) {
  const i1 = LAYERS.findIndex(L => L.id === 1);
  const others = LAYERS.map((_, i) => i).filter(i => i !== i1);
  const fitP = cols => { const f = fitEval(train, test, cols); return r => sigmoid([1, r.baseLogit, ...cols.map(i => r.signals[i])].reduce((a, x, j) => a + f.w[j] * x, 0)); };
  const pBase = fitP([]), pLayers = fitP(others);
  const tier = r => { const c = config.rankTierCutoff, t = x => x && x <= c, a = t(r.r1), b = t(r.r2);
    return a && b ? config.probCeilBothTop50 : (a !== b ? config.probCeilOneTop50 : config.probCeil); };
  const adj = (pb, cap) => r => { const t = tier(r); const p = Math.max(config.probFloor, Math.min(config.probCeil, pb(r) + r.signals[i1] * cap)); return Math.max(1 - t, Math.min(t, p)); };
  const favBase = r => { const p = pBase(r), s = r.signals[i1]; return s > 0 ? p : 1 - p; };
  const bands = [['<60%', 0, 0.6], ['60-70%', 0.6, 0.7], ['70-80%', 0.7, 0.8], ['80%+', 0.8, 2]];
  const sets = [['all test', test], ['#1 non-zero', test.filter(r => r.signals[i1] !== 0)],
    ...bands.map(([k, lo, hi]) => [k, test.filter(r => r.signals[i1] !== 0 && favBase(r) >= lo && favBase(r) < hi)])];
  const CAPS = [0, 0.02, 0.03, 0.05, 0.07, 0.10, 0.14];
  const FINE = Array.from({ length: 41 }, (_, k) => k * 0.005);
  const res = {};
  for (const [bn, pb] of [['base', pBase], ['base+layers', pLayers]]) {
    res[bn] = {};
    console.log(`\n--- #1 cap sweep, probability space, ${bn} ---`);
    for (const [sn, rs] of sets) {
      const grid = CAPS.map(c => ({ cap: c, ...brierLL(rs, adj(pb, c)) }));
      const fine = FINE.map(c => ({ cap: c, ...brierLL(rs, adj(pb, c)) }));
      const bestLL = fine.reduce((a, b) => b.ll < a.ll ? b : a), bestB = fine.reduce((a, b) => b.brier < a.brier ? b : a);
      const meanSig = rs.length ? rs.reduce((a, r) => a + Math.abs(r.signals[i1]), 0) / rs.length : 0;
      res[bn][sn] = { n: rs.length, meanAbsSignal: meanSig, grid, bestLL: bestLL.cap, bestBrier: bestB.cap };
      console.log(`  ${sn} (n ${rs.length}, mean |signal| ${meanSig.toFixed(3)}): best cap log-loss ${bestLL.cap.toFixed(3)}, Brier ${bestB.cap.toFixed(3)}`);
      for (const g of grid) console.log(`    cap ${g.cap.toFixed(2)}  logloss ${g.ll.toFixed(5)}  Brier ${g.brier.toFixed(5)}`);
      // paired per-match log-loss difference, cap c minus cap 0.10, with its standard error
      const ll1 = (pf, r) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, pf(r))); return -(r.y * Math.log(q) + (1 - r.y) * Math.log(1 - q)); };
      const ref = adj(pb, 0.10);
      res[bn][sn].vs010 = [0, 0.03, 0.05].map(c => { const f = adj(pb, c); const d = rs.map(r => ll1(f, r) - ll1(ref, r));
        const m = d.reduce((x, y) => x + y, 0) / (d.length || 1), v = d.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, d.length - 1);
        return { cap: c, diff: m, se: Math.sqrt(v / (d.length || 1)) }; });
      console.log('    log-loss vs cap 0.10 (negative = better): ' + res[bn][sn].vs010.map(o => `cap ${o.cap.toFixed(2)} ${(o.diff * 1e3).toFixed(2)}±${(o.se * 1e3).toFixed(2)}e-3`).join(', '));
    }
  }
  out.capSweep = res;
}

main();
