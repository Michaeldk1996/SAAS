// TEN-270 item 6 — the price-history box's logic, executed (not grepped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.newsTz = () => 'Asia/Makassar';      // UTC+8, the founder's display zone
const B = require('./price-history-box.js');
const nk = n => String(n || '').trim().split(/\s+/).pop().toLowerCase();

const PAYLOAD = {
  fixtures: [{ fixture_id: 7, player1: 'Daniil Medvedev', player2: 'Valentin Royer' }],
  poller: [
    { fixture_id: 7, side: '1', price: 1.30, at: '2026-09-24T01:00:00Z' },
    { fixture_id: 7, side: '1', price: 1.30, at: '2026-09-24T02:00:00Z' },   // same-price re-insert
    { fixture_id: 7, side: '1', price: 1.27, at: '2026-09-24T03:00:00Z' },
    { fixture_id: 7, side: '2', price: 3.80, at: '2026-09-24T03:00:00Z' },
  ],
  stream: [
    { side: 'medvedev', price: 1.27, at: '2026-09-24T03:00:00Z' },            // same Kibl record as the poller's
    { side: 'medvedev', price: 1.29, at: '2026-09-24T04:00:00Z' },
  ],
  gaps: [{ gap_from: '2026-09-24T03:30:00Z', gap_to: '2026-09-24T03:35:00Z' },
         { gap_from: '2026-09-24T03:40:00Z', gap_to: '2026-09-24T03:41:00Z' }],   // 60 s: not a lost-data gap
  sweep_gaps: [],
};

test('one timeline per player: stream + poller merged, the same Kibl record counted once, the other player excluded', () => {
  const rows = B.sideRows(PAYLOAD, 'medvedev', nk);
  assert.deepEqual(rows.map(r => r.price), [1.30, 1.30, 1.27, 1.29]);
  assert.deepEqual(B.changesOnly(rows).map(r => r.price), [1.30, 1.27, 1.29], 'a same-price re-insert is not a change');
});

test('newest first, change vs the previous price, colour classes of "Biggest market move", gap rows only over 120 s', () => {
  const rows = B.sideRows(PAYLOAD, 'medvedev', nk);
  const gaps = B.gapRows(PAYLOAD, rows[0].at, rows.at(-1).at);
  assert.equal(gaps.length, 1, 'the 60 s gap is not a lost-data gap');
  const m = B.model({ book: 'Bet105', open: { price: 1.30, at: '2026-09-24T01:00:00Z' }, completed: false,
                      live: true, historyAvailable: true }, rows, gaps);
  const flat = m.rows.map(r => r.gap ? 'gap' : `${r.price}:${r.delta}`);
  assert.deepEqual(flat, ['1.29:0.02', 'gap', '1.27:-0.03'], 'the Open row itself is not repeated as a change');
  const h = B.html(m);
  // TEN-377 README §6.1 layout: caps title + book, open → now · change % · N moves, ledger, pinned Opening.
  assert.match(h, /Odds movement<\/span><span class="phb-book">Bet105/);
  assert.match(h, /phb-open">1\.30<\/span><span class="phb-arr">→<\/span><b class="phb-now">1\.29<\/b><span class="phb-pct neg">−0\.8%/,
               'now = the newest recorded price when the card face has none; change % open→now, true minus');
  assert.match(h, /phb-n">2 moves/, 'N moves = the change rows (gap rows are not moves)');
  assert.match(h, /phb-row phb-latest"><span class="phb-when">24\.09\. 12:00/, 'newest first; the latest row is washed');
  assert.match(h, /phb-d pos">\+0\.020/, 'signed to 3 dp');
  assert.match(h, /phb-d neg">−0\.030/, 'true minus');
  assert.match(h, /phb-gap">No data <span class="phb-mono">24\.09\. 11:30 – 24\.09\. 11:35/, 'gap row in the display zone, DD.MM. HH:MM, no move, no wash');
  assert.match(h, /phb-opening[\s\S]*Opening[\s\S]*24\.09\. 09:00[\s\S]*1\.30/, 'Opening pinned at the foot');
  assert.ok(h.indexOf('phb-opening') > h.indexOf('phb-list'), 'Opening sits under the ledger');
  assert.doesNotMatch(h, /● live|Closing odds/, 'no status dot (S3), no Closing row');
});

test('TEN-377: a move with no change reads ±0.000; 3 dp always', () => {
  assert.equal(B.fmtDelta(0), '±0.000');
  assert.equal(B.fmtDelta(0.1), '+0.100');
  assert.equal(B.fmtDelta(-0.004), '−0.004');
  assert.equal(B.fmtDelta(null), '');
});

test('TEN-377: now = the card face price unless the history holds a later tick', () => {
  const rows = [{ at: Date.parse('2026-09-24T03:00:00Z'), price: 1.27 }];
  const base = { book: 'Bet105', open: { price: 1.30, at: '2026-09-24T01:00:00Z' }, historyAvailable: true };
  assert.equal(B.model(Object.assign({ now: 1.25, nowAt: '2026-09-24T04:00:00Z' }, base), rows, []).now, 1.25, 'face is newer');
  assert.equal(B.model(Object.assign({ now: 1.25, nowAt: '2026-09-24T02:00:00Z' }, base), rows, []).now, 1.27, 'history is newer');
  assert.equal(B.model(Object.assign({ now: null }, base), [], []).now, null, 'nothing known -> dash, never the open');
});

test('TEN-377 placement: 312 wide, right edge 6px past the price; 8px below, or above with < 420px under it', () => {
  const r = { right: 757, bottom: 555, top: 523 };
  assert.deepEqual(B.placeAt(r, 312, 374, 1512, 982), { left: 451, top: 563, below: true }, 'the reference geometry (OFFICIAL VERSION 1)');
  const low = { right: 757, bottom: 700, top: 668 };
  assert.deepEqual(B.placeAt(low, 312, 374, 1512, 982), { left: 451, top: 286, below: false }, '282px under it -> above');
  assert.equal(B.placeAt({ right: 1510, bottom: 100, top: 70 }, 312, 300, 1512, 982).left, 1192, 'never past the viewport edge');
});

test('TEN-377 Q2: triggers = the Upcoming price and the Completed Open / Close', () => {
  assert.match(B.PRICE_SEL, /\.mc-oddswrap/);
  assert.match(B.PRICE_SEL, /\.mc-px__open/);
  assert.match(B.PRICE_SEL, /\.mc-px__close/);
  assert.doesNotMatch(B.PRICE_SEL, /journey/);
});

test('TEN-377 Q2: Completed = open → the book\'s close, Pinnacle close on one mono line; the closing tick is the washed top row', () => {
  const rows = [{ at: Date.parse('2026-09-24T03:00:00Z'), price: 1.27 }, { at: Date.parse('2026-09-24T04:00:00Z'), price: 1.25 }];
  const card = { book: 'Bet105', open: { price: 1.30, at: '2026-09-24T01:00:00Z' }, completed: true, historyAvailable: true,
                 bookClose: 1.25, close: { price: 1.84, at: '2026-09-24T05:00:00Z', source: 'Pinnacle +30s (Oddspapi)' } };
  const h = B.html(B.model(card, rows, []));
  assert.match(h, /phb-open">1\.30<\/span><span class="phb-arr">→<\/span><b class="phb-now">1\.25<\/b><span class="phb-pct neg">−3\.8%/);
  assert.match(h, /phb-pin">Pinnacle close <b>1\.84<\/b>/);
  assert.match(h, /phb-row phb-latest"><span class="phb-when">24\.09\. 12:00<\/span><b class="phb-px">1\.25/);
  const none = B.html(B.model(Object.assign({}, card, { close: { price: null } }), rows, []));
  assert.match(none, /Pinnacle close <b>—<\/b>/, 'no Pinnacle close -> dash, never the book close');
  assert.equal(B.model(Object.assign({}, card, { bookClose: null }), rows, []).now, null, 'TEN-377: no Close on the card -> dash in the pop-up too, never a tick');
  assert.equal(B.model(Object.assign({}, card, { bookClose: 1.27 }), rows, []).now, 1.27, 'row 2 = EXACTLY the card Close, even if a later tick reads differently');
  assert.doesNotMatch(B.html(B.model({ book: 'Bet105', open: null, historyAvailable: true }, [], [])), /Pinnacle close/, 'Upcoming has no Pinnacle line');
});

test('TEN-377 Q3: empty / failed states are centred grey text; no status dot anywhere', () => {
  const base = { book: 'Bet105', open: { price: 1.3, at: '2026-09-24T01:00:00Z' }, historyAvailable: true };
  assert.match(B.html(B.model(base, [], []), 'notyet'), /phb-note">No price history yet/);
  assert.match(B.html(B.model(base, [], []), 'failed'), /phb-note">Price history unavailable/);
  assert.doesNotMatch(B.html(B.model(base, [], []), 'failed'), /phb-n"/, 'no move count for history that was not read');
  assert.doesNotMatch(B.html(B.model(Object.assign({ live: true }, base), [], [])), /●/);
  assert.match(B.html(B.model(Object.assign({ updatedAt: '2026-09-24T06:05:00Z' }, base), [], [])), /phb-src">Updated <span class="phb-mono">14:05<\/span>/);
});

test('history that starts after the Open says so, and nothing is interpolated', () => {
  const rows = [{ at: Date.parse('2026-09-24T06:00:00Z'), price: 1.40 }];
  const m = B.model({ book: 'Bet105', open: { price: 1.30, at: '2026-09-24T01:00:00Z' }, historyAvailable: true }, rows, []);
  assert.match(B.html(m), /recorded from <span class="phb-mono">24 Sep<\/span>/, 'founder Q3: one note line, dates in mono');
  assert.equal(m.rows.length, 1, 'one recorded row, no filled-in steps');
});

test('a book without recorded history says so instead of showing an empty list', () => {
  const m = B.model({ book: 'bet365', open: { price: 2.0, at: '2026-09-24T01:00:00Z' }, historyAvailable: false }, [], []);
  assert.match(B.html(m), /No price history for this book/);
});

test('a missing value is a dash, never a zero', () => {
  const m = B.model({ book: 'Bet105', open: { price: null, at: null }, historyAvailable: true }, [], []);
  assert.match(B.html(m), /phb-opening[\s\S]*Opening[\s\S]*—[\s\S]*—/);
});

// ── the card rules the box ships with (odds.md, founder 2026-09-24T10:16Z) ──
import { readFileSync } from 'node:fs';
const HTML = readFileSync(new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');

test('no status line on the card: the card template no longer renders mcNowSrcHtml', () => {
  const start = HTML.indexOf('<article class="match-card mx-match');
  const end = HTML.indexOf('</article>', start);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(HTML.slice(start, end), /mcNowSrcHtml\(/);
});

test('no native tooltip on card prices: mcTitleAttr writes data-pt, never title', () => {
  const i = HTML.indexOf('function mcTitleAttr(');
  const body = HTML.slice(i, HTML.indexOf('\n}', i));
  assert.match(body, /data-pt=/);
  assert.doesNotMatch(body, / title=/);
});

test('TEN-377 grid (replaces TEN-270 stretch): cards align to the top, so an open drawer never stretches its neighbour; closed cards line up by structure', () => {
  assert.match(HTML, /\[data-page="matches"\] #matchlist\{[^}]*align-items:start/);
  assert.doesNotMatch(HTML, /#matchlist\{[^}]*align-items:stretch/);
  assert.match(HTML, /<script src="price-history-box\.js" defer><\/script>/);
});

test('an outage AFTER the last recorded change still shows as a gap row', () => {
  const rows = [{ at: Date.parse('2026-09-24T04:00:00Z'), price: 1.5 }];
  const gaps = B.gapRows({ gaps: [{ gap_from: '2026-09-24T05:00:00Z', gap_to: '2026-09-24T06:00:00Z' }] },
                         rows[0].at, Date.parse('2026-09-24T08:00:00Z'));
  assert.equal(gaps.length, 1);
});

// Founder ruling 2026-09-24 (23:09Z): upcoming bet365 cards take m.oddsMovement;
// completed cards take the archive history. The shard series below is the real
// 12165847 p1 shape: bet365 tick times, a run-end repeat kept by the capture.
const OM = { books: { bet365: {
  p1: [['2026-09-24T16:16:00.000Z', 1.77], ['2026-09-24T16:35:00.000Z', 1.87], ['2026-09-24T16:44:00.000Z', 1.77],
       ['2026-09-24T16:50:00.000Z', 1.87], ['2026-09-24T16:53:00.000Z', 1.87], ['2026-09-24T20:33:00.000Z', 1.77]],
  p2: [['2026-09-24T16:16:00.000Z', 2.05], ['bad', 2.1], ['2026-09-24T16:35:00.000Z', 0]],
} } };

test('bet365 upcoming: one row per move from the shard, the run-end repeat is not a move, newest first', () => {
  const rows = B.shardRows(OM, 'p1');
  assert.equal(rows.length, 6);
  const m = B.model({ book: 'bet365', open: { price: 1.77, at: '2026-09-24T16:16:00Z' }, completed: false,
                      historyAvailable: true, note: 'n' }, rows, []);
  assert.deepEqual(m.rows.map(r => `${r.price}:${r.delta}`), ['1.77:-0.1', '1.87:0.1', '1.77:-0.1', '1.87:0.1'],
                   'the 16:53 same-price sighting is not a row; the Open itself is the bottom row');
  assert.deepEqual(B.shardRows(OM, 'p2').map(r => r.price), [2.05], 'an unparseable time or a zero price is dropped, never shown');
  assert.deepEqual(B.shardRows(null, 'p1'), [], 'no shard: no rows, no invented history');
});

test('source per card: Bet105 -> RPC, bet365 upcoming -> shard, bet365 completed -> the post-match archive', () => {
  const up = B.cardData({ openingOdds: { bookmaker: 'bet365' } }, 'p1');
  assert.equal(up.source, 'shard');
  assert.equal(up.historyAvailable, true);
  assert.match(B.html(B.model(up, [], [])), /bet365 · refreshed every 15 min/);
  const done = B.cardData({ openingOdds: { bookmaker: 'bet365' }, finalScore: '6-4 6-4' }, 'p1');
  assert.equal(done.source, 'archive', 'a completed bet365 card reads the archive, never the shard');
  assert.match(B.html(B.model(done, [], [])), /bet365 · refreshed every 15 min/,
               'founder 2026-09-25: the same source line as upcoming');
  assert.doesNotMatch(B.html(B.model(done, [], [])), /archived after the match/, 'the retired label is gone');
  assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' } }, 'p1').source, 'rpc');
  assert.equal(B.cardData({ openingOdds: { bookmaker: '1xbet' } }, 'p1').source, null);
});

test('TEN-295: the Closing odds row is the PINNACLE close, named by its source; none -> dash', () => {
  const pin = { p1: 1.534, p2: 2.65, p1At: '2026-09-24T10:10:08.224Z', p2At: '2026-09-24T10:10:08.224Z',
                source: 'Pinnacle +30s (Oddspapi)', startTs: '2026-09-24T10:31:59.000Z', startBasis: 'actual' };
  globalThis._mcPinClose = m => (m && m.finalScore ? m.pinClose || null : null);
  globalThis._mcCloseOf = () => 1.99;   // the card book's close must never reach this row
  try {
    const done = B.cardData({ openingOdds: { bookmaker: 'bet105' }, finalScore: '6-4 6-4', pinClose: pin }, 'p1');
    assert.deepEqual(done.close, { price: 1.534, at: '2026-09-24T10:10:08.224Z', source: 'Pinnacle +30s (Oddspapi)' });
    assert.equal(done.book, 'bet105', 'the header and the list stay the card book');
    const none = B.cardData({ openingOdds: { bookmaker: 'bet105' }, finalScore: '6-4 6-4' }, 'p1');
    assert.equal(none.close.price, null, 'no Pinnacle close -> dash, never the card book close');
    // TEN-377 Q2: the Completed pop-up shows Pinnacle's close as its own line, never an old 'Closing odds' row.
    assert.doesNotMatch(B.html(B.model(done, [], [])), /Closing odds/);
  } finally { delete globalThis._mcPinClose; delete globalThis._mcCloseOf; }
});

// TEN-270 post-match archive: completed bet365 cards read bet365_history.
// The payload below is the RPC's own shape (kibl-stream/now-schema.sql).
const ARCH = { card_key: '2026-09-24|fritz|zverev', selected: true, start_ts: '2026-09-24T08:00:00+00:00',
  start_ts_source: 'oddspapi', fixtures: 1, stored: 9, rows: [
    { side: 'p2', price: 1.20, at: '2026-09-24T07:50:00+00:00', active: true },
    { side: 'p2', price: 1.45, at: '2026-09-24T07:00:00+00:00', active: true },
    { side: 'p2', price: 1.45, at: '2026-09-24T06:30:00+00:00', active: false },   // suspended: not a price
    { side: 'p2', price: 1.50, at: '2026-09-24T06:00:00+00:00', active: true },
    { side: 'p1', price: 2.60, at: '2026-09-24T06:00:00+00:00', active: true },
    { side: 'p1', price: 0,    at: '2026-09-24T07:10:00+00:00', active: true },    // not a price
    { side: 'p1', price: 4.00, at: '2026-09-24T07:50:00+00:00', active: null },
  ] };
const rpcOf = p => async () => p;
const DONE_M = { openingOdds: { bookmaker: 'bet365' }, finalScore: '6-4 6-4', p1: 'T. Fritz', p2: 'A. Zverev' };

test('bet365 completed: the bet365_history archive, per side, suspended and sub-1.01 ticks dropped', async () => {
  const card = B.cardData(DONE_M, 'p2');
  assert.equal(card.source, 'archive');
  const got = await B.loadArchive(card, 'p2', rpcOf(ARCH));
  assert.deepEqual(got.rows.map(r => r.price), [1.50, 1.45, 1.20]);
  const got1 = await B.loadArchive(card, 'p1', rpcOf(ARCH));
  assert.deepEqual(got1.rows.map(r => r.price), [2.60, 4.00], 'the other side only; a zero is never a price');
  const m = B.model(Object.assign({}, got.card, { open: { price: 1.50, at: '2026-09-24T06:00:00Z' },
                                                 close: { price: 1.20, at: '2026-09-24T07:50:00Z' } }), got.rows, []);
  assert.deepEqual(m.rows.map(r => `${r.price}:${r.delta}`), ['1.2:-0.25', '1.45:-0.05']);
  assert.match(B.html(m), /bet365 · refreshed every 15 min/);
  assert.doesNotMatch(B.html(m), /archived after the match/, 'the retired label is gone');
});

test('an underway bet365 card (past its start, no result) reads neither the shard nor the archive', () => {
  globalThis.cardStartMs = () => Date.now() - 60e3;
  try {
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet365' } }, 'p1').source, null);
  } finally { delete globalThis.cardStartMs; }
});

test('bet365 completed, no archive source: not archived / other book / not exactly one fixture -> "not recorded"; no start; failure', async () => {
  const card = B.cardData(DONE_M, 'p1');
  for (const [why, over] of [['not archived', { stored: 0 }], ['the database selects another book', { selected: false }],
                             ['two fixtures feed the key', { fixtures: 2 }], ['no fixture', { fixtures: 0 }]]) {
    const got = await B.loadArchive(card, 'p1', rpcOf(Object.assign({}, ARCH, over, { rows: [] })));
    const h = B.html(B.model(got.card, got.rows, []));
    assert.match(h, /No price history for this book/, why);
    assert.doesNotMatch(h, /change times from bet365|no price change recorded/, why);
  }
  const nostart = await B.loadArchive(card, 'p1', rpcOf(Object.assign({}, ARCH, { start_ts: null, rows: [] })));
  assert.match(B.html(B.model(nostart.card, nostart.rows, [])), /Start time unknown — history not shown/);
  const fail = await B.loadArchive(card, 'p1', rpcOf(null));
  assert.equal(fail.failed, true, 'a failed read is a failure, never an empty history');
});

test('bet365 archive: nothing after the card\'s start shows, even if a row slips through', async () => {
  const card = Object.assign(B.cardData(DONE_M, 'p2'), { startAt: '2026-09-24T07:30:00Z' });
  const got = await B.loadArchive(card, 'p2', rpcOf(ARCH));
  const m = B.model(got.card, got.rows, []);
  assert.deepEqual(m.rows.map(r => r.price), [1.45, 1.50], 'the 07:50 tick is after the 07:30 start');
});

test('history ends at the start: a not-live Kibl row after the off never shows above the Close', () => {
  // Gaston–Shimabukuro, 24.09 (live probe): started 05:06:01Z, Close 2.23 seen 05:04:40Z,
  // then Kibl inserted 2.20 at 05:07Z without the live flag.
  const rows = [{ at: Date.parse('2026-09-24T04:23:00Z'), price: 2.23 },
                { at: Date.parse('2026-09-24T05:07:00Z'), price: 2.20 }];
  const gaps = [{ gap: true, from: Date.parse('2026-09-24T05:05:00Z'), to: Date.parse('2026-09-24T05:20:00Z') },
                { gap: true, from: Date.parse('2026-09-24T05:10:00Z'), to: Date.parse('2026-09-24T05:30:00Z') }];
  const m = B.model({ book: 'Bet105', completed: true, historyAvailable: true, startAt: '2026-09-24T05:06:01Z',
                      close: { price: 2.23, at: '2026-09-24T05:04:40Z' } }, rows, gaps);
  assert.deepEqual(m.rows.filter(r => !r.gap).map(r => r.price), [2.23]);
  const g = m.rows.filter(r => r.gap);
  assert.equal(g.length, 1, 'a gap that starts after the off is dropped');
  assert.equal(g[0].to, Date.parse('2026-09-24T05:06:01Z'), 'a gap running over the off is cut at the start');
  assert.equal(B.model({ book: 'Bet105', historyAvailable: true }, rows, []).rows.length, 2, 'no start known: nothing is cut');
});

test('bet365 shard only while the card is upcoming: live, past its start, or completed never read the shard (review 1)', () => {
  const future = Date.now() + 3600e3, past = Date.now() - 60e3;
  globalThis.cardStartMs = m => m._start;
  try {
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet365' }, _start: future }, 'p1').source, 'shard');
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet365' }, _start: past }, 'p1').source, null,
                 'past its start (underway, no result yet): in-play ticks would read as moves');
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet365' }, _start: future, live: true }, 'p1').source, null);
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' }, _start: past }, 'p1').source, 'rpc',
                 'Bet105 is cut at the start by the model instead');
  } finally { delete globalThis.cardStartMs; }
});

test('the shard is read with a 60 s cache; a read failure is "unavailable", a 404 is "nothing recorded" (review 2, 3)', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify(OM) }; };
    const a = await B.fetchShard('ek-ok');
    assert.deepEqual(B.shardRows(a.om, 'p1').length, 6);
    await B.fetchShard('ek-ok');
    assert.equal(calls, 1, 'a second open within 60 s reuses the read');
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
    assert.deepEqual(await B.fetchShard('ek-404'), { om: null }, '404: no shard yet');
    globalThis.fetch = async () => { throw new Error('network'); };
    assert.equal(await B.fetchShard('ek-down'), null, 'a failed read is not "no changes"');
    globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
    assert.equal(await B.fetchShard('ek-503'), null);
  } finally { globalThis.fetch = realFetch; }
});

test('a card with no card-state entry: the Open time is the card\'s own openingOdds sighting, and a first row at the Open price is not a move (live 12165868)', () => {
  // Cerundolo–Davidovich Fokina, live 25.09: no odds-card-state entry; openingOdds 2.37/1.57
  // seen 18:54Z (api-tennis bet365); the shard's only point is 2.37/1.54 at 20:42Z.
  const m = { openingOdds: { p1: 2.37, p2: 1.57, bookmaker: 'bet365', seenAt: '2026-09-24T18:54:25.206Z' } };
  const c1 = B.cardData(m, 'p1');
  assert.equal(c1.open.at, '2026-09-24T18:54:25.206Z');
  const shard = { books: { bet365: { p1: [['2026-09-24T20:42:50.122Z', 2.37]], p2: [['2026-09-24T20:42:50.122Z', 1.54]] } } };
  const m1 = B.model(c1, B.shardRows(shard, 'p1'), []);
  assert.equal(m1.rows.length, 0, 'the same price as the Open is not a move');
  assert.equal(m1.recordedFrom, Date.parse('2026-09-24T20:42:50.122Z'), 'when recording began still shows');
  const m2 = B.model(B.cardData(m, 'p2'), B.shardRows(shard, 'p2'), []);
  assert.deepEqual(m2.rows.map(r => `${r.price}:${r.delta}`), ['1.54:-0.03'], 'a real move is measured from the Open');
});

test('TEN-377 review: the change % obeys the Move rules — no % from a vendor-pinned open or two books', () => {
  const base = { book: 'Bet105', open: { price: 2.0, at: '2026-09-24T01:00:00Z' }, historyAvailable: true, now: 1.6 };
  assert.match(B.html(B.model(base, [], [])), /phb-pct neg">−20\.0%/, 'CONTROL: a measurable move shows its %');
  const h = B.html(B.model(Object.assign({ pctOk: false }, base), [], []));
  assert.doesNotMatch(h, /phb-pct/);
  assert.match(h, /phb-open">2\.00<\/span><span class="phb-arr">→<\/span><b class="phb-now">1\.60/, 'the prices still show');
  try {
    globalThis._mcCloseW60 = () => false;
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' }, finalScore: '6-4 6-4' }, 'p1').pctOk, true, 'TEN-377: an older close keeps its % (the card shows its Move)');
    globalThis._mcCloseW60 = () => true;
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' }, finalScore: '6-4 6-4' }, 'p1').pctOk, true, 'within-60 close');
    globalThis._openPinIsVendor = () => true;
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' } }, 'p1').pctOk, false, 'vendor-pinned open');
    delete globalThis._openPinIsVendor;
    globalThis._mcNowPair = () => ({ p1: 1.5, p2: 2.5, book: 'bet365' });
    globalThis._ocsOf = () => ({ book: 'bet105', p1: {}, p2: {} });
    assert.equal(B.cardData({}, 'p1').pctOk, false, 'Now from another book than the card book');
  } finally { delete globalThis._mcCloseW60; delete globalThis._openPinIsVendor; delete globalThis._mcNowPair; delete globalThis._ocsOf; }
});

test('TEN-377 review 11 + ledger: Bet105 note names its real cadence; a repeated displayed price is not listed', () => {
  assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' } }, 'p1').note, 'bet105 · live stream + 5-min sweep');
  const rows = [1.73, 1.734, 1.746, 1.73].map((p, i) => ({ at: Date.parse('2026-09-24T03:00:00Z') + i * 60e3, price: p }));
  const m = B.model({ book: 'Bet105', open: { price: 1.60, at: '2026-09-24T01:00:00Z' }, historyAvailable: true }, rows, []);
  assert.deepEqual(m.rows.map(r => `${r.price}:${r.delta}`), ['1.73:-0.016', '1.746:0.016', '1.73:0.13'],
                   '1.734 reads "1.73" like the row before it, so it is not listed; moves are from the listed row before');
  assert.match(B.html(m), /recorded from <span class="phb-mono">24 Sep/);
});

test('TEN-377 (card 0b990217): an older close puts its age first on the note line', () => {
  const card = { book: 'Bet105', open: { price: 1.3, at: '2026-09-24T01:00:00Z' }, completed: true, historyAvailable: true,
                 bookClose: 1.25, closeAgeMin: 130, updatedAt: '2026-09-24T06:05:00Z', note: 'bet105 · live stream + 5-min sweep' };
  assert.match(B.html(B.model(card, [], [])), /phb-src">Close last seen <span class="phb-mono">2 h 10 min<\/span> before start · bet105 · live stream \+ 5-min sweep/);
  assert.match(B.html(B.model(Object.assign({}, card, { closeAgeMin: null }), [], [])), /phb-src">Updated <span class="phb-mono">14:05/, 'within 60: the Q3 line');
});

test('TEN-377 review: the age note needs an OLDER close; the header names the prices\' book; deltas after a dropped first row run from the Open', () => {
  try {
    globalThis.mxCloseAgeMin = () => 130;
    globalThis._ocsOf = () => ({ book: 'bet105', p1: { close: 1.5, closeW60: true }, p2: {} });
    assert.equal(B.cardData({ finalScore: {} }, 'p1').closeAgeMin, null, 'within 60 -> no age note');
    globalThis._ocsOf = () => ({ book: 'bet105', p1: { close: 1.5, closeW60: false }, p2: {} });
    assert.equal(B.cardData({ finalScore: {} }, 'p1').closeAgeMin, 130, 'older -> age note');
    delete globalThis._ocsOf;
    globalThis._mcNowPair = () => ({ p1: 1.5, p2: 2.5, book: 'bet365' });
    assert.equal(B.cardData({ finalScore: {}, openingOdds: { bookmaker: 'Pncl' } }, 'p1').bookKey, 'pncl', 'Completed, no card state: the Open/Close book, not the Now book');
  } finally { delete globalThis.mxCloseAgeMin; delete globalThis._ocsOf; delete globalThis._mcNowPair; }
  const rows = [1.304, 1.36].map((p, i) => ({ at: Date.parse('2026-09-24T03:00:00Z') + i * 60e3, price: p }));
  const m = B.model({ book: 'Bet105', open: { price: 1.30, at: '2026-09-24T01:00:00Z' }, historyAvailable: true }, rows, []);
  assert.deepEqual(m.rows.map(r => `${r.price}:${r.delta}`), ['1.36:0.06'], '1.304 reads "1.30" = the Open, so it is dropped and 1.36 moves +0.060 from the Open');
});
