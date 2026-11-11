// Live arbitrage recorder (tools/live-arb-recorder.mjs): name join, fees, Polymarket book upkeep, the two directions,
// stale legs and episodes. Each check names the mutation it catches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify, constants as CC } from 'node:crypto';
import { samePlayer, polyMatches, kalshiMatches, joinPairs, kalshiFee, polyFee, Books, evaluate, Episodes, summarise, gapRow, PolyFeed, KalshiFeed, kalshiSign, boardPhase, boardFixture, setText, recRows,
  kiblNames, kiblFixtures, kiblRows, kiblQuotes, KiblFeed, kiblLiveQuotes, gapChecks, CHECK_MAX_MS, KIBL_GAP_MS, KIBL_LIVE_MAX_MS, KIBL_LIVE_ROW_MAX_MS, KIBL_STREAM_HB_MAX_MS, KIBL_STREAM_LAG_MAX_MS, KIBL_STREAM_POS_MAX_MS, kiblStreamCheck, BOOK_LINK_HOME, unify, venueQuotes, evaluateMulti, multiGapRow, STALE_MS, BOOKS } from './live-arb-recorder.mjs';
import { readFileSync } from 'node:fs';

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

// ---------- Bet105 via Kibl (founder 2026-11-10: Kibl for the arbitrage, odds-api.io out) ----------
// a Kibl match-winner participant row (field names as kibl_client.py / kibl-stream read them)
const kr = (fid, fp, price, bt = 3, extra = {}) => ({ fixture_id: fid, fixture_participant_id: fp, market_type_id: 1, segment_id: 1, side_id: fp % 2,
  betting_type_id: bt, feed_source_id: 171, is_current: true, is_opener: false, price_decimal: price, inserted_on: '2026-11-10T10:00:00Z', ...extra });
const kfx = (id, name, start = '2026-11-02T12:00:00Z') => ({ fixture_id: id, name, start_time: start, league_id: 19 });

test('Kibl names and fixtures: rotation number dropped, feed order kept; doubles and odd names refused', () => {
  assert.deepEqual(kiblNames('6112 Soonwoo Kwon vs Alex Molcan'), ['Soonwoo Kwon', 'Alex Molcan']);
  assert.equal(kiblNames('A/B vs C/D'), null, 'doubles (mutant: kept)'); assert.equal(kiblNames('Davis Cup'), null); assert.equal(kiblNames('A vs B vs C'), null);
  const f = kiblFixtures([kfx(9, 'Alex Molcan vs Titouan Droguet'), kfx(10, 'X/Y vs Z/W'), { name: 'no id vs here' }]);
  assert.deepEqual(f.map((x) => [x.id, x.a, x.b]), [['9', 'Alex Molcan', 'Titouan Droguet']]); assert.equal(f[0].start, Date.parse('2026-11-02T12:00:00Z'));
});

test('Kibl prices: match winner, full match, the asked betting type, Bet105 only; current over opener; sides by participant id', () => {
  const rows = [kr(9, 202, 2.4), kr(9, 101, 1.6),
    kr(9, 101, 1.9, 3, { is_current: false, is_opener: true }), kr(9, 202, 9, 3, { market_type_id: 2 }), kr(9, 202, 9, 3, { segment_id: 2 }),
    kr(9, 202, 9, 1), kr(9, 202, 9, 3, { feed_source_id: 43 }), kr(9, 101, 1.55, 3, { inserted_on: '2026-11-10T09:59:00Z' })];
  const q = kiblQuotes(rows, 3).get('9');
  assert.deepEqual([q.home, q.away], [1.6, 2.4], 'the lower participant id is the first-named player (mutant: row order)');
  assert.equal(q.upd, Date.parse('2026-11-10T10:00:00Z'));
  assert.equal(kiblQuotes([kr(9, 101, 1.9, 3, { is_current: false, is_opener: true }), kr(9, 202, 2.0, 3, { is_current: false, is_opener: true })], 3).get('9').home, 1.9, 'an unmoved line is listed as its opener');
  assert.equal(kiblQuotes([kr(9, 101, 0, 3), kr(9, 202, 2.4)], 3).size, 0, "Kibl's 0.000 suspension marker = no price (mutant: kept)");
  assert.equal(kiblQuotes([kr(9, 101, 1.6)], 3).size, 0, 'one side only = no price');
  assert.equal(kiblQuotes([kr(9, 101, 2.2), kr(9, 202, 2.2)], 3).size, 0, 'paying over 101% is no price');
  assert.equal(kiblQuotes(rows, 1).get('9'), undefined, 'a pre-match row never answers for in play');
  const nested = kiblRows({ result: [{ fixture_id: 9, market_type_id: 1, segment_id: 1, betting_type_id: 3, participants: [
    { fixture_participant_id: 101, side_id: 1, price_decimal: 1.6, is_current: true, inserted_on: '2026-11-10T10:00:00Z' },
    { fixture_participant_id: 202, side_id: 2, price_decimal: 2.4, is_current: true, inserted_on: '2026-11-10T10:00:00Z' }] }] });
  assert.equal(nested.length, 2); assert.equal(kiblQuotes(nested, 3).get('9').away, 2.4, 'nested rows take the fixture and market from their parent');
});

// a fake Kibl: login, fixtures, markets by betting type; the stream worker's table + heartbeat; a fake clock
const lr = (fid, fp, price, ago = 5e3, extra = {}) => (t) => ({ fixture_id: fid, fixture_participant_id: fp, price, market_status_id: 1,
  kibl_inserted_on: new Date(t - ago).toISOString(), ...extra });
// the stream worker's position row (fixture 0): lag = how far behind Kibl, age = how old the row is
const posRow = ({ lag = 1e3, age = 1e3 } = {}) => (t) => ({ fixture_id: 0, fixture_participant_id: 0, price: null, market_status_id: null,
  kibl_inserted_on: new Date(t - age - lag).toISOString(), received_at: new Date(t - age).toISOString() });
function fakeKibl({ live = [], pre = [], fx = [kfx(9, 'Alex Molcan vs Titouan Droguet')], beat = { connected: true, ago: 10e3 }, pos = {} } = {}) {
  const calls = [], reads = []; let t = Date.parse('2026-11-10T12:00:00Z');
  const f = async (u, o) => {
    const url = new URL(String(u)); calls.push({ at: t, path: url.pathname, q: Object.fromEntries(url.searchParams), auth: o.headers && o.headers.Authorization, body: o.body });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (String(u).includes('cognito')) return ok({ AuthenticationResult: { AccessToken: 'T' + calls.filter((c) => c.body).length, ExpiresIn: 3600 } });
    const bt = url.searchParams.get('betting_type_id');
    if (url.pathname.endsWith('/info/fixtures')) return ok({ result: fx });
    return ok({ result: bt === '3' ? [] : pre });   // measured 10 Nov: REST never has an in-play row
  };
  const K = { calls, reads, tick: (ms) => { t += ms; }, now: () => t, live, beat, pos };
  K.feed = new KiblFeed({ fetch: f, user: 'u', pass: 'p', now: () => t, sleep: async (ms) => { t += ms; },
    liveRows: async (since) => { reads.push(since); return [...K.live, ...(K.pos ? [posRow(K.pos)] : [])].map((g) => g(t)); },
    streamBeat: async () => (K.beat ? { connected: K.beat.connected, at: t - K.beat.ago } : null) });
  return K;
}

test('Kibl in-play rows from the stream table: both sides open, priced and recent; suspended, closed, stale or one-sided → no price', () => {
  const t = Date.parse('2026-11-10T12:00:00Z'), g = (...a) => lr(...a)(t);
  const q = kiblLiveQuotes([g(9, 202, 2.4), g(9, 101, 1.6, 8e3)], t).get('9');
  assert.deepEqual([q.home, q.away], [1.6, 2.4], 'the lower participant id is the first-named player (mutant: row order)'); assert.equal(q.upd, t - 5e3);
  assert.equal(kiblLiveQuotes([g(9, 101, 0), g(9, 202, 2.4)], t).size, 0, 'a 0 price = suspended (mutant: kept)');
  assert.equal(kiblLiveQuotes([g(9, 101, 1.6, 5e3, { market_status_id: 2 }), g(9, 202, 2.4)], t).size, 0, 'a market not open = no price (mutant: status ignored)');
  assert.equal(kiblLiveQuotes([g(9, 101, 1.6, KIBL_LIVE_ROW_MAX_MS + 1), g(9, 202, 2.4)], t).size, 0, 'a side not re-priced for 10 min = no price (mutant: no age limit)');
  assert.equal(kiblLiveQuotes([g(9, 101, 1.6)], t).size, 0, 'one side only'); assert.equal(kiblLiveQuotes([g(9, 101, 2.2), g(9, 202, 2.2)], t).size, 0, 'over 101%');
});

test('Kibl in-play: only while the stream worker is current (founder 2026-11-12: both 11 Nov signals priced Bet105 from its ~2 min backlog)', async () => {
  const t = Date.parse('2026-11-11T14:21:10Z'), P = (o) => posRow(o)(t);
  assert.equal(kiblStreamCheck([P({ lag: 1e3, age: 1e3 })], t).ok, true);
  const b = kiblStreamCheck([P({ lag: 104e3, age: 1e3 })], t);
  assert.equal(b.ok, false, '104 s behind Kibl (Sonego v Tabilo) → no in-play price (mutant: lag ignored)'); assert.equal(b.lagMs, 104e3); assert.match(b.why, /104 s behind/);
  assert.equal(kiblStreamCheck([P({ lag: KIBL_STREAM_LAG_MAX_MS + 1, age: 0 })], t).ok, false, 'just over the lag limit');
  assert.equal(kiblStreamCheck([P({ lag: 0, age: KIBL_STREAM_POS_MAX_MS + 1 })], t).ok, false, 'a position row the worker stopped writing (mutant: age ignored)');
  assert.equal(kiblStreamCheck([], t).ok, false, 'no position row → not current');
  assert.equal(kiblLiveQuotes([P({}), lr(9, 101, 1.6)(t), lr(9, 202, 2.4)(t)], t).size, 1, 'the position row is never a fixture');
  const K = fakeKibl({ live: [lr(9, 101, 1.6), lr(9, 202, 2.4)], pre: [kr(9, 101, 1.8, 1), kr(9, 202, 2.0, 1)], pos: { lag: 104e3, age: 1e3 } });
  await K.feed.cycle();
  assert.equal(K.feed.quote(9, 'Bet105').live, false, 'the feed takes no in-play price from a stream that is behind (mutant: check not wired)');
  assert.equal(K.feed.stats.streamBehind, 1); assert.equal(K.feed.stats.streamLagMs, 104e3, 'the lag is in the worker stats');
  K.pos = { lag: 1e3, age: 1e3 }; K.tick(2000); await K.feed.cycle();
  assert.equal(K.feed.quote(9, 'Bet105').home, 1.6, 'CONTROL: current again → the in-play price is back');
  const N = fakeKibl({ live: [lr(9, 101, 1.6), lr(9, 202, 2.4)], pos: null }); await N.feed.cycle();
  assert.equal(N.feed.quote(9, 'Bet105'), null, 'an old worker that writes no position → no in-play price');
  const src = readFileSync(new URL('./live-arb-recorder.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('kibl_inserted_on,received_at&kibl_inserted_on=gt.'), 'the table read asks for received_at');
});

test('Kibl feed: one login, Bearer on every REST call, ≥ 1.3 s between REST calls; in play from the stream table every cycle, never REST; pre-match every 30th', async () => {
  const K = fakeKibl({ live: [lr(9, 101, 1.6), lr(9, 202, 2.4)], pre: [kr(9, 101, 1.8, 1), kr(9, 202, 2.0, 1)] });
  for (let i = 0; i < 31; i++) { await K.feed.cycle(); K.tick(1000); }
  const api = K.calls.filter((c) => !c.body), logins = K.calls.filter((c) => c.body);
  assert.equal(logins.length, 1, 'one login for the run (mutant: login per call)'); assert.equal(JSON.parse(logins[0].body).AuthFlow, 'USER_PASSWORD_AUTH');
  assert.ok(api.every((c) => c.auth === 'Bearer T1'));
  for (let i = 1; i < api.length; i++) assert.ok(api[i].at - api[i - 1].at >= KIBL_GAP_MS, 'paced (mutant: no pause)');
  const mk = api.filter((c) => c.path.endsWith('/info/markets'));
  assert.equal(mk.filter((c) => c.q.betting_type_id === '3').length, 0, 'never asks REST for in-play (it has none)');
  assert.equal(K.reads.length, 31, 'the stream table is read every cycle');
  assert.equal(mk.filter((c) => c.q.betting_type_id === '1').length, 2, 'pre-match every KIBL_PRE_EVERY cycles');
  assert.ok(mk.every((c) => c.q.league_id === '19' && c.q.feed_source_id === '171'), 'ATP league, Bet105 feed only');
  assert.equal(api.filter((c) => c.path.endsWith('/info/fixtures')).length, 1, 'fixtures every 5 min, not every cycle');
});

test('Kibl feed: in play only the in-play price, while fresh and while the stream worker is connected', async () => {
  const K = fakeKibl({ live: [lr(9, 101, 1.6), lr(9, 202, 2.4)], pre: [kr(9, 101, 1.8, 1), kr(9, 202, 2.0, 1), kr(8, 303, 1.5, 1), kr(8, 404, 2.6, 1)],
    fx: [kfx(9, 'Alex Molcan vs Titouan Droguet'), kfx(8, 'Ben Shelton vs Carlos Alcaraz')] });
  await K.feed.cycle();
  const q9 = K.feed.quote(9, 'Bet105'); assert.equal(q9.live, true); assert.equal(q9.home, 1.6, 'in play the in-play price wins (mutant: pre-match)');
  assert.equal(K.feed.quote(8, 'Bet105').live, false); assert.equal(K.feed.quote(8, 'Bet105').home, 1.5);
  assert.equal(K.feed.quote(9, 'Napoleon'), null);
  assert.deepEqual(K.feed.events().map((e) => [e.id, e.live]), [['9', true], ['8', false]]);
  K.tick(KIBL_LIVE_MAX_MS + 1); assert.equal(K.feed.quote(9, 'Bet105'), null, 'an in-play price from an old read is never used (mutant: kept)');
  assert.equal(K.feed.events()[0].live, false);
  const D = fakeKibl({ live: [lr(9, 101, 1.6), lr(9, 202, 2.4)], pre: [kr(9, 101, 1.8, 1), kr(9, 202, 2.0, 1)], beat: { connected: false, ago: 5e3 } });
  await D.feed.cycle(); assert.equal(D.feed.quote(9, 'Bet105').live, false, 'stream worker disconnected → its table is not trusted (mutant: heartbeat ignored)');
  const S = fakeKibl({ live: [lr(9, 101, 1.6), lr(9, 202, 2.4)], beat: { connected: true, ago: KIBL_STREAM_HB_MAX_MS + 1 } });
  await S.feed.cycle(); assert.equal(S.feed.quote(9, 'Bet105'), null, 'stream heartbeat too old → no in-play price');
  const F = fakeKibl({ live: [lr(9, 101, 1.6), lr(9, 202, 2.4)], pre: [kr(9, 101, 1.8, 1), kr(9, 202, 2.0, 1)] });
  await F.feed.cycle(); F.tick(2000); F.feed.liveRows = async () => { throw new Error('HTTP 500'); };
  await F.feed.cycle(); assert.equal(F.feed.quote(9, 'Bet105').live, false, 'a failed read leaves no in-play price (mutant: last one kept)');
  const A = fakeKibl({ pre: [kr(9, 101, 1.8, 1), kr(9, 202, 2.0, 1)] }); let n401 = 1;
  A.feed.f = (orig => async (u, o) => (!String(u).includes('cognito') && n401-- > 0 ? { ok: false, status: 401, json: async () => ({}) } : orig(u, o)))(A.feed.f);
  await A.feed.cycle(); assert.equal(A.calls.filter((c) => c.body).length, 2, 'a 401 logs in again once'); assert.equal(A.feed.quote(9, 'Bet105').home, 1.8);
});

// a world: one Kalshi × Polymarket pair (Molcan / Droguet) + Kibl fixtures
const world = (fx) => {
  const poly = polyMatches([ev('1', 'Alex Molcan', 'Titouan Droguet', { slug: 'atp-molcan-droguet' })]);
  const kal = kalshiMatches([km('K1', 'Titouan Droguet', 0.5, 50, 0.6), km('K1', 'Alex Molcan', 0.6, 50, 0.5)]);
  return { poly, kal, ms: unify(poly, kal, kiblFixtures(fx)) };
};
test('unify: a Kibl fixture joins the pair by both names either way round, within 36 h; ambiguity or no match → nothing', () => {
  let { ms } = world([kfx(9, 'Titouan Droguet vs Alex Molcan')]);
  assert.equal(ms.length, 1); assert.equal(ms[0].odds.aHome, false, 'first-named is Droguet = player B'); assert.ok(ms[0].pm && ms[0].km); assert.equal(ms[0].key, 'b:9');
  assert.equal(world([kfx(9, 'Titouan Droguet vs Alex Molcan'), kfx(10, 'Alex Molcan vs Titouan Droguet')]).ms.length, 0, 'two fixtures fit → none (mutant: first wins)');
  assert.equal(world([kfx(9, 'Titouan Droguet vs Alex Molcan', '2026-11-05T12:00:00Z')]).ms.length, 0, 'a rematch days later is another match');
  assert.equal(world([kfx(9, 'Adam Droguet vs Alex Molcan')]).ms.length, 0, 'another initial refused');
});

// a stub feed with the KiblFeed quote shape
const stubFeed = (q) => ({ quote: (id, venue) => (venue === 'Bet105' && q ? { url: BOOK_LINK_HOME.Bet105, max: null, ...q } : null) });

test('evaluateMulti: every direction with a Bet105 leg after fees; Kalshi × Polymarket left to its own path; sizes from the prediction leg', () => {
  const { ms } = world([kfx(9, 'Alex Molcan vs Titouan Droguet')]); const m = ms[0];
  const b = new Books(); b.snapshot('1A', [{ price: '0.45', size: '400' }], 1000); b.snapshot('1B', [{ price: '0.56', size: '300' }], 1000);
  const f = stubFeed({ home: 1.6, away: 2.4, at: 1000, upd: 1000, live: false });   // Bet105: Molcan 1.60, Droguet 2.40
  const Q = venueQuotes({ ...m, odds: { ...m.odds, start: null } }, { books: b, kalAt: 1000, bfeed: f, now: 2000 });
  assert.deepEqual(Object.keys(Q).sort(), ['Bet105', 'Kalshi', 'Polymarket']);
  const ev2 = evaluateMulti(m, Q); const dirs = ev2.map((e) => e.dir).sort();
  assert.ok(!dirs.some((d) => d.includes('Polymarket') && d.includes('Kalshi')), 'no Kalshi × Polymarket here (mutant: double-counted)');
  const pb = ev2.find((e) => e.dir === 'Polymarket:A+Bet105:B');
  const cost = 0.45 + 0.05 * 0.45 * 0.55 + 1 / 2.4;
  assert.equal(pb.cost, +cost.toFixed(5)); assert.equal(pb.edge, +((1 / cost - 1) * 100).toFixed(3)); assert.ok(pb.edge > 0);
  assert.equal(pb.contracts, 400, 'Polymarket shares cap it; the book publishes no limit'); assert.equal(pb.legs[1].url, 'https://app.bet105.ag');
  const g = multiGapRow(m, pb, { inPlay: true, started: true, board: { phase: 'game', score: '6–4 2–1', status: 'Set 2' } });
  assert.equal(g.mkey, 'KXATPMATCH-K1'); assert.equal(g.atp, true); assert.equal(g.hasPm, true); assert.equal(g.legs.length, 2);
  assert.equal(g.legs[0].venue, 'Polymarket'); assert.equal(g.legs[1].venue, 'Bet105'); assert.equal(g.legs[1].dec, 2.4);
  assert.equal(+(g.legs[0].stake + g.legs[1].stake).toFixed(1), +g.stake.toFixed(1)); assert.equal(g.phase, 'game');
  assert.equal(multiGapRow({ ...m, km: null }, pb, { inPlay: false, started: false, board: null }).mkey, 'kibl:9');
  assert.ok(!venueQuotes(m, { books: b, kalAt: 1000, bfeed: stubFeed({ home: 1.6, away: 2.4, at: 1000, live: false }), now: 1000 + STALE_MS.book + 1 }).Bet105, 'a book price older than STALE_MS.book is not used');
  const live = { ...m, odds: { ...m.odds, live: false } };   // pm start 12:00Z has passed at U
  const U = Date.parse('2026-11-02T12:10:00Z');
  assert.ok(!venueQuotes(live, { books: b, kalAt: null, bfeed: stubFeed({ home: 1.6, away: 2.4, at: U, live: false }), now: U }).Bet105,
    'after the start a pre-match price is never paired with live prediction prices (mutant: used)');
  assert.ok(venueQuotes(live, { books: b, kalAt: null, bfeed: stubFeed({ home: 1.6, away: 2.4, at: U, live: true }), now: U }).Bet105, 'in play the in-play price is used');
});

test('odds-api.io is gone from live arbitrage: no odds-api.io call or key; the workflow passes the Kibl login', () => {
  const src = readFileSync(new URL('./live-arb-recorder.mjs', import.meta.url), 'utf8');
  assert.ok(!/api\.odds-api\.io|ODDS_API_IO_KEY|BookFeed/.test(src), 'no odds-api.io code path left (mutant: odds-api.io feed kept)');
  assert.deepEqual(Object.values(BOOKS), ['Bet105'], 'arbitrage = Bet105 × Polymarket × Kalshi only');
  const wf = readFileSync(new URL('../.github/workflows/live-arb.yml', import.meta.url), 'utf8');
  assert.ok(!/ODDS_API_IO_KEY/.test(wf)); for (const k of ['KIBL_USERNAME', 'KIBL_PASSWORD']) assert.ok(wf.includes('secrets.' + k), k);
});

test('Kalshi × Polymarket rows carry the same legs (venue, price, after fee, stake, link) for the alert and the page', () => {
  const { p, b } = pair(0.45, 0.48);
  const e = evaluate(p, b, 1000, 2000).find((x) => x.dir === 'polyA+kalshiB');
  const g = gapRow(p, e, { inPlay: true, started: true, polyAt: 1000, kalAt: 1000 });
  assert.deepEqual(g.legs.map((l) => l.venue), ['Polymarket', 'Kalshi']); assert.equal(g.legs[0].dec, g.polyDec); assert.equal(g.legs[1].eff, g.kalEff);
  assert.equal(g.legs[0].stake, g.polyStake); assert.equal(g.legs[1].url, 'https://kalshi.com/markets/kxatpmatch/atp-tennis-match/kxatpmatch-k1'); assert.equal(g.mkey, 'KXATPMATCH-K1');
});

// ---------- founder 2026-11-10: every price in a signal is true at the moment it is sent ----------
test('every leg carries when its venue set the price and when we checked it; Bet105 per side', () => {
  const t = Date.parse('2026-11-10T15:43:38Z'), g = (...a) => lr(...a)(t);
  const q = kiblLiveQuotes([g(9, 101, 1.6, 2e3), g(9, 202, 2.4, 9e3)], t).get('9');
  assert.equal(q.hUpd, t - 2e3); assert.equal(q.aUpd, t - 9e3, 'each side keeps its own set time (mutant: one time for both)');
  const { ms } = world([kfx(9, 'Titouan Droguet vs Alex Molcan')]); const m = ms[0];   // first-named Droguet = home = player B
  const b = new Books(); b.snapshot('1A', [{ price: '0.45', size: '400' }], t - 30e3); b.snapshot('1B', [{ price: '0.56', size: '300' }], t - 30e3);
  const Q = venueQuotes({ ...m, odds: { ...m.odds, start: null } }, { books: b, kalAt: null, now: t,
    bfeed: stubFeed({ home: 2.4, away: 1.6, at: t - 500, hUpd: t - 9e3, aUpd: t - 2e3, live: false }) });
  assert.equal(Q.Bet105.A.dec, 1.6); assert.equal(Q.Bet105.A.setAt, t - 2e3, 'player A (Molcan, away) takes the away set time (mutant: sides crossed)');
  assert.equal(Q.Bet105.B.setAt, t - 9e3); assert.equal(Q.Bet105.A.checkedAt, t - 500, 'checked = our read of the stream table');
  assert.equal(Q.Polymarket.A.checkedAt, t, 'a Polymarket order on the live websocket book is checked now'); assert.equal(Q.Polymarket.A.setAt, t - 30e3);
  const e = evaluateMulti(m, Q).find((x) => x.dir === 'Polymarket:A+Bet105:B');
  const row = multiGapRow(m, e, { inPlay: true, started: true, board: { phase: 'game', score: '6–4 2–1', status: 'Set 2' } });
  assert.equal(row.legs[1].setAt, new Date(t - 9e3).toISOString()); assert.equal(row.legs[1].checkedAt, new Date(t - 500).toISOString());
});

test('gapChecks: sent only when every leg was checked in the last 3 s and the bookmaker set its price after the latest score change', () => {
  const t = Date.parse('2026-11-10T15:43:38Z'), I = (ms) => new Date(t + ms).toISOString();
  const row = (o = {}) => ({ computedAt: I(0), scoreAt: I(-20e3), legs: [
    { venue: 'Bet105', group: 'book', setAt: I(-5e3), checkedAt: I(-800) },
    { venue: 'Polymarket', group: 'prediction', setAt: I(-60e3), checkedAt: I(0) }], ...o });
  assert.deepEqual(gapChecks(row(), t), [], 'true clocks pass');
  assert.deepEqual(gapChecks(row({ scoreAt: I(-2e3) }), t), ['Bet105 set its price before the latest score change'],
    'the Rinderknech set break case: Bet105 set 5 s ago but the score changed 2 s ago (mutant: no score rule)');
  const stale = row(); stale.legs[0].checkedAt = I(-(CHECK_MAX_MS + 1));
  assert.deepEqual(gapChecks(stale, t), ['Bet105 not checked in the last 3 s'], 'mutant: no read-age rule');
  assert.deepEqual(gapChecks(row({ scoreAt: null }), t), ['score time unknown']);
  const noSet = row(); noSet.legs[0].setAt = null; assert.deepEqual(gapChecks(noSet, t), ['Bet105 set time unknown']);
  assert.deepEqual(gapChecks(row(), t + 6e3), ['computed too long ago']);
  const pmOld = row(); pmOld.legs[1].setAt = I(-3600e3); assert.deepEqual(gapChecks(pmOld, t), [], 'a resting prediction-market order is fillable whatever its age');
});

test('the push re-evaluates the books at that moment, every 3 s, and stamps computed / score times + the checks', () => {
  const src = readFileSync(new URL('./live-arb-recorder.mjs', import.meta.url), 'utf8');
  const push = src.slice(src.indexOf('const doPush = async'), src.indexOf("const body = JSON.stringify({ p: { gaps"));
  assert.ok(/const now = Date\.now\(\); tick\(now\);/.test(push), 'tick(now) before any row is built (mutant: an older evaluation pushed)');
  assert.ok(push.includes('g.computedAt = computedAt; g.scoreAt = scoreAtOf(key, bd); g.checks = gapChecks(g, now);'));
  assert.ok(src.includes('setInterval(doPush, 3e3)'), 'pushed every 3 s');
  assert.ok(/scoreSeen\.set\(key, \{ score: bd\.score, at: boardAt \}\)/.test(src), 'score time = the board snapshot the new score first appeared in');
});
