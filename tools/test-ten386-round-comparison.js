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
// TEN-401 (step 7 · Tournaments → Reports) rulings are locked further down, on the same
// sliced code: bars Ring blue (leader --bar, rest --bar-2) with a white-35% dashed average
// marker; the bar tooltip line and its set-score orientation; the match-stats sheet
// (better value white 700, the other grey 500); best heat cell white 6% + 700; the
// darker-track segmented controls; Data 4 (no player / round without an ingested box
// score) and the Elo source (= Database → Ratings, elo-ratings.json `elo[k].all`).
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
  tourxEsc: s => String(s).replace(/'/g, "\\'"),
  tourxTournamentCategory: () => 'ATP 500',
};
vm.createContext(sandbox);
vm.runInContext(['tourxSurname', 'tourxRpEsc', 'tourxRoundOutcome', 'tourxPlayerScore', 'tourxSetsToWin', 'tourxMatchTip', 'tourxRoundChartsHtml', 'tourxRoundViewHtml']
  .map(grab).join('\n') + '\nthis.view = tourxRoundViewHtml; this.score = tourxPlayerScore; this.setsToWin = tourxSetsToWin;', sandbox);

// Rounds R1,R2,QF = R32,R16,QF. data[key][i] = value at round i (null = no box score).
function player(name, boxes, eliminated, maxWonIdx, known = true, results = []) {
  const data = {};
  KEYS.forEach((k, j) => { data[k] = boxes.map(b => (b ? 200 + j + name.charCodeAt(0) : null)); });
  const played = boxes.map((b, i) => (b ? i : -1)).filter(i => i >= 0);
  return { name, data, eliminated, eliminatedKnown: known, maxWonIdx,
           opponents: boxes.map((b, i) => (b ? 'Opp' + i : null)), results,
           drawDepth: played.length ? played[played.length - 1] + 1 : 0, nRounds: played.length };
}
const T = {
  name: 'Fixture Open', rounds: ['R1', 'R2', 'QF'], field: { metrics: {} },
  players: [
    player('A. Alive', [1, 1, 1], false, 2, true, ['2 - 0', '1 - 2', '0 - 2']),  // won R32, R16, QF (still in)
    player('B. Beaten', [1, 1, 1], true, 1, true, [null, null, '1 - 0']),       // lost the QF (a retirement score)
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


// ======================================================================
// TEN-401 · step 7 Tournaments → Reports (founder ticket item 9 + Data 4)
// ======================================================================
sandbox.tourxState.roundIdx = 2;
const qfOut = sandbox.view(T);
const qfCard = qfOut.split('<div style="border:1px solid var(--edge-6)')[1] || '';
const bars = [...qfCard.matchAll(/class="tourx-rbar" style="[^"]*background:(var\(--bar(?:-2)?\))/g)].map(m => m[1]);
console.log('=== TEN-401 item 9: Round comparison bars ===');
ok('every bar is Ring blue: the leader --bar solid, the rest --bar-2 (45%)',
   bars.length === 3 && bars[0] === 'var(--bar)' && bars.slice(1).every(b => b === 'var(--bar-2)'), bars);
ok('no white / grey bar fills survive (the pre-TEN-401 --text / --text-label bars)',
   !/background:var\(--text(?:-label)?\);border-radius:5px;/.test(qfOut));
ok('bar track is --track', /class="tourx-rtrack" style="[^"]*background:var\(--track\);"/.test(qfCard));
ok('the dashed average marker is white 35%', /border-left:1px dashed color-mix\(in srgb, var\(--text\) 35%, transparent\)/.test(qfCard));
const vals = [...qfCard.matchAll(/text-align:right;font-size:11px;font-weight:700;font-family:'IBM Plex Mono',monospace;color:(var\([^)]+\))/g)].map(m => m[1]);
ok("the leader's value is white, the rest grey", vals[0] === 'var(--text)' && vals.slice(1).every(v => v === 'var(--text-label)'), vals);
ok('each bar opens the match-stats sheet for that player and round',
   /class="tourx-rcell" onclick="tourxOpenMatchSheet\('A\. Alive', 2\)"/.test(qfCard));

console.log('=== TEN-401 item 9: bar tooltip (player-oriented outcome + score) ===');
const tips = [...qfCard.matchAll(/<span class="tourx-rmeta">([^<]+)<\/span>/g)].map(m => m[1]);
ok('QF winner tooltip: "A. Alive vs Opp2 · QF · won 2–0" (feed "0 - 2" oriented to the winner)', tips.includes('A. Alive vs Opp2 · QF · won 2–0'), tips);
ok('a retirement score (winner below 2 sets) is never oriented: "lost" with no score', tips.includes('B. Beaten vs Opp2 · QF · lost'), tips);
ok('no outcome known → no won/lost word', (() => { sandbox.tourxState.roundIdx = 1; const o = sandbox.view(T); sandbox.tourxState.roundIdx = 2; return /E\. Unknown vs Opp1 · R16<\/span>/.test(o); })());
ok('score orientation: won 2–1 / lost 1–2 / walkover-ish "1 - 0" → null / Slam needs 3',
   sandbox.score('1 - 2', true, 2) === '2–1' && sandbox.score('2 - 1', false, 2) === '1–2' && sandbox.score('1 - 0', true, 2) === null
   && sandbox.score('2 - 1', true, 3) === null && sandbox.score('3 - 1', false, 3) === '1–3' && sandbox.score('2 - 0', null, 2) === null);
ok('an R128 ladder of unknown tier orients nothing (Slam bo5 vs Masters bo3 cannot be told)',
   (() => { const f = sandbox.tourxTournamentCategory; sandbox.tourxTournamentCategory = () => null;
            const r = sandbox.setsToWin({ name: 'X', roundLabels: ['R128'] }); const r2 = sandbox.setsToWin({ name: 'X', roundLabels: ['R32'] });
            sandbox.tourxTournamentCategory = () => 'Grand Slam'; const r3 = sandbox.setsToWin({ name: 'X', roundLabels: ['R128'] });
            sandbox.tourxTournamentCategory = f; return r === null && r2 === 2 && r3 === 3; })());

// ---- Match-stats sheet ----
console.log('=== TEN-401 item 9: match-stats sheet ===');
const sheetBox = { TOURX_METRICS: [{ key: 'firstServePct', label: '1st serve %', kind: 'pct' }, { key: 'unforcedErrorsPct', label: 'Unforced errors', kind: 'perpoint' }, { key: 'serveRating', label: 'Serve rating', kind: 'rating' }],
  tourxActiveLabels: ['R32', 'R16', 'QF', 'SF', 'F'], tournamentProgression: { fetchedAt: '2026-10-05T10:00:00Z' },
  tourxTournamentCategory: () => 'ATP 500', tourxConditionRegistry: () => [{ name: 'Fixture Open', surface: 'Hard' }] };
vm.createContext(sheetBox);
vm.runInContext(['tourxFmt', 'tourxMsFmt', 'tourxSurname', 'tourxRpEsc', 'tourxReportYear', 'tourxRoundOutcome', 'tourxPlayerScore', 'tourxSetsToWin', 'tourxMatchSheetHtml'].map(grab).join('\n') + '\nthis.sheet = tourxMatchSheetHtml;', sheetBox);
const mk = (name, opp, d) => ({ name, opponents: [null, null, opp], results: [null, null, '0 - 2'], eliminated: name !== 'A. Alive', eliminatedKnown: true, maxWonIdx: name === 'A. Alive' ? 2 : 1, drawDepth: 3,
  data: { firstServePct: [null, null, d[0]], unforcedErrorsPct: [null, null, d[1]], serveRating: [null, null, d[2]] } });
const ST = { name: 'Fixture Open', rounds: ['R1', 'R2', 'QF'], roundLabels: ['R32', 'R16', 'QF', 'SF', 'F'],
  players: [mk('A. Alive', 'B. Beaten', [70, 12, null]), mk('B. Beaten', 'A. Alive', [64, 18, 280])] };
const sh = sheetBox.sheet(ST, 'A. Alive', 2);
const cellsOf = label => { const r = sh.split(label)[1] || ''; return [...r.matchAll(/class="tourx-msv( better)?" style="[^"]*font-weight:(\d+);color:(var\([^)]+\));">([^<]+)</g)].slice(0, 2).map(m => [m[4], m[2], m[3]]); };
ok('sheet is a pop-up sheet over the content-area scrim', /class="tourx-msscrim" data-tourx-ms-scrim="1"/.test(sh) && /class="tourx-mssheet"/.test(sh));
ok('header: "A. Alive v B. Beaten" + "Fixture Open 2026 · QF · hard · Alive won 2–0"', /A\. Alive <span style="color:var\(--text-label\);">v<\/span> B\. Beaten/.test(sh) && /Fixture Open 2026 · QF · hard · Alive won 2–0/.test(sh));
ok('better value white 700, the other grey 500 (1st serve 70.0% v 64.0%)', JSON.stringify(cellsOf('1st serve %')) === JSON.stringify([['70.0%', '700', 'var(--text)'], ['64.0%', '500', 'var(--text-label)']]), cellsOf('1st serve %'));
ok('unforced errors: LOWER is better (0.12 v 0.18)', JSON.stringify(cellsOf('Unforced errors')) === JSON.stringify([['0.12', '700', 'var(--text)'], ['0.18', '500', 'var(--text-label)']]), cellsOf('Unforced errors'));
ok('a side with no figure is a grey em dash and marks neither side better', JSON.stringify(cellsOf('Serve rating')) === JSON.stringify([['—', '500', 'var(--text-label)'], ['280', '500', 'var(--text-label)']]), cellsOf('Serve rating'));
ok('the sheet carries no blue', !/var\(--(bar|link|viz-lead|open-card)\)/.test(sh));
const css = html.slice(html.indexOf('.tourx-msscrim{'), html.indexOf('@media print{ .tourx-msscrim'));
ok('sheet CSS: --card + 1px --edge-10 + --shadow-modal; scrim --backdrop + blur(3px), from --sf-side, clip-path inset(0)',
   /\.tourx-mssheet\{[^}]*background:var\(--card\);[^}]*border:1px solid var\(--edge-10\);[^}]*box-shadow:var\(--shadow-modal\)/.test(css)
   && /inset:0 0 0 var\(--sf-side, 0px\);[^}]*background:var\(--backdrop\); backdrop-filter:blur\(3px\);[^}]*clip-path:inset\(0\)/.test(css));
ok('the sheet registers its closer on window.sfOverlayClosers and closes on Esc',
   /sfOverlayClosers = window\.sfOverlayClosers \|\| \[\]\)\.push\(tourxCloseMatchSheet\)/.test(html) && /if \(e\.key === 'Escape'\) tourxCloseMatchSheet\(\);/.test(html));

// ---- Player progression heat cells ----
console.log('=== TEN-401 item 9: Player progression heat cells ===');
const heatBox = { tourxFmt: v => String(v), tourxEsc: s => String(s), tourxHexA: (c, a) => c, tourxRpEsc: s => String(s) };
vm.createContext(heatBox);
vm.runInContext(grab('tourxProgressionHeatHtml') + '\nthis.heat = tourxProgressionHeatHtml;', heatBox);
const heat = heatBox.heat([{ full: 'A. Alive', name: 'Alive', rating: '2100', vals: [60, 71], color: 'var(--text)', focused: false },
                           { full: 'B. Beaten', name: 'Beaten', rating: null, vals: [65, null], color: 'var(--text-soft)', focused: false }], ['R32', 'R16'], 'pct', false, [], false);
const best = [...heat.matchAll(/class="tourx-hcell open( best)?" onclick="tourxOpenMatchSheet\('([^']+)', (\d)\)"[^>]*>([^<]+)</g)].map(m => [m[2], m[3], !!m[1], m[4]]);
ok('exactly one best cell per round with >=2 values; a lone value is not "best"',
   JSON.stringify(best.filter(b => b[2])) === JSON.stringify([['B. Beaten', '0', true, '65']]), best);
ok('a populated cell opens that player\'s match in that round', best.length === 3 && best.some(b => b[0] === 'A. Alive' && b[1] === '1'));
const hcss = html.slice(html.indexOf('.tourx-hcell{'), html.indexOf('/* Match-stats sheet (TEN-401'));
ok('best cell = white 6% + 700; hovered cell = --selected; no blue',
   /\.tourx-hcell\.best\{ background:color-mix\(in srgb, var\(--text\) 6%, transparent\); font-weight:700; \}/.test(hcss)
   && /\.tourx-hcell\.open:hover\{ background:var\(--selected\); \}/.test(hcss) && !/--bar|--link/.test(hcss));

// ---- Darker track + no blue selected states ----
console.log('=== TEN-401 item 2: darker-track segmented controls ===');
const seg = html.slice(html.indexOf('.tx-segwrap{'), html.indexOf('.tourx-dd{'));
ok('track --card + 1px --edge-6', /\.tx-segwrap\{[^}]*background:var\(--card\); border:1px solid var\(--edge-6\)/.test(seg));
ok('selected --inner + 1px --edge-10, white 700; idle --text-label', /\.tx-seg\.on\{ background:var\(--inner\); border-color:var\(--edge-10\); color:var\(--text\); font-weight:700; \}/.test(seg) && /\.tx-seg\{[^}]*color:var\(--text-label\)/.test(seg));
ok('idle hover adds no edge (reference)', !/\.tx-seg:hover/.test(seg));
const rr = grab('renderTourxReports');
ok('View toggle and tournament picker both ride tourxSegItem on a .tx-segwrap track',
   /tourxSegItem\(name === tourxState\.tour, label, `tourxSelectTour\('\$\{tourxEsc\(name\)\}'\)`, 'tour'\)/.test(rr) && /tourxSegItem\(tourxState\.view === v, l,/.test(rr) && /class="tx-segwrap tourx-tourpick"/.test(rr));
ok('round chips + metric chips ride the same track', /tx-segwrap/.test(grab('tourxRoundChipRowHtml')) && /tourxSegItem\(a, label, `tourxToggleRvMetric\('\$\{key\}'\)`, 'chip'\)/.test(grab('tourxMetricFilterRowHtml')));
const reportsSrc = ['renderTourxReports', 'tourxSegItem', 'tourxRoundChipRowHtml', 'tourxMetricFilterRowHtml', 'tourxPPControlsHtml', 'tourxRoundChartsHtml',
  'tourxProgressionHeatHtml', 'tourxH2HViewHtml', 'tourxH2HChartSvg', 'tourxMatchSheetHtml'].map(grab).join('\n');
ok('no blue text / selected state anywhere in Reports (no color:var(--bar) / --link, no blue fills on chips)',
   !/color:\s*var\(--(bar|viz-lead|link)\)/.test(reportsSrc) && !/color:\$\{TOURX_H2H_A\}/.test(reportsSrc) && !/TOURX_ACC/.test(reportsSrc) && !/fill="\$\{cA\}">/.test(reportsSrc));
ok('H2H: player A --viz-lead, player B --viz-white-lead, field white dashed',
   /const TOURX_H2H_A = 'var\(--viz-lead\)', TOURX_H2H_B = 'var\(--viz-white-lead\)', TOURX_H2H_FIELD = 'var\(--viz-white-lead\)';/.test(html)
   && /stroke="\$\{TOURX_H2H_FIELD\}" stroke-width="1\.3" stroke-dasharray="4 4"/.test(grab('tourxH2HChartSvg')));
ok('H2H pills: --card + a 1px edge in the series colour', /fill="var\(--card\)" stroke="\$\{c\}" stroke-width="1"\/>/.test(grab('tourxH2HChartSvg')));
const ddcss = html.slice(html.indexOf('.tourx-ddpanel{'), html.indexOf('.tourx-chev{'));
ok('add-player / H2H menus = compact site menu (--card, 1px --edge-10, radius 10, padding 4, --shadow-menu; rows hover --inner, selected --selected)',
   /background:var\(--card\); border:1px solid var\(--edge-10\); border-radius:10px; box-shadow:var\(--shadow-menu\)/.test(ddcss) && /padding:4px/.test(ddcss)
   && /\.tourx-ddopt:hover\{ background:var\(--inner\); \}/.test(ddcss) && /\.tourx-ddopt\.sel\{ background:var\(--selected\); \}/.test(ddcss));
const ppc = grab('tourxPPControlsHtml');
ok('player chips and the add-player trigger are inner tone with no edge',
   /background:\$\{focused \? 'var\(--selected\)' : 'var\(--inner\)'\};border:1px solid \$\{focused \? 'var\(--edge-10\)' : 'transparent'\}/.test(ppc)
   && /background:var\(--inner\);border:1px solid transparent;border-radius:9px;padding:8px 13px;/.test(ppc));

// ---- Data 4: ingested box scores only; Elo = Database → Ratings ----
ok('surnames drop leading initials only ("A. De Minaur" → "De Minaur", "J-L. Struff" → "Struff", "T. A. Tirante" → "Tirante")',
   (() => { const f = vm.runInContext(grab('tourxSurname') + ';tourxSurname', vm.createContext({}));
            return f('A. De Minaur') === 'De Minaur' && f('J-L. Struff') === 'Struff' && f('T. A. Tirante') === 'Tirante' && f('Jannik Sinner') === 'Sinner'; })());
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

// ======================================================================
// TEN-401 round 1 · founder fixes 9–14 (Reports)
// ======================================================================
console.log('=== TEN-401 r1 fix 9: Player progression "Rounds through" ===');
const ppBox = { tourxActiveLabels: ['R32', 'R16', 'QF', 'SF', 'F'], tourxState: { roundIdx: 3, rvMetrics: ['serveRating'], ppFocus: null },
  TOURX_METRICS: [{ key: 'serveRating', label: 'Serve rating', kind: 'rating' }], TOURX_SERVE_KEYS: ['serveRating'], TOURX_RALLY_KEYS: [],
  TOURX_GREYS: ['var(--text)', 'var(--text-soft)'], tourxRating: () => null, tourxEsc: s => String(s), tourxHexA: c => c, tourxRpEsc: s => String(s) };
vm.createContext(ppBox);
vm.runInContext(['tourxFmt', 'tourxSurname', 'tourxPPRoundsShown', 'tourxPPRoundNote', 'tourxProgressionHeatHtml', 'tourxProgressionTablesHtml'].map(grab).join('\n')
  + '\nthis.tables = tourxProgressionTablesHtml; this.shown = tourxPPRoundsShown; this.note = tourxPPRoundNote;', ppBox);
const ppT = { field: { metrics: { serveRating: [250, 260, 270, 280, 290] } } };
const ppPl = [{ name: 'A. Alive', data: { serveRating: [300, 301, 302, 303, 304] } }, { name: 'B. Beaten', data: { serveRating: [280, 281, 282, 283, null] } }];
const heads = o => [...o.matchAll(/text-transform:uppercase;color:var\(--text-label\);font-weight:700;">([A-Z0-9]+)<\/div>/g)].map(m => m[1]);
const ppSF = ppBox.tables(ppPl, ppT);
ok('with SF selected the round columns stop at SF: F (and anything after) is hidden', JSON.stringify(heads(ppSF)) === JSON.stringify(['R32', 'R16', 'QF', 'SF', 'AVG']), heads(ppSF));
ok('no F value is printed with SF selected (A. Alive F = 304 absent)', !/>304</.test(ppSF));
ppBox.tourxState.roundIdx = null;
const ppAll = ppBox.tables(ppPl, ppT);
ok('"All rounds" shows the whole ladder through F', JSON.stringify(heads(ppAll)) === JSON.stringify(['R32', 'R16', 'QF', 'SF', 'F', 'AVG']), heads(ppAll));
ok('rounds-through slice: R32 → [R32]; F → full; null → full', JSON.stringify(ppBox.shown(['R32', 'R16', 'F'], 0)) === '["R32"]' && ppBox.shown(['R32', 'R16', 'F'], 2).length === 3 && ppBox.shown(['R32', 'R16', 'F'], null).length === 3);
ok('round note = the reference ppRoundNote', ppBox.note(3) === 'Showing rounds up to SF. Players eliminated earlier stop where they went out.' && ppBox.note(4) === 'Showing every round played.' && ppBox.note(null) === 'Showing every round played.');
ok('the Player progression round filter is labelled "Rounds through"', /tourxRoundChipRowHtml\('Rounds through', tourxPPRoundNote\(tourxState\.roundIdx\)\)/.test(grab('tourxPlayerViewHtml')));

console.log('=== TEN-401 r1 fix 10: every round chip is Hanken ===');
const chipBox = { tourxActiveLabels: ['R32', 'R16', 'QF', 'SF', 'F'], tourxState: { roundIdx: 3 } };
vm.createContext(chipBox);
vm.runInContext(['tourxCapsLbl', 'tourxSegItem', 'tourxRoundChipRowHtml'].map(grab).join('\n') + '\nthis.row = tourxRoundChipRowHtml;', chipBox);
const chipRow = chipBox.row('Rounds through');
const chipFonts = [...chipRow.matchAll(/<span class="tx-seg(?: on)?" onclick="tourxSetRound\([^)]*\)" style="([^"]*)">([^<]+)</g)].map(m => [m[2], /font-family:'Hanken Grotesk'/.test(m[1]) && !/Plex/.test(m[1])]);
ok('"All rounds" + R32 … F all render in Hanken (rounds are labels, not figures)', chipFonts.length === 6 && chipFonts.every(c => c[1]) && chipFonts[0][0] === 'All rounds', chipFonts);

console.log('=== TEN-401 r1 fix 11: head-to-head overlaps ===');
const h2hBox = { TOURX_H2H_A: 'var(--viz-lead)', TOURX_H2H_B: 'var(--viz-white-lead)', TOURX_H2H_FIELD: 'var(--viz-white-lead)', tourxRpEsc: s => String(s) };
vm.createContext(h2hBox);
vm.runInContext(['tourxFmt', 'tourxH2HChartSvg'].map(grab).join('\n') + '\nthis.chart = tourxH2HChartSvg;', h2hBox);
const h2hSvg = h2hBox.chart([310, 307, 300], [287, 279, 263], [278, 286, 287], ['X', 'Y. Bu', 'Z'], ['P', 'Q. Halys', 'R'], 'rating', ['R32', 'R16', 'QF'], 'uX');
ok('no field value text on the plot (no "Field avg" label)', !/Field/.test(h2hSvg), (h2hSvg.match(/>Field[^<]*</) || [])[0]);
const covers = Object.fromEntries([...h2hSvg.matchAll(/<g id="(uX_[ab]\d)" class="tourx-h2hpill" data-covers="([^"]*)"/g)].map(m => [m[1], m[2].split(' ')]));
ok('every pill hides its own point\'s value label while shown/pinned (A R16 307 → uX_va1, B R16 279 → uX_vb1)',
   Object.keys(covers).length === 6 && Object.entries(covers).every(([k, v]) => v.includes(k.replace('_', '_v'))) && /<text id="uX_va1"[^>]*>307</.test(h2hSvg), covers);
const tipSrc = ['tourxTipShow', 'tourxTipHide', 'tourxTipPin'].map(grab);
ok('show / hide / pin all resync the covered labels (tourxTipSync)', tipSrc.every(f => /tourxTipSync\(g\)/.test(f)) && /hidden\.has\(t\.id\) \? 'none' : ''/.test(grab('tourxTipSync')));
const h2hView = grab('tourxH2HViewHtml');
ok('the field figure sits in the card head as "Field <value>" in grey --text-label (the dashed line\'s right-end value)',
   /const fLast = lastNN\(fld\);/.test(h2hView) && /class="tourx-h2hfield" style="[^"]*color:var\(--text-label\);[^"]*"><span style="font-family:var\(--font-words\);">Field<\/span>/.test(h2hView));

console.log('=== TEN-401 r1 fix 12: sentence-case metric names ===');
const metSrc = html.slice(html.indexOf('const TOURX_METRICS = ['), html.indexOf('];', html.indexOf('const TOURX_METRICS = [')) + 2);
const METS = vm.runInContext(metSrc.replace('const TOURX_METRICS =', '') , vm.createContext({}));
const sentence = t => t.replace(/W\/UE/g, '') === (t.charAt(0) + t.slice(1).toLowerCase()).replace(/W\/ue/g, '');
ok('every metric label + chip name is sentence case', METS.length === 10 && METS.every(m => sentence(m.label) && sentence(m.short)), METS.filter(m => !sentence(m.label) || !sentence(m.short)).map(m => m.label + ' / ' + m.short));
ok('the founder\'s names: Serve rating · 1st serve % · 1st serve points won · 2nd serve points won · Return rating · Dominance ratio · Pressure points · Winners / unforced errors ratio',
   ['Serve rating', '1st serve %', '1st serve points won', '2nd serve points won', 'Return rating', 'Dominance ratio', 'Pressure points', 'Winners / unforced errors ratio'].every(l => METS.some(m => m.label === l)));
const titleSrc = ['tourxRoundChartsHtml', 'tourxProgressionTablesHtml', 'tourxH2HViewHtml', 'tourxProgressionGridHtml', 'tourxCompareCardsHtml'].map(grab).join('\n');
const titles = [...titleSrc.matchAll(/class="tourx-mtitle" style="([^"]*)">\$\{m\.label\}/g)].map(m => m[1]);
ok('metric card titles print the label as written (no text-transform:uppercase) — 5 card kinds', titles.length === 5 && titles.every(t => !/uppercase/.test(t)), titles.length);

console.log('=== TEN-401 r1 fix 13: match-stats sheet decimals ===');
ok('sheet % rows: one decimal (80 → 80.0%, 63.94 → 63.9%); ratios / per-point two decimals; ratings whole',
   sheetBox.tourxMsFmt(80, 'pct') === '80.0%' && sheetBox.tourxMsFmt(63.94, 'pct') === '63.9%' && sheetBox.tourxMsFmt(1.7, 'ratio') === '1.70' && sheetBox.tourxMsFmt(12, 'perpoint') === '0.12' && sheetBox.tourxMsFmt(294.6, 'rating') === '295');
const tieSh = sheetBox.sheet({ ...ST, players: [mk('A. Alive', 'B. Beaten', [63.94, 12, 280]), mk('B. Beaten', 'A. Alive', [63.88, 12.2, 280.4])] }, 'A. Alive', 2);
const tieCells = label => { const r = tieSh.split(label)[1] || ''; return [...r.matchAll(/class="tourx-msv( better)?"[^>]*>([^<]+)</g)].slice(0, 2).map(m => [m[2], !!m[1]]); };
ok('tie rule on the printed value: 63.94 / 63.88 both print 63.9% → neither side marked', JSON.stringify(tieCells('1st serve %')) === JSON.stringify([['63.9%', false], ['63.9%', false]]), tieCells('1st serve %'));
ok('tie rule: 280 / 280.4 both print 280 → neither side marked', JSON.stringify(tieCells('Serve rating')) === JSON.stringify([['280', false], ['280', false]]), tieCells('Serve rating'));
ok('the sheet rows format through tourxMsFmt (the shared tourxFmt is untouched)', /tourxMsFmt\(x, m\.kind\)/.test(grab('tourxMatchSheetHtml')) && !/tourxFmt\(x, m\.kind\)/.test(grab('tourxMatchSheetHtml')));

console.log('=== TEN-401 r1 fix 14: non-leader bars composite to 45% on the card ===');
const rowsHtml = [...qfCard.matchAll(/<div class="tourx-rcell"[\s\S]*?<\/div>\s*<\/div>/g)].map(m => m[0]);
const geo = rowsHtml.map(r => [(r.match(/class="tourx-rtrack" style="[^"]*left:([\d.]+)%/) || [])[1], (r.match(/class="tourx-rbar" style="[^"]*width:([\d.]+)%/) || [])[1]]);
ok('the --track starts where the bar ends (never under the bar)', geo.length === 3 && geo.every(g => g[0] != null && g[0] === g[1]), geo);
ok('the bar\'s wrapper carries no fill (nothing stacks under a --bar-2 bar but the card)', rowsHtml.every(r => /<div style="position:absolute;inset:0;border-radius:5px;overflow:hidden;">/.test(r)));
ok('no gradient / opacity / filter on Round comparison bars or their hover', !/class="tourx-rbar" style="[^"]*(gradient|opacity|filter)/.test(qfCard) && !/\.tourx-rcell[^{]*\{[^}]*(filter|opacity)/.test(html) && !/\.tourx-rbar\s*\{/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
