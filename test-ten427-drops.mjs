// TEN-427 step 14 (Part B · Dropping Odds, founder 2026-10-10): the redesign of the live Dropping Odds page. The SHIPPED
// page (drops-page.js + drops-page.css) runs for real — in a vm with the dashboard's own move formula, name, initials and
// zone helpers sliced from bsp-consult-dashboard.html, and the shipped price-history-box.js (the Today's Matches odds
// pop-up) — fed REAL rows captured from stennisfy-drops.fly.dev on 10 Oct 2026 14:36Z (tools/fixtures/ten427-drops.json:
// /drops.json rows + lines, /status.json, the Today's Matches cards they join, the Khachanov v Mannarino card state and
// its price_history RPC payload). Nothing is invented. Every check names the mutation that turns it red
// (tools/test-ten427-drops-mutants.js). Rules: .claude/rules/drops.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(process.env.TEN427D_SRC || join(HERE, 'drops-page.js'), 'utf8');
const CSS = readFileSync(process.env.TEN427D_CSS || join(HERE, 'drops-page.css'), 'utf8');
const PHB_SRC = readFileSync(process.env.TEN427D_PHB || join(HERE, 'price-history-box.js'), 'utf8');
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const FIX = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten427-drops.json'), 'utf8'));
const NOW = Date.parse(FIX.capturedAt);
const TZ = 'Europe/Brussels';   // the member zone (stennisfy.tz) — not UTC, so a UTC clock cannot pass
const MANN = 'bet105-2161', MANN_KEY = '2026-10-11|khachanov|mannarino';
// the review case (FIX.review): real rows, cards, card states and price_history payloads for Hurkacz and Carabelli
const OCS = { ...FIX.ocs.byKey, ...FIX.review.ocs.byKey }, PHS = { ...FIX.ph, ...FIX.review.ph };
const HURK = 'bet105-2156', CARA = 'bet105-2167', CARA_SB = 'superbet-3625';

// A dashboard function, sliced whole (brace-matched), as step 13's suite does.
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, 'function ' + name);
  let depth = 0, i = html.indexOf('{', at);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
// A dashboard top-level const (the Odds tab's one book config), sliced whole up to its closing ";"
function cst(name) {
  const at = html.indexOf('\nconst ' + name + ' = ');
  assert.ok(at >= 0, 'const ' + name);
  return html.slice(at + 1, html.indexOf(';\n', at) + 1);
}
const HELPERS = [fn('mxMovePct'), fn('mxOddsTxt'), fn('newsTz'), fn('formIni'), fn('fhIni'), fn('newsPlayerName'),
  fn('acctTzOffsetMin'), fn('cardStartMs'), fn('ocsNfd'), fn('ocsNameKey'), fn('ocsMatchKey'), fn('ocsKeyOf'), fn('ppAbbrevName'),
  fn('h2hRoundLabel'), fn('roundBadgeText'),
  cst('AODDS_ALIAS'), cst('AODDS_BOOKS')].join('\n');

// the pure module, evaluated from the (possibly mutated) source with the dashboard helpers in scope
function pure(extra = {}, helpers = true) {
  const mod = { exports: {} };
  const ctx = vm.createContext({ module: mod, Intl, Date, Math, JSON, Object, Array, String, Number, isFinite, parseFloat, RegExp,
    localStorage: { getItem: (k) => (k === 'stennisfy.tz' ? TZ : null) }, ...extra });
  vm.runInContext((helpers ? HELPERS + '\n' : '') + SRC, ctx);
  return { P: mod.exports, ctx };
}
const { P, ctx: PCTX } = pure();
const ROWS = P.buildRows(FIX.feed.rows);
const row = (id) => ROWS.find((r) => r.id === id);

// The card the Today's Matches pop-up reads: its card-state row (odds-card-state.json) and its face pair, as the
// dashboard's _ocsOf / _mcNowPair hand them to price-history-box.js (those resolvers are tested with the card).
function ocsOf(m) {
  const k = vm.runInContext('ocsKeyOf', PCTX)(m), e = OCS[k];
  if (!e) return null;
  const nk = vm.runInContext('ocsNameKey', PCTX);
  return { book: e.book, startTs: e.startTs || null, p1: e.sides[nk(m.p1)], p2: e.sides[nk(m.p2)] };
}

// ── executing the real page (and the real odds pop-up) in one sandbox ──
function boot({ rows = FIX.feed.rows, lines = FIX.feed.lines, board = FIX.board, profiles = {}, index = [], status = FIX.status, menu = null, now = NOW, charts = null } = {}) {
  const root = { innerHTML: '', _l: {}, addEventListener(t, f) { root._l[t] = f; }, closest: () => ({ classList: { contains: () => true } }), querySelector: () => null };
  const overlay = { _h: '', style: { setProperty() {} }, remove() {}, querySelector: () => null };
  Object.defineProperty(overlay, 'innerHTML', { get: () => overlay._h, set: (v) => { overlay._h = v; } });
  let mounted = false; const timers = [];
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => '"e1"' }, json: async () => body, text: async () => JSON.stringify(body) });
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const document = { readyState: 'complete', activeElement: null, querySelector: () => null, addEventListener() {},
    getElementById: (id) => (id === 'dropsRoot' ? root : id === 'doOverlay' ? (mounted ? overlay : null) : id === 'dropsTabBtn' ? { style: {} } : null),
    body: { appendChild: () => { mounted = true; } }, createElement: () => overlay };
  const sb = {
    document, location: { search: '' }, URLSearchParams, Intl, Date: FakeDate, Promise, JSON, Math, String, Number, Object, Array, Map, isFinite, parseFloat, RegExp, Error,
    localStorage: { getItem: (k) => (k === 'stennisfy.tz' ? TZ : null) },
    fetch: async (url, opt) => {
      url = String(url);
      if (url.endsWith('/status.json')) return res(status);
      if (url.endsWith('/drops.json')) return res({ schema: 1, windowHours: FIX.feed.windowHours, rows, lines });
      if (/\/rpc\/price_history$/.test(url)) return res(PHS[JSON.parse(opt.body).p_card_key] || null);
      return { ok: false, status: 404 };
    },
    setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    matches: board, playerProfiles: profiles, playerIndex: index,
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', CSS: { escape: (s) => s },
    addEventListener() {}, matchMedia: () => ({ matches: false }), _ocsOf: ocsOf,
    _mcNowPair: (m) => { const o = ocsOf(m); return o ? { p1: o.p1.now, p2: o.p2.now, book: o.book, at: o.p2.nowTs, src: 'ocs' } : null; },
    _openAnchorOf: (m, who) => { const o = ocsOf(m); return o ? o[who].open : null; },
    MC_BOOK_NAMES: { bet105: 'Bet105' },
    // a matched card's TEN-295 chart shard, as the dashboard's ensureOddsMovement loads it (odds/<eventKey>.json → chart)
    ...(charts ? { ensureOddsMovement: async (m) => { m._oddsLoaded = true; m.oddsMovement = { chart: charts[m.id] || null }; } } : {}),
  };
  sb.window = sb; sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(HELPERS, ctx);
  vm.runInContext(PHB_SRC, ctx);
  vm.runInContext(SRC, ctx);
  const D = sb.DropsPage;
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  return { D, st: D._state, root, overlay, timers, flush, sb,
    start: async () => { D.setActive(true); await flush(); if (menu) { D._state.menu = menu; D.setActive(true); await flush(); } return root.innerHTML; },
    open: async (id, book) => { D._state.drawer = id; D._state.drBook = book || null; D._state.modalKey = null; D.setActive(true); await flush(); D._state.modalKey = null; D.setActive(true); await flush(); return overlay._h; },
    // a real click through the page's own delegated handler (onClick on the root), on an element carrying data-act / data-v
    click: async (act, v) => {
      const el = { getAttribute: (a) => (a === 'data-act' ? act : a === 'data-v' ? (v == null ? null : String(v)) : null), hasAttribute: () => false, closest: () => null };
      root._l.click({ target: { closest: () => el }, stopPropagation() {}, preventDefault() {} });
      await flush(); return root.innerHTML;
    } };
}

test('Data 1/2 — every row is a real alert from the drops endpoint: two books, Match winner, upcoming matches only', async () => {
  // the page reads only the Fly endpoint (no api-tennis odds, no Supabase table) for its rows
  assert.match(SRC, /var ENDPOINT = 'https:\/\/stennisfy-drops\.fly\.dev';/);
  assert.deepEqual([...new Set(ROWS.map((r) => r.book))].sort(), ['Bet105', 'Superbet'], 'the books the rows come from');
  assert.ok(ROWS.every((r) => r.mk === 'mw'), 'Match winner only');
  const x = boot(); const h = await x.start();
  const n = (re) => (h.match(re) || []).length;
  // r2 ruling: of the 8 captured rows, the 4 whose start is still ahead are listed (Sesko's unknown row is past its
  // start, Martinez is in play, Fery and D'agostino finished)
  assert.equal(n(/class="do-row"/g), 4);
  assert.deepEqual([...h.matchAll(/data-act="row" data-v="([^"]+)"/g)].map((m) => m[1]).sort(), ['bet105-2161', 'superbet-3590', 'superbet-3634', 'superbet-3647']);
  // no seeded data, no placeholder copy; the only <img> is a player photo by ID (founder 2026-10-23)
  for (const bad of ['Book A', 'hsh(', ' D()', 'illustrative', 'Illustrative', 'ILLUSTRATIVE', 'Placeholder', 'placeholder names', 'randomuser']) assert.ok(!h.includes(bad), bad);
  assert.ok(!/<img(?! class="sf-ph")/.test(h), 'every <img> is the shared photo layer');
  assert.doesNotMatch(SRC, /function D\(|function hsh|Book [A-G]\b|randomuser|resolveProfilePhotoUrl|photoCandidatesFor/);
});

test('R1 — the drop is the Today\'s Matches move formula on the 2 dp prices the row shows (mxMovePct), within one book', () => {
  const mx = vm.runInContext('mxMovePct', PCTX);
  for (const r of ROWS) {
    const m = mx(r.open, r.now);
    assert.equal(r.drop, -m.v, `${r.id}: ${r.open} → ${r.now}`);
  }
  // the three drops reproduced by hand from the shown prices
  assert.equal(row('superbet-3634').drop, 25.3, '7.90 → 5.90: 2.00 / 7.90 = 25.32%');
  assert.equal(row('superbet-3647').drop, 24.5, '5.10 → 3.85: 1.25 / 5.10 = 24.51%');
  assert.equal(row(MANN).drop, 18.1, '4.31 → 3.53: 0.78 / 4.31 = 18.10%');
  // the half case: 2.40 → 2.25 is exactly 6.25% on the shown digits; float division gives 6.2499…, the shown rule 6.3
  const dag = row('superbet-3538');
  assert.equal(dag.drop, 6.3); assert.equal(((2.4 - 2.25) / 2.4 * 100).toFixed(1), '6.2', 'the unrounded quotes would print 6.2');
  // outside the dashboard (no mxMovePct) the module's own digits rule gives the same figures
  const bare = pure({}, false).P;
  assert.equal(vm.runInContext('typeof mxMovePct', pure({}, false).ctx), 'undefined', 'no dashboard formula in scope');
  for (const r of bare.buildRows(FIX.feed.rows)) assert.equal(r.drop, row(r.id).drop, r.id);
});

test('Data 4 — ONE chart source: the Bet105 line in the box IS the Today\'s Matches odds-movement pop-up\'s rows, same open / now', async () => {
  const PHB = (() => { const m = { exports: {} }; vm.runInContext(PHB_SRC, vm.createContext({ module: m, Intl, Date, Math, JSON, Map, Number, String, isFinite })); return m.exports; })();
  const card = FIX.board.find((m) => m.id === 'upcoming-12169731');
  const nk = vm.runInContext('ocsNameKey', PCTX), payload = FIX.ph[MANN_KEY];
  // what the pop-up lists for A. Mannarino (p2): its model over sideRows, newest first
  const o = ocsOf(card);
  const tm = PHB.model({ book: 'Bet105', open: { price: o.p2.open, at: o.p2.openTs }, now: o.p2.now, startAt: null, historyAvailable: true, pctOk: true },
    PHB.sideRows(payload, nk(card.p2), nk), []);
  const ledger = tm.rows.filter((x) => !x.gap).map((x) => [x.at, x.price]).reverse();
  // the box's Bet105 line, from the shipped page code over the same payload
  const ph = P.phSeries(PHB, payload, nk, card, 'p2', null, null);
  const r = row(MANN);
  const mb = P.modalBooks(r, { rows: ROWS, ph, now: NOW });
  const b105 = mb.books.find((b) => b.book === 'Bet105');
  assert.equal(b105.own, true); assert.equal(b105.ph, true, 'the Bet105 book reads the pop-up rows');
  const series = b105.series.map((p) => [p.t, p.v]);
  for (const [at, price] of ledger) assert.ok(series.some(([t, v]) => t === at && v === price), `ledger row ${new Date(at).toISOString()} ${price} is a point of the box line`);
  assert.equal(series.length, PHB.changesOnly(PHB.sideRows(payload, nk(card.p2), nk)).length, 'no extra point: the alert\'s own points are not spliced in');
  // same open / now / move for the same book
  assert.equal(r.open, tm.open.price); assert.equal(r.now, tm.now);
  assert.equal(P.dropOf(r.open, r.now), -vm.runInContext('mxMovePct', PCTX)(tm.open.price, tm.now).v);
  // and the executed page: the box opened on the row fetches the card's price_history once and prints 4.31 → 3.53
  const x = boot(); await x.start();
  const h = await x.open(MANN);
  assert.ok(x.st.phCache && x.st.phCache[MANN_KEY] && x.st.phCache[MANN_KEY].payload, 'the box read the card\'s price_history');
  assert.match(h, /<span class="do-ov-open"><span>4\.31<\/span><\/span><span class="do-ov-arrow">→<\/span><span class="do-ov-now"><span>3\.53<\/span><\/span>/);
  assert.match(h, /data-v="Bet105" title="Bet105">[\s\S]*?<span class="do-ov-to">4\.31<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">3\.53<\/span>[\s\S]*?▼ 18\.1%/);
  // the pop-up's own header for the same card: open 4.31 → now 3.53, −18.1%
  const tmh = PHB.html(tm);
  assert.match(tmh, /<span class="phb-open">4\.31<\/span><span class="phb-arr">→<\/span><b class="phb-now">3\.53<\/b><span class="phb-pct neg">−18\.1%<\/span>/);
});

test('Data 3 — one Sharp / Soft grouping (odds.md AODDS_BOOKS); the Bookmaker menu lists the books in the data, house names', async () => {
  assert.equal(P.bookCls('Bet105'), 'sharp'); assert.equal(P.bookCls('Superbet'), 'soft');
  assert.equal(P.bookCls('Betfair Exchange (recorded by us)'), 'sharp', 'an exchange never counts as soft');
  assert.equal(P.bookCls('Pinnacle +30s'), 'sharp'); assert.equal(P.bookCls('bet365 (api-tennis)'), 'soft');
  const x = boot({ menu: 'book' }); const h = await x.start();
  const pop = h.slice(h.indexOf('<div class="do-pop">'));
  assert.match(pop, /^<div class="do-pop"><div class="do-pop-h">Sharp<\/div><span class="do-opt on multi" data-act="book" data-v="Bet105"><span class="do-box">✓<\/span><span class="do-opt-l">Bet105<\/span><\/span><div class="do-pop-h">Soft<\/div><span class="do-opt on multi" data-act="book" data-v="Superbet">/);
  assert.doesNotMatch(pop.slice(0, pop.indexOf('</div></div>')), /Pinnacle|Betfair|bet365/, 'only books with a row');
});

test('Data 5 — tier tags, event and surface from a matched Today\'s Matches card only; shared names; Surface filters on them', async () => {
  assert.deepEqual([...new Set(ROWS.map((r) => r.tier))].sort(), ['ATP', 'Challenger', 'ITF'], 'the feed prices ITF too: the tag stays');
  const calls = [];
  const h = { eventName: (raw) => { calls.push(raw); return raw === 'ATP Shanghai' ? 'Shanghai Masters' : raw; }, playerName: (k, n) => ({ 1: 'K. Khachanov', 2: 'A. Mannarino' })[k] || n, keyOf: () => null };
  const card = { ...FIX.board.find((m) => m.id === 'upcoming-12169731'), p1Key: 1, p2Key: 2 };
  const m = P.rowMeta(row(MANN), [card], h);
  assert.deepEqual([m.event, m.surface, m.a, m.b, m.side, m.opp], ['Shanghai Masters', 'Hard', 'K. Khachanov', 'A. Mannarino', 'A. Mannarino', 'K. Khachanov']);
  assert.deepEqual(calls, ['ATP Shanghai'], 'the canonical event table reads the card\'s tour');
  const lone = P.rowMeta(row('superbet-3634'), [card], h);
  assert.deepEqual([lone.event, lone.surface, lone.side], [null, null, 'Matteo Covato'], 'no card: no event, no surface, the feed spelling');
  // executed: the matched row's detail line carries the event, others leave the segment out; Surface lists Hard
  const x = boot({ menu: 'surf' }); const html = await x.start();
  assert.match(html, /<span class="do-detail">Match winner · vs B\. Shelton · ATP Shanghai · Superbet<\/span>/);
  assert.match(html, /<span class="do-detail">Match winner · vs L\. Andrade Da Silva · Superbet<\/span>/);
  assert.match(html, /data-act="surf" data-v="all"><span class="do-opt-l">All<\/span><span class="do-tick">✓<\/span><\/span><span class="do-opt" data-act="surf" data-v="Hard">/);
  const S = { ...P.defaults(['Bet105', 'Superbet']), surf: 'Hard' };
  const meta = ROWS.map((r) => Object.assign({}, r, (() => { const q = P.rowMeta(r, FIX.board, {}); return { surface: q.surface }; })()));
  assert.deepEqual([...P.view(meta, S, NOW).list.map((r) => r.id)].sort(), ['bet105-2161', 'superbet-3590'], 'a surface filter keeps only rows a card says are on it');
});

test('Data 6 — Updated = the endpoint\'s generatedAt (the read behind the list and the tail), HH:MM in stennisfy.tz', async () => {
  const x = boot(); const h = await x.start();
  // generatedAt 14:36:07.895Z = 16:36 Brussels, read 2 s before the capture
  assert.equal(FIX.status.generatedAt, '2026-10-10T14:36:07.895Z');
  assert.match(h, /<span class="sfh__l">Updated<\/span><span class="sfh__v" data-k="updated">16:36<\/span>/);
  const aged = await boot({ status: { ...FIX.status, generatedAt: '2026-10-10T14:35:42.000Z', ageS: 27 } }).start();
  assert.match(aged, /data-k="updated">16:35</, 'Updated follows the read, never the clock (16:36 here)');
  const late = boot({ status: { ...FIX.status, generatedAt: '2026-10-10T13:59:00.000Z', ageS: 2255 } }); const hl = await late.start();
  assert.match(hl, /data-k="updated">15:59</, 'a stale read keeps its own time');
  assert.match(hl, /Showing prices as of <span class="do-mono">15:59<\/span>/);
  // the box start line and the X axis in the same zone: Mannarino 06:00 Brussels (the card's time, not the vendor's 22:00Z)
  const b = await boot().open(MANN);
  assert.match(b, /<span class="do-ov-start"><span>06:00<\/span> \(<span>in 13h 23m<\/span>\)<\/span>/);
});

test('Data 7 — no Alerts (no per-member alert backend) and no Refresh: the list re-reads the endpoint every 30 s', async () => {
  const x = boot(); const h = await x.start();
  assert.doesNotMatch(h, /Alerts|alerts|Coming soon|COMING SOON|data-act="refresh"|>Refresh</);
  assert.ok(x.timers.includes(30000), 'polls on the endpoint\'s 30 s cadence');
  assert.match(SRC, /var POLL_MS = 30000;/);
});

test('Header — the ticket\'s sentence (no tail, r3 item 4), Drops · Biggest · Window · Updated', async () => {
  const h = await boot().start();
  assert.match(h, /<p class="sfh__sub"><span class="do-subtitle">Prices that have shortened since we first recorded them, each within one bookmaker\. Biggest drops first\.<\/span><\/p>/);
  const labels = [...h.matchAll(/<span class="sfh__l">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Drops', 'Biggest', 'Window', 'Updated']);
  assert.match(h, /data-k="drops">4</); assert.match(h, /data-k="biggest">25\.3%</);
  assert.match(h, /<span class="do-count">4 moves across 4 matches<\/span>/);
});

test('Rows — initials avatars, the open struck through (r3 item 5), the drop in --neg, "moved …" on every (upcoming) row', async () => {
  const h = await boot().start();
  assert.match(h, /<span class="do-av" aria-hidden="true">MC<\/span><div class="do-who-t"><span class="do-sel">M\. Covato to win/);
  assert.match(h, /<span class="do-px-o">7\.90<\/span><span class="do-px-a">→<\/span><span class="do-px-n">5\.90<\/span>/);
  assert.equal((h.match(/<span class="do-moved">moved [^<]+ ago<\/span>/g) || []).length, 4, 'no "last pre-match" / cut line on a listed row');
  assert.match(CSS, /\[data-page="drops"\] \.do-px-o \{ font-size: 13px; color: var\(--text-label\); text-decoration: line-through; text-decoration-color: color-mix\(in srgb, var\(--neg\) 60%, transparent\); \}/, 'the reference\'s strike: rgba(224,97,111,0.6), thickness auto');
  assert.match(CSS, /\[data-page="drops"\] \.do-fig-n \{[^}]*color: var\(--neg\);/);
  assert.match(CSS, /\[data-page="drops"\] \.do-meter \{[^}]*background: color-mix\(in srgb, var\(--text\) 6%, transparent\);/);
  assert.match(CSS, /\[data-page="drops"\] \.do-av \{[^}]*background: var\(--inner\); border: 1px solid var\(--edge-10\);/);
  assert.match(CSS, /\[data-page="drops"\] \.do-row \{[^}]*border-radius: 12px; background: var\(--card\); box-shadow: var\(--top-light\); border: 1px solid transparent;/);
  assert.match(CSS, /\[data-page="drops"\] \.do-row:hover \{ border-color: var\(--edge-16\); \}/);
});

test('What changes — darker-track rails, the site tab row, the site filter menu, search, Sharp / Soft tags, banner', () => {
  const rule = (sel) => { const i = CSS.indexOf(sel + ' {'); assert.ok(i >= 0, sel); return CSS.slice(i, CSS.indexOf('}', i) + 1); };
  assert.match(rule('[data-page="drops"] .do-rail'), /background: var\(--inner\);/);
  assert.match(rule('[data-page="drops"] .do-seg.on'), /background: var\(--selected\); border-color: var\(--edge-16\);/);
  assert.match(rule('[data-page="drops"] .do-seg.on'), /font-weight: 700; color: var\(--text\);/);
  assert.match(rule('[data-page="drops"] .do-tab.on'), /border-bottom-color: var\(--text\);/);
  assert.match(rule('[data-page="drops"] .do-tab-n'), /font-family: 'IBM Plex Mono', monospace;[^}]*color: var\(--text-label\);/);
  assert.match(rule('[data-page="drops"] .do-pop'), /max-height: 252px;[^}]*background: var\(--card\); border: 1px solid var\(--edge-10\); border-radius: 10px; box-shadow: var\(--shadow-menu\); padding: 4px;/);
  assert.match(rule('[data-page="drops"] .do-trig.active'), /background: var\(--selected\); border-color: var\(--edge-16\);/);
  assert.match(rule('[data-page="drops"] .do-opt.on:not(.multi)'), /background: var\(--selected\);/);
  assert.match(rule('[data-page="drops"] .do-opt.on .do-box'), /background: var\(--text\); border-color: var\(--text\);/);
  assert.match(rule('[data-page="drops"] .do-box'), /border: 1px solid color-mix\(in srgb, var\(--text\) 18%, transparent\); color: var\(--page\);/);
  assert.match(rule('[data-page="drops"] .do-search'), /border-radius: 9px; background: var\(--inner\); border: 1px solid transparent;/);
  assert.match(rule('[data-page="drops"] .do-search:focus-within'), /border-color: var\(--edge-16\);/);
  assert.match(rule('.do-ov-btag'), /font-family: 'IBM Plex Mono', monospace; font-size: 8\.5px; font-weight: 700;[^}]*border-radius: 4px; background: var\(--inner\); color: var\(--text-label\); border: none;/);
  assert.match(rule('[data-page="drops"] .do-banner'), /background: var\(--card\); box-shadow: var\(--top-light\);/);
  assert.match(rule('[data-page="drops"] .do-banner-k'), /color: var\(--neg\);/);
  // colour: no blue fill / ring / outline (only --link text), no surface colours
  assert.doesNotMatch(CSS, /var\(--bar\)|var\(--hot-dot\)|var\(--viz-lead\)|var\(--open-card\)|--viz-(hard|clay|grass|indoor)/);
  assert.ok((CSS.match(/var\(--link\)/g) || []).every(() => true));
  for (const m of CSS.matchAll(/([^{}]+)\{[^}]*var\(--link\)[^}]*\}/g)) assert.match(m[0], /(^|\s)color: var\(--link\)/, 'link colour only as text: ' + m[1].trim());
});

test('Box — time axis 1a (HH:MM over day bands split at midnight, member zone), neutral end plate, no strike, rank / Elo absent', async () => {
  const h = await boot().open(MANN);
  const ticks = [...h.matchAll(/<div class="do-ov-xax">([\s\S]*?)<\/div>/g)][0][1];
  assert.ok([...ticks.matchAll(/<span>([^<]+)<\/span>/g)].every((m) => /^\d\d:\d\d$/.test(m[1])), 'HH:MM only');
  const bands = [...h.matchAll(/<span class="do-ov-bt">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(bands, ['9 Oct', '10 Oct'], 'the day under the ticks, split at midnight Brussels');
  assert.match(h, /<line class="do-day" x1="[\d.]+" y1="0" x2="[\d.]+" y2="300"/);
  // the split sits at 00:00 Brussels = 22:00Z on 9 Oct
  const P2 = P.dayBands(Date.parse('2026-10-09T14:56:50Z'), Date.parse('2026-10-10T14:36:00Z'));
  const x0 = Date.parse('2026-10-09T14:56:50Z'), x1 = Date.parse('2026-10-10T14:36:00Z');
  assert.ok(Math.abs(parseFloat(P2.splits[0]) - (Date.parse('2026-10-09T22:00:00Z') - x0) / (x1 - x0) * 1000) < 1.2, P2.splits);
  assert.match(h, /<div class="do-ov-endw">Now<\/div>/);
  const vis = h.replace(/<[^>]+>/g, ' ');
  for (const bad of ['Elo', 'Rank', '#']) assert.ok(!vis.includes(bad), bad);
  assert.match(h, /<span class="do-ov-eye"><span>Match winner<\/span> · <span>Bet105<\/span><span class="do-ov-btag sharp"><span>SHARP<\/span><\/span><\/span>/);
  assert.match(h, /<span class="do-ov-evr">· <span>ATP Shanghai<\/span>/, 'event from the matched card (sfEventName in the dashboard)');
  // selecting another book swaps the chart and offers Back to the row's book
  const other = await boot().open(MANN, 'Superbet');
  assert.match(other, /class="do-ov-tr sel" role="button" tabindex="0" data-act="book" data-v="Superbet"/);
  assert.match(other, /data-act="back">Back to Bet105<\/span>/);
  assert.match(other, /class="do-ov-tr own" role="button" tabindex="0" data-act="book" data-v="Bet105"/, 'the row\'s own book keeps its mark');
  assert.match(CSS, /\.do-ov-tr\.sel:not\(\.own\), \.do-ov-tr\.sel:not\(\.own\):hover \{ background: var\(--selected\); border-color: var\(--line\); \}/, 'the clicked book: lift, never a red tint');
});

test('Copy — empty state, Open tooltip, box footer', async () => {
  const x = boot(); await x.start();
  x.st.S.min = 30; x.D.setActive(true); await x.flush();
  assert.match(x.root.innerHTML, /<div class="do-empty"><span class="do-empty-h">No moves above your threshold in this window\.<\/span><span class="do-empty-d">Min drop 30% · since open<\/span><button class="do-link" data-act="reset">Reset filters<\/button><\/div>/);
  assert.match(x.root.innerHTML, /<span class="do-tip">First price Stennisfy recorded, not necessarily the bookmaker’s opening line\.<\/span>/);
  const b = await boot().open(MANN);
  assert.match(b, /Down 10% or more at \d+ of \d+ books we record quoting this line \(\d+ of \d+ sharp\)\./);
});

test('Data 4 (review) — the pop-up rows stand for Bet105 only when they agree with the Bet105 row: Hurkacz 2.70 vs 2.50 draws the feed\'s points', async () => {
  const R = P.buildRows(FIX.review.rows), rw = (id) => R.find((r) => r.id === id);
  const PHB = (() => { const m = { exports: {} }; vm.runInContext(PHB_SRC, vm.createContext({ module: m, Intl, Date, Math, JSON, Map, Number, String, isFinite })); return m.exports; })();
  const nk = vm.runInContext('ocsNameKey', PCTX);
  // the captured pop-up rows for Hurkacz, cut as the page cuts them (the card's start, and its Close sighting 04:32:57Z),
  // end at 2.70; the row's last pre-match is 2.50 (09:51Z)
  const card = FIX.review.board.find((m) => m.id === 'past-12169488'), cs = FIX.review.ocs.byKey['2026-10-09|djokovic|hurkacz'];
  const ph = P.phSeries(PHB, FIX.review.ph['2026-10-09|djokovic|hurkacz'], nk, card, 'p2', cs.startTs, cs.sides.hurkacz.closeTs);
  const h = rw(HURK);
  assert.equal(ph.side[ph.side.length - 1].v, 2.7); assert.equal(h.now, 2.5); assert.equal(h.open, 2.55);
  assert.equal(P.phAgrees(ph.side, h), false, 'last pop-up row 2.70 ≠ the row\'s 2.50');
  const mb = P.modalBooks(h, { rows: R, ph, now: NOW, cutAt: h.cutAt });
  const b = mb.books.find((x) => x.book === 'Bet105');
  assert.equal(mb.phMismatch, true); assert.equal(b.ph, false, 'the feed\'s points, not the pop-up rows');
  assert.equal(b.first.v, 2.55); assert.equal(b.now.v, 2.5); assert.equal(b.series[b.series.length - 1].v, 2.5, 'the line ends on the row\'s now');
  assert.ok(!b.series.some((p) => p.v === 2.7), 'no pop-up row in the line');
  // the feed's points over a source that runs past the row: the same Kibl ticks as a chart shard (the captured stream's
  // pre-start rows for Hurkacz, 2.49 at 09:52:54Z after the row's 2.50 at 09:51:58Z) — the line still ends on 2.50
  const ticks = FIX.review.ph['2026-10-09|djokovic|hurkacz'].stream.filter((t) => t.side === 'hurkacz' && t.at < h.cutAt).map((t) => [t.at, t.price]);
  assert.ok(ticks.some(([at, v]) => v === 2.49 && Date.parse(at) > Date.parse(h.latest.at)), 'a source tick after the row\'s now');
  const sh = P.modalBooks(h, { rows: R, ph, now: NOW, cutAt: h.cutAt, chart: { books: { Bet105: { p2: ticks, p1: [] } } }, cardSide: 'p2' }).books.find((x) => x.book === 'Bet105');
  assert.equal(sh.series[0].v, 2.55, 'first point = the table\'s "from"');
  assert.equal(sh.series[sh.series.length - 1].v, 2.5, 'the end plate = the table\'s NOW, not the later 2.49');
  assert.equal(P.endOf(sh.series, sh.seen, h.cutAt, NOW).v, 2.5);
  // an agreeing pop-up (Mannarino) still draws the pop-up rows
  const mph = P.phSeries(PHB, FIX.ph[MANN_KEY], nk, FIX.board.find((m) => m.id === 'upcoming-12169731'), 'p2', null, null);
  assert.equal(P.phAgrees(mph.side, row(MANN)), true);
  // executed: Hurkacz's box — header, table, end plate all 2.55 → 2.50, ▼ 2.0%
  const x = boot({ rows: FIX.review.rows, lines: {}, board: FIX.review.board }); await x.start();
  const hb = await x.open(HURK);
  assert.ok(x.st.phCache['2026-10-09|djokovic|hurkacz'] && x.st.phCache['2026-10-09|djokovic|hurkacz'].payload, 'the box did read the card\'s price_history');
  assert.match(hb, /<span class="do-ov-open"><span>2\.55<\/span><\/span><span class="do-ov-arrow">→<\/span><span class="do-ov-now"><span>2\.50<\/span><\/span>/);
  assert.match(hb, /data-v="Bet105" title="Bet105">[\s\S]*?<span class="do-ov-to">2\.55<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">2\.50<\/span>[\s\S]*?▼ 2\.0%/);
  assert.match(hb, /<div class="do-ov-endv"><span>2\.50<\/span><\/div>/, 'the end plate = the table\'s now');
  // Carabelli: the Bet105 box and the Superbet box read Bet105 the same (7.63 from 15.49), never the pop-up's 10.05
  const cb = await x.open(CARA);
  assert.match(cb, /<span class="do-ov-now"><span>7\.63<\/span><\/span>/); assert.match(cb, /<div class="do-ov-endv"><span>7\.63<\/span><\/div>/);
  assert.match(cb, /data-v="Bet105" title="Bet105">[\s\S]*?<span class="do-ov-to">15\.49<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">7\.63<\/span>/);
  const sb = await x.open(CARA_SB);
  assert.match(sb, /data-v="Bet105" title="Bet105">[\s\S]*?<span class="do-ov-to">15\.49<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">7\.63<\/span>/, 'Bet105 in the Superbet row\'s box = the Bet105 row');
  assert.ok(!/<span>10\.05<\/span>/.test(sb.slice(sb.indexOf('data-v="Bet105"'))), 'not the pop-up\'s 10.05');
  const sbB = await x.open(CARA_SB, 'Bet105');
  assert.match(sbB, /<div class="do-ov-endv"><span>7\.63<\/span><\/div>/, 'its chart ends where the Bet105 box\'s does');
});

test('Data 4 (review) — a sighting is carried to the pop-up line only when it confirmed the same price', () => {
  const PHB = (() => { const m = { exports: {} }; vm.runInContext(PHB_SRC, vm.createContext({ module: m, Intl, Date, Math, JSON, Map, Number, String, isFinite })); return m.exports; })();
  const nk = vm.runInContext('ocsNameKey', PCTX), r = row(MANN);
  const ph = P.phSeries(PHB, FIX.ph[MANN_KEY], nk, FIX.board.find((m) => m.id === 'upcoming-12169731'), 'p2', null, null);
  const seen = '2026-10-10T14:30:00.000Z';
  const line = (last) => ({ books: { Bet105: { side: [[r.openAt, '4.31'], ['2026-10-10T09:02:34.488Z', last]], lastSeen: seen } } });
  const same = P.modalBooks(r, { rows: ROWS, ph, line: line('3.53'), now: NOW }).books.find((b) => b.book === 'Bet105');
  assert.equal(same.ph, true); assert.equal(same.seen, Date.parse(seen), 'the endpoint saw 3.53, the pop-up\'s last price: carried');
  const other = P.modalBooks(r, { rows: ROWS, ph, line: line('3.60'), now: NOW }).books.find((b) => b.book === 'Bet105');
  assert.equal(other.ph, true); assert.equal(other.seen, null, 'a sighting of 3.60 confirms nothing about 3.53');
});

test('Data 4 (review) — the box\'s copy of a card\'s price_history expires after 60 s, as the pop-up\'s', async () => {
  const x = boot(); await x.start(); await x.open(MANN);
  const first = x.st.phCache[MANN_KEY];
  assert.ok(first && first.payload && first.at === NOW);
  first.at = NOW - 30000; await x.open(MANN);
  assert.equal(x.st.phCache[MANN_KEY], first, 'within 60 s: the same entry');
  first.at = NOW - 60000; await x.open(MANN);
  const second = x.st.phCache[MANN_KEY];
  assert.notEqual(second, first, 'at 60 s: re-read'); assert.equal(second.at, NOW); assert.ok(second.payload, 'the re-read answered');
});

test('Data 5 (review) — the Surface menu works through the page\'s click handler: Hard filters, × and Reset filters clear it', async () => {
  const x = boot({ menu: 'surf' }); await x.start();
  assert.equal(x.st.menu, 'surf');
  const h = await x.click('surf', 'Hard');
  assert.equal(x.st.S.surf, 'Hard'); assert.equal(x.st.menu, null, 'single-select: the menu closes');
  assert.match(h, /<span class="do-count">2 moves across 2 matches<\/span>/);
  assert.deepEqual([...h.matchAll(/data-act="row" data-v="([^"]+)"/g)].map((m) => m[1]), ['bet105-2161', 'superbet-3590'], 'only the rows a card puts on Hard');
  assert.match(h, /data-act="menu" data-v="surf"><span class="do-trig-k">Surface<\/span><span class="do-trig-v">Hard<\/span><span class="do-x" data-act="clear" data-v="surf">×<\/span>/);
  const c = await x.click('clear', 'surf');
  assert.equal(x.st.S.surf, 'all'); assert.match(c, /<span class="do-count">4 moves across 4 matches<\/span>/);
  await x.click('surf', 'Hard');
  const rs = await x.click('reset');
  assert.equal(x.st.S.surf, 'all'); assert.match(rs, /<span class="do-count">4 moves across 4 matches<\/span>/);
  // no dead handler, no stale ruling in the header comment
  assert.doesNotMatch(SRC, /case 'refresh'/); assert.doesNotMatch(SRC, /Alerts shown disabled/);
});

// ── TEN-427 round 2 (founder 20de43fe): real rows captured live 11 Oct 2026 01:26Z (FIX.r2) ──
const R2 = FIX.r2, NOW2 = Date.parse(R2.capturedAt);
const boot2 = (o = {}) => boot({ rows: R2.rows, lines: R2.lines, board: structuredClone(R2.board), status: R2.status, index: R2.index,
  profiles: R2.profiles, now: NOW2, charts: { 'upcoming-12169842': R2.chart }, ...o });
const ROWS2 = P.buildRows(R2.rows), row2 = (id) => ROWS2.find((r) => r.id === id);
const listed = (h) => [...h.matchAll(/data-act="row" data-v="([^"]+)"/g)].map((m) => m[1]).sort();

test('r2 ruling — upcoming matches only: a row leaves at its start, or earlier when the feed marks it live; no Matches control, no status badge', async () => {
  // fix 9: Hernandez Ramirez v McCormick — api-tennis "unknown", start 8 Oct 14:46Z long passed (cut there): never listed
  const hr = row2('superbet-3509');
  assert.equal(hr.status, 'unknown'); assert.ok(hr.cutAt); assert.equal(P.isUpcoming(hr, NOW2), false);
  // finished matches (McCormick v Bini, Covato v Andrade Da Silva) leave too
  for (const id of ['superbet-3619', 'superbet-3669']) assert.equal(P.isUpcoming(row2(id), NOW2), false, id);
  // an unknown-status row whose start is ahead is just an upcoming row; a live sighting before the start removes it
  const fut = { ...hr, cutAt: null, cutKind: null, start: new Date(NOW2 + 3600e3).toISOString() };
  assert.equal(P.isUpcoming(fut, NOW2), true);
  assert.equal(P.isUpcoming({ ...fut, liveAt: new Date(NOW2 - 60e3).toISOString() }, NOW2), false, 'marked live before its start');
  assert.equal(P.isUpcoming({ ...fut, status: 'in_play' }, NOW2), false);
  // the start that counts is the Today's Matches card's when matched (cardStart), and the row leaves AT it
  const cb = row2('superbet-3657');
  assert.equal(P.isUpcoming({ ...cb, cardStart: NOW2 + 1 }, NOW2), true);
  assert.equal(P.isUpcoming({ ...cb, cardStart: NOW2 }, NOW2), false, 'at its start: gone');
  assert.equal(P.isUpcoming({ ...cb, start: null }, NOW2), false, 'no start: cannot be shown as upcoming');
  // executed: the three upcoming rows with a shortened price, nothing else; no Matches control, no view counts, no badge
  const h = await boot2().start();
  assert.deepEqual(listed(h), ['superbet-3657', 'superbet-3700', 'superbet-3703']);
  assert.doesNotMatch(h, /data-act="vw"|MATCHES|Upcoming|In play|Completed|STATUS UNKNOWN|Status unknown|do-started|last pre-match|cut at scheduled start/);
  assert.doesNotMatch(SRC, /Upcoming · In play · Completed'|'STATUS UNKNOWN'|VIEWS = /);
});

test('r2 fix 8 — every name through the shared formatter (search index on the site\'s name canon), events from the canonical table', async () => {
  // the canon folds accents, case, hyphens: "Carreno Busta" = "Carreño-Busta", "Mccormick" = "McCormick"
  assert.deepEqual(P.canonToks('Pablo Carreño-Busta'), P.canonToks('Pablo Carreno Busta'));
  const ix = P.nameIndex(R2.index);
  assert.equal(P.indexHit('Pablo Carreno Busta', ix).key, '434', 'index spells "Pablo Carreno-Busta"');
  assert.equal(P.indexHit('Tristan Mccormick', ix).key, '20665', 'index spells "Tristan McCormick"');
  assert.equal(P.indexHit('Sergio Luis Hernandez Ramirez', ix).key, '9650', 'index scrambles it: "Luis Hernandez Ramirez Sergio"');
  assert.equal(P.indexHit('Lucas Andrade Da Silva', ix).key, '57484');
  assert.equal(P.indexHit('A B', P.nameIndex([{ key: 1, name: 'A B' }, { key: 2, name: 'B A' }])), null, 'a name two keys share is no key');
  // the board card joins through the canon (round 1 missed it: "carreno-busta" vs "busta")
  assert.equal(P.boardKeyFor(row2('superbet-3657'), R2.board).card.id, 'upcoming-12169842');
  // executed with the real index + profile names: profile name on the key, else the index spelling short, else the feed's short
  const x = boot2(); await x.start();
  const r = (id) => x.st.rows.find((q) => q.id === id);
  assert.deepEqual([r('superbet-3657').dSide, r('superbet-3657').dOpp, r('superbet-3657').event], ['P. Carreno-Busta', 'F. Auger-Aliassime', 'ATP Shanghai']);
  assert.deepEqual([r('superbet-3509').dA, r('superbet-3509').dB], ['S. Luis Hernandez Ramirez', 'T. McCormick']);
  assert.deepEqual([r('superbet-3619').dA, r('superbet-3619').dB], ['T. McCormick', 'V. Bini'], 'Bini is not in the index: the feed\'s spelling, short');
  assert.deepEqual([r('superbet-3669').dA, r('superbet-3669').dB], ['L. Andrade da Silva', 'M. Covato']);
  assert.match(x.root.innerHTML, /<span class="do-sel">P\. Carreno-Busta to win<\/span><span class="do-detail">Match winner · vs F\. Auger-Aliassime · ATP Shanghai · Superbet<\/span>/);
  // a Challenger row: no card on the (ATP-only) board and no tournament in the feed — no event segment, never a guess
  assert.match(x.root.innerHTML, /<span class="do-sel">G\. Marques to win<\/span><span class="do-detail">Match winner · vs D\. Ajdukovic · Superbet<\/span>/);
  const box = await x.open('superbet-3657');
  assert.match(box, /<span class="do-ov-pl"><span class="do-ov-nm backed"><span>P\. Carreno-Busta<\/span><\/span><span class="do-ov-v">v<\/span><span class="do-ov-nm"><span>F\. Auger-Aliassime<\/span><\/span><span class="do-ov-evr">· <span>ATP Shanghai<\/span>/);
});

test('r2 fix 10 — only the market the bots record: "All markets" and "Match winner", All = the sum', async () => {
  const h = await boot2().start();
  const tabs = [...h.matchAll(/<button class="do-tab[^"]*" data-act="mk" data-v="([^"]+)">([^<]+)<span class="do-tab-n">([^<]+)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(tabs, [['all', 'All markets', '3'], ['mw', 'Match winner', '3']]);
  assert.match(h, /<button class="do-tab on" data-act="mk" data-v="all">/, 'All markets selected by default');
  assert.doesNotMatch(SRC + h, /Set handicap|Game handicap|Total games|Total sets|No drops on this market/);
  const x = boot2(); await x.start(); const m = await x.click('mk', 'mw');
  assert.match(m, /<button class="do-tab on" data-act="mk" data-v="mw">/); assert.equal(listed(m).length, 3);
});

test('r2 fix 11 — the price axis never goes under 1.00 (McCormick 1.08 → 1.07)', async () => {
  const lo = (ch) => Math.min(...ch.gridY.map((g) => parseFloat(g.label)));
  const series = [{ t: NOW2 - 3 * 3600e3, v: 1.08 }, { t: NOW2 - 3600e3, v: 1.07 }];
  const ch = P.boxChart(series, 1.08, { label: 'Now', t: NOW2, v: 1.07, axisT: NOW2, confirmed: true }, []);
  assert.equal(ch.gridY[ch.gridY.length - 1].label, '1.00', 'padded low 0.95 floored to 1.00');
  assert.ok(lo(ch) >= 1);
  const far = P.boxChart([{ t: NOW2 - 3 * 3600e3, v: 5.1 }, { t: NOW2 - 3600e3, v: 3.6 }], 5.1, { label: 'Now', t: NOW2, v: 3.6, axisT: NOW2, confirmed: true }, []);
  assert.equal(far.gridY[far.gridY.length - 1].label, '3.42', 'away from 1.00 the padded low stands');
  // executed on the real McCormick row (its endpoint line)
  const b = await boot2().open('superbet-3619');
  const labels = [...b.matchAll(/<div class="do-ov-yax">([\s\S]*?)<\/div>/g)][0][1].match(/\d+\.\d\d/g).map(Number);
  assert.ok(labels.every((v) => v >= 1), labels.join());
});

test('r2 fix 12 — one word, "Open", with the dotted tooltip: list head, chart chip, box table; never "First seen"', async () => {
  const tip = 'First price Stennisfy recorded, not necessarily the bookmaker’s opening line.';
  const b = await boot2().open('superbet-3657');
  assert.equal(row2('superbet-3657').openKind, 'vendor first record', 'not the book\'s opener — round 1 printed "First seen" here');
  assert.match(b, new RegExp('class="do-ov-openchip"[^>]*><span class="do-ov-help">Open</span><span class="do-ov-tip">' + tip + '</span> <span>5\\.10</span>'));
  assert.match(b, new RegExp('<span class="r do-ov-hr"><span class="do-ov-help">Open</span><span class="do-ov-tip">' + tip + '</span> → Now</span>'));
  const h = await boot2().start();
  assert.match(h, new RegExp('<span class="do-help">Open</span><span class="do-tip">' + tip + '</span> → NOW'));
  assert.doesNotMatch(SRC + b + h, /First seen|FIRST SEEN/);
  assert.match(CSS, /\.do-ov-help \{ border-bottom: 1px dotted var\(--text-label\); cursor: help; \}/);
  assert.match(CSS, /\.do-ov-help:hover \+ \.do-ov-tip \{ display: block; \}/);
});

test('r2 fix 13 — the book reads "Pinnacle" (the Odds tab\'s AODDS_BOOKS); two Pinnacle sources are one line, Oddspapi first', async () => {
  // the real shard: Pinnacle +30s (Oddspapi relays Pinnacle 30 s late) → the house name, the source in the tooltip only
  const b = await boot2().open('superbet-3657');
  assert.match(b, /data-v="Pinnacle" title="Pinnacle · Pinnacle \+30s \(Oddspapi\)">[\s\S]*?<span class="n"><span>Pinnacle<\/span><\/span><span class="s"><span><\/span><\/span>/);
  assert.doesNotMatch(b.replace(/title="[^"]*"/g, ''), /\+30s|api-tennis|recorded by us/);
  assert.equal((b.match(/data-act="book" data-v="Pinnacle"/g) || []).length, 1);
  // both sources on one card (the api-tennis copy is the same real series, one tick moved): ONE Pinnacle line, from the
  // first source in its AODDS_BOOKS list (Oddspapi), never spliced; api-tennis alone → still "Pinnacle"
  const real = R2.chart.books['Pinnacle +30s'];
  const api = { p1: real.p1.map(([t, v], i) => [t, i === 0 ? v + 0.05 : v]), p2: real.p2.map(([t, v], i) => [t, i === 0 ? v + 0.05 : v]) };
  const r = row2('superbet-3657'), side = P.boardKeyFor(r, R2.board).cardSide;
  for (const books of [{ 'Pinnacle (api-tennis)': api, 'Pinnacle +30s': real }, { 'Pinnacle +30s': real, 'Pinnacle (api-tennis)': api }]) {
    const pin = P.modalBooks(r, { rows: ROWS2, chart: { books, meta: {} }, cardSide: side, now: NOW2 }).books.filter((x) => x.book === 'Pinnacle');
    assert.equal(pin.length, 1); assert.equal(pin[0].src, 'Pinnacle +30s (Oddspapi)', 'whatever the shard\'s key order');
    assert.equal(pin[0].series[0].v, real[side][0][1], 'the Oddspapi series, not the api-tennis one');
  }
  const only = P.modalBooks(r, { rows: ROWS2, chart: { books: { 'Pinnacle (api-tennis)': api }, meta: {} }, cardSide: side, now: NOW2 }).books.filter((x) => x.book === 'Pinnacle');
  assert.equal(only.length, 1); assert.equal(only[0].src, 'Pinnacle (api-tennis)');
});

test('r2 fix 16 — search matches players and events; the placeholder names tournaments only when every upcoming row carries one', async () => {
  const x = boot2(); const h = await x.start();
  assert.match(h, /placeholder="Search players" value="" aria-label="Search players"/, 'two Challenger rows carry no event');
  const all = await boot2({ rows: R2.rows.filter((q) => q.id === 'superbet-3657') }).start();
  assert.match(all, /placeholder="Search players or tournaments"/);
  x.st.S.q = 'shanghai'; x.D.setActive(true); await x.flush();
  assert.deepEqual(listed(x.root.innerHTML), ['superbet-3657'], 'an event matches');
  x.st.S.q = 'carreño'; x.D.setActive(true); await x.flush();
  assert.deepEqual(listed(x.root.innerHTML), ['superbet-3657'], 'accents folded: "Carreño" finds the shown "Carreno-Busta"');
  x.st.S.q = 'ajdukovic'; x.D.setActive(true); await x.flush();
  assert.deepEqual(listed(x.root.innerHTML), ['superbet-3703']);
});

// ── TEN-427 round 3 (founder 393874e7, items 4–10) ──
const R3 = FIX.r3;
const tbl = (b) => b.slice(b.indexOf('<div class="do-ov-tbl">'), b.indexOf('<div class="do-ov-foot">'));
const trOf = (b, book) => { const t = tbl(b), i = t.indexOf('data-v="' + book + '"'); assert.ok(i >= 0, book); return t.slice(i, t.indexOf('</div>', i)); };

test('r3 item 4 — the header is the sentence alone (no "Live · updated" tail); a dead feed shows the banner and dims the rows', async () => {
  const h = await boot().start();
  assert.doesNotMatch(h, /sfh__tail|Live · updated|updated just now|Prices updated|Loading prices|do-status/);
  const late = await boot({ status: { ...FIX.status, generatedAt: '2026-10-10T13:59:00.000Z', ageS: 2255 } }).start();
  assert.doesNotMatch(late, /sfh__tail|Prices updated|min ago/, 'the stale wording moved nowhere');
  assert.match(late, /FEED DISCONNECTED/); assert.match(late, /Showing prices as of <span class="do-mono">15:59<\/span>/);
  assert.match(late, /class="do-list stale"/); assert.match(late, /data-k="updated">15:59</, 'Updated keeps the last read\'s time');
  assert.doesNotMatch(CSS, /do-status/);
});

test('r3 item 5 — the open price struck through as the reference (`~~4.85~~ → 3.40`): rows, box header, box table', async () => {
  const strike = 'text-decoration: line-through; text-decoration-color: color-mix\\(in srgb, var\\(--neg\\) 60%, transparent\\);';
  assert.match(CSS, new RegExp('\\[data-page="drops"\\] \\.do-px-o \\{[^}]*' + strike));
  assert.match(CSS, new RegExp('\\.do-ov-open \\{[^}]*' + strike));
  assert.match(CSS, new RegExp('\\.do-ov-to \\{[^}]*' + strike));
  assert.doesNotMatch(CSS, /\.do-px-n \{[^}]*line-through|\.do-ov-now \{[^}]*line-through|\.do-ov-tn \{[^}]*line-through/, 'never the now');
  const h = await boot2().start();
  assert.match(h, /<span class="do-px-o">5\.10<\/span><span class="do-px-a">→<\/span><span class="do-px-n">3\.60<\/span>/);
});

test('r3 items 6, 7 — the box table = the reference (Book · Open → Now · Drop under SHARP / SOFT labels); a lengthening is the move view\'s "+x.x%" in --pos, a shortening red ▼', async () => {
  const b = await boot2().open('superbet-3657');
  const t = tbl(b);
  assert.match(t, /^<div class="do-ov-tbl"><div class="do-ov-th"><span>Book<\/span><span class="r do-ov-hr"><span class="do-ov-help">Open<\/span><span class="do-ov-tip">[^<]+<\/span> → Now<\/span><span class="r">Drop<\/span><\/div>/);
  assert.deepEqual([...t.matchAll(/<span class="do-ov-grk">(\w+)<\/span>/g)].map((m) => m[1]), ['Sharp', 'Soft']);
  const sharpPart = t.slice(t.indexOf('>Sharp<'), t.indexOf('>Soft<')), softPart = t.slice(t.indexOf('>Soft<'));
  assert.deepEqual([...sharpPart.matchAll(/data-act="book" data-v="([^"]+)"/g)].map((m) => m[1]), ['Pinnacle', 'Betfair Exchange', 'Bet105']);
  assert.deepEqual([...softPart.matchAll(/data-act="book" data-v="([^"]+)"/g)].map((m) => m[1]), ['Superbet']);
  assert.doesNotMatch(t, /TYPE|do-ov-tt|>SHARP<|>SOFT<|from /, 'no TYPE chip column, no "from" column');
  // every cell = the shown open → now and the shell move formula on them (mxMovePct): drift "+x.x%" --pos, shortening "▼ x.x%"
  const mx = vm.runInContext('mxMovePct', PCTX);
  let pos = 0;
  for (const bk of ['Pinnacle', 'Betfair Exchange', 'Bet105', 'Superbet']) {
    const tr = trOf(b, bk);
    const [, o, n] = tr.match(/<span class="do-ov-to">([\d.]+)<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">([\d.]+)<\/span>/);
    const [, c, txt] = tr.match(/<span class="do-ov-td (\w+)"><span>([^<]+)<\/span>/);
    const m = mx(+o, +n);
    if (m.v > 0) { pos++; assert.equal(c, 'pos', bk); assert.equal(txt, m.text, `${bk} ${o} → ${n}: the move view's text`); assert.match(txt, /^\+\d+\.\d%$/); }
    else if (m.v < 0) { assert.ok(c === 'big' || c === 'small', bk); assert.equal(txt, '▼ ' + Math.abs(m.v).toFixed(1) + '%', bk); }
    else assert.equal(txt, m.text, 'flat = the move view\'s "±0.0%"');
  }
  assert.ok(pos >= 1, 'the real Carreno-Busta box holds a lengthening book');
  assert.match(trOf(b, 'Superbet'), /<span class="do-ov-to">5\.10<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">3\.60<\/span><\/span><span class="r"><span class="do-ov-td big"><span>▼ 29\.4%<\/span>/);
  assert.deepEqual({ ...P.dropCell(-3.8) }, { txt: '+3.8%', c: 'pos' }, 'Today\'s Matches tile: drift = +3.8% green');
  assert.deepEqual({ ...P.dropCell(3.8) }, { txt: '▼ 3.8%', c: 'small' });
  assert.doesNotMatch(b, /▲/, 'never a ▲ under the DROP head');
  const rule = (sel) => { const i = CSS.indexOf(sel + ' {'); assert.ok(i >= 0, sel); return CSS.slice(i, CSS.indexOf('}', i) + 1); };
  assert.match(rule('.do-ov-th, .do-ov-tr'), /grid-template-columns: minmax\(0,1fr\) 120px 84px; gap: 12px;/);
  assert.match(rule('.do-ov-grk'), /font-size: 10\.5px; font-weight: 800; letter-spacing: 0\.10em; text-transform: uppercase; color: var\(--text-label\);/);
  assert.match(rule('.do-ov-grl'), /flex: 1; height: 1px; background: var\(--edge-6\);/);
  assert.match(rule('.do-ov-td.pos'), /color: var\(--pos\);/);
});

test('r3 items 8, 9 — the end label reads "Now"; every book\'s last price runs on flat and dashed to the axis end (one axis), nothing interpolated', async () => {
  const H = 3600e3, s = [{ t: NOW2 - 10 * H, v: 2.2 }, { t: NOW2 - 6 * H, v: 2.0 }];
  const e = P.endOf(s, null, null, NOW2);
  assert.deepEqual({ ...e }, { label: 'Now', t: NOW2 - 6 * H, v: 2.0, axisT: NOW2, confirmed: false }, 'Now, the same snapshot; the axis runs to now');
  const ch = P.boxChart(s, 2.2, e);
  const pts = ch.lines[0].split(' ').map((p) => p.split(',').map(Number));
  assert.equal(pts[pts.length - 1][0], 400, 'the solid line stops at the last snapshot');
  assert.deepEqual({ ...ch.ext }, { x1: '400.0', x2: '1000.0', y: pts[pts.length - 1][1].toFixed(1) }, 'flat at the last price, from the last snapshot to the axis end');
  assert.equal(ch.endWord, 'Now'); assert.equal(ch.endLeft, '100.00%', 'the end dot sits on the Now plate, at the axis end');
  // a later confirmed sighting is a confirmed hold (solid) — the carry starts there
  const seen = P.boxChart(s, 2.2, P.endOf(s, NOW2 - 2 * H, null, NOW2));
  assert.equal(seen.ext.x1, '800.0');
  // a cut row's axis ends where its line does: no carry
  assert.equal(P.boxChart(s, 2.2, P.endOf(s, null, new Date(NOW2 - 3 * H).toISOString(), NOW2)).ext, null);
  // executed: the Carreno-Busta box, every book: the dashed carry, "Now", and the same axis end (now, 03:26 Brussels)
  const x = boot2(); await x.start();
  const ends = [];
  for (const bk of ['Superbet', 'Pinnacle', 'Betfair Exchange', 'Bet105']) {
    const b = await x.open('superbet-3657', bk === 'Superbet' ? null : bk);
    assert.match(b, /<line class="do-ext" x1="[\d.]+" y1="([\d.]+)" x2="1000\.0" y2="\1" vector-effect="non-scaling-stroke"><\/line>/, bk);
    assert.match(b, /<div class="do-ov-endw">Now<\/div>/, bk);
    assert.doesNotMatch(b, /Latest/);
    const ticks = [...[...b.matchAll(/<div class="do-ov-xax">([\s\S]*?)<\/div>/g)][0][1].matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
    ends.push(ticks[ticks.length - 1]);
  }
  assert.deepEqual(ends, ['03:26', '03:26', '03:26', '03:26'], 'one axis end for every book');
  assert.match(CSS, /\.do-ov-plot \.do-ext \{ stroke: var\(--neg\); stroke-width: 2\.6; stroke-dasharray: 5 6;/);
});

// ── review of 52050426c (round-3 review fixes) ──
test('r3 review 1 — a cut row whose book stopped quoting before the start: no dashed carry, the axis ends where the line does', () => {
  const H = 3600e3, T0 = NOW2 - 10 * H;
  const s = [{ t: T0, v: 3.80 }, { t: T0 + 1 * H, v: 3.40 }];
  const cut = new Date(T0 + 6 * H).toISOString();
  const e = P.endOf(s, T0 + 3 * H, cut, NOW2);
  assert.deepEqual({ ...e }, { label: 'Last pre-match', t: T0 + 3 * H, v: 3.40, axisT: T0 + 3 * H, confirmed: true }, 'last seen +3h, cut +6h: the line and the axis end at the last sighting');
  const ch = P.boxChart(s, 3.80, e);
  assert.equal(ch.ext, null, 'no dashed carry from the last sighting to the live start');
  assert.equal(ch.endWord, 'Last pre-match');
  assert.equal(ch.endLeft, '100.00%', 'the end dot at the line\'s end, which is the axis end');
  assert.equal(ch.ticks[ch.ticks.length - 1].label, P.clock(T0 + 3 * H), 'the axis ends at the last sighting, not the start');
  // a "Last pre-match" end never carries, whatever axis it is handed
  assert.equal(P.boxChart(s, 3.80, { label: 'Last pre-match', t: T0 + 3 * H, v: 3.40, axisT: T0 + 6 * H, confirmed: true }).ext, null);
});

test('r3 review 2 — the dashed carry stops where a recorded not-quoting stretch (a hole) begins', () => {
  const H = 3600e3, s = [{ t: NOW2 - 10 * H, v: 2.2 }, { t: NOW2 - 6 * H, v: 2.0 }];
  const e = P.endOf(s, null, null, NOW2);
  const gap = P.boxChart(s, 2.2, e, [[NOW2 - 4 * H, NOW2 - 3 * H]]);
  assert.deepEqual({ ...gap.ext }, { x1: '400.0', x2: '600.0', y: gap.ext.y }, 'the carry stops at the gap start');
  assert.equal(gap.endLeft, '60.00%', 'the end dot where the drawn price ends');
  assert.equal(P.boxChart(s, 2.2, e, [[NOW2 - 2 * H, null]]).ext.x2, '800.0', 'an open gap too');
  assert.equal(P.boxChart(s, 2.2, e, [[NOW2 - 8 * H, NOW2 - 7 * H]]).ext.x2, '1000.0', 'a gap before the last snapshot leaves the carry alone');
  assert.equal(P.boxChart(s, 2.2, e, [[NOW2 - 7 * H, NOW2 - 5 * H]]).ext, null, 'a gap over the last snapshot: no carry at all');
});

test('r3 review 3 — flat reads the move view\'s "±0.0%"; a book with one recorded price reads the reference\'s "—" → now · "one price"', async () => {
  const mx = vm.runInContext('mxMovePct', PCTX);
  assert.deepEqual({ ...P.dropCell(0) }, { txt: mx(2.4, 2.4).text, c: 'muted' });
  assert.equal(P.dropCell(0).txt, '±0.0%');
  assert.deepEqual({ ...P.dropCell(0, true) }, { txt: 'one price', c: 'muted' });
  // executed: the Carreno-Busta box with one more shard book holding ONE recorded price
  const chart = structuredClone(R2.chart);
  chart.books.Betano = { p1: [['2026-10-10T20:00:00.000Z', 3.9]], p2: [['2026-10-10T20:00:00.000Z', 1.25]] };
  const b = await boot2({ charts: { 'upcoming-12169842': chart } }).open('superbet-3657');
  assert.match(trOf(b, 'Betano'), /<span class="r do-ov-tp"><span class="do-ov-tnil">—<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">3\.90<\/span><\/span><span class="r"><span class="do-ov-td muted"><span>one price<\/span>/);
  assert.doesNotMatch(trOf(b, 'Betano'), /do-ov-to|0\.0%/, 'no struck open, no zero move');
  assert.match(trOf(b, 'Superbet'), /<span class="do-ov-to">5\.10<\/span>[^]*▼ 29\.4%/, 'a book with a move is unchanged');
});

// ── ship changes (founder 33107f2a, 11 Oct 2026); FIX.r4 = a live row + line captured 11 Oct 08:22Z ──
const R4 = FIX.r4, NOW4 = Date.parse(R4.capturedAt);
const boot4 = (o = {}) => boot({ rows: R4.rows, lines: R4.lines, board: [], status: R4.status, now: NOW4, ...o });
test('ship 1 — one recorded price that a later sighting confirmed: the flat line and the Now plate, NO Open chip; the chart says what the table does ("— → 2.59 · one price")', async () => {
  const b = await boot4().open('superbet-3672', 'Bet105');
  // the real Donski box: Bet105 recorded 2.59 once (00:36:18Z) and saw it again at 06:05:01Z
  assert.match(b, /class="do-ov-tr sel" role="button" tabindex="0" data-act="book" data-v="Bet105"/);
  assert.match(trOf(b, 'Bet105'), /<span class="do-ov-tnil">—<\/span><span class="do-ov-ta">→<\/span><span class="do-ov-tn">2\.59<\/span><\/span><span class="r"><span class="do-ov-td muted"><span>one price<\/span>/);
  const lines = [...b.matchAll(/<polyline class="do-line" points="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(lines.length, 1, 'the held price is a line');
  assert.equal(new Set(lines[0].split(' ').map((p) => p.split(',')[1])).size, 1, 'flat');
  assert.match(b, /<div class="do-ov-endw">Now<\/div><div class="do-ov-endv"><span>2\.59<\/span><\/div>/, 'the Now plate');
  assert.doesNotMatch(b, /One price recorded so far/);
  assert.doesNotMatch(b, /do-ov-openchip/, 'no Open chip: there is no open to name, as the table\'s "—"');
  // a book with a move in the same box keeps its chip (the open the table strikes)
  const s = await boot4().open('superbet-3672', 'Betfair Exchange');
  assert.match(s, /class="do-ov-openchip"[^>]*><span class="do-ov-help">Open<\/span><span class="do-ov-tip">[^<]+<\/span> <span>2\.24<\/span>/);
  assert.match(trOf(s, 'Betfair Exchange'), /<span class="do-ov-to">2\.24<\/span>/);
  // the model: one price held → a line, no chip; two prices → the chip
  const H = 3600e3, one = [{ t: NOW4 - 8 * H, v: 2.59 }];
  const held = P.boxChart(one, 2.59, P.endOf(one, NOW4 - 2 * H, null, NOW4));
  assert.deepEqual([held.single, held.hasOpen, held.lines.length, held.endWord], [false, false, 1, 'Now']);
  const two = [...one, { t: NOW4 - 4 * H, v: 2.40 }];
  assert.equal(P.boxChart(two, 2.59, P.endOf(two, null, null, NOW4)).hasOpen, true);
});

test('ship 2 — the round is the card\'s own api-tennis round only (roundBadgeText(card.tournamentRound), as Today\'s Matches and the MA header): a round-less card shows NO round', async () => {
  assert.doesNotMatch(SRC, /cardRound|nextRound|lastWon/, 'no Drops-only round inference');
  const card = FIX.r3.board.find((m) => m.id === 'upcoming-12169842');
  assert.equal(card.tournamentRound, null, 'api-tennis had not filled it at 02:02Z 11 Oct');
  // the real round-less card, with both players' won 10 Oct 1/32-finals on the board: still no round, never inferred
  const b = await boot2({ board: structuredClone([...R2.board, ...FIX.r3.board.filter((m) => m.id.startsWith('past-'))]) }).open('superbet-3657');
  assert.match(b, /<span class="do-ov-evr">· <span>ATP Shanghai<\/span><\/span>/);
  assert.doesNotMatch(b, /do-ov-evr">[^]*?R(32|64)/);
  // once the feed fills it (by the 02:31Z capture: 1/16-finals) the box shows it, the cards' badge text
  const filled = structuredClone(R2.board).map((m) => (m.id === 'upcoming-12169842' ? { ...m, tournamentRound: 'ATP Shanghai - 1/16-finals' } : m));
  const f = await boot2({ board: filled }).open('superbet-3657');
  assert.match(f, /<span class="do-ov-evr">· <span>ATP Shanghai<\/span> · <span>R32<\/span><\/span>/);
  assert.equal(vm.runInContext('roundBadgeText', PCTX)('ATP Shanghai - 1/16-finals'), 'R32');
});
