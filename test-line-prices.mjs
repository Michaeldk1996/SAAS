// bet105-line-prices — the browser side: line-prices.js (the ONE lookup), the dashboard's Hot lines cell (fhLinePx, used by
// the H2H tab, the Key factors H2H card and the Head-to-head page) and Derived lines' cell (player-profile-v2.js lcLinePx),
// on the same Supabase rows. Each check names the mutation that turns it red (applied to copies in the M* checks at the end).
//   1  exact line only: a line bet105 does not offer is a dash with the ladder on hover, never another line's price
//   2  age on screen (founder 2026-10-25): every priced face carries its age; past STALE_MIN (3 min, the Now's 180 s rule) it dashes, the last
//      price moves to the hover (mutants: no staleness; threshold back at 30)                    3  started dashes        4  suspended dashes
//   5  SAME line, SAME match, SAME price: the H2H tab, the Key factors card and Match analysis Derived lines read one value
//   6  right side: "Bublik −2.5" is Bublik's price even on the H2H page where Bublik is the row's player A
//   7  wiring: prices only in the match card (founder 2026-10-26) — never the player profile or the Head-to-head page
//   9  started / completed: the line's close, labelled as the close; no close captured = a dash
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(process.env.LPT_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const LPSRC = process.env.LPT_JS || join(HERE, 'line-prices.js');

const NOW = Date.parse('2026-10-24T12:01:30Z');   // the worker's beat (12:00:00Z) is 90 s old
// line_prices_current rows as PostgREST returns them (numerics may arrive as strings), and the worker's heartbeat.
const R = (market, side, line, price, implied, status, open_price = null, open_ts = null, max_limit = 3900) =>
  ({ market, side, line, price, implied, status, open_price, open_ts, max_limit, inserted_on: '2026-10-24T11:05:06Z' });
const ROWS = { '12173801': [
  R('gh', '1093', -3.5, 2.48, 0.388, 'ok'), R('gh', '1093', '-3', '2.29', '0.4205', 'ok', 2.2, '2026-10-23T09:00:00Z'),
  R('gh', '1093', -2.5, 2.01, 0.4809, 'ok'), R('gh', '1895', 2.5, 1.862, 0.5191, 'ok'), R('gh', '1895', 3, 1.662, 0.5795, 'ok'),
  R('gh', '1895', -2.5, null, null, 'suspended'), R('gh', '1093', 2.5, null, null, 'suspended'),
  R('gh', '1093', -4.5, 3.1, 0.3, 'withdrawn'),
  R('tg', 'over', 22.5, 1.66, 0.5809, 'ok', null, null, 2000), R('tg', 'under', 22.5, 2.3, 0.4191, 'ok', null, null, 2000)],
  '555': [R('gh', '7', -1.5, 1.9, 0.5, 'started'), R('gh', '8', 1.5, 1.9, 0.5, 'started')] };
const HB = (over = {}) => ({ written_at: '2026-10-24T12:00:00Z', note: Object.assign({ connected: true, write_ok: true,
  lines: Object.assign({ write: true, write_ok: true }, over.lines || {}) }, over.note || {}) });
function fresh(rows = ROWS, hb = HB(), now = NOW, opts = {}) {
  delete require.cache[require.resolve(LPSRC)];
  const calls = [];
  const g = { fetch: async (u, init) => {
    calls.push({ u, init });
    if (opts.down) return { ok: false, status: 503 };
    let m = /\/rest\/v1\/line_prices_current\?.*event_key=eq\.(\d+)/.exec(u);
    if (m) return { ok: true, json: async () => rows[m[1]] || [] };
    if (/\/rest\/v1\/kibl_now_price\?.*kind=eq\.heartbeat/.test(u)) return { ok: true, json: async () => hb ? [hb] : [] };
    return { ok: false, status: 404 };
  } };
  const prevNow = Date.now; Date.now = () => now;
  globalThis.window = Object.assign(globalThis.window || {}, { fetch: g.fetch, SUPABASE_URL: 'https://proj.supabase.co/', SUPABASE_ANON_KEY: 'pk_test' });
  globalThis.fetch = g.fetch;
  const L = require(LPSRC);
  globalThis.window.LinePrices = L;
  return { L, calls, restore: () => { Date.now = prevNow; } };
}

test('1-4: the lookup — exact line only; stale, started and suspended dash; loading is not a dash', async () => {
  const { L, restore } = fresh();
  try {
    assert.equal(L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' }).state, 'loading', 'before the event loads: loading, never a dash or a price');
    await L.load('2026-10-24', 12173801);
    const r = L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' });
    assert.equal(r.state, 'ok'); assert.equal(r.price, 2.29); assert.equal(L.faceText(r), '2.29 · 42% · 1m', '2: the age is on the face');
    assert.match(L.hoverLines(r, 'Medvedev −3 games').join('\n'), /Updated 1 min ago \(bet105 stream live at 12:00Z\)/);
    assert.equal(r.open, 2.2); assert.equal(r.maxLimit, 3900);
    const miss = L.linePrice(12173801, '1093', 'gh', -4.5, { date: '2026-10-24' });
    assert.equal(miss.state, 'dash', '1: −4.5 is not offered (mutant: nearest-line fallback)'); assert.equal(miss.reason, 'not_offered');
    assert.equal(L.faceText(miss), '—', '1: the face never carries another line\'s price');
    assert.deepEqual(miss.ladder.filter(x => x.status === 'ok').map(x => x.line), [-3.5, -3, -2.5], '1: the offered ladder goes on the hover');
    assert.match(L.hoverLines(miss, 'Medvedev −4.5 games').join('\n'), /Offered: −3\.5 2\.48 · −3 2\.29 · −2\.5 2\.01/);
    assert.equal(L.linePrice(12173801, '1093', 'gh', -4.5, { date: '2026-10-24' }).reason, 'not_offered', 'a withdrawn line is not offered, never its old price (mutant: withdrawn kept)');
    assert.equal(L.linePrice(12173801, '1895', 'gh', -2.5, { date: '2026-10-24' }).reason, 'suspended', '4: suspended -> dash (mutant: no status check)');
    assert.equal(L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24', started: true }).reason, 'no_close', '3: started, no close captured: a dash, never the live price (mutant: ignore started)');
    await L.load('2026-10-24', 99);
    assert.equal(L.linePrice(99, '1093', 'gh', -3, { date: '2026-10-24' }).reason, 'no_event');
    assert.equal(L.linePrice(null, '1093', 'gh', -3, { date: null }).reason, 'no_match');
    assert.equal(L.linePrice(12173801, '1093', null, null, { date: '2026-10-24' }).reason, 'no_market', 'Tiebreak in match has no bet105 market');
    assert.equal(L.linePrice(12173801, 'over', 'tg', 22.5, { date: '2026-10-24' }).price, 1.66);
    assert.equal(L.STALE_MIN, 3, '2: the founder\'s 3-minute threshold (the Now\'s 180 s live rule), one named constant');
    const B = Date.parse('2026-10-24T12:00:00Z');
    Date.now = () => B + 180000;           // the worker's beat is exactly 180 s old: still priced
    await L.load('2026-10-24', 12173801);
    assert.equal(L.faceText(L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' })), '2.29 · 42% · 3m', '2: 180 s is not stale (mutant: threshold back at 60 min is caught below)');
    Date.now = () => B + 181000;           // 181 s
    await L.load('2026-10-24', 12173801);
    let st = L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' });
    assert.equal(st.reason, 'stale', '2: > 180 s since the worker last confirmed the stream (mutant: no staleness / STALE_MIN 60)');
    assert.equal(L.faceText(st), '— stale 3m', '2: the stale face says how old, never the price');
    assert.match(L.hoverLines(st, 'Medvedev −3 games').join('\n'), /over 3 min: not shown as current[\s\S]*Last price 2\.29 · 42%[\s\S]*Updated 3 min ago/, '2: the last price is on the hover only');
    Date.now = () => B + 230000;           // 230 s: the label still reads 3m, the rule is in seconds
    await L.load('2026-10-24', 12173801);
    assert.equal(L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' }).reason, 'stale', '2: judged in ms, not the rounded label (mutant: ageMin <= STALE_MIN)');
  } finally { restore(); }
});

test('2b, 8: the stream path — freshness is the worker heartbeat; started rows; a failed read; the browser only READS', async () => {
  let t = fresh(ROWS, HB({ lines: { write: false } }));
  try {
    await t.L.load('2026-10-24', 12173801);
    const r = t.L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' });
    assert.equal(r.reason, 'stale', '2b: a worker in dry run (line writes off) never makes a price current (mutant: heartbeat ignored)');
    assert.equal(r.lastPrice, 2.29); assert.equal(t.L.faceText(r), '—');
    assert.match(t.L.hoverLines(r, 'x').join('\n'), /bet105 stream not confirmed live \(last heartbeat 12:00Z\)/);
  } finally { t.restore(); }
  for (const [why, hb] of [['broker disconnected', HB({ note: { connected: false } })], ['line writes failing', HB({ lines: { write_ok: false } })],
                           ['lines off', HB({ lines: { off: 'API_TENNIS_KEY not set' } })], ['no heartbeat row', null]]) {
    t = fresh(ROWS, hb);
    try {
      await t.L.load('2026-10-24', 12173801);
      assert.equal(t.L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' }).reason, 'stale', `2b: ${why} -> stale`);
    } finally { t.restore(); }
  }
  t = fresh();
  try {
    await t.L.load('2026-10-24', 555);
    assert.equal(t.L.linePrice(555, '7', 'gh', -1.5, { date: '2026-10-24' }).reason, 'no_close', '3: a row the worker closed as started (no close) dashes even if the page has not seen the match go live');
    await t.L.load('2026-10-24', 12173801);
    for (const c of t.calls) {
      assert.ok(!c.init || !c.init.method || c.init.method === 'GET', '8: GET only — the browser writes nothing');
      assert.equal(c.init.headers.apikey, 'pk_test', '8: the publishable key, the existing RLS pattern');
      assert.doesNotMatch(c.u, /line_price_ticks/, '8: the ticks are never read from the browser');
      assert.ok(c.u.startsWith('https://proj.supabase.co/rest/v1/'), '8: Supabase REST, no trailing-slash double');
    }
    assert.ok(t.calls.some(c => /line_prices_current\?select=[^&]+&book=eq\.bet105&event_key=eq\.12173801$/.test(c.u)), '8: one event per read');
  } finally { t.restore(); }
  t = fresh(ROWS, HB(), NOW, { down: true });
  try {
    await t.L.load('2026-10-24', 12173801);
    const r = t.L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' });
    assert.equal(r.reason, 'unavailable', '8: a failed read is a dash, never a price');
  } finally { t.restore(); }
  globalThis.window.SUPABASE_URL = '__SUPABASE_URL__';
  delete require.cache[require.resolve(LPSRC)];
  const L2 = require(LPSRC);
  await L2.load('2026-10-24', 12173801);
  assert.equal(L2.linePrice(12173801, '1093', 'gh', -3, {}).reason, 'unavailable', '8: no Supabase config (a local page) -> unavailable');
});

// ---- the dashboard's cell and Derived lines' cell, on the same rows ----
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
const constSrc = (name) => { const s = html.indexOf(`\nconst ${name} = `); return html.slice(s, html.indexOf('\n', s + 1)); };
function dash() {
  return new Function('LinePrices', `
    ${['escapeHtml', 'fhEsc', 'maTipHtml', 'fhLinePx', 'fhLinePxCell', 'fhLinePxCtx', 'eventKeyOfMatch', 'fhH2hLineDefs'].map(slice).join('\n')}
    ${constSrc('FH_MONO')}
    const FH_H2H_SET1_MIRROR = true, FH_DASHC = '—';
    return { fhLinePx, fhLinePxCell, fhLinePxCtx, fhH2hLineDefs };`)(globalThis.window.LinePrices);
}
const face = h => { const m = /data-lp-face="([^"]*)"/.exec(h); return m ? m[1].replace(/&amp;/g, '&') : undefined; };

test('5-6: same line, same match, same price — the three match-card views; the right side everywhere', async () => {
  const { L, restore } = fresh();
  try {
    await L.load('2026-10-24', 12173801);
    const D = dash(), core = require(join(HERE, 'market-edge-core.js'));
    const m = { id: 'upcoming-12173801', date: '2026-10-24', p1: 'D. Medvedev', p2: 'A. Bublik', p1Key: 1093, p2Key: 1895 };
    const defs = D.fhH2hLineDefs('Medvedev', 'Bublik');
    const A25 = defs.find(d => d.name === 'Medvedev −2.5 games'), O225 = defs.find(d => d.name === 'Over 22.5 games');
    // H2H tab and Key factors H2H card: the modal's match
    const ctx = D.fhLinePxCtx(m, null);
    const tab = face(D.fhLinePx(A25, ctx)), kf = face(D.fhLinePx(A25, D.fhLinePxCtx(m, null)));
    assert.equal(tab, '2.01 · 48% · 1m');
    // the Price column (Hot lines and Derived lines read the same cell): the price at the face, "48% · 1m ago" beneath
    const cell = D.fhLinePxCell(A25, ctx);
    assert.equal(face(cell), tab, '5: the column reads the same lookup');
    assert.match(cell.replace(/<[^>]*>/g, '|'), /\|2\.01\|+48% · 1m ago\|/, 'face 2.01, beneath "48% · 1m ago"');
    assert.match(D.fhLinePxCell(defs.find(d => d.name === 'Tiebreak in match'), ctx), /data-lp-state="dash"[\s\S]*>—</, 'no price: a dash in the column');
    assert.equal(kf, tab, '5: one value on the H2H tab and the Key factors card (mutant: a view reading its own source)');
    // Market edge → Derived lines inside Match analysis (founder 2026-10-26): each line is a bet105 market, from THIS
    // column's player (meLinesCol: who 'self' -> A for p1's column, B for p2's)
    const asCol = (r, i) => ({ name: r[0], px: r[2] && r[2].who === 'self' ? Object.assign({}, r[2], { who: i ? 'B' : 'A' }) : r[2] });
    const fav = core.lineDefs(true, 'Medvedev'), dog = core.lineDefs(false, 'Bublik');
    assert.deepEqual(fav.map(r => r[2] && [r[2].mk, r[2].line]), [['ml', null], ['ml1', null], ['sh', -1.5], ['gh', -3.5], ['tg', 22.5], null],
      'fav lines -> markets: Wins match, Wins set 1, Wins 2–0 = −1.5 sets, −3.5 games, Over 22.5, Tiebreak (none) (mutant: a wrong market)');
    assert.deepEqual(dog.map(r => r[2] && [r[2].mk, r[2].line]), [['ml', null], ['ml1', null], ['sh', 1.5], ['gh', 3.5], ['tg', 22.5], null],
      'dog lines: Wins a set = +1.5 sets, +3.5 games');
    assert.equal(face(D.fhLinePx(asCol(fav[3], 0), ctx)), '2.48 · 39% · 1m', 'Medvedev −3.5 games on his column');
    assert.equal(face(D.fhLinePx(asCol(fav[4], 0), ctx)), face(D.fhLinePx(O225, ctx)), '5: Over 22.5 reads one price on Derived lines and Hot lines');
    assert.equal(face(D.fhLinePx(asCol(dog[3], 1), ctx)), '—', '6: Bublik +3.5 is not offered here: never Medvedev\'s −3.5 price (mutant: who ignored)');
    assert.equal(face(D.fhLinePx(asCol(fav[5], 0), ctx)), '—', 'Tiebreak in match has no bet105 market: a dash');
    // 6: the other side of the same line is Bublik +2.5 — never what a Medvedev row shows
    assert.equal(face(D.fhLinePx(defs.find(d => d.name === 'Bublik −2.5 games'), ctx)), '—', '6: Bublik −2.5 is suspended here: a dash');
    assert.equal(face(D.fhLinePx(defs.find(d => d.name === 'Tiebreak in match'), ctx)), '—', 'a line with no bet105 market dashes');
  } finally { restore(); }
});

test('9: a started or completed match shows the line\'s CLOSE, labelled as the close (founder 2026-10-26)', async () => {
  const C = (market, side, line, close, ci) => Object.assign(R(market, side, line, 2.2, null, 'started'), { close_price: close, close_implied: ci, close_at: '2026-10-25T13:58:00Z' });
  const rows = { '777': [C('gh', '7', -2.5, '2.05', '0.47'), C('gh', '8', 2.5, 1.84, 0.53), C('tg', 'over', 22.5, null, null)] };
  const t = fresh(rows, HB({ lines: { write: false } }));   // a close is history: the worker's live state does not gate it
  try {
    await t.L.load('2026-10-25', 777);
    const r = t.L.linePrice(777, '7', 'gh', -2.5, { date: '2026-10-25', started: true });
    assert.equal(r.state, 'close', 'a close (mutant: started always dashes)'); assert.equal(r.price, 2.05);
    assert.equal(t.L.faceText(r), 'Close 2.05 · 47%', 'labelled as the close');
    assert.deepEqual(t.L.faceParts(r), { main: '2.05 · 47%', age: 'close' }, 'the second line says "close", never an age');
    assert.match(t.L.hoverLines(r, 'x').join('\n'), /Close 2\.05 · 47%[\s\S]*The last bet105 price before the start · Kibl insert 13:58Z/);
    assert.ok(!/Offered/.test(t.L.hoverLines(r, 'x').join('\n')), 'no "offered" ladder on a close');
    const nc = t.L.linePrice(777, 'over', 'tg', 22.5, { date: '2026-10-25', started: true });
    assert.equal(nc.reason, 'no_close', 'no close captured: a dash with its reason, never the last live price (mutant: price in place of close)');
    assert.equal(t.L.faceText(nc), '—');
    assert.equal(t.L.linePrice(777, '7', 'gh', -3.5, { date: '2026-10-25', started: true }).reason, 'started', 'a line never offered: a dash');
    const D = dash();
    const cc = D.fhLinePxCell({ name: 'x', px: { mk: 'gh', who: 'A', line: -2.5 } }, { ek: 777, date: '2026-10-25', aKey: '7', bKey: '8', started: true });
    assert.match(cc.replace(/<[^>]*>/g, '|'), /\|Close 2\.05\|+47%\|/, 'the Price column on a completed match: "Close 2.05" over its implied % (mutant: close shown as a price)');
    const viaRow = t.L.linePrice(777, '8', 'gh', 2.5, { date: '2026-10-25' });
    assert.equal(viaRow.state, 'close', 'the row itself says started even before the page sees the match go live');
  } finally { t.restore(); }
});

test('7: wiring — line prices only in the match card: the H2H tab, Key factors and Market edge Derived lines; never the profile or the Head-to-head page', () => {
  assert.match(html, /results: HM\.mode === 'results', price: x => fhLinePxCell\(x\.L, pxCtx\),/, 'H2H tab: the Price column (mutant: hook removed)');
  assert.match(html, /\$\{x\.c\} of \$\{x\.n\}<\/span>\$\{fhLinePx\(x\.L, kfPx\)\}/, 'Key factors H2H card');
  const page = html.slice(html.indexOf("const HM = fhHotModel(F, fhH2hLineDefs(h.aS, h.bS), null)"), html.indexOf("const toSheet = s => s.replace(/fhOpenSheet"));
  assert.ok(page.length > 200 && !/price:|fhLinePx|LinePrices/.test(page), 'the Head-to-head page shows no line price (founder 2026-10-26: tied to no match)');
  assert.match(slice('meLinesCol'), /fhLinePxCell\(/, 'Match analysis → Market edge → Derived lines prices each line in its Price column');
  // founder 2026-10-26 (close brief item 2): its own column between Line and Rate; Covered is the count only
  const T = slice('fhHotLinesTable');
  assert.ok(T.indexOf('fh-hl-pxcol') > 0 && T.indexOf('fh-hl-pxcol') < T.indexOf('class="fh-hl-rate"'), 'the Price column sits before Rate (mutant: price in Covered)');
  const cov = T.slice(T.indexOf('class="fh-hl-cov"'), T.indexOf('<span style="display:grid; grid-template-columns:${cols}'));
  assert.ok(cov.length > 20 && !/opts\.price/.test(cov), 'Covered is the count only');
  assert.match(slice('fhHotLinesHead'), />Line<\/span>\$\{priced \? `<span style="\$\{cap\}">Price<\/span>` : ''\}<span style="\$\{cap\}">Rate</, 'the head reads Line · Price · Rate · Covered');
  assert.match(html, /\/\/ Line · Price[^\n]*\nconst ME_LCOLS = 'minmax\(0,1\.1fr\) 84px /, 'Derived lines: Line · Price · All · In band · Diff');
  assert.match(html, /<script src="line-prices\.js"><\/script>\n<script src="player-profile-v2\.js"><\/script>/, 'the helper loads before the profile module');
  assert.doesNotMatch(html, /line-prices\/[^'"`]*\.json/, 'no shard read anywhere: the rows come from Supabase');
  assert.doesNotMatch(readFileSync(LPSRC, 'utf8'), /line-prices\/|\.json['"]/, 'line-prices.js reads no shard');
  assert.match(html, /LinePrices\.load\(ctx\.date, ctx\.ek\)/, 'the Hot lines cell asks for its event (mutant: the date alone)');
  assert.doesNotMatch(readFileSync(process.env.LPT_PP2 || join(HERE, 'player-profile-v2.js'), 'utf8'), /LinePrices|lcLinePx/,
    'the player profile shows no line price (founder 2026-10-26: line prices belong to a match)');
});
