// TEN-107 · Slice 4 — standalone Live tab (member read path)
//
// Founder ruling (TEN-91, 2026-08-29): the live feed is its OWN nav tab, not an
// overlay on the Matches board. It reads the shared live_snapshot row from
// Supabase via PostgREST (no SDK, no Edge-Function cold start on the member
// path). The Matches tab is untouched.
//
// TEN-190 (2026-09-12): this module no longer RENDERS. The Live page is drawn by
// the Claude Design handoff build that owns #lvTab in the dashboard. This module
// is the DATA layer — transport, the ATP-singles + underway gate, the box-score
// index and the rating formulas — and publishes every board to the renderer via
// window.LiveFeed.subscribe().
//
// Supersedes live-overlay.js (Slice 3), which is no longer loaded.
//
// Guard: window.FEATURE_LIVE_PROXY must be truthy. Never runs otherwise.
//
// Transport (TEN-107 Tier 1, founder-approved 2026-08-31): reads via either a
// 30s PostgREST poll (default) OR Supabase Realtime WebSocket push, selected by
// window.FEATURE_LIVE_REALTIME (default OFF → poll, i.e. prior behaviour). With
// Realtime on, a snapshot reaches the browser <1s after the poller writes it;
// on any Realtime failure it degrades back to the 30s poll (fallbackToPoll).
//
// Active ONLY while the Live tab is the active tab AND the page is visible —
// leaving the tab or backgrounding the page stops the timer AND drops the
// WebSocket, so an idle user costs zero requests (cheaper than the Slice-3 overlay).
//
// Requires on window before this script runs:
//   SUPABASE_URL      — project URL, e.g. "https://abcdef.supabase.co"
//   SUPABASE_ANON_KEY — public anon key (browser-safe; RLS restricts writes)

(function () {
  'use strict';

  if (!window.FEATURE_LIVE_PROXY) return;

  // TEN-107 detail panel (founder-approved 2026-08-31): clicking a live card opens
  // a Stats/Points/Ratings modal. Gated behind its OWN flag, default OFF: with the
  // flag unset this module behaves exactly as before (cards are not clickable, no
  // modal), so shipping the code changes nothing live until the confirm-before-live
  // gate flips window.FEATURE_LIVE_DETAIL — the same staging pattern as REALTIME.
  const USE_DETAIL = !!window.FEATURE_LIVE_DETAIL;

  const SB_URL = (window.SUPABASE_URL || '').replace(/\/$/, '');
  const SB_KEY = window.SUPABASE_ANON_KEY || '';
  // Placeholder strings from failed CI substitution must not pass the guard.
  if (!SB_URL || SB_URL.startsWith('__') || !SB_KEY || SB_KEY.startsWith('__')) {
    console.warn('[live-tab] SUPABASE_URL / SUPABASE_ANON_KEY not configured — Live tab disabled');
    return;
  }

  // ─── config ─────────────────────────────────────────────────────────────────
  const POLL_INTERVAL_MS   = 30_000;   // matches the ~30s poller cadence
  const STALE_THRESHOLD_MS = 60_000;   // snapshot older than this → stale banner
  const BACKOFF_BASE_MS    = 30_000;
  const BACKOFF_MAX_MS     = 300_000;
  const SNAPSHOT_ENDPOINT  =
    `${SB_URL}/rest/v1/live_snapshot?select=board,match_count,updated_at&limit=1`;

  // ─── TEN-107 Tier 1 (founder-approved 2026-08-31): Realtime push ──────────────
  // Switch the member read from a 30s PostgREST poll to Supabase Realtime
  // (WebSocket push) so a snapshot reaches the browser <1s after the poller
  // writes it, instead of waiting up to a full poll interval. This removes the
  // browser-side ~15s-avg / 30s-worst poll stage (see doc `live-latency-vs-
  // flashscore`). Gated behind its OWN flag, default OFF: with the flag unset,
  // this module behaves EXACTLY as before (30s poll), so shipping the code
  // changes nothing live until the confirm-before-live gate flips the flag.
  const USE_REALTIME = !!window.FEATURE_LIVE_REALTIME;

  // Raw WebSocket to Supabase Realtime — no SDK on the member path (same ethos
  // as the PostgREST read). Any failure degrades to the 30s poll (fallbackToPoll).
  const RT_URL = `${SB_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SB_KEY)}&vsn=1.0.0`;
  const RT_HEARTBEAT_MS   = 25_000;    // Phoenix drops an idle socket (~60s server side)
  const RT_RESYNC_MS      = 25_000;    // backstop re-fetch (≤ the 30s poll it replaces),
                                       // and the sole data path during reconnect backoff
  const RT_RECONNECT_BASE = 2_000;
  const RT_RECONNECT_MAX  = 60_000;
  const RT_MAX_RETRIES    = 5;         // after this many failed connects → fall back to poll

  // ─── state ──────────────────────────────────────────────────────────────────
  let _timer         = null;
  let _ticking       = false;    // in-flight guard — one request at a time
  let _backoffMs      = 0;
  let _active         = false;   // is the Live tab the currently-shown tab?
  let _lastUpdatedAt  = null;    // ms epoch of last known snapshot (survives errors)
  let _lastMatches    = null;    // last rendered board (for stale re-render)
  let _bootstrapped   = false;   // has the page shell been injected yet?

  // Realtime transport state (only used when USE_REALTIME).
  let _ws            = null;
  let _rtHeartbeat   = null;
  let _rtResync      = null;
  let _rtReconnect   = null;
  let _rtRetries     = 0;
  let _rtConnected   = false;    // Phoenix join acknowledged
  let _rtFellBack    = false;    // realtime gave up → poll loop owns updates
  let _rtRef         = 0;        // monotonic Phoenix message ref

  // When true, tick() re-arms the recurring 30s poll; under live Realtime it does
  // not (pushes + the safety re-sync drive updates), so tick() is a one-shot fetch.
  function pollLoopActive() { return !USE_REALTIME || _rtFellBack; }


  // ─── public: called by the #mainNav tab handler ──────────────────────────────
  function setActive(isLive) {
    if (isLive && !_active) {
      _active = true;
      _backoffMs = 0;
      _rtFellBack = false;      // give Realtime a fresh try on each tab entry
      schedulePoll(0);          // immediate first paint on entering the tab
      if (USE_REALTIME) connectRealtime();   // then stream pushes instead of polling
    } else if (!isLive && _active) {
      _active = false;
      clearTimeout(_timer);     // leaving the tab stops the poll entirely
      closeRealtime();          // and drops the socket — an idle user costs nothing
    }
  }

  // ─── pause on hidden, resume on visible (only matters while active) ───────────
  document.addEventListener('visibilitychange', () => {
    if (!_active) return;
    if (document.hidden) {
      clearTimeout(_timer);
      if (USE_REALTIME) closeRealtime();
    } else {
      _backoffMs = 0;
      if (!_ticking) schedulePoll(0);        // immediate re-paint on return
      if (USE_REALTIME && !_rtFellBack) connectRealtime();
    }
  });

  // ─── PostgREST fetch ──────────────────────────────────────────────────────────
  async function fetchSnapshot() {
    const res = await fetch(SNAPSHOT_ENDPOINT, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`PostgREST ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  // ─── tick ──────────────────────────────────────────────────────────────────────
  async function tick() {
    if (!_active || document.hidden || _ticking) return;
    _ticking = true;

    let row;
    try {
      row = await fetchSnapshot();
      _backoffMs = 0;
    } catch (err) {
      console.warn('[live-tab] fetch failed:', err.message);
      _backoffMs = _backoffMs ? Math.min(_backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_BASE_MS;
      _ticking = false;
      // Re-render with the cached board so the stale banner ages correctly.
      renderStatusOnly();
      if (pollLoopActive()) schedulePoll(_backoffMs);
      return;
    }
    _ticking = false;

    // The user may have left the Live tab or backgrounded the page while the
    // request was in flight — don't render into a hidden grid or re-arm a timer.
    if (!_active || document.hidden) return;

    if (row) applyRow(row);

    if (pollLoopActive()) schedulePoll(POLL_INTERVAL_MS);
  }

  // Apply one snapshot row — from a PostgREST fetch OR a Realtime push — to state
  // and repaint. Shared so both transports render identically.
  function applyRow(row) {
    if (!row) return;
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : null;
    if (updatedAt !== null) _lastUpdatedAt = updatedAt;
    const matches = Array.isArray(row.board?.matches) ? row.board.matches : [];
    _lastMatches = matches;
    render(matches);
    if (USE_DETAIL) Detail.onBoard(matches);   // live-refresh an open modal
  }

  function schedulePoll(delayMs) {
    clearTimeout(_timer);
    _timer = setTimeout(tick, delayMs);
  }

  // ─── Realtime (Phoenix WebSocket) transport ───────────────────────────────────
  // Subscribes to postgres_changes on public.live_snapshot (already added to the
  // supabase_realtime publication in migration …_live_snapshot.sql).
  //
  // A push is a TRIGGER, not the payload: on each change we do a one-shot PostgREST
  // fetch of the row (schedulePoll(0)) rather than rendering the pushed `record`.
  // Rationale — Realtime caps a change record at ~1MB and drops the row data when a
  // busy `board` exceeds it (delivering an errors frame with no record); the
  // PostgREST read has no such cap, so triggering a fetch is robust to board size
  // and to record-shape drift. We still get the latency win (fetch fires the instant
  // the row changes, not on a timer).
  //
  // A backstop re-sync fetch runs every RT_RESYNC_MS regardless of socket health, so
  // data keeps flowing even during reconnect backoff. Any terminal failure — connect
  // throw, a failed postgres_changes binding (`system` error), or exhausted reconnects
  // — degrades to the 30s poll (fallbackToPoll) so the feed never goes dark.
  function connectRealtime() {
    if (!USE_REALTIME || _rtFellBack || !_active || document.hidden) return;
    ensureResync();   // backstop fetch runs regardless of socket state
    if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

    let ws;
    try {
      ws = new WebSocket(RT_URL);
    } catch (e) {
      console.warn('[live-tab] realtime connect threw:', e && e.message);
      return fallbackToPoll();
    }
    _ws = ws;

    ws.onopen = () => {
      _rtRetries = 0;
      // Phoenix join: subscribe to changes on the snapshot row.
      send(ws, 'realtime:live_snapshot', 'phx_join', {
        config: {
          broadcast: { ack: false, self: false },
          presence:  { key: '' },
          postgres_changes: [{ event: '*', schema: 'public', table: 'live_snapshot' }],
          private: false,
        },
        access_token: SB_KEY,
      });
      clearInterval(_rtHeartbeat);
      _rtHeartbeat = setInterval(() => send(ws, 'phoenix', 'heartbeat', {}), RT_HEARTBEAT_MS);
    };

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      // `system` carries the postgres_changes BINDING result — the decisive signal
      // that pushes will actually arrive (phx_reply only confirms the channel join).
      if (msg.event === 'system' && msg.payload && msg.payload.extension === 'postgres_changes') {
        if (msg.payload.status === 'error') return fallbackToPoll();  // binding rejected
        markConnected();
        return;
      }
      // phx_reply ok also flips the label (belt-and-braces if `system` never comes).
      if (msg.event === 'phx_reply') {
        if (msg.payload && msg.payload.status === 'ok') markConnected();
        return;
      }
      if (msg.event === 'postgres_changes') {
        schedulePoll(0);   // trigger a fetch of the fresh row (see rationale above)
        return;
      }
      // presence / broadcast / heartbeat-reply frames: ignore.
    };

    ws.onerror = () => { /* onclose runs next and owns reconnect/fallback */ };

    ws.onclose = () => {
      _rtConnected = false;
      clearInterval(_rtHeartbeat); _rtHeartbeat = null;
      if (_ws === ws) _ws = null;
      if (!_active || document.hidden || _rtFellBack) return;  // deliberately/terminally closed
      if (++_rtRetries > RT_MAX_RETRIES) return fallbackToPoll();
      // NB: _rtResync deliberately keeps running through backoff → data still flows
      // every RT_RESYNC_MS while we reconnect; the stale badge ages honestly meanwhile.
      const delay = Math.min(RT_RECONNECT_BASE * 2 ** (_rtRetries - 1), RT_RECONNECT_MAX);
      clearTimeout(_rtReconnect);
      _rtReconnect = setTimeout(connectRealtime, delay);
    };
  }

  function markConnected() {
    if (_rtConnected) return;
    _rtConnected = true;
    if (_lastMatches) render(_lastMatches);   // refresh status → "live now"
  }

  // Backstop fetch loop; idempotent. Survives reconnect backoff (only closeRealtime
  // tears it down), so a degraded socket still delivers data every RT_RESYNC_MS.
  function ensureResync() {
    if (_rtResync) return;
    _rtResync = setInterval(() => { if (_active && !document.hidden) schedulePoll(0); }, RT_RESYNC_MS);
  }

  function send(ws, topic, event, payload) {
    try { ws.send(JSON.stringify({ topic, event, payload, ref: String(++_rtRef) })); }
    catch { /* socket closing — heartbeat/join will retry on reconnect */ }
  }

  function closeRealtime() {
    clearInterval(_rtHeartbeat); _rtHeartbeat = null;
    clearInterval(_rtResync);    _rtResync = null;
    clearTimeout(_rtReconnect);  _rtReconnect = null;
    _rtConnected = false;
    _rtRetries = 0;
    if (_ws) { try { _ws.close(); } catch {} _ws = null; }
  }

  // Realtime unavailable (connect throw, binding error, or exhausted reconnects) →
  // resume the reliable 30s poll so the user still gets updates, just slower. One-way
  // for the rest of this tab session (reset on the next tab entry). pollLoopActive()
  // flips true so tick() re-arms the loop.
  function fallbackToPoll() {
    if (_rtFellBack) return;
    console.warn('[live-tab] realtime unavailable — falling back to 30s poll');
    closeRealtime();                    // tears down socket/timers, leaves _rtFellBack alone
    _rtFellBack = true;                 // now pollLoopActive() is true → tick() re-arms the loop
    if (_active && !document.hidden) schedulePoll(0);
  }

  // ─── staleness helper ─────────────────────────────────────────────────────────
  function staleness() {
    if (_lastUpdatedAt === null) return { isStale: false, ageMs: 0 };
    const ageMs = Date.now() - _lastUpdatedAt;
    return { isStale: ageMs > STALE_THRESHOLD_MS, ageMs };
  }

  // ─── republish on the error path (no fresh board) ─────────────────────────────
  // A fetch failed. Re-emit the CACHED board with a freshly-computed staleness so
  // the page ages its "Updated" figure honestly instead of freezing on the last
  // good value. With no snapshot ever received, emit ready:false so the renderer
  // shows dashes rather than claiming zero matches are in play.
  function renderStatusOnly() {
    if (_lastUpdatedAt === null) {
      publish({ ready: false, matches: [], live: [], isStale: false, ageMs: 0, updatedAt: null, connected: false });
      return;
    }
    render(_lastMatches || []);
  }

  // ─── a "live" match is one the vendor still flags underway ────────────────────
  function isUnderway(fix) {
    const st = String(fix.event_status || '').toLowerCase();
    const finalWord = st.includes('finished') || st.includes('retired') ||
                      st.includes('walkover') || st.includes('abandoned') ||
                      st.includes('cancel');
    // api-tennis strands event_live="1" with a stale "Set N" status for a window
    // after a match is decided (observed 2026-09-04: 4 finished R2 matches carried
    // event_live=1 + status "Set 1/2/4" while only Zverev–Halys was truly live).
    // event_winner is the reliable tell: it is empty for a live match and stamped
    // ("First Player"/"Second Player") the instant the result is decided — so a
    // decided match drops off the Live tab immediately, before its status flips.
    // Harden the "decided" tell against string sentinels: today the feed uses
    // null/empty for in-play, but if api-tennis ever stamps a placeholder
    // ("None"/"null"/"-"/whitespace) we must NOT read it as decided — that would
    // drop a genuinely live match off the board (the costly failure direction).
    const winnerTell = String(fix.event_winner ?? '').trim().toLowerCase();
    const decided = winnerTell !== '' && winnerTell !== 'none' &&
                    winnerTell !== 'null' && winnerTell !== '-';
    // event_live is the vendor's own live flag ("1"); trust it, but a match that
    // has gone Final while still on the live board should drop off the Live tab.
    return String(fix.event_live) === '1' && !finalWord && !decided;
  }

  // ATP singles only for launch — founder ruling (TEN-91, 2026-08-31): the Live
  // tab defaults to ATP-only so the board reads as tour-level, not ITF/Challenger
  // filler. event_type_type carries the tour ("Atp Singles" / "Wta Singles" /
  // "Challenger Men Singles" / "Itf Men Singles"); the /atp/ + /single/ pair is
  // the same ATP-singles idiom already used in build-tournament-entries.js.
  // Doubles ("A/ B" compound names, no per-player model context) are excluded
  // either way. To widen later (ATP+Challenger, or all singles), relax this one
  // predicate — nothing else in the render path is tour-specific.
  function isAtpSingles(fix) {
    const t = String(fix.event_type_type || '');
    return /atp/i.test(t) && /single/i.test(t);
  }

  // ─── publish the board to the #lvTab renderer ─────────────────────────────────
  // TEN-190: this module no longer paints the Live page. The renderer is the
  // Claude Design handoff build that owns #lvTab in bsp-consult-dashboard.html;
  // this module is the DATA layer — it owns the transport (Realtime / poll), the
  // ATP-singles + underway gate, the box-score index and the rating formulas, and
  // hands each board to whoever subscribed via window.LiveFeed.subscribe().
  //
  // The function keeps the name `render` because tick()/applyRow() call it on
  // every snapshot; what it renders is now a payload, not DOM.
  function render(matches) {
    const all = Array.isArray(matches) ? matches : [];
    const live = all.filter(isAtpSingles).filter(isUnderway);
    const { isStale, ageMs } = staleness();
    publish({
      ready: true,
      matches: all,
      live,
      isStale,
      ageMs,
      updatedAt: _lastUpdatedAt,
      connected: !!(USE_REALTIME && _rtConnected && !_rtFellBack),
    });
  }

  // Fan a payload out to every subscriber. Subscribers register into a plain
  // array on window because the #lvTab block is an INLINE script and therefore
  // runs during parse, i.e. BEFORE this deferred module executes — it cannot call
  // an API that does not exist yet, so it queues and we drain.
  function publish(payload) {
    const subs = window.__LV_SUBS;
    if (!Array.isArray(subs)) return;
    for (const fn of subs) {
      try { fn(payload); } catch (err) { console.warn('[live-tab] subscriber failed:', err && err.message); }
    }
  }

  // TEN-190: cardHtml / playerRow / setCells / gamePoints and the #liveGrid,
  // #liveStatus refs are REMOVED. They painted the pre-handoff board into a
  // container that no longer exists, which is how this module silently became
  // a no-op: the render call succeeded and wrote nothing. The Live page is now
  // rendered by the #lvTab block; this module is the data layer. setScoreHtml
  // and shortRound stay — the detail modal still uses them.

  // A completed tiebreak set arrives from api-tennis encoded as
  // "<games>.<tiebreakPoints>" per side — e.g. score_first "7.7" / score_second
  // "6.1" for a 7-6(1) set — NOT a decimal game count. Render Flashscore-style:
  // games in full with that side's own tiebreak points as a superscript (7⁷ / 6¹).
  // A non-tiebreak set (or an in-progress set) carries no ".", so it renders plain.
  function setScoreHtml(raw) {
    if (raw == null) return '';
    const s = String(raw).trim();
    if (s === '') return '';
    const dot = s.indexOf('.');
    if (dot < 0) return esc(s);
    const games = s.slice(0, dot);
    const tb = s.slice(dot + 1);
    return tb === '' ? esc(games) : `${esc(games)}<sup>${esc(tb)}</sup>`;
  }

  // "M15 Maanshan 8 - Semi-finals" → "Semi-finals". The round is prefixed with
  // the tournament label, but the prefix isn't always an exact match of
  // tournament_name (e.g. name carries a "(Egypt)" suffix the round omits), so
  // strip everything up to and including the last " - " rather than the name.
  function shortRound(fix) {
    const r = String(fix.tournament_round || '');
    const idx = r.lastIndexOf(' - ');
    return esc(idx >= 0 ? r.slice(idx + 3) : r);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // TEN-107 · Match-detail panel (Stats / Points / Ratings). Gated on USE_DETAIL.
  //
  // Data sources (founder-approved 2026-08-31):
  //   • Stats + Ratings headline  ← the SAME live_snapshot board the tab polls
  //     (fixture.statistics carries match/set1/set2 box scores; no extra fetch).
  //   • Points + Ratings chart    ← live_pbp, fetched ON DEMAND via PostgREST only
  //     while the modal is open (the point log is kept off the pushed Realtime row
  //     to halve Slam-day egress — see doc `detail-view-cost`).
  //
  // Ratings are the house Serve / Return ratings (house-ratings.js — TEN-327, founder
  //   2026-09-28: one formula per stat name, the same helper as the Match stats sheet) on
  //   match-to-date stats, RAW. No sample floor; a missing component is "—", never 0.
  //   serve = 1stIn% + 1stWon% + 2ndWon% + hold% + aces − double faults (match counts)
  //   return = 1stRetWon% + 2ndRetWon% + returnGamesWon% + bpConversion%
  //   Dominance Ratio = returnPtsWon% / (100 − servicePtsWon%)   (Bialik)
  // ══════════════════════════════════════════════════════════════════════════════
  const Detail = (function () {
    const PBP_MAX_AGE_MS   = 12_000;

    let _ek = null;                // open match's event_key (null = closed)
    let _tab = 'stats';            // stats | points | holdbreak
    let _statPeriod = 'match';     // match | set1 | set2 …
    let _ptsSet = 1;               // Points tab set filter
    let _hbMetric = 'hold';        // Hold/Break tab metric: 'hold' | 'break' (default HOLD)
    const _pbp = Object.create(null);   // ek → { games, at, loading }

    const num = (s) => { const v = parseFloat(String(s).replace('%', '')); return Number.isFinite(v) ? v : null; };
    const pk  = (fix, which) => fix[`${which === 1 ? 'first' : 'second'}_player_key`];

    // Build stat lookup: byPlayer[player_key][period][stat_name] = {value,won,total}.
    //
    // The index key is LOWERCASED, and so is every lookup in g() below. The feed's
    // stat_name casing drifts by season — measured 2026-09-18 over all 12,115
    // finished ATP singles 2024-01→2026-09: 2024 and 2025 emit "1st Serve
    // Percentage" / "Service Games Won", 2026 emits "1st serve percentage" /
    // "Service games won", and the flip lands mid-week in January 2026 (84 finished
    // 2026 fixtures — Brisbane, Hong Kong, United Cup, 2026-01-02..01-08 — still
    // carry the old casing). Five of the ten literals g() is called with are
    // lowercase-only, so keying raw made serveRating()/returnRating() return
    // {rating:null} on every Title-Case fixture: the whole 2024+2025 corpus and
    // that first week of 2026. A blank rating is indistinguishable from "the feed
    // hasn't published it yet", which is why it went unnoticed.
    //
    // Names that never drifted (Aces, Double Faults, Break Points Saved/Converted,
    // Total Points Won, Service/Return Points Won) are not evidence the rest won't
    // flip back — lowercasing both sides is the only read that survives either
    // casing. tools/test-statname-casing.js fails the build on a raw comparison.
    function indexStats(fix) {
      const idx = Object.create(null);
      const st = Array.isArray(fix.statistics) ? fix.statistics : [];
      const periods = new Set();
      for (const s of st) {
        const key = String(s.player_key);
        const per = String(s.stat_period || 'match');
        periods.add(per);
        (idx[key] = idx[key] || {});
        (idx[key][per] = idx[key][per] || {});
        idx[key][per][String(s.stat_name).toLowerCase()] = { value: s.stat_value, won: s.stat_won, total: s.stat_total };
      }
      return { idx, periods };
    }
    const g = (idx, pkey, per, name) => (idx[String(pkey)] && idx[String(pkey)][per] && idx[String(pkey)][per][String(name).toLowerCase()]) || null;

    // The box-score side in the match-stats shape house-ratings.js reads: rates as their
    // {won,total} counts (rebuilt from the count, never the feed's rounded %), aces/DFs as counts.
    const boxSide = (idx, pkey, per) => {
      const c = (name) => { const r = g(idx, pkey, per, name); return r ? { won: num(r.won), total: num(r.total) } : null; };
      const n = (name) => { const r = g(idx, pkey, per, name); return r ? num(r.value) : null; };
      return {
        'Service:Aces': n('Aces'), 'Service:Double Faults': n('Double Faults'),
        raw: {
          'Service:1st serve points won': c('1st serve points won'), 'Service:2nd serve points won': c('2nd serve points won'),
          'Games:Service games won': c('Service games won'), 'Games:Return games won': c('Return games won'),
          'Return:1st return points won': c('1st return points won'), 'Return:2nd return points won': c('2nd return points won'),
          'Return:Break Points Converted': c('Break Points Converted'),
        },
      };
    };
    const house = () => (typeof window !== 'undefined' && window.HouseRatings) || null;
    function serveRating(idx, pkey, per) {
      const H = house();
      return { rating: H ? H.fromBoxSide(boxSide(idx, pkey, per)).serve.v : null };
    }
    function returnRating(idx, pkey, per) {
      const H = house();
      return { rating: H ? H.fromBoxSide(boxSide(idx, pkey, per)).ret.v : null };
    }
    function dominance(idx, pkey, per) {
      const rpw = num(g(idx, pkey, per, 'Return Points Won')?.value);
      const spw = num(g(idx, pkey, per, 'Service Points Won')?.value);
      if (rpw == null || spw == null || (100 - spw) <= 0) return null;
      return rpw / (100 - spw);
    }

    // ── diverging bar (P1 left / P2 right), each half ∝ its value over max. ──
    function bar(v1, v2) {
      const a = Math.max(0, v1 || 0), b = Math.max(0, v2 || 0), mx = Math.max(a, b, 1e-9);
      const lw = (50 * a / mx).toFixed(1), rw = (50 * b / mx).toFixed(1);
      return `<div class="ltm-bar"><span class="l" style="width:${lw}%"></span><span class="r" style="width:${rw}%"></span></div>`;
    }
    const bracket = (row) => (row && row.won != null && row.total != null) ? `<small>(${esc(row.won)}/${esc(row.total)})</small>` : '';

    // ── Stats tab ──────────────────────────────────────────────────────────────
    const SERVICE_ROWS = [
      { name: 'Aces',                  pct: false, brk: false },
      { name: 'Double Faults',         pct: false, brk: false },
      { name: '1st serve percentage',  pct: true,  brk: false },
      { name: '1st serve points won',  pct: true,  brk: true  },
      { name: '2nd serve points won',  pct: true,  brk: true  },
      { name: 'Break Points Saved',    pct: true,  brk: true  },
    ];
    function statsHtml(fix, idx, periods) {
      const p1 = pk(fix, 1), p2 = pk(fix, 2);
      const per = _statPeriod;
      // toggle: MATCH + whatever setN periods exist, in order.
      const setPers = [...periods].filter(x => /^set\d+$/.test(x)).sort();
      const toggle = ['match', ...setPers].map(x => {
        const lab = x === 'match' ? 'MATCH' : `SET ${x.slice(3)}`;
        return `<button data-per="${x}" class="${x === per ? 'active' : ''}">${lab}</button>`;
      }).join('');

      const dr1 = dominance(idx, p1, per), dr2 = dominance(idx, p2, per);
      const domHtml = (dr1 != null || dr2 != null) ? `
        <div class="ltm-section">
          <div class="ltm-sec-title">Dominance</div>
          <div class="ltm-stat">
            <div class="ltm-stat-row">
              <span class="ltm-sv">${dr1 != null ? dr1.toFixed(2) : '—'}</span>
              <span class="ltm-sn">Dominance Ratio</span>
              <span class="ltm-sv r">${dr2 != null ? dr2.toFixed(2) : '—'}</span>
            </div>
            ${bar(dr1, dr2)}
          </div>
        </div>` : '';

      const rows = SERVICE_ROWS.map(r => {
        const a = g(idx, p1, per, r.name), b = g(idx, p2, per, r.name);
        const av = a ? a.value : '—', bv = b ? b.value : '—';
        const an = r.pct ? num(av) : num(a && a.value), bn = r.pct ? num(bv) : num(b && b.value);
        return `<div class="ltm-stat">
          <div class="ltm-stat-row">
            <span class="ltm-sv">${esc(av ?? '—')}${r.brk ? bracket(a) : ''}</span>
            <span class="ltm-sn">${esc(r.name)}</span>
            <span class="ltm-sv r">${r.brk ? bracket(b) : ''}${esc(bv ?? '—')}</span>
          </div>
          ${bar(an, bn)}
        </div>`;
      }).join('');

      return `<div class="ltm-toggle">${toggle}</div>${domHtml}
        <div class="ltm-section"><div class="ltm-sec-title">Service</div>${rows}</div>`;
    }

    // ── Points tab (needs pbp) ───────────────────────────────────────────────────
    function pointsHtml(fix) {
      const entry = _pbp[_ek];
      if (!entry || entry.loading) return `<div class="ltm-note">Loading point log…</div>`;
      if (entry.error) return `<div class="ltm-note">Point log unavailable right now.</div>`;
      const games = Array.isArray(entry.games) ? entry.games : [];
      if (!games.length) return `<div class="ltm-note">No points logged yet.</div>`;

      const setNums = [...new Set(games.map(gm => setNo(gm)))].filter(Boolean).sort((a, b) => a - b);
      const cur = setNums.includes(_ptsSet) ? _ptsSet : (setNums[setNums.length - 1] || 1);
      const toggle = setNums.map(n => `<button data-set="${n}" class="${n === cur ? 'active' : ''}">SET ${n}</button>`).join('');
      const n1 = esc(fix.event_first_player || 'Player 1'), n2 = esc(fix.event_second_player || 'Player 2');

      const blocks = games.filter(gm => setNo(gm) === cur).map(gm => {
        // Player 1 is ALWAYS the left column, player 2 the right (matches gm.score's
        // fixed P1–P2 orientation and the reference layout); the serve dot + colour
        // mark whichever side is serving — the non-server's name is dimmed.
        const p1serves = /first/i.test(String(gm.player_served || '')) ||
                         (!gm.player_served && /first/i.test(String(gm.serve_winner || gm.serve_lost || '')));
        const broke = !!gm.serve_lost;                         // server lost = a break
        const score = esc(gm.score || '');
        const ball = '<span class="ltm-serveball">●</span>';
        const pts = (Array.isArray(gm.points) ? gm.points : []).map(pt => {
          const isBp = pt.break_point != null && pt.break_point !== '';
          return `<span class="ltm-pt${isBp ? ' bp' : ''}">${esc(pt.score || '')}${isBp ? '<span class="bpb">BP</span>' : ''}</span>`;
        }).join('');
        return `<div class="ltm-game${broke ? ' brk' : ''}">
          <div class="ltm-game-hd">
            <span class="ltm-game-srv p1${p1serves ? '' : ' dim'}">${p1serves ? ball : ''}<span class="n">${n1}</span></span>
            <span class="ltm-game-sc">${score}${broke ? '<span class="ltm-brk-badge">BREAK</span>' : ''}</span>
            <span class="ltm-game-srv r p2${p1serves ? ' dim' : ''}">${p1serves ? '' : ball}<span class="n">${n2}</span></span>
          </div>
          <div class="ltm-game-lab">GAME ${esc(gm.number_game || '')}</div>
          <div class="ltm-pts">${pts}</div>
        </div>`;
      }).join('');

      return `<div class="ltm-toggle">${toggle}</div>${blocks || '<div class="ltm-note">No games in this set yet.</div>'}`;
    }
    const setNo = (gm) => { const m = String(gm.set_number || '').match(/(\d+)/); return m ? +m[1] : null; };

    // ── Hold/Break HeatMap tab (founder GRID RULING TEN-107, 2026-09-02) ─────────
    // Rebuilt to the DataEdge reference. One metric at a time via a HOLD | BREAK
    // segmented toggle (default HOLD). Columns = GLOBAL anchor (across-sets total,
    // visually DOMINANT — wider, heavier, divided off) then one per set S1..S5.
    // Rows = SIX single-ordinal rows, the server's service-game ordinal within the
    // set, labelled by their game-number range: Game 1-2 / 3-4 / 5-6 / 7-8 / 9-10 /
    // 11-12+ (row 6 folds ordinal 7+, which is 2.03% of games). Every cell shows
    // its percentage over the raw fraction (won/n); NO sample floor — the fraction
    // is the honesty mechanism, and a no-data cell is an em-dash “—” (a genuine 0/3
    // still shows 0%). Colour = diverging red/neutral/green by each cell's deviation
    // from that row's own GLOBAL value — but a cell whose DENOMINATOR is below
    // HB_DESAT_N is DESATURATED (neutral fill, text unaltered) so a 3/3 in loud
    // green can't shout over a real sample. GLOBAL (summed across sets) is almost
    // always above the threshold, so the eye lands on the number that's real for
    // everyone. Data = the pre-computed holdbreak.json rollup (ZERO live API);
    // pooled 'all' surface (a live modal has no clean surface field).
    const HB_BUCKETS  = [
      ['1', 'Game 1-2',   '1st svc game'],
      ['2', 'Game 3-4',   '2nd svc game'],
      ['3', 'Game 5-6',   '3rd svc game'],
      ['4', 'Game 7-8',   '4th svc game'],
      ['5', 'Game 9-10',  '5th svc game'],
      ['6', 'Game 11-12+', '6th+ svc game'],
    ];
    const HB_SETCOLS  = ['1', '2', '3', '4', '5'];   // GLOBAL is derived (sum of these)
    const HB_NEUTRAL_BAND = 2;   // ±pp around row-GLOBAL that reads neutral
    const HB_FULL_DEV     = 12;  // ±pp deviation that saturates the colour
    const HB_DESAT_N      = 20;  // set-cell denominator below this → desaturated (colour muted, % + fraction unchanged). A display parameter, not a floor; move it without a rebuild.

    // Sum {won,n} cells into one {won,n,pct}. Exact — numerators summed, never a
    // pct-of-pcts average. Used for the GLOBAL column and the aggregate pill.
    function hbSum(cells) {
      let won = 0, n = 0;
      // Require `won` so GLOBAL/pill fall back to “—” (not 0/n) if a pre-numerator
      // shard is transiently served during a deploy; identical in steady state.
      for (const c of cells) { if (c && c.n && c.won != null) { won += c.won; n += c.n; } }
      return { won, n, pct: n ? (won / n) * 100 : null };
    }
    // Diverging colour by deviation of this cell's pct from its row-GLOBAL pct.
    // Above the player's own baseline for that depth = green, below = red — for
    // BOTH metrics (higher break% is good for the returner, higher hold% for the
    // server). GLOBAL cell has deviation 0 → neutral, so it never colours itself.
    function hbCellStyle(pct, rowGlobalPct) {
      if (pct == null || rowGlobalPct == null) return 'background:var(--surface);';
      const d = pct - rowGlobalPct;
      if (Math.abs(d) <= HB_NEUTRAL_BAND) return 'background:rgba(120,132,156,0.10);';
      const t = Math.min(1, (Math.abs(d) - HB_NEUTRAL_BAND) / (HB_FULL_DEV - HB_NEUTRAL_BAND));
      const a = (0.12 + 0.45 * t).toFixed(3);
      return d > 0 ? `background:rgba(61,214,140,${a});` : `background:rgba(232,104,95,${a});`;
    }
    // One set heat cell: big % over raw fraction, coloured vs its row GLOBAL. No
    // data at all → em-dash; a genuine 0/n still shows 0% over 0/n. A cell whose
    // denominator is below HB_DESAT_N keeps its % and fraction verbatim but its
    // colour is neutralised (desaturated) so a tiny sample can't shout in green/red.
    function hbCell(cell, rowGlobalPct) {
      // `won` gate also degrades gracefully if an old-schema shard (no numerator)
      // is briefly served from CDN cache alongside this newer code: cells show “—”
      // and self-heal once the rebuilt shard propagates, rather than “undefined/n”.
      const has = !!(cell && cell.n > 0 && cell.pct != null && cell.won != null);
      if (!has) {
        return `<div style="border-radius:7px;padding:8px 3px;text-align:center;background:var(--surface);">
          <div style="font-size:15px;font-weight:700;font-family:'IBM Plex Mono',monospace;line-height:1;color:var(--label);">—</div>
        </div>`;
      }
      const thin = cell.n < HB_DESAT_N;
      const bg = thin ? 'background:rgba(120,132,156,0.07);' : hbCellStyle(cell.pct, rowGlobalPct);
      // Thin cells dim the % slightly (still fully legible) as a second, quieter cue.
      const pctColor = thin ? 'rgba(231,233,238,0.80)' : '#ebf1f2';
      return `<div style="border-radius:7px;padding:8px 3px;text-align:center;min-width:0;${bg}">
        <div style="font-size:15px;font-weight:700;font-family:'IBM Plex Mono',monospace;line-height:1;color:${pctColor};">${Math.round(cell.pct)}%</div>
        <div style="font-size:9.5px;font-family:'IBM Plex Mono',monospace;margin-top:3px;color:rgba(231,233,238,0.62);white-space:nowrap;">${cell.won}/${cell.n}</div>
      </div>`;
    }
    // The GLOBAL anchor cell for a bucket row — the DOMINANT column: wider, heavier
    // fill + border, larger type, no diverge colour (it IS the baseline). GLOBAL is
    // the number that survives at every rank tier; the visual weight says so.
    function hbGlobalCell(g) {
      if (!g.n) {
        return `<div style="border-radius:8px;padding:9px 4px;text-align:center;background:var(--surface);border:0.33px solid var(--line);">
          <div style="font-size:16px;font-weight:700;font-family:'IBM Plex Mono',monospace;line-height:1;color:var(--label);">—</div>
        </div>`;
      }
      return `<div style="border-radius:8px;padding:9px 4px;text-align:center;background:rgba(143,160,192,0.22);border:0.33px solid var(--line);box-shadow:inset 0 0 0 1px rgba(143,160,192,0.10);">
        <div style="font-size:19px;font-weight:800;font-family:'IBM Plex Mono',monospace;line-height:1;color:var(--text);">${Math.round(g.pct)}%</div>
        <div style="font-size:10px;font-family:'IBM Plex Mono',monospace;margin-top:4px;color:rgba(231,233,238,0.82);white-space:nowrap;">${g.won}/${g.n}</div>
      </div>`;
    }
    // A full-height vertical rule separating the GLOBAL anchor from the per-set columns.
    const HB_DIVIDER = `<div style="width:1px;height:100%;margin:0 auto;background:rgba(143,160,192,0.28);border-radius:1px;"></div>`;
    // One player's grid for the active metric. node[set][bucket] = {pct,n,won}.
    // Layout: row-label | GLOBAL (wide) | divider | S1..S5. GLOBAL is visually
    // dominant; the per-set columns share the remaining width and thin out for the tail.
    function hbGrid(node) {
      node = node || {};
      const cols = `58px 92px 13px repeat(${HB_SETCOLS.length},1fr)`;   // label | GLOBAL | rule | S1..S5
      const head = `<div style="display:grid;grid-template-columns:${cols};gap:5px;margin-bottom:6px;align-items:end;">
        <span></span>
        <span style="font-size:10px;letter-spacing:0.10em;color:var(--text-soft);font-weight:800;font-family:'IBM Plex Mono',monospace;text-align:center;">GLOBAL</span>
        <span></span>
        ${HB_SETCOLS.map(s => `<span style="font-size:9.5px;letter-spacing:0.04em;color:var(--label);font-family:'IBM Plex Mono',monospace;text-align:center;">S${s}</span>`).join('')}
      </div>`;
      const rows = HB_BUCKETS.map(b => {
        const rowCells = HB_SETCOLS.map(s => (node[s] || {})[b[0]]);
        const g = hbSum(rowCells);
        return `<div style="display:grid;grid-template-columns:${cols};gap:5px;margin-bottom:5px;align-items:stretch;">
          <div style="display:flex;flex-direction:column;justify-content:center;">
            <span style="font-size:11.5px;font-weight:700;color:var(--text-soft);white-space:nowrap;">${b[1]}</span>
            <span style="font-size:8px;color:var(--label);line-height:1.15;">${b[2]}</span>
          </div>
          ${hbGlobalCell(g)}
          ${HB_DIVIDER}
          ${rowCells.map(c => hbCell(c, g.pct)).join('')}
        </div>`;
      }).join('');
      return head + rows;
    }
    // One side-by-side player block: avatar + name + recomputed aggregate pill.
    function hbPlayerBlock(pd, name, logo, metric) {
      const node = pd && (metric === 'hold' ? (pd.serve && pd.serve.all) : (pd.return && pd.return.all));
      const av = logo
        ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:30px;height:30px;border-radius:50%;object-fit:cover;background:var(--surface);flex-shrink:0;">`
        : `<span style="width:30px;height:30px;border-radius:50%;background:var(--surface);flex-shrink:0;display:inline-block;"></span>`;
      const pillLbl = metric === 'hold' ? 'HOLD' : 'BREAK';
      let pill = '—';
      if (node) {
        const all = [];
        for (const s of HB_SETCOLS) for (const b of HB_BUCKETS) all.push((node[s] || {})[b[0]]);
        const agg = hbSum(all);
        if (agg.n) pill = `${agg.pct.toFixed(1)}%`;
      }
      const nm = `<div style="display:flex;align-items:center;gap:9px;margin-bottom:12px;min-width:0;">
        ${av}
        <span style="font-size:13px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;">${esc(name || '—')}</span>
        <span style="font-size:11px;font-weight:800;font-family:'IBM Plex Mono',monospace;color:var(--text);background:var(--surface);border:1px solid #262B35;border-radius:999px;padding:4px 10px;white-space:nowrap;">${pillLbl} ${pill}</span>
      </div>`;
      if (!node) {
        return `<div style="flex:1;min-width:330px;">${nm}<div style="font-size:12px;color:var(--label);">No ${metric} history yet.</div></div>`;
      }
      return `<div style="flex:1;min-width:330px;">${nm}${hbGrid(node)}</div>`;
    }
    function holdbreakHtml(fix) {
      const HB = (window.__h2hEnv && typeof window.__h2hEnv.holdbreak === 'function')
        ? window.__h2hEnv.holdbreak() : (window.holdbreak || null);
      if (!HB || !HB.players) return `<div class="ltm-note">Loading hold/break history…</div>`;
      const pa = HB.players[String(pk(fix, 1))], pb = HB.players[String(pk(fix, 2))];
      if (!pa && !pb) return `<div class="ltm-note">No hold/break history for either player yet.</div>`;
      const metric = _hbMetric;                       // 'hold' | 'break'
      const winM = (HB.meta && HB.meta.windowMonths) || 24;
      const chip = `ALL SURFACES · LAST ${winM}M`;
      const tip = `Service hold % (HOLD) and return break % (BREAK) by the server's service-game within the set — one row per service game (Game 1-2 = 1st, … Game 11-12+ = 6th, folding the rare 7th+). GLOBAL is the across-sets total and the anchor — it stays real for everyone; the per-set columns S1–S5 thin out down the roster. Each cell shows its raw fraction (won/n). Colour = the cell's deviation from that row's GLOBAL: green = stronger than the player's own baseline at that depth, red = weaker. Cells on a thin sample (< ${HB_DESAT_N} games) keep their number but drop their colour, so a small sample can't shout. No sample floor — “—” means no matches yet. Pooled across all surfaces, last ${winM} months.`;
      const tog = (m, lbl) => `<button data-hbmetric="${m}" class="${m === metric ? 'active' : ''}">${lbl}</button>`;
      const head = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="font-size:14px;font-weight:800;color:var(--text);">Hold/Break HeatMap</span>
            <span title="${esc(tip)}" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;border:1px solid #40506b;color:var(--text-sub);font-size:10px;font-weight:700;cursor:help;flex-shrink:0;">i</span>
          </div>
          <div style="margin-top:8px;"><span style="display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:0.07em;font-family:'IBM Plex Mono',monospace;color:var(--text-sub);background:var(--surface);border:1px solid #262B35;border-radius:999px;padding:3px 10px;">${chip}</span></div>
        </div>
        <div class="ltm-toggle" style="margin:0;">${tog('hold', 'HOLD')}${tog('break', 'BREAK')}</div>
      </div>`;
      return `<div class="ltm-section" style="padding:16px;">
        ${head}
        <div style="display:flex;gap:24px;flex-wrap:wrap;">
          ${hbPlayerBlock(pa, fix.event_first_player, fix['event_first_player_logo'], metric)}
          ${hbPlayerBlock(pb, fix.event_second_player, fix['event_second_player_logo'], metric)}
        </div>
      </div>`;
    }


    // ── modal shell + header ─────────────────────────────────────────────────────
    let _overlay = null;
    function ensureOverlay() {
      if (_overlay) return _overlay;
      _overlay = document.createElement('div');
      _overlay.className = 'ltm-overlay';
      _overlay.innerHTML = `<div class="ltm" role="dialog" aria-modal="true"></div>`;
      _overlay.addEventListener('click', (e) => { if (e.target === _overlay) close(); });
      document.body.appendChild(_overlay);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _ek) close(); });
      return _overlay;
    }

    function findFix(matches, ek) {
      return (Array.isArray(matches) ? matches : []).find(f => String(f.event_key) === String(ek)) || null;
    }

    function headerHtml(fix) {
      const tour = /wta/i.test(String(fix.event_type_type)) ? 'WTA' : 'ATP';
      const tn = esc(fix.tournament_name || '');
      const rnd = shortRound(fix);
      const av = (which) => {
        const logo = fix[`event_${which === 1 ? 'first' : 'second'}_player_logo`] || '';
        return logo ? `<img class="ltm-av" src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ltm-av"></span>`;
      };
      const scores = Array.isArray(fix.scores) ? fix.scores : [];
      const gr = String(fix.event_game_result || '').split('-').map(s => s.trim());
      const serveIsFirst = /first/i.test(String(fix.event_serve || ''));
      const line = (which) => {
        const cells = scores.map((sc, i) => {
          const v = which === 1 ? sc.score_first : sc.score_second;
          const curCls = i === scores.length - 1 ? ' class="cur"' : '';
          return `<span${curCls}>${setScoreHtml(v)}</span>`;
        }).join('');
        const pt = (which === 1 ? gr[0] : gr[1]);
        const ptCell = (pt && pt !== '-') ? `<span class="cur">${esc(pt)}</span>` : '';
        const ball = ((which === 1) === serveIsFirst) ? '<span class="ltm-serveball">●</span>' : '';
        return `${cells}${ptCell}${ball}`;
      };
      return `
        <div class="ltm-top">${tour} · ${tn}${rnd ? ` · ${rnd}` : ''}<button class="ltm-close" aria-label="Close">×</button></div>
        <div class="ltm-head">
          <div class="ltm-p p1">${av(1)}<span class="ltm-pname">${esc(fix.event_first_player || '—')}</span></div>
          <div class="ltm-score"><div class="ltm-scoreline">${line(1)}</div><div class="ltm-scoreline">${line(2)}</div></div>
          <div class="ltm-p p2">${av(2)}<span class="ltm-pname">${esc(fix.event_second_player || '—')}</span></div>
        </div>
        <div class="ltm-tabs">
          <button class="ltm-tab ${_tab === 'stats' ? 'active' : ''}" data-tab="stats">Stats</button>
          <button class="ltm-tab ${_tab === 'points' ? 'active' : ''}" data-tab="points">Points</button>
          <button class="ltm-tab ${_tab === 'holdbreak' ? 'active' : ''}" data-tab="holdbreak">Break/Hold</button>
        </div>`;
    }

    function renderBody(fix) {
      const { idx, periods } = indexStats(fix);
      if (_tab === 'stats')     return statsHtml(fix, idx, periods);
      if (_tab === 'points')    return pointsHtml(fix);
      if (_tab === 'holdbreak') return holdbreakHtml(fix);
      return statsHtml(fix, idx, periods);
    }

    function paint() {
      if (_ek == null) return;
      const fix = findFix(_lastMatches, _ek);
      const modal = _overlay && _overlay.querySelector('.ltm');
      if (!modal) return;
      const useFix = fix || _lastFix;   // match may have ended mid-view; keep the last fixture
      if (!useFix) return;
      _lastFix = useFix;
      // The Hold/Break HeatMap needs the DOMINANT GLOBAL column + a divider + S1..S5
      // side-by-side for two players (ATP best-of-five). The wider GLOBAL anchor eats
      // horizontal room, so widen to 1040px while that tab is active to keep the raw
      // fractions readable; every other tab renders at its designed 720px. Scoped here
      // in JS so the shared .ltm CSS and the Stats/Points/Ratings tabs are untouched
      // (founder do-not-touch list).
      modal.style.maxWidth = (_tab === 'holdbreak') ? '1040px' : '';
      modal.innerHTML = headerHtml(useFix) + `<div class="ltm-body">${renderBody(useFix)}</div>`;
      wire(modal, useFix);
    }
    let _lastFix = null;

    function wire(modal, fix) {
      modal.querySelector('.ltm-close')?.addEventListener('click', close);
      modal.querySelectorAll('.ltm-tab').forEach(b => b.addEventListener('click', () => {
        _tab = b.getAttribute('data-tab');
        if (_tab === 'points') ensurePbp();
        paint();
      }));
      modal.querySelectorAll('.ltm-toggle button[data-per]').forEach(b =>
        b.addEventListener('click', () => { _statPeriod = b.getAttribute('data-per'); paint(); }));
      modal.querySelectorAll('.ltm-toggle button[data-set]').forEach(b =>
        b.addEventListener('click', () => { _ptsSet = +b.getAttribute('data-set'); paint(); }));
      modal.querySelectorAll('.ltm-toggle button[data-hbmetric]').forEach(b =>
        b.addEventListener('click', () => { _hbMetric = b.getAttribute('data-hbmetric'); paint(); }));
    }

    async function ensurePbp() {
      const ek = _ek; if (ek == null) return;
      const e = _pbp[ek];
      if (e && !e.error && (Date.now() - e.at) < PBP_MAX_AGE_MS) return;
      if (e && e.loading) return;
      _pbp[ek] = { ...(e || {}), loading: true, at: (e && e.at) || 0, games: e && e.games };
      if (!e) paint();   // show "Loading…" on first open
      try {
        const res = await fetch(`${SB_URL}/rest/v1/live_pbp?select=pbp&event_key=eq.${encodeURIComponent(ek)}&limit=1`, {
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`pbp ${res.status}`);
        const rows = await res.json();
        const games = (Array.isArray(rows) && rows[0] && Array.isArray(rows[0].pbp)) ? rows[0].pbp : [];
        _pbp[ek] = { games, at: Date.now(), loading: false };
      } catch (err) {
        console.warn('[live-tab] pbp fetch failed:', err.message);
        _pbp[ek] = { ...(e || {}), loading: false, error: true, at: Date.now() };
      }
      if (_ek === ek) paint();
    }

    function open(ek) {
      _ek = String(ek); _tab = 'stats'; _statPeriod = 'match'; _ptsSet = 1; _lastFix = null;
      ensureOverlay().classList.add('open');
      document.body.style.overflow = 'hidden';
      paint();
    }
    function close() {
      _ek = null; _lastFix = null;
      if (_overlay) _overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    // Called on every snapshot apply — live-refresh the open modal (Stats/header),
    // and refresh pbp in the background if the Points/Ratings tab is showing.
    function onBoard(matches) {
      if (_ek == null) return;
      if (_tab === 'points') ensurePbp();
      paint();
    }

    // TEN-190: the #lvTab renderer needs the box-score index and the model's own
    // rating formulas. Export them rather than reimplementing — one definition of
    // Serve / Return / Dominance keeps the Live tab and the model from diverging.
    return { open, close, onBoard, indexStats, stat: g, serveRating, returnRating, dominance, num };
  })();

  // ─── TEN-190: on-demand point log for the #lvTab renderer ─────────────────────
  // Same source and TTL as the modal's own fetch, but keyed by event_key so the
  // renderer can ask for any match. The point log is deliberately NOT on the
  // Realtime-pushed snapshot row (it is ~43% of the payload) — it is fetched only
  // while a modal is open, which is what keeps Slam-day egress bounded.
  const _pbpCache = Object.create(null);   // ek → { games, at, loading, error }
  const PBP_TTL = 12_000;
  function pbpGet(ek) { return _pbpCache[String(ek)] || null; }
  async function pbpLoad(ek, onDone) {
    const key = String(ek);
    const e = _pbpCache[key];
    if (e && e.loading) return;
    if (e && !e.error && (Date.now() - e.at) < PBP_TTL) return;
    _pbpCache[key] = { games: e && e.games, at: (e && e.at) || 0, loading: true, error: false };
    try {
      const res = await fetch(`${SB_URL}/rest/v1/live_pbp?select=pbp&event_key=eq.${encodeURIComponent(key)}&limit=1`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`pbp ${res.status}`);
      const rows = await res.json();
      const games = (Array.isArray(rows) && rows[0] && Array.isArray(rows[0].pbp)) ? rows[0].pbp : [];
      _pbpCache[key] = { games, at: Date.now(), loading: false, error: false };
    } catch (err) {
      console.warn('[live-tab] pbp fetch failed:', err.message);
      _pbpCache[key] = { games: e && e.games, at: Date.now(), loading: false, error: true };
    }
    if (typeof onDone === 'function') { try { onDone(); } catch (_) { /* renderer's problem */ } }
  }

  // TEN-190: the card-click → modal binding is GONE from this module. The Live
  // page and its modal are rendered by the #lvTab handoff build, which owns its
  // own click handling on .lvcard. Binding this module's `.lt-card[data-ek]`
  // listener as well would be inert today (no .lt-card is rendered any more) but
  // would resurrect a second, competing modal the moment anyone reintroduced that
  // class name. Detail's formulas are still used — exported above, not its DOM.

  // ─── reveal the nav tab — only reached once flag + creds guards have passed, so
  //     a flag-OFF (or mis-provisioned) build never surfaces a dead Live tab. ──────
  (function revealNavTab() {
    const show = () => {
      const btn = document.getElementById('liveTabBtn');
      if (btn) btn.style.display = '';
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', show);
    } else {
      show();
    }
  })();

  // ─── expose control surface for the tab handler ───────────────────────────────
  window.LiveTab = { setActive, isUnderway, isAtpSingles };

  // ─── TEN-190: data API for the #lvTab renderer ────────────────────────────────
  // Everything the handoff build needs to paint real figures, and nothing that
  // paints. subscribe() replays the last board immediately so a subscriber that
  // registers after the first snapshot does not wait a full tick for its first
  // paint (the module is deferred, the renderer is inline — either order works).
  window.LiveFeed = {
    subscribe(fn) {
      if (typeof fn !== 'function') return;
      (window.__LV_SUBS = window.__LV_SUBS || []).push(fn);
      if (_lastMatches) render(_lastMatches);
    },
    isUnderway,
    isAtpSingles,
    indexStats: Detail.indexStats,
    stat: Detail.stat,
    serveRating: Detail.serveRating,
    returnRating: Detail.returnRating,
    dominance: Detail.dominance,
    num: Detail.num,
    pbpGet,
    pbpLoad,
    holdbreak() {
      return (window.__h2hEnv && typeof window.__h2hEnv.holdbreak === 'function')
        ? window.__h2hEnv.holdbreak() : (window.holdbreak || null);
    },
  };

  // The inline #lvTab renderer parses before this deferred module runs, so it
  // cannot have called subscribe() through the API above. Drain anything it
  // queued directly onto the array, and tell it the feed is now available.
  if (Array.isArray(window.__LV_SUBS) && window.__LV_SUBS.length) {
    publish({ ready: false, matches: [], live: [], isStale: false, ageMs: 0, updatedAt: null, connected: false });
  }
})();
