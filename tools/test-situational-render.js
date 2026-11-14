#!/usr/bin/env node
'use strict';
// Live trading · "Record by situation" (Profile v4, handoff 2026-11-14, CHANGES §9), asserted on RENDERED MARKUP.
//
// Kept from build item 3 / TEN-384 (data rules the v4 handoff does not touch):
//   · the rows render ONLY where the player's store carries them: no point-by-point store → the pbp rows are not
//     rows (whole pbp groups omitted), never a block of dashes; nothing at all → a sentence, no empty table;
//   · a missing tour figure is a dash, never 0; under 5 the record shows and the rate dashes; walkovers never count;
//   · the founder's coverage wording rides on the table head; a closed group keeps its header.
// v4 (replaces the TEN-384 layout pins): one head line Situation · Record · Rate · Vs his norm · Vs tour; Record reads
// "w of n"; no sample captions (§0.4); gap figures green / red only, bold 13.5 for the one to read (vs his norm on hold /
// break rows, vs tour elsewhere); lower-is-better rows inverted; rows with no natural norm dash; the pbp rows dash
// (with the reason) under any scope their 24-month all-surfaces store cannot honour; Strongest / Weakest tiles with
// the neutral bar until clicked (§0.1); Filters counts + Applied chips; the title sample "n of N matches".

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DASH = '—';
const SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

// ── a career-history built by construction, dated inside the last 52 weeks / 24 months / older ───────────
const DAY = 86400000;
const iso = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
function ch(daysAgo, sets, won, extra) {
  return Object.assign({ year: iso(daysAgo).slice(0, 4), date: iso(daysAgo), surface: 'hard', level: 'atp', tournament: 'Somewhere',
    round: 'R32', opponent: 'X. Opp', oppKey: '99', result: won ? '2 - 0' : '0 - 2', won: won, src: 'fixtures', indoor: false, sets: sets }, extra || {});
}
const W2 = [{ p: 6, o: 4 }, { p: 6, o: 3 }];
const L3 = [{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 4, o: 6 }];
// 24 matches inside 52 weeks (14 won 2–0, 10 lost in three), 10 more 400–700 days back on clay, 6 career-only.
function makeHistory() {
  const out = [];
  for (let i = 0; i < 24; i++) out.push(i < 14 ? ch(10 + i * 7, W2, true) : ch(10 + i * 7, L3, false));
  for (let i = 0; i < 10; i++) out.push(ch(400 + i * 30, W2, true, { surface: 'clay' }));
  for (let i = 0; i < 6; i++) out.push(ch(900 + i * 30, L3, false));
  return out;
}
const SUBJECT = { key: 1, name: 'A. Subject', recentForm: { matches: [] } };
const THIN = { key: 3, name: 'C. Thin', recentForm: { matches: [] } };
const NONE = { key: 4, name: 'D. None', recentForm: { matches: [] } };
const PEER = { key: 2, name: 'B. Peer', recentForm: { matches: makeHistory().slice(0, 20).map(r => ({ sets: r.sets, won: r.won, tournament: 'Somewhere' })) } };

const PBP_STORE = {
  meta: { players: 2, windowMonths: 24 },
  tour: {
    brokenFirstSvc: { pct: 20 }, firstBreak: { pct: 50 }, brokenBack: { pct: 30 },
    breakBack: { pct: 40 }, lostS1FirstBreakS2: { pct: 33 }, holdWinSet: { pct: 80 },
    holdStaySet: { pct: 77 }, breakOppServing: { pct: null },
  },
  players: { 1: { matches: 40, rows: {
    brokenFirstSvc: { w: 4, l: 36 }, firstBreak: { w: 21, l: 13 }, brokenBack: { w: 3, l: 9 }, breakBack: { w: 18, l: 26 },
    lostS1FirstBreakS2: { w: 7, l: 10 }, holdWinSet: { w: 17, l: 5 }, holdStaySet: { w: 14, l: 6 }, breakOppServing: { w: 6, l: 14 } } } },
};
// hold 80% (every service-game cell 8 of 10), break 25% (every return-game cell 2 of 8)
function hbSide(w, n) { const s = {}; for (let st = 1; st <= 3; st++) { s[st] = {}; for (let b = 1; b <= 6; b++) s[st][b] = { won: w, n: n, pct: 100 * w / n }; } return { all: s }; }
const HB = { meta: { windowMonths: 24, players: 1, coverage: { from: '2024-11-13', to: '2026-11-12' } },
  players: { 1: { name: 'A. Subject', matches: 40, svcGames: 180, serve: hbSide(8, 10), return: hbSide(2, 8) } } };

function load(opts) {
  const o = opts || {};
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: { 1: SUBJECT, 2: PEER, 3: THIN, 4: NONE } },
    careerHistory: { 1: makeHistory(), 3: [ch(20, W2, true), ch(30, L3, false), ch(40, W2, true)], 4: [] } };
  if (o.pbp !== false) sandbox.situational = PBP_STORE;
  if (o.hb !== false) {
    const ctx = { window: {}, console }; ctx.self = ctx.window; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'holdbreak-heatmap.js'), 'utf8'), ctx);
    sandbox.HoldBreakHeatmap = ctx.window.HoldBreakHeatmap; sandbox.holdbreak = HB;
  }
  global.window = sandbox;
  new Function('window', o.src || SRC)(sandbox);
  return sandbox.PlayerProfileV2._internals;
}
function rowsOf(html) {
  const out = {};
  const re = /<div data-lt-row="(\w+)"[^>]*>([\s\S]*?)<\/span><\/span><\/div>/g; let m;
  while ((m = re.exec(html))) out[m[1]] = m[2];
  return out;
}
const text = h => h.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

console.log('\nLive trading · Record by situation (Profile v4)\n');

check('no point-by-point store: the pbp groups are omitted, not dashed', () => {
  const I = load({ pbp: false });
  const html = I.renderSituational(SUBJECT);
  assert(!/Break of serve/.test(html) && !/Serving for the set/.test(html), 'an all-pbp group still rendered');
  assert(/Set outcomes/.test(html) && /After set one/.test(html), 'the set groups must render');
  assert(!/first break in set 2/.test(html), 'the pbp row inside a mixed group must be dropped');
});

check('with the store all 4 groups and 14 rows render, one head line', () => {
  const I = load();
  const html = I.renderSituational(SUBJECT);
  assert.strictEqual(Object.keys(rowsOf(html)).length, 14);
  const heads = html.match(/>Situation<|>Record<|>Rate<|>Vs his norm<|>Vs tour</g) || [];
  assert.deepStrictEqual(heads, ['>Situation<', '>Record<', '>Rate<', '>Vs his norm<', '>Vs tour<'], 'the head line must render once, in order');
});

check('Record reads "w of n" and there is no sample caption anywhere (§0.4)', () => {
  const I = load();
  const r = rowsOf(I.renderSituational(SUBJECT));
  assert(/>24 of 34</.test(r.winSet1), 'Win first set (last 24 months) is not "24 of 34": ' + text(r.winSet1));
  assert(/>4 of 40</.test(r.brokenFirstSvc), 'a pbp row record is not "w of n"');
  const all = I.renderProfileModal(SUBJECT);
  assert(!/small sample|n &lt; 5|n < 5/.test(all), 'a sample caption is rendered');
});

check('under 5 the record shows and the rate dashes; thin rows are grey', () => {
  const I = load();
  const r = rowsOf(I.renderSituational(THIN));
  assert(/>2 of 3</.test(r.winSet1), 'the thin record is not shown');
  assert(r.winSet1.includes('font-weight:700;color:var(--text-label);text-align:right;">' + DASH), 'the thin rate is not a grey dash');
});

check('a missing tour figure dashes Vs tour, never 0', () => {
  const I = load();
  const r = rowsOf(I.renderSituational(SUBJECT));
  const t = text(r.breakOppServing);
  assert(/\|—\|/.test(t), 'breakOppServing has no dash');
  assert(!/0\.0pp|\|0%\|/.test(t), 'a missing tour figure rendered as zero');
});

check('rows with no natural norm dash Vs his norm (first break, break back, After set one)', () => {
  const I = load();
  const r = rowsOf(I.renderSituational(SUBJECT));
  ['firstBreak', 'breakBack', 'wonS1WonMatch', 'lostS1WonS2', 'wonS1Won20', 'lostS1FirstBreakS2'].forEach(id => {
    assert(/title="No norm defined for this row"[^>]*><span[^>]*>—</.test(r[id]), id + ' carries a norm');
  });
  assert(/title="His sets won rate: [\d.]+%"/.test(r.winSet1), 'Win first set has no sets-won norm');
});

check('bold = vs his norm on hold / break rows, vs tour elsewhere; lower-is-better inverted', () => {
  const I = load();
  const r = rowsOf(I.renderSituational(SUBJECT));
  // brokenFirstSvc 10.0% vs his broken norm 20.0% (hold 80%): −10.0pp, GOOD for him → green, bold
  assert(/font-size:13\.5px;font-weight:700;color:var\(--pos\);">−10\.0pp/.test(r.brokenFirstSvc), 'inverted row not green / bold: ' + text(r.brokenFirstSvc));
  assert(/font-size:12px;font-weight:400;color:var\(--pos\);">−10\.0pp/.test(r.brokenFirstSvc), 'its vs tour (−10.0 vs 20%) is not regular green');
  // holdWinSet 77.3% vs hold norm 80% → red bold
  assert(/font-size:13\.5px;font-weight:700;color:var\(--neg\);">−2\.7pp/.test(r.holdWinSet), 'hold row vs his norm not bold red');
  // Win first set: vs his norm regular, vs tour bold
  const cells = r.winSet1.split('title="');
  assert(/font-size:12px;font-weight:400/.test(cells[1]) && /^Tour rate[\s\S]*font-size:13\.5px;font-weight:700/.test(cells[2]),
    'Win first set: vs tour is not the bold figure');
});

check('Window re-derives the set rows; any scope the pbp store cannot honour dashes the pbp rows with its reason', () => {
  const I = load();
  I.state.ltWin = 'w52';
  let html = I.renderSituational(SUBJECT), r = rowsOf(html);
  assert(/>14 of 24</.test(r.winSet1), 'last 52 weeks');
  assert(/data-lt-row="brokenFirstSvc"[^>]*title="Point-by-point rows are held for the last 24 months/.test(html), 'pbp rows give no reason on Last 52');
  assert(!/>4 of 40</.test(r.brokenFirstSvc), 'a pbp record read under Last 52 weeks');
  I.state.ltWin = 'career';
  r = rowsOf(I.renderSituational(SUBJECT));
  assert(/>24 of 40</.test(r.winSet1), 'career is not 24 of 40: ' + text(r.winSet1));
  I.state.ltWin = 'm24'; I.state.ltSurf = 'clay';
  r = rowsOf(I.renderSituational(SUBJECT));
  assert(/>10 of 10</.test(r.winSet1), 'clay is not 10 of 10');
  I.state.ltSurf = 'all';
});

check('Filters: per-option counts, Applied chips, the title sample "n of N matches"', () => {
  const I = load();
  I.state.fmOpen = 'lt';
  let html = I.renderProfileModal(SUBJECT);
  assert(/data-pp4-pop="lt"[^>]*width:620px/.test(html), 'the 620px popover is not open');
  ['Price role', 'Format', 'Level', 'Opponent archetype'].forEach(g => assert(html.includes('>' + g + '<'), 'group ' + g + ' missing'));
  assert(/data-g="ltFmt" data-v="bo3"[^>]*>[\s\S]*?>34<\/span>/.test(html), 'Best of 3 count is not 34');
  assert(/>Done</.test(html) && /data-pp2="fm-reset" data-v="lt"/.test(html), 'Clear all / Done missing');
  I.state.fmOpen = null; I.state.ltFmt = 'bo5';
  html = I.renderProfileModal(SUBJECT);
  assert(/data-pp4-applied="lt"[\s\S]*>Best of 5</.test(html), 'no Applied chip');
  assert.strictEqual(I.ltTitleCount(SUBJECT), '0 of 34 matches');
  I.state.ltFmt = 'all';
  assert.strictEqual(I.ltTitleCount(SUBJECT), '34 matches · 180 service games');
});

check('tiles: Strongest / Weakest from the key gaps, neutral bar until clicked (§0.1)', () => {
  const I = load();
  I.state.ltPicked = null;
  let html = I.renderProfileModal(SUBJECT);
  assert(/>Strongest spot</.test(html) && />Weakest spot</.test(html), 'tiles missing');
  assert(!/data-lt-bar="on"/.test(html) && /data-lt-bar="off"[^>]*background:var\(--pp-x-bar-neutral\)/.test(html), 'a bar is blue before any click');
  const id = /data-pp2="lt-tile" data-v="(\w+)"/.exec(html)[1];
  I.state.ltPicked = id; I.state.ltBox = null;
  html = I.renderProfileModal(SUBJECT);
  assert(/data-lt-bar="on"[^>]*background:var\(--pp-x-link\)/.test(html), 'the last-clicked tile is not blue after its box closed');
  I.state.ltPicked = null;
});

check('the situation box lists the matches behind a set row: All = n, Happened = w', () => {
  const I = load();
  I.state.ltBox = 'winSet1';
  const html = I.renderProfileModal(SUBJECT);
  assert(/data-lt-box="spot"/.test(html) && /width:860px/.test(html), 'the 860px box is not open');
  assert.strictEqual((html.match(/>Yes</g) || []).length, 24);
  assert.strictEqual((html.match(/>No</g) || []).length, 10);
  I.state.ltSpotF = 'yes';
  assert.strictEqual((I.renderProfileModal(SUBJECT).match(/>No</g) || []).length, 0);
  I.state.ltSpotF = 'all'; I.state.ltBox = null;
});

check('the founder coverage wording rides on the table head', () => {
  const I = load();
  const html = I.renderSituational(SUBJECT);
  assert(/data-sit="head" title="These rows rest on the [^"]*not the full career figure shown in Career record/.test(html));
  assert(/counted per match, so a match can appear in several rows/.test(html));
});

check('a player with no data at all gets a sentence, not an empty table', () => {
  const I = load({ pbp: false });
  const html = I.renderSituational(NONE);
  assert(!/data-pp2="sit-toggle"/.test(html));
  assert(/no set-by-set or point-by-point data on record/.test(html));
});

check('a walkover is excluded from the set counts', () => {
  const I = load();
  const base = I.sitSetCountsOf([{ sets: W2, won: true }]).n;
  assert.strictEqual(I.sitSetCountsOf([{ sets: W2, won: true }, { sets: [{ p: 6, o: 0 }], won: true, walkover: true }]).n, base);
});

check('a closed group hides its rows but keeps its header', () => {
  const I = load();
  I.state.sitOpen = { 'Set outcomes': false };
  const html = I.renderSituational(SUBJECT);
  I.state.sitOpen = null;
  assert(/Set outcomes/.test(html) && !/Win first set/.test(html) && /Break of serve/.test(html));
});

// ── mutants: each must turn one of the probes red ─────────────────────────────
const MUT = [
  ['inversion dropped', 'var r = Math.round(gap * 10) / 10, e = inv ? -r : r;', 'var r = Math.round(gap * 10) / 10, e = r;'],
  ['bold rule swapped', 'var N = gapCell(!held || hard || !nm ? null : rate - nm.v, f.inv, !!f.hb,', 'var N = gapCell(!held || hard || !nm ? null : rate - nm.v, f.inv, !f.hb,'],
  ['pbp rows read under every scope', "var pbpOk = !!pbp && S.win === 'm24' && S.surf === 'all' && !ltFiltersOn(S);", 'var pbpOk = !!pbp;'],
  ['the window ignored', "var cut = S.win === 'w52' ? mkCut('l52') : S.win === 'm24' ? mkCut('l24') : null;", 'var cut = null;'],
  ['bars blue by default', "'%;border-radius:2px;background:' + pp4Bar(picked) + ';\"></span>' +\n        (r.base == null", "'%;border-radius:2px;background:' + pp4Bar(true) + ';\"></span>' +\n        (r.base == null"],
  ['record back to W–L', "rec: held && rec && n ? w + ' of ' + n.toLocaleString('en-US') : DASH,", "rec: held && rec && n ? w + '–' + (n - w) : DASH,"],
];
console.log('\n  mutation controls\n');
let survived = 0;
MUT.forEach(([name, from, to]) => {
  if (SRC.indexOf(from) < 0) { console.log('  SURVIVED ' + name + ' (target not in source)'); survived++; return; }
  const src2 = SRC.replace(from, to);
  const L = o => load(Object.assign({}, o, { src: src2 }));
  let red = 0;
  const run = (fn) => { try { fn(); } catch (e) { red++; } };
  run(() => { const r = rowsOf(L().renderSituational(SUBJECT));
    if (!/font-size:13\.5px;font-weight:700;color:var\(--pos\);">−10\.0pp/.test(r.brokenFirstSvc) || !/>4 of 40</.test(r.brokenFirstSvc)) throw 0; });
  run(() => { const I = L(); I.state.ltWin = 'w52'; const r = rowsOf(I.renderSituational(SUBJECT)); if (/>4 of 40</.test(r.brokenFirstSvc)) throw 0;
    if (!/>14 of 24</.test(r.winSet1)) throw 0;
    I.state.ltWin = 'career'; if (!/>24 of 40</.test(rowsOf(I.renderSituational(SUBJECT)).winSet1)) throw 0; });
  run(() => { const I = L(); I.state.ltPicked = null; if (/data-lt-bar="on"|data-lt-bar="off"[^>]*background:var\(--pp-x-link\)/.test(I.renderProfileModal(SUBJECT))) throw 0; });
  if (red) console.log('  caught   ' + name); else { console.log('  SURVIVED ' + name); survived++; }
});

console.log(`\nsituational panel (v4): ${pass} pass, ${fail} fail, ${survived} mutant(s) survived`);
if (fail || survived) { console.error('FAILED'); process.exit(1); }
