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
 *   2. The subscription is scoped to the pre-match cards ON SCREEN (layout,
 *      ±150 px; `card_key=in.(…)`, ≤100 keys per binding). Scrolling a card in
 *      or switching day subscribes it at once; scrolling it off unsubscribes
 *      it; no card on screen, no channel. Every confirmed subscription re-reads
 *      the table, so nothing between joins is missed.
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
  const REJOIN_JITTER_MS = 5000;

  const rows = new Map();          // `${card_key}|${side_key}` -> side row
  let hb = null;                   // heartbeat row
  let ws = null, rtRetries = 0, ref = 0, paintTimer = null;
  let topic = null, joinRef = null, joined = false, gen = 0, rejoinTimer = null, chanRetries = 0;
  let scope = [];                  // card keys the live channel is filtered to
  let joinedKeys = [];             // the keys of the channel actually JOINED (live is judged on these)
  let backstopTimer = null;
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
             sideAt, kind: 'vendor-insert', src: 'stream',
             // Live only for a card this page is subscribed to (review 3rd pass,
             // finding 6): other surfaces can ask for an unrendered card.
             live: healthy() && joinedKeys.includes(key) };
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

  // ── scope: the pre-match cards ON SCREEN (founder 2026-09-24T10:16Z) ──────
  // Read from LAYOUT at the moment of each check, never from remembered
  // observer state: renderMatches() replaces every card element, and an
  // IntersectionObserver reports the removed ones as "not intersecting" — the
  // first build (3d6c5793) emptied its scope on every repaint and looped
  // (review round 3, finding 1). getBoundingClientRect() on the elements that
  // exist NOW has no such gap. A card within VIEW_MARGIN_PX of the viewport
  // counts, so a card about to scroll in is already live. Scroll, resize and
  // any change to the list trigger a check; the 2 s tick is the backstop.
  const VIEW_MARGIN_PX = 150;
  let lastInput = 0, scopeTimer = null, listObserver = null;
  function soon() { clearTimeout(scopeTimer); scopeTimer = setTimeout(rescope, 150); }
  // A wheel, touch, key or click marks the next scope change as the member's
  // own: applied at once. A change with no input behind it (a board refresh, a
  // card starting) reaches every viewer together, so it is spread over 5 s.
  for (const ev of ['wheel', 'touchmove', 'keydown', 'click', 'mousedown'])
    try { window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }); } catch (e) { /* no events */ }
  for (const ev of ['scroll', 'resize'])
    try { window.addEventListener(ev, soon, { passive: true }); } catch (e) { /* no events */ }
  function onScreen(el) {
    if (typeof el.getBoundingClientRect !== 'function' || typeof innerHeight !== 'number') return true;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false;          // hidden (display:none)
    return r.bottom >= -VIEW_MARGIN_PX && r.top <= innerHeight + VIEW_MARGIN_PX;
  }
  function renderedKeys() {
    const list = document.getElementById('matchlist');
    if (!list || typeof ocsKeyOf !== 'function') return [];
    if (!listObserver && typeof MutationObserver === 'function') {
      listObserver = new MutationObserver(soon);        // a day-tab switch or a repaint
      listObserver.observe(list, { childList: true, subtree: true });
    }
    let all;
    try { all = matches; } catch (e) { return []; }   // the page's top-level `let matches`
    if (!Array.isArray(all)) return [];
    const byId = new Map(all.map(m => [String(m.id), m]));
    const keys = new Set();
    for (const el of list.querySelectorAll('.match-card[data-id]')) {
      if (!onScreen(el)) continue;
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
    topic = null; joinRef = null; joined = false; joinedKeys = [];
  }
  function join() {
    clearTimeout(rejoinTimer); rejoinTimer = null;
    if (!ws || ws.readyState !== 1) return;
    leave();
    if (!scope.length) return;                 // nothing rendered, nothing to hear
    topic = `realtime:kibl-now-${++gen}`;
    joinRef = String(++ref);
    joinedKeys = scope.slice();
    send(ws, topic, 'phx_join', {
      config: { broadcast: { ack: false, self: false }, presence: { key: '' },
                postgres_changes: bindings(scope), private: false },
      access_token: SB_KEY,
    }, joinRef);
    stats.joins++;
  }
  function rescope() {
    if (paused()) return;
    // A join awaiting the server's confirmation: no re-scope until it lands.
    // Between leave and confirm no card is "● live"; where that label wraps,
    // card heights change, a card crosses the ±150 px edge and a re-scope would
    // re-join again — the loop review round 4 (finding 1) reproduced. The
    // confirmation repaints the labels back, then the check runs once.
    if (topic && !joined) { soon(); return; }
    const next = renderedKeys();
    if (!next.length) {
      if (scope.length) { scope = []; leave(); repaint(); }
      return;
    }
    if (next.join('\n') === scope.join('\n')) return;
    scope = next;
    if (!ws || ws.readyState !== 1) { connect(); return; }
    clearTimeout(rejoinTimer);
    // The member's own scroll / tab switch: re-join now. A data-driven change
    // (no input in the last 3 s) is spread over REJOIN_JITTER_MS (review 3rd
    // pass, finding 4: every viewer would otherwise re-join in the same tick).
    if (Date.now() - lastInput < 3000) join();
    else rejoinTimer = setTimeout(join, Math.floor(Math.random() * REJOIN_JITTER_MS));
  }

  // A refused, errored or closed channel is not live; re-join with backoff.
  function channelDown() {
    joined = false; topic = null; joinRef = null;
    repaint();
    clearTimeout(rejoinTimer);
    rejoinTimer = setTimeout(join, Math.min(2000 * 2 ** Math.min(chanRetries++, 5), 60000));
  }
  function connect() {
    if (paused() || !scope.length || (ws && ws.readyState <= 1)) return;
    try { ws = new WebSocket(RT_URL); } catch (e) { return; }
    const sock = ws;
    let beat = null;                      // this socket's own heartbeat (review 3rd pass, finding 5)
    sock.onopen = () => {
      rtRetries = 0;
      join();
      beat = setInterval(() => send(sock, 'phoenix', 'heartbeat', {}), RT_HEARTBEAT_MS);
    };
    sock.onmessage = (evt) => {
      let msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (sock !== ws || msg.topic !== topic || !topic) return;
      const st = msg.payload && msg.payload.status;
      if (msg.event === 'phx_reply' && msg.ref === joinRef) {
        // The join is accepted, but Postgres Changes is only listening once the
        // server says so in a `system` message (review 3rd pass, finding 2).
        if (st !== 'ok') channelDown();
        return;
      }
      if (msg.event === 'system' && (!msg.payload.extension || msg.payload.extension === 'postgres_changes')) {
        if (st === 'ok') {
          joined = true; chanRetries = 0;
          // Anything written between the last read and this subscription is
          // fetched now, every time (review 3rd pass, finding 3).
          backstop();
          repaint();
        } else channelDown();
        return;
      }
      if (msg.event === 'phx_error' || msg.event === 'phx_close') { channelDown(); return; }
      if (msg.event !== 'postgres_changes') return;
      const d = msg.payload && msg.payload.data;
      const rec = d && (d.record || d.new);
      stats.pushes++;
      if (rec && putCard(rec, Date.now())) repaint();
    };
    sock.onclose = () => {
      clearInterval(beat);
      if (ws !== sock) return;               // a socket we already replaced
      ws = null; topic = null; joinRef = null; joined = false;
      if (paused()) return;
      repaint();
      const delay = Math.min(2000 * 2 ** Math.min(rtRetries++, 5), 60000);
      setTimeout(connect, delay);
    };
  }

  function pause() {
    stats.paused++;
    clearTimeout(rejoinTimer); rejoinTimer = null;
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
                     scope: () => scope.slice(), viewport: typeof innerHeight === 'number', _rows: rows };
  if (!paused()) resume();
  setInterval(rescope, SCOPE_EVERY_MS);
  // Relative "updated … ago" text is rendered, not live — refresh it once a minute.
  setInterval(() => { if (!paused()) repaint(); }, 60000);
})();
