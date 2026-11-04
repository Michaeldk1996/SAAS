#!/usr/bin/env node
// Live arbitrage recorder, Kalshi × Polymarket, ATP match winner (founder 2026-11-02: "Let's go!" — measure first).
// Reads only public endpoints, writes nothing anywhere but its own output folder:
//   Polymarket  Gamma events (series 10365, moneyline market) every 60 s for the match list + live flag;
//               the CLOB market websocket for every book change (best ask + size at it, per player token).
//   Kalshi      GET /markets?series_ticker=KXATPMATCH&status=open every POLL_S s: each player market's YES ask
//               and size at it (yes_ask_dollars / yes_ask_size_fp) and its NO ask (= backing the other player).
// ATP only (founder 2026-11-02): Kalshi's ATP tour series KXATPMATCH (its Challengers are a separate series,
// KXATPCHALLENGERMATCH, never read); a Polymarket match is evaluated only when it joins a KXATPMATCH event.
// A pair is joined only when both players' names agree and exactly one match fits on each side (never a guess).
// An arbitrage = back player X on one market and his opponent on the other for less than $1 per $1 paid out,
// after taker fees: Kalshi 0.07·q·(1−q), Polymarket 0.05·p·(1−p) (the arb engine's constants, tools/arb-engine.sql).
// Each episode (one match, one direction, edge > 0 continuously, both legs fresh) is written with its start, end,
// duration, best edge, contracts available at that moment and whether Polymarket marked the match live.
// Output: <out>/episodes.jsonl, <out>/summary.json. Usage: node tools/live-arb-recorder.mjs --minutes 330 --out dir [--push 1]
// --push 1 (live-arb.yml): every 5 s the current positive gaps + a heartbeat go to public.arb_live_push (Supabase, service
// role), which feeds Dropping Odds → Arbitrage → Live and posts ⚡ LIVE ARB to the drop chat (rules there, tools/arb-engine.sql).
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { createSign, constants as CC } from 'node:crypto';

export const GAMMA = 'https://gamma-api.polymarket.com';
export const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
export const POLY_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
export const KALSHI_WS = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
export const FEE = { kalshi: 0.07, poly: 0.05 };
export const STALE_MS = { kalshi: 8000, poly: 120000 };   // Kalshi is polled (2 s); a Polymarket book only changes on an order

export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const surname = (s) => { const w = fold(s).split(' '); return w[w.length - 1] || ''; };
// Two spellings of one player: same full folded name, or same surname with first initials that do not clash.
export function samePlayer(a, b) {
  const x = fold(a), y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (surname(x) !== surname(y)) return false;
  return x[0] === y[0];
}

// Polymarket events → open match list. Only the moneyline market, two outcomes, not ended.
export function polyMatches(events) {
  const out = [];
  for (const e of events || []) {
    if (!e || e.ended || e.closed) continue;
    const mk = (e.markets || []).find((m) => m.sportsMarketType === 'moneyline' && !m.closed);
    if (!mk) continue;
    let o, t; try { o = JSON.parse(mk.outcomes || '[]'); t = JSON.parse(mk.clobTokenIds || '[]'); } catch { continue; }
    if (o.length !== 2 || t.length !== 2) continue;
    out.push({ id: String(e.id), title: e.title, a: o[0], b: o[1], tokA: t[0], tokB: t[1], live: e.live === true,
      start: mk.gameStartTime ? Date.parse(String(mk.gameStartTime).replace(' ', 'T').replace(/\+00$/, 'Z')) : null });
  }
  return out;
}

// Kalshi markets → one match per event_ticker with exactly two player markets.
export function kalshiMatches(markets) {
  const by = new Map();
  for (const m of markets || []) {
    if (!m || !m.event_ticker || !m.ticker || !m.yes_sub_title || m.status !== 'active') continue;
    if (!String(m.event_ticker).startsWith('KXATPMATCH-')) continue;   // ATP tour only, never Challenger
    (by.get(m.event_ticker) || by.set(m.event_ticker, []).get(m.event_ticker)).push(m);
  }
  const out = [];
  for (const [ev, ms] of by) {
    if (ms.length !== 2) continue;
    const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
    const side = (m) => ({ name: m.yes_sub_title, ticker: m.ticker, yesAsk: num(m.yes_ask_dollars), yesSize: num(m.yes_ask_size_fp),
      noAsk: num(m.no_ask_dollars) });
    out.push({ ev, p: [side(ms[0]), side(ms[1])] });
  }
  return out;
}

// One-to-one join: a Polymarket match and a Kalshi event pair up only when each is the other's only candidate.
export function joinPairs(poly, kal) {
  const fits = (pm, km) => {
    const [k0, k1] = km.p;
    if (samePlayer(pm.a, k0.name) && samePlayer(pm.b, k1.name)) return { aIs: 0 };
    if (samePlayer(pm.a, k1.name) && samePlayer(pm.b, k0.name)) return { aIs: 1 };
    return null;
  };
  const cand = poly.map((pm) => kal.map((km, j) => [j, fits(pm, km)]).filter(([, f]) => f));
  const used = new Map();
  cand.forEach((c) => c.forEach(([j]) => used.set(j, (used.get(j) || 0) + 1)));
  const out = [];
  poly.forEach((pm, i) => {
    if (cand[i].length !== 1) return;
    const [j, f] = cand[i][0];
    if (used.get(j) !== 1) return;
    out.push({ key: pm.id + '|' + kal[j].ev, pm, km: kal[j], aIs: f.aIs });
  });
  return out;
}

export const kalshiFee = (q) => FEE.kalshi * q * (1 - q);
export const polyFee = (p) => FEE.poly * p * (1 - p);

// Polymarket book per token: price → size for asks; best ask = lowest price with size > 0.
export class Books {
  constructor() { this.asks = new Map(); this.at = new Map(); }
  snapshot(tok, asks, t) { const m = new Map(); for (const l of asks || []) { const s = Number(l.size); if (s > 0) m.set(String(l.price), s); } this.asks.set(tok, m); this.at.set(tok, t); }
  change(tok, side, price, size, t) {
    if (side !== 'SELL') { this.at.set(tok, t); return; }
    const m = this.asks.get(tok) || this.asks.set(tok, new Map()).get(tok);
    const s = Number(size); if (s > 0) m.set(String(price), s); else m.delete(String(price));
    this.at.set(tok, t);
  }
  drop(tok) { this.asks.delete(tok); this.at.delete(tok); }
  best(tok) {
    const m = this.asks.get(tok); if (!m || !m.size) return null;
    let p = Infinity, s = 0; for (const [k, v] of m) { const x = Number(k); if (x < p) { p = x; s = v; } }
    return { price: p, size: s, at: this.at.get(tok) };
  }
}

// Both directions for one joined pair. Kalshi side for a player = the cheaper of his YES ask and his opponent's NO ask
// (the NO size is not on the listing, so a NO leg carries no size and is never sized).
export function evaluate(pair, books, kalAt, now) {
  const out = [];
  if (pair.kalAt != null) kalAt = pair.kalAt;   // the Kalshi websocket's own clock for this pair (KalshiFeed)
  if (kalAt == null || now - kalAt > STALE_MS.kalshi) return out;
  const kSide = (idx) => {
    const me = pair.km.p[idx], other = pair.km.p[1 - idx];
    const legs = [];
    if (me.yesAsk > 0 && me.yesAsk < 1) legs.push({ price: me.yesAsk, size: me.yesSize, how: 'yes ' + me.ticker });
    if (other.noAsk > 0 && other.noAsk < 1) legs.push({ price: other.noAsk, size: other.noSize ?? null, how: 'no ' + other.ticker });
    legs.sort((x, y) => x.price - y.price);
    return legs[0] || null;
  };
  const kA = pair.aIs, kB = 1 - pair.aIs;   // Kalshi index of Polymarket's player a / b
  const dirs = [
    { dir: 'polyA+kalshiB', poly: books.best(pair.pm.tokA), kal: kSide(kB), polyName: pair.pm.a, kalName: pair.pm.b },
    { dir: 'polyB+kalshiA', poly: books.best(pair.pm.tokB), kal: kSide(kA), polyName: pair.pm.b, kalName: pair.pm.a },
  ];
  const pa = books.best(pair.pm.tokA), pb = books.best(pair.pm.tokB);
  if (pa && pb && pa.price + pb.price < 0.98) return out;   // the two asks of one binary market cannot sum under 1 − slack
  for (const d of dirs) {
    if (!d.poly || !d.kal || !(d.poly.price > 0 && d.poly.price < 1)) continue;
    if (d.poly.at == null || now - d.poly.at > STALE_MS.poly) continue;
    const cost = d.poly.price + polyFee(d.poly.price) + d.kal.price + kalshiFee(d.kal.price);
    const edge = (1 / cost - 1) * 100;
    const size = d.kal.size == null ? null : Math.min(d.poly.size, d.kal.size);
    out.push({ dir: d.dir, polyName: d.polyName, kalName: d.kalName, polyAsk: d.poly.price, polySize: d.poly.size,
      kalAsk: d.kal.price, kalSize: d.kal.size, kalLeg: d.kal.how, cost: +cost.toFixed(5), edge: +edge.toFixed(3),
      contracts: size, stake: size == null ? null : +(size * cost).toFixed(2) });
  }
  return out;
}

// Episodes: open while edge > 0 on a direction, close when it is not (or the pair/leg goes away). Pure, testable.
export class Episodes {
  constructor(onClose) { this.open = new Map(); this.onClose = onClose; }
  update(pair, evals, now, live) {
    const seen = new Set();
    for (const e of evals) {
      const k = pair.key + '|' + e.dir;
      if (e.edge <= 0) continue;
      seen.add(k);
      const o = this.open.get(k);
      if (!o) this.open.set(k, { key: k, match: pair.pm.title, kalshiEvent: pair.km.ev, dir: e.dir, start: now, last: now,
        liveAtStart: live, liveAny: live, best: e, ticks: 1, sizedTicks: e.contracts != null ? 1 : 0 });
      else { o.last = now; o.ticks++; o.liveAny = o.liveAny || live; if (e.contracts != null) o.sizedTicks++; if (e.edge > o.best.edge) o.best = e; }
    }
    for (const [k, o] of this.open) if (k.startsWith(pair.key + '|') && !seen.has(k)) this.close(k, now);
  }
  close(k, now) { const o = this.open.get(k); if (!o) return; this.open.delete(k); this.onClose({ ...o, end: now, durationS: +((now - o.start) / 1000).toFixed(1) }); }
  closeAll(now) { for (const k of [...this.open.keys()]) this.close(k, now); }
}

// Polymarket's market websocket for one token list. Only the CURRENT connection reacts to a close: replacing the list
// closes the old socket on purpose and its close is ignored (2 Nov: an old socket's close re-opened the feed every
// ~4 s, 5,166 times in 5.5 h, so books lagged by seconds). An unexpected close of the current socket drops its books
// (no price is ever evaluated from a dead feed) and reconnects after 2 s; the server re-sends a full book on subscribe.
export class PolyFeed {
  constructor({ WS, url, books, stopAt = Infinity, onMessages = () => {}, onDrop = () => {}, now = () => Date.now(), later = (f, ms) => setTimeout(f, ms) }) {
    Object.assign(this, { WS, url, books, stopAt, onMessages, onDrop, now, later }); this.ws = null; this.sig = ''; this.toks = [];
  }
  set(toks) {
    const sig = toks.slice().sort().join(',');
    if (sig === this.sig && this.ws && this.ws.readyState <= 1) return false;
    this.sig = sig; this.toks = toks.slice(); this.open(); return true;
  }
  open() {
    const old = this.ws; this.ws = null; try { old && old.close(); } catch {}
    if (!this.toks.length || this.now() >= this.stopAt) return;
    const me = new this.WS(this.url); this.ws = me;
    me.onopen = () => { if (this.ws === me) me.send(JSON.stringify({ assets_ids: this.toks, type: 'market' })); };
    me.onmessage = (ev) => {
      if (this.ws !== me || ev.data === 'PONG') return;
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      const t = this.now(); let k = 0;
      for (const x of [].concat(d)) {
        k++;
        if (x.event_type === 'book') this.books.snapshot(x.asset_id, x.asks, t);
        else if (x.event_type === 'price_change') for (const c of x.price_changes || []) this.books.change(c.asset_id, c.side, c.price, c.size, t);
      }
      this.onMessages(k, t);
    };
    me.onclose = () => {
      if (this.ws !== me) return;                    // a socket we replaced on purpose
      this.ws = null; for (const t of this.toks) this.books.drop(t); this.onDrop();
      if (this.now() < this.stopAt) this.later(() => { if (!this.ws) this.open(); }, 2000);
    };
    me.onerror = () => {};
  }
  ping() { try { this.ws && this.ws.readyState === 1 && this.ws.send('PING'); } catch {} }
  stop() { this.stopAt = 0; const w = this.ws; this.ws = null; try { w && w.close(); } catch {} }
}

// Kalshi's authenticated market websocket (founder 2026-11-03: "fix this too"). Turned on by the repository secrets
// KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY (an RSA key made on the Kalshi account → API keys); without them the worker polls
// the public list every 2 s as before. Signature = RSA-PSS SHA-256 of timestamp + "GET" + "/trade-api/ws/v2" (Kalshi docs).
// Channel orderbook_delta: a snapshot then deltas of the YES and NO bid books per market. Kalshi holds bids only, so
// YES ask = 1 − best NO bid (size = that NO bid's quantity) and NO ask = 1 − best YES bid (size = that quantity): both
// ways in are sized. A close drops the books; the pair falls back to the polled list until a new snapshot arrives.
export function kalshiSign(privateKeyPem, ts, path = '/trade-api/ws/v2') {
  const s = createSign('sha256'); s.update(String(ts) + 'GET' + path); s.end();
  return s.sign({ key: privateKeyPem, padding: CC.RSA_PKCS1_PSS_PADDING, saltLength: CC.RSA_PSS_SALTLEN_DIGEST }, 'base64');
}
const px = (v) => { const n = Number(v); return !isFinite(n) ? null : (String(v).includes('.') ? n : n / 100); };   // dollars, or cents
export class KalshiFeed {
  constructor({ WS, url = KALSHI_WS, keyId, privateKey, stopAt = Infinity, onMessage = () => {}, onDrop = () => {}, now = () => Date.now(), later = (f, ms) => setTimeout(f, ms) }) {
    Object.assign(this, { WS, url, keyId, privateKey, stopAt, onMessage, onDrop, now, later });
    this.ws = null; this.sig = ''; this.tickers = []; this.book = new Map(); this.msgId = 0;
  }
  headers() { const ts = this.now(); return { 'KALSHI-ACCESS-KEY': this.keyId, 'KALSHI-ACCESS-TIMESTAMP': String(ts), 'KALSHI-ACCESS-SIGNATURE': kalshiSign(this.privateKey, ts) }; }
  set(tickers) {
    const sig = tickers.slice().sort().join(',');
    if (sig === this.sig && this.ws && this.ws.readyState <= 1) return false;
    this.sig = sig; this.tickers = tickers.slice(); this.open(); return true;
  }
  open() {
    const old = this.ws; this.ws = null; try { old && old.close(); } catch {}
    this.book.clear();
    if (!this.tickers.length || this.now() >= this.stopAt) return;
    const me = new this.WS(this.url, { headers: this.headers() }); this.ws = me;
    me.onopen = () => { if (this.ws === me) me.send(JSON.stringify({ id: ++this.msgId, cmd: 'subscribe', params: { channels: ['orderbook_delta'], market_tickers: this.tickers } })); };
    me.onmessage = (ev) => {
      if (this.ws !== me) return;
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      const m = d.msg || {}, t = m.market_ticker, at = this.now();
      if (d.type === 'orderbook_snapshot' && t) {
        const side = (arr) => { const b = new Map(); for (const [p, q] of arr || []) { const pr = px(p), qq = Number(q); if (pr != null && qq > 0) b.set(pr, qq); } return b; };
        this.book.set(t, { yes: side(m.yes_dollars || m.yes), no: side(m.no_dollars || m.no), at });
      } else if (d.type === 'orderbook_delta' && t && this.book.has(t)) {
        const b = this.book.get(t), bk = b[m.side === 'no' ? 'no' : 'yes'], pr = px(m.price_dollars ?? m.price), dq = Number(m.delta_fp ?? m.delta);
        if (pr != null && isFinite(dq)) { const q = (bk.get(pr) || 0) + dq; if (q > 0) bk.set(pr, q); else bk.delete(pr); }
        b.at = at;
      } else return;
      this.onMessage(t, at);
    };
    me.onclose = () => {
      if (this.ws !== me) return;
      this.ws = null; this.book.clear(); this.onDrop();
      if (this.now() < this.stopAt) this.later(() => { if (!this.ws) this.open(); }, 2000);
    };
    me.onerror = () => {};
  }
  // the player market's YES / NO ask (and the size at each) from the live books, or null without a snapshot
  quote(ticker) {
    const b = this.book.get(ticker); if (!b || !this.ws) return null;
    const best = (m) => { let p = -1, q = 0; for (const [k, v] of m) if (k > p) { p = k; q = v; } return p < 0 ? null : { p, q }; };
    const bn = best(b.no), by = best(b.yes);
    return { yesAsk: bn ? +(1 - bn.p).toFixed(4) : null, yesSize: bn ? bn.q : null, noAsk: by ? +(1 - by.p).toFixed(4) : null, noSize: by ? by.q : null, at: b.at };
  }
  // a Kalshi match with both player markets on the live books → its prices from the books and its own clock
  overlay(km) {
    const q = km.p.map((x) => this.quote(x.ticker)); if (q.some((x) => !x)) return null;
    return { ev: km.ev, live: true, p: km.p.map((x, i) => ({ ...x, yesAsk: q[i].yesAsk, yesSize: q[i].yesSize, noAsk: q[i].noAsk, noSize: q[i].noSize })),
      at: this.now() };
  }
  stop() { this.stopAt = 0; const w = this.ws; this.ws = null; try { w && w.close(); } catch {} }
}

// Rows for our own Polymarket recorder (tools/poly-recorder.sql, public.poly_rec_push; founder 2026-11-04): every open
// ATP / Challenger Polymarket match, each player's best ask + the shares at it, from the live books. A match with no
// book yet on either side is left out (never a guessed price).
export function recRows(poly, books, now = Date.now(), staleMs = STALE_MS.poly) {
  const out = [];
  for (const m of poly || []) {
    const a = books.best(m.tokA), b = books.best(m.tokB);
    const fresh = (x) => x && x.at != null && now - x.at <= staleMs * 5;   // a quiet book still stands; a dead feed has no books
    if (!fresh(a) && !fresh(b)) continue;
    out.push({ pmId: m.id, title: m.title, a: m.a, b: m.b, start: m.start != null ? new Date(m.start).toISOString() : null,
      live: m.live === true, ended: false,
      askA: fresh(a) ? a.price : null, sizeA: fresh(a) ? a.size : null, askB: fresh(b) ? b.price : null, sizeB: fresh(b) ? b.size : null });
  }
  return out;
}

// The live score board (public.live_snapshot, api-tennis get_livescore every 10 s — the Live page's feed). Founder
// 2026-11-03: a live alert only when there is time to place both bets — the game score at 0–0:
//   'set'        a new set at 0–0 in games (the set break);
//   'changeover' an odd number of games played in the set (players sit, 90 s);
//   'game'       an even number (a new game, the serve changes, ~25 s);
// anything else ('point': a game under way, or a tiebreak, or the board stale or unmatched) never alerts.
// a set as people write it: api-tennis gives a tiebreak set as "7.7" / "6.5" (games.points) → "7–6(5)", the loser's points
export function setText(a, b) {
  const [ga, ta] = String(a ?? '').split('.'), [gb, tb] = String(b ?? '').split('.');
  if (ta == null && tb == null) return `${ga}–${gb}`;
  const lose = Number(ga) < Number(gb) ? ta : tb;
  return `${ga}–${gb}` + (lose != null && lose !== '' ? `(${lose})` : '');
}
export function boardPhase(fix) {
  if (!fix) return { phase: null };
  const status = String(fix.event_status || '');
  const sc = Array.isArray(fix.scores) ? fix.scores : [];
  const cur = sc.length ? sc[sc.length - 1] : null;
  const ga = cur ? Number(String(cur.score_first).split('.')[0]) : 0, gb = cur ? Number(String(cur.score_second).split('.')[0]) : 0;
  const sets = sc.map((x) => setText(x.score_first, x.score_second)).join(' ');
  const base = { status, score: sets || '0–0' };
  if (!/^set \d/i.test(status)) return { ...base, phase: null };                       // not in play (finished, interrupted, …)
  if (!isFinite(ga) || !isFinite(gb)) return { ...base, phase: null };
  const pts = String(fix.event_game_result || '').replace(/\s+/g, '');
  if (pts !== '' && pts !== '0-0') return { ...base, phase: 'point' };
  if (ga === 6 && gb === 6) return { ...base, phase: 'point' };                         // tiebreak: no time between points
  const n = ga + gb;
  return { ...base, phase: n === 0 && sc.length > 1 ? 'set' : n % 2 === 1 ? 'changeover' : 'game' };
}
// the board fixture of a pair: ATP singles, both players by name, exactly one
export function boardFixture(pair, board) {
  const c = (board || []).filter((f) => /atp/i.test(f.event_type_type || '') && /single/i.test(f.event_type_type || '') && (
    (samePlayer(f.event_first_player, pair.pm.a) && samePlayer(f.event_second_player, pair.pm.b)) ||
    (samePlayer(f.event_first_player, pair.pm.b) && samePlayer(f.event_second_player, pair.pm.a))));
  return c.length === 1 ? c[0] : null;
}

// One row per positive gap for the database push (public.arb_live_push): the page's live list and the ⚡ alert.
export function gapRow(pair, e, ctx) {
  const polyCost = e.polyAsk + polyFee(e.polyAsk), kalCost = e.kalAsk + kalshiFee(e.kalAsk);
  const r2 = (v) => (v == null || !isFinite(v) ? null : +v.toFixed(3));
  return { match: pair.pm.title.replace(/^[^:]*:\s*/, ''), event: pair.pm.title.split(':')[0], kalshiEvent: pair.km.ev, dir: e.dir,
    polyName: e.polyName, kalName: e.kalName, polyDec: r2(1 / e.polyAsk), polyEff: r2(1 / polyCost), polyLiq: r2(e.polySize * e.polyAsk),
    kalDec: r2(1 / e.kalAsk), kalEff: r2(1 / kalCost), kalLiq: e.kalSize == null ? null : r2(e.kalSize * e.kalAsk), kalLeg: e.kalLeg,
    edge: e.edge, contracts: e.contracts, stake: e.stake,
    // dollars per leg (founder 2026-11-04): contracts × each leg's cost with its fee; a contract pays $1 whoever wins
    polyStake: e.contracts == null ? null : +(e.contracts * polyCost).toFixed(2), kalStake: e.contracts == null ? null : +(e.contracts * kalCost).toFixed(2),
    payout: e.contracts == null ? null : +e.contracts.toFixed(2), profitUsd: e.contracts == null || e.stake == null ? null : +(e.contracts - e.stake).toFixed(2), stakePoly: +(polyCost / e.cost * 100).toFixed(1), stakeKalshi: +(kalCost / e.cost * 100).toFixed(1),
    phase: ctx.board ? ctx.board.phase : null, score: ctx.board ? ctx.board.score : null, boardStatus: ctx.board ? ctx.board.status : null,
    inPlay: ctx.inPlay, started: ctx.started, polyAt: new Date(ctx.polyAt).toISOString(), kalAt: new Date(ctx.kalAt).toISOString() };
}

export function summarise(eps, meta) {
  const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const group = (f) => {
    const xs = eps.filter(f), d = xs.map((x) => x.durationS), e = xs.map((x) => x.best.edge);
    const st = xs.map((x) => x.best.stake).filter((v) => v != null);
    return { episodes: xs.length, matches: new Set(xs.map((x) => x.match)).size, medianDurationS: q(d, 0.5), p90DurationS: q(d, 0.9),
      medianBestEdgePct: q(e, 0.5), maxBestEdgePct: e.length ? Math.max(...e) : null, sized: st.length, medianStakeAtBest: q(st, 0.5) };
  };
  return { ...meta,
    inPlay: { anyEdge: group((x) => x.liveAny), edge1pct: group((x) => x.liveAny && x.best.edge >= 1), edge1pctLasting5s: group((x) => x.liveAny && x.best.edge >= 1 && x.durationS >= 5) },
    preMatch: { anyEdge: group((x) => !x.liveAny), edge1pct: group((x) => !x.liveAny && x.best.edge >= 1), edge1pctLasting5s: group((x) => !x.liveAny && x.best.edge >= 1 && x.durationS >= 5) } };
}

// ---------- the run ----------
async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20e3), headers: { 'User-Agent': 'stennisfy-live-arb' } });
  if (!r.ok) throw new Error(url.split('?')[0] + ' HTTP ' + r.status);
  return r.json();
}
async function kalshiAll() {
  const all = []; let cursor = '';
  for (let i = 0; i < 5; i++) {
    const p = await getJson(`${KALSHI}/markets?series_ticker=KXATPMATCH&status=open&limit=1000${cursor ? '&cursor=' + cursor : ''}`);
    all.push(...(p.markets || [])); cursor = p.cursor; if (!cursor) break;
  }
  return all;
}
async function polyAll() {
  const all = [];
  for (let off = 0; off < 2000; off += 500) { const p = await getJson(`${GAMMA}/events?series_id=10365&closed=false&limit=500&offset=${off}`); all.push(...p); if (p.length < 500) break; }
  return all;
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const minutes = Number(arg('minutes', 60)), out = arg('out', 'live-arb-out'), POLL_S = Number(arg('poll', 2));
  mkdirSync(out, { recursive: true });
  const t0 = Date.now(), stop = t0 + minutes * 60e3, log = (...a) => console.log(new Date().toISOString(), ...a);
  const books = new Books(), eps = [];
  const E = new Episodes((ep) => { eps.push(ep); appendFileSync(`${out}/episodes.jsonl`, JSON.stringify(ep) + '\n'); });
  const stats = { kalshiPolls: 0, kalshiErrors: 0, gammaRefreshes: 0, gammaErrors: 0, wsMessages: 0, wsReconnects: 0, evaluations: 0,
    pairsJoinedMax: 0, liveMatchesSeen: new Set(), pairsSeen: new Set() };
  const closest = new Map(), latest = new Map();
  const sbUrl0 = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), sbKey0 = process.env.SUPABASE_SECRET_KEY || '';
  let poly = [], pairs = [], kal = [], kalAt = null;

  const feed = new PolyFeed({ WS: WebSocket, url: POLY_WS, books, stopAt: stop,
    onMessages: (k, now) => { stats.wsMessages += k; tick(now); }, onDrop: () => { stats.wsReconnects++; } });
  const kKey = (process.env.KALSHI_API_KEY_ID || '').trim(), kPem = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  stats.kalshiFeed = kKey && kPem ? 'websocket' : 'polling'; stats.kalshiWsMessages = 0; stats.kalshiWsDrops = 0;
  const kfeed = stats.kalshiFeed === 'websocket' ? new KalshiFeed({ WS: WebSocket, keyId: kKey, privateKey: kPem, stopAt: stop,
    onMessage: (t, now) => { stats.kalshiWsMessages++; refreshKal(now); }, onDrop: () => { stats.kalshiWsDrops++; } }) : null;
  const refreshKal = (now) => {   // pairs on the live Kalshi books take their prices and clock from them
    if (!kfeed) return;
    for (const p of pairs) { const o = kfeed.overlay(p.km.base || p.km); if (o) { o.base = p.km.base || p.km; p.km = o; p.kalAt = now; } else { p.km = p.km.base || p.km; p.kalAt = undefined; } }
    tick(now);
  };
  // every Polymarket match (not only the Kalshi pairs): the arbitrage needs the pairs, our Polymarket recorder needs all
  const subscribe = () => { feed.set(poly.flatMap((m) => [m.tokA, m.tokB])); if (kfeed) kfeed.set(pairs.flatMap((p) => p.km.p.map((x) => x.ticker))); };
  const tick = (now) => {
    for (const p of pairs) {
      const started = p.pm.live || (p.pm.start != null && now >= p.pm.start), live = started;
      if (p.pm.live) stats.liveMatchesSeen.add(p.pm.title);
      stats.evaluations++;
      const ev = evaluate(p, books, kalAt, now);
      latest.set(p.key, { p, ev, inPlay: p.pm.live, started, kalAt: p.kalAt ?? kalAt, polyAt: Math.max(books.at.get(p.pm.tokA) || 0, books.at.get(p.pm.tokB) || 0) });
      for (const e of ev) { const c = closest.get(p.pm.title); if (!c || e.cost < c.cost) closest.set(p.pm.title, { cost: e.cost, edge: e.edge, dir: e.dir, live, at: new Date(now).toISOString() }); }
      E.update(p, ev, now, live);
    }
  };
  const rejoin = () => {
    const before = new Set(pairs.map((p) => p.key));
    pairs = joinPairs(poly, kalshiMatches(kal));
    for (const k of before) if (!pairs.some((p) => p.key === k)) for (const ok of [...E.open.keys()]) if (ok.startsWith(k + '|')) E.close(ok, Date.now());
    pairs.forEach((p) => stats.pairsSeen.add(p.key));
    stats.pairsJoinedMax = Math.max(stats.pairsJoinedMax, pairs.length);
    subscribe();
  };
  const refreshGamma = async () => { try { poly = polyMatches(await polyAll()); stats.gammaRefreshes++; rejoin(); } catch (e) { stats.gammaErrors++; log('gamma', e.message); } };
  const pollKalshi = async () => {
    try { kal = await kalshiAll(); kalAt = Date.now(); stats.kalshiPolls++; const kk = kalshiMatches(kal);
      for (const p of pairs) { const k = kk.find((x) => x.ev === p.km.ev); if (k) { p.km = k; p.kalAt = undefined; } }
      if (kfeed) refreshKal(Date.now()); else tick(kalAt);
    } catch (e) { stats.kalshiErrors++; if (stats.kalshiErrors % 20 === 1) log('kalshi', e.message); }
  };
  await pollKalshi(); await refreshGamma();
  log(`start: ${poly.length} Polymarket matches, ${kalshiMatches(kal).length} Kalshi matches, ${pairs.length} joined`);
  const push = arg('push', '') === '1';
  let board = [], boardAt = 0; stats.boardReads = 0; stats.boardErrors = 0;
  const readBoard = async () => {
    try {
      const r = await fetch(sbUrl0 + '/rest/v1/live_snapshot?select=board,updated_at&limit=1', { signal: AbortSignal.timeout(10e3),
        headers: { apikey: sbKey0, Authorization: 'Bearer ' + sbKey0 } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); const row = j && j[0];
      board = (row && row.board && row.board.matches) || []; boardAt = Date.parse(row && row.updated_at) || 0; stats.boardReads++;
    } catch (e) { stats.boardErrors++; if (stats.boardErrors % 20 === 1) log('board', e.message); }
  };
  const boardOf = (p, now) => (now - boardAt <= 30e3 ? boardPhase(boardFixture(p, board)) : null);   // a stale board → no phase → no alert
  const sbUrl = sbUrl0, sbKey = sbKey0;
  stats.pushes = 0; stats.pushErrors = 0; stats.posted = 0;
  const doPush = async () => {
    const keys = new Set(pairs.map((p) => p.key));
    const gaps = [];
    for (const [k, L] of latest) { if (!keys.has(k)) continue; const bd = boardOf(L.p, Date.now()); for (const e of L.ev) if (e.edge > 0) gaps.push(gapRow(L.p, e, { ...L, board: bd })); }
    const body = JSON.stringify({ p: { gaps, worker: { pairs: pairs.length, live: pairs.filter((p) => p.pm.live).length, kalshiPolls: stats.kalshiPolls,
      kalshiErrors: stats.kalshiErrors, kalshiFeed: stats.kalshiFeed, kalshiWsMessages: stats.kalshiWsMessages, kalshiWsDrops: stats.kalshiWsDrops, boardReads: stats.boardReads, boardErrors: stats.boardErrors, recPushes: stats.recPushes, recErrors: stats.recErrors, recTicks: stats.recTicks, wsMessages: stats.wsMessages, wsReconnects: stats.wsReconnects, run: process.env.GITHUB_RUN_ID || null } } });
    try {
      const r = await fetch(sbUrl + '/rest/v1/rpc/arb_live_push', { method: 'POST', body, signal: AbortSignal.timeout(15e3),
        headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      stats.pushes++; stats.posted += Number(await r.json()) || 0;
    } catch (e) { stats.pushErrors++; if (stats.pushErrors % 20 === 1) log('push', e.message); }
  };
  if (push && (!sbUrl || !sbKey)) { log('push asked for but SUPABASE_URL / SUPABASE_SECRET_KEY missing'); process.exit(1); }
  if (sbUrl0 && sbKey0) await readBoard();
  const boardT = sbUrl0 && sbKey0 ? setInterval(readBoard, 5e3) : null;
  const pushT = push ? setInterval(doPush, 5e3) : null;
  stats.recPushes = 0; stats.recErrors = 0; stats.recTicks = 0;
  const doRec = async () => {
    const rows = recRows(poly, books, Date.now());
    try {
      const r = await fetch(sbUrl + '/rest/v1/rpc/poly_rec_push', { method: 'POST', body: JSON.stringify({ p: { rows } }), signal: AbortSignal.timeout(20e3),
        headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      stats.recPushes++; stats.recTicks += Number(await r.json()) || 0;
    } catch (e) { stats.recErrors++; if (stats.recErrors % 20 === 1) log('poly recorder', e.message); }
  };
  const recT = push ? setInterval(doRec, 15e3) : null;
  const gT = setInterval(refreshGamma, 60e3);
  const pingT = setInterval(() => { feed.ping(); }, 10e3);
  const repT = setInterval(() => log(`pairs ${pairs.length} live ${pairs.filter((p) => p.pm.live).length} open ${E.open.size} closed ${eps.length} ws ${stats.wsMessages} kalshi ${stats.kalshiPolls}/${stats.kalshiErrors} push ${stats.pushes}/${stats.pushErrors} posted ${stats.posted}`), 300e3);
  log('kalshi prices: ' + stats.kalshiFeed);
  const pollMs = () => (kfeed && kfeed.ws && kfeed.ws.readyState === 1 && kfeed.book.size ? 30e3 : POLL_S * 1000);   // the list for new matches; prices from the feed
  while (Date.now() < stop) { const t = Date.now(); await pollKalshi(); await new Promise((r) => setTimeout(r, Math.max(0, pollMs() - (Date.now() - t)))); }
  clearInterval(gT); clearInterval(pingT); if (pushT) clearInterval(pushT); if (recT) clearInterval(recT); if (boardT) clearInterval(boardT); clearInterval(repT); E.closeAll(Date.now()); feed.stop(); if (kfeed) kfeed.stop();
  const meta = { from: new Date(t0).toISOString(), to: new Date().toISOString(), minutes, pollS: POLL_S, fees: FEE,
    ...stats, liveMatchesSeen: stats.liveMatchesSeen.size, pairsSeen: stats.pairsSeen.size,
    closestPerMatch: [...closest].map(([match, c]) => ({ match, ...c })).sort((a, b) => a.cost - b.cost).slice(0, 15) };
  const s = summarise(eps, meta);
  writeFileSync(`${out}/summary.json`, JSON.stringify(s, null, 2));
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
