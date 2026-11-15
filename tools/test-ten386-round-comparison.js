'use strict';
// Tournaments → Reports — the data helpers the rebuilt Reports (tournaments-reports.js) still reads from the page.
//
// RETIRED 2026-11-15 (founder "Design wins", Tournaments tab rebuild; the old renderer is deleted): every check on the
// old Round comparison / Player progression / Head-to-head / sheet markup — winners only (2026-10-24 ruling, reversed:
// every player of the round is ranked per quarter, losers included), "Round avg · N players" over the whole round
// (now the mean of the rows shown), TOURX_ROUND_AVG_POP, Ring-blue --bar / --bar-2 bars + --track (now the design's
// grey .16 / quarter leader .36 / best blue), the white-35% 1px marker, the darker-track .tx-seg controls, the
// "All rounds" chip, the 2-col serve-left / rally-right grid, the H2H dual-line charts and pills, sentence-case card
// titles (now caps labels), the tourxMsFmt / tourxMatchTip / tourxSurname / tourxFmt helpers. The new design is locked by
// tools/test-tt-reports.mjs on the shipped module and a real-data fixture.
//
// KEPT here (still read by the module): tourxBuildTournament's Data 4 rule (no player / round without an ingested box
// score), tourxPlayerScore's set-score orientation and tourxSetsToWin (the fallback when a round has no match row), and
// tourxRating = Database → Ratings Elo (the Head to Head page reads it).
//
// Run: node tools/test-ten386-round-comparison.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('  \u2713', name); }
  else { fail++; console.log('  \u2717', name, got !== undefined ? '| got: ' + JSON.stringify(got) : ''); }
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

console.log('=== set-score orientation (tourxPlayerScore / tourxSetsToWin) ===');
const sandbox = { tourxTournamentCategory: () => 'ATP 500' };
vm.createContext(sandbox);
vm.runInContext(grab('tourxPlayerScore') + '\n' + grab('tourxSetsToWin') + '\nthis.score = tourxPlayerScore; this.setsToWin = tourxSetsToWin;', sandbox);
ok('score orientation: won 2–1 / lost 1–2 / walkover-ish "1 - 0" → null / Slam needs 3',
   sandbox.score('1 - 2', true, 2) === '2–1' && sandbox.score('2 - 1', false, 2) === '1–2' && sandbox.score('1 - 0', true, 2) === null
   && sandbox.score('2 - 1', true, 3) === null && sandbox.score('3 - 1', false, 3) === '1–3' && sandbox.score('2 - 0', null, 2) === null);
ok('an R128 ladder of unknown tier orients nothing (Slam bo5 vs Masters bo3 cannot be told)',
   (() => { const f = sandbox.tourxTournamentCategory; sandbox.tourxTournamentCategory = () => null;
            const r = sandbox.setsToWin({ name: 'X', roundLabels: ['R128'] }); const r2 = sandbox.setsToWin({ name: 'X', roundLabels: ['R32'] });
            sandbox.tourxTournamentCategory = () => 'Grand Slam'; const r3 = sandbox.setsToWin({ name: 'X', roundLabels: ['R128'] });
            sandbox.tourxTournamentCategory = f; return r === null && r2 === 2 && r3 === 3; })());

console.log('=== TEN-401 Data 4: no player / round without an ingested box score ===');
const buildBox = {
  tournamentProgression: { tournaments: { Fx: { rounds: ['R1', 'R2'], fieldAverage: { rounds: ['R1', 'R2'], metrics: {} }, players: [
    { name: 'A. Data', eliminated: false, rounds: [{ round: 'R1', opponent: 'C. Ghost', resultDisplay: '2 - 0', metrics: { firstServePct: 60 } }, { round: 'R2', opponent: 'B. Data', resultDisplay: '2 - 1', metrics: { firstServePct: 62 } }] },
    { name: 'B. Data', eliminated: true, rounds: [{ round: 'R2', opponent: 'A. Data', resultDisplay: '2 - 1', metrics: { firstServePct: 58 } }] },
    { name: 'C. Ghost', eliminated: true, rounds: [{ round: 'R1', opponent: 'A. Data', resultDisplay: '2 - 0' }] },
    { name: 'D. Empty', eliminated: true, rounds: [{ round: 'R1', opponent: 'X', metrics: { firstServePct: null } }] },
  ] } } },
  tourxRoundLabelsFor: () => ['R16', 'QF'], progressionByesCredible: () => true,
  TOURX_METRICS: [{ key: 'firstServePct' }, { key: 'serveRating' }, { key: 'returnRating' }, { key: 'dominanceRatio' }, { key: 'pressurePct' }],
  TOURX_DERIVED_KEYS: ['serveRating', 'returnRating', 'dominanceRatio', 'pressurePct'],
  tourxDerivedMetrics: () => ({ serveRating: null, returnRating: null, dominanceRatio: null, pressurePct: null }),
  TOURX_REACHED_PHRASE: {},
};
vm.createContext(buildBox);
vm.runInContext(grab('tourxGroupFor') + '\n' + grab('tourxBuildTournament') + '\nthis.build = tourxBuildTournament;', buildBox);
const BT = buildBox.build('Fx');
ok('a player whose rounds carry no box score is left out (no name without data)', BT.players.map(p => p.name).join(',') === 'A. Data,B. Data', BT.players.map(p => p.name));
ok('nRounds counts ingested rounds only', BT.players[0].nRounds === 2 && BT.players[1].nRounds === 1);
ok('the feed score rides along per round (for the tooltip / sheet)', BT.players[0].results[1] === '2 - 1' && BT.players[0].opponents[0] === 'C. Ghost');

console.log('=== TEN-401 Data 4: Reports Elo = the weekly Elo Database → Ratings shows ===');
const elo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'elo-ratings.json'), 'utf8'));
const eloBox = { eloRatings: elo };
vm.createContext(eloBox);
vm.runInContext(grab('psEloNorm') + '\n' + grab('tourxRating') + '\nthis.rating = tourxRating;', eloBox);
// Database → Ratings path (DatabaseTab ratEloRec + ratVal 'elo.all'), sliced from the page: same file, same keys.
const dbBox = { ELO: elo };
vm.createContext(dbBox);
vm.runInContext(grab('ratEloKey') + '\n' + grab('ratLastTok') + '\n' + grab('ratEloRec') + '\nthis.rec = ratEloRec;', dbBox);
const names = Object.keys(elo.elo).slice(0, 60).map(k => { const [sur, ini] = k.split('|'); return ini.toUpperCase() + '. ' + sur.replace(/\b\w/g, c => c.toUpperCase()); });
const mism = names.filter(n => { const r = dbBox.rec(n); const want = r && r.all && typeof r.all.rating === 'number' ? String(Math.round(r.all.rating)) : null; return eloBox.rating(n) !== want; });
ok('tourxRating === Database → Ratings Elo (elo[k].all.rating) for 60 stored players', mism.length === 0, mism.slice(0, 5));
ok('a player not in the store is null (→ grey em dash), never a derived figure', eloBox.rating('Q. Nobodyxyz') === null);
ok('no `1500 + rating × 1000` style derivation in tourxRating', !/1500|\* *1000/.test(grab('tourxRating')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
