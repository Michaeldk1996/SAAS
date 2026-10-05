'use strict';
// TEN-386 regression guard — Tournaments → Reports → Round comparison.
//
// Founder ruling (2026-10-05, interaction eaf078f8): a selected round lists EVERY
// player with a box score in it — the QF losers (Zverev, Rublev, Khachanov,
// Cerundolo at Beijing) belong in the QF comparison — and each row carries the
// round's outcome as a W/L letter (`--pos` / `--neg`). The name is never dimmed.
//
// The outcome comes from the draw-structure `maxWonIdx` (tourxBuildTournament),
// not from the next round's metrics: a walkover or stat-less next match must not
// flip a won round to L (independent review, TEN-386). An unknown eliminated flag
// prints no letter at the player's latest round.
//
// This test SLICES the real tourxRoundChartsHtml + tourxRoundViewHtml out of the
// dashboard and executes them on a fixture; it does not re-implement the rule.
//
// Run: node tools/test-ten386-round-comparison.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, got !== undefined ? '| got: ' + JSON.stringify(got) : ''); }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
  throw new Error('unbalanced ' + name);
}

const KEYS = ['serveRating', 'firstServePct', 'returnRating'];
const sandbox = {
  TOURX_METRICS: KEYS.map(k => ({ key: k, label: k, short: k, kind: 'num' })),
  TOURX_RV_CAP: 4,
  tourxActiveLabels: ['R32', 'R16', 'QF', 'SF', 'F'],
  tourxState: { roundIdx: null, rvMetrics: [], cmpPlayers: [] },
  tourxRoundFilterBarHtml: () => '',
  tourxGridOrder: ms => ms,
  tourxRatingSpan: () => '',
  tourxFmt: v => String(v),
};
vm.createContext(sandbox);
vm.runInContext(grab('tourxRoundChartsHtml') + '\n' + grab('tourxRoundViewHtml') + '\nthis.view = tourxRoundViewHtml;', sandbox);

// Rounds R1,R2,QF = R32,R16,QF. data[key][i] = value at round i (null = no box score).
function player(name, boxes, eliminated, maxWonIdx, known = true) {
  const data = {};
  KEYS.forEach((k, j) => { data[k] = boxes.map(b => (b ? 200 + j + name.charCodeAt(0) : null)); });
  const played = boxes.map((b, i) => (b ? i : -1)).filter(i => i >= 0);
  return { name, data, eliminated, eliminatedKnown: known, maxWonIdx,
           drawDepth: played.length ? played[played.length - 1] + 1 : 0, nRounds: played.length };
}
const T = {
  name: 'Fixture Open', rounds: ['R1', 'R2', 'QF'], field: { metrics: {} },
  players: [
    player('A. Alive', [1, 1, 1], false, 2),          // won R32, R16, QF (still in)
    player('B. Beaten', [1, 1, 1], true, 1),          // lost the QF
    player('C. Walkover', [1, 0, 1], true, 0),        // R16 walkover win (no box), lost QF
    player('D. Opener', [1, 0, 0], true, -1),         // lost R32
    player('E. Unknown', [1, 1, 0], false, 1, false), // eliminated flag unknown (coerced false)
  ],
};

// Rows of the FIRST metric card: "<W|L|-> <surname>".
function rows(roundIdx) {
  sandbox.tourxState.roundIdx = roundIdx;
  const out = sandbox.view(T);
  const card = out.split('<div style="border:1px solid var(--edge-6)')[1] || '';
  return [...card.matchAll(/<div style="display:grid;grid-template-columns:118px[\s\S]*?(?=<div style="display:grid;grid-template-columns:118px|$)/g)].map(m => {
    const r = m[0];
    const letter = /color:var\(--pos\);">W</.test(r) ? 'W' : /color:var\(--neg\);">L</.test(r) ? 'L' : '-';
    const name = (r.match(/text-overflow:ellipsis;">([^<]+)</) || [])[1];
    return letter + ' ' + name;
  }).sort();
}

console.log('=== QF: winners AND losers, each with its outcome ===');
const qf = rows(2);
ok('QF lists all 3 players with a QF box score (losers included)', qf.length === 3, qf);
ok('QF winner reads W', qf.includes('W Alive'), qf);
ok('QF loser reads L (shown, not hidden)', qf.includes('L Beaten'), qf);
ok('QF loser after an R16 walkover reads L', qf.includes('L Walkover'), qf);

console.log('=== R32: a walkover in the NEXT round never flips a won round to L ===');
const r32 = rows(0);
ok('R32 lists all 5 players', r32.length === 5, r32);
ok('R32 walkover-winner reads W (outcome from the draw, not the next box score)', r32.includes('W Walkover'), r32);
ok('R32 opener loser reads L', r32.includes('L Opener'), r32);
ok('R32 unknown-flag player who advanced reads W', r32.includes('W Unknown'), r32);

console.log('=== R16: unknown eliminated flag prints no letter at the latest round ===');
const r16 = rows(1);
ok('R16 lists the 3 players with an R16 box score', r16.length === 3, r16);
ok('R16 unknown-flag player has no W/L letter', r16.includes('- Unknown'), r16);

console.log('=== copy + no stale winners-only state ===');
sandbox.tourxState.roundIdx = 2;
const out = sandbox.view(T);
ok('note says W won the round, L lost it', /3 players with a box score in QF — W won the round, L lost it\./.test(out));
ok('name is never dimmed for losing (surname stays --text)', !/color:var\(--text-label\);overflow:hidden;text-overflow:ellipsis;/.test(out));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
