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
export const STALE_MS = { kalshi: 8000, poly: 120000, book: 120000 };   // a book price stands until changed; a pulled market is removed by the feed   // Kalshi is polled (2 s); a Polymarket book only changes on an order

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
    out.push({ id: String(e.id), title: e.title, a: o[0], b: o[1], tokA: t[0], tokB: t[1], live: e.live === true, slug: e.slug || null,
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
// a level's quantity on Kalshi's 0.01-contract grid: fractional deltas summed in floats leave dust (8.6e-12 measured 8 Nov,
// Basilashvili v Gojo) that kept an emptied level as a phantom ask and a 39% gap with no contracts behind it
const qty = (v) => Math.round(Number(v) * 1e6) / 1e6;
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
        const side = (arr) => { const b = new Map(); for (const [p, q] of arr || []) { const pr = px(p), qq = qty(q); if (pr != null && qq > 0) b.set(pr, qq); } return b; };
        this.book.set(t, { yes: side(m.yes_dollars || m.yes), no: side(m.no_dollars || m.no), at });
      } else if (d.type === 'orderbook_delta' && t && this.book.has(t)) {
        const b = this.book.get(t), bk = b[m.side === 'no' ? 'no' : 'yes'], pr = px(m.price_dollars ?? m.price), dq = Number(m.delta_fp ?? m.delta);
        if (pr != null && isFinite(dq)) { const q = qty((bk.get(pr) || 0) + dq); if (q > 0) bk.set(pr, q); else bk.delete(pr); }
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
    inPlay: ctx.inPlay, started: ctx.started, polyAt: new Date(ctx.polyAt).toISOString(), kalAt: new Date(ctx.kalAt).toISOString(),
    // the venue-neutral form every live row carries (founder 2026-11-08: bookmakers join the live list); the alert and the page read it
    mkey: pair.km.ev, atp: true, hasPm: true,
    legs: [
      { venue: 'Polymarket', name: e.polyName, group: 'prediction', dec: r2(1 / e.polyAsk), eff: r2(1 / polyCost), liq: r2(e.polySize * e.polyAsk),
        stake: e.contracts == null ? null : +(e.contracts * polyCost).toFixed(2), share: +(polyCost / e.cost * 100).toFixed(1),
        at: new Date(ctx.polyAt).toISOString(), url: polyUrl(pair.pm), how: null },
      { venue: 'Kalshi', name: e.kalName, group: 'prediction', dec: r2(1 / e.kalAsk), eff: r2(1 / kalCost), liq: e.kalSize == null ? null : r2(e.kalSize * e.kalAsk),
        stake: e.contracts == null ? null : +(e.contracts * kalCost).toFixed(2), share: +(kalCost / e.cost * 100).toFixed(1),
        at: new Date(ctx.kalAt).toISOString(), url: kalshiUrl(pair.km.ev), how: e.kalLeg } ] };
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

// ---------- bookmakers via odds-api.io (founder 2026-11-08: "implement the live arbitrage for bet105 and the prediction
// markets, then napoleongames with bet105 and prediction markets") ----------
// The odds-api.io WebSocket (paid add-on, key ODDS_API_IO_KEY) streams every match-winner change of the bookmakers selected
// on the account (Bet105 + Napoleon Sports BE). Measured 8 Nov 01:11Z, 8 min: connects in 0.5 s, no drop; Napoleon's live
// prices arrive 0.57 s (median) after the book's own updatedAt, p90 8.2 s. Its messages carry the event id, the book's
// match link and no stake limit. Names and leagues come from GET /events (every 60 s); a price for a newly joined match is
// seeded once from GET /odds/multi. A deleted / no_markets message (a suspended or pulled market) removes that price at once;
// a close drops every price (none is ever read from a dead feed) and the feed reconnects with backoff, then is reseeded.
export const ODDS_API = 'https://api.odds-api.io/v3';
export const ODDS_WS = 'wss://api.odds-api.io/v3/ws';
export const BOOKS = { 'Bet105': 'Bet105', 'Napoleon Sports BE': 'Napoleon' };   // odds-api.io name → our venue name
export const BOOK_LINK_HOME = { Bet105: 'https://app.bet105.ag', Napoleon: 'https://napoleonsports.be' };
export const PM_VENUES = new Set(['Polymarket', 'Kalshi']);

// "Surname, First" (odds-api.io) → "First Surname"
export function oddsName(s) {
  const t = String(s || '').trim(), i = t.indexOf(',');
  return i < 0 ? t : (t.slice(i + 1).trim() + ' ' + t.slice(0, i).trim()).trim();
}
// odds-api.io tennis events → ATP singles only: league "ATP - City, Country[, Qualifying]"; never Doubles, Challenger, WTA,
// UTR (founder 2026-11-02: ATP only). Live or not started.
export function oddsEvents(list) {
  const out = [];
  for (const e of list || []) {
    const league = String((e && e.league && e.league.name) ?? (e && e.league) ?? '');
    if (!/^ATP - /.test(league) || /doubles/i.test(league)) continue;
    if (!e.home || !e.away || /\//.test(e.home + e.away)) continue;
    if (e.status !== 'live' && e.status !== 'pending') continue;
    out.push({ id: String(e.id), a: oddsName(e.home), b: oddsName(e.away), league, event: league.replace(/^ATP - /, '').split(',')[0].trim(),
      start: Date.parse(e.date) || null, live: e.status === 'live' });
  }
  return out;
}

export class BookFeed {
  constructor({ WS, key, url = ODDS_WS, stopAt = Infinity, onMessage = () => {}, onDrop = () => {}, now = () => Date.now(), later = (f, ms) => setTimeout(f, ms) }) {
    Object.assign(this, { WS, key, url, stopAt, onMessage, onDrop, now, later });
    this.ws = null; this.q = new Map(); this.lastSeq = null; this.backoff = 2000;
    this.stats = { msgs: 0, odds: 0, drops: 0, resyncs: 0, seeded: 0, lagMs: [] };
  }
  wsUrl() {
    const u = new URL(this.url);
    u.searchParams.set('apiKey', this.key); u.searchParams.set('markets', 'ML'); u.searchParams.set('sport', 'tennis'); u.searchParams.set('channels', 'odds');
    if (this.lastSeq != null) u.searchParams.set('lastSeq', String(this.lastSeq));
    return u.toString();
  }
  open() {
    if (this.ws || this.now() >= this.stopAt) return;
    const me = new this.WS(this.wsUrl()); this.ws = me;
    me.onopen = () => { if (this.ws === me) this.backoff = 2000; };
    me.onmessage = (ev) => {
      if (this.ws !== me) return;
      let d; try { d = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      const t = this.now(); for (const x of [].concat(d)) this.apply(x, t);
    };
    me.onclose = () => {
      if (this.ws !== me) return;
      this.ws = null; this.q.clear(); this.stats.drops++; this.onDrop();
      if (this.now() < this.stopAt) { const ms = this.backoff; this.backoff = Math.min(30000, this.backoff * 2); this.later(() => this.open(), ms); }
    };
    me.onerror = () => {};
  }
  set(k, h, a, t, upd, url, max) {
    if (!(h > 1) || !(a > 1) || 1 / h + 1 / a < 0.99) { this.q.delete(k); return; }   // a 1.00 placeholder or a book paying over 101% is no price
    this.q.set(k, { home: h, away: a, at: t, upd: upd ?? null, url: url || null, max: max != null && isFinite(Number(max)) ? Number(max) : null });
  }
  apply(x, t) {
    if (!x || typeof x !== 'object') return;
    this.stats.msgs++;
    if (x.type === 'resync_required') { this.stats.resyncs++; this.lastSeq = null; try { this.ws && this.ws.close(); } catch {} return; }
    const venue = BOOKS[x.bookie]; if (!venue || x.id == null) return;
    if (x.seq != null) this.lastSeq = x.seq;
    const k = String(x.id) + '|' + venue;
    if (x.type === 'deleted' || x.type === 'no_markets') { this.q.delete(k); this.onMessage(String(x.id), t); return; }
    if (x.type !== 'updated' && x.type !== 'created') return;
    const ml = (x.markets || []).find((m) => m && m.name === 'ML'); if (!ml) return;
    const o = (ml.odds || [])[0] || {}, upd = Date.parse(ml.updatedAt) || null;
    this.set(k, Number(o.home), Number(o.away), t, upd, x.url, o.max);
    this.stats.odds++; if (upd) { this.stats.lagMs.push(t - upd); if (this.stats.lagMs.length > 5000) this.stats.lagMs.shift(); }
    this.onMessage(String(x.id), t);
  }
  // GET /odds/multi rows → prices, never over a newer streamed one
  seed(rows, t) {
    for (const r of rows || []) for (const [bk, ms] of Object.entries((r && r.bookmakers) || {})) {
      const venue = BOOKS[bk]; if (!venue) continue;
      const ml = (ms || []).find((m) => m && m.name === 'ML'); if (!ml) continue;
      const k = String(r.id) + '|' + venue, cur = this.q.get(k), upd = Date.parse(ml.updatedAt) || null;
      if (cur && (cur.upd == null || upd == null || cur.upd >= upd)) continue;
      const o = (ml.odds || [])[0] || {};
      this.set(k, Number(o.home), Number(o.away), t, upd, (r.urls || {})[bk], o.max); this.stats.seeded++;
    }
  }
  quote(id, venue) { return this.ws ? this.q.get(String(id) + '|' + venue) || null : null; }
  stop() { this.stopAt = 0; const w = this.ws; this.ws = null; try { w && w.close(); } catch {} }
}

// Matches with a bookmaker price: an odds-api.io ATP event joined to the Kalshi × Polymarket pair, else to a Kalshi
// event, else to a Polymarket match — both players by name, starts within 36 h, exactly one each way (never a guess).
// Kalshi × Polymarket gaps stay on their own path (evaluate); here at least one leg is a bookmaker.
export function unify(poly, kal, odds) {
  const pairs = joinPairs(poly, kal);
  const usedP = new Set(pairs.map((p) => p.pm.id)), usedK = new Set(pairs.map((p) => p.km.ev));
  const base = pairs.map((p) => ({ key: p.key, a: p.pm.a, b: p.pm.b, pm: p.pm, km: p.km, aIs: p.aIs }));
  for (const km of kal) if (!usedK.has(km.ev)) base.push({ key: 'k:' + km.ev, a: km.p[0].name, b: km.p[1].name, pm: null, km, aIs: 0 });
  for (const pm of poly) if (!usedP.has(pm.id)) base.push({ key: 'p:' + pm.id, a: pm.a, b: pm.b, pm, km: null, aIs: null });
  const near = (m, e) => { const s = m.pm && m.pm.start; return s == null || e.start == null || Math.abs(s - e.start) <= 36 * 3600e3; };
  const fit = (m, e) => !near(m, e) ? null : samePlayer(m.a, e.a) && samePlayer(m.b, e.b) ? { aHome: true } : samePlayer(m.a, e.b) && samePlayer(m.b, e.a) ? { aHome: false } : null;
  const cand = odds.map((e) => base.map((m, j) => [j, fit(m, e)]).filter(([, f]) => f));
  const used = new Map(); cand.forEach((c) => c.forEach(([j]) => used.set(j, (used.get(j) || 0) + 1)));
  const out = [];
  odds.forEach((e, i) => {
    if (cand[i].length !== 1) return;
    const [j, f] = cand[i][0]; if (used.get(j) !== 1) return;
    const m = base[j];
    out.push({ ...m, key: 'b:' + e.id, base: m.key, odds: { ...e, aHome: f.aHome }, title: m.pm ? m.pm.title : `${e.event}: ${m.a} vs ${m.b}` });
  });
  return out;
}

export const kalshiUrl = (ev) => `https://kalshi.com/markets/kxatpmatch/atp-tennis-match/${String(ev).toLowerCase()}`;
export const polyUrl = (pm) => (pm && pm.slug ? `https://polymarket.com/event/${pm.slug}` : null);

// Every venue's best way to back each player of a book match (A = m.a, B = m.b): cost per $1 paid out after fees,
// decimal price, after-fee price, contracts available (null = not known), dollars at the price, clock, link.
export function venueQuotes(m, { books, kalAt, bfeed, now }) {
  const Q = {};
  const put = (venue, side, leg) => { if (leg) (Q[venue] = Q[venue] || {})[side] = { venue, ...leg }; };
  if (m.pm) {
    const pa = books.best(m.pm.tokA), pb = books.best(m.pm.tokB);
    const sane = !(pa && pb && pa.price + pb.price < 0.98);
    const leg = (x) => !sane || !x || !(x.price > 0 && x.price < 1) || x.at == null || now - x.at > STALE_MS.poly ? null :
      { cost: x.price + polyFee(x.price), dec: 1 / x.price, size: x.size, liq: x.size * x.price, at: x.at, url: polyUrl(m.pm), group: 'prediction' };
    put('Polymarket', 'A', leg(pa)); put('Polymarket', 'B', leg(pb));
  }
  if (m.km) {
    const at = m.kalAt != null ? m.kalAt : kalAt;
    if (at != null && now - at <= STALE_MS.kalshi) {
      const kSide = (idx) => {
        const me = m.km.p[idx], other = m.km.p[1 - idx], legs = [];
        if (me.yesAsk > 0 && me.yesAsk < 1) legs.push({ price: me.yesAsk, size: me.yesSize, how: 'yes ' + me.ticker });
        if (other.noAsk > 0 && other.noAsk < 1) legs.push({ price: other.noAsk, size: other.noSize ?? null, how: 'no ' + other.ticker });
        legs.sort((x, y) => x.price - y.price); const l = legs[0]; if (!l) return null;
        return { cost: l.price + kalshiFee(l.price), dec: 1 / l.price, size: l.size, liq: l.size == null ? null : l.size * l.price, at, how: l.how, url: kalshiUrl(m.km.ev), group: 'prediction' };
      };
      put('Kalshi', 'A', kSide(m.aIs)); put('Kalshi', 'B', kSide(1 - m.aIs));
    }
  }
  if (bfeed && m.odds) for (const venue of Object.values(BOOKS)) {
    const q = bfeed.quote(m.odds.id, venue); if (!q || now - q.at > STALE_MS.book) continue;
    const leg = (dec) => ({ cost: 1 / dec, dec, size: q.max != null ? q.max * dec : null, liq: q.max, at: q.at, url: q.url, group: 'book' });
    put(venue, 'A', leg(m.odds.aHome ? q.home : q.away)); put(venue, 'B', leg(m.odds.aHome ? q.away : q.home));
  }
  return Q;
}

// Every direction with a bookmaker leg: back A on venue X and B on venue Y (X ≠ Y). Contracts = the smallest known size;
// a prediction leg without a size makes the gap unsized; a bookmaker publishes no limit, so it never caps the size.
export function evaluateMulti(m, Q) {
  const out = [], vs = Object.keys(Q);
  for (const X of vs) for (const Y of vs) {
    if (X === Y || (PM_VENUES.has(X) && PM_VENUES.has(Y))) continue;
    const A = Q[X].A, B = Q[Y].B; if (!A || !B) continue;
    const cost = A.cost + B.cost, edge = (1 / cost - 1) * 100;
    const pmUnsized = [A, B].some((l) => l.group === 'prediction' && l.size == null);
    const sizes = [A, B].map((l) => l.size).filter((v) => v != null);
    const contracts = pmUnsized || !sizes.length ? null : Math.min(...sizes);
    out.push({ dir: `${X}:A+${Y}:B`, legs: [{ ...A, name: m.a }, { ...B, name: m.b }], cost: +cost.toFixed(5), edge: +edge.toFixed(3),
      contracts, stake: contracts == null ? null : +(contracts * cost).toFixed(2) });
  }
  return out;
}

const r3 = (v) => (v == null || !isFinite(v) ? null : +v.toFixed(3));
const legRow = (l, contracts, cost) => ({ venue: l.venue, name: l.name, group: l.group, dec: r3(l.dec), eff: r3(1 / l.cost), liq: l.liq == null ? null : r3(l.liq),
  stake: contracts == null ? null : +(contracts * l.cost).toFixed(2), share: +(l.cost / cost * 100).toFixed(1), at: new Date(l.at).toISOString(),
  url: l.url || null, how: l.how || null });
export function multiGapRow(m, e, ctx) {
  return { match: m.title.replace(/^[^:]*:\s*/, ''), event: m.odds ? m.odds.event : m.title.split(':')[0], mkey: m.km ? m.km.ev : 'oddsapi:' + m.odds.id,
    kalshiEvent: m.km ? m.km.ev : null, atp: true, dir: e.dir, edge: e.edge, contracts: e.contracts, stake: e.stake,
    hasPm: e.legs.some((l) => l.group === 'prediction'), legs: e.legs.map((l) => legRow(l, e.contracts, e.cost)),
    payout: e.contracts == null ? null : +e.contracts.toFixed(2), profitUsd: e.contracts == null || e.stake == null ? null : +(e.contracts - e.stake).toFixed(2),
    phase: ctx.board ? ctx.board.phase : null, score: ctx.board ? ctx.board.score : null, boardStatus: ctx.board ? ctx.board.status : null,
    inPlay: ctx.inPlay, started: ctx.started };
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
  // bookmakers (odds-api.io WebSocket) — on when ODDS_API_IO_KEY is set
  let oddsEv = [], bmatches = []; const latestB = new Map(), seeded = new Set();
  const oKey = (process.env.ODDS_API_IO_KEY || '').trim();
  stats.bookFeed = oKey ? 'websocket' : 'off'; stats.bookMsgs = 0; stats.bookDrops = 0; stats.oddsErrors = 0; stats.oddsRefreshes = 0;
  const oddsGet = async (path, q) => {
    const u = new URL(ODDS_API + path); u.searchParams.set('apiKey', oKey); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    const r = await fetch(u, { signal: AbortSignal.timeout(20e3), headers: { 'User-Agent': 'stennisfy-live-arb' } });
    if (!r.ok) throw new Error('odds-api.io ' + path + ' HTTP ' + r.status);   // never the URL: it carries the key
    return r.json();
  };
  const bfeed = oKey ? new BookFeed({ WS: WebSocket, key: oKey, stopAt: stop,
    onMessage: (id, now) => { stats.bookMsgs++; tickBooks(now); },
    onDrop: () => { stats.bookDrops++; seeded.clear(); setTimeout(() => seedNew(), 5000); } }) : null;

  const feed = new PolyFeed({ WS: WebSocket, url: POLY_WS, books, stopAt: stop,
    onMessages: (k, now) => { stats.wsMessages += k; tick(now); }, onDrop: () => { stats.wsReconnects++; } });
  const kKey = (process.env.KALSHI_API_KEY_ID || '').trim(), kPem = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  stats.kalshiFeed = kKey && kPem ? 'websocket' : 'polling'; stats.kalshiWsMessages = 0; stats.kalshiWsDrops = 0;
  const kfeed = stats.kalshiFeed === 'websocket' ? new KalshiFeed({ WS: WebSocket, keyId: kKey, privateKey: kPem, stopAt: stop,
    onMessage: (t, now) => { stats.kalshiWsMessages++; refreshKal(now); }, onDrop: () => { stats.kalshiWsDrops++; } }) : null;
  const refreshKal = (now) => {   // pairs on the live Kalshi books take their prices and clock from them
    if (!kfeed) return;
    for (const p of [...pairs, ...bmatches.filter((m) => m.km)]) { const o = kfeed.overlay(p.km.base || p.km); if (o) { o.base = p.km.base || p.km; p.km = o; p.kalAt = now; } else { p.km = p.km.base || p.km; p.kalAt = undefined; } }
    tick(now);
  };
  // every Polymarket match (not only the Kalshi pairs): the arbitrage needs the pairs, our Polymarket recorder needs all
  const subscribe = () => { feed.set(poly.flatMap((m) => [m.tokA, m.tokB]));
    if (kfeed) kfeed.set([...new Set([...pairs, ...bmatches.filter((m) => m.km)].flatMap((p) => (p.km.base || p.km).p.map((x) => x.ticker)))]); };
  const shim = (m) => ({ key: m.key, pm: { title: m.title }, km: { ev: m.km ? m.km.ev : 'oddsapi:' + m.odds.id } });
  const tickBooks = (now) => {
    for (const m of bmatches) {
      const inPlay = m.odds.live || !!(m.pm && m.pm.live);
      const st = m.pm && m.pm.start != null ? m.pm.start : m.odds.start;
      const started = inPlay || (st != null && now >= st);
      const ev = evaluateMulti(m, venueQuotes(m, { books, kalAt, bfeed, now }));
      latestB.set(m.key, { m, ev, inPlay, started });
      for (const e of ev) { const c = closest.get(m.title + ' · ' + e.dir); if (!c || e.cost < c.cost) closest.set(m.title + ' · ' + e.dir, { cost: e.cost, edge: e.edge, dir: e.dir, live: started, at: new Date(now).toISOString() }); }
      E.update(shim(m), ev, now, started);
    }
  };
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
    tickBooks(now);
  };
  const rejoin = () => {
    const before = new Set(pairs.map((p) => p.key));
    pairs = joinPairs(poly, kalshiMatches(kal));
    for (const k of before) if (!pairs.some((p) => p.key === k)) for (const ok of [...E.open.keys()]) if (ok.startsWith(k + '|')) E.close(ok, Date.now());
    pairs.forEach((p) => stats.pairsSeen.add(p.key));
    stats.pairsJoinedMax = Math.max(stats.pairsJoinedMax, pairs.length);
    const bBefore = new Set(bmatches.map((m) => m.key));
    bmatches = bfeed ? unify(poly, kalshiMatches(kal), oddsEv) : [];
    for (const k of bBefore) if (!bmatches.some((m) => m.key === k)) { latestB.delete(k); for (const ok of [...E.open.keys()]) if (ok.startsWith(k + '|')) E.close(ok, Date.now()); }
    stats.bookMatchesMax = Math.max(stats.bookMatchesMax || 0, bmatches.length);
    subscribe(); seedNew();
  };
  // a newly joined bookmaker match takes its current prices from GET /odds/multi once (the feed sends only changes)
  const seedNew = async () => {
    if (!bfeed) return;
    const ids = [...new Set(bmatches.map((m) => m.odds.id))].filter((id) => !seeded.has(id));
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10); part.forEach((id) => seeded.add(id));
      try { const rows = await oddsGet('/odds/multi', { eventIds: part.join(','), bookmakers: Object.keys(BOOKS).join(',') }); bfeed.seed(Array.isArray(rows) ? rows : [], Date.now()); }
      catch (e) { part.forEach((id) => seeded.delete(id)); stats.oddsErrors++; if (stats.oddsErrors % 20 === 1) log(e.message); }
    }
    tickBooks(Date.now());
  };
  const refreshOdds = async () => {
    if (!bfeed) return;
    try {
      const [l, pd] = await Promise.all([oddsGet('/events', { sport: 'tennis', status: 'live' }), oddsGet('/events', { sport: 'tennis', status: 'pending' })]);
      oddsEv = oddsEvents([...(Array.isArray(l) ? l : []), ...(Array.isArray(pd) ? pd : [])]); stats.oddsRefreshes++; rejoin();
    } catch (e) { stats.oddsErrors++; if (stats.oddsErrors % 20 === 1) log(e.message); }
  };
  const refreshGamma = async () => { try { poly = polyMatches(await polyAll()); stats.gammaRefreshes++; rejoin(); } catch (e) { stats.gammaErrors++; log('gamma', e.message); } };
  const pollKalshi = async () => {
    try { kal = await kalshiAll(); kalAt = Date.now(); stats.kalshiPolls++; const kk = kalshiMatches(kal);
      for (const p of [...pairs, ...bmatches.filter((m) => m.km)]) { const k = kk.find((x) => x.ev === (p.km.base || p.km).ev); if (k) { p.km = k; p.kalAt = undefined; } }
      if (kfeed) refreshKal(Date.now()); else tick(kalAt);
    } catch (e) { stats.kalshiErrors++; if (stats.kalshiErrors % 20 === 1) log('kalshi', e.message); }
  };
  await pollKalshi(); await refreshGamma();
  if (bfeed) { bfeed.open(); await refreshOdds(); }
  log(`start: ${poly.length} Polymarket matches, ${kalshiMatches(kal).length} Kalshi matches, ${pairs.length} joined; bookmakers ${stats.bookFeed}: ${oddsEv.length} ATP events, ${bmatches.length} joined`);
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
    const bkeys = new Set(bmatches.map((m) => m.key));
    for (const [k, L] of latestB) { if (!bkeys.has(k)) continue; const bd = boardOf({ pm: { a: L.m.a, b: L.m.b } }, Date.now()); for (const e of L.ev) if (e.edge > 0) gaps.push(multiGapRow(L.m, e, { ...L, board: bd })); }
    const lag = bfeed ? [...bfeed.stats.lagMs].sort((a, b) => a - b) : [];
    const body = JSON.stringify({ p: { gaps, worker: { pairs: pairs.length, live: pairs.filter((p) => p.pm.live).length, kalshiPolls: stats.kalshiPolls,
      kalshiErrors: stats.kalshiErrors, kalshiFeed: stats.kalshiFeed, kalshiWsMessages: stats.kalshiWsMessages, kalshiWsDrops: stats.kalshiWsDrops, boardReads: stats.boardReads, boardErrors: stats.boardErrors, recPushes: stats.recPushes, recErrors: stats.recErrors, recTicks: stats.recTicks, wsMessages: stats.wsMessages, wsReconnects: stats.wsReconnects,
      bookFeed: stats.bookFeed, bookMatches: bmatches.length, bookLive: bmatches.filter((m) => m.odds.live).length, bookMsgs: stats.bookMsgs, bookDrops: stats.bookDrops,
      bookPrices: bfeed ? bfeed.q.size : 0, bookLagMsP50: lag.length ? lag[Math.floor(lag.length / 2)] : null, oddsErrors: stats.oddsErrors, run: process.env.GITHUB_RUN_ID || null } } });
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
  const oT = bfeed ? setInterval(refreshOdds, 60e3) : null;
  const pingT = setInterval(() => { feed.ping(); }, 10e3);
  const repT = setInterval(() => log(`pairs ${pairs.length} live ${pairs.filter((p) => p.pm.live).length} open ${E.open.size} closed ${eps.length} ws ${stats.wsMessages} books ${bmatches.length}/${stats.bookMsgs}/${stats.bookDrops} kalshi ${stats.kalshiPolls}/${stats.kalshiErrors} push ${stats.pushes}/${stats.pushErrors} posted ${stats.posted}`), 300e3);
  log('kalshi prices: ' + stats.kalshiFeed);
  const pollMs = () => (kfeed && kfeed.ws && kfeed.ws.readyState === 1 && kfeed.book.size ? 30e3 : POLL_S * 1000);   // the list for new matches; prices from the feed
  while (Date.now() < stop) { const t = Date.now(); await pollKalshi(); await new Promise((r) => setTimeout(r, Math.max(0, pollMs() - (Date.now() - t)))); }
  clearInterval(gT); if (oT) clearInterval(oT); if (bfeed) bfeed.stop(); clearInterval(pingT); if (pushT) clearInterval(pushT); if (recT) clearInterval(recT); if (boardT) clearInterval(boardT); clearInterval(repT); E.closeAll(Date.now()); feed.stop(); if (kfeed) kfeed.stop();
  const meta = { from: new Date(t0).toISOString(), to: new Date().toISOString(), minutes, pollS: POLL_S, fees: FEE,
    ...stats, liveMatchesSeen: stats.liveMatchesSeen.size, pairsSeen: stats.pairsSeen.size,
    closestPerMatch: [...closest].map(([match, c]) => ({ match, ...c })).sort((a, b) => a.cost - b.cost).slice(0, 15) };
  const s = summarise(eps, meta);
  writeFileSync(`${out}/summary.json`, JSON.stringify(s, null, 2));
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
