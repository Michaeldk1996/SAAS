#!/usr/bin/env node
// market-edge-box (founder 2026-10-29): the Market edge box on a player profile always describes the player shown.
//  1. A then B: the page's own showPlayerProfileV2 / pp2ShowLoadingIfOther / pp2RepaintIfOpen (sliced from the page)
//     with A's profile mounted and B's first paint deferred — none of A's text may remain in the view, and a repaint
//     asked for B never repaints the module still holding A. Mutations named below turn it red.
//  2. The bridge (pp2MarketDashed): pending until his history AND the join answered; team events counted apart (the
//     G. Bueno shape: 2 main draw dashed + 7 Davis Cup, 4 priced); a failed history ends the wait with no reason.
//  3. The module's empty-state words (marketEmptyText) and the box: pending claims nothing; team events named apart.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUT = process.env.ME_BOX_MUTANT || '';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
let page = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
let prof = readFileSync(join(ROOT, 'player-profile-v2.js'), 'utf8');
// named mutants (each must turn a check red; tools: ME_BOX_MUTANT=<name> node tools/test-market-edge-box.mjs)
if (MUT === 'no-shell') page = page.replace('  pp2ShowLoadingIfOther(key);\n  ppState.key = String(key);', '  ppState.key = String(key);');
if (MUT === 'repaint-any-key') page = page.replace("\n      && (!window.PlayerProfileV2.currentKey || window.PlayerProfileV2.currentKey() === String(key))) {", ') {');
if (MUT === 'team-as-main') page = page.replace("const main = atp.filter(x => !PP2_TEAM_EVENT.test(String(x.tournament || '')));", 'const main = atp;');
if (MUT === 'no-pending') page = page.replace("if (_sfDbJoinSt !== 'ready' || !_sfDbJoin || !Array.isArray(rows)) return { pending: true };", "if (_sfDbJoinSt !== 'ready' || !_sfDbJoin || !Array.isArray(rows)) return null;");
if (MUT === 'box-claims-while-pending') prof = prof.replace("      : marketEmptyWhy(p.key).pending ? { headline: null, support: null, pending: true }\n", '');
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); if (a < 0 || b < 0) throw new Error('slice not found: ' + from); return src.slice(a, b); };

// 1 · A then B
{
  const code = slice(page, 'const PP2_FIRST_PAINT_WAIT_MS', 'function showPlayerProfile(key){')
    + slice(page, 'function pp2RepaintIfOpen(key){', '\n}\n') + '\n}\n';
  const view = { style: { display: '' }, innerHTML: '', querySelector(sel) { return sel === '.pp2-main' && this.innerHTML.includes('pp2-main') ? {} : null; } };
  const listView = { style: { display: 'none' } };
  let mountedKey = '1297', repaints = 0, timers = [];
  const A_HTML = '<div class="pp2-main"><h1 class="pp2-name">K. Feldbausch</h1><div data-box="market">MARKET EDGE — no confirmed closing prices</div></div>';
  view.innerHTML = A_HTML;
  const ctx = {
    document: { getElementById: (id) => (id === 'playerProfileView' ? view : id === 'playerListView' ? listView : null), querySelector: () => null },
    window: { scrollTo() {}, marketEdge: {}, PlayerProfileV2: { mount: (v, k) => { mountedKey = String(k); v.innerHTML = '<div class="pp2-main"><h1 class="pp2-name">' + k + '</h1></div>'; return true; }, repaint: () => { repaints++; view.innerHTML = A_HTML; }, currentKey: () => mountedKey } },
    playerProfiles: { 1297: { name: 'K. Feldbausch' }, 9209: { name: 'G. Bueno' } },
    ppState: { key: '1297' }, careerSplits: {}, console,
    loadPp2MarketShard: () => new Promise(() => {}), loadCareerSplitsFor: () => new Promise(() => {}), pp2StartLoads() {}, pp2Bridge() {}, pp2DbJoinAfterPaint() {}, ppShowLoadError() {},
    setTimeout: (f) => { timers.push(f); return 1; }, Promise,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx); vm.runInContext(code, ctx);
  vm.runInContext('pp2StartLoads = function () {}; pp2LoadSplits = function () { return new Promise(function () {}); };', ctx);   // the loads are not under test
  vm.runInContext('showPlayerProfileV2("9209")', ctx);
  ok(!/Feldbausch|no confirmed closing prices/.test(view.innerHTML) && /data-pp2-loading/.test(view.innerHTML),
    'A then B: while B loads, none of A\'s name or Market edge text is in the view (a loading shell is)');
  vm.runInContext('pp2RepaintIfOpen("9209")', ctx);
  ok(repaints === 0 && !/Feldbausch/.test(view.innerHTML), 'A then B: a repaint asked for B never repaints the module still holding A');
  // the guard on its own: A still mounted in the view (any path that skipped the shell), B asked for
  view.innerHTML = A_HTML; ctx.ppState.key = '9209';
  vm.runInContext('pp2RepaintIfOpen("9209")', ctx);
  ok(repaints === 0, 'guard: with A still mounted, a repaint asked for B does not repaint A (mutant repaint-any-key)');
  mountedKey = '9209'; view.innerHTML = '<div class="pp2-main">9209</div>';
  vm.runInContext('pp2RepaintIfOpen("9209")', ctx);
  ok(repaints === 1, 'control: once B is mounted, B\'s repaint runs');
  mountedKey = '9209'; view.innerHTML = '<div class="pp2-main"><h1 class="pp2-name">G. Bueno</h1></div>';
  ok(vm.runInContext('pp2ShowLoadingIfOther("9209")', ctx) === false && /Bueno/.test(view.innerHTML), 'control: re-opening the player already shown keeps his profile');
}

// 2 · the bridge
{
  const code = slice(page, 'const PP2_TEAM_EVENT', 'window.pp2MarketDashed = pp2MarketDashed;');
  const rows = [
    { date: '2026-07-23', level: 'atp', round: '1/8-finals', tournament: 'Estoril', opponent: 'J. Faria', won: false },
    { date: '2026-07-21', level: 'atp', round: '1/16-finals', tournament: 'Estoril', opponent: 'T. Pereira', won: true },
    { date: '2026-07-19', level: 'atp', round: 'Qualifying', tournament: 'Estoril', opponent: 'A. Pellegrino', won: true },
    ...['2026-02-07', '2026-02-06', '2025-09-12', '2025-01-31', '2024-09-14', '2023-09-16', '2023-02-03'].map((d, i) => ({ date: d, level: 'atp', round: '', tournament: 'ATP Davis Cup - World Group I', opponent: 'X' + i, won: i % 2 === 0 })),
    { date: '2026-03-01', level: 'chitf', round: '1/16-finals', tournament: 'Challenger X', opponent: 'Y', won: true },
  ];
  const priced = new Set(['2026-02-07', '2025-09-12', '2025-01-31', '2023-02-03']);
  const ctx = { window: {}, _careerHistoryShards: {}, _sfDbJoinSt: 'loading', _sfDbJoin: {}, fhRoundCode: (r) => r || '—',
    sfDbPxRows: (k, n, views) => { const out = views.map((v) => (priced.has(v.date) ? { price: 1.8 } : null)); out.why = views.map((v) => (v.date.startsWith('2026-07') ? 'od10' : 'none')); return out; } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  ctx.window.careerHistory = { 9209: rows };
  ok(JSON.stringify(vm.runInContext('pp2MarketDashed("9209")', ctx)) === '{"pending":true}', 'bridge: join still loading → pending (no reason claimed yet)');
  ctx._sfDbJoinSt = 'ready'; delete ctx.window.careerHistory;
  ok(JSON.stringify(vm.runInContext('pp2MarketDashed("9209")', ctx)) === '{"pending":true}', 'bridge: history not answered → pending');
  ctx.window.careerHistory = { 9209: rows };
  const r = vm.runInContext('pp2MarketDashed("9209")', ctx);
  ok(r && r.main === 2 && r.dashed === 2 && r.priced === 0 && r.team === 7 && r.teamPriced === 4, `bridge: the Bueno shape — 2 main draw, both dashed; 7 team events, 4 priced (${JSON.stringify(r)})`);
  vm.runInContext('_pp2ChFailed.add("9209")', ctx);
  ok(vm.runInContext('pp2MarketDashed("9209")', ctx) === null, 'bridge: a failed history load ends the wait (null: no reason claimed)');
  vm.runInContext('_pp2ChFailed.delete("9209")', ctx); ctx._sfDbJoinSt = 'failed';
  ok(vm.runInContext('pp2MarketDashed("9209")', ctx) === null, 'bridge: a failed join → null');
}

// 3 · the module's words and the box
{
  const a = prof.indexOf('  function marketEmptyWhy('), b = prof.indexOf('  function renderMarketModal(');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(prof.slice(a, b), ctx);
  const say = (d) => { ctx.window.pp2MarketDashed = () => d; return vm.runInContext('marketEmptyText("9209")', ctx); };
  const t = say({ main: 2, dashed: 2, priced: 0, team: 7, teamPriced: 4 });
  ok(t === 'No confirmed closing prices for these matches. 2 of his 2 ATP main-draw matches have no Pinnacle close the close rules accept, so they show a dash. 4 of his 7 team-event matches are priced in the Database; team events (Davis Cup and the like) are left out of Market edge, as they are of every Database figure.', 'Bueno: "' + t + '"');
  ok(say({ pending: true }) === 'Loading the priced matches.', 'pending: the modal claims nothing');
  ok(/^No priced matches on record\. The odds archive is tour main-draw only.*His 3 team-event matches \(Davis Cup and the like\) are left out of Market edge/.test(say({ main: 0, dashed: 0, priced: 0, team: 3, teamPriced: 0 })), 'no main draw + unpriced team events: the Challenger line, then the team line');
  ok(say(null) === 'No priced matches on record.', 'no bridge answer: no reason claimed');
  ok(/marketEmptyWhy\(p\.key\)\.pending \? \{ headline: null, support: null, pending: true \}/.test(prof), 'box: pending while the reason is loading (never "no priced matches on record" that then changes)');
  ok(/currentKey: function \(\) \{ return mounted && state\.key \? String\(state\.key\) : null; \}/.test(prof), 'module exports currentKey (the host\'s guard reads it)');
}
console.log(fails ? `\n${fails} check(s) failed` : '\nmarket-edge-box: all checks pass');
process.exit(fails ? 1 : 0);
