/* drops-page.js — TEN-294 Dropping Odds page.
 *
 * Built from the Claude Design export `design_handoff_dropping_odds` (LOCKED 2026-09-26).
 * The export's structure and values are the spec (drops-page.css); its sample data is not:
 * every row here comes from the drops endpoint, stennisfy-drops.fly.dev, which reads the
 * database once per 30 s and serves that snapshot to every viewer. This page is a reader.
 *
 * Rulings (founder card 79e9db02, 2026-09-26; .claude/rules/drops.md):
 *   Q1  a row is one selection × bookmaker; drop = (open − now) / open, shortened rows only
 *   Q2  WINDOW "Since open" is the default and means everything the feed holds (72h since card 518c56f0 Q4)
 *   TEN-427 r2 (founder 20de43fe, supersedes 518c56f0's three views): upcoming matches only; a row leaves at its start
 *   Q3  past 5 min, or with the endpoint unreachable, the export's FEED DISCONNECTED banner as drawn
 *   Q4  the pop-up plots only recorded prices; missing fields "—"
 *   777a3192 (pop-up rebuild): every recorded book quoting the selection; board-matched rows get metadata + link
 *   TEN-427 Data 7 (supersedes Q5): no Alerts, no Refresh; the list re-reads every 30 s, Reconnect is the one refetch
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
  var PH_TTL_MS = 60000;             // the box's copy of a card's price_history expires as the pop-up's does
  var H = 3600e3;

  // TEN-427 Data 3: ONE Sharp / Soft grouping, odds.md's AODDS_BOOKS (the Odds tab; Model's best-soft scan agrees):
  // Sharp = Pinnacle (both sources), Betfair Exchange, Bet105; every other book Soft. An exchange is never soft.
  var SHARP_BOOKS = { 'Pinnacle': 1, 'Pinnacle +30s': 1, 'Pinnacle (api-tennis)': 1, 'Betfair Exchange': 1, 'Bet105': 1 };
  function bookCls(n) {
    var s = String(n || ''), base = s.replace(/\s*\([^)]*\)\s*$/, '');   // a source suffix ("(Oddspapi)", "(recorded by us)") is not the book
    return SHARP_BOOKS[s] || SHARP_BOOKS[base] || /exchange|matchbook|smarkets|betdaq/i.test(base) ? 'sharp' : 'soft';
  }
  // the two alert books (the bots that write the feed), read through the one grouping
  var BOOK_CLASS = { Bet105: bookCls('Bet105'), Superbet: bookCls('Superbet') };
  // TEN-427 r2 fix 10: the drop bots record Match winner only, so it is the only market tab (no tab for a market we do
  // not record — the Alerts rule); "All markets" = the sum of the market tabs
  var MARKETS = [['mw', 'Match winner']];
  var LINE_TO_MARKET = { 'Match Winner': 'mw' };
  var WINDOWS = [['open', 'Since open'], ['12h', '12h'], ['24h', '24h'], ['48h', '48h']];
  var MIN = [[0, 'Any'], [5, '5%'], [10, '10%'], [20, '20%'], [30, '30%']];
  var STARTS = [[0, 'Any time'], [3, '3h'], [6, '6h'], [12, '12h'], [24, '24h']];
  var SORT = [['drop', 'Biggest drop'], ['recent', 'Latest move'], ['soon', 'Starting soonest']];
  // TEN-427 r2 ruling (founder 20de43fe, supersedes the Upcoming · In play · Completed views): the list is upcoming
  // matches only. A row leaves at its start (the Today's Matches card's when matched, else the vendor's), or earlier
  // when the feed marks it live (liveAt, in play, finished, a cut). A row with no start cannot be shown as upcoming.
  function isUpcoming(r, now) {
    if (r.liveAt || r.cutAt || r.status === 'in_play' || r.status === 'finished') return false;
    var t = startMs(r);
    return t != null && now != null && t > now;
  }

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
  // TEN-427 (shell R1): the drop is measured on the 2 dp prices the row SHOWS, by the site's one move formula
  // (Today's Matches move view, mxMovePct: one decimal, a half away from zero), so a reader can redo every figure.
  // A shortening price is a negative move; the drop is its size. Outside the dashboard (node) the same digits rule.
  function movePct(open, now) {
    if (typeof mxMovePct === 'function') { var m = mxMovePct(open, now); return m ? m.v : null; }   // eslint-disable-line no-undef
    if (!(open > 0) || !(now > 0)) return null;
    var o2 = Math.round(Number(Number(open).toFixed(2)) * 100), n2 = Math.round(Number(Number(now).toFixed(2)) * 100);
    if (!(o2 > 0) || !(n2 > 0)) return null;
    var q = (n2 - o2) * 1000 / o2;
    return Math.sign(q) * Math.round(Math.abs(q)) / 10;
  }
  function dropOf(open, now) { var v = movePct(open, now); return v == null ? null : (v === 0 ? 0 : -v); }

  // One row per selection × book (Q1). Repeat alerts collapse to the newest; the row's drop is
  // open → latest at that book, on the shown prices; only a shortened price is listed.
  function buildRows(feedRows) {
    var by = {};
    (feedRows || []).forEach(function (r) {
      var k = [r.playerA, r.playerB, r.side, r.book, r.line].join('\u0001');
      if (!by[k] || (Date.parse(r.detectedAt) || 0) > (Date.parse(by[k].detectedAt) || 0)) by[k] = r;
    });
    var out = [];
    Object.keys(by).forEach(function (k) {
      var r = by[k];
      var open = num(r.open && r.open.price), now = num(r.latest && r.latest.price);
      if (open == null || now == null) return;
      var drop = dropOf(open, now);
      if (!(drop > 0)) return;
      var side = r.side || '';
      var opp = side === r.playerA ? r.playerB : side === r.playerB ? r.playerA : null;
      var dropped = num(r.droppedTo && r.droppedTo.price);
      // "moved": the current price's record time when it differs from the alert price, else the alert
      var movedAt = (dropped != null && dropped !== now && r.latest && r.latest.at) ? r.latest.at : (r.droppedTo && r.droppedTo.at) || r.detectedAt;
      out.push({
        id: r.id, book: r.book, cls: bookCls(r.book), tier: tierOf(r.tier), tierRaw: r.tier,
        mk: LINE_TO_MARKET[r.line] || null, playerA: r.playerA, playerB: r.playerB, side: side, opp: opp,
        open: open, now: now, drop: drop, openAt: r.open && r.open.at, openKind: r.open && r.open.kind,
        preDrop: r.preDrop, droppedTo: r.droppedTo, latest: r.latest,
        detectedAt: r.detectedAt, movedAt: movedAt, start: r.scheduledStart || null,
        status: (r.match && r.match.status) || 'unknown', apiStatus: (r.match && r.match.apiStatus) || null,
        liveAt: (r.match && r.match.liveAt) || null, cutAt: (r.match && r.match.cutAt) || null, cutKind: (r.match && r.match.cutKind) || null,
      });
    });
    return out;
  }

  function defaults(books) {
    return { tiers: ['ATP', 'Challenger', 'ITF'], btype: 'all', books: (books || Object.keys(BOOK_CLASS)).slice(),
      win: 'open', min: 0, starts: 0, sort: 'drop', q: '', mk: 'all', surf: 'all' };
  }

  function passes(r, S, dataNow, ignoreMk) {
    if (!isUpcoming(r, dataNow)) return false;
    if (!ignoreMk && S.mk !== 'all' && r.mk !== S.mk) return false;
    if (S.tiers.indexOf(r.tier) < 0) return false;
    if (S.books.indexOf(r.book) < 0) return false;
    if (S.btype !== 'all' && r.cls !== S.btype) return false;
    if (S.win === '12h' || S.win === '24h' || S.win === '48h') {
      var hrs = parseInt(S.win, 10);
      if (!(dataNow - Date.parse(r.detectedAt) <= hrs * H)) return false;
    }
    if (S.min > 0 && !(r.drop >= S.min)) return false;
    if (S.starts > 0 && !((startMs(r) - dataNow) / H <= S.starts)) return false;   // every listed start is upcoming
    // Surface: a board-matched row's card surface; a row without one passes only "All" (never a guessed surface)
    if (S.surf && S.surf !== 'all' && r.surface !== S.surf) return false;
    var q = fold(S.q);
    if (q && fold([r.playerA, r.playerB, r.dA, r.dB, r.event].filter(Boolean).join(' ')).indexOf(q) < 0) return false;
    return true;
  }

  // a row's start: its Today's Matches card's when matched (set by the page), else the feed's scheduledStart
  function startMs(r) { if (r.cardStart != null && isFinite(r.cardStart)) return r.cardStart; var v = Date.parse(r.start); return isFinite(v) ? v : null; }
  function sortRows(list, sort, dataNow) {
    var t = function (s) { var v = Date.parse(s); return isFinite(v) ? v : null; };
    var now = dataNow == null ? Date.now() : dataNow;
    var cmp = {
      drop: function (a, b) { return b.drop - a.drop; },
      recent: function (a, b) { return (t(b.movedAt) || 0) - (t(a.movedAt) || 0); },
      // upcoming by start time, then matches whose scheduled start has passed (no live evidence either way)
      soon: function (a, b) {
        var x = startMs(a), y = startMs(b);
        var px = x == null || x < now, py = y == null || y < now;
        if (px !== py) return px ? 1 : -1;
        if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
        return px ? y - x : x - y;
      },
    }[sort] || function () { return 0; };
    return list.slice().sort(cmp);
  }

  function view(rows, S, dataNow) {
    var list = sortRows(rows.filter(function (r) { return passes(r, S, dataNow, false); }), S.sort, dataNow);
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
  // connected (green) | amber (> 90 s) | disconnected (> 5 min, or the endpoint unreachable)
  function feedState(ageS, reachable) {
    if (!reachable || ageS == null || ageS > DISCONNECTED_AFTER_S) return 'disconnected';
    return ageS > AMBER_AFTER_S ? 'amber' : 'connected';
  }

  // ─── the price-move box (founder comment 8585095a, LOCKED `handoff/Price Move Box/`, 2026-09-27) ───────
  // The Database chart type: [Y labels 52px] [plot] [end label 84px], 260px high, SVG viewBox 1000×300.
  // TEN-301 (founder, 2026-09-27): ONE continuous step line. The recorders write a price only when it changes
  // and the pollers re-check every book each cycle, so the stretch between two recorded changes is a confirmed
  // hold: the price runs flat to the next change's time, then moves vertically there. Never a diagonal slide,
  // never a diagonal or dashed piece between recorded prices. The solid line stops at the end data rule 25 names; from
  // there TEN-427 r3 item 9 carries the last price on, flat and dashed, to the axis end (boxChart `ext`).
  var MIN_SPAN_MS = 60 * 60e3;         // the X axis never spans less than an hour
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // TEN-427 Data 6: every clock on the page reads the member's zone (Account settings → stennisfy.tz, newsTz), else
  // the browser zone — the header Updated, the banner's "as of", row times, the box's start line and its time axis.
  function tzName() { try { return (typeof newsTz === 'function' && newsTz()) || undefined; } catch (e) { return undefined; } }   // eslint-disable-line no-undef
  function zp(t) {
    var f = function (z) {
      var o = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: z, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
      return o;
    };
    var o; try { o = f(tzName()); } catch (e) { o = f(undefined); }
    return { hh: o.hour === '24' ? '00' : o.hour, mm: o.minute, d: +o.day, m: +o.month - 1, y: +o.year };
  }
  function hm(t) { var p = zp(t); return p.hh + ':' + p.mm; }
  function dayOf(t) { var p = zp(t); return p.d + ' ' + MON[p.m]; }
  function clock(iso) { var t = typeof iso === 'number' ? iso : Date.parse(iso); return isFinite(t) ? hm(t) : '—'; }
  // data rule 25: where the solid line ends (t), where the axis ends (axisT) and what the end label says
  //   a row cut at the live start -> "Last pre-match", the line carried to the start (the price in force then),
  //     or to the book's last sighting when it stopped quoting before it; the axis ends where that line does (no
  //     dashed carry past a book that stopped quoting — drops.md, review of 52050426c)
  //   otherwise -> "Now" (TEN-427 r3 item 8, founder 393874e7: the table head's word, the same snapshot — the book's
  //     latest price); the solid line ends at the book's last snapshot (or a later confirmed sighting of it) and the
  //     axis runs to now for EVERY book (r3 item 9): boxChart carries that price flat and dashed to the axis end
  function endOf(series, seen, cutAt, now) {
    var last = series[series.length - 1];
    if (!last) return null;
    var cut = cutAt ? Date.parse(cutAt) : NaN;
    var seenOk = seen != null && isFinite(seen);
    if (isFinite(cut)) {
      var ct = seenOk && seen < cut ? Math.max(last.t, seen) : Math.max(last.t, cut);
      return { label: 'Last pre-match', t: ct, v: last.v, axisT: ct, confirmed: seenOk };
    }
    var lt = seenOk && seen > last.t ? seen : last.t;
    return { label: 'Now', t: lt, v: last.v, axisT: now != null && now > lt ? now : lt, confirmed: lt > last.t };
  }
  // Time axis 1a (TEN-427, the Database chart type): X labels are HH:MM only — 5 (0/25/50/75/100%) from 2 h up,
  // 3 (0/50/100%) below — and the day sits in a band under them, split at midnight in the member's zone.
  function axisTicks(a0, a1) {
    var span = a1 - a0;
    return (span >= 2 * H ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]).map(function (f) {
      var t = a0 + f * span;
      return { x: (f * 1000).toFixed(1), left: (f * 100) + '%', tf: f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)', label: hm(t) };
    });
  }
  // the day bands under the ticks: one per calendar day the axis touches (member's zone), each as wide as its share
  // of the axis; `splits` = the midnights inside the axis (x in 0..1000), drawn as the plot's day split
  function dayBands(a0, a1) {
    var span = a1 - a0, cuts = [], key = function (t) { var p = zp(t); return p.y * 400 + p.m * 32 + p.d; };
    if (!(span > 0)) return { bands: [{ w: '100%', label: dayOf(a0) }], splits: [] };
    var step = 15 * 60e3, prev = key(a0);
    for (var t = a0 + step; t < a1 + step; t += step) {
      var tt = Math.min(t, a1), k = key(tt);
      if (k !== prev) {
        var lo = tt - step, hi = tt;     // the minute the day changes
        while (hi - lo > 60e3) { var mid = lo + Math.floor((hi - lo) / 2 / 60e3) * 60e3; if (mid <= lo) break; if (key(mid) === prev) lo = mid; else hi = mid; }
        if (hi > a0 && hi < a1) cuts.push(hi);
        prev = k;
      }
      if (tt === a1) break;
    }
    var edges = [a0].concat(cuts, [a1]), bands = [];
    for (var i = 0; i + 1 < edges.length; i++) bands.push({ w: ((edges[i + 1] - edges[i]) / span * 100).toFixed(2) + '%', label: dayOf(edges[i]) });
    return { bands: bands, splits: cuts.map(function (c) { return ((c - a0) / span * 1000).toFixed(1); }) };
  }
  // the chart's geometry (pY in 0..1 from the top; x in 0..1000 over the axis)
  // holes: [[from, to], …] ms — stretches the book was recorded NOT quoting (odds.md: an api-tennis `meta.gaps`
  // entry, the book out of the feed or suspended). A hold is never drawn across one: the only breaks in the line.
  function boxChart(series, openV, end, holes) {
    var rec = (series || []).filter(function (p) { return isFinite(p.t) && p.v != null; });
    var first = rec[0], last = rec[rec.length - 1];
    var endT = end && end.t > last.t ? end.t : last.t;
    // one recorded price: a line only when a later sighting confirmed it (item 5); otherwise the dot alone
    // (a cut row's carry to the start is not a sighting)
    var single = rec.length < 2 && !(end && end.confirmed && endT > first.t);
    // the open chip sits at the book's first price: keep it inside the Y range
    var vs = rec.map(function (p) { return p.v; }).concat(!single && openV != null ? [openV] : []);
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi - lo < 0.1) { lo -= 0.1; hi += 0.1; }
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    lo = Math.max(1, lo);   // TEN-427 r2 fix 11: decimal odds never go under 1.00, so neither does the axis
    var pY =function (v) { return (hi - v) / (hi - lo); };
    // the axis: first seen -> the end's axis time (now, or the live start), at least an hour (padded before first seen)
    var a1 = Math.max(endT, end && end.axisT != null ? end.axisT : endT), a0 = Math.min(first.t, a1 - MIN_SPAN_MS);
    var fx = function (t) { return (t - a0) / (a1 - a0) * 1000; };
    var P = function (t, v) { return fx(t).toFixed(1) + ',' + (pY(v) * 300).toFixed(1); };
    // the step line: each price held flat from its change to the next change (the last to the line's end),
    // joined by a vertical move at each change's time; a hole removes the hold inside it
    var pieces = [];
    rec.forEach(function (p, k) { pieces.push({ s: p.t, e: k + 1 < rec.length ? rec[k + 1].t : endT, v: p.v }); });
    (holes || []).forEach(function (h) {
      var hs = h[0], he = h[1] == null ? Infinity : h[1];
      if (!(he > hs)) return;
      pieces = [].concat.apply([], pieces.map(function (q) {
        if (q.e <= hs || q.s >= he) return [q];
        var out = [];
        if (q.s < hs) out.push({ s: q.s, e: hs, v: q.v });
        if (q.e > he) out.push({ s: he, e: q.e, v: q.v });
        return out;
      }));
    });
    var lines = [], cur = null, prevE = null;
    pieces.forEach(function (q) {
      if (cur && q.s === prevE) cur.push(P(q.s, q.v));
      else { cur = [P(q.s, q.v)]; lines.push(cur); }
      cur.push(P(q.e, q.v));
      prevE = q.e;
    });
    lines = lines.map(function (l) { return l.filter(function (p, k) { return k === 0 || p !== l[k - 1]; }); });
    // TEN-427 r3 item 9 (founder 393874e7): ONE rule for every book — from the solid line's end (the last snapshot, or a
    // later confirmed sighting of it) the last price runs on flat and DASHED to the axis end (now), so every book in the
    // box ends on the same axis; nothing interpolated. A cut row ("Last pre-match") never carries: its axis ends where its
    // line does. The carry is a hold too, so it stops where a recorded not-quoting stretch (a hole) begins.
    var extT = end && end.label === 'Last pre-match' ? endT : a1;
    (holes || []).forEach(function (h) {
      var he = h[1] == null ? Infinity : h[1];
      if (he > endT && h[0] < extT) extT = Math.max(endT, h[0]);
    });
    var ext = !single && extT > endT ? { x1: fx(endT).toFixed(1), x2: fx(extT).toFixed(1), y: (pY(last.v) * 300).toFixed(1) } : null;
    var endP = pY(last.v) * 100;
    var db = single ? { bands: [{ w: '100%', label: dayOf(last.t) }], splits: [] } : dayBands(a0, a1);
    return {
      single: single, bands: db.bands, splits: db.splits, ext: ext,
      gridY: [0, 0.25, 0.5, 0.75, 1].map(function (g) { return { y: (g * 300).toFixed(1), top: (g * 100) + '%', label: (hi - g * (hi - lo)).toFixed(2) }; }),
      vticks: [0, 250, 500, 750, 1000],
      ticks: single ? [{ x: '1000.0', left: '100%', tf: 'translateX(-100%)', label: hm(last.t) }] : axisTicks(a0, a1),
      lines: single ? [] : lines.map(function (l) { return l.join(' '); }),
      area: single ? '' : lines.map(function (l) {
        return 'M' + l.join(' L') + ' L' + l[l.length - 1].split(',')[0] + ',300 L' + l[0].split(',')[0] + ',300 Z';
      }).join(' '),
      // founder 33107f2a (11 Oct): ONE recorded price, held by a later sighting, has no open to name — no Open chip,
      // as the reference; the chart says what the table does ("— → x.xx · one price"): the flat line and the Now plate only
      hasOpen: !single && openV != null && rec.length > 1,
      openTop: openV != null ? (pY(openV) * 100).toFixed(2) + '%' : '0%',
      openLeft: single ? '0%' : (fx(first.t) / 10).toFixed(2) + '%',
      endDot: endP.toFixed(2) + '%',
      endLeft: single ? '100%' : (fx(ext ? extT : endT) / 10).toFixed(2) + '%',   // the dot sits where the drawn price ends
      endTop: Math.min(90, Math.max(10, endP)).toFixed(2) + '%',
      endLbl: last.v.toFixed(2),
      endWord: end ? end.label : 'Now'
    };
  }
  // table: "Pinnacle +30s" -> Pinnacle / +30s; "Pinnacle (api-tennis)" -> Pinnacle / api-tennis (the handoff's split)
  function bookSplit(n) {
    var s = String(n || '');
    return { name: s.replace(/\s*[(+].*$/, ''), sub: (s.match(/[(+].*$/) || [''])[0].replace(/^\(|\)$/g, '').trim() };
  }
  // drop cell (data rule 27): shortened red ▼ by size, unknown "—"; flat and lengthened read as the shell move view does
  // (TEN-427 r3 item 7, founder 393874e7; Today's Matches mxMovePct: a drift is "+3.8%" in --pos, no move the muted
  // "±0.0%") — the same move on the shown prices (d = −move), never a ▲ under the DROP head. A book with ONE recorded
  // price has no move: the reference's "one price" (Dropping Odds v2: open "—", drop "one price" grey), never "0.0%"
  function r1(d) { return parseFloat(d.toFixed(1)); }   // exactly the figure shown
  function zeroTxt() { var z = typeof mxMovePct === 'function' ? mxMovePct(1, 1) : null; return z ? z.text : '±0.0%'; }   // eslint-disable-line no-undef
  function dropCell(d, onePrice) {
    if (onePrice) return { txt: 'one price', c: 'muted' };
    if (d == null || !isFinite(d)) return { txt: '—', c: 'muted' };
    if (Math.abs(d) < 0.05) return { txt: zeroTxt(), c: 'muted' };
    if (d < 0) return { txt: '+' + Math.abs(d).toFixed(1) + '%', c: 'pos' };
    return { txt: '▼ ' + d.toFixed(1) + '%', c: r1(d) >= 10 ? 'big' : 'small' };   // the threshold reads the figure shown
  }
  // start line (data rule 28)
  // every listed row is upcoming (the r2 ruling): the start and its countdown
  function startLine(r, now) {
    var t = startMs(r);
    if (t == null) return null;
    var mins = Math.max(0, Math.floor((t - now) / 60000));
    return { start: hm(t), cd: 'in ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' };
  }

  // ─── the price-move pop-up's books (founder comment 777a3192, decisions 1–4, 7) ───────────────
  // Every book we record a pre-match price for, on this selection. Sources, in order:
  //   'board'    a board-matched card's TEN-295 chart shard: Pinnacle, Bet105, Superbet, Betfair Exchange (house names);
  //   'endpoint' the drops endpoint's `lines` (tools/ten294-drops-lines.sql): Bet105, Superbet, Betfair Exchange;
  //   'flagged'  neither available: only the books with a flagged move (drop rows) — the summary says so.
  // Sharp/Soft is the page's ONE grouping (bookCls above, odds.md AODDS_BOOKS), never the data's.
  var STRIP_CLASS = {};
  Object.keys(SHARP_BOOKS).forEach(function (b) { STRIP_CLASS[b] = 'sharp'; });
  // the dashboard's AODDS_ORDER (Sharp then Soft, stable; never re-sorted by drop)
  var BOOK_ORDER = ['Pinnacle +30s', 'Pinnacle (api-tennis)', 'Bet105', 'Betano', '1xBet', 'BetVictor', 'Betfair Sportsbook (api-tennis)',
    'Marathon', 'bet365 (api-tennis)', 'Sbobet', 'William Hill', 'Superbet', 'Betfair Exchange'];
  var EXCHANGES = { 'Betfair Exchange': true };      // no margin on an exchange (decision 4)
  function stripName(n) { return String(n || '').replace(/\s*\(recorded by us\)\s*$/i, ''); }
  // TEN-427 r2 fix 13: the box names a book as the Odds tab does — the dashboard's one config AODDS_BOOKS (odds.md: one
  // row per bookmaker, plain name, the source only in the tooltip). The stored label "Pinnacle +30s" is Pinnacle's own
  // prices relayed by Oddspapi 30 s late (AODDS_ALIAS → "Pinnacle +30s (Oddspapi)"); "Pinnacle (api-tennis)" is the same
  // book via api-tennis. A book with two sources is ONE line, from the first source in its list with a price (never
  // spliced, as the Odds tab). Outside the dashboard (no config) a label passes through unchanged.
  function houseOf(src) {
    var B = null, A = {};
    try { B = typeof AODDS_BOOKS !== 'undefined' ? AODDS_BOOKS : null; A = typeof AODDS_ALIAS !== 'undefined' ? AODDS_ALIAS : {}; } catch (e) { B = null; }   // eslint-disable-line no-undef
    var s = A[src] || src;
    for (var i = 0; B && i < B.length; i++) {
      var k = B[i].sources.indexOf(s);
      if (k < 0) k = B[i].sources.indexOf(String(s).replace(/\s*\(recorded by us\)\s*$/i, '') + ' (recorded by us)');
      if (k >= 0) return { name: B[i].name, rank: k, order: i, src: s };
    }
    return { name: stripName(src), rank: 0, order: null, src: s };
  }
  function bookOrder(name) {
    var B = null;
    try { B = typeof AODDS_BOOKS !== 'undefined' ? AODDS_BOOKS : null; } catch (e) { B = null; }   // eslint-disable-line no-undef
    for (var i = 0; B && i < B.length; i++) if (B[i].name === name) return i;
    var j = BOOK_ORDER.indexOf(name);
    return j < 0 ? BOOK_ORDER.length + (B ? B.length : 0) : j;
  }
  // the SQL's drops_api.nk(): surname part of "Last, First", its last token, lower-case, a–z only
  function nk(n) {
    var s = String(n == null ? '' : n);
    if (s.indexOf(',') >= 0) s = s.split(',')[0];
    s = s.replace(/^.*\s/, '').toLowerCase();
    return s.replace(/[^a-z]/g, '');
  }
  function lineKey(r) { var a = nk(r.playerA), b = nk(r.playerB); return (a < b ? a + '|' + b : b + '|' + a) + '|' + nk(r.side); }
  function tsPoints(list) {   // [[at, price], …] -> [{t, v}] sorted, real prices only
    return (list || []).map(function (p) { return { t: Date.parse(p[0]), v: num(p[1]) }; })
      .filter(function (p) { return isFinite(p.t) && p.v != null; }).sort(function (a, b) { return a.t - b.t; });
  }
  function rowPoints(r) {
    return [[r.openAt, r.open], [r.preDrop && r.preDrop.at, r.preDrop && r.preDrop.price],
      [r.droppedTo && r.droppedTo.at, r.droppedTo && r.droppedTo.price], [r.latest && r.latest.at, r.now]];
  }
  function marginOf(book, side, other) {
    if (EXCHANGES[book] || !side.length || !other.length) return null;
    var a = side[side.length - 1].v, b = other[other.length - 1].v;
    return a > 0 && b > 0 ? (1 / a + 1 / b - 1) * 100 : null;
  }
  // A board shard book's last confirmed sighting of its line (TEN-301), where the shard's check is per line:
  //   api-tennis — the collector re-reads every event's odds each poll and logs a book leaving the feed as a gap,
  //     so `checkedAt` confirms the line unless a gap is still open (then its start is the last sighting);
  //   Oddspapi (Pinnacle +30s) — `checkedAt` is a read of this fixture's own tick history.
  // Kibl / odds-api.io `checkedAt` is a whole-book poll, not a sighting of this line: those books take the
  // endpoint's per-line `lastSeen` instead (above), else none.
  function shardSeen(meta, lastT) {
    if (!meta || (meta.source !== 'api-tennis' && meta.source !== 'Oddspapi')) return null;
    var ck = Date.parse(meta.checkedAt);
    var open = (meta.gaps || []).filter(function (g) { return g && g[1] == null; })[0];
    if (open) ck = isFinite(ck) ? Math.min(ck, Date.parse(open[0])) : Date.parse(open[0]);
    return isFinite(ck) && lastT != null && ck >= lastT ? ck : null;
  }
  // stretches a shard book was recorded not quoting (odds.md: api-tennis gaps); an open one ends the line (shardSeen).
  // odds.md also writes a collector outage (> 15 min between heartbeats) as a gap on every line open then. An
  // outage is no checks at all, not a book leaving the feed, and the founder ruled it is never a break (TEN-301):
  // a closed gap carried identically by EVERY api-tennis book quoting when it began (two or more) is that outage.
  function shardHoles(meta, allMeta) {
    var closed = function (m) {
      return ((m && m.gaps) || []).filter(function (g) { return g && g[1] != null && isFinite(Date.parse(g[0])) && isFinite(Date.parse(g[1])); });
    };
    var api = Object.keys(allMeta || {}).map(function (k) { return allMeta[k]; }).filter(function (m) { return m && m.source === 'api-tennis' && m.firstSeen; });
    return closed(meta).filter(function (g) {
      if (!meta || meta.source !== 'api-tennis') return true;
      var from = Date.parse(g[0]);
      var quoting = api.filter(function (m) {
        return Date.parse(m.firstSeen) < from && !(m.gaps || []).some(function (h) { return h && Date.parse(h[0]) < from && (h[1] == null || Date.parse(h[1]) > from) && !(h[0] === g[0] && h[1] === g[1]); });
      });
      var carriers = quoting.filter(function (m) { return (m.gaps || []).some(function (h) { return h && h[0] === g[0] && h[1] === g[1]; }); });
      return !(quoting.length >= 2 && carriers.length === quoting.length);
    }).map(function (g) { return [Date.parse(g[0]), Date.parse(g[1])]; });
  }
  // TEN-427 Data 4: the Today's Matches pop-up rows stand for the Bet105 line only when they read as the Bet105 row
  // does: the same open and a last pre-cut row equal to its now, at the 2 dp shown. No Bet105 row: nothing to contradict.
  function phAgrees(side, row) {
    if (!side.length) return false;
    if (!row) return true;
    return price2(side[0].v) === price2(row.open) && price2(side[side.length - 1].v) === price2(row.now);
  }
  // ctx: { rows, line (endpoint), chart (shard chart), cardSide ('p1'|'p2'|null) }
  function modalBooks(r, ctx) {
    ctx = ctx || {};
    var raw = {}, source = 'flagged';
    // card 518c56f0 Q2: nothing at or after the live start is a pre-match price, from any source
    var cut = ctx.cutAt ? Date.parse(ctx.cutAt) : NaN;
    var pre = function (list) { return isFinite(cut) ? list.filter(function (p) { return p.t < cut; }) : list; };
    var ref = isFinite(cut) && ctx.now != null ? Math.min(ctx.now, cut) : ctx.now;   // a finished line's books are judged at its cut
    if (ctx.chart && ctx.chart.books && ctx.cardSide) {
      Object.keys(ctx.chart.books).forEach(function (n) {
        var b = ctx.chart.books[n] || {}, os = ctx.cardSide === 'p1' ? 'p2' : 'p1';
        var side = pre(tsPoints(b[ctx.cardSide]));
        if (!side.length) return;
        var hb = houseOf(n), had = raw[hb.name];
        if (had && had.rank <= hb.rank) return;   // one line per book: the first source in its list with a price
        raw[hb.name] = { side: side, other: pre(tsPoints(b[os])), first: side[0], meta: (ctx.chart.meta || {})[n] || null, rank: hb.rank, src: hb.src };
      });
      if (Object.keys(raw).length) source = 'board';
    }
    if (source === 'flagged' && ctx.line && ctx.line.books) {
      Object.keys(ctx.line.books).forEach(function (n) {
        var b = ctx.line.books[n] || {}, side = pre(tsPoints(b.side)), f = b.first ? pre(tsPoints([b.first]))[0] || null : null;
        var seenAt = Date.parse(b.lastSeen);
        // a book whose last sighting is older than the window has stopped quoting: left out, never shown as current
        if (ref != null && isFinite(seenAt) && ref - seenAt > 24 * H) return;
        if (side.length) raw[stripName(n)] = { side: side, other: pre(tsPoints(b.other)), first: f || side[0], seen: isFinite(seenAt) ? seenAt : null, truncated: b.truncated === true };
      });
      if (Object.keys(raw).length) source = 'endpoint';
    }
    if (source === 'flagged') {
      (ctx.rows || []).forEach(function (x) {
        if (x.playerA === r.playerA && x.playerB === r.playerB && x.side === r.side && x.mk === r.mk && x !== r) {
          raw[x.book] = { side: pre(tsPoints(rowPoints(x))), other: [], first: { t: Date.parse(x.openAt), v: x.open }, row: x };
        }
      });
    }
    // the feed's row for each book on this selection (buildRows keeps one per selection × book); the box's own row
    // for its own book. A book with a row reads exactly as that row in EVERY box opened on the selection (Q1).
    var rowOf = {};
    (ctx.rows || []).forEach(function (x) {
      if (x !== r && x.playerA === r.playerA && x.playerB === r.playerB && x.side === r.side && x.mk === r.mk) rowOf[x.book] = x;
    });
    rowOf[r.book] = r;
    // TEN-427 Data 4 — ONE chart source with Today's Matches: when the board card's book is Bet105, the Bet105 line is
    // the card's odds-movement pop-up rows (price-history-box.js: the price_history RPC, sideRows + changesOnly, cut at
    // the card's start) — only when they AGREE with the Bet105 row: the same open, and the last pre-cut row = the
    // row's now, both at 2 dp. Otherwise the line is the feed's own points (the chart, end plate, table and header of
    // one box never disagree), and the choice is the same in a box opened from another book's row. ctx.ph = { side, other } as [{t, v}].
    var phSide = ctx.ph && ctx.ph.side ? pre(ctx.ph.side) : [];
    var phMismatch = false;
    if (phSide.length) {
      if (phAgrees(phSide, rowOf.Bet105)) {
        var prevB = raw.Bet105 || {}, prevLast = prevB.side && prevB.side.length ? prevB.side[prevB.side.length - 1].v : null;
        // a sighting confirms the price it saw: carried over only when the earlier line ended on the pop-up's last price
        var carry = prevB.seen != null && prevLast != null && price2(prevLast) === price2(phSide[phSide.length - 1].v);
        raw.Bet105 = { side: phSide, other: pre(ctx.ph.other || []), first: phSide[0], ph: true, seen: carry ? prevB.seen : null, meta: null };
        if (source === 'flagged') source = 'board';
      } else phMismatch = true;
    }
    Object.keys(rowOf).forEach(function (bk) {
      var x = rowOf[bk], b = raw[bk] || { other: [] }, seen = {};
      b.margin = marginOf(bk, b.side || [], b.other || []);   // the source's own pair, never the feed's fresher side
      var srcLast = b.side && b.side.length ? b.side[b.side.length - 1].v : null;
      if (srcLast == null || Math.abs(srcLast - x.now) > 0.005) b.margin = null;   // a pair older than the price shown is not its margin
      // a truncated source's series starts at its oldest SENT point: row points older than that would open a
      // false gap across a stretch that was recorded but not sent (review of bcee4794)
      var sentFrom = b.truncated && b.side && b.side.length ? b.side[0].t : -Infinity;
      // the pop-up's rows ARE the recorded snapshots (TEN-427 Data 4): the alert's own points are not spliced in
      var rowPts = b.ph ? [] : pre(tsPoints(rowPoints(x))).filter(function (p) { return p.t >= sentFrom; });
      // the line runs from the row's open to the row's now: a source tick before the open or after the now the row
      // does not show is left out, so the chart's first point and end plate are the table's "from" and NOW
      var oT = Date.parse(x.openAt), lT = Date.parse(x.latest && x.latest.at);
      var inRow = function (p) {
        if (isFinite(oT) && (p.t < oT || (p.t === oT && Math.abs(p.v - x.open) > 0.005))) return false;
        return !(isFinite(lT) && (p.t > lT || (p.t === lT && Math.abs(p.v - x.now) > 0.005)));
      };
      b.side = (b.ph ? b.side || [] : (b.side || []).filter(inRow)).concat(rowPts).filter(function (p) {
        var k = p.t + '|' + p.v; if (seen[k]) return false; seen[k] = 1; return true;
      }).sort(function (a, c) { return a.t - c.t; });
      b.first = { t: Date.parse(x.openAt), v: x.open };
      b.nowOverride = { t: Date.parse(x.latest && x.latest.at), v: x.now };
      b.row = x;
      raw[bk] = b;
    });
    var out = Object.keys(raw).map(function (n) {
      var b = raw[n], isOwn = n === r.book;
      // the chart starts at the book's first recorded price (opening → now); a first price the series
      // does not carry is added as its own recorded point, never interpolated
      // (a truncated endpoint series is not: its unsent stretch would read as a gap with no snapshots)
      if (!b.truncated && b.first && isFinite(b.first.t) && b.first.v != null && b.side && b.side.length && b.first.t < b.side[0].t) b.side = [b.first].concat(b.side);
      var now = b.nowOverride || b.side[b.side.length - 1];
      var first = b.first;
      var drop = first && first.v && now && now.v ? dropOf(first.v, now.v) : null;   // on the shown prices, as the rows
      // the book's last confirmed sighting (data rule 25): its own source's, else the endpoint line's for that book
      // (a board shard's series borrows the endpoint's sighting only when the endpoint's latest price IS the
      // shard's last price: a confirmation belongs to the price it confirmed — review of a37fc857)
      var lb = ctx.line && ctx.line.books && (ctx.line.books[n] || ctx.line.books[n + ' (recorded by us)']);
      var lbLast = lb && lb.side && lb.side.length ? num(lb.side[lb.side.length - 1][1]) : null;
      var bLast = b.side && b.side.length ? b.side[b.side.length - 1].v : null;
      var seenAt = b.seen != null ? b.seen
        : lb && isFinite(Date.parse(lb.lastSeen)) && lbLast != null && bLast != null && Math.abs(lbLast - bLast) < 0.005 ? Date.parse(lb.lastSeen)
        : shardSeen(b.meta, b.side && b.side.length ? b.side[b.side.length - 1].t : null);
      if (seenAt != null && isFinite(cut)) seenAt = Math.min(seenAt, cut - 1);
      return { book: n, src: b.src && b.src !== n ? b.src : null, cls: bookCls(n), own: isOwn, ph: !!b.ph, first: first, now: now, seen: seenAt, holes: shardHoles(b.meta, ctx.chart && ctx.chart.meta),
        opener: !!b.row && b.row.openKind === 'book opener', single: !b.side || b.side.length < 2,   // one recorded price: no move
        drop: b.row ? b.row.drop : drop, series: b.side, other: b.other, truncated: !!b.truncated, margin: b.row ? b.margin : marginOf(n, b.side, b.other) };
    });
    var rank = function (b) { return b.cls === 'sharp' ? 0 : 1; };
    var pos = function (b) { return bookOrder(b.book); };
    out.sort(function (a, b) { return rank(a) - rank(b) || pos(a) - pos(b) || a.book.localeCompare(b.book); });
    var big = out.filter(function (b) { return b.drop != null && parseFloat(b.drop.toFixed(1)) >= 10; });   // as shown (one decimal)
    var sharp = out.filter(function (b) { return b.cls === 'sharp'; });
    return { source: source, phMismatch: phMismatch, books: out, n: big.length, m: out.length,
      p: big.filter(function (b) { return b.cls === 'sharp'; }).length, q: sharp.length };
  }
  function summaryText(mb) {
    var what = mb.source === 'flagged' ? 'books with a flagged move on this line' : 'books we record quoting this line';
    return 'Down 10% or more at ' + mb.n + ' of ' + mb.m + ' ' + what + ' (' + mb.p + ' of ' + mb.q + ' sharp).';
  }
  // Opening → now (bef04c62 item 2): the axis spans this book's first recorded price to its latest one.
  function seriesPoints(series) {
    var s = (series || []).filter(function (p) { return isFinite(p.t) && p.v != null; }).slice().sort(function (a, b) { return a.t - b.t; });
    if (!s.length) return [];
    var t0 = s[0].t, span = s[s.length - 1].t - t0;
    return s.map(function (p) { return { t: p.t, fr: span > 0 ? (p.t - t0) / span : 1, v: p.v }; });
  }

  // Avatar key: an exact, unordered two-player match against today's board (matches.json names
  // are "D. Medvedev"). Both players must match one board card, and only one card may match,
  // or the row keeps the export's inner-tone fallback — never a guessed face.
  // TEN-427 r2 fix 8: the site's name canon (the dashboard's ocsNfd: accents, case, dots, hyphens and apostrophes
  // folded), so "Carreno Busta" = "Carreno-Busta" and "Mccormick" = "McCormick"; outside the dashboard the same folds
  function canonToks(n) {
    var s;
    try { s = typeof ocsNfd === 'function' ? ocsNfd(n) : null; } catch (e) { s = null; }   // eslint-disable-line no-undef
    if (s == null) s = fold(n).replace(/[.,\-‐-―'‘’ʼ]/g, ' ');
    return String(s).split(/\s+/).filter(Boolean);
  }
  function nameSig(n) {
    var t = canonToks(n);
    return t.length ? t[0][0] + '|' + t[t.length - 1] : null;
  }
  function boardKeyFor(r, board) {
    var a = nameSig(r.playerA), b = nameSig(r.playerB), s = nameSig(r.side);
    if (!a || !b || !s) return null;
    var st = Date.parse(r.start);
    var hits = (board || []).filter(function (m) {
      var x = nameSig(m.p1), y = nameSig(m.p2);
      if (!((x === a && y === b) || (x === b && y === a))) return false;
      // the same event only: a board card dated within 36 h of the row's start (the board keeps past days; a vendor's
      // start can sit 18 h off the card's — Kibl listed Khachanov v Mannarino at 22:00Z, the card 04:00Z)
      var cd = Date.parse((m.date || '') + 'T12:00:00Z');
      return !(isFinite(st) && isFinite(cd) && Math.abs(cd - st) > 36 * H);
    });
    if (hits.length !== 1) return null;
    var m = hits[0];
    var key = nameSig(m.p1) === s ? m.p1Key : nameSig(m.p2) === s ? m.p2Key : null;
    return key == null ? null : { key: String(key), photoName: nameSig(m.p1) === s ? m.p1 : m.p2, card: m,
      cardSide: nameSig(m.p1) === s ? 'p1' : 'p2' };
  }
  // r2 fix 8: a feed name -> its search-index entry (player-index.json, the site's player search), on the canon's words in
  // any order (api-tennis scrambles name order: "Luis Hernandez Ramirez Sergio"); a name two keys share is no key
  function nameIndex(idx) {
    var map = {};
    (idx || []).forEach(function (p) {
      var k = canonToks(p && p.name).sort().join(' ');
      if (k) map[k] = map[k] === undefined ? { key: String(p.key), name: String(p.name) } : null;
    });
    return map;
  }
  function indexHit(n, map) { var k = canonToks(n).sort().join(' '); return (k && map && map[k]) || null; }
  // the index's spelling (casing, accents, hyphens) in the feed's word order, then the site's short form
  // (abbrev = the dashboard's ppAbbrevName, Player Profile's): "Tristan Mccormick" -> "T. McCormick"
  function shortName(n, hit, abbrev) {
    var s = String(n == null ? '' : n).trim();
    if (hit && hit.name) {
      var c = function (x) { return canonToks(x).join(' '); };
      if (c(hit.name) === c(s)) s = hit.name;
      else {
        var words = hit.name.split(/\s+/);
        s = s.split(/\s+/).map(function (w) { for (var i = 0; i < words.length; i++) if (c(words[i]) === c(w)) return words[i]; return w; }).join(' ');
      }
    }
    return abbrev ? abbrev(s) : s;
  }
  // TEN-427 Data 5: a row's display strings. Event and surface exist only on a board card matched as above (the feed
  // carries neither); names are the shared formatter's (h.playerName = newsPlayerName) on the player's key — the card's
  // key, else h.keyOf (one exact search-index name) — else the feed's spelling. h.eventName = sfEventName.
  function surfLabel(s) {
    s = String(s || '').trim().toLowerCase();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
  }
  function rowMeta(r, board, h) {
    h = h || {};
    var hit = null;
    try { hit = boardKeyFor(r, board || []); } catch (e) { hit = null; }
    var card = hit ? hit.card : null;
    var keyFor = function (n) {
      if (card) {
        var s = nameSig(n);
        if (s && nameSig(card.p1) === s && card.p1Key != null) return String(card.p1Key);
        if (s && nameSig(card.p2) === s && card.p2Key != null) return String(card.p2Key);
      }
      return h.keyOf ? h.keyOf(n) : null;
    };
    // every name through the shared formatter (r2 fix 8): the profile's name on the key, else the short form of the
    // index's spelling (h.shortName = ppAbbrevName), else the short form of the feed's
    var nm = function (n) {
      if (n == null || n === '') return null;
      var k = keyFor(n), short = h.shortName ? h.shortName(n, k) : String(n);
      var d = k != null && h.playerName ? h.playerName(k, short) : null;
      return d || short || String(n);
    };
    return { hit: hit, card: card, cardSide: hit ? hit.cardSide : null,
      event: card && card.tour ? (h.eventName ? (h.eventName(card.tour) || String(card.tour)) : String(card.tour)) : null,
      surface: card ? surfLabel(card.surface) : null,
      a: nm(r.playerA), b: nm(r.playerB), side: nm(r.side), opp: nm(r.opp) };
  }
  // the Bet105 line from the Today's Matches pop-up's own rows (price-history-box.js `sideRows` + `changesOnly`,
  // after the same cuts as its `model`: the card's start, and on a Completed card its Close sighting) —
  // PHB = window.PriceHistoryBox, nk = ocsNameKey
  function phSeries(PHB, payload, nk, card, side, startAt, closeAt) {
    if (!PHB || !payload || !card || !side) return null;
    var s0 = startAt ? Date.parse(startAt) : NaN, c0 = closeAt ? Date.parse(closeAt) : NaN;
    var cut = isFinite(s0) && isFinite(c0) ? Math.min(s0, c0) : isFinite(c0) ? c0 : s0;
    var conv = function (who) {
      var rows = PHB.sideRows(payload, nk(card[who]), nk);
      if (isFinite(cut)) rows = rows.filter(function (x) { return x.at <= cut; });
      return PHB.changesOnly(rows).map(function (x) { return { t: x.at, v: x.price }; });
    };
    return { side: conv(side), other: conv(side === 'p1' ? 'p2' : 'p1') };
  }

  var PURE = { BOOK_CLASS: BOOK_CLASS, MARKETS: MARKETS, WINDOWS: WINDOWS, buildRows: buildRows, defaults: defaults,
    passes: passes, sortRows: sortRows, view: view, ago: ago, feedState: feedState,
    boardKeyFor: boardKeyFor, tierOf: tierOf, AMBER_AFTER_S: AMBER_AFTER_S, DISCONNECTED_AFTER_S: DISCONNECTED_AFTER_S,
    ENDPOINT: ENDPOINT, STRIP_CLASS: STRIP_CLASS, modalBooks: modalBooks, summaryText: summaryText, lineKey: lineKey, nk: nk,
    seriesPoints: seriesPoints, marginOf: marginOf, MIN_SPAN_MS: MIN_SPAN_MS, BOOK_ORDER: BOOK_ORDER,
    boxChart: boxChart, endOf: endOf, shardHoles: shardHoles, bookSplit: bookSplit, dropCell: dropCell, startLine: startLine,
    bookCls: bookCls, dropOf: dropOf, dayBands: dayBands, clock: clock, phSeries: phSeries, phAgrees: phAgrees, rowMeta: rowMeta, surfLabel: surfLabel,
    isUpcoming: isUpcoming, houseOf: houseOf, nameIndex: nameIndex, indexHit: indexHit, shortName: shortName, canonToks: canonToks };
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
  // TEN-427 Data 3: the Bookmaker menu lists the books actually in the data, Sharp first (the one grouping)
  function books() {
    var set = {};
    st.rows.forEach(function (r) { set[r.book] = 1; });
    var order = function (b) { return bookCls(b) === 'sharp' ? 0 : 1; };
    return Object.keys(set).sort(function (a, b) { return order(a) - order(b) || a.localeCompare(b); });
  }
  // the board (Today's Matches' matches.json) and the search index, as the dashboard holds them
  function board() { try { return typeof matches !== 'undefined' && Array.isArray(matches) ? matches : []; } catch (e) { return []; } }   // eslint-disable-line no-undef
  var keyIx = { src: null, map: null };
  function indexEntry(n) {
    var idx = null;
    try { idx = typeof playerIndex !== 'undefined' && Array.isArray(playerIndex) ? playerIndex : null; } catch (e) { idx = null; }   // eslint-disable-line no-undef
    if (!idx || !idx.length) return null;
    if (keyIx.src !== idx || keyIx.n !== idx.length) keyIx = { src: idx, n: idx.length, map: nameIndex(idx) };
    return indexHit(n, keyIx.map);
  }
  var HELP = {
    playerName: function (k, n) { return typeof newsPlayerName === 'function' ? newsPlayerName(k, n) : n; },   // eslint-disable-line no-undef
    eventName: function (raw) { return typeof sfEventName === 'function' ? sfEventName(raw) : raw; },        // eslint-disable-line no-undef
    keyOf: function (n) { var e = indexEntry(n); return e ? e.key : null; },
    shortName: function (n) { return shortName(n, indexEntry(n), typeof ppAbbrevName === 'function' ? ppAbbrevName : null); },   // eslint-disable-line no-undef
  };
  // attach the display strings to every row (re-done when the board or the rows change)
  function enrich() {
    var b = board(), ni = 0, np = 0;
    try { ni = typeof playerIndex !== 'undefined' && playerIndex ? playerIndex.length : 0; } catch (e) { ni = 0; }           // eslint-disable-line no-undef
    try { np = typeof playerProfiles !== 'undefined' && playerProfiles ? Object.keys(playerProfiles).length : 0; } catch (e) { np = 0; }   // eslint-disable-line no-undef
    var sig = b.length + '|' + st.etag + '|' + st.rows.length + '|' + ni + '|' + np;
    if (st.metaSig === sig && st.metaRows === st.rows) return;
    st.metaSig = sig; st.metaRows = st.rows;
    st.rows.forEach(function (r) {
      var m = rowMeta(r, b, HELP);
      r.dA = m.a; r.dB = m.b; r.dSide = m.side; r.dOpp = m.opp; r.event = m.event; r.surface = m.surface; r.card = m.card; r.cardSide = m.cardSide;
      // a matched row's start = its Today's Matches card's (cardStartMs: api-tennis's Berlin clock), as the card shows it
      var cs = null;
      try { cs = m.card && typeof cardStartMs === 'function' ? cardStartMs(m.card) : null; } catch (e) { cs = null; }   // eslint-disable-line no-undef
      r.cardStart = cs != null && isFinite(cs) ? cs : null;
    });
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
      if (!x[1].notModified) {
        st.feedRows = x[1].json.rows || []; st.etag = x[1].etag; st.windowH = x[1].json.windowHours || null; st.rows = buildRows(st.feedRows);
        st.lines = {};
        (Array.isArray(x[1].json.lines) ? x[1].json.lines : []).forEach(function (l) { if (l && l.key) st.lines[l.key] = l; });
      }
      var before = st.knownBooks || [];
      var allSel = !st.everLoaded || before.every(function (b) { return st.S.books.indexOf(b) >= 0; });
      st.knownBooks = books();
      if (allSel) st.S.books = st.knownBooks.slice();
      st.everLoaded = true;
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
    search: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="var(--text-label)" stroke-width="1.7"></circle><path d="M13.2 13.2 17 17" stroke="var(--text-label)" stroke-width="1.7" stroke-linecap="round"></path></svg>',
    // the site's small chevron (Trading Report's CHEV)
    chev: '<svg class="do-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"></path></svg>',
    chart: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="flex:none;"><path d="M3 5l5 5 3-3 6 7M17 14v-4M17 14h-4" stroke="var(--text-label)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  };
  function lab(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i][0] === v) return arr[i][1]; return ''; }

  function headerHtml(v, fs, blank) {
    var withDrop = blank ? '—' : String(v.list.length);
    var biggest = !blank && v.list.length ? Math.max.apply(null, v.list.map(function (r) { return r.drop; })).toFixed(1) + '%' : '—';
    // TEN-403: the shared 35b page header (.sfh). TEN-427: the ticket's sentence and nothing after it (round 3, founder
    // 393874e7 item 4: no "· Live · updated Xs ago" tail — the Updated stat carries the read's time; shell R2: no tail
    // fragments); stats Drops · Biggest · Window · Updated, a dash grey. Updated = the endpoint's generatedAt (its last
    // successful read of the bots' tables — the data behind the list), HH:MM in stennisfy.tz; never the clock; "—"
    // before the first good read. A disconnected feed shows the banner and dims the rows (render), never a header line.
    var v = function (k, val, cls) {
      return '<div class="sfh__stat"><span class="sfh__l">' + k + '</span><span class="sfh__v' + (val === '—' ? ' sfh__v--none' : '') + '" data-k="' + cls + '">' + val + '</span></div>';
    };
    var upd = st.everLoaded && st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—';
    return '<div class="sfh do-head"><div class="sfh__text">' +
      '<h1 class="sfh__title">Dropping Odds</h1>' +
      '<p class="sfh__sub"><span class="do-subtitle">Prices that have shortened since we first recorded them, each within one bookmaker. Biggest drops first.</span></p></div>' +
      '<div class="sfh__stats">' +
      v('Drops', withDrop, 'drops') +
      v('Biggest', biggest, 'biggest') +
      v('Window', esc(lab(WINDOWS, st.S.win)), 'window') +
      v('Updated', upd, 'updated') +
      '</div></div>';
  }

  function bannerHtml() {
    var asOf = st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—';
    return '<div class="do-banner"><span class="do-banner-l"><span class="do-banner-k">FEED DISCONNECTED</span>' +
      '<span class="do-banner-t">Showing prices as of <span class="do-mono">' + esc(asOf) + '</span>. New moves will not appear until the feed reconnects.</span></span>' +
      '<button class="do-link" data-act="reconnect">Reconnect</button></div>';
  }

  // TEN-427 Data 7: no Alerts (no per-member alert backend exists, so no button and no pop-over) and no Refresh (the
  // list re-reads the endpoint every POLL_MS on its own; the banner's Reconnect is the one manual refetch)
  // r2 fix 16: search always matches player names and a row's event; the placeholder promises tournaments (the
  // reference's "Search players or tournaments") only when every upcoming row carries an event, else "Search players"
  function searchHtml() {
    var now = dataNow(), up = st.rows.filter(function (r) { return isUpcoming(r, now); });
    var ph = up.length && up.every(function (r) { return !!r.event; }) ? 'Search players or tournaments' : 'Search players';
    return '<div class="do-search-row"><div class="do-search">' + ICON.search +
      '<input type="text" data-act="q" placeholder="' + ph + '" value="' + esc(st.S.q) + '" aria-label="' + ph + '"></div>' +
      '</div>';
  }

  function seg(label, on, act, val, mono, disabled, title) {
    return '<button class="do-seg' + (mono ? ' mono' : '') + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(val) + '"' +
      (disabled ? ' disabled' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</button>';
  }
  function railsHtml() {
    var S = st.S, win = st.windowH || 24;
    var r = '<div class="do-rails">';
    r += '<div class="do-rail"><span class="do-rail-k">TIER</span>' + ['ATP', 'Challenger', 'ITF'].map(function (t) { return seg(t, S.tiers.indexOf(t) >= 0, 'tier', t); }).join('') + '</div>';
    r += '<div class="do-rail"><span class="do-rail-k">BOOKS</span>' + [['all', 'All'], ['sharp', 'Sharp'], ['soft', 'Soft']].map(function (b) { return seg(b[1], S.btype === b[0], 'btype', b[0]); }).join('') + '</div>';
    r += '<div class="do-rail"><span class="do-rail-k">WINDOW</span>' + WINDOWS.map(function (w) {
      var dis = w[0] !== 'open' && parseInt(w[0], 10) > win;     // longer than the feed holds
      var title = w[0] === 'open' ? 'Everything the feed holds: the last ' + win + 'h of flagged moves' : dis ? 'The feed holds ' + win + 'h' : '';
      return seg(w[1], S.win === w[0], 'win', w[0], true, dis, title);
    }).join('') + '</div>';
    r += '<div class="do-rail"><span class="do-rail-k">MIN DROP</span>' + MIN.map(function (m) { return seg(m[1], S.min === m[0], 'min', m[0], true); }).join('') + '</div>';
    return r + '</div>';
  }

  function tabsHtml(v) {
    // r2 fix 10: "All markets" = the sum of the market tabs (Match winner, the one market the bots record)
    var S = st.S, loaded = st.everLoaded;
    var sum = loaded ? String(MARKETS.reduce(function (s, m) { return s + (v.mkCount[m[0]] || 0); }, 0)) : '—';
    var t = '<div class="do-tabs-row"><div class="do-tabs do-hs">';
    t += '<button class="do-tab' + (S.mk === 'all' ? ' on' : '') + '" data-act="mk" data-v="all">All markets<span class="do-tab-n">' + sum + '</span></button>';
    MARKETS.forEach(function (m) {
      var n = loaded ? String(v.mkCount[m[0]] || 0) : '—';
      t += '<button class="do-tab' + (S.mk === m[0] ? ' on' : '') + '" data-act="mk" data-v="' + m[0] + '">' + m[1] + '<span class="do-tab-n">' + n + '</span></button>';
    });
    return t + '</div></div>';
  }

  // the site filter menu (Trading Report's): trigger card tone (the reference), open / active = --selected + 16% edge, active carries
  // the ×; the menu --card + 10% edge, radius 10, padding 4, --shadow-menu, max-height 252
  function menuHtml(key, label, value, active, disabled, body, why) {
    var open = st.menu === key && !disabled;
    return '<div class="do-menu"><span class="do-trig' + (active ? ' active' : '') + (open ? ' open' : '') + '" data-act="menu" data-v="' + key + '"' +
      (disabled ? ' aria-disabled="true" title="' + esc(why || '') + '"' : '') + '>' +
      '<span class="do-trig-k">' + label + '</span><span class="do-trig-v">' + esc(value) + '</span>' +
      (active ? '<span class="do-x" data-act="clear" data-v="' + key + '">×</span>' : ICON.chev) + '</span>' +
      (open ? '<div class="do-pop">' + body + '</div>' : '') + '</div>';
  }
  // single-select row: selected = --selected + a white ✓ (no radio); multi-select row: a box, checked = white fill + dark ✓
  function opt(label, on, act, val, multi) {
    return '<span class="do-opt' + (on ? ' on' : '') + (multi ? ' multi' : '') + '" data-act="' + act + '" data-v="' + esc(val) + '">' +
      (multi ? '<span class="do-box">' + (on ? '✓' : '') + '</span>' : '') + '<span class="do-opt-l">' + esc(label) + '</span>' +
      (!multi && on ? '<span class="do-tick">✓</span>' : '') + '</span>';
  }
  // Surface options: the surfaces of the board-matched rows (Today's Matches' card), "All" first
  function surfaces() {
    var set = {};
    st.rows.forEach(function (r) { if (r.surface) set[r.surface] = 1; });
    return Object.keys(set).sort();
  }
  function resultsHtml(v) {
    var S = st.S, bks = books(), allB = S.books.length === bks.length;
    var bookBody = ['sharp', 'soft'].map(function (cls) {
      var bs = bks.filter(function (b) { return bookCls(b) === cls; });
      if (!bs.length) return '';
      return '<div class="do-pop-h">' + (cls === 'sharp' ? 'Sharp' : 'Soft') + '</div>' + bs.map(function (b) { return opt(b, S.books.indexOf(b) >= 0, 'book', b, true); }).join('');
    }).join('');
    var bookVal = allB ? 'All' : S.books.length === 1 ? S.books[0] : S.books.length + ' books';
    var surfs = surfaces();
    var surfBody = [['all', 'All']].concat(surfs.map(function (s) { return [s, s]; })).map(function (s) { return opt(s[1], (S.surf || 'all') === s[0], 'surf', s[0]); }).join('');
    var startsBody = STARTS.map(function (s) { return opt(s[1], S.starts === s[0], 'starts', s[0]); }).join('');
    var sortBody = SORT.map(function (s) { return opt(s[1], S.sort === s[0], 'sort', s[0]); }).join('');
    var count = st.refreshing || (!st.everLoaded && st.reachable) ? 'Loading moves…' : !st.everLoaded ? '—' :
      v.list.length + ' ' + (v.list.length === 1 ? 'move' : 'moves') + ' across ' + v.nMatches + ' ' + (v.nMatches === 1 ? 'match' : 'matches');
    var surfOn = S.surf && S.surf !== 'all';
    return '<div class="do-results"><span class="do-count">' + count + '</span><div class="do-menus">' +
      menuHtml('book', 'Bookmaker', bookVal, !allB, false, bookBody) +
      menuHtml('surf', 'Surface', surfs.length ? (surfOn ? S.surf : 'All') : '—', surfOn, !surfs.length, surfBody,
        'The feed carries no surface; it comes from a Today’s Matches card, and no row here matches one') +
      menuHtml('starts', 'Starts within', lab(STARTS, S.starts), S.starts > 0, false, startsBody) +
      menuHtml('sort', 'Sort', lab(SORT, S.sort), false, false, sortBody) +
      '</div></div>';
  }

  // r2 fix 12: ONE word for a book's first recorded price, "Open", always with the dotted tooltip — the list's column
  // head, the box's chart chip and its table head (one word whether or not our first price is the book's own opener)
  var OPEN_TIP = 'First price Stennisfy recorded, not necessarily the bookmaker’s opening line.';
  function openHelp(help, tip) { return '<span class="' + help + '">Open</span><span class="' + tip + '">' + OPEN_TIP + '</span>'; }
  function colsHtml() {
    return '<div class="do-cols"><span>DROP</span><span>SELECTION · MATCH · BOOK</span>' +
      '<span class="do-cols-r">' + openHelp('do-help', 'do-tip') + ' → NOW</span></div>';
  }

  // TEN-427 Data 8 (override): initials avatars (fhIni, as on Live, Model, Trading Report and the shell); no photos, no ring
  function initials(name) {
    if (typeof fhIni === 'function') return fhIni(name);   // eslint-disable-line no-undef
    var w = String(name || '').replace(/\./g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return w.length === 1 ? w[0].slice(0, 2).toUpperCase() : (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  function avatarHtml(r) {
    return '<span class="do-av" aria-hidden="true">' + esc(initials(r.dSide || r.side)) + '</span>';
  }

  // every listed row is upcoming (r2 ruling): no status badge, no cut — "moved Xm ago"
  function movedText(r, now) { return 'moved ' + ago(now - Date.parse(r.movedAt)); }
  // "market · vs opponent · event · book" (the event only from a matched Today's Matches card: the feed has none)
  function detailText(r) {
    return ['Match winner', 'vs ' + (r.dOpp || r.opp || '—'), r.event, r.book].filter(Boolean).join(' · ');
  }
  function rowHtml(r, now) {
    var fill = Math.min(100, Math.max(8, r.drop / 40 * 100)).toFixed(0);
    return '<div class="do-row" role="button" tabindex="0" data-act="row" data-v="' + esc(r.id) + '">' +
      '<span class="do-meter-c"><span class="do-meter"><span class="do-meter-f" style="height:' + fill + '%"></span></span>' +
      '<span class="do-fig"><span class="do-fig-n">' + r.drop.toFixed(1) + '<span class="do-fig-p">%</span></span><span class="do-fig-c">DROP</span></span></span>' +
      '<div class="do-who">' + avatarHtml(r) + '<div class="do-who-t">' +
      '<span class="do-sel">' + esc(r.dSide || r.side) + ' to win</span>' +
      '<span class="do-detail">' + esc(detailText(r)) + '</span></div></div>' +
      '<div class="do-px" title="Show odds movement">' + ICON.chart + '<span class="do-px-c">' +
      '<span class="do-px-l"><span class="do-px-o">' + price2(r.open) + '</span><span class="do-px-a">→</span><span class="do-px-n">' + price2(r.now) + '</span></span>' +
      '<span class="do-moved">' + esc(movedText(r, now)) + '</span></span></div></div>';
  }

  function listHtml(v, fs) {
    if (st.refreshing || !st.everLoaded && st.reachable) {
      var w = [['62%', '44%'], ['54%', '38%'], ['70%', '48%'], ['58%', '40%'], ['66%', '46%'], ['50%', '36%'], ['60%', '42%']];
      return '<div class="do-list">' + w.map(function (x) {
        return '<div class="do-skel"><span style="display:flex;align-items:center;gap:12px"><b style="width:4px;height:44px;border-radius:2px"></b><b style="width:56px;height:22px"></b></span>' +
          '<span style="display:flex;align-items:center;gap:14px"><b style="width:40px;height:40px;border-radius:50%;flex:none"></b><span style="display:flex;flex-direction:column;gap:8px;flex:1"><b style="height:12px;width:' + x[0] + ';background:color-mix(in srgb, var(--text) 7%, transparent)"></b><b style="height:9px;width:' + x[1] + ';background:color-mix(in srgb, var(--text) 4.5%, transparent)"></b></span></span>' +
          '<b style="height:16px;width:96px"></b></div>';
      }).join('') + '</div>';
    }
    if (!st.everLoaded) return '';
    if (!v.list.length) {
      var h = 'No moves above your threshold in this window.';
      var d = 'Min drop ' + lab(MIN, st.S.min) + ' · ' + lab([['open', 'since open'], ['12h', 'last 12h'], ['24h', 'last 24h'], ['48h', 'last 48h']], st.S.win);
      return '<div class="do-empty"><span class="do-empty-h">' + h + '</span><span class="do-empty-d">' + d + '</span>' +
        '<button class="do-link" data-act="reset">Reset filters</button></div>';
    }
    var now = dataNow();
    return '<div class="do-list' + (fs === 'disconnected' ? ' stale' : '') + '">' + v.list.map(function (r) { return rowHtml(r, now); }).join('') + '</div>';
  }

  function render() {
    var el = root();
    if (!el) return;
    var ae = document.activeElement, focusQ = ae && ae.getAttribute && ae.getAttribute('data-act') === 'q';
    var caret = focusQ ? ae.selectionStart : null;
    var focusRow = ae && ae.classList && ae.classList.contains('do-row') ? ae.getAttribute('data-v') : null;
    enrich();
    var now = dataNow(), v = view(st.rows, st.S, now), fs = feedState(ageS(), st.reachable);
    var blank = !st.everLoaded;
    el.innerHTML = '<div class="do-wrap">' + headerHtml(v, fs, blank) + (fs === 'disconnected' && (st.everLoaded || !st.reachable) ? bannerHtml() : '') +
      searchHtml(v) + railsHtml() + tabsHtml(v) + resultsHtml(v) + colsHtml() + listHtml(v, fs) +
      (st.menu ? '<div class="do-clickaway" data-act="clickaway"></div>' : '') + '</div>';
    if (focusQ) { var q = el.querySelector('[data-act="q"]'); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} }
    if (focusRow) {
      var sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(focusRow) : focusRow.replace(/["\\]/g, '\\$&');
      var fr = null; try { fr = el.querySelector('.do-row[data-v="' + sel + '"]'); } catch (e) {}
      if (fr) fr.focus({ preventScroll: true });     // never scroll the page back to a row
    }
    renderModal();
  }

  // ─── modal ──────────────────────────────────────────────────────────────────
  function closeModal() { st.drawer = null; st.drBook = null; st.tip = false; renderModal(); }
  // TEN-376 S1: a sidebar click closes the price-move box before it navigates
  (window.sfOverlayClosers = window.sfOverlayClosers || []).push(function () { if (st.drawer) closeModal(); });
  function renderModal() {
    var ov = document.getElementById('doOverlay');
    var r = st.drawer && st.rows.filter(function (x) { return x.id === st.drawer; })[0];
    if (!r) { if (ov) ov.remove(); st.modalKey = null; return; }
    // decision 5: metadata + the analysis link only for a row matched to exactly one board card
    // the row's card is the one enrich() joined (both players, the card's start within 12 h): one join for list and box
    var hit = r.card ? { card: r.card, cardSide: r.cardSide } : null;
    var card = hit && hit.card;
    if (card && !card._oddsLoaded && typeof ensureOddsMovement === 'function' && !card._doShardAsked) {   // eslint-disable-line no-undef
      card._doShardAsked = true;
      ensureOddsMovement(card).then(function () { st.modalKey = null; renderModal(); }).catch(function () {});   // eslint-disable-line no-undef
    }
    var chart = card && card._oddsLoaded && card.oddsMovement ? card.oddsMovement.chart : null;
    // TEN-427 Data 4: a card whose Today's Matches book is Bet105 lends the box its odds-movement pop-up rows for the
    // Bet105 line (price-history-box.js, the price_history RPC, cached 60 s there) — one source for both charts
    var PHB = typeof window !== 'undefined' ? window.PriceHistoryBox : null, ph = null;
    if (card && PHB && PHB.cardData && PHB.fetchHistory && typeof ocsKeyOf === 'function' && typeof ocsNameKey === 'function') {   // eslint-disable-line no-undef
      var cdat = null;
      try { cdat = PHB.cardData(card, hit.cardSide); } catch (e) { cdat = null; }
      if (cdat && cdat.source === 'rpc') {
        var phc = st.phCache || (st.phCache = {}), ck = ocsKeyOf(card), got = phc[ck];   // eslint-disable-line no-undef
        // an entry expires after PH_TTL_MS, as the Today's Matches pop-up re-reads (price-history-box.js CACHE_TTL_MS);
        // the expired rows stay drawn until the re-read answers
        if (!got || Date.now() - got.at >= PH_TTL_MS) {
          got = phc[ck] = { payload: got ? got.payload : null, at: Date.now() };
          (function (ent) {
            var drop = function () { if (phc[ck] === ent) delete phc[ck]; };
            PHB.fetchHistory(ck).then(function (p) { if (p == null) { drop(); return; } ent.payload = p; st.modalKey = null; renderModal(); }).catch(drop);
          })(got);
        }
        if (got.payload) ph = phSeries(PHB, got.payload, ocsNameKey, card, hit.cardSide, cdat.startAt, cdat.completed ? cdat.closeAt : null);   // eslint-disable-line no-undef
      }
    }
    // + the minute: "Now" (15 min) and the countdown must age even when no new data arrives (review of a37fc857)
    var key = [st.drawer, st.drBook, st.tip, st.etag, chart ? 'b' : '-', ph ? 'p' : '-', Math.floor(dataNow() / 60000)].join('|');
    var now = dataNow();
    if (ov && st.modalKey === key) {
      var dl = ov.querySelector('.do-ov-dropc span');
      if (dl) dl.textContent = movedText(r, now);
      return;
    }
    st.modalKey = key;
    // a box opens at its top, header in view (TEN-301 item 7); only a re-render of the SAME row keeps its scroll
    var keepScroll = ov && st.modalRow === st.drawer && ov.querySelector('.do-ov-scroll') ? ov.querySelector('.do-ov-scroll').scrollTop : 0;
    st.modalRow = st.drawer;
    if (!ov) { ov = document.createElement('div'); ov.id = 'doOverlay'; ov.className = 'do-ov'; document.body.appendChild(ov); }
    // the overlay starts at the rail's edge through --sf-side (drops-page.css), so it follows the rail open / closed (TEN-403)

    var mb = modalBooks(r, { rows: st.rows, line: (st.lines || {})[lineKey(r)], chart: chart, cardSide: hit && hit.cardSide, now: now, cutAt: r.cutAt, ph: ph });
    var ownB = mb.books.filter(function (b) { return b.own; })[0];
    var sel = (st.drBook && mb.books.filter(function (b) { return b.book === st.drBook; })[0]) || ownB;
    var cls = bookCls(r.book);
    // header (price-led). Players line: the shared names, no rank / Elo (the v2 design draws neither); event (the
    // canonical table) and round only from a matched card, and a segment that does not exist is left out (rules 29, 30)
    var tail = [];
    if (card) {
      if (r.event) tail.push(String(r.event));
      // the round = the card's own api-tennis round only, as Today's Matches and the MA header read it (founder
      // 33107f2a, 11 Oct: no Drops-only inference) — a card the feed has not filled yet shows no round
      var rb = typeof roundBadgeText === 'function' ? roundBadgeText(card.tournamentRound) : null;   // eslint-disable-line no-undef
      if (rb) tail.push(String(rb));
    }
    var sl = startLine(r, now);
    var dropBig = r1(r.drop) >= 10;
    // chart: the selected book's recorded prices, its end (rule 25), its open chip (rule 24)
    var series = (sel.series || []).filter(function (p) { return isFinite(p.t) && p.v != null; }).slice().sort(function (a, b) { return a.t - b.t; });
    var end = endOf(series, sel.seen, r.cutAt, now);
    var ch = series.length ? boxChart(series, sel.first && sel.first.v, end, sel.holes) : null;
    var nameSpan = function (n, d) {
      return '<span class="do-ov-nm' + (n === r.side ? ' backed' : '') + '"><span>' + esc(d || n) + '</span></span>';
    };
    var html = '<div class="do-ov-scrim" data-act="close"></div><div class="do-ov-box" role="dialog" aria-modal="true" aria-label="Price move"><div class="do-ov-scroll">' +
      '<div class="do-ov-head">' +
        '<div class="do-ov-dropb"><span class="do-ov-dropf ' + (dropBig ? 'big' : 'small') + '"><span>▼ ' + r.drop.toFixed(1) + '%</span></span>' +
          '<span class="do-ov-dropc">DROP · <span>' + esc(movedText(r, now)) + '</span></span></div>' +
        '<div class="do-ov-mid">' +
          '<span class="do-ov-eye"><span>Match winner</span> · <span>' + esc(r.book) + '</span><span class="do-ov-btag ' + cls + '"><span>' + cls.toUpperCase() + '</span></span></span>' +
          '<span class="do-ov-sel"><span>' + esc(r.dSide || r.side) + ' to win</span></span>' +
          '<span class="do-ov-pl">' + nameSpan(r.playerA, r.dA) + '<span class="do-ov-v">v</span>' + nameSpan(r.playerB, r.dB) +
            (tail.length ? '<span class="do-ov-evr">· ' + tail.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join(' · ') + '</span>' : '') + '</span>' +
        '</div>' +
        '<div class="do-ov-right"><span class="do-ov-pxl"><span class="do-ov-open"><span>' + price2(r.open) + '</span></span><span class="do-ov-arrow">→</span>' +
          '<span class="do-ov-now"><span>' + price2(r.now) + '</span></span></span>' +
          (sl ? '<span class="do-ov-start"><span>' + esc(sl.start) + '</span> (<span>' + esc(sl.cd) + '</span>)</span>' : '') + '</div>' +
        '<button class="do-ov-x" data-act="close" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="do-ov-chart"><span class="do-ov-backrow">' + (!sel.own ? '<span class="do-ov-back" role="button" tabindex="0" data-act="back">Back to ' + esc(r.book) + '</span>' : '') + '</span>' +
      (ch ? '<div class="do-ov-cw">' +
        '<div class="do-ov-yax">' + ch.gridY.map(function (g) { return '<span style="top:' + g.top + '"><span>' + g.label + '</span></span>'; }).join('') + '</div>' +
        '<div class="do-ov-plot"><svg viewBox="0 0 1000 300" preserveAspectRatio="none">' +
          // README §5.8 "Dotted guides" (founder R6.3, TEN-376): dotted horizontal guides only — the model's vticks and
          // area are not drawn (no vertical gridlines, no area fill)
          ch.gridY.map(function (g) { return '<line class="do-hg" x1="0" y1="' + g.y + '" x2="1000" y2="' + g.y + '" vector-effect="non-scaling-stroke"></line>'; }).join('') +
          // time axis 1a: the day split at midnight (member's zone)
          ch.splits.map(function (x) { return '<line class="do-day" x1="' + x + '" y1="0" x2="' + x + '" y2="300" vector-effect="non-scaling-stroke"></line>'; }).join('') +
          ch.lines.map(function (pl) { return '<polyline class="do-line" points="' + pl + '" vector-effect="non-scaling-stroke"></polyline>'; }).join('') +
          // r3 item 9: the last price carried flat and dashed to the axis end
          (ch.ext ? '<line class="do-ext" x1="' + ch.ext.x1 + '" y1="' + ch.ext.y + '" x2="' + ch.ext.x2 + '" y2="' + ch.ext.y + '" vector-effect="non-scaling-stroke"></line>' : '') +
          '</svg>' +
          (ch.hasOpen ? '<span class="do-ov-openchip" style="top:' + ch.openTop + ';left:min(calc(' + ch.openLeft + ' + 8px), calc(100% - 132px))">' + openHelp('do-ov-help', 'do-ov-tip') + ' <span>' + price2(sel.first.v) + '</span></span>' : '') +
          '<span class="do-ov-enddot" style="top:' + ch.endDot + ';left:' + ch.endLeft + '"></span></div>' +
        '<div class="do-ov-endc"><div class="do-ov-endbox" style="top:' + ch.endTop + '"><div class="do-ov-endw">' + esc(ch.endWord) + '</div><div class="do-ov-endv"><span>' + ch.endLbl + '</span></div></div></div>' +
        '</div>' +
        '<div class="do-ov-xax">' + ch.ticks.map(function (t) { return '<span style="left:' + t.left + ';transform:' + t.tf + '"><span>' + esc(t.label) + '</span></span>'; }).join('') + '</div>' +
        '<div class="do-ov-days">' + ch.bands.map(function (b) { return '<span class="do-ov-band" style="width:' + b.w + '"><span class="do-ov-bl"></span><span class="do-ov-bt">' + esc(b.label) + '</span></span>'; }).join('') + '</div>' : '') +
      '<span class="do-ov-note"><span>' + (ch && ch.single ? 'One price recorded so far. The line appears once a second snapshot arrives.' : sel.truncated ? 'Earlier prices were not sent; the chart starts at the oldest one loaded.' : '') + '</span></span></div>' +
      // r3 item 6 (founder 393874e7) = the reference's table: Book · Open → Now · Drop on minmax(0,1fr) 120px 84px, the
      // books under SHARP / SOFT group labels (a caps label + a hairline; no TYPE chip column, no "from" column); the
      // open struck through as on the rows (r3 item 5)
      '<div class="do-ov-tbl"><div class="do-ov-th"><span>Book</span><span class="r do-ov-hr">' + openHelp('do-ov-help', 'do-ov-tip') + ' → Now</span><span class="r">Drop</span></div>' +
      ['sharp', 'soft'].map(function (g) {
        var gb = mb.books.filter(function (b) { return (b.cls === 'sharp' ? 'sharp' : 'soft') === g; });
        if (!gb.length) return '';
        return '<div class="do-ov-grp"><span class="do-ov-grk">' + (g === 'sharp' ? 'Sharp' : 'Soft') + '</span><span class="do-ov-grl"></span></div>' +
          gb.map(function (b) {
            var sp = bookSplit(b.book), dc = dropCell(b.own ? r.drop : b.drop, b.single);
            return '<div class="do-ov-tr' + (b === sel ? ' sel' : '') + (b.own ? ' own' : '') + '" role="button" tabindex="0" data-act="book" data-v="' + esc(b.book) + '" title="' + esc(b.book + (b.src ? ' · ' + b.src : '')) + '">' +
              '<span class="do-ov-tb"><span class="n"><span>' + esc(sp.name) + '</span></span><span class="s"><span>' + esc(sp.sub) + '</span></span></span>' +
              '<span class="r do-ov-tp">' + (!b.single && b.first && b.first.v != null ? '<span class="do-ov-to">' + price2(b.first.v) + '</span>' : '<span class="do-ov-tnil">—</span>') + '<span class="do-ov-ta">→</span>' +
                '<span class="do-ov-tn">' + price2(b.now && b.now.v) + '</span></span>' +
              '<span class="r"><span class="do-ov-td ' + dc.c + '"><span>' + dc.txt + '</span></span></span></div>';
          }).join('');
      }).join('') + '</div>' +
      '<div class="do-ov-foot"><span class="do-ov-foot-l"><span class="do-ov-sum"><span>' + esc(summaryText(mb)) + '</span></span>' +
      '<span class="do-ov-fn">Each drop compares a book’s own first recorded price with its own current price.</span></span>' +
      (card && typeof openAnalysisModal === 'function' ? '<a class="do-ov-link" href="#" data-act="analysis" data-v="' + esc(card.id) + '">Open match analysis →</a>' : '') +   // eslint-disable-line no-undef
      '</div></div></div>';
    ov.innerHTML = html;
    var sc = ov.querySelector('.do-ov-scroll');
    if (sc) sc.scrollTop = keepScroll;
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
      case 'mk': S.mk = v; break;
      case 'menu': st.menu = st.menu === v ? null : v; break;
      case 'clickaway': st.menu = null; break;
      case 'clear':
        e.stopPropagation();
        if (v === 'book') S.books = books();
        if (v === 'starts') S.starts = 0;
        if (v === 'surf') S.surf = 'all';
        st.menu = null; break;
      case 'book':
        if (t.closest('.do-ov')) { st.drBook = v; renderModal(); return; }
        S.books = toggle(S.books, v, true); break;       // multi-select: the menu stays open
      case 'surf': S.surf = v || 'all'; st.menu = null; break;   // single-select: the menu closes
      case 'starts': S.starts = +v; st.menu = null; break;
      case 'sort': S.sort = v; st.menu = null; break;
      case 'reset': st.S = defaults(books()); st.menu = null; break;
      case 'reconnect': refresh(); return;
      case 'row': st.drawer = v; st.drBook = null; st.tip = false; st.menu = null; renderModal(); return;
      case 'close': closeModal(); return;
      case 'back': st.drBook = null; renderModal(); return;
      case 'tip': st.tip = !st.tip; renderModal(); return;
      case 'analysis':
        e.preventDefault(); closeModal();
        if (typeof openAnalysisModal === 'function') openAnalysisModal(v);   // eslint-disable-line no-undef
        return;
      default: return;
    }
    render();
  }
  function onInput(e) {
    if (e.target.getAttribute('data-act') !== 'q') return;
    st.S.q = e.target.value; render();
  }
  function onKey(e) {
    // the box's book rows and "Back to" are keyboard-reachable (role=button, tabindex=0)
    var act = e.target.closest && e.target.closest('.do-ov [role="button"][data-act]');
    if (act && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act.click(); return; }
    var row = e.target.closest && e.target.closest('.do-row');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); st.drawer = row.getAttribute('data-v'); st.drBook = null; st.tip = false; renderModal(); }
  }

  function setActive(on) {
    st.active = !!on;
    clearTimeout(st.timer); clearInterval(st.ticker);
    if (!st.active) { closeModal(); return; }
    render();
    load().then(function () { render(); schedule(); });
    // re-render the data-time labels ("moved 41m ago", the feed's age behind the banner) between reads
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
    (window.sfEscLayers = window.sfEscLayers || []).push({ id: 'drops-drawer', z: 76, isOpen: function () { return !!st.drawer; }, close: closeModal });   // Esc: esc-nav.js
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.do-ov')) onClick(e); });
    var page = el.closest('.tabpage');
    if (page && page.classList.contains('active')) setActive(true);
  }
  window.DropsPage = { setActive: setActive, _state: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
