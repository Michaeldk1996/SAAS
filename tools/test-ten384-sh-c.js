// tools/test-ten384-sh-c.js — TEN-384 shard round, builder C (founder comment 7f82a547, 2026-10-07).
//
// Item 7 · the full ledger head. While "See all N results" has the whole window open, the head
// ("Recent form · full ledger   pct win · N matches") rates EVERY row the ledger lists; collapsed back, it
// returns to the strip's last-18 figure ("pct win · last 18 of N matches"). The rows are the same filtered
// form rows the ledger draws (Form rule: Laver Cup / exhibitions out; a walkover is neither a win nor a loss),
// so a surface / price filter narrows the head and the list together.
//
// Drives the REAL renderer (player-profile-v2.js renderLedger via buildCtx) on constructed, pinned rows.
// Control: `SHC_BASE=<sha> node tools/test-ten384-sh-c.js` runs the same checks against that commit's
// player-profile-v2.js (read with `git show`); the expanded-head checks fail there (and on e58dc928, the walkover "N of M" checks).
//
// Run: node tools/test-ten384-sh-c.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const BASE = process.env.SHC_BASE || null;
let PP2 = path.join(L.ROOT, 'player-profile-v2.js');
if (BASE) {
  PP2 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shc-control-')), 'player-profile-v2.js');
  fs.writeFileSync(PP2, execFileSync('git', ['-C', L.ROOT, 'show', BASE + ':player-profile-v2.js'], { maxBuffer: 64 << 20 }));
}
const H = L.harness();
console.log('TEN-384 shard C — ' + (BASE ? 'CONTROL against ' + BASE : 'working tree'));

// ── a pinned player: 32 dated rows in 2026 ─────────────────────────────────────
// 30 form rows (one of them a walkover received), plus a Laver Cup pair that the Form rule keeps out.
// Losses: the first ten (clay) lose every other match, the hard rows after them every fourth — so the whole
// window and its last 18 rate differently. Clay for i < 10 (10 rows), hard after (20 rows, over the cap).
const KEY = '__shc';
const rows = [];
const lost = i => (i < 10 ? i % 2 === 0 : i % 4 === 3);
for (let i = 0; i < 30; i++) {
  const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
  rows.push({
    opponent: 'O. Opp' + String.fromCharCode(65 + (i % 26)) + i, date: d.toISOString().slice(0, 10),
    tournament: 'Event ' + Math.floor(i / 3), round: '1/8-finals', surface: i < 10 ? 'clay' : 'hard',
    result: lost(i) ? '0 - 2' : '2 - 0', won: !lost(i),
    sets: lost(i) ? [{ p: 3, o: 6 }, { p: 4, o: 6 }] : [{ p: 6, o: 3 }, { p: 6, o: 4 }],
    retired: false, walkover: i === 20, qualifying: false, tier: 'atp'
  });
}
rows[20].sets = []; rows[20].result = '';
rows.push({ opponent: 'L. Laver', date: '2026-09-20', tournament: 'Laver Cup', round: 'RR', surface: 'hard',
  result: '0 - 2', won: false, sets: [], retired: false, walkover: false, qualifying: false, tier: 'atp' });
rows.push({ opponent: 'L. Laver2', date: '2026-09-21', tournament: 'Laver Cup', round: 'RR', surface: 'hard',
  result: '0 - 2', won: false, sets: [], retired: false, walkover: false, qualifying: false, tier: 'atp' });
const P = { key: KEY, name: 'S. Hcase', rank: 50, recentForm: { matches: rows.slice().reverse() } };

// The same window with the walkover replaced by a played win: no walkover anywhere.
const KEY2 = '__shc2';
const rows2 = rows.map((r, i) => (i === 20 ? Object.assign({}, r, { walkover: false, result: '2 - 0', sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }] }) : r));
const P2 = { key: KEY2, name: 'S. Hcasetwo', rank: 51, recentForm: { matches: rows2.slice().reverse() } };
const { I } = L.loadPp2({ src: PP2, now: '2026-10-07T12:00:00Z', players: { [KEY]: P, [KEY2]: P2 }, careerHistory: {}, marketEdge: {} });
const R = L.readers(I);
const DASH_RE = /full ledger\s+([^ ]+) win · (?:last (\d+) of (\d+)|(\d+) of (\d+)|(\d+)) match(?:es)?/;

function render(patch, who) {
  const pl = who || P;
  return R.withState(Object.assign({ key: pl.key, ledgerOpen: true, ledgerExpanded: false, surfaces: [], priceFilters: [] }, patch),
    () => I.renderLedger(pl, Object.assign(I.build(pl), { ledgerOpen: true })));
}
function head(html) {
  const m = DASH_RE.exec(L.text(html));
  assert(m, 'could not read the ledger head: ' + L.text(html).slice(0, 200));
  const N = x => (x ? Number(x) : null);
  return { rate: m[1], last: N(m[2]), of: N(m[3]) != null ? N(m[3]) : N(m[5]), n: N(m[4]) != null ? N(m[4]) : N(m[6]) };
}
const rowCount = html => (html.match(/class="pp2-ledger-row"/g) || []).length;
// independent expectation over a set of constructed rows (Form rule: walkover neither W nor L)
function expect(set) {
  const w = set.filter(r => r.won && !r.walkover).length, l = set.filter(r => !r.won && !r.walkover).length;
  return { rate: Math.round(100 * w / (w + l)) + '%', n: w + l };
}
const form = rows.filter(r => !/laver/i.test(r.tournament));            // 30, oldest first
const CAP = I.LEDGER_CAP;

H.check('pinned set: 30 form rows (Laver Cup out), more than the ' + CAP + '-row cap', () => {
  assert.strictEqual(CAP, 18);
  const html = render({});
  assert(html.includes('See all 30 results'), 'the button counts the 30 form rows');
});

H.check('collapsed: the head is the strip\'s last 18 rows, "last n of 30 matches" (n = counted rows, walkover out)', () => {
  const html = render({});
  const h = head(html), e = expect(form.slice(-CAP));
  assert.deepStrictEqual([h.rate, h.last, h.of], [e.rate, e.n, 30]);
  assert.strictEqual(rowCount(html), CAP, 'collapsed lists 18 rows');
  return '"' + h.rate + ' win · last ' + h.last + ' of ' + h.of + ' matches"';
});

H.check('expanded with a walkover in the window: rate over decided matches, "29 of 30 matches" beside "See all 30"', () => {
  const html = render({ ledgerExpanded: true });
  const h = head(html), e = expect(form);
  assert.strictEqual(rowCount(html), 30, 'expanded lists all 30 form rows');
  assert.deepStrictEqual([h.rate, h.n, h.of, h.last], [e.rate, 29, 30, null], 'decided of listed, no "last 18 of"');
  assert.strictEqual(e.n, 29, '30 rows listed, one a walkover → 29 decided');
  assert.notStrictEqual(h.rate, expect(form.slice(-CAP)).rate, 'the pinned set separates the two figures');
  assert(html.includes('Show the last ' + CAP), 'the toggle reads "Show the last 18"');
  assert(render({}).includes('See all 30 results'), 'the "of" count is the button\'s count');
  return '"' + h.rate + ' win · ' + h.n + ' of ' + h.of + ' matches"';
});

H.check('expanded with no walkover: one count, "N matches" (unchanged form)', () => {
  const html = render({ ledgerExpanded: true }, P2);
  const h = head(html), e = expect(rows2.filter(r => !/laver/i.test(r.tournament)));
  assert.strictEqual(rowCount(html), 30);
  assert.deepStrictEqual([h.rate, h.n, h.of, h.last], [e.rate, 30, null, null]);
  assert(/· 30 matches/.test(L.text(html)) && !/ of 30 matches/.test(L.text(html)));
  return '"' + h.rate + ' win · ' + h.n + ' matches"';
});

H.check('collapsed again: the head returns to the 18-match figure (same element, same styling)', () => {
  const a = render({}), b = render({ ledgerExpanded: true }), c = render({});
  assert.strictEqual(c, a, 'collapse renders exactly the pre-expansion ledger');
  const span = s => /<span style="[^"]*font-size:12px;color:var\(--text-label\);"><span style="color:var\(--text\);font-weight:700;">/.test(s);
  assert(span(a) && span(b), 'the head figure keeps its element and styling in both states');
});

H.check('filters narrow the head and the list together while expanded (clay: 10 rows ≤ cap → one figure)', () => {
  const html = render({ ledgerExpanded: true, surfaces: ['clay'] });
  const clay = form.filter(r => r.surface === 'clay');
  const h = head(html), e = expect(clay);
  assert.strictEqual(rowCount(html), clay.length);
  assert.deepStrictEqual([h.rate, h.n], [e.rate, e.n]);
  assert(!/See all|Show the last/.test(html), 'no toggle when the filtered window fits the cap');
});

H.check('filters while expanded, over the cap (hard: 20 rows > cap; all 20 listed, rated as one)', () => {
  const html = render({ ledgerExpanded: true, surfaces: ['hard'] });
  const hard = form.filter(r => r.surface === 'hard');
  const h = head(html), e = expect(hard);
  assert.strictEqual(rowCount(html), hard.length);
  assert.deepStrictEqual([h.rate, h.n, h.of], [e.rate, e.n, hard.length], 'the walkover sits in the hard rows: 19 of 20');
});

H.mustFail('the expanded check would catch a head left on the last-18 figure', () => {
  const h = head(render({}));                         // the collapsed head
  assert.deepStrictEqual([h.rate, h.n, h.of], [expect(form).rate, expect(form).n, 30]);
});

H.done();
