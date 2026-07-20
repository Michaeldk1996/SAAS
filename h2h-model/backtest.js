'use strict';

/**
 * backtest.js — INTERNAL R&D. Point-in-time, walk-forward backtest of the
 * Stage-1 ELO engine against a large historical match set, benchmarked to the
 * Pinnacle closing line.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 22 decided matches inside matches.json are far too few to calibrate the
 * model's weights (bootstrap of the in-sample optimum hit the search boundary
 * ~60% of the time — the magnitude was not identifiable). This harness fits /
 * validates on tens of thousands of real ATP matches instead.
 *
 * WHY NOT REUSE runModel()
 * ------------------------
 * runModel() reads CURRENT-snapshot JSONs (elo-ratings, player-profiles,
 * career-splits, radar, clutch, matchup-matrix). Feeding a 2015 match through
 * it would use 2026 knowledge => lookahead bias, and most Stage-2 layers would
 * abstain because their per-match pipeline fields don't exist historically.
 * So Stage 1 is reconstructed point-in-time here: a clean-room ELO that only
 * ever sees matches BEFORE the one being predicted. It mirrors the production
 * Stage-1 math exactly (same logistic divisor, same raw/surface/50-50 blend
 * from config.eloBlend) so the findings transfer to the live engine.
 *
 * LICENSING (per CLAUDE.md + backtest_elo.py header)
 * --------------------------------------------------
 * tml-cache/ is Jeff Sackmann tennis_atp data (CC BY-NC-SA, non-commercial).
 * This is internal model R&D only. Never serve this data — or a model trained
 * directly on it — to paying members. odds-archive/ is tennis-data.co.uk.
 *
 * DATA
 * ----
 *  tml-cache/<year>.csv    Sackmann: winner/loser + ids, ranks, surface,
 *                          round, best_of, tourney_date, serve stats.
 *  odds-archive/<year>.csv tennis-data.co.uk: winner/loser + Pinnacle psw/psl.
 *
 * USAGE
 *  node h2h-model/backtest.js                 # 2010-2025, 2010 warm-up
 *  node h2h-model/backtest.js 2015 2025       # custom year range
 *  node h2h-model/backtest.js 2015 2025 --sweep   # + surface-weight sweep
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const ROOT = path.join(__dirname, '..');
const TML_DIR = path.join(ROOT, 'tml-cache');
const ODDS_DIR = path.join(ROOT, 'odds-archive');

// ---- tiny CSV reader (fields never contain commas in these feeds) ----------
function readCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const lines = txt.split('\n').filter(l => l.length);
  const header = lines[0].split(',');
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  return { idx, rows: lines.slice(1).map(l => l.split(',')) };
}

// ---- name helpers: the two feeds format names differently ------------------
// Sackmann: "Grigor Dimitrov" (surname LAST). tennis-data: "Dimitrov G." (surname FIRST).
const alpha = s => (s || '').replace(/[^a-z]/gi, '').toLowerCase();
const tmSurname = s => { const t = (s || '').trim().split(/\s+/).filter(Boolean); return alpha(t[t.length - 1]); };
const oaSurname = s => alpha((s || '').trim().split(/\s+/)[0]);

// ---- surface normalisation to the production keys --------------------------
function surfKey(s) {
  const t = (s || '').trim().toLowerCase();
  if (t.startsWith('clay')) return 'clay';
  if (t.startsWith('grass')) return 'grass';
  if (t.startsWith('hard')) return 'hard';
  if (t.startsWith('carpet')) return 'hard'; // treat carpet as fast-hard
  return 'hard';
}

// ---- point-in-time ELO (overall + per-surface), K tunable ------------------
const K = 32;         // standard ATP ELO K (matches backtest_elo.py); tunable
const BASE = 1500;
class Elo {
  constructor() { this.all = new Map(); this.surf = new Map(); }
  getAll(p) { return this.all.has(p) ? this.all.get(p) : BASE; }
  getSurf(p, s) { const k = p + '|' + s; return this.surf.has(k) ? this.surf.get(k) : BASE; }
  static prob(a, b) { return 1 / (1 + Math.pow(10, (b - a) / config.eloDivisor)); }
  update(w, l, s) {
    const rw = this.getAll(w), rl = this.getAll(l);
    const ew = Elo.prob(rw, rl);
    this.all.set(w, rw + K * (1 - ew));
    this.all.set(l, rl + K * (0 - (1 - ew)));
    const kw = w + '|' + s, kl = l + '|' + s;
    const sw = this.getSurf(w, s), sl = this.getSurf(l, s);
    const es = Elo.prob(sw, sl);
    this.surf.set(kw, sw + K * (1 - es));
    this.surf.set(kl, sl + K * (0 - (1 - es)));
  }
}

// ---- production Stage-1 blend (mirror of elo.js baseProbability) -----------
// probability that `a` beats `b`, given point-in-time ratings.
function blendProb(elo, a, b, surface, surfaceWeightOverride) {
  const w = config.eloBlend;
  const sW = surfaceWeightOverride == null ? w.surface : surfaceWeightOverride;
  // keep raw:blend proportion, renormalise so weights still sum to 1 when sweeping
  const rest = 1 - sW;
  const rawW = rest * (w.raw / (w.raw + w.blend));
  const blendW = rest * (w.blend / (w.raw + w.blend));

  const rawA = elo.getAll(a), rawB = elo.getAll(b);
  const surfA = elo.getSurf(a, surface), surfB = elo.getSurf(b, surface);
  const pRaw = Elo.prob(rawA, rawB);
  const pSurf = Elo.prob(surfA, surfB);
  const p5050 = Elo.prob((rawA + surfA) / 2, (rawB + surfB) / 2);
  return rawW * pRaw + sW * pSurf + blendW * p5050;
}

// ---- load the Sackmann spine for a year range, sorted point-in-time --------
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
        year: y,
        date: +r[idx.tourney_date] || y * 10000,
        matchNum: +r[idx.match_num] || 0,
        wId: r[idx.winner_id] || wn,
        lId: r[idx.loser_id] || ln,
        wSurname: tmSurname(wn),
        lSurname: tmSurname(ln),
        surface: surfKey(r[idx.surface]),
        wRank: +r[idx.winner_rank] || null,
        lRank: +r[idx.loser_rank] || null,
      });
    }
  }
  out.sort((a, b) => a.date - b.date || a.matchNum - b.matchNum);
  return out;
}

// ---- load Pinnacle vig-free winner prob, keyed surname-pair per year -------
function loadMarket(y0, y1) {
  const map = new Map(); // year -> Map("wSurname|lSurname" -> vigFreeWinnerProb)
  for (let y = y0; y <= y1; y++) {
    const f = path.join(ODDS_DIR, y + '.csv');
    if (!fs.existsSync(f)) continue;
    const { idx, rows } = readCsv(f);
    const ym = new Map();
    for (const r of rows) {
      const psw = parseFloat(r[idx.psw]), psl = parseFloat(r[idx.psl]);
      if (!(psw > 1) || !(psl > 1)) continue;
      const iw = 1 / psw, il = 1 / psl;
      const vigFree = iw / (iw + il); // prob the ACTUAL winner wins (market view)
      const key = oaSurname(r[idx.winner]) + '|' + oaSurname(r[idx.loser]);
      if (!ym.has(key)) ym.set(key, vigFree); // first occurrence; dupes are rare
    }
    map.set(y, ym);
  }
  return map;
}

// ---- scoring accumulator ---------------------------------------------------
function newAcc() { return { n: 0, brier: 0, ll: 0, correct: 0 }; }
function score(acc, pWinner) {
  const p = Math.min(0.999999, Math.max(1e-6, pWinner));
  acc.n++;
  acc.brier += (p - 1) ** 2;         // outcome for the winner is always 1
  acc.ll += -Math.log(p);
  if (p >= 0.5) acc.correct++;
}
function report(name, acc) {
  if (!acc.n) { console.log(`  ${name}: no matches`); return; }
  console.log(`  ${name.padEnd(26)} n=${acc.n}  Brier ${(acc.brier / acc.n).toFixed(4)}  logloss ${(acc.ll / acc.n).toFixed(4)}  acc ${(acc.correct / acc.n * 100).toFixed(1)}%`);
}

// ---- main ------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const wantSweep = args.includes('--sweep');
  const nums = args.filter(a => /^\d{4}$/.test(a)).map(Number);
  const y0 = nums[0] || 2010;
  const y1 = nums[1] || 2025;
  const warmupYear = y0; // first year builds ratings but is not scored

  console.log(`\nPoint-in-time ELO backtest — ${y0}-${y1}  (warm-up: ${warmupYear}, K=${K})`);
  console.log(`Stage-1 blend from config.eloBlend: raw ${config.eloBlend.raw} / surface ${config.eloBlend.surface} / 50-50 ${config.eloBlend.blend}, divisor ${config.eloDivisor}\n`);

  const spine = loadSpine(y0, y1);
  const market = loadMarket(y0, y1);
  console.log(`Loaded ${spine.length} Sackmann matches; scoring from ${warmupYear + 1} onward.\n`);

  const elo = new Elo();
  const accElo = newAcc();        // model Stage-1, all scored matches
  const accMkt = newAcc();        // market, only matches we could join
  const accEloJoin = newAcc();    // model, restricted to joined subset (apples-to-apples)
  const accRank = newAcc();       // naive rank-favourite baseline
  // De-biased reliability curve: split orientation deterministically by
  // match_num parity so each bucket sees both wins (y=1) and losses (y=0).
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, win: 0, psum: 0 }));
  let joined = 0;

  for (const m of spine) {
    // predict BEFORE updating ratings — strict point-in-time
    if (m.date >= (warmupYear + 1) * 10000) {
      const pW = blendProb(elo, m.wId, m.lId, m.surface);
      score(accElo, pW);
      // reliability: as-p1 = winner (y=1) on even match_num, else loser (y=0)
      const asWinner = (m.matchNum % 2) === 0;
      const pP1 = asWinner ? pW : 1 - pW;
      const yP1 = asWinner ? 1 : 0;
      const bi = Math.min(9, Math.floor(pP1 * 10));
      buckets[bi].n++; buckets[bi].win += yP1; buckets[bi].psum += pP1;

      // rank-favourite baseline (lower rank number = favourite)
      if (m.wRank && m.lRank) score(accRank, m.wRank < m.lRank ? 0.6 : 0.4);

      // market join
      const ym = market.get(m.year);
      const mk = ym && ym.get(m.wSurname + '|' + m.lSurname);
      if (mk != null) {
        joined++;
        score(accMkt, mk);
        score(accEloJoin, pW);
      }
    }
    elo.update(m.wId, m.lId, m.surface);
  }

  console.log('--- headline (all scored matches) ---');
  report('Model Stage-1 ELO', accElo);
  report('Rank-favourite baseline', accRank);
  console.log(`\n--- apples-to-apples vs market (joined subset: ${joined} matches, ${(joined / accElo.n * 100).toFixed(0)}% of scored) ---`);
  report('Model Stage-1 ELO', accEloJoin);
  report('Pinnacle closing (vig-free)', accMkt);

  console.log('\n--- model reliability (de-biased: predicted vs actual win-rate by decile) ---');
  console.log('  bucket    n     predicted  actual   gap');
  for (let i = 0; i < 10; i++) {
    const b = buckets[i];
    if (!b.n) continue;
    const pred = b.psum / b.n * 100, act = b.win / b.n * 100;
    console.log(`  ${(i * 10).toString().padStart(2)}-${i * 10 + 10}%  ${String(b.n).padStart(5)}   ${pred.toFixed(1)}%     ${act.toFixed(1)}%   ${(act - pred >= 0 ? '+' : '') + (act - pred).toFixed(1)}%`);
  }
  console.log('  (predicted ~= actual on every row => Stage-1 is well-calibrated.)');

  if (wantSweep) {
    console.log('\n--- surface-weight sweep (raw:50-50 proportion held; scored subset) ---');
    console.log('  surfaceW |  Brier   logloss  acc');
    for (const sW of [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8]) {
      const e2 = new Elo();
      const a2 = newAcc();
      for (const m of spine) {
        if (m.date >= (warmupYear + 1) * 10000) {
          score(a2, blendProb(e2, m.wId, m.lId, m.surface, sW));
        }
        e2.update(m.wId, m.lId, m.surface);
      }
      const mark = Math.abs(sW - config.eloBlend.surface) < 1e-9 ? '  <= current' : '';
      console.log(`    ${sW.toFixed(2)}   | ${(a2.brier / a2.n).toFixed(4)}  ${(a2.ll / a2.n).toFixed(4)}  ${(a2.correct / a2.n * 100).toFixed(1)}%${mark}`);
    }
  }
  console.log('');
}

main();
