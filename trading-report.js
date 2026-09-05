// TEN-151 · Trading Report — live in-play board with historical situational splits
//
// Founder scope (2026-09-04/05): a live board where each ROW is a PLAYER in a
// currently-underway ATP-singles match (two rows per match), with 24-month
// situational splits attached so a trader can scalp the match live. This build
// ships the page shell + the Key Stats tab only; the other six tabs are column
// configs over the same shard and slot in without restructuring (COLUMN_SETS).
//
// SOURCES (all read-only; nothing here mutates the Live tab, Matches board, or
// any of the four core JSON files):
//   • live slate   ← the SAME Supabase live_snapshot.board the Live tab reads,
//                     gated by the SAME predicate — window.LiveTab.isAtpSingles
//                     + window.LiveTab.isUnderway (widened export, TEN-151). We
//                     do NOT write a second live/not-live gate (founder ruling).
//   • splits       ← trading-splits-index.json + per-player trading-splits/{key}.json
//                     (Route B: built from the api-tennis fixtures the pipeline
//                     already fetches). Lazy — fetched only when Load is pressed.
//   • surface      ← tournament-surfaces.json  (tournament_key → surface), the
//                     same map the generator used, so the board can't diverge.
//   • rank/country ← the index `meta` map (name/rank/country), built from the
//                     committed player-profiles.json. A live player absent from
//                     the map renders with the as-fed name and dashed rank —
//                     never a guessed join.
//   • odds         ← trading-odds.json IF present (keyed by event_key), labelled
//                     pre-match with its capture timestamp and sourcing book.
//                     ABSENT → every odds cell dashes. Never a carried-forward or
//                     silently-substituted price (founder standing rule).
//
// Guard: window.FEATURE_TRADING_REPORT must be truthy. Never runs otherwise, so
// deploying this code with the flag OFF changes nothing live.

(function () {
  'use strict';

  if (!window.FEATURE_TRADING_REPORT) return;

  // The live gate is owned by live-tab.js (loaded before this via <script defer>
  // order). Reuse it verbatim — do not reimplement. If it isn't present the page
  // cannot honestly decide "in play", so it disables itself rather than guess.
  var LT = window.LiveTab;
  if (!LT || typeof LT.isUnderway !== 'function' || typeof LT.isAtpSingles !== 'function') {
    console.warn('[trading-report] window.LiveTab gate unavailable — Trading Report disabled');
    return;
  }

  var SB_URL = (window.SUPABASE_URL || '').replace(/\/$/, '');
  var SB_KEY = window.SUPABASE_ANON_KEY || '';
  if (!SB_URL || SB_URL.indexOf('__') === 0 || !SB_KEY || SB_KEY.indexOf('__') === 0) {
    console.warn('[trading-report] SUPABASE creds not configured — Trading Report disabled');
    return;
  }

  // ─── config ─────────────────────────────────────────────────────────────────
  var POLL_INTERVAL_MS   = 30000;   // match the live poller cadence
  var STALE_THRESHOLD_MS = 60000;
  var SNAPSHOT_ENDPOINT  = SB_URL + '/rest/v1/live_snapshot?select=board,match_count,updated_at&limit=1';
  var INDEX_URL          = './trading-splits-index.json';
  var SHARD_BASE         = './trading-splits/';
  var SURFACES_URL       = './tournament-surfaces.json';
  var ODDS_URL           = './trading-odds.json';
  var MATCHES_URL        = './matches.json';   // best-effort, empty-state hint only

  // The EXACT metrics (numerator/denominator stored in the shard; the UI divides
  // + rounds). Key Stats column order is founder-fixed (A-ruling 2026-09-05):
  // SH · SPW · RPW · BPS · BPW · OPH. OPH = opponent hold — how often this
  // player's OPPONENTS held serve, read off the opponent's service-games-won row
  // on the same fixtures (a return-strength context stat).
  var METRIC_LABELS = { sh: 'SH', spw: 'SPW', rpw: 'RPW', bps: 'BPS', bpw: 'BPW', oph: 'OPH' };
  var METRIC_TIPS = {
    sh:  'Service games held — won / service games played',
    spw: 'Service points won',
    rpw: 'Return points won',
    bps: 'Break points saved',
    bpw: 'Break points converted',
    oph: 'Opponent hold — service games held by this player’s opponents (return-strength context)',
  };

  // Config-driven tabs: each entry is a column set over the same shard. Only Key
  // Stats is defined now; the other six slot in here as configs later — the
  // render path reads this, nothing is hardcoded per tab.
  var COLUMN_SETS = {
    key: { label: 'Key Stats', metrics: ['sh', 'spw', 'rpw', 'bps', 'bpw', 'oph'] },
  };
  var ACTIVE_SET = 'key';

  var SURFACES = ['all', 'hard', 'clay', 'grass'];

  // ─── state ──────────────────────────────────────────────────────────────────
  var _active = false;
  var _timer = null;
  var _ticking = false;
  var _board = null;          // last live_snapshot.board array
  var _updatedAt = null;      // ms epoch of last snapshot
  var _index = null;          // trading-splits-index.json
  var _surfaceMap = null;     // tournament-surfaces.json .surfaces
  var _odds = null;           // trading-odds.json (or {} once we know it's absent)
  var _shards = {};           // key -> shard | null (null = fetched, none)
  var _loaded = false;        // has Load been pressed for the current slate?
  var _loading = false;
  var _surface = 'all';
  var _tourFilter = '';       // tournament_key, '' = all
  var _search = '';
  var _sortCol = null;        // null = feed order
  var _sortDir = -1;          // -1 desc, 1 asc
  var _matchesCache = null;   // matches.json (empty-state hint)
  var _bootstrapped = false;

  // ─── DOM ──────────────────────────────────────────────────────────────────
  function grid()   { return document.getElementById('tradingGrid'); }
  function status() { return document.getElementById('tradingStatus'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── fetch: live snapshot (same shape live-tab reads) ─────────────────────────
  function fetchSnapshot() {
    return fetch(SNAPSHOT_ENDPOINT, {
      headers: { apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY, accept: 'application/json' },
      cache: 'no-store',
    }).then(function (res) {
      if (!res.ok) throw new Error('snapshot ' + res.status);
      return res.json();
    }).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return null;
      // The live_snapshot.board column is an OBJECT {matches:[…]} — the exact
      // shape live-tab.js reads (`row.board?.matches`, live-tab.js:179). Mirror
      // it verbatim so the Trading Report cannot diverge from the Live tab on the
      // same feed. (Tolerate a bare-array board too, if the shape ever changes.)
      var b = (row.board && Array.isArray(row.board.matches)) ? row.board.matches
              : (Array.isArray(row.board) ? row.board : []);
      return { board: b, updated_at: row.updated_at };
    });
  }

  function getJSON(url, opts) {
    return fetch(url, opts || { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // ─── live rows: 2 player-rows per underway ATP-singles match ──────────────────
  function liveRows(board) {
    var fixtures = (Array.isArray(board) ? board : [])
      .filter(LT.isAtpSingles)
      .filter(LT.isUnderway);
    var rows = [];
    for (var i = 0; i < fixtures.length; i++) {
      var f = fixtures[i];
      rows.push(makeRow(f, 1));
      rows.push(makeRow(f, 2));
    }
    return rows;
  }

  function makeRow(f, which) {
    var isFirst = which === 1;
    var key = String((isFirst ? f.first_player_key : f.second_player_key) || '');
    var fedName = (isFirst ? f.event_first_player : f.event_second_player) || '—';
    var m = (_index && _index.meta && _index.meta[key]) || null;
    var tk = String(f.tournament_key || '');
    var surface = (_surfaceMap && _surfaceMap[tk]) || null;   // null => unmapped
    return {
      eventKey: String(f.event_key || ''),
      which: which,
      key: key,
      name: (m && m.name) ? m.name : fedName,        // meta name if joined, else as-fed
      joined: !!m,
      rank: (m && m.rank != null) ? m.rank : null,
      country: (m && m.country) ? m.country : null,
      tournament: f.tournament_name || '',
      tournamentKey: tk,
      surface: surface,
      start: ((f.event_date || '') + ' ' + (f.event_time || '')).trim(),
      status: f.event_status || 'Live',
    };
  }

  // ─── shard reads ──────────────────────────────────────────────────────────
  // Primary tier = the tier with the larger in-window match count (founder ruling
  // 2026-09-05). Returns { primary, secondary } tier keys or nulls.
  function tiersOf(shard) {
    if (!shard || !shard.tiers) return { primary: null, secondary: null };
    var t = shard.tiers;
    var tourM = (t.tour && t.tour.all && t.tour.all.m) || 0;
    var chalM = (t.chal && t.chal.all && t.chal.all.m) || 0;
    if (!tourM && !chalM) return { primary: null, secondary: null };
    if (tourM >= chalM) return { primary: 'tour', secondary: chalM ? 'chal' : null };
    return { primary: 'chal', secondary: tourM ? 'tour' : null };
  }

  // Surface bucket for the selected surface within the primary tier. Absent
  // surface => null (metrics + matches dash for that surface).
  function bucketFor(shard, tierKey, surface) {
    if (!shard || !tierKey || !shard.tiers || !shard.tiers[tierKey]) return null;
    return shard.tiers[tierKey][surface] || null;
  }

  function matchMin() {
    return (_index && _index.lowSample && _index.lowSample.matchMin) || 10;
  }
  function slateMutePct() {
    return (_index && _index.lowSample && _index.lowSample.slateMutePct) || 40;
  }

  // ─── cell renderers ─────────────────────────────────────────────────────────
  function dash(cls) { return '<td class="tr-cell tr-dash' + (cls ? ' ' + cls : '') + '">—</td>'; }

  function statCell(bucket, mk) {
    if (!bucket) return dash('tr-stat');
    var v = bucket[mk];
    if (!v || !(v[1] > 0)) return dash('tr-stat');
    var pct = Math.round((100 * v[0]) / v[1]);
    // Thin = the surface bucket's coverage count is under the floor. Value +
    // fraction stay VISIBLE and muted, never dashed, never coloured (founder R1).
    var thin = (bucket.m || 0) < matchMin();
    return '<td class="tr-cell tr-stat' + (thin ? ' thin' : '') + '">' +
             '<span class="tr-pct">' + pct + '%</span>' +
             '<span class="tr-frac">' + v[0] + '/' + v[1] + '</span>' +
           '</td>';
  }

  // odds: pre-match static, book-named, dash where absent. Never carried forward.
  function oddsCell(row) {
    var rec = _odds && (_odds[row.eventKey] || null);
    var price = rec && rec[row.which === 1 ? 'p1' : 'p2'];
    if (!price || !price.price) return dash('tr-odds');
    return '<td class="tr-cell tr-odds"><span class="tr-price">' + esc(price.price) + '</span>' +
           (price.book ? '<span class="tr-book">' + esc(price.book) + '</span>' : '') + '</td>';
  }

  function flagBadge(country) {
    if (!country) return '';
    return '<span class="tr-flag" title="' + esc(country) + '">' + esc(country) + '</span>';
  }

  function playerCell(row, shard) {
    var tk = tiersOf(shard);
    var tierBadge = '';
    if (tk.primary) {
      tierBadge = '<span class="tr-tier">' + (tk.primary === 'tour' ? 'Tour' : 'Chal') + '</span>';
      if (tk.secondary) {
        tierBadge += '<span class="tr-tier tr-tier2">' + (tk.secondary === 'tour' ? 'Tour' : 'Chal') + '</span>';
      }
    }
    var rankTxt = (row.rank != null) ? ('#' + row.rank) : '<span class="tr-dash-inline">—</span>';
    var surfTxt = row.surface ? esc(row.surface) : '<span class="tr-dash-inline">—</span>';
    return '<td class="tr-cell tr-player">' +
             '<div class="tr-pline">' + flagBadge(row.country) +
               '<span class="tr-pname">' + esc(row.name) + '</span>' +
               '<span class="tr-prank">' + rankTxt + '</span>' + tierBadge +
             '</div>' +
             '<div class="tr-pmeta">' + esc(row.tournament) + ' · ' + surfTxt + '</div>' +
           '</td>';
  }

  // ─── sorting ────────────────────────────────────────────────────────────────
  function sortValue(row, col) {
    var shard = _shards[row.key];
    var tk = tiersOf(shard);
    var b = bucketFor(shard, tk.primary, _surface);
    if (col === 'time') return row.start;
    if (col === 'player') return (row.name || '').toLowerCase();
    if (col === 'matches') return b ? (b.m || 0) : -1;
    if (col === 'odds') {
      var rec = _odds && _odds[row.eventKey];
      var p = rec && rec[row.which === 1 ? 'p1' : 'p2'];
      // A missing price sorts to the same end as a dashed stat cell (return -1),
      // not to the top — keep one convention across every dashable column.
      return (p && p.price) ? Number(p.price) : -1;
    }
    // stat metric
    if (!b || !b[col] || !(b[col][1] > 0)) return -1;   // dashed cells sort last
    return (100 * b[col][0]) / b[col][1];
  }

  function applySort(rows) {
    if (!_sortCol) return rows;
    var col = _sortCol, dir = _sortDir;
    return rows.slice().sort(function (a, b) {
      var va = sortValue(a, col), vb = sortValue(b, col);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  // ─── render ─────────────────────────────────────────────────────────────────
  function staleness() {
    if (_updatedAt == null) return { isStale: false, ageMs: 0 };
    var age = Date.now() - _updatedAt;
    return { isStale: age > STALE_THRESHOLD_MS, ageMs: age };
  }

  function renderStatus(nRows) {
    var s = status();
    if (!s) return;
    var st = staleness();
    if (st.isStale) {
      s.className = 'tr-status stale';
      s.innerHTML = '<span class="tr-dot"></span>Stale · last update ' + Math.round(st.ageMs / 1000) + 's ago';
    } else {
      s.className = 'tr-status live';
      var nMatches = nRows / 2;
      s.innerHTML = '<span class="tr-dot"></span>' + nMatches + ' match' + (nMatches === 1 ? '' : 'es') +
                    ' live · ' + nRows + ' rows · updates every 30s';
    }
  }

  function emptyStateHtml() {
    var hint = '';
    if (_matchesCache && Array.isArray(_matchesCache)) {
      var now = Date.now();
      var next = null;
      for (var i = 0; i < _matchesCache.length; i++) {
        var m = _matchesCache[i];
        var ts = m && m.startTs ? Number(m.startTs) * (String(m.startTs).length <= 10 ? 1000 : 1) : null;
        if (ts && ts > now && (next == null || ts < next)) next = ts;
      }
      if (next) {
        var d = new Date(next);
        hint = '<p class="tr-empty-sub">Next scheduled play around ' +
               esc(d.toUTCString().replace(':00 GMT', ' GMT')) + '.</p>';
      }
    }
    if (!hint) hint = '<p class="tr-empty-sub">The board fills automatically as ATP singles matches go in play.</p>';
    return '<div class="tr-empty">' +
             '<div class="tr-empty-icon">◍</div>' +
             '<p class="tr-empty-title">No ATP singles in play right now</p>' + hint +
           '</div>';
  }

  function filterBarHtml(rows) {
    // tournaments present in the current slate
    var tset = {};
    for (var i = 0; i < rows.length; i++) if (rows[i].tournamentKey) tset[rows[i].tournamentKey] = rows[i].tournament;
    var tOpts = '<option value="">All tournaments</option>';
    Object.keys(tset).forEach(function (k) {
      tOpts += '<option value="' + esc(k) + '"' + (k === _tourFilter ? ' selected' : '') + '>' + esc(tset[k]) + '</option>';
    });
    var surfBtns = SURFACES.map(function (s) {
      return '<button type="button" class="tr-surf' + (s === _surface ? ' active' : '') + '" data-surf="' + s + '">' +
             (s === 'all' ? 'All surfaces' : s.charAt(0).toUpperCase() + s.slice(1)) + '</button>';
    }).join('');
    var win = _index && _index.generated && _index.generated.window;
    var periodTxt = win ? ('Last 24 months · to ' + esc(win.to)) : 'Last 24 months';
    var loadTxt = _loaded ? 'Reload stats' : 'Load stats';
    return '<div class="tr-filters">' +
             '<div class="tr-surfrow">' + surfBtns + '</div>' +
             '<select class="tr-tsel" id="trTournSel">' + tOpts + '</select>' +
             '<span class="tr-period" title="The splits are a fixed 24-month window — the range the data covers. It is not a selectable shorter range.">' + periodTxt + '</span>' +
             '<input class="tr-search" id="trSearch" type="text" placeholder="Search player" value="' + esc(_search) + '">' +
             '<button type="button" class="tr-load" id="trLoadBtn"' + (_loading ? ' disabled' : '') + '>' +
               (_loading ? 'Loading…' : loadTxt) + '</button>' +
           '</div>';
  }

  function headerHtml(cfg) {
    function th(col, label, tip) {
      var arrow = (_sortCol === col) ? (_sortDir === -1 ? ' ▾' : ' ▴') : '';
      return '<th class="tr-th" data-sort="' + col + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' +
             esc(label) + arrow + '</th>';
    }
    var oddsTip = 'Pre-match price' + (_odds && _odds.__meta && _odds.__meta.captured ? ', captured ' + esc(_odds.__meta.captured) : '') +
                  '. Never an in-running or carried-forward price; the book is named on each row.';
    var cells = [
      th('time', 'Time'),
      th('player', 'Player'),
      th('odds', 'Odds (pre-match)', oddsTip),
      th('matches', 'Matches', 'Coverage count — matches carrying ≥1 tracked stat in the selected tier/surface. NOT the denominator behind any one percentage; each cell shows its own fraction.'),
    ];
    cfg.metrics.forEach(function (mk) { cells.push(th(mk, METRIC_LABELS[mk], METRIC_TIPS[mk])); });
    return '<thead><tr>' + cells.join('') + '</tr></thead>';
  }

  function noticeHtml(rows) {
    if (_surface === 'all' || !_loaded) return '';
    var thin = 0, counted = 0;
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].key;
      // Only assess rows we actually hold splits for. An unjoined player or an
      // unloaded/absent shard is "unknown", not "thin" — it must not swing the
      // slate notice (founder R1: a dashed cell is not a thin cell).
      if (!rows[i].joined || !(key in _shards) || !_shards[key]) continue;
      var shard = _shards[key];
      var b = bucketFor(shard, tiersOf(shard).primary, _surface);
      counted++;
      // An absent surface bucket = 0 matches on that surface (the generator
      // prunes empty surfaces) = genuinely under the floor, so it still counts
      // toward "most players under 10 matches".
      if (!b || (b.m || 0) < matchMin()) thin++;
    }
    if (!counted) return '';
    if ((thin / counted) * 100 <= slateMutePct()) return '';
    var tmpl = (_index && _index.lowSample && _index.lowSample.notice) ||
               'Low sample across this slate — the {surface} filter leaves most players under 10 matches. Percentages stay visible and muted, with their fractions.';
    return '<div class="tr-notice">' + esc(tmpl.replace('{surface}', _surface)) + '</div>';
  }

  function rowHtml(row, cfg) {
    var shard = _shards[row.key];
    var tk = tiersOf(shard);
    var bucket = bucketFor(shard, tk.primary, _surface);
    var cells = '';
    // TIME
    cells += '<td class="tr-cell tr-time">' + esc(row.start || '—') + '</td>';
    // PLAYER
    cells += playerCell(row, shard);
    // ODDS
    cells += oddsCell(row);
    // MATCHES (coverage)
    if (!_loaded) cells += '<td class="tr-cell tr-matches tr-pending">·</td>';
    else if (!bucket) cells += dash('tr-matches');
    else cells += '<td class="tr-cell tr-matches">' + (bucket.m || 0) + '</td>';
    // metrics
    cfg.metrics.forEach(function (mk) {
      if (!_loaded) cells += '<td class="tr-cell tr-stat tr-pending">·</td>';
      else cells += statCell(bucket, mk);
    });
    return '<tr class="tr-row"' + (row.joined ? '' : ' data-unjoined="1"') + '>' + cells + '</tr>';
  }

  function render() {
    if (!_bootstrapped) return;
    var g = grid();
    if (!g) return;

    var rows = liveRows(_board);
    renderStatus(rows.length);

    if (!rows.length) {
      g.innerHTML = emptyStateHtml();
      return;
    }

    // apply tournament filter + search (these narrow the visible slate)
    var view = rows.filter(function (r) {
      if (_tourFilter && r.tournamentKey !== _tourFilter) return false;
      if (_search && (r.name || '').toLowerCase().indexOf(_search.toLowerCase()) === -1) return false;
      return true;
    });
    view = applySort(view);

    var cfg = COLUMN_SETS[ACTIVE_SET];
    var html = filterBarHtml(rows) + noticeHtml(view);
    if (!view.length) {
      html += '<div class="tr-empty tr-empty-sm"><p class="tr-empty-title">No players match this filter</p>' +
              '<p class="tr-empty-sub">Clear the tournament filter or search to see the full live slate.</p></div>';
    } else {
      html += '<div class="tr-tablewrap"><table class="tr-table">' + headerHtml(cfg) +
              '<tbody>' + view.map(function (r) { return rowHtml(r, cfg); }).join('') + '</tbody></table></div>';
    }
    if (!_loaded && view.length) {
      html += '<p class="tr-loadhint">Press <strong>Load stats</strong> to fetch the 24-month splits for this slate. ' +
              'Stats are not fetched until you ask — it keeps the board light.</p>';
    }
    g.innerHTML = html;
  }

  // ─── data loading (explicit Load) ─────────────────────────────────────────────
  function ensureStatics() {
    var jobs = [];
    if (!_index) jobs.push(getJSON(INDEX_URL).then(function (j) { _index = j; }).catch(function (e) {
      console.warn('[trading-report] index load failed:', e.message); _index = _index || { players: [], meta: {} };
    }));
    if (!_surfaceMap) jobs.push(getJSON(SURFACES_URL).then(function (j) { _surfaceMap = (j && j.surfaces) || {}; }).catch(function () { _surfaceMap = {}; }));
    if (_odds == null) jobs.push(getJSON(ODDS_URL).then(function (j) { _odds = j || {}; }).catch(function () { _odds = {}; }));
    return Promise.all(jobs);
  }

  function loadStats() {
    if (_loading) return;
    _loading = true;
    render();
    ensureStatics().then(function () {
      var rows = liveRows(_board);
      var keys = {};
      rows.forEach(function (r) { if (r.key && r.joined) keys[r.key] = 1; });
      var toFetch = Object.keys(keys).filter(function (k) { return !(k in _shards); });
      return Promise.all(toFetch.map(function (k) {
        return getJSON(SHARD_BASE + k + '.json').then(function (j) { _shards[k] = j; })
          .catch(function () { _shards[k] = null; });   // 404/absent → dashed row, never guessed
      }));
    }).then(function () {
      _loaded = true; _loading = false; render();
    }).catch(function (e) {
      console.warn('[trading-report] load failed:', e.message);
      _loading = false; render();
    });
  }

  // ─── snapshot polling (only while active + visible) ───────────────────────────
  function tick() {
    if (_ticking) return;
    _ticking = true;
    fetchSnapshot().then(function (snap) {
      if (snap) {
        _board = snap.board;
        _updatedAt = snap.updated_at ? Date.parse(snap.updated_at) : Date.now();
      }
    }).catch(function (err) {
      console.warn('[trading-report] snapshot fetch failed:', err.message);
    }).then(function () {
      _ticking = false;
      render();
      if (_active && !document.hidden) _timer = setTimeout(tick, POLL_INTERVAL_MS);
    });
  }

  function startPolling() {
    clearTimeout(_timer);
    tick();
  }

  // ─── bootstrap + public control surface ───────────────────────────────────────
  function bootstrap() {
    if (_bootstrapped) return;
    var g = grid();
    if (!g) return;
    _bootstrapped = true;
    // delegated handlers on the grid (rebuilt each render)
    g.addEventListener('click', function (e) {
      var surfBtn = e.target.closest && e.target.closest('.tr-surf');
      if (surfBtn) { _surface = surfBtn.getAttribute('data-surf'); render(); return; }
      var load = e.target.closest && e.target.closest('#trLoadBtn');
      if (load) { loadStats(); return; }
      var th = e.target.closest && e.target.closest('.tr-th');
      if (th) {
        var col = th.getAttribute('data-sort');
        if (_sortCol === col) _sortDir = -_sortDir; else { _sortCol = col; _sortDir = -1; }
        render();
        return;
      }
    });
    g.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'trTournSel') { _tourFilter = e.target.value; render(); }
    });
    g.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'trSearch') { _search = e.target.value; render(); }
    });
    // empty-state hint source (best-effort, once)
    getJSON(MATCHES_URL).then(function (j) { _matchesCache = (j && j.matches) || j; }).catch(function () {});
  }

  function setActive(isActive) {
    if (isActive && !_active) {
      _active = true;
      bootstrap();
      // A new slate visit re-arms the explicit-Load contract: don't silently
      // carry stale stats from a previous visit onto a changed live board.
      startPolling();
    } else if (!isActive && _active) {
      _active = false;
      clearTimeout(_timer);
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (!_active) return;
    if (document.hidden) clearTimeout(_timer);
    else startPolling();
  });

  // reveal the nav tab (only reached past the flag + creds guards, so a flag-OFF
  // or mis-provisioned build never surfaces a dead tab)
  (function revealNavTab() {
    var show = function () {
      var btn = document.getElementById('tradingTabBtn');
      if (btn) btn.style.display = '';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  })();

  window.TradingReport = { setActive: setActive };
})();
