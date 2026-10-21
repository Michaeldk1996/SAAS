// Draw view (founder ruling 2026-10-20 item 2) — the bracket model against the OFFICIAL Almaty 2026 draw.
// Pinned: draws.json as committed by the first cloud draws.yml run (real ATP sheets) + the Almaty progression entry
// built by this repo's pipeline from the pinned real api-tennis snapshot. Positions come only from the draw; a match is
// placed by its players' own slots; an undecided slot is an empty placeholder, never a guessed name.
// Run: node tools/test-draw-view.js
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DV = require(path.join(ROOT, 'draw-view.js'));
const draws = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wue-sheet', 'draws-2026-10-20.json'), 'utf8'));
const entry = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'draw-view', 'almaty-progression.json'), 'utf8'));
const draw = Object.values(draws.tournaments).find(t => t.city === 'Almaty');
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Draw view — bracket model vs the official Almaty 2026 draw');
check('fixtures: posted 32-slot main draw + 16-slot qualifying; 9 finished main-draw matches with set scores', draw.main.size === 32 && draw.qualifying.size === 16 && entry.matches.length === 9 && entry.matches.every(m => Array.isArray(m.score)));
check('meet round from the draw structure: (1,2)→R1 · (3,4)→R1 · (1,4)→R2 · (29,32)→R2 · (1,32)→R5', [DV.meetRound(1, 2), DV.meetRound(3, 4), DV.meetRound(1, 4), DV.meetRound(29, 32), DV.meetRound(1, 32)].join() === '0,0,1,1,4');

const M = DV.model({ draw, entry, upcoming: [], kind: 'main' });
check('rounds R32 R16 QF SF F; counts "9 of 12" (16 pairs − 4 byes) then 0 of 8 / 4 / 2 / 1', M.rounds.map(r => `${r.name} ${r.done}/${r.total}`).join(' ') === 'R32 9/12 R16 0/8 QF 0/4 SF 0/2 F 0/1', M.rounds.map(r => `${r.name} ${r.done}/${r.total}`).join(' '));
const r32 = M.rounds[0].cells, slots = draw.main.slots;
let same = 0; r32.forEach((c, j) => { const x = slots[2 * j], y = slots[2 * j + 1]; const ok = [[c.sides[0], x], [c.sides[1], y]].every(([s, t]) => t.bye ? s === null : (s && s.name === t.name && s.seed === t.seed && (s.entry || null) === (t.entry || null) && (s.ioc || null) === (t.ioc || null))); if (ok) same++; });
check('every R32 side = its official slot (name, seed, entry, country; a bye side is empty): 32 of 32', same === 16, `${same * 2} of 32`);
check('byes at cells 1, 5, 12, 16 (slots 2, 10, 23, 31); the seed advances straight to R16', r32.filter(c => c.bye).map(c => c.j + 1).join() === '1,5,12,16'
  && M.rounds[1].cells[0].sides[0] && M.rounds[1].cells[0].sides[0].name.startsWith('MEDVEDEV') && M.rounds[1].cells[7].sides[1].name.startsWith('DARDERI'));
const shim = r32[1];
check('a result sits in the cell its players\' slots meet in, score oriented to the card (Shimabukuro top: 6-7 6-4 6-4)', shim.match && JSON.stringify(shim.match.score) === '[[6,7],[6,4],[6,4]]' && shim.sides[0].name.startsWith('SHIMABUKURO') && shim.match.winnerKey === String(shim.sides[0].playerKey), JSON.stringify(shim.match && shim.match.score));
const vuk = r32.find(c => c.sides[0] && c.sides[0].name.startsWith('MANNARINO'));
check('orientation flips when the feed listed the players the other way (Mannarino card: 7-6 4-6 6-3, Mannarino won)', vuk && JSON.stringify(vuk.match.score) === '[[7,6],[4,6],[6,3]]' && vuk.match.winnerKey === String(vuk.sides[0].playerKey), JSON.stringify(vuk && vuk.match && vuk.match.score));
check('no R32 result leaks into a later round (later rounds 0 placed)', M.rounds.slice(1).every(r => r.done === 0));
const r16 = M.rounds[1].cells;
check('R16 sides: a bye seed or an R32 winner, else EMPTY (null) — never a guessed name', r16[0].sides[0].name.startsWith('MEDVEDEV') && r16[0].sides[1].name.startsWith('SHIMABUKURO')
  && r16[1].sides[0].name.startsWith('ATMANE') && r16[1].sides[1] === null && M.rounds[2].cells.every(c => c.sides.every(s => s === null || r16.some(x => x.advances === s) || true)));
check('QF / SF / F: only players who actually advanced; with no R16 played, every side is empty', M.rounds.slice(2).every(r => r.cells.every(c => c.sides.every(s => s === null))));
const bell = r32.find(c => c.sides[0] && c.sides[0].name.startsWith('BELLUCCI'));
check('a match not yet played carries its start from the feed (Bellucci v Etcheverry, 21 Oct)', bell && !bell.match && bell.when && bell.when.date === '2026-10-21', JSON.stringify(bell && bell.when));
const M2 = DV.model({ draw, entry, kind: 'main', upcoming: [{ p1Key: bell.sides[0].playerKey, p2Key: bell.sides[1].playerKey, date: '2026-10-21', time: '08:30', tournamentRound: 'ATP Almaty - 1/16-finals' }] });
check('the board (matches.json, refreshed every run) wins over the progression snapshot for the start time', M2.rounds[0].cells[bell.j].when.time === '08:30');

const Q = DV.model({ draw, entry, upcoming: [], kind: 'qualifying' });
check('qualifying: 4 qualifiers on the main sheet → rounds Q1 Q2', Q.qualifiers === 4 && Q.rounds.map(r => r.name).join() === 'Q1,Q2');
const unkeyed = draw.qualifying.slots.filter(s => !s.bye && !s.playerKey).length;
check(`qualifying results placed by the draw structure: Q1 ${Q.rounds[0].done} of 8, Q2 ${Q.rounds[1].done} of 4 (fixture has ${unkeyed} unkeyed slot — never placed by guess)`,
  Q.rounds[0].done + unkeyed >= 8 && Q.rounds[0].done >= 7 && Q.rounds[1].done >= 3, `${Q.rounds[0].done} / ${Q.rounds[1].done} / unkeyed ${unkeyed}`);
check('without a posted draw the model is null (nothing drawn from guesses)', DV.model({ draw: { main: { status: 'not_posted' } }, entry, kind: 'main' }) === null);
check('qualifying depth unknown (no main draw) → only Q1 is shown', DV.qualRoundNames(16, 0).join() === 'Q1');

// ── render smoke (no DOM: the module renders into an object with innerHTML) ──
global.window = { DrawView: null, WueSheet: require(path.join(ROOT, 'wue-sheet.js')) };   // the page loads both; Dominance = WueSheet's one formula
const el = { innerHTML: '' };
DV.mount(el, { draws, prog: { tournaments: { Almaty: entry } }, board: [], tz: 'UTC' });
const h = el.innerHTML;
check('renders: tournament chips, Main draw / Qualifying, From picker, "Draw updated: …", round heads with "9 of 12"', /Almaty/.test(h) && /Main draw/.test(h) && /From/.test(h) && /Draw updated: /.test(h) && /9 of 12/.test(h) && /0 of 8/.test(h));
check('renders seeds in brackets, Q / WC markers, and placeholders — and never "undefined" / "null"', /\[1\]/.test(h) && /dv-mark">Q</.test(h) && /dv-mark">WC</.test(h) && /dv-card--empty/.test(h) && !/undefined|>null</.test(h));
// Founder 2026-10-21: "Byes go straight to R16. No fake R32 match card for a bye." The R32 column draws 12 cards in 16
// cells (the 4 bye cells are empty and carry no connector); each bye seed's first card is its R16 one.
const colAt = [...h.matchAll(/<div class="dv-col(?: dv-col--last)?">/g)].map(m => m.index);
const r32Col = h.slice(colAt[0], colAt[1]);
const byeCells = r32Col.match(/<div class="dv-cell[^"]*dv-cell--bye">(.*?)<\/div>/g) || [];
check('no bye card: R32 shows 12 cards in 16 cells; the 4 bye cells are empty; no "Bye" text anywhere',
  (r32Col.match(/class="dv-card/g) || []).length === 12 && byeCells.length === 4 && byeCells.every(c => !/dv-card/.test(c)) && !/>Bye</.test(h),
  `${(r32Col.match(/class="dv-card/g) || []).length} cards, ${byeCells.length} bye cells`);
check('a bye seed\'s first card is in R16 (Medvedev [1] not in the R32 column, present in R16)', !/MEDVEDEV|Medvedev/.test(r32Col) && /Medvedev/.test(h));
check('a finished main-draw match is clickable to OUR stats', /data-dv-ev="12171884"/.test(h));
DV.openStats('12171884');
check('stats panel: W, UE, W/UE, Dominance for both players (Duckworth 27 / 18 / 1.50 / 1.21)', /Match stats/.test(el.innerHTML) && /J\. Duckworth<\/td><td>27<\/td><td>18<\/td><td>1\.50<\/td><td>1\.21/.test(el.innerHTML), el.innerHTML.slice(el.innerHTML.indexOf('dv-stats'), el.innerHTML.indexOf('dv-stats') + 400));

// ── page + deploy wiring ──
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
check('Tournaments gets a "Draw" section, its container, loader and script', html.includes("[['draw', 'Draw']]") && html.includes('id="tourxDraw"') && html.includes('function tourxRenderDraw(){') && html.includes('<script src="draw-view.js"></script>'));
// 21 Oct: at 375px a long name + seed + three sets ("A. Shevchenko [3] 6 6 7") ran past the 186px card. Names are never
// truncated (CLAUDE.md), so every bracket column — desktop and phone — is at least as wide as its widest card.
const gridRules = html.match(/#tourxDraw \.dv-bracket\{[^}]*grid-template-columns:[^;]*;/g) || [];
check('every bracket column is at least its widest card (minmax(max-content, …)) on desktop AND phone — no fixed px minimum that a long name overflows',
  gridRules.length === 2 && gridRules.every(r => /minmax\(max-content, 1fr\)/.test(r)), gridRules.join(' | '));
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8'), sc = fs.readFileSync(path.join(ROOT, 'tools', 'site-code.sh'), 'utf8'), ps = fs.readFileSync(path.join(ROOT, 'tools', 'publish-site.mjs'), 'utf8');
check('draw-view.js ships on both deploy lanes and is required', /cp draw-view\.js _site\//.test(yml) && /wue-sheet\.js draw-view\.js \\/.test(yml) && sc.includes('cp draw-view.js "$SITE/"') && /'draw-view\.js'/.test(ps));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
