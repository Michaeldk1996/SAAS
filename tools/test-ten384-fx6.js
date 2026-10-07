// tools/test-ten384-fx6.js — TEN-384 fix round 6 (fx6, 2026-10-07): the founder's round-2 list (comment aabecee6).
//
// Every check runs on PINNED inputs (the committed fixture, sliced page code, constructed rows), so it is identical
// in every checkout, CI included. Each one fails on 4d9b30b4 — the control: `FX6_BASE=4d9b30b4 node
// tools/test-ten384-fx6.js` runs the same checks against that commit's player-profile-v2.js (read with `git show`).
//
//   1 · Last 52 surfaces  the window splits Indoors out of its surfaces on the season table's court: the window's
//                         rows of a season = that season's row in the season table, surface by surface.
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

H.done();
}
main();
