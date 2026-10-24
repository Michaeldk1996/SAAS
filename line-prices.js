/* bet105 line prices — the ONE lookup every view uses (founder brief 2026-10-24, bet105-line-prices Part 2).
 *
 *   linePrice(eventKey, playerKey, market, signedLine, opts) -> { state, ... }
 *
 * market: 'gh' games handicap | 'sh' set handicap | 'tg' total games | 'ts' total sets (2.5 = deciding set) |
 *         'ml1' set 1 winner | 'ml' match winner. playerKey: the api-tennis player key the row describes, or 'over' /
 *         'under' for a total. signedLine: THAT side's own line (−3.5 for "−3.5 games"); null for ml / ml1.
 *
 * Data: line-prices/<date>.json, written every 15 minutes by build-line-prices.py from Kibl (bet105) — the only
 * line-price source. Lazy: a shard is fetched the first time a view asks for that date, never at startup.
 *
 * Rules (each is a dash with its reason, never a different line's price and never a 0):
 *   - the exact line not offered        -> 'not offered'   (the offered ladder goes on the hover)
 *   - a guard failed at ingestion        -> its reason      (suspended, one-sided, incoherent pair, ladder, guard d)
 *   - the match started                  -> 'started'       (pre-match only)
 *   - the shard's last refresh > 30 min  -> 'stale'         (STALE_MIN, a starting point the founder can change)
 *   - the event not in the shard         -> 'no bet105 match' (Kibl fixture not joined, or not priced)
 * Implied % is de-vigged from both sides of the same line, same book (computed at ingestion).
 */
(function (root) {
  'use strict';
  var STALE_MIN = 30;
  var BOOK = 'bet105';
  var REASON = {
    not_offered: 'not offered', suspended: 'suspended', one_sided: 'one side only', not_a_pair: 'sides do not pair',
    incoherent: 'sides do not add up', ladder: 'out of line with its ladder', guard_d: 'shorter than his match price',
    guard_d_no_match_winner: 'no match price to check against', started: 'started', stale: 'stale',
    no_event: 'no bet105 match', no_match: 'no upcoming match', no_market: 'no bet105 market', unavailable: 'unavailable'
  };
  var cache = {}, inflight = {};
  function now() { return Date.now(); }

  // A shard is keyed by the event's UTC date; the page's match date can sit a day either side of it for a late match, so
  // a view asks for its date and the two around it, and the lookup finds the event key (unique) in any of them.
  function around(date) {
    var t = Date.parse(date + 'T12:00:00Z'); if (!isFinite(t)) return [];
    return [-1, 0, 1].map(function (d) { return new Date(t + d * 86400000).toISOString().slice(0, 10); });
  }
  function load(date) {
    if (!date) return Promise.resolve(null);
    return Promise.all(around(date).map(load1)).then(function () { return cache[date]; });
  }
  function load1(date) {
    if (Object.prototype.hasOwnProperty.call(cache, date)) return Promise.resolve(cache[date]);
    if (inflight[date]) return inflight[date];
    var f = (root.fetch || (typeof fetch === 'function' ? fetch : null));
    if (!f) { cache[date] = null; return Promise.resolve(null); }
    inflight[date] = f('line-prices/' + date + '.json', { cache: 'no-cache' }).then(function (r) {
      return r && r.ok ? r.json() : null;
    }).catch(function () { return null; }).then(function (j) {
      cache[date] = j && j.events ? j : null;
      delete inflight[date];
      return cache[date];
    });
    return inflight[date];
  }

  function rowsOf(shard, ek) {
    var ev = shard && shard.events ? shard.events[String(ek)] : null;
    if (!ev) return null;
    var F = shard.fields || ['market', 'side', 'line', 'price', 'implied', 'status', 'open', 'openTs', 'maxLimit', 'insertedOn'];
    return ev.lines.map(function (a) { var o = {}; F.forEach(function (k, i) { o[k] = a[i]; }); return o; });
  }
  var same = function (a, b) { return a == null || b == null ? a == null && b == null : Math.abs(+a - +b) < 1e-9; };

  /** opts: { date (the event's UTC date, required), started (bool: the match is live / finished on the page) } */
  function linePrice(eventKey, playerKey, market, signedLine, opts) {
    opts = opts || {};
    var base = { book: BOOK, market: market, side: playerKey, line: signedLine, ladder: [] };
    function dash(r, extra) { var o = Object.assign({}, base, extra || {}); o.state = 'dash'; o.reason = r; o.reasonText = REASON[r] || r; return o; }
    if (!market) return dash('no_market');
    if (eventKey == null || !opts.date) return dash('no_match');
    var days = around(opts.date);
    if (days.some(function (d) { return !Object.prototype.hasOwnProperty.call(cache, d); })) return Object.assign({}, base, { state: 'loading' });
    var shards = days.map(function (d) { return cache[d]; }).filter(Boolean);
    if (!shards.length) return dash('unavailable');
    var shard = null, rows = null;
    shards.forEach(function (sh) { var r = rowsOf(sh, eventKey); if (r && !rows) { rows = r; shard = sh; } });
    if (!rows) return dash('no_event');
    var ladder = rows.filter(function (r) { return r.market === market && String(r.side) === String(playerKey); })
      .sort(function (a, b) { return (a.line == null ? 0 : a.line) - (b.line == null ? 0 : b.line); });
    var seenAt = shard.seenAt, ageMin = seenAt ? (now() - Date.parse(seenAt)) / 60000 : Infinity;
    var extra = { ladder: ladder, seenAt: seenAt };
    if (opts.started) return dash('started', extra);
    if (!(ageMin <= STALE_MIN)) return dash('stale', extra);
    var hit = ladder.filter(function (r) { return same(r.line, signedLine); })[0];
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
  function faceText(r) { return r && r.state === 'ok' ? fmtOdd(r.price) + ' · ' + Math.round(r.implied * 100) + '%' : '—'; }
  /** The hover, as plain lines (each surface wraps them in its own tooltip pattern). */
  function hoverLines(r, label) {
    if (!r || r.state === 'loading') return [];
    var L = ['bet105 · ' + (label || (r.market + ' ' + fmtLine(r.line)))];
    if (r.state === 'ok') {
      L.push('Price ' + fmtOdd(r.price) + ' · ' + Math.round(r.implied * 100) + '% (margin removed)');
      L.push('Opened ' + (r.open != null ? fmtOdd(r.open) + (r.openTs ? ' at ' + hm(r.openTs) : '') : '—'));
      L.push('Last seen ' + hm(r.seenAt) + ' · Kibl insert ' + hm(r.insertedOn));
      L.push('Max stake ' + (r.maxLimit != null ? Math.round(r.maxLimit).toLocaleString('en-US') : '—'));
    } else {
      L.push('— ' + r.reasonText);
      if (r.seenAt) L.push('Last refresh ' + hm(r.seenAt));
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

  var api = { load: load, linePrice: linePrice, faceText: faceText, hoverLines: hoverLines, fmtOdd: fmtOdd, fmtLine: fmtLine,
    meetingOf: meetingOf, STALE_MIN: STALE_MIN, REASON: REASON, _cache: cache };
  root.LinePrices = api;
  root.linePrice = linePrice;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
