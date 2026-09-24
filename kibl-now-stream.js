/* TEN-270 — Kibl stream -> live "Now" on pre-match cards.
 *
 * Founder brief 2026-09-24T01:21Z. Reads ONE table, public.kibl_now_price, with
 * the page's publishable key (SELECT-only policy; no write key exists in this
 * page). Initial REST read, then Supabase Realtime pushes (postgres_changes,
 * filtered to kind=eq.price so the worker's heartbeat never costs a Realtime
 * message), plus a 60 s REST backstop that also reads the heartbeat row.
 *
 * It decides NOTHING about which book owns a card. The page's _mcNowPair asks
 * window.KiblNow.pairFor(m, book) and uses the answer only when the card's
 * selected book IS the stream's book and the stream price is NEWER by Kibl's
 * own clock — the whole-card, one-book rule (TEN-253) is untouched.
 *
 * Staleness: `live` is true only while the worker's heartbeat is < 180 s old
 * AND it reports the broker connected. A price is never labelled live on a
 * dead stream; it keeps its real Kibl time either way.
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
  const TABLE = 'kibl_now_price';
  const REST = `${SB_URL}/rest/v1/${TABLE}?select=card_key,side_key,kind,price,book,book_name,` +
               `kibl_inserted_on,written_at,source,note`;
  const RT_URL = `${SB_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=` +
                 `${encodeURIComponent(SB_KEY)}&vsn=1.0.0`;
  const HB_STALE_MS = 180000;
  const BACKSTOP_MS = 60000;
  const RT_HEARTBEAT_MS = 25000;

  const rows = new Map();          // `${card_key}|${side_key}` -> row
  let hb = null;                   // heartbeat row
  let ws = null, rtBeat = null, rtRetries = 0, ref = 0, paintTimer = null;
  const samples = [];              // {written_at, kibl, recvMs} — worker->screen measurement

  function ms(v) { const t = v ? Date.parse(v) : NaN; return isFinite(t) ? t : null; }
  function healthy() {
    if (!hb || !hb.note || hb.note.connected !== true) return false;
    const t = ms(hb.written_at);
    return t != null && Date.now() - t < HB_STALE_MS;
  }
  function put(r, recvMs) {
    if (!r || !r.card_key) return false;
    if (r.kind === 'heartbeat') { hb = r; return false; }
    if (r.kind !== 'price' || !(Number(r.price) >= 1.01)) return false;
    const k = r.card_key + '|' + r.side_key;
    const prev = rows.get(k);
    if (prev && ms(prev.kibl_inserted_on) > ms(r.kibl_inserted_on)) return false;
    rows.set(k, r);
    if (recvMs != null && samples.length < 5000)
      samples.push({ written_at: r.written_at, kibl: r.kibl_inserted_on, recvMs });
    return true;
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
    const obs = Math.max(ms(a.written_at) || 0, ms(b.written_at) || 0);
    return { p1: Number(a.price), p2: Number(b.price), book: a.book, bookName: a.book_name || a.book,
             at: at ? new Date(at).toISOString() : null, obs: obs ? new Date(obs).toISOString() : null,
             kind: 'vendor-insert', src: 'stream', live: healthy() };
  }

  function repaint() {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => {
      if (typeof renderMatches !== 'function' || !document.getElementById('matchlist')) return;
      // A price tick must not collapse what the member is reading.
      const open = [...document.querySelectorAll('.match-card.sig-open')].map(e => e.dataset.id);
      try { renderMatches(); } catch (e) { console.warn('[kibl-now] repaint failed', e); return; }
      for (const id of open) {
        const el = document.querySelector(`.match-card[data-id="${CSS.escape(id)}"]`);
        if (el) el.classList.add('sig-open');
      }
    }, 800);
  }

  async function backstop() {
    try {
      const res = await fetch(REST, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
                                                 Accept: 'application/json' } });
      if (!res.ok) throw new Error('PostgREST ' + res.status);
      const list = await res.json();
      let changed = false;
      const wasHealthy = healthy();
      for (const r of list || []) changed = put(r, null) || changed;
      if (changed || wasHealthy !== healthy()) repaint();
    } catch (e) {
      console.warn('[kibl-now] backstop read failed:', e.message);
    }
  }

  function send(sock, topic, event, payload) {
    try { sock.send(JSON.stringify({ topic, event, payload, ref: String(++ref) })); } catch (e) { /* closing */ }
  }
  function connect() {
    if (document.hidden || (ws && ws.readyState <= 1)) return;
    try { ws = new WebSocket(RT_URL); } catch (e) { return; }
    const sock = ws;
    sock.onopen = () => {
      rtRetries = 0;
      send(sock, 'realtime:' + TABLE, 'phx_join', {
        config: { broadcast: { ack: false, self: false }, presence: { key: '' },
                  postgres_changes: [{ event: '*', schema: 'public', table: TABLE,
                                       filter: 'kind=eq.price' }],
                  private: false },
        access_token: SB_KEY,
      });
      clearInterval(rtBeat);
      rtBeat = setInterval(() => send(sock, 'phoenix', 'heartbeat', {}), RT_HEARTBEAT_MS);
    };
    sock.onmessage = (evt) => {
      let msg; try { msg = JSON.parse(evt.data); } catch (e) { return; }
      if (msg.event !== 'postgres_changes') return;
      const d = msg.payload && msg.payload.data;
      const rec = d && (d.record || d.new);
      if (rec && put(rec, Date.now())) repaint();
    };
    sock.onclose = () => {
      clearInterval(rtBeat); rtBeat = null;
      if (ws === sock) ws = null;
      if (document.hidden) return;
      const delay = Math.min(2000 * 2 ** Math.min(rtRetries++, 5), 60000);
      setTimeout(connect, delay);
    };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ws) ws.close(); }
    else { backstop(); connect(); }
  });

  window.KiblNow = { pairFor, healthy, enabled: true, samples, _rows: rows };
  backstop();
  connect();
  setInterval(backstop, BACKSTOP_MS);
  // Relative "updated … ago" text is rendered, not live — refresh it once a minute.
  setInterval(repaint, 60000);
})();
