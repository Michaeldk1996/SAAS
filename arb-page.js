/* Dropping Odds → Arbitrage (founder 2026-11-01): every upcoming ATP match's prices against ONE fair price — Pinnacle's,
 * read as Bet105 with the margin removed — after fees, plus the two-sided arbitrages between sources.
 * Data: public.arb_now() (tools/arb-engine.sql), read with the page's publishable key, every 30 s while the view is open.
 * Nothing is computed here: every figure is the engine's. A plain first build in the page's own styles (the founder
 * designs it later). Colour: green only on signed figures (profit, % above fair); no amber, no blue fills. */
(function (root) {
  'use strict';
  var REFRESH_MS = 30000;
  var st = { data: null, at: 0, loading: null, failed: false };
  function sb() {
    var u = String(root.SUPABASE_URL || '').replace(/\/$/, ''), k = String(root.SUPABASE_ANON_KEY || '');
    return !u || u.indexOf('__') === 0 || !k || k.indexOf('__') === 0 ? null : { url: u, key: k };
  }
  function load(force) {
    if (st.loading) return st.loading;
    if (!force && st.data && Date.now() - st.at < REFRESH_MS) return Promise.resolve(st.data);
    var c = sb(), f = root.fetch;
    if (!c || !f) { st.failed = true; return Promise.resolve(null); }
    st.loading = f(c.url + '/rest/v1/rpc/arb_now', { method: 'POST',
      headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.at) { st.data = j; st.at = Date.now(); st.failed = false; } else st.failed = true; return st.data; })
      .catch(function () { st.failed = true; return st.data; })
      .then(function (d) { st.loading = null; return d; });
    return st.loading;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tz() { try { return (typeof newsTz === 'function' && newsTz()) || undefined; } catch (e) { return undefined; } }   // eslint-disable-line no-undef
  function clock(iso) {
    var t = Date.parse(iso || ''); if (!isFinite(t)) return '—';
    var o = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() };
    try { return new Date(t).toLocaleTimeString('en-GB', o); } catch (e) { delete o.timeZone; return new Date(t).toLocaleTimeString('en-GB', o); }
  }
  function when(iso) {
    var t = Date.parse(iso || ''); if (!isFinite(t)) return '—';
    var o = { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() };
    try { return new Date(t).toLocaleString('en-GB', o); } catch (e) { delete o.timeZone; return new Date(t).toLocaleString('en-GB', o); }
  }
  function px(v) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(2); }
  function usd(v) { return v == null || !isFinite(v) ? '—' : '$' + Math.round(v).toLocaleString('en-US'); }
  function pct(v) { return v == null || !isFinite(v) ? '—' : '+' + Number(v).toFixed(1) + '%'; }
  function feeNote(src, price, eff) { return (src === 'Kalshi' || src === 'Polymarket') && eff != null ? '<span class="ar-fee">after fee ' + px(eff) + '</span>' : ''; }

  function headerHtml(d) {
    var stat = function (k, v, cls) { return '<div class="sfh__stat"><span class="sfh__l">' + k + '</span><span class="sfh__v' + (cls || '') + (v === '—' ? ' sfh__v--none' : '') + '">' + v + '</span></div>'; };
    return '<div class="sfh do-head"><div class="sfh__text"><h1 class="sfh__title">Arbitrage</h1>' +
      '<p class="sfh__sub"><span class="do-subtitle">Upcoming ATP prices against the fair price (Bet105, margin removed), after fees.</span></p></div>' +
      '<div class="sfh__stats">' + stat('Arbs', d ? String(d.arbs.length + (d.liveOn && d.live ? d.live.length : 0)) : '—') + stat('Divergences', d ? String(d.divergences.length) : '—') +
      stat('Matches', d ? String(d.fair.length) : '—') + stat('Updated', d ? clock(d.at) : '—', ' sfh__v--soft') + '</div></div>';
  }
  function legHtml(l, player) {
    return '<div class="ar-leg"><span class="ar-leg-who">Back ' + esc(player) + '</span><span class="ar-leg-src">' + esc(l.source) + '</span>' +
      '<span class="ar-px">' + px(l.price) + feeNote(l.source, l.price, l.eff) + '</span>' +
      '<span class="ar-liq">' + (l.group === 'prediction' ? usd(l.liq) + ' at price' : 'bookmaker') + '</span></div>';
  }
  function arbsHtml(d) {
    if (!d.arbs.length) return '<div class="ar-empty">No arbitrage above ' + pct(d.config.arbMin) + ' after fees right now.</div>';
    return d.arbs.map(function (a) {
      return '<div class="ar-card"><div class="ar-card-h"><span class="ar-match">' + esc(a.first) + ' v ' + esc(a.second) + '</span>' +
        '<span class="ar-when">' + when(a.start) + '</span><span class="ar-profit">' + pct(a.profit) + '</span></div>' +
        legHtml(a.legFirst, a.first) + legHtml(a.legSecond, a.second) +
        '<div class="ar-foot">Stakes ' + a.stakeFirst.toFixed(1) + '% / ' + a.stakeSecond.toFixed(1) + '% · prices ' + clock(a.legFirst.at) + ' / ' + clock(a.legSecond.at) + '</div>' +
        (a.retirementFlag ? '<div class="ar-flag">Retirement rules differ: Kalshi / Polymarket pay the player who advances once a ball is played; a bookmaker may void the bet on a retirement.</div>' : '') +
        '</div>';
    }).join('');
  }
  // Live (founder 2026-11-02; bookmakers 2026-11-08): Kalshi, Polymarket, Bet105 and Napoleon during play, from the live worker
  // (live-arb.yml). Shown only while the worker is fresh (liveOn); otherwise the section is absent — never a feed-status message.
  // Each row lists its legs; a row from a worker built before 8 Nov carries the Polymarket / Kalshi fields instead.
  function liveLegs(g) {
    if (g.legs && g.legs.length) return g.legs;
    return [{ venue: 'Polymarket', name: g.polyName, group: 'prediction', dec: g.polyDec, eff: g.polyEff, liq: g.polyLiq, share: g.stakePoly, at: g.polyAt },
      { venue: 'Kalshi', name: g.kalName, group: 'prediction', dec: g.kalDec, eff: g.kalEff, liq: g.kalLiq, share: g.stakeKalshi, at: g.kalAt }];
  }
  function liveHtml(d) {
    if (!d.liveOn) return '';
    var rows = d.live || [];
    var body = !rows.length ? '<div class="ar-empty">No live arbitrage above ' + pct(d.config.liveMin) + ' after fees right now.</div>' :
      rows.map(function (g) {
        var legs = liveLegs(g);
        var leg = function (l) {
          return '<div class="ar-leg"><span class="ar-leg-who">Back ' + esc(l.name) + '</span><span class="ar-leg-src">' + esc(l.venue) + '</span>' +
            '<span class="ar-px">' + px(l.dec) + (l.group === 'prediction' ? '<span class="ar-fee">after fee ' + px(l.eff) + '</span>' : '') + '</span>' +
            '<span class="ar-liq">' + (l.group === 'prediction' ? usd(l.liq) + ' at price' : 'bookmaker') + '</span></div>';
        };
        var book = legs.some(function (l) { return l.group === 'book'; }), pm = legs.some(function (l) { return l.group === 'prediction'; });
        return '<div class="ar-card"><div class="ar-card-h"><span class="ar-match">' + esc(g.match) + '</span>' +
          '<span class="ar-when">' + (g.inPlay ? 'In play' : 'Past its start') + '</span><span class="ar-profit">' + pct(g.edge) + '</span></div>' +
          legs.map(leg).join('') +
          '<div class="ar-foot">Stakes ' + legs.map(function (l) { return Number(l.share).toFixed(1) + '%'; }).join(' / ') +
          (g.stake != null ? ' · up to ' + usd(g.stake) : '') + ' · prices ' + legs.map(function (l) { return clock(l.at); }).join(' / ') + '</div>' +
          (book && pm ? '<div class="ar-flag">Retirement rules differ: Kalshi / Polymarket pay the player who advances once a ball is played; a bookmaker may void the bet on a retirement.</div>' :
           book ? '<div class="ar-flag">Check each bookmaker\'s retirement rule: one may void the bet on a retirement while the other settles it.</div>' : '') +
          '</div>';
      }).join('');
    return '<h2 class="ar-h">Live · Kalshi · Polymarket · Bet105 · Napoleon</h2>' + body +
      '<p class="ar-note">Live prices move every point: check both before you bet. Updated every 5 seconds.</p>';
  }
  function divsHtml(d) {
    if (!d.divergences.length) return '<div class="ar-empty">No price ' + pct(d.config.divMin) + ' or more above the fair price right now.</div>';
    return '<div class="ar-tbl"><div class="ar-th"><span>Match</span><span>Player</span><span>Source</span><span class="r">Price</span><span class="r">Fair</span><span class="r">Above fair</span><span class="r">Liquidity</span></div>' +
      d.divergences.map(function (x) {
        return '<div class="ar-tr"><span class="ar-m">' + esc(x.first) + ' v ' + esc(x.second) + '<span class="ar-when">' + when(x.start) + '</span></span>' +
          '<span>' + esc(x.player) + '</span><span>' + esc(x.source) + '</span>' +
          '<span class="r ar-px">' + px(x.price) + feeNote(x.source, x.price, x.eff) + '</span><span class="r ar-px">' + px(x.fair) + '</span>' +
          '<span class="r ar-edge">' + pct(x.edge) + '</span><span class="r">' + (x.group === 'prediction' ? usd(x.liq) : '—') + '</span></div>';
      }).join('') + '</div>';
  }
  function fairHtml(d) {
    if (!d.fair.length) return '<div class="ar-empty">No upcoming ATP match has a live Bet105 price right now.</div>';
    return '<div class="ar-tbl ar-fair"><div class="ar-th"><span>Match</span><span class="r">Fair</span><span>Prices (after fees)</span></div>' +
      d.fair.map(function (f) {
        var srcs = (f.sources || []).filter(function (s) { return s.source !== 'Bet105'; }).map(function (s) {
          return '<span class="ar-src"><b>' + esc(s.source) + '</b> ' + px(s.effFirst) + ' / ' + px(s.effSecond) + '</span>';
        }).join('') || '<span class="ar-none">no other source</span>';
        return '<div class="ar-tr"><span class="ar-m">' + esc(f.first) + ' v ' + esc(f.second) + '<span class="ar-when">' + when(f.start) + '</span></span>' +
          '<span class="r ar-px">' + px(f.fairFirst) + ' / ' + px(f.fairSecond) + '</span><span class="ar-srcs">' + srcs + '</span></div>';
      }).join('') + '</div>';
  }
  function bodyHtml() {
    var d = st.data;
    if (!d) return '<div class="ar-empty">' + (st.failed ? 'Arbitrage data unavailable.' : 'Loading prices…') + '</div>';
    return liveHtml(d) + '<h2 class="ar-h">Arbitrage</h2>' + arbsHtml(d) + '<h2 class="ar-h">Divergence from the fair price</h2>' + divsHtml(d) +
      '<h2 class="ar-h">Fair price per match</h2>' + fairHtml(d) +
      '<p class="ar-note">Fair = Bet105 with its margin removed. Kalshi and Polymarket prices carry their taker fees. A prediction-market leg needs ' +
      usd(d.config.minLiq) + ' at the price. Bookmaker limits are not known here.</p>';
  }
  root.ArbPage = { load: load, headerHtml: function () { return headerHtml(st.data); }, bodyHtml: bodyHtml,
    stale: function () { return !st.loading && Date.now() - st.at >= REFRESH_MS; }, _st: st };
})(typeof window !== 'undefined' ? window : globalThis);
