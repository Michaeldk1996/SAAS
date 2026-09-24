/* TEN-270 — Kibl stream -> live "Now" on pre-match cards.
 *
 * Founder brief 2026-09-24T01:21Z; scaled for 500+ viewers by the 08:58Z brief.
 * Reads with the page's publishable key only (SELECT-only policies; no write
 * key exists in this page):
 *   kibl_now_card   ONE row per card (both sides) — the only table in the
 *                   Realtime publication, so one price change = one message
 *                   per subscribed viewer (08:58Z brief, item 3).
 *   kibl_now_price  the worker's heartbeat row, read over REST only.
 *
 * Cost rules (08:58Z brief):
 *   1. Hidden tab = no subscription. On `visibilitychange` to hidden the socket
 *      closes and the backstop stops; back to visible, the table is re-read and
 *      the channel re-joined. Nothing is labelled "● live" while paused.
 *   2. The subscription is scoped to the pre-match cards RENDERED in the match
 *      list (`card_key=in.(…)`, ≤100 keys per binding). No rendered card, no
 *      channel. The scope is re-read every 2 s; a change re-joins, and the
 *      re-join re-reads the table so nothing between the two joins is missed.
 *
 * It decides NOTHING about which book owns a card. The page's _mcNowPair asks
 * window.KiblNow.pairFor(m, book) and uses the answer only when the card's
 * selected book IS the stream's book and the stream price is NEWER by Kibl's
 * own clock — the whole-card, one-book rule (TEN-253) is untouched.
 *
 * Staleness: `live` is true only while the worker's heartbeat is < 180 s old,
 * the broker is connected, writes are landing, AND this page is visible with
 * its Realtime channel joined. A price is never labelled live on a dead
 * stream or a paused page; it keeps its real Kibl time either way.
 */
(function () {
  'use strict';
  const SB_URL = (window.SUPABASE_URL || '').replace(/\/$/, '');
  const SB_KEY = window.SUPABASE_ANON_KEY || '';
  const OFF = { pairFor: () => null, healthy: () => false, enabled: false, samples: [] };
  if (!SB_URL || SB_URL.startsWith('__') || !SB_KEY || SB_KEY.startsWith('__')) {
    window.KiblNow = OFF;
    return;
  }
  const HB_TABLE = 'kibl_now_price';
  const CARD_TABLE = 'kibl_now_card';
  const CARD_COLS = 'select=card_key,book,book_name,a_side,a_price,a_at,b_side,b_price,b_at,written_at,source';
  // Two reads: the heartbeat on its own, so it can never be cut off by the
  // 1,000-row PostgREST cap under the card rows (review finding 7).
  const RESTS = [`${SB_URL}/rest/v1/${HB_TABLE}?select=card_key,side_key,kind,book,written_at,note&kind=eq.heartbeat`,
                 `${SB_URL}/rest/v1/${CARD_TABLE}?${CARD_COLS}&order=written_at.desc&limit=1000`];
  const RT_URL = `${SB_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=` +
                 `${encodeURIComponent(SB_KEY)}&vsn=1.0.0`;
  const HB_STALE_MS = 180000;
  const BACKSTOP_MS = 60000;
  const RT_HEARTBEAT_MS = 25000;
  const SCOPE_EVERY_MS = 2000;
  const MAX_IN = 100;                 // Supabase: an `in` filter takes at most 100 values

  const rows = new Map();          // `${card_key}|${side_key}` -> side row
  let hb = null;                   // heartbeat row
  let ws = null, rtBeat = null, rtRetries = 0, ref = 0, paintTimer = null;
  let topic = null, joinRef = null, joined = false, gen = 0;
  let scope = [];                  // card keys the live channel is filtered to
  let backstopTimer = null, lastSeedMs = 0;
  const samples = [];              // {written_at, kibl, recvMs} — worker->screen measurement
  const stats = { joins: 0, leaves: 0, pushes: 0, paused: 0 };

  function ms(v) { const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t : null; }
  function paused() { return !!document.hidden; }
  function healthy() {
    // Broker connected AND writes landing — a worker that is connected but
    // failing its writes is holding prices the table does not have — AND this
    // page actually subscribed: a paused or unjoined page is not receiving.
    if (paused() || !joined || !ws || ws.readyState !== 1) return false;
    if (!hb || !hb.note || hb.note.connected !== true || hb.note.write_ok === false) return false;
    const t = ms(hb.written_at);
    return t != null && Date.now() - t < HB_STALE_MS;
  }
  function putSide(card, side, price, at, recvMs) {
    if (!side || !(Number(price) >= 1.01)) return false;
    const k = card.card_key + '|' + side;
    const prev = rows.get(k);
    if (prev && ms(prev.kibl_inserted_on) > ms(at)) return false;
    rows.set(k, { card_key: card.card_key, side_key: side, kind: 'price', price: Number(price),
                  book: card.book, book_name: card.book_name, kibl_inserted_on: at,
                  written_at: card.written_at, source: card.source });
    return true;
  }
  // One card row carries both sides; each side is kept only if not older.
  function putCard(r, recvMs) {
    if (!r || !r.card_key) return false;
    const a = putSide(r, r.a_side, r.a_price, r.a_at, recvMs);
    const b = putSide(r, r.b_side, r.b_price, r.b_at, recvMs);
    if ((a || b) && recvMs != null && samples.length < 5000)
      samples.push({ card_key: r.card_key, written_at: r.written_at,
                     kibl: [r.a_at, r.b_at].sort().pop(), recvMs });
    return a || b;
  }

  // The card's stream pair, or null. Both sides or neither — never half a pair.
  function pairFor(m, book) {
    if (!m || typeof ocsKeyOf !== 'function' || typeof ocsNameKey !== 'function') return null;
    const key = ocsKeyOf(m);
    const k1 = ocsNameKey(m.p1), k2 = ocsNameKey(m.p2);
    if (!key || !k1 || !k2) return null;
    const a = rows.get(key + '|' + k1), b = rows.get(key + '|' + k2);
    if (!a || !b) return null;
    if (book && String(a.book || '').toLowerCase() !== String(book).toLowerCase()) return null;
    const at = Math.max(ms(a.kibl_inserted_on) || 0, ms(b.kibl_inserted_on) || 0);
    // Per-side Kibl times, keyed by the CARD's side, so the page can judge each
    // side against the poller's same side rather than the pair's newest.
    const sideAt = { p1: a.kibl_inserted_on || null, p2: b.kibl_inserted_on || null };
    const obs = Math.max(ms(a.written_at) || 0, ms(b.written_at) || 0);
    return { p1: Number(a.price), p2: Number(b.price), book: a.book, bookName: a.book_name || a.book,
             at: at ? new Date(at).toISOString() : null, obs: obs ? new Date(obs).toISOString() : null,
             sideAt, kind: 'vendor-insert', src: 'stream', live: healthy() };
  }

  function paintNow() {
    if (typeof renderMatches !== 'function' || !document.getElementById('matchlist')) return;
    // A price tick must not collapse what the member is reading.
    const open = [...document.querySelectorAll('.match-card.sig-open')].map(e => e.dataset.id);
    try { renderMatches(); } catch (e) { console.warn('[kibl-now] repaint failed', e); return; }
    for (const id of open) {
      const el = document.querySelector(`.match-card[data-id="${CSS.escape(id)}"]`);
      if (el) el.classList.add('sig-open');
    }
  }
  function repaint() {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paintNow, 800);
  }

  async function backstop() {
    if (paused()) return;
    lastSeedMs = Date.now();
    try {
      const got = [];
      for (const u of RESTS) {
        const res = await fetch(u, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
                                               Accept: 'application/json' } });
        if (!res.ok) throw new Error('PostgREST ' + res.status);
        got.push(await res.json() || []);
      }
      const wasHealthy = healthy();
      let changed = false;
      for (const r of got[0] || []) if (r && r.kind === 'heartbeat') hb = r;
      for (const r of got[1] || []) changed = putCard(r, null) || changed;
      if (changed || wasHealthy !== healthy()) repaint();
    } catch (e) {
      console.warn('[kibl-now] backstop read failed:', e.message);
    }
  }

  // ── scope: the pre-match cards rendered in the match list ────────────────
  function renderedKeys() {
    const list = document.getElementById('matchlist');
    if (!list || typeof ocsKeyOf !== 'function') return [];
    let all;
    try { all = matches; } catch (e) { return []; }   // the page's top-level `let matches`
    if (!Array.isArray(all)) return [];
    const byId = new Map(all.map(m => [String(m.id), m]));
    const keys = new Set();
    for (const el of list.querySelectorAll('.match-card[data-id]')) {
      const m = byId.get(el.dataset.id);
      if (!m || m.live || m.finalScore) continue;
      if (typeof cardStartMs === 'function') {
        const t = cardStartMs(m);
        if (isFinite(t) && Date.now() >= t) continue;
      }
      const k = ocsKeyOf(m);
      // A key the `in.(…)` list cannot carry unquoted is left to the backstop.
      if (k && !/[,()"\s]/.test(k)) keys.add(k);
    }
    return [...keys].sort();
  }
  function bindings(keys) {
    const out = [];
    for (let i = 0; i < keys.length; i += MAX_IN)
      out.push({ event: '*', schema: 'public', table: CARD_TABLE,
                 filter: `card_key=in.(${keys.slice(i, i + MAX_IN).join(',')})` });
    return out;
  }

  function send(sock, t, event, payload, r) {
    try { sock.send(JSON.stringify({ topic: t, event, payload, ref: r || String(++ref) })); } catch (e) { /* closing */ }
  }
  function leave() {
    if (topic && ws && ws.readyState === 1) { send(ws, topic, 'phx_leave', {}); stats.leaves++; }
    topic = null; joinRef = null; joined = false;
  }
  function join() {
    if (!ws || ws.readyState !== 1) return;
    leave();
    if (!scope.length) return;                 // nothing rendered, nothing to hear
    topic = `realtime:kibl-now-${++gen}`;
    joinRef = String(++ref);
    send(ws, topic, 'phx_join', {
      config: { broadcast: { ack: false, self: false }, presence: { key: '' },
                postgres_changes: bindings(scope), private: false },
      access_token: SB_KEY,
    }, joinRef);
    stats.joins++;
  }
  function rescope() {
    if (paused()) return;
    const next = renderedKeys();
    if (next.join('\n') === scope.join('\n')) return;
    scope = next;
    if (!scope.length) { leave(); repaint(); return; }
    if (ws && ws.readyState === 1) join(); else connect();
  }

  function connect() {
    if (paused() || !scope.length || (ws && ws.readyState <= 1)) return;
    try { ws = new WebSocket(RT_URL); } catch (e) { return; }
    const sock = ws;
    sock.onopen = () => {
      rtRetries = 0;
      join();
      clearInterval(rtBeat);
      rtBeat = setInterval(() => send(sock, 'phoenix', 'heartbeat', {}), RT_HEARTBEAT_MS);
    };
    sock.onmessage = (evt) => {
      let msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (msg.event === 'phx_reply' && msg.ref === joinRef && msg.topic === topic) {
        joined = !!(msg.payload && msg.payload.status === 'ok');
        // Anything written between the last read and this join is fetched now.
        if (joined && Date.now() - lastSeedMs > 5000) backstop();
        repaint();
        return;
      }
      if (msg.event !== 'postgres_changes' || msg.topic !== topic) return;
      const d = msg.payload && msg.payload.data;
      const rec = d && (d.record || d.new);
      stats.pushes++;
      if (rec && putCard(rec, Date.now())) repaint();
    };
    sock.onclose = () => {
      clearInterval(rtBeat); rtBeat = null;
      if (ws === sock) { ws = null; topic = null; joinRef = null; joined = false; }
      if (paused()) return;
      repaint();
      const delay = Math.min(2000 * 2 ** Math.min(rtRetries++, 5), 60000);
      setTimeout(connect, delay);
    };
  }

  function pause() {
    stats.paused++;
    clearInterval(backstopTimer); backstopTimer = null;
    leave();
    if (ws) { const s = ws; ws = null; try { s.close(); } catch (e) { /* gone */ } }
    // Painted NOW, while hidden: the member must never come back to a "● live"
    // left over from before the pause.
    clearTimeout(paintTimer);
    paintNow();
  }
  function resume() {
    paintNow();                          // not live until the channel re-joins
    backstop();                          // re-seed: the table, not the missed pushes
    clearInterval(backstopTimer);
    backstopTimer = setInterval(backstop, BACKSTOP_MS);
    scope = renderedKeys();
    connect();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });

  window.KiblNow = { pairFor, healthy, enabled: true, samples, stats,
                     scope: () => scope.slice(), _rows: rows };
  if (!paused()) resume();
  setInterval(rescope, SCOPE_EVERY_MS);
  // Relative "updated … ago" text is rendered, not live — refresh it once a minute.
  setInterval(() => { if (!paused()) repaint(); }, 60000);
})();
