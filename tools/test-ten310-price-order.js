#!/usr/bin/env node
// TEN-310 R8 (founder, 2026-09-28): the player-profile Market edge prices each side in the tab's order —
// the page's FH_BOOK_ORDER = our captured Pinnacle → Tennis-Data Pinnacle (R8 ruling 2026-09-28) → Tennis-Data Bet365 → our
// captured Bet365 — one book and one source per side. Drives the REAL builder functions; the order is read
// from the dashboard's own constant, so the two cannot drift apart silently.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { pickSide, capPair } = require('../build-market-edge.js');
let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };

const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
const m = /const FH_BOOK_ORDER = (\[[^\]]*\])/.exec(html);
check('the page order is Pcap, Ptd, Btd, Bcap', () => assert.deepStrictEqual(JSON.parse(m[1].replace(/'/g, '"')), ['Pcap', 'Ptd', 'Btd', 'Bcap']));

const caps = [
  { date: '2026-07-12', oppKey: '1980', P: [1.18, 5.2], B: [1.2, 4.8] },
  { date: '2026-04-24', oppKey: '1771', P: null, B: [1.01, 26] },
];
const side = (tdP, tdB) => ({ tdP, tdB });
check('1. our captured Pinnacle first, ahead of Tennis-Data Pinnacle', () => {
  const p = pickSide(side([1.2, 4.5], [1.22, 4.33]), caps, '2026-07-12', '1980');
  assert.deepStrictEqual([p.book, p.price, p.oppPrice], ['pinnacle-capture', 1.18, 5.2]);
});
check('2. then Tennis-Data Pinnacle (before Tennis-Data Bet365)', () => assert.strictEqual(pickSide(side([1.2, 4.5], [1.22, 4.33]), caps, '2026-05-01', '1980').book, 'pinnacle'));
check('3. then Tennis-Data Bet365', () => assert.strictEqual(pickSide(side(null, [1.22, 4.33]), caps, '2026-04-24', '1771').book, 'bet365-archive'));
check('4. then our captured Bet365', () => {
  const p = pickSide(side(null, null), caps, '2026-04-24', '1771');
  assert.deepStrictEqual([p.book, p.price], ['bet365-capture', 1.01]);
});
check('nothing → unpriced (null), never a default', () => assert.strictEqual(pickSide(side(null, null), caps, '2026-05-01', '1771'), null));
check('a capture joins by opponent key within ±1 day, exactly one candidate', () => {
  assert.deepStrictEqual(capPair(caps, 'P', '2026-07-13', '1980'), [1.18, 5.2]);
  assert.strictEqual(capPair(caps, 'P', '2026-07-14', '1980'), null);           // 2 days off
  assert.strictEqual(capPair(caps, 'P', '2026-07-12', '9999'), null);           // another opponent
  assert.strictEqual(capPair(caps.concat([{ date: '2026-07-11', oppKey: '1980', P: [1.3, 3.5] }]), 'P', '2026-07-12', '1980'), null); // two candidates
});
check('a price below 1.01 on one side falls through to the next source', () => assert.strictEqual(pickSide(side([1.0, 20], [1.02, 15]), caps, '2026-05-01', 'x').book, 'bet365-archive'));
console.log(`\nten310-price-order: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
