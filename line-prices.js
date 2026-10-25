/* bet105 line prices — the ONE lookup every view uses (founder brief 2026-10-24, bet105-line-prices Part 2).
 *
 *   linePrice(eventKey, playerKey, market, signedLine, opts) -> { state, ... }
 *
 * market: 'gh' games handicap | 'sh' set handicap | 'tg' total games | 'ts' total sets (2.5 = deciding set) |
 *         'ml1' set 1 winner | 'ml' match winner. playerKey: the api-tennis player key the row describes, or 'over' /
 *         'under' for a total. signedLine: THAT side's own line (−3.5 for "−3.5 games"); null for ml / ml1.
 *
 * Data (founder ruling 2026-10-25: the Kibl Now path, through Supabase): line_prices_current, written by the live Kibl
 * stream worker (kibl-stream/line_engine.py on Fly) after the guards. Read here with the page's publishable key —
 * SELECT only, the existing RLS pattern; nothing in the browser can write, and the price ticks are not readable. Lazy:
 * one event's rows are fetched the first time a view asks for it, and again once REFETCH_MS old (a view repaints on
 * arrival). Freshness is the worker's own heartbeat (kibl_now_price, kind=heartbeat): the stream is confirmed live as
 * of its last beat, so a price's on-screen age = minutes since that beat.
 *
 * Rules (each is a dash with its reason, never a different line's price and never a 0):
 *   - the exact line not offered            -> 'not offered'  (the offered ladder goes on the hover)
 *   - a guard failed at ingestion            -> its reason     (suspended, one-sided, incoherent pair, ladder, guard d)
 *   - the match started                      -> 'started'      (pre-match only)
 *   - the worker's beat older than STALE_MIN,
 *     or its line writes off / failing       -> 'stale'        (the last price moves to the hover, never the face)
 *   - no row for the event                   -> 'no bet105 match' (Kibl fixture not joined, or not priced)
 * Implied % is de-vigged from both sides of the same line, same book (computed at ingestion).
 */
(function (root) {
  'use strict';
  // Founder ruling 2026-10-25: show the price's age on screen; the stale WARNING starts at 60 min. One-line switch.
  // On the stream path the age is minutes since the worker's last heartbeat (it beats every 60 s while live).
  var STALE_MIN = 60;
  var REFETCH_MS = 60000;
  var BOOK = 'bet105';
  var COLS = 'market,side,line,price,implied,status,open_price,open_ts,max_limit,inserted_on';
  var REASON = {
    not_offered: 'not offered', suspended: 'suspended', one_sided: 'one side only', not_a_pair: 'sides do not pair',
    incoherent: 'sides do not add up', ladder: 'out of line with its ladder', guard_d: 'shorter than his match price',
    guard_d_no_match_winner: 'no match price to check against', started: 'started', stale: 'stale',
    no_event: 'no bet105 match', no_match: 'no upcoming match', no_market: 'no bet105 market', unavailable: 'unavailable'
  };
  var cache = {}, inflight = {}, hb = { at: 0, row: null, p: null };
  function now() { return Date.now(); }
  function sb() {
    var u = String(root.SUPABASE_URL || '').replace(/\/$/, ''), k = String(root.SUPABASE_ANON_KEY || '');
    return !u || u.indexOf('__') === 0 || !k || k.indexOf('__') === 0 ? null : { url: u, key: k };
  }
  function get(path) {
    var c = sb(), f = root.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!c || !f) return Promise.resolve(null);
    return f(c.url + '/rest/v1/' + path, { headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, Accept: 'application/json' } })
      .then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function beat() {
    if (hb.p) return hb.p;
    if (hb.row && now() - hb.at < REFETCH_MS / 2) return Promise.resolve(hb.row);
    hb.p = get('kibl_now_price?select=written_at,note&kind=eq.heartbeat').then(function (j) {
      hb.p = null; hb.at = now(); hb.row = j && j[0] ? j[0] : null; return hb.row;
    });
    return hb.p;
  }
  /** Fetch one event's rows (and the worker's heartbeat). `date` is kept for the callers' signature; the event key is
   *  unique. Resolves once the cache holds the event (or holds its failure, which reads as 'unavailable'). */
  function load(date, eventKey) {
    if (eventKey == null) return Promise.resolve(null);
    var ek = String(eventKey);
    if (inflight[ek]) return inflight[ek];
    inflight[ek] = Promise.all([
      get('line_prices_current?select=' + COLS + '&book=eq.' + BOOK + '&event_key=eq.' + encodeURIComponent(ek)),
      beat()
    ]).then(function (got) {
      cache[ek] = { at: now(), rows: Array.isArray(got[0]) ? got[0].map(function (r) {
        return { market: r.market, side: r.side, line: r.line == null ? null : +r.line, price: r.price == null ? null : +r.price,
          implied: r.implied == null ? null : +r.implied, status: r.status, open: r.open_price == null ? null : +r.open_price,
          openTs: r.open_ts, maxLimit: r.max_limit == null ? null : +r.max_limit, insertedOn: r.inserted_on };
      }) : null, hb: got[1] };
      delete inflight[ek];
      return cache[ek];
    });
    return inflight[ek];
  }

  /** How long ago the worker last confirmed the line prices live, in whole minutes, or null when it says it is not
   *  writing them (dry run, off, failing, or the broker disconnected). */
  function freshness(h) {
    var n = h && h.note, L = n && n.lines;
    if (!n || !L || L.off || L.write !== true || L.write_ok === false || n.connected !== true) return { ageMin: null, seenAt: h ? h.written_at : null };
    var t = Date.parse(h.written_at);
    return { ageMin: isFinite(t) ? Math.max(0, Math.floor((now() - t) / 60000)) : null, seenAt: h.written_at };
  }
  var same = function (a, b) { return a == null || b == null ? a == null && b == null : Math.abs(+a - +b) < 1e-9; };

  /** opts: { date (the event's UTC date), started (bool: the match is live / finished on the page) } */
  function linePrice(eventKey, playerKey, market, signedLine, opts) {
    opts = opts || {};
    var base = { book: BOOK, market: market, side: playerKey, line: signedLine, ladder: [] };
    function dash(r, extra) { var o = Object.assign({}, base, extra || {}); o.state = 'dash'; o.reason = r; o.reasonText = REASON[r] || r; return o; }
    if (!market) return dash('no_market');
    if (eventKey == null) return dash('no_match');
    var ev = cache[String(eventKey)];
    if (!ev || now() - ev.at > REFETCH_MS) return Object.assign({}, base, { state: 'loading' });
    if (!ev.rows) return dash('unavailable');
    var rows = ev.rows.filter(function (r) { return r.status !== 'withdrawn'; });
    if (!rows.length) return dash('no_event');
    var ladder = rows.filter(function (r) { return r.market === market && String(r.side) === String(playerKey); })
      .sort(function (a, b) { return (a.line == null ? 0 : a.line) - (b.line == null ? 0 : b.line); });
    var fr = freshness(ev.hb);
    var extra = { ladder: ladder, seenAt: fr.seenAt, ageMin: fr.ageMin };
    if (opts.started) return dash('started', extra);
    var hit = ladder.filter(function (r) { return same(r.line, signedLine); })[0];
    if (!(fr.ageMin != null && fr.ageMin <= STALE_MIN)) return dash('stale', Object.assign(extra, hit && hit.status === 'ok' ? { lastPrice: hit.price, lastImplied: hit.implied } : {}));
    if (!hit) return dash('not_offered', extra);
    if (hit.status !== 'ok' || hit.price == null || !(hit.price >= 1.01) || hit.implied == null) return dash(hit.status === 'ok' ? 'suspended' : hit.status, extra);
    return Object.assign({}, base, extra, { state: 'ok', price: hit.price, implied: hit.implied, open: hit.open, openTs: hit.openTs,
      maxLimit: hit.maxLimit, insertedOn: hit.insertedOn });
  }

  function fmtOdd(p) {
    if (p == null || !isFinite(p)) return '—';
    // odds.md: 3 decimals below 1.10 only where the third is non-zero, else 2
    var s3 = (+p).toFixed(3);
    return p < 1.10 && s3.charAt(s3.length - 1) !== '0' ? s3 : (+p).toFixed(2);
  }
  function fmtLine(l) { return l == null ? '' : (l > 0 ? '+' : l < 0 ? '−' : '') + Math.abs(l); }
  function hm(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return '—';
    var d = new Date(t); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + 'Z';
  }
  /** The face text: "2.05 · 49%" when priced, "—" otherwise. */
  /** The face: "2.06 · 46% · 34m" when priced (the price's age, founder 2026-10-25), "— stale 74m" past STALE_MIN,
   *  "—" otherwise. */
  function faceText(r) {
    if (r && r.state === 'ok') return fmtOdd(r.price) + ' · ' + Math.round(r.implied * 100) + '%' + (r.ageMin != null ? ' · ' + r.ageMin + 'm' : '');
    if (r && r.reason === 'stale' && r.ageMin != null) return '— stale ' + r.ageMin + 'm';
    return '—';
  }
  /** The face in two lines, so a narrow cell never overflows: { main: '2.06 · 46%' | '— stale' | '—', age: '34m ago' | null }. */
  function faceParts(r) {
    var age = r && r.ageMin != null && (r.state === 'ok' || r.reason === 'stale') ? r.ageMin + 'm ago' : null;
    if (r && r.state === 'ok') return { main: fmtOdd(r.price) + ' · ' + Math.round(r.implied * 100) + '%', age: age };
    if (r && r.reason === 'stale') return { main: '— stale', age: age };
    return { main: '—', age: null };
  }
  function ageText(r) { return r && r.ageMin != null ? 'Updated ' + r.ageMin + ' min ago (bet105 stream live at ' + hm(r.seenAt) + ')' : null; }
  /** The hover, as plain lines (each surface wraps them in its own tooltip pattern). */
  function hoverLines(r, label) {
    if (!r || r.state === 'loading') return [];
    var L = ['bet105 · ' + (label || (r.market + ' ' + fmtLine(r.line)))];
    if (r.state === 'ok') {
      L.push('Price ' + fmtOdd(r.price) + ' · ' + Math.round(r.implied * 100) + '% (margin removed)');
      L.push('Opened ' + (r.open != null ? fmtOdd(r.open) + (r.openTs ? ' at ' + hm(r.openTs) : '') : '—'));
      L.push(ageText(r) + ' · Kibl insert ' + hm(r.insertedOn));
      L.push('Max stake ' + (r.maxLimit != null ? Math.round(r.maxLimit).toLocaleString('en-US') : '—'));
    } else {
      L.push('— ' + r.reasonText + (r.reason === 'stale' && r.ageMin != null ? ' (over ' + STALE_MIN + ' min: not shown as current)' : ''));
      if (r.reason === 'stale' && r.lastPrice != null) L.push('Last price ' + fmtOdd(r.lastPrice) + ' · ' + Math.round(r.lastImplied * 100) + '%');
      if (r.reason === 'stale') L.push(r.ageMin != null ? ageText(r) : 'bet105 stream not confirmed live' + (r.seenAt ? ' (last heartbeat ' + hm(r.seenAt) + ')' : ''));
      else if (r.ageMin != null) L.push(ageText(r));
    }
    var offered = (r.ladder || []).filter(function (x) { return x.status === 'ok' && x.price != null; });
    if (offered.length && r.market !== 'ml' && r.market !== 'ml1')
      L.push('Offered: ' + offered.map(function (x) { return fmtLine(x.line) + ' ' + fmtOdd(x.price); }).join(' · '));
    else if (r.market !== 'ml' && r.market !== 'ml1' && r.state !== 'ok') L.push('Offered: none');
    return L;
  }
  /** The next scheduled, unstarted match between two players in the page's match list (H2H page), or null. */
  function meetingOf(list, aKey, bKey) {
    var best = null;
    (list || []).forEach(function (m) {
      if (!m || m.live || m.finalScore != null) return;
      var k = [String(m.p1Key), String(m.p2Key)];
      if (!(k.indexOf(String(aKey)) >= 0 && k.indexOf(String(bKey)) >= 0 && String(aKey) !== String(bKey))) return;
      if (!best || String(m.date) < String(best.date)) best = m;
    });
    return best;
  }

  var api = { load: load, linePrice: linePrice, faceText: faceText, faceParts: faceParts, hoverLines: hoverLines, fmtOdd: fmtOdd, fmtLine: fmtLine,
    meetingOf: meetingOf, STALE_MIN: STALE_MIN, REFETCH_MS: REFETCH_MS, REASON: REASON, _cache: cache };
  root.LinePrices = api;
  root.linePrice = linePrice;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
