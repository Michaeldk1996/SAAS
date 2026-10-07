// tools/test-ten384-fx6.js — TEN-384 fix round 6 (fx6, 2026-10-07): the founder's round-2 list (comment aabecee6).
//
// Every check runs on PINNED inputs (the committed fixture, sliced page code, constructed rows), so it is identical
// in every checkout, CI included. Each one fails on 4d9b30b4 — the control: `FX6_BASE=4d9b30b4 node
// tools/test-ten384-fx6.js` runs the same checks against that commit's player-profile-v2.js (read with `git show`).
//
//   1 · Last 52 surfaces  the window splits Indoors out of its surfaces on the season table's court: the window's
//                         rows of a season = that season's row in the season table, surface by surface.
//   2 · Match shape       the Match shape rows = All matches, every format and role: a per-set list short of the
//                         result (US Open 2021 v Gojowczyk, "3 - 2" with four sets on file) takes the result's count.
//
// Run: node tools/test-ten384-fx6.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const ROOT = L.ROOT;
const BASE = process.env.FX6_BASE || null;
const CTRL_DIR = BASE ? fs.mkdtempSync(path.join(os.tmpdir(), 'fx6-control-' + BASE + '-')) : null;
function srcOf(rel) {
  if (!BASE) return path.join(ROOT, rel);
  const f = path.join(CTRL_DIR, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + rel], { maxBuffer: 64 << 20 }));
  return f;
}
const PP2 = srcOf('player-profile-v2.js');
// eslint-disable-next-line import/no-dynamic-require
const TI = require(srcOf('tournament-identity.js'));
const H = L.harness();
const T = L.text;
console.log('TEN-384 fx6 — ' + (BASE ? 'CONTROL against ' + BASE : 'working tree'));

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
function fxModule(opts) {
  opts = opts || {};
  const p = Object.assign({}, FX.profile, opts.profile || {});
  delete p.tournamentHistory;
  const th = opts.th || FX.tournamentHistory;
  p.tournamentHistory = TI.mergeHistory ? TI.mergeHistory(th) : th;
  const m = L.loadPp2({
    src: PP2, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: opts.ch || FX.careerHistory },
    marketEdge: { [FX.key]: opts.me || FX.marketEdge }, bet365History: FX.bet365History,
    extra: Object.assign({ TournamentIdentity: TI }, opts.extra || {})
  });
  return { I: m.I, W: m.W, p };
}
function withState(I, patch, fn) {
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, patch);
  try { return fn(); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
const wl = c => (c ? (c.won || 0) + '–' + (c.lost || 0) : '—');
const SURFS = ['hard', 'clay', 'grass', 'indoors'];

function main() {
// ════════════════════════════════════════════════════════════════════════════
// 1 · Last 52: the window's surfaces = the season table's surfaces
// ════════════════════════════════════════════════════════════════════════════
H.check('1 · Korda: the window\'s rows of each season it holds = that season\'s row of the season table, surface by surface', () => {
  const { I, p } = fxModule();
  const out = [];
  ['2026', '2025'].forEach(yr => {
    const y = (p.careerByYear || []).find(r => String(r.year) === yr);
    assert(y && y.indoor, 'fixture season ' + yr + ' carries no indoor split');
    const season = I.gridCells(y);
    // drillRows(p, surf, year, since) is the Last 52 window's own filter (since = the cut); a since of the
    // season's 1 January runs the same filter over the whole season.
    SURFS.forEach(s => {
      const rows = I.drillRows(p, s, yr, yr + '-01-01');
      const got = { won: rows.filter(r => r.won).length, lost: rows.filter(r => !r.won).length };
      const want = season[s] || { won: 0, lost: 0 };
      assert.strictEqual(wl(got), wl(want), yr + ' ' + s + ': the window lists ' + wl(got) + ', the season table ' + wl(want));
    });
    out.push(yr + ' ' + SURFS.map(s => s + ' ' + wl(season[s])).join(' · '));
  });
  return out.join(' | ');
});
H.check('1 · Korda Last 52 cells: Indoors is carved out (9–5), Hard is outdoor only (14–6), the total holds (23–11)', () => {
  const { I, p } = fxModule();
  const g = I.last52GridCells(p, 'all');
  assert.strictEqual(wl(g.cells.indoors), '9–5', 'Indoors ' + wl(g.cells.indoors));
  assert.strictEqual(wl(g.cells.hard), '14–6', 'Hard ' + wl(g.cells.hard));
  assert.strictEqual(wl(g.total), '23–11', 'total ' + wl(g.total));
  const sum = SURFS.reduce((a, s) => a + (g.cells[s] ? g.cells[s].won + g.cells[s].lost : 0), 0);
  assert.strictEqual(sum, 34, 'the four rows sum to ' + sum);
  // the 2026 season sits wholly inside the window: its share of the window = its season row
  const cut = I.last52Cutoff();
  const y26 = I.gridCells(p.careerByYear.find(r => String(r.year) === '2026'));
  const in26 = I.drillRows(p, 'indoors', '2026', cut).length;
  assert.strictEqual(in26, y26.indoors.won + y26.indoors.lost);
  return `Hard ${wl(g.cells.hard)} · Indoors ${wl(g.cells.indoors)} · total ${wl(g.total)}`;
});
H.check('1 · Korda Career record, Last 52 scope: the Indoors row prints its W–L (not "—" / "No court type in the dated window")', () => {
  const { I, p } = fxModule();
  const t = withState(I, { key: p.key, careerTab: 'record', careerScope: 'l52', careerTier: 'all', careerDrill: null },
    () => T(I.renderCareerModal(p, {})));
  assert(!/No court type in the dated window/.test(t), 'the Last 52 Indoors row still refuses');
  assert(/Indoors\s+9–5/.test(t), 'no "Indoors 9–5" in the Last 52 table: ' + (t.match(/Indoors.{0,60}/) || [''])[0]);
  return (t.match(/Indoors\s+9–5.{0,30}/) || [''])[0].trim();
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · Derived lines: the Match shape rows = All matches
// ════════════════════════════════════════════════════════════════════════════
// Alcaraz's live row, as career-history holds it: result "3 - 2", four per-set scores (the fifth is missing).
const GOJ = { year: '2021', surface: 'hard', level: 'atp', date: '2021-09-05', tournament: 'US Open', round: 'R32',
  opponent: 'P. Gojowczyk', result: '3 - 2', won: true, bestOf: 5,
  sets: [{ p: 5, o: 7 }, { p: 6, o: 1 }, { p: 5, o: 7 }, { p: 6, o: 2 }] };
// and a best-of-3 win whose list holds one set ("2 - 0", 6-2 on file)
const ONE = { year: '2023', surface: 'hard', level: 'atp', date: '2023-03-24', tournament: 'Miami', round: 'R64',
  opponent: 'F. Bagnis', result: '2 - 0', won: true, bestOf: 3, sets: [{ p: 6, o: 2 }] };
function shapeSums(I, p) {
  const out = [];
  ['bo3', 'bo5'].forEach(f => ['all', 'fav', 'dog'].forEach(role => {
    const c = I.lineCoverage(p, f, role);
    const sh = c.groups.find(g => g.title === 'Match shape');
    const sum = sh.rows.reduce((a, r) => a + r.hit, 0);
    out.push({ f, role, sum, n: c.n, hits: sh.rows.map(r => r.hit), c });
  }));
  return out;
}
H.check('2 · Korda (fixture): in Bo3 and Bo5, under All / As favourite / As underdog, the Match shape rows sum to the table\'s matches', () => {
  const { I, p } = fxModule();
  const s = shapeSums(I, p);
  s.forEach(x => assert.strictEqual(x.sum, x.n, x.f + '/' + x.role + ': ' + x.hits.join(' + ') + ' = ' + x.sum + ', not ' + x.n));
  return s.filter(x => x.role === 'all').map(x => x.f + ' ' + x.hits.join(' + ') + ' = ' + x.n).join(' · ');
});
H.check('2 · a "3 - 2" win with four sets on file is a best-of-5 won 3–2 (not a shapeless Bo3 2–2); its games lines are not summed short', () => {
  const { I, p } = fxModule({ ch: FX.careerHistory.concat([GOJ]) });
  const base = fxModule();
  const s = shapeSums(I, p), b = shapeSums(base.I, base.p);
  s.forEach(x => assert.strictEqual(x.sum, x.n, x.f + '/' + x.role + ': ' + x.hits.join(' + ') + ' = ' + x.sum + ', not ' + x.n));
  const bo3 = s.find(x => x.f === 'bo3' && x.role === 'all'), bo5 = s.find(x => x.f === 'bo5' && x.role === 'all');
  const bo3b = b.find(x => x.f === 'bo3' && x.role === 'all'), bo5b = b.find(x => x.f === 'bo5' && x.role === 'all');
  assert.strictEqual(bo3.n, bo3b.n, 'the Bo3 table took the match (' + bo3b.n + ' -> ' + bo3.n + ')');
  assert.strictEqual(bo5.n, bo5b.n + 1, 'the Bo5 table did not take it');
  const won32 = I.lineCoverage(p, 'bo5', 'all').groups.find(g => g.title === 'Match shape').rows.find(r => r.label === 'won 3–2');
  const won32b = base.I.lineCoverage(base.p, 'bo5', 'all').groups.find(g => g.title === 'Match shape').rows.find(r => r.label === 'won 3–2');
  assert.strictEqual(won32.hit, won32b.hit + 1, 'won 3–2 did not take it');
  assert.strictEqual(bo5.c.withGames, bo5b.c.withGames, 'its four-set games entered the games lines');
  return `Bo5 ${bo5b.n} -> ${bo5.n}, won 3–2 ${won32b.hit} -> ${won32.hit}; Bo3 stays ${bo3.n}; games lines stay on ${bo5.c.withGames}`;
});
H.check('2 · a "2 - 0" win with one set on file is a Bo3 won 2–0, not dropped from both formats', () => {
  const { I, p } = fxModule({ ch: FX.careerHistory.concat([ONE]) });
  const base = fxModule();
  const a = I.lineCoverage(p, 'bo3', 'all'), b = base.I.lineCoverage(base.p, 'bo3', 'all');
  assert.strictEqual(a.n, b.n + 1, 'Bo3 ' + b.n + ' -> ' + a.n);
  const sum = a.groups.find(g => g.title === 'Match shape').rows.reduce((x, r) => x + r.hit, 0);
  assert.strictEqual(sum, a.n);
  return `Bo3 ${b.n} -> ${a.n} = the shapes`;
});

H.done();
}
main();
