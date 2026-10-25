#!/usr/bin/env node
// "How it plays" (founder brief round 2, item 2.1) — build-how-it-plays.js + how-it-plays-history.json.
// Fixture checks for each formula, the partial-stats guard, completion, lineage (2752 never feeds 14763), the
// best-of-three / indoor split, the floor; then a committed-data control (Almaty past n = 53 from the committed box
// scores + history file). tools/test-how-it-plays-mutants.js runs this against mutated builders: every check here
// must go red when the behaviour it locks is reverted. HOWPLAYS_BUILDER points the suite at a mutated copy.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const H = require(process.env.HOWPLAYS_BUILDER || path.join(ROOT, 'build-how-it-plays.js'));

let pass = 0, fail = 0, skip = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function near(a, b, what) { if (a == null || Math.abs(a - b) > 1e-9) throw new Error(`${what}: got ${a}, want ${b}`); }

// ── fixture factories ────────────────────────────────────────────────────────────────────────────────────────────
function sackRow(o) {
  const r = { tourney_id: o.id || '2024-9410', tourney_name: o.name || 'Almaty', surface: o.surface || 'Hard', tourney_level: o.level || 'A',
    tourney_date: o.date || '20241014', best_of: String(o.bo || 3), score: o.score == null ? '6-4 6-4' : o.score,
    winner_name: o.w || 'Ann Alpha', loser_name: o.l || 'Bob Bravo' };
  const side = (p, s) => { r[p + 'ace'] = s.ace; r[p + 'svpt'] = s.svpt; r[p + '1stIn'] = s.fi; r[p + '1stWon'] = s.fw; r[p + '2ndWon'] = s.sw; r[p + 'SvGms'] = s.sg; r[p + 'bpSaved'] = s.bps; r[p + 'bpFaced'] = s.bpf; };
  side('w_', o.ws || { ace: 6, svpt: 60, fi: 40, fw: 30, sw: 10, sg: 10, bps: 1, bpf: 2 });
  side('l_', o.ls || { ace: 2, svpt: 70, fi: 42, fw: 28, sw: 12, sg: 10, bps: 3, bpf: 6 });
  return r;
}
// cumulative game scores for a set ending [a, b] (alternating, so a 7-6 set passes 6-6)
function setGames(a, b) {
  const g = []; let x = 0, y = 0, t = 0;
  while (x < a || y < b) { if ((t++ % 2 === 0 && x < a) || y >= b) x++; else y++; g.push({ score: `${x} - ${y}` }); }
  return { games: g };
}
let ekSeq = 1000;
function box(o) {
  const sides = o.sides || [{ sg: [9, 10], f1: [30, 40], f2: [10, 20], ace: 5 }, { sg: [8, 10], f1: [28, 41], f2: [9, 22], ace: 3 }];
  const ms = {};
  sides.forEach((s, i) => { ms['p' + (i + 1)] = { 'Service:Aces': s.ace, raw: { 'Games:Service games won': { won: s.sg[0], total: s.sg[1] }, 'Service:1st serve points won': { won: s.f1[0], total: s.f1[1] }, 'Service:2nd serve points won': { won: s.f2[0], total: s.f2[1] } } }; });
  const sets = (o.sets || [[6, 4], [6, 4]]).map(([a, b]) => setGames(a, b));
  const e = { p1: o.p1 || 'A. Alpha', p2: o.p2 || 'B. Bravo', sets, matchStats: ms, stats: {}, t: o.t || 'atp', d: o.d || '2025-10-14', tn: o.tn || 'ATP Almaty', tk: o.tk || 11851 };
  if (o.q !== undefined) e.q = o.q;
  return [String(o.ek || ekSeq++), e];
}
function td(p1, p2, date, comment) { const s = n => n.split(' ').slice(1).join(' ') + ' ' + n.split(' ')[0]; return { date, winner: s(p1), loser: s(p2), comment: comment || 'Completed', court: 'Indoor', surface: 'Hard', tournament: 'x' }; }
function build(entries, extra) {
  const week = {}; const rows = { 2025: [], 2026: [] };
  for (const [ek, e] of entries) { week[ek] = e; const y = e.d.slice(0, 4); if (e._td !== null && rows[y]) rows[y].push(td(e.p1, e.p2, e.d, e._td)); delete e._td; }
  return H.buildHowItPlays(Object.assign({
    season: 2026,
    history: { seasons: {}, editions: [] },
    weeks: [week], qFlags: {},
    surfaces: { surfaces: { 11851: 'hard', 3669: 'hard', 14763: 'hard', 2752: 'clay', 1217: 'hard', 2794: 'hard', 2793: 'hard', 1223: 'hard', 999: 'hard' },
      courts: { 11851: 'indoor', 3669: 'indoor', 14763: 'indoor', 2752: 'outdoor', 1217: 'outdoor', 2794: 'indoor', 2793: 'indoor', 1223: 'outdoor' } },
    progression: null, matches: [], tdRows: rows,
  }, extra || {}));
}
const withTd = (pair, comment) => { pair[1]._td = comment === undefined ? 'Completed' : comment; return pair; };

console.log('How it plays — formulas, guard, lineage, split, floor\n');

// ── 1 · formulas (Sackmann rows) ─────────────────────────────────────────────────────────────────────────────────
console.log('1 · formulas');
check('hold = Σ(SvGms − (bpFaced − bpSaved)) / ΣSvGms', () => {
  const r = H.sackmannRec(sackRow({}));
  // w: 10 − (2 − 1) = 9 · l: 10 − (6 − 3) = 7
  eq([r.stats.held, r.stats.sg], [16, 20], 'held/sg');
  near(H.metricsOf(H.addRec(H.emptySums(), r)).hold.value, 0.8, 'hold');
});
check('1st won = Σ1stWon / Σ1stIn', () => {
  const m = H.metricsOf(H.addRec(H.emptySums(), H.sackmannRec(sackRow({})))).firstServeWon;
  eq([m.num, m.den], [58, 82], '1st'); near(m.value, 58 / 82, '1st value');
});
check('2nd won = Σ2ndWon / Σ(svpt − 1stIn), double faults inside', () => {
  const m = H.metricsOf(H.addRec(H.emptySums(), H.sackmannRec(sackRow({})))).secondServeWon;
  eq([m.num, m.den], [22, 48], '2nd'); // (60−40) + (70−42)
});
check('aces per match counts both players', () => {
  let S = H.emptySums(); S = H.addRec(S, H.sackmannRec(sackRow({}))); S = H.addRec(S, H.sackmannRec(sackRow({})));
  const m = H.metricsOf(S).acesPerMatch; eq([m.num, m.den, m.n], [16, 2, 2], 'aces'); near(m.value, 8, 'aces/match');
});
check('tiebreaks per set: 7-6 / 6-7 sets over completed sets', () => {
  const m = H.metricsOf(H.addRec(H.emptySums(), H.sackmannRec(sackRow({ score: '7-6(4) 6-7(5) 7-5' })))).tiebreaksPerSet;
  eq([m.num, m.den, m.n], [2, 3, 1], 'tb');
});
check('a match tiebreak (a set side >= 10) leaves the tiebreak metric only', () => {
  let S = H.addRec(H.emptySums(), H.sackmannRec(sackRow({ score: '6-4 4-6 [10-8]' })));
  const r = H.sackmannRec(sackRow({ score: '6-4 4-6 10-8' }));
  S = H.addRec(S, r);
  const M = H.metricsOf(S);
  eq([M.tiebreaksPerSet.n, M.tiebreaksPerSet.den, S.nonStd, M.hold.n], [1, 2, 1, 2], 'tb n / sets / nonStd / hold n');
});
check('retirement / walkover rows are out (completed matches only)', () => {
  let S = H.emptySums();
  for (const score of ['6-4 2-1 RET', 'W/O', '']) S = H.addRec(S, H.sackmannRec(sackRow({ score })));
  eq([S.m, S.incomplete], [0, 3], 'm/incomplete');
});

// ── 2 · box-score side and the partial-stats guard ───────────────────────────────────────────────────────────────
console.log('2 · box scores and the partial-stats guard');
check('box score: held = Service games won, 1st/2nd from raw, aces both sides', () => {
  const r = H.boxRec(box({})[1], 'Completed');
  eq(r.stats, { held: 17, sg: 20, fw: 58, fi: 81, sw: 19, sp: 42, ace: 8 }, 'stats');
});
check('tiebreak set in the log = a set that reached 6-6 (the tiebreak row itself is unreliable, TEN-318)', () => {
  const e = box({ sets: [[7, 6], [4, 6], [6, 3]] })[1];
  e.sets[0].games[e.sets[0].games.length - 1].score = '7 - 4';   // the feed's tiebreak row carries points, not games
  const r = H.boxRec(e, 'Completed');
  eq(r.sets.map(s => s.tb), [true, false, false], 'tb flags');
});
check('guard: log games − service games on record >= 3 → partial (excluded and counted)', () => {
  // [6,4],[6,4] = 20 regular games; service games on record 17 → gap 3
  const r = H.boxRec(box({ sides: [{ sg: [8, 9], f1: [20, 30], f2: [5, 10], ace: 1 }, { sg: [6, 8], f1: [20, 30], f2: [5, 10], ace: 1 }] })[1], 'Completed');
  eq(r.partial, true, 'partial');
});
check('guard boundary: a gap of 2 is not partial', () => {
  const r = H.boxRec(box({ sides: [{ sg: [8, 9], f1: [20, 30], f2: [5, 10], ace: 1 }, { sg: [6, 9], f1: [20, 30], f2: [5, 10], ace: 1 }] })[1], 'Completed');
  eq(r.partial, false, 'partial');
});
check('guard is carried in the output: event and slice excludedPartial, metrics unaffected', () => {
  const full = withTd(box({ d: '2025-10-14' }));
  const part = withTd(box({ d: '2025-10-15', p1: 'C. Charlie', p2: 'D. Delta', sides: [{ sg: [5, 6], f1: [99, 99], f2: [9, 9], ace: 40 }, { sg: [5, 6], f1: [99, 99], f2: [9, 9], ace: 40 }] }));
  const o = build([full, part]);
  const e = o.events['11851'];
  eq([e.past.n, e.past.excludedPartial, e.excludedPartial, e.past.metrics.acesPerMatch.num], [1, 1, 1, 8], 'n / partial / event partial / aces');
});

// ── 3 · completion status for box scores ─────────────────────────────────────────────────────────────────────────
console.log('3 · completion');
check('Tennis-Data "Retired" keeps a box score out', () => {
  const o = build([withTd(box({})), withTd(box({ p1: 'C. Charlie', p2: 'D. Delta' }), 'Retired')]);
  eq([o.events['11851'].past.n, o.events['11851'].past.incompleteExcluded], [1, 1], 'n / incomplete');
});
check('no Tennis-Data row: per-set service games decide; nothing to read → unknown, out, counted', () => {
  const a = withTd(box({}), null);
  a[1].stats = { 1: { p1: { raw: { 'Games:Service games won': { won: 5, total: 5 } } }, p2: { raw: { 'Games:Service games won': { won: 4, total: 5 } } } },
                 2: { p1: { raw: { 'Games:Service games won': { won: 4, total: 5 } } }, p2: { raw: { 'Games:Service games won': { won: 3, total: 5 } } } } };
  const b = withTd(box({ p1: 'C. Charlie', p2: 'D. Delta' }), null);
  const o = build([a, b]);
  eq([o.events['11851'].past.n, o.events['11851'].past.statusUnknown], [1, 1], 'n / unknown');
  eq(H.completedFromSets([[6, 4], [5, 3]]), null, 'an unfinished set is not complete');
  eq(H.completedFromSets([[6, 4], [3, 6]]), null, 'one set all is not complete');
});

// ── 4 · population: main draw, best-of-three, indoor/outdoor split ───────────────────────────────────────────────
console.log('4 · population and the indoor / outdoor split');
check('qualifying never enters (isQualifying)', () => {
  const o = build([withTd(box({})), withTd(box({ p1: 'C. Charlie', p2: 'D. Delta', q: true }))]);
  eq([o.events['11851'].past.n, o.counts.qualifying], [1, 1], 'n / qualifying');
});
check('Slams, Finals and Next Gen are out of every slice (best-of-three only)', () => {
  const o = build([withTd(box({ tk: 1217, tn: 'ATP US Open', p1: 'E. Echo', p2: 'F. Fox' })), withTd(box({ tk: 2794, tn: 'ATP Finals - Turin', p1: 'G. Golf', p2: 'H. Hotel' })),
    withTd(box({ tk: 2793, tn: 'ATP Next Gen Finals - Jeddah', p1: 'I. India', p2: 'J. Juliet' })), withTd(box({}))]);
  eq([Object.keys(o.events), o.counts.excludedEvent, o.baseline.outdoorHard ? o.baseline.outdoorHard.n : 0, o.baseline.indoorHard.n], [['11851'], 3, 0, 1], 'events / excluded / outdoor n / indoor n');
});
check('Sackmann population: levels A/M, best_of 3, no Finals / Next Gen / team events', () => {
  eq([sackRow({}), sackRow({ level: 'G' }), sackRow({ bo: 5 }), sackRow({ level: 'F', name: 'Tour Finals' }), sackRow({ id: '2019-7696', name: 'NextGen Finals' }), sackRow({ name: 'Laver Cup' }), sackRow({ name: 'Atp Cup' }), sackRow({ level: 'M', name: 'Paris Masters' })]
    .map(H.excludedSackmannRow), [false, true, true, true, true, true, true, false], 'excluded');
});
check('baseline split: indoor keys → indoorHard, outdoor → outdoorHard, unknown court → neither', () => {
  const o = build([withTd(box({})), withTd(box({ tk: 1223, tn: 'ATP Tokyo', p1: 'K. Kilo', p2: 'L. Lima' })), withTd(box({ tk: 999, tn: 'ATP Nowhere', p1: 'M. Mike', p2: 'N. Nov' }))]);
  eq([o.baseline.indoorHard.n, o.baseline.outdoorHard.n, o.events['11851'].baseline, o.events['1223'].baseline, o.events['999'].baseline, o.events['999'].indoor], [1, 1, 'indoorHard', 'outdoorHard', null, null], 'split');
  eq(o.unresolved.some(u => u.key === '999'), true, 'unknown court listed as unresolved');
});
check('baseline seasons = the 10 completed seasons before the current one; Sackmann sums by court', () => {
  const ss = H.addRec(H.emptySums(), H.sackmannRec(sackRow({})));
  const hist = { seasons: { 2015: { indoorHard: ss, outdoorHard: ss }, 2016: { indoorHard: ss, outdoorHard: H.emptySums() } }, editions: [] };
  const o = build([withTd(box({}))], { history: hist });
  eq([o.seasons.baseline, o.baseline.indoorHard.years, o.baseline.indoorHard.n, o.baseline.outdoorHard], [[2016, 2025], [2016, 2025], 2, null], 'window (2015 out; an empty baseline is null, not 0)');
});

// ── 5 · lineage: same venue only ─────────────────────────────────────────────────────────────────────────────────
console.log('5 · lineage');
const ed = (o) => ({ id: o.id, season: o.season, name: o.name, surface: o.surface || 'Hard', indoor: o.indoor === undefined ? true : o.indoor, sums: H.addRec(H.emptySums(), H.sackmannRec(sackRow({}))) });
check('old clay Lyon (key 2752 box scores, Sackmann "Lyon" clay) never feeds Lyon 2026 (key 14763)', () => {
  const lyonClay = withTd(box({ tk: 2752, tn: 'Lyon', d: '2025-05-20', p1: 'O. Oscar', p2: 'P. Papa' }));
  const hist = { seasons: {}, editions: [ed({ id: '2024-7694', season: 2024, name: 'Lyon', surface: 'Clay', indoor: false })] };
  const prog = { tournaments: { Lyon: { feedName: 'Lyon (France) - Qualification', players: [], matches: [] } } };
  const o = build([lyonClay], { history: hist, progression: prog, matches: [{ tour: 'ATP Lyon', tournamentKey: '14763' }] });
  eq([!!o.events['14763'], o.events['14763'] && o.events['14763'].past, o.events['2752']], [true, null, undefined], '14763 present, no past; clay key not an event');
});
check('a same-name edition on another surface never links, whatever its court', () => {
  const hist = { seasons: {}, editions: [ed({ id: '2024-0002', season: 2024, name: 'Lyon', surface: 'Clay', indoor: true })] };
  const o = build([], { history: hist, progression: { tournaments: { Lyon: { players: [], matches: [] } } }, matches: [{ tour: 'ATP Lyon', tournamentKey: '14763' }] });
  eq(o.events['14763'].past, null, 'past');
});
check('a same-name hard edition whose court disagrees is not the same venue', () => {
  const hist = { seasons: {}, editions: [ed({ id: '2024-0001', season: 2024, name: 'Lyon', indoor: false })] };
  const prog = { tournaments: { Lyon: { players: [], matches: [] } } };
  const o = build([], { history: hist, progression: prog, matches: [{ tour: 'ATP Lyon', tournamentKey: '14763' }] });
  eq([o.events['14763'].past, o.lineage.courtMismatch.length], [null, 1], 'past / mismatch');
});
check('Almaty takes Sackmann "Almaty", never "Astana" / "Nur-Sultan" (same ATP id 9410)', () => {
  const hist = { seasons: {}, editions: [ed({ id: '2024-9410', season: 2024, name: 'Almaty' }), ed({ id: '2023-9410', season: 2023, name: 'Astana' }), ed({ id: '2020-9410', season: 2020, name: 'Nur-Sultan' })] };
  const o = build([withTd(box({}))], { history: hist });
  eq([o.events['11851'].past.years, o.events['11851'].past.sources.sackmann, o.events['11851'].past.n], [[2024, 2025], [2024], 2], 'Almaty');
});
check('Brussels takes nothing from Antwerp', () => {
  const hist = { seasons: {}, editions: [ed({ id: '2024-7485', season: 2024, name: 'Antwerp' })] };
  const o = build([withTd(box({ tk: 3669, tn: 'Brussels' }))], { history: hist });
  eq([o.events['3669'].past.years, o.events['3669'].past.sources.sackmann], [[2025], []], 'Brussels');
});
check('a venue name two hard keys share is ambiguous → no Sackmann lineage', () => {
  const hist = { seasons: {}, editions: [ed({ id: '2024-9410', season: 2024, name: 'Almaty' })] };
  const o = build([withTd(box({})), withTd(box({ tk: 3669, tn: 'Almaty', p1: 'Q. Quebec', p2: 'R. Romeo' }))], { history: hist });
  eq([o.events['11851'].past.sources.sackmann, o.lineage.ambiguousNames], [[], ['almaty']], 'ambiguous');
});

// ── 6 · current edition (progression) ────────────────────────────────────────────────────────────────────────────
console.log('6 · current edition');
const progEv = () => ({
  players: [
    { name: 'A. Alpha', playerKey: '1', rounds: [{ round: 'R1', metrics: { svHold: { won: 9, total: 10 }, aces: 5, ret1: { won: 13, total: 41 }, ret2: { won: 12, total: 22 } } }] },
    { name: 'B. Bravo', playerKey: '2', rounds: [{ round: 'R1', metrics: { svHold: { won: 8, total: 10 }, aces: 3, ret1: { won: 10, total: 40 }, ret2: { won: 10, total: 20 } } }] },
  ],
  matches: [
    { eventKey: '77', round: 'R1', status: 'finished', date: '2026-10-20', score: [[7, 6], [6, 4]], p1: { playerKey: '1' }, p2: { playerKey: '2' } },
    { eventKey: '78', round: 'R2', status: 'walkover', date: '2026-10-21', score: [], p1: { playerKey: '1' }, p2: { playerKey: '3' } },
  ],
});
check('progression: 1st-serve counts are the opponent\'s ret1 inverted; walkover out; TB from the set score', () => {
  const o = build([], { progression: { tournaments: { Almaty: progEv() } }, matches: [{ tour: 'ATP Almaty', tournamentKey: '11851' }] });
  const c = o.events['11851'].current;
  eq([c.n, c.metrics.firstServeWon.num, c.metrics.firstServeWon.den, c.metrics.secondServeWon.num, c.metrics.secondServeWon.den, c.metrics.tiebreaksPerSet.num, c.metrics.tiebreaksPerSet.den, c.incompleteExcluded],
     [1, 30 + 28, 40 + 41, 10 + 10, 20 + 22, 1, 2, 1], 'current');
});
check('progression row already in the box scores counts once (box score wins)', () => {
  const b = withTd(box({ ek: 77, d: '2026-10-20' }));
  const o = build([b], { progression: { tournaments: { Almaty: progEv() } }, matches: [{ tour: 'ATP Almaty', tournamentKey: '11851' }] });
  eq([o.events['11851'].current.n, o.events['11851'].current.sources.boxscore, o.events['11851'].past], [1, [2026], null], 'once');
});

// ── 7 · floor carried, never applied ─────────────────────────────────────────────────────────────────────────────
console.log('7 · floor');
check('floor = 15 is in the output and a below-floor slice still carries its numbers', () => {
  const o = build([withTd(box({}))]);
  eq([o.floor, H.SAMPLE_FLOOR, o.events['11851'].past.n], [15, 15, 1], 'floor / n');
  near(o.events['11851'].past.metrics.hold.value, 17 / 20, 'below-floor value kept');
});

// ── 8 · committed-data control ───────────────────────────────────────────────────────────────────────────────────
console.log('8 · committed data');
const histPath = path.join(ROOT, 'how-it-plays-history.json');
const arch = path.join(ROOT, 'boxscore-archive');
let real = null;
if (!fs.existsSync(histPath) || !fs.existsSync(arch)) { skip++; console.log('  SKIP  committed-data control — history file or box-score archive absent'); }
else {
  const weeks = fs.readdirSync(arch).filter(f => /^265-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort().map(f => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(arch, f)))));
  const tdRows = {}; for (const y of [2025, 2026]) tdRows[y] = H.readCsv(path.join(ROOT, 'odds-archive', y + '.csv'));
  real = H.buildHowItPlays({ season: 2026, history: JSON.parse(fs.readFileSync(histPath, 'utf8')), weeks, qFlags: JSON.parse(fs.readFileSync(path.join(ROOT, 'boxscore-qualifying.json'), 'utf8')).q,
    surfaces: JSON.parse(fs.readFileSync(path.join(ROOT, 'tournament-surfaces.json'), 'utf8')), progression: null, matches: [{ tour: 'ATP Lyon', tournamentKey: '14763' }], tdRows });
  check('Almaty (11851) past: 2024 Sackmann + 2025 box scores, n = 53, hold 1015/1219', () => {
    const p = real.events['11851'].past;
    eq([p.years, p.sources.sackmann, p.sources.boxscore, p.n, p.metrics.hold.num, p.metrics.hold.den, real.events['11851'].baseline], [[2024, 2025], [2024], [2025], 53, 1015, 1219, 'indoorHard'], 'Almaty');
  });
  check('Brussels (3669) past: 2025 only, n = 25', () => {
    const p = real.events['3669'].past; eq([p.years, p.n, p.sources.sackmann], [[2025], 25, []], 'Brussels');
  });
  check('Lyon (14763) has no past edition; the clay Lyon (2752) is no event here', () => {
    // the committed tournament-surfaces.json (2026-07-15) predates key 14763; the pipeline's refreshed copy has it
    // (hard / indoor on the deployed file, 2026-10-24). Either way: no past, and never the clay key's.
    const known = !!real.events['14763'];
    eq([known ? real.events['14763'].past : real.unresolved.some(u => u.key === '14763'), real.events['2752']], [known ? null : true, undefined], 'Lyon');
  });
  check('baselines are populated, 10 seasons each (2016–2025)', () => {
    for (const b of ['indoorHard', 'outdoorHard']) { const s = real.baseline[b]; if (!s || s.n < 3000 || s.years.length !== 10) throw new Error(`${b}: ${s && s.n} / ${s && s.years}`); }
  });
}
// the history file is reproducible from the pinned Sackmann copy — local only (the copy is not in CI)
const SACK = path.join(os.homedir(), 'stennisfy-te-store', 'sackmann');
if (process.env.HOWPLAYS_BUILDER) { skip++; console.log('  SKIP  history reproducibility — mutant run'); }
else if (!fs.existsSync(path.join(SACK, 'SHA256SUMS'))) { skip++; console.log('  SKIP  history reproducibility — pinned Sackmann copy absent here (CI); run locally'); }
else check('how-it-plays-history.json rebuilds byte-identical from the pinned copy', () => {
  const tmp = path.join(os.tmpdir(), `howplays-hist-${process.pid}.json`);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build-how-it-plays-history.js'), '--out', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('rebuild failed: ' + r.stderr);
  const same = fs.readFileSync(tmp, 'utf8') === fs.readFileSync(histPath, 'utf8');
  fs.rmSync(tmp, { force: true });
  if (!same) throw new Error('committed history differs from a rebuild');
});

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
