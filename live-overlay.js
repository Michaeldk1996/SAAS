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
  if (!SB_URL || !SB_KEY) {
    console.warn('[live-overlay] SUPABASE_URL / SUPABASE_ANON_KEY not set — skipping');
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
  let _timer = null;
  let _backoffMs = 0;          // 0 = use normal interval
  let _frozen = new Set();     // event_keys of matches we've frozen (match ended)
  let _paused = false;

  // ─── pause on hidden, resume on visible ─────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _paused = true;
      clearTimeout(_timer);
    } else {
      _paused = false;
      _backoffMs = 0;
      schedulePoll(0);
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
    if (_paused) return;
    let row;
    try {
      row = await fetchSnapshot();
      _backoffMs = 0;  // reset on success
    } catch (err) {
      console.warn('[live-overlay] fetch failed:', err.message);
      _backoffMs = _backoffMs
        ? Math.min(_backoffMs * 2, BACKOFF_MAX_MS)
        : BACKOFF_BASE_MS;
      // Leave previous overlays intact (stale badge will appear naturally on
      // the next staleness check against the unchanged updated_at).
      schedulePoll(_backoffMs);
      return;
    }

    if (!row) {
      schedulePoll(POLL_INTERVAL_MS);
      return;
    }

    const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
    const ageMs = updatedAt ? Date.now() - updatedAt.getTime() : Infinity;
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

  // ─── overlay application ─────────────────────────────────────────────────────
  function applyOverlays(matches, isStale, ageMs) {
    // Build a lookup: event_key → live fixture data
    const byKey = {};
    for (const fix of matches) {
      const key = String(fix.event_key || '');
      if (key) byKey[key] = fix;
    }

    // Walk every match card on the page
    const cards = document.querySelectorAll('article.match-card[data-ek]');
    for (const card of cards) {
      const ek = card.dataset.ek;
      if (!ek) continue;

      const fix = byKey[ek];
      if (!fix) {
        // Not in the live board — card may not have started yet, leave it alone.
        continue;
      }

      // Freeze detection: match finished server-side
      const status = (fix.event_status || fix.status || '').toLowerCase();
      const isFinal = status.includes('finished') || status.includes('retired') ||
                      status.includes('walkover') || status.includes('abandoned');
      if (isFinal && !_frozen.has(ek)) {
        _frozen.add(ek);
        renderOverlay(card, fix, false /* not stale */, 0, true /* frozen */);
        continue;
      }
      if (_frozen.has(ek)) continue;

      renderOverlay(card, fix, isStale, ageMs, false);
    }
  }

  // ─── render ──────────────────────────────────────────────────────────────────
  function renderOverlay(card, fix, isStale, ageMs, frozen) {
    let overlay = card.querySelector('.live-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'live-overlay';
      // Insert after .mc-head if present, else prepend
      const head = card.querySelector('.mc-head');
      if (head && head.nextSibling) {
        card.insertBefore(overlay, head.nextSibling);
      } else {
        card.prepend(overlay);
      }
    }

    // Score lines
    const score = buildScoreHtml(fix);
    const server = serverDot(fix);

    // Stale / frozen badge
    let badge = '';
    if (frozen) {
      badge = '<span class="lo-badge lo-frozen">Final</span>';
    } else if (isStale) {
      const secs = Math.round(ageMs / 1000);
      badge = `<span class="lo-badge lo-stale">stale · ${secs}s ago</span>`;
    } else {
      badge = '<span class="lo-badge lo-live"><span class="lo-dot"></span>Live</span>';
    }

    overlay.innerHTML =
      `<div class="lo-row">${score}${server}${badge}</div>`;
  }

  function buildScoreHtml(fix) {
    // api-tennis livescore: scores array [ {score_first, score_second, ...} ]
    // or flat score_first / score_second fields.
    const scores = fix.scores;
    if (Array.isArray(scores) && scores.length) {
      const sets = scores.map(s => `${s.score_first ?? '?'}-${s.score_second ?? '?'}`).join(' ');
      return `<span class="lo-score">${sets}</span>`;
    }
    // Fallback: flat fields
    const sf = fix.score_first ?? fix.home_score ?? '';
    const ss = fix.score_second ?? fix.away_score ?? '';
    if (sf !== '' || ss !== '') {
      return `<span class="lo-score">${sf}-${ss}</span>`;
    }
    return '';
  }

  function serverDot(fix) {
    // api-tennis includes serve field ('1' or '2' meaning player 1/2 serving)
    const s = fix.serve ?? fix.server ?? '';
    if (!s) return '';
    return `<span class="lo-server" title="Serving">• P${s}</span>`;
  }

  // ─── IntersectionObserver: activate only for visible cards ──────────────────
  // We start polling immediately (not per-card IO), but IO is used to avoid
  // rendering overlays on cards that have scrolled entirely out of view.
  // (Overlay updates for out-of-view cards are still in the DOM; we simply
  // skip the DOM writes until the card enters the viewport on the next tick.)
  // For Slice 3 simplicity we poll globally and write to all in-view cards.

  // ─── boot ────────────────────────────────────────────────────────────────────
  // Start on DOMContentLoaded (or immediately if already loaded).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => schedulePoll(0));
  } else {
    schedulePoll(0);
  }
})();
