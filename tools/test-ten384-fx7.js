// tools/test-ten384-fx7.js — TEN-384 fix round 7 (fx7, 2026-10-07): the independent review of the founder's r2 list.
//
// Every check runs on PINNED inputs (the committed fixture with constructed rows, the module's clock pinned), so it is
// identical in every checkout, CI included. Controls: `FX7_BASE=<sha> node tools/test-ten384-fx7.js` runs the same
// checks against that commit's player-profile-v2.js (read with `git show`). On 439b8605 item 1's ambiguous season and
// items 2 + 3 fail; on 5816003c (fx7, which re-split the season table) the table-unchanged and no-split checks fail.
//
//   1 · Last 52 = season table  (fx8, superseding fx7's version) THE WINDOW FOLLOWS THE SEASON TABLE, which is NOT
//                               touched: every season-table cell equals careerByYear's carve (the 439b8605 table). The
//                               window classifies each dated row so its season reproduces the table's split: a season
//                               with no indoor split splits nothing; else archive Indoor / Outdoor -> same event's
//                               archive court -> known events (Laver Cup / ATP Finals / Next Gen Finals indoor; Slams /
//                               United Cup / ATP Cup outdoor) -> the table's leftover indoor W–L. With the clock at 31 Dec
//                               2026 the window IS the 2026 season, so its surface rows must equal the table's 2026 row:
//                               (a) a season where United Cup 1–1 and Laver Cup 1–1 both fit the leftover indoor 1–1
//                               (fx6 left both under Hard — the 439b8605 control fails here), (b) a season whose
//                               careerByYear row carries NO indoor split (the 5816003c control re-split the TABLE here).
//                               A mid-season window is a subset: its season-S cells are <= the table's S cells.
//                               The roster-wide form (top-120, live stores) is probe-only: tools/probe-ten384-figures-
//                               roster.js sweep C — a deploy gate must not pin live data.
//   2 · Match shape             a per-set list LONGER than a decided result (Sinner, Monte Carlo 2024 SF: "1 - 2",
//                               4-6 6-3 4-6 1-0) is the result's shape (lost 1–2), its junk set trimmed, not a level
//                               2–2 dropped as "the set score on file is level".
//   3 · Copy                    "Splits not built for this player yet" — no trailing period on the Key insights empty
//                               state, the Draw tile, or the Draw modal.
//
// Run: node tools/test-ten384-fx7.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const ROOT = L.ROOT;
const BASE = process.env.FX7_BASE || null;
const CTRL_DIR = BASE ? fs.mkdtempSync(path.join(os.tmpdir(), 'fx7-control-' + BASE + '-')) : null;
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
console.log('TEN-384 fx7 — ' + (BASE ? 'CONTROL against ' + BASE : 'working tree'));

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
// 31 Dec 2026, noon UTC: the 364-day window opens on 1 Jan 2026, so the Last 52 rows ARE the 2026 season's rows
// (the fixture holds no row after March 2026 but the ones added below).
const YEAR_END = '2026-12-31T12:00:00.000Z';
function fxModule(opts) {
  opts = opts || {};
  const p = Object.assign({}, FX.profile, opts.profile || {});
  delete p.tournamentHistory;
  p.tournamentHistory = TI.mergeHistory ? TI.mergeHistory(FX.tournamentHistory) : FX.tournamentHistory;
  const m = L.loadPp2({
    src: PP2, now: opts.now || FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: opts.ch || FX.careerHistory },
    marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History,
    extra: Object.assign({ TournamentIdentity: TI }, opts.extra || {})
  });
  return { I: m.I, W: m.W, p };
}
function withState(I, patch, fn) {
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, patch);
  try { return fn(); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
const wl = c => (c && (c.won || c.lost) ? (c.won || 0) + '–' + (c.lost || 0) : '—');
const clone = o => JSON.parse(JSON.stringify(o));

// ── the constructed seasons ───────────────────────────────────────────────────
// Two team events with no price (so no archive court), each 1–1 on hard in 2026, as career-history writes them.
const mk = (date, tournament, opponent, won) => ({ year: '2026', surface: 'hard', level: 'atp', date, tournament, round: 'RR',
  opponent, result: won ? '2 - 0' : '0 - 2', won, sets: won ? [{ p: 6, o: 4 }, { p: 6, o: 3 }] : [{ p: 4, o: 6 }, { p: 3, o: 6 }],
  bestOf: 3, src: 'fixtures' });
const TEAM = [mk('2026-01-03', 'ATP United Cup', 'H. Hurkacz', true), mk('2026-01-04', 'ATP United Cup', 'A. Rublev', false),
  mk('2026-09-19', 'ATP Laver Cup', 'J. Fonseca', true), mk('2026-09-20', 'ATP Laver Cup', 'C. Alcaraz', false)];
const plus = (a, w, l) => ({ won: (a ? a.won : 0) + w, lost: (a ? a.lost : 0) + l });
function seasons(kind) {
  const cby = clone(FX.profile.careerByYear);
  const y = cby.find(r => String(r.year) === '2026');
  // the season record takes the four team rubbers (+2–2 on hard, ATP); the archive holds Dallas indoor 2–1
  ['total', 'hard'].forEach((k) => { y[k] = plus(y[k], 2, 2); y.atp[k] = plus(y.atp[k], 2, 2); });
  if (kind === 'ambiguous') {
    // API-Tennis's court type counts the Laver Cup indoor: Dallas 2–1 + Laver Cup 1–1 = 3–2. After the archive's
    // Dallas 2–1, United Cup 1–1 and Laver Cup 1–1 BOTH fit the leftover 1–1.
    const ind = { total: { won: 3, lost: 2 }, clay: null, hard: { won: 3, lost: 2 }, grass: null };
    y.indoor = clone(ind); y.atp.indoor = clone(ind);
  } else {
    // the season row carries no indoor split at all (FAA 2025, Shelton 2025: Indoors "—")
    y.indoor = null; y.atp.indoor = null;
  }
  return cby;
}
function seasonTableRow(I, p, year, tier) {
  const t = withState(I, { key: p.key, careerTab: 'record', careerScope: 'career', careerTier: tier || 'all', careerDrill: null },
    () => T(I.renderCareerModal(p, {})));
  const i = t.indexOf('Year Total Clay Hard Indoors Grass');
  assert(i >= 0, 'no season table');
  const m = new RegExp('\\b' + year + ' (\\S+) (\\S+) (\\S+) (\\S+) (\\S+)').exec(t.slice(i));
  assert(m, 'no ' + year + ' row in the season table');
  const c = s => (s === '—' ? '—' : s.replace('/', '–'));
  return { total: c(m[1]), clay: c(m[2]), hard: c(m[3]), indoors: c(m[4]), grass: c(m[5]) };
}
function last52Row(I, p, tier) {
  const g = I.last52GridCells(p, tier || 'all');
  return { total: wl(g.total), clay: wl(g.cells.clay), hard: wl(g.cells.hard), indoors: wl(g.cells.indoors), grass: wl(g.cells.grass) };
}
const fmt = r => ['hard', 'clay', 'grass', 'indoors'].map(s => s[0].toUpperCase() + s.slice(1) + ' ' + r[s]).join(' · ') + ' · total ' + r.total;

function main() {
// ════════════════════════════════════════════════════════════════════════════
// 1 · the Last 52 surface rows = the season table's surfaces inside the window
// ════════════════════════════════════════════════════════════════════════════
['ambiguous', 'nosplit'].forEach((kind) => {
  const label = kind === 'ambiguous'
    ? 'a season where United Cup 1–1 and Laver Cup 1–1 both fit the indoor 1–1'
    : 'a season whose careerByYear row carries no indoor split';
  ['all', 'atp'].forEach((tier) => {
    H.check(`1 · ${label} [${tier}]: the Last 52 surface rows = the season table's 2026 row, surface by surface`, () => {
      const { I, p } = fxModule({ now: YEAR_END, ch: FX.careerHistory.concat(TEAM), profile: { careerByYear: seasons(kind) } });
      assert.strictEqual(I.last52Cutoff(), '2026-01-01', 'the window does not open on 1 Jan 2026');
      const win = last52Row(I, p, tier), tab = seasonTableRow(I, p, '2026', tier);
      ['hard', 'clay', 'grass', 'indoors', 'total'].forEach((s) => {
        assert.strictEqual(win[s], tab[s], `${s}: Last 52 ${win[s]}, season table ${tab[s]} — Last 52 ${fmt(win)} | table ${fmt(tab)}`);
      });
      return fmt(win);
    });
  });
});
H.check('1 · the classifier: Laver Cup is a known indoor event, United Cup a known outdoor one; Dallas keeps its archive court', () => {
  const { I, p } = fxModule({ now: YEAR_END, ch: FX.careerHistory.concat(TEAM), profile: { careerByYear: seasons('ambiguous') } });
  const sp = I.calSpine(p), c = I.seasonCourts(p);
  const courtOf = ev => [...new Set(sp.map((r, i) => (r.event === ev && r.year === '2026' ? String(c[i]) : null)).filter(Boolean))].join('/');
  assert.strictEqual(courtOf('Laver Cup'), 'Indoor', 'Laver Cup ' + courtOf('Laver Cup'));
  assert.strictEqual(courtOf('United Cup'), 'Outdoor', 'United Cup ' + courtOf('United Cup'));
  assert.strictEqual(courtOf('Dallas'), 'Indoor', 'Dallas ' + courtOf('Dallas'));
  return 'Laver Cup Indoor · United Cup Outdoor · Dallas Indoor';
});
H.check('1 · ambiguous season: Laver Cup sits under Indoors (3–2) and United Cup under Hard (15–7) on BOTH sides', () => {
  const { I, p } = fxModule({ now: YEAR_END, ch: FX.careerHistory.concat(TEAM), profile: { careerByYear: seasons('ambiguous') } });
  const win = last52Row(I, p), tab = seasonTableRow(I, p, '2026');
  assert.strictEqual(win.indoors, '3–2', 'Last 52 Indoors ' + win.indoors);
  assert.strictEqual(win.hard, '15–7', 'Last 52 Hard ' + win.hard);
  assert.strictEqual(tab.indoors, '3–2', 'season Indoors ' + tab.indoors);
  return 'Last 52 ' + fmt(win);
});
H.check('1 · no-split season: the window splits nothing either — Indoors "—", Hard 18–9 (Dallas\'s archive Indoor 2–1 stays under Hard, as in the table)', () => {
  const { I, p } = fxModule({ now: YEAR_END, ch: FX.careerHistory.concat(TEAM), profile: { careerByYear: seasons('nosplit') } });
  const win = last52Row(I, p), tab = seasonTableRow(I, p, '2026');
  assert.strictEqual(tab.indoors, '—', 'season Indoors ' + tab.indoors + ' (the season table was re-split)');
  assert.strictEqual(tab.hard, '18–9', 'season Hard ' + tab.hard + ' (the season table was re-split)');
  assert.strictEqual(win.indoors, '—', 'Last 52 Indoors ' + win.indoors);
  assert.strictEqual(win.hard, '18–9', 'Last 52 Hard ' + win.hard);
  const sp = I.calSpine(p), c = I.seasonCourts(p);
  const split = sp.filter((r, i) => r.year === '2026' && c[i] === 'Indoor').map(r => r.event);
  assert.deepStrictEqual(split, [], '2026 rows called Indoor: ' + split.join(', '));
  return 'window + table ' + fmt(win);
});
// The 439b8605 season table, computed here from careerByYear (not through the module), so a module that re-splits the
// table — 5816003c did, for every dated season — fails.
function carve(s, i) {
  if (!s) return null;
  if (!i) return s;
  const w = (s.won || 0) - (i.won || 0), l = (s.lost || 0) - (i.lost || 0);
  return w + l > 0 ? { won: w, lost: l } : null;
}
function expectedRow(y, tier) {
  const t = tier === 'all' ? y : y[tier];
  if (!t) return null;
  const ind = t.indoor || null;
  return { total: wl(t.total), clay: wl(carve(t.clay, ind && ind.clay)), hard: wl(carve(t.hard, ind && ind.hard)),
    grass: wl(carve(t.grass, ind && ind.grass)), indoors: wl(ind && ind.total) };
}
H.check('1 · the season table is unchanged: every season row and tier = careerByYear\'s own carve (the 439b8605 table), both constructed seasons', () => {
  let n = 0;
  ['ambiguous', 'nosplit'].forEach((kind) => {
    const { I, p } = fxModule({ now: YEAR_END, ch: FX.careerHistory.concat(TEAM), profile: { careerByYear: seasons(kind) } });
    p.careerByYear.filter(y => y && y.total).forEach((y) => ['all', 'atp', 'chitf'].forEach((tier) => {
      const want = expectedRow(y, tier);
      if (!want || (tier !== 'all' && !y[tier])) return;
      const got = seasonTableRow(I, p, String(y.year), tier);
      ['total', 'hard', 'clay', 'grass', 'indoors'].forEach((s) => {
        assert.strictEqual(got[s], want[s], `${kind} ${y.year} [${tier}] ${s}: table ${got[s]}, careerByYear ${want[s]}`);
      });
      n++;
    }));
  });
  return n + ' season-tier rows = careerByYear';
});
H.check('1 · a mid-season window (clock 30 Jun 2027, window from 1 Jul 2026) holds a SUBSET of 2026: Laver Cup 1–1 under Indoors, <= the table\'s 3–2', () => {
  const { I, p } = fxModule({ now: '2027-06-30T12:00:00.000Z', ch: FX.careerHistory.concat(TEAM), profile: { careerByYear: seasons('ambiguous') } });
  const cut = I.last52Cutoff();
  assert.strictEqual(cut, '2026-07-01', 'cut-off ' + cut);
  const tab = seasonTableRow(I, p, '2026');
  const sub = {};
  ['hard', 'clay', 'grass', 'indoors'].forEach((s) => {
    const c = { won: 0, lost: 0 };
    I.drillRows(p, s, '2026', cut).forEach((r) => { c[r.won ? 'won' : 'lost']++; });
    sub[s] = c;
    const t = tab[s] === '—' ? [0, 0] : tab[s].split('–').map(Number);
    assert(c.won <= t[0] && c.lost <= t[1], `${s}: window's 2026 rows ${wl(c)} exceed the table's ${tab[s]}`);
  });
  assert.strictEqual(wl(sub.indoors), '1–1', 'window 2026 Indoors ' + wl(sub.indoors));
  return 'window 2026: ' + ['hard', 'clay', 'grass', 'indoors'].map(s => s + ' ' + wl(sub[s])).join(' · ') + ' | table ' + fmt(tab);
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · a per-set list longer than the result: the result decides, the junk set is trimmed
// ════════════════════════════════════════════════════════════════════════════
const SIN = { year: '2024', surface: 'clay', level: 'atp', date: '2024-04-13', tournament: 'Monte Carlo', round: 'Semi-finals',
  opponent: 'S. Tsitsipas', result: '1 - 2', won: false, bestOf: 3,
  sets: [{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 4, o: 6 }, { p: 1, o: 0 }], src: 'fixtures' };
H.check('2 · "1 - 2" with 4-6 6-3 4-6 1-0 on file is a Bo3 lost 1–2 (not a level 2–2 dropped as "level"); games 14–15', () => {
  const { I, p } = fxModule({ ch: FX.careerHistory.concat([SIN]) });
  const base = fxModule();
  const a = I.lineCoverage(p, 'bo3', 'all'), b = base.I.lineCoverage(base.p, 'bo3', 'all');
  assert.strictEqual(a.n, b.n + 1, 'Bo3 All ' + b.n + ' -> ' + a.n);
  const row = c => c.groups.find(g => g.title === 'Match shape').rows.find(r => r.label === 'lost 1–2');
  assert.strictEqual(row(a).hit, row(b).hit + 1, 'lost 1–2 ' + row(b).hit + ' -> ' + row(a).hit);
  const sum = a.groups.find(g => g.title === 'Match shape').rows.reduce((x, r) => x + r.hit, 0);
  assert.strictEqual(sum, a.n, 'the shapes sum to ' + sum + ', not ' + a.n);
  assert.strictEqual(a.withGames, b.withGames + 1, 'its trimmed games did not enter the games lines');
  const r = I.calSpine(p).find(x => x.date === SIN.date);
  const sc = I.lineSetCount(r);
  assert.deepStrictEqual([sc.w, sc.l], [1, 2], 'set count ' + sc.w + '–' + sc.l);
  assert.deepStrictEqual(I.lineGames(r, sc.sets), { f: 14, a: 15 }, 'games ' + JSON.stringify(I.lineGames(r, sc.sets)));
  // the note's "excluded because the set score on file is level" count does not take it
  assert.strictEqual(a.unshaped || 0, b.unshaped || 0, 'counted as level: unshaped ' + (b.unshaped || 0) + ' -> ' + (a.unshaped || 0));
  return `Bo3 ${b.n} -> ${a.n}, lost 1–2 ${row(b).hit} -> ${row(a).hit}, games lines ${b.withGames} -> ${a.withGames}`;
});
H.check('2 · junk mid-list ("1 - 2", 6-3 2-6 0-1 4-6, Walton Paris 2025): the 0-1 is dropped, games come off 6-3 2-6 4-6 (12–15)', () => {
  const mid = Object.assign({}, SIN, { date: '2024-04-14', opponent: 'Q. Midjunk', sets: [{ p: 6, o: 3 }, { p: 2, o: 6 }, { p: 0, o: 1 }, { p: 4, o: 6 }] });
  const { I, p } = fxModule({ ch: FX.careerHistory.concat([mid]) });
  const r = I.calSpine(p).find(x => x.date === mid.date);
  const sc = I.lineSetCount(r);
  assert.deepStrictEqual([sc.w, sc.l, !!sc.partial], [1, 2, false], 'set count ' + JSON.stringify(sc));
  assert.deepStrictEqual(I.lineGames(r, sc.sets), { f: 12, a: 15 }, 'games ' + JSON.stringify(I.lineGames(r, sc.sets)));
  return 'lost 1–2 · games 12–15';
});
H.check('2 · a longer list whose complete sets do not make up the result ("1 - 2", 4-6 4-6 7-6 6-6 4-6) keeps the result\'s count with no games', () => {
  const odd = Object.assign({}, SIN, { date: '2024-04-14', opponent: 'Q. Oddrow',
    sets: [{ p: 4, o: 6 }, { p: 4, o: 6 }, { p: 7, o: 6 }, { p: 6, o: 6 }, { p: 4, o: 6 }] });
  const { I, p } = fxModule({ ch: FX.careerHistory.concat([odd]) });
  const base = fxModule();
  const a = I.lineCoverage(p, 'bo3', 'all'), b = base.I.lineCoverage(base.p, 'bo3', 'all');
  assert.strictEqual(a.n, b.n + 1, 'Bo3 All ' + b.n + ' -> ' + a.n);
  assert.strictEqual(a.withGames, b.withGames, 'its untrimmable games entered the games lines');
  return `Bo3 ${b.n} -> ${a.n}; games lines stay on ${a.withGames}`;
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · "Splits not built for this player yet": one wording, no period, in all three places
// ════════════════════════════════════════════════════════════════════════════
H.check('3 · no splits entry: Key insights, the Draw tile and the Draw modal print "Splits not built for this player yet" (no period)', () => {
  // TEN-391: his file answered "none" -> the host stores NULL for him (the only "not built" state)
  const { I, p } = fxModule({ extra: { careerSplits: { '999999': { career: {} }, [FX.key]: null } } });
  const WANT = 'Splits not built for this player yet';
  const ins = I.insightsEmptyText(p);
  assert.strictEqual(ins, WANT, 'Key insights "' + ins + '"');
  const ctx = { rows: I.ledgerMatches(p) };
  const tile = I.boxValues(p, ctx).splits.support;
  assert.strictEqual(tile, WANT, 'Draw tile "' + tile + '"');
  const modal = T(I.renderSplitsModal(p)).trim();
  assert.strictEqual(modal, WANT, 'Draw modal "' + modal + '"');
  return 'insights / tile / modal "' + WANT + '"';
});
}

main();
H.done();
