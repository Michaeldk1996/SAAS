'use strict';
// Points to defend (founder brief round 2, item 2.3) — the data layer: tools/points-to-defend/build-points-to-defend.js
// over the shared engine tools/points-at-risk/{round-classify,points-resolver}.js.
//
// Each check names the mutation it catches; tools/test-points-to-defend-mutants.js applies every one (and the pre-fix
// engine from origin/main) and requires this suite to go red.
//   E1  qualifying round from the qualifying-bracket label          (Q1 losers were credited Q_final_round_loss)
//   E2  lucky loser = main-draw points only, qualifying null, LL    (LL got Q_into_MD)
//   E3  every row of an event drops on the event's date             (qualifying-only rows dropped a week early)
//   S   status at this year's event (Playing / Withdrew / Not entered, inferred flag)
//   L   Lyon 2026 first edition
//   N   non-round events dash
//   C   committed-data control: Almaty / Brussels 2025 from committed api-tennis fixtures, every row reconciled
// PTD_ROOT lets the mutant runner point the suite at a mutated copy of the two tool directories.
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');

const ROOT = process.env.PTD_ROOT || path.join(__dirname, '..');
const PAR = path.join(ROOT, 'tools', 'points-at-risk');
const PTD = path.join(ROOT, 'tools', 'points-to-defend');
const FIX = path.join(__dirname, 'points-to-defend', 'fixtures');   // fixtures always from the real tree
const { classifyRound } = require(path.join(PAR, 'round-classify.js'));
const { resolveEdition } = require(path.join(PAR, 'points-resolver.js'));
const B = require(path.join(PTD, 'build-points-to-defend.js'));
const table = require(path.join(PAR, 'atp-points-table-v1.json'));
const tierMap = require(path.join(PAR, 'atp-tier-map-v1.json'));

let fails = 0; let n = 0;
function check(name, fn) {
  n++;
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { fails++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(a, b, msg) { const A = JSON.stringify(a); const Bs = JSON.stringify(b); if (A !== Bs) throw new Error(`${msg || ''} expected ${Bs}, got ${A}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

const fx = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).result;
const ALMATY = fx('11851-2025.json'); const BRUSSELS = fx('3669-2025.json'); const STOCKHOLM = fx('1681-2025.json');
const T250 = { tier: 'ATP250', confirmed: true, confirmed_seasons: ['2025'], season: '2025', draw_size: 28 };
const keyOf = (fixtures, short) => {
  for (const f of fixtures) {
    if (f.event_first_player === short) return String(f.first_player_key);
    if (f.event_second_player === short) return String(f.second_player_key);
  }
  throw new Error('no player ' + short);
};
const res = (fixtures, short, tierInfo = T250) => resolveEdition({ editionFixtures: fixtures.map((f) => ({ ...f, isGrandSlam: false })), playerKey: keyOf(fixtures, short), tierInfo, pointsTable: table });
const people = (pk, apiName) => ({ name: apiName, country: null, rank: null });

console.log('E1 · qualifying round classification');
check('E1a api-tennis qualifying labels map to the qualifying bracket (Final = last round) [mutant: qualRound dropped]', () => {
  eq(classifyRound({ tournamentRound: 'Almaty - Final', qualification: 'True' }).qualRound, 'F');
  eq(classifyRound({ tournamentRound: 'Almaty - Semi-finals', qualification: 'True' }).qualRound, 'SF');
  eq(classifyRound({ tournamentRound: 'US Open - Quarter-finals', qualification: 'True' }).qualRound, 'QF');
  eq(classifyRound({ tournamentRound: 'Almaty - Final', qualification: 'True' }).code, 'Q', 'code stays Q for existing readers:');
});
// Wikipedia 2025 Almaty Open – Singles: Q1 losers / final-round losers (qualifying draw).
const ALMATY_Q1 = ['L. Draxl', 'B. Harris', 'T. Daniel', 'S. Purtseladze', 'J. Paul', 'I. Simakin', 'A. Holmgren', 'D. Yevseyev'];
const ALMATY_Q2 = ['T. Droguet', 'M. Huesler', 'M. Kukushkin'];
check('E1b Almaty 2025: the 8 Q1 losers get Q1 and 0 points [mutant: every qualifying loss = final round]', () => {
  for (const p of ALMATY_Q1) { const r = res(ALMATY, p); eq([r.qualRound, r.points, r.key], ['Q1', 0, 'Q_earlier_round_loss'], p); }
});
check('E1c Almaty 2025: the 3 final-round losers get Q2 and 7 points', () => {
  for (const p of ALMATY_Q2) { const r = res(ALMATY, p); eq([r.qualRound, r.points, r.key], ['Q2', 7, 'Q_final_round_loss'], p); }
});
// Wikipedia 2025 Stockholm Open – Singles.
const STO_Q1 = ['D. Prizmic', 'R. Sakamoto', 'N. Slavic', 'V. Sachko', 'M. Gigante', 'W. Rejchtman Vinciguerra', 'I. Buse', 'S. Gueymard Wayenburg'];
const STO_Q2 = ['E. Quinn', 'P. Zahraj', 'V. Durasovic', 'J. Clarke'];
check('E1d Stockholm 2025: 8 Q1 losers 0, 4 final-round losers 7 (Wikipedia draw)', () => {
  for (const p of STO_Q1) eq([res(STOCKHOLM, p).qualRound, res(STOCKHOLM, p).points], ['Q1', 0], p);
  for (const p of STO_Q2) eq([res(STOCKHOLM, p).qualRound, res(STOCKHOLM, p).points], ['Q2', 7], p);
});
// A synthetic Grand Slam qualifying (3 rounds, api-tennis labels Quarter-finals / Semi-finals / Final) plus a 128 draw stub.
function slamEdition() {
  const rows = []; let id = 1;
  const add = (round, q, a, b, date) => rows.push({ event_key: id++, event_date: date, tournament_round: 'US Open - ' + round, event_qualification: q, first_player_key: a, second_player_key: b, event_winner: 'First Player', event_status: 'Finished', event_final_result: q === 'True' ? '2 - 0' : '3 - 0', tournament_name: 'US Open', tournament_key: 1217, tournament_season: '2025' });
  add('Quarter-finals', 'True', 900, 901, '2025-08-18');   // 901 loses Q1
  add('Semi-finals', 'True', 900, 902, '2025-08-19');      // 902 loses Q2
  add('Final', 'True', 900, 903, '2025-08-21');            // 903 loses Q3 (last round)
  // main draw: a full 128 bracket of fresh keys so the round-integrity gate passes
  let alive = []; for (let i = 0; i < 128; i++) alive.push(1000 + i);
  alive[0] = 900;
  const rounds = ['1/64-finals', '1/32-finals', '1/16-finals', '1/8-finals', 'Quarter-finals', 'Semi-finals', 'Final'];
  let day = 24;
  for (const r of rounds) { const next = []; for (let i = 0; i < alive.length; i += 2) { add(r, 'False', alive[i], alive[i + 1], `2025-08-${String(day).padStart(2, '0')}`); next.push(alive[i]); } alive = next; day++; }
  return rows.map((f) => ({ ...f, isGrandSlam: true }));
}
check('E1e Grand Slam 3-round qualifying: Q1 0, Q2 8, Q3 16; qualifier +30 [mutant: fromEnd ignored]', () => {
  const ed = slamEdition();
  const ti = { tier: 'GrandSlam', confirmed: true, confirmed_seasons: ['2025'], season: '2025', draw_size: 128 };
  const r = (k) => resolveEdition({ editionFixtures: ed, playerKey: k, tierInfo: ti, pointsTable: table });
  eq([r(901).qualRound, r(901).points], ['Q1', 0], 'Q1');
  eq([r(902).qualRound, r(902).points], ['Q2', 8], 'Q2');
  eq([r(903).qualRound, r(903).points], ['Q3', 16], 'Q3');
  eq([r(900).key, r(900).mainPoints, r(900).qualPoints, r(900).points], ['W', 2000, 30, 2030], 'qualifier champion');
});

console.log('E2 · lucky losers');
check('E2a Hijikata (Almaty 2025 LL, R16): main 25, qualifying null, LL, no qualifier bonus [mutant: LL gets Q_into_MD]', () => {
  const r = res(ALMATY, 'R. Hijikata');
  eq([r.key, r.mainPoints, r.qualPoints, r.points], ['R16', 25, null, 25]);
  ok(r.flags.includes('lucky-loser') && !r.flags.includes('qualifier-bonus'), JSON.stringify(r.flags));
});
check('E2b Royer (Brussels 2025 LL, R16): main 25, qualifying null, LL', () => {
  const r = res(BRUSSELS, 'V. Royer');
  eq([r.key, r.mainPoints, r.qualPoints, r.points], ['R16', 25, null, 25]);
  ok(r.flags.includes('lucky-loser'));
});
check('E2c a qualifier still gets main + Q_into_MD (Duckworth 100 + 13 = 113; Tomic 0 + 13)', () => {
  const d = res(ALMATY, 'J. Duckworth'); eq([d.key, d.mainPoints, d.qualPoints, d.points], ['SF', 100, 13, 113]);
  const t = res(ALMATY, 'B. Tomic'); eq([t.key, t.mainPoints, t.qualPoints, t.points], ['R32', 0, 13, 13]);
});
check('E2d an LL row stays in rows even at 0 main-draw points (its qualifying share is unknown, not 0) [mutant: LL filed as zero row]', () => {
  // turn Hijikata's R16 win into a loss: he loses his first main-draw match (R32, 0 points)
  const hk = keyOf(ALMATY, 'R. Hijikata');
  const ed = ALMATY.filter((f) => !(String(f.first_player_key) === hk || String(f.second_player_key) === hk) || f.event_qualification === 'True' || /1\/16/.test(f.tournament_round))
    .map((f) => (/1\/16/.test(f.tournament_round) && (String(f.first_player_key) === hk || String(f.second_player_key) === hk)) ? { ...f, event_winner: String(f.first_player_key) === hk ? 'Second Player' : 'First Player' } : f);
  const out = B.resolvePriorEdition({ fixtures: ed, tierEvent: { tier: 'ATP250', confirmed: true, confirmed_seasons: ['2025'] }, season: 2025, pointsTable: table, people });
  const row = out.rows.find((r) => r.playerKey === hk);
  ok(row, 'LL row missing from rows'); eq([row.ll, row.mainPoints, row.qualifyingPoints, row.points, row.pointsComplete], [true, 0, null, 0, false]);
});

console.log('E3 · drop date');
check('E3a Almaty 2025: every row, qualifying-only ones included, drops 2026-10-19 [mutant: per-player award date]', () => {
  const out = B.resolvePriorEdition({ fixtures: ALMATY, tierEvent: { tier: 'ATP250', confirmed: true, confirmed_seasons: ['2025'] }, season: 2025, pointsTable: table, people });
  const all = out.rows.concat(out.zeroRows);
  eq([...new Set(all.map((r) => r.dropDate))], ['2026-10-19']);
  eq(out.dropDate, '2026-10-19', 'header');
  ok(all.filter((r) => r.result === 'Q').length === 11, 'expected 11 qualifying-only rows');
});
check('E3b Brussels 2025: every row drops 2026-10-19', () => {
  const out = B.resolvePriorEdition({ fixtures: BRUSSELS, tierEvent: { tier: 'ATP250', confirmed: true, confirmed_seasons: ['2025'] }, season: 2025, pointsTable: table, people });
  eq([...new Set(out.rows.concat(out.zeroRows).map((r) => r.dropDate))], ['2026-10-19']);
});

console.log('S · status at this year\'s event');
const draw = {
  main: { slots: [{ playerKey: '1', entry: null }, { playerKey: '2', entry: 'LL' }, { bye: true, playerKey: null }], withdrawals: ['K. Majchrzak (Knee)'] },
  qualifying: { slots: [{ playerKey: '3', entry: null }], withdrawals: [] },
};
const seen = { 5: { sections: ['Main Draw'], lastSeen: '2026-10-10T00:00:00Z' }, 6: { sections: ['Alternates & Reserves'] }, 1: { sections: ['Main Draw'] } };
check('S1 in the draw sheet (main or qualifying) → Playing, not inferred', () => {
  eq(B.statusOf({ playerKey: '1', draw, entrySeen: seen, hasEntryList: true }).status, 'Playing');
  const q = B.statusOf({ playerKey: '3', draw, entrySeen: seen, hasEntryList: true }); eq([q.status, q.drawSection], ['Playing', 'qualifying']);
  eq(B.statusOf({ playerKey: '2', draw, entrySeen: seen, hasEntryList: true }).drawEntry, 'LL');
});
check('S2 named in the sheet\'s withdrawals → Withdrew, official, reason kept', () => {
  const s = B.statusOf({ playerKey: '4', apiName: 'K. Majchrzak', fullName: 'Kamil Majchrzak', draw, entrySeen: seen, hasEntryList: true });
  eq([s.status, s.statusBasis, s.statusInferred, s.withdrawalReason], ['Withdrew', 'draw-sheet-withdrawal', false, 'Knee']);
});
check('S3 on an acceptance list, not in the draw → Withdrew, MARKED inferred [mutant: inferred flag dropped / basis changed]', () => {
  const s = B.statusOf({ playerKey: '5', draw, entrySeen: seen, hasEntryList: true });
  eq([s.status, s.statusBasis, s.statusInferred], ['Withdrew', 'entry-list-not-in-draw', true]);
});
check('S4 alternates only → Not entered; on no list → Not entered', () => {
  eq(B.statusOf({ playerKey: '6', draw, entrySeen: seen, hasEntryList: true }).status, 'Not entered');
  eq(B.statusOf({ playerKey: '6', draw, entrySeen: seen, hasEntryList: true }).statusBasis, 'alternate-list-only');
  const s = B.statusOf({ playerKey: '7', draw, entrySeen: seen, hasEntryList: true }); eq([s.status, s.statusBasis], ['Not entered', 'not-on-entry-list']);
});
check('S5 draw not released: on a list → Entered; nothing at all → null', () => {
  eq(B.statusOf({ playerKey: '5', draw: null, entrySeen: seen, hasEntryList: true }).status, 'Entered');
  eq(B.statusOf({ playerKey: '7', draw: null, entrySeen: {}, hasEntryList: false }).status, null);
});
check('S5b the event has started and we hold no draw sheet → null (never "Entered" for a past event) [mutant: started ignored]', () => {
  const s = B.statusOf({ playerKey: '5', draw: null, entrySeen: seen, hasEntryList: true, started: true });
  eq([s.status, s.statusBasis], [null, 'draw-not-held']);
});
check('S6 entry-list memory unions snapshots by week + city and keeps every section seen', () => {
  const snaps = [
    { generatedAt: '2026-10-01T00:00:00Z', tournaments: [{ weekStart: '2026-10-19', city: 'Almaty', sections: [{ title: 'Main Draw', players: [{ playerKey: '9', name: 'X' }] }] }] },
    { generatedAt: '2026-10-05T00:00:00Z', tournaments: [{ weekStart: '2026-10-19', city: 'Almaty', sections: [{ title: 'Alternates & Reserves', players: [{ playerKey: '9', name: 'X' }] }] }, { weekStart: '2026-10-19', city: 'Lyon', sections: [{ title: 'Main Draw', players: [{ playerKey: '8' }] }] }] },
  ];
  const { seen: m, lists } = B.mergeEntrySeen({}, snaps, '2026-10-19', new Set(['almaty']), () => null);
  eq([lists, Object.keys(m), m['9'].sections, m['9'].firstSeen, m['9'].lastSeen], [2, ['9'], ['Main Draw', 'Alternates & Reserves'], '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z']);
});
check('S7 once the draw leaves draws.json, the statuses read from it are frozen (never recomputed against no draw)', () => {
  const target = { key: 'almaty-2026', name: 'Almaty', season: 2026, atpId: '9410', city: 'Almaty', startDate: '2026-10-19', tierEvent: { name: 'Almaty', tier: 'ATP250', confirmed: true, confirmed_seasons: ['2025'], tournament_keys: [11851] }, override: null };
  const prevEvent = { statusSource: 'draw-sheet', rows: [{ playerKey: keyOf(ALMATY, 'D. Medvedev'), status: 'Playing', statusBasis: 'draw-sheet', statusInferred: false, drawSection: 'main' }] };
  const ev = B.buildEvent({ target, fixturesFor: () => ALMATY, pointsTable: table, people, draw: null, entrySeen: {}, hasEntryList: false, prevEvent });
  const med = ev.rows.find((r) => r.playerKey === keyOf(ALMATY, 'D. Medvedev'));
  eq([med.status, med.statusBasis, med.statusFrozen], ['Playing', 'draw-sheet', true]);
});

console.log('L · Lyon 2026 first edition');
const overrides = require(path.join(PTD, 'lineage-overrides.json'));
const tiers = B.tierIndex(tierMap);
check('L1 Lyon 2026 (atpId 496) → firstEdition, no rows; no api-tennis edition is ever read for it [mutant: override removed]', () => {
  const targets = B.collectTargets({ draws: { tournaments: { 496: { atpId: 496, city: 'Lyon', startDate: '2026-10-19', endDate: '2026-10-25', category: 'ATP 250' } } }, calendar: null, entrySnapshots: [], asOf: '2026-10-25', overrides, tiers });
  eq(targets.map((t) => t.key), ['lyon-2026']);
  let asked = 0;
  // offer a Lyon-May-like 2025 edition: it must never be used
  const ev = B.buildEvent({ target: { ...targets[0], tierEvent: { name: 'Lyon', tier: 'ATP250', confirmed: true, confirmed_seasons: ['2025', '2026'], tournament_keys: [11851] } }, fixturesFor: () => { asked++; return ALMATY; }, pointsTable: table, people, draw: null, entrySeen: {}, hasEntryList: false, prevEvent: null });
  eq([ev.state, ev.firstEdition, ev.rows.length, ev.dropDate, asked], ['first-edition', true, 0, null, 0]);
});
check('L2 Brussels 2026 lineage = editions NAMED Brussels on Antwerp\'s key 3669 (an Antwerp-named edition is never a prior)', () => {
  const targets = B.collectTargets({ draws: { tournaments: { 7485: { atpId: 7485, city: 'Brussels', startDate: '2026-10-19', endDate: '2026-10-25' } } }, calendar: null, entrySnapshots: [], asOf: '2026-10-25', overrides, tiers });
  eq([targets[0].key, targets[0].tierEvent.tournament_keys], ['brussels-2026', [3669]]);
  const antwerp = ALMATY.map((f) => ({ ...f, tournament_name: 'Antwerp', tournament_key: 3669, event_key: 'a' + f.event_key }));
  const ev = B.buildEvent({ target: targets[0], fixturesFor: () => BRUSSELS.concat(antwerp), pointsTable: table, people, draw: null, entrySeen: {}, hasEntryList: false, prevEvent: null });
  eq([ev.state, ev.prior.apiTennisName, ev.rows.length], ['ok', 'Brussels', 19]);
});

console.log('N · non-round events');
check('N1 ATP Finals / Davis Cup / United Cup / Laver Cup / Next Gen tiers → nonRound, no rows, null drop date [mutant: tier gate removed]', () => {
  for (const tier of ['NittoATPFinals', 'DavisCup', 'UnitedCup', 'LaverCup', 'NextGenFinals']) {
    const ev = B.buildEvent({ target: { key: 'x-2026', name: 'X', season: 2026, tierEvent: { name: 'X', tier, confirmed: true, confirmed_seasons: ['2025'], tournament_keys: [11851] } }, fixturesFor: () => ALMATY, pointsTable: table, people, draw: null, entrySeen: {}, hasEntryList: false, prevEvent: null });
    eq([ev.state, ev.nonRound, ev.rows.length, ev.dropDate], ['non-round', true, 0, null], tier);
  }
});
check('N2 an edition with no round-labelled match (team event) → nonRound, never a 0', () => {
  const team = ALMATY.filter((f) => f.event_qualification === 'False').map((f) => ({ ...f, tournament_round: '' }));
  const out = B.resolvePriorEdition({ fixtures: team, tierEvent: { tier: 'ATP250', confirmed: true, confirmed_seasons: ['2025'] }, season: 2025, pointsTable: table, people });
  eq([out.nonRound, out.rows.length, out.zeroRows.length, out.dropDate], [true, 0, 0, null]);
});

console.log('C · committed-data control (end to end, offline)');
// Almaty 2025 → 2026, every row: [api-tennis name, badge, main, qualifying, points, LL]
const ALMATY_EXPECTED = [
  ['D. Medvedev', 'Won', 250, 0, 250, false], ['C. Moutet', 'F', 165, 0, 165, false], ['J. Duckworth', 'SF | Q', 100, 13, 113, false],
  ['A. Michelsen', 'SF', 100, 0, 100, false], ['F. Cobolli', 'QF', 50, 0, 50, false], ['J-L. Struff', 'QF', 50, 0, 50, false],
  ['F. Marozsan', 'QF', 50, 0, 50, false], ['S. Mochizuki', 'QF', 50, 0, 50, false], ['B. Nakashima', 'R16', 25, 0, 25, false],
  ['R. Hijikata', 'R16', 25, null, 25, true], ['A. Walton', 'R16', 25, 0, 25, false], ['A. Shevchenko', 'R16', 25, 0, 25, false],
  ['A. Vukic', 'R16', 25, 0, 25, false], ['G. Diallo', 'R16', 25, 0, 25, false], ['B. Tomic', 'R32 | Q', 0, 13, 13, false],
  ['M. Topo', 'R32 | Q', 0, 13, 13, false], ['U. Blanchet', 'R32 | Q', 0, 13, 13, false], ['T. Droguet', 'Q', null, 7, 7, false],
  ['M. Huesler', 'Q', null, 7, 7, false], ['M. Kukushkin', 'Q', null, 7, 7, false],
];
let built = null;
function buildOffline() {
  if (built) return built;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-test-'));
  const out = path.join(dir, 'points-to-defend.json');
  const r = cp.spawnSync(process.execPath, [path.join(PTD, 'build-points-to-defend.js'), '--asof', '2026-10-25', '--out', out, '--prev', path.join(dir, 'none.json'),
    '--player-index', path.join(FIX, 'player-index-subset.json'), '--draws', path.join(FIX, 'draws-2026-10-19.json'), '--entry', path.join(dir, 'none.json'),
    '--entry-history', path.join(FIX, 'entry-history-2026-10-19.json'), '--fixtures-dir', FIX, '--only', 'almaty-2026,brussels-2026,lyon-2026'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('builder exited ' + r.status + ': ' + r.stderr);
  built = JSON.parse(fs.readFileSync(out, 'utf8'));
  return built;
}
check('C1 Almaty 2026: 20 rows, every one as reconciled (order, badge, main, qualifying, points, LL) [any engine mutant]', () => {
  const ev = buildOffline().events['almaty-2026'];
  eq([ev.state, ev.atpId, ev.rowCount, ev.dropDate, ev.prior.drawSize], ['ok', 9410, 20, '2026-10-19', 28]);
  eq(ev.rows.map((r) => [r.apiName, r.resultBadge, r.mainPoints, r.qualifyingPoints, r.points, r.ll]), ALMATY_EXPECTED);
  eq(ev.rows.map((r) => r.order), ALMATY_EXPECTED.map((_, i) => i + 1));
  eq(ev.zeroPointCount, 19, 'zero rows (8 Q1 losers + 11 first-round losers)');
});
check('C2 Almaty 2026 statuses from the committed sheet + entry history (Mochizuki: Withdrew, inferred)', () => {
  const ev = buildOffline().events['almaty-2026'];
  const st = Object.fromEntries(ev.rows.map((r) => [r.apiName, [r.status, r.statusBasis]]));
  eq(st['D. Medvedev'], ['Playing', 'draw-sheet']);
  eq(st['S. Mochizuki'], ['Withdrew', 'entry-list-not-in-draw']);
  eq(st['C. Moutet'], ['Not entered', 'not-on-entry-list']);
  ok(ev.rows.find((r) => r.apiName === 'C. Moutet').playingElsewhere.includes('Lyon'), 'Moutet is in the Lyon draw');
  eq(ev.rows.find((r) => r.apiName === 'M. Kukushkin').drawEntry, 'WC');
});
check('C3 Brussels 2026: 19 rows; Royer LL; Blockx withdrew (sheet, Ankle); Auger-Aliassime withdrew (inferred)', () => {
  const ev = buildOffline().events['brussels-2026'];
  eq([ev.state, ev.rowCount, ev.dropDate, ev.prior.apiTennisName], ['ok', 19, '2026-10-19', 'Brussels']);
  const by = Object.fromEntries(ev.rows.map((r) => [r.apiName, r]));
  eq([by['V. Royer'].ll, by['V. Royer'].qualifyingPoints, by['V. Royer'].points], [true, null, 25]);
  eq([by['A. Blockx'].status, by['A. Blockx'].statusBasis, by['A. Blockx'].withdrawalReason], ['Withdrew', 'draw-sheet-withdrawal', 'Ankle']);
  eq([by['F. Auger-Aliassime'].status, by['F. Auger-Aliassime'].statusInferred], ['Withdrew', true]);
  eq(ev.rows.map((r) => r.points), [250, 165, 100, 100, 63, 50, 50, 50, 38, 38, 38, 25, 25, 25, 25, 25, 7, 7, 7]);
});
check('C4 Lyon 2026: firstEdition, no rows; points-at-risk.json is never read', () => {
  const doc = buildOffline();
  eq([doc.events['lyon-2026'].firstEdition, doc.events['lyon-2026'].rows.length], [true, 0]);
  ok(!/points-at-risk\.json/.test(fs.readFileSync(path.join(PTD, 'build-points-to-defend.js'), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')), 'builder code mentions points-at-risk.json');
});
check('C5 output schema: top-level keys, index aliases, row fields', () => {
  const doc = buildOffline();
  eq(Object.keys(doc), ['schemaVersion', 'generatedAt', 'asOf', 'sources', 'rules', 'index', 'events', '_entrySeen']);
  eq([doc.index['antwerp-2026'], doc.index['brussels-2026'], doc.index['almaty-2026']], ['brussels-2026', 'brussels-2026', 'almaty-2026']);
  const r = doc.events['almaty-2026'].rows[0];
  for (const f of ['order', 'playerKey', 'name', 'apiName', 'country', 'rank', 'result', 'resultBadge', 'qualRound', 'qualified', 'll', 'mainPoints', 'qualifyingPoints', 'points', 'pointsComplete', 'dropDate', 'status', 'statusBasis', 'statusInferred']) ok(f in r, 'row lacks ' + f);
});

console.log(`\n${n - fails}/${n} checks passed`);
if (fails) { console.log(`test-points-to-defend: ${fails} FAILED`); process.exit(1); }
console.log('test-points-to-defend: all passed');
