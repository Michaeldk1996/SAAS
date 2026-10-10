// TEN-421 · Trading Report — founder step 13 (2026-10-10), night. A redesign of the TEN-192 page on the step-1
// tokens and the shared components; the architecture, the splits layer and the behaviour are kept.
// Rules: .claude/rules/trading-report.md (sources, counting rules and denominators of every metric, the slate,
// status, prices, names, Updated, the field pool, Pro gating, colour). Reference = OFFICIAL VERSION 1.html → Trading
// Report; design file Trading Report.dc.html (TAB_GROUPS / HIGHLIGHT); the brief wins where it says (override).
//
// SOURCES (all read-only; nothing on this page is generated or seeded):
//   • slate     ← matches.json, filtered and ordered exactly as Today's Matches → Upcoming (matchDayBucket,
//                 isFinishedMatch, the m.time sort), Today or Tomorrow. A match the Live feed shows in play moves to
//                 the Live view (it is not a pre-match row any more).
//   • live      ← the Live page's feed: live_snapshot.board, ATP singles underway (window.LiveTab / LiveFeed
//                 predicates). Interrupted = LiveFeed.isInterrupted; it counts as live (amber pill). Header Live =
//                 In play = underway minus interrupted, the same count as the rail badge and the Live header.
//   • splits    ← trading-splits-index.json + trading-splits/{player_key}.json (build-trading-splits.js, rebuilt
//                 every deploy run): the player's primary tier (tour | chal), the surface of THIS match, the chosen
//                 window (24 months = tiers, 52 weeks = tiers52w, its own cut — never derived from the 24-month tree).
//   • names     ← newsPlayerName (Player Profile / H2H / Live name); events ← sfEventName (canonical event table);
//                 country ← the index meta country through window.SfCountryIoc (unknown → —).
//   • prices    ← the Today's Matches card: _mcNowPair (the card's Now and its book), book name as the card prints it.
//   • Updated   ← build-info.json builtAt (the run that rebuilt the split files), member zone (stennisfy.tz).
//
// Kept TEN-192 rulings: tier colour = the column's field average ±3 pts (pooled over the view, before search and
// column filters); the dim follows the player's own n, tier membership the cell's own denominator; a surfaceless live
// row resolves slate → fixture tournament → dash, never the blended bucket.
//
// Guard: window.FEATURE_TRADING_REPORT must be truthy.

// Country full name → IOC 3-letter code (ESP, ITA, MON, NED), shared by the Trading report's mono country line and the
// Head to Head page's country tags (TEN-402 r1 fix 4). It sits OUTSIDE the report's feature-flag guard so the H2H page
// has it with the report off. Covers every country on the player-profile roster plus the wider tennis set; an unmapped
// name (e.g. "World", a neutral athlete) has no code — callers print the em dash, never a guess.
window.SfCountryIoc = (function () {
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
    // TEN-402 r1: the remaining countries on the player-profile roster (Head to Head country tags)
    'Barbados':'BAR','El Salvador':'ESA','Namibia':'NAM','Pakistan':'PAK','United Arab Emirates':'UAE',
  };
  return { NAME2IOC: NAME2IOC, of: function (country) { return (country && NAME2IOC[country]) || null; } };
})();


(function () {
  'use strict';

  if (!window.FEATURE_TRADING_REPORT) return;

  var LT = window.LiveTab;
  var LF = window.LiveFeed;
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
  var BUILD_INFO_URL     = './build-info.json';
  // The pipeline's tournament_key → surface lookup, the exact map build-trading-splits.js buckets the shards by. Read
  // only so an in-play fixture ABSENT from matches.json still knows its own surface (TEN-192 gate a0d8fcbe).
  var SURFACES_URL       = './tournament-surfaces.json';
  var SURFACES_MAX_TRIES = 3;
  var SHARD_CONCURRENCY  = 6;

  // Field tiers — the page's only colours (with Interrupted): green above, amber within 3 pts, red below.
  var GREEN = 'var(--pos)', AMBER = 'var(--amber)', RED = 'var(--neg)', DIM = 'var(--text-label)', DASH = 'var(--text-label)';
  var TIER_COLOR = { above: GREEN, within: AMBER, below: RED };
  var SURF_LABEL = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };
  var MIN_TIER_DEN = 10;   // a cell is untiered below this denominator
  var TIER_PTS     = 3;    // ±3 percentage points around the field average

  // Column-head labels (caps on the page). The design file's labels where our metric means the same thing; our own
  // words where it does not (founder step 13, Data 7: babb, bbkb, bofs differ from the file — see the rules file).
  var METRIC_LABELS = {
    sh: 'Service holds', spw: 'Serve pts won', rpw: 'Return pts won', bps: 'Break pts saved', bpw: 'Break pts won',
    oph: 'Opponent holds',
    htws: 'Held to win set', htss: 'Held to stay in set', bofs: 'Broke opp. 1st game', bfsg: 'Broken 1st game',
    babb: 'Break lead lost', bbk: 'Broken back', bbkb: 'Re-broke', gfb: 'Got first break',
    ls1fb: 'Won match', ls1bf: 'Broke 1st S2', ls1b1s2: 'Broke 1st S2', ls1o1s2: 'Broken 1st S2', bfs2aws1: 'Broke 1st S2', ws1b1s2: 'Broke 1st S2',
    wfs: 'Won set 1', ws2: 'Won set 2', ws1w2: 'Won set 2', ls1ws2: 'Won set 2', ws1wm: 'Won match',
  };
  // One plain sentence per metric, saying what the code counts and over what (founder step 13, Data 7).
  // "Box score" = api-tennis get_fixtures statistics (match period); "point-by-point" = its pointbypoint games,
  // tiebreak games left out; set results come from its set scores.
  var METRIC_TIPS = {
    sh:  'Service games held, out of service games played (box score).',
    spw: 'Points won on serve, out of points served (box score).',
    rpw: 'Points won on return, out of return points played (box score).',
    bps: 'Break points saved, out of break points faced (box score).',
    bpw: 'Break points converted, out of break-point chances (box score).',
    oph: 'Service games the opponent held, out of the opponent’s service games; lower is better (box score).',
    htws: 'Service games held when serving for the set (5–0 to 5–4 or 6–5 up), out of those service games (point-by-point).',
    htss: 'Service games held when serving to stay in the set (0–5 to 4–5 or 5–6 down), out of those service games (point-by-point).',
    bofs: 'Matches where the player broke the opponent’s first service game, out of matches with point-by-point data.',
    bfsg: 'Matches where the player was broken in their own first service game, out of matches with point-by-point data; lower is better.',
    babb: 'Sets where the player broke and was broken back later in the set, out of sets where they broke; lower is better (point-by-point).',
    bbk:  'Breaks followed by losing the player’s very next service game, out of breaks with another service game in the set; lower is better (point-by-point).',
    bbkb: 'Sets where the player broke again after being broken back, out of sets where they broke and were broken back (point-by-point).',
    gfb:  'Matches where the player made the first break of the match, out of matches with at least one break (point-by-point).',
    ls1fb: 'Matches won after losing set 1, out of matches where the player lost a decided set 1 (set scores).',
    ls1bf: 'Matches where the player made the first break of set 2 after losing set 1, out of those matches with a break in set 2 (point-by-point).',
    ls1b1s2: 'Matches where the player made the first break of set 2, out of every match where they lost set 1 and set 2 was played; a set 2 with no break counts in neither column (point-by-point).',
    ls1o1s2: 'Matches where the opponent made the first break of set 2, out of every match where the player lost set 1 and set 2 was played; lower is better (point-by-point).',
    bfs2aws1: 'Matches where the player made the first break of set 2 after winning set 1, out of those matches with a break in set 2 (point-by-point).',
    ws1b1s2: 'Matches where the player made the first break of set 2, out of every match where they won set 1 and set 2 was played; a set 2 with no break does not count as one (point-by-point).',
    wfs:  'Matches where the player won set 1, out of matches where set 1 was decided (set scores).',
    ws2:  'Matches where the player won set 2, out of matches where set 2 was decided (set scores).',
    ws1w2: 'Matches where the player won set 2 after winning set 1, out of those matches where set 2 was decided (set scores).',
    ls1ws2: 'Matches where the player won set 2 after losing set 1, out of those matches where set 2 was decided (set scores).',
    ws1wm: 'Matches won after winning set 1, out of matches where the player won set 1 and the match has a winner; retirements count (set scores).',
  };

  // The seven tabs, their column groups and highlighted columns, as in Trading Report.dc.html (TAB_GROUPS,
  // HIGHLIGHT), translated to our metric keys. 'LOST SET 1 FB' (broke first in set 2) = ls1b1s2, 'LOST SET 1 BF'
  // (broken first in set 2) = ls1o1s2 — both over every lost-set-1 match with set 2 played (founder R1), so they do not
  // add to 100 (a set 2 with no break counts in neither).
  var GROUP_LABELS = {
    lost: 'After losing set 1', won: 'After winning set 1', all: 'All matches', serve: 'On serve', ret: 'On return',
    press: 'Serving under pressure', start: 'Start of set / match', bp: 'Break points',
    afterBrk: 'After breaking', afterBrkn: 'After being broken',
  };
  var COLUMN_SETS = {
    key:          { label: 'Key Stats',           groups: [['serve', ['sh', 'spw', 'bps']], ['ret', ['rpw', 'bpw', 'oph']]] },
    laysetwinner: { label: 'Lay Set Winner',      groups: [['lost', ['ls1ws2', 'ls1b1s2', 'ls1o1s2']], ['won', ['ws1w2', 'ws1wm', 'ws1b1s2']], ['all', ['bpw']]] },
    scalping:     { label: 'Scalping',            groups: [['serve', ['sh', 'spw', 'bps']], ['press', ['htws', 'htss']]] },
    laybreakup:   { label: 'Lay Break Up',        groups: [['afterBrk', ['babb', 'bbk']], ['afterBrkn', ['bbkb']], ['start', ['gfb', 'bfsg']]] },
    settrading20: { label: 'Set Trading 2–0',     groups: [['all', ['wfs', 'ws2', 'gfb']], ['won', ['ws1w2']], ['lost', ['ls1ws2']]] },
    layserve:     { label: 'Lay Serve Set/Match', groups: [['press', ['htws', 'htss']], ['start', ['bofs']], ['bp', ['bps', 'bpw']]] },
    laysetbreak:  { label: 'Lay Set & Break',     groups: [['lost', ['ls1o1s2', 'ls1ws2']], ['won', ['ws1w2']], ['afterBrk', ['babb', 'bbk']], ['afterBrkn', ['bbkb']]] },
  };
  var TAB_ORDER = ['key', 'laysetwinner', 'scalping', 'laybreakup', 'settrading20', 'layserve', 'laysetbreak'];
  function tabMetrics(id) {
    return (COLUMN_SETS[id] || COLUMN_SETS.key).groups.reduce(function (a, g) { return a.concat(g[1]); }, []);
  }

  var HIGHLIGHT = {
    key:          [],
    laysetwinner: ['ls1ws2', 'ws1w2'],
    scalping:     ['bps', 'htws', 'htss'],
    laybreakup:   ['babb', 'bbk'],
    settrading20: ['ws1w2'],
    layserve:     ['htws', 'bofs'],
    laysetbreak:  ['ls1o1s2', 'ls1ws2', 'babb', 'ws1w2'],
  };

  // Metrics where LOWER is better, so the tier flips (TEN-151 list + the design file's 'LOST SET 1 BF').
  var INVERTED = { oph: 1, bfsg: 1, babb: 1, bbk: 1, ls1o1s2: 1 };
  function isInv(mk) { return !!INVERTED[mk]; }

  var NAME2IOC = window.SfCountryIoc.NAME2IOC;
  function iocOf(country) { return (country && NAME2IOC[country]) || null; }

  // ─── state ──────────────────────────────────────────────────────────────────
  var _active = false, _timer = null, _ticking = false;
  var _underway = null, _liveFixtures = null, _updatedAt = null, _interrupted = null;
  var _matches = null, _index = null, _indexOk = false, _builtAt = null, _shards = {}, _shardFailAt = {};
  var SHARD_RETRY_MS = 120000;   // a failed shard is fetched again after 2 min (a dash until then)
  var _tsurf = null, _tsurfTries = 0;   // tournament_key → 'hard'|'clay'|'grass'; null until loaded
  var _loaded = false, _loading = false, _loadSig = null;
  var _bootstrapped = false, _matchesAt = 0, _matchesDirty = false, _lastUnderwaySig = null;

  var S = {
    tab: 'key',
    live: 'today',        // 'today' (pre-match slate) | 'live' (in-play slate)
    day: 'today',         // 'today' | 'tomorrow'
    surf: 'all',          // 'all' | 'hard' | 'clay' | 'grass' — a ROW FILTER, not a bucket picker
    tour: '',             // '' = all tournaments; else a canonical event name
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
  function fmtOdds(v) {
    var n = Number(v);
    if (typeof mxOddsTxt === 'function') return mxOddsTxt(n) || '—';
    return isFinite(n) && n > 0 ? n.toFixed(2) : '—';
  }
  // HH:MM in the member's zone (Account settings → stennisfy.tz), else the browser zone.
  function fmtZoneClock(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    var tz = (typeof newsTz === 'function' && newsTz()) || undefined;
    var f = function (z) {
      return new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: false })
        .format(new Date(ms)).replace(/^24/, '00');
    };
    try { return f(tz); } catch (e) { return f(undefined); }
  }
  // A card's start time, as Today's Matches prints it (cardFmtStart: member zone; api-tennis times are Berlin).
  function startClockOf(m) {
    if (typeof cardFmtStart === 'function') { try { var t = cardFmtStart(m, false); if (t) return t; } catch (e) {} }
    return '—';
  }
  function playerInitials(name) {
    if (typeof fhIni === 'function') return fhIni(name);
    var w = String(name || '').replace(/\./g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  // The shared display-name formatter: the Player Profile / H2H / Match analysis / News / Live name of the key, else
  // the feed's api-tennis spelling.
  function displayName(key, fallback) {
    if (typeof newsPlayerName === 'function') return newsPlayerName(key, fallback) || '—';
    return fallback || '—';
  }
  function eventLabel(raw) {
    if (!raw) return '';
    return (typeof sfEventName === 'function') ? (sfEventName(raw) || String(raw)) : String(raw);
  }
  // Every read has a 15 s ceiling, so one hung shard cannot hold the page's loading state forever.
  var FETCH_TIMEOUT_MS = 15000;
  function getJSON(url, opts) {
    opts = opts || { cache: 'no-cache' };
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS) : null;
    if (ctl) opts.signal = ctl.signal;
    return fetch(url, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  // ─── live snapshot → the Live page's grid (the ONE gate, reused) ────────────
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
  function isInterruptedFix(f) {
    if (LF && typeof LF.isInterrupted === 'function') return !!LF.isInterrupted(f);
    return /interrupt|suspend/i.test(String((f && f.event_status) || ''));
  }
  // Header Live = In play: underway minus interrupted — the rail badge's and the Live header's count.
  function inPlayCount() {
    if (!Array.isArray(_liveFixtures)) return null;
    return _liveFixtures.filter(function (f) { return !isInterruptedFix(f); }).length;
  }

  // ─── the slate: Today's Matches → Upcoming, same set, same order ────────────
  function tmBucket(m) { return (typeof matchDayBucket === 'function') ? matchDayBucket(m) : m.day; }
  function tmFinished(m) { return (typeof isFinishedMatch === 'function') ? isFinishedMatch(m) : (!m.live && !!m.finalScore); }
  // getFiltered() with no filters set: the day bucket (matchDayBucket drops an in-play match to 'past'), finished
  // matches out (isFinishedMatch — a match leaves on the first matches.json with its final score), sorted on m.time.
  function tmSlate(day) {
    var arr = Array.isArray(_matches) ? _matches : [];
    return arr.filter(function (m) { return m && tmBucket(m) === day && !tmFinished(m); })
      .sort(function (a, b) { return String(a.time || '').localeCompare(String(b.time || '')); });
  }
  function isMatchLive(m) {
    if (_underway) return !!(m.p1Key && m.p2Key && _underway[pairKey(m.p1Key, m.p2Key)]);
    return !!m.live;
  }

  // The price + book of the player's Today's Matches card: the card's Now pair (_mcNowPair — its book ladder), the
  // book name as the card prints it. A started match whose book stopped quoting falls back to that book's close.
  function cardBookName(book, pair) {
    if (!book) return '';
    var key = String(book).toLowerCase();
    var names = (typeof MC_BOOK_NAMES !== 'undefined') ? MC_BOOK_NAMES : {};
    return (pair && pair.bookName) || names[key] || (typeof mxBookLabel === 'function' ? mxBookLabel(book) : book);
  }
  // The price the player's Today's Matches card shows (founder R3: the column = the card face, exactly). The card face
  // prints its Now pair (_mcNowPair) and "—" without one — including a match that has started and whose book has gone
  // quiet — so this column does the same. Book named as the card names it. Nothing else, never invented.
  function oddsFor(m, which) {
    var who = which === 1 ? 'p1' : 'p2';
    var pair = null;
    try { if (typeof _mcNowPair === 'function') pair = _mcNowPair(m); } catch (e) { pair = null; }
    if (pair && pair[who] != null && Number(pair[who]) > 0) {
      return { price: Number(pair[who]), book: cardBookName(pair.book, pair), kind: 'now' };
    }
    return null;
  }

  function playerRow(m, which, live) {
    var isFirst = which === 1;
    var key = String((isFirst ? m.p1Key : m.p2Key) || '');
    var meta = (_index && _index.meta && _index.meta[key]) || null;
    var rank = isFirst ? m.p1Rank : m.p2Rank;
    if (rank == null && meta && meta.rank != null) rank = meta.rank;
    var oppKey = String((isFirst ? m.p2Key : m.p1Key) || '');
    var ev = eventLabel(m.tour);
    return {
      id: String(m.id || ''),
      matchId: String(m.id || pairKey(m.p1Key, m.p2Key)),
      which: which,
      key: key,
      name: displayName(key, isFirst ? m.p1 : m.p2),
      oppName: displayName(oppKey, isFirst ? m.p2 : m.p1),
      rank: (rank == null ? null : rank),
      country: (meta && meta.country) || null,
      tour: ev,
      tournamentKey: ev,
      event: ev,
      surface: String(m.surface || '').toLowerCase(),
      startClock: startClockOf(m),
      live: live,
      interrupted: false,
      odds: oddsFor(m, which),
    };
  }

  // Pre-match = Today's Matches' Upcoming list for the day, minus any match the Live feed already shows in play
  // (a match flips to LIVE when Live shows it; it is then a Live-view row).
  function slateRows(day) {
    day = day || S.day;
    var out = [];
    tmSlate(day).forEach(function (m) {
      if (day === 'today' && isMatchLive(m)) return;
      out.push(playerRow(m, 1, false));
      out.push(playerRow(m, 2, false));
    });
    return out;
  }

  // The pair's card for a live fixture: today's unfinished card, else a card matches.json flags live — never another
  // day's meeting of the same two players (founder R3 review: it would lend its time and price).
  function slateMatchByKeys(a, b) {
    var arr = Array.isArray(_matches) ? _matches : [];
    var want = pairKey(a, b), flagged = null;
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!(m && m.p1Key && m.p2Key && pairKey(m.p1Key, m.p2Key) === want)) continue;
      if (tmBucket(m) === 'today' && !tmFinished(m)) return m;
      if (m.live && !flagged) flagged = m;
    }
    return flagged;
  }

  // TEN-192 ruling 7. The fixture's own tournament, via the tournament_key → surface map the shard generator buckets
  // by. Only hard / clay / grass are accepted; anything else returns '' and the row dashes. Never a blend. Fetched
  // only when some in-play fixture lacks a usable slate surface.
  function needsSurfaceMap() {
    if (!Array.isArray(_liveFixtures)) return false;
    for (var i = 0; i < _liveFixtures.length; i++) {
      var f = _liveFixtures[i];
      if (!f || !f.first_player_key || !f.second_player_key) continue;
      var m = slateMatchByKeys(f.first_player_key, f.second_player_key);
      var s = m ? String(m.surface || '').toLowerCase() : '';
      if (s !== 'hard' && s !== 'clay' && s !== 'grass') return true;
    }
    return false;
  }
  function surfaceFromTournament(tournamentKey) {
    if (!_tsurf || tournamentKey == null || tournamentKey === '') return '';
    var s = String(_tsurf[String(tournamentKey)] || '').toLowerCase();
    return (s === 'hard' || s === 'clay' || s === 'grass') ? s : '';
  }

  function liveFixtureRow(f, which) {
    var isFirst = which === 1;
    var key = String((isFirst ? f.first_player_key : f.second_player_key) || '');
    var oppKey = String((isFirst ? f.second_player_key : f.first_player_key) || '');
    var meta = (_index && _index.meta && _index.meta[key]) || null;
    var abbr = isFirst ? f.event_first_player : f.event_second_player;
    var oppAbbr = isFirst ? f.event_second_player : f.event_first_player;
    var slate = slateMatchByKeys(f.first_player_key, f.second_player_key);
    var odds = null;
    if (slate) {
      var which2 = (String(slate.p1Key) === key) ? 1 : 2;
      odds = oddsFor(slate, which2);
    }
    // slate surface → the fixture's own tournament → dash. (Ruling 7.)
    var surf = slate ? String(slate.surface || '').toLowerCase() : '';
    if (surf !== 'hard' && surf !== 'clay' && surf !== 'grass') surf = surfaceFromTournament(f.tournament_key);
    var ev = eventLabel(f.tournament_name);
    var rank = slate ? (String(slate.p1Key) === key ? slate.p1Rank : slate.p2Rank) : null;
    if (rank == null && meta && meta.rank != null) rank = meta.rank;
    return {
      id: String(f.event_key || ''),
      matchId: String(f.event_key || pairKey(f.first_player_key, f.second_player_key)),
      which: which,
      key: key,
      name: displayName(key, abbr),
      oppName: displayName(oppKey, oppAbbr),
      rank: (rank == null ? null : rank),
      country: (meta && meta.country) || null,
      tour: ev,
      tournamentKey: ev,
      event: ev,
      surface: surf,
      // the card's own start time when the match has a card (founder R3), else the feed's scheduled time
      startClock: slate ? startClockOf(slate) : startClockOf({ date: f.event_date, time: f.event_time }),
      live: true,
      interrupted: isInterruptedFix(f),
      odds: odds,
    };
  }

  // Live = the Live page's grid: every ATP singles match the feed shows underway, Interrupted included.
  function liveRows() {
    if (!Array.isArray(_liveFixtures)) return [];
    var fx = _liveFixtures.slice().sort(function (a, b) {
      return (String(a.event_date || '') + ' ' + String(a.event_time || '')).localeCompare(String(b.event_date || '') + ' ' + String(b.event_time || ''));
    });
    var out = [];
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      if (!f || !f.first_player_key || !f.second_player_key) continue;
      out.push(liveFixtureRow(f, 1));
      out.push(liveFixtureRow(f, 2));
    }
    return out;
  }

  // ─── shard reads ────────────────────────────────────────────────────────────
  // `tiers` = 24 months, `tiers52w` = the 52-week (364-day) bucket the generator cuts as its OWN window. A shard
  // without tiers52w dashes on 52 weeks; it is NEVER back-filled from the 24-month tree.
  function activeTree(shard) {
    if (!shard) return null;
    return S.win === '52w' ? (shard.tiers52w || null) : (shard.tiers || null);
  }
  // The tier the player plays most ON THIS SURFACE in the window (tour = ATP main tour incl. qualifying, chal =
  // Challenger incl. qualifying; the all-surfaces count only breaks a tie); the figures are read from that tier only —
  // tiers are never blended. Picking on the surface keeps n = the player's matches on this surface (founder step 13
  // Data 7): a mostly-Challenger player with 20 tour hard matches reads those 20, not 2 Challenger ones.
  function tiersOf(shard, surf) {
    var t = activeTree(shard);
    if (!t) return { primary: null, secondary: null };
    var m = function (tier, s) { return (t[tier] && t[tier][s] && t[tier][s].m) || 0; };
    var tourS = surf ? m('tour', surf) : 0, chalS = surf ? m('chal', surf) : 0;
    if (tourS !== chalS) return tourS > chalS ? { primary: 'tour', secondary: chalS ? 'chal' : null } : { primary: 'chal', secondary: tourS ? 'tour' : null };
    var tourM = (t.tour && t.tour.all && t.tour.all.m) || 0;
    var chalM = (t.chal && t.chal.all && t.chal.all.m) || 0;
    if (!tourM && !chalM) return { primary: null, secondary: null };
    if (tourM >= chalM) return { primary: 'tour', secondary: chalM ? 'chal' : null };
    return { primary: 'chal', secondary: tourM ? 'tour' : null };
  }
  // The bucket is always the surface of THIS player's own match — including under "All surfaces".
  function bucketFor(row) {
    var shard = _shards[row.key];
    var t = activeTree(shard);
    var tierKey = tiersOf(shard, row.surface).primary;
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

  // ─── the view model ─────────────────────────────────────────────────────────
  // pool = the view's rows (Pre-match or Live, the day) after Surface and Tournament; searched = pool after the search
  //        box (the menu counts read it, so they equal the colours of the cells on screen); list = searched after the
  //        column tier filters — what renders. The FIELD is pooled over the whole day (fieldPool), not the view.
  function computeView() {
    var rows = (S.live === 'live' && S.day === 'today') ? liveRows() : slateRows();
    // Founder R2: the field is the whole day's slate — pre-match and live together — so a player's colour does not
    // change when his match flips to LIVE. The drop-downs list the same day's surfaces and events.
    var dayRows = (S.day === 'today') ? slateRows('today').concat(liveRows()) : slateRows(S.day);

    var surfaces = [];
    dayRows.forEach(function (r) {
      if (r.surface && SURF_LABEL[r.surface] && surfaces.indexOf(r.surface) === -1) surfaces.push(r.surface);
    });
    var surfSel = (S.surf === 'all' || surfaces.indexOf(S.surf) !== -1) ? S.surf : 'all';

    var tours = [];
    dayRows.forEach(function (r) {
      if (r.tournamentKey && tours.indexOf(r.tournamentKey) === -1) tours.push(r.tournamentKey);
    });
    var tourSel = (!S.tour || tours.indexOf(S.tour) !== -1) ? S.tour : '';

    var pool = rows.filter(function (r) {
      if (surfSel !== 'all' && r.surface !== surfSel) return false;
      if (tourSel && r.tournamentKey !== tourSel) return false;
      return true;
    });

    // fieldPool = the day's rows after Surface and Tournament; before Pre-match / Live, search and column filters.
    var fieldPool = dayRows.filter(function (r) {
      if (surfSel !== 'all' && r.surface !== surfSel) return false;
      if (tourSel && r.tournamentKey !== tourSel) return false;
      return true;
    });

    var codes = tabMetrics(S.tab);

    // Field average: a POOLED ratio — sum the numerators and the denominators across the field pool, then divide.
    var fieldAvg = {};
    codes.forEach(function (mk) {
      var won = 0, tot = 0;
      fieldPool.forEach(function (r) {
        var c = cellOf(r, mk);
        if (c) { won += c[0]; tot += c[1]; }
      });
      fieldAvg[mk] = tot ? (won / tot) : null;
    });

    // Tier of one cell: null when the cell is absent or its denominator is under 10 (untiered — and an untiered
    // cell never passes an active filter on that column). Founder R1: the gap is taken from the PRINTED figures —
    // the cell's rounded % minus the column's rounded field % — and |gap| <= 3 is amber, 4 or more green / red
    // (flipped on inverted metrics), the site ±3 rule (Live / Profile heatmap). Colour, menu counts and the filter
    // all read this one gap.
    // Founder R2: a player under 10 matches is greyed, so he is untiered too — the menu counts equal the cell colours.
    function tierOf(row, mk) {
      var c = cellOf(row, mk);
      if (!c || c[1] < MIN_TIER_DEN) return null;
      var pn = nOf(row);
      if (pn != null && pn < MIN_TIER_DEN) return null;
      var fa = fieldAvg[mk];
      if (fa == null) return null;
      var gap = Math.round((c[0] / c[1]) * 100) - Math.round(fa * 100);
      if (isInv(mk)) gap = -gap;
      return gap > TIER_PTS ? 'above' : (gap < -TIER_PTS ? 'below' : 'within');
    }

    var tabFilters = S.filters[S.tab] || {};
    var filterActive = Object.keys(tabFilters).length > 0;

    var q = (S.q || '').trim().toLowerCase();
    var searched = pool.filter(function (r) {
      return !q || (r.name || '').toLowerCase().indexOf(q) !== -1;
    });
    var list = searched;
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
      // A row with no figure sorts LAST in both directions.
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
      rows: rows, pool: pool, searched: searched, list: list, codes: codes,
      fieldAvg: fieldAvg, tierOf: tierOf,
      surfaces: surfaces, surfSel: surfSel, tours: tours, tourSel: tourSel,
      tabFilters: tabFilters, filterActive: filterActive, isSorted: isSorted,
      // A row whose surface waits on the lazily fetched map is not absent yet — it shows the loading dot.
      surfacePending: (!_tsurf && _tsurfTries < SURFACES_MAX_TRIES && needsSurfaceMap()),
    };
  }
  function rowPending(row, V) {
    if (row.key && !(row.key in _shards)) return true;
    return !row.surface && !!V.surfacePending;
  }

  // ─── cells (keep as built) ──────────────────────────────────────────────────
  // absent / total 0 → —; total < 5 → "won/total" small grey, no %; total < 10 → % small grey + "won/total · small n";
  // total ≥ 10 → % 15/700 in the tier colour + "won/total". Player n < 10 dims the figure to grey.
  function cellHtml(row, mk, V, band) {
    var cls = 'tr-cell' + (band ? ' tr-bandb' : '');
    if (rowPending(row, V)) {
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
  // Initials avatar (override: no photos), as on Live, Model and the shell.
  function avatarHtml(row) {
    return '<span class="tr-ava">' + esc(playerInitials(row.name)) + '</span>';
  }
  // The tag says which matches the figures read: TOUR = ATP main tour (qualifying included), CHAL = Challenger
  // (qualifying included). One tag — the tier the row reads; the other tier is never blended in.
  function tagsHtml(row) {
    var tk = tiersOf(_shards[row.key], row.surface);
    if (!tk.primary) return '';
    return '<span class="tr-tag">' + (tk.primary === 'tour' ? 'TOUR' : 'CHAL') + '</span>';
  }
  function hasProfile(key) {
    try { return !!(key && typeof playerProfiles !== 'undefined' && playerProfiles && playerProfiles[String(key)]); }
    catch (e) { return false; }
  }

  function playerHtml(row, trailing, vs) {
    var cc = iocOf(row.country) || '—';
    var rank = (row.rank != null) ? ('#' + row.rank) : '—';
    var lk = hasProfile(row.key);
    return '<span class="tr-pl">' + avatarHtml(row) +
             '<span class="tr-pbody">' +
               '<span class="tr-pl1">' +
                 '<span class="tr-cc tr-caps">' + esc(cc) + '</span>' +
                 '<span class="tr-name' + (lk ? ' lk" data-a="profile" data-v="' + esc(row.key) : '') + '">' + esc(row.name) + '</span>' +
               '</span>' +
               '<span class="tr-pl2">' +
                 '<span class="tr-rank">' + esc(rank) + '</span>' +
                 tagsHtml(row) +
                 '<span class="tr-ev' + (vs ? ' vs' : '') + '">' + esc(trailing) + '</span>' +
               '</span>' +
             '</span>' +
           '</span>';
  }

  function oddsHtml(row) {
    var o = row.odds;
    if (!o) {
      return '<span class="tr-odds"><span class="tr-price" style="color:' + DASH + '">—</span></span>';
    }
    var tip = 'Card price, ' + (o.book || '');
    return '<span class="tr-odds" title="' + esc(tip) + '">' +
             '<span class="tr-price">' + esc(fmtOdds(o.price)) + '</span>' +
             '<span class="tr-book">' + esc(o.book || '') + '</span>' +
           '</span>';
  }

  function nHtml(row, V) {
    if (rowPending(row, V)) return '<span class="tr-n" style="color:' + DASH + '">·</span>';
    var n = nOf(row);
    return '<span class="tr-n">' + (n == null ? '<span style="color:' + DASH + '">—</span>' : n) + '</span>';
  }

  // ─── header (the shared 35b .sfh) ───────────────────────────────────────────
  function headerCardHtml() {
    // These describe the BOARD, not the view (Live = In play, 0 on Tomorrow; Updated = the split files' build).
    // Founder R2: Today and Live both count MATCHES, and they don't overlap: Today = the pre-match matches of the day
    // (Today's Matches → Upcoming minus what the Live feed already shows in play), Live = In play.
    var slateCount = slateRows(S.day).length / 2;
    var live = S.day === 'tomorrow' ? 0 : inPlayCount();
    var updated = (_indexOk && _builtAt != null) ? fmtZoneClock(_builtAt) : '—';
    function pair(label, value, color, mod) {
      return '<div class="sfh__stat"><span class="sfh__l">' + esc(label) + '</span>' +
             '<span class="sfh__v' + (value === '—' ? ' sfh__v--none' : mod ? ' sfh__v--' + mod : '') + '"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(value) + '</span></div>';
    }
    return '<div class="sfh tr-hdr">' +
             '<div class="sfh__text">' +
               '<h1 class="sfh__title">Trading Report</h1>' +
               '<p class="sfh__sub">One row per player on today’s ATP singles, with situational splits for the live read. <span class="sfh__tail">Rows flip to LIVE as play starts.</span></p>' +
             '</div>' +
             '<div class="sfh__stats">' +
               pair(S.day === 'tomorrow' ? 'Tomorrow' : 'Today', String(slateCount), null) +
               pair('Live', live == null ? '—' : String(live), S.day === 'tomorrow' ? DASH : null) +
               pair('Window', S.win === '52w' ? '52w' : '24m', null) +
               pair('Updated', updated, null, 'soft') +
             '</div>' +
           '</div>';
  }

  // ─── control bar ────────────────────────────────────────────────────────────
  var CHEV = '<svg class="tr-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"></path></svg>';

  function segHtml(action, opts, current, disabledVal, extraCls) {
    var items = opts.map(function (o) {
      var dis = (disabledVal && o[0] === disabledVal);
      var cls = 'tr-segi' + (dis ? ' dis' : (o[0] === current ? ' on' : ''));
      return '<span class="' + cls + '"' + (dis ? ' aria-disabled="true"' : ' data-a="' + action + '" data-v="' + esc(o[0]) + '"') + '>' + esc(o[1]) + '</span>';
    }).join('');
    return '<span class="tr-track' + (extraCls ? ' ' + extraCls : '') + '">' + items + '</span>';
  }

  function dropdownHtml(action, label, open, opts) {
    var menu = '';
    if (open) {
      menu = '<span class="tr-menu" data-stop="1">' + opts.map(function (o) {
        return '<span class="tr-opt' + (o.sel ? ' sel' : '') + '" data-a="' + action + '" data-v="' + esc(o.value) + '">' +
                 '<span>' + esc(o.label) + '</span>' +
                 (o.sel ? '<span class="tr-tick">✓</span>' : '') +
               '</span>';
      }).join('') + '</span>';
    }
    return '<span class="tr-dd">' +
             '<span class="tr-dd-trig' + (open ? ' open' : '') + '" data-a="' + action + 'toggle">' +
               '<span>' + esc(label) + '</span>' + CHEV +
             '</span>' + menu +
           '</span>';
  }

  function controlBarHtml(V) {
    var surfOpts = [{ value: 'all', label: 'All surfaces', sel: V.surfSel === 'all' }]
      .concat(V.surfaces.map(function (s) { return { value: s, label: SURF_LABEL[s] || s, sel: V.surfSel === s }; }));
    var tourOpts = [{ value: '', label: 'All tournaments', sel: !V.tourSel }]
      .concat(V.tours.map(function (t) { return { value: t, label: t, sel: V.tourSel === t }; }));

    var top = '<div class="tr-ctl-top">' +
      segHtml('view', [['today', 'Pre-match'], ['live', 'Live']], S.live, S.day === 'tomorrow' ? 'live' : null) +
      segHtml('day', [['today', 'Today'], ['tomorrow', 'Tomorrow']], S.day, null) +
      dropdownHtml('surf', V.surfSel === 'all' ? 'All surfaces' : (SURF_LABEL[V.surfSel] || V.surfSel), S.surfOpen, surfOpts) +
      dropdownHtml('tour', V.tourSel || 'All tournaments', S.tourOpen, tourOpts) +
      segHtml('win', [['52w', '52 weeks'], ['24m', '24 months']], S.win, null) +   // reference order; 24 months stays the default
      '<label class="tr-search">' +
        '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="flex:none" aria-hidden="true"><circle cx="9" cy="9" r="6" stroke="var(--text-label)" stroke-width="1.7"></circle><path d="m14 14 3 3" stroke="var(--text-label)" stroke-width="1.7" stroke-linecap="round"></path></svg>' +
        '<input id="trSearch" type="text" placeholder="Search player" value="' + esc(S.q) + '">' +
      '</label>' +
    '</div>';

    var tabs = '<div class="tr-ctl-tabs">' +
      segHtml('tab', TAB_ORDER.map(function (id) { return [id, COLUMN_SETS[id].label]; }), S.tab, null, 'tr-tabs') +
    '</div>';

    return '<div class="tr-ctl">' + top + tabs + '</div>';
  }

  // ─── table head ─────────────────────────────────────────────────────────────
  function arrowFor(key) {
    if (S.sort !== key) return '⇅';
    return S.dir === -1 ? '↓' : '↑';
  }

  function headHtml(V) {
    var bands = '<span></span><span></span><span></span><span></span><span></span>' +
      (COLUMN_SETS[S.tab] || COLUMN_SETS.key).groups.map(function (g) {
        return '<span class="tr-band" style="grid-column:span ' + g[1].length + '"><span class="tr-caps">' + esc(GROUP_LABELS[g[0]] || '') + '</span><span class="tr-band-rule"></span></span>';
      }).join('');

    var cells = '<span></span><span></span><span></span>';
    cells += '<span class="tr-hcell tr-hn' + (S.sort === 'matches' ? ' on' : '') + '" data-a="sort" data-v="matches">' +
               '<span class="tr-hlab">n <span class="tr-arrow">' + arrowFor('matches') + '</span></span>' +
               '<span class="tr-hrule"></span>' +
               '<span class="tr-hfoot"></span>' +
             '</span>';
    cells += '<span></span>';

    var HL = HIGHLIGHT[S.tab] || [];
    V.codes.forEach(function (mk) {
      var band = HL.indexOf(mk) !== -1;
      var hidden = (V.tabFilters[mk] || []);
      var open = (S.menu === mk);
      var sorted = (S.sort === mk);
      var funnelColor = hidden.length ? 'var(--text)' : 'var(--text-label)';
      var fa = V.fieldAvg[mk];
      var field = (fa == null) ? '—' : (Math.round(fa * 100) + '%');

      var menu = '';
      if (open) {
        var counts = { above: 0, within: 0, below: 0 };
        V.searched.forEach(function (r) { var t = V.tierOf(r, mk); if (t) counts[t]++; });
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

      cells += '<span class="tr-hcell' + (sorted ? ' on' : '') + (band ? ' tr-bandh' : '') + (open ? ' notip' : '') +
               '" data-a="sort" data-v="' + mk + '">' +
                 '<span class="tr-hlab">' + esc(METRIC_LABELS[mk] || mk) + '</span>' +
                 '<span class="tr-hrule"></span>' +
                 '<span class="tr-hfoot"><span></span><span class="tr-hfield">field ' + field + '</span>' +
                   '<span class="tr-hact"><span class="tr-arrow">' + arrowFor(mk) + '</span>' +
                   '<svg class="tr-funnel" data-a="funnel" data-v="' + mk + '" width="12" height="12" viewBox="0 0 14 14">' +
                     '<path d="M1.6 2.4h10.8L8.2 7.2V12L5.8 10.5V7.2z" fill="' + funnelColor + '"></path></svg></span>' +
                 '</span>' +
                 menu +
                 '<span class="tr-tip">' + esc(METRIC_TIPS[mk] || '') + '</span>' +
               '</span>';
    });
    return '<div class="tr-head"><div class="tr-hgrid">' + bands + '</div><div class="tr-hgrid">' + cells + '</div></div>';
  }

  // ─── rows ───────────────────────────────────────────────────────────────────
  function pillHtml(row) {
    if (row.interrupted) return '<span class="tr-pill int">INT</span>';
    return row.live ? '<span class="tr-pill live">LIVE</span>' : '<span class="tr-pill">PRE</span>';
  }

  function rowHtml(row, V, opts) {
    var HL = HIGHLIGHT[S.tab] || [];
    var cells = '';
    if (opts.mode === 'paired') {
      cells += '<span class="tr-c1">' +
                 (opts.first ? '<span class="tr-time">' + esc(row.startClock || '—') + '</span>' + pillHtml(row) : '') +
               '</span>';
    } else {
      cells += '<span class="tr-rankno">' + opts.rankNo + '</span>';
    }
    var trailing = (opts.mode === 'paired') ? row.event : (row.oppName && row.oppName !== '—' ? 'v ' + row.oppName : '');
    cells += playerHtml(row, trailing, opts.mode !== 'paired');
    cells += oddsHtml(row);
    cells += nHtml(row, V);
    cells += '<span></span>';
    V.codes.forEach(function (mk) { cells += cellHtml(row, mk, V, HL.indexOf(mk) !== -1); });
    return '<div class="tr-row ' + opts.rule + '"' + (row.interrupted && opts.first ? ' title="Interrupted"' : '') + '>' + cells + '</div>';
  }

  function rowsHtml(V) {
    if (!V.list.length) {
      // Two empty states: no matches on the slate at all (nothing to clear), or filters that leave nobody.
      if (!V.rows.length) {
        var msg = (S.live === 'live')
          ? 'No ATP singles in play right now.'
          : (S.day === 'tomorrow' ? 'No ATP singles scheduled tomorrow yet.' : 'No ATP singles left to play today.');
        return '<div class="tr-rows"><div class="tr-empty2"><span class="tr-emsg">' + msg + '</span></div></div>';
      }
      return '<div class="tr-rows"><div class="tr-empty2">' +
               '<span class="tr-emsg">No players match these filters.</span>' +
               '<span class="tr-caps tr-link" data-a="clearall">Clear</span>' +
             '</div></div>';
    }
    var out = '';
    if (V.isSorted) {
      out = V.list.map(function (r, i) {
        return rowHtml(r, V, { mode: 'sorted', rankNo: String(i + 1), rule: i === 0 ? '' : 'sep-flat' });
      }).join('');
    } else {
      // Paired mode walks the POOL in slate order and keeps the rows that survived the filters; a surviving single
      // player becomes the "first" row of his match and carries the time and status pill.
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

    // Keep the search caret across the innerHTML rebuild (the 30 s poll re-renders).
    var focusSearch = false, selStart = 0, selEnd = 0;
    var ae = document.activeElement;
    if (ae && ae.id === 'trSearch') { focusSearch = true; selStart = ae.selectionStart; selEnd = ae.selectionEnd; }

    var V = computeView();

    var notice = '';
    if (V.filterActive) {
      notice = '<div class="tr-fnotice">' +
                 '<span class="tr-caps">Filtered · ' + V.list.length + ' of ' + V.pool.length + ' players</span>' +
                 '<span class="tr-caps tr-link" data-a="clear">Clear</span>' +
               '</div>';
    }

    var windowWord = S.win === '52w' ? '52 weeks' : '24 months';
    var foot = '<div class="tr-foot">Splits cover the trailing ' + windowWord + ' on the surface of each player’s match. ' +
      'Figures are coloured against the field average for the column: green clearly above, amber within 3 points, ' +
      'red clearly below, inverted where lower is better. The field is every player on the selected day, pre-match and live ' +
      '(after Surface and Tournament, before Pre-match / Live, search and column filters), pooled over the same window. ' +
      'Click a column to rank the slate on it.</div>';

    g.innerHTML = '<div class="tr-page" style="--tr-n:' + V.codes.length + '">' +
      headerCardHtml() +
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
    if (!_indexOk) jobs.push(getJSON(INDEX_URL).then(function (j) { _index = j; _indexOk = true; }).catch(function (e) {
      console.warn('[trading-report] index load failed:', e.message); _index = _index || { meta: {} };
    }));
    // Updated = the build that rebuilt the split files (build-trading-splits.js runs on every deploy run).
    if (_builtAt == null) jobs.push(getJSON(BUILD_INFO_URL).then(function (j) {
      var t = j && Date.parse(j.builtAt || '');
      _builtAt = isFinite(t) ? t : null;
    }).catch(function () { /* no build stamp → Updated stays — */ }));
    // Ruling 7's lookup: fetched only when an in-play fixture needs it, left null on failure (an empty `surfaces`
    // counts as a failure); tick() re-arms it while tries remain.
    if (!_tsurf && _tsurfTries < SURFACES_MAX_TRIES && needsSurfaceMap()) {
      _tsurfTries++;
      jobs.push(getJSON(SURFACES_URL).then(function (j) {
        var m = j && j.surfaces;
        _tsurf = (m && Object.keys(m).length) ? m : null;
        if (!_tsurf) console.warn('[trading-report] tournament surface map is empty — live rows without a slate surface will dash');
      }).catch(function (e) {
        console.warn('[trading-report] tournament surface map load failed:', e.message);
      }));
    }
    return Promise.all(jobs);
  }

  function allKeys() {
    var keys = {};
    ['today', 'tomorrow'].forEach(function (d) {
      slateRows(d).forEach(function (r) { if (r.key) keys[r.key] = 1; });
    });
    liveRows().forEach(function (r) { if (r.key) keys[r.key] = 1; });
    return keys;
  }

  function needsRetry(k) {
    return _shards[k] === null && _shardFailAt[k] != null && Date.now() - _shardFailAt[k] > SHARD_RETRY_MS;
  }
  function loadStats() {
    if (_loading) return;
    _loading = true;
    _loadSig = slateSig();
    render();
    ensureStatics().then(function () {
      var toFetch = Object.keys(allKeys()).filter(function (k) { return !(k in _shards) || needsRetry(k); });
      render();
      if (!toFetch.length) return;

      var idx = 0, active = 0, done = 0, lastPaint = 0;
      return new Promise(function (resolve) {
        function pump() {
          while (active < SHARD_CONCURRENCY && idx < toFetch.length) {
            var k = toFetch[idx++];
            active++;
            (function (k) {
              getJSON(SHARD_BASE + k + '.json')
                .then(function (j) { _shards[k] = j; })
                .catch(function () { _shards[k] = null; _shardFailAt[k] = Date.now(); })   // absent → dashed row, never guessed
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
      var missing = Object.keys(allKeys()).some(function (k) { return !(k in _shards); }) ||
        (!_tsurf && _tsurfTries < SURFACES_MAX_TRIES && needsSurfaceMap());   // a snapshot that landed mid-load still gets its surfaces
      if (slateSig() !== _loadSig || missing) loadStats(); else render();
    }).catch(function (e) {
      console.warn('[trading-report] load failed:', e.message);
      _loading = false; _loaded = true;
      if (slateSig() !== _loadSig) loadStats(); else render();
    });
  }

  // ─── slate acquisition (matches.json — the board's own global when present) ─
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
      var sig = _liveFixtures ? _liveFixtures.map(function (f) { return pairKey(f.first_player_key, f.second_player_key) + (isInterruptedFix(f) ? 'i' : ''); }).sort().join(',') : '∅';
      // Never repaint while a menu is open — it would close under the trader's hand.
      var menuOpen = S.menu || S.surfOpen || S.tourOpen;
      if (!menuOpen && (sig !== _lastUnderwaySig || _matchesDirty || staleness().isStale)) {
        _lastUnderwaySig = sig; _matchesDirty = false; render();
      }
      if (!_loading && _loaded) {
        var need = false;
        Object.keys(allKeys()).forEach(function (k) { if (!(k in _shards) || needsRetry(k)) need = true; });
        if (!_indexOk) need = true;
        // Re-arm the surface-map fetch while tries remain and a live fixture still needs it.
        if (!_tsurf && _tsurfTries < SURFACES_MAX_TRIES && needsSurfaceMap()) need = true;
        if (need) loadStats();
      }
      if (_active && !document.hidden) _timer = setTimeout(tick, POLL_INTERVAL_MS);
    });
  }
  function startPolling() { clearTimeout(_timer); tick(); }

  // ─── interactions (keep as built) ───────────────────────────────────────────
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

  // Sort cycle: unsorted → best first (dir -1) → worst first (dir +1) → back to match pairs. "Best" respects inversion.
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
      // A click inside an open menu must not reach the document closer nor the header cell under it.
      var inMenu = t.closest && t.closest('[data-stop]');
      if (inMenu) {
        e.stopPropagation();
        if (!(t.closest && t.closest('[data-a="tier"],[data-a="surf"],[data-a="tour"]'))) return;
      }
      var act = t.closest && t.closest('[data-a]');
      if (!act) return;
      var a = act.getAttribute('data-a'), v = act.getAttribute('data-v');

      if (a === 'profile') { e.stopPropagation(); if (typeof openPlayerProfileFromMatch === 'function') openPlayerProfileFromMatch(v); return; }
      if (a === 'view')  { if (v !== S.live) { S.live = v; S.sort = 'time'; S.dir = -1; onSlateChange(); } return; }
      if (a === 'day')   {
        if (v !== S.day) {
          // Switching day resets Surface to All surfaces and the sort, and drops back to Pre-match.
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
      // The empty state's Clear also clears the search and the Surface / Tournament narrowing that emptied it.
      if (a === 'clearall') { delete S.filters[S.tab]; S.q = ''; S.surf = 'all'; S.tour = ''; S.menu = null; render(); return; }
      if (a === 'sort')  { cycleSort(v); render(); return; }
    });

    g.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'trSearch') { S.q = e.target.value; render(); }
    });

    // Escape and a document click close any open menu.
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
