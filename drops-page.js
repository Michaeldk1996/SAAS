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
  // Prediction markets (founder 2026-11-28: "link it"): Polymarket and Kalshi, from our own recorders through the
  // endpoint's lines when it carries them; never a sharp or soft reading, only their own line, row and the best price.
  var PRED_BOOKS = [['Polymarket', 'pred'], ['Kalshi', 'pred']];
  function BOOK_NAMES3() { return BOOKS.concat(PRED_BOOKS).map(function (b) { return b[0]; }); }
  var BOOK_CLS = {}; BOOKS.concat(PRED_BOOKS).forEach(function (b) { BOOK_CLS[b[0]] = b[1]; });
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
    var qn = BOOK_NAMES3().filter(function (b) { return bk[b]; }), best = qn[0];
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
    return { tiers: TIERS.slice(), books: BOOK_NAMES3(), win: 'open', min: 0, mv: 'all', sort: 'drop', btype: 'all', unit: 'pct', mean: false, q: '', mkTab: 'all' };
  }
  // README "Sorting and filtering logic" (the file's rank / minVal / pass)
  // Biggest soft drop ranks on the soft reading only; Biggest sharp drop on the sharp reading, selections without one after
  // it by their soft reading (btype 'all'). Drops in = % or pts implied. A reading that is missing (no line, one price)
  // ranks after every real reading, rises included: no soft line never sits above a soft rise (founder 2026-11-27).
  function rankOf(c, btype, unit) {
    var vOf = function (r) { var x = unit === 'pts' ? r.pts : r.d; return x != null ? x : -Infinity; };
    if (btype === 'soft') return vOf(c.soft.r);
    return c.sharp.d != null ? 1000 + vOf(c.sharp) : (btype === 'all' ? vOf(c.soft.r) : -Infinity);
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
    if (S.mean && !isMean(c)) return false;
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
      return -rankOf(calc(s.bk), S.btype, S.unit);
    };
    list = list.map(function (s, i) { return { s: s, k: key(s), i: i }; })
      .sort(function (a, b) { return (a.k === b.k ? 0 : a.k - b.k) || a.i - b.i; }).map(function (x) { return x.s; });
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
  // ─── generated by tools/drops-dc/compile.mjs from the locked design template — do not edit by hand ───
  function dcDesk(v, H, E) { return `<div style="max-width:1360px; margin:0; padding:${E(v.deskPad)}; box-sizing:border-box; display:flex; flex-direction:column; gap:16px;">

      <div style="background:var(--do2-card); border:1px solid var(--do2-hair); border-radius:16px; padding:16px 22px; display:flex; align-items:center; justify-content:space-between; gap:14px 28px; flex-wrap:wrap;">
        <div style="flex:1; min-width:260px; display:flex; flex-direction:column; gap:6px;">
          <h1 style="margin:0; font-size:22px; font-weight:800; letter-spacing:-0.015em; line-height:1.1;">${E(v.tabName)}</h1>
          <div style="font-size:13px; color:var(--do2-grey); line-height:1.45; text-wrap:pretty;">Prices that have shortened since we first recorded them. Sharp and soft books are read separately.</div>
          ${v.hasArchive?`<a data-doarchive href="${E(v.archiveHref)}" data-dc-click="${H(v.openArchive)}" style="align-self:flex-start; margin-top:2px; font-size:12.5px; font-weight:600; white-space:nowrap;">Biggest moves of the past days ›</a>`:''}
        </div>
        <div style="display:flex; gap:30px; flex:none; align-items:flex-end;">
          <div style="display:flex; flex-direction:column; gap:7px; align-items:flex-end;">
            <span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Drops</span>
            <span style="font-family:'IBM Plex Mono',monospace; font-size:20px; font-weight:700; color:var(--do2-text); white-space:nowrap; line-height:1;">${E(v.hdrDrops)}</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:7px; align-items:flex-end;">
            <span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Biggest</span>
            <span style="font-family:'IBM Plex Mono',monospace; font-size:20px; font-weight:700; color:${E(v.hdrBiggestC)}; white-space:nowrap; line-height:1;">${E(v.hdrBiggest)}</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:7px; align-items:flex-end;">
            <span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Updated</span>
            <span style="font-family:'IBM Plex Mono',monospace; font-size:20px; font-weight:700; color:var(--do2-text); white-space:nowrap; line-height:1;">${E(v.updatedVal)}</span>
          </div>
        </div>
      </div>

      <div style="position:relative; z-index:25; display:flex; flex-direction:column; gap:10px; padding:12px 16px; border-radius:16px; background:var(--do2-card); border:1px solid var(--do2-hair);">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <div style="flex:1; min-width:220px; display:flex; align-items:center; gap:10px; height:36px; box-sizing:border-box; padding:0 12px; border-radius:10px; background:var(--do2-inner); border:1px solid var(--do2-hair); transition:border-color .14s ease;" class="dxh1">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke-width="1.7" style="stroke:var(--do2-grey)"></circle><path d="M13.2 13.2 17 17" stroke-width="1.7" stroke-linecap="round" style="stroke:var(--do2-grey)"></path></svg>
            <input value="${E(v.q)}" data-dc-change="${H(v.onQ)}" placeholder="Search players" style="flex:1; min-width:0; background:transparent; border:0; outline:none; color:var(--do2-text); font-family:'Hanken Grotesk',sans-serif; font-size:14px;">
          </div>
          ${(v.tabMenus||[]).map((m)=>`
            <div style="position:relative;">
              <span data-dc-click="${H(m.onToggle)}" style="display:flex; align-items:center; gap:7px; height:40px; box-sizing:border-box; padding:0 12px; border-radius:10px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, border-color .14s ease; background:${E(m.bg)}; border:1px solid ${E(m.bd)};" class="dxh2">
                <span style="color:var(--do2-grey); font-weight:600;">${E(m.label)}</span>
                <span style="font-weight:700; color:${E(m.vc)};">${E(m.value)}</span>
                ${m.active?`
                  <span data-dc-click="${H(m.onClear)}" title="Clear" style="color:var(--do2-grey); font-size:14px; line-height:1; padding:0 1px;" class="dxh3">×</span>
                `:''}
                ${m.idle?`
                  <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" stroke-width="1.4" fill="none" stroke-linecap="round" style="stroke:var(--do2-grey)"></path></svg>
                `:''}
              </span>
              ${m.open?`
                <div data-dc-menu data-dc-scroll style="position:absolute; top:calc(100% + 6px); right:0; min-width:220px; z-index:30; background:var(--do2-lift); border:1px solid var(--do2-edge-14); border-radius:12px; padding:6px; display:flex; flex-direction:column; box-shadow:0 16px 36px var(--do3-shadow-a50); max-height:300px; overflow:auto; scrollbar-width:thin;">
                  ${(m.groups||[]).map((g)=>`
                    ${g.head?`
                      <div style="font-size:11.5px; font-weight:600; color:var(--do2-grey); padding:8px 10px 4px;">${E(g.head)}</div>
                    `:''}
                    ${(g.opts||[]).map((o)=>`
                      <span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; transition:background .14s ease; color:${E(o.c)};" class="dxh4">
                        <span style="width:16px; height:16px; box-sizing:border-box; border-radius:5px; flex:none; display:flex; align-items:center; justify-content:center; background:${E(o.boxBg)}; border:1px solid ${E(o.boxBd)}; color:var(--do2-text); font-size:10px; font-weight:800;">${E(o.tick)}</span>
                        <span style="flex:1;">${E(o.label)}</span>
                      </span>
                    `).join('')}
                  `).join('')}
                </div>
              `:''}
            </div>
          `).join('')}
          ${v.hasActive?`
            <span data-dc-click="${H(v.resetFilters)}" style="height:36px; box-sizing:border-box; display:flex; align-items:center; padding:0 14px; border-radius:10px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); font-size:12.5px; font-weight:600; color:var(--do2-text); cursor:pointer; white-space:nowrap; transition:background .14s ease;" class="dxh5">Reset filters</span>
          `:''}
        </div>
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 22px; ">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:12px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Tier</span>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
              ${(v.tierOpts||[]).map((o)=>`
                <span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:baseline; gap:7px; padding:4px 9px; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; font-weight:${E(o.w)}; color:${E(o.c)}; background:${E(o.bg)}; border:1px solid ${E(o.bd)};" class="dxh6">${E(o.label)}</span>
              `).join('')}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:12px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Window</span>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
              ${(v.winOpts||[]).map((o)=>`
                <span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:baseline; gap:7px; padding:4px 9px; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; font-weight:${E(o.w)}; color:${E(o.c)}; background:${E(o.bg)}; border:1px solid ${E(o.bd)};" class="dxh7">${E(o.label)}</span>
              `).join('')}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:12px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Min drop</span>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
              ${(v.minOpts||[]).map((o)=>`
                <span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:baseline; gap:7px; padding:4px 9px; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; font-weight:${E(o.w)}; color:${E(o.c)}; background:${E(o.bg)}; border:1px solid ${E(o.bd)};" class="dxh8">${E(o.label)}</span>
              `).join('')}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:12px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Movement</span>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
              ${(v.mvOpts||[]).map((o)=>`
                <span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:baseline; gap:7px; padding:4px 9px; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; font-weight:${E(o.w)}; color:${E(o.c)}; background:${E(o.bg)}; border:1px solid ${E(o.bd)};" class="dxh9">${E(o.label)}</span>
              `).join('')}
            </div>
            <span data-domean data-dc-click="${H(v.mean.onClick)}" title="Pinnacle moved 5 pts implied or more, or 2 pts or more with at least half of the soft books following" style="display:flex; align-items:baseline; gap:7px; padding:4px 9px; border-radius:7px; margin-left:6px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; font-weight:${E(v.mean.w)}; color:${E(v.mean.c)}; background:${E(v.mean.bg)}; border:1px solid ${E(v.mean.bd)};" class="dxh10">Meaningful only</span>
          </div>
        </div>
      </div>

      ${v.isDrops?`
      ${v.disconnected?`
        <div style="display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:12px 20px; border-radius:16px; background:var(--do2-card); border:1px solid var(--do2-hair);">
          <span style="display:flex; align-items:center; gap:10px; font-size:13px; flex-wrap:wrap;"><span style="width:8px; height:8px; border-radius:50%; background:var(--do2-meter); flex:none;"></span><span style="font-weight:700; color:var(--do2-meter);">Feed disconnected</span><span style="color:var(--do2-grey);">Showing prices as of <span style="font-family:'IBM Plex Mono',monospace; color:var(--do2-text);">${E(v.updatedVal)}</span>. New moves appear once the feed reconnects.</span></span>
          <span data-dc-click="${H(v.reconnect)}" style="height:30px; display:flex; align-items:center; padding:0 12px; border-radius:8px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); font-size:12.5px; font-weight:600; color:var(--do2-text); cursor:pointer;" class="dxh11">Reconnect</span>
        </div>
      `:''}

      <div style="display:flex; flex-direction:column; gap:12px; padding:4px 18px 18px; border-radius:16px; background:var(--do2-card); border:1px solid var(--do2-hair);">
        <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:10px 20px; flex-wrap:wrap; border-bottom:1px solid var(--do2-hair);">
          <div style="display:flex; align-items:flex-end; gap:26px;">
            ${(v.mkTabs||[]).map((t)=>`
            <span data-dc-click="${H(t.onClick)}" style="display:flex; align-items:baseline; gap:8px; padding:9px 0 13px; font-size:14px; font-weight:700; white-space:nowrap; cursor:pointer; transition:color .14s ease, border-color .14s ease; color:${E(t.c)}; border-bottom:2px solid ${E(t.ul)}; margin-bottom:-1px;" class="dxh12">${E(t.label)}<span style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:500; color:var(--do2-grey);">${E(t.n)}</span></span>
          `).join('')}
          </div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-left:auto; padding:8px 0 10px;">
            <div style="display:flex; align-items:center; gap:10px; flex:none;"><span style="font-size:12.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Sort by</span>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
              ${(v.sortOpts||[]).map((o)=>`
                <span data-dc-click="${H(o.onClick)}" style="padding:4px 9px; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; font-weight:${E(o.w)}; color:${E(o.c)}; background:${E(o.bg)}; border:1px solid ${E(o.bd)};" class="dxh13">${E(o.label)}</span>
              `).join('')}
            </div></div>
            <div style="display:flex; align-items:center; gap:10px; flex:none;"><span style="font-size:12.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap;">Drops in</span>
            <div data-dounit title="Rank the biggest drops by the price drop in % or by the shift in implied chance in points" style="display:flex; align-items:center; gap:2px;">
              ${(v.unitOpts||[]).map((o)=>`<span data-dc-click="${H(o.onClick)}" style="padding:4px 9px; border-radius:7px; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; font-weight:${E(o.w)}; color:${E(o.c)}; background:${E(o.bg)}; border:1px solid ${E(o.bd)};" class="dxh14">${E(o.label)}</span>`).join('')}
            </div></div>
            <span data-dohelp style="position:relative; display:flex; margin-left:auto;"><span data-dc-enter="${H(v.tipOn)}" data-dc-leave="${H(v.tipOff)}" data-dc-click="${H(v.tipToggle)}" title="How to read these figures" style="display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap; cursor:help; transition:color .14s ease;" class="dxh15"><span style="width:22px; height:22px; box-sizing:border-box; border-radius:50%; border:1px solid var(--do2-edge-22); display:inline-flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:700; color:var(--do2-text2); flex:none;">?</span></span>${v.tip?`<span style="position:absolute; right:0; top:calc(100% + 8px); width:340px; max-width:calc(100vw - 150px); box-sizing:border-box; z-index:15; display:flex; flex-direction:column; gap:12px; text-align:left; background:var(--do2-lift); border:1px solid var(--do2-edge-14); border-radius:12px; padding:16px; font-weight:500; letter-spacing:0; text-transform:none; white-space:normal; box-shadow:0 16px 36px var(--do3-shadow-a50);"><span style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:12.5px; font-weight:700; color:var(--do2-text);">Drop %</span><span style="font-size:12.5px; color:var(--do2-text2); line-height:1.5;">How far the price has fallen since we first recorded it. <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">2.12 → 1.46</span> is a <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">31.1%</span> drop.</span></span><span style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:12.5px; font-weight:700; color:var(--do2-text);">Pts implied</span><span style="font-size:12.5px; color:var(--do2-text2); line-height:1.5;">A price implies a chance of winning: 1 divided by the price. <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">2.12</span> is <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">47.2%</span>, <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">1.46</span> is <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">68.5%</span>, so the market now gives this player <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">+21.3</span> percentage points more chance. The bookmaker margin is still in the figure.</span></span><span style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:12.5px; font-weight:700; color:var(--do2-text);">Why both</span><span style="font-size:12.5px; color:var(--do2-text2); line-height:1.5;">The same drop can mean very different things. <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">5.30 → 3.65</span> is also a <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">31.1%</span> drop, but only <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">+8.5 pts</span>.</span></span><span style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:12.5px; font-weight:700; color:var(--do2-text);">Sharp and soft</span><span style="font-size:12.5px; color:var(--do2-text2); line-height:1.5;">Sharp is Pinnacle, which tends to move first. Soft is the average of the other bookmakers. The first recorded price is not necessarily the opening line.</span></span><span style="display:flex; flex-direction:column; gap:4px;"><span style="font-size:12.5px; font-weight:700; color:var(--do2-text);">Meaningful only</span><span style="font-size:12.5px; color:var(--do2-text2); line-height:1.5;">Keeps a selection when Pinnacle has moved it by <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">5 pts</span> implied or more, or by <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text);">2 pts</span> or more with at least half of the soft books following. Soft only moves are left out. These cards carry the Sharp move badge; the brighter badge, Strong sharp move, means 5 pts or more.</span></span></span>`:''}</span>
          </div>
        </div>
                <div style="display:flex; flex-direction:column;">

      ${v.loading?`
        <div style="display:flex; flex-direction:column; gap:8px; padding:8px; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair);">
          ${(v.skel||[]).map((s)=>`
            <div style="display:grid; grid-template-columns:${E(v.rowCols)}; gap:${E(v.rowGap)}; align-items:center; padding:12px 12px 12px 10px; border-radius:10px; background:transparent;">
              <span style="height:34px; width:96px; border-radius:8px; background:var(--do2-hair);"></span>
              <span style="display:flex; align-items:center; gap:16px;"><span style="width:42px; height:42px; border-radius:50%; background:var(--do2-hair); flex:none;"></span><span style="flex:1; display:flex; flex-direction:column; gap:9px;"><span style="height:13px; width:${E(s.w1)}; border-radius:4px; background:var(--do2-edge-7);"></span><span style="height:10px; width:${E(s.w2)}; border-radius:4px; background:var(--do2-sk-45);"></span></span></span>
              <span style="height:16px; width:110px; border-radius:4px; background:var(--do2-hair);"></span>
            </div>
          `).join('')}
        </div>
      `:''}

      ${v.empty?`
        <div style="display:flex; flex-direction:column; align-items:center; gap:8px; padding:56px 20px; text-align:center; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair);">
          <span style="font-size:15px; font-weight:700;">No selections match these filters</span>
          <span style="font-size:13px; color:var(--do2-grey);">${E(v.emptyDetail)}</span>
          <span data-dc-click="${H(v.resetFilters)}" style="margin-top:8px; height:34px; display:flex; align-items:center; padding:0 14px; border-radius:9px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); font-size:12.5px; font-weight:600; color:var(--do2-text); cursor:pointer;" class="dxh16">Reset filters</span>
        </div>
      `:''}

      ${v.hasRows?`
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${(v.rows||[]).map((r)=>`
            <div data-docard data-dc-click="${H(r.onClick)}" title="Show the price history" style="display:flex; flex-direction:column; border-radius:16px; background:var(--do2-inner); border:1px solid var(--do3-edge-5); overflow:hidden; cursor:pointer; transition:border-color .14s ease;" class="dxh17">
              <div style="display:flex; align-items:center; gap:14px; padding:16px 22px 14px;"><span style="width:40px; height:40px; box-sizing:border-box; border-radius:50%; background:var(--do2-lift); border:1px solid var(--do2-edge-14); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:var(--do2-text); flex:none;">${E(r.ini)}</span><div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:4px;"><span style="display:flex; align-items:center; gap:4px 10px; min-width:0; flex-wrap:wrap;"><span style="min-width:0; font-size:15.5px; font-weight:700; letter-spacing:-0.01em; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${E(r.line)}</span>${r.hasChip?`<span data-dosharp title="${E(r.chipTitle)}" style="flex:none; max-width:100%; box-sizing:border-box; display:flex; align-items:center; gap:6px; padding:1px 8px 1px 7px; border-radius:6px; background:${E(r.chipBg)}; border:1px solid ${E(r.chipBd)}; font-size:11.5px; font-weight:${E(r.chipW)}; color:${E(r.chipC)}; white-space:nowrap;"><span style="width:6px; height:6px; border-radius:50%; background:${E(r.chipDot)}; flex:none;"></span>${E(r.chipLbl)}<span style="font-family:'IBM Plex Mono',monospace; font-weight:500; color:${E(r.chipAgoC)};">${E(r.chipAgo)}</span></span>`:''}</span><span style="font-size:12.5px; color:var(--do2-grey); line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">vs ${E(r.oName)}${E(r.evSep)}</span></div><span style="flex:none; display:flex; flex-direction:column; align-items:flex-end; gap:4px; white-space:nowrap;"><span style="display:flex; align-items:baseline; gap:7px; font-size:12.5px; color:var(--do2-grey);">Starts<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:13px; font-weight:600; color:var(--do2-text2);">${E(r.start)}</span></span><span style="font-size:12.5px; color:var(--do2-grey);">${E(r.cd)}</span></span><svg width="10" height="10" viewBox="0 0 10 10" style="flex:none;"><path d="M3.5 2 6.5 5 3.5 8" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--do2-dim)"></path></svg></div>
              <div style="display:grid; grid-template-columns:${E(v.deckCols)}; gap:16px 20px; margin:0 22px; padding:14px 0 16px; border-top:1px solid var(--do2-edge-7);">
                <div style="min-width:0; display:flex; flex-direction:column; gap:9px; padding:0;"><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${E(r.shLbl)}</span><span style="display:flex; align-items:center; gap:13px;"><span style="position:relative; width:4px; height:44px; border-radius:2px; background:var(--do2-meter-trk); overflow:hidden; flex:none;"><span style="position:absolute; left:0; right:0; bottom:0; height:${E(r.dropW)}; background:var(--do2-meter); border-radius:2px;"></span></span><span style="min-width:0; display:flex; flex-direction:column; gap:5px;"><span style="display:flex; align-items:baseline; gap:8px; white-space:nowrap; line-height:24px;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:${E(r.sh.fs)}; font-weight:700; letter-spacing:-0.02em; color:${E(r.sh.c)};">${E(r.sh.big)}<span style="font-size:11.5px; letter-spacing:0;">${E(r.sh.pct)}</span></span><span style="font-size:12.5px; color:var(--do2-grey);">${E(r.sh.impl)}</span></span>${r.sh.hasP?`<span style="display:flex; align-items:baseline; gap:7px; font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:13px; color:var(--do2-grey); white-space:nowrap;"><span style="display:${E(r.sh.leadD)};">${E(r.sh.lead)}</span><span style="text-decoration:${E(r.sh.deco)}; text-decoration-color:var(--do2-strike);">${E(r.sh.open)}</span><span style="font-size:11px;">→</span><span style="font-size:14.5px; font-weight:700; color:var(--do2-text);">${E(r.sh.now)}</span></span>`:''}${r.sh.noP?`<span style="font-size:12.5px; color:var(--do2-grey); line-height:1.35;">${E(r.sh.note)}</span>`:''}</span></span></div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:9px; padding:0;"><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${E(r.softLbl)}</span><span style="display:flex; align-items:center; gap:13px;"><span style="position:relative; width:4px; height:44px; border-radius:2px; background:var(--do2-edge-8); overflow:hidden; flex:none;"><span style="position:absolute; left:0; right:0; bottom:0; height:${E(r.softW)}; background:var(--do2-text2); border-radius:2px;"></span></span><span style="min-width:0; display:flex; flex-direction:column; gap:5px;"><span style="display:flex; align-items:baseline; gap:8px; white-space:nowrap; line-height:24px;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:${E(r.so.fs)}; font-weight:700; letter-spacing:-0.02em; color:${E(r.so.c)};">${E(r.so.big)}<span style="font-size:11.5px; letter-spacing:0;">${E(r.so.pct)}</span></span><span style="font-size:12.5px; color:var(--do2-grey);">${E(r.so.shift)}</span></span>${r.so.hasP?`<span style="display:flex; align-items:baseline; gap:7px; font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:13px; color:var(--do2-grey); white-space:nowrap;"><span style="display:${E(r.so.leadD)};">${E(r.so.lead)}</span><span style="text-decoration:${E(r.so.deco)}; text-decoration-color:var(--do2-strike);">${E(r.so.open)}</span><span style="font-size:11px;">→</span><span style="font-size:14.5px; font-weight:700; color:var(--do2-text2);">${E(r.so.now)}</span></span>`:''}${r.so.noP?`<span style="font-size:12.5px; color:var(--do2-grey); line-height:1.35;">${E(r.so.note)}</span>`:''}</span></span></div>
                <div style="min-width:0; order:${E(v.timeOrd)}; grid-column:${E(v.timeCol)}; display:flex; flex-direction:column; gap:9px; padding:0;"><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Opened · biggest move</span><span data-dotime style="display:flex; flex-direction:column; font-size:12.5px; color:var(--do2-grey);"><span style="display:flex; align-items:baseline; gap:14px; padding-bottom:6px;"><span style="flex:none; width:40px;"></span><span title="When the first price was recorded, and that price" style="flex:none; width:116px; font-size:11px; font-weight:600; color:var(--do2-grey);">Opened</span><span title="The largest single move: when it happened, from which price to which, and the drop in %" style=" font-size:11px; font-weight:600; color:var(--do2-grey);">Biggest move</span></span><span style="display:flex; align-items:baseline; gap:14px; padding:7px 0 6px; border-top:1px solid var(--do2-hair);"><span style="flex:none; width:40px; font-weight:600;">Sharp</span><span title="First recorded price and when it was recorded" style="flex:none; width:116px; display:flex; align-items:baseline; gap:8px; white-space:nowrap;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(r.pinOpenAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; font-weight:700; color:var(--do2-text);">${E(r.pinOpenPx)}</span></span><span title="${E(r.pinTitle)}" style="min-width:0; display:flex; align-items:baseline; gap:2px 10px; flex-wrap:wrap;">${r.pinHas?`<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(r.pinAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(r.pinMv)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; font-weight:700; color:var(--do2-text);">${E(r.pinAmt)}</span>`:''}${r.pinNo?`<span style="white-space:nowrap;">${E(r.pinNote)}</span>`:''}</span></span><span style="display:flex; align-items:baseline; gap:14px; padding:7px 0 6px; border-top:1px solid var(--do2-hair);"><span style="flex:none; width:40px; font-weight:600;">Soft</span><span title="First recorded price and when it was recorded" style="flex:none; width:116px; display:flex; align-items:baseline; gap:8px; white-space:nowrap;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(r.softOpenAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; font-weight:700; color:var(--do2-text);">${E(r.softOpenPx)}</span></span><span title="${E(r.softTitle)}" style="min-width:0; display:flex; align-items:baseline; gap:2px 10px; flex-wrap:wrap;">${r.softHas?`<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(r.softAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(r.softMv)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; font-weight:700; color:var(--do2-text);">${E(r.softAmt)}</span>`:''}${r.softNo?`<span style="white-space:nowrap;">${E(r.softNote)}</span>`:''}</span></span></span></div>
                <div style="min-width:0; display:flex; flex-direction:column; gap:9px; padding:0;"><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Best price now</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:18px; font-weight:700; line-height:24px; color:var(--do2-text);">${E(r.bestPrice)}</span><span style="font-size:12.5px; color:var(--do2-grey); line-height:1.3;">${E(r.bestBook)}</span></div>
              </div>
            </div>
          `).join('')}
        </div>
      `:''}
        </div>
      </div>
      `:''}
    </div>`; }
  function dcDrawer(v, H, E) { return `
  <div data-dc-click="${H(v.closeDrawer)}" style="position:fixed; inset:0; z-index:40; background:var(--do2-scrim);"></div>
  <div style="position:fixed; z-index:41; left:${E(v.dr.left)}; right:${E(v.dr.right)}; bottom:${E(v.dr.bottom)}; top:${E(v.dr.top)}; transform:${E(v.dr.tf)}; width:${E(v.dr.w)}; max-width:${E(v.dr.mw)}; max-height:${E(v.dr.mh)}; border-radius:${E(v.dr.rad)}; background:var(--do2-card); border:1px solid var(--do2-edge-8); box-shadow:0 30px 80px var(--do3-shadow-a55); display:flex; flex-direction:column; overflow:hidden;">
    <div style="flex:none; display:flex; align-items:center; gap:14px; padding:${E(v.dr.headPad)}; border-bottom:1px solid var(--do2-hair);">
        <span style="width:40px; height:40px; box-sizing:border-box; border-radius:50%; background:var(--do2-lift); border:1px solid var(--do2-edge-14); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:var(--do2-text); flex:none;">${E(v.dr.ini)}</span>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:5px;">
          <span style="font-size:18px; font-weight:800; letter-spacing:-0.01em; line-height:1.2;">${E(v.dr.line)}</span>
          <span style="font-size:12.5px; color:var(--do2-grey); line-height:1.45; text-wrap:pretty;">${E(v.dr.sub)}</span>
        </div>
        <a role="button" tabindex="0" data-dc-click="${H(v.dr.openMA)}" style="flex:none; height:30px; display:${E(v.dr.maD)}; align-items:center; padding:0 12px; border-radius:8px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); font-size:12.5px; font-weight:600; color:var(--do2-text); white-space:nowrap;" class="dxh18">Match analysis</a>
        <span data-dc-click="${H(v.closeDrawer)}" style="flex:none; height:30px; display:flex; align-items:center; width:30px; justify-content:center; border-radius:50%; background:var(--do2-lift); border:1px solid var(--do2-edge-14); font-size:12px; font-weight:600; color:var(--do2-text2); cursor:pointer; transition:background .14s ease, color .14s ease;" title="Close" class="dxh19">✕</span>
      </div>
    <div data-dc-scroll style="flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; overscroll-behavior:contain; display:flex; flex-direction:column; gap:18px; padding:${E(v.dr.pad)};">

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%,230px),1fr)); gap:12px;">
        <div style="min-width:0; display:flex; flex-direction:column; gap:11px; padding:16px 18px; border-radius:14px; background:var(--do2-lift); border:1px solid var(--do2-edge-10);">
          <span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">${E(v.dr.shLbl)}</span>
          <span style="display:flex; align-items:baseline; justify-content:space-between; gap:6px 12px; flex-wrap:wrap;">
            <span style="font-family:'IBM Plex Mono',monospace; font-size:24px; font-weight:700; letter-spacing:-0.02em; line-height:1; font-variant-numeric:tabular-nums; color:${E(v.dr.sh.c)};">${E(v.dr.sh.big)}${E(v.dr.sh.pct)}</span>
            ${v.dr.sh.hasP?`<span style="display:flex; align-items:baseline; gap:7px; font-family:'IBM Plex Mono',monospace; white-space:nowrap;"><span style="font-size:13px; color:var(--do2-grey); display:${E(v.dr.sh.leadD)};">${E(v.dr.sh.lead)}</span><span style="font-size:13px; color:var(--do2-grey); text-decoration:${E(v.dr.sh.deco)}; text-decoration-color:var(--do2-strike);">${E(v.dr.sh.open)}</span><span style="font-size:11px; color:var(--do2-grey);">→</span><span style="font-size:16px; font-weight:700; color:var(--do2-text);">${E(v.dr.sh.now)}</span></span>`:''}
          </span>
          
          <span style="display:flex; flex-direction:column; gap:7px; font-size:12.5px; color:var(--do2-grey); line-height:1.4;">
            ${v.dr.sh.noP?`<span>${E(v.dr.sh.note)}</span>`:''}
            ${v.dr.sh.hasImpl?`<span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Opening</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.shOpening)}</span></span><span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Implied</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.sh.implShort)}</span></span><span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Shift</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.sh.shift)}</span></span>`:''}
            ${v.dr.sh.hasImpl?`<span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Last move</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.movedShort)}</span></span>`:''}
          </span>
        </div>
        <div style="min-width:0; display:flex; flex-direction:column; gap:11px; padding:16px 18px; border-radius:14px; background:var(--do2-inner); border:1px solid var(--do3-edge-5);">
          <span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">${E(v.dr.softLbl)}</span>
          <span style="display:flex; align-items:baseline; justify-content:space-between; gap:6px 12px; flex-wrap:wrap;">
            <span style="font-family:'IBM Plex Mono',monospace; font-size:24px; font-weight:700; letter-spacing:-0.02em; line-height:1; font-variant-numeric:tabular-nums; color:${E(v.dr.so.c)};">${E(v.dr.so.big)}${E(v.dr.so.pct)}</span>
            ${v.dr.so.hasP?`<span style="display:flex; align-items:baseline; gap:7px; font-family:'IBM Plex Mono',monospace; white-space:nowrap;"><span style="font-size:13px; color:var(--do2-grey); display:${E(v.dr.so.leadD)};">${E(v.dr.so.lead)}</span><span style="font-size:13px; color:var(--do2-grey); text-decoration:${E(v.dr.so.deco)}; text-decoration-color:var(--do2-strike);">${E(v.dr.so.open)}</span><span style="font-size:11px; color:var(--do2-grey);">→</span><span style="font-size:16px; font-weight:700; color:var(--do2-text2);">${E(v.dr.so.now)}</span></span>`:''}
          </span>
          
          <span style="display:flex; flex-direction:column; gap:7px; font-size:12.5px; color:var(--do2-grey); line-height:1.4;">
            ${v.dr.so.noP?`<span>${E(v.dr.so.note)}</span>`:''}
            ${v.dr.so.hasImpl?`<span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Opening</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.soOpening)}</span></span><span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Implied</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.so.implShort)}</span></span><span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Shift</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.so.shift)}</span></span>`:''}
            ${v.dr.hasCount?`<span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Books down</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.softCountShort)}</span></span>`:''}
          </span>
        </div>
        <div style="min-width:0; display:flex; flex-direction:column; gap:11px; padding:16px 18px; border-radius:14px; background:var(--do2-inner); border:1px solid var(--do3-edge-5);">
          <span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">${E(v.dr.bestLbl)}</span>
          <span style="display:flex; align-items:baseline; justify-content:space-between; gap:6px 12px; flex-wrap:wrap;">
            <span style="font-family:'IBM Plex Mono',monospace; font-size:24px; font-weight:700; letter-spacing:-0.02em; line-height:1; font-variant-numeric:tabular-nums; color:var(--do2-text);">${E(v.dr.bestPrice)}</span>
            <span style="font-size:13px; font-weight:700; color:var(--do2-text);">${E(v.dr.bestBook)}</span>
          </span>
          
          <span style="display:flex; flex-direction:column; gap:7px; font-size:12.5px; color:var(--do2-grey); line-height:1.4;">
            <span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Quoting</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.quoting)}</span></span>
            <span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Starts</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.start)}</span></span>
            <span style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><span>Countdown</span><span style="font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--do2-text2); white-space:nowrap;">${E(v.dr.cd)}</span></span>
          </span>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:16px; padding:18px 20px; border-radius:14px; background:var(--do2-inner); border:1px solid var(--do3-edge-5);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px 16px; flex-wrap:wrap;">
          <span style="display:flex; flex-direction:column; gap:3px;"><span style="font-size:14px; font-weight:700;">Price history</span><span style="font-size:12.5px; color:var(--do2-grey);">Last 24 hours · move over the chart to read the price at any time</span></span>
          <div style="display:flex; align-items:center; gap:2px 6px; flex-wrap:wrap; margin-right:-8px;">
            <div style="position:relative; display:${E(v.dr.predD)};">
              <span data-dc-click="${H(v.dr.predToggle)}" style="display:flex; align-items:center; gap:6px; height:28px; box-sizing:border-box; padding:0 8px; border-radius:8px; font-size:12.5px; white-space:nowrap; cursor:pointer; background:${E(v.dr.predBgM)}; border:1px solid ${E(v.dr.predBdM)}; transition:background .14s ease, border-color .14s ease;" class="dxh20">
                <span style="color:var(--do2-grey); font-weight:600;">Prediction market</span>
                <span style="font-weight:700; color:var(--do2-text);">${E(v.dr.predVal)}</span>
                <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" stroke-width="1.4" fill="none" stroke-linecap="round" style="stroke:var(--do2-grey)"></path></svg>
              </span>
              ${v.dr.predOpen?`
                <div data-dc-click="${H(v.dr.predToggle)}" style="position:fixed; inset:0; z-index:50;"></div>
                <div style="position:absolute; top:calc(100% + 6px); right:0; min-width:200px; z-index:51; background:var(--do2-lift); border:1px solid var(--do2-edge-14); border-radius:12px; padding:6px; display:flex; flex-direction:column; box-shadow:0 16px 36px var(--do3-shadow-a50);">
                  ${(v.dr.predOpts||[]).map((o)=>`
                    <span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; color:${E(o.c)}; background:${E(o.bg)};" class="dxh21">
                      <span style="flex:1;">${E(o.label)}</span>
                      <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:500; color:var(--do2-grey);">${E(o.now)}</span>
                    </span>
                  `).join('')}
                </div>
              `:''}
            </div>
            <div style="position:relative; display:${E(v.dr.lineD)};">
              <span data-dc-click="${H(v.dr.pickToggle)}" style="display:flex; align-items:center; gap:6px; height:28px; box-sizing:border-box; padding:0 8px; border-radius:8px; font-size:12.5px; white-space:nowrap; cursor:pointer; background:${E(v.dr.pickBgM)}; border:1px solid ${E(v.dr.pickBdM)}; transition:background .14s ease, border-color .14s ease;" class="dxh22">
                <span style="color:var(--do2-grey); font-weight:600;">${E(v.dr.lineLbl)}</span>
                <span style="font-weight:700; color:var(--do2-text);">${E(v.dr.selName)}</span>
                <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" stroke-width="1.4" fill="none" stroke-linecap="round" style="stroke:var(--do2-grey)"></path></svg>
              </span>
              ${v.dr.pickOpen?`
                <div data-dc-click="${H(v.dr.pickToggle)}" style="position:fixed; inset:0; z-index:50;"></div>
                <div data-dc-scroll style="position:absolute; top:calc(100% + 6px); right:0; min-width:230px; z-index:51; background:var(--do2-lift); border:1px solid var(--do2-edge-14); border-radius:12px; padding:6px; display:flex; flex-direction:column; box-shadow:0 16px 36px var(--do3-shadow-a50); max-height:min(300px, 42vh); overflow:auto; scrollbar-width:thin;">
                  ${(v.dr.pickGroups||[]).map((g)=>`
                    <div style="font-size:11.5px; font-weight:600; color:var(--do2-grey); padding:8px 10px 4px;">${E(g.head)}</div>
                    ${(g.opts||[]).map((o)=>`
                      <span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; color:${E(o.c)}; background:${E(o.bg)};" class="dxh23">
                        <span style="flex:1;">${E(o.label)}</span>
                        <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:500; color:var(--do2-grey);">${E(o.now)}</span>
                      </span>
                    `).join('')}
                  `).join('')}
                </div>
              `:''}
            </div>
          </div>
        </div>
        <div data-dolegend style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${(v.dr.ch.legend||[]).map((l)=>`
            <span data-dc-click="${H(l.onClick)}" title="${E(l.tip)}" style="display:flex; align-items:center; gap:7px; height:28px; box-sizing:border-box; padding:0 10px; border-radius:8px; cursor:pointer; white-space:nowrap; font-size:12.5px; background:${E(l.bg)}; border:1px solid ${E(l.bd)}; opacity:${E(l.op)}; transition:background .14s ease, opacity .14s ease, border-color .14s ease;" class="dxh24"><span style="width:8px; height:8px; border-radius:50%; background:${E(l.c)}; flex:none;"></span><span style="font-weight:700; color:var(--do2-text);">${E(l.name)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-weight:700; color:var(--do2-text);">${E(l.n)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; font-weight:600; color:${E(l.dc)};">${E(l.d)}</span></span>
          `).join('')}
        </div>
        <div style="display:flex; flex-direction:column;">
        <div style="display:flex; gap:12px;">
          <div style="position:relative; width:52px; height:240px; flex:none;">
            ${(v.dr.ch.gridY||[]).map((g)=>`
              <span style="position:absolute; right:0; top:${E(g.top)}; transform:translateY(-50%); font-family:'IBM Plex Mono',monospace; font-size:11.5px; font-weight:500; color:var(--do2-grey);">${E(g.label)}</span>
            `).join('')}
          </div>
          <div style="position:relative; flex:1; min-width:0; height:240px;">
            ${(v.dr.ch.gridY||[]).map((g)=>`<span style="position:absolute; left:0; right:0; top:${E(g.top)}; height:1px; background:var(--do3-edge-5);"></span>`).join('')}
            <svg viewBox="0 0 1000 300" preserveAspectRatio="none" style="width:100%; height:100%; display:block; overflow:visible;">
              ${v.dr.ch.hasDaySplit?`
                <line x1="${E(v.dr.ch.dayX)}" y1="0" x2="${E(v.dr.ch.dayX)}" y2="300" stroke-width="1" stroke-dasharray="3 4" vector-effect="non-scaling-stroke" style="stroke:var(--do2-edge-10)"></line>
              `:''}
              <polyline points="${E(v.dr.ch.prdPoints)}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="stroke:var(--do3-amber)"></polyline>
              <polyline points="${E(v.dr.ch.pinPoints)}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="stroke:var(--do2-blue)"></polyline>
              <polyline points="${E(v.dr.ch.points)}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="stroke:${E(v.dr.ch.selC)}"></polyline>
            </svg>
            
            ${(v.dr.ch.dots||[]).map((d)=>`<span style="position:absolute; left:${E(d.left)}; top:${E(d.top)}; width:${E(d.s)}; height:${E(d.s)}; transform:translate(-50%,-50%); border-radius:50%; background:${E(d.c)}; box-shadow:0 0 0 2px var(--do2-inner);"></span>`).join('')}
            ${v.dr.ch.hov.on?`
              <span style="position:absolute; left:${E(v.dr.ch.hov.left)}; top:0; bottom:0; width:1px; background:var(--do2-edge-22); pointer-events:none;"></span>
              ${(v.dr.ch.hov.marks||[]).map((k)=>`<span style="position:absolute; left:${E(v.dr.ch.hov.left)}; top:${E(k.top)}; width:9px; height:9px; transform:translate(-50%,-50%); border-radius:50%; background:${E(k.c)}; box-shadow:0 0 0 2px var(--do2-inner); pointer-events:none;"></span>`).join('')}
              <span data-dohov style="position:absolute; left:${E(v.dr.ch.hov.left)}; top:8px; transform:${E(v.dr.ch.hov.tf)}; z-index:3; pointer-events:none; display:flex; flex-direction:column; gap:6px; min-width:150px; padding:10px 12px; border-radius:10px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); box-shadow:0 12px 28px var(--do3-shadow-a50); font-size:12.5px; white-space:nowrap;">
                <span style="font-family:'IBM Plex Mono',monospace; font-size:11.5px; font-weight:600; color:var(--do2-grey);">${E(v.dr.ch.hov.time)}</span>
                ${(v.dr.ch.hov.rows||[]).map((k)=>`<span style="display:flex; align-items:center; gap:8px;"><span style="width:8px; height:8px; border-radius:50%; background:${E(k.c)}; flex:none;"></span><span style="flex:1; font-weight:600; color:var(--do2-text2);">${E(k.name)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-weight:700; color:var(--do2-text);">${E(k.v)}</span></span>`).join('')}
              </span>
            `:''}
            <div data-dc-move="${H(v.dr.ch.onMove)}" data-dc-leave="${H(v.dr.ch.onLeave)}" style="position:absolute; inset:0; z-index:2; cursor:crosshair;"></div>
          </div>
          <div style="position:relative; width:44px; height:240px; flex:none;">
            ${(v.dr.ch.ends||[]).map((k)=>`<span title="Price now" style="position:absolute; left:0; top:${E(k.top)}; transform:translateY(-50%); font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12.5px; font-weight:700; color:${E(k.c)};">${E(k.label)}</span>`).join('')}
          </div>
          </div>
        <div style="margin:10px 56px 0 64px; position:relative; height:16px;">
          ${(v.dr.ch.ticks||[]).map((t)=>`
            <span style="position:absolute; left:${E(t.left)}; transform:${E(t.tf)}; font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:var(--do2-grey); white-space:nowrap;">${E(t.label)}</span>
          `).join('')}
        </div>
        <div style="margin:8px 56px 0 64px; display:flex; gap:6px;">
          ${(v.dr.ch.dayBands||[]).map((b)=>`
            <div style="width:${E(b.w)}; display:flex; flex-direction:column; gap:5px;"><span style="height:1px; background:var(--do2-edge-10);"></span><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey); text-align:center; white-space:nowrap;">${E(b.label)}</span></div>
          `).join('')}
        </div>
        </div>
        ${v.dr.hasNote?`
          <div style="display:flex; flex-direction:column; gap:4px; padding-top:12px; border-top:1px solid var(--do2-hair); font-size:12.5px; color:var(--do2-grey); line-height:1.45;"><span>${E(v.dr.chartNote)}</span><span>${E(v.dr.pinNote)}</span><span>${E(v.dr.predNote)}</span></div>
        `:''}
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        <span style="display:flex; flex-direction:column; gap:3px;"><span style="font-size:14px; font-weight:700;">Bookmakers</span><span style="font-size:12.5px; color:var(--do2-grey); line-height:1.45;">${E(v.dr.summary)}</span></span>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%,380px),1fr)); gap:12px; align-items:start;">
          <div style="min-width:0; display:flex; flex-direction:column; gap:12px;">
            ${(v.dr.colA||[]).map((g)=>`
            <div style="min-width:0; display:flex; flex-direction:column; padding-bottom:8px; border-radius:14px; background:var(--do2-inner); border:1px solid var(--do3-edge-5);">
              <div style="display:flex; flex-direction:column; gap:4px; padding:14px 18px 12px;">
                <span style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;"><span style="font-size:14px; font-weight:800;">${E(g.label)}</span><span style="font-size:12.5px; color:var(--do2-grey);">${E(g.desc)}</span></span>
                <span style="font-size:12.5px; color:var(--do2-grey);">${E(g.meta)}</span>
              </div>
              <div style="display:grid; grid-template-columns:minmax(0,1fr) 68px 68px 76px; gap:8px; padding:9px 18px; margin-bottom:4px; border-top:1px solid var(--do2-hair); border-bottom:1px solid var(--do2-hair); font-size:11.5px; font-weight:600; color:var(--do2-grey);"><span>${E(g.colLbl)}</span><span style="text-align:center;">Opened</span><span style="text-align:center;">Now</span><span style="text-align:center;">Drop</span></div>
              ${(g.rows||[]).map((k)=>`
                <div data-dc-click="${H(k.onPick)}" title="${E(k.tip)}" style="display:grid; grid-template-columns:minmax(0,1fr) 68px 68px 76px; gap:8px; align-items:center; min-height:42px; box-sizing:border-box; margin:0 8px; padding:4px 10px; border-radius:9px; background:${E(k.rowBg)}; cursor:${E(k.cur)}; transition:background .14s ease;" class="dxh25">
                  <span style="min-width:0; display:flex; flex-direction:column; gap:3px;">
                    <span style="display:flex; align-items:center; gap:8px; min-width:0;"><span style="display:${E(k.dotD)}; width:8px; height:8px; border-radius:50%; flex:none; background:${E(k.dotC)};"></span><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px; font-weight:600; color:${E(k.nc)};">${E(k.bName)}</span></span>
                    <span style="font-size:11.5px; color:var(--do2-grey); white-space:nowrap;">${E(k.sub)}</span>
                  </span>
                  <span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; text-align:center; white-space:nowrap; font-size:12.5px; color:var(--do2-grey);">${E(k.open)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; text-align:center; white-space:nowrap; font-size:15px; font-weight:700; color:${E(k.ncol)};">${E(k.now)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; text-align:center; white-space:nowrap; font-size:12.5px; font-weight:600; color:${E(k.dc)};">${E(k.mv)}</span>
                </div>
              `).join('')}
            </div>
            `).join('')}
          </div>
          <div style="min-width:0; display:flex; flex-direction:column; gap:12px;">
            ${(v.dr.colB||[]).map((g)=>`
            <div style="min-width:0; display:flex; flex-direction:column; padding-bottom:8px; border-radius:14px; background:var(--do2-inner); border:1px solid var(--do3-edge-5);">
              <div style="display:flex; flex-direction:column; gap:4px; padding:14px 18px 12px;">
                <span style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;"><span style="font-size:14px; font-weight:800;">${E(g.label)}</span><span style="font-size:12.5px; color:var(--do2-grey);">${E(g.desc)}</span></span>
                <span style="font-size:12.5px; color:var(--do2-grey);">${E(g.meta)}</span>
              </div>
              <div style="display:grid; grid-template-columns:minmax(0,1fr) 68px 68px 76px; gap:8px; padding:9px 18px; margin-bottom:4px; border-top:1px solid var(--do2-hair); border-bottom:1px solid var(--do2-hair); font-size:11.5px; font-weight:600; color:var(--do2-grey);"><span>${E(g.colLbl)}</span><span style="text-align:center;">Opened</span><span style="text-align:center;">Now</span><span style="text-align:center;">Drop</span></div>
              ${(g.rows||[]).map((k)=>`
                <div data-dc-click="${H(k.onPick)}" title="${E(k.tip)}" style="display:grid; grid-template-columns:minmax(0,1fr) 68px 68px 76px; gap:8px; align-items:center; min-height:42px; box-sizing:border-box; margin:0 8px; padding:4px 10px; border-radius:9px; background:${E(k.rowBg)}; cursor:${E(k.cur)}; transition:background .14s ease;" class="dxh26">
                  <span style="min-width:0; display:flex; flex-direction:column; gap:3px;">
                    <span style="display:flex; align-items:center; gap:8px; min-width:0;"><span style="display:${E(k.dotD)}; width:8px; height:8px; border-radius:50%; flex:none; background:${E(k.dotC)};"></span><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px; font-weight:600; color:${E(k.nc)};">${E(k.bName)}</span></span>
                    <span style="font-size:11.5px; color:var(--do2-grey); white-space:nowrap;">${E(k.sub)}</span>
                  </span>
                  <span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; text-align:center; white-space:nowrap; font-size:12.5px; color:var(--do2-grey);">${E(k.open)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; text-align:center; white-space:nowrap; font-size:15px; font-weight:700; color:${E(k.ncol)};">${E(k.now)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; text-align:center; white-space:nowrap; font-size:12.5px; font-weight:600; color:${E(k.dc)};">${E(k.mv)}</span>
                </div>
              `).join('')}
            </div>
            `).join('')}
          </div>
        </div>
        <span style="font-size:12px; color:var(--do2-grey);">Each drop compares a book's own first recorded price with its own current price.</span>
      </div>
    </div>
  </div>
`; }
  var DC_HOVER_CSS = ".dxh1:hover{border-color:var(--do2-edge-14) !important}\n.dxh2:hover{background:var(--do2-hover) !important}\n.dxh3:hover{color:var(--do2-text) !important}\n.dxh4:hover{background:var(--do2-hover) !important}\n.dxh5:hover{background:var(--do2-hover) !important}\n.dxh6:hover{color:var(--do2-text) !important}\n.dxh7:hover{color:var(--do2-text) !important}\n.dxh8:hover{color:var(--do2-text) !important}\n.dxh9:hover{color:var(--do2-text) !important}\n.dxh10:hover{color:var(--do2-text) !important}\n.dxh11:hover{background:var(--do2-hover) !important}\n.dxh12:hover{color:var(--do2-text) !important}\n.dxh13:hover{color:var(--do2-text) !important}\n.dxh14:hover{color:var(--do2-text) !important}\n.dxh15:hover{color:var(--do2-text) !important}\n.dxh16:hover{background:var(--do2-hover) !important}\n.dxh17:hover{border-color:var(--do3-edge-16) !important}\n.dxh18:hover{background:var(--do2-hover) !important}\n.dxh19:hover{background:var(--do2-hover) !important;color:var(--do3-white) !important}\n.dxh20:hover{background:var(--do2-lift) !important}\n.dxh21:hover{background:var(--do2-hover) !important}\n.dxh22:hover{background:var(--do2-lift) !important}\n.dxh23:hover{background:var(--do2-hover) !important}\n.dxh24:hover{background:var(--do2-hover) !important}\n.dxh25:hover{background:{{ k.rowHov }} !important}\n.dxh26:hover{background:{{ k.rowHov }} !important}";
  // ─── generated by tools/drops-dc/compile.mjs --archive from the locked archive template — do not edit by hand ───
  function dcArchive(v, H, E) { return `<div style="max-width:1200px; margin:0 auto; padding:24px; box-sizing:border-box; display:flex; flex-direction:column; gap:16px;">

  <div style="background:var(--do2-card); border:1px solid var(--do2-hair); border-radius:16px; padding:16px 22px; display:flex; flex-direction:column; gap:6px;">
    <a role="button" tabindex="0" data-dc-click="${H(v.back)}" style="font-size:12.5px; font-weight:600;">‹ Dropping odds</a>
    <h1 style="margin:0; font-size:22px; font-weight:800; letter-spacing:-0.015em; line-height:1.1;">Biggest moves · archive</h1>
    <div style="font-size:13px; color:var(--do2-grey); line-height:1.45;">Every big price move of the past days on finished matches: when it opened, when the biggest move happened, where the price closed, and whether the selection won.</div>
  </div>

  <div style="position:relative; z-index:25; display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:10px 12px; border-radius:14px; background:var(--do2-card); border:1px solid var(--do2-hair);">
    ${(v.tracks||[]).map((t)=>`
      <div title="${E(t.label)}" style="display:flex; align-items:center; gap:2px; padding:3px; border-radius:10px; background:var(--do2-track); border:1px solid var(--do2-edge-8);">
          ${(t.opts||[]).map((o)=>`
            <span data-dc-click="${H(o.onClick)}" style="padding:4px 10px; border-radius:7px; font-size:12.5px; line-height:17px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease; font-weight:${E(o.w)}; color:${E(o.c)}; background:${E(o.bg)}; border:1px solid ${E(o.bd)};" class="dxa1">${E(o.label)}</span>
          `).join('')}
        </div>
    `).join('')}
    <div data-aodds style="position:relative;">
      <span data-dc-click="${H(v.oddsToggle)}" title="The price when the selection opened, on the books picked at the left" style="display:flex; align-items:center; gap:8px; height:33px; box-sizing:border-box; padding:0 11px; border-radius:10px; background:${E(v.oChipBg)}; border:1px solid ${E(v.oChipBd)}; font-size:12.5px; white-space:nowrap; cursor:pointer; transition:background .14s ease, border-color .14s ease;" class="dxa2"><span style="font-weight:600; color:var(--do2-grey);">Opening odds</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-weight:700; color:${E(v.oValC)};">${E(v.oddsVal)}</span><span style="font-size:10px; color:var(--do2-grey);">▾</span></span>
      ${v.oddsOpen?`<span data-dc-click="${H(v.oddsClose)}" style="position:fixed; inset:0; z-index:20;"></span><div data-aoddsmenu style="position:absolute; left:0; top:calc(100% + 6px); z-index:21; width:270px; box-sizing:border-box; display:flex; flex-direction:column; gap:2px; padding:8px; border-radius:12px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); box-shadow:0 16px 36px var(--do3-shadow-a50);">${(v.oddsOpts||[]).map((o)=>`<span data-dc-click="${H(o.onClick)}" style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:8px 10px; border-radius:8px; font-size:13px; cursor:pointer; transition:background .14s ease; background:${E(o.mBg)}; font-weight:${E(o.mW)}; color:${E(o.mC)};" class="dxa3">${E(o.label)}<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:11.5px; font-weight:500; color:var(--do2-grey);">${E(o.sub)}</span></span>`).join('')}<span style="display:flex; align-items:center; gap:8px; margin-top:6px; padding:10px 10px 4px; border-top:1px solid var(--do2-edge-8); font-size:12.5px; color:var(--do2-grey);">Custom<input value="${E(v.oMin)}" data-dc-change="${H(v.onMin)}" placeholder="from" title="Lowest opening odds, for example 1.70" inputMode="decimal" maxLength="5" style="width:58px; height:31px; box-sizing:border-box; padding:0 6px; border-radius:8px; background:var(--do2-track); border:1px solid ${E(v.oBd)}; outline:none; text-align:center; font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12.5px; font-weight:700; color:var(--do2-text);">to<input value="${E(v.oMax)}" data-dc-change="${H(v.onMax)}" placeholder="to" title="Highest opening odds, for example 1.95" inputMode="decimal" maxLength="5" style="width:58px; height:31px; box-sizing:border-box; padding:0 6px; border-radius:8px; background:var(--do2-track); border:1px solid ${E(v.oBd)}; outline:none; text-align:center; font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12.5px; font-weight:700; color:var(--do2-text);"></span></div>`:''}
    </div>
    <span data-dc-click="${H(v.strong.onClick)}" title="Only moves of 5 pts implied or more" style="margin-left:auto; padding:7px 11px; border-radius:10px; font-size:12.5px; line-height:17px; white-space:nowrap; cursor:pointer; transition:background .14s ease, color .14s ease; font-weight:${E(v.strong.w)}; color:${E(v.strong.c)}; background:${E(v.strong.bg)}; border:1px solid ${E(v.strong.bd)};" class="dxa4">Strong moves only</span>
  </div>

  <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px;">
    ${(v.tiles||[]).map((t)=>`
      <div style="display:flex; flex-direction:column; gap:8px; padding:14px 18px 15px; border-radius:12px; background:var(--do2-card); border:1px solid var(--do2-hair);">
        <span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">${E(t.cap)}</span>
        <span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:22px; font-weight:700; letter-spacing:-0.02em; line-height:1; color:${E(t.c)};">${E(t.val)}</span>
        <span style="font-size:12.5px; color:var(--do2-grey); line-height:1.35;">${E(t.sub)}</span>
      </div>
    `).join('')}
  </div>

  <div style="display:flex; flex-direction:column; gap:14px; padding:16px 18px 18px; border-radius:16px; background:var(--do2-card); border:1px solid var(--do2-hair);">
    <span style="font-size:12.5px; color:var(--do2-grey); padding:0 2px;">${E(v.countLine)}</span>
    ${v.isEmpty?`
      <div style="display:flex; flex-direction:column; align-items:center; gap:8px; padding:48px 20px; text-align:center; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair);"><span style="font-size:15px; font-weight:700;">No moves match these filters</span><span style="font-size:13px; color:var(--do2-grey);">Widen the period or the opening odds, or turn off "Strong moves only".</span></div>
    `:''}
    <div style="overflow-x:auto;">
      <div style="min-width:780px; display:flex; flex-direction:column; gap:14px;">
        ${(v.groups||[]).map((g)=>`
          <div style="display:flex; flex-direction:column; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair); overflow:hidden;">
            <div style="display:flex; align-items:baseline; gap:10px; padding:12px 20px 11px;"><span style="font-size:14px; font-weight:700;">${E(g.title)}</span><span style="font-size:12.5px; color:var(--do2-grey);">${E(g.sub)}</span><span style="margin-left:auto; display:flex; align-items:baseline; gap:7px; font-size:12.5px; color:var(--do2-grey); white-space:nowrap;">${E(g.topLbl)}<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12.5px; font-weight:700; color:var(--do2-text2);">${E(g.top)}</span></span></div>
            <div style="display:grid; grid-template-columns:118px minmax(0,1fr) 262px 48px 104px; gap:14px; padding:10px 20px; background:var(--do2-card); border-top:1px solid var(--do2-hair); border-bottom:1px solid var(--do2-hair); font-size:11.5px; font-weight:600; color:var(--do2-grey); white-space:nowrap;"><span title="Total drop from the opening price to the closing price">${E(v.dropHead)}</span><span>Selection</span><span>Opened · biggest move</span><span>Closed</span><span>Result</span></div>
            ${(g.rows||[]).map((r)=>`
              <div data-arow data-dc-click="${H(r.onOpen)}" title="Show the price movement" style="display:grid; grid-template-columns:118px minmax(0,1fr) 262px 48px 104px; gap:14px; align-items:center; padding:13px 20px; border-top:1px solid ${E(r.sep)}; cursor:pointer; transition:background .14s ease;" class="dxa5">
                <span style="display:flex; flex-direction:column; gap:3px; white-space:nowrap;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:20px; font-weight:700; letter-spacing:-0.02em; line-height:1.1; color:var(--do2-red);">${E(r.drop)}<span style="font-size:11px; letter-spacing:0;">%</span></span><span style="font-size:12px; color:var(--do2-grey);">${E(r.pts)}</span></span>
                <div style="min-width:0; display:flex; align-items:center; gap:12px;"><span style="width:34px; height:34px; box-sizing:border-box; border-radius:50%; background:var(--do2-lift); border:1px solid var(--do2-edge-14); display:flex; align-items:center; justify-content:center; font-size:11.5px; font-weight:800; flex:none;">${E(r.ini)}</span><div style="min-width:0; display:flex; flex-direction:column; gap:4px;"><span style="display:flex; align-items:center; gap:4px 9px; min-width:0; flex-wrap:wrap;"><span style="font-size:14.5px; font-weight:700; line-height:1.25;">${E(r.name)}</span>${r.hasBadge?`<span style="flex:none; padding:1px 7px; border-radius:6px; font-size:11px; white-space:nowrap; font-weight:${E(r.bW)}; color:${E(r.bC)}; background:${E(r.bBg)}; border:1px solid ${E(r.bBd)};">${E(r.bLbl)}</span>`:''}</span><span style="font-size:12.5px; color:var(--do2-grey); line-height:1.35;">${E(r.meta)}</span></div></div>
                <span style="display:grid; grid-template-columns:48px auto auto auto; justify-content:start; gap:5px 9px; align-items:baseline; font-size:12px; color:var(--do2-grey);"><span>Opened</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(r.openAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text);">${E(r.openPx)}</span><span></span><span>Biggest</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(r.mvAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(r.mvFromTo)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text);">${E(r.mvPct)}</span></span>
                <span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:13.5px; font-weight:700;">${E(r.closePx)}</span>
                <span style="display:flex; align-items:center; justify-content:space-between; gap:8px;"><span style="display:flex; flex-direction:column; gap:3px; white-space:nowrap;"><span style="display:flex; align-items:center; gap:7px; font-size:13px; font-weight:700; color:${E(r.resC)};"><span style="width:8px; height:8px; border-radius:2px; background:${E(r.resSq)}; flex:none;"></span>${E(r.res)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-grey);">${E(r.score)}</span></span><svg width="10" height="10" viewBox="0 0 10 10" style="flex:none;"><path d="M3.5 2 6.5 5 3.5 8" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--do2-dim)"></path></svg></span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  </div>
</div>`; }
  function dcArchiveBox(v, H, E) { return `
<div data-amodal data-dc-click="${H(v.closeM)}" style="position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; background:var(--do3-scrim-74);">
  <div data-dc-click="${H(v.stop)}" data-dc-scroll style="width:100%; max-width:940px; max-height:100%; overflow-y:auto; box-sizing:border-box; display:flex; flex-direction:column; border-radius:16px; background:var(--do2-card); border:1px solid var(--do2-edge-10); box-shadow:0 24px 60px var(--do3-shadow-a55);">
    <div style="position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:14px; padding:18px 22px 16px; background:var(--do2-card); border-bottom:1px solid var(--do2-hair);"><span style="width:44px; height:44px; box-sizing:border-box; border-radius:50%; background:var(--do2-lift); border:1px solid var(--do2-edge-14); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:800; flex:none;">${E(v.m.ini)}</span><div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:5px;"><span style="display:flex; align-items:center; gap:4px 10px; flex-wrap:wrap;"><span style="font-size:18px; font-weight:800; letter-spacing:-0.01em;">${E(v.m.name)}</span>${v.m.hasBadge?`<span style="padding:1px 8px; border-radius:6px; font-size:11.5px; white-space:nowrap; font-weight:${E(v.m.bW)}; color:${E(v.m.bC)}; background:${E(v.m.bBg)}; border:1px solid ${E(v.m.bBd)};">${E(v.m.bLbl)}</span>`:''}</span><span style="font-size:12.5px; color:var(--do2-grey); line-height:1.35;">${E(v.m.meta)}</span></div><span data-dc-click="${H(v.closeM)}" title="Close" style="flex:none; width:32px; height:32px; box-sizing:border-box; display:flex; align-items:center; justify-content:center; border-radius:9px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); font-size:14px; color:var(--do2-text2); cursor:pointer;" class="dxa6">✕</span></div>
    <div style="display:flex; flex-direction:column; gap:14px; padding:18px 22px 22px;">
      <div data-asteps style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); padding:16px 8px 16px; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair);"><div style="min-width:0; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center;"><span style="position:relative; align-self:stretch; height:11px; margin-bottom:5px;"><span style="position:absolute; top:5px; left:50%; right:0; height:1px; background:var(--do2-edge-12);"></span><span style="position:absolute; left:50%; top:0; width:11px; height:11px; margin-left:-5.5px; box-sizing:border-box; border-radius:50%; background:var(--do2-inner); border:2px solid var(--do2-grey);"></span></span><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">Opened</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:20px; font-weight:700; letter-spacing:-0.01em; line-height:1.15; color:var(--do2-text); white-space:nowrap;">${E(v.m.sharp.openPx)}</span><span style="display:flex; flex-direction:column; align-items:center; gap:4px; font-size:12.5px; color:var(--do2-grey); line-height:1.3;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.sharp.openAt)}</span><span>${E(v.m.sharpName)}</span></span></div><div data-amvstep data-dc-enter="${H(v.tipStep)}" data-dc-leave="${H(v.tipOff)}" style="position:relative; cursor:help; min-width:0; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center;"><span style="position:relative; align-self:stretch; height:11px; margin-bottom:5px;"><span style="position:absolute; top:5px; left:0; right:0; height:1px; background:var(--do2-edge-12);"></span><span style="position:absolute; left:50%; top:0; width:11px; height:11px; margin-left:-5.5px; box-sizing:border-box; border-radius:50%; background:var(--do2-blue);"></span></span><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">Biggest move</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:20px; font-weight:700; letter-spacing:-0.01em; line-height:1.15; color:var(--do2-text); white-space:nowrap;">${E(v.m.sharp.mvFromTo)}</span><span style="display:flex; flex-direction:column; align-items:center; gap:4px; font-size:12.5px; color:var(--do2-grey); line-height:1.3;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.sharp.mvAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text);">${E(v.m.sharp.mvPct)}</span></span>${v.tipIsStep?`<span data-amvtip style="position:absolute; left:50%; top:100%; transform:translate(-50%, 6px); z-index:8; width:310px; box-sizing:border-box; display:flex; flex-direction:column; gap:9px; padding:14px 16px; border-radius:12px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); box-shadow:0 16px 36px var(--do3-shadow-a50); text-align:left; pointer-events:none;"><span style="font-size:12.5px; font-weight:700; color:var(--do2-text);">Biggest move · Sharp (${E(v.m.sharpName)})</span><span style="display:flex; align-items:baseline; gap:10px; padding-bottom:9px; border-bottom:1px solid var(--do2-edge-8);"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:17px; font-weight:700; color:var(--do3-white); white-space:nowrap;">${E(v.m.tip.fromTo)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:13px; font-weight:700; color:var(--do2-red);">${E(v.m.tip.pct)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">When<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.when)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">After the opening<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.after)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">Implied chance<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.impl)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">Share of the total drop<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.share)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">Soft books<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.soft)}</span></span><span style="font-size:12.5px; color:var(--do2-text2); line-height:1.45; padding-top:2px;">${E(v.m.tip.note)}</span></span>`:''}</div><div style="min-width:0; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center;"><span style="position:relative; align-self:stretch; height:11px; margin-bottom:5px;"><span style="position:absolute; top:5px; left:0; right:0; height:1px; background:var(--do2-edge-12);"></span><span style="position:absolute; left:50%; top:0; width:11px; height:11px; margin-left:-5.5px; box-sizing:border-box; border-radius:50%; background:var(--do2-inner); border:2px solid var(--do2-grey);"></span></span><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">Closed</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:20px; font-weight:700; letter-spacing:-0.01em; line-height:1.15; color:var(--do2-text); white-space:nowrap;">${E(v.m.sharp.closePx)}</span><span style="display:flex; flex-direction:column; align-items:center; gap:4px; font-size:12.5px; color:var(--do2-grey); line-height:1.3;"><span>at match start</span><span style="display:flex; align-items:baseline; gap:7px;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-red);">${E(v.m.sharp.drop)}</span><span style="font-size:12px;">${E(v.m.sharp.pts)}</span></span></span></div><div style="min-width:0; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center;"><span style="position:relative; align-self:stretch; height:11px; margin-bottom:5px;"><span style="position:absolute; top:5px; left:0; right:50%; height:1px; background:var(--do2-edge-12);"></span><span style="position:absolute; left:50%; top:0; width:11px; height:11px; margin-left:-5.5px; box-sizing:border-box; border-radius:3px; background:${E(v.m.resSq)};"></span></span><span style="font-size:11.5px; font-weight:600; color:var(--do2-grey);">Result</span><span style="font-size:20px; font-weight:800; line-height:1.15; color:${E(v.m.resC)};">${E(v.m.res)}</span><span style="display:flex; flex-direction:column; align-items:center; gap:4px; font-size:12.5px; color:var(--do2-grey); line-height:1.3;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.score)}</span><span style="display:flex; align-items:baseline; gap:7px;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:${E(v.m.plC)};">${E(v.m.pl)}</span><span style="font-size:12px;">backing at ${E(v.m.backPx)}</span></span></span></div></div>
      <div style="display:flex; flex-direction:column; gap:12px; padding:16px 18px 14px; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair);"><div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px 18px; flex-wrap:wrap;"><span style="font-size:14px; font-weight:700;">Price history</span><span style="display:flex; align-items:baseline; gap:6px 18px; flex-wrap:wrap; font-size:12px; color:var(--do2-grey);"><span style="display:flex; align-items:baseline; gap:8px; white-space:nowrap;"><span style="align-self:center; width:14px; height:2px; background:${E(v.m.sharp.lc)};"></span>${E(v.m.sharp.label)}<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.sharp.openPx)} → ${E(v.m.sharp.closePx)}</span></span><span style="display:flex; align-items:baseline; gap:8px; white-space:nowrap;"><span style="align-self:center; width:14px; height:2px; background:${E(v.m.soft.lc)};"></span>${E(v.m.soft.label)}<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.soft.openPx)} → ${E(v.m.soft.closePx)}</span></span></span></div><div style="display:flex; gap:10px;"><div style="flex:none; display:flex; flex-direction:column; justify-content:space-between; height:230px; font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:11px; color:var(--do2-grey); text-align:right;"><span>${E(v.m.yMax)}</span><span>${E(v.m.yMid)}</span><span>${E(v.m.yMin)}</span></div><div style="position:relative; flex:1; min-width:0; height:230px; border-left:1px solid var(--do2-edge-8); border-bottom:1px solid var(--do2-edge-8);"><span style="position:absolute; left:0; right:0; top:25%; height:1px; background:var(--do3-edge-4);"></span><span style="position:absolute; left:0; right:0; top:50%; height:1px; background:var(--do3-edge-5);"></span><span style="position:absolute; left:0; right:0; top:75%; height:1px; background:var(--do3-edge-4);"></span><span style="position:absolute; top:0; bottom:0; left:${E(v.m.mvX)}; width:1px; background:var(--do2-blue-35);"></span><svg viewBox="0 0 1000 200" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; overflow:visible;"><polyline points="${E(v.m.softLine)}" fill="none" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" style="stroke:var(--do2-text2)"></polyline><polyline points="${E(v.m.sharpLine)}" fill="none" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round" style="stroke:var(--do2-blue)"></polyline></svg><span style="position:absolute; left:${E(v.m.mvX)}; top:${E(v.m.mvY)}; width:11px; height:11px; margin:-5.5px 0 0 -5.5px; border-radius:50%; background:var(--do2-blue); border:2px solid var(--do2-inner); box-sizing:border-box;"></span><span data-dc-enter="${H(v.tipChart)}" data-dc-leave="${H(v.tipOff)}" style="position:absolute; left:${E(v.m.mvX)}; top:${E(v.m.mvY)}; width:30px; height:30px; margin:-15px 0 0 -15px; border-radius:50%; cursor:help;"></span>${v.tipIsChart?`<span data-amvtip style="position:absolute; left:${E(v.m.mvX)}; top:${E(v.m.mvY)}; transform:${E(v.m.tipTf)}; z-index:8; width:310px; box-sizing:border-box; display:flex; flex-direction:column; gap:9px; padding:14px 16px; border-radius:12px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); box-shadow:0 16px 36px var(--do3-shadow-a50); text-align:left; pointer-events:none;"><span style="font-size:12.5px; font-weight:700; color:var(--do2-text);">Biggest move · Sharp (${E(v.m.sharpName)})</span><span style="display:flex; align-items:baseline; gap:10px; padding-bottom:9px; border-bottom:1px solid var(--do2-edge-8);"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:17px; font-weight:700; color:var(--do3-white); white-space:nowrap;">${E(v.m.tip.fromTo)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:13px; font-weight:700; color:var(--do2-red);">${E(v.m.tip.pct)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">When<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.when)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">After the opening<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.after)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">Implied chance<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.impl)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">Share of the total drop<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.share)}</span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:14px; font-size:12.5px; color:var(--do2-grey);">Soft books<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; color:var(--do2-text); white-space:nowrap;">${E(v.m.tip.soft)}</span></span><span style="font-size:12.5px; color:var(--do2-text2); line-height:1.45; padding-top:2px;">${E(v.m.tip.note)}</span></span>`:''}<span data-dc-enter="${H(v.tipChart)}" data-dc-leave="${H(v.tipOff)}" style="cursor:help; position:absolute; left:${E(v.m.mvX)}; bottom:8px; transform:translateX(calc(-100% - 8px)); display:flex; align-items:baseline; gap:6px; padding:3px 8px; border-radius:7px; background:var(--do2-lift); border:1px solid var(--do2-edge-14); font-size:11.5px; font-weight:600; color:var(--do2-text2); white-space:nowrap;">Biggest move<span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-weight:700; color:var(--do2-text);">${E(v.m.sharp.mvPct)}</span></span></div></div><div style="display:flex; gap:10px;"><span style="flex:none; visibility:hidden; font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:11px;">${E(v.m.yMax)}</span><div style="position:relative; flex:1; min-width:0; height:16px; font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:11px; color:var(--do2-grey); white-space:nowrap;"><span style="position:absolute; left:0; top:0;">Opened ${E(v.m.sharp.openAt)}</span><span style="position:absolute; left:${E(v.m.mvX)}; top:0; transform:translateX(-50%); color:var(--do2-text2);">${E(v.m.sharp.mvAt)}</span><span style="position:absolute; right:0; top:0;">Match start</span></div></div><span style="font-size:12.5px; color:var(--do2-grey);">${E(v.m.sharpName)} moved first, ${E(v.m.lead)}.</span></div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:12px;"><div style="min-width:0; display:flex; flex-direction:column; padding:14px 18px 6px; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair);"><span style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding-bottom:12px;"><span style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700;"><span style="width:14px; height:2px; border-radius:1px; background:${E(v.m.sharp.lc)}; flex:none;"></span>${E(v.m.sharp.label)}</span><span style="display:flex; align-items:baseline; gap:8px;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:18px; font-weight:700; letter-spacing:-0.02em; color:${E(v.m.sharp.dropC)};">${E(v.m.sharp.drop)}</span><span style="font-size:12px; color:var(--do2-grey);">${E(v.m.sharp.pts)}</span></span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--do2-hair); font-size:12.5px; color:var(--do2-grey);">Opened<span style="display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; justify-content:flex-end;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.sharp.openAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text);">${E(v.m.sharp.openPx)}</span></span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--do2-hair); font-size:12.5px; color:var(--do2-grey);">Biggest move<span style="display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; justify-content:flex-end;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.sharp.mvAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.sharp.mvFromTo)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text);">${E(v.m.sharp.mvPct)}</span></span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--do2-hair); font-size:12.5px; color:var(--do2-grey);">Closed<span style="display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; justify-content:flex-end;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text); font-size:13px;">${E(v.m.sharp.closePx)}</span></span></span></div><div style="min-width:0; display:flex; flex-direction:column; padding:14px 18px 6px; border-radius:12px; background:var(--do2-inner); border:1px solid var(--do2-hair);"><span style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding-bottom:12px;"><span style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700;"><span style="width:14px; height:2px; border-radius:1px; background:${E(v.m.soft.lc)}; flex:none;"></span>${E(v.m.soft.label)}</span><span style="display:flex; align-items:baseline; gap:8px;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:18px; font-weight:700; letter-spacing:-0.02em; color:${E(v.m.soft.dropC)};">${E(v.m.soft.drop)}</span><span style="font-size:12px; color:var(--do2-grey);">${E(v.m.soft.pts)}</span></span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--do2-hair); font-size:12.5px; color:var(--do2-grey);">Opened<span style="display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; justify-content:flex-end;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.soft.openAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text);">${E(v.m.soft.openPx)}</span></span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--do2-hair); font-size:12.5px; color:var(--do2-grey);">Biggest move<span style="display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; justify-content:flex-end;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.soft.mvAt)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; color:var(--do2-text2);">${E(v.m.soft.mvFromTo)}</span><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text);">${E(v.m.soft.mvPct)}</span></span></span><span style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--do2-hair); font-size:12.5px; color:var(--do2-grey);">Closed<span style="display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; justify-content:flex-end;"><span style="font-family:'IBM Plex Mono',monospace; font-variant-numeric:tabular-nums; font-size:12px; white-space:nowrap; font-weight:700; color:var(--do2-text); font-size:13px;">${E(v.m.soft.closePx)}</span></span></span></div></div>
    </div>
  </div>
</div>
`; }
  var DC_ARCHIVE_HOVER_CSS = ".dxa1:hover{color:var(--do2-text) !important}\n.dxa2:hover{background:var(--do2-hover) !important}\n.dxa3:hover{background:var(--do2-hover) !important}\n.dxa4:hover{color:var(--do2-text) !important}\n.dxa5:hover{background:var(--do3-row-hover) !important}\n.dxa6:hover{background:var(--do2-hover) !important;color:var(--do3-white) !important}";

  // ─── the final design's view values (design_handoff_dropping_odds_final_2026-11-27, `renderVals`) ──────────────
  // Ported from the locked file's logic class onto the real feed: its sample data (D.R / D.M / mock series, timing and
  // books) is replaced by the selections from the drops endpoint, their recorded series and the Today's Matches card.
  // Colours are the design's, read through tokens (dc/colours.mjs). Rulings 2026-11-28 (founder): Bet105 is Pinnacle
  // with a margin, so the sharp reading (Pinnacle, else Bet105 without its margin) carries Sharp move / Meaningful only
  // too; the chart joins recorded prices with straight lines; "first recorded price", never "opened" as a claim.
  var T = {
    text: 'var(--do2-text)', text2: 'var(--do2-text2)', grey: 'var(--do2-grey)', dim2: 'var(--do2-dim2)', lift: 'var(--do2-lift)',
    hover: 'var(--do2-hover)', card: 'var(--do2-card)', track: 'var(--do2-track)', red: 'var(--do2-red)', blue: 'var(--do2-blue)',
    blueInk: 'var(--do2-blue-ink)', amber: 'var(--do3-amber)', white: 'var(--do3-white)', chipStrong: 'var(--do3-chip-strong)',
    e8: 'var(--do2-edge-8)', e10: 'var(--do2-edge-10)', e14: 'var(--do2-edge-14)', e22: 'var(--do2-edge-22)', e16: 'var(--do3-edge-16)',
    e6: 'var(--do2-hair)', e7: 'var(--do2-edge-7)', green: 'var(--do3-green)', blue16: 'var(--do2-blue-16)', blue40: 'var(--do3-blue-40)',
  };
  var BOOKS3 = BOOKS.concat(PRED_BOOKS);
  var CLS3 = {}; BOOKS3.forEach(function (b) { CLS3[b[0]] = b[1]; });
  var ALL3 = BOOKS3.map(function (b) { return b[0]; });
  function sg1(v) { return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(1); }
  // a reading's display fields (the file's `cell`)
  function cell3(r, big, dropC, lead, oneTxt, noneTxt) {
    var p = r.kind === 'drop' || r.kind === 'up' || r.kind === 'flat', moved = r.kind === 'drop' || r.kind === 'up';
    return { hasP: p, noP: !p, lead: p ? lead : '', leadD: p && lead ? 'inline' : 'none', open: p ? f2(r.o) : '', now: p ? f2(r.n) : '',
      deco: r.kind === 'drop' ? 'line-through' : 'none',
      big: r.kind === 'drop' ? r.d.toFixed(1) : r.kind === 'up' ? '+' + Math.abs(r.d).toFixed(1) : r.kind === 'flat' ? 'No move' : '—', pct: moved ? '%' : '',
      c: r.kind === 'drop' ? dropC : r.kind === 'flat' ? T.text2 : T.grey,
      fs: (r.kind === 'flat' ? Math.round(big * 0.72) : big) + 'px',
      impl: moved ? sg1(r.pts) + ' pts implied' : '', implShort: moved ? r.io.toFixed(1) + '% → ' + r.inn.toFixed(1) + '%' : '',
      shift: moved ? sg1(r.pts) + ' pts' : '', hasImpl: moved,
      note: r.kind === 'one' ? oneTxt : r.kind === 'none' ? noneTxt : '' };
  }
  // "Meaningful only" / the Sharp move chip (the file's isMean): the sharp reading moved 5 pts implied or more, or 2 pts or
  // more with at least half of the soft books following
  function isMean(c) {
    var sh = c.sharp;
    return sh.kind === 'drop' && (sh.pts >= 5 || (sh.pts >= 2 && c.soft.quotes > 0 && c.soft.down * 2 >= c.soft.quotes));
  }
  // the largest single step down in a recorded series (from one recorded price to the next), or null
  function bigStep(series) {
    var best = null;
    for (var i = 1; i < (series || []).length; i++) {
      var a = r2(series[i - 1].v), b = r2(series[i].v);
      if (b < a && (!best || (a - b) / a > best.p)) best = { p: (a - b) / a, from: a, to: b, t: series[i].t };
    }
    return best;
  }
  function stamp(t) {   // "Mon 14:00" in the member zone (the file's tAt)
    if (t == null) return '—';
    var p = zp(t);
    return WD[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()] + ' ' + p.hh + ':' + p.mm;
  }
  // Opened · biggest move (the file's `timing`, from the recorded prices)
  function timing(s, c, now) {
    var bk = s.bk, sk = sharpKey(bk), softTwo = SOFT_NAMES.filter(function (b) { return bk[b] && bk[b].first != null; });
    var lane = function (k, rdg, steps, who) {
      if (rdg.kind === 'drop' && steps) {
        var pct = '−' + ((steps.from - steps.to) / steps.from * 100).toFixed(1) + '%', mv = f2(steps.from) + ' → ' + f2(steps.to), o = {};
        o[k + 'Has'] = true; o[k + 'No'] = false; o[k + 'At'] = stamp(steps.t, now); o[k + 'Amt'] = pct; o[k + 'Mv'] = mv; o[k + 'Note'] = '';
        o[k + 'Title'] = 'Largest single move, ' + who + ': ' + mv;
        return o;
      }
      var n = {}; n[k + 'Has'] = false; n[k + 'No'] = true; n[k + 'At'] = ''; n[k + 'Amt'] = ''; n[k + 'Mv'] = ''; n[k + 'Title'] = '';
      n[k + 'Note'] = rdg.kind === 'none' ? 'no line' : rdg.kind === 'one' ? 'one price so far' : 'no real move';
      return n;
    };
    var pinStep = sk ? bigStep(bk[sk].series) : null;
    var softStep = null, softWho = 'soft books';
    softTwo.forEach(function (b) { var x = bigStep(bk[b].series); if (x && (!softStep || x.p > softStep.p)) { softStep = x; softWho = b; } });
    var softFirst = softTwo.length ? Math.min.apply(null, softTwo.map(function (b) { return bk[b].firstT; })) : null;
    var sOne = SOFT_NAMES.filter(function (b) { return bk[b]; });
    var softOpenT = softFirst != null ? softFirst : sOne.length ? Math.min.apply(null, sOne.map(function (b) { return bk[b].firstT; })) : null;
    var mean = isMean(c), strong = mean && c.sharp.pts >= 5, who = c.sharp.src === 'Bet105' ? 'Bet105' : 'Pinnacle';
    var o = {
      pinOpenPx: c.sharp.o != null ? f2(c.sharp.o) : c.sharp.n != null ? f2(c.sharp.n) : '',
      softOpenPx: c.soft.r.o != null ? f2(c.soft.r.o) : c.soft.r.n != null ? f2(c.soft.r.n) : '',
      pinOpenAt: sk ? stamp(bk[sk].firstT, now) : '—', softOpenAt: softOpenT != null ? stamp(softOpenT, now) : '—',
      pinC: mean ? T.blueInk : T.grey,
      hasChip: mean, chipLbl: strong ? 'Strong sharp move' : 'Sharp move',
      chipAgo: mean && pinStep ? agoShort(now - pinStep.t) : '',
      chipTitle: strong ? who + ' moved this selection by 5 pts implied or more' : who + ' moved this selection by 2 pts implied or more and at least half of the soft books followed',
      chipBg: strong ? T.chipStrong : T.lift, chipBd: strong ? T.e22 : T.e14, chipC: strong ? T.white : T.text2, chipW: strong ? 700 : 600,
      chipDot: strong ? T.text : T.grey, chipAgoC: strong ? T.text2 : T.grey,
    };
    var a = lane('pin', c.sharp, pinStep, who), b = lane('soft', c.soft.r, softStep, softWho);
    Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; });
    return o;
  }
  function inits(name) {
    var pn = String(name || '').split('.').join('').split(' ').filter(Boolean);
    return ((pn[0] ? pn[0][0] : '') + (pn[1] ? pn[1][0] : '')).toUpperCase();
  }
  // the avatar's contents: initials, the player's photo by ID over them (player-photos.md)
  function avIn(s) {
    var nm = s.dSide || s.side, ini = esc(inits(nm)), ph = '';
    if (s.photoKey != null && typeof playerPhotoImg === 'function') { try { ph = playerPhotoImg(s.photoKey, nm) || ''; } catch (e) { ph = ''; } }   // eslint-disable-line no-undef
    return RAW(ph ? '<span style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; border-radius:50%; overflow:hidden;">' + ini +
      '<span style="position:absolute; inset:0;">' + ph + '</span></span>' : ini);
  }
  function rowVals3(s, now, set) {
    var c = calc(s.bk), so = c.soft, bw = so.quotes === 1 ? 'soft book' : 'soft books', t = startMs(s), mv = movedAtOf(s);
    var shName = c.sharp.src === 'Bet105' ? 'Sharp · Bet105 (no margin)' : 'Sharp · Pinnacle';
    var v = timing(s, c, now);
    var x = { id: s.id, shLbl: shName,
      sh: cell3(c.sharp, 23, T.red, '', '1 price recorded · ' + (c.sharp.n != null ? f2(c.sharp.n) : ''), 'No sharp line'),
      so: cell3(so.r, 18, T.text, so.lead === 'avg' ? 'avg' : so.lead, so.quotes === 1 ? '1 soft book quoting, 1 price recorded' : so.quotes + ' soft books quoting, 1 price recorded each', 'No soft line'),
      hasCount: so.two > 0, softCount: so.down + ' of ' + so.quotes + ' ' + bw + ' down',
      softLbl: so.two > 1 ? 'Soft books · average of ' + so.two : so.two === 1 ? 'Soft books · ' + so.lead : 'Soft books',
      bestPrice: c.best ? f2(c.best.price) : '—', bestBook: c.best ? c.best.book : '', bestLbl: c.best && c.best.n > 1 ? 'Best now' : 'Now',
      softW: so.r.kind === 'drop' ? Math.min(100, Math.max(8, so.r.d / 40 * 100)).toFixed(0) + '%' : '0%',
      dropW: c.sharp.kind === 'drop' ? Math.min(100, Math.max(8, c.sharp.d / 40 * 100)).toFixed(0) + '%' : '0%',
      oName: s.dOpp || s.opp, ev: s.event || '', evSep: s.event ? ' · ' + s.event : '', rd: s.round || '', start: startLbl(t, now), cd: countdown(t, now),
      moved: (mv.moved ? 'moved ' : 'first recorded ') + agoShort(now - mv.t), movedLbl: agoShort(now - mv.t),
      ini: avIn(s), mk: MK[s.mk] || 'Match winner', line: (s.dSide || s.side) + ' to win',
      onClick: function () { set({ drawer: s.id, drBook: null, drPick: false, drPredOpen: false, drHov: null, menu: null, tip: false }); } };
    Object.keys(v).forEach(function (k) { x[k] = v[k]; });
    return x;
  }

  // the price history (24 h ending now): every recorded price, joined by straight lines (founder 2026-11-28); the line
  // runs on flat from the last recorded price to now. A price recorded before the window enters at the left edge at the
  // value the straight line between it and the next recorded price has there. Two dots per line: the first recorded
  // price (when it is inside the window) and now.
  function shapeSeries(series, t0, now) {
    var pts = [], before = null;
    (series || []).forEach(function (p) { if (p.t < t0) before = p; else if (p.t <= now) pts.push({ t: p.t, v: r2(p.v) }); });
    var carried = false;
    if (before) {
      var nx = pts[0], v0 = nx ? before.v + (nx.v - before.v) * (t0 - before.t) / (nx.t - before.t) : before.v;
      pts.unshift({ t: t0, v: r2(v0) }); carried = true;
    }
    if (pts.length) pts.push({ t: now, v: pts[pts.length - 1].v });
    return { pts: pts.map(function (p) { return { fr: Math.max(0, Math.min(1, (p.t - t0) / CHART_MS)), v: p.v }; }), carried: carried };
  }

  function drawerVals(s, S, now, set, mobile) {
    var v = rowVals3(s, now, set), bk = s.bk, c = calc(bk), sk = sharpKey(bk), sharpBook = sk === 'Pinnacle' ? 'Pinnacle' : sk ? 'Bet105' : null;
    var sharpName = sk === 'Pinnacle' ? 'Pinnacle' : 'Bet105 (no margin)';
    var quotedN = ALL3.filter(function (b) { return bk[b]; });
    var nonPin = quotedN.filter(function (b) { return b !== sharpBook && CLS3[b] !== 'pred'; });
    var defBook = nonPin[0]; nonPin.forEach(function (b) { if (r2(bk[b].now) > r2(bk[defBook].now)) defBook = b; });
    var selName = S.drBook && bk[S.drBook] && CLS3[S.drBook] !== 'pred' && S.drBook !== sharpBook ? S.drBook : defBook || null;
    var pinOn = !!sk, t0 = now - CHART_MS;
    var predNames = quotedN.filter(function (b) { return CLS3[b] === 'pred'; });
    var prName = S.drPred === 'off' ? null : (S.drPred && predNames.indexOf(S.drPred) >= 0 ? S.drPred : predNames[0]) || null;
    var sh = function (name) { return name ? shapeSeries(bk[name].series, t0, now) : { pts: [], carried: false }; };
    var pS = sh(selName), pP = pinOn ? shapeSeries(bk[sk].series, t0, now) : { pts: [], carried: false }, pR = sh(prName);
    var selC = T.text, BLUE = T.blue, AMB = T.amber;
    var lgOff = S.drOff || {};
    var vPts = lgOff.sel ? [] : pS.pts, vPin = lgOff.pin ? [] : pP.pts, vPrd = lgOff.prd ? [] : pR.pts;
    var vs = pS.pts.concat(pP.pts, pR.pts).map(function (p) { return p.v; });   // the scale does not rescale when a line is hidden
    var lo = vs.length ? Math.min.apply(null, vs) : 1, hi = vs.length ? Math.max.apply(null, vs) : 2;
    if (hi - lo < 0.1) { lo -= 0.1; hi += 0.1; }
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    if (lo < 1) lo = 1;                   // decimal odds never go under 1.00 (drops.md r2 fix 11)
    var pY = function (x) { return (hi - x) / (hi - lo); };
    var cxy = function (p) { return (p.fr * 1000).toFixed(1) + ',' + (pY(p.v) * 300).toFixed(1); };
    var dotsOf = function (a, carried, col) {
      if (!a.length) return [];
      var out = [];
      if (!carried && a.length > 1) out.push({ left: (a[0].fr * 100).toFixed(2) + '%', top: (pY(a[0].v) * 100).toFixed(2) + '%', c: col, s: '6px' });
      var z = a[a.length - 1];
      out.push({ left: (z.fr * 100).toFixed(2) + '%', top: (pY(z.v) * 100).toFixed(2) + '%', c: col, s: '9px' });
      return out;
    };
    var db = dayBands(t0, now);
    var labelOf = function (nm) { return nm === sk ? sharpName : nm; };
    var ch = {
      gridY: [0, 0.25, 0.5, 0.75, 1].map(function (g) { return { y: (g * 300).toFixed(1), top: (g * 100) + '%', label: (hi - g * (hi - lo)).toFixed(2) }; }),
      ticks: [0, 0.25, 0.5, 0.75, 1].map(function (f) { return { label: hm(t0 + f * CHART_MS), x: (f * 1000).toFixed(1), left: (f * 100) + '%', tf: f === 0 ? 'none' : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)' }; }),
      hasDaySplit: db.splits.length > 0, dayX: db.splits.length ? db.splits[0] : '0',
      dayBands: db.bands.map(function (b) { return { w: b.w, label: parseFloat(b.w) < 14 ? '' : b.label }; }),
      points: vPts.map(cxy).join(' '), pinPoints: vPin.map(cxy).join(' '), prdPoints: vPrd.map(cxy).join(' '), selC: selC,
      dots: dotsOf(vPrd, pR.carried, AMB).concat(dotsOf(vPin, pP.carried, BLUE), dotsOf(vPts, pS.carried, selC)),
      ends: (function () {
        var e = [[vPin, BLUE], [vPts, selC], [vPrd, AMB]].filter(function (x) { return x[0].length; })
          .map(function (x) { var a = x[0]; return { t: pY(a[a.length - 1].v) * 100, c: x[1], label: f2(a[a.length - 1].v) }; })
          .sort(function (x, y) { return x.t - y.t; });
        for (var i = 1; i < e.length; i++) if (e[i].t - e[i - 1].t < 8) e[i].t = e[i - 1].t + 8;
        return e.map(function (x) { return { top: x.t.toFixed(2) + '%', c: x.c, label: x.label }; });
      })(),
      hov: (function () {
        var fr = S.drHov;
        if (fr == null || mobile) return { on: false, rows: [], marks: [] };
        var at = function (a) {
          if (!a.length || fr < a[0].fr) return null;
          var k = 0; while (k < a.length - 1 && a[k + 1].fr <= fr) k++;
          if (k === a.length - 1) return a[k].v;
          var p = a[k], q = a[k + 1]; return q.fr === p.fr ? q.v : p.v + (q.v - p.v) * (fr - p.fr) / (q.fr - p.fr);
        };
        var L = [[vPin, BLUE, pinOn ? sharpName : ''], [vPts, selC, selName], [vPrd, AMB, prName]].filter(function (x) { return x[0].length; })
          .map(function (x) { return { c: x[1], name: x[2], v: at(x[0]) }; });
        return { on: true, left: (fr * 100).toFixed(2) + '%', tf: fr > 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)', time: hm(t0 + fr * CHART_MS),
          rows: L.map(function (x) { return { c: x.c, name: x.name, v: x.v == null ? '—' : f2(x.v) }; }),
          marks: L.filter(function (x) { return x.v != null; }).map(function (x) { return { c: x.c, top: (pY(x.v) * 100).toFixed(2) + '%' }; }) };
      })(),
      onMove: function (e) { var b = e.currentTarget.getBoundingClientRect(), fr = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)); set({ drHov: Math.round(fr * 200) / 200 }, true); },
      onLeave: function () { set({ drHov: null }, true); },
      legend: (pinOn ? [sk] : []).concat(selName ? [selName] : [], prName ? [prName] : []).map(function (nm) {
        var r = rd(bk[nm].first, bk[nm].now), lk = nm === prName ? 'prd' : nm === sk && pinOn ? 'pin' : 'sel', isOff = !!lgOff[lk], lbl = labelOf(nm);
        return { onClick: function () { var o = {}; Object.keys(S.drOff || {}).forEach(function (k) { o[k] = S.drOff[k]; }); o[lk] = !o[lk]; set({ drOff: o }, true); },
          bg: isOff ? 'transparent' : T.lift, bd: isOff ? T.e8 : T.e14, op: isOff ? 0.5 : 1, tip: (isOff ? 'Show ' : 'Hide ') + lbl + ' on the chart',
          n: f2(r.n), name: lbl, c: nm === sk && pinOn ? BLUE : nm === prName ? AMB : T.text,
          d: r.kind === 'drop' ? r.d.toFixed(1) + '%' : r.kind === 'flat' ? 'No move' : r.kind === 'up' ? '+' + Math.abs(r.d).toFixed(1) + '%' : '',
          dc: r.kind === 'drop' ? T.red : T.grey };
      }),
    };
    var best = c.best ? c.best.price : null;
    var books = BOOKS3.map(function (b) {
      var name = b[0], cls = b[1], p = bk[name], sel = name === selName, r = p ? rd(p.first, p.now) : { kind: 'none' };
      var onChart = sel || name === prName || (name === sharpBook && pinOn);
      return { book: name, bName: name, cls: cls, r: r, quoted: !!p, open: r.o != null ? f2(r.o) : '—', now: p ? f2(r.n) : '—',
        nc: p ? T.text : T.grey, ncol: p ? T.text : T.dim2,
        dropLbl: r.kind === 'none' ? 'No line' : r.kind === 'one' ? 'One price' : r.kind === 'flat' ? 'No move' : r.kind === 'drop' ? r.d.toFixed(1) + '%' : '+' + Math.abs(r.d).toFixed(1) + '%',
        dotC: sel ? selC : (name === sharpBook && pinOn ? BLUE : name === prName ? AMB : 'transparent'),
        tip: !p ? name + ' has no line on this selection' : onChart ? name + ' is on the chart' : 'Show ' + name + ' on the chart',
        dc: r.kind === 'drop' ? T.red : T.grey, dotD: onChart ? 'block' : 'none',
        rowBg: onChart ? T.lift : 'transparent', rowHov: p ? T.hover : 'transparent',
        mv: r.kind === 'none' || r.kind === 'one' ? '' : r.kind === 'flat' ? 'No move' : r.kind === 'drop' ? r.d.toFixed(1) + '%' : '+' + Math.abs(r.d).toFixed(1) + '%',
        sub: r.kind === 'none' ? 'No line' : r.kind === 'one' ? 'One price recorded' : r.kind === 'flat' ? 'Implied unchanged' : 'Implied ' + sg1(r.pts) + ' pts',
        cur: p ? 'pointer' : 'default',
        onPick: !p ? null : cls === 'pred' ? function () { set({ drPred: name }, true); } : name === sharpBook ? null : function () { set({ drBook: name }, true); } };
    });
    var qd = books.filter(function (b) { return b.quoted; }), cnt = function (f) { return qd.filter(f).length; }, dn = function (b) { return b.r.kind === 'drop'; };
    var groups = [['Sharp books', 'sharp'], ['Soft books', 'soft'], ['Prediction markets', 'pred']].map(function (g) {
      var rows = books.filter(function (b) { return b.cls === g[1]; }), qn = rows.filter(function (b) { return b.quoted; }).length, nl = rows.length - qn, u = g[1] === 'pred' ? 'market' : 'book';
      return { key: g[1], label: g[0], colLbl: g[1] === 'pred' ? 'Market' : 'Bookmaker',
        desc: { sharp: 'Low margin, first to move', soft: 'Higher margin, slower to move', pred: 'Traded prices, shown as decimal odds' }[g[1]], rows: rows,
        meta: (qn ? rows.filter(dn).length + ' of ' + qn + ' quoting ' + u + (qn === 1 ? '' : 's') + ' down' : 'No ' + u + ' quoting') + (nl && qn ? ' · ' + nl + ' with no line' : '') };
    });
    var selO = selName ? bk[selName].first : null, selSingle = selName && selO == null;
    var card = s.card && s.card.id != null ? s.card : null;
    var dr = v;
    var extra = {
      ch: ch, shLbl: v.shLbl.replace('Sharp · ', 'Sharp · '),
      chartNote: selSingle ? 'One price recorded at ' + selName + ' so far. Its line appears once a second snapshot arrives.' : '',
      pinNote: !sk ? 'Pinnacle has no line on this selection, so the chart has no sharp overlay.'
        : sk !== 'Pinnacle' ? 'Pinnacle has no line on this selection, so the sharp line is Bet105 with its margin removed.' : '',
      summary: cnt(function (b) { return b.r.kind !== 'one'; }) === 0 ? 'Quoted at ' + qd.length + ' of ' + ALL3.length + ' books and markets, with one recorded price so far, so no drop yet.'
        : 'Down at ' + cnt(dn) + ' of ' + qd.length + ' quoting this line (' + [['sharp', 'sharp', 'no sharp line'], ['soft', 'soft', 'no soft line'], ['pred', 'prediction markets', 'no prediction market quoting']].map(function (k) {
          var q = cnt(function (b) { return b.cls === k[0]; }); return q ? cnt(function (b) { return dn(b) && b.cls === k[0]; }) + ' of ' + q + ' ' + k[1] : k[2]; }).join(', ') + ').',
      colA: groups.filter(function (g) { return g.key !== 'soft'; }), colB: groups.filter(function (g) { return g.key === 'soft'; }),
      sub: [v.mk, 'vs ' + v.oName, v.ev, v.rd].filter(Boolean).join(' · '), movedShort: v.movedLbl,
      shOpening: v.pinOpenPx ? v.pinOpenPx + ' · ' + v.pinOpenAt : '—', soOpening: v.softOpenPx ? v.softOpenPx + ' · ' + v.softOpenAt : '—',
      softCountShort: c.soft.down + ' of ' + c.soft.quotes,
      predNote: predNames.length ? '' : 'No prediction market quotes this selection, so the chart has no prediction market line.',
      predD: predNames.length ? 'block' : 'none', predVal: prName || 'Off', predOpen: !!S.drPredOpen,
      predBgM: S.drPredOpen ? T.lift : 'transparent', predBdM: S.drPredOpen ? T.e14 : 'transparent',
      pickBgM: S.drPick ? T.lift : 'transparent', pickBdM: S.drPick ? T.e14 : 'transparent',
      predToggle: function () { set({ drPredOpen: !S.drPredOpen, drPick: false }, true); },
      predOpts: predNames.map(function (nm) { return { label: nm, now: f2(r2(bk[nm].now)), on: nm === prName, v: nm }; }).concat([{ label: 'Off', now: '', on: !prName, v: 'off' }])
        .map(function (o) { return { label: o.label, now: o.now, c: o.on ? T.text : T.text2, bg: o.on ? T.hover : 'transparent', onClick: function () { set({ drPred: o.v, drPredOpen: false }, true); } }; }),
      selName: selName || '—', pickOpen: !!S.drPick, pickToggle: function () { set({ drPick: !S.drPick, drPredOpen: false }, true); },
      pickGroups: [['Sharp books', 'sharp'], ['Soft books', 'soft']].map(function (g) {
        return { head: g[0], opts: books.filter(function (b) { return b.cls === g[1] && b.quoted && b.book !== sharpBook; }).map(function (b) {
          var on = b.book === selName; return { label: b.book, now: b.now, c: on ? T.text : T.text2, bg: on ? T.hover : 'transparent', onClick: function () { set({ drBook: b.book, drPick: false }, true); } }; }) };
      }).filter(function (g) { return g.opts.length; }),
      quoting: quotedN.length + ' of ' + ALL3.length, lineLbl: nonPin.length < 2 ? '' : bk.Pinnacle ? 'Compare with Pinnacle' : 'Bookmaker', lineD: nonPin.length < 2 ? 'none' : 'flex',
      maD: !mobile && card ? 'flex' : 'none',
      openMA: function () { set({ drawer: null }); if (card && typeof openAnalysisModal === 'function') openAnalysisModal(card.id); },   // eslint-disable-line no-undef
      pad: mobile ? '16px 14px 20px' : '20px 24px 24px', headPad: mobile ? '14px' : '18px 24px',
      top: mobile ? '64px' : '50%', left: mobile ? '0' : '50%', right: mobile ? '0' : 'auto', bottom: mobile ? '0' : 'auto', tf: mobile ? 'none' : 'translate(-50%, -50%)',
      w: mobile ? '100%' : '980px', mw: mobile ? '100%' : 'calc(100% - 48px)', mh: mobile ? 'none' : 'calc(100% - 64px)', rad: mobile ? '16px 16px 0 0' : '16px',
    };
    Object.keys(extra).forEach(function (k) { dr[k] = extra[k]; });
    dr.hasNote = !!(dr.chartNote || dr.pinNote || dr.predNote);
    return dr;
  }

  // the page values (the file's renderVals, desktop)
  function pageVals(st, now, fs, set, mobile) {
    var S = st.S, vw = window.innerWidth || 1440;
    var v = view(st.sels, S, now), list = st.everLoaded ? v.list : [];
    var seg = function (label, on, onClick) { return { label: label, on: on, onClick: onClick, w: on ? 700 : 600, c: on ? T.text : T.grey, bg: on ? T.lift : 'transparent', bd: on ? T.e14 : 'transparent' }; };
    var opt = function (label, on, onClick) { return { label: label, onClick: onClick, c: on ? T.text : T.grey, boxBg: on ? T.lift : T.track, boxBd: on ? T.e22 : T.e14, tick: on ? '✓' : '' }; };
    var togl = function (arr, x) { var i = arr.indexOf(x); if (i >= 0) return arr.length === 1 ? arr : arr.filter(function (y) { return y !== x; }); return arr.concat([x]); };
    var setS = function (o) { var n = {}; Object.keys(S).forEach(function (k) { n[k] = S[k]; }); Object.keys(o).forEach(function (k) { n[k] = o[k]; }); set({ S: n }); };
    var U = S.unit === 'pts' ? 'pts' : 'pct';
    var ranked = list.map(function (s) { var c = calc(s.bk); return S.btype === 'soft' ? c.soft.r : c.sharp; }).filter(function (r) { return r.kind === 'drop'; });
    var rows = list.map(function (s) { return rowVals3(s, now, set); });
    var allBooks = S.books.length === BOOK_NAMES3().length;
    var bookMenu = { key: 'book', label: 'Bookmaker', value: allBooks ? 'All' : S.books.length === 1 ? S.books[0] : S.books.length + ' books', active: !allBooks,
      groups: [['sharp', 'Sharp books'], ['soft', 'Soft books'], ['pred', 'Prediction markets']].map(function (g) {
        return { head: g[1], opts: BOOKS3.filter(function (b) { return b[1] === g[0]; }).map(function (b) { return opt(b[0], S.books.indexOf(b[0]) >= 0, function () { setS({ books: togl(S.books, b[0]) }); }); }) }; }) };
    var mOpen = st.menu === 'book';
    var tabMenus = [{ label: bookMenu.label, value: bookMenu.value, active: bookMenu.active, idle: !bookMenu.active, open: mOpen, groups: bookMenu.groups,
      vc: bookMenu.active ? T.text : T.grey, bg: mOpen ? T.hover : T.lift, bd: bookMenu.active || mOpen ? T.e22 : T.e14,
      onToggle: function () { set({ menu: mOpen ? null : 'book' }); },
      onClear: function (e) { e.stopPropagation(); setS({ books: BOOK_NAMES3() }); set({ menu: null }); } }];
    var MV = S.mv || 'all';
    var nActive = [S.tiers.length !== 3, !allBooks, S.win !== 'open', S.min > 0, MV !== 'all'].filter(Boolean).length;
    var mkTot = v.mkN.mw || 0;
    var tabOf = function (label, on, n, onClick) { return { label: label, n: String(n), onClick: onClick, ul: on ? T.text : 'transparent', c: on ? T.text : T.grey }; };
    var minL = MIN.filter(function (x) { return x[0] === S.min; })[0][1], winL = WIN_TXT[S.win];
    var loading = !st.everLoaded && st.reachable;
    return {
      tabName: 'Dropping Odds', archiveHref: '#drops-archive', openArchive: function (e) { e.preventDefault(); if (!st.A) st.A = archDefaults(); set({ archive: true }); window.scrollTo(0, 0); },
      deckCols: vw < 1400 ? 'repeat(3,minmax(0,1fr))' : 'minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.85fr) minmax(0,0.6fr)',
      timeOrd: vw < 1400 ? 4 : 0, timeCol: vw < 1400 ? '1 / -1' : 'auto',
      rowCols: vw < 1240 ? '186px minmax(0,1fr) 148px 92px 10px' : '252px minmax(0,1.3fr) minmax(204px,0.8fr) 112px 104px 10px', rowGap: vw < 1240 ? '14px' : '18px',
      hdrDrops: st.everLoaded ? String(ranked.length) : '—',
      hdrBiggest: !ranked.length ? '—' : U === 'pts' ? '+' + Math.max.apply(null, ranked.map(function (r) { return r.pts; })).toFixed(1) + ' pts' : Math.max.apply(null, ranked.map(function (r) { return r.d; })).toFixed(1) + '%',
      hdrBiggestC: ranked.length ? T.text : T.dim2,
      updatedVal: st.status && st.status.generatedAt ? clock(st.status.generatedAt) : '—',
      q: S.q, onQ: function (e) { setS({ q: e.target.value }); },
      tabMenus: tabMenus, hasActive: nActive > 0 || !!S.q || !!S.mean,
      resetFilters: function () { set({ S: defaults(), menu: null }); },
      tierOpts: TIERS.map(function (t) { return seg(t, S.tiers.indexOf(t) >= 0, function () { setS({ tiers: togl(S.tiers, t) }); }); }),
      winOpts: WINDOWS.map(function (w) { return seg(w[1], S.win === w[0], function () { setS({ win: w[0] }); }); }),
      minOpts: MIN.map(function (m) { return seg(m[1], S.min === m[0], function () { setS({ min: m[0] }); }); }),
      mvOpts: MVL.map(function (m) { return seg(m[1], MV === m[0], function () { setS({ mv: m[0] }); }); }),
      mean: seg('Meaningful only', !!S.mean, function () { setS({ mean: !S.mean }); }),
      isDrops: true, disconnected: fs === 'disconnected' && (st.everLoaded || !st.reachable), connected: fs !== 'disconnected',
      reconnect: function () { refresh(); },
      mkTabs: [tabOf('All markets', (S.mkTab || 'all') === 'all', mkTot, function () { setS({ mkTab: 'all' }); })]
        .concat(Object.keys(MK).map(function (k) { return tabOf(MK[k], S.mkTab === k, v.mkN[k] || 0, function () { setS({ mkTab: k }); }); })),
      sortOpts: [seg('Biggest sharp drop', S.sort === 'drop' && S.btype !== 'soft', function () { setS({ sort: 'drop', btype: S.btype === 'soft' ? 'all' : S.btype }); }),
        seg('Biggest soft drop', S.sort === 'drop' && S.btype === 'soft', function () { setS({ sort: 'drop', btype: 'soft' }); }),
        seg('Latest move', S.sort === 'recent', function () { setS({ sort: 'recent' }); }),
        seg('Starting soonest', S.sort === 'soon', function () { setS({ sort: 'soon' }); })],
      unitOpts: [['pct', 'Drop %'], ['pts', 'Pts implied']].map(function (u) { return seg(u[1], U === u[0], function () { setS({ unit: u[0], sort: 'drop' }); }); }),
      tip: !!st.tip, tipOn: function () { set({ tip: true }); }, tipOff: function () { set({ tip: false }); }, tipToggle: function () { set({ tip: !st.tip }); },
      loading: loading, empty: st.everLoaded && rows.length === 0, hasRows: rows.length > 0, rows: rows,
      skel: [['62%', '44%'], ['54%', '38%'], ['70%', '48%'], ['58%', '40%'], ['66%', '46%'], ['50%', '36%'], ['60%', '42%']].map(function (w) { return { w1: w[0], w2: w[1] }; }),
      emptyDetail: 'Minimum drop ' + minL + ' · ' + winL,
    };
  }

  // ─── "Biggest moves of the past days" (the archive; founder 2026-11-28, design Dropping Odds Archive.dc.html) ──────
  // The file's renderVals on the endpoint's /archive.json (stennisfy-drops/archive.mjs over drops_archive.records): one
  // row per finished, flagged selection. Its sharp reading is Bet105 without its margin (the store holds no Pinnacle
  // series; founder 2026-11-28: "Bet105 is Pinnacle with a margin"), named so everywhere the file says Pinnacle. A close
  // exists only at a verified start; without one the Closed cell is a dash. Prices, times and results are the record's.
  var ARCH_SHARP = 'Bet105 (no margin)';
  function archDefaults() { return { side: 'sharp', days: 7, tier: 'All', view: 'day', strong: false, band: 'all', oMin: '', oMax: '', open: null, tip: null, oddsMenu: false }; }
  function archLoad() {
    if (st.archLoading || (st.arch && Date.now() - st.arch.got < 5 * 60e3)) return;
    st.archLoading = true;
    fetch(ENDPOINT + '/archive.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { st.arch = { rows: Array.isArray(j.rows) ? j.rows : [], at: j.generatedAt || null, got: Date.now() }; })
      .catch(function () { st.arch = { rows: null, got: Date.now(), failed: true }; })
      .then(function () { st.archLoading = false; render(); });
  }
  function archDay(t) { var p = zp(t); return WD[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()] + ' ' + p.d + ' ' + MON[p.m]; }
  function archStamp(iso) { if (!iso) return '—'; var t = Date.parse(iso), p = zp(t); return WD[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()] + ' ' + p.hh + ':' + p.mm; }
  function archDayKey(t) { var p = zp(t); return p.y * 400 + p.m * 32 + p.d; }
  function archVals(now, set) {
    var A = st.A, arch = st.arch, sideK = A.side === 'soft' ? 'soft' : 'sharp';
    var setA = function (o) { var n = {}; Object.keys(A).forEach(function (k) { n[k] = A[k]; }); Object.keys(o).forEach(function (k) { n[k] = o[k]; }); set({ A: n }); };
    var seg = function (label, on, onClick) { return { label: label, onClick: onClick, w: on ? 700 : 600, c: on ? T.text : T.grey, bg: on ? T.lift : 'transparent', bd: on ? T.e14 : 'transparent' }; };
    var tracks = [
      { label: 'Books', opts: [['sharp', 'Sharp'], ['soft', 'Soft']].map(function (x) { return seg(x[1], sideK === x[0], function () { setA({ side: x[0] }); }); }) },
      { label: 'Period', opts: [[7, '7 days'], [30, '30 days'], [90, '90 days']].map(function (x) { return seg(x[1], A.days === x[0], function () { setA({ days: x[0] }); }); }) },
      { label: 'Tier', opts: ['All', 'ATP', 'Challenger', 'ITF'].map(function (x) { return seg(x === 'All' ? 'All tiers' : x, A.tier === x, function () { setA({ tier: x }); }); }) },
      { label: 'Order', opts: [['day', 'By day'], ['big', 'Biggest first']].map(function (x) { return seg(x[1], A.view === x[0], function () { setA({ view: x[0] }); }); }) }];
    var BANDS = [['all', 'All', 'Every opening price', 0, 99], ['fav', 'Favourites', 'Opened under 1.70', 0, 1.6999], ['mid', 'Around evens', 'Opened from 1.70 to 2.20', 1.70, 2.20], ['dog', 'Underdogs', 'Opened above 2.20', 2.2001, 99]];
    var num = function (v) { var x = parseFloat(String(v).replace(',', '.')); return isFinite(x) && x > 1 ? x : null; };
    var custom = A.band === 'custom', cMin = num(A.oMin), cMax = num(A.oMax), bd = BANDS.filter(function (b) { return b[0] === A.band; })[0] || BANDS[0];
    var lo = custom ? (cMin == null ? 0 : cMin) : bd[3], hi = custom ? (cMax == null ? 99 : cMax) : bd[4];
    var oddsOn = custom ? (cMin != null || cMax != null) : A.band !== 'all';
    var typed = function (k) { return function (e) { var v = String(e.target.value).replace(/[^0-9.,]/g, ''), o = {}; o[k] = v; var nMin = k === 'oMin' ? v : A.oMin, nMax = k === 'oMax' ? v : A.oMax; o.band = nMin || nMax ? 'custom' : 'all'; setA(o); }; };
    var oddsLbl = !oddsOn ? '' : custom ? ' · opening odds ' + (cMin != null ? f2(cMin) : 'any') + ' to ' + (cMax != null ? f2(cMax) : 'any') : ' · ' + bd[1].toLowerCase() + ' (' + bd[2].toLowerCase() + ')';
    var rows = (arch && arch.rows) || [];
    var list = rows.filter(function (r) {
      var m = r[sideK], t = Date.parse(r.scheduledAt || r.startAt);
      return m && m.drop > 0 && isFinite(t) && now - t <= A.days * 864e5 && (A.tier === 'All' || r.tier === A.tier) && (!A.strong || m.pts >= 5) && m.o >= lo && m.o <= hi;
    });
    var nm = function (r, n) { return HELP.shortName(n); };
    var ev = function (r) { return r.event ? HELP.eventName(r.event) : ''; };
    var fx = function (r) { return Date.parse(r.scheduledAt || r.startAt); };
    var row = function (r, i) {
      var m = r[sideK], strong = m.pts >= 5, sharpMove = sideK === 'sharp' && m.pts >= 2, name = nm(r, r.side);
      return { drop: m.drop.toFixed(1), pts: (m.pts < 0 ? '−' : '+') + Math.abs(m.pts).toFixed(1) + ' pts', ini: RAW(esc(inits(name))), name: name + ' to win',
        meta: ['vs ' + nm(r, r.opp), ev(r)].filter(Boolean).join(' · ') + (A.view === 'big' ? ' · ' + archDay(fx(r)) : ''),
        hasBadge: sharpMove, bLbl: strong ? 'Strong sharp move' : 'Sharp move', bW: strong ? 700 : 600, bC: strong ? T.white : T.text2, bBg: strong ? T.chipStrong : T.lift, bBd: strong ? T.e22 : T.e14,
        openAt: archStamp(m.oAt), openPx: f2(m.o), mvAt: m.mv ? archStamp(m.mv.at) : '—', mvFromTo: m.mv ? f2(m.mv.from) + ' → ' + f2(m.mv.to) : '—', mvPct: m.mv ? '−' + m.mv.pct.toFixed(1) + '%' : '',
        closePx: m.c != null ? f2(m.c) : '—', onOpen: function () { setA({ open: r.key, tip: null }); },
        res: r.won ? 'Won' : 'Lost', resC: r.won ? T.text : T.grey, resSq: r.won ? T.green : T.red, score: r.score || '—', sep: i ? T.e6 : 'transparent' };
    };
    var byDrop = function (a, b) { return b[sideK].drop - a[sideK].drop; };
    var groups;
    if (A.view === 'big') groups = list.length ? [{ title: 'Biggest ' + sideK + ' moves', sub: 'last ' + A.days + ' days · top ' + Math.min(25, list.length), topLbl: '', top: '', rows: list.slice().sort(byDrop).slice(0, 25).map(row) }] : [];
    else {
      var byDay = {}; list.forEach(function (r) { var k = archDayKey(fx(r)); (byDay[k] = byDay[k] || []).push(r); });
      groups = Object.keys(byDay).sort(function (a, b) { return b - a; }).map(function (k) {
        var rs = byDay[k], w = rs.filter(function (r) { return r.won; }).length;
        return { title: archDay(fx(rs[0])), sub: rs.length + (rs.length === 1 ? ' move' : ' moves') + ' · ' + w + ' won', topLbl: 'Biggest', top: Math.max.apply(null, rs.map(function (r) { return r[sideK].drop; })).toFixed(1) + '%', rows: rs.slice().sort(byDrop).map(row) };
      });
    }
    var n = list.length, won = list.filter(function (r) { return r.won; }).length, top = list.slice().sort(byDrop)[0];
    var priced = list.filter(function (r) { return r[sideK].mv; });   // the yield needs the price right after the biggest move
    var pl = priced.reduce(function (a, r) { return a + (r.won ? r[sideK].mv.to - 1 : -1); }, 0), y = priced.length ? pl / priced.length * 100 : 0;
    var tiles = [
      { cap: 'Moves logged', val: arch && arch.rows ? String(n) : '—', c: T.text, sub: 'last ' + A.days + ' days · ' + (sideK === 'sharp' ? 'sharp books' : 'soft books') },
      { cap: 'Biggest move', val: top ? top[sideK].drop.toFixed(1) + '%' : '—', c: top ? T.red : T.dim2, sub: top ? nm(top, top.side) + ' · ' + archDay(fx(top)) + ' · ' + f2(top[sideK].o) + ' → ' + f2(top[sideK].c != null ? top[sideK].c : top[sideK].n) : 'No move in this period' },
      { cap: 'Won after the move', val: n ? Math.round(won / n * 100) + '%' : '—', c: T.text, sub: n ? won + ' of ' + n + ' selections won' : '' },
      { cap: 'Yield backing after the move', val: priced.length >= 5 ? (y < 0 ? '−' : '+') + Math.abs(y).toFixed(1) + '%' : '—', c: priced.length < 5 ? T.dim2 : y >= 0 ? T.green : T.red,
        sub: priced.length >= 5 ? '1u on each, at the price right after the biggest move' : 'Under 5 moves, too few to read' }];
    var SUB = { all: 'any', fav: 'under 1.70', mid: '1.70 – 2.20', dog: 'above 2.20' };
    var oddsOpts = BANDS.map(function (b) { var on = A.band === b[0]; return { label: b[1], sub: SUB[b[0]], mBg: on ? T.hover : 'transparent', mW: on ? 700 : 500, mC: on ? T.text : T.text2, onClick: function () { setA({ band: b[0], oMin: '', oMax: '', oddsMenu: false }); } }; });
    var R = A.open ? rows.filter(function (r) { return r.key === A.open; })[0] : null;
    var mb = R ? archBox(R, set, setA) : null;
    return {
      back: function () { set({ archive: false }); },
      oddsVal: custom ? (oddsOn ? (cMin != null ? f2(cMin) : 'any') + ' – ' + (cMax != null ? f2(cMax) : 'any') : 'All') : A.band === 'all' ? 'All' : SUB[A.band],
      oValC: oddsOn ? T.text : T.text2, oddsOpen: !!A.oddsMenu, oddsToggle: function () { setA({ oddsMenu: !A.oddsMenu }); }, oddsClose: function () { setA({ oddsMenu: false }); },
      oChipBg: A.oddsMenu ? T.hover : T.lift, oChipBd: oddsOn || A.oddsMenu ? T.e22 : T.e14,
      tipIsChart: !!mb && A.tip === 'chart', tipIsStep: !!mb && A.tip === 'step',
      tipChart: function () { setA({ tip: 'chart' }); }, tipStep: function () { setA({ tip: 'step' }); }, tipOff: function () { setA({ tip: null }); },
      oddsOpts: oddsOpts, oMin: A.oMin, oMax: A.oMax, onMin: typed('oMin'), onMax: typed('oMax'), oBd: custom ? T.e22 : T.e10,
      hasM: !!mb, m: mb || { sharp: {}, soft: {}, tip: {} }, closeM: function () { setA({ open: null, tip: null }); }, stop: function (e) { e.stopPropagation(); },
      tracks: tracks, tiles: tiles, groups: groups, isEmpty: !!(arch && arch.rows) && n === 0, dropHead: (sideK === 'sharp' ? 'Sharp' : 'Soft') + ' drop',
      strong: { onClick: function () { setA({ strong: !A.strong }); }, w: A.strong ? 700 : 600, c: A.strong ? T.text : T.grey, bg: A.strong ? T.lift : T.track, bd: A.strong ? T.e14 : T.e10 },
      countLine: !arch ? 'Loading moves…' : arch.failed ? 'The archive could not be loaded just now.' :
        n + (n === 1 ? ' move' : ' moves') + ' on finished matches · ' + (sideK === 'sharp' ? 'sharp books (' + ARCH_SHARP + ')' : 'soft books, average') + oddsLbl + (A.strong ? ' · strong only' : ''),
    };
  }
  // the row's box (the file's `m`): the step strip, the price history (recorded prices joined straight), both readings
  function archBox(R, set, setA) {
    var sh = R.sharp, so = R.soft, name = HELP.shortName(R.side), strong = sh && sh.pts >= 5;
    var lines = [sh && sh.line, so && so.line].filter(function (l) { return l && l.length; });
    var all = []; lines.forEach(function (l) { l.forEach(function (p) { all.push(p); }); });
    var ts = all.map(function (p) { return Date.parse(p[0]); }), vs = all.map(function (p) { return p[1]; });
    var t0 = ts.length ? Math.min.apply(null, ts) : 0, t1 = ts.length ? Math.max.apply(null, ts) : 1, span = Math.max(1, t1 - t0);
    var hi = (vs.length ? Math.max.apply(null, vs) : 2) + 0.04, lo = Math.max(1, (vs.length ? Math.min.apply(null, vs) : 1) - 0.04);
    var Y = function (v) { return (hi - v) / (hi - lo) * 200; }, X = function (t) { return (Date.parse(t) - t0) / span * 1000; };
    var path = function (l) { return (l || []).map(function (p) { return X(p[0]).toFixed(0) + ',' + Y(p[1]).toFixed(1); }).join(' '); };
    var sideV = function (s, label, lc, dropC) {
      if (!s) return { label: label, lc: lc, dropC: dropC, openAt: '—', openPx: '—', mvAt: '—', mvFromTo: '—', mvPct: '', closePx: '—', drop: '—', pts: '' };
      return { label: label, lc: lc, dropC: dropC, openAt: archStamp(s.oAt), openPx: f2(s.o), mvAt: s.mv ? archStamp(s.mv.at) : '—', mvFromTo: s.mv ? f2(s.mv.from) + ' → ' + f2(s.mv.to) : '—',
        mvPct: s.mv ? '−' + s.mv.pct.toFixed(1) + '%' : '', closePx: s.c != null ? f2(s.c) : '—', drop: (s.drop < 0 ? '+' + Math.abs(s.drop).toFixed(1) : s.drop.toFixed(1)) + '%', pts: (s.pts < 0 ? '−' : '+') + Math.abs(s.pts).toFixed(1) + ' pts' };
    };
    var mv = sh && sh.mv, pl = mv ? (R.won ? mv.to - 1 : -1) : null;
    var tip = {};
    if (mv) {
      var aft = Math.max(0, Math.round((Date.parse(mv.at) - Date.parse(sh.oAt)) / 60000)), last = sh.c != null ? sh.c : sh.line.length ? sh.line[sh.line.length - 1][1] : sh.o;
      var share = sh.o > last ? Math.min(100, Math.round((mv.from - mv.to) / (sh.o - last) * 100)) : 100, i1 = 100 / mv.from, i2 = 100 / mv.to;
      tip = { fromTo: f2(mv.from) + ' → ' + f2(mv.to), pct: '−' + mv.pct.toFixed(1) + '%', when: archStamp(mv.at), after: Math.floor(aft / 60) + 'h ' + (aft % 60) + 'm',
        impl: i1.toFixed(1) + '% → ' + i2.toFixed(1) + '% (+' + (i2 - i1).toFixed(1) + ' pts)', share: share + '%',
        soft: R.lagMin != null && so && so.mv ? 'followed ' + R.lagMin + 'm later, −' + so.mv.pct.toFixed(1) + '%' : so && so.mv ? 'moved first' : 'no soft move',
        note: share >= 60 ? 'Most of the total drop came in this single move.' : share >= 35 ? 'A good part of the total drop came in this move; the rest came gradually.' : 'A small part of the total drop; the price fell steadily around it.' };
    }
    var mx = mv ? X(mv.at) / 10 : 0, my = mv ? Y(mv.to) / 2 : 0;
    return { ini: RAW(esc(inits(name))), name: name + ' to win', meta: ['vs ' + HELP.shortName(R.opp), R.event ? HELP.eventName(R.event) : '', archDay(Date.parse(R.scheduledAt || R.startAt))].filter(Boolean).join(' · '),
      hasBadge: !!(sh && sh.pts >= 2), bLbl: strong ? 'Strong sharp move' : 'Sharp move', bW: strong ? 700 : 600, bC: strong ? T.white : T.text2, bBg: strong ? T.chipStrong : T.lift, bBd: strong ? T.e22 : T.e14,
      res: R.won ? 'Won' : 'Lost', resC: R.won ? T.text : T.grey, resSq: R.won ? T.green : T.red, score: R.score || '—', sharpName: ARCH_SHARP,
      sharp: sideV(sh, 'Sharp · ' + ARCH_SHARP, T.blue, T.red), soft: sideV(so, so && so.book !== 'avg' ? 'Soft · ' + so.book : 'Soft · average', T.text2, T.text),
      lead: R.lagMin != null ? 'soft books followed ' + R.lagMin + 'm later' : 'the soft books did not follow it',
      pl: pl == null ? '—' : (pl < 0 ? '−' : '+') + Math.abs(pl).toFixed(2) + 'u', plC: pl == null ? T.grey : pl >= 0 ? T.green : T.red, backPx: mv ? f2(mv.to) : '—',
      plNote: '1u at the sharp price right after the biggest move · ' + (R.won ? 'won' : 'lost'), tip: tip,
      tipTf: my < 50 ? 'translate(-50%, 18px)' : 'translate(-50%, calc(-100% - 18px))',
      yMax: f2(hi), yMid: f2((hi + lo) / 2), yMin: f2(lo), sharpLine: path(sh && sh.line), softLine: path(so && so.line),
      mvX: mx.toFixed(1) + '%', mvY: my.toFixed(1) + '%', mvShift: mx > 60 ? 'calc(-100% - 8px)' : '8px' };
  }

  // ─── the runtime for the generated design views (dcDesk, dcDrawer) ──────────────────────────────────────────────
  // Handlers in the views are functions; each render registers them and writes their index into data-dc-<event>.
  // One delegated listener per event type walks from the target up and calls every handler on the way (a handler may
  // stop the walk, as the design's stopPropagation does). A re-render keeps the search field's focus and caret and
  // every scrolling box's position.
  function RAW(html) { return { __raw: html }; }
  function E(x) { return x == null ? '' : x.__raw != null ? x.__raw : esc(x); }
  function registry() { var fns = []; var H = function (f) { if (typeof f !== 'function') return ''; fns.push(f); return String(fns.length - 1); }; H.fns = fns; return H; }
  var REG = { page: null, box: null };
  function hoverCss() {
    if (document.getElementById('do3HoverCss')) return;
    var el = document.createElement('style'); el.id = 'do3HoverCss'; el.textContent = DC_HOVER_CSS + '\n' + DC_ARCHIVE_HOVER_CSS; (document.head || document.body).appendChild(el);
  }
  function paint(el, html, which) {
    var ae = document.activeElement, fi = -1, caret = null;
    if (ae && el.contains(ae) && ae.hasAttribute('data-dc-change')) { fi = Array.prototype.indexOf.call(el.querySelectorAll('[data-dc-change]'), ae); caret = ae.selectionStart; }
    var sc = Array.prototype.map.call(el.querySelectorAll('[data-dc-scroll]'), function (n) { return n.scrollTop; });
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('[data-dc-scroll]'), function (n, i) { if (sc[i]) n.scrollTop = sc[i]; });
    if (fi >= 0) { var q = el.querySelectorAll('[data-dc-change]')[fi]; if (q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} } }
    return which;
  }
  function fire(type, e, container, which) {
    var reg = REG[which]; if (!reg) return false;
    var stopped = false, hit = false;
    for (var n = e.target; n && n !== container.parentNode; n = n.parentNode) {
      if (!n.getAttribute) continue;
      var id = n.getAttribute('data-dc-' + type);
      if (id == null || id === '') continue;
      var f = reg.fns[+id]; if (!f) continue;
      hit = true;
      f({ target: e.target, currentTarget: n, clientX: e.clientX, clientY: e.clientY,
        preventDefault: function () { e.preventDefault(); }, stopPropagation: function () { stopped = true; } });
      if (stopped) break;
    }
    return hit;
  }
  function wire(container, which) {
    container.addEventListener('click', function (e) {
      var hit = fire('click', e, container, which);
      // a click outside an open menu closes it (the design's full-page click-catcher)
      if (!hit && which === 'page' && REG.page && (st.menu || st.tip) && !(e.target.closest && e.target.closest('[data-dc-menu]'))) { st.menu = null; st.tip = false; render(); }
    });
    container.addEventListener('input', function (e) { fire('change', e, container, which); });
    container.addEventListener('mousemove', function (e) { fire('move', e, container, which); });
    container.addEventListener('mouseover', function (e) {
      for (var n = e.target; n && n !== container.parentNode; n = n.parentNode) {
        if (n.getAttribute && n.getAttribute('data-dc-enter') != null && !(e.relatedTarget && n.contains(e.relatedTarget))) fire('enter', { target: n, preventDefault: function () {} }, container, which);
      }
    });
    container.addEventListener('mouseout', function (e) {
      for (var n = e.target; n && n !== container.parentNode; n = n.parentNode) {
        if (n.getAttribute && n.getAttribute('data-dc-leave') != null && !(e.relatedTarget && n.contains(e.relatedTarget))) fire('leave', { target: n, preventDefault: function () {} }, container, which);
      }
    });
  }
  // state changes: { S: … } and the page / box keys; box-only changes repaint the box alone (the chart hover, legend…)
  var pendingBox = false;
  function set(o, boxOnly) {
    Object.keys(o).forEach(function (k) { st[k] = o[k]; });
    if (boxOnly) {
      if (o.drHov !== undefined) { if (!pendingBox) { pendingBox = true; requestAnimationFrame(function () { pendingBox = false; renderModal(); }); } return; }
      renderModal(); return;
    }
    render();
  }

  var PURE = { BOOKS: BOOKS, rd: rd, calc: calc, mvOf: mvOf, buildSelections: buildSelections, pinnacleOf: pinnacleOf,
    movedAtOf: movedAtOf, isUpcoming: isUpcoming, defaults: defaults, passes: passes, view: view, rankOf: rankOf,
    cell: cell, sharpCell: sharpCell, softCell: softCell, softCount: softCount, meterH: meterH,
    isMean: isMean, bigStep: bigStep, shapeSeries: shapeSeries, rowVals3: rowVals3, drawerVals: drawerVals, pageVals: pageVals,
    cell3: cell3, timing: timing, BOOK_NAMES3: BOOK_NAMES3, PRED_BOOKS: PRED_BOOKS, dcDesk: dcDesk, dcDrawer: dcDrawer, E: E, RAW: RAW, registry: registry,
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
  var SEARCH = '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="5.5" stroke="var(--do2-grey)" stroke-width="1.7"></circle><path d="M13.2 13.2 17 17" stroke="var(--do2-grey)" stroke-width="1.7" stroke-linecap="round"></path></svg>';
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

  // ─── page ───────────────────────────────────────────────────────────────────
  var TIP = '<span class="do2-tip" role="tooltip">' +
    '<span class="do2-tip-b"><span class="do2-tip-h">Drop %</span><span class="do2-tip-t">How far the price has fallen since we first recorded it. <span class="do2-tip-m">2.12 → 1.46</span> is a <span class="do2-tip-m">31.1%</span> drop.</span></span>' +
    '<span class="do2-tip-b"><span class="do2-tip-h">Pts implied</span><span class="do2-tip-t">A price implies a chance of winning: 1 divided by the price. <span class="do2-tip-m">2.12</span> is <span class="do2-tip-m">47.2%</span>, <span class="do2-tip-m">1.46</span> is <span class="do2-tip-m">68.5%</span>, so the market now gives this player <span class="do2-tip-m">+21.3</span> percentage points more chance. The bookmaker margin is still in the figure.</span></span>' +
    '<span class="do2-tip-b"><span class="do2-tip-h">Why both</span><span class="do2-tip-t">The same drop can mean very different things. <span class="do2-tip-m">5.30 → 3.65</span> is also a <span class="do2-tip-m">31.1%</span> drop, but only <span class="do2-tip-m">+8.5 pts</span>.</span></span>' +
    // the handoff's copy word for word (the "moves first" claim confirmed by the founder, 2026-11-23)
    '<span class="do2-tip-b"><span class="do2-tip-h">Sharp and soft</span><span class="do2-tip-t">Sharp is Pinnacle, which tends to move first. Soft is the average of the other bookmakers. The first recorded price is not necessarily the opening line.</span></span></span>';
  // ─── phone (under 820px): the export's isMob block (README "Mobile"; the top-bar Refresh / Alerts, the alerts sheet,
  // the demo chip beside the title, the placeholder footnote and the LIVE status line are not built) ───────────────────────────
  var MOBILE_MAX = 819;
  function isMobile() { try { return window.innerWidth <= MOBILE_MAX; } catch (e) { return false; } }
  function nActive(S) { return [S.tiers.length !== 3, S.books.length !== BOOK_NAMES3().length, S.win !== 'open', S.min > 0, S.mv !== 'all'].filter(Boolean).length; }
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
    enrich();
    var now = dataNow(), fs = feedState(ageS(), st.reachable);
    st.mobile = isMobile();
    if (st.mobile) {
      var ae = document.activeElement, focusQ = ae && ae.getAttribute && ae.getAttribute('data-act') === 'q', caret = focusQ ? ae.selectionStart : null;
      el.innerHTML = '<div class="do2-wrap do2-m">' + mobileHtml(view(st.sels, st.S, now), fs) + '</div>';
      REG.page = null;
      if (focusQ) { var q = el.querySelector('[data-act="q"]'); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) {} }
    } else {
      hoverCss();
      if (st.archive) {   // Biggest moves of the past days: the archive page in the same root (its box drawn with it)
        archLoad();
        var HA = registry(), va = archVals(now, set);
        paint(el, '<div class="do3-wrap">' + dcArchive(va, HA, E) + (va.hasM ? dcArchiveBox(va, HA, E) : '') + '</div>', 'page');
        REG.page = HA; st.lastA = va;
        renderModal();
        return;
      }
      var H = registry(), v = pageVals(st, now, fs, set, false);
      v.deskPad = '30px 40px 70px 24px'; v.hasArchive = true;
      st.lastV = v;
      paint(el, '<div class="do3-wrap">' + dcDesk(v, H, E) + '</div>', 'page');
      REG.page = H;
    }
    renderModal();
  }
  // the price history box: the design's drawer (a centred panel; a bottom sheet under 820 px)
  function renderModal() {
    var ov = document.getElementById('do3Overlay');
    var s = st.drawer && st.sels.filter(function (x) { return x.id === st.drawer; })[0];
    if (!s) { if (ov) ov.remove(); REG.box = null; return; }
    if (!ov) { ov = document.createElement('div'); ov.id = 'do3Overlay'; ov.className = 'do3-ov'; document.body.appendChild(ov); wire(ov, 'box'); }
    hoverCss();
    var H = registry(), mob = isMobile();
    var v = { drawerOpen: true, dr: drawerVals(s, st, dataNow(), set, mob), closeDrawer: function () { closeModal(); }, stop: function (e) { e.stopPropagation(); } };
    st.lastDr = v.dr;
    paint(ov, dcDrawer(v, H, E), 'box');
    REG.box = H;
  }
  function closeModal() { set({ drawer: null, drBook: null, drPick: false, drPredOpen: false, drHov: null, tip: false }); }

  // ─── the price move box (the box shell: one component) ─────────────────────
  (window.sfOverlayClosers = window.sfOverlayClosers || []).push(function () { if (st.drawer) closeModal(); });

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
      case 'clear': e.stopPropagation(); S.books = BOOK_NAMES3(); st.menu = null; break;
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
    var a = e.target.closest && e.target.closest('#dropsRoot [role="button"][data-act], #dropsRoot [role="menuitemcheckbox"], #dropsRoot [data-dc-click][tabindex], .do3-ov [data-dc-click][tabindex]');
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
    wire(el, 'page');   // the design views' handlers (desktop); the phone layout keeps its data-act buttons
    el.addEventListener('input', onInput);
    window.addEventListener('resize', function () { if (st.active && isMobile() !== st.mobile) render(); });   // the 820px switch
    document.addEventListener('keydown', onKey);   // Enter / Space on the page's buttons; Escape is esc-nav.js's alone
    // Esc (esc-nav.js, one layer per press, highest z first): the box's compare menu, then the box, then a page menu / the explainer
    (window.sfEscLayers = window.sfEscLayers || []).push(
      { id: 'drops-box-menu', z: 77, isOpen: function () { return !!(st.drawer && (st.drPick || st.drPredOpen)); }, close: function () { st.drPick = false; st.drPredOpen = false; renderModal(); } },
      { id: 'drops-drawer', z: 76, isOpen: function () { return !!st.drawer; }, close: closeModal },
      { id: 'drops-arch-menu', z: 73, isOpen: function () { return !!(st.archive && st.A && st.A.oddsMenu); }, close: function () { st.A.oddsMenu = false; render(); } },
      { id: 'drops-arch-box', z: 72, isOpen: function () { return !!(st.archive && st.A && st.A.open); }, close: function () { st.A.open = null; st.A.tip = null; render(); } },
      { id: 'drops-sheet', z: 74, isOpen: function () { return !st.drawer && !!st.sheet; }, close: function () { st.sheet = false; render(); } },
      { id: 'drops-menu', z: 60, isOpen: function () { return !st.drawer && !!(st.menu || st.tip); }, close: function () { st.menu = null; st.tip = false; render(); } });
    var page = el.closest('.tabpage');
    if (page && page.classList.contains('active')) setActive(true);
  }
  window.DropsPage = { setActive: setActive, _state: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
