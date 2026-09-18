// TEN-206 item 4 · Derived lines — verification probe.
//
// Renders the tab off the DEPLOYED stores and re-derives every painted figure
// from the raw spine rows by a second path. Reading the model's own output back
// would only prove the model agrees with itself.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const DEPLOYED = require(path.join(ROOT, 'tools', 'deployed-store.js'));
const STORE = DEPLOYED.playerProfiles();
if (STORE.source !== 'deployed') { console.error('ABORT: not the deployed store'); process.exit(1); }
const PLAYERS = STORE.players;
// career-history/ is gitignored and CI-built, so pull the deployed shards down
// first. Without them calSpine walks an empty list and every row reads 0 — a
// clean bill of health on a store that never loaded.
const CH_DIR = path.join(ROOT, 'career-history');
const hyd = DEPLOYED.hydrateCareerHistory({ dir: CH_DIR });
if (hyd && hyd.error) { console.error('ABORT: ' + hyd.error); process.exit(1); }
const CAREER_HIST = {};
if (fs.existsSync(CH_DIR)) for (const f of fs.readdirSync(CH_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(CH_DIR, f), 'utf8'));
    CAREER_HIST[f.replace(/\.json$/, '')] = (j && j.matches) || [];
  } catch { /* a single bad shard must not blind the probe */ }
}
if (!Object.keys(CAREER_HIST).length) { console.error('ABORT: career-history hydrated empty'); process.exit(1); }
console.log(`career-history: ${Object.keys(CAREER_HIST).length} shards`);

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const MARKET = {};
const MDIR = path.join(ROOT, 'market-edge');
if (fs.existsSync(MDIR)) for (const f of fs.readdirSync(MDIR)) if (f.endsWith('.json'))
  MARKET[f.replace(/\.json$/, '')] = rd(path.join('market-edge', f), null);

const sandbox = {
  FEATURE_PP2: true, playerProfiles: { players: PLAYERS },
  courtSpeedMap: rd('court-speed-map.json', null),
  careerSplits: (rd('career-splits.json', {}) || {}).players || {},
  marketEdge: MARKET, playingStyles: rd('playing-styles.json', {}),
  holdbreak: rd('holdbreak.json', {}), careerHistory: CAREER_HIST
};
global.window = sandbox;
new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sandbox);
const I = sandbox.PlayerProfileV2._internals;

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   ' + m + (d ? ' :: ' + d : '')); } else { fail++; console.log('  FAIL ' + m + (d ? ' :: ' + d : '')); } };

const byName = (frag) => Object.keys(PLAYERS).find(k =>
  String(PLAYERS[k].name || '').toLowerCase().includes(frag));

for (const frag of ['zverev', 'sinner', 'martinez']) {
  const key = byName(frag);
  if (!key) { console.log(`\n(no ${frag} in the deployed roster today)`); continue; }
  const p = Object.assign({ key }, PLAYERS[key]);
  console.log(`\n=== ${p.name} (${key}) ===`);

  const spine = I.calSpine(p) || [];
  for (const fmt of ['bo3', 'bo5']) {
    const d = I.lineCoverage(p, fmt);

    // ---- independent recompute, straight off the spine -------------------
    const setsToWin = fmt === 'bo3' ? 2 : 3;
    let exc = 0, noSc = 0;
    const pool = [];
    for (const r of spine) {
      if (r.retired || r.wo) { exc++; continue; }
      let sc = null;
      if (r.setGames && r.setGames.length) {
        let w = 0, l = 0;
        for (const s of r.setGames) { if (s.p == null || s.o == null) continue; if (+s.p > +s.o) w++; else if (+s.o > +s.p) l++; }
        if (w || l) sc = { w, l };
      }
      if (!sc) {
        const mm = String(r.sets || '').match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
        if (mm && (+mm[1] || +mm[2])) sc = { w: +mm[1], l: +mm[2] };
      }
      if (!sc) { noSc++; continue; }
      if (Math.max(sc.w, sc.l) !== setsToWin) continue;
      let g = null;
      if (r.setGames && r.setGames.length) {
        let f = 0, a = 0, seen = 0;
        for (const s of r.setGames) { if (s.p == null || s.o == null) continue; f += +s.p; a += +s.o; seen++; }
        if (seen) g = { f, a };
      }
      const role = (r.price != null && r.oppPrice != null)
        ? (r.price < r.oppPrice ? 'fav' : r.price > r.oppPrice ? 'dog' : null) : null;
      pool.push({ sc, g, role });
    }
    ok(d.n === pool.length, `${fmt} pool size`, `model ${d.n} vs recompute ${pool.length}`);
    ok(d.excluded === exc, `${fmt} RET/abandoned excluded and counted`, `model ${d.excluded} vs ${exc}`);
    const wg = pool.filter(m => m.g).length;
    ok(d.withGames === wg, `${fmt} rows carrying per-set games`, `model ${d.withGames} vs ${wg}`);

    // Match shape must partition the pool exactly: every completed match of
    // this format is one shape and no other.
    const shape = d.groups.find(g => g.title === 'Match shape');
    const shapeHits = shape.rows.filter(r => !r.sub).reduce((a, r) => a + (r.hit === '—' ? 0 : +r.hit), 0);
    ok(shapeHits === pool.length, `${fmt} match shape partitions the pool`,
      `${shapeHits} shape hits vs ${pool.length} matches`);

    // Rate must equal hit/n on every printed row.
    let rateBad = 0, recBad = 0;
    for (const g of d.groups) for (const r of g.rows) {
      if (r.rate === '—' || r.n === '—') continue;
      const exp = (+r.hit / +r.n * 100).toFixed(1) + '%';
      if (exp !== r.rate) rateBad++;
      if (r.record !== `${r.hit}–${+r.n - +r.hit}`) recBad++;
    }
    ok(rateBad === 0, `${fmt} every printed rate is hit/n`, `${rateBad} mismatches`);
    ok(recBad === 0, `${fmt} every printed record is hit–(n−hit)`, `${recBad} mismatches`);

    // The split rows must sum to their total row's hit count, per line.
    let splitBad = 0, splitChecked = 0;
    for (const g of d.groups) {
      if (!/handicap/.test(g.title)) continue;
      for (let i = 0; i < g.rows.length; i += 3) {
        const [tot, fav, dog] = [g.rows[i], g.rows[i + 1], g.rows[i + 2]];
        if (!fav || !fav.sub) continue;
        const num = x => (x === '—' ? 0 : +x);
        splitChecked++;
        // fav+dog can be < total: an unpriced match has no role. Never more.
        if (num(fav.hit) + num(dog.hit) > num(tot.hit)) splitBad++;
      }
    }
    ok(splitBad === 0, `${fmt} fav+dog never exceed the total row`,
      `${splitChecked} split lines checked`);

    // Avg margin: the export's definition, re-derived here for one line.
    const gh = d.groups.find(g => g.title === 'Games handicap');
    if (gh && wg > 0) {
      const row = gh.rows[0];                     // the tightest minus line
      const lineVal = fmt === 'bo3' ? 4.5 : 6.5;
      const hitters = pool.filter(m => m.g && (m.g.f - m.g.a) > lineVal);
      if (hitters.length) {
        const mean = hitters.reduce((a, m) => a + (m.g.f - m.g.a), 0) / hitters.length;
        const want = (Math.round(mean * 10) / 10).toFixed(1);
        const got = String(row.margin).replace(/^[+−]/, '');
        ok(got === want, `${fmt} avg margin = mean games margin over HITTING matches`,
          `${row.label}: painted ${row.margin}, recompute +${want} over ${hitters.length}`);
        // every hitting match must clear the line, or the hit test is wrong
        ok(hitters.every(m => (m.g.f - m.g.a) > lineVal), `${fmt} every −${lineVal} hit clears the line`);
      }
    }

    const html = (() => { I.state.lcFmt = fmt; return I.renderLinesTab(p); })();
    ok(/Coverage by line/.test(html), `${fmt} tab renders`);
    ok(/Avg margin/.test(html), `${fmt} carries the Avg margin column`);
    ok(/coverage rates, not results against a priced line/.test(html),
      `${fmt} footnote carries the ruled disclaimer`);
    ok(!d.excluded || new RegExp(d.excluded + ' match(es)? excluded — retired or abandoned').test(html),
      `${fmt} footnote states the RET/abandoned count`, `${d.excluded} excluded`);
    console.log(`       n=${d.n} withGames=${d.withGames} priced=${d.priced} excluded=${d.excluded} noScore=${d.noScore}`);
  }
}
// ── the career-history per-set wiring, on a subject built to carry it ───────
// Everything above is VACUOUS for this: the deployed career-history shards do
// not carry `sets` yet (TEN-206 item 1 is merged but the shards have not been
// rebuilt), so the recompute walks the same empty field the model does and the
// two agree at zero. Un-wiring the reader left the probe at 76/0 — it could not
// see the feature at all. So drive a row the store WILL carry once it rebuilds:
// career-history rows with per-set games and no recentForm twin.
{
  console.log('\n=== career-history per-set wiring (synthetic subject) ===');
  const KEY = '999999';
  const mk = (date, sets, won) => ({ date, tournament: 'Probe Open', round: 'R32',
    opponent: 'X. Test', won, result: won ? '2 - 0' : '0 - 2', sets });
  const S = [{ p: 6, o: 3 }, { p: 6, o: 4 }];
  const L = [{ p: 3, o: 6 }, { p: 4, o: 6 }];
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const d = `2019-0${(i % 9) + 1}-1${i % 10}`;
    rows.push(mk(d, i % 2 ? L : S, !(i % 2)));
  }
  const sb = {
    FEATURE_PP2: true,
    playerProfiles: { players: { [KEY]: { name: 'P. Robe', recentForm: { matches: [] } } } },
    careerHistory: { [KEY]: rows }, marketEdge: {}, careerSplits: {},
    playingStyles: {}, holdbreak: {}, courtSpeedMap: null
  };
  global.window = sb;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sb);
  const J = sb.PlayerProfileV2._internals;
  const pp = { key: KEY, name: 'P. Robe', recentForm: { matches: [] } };
  const spine = J.calSpine(pp) || [];
  ok(spine.length === 12, 'synthetic spine built', `${spine.length} rows`);
  const wired = spine.filter(r => r.setGames && r.setGames.length).length;
  ok(wired === 12, 'career-history `sets` reaches the spine as setGames',
    `${wired} of 12 rows carry per-set games`);
  ok(spine.every(r => /\d+-\d+, \d+-\d+/.test(r.score)),
    'the SET SCORES column renders per-set games from career-history, not the "2 - 0" count');
  const d3 = J.lineCoverage(pp, 'bo3');
  ok(d3.withGames === 12, 'every synthetic row can carry a games line',
    `withGames ${d3.withGames} of n ${d3.n}`);
  const gh = d3.groups.find(g => g.title === 'Games handicap');
  // 6 wins at +5 games, 6 losses at −5. −4.5 must hit exactly the 6 wins.
  const m45 = gh.rows.find(r => !r.sub && /−4\.5/.test(r.label));
  ok(m45.hit === '6' && m45.n === '12', '−4.5 games hits exactly the six +5 wins',
    `hit ${m45.hit} of ${m45.n}`);
  ok(m45.margin === '+5.0', 'its avg margin is the mean over the HITTING matches',
    `painted ${m45.margin}, expected +5.0`);
  const p45 = gh.rows.find(r => !r.sub && /\+4\.5/.test(r.label));
  ok(p45.hit === '6', '+4.5 games hits the same six (a −5 loss does not clear it)',
    `hit ${p45.hit}`);
}

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
