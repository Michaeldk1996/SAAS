// Head to Head — the 17 Nov 2026 snapshot (design_handoff_head_to_head/CHANGES_2026-11-17.md) and the founder's rulings
// of the same day. Every check EXECUTES the shipped window.H2HPage module (tools/h2h-test-harness.js slices it out of
// bsp-consult-dashboard.html; TEN402_HTML overrides the page for tools/test-ten402-fix-mutants.js, where each test below
// has a mutant that must turn it red).
//
// Run: node --test test-h2h-1117.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const HX = require(join(HERE, 'tools/h2h-test-harness.js'));
const core = require(join(HERE, 'market-edge-core.js'));
const PPV2 = readFileSync(join(HERE, 'player-profile-v2.js'), 'utf8');
const MK_BANDS = new Function('return ' + /var MK_BANDS = (\[[\s\S]*?\]\]);/.exec(PPV2)[1])();
const text = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const runH = (h, hid) => h.X.handlers()[+hid]();
const today = new Date();
const day0 = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86400000);
const iso = d => new Date(d * 86400000).toISOString().slice(0, 10);
const J = x => JSON.parse(JSON.stringify(x));
const SIN = { key: '1', full: 'J. Sinner', short: 'J. Sinner', mono: 'JS' }, ALC = { key: '2', full: 'C. Alcaraz', short: 'C. Alcaraz', mono: 'CA' };

// ── the meetings box (the real h2hPairFor → H2HCore.joinMeetings → h2hPriceJoin path, as test-ten402-b.mjs drives it) ──
async function pairPage(meetings, o) {
  const opt = o || {};
  const ch = { 1: [], 2: [] };
  meetings.forEach((m, i) => {
    const sets = m.sets.map(s => ({ p: s[0], o: s[1] }));
    const pS = m.sets.filter(s => s[0] > s[1]).length, oS = m.sets.length - pS;
    const base = { date: m.date, tournament: m.t || 'Basel', round: m.round || 'F', level: 'atp', eventKey: 100 + i, surface: m.surface || 'hard' };
    ch[1].push(Object.assign({}, base, { opponent: ALC.short, oppKey: 2, won: m.won, sets, result: pS + ' - ' + oS, retired: false }));
    ch[2].push(Object.assign({}, base, { opponent: SIN.short, oppKey: 1, won: !m.won, sets: sets.map(s => ({ p: s.o, o: s.p })), result: oS + ' - ' + pS, retired: false }));
  });
  const h = HX.load({ html, globals: { loadCareerHistory: k => Promise.resolve(ch[k]), careerHistoryAnswered: () => true, fhLoadCloses: () => Promise.resolve(null),
    sfH2hNkCount: () => ({}), careerHistoryIdOf: () => null, _sfDbJoinSt: 'ready', _sfDbJoin: { rows: [], names: [], meta: { rounds: [] } },
    loadSetStatsIndex: () => Promise.resolve(opt.statsIx || new Set()), loadSetStatsShard: ek => Promise.resolve((opt.shards || {})[ek] || null),
    matchStatsFromShard: sh => sh, fhStateFor: () => ({ sheetMap: {} }), fhOpenSheet: () => {} } });
  h.call(h.h2hPairFor, SIN, ALC);
  await new Promise(r => setTimeout(r, 5));
  h.call(h.h2hPairFor, SIN, ALC);
  if (opt.price) h.X.__eval('_h2hPairs')['1|2'].rows.forEach(opt.price);
  h.view = () => ({ a: SIN, b: ALC, h2h: h.call(h.h2hViewFor, SIN, ALC) });
  return h;
}
const boxTiles = async (meetings, o) => {
  const h = await pairPage(meetings, o);
  h.state.h2hBox = true;
  h.call(h.h2hBoxHTML, h.view());
  await new Promise(r => setTimeout(r, 5));
  const t = text(h.call(h.h2hBoxHTML, h.view()));
  return t.slice(t.indexOf('Total points won'), t.indexOf('Meetings '));
};
const shard = (a, b) => ({ own: { raw: { 'Points:Total Points Won': { won: a, total: a + b } } }, opp: { raw: { 'Points:Total Points Won': { won: b, total: a + b } } } });

test('meetings box tiles (founder 2026-11-17): Total points won ends "· N meetings" when every meeting has a box score, else "· k of n meetings"', async () => {
  const M2 = [{ date: '2024-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2025-10-25', won: false, sets: [[4, 6], [3, 6]] }];
  const all = await boxTiles(M2, { statsIx: new Set(['100', '101']), shards: { 100: shard(60, 40), 101: shard(40, 60) } });
  assert.match(all, /^Total points won 50\.0% Sinner over 2 meetings, Alcaraz 50\.0% /, 'every meeting has a box score: the plain count (one sentence, founder ruling 9, 2026-11-18)');
  const part = await boxTiles(M2, { statsIx: new Set(['100']), shards: { 100: shard(60, 40) } });
  assert.match(part, /^Total points won 60\.0% Sinner over 1 of 2 meetings, Alcaraz 40\.0% /, 'one of two: "k of n"');
});
test('meetings box tiles (founder 2026-11-17): Went to a deciding set with exactly one decider names it — "<Winner> <x>–<y> <event> <year>"', async () => {
  const M = [{ date: '2024-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2025-10-25', won: false, sets: [[6, 4], [3, 6], [4, 6]] }];
  assert.match(await boxTiles(M), /Went to a deciding set 1 of 2 Alcaraz won it 2–1 at Swiss Indoors 2025 /);
  const two = M.concat([{ date: '2023-10-25', won: true, sets: [[6, 7], [6, 3], [6, 4]] }]);
  assert.match(await boxTiles(two), /Went to a deciding set 2 of 3 Sinner won 1, Alcaraz won 1 /, 'two deciders: the split, one sentence');
});
test('meetings box tiles (founder 2026-11-17): Favourite won names the underdog\'s win — one, several (the last), none', async () => {
  const M3 = [{ date: '2023-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2024-10-25', won: false, sets: [[4, 6], [3, 6]] }, { date: '2025-10-25', won: true, sets: [[6, 4], [6, 4]] }];
  const px = prices => (r, i) => Object.assign(r, { price: prices[i][0], oppPrice: prices[i][1], book: 'P' });
  // Sinner the favourite in 2023 (won) and 2024 (lost), the underdog in 2025 (won)
  // founder ruling 9 (2026-11-18): one sentence — the last underdog win, "<winner> won as underdog at <event> <year>"
  assert.match(await boxTiles(M3, { price: px([[1.4, 3.0], [1.5, 2.6], [2.4, 1.6]]) }), /Favourite won 1 of 3 Sinner won as underdog at Swiss Indoors 2025 /);
  assert.match(await boxTiles(M3, { price: px([[1.4, 3.0], [1.5, 2.6], [1.6, 2.4]]) }), /Favourite won 2 of 3 Alcaraz won as underdog at Swiss Indoors 2024 /);
  assert.match(await boxTiles(M3, { price: px([[1.4, 3.0], [2.6, 1.5], [1.6, 2.4]]) }), /Favourite won 3 of 3 The favourite won every one/);
});

test('hot line panel (founder 2026-11-17): under the rate floor the Covered tile shows the count "c of n" as its figure (no dash) and names the covered meetings', async () => {
  const M3 = [{ date: '2023-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2024-10-25', won: false, sets: [[4, 6], [7, 6], [3, 6]] }, { date: '2025-10-25', won: true, sets: [[6, 4], [6, 2]] }];
  const h = await pairPage(M3);
  h.state.hotOpen = 'Sinner −1.5 sets';
  const c = h.call(h.h2hCard, h.view());
  const tile = /<span style="font-size:12px; font-weight:600; color:[^"]*">Covered<\/span><span style="([^"]*)">([^<]*)<\/span><span[^>]*>([^<]*)<\/span>/.exec(c);
  assert.ok(tile, 'the Covered tile');
  assert.deepEqual([tile[2], tile[3]], ['2 of 3', 'At Swiss Indoors 2025, Swiss Indoors 2023'], 'the count, never "—"; the covered meetings, newest first');
  assert.match(tile[1], /color:var\(--h2h-text\)/, 'the count in white');
  h.state.h2hAllLines = true;   // "Show all lines": every line, so a never-covered one can be opened
  h.state.hotOpen = 'Alcaraz −1.5 sets';
  const none = /Covered<\/span><span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span>/.exec(h.call(h.h2hCard, h.view()));
  assert.ok(none, 'the Alcaraz line opens too');
  assert.deepEqual([none[1], none[2]], ['0 of 3', 'Not covered yet']);
});

// ── Record against each style: the Vs style average keeps its sign colour at n 5–9 ──
function styleView(rows, avg) {
  return { a: SIN, b: ALC, styles: { sides: [{ p: SIN, R: { state: 'ready', oppLab: 'Big Server', avg, rows } }, { p: ALC, R: { state: 'ready', oppLab: 'Big Server', avg, rows: [] } }], arch: ['All Court Elite', 'All Court Elite'] } };
}
const recRow = (ago, won) => ({ won, opponent: 'Player ' + ago, surface: 'hard', tournament: 'Basel', result: won ? '6-4 6-4' : '4-6 4-6', date: iso(day0 - ago), round: 'R32' });
test('Record against each style (founder 2026-11-17 / 2026-11-19): the "Vs style average" keeps its sign colour at n 5–9; the win rate stays white as the design (the small sample is its hover); under 5 still "—"', () => {
  const h = HX.load({ html, globals: { _careerHistoryShards: {}, _sfDbJoinSt: 'loading', _sfDbJoinP: new Promise(() => {}) } });
  const six = (w) => Array.from({ length: 6 }, (_, i) => recRow(10 + i, i < w));
  const up = h.call(h.stylesCard, styleView(six(5), 50));   // 83% v 50 → +33 pts, n 6
  assert.match(up, /title="Small sample · n=6"/);
  assert.match(up, /font-size:20px; font-weight:700; line-height:1;">83%</, 'the rate stays white at 5–9 (founder 2026-11-19: the design\'s colours)');
  assert.match(up, /color:var\(--h2h-up\);">\+33 pts</, 'the gap stays green');
  assert.match(up, /background:var\(--h2h-up\); left:50\.0%;/, 'and its bar');
  const dn = h.call(h.stylesCard, styleView(six(1), 50));   // 17% v 50 → −33 pts
  assert.match(dn, /color:var\(--h2h-down\);">−33 pts</, 'a negative gap stays red');
  const four = h.call(h.stylesCard, styleView(six(4).slice(0, 4), 50));
  assert.match(text(four), /Record 4–0 Win rate — Vs style average —/, 'under 5: no rate, no gap');
});

// ── the Stennisfy Model: "Elo only <price>" beside each likely opening price ──
test('Stennisfy Model (founder 2026-11-17): each price box also shows "Elo only <price>" = the engine\'s base (cell[1]) on the same margin', () => {
  const h = HX.load({ html });
  const A = { key: '10', full: 'A. One', short: 'A. One', mono: 'AO' }, B = { key: '20', full: 'B. Two', short: 'B. Two', mono: 'BT' };
  const px = h.X.__eval('_pairPx');
  px['10'] = { st: 'ready', at: Date.now(), d: { generatedAt: '2026-11-16T07:19:32Z', margin: 0.0339, marginN: 442, opp: { 20: { H3: [3340, 3465, 6] } } } };
  px['20'] = { st: 'ready', at: Date.now(), d: { generatedAt: '2026-11-16T07:19:32Z', margin: 0.0339, marginN: 442, opp: { 10: { H3: [6660, 6535, 6] } } } };
  const m = h.call(h.modelVals, A, B, { ctxSurface: 'Hard', ctxFormat: 3 });
  const f = p => (1 / (p * 1.0339)).toFixed(2);
  assert.deepEqual([m.aPrice, m.bPrice, m.aBase, m.bBase], [f(0.334), f(0.666), f(0.3465), f(0.6535)], 'with the layers / Elo only, both on the 3.39% margin');
  assert.notEqual(m.aBase, m.aPrice, 'the two prices differ when the layers move the price (control: not a copy)');
  const card = h.call(h.modelCard, { model: m, a: A, b: B });
  const elo = [...card.matchAll(/>Elo only <span style="font-family:'IBM Plex Mono',monospace;">([^<]+)<\/span>/g)].map(x => x[1]);
  assert.deepEqual(elo, [m.aBase, m.bBase], 'one "Elo only" line in each box, A then B');
});

// ── Tournament record: group mode (Surface / Court speed), the window, the "Back to" link ──
test('xTrEvent: an event\'s speed class IS courtSpeedCategory of its one COURT_CONDITIONS rating (the figure the tournament row prints), for every catalog event', () => {
  const h = HX.load({ html, preload: ['COURT_CONDITIONS', 'courtSpeedCategory'] });
  const CC = h.run('COURT_CONDITIONS'), cat = h.run('TOURNAMENT_CATALOG'), csc = h.run('courtSpeedCategory');
  const seen = new Set();
  let n = 0;
  for (const t of cat) {
    const cc = CC[t.name];
    const e = h.call(h.xTrEvent, t.name);
    assert.equal(e.speed, cc ? csc(cc.speed) : null, t.name);
    if (cc) { n++; seen.add(e.speed); assert.equal(e.speed, h.call(h.cTourInfo, t.name, null).meta.find(x => x[0] === 'Court speed')[1], t.name + ': the row and the filter agree'); }
  }
  assert.ok(n >= 40, 'the catalog events with a rating: ' + n);
  assert.deepEqual([...seen].sort(), ['Fast', 'Medium', 'Slow'], 'all three classes occur');
  assert.deepEqual(J(h.call(h.xTrEvent, 'Basel')), { surface: 'Hard', speed: csc(CC.Basel.speed) });
  assert.equal(h.call(h.xTrEvent, 'Nowhere Open').speed, null, 'no rating → no speed class');
});

const tmk = (date, won, round, opp, o) => Object.assign({ mid: date + round, date, won, round, opp, wo: false, ret: false, sets: won ? [[6, 4], [6, 4]] : [[4, 6], [4, 6]], pS: won ? 2 : 0, oS: won ? 0 : 2, price: null, oppPrice: null, book: null, src: null }, o || {});
test('xTrAgg (group mode): two events, the window cut by EXACT date — W–L, sets, best, last played and the backing % over the priced rows in the window', () => {
  const h = HX.load({ html });
  const cut = h.call(h.xTrCut, 'w52');
  assert.equal(cut, iso(day0 - 364), 'Last 52 weeks = 364 days back');
  const two = new Date(); two.setUTCFullYear(two.getUTCFullYear() - 2);
  assert.equal(h.call(h.xTrCut, 'm24'), two.toISOString().slice(0, 10), 'Last 24 months = the same day two years back');
  assert.equal(h.call(h.xTrCut, 'career'), null);
  const inWin = iso(day0 - 363), outWin = iso(day0 - 366), yr = s => s.slice(0, 4);
  const basel = { ev: { name: 'Basel', surface: 'Hard', speed: 'Fast' }, P: { eds: [
    { year: yr(iso(day0 - 20)), result: 'Won', rows: [tmk(iso(day0 - 20), true, 'F', 'A. Zverev', { price: 1.5, oppPrice: 2.6, book: 'P', src: 'td' }), tmk(iso(day0 - 22), true, 'SF', 'T. Fritz', { price: 1.3, oppPrice: 3.6, book: 'P', src: 'td' })] },
    { year: yr(outWin), rows: [tmk(outWin, false, 'R16', 'D. Medvedev', { price: 2.0, oppPrice: 1.8, book: 'P', src: 'td' })] }] } };
  const shang = { ev: { name: 'Shanghai', surface: 'Hard', speed: 'Fast' }, P: { eds: [
    { year: yr(inWin), rows: [tmk(inWin, false, 'QF', 'H. Rune', { price: 1.8, oppPrice: 2.1, book: 'P', src: 'td' }), tmk(iso(day0 - 365 + 3), true, 'R16', 'B. Shelton')] }] } };
  const A = h.call(h.xTrAgg, [basel, shang], cut, true);
  assert.deepEqual([A.W, A.L, A.n], [3, 1, 4], 'the 366-day-old R16 loss is outside the window; the 363-day-old QF loss inside');
  assert.ok(!A.rows.some(r => r.date === outWin), 'the old row is cut');
  assert.deepEqual([A.sW, A.sT], [6, 8], 'sets: 2+2+2 won, 0+0+2 lost');
  assert.deepEqual(J(A.best), { code: 'Won', year: yr(iso(day0 - 20)), ev: 'Basel' }, 'best = the won final (a full edition marked Won), with its event (founder 2026-11-19)');
  assert.deepEqual([A.last.row.opp, A.last.year], ['A. Zverev', yr(iso(day0 - 20))], 'last played = the newest played row');
  const priced = [basel.P.eds[0].rows[0], basel.P.eds[0].rows[1], shang.P.eds[0].rows[0]];
  assert.equal(A.priced.length, 3, 'three priced rows in the window (the unpriced Shelton match is not a bet)');
  assert.equal(A.units, priced.reduce((t, r) => t + core.plCents(r), 0) / 100, 'flat 1% stake over exactly those rows');
  assert.equal(Math.round(A.units * 100), 50 + 30 - 100, '+0.50 + 0.30 − 1.00');
  assert.deepEqual(J(A.eds.map(e => e.ev.name + ' ' + e.year)), ['Basel ' + yr(iso(day0 - 20)), 'Shanghai ' + yr(inWin)], 'grouped per tournament and year, newest first');
  // control: with no window the old row counts and its loss lowers the record
  const C = h.call(h.xTrAgg, [basel, shang], null, true);
  assert.deepEqual([C.W, C.L, C.priced.length], [3, 2, 4]);
});

function tourHarness(models) {
  return HX.load({ html, preload: ['COURT_CONDITIONS', 'courtSpeedCategory'], globals: { EntryListsTab: null, _sfDbJoinSt: 'ready', _sfDbJoin: { rows: [], names: [], meta: { rounds: [] } },
    trProfileModel: (k, name, t) => models[k + '|' + t.name] || { eds: [] } } });
}
test('Tournament record: group mode (a Surface or Court speed set) runs over every fitting event, names the condition, and shows "Back to <tournament> ›" — only in group mode', () => {
  const r = (d, won, round) => tmk(d, won, round, 'X. Opp');
  const models = { '1|Basel': { eds: [{ year: '2025', rows: [r('2025-10-25', true, 'F')] }] }, '1|Monte Carlo': { eds: [{ year: '2025', rows: [r('2025-04-12', false, 'SF')] }] },
    '2|Basel': { eds: [{ year: '2024', rows: [r('2024-10-25', false, 'QF')] }] } };
  const h = tourHarness(models);
  const a = Object.assign({}, SIN, { _cSt: { state: 'ready' }, tourHist: [{ name: 'Basel', won: 1, lost: 0, lastYear: 2025 }, { name: 'Monte Carlo', won: 0, lost: 1, lastYear: 2025 }] });
  const b = Object.assign({}, ALC, { _cSt: { state: 'ready' }, tourHist: [{ name: 'Basel', won: 0, lost: 1, lastYear: 2024 }] });
  const single = h.call(h.tourneyVals, a, b, { tourSel: 'Basel' });
  assert.equal(single.grp, false);
  const cs = h.call(h.tourneyCard, { a, b, tourney: single });
  assert.doesNotMatch(text(cs), /Back to/, 'single tournament: no "Back to" link');
  assert.match(text(cs), /^Tournament record At one event, or across a surface and court speed Tournament /);
  assert.deepEqual(J(single.filters.map(f => f.label + ':' + f.items.filter(i => i.on).map(i => i.label))), ['Window:Career', 'Surface:All', 'Court speed:All'], 'the window opens on Career');
  assert.equal((cs.match(/<div class="x-sw x-sw--lg" style="display:flex;/g) || []).length, 3, 'three filter switches, stretched (xSw fill)');
  const grp = h.call(h.tourneyVals, a, b, { tourSel: 'Basel', trSurf: 'Hard' });
  assert.equal(grp.grp, true);
  const cg = h.call(h.tourneyCard, { a, b, tourney: grp });
  assert.match(text(cg), /^Tournament record At one event, or across a surface and court speed Back to Swiss Indoors › /);
  assert.match(text(cg), / 1 Hard courts 1 tournament Swiss Indoors Surface Hard Court speed All /, 'the row names the condition, its events as chips (founder 2026-11-19); Monte Carlo (clay) is out');
  assert.match(cg, /class="seg x-evchip"/, 'each event is a chip that opens it');
  assert.match(text(cg), /Best result QF Swiss Indoors 2024/, 'the best result names its event (founder 2026-11-19)');
  assert.match(text(cg), /J\. Sinner On hard courts · since 2025 1–0 /);
  assert.match(text(cg), /Swiss Indoors 2025 Hard · Fast · 1–0 that year/, 'group heads: event + year, surface · speed');
  // "Back to" clears both filters (back to the one tournament)
  runH(h, grp.hBack);
  assert.deepEqual([h.state.trSurf, h.state.trSpeed], ['all', 'all']);
  // Court speed Slow: Monte Carlo (its one rating reads Slow); Alcaraz never played it
  const slow = text(h.call(h.tourneyCard, { a, b, tourney: h.call(h.tourneyVals, a, b, { tourSel: 'Basel', trSpeed: 'Slow' }) }));
  assert.match(slow, / 1 Slow courts 1 tournament Monte-Carlo Masters Surface All Court speed Slow /);
  assert.match(slow, /J\. Sinner On slow courts · since 2025 0–1 .* C\. Alcaraz has no matches on slow courts\.$/);
  // a condition nothing fits, with a window: "0 tournaments · none on record", the window named in the empty line
  const grass = text(h.call(h.tourneyCard, { a, b, tourney: h.call(h.tourneyVals, a, b, { tourSel: 'Basel', trSurf: 'Grass', trWin: 'w52' }) }));
  assert.match(grass, / 0 Grass courts 0 tournaments none on record /);
  assert.match(grass, /J\. Sinner has no matches on grass courts in the last 52 weeks\./);
});

// ── Market edge: every return in %, never "u" ──
test('Market edge (CHANGES 2026-11-17 §4): every return reads in % — band rows, Total return, the chart\'s y labels and line ends; no "u" anywhere', () => {
  const h = HX.load({ html, globals: { _careerHistoryShards: {}, PlayerProfileV2: { _internals: { MK_BANDS } } } });
  let k = 0;
  const pl = (list, s) => { const rows = list.map(([ago, price, won], i) => ({ mid: 'r' + i, date: iso(day0 - ago), day: day0 - ago, won, price, oppPrice: 2.5, book: 'P', src: 'td', wo: false, round: 'R32' })); rows.win = rows;
    return { key: 'k' + (++k), short: s, full: s, mono: 'XX', _cSt: { state: 'ready', me: 'ready', rows } }; };
  const A = pl(Array.from({ length: 12 }, (_, i) => [10 + i * 20, 1.5, i < 9]), 'A. One'), B = pl(Array.from({ length: 12 }, (_, i) => [15 + i * 20, 2.4, i % 3 === 0]), 'B. Two');
  const m = h.call(h.marketVals, A, B, { mScope: 'l52' });
  const card = h.call(h.marketCard, { market: m, a: A, b: B });
  const t = text(card);
  assert.match(t, /A\. One \d+ priced matches \+\d+\.\d% Total return/);
  assert.ok((t.match(/[+−]\d+\.\d%/g) || []).length >= 4, 'signed returns in %');
  assert.match(t, /(?:^| )0% /, 'the chart\'s zero label');
  assert.doesNotMatch(t, /\d(?:\.\d)?u\b/, 'no figure in units');
  assert.doesNotMatch(t, /flat 1u|Cumulative units/);
});

// ── avatars (CHANGES 2026-11-18 §4; founder rulings 6 and 10, 2026-11-18) ──
test('avatars: xAv = ringed initials under the photo (A blue, B white); xIni = initials only, card fill; xMini = the price-column head, no ring, never a photo', () => {
  const h = HX.load({ html, preload: ['escapeHtml', 'playerPhotoUrl', 'playerPhotoImg'], globals: { playerPhotoIndex: { 1: { s: 'abc' } }, _photoIndexLoaded: true } });
  const big = h.call(h.xAv, SIN, 'a', 44, { eager: true });
  assert.match(big, /^<span class="x-av" [^>]*box-shadow:0 0 0 2px var\(--h2h-blue\);/);
  assert.match(big, /<img class="sf-ph" src="player-photos\/s\/1\.webp\?v=abc"[^>]*loading="eager" fetchpriority="high"/, 'ruling 6: the picker photo is fetched at once, never left lazy');
  assert.match(h.call(h.xAv, SIN, 'a', 40), /loading="lazy"/, 'control: a photo below the fold stays lazy');
  assert.match(h.call(h.xAv, ALC, 'b', 44), /^<span class="x-av" [^>]*box-shadow:0 0 0 2px var\(--h2h-text\);/);
  const ini = h.call(h.X.__eval('xIni'), SIN, 'a', 38, 13);
  assert.equal(ini, `<span class="x-ini" style="flex:none; width:38px; height:38px; border-radius:50%; background:var(--h2h-card); box-shadow:0 0 0 2px var(--h2h-blue); display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono',monospace; font-size:13px; font-weight:700; letter-spacing:0; color:var(--h2h-text);">JS</span>`);
  const mini = h.call(h.X.__eval('xMini'), SIN, 24, 9.5, 'J. Sinner’s closing price');
  assert.match(mini, /^<span class="x-avmini" title="J\. Sinner’s closing price" style="justify-self:end; width:24px; height:24px; border-radius:50%; border:1px solid color-mix\(in srgb, var\(--h2h-white\) 16%, transparent\);[^"]*font-size:9\.5px;[^"]*">JS<\/span>$/);
  assert.doesNotMatch(ini + mini, /<img|box-shadow:0 0 0 2px[^;]*;[^"]*<img/, 'no photo in xIni / xMini');
});
test('ruling 6: a render made before the photo index landed repaints once it lands (the picker never stays on initials while a photo exists)', async () => {
  let loads = 0, renders = 0;
  const h = HX.load({ html, globals: { playerPhotoIndex: {}, _photoIndexLoaded: false, loadPlayerPhotoIndex: () => { loads++; return Promise.resolve(); } } });
  h.X.__eval('render = () => { ' + 'globalThis.__r = (globalThis.__r || 0) + 1; }; built = true; state.aSel = "1"; state.bSel = "2";');
  h.call(h.xAv, SIN, 'a', 44, { eager: true }); h.call(h.xAv, ALC, 'b', 44, { eager: true });
  await new Promise(r => setTimeout(r, 5));
  renders = h.sb.__r || 0;
  assert.equal(loads, 1, 'one index load, however many avatars');
  assert.equal(renders, 1, 'one repaint when it lands');
  // control: an index already in hand asks nothing
  let l2 = 0; const h2 = HX.load({ html, globals: { playerPhotoIndex: {}, _photoIndexLoaded: true, loadPlayerPhotoIndex: () => { l2++; return Promise.resolve(); } } });
  h2.call(h2.xAv, SIN, 'a', 44, { eager: true });
  assert.equal(l2, 0);
});

// ── ruling 6 follow-up (2026-11-18): every avatar beside the picker shows the photo — the Model boxes and the search rows ──
test('ruling 6 follow-up: the Stennisfy Model boxes and the player search rows draw the stored photo over the initials (eager)', () => {
  const h = HX.load({ html, preload: ['escapeHtml', 'playerPhotoUrl', 'playerPhotoImg'], globals: { playerPhotoIndex: { 1: { s: 'abc' }, 2: { s: 'def' } }, _photoIndexLoaded: true } });
  const m = { priced: true, aMono: 'JS', bMono: 'CA', aName: 'J. Sinner', bName: 'C. Alcaraz', aPrice: '2.90', bPrice: '1.45', foot: null };
  const card = h.call(h.modelCard, { model: m, a: SIN, b: ALC });
  const mav = [...card.matchAll(/<span class="x-mav" style="([^"]*)">(\w+)(<img [^>]*>)?<\/span>/g)];
  assert.equal(mav.length, 2, 'two Model avatars');
  assert.deepEqual(mav.map(x => x[2]), ['JS', 'CA'], 'the initials under the photo');
  mav.forEach(x => { assert.ok(x[3], 'a photo layer'); assert.match(x[3], /loading="eager"/); assert.match(x[1], /position:relative; overflow:hidden;/); });
  assert.match(mav[0][3], /player-photos\/s\/1\.webp\?v=abc/);
  const v = { aPicked: false, bPicked: true, aSearching: true, bSearching: false, aListOpen: true, bListOpen: false, aQuery: 'sin', a: {}, b: ALC,
    aResults: [{ key: '1', full: 'Jannik Sinner', mono: 'JS', tag: 'ITA · #2', sel: false, hid: 1 }, { key: '9', full: 'No Photo', mono: 'NP', tag: '—', sel: false, hid: 2 }], aNoResults: false,
    hAChange: 1, hBChange: 2, hSwap: 3, ctxShow: false };
  const bar = h.call(h.selectorBar, v);
  const rows = [...bar.matchAll(/<span class="x-mav" style="[^"]*">(\w+)(<img [^>]*>)?<\/span>/g)];
  assert.equal(rows.length, 2);
  assert.ok(rows[0][2] && /player-photos\/s\/1\.webp/.test(rows[0][2]), 'a search row with a stored photo shows it');
  assert.ok(!rows[1][2], 'initials only for a player with no stored photo');
  const CSS = readFileSync(process.env.TEN402_CSS || join(HERE, 'h2h-page.css'), 'utf8');
  assert.match(CSS, /#h2hRoot \.x-mav > img, #h2hRoot \.x-av > img/, 'the photo fills the circle');
});

// ── page ground (founder ruling 4, 2026-11-18): the website's background with a pair too ──
test('ruling 4: the page, its tab and the sticky band read the website\'s background with players picked — never --h2h-page', () => {
  const h = HX.load({ html, globals: { SfCountryIoc: { of: () => 'ITA' } } });
  const v = { coverageLine: 'x', aPicked: true, bPicked: true, a: SIN, b: ALC, hAChange: 1, hBChange: 2, hSwap: 3, ctxShow: false, showEmpty: false, showLoading: false, showBody: false, aResults: [], bResults: [] };
  const pg = h.call(h.pageHTML, v);
  assert.match(pg, /^<div class="x-wrap" style="display:flex; align-items:flex-start; min-height:100vh; background:transparent;/);
  assert.doesNotMatch(pg, /background:var\(--h2h-page\)|x-wrap--empty/);
  const CSS = readFileSync(process.env.TEN402_CSS || join(HERE, 'h2h-page.css'), 'utf8');
  assert.match(CSS, /\.tabpage\[data-page="h2h"\] \{ background: transparent; \}/);
  assert.doesNotMatch(CSS, /background: var\(--h2h-page\)/, 'no rule fills the page with the near-black tone');
});

// ── hot lines from 2 meetings (founder ruling 3, 2026-11-18); Match analysis keeps rule a0 ──
test('ruling 3: the page ranks its hot lines from 2 meetings; Match analysis (fhHotModel, rule a0) still shows 2 meetings as results, unchanged', async () => {
  const M2 = [{ date: '2024-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2025-10-25', won: false, sets: [[4, 6], [6, 3], [3, 6]] }];
  const h = await pairPage(M2);
  const c = text(h.call(h.h2hCard, h.view()));
  assert.doesNotMatch(c, /Not enough meetings/);
  assert.match(c, /Most covered/, 'a ranked table, its top line marked');
  const h1 = await pairPage(M2.slice(0, 1));
  assert.match(text(h1.call(h1.h2hCard, h1.view())), /Not enough meetings to rank lines \(n=1\)/);
  // Match analysis: its own model, untouched — 2 meetings = results mode (no ranking)
  const F = h.view().h2h.F, defs = h.call(() => h.run('fhH2hLineDefs'))('Sinner', 'Alcaraz');
  const HM = h.call(h.call(() => h.run('fhHotModel')), F, defs, null);
  assert.equal(HM.mode, 'results', 'fhHotModel keeps a0: 1–2 meetings are results');
});

// ── Playing style windows (founder ruling 8, 2026-11-18) ──
function dnaHarness(o) {
  const sr = { players: [{ key: '1', name: 'J. Sinner', surfaces: { Hard: { career: { serve: { rating: 301.2, index: 97.5, firstWonPct: 77.1, secondWonPct: 56.2, holdPct: 89.9 }, return: { rating: 155.4, index: 96.1, breakPct: 29.8, bpConvPct: 41.7 }, underPressure: { rating: 241.3, index: 93.2 }, dominance: { rating: 1.12, index: 95.0 }, sample: { matches: (o && o.n) || 180 } } } } },
    { key: '2', name: 'C. Alcaraz', surfaces: { Hard: { career: { serve: { rating: 284.3, index: 93.5, firstWonPct: 73.3, secondWonPct: 56.6, holdPct: 86.4 }, return: { rating: 157.1, index: 98.5, breakPct: 28.7, bpConvPct: 41.2 }, underPressure: { rating: 238.4, index: 91.6 }, dominance: { rating: 1.1, index: 92.0 }, sample: { matches: 226 } } } } }] };
  const elo = { elo: { 'sinner|j': { all: { rating: 2210 }, peak: { rating: 2341, month: '2025-06' } }, 'alcaraz|c': { all: { rating: 2195 }, peak: { rating: 2309, month: '2026-03' } } } };
  if (o && o.noDom) sr.players.forEach(x => { delete x.surfaces.Hard.career.dominance; });
  const h = HX.load({ html, globals: { surfaceRatings: sr, eloRatings: elo } });
  h.call(() => h.need('psEloNorm'));
  return h;
}
test('ruling 8 + career radar (founder 2026-11-19): Career = surface-ratings career (Serve / Return / Under pressure / Dominance + their pool percentile) and the Elo PEAK with its percentile among every peak', () => {
  const h = dnaHarness();
  h.state.dnaWin = 'career'; h.state.ctxSurface = 'Hard';
  const D = h.call(h.dnaVals, SIN, ALC);
  assert.deepEqual(J(D.tabs.map(t => t.label)), ['Last 52 weeks', 'Career'], 'two windows (ruling 8 re-ruled: Last 24 months skipped)');
  assert.deepEqual(J(D.a.vals.map(x => x.raw)), [301.2, 155.4, 241.3, 1.12, 2341], 'serve, return, under pressure, dominance, the Elo peak');
  assert.deepEqual(J(D.a.vals.map(x => x.pct)), [97.5, 96.1, 93.2, 95, 50], 'the shape = the pool percentile; the peak = its place among every peak (1 of 2 below it)');
  assert.deepEqual(J(D.b.vals.map(x => x.pct)), [93.5, 98.5, 91.6, 92, 0]);
  assert.deepEqual(J(D.extra.a), [77.1, 56.2, 89.9, 29.8, 41.7], 'the rows read the same career node (return games won = breakPct)');
  const t = text(h.call(h.dnaCard, { a: SIN, b: ALC, dna: D }));
  assert.match(t, /Elo peak 2341 · 2309/, 'the radar axis names the peak');
  assert.match(t, /Ratings 2341 Elo peak 32 2309 /, 'the row is the peak, its gap on the line');
  assert.match(t, /Dominance ratio 1\.12 · 1\.10/);
  // control: a node built before the field existed draws no dominance point (a dash, never a guess)
  const hOld = dnaHarness({ noDom: true }); hOld.state.dnaWin = 'career'; hOld.state.ctxSurface = 'Hard';
  assert.deepEqual(J(hOld.call(hOld.dnaVals, SIN, ALC).a.vals.map(x => x.pct)), [97.5, 96.1, 93.2, null, 50]);
  // control: under the 10-match floor no figure but the peak
  const t9 = h.call(h.dnaVals, Object.assign({}, SIN), ALC);
  const h9 = dnaHarness({ n: 9 }); h9.state.dnaWin = 'career'; h9.state.ctxSurface = 'Hard';
  assert.deepEqual(J(h9.call(h9.dnaVals, SIN, ALC).a.vals.map(x => x.raw)), [null, null, null, null, 2341]);
  assert.ok(t9);
});
// ── Tournament record: a long list folds (founder ruling 5, 2026-11-18) ──
test('ruling 5: a long Tournament list shows its newest 6 rows, then "Show N more matches"; the toggle shows them all and "Show fewer"', () => {
  const h = HX.load({ html, globals: { _careerHistoryShards: {}, _sfDbJoinSt: 'loading', _sfDbJoinP: new Promise(() => {}) } });
  const rows = Array.from({ length: 10 }, (_, i) => tmk('2025-0' + (1 + (i % 9)) + '-1' + i, i % 2 === 0, 'R32', 'X. Opp' + i));
  const agg = h.call(h.xTrAgg, [{ ev: { name: 'Basel', surface: 'Hard', speed: 'Fast' }, P: { eds: [{ year: '2025', rows }] } }], null, true);
  const view = { a: SIN, b: ALC, tourney: { empty: false, query: '', listOpen: false, options: [], info: { name: 'Hard courts', initial: '1', meta: [] }, grp: true, gLbl: 'hard courts', TW: 'career', filters: [],
    cols: [{ p: SIN, agg, state: 'ready' }, { p: ALC, agg: null, state: 'none' }] } };
  const rowsIn = c => (c.match(/class="seg x-row" data-hid="\d+" title="Open the match statistics"/g) || []).length;
  const c = h.call(h.tourneyCard, view);
  assert.equal(rowsIn(c), 6);
  assert.match(text(c), /Show 4 more matches/);
  runH(h, /data-tr-more="a" data-hid="(\d+)"/.exec(c)[1]);
  const all = h.call(h.tourneyCard, view);
  assert.equal(rowsIn(all), 10, 'all ten');
  assert.match(text(all), /Show fewer/);
  // control: a short list draws no toggle
  const agg5 = h.call(h.xTrAgg, [{ ev: { name: 'Basel', surface: 'Hard', speed: 'Fast' }, P: { eds: [{ year: '2025', rows: rows.slice(0, 5) }] } }], null, true);
  h.state.trAAll = false;
  assert.doesNotMatch(h.call(h.tourneyCard, Object.assign({}, view, { tourney: Object.assign({}, view.tourney, { cols: [{ p: SIN, agg: agg5, state: 'ready' }, { p: ALC, agg: null, state: 'none' }] }) })), /data-tr-more/);
});

// ── Latest news: our own match reports and quotes (item 12, 2026-11-18) ──
test('item 12: the news ticker\'s reports and quotes join the card by player key, kind from the item\'s own category', () => {
  const h = HX.load({ html, globals: { _newsData: { articles: [] }, newsTickerItems: () => [
    { kind: 'ticker', id: 'treport-1', ts: Date.now() - 3600e3, players: [{ key: '2', name: 'C. Alcaraz' }, { key: '9', name: 'F. Tiafoe' }], title: 'C. Alcaraz beat F. Tiafoe, 6-3, 6-2', bodyParas: ['Alcaraz beat Tiafoe.'], cat: 'Match Reports', source: 'Stennisfy' },
    { kind: 'ticker', id: 'tquote-2', ts: Date.now() - 7200e3, players: [{ key: '1', name: 'J. Sinner' }], title: 'J. Sinner in the press', bodyParas: ['“I felt good.”'], cat: 'Quotes', source: 'Sky Sports' },
    { kind: 'ticker', id: 'tquote-3', ts: Date.now() - 7200e3, players: [{ key: '9', name: 'F. Tiafoe' }], title: 'F. Tiafoe in the press', bodyParas: ['x'], cat: 'Quotes', source: 'x' }] } });
  h.X.__eval('_xTickerKick = true');
  const v = h.call(h.newsVals, SIN, ALC);
  assert.deepEqual(J(v.feed.map(x => x.title)), ['C. Alcaraz beat F. Tiafoe, 6-3, 6-2', 'J. Sinner in the press'], 'each player\'s own items; Tiafoe\'s quote is no one\'s here');
  assert.deepEqual(J(v.feed.map(x => h.call(h.xNewsCat, x))), ['reports', 'quotes']);
  h.state.newsOpen = 'treport-1';
  const card = h.call(h.newsCard, { a: SIN, b: ALC, news: h.call(h.newsVals, SIN, ALC) });
  assert.match(text(card), /C\. Alcaraz beat F\. Tiafoe, 6-3, 6-2 C\. Alcaraz · Match report · Stennisfy · 1h ago › Alcaraz beat Tiafoe\. Match report Stennisfy · 1h ago Close/, 'the opened item: body, kind pill, source · time, Close (CHANGES 2026-11-18 §7)');
  assert.match(card, /background:var\(--h2h-layer\); box-shadow:inset 0 0 0 1px color-mix\(in srgb, var\(--h2h-white\) 12%, transparent\);/);  assert.doesNotMatch(card, /class="x-av"[^>]*box-shadow:0 0 0 2px/, 'founder 2026-11-19: no blue / white ring around a news avatar');
});

// ── the return chart keeps the design's style (founder ruling 2, 2026-11-18) ──
test('ruling 2: the return chart draws the loss shading and the vertical month lines (H2H_CHART_SMOOTH on)', () => {
  const h = HX.load({ html, globals: { _careerHistoryShards: {}, PlayerProfileV2: { _internals: { MK_BANDS } } } });
  assert.equal(h.consts.H2H_CHART_SMOOTH, true);
  let k = 0;
  const pl = (list, s) => { const rows = list.map(([ago, price, won], i) => ({ mid: 'r' + i, date: iso(day0 - ago), day: day0 - ago, won, price, oppPrice: 2.5, book: 'P', src: 'td', wo: false, round: 'R32' })); rows.win = rows;
    return { key: 'q' + (++k), short: s, full: s, mono: 'XX', _cSt: { state: 'ready', me: 'ready', rows } }; };
  const A = pl(Array.from({ length: 12 }, (_, i) => [10 + i * 20, 1.5, i < 4]), 'A. One'), B = pl(Array.from({ length: 12 }, (_, i) => [15 + i * 20, 2.4, i % 3 === 0]), 'B. Two');
  const card = h.call(h.marketCard, { market: h.call(h.marketVals, A, B, {}), a: A, b: B });
  assert.match(card, /<rect x="0" y="[\d.]+" width="1000" height="[\d.]+" fill="color-mix\(in srgb, var\(--h2h-white\) 1\.4%, transparent\)"><\/rect>/, 'the loss shading');
  assert.ok((card.match(/stroke="color-mix\(in srgb, var\(--h2h-white\) 4\.5%, transparent\)"/g) || []).length >= 2, 'the vertical month lines');
  assert.match(card, /Break even<\/span>/);
  // ruling 13 (re-ruled 2026-11-18): the founder's own words; only the removed bar / tick were reworded
  assert.match(card, /title="Cumulative units, flat 1u \(1% of bankroll, so the axis reads in %\) at closing odds on every priced match, oldest to newest; each line spans that player&#39;s own matches \(the dates follow [^)]*\)\. The bright rule is break even\. Retirements settle on Pinnacle rules for all rows\. Last 52 weeks\."/, 'the chart "?" = his text, the retirement words from RET_SETTLE_NOTE, the window');
  const band = (/<span class="x-help" title="(Win rate = [^"]*)"/.exec(card) || [])[1] || '';
  assert.match(band, /^Win rate = his win rate at closing odds in the band \(Pinnacle, else Bet365\); break even = the win rate he needs at the band&#39;s average price\. Edge = the gap between them/, 'his book rule and his "Edge = the gap between them"');
  assert.match(band, /Grey = small sample \(5–9 matches\); under 5, no rate\./, 'his sample rule');
  assert.match(band, /Retirements settle on Pinnacle rules for all rows\. Last 52 weeks\.$/, 'RET_SETTLE_NOTE and the window, last');
  assert.doesNotMatch(band, /Bar = |tick = /, 'nothing names the removed bar or tick');
});

// ── the match sheet (CHANGES 2026-11-18 §8): LOST SERVE and BP round pills on this page only ──
test('§8: on the Head to Head sheet LOST SERVE (Plex 10.5) and BP (10) are round red pills; Match analysis keeps its own', () => {
  const CSS = readFileSync(process.env.TEN402_CSS || join(HERE, 'h2h-page.css'), 'utf8');
  assert.match(CSS, /#fhSheet\.h2hx \.fh-lost \{ font-family: 'IBM Plex Mono', monospace !important; font-size: 10\.5px !important; border-radius: 999px !important; padding: 2px 9px !important; \}/);
  assert.match(CSS, /#fhSheet\.h2hx \.fh-bp \{ font-size: 10px !important; border-radius: 999px !important; padding: 1px 6px !important; \}/);
  assert.ok(CSS.split('\n').filter(l => /\.fh-(lost|bp)\b/.test(l)).every(l => l.startsWith('#fhSheet.h2hx ')), 'never unscoped');
  assert.match(html, /const lost = `<span class="fh-lost" style="font-family:var\(--font-words\); font-size:10\.5px;[^`]*border-radius:5px; padding:3px 8px;/, 'Match analysis: its own LOST SERVE (radius 5) unchanged');
});

// ── cold Head to Head link (18 Nov 2026): the Style section reads only dna-apitennis-ratings.json; a page opened on a pair
// (?a=&b= or the stn_h2h_pair handover) starts that read in the head's early-fetch block, and ensureDna takes it ──
test('cold link: a page opened on a pair starts the DNA file in the head (__sfEarly) and ensureDna takes that answer', async () => {
  const vm = await import('node:vm');
  const s0 = html.indexOf('window.__sfEarly = (function'), s1 = html.indexOf('</script>', s0);
  assert.ok(s0 > 0 && s1 > s0, 'early-fetch block found');
  const head = html.slice(s0, s1);
  const run = (search, pair) => {
    const asked = [], ss = pair ? { stn_h2h_pair: JSON.stringify(pair) } : {};
    const sb = { location: { search }, URLSearchParams, JSON, Array,
      sessionStorage: { getItem: k => (k in ss ? ss[k] : null), removeItem: k => { delete ss[k]; } },
      fetch: (u, init) => { asked.push([u, init && init.cache]); return Promise.resolve({ ok: true }); } };
    sb.window = sb; vm.runInNewContext(head, sb);
    return { asked, ss, early: sb.__sfEarly };
  };
  const DNA = './dna-apitennis-ratings.json';
  const link = run('?a=2382&b=1093');
  assert.deepEqual(link.asked.find(x => x[0] === DNA), [DNA, 'no-cache'], '?a=&b= starts the DNA read, same URL and cache mode as ensureDna');
  const hand = run('', ['2382', '1093']);
  assert.ok(hand.asked.some(x => x[0] === DNA), 'the stn_h2h_pair handover starts it too');
  assert.ok('stn_h2h_pair' in hand.ss, 'the head leaves the handover for xReadHandover');
  for (const [q, p] of [['', null], ['?a=2382', null], ['', ['2382']]]) assert.ok(!run(q, p).asked.some(x => x[0] === DNA), 'no pair → no DNA read: ' + q + JSON.stringify(p));
  // ensureDna reads through sfEarlyFetch (one request: the early answer when there is one)
  const used = [];
  const h = HX.load({ html, globals: { sfEarlyFetch: (u, init) => { used.push([u, init && init.cache]); return Promise.resolve({ ok: true, json: () => ({ players: [{ playerKey: 2382 }], _meta: {} }) }); } } });
  h.X.__eval('ensureDna()');
  assert.deepEqual(used, [[DNA, 'no-cache']]);
});
