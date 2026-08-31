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
// Polls ONLY while the Live tab is the active tab AND the page is visible —
// leaving the tab or backgrounding the page stops the timer, so an idle user
// costs zero requests (cheaper than the always-on Slice-3 overlay).
//
// Requires on window before this script runs:
//   SUPABASE_URL      — project URL, e.g. "https://abcdef.supabase.co"
//   SUPABASE_ANON_KEY — public anon key (browser-safe; RLS restricts writes)

(function () {
  'use strict';

  if (!window.FEATURE_LIVE_PROXY) return;

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

  // ─── state ──────────────────────────────────────────────────────────────────
  let _timer         = null;
  let _ticking       = false;    // in-flight guard — one request at a time
  let _backoffMs      = 0;
  let _active         = false;   // is the Live tab the currently-shown tab?
  let _lastUpdatedAt  = null;    // ms epoch of last known snapshot (survives errors)
  let _lastMatches    = null;    // last rendered board (for stale re-render)
  let _bootstrapped   = false;   // has the page shell been injected yet?

  // ─── DOM refs (resolved lazily; the tabpage exists in the static HTML) ────────
  function grid()   { return document.getElementById('liveGrid'); }
  function status() { return document.getElementById('liveStatus'); }

  // ─── public: called by the #mainNav tab handler ──────────────────────────────
  function setActive(isLive) {
    if (isLive && !_active) {
      _active = true;
      _backoffMs = 0;
      schedulePoll(0);          // immediate first paint on entering the tab
    } else if (!isLive && _active) {
      _active = false;
      clearTimeout(_timer);     // leaving the tab stops the poll entirely
    }
  }

  // ─── pause on hidden, resume on visible (only matters while active) ───────────
  document.addEventListener('visibilitychange', () => {
    if (!_active) return;
    if (document.hidden) {
      clearTimeout(_timer);
    } else {
      _backoffMs = 0;
      if (!_ticking) schedulePoll(0);
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
      schedulePoll(_backoffMs);
      return;
    }
    _ticking = false;

    // The user may have left the Live tab or backgrounded the page while the
    // request was in flight — don't render into a hidden grid or re-arm a timer.
    if (!_active || document.hidden) return;

    if (row) {
      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : null;
      if (updatedAt !== null) _lastUpdatedAt = updatedAt;
      const matches = Array.isArray(row.board?.matches) ? row.board.matches : [];
      _lastMatches = matches;
      render(matches);
    }

    schedulePoll(POLL_INTERVAL_MS);
  }

  function schedulePoll(delayMs) {
    clearTimeout(_timer);
    _timer = setTimeout(tick, delayMs);
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
        s.innerHTML = `<span class="lt-dot"></span>${n} match${n === 1 ? '' : 'es'} live · updates every 30s`;
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

    return `
    <article class="lt-card" data-ek="${ek}">
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
