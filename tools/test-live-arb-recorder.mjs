// Live arbitrage recorder (tools/live-arb-recorder.mjs): name join, fees, Polymarket book upkeep, the two directions,
// stale legs and episodes. Each check names the mutation it catches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samePlayer, polyMatches, kalshiMatches, joinPairs, kalshiFee, polyFee, Books, evaluate, Episodes, summarise, gapRow, PolyFeed } from './live-arb-recorder.mjs';

const ev = (id, a, b, extra = {}) => ({ id, title: `X: ${a} vs ${b}`, live: false, ...extra,
  markets: [{ sportsMarketType: 'moneyline', outcomes: JSON.stringify([a, b]), clobTokenIds: JSON.stringify([id + 'A', id + 'B']), gameStartTime: '2026-11-02 12:00:00+00' }] });
const km = (evt0, name, ya, ys, na) => { const evt = evt0.startsWith('KX') ? evt0 : 'KXATPMATCH-' + evt0; return ({ event_ticker: evt, ticker: evt + '-' + name.slice(0, 3).toUpperCase(), yes_sub_title: name, status: 'active',
  yes_ask_dollars: String(ya), yes_ask_size_fp: String(ys), no_ask_dollars: String(na) }); };

test('names: full match, accents, initial clash refused', () => {
  assert.ok(samePlayer('Alex Molcan', 'Alex Molcán'));
  assert.ok(samePlayer('Juan Manuel Cerundolo', 'J. Cerundolo'));
  assert.ok(!samePlayer('Francisco Cerundolo', 'Juan Manuel Cerundolo'), 'brothers stay apart (mutant: surname only)');
  assert.ok(!samePlayer('', 'Molcan'));
});

test('Polymarket list: moneyline only, ended matches dropped', () => {
  const m = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet'), ev('2', 'A B', 'C D', { ended: true })]);
  assert.equal(m.length, 1); assert.equal(m[0].tokA, '1A'); assert.equal(m[0].start, Date.parse('2026-11-02T12:00:00Z'));
});

test('join: one-to-one, either orientation, ambiguity refused', () => {
  const poly = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet')]);
  const kal = kalshiMatches([km('K1', 'Titouan Droguet', 0.5, 10, 0.5), km('K1', 'Alex Molcan', 0.55, 10, 0.47)]);
  const p = joinPairs(poly, kal);
  assert.equal(p.length, 1); assert.equal(p[0].km.p[p[0].aIs].name, 'Alex Molcan', 'orientation follows the names');
  const twice = kalshiMatches([...[km('K1', 'Titouan Droguet', 0.5, 1, 0.5), km('K1', 'Alex Molcan', 0.5, 1, 0.5)], km('K2', 'Titouan Droguet', 0.5, 1, 0.5), km('K2', 'Alex Molcan', 0.5, 1, 0.5)]);
  assert.equal(joinPairs(poly, twice).length, 0, 'two Kalshi candidates → no pair (mutant: first wins)');
});

test('fees: the arb engine constants', () => {
  assert.equal(+kalshiFee(0.5).toFixed(4), 0.0175); assert.equal(+polyFee(0.5).toFixed(4), 0.0125);
});

test('book: snapshot, change, removal, best ask', () => {
  const b = new Books();
  b.snapshot('t', [{ price: '0.45', size: '100' }, { price: '0.44', size: '20' }], 1);
  assert.deepEqual([b.best('t').price, b.best('t').size], [0.44, 20]);
  b.change('t', 'SELL', '0.44', '0', 2); assert.equal(b.best('t').price, 0.45, 'size 0 removes the level');
  b.change('t', 'BUY', '0.50', '9', 3); assert.equal(b.best('t').price, 0.45, 'a bid never moves the ask (mutant: side ignored)');
});

function pair(polyA, kalB, kalBsize = 50) {
  const poly = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet')]);
  const kal = kalshiMatches([km('K1', 'Alex Molcan', 0.9, 5, 0.9), km('K1', 'Titouan Droguet', kalB, kalBsize, 0.9)]);
  const p = joinPairs(poly, kal)[0];
  const b = new Books(); b.snapshot('1A', [{ price: String(polyA), size: '30' }], 1000); b.snapshot('1B', [{ price: '0.9', size: '30' }], 1000);
  return { p, b };
}

test('evaluate: cost after both fees, size = the smaller side, stale legs skipped', () => {
  const { p, b } = pair(0.45, 0.48);
  const e = evaluate(p, b, 1000, 2000).find((x) => x.dir === 'polyA+kalshiB');
  const cost = 0.45 + 0.05 * 0.45 * 0.55 + 0.48 + 0.07 * 0.48 * 0.52;
  assert.equal(e.cost, +cost.toFixed(5)); assert.ok(e.edge > 0); assert.equal(e.contracts, 30);
  assert.equal(evaluate(p, b, 1000, 1000 + 9000).length, 0, 'Kalshi older than 8 s → nothing (mutant: no staleness check)');
});

test('evaluate: the cheaper Kalshi leg wins (YES on him vs NO on his opponent); NO is never sized', () => {
  const poly = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet')]);
  const kal = kalshiMatches([km('K1', 'Alex Molcan', 0.9, 5, 0.40), km('K1', 'Titouan Droguet', 0.48, 50, 0.9)]);
  const p = joinPairs(poly, kal)[0]; const b = new Books(); b.snapshot('1A', [{ price: '0.45', size: '30' }], 1); b.snapshot('1B', [], 1);
  const e = evaluate(p, b, 1, 2).find((x) => x.dir === 'polyA+kalshiB');
  assert.equal(e.kalAsk, 0.40); assert.match(e.kalLeg, /^no /); assert.equal(e.contracts, null);
});

test('episodes: open on edge > 0, close when it goes, one per direction', () => {
  const closed = []; const E = new Episodes((x) => closed.push(x));
  const { p, b } = pair(0.45, 0.48);
  E.update(p, evaluate(p, b, 1000, 1000), 1000, true);
  E.update(p, evaluate(p, b, 3000, 3000), 3000, true);
  assert.equal(E.open.size, 1);
  b.snapshot('1A', [{ price: '0.60', size: '30' }], 4000);
  E.update(p, evaluate(p, b, 4000, 4000), 4000, true);
  assert.equal(closed.length, 1); assert.equal(closed[0].durationS, 3); assert.equal(closed[0].liveAny, true);
  const s = summarise(closed, {});
  assert.equal(s.inPlay.anyEdge.episodes, 1); assert.equal(s.preMatch.anyEdge.episodes, 0);
});

test('ATP only: a Kalshi Challenger event never forms a pair', () => {
  const poly = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet')]);
  const ch = kalshiMatches([km('KXATPCHALLENGERMATCH-26NOV02X', 'Alex Molcan', 0.5, 1, 0.5), km('KXATPCHALLENGERMATCH-26NOV02X', 'Titouan Droguet', 0.5, 1, 0.5)]);
  assert.equal(ch.length, 0); assert.equal(joinPairs(poly, ch).length, 0, 'mutant: series not checked');
});

test('gap row for the push: decimals, after-fee prices, dollars, stakes, flags', () => {
  const { p, b } = pair(0.45, 0.48);
  const e = evaluate(p, b, 1000, 2000).find((x) => x.dir === 'polyA+kalshiB');
  const g = gapRow(p, e, { inPlay: true, started: true, polyAt: 1000, kalAt: 1000 });
  assert.equal(g.match, 'Alex Molcan vs Titouan Droguet'); assert.equal(g.kalshiEvent, 'KXATPMATCH-K1');
  assert.equal(g.polyDec, 2.222); assert.equal(g.polyEff, +(1 / (0.45 + 0.05 * 0.45 * 0.55)).toFixed(3));
  assert.equal(g.polyLiq, 13.5, '30 shares × $0.45'); assert.equal(g.kalLiq, 24, '50 contracts × $0.48');
  assert.equal(+(g.stakePoly + g.stakeKalshi).toFixed(1), 100); assert.equal(g.inPlay, true); assert.equal(g.stake, e.stake);
});

class FakeWS {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); }
  send(x) { this.sent.push(x); }
  close() { this.readyState = 3; setImmediate(() => this.onclose && this.onclose({})); }
}
const tickQ = () => new Promise((r) => setImmediate(r));

test('feed: replacing the token list never re-opens from the old socket (the 5,166-reconnect bug)', async () => {
  FakeWS.all = []; const timers = [];
  const f = new PolyFeed({ WS: FakeWS, url: 'u', books: new Books(), later: (fn) => timers.push(fn) });
  f.set(['a', 'b']); f.set(['a', 'c']); f.set(['a', 'd']);
  await tickQ(); await tickQ();
  assert.equal(FakeWS.all.length, 3, 'one socket per list change'); assert.equal(timers.length, 0, 'no reconnect scheduled (mutant: old close handled)');
  assert.equal(FakeWS.all.filter((w) => w.readyState !== 3).length, 1, 'exactly one socket left open');
  f.set(['d', 'a']); assert.equal(FakeWS.all.length, 3, 'the same list in another order is not a change');
});

test('feed: an unexpected close drops that feed\'s books and reconnects once; messages on a replaced socket are ignored', async () => {
  FakeWS.all = []; const timers = []; const b = new Books(); let drops = 0;
  const f = new PolyFeed({ WS: FakeWS, url: 'u', books: b, later: (fn) => timers.push(fn), onDrop: () => drops++ });
  f.set(['a']); const w = FakeWS.all[0]; w.readyState = 1; w.onopen();
  assert.match(w.sent[0], /"assets_ids":\["a"\]/);
  w.onmessage({ data: JSON.stringify([{ event_type: 'book', asset_id: 'a', asks: [{ price: '0.4', size: '10' }] }]) });
  assert.equal(b.best('a').price, 0.4);
  w.readyState = 3; w.onclose({});
  assert.equal(b.best('a'), null, 'no price survives a dead feed (mutant: books kept)'); assert.equal(drops, 1); assert.equal(timers.length, 1);
  timers[0](); assert.equal(FakeWS.all.length, 2, 'reconnected');
  w.onmessage({ data: JSON.stringify([{ event_type: 'book', asset_id: 'a', asks: [{ price: '0.1', size: '10' }] }]) });
  assert.equal(b.best('a'), null, 'the dead socket writes nothing');
});

test('evaluate: a Polymarket book whose two asks sum under 0.98 is not used', () => {
  const { p, b } = pair(0.45, 0.48);
  b.snapshot('1B', [{ price: '0.40', size: '30' }], 1000);
  assert.equal(evaluate(p, b, 1000, 2000).length, 0, 'asks 0.45 + 0.40 = 0.85 → inconsistent (mutant: no check)');
});
