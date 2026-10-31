#!/usr/bin/env node
// Founder 2026-10-31 (publish-and-qualifying): qualifying matches are carded on Today's Matches, labelled Q1 / Q2 (or
// "Qualifying" when the round is unknown) in the round slot, and filtered by their own chip "<Event> · Qualifying".
//
//  A. board-qualifying.js on REAL rows (tools/fixtures/board-qualifying/real.json: api-tennis get_fixtures for 24-25 and
//     31 Oct + the deployed draws.json): Basel / Vienna qualifying (flagged) -> Q1 / Q2; the 14 Paris rows of 31 Oct
//     (flag null, no round) -> qualifying, no round; the SFs and Almaty -> main draw.
//  B. the pipeline cards a flagged qualifying fixture (isCardableFixture) and builds the board fields.
//  C. the page helpers, sliced from the shipped dashboard and executed: the round label, the chip key / name, the
//     filter and the header count.
// Each group ends with mutants that must turn it red.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const BQ = require(path.join(ROOT, 'board-qualifying.js'));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/board-qualifying/real.json'), 'utf8'));
const TIER = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/points-at-risk/atp-tier-map-v1.json'), 'utf8'));
const HTML = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'board-qualifying.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };

function tally(bq) {
  const idx = bq.buildIndex(FX.draws, TIER), out = {};
  for (const f of FX.fixtures) {
    const r = bq.classify(f, idx);
    const k = `${f.tournament_name}|${f.event_date}|${r.qualifying}|${r.round || '-'}|${r.basis || '-'}`;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
function checkA(bq) {
  const t = tally(bq);
  assert.strictEqual(t['Basel|2026-10-24|true|Q1|flag'], 8, 'Basel 24 Oct: 8 Q1 ' + JSON.stringify(t));
  assert.strictEqual(t['Basel|2026-10-25|true|Q2|flag'], 4, 'Basel 25 Oct: 4 Q2');
  assert.strictEqual(t['Vienna|2026-10-24|true|Q1|flag'], 8, 'Vienna 24 Oct: 8 Q1');
  assert.strictEqual(t['Vienna|2026-10-25|true|Q2|flag'], 4, 'Vienna 25 Oct: 4 Q2');
  assert.strictEqual(t['Paris|2026-10-31|true|-|before-main-draw'], 14, 'Paris 31 Oct: 14 qualifying, no round ' + JSON.stringify(t));
  assert.strictEqual(t['Vienna|2026-10-31|false|-|-'], 2, 'the Vienna SFs stay main draw');
  assert.strictEqual(t['Basel|2026-10-31|false|-|-'], 2, 'the Basel SFs stay main draw');
  assert.strictEqual(t['Almaty|2026-10-24|false|-|-'], 2, 'Almaty (no sheet in the fixture) stays main draw');
  // a flagged row whose qualifying sheet is not posted: qualifying, round blank (never guessed)
  const noSheet = JSON.parse(JSON.stringify(FX.draws)); noSheet.tournaments['328'].qualifying = { status: 'not_posted' };
  const r = bq.classify(FX.fixtures.find(f => f.tournament_name === 'Basel' && /Semi-finals/.test(f.tournament_round || '') && f.event_qualification === 'True'), bq.buildIndex(noSheet, TIER));
  assert.strictEqual(r.qualifying, true); assert.strictEqual(r.round, null, 'no sheet depth -> no round');
}
console.log('A · board-qualifying.js on real rows');
check('Basel / Vienna Q1 / Q2 from the flag + the sheet depth; Paris 14 of 14 qualifying with no round; SFs main draw', () => checkA(BQ));
const load = src => { const m = { exports: {} }; new Function('module', 'globalThis', src)(m, {}); return m.exports; };
for (const [name, from, to] of [
  ['the date test dropped (a main-draw row before the start would also count)', "String(f.event_date) < String(draw.startDate)", 'true'],
  ['a main-draw entrant not refused', "if (a && b && !mk.has(a) && !mk.has(b)) basis = 'before-main-draw';", "basis = 'before-main-draw';"],
  ['a round guessed without the sheet depth', "const k = roundWord(f.tournament_round);", "const k = roundWord(f.tournament_round); if (k != null) return { qualifying: true, round: 'Q' + (2 - k), basis };"],
  ['the flag ignored', "const flag = f && f.event_qualification === 'True';", 'const flag = false;'],
]) {
  check('MUTANT caught: ' + name, () => {
    assert.ok(SRC.includes(from), 'anchor missing');
    const mut = load(SRC.replace(from, to));
    let red = false; try { checkA(mut); } catch (e) { red = true; }
    // the "date dropped" and "entrant not refused" mutants only bite on a main-draw row before the start: add one
    if (!red) {
      const idx = mut.buildIndex(FX.draws, TIER);
      const zv = mut.classify({ event_date: '2026-10-31', tournament_key: 1725, first_player_key: '1980', second_player_key: '2849', event_qualification: null }, idx);
      const late = mut.classify({ event_date: '2026-11-02', tournament_key: 1725, first_player_key: '9', second_player_key: '8', event_qualification: null }, idx);
      red = zv.qualifying || late.qualifying;
    }
    assert.ok(red, 'the mutant survived');
  });
}
check('a main-draw entrant before the start is NOT qualifying (Zverev 1980 v Musetti 2849, 31 Oct, Paris)', () => {
  const r = BQ.classify({ event_date: '2026-10-31', tournament_key: 1725, first_player_key: '1980', second_player_key: '2849', event_qualification: null }, BQ.buildIndex(FX.draws, TIER));
  assert.strictEqual(r.qualifying, false);
});
check('a fixture on the main-draw start is NOT qualifying by date (2 Nov, Paris)', () => {
  const r = BQ.classify({ event_date: '2026-11-02', tournament_key: 1725, first_player_key: '9', second_player_key: '8', event_qualification: null }, BQ.buildIndex(FX.draws, TIER));
  assert.strictEqual(r.qualifying, false);
});

console.log('B · the pipeline cards qualifying');
const P = require(path.join(ROOT, 'bsp-pipeline.js'));
const fx = o => Object.assign({ event_key: 1, event_status: '', event_live: '0', event_qualification: 'False', event_winner: null, first_player_key: 1, second_player_key: 2 }, o);
check('isCardableFixture: a flagged qualifying fixture is cardable', () => assert.strictEqual(P.isCardableFixture(fx({ event_qualification: 'True' })), true));
const PIPE = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
check('both card builders carry boardQualifying / qualifyingRound / qualifyingBasis; `qualifying` stays the raw feed flag',
  () => { assert.strictEqual((PIPE.match(/\.\.\.boardQualFields\(fixture\),/g) || []).length, 2); assert.strictEqual((PIPE.match(/qualifying: fixture\.event_qualification === 'True',   \/\/ founder ruling 2026-10-18/g) || []).length, 2); });

console.log('C · the page');
function fn(name, html = HTML) {
  const HTML_ = html;
  const at = HTML_.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, 'function ' + name);
  const nl = HTML_.indexOf('\n', at + 1), line = HTML_.slice(at + 1, nl);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  let d = 0, i = HTML_.indexOf('{', at);
  for (; i < HTML_.length; i++) { if (HTML_[i] === '{') d++; else if (HTML_[i] === '}' && --d === 0) break; }
  return HTML_.slice(at + 1, i + 1);
}
const constLine = (n, html = HTML) => { const m = html.match(new RegExp('\\nconst ' + n + ' = [^\\n]*')); assert.ok(m, n); return m[0]; };
const page = (html) => new Function(`
  const sfEventName = t => ({ 'ATP Paris': 'Paris Masters', 'ATP Vienna': 'Vienna Open' })[t] || t;
  const roundBadgeText = r => (/semi-finals/i.test(r || '') ? 'SF' : r ? 'R' : '');
  ${constLine('MX_QUAL_SUFFIX', html)} ${['mxEventName', 'mxIsQual', 'mxRoundLabel', 'mxTourKey', 'mxTourKeyName'].map(n => fn(n, html)).join('\n')}
  return { mxRoundLabel, mxTourKey, mxTourKeyName };`)();
const board = [
  { tour: 'ATP Paris', boardQualifying: true, qualifyingRound: null, tournamentRound: null },
  { tour: 'ATP Paris', boardQualifying: true, qualifyingRound: 'Q2', tournamentRound: 'ATP Paris - Final' },
  { tour: 'ATP Vienna', boardQualifying: false, tournamentRound: 'ATP Vienna - Semi-finals' },
  { tour: 'ATP Vienna', qualifying: true, tournamentRound: 'ATP Vienna - Semi-finals' },   // a board built before the field
];
function checkC(api) {
  assert.deepStrictEqual(board.map(api.mxRoundLabel), ['Qualifying', 'Q2', 'SF', 'Qualifying'], 'round label');
  const keys = [...new Set(board.map(api.mxTourKey))];
  assert.deepStrictEqual(keys.map(api.mxTourKeyName), ['Paris Masters · Qualifying', 'Vienna Open', 'Vienna Open · Qualifying'], 'chips');
  const only = new Set(['ATP Paris · Qualifying']);
  assert.strictEqual(board.filter(m => only.has(api.mxTourKey(m))).length, 2, 'the qualifying chip shows only its cards');
  assert.strictEqual(new Set(board.map(api.mxTourKey)).size, 3, 'header Tournaments = distinct chips');
}
check('label Qualifying / Q2 / SF; chips "Paris Masters · Qualifying" beside the main draw; the chip filters; count = chips', () => checkC(page(HTML)));
check('the shipped page reads the label, chip key and count through these helpers', () => {
  assert.ok(HTML.includes('const roundBadge = mxRoundLabel(m);'));
  assert.ok(HTML.includes('if (state.tournaments.size && !state.tournaments.has(mxTourKey(m))) return false;'));
  assert.ok(HTML.includes('const tours = new Set(shown.map(mxTourKey).filter(Boolean)).size;'));
  assert.ok(HTML.includes('.map(mxTourKey).filter(Boolean)'));
});
check('MUTANT caught: qualifying cards share the main-draw chip', () => {
  const mut = HTML.replace("function mxTourKey(m){ return m && m.tour ? m.tour + (mxIsQual(m) ? MX_QUAL_SUFFIX : '') : ''; }", "function mxTourKey(m){ return m && m.tour ? m.tour : ''; }");
  assert.notStrictEqual(mut, HTML); assert.throws(() => checkC(page(mut)));
});
check('MUTANT caught: the round slot keeps the feed word ("SF") on a qualifying card', () => {
  const mut = HTML.replace("function mxRoundLabel(m){ return mxIsQual(m) ? (m.qualifyingRound || 'Qualifying') : (roundBadgeText(m && m.tournamentRound) || ''); }", "function mxRoundLabel(m){ return roundBadgeText(m && m.tournamentRound) || ''; }");
  assert.notStrictEqual(mut, HTML); assert.throws(() => checkC(page(mut)));
});

console.log(`\nboard-qualifying: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
