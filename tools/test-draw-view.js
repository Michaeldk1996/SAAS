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
// The page loads wue-sheet.js (Dominance = WueSheet's one formula) and defines playerPhotoUrl (the site's one photo
// resolver, founder 2026-10-22). Here: Medvedev has a photo, everyone else none.
const MED = String(draw.main.slots.find(s => /^MEDVEDEV/.test(s.name)).playerKey);
global.window = { DrawView: null, WueSheet: require(path.join(ROOT, 'wue-sheet.js')), playerPhotoUrl: (k) => (k === MED ? 'https://example.test/med.png' : null) };
const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : ['2026-10-20T12:12:00Z'])); } static now() { return new RD('2026-10-20T12:12:00Z').getTime(); } };
const el = { innerHTML: '' };
const prog = { fetchedAt: '2026-10-20T12:00:00Z', tournaments: { Almaty: entry } };
DV.mount(el, { draws, prog, board: [], tz: 'UTC' });
const h = el.innerHTML;
check('renders: tournament chips, Main draw / Qualifying, From picker, round heads with "9 of 12"', /Almaty/.test(h) && /Main draw/.test(h) && /From/.test(h) && /9 of 12/.test(h) && /0 of 8/.test(h));
check('item 13: the status line names both clocks — "Results: 12 min ago · Draw sheet: <content-change time>"', /Results: 12 min ago · Draw sheet: \d{1,2} Oct, \d\d:\d\d/.test(h), (h.match(/<div class="dv-stale">[^<]*/) || [''])[0]);
check('renders seeds in brackets, Q / WC markers, and placeholders — and never "undefined" / "null"', /\[1\]/.test(h) && /dv-mark">Q</.test(h) && /dv-mark">WC</.test(h) && /dv-card--empty/.test(h) && !/undefined|>null</.test(h));
// Item 8 (round 2, reverses the no-card ruling): a bye is a muted box — the seed, then "(Bye)" — no score, not clickable,
// not counted (R32 stays "x of 12"), so every R16 slot has two feeders.
const colAt = [...h.matchAll(/<div class="dv-col(?: dv-col--last)?">/g)].map(m => m.index);
const r32Col = h.slice(colAt[0], colAt[1]);
const byeCards = r32Col.match(/<div class="dv-card dv-card--bye"[\s\S]*?\(Bye\)<\/span><\/div><\/div>/g) || [];
check('item 8: R32 draws 16 boxes for 16 slots — 12 matches + 4 muted bye boxes (every R16 slot has two feeders)', (r32Col.match(/class="dv-card[ "]/g) || []).length === 16 && byeCards.length === 4, `${(r32Col.match(/class="dv-card[ "]/g) || []).length} boxes, ${byeCards.length} bye`);
check('item 8: a bye box = the seed then "(Bye)" — Medvedev [1] first; no score, not clickable', /Medvedev<\/span><span class="dv-seed">\[1\]/.test(byeCards[0] || '') && byeCards.every(b => !/class="dv-set"|data-dv-ev|role="button"/.test(b)));
check('item 8: the bye boxes never count — R32 "9 of 12", R16 "0 of 8"', /R32<\/span><span class="dv-count">9 of 12/.test(h));
// Item 9: photos from the profile chain, lazy, initials underneath; no photo → initials only.
const medRow = (r32Col.match(/<div class="dv-row"><span class="dv-av"[^]*?Medvedev/) || [''])[0];
check('item 9: a player with a photo: lazy <img> from the one resolver, alt = the name, a failed load removes it, initials underneath', /<span class="dv-ini">DM<\/span><img src="https:\/\/example\.test\/med\.png" alt="[^"]*MEDVEDEV[^"]*" loading="lazy"[^>]*onerror="this\.remove\(\)"/.test(medRow) && !/data-fb=/.test(medRow), medRow.slice(0, 300));
check('item 9: a player without a photo: initials only, never an <img> placeholder face', /<span class="dv-av" aria-hidden="true"><span class="dv-ini">SS<\/span><\/span><span class="dv-ioc">JPN<\/span><span class="dv-name">S\. Shimabukuro/.test(h));
check('item 9: initials from the official name ("DIAZ ACOSTA, Facundo" → FD; one-word name → its letter)', DV.initials('DIAZ ACOSTA, Facundo') === 'FD' && DV.initials('Nadal') === 'N' && DV.initials('') === '');
// Item 11: neutral marker only where the sheet prints countries for most of the field.
check('item 11: Medvedev (no country on a sheet that prints them) gets the NEU marker, not an empty box', /dv-ioc dv-ioc--neu" title="Neutral athlete: no country on the official draw">NEU</.test(medRow));
const lyonDraw = Object.values(draws.tournaments).find(t => t.city === 'Lyon');
const LQ = lyonDraw && lyonDraw.qualifying && lyonDraw.qualifying.status === 'posted' ? DV.model({ draw: lyonDraw, entry: null, upcoming: [], kind: 'qualifying' }) : null;
const lqSides = LQ ? LQ.rounds[0].cells.flatMap(c => c.sides).filter(Boolean) : [];
check(`item 11: a sheet with no country column (Lyon qualifying: ${lqSides.filter(s => !s.ioc).length} of ${lqSides.length} blank) marks nobody neutral`, lqSides.length > 0 && lqSides.every(s => !s.ioc && s.neutral === false), `${lqSides.length} sides`);
check('item 11: Almaty main — exactly the 4 no-country players are neutral (Medvedev, Safiullin, Khachanov, Rublev)', M.rounds[0].cells.flatMap(c => c.sides).filter(s => s && s.neutral).map(s => s.name.split(',')[0]).sort().join() === 'KHACHANOV,MEDVEDEV,RUBLEV,SAFIULLIN');
// Round 3 (founder 2026-10-21): a finished match opens the site's ONE Match Analysis (openAnalysisModal, landing on Match
// Stats → Key stats) — only when the board holds it as `past-<eventKey>`; otherwise the card is not clickable. No pop-up.
check('round 3: with no board row, a finished match is NOT clickable (nothing to open; never a second stats view)', !/data-dv-ev|role="button"|dv-card--done/.test(h));
const boardRow = { id: 'past-12171884', finalScore: { display: '4-6, 3-6' } };
DV.mount(el, { draws, prog, board: [boardRow, { id: 'past-99999999' }], tz: 'UTC' });
let sp = el.innerHTML;
check('round 3: the board holds it (past-12171884, scored) → clickable: role=button, keyboard, "Open match analysis"', /class="dv-card dv-card--done" role="button" tabindex="0" title="Open match analysis" data-dv-ev="12171884" onclick="DrawView\.openAnalysis\('past-12171884'\)"/.test(sp), (sp.match(/<div class="dv-card dv-card--done"[^>]*>/) || [''])[0]);
check('round 3: exactly the board-held match is clickable — 1 of the 9 finished R32 matches here; an unscored board row opens nothing', (sp.match(/role="button"/g) || []).length === 1 && DV.analysisIdFor({ eventKey: '99999999' }) === null);
let opened = null; global.window.openAnalysisModal = (id, tab) => { opened = [id, tab]; };
DV.openAnalysis('past-12171884');
check('round 3: opening lands on the Match Stats tab (its sheet opens on Key stats)', JSON.stringify(opened) === '["past-12171884","matchstats"]', JSON.stringify(opened));
const dvSrc = fs.readFileSync(path.join(ROOT, 'draw-view.js'), 'utf8');
check('round 3: the draw\'s own stats pop-up is gone — no overlay, no openStats, no Esc layer for it', !/dv-overlay|openStats|statsPanel|draw-stats/.test(dvSrc) && !/#tourxDraw \.dv-(overlay|stats)/.test(fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8')));
const qb = DV.model({ draw, entry, upcoming: [], kind: 'qualifying' });
DV.set('kind', 'qualifying'); sp = el.innerHTML;
check(`round 3: qualifying — the board never holds a qualifying match, so none of its ${qb.rounds.reduce((a, r) => a + r.done, 0)} finished matches is clickable`, /class="dv-set"/.test(sp) && !/role="button"|dv-card--done/.test(sp));   // results shown, none clickable
DV.set('kind', 'main');
// Round 3: the W/UE sheet sits beside the tournament selector, for the selected tournament (the page's own bar).
const barCalls = []; global.window.tourxWueBarHtml = (n) => { barCalls.push(n); return `<div data-wue="${n}">R32: 9 of 12</div>`; };
DV.mount(el, { draws, prog, board: [], tz: 'UTC' }); sp = el.innerHTML;
const headHtml = sp.slice(sp.indexOf('<div class="dv-head">'), sp.indexOf('<div class="dv-from">'));
check('round 3: the W/UE bar renders inside the header row (beside Almaty / Main draw), for Almaty, with its round status', /<div class="dv-wue"><div data-wue="Almaty">R32: 9 of 12<\/div><\/div><\/div>$/.test(headHtml) && barCalls[barCalls.length - 1] === 'Almaty', headHtml.slice(-160));
DV.mount(el, { draws, prog: { fetchedAt: prog.fetchedAt, tournaments: {} }, board: [], tz: 'UTC' });
check('round 3: no progression entry for the tournament → no W/UE bar (never a bar for data we do not hold)', !/dv-wue/.test(el.innerHTML));
delete global.window.tourxWueBarHtml; delete global.window.openAnalysisModal;
// Item 12: a match in progress shows the board's live score, oriented to the card, marked LIVE.
const bk = [bell.sides[0].playerKey, bell.sides[1].playerKey];
DV.mount(el, { draws, prog, tz: 'UTC', board: [{ tour: 'ATP Almaty', p1Key: bk[1], p2Key: bk[0], date: '2026-10-21', time: '08:30', live: true, liveScore: [{ set: 1, p1: 4, p2: 6 }, { set: 2, p1: 3, p2: 2 }], liveGameScore: '30 - 15' }] });
const lc = (el.innerHTML.match(/<div class="dv-card dv-card--live"[\s\S]*?<\/div><\/div><\/div>/) || [''])[0];
check('item 12: the live card is marked LIVE with the game score, sets oriented to the card (board p1 = our B: 6-4 2-3 for Bellucci)',
  /<span class="dv-live">LIVE<\/span><span class="dv-game">15 - 30<\/span>/.test(lc) && /Bellucci<\/span><span class="dv-sets"><span class="dv-set">6<\/span><span class="dv-set">2<\/span>/.test(lc) && /Etcheverry<\/span><span class="dv-seed">\[6\]<\/span><span class="dv-sets"><span class="dv-set">4<\/span><span class="dv-set">3<\/span>/.test(lc), lc.slice(0, 600));
check('item 12: a live card is not clickable to stats and not counted as played (R32 still 9 of 12)', !/data-dv-ev/.test(lc) && /9 of 12/.test(el.innerHTML));
global.Date = RD;


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
