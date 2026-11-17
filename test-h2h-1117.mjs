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
  assert.match(all, /^Total points won 50\.0% Sinner · Alcaraz 50\.0% · 2 meetings /, 'every meeting has a box score: the plain count');
  const part = await boxTiles(M2, { statsIx: new Set(['100']), shards: { 100: shard(60, 40) } });
  assert.match(part, /^Total points won 60\.0% Sinner · Alcaraz 40\.0% · 1 of 2 meetings /, 'one of two: "k of n"');
});
test('meetings box tiles (founder 2026-11-17): Went to a deciding set with exactly one decider names it — "<Winner> <x>–<y> <event> <year>"', async () => {
  const M = [{ date: '2024-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2025-10-25', won: false, sets: [[6, 4], [3, 6], [4, 6]] }];
  assert.match(await boxTiles(M), /Went to a deciding set 1 of 2 Alcaraz 2–1 Swiss Indoors 2025 /);
  const two = M.concat([{ date: '2023-10-25', won: true, sets: [[6, 7], [6, 3], [6, 4]] }]);
  assert.match(await boxTiles(two), /Went to a deciding set 2 of 3 Sinner won 1 · Alcaraz won 1 /, 'two deciders: the split, as before');
});
test('meetings box tiles (founder 2026-11-17): Favourite won names the underdog\'s win — one, several (the last), none', async () => {
  const M3 = [{ date: '2023-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2024-10-25', won: false, sets: [[4, 6], [3, 6]] }, { date: '2025-10-25', won: true, sets: [[6, 4], [6, 4]] }];
  const px = prices => (r, i) => Object.assign(r, { price: prices[i][0], oppPrice: prices[i][1], book: 'P' });
  // Sinner the favourite in 2023 (won) and 2024 (lost), the underdog in 2025 (won)
  assert.match(await boxTiles(M3, { price: px([[1.4, 3.0], [1.5, 2.6], [2.4, 1.6]]) }), /Favourite won 1 of 3 The underdog won 2 · last: Sinner at Swiss Indoors 2025/);
  assert.match(await boxTiles(M3, { price: px([[1.4, 3.0], [1.5, 2.6], [1.6, 2.4]]) }), /Favourite won 2 of 3 Alcaraz beat Sinner as the underdog · Swiss Indoors 2024/);
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
test('Record against each style (founder 2026-11-17): the "Vs style average" figure keeps its sign colour (green / red) for n 5–9; only the win rate greys; under 5 still "—"', () => {
  const h = HX.load({ html, globals: { _careerHistoryShards: {}, _sfDbJoinSt: 'loading', _sfDbJoinP: new Promise(() => {}) } });
  const six = (w) => Array.from({ length: 6 }, (_, i) => recRow(10 + i, i < w));
  const up = h.call(h.stylesCard, styleView(six(5), 50));   // 83% v 50 → +33 pts, n 6
  assert.match(up, /title="Small sample · n=6"/);
  assert.match(up, /font-size:20px; font-weight:700; line-height:1; color:var\(--h2h-grey\);">83%</, 'the rate greys at 5–9');
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
  assert.deepEqual(J(A.best), { code: 'Won', year: yr(iso(day0 - 20)) }, 'best = the won final (a full edition marked Won)');
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
  assert.match(text(cg), / 1 Hard courts 1 tournament · Swiss Indoors Surface Hard Court speed All Tournaments 1 /, 'the row names the condition; Monte Carlo (clay) is out');
  assert.match(text(cg), /J\. Sinner On hard courts · since 2025 1–0 /);
  assert.match(text(cg), /Swiss Indoors 2025 Hard · Fast · 1–0 that year/, 'group heads: event + year, surface · speed');
  // "Back to" clears both filters (back to the one tournament)
  runH(h, grp.hBack);
  assert.deepEqual([h.state.trSurf, h.state.trSpeed], ['all', 'all']);
  // Court speed Slow: Monte Carlo (its one rating reads Slow); Alcaraz never played it
  const slow = text(h.call(h.tourneyCard, { a, b, tourney: h.call(h.tourneyVals, a, b, { tourSel: 'Basel', trSpeed: 'Slow' }) }));
  assert.match(slow, / 1 Slow courts 1 tournament · Monte-Carlo Masters Surface All Court speed Slow Tournaments 1 /);
  assert.match(slow, /J\. Sinner On slow courts · since 2025 0–1 .* C\. Alcaraz has no matches on slow courts\.$/);
  // a condition nothing fits, with a window: "0 tournaments · none on record", the window named in the empty line
  const grass = text(h.call(h.tourneyCard, { a, b, tourney: h.call(h.tourneyVals, a, b, { tourSel: 'Basel', trSurf: 'Grass', trWin: 'w52' }) }));
  assert.match(grass, / 0 Grass courts 0 tournaments · none on record /);
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

// ── mini avatars (≤ 22px): no ring, class "mini" ──
test('mini avatars (CHANGES 2026-11-17 §2): ≤ 22px carry class "mini" and no box-shadow ring; the large ones keep their 2px ring (A blue, B white)', () => {
  const h = HX.load({ html });
  for (const s of [20, 22]) {
    const m = h.call(h.xAv, SIN, 'a', s);
    assert.match(m, /^<span class="x-av mini"/, s + 'px');
    assert.doesNotMatch(m, /box-shadow/, s + 'px: no ring');
  }
  assert.match(h.call(h.xAv, SIN, 'a', 38), /^<span class="x-av" [^>]*box-shadow:0 0 0 2px var\(--h2h-blue\);/);
  assert.match(h.call(h.xAv, ALC, 'b', 44), /^<span class="x-av" [^>]*box-shadow:0 0 0 2px var\(--h2h-text\);/);
});
