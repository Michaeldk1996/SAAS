// TEN-402 round 2, builder L — the Database join (database-yield.json + database-yield-players.json, ~410 KB gz) loads
// AFTER the player profile shows (founder card 7bc622d5, 2026-10-09: "load it only when Record per tournament / Backing
// is opened (or after first paint), not before the profile shows. Cache it for the session.").
//
// Drives the REAL code: the page's loaders are sliced out of bsp-consult-dashboard.html and executed against a counting
// fetch / DatabaseTab, with the browser's frame and idle queues held by the test so "before" and "after" the first paint
// are steps the test takes; the profile module (player-profile-v2.js) runs for real on the TEN-384 fixture player.
// Every check that could pass vacuously has a control. Mutants: tools/test-ten402-r2l-mutants.js.
//
// R3 (2026-10-09): fix 1 the Head to Head page on the shared join state (retry on the next visit / after H2H_DB_RETRY_MS,
// never a loop), fix 2 the Record per tournament box on a failed join, fix 3 the live-edition rows' one reason.
//
// Run: node --test test-ten402-r2l.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const PP2 = process.env.TEN402_PP2 || join(HERE, 'player-profile-v2.js');

function sliceAt(src, start) {
  let depth = 0, i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, 'braces did not balance');
  return src.slice(start, i + 1);
}
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  assert.equal(html.indexOf(`function ${name}(`, start + 1), -1, `${name} defined twice`);
  return sliceAt(html, start);
}
const flush = () => new Promise(r => setTimeout(r, 0));
// one line of the page (a const / let inside the Head to Head closure), executed as written
function line(re) { const m = re.exec(html); assert.ok(m, 'line not found: ' + re); return m[0]; }

// ---------------------------------------------------------------- the page's loaders, executed
// `fetch` counts the two Database files; DatabaseTab.priceRows is the page's own (loadBase → loadNames → the join),
// sliced from the Database tab so its session cache is the real one.
function page(opt) {
  opt = opt || {};
  const env = { fetched: [], repaints: [], frames: [], idles: [], mounted: 0, fail: opt.fail || 0, now: 1e6, h2hRenders: 0 };
  env.fetch = url => { env.fetched.push(url);
    if (env.fail > 0) { env.fail--; return Promise.reject(new Error('network down')); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(/players/.test(url) ? { names: [] } : { meta: opt.meta || {}, rows: [] }) }); };
  env.raf = fn => { env.frames.push(fn); return env.frames.length; };
  env.ric = fn => { env.idles.push(fn); return env.idles.length; };
  env.frame = () => { const q = env.frames.splice(0); q.forEach(f => f(0)); return q.length; };
  env.idle = () => { const q = env.idles.splice(0); q.forEach(f => f({ timeRemaining: () => 10, didTimeout: false })); return q.length; };
  const el = () => ({ style: { display: 'none' } });
  env.document = { _els: { playerListView: el(), playerProfileView: el() }, getElementById(id) { return this._els[id] || null; } };
  const DB = new Function('fetch', `
    var BASE_URL = './database-yield.json', NAMES_URL = './database-yield-players.json';
    var DATA=null, NAMES=null, M=null, basePromise=null, namesPromise=null, playerIndex=null;
    function buildPlayerIndex(){ playerIndex = {}; }
    function dbPriceJoinRows(d, n){ return { rows: d.rows, names: n.names, meta: d.meta }; }
    ${slice('loadBase')}
    ${slice('loadNames')}
    var PRICE_JOIN = null;
    ${slice('priceRows')}
    return { priceRows: priceRows, loadBase: loadBase, loadNames: loadNames };`)(env.fetch);
  env.window = { DatabaseTab: { priceRows: () => { env.priceRowsCalls = (env.priceRowsCalls || 0) + 1; return DB.priceRows(); } },
    PlayerProfileV2: { mount() { env.mounted++; return true; } }, scrollTo() {} };
  env.DB = DB;
  const api = new Function('env', `
    const window = env.window, document = env.document;
    const requestAnimationFrame = env.raf, requestIdleCallback = env.ric;
    const ppState = { key: null };
    const _careerHistoryShards = {}, _trProfileFail = new Set();
    let _sfDbJoin = null, _sfDbJoinSt = null, _sfDbJoinP = null;
    function pp2RepaintIfOpen(k){ env.repaints.push(String(k)); }
    function pp2Bridge(){}
    function loadCareerHistory(k){ _careerHistoryShards[k] = []; return Promise.resolve([]); }
    function fhLoadCloses(){ return Promise.resolve(null); }
    function tourxFetchMarket(){ return Promise.resolve(null); }
    ${slice('sfDbJoinLoad')}
    ${slice('trProfileModel')}
    ${slice('loadPp2Closes')}
    ${slice('pp2DbJoinNeed')}
    ${slice('pp2DbJoinAfterPaint')}
    ${slice('pp2MountNow')}
    ${slice('trDbEnd')}
    ${slice('trDayWords')}
    ${slice('trPxAfterTitle')}
    ${slice('trPxAfterOf')}
    // the Head to Head page's side of the join (R3 fix 1): its loader, its ledger join and its ensureInit, as written;
    // render() is the page's (every render reads the join through h2hEnsureDb); the clock is the test's
    const Date = { now: () => env.now };
    const console = { warn() {} };
    ${line(/\n {2}let _h2hDb = null, _h2hDbSt = null;\n/)}
    ${line(/\n {2}const H2H_DB_RETRY_MS = [^\n]*\n/)}
    ${line(/\n {2}let _h2hDbAskAt = [^\n]*\n/)}
    const _h2hLedPx = new Map();
    function h2hCareerOf(){ return null; }
    function h2hPriceJoin(js, p, b, db){ js.forEach(j => { j.price = 1.5; j.oppPrice = 2.6; j.book = 'P'; }); return js.length; }
    function render(){ env.h2hRenders++; h2hEnsureDb(); }
    function bindDocClose(){} function triggerLoads(){} function ensureDna(){} function dataReady(){ return true; } function build(){}
    let _waitTimer = null, _waited = 0;
    ${slice('h2hEnsureDb')}
    ${slice('h2hLedgerJoin')}
    ${slice('ensureInit')}
    return { ppState, chShards: _careerHistoryShards, sfDbJoinLoad, trProfileModel, loadPp2Closes, pp2DbJoinNeed, pp2DbJoinAfterPaint, pp2MountNow,
      trPxAfterTitle, trPxAfterOf, h2hEnsureDb, h2hLedgerJoin, ensureInit,
      get h2hSt(){ return _h2hDbSt; },
      get st(){ return _sfDbJoinSt; }, get join(){ return _sfDbJoin; } };`)(env);
  return { env, api };
}
const yieldFetches = env => env.fetched.filter(u => /database-yield/.test(u)).length;

test('R2 · opening a profile requests no Database file before its first paint; the first idle moment after it requests the join once', async () => {
  const { env, api } = page();
  api.ppState.key = '2382';
  // the click-time loads (pp2StartLoads → loadPp2Closes) no longer include the join
  await api.loadPp2Closes('2382'); await flush();
  assert.equal(yieldFetches(env), 0, 'loadPp2Closes requested ' + env.fetched.join(', '));
  // the mount paints the profile; the request waits for two frames (the paint presented) and then idle
  assert.equal(api.pp2MountNow('2382'), true);
  assert.equal(env.mounted, 1, 'the profile mounted');
  assert.equal(api.st, null, 'the join was started by the mount itself');
  assert.equal(env.frame(), 1); assert.equal(api.st, null, 'the join was requested in the paint\'s own frame');
  assert.equal(env.frame(), 1); assert.equal(api.st, null, 'the join was requested before idle');
  assert.equal(env.idle(), 1);
  assert.equal(api.st, 'loading', 'the idle callback did not request the join');
  const r0 = env.repaints.length;
  await flush(); await flush(); await flush();
  assert.equal(api.st, 'ready');
  assert.ok(env.repaints.length > r0, 'no repaint when the join landed');
  assert.deepEqual(env.fetched, ['./database-yield.json', './database-yield-players.json']);
  assert.ok(env.repaints.includes('2382'), 'the profile was not repainted when the join landed');
});

test('R2 · reading the per-event model never starts the fetch (pending until asked)', async () => {
  const { env, api } = page();
  api.chShards['2382'] = [];
  const t = { name: 'US Open', editions: [] };
  assert.equal(api.trProfileModel('2382', 'C. Alcaraz', t), null, 'not asked yet = pending (null)');
  await flush();
  assert.equal(env.priceRowsCalls || 0, 0, 'the model started the Database fetch');
  assert.equal(yieldFetches(env), 0);
  // control: once asked, the same read is no longer "not asked"
  api.pp2DbJoinNeed('2382'); await flush();
  assert.equal(env.priceRowsCalls, 1);
});

test('R2 · the reader left before idle → nothing is requested (the next open asks)', async () => {
  const { env, api } = page();
  api.ppState.key = '2382';
  api.pp2MountNow('2382');
  env.frame(); env.frame();
  api.ppState.key = '2072';   // opened Sinner before the idle callback ran
  env.idle(); await flush();
  assert.equal(yieldFetches(env), 0, 'a left profile still pulled the join');
  // control: the next open asks
  api.pp2MountNow('2072'); env.frame(); env.frame(); env.idle(); await flush(); await flush(); await flush();
  assert.equal(yieldFetches(env), 2);
});

test('R2 · one fetch per session, shared by the profile, the Head to Head page and the Database page', async () => {
  const { env, api } = page();
  api.ppState.key = '2382';
  api.pp2MountNow('2382'); env.frame(); env.frame(); env.idle();
  api.pp2DbJoinNeed('2382');            // Record per tournament opened while in flight
  const h2h = api.sfDbJoinLoad();       // the Head to Head page's h2hEnsureDb
  await h2h; await flush();
  api.pp2DbJoinNeed('2382');            // opened again after it landed
  await api.sfDbJoinLoad();             // another H2H pair
  await env.DB.loadBase(); await env.DB.loadNames();   // the Database page's own loaders
  api.pp2MountNow('2072'); env.frame(); env.frame(); env.idle(); await flush();   // another profile
  assert.equal(env.fetched.filter(u => u === './database-yield.json').length, 1, env.fetched.join(', '));
  assert.equal(env.fetched.filter(u => u === './database-yield-players.json').length, 1, env.fetched.join(', '));
  assert.equal(env.priceRowsCalls, 1, 'the join was computed more than once');
});

test('R2 · a failed fetch → failed (the profile prints "—"); the next open retries and lands', async () => {
  const { env, api } = page({ fail: 1 });
  api.ppState.key = '2382'; api.chShards['2382'] = [];
  api.pp2MountNow('2382'); env.frame(); env.frame(); env.idle();
  await flush(); await flush(); await flush();
  assert.equal(api.st, 'failed');
  assert.deepEqual(api.trProfileModel('2382', 'C. Alcaraz', { name: 'US Open', editions: [] }), { failed: true });
  // the next open (Record per tournament here) retries; while in flight the model is pending again, not failed
  assert.equal(api.pp2DbJoinNeed('2382'), true);
  assert.equal(api.trProfileModel('2382', 'C. Alcaraz', { name: 'US Open', editions: [] }), null);
  await flush(); await flush(); await flush();
  assert.equal(api.st, 'ready');
  assert.equal(env.fetched.filter(u => u === './database-yield.json').length, 2, 'no retry: ' + env.fetched.join(', '));
  // control: a ready join is not fetched again
  assert.equal(api.pp2DbJoinNeed('2382'), false);
});

// ---------------------------------------------------------------- R3 fix 1 · the Head to Head page on the shared join
const ROWS = [{ date: '2025-08-18', won: true }, { date: '2025-06-08', won: true }];
const ledger = api => api.h2hLedgerJoin({ key: '2382' }, ROWS, 'h2h', r => Object.assign({}, r));
const priced = v => v.filter(x => x && x.price != null).length;

test('R3 fix 1 · H2H failed, then the profile loads the join → the H2H ledger is priced from the shared state at once', async () => {
  const { env, api } = page({ fail: 1 });
  assert.equal(priced(ledger(api)), 0, 'priced before any load');   // the first read asks (H2H opened)
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(api.st, 'failed'); assert.equal(api.h2hSt, 'failed');
  assert.equal(priced(ledger(api)), 0, 'a failed join priced a row');
  // the profile's next open retries and lands — H2H asked nothing more
  api.ppState.key = '2382'; api.chShards['2382'] = [];
  api.pp2DbJoinNeed('2382'); for (let i = 0; i < 6; i++) await flush();
  assert.equal(api.st, 'ready');
  const calls = env.priceRowsCalls;
  assert.equal(priced(ledger(api)), ROWS.length, 'the H2H ledger kept its own "failed" after the shared join landed');
  assert.equal(api.h2hSt, 'ready');
  assert.equal(env.priceRowsCalls, calls, 'H2H fetched again instead of reading the shared rows');
});

test('R3 fix 1 · a failed load never loops on render; a render after H2H_DB_RETRY_MS or the next visit asks again', async () => {
  const { env, api } = page({ fail: 99 });
  api.h2hEnsureDb(); for (let i = 0; i < 10; i++) await flush();
  assert.equal(api.h2hSt, 'failed');
  assert.ok(env.h2hRenders >= 1, 'the failure did not repaint the page');
  assert.equal(yieldFetches(env), 1, 'the render after a failure fetched again (loop): ' + env.fetched.join(', '));
  api.h2hEnsureDb(); api.h2hEnsureDb(); await flush();
  assert.equal(yieldFetches(env), 1, 'a render inside the retry window fetched');
  env.now += 15000;                       // H2H_DB_RETRY_MS later
  api.h2hEnsureDb(); for (let i = 0; i < 10; i++) await flush();
  assert.equal(yieldFetches(env), 2, 'a render after the retry window did not ask again');
  // the next visit (the nav's ensureInit(true)) asks at once, inside the window; a non-visit ensureInit does not
  api.ensureInit(); for (let i = 0; i < 10; i++) await flush();
  assert.equal(yieldFetches(env), 2, 'loadMatches\' ensureInit() hand-back retried');
  api.ensureInit(true); for (let i = 0; i < 10; i++) await flush();
  assert.equal(yieldFetches(env), 3, 'the next visit did not retry the failed join');
  // the visit retry that lands prices the ledger
  env.fail = 0; api.ensureInit(true); for (let i = 0; i < 10; i++) await flush();
  assert.equal(api.st, 'ready'); assert.equal(priced(ledger(api)), ROWS.length);
});

test('R3 fix 1 · a load another surface started repaints the H2H page when it lands (one repaint per load)', async () => {
  const { env, api } = page();
  api.ppState.key = '2382';
  api.pp2DbJoinNeed('2382');              // the profile's load, in flight
  assert.equal(api.st, 'loading');
  api.h2hEnsureDb(); api.h2hEnsureDb();   // H2H renders meanwhile
  assert.equal(api.h2hSt, 'loading');
  const r0 = env.h2hRenders;
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(env.h2hRenders - r0, 1, 'the H2H page was not repainted (or repainted twice) when the shared load landed');
  assert.equal(api.h2hSt, 'ready');
  assert.equal(env.priceRowsCalls, 1);
});

// ---------------------------------------------------------------- R3 fix 3 · the live-edition reason, one string
test('R3 fix 3 · a date after the Database archive\'s last match → the one reason; on / before it, or before the join → null', async () => {
  const { api } = page({ meta: { dateRange: ['2010-01-04', '2026-09-13'] } });
  assert.equal(api.trPxAfterOf('2026-10-06'), null, 'a reason before the join answered');
  await api.sfDbJoinLoad();
  const why = 'After the Database archive’s last match (13 Sep 2026): no closing price on record yet';
  assert.equal(api.trPxAfterTitle(), why);
  assert.equal(api.trPxAfterOf('2026-10-06'), why);
  assert.equal(api.trPxAfterOf('2026-09-14T10:00:00Z'), why);
  assert.equal(api.trPxAfterOf('2026-09-13'), null, 'the archive\'s last day itself is inside it');
  assert.equal(api.trPxAfterOf('2025-10-01'), null);
  assert.equal(api.trPxAfterOf(null), null);
});

// ---------------------------------------------------------------- the profile module, executed
const L = require('./tools/ten384-figures-lib.js');
const TI = require('./tournament-identity.js');
const FX = JSON.parse(readFileSync(join(HERE, 'tools', 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const T = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function mod(backing, more) {
  const asked = [];
  more = more || {};
  const p = Object.assign({}, FX.profile, { tournamentHistory: TI.mergeHistory ? TI.mergeHistory(FX.tournamentHistory) : FX.tournamentHistory });
  const m = L.loadPp2({ src: PP2, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory },
    marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History,
    extra: Object.assign({ TournamentIdentity: TI, trProfileBacking: typeof backing === 'function' ? backing : () => backing,
      trProfilePriceOf: () => null, pp2DbJoinNeed: k => asked.push(String(k)) }, more) });
  return { I: m.I, W: m.W, p, asked };
}
function withState(I, patch, fn) {
  const saved = Object.assign({}, I.state); Object.assign(I.state, patch);
  try { return fn(); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
const PEND = /data-pp2-pending="backing"/g;
// the Backing column = each list row's last cell
const backingCells = h => [...h.matchAll(/data-pp2="tourn-row"[\s\S]*?<\/span><\/div>/g)].map(x => { const c = x[0].lastIndexOf('<span'); return x[0].slice(c); });

test('R2 · until the join lands Record per tournament is a neutral loading state — never 0, never "—"', () => {
  const { I, p } = mod(null);   // trProfileBacking → null: not answered yet
  const views = I.tournViews(p);
  assert.ok(views.length > 10 && views.every(t => t.backingPending && t.pinPl == null && t.pinN === 0));
  const list = withState(I, { key: p.key, modal: 'tourn', tournOpen: null }, () => I.renderTournModal(p));
  const cells = backingCells(list);
  assert.ok(cells.length >= 10, 'list rows not found (' + cells.length + ')');
  assert.ok(cells.every(c => PEND.test(c) && (PEND.lastIndex = 0, true)), 'a Backing cell is not pending: ' + cells.find(c => !/data-pp2-pending="backing"/.test(c)));
  assert.ok(cells.every(c => !/—|\d/.test(T(c))), 'a pending Backing cell claims something: ' + cells.map(T).join(' | '));
  // the open event: the tile's figure is blank with "loading prices", its rows' H / A blank
  const t = views[0];
  const det = withState(I, { key: p.key }, () => I.renderTournDetail(p, t));
  const tile = T(det).match(/Backing him here (.{0,30})/)[1];
  assert.match(tile, /^loading prices/, 'the tile reads "' + tile + '"');
  const nRows = t.editions.reduce((n, e) => n + e.matches.length, 0);
  assert.equal((det.match(PEND) || []).length, 1 + 2 * nRows, 'the tile + every row\'s H and A are pending');
  // the box tile on the profile page claims nothing either
  const box = I.boxValues(p, { rows: I.ledgerMatches(p) }).tourn;
  assert.equal(box.pending, true);
});

test('R2 · a failed join prints "—" / "prices unavailable" (control: no pending marker); a landed join prints the units', () => {
  const failed = mod({ failed: true, n: 0, units: 0, rows: 0, vm: null, nb: 0, unitsTxt: null, vmTxt: null, small: false });
  const fv = failed.I.tournViews(failed.p);
  const fl = withState(failed.I, { key: failed.p.key, modal: 'tourn' }, () => failed.I.renderTournModal(failed.p));
  assert.ok(!/data-pp2-pending="backing"/.test(fl), 'a failed join still pending');
  assert.ok(backingCells(fl).every(c => T(c) === '—'), backingCells(fl).map(T).join(' | '));
  assert.match(T(withState(failed.I, { key: failed.p.key }, () => failed.I.renderTournDetail(failed.p, fv[0]))), /Backing him here — prices unavailable/);
  const ok = mod({ units: 7.1, n: 3, rows: 3, vm: null, nb: 0, unitsTxt: '+7.1u', vmTxt: null, small: false });
  const ol = withState(ok.I, { key: ok.p.key, modal: 'tourn' }, () => ok.I.renderTournModal(ok.p));
  assert.ok(!/data-pp2-pending="backing"/.test(ol));
  assert.ok(backingCells(ol).some(c => T(c) === '+7.1u'), backingCells(ol).map(T).slice(0, 5).join(' | '));
});

test('R2 · opening Record per tournament (or one of its events) asks the page for the join; other boxes do not', () => {
  const { I, W, p, asked } = mod(null);
  let handler = null;
  const container = { innerHTML: '', addEventListener(type, fn) { if (type === 'click') handler = fn; }, removeEventListener() {},
    contains: () => true, querySelector: () => null };
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null, addEventListener() {} };
  try {
    assert.equal(W.PlayerProfileV2.mount(container, p.key), true);
    assert.equal(typeof handler, 'function');
    const click = attrs => { const el = { getAttribute: a => (a in attrs ? attrs[a] : null) };
      handler({ target: { closest: () => el }, preventDefault() {} }); };
    click({ 'data-pp2': 'box', 'data-box': 'market' });
    assert.deepEqual(asked, [], 'the Market edge box asked for the Database join');
    click({ 'data-pp2': 'box', 'data-box': 'tourn' });
    assert.deepEqual(asked, [String(p.key)]);
    click({ 'data-pp2': 'tourn-row', 'data-t': I.tournViews(p)[0].name });
    assert.deepEqual(asked, [String(p.key), String(p.key)]);
  } finally { if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc; }
});

// ---------------------------------------------------------------- R3 fix 2 · the box on a failed join
const FAILED = { failed: true, n: 0, units: 0, rows: 0, vm: null, nb: 0, unitsTxt: null, vmTxt: null, small: false };
const playedIn = t => (t.editions || []).reduce((n, e) => n + (e.matches || []).length, 0);
test('R3 fix 2 · a failed join: the Record per tournament box reads "—" / "prices unavailable", never another metric; landed → the Backing figure', () => {
  const f = mod(FAILED);
  const box = f.I.boxValues(f.p, { rows: f.I.ledgerMatches(f.p) }).tourn;
  assert.equal(box.headline, null, 'the box printed a figure on a failed join: ' + box.headline);
  assert.equal(box.support, 'prices unavailable');
  assert.ok(!box.pending, 'a failed join is not pending');
  // control: the same player with every event priced (n = its played count) headlines his best event's units
  const ok = mod((k, nm, t) => ({ units: 2.5, n: playedIn(t), rows: playedIn(t), vm: null, nb: 0, unitsTxt: '+2.5u', vmTxt: null, small: false }));
  const ob = ok.I.boxValues(ok.p, { rows: ok.I.ledgerMatches(ok.p) }).tourn;
  assert.equal(ob.headline, '+2.5', JSON.stringify(ob));
  assert.match(ob.support, /best event/);
  // control 2: answered but no event clears ten priced → the W–L fallback is still the answer there (not "—")
  const few = mod((k, nm, t) => ({ units: 1, n: 1, rows: 1, vm: null, nb: 0, unitsTxt: '+1.0u', vmTxt: null, small: true }));
  assert.match(few.I.boxValues(few.p, { rows: few.I.ledgerMatches(few.p) }).tourn.support, /all events/);
});

// ---------------------------------------------------------------- R3 fix 3 · the profile rows carry the page's reason
test('R3 fix 3 · Record per tournament rows after the archive\'s last match carry the page\'s reason on H and A; earlier rows and priced rows do not', async () => {
  const LANDED = { units: 0, n: 0, rows: 0, vm: null, nb: 0, unitsTxt: null, vmTxt: null, small: false };   // the join answered
  // the fixture's Miami 2026: R64 21 Mar, R32 22 Mar (v Alcaraz), R16 24 Mar; the archive ends on 21 Mar
  const { api } = page({ meta: { dateRange: ['2010-01-04', '2026-03-21'] } });
  await api.sfDbJoinLoad();
  const why = api.trPxAfterTitle();
  assert.match(why, /^After the Database archive’s last match \(21 Mar 2026\): no closing price on record yet$/);
  // the R32 row after the end IS priced by the join: it prints its price, never the reason
  const priceOf = (k, nm, t, m) => (t.name === 'Miami' && /Alcaraz/.test(m.opp || '') && m.round === 'R32' ? { price: 1.4, oppPrice: 3.1, book: 'P' } : null);
  const { I, p } = mod(LANDED, { trPxAfterOf: api.trPxAfterOf, trProfilePriceOf: priceOf });
  const t = I.tournViews(p).find(x => x.name === 'Miami');
  assert.ok(t, 'Miami not in the fixture');
  const det = withState(I, { key: p.key }, () => I.renderTournDetail(p, t));
  const marked = [...det.matchAll(/<span data-pp2-px-after="1" title="([^"]*)"[^>]*>([^<]*)<\/span>/g)];
  // exactly the R16 row (24 Mar, unpriced): H + A, each the page's own words and "—"
  assert.equal(marked.length, 2, 'marked cells: ' + marked.length);
  assert.ok(marked.every(x => x[1] === why && x[2] === '—'), marked.map(x => x[1] + ' / ' + x[2]).join(' | '));
  assert.ok(/1\.40 3\.10/.test(T(det)), 'the priced row after the end lost its price: ' + T(det).slice(0, 400));
  // control: without the page's helper (another host) no cell is marked, and the R16 row is a plain dash
  const bare = mod(LANDED);
  const d0 = withState(bare.I, { key: bare.p.key }, () => bare.I.renderTournDetail(bare.p, bare.I.tournViews(bare.p).find(x => x.name === 'Miami')));
  assert.ok(!/data-pp2-px-after/.test(d0));
});
