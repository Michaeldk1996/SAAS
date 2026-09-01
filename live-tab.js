// TEN-107 · Slice 4 — standalone Live tab (member read path)
//
// Founder ruling (TEN-91, 2026-08-29): the live feed is its OWN nav tab, not an
// overlay on the Matches board. This module owns the Live page end-to-end:
// it reads the shared live_snapshot row from Supabase via PostgREST (no SDK, no
// Edge-Function cold start on the member path) and renders every underway match
// as a standalone live card into #liveGrid. The Matches tab is untouched.
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

  // ─── DOM refs (resolved lazily; the tabpage exists in the static HTML) ────────
  function grid()   { return document.getElementById('liveGrid'); }
  function status() { return document.getElementById('liveStatus'); }

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

  // ─── render: status line only (error path, no fresh board) ────────────────────
  function renderStatusOnly() {
    const s = status();
    if (!s) return;
    if (_lastUpdatedAt === null) {
      // First fetch(es) failed — never had a snapshot. Show an honest connecting
      // state rather than leaving the static "Loading…" placeholder stuck forever.
      s.className = 'lt-status stale';
      s.innerHTML = `<span class="lt-dot"></span>Connecting to the live feed…`;
      return;
    }
    const { isStale, ageMs } = staleness();
    if (isStale) {
      s.className = 'lt-status stale';
      s.innerHTML = `<span class="lt-dot"></span>Reconnecting… last update ${Math.round(ageMs / 1000)}s ago`;
    }
  }

  // ─── a "live" match is one the vendor still flags underway ────────────────────
  function isUnderway(fix) {
    const st = String(fix.event_status || '').toLowerCase();
    const finalWord = st.includes('finished') || st.includes('retired') ||
                      st.includes('walkover') || st.includes('abandoned') ||
                      st.includes('cancel');
    // event_live is the vendor's own live flag ("1"); trust it, but a match that
    // has gone Final while still on the live board should drop off the Live tab.
    return String(fix.event_live) === '1' && !finalWord;
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

  // ─── render the full board ────────────────────────────────────────────────────
  function render(matches) {
    const g = grid();
    const s = status();
    if (!g) return;

    const live = (Array.isArray(matches) ? matches : [])
      .filter(isAtpSingles)
      .filter(isUnderway);

    const { isStale, ageMs } = staleness();

    if (s) {
      if (isStale) {
        s.className = 'lt-status stale';
        s.innerHTML = `<span class="lt-dot"></span>Stale · last update ${Math.round(ageMs / 1000)}s ago`;
      } else {
        s.className = 'lt-status live';
        const n = live.length;
        const cadence = (USE_REALTIME && _rtConnected && !_rtFellBack) ? 'live now' : 'updates every 30s';
        s.innerHTML = `<span class="lt-dot"></span>${n} match${n === 1 ? '' : 'es'} live · ${cadence}`;
      }
    }

    if (!live.length) {
      g.innerHTML =
        `<div class="lt-empty">
           <div class="lt-empty-icon">◍</div>
           <p class="lt-empty-title">No ATP singles live right now</p>
           <p class="lt-empty-sub">The board refreshes automatically — live ATP matches appear here as they start.</p>
         </div>`;
      return;
    }

    g.innerHTML = live.map(cardHtml).join('');
  }

  // ─── one live card ──────────────────────────────────────────────────────────────
  function cardHtml(fix) {
    const ek = esc(String(fix.event_key || ''));
    const serveIsFirst  = /first/i.test(String(fix.event_serve || ''));
    const serveIsSecond = /second/i.test(String(fix.event_serve || ''));

    const p1 = playerRow(fix, 1, serveIsFirst);
    const p2 = playerRow(fix, 2, serveIsSecond);

    const tourn = esc(fix.tournament_name || '');
    const round = shortRound(fix);
    const status = esc(fix.event_status || 'Live');

    const clickable = USE_DETAIL ? ' clickable' : '';
    const a11y = USE_DETAIL ? ' role="button" tabindex="0" aria-label="Open match detail"' : '';
    return `
    <article class="lt-card${clickable}" data-ek="${ek}"${a11y}>
      <div class="lt-head">
        <span class="lt-tourn">${tourn}${round ? ` · ${round}` : ''}</span>
        <span class="lt-badge"><span class="lt-dot"></span>${status}</span>
      </div>
      <div class="lt-players">
        ${p1}
        ${p2}
      </div>
    </article>`;
  }

  // A player row: avatar, name, server dot, per-set scores, current-game points.
  function playerRow(fix, which, serving) {
    const name = esc(fix[`event_${which === 1 ? 'first' : 'second'}_player`] || '—');
    const logo = fix[`event_${which === 1 ? 'first' : 'second'}_player_logo`] || '';
    const av = logo
      ? `<img class="lt-av" src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="lt-av lt-av-blank"></span>`;

    const sets = setCells(fix, which);
    const game = gamePoints(fix, which);

    return `
    <div class="lt-row${serving ? ' serving' : ''}">
      ${av}
      <span class="lt-name">${name}</span>
      <span class="lt-serve" title="Serving">${serving ? '●' : ''}</span>
      <span class="lt-sets">${sets}</span>
      <span class="lt-game">${game}</span>
    </div>`;
  }

  // Per-set boxes from the `scores` array; the current set is highlighted.
  function setCells(fix, which) {
    const scores = Array.isArray(fix.scores) ? fix.scores : [];
    if (scores.length) {
      const lastIdx = scores.length - 1;
      return scores.map((sc, i) => {
        const v = which === 1 ? sc.score_first : sc.score_second;
        const cur = i === lastIdx ? ' cur' : '';
        return `<span class="lt-set${cur}">${esc(v ?? '')}</span>`;
      }).join('');
    }
    // Fallback: aggregate sets-won from event_final_result ("1 - 0").
    const parts = String(fix.event_final_result || '').split('-').map(s => s.trim());
    const v = which === 1 ? parts[0] : parts[1];
    return v ? `<span class="lt-set">${esc(v)}</span>` : '';
  }

  // Current-game points from event_game_result ("40 - 30" / "A - 40" / "-").
  function gamePoints(fix, which) {
    const raw = String(fix.event_game_result || '').trim();
    if (!raw || raw === '-') return '<span class="lt-pt">·</span>';
    const parts = raw.split('-').map(s => s.trim());
    const v = which === 1 ? parts[0] : parts[1];
    return `<span class="lt-pt">${esc(v ?? '·')}</span>`;
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
  // Ratings use the model's own layer-9 / layer-10 rating formulas (h2h-model/
  //   adjustments.js) on match-to-date stats, RAW (no shrinkage — founder ruling);
  //   under a sample floor a rating shows "warming up" instead of a noisy figure.
  //   serve = 1stIn% + 1stWon% + 2ndWon% + hold% + ace% − df%
  //   return = returnPtsWon% + returnGamesWon% + bpConversion%
  //   Dominance Ratio = returnPtsWon% / (100 − servicePtsWon%)   (Bialik)
  // ══════════════════════════════════════════════════════════════════════════════
  const Detail = (function () {
    // Sample floors (display only — flagged for founder confirmation in staging doc).
    const SERVE_FLOOR_PTS  = 10;   // service points before a serve rating is shown
    const RETURN_FLOOR_PTS = 10;   // return  points before a return rating is shown
    const PBP_MAX_AGE_MS   = 12_000;

    // ── 0–10 rating scale (founder ruling TEN-107 2026-08-31) ────────────────────
    // The raw serve/return ratings are summed-percentage figures (serve ~200–308,
    // return ~17–129) — unreadable on a live card. Rescale each axis LINEARLY so
    // 5.0 == the tour average and each 2.5 points == one tour standard deviation,
    // with 0 and 10 pinned at ±2 SD (≈ the tour's 2.3rd/97.7th percentile) and
    // clamped. Anchors are the real tour distribution measured off our own
    // career-splits DB (career Best-of-3 row, complete-component rows, 2026-09-01):
    //   SERVE  mean 263.3, sd 16.0 (n=232)  → 0↔231.3, 5.0↔263.3, 10↔295.3
    //   RETURN mean  91.2, sd 16.2 (n=230)  → 0↔ 58.8, 5.0↔ 91.2, 10↔123.6
    // (2 players with an incomplete return row — missing break-point-conversion —
    //  give a degenerate low figure and are excluded from the return anchor only.)
    // Same transform anchors the H2H-board rating when that migrates to 0–10, so
    // the two surfaces never diverge (doc `rating-0-10-scale`). Live figures swing
    // wider than the career board because a single match is one noisy sample of
    // the same underlying rating — an in-match rating of 8.5 means "serving ~1.4
    // SD above tour-average right now", which is the intended read.
    const SCALE10 = {
      serve:  { mean: 263.3, sd: 16.0 },
      return: { mean:  91.2, sd: 16.2 },
    };
    function scale10(raw, axis) {
      if (raw == null) return null;
      const a = SCALE10[axis];
      if (!a) return null;
      const v = 5 + 2.5 * (raw - a.mean) / a.sd;
      return Math.max(0, Math.min(10, v));
    }

    let _ek = null;                // open match's event_key (null = closed)
    let _tab = 'stats';            // stats | points | ratings | holdbreak
    let _statPeriod = 'match';     // match | set1 | set2 …
    let _ptsSet = 1;               // Points tab set filter
    const _pbp = Object.create(null);   // ek → { games, at, loading }

    const num = (s) => { const v = parseFloat(String(s).replace('%', '')); return Number.isFinite(v) ? v : null; };
    const pk  = (fix, which) => fix[`${which === 1 ? 'first' : 'second'}_player_key`];

    // Build stat lookup: byPlayer[player_key][period][stat_name] = {value,won,total}.
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
        idx[key][per][s.stat_name] = { value: s.stat_value, won: s.stat_won, total: s.stat_total };
      }
      return { idx, periods };
    }
    const g = (idx, pkey, per, name) => (idx[String(pkey)] && idx[String(pkey)][per] && idx[String(pkey)][per][name]) || null;

    // Exact layer-9 / layer-10 rating rows on the box score for a given period.
    function serveRating(idx, pkey, per) {
      const fi = num(g(idx, pkey, per, '1st serve percentage')?.value);
      const fw = num(g(idx, pkey, per, '1st serve points won')?.value);
      const sw = num(g(idx, pkey, per, '2nd serve points won')?.value);
      const hl = num(g(idx, pkey, per, 'Service games won')?.value);
      const aces = num(g(idx, pkey, per, 'Aces')?.value);
      const dfs  = num(g(idx, pkey, per, 'Double Faults')?.value);
      if (fi == null || fw == null || sw == null || hl == null) return { rating: null };
      // Service-points total for the sample floor + ace/df denominator. Prefer the
      // "Service Points Won" row; fall back to (1st-serve-pts total + 2nd-serve-pts
      // total) since some feed tiers omit the aggregate row while carrying the splits.
      const fwTot = g(idx, pkey, per, '1st serve points won')?.total;
      const swTot = g(idx, pkey, per, '2nd serve points won')?.total;
      let spTotal = g(idx, pkey, per, 'Service Points Won')?.total;
      if (spTotal == null && fwTot != null && swTot != null) spTotal = fwTot + swTot;
      // Only gate on the floor when the sample size is actually known — with all four
      // percentages present but no counts, hide-as-"warming up" would be wrong.
      if (spTotal != null && !(spTotal >= SERVE_FLOOR_PTS)) return { rating: null, warming: true };
      const aPct  = (spTotal > 0 && aces != null) ? (aces / spTotal) * 100 : 0;
      const dfPct = (spTotal > 0 && dfs  != null) ? (dfs  / spTotal) * 100 : 0;
      return { rating: fi + fw + sw + hl + aPct - dfPct };
    }
    function returnRating(idx, pkey, per) {
      const rp = num(g(idx, pkey, per, 'Return Points Won')?.value);
      const br = num(g(idx, pkey, per, 'Return games won')?.value);
      const bp = num(g(idx, pkey, per, 'Break Points Converted')?.value);
      const rpTotal = g(idx, pkey, per, 'Return Points Won')?.total;
      if (rp == null) return { rating: null };
      if (rpTotal != null && !(rpTotal >= RETURN_FLOOR_PTS)) return { rating: null, warming: true };
      return { rating: rp + (br || 0) + (bp || 0) };
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

    // ── Break/Hold tab (founder ruling TEN-107 2026-09-02) ───────────────────────
    // The Break/Hold heatmap joins Stats/Points/Ratings as the 4th match metric.
    // Data is the pre-computed holdbreak.json rollup (ZERO live API) — read via the
    // dashboard's window.__h2hEnv.holdbreak() getter; players are keyed by the same
    // numeric api-tennis id the live fixture carries. Renderer is ported here (not
    // borrowed off window) so the Live tab stays self-contained. Both players side
    // by side, each with service-hold% and return-break% by set × service-game depth
    // (Early 1st–2nd / Mid 3rd–4th / Late 5th+). Pooled 'all' surface — a live modal
    // has no clean surface field, so we show the player's whole-tour history.
    const HB_BUCKETS = [['early', 'Early', '1st–2nd svc game'], ['mid', 'Mid', '3rd–4th'], ['late', 'Late', '5th+']];
    const HB_SETS    = [['1', 'Set 1'], ['2', 'Set 2'], ['3', 'Set 3'], ['4+', 'Set 4+']];
    function hbCellStyle(pct, kind) {
      const lo = kind === 'serve' ? 50 : 8, hi = kind === 'serve' ? 90 : 45;
      const t = Math.max(0, Math.min(1, (pct - lo) / (hi - lo)));
      return `background:rgba(61,214,140,${(0.07 + 0.5 * t).toFixed(3)});`;
    }
    function hbCell(cell, kind, floor) {
      const has  = !!(cell && cell.pct != null && cell.n >= floor);
      const thin = !!(cell && cell.n > 0 && cell.n < floor);
      const style   = has ? hbCellStyle(cell.pct, kind) : 'background:#0a0d14;';
      const pctTxt  = (cell && cell.pct != null) ? `${Math.round(cell.pct)}%` : '—';
      const nTxt    = (cell && cell.n) ? `n=${cell.n}` : 'no data';
      const bp = (kind === 'serve' && has && cell.bpFaced >= floor && cell.bpSavedPct != null)
        ? `<div style="font-size:9px;color:#8892a0;font-family:'IBM Plex Mono',monospace;margin-top:2px;">BP ${Math.round(cell.bpSavedPct)}% svd</div>` : '';
      const title = thin ? ` title="Below sample floor (${cell.n} &lt; ${floor}) — greyed"` : '';
      return `<div${title} style="border-radius:8px;padding:9px 6px;text-align:center;min-width:0;${style}">
        <div style="font-size:16px;font-weight:700;font-family:'IBM Plex Mono',monospace;line-height:1;color:${has ? '#e7e9ee' : '#4b5672'};">${pctTxt}</div>
        <div style="font-size:9.5px;font-family:'IBM Plex Mono',monospace;margin-top:3px;color:${has ? 'rgba(231,233,238,0.7)' : '#4b5672'};">${nTxt}</div>
        ${bp}
      </div>`;
    }
    function hbGrid(node, kind, floor) {
      node = node || {};
      const cols = `74px repeat(${HB_SETS.length},1fr)`;
      const head = `<div style="display:grid;grid-template-columns:${cols};gap:6px;margin-bottom:6px;">
        <span></span>${HB_SETS.map(s => `<span style="font-size:9.5px;letter-spacing:0.1em;text-transform:uppercase;color:#5b6880;font-family:'IBM Plex Mono',monospace;text-align:center;">${s[1]}</span>`).join('')}
      </div>`;
      const rows = HB_BUCKETS.map(b => `<div style="display:grid;grid-template-columns:${cols};gap:6px;margin-bottom:6px;align-items:stretch;">
        <div style="display:flex;flex-direction:column;justify-content:center;"><span style="font-size:12px;font-weight:700;color:#c6ccdb;">${b[1]}</span><span style="font-size:9px;color:#4b5672;">${b[2]}</span></div>
        ${HB_SETS.map(s => hbCell((node[s[0]] || {})[b[0]], kind, floor)).join('')}
      </div>`).join('');
      return head + rows;
    }
    function holdbreakHtml(fix) {
      const HB = (window.__h2hEnv && typeof window.__h2hEnv.holdbreak === 'function')
        ? window.__h2hEnv.holdbreak() : (window.holdbreak || null);
      if (!HB || !HB.players) return `<div class="ltm-note">Loading hold/break history…</div>`;
      const pa = HB.players[String(pk(fix, 1))], pb = HB.players[String(pk(fix, 2))];
      if (!pa && !pb) return `<div class="ltm-note">No hold/break history for either player yet.</div>`;
      const floor = (HB.meta && HB.meta.sampleFloor) || 20;
      const win   = (HB.meta && HB.meta.windowMonths) ? `${HB.meta.windowMonths}-month window` : '';
      const lab = (t) => `<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#5b6880;font-family:'IBM Plex Mono',monospace;margin-bottom:8px;">${t}</div>`;
      const col = (pd, name) => {
        const nm = `<div style="font-size:13px;font-weight:800;color:#e7e9ee;margin-bottom:10px;">${esc(name || '—')}</div>`;
        if (!pd || !pd.serve || !pd.serve.all || !pd.return || !pd.return.all) {
          return `<div style="flex:1;min-width:250px;">${nm}<div style="font-size:12px;color:#4b5672;">No hold/break data yet.</div></div>`;
        }
        return `<div style="flex:1;min-width:250px;display:flex;flex-direction:column;gap:14px;">${nm}
          <div>${lab('Service holds · hold %')}${hbGrid(pd.serve.all, 'serve', floor)}</div>
          <div>${lab('Return breaks · break %')}${hbGrid(pd.return.all, 'return', floor)}</div>
        </div>`;
      };
      return `<div class="ltm-section" style="padding:14px 16px;">
        <div style="font-size:12px;color:#5b6880;line-height:1.5;margin-bottom:14px;">Hold% (serve) and break% (return) by service-game depth in a set — Early (1st–2nd) / Mid (3rd–4th) / Late (5th+). All surfaces · ${win} · floor n≥${floor}. Deeper green = stronger; greyed cells are below the sample floor.</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;">${col(pa, fix.event_first_player)}${col(pb, fix.event_second_player)}</div>
      </div>`;
    }

    // ── Ratings tab (headline exact; chart = per-game trajectory from pbp) ────────
    function ratingsHtml(fix, idx) {
      const p1 = pk(fix, 1), p2 = pk(fix, 2);
      const s1 = serveRating(idx, p1, 'match'), s2 = serveRating(idx, p2, 'match');
      const r1 = returnRating(idx, p1, 'match'), r2 = returnRating(idx, p2, 'match');
      const n1 = esc(fix.event_first_player || 'P1'), n2 = esc(fix.event_second_player || 'P2');
      // Headline is the 0–10 rescale (5.0 = tour average); see scale10() above.
      const val = (o, axis) => {
        const r10 = o.rating != null ? scale10(o.rating, axis) : null;
        return r10 != null
          ? `<span class="ltm-rate-val">${r10.toFixed(1)}</span>`
          : `<span class="ltm-rate-val warm">${o.warming ? 'warming up' : '—'}</span>`;
      };

      const head = `
        <div class="ltm-section">
          <div class="ltm-rate-row" style="grid-template-columns:auto 1fr auto;">
            ${val(s1, 'serve')}<span class="ltm-sn" style="text-align:center;">⚡ Serve rating</span>${val(s2, 'serve')}
          </div>
          <div class="ltm-rate-row" style="grid-template-columns:auto 1fr auto;">
            ${val(r1, 'return')}<span class="ltm-sn" style="text-align:center;">⛨ Return rating</span>${val(r2, 'return')}
          </div>
        </div>`;

      // Charts from pbp trajectory (points-based; see staging doc note).
      const traj = trajectory(fix);
      const chart = (title, key) => {
        if (!traj || traj.length < 2) {
          return `<div class="ltm-chart"><div class="ltm-chart-hd"><span class="ltm-chart-title">${title}</span></div>
            <div class="ltm-note" style="padding:14px;">Chart appears once a few games are complete.</div></div>`;
        }
        return `<div class="ltm-chart">
          <div class="ltm-chart-hd"><span class="ltm-chart-title">${title}</span>
            <span class="ltm-chart-leg"><span><i style="background:var(--lt-p1)"></i>${n1}</span><span><i style="background:var(--lt-p2)"></i>${n2}</span></span></div>
          ${lineChart(traj.map(t => t.g), traj.map(t => t[key + '1']), traj.map(t => t[key + '2']))}
        </div>`;
      };
      return `${head}
        <div class="ltm-rate-row" style="display:block;">
          ${chart('Serve rating · trajectory', 'sv')}
          ${chart('Return rating · trajectory', 'rt')}
        </div>`;
    }

    // Per-game cumulative points-based trajectory reconstructed from pbp. The feed's
    // point log carries no per-point serve-type/ace/DF, so this plots the points-based
    // core (serve = svc-pts-won% + hold%; return = ret-pts-won% + ret-games-won%),
    // NOT the full split rating used for the headline — flagged for founder ruling.
    function trajectory(fix) {
      const entry = _pbp[_ek];
      if (!entry || !Array.isArray(entry.games) || !entry.games.length) return null;
      const rank = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 };
      let sp1 = 0, spw1 = 0, sg1 = 0, sgw1 = 0, rp1 = 0, rpw1 = 0, rg1 = 0, rgw1 = 0;
      let sp2 = 0, spw2 = 0, sg2 = 0, sgw2 = 0, rp2 = 0, rpw2 = 0, rg2 = 0, rgw2 = 0;
      const out = [];
      let gi = 0;
      for (const gm of entry.games) {
        const pts = Array.isArray(gm.points) ? gm.points : [];
        if (!pts.length) continue;
        const p1serves = /first/i.test(String(gm.player_served || '')) || /first/i.test(String(gm.serve_lost || ''));
        // winner of each point (first=+1 / second=+1)
        let prevA = 0, prevB = 0, w1 = 0, w2 = 0;
        // Point score → comparable rank: 0/15/30/40/A for games, or the raw integer
        // for tiebreak points (e.g. "7 - 5"). Within a game the scale is consistent.
        const rk = (s) => (s in rank) ? rank[s] : (Number.isFinite(+s) ? +s : null);
        pts.forEach((pt, i) => {
          const parts = String(pt.score || '').split('-').map(s => s.trim());
          const na = rk(parts[0]) ?? prevA, nb = rk(parts[1]) ?? prevB;
          let winner = 0;
          if (i === pts.length - 1) winner = gameWinner(gm);      // final point → game winner
          else if (na > prevA) winner = 1; else if (nb > prevB) winner = 2;
          else if (na < prevA) winner = 2; else if (nb < prevB) winner = 1;
          if (winner === 1) w1++; else if (winner === 2) w2++;
          prevA = na; prevB = nb;
        });
        const total = w1 + w2;
        const gw = gameWinner(gm);   // 1 or 2
        if (p1serves) {
          sp1 += total; spw1 += w1; sg1 += 1; if (gw === 1) sgw1 += 1;
          rp2 += total; rpw2 += w2; rg2 += 1; if (gw === 2) rgw2 += 1;
        } else {
          sp2 += total; spw2 += w2; sg2 += 1; if (gw === 2) sgw2 += 1;
          rp1 += total; rpw1 += w1; rg1 += 1; if (gw === 1) rgw1 += 1;
        }
        gi++;
        const pctv = (w, t) => t > 0 ? (w / t) * 100 : 0;
        out.push({
          g: gi,
          sv1: pctv(spw1, sp1) + pctv(sgw1, sg1), sv2: pctv(spw2, sp2) + pctv(sgw2, sg2),
          rt1: pctv(rpw1, rp1) + pctv(rgw1, rg1), rt2: pctv(rpw2, rp2) + pctv(rgw2, rg2),
        });
      }
      return out;
    }
    function gameWinner(gm) {
      // Prefer the running game score delta; fall back to serve_lost/serve_winner.
      const parts = String(gm.score || '').split('-').map(s => s.trim());
      // `score` is the games tally AFTER this game — can't diff without prior; use flags.
      if (gm.serve_lost) return /first/i.test(String(gm.player_served || '')) || /first/i.test(String(gm.serve_lost)) ? 2 : 1;
      if (gm.serve_winner) return /first/i.test(String(gm.serve_winner)) ? 1 : 2;
      // in-progress final game: attribute to server as a neutral default
      return /first/i.test(String(gm.player_served || '')) ? 1 : 2;
    }

    // Minimal inline SVG line chart (two series). No library — same ethos as the read path.
    function lineChart(xs, y1, y2) {
      const W = 640, H = 150, PL = 30, PR = 10, PT = 10, PB = 20;
      const all = y1.concat(y2).filter(v => Number.isFinite(v));
      let lo = Math.min(...all), hi = Math.max(...all);
      if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
      if (hi - lo < 1) { hi = lo + 1; }
      const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
      const n = xs.length;
      const X = (i) => PL + (n <= 1 ? 0 : (i / (n - 1)) * (W - PL - PR));
      const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
      const path = (ys) => ys.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      const dots = (ys, c) => ys.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.4" fill="${c}"/>`).join('');
      const gy = [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.75];
      const grid = gy.map(v => `<line x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}" stroke="#262B35" stroke-width="1"/>
        <text x="${PL - 5}" y="${(Y(v) + 3).toFixed(1)}" fill="#565F6A" font-size="9" text-anchor="end">${Math.round(v)}</text>`).join('');
      const xlab = xs.map((x, i) => (i % Math.ceil(n / 7 || 1) === 0)
        ? `<text x="${X(i).toFixed(1)}" y="${H - 6}" fill="#565F6A" font-size="9" text-anchor="middle">G${x}</text>` : '').join('');
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="display:block;">
        ${grid}${xlab}
        <path d="${path(y1)}" fill="none" stroke="var(--lt-p1)" stroke-width="2"/>
        <path d="${path(y2)}" fill="none" stroke="var(--lt-p2)" stroke-width="2"/>
        ${dots(y1, '#5b9dff')}${dots(y2, '#e2685f')}
      </svg>`;
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
          return `<span${curCls}>${esc(v ?? '')}</span>`;
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
          <button class="ltm-tab ${_tab === 'ratings' ? 'active' : ''}" data-tab="ratings">Ratings</button>
          <button class="ltm-tab ${_tab === 'holdbreak' ? 'active' : ''}" data-tab="holdbreak">Break/Hold</button>
        </div>`;
    }

    function renderBody(fix) {
      const { idx, periods } = indexStats(fix);
      if (_tab === 'stats')     return statsHtml(fix, idx, periods);
      if (_tab === 'points')    return pointsHtml(fix);
      if (_tab === 'holdbreak') return holdbreakHtml(fix);
      return ratingsHtml(fix, idx);
    }

    function paint() {
      if (_ek == null) return;
      const fix = findFix(_lastMatches, _ek);
      const modal = _overlay && _overlay.querySelector('.ltm');
      if (!modal) return;
      const useFix = fix || _lastFix;   // match may have ended mid-view; keep the last fixture
      if (!useFix) return;
      _lastFix = useFix;
      modal.innerHTML = headerHtml(useFix) + `<div class="ltm-body">${renderBody(useFix)}</div>`;
      wire(modal, useFix);
    }
    let _lastFix = null;

    function wire(modal, fix) {
      modal.querySelector('.ltm-close')?.addEventListener('click', close);
      modal.querySelectorAll('.ltm-tab').forEach(b => b.addEventListener('click', () => {
        _tab = b.getAttribute('data-tab');
        if (_tab === 'points' || _tab === 'ratings') ensurePbp();
        paint();
      }));
      modal.querySelectorAll('.ltm-toggle button[data-per]').forEach(b =>
        b.addEventListener('click', () => { _statPeriod = b.getAttribute('data-per'); paint(); }));
      modal.querySelectorAll('.ltm-toggle button[data-set]').forEach(b =>
        b.addEventListener('click', () => { _ptsSet = +b.getAttribute('data-set'); paint(); }));
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
      if (_tab === 'points' || _tab === 'ratings') ensurePbp();
      paint();
    }

    return { open, close, onBoard };
  })();

  // Card click → open the detail modal (delegated; keyboard-accessible).
  if (USE_DETAIL) {
    const onGridActivate = (e) => {
      const card = e.target.closest && e.target.closest('.lt-card[data-ek]');
      if (!card) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      if (e.type === 'keydown') e.preventDefault();
      Detail.open(card.getAttribute('data-ek'));
    };
    document.addEventListener('click', onGridActivate);
    document.addEventListener('keydown', onGridActivate);
  }

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
  window.LiveTab = { setActive };
})();
