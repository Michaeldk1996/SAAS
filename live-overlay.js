// TEN-107 · Slice 3 — live overlay (member read path)
//
// Reads the shared live_snapshot row from Supabase via PostgREST (no SDK, no
// cold-start Edge Function on the member path). For each underway match it
// updates a .live-overlay band on the existing match card.
//
// Guard: window.FEATURE_LIVE_PROXY must be truthy. Never runs otherwise.
//
// Requires on window before this script runs:
//   SUPABASE_URL     — project URL, e.g. "https://abcdef.supabase.co"
//   SUPABASE_ANON_KEY — public anon key (browser-safe)
//
// Match cards must carry data-ek="<event_key>" on the <article> element
// (added by the dashboard's card renderer alongside this slice).

(function () {
  'use strict';

  // ─── guard ──────────────────────────────────────────────────────────────────
  if (!window.FEATURE_LIVE_PROXY) return;

  const SB_URL = (window.SUPABASE_URL || '').replace(/\/$/, '');
  const SB_KEY = window.SUPABASE_ANON_KEY || '';
  // Placeholder strings from failed CI substitution must not pass the guard.
  if (!SB_URL || SB_URL.startsWith('__') || !SB_KEY || SB_KEY.startsWith('__')) {
    console.warn('[live-overlay] SUPABASE_URL / SUPABASE_ANON_KEY not configured — skipping');
    return;
  }

  // ─── config ─────────────────────────────────────────────────────────────────
  const POLL_INTERVAL_MS   = 30_000;
  const STALE_THRESHOLD_MS = 60_000;   // show stale badge after 60 s
  const BACKOFF_BASE_MS    = 30_000;
  const BACKOFF_MAX_MS     = 300_000;
  const SNAPSHOT_ENDPOINT  =
    `${SB_URL}/rest/v1/live_snapshot?select=board,updated_at&limit=1`;

  // ─── state ──────────────────────────────────────────────────────────────────
  let _timer    = null;
  let _ticking  = false;        // in-flight guard — prevents concurrent ticks
  let _backoffMs = 0;           // 0 = use normal interval
  let _frozen   = new Set();    // event_keys of matches we've frozen (match ended)
  let _paused   = false;
  let _lastUpdatedAt = null;    // last known snapshot timestamp (survives fetch errors)

  // ─── pause on hidden, resume on visible ─────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _paused = true;
      clearTimeout(_timer);
    } else {
      _paused = false;
      _backoffMs = 0;
      // Only schedule a new tick if one is not already in-flight.
      if (!_ticking) schedulePoll(0);
    }
  });

  // ─── PostgREST fetch ────────────────────────────────────────────────────────
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

  // ─── tick ───────────────────────────────────────────────────────────────────
  async function tick() {
    if (_paused || _ticking) return;
    _ticking = true;
    let row;
    try {
      row = await fetchSnapshot();
      _backoffMs = 0;  // reset on success
    } catch (err) {
      console.warn('[live-overlay] fetch failed:', err.message);
      _backoffMs = _backoffMs
        ? Math.min(_backoffMs * 2, BACKOFF_MAX_MS)
        : BACKOFF_BASE_MS;
      // Re-render existing overlays using the cached timestamp so the stale
      // badge reflects elapsed time even during a sustained error window.
      if (_lastUpdatedAt !== null) {
        const ageMs = Date.now() - _lastUpdatedAt;
        const isStale = ageMs > STALE_THRESHOLD_MS;
        refreshStaleBadges(isStale, ageMs);
      }
      _ticking = false;
      schedulePoll(_backoffMs);
      return;
    } finally {
      // _ticking reset in the non-error path below; reset here on throw.
    }

    _ticking = false;

    if (!row) {
      schedulePoll(POLL_INTERVAL_MS);
      return;
    }

    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : null;
    if (updatedAt !== null) _lastUpdatedAt = updatedAt;
    const ageMs = _lastUpdatedAt !== null ? Date.now() - _lastUpdatedAt : Infinity;
    const isStale = ageMs > STALE_THRESHOLD_MS;

    const matches = row.board?.matches;
    if (Array.isArray(matches)) {
      applyOverlays(matches, isStale, ageMs);
    }

    schedulePoll(POLL_INTERVAL_MS);
  }

  function schedulePoll(delayMs) {
    clearTimeout(_timer);
    _timer = setTimeout(tick, delayMs);
  }

  // ─── stale badge refresh (error path, no new data) ──────────────────────────
  function refreshStaleBadges(isStale, ageMs) {
    const overlays = document.querySelectorAll('article.match-card .live-overlay');
    for (const overlay of overlays) {
      const badge = overlay.querySelector('.lo-badge:not(.lo-frozen)');
      if (!badge) continue; // frozen cards are left alone
      if (isStale) {
        const secs = Math.round(ageMs / 1000);
        badge.className = 'lo-badge lo-stale';
        badge.textContent = `stale · ${secs}s ago`;
      }
    }
  }

  // ─── overlay application ─────────────────────────────────────────────────────
  function applyOverlays(matches, isStale, ageMs) {
    const byKey = {};
    for (const fix of matches) {
      const key = String(fix.event_key || '');
      if (key) byKey[key] = fix;
    }

    const cards = document.querySelectorAll('article.match-card[data-ek]');
    for (const card of cards) {
      const ek = card.dataset.ek;
      if (!ek) continue;

      const fix = byKey[ek];
      if (!fix) continue; // not on live board — leave card alone

      const status = (fix.event_status || fix.status || '').toLowerCase();
      const isFinal = status.includes('finished') || status.includes('retired') ||
                      status.includes('walkover') || status.includes('abandoned');

      if (isFinal) {
        _frozen.add(ek);
        // Always render frozen cards (card DOM may have been rebuilt by renderMatches).
        renderOverlay(card, fix, false, 0, true);
        continue;
      }

      if (_frozen.has(ek)) {
        // Frozen key but status changed (e.g. feed correction) — re-render as live.
        _frozen.delete(ek);
      }

      renderOverlay(card, fix, isStale, ageMs, false);
    }
  }

  // ─── render ──────────────────────────────────────────────────────────────────
  function renderOverlay(card, fix, isStale, ageMs, frozen) {
    let overlay = card.querySelector('.live-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'live-overlay';
      // Insert after .mc-head; fall back to prepend if no head.
      const head = card.querySelector('.mc-head');
      if (head) {
        head.after(overlay);
      } else {
        card.prepend(overlay);
      }
    }

    const score  = buildScoreHtml(fix);
    const server = serverDot(fix);

    let badge;
    if (frozen) {
      badge = '<span class="lo-badge lo-frozen">Final</span>';
    } else if (isStale) {
      const secs = Math.round(ageMs / 1000);
      badge = `<span class="lo-badge lo-stale">stale · ${secs}s ago</span>`;
    } else {
      badge = '<span class="lo-badge lo-live"><span class="lo-dot"></span>Live</span>';
    }

    overlay.innerHTML = `<div class="lo-row">${score}${server}${badge}</div>`;
  }

  function buildScoreHtml(fix) {
    const scores = fix.scores;
    if (Array.isArray(scores) && scores.length) {
      const sets = scores.map(s => `${s.score_first ?? '?'}-${s.score_second ?? '?'}`).join(' ');
      return `<span class="lo-score">${sets}</span>`;
    }
    const sf = fix.score_first ?? fix.home_score ?? '';
    const ss = fix.score_second ?? fix.away_score ?? '';
    if (sf !== '' || ss !== '') return `<span class="lo-score">${sf}-${ss}</span>`;
    return '';
  }

  function serverDot(fix) {
    const s = fix.serve ?? fix.server ?? '';
    if (!s) return '';
    return `<span class="lo-server" title="Serving">• P${s}</span>`;
  }

  // ─── boot ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => schedulePoll(0));
  } else {
    schedulePoll(0);
  }
})();
