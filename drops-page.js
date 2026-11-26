/* drops-page.js — Dropping Odds v2 (sharp vs soft).
 *
 * Built from the Claude Design handoff `design_handoff_dropping_odds_v2` (2026-11-23): `Dropping Odds v2.dc.html` is
 * the structure and every measured value (drops-page.css reads them through the --do2-* tokens), its README the rules.
 * Its sample data is not shipped: every selection, book, price and time here comes from the drops endpoint
 * (stennisfy-drops.fly.dev, one database read per 30 s fanned out to every viewer) and, for a selection whose match is a
 * Today's Matches card, Pinnacle from that card's TEN-295 chart shard. Rules: .claude/rules/drops.md.
 *
 * One row per SELECTION (a player to win a match). Its books come from the endpoint's `lines` (one per match side, each
 * book's change-only series for that side and the opponent) — Bet105 (Kibl), Superbet and Napoleon Sports BE
 * (odds-api.io) — plus Pinnacle (Oddspapi) from the board shard. A book's first price is the first one Stennisfy
 * recorded; its price now is the last one. Every %, implied and pts figure is computed at render from the two prices
 * printed beside it (README `rd` / `calc`), never stored.
 *
 * Gated by FEATURE_DROPS (default ON; ?drops=0 or localStorage stennisfy.flags.drops=0 turns it off).
 */
(function () {
  'use strict';

  var ENDPOINT = 'https://stennisfy-drops.fly.dev';
  var POLL_MS = 30000;               // the endpoint's own read cadence; polling faster reads nothing new
  var AMBER_AFTER_S = 90;            // 3x the read interval (drops.md)
  var DISCONNECTED_AFTER_S = 300;    // 5 min (drops.md): the "Feed disconnected" banner
  var QUOTING_MS = 24 * 3600e3;      // an endpoint book not seen for 24 h is not quoting (drops.md)
  var CHART_MS = 24 * 3600e3;        // the chart is "Last 24 hours"
  var H = 3600e3;

  // The roster: only books this page has a source for (README books are placeholders). Sharp = Pinnacle, Bet105
  // (Betfair has no source since 8 Nov); Soft = Superbet, Napoleon Sports BE. Prediction markets: none in the feed, so
  // every prediction-market element stays hidden (no group, no menu, no amber line, no count).
  var BOOKS = [['Pinnacle', 'sharp'], ['Bet105', 'sharp'], ['Superbet', 'soft'], ['Napoleon Sports BE', 'soft']];
  var BOOK_CLS = {}; BOOKS.forEach(function (b) { BOOK_CLS[b[0]] = b[1]; });
  var BOOK_NAMES = BOOKS.map(function (b) { return b[0]; });
  var SOFT_NAMES = BOOKS.filter(function (b) { return b[1] === 'soft'; }).map(function (b) { return b[0]; });
  // Pinnacle on a board card's chart shard: Oddspapi first, the api-tennis copy only without it (one source, never spliced)
  var PIN_SOURCES = ['Pinnacle +30s', 'Pinnacle (api-tennis)'];
  var MK = { mw: 'Match winner' };
  var TIERS = ['ATP', 'Challenger', 'ITF'];
  var WINDOWS = [['open', 'Since open'], ['12h', '12h'], ['24h', '24h'], ['48h', '48h']];
  var WIN_H = { open: 1e9, '12h': 12, '24h': 24, '48h': 48 };
  var WIN_TXT = { open: 'since open', '12h': 'last 12h', '24h': 'last 24h', '48h': 'last 48h' };
  var MIN = [[0, 'Any'], [5, '5%'], [10, '10%'], [20, '20%'], [30, '30%']];
  var MVL = [['all', 'All'], ['both', 'Sharp and soft'], ['sharp', 'Sharp only'], ['soft', 'Soft only'], ['nosharp', 'No sharp line']];

  // ─── readings (README `rd` / `calc`) ────────────────────────────────────────
  // half away from zero on the decimal value (4.075 -> 4.08, never the float's 4.0749… -> 4.07)
  function r1(x) { return Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10; }
  function r2(x) { return Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100; }
  function f2(x) { return x.toFixed(2); }
  // a reading from a first recorded price o (null = one price recorded) and a price now n (null = no line), on the
  // 2 dp prices the page prints, so every figure follows from what the reader sees
  function rd(o, n) {
    if (n == null) return { kind: 'none' };
    n = r2(n);
    if (o == null) return { kind: 'one', n: n };
    o = r2(o);
    var io = r1(100 / o), inn = r1(100 / n);
    return { kind: n < o ? 'drop' : n > o ? 'up' : 'flat', o: o, n: n, d: r1((o - n) / o * 100), io: io, inn: inn, pts: r1(inn - io) };
  }
  // The sharp reading (founder 2026-11-23): Pinnacle; where Pinnacle has no line, Bet105's price with its margin removed
  // (bk[B105_NM], built from Bet105's two sides). Never a soft book. `src` names which one the figures came from.
  var B105_NM = '_b105nm';
  function sharpKey(bk) { return bk.Pinnacle ? 'Pinnacle' : bk[B105_NM] ? B105_NM : null; }
  function sharpOf(bk) {
    var k = sharpKey(bk);
    if (!k) return { kind: 'none' };
    var r = rd(bk[k].first, bk[k].now); r.src = k === 'Pinnacle' ? 'Pinnacle' : 'Bet105';
    return r;
  }
  // bk = { book: { first: price | null, now: price, … } }
  function calc(bk) {
    var sq = SOFT_NAMES.filter(function (b) { return bk[b]; });
    var two = sq.filter(function (b) { return bk[b].first != null; });
    var avg = function (k) { return r2(two.reduce(function (a, b) { return a + r2(bk[b][k]); }, 0) / two.length); };
    var qn = BOOK_NAMES.filter(function (b) { return bk[b]; }), best = qn[0];
    qn.forEach(function (b) { if (r2(bk[b].now) > r2(bk[best].now)) best = b; });
    return {
      sharp: sharpOf(bk),
      soft: { quotes: sq.length, two: two.length, down: two.filter(function (b) { return r2(bk[b].now) < r2(bk[b].first); }).length,
        lead: two.length === 1 ? two[0] : 'avg', r: two.length ? rd(avg('first'), avg('now')) : { kind: sq.length ? 'one' : 'none' } },
      best: qn.length ? { n: qn.length, book: best, price: r2(bk[best].now) } : null,
    };
  }
  function dOf(r) { return r.d != null ? r.d : -1; }
  function mvOf(c) {
    var sd = c.sharp.kind === 'drop', fd = c.soft.down > 0;
    return c.sharp.kind === 'none' ? 'nosharp' : sd && fd ? 'both' : sd ? 'sharp' : fd ? 'soft' : 'none';
  }
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
  // the SQL's drops_api.nk(): surname part of "Last, First", its last token, lower-case, a–z only
  function nk(n) {
    var s = String(n == null ? '' : n);
    if (s.indexOf(',') >= 0) s = s.split(',')[0];
    s = s.replace(/^.*\s/, '').toLowerCase();
    return s.replace(/[^a-z]/g, '');
  }
  function lineKey(r) { var a = nk(r.playerA), b = nk(r.playerB); return (a < b ? a + '|' + b : b + '|' + a) + '|' + nk(r.side); }
  function lineKey(r) { var a = nk(r.playerA), b = nk(r.playerB); return (a < b ? a + "|" + b : b + "|" + a) + "|" + nk(r.side); }
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
  // Founder 2026-10-23 (Drops ruling 1): the avatar's player ID. A row joins its Today's Matches fixture by the Kibl rule
  // (kibl-stream/card_join.py): both players, either order; a player matches when the card's FULL surname is the tail of
  // the feed's name (compound surnames whole) and the card's first initial is ANY of the feed's given names (extra given
  // names never block); a trailing Jr / Sr / II / III / IV is dropped first, as the drops service's sk() does; the card's
  // start within 24 h of the row's (clock time is not a condition; an unmeasurable start is no candidate); exactly one
  // card, else no ID. The ID is the matched card's own key for the row's side. Today's Matches carries ATP fixtures, so
  // a Challenger or ITF row finds no card and keeps the monogram. (boardKeyFor, the prices / event join, is unchanged.)
  function kiblToks(n) {
    var t = canonToks(n).map(function (x) { return String(x).toLowerCase(); });
    while (t.length > 1 && /^(jr|sr|ii|iii|iv)$/.test(t[t.length - 1])) t.pop();
    return t;
  }
  function kiblSame(card, feed) {
    var c = kiblToks(card), i = 0;
    while (i < c.length - 1 && c[i].length === 1) i++;
    var ini = c.slice(0, i), sur = c.slice(i), k = kiblToks(feed);
    if (!sur.length || k.length < sur.length || k.slice(k.length - sur.length).join(' ') !== sur.join(' ')) return false;
    var giv = k.slice(0, k.length - sur.length);
    if (!ini.length || !giv.length) return true;
    return giv.some(function (g) { return g[0] === ini[0][0]; });
  }
  function photoKeyFor(r, board, startOf) {
    var st = Date.parse(r && r.start);
    if (!isFinite(st) || typeof startOf !== 'function') return null;
    var hits = (board || []).filter(function (m) {
      if (!m || !m.p1 || !m.p2) return false;
      var both = (kiblSame(m.p1, r.playerA) && kiblSame(m.p2, r.playerB)) || (kiblSame(m.p1, r.playerB) && kiblSame(m.p2, r.playerA));
      if (!both) return false;
      var cs = null;
      try { cs = startOf(m); } catch (e) { cs = null; }
      return cs != null && isFinite(cs) && Math.abs(cs - st) <= 24 * H;
    });
    if (hits.length !== 1) return null;
    var m = hits[0];
    var k = kiblSame(m.p1, r.side) ? m.p1Key : kiblSame(m.p2, r.side) ? m.p2Key : null;
    return k == null ? null : String(k);
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

  // ─── selections from the feed ───────────────────────────────────────────────
  // series [[at, price], …] -> [{t, v}] sorted, real prices only, cut before `cut` (nothing at or after a live start)
  function pts(list, cut) {
    return (list || []).map(function (p) { return { t: Date.parse(p[0]), v: num(p[1]) }; })
      .filter(function (p) { return isFinite(p.t) && p.v != null && p.v >= 1.01 && !(cut != null && p.t >= cut); })
      .sort(function (a, b) { return a.t - b.t; });
  }
  // a book from its change series: first = the first recorded price (null when only one is recorded), now = the last,
  // moveT = the time of its last change (null when it never moved), firstT = its first record
  function bookOf(series) {
    if (!series.length) return null;
    var last = series[series.length - 1];
    return { first: series.length > 1 ? series[0].v : null, now: last.v, series: series, firstT: series[0].t,
      moveT: series.length > 1 ? last.t : null };
  }
  // One selection per match side. A line holds its side's series ('side') and the opponent's ('other'); a side with a
  // line of its own takes that one, else its opponent line's 'other'. Match meta (tier, start, status) = the newest alert
  // row of the match. Only books on the roster; a book not seen for 24 h is not quoting.
  function buildSelections(lines, feedRows, now) {
    var meta = {};
    (feedRows || []).forEach(function (r) {
      var a = nk(r.playerA), b = nk(r.playerB), k = a < b ? a + '|' + b : b + '|' + a;
      if (!meta[k] || (Date.parse(r.detectedAt) || 0) > (Date.parse(meta[k].detectedAt) || 0)) meta[k] = r;
    });
    var out = {};
    (lines || []).forEach(function (l) {
      var a = nk(l.playerA), b = nk(l.playerB), mk = a < b ? a + '|' + b : b + '|' + a, m = meta[mk];
      if (!m || a === b) return;
      var sideName = l.side, oppName = nk(l.side) === a ? l.playerB : nk(l.side) === b ? l.playerA : null;
      if (oppName == null) return;
      var cut = m.match && (m.match.cutAt || m.match.liveAt) ? Date.parse(m.match.cutAt || m.match.liveAt) : null;
      [['side', sideName, oppName], ['other', oppName, sideName]].forEach(function (w) {
        var key = mk + '|' + nk(w[1]);
        if (out[key] && w[0] === 'other') return;           // the side's own line wins
        var bk = {};
        Object.keys(l.books || {}).forEach(function (name) {
          if (!BOOK_CLS[name]) return;
          var B = l.books[name] || {}, seen = Date.parse(B.lastSeen);
          if (isFinite(seen) && now != null && now - seen > QUOTING_MS) return;
          var o = bookOf(pts(B[w[0]], isFinite(cut) ? cut : null));
          if (o) { o.seen = isFinite(seen) ? seen : null; bk[name] = o; }
        });
        var b105 = l.books && l.books.Bet105, b105seen = b105 ? Date.parse(b105.lastSeen) : NaN;
        if (bk.Bet105 && b105) {
          var nm = bookOf(noMargin(pts(b105[w[0]], isFinite(cut) ? cut : null), pts(b105[w[0] === 'side' ? 'other' : 'side'], isFinite(cut) ? cut : null)));
          if (nm) { nm.seen = isFinite(b105seen) ? b105seen : null; bk[B105_NM] = nm; }
        }
        out[key] = { id: key, mk: 'mw', playerA: m.playerA, playerB: m.playerB, side: w[1], opp: w[2], bk: bk,
          tier: tierOf(m.tier), tierRaw: m.tier, start: m.scheduledStart || null, eventKey: (m.match && m.match.eventKey) || null,
          status: (m.match && m.match.status) || 'unknown', liveAt: (m.match && m.match.liveAt) || null, cutAt: (m.match && m.match.cutAt) || null };
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; });
  }
  // Bet105 without its margin (founder 2026-11-23): each Bet105 tick on either side is paired with the other side's last
  // Bet105 price at or before it (one source, the Odds tab's pairing rule); no pair before both sides posted. The fair
  // price of this side = 1 / (its share of the two implied chances) = 1 + own / other. Same-value re-stamps collapse.
  function noMargin(own, other) {
    var ev = own.map(function (p) { return { t: p.t, s: p.v }; }).concat(other.map(function (p) { return { t: p.t, o: p.v }; }))
      .sort(function (a, b) { return a.t - b.t; });
    var s = null, o = null, out = [];
    ev.forEach(function (e) {
      if (e.s != null) s = e.s; if (e.o != null) o = e.o;
      if (s == null || o == null) return;
      var v = 1 + s / o, last = out[out.length - 1];
      if (last && last.t === e.t) { last.v = v; return; }
      if (last && r2(last.v) === r2(v)) return;
      out.push({ t: e.t, v: v });
    });
    return out;
  }
  // Pinnacle from a board card's chart shard, for the card's side of this selection: one source, never spliced
  function pinnacleOf(chart, cardSide, cut) {
    if (!chart || !chart.books || !cardSide) return null;
    for (var i = 0; i < PIN_SOURCES.length; i++) {
      var B = chart.books[PIN_SOURCES[i]];
      var o = B ? bookOf(pts(B[cardSide], cut)) : null;
      if (o) {
        var m = (chart.meta || {})[PIN_SOURCES[i]] || {}, ck = Date.parse(m.checkedAt);
        o.seen = isFinite(ck) ? ck : null; o.source = PIN_SOURCES[i];
        return o;
      }
    }
    return null;
  }
  // the selection's last move (any quoting book) — else its first record; hours before `now`
  function movedAtOf(s) {
    var mv = null, first = null;
    Object.keys(s.bk).forEach(function (b) {
      if (b === B105_NM) return;   // a derived line, not a book's own move
      var o = s.bk[b];
      if (o.moveT != null && (mv == null || o.moveT > mv)) mv = o.moveT;
      if (first == null || o.firstT < first) first = o.firstT;
    });
    return { t: mv != null ? mv : first, moved: mv != null };
  }

  function startMs(s) { if (s.cardStart != null && isFinite(s.cardStart)) return s.cardStart; var v = Date.parse(s.start); return isFinite(v) ? v : null; }
  // upcoming matches only (drops.md r2): leaves at its start, or when the feed marks it live
  function isUpcoming(s, now) {
    if (s.liveAt || s.cutAt || s.status === 'in_play' || s.status === 'finished') return false;
    var t = startMs(s);
    return t != null && now != null && t > now;
  }

  function defaults() {
    return { tiers: TIERS.slice(), books: BOOK_NAMES.slice(), win: 'open', min: 0, mv: 'all', sort: 'drop', btype: 'all', q: '', mkTab: 'all' };
  }
  // README "Sorting and filtering logic" (the file's rank / minVal / pass)
  function rankOf(c, btype) {
    if (btype === 'soft') return dOf(c.soft.r);
    return c.sharp.d != null ? 1000 + c.sharp.d : (btype === 'all' ? dOf(c.soft.r) : -1);
  }
  function minValOf(c, btype) {
    var a = dOf(c.sharp), b = dOf(c.soft.r);
    return btype === 'sharp' ? a : btype === 'soft' ? b : Math.max(a, b);
  }
  function passes(s, S, now, noMv, ignoreMk) {
    if (!ignoreMk && S.mkTab !== 'all' && s.mk !== S.mkTab) return false;
    if (S.tiers.indexOf(s.tier) < 0) return false;
    if (!S.books.some(function (b) { return s.bk[b]; })) return false;
    var mv = movedAtOf(s);
    if (mv.t == null || (now - mv.t) / H > WIN_H[S.win]) return false;
    var c = calc(s.bk);
    if (!noMv && S.mv !== 'all' && mvOf(c) !== S.mv) return false;
    if (S.min > 0 && minValOf(c, S.btype) < S.min) return false;
    var q = String(S.q || '').trim().toLowerCase();
    if (q && fold([s.playerA, s.playerB, s.dA, s.dB, s.event].filter(Boolean).join(' ')).indexOf(fold(q)) < 0) return false;
    return true;
  }
  function view(sels, S, now) {
    var up = sels.filter(function (s) { return isUpcoming(s, now); });
    var list = up.filter(function (s) { return passes(s, S, now); });
    var mvBase = up.filter(function (s) { return passes(s, S, now, true); });
    var mvN = {}; MVL.forEach(function (x) { mvN[x[0]] = x[0] === 'all' ? mvBase.length : mvBase.filter(function (s) { return mvOf(calc(s.bk)) === x[0]; }).length; });
    var mkN = {}; up.forEach(function (s) { if (passes(s, S, now, false, true)) mkN[s.mk] = (mkN[s.mk] || 0) + 1; });
    var key = function (s) {
      if (S.sort === 'recent') return -(movedAtOf(s).t || 0);
      if (S.sort === 'soon') { var t = startMs(s); return t == null ? Infinity : t; }
      return -rankOf(calc(s.bk), S.btype);
    };
    list = list.map(function (s, i) { return { s: s, k: key(s), i: i }; })
      .sort(function (a, b) { return a.k - b.k || a.i - b.i; }).map(function (x) { return x.s; });
    var ranked = list.map(function (s) { var c = calc(s.bk); return S.btype === 'soft' ? c.soft.r : c.sharp; }).filter(function (r) { return r.kind === 'drop'; });
    var matches = {}; list.forEach(function (s) { matches[s.id.split('|').slice(0, 2).join('|')] = 1; });
    return { list: list, mvN: mvN, mkN: mkN, drops: ranked.length, biggest: ranked.length ? Math.max.apply(null, ranked.map(function (r) { return r.d; })) : null,
      nMatches: Object.keys(matches).length };
  }

  // ─── display strings (pure) ─────────────────────────────────────────────────
  function sgn(v) { return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(1); }
  // the file's cell(): one reading as the list / tiles show it
  function cell(r, big, lead, oneTxt, noneTxt) {
    var p = r.kind === 'drop' || r.kind === 'up' || r.kind === 'flat', moved = r.kind === 'drop' || r.kind === 'up';
    return { hasP: p, lead: p ? lead : '', open: p ? f2(r.o) : '', now: p ? f2(r.n) : '', strike: r.kind === 'drop',
      big: r.kind === 'drop' ? r.d.toFixed(1) : r.kind === 'up' ? '+' + Math.abs(r.d).toFixed(1) : r.kind === 'flat' ? 'No move' : '—',
      pct: moved ? '%' : '', tone: r.kind === 'drop' ? 'drop' : r.kind === 'flat' ? 'flat' : 'dim',
      fs: (r.kind === 'flat' ? Math.round(big * 0.72) : big) + 'px',
      impl: moved ? sgn(r.pts) + ' pts implied' : '', implShort: moved ? r.io.toFixed(1) + '% → ' + r.inn.toFixed(1) + '%' : '',
      shift: moved ? sgn(r.pts) + ' pts' : '', hasImpl: moved,
      note: r.kind === 'one' ? oneTxt : r.kind === 'none' ? noneTxt : '' };
  }
  function meterH(r) { return r.kind === 'drop' ? Math.min(100, Math.max(8, r.d / 40 * 100)).toFixed(0) + '%' : '0%'; }
  function sharpCell(c, big) {
    return cell(c.sharp, big, c.sharp.src === 'Bet105' ? 'Bet105' : '', '1 price recorded · ' + (c.sharp.n != null ? f2(c.sharp.n) : ''), 'No sharp line');
  }
  function softCell(c, big) {
    var so = c.soft;
    return cell(so.r, big, so.lead, so.quotes === 1 ? '1 soft book quoting, 1 price recorded' : so.quotes + ' soft books quoting, 1 price recorded each', 'No soft line');
  }
  function softCount(c) { var so = c.soft; return so.down + ' of ' + so.quotes + ' ' + (so.quotes === 1 ? 'soft book' : 'soft books') + ' down'; }
  function softLabel(c) { var so = c.soft; return so.two > 1 ? 'Soft books · average of ' + so.two : so.two === 1 ? 'Soft books · ' + so.lead : 'Soft books'; }
  function bestSub(c) { return !c.best ? '' : c.best.n > 1 ? 'Best · ' + c.best.book : c.best.book + ' only'; }
  function agoShort(ms) {   // the file's movedLbl: "16h ago" from an hour, "41m ago" under it
    if (!(ms >= 0)) return '—';
    var h = ms / H;
    return h >= 1 ? Math.round(h) + 'h ago' : Math.round(h * 60) + 'm ago';
  }
  function countdown(t, now) {
    if (t == null || now == null) return '';
    var m = Math.max(0, Math.round((t - now) / 60e3)), h = Math.floor(m / 60);
    return 'in ' + (h ? h + 'h ' + (m % 60) + 'm' : m + 'm');
  }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function startLbl(t, now) {   // "14:00", another day "Tue 02:00" (member zone)
    if (t == null) return '—';
    var a = zp(t), b = zp(now == null ? t : now);
    if (a.y === b.y && a.m === b.m && a.d === b.d) return hm(t);
    return WD[new Date(Date.UTC(a.y, a.m, a.d)).getUTCDay()] + ' ' + hm(t);
  }
  // the box's book rows (the file's `books`)
  function bookRow(name, o, best, chartRole) {
    var r = o ? rd(o.first, o.now) : { kind: 'none' };
    return { name: name, cls: BOOK_CLS[name], quoted: !!o, r: r, now: o ? f2(r2(o.now)) : '—', open: r.o != null ? f2(r.o) : '—',
      mv: r.kind === 'none' || r.kind === 'one' ? '' : r.kind === 'flat' ? 'No move' : r.kind === 'drop' ? r.d.toFixed(1) + '%' : '+' + Math.abs(r.d).toFixed(1) + '%',
      sub: r.kind === 'none' ? 'No line' : r.kind === 'one' ? 'One price recorded' : r.kind === 'flat' ? 'Implied unchanged' : 'Implied ' + sgn(r.pts) + ' pts',
      best: !!o && best != null && r2(o.now) === best, role: chartRole || null };
  }
  function bookSummary(rows) {
    var qd = rows.filter(function (b) { return b.quoted; }), dn = function (b) { return b.r.kind === 'drop'; };
    if (!qd.length) return 'No book quotes this line.';
    if (!qd.some(function (b) { return b.r.kind !== 'one'; })) return 'Quoted at ' + qd.length + ' of ' + rows.length + ' books, with one recorded price so far, so no drop yet.';
    return 'Down at ' + qd.filter(dn).length + ' of ' + qd.length + ' quoting this line (' + [['sharp', 'sharp', 'no sharp line'], ['soft', 'soft', 'no soft line']].map(function (g) {
      var q = qd.filter(function (b) { return b.cls === g[0]; });
      return q.length ? q.filter(dn).length + ' of ' + q.length + ' ' + g[1] : g[2];
    }).join(', ') + ').';
  }
  function groupMeta(rows) {
    var qn = rows.filter(function (b) { return b.quoted; }).length, nl = rows.length - qn;
    if (!qn) return 'No book quoting';
    return rows.filter(function (b) { return b.r.kind === 'drop'; }).length + ' of ' + qn + ' quoting book' + (qn === 1 ? '' : 's') + ' down' + (nl ? ' · ' + nl + ' with no line' : '');
  }
  // The price history (24 h window ending now). TEN-301 (founder, standing): a recorded price holds until the next one,
  // so the line is a STEP line — flat holds, vertical moves at each record — never a diagonal between two prices; the
  // last price runs on flat to now. A dot per recorded price inside the window; a price recorded before the window is
  // carried in from the left edge with no dot (it was not recorded there).
  function chartModel(lines, now) {
    var t0 = now - CHART_MS, span = CHART_MS, vs = [];
    var shaped = lines.map(function (L) {
      var s = L.series, inW = s.filter(function (p) { return p.t >= t0; }), before = s.filter(function (p) { return p.t < t0; }).pop();
      var path = [];
      if (before) path.push({ t: t0, v: before.v });
      inW.forEach(function (p) { if (path.length) path.push({ t: p.t, v: path[path.length - 1].v }); path.push({ t: p.t, v: p.v }); });
      if (path.length) path.push({ t: now, v: path[path.length - 1].v });
      path.forEach(function (p) { vs.push(p.v); });
      return { L: L, path: path, dots: inW };
    });
    if (!vs.length) return null;
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi - lo < 0.1) { lo -= 0.1; hi += 0.1; }
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    if (lo < 1) lo = 1;                   // decimal odds never go under 1.00 (drops.md r2 fix 11)
    var pY = function (v) { return (hi - v) / (hi - lo); }, fx = function (t) { return Math.max(0, Math.min(1, (t - t0) / span)); };
    var db = dayBands(t0, now);
    return {
      gridY: [0, 0.25, 0.5, 0.75, 1].map(function (g) { return { top: (g * 100) + '%', label: (hi - g * (hi - lo)).toFixed(2) }; }),
      ticks: [0, 0.25, 0.5, 0.75, 1].map(function (f) { return { left: (f * 100) + '%', tf: f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)', label: hm(t0 + f * span) }; }),
      bands: db.bands.map(function (b) { return { w: b.w, label: parseFloat(b.w) < 14 ? '' : b.label }; }), splits: db.splits,
      lines: shaped.map(function (x) {
        return { role: x.L.role, points: x.path.map(function (p) { return (fx(p.t) * 1000).toFixed(1) + ',' + (pY(p.v) * 300).toFixed(1); }).join(' '),
          dots: x.dots.map(function (p, i) { return { left: (fx(p.t) * 100).toFixed(2) + '%', top: (pY(p.v) * 100).toFixed(2) + '%', big: i === x.dots.length - 1 }; }) };
      }),
    };
  }

  var PURE = { BOOKS: BOOKS, rd: rd, calc: calc, mvOf: mvOf, buildSelections: buildSelections, pinnacleOf: pinnacleOf,
    movedAtOf: movedAtOf, isUpcoming: isUpcoming, defaults: defaults, passes: passes, view: view, rankOf: rankOf,
    cell: cell, sharpCell: sharpCell, softCell: softCell, softCount: softCount, softLabel: softLabel, bestSub: bestSub,
    meterH: meterH, bookRow: bookRow, bookSummary: bookSummary, groupMeta: groupMeta, chartModel: chartModel,
    agoShort: agoShort, countdown: countdown, startLbl: startLbl, feedState: feedState, ago: ago, clock: clock, nk: nk,
    lineKey: lineKey, tierOf: tierOf, boardKeyFor: boardKeyFor, photoKeyFor: photoKeyFor, kiblSame: kiblSame,
    rowMeta: rowMeta, nameIndex: nameIndex, indexHit: indexHit, shortName: shortName, canonToks: canonToks,
    dayBands: dayBands, ENDPOINT: ENDPOINT, AMBER_AFTER_S: AMBER_AFTER_S, DISCONNECTED_AFTER_S: DISCONNECTED_AFTER_S,
    TIERS: TIERS, WINDOWS: WINDOWS, MIN: MIN, MVL: MVL };
  if (typeof module === 'object' && module.exports) module.exports = PURE;
  // the Kibl name rule, shared with the Live page's in-play price join (founder 2026-11-26)
  if (typeof window === 'object' && window) window.KiblJoin = { same: kiblSame };
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
    S: defaults(), sels: [], feedRows: null, lines: null, status: null, statusAt: 0, reachable: true, everLoaded: false,
    refreshing: false, menu: null, tip: false, drawer: null, drBook: null, drPick: false, active: false, timer: null, ticker: null, etag: null,
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function root() { return document.getElementById('dropsRoot'); }
  function dataNow() {
    if (!st.status || !st.status.generatedAt) return Date.now();
    return Date.parse(st.status.serverNow || st.status.generatedAt) + (Date.now() - st.statusAt);
  }
  function ageS() {
    if (!st.status || st.status.ageS == null) return null;
    return st.status.ageS + (Date.now() - st.statusAt) / 1000;
  }
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
  // display strings, the board card (event, round, photo, analysis link) and Pinnacle from its chart shard
  function enrich() {
    var b = board(), ni = 0, np = 0;
    try { ni = typeof playerIndex !== 'undefined' && playerIndex ? playerIndex.length : 0; } catch (e) { ni = 0; }           // eslint-disable-line no-undef
    try { np = typeof ppRosterMap === 'function' ? Object.keys(ppRosterMap()).length : (typeof playerProfiles !== 'undefined' && playerProfiles ? Object.keys(playerProfiles).length : 0); } catch (e) { np = 0; }   // eslint-disable-line no-undef
    var sig = b.length + '|' + st.etag + '|' + st.sels.length + '|' + st.shardTick + '|' + ni + '|' + np;   // names follow the roster as it loads
    if (st.metaSig === sig) return;
    st.metaSig = sig;
    st.sels.forEach(function (s) {
      var m = rowMeta(s, b, HELP);
      s.dA = m.a; s.dB = m.b; s.dSide = m.side; s.dOpp = m.opp; s.event = m.event; s.card = m.card; s.cardSide = m.cardSide;
      var cs = null;
      try { cs = m.card && typeof cardStartMs === 'function' ? cardStartMs(m.card) : null; } catch (e) { cs = null; }   // eslint-disable-line no-undef
      s.cardStart = cs != null && isFinite(cs) ? cs : null;
      s.photoKey = photoKeyFor(s, b, typeof cardStartMs === 'function' ? cardStartMs : null);   // eslint-disable-line no-undef
      s.round = m.card && typeof roundBadgeText === 'function' && m.card.tournamentRound ? roundBadgeText(m.card.tournamentRound) : null;   // eslint-disable-line no-undef
      delete s.bk.Pinnacle;
      if (m.card) {
        if (!m.card._oddsLoaded && !m.card._doShardAsked && typeof ensureOddsMovement === 'function') {   // eslint-disable-line no-undef
          m.card._doShardAsked = true;
          ensureOddsMovement(m.card).then(function () { st.shardTick = (st.shardTick || 0) + 1; render(); }).catch(function () {});   // eslint-disable-line no-undef
        }
        var chart = m.card._oddsLoaded && m.card.oddsMovement ? m.card.oddsMovement.chart : null;
        var cut = s.cutAt || s.liveAt ? Date.parse(s.cutAt || s.liveAt) : null;
        var pin = pinnacleOf(chart, m.cardSide, isFinite(cut) ? cut : null);
        if (pin && !(pin.seen != null && dataNow() - pin.seen > QUOTING_MS)) s.bk.Pinnacle = pin;
      }
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
        st.feedRows = x[1].json.rows || []; st.lines = Array.isArray(x[1].json.lines) ? x[1].json.lines : [];
        st.etag = x[1].etag; st.metaSig = null;
        st.sels = buildSelections(st.lines, st.feedRows, dataNow());
      }
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
    load().then(function () { setTimeout(function () { st.refreshing = false; render(); schedule(); }, Math.max(0, 800 - (Date.now() - t0))); });
  }

  // ─── components (one each: switch track, meter, price box, box shell) ───────
  var CHEV = '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" stroke="var(--do2-grey)" stroke-width="1.4" fill="none" stroke-linecap="round"></path></svg>';
  var ROWCHEV = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5 3.5 8" stroke="var(--do2-dim)" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  var SEARCH = '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="5.5" stroke="var(--do2-grey)" stroke-width="1.7"></circle><path d="M13.2 13.2 17 17" stroke="var(--do2-grey)" stroke-width="1.7" stroke-linecap="round"></path></svg>';
  function track(label, opts) {   // opts: [[label, on, act, val, count]]
    return '<div class="do2-fg"><span class="do2-fl">' + esc(label) + '</span><div class="do2-track">' + opts.map(function (o) {
      return '<span class="do2-opt' + (o[1] ? ' on' : '') + '" role="button" tabindex="0" data-act="' + o[2] + '" data-v="' + esc(o[3]) + '">' + esc(o[0]) +
        (o[4] != null ? '<span class="do2-optn">' + esc(o[4]) + '</span>' : '') + '</span>';
    }).join('') + '</div></div>';
  }
  function meter(h, soft) {
    return '<span class="do2-meter' + (soft ? ' soft' : '') + '"><span style="height:' + h + '"></span></span>';
  }
  function priceBox(k) {
    return '<span class="do2-pbox' + (k.best ? ' best' : '') + '"><span class="do2-pbox-t"><span class="do2-pbox-n' + (k.quoted ? '' : ' none') + '">' + esc(k.now) + '</span>' +
      '<span class="do2-pbox-d' + (k.r.kind === 'drop' ? ' drop' : '') + '">' + esc(k.mv) + '</span></span>' +
      '<span class="do2-pbox-b"><span>Opening odd</span><span class="do2-pbox-o">' + esc(k.open) + '</span></span></span>';
  }
  function initials(name) {
    if (typeof fhIni === 'function') return fhIni(name);   // eslint-disable-line no-undef
    var w = String(name || '').replace(/\./g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    return w.length === 1 ? w[0].slice(0, 2).toUpperCase() : (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  function avatar(s) {
    var nm = s.dSide || s.side;
    var ph = (s.photoKey && typeof playerPhotoImg === 'function') ? playerPhotoImg(s.photoKey, nm) : '';   // eslint-disable-line no-undef
    return '<span class="do2-av" aria-hidden="true">' + esc(initials(nm)) + ph + '</span>';
  }
  function figHtml(cl, x) {   // a reading's figure + prices (the file's sh / so blocks)
    return '<span class="do2-' + cl + '-fig ' + x.tone + '" style="font-size:' + x.fs + '">' + esc(x.big) + '<span class="do2-pct">' + x.pct + '</span></span>';
  }
  function pricesHtml(cl, x) {
    return '<span class="do2-' + cl + '-px">' + (x.lead ? '<span class="do2-lead">' + esc(x.lead) + '</span>' : '') +
      '<span class="do2-open' + (x.strike ? ' strike' : '') + '">' + esc(x.open) + '</span><span class="do2-arr">→</span><span class="do2-now">' + esc(x.now) + '</span></span>';
  }

  // ─── page ───────────────────────────────────────────────────────────────────
  function headerHtml(v, blank) {
    var upd = st.everLoaded && st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—';
    var stat = function (k, val, dim) { return '<div class="do2-stat"><span class="do2-stat-l">' + k + '</span><span class="do2-stat-v' + (dim ? ' dim' : '') + '">' + esc(val) + '</span></div>'; };
    return '<div class="do2-card do2-head"><div class="do2-head-t"><h1>Dropping Odds</h1>' +
      '<div class="do2-head-s">Prices that have shortened since we first recorded them. Sharp and soft movement are read separately, biggest sharp drop first.</div></div>' +
      '<div class="do2-stats">' + stat('Drops', blank ? '—' : String(v.drops), blank) +
      stat('Biggest', !blank && v.biggest != null ? v.biggest.toFixed(1) + '%' : '—', blank || v.biggest == null) +
      stat('Updated', upd, upd === '—') + '</div></div>';
  }
  function bookMenuHtml() {
    var S = st.S, all = S.books.length === BOOK_NAMES.length, open = st.menu === 'book';
    var val = all ? 'All' : S.books.length === 1 ? S.books[0] : S.books.length + ' books';
    var groups = [['sharp', 'Sharp books'], ['soft', 'Soft books']].map(function (g) {
      return '<div class="do2-mhead">' + g[1] + '</div>' + BOOKS.filter(function (b) { return b[1] === g[0]; }).map(function (b) {
        var on = S.books.indexOf(b[0]) >= 0;
        return '<span class="do2-mopt' + (on ? ' on' : '') + '" role="menuitemcheckbox" aria-checked="' + on + '" tabindex="0" data-act="book" data-v="' + esc(b[0]) + '">' +
          '<span class="do2-tick">' + (on ? '✓' : '') + '</span><span class="do2-mopt-l">' + esc(b[0]) + '</span></span>';
      }).join('');
    }).join('');
    return '<div class="do2-mwrap"><span class="do2-mbtn' + (!all ? ' set' : '') + (open ? ' open' : '') + '" role="button" tabindex="0" data-act="menu" data-v="book">' +
      '<span class="do2-mbtn-l">Bookmaker</span><span class="do2-mbtn-v' + (all ? '' : ' set') + '">' + esc(val) + '</span>' +
      (all ? CHEV : '<span class="do2-x" role="button" tabindex="0" title="Clear" data-act="clear" data-v="book">×</span>') + '</span>' +
      (open ? '<div class="do2-menu do2-bmenu" role="menu">' + groups + '</div>' : '') + '</div>';
  }
  function filtersHtml(v) {
    var S = st.S;
    var active = S.tiers.length !== 3 || S.books.length !== BOOK_NAMES.length || S.win !== 'open' || S.min > 0 || S.mv !== 'all' || !!S.q;
    return '<div class="do2-card do2-filters"><div class="do2-frow">' +
      '<label class="do2-search">' + SEARCH + '<input data-act="q" placeholder="Search players" value="' + esc(S.q) + '" autocomplete="off"></label>' +
      bookMenuHtml() + (active ? '<span class="do2-btn do2-reset" role="button" tabindex="0" data-act="reset">Reset filters</span>' : '') + '</div>' +
      '<div class="do2-frow2">' +
      track('Tier', TIERS.map(function (t) { return [t, S.tiers.indexOf(t) >= 0, 'tier', t]; })) +
      track('Window', WINDOWS.map(function (w) { return [w[1], S.win === w[0], 'win', w[0]]; })) +
      track('Min drop', MIN.map(function (m) { return [m[1], S.min === m[0], 'min', m[0]]; })) +
      track('Movement', MVL.map(function (m) { return [m[1], S.mv === m[0], 'mv', m[0], st.everLoaded ? String(v.mvN[m[0]]) : '—']; })) +
      '</div></div>';
  }
  function bannerHtml() {
    return '<div class="do2-card do2-banner"><span class="do2-banner-l"><span class="do2-banner-dot"></span><span class="do2-banner-k">Feed disconnected</span>' +
      '<span class="do2-banner-t">Showing prices as of <span class="do2-mono do2-banner-v">' + esc(st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—') + '</span>. New moves appear once the feed reconnects.</span></span>' +
      '<span class="do2-btn do2-btn30" role="button" tabindex="0" data-act="reconnect">Reconnect</span></div>';
  }
  var TIP = '<span class="do2-tip" role="tooltip">' +
    '<span class="do2-tip-b"><span class="do2-tip-h">Drop %</span><span class="do2-tip-t">How far the price has fallen since we first recorded it. <span class="do2-tip-m">2.12 → 1.46</span> is a <span class="do2-tip-m">31.1%</span> drop.</span></span>' +
    '<span class="do2-tip-b"><span class="do2-tip-h">Pts implied</span><span class="do2-tip-t">A price implies a chance of winning: 1 divided by the price. <span class="do2-tip-m">2.12</span> is <span class="do2-tip-m">47.2%</span>, <span class="do2-tip-m">1.46</span> is <span class="do2-tip-m">68.5%</span>, so the market now gives this player <span class="do2-tip-m">+21.3</span> percentage points more chance. The bookmaker margin is still in the figure.</span></span>' +
    '<span class="do2-tip-b"><span class="do2-tip-h">Why both</span><span class="do2-tip-t">The same drop can mean very different things. <span class="do2-tip-m">5.30 → 3.65</span> is also a <span class="do2-tip-m">31.1%</span> drop, but only <span class="do2-tip-m">+8.5 pts</span>.</span></span>' +
    // the handoff's copy word for word (the "moves first" claim confirmed by the founder, 2026-11-23)
    '<span class="do2-tip-b"><span class="do2-tip-h">Sharp and soft</span><span class="do2-tip-t">Sharp is Pinnacle, which tends to move first. Soft is the average of the other bookmakers. The first recorded price is not necessarily the opening line.</span></span></span>';
  function listHeadHtml() {
    var S = st.S, sh = S.sort === 'drop' && S.btype !== 'soft', sf = S.sort === 'drop' && S.btype === 'soft', so = S.sort === 'soon';
    return '<div class="do2-lhead"><span class="do2-lh-sharp"><span class="do2-hc' + (sh ? ' on' : '') + '" role="button" tabindex="0" data-act="sort" data-v="sharp" title="Rank by the sharp drop">Sharp · Pinnacle</span>' +
      '<span class="do2-harr">' + (sh ? '↓' : '') + '</span><span class="do2-q' + (st.tip ? ' open' : '') + '" role="button" tabindex="0" data-act="tip" title="How to read these figures">?</span>' + TIP + '</span>' +
      '<span>Selection</span><span class="do2-hc' + (sf ? ' on' : '') + '" role="button" tabindex="0" data-act="sort" data-v="soft" title="Rank by the soft drop">Soft books<span class="do2-harr2">' + (sf ? '↓' : '') + '</span></span>' +
      '<span>Price now</span><span class="do2-hc do2-hstart' + (so ? ' on' : '') + '" role="button" tabindex="0" data-act="sort" data-v="soon" title="Starting soonest first">Starts<span>' + (so ? '↓' : '') + '</span></span><span></span></div>';
  }
  function rowHtml(s, now) {
    var c = calc(s.bk), sh = sharpCell(c, 23), so = softCell(c, 15), mv = movedAtOf(s), t = startMs(s);
    var sub = ['vs ' + (s.dOpp || s.opp), s.event, (mv.moved ? 'moved ' : 'first recorded ') + agoShort(now - mv.t)].filter(Boolean).join(' · ');
    return '<div class="do2-row" role="button" tabindex="0" data-act="row" data-v="' + esc(s.id) + '" title="Show the price history">' +
      '<span class="do2-c-sharp">' + meter(meterH(c.sharp)) + '<span class="do2-c-in">' +
      '<span class="do2-figline">' + figHtml('sh', sh) + '<span class="do2-impl">' + esc(sh.impl) + '</span></span>' +
      (sh.hasP ? pricesHtml('sh', sh) : '<span class="do2-note">' + esc(sh.note) + '</span>') + '</span></span>' +
      '<div class="do2-c-sel">' + avatar(s) + '<div class="do2-c-in"><span class="do2-sel">' + esc((s.dSide || s.side) + ' to win') + '</span>' +
      '<span class="do2-sub">' + esc(sub) + '</span></div></div>' +
      '<span class="do2-c-soft">' + meter(meterH(c.soft.r), true) + '<span class="do2-c-in do2-c-in5">' +
      '<span class="do2-figline">' + figHtml('so', so) + '<span class="do2-impl12">' + esc(so.impl) + '</span></span>' +
      (so.hasP ? pricesHtml('so', so) : '<span class="do2-note">' + esc(so.note) + '</span>') +
      (c.soft.two > 0 ? '<span class="do2-count">' + esc(softCount(c)) + '</span>' : '') + '</span></span>' +
      '<span class="do2-c-best"><span class="do2-best">' + (c.best ? f2(c.best.price) : '—') + '</span><span class="do2-sub">' + esc(bestSub(c)) + '</span></span>' +
      '<span class="do2-c-start"><span class="do2-start">' + esc(startLbl(t, now)) + '</span><span class="do2-cd">' + esc(countdown(t, now)) + '</span></span>' +
      ROWCHEV + '</div>';
  }
  function listHtml(v, fs) {
    var S = st.S;
    var tabs = [['all', 'All markets', st.everLoaded ? Object.keys(v.mkN).reduce(function (a, k) { return a + v.mkN[k]; }, 0) : '—']]
      .concat(Object.keys(MK).filter(function (k) { return v.mkN[k]; }).map(function (k) { return [k, MK[k], v.mkN[k]]; }));
    var sorts = [['Biggest sharp drop', S.sort === 'drop' && S.btype !== 'soft', 'sort', 'sharp'], ['Biggest soft drop', S.sort === 'drop' && S.btype === 'soft', 'sort', 'soft'],
      ['Latest move', S.sort === 'recent', 'sort', 'recent'], ['Starting soonest', S.sort === 'soon', 'sort', 'soon']];
    var loading = st.refreshing || (!st.everLoaded && st.reachable);
    var count = loading ? 'Loading selections…' : !st.everLoaded ? '—' :
      v.list.length + ' ' + (v.list.length === 1 ? 'selection' : 'selections') + ' across ' + v.nMatches + ' ' + (v.nMatches === 1 ? 'match' : 'matches');
    var body;
    if (loading) {
      body = '<div class="do2-skels">' + [['62%', '44%'], ['54%', '38%'], ['70%', '48%'], ['58%', '40%'], ['66%', '46%'], ['50%', '36%'], ['60%', '42%']].map(function (w) {
        return '<div class="do2-skel"><span class="do2-sk1"></span><span class="do2-sk2"><span class="do2-sk-av"></span><span class="do2-sk-t"><span class="do2-sk-l1" style="width:' + w[0] + '"></span><span class="do2-sk-l2" style="width:' + w[1] + '"></span></span></span><span class="do2-sk3"></span></div>';
      }).join('') + '</div>';
    } else if (!st.everLoaded) {
      body = '';
    } else if (!v.list.length) {
      body = '<div class="do2-empty"><span class="do2-empty-h">No selections match these filters</span><span class="do2-empty-d">Minimum drop ' +
        esc(MIN.filter(function (m) { return m[0] === S.min; })[0][1]) + ' · ' + esc(WIN_TXT[S.win]) + '</span>' +
        '<span class="do2-btn do2-btn34" role="button" tabindex="0" data-act="reset">Reset filters</span></div>';
    } else {
      var now = dataNow();
      body = '<div class="do2-rows">' + v.list.map(function (s) { return rowHtml(s, now); }).join('') + '</div>';
    }
    return '<div class="do2-card do2-list' + (fs === 'disconnected' ? ' stale' : '') + '"><div class="do2-ltop"><div class="do2-tabs">' + tabs.map(function (t) {
      var on = S.mkTab === t[0];
      return '<span class="do2-tab' + (on ? ' on' : '') + '" role="button" tabindex="0" data-act="mk" data-v="' + t[0] + '">' + esc(t[1]) + '<span class="do2-tabn">' + esc(t[2]) + '</span></span>';
    }).join('') + '</div><div class="do2-sortw">' + track('Sort by', sorts) + '</div></div>' +
      '<span class="do2-countline">' + esc(count) + '</span>' +
      '<div class="do2-lbox">' + listHeadHtml() + body + '</div></div>';
  }
  // ─── phone (under 820px): the export's isMob block (README "Mobile"; the top-bar Refresh / Alerts, the alerts sheet,
  // the demo chip beside the title, the placeholder footnote and the LIVE status line are not built) ───────────────────────────
  var MOBILE_MAX = 819;
  function isMobile() { try { return window.innerWidth <= MOBILE_MAX; } catch (e) { return false; } }
  function nActive(S) { return [S.tiers.length !== 3, S.books.length !== BOOK_NAMES.length, S.win !== 'open', S.min > 0, S.mv !== 'all'].filter(Boolean).length; }
  function sortLabel(S) { return S.sort === 'recent' ? 'Latest move' : S.sort === 'soon' ? 'Starting soonest' : S.btype === 'soft' ? 'Biggest soft drop' : 'Biggest sharp drop'; }
  function mChip(label, on, act, val) {
    return '<span class="do2-mchip' + (on ? ' on' : '') + '" role="button" tabindex="0" data-act="' + act + '" data-v="' + esc(val) + '">' + esc(label) + '</span>';
  }
  function mCardHtml(s, now) {
    var c = calc(s.bk), sh = sharpCell(c, 21), so = softCell(c, 15), mv = movedAtOf(s), t = startMs(s);
    sh.fs = c.sharp.kind === 'flat' ? '15px' : '21px';   // the export's fsM
    var sub = ['Match winner', 'vs ' + (s.dOpp || s.opp), s.event].filter(Boolean).join(' · ');
    var px = function (x, cls) { return x.hasP ? '<span class="do2-m-px ' + cls + '">' + (x.lead ? '<span class="do2-lead">' + esc(x.lead) + '</span>' : '') +
      '<span class="do2-open' + (x.strike ? ' strike' : '') + '">' + esc(x.open) + '</span><span class="do2-arr">→</span><span class="do2-now">' + esc(x.now) + '</span></span>' : '<span class="do2-m-note">' + esc(x.note) + '</span>'; };
    return '<div class="do2-mcard" role="button" tabindex="0" data-act="row" data-v="' + esc(s.id) + '">' +
      '<div class="do2-m-who">' + avatar(s) + '<div class="do2-c-in"><span class="do2-m-sel">' + esc((s.dSide || s.side) + ' to win') + '</span><span class="do2-m-sub">' + esc(sub) + '</span></div></div>' +
      '<div class="do2-m-grid"><span class="do2-m-sharp"><span class="do2-m-meter"><span style="height:' + meterH(c.sharp) + '"></span></span><span class="do2-m-col">' +
      '<span class="do2-m-lbl">' + (c.sharp.src === 'Bet105' ? 'Sharp · Bet105 (no margin)' : 'Sharp · Pinnacle') + '</span>' +
      '<span class="do2-m-fig"><span class="do2-sh-fig ' + sh.tone + '" style="font-size:' + sh.fs + '">' + esc(sh.big) + '<span class="do2-m-pct">' + sh.pct + '</span></span><span class="do2-m-impl">' + esc(sh.impl) + '</span></span>' + px(sh, 'sh') + '</span></span>' +
      '<span class="do2-m-col"><span class="do2-m-lbl">Soft books</span>' +
      '<span class="do2-m-fig"><span class="do2-so-fig ' + so.tone + '" style="font-size:' + so.fs + '">' + esc(so.big) + '<span class="do2-m-pct">' + so.pct + '</span></span><span class="do2-m-impl">' + esc(so.impl) + '</span></span>' + px(so, 'so') +
      (c.soft.two > 0 ? '<span class="do2-m-count">' + esc(softCount(c)) + '</span>' : '') + '</span></div>' +
      '<div class="do2-m-foot"><span class="do2-m-best">' + (c.best && c.best.n > 1 ? 'Best now' : 'Now') + '<span class="do2-m-bestp">' + (c.best ? f2(c.best.price) : '—') + '</span><span>· ' + esc(c.best ? c.best.book : '—') + '</span></span>' +
      '<span class="do2-m-when">' + esc(startLbl(t, now) + ' · ' + (mv.moved ? 'moved ' : 'first recorded ') + agoShort(now - mv.t)) + '</span></div></div>';
  }
  function sheetHtml(v) {
    var S = st.S;
    var g = function (title, chips) { return '<div class="do2-sg"><span class="do2-sg-t">' + title + '</span><div class="do2-sg-c">' + chips + '</div></div>'; };
    return '<div class="do2-sheet-scrim" data-act="sheetclose"></div><div class="do2-sheet" role="dialog" aria-modal="true" aria-label="Filters">' +
      '<div class="do2-sheet-h"><span class="do2-sheet-reset" role="button" tabindex="0" data-act="reset">Reset</span><span class="do2-sheet-t">Filters</span>' +
      '<span class="do2-sheet-x" role="button" tabindex="0" data-act="sheetclose" aria-label="Close">✕</span></div><div class="do2-sheet-b">' +
      g('TIER · MEN ONLY', TIERS.map(function (t) { return mChip(t, S.tiers.indexOf(t) >= 0, 'tier', t); }).join('')) +
      g('BOOK TYPE', [['all', 'All'], ['sharp', 'Sharp'], ['soft', 'Soft']].map(function (b) { return mChip(b[1], S.btype === b[0], 'btype', b[0]); }).join('')) +
      g('MOVEMENT', MVL.map(function (m) { return mChip(m[1], S.mv === m[0], 'mv', m[0]); }).join('')) +
      g('BOOKMAKER · SHARP', BOOKS.filter(function (b) { return b[1] === 'sharp'; }).map(function (b) { return mChip(b[0], S.books.indexOf(b[0]) >= 0, 'book', b[0]); }).join('')) +
      g('BOOKMAKER · SOFT', BOOKS.filter(function (b) { return b[1] === 'soft'; }).map(function (b) { return mChip(b[0], S.books.indexOf(b[0]) >= 0, 'book', b[0]); }).join('')) +
      g('WINDOW', WINDOWS.map(function (w) { return mChip(w[1], S.win === w[0], 'win', w[0]); }).join('')) +
      g('MIN DROP', MIN.map(function (m) { return mChip(m[1], S.min === m[0], 'min', m[0]); }).join('')) +
      g('SORT', [['drop', S.btype === 'soft' ? 'Biggest soft drop' : 'Biggest sharp drop'], ['recent', 'Latest move'], ['soon', 'Starting soonest']].map(function (o) { return mChip(o[1], S.sort === o[0], 'msort', o[0]); }).join('')) +
      '</div><div class="do2-sheet-f"><span class="do2-sheet-cta" role="button" tabindex="0" data-act="sheetclose">Show ' + v.list.length + ' ' + (v.list.length === 1 ? 'selection' : 'selections') + '</span></div></div>';
  }
  function mobileHtml(v, fs) {
    var S = st.S, n = nActive(S), loading = st.refreshing || (!st.everLoaded && st.reachable), now = dataNow(), body;
    if (loading) body = [['62%', '44%'], ['54%', '38%'], ['70%', '48%'], ['58%', '40%'], ['66%', '46%'], ['50%', '36%']].map(function (w) {
      return '<div class="do2-mskel"><span class="do2-mskel-a"></span><span class="do2-mskel-t"><span style="width:' + w[0] + '"></span><span style="width:' + w[1] + '"></span><span class="l3"></span></span><span class="do2-mskel-c"></span></div>'; }).join('');
    else if (!st.everLoaded) body = '';
    else if (!v.list.length) body = '<div class="do2-mempty"><span class="do2-mempty-h">No selections match these filters</span><span class="do2-mempty-d">Minimum drop ' +
      esc(MIN.filter(function (m) { return m[0] === S.min; })[0][1]) + ' · ' + esc(WIN_TXT[S.win]) + '</span><span class="do2-mempty-r" role="button" tabindex="0" data-act="reset">Reset filters</span></div>';
    else body = v.list.map(function (s) { return mCardHtml(s, now); }).join('');
    return '<div class="do2-mwrapper"><div class="do2-mtitle"><h1>Dropping Odds</h1></div>' +
      (fs === 'disconnected' && (st.everLoaded || !st.reachable) ? '<div class="do2-mdisc"><span class="do2-mdisc-h"><span class="do2-mdisc-k">FEED DISCONNECTED</span><span class="do2-mdisc-r" role="button" tabindex="0" data-act="reconnect">Reconnect</span></span>' +
        '<span class="do2-mdisc-t">Showing prices as of <span class="do2-mono do2-banner-v">' + esc(st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—') + '</span>.</span></div>' : '') +
      '<label class="do2-msearch">' + SEARCH.replace('width="15" height="15"', 'width="14" height="14"') + '<input data-act="q" placeholder="Search players" value="' + esc(S.q) + '" autocomplete="off"></label>' +
      '<div class="do2-mbtns"><span class="do2-mbtn2" role="button" tabindex="0" data-act="sheet"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5.5h14M6 10h8M8.5 14.5h3" stroke="var(--do2-grey)" stroke-width="1.7" stroke-linecap="round"></path></svg>Filters' +
      (n ? '<span class="do2-mbadge">' + n + '</span>' : '') + '</span><span class="do2-mbtn2 sort" role="button" tabindex="0" data-act="sheet"><span class="do2-msort-l">Sort</span><span class="do2-msort-v">' + esc(sortLabel(S)) + '</span></span></div>' +
      '<div class="do2-mhow"><span class="do2-mhow-l" role="button" tabindex="0" data-act="tip"><span class="do2-q' + (st.tip ? ' open' : '') + '">?</span>How to read these figures</span>' + (st.tip ? TIP.replace('class="do2-tip"', 'class="do2-tip do2-tip-m"') : '') + '</div>' +
      '<div class="do2-mchips">' + Object.keys(MK).map(function (k) { return mChip(MK[k], S.mkTab === 'all' || S.mkTab === k, 'mk', k); }).join('') + '</div>' +
      '<div class="do2-mlist' + (fs === 'disconnected' ? ' stale' : '') + '">' + body + '</div>' + (st.sheet ? sheetHtml(v) : '') + '</div>';
  }

  function render() {
    var el = root();
    if (!el) return;
    var ae = document.activeElement, focusQ = ae && ae.getAttribute && ae.getAttribute('data-act') === 'q', caret = focusQ ? ae.selectionStart : null;
    enrich();
    var now = dataNow(), v = view(st.sels, st.S, now), fs = feedState(ageS(), st.reachable);
    st.mobile = isMobile();
    if (st.mobile) el.innerHTML = '<div class="do2-wrap do2-m">' + mobileHtml(v, fs) + '</div>';
    else el.innerHTML = '<div class="do2-wrap">' + headerHtml(v, !st.everLoaded) + filtersHtml(v) +
      (fs === 'disconnected' && (st.everLoaded || !st.reachable) ? bannerHtml() : '') + listHtml(v, fs) +
      (st.menu ? '<div class="do2-clickaway" data-act="clickaway"></div>' : '') + '</div>';
    if (focusQ) { var q = el.querySelector('[data-act="q"]'); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} }
    renderModal();
  }

  // ─── the price move box (the box shell: one component) ─────────────────────
  function closeModal() { st.drawer = null; st.drBook = null; st.drPick = false; st.tip = false; renderModal(); }
  (window.sfOverlayClosers = window.sfOverlayClosers || []).push(function () { if (st.drawer) closeModal(); });
  function tile(cls, label, figHtmlStr, rightHtml, lines) {
    return '<div class="do2-tile ' + cls + '"><span class="do2-tile-l">' + esc(label) + '</span>' +
      '<span class="do2-tile-top">' + figHtmlStr + rightHtml + '</span><span class="do2-hair"></span>' +
      '<span class="do2-tile-lines">' + lines.map(function (l) {
        return l[1] == null ? '<span>' + esc(l[0]) + '</span>' : '<span class="do2-kv"><span>' + esc(l[0]) + '</span><span class="do2-kv-v">' + esc(l[1]) + '</span></span>';
      }).join('') + '</span></div>';
  }
  function boxHtml(s) {
    var now = dataNow(), bk = s.bk, c = calc(bk), sh = sharpCell(c, 28), so = softCell(c, 22), t = startMs(s);
    // the sharp line (blue): Pinnacle, else Bet105 without its margin; its source book is not offered for comparison
    var sk = sharpKey(bk), sharpBook = sk === 'Pinnacle' ? 'Pinnacle' : sk ? 'Bet105' : null;
    var sharpName = sk === 'Pinnacle' ? 'Pinnacle' : 'Bet105 (no margin)';
    var quoted = BOOK_NAMES.filter(function (b) { return bk[b]; }), nonPin = quoted.filter(function (b) { return b !== sharpBook; });
    var def = nonPin[0]; nonPin.forEach(function (b) { if (r2(bk[b].now) > r2(bk[def].now)) def = b; });
    var sel = st.drBook && bk[st.drBook] && st.drBook !== sharpBook ? st.drBook : def;
    var pinOn = !!sk;
    var roles = {}; if (sel) roles[sel] = 'sel'; if (pinOn) roles[sharpBook] = 'pin';
    var best = c.best ? c.best.price : null;
    var rows = BOOK_NAMES.map(function (n) { return bookRow(n, bk[n], best, roles[n]); });
    var pinMv = sk && bk[sk].moveT != null ? agoShort(now - bk[sk].moveT) : '—';
    var sub = ['Match winner', 'vs ' + (s.dOpp || s.opp), s.event, s.round].filter(Boolean).join(' · ');
    var nm = (s.dSide || s.side) + ' to win';
    var head = '<div class="do2-bhead">' + avatar(s) + '<div class="do2-bhead-t"><span class="do2-btitle" id="do2BoxTitle">' + esc(nm) + '</span><span class="do2-bsub">' + esc(sub) + '</span></div>' +
      (s.card && s.card.id != null ? '<span class="do2-btn do2-btn30" role="button" tabindex="0" data-act="analysis" data-v="' + esc(s.card.id) + '">Match analysis</span>' : '') +
      '<span class="do2-btn do2-btn30" role="button" tabindex="0" data-act="close">Close</span></div>';
    var px = function (cl, x) { return x.hasP ? pricesHtml(cl, x) : ''; };
    var tiles = '<div class="do2-tiles">' +
      tile('lift', 'Sharp · ' + (sk ? sharpName : 'Pinnacle'), '<span class="do2-tfig28 ' + sh.tone + '">' + esc(sh.big) + sh.pct + '</span>', px('tsh', sh),
        (sh.hasP ? [] : [[sh.note]]).concat(sh.hasImpl ? [['Implied', sh.implShort], ['Shift', sh.shift], ['Last move', pinMv]] : [])) +
      tile('', softLabel(c), '<span class="do2-tfig22 ' + (so.tone === 'drop' ? 'soft' : so.tone) + '">' + esc(so.big) + so.pct + '</span>', px('tso', so),
        (so.hasP ? [] : [[so.note]]).concat(so.hasImpl ? [['Implied', so.implShort], ['Shift', so.shift]] : []).concat(c.soft.two > 0 ? [['Books down', c.soft.down + ' of ' + c.soft.quotes]] : [])) +
      tile('', c.best && c.best.n > 1 ? 'Best now' : 'Now', '<span class="do2-tfig22">' + (c.best ? f2(c.best.price) : '—') + '</span>', '<span class="do2-tbook">' + esc(c.best ? c.best.book : '') + '</span>',
        [['Quoting', quoted.length + ' of ' + BOOK_NAMES.length], ['Starts', startLbl(t, now)], ['Countdown', countdown(t, now)]]) + '</div>';
    // chart
    var lines = []; if (pinOn) lines.push({ role: 'pin', series: bk[sk].series }); if (sel) lines.push({ role: 'sel', series: bk[sel].series });
    var ch = chartModel(lines, now);
    var legend = (pinOn ? [sk] : []).concat(sel ? [sel] : []).map(function (n) {
      var r = rd(bk[n].first, bk[n].now), lbl = n === sk ? sharpName : n;
      var txt = r.kind === 'one' ? f2(r.n) + ' · 1 price recorded' : f2(r.o) + ' → ' + f2(r.n);
      var d = r.kind === 'drop' ? r.d.toFixed(1) + '%' : r.kind === 'flat' ? 'No move' : r.kind === 'up' ? '+' + Math.abs(r.d).toFixed(1) + '%' : '';
      return '<span class="do2-leg"><span class="do2-leg-bar ' + (n === sk ? 'pin' : 'sel') + '"></span><span class="do2-leg-n">' + esc(lbl) + '</span>' +
        '<span class="do2-leg-t">' + esc(txt) + '</span><span class="do2-leg-d' + (r.kind === 'drop' ? ' drop' : '') + '">' + esc(d) + '</span></span>';
    }).join('');
    var pickOpts = [['sharp', 'Sharp books'], ['soft', 'Soft books']].map(function (g) {
      var o = rows.filter(function (k) { return k.cls === g[0] && k.quoted && k.name !== sharpBook; });
      return o.length ? '<div class="do2-mhead">' + g[1] + '</div>' + o.map(function (k) {
        return '<span class="do2-popt' + (k.name === sel ? ' on' : '') + '" role="menuitem" tabindex="0" data-act="drbook" data-v="' + esc(k.name) + '"><span class="do2-mopt-l">' + esc(k.name) + '</span><span class="do2-popt-n">' + esc(k.now) + '</span></span>';
      }).join('') : '';
    }).join('');
    var picker = nonPin.length < 2 ? '' : '<div class="do2-mwrap"><span class="do2-pbtn' + (st.drPick ? ' open' : '') + '" role="button" tabindex="0" data-act="drpick">' +
      '<span class="do2-mbtn-l">' + (bk.Pinnacle ? 'Compare with Pinnacle' : 'Bookmaker') + '</span><span class="do2-mbtn-v set">' + esc(sel) + '</span>' + CHEV + '</span>' +
      (st.drPick ? '<div class="do2-pickaway" data-act="drpick"></div><div class="do2-menu do2-pmenu" role="menu">' + pickOpts + '</div>' : '') + '</div>';
    var plot = !ch ? '' : '<div class="do2-chart"><div class="do2-chart-r"><div class="do2-ylab">' + ch.gridY.map(function (g) { return '<span style="top:' + g.top + '">' + g.label + '</span>'; }).join('') + '</div>' +
      '<div class="do2-plot"><svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">' +
      ch.splits.map(function (x) { return '<line x1="' + x + '" y1="0" x2="' + x + '" y2="300" class="do2-split" vector-effect="non-scaling-stroke"></line>'; }).join('') +
      ch.lines.map(function (l) { return '<polyline points="' + l.points + '" class="do2-ln ' + l.role + '" vector-effect="non-scaling-stroke"></polyline>'; }).join('') + '</svg>' +
      ch.lines.map(function (l) { return l.dots.map(function (d) { return '<span class="do2-dot ' + l.role + (d.big ? ' big' : '') + '" style="left:' + d.left + ';top:' + d.top + '"></span>'; }).join(''); }).join('') +
      '</div></div><div class="do2-xt">' + ch.ticks.map(function (x) { return '<span style="left:' + x.left + ';transform:' + x.tf + '">' + x.label + '</span>'; }).join('') + '</div>' +
      '<div class="do2-days">' + ch.bands.map(function (b) { return '<div style="width:' + b.w + '"><span></span><span>' + esc(b.label) + '</span></div>'; }).join('') + '</div></div>';
    var notes = [sel && bk[sel].first == null ? 'One price recorded at ' + sel + ' so far. Its line appears once a second snapshot arrives.' : '',
      !sk ? 'Pinnacle has no line on this selection, so the chart has no sharp overlay.' : '',
      sk && sk !== 'Pinnacle' ? 'Pinnacle has no line on this selection, so the sharp line is Bet105 with its margin removed.' : ''].filter(Boolean);
    var hist = '<div class="do2-ibox do2-hist"><div class="do2-hist-h"><span class="do2-sec"><span class="do2-sec-h">Price history</span><span class="do2-sec-s">Last 24 hours · each dot is a recorded price</span></span>' +
      '<div class="do2-hist-m">' + picker + '</div></div><div class="do2-legend">' + legend + '</div>' + plot +
      (notes.length ? '<div class="do2-notes">' + notes.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('') + '</div>' : '') + '</div>';
    var group = function (cls, label, desc) {
      var gr = rows.filter(function (k) { return k.cls === cls; });
      return '<div class="do2-ibox do2-bgroup"><div class="do2-bg-h"><span class="do2-bg-t"><span class="do2-bg-n">' + label + '</span><span class="do2-bg-d">' + desc + '</span></span>' +
        '<span class="do2-bg-m">' + esc(groupMeta(gr)) + '</span></div><div class="do2-bg-col"><span>Bookmaker</span><span class="do2-bg-col2"><span>Price now</span><span>Drop</span></span></div>' +
        gr.map(function (k) {
          var tip = !k.quoted ? k.name + ' has no line on this selection' : k.role ? k.name + ' is on the chart' : 'Show ' + k.name + ' on the chart';
          return '<div class="do2-brow' + (k.role ? ' on' : '') + (k.quoted ? ' q' : '') + '"' + (k.quoted ? ' role="button" tabindex="0" data-act="drbook" data-v="' + esc(k.name) + '"' : '') + ' title="' + esc(tip) + '">' +
            '<span class="do2-brow-l"><span class="do2-brow-n">' + (k.role ? '<span class="do2-bdot ' + k.role + '"></span>' : '') + '<span class="do2-brow-name' + (k.quoted ? '' : ' none') + '">' + esc(k.name) + '</span></span>' +
            '<span class="do2-brow-s">' + esc(k.sub) + '</span></span>' + priceBox(k) + '</div>';
        }).join('') + '</div>';
    };
    var books = '<div class="do2-books"><span class="do2-sec"><span class="do2-sec-h">Bookmakers</span><span class="do2-sec-s">' + esc(bookSummary(rows)) + '</span></span>' +
      '<div class="do2-bcols"><div class="do2-bcol">' + group('sharp', 'Sharp books', 'Low margin, first to move') + '</div>' +
      '<div class="do2-bcol">' + group('soft', 'Soft books', 'Higher margin, slower to move') + '</div></div>' +
      '<span class="do2-foot">Each drop compares a book\'s own first recorded price with its own current price.</span></div>';
    return '<div class="do2-scrim" data-act="close"></div><div class="do2-box" role="dialog" aria-modal="true" aria-labelledby="do2BoxTitle">' + head +
      '<div class="do2-body">' + tiles + hist + books + '</div></div>';
  }
  function renderModal() {
    var ov = document.getElementById('do2Overlay');
    var s = st.drawer && st.sels.filter(function (x) { return x.id === st.drawer; })[0];
    if (!s) { if (ov) ov.remove(); st.boxKey = null; return; }
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'do2Overlay'; ov.className = 'do2-ov';
      document.body.appendChild(ov);
      ov.addEventListener('click', onClick);
    }
    var html = boxHtml(s);
    if (html === st.boxHtml && st.boxKey === s.id) return;   // rebuilt only when what it shows changes
    var body = ov.querySelector('.do2-body'), keep = st.boxKey === s.id && body ? body.scrollTop : 0;
    ov.innerHTML = html; st.boxHtml = html; st.boxKey = s.id;
    var nb = ov.querySelector('.do2-body'); if (nb) nb.scrollTop = keep;
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
    switch (act) {
      case 'tier': S.tiers = toggle(S.tiers, v, true); break;
      case 'win': S.win = v; break;
      case 'min': S.min = +v; break;
      case 'mv': S.mv = v; break;
      case 'mk': S.mkTab = v; break;
      case 'sort':
        if (v === 'sharp') { S.sort = 'drop'; S.btype = 'all'; } else if (v === 'soft') { S.sort = 'drop'; S.btype = 'soft'; } else S.sort = v;
        break;
      case 'menu': st.menu = st.menu === v ? null : v; break;
      case 'clickaway': st.menu = null; break;
      case 'clear': e.stopPropagation(); S.books = BOOK_NAMES.slice(); st.menu = null; break;
      case 'book': S.books = toggle(S.books, v, true); break;    // multi-select, the menu stays open; one stays on
      case 'reset': st.S = defaults(); st.menu = null; break;
      case 'btype': S.btype = v; break;
      case 'msort': S.sort = v; break;
      case 'sheet': st.sheet = true; break;
      case 'sheetclose': st.sheet = false; break;
      case 'reconnect': refresh(); return;
      case 'tip': st.tip = !st.tip; break;
      case 'row': st.drawer = v; st.drBook = null; st.drPick = false; st.tip = false; st.menu = null; render(); return;
      case 'close': closeModal(); return;
      case 'drpick': st.drPick = !st.drPick; renderModal(); return;
      case 'drbook': st.drBook = v; st.drPick = false; renderModal(); return;
      case 'analysis':
        closeModal();
        if (typeof openAnalysisModal === 'function') openAnalysisModal(v);   // eslint-disable-line no-undef
        return;
      default: return;
    }
    render();
  }
  function onInput(e) { if (e.target.getAttribute('data-act') === 'q') { st.S.q = e.target.value; render(); } }
  function onKey(e) {
    var a = e.target.closest && e.target.closest('#dropsRoot [role="button"][data-act], #dropsRoot [role="menuitemcheckbox"], .do2-ov [data-act][tabindex]');
    if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); a.click(); }
  }
  function setActive(on) {
    st.active = !!on;
    clearTimeout(st.timer); clearInterval(st.ticker);
    if (!st.active) { closeModal(); return; }
    render();
    load().then(function () { render(); schedule(); });
    st.ticker = setInterval(function () { if (!st.menu && !st.tip) render(); }, 5000);   // the data-time labels between reads
  }
  function boot() {
    var btn = document.getElementById('dropsTabBtn');
    if (btn) btn.style.display = '';
    var el = root();
    if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    window.addEventListener('resize', function () { if (st.active && isMobile() !== st.mobile) render(); });   // the 820px switch
    document.addEventListener('keydown', onKey);   // Enter / Space on the page's buttons; Escape is esc-nav.js's alone
    // Esc (esc-nav.js, one layer per press, highest z first): the box's compare menu, then the box, then a page menu / the explainer
    (window.sfEscLayers = window.sfEscLayers || []).push(
      { id: 'drops-box-menu', z: 77, isOpen: function () { return !!(st.drawer && st.drPick); }, close: function () { st.drPick = false; renderModal(); } },
      { id: 'drops-drawer', z: 76, isOpen: function () { return !!st.drawer; }, close: closeModal },
      { id: 'drops-sheet', z: 74, isOpen: function () { return !st.drawer && !!st.sheet; }, close: function () { st.sheet = false; render(); } },
      { id: 'drops-menu', z: 60, isOpen: function () { return !st.drawer && !!(st.menu || st.tip); }, close: function () { st.menu = null; st.tip = false; render(); } });
    var page = el.closest('.tabpage');
    if (page && page.classList.contains('active')) setActive(true);
  }
  window.DropsPage = { setActive: setActive, _state: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
