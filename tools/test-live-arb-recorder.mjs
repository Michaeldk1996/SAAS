// Live arbitrage recorder (tools/live-arb-recorder.mjs): name join, fees, Polymarket book upkeep, the two directions,
// stale legs and episodes. Each check names the mutation it catches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify, constants as CC } from 'node:crypto';
import { samePlayer, polyMatches, kalshiMatches, joinPairs, kalshiFee, polyFee, Books, evaluate, Episodes, summarise, gapRow, PolyFeed, KalshiFeed, kalshiSign, boardPhase, boardFixture, setText, recRows,
  oddsName, oddsEvents, BookFeed, unify, venueQuotes, evaluateMulti, multiGapRow, STALE_MS, BOOKS } from './live-arb-recorder.mjs';

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

test('Kalshi signature: RSA-PSS SHA-256 over timestamp + GET + the websocket path (verifies with the public key)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const sig = kalshiSign(pem, 1730000000000);
  const v = createVerify('sha256'); v.update('1730000000000GET/trade-api/ws/v2'); v.end();
  assert.ok(v.verify({ key: publicKey, padding: CC.RSA_PKCS1_PSS_PADDING, saltLength: CC.RSA_PSS_SALTLEN_DIGEST }, sig, 'base64'));
});

test('Kalshi feed: auth headers, subscribe, snapshot + deltas → sized YES and NO asks; a close drops the books', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const all = []; class W { constructor(u, o) { this.u = u; this.o = o; this.sent = []; this.readyState = 1; all.push(this); } send(x) { this.sent.push(x); } close() { this.readyState = 3; } }
  const timers = []; let drops = 0;
  const f = new KalshiFeed({ WS: W, keyId: 'kid', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), later: (fn) => timers.push(fn), onDrop: () => drops++ });
  f.set(['M-A', 'M-B']); const w = all[0];
  assert.equal(w.o.headers['KALSHI-ACCESS-KEY'], 'kid'); assert.ok(w.o.headers['KALSHI-ACCESS-SIGNATURE'].length > 100);
  w.onopen(); assert.deepEqual(JSON.parse(w.sent[0]).params, { channels: ['orderbook_delta'], market_tickers: ['M-A', 'M-B'] });
  const msg = (o) => w.onmessage({ data: JSON.stringify(o) });
  msg({ type: 'orderbook_snapshot', msg: { market_ticker: 'M-A', yes_dollars: [['0.50', '100'], ['0.52', '40']], no_dollars: [['0.45', '300']] } });
  msg({ type: 'orderbook_snapshot', msg: { market_ticker: 'M-B', yes: [[44, 10]], no: [[54, 70]] } });
  assert.deepEqual(f.quote('M-A'), { yesAsk: 0.55, yesSize: 300, noAsk: 0.48, noSize: 40, at: f.quote('M-A').at }, 'YES ask = 1 − best NO bid; NO ask = 1 − best YES bid');
  assert.equal(f.quote('M-B').yesAsk, 0.46, 'cents read as cents');
  msg({ type: 'orderbook_delta', msg: { market_ticker: 'M-A', side: 'no', price_dollars: '0.47', delta_fp: '25' } });
  assert.equal(f.quote('M-A').yesAsk, 0.53); assert.equal(f.quote('M-A').yesSize, 25);
  msg({ type: 'orderbook_delta', msg: { market_ticker: 'M-A', side: 'no', price_dollars: '0.47', delta_fp: '-25' } });
  assert.equal(f.quote('M-A').yesAsk, 0.55, 'a level emptied by a delta is gone (mutant: kept at 0)');
  for (const d of ['0.1', '0.2', '-0.3']) msg({ type: 'orderbook_delta', msg: { market_ticker: 'M-A', side: 'no', price_dollars: '0.49', delta_fp: d } });
  assert.equal(f.quote('M-A').yesAsk, 0.55, 'fractional deltas that empty a level leave no float dust behind (mutant: unrounded sum keeps 5.6e-17)');
  const km = { ev: 'KXATPMATCH-X', p: [{ name: 'A', ticker: 'M-A', yesAsk: 0.9 }, { name: 'B', ticker: 'M-B', yesAsk: 0.9 }] };
  const o = f.overlay(km); assert.equal(o.p[0].yesAsk, 0.55); assert.equal(o.p[1].noAsk, 0.56); assert.equal(o.p[0].name, 'A');
  w.readyState = 3; w.onclose({});
  assert.equal(f.quote('M-A'), null, 'no price from a dead feed'); assert.equal(f.overlay(km), null); assert.equal(drops, 1); assert.equal(timers.length, 1);
  f.set(['M-A']); const n = all.length; all[n - 1].onclose && all[0].onclose({}); assert.equal(timers.length, 1, 'a replaced socket never re-opens');
});

test('evaluate: the Kalshi websocket clock decides staleness; a NO leg from the feed is sized', () => {
  const { p, b } = pair(0.45, 0.48);
  p.kalAt = 1000; p.km.p[p.aIs].noAsk = 0.47; p.km.p[p.aIs].noSize = 60;
  const e = evaluate(p, b, 0, 2000).find((x) => x.dir === 'polyA+kalshiB');
  assert.ok(e, 'the pair\'s own Kalshi clock (1 s old) is used, not the stale global one'); assert.equal(e.kalLeg.slice(0, 2), 'no'); assert.equal(e.contracts, 30);
});

const fix = (status, game, sets, extra = {}) => ({ event_type_type: 'Atp Singles', event_first_player: 'A. Molcan', event_second_player: 'T. Droguet',
  event_status: status, event_game_result: game, scores: sets.map(([a, b], i) => ({ score_first: String(a), score_second: String(b), score_set: String(i + 1) })), ...extra });

test('board phase: alerts only at 0–0 — new game, changeover (odd games), set break; never a point, a tiebreak or a match not in play', () => {
  assert.equal(boardPhase(fix('Set 1', '0 - 0', [[2, 1]])).phase, 'changeover', '3 games played → players sit');
  assert.equal(boardPhase(fix('Set 1', '0 - 0', [[2, 2]])).phase, 'game', '4 games → new game, serve changes');
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [[6, 3], [0, 0]])).phase, 'set', 'a new set at 0–0 → set break');
  assert.equal(boardPhase(fix('Set 2', '30 - 15', [[6, 3], [1, 0]])).phase, 'point', 'a game under way (mutant: points ignored)');
  assert.equal(boardPhase(fix('Set 1', '0 - 0', [[6, 6]])).phase, 'point', 'a tiebreak has no break between points');
  assert.equal(boardPhase(fix('Retired', '0 - 0', [[6, 3]])).phase, null, 'a retirement is not in play (mutant: status ignored)');
  assert.equal(boardPhase(fix('Walk Over', '', [])).phase, null);
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [[6, 3], [2, 1]])).score, '6–3 2–1');
  assert.equal(boardPhase(null).phase, null);
  // founder 2026-11-09: the board still read "Set 2" after Alcaraz won 7–6(5) 7–5 (8 Nov 16:17Z) and both alerts went out after the match
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [['6.5', '7.7'], ['5', '7']])).phase, null, 'the last set decided → finished (mutant: 12 games = game)');
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [[6, 3], [6, 4]])).phase, null, 'straight sets, best of 3 → finished');
  assert.equal(boardPhase(fix('Set 1', '0 - 0', [[6, 4]])).phase, 'set', 'set 1 decided, set 2 not opened yet → set break');
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [[6, 3], [6, 4]], { tournament_name: 'US Open' })).phase, 'set', 'a Grand Slam needs 3 sets');
  assert.equal(boardPhase(fix('Set 3', '0 - 0', [[6, 3], [6, 4], [6, 2]], { tournament_name: 'US Open' })).phase, null);
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [[6, 3], [6, 4]], { tournament_name: 'US Open - Qualification' })).phase, null, 'Slam qualifying is best of 3');
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [[6, 3], [6, 5]])).phase, 'changeover', '6–5 is not decided');
});

test('board fixture: ATP singles, both names either way round, exactly one', () => {
  const { p } = pair(0.45, 0.48);
  assert.ok(boardFixture(p, [fix('Set 1', '0 - 0', [[0, 0]])]));
  assert.ok(boardFixture(p, [fix('Set 1', '0 - 0', [[0, 0]], { event_first_player: 'T. Droguet', event_second_player: 'A. Molcan' })]));
  assert.equal(boardFixture(p, [fix('Set 1', '0 - 0', [[0, 0]]), fix('Set 1', '0 - 0', [[0, 0]])]), null, 'two candidates → none');
  assert.equal(boardFixture(p, [fix('Set 1', '0 - 0', [[0, 0]], { event_type_type: 'Challenger Men Singles' })]), null, 'ATP only');
});

test('gap row carries the board state (phase, score, status) for the alert rule', () => {
  const { p, b } = pair(0.45, 0.48);
  const e = evaluate(p, b, 1000, 2000).find((x) => x.dir === 'polyA+kalshiB');
  const g = gapRow(p, e, { inPlay: true, started: true, polyAt: 1000, kalAt: 1000, board: boardPhase(fix('Set 1', '0 - 0', [[2, 1]])) });
  assert.equal(g.phase, 'changeover'); assert.equal(g.score, '2–1'); assert.equal(g.boardStatus, 'Set 1');
  assert.equal(gapRow(p, e, { inPlay: true, started: true, polyAt: 1, kalAt: 1, board: null }).phase, null, 'no board → no phase → no alert');
});

test('gap row in dollars: per-leg stake, payout = contracts, profit = payout − total (founder 2026-11-04)', () => {
  const { p, b } = pair(0.45, 0.48);
  const e = evaluate(p, b, 1000, 2000).find((x) => x.dir === 'polyA+kalshiB');
  const g = gapRow(p, e, { inPlay: true, started: true, polyAt: 1000, kalAt: 1000, board: null });
  assert.equal(g.payout, 30, '30 contracts pay $30 whoever wins');
  assert.ok(Math.abs(g.polyStake + g.kalStake - e.stake) <= 0.011, 'the two legs add up to the total (each rounded to the cent)');
  assert.equal(g.polyStake, +(30 * (0.45 + 0.05 * 0.45 * 0.55)).toFixed(2));
  assert.equal(g.profitUsd, +(30 - e.stake).toFixed(2)); assert.ok(g.profitUsd > 0);
});

test('tiebreak sets read as written: 7–6(5), 6–7(5); plain sets unchanged; the games feed the phase', () => {
  assert.equal(setText('7.7', '6.5'), '7–6(5)'); assert.equal(setText('6.5', '7.7'), '6–7(5)'); assert.equal(setText('6', '3'), '6–3');
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [[6.5, 7.7], [2, 1]])).score, '6–7(5) 2–1');
  assert.equal(boardPhase(fix('Set 2', '0 - 0', [['7.7', '6.5'], ['2', '1']])).phase, 'changeover');
});

test('our Polymarket recorder rows: every match with a live book, best ask + shares per player; no book → left out', () => {
  const poly = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet'), ev('2', 'A B', 'C D')]);
  const b = new Books(); b.snapshot('1A', [{ price: '0.45', size: '1000' }, { price: '0.47', size: '9' }], 1000); b.snapshot('1B', [{ price: '0.56', size: '500' }], 1000);
  const r = recRows(poly, b, 2000);
  assert.equal(r.length, 1, 'the match with no book is left out (mutant: pushed with null prices)');
  assert.deepEqual([r[0].pmId, r[0].askA, r[0].sizeA, r[0].askB, r[0].sizeB], ['1', 0.45, 1000, 0.56, 500]);
  assert.equal(r[0].start, '2026-11-02T12:00:00.000Z'); assert.equal(r[0].live, false);
  assert.equal(recRows(poly, b, 1000 + 120000 * 5 + 1).length, 0, 'a book silent beyond the window → no row (a dead feed is never recorded)');
});

// ---------- bookmakers via odds-api.io (founder 2026-11-08) ----------
const oev = (id, home, away, league = 'ATP - Paris, France', status = 'live', date = '2026-11-02T12:00:00Z') => ({ id, home, away, league: { name: league }, status, date });

test('odds-api.io names and events: "Surname, First" turned round; ATP singles only (no doubles, Challenger, WTA, UTR), live or not started', () => {
  assert.equal(oddsName('Montes-de la Torre, Inaki'), 'Inaki Montes-de la Torre'); assert.equal(oddsName('Alcaraz'), 'Alcaraz');
  const e = oddsEvents([oev(1, 'Shelton, Ben', 'Alcaraz, Carlos'), oev(2, 'Halys Q / Herbert P-H', 'Harrison C / Skupski N', 'ATP - Paris, France, Doubles'),
    oev(3, 'Kozlov, Stefan', 'Mayo, Aidan', 'Challenger - Champaign, USA'), oev(4, 'A, B', 'C, D', 'WTA - Tokyo, Japan'), oev(5, 'Sonego, Lorenzo', 'Gojo, Borna', 'ATP - Stockholm, Sweden, Qualifying', 'pending'),
    oev(6, 'X, Y', 'Z, W', 'ATP - Paris, France', 'settled'), oev(7, 'P, Q', 'R, S', 'UTR Men - UTR PTT Saitama Men 12')]);
  assert.deepEqual(e.map((x) => x.id), ['1', '5'], 'mutants: doubles kept, Challenger kept, settled kept');
  assert.equal(e[0].a, 'Ben Shelton'); assert.equal(e[0].event, 'Paris'); assert.equal(e[0].live, true); assert.equal(e[1].event, 'Stockholm');
});

class OW { static all = []; constructor(u) { this.url = u; this.readyState = 1; OW.all.push(this); } send() {} close() { this.readyState = 3; } }
const upd = (id, bookie, home, away, extra = {}) => ({ type: 'updated', seq: 5, id: String(id), bookie, url: 'https://x/' + id, markets: [{ name: 'ML', updatedAt: '2026-11-02T12:00:00Z', odds: [{ home, away }] }], ...extra });

test('book feed: the key and filters on the socket URL, updates priced per book, deleted / no_markets remove, a dead feed has no price', () => {
  OW.all = []; const timers = []; let drops = 0, msgs = 0; let now = 1000;
  const f = new BookFeed({ WS: OW, key: 'K', later: (fn, ms) => timers.push([fn, ms]), onDrop: () => drops++, onMessage: () => msgs++, now: () => now });
  f.open(); const w = OW.all[0]; const u = new URL(w.url);
  assert.equal(u.searchParams.get('apiKey'), 'K'); assert.equal(u.searchParams.get('markets'), 'ML'); assert.equal(u.searchParams.get('sport'), 'tennis');
  const m = (x) => w.onmessage({ data: JSON.stringify(x) });
  m({ type: 'welcome' }); m(upd(7, 'Bet105', '1.80', '2.10')); m(upd(7, 'Napoleon Sports BE', '1.75', '2.15')); m(upd(7, 'Superbet', '9', '9'));
  assert.equal(f.quote(7, 'Bet105').home, 1.8); assert.equal(f.quote(7, 'Napoleon'), null, 'Napoleon is not an arbitrage book (founder 2026-11-09; mutant: kept)'); assert.equal(f.q.size, 1, 'a book not ours is not kept');
  assert.deepEqual(Object.values(BOOKS), ['Bet105'], 'arbitrage = Bet105 × Polymarket × Kalshi only');
  assert.equal(f.quote(7, 'Bet105').url, 'https://x/7'); assert.equal(f.lastSeq, 5);
  m(upd(7, 'Bet105', '1.00', '9.50')); assert.equal(f.quote(7, 'Bet105'), null, 'a 1.00 placeholder is no price (mutant: kept)');
  m(upd(7, 'Bet105', '2.20', '2.20')); assert.equal(f.quote(7, 'Bet105'), null, 'a book paying over 101% is no price');
  m({ type: 'no_markets', id: '7', bookie: 'Bet105' }); assert.equal(f.quote(7, 'Bet105'), null, 'a pulled market is gone at once (mutant: kept)');
  m(upd(7, 'Bet105', '1.80', '2.10')); w.readyState = 3; w.onclose({});
  assert.equal(f.quote(7, 'Bet105'), null, 'no price from a dead feed'); assert.equal(drops, 1); assert.equal(timers.length, 1); assert.equal(timers[0][1], 2000);
  timers[0][0](); assert.equal(new URL(OW.all[1].url).searchParams.get('lastSeq'), '5', 'reconnects from the last sequence');
  OW.all[1].onclose({}); assert.equal(timers[1][1], 4000, 'backoff doubles');
});

test('book feed seed: REST prices fill a match, never over a newer streamed price', () => {
  OW.all = []; const f = new BookFeed({ WS: OW, key: 'K', now: () => 1 }); f.open(); const w = OW.all[0];
  w.onmessage({ data: JSON.stringify(upd(8, 'Bet105', '1.50', '2.70', { markets: [{ name: 'ML', updatedAt: '2026-11-02T12:05:00Z', odds: [{ home: '1.50', away: '2.70' }] }] })) });
  f.seed([{ id: 8, urls: { Bet105: 'u8', 'Napoleon Sports BE': 'n8' }, bookmakers: {
    Bet105: [{ name: 'ML', updatedAt: '2026-11-02T12:00:00Z', odds: [{ home: '1.40', away: '2.90' }] }],
    'Napoleon Sports BE': [{ name: 'ML', updatedAt: '2026-11-02T12:00:00Z', odds: [{ home: '1.45', away: '2.80' }] }] } }], 2);
  assert.equal(f.quote(8, 'Bet105').home, 1.5, 'the streamed price is newer (mutant: seed overwrites)'); assert.equal(f.quote(8, 'Napoleon'), null, 'a seeded Napoleon price is not kept');
});

// a world: one Kalshi × Polymarket pair (Molcan / Droguet) + odds-api.io events
const world = (oddsList) => {
  const poly = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet', { slug: 'atp-molcan-droguet' })]);
  const kal = kalshiMatches([km('K1', 'Titouan Droguet', 0.5, 50, 0.6), km('K1', 'Alex Molcan', 0.6, 50, 0.5)]);
  return { poly, kal, ms: unify(poly, kal, oddsEvents(oddsList)) };
};
test('unify: an odds-api.io event joins the pair by both names either way round, within 36 h; ambiguity or no match → nothing', () => {
  let { ms } = world([oev(9, 'Droguet, Titouan', 'Molcan, Alex')]);
  assert.equal(ms.length, 1); assert.equal(ms[0].odds.aHome, false, 'home is Droguet = player B'); assert.ok(ms[0].pm && ms[0].km); assert.equal(ms[0].key, 'b:9');
  assert.equal(world([oev(9, 'Droguet, Titouan', 'Molcan, Alex'), oev(10, 'Molcan, Alex', 'Droguet, Titouan')]).ms.length, 0, 'two events fit → none (mutant: first wins)');
  assert.equal(world([oev(9, 'Droguet, Titouan', 'Molcan, Alex', 'ATP - Paris, France', 'pending', '2026-11-05T12:00:00Z')]).ms.length, 0, 'a rematch days later is another match');
  assert.equal(world([oev(9, 'Droguet, Adam', 'Molcan, Alex')]).ms.length, 0, 'another initial refused');
});

test('evaluateMulti: every direction with a bookmaker leg after fees; Kalshi × Polymarket left to its own path; sizes from the prediction leg', () => {
  const { ms } = world([oev(9, 'Molcan, Alex', 'Droguet, Titouan')]); const m = ms[0];
  const b = new Books(); b.snapshot('1A', [{ price: '0.45', size: '400' }], 1000); b.snapshot('1B', [{ price: '0.56', size: '300' }], 1000);
  OW.all = []; const f = new BookFeed({ WS: OW, key: 'K', now: () => 1000 }); f.open();
  OW.all[0].onmessage({ data: JSON.stringify(upd(9, 'Bet105', '1.60', '2.40')) });   // Bet105: Molcan 1.60, Droguet 2.40
  const Q = venueQuotes(m, { books: b, kalAt: 1000, bfeed: f, now: 2000 });
  assert.deepEqual(Object.keys(Q).sort(), ['Bet105', 'Kalshi', 'Polymarket']);
  const ev2 = evaluateMulti(m, Q); const dirs = ev2.map((e) => e.dir).sort();
  assert.ok(!dirs.some((d) => d.includes('Polymarket') && d.includes('Kalshi')), 'no Kalshi × Polymarket here (mutant: double-counted)');
  const pb = ev2.find((e) => e.dir === 'Polymarket:A+Bet105:B');
  const cost = 0.45 + 0.05 * 0.45 * 0.55 + 1 / 2.4;
  assert.equal(pb.cost, +cost.toFixed(5)); assert.equal(pb.edge, +((1 / cost - 1) * 100).toFixed(3)); assert.ok(pb.edge > 0);
  assert.equal(pb.contracts, 400, 'Polymarket shares cap it; the book publishes no limit'); assert.equal(pb.legs[1].url, 'https://x/9');
  const g = multiGapRow(m, pb, { inPlay: true, started: true, board: { phase: 'game', score: '6–4 2–1', status: 'Set 2' } });
  assert.equal(g.mkey, 'KXATPMATCH-K1'); assert.equal(g.atp, true); assert.equal(g.hasPm, true); assert.equal(g.legs.length, 2);
  assert.equal(g.legs[0].venue, 'Polymarket'); assert.equal(g.legs[0].url, 'https://polymarket.com/event/atp-molcan-droguet'); assert.equal(g.legs[1].venue, 'Bet105'); assert.equal(g.legs[1].dec, 2.4);
  assert.equal(+(g.legs[0].stake + g.legs[1].stake).toFixed(1), +g.stake.toFixed(1)); assert.equal(g.phase, 'game');
  const stale = venueQuotes(m, { books: b, kalAt: 1000, bfeed: f, now: 1000 + STALE_MS.book + 1 });
  assert.ok(!stale.Bet105, 'a book price older than STALE_MS.book is not used');
  const U = Date.parse('2026-11-02T12:00:00Z'), live = { ...m, odds: { ...m.odds, live: true } };
  const f2 = new BookFeed({ WS: OW, key: 'K', now: () => U + 600e3 }); OW.all = []; f2.open(); OW.all[0].onmessage({ data: JSON.stringify(upd(9, 'Bet105', '1.60', '2.40')) });
  assert.ok(!venueQuotes(live, { books: b, kalAt: null, bfeed: f2, now: U + 600e3 + 1000 }).Bet105, 'in play, a pre-match price received now but set 10 min ago by the book is not used (mutant: receive time only)');
  assert.ok(venueQuotes({ ...m, odds: { ...m.odds, live: false, start: null } }, { books: b, kalAt: null, bfeed: f2, now: U + 600e3 + 1000 }).Bet105, 'pre-match the same price stands');
  const f3 = new BookFeed({ WS: OW, key: 'K', now: () => U + 30e3 }); OW.all = []; f3.open(); OW.all[0].onmessage({ data: JSON.stringify(upd(9, 'Bet105', '1.60', '2.40')) });
  assert.ok(venueQuotes(live, { books: b, kalAt: null, bfeed: f3, now: U + 31e3 }).Bet105, 'in play, a price the book set 31 s ago is used');
});

test('evaluateMulti: a Napoleon price never forms a gap (founder 2026-11-09: Bet105, Polymarket, Kalshi only)', () => {
  const { ms } = world([oev(9, 'Molcan, Alex', 'Droguet, Titouan')]); const m = { ...ms[0], pm: null, km: null };
  OW.all = []; const f = new BookFeed({ WS: OW, key: 'K', now: () => 1000 }); f.open();
  OW.all[0].onmessage({ data: JSON.stringify(upd(9, 'Bet105', '2.20', '1.70')) }); OW.all[0].onmessage({ data: JSON.stringify(upd(9, 'Napoleon Sports BE', '1.62', '2.35')) });
  const Q = venueQuotes(m, { books: new Books(), kalAt: null, bfeed: f, now: 1500 });
  assert.deepEqual(Object.keys(Q), ['Bet105']); assert.equal(evaluateMulti(m, Q).length, 0, '1/2.20 + 1/2.35 < 1 but Napoleon is out (mutant: Napoleon kept)');
});

test('Kalshi × Polymarket rows carry the same legs (venue, price, after fee, stake, link) for the alert and the page', () => {
  const { p, b } = pair(0.45, 0.48);
  const e = evaluate(p, b, 1000, 2000).find((x) => x.dir === 'polyA+kalshiB');
  const g = gapRow(p, e, { inPlay: true, started: true, polyAt: 1000, kalAt: 1000 });
  assert.deepEqual(g.legs.map((l) => l.venue), ['Polymarket', 'Kalshi']); assert.equal(g.legs[0].dec, g.polyDec); assert.equal(g.legs[1].eff, g.kalEff);
  assert.equal(g.legs[0].stake, g.polyStake); assert.equal(g.legs[1].url, 'https://kalshi.com/markets/kxatpmatch/atp-tennis-match/kxatpmatch-k1'); assert.equal(g.mkey, 'KXATPMATCH-K1');
});
