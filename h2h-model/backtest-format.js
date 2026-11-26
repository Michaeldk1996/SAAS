'use strict';
/**
 * backtest-format.js — INTERNAL R&D (founder 2026-11-26, the best-of-5 set conversion). Point-in-time Elo (the
 * backtest.js clean-room Stage 1, K 32, production blend) over the Sackmann files; on every Grand Slam main-draw match
 * (tourney_level G, best_of 5) scores the Bo3 probability as is against its best-of-5 conversion (model.js
 * bo5FromBo3), beside Pinnacle's no-vig close where tennis-data joins. Best-of-3 tour-level matches are the control.
 *   node h2h-model/backtest-format.js [y0 y1]   (TML_ROOT = folder holding tml-cache/ and odds-archive/)
 */
const fs = require('fs'), path = require('path');
const config = require('./config');
const { bo5FromBo3, calibrate } = require('./model');
const ROOT = process.env.TML_ROOT || path.join(__dirname, '..');
const csv = f => { const l = fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean); const h = l[0].split(','); return l.slice(1).map(r => { const c = r.split(','), o = {}; h.forEach((k, i) => { o[k] = c[i]; }); return o; }); };
const alpha = s => (s || '').replace(/[^a-z]/gi, '').toLowerCase();
const surf = s => /^clay/i.test(s) ? 'clay' : /^grass/i.test(s) ? 'grass' : 'hard';
const prob = (a, b) => 1 / (1 + Math.pow(10, (b - a) / config.eloDivisor));
const args = process.argv.slice(2).map(Number).filter(Boolean);
const y0 = args[0] || 2010, y1 = args[1] || 2025;
const all = new Map(), sf = new Map(), g = (m, k) => m.has(k) ? m.get(k) : 1500;
function upd(m, w, l) { const rw = g(m, w), rl = g(m, l), e = prob(rw, rl); m.set(w, rw + 32 * (1 - e)); m.set(l, rl - 32 * (1 - e)); }
function pBlend(w, l, s) {
  const b = config.eloBlend, rest = 1 - b.surface;
  const ra = g(all, w), rb = g(all, l), sa = g(sf, w + '|' + s), sb = g(sf, l + '|' + s);
  return rest * (b.raw / (b.raw + b.blend)) * prob(ra, rb) + b.surface * prob(sa, sb) + rest * (b.blend / (b.raw + b.blend)) * prob((ra + sa) / 2, (rb + sb) / 2);
}
const mkt = new Map();
for (let y = y0; y <= y1; y++) {
  const f = path.join(ROOT, 'odds-archive', y + '.csv'); if (!fs.existsSync(f)) continue;
  for (const r of csv(f)) { const a = +r.psw, b = +r.psl; if (a > 1 && b > 1) mkt.set(y + '|' + alpha((r.winner || '').split(' ')[0]) + '|' + alpha((r.loser || '').split(' ')[0]), (1 / a) / (1 / a + 1 / b)); }
}
const spine = [];
for (let y = y0; y <= y1; y++) {
  const f = path.join(ROOT, 'tml-cache', y + '.csv'); if (!fs.existsSync(f)) continue;
  for (const r of csv(f)) if (r.winner_id && r.loser_id) spine.push({ y, d: +r.tourney_date, n: +r.match_num || 0, w: r.winner_id, l: r.loser_id, s: surf(r.surface),
    lvl: r.tourney_level, bo: +r.best_of, q: /^Q/.test(r.round || ''), wn: alpha((r.winner_name || '').split(' ').pop()), ln: alpha((r.loser_name || '').split(' ').pop()), ret: /RET|W\/O|DEF/i.test(r.score || '') });
}
spine.sort((a, b) => a.d - b.d || a.n - b.n);
const acc = () => ({ n: 0, ll: 0, br: 0 });
const add = (a, p) => { p = Math.min(1 - 1e-6, Math.max(1e-6, p)); a.n++; a.ll -= Math.log(p); a.br += (1 - p) ** 2; };
const A = { bo5: acc(), bo5c: acc(), bo5cal: acc(), bo5calc: acc(), bo5ccal: acc(), j: acc(), jc: acc(), jm: acc(), bo3: acc() };
const bucket = Array.from({ length: 5 }, () => ({ n: 0, w: 0, p: 0, pc: 0 }));
for (const m of spine) {
  if (m.y > y0 && m.lvl !== 'D' && !m.q && !(m.bo === 5 && m.ret)) {
    const p = pBlend(m.w, m.l, m.s);
    if (m.lvl === 'G' && m.bo === 5) {
      const c = bo5FromBo3(p), cal = q => calibrate(q, config.calibration).p1;
      add(A.bo5, p); add(A.bo5c, c); add(A.bo5cal, cal(p)); add(A.bo5calc, bo5FromBo3(cal(p))); add(A.bo5ccal, cal(c));
      const fav = p >= 0.5 ? p : 1 - p, won = p >= 0.5 ? 1 : 0, bi = Math.min(4, Math.floor((fav - 0.5) * 10));
      Object.assign(bucket[bi], { n: bucket[bi].n + 1, w: bucket[bi].w + won, p: bucket[bi].p + fav, pc: bucket[bi].pc + bo5FromBo3(fav) });
      const mk = mkt.get(m.y + '|' + m.wn + '|' + m.ln);
      if (mk != null) { add(A.j, p); add(A.jc, c); add(A.jm, mk); }
    } else if (m.bo === 3 && 'AMFG'.includes(m.lvl)) add(A.bo3, p);
  }
  upd(all, m.w, m.l); upd(sf, m.w + '|' + m.s, m.l + '|' + m.s);
}
const out = o => o.n ? { n: o.n, logLoss: +(o.ll / o.n).toFixed(4), brier: +(o.br / o.n).toFixed(4) } : null;
console.log(JSON.stringify({ years: [y0 + 1, y1], note: 'retirements out of the Bo5 set; the first year warms the ratings',
  slamBo5: { asBo3: out(A.bo5), converted: out(A.bo5c), calibratedOnly: out(A.bo5cal), calibrateThenConvert: out(A.bo5calc), convertThenCalibrate: out(A.bo5ccal) },
  slamBo5JoinedToPinnacle: { asBo3: out(A.j), converted: out(A.jc), pinnacleNoVig: out(A.jm) },
  bo3TourLevelControl: out(A.bo3),
  reliabilityBo5: bucket.map((b, i) => ({ fav: `${50 + i * 10}-${60 + i * 10}%`, n: b.n, predictedAsBo3: +(b.p / b.n * 100).toFixed(1), predictedConverted: +(b.pc / b.n * 100).toFixed(1), won: +(b.w / b.n * 100).toFixed(1) })) }, null, 1));
