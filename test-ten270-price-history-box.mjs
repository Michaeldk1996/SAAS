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
  assert.match(h, /● live/);
  assert.match(h, /mc-drift pos">\+0\.02/);
  assert.match(h, /mc-drift neg">−0\.03/);
  assert.match(h, /no data 24\.09\. 11:30 – 24\.09\. 11:35/, 'gap row in the display zone, DD.MM. HH:MM');
  assert.match(h, /Opening odds[\s\S]*24\.09\. 09:00[\s\S]*1\.30[\s\S]*Bet105/);
  assert.doesNotMatch(h, /Closing odds/, 'no Closing row on an upcoming card');
});

test('completed cards put "Closing odds" at the very top', () => {
  const m = B.model({ book: 'Bet105', open: { price: 1.30, at: '2026-09-24T01:00:00Z' },
                      close: { price: 1.25, at: '2026-09-24T05:00:00Z' }, completed: true, historyAvailable: true }, [], []);
  const h = B.html(m);
  assert.ok(h.indexOf('Closing odds') < h.indexOf('phb-list'), 'Closing is above the change list');
  assert.match(h, /last updated/, 'not live: says when it was last updated');
});

test('history that starts after the Open says so, and nothing is interpolated', () => {
  const rows = [{ at: Date.parse('2026-09-24T06:00:00Z'), price: 1.40 }];
  const m = B.model({ book: 'Bet105', open: { price: 1.30, at: '2026-09-24T01:00:00Z' }, historyAvailable: true }, rows, []);
  assert.match(B.html(m), /history recorded from 24\.09\. 14:00/);
  assert.equal(m.rows.length, 1, 'one recorded row, no filled-in steps');
});

test('a book without recorded history says so instead of showing an empty list', () => {
  const m = B.model({ book: 'bet365', open: { price: 2.0, at: '2026-09-24T01:00:00Z' }, historyAvailable: false }, [], []);
  assert.match(B.html(m), /history not recorded for this book/);
});

test('a missing value is a dash, never a zero', () => {
  const m = B.model({ book: 'Bet105', open: { price: null, at: null }, historyAvailable: true }, [], []);
  assert.match(B.html(m), /Opening odds[\s\S]*—[\s\S]*—/);
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

test('equal-height cards: the grid stretches, the card is a flex column, the footer is pinned down', () => {
  assert.match(HTML, /\[data-page="matches"\] #matchlist\{[^}]*align-items:stretch/);
  assert.match(HTML, /\[data-page="matches"\] \.match-card\{[^}]*display:flex; flex-direction:column/);
  assert.match(HTML, /\[data-page="matches"\] \.mc-foot\{ margin-top:auto/);
  assert.match(HTML, /<script src="price-history-box\.js" defer><\/script>/);
});

test('an outage AFTER the last recorded change still shows as a gap row', () => {
  const rows = [{ at: Date.parse('2026-09-24T04:00:00Z'), price: 1.5 }];
  const gaps = B.gapRows({ gaps: [{ gap_from: '2026-09-24T05:00:00Z', gap_to: '2026-09-24T06:00:00Z' }] },
                         rows[0].at, Date.parse('2026-09-24T08:00:00Z'));
  assert.equal(gaps.length, 1);
});
