/* drops-page.js — TEN-294 Dropping Odds page.
 *
 * Built from the Claude Design export `design_handoff_dropping_odds` (LOCKED 2026-09-26).
 * The export's structure and values are the spec (drops-page.css); its sample data is not:
 * every row here comes from the drops endpoint, stennisfy-drops.fly.dev, which reads the
 * database once per 30 s and serves that snapshot to every viewer. This page is a reader.
 *
 * Rulings (founder card 79e9db02, 2026-09-26; .claude/rules/drops.md):
 *   Q1  a row is one selection × bookmaker; drop = (open − now) / open, shortened rows only
 *   Q2  WINDOW "Since open" is the default and means everything the feed holds (24h); 48h disabled
 *   Q3  past 5 min, or with the endpoint unreachable, the export's FEED DISCONNECTED banner as drawn
 *   Q4  the modal plots only recorded prices; missing fields "—"; strip = books with a row
 *   Q5  Alerts shown disabled, "Coming soon"
 * Mapping measured in TEN-297 doc `feed-mapping`.
 *
 * Gated by FEATURE_DROPS (default ON; ?drops=0 or localStorage stennisfy.flags.drops=0 turns
 * it off). The sidebar button stays hidden unless this file reveals it.
 */
(function () {
  'use strict';

  var ENDPOINT = 'https://stennisfy-drops.fly.dev';
  var POLL_MS = 30000;               // the endpoint's own read cadence; polling faster reads nothing new
  var AMBER_AFTER_S = 90;            // 3x the read interval (drops.md)
  var DISCONNECTED_AFTER_S = 300;    // 5 min (drops.md)
  var H = 3600e3;

  // odds.md "Chart sources" table: Bet105 Sharp, Superbet Soft. Never guessed from the data.
  var BOOK_CLASS = { Bet105: 'sharp', Superbet: 'soft' };
  var MARKETS = [['mw', 'Match winner'], ['sh', 'Set handicap'], ['gh', 'Game handicap'], ['tg', 'Total games'], ['ts', 'Total sets']];
  // the only market any drop bot detects today; the other four are not tracked (count "—", never 0)
  var TRACKED = { mw: true };
  var LINE_TO_MARKET = { 'Match Winner': 'mw' };
  var WINDOWS = [['open', 'Since open'], ['12h', '12h'], ['24h', '24h'], ['48h', '48h']];
  var MIN = [[0, 'Any'], [5, '5%'], [10, '10%'], [20, '20%'], [30, '30%']];
  var STARTS = [[0, 'Any time'], [3, '3h'], [6, '6h'], [12, '12h'], [24, '24h']];
  var SORT = [['drop', 'Biggest drop'], ['recent', 'Latest move'], ['soon', 'Starting soonest']];

  // ─── pure helpers (exported for test-ten294-drops.mjs) ───────────────────────
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) && n > 0 ? n : null; }
  function tierOf(t) {
    t = String(t || '');
    if (/^ATP/i.test(t)) return 'ATP';
    if (/challenger/i.test(t)) return 'Challenger';
    if (/^ITF/i.test(t)) return 'ITF';
    return null;
  }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function price2(v) { var n = num(v); return n == null ? '—' : n.toFixed(2); }

  // One row per selection × book (Q1). Repeat alerts collapse to the newest; the row's drop is
  // open → latest at that book; only a shortened price is listed.
  function buildRows(feedRows) {
    var by = {};
    (feedRows || []).forEach(function (r) {
      var k = [r.playerA, r.playerB, r.side, r.book, r.line].join('\u0001');
      if (!by[k] || String(r.detectedAt) > String(by[k].detectedAt)) by[k] = r;
    });
    var out = [];
    Object.keys(by).forEach(function (k) {
      var r = by[k];
      var open = num(r.open && r.open.price), now = num(r.latest && r.latest.price);
      if (open == null || now == null) return;
      var drop = (open - now) / open * 100;
      if (!(drop > 0)) return;
      var side = r.side || '';
      var opp = side === r.playerA ? r.playerB : side === r.playerB ? r.playerA : null;
      var dropped = num(r.droppedTo && r.droppedTo.price);
      // "moved": the current price's record time when it differs from the alert price, else the alert
      var movedAt = (dropped != null && dropped !== now && r.latest && r.latest.at) ? r.latest.at : (r.droppedTo && r.droppedTo.at) || r.detectedAt;
      out.push({
        id: r.id, book: r.book, cls: BOOK_CLASS[r.book] || null, tier: tierOf(r.tier), tierRaw: r.tier,
        mk: LINE_TO_MARKET[r.line] || null, playerA: r.playerA, playerB: r.playerB, side: side, opp: opp,
        open: open, now: now, drop: drop, openAt: r.open && r.open.at, openKind: r.open && r.open.kind,
        preDrop: r.preDrop, droppedTo: r.droppedTo, latest: r.latest,
        detectedAt: r.detectedAt, movedAt: movedAt, start: r.scheduledStart || null,
        started: r.started === true, pastScheduledStart: r.pastScheduledStart === true,
      });
    });
    return out;
  }

  function defaults(books) {
    return { tiers: ['ATP', 'Challenger', 'ITF'], btype: 'all', books: (books || Object.keys(BOOK_CLASS)).slice(),
      win: 'open', min: 0, starts: 0, sort: 'drop', q: '', mk: ['mw'] };
  }

  function passes(r, S, dataNow, ignoreMk) {
    if (!ignoreMk && S.mk.indexOf(r.mk) < 0) return false;
    if (S.tiers.indexOf(r.tier) < 0) return false;
    if (S.books.indexOf(r.book) < 0) return false;
    if (S.btype !== 'all' && r.cls !== S.btype) return false;
    if (S.win === '12h' || S.win === '24h') {
      var hrs = S.win === '12h' ? 12 : 24;
      if (!(dataNow - Date.parse(r.detectedAt) <= hrs * H)) return false;
    }
    if (S.min > 0 && !(r.drop >= S.min)) return false;
    if (S.starts > 0) {
      if (!r.start) return false;
      if ((Date.parse(r.start) - dataNow) / H > S.starts) return false;
    }
    var q = fold(S.q);
    if (q && fold((r.playerA || '') + ' ' + (r.playerB || '')).indexOf(q) < 0) return false;
    return true;
  }

  function sortRows(list, sort) {
    var t = function (s) { var v = Date.parse(s); return isFinite(v) ? v : null; };
    var cmp = {
      drop: function (a, b) { return b.drop - a.drop; },
      recent: function (a, b) { return (t(b.movedAt) || 0) - (t(a.movedAt) || 0); },
      soon: function (a, b) { var x = t(a.start), y = t(b.start); if (x == null) return 1; if (y == null) return -1; return x - y; },
    }[sort] || function () { return 0; };
    // a started match sorts last in every order (drops.md)
    return list.slice().sort(function (a, b) { return (a.started - b.started) || cmp(a, b); });
  }

  function view(rows, S, dataNow) {
    var list = sortRows(rows.filter(function (r) { return passes(r, S, dataNow, false); }), S.sort);
    var mkCount = {};
    rows.forEach(function (r) { if (r.mk && passes(r, S, dataNow, true)) mkCount[r.mk] = (mkCount[r.mk] || 0) + 1; });
    var matches = {};
    list.forEach(function (r) { matches[[r.playerA, r.playerB].sort().join('|')] = 1; });
    return { list: list, mkCount: mkCount, nMatches: Object.keys(matches).length };
  }

  // "41m ago", "2h ago", "23s ago", "just now"
  function ago(ms) {
    if (!(ms >= 0)) return '—';
    var s = Math.round(ms / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  function hhmmUTC(iso) {
    var d = new Date(iso);
    if (!isFinite(d)) return '—';
    return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ' UTC';
  }

  // connected (green) | amber (> 90 s) | disconnected (> 5 min, or the endpoint unreachable)
  function feedState(ageS, reachable) {
    if (!reachable || ageS == null || ageS > DISCONNECTED_AFTER_S) return 'disconnected';
    return ageS > AMBER_AFTER_S ? 'amber' : 'connected';
  }

  // The modal chart (Q4): the row's recorded prices only, on the last-24h axis ending at data time.
  function chartPoints(r, dataNow) {
    var raw = [['open', r.openAt, r.open], ['pre', r.preDrop && r.preDrop.at, num(r.preDrop && r.preDrop.price)],
      ['dropped', r.droppedTo && r.droppedTo.at, num(r.droppedTo && r.droppedTo.price)], ['latest', r.latest && r.latest.at, r.now]];
    var seen = {}, pts = [];
    raw.forEach(function (p) {
      var t = Date.parse(p[1]);
      if (!isFinite(t) || p[2] == null) return;
      var fr = 1 - (dataNow - t) / (24 * H);
      if (fr < 0 || fr > 1.0001) return;       // older than 24h: off the axis (the dashed open line keeps its level)
      var key = t + '|' + p[2];
      if (seen[key]) return;
      seen[key] = 1;
      pts.push({ kind: p[0], t: t, fr: Math.min(1, fr), v: p[2] });
    });
    pts.sort(function (a, b) { return a.t - b.t; });
    return pts;
  }

  function chartSvg(pts, openPrice) {
    var W = 988, HH = 210, padT = 12, padB = 22, padL = 2, padR = 44;
    var vs = pts.map(function (p) { return p.v; }).concat(openPrice != null ? [openPrice] : []);
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi - lo < 0.1) { lo -= 0.1; hi += 0.1; }
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    var X = function (fr) { return padL + fr * (W - padL - padR); };
    var Y = function (v) { return padT + (hi - v) / (hi - lo) * (HH - padT - padB); };
    var f = function (n) { return (Math.round(n * 100) / 100).toString(); };
    var k = [];
    if (pts.length > 1) {
      var base = HH - padB;
      k.push('<polygon points="' + pts.map(function (p) { return f(X(p.fr)) + ',' + f(Y(p.v)); }).join(' ') + ' ' + f(X(pts[pts.length - 1].fr)) + ',' + base + ' ' + f(X(pts[0].fr)) + ',' + base + '" fill="rgba(218,98,89,0.08)"/>');
    }
    [0, 0.5, 1].forEach(function (g) {
      var y = padT + g * (HH - padT - padB);
      k.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + f(y) + '" y2="' + f(y) + '" stroke="rgba(235,241,242,0.06)"/>');
      k.push('<text x="' + (W - padR + 6) + '" y="' + f(y + 3.5) + '" fill="#6E7A93" font-size="10" font-family="IBM Plex Mono">' + (hi - g * (hi - lo)).toFixed(2) + '</text>');
    });
    [['−24h', 0, 'start'], ['−12h', 0.5, 'middle'], ['now', 1, 'end']].forEach(function (x) {
      k.push('<text x="' + f(X(x[1])) + '" y="' + (HH - 5) + '" fill="#6E7A93" font-size="10" font-family="IBM Plex Mono" text-anchor="' + x[2] + '">' + x[0] + '</text>');
    });
    if (openPrice != null && pts.length > 1) {
      k.push('<line class="do-open-ref" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + f(Y(openPrice)) + '" y2="' + f(Y(openPrice)) + '" stroke="rgba(235,241,242,0.18)" stroke-dasharray="3 5"/>');
    }
    for (var i = 1; i < pts.length; i++) {
      var gap = pts[i].fr - pts[i - 1].fr > 0.15;
      k.push('<line class="' + (gap ? 'do-gap' : 'do-seg-l') + '" x1="' + f(X(pts[i - 1].fr)) + '" y1="' + f(Y(pts[i - 1].v)) + '" x2="' + f(X(pts[i].fr)) + '" y2="' + f(Y(pts[i].v)) + '" stroke="' + (gap ? '#6E7A93' : '#DA6259') + '" stroke-width="' + (gap ? 1.2 : 1.8) + '"' + (gap ? ' stroke-dasharray="3 4"' : '') + '/>');
    }
    pts.forEach(function (p, j) {
      var last = j === pts.length - 1;
      k.push('<circle class="do-dot-p" cx="' + f(X(p.fr)) + '" cy="' + f(Y(p.v)) + '" r="' + (last ? 4 : 2.8) + '" fill="' + (last ? '#EBF1F2' : '#10121B') + '" stroke="' + (last ? '#EBF1F2' : '#DA6259') + '" stroke-width="1.5"/>');
    });
    return '<svg viewBox="0 0 ' + W + ' ' + HH + '" width="100%">' + k.join('') + '</svg>';
  }

  // Avatar key: an exact, unordered two-player match against today's board (matches.json names
  // are "D. Medvedev"). Both players must match one board card, and only one card may match,
  // or the row keeps the export's #1B2A55 fallback — never a guessed face.
  function nameSig(n) {
    var t = fold(n).replace(/\./g, ' ').split(/\s+/).filter(Boolean);
    return t.length ? t[0][0] + '|' + t[t.length - 1] : null;
  }
  function boardKeyFor(r, board) {
    var a = nameSig(r.playerA), b = nameSig(r.playerB), s = nameSig(r.side);
    if (!a || !b || !s) return null;
    var hits = (board || []).filter(function (m) {
      var x = nameSig(m.p1), y = nameSig(m.p2);
      return (x === a && y === b) || (x === b && y === a);
    });
    if (hits.length !== 1) return null;
    var m = hits[0];
    var key = nameSig(m.p1) === s ? m.p1Key : nameSig(m.p2) === s ? m.p2Key : null;
    return key == null ? null : { key: String(key), photoName: nameSig(m.p1) === s ? m.p1 : m.p2 };
  }

  var PURE = { BOOK_CLASS: BOOK_CLASS, MARKETS: MARKETS, TRACKED: TRACKED, WINDOWS: WINDOWS, buildRows: buildRows, defaults: defaults,
    passes: passes, sortRows: sortRows, view: view, ago: ago, hhmmUTC: hhmmUTC, feedState: feedState, chartPoints: chartPoints,
    chartSvg: chartSvg, boardKeyFor: boardKeyFor, tierOf: tierOf, AMBER_AFTER_S: AMBER_AFTER_S, DISCONNECTED_AFTER_S: DISCONNECTED_AFTER_S,
    ENDPOINT: ENDPOINT };
  if (typeof module === 'object' && module.exports) module.exports = PURE;
  if (typeof document === 'undefined') return;

  // ─── the page ───────────────────────────────────────────────────────────────
  var enabled = (function () {
    try {
      var q = new URLSearchParams(location.search);
      if (q.has('drops')) return q.get('drops') !== '0';
      return localStorage.getItem('stennisfy.flags.drops') !== '0';
    } catch (e) { return true; }
  })();
  window.FEATURE_DROPS = enabled;
  if (!enabled) return;

  var st = {
    S: defaults(), rows: [], feedRows: null, status: null, statusAt: 0, reachable: true, everLoaded: false,
    refreshing: false, menu: null, drawer: null, drBook: null, tip: false, active: false, timer: null, ticker: null, etag: null,
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function root() { return document.getElementById('dropsRoot'); }
  function dataNow() {
    // data time: the snapshot's generatedAt, advanced by real time since we read it
    if (!st.status || !st.status.generatedAt) return Date.now();
    return Date.parse(st.status.serverNow || st.status.generatedAt) + (Date.now() - st.statusAt);
  }
  function ageS() {
    if (!st.status || st.status.ageS == null) return null;
    return st.status.ageS + (Date.now() - st.statusAt) / 1000;
  }
  function books() {
    var set = {};
    Object.keys(BOOK_CLASS).forEach(function (b) { set[b] = 1; });
    st.rows.forEach(function (r) { set[r.book] = 1; });
    var order = function (b) { return BOOK_CLASS[b] === 'sharp' ? 0 : BOOK_CLASS[b] === 'soft' ? 1 : 2; };
    return Object.keys(set).sort(function (a, b) { return order(a) - order(b) || a.localeCompare(b); });
  }

  function fetchJson(path, etag) {
    var h = {};
    if (etag) h['If-None-Match'] = etag;
    return fetch(ENDPOINT + path, { headers: h, cache: 'no-cache' }).then(function (res) {
      if (res.status === 304) return { notModified: true };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().then(function (j) { return { json: j, etag: res.headers.get('ETag') }; });
    });
  }

  function load() {
    return Promise.all([fetchJson('/status.json'), fetchJson('/drops.json', st.etag)]).then(function (x) {
      st.status = x[0].json; st.statusAt = Date.now(); st.reachable = true;
      if (!x[1].notModified) { st.feedRows = x[1].json.rows || []; st.etag = x[1].etag; st.rows = buildRows(st.feedRows); }
      if (!st.everLoaded) { st.everLoaded = true; st.S.books = books(); }
    }).catch(function () { st.reachable = false; });
  }

  function schedule() {
    clearTimeout(st.timer);
    if (!st.active) return;
    st.timer = setTimeout(function () { load().then(function () { render(); schedule(); }); }, POLL_MS);
  }

  function refresh() {
    st.refreshing = true; st.menu = null; render();
    var t0 = Date.now();
    load().then(function () {
      // the export's ~800 ms loading beat, never longer than the real read
      setTimeout(function () { st.refreshing = false; render(); schedule(); }, Math.max(0, 800 - (Date.now() - t0)));
    });
  }

  // ─── rendering ──────────────────────────────────────────────────────────────
  var ICON = {
    search: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="#6E7A93" stroke-width="1.7"></circle><path d="M13.2 13.2 17 17" stroke="#6E7A93" stroke-width="1.7" stroke-linecap="round"></path></svg>',
    refresh: '<svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M16 10a6 6 0 11-1.8-4.3M16 3.5V7h-3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    bell: '<svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M5 13.5V9a5 5 0 0110 0v4.5l1.5 1.5h-13zM8.3 17a1.9 1.9 0 003.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    chev: '<svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" stroke="#6E7A93" stroke-width="1.4" fill="none" stroke-linecap="round"></path></svg>',
    chart: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="flex:none;"><path d="M3 5l5 5 3-3 6 7M17 14v-4M17 14h-4" stroke="#6E7A93" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  };
  function lab(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i][0] === v) return arr[i][1]; return ''; }

  function headerHtml(v, fs) {
    var withDrop = v.list.length;
    var biggest = withDrop ? Math.max.apply(null, v.list.map(function (r) { return r.drop; })).toFixed(1) + '%' : '—';
    var a = ageS(), status;
    if (fs === 'disconnected') {
      var mins = a == null ? '—' : Math.max(1, Math.round(a / 60)) + ' min';
      status = '<span class="do-status"><span class="do-dot off"></span><span class="do-status-t">Prices updated <span class="do-mono">' + esc(mins) + '</span> ago</span></span>';
    } else {
      status = '<span class="do-status"><span class="do-dot' + (fs === 'amber' ? ' amber' : '') + '"></span><span class="do-status-t">Live · updated ' + esc(ago(a * 1000)) + '</span></span>';
    }
    return '<div class="do-head"><div class="do-head-l">' +
      '<h1 class="do-h1">Dropping Odds</h1>' +
      '<div class="do-head-sub"><div class="do-subtitle">Lines flagged in the last 24h whose price has shortened since the market opened, across every bookmaker we track. Biggest drops first.</div>' + status + '</div></div>' +
      '<div class="do-stats">' +
      '<div class="do-stat"><span class="do-stat-k">Drops</span><span class="do-stat-v" data-k="drops">' + withDrop + '</span></div>' +
      '<div class="do-stat"><span class="do-stat-k">Biggest</span><span class="do-stat-v' + (withDrop ? '' : ' none') + '" data-k="biggest">' + biggest + '</span></div>' +
      '<div class="do-stat"><span class="do-stat-k">Window</span><span class="do-stat-v" data-k="window">' + esc(lab(WINDOWS, st.S.win)) + '</span></div>' +
      '</div></div>';
  }

  function bannerHtml() {
    var asOf = st.status && st.status.generatedAt ? hhmmUTC(st.status.generatedAt) : '—';
    return '<div class="do-banner"><span class="do-banner-l"><span class="do-banner-k">FEED DISCONNECTED</span>' +
      '<span class="do-banner-t">Showing prices as of <span class="do-mono">' + esc(asOf) + '</span>. New moves will not appear until the feed reconnects.</span></span>' +
      '<button class="do-link" data-act="reconnect">Reconnect</button></div>';
  }

  function searchHtml() {
    return '<div class="do-search-row"><div class="do-search">' + ICON.search +
      '<input type="text" data-act="q" placeholder="Search players" value="' + esc(st.S.q) + '" aria-label="Search players"></div>' +
      '<div class="do-actions">' +
      '<button class="do-btn" data-act="refresh">' + ICON.refresh + (st.refreshing ? 'Refreshing…' : 'Refresh') + '</button>' +
      '<button class="do-btn do-btn-alerts" aria-disabled="true" title="Coming soon">' + ICON.bell + 'Alerts <span class="do-soon">COMING SOON</span></button>' +
      '</div></div>';
  }

  function seg(label, on, act, val, mono, disabled, title) {
    return '<button class="do-seg' + (mono ? ' mono' : '') + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(val) + '"' +
      (disabled ? ' disabled' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</button>';
  }
  function railsHtml() {
    var S = st.S, win = (st.feedRows && st.status) ? 24 : 24;
    var r = '<div class="do-rails">';
    r += '<div class="do-rail"><span class="do-rail-k">TIER</span>' + ['ATP', 'Challenger', 'ITF'].map(function (t) { return seg(t, S.tiers.indexOf(t) >= 0, 'tier', t); }).join('') + '</div>';
    r += '<div class="do-rail"><span class="do-rail-k">BOOKS</span>' + [['all', 'All'], ['sharp', 'Sharp'], ['soft', 'Soft']].map(function (b) { return seg(b[1], S.btype === b[0], 'btype', b[0]); }).join('') + '</div>';
    r += '<div class="do-rail"><span class="do-rail-k">WINDOW</span>' + WINDOWS.map(function (w) {
      var dis = w[0] === '48h';
      var title = w[0] === 'open' ? 'Everything the feed holds: the last ' + win + 'h of flagged moves' : dis ? 'The feed holds ' + win + 'h' : '';
      return seg(w[1], S.win === w[0], 'win', w[0], true, dis, title);
    }).join('') + '</div>';
    r += '<div class="do-rail"><span class="do-rail-k">MIN DROP</span>' + MIN.map(function (m) { return seg(m[1], S.min === m[0], 'min', m[0], true); }).join('') + '</div>';
    return r + '</div>';
  }

  function tabsHtml(v) {
    var S = st.S, all = MARKETS.map(function (m) { return m[0]; });
    var tracked = Object.keys(TRACKED).reduce(function (s, k) { return s + (v.mkCount[k] || 0); }, 0);
    var t = '<div class="do-tabs-row"><div class="do-tabs do-hs">';
    t += '<button class="do-tab' + (S.mk.length === all.length ? ' on' : '') + '" data-act="mk" data-v="all">All markets<span class="do-tab-n">' + tracked + '</span></button>';
    MARKETS.forEach(function (m) {
      var n = TRACKED[m[0]] ? String(v.mkCount[m[0]] || 0) : '—';
      t += '<button class="do-tab' + (S.mk.length === 1 && S.mk[0] === m[0] ? ' on' : '') + '" data-act="mk" data-v="' + m[0] + '">' + m[1] + '<span class="do-tab-n">' + n + '</span></button>';
    });
    return t + '</div></div>';
  }

  function menuHtml(key, label, value, active, disabled, body) {
    var open = st.menu === key && !disabled;
    return '<div class="do-menu"><span class="do-trig' + (active ? ' active' : '') + (open ? ' open' : '') + '" data-act="menu" data-v="' + key + '"' +
      (disabled ? ' aria-disabled="true" title="Surface is not in the feed yet"' : '') + '>' +
      '<span class="do-trig-k">' + label + '</span><span class="do-trig-v">' + esc(value) + '</span>' +
      (active ? '<span class="do-x" data-act="clear" data-v="' + key + '">×</span>' : ICON.chev) + '</span>' +
      (open ? '<div class="do-pop">' + body + '</div>' : '') + '</div>';
  }
  function opt(label, on, act, val, multi, cls) {
    return '<span class="do-opt' + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(val) + '">' +
      '<span class="do-box' + (multi ? ' multi' : '') + '">' + (on && multi ? '✓' : '') + '</span><span class="do-opt-l">' + esc(label) + '</span>' +
      (cls ? '<span class="do-tag ' + cls + '">' + cls.toUpperCase() + '</span>' : '') + '</span>';
  }
  function resultsHtml(v) {
    var S = st.S, bks = books(), allB = S.books.length === bks.length;
    var bookBody = ['sharp', 'soft'].map(function (cls) {
      var bs = bks.filter(function (b) { return BOOK_CLASS[b] === cls; });
      if (!bs.length) return '';
      return '<div class="do-pop-h">' + cls.toUpperCase() + '</div>' + bs.map(function (b) { return opt(b, S.books.indexOf(b) >= 0, 'book', b, true, cls); }).join('');
    }).join('') + bks.filter(function (b) { return !BOOK_CLASS[b]; }).map(function (b) { return opt(b, S.books.indexOf(b) >= 0, 'book', b, true); }).join('');
    var bookVal = allB ? 'All' : S.books.length === 1 ? S.books[0] : S.books.length + ' books';
    var startsBody = STARTS.map(function (s) { return opt(s[1], S.starts === s[0], 'starts', s[0]); }).join('');
    var sortBody = SORT.map(function (s) { return opt(s[1], S.sort === s[0], 'sort', s[0]); }).join('');
    var count = st.refreshing || !st.everLoaded ? 'Loading moves…' :
      v.list.length + ' ' + (v.list.length === 1 ? 'move' : 'moves') + ' across ' + v.nMatches + ' ' + (v.nMatches === 1 ? 'match' : 'matches');
    return '<div class="do-results"><span class="do-results-l"><span class="do-count">' + count + '</span>' +
      '<span class="do-note">Drops are measured within one bookmaker.</span></span><div class="do-menus">' +
      menuHtml('book', 'Bookmaker', bookVal, !allB, false, bookBody) +
      menuHtml('surf', 'Surface', '—', false, true, '') +
      menuHtml('starts', 'Starts within', lab(STARTS, S.starts), S.starts > 0, false, startsBody) +
      menuHtml('sort', 'Sort', lab(SORT, S.sort), false, false, sortBody) +
      '</div></div>';
  }

  function colsHtml() {
    return '<div class="do-cols"><span>DROP</span><span>SELECTION · MATCH · BOOK</span>' +
      '<span class="do-cols-r"><span class="do-help">OPEN</span><span class="do-tip">First price Stennisfy recorded, not necessarily the bookmaker\'s opening line.</span> → NOW</span></div>';
  }

  function avatarHtml(r) {
    var hit = null, cands = [];
    try {
      hit = boardKeyFor(r, typeof matches !== 'undefined' ? matches : []);   // eslint-disable-line no-undef
      if (hit) {
        var fb = typeof resolveProfilePhotoUrl === 'function' ? resolveProfilePhotoUrl(hit.key, hit.photoName) : null;   // eslint-disable-line no-undef
        cands = typeof photoCandidatesFor === 'function' ? photoCandidatesFor(hit.key, fb) : (fb ? [fb] : []);           // eslint-disable-line no-undef
      }
    } catch (e) { cands = []; }
    cands = cands.filter(Boolean);
    if (!cands.length) return '<span class="do-av" aria-hidden="true"></span>';
    return '<img class="do-av" src="' + esc(cands[0]) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb="' + esc(cands.slice(1).join('|')) + '" ' +
      'onerror="if(!(typeof avatarChainNext===\'function\'&&avatarChainNext(this))){this.removeAttribute(\'src\');this.onerror=null;}">';
  }

  function rowHtml(r, now) {
    var fill = Math.min(100, Math.max(8, r.drop / 40 * 100)).toFixed(0);
    var detail = 'Match winner · vs ' + (r.opp || '—') + ' · ' + r.book;
    return '<div class="do-row" role="button" tabindex="0" data-act="row" data-v="' + esc(r.id) + '">' +
      '<span class="do-meter-c"><span class="do-meter"><span class="do-meter-f" style="height:' + fill + '%"></span></span>' +
      '<span class="do-fig"><span class="do-fig-n">' + r.drop.toFixed(1) + '<span class="do-fig-p">%</span></span><span class="do-fig-c">DROP</span></span></span>' +
      '<div class="do-who">' + avatarHtml(r) + '<div class="do-who-t">' +
      '<span class="do-sel">' + esc(r.side) + ' to win' + (r.started ? '<span class="do-started">STARTED</span>' : '') + '</span>' +
      '<span class="do-detail">' + esc(detail) + '</span></div></div>' +
      '<div class="do-px" title="Show odds movement">' + ICON.chart + '<span class="do-px-c">' +
      '<span class="do-px-l"><span class="do-px-o">' + price2(r.open) + '</span><span class="do-px-a">→</span><span class="do-px-n">' + price2(r.now) + '</span></span>' +
      '<span class="do-moved">moved ' + esc(ago(now - Date.parse(r.movedAt))) + '</span></span></div></div>';
  }

  function listHtml(v, fs) {
    if (st.refreshing || !st.everLoaded && st.reachable) {
      var w = [['62%', '44%'], ['54%', '38%'], ['70%', '48%'], ['58%', '40%'], ['66%', '46%'], ['50%', '36%'], ['60%', '42%']];
      return '<div class="do-list">' + w.map(function (x) {
        return '<div class="do-skel"><span style="display:flex;align-items:center;gap:12px"><b style="width:4px;height:44px;border-radius:2px"></b><b style="width:56px;height:22px"></b></span>' +
          '<span style="display:flex;align-items:center;gap:14px"><b style="width:40px;height:40px;border-radius:50%;flex:none"></b><span style="display:flex;flex-direction:column;gap:8px;flex:1"><b style="height:12px;width:' + x[0] + ';background:rgba(235,241,242,0.07)"></b><b style="height:9px;width:' + x[1] + ';background:rgba(235,241,242,0.045)"></b></span></span>' +
          '<b style="height:16px;width:96px"></b></div>';
      }).join('') + '</div>';
    }
    var untracked = st.S.mk.length === 1 && !TRACKED[st.S.mk[0]];
    if (!v.list.length) {
      var h = untracked ? 'No drops on this market' : 'No moves above your threshold in this window';
      var d = untracked ? 'Only Match winner is tracked so far.' :
        'Min drop ' + lab(MIN, st.S.min) + ' · ' + lab([['open', 'since open'], ['12h', 'last 12h'], ['24h', 'last 24h'], ['48h', 'last 48h']], st.S.win);
      return '<div class="do-empty"><span class="do-empty-h">' + h + '</span><span class="do-empty-d">' + d + '</span>' +
        '<button class="do-link" data-act="reset">Reset filters</button></div>';
    }
    var now = dataNow();
    return '<div class="do-list' + (fs === 'disconnected' ? ' stale' : '') + '">' + v.list.map(function (r) { return rowHtml(r, now); }).join('') + '</div>';
  }

  function render() {
    var el = root();
    if (!el) return;
    var focusQ = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-act') === 'q';
    var caret = focusQ ? document.activeElement.selectionStart : null;
    var now = dataNow(), v = view(st.rows, st.S, now), fs = feedState(ageS(), st.reachable);
    el.innerHTML = '<div class="do-wrap">' + headerHtml(v, fs) + (fs === 'disconnected' && (st.everLoaded || !st.reachable) ? bannerHtml() : '') +
      searchHtml() + railsHtml() + tabsHtml(v) + resultsHtml(v) + colsHtml() + listHtml(v, fs) +
      (st.menu ? '<div class="do-clickaway" data-act="clickaway"></div>' : '') + '</div>';
    if (focusQ) { var q = el.querySelector('[data-act="q"]'); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} }
    renderModal();
  }

  // ─── modal ──────────────────────────────────────────────────────────────────
  function closeModal() { st.drawer = null; st.drBook = null; st.tip = false; renderModal(); }
  function renderModal() {
    var ov = document.getElementById('doOverlay');
    var r = st.drawer && st.rows.filter(function (x) { return x.id === st.drawer; })[0];
    if (!r) { if (ov) ov.remove(); return; }
    if (!ov) { ov = document.createElement('div'); ov.id = 'doOverlay'; ov.className = 'do-ov'; document.body.appendChild(ov); }
    var side = document.querySelector('.sf-sidebar');
    ov.style.setProperty('--do-shell-left', side ? side.getBoundingClientRect().width + 'px' : '0px');
    var now = dataNow();
    // Q4: the strip holds only books that have a row for this same selection
    var same = st.rows.filter(function (x) { return x.playerA === r.playerA && x.playerB === r.playerB && x.side === r.side && x.mk === r.mk; });
    same.sort(function (a, b) { return (a.cls === 'sharp' ? 0 : 1) - (b.cls === 'sharp' ? 0 : 1); });
    var sel = (st.drBook && same.filter(function (x) { return x.book === st.drBook; })[0]) || r;
    var pts = chartPoints(sel, now);
    var cls = r.cls || 'soft';
    var startTxt = '—', cd = '—';
    if (r.start && isFinite(Date.parse(r.start))) {
      var d = new Date(r.start);
      startTxt = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      var mins = Math.round((Date.parse(r.start) - now) / 60000);
      cd = r.started ? 'started' : mins >= 0 ? 'in ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : 'past start';
    }
    var nm = function (n) { return '<span class="nm' + (n === r.side ? ' backed' : '') + '">' + esc(n) + '</span><span class="rk">— · Elo —</span>'; };
    var big = same.filter(function (x) { return x.drop >= 10; });
    var sharpN = same.filter(function (x) { return x.cls === 'sharp'; }).length, bigSharp = big.filter(function (x) { return x.cls === 'sharp'; }).length;
    var html = '<div class="do-ov-scrim" data-act="close"></div><div class="do-ov-box" role="dialog" aria-modal="true" aria-label="Price move"><div class="do-ov-scroll">' +
      '<div class="do-ov-head"><div class="do-ov-hl">' +
      '<span class="do-ov-eye">Price move · Match winner · ' + esc(r.book) + (r.cls ? '<span class="do-ov-btag ' + cls + '">' + cls.toUpperCase() + '</span>' : '') + '</span>' +
      '<span class="do-ov-sel">' + esc(r.side) + ' to win</span>' +
      '<span class="do-ov-pl">' + nm(r.playerA) + '<span>v</span>' + nm(r.playerB) + '</span>' +
      '<span class="do-ov-meta">— · — · — · <span class="st">' + esc(startTxt) + '</span> <span class="do-mono">(' + esc(cd) + ')</span></span></div>' +
      '<div class="do-ov-hr"><div class="do-ov-px"><span class="do-ov-pxl">' +
      '<span class="do-ov-open' + (st.tip ? ' tip' : '') + '" data-act="tip">' + price2(r.open) + '<span class="do-ov-tip">Open is the first price Stennisfy recorded, not necessarily the bookmaker\'s opening line.</span></span>' +
      '<span class="do-ov-arrow">→</span><span class="do-ov-now">' + price2(r.now) + '</span></span>' +
      '<span class="do-ov-drop">▼ ' + r.drop.toFixed(1) + '% · moved ' + esc(ago(now - Date.parse(r.movedAt))) + '</span></div>' +
      '<button class="do-ov-x" data-act="close" aria-label="Close">✕</button></div></div>' +
      '<div class="do-ov-chart"><span class="do-ov-cap"><span class="do-ov-cap-k">PRICE HISTORY · <b>' + esc(sel.book.toUpperCase()) + '</b> · LAST 24H</span>' +
      '<span class="do-ov-cap-p">' + price2(sel.open) + ' → ' + price2(sel.now) + ' · ▼ ' + sel.drop.toFixed(1) + '%</span>' +
      (sel !== r ? '<button class="do-ov-back" data-act="back">Back to ' + esc(r.book) + '</button>' :
        same.length > 1 ? '<span class="do-ov-cap-r">Click a book below to see its chart</span>' : '') + '</span>' +
      chartSvg(pts, sel.open) +
      '<span class="do-ov-note">Each dot is a recorded snapshot. Dashed stretches had no snapshots; nothing is interpolated.</span></div>' +
      '<div class="do-ov-strip" style="grid-template-columns:repeat(' + same.length + ', minmax(0,1fr))">' + same.map(function (b) {
        var isSel = b === sel, own = b === r, c = b.cls || 'soft';
        return '<div class="do-ov-cell' + (isSel ? ' sel' : ' pick') + '" data-act="book" data-v="' + esc(b.book) + '"><span class="bar"></span>' +
          '<span class="do-ov-c1">' + esc(b.book) + (b.cls ? '<span class="t ' + c + '">' + c.toUpperCase() + '</span>' : '') + '</span>' +
          '<span class="do-ov-c2"><span class="n">' + price2(b.now) + '</span><span class="o">from ' + price2(b.open) + '</span></span>' +
          '<span class="do-ov-c3"><span class="d">▼ ' + b.drop.toFixed(1) + '%</span><span class="r">' + (own ? 'this row' : '') + '</span></span></div>';
      }).join('') + '</div>' +
      '<div class="do-ov-foot"><span class="do-ov-foot-l"><span class="do-ov-sum">Down 10% or more at ' + big.length + ' of ' + same.length + ' books with a flagged move on this line (' + bigSharp + ' of ' + sharpN + ' sharp).</span>' +
      '<span class="do-ov-fn">Each drop compares a book\'s own first recorded price with its own current price.</span></span></div>' +
      '</div></div>';
    ov.innerHTML = html;
  }

  // ─── events ─────────────────────────────────────────────────────────────────
  function toggle(arr, v, keepOne) {
    var i = arr.indexOf(v);
    if (i >= 0) { if (keepOne && arr.length === 1) return arr; return arr.filter(function (x) { return x !== v; }); }
    return arr.concat([v]);
  }
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act'), v = t.getAttribute('data-v'), S = st.S;
    if (t.hasAttribute('disabled') || t.getAttribute('aria-disabled') === 'true') return;
    switch (act) {
      case 'tier': S.tiers = toggle(S.tiers, v, true); break;
      case 'btype': S.btype = v; break;
      case 'win': S.win = v; break;
      case 'min': S.min = +v; break;
      case 'mk': S.mk = v === 'all' ? MARKETS.map(function (m) { return m[0]; }) : [v]; break;
      case 'menu': st.menu = st.menu === v ? null : v; break;
      case 'clickaway': st.menu = null; break;
      case 'clear':
        e.stopPropagation();
        if (v === 'book') S.books = books();
        if (v === 'starts') S.starts = 0;
        st.menu = null; break;
      case 'book':
        if (t.closest('.do-ov')) { st.drBook = v; renderModal(); return; }
        S.books = toggle(S.books, v, true); break;       // multi-select: the menu stays open
      case 'starts': S.starts = +v; st.menu = null; break;
      case 'sort': S.sort = v; st.menu = null; break;
      case 'reset': st.S = defaults(books()); st.menu = null; break;
      case 'refresh': case 'reconnect': refresh(); return;
      case 'row': st.drawer = v; st.drBook = null; st.tip = false; st.menu = null; renderModal(); return;
      case 'close': closeModal(); return;
      case 'back': st.drBook = null; renderModal(); return;
      case 'tip': st.tip = !st.tip; renderModal(); return;
      default: return;
    }
    render();
  }
  function onInput(e) {
    if (e.target.getAttribute('data-act') !== 'q') return;
    st.S.q = e.target.value; render();
  }
  function onKey(e) {
    if (e.key === 'Escape' && st.drawer) closeModal();
    var row = e.target.closest && e.target.closest('.do-row');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); st.drawer = row.getAttribute('data-v'); renderModal(); }
  }

  function setActive(on) {
    st.active = !!on;
    clearTimeout(st.timer); clearInterval(st.ticker);
    if (!st.active) { closeModal(); return; }
    render();
    load().then(function () { render(); schedule(); });
    // re-render the data-time labels ("updated 23s ago", "moved 41m ago") between reads
    st.ticker = setInterval(function () { if (!st.menu) render(); }, 5000);
  }

  function boot() {
    var btn = document.getElementById('dropsTabBtn');
    if (btn) btn.style.display = '';
    var el = root();
    if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.do-ov')) onClick(e); });
    var page = el.closest('.tabpage');
    if (page && page.classList.contains('active')) setActive(true);
  }
  window.DropsPage = { setActive: setActive, _state: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
