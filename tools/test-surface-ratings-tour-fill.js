#!/usr/bin/env node
'use strict';
// surface-ratings.js — tour-level fill for the seasons TML does not carry (17 Nov 2026).
//
// TML's 2026.csv stops on 17 Jan 2026, so every 2026 tour match was missing from Serve /
// Return / Under pressure and 2026 breakouts (R. Jodar) left the store. Tour matches dated
// after TML's last date now come from api-tennis ATP singles (265), one source per match.
//
// Each check runs the shipped functions on fixtures, and each has a mutant that must
// turn it red (the mutant is the shipped source with one rule removed, loaded in a
// sandbox) — a check that cannot fail is not a check.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'surface-ratings-tour-apitennis.js');
const SR = fs.readFileSync(path.join(ROOT, 'surface-ratings.js'), 'utf8');

function load(src) {
  const m = new Module(SRC, module);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(ROOT);
  m._compile(src, SRC);
  return m.exports;
}
const SHIPPED = fs.readFileSync(SRC, 'utf8');

const D = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const TML_END = D('2026-01-17');
const SURF = new Map([['100', 'hard'], ['200', 'clay']]);

function stats(pk, svpt, firstIn, firstWon, secondWon, svGms, bpT, bpW) {
  const r = (type, name, o) => Object.assign({ player_key: pk, stat_period: 'match', stat_type: type, stat_name: String(name).toUpperCase() }, o);   // upper case: the reader must case-fold
  return [
    r('Points', 'Service Points Won', { stat_total: String(svpt) }),
    r('Service', '1st Serve Points Won', { stat_total: String(firstIn), stat_won: String(firstWon) }),
    r('Service', '2nd Serve Points Won', { stat_won: String(secondWon) }),
    r('Games', 'Service Games Won', { stat_total: String(svGms) }),
    r('Service', 'Aces', { stat_value: '5' }),
    r('Service', 'Double Faults', { stat_value: '2' }),
    r('Service', 'Break Points Saved', { stat_total: String(bpT), stat_won: String(bpW) }),
  ];
}
function fx(key, date, o = {}) {
  return Object.assign({
    event_key: key, event_date: date, event_status: 'Finished', event_qualification: 'False',
    tournament_key: '100', first_player_key: 1, second_player_key: 2, event_final_result: '2 - 1',
    scores: [{ score_first: '7', score_second: '6' }, { score_first: '3', score_second: '6' }, { score_first: '6', score_second: '4' }],
    statistics: stats(1, 70, 45, 34, 14, 11, 6, 4).concat(stats(2, 72, 44, 30, 15, 11, 5, 3)),
  }, o);
}
const FIXTURES = [
  fx(1, '2026-01-15'),                                          // TML holds it -> out
  fx(2, '2026-01-17'),                                          // TML's last day -> out
  fx(3, '2026-01-20'),                                          // counts
  fx(4, '2026-02-01', { event_qualification: 'True' }),         // qualifying -> out
  fx(5, '2026-02-03', { event_status: 'Walk Over', statistics: [] }),
  fx(6, '2026-02-05', { event_status: 'Cancelled' }),           // cancelled with stats -> out
  fx(7, '2026-02-07', { event_status: 'Retired' }),             // counts, no decider
  fx(8, '2026-02-09', { tournament_key: '999' }),              // no surface -> null surface
  fx(9, '2026-02-11', { event_status: 'Interrupted' }),         // not finished -> out
];

let pass = 0; const fails = [];
function check(name, fn, mutants) {
  try { fn(load(SHIPPED)); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL  ${name}\n        ${e.message}`); return; }
  for (const [label, from, to] of mutants || []) {
    assert.ok(SHIPPED.includes(from), `mutant anchor missing: ${label}`);
    let red = false;
    try { fn(load(SHIPPED.replace(from, to))); } catch (e) { red = true; }
    if (red) { pass++; console.log(`  ok    mutant caught: ${label}`); }
    else { fails.push('mutant ' + label); console.error(`  FAIL  mutant survived: ${label}`); }
  }
}

check('only Finished/Retired main-draw matches after TML\'s last date count', m => {
  const c = m.tourFillContribs(FIXTURES, 1, SURF, TML_END);
  assert.deepStrictEqual(c.map(x => x.eventKey), ['3', '7', '8']);
}, [
  ['qualifying kept', "if (String(f.event_qualification) === 'True') continue;", ''],
  ['TML dates not cut (double count)', 'if (d == null || !(d > tmlEnd)) continue;', 'if (d == null) continue;'],
  ['cut includes TML\'s last day', '!(d > tmlEnd)', '!(d >= tmlEnd)'],
  ['every status kept', "if (!f || !COUNTED_STATUS.has(String(f.event_status))) continue;", 'if (!f) continue;'],
]);

check('figures are the player\'s own box score, both sides read', m => {
  const [c] = m.tourFillContribs([fx(3, '2026-01-20')], 1, SURF, TML_END);
  assert.strictEqual(c.svpt, 70); assert.strictEqual(c.firstIn, 45); assert.strictEqual(c.bpFaced, 6); assert.strictEqual(c.bpSaved, 4);
  assert.strictEqual(c.oSvpt, 72); assert.strictEqual(c.oBpFaced, 5); assert.strictEqual(c.oBpSaved, 3);
  assert.strictEqual(c.surface, 'Hard'); assert.strictEqual(c.date, D('2026-01-20'));
  assert.strictEqual(c.tbPlayed, 1); assert.strictEqual(c.tbWon, 1);
  assert.strictEqual(c.decPlayed, 1); assert.strictEqual(c.decWon, 1);
  const [o] = m.tourFillContribs([fx(3, '2026-01-20')], 2, SURF, TML_END);   // the opponent's view
  assert.strictEqual(o.svpt, 72); assert.strictEqual(o.oSvpt, 70); assert.strictEqual(o.tbWon, 0); assert.strictEqual(o.decWon, 0);
}, []);

check('a retirement counts its tiebreaks but never a deciding set (TML parseScore rule)', m => {
  const [c] = m.tourFillContribs([fx(7, '2026-02-07', { event_status: 'Retired' })], 1, SURF, TML_END);
  assert.strictEqual(c.tbPlayed, 1); assert.strictEqual(c.decPlayed, 0); assert.strictEqual(c.decWon, 0);
}, [
  ['retired decider counted', "if (String(f.event_status) === 'Retired') { c.decPlayed = 0; c.decWon = 0; }", ''],
]);

check('merge: TML up to its last date, api-tennis after it, each fixture once', m => {
  const tml = [{ date: D('2025-06-01'), k: 't1' }, { date: TML_END, k: 't2' }];
  const api = [
    { date: TML_END, eventKey: 'a0' },            // overlaps TML's last day -> dropped
    { date: D('2026-03-01'), eventKey: 'a1' },
    { date: D('2026-03-01'), eventKey: 'a1' },    // same fixture twice -> once
    { date: D('2026-04-01'), eventKey: 'a2' },
  ];
  const out = m.mergeTourContribs(tml, api, TML_END);
  assert.deepStrictEqual(out.map(x => x.k || x.eventKey), ['t1', 't2', 'a1', 'a2']);
}, [
  ['merge keeps api rows on TML dates', 'if (c.date == null || !(c.date > tmlEnd)) continue;', 'if (c.date == null) continue;'],
  ['merge keeps a fixture twice', 'if (c.eventKey && seen.has(c.eventKey)) continue;', ''],
]);

// The wiring in surface-ratings.js: the fill reaches the tour buckets, a player with no
// TML rows is still rated, and a surfaceless fill row counts in All only.
check('surface-ratings.js routes the fill into the tour buckets (not Challenger)', () => {
  assert.ok(/const fill = tourFill\.byKey\.get\(String\(meta\.key\)\)/.test(SR), "fill keyed by the profile key");
  assert.ok(/const tourContribs = mergeTourContribs\(aTml \? aTml\.contribs : \[\], fill, tmlEnd\);/.test(SR), 'merge call');
  assert.ok(/if \(!aTml && !fill\.length\) continue;/.test(SR), 'a fill-only player is not skipped');
  assert.ok(!/if \(!cands \|\| !cands\.length\) continue;/.test(SR), 'the old TML-only skip is gone');
  assert.ok(/if \(hasSurf\) addContribution\(scopes\.career\[c\.surface\], c\);/.test(SR), 'surfaceless fill row -> All only');
  assert.ok(/if \(date && date > tmlEnd\) tmlEnd = date;/.test(SR), 'tmlEnd = TML\'s last date');
  assert.ok(/tourFill\.refusalRate > tourFill\.maxRefusalRate/.test(SR), 'fail loud on refusals');
}, []);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
