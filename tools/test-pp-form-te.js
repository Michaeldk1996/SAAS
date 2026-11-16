#!/usr/bin/env node
// Recent form on the Player Profile (founder 2026-11-16, "still fix this, all players need a price"): the ribbon, the
// full ledger and the header's run read the career record's matches — the api-tennis rows plus the rows only Tennis
// Explorer lists (career-record/<key>.json `add`), cut like recentForm (this season + down to the 18th form row) — and a
// row the Market edge shard does not price takes the site's one price join (window.pp2DrawJoin → H2HPage.priceJoin).
// Controls: without the record file the strip is the feed rows alone (the pre-fix state); a walkover / unconfirmed TE
// row is never a form row; an unpriced join row stays a dash.
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'player-profile-v2.js'), 'utf8');
const Y = String(new Date().getFullYear() - 1);   // last season: the cut keeps only down to the 18th form row
const day = (i) => Y + '-' + String(1 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0');
const FEED = [0, 1, 2].map((i) => ({ opponent: 'F. Feed' + i, date: day(50 + i), tournament: 'M15 Monastir', round: 'M15 Monastir - 1/16-finals',
  surface: 'hard', result: '0 - 2', won: false, sets: [{ p: 2, o: 6 }, { p: 2, o: 6 }], walkover: false, tier: 'itf', eventKey: 100 + i }));
const ADD = [];
for (let i = 0; i < 24; i++) ADD.push({ year: Y, surface: 'hard', level: 'chitf', date: day(i * 2), tournament: 'Futures ' + Y,
  round: i % 2 ? 'Q-1R' : 'R32', opponent: 'T. Only' + i, result: i % 3 ? '2 - 0' : '0 - 2', won: !!(i % 3), src: 'te',
  teCat: i % 2 ? 'ITF qual' : 'ITF', sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }], teMatchId: String(9000 + i) });
ADD.push({ year: Y, level: 'chitf', date: day(60), tournament: 'Futures ' + Y, round: 'R32', opponent: 'W. Over', result: null, won: true, walkover: true, src: 'te' });
ADD.push({ year: Y, level: 'chitf', date: day(61), tournament: 'Futures ' + Y, round: 'R32', opponent: 'U. Nconfirmed', result: null, won: true, unconfirmed: true, src: 'te' });
function load(withRecord, join) {
  const p = { key: '78628', name: 'I. Snoussi', recentForm: { matches: JSON.parse(JSON.stringify(FEED)) }, careerByYear: [] };
  const sb = { FEATURE_PP2: true, playerProfiles: { players: { 78628: p } }, careerHistory: { 78628: [] },
    careerRecord: withRecord ? { 78628: { add: ADD } } : {}, pp2DrawJoin: join || (() => 'pending') };
  global.window = sb; new Function('window', SRC)(sb);
  const I = sb.PlayerProfileV2._internals;
  return { I, p: I.profileFor('78628') };
}
let pass = 0;
// 1 · the record's TE-only rows join the form rows, walkovers / unconfirmed out, cut to the last 18
{
  const { I, p } = load(true);
  const ms = I.formMatches(p);
  assert.ok(!ms.some((m) => /W\. Over|U\. Nconfirmed/.test(m.opponent)), 'a walkover / unconfirmed TE row became a form row'); pass++;
  assert.strictEqual(ms.length, 18, 'cut to the last 18 form rows: ' + ms.length); pass++;
  assert.deepStrictEqual(ms.slice(-3).map((m) => m.opponent), ['F. Feed0', 'F. Feed1', 'F. Feed2'], 'newest last'); pass++;
  const te = ms.filter((m) => m.src === 'te');
  assert.strictEqual(te.length, 15); pass++;
  assert.ok(te.every((m) => m.tier === 'itf' && m.eventKey === null), 'TE rows: tier itf, no event key'); pass++;
  assert.ok(te.filter((m) => /^Q/.test(m.round)).every((m) => m.qualifying), 'a Q- round is qualifying'); pass++;
  const { html: h } = { html: global.window.PlayerProfileV2.render ? global.window.PlayerProfileV2.render(p) : '' };
  if (h) { assert.ok(h.includes('last 18 ·'), 'the strip caption reads last 18'); pass++; }
}
// 2 · control: no record file → the feed rows alone (the pre-fix 3-match strip)
{
  const { I, p } = load(false);
  assert.strictEqual(I.formMatches(p).length, 3, 'control: without the record the strip is the feed rows'); pass++;
}
// 3 · prices: a row the shard does not price takes the one join's price and book; pending → no price
{
  const join = (key, name, rows) => { rows.forEach((r) => { if (r.opp === 'T. Only23') { r.price = 1.83; r.oppPrice = 1.95; r.book = 'A'; r.src = 'te'; }
    if (r.opp === 'F. Feed2') { r.price = 2.4; r.oppPrice = 1.55; r.book = 'B'; r.src = 'atb'; } }); return 'ready'; };
  const { I, p } = load(true, join);
  const lr = I.ledgerRows(p);
  const a = lr.find((x) => x.m.opponent === 'T. Only23'), b = lr.find((x) => x.m.opponent === 'F. Feed2'), c = lr.find((x) => x.m.opponent === 'T. Only22');
  assert.deepStrictEqual([a.price, a.oppPrice, a.role, a.book], [1.83, 1.95, 'fav', 'pinnacle-approx-te'], 'TE row priced on the join (Pinnacle (approx.) · Tennis Explorer)'); pass++;
  assert.deepStrictEqual([b.price, b.book], [2.4, 'bet365-approx-at'], 'a feed row priced on the join (api-tennis Bet365)'); pass++;
  assert.strictEqual(c.price, null, 'a row the join holds no price for stays a dash'); pass++;
  const { I: I2, p: p2 } = load(true);   // join pending
  assert.ok(I2.ledgerRows(p2).every((x) => x.price == null), 'a pending join prices nothing'); pass++;
}
console.log('test-pp-form-te: ' + pass + ' checks passed');
