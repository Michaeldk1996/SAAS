// TEN-151 · Trading Report — daily ATP-singles board with historical situational splits
//
// Founder scope (2026-09-06, reverses the earlier live-only ruling): the board now
// shows TODAY's ATP singles — every scheduled match, in play or not — with a
// LIVE / TODAY toggle, Today / Tomorrow date tabs, a surface dropdown (All /
// Hard / Clay / Grass, reads the matching shard bucket), book-named odds
// (pre-match price for scheduled rows, the closing price
// for rows now in play), player photos via the SAME resolver the profile pages use
// (with a monogram fallback), flag icons, sort indicators, and a per-player load bar.
//
// SOURCES (all read-only; nothing here mutates the Live tab, the Matches board, the
// four core JSON files, the ten141 cron, or the entry-lists workstream):
//   • slate        ← matches.json (the daily ATP-singles slate the Matches board
//                     already loads). Row unit is a PLAYER — two rows per match.
//                     Carries p1/p2, p1Key/p2Key, ranks, surface, tour, start time,
//                     pre-match `odds` and (for started matches) `closingOdds`.
//                     Fetched ONCE per visit (reused from the dashboard's parsed
//                     `matches` global when present — never re-fetched on the poll).
//   • live state   ← the SAME Supabase live_snapshot.board the Live tab reads,
//                     filtered by the SAME predicate (window.LiveTab.isAtpSingles +
//                     window.LiveTab.isUnderway). We do NOT write a second live gate
//                     (founder ruling): the snapshot only yields the SET of match
//                     player-key pairs currently in play; a slate row flips to LIVE
//                     when its pair enters that set. Same row, same data, new state.
//   • splits       ← trading-splits-index.json + per-player trading-splits/{key}.json
//                     (keyed by api-tennis player_key). Loaded progressively.
//   • rank/country ← the index `meta` map (name/rank/country) built from the
//                     committed player-profiles.json — used for the country flag.
//   • photos       ← the dashboard's shared photoCandidatesFor(), driven off the
//                     api-tennis player_key + the profile-format name (meta.name).
//                     Chain order (TEN-151, founder ruling 2026-09-06):
//                     ATP official alias (player-atp-aliases.json, PRIMARY / source
//                     of truth) -> Wikimedia override (player-photos.json, filler)
//                     -> api-tennis constructed logo -> monogram-initials. ONE
//                     ordering, reused via the page global — not a parallel
//                     Trading-Report photo map, not a second chain order.
//
// Odds standing rule (founder): a live row shows the CLOSING price (labelled), a
// scheduled row the PRE-MATCH price; the book is named on every cell; a missing
// price DASHES — never carried forward, never silently substituted from another book.
//
// Guard: window.FEATURE_TRADING_REPORT must be truthy. Never runs otherwise, so
// deploying this code with the flag OFF changes nothing live.

(function () {
  'use strict';

  if (!window.FEATURE_TRADING_REPORT) return;

  // The live gate is owned by live-tab.js (loaded before this via <script defer>
  // order). Reuse it verbatim — do not reimplement. If it isn't present the page
  // cannot honestly decide "in play", so it degrades to matches.json's own live
  // flag rather than guess with a home-grown predicate.
  var LT = window.LiveTab;
  var HAS_GATE = LT && typeof LT.isUnderway === 'function' && typeof LT.isAtpSingles === 'function';
  if (!HAS_GATE) console.warn('[trading-report] window.LiveTab gate unavailable — Live view falls back to the feed live flag');

  var SB_URL = (window.SUPABASE_URL || '').replace(/\/$/, '');
  var SB_KEY = window.SUPABASE_ANON_KEY || '';
  var HAS_SB = SB_URL && SB_URL.indexOf('__') !== 0 && SB_KEY && SB_KEY.indexOf('__') !== 0;
  if (!HAS_SB) console.warn('[trading-report] SUPABASE creds not configured — Live view falls back to the feed live flag');

  // ─── config ─────────────────────────────────────────────────────────────────
  var POLL_INTERVAL_MS   = 30000;   // match the live poller cadence (snapshot only)
  var STALE_THRESHOLD_MS = 60000;
  var SNAPSHOT_ENDPOINT  = SB_URL + '/rest/v1/live_snapshot?select=board,updated_at&limit=1';
  var INDEX_URL          = './trading-splits-index.json';
  var SHARD_BASE         = './trading-splits/';
  var MATCHES_URL        = './matches.json';
  var SHARD_CONCURRENCY  = 6;       // polite parallelism while streaming shards in

  // Metric dictionary — unchanged from the shipped Key Stats build (founder-fixed).
  var METRIC_LABELS = {
    sh: 'SH', spw: 'SPW', rpw: 'RPW', bps: 'BPS', bpw: 'BPW', oph: 'OPH',
    htws: 'HTWS', htss: 'HTSS', bofs: 'BOFS', bfsg: 'BFSG',
    babb: 'BABB', bbk: 'BBK', bbkb: 'BBKB', gfb: 'GFB',
    ls1fb: 'LOST SET 1 FB', ls1bf: 'LOST SET 1 BF', bfs2aws1: 'BFS2AWS1',
    wfs: 'WFS', ws2: 'WS2', ws1w2: 'WS1W2', ls1ws2: 'LOST SET 1 WS2', ws1wm: 'WS1WM',
  };
  var METRIC_TIPS = {
    sh:  'Service games held — won / service games played',
    spw: 'Service points won',
    rpw: 'Return points won',
    bps: 'Break points saved',
    bpw: 'Break points converted',
    oph: 'Opponent hold — service games held by this player’s opponents (return-strength context)',
    htws: 'Held To Win Set — serving for the set, held to take it (per service game where a hold clinches the set)',
    htss: 'Held To Stay in Set — serving to avoid losing the set, held (per service game where a loss would lose the set)',
    bofs: 'Broke Opponent’s First Service game of the match',
    bfsg: 'Broken in own First Service Game of the match',
    babb: 'Broke then Broken Back in the same set — how often a break lead was surrendered within that set',
    bbk:  'Broken Back immediately — opponent breaks straight back in the very next service game',
    bbkb: 'Broke, Broken Back, then Broke again — re-broke in the same set after being broken back',
    gfb:  'Got First Break of the match',
    ls1fb: 'Lost Set 1, then fought back to WIN THE MATCH',
    ls1bf: 'Lost Set 1, then Broke First in Set 2',
    bfs2aws1: 'Broke First in Set 2 After Winning Set 1',
    wfs:  'Won First Set',
    ws2:  'Won Set 2',
    ws1w2: 'Won Set 1 then Won Set 2 (two sets to love up)',
    ls1ws2: 'Lost Set 1 then Won Set 2',
    ws1wm: 'Won Set 1 then Won the Match',
  };
  var SET_OUTCOME_KEYS = ['wfs', 'ws2', 'ws1w2', 'ls1ws2', 'ws1wm'];
  SET_OUTCOME_KEYS.forEach(function (k) {
    METRIC_TIPS[k] += ' — denominator counts only matches with the relevant set decided, so it can be lower than MATCHES (undecided sets from short-format events and retirements are excluded, never zero-filled).';
  });

  var COLUMN_SETS = {
    key:          { label: 'Key Stats',           metrics: ['sh', 'spw', 'rpw', 'bps', 'bpw', 'oph'] },
    laysetwinner: { label: 'Lay Set Winner',      metrics: ['ls1ws2', 'ws1w2', 'ls1fb', 'ls1bf', 'bpw', 'ws1wm', 'bfs2aws1'] },
    scalping:     { label: 'Scalping',            metrics: ['sh', 'spw', 'bps', 'htws', 'htss'] },
    laybreakup:   { label: 'Lay Break Up',        metrics: ['babb', 'bbk', 'bbkb', 'gfb', 'bfsg'] },
    settrading20: { label: 'Set Trading 2-0',     metrics: ['ws1w2', 'wfs', 'ws2', 'ls1ws2', 'gfb'] },
    layserve:     { label: 'Lay Serve Set/Match', metrics: ['htws', 'bofs', 'htss', 'bps', 'bpw'] },
    laysetbreak:  { label: 'Lay Set&Break',       metrics: ['ls1bf', 'ls1ws2', 'babb', 'ws1w2', 'bbk', 'bbkb'] },
  };
  var ACTIVE_SET = 'key';

  // Country name → ISO-3166-1 alpha-2, for a regional-indicator emoji flag. Covers
  // the tennis nations that appear in the index `meta` (full country names). An
  // unmapped country renders no flag rather than a wrong one (never guess).
  var NAME2ISO = {
    'Argentina':'AR','Australia':'AU','Austria':'AT','Belarus':'BY','Belgium':'BE',
    'Bolivia':'BO','Bosnia and Herzegovina':'BA','Brazil':'BR','Bulgaria':'BG',
    'Canada':'CA','Chile':'CL','China':'CN','Chinese Taipei':'TW','Colombia':'CO',
    'Croatia':'HR','Cyprus':'CY','Czechia':'CZ','Czech Republic':'CZ','Denmark':'DK',
    'Dominican Republic':'DO','Ecuador':'EC','Egypt':'EG','Estonia':'EE','Finland':'FI',
    'France':'FR','Georgia':'GE','Germany':'DE','Great Britain':'GB','United Kingdom':'GB',
    'Greece':'GR','Hong Kong':'HK','Hungary':'HU','Iceland':'IS','India':'IN','Indonesia':'ID',
    'Iran':'IR','Ireland':'IE','Israel':'IL','Italy':'IT','Japan':'JP','Jordan':'JO',
    'Kazakhstan':'KZ','Korea':'KR','South Korea':'KR','Kosovo':'XK','Kuwait':'KW',
    'Latvia':'LV','Lebanon':'LB','Lithuania':'LT','Luxembourg':'LU','Mexico':'MX',
    'Moldova':'MD','Monaco':'MC','Montenegro':'ME','Morocco':'MA','Netherlands':'NL',
    'New Zealand':'NZ','North Macedonia':'MK','Norway':'NO','Paraguay':'PY','Peru':'PE',
    'Philippines':'PH','Poland':'PL','Portugal':'PT','Qatar':'QA','Romania':'RO',
    'Russia':'RU','Saudi Arabia':'SA','Serbia':'RS','Slovakia':'SK','Slovenia':'SI',
    'South Africa':'ZA','Spain':'ES','Sweden':'SE','Switzerland':'CH','Taiwan':'TW',
    'Thailand':'TH','Tunisia':'TN','Turkey':'TR','Türkiye':'TR','Ukraine':'UA',
    'United States':'US','USA':'US','Uruguay':'UY','Uzbekistan':'UZ','Venezuela':'VE',
    'Zimbabwe':'ZW',
  };
  function emojiFlag(country) {
    var iso = country && NAME2ISO[country];
    if (!iso || iso.length !== 2) return '';
    return iso.toUpperCase().replace(/./g, function (c) {
      return String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0));
    });
  }

  // ─── state ──────────────────────────────────────────────────────────────────
  var _active = false;
  var _timer = null;
  var _ticking = false;
  var _underway = null;       // Set of pairKeys currently in play, or null (no snapshot)
  var _liveFixtures = null;   // underway ATP-singles fixtures from the snapshot, or null
  var _updatedAt = null;      // ms epoch of last snapshot
  var _matches = null;        // matches.json array (fetched/reused once)
  var _index = null;          // trading-splits-index.json
  var _shards = {};           // key -> shard | null (null = fetched, none)
  var _loaded = false;        // every key in the current slate has been fetched
  var _loading = false;
  var _loadDone = 0;
  var _loadTotal = 0;
  var _view = 'today';        // 'today' (all scheduled) | 'live' (in-play only)
  var _dateTab = 'today';     // 'today' | 'tomorrow'
  var _surfaceSel = 'all';    // surface dropdown: 'all' | 'hard' | 'clay' | 'grass' (reads that shard bucket directly)
  var _tourFilter = '';       // tournament label, '' = all
  var _search = '';
  var _sortCol = null;        // null = matches.json feed order
  var _sortDir = -1;          // -1 desc, 1 asc
  var _bootstrapped = false;
  var _loadSig = null;        // slate signature captured when the current load began
  var _matchesAt = 0;         // ms epoch of the last matches.json (re)load
  var _matchesDirty = false;  // matches slate changed since the last render
  var _lastUnderwaySig = null;// last rendered underway-set signature (skip idle repaints)

  function slateSig() { return _view + '|' + _dateTab; }
  var MATCHES_REFRESH_MS = 150000;   // refresh the slate at most this often, so a
                                     // match that starts mid-session gains its
                                     // closingOdds (the pre→close transition)

  // ─── DOM / util ─────────────────────────────────────────────────────────────
  function grid()   { return document.getElementById('tradingGrid'); }
  function status() { return document.getElementById('tradingStatus'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function pairKey(a, b) {
    var x = Number(a), y = Number(b);
    return (x <= y ? x + ':' + y : y + ':' + x);
  }
  function fmtOdds(v) {
    var n = Number(v);
    return isFinite(n) ? n.toFixed(2) : String(v);
  }
  function fmtClock(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function playerInitials(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }

  function getJSON(url, opts) {
    return fetch(url, opts || { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // ─── live snapshot → underway pair-key set (the ONE gate, reused) ─────────────
  function fetchUnderway() {
    if (!HAS_SB || !HAS_GATE) return Promise.resolve(null);
    return fetch(SNAPSHOT_ENDPOINT, {
      headers: { apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY, accept: 'application/json' },
      cache: 'no-store',
    }).then(function (res) {
      if (!res.ok) throw new Error('snapshot ' + res.status);
      return res.json();
    }).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return { set: null, fixtures: null, updated_at: null };
      var b = (row.board && Array.isArray(row.board.matches)) ? row.board.matches
              : (Array.isArray(row.board) ? row.board : []);
      // The SAME exported gate the Live tab uses — no second predicate. We keep
      // the surviving fixtures (not just their pair-keys) so the Live view can
      // render straight from the snapshot, exactly like the Live tab, instead of
      // depending on the match also being present in the matches.json slate.
      var fixtures = b.filter(LT.isAtpSingles).filter(LT.isUnderway);
      var set = {};
      fixtures.forEach(function (f) {
        set[pairKey(f.first_player_key, f.second_player_key)] = 1;
      });
      return { set: set, fixtures: fixtures, updated_at: row.updated_at };
    });
  }

  // ─── slate rows from matches.json ─────────────────────────────────────────────
  function isMatchLive(m) {
    // The ONE liveness signal is the isUnderway gate applied to the live snapshot
    // (via _underway). Only when the snapshot is entirely unavailable (no creds /
    // no gate) do we fall back to the feed's own `live` flag so the Live view is
    // not silently empty — never a home-grown predicate.
    if (_underway) return !!_underway[pairKey(m.p1Key, m.p2Key)];
    return !!m.live;
  }

  function oddsFor(m, which, live) {
    var src = live ? m.closingOdds : m.odds;   // closing for in-play, pre-match otherwise
    if (!src) return null;
    var price = which === 1 ? src.p1 : src.p2;
    if (price == null || !(Number(price) > 0)) return null;
    return { price: price, book: src.bookmaker || '', at: src.at || null, kind: live ? 'close' : 'pre' };
  }

  function playerRow(m, which, live) {
    var isFirst = which === 1;
    var key = String((isFirst ? m.p1Key : m.p2Key) || '');
    var meta = (_index && _index.meta && _index.meta[key]) || null;
    var rank = isFirst ? m.p1Rank : m.p2Rank;
    if (rank == null && meta && meta.rank != null) rank = meta.rank;
    var surf = String(m.surface || '').toLowerCase();
    return {
      id: String(m.id || ''),
      which: which,
      key: key,
      name: (isFirst ? m.p1 : m.p2) || (meta && meta.name) || '—',
      // Profile-format name ("A. Surname") for the shared photo resolver's api-tennis
      // slug — the live display name (m.p1/p2) is full-format and won't parse. Same
      // player-profiles.json source the profile pages pass to resolveProfilePhotoUrl.
      photoName: (meta && meta.name) || null,
      rank: (rank == null ? null : rank),
      country: (meta && meta.country) || null,
      tour: m.tour || '',
      tournamentKey: m.tour || '',        // tournament filter groups by tour label
      surface: surf,
      startClock: m.time || fmtClock(m.startTs) || '',
      startSort: m.startTs || (m.date + ' ' + (m.time || '')),
      live: live,
      odds: oddsFor(m, which, live),
    };
  }

  function slateRows() {
    var arr = Array.isArray(_matches) ? _matches : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!m || m.day !== _dateTab) continue;               // date tab (Today / Tomorrow)
      if (!m.p1Key || !m.p2Key) continue;                   // need both player keys to build rows
      var live = isMatchLive(m);
      if (_view === 'live' && !live) continue;              // Live view = in-play only
      out.push(playerRow(m, 1, live));
      out.push(playerRow(m, 2, live));
    }
    return out;
  }

  // Find the slate match (if any) for a fixture's two players, regardless of the
  // p1/p2 orientation — used only to enrich live rows with the slate's odds.
  function slateMatchByKeys(a, b) {
    var arr = Array.isArray(_matches) ? _matches : [];
    var want = pairKey(a, b);
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (m && m.p1Key && m.p2Key && pairKey(m.p1Key, m.p2Key) === want) return m;
    }
    return null;
  }

  // Build one player row from a live snapshot fixture. Identity (name/rank/
  // country/surface) comes from the trading index; odds come from the slate
  // match when the pairing exists there, else DASH — never fabricated. This is
  // what lets the Live view show an in-play match that the daily slate has not
  // (yet) captured, e.g. a late-round Slam match missing from matches.json.
  function liveFixtureRow(f, which) {
    var isFirst = which === 1;
    var key = String((isFirst ? f.first_player_key : f.second_player_key) || '');
    var meta = (_index && _index.meta && _index.meta[key]) || null;
    var abbr = isFirst ? f.event_first_player : f.event_second_player;
    var slate = slateMatchByKeys(f.first_player_key, f.second_player_key);
    var odds = null;
    if (slate) {
      var which2 = (String(slate.p1Key) === key) ? 1 : 2;   // re-align to slate orientation
      odds = oddsFor(slate, which2, true);                  // live → closing price, or null
    }
    var surf = slate ? String(slate.surface || '').toLowerCase()
                     : String((meta && meta.surface) || '').toLowerCase();
    return {
      id: String(f.event_key || ''),
      which: which,
      key: key,
      name: (meta && meta.name) || abbr || '—',
      photoName: (meta && meta.name) || null,   // profile-format name for the shared photo resolver
      rank: (meta && meta.rank != null) ? meta.rank : null,
      country: (meta && meta.country) || null,
      tour: f.tournament_name || '',
      tournamentKey: f.tournament_name || '',
      surface: surf,
      startClock: f.event_time || '',
      startSort: (f.event_date || '') + ' ' + (f.event_time || ''),
      live: true,
      odds: odds,
    };
  }

  // Live-view rows, sourced straight from the underway snapshot fixtures (same
  // source + same gate as the Live tab). Falls back to the slate's own live rows
  // only when no snapshot is available (no creds / gate), preserving the prior
  // never-silently-empty degradation.
  function liveRows() {
    if (!Array.isArray(_liveFixtures)) return slateRows();   // no snapshot → slate live-flag fallback
    var out = [];
    for (var i = 0; i < _liveFixtures.length; i++) {
      var f = _liveFixtures[i];
      if (!f || !f.first_player_key || !f.second_player_key) continue;
      out.push(liveFixtureRow(f, 1));
      out.push(liveFixtureRow(f, 2));
    }
    return out;
  }

  // ─── shard reads ──────────────────────────────────────────────────────────
  function tiersOf(shard) {
    if (!shard || !shard.tiers) return { primary: null, secondary: null };
    var t = shard.tiers;
    var tourM = (t.tour && t.tour.all && t.tour.all.m) || 0;
    var chalM = (t.chal && t.chal.all && t.chal.all.m) || 0;
    if (!tourM && !chalM) return { primary: null, secondary: null };
    if (tourM >= chalM) return { primary: 'tour', secondary: chalM ? 'chal' : null };
    return { primary: 'chal', secondary: tourM ? 'tour' : null };
  }
  function bucketFor(shard, tierKey, surface) {
    if (!shard || !tierKey || !shard.tiers || !shard.tiers[tierKey]) return null;
    return shard.tiers[tierKey][surface] || null;
  }
  function surfaceKeyFor(row) { return _surfaceSel; }   // dropdown picks the shard bucket: all|hard|clay|grass
  function matchMin()    { return (_index && _index.lowSample && _index.lowSample.matchMin) || 10; }
  function slateMutePct() { return (_index && _index.lowSample && _index.lowSample.slateMutePct) || 40; }
  // Window covered by every figure, read from the index that generated the shards
  // (never asserted from memory). Currently one 24-month window for all metrics; the
  // 12-month option (and its pbp-floor easing note) lands with the generator work.
  function windowLabel() {
    var w = _index && _index.generated && _index.generated.window;
    if (w && w.from && w.to) return 'Last 24 months (' + w.from + ' → ' + w.to + ')';
    return 'Last 24 months';
  }

  // ─── cell renderers ─────────────────────────────────────────────────────────
  function dash(cls) { return '<td class="tr-cell tr-dash' + (cls ? ' ' + cls : '') + '">—</td>'; }

  function statCell(bucket, mk) {
    if (!bucket) return dash('tr-stat');
    var v = bucket[mk];
    if (!v || !(v[1] > 0)) return dash('tr-stat');
    var pct = Math.round((100 * v[0]) / v[1]);
    var thin = (bucket.m || 0) < matchMin();
    return '<td class="tr-cell tr-stat' + (thin ? ' thin' : '') + '">' +
             '<span class="tr-pct">' + pct + '%</span>' +
             '<span class="tr-frac">' + v[0] + '/' + v[1] + '</span>' +
           '</td>';
  }

  // odds: pre-match for scheduled rows, closing for in-play rows; book named; dash
  // where absent; never carried forward or silently substituted (founder rule).
  function oddsCell(row) {
    var o = row.odds;
    if (!o) return dash('tr-odds');
    var when = o.at ? fmtClock(o.at) : '';
    var tip = (o.kind === 'close'
      ? 'Closing price — the last quote before the match started'
      : 'Pre-match price') + (o.book ? ', ' + o.book : '') + (o.at ? ', captured ' + o.at : '') +
      '. Never an in-running or carried-forward price.';
    return '<td class="tr-cell tr-odds" title="' + esc(tip) + '">' +
             '<span class="tr-price">' + esc(fmtOdds(o.price)) + '</span>' +
             '<span class="tr-obook">' + (o.book ? esc(o.book) + (when ? ' · ' + esc(when) : '') : '') + '</span>' +
             '<span class="tr-otag tr-otag-' + o.kind + '">' + (o.kind === 'close' ? 'close' : 'pre') + '</span>' +
           '</td>';
  }

  function avatarHtml(row) {
    var mono = '<span class="tr-mono">' + esc(playerInitials(row.name)) + '</span>';
    // ONE resolver, reused from the profile pages (bsp-consult-dashboard.html):
    // Wikimedia override -> ATP official alias -> api-tennis constructed logo -> monogram.
    // Keyed on the api-tennis player_key + the profile-format name, exactly as the
    // profile hero does. Guarded so a missing page global degrades to the monogram
    // rather than throwing (trading-report.js only ever loads inside that page).
    var cands = [];
    try {
      // TEN-151: the chain ORDER is defined once in the dashboard's
      // photoCandidatesFor (ATP alias -> Wikimedia override -> api-tennis). Reuse it
      // verbatim so the Trading Report reads the identical chain in the identical
      // order as every other surface. The manual fallback below preserves that same
      // order if the page global is somehow absent (defensive; it always loads here).
      var fb = (typeof resolveProfilePhotoUrl === 'function') ? resolveProfilePhotoUrl(row.key, row.photoName || row.name) : null;
      if (typeof photoCandidatesFor === 'function') {
        cands = photoCandidatesFor(row.key, fb);
      } else {
        if (typeof atpPhotoFor === 'function')      cands.push(atpPhotoFor(row.key));
        if (typeof photoOverrideFor === 'function') cands.push(photoOverrideFor(row.key));
        if (fb)                                     cands.push(fb);
      }
    } catch (e) { /* fall through to monogram */ }
    cands = cands.filter(Boolean);
    if (!cands.length) return '<span class="tr-av-wrap">' + mono + '</span>';
    var src = cands[0];
    var fb  = cands.slice(1).join('|');
    // Monogram sits underneath; the shared avatarChainNext steps the <img> through the
    // remaining candidates on error, then the img hides so the monogram shows through —
    // the identical fallthrough the dashboard renderers use.
    return '<span class="tr-av-wrap">' + mono +
           '<img class="tr-av" src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
           'data-fb="' + esc(fb) + '" ' +
           'onerror="if(!(typeof avatarChainNext===\'function\'&&avatarChainNext(this)))this.style.display=\'none\'"></span>';
  }

  // Full name unless it exceeds the player column's character budget; then the
  // first name shortens to an initial ("Alejandro Davidovich Fokina" → "A.
  // Davidovich Fokina"). Never clips mid-word. The budget matches --tr-player-w
  // (262px, name on its own line) so the name never overflows the pinned cell.
  var NAME_BUDGET = 24;
  function fitName(name) {
    var s = String(name || '').trim();
    if (s.length <= NAME_BUDGET) return s;
    var sp = s.indexOf(' ');
    if (sp > 0 && sp < s.length - 1) {
      return s.charAt(0).toUpperCase() + '. ' + s.slice(sp + 1);
    }
    return s;
  }

  function playerCell(row, shard) {
    var tk = tiersOf(shard);
    var tierBadge = '';
    if (tk.primary) {
      tierBadge = '<span class="tr-tier">' + (tk.primary === 'tour' ? 'Tour' : 'Chal') + '</span>';
      if (tk.secondary) tierBadge += '<span class="tr-tier tr-tier2">' + (tk.secondary === 'tour' ? 'Tour' : 'Chal') + '</span>';
    }
    var flag = emojiFlag(row.country);
    var flagHtml = flag ? '<span class="tr-flag" title="' + esc(row.country) + '">' + flag + '</span>' : '';
    var rankTxt = (row.rank != null) ? ('#' + row.rank) : '<span class="tr-dash-inline">—</span>';
    var surfTxt = row.surface ? esc(cap(row.surface)) : '<span class="tr-dash-inline">—</span>';
    var disp = fitName(row.name);
    // Name gets its own line at full width; rank + tier ride the meta line so
    // they never steal room from the name (the old cause of "Alexander Zve…").
    return '<td class="tr-cell tr-player">' +
             '<div class="tr-pcell">' + avatarHtml(row) +
               '<div class="tr-pbody">' +
                 '<div class="tr-pline">' + flagHtml +
                   '<span class="tr-pname" title="' + esc(row.name) + '">' + esc(disp) + '</span>' +
                 '</div>' +
                 '<div class="tr-pmeta">' +
                   '<span class="tr-prank">' + rankTxt + '</span> · ' +
                   esc(row.tour) + ' · ' + surfTxt + tierBadge +
                 '</div>' +
               '</div>' +
             '</div>' +
           '</td>';
  }

  // ─── sorting ────────────────────────────────────────────────────────────────
  function sortValue(row, col) {
    var shard = _shards[row.key];
    var b = bucketFor(shard, tiersOf(shard).primary, surfaceKeyFor(row));
    if (col === 'time') { var t = Date.parse(row.startSort); return isFinite(t) ? t : 0; }
    if (col === 'player') return (row.name || '').toLowerCase();
    if (col === 'matches') return b ? (b.m || 0) : -1;
    if (col === 'odds') return (row.odds && Number(row.odds.price) > 0) ? Number(row.odds.price) : -1;
    if (!b || !b[col] || !(b[col][1] > 0)) return -1;
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

  // ─── status / progress ────────────────────────────────────────────────────────
  function staleness() {
    if (_updatedAt == null) return { isStale: false, ageMs: 0 };
    var age = Date.now() - _updatedAt;
    return { isStale: age > STALE_THRESHOLD_MS, ageMs: age };
  }
  function renderStatus(nMatches, nLive) {
    var s = status();
    if (!s) return;
    var st = staleness();
    if (_view === 'live' && st.isStale) {
      s.className = 'tr-status stale';
      s.innerHTML = '<span class="tr-dot"></span>Live feed stale · last update ' + Math.round(st.ageMs / 1000) + 's ago';
      return;
    }
    s.className = 'tr-status live';
    var label = (_view === 'live')
      ? (nMatches + ' match' + (nMatches === 1 ? '' : 'es') + ' in play · live feed every 30s')
      : (nMatches + ' ' + (_dateTab === 'tomorrow' ? 'scheduled tomorrow' : 'scheduled today') +
         (nLive ? ' · ' + nLive + ' in play now' : ''));
    s.innerHTML = '<span class="tr-dot"></span>' + label;
  }

  // ─── filter bar ──────────────────────────────────────────────────────────────
  function segBtn(cls, active, attr, label) {
    return '<button type="button" class="' + cls + (active ? ' active' : '') + '" ' + attr + '>' + label + '</button>';
  }
  function filterBarHtml(rows) {
    var tset = {};
    for (var i = 0; i < rows.length; i++) if (rows[i].tournamentKey) tset[rows[i].tournamentKey] = rows[i].tour;
    var tOpts = '<option value="">All tournaments</option>';
    Object.keys(tset).forEach(function (k) {
      tOpts += '<option value="' + esc(k) + '"' + (k === _tourFilter ? ' selected' : '') + '>' + esc(tset[k]) + '</option>';
    });
    var win = _index && _index.generated && _index.generated.window;
    var periodTxt = win ? ('Last 24 months · to ' + esc(win.to)) : 'Last 24 months';

    var viewSeg = '<div class="tr-seg" role="tablist" aria-label="View">' +
      segBtn('tr-segbtn', _view === 'live', 'data-view="live"', 'Live') +
      segBtn('tr-segbtn', _view === 'today', 'data-view="today"', 'Today') + '</div>';
    var dateSeg = '<div class="tr-seg" role="tablist" aria-label="Day">' +
      segBtn('tr-segbtn', _dateTab === 'today', 'data-date="today"', 'Today') +
      segBtn('tr-segbtn', _dateTab === 'tomorrow', 'data-date="tomorrow"', 'Tomorrow') + '</div>';
    var SURFS = [['all', 'All surfaces'], ['hard', 'Hard'], ['clay', 'Clay'], ['grass', 'Grass']];
    var surfOpts = SURFS.map(function (s) {
      return '<option value="' + s[0] + '"' + (s[0] === _surfaceSel ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');
    var surfSel = '<select class="tr-tsel tr-surfsel" id="trSurfSel" aria-label="Surface" ' +
      'title="Recompute every split on the selected surface. Thin-sample muting and the slate notice still apply when a surface produces thin data.">' +
      surfOpts + '</select>';

    var loadBlock;
    if (_loading) {
      var pct = _loadTotal ? Math.round((100 * _loadDone) / _loadTotal) : 0;
      loadBlock = '<div class="tr-progress"><div class="tr-progbar"><span style="width:' + pct + '%"></span></div>' +
                  '<span class="tr-progtxt">Loading stats: ' + _loadDone + '/' + _loadTotal + ' players</span></div>';
    } else {
      loadBlock = '<button type="button" class="tr-load" id="trLoadBtn">' + (_loaded ? 'Reload stats' : 'Load stats') + '</button>';
    }

    return '<div class="tr-filters">' +
             viewSeg + dateSeg + surfSel +
             '<select class="tr-tsel" id="trTournSel">' + tOpts + '</select>' +
             '<span class="tr-period" title="The splits are a fixed 24-month window — the range the data covers.">' + periodTxt + '</span>' +
             '<input class="tr-search" id="trSearch" type="text" placeholder="Search player" value="' + esc(_search) + '">' +
             '<span class="tr-loadslot">' + loadBlock + '</span>' +
           '</div>';
  }

  function tabsHtml() {
    var btns = '';
    Object.keys(COLUMN_SETS).forEach(function (id) {
      btns += '<button type="button" class="tr-tab' + (id === ACTIVE_SET ? ' active' : '') +
              '" data-set="' + id + '">' + esc(COLUMN_SETS[id].label) + '</button>';
    });
    return '<div class="tr-tabs" role="tablist">' + btns + '</div>';
  }

  function headerHtml(cfg) {
    // tip → the plain-English definition; win → the window the metric covers. Both
    // ride on data-* attributes so a body-level popover (setupTips) shows them on
    // hover/focus — native `title` was unreliable and clipped, so it never fired.
    function th(col, label, tip, win, sortable) {
      var ind;
      if (_sortCol === col) ind = '<span class="tr-sort tr-sort-on">' + (_sortDir === -1 ? '▾' : '▴') + '</span>';
      else ind = sortable === false ? '' : '<span class="tr-sort">⇅</span>';
      var tipAttrs = '';
      if (tip) {
        tipAttrs = ' data-tip="' + esc(tip) + '"' + (win ? ' data-win="' + esc(win) + '"' : '') +
                   ' tabindex="0" aria-label="' + esc(label + ': ' + tip + (win ? ' — Window: ' + win : '')) + '"';
      }
      return '<th class="tr-th' + (sortable === false ? ' tr-th-nosort' : '') + (tip ? ' tr-th-tip' : '') + '"' +
             (sortable === false ? '' : ' data-sort="' + col + '"') + tipAttrs + '>' +
             '<span class="tr-thlabel">' + esc(label) + '</span>' + ind + '</th>';
    }
    var oddsTip = 'Pre-match price for scheduled rows; the closing price (last quote before start) for rows in play. The book is named on each row; a missing price dashes — never carried forward.';
    var win = windowLabel();
    var cells = [
      th('time', 'Time'),
      th('player', 'Player'),
      th('odds', 'Odds', oddsTip),
      th('matches', 'Matches', 'Coverage count — matches carrying ≥1 tracked stat in the selected tier/surface. NOT the denominator behind any one percentage; each cell shows its own fraction.', win),
    ];
    cfg.metrics.forEach(function (mk) { cells.push(th(mk, METRIC_LABELS[mk], METRIC_TIPS[mk], win)); });
    // Trailing flex spacer: with a width:100% table the slack used to distribute
    // into the odds/metric columns, pushing the right-aligned ODDS value far from
    // the pinned player cell (the "large empty gap"). A greedy last column parks
    // all slack on the far right instead, so the data columns pack tight against
    // the player block. No data, not sortable, hidden from a11y tree.
    cells.push('<th class="tr-th tr-th-nosort tr-spacer" aria-hidden="true"></th>');
    return '<thead><tr>' + cells.join('') + '</tr></thead>';
  }

  function noticeHtml(rows) {
    if (_surfaceSel === 'all' || !_loaded) return '';
    var thin = 0, counted = 0;
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].key;
      if (!(key in _shards) || !_shards[key]) continue;
      var shard = _shards[key];
      var b = bucketFor(shard, tiersOf(shard).primary, surfaceKeyFor(rows[i]));
      counted++;
      if (!b || (b.m || 0) < matchMin()) thin++;
    }
    if (!counted) return '';
    if ((thin / counted) * 100 <= slateMutePct()) return '';
    return '<div class="tr-notice">Low sample on the ' + esc(cap(_surfaceSel)) + ' filter — most players fall under ' + matchMin() +
           ' matches. Percentages stay visible and muted, with their fractions.</div>';
  }

  function rowHtml(row, cfg) {
    var shard = _shards[row.key];
    var bucket = bucketFor(shard, tiersOf(shard).primary, surfaceKeyFor(row));
    var loaded = (row.key in _shards);
    var cells = '';
    cells += '<td class="tr-cell tr-time">' +
               (row.live ? '<span class="tr-livepip" title="In play">LIVE</span>' : '') +
               '<span class="tr-clock">' + esc(row.startClock || '—') + '</span></td>';
    cells += playerCell(row, shard);
    cells += oddsCell(row);
    if (!loaded) cells += '<td class="tr-cell tr-matches tr-pending">·</td>';
    else if (!bucket) cells += dash('tr-matches');
    else cells += '<td class="tr-cell tr-matches">' + (bucket.m || 0) + '</td>';
    cfg.metrics.forEach(function (mk) {
      if (!loaded) cells += '<td class="tr-cell tr-stat tr-pending">·</td>';
      else cells += statCell(bucket, mk);
    });
    cells += '<td class="tr-cell tr-spacer" aria-hidden="true"></td>';   // absorbs the width:100% slack (see headerHtml)
    return '<tr class="tr-row' + (row.live ? ' tr-row-live' : '') + '">' + cells + '</tr>';
  }

  function emptyStateHtml() {
    var msg = _view === 'live'
      ? 'No ATP singles in play right now'
      : (_dateTab === 'tomorrow' ? 'No ATP singles scheduled tomorrow yet' : 'No ATP singles scheduled today');
    var sub = _view === 'live'
      ? 'Switch to <strong>Today</strong> to see every scheduled match; rows flip to LIVE automatically as play starts.'
      : 'The slate fills from the daily schedule feed.';
    return '<div class="tr-empty"><div class="tr-empty-icon">◍</div>' +
           '<p class="tr-empty-title">' + msg + '</p><p class="tr-empty-sub">' + sub + '</p></div>';
  }

  function render() {
    if (!_bootstrapped) return;
    var g = grid();
    if (!g) return;

    // Preserve the search caret across a full innerHTML rebuild — the 30s poll
    // re-renders the grid, and a trader typing a filter must not lose focus.
    var focusSearch = false, selStart = 0, selEnd = 0;
    var ae = document.activeElement;
    if (ae && ae.id === 'trSearch') { focusSearch = true; selStart = ae.selectionStart; selEnd = ae.selectionEnd; }

    var rows = (_view === 'live') ? liveRows() : slateRows();
    var nLive = 0;
    for (var i = 0; i < rows.length; i += 2) if (rows[i].live) nLive++;
    renderStatus(rows.length / 2, nLive);

    function paint(markup) {
      hideTip();                 // the hovered <th> is about to be replaced
      g.innerHTML = markup;
      if (focusSearch) {
        var el = document.getElementById('trSearch');
        if (el) { el.focus(); try { el.setSelectionRange(selStart, selEnd); } catch (e) {} }
      }
    }

    var head = tabsHtml() + filterBarHtml(rows);
    if (!rows.length) { paint(head + emptyStateHtml()); return; }

    var view = rows.filter(function (r) {
      if (_tourFilter && r.tournamentKey !== _tourFilter) return false;
      if (_search && (r.name || '').toLowerCase().indexOf(_search.toLowerCase()) === -1) return false;
      return true;
    });
    view = applySort(view);

    var cfg = COLUMN_SETS[ACTIVE_SET];
    var html = head + noticeHtml(view);
    if (!view.length) {
      html += '<div class="tr-empty tr-empty-sm"><p class="tr-empty-title">No players match this filter</p>' +
              '<p class="tr-empty-sub">Clear the tournament filter or search to see the full slate.</p></div>';
    } else {
      html += '<div class="tr-tablewrap"><table class="tr-table">' + headerHtml(cfg) +
              '<tbody>' + view.map(function (r) { return rowHtml(r, cfg); }).join('') + '</tbody></table></div>';
    }
    paint(html);
  }

  // ─── progressive stat load ─────────────────────────────────────────────────────
  function ensureStatics() {
    var jobs = [];
    if (!_index) jobs.push(getJSON(INDEX_URL).then(function (j) { _index = j; }).catch(function (e) {
      console.warn('[trading-report] index load failed:', e.message); _index = _index || { meta: {} };
    }));
    // Photos are resolved via the profile pages' shared resolver (page globals), whose
    // player-photos.json + player-atp-aliases.json maps the dashboard already loads on
    // the matches critical path — no separate photo fetch here (one source, not two).
    return Promise.all(jobs);
  }

  function loadStats() {
    if (_loading) return;
    _loading = true;
    _loadSig = slateSig();      // remember which slate this load is for
    render();
    ensureStatics().then(function () {
      var keys = {};
      slateRows().forEach(function (r) { if (r.key) keys[r.key] = 1; });
      liveRows().forEach(function (r) { if (r.key) keys[r.key] = 1; });   // live matches may be slate-absent
      var toFetch = Object.keys(keys).filter(function (k) { return !(k in _shards); });
      _loadTotal = toFetch.length;
      _loadDone = 0;
      render();                                  // player/odds/flag cells already render; bar shows
      if (!toFetch.length) { _loading = false; _loaded = true; render(); return; }

      // bounded-concurrency streaming — populate the table as each shard lands
      var idx = 0, active = 0, done = 0, lastPaint = 0;
      return new Promise(function (resolve) {
        function pump() {
          while (active < SHARD_CONCURRENCY && idx < toFetch.length) {
            var k = toFetch[idx++];
            active++;
            (function (k) {
              getJSON(SHARD_BASE + k + '.json')
                .then(function (j) { _shards[k] = j; })
                .catch(function () { _shards[k] = null; })   // absent → dashed row, never guessed
                .then(function () {
                  active--; done++; _loadDone = done;
                  // repaint periodically (and on the final one) so the table fills
                  // live without thrashing on every single shard
                  if (done - lastPaint >= SHARD_CONCURRENCY || done === toFetch.length) { lastPaint = done; render(); }
                  if (done === toFetch.length) resolve(); else pump();
                });
            })(k);
          }
        }
        pump();
      });
    }).then(function () {
      _loaded = true; _loading = false;
      // The slate may have changed (date/view toggled) while this load ran — its
      // rows would otherwise sit on pending dots forever. Re-load for the current
      // slate; only its not-yet-fetched shards are requested (cached ones are free).
      if (slateSig() !== _loadSig) loadStats(); else render();
    }).catch(function (e) {
      console.warn('[trading-report] load failed:', e.message);
      _loading = false;
      if (slateSig() !== _loadSig) loadStats(); else render();
    });
  }

  // ─── slate acquisition (matches.json) ──────────────────────────────────────────
  // Reuse the dashboard's already-parsed slate when present (avoids a second fetch
  // of the multi-MB matches.json). Falls back to a direct fetch if absent.
  function globalMatches() {
    try {
      if (typeof matches !== 'undefined' && Array.isArray(matches) && matches.length) return matches;  // eslint-disable-line no-undef
    } catch (e) { /* `matches` not in scope */ }
    return null;
  }
  function ensureMatches() {
    if (Array.isArray(_matches)) return Promise.resolve();
    var g = globalMatches();
    if (g) { _matches = g; _matchesAt = Date.now(); return Promise.resolve(); }
    return getJSON(MATCHES_URL).then(function (j) {
      _matches = Array.isArray(j) ? j : (j && Array.isArray(j.matches) ? j.matches : []);
      _matchesAt = Date.now();
    }).catch(function (e) {
      console.warn('[trading-report] matches load failed:', e.message); _matches = [];
    });
  }
  // Keep the slate fresh so a match that starts mid-session gains its closingOdds
  // (the pre→close transition). Re-point to the dashboard global every tick (free);
  // otherwise re-fetch matches.json at most every MATCHES_REFRESH_MS.
  function refreshMatches() {
    var g = globalMatches();
    if (g) { if (g !== _matches) { _matches = g; _matchesDirty = true; } return Promise.resolve(); }
    if (Date.now() - _matchesAt < MATCHES_REFRESH_MS) return Promise.resolve();
    return getJSON(MATCHES_URL).then(function (j) {
      _matches = Array.isArray(j) ? j : (j && Array.isArray(j.matches) ? j.matches : _matches);
      _matchesAt = Date.now(); _matchesDirty = true;
    }).catch(function () { /* keep the prior slate; a fetch blip must not blank the board */ });
  }

  // ─── snapshot polling (underway set + slate refresh) ────────────────────────────
  function tick() {
    if (_ticking) return;
    _ticking = true;
    Promise.all([
      fetchUnderway().then(function (snap) {
        if (snap) {
          _underway = snap.set;
          _liveFixtures = snap.fixtures;
          _updatedAt = snap.updated_at ? Date.parse(snap.updated_at) : Date.now();
        }
      }).catch(function (err) { console.warn('[trading-report] snapshot fetch failed:', err.message); }),
      refreshMatches(),
    ]).then(function () {
      _ticking = false;
      // Repaint only when something actually changed (a match went in/out of play,
      // or the slate refreshed) or while stale — so an idle board doesn't rebuild
      // every 30s and steal the search caret.
      var sig = _underway ? Object.keys(_underway).sort().join(',') : '∅';
      if (sig !== _lastUnderwaySig || _matchesDirty || staleness().isStale) {
        _lastUnderwaySig = sig; _matchesDirty = false; render();
      }
      // A slate refresh — or a live match not in the slate — can surface new keys;
      // stream their shards. Check both the slate and the live snapshot rows so a
      // just-started, slate-absent match still gets its situational splits.
      if (!_loading && _loaded) {
        var need = false;
        slateRows().forEach(function (r) { if (r.key && !(r.key in _shards)) need = true; });
        liveRows().forEach(function (r) { if (r.key && !(r.key in _shards)) need = true; });
        if (need) loadStats();
      }
      if (_active && !document.hidden) _timer = setTimeout(tick, POLL_INTERVAL_MS);
    });
  }
  function startPolling() { clearTimeout(_timer); tick(); }

  // ─── bootstrap + control surface ───────────────────────────────────────────────
  function onSlateChange() {
    // a view/date change swaps the visible slate; auto-stream any not-yet-loaded
    // shards so the table populates without a manual press (founder loading spec).
    render();
    if (!_loading) loadStats();
  }

  // ─── column tooltips ────────────────────────────────────────────────────────
  // A single popover parented to <body> (position:fixed) so the table's
  // overflow-x:auto never clips it — the reason native `title`/CSS tips failed.
  var _tipEl = null;
  function tipNode() {
    if (_tipEl) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.className = 'tr-tip';
    _tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(_tipEl);
    return _tipEl;
  }
  function hideTip() { if (_tipEl) _tipEl.classList.remove('show'); }
  function showTip(target) {
    var def = target.getAttribute('data-tip');
    if (!def) return;
    var win = target.getAttribute('data-win');
    var el = tipNode();
    el.innerHTML = esc(def) + (win ? '<span class="tr-tip-win">Window: ' + esc(win) + '</span>' : '');
    el.classList.add('show');
    var r = target.getBoundingClientRect();
    var tw = el.offsetWidth, th2 = el.offsetHeight;
    var left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - tw - 8));
    var top = r.bottom + 8;
    if (top + th2 > window.innerHeight - 8) top = r.top - th2 - 8;   // flip above near the bottom edge
    el.style.left = left + 'px';
    el.style.top = Math.max(8, top) + 'px';
  }
  function setupTips(g) {
    g.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('.tr-th-tip'); if (t) showTip(t);
    });
    g.addEventListener('mouseout', function (e) {
      var t = e.target.closest && e.target.closest('.tr-th-tip'); if (!t) return;
      if (e.relatedTarget && t.contains(e.relatedTarget)) return;   // moving within the same header (label ↔ sort arrow) — keep the tip, no flicker
      hideTip();
    });
    g.addEventListener('focusin', function (e) {
      var t = e.target.closest && e.target.closest('.tr-th-tip'); if (t) showTip(t);
    });
    g.addEventListener('focusout', hideTip);
    window.addEventListener('scroll', hideTip, true);
  }

  function bootstrap() {
    if (_bootstrapped) return;
    var g = grid();
    if (!g) return;
    _bootstrapped = true;

    g.addEventListener('click', function (e) {
      var t = e.target;
      var seg = t.closest && t.closest('.tr-segbtn');
      if (seg) {
        if (seg.hasAttribute('data-view')) {
          var v = seg.getAttribute('data-view');
          if (v !== _view) { _view = v; onSlateChange(); }
        } else if (seg.hasAttribute('data-date')) {
          var d = seg.getAttribute('data-date');
          if (d !== _dateTab) { _dateTab = d; onSlateChange(); }
        }
        return;
      }
      var tabBtn = t.closest && t.closest('.tr-tab');
      if (tabBtn) {
        var setId = tabBtn.getAttribute('data-set');
        if (COLUMN_SETS[setId] && setId !== ACTIVE_SET) { ACTIVE_SET = setId; _sortCol = null; render(); }
        return;
      }
      var load = t.closest && t.closest('#trLoadBtn');
      if (load) { loadStats(); return; }
      var th = t.closest && t.closest('.tr-th');
      if (th && th.getAttribute('data-sort')) {
        var col = th.getAttribute('data-sort');
        if (_sortCol === col) _sortDir = -_sortDir; else { _sortCol = col; _sortDir = -1; }
        render();
      }
    });
    g.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'trTournSel') { _tourFilter = e.target.value; render(); return; }
      if (e.target && e.target.id === 'trSurfSel')  { _surfaceSel = e.target.value; render(); return; }
    });
    // Sort headers are now keyboard-focusable (tabindex, for the tooltip); make them
    // operable too — Enter/Space sorts, matching the click path.
    g.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var th = e.target.closest && e.target.closest('.tr-th[data-sort]');
      if (!th) return;
      e.preventDefault();
      var col = th.getAttribute('data-sort');
      if (_sortCol === col) _sortDir = -_sortDir; else { _sortCol = col; _sortDir = -1; }
      render();
    });
    setupTips(g);
    g.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'trSearch') { _search = e.target.value; render(); }
    });
  }

  function activate() {
    bootstrap();
    ensureMatches().then(function () {
      render();
      startPolling();     // primes the underway set, then re-arms every 30s
      loadStats();        // stream splits in with a progress bar
    });
  }

  function setActive(isActive) {
    if (isActive && !_active) { _active = true; activate(); }
    else if (!isActive && _active) { _active = false; clearTimeout(_timer); }
  }

  document.addEventListener('visibilitychange', function () {
    if (!_active) return;
    if (document.hidden) clearTimeout(_timer);
    else startPolling();
  });

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
