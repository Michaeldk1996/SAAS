// tools/test-tournament-identity.js — locks the canonical tournament aliases,
// and in particular the year-end championship merge (founder ruling 2026-09-18).
//
// The risk this file exists for is the BARE KEY. 'finals' collapses any name
// that normalizes to exactly "finals" into Tour Finals; if identityKey() ever
// became lossier — stripping a "Davis Cup " prefix, dropping a colon clause —
// 789 Davis Cup tie identities and two Next Gen ones would silently pour into
// the year-end row. The negative controls below are that alarm, and they are
// worth more than the positive ones.
//
// Run: node tools/test-tournament-identity.js

'use strict';
const assert = require('assert');
const { canonicalTournament, identityKey } = require('../tournament-identity.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}

const id = (n) => canonicalTournament(n).id;
const disp = (n) => canonicalTournament(n).display;

console.log('\n── year-end championship · the four names are ONE event ─────────');

['Tour Finals', 'Masters Cup', 'Finals - Turin', 'Finals', 'ATP Finals'].forEach((n) => {
  if (n === 'ATP Finals') return; // not a name the feeds emit; covered below
  check(`"${n}" is the Tour Finals identity`, () => {
    assert.strictEqual(disp(n), 'Tour Finals', `display was "${disp(n)}"`);
    assert.strictEqual(id(n), id('Tour Finals'));
  });
});

check('all four collapse to exactly ONE identity', () => {
  const ids = new Set(['Tour Finals', 'Masters Cup', 'Finals - Turin', 'Finals'].map(id));
  assert.strictEqual(ids.size, 1, `got ${ids.size} identities: ${[...ids].join(', ')}`);
});

check('the ATP tour prefix does not defeat the merge', () => {
  assert.strictEqual(disp('ATP Finals - Turin'), 'Tour Finals');
});

console.log('\n── the bare "finals" key must NOT swallow anything else ─────────');

check('Next Gen Finals stays its own event, under every spelling', () => {
  ['Next Gen Finals', 'NextGen Finals', 'Next Gen ATP Finals',
    'Next Gen Finals - Milan', 'Next Gen Finals - Jeddah'].forEach((n) => {
    assert.notStrictEqual(disp(n), 'Tour Finals', `"${n}" was swallowed by the year-end row`);
  });
});

check('Davis Cup ties stay their own identities', () => {
  ['Davis Cup Finals RR: ITA vs BEL', 'Davis Cup Finals F: ITA vs ESP',
    'Davis Cup Finals QF: AUS vs NED', 'Davis Cup WG SF: BEL vs AUS'].forEach((n) => {
    assert.notStrictEqual(disp(n), 'Tour Finals', `"${n}" was swallowed by the year-end row`);
  });
  // ...and stay distinct from EACH OTHER: the ties are separate rows today, and
  // whether they should be is a pending ruling, not something this file decides.
  assert.notStrictEqual(id('Davis Cup Finals RR: ITA vs BEL'), id('Davis Cup Finals F: ITA vs ESP'));
});

check('an event merely CONTAINING "finals" is untouched', () => {
  assert.notStrictEqual(disp('Laver Cup Finals'), 'Tour Finals');
  assert.notStrictEqual(disp('Finals Qualifying'), 'Tour Finals');
});

console.log('\n── the pre-existing aliases still hold ──────────────────────────');

check('Roland Garros folds into French Open', () => {
  assert.strictEqual(disp('Roland Garros'), 'French Open');
});

check('the Canadian Open collects all six of its names', () => {
  const ids = new Set(['Montreal', 'Toronto', 'Canada Masters', 'Canadian Open',
    'National Bank Open', 'Rogers Cup'].map(id));
  assert.strictEqual(ids.size, 1, `Canada fragmented into ${ids.size}`);
  assert.strictEqual(disp('Toronto'), 'Canada Masters');
});

check('Masters 1000 city/suffix pairs are one identity each', () => {
  [['Cincinnati', 'Cincinnati Masters'], ['Madrid', 'Madrid Masters'],
    ['Miami', 'Miami Masters'], ['Rome', 'Rome Masters'],
    ['Shanghai', 'Shanghai Masters'], ['Paris', 'Paris Masters'],
    ['Monte Carlo', 'Monte Carlo Masters'], ['Indian Wells', 'Indian Wells Masters'],
    ['Hamburg', 'Hamburg Masters']].forEach(([a, b]) => {
    assert.strictEqual(id(a), id(b), `${a} !== ${b}`);
  });
});

check('same-city SECOND events stay separate — merging those is the opposite bug', () => {
  assert.notStrictEqual(id('Adelaide'), id('Adelaide 2'));
  assert.notStrictEqual(id('Stuttgart'), id('Stuttgart 1'));
});

console.log('\n── TEN-384 fix item 12 · London is Queen\'s Club ─────────────────');

check('"London", "ATP London" and "Queen\'s Club" are ONE identity, displayed "Queen\'s Club"', () => {
  ['London', 'ATP London', "Queen's Club", 'Queens Club'].forEach((n) => {
    assert.strictEqual(disp(n), "Queen's Club", `"${n}" displayed "${disp(n)}"`);
    assert.strictEqual(id(n), id("Queen's Club"), `"${n}" kept its own identity`);
  });
});

check('the London Olympics stays apart from Queen\'s Club (the bare key matches the WHOLE name)', () => {
  assert.notStrictEqual(id('London Olympics'), id("Queen's Club"));
  // fx4: it joins the Olympics identity instead (one event across years, per-year surface)
  assert.strictEqual(disp('London Olympics'), 'Olympic Games');
});

check('the REAL mergePlayer folds an API "London" and a TML "Queen\'s Club" into one row, API years winning', () => {
  const { _internal } = require('../career-backfill.js');
  const m = (opp, res) => ({ res, round: 'R16', opp, oppKey: '', score: '2 - 0' });
  // The deployed Alcaraz shape: API "London" 2023-2025 and the SAME seasons from the archive.
  const api = [{ name: 'London', editions: [
    { year: 2025, matches: [m('J. Lehecka', 'W')] }, { year: 2024, matches: [m('J. Draper', 'L')] }] }];
  const tml = [
    { year: 2025, tourney: "Queen's Club", round: 'R16', won: true, oppName: 'J. Lehecka', score: '0 - 2' },
    { year: 2024, tourney: "Queen's Club", round: 'R16', won: false, oppName: 'J. Draper', score: '2 - 0' },
    { year: 2017, tourney: "Queen's Club", round: 'R32', won: true, oppName: 'X. Older', score: '0 - 2' },
  ];
  const { history } = _internal.mergePlayer(api, tml);
  const rows = history.filter((t) => /london|queen/i.test(t.name));
  assert.strictEqual(rows.length, 1, `got ${rows.length} rows: ${rows.map((t) => t.name).join(' + ')}`);
  assert.strictEqual(rows[0].name, "Queen's Club");
  assert.deepStrictEqual(rows[0].editions.map((e) => e.year).sort(), [2017, 2024, 2025]);
  assert.strictEqual(rows[0].won + rows[0].lost, 3, 'a shared season was counted twice');
});

check('fx3 · "Melbourne (Great Ocean Road Open)" and "Great Ocean Road Open" are ONE event (2021)', () => {
  assert.strictEqual(id('Melbourne (Great Ocean Road Open)'), id('Great Ocean Road Open'));
  assert.strictEqual(disp('Melbourne (Great Ocean Road Open)'), 'Great Ocean Road Open');
  assert.notStrictEqual(id('Melbourne'), id('Great Ocean Road Open'), 'a bare "Melbourne" must not join it');
});

const TI = require('../tournament-identity.js');
check('fx4 · every Olympics spelling is ONE identity, "Olympic Games"; no other event joins it', () => {
  ['Olympic Games', 'Olympics', 'Beijing Olympics', 'London Olympics', 'Rio Olympics', 'Tokyo Olympics', 'Paris Olympics']
    .forEach((n) => { assert.strictEqual(id(n), id('Olympic Games'), n); assert.strictEqual(disp(n), 'Olympic Games', n); });
  ['London', "Queen's Club", 'Paris', 'Tokyo', 'Beijing', 'Rio de Janeiro', 'Roland Garros', 'Wimbledon']
    .forEach((n) => assert.notStrictEqual(id(n), id('Olympic Games'), `"${n}" merged into the Olympics`));
});
check('fx4 · the Olympics surface is per YEAR (2012 grass, 2016 / 2021 hard, 2024 clay), never one label', () => {
  assert.strictEqual(TI.editionSurface('Olympic Games', 2024), 'clay');
  assert.strictEqual(TI.editionSurface('Paris Olympics', 2024), 'clay');
  assert.strictEqual(TI.editionSurface('Olympic Games', 2021), 'hard');
  assert.strictEqual(TI.editionSurface('Olympic Games', 2020), 'hard');
  assert.strictEqual(TI.editionSurface('Rio Olympics', 2016), 'hard');
  assert.strictEqual(TI.editionSurface('London Olympics', 2012), 'grass');
  assert.strictEqual(TI.editionSurface("Queen's Club", 2024), null, 'a fixed-surface event has no per-year map');
  assert.strictEqual(TI.editionYear('Olympic Games', 2020), 2021, 'the Tokyo Games (season 2020) were played in 2021');
  assert.strictEqual(TI.editionYear('Olympic Games', 2024), 2024);
  assert.strictEqual(TI.editionYear('Wimbledon', 2020), 2020);
});
check('fx4 · mergeHistory folds the Alcaraz shape (Olympic Games 5-1 + Paris Olympics 5-1, 2024) into one 5-1 row', () => {
  const m = (opp, res, round) => ({ res, round, opp, oppKey: '', score: '2 - 0' });
  const ed = { year: 2024, finish: 'Final', matches: ['WR64', 'WR32', 'WR16', 'WQF', 'WSF', 'LF'].map((x, i) => m('O' + i, x[0], x.slice(1))) };
  const out = TI.mergeHistory([{ name: 'Olympic Games', won: 5, lost: 1, editions: [ed] },
    { name: 'Paris Olympics', won: 5, lost: 1, editions: [JSON.parse(JSON.stringify(ed))] }]);
  assert.strictEqual(out.length, 1, out.map(t => t.name).join(' + '));
  assert.deepStrictEqual([out[0].name, out[0].won, out[0].lost], ['Olympic Games', 5, 1]);
});
check('fx4 · the Tokyo Games fold across the feed\'s season label: "Olympic Games" 2020 ≡ "Tokyo Olympics" 2021', () => {
  const m = (opp, res) => ({ res, round: 'R64', opp, oppKey: '', score: '0 - 2' });
  const out = TI.mergeHistory([
    { name: 'Olympic Games', won: 0, lost: 2, editions: [{ year: 2024, matches: [m('F. Cerundolo', 'L')] }, { year: 2020, matches: [m('J. Chardy', 'L')] }] },
    { name: 'Tokyo Olympics', won: 0, lost: 1, editions: [{ year: 2021, matches: [m('J. Chardy', 'L')] }] }]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].editions.map(e => e.year), [2024, 2021]);
  assert.deepStrictEqual([out[0].won, out[0].lost], [0, 2], 'the 2020/2021 Tokyo edition was counted twice');
  // a lone "Olympic Games" row is re-yeared too (so it joins career-history's 2021 dates)
  const solo = TI.mergeHistory([{ name: 'Olympic Games', won: 0, lost: 1, editions: [{ year: 2020, matches: [m('J. Chardy', 'L')] }] }]);
  assert.strictEqual(solo[0].editions[0].year, 2021);
});
check('fx4 · "Melbourne" ≡ "Melbourne (Summer Set)" (2022); the Murray River Open pair is one event; GORO stays apart', () => {
  assert.strictEqual(id('Melbourne'), id('Melbourne (Summer Set)'));
  assert.strictEqual(disp('Melbourne'), 'Melbourne (Summer Set)');
  assert.strictEqual(id('Melbourne (Murray River Open)'), id('Murray River Open'));
  assert.notStrictEqual(id('Melbourne'), id('Murray River Open'));
  assert.notStrictEqual(id('Melbourne'), id('Australian Open'));
  assert.notStrictEqual(id('Melbourne (Summer Set)'), id('Great Ocean Road Open'));
});

check('identityKey keeps digits and strips only the tour prefix', () => {
  assert.strictEqual(identityKey('ATP Adelaide 2'), 'adelaide 2');
  assert.strictEqual(identityKey("'s-Hertogenbosch"), 's hertogenbosch');
});

console.log(`\n================================================================\nPASS ${pass}   FAIL ${fail}`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
