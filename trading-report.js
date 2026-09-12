// TEN-192 · Trading Report — rebuilt to design_handoff_trading_report, wired to
// the shipped TEN-151 splits layer.
//
// The export (Trading Report.dc.html + README.md) is the authority on every
// measurable value: colours, type, grid tracks, spacing, radii, states. Where the
// previous build and the export disagreed, the export won. What the export could
// NOT decide — it ships synthetic data — went to the founder as a six-question
// gate (interaction 356eb544, answered 2026-09-12). Those six rulings:
//
//   1. TIER COLOUR  → the EXPORT's rule. A cell is coloured against the FIELD
//      AVERAGE of tonight's visible pool, ±3 percentage points. This REPLACES the
//      shipped p25/p75 tour-percentile cuts, so index.cuts / index.cuts12 are no
//      longer read by this page (the generator still publishes them).
//   2. WINDOW       → 52 weeks (364 days), a real independent query with its own
//      denominators. build-trading-splits.js cuts the inner window at 364 days and
//      publishes it as tiers52w / window52w / cuts52w. NEVER derived from the 24m.
//   3. DEFINITIONS  → the SHIPPED definitions stand; the README is the thing that
//      is wrong. Four of its glosses disagreed with this data layer and two of its
//      tooltip texts are copy-paste duplicates of their neighbours (its BOFS text
//      repeats its BFSG text; its BABB text repeats its BBK text). Concretely:
//        · the README reads L1·FB as "lost set 1, broke first" and L1·BF as "lost
//          set 1, broken first". In this data layer `ls1fb` is Lost set 1 →
//          FightBack to WIN THE MATCH and `ls1bf` is Lost set 1 → Broke First in
//          set 2. Same two column positions, same two codes, correct glosses.
//        · the README reads BOFS as "broken on first serve" (identical text to its
//          BFSG row). Here `bofs` is Broke Opponent's First Service game — the
//          mirror of `bfsg`, not a duplicate of it.
//      METRIC_TIPS below is therefore the shipped text, unchanged.
//   4. LOW-SAMPLE NOTICE → DROPPED. The export's per-cell ladder is the only
//      sample gate on this page now. index.lowSample.slateMutePct is unread.
//   5. FIELD-AVERAGE POOL → the slate after Pre-match/Live, Today/Tomorrow,
//      Surface AND Tournament; BEFORE the search box and BEFORE any column tier
//      filter. So typing a name never moves the bar, but picking a tournament does.
//   6. AVATARS      → the shipped resolver chain stays (ATP alias → Wikimedia →
//      api-tennis logo → monogram initials), not the export's bare #0f1420 circle.
//
// SURFACE, and why it changed. The export's rule 3 is non-negotiable: "splits use
// the surface of each player's own match, including under All surfaces. Never blend
// surfaces into one figure." The previous build used the surface dropdown to pick
// which SHARD BUCKET to read, so "All surfaces" served the blended `all` bucket.
// That is exactly the blend the brief forbids. Here the dropdown is a ROW FILTER
// and every figure is read from the bucket for that player's own match surface. A
// row whose match surface is unknown, or whose shard has no bucket for it, DASHES —
// it never falls back to the blended bucket.
//
// SOURCES are unchanged from TEN-151 and stay read-only:
//   • slate       ← matches.json (the daily ATP-singles slate; row unit is a
//                    PLAYER, two rows per match)
//   • live state  ← the SAME Supabase live_snapshot.board the Live tab reads,
//                    filtered by the SAME exported predicate (LiveTab.isAtpSingles
//                    + LiveTab.isUnderway). One live gate, not two.
//   • splits      ← trading-splits-index.json + trading-splits/{player_key}.json
//   • rank/country← the index `meta` map
//   • photos      ← the dashboard's shared photoCandidatesFor()
//
// Odds standing rule (founder, unchanged): a live row shows the CLOSING price, a
// scheduled row the PRE-MATCH price, the book is named, and a missing price DASHES
// — never carried forward, never silently substituted from another book.
//
// Guard: window.FEATURE_TRADING_REPORT must be truthy.

(function () {
  'use strict';

  if (!window.FEATURE_TRADING_REPORT) return;

  var LT = window.LiveTab;
  var HAS_GATE = LT && typeof LT.isUnderway === 'function' && typeof LT.isAtpSingles === 'function';
  if (!HAS_GATE) console.warn('[trading-report] window.LiveTab gate unavailable — Live view falls back to the feed live flag');

  var SB_URL = (window.SUPABASE_URL || '').replace(/\/$/, '');
  var SB_KEY = window.SUPABASE_ANON_KEY || '';
  var HAS_SB = SB_URL && SB_URL.indexOf('__') !== 0 && SB_KEY && SB_KEY.indexOf('__') !== 0;
  if (!HAS_SB) console.warn('[trading-report] SUPABASE creds not configured — Live view falls back to the feed live flag');

  // ─── config ─────────────────────────────────────────────────────────────────
  var POLL_INTERVAL_MS   = 30000;
  var STALE_THRESHOLD_MS = 60000;
  var SNAPSHOT_ENDPOINT  = SB_URL + '/rest/v1/live_snapshot?select=board,updated_at&limit=1';
  var INDEX_URL          = './trading-splits-index.json';
  var SHARD_BASE         = './trading-splits/';
  var MATCHES_URL        = './matches.json';
  var SHARD_CONCURRENCY  = 6;

  // Export design tokens (README §"Design tokens"). Named once, used everywhere.
  var GREEN = '#3dd68c', AMBER = '#e8a84e', RED = '#e0616f', DIM = '#5b6880', DASH = '#4b5672';
  var TIER_COLOR = { above: GREEN, within: AMBER, below: RED };
  var SURF_COLOR = { hard: '#4db8ff', clay: '#e8a84e', grass: '#2ab8a0' };
  var SURF_LABEL = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };
  var MIN_TIER_DEN = 10;   // a cell is untiered below this denominator (README §"Cell display rules")
  var TIER_PTS     = 3;    // ±3 percentage points around the field average

  // Column codes as the export prints them. The three LOST SET 1 metrics carry the
  // export's short forms; every other code is already its own label.
  var METRIC_LABELS = {
    sh: 'SH', spw: 'SPW', rpw: 'RPW', bps: 'BPS', bpw: 'BPW', oph: 'OPH',
    htws: 'HTWS', htss: 'HTSS', bofs: 'BOFS', bfsg: 'BFSG',
    babb: 'BABB', bbk: 'BBK', bbkb: 'BBKB', gfb: 'GFB',
    ls1fb: 'L1 · FB', ls1bf: 'L1 · BF', bfs2aws1: 'BFS2AWS1',
    wfs: 'WFS', ws2: 'WS2', ws1w2: 'WS1W2', ls1ws2: 'L1 · WS2', ws1wm: 'WS1WM',
  };
  // Shipped definitions — founder ruling 3 above. Do not replace these with the
  // README's glosses; four of them are wrong about this data layer.
  var METRIC_TIPS = {
    sh:  'Service games held — won / service games played',
    spw: 'Serve points won',
    rpw: 'Return points won',
    bps: 'Break points saved',
    bpw: 'Break points converted',
    oph: 'Opponent hold — service games held by this player’s opponents (return-strength context). Lower is better, so the colouring is inverted here.',
    htws: 'Held To Win Set — serving for the set, held to take it (per service game where a hold clinches the set)',
    htss: 'Held To Stay in Set — serving to avoid losing the set, held (per service game where a loss would lose the set)',
    bofs: 'Broke Opponent’s First Service game of the match',
    bfsg: 'Broken in own First Service Game of the match. Lower is better, so the colouring is inverted here.',
    babb: 'Broke then Broken Back in the same set — how often a break lead was surrendered within that set. Lower is better, so the colouring is inverted here.',
    bbk:  'Broken Back immediately — opponent breaks straight back in the very next service game. Lower is better, so the colouring is inverted here.',
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
    METRIC_TIPS[k] += ' — the denominator counts only matches with the relevant set decided, so it can be lower than n.';
  });
  var PBP_METRIC_KEYS = ['htws', 'htss', 'bofs', 'bfsg', 'gfb', 'babb', 'bbk', 'bbkb', 'ls1bf', 'bfs2aws1'];

  // Tab → columns. Identical to the export's tab→column map (README §"Tab →
  // columns"), position for position, so a metric in slot 3 sits at the same x on
  // every tab. Tabs define 5–7 metrics; the grid always has 7 slots and the unused
  // ones stay empty.
  var COLUMN_SETS = {
    key:          { label: 'Key Stats',           metrics: ['sh', 'spw', 'rpw', 'bps', 'bpw', 'oph'] },
    laysetwinner: { label: 'Lay Set Winner',      metrics: ['ls1ws2', 'ws1w2', 'ls1fb', 'ls1bf', 'bpw', 'ws1wm', 'bfs2aws1'] },
    scalping:     { label: 'Scalping',            metrics: ['sh', 'spw', 'bps', 'htws', 'htss'] },
    laybreakup:   { label: 'Lay Break Up',        metrics: ['babb', 'bbk', 'bbkb', 'gfb', 'bfsg'] },
    settrading20: { label: 'Set Trading 2-0',     metrics: ['ws1w2', 'wfs', 'ws2', 'ls1ws2', 'gfb'] },
    layserve:     { label: 'Lay Serve Set/Match', metrics: ['htws', 'bofs', 'htss', 'bps', 'bpw'] },
    laysetbreak:  { label: 'Lay Set&Break',       metrics: ['ls1bf', 'ls1ws2', 'babb', 'ws1w2', 'bbk', 'bbkb'] },
  };
  var TAB_ORDER = ['key', 'laysetwinner', 'scalping', 'laybreakup', 'settrading20', 'layserve', 'laysetbreak'];

  // Highlighted ("signature") columns per tab — the export's HIGHLIGHT map.
  var HIGHLIGHT = {
    key:          [],
    laysetwinner: ['ls1ws2', 'ws1w2'],
    scalping:     ['bps', 'htws', 'htss'],
    laybreakup:   ['babb', 'bbk'],
    settrading20: ['ws1w2'],
    layserve:     ['htws', 'bofs'],
    laysetbreak:  ['ls1bf', 'ls1ws2', 'babb', 'ws1w2'],
  };

  // Metrics where LOWER is better, so the ±3pt colouring flips. This follows the
  // SHIPPED definitions (ruling 3) and matches the founder-confirmed direction list
  // from TEN-151: oph, bfsg, babb, bbk. The export additionally marks its L1·BF as
  // inverted — but its L1·BF means "was broken first", whereas `ls1bf` here means
  // "BROKE first", which is a strength. Same column, opposite sign, and the sign
  // follows the definition that actually generated the number.
  var INVERTED = { oph: 1, bfsg: 1, babb: 1, bbk: 1 };
  function isInv(mk) { return !!INVERTED[mk]; }

  // Country full name → IOC 3-letter code, for the export's mono country line.
  // Covers every country present in the index `meta` plus the wider tennis set. An
  // unmapped country renders the em dash rather than a wrong code (never guess).
  var NAME2IOC = {
    'Argentina':'ARG','Australia':'AUS','Austria':'AUT','Belarus':'BLR','Belgium':'BEL',
    'Bolivia':'BOL','Bosnia and Herzegovina':'BIH','Brazil':'BRA','Bulgaria':'BUL',
    'Canada':'CAN','Chile':'CHI','China':'CHN','Chinese Taipei':'TPE','Colombia':'COL',
    'Croatia':'CRO','Cyprus':'CYP','Czechia':'CZE','Czech Republic':'CZE','Denmark':'DEN',
    'Dominican Republic':'DOM','Ecuador':'ECU','Egypt':'EGY','Estonia':'EST','Finland':'FIN',
    'France':'FRA','Georgia':'GEO','Germany':'GER','Great Britain':'GBR','United Kingdom':'GBR',
    'Greece':'GRE','Hong Kong':'HKG','Hungary':'HUN','Iceland':'ISL','India':'IND','Indonesia':'INA',
    'Iran':'IRI','Ireland':'IRL','Israel':'ISR','Italy':'ITA','Japan':'JPN','Jordan':'JOR',
    'Kazakhstan':'KAZ','Korea':'KOR','South Korea':'KOR','Kosovo':'KOS','Kuwait':'KUW',
    'Latvia':'LAT','Lebanon':'LBN','Lithuania':'LTU','Luxembourg':'LUX','Mexico':'MEX',
    'Moldova':'MDA','Monaco':'MON','Montenegro':'MNE','Morocco':'MAR','Netherlands':'NED',
    'New Zealand':'NZL','North Macedonia':'MKD','Norway':'NOR','Paraguay':'PAR','Peru':'PER',
    'Philippines':'PHI','Poland':'POL','Portugal':'POR','Qatar':'QAT','Romania':'ROU',
    'Russia':'RUS','Saudi Arabia':'KSA','Serbia':'SRB','Slovakia':'SVK','Slovenia':'SLO',
    'South Africa':'RSA','Spain':'ESP','Sweden':'SWE','Switzerland':'SUI','Taiwan':'TPE',
    'Thailand':'THA','Tunisia':'TUN','Turkey':'TUR','Türkiye':'TUR','Ukraine':'UKR',
    'United States':'USA','USA':'USA','Uruguay':'URU','Uzbekistan':'UZB','Venezuela':'VEN',
    'Zimbabwe':'ZIM',
  };
  function iocOf(country) { return (country && NAME2IOC[country]) || null; }

  // ─── state (README §"State") ────────────────────────────────────────────────
  var _active = false, _timer = null, _ticking = false;
  var _underway = null, _liveFixtures = null, _updatedAt = null;
  var _matches = null, _index = null, _shards = {};
  var _loaded = false, _loading = false, _loadSig = null;
  var _bootstrapped = false, _matchesAt = 0, _matchesDirty = false, _lastUnderwaySig = null;

  var S = {
    tab: 'key',
    live: 'today',        // 'today' (pre-match slate) | 'live' (in-play slate)
    day: 'today',         // 'today' | 'tomorrow'
    surf: 'all',          // 'all' | 'hard' | 'clay' | 'grass' — a ROW FILTER, not a bucket picker
    tour: '',             // '' = all tournaments
    win: '24m',           // '24m' | '52w'
    q: '',
    sort: 'time',         // 'time' | 'matches' | metric code
    dir: -1,              // -1 = best first, +1 = worst first
    filters: {},          // { [tab]: { [code]: hiddenTiers[] } }
    surfOpen: false, tourOpen: false, menu: null,
  };

  function slateSig() { return S.live + '|' + S.day; }
  var MATCHES_REFRESH_MS = 150000;

  // ─── DOM / util ─────────────────────────────────────────────────────────────
  function grid() { return document.getElementById('tradingGrid'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pairKey(a, b) {
    var x = Number(a), y = Number(b);
    return (x <= y ? x + ':' + y : y + ':' + x);
  }
  function fmtOdds(v) { var n = Number(v); return isFinite(n) ? n.toFixed(2) : String(v); }
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
  // "Jannik Sinner" → "J. Sinner", for the sorted view's "v {opponent}".
  function shortName(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return w.length > 1 ? w[0][0] + '. ' + w.slice(1).join(' ') : (w[0] || '');
  }
  function getJSON(url, opts) {
    return fetch(url, opts || { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // ─── live snapshot → underway pair-key set (the ONE gate, reused) ───────────
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
      var fixtures = b.filter(LT.isAtpSingles).filter(LT.isUnderway);
      var set = {};
      fixtures.forEach(function (f) { set[pairKey(f.first_player_key, f.second_player_key)] = 1; });
      return { set: set, fixtures: fixtures, updated_at: row.updated_at };
    });
  }

  // ─── slate rows from matches.json ───────────────────────────────────────────
  function isMatchLive(m) {
    if (_underway) return !!_underway[pairKey(m.p1Key, m.p2Key)];
    return !!m.live;
  }

  function oddsFor(m, which, live) {
    var src = live ? m.closingOdds : m.odds;
    if (!src) return null;
    var price = which === 1 ? src.p1 : src.p2;
    if (price == null || !(Number(price) > 0)) return null;
    return { price: price, book: src.bookmaker || '', at: src.at || null, kind: live ? 'close' : 'pre' };
  }

  // Event name for the row's second line: "ATP US Open · Quarter-finals" when the
  // feed carries a round, else the tournament label alone. api-tennis repeats the
  // tournament name INSIDE the round string ("ATP US Open - Quarter-finals"), so
  // strip the prefix rather than print the tournament twice.
  function eventName(m) {
    var t = String(m.tour || '').trim();
    var r = m.tournamentRound;
    r = (r == null ? '' : String(r)).trim();
    if (t && r.toLowerCase().indexOf(t.toLowerCase()) === 0) {
      r = r.slice(t.length).replace(/^\s*[-–—·:]\s*/, '').trim();
    }
    return (t && r) ? (t + ' · ' + r) : (t || r || '');
  }

  function playerRow(m, which, live) {
    var isFirst = which === 1;
    var key = String((isFirst ? m.p1Key : m.p2Key) || '');
    var meta = (_index && _index.meta && _index.meta[key]) || null;
    var rank = isFirst ? m.p1Rank : m.p2Rank;
    if (rank == null && meta && meta.rank != null) rank = meta.rank;
    return {
      id: String(m.id || ''),
      matchId: String(m.id || pairKey(m.p1Key, m.p2Key)),
      which: which,
      key: key,
      name: (isFirst ? m.p1 : m.p2) || (meta && meta.name) || '—',
      oppName: (isFirst ? m.p2 : m.p1) || '',
      photoName: (meta && meta.name) || null,
      rank: (rank == null ? null : rank),
      country: (meta && meta.country) || null,
      tour: m.tour || '',
      tournamentKey: m.tour || '',
      event: eventName(m),
      surface: String(m.surface || '').toLowerCase(),
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
      if (!m || m.day !== S.day) continue;
      if (!m.p1Key || !m.p2Key) continue;
      var live = isMatchLive(m);
      if (S.live === 'live' && !live) continue;
      out.push(playerRow(m, 1, live));
      out.push(playerRow(m, 2, live));
    }
    return out;
  }

  function slateMatchByKeys(a, b) {
    var arr = Array.isArray(_matches) ? _matches : [];
    var want = pairKey(a, b);
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (m && m.p1Key && m.p2Key && pairKey(m.p1Key, m.p2Key) === want) return m;
    }
    return null;
  }

  function liveFixtureRow(f, which) {
    var isFirst = which === 1;
    var key = String((isFirst ? f.first_player_key : f.second_player_key) || '');
    var meta = (_index && _index.meta && _index.meta[key]) || null;
    var abbr = isFirst ? f.event_first_player : f.event_second_player;
    var oppAbbr = isFirst ? f.event_second_player : f.event_first_player;
    var slate = slateMatchByKeys(f.first_player_key, f.second_player_key);
    var odds = null;
    if (slate) {
      var which2 = (String(slate.p1Key) === key) ? 1 : 2;
      odds = oddsFor(slate, which2, true);
    }
    var surf = slate ? String(slate.surface || '').toLowerCase() : '';
    return {
      id: String(f.event_key || ''),
      matchId: String(f.event_key || pairKey(f.first_player_key, f.second_player_key)),
      which: which,
      key: key,
      name: (meta && meta.name) || abbr || '—',
      oppName: oppAbbr || '',
      photoName: (meta && meta.name) || null,
      rank: (meta && meta.rank != null) ? meta.rank : null,
      country: (meta && meta.country) || null,
      tour: f.tournament_name || '',
      tournamentKey: f.tournament_name || '',
      event: f.tournament_name || '',
      surface: surf,
      startClock: f.event_time || '',
      startSort: (f.event_date || '') + ' ' + (f.event_time || ''),
      live: true,
      odds: odds,
    };
  }

  function liveRows() {
    if (!Array.isArray(_liveFixtures)) return slateRows();
    var out = [];
    for (var i = 0; i < _liveFixtures.length; i++) {
      var f = _liveFixtures[i];
      if (!f || !f.first_player_key || !f.second_player_key) continue;
      out.push(liveFixtureRow(f, 1));
      out.push(liveFixtureRow(f, 2));
    }
    return out;
  }

  // ─── shard reads ────────────────────────────────────────────────────────────
  // The active window sub-tree. `tiers` = 24 months, `tiers52w` = the independent
  // 52-week (364-day) bucket the generator computes as its OWN query. When 52w is
  // selected and a shard carries no tiers52w, this returns null → the row dashes;
  // it is NEVER back-filled from the 24m tree.
  function activeTree(shard) {
    if (!shard) return null;
    return S.win === '52w' ? (shard.tiers52w || null) : (shard.tiers || null);
  }
  // Which tier (tour / chal) this player predominantly plays, judged on the
  // window's blended match count. Used for the TOUR/CHAL tags and to choose which
  // tier's surface bucket to read.
  function tiersOf(shard) {
    var t = activeTree(shard);
    if (!t) return { primary: null, secondary: null };
    var tourM = (t.tour && t.tour.all && t.tour.all.m) || 0;
    var chalM = (t.chal && t.chal.all && t.chal.all.m) || 0;
    if (!tourM && !chalM) return { primary: null, secondary: null };
    if (tourM >= chalM) return { primary: 'tour', secondary: chalM ? 'chal' : null };
    return { primary: 'chal', secondary: tourM ? 'tour' : null };
  }
  // Export rule 3: the bucket is always the surface of THIS player's own match —
  // including under "All surfaces". Never the blended `all` bucket.
  function bucketFor(row) {
    var shard = _shards[row.key];
    var t = activeTree(shard);
    var tierKey = tiersOf(shard).primary;
    if (!t || !tierKey || !t[tierKey]) return null;
    var surf = row.surface;
    if (surf !== 'hard' && surf !== 'clay' && surf !== 'grass') return null;
    return t[tierKey][surf] || null;
  }
  function cellOf(row, mk) {
    var b = bucketFor(row);
    if (!b) return null;
    var v = b[mk];
    return (v && v.length === 2) ? v : null;
  }
  function nOf(row) {
    var b = bucketFor(row);
    return b ? (b.m || 0) : null;
  }
  function windowMeta() {
    var g = _index && _index.generated;
    if (!g) return null;
    return S.win === '52w' ? (g.window52w || null) : (g.window || null);
  }

  // ─── the view model (mirrors the export's renderVals) ───────────────────────
  // pool  = the slate after Pre-match/Live, Today/Tomorrow, Surface and Tournament.
  //         This is the field-average population and the filter-menu tier counts
  //         (founder ruling 5). Search and column tier filters are NOT applied.
  // list  = pool, then search, then the active column tier filters. This is what
  //         actually renders.
  function computeView() {
    var rows = (S.live === 'live') ? liveRows() : slateRows();

    var surfaces = [];
    rows.forEach(function (r) {
      if (r.surface && surfaces.indexOf(r.surface) === -1) surfaces.push(r.surface);
    });
    // Fall back to All surfaces when the selection isn't present in this slate.
    var surfSel = (S.surf === 'all' || surfaces.indexOf(S.surf) !== -1) ? S.surf : 'all';

    var tours = [];
    rows.forEach(function (r) {
      if (r.tournamentKey && tours.indexOf(r.tournamentKey) === -1) tours.push(r.tournamentKey);
    });
    var tourSel = (!S.tour || tours.indexOf(S.tour) !== -1) ? S.tour : '';

    var pool = rows.filter(function (r) {
      if (surfSel !== 'all' && r.surface !== surfSel) return false;
      if (tourSel && r.tournamentKey !== tourSel) return false;
      return true;
    });

    var codes = (COLUMN_SETS[S.tab] || COLUMN_SETS.key).metrics;

    // Field average: a POOLED ratio — sum the numerators and sum the denominators
    // across the pool, then divide. Not a mean of per-player rates (the export does
    // the same, and a pooled ratio is the honest "field" figure). A cell the pool
    // doesn't carry contributes nothing to either side.
    var fieldAvg = {};
    codes.forEach(function (mk) {
      var won = 0, tot = 0;
      pool.forEach(function (r) {
        var c = cellOf(r, mk);
        if (c) { won += c[0]; tot += c[1]; }
      });
      fieldAvg[mk] = tot ? (won / tot) : null;
    });

    // Tier of one cell for one player: null when the cell is absent or its
    // denominator is under 10 (untiered — and an untiered cell never passes an
    // active filter on that column).
    function tierOf(row, mk) {
      var c = cellOf(row, mk);
      if (!c || c[1] < MIN_TIER_DEN) return null;
      var fa = fieldAvg[mk];
      if (fa == null) return null;
      var d = (c[0] / c[1] - fa) * 100;
      if (isInv(mk)) d = -d;
      return d >= TIER_PTS ? 'above' : (d <= -TIER_PTS ? 'below' : 'within');
    }

    var tabFilters = S.filters[S.tab] || {};
    var filterActive = Object.keys(tabFilters).length > 0;

    var q = (S.q || '').trim().toLowerCase();
    var list = pool.filter(function (r) {
      return !q || (r.name || '').toLowerCase().indexOf(q) !== -1;
    });
    if (filterActive) {
      list = list.filter(function (r) {
        return Object.keys(tabFilters).every(function (mk) {
          var t = tierOf(r, mk);
          return t !== null && tabFilters[mk].indexOf(t) === -1;
        });
      });
    }

    var isSorted = (S.sort === 'matches') || (codes.indexOf(S.sort) !== -1);
    if (isSorted) {
      var key = S.sort, dir = S.dir;
      var flip = (key !== 'matches' && isInv(key)) ? -1 : 1;
      // A row with no figure sorts LAST in BOTH directions. The export instead
      // gives it a rate of -1, which parks it at the bottom on a normal metric but
      // floats it to the TOP on an inverted one (flip = -1) — a prototype bug, not
      // a design decision. Reported, not silently inherited.
      list = list.slice().sort(function (a, b) {
        var va = (key === 'matches') ? nOf(a) : rateOf(a, key);
        var vb = (key === 'matches') ? nOf(b) : rateOf(b, key);
        var ma = (va == null), mb = (vb == null);
        if (ma && mb) return 0;
        if (ma) return 1;
        if (mb) return -1;
        if (va === vb) return 0;
        return (va < vb ? -1 : 1) * dir * (key === 'matches' ? 1 : flip);
      });
    }
    function rateOf(row, mk) {
      var c = cellOf(row, mk);
      return (c && c[1] > 0) ? (c[0] / c[1]) : null;
    }

    return {
      rows: rows, pool: pool, list: list, codes: codes,
      fieldAvg: fieldAvg, tierOf: tierOf,
      surfaces: surfaces, surfSel: surfSel, tours: tours, tourSel: tourSel,
      tabFilters: tabFilters, filterActive: filterActive, isSorted: isSorted,
    };
  }

  // ─── cell rendering (README §"Cell display rules" — non-negotiable) ──────────
  // null / total === 0 → em dash, 15px, #4b5672, no sub-line
  // total < 5          → won/total at 12px in #5b6880, no sub-line
  // total < 10         → percent at 12px in #5b6880, sub-line "won/total · small n"
  // total >= 10        → percent at 15px/700 in the tier colour, sub-line won/total
  // A real zero is a real value and renders as a figure; only ABSENT data dashes.
  function cellHtml(row, mk, V, band) {
    var cls = 'tr-cell' + (band ? ' tr-bandb' : '');
    var loaded = (row.key in _shards);
    if (!loaded) {
      // Not an export state: the real build streams 189 shards, the prototype had
      // every figure inline. A cell whose shard has not landed yet shows a mid dot,
      // never a dash — a dash means "we looked and there is nothing".
      return '<span class="' + cls + '"><span class="tr-pct" style="color:' + DASH + '">·</span></span>';
    }
    var c = cellOf(row, mk);
    if (!c || !(c[1] > 0)) {
      return '<span class="' + cls + '"><span class="tr-pct" style="color:' + DASH + '">—</span></span>';
    }
    var won = c[0], tot = c[1];
    if (tot < 5) {
      return '<span class="' + cls + '"><span class="tr-pct sm" style="color:' + DIM + '">' + won + '/' + tot + '</span></span>';
    }
    var pct = Math.round((won / tot) * 100);
    if (tot < MIN_TIER_DEN) {
      return '<span class="' + cls + '">' +
               '<span class="tr-pct sm" style="color:' + DIM + '">' + pct + '%</span>' +
               '<span class="tr-sub" style="color:' + DASH + '">' + won + '/' + tot + ' · small n</span>' +
             '</span>';
    }
    // Tier colour, and the player's-own-n dim override: below 10 matches in the
    // window the figure is muted regardless of which side of the field it sits.
    var color;
    var n = nOf(row);
    if (n != null && n < MIN_TIER_DEN) {
      color = DIM;
    } else {
      var t = V.tierOf(row, mk);
      color = t ? TIER_COLOR[t] : DIM;
    }
    return '<span class="' + cls + '">' +
             '<span class="tr-pct" style="color:' + color + '">' + pct + '%</span>' +
             '<span class="tr-sub" style="color:' + DIM + '">' + won + '/' + tot + '</span>' +
           '</span>';
  }

  // ─── player identity cell ───────────────────────────────────────────────────
  function avatarHtml(row) {
    var mono = '<span class="tr-mono">' + esc(playerInitials(row.name)) + '</span>';
    var cands = [];
    try {
      var fb = (typeof resolveProfilePhotoUrl === 'function') ? resolveProfilePhotoUrl(row.key, row.photoName || row.name) : null;
      if (typeof photoCandidatesFor === 'function') {
        cands = photoCandidatesFor(row.key, fb);
      } else {
        if (typeof atpPhotoFor === 'function')      cands.push(atpPhotoFor(row.key));
        if (typeof photoOverrideFor === 'function') cands.push(photoOverrideFor(row.key));
        if (fb)                                     cands.push(fb);
      }
    } catch (e) { /* fall through to the monogram */ }
    cands = cands.filter(Boolean);
    if (!cands.length) return '<span class="tr-av-wrap">' + mono + '</span>';
    return '<span class="tr-av-wrap">' + mono +
           '<img class="tr-av" src="' + esc(cands[0]) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
           'data-fb="' + esc(cands.slice(1).join('|')) + '" ' +
           'onload="this.classList.add(\'on\')" ' +
           'onerror="if(!(typeof avatarChainNext===\'function\'&&avatarChainNext(this)))this.style.display=\'none\'"></span>';
  }

  function tagsHtml(row) {
    var tk = tiersOf(_shards[row.key]);
    var out = [];
    if (tk.primary)   out.push(tk.primary   === 'tour' ? 'TOUR' : 'CHAL');
    if (tk.secondary) out.push(tk.secondary === 'tour' ? 'TOUR' : 'CHAL');
    return out.map(function (t, i) {
      return '<span class="tr-tag' + (i === 0 ? ' t0' : '') + '">' + t + '</span>';
    }).join('');
  }

  function playerHtml(row, trailing) {
    var cc = iocOf(row.country) || '—';
    var rank = (row.rank != null) ? ('#' + row.rank) : '—';
    return '<span class="tr-pl">' + avatarHtml(row) +
             '<span class="tr-pbody">' +
               '<span class="tr-pl1">' +
                 '<span class="tr-cc">' + esc(cc) + '</span>' +
                 '<span class="tr-name" title="' + esc(row.name) + '">' + esc(row.name) + '</span>' +
               '</span>' +
               '<span class="tr-pl2">' +
                 '<span class="tr-rank">' + esc(rank) + '</span>' +
                 tagsHtml(row) +
                 '<span class="tr-ev">' + esc(trailing) + '</span>' +
               '</span>' +
             '</span>' +
           '</span>';
  }

  function oddsHtml(row) {
    var o = row.odds;
    if (!o) {
      return '<span class="tr-odds"><span class="tr-price" style="color:' + DASH + '">—</span></span>';
    }
    var tip = (o.kind === 'close'
      ? 'Closing price — the last quote before the match started'
      : 'Pre-match price') + (o.book ? ', ' + o.book : '') + (o.at ? ', captured ' + o.at : '') +
      '. Never an in-running or carried-forward price.';
    return '<span class="tr-odds" title="' + esc(tip) + '">' +
             '<span class="tr-price">' + esc(fmtOdds(o.price)) + '</span>' +
             '<span class="tr-book">' + esc(o.book || '') + '</span>' +
           '</span>';
  }

  function nHtml(row) {
    if (!(row.key in _shards)) return '<span class="tr-n" style="color:' + DASH + '">·</span>';
    var n = nOf(row);
    return '<span class="tr-n">' + (n == null ? '<span style="color:' + DASH + '">—</span>' : n) + '</span>';
  }

  // ─── §1 header card ─────────────────────────────────────────────────────────
  function headerCardHtml(V) {
    // The slate counts are the DAY's counts, independent of the surface/tournament
    // narrowing — they describe the board, not the current filter.
    var all = (S.live === 'live') ? liveRows() : slateRows();
    var slateCount = Math.round(all.length / 2);
    var liveCount = 0;
    if (S.day !== 'tomorrow') {
      var seen = {};
      (S.live === 'live' ? all : slateRows()).forEach(function (r) {
        if (r.live && !seen[r.matchId]) { seen[r.matchId] = 1; liveCount++; }
      });
    }
    var updated = _updatedAt ? fmtClock(new Date(_updatedAt).toISOString()) : (_matchesAt ? fmtClock(new Date(_matchesAt).toISOString()) : '—');
    function pair(label, value, color) {
      return '<div class="tr-pair"><span class="tr-eyebrow">' + esc(label) + '</span>' +
             '<span class="tr-pairval"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(value) + '</span></div>';
    }
    return '<div class="tr-hdr">' +
             '<div>' +
               '<h1 class="tr-hdr-title">Trading report</h1>' +
               '<p class="tr-hdr-sub">One row per player on today’s ATP singles, with situational splits for the live read. Rows flip to LIVE as play starts.</p>' +
             '</div>' +
             '<div class="tr-hdr-stats">' +
               pair(S.day === 'tomorrow' ? 'Tomorrow' : 'Today', String(slateCount), null) +
               pair('Live', String(liveCount), S.day === 'tomorrow' ? DASH : '#5b9bff') +
               pair('Window', S.win === '52w' ? '52w' : '24m', null) +
               pair('Updated', updated, '#8b96b5') +
             '</div>' +
           '</div>';
  }

  // ─── §2 control bar ─────────────────────────────────────────────────────────
  function segHtml(action, opts, current, disabledVal) {
    var items = opts.map(function (o) {
      var dis = (disabledVal && o[0] === disabledVal);
      var cls = 'tr-segi' + (dis ? ' dis' : (o[0] === current ? ' on' : ''));
      return '<span class="' + cls + '"' + (dis ? '' : ' data-a="' + action + '" data-v="' + esc(o[0]) + '"') + '>' + esc(o[1]) + '</span>';
    }).join('');
    return '<span class="tr-seg">' + items + '</span>';
  }

  function dropdownHtml(action, label, dotColor, open, opts) {
    var menu = '';
    if (open) {
      menu = '<span class="tr-menu">' + opts.map(function (o) {
        var dot = o.dotColor ? '<span class="tr-dot6" style="background:' + o.dotColor + '"></span>' : '';
        return '<span class="tr-opt' + (o.sel ? ' sel' : '') + '" data-a="' + action + '" data-v="' + esc(o.value) + '">' +
                 '<span class="tr-dd-lab">' + dot + esc(o.label) + '</span>' +
                 (o.sel ? '<span class="tr-tick">✓</span>' : '') +
               '</span>';
      }).join('') + '</span>';
    }
    return '<span class="tr-dd">' +
             '<span class="tr-dd-trig" data-a="' + action + 'toggle">' +
               '<span class="tr-dd-lab">' + (dotColor ? '<span class="tr-dot6" style="background:' + dotColor + '"></span>' : '') + esc(label) + '</span>' +
               '<span class="tr-caret">▾</span>' +
             '</span>' + menu +
           '</span>';
  }

  function controlBarHtml(V) {
    var surfOpts = [{ value: 'all', label: 'All surfaces', sel: V.surfSel === 'all', dotColor: null }]
      .concat(V.surfaces.map(function (s) {
        return { value: s, label: SURF_LABEL[s] || s, sel: V.surfSel === s, dotColor: SURF_COLOR[s] || null };
      }));
    var tourOpts = [{ value: '', label: 'All tournaments', sel: !V.tourSel, dotColor: null }]
      .concat(V.tours.map(function (t) {
        return { value: t, label: t, sel: V.tourSel === t, dotColor: null };
      }));

    var top = '<div class="tr-ctl-top">' +
      segHtml('view', [['today', 'Pre-match'], ['live', 'Live']], S.live, S.day === 'tomorrow' ? 'live' : null) +
      segHtml('day', [['today', 'Today'], ['tomorrow', 'Tomorrow']], S.day, null) +
      dropdownHtml('surf', V.surfSel === 'all' ? 'All surfaces' : (SURF_LABEL[V.surfSel] || V.surfSel),
                   V.surfSel === 'all' ? null : (SURF_COLOR[V.surfSel] || null), S.surfOpen, surfOpts) +
      dropdownHtml('tour', V.tourSel || 'All tournaments', null, S.tourOpen, tourOpts) +
      segHtml('win', [['24m', '24 months'], ['52w', '52 weeks']], S.win, null) +
      '<label class="tr-searchwrap">' +
        '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="flex:none"><circle cx="9" cy="9" r="6" stroke="#5b6880" stroke-width="1.7"></circle><path d="m14 14 3 3" stroke="#5b6880" stroke-width="1.7" stroke-linecap="round"></path></svg>' +
        '<input id="trSearch" type="text" placeholder="Search player" value="' + esc(S.q) + '">' +
      '</label>' +
    '</div>';

    var tabs = '<div class="tr-ctl-tabs">' + TAB_ORDER.map(function (id) {
      return '<span class="tr-tab' + (id === S.tab ? ' on' : '') + '" data-a="tab" data-v="' + id + '">' +
             esc(COLUMN_SETS[id].label) + '</span>';
    }).join('') + '</div>';

    return '<div class="tr-ctl">' + top + tabs + '</div>';
  }

  // ─── §4 table header ────────────────────────────────────────────────────────
  function arrowFor(key) {
    if (S.sort !== key) return '⇅';
    return S.dir === -1 ? '↓' : '↑';
  }

  function headHtml(V) {
    var cells = '<span></span><span></span><span></span>';
    // n column: same 3-line stack, label "n", no funnel, no field line.
    cells += '<span class="tr-hcell' + (S.sort === 'matches' ? ' on' : '') + '" data-a="sort" data-v="matches">' +
               '<span class="tr-hcode">n ' + arrowFor('matches') + '</span>' +
               '<span class="tr-hrule"></span>' +
               '<span class="tr-hfield"></span>' +
             '</span>';
    cells += '<span></span>';

    var HL = HIGHLIGHT[S.tab] || [];
    V.codes.forEach(function (mk) {
      var band = HL.indexOf(mk) !== -1;
      var hidden = (V.tabFilters[mk] || []);
      var open = (S.menu === mk);
      var sorted = (S.sort === mk);
      var funnelColor = (hidden.length || band) ? '#5b9bff' : '#5b6880';
      var fa = V.fieldAvg[mk];
      var field = (fa == null) ? '—' : (Math.round(fa * 100) + '%');

      var tip = METRIC_TIPS[mk] || '';
      if (PBP_METRIC_KEYS.indexOf(mk) !== -1) {
        tip += ' — read from the point-by-point game sequence.';
      }

      var menu = '';
      if (open) {
        var counts = { above: 0, within: 0, below: 0 };
        V.pool.forEach(function (r) { var t = V.tierOf(r, mk); if (t) counts[t]++; });
        menu = '<span class="tr-menu tr-fmenu" data-stop="1">' +
          [['above', 'Above field'], ['within', 'Within 3 pts'], ['below', 'Below field']].map(function (t) {
            var on = hidden.indexOf(t[0]) === -1;
            return '<span class="tr-mrow' + (on ? '' : ' off') + '" data-a="tier" data-v="' + mk + '|' + t[0] + '">' +
                     '<span class="tr-box">' + (on ? '✓' : '') + '</span>' +
                     '<span class="tr-dot6" style="background:' + TIER_COLOR[t[0]] + '"></span>' +
                     '<span class="tr-mlabel">' + t[1] + '</span>' +
                     '<span class="tr-mcount">' + counts[t[0]] + '</span>' +
                   '</span>';
          }).join('') + '</span>';
      }

      cells += '<span class="tr-hcell' + (sorted ? ' on' : '') + (band ? ' band tr-bandh' : '') + (open ? ' notip' : '') +
               '" data-a="sort" data-v="' + mk + '">' +
                 '<span class="tr-hrow">' +
                   '<span class="tr-hcode">' + esc(METRIC_LABELS[mk] || mk) + ' ' + arrowFor(mk) + '</span>' +
                   '<svg class="tr-funnel" data-a="funnel" data-v="' + mk + '" width="12" height="12" viewBox="0 0 14 14">' +
                     '<path d="M1.6 2.4h10.8L8.2 7.2V12L5.8 10.5V7.2z" fill="' + funnelColor + '"></path></svg>' +
                 '</span>' +
                 '<span class="tr-hrule"></span>' +
                 '<span class="tr-hfield">field ' + field + '</span>' +
                 menu +
                 '<span class="tr-tip">' + esc(tip) + '</span>' +
               '</span>';
    });
    return '<div class="tr-head">' + cells + '</div>';
  }

  // ─── §5 rows ────────────────────────────────────────────────────────────────
  function rowHtml(row, V, opts) {
    var HL = HIGHLIGHT[S.tab] || [];
    var cells = '';
    if (opts.mode === 'paired') {
      cells += '<span class="tr-c1">' +
                 (opts.first
                   ? '<span class="tr-time">' + esc(row.startClock || '—') + '</span>' +
                     '<span class="tr-pill' + (row.live ? ' live' : '') + '">' + (row.live ? 'LIVE' : 'PRE') + '</span>'
                   : '') +
               '</span>';
    } else {
      cells += '<span class="tr-rankno">' + opts.rankNo + '</span>';
    }
    var trailing = (opts.mode === 'paired')
      ? row.event
      : (row.oppName ? 'v ' + shortName(row.oppName) : '');
    cells += playerHtml(row, trailing);
    cells += oddsHtml(row);
    cells += nHtml(row);
    cells += '<span></span>';
    V.codes.forEach(function (mk) { cells += cellHtml(row, mk, V, HL.indexOf(mk) !== -1); });
    return '<div class="tr-row ' + opts.rule + '">' + cells + '</div>';
  }

  function rowsHtml(V) {
    if (!V.list.length) {
      return '<div class="tr-rows"><div class="tr-empty2">' +
               '<span>No players match these filters.</span>' +
               '<span class="tr-eyebrow tr-clear" data-a="clear">Clear</span>' +
             '</div></div>';
    }
    var out = '';
    if (V.isSorted) {
      out = V.list.map(function (r, i) {
        return rowHtml(r, V, { mode: 'sorted', rankNo: String(i + 1), rule: i === 0 ? '' : 'sep-flat' });
      }).join('');
    } else {
      // Paired mode walks the POOL in slate order and keeps the rows that survived
      // the filters, so a filter can legitimately split a match pair — the surviving
      // player then becomes the "first" row and carries the time and status pill.
      var seen = {}, n = 0;
      out = V.pool.filter(function (r) { return V.list.indexOf(r) !== -1; }).map(function (r) {
        var first = !seen[r.matchId];
        seen[r.matchId] = 1;
        var rule = (n === 0) ? '' : (first ? 'sep-match' : 'sep-pair');
        n++;
        return rowHtml(r, V, { mode: 'paired', first: first, rule: rule });
      }).join('');
    }
    return '<div class="tr-rows">' + out + '</div>';
  }

  // ─── render ─────────────────────────────────────────────────────────────────
  function render() {
    if (!_bootstrapped) return;
    var g = grid();
    if (!g) return;

    // Preserve the search caret across the full innerHTML rebuild — the 30s poll
    // re-renders, and a trader typing a filter must not lose focus.
    var focusSearch = false, selStart = 0, selEnd = 0;
    var ae = document.activeElement;
    if (ae && ae.id === 'trSearch') { focusSearch = true; selStart = ae.selectionStart; selEnd = ae.selectionEnd; }

    var V = computeView();

    var notice = '';
    if (V.filterActive) {
      notice = '<div class="tr-fnotice">' +
                 '<span class="tr-eyebrow">Filtered · ' + V.list.length + ' of ' + V.pool.length + ' players</span>' +
                 '<span class="tr-eyebrow tr-clear" data-a="clear">Clear</span>' +
               '</div>';
    }

    var windowWord = S.win === '52w' ? '52 weeks' : '24 months';
    var w = windowMeta();
    var windowRange = (w && w.from && w.to) ? (' (' + w.from + ' → ' + w.to + ')') : '';
    var foot = '<div class="tr-foot">Splits cover the trailing ' + windowWord + windowRange +
      ' on the surface of each player’s match. Figures are coloured against the field average for the column: ' +
      'green clearly above, orange within three points, red clearly below — inverted for metrics where lower is better. ' +
      'Click a column to rank the whole slate on it, best first; click again for worst first, and a third time to return to ' +
      'match pairs. A figure we cannot source shows a dash.</div>';

    g.innerHTML = '<div class="tr-page">' +
      headerCardHtml(V) +
      controlBarHtml(V) +
      '<div><div class="tr-body">' + notice + headHtml(V) + rowsHtml(V) + '</div>' + foot + '</div>' +
    '</div>';

    if (focusSearch) {
      var el = document.getElementById('trSearch');
      if (el) { el.focus(); try { el.setSelectionRange(selStart, selEnd); } catch (e) {} }
    }
  }

  // ─── progressive stat load ──────────────────────────────────────────────────
  function ensureStatics() {
    var jobs = [];
    if (!_index) jobs.push(getJSON(INDEX_URL).then(function (j) { _index = j; }).catch(function (e) {
      console.warn('[trading-report] index load failed:', e.message); _index = _index || { meta: {} };
    }));
    return Promise.all(jobs);
  }

  function loadStats() {
    if (_loading) return;
    _loading = true;
    _loadSig = slateSig();
    render();
    ensureStatics().then(function () {
      var keys = {};
      slateRows().forEach(function (r) { if (r.key) keys[r.key] = 1; });
      liveRows().forEach(function (r) { if (r.key) keys[r.key] = 1; });
      var toFetch = Object.keys(keys).filter(function (k) { return !(k in _shards); });
      render();
      if (!toFetch.length) { _loading = false; _loaded = true; render(); return; }

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
                  active--; done++;
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
      if (slateSig() !== _loadSig) loadStats(); else render();
    }).catch(function (e) {
      console.warn('[trading-report] load failed:', e.message);
      _loading = false;
      if (slateSig() !== _loadSig) loadStats(); else render();
    });
  }

  // ─── slate acquisition (matches.json) ───────────────────────────────────────
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
  function refreshMatches() {
    var g = globalMatches();
    if (g) { if (g !== _matches) { _matches = g; _matchesDirty = true; _matchesAt = Date.now(); } return Promise.resolve(); }
    if (Date.now() - _matchesAt < MATCHES_REFRESH_MS) return Promise.resolve();
    return getJSON(MATCHES_URL).then(function (j) {
      _matches = Array.isArray(j) ? j : (j && Array.isArray(j.matches) ? j.matches : _matches);
      _matchesAt = Date.now(); _matchesDirty = true;
    }).catch(function () { /* keep the prior slate; a fetch blip must not blank the board */ });
  }

  // ─── snapshot polling ───────────────────────────────────────────────────────
  function staleness() {
    if (_updatedAt == null) return { isStale: false, ageMs: 0 };
    var age = Date.now() - _updatedAt;
    return { isStale: age > STALE_THRESHOLD_MS, ageMs: age };
  }
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
      var sig = _underway ? Object.keys(_underway).sort().join(',') : '∅';
      // Never repaint while a menu is open — it would close under the trader's hand.
      var menuOpen = S.menu || S.surfOpen || S.tourOpen;
      if (!menuOpen && (sig !== _lastUnderwaySig || _matchesDirty || staleness().isStale)) {
        _lastUnderwaySig = sig; _matchesDirty = false; render();
      }
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

  // ─── interactions (README §"Interactions & behaviour") ──────────────────────
  function onSlateChange() {
    render();
    if (!_loading) loadStats();
  }

  function toggleTier(code, tier) {
    var all = {};
    Object.keys(S.filters).forEach(function (k) { all[k] = S.filters[k]; });
    var tab = {};
    Object.keys(all[S.tab] || {}).forEach(function (k) { tab[k] = (all[S.tab][k] || []).slice(); });
    var cur = (tab[code] || []).slice();
    var i = cur.indexOf(tier);
    if (i === -1) cur.push(tier); else cur.splice(i, 1);
    if (cur.length) tab[code] = cur; else delete tab[code];
    if (Object.keys(tab).length) all[S.tab] = tab; else delete all[S.tab];
    S.filters = all;
  }

  // Sort cycle: unsorted → best first (dir -1) → worst first (dir +1) → back to
  // match pairs. "Best" respects inversion.
  function cycleSort(key) {
    if (S.sort !== key) { S.sort = key; S.dir = -1; }
    else if (S.dir === -1) { S.dir = 1; }
    else { S.sort = 'time'; S.dir = -1; }
  }

  function bootstrap() {
    if (_bootstrapped) return;
    var g = grid();
    if (!g) return;
    _bootstrapped = true;

    g.addEventListener('click', function (e) {
      var t = e.target;
      // The funnel opens that column's tier filter and must NOT also sort it.
      var funnel = t.closest && t.closest('[data-a="funnel"]');
      if (funnel) {
        e.stopPropagation();
        var fk = funnel.getAttribute('data-v');
        S.menu = (S.menu === fk) ? null : fk;
        S.surfOpen = false; S.tourOpen = false;
        render();
        return;
      }
      var act = t.closest && t.closest('[data-a]');
      // A click inside an open filter menu must not bubble to the document handler
      // that closes it, nor to the header cell that would sort the column.
      if (t.closest && t.closest('[data-stop]')) e.stopPropagation();
      if (!act) return;
      var a = act.getAttribute('data-a'), v = act.getAttribute('data-v');

      if (a === 'view')  { if (v !== S.live) { S.live = v; S.sort = 'time'; S.dir = -1; onSlateChange(); } return; }
      if (a === 'day')   {
        if (v !== S.day) {
          // Switching day resets the surface to All surfaces and the sort to time,
          // and drops back to the pre-match slate (README §"Interactions").
          S.day = v; S.live = 'today'; S.surf = 'all'; S.sort = 'time'; S.dir = -1;
          onSlateChange();
        }
        return;
      }
      if (a === 'win')   { if (v !== S.win) { S.win = v; render(); } return; }
      if (a === 'tab')   { if (COLUMN_SETS[v] && v !== S.tab) { S.tab = v; S.sort = 'time'; S.dir = -1; render(); } return; }
      if (a === 'surftoggle') { e.stopPropagation(); S.surfOpen = !S.surfOpen; S.tourOpen = false; S.menu = null; render(); return; }
      if (a === 'tourtoggle') { e.stopPropagation(); S.tourOpen = !S.tourOpen; S.surfOpen = false; S.menu = null; render(); return; }
      if (a === 'surf')  { S.surf = v; S.surfOpen = false; render(); return; }
      if (a === 'tour')  { S.tour = v; S.tourOpen = false; render(); return; }
      if (a === 'tier')  {
        e.stopPropagation();
        var parts = v.split('|');
        toggleTier(parts[0], parts[1]);
        render();
        return;
      }
      if (a === 'clear') { delete S.filters[S.tab]; S.menu = null; render(); return; }
      if (a === 'sort')  { cycleSort(v); render(); return; }
    });

    g.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'trSearch') { S.q = e.target.value; render(); }
    });

    // Escape closes any open menu; a document click closes the open filter menu.
    // The prototype leaves the two dropdowns open on an outside click; closing them
    // too is the behaviour the README describes for menus generally.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (S.menu || S.surfOpen || S.tourOpen) { S.menu = null; S.surfOpen = false; S.tourOpen = false; render(); }
    });
    document.addEventListener('click', function () {
      if (!_active) return;
      if (S.menu || S.surfOpen || S.tourOpen) { S.menu = null; S.surfOpen = false; S.tourOpen = false; render(); }
    });
  }

  function activate() {
    bootstrap();
    ensureMatches().then(function () {
      render();
      startPolling();
      loadStats();
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
