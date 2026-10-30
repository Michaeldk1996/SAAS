/* picks-drawer.js — the Post-a-pick drawer (boards 1f new · 1f2 search + manual price · 1f3 outright · 1g posted,
 * editable · 1h frozen of `design_handoff_picks`, LOCKED 2026-10-27; SPEC §8). Admin only: it opens for isBspAdmin()
 * and firestore.rules refuse every other writer anyway.
 *
 * What the founder types: the selection, the market (and a line), the book when it is not bet105, the price only when
 * no feed quotes it (tagged MANUAL, stored price_source 'manual'), the stake (% of bankroll) and the note. Everything
 * else is read: the match from the board (identity, start, event, round), the bet105 price from the one line-price
 * lookup (line-prices.js), the model % from the board's model snapshot. Open / Now / Close / CLV / P/L are never typed —
 * tools/picks-updater.mjs fills them on the server.
 *
 * Entry points: window.PicksDrawer.openNew(boardMatch?) ("+ Pick" on a match card / the analysis modal header) and
 * PicksDrawer.openEdit(pick) (the card's "Edit · n min left"). Esc and a sidebar click close it.
 */
(function () {
  'use strict';
  var C = window.PicksCore;
  if (!C) return;
  var MID = '·', MINUS = '−', EDIT_MS = 600000;
  // CHANGES 10-29 §6: 11 chips + a typed market. Only Match winner / handicap / totals carry a live bet105 price; every
  // other market is a typed price, tagged MANUAL.
  var MARKETS = ['Match winner', 'Games handicap', 'Total games', 'Set betting', 'First set winner', 'Set handicap', 'Total sets',
    'Player total games', 'Tiebreak in match', 'Player to win a set', 'Outright'];
  var MKT_CODE = { 'Match winner': 'ml', 'Games handicap': 'gh', 'Total games': 'tg' };
  var BOOKS = ['bet105', 'Pinnacle', 'bet365', 'Other'];
  var D = null;   // the open drawer's state, or null

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function admin() { return !!(window.PicksStore && PicksStore.isAdmin()); }
  function board() { return typeof matches !== 'undefined' && Array.isArray(matches) ? matches : []; }   // eslint-disable-line no-undef
  function evKey(m) { return typeof eventKeyOfMatch === 'function' ? eventKeyOfMatch(m) : (String(m.id).match(/-(\d+)$/) || [])[1]; }   // eslint-disable-line no-undef
  function startMs(m) { return typeof cardStartMs === 'function' ? cardStartMs(m) : NaN; }   // eslint-disable-line no-undef
  function eventName(m) { return typeof mxEventName === 'function' ? mxEventName(m.tour) : (m.tour || ''); }   // eslint-disable-line no-undef
  function roundOf(m) { return typeof roundBadgeText === 'function' ? (roundBadgeText(m.tournamentRound) || '') : ''; }   // eslint-disable-line no-undef
  function initials(n) { var t = C.surname(n).split(/[\s-]+/).filter(Boolean); var f = String(n || '').trim().charAt(0); return ((f || '') + (t.length ? t[t.length - 1].charAt(0) : '')).toUpperCase(); }
  var _hms = null;
  function hhmmss(iso) {   // Europe/Brussels, the drawer's price stamps (reference: 11:41:14 · posted 09:41:07)
    var d = new Date(iso); if (isNaN(d)) return '—';
    if (!_hms) _hms = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    return _hms.format(d);
  }
  function surf(m) { var s = String(m.surface || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function hhmmMs(t) { return Number.isFinite(t) ? C.hhmm(new Date(t).toISOString()) : '—'; }
  function dayOfMs(t) { return Number.isFinite(t) ? C.brusselsDay(new Date(t).toISOString()) : null; }

  // Today's slate for the search: upcoming board matches that have not started (they leave at scheduled start).
  function slate() {
    var now = Date.now(), today = C.brusselsDay(new Date().toISOString());
    return board().filter(function (m) {
      if (!m || m.live || m.finalScore != null || !m.p1 || !m.p2) return false;
      var t = startMs(m); return Number.isFinite(t) && t > now && dayOfMs(t) === today;
    }).sort(function (a, b) { return startMs(a) - startMs(b); });
  }

  // ── the bet105 price the feed quotes for the current selection (line-prices.js), or null ──
  function sideKey() {
    if (!D.m) return null;
    if (D.market === 'Total games' && !D.marketCustom) return D.lineSide;   // 'over' | 'under'
    return D.sel === 'a' ? D.m.p1Key : D.m.p2Key;
  }
  function chipLine() { return D.lineCustom ? null : D.line; }   // a typed line is never a feed line
  function feedQuote() {
    if (!D.m || D.book !== 'bet105' || D.marketCustom || D.market === 'Outright' || !window.LinePrices) return null;
    var code = MKT_CODE[D.market]; if (!code) return null;
    if (code !== 'ml' && chipLine() == null) return null;
    var r = LinePrices.linePrice(evKey(D.m), sideKey(), code, code === 'ml' ? null : chipLine(), { date: D.m.date });
    return r && r.state === 'ok' ? r : (r && r.state === 'loading' ? { loading: true } : null);
  }
  function ladder() {
    if (!D.m || !window.LinePrices || D.market === 'Match winner' || D.market === 'Outright') return [];
    var code = MKT_CODE[D.market]; if (!code) return [];
    var r = LinePrices.linePrice(evKey(D.m), sideKey(), code, null, { date: D.m.date });
    return (r && r.ladder || []).filter(function (x) { return x.status === 'ok' && x.price != null; });
  }
  function mlPrice(side) {
    if (!D.m || !window.LinePrices) return null;
    var r = LinePrices.linePrice(evKey(D.m), side === 'a' ? D.m.p1Key : D.m.p2Key, 'ml', null, { date: D.m.date });
    return r && r.state === 'ok' ? r.price : null;
  }
  function ensurePrices(m) {
    if (!m || !window.LinePrices) return;
    LinePrices.load(m.date, evKey(m)).then(function () { if (D) paint(); });
  }

  // ── the line, stored as SPEC writes it: "+2.5" · "−3.5" · "Over 22.5" ──
  function lineText() {
    if (D.market === 'Match winner' || D.market === 'Outright' || D.marketCustom) return null;   // a typed market carries no chip line
    var raw = D.lineCustom ? String(D.lineCustom).trim() : D.line == null ? '' : D.market === 'Total games'
      ? (D.lineSide === 'over' ? 'Over ' : 'Under ') + D.line : (D.line > 0 ? '+' : D.line < 0 ? MINUS : '') + Math.abs(D.line);
    return raw.replace(/^-/, MINUS) || null;
  }
  function priceNow() {
    if (D.mode !== 'new') return D.pick.posted_price;
    var q = feedQuote();
    if (q && !q.loading) return q.price;
    var t = parseFloat(String(D.priceTyped || '').replace(',', '.'));
    return isFinite(t) ? t : null;
  }
  function manual() { var q = feedQuote(); return D.mode === 'new' && !(q && !q.loading); }
  function stakeVal() { var t = parseFloat(String(D.stake || '').replace(',', '.')); return isFinite(t) ? t : null; }
  function stakeOk() { var s = stakeVal(); return s != null && s >= 0.1 && s <= 10; }
  function bookName() { return D.book === 'Other' ? (String(D.bookCustom || '').trim() || 'Other') : D.book; }
  function selName() {
    if (D.market === 'Outright') return String(D.orSel || '').trim();
    return D.m ? (D.sel === 'a' ? D.m.p1 : D.m.p2) : '';
  }
  function marketName() { return D.marketCustom ? String(D.marketCustom).trim() : D.market; }
  function valid() {
    if (D.mode === 'frozen') return false;
    if (D.mode === 'edit') return stakeOk() && String(D.note || '').length <= 2000;
    var p = priceNow();
    if (!(p > 1) || !stakeOk() || D.searchOpen || String(D.note || '').length > 2000) return false;
    if (D.market === 'Outright') return !!String(D.orEvent || '').trim() && !!String(D.orSel || '').trim();
    if (!D.m) return false;
    if ((D.market === 'Games handicap' || D.market === 'Total games') && !D.marketCustom && !lineText()) return false;
    return true;
  }
  // "You post" (reference): "M. Berrettini to win @ 2.10 bet105 · 1%" · "J. Sinner · To win the tournament · Nitto ATP Finals · Turin @ 3.50 bet365 · 2%"
  function summary() {
    var p = priceNow(), mk = D.marketCustom ? String(D.marketCustom).trim() : D.market, lt = lineText();
    var what = D.market === 'Outright' && !D.marketCustom
      ? (String(D.orSel || '').trim() || '—') + ' ' + MID + ' ' + (String(D.orMarket || '').trim() || 'To win') + ' ' + MID + ' ' + (String(D.orEvent || '').trim() || '—')
      : (D.m ? (D.sel === 'a' ? D.m.p1 : D.m.p2) : '—') + (mk === 'Match winner' ? ' to win' : mk === 'Games handicap' || mk === 'Total games' ? ' ' + (lt || '') + ' games' : ' ' + MID + ' ' + mk + (lt ? ' ' + lt : ''));
    return what + ' @ ' + (p > 1 ? C.f2(p) : '—') + ' ' + bookName() + ' ' + MID + ' ' + (stakeOk() ? C.stakeText(stakeVal()) : '—');
  }
  function betLine() {
    var pick = { kind: D.market === 'Outright' ? 'outright' : 'match', market: D.marketCustom ? null : D.market, line: lineText(), selection: D.sel,
      market_text: D.orMarket || null, player_a: { name: D.market === 'Outright' ? D.orSel : D.m && D.m.p1 }, player_b: { name: D.m && D.m.p2 } };
    var t = C.betLine(pick);
    return t === C.DASH ? (selName() + ' ' + MID + ' ' + marketName() + (lineText() ? ' ' + lineText() : '')) : t;
  }

  // ── the pick the drawer posts (only the founder's fields + what was read) ──
  function buildPick() {
    if (D.market === 'Outright') {
      var settles = parseSettles(D.orSettles);
      return { kind: 'outright', event: String(D.orEvent).trim(), market_text: String(D.orMarket || '').trim() || null, settles_at: settles,
        date: C.brusselsDay(new Date().toISOString()), tournament: null, round: null, scheduled_at: null, surface: null, match_id: null,
        player_a: { id: null, name: String(D.orSel).trim(), initials: initials(D.orSel) }, player_b: null, selection: 'a', market: 'Outright', line: null,
        book: bookName(), price_source: 'manual', posted_price: priceNow(), stake: stakeVal(), note: String(D.note || ''), model_pct: null };
    }
    var m = D.m, t = startMs(m), mp = typeof mcSigModelP === 'function' ? mcSigModelP(m) : null;   // eslint-disable-line no-undef
    var model = mp && mp.p != null ? (D.sel === 'a' ? mp.p : 100 - mp.p) : null;
    return { kind: 'match', event: null, market_text: D.marketCustom ? String(D.marketCustom).trim() : null, settles_at: null,
      date: dayOfMs(t), tournament: eventName(m), round: roundOf(m) || null, scheduled_at: Number.isFinite(t) ? new Date(t).toISOString() : null,
      surface: surf(m) || null, match_id: Number(evKey(m)) || null,
      player_a: { id: m.p1Key == null ? null : m.p1Key, name: m.p1, initials: initials(m.p1) },
      player_b: { id: m.p2Key == null ? null : m.p2Key, name: m.p2, initials: initials(m.p2) },
      selection: D.market === 'Total games' && !D.marketCustom ? (D.lineSide === 'under' ? 'b' : 'a') : D.sel,
      market: D.marketCustom ? 'Other' : D.market, line: lineText(), book: bookName(), price_source: manual() ? 'manual' : 'feed',
      posted_price: priceNow(), stake: stakeVal(), note: String(D.note || ''),
      model_pct: D.market === 'Match winner' && !D.marketCustom && model != null ? Math.round(model * 10) / 10 : null };
  }
  function parseSettles(s) {
    s = String(s || '').trim(); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var m = /^(\d{1,2})\s+([A-Za-z]{3})/.exec(s), MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    if (!m) return null;
    var mi = MON.indexOf(m[2].toLowerCase()); if (mi < 0) return null;
    var now = new Date(), y = now.getUTCFullYear(), d = String(m[1]).padStart(2, '0'), mo = String(mi + 1).padStart(2, '0');
    var iso = y + '-' + mo + '-' + d;
    return iso < C.brusselsDay(now.toISOString()) ? (y + 1) + '-' + mo + '-' + d : iso;
  }

  // ── open / close ──
  function openNew(m) {
    if (!admin()) return;
    D = { mode: 'new', m: m || null, searchOpen: !m, q: '', sel: 'a', market: 'Match winner', marketCustom: '', line: null, lineSide: 'over',
      lineCustom: '', book: 'bet105', bookCustom: '', priceTyped: '', stake: '1', note: '', orEvent: '', orSel: '', orMarket: '', orSettles: '',
      busy: false, err: '', stamp: Date.now() };
    if (m) { ensurePrices(m); var a = mlPrice('a'), b = mlPrice('b'); if (a && b) D.sel = 'a'; }
    mount();
  }
  function openEdit(p) {
    if (!admin() || !p) return;
    var open = p.status === 'posted' && Date.parse(p.posted_at) + EDIT_MS > Date.now();
    D = { mode: open ? 'edit' : 'frozen', pick: p, stake: String(p.stake), note: p.note || '', voiding: false, voidReason: '', busy: false, err: '' };
    mount();
  }
  function close() { var ov = document.getElementById('pkdOv'); if (ov) ov.remove(); D = null; document.removeEventListener('keydown', trap, true); }
  function trap() { /* Esc goes through the one handler (esc-nav.js layer below) */ }
  (globalThis.sfEscLayers = globalThis.sfEscLayers || []).push({ id: 'picks-drawer', z: 80, isOpen: function () { return !!D; }, close: close });
  (window.sfOverlayClosers = window.sfOverlayClosers || []).push(function () { if (D) close(); });

  function mount() {
    var ov = document.getElementById('pkdOv');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'pkdOv'; ov.className = 'pkd-ov';
      ov.innerHTML = '<div class="pkd-back" data-pkd="close"></div><aside class="pkd" role="dialog" aria-modal="true" aria-label="Post a pick"></aside>';
      document.body.appendChild(ov);
      ov.addEventListener('click', onClick); ov.addEventListener('input', onInput);
    }
    paint();
    var f = ov.querySelector(D.searchOpen ? '#pkdQ' : '.pkd-x'); if (f) f.focus();
  }

  // ── painting ──
  function caps(t, right) { return '<div class="pkd-lab"><span class="pkd-caps">' + esc(t) + '</span>' + (right || '') + '</div>'; }
  function chipBtn(label, on, act, k, mono) {
    return '<button type="button" class="pkd-chip' + (on ? ' on' : '') + (mono ? ' pkd-mono' : '') + '" data-pkd="' + act + '" data-k="' + esc(k) + '">' + esc(label) + '</button>';
  }
  function metaRow(m) {
    if (!m) return '';
    var t = startMs(m), dl = Number.isFinite(t) ? C.dayLabel(dayOfMs(t)) + ' ' + MID + ' ' + hhmmMs(t) : '—';
    return '<div class="pkd-meta">' + (surf(m) ? '<span class="pkd-surf">' + esc(surf(m)) + '</span>' : '') + '<span class="pkd-tourn">' + esc(eventName(m)) + '</span>'
      + (roundOf(m) ? '<span class="pkd-round">' + esc(roundOf(m)) + '</span>' : '') + '<span class="pkd-time">' + esc(dl) + '</span></div>';
  }
  // outright header (reference): event · [Outright] · settles 16 Nov
  function orMeta(event, settles) {
    return '<div class="pkd-meta"><span class="pkd-tourn">' + esc(event) + '</span><span class="pkd-round">Outright</span><span class="pkd-time">settles ' + esc(settles) + '</span></div>';
  }
  function pickMeta(p) {
    if (p.kind === 'outright') return orMeta(p.event || 'Outright', p.settles_at ? C.dayMonthShort(p.settles_at) : '—');
    var t = Date.parse(p.scheduled_at);
    return '<div class="pkd-meta">' + (p.surface ? '<span class="pkd-surf">' + esc(p.surface) + '</span>' : '') + '<span class="pkd-tourn">' + esc(p.tournament || '') + '</span>'
      + (p.round ? '<span class="pkd-round">' + esc(p.round) + '</span>' : '') + '<span class="pkd-time">' + esc(Number.isFinite(t) ? C.dayLabel(dayOfMs(t)) + ' ' + MID + ' ' + hhmmMs(t) : '—') + '</span></div>';
  }
  function head() {
    var title = D.mode === 'new' ? 'Post a pick' : D.mode === 'edit' ? 'Edit pick' : 'Pick · frozen';
    var meta = D.mode !== 'new' ? pickMeta(D.pick) : D.market === 'Outright'
      ? orMeta(String(D.orEvent || '').trim() || 'Outright', String(D.orSettles || '').trim() || '—') : metaRow(D.m);
    return '<div class="pkd-hd"><div class="pkd-hd-l"><span class="pkd-title">' + title + '</span>' + meta + '</div>'
      + '<button type="button" class="pkd-x" data-pkd="close" aria-label="Close">×</button></div>';
  }
  function banner() {
    if (D.mode === 'new') return '';
    var p = D.pick, at = C.hhmm(p.posted_at), px = C.f2(p.posted_price);
    if (D.mode === 'edit') {
      var left = Math.max(1, Math.ceil((Date.parse(p.posted_at) + EDIT_MS - Date.now()) / 60000));
      return '<div class="pkd-ban pkd-ban--edit"><span class="pkd-dot"></span><span>Posted ' + at + ' at ' + px + ' ' + MID + ' editable for ' + left + ' more minute' + (left === 1 ? '' : 's')
        + ' ' + MID + ' note and stake only</span><button type="button" class="pkd-void" data-pkd="voidask">Void pick…</button></div>';
    }
    var fr = C.hhmm(new Date(Date.parse(p.posted_at) + EDIT_MS).toISOString());
    return '<div class="pkd-ban pkd-ban--frozen"><span class="pkd-dot"></span><span>Posted ' + at + ' at ' + px + ' ' + MID + ' the 10-minute window closed at ' + fr + '</span></div>';
  }
  // the market / selection the drawer shows: what the founder is choosing (new), or the posted pick (edit / frozen)
  function curMarket() { return D.mode === 'new' ? (D.marketCustom ? null : D.market) : (D.pick.market === 'Other' ? null : D.pick.market); }
  function matchSection() {
    if (D.mode !== 'new' || D.market === 'Outright') return '';
    var out = '<div class="pkd-sec pkd-sec6">' + caps('Match', D.searchOpen && D.m ? '<button type="button" class="pkd-mini" data-pkd="cancelsearch">Cancel</button>' : '');
    if (D.searchOpen) {
      var q = fold(D.q), hits = slate().filter(function (m) { return !q || fold(m.p1 + ' ' + m.p2 + ' ' + eventName(m)).indexOf(q) >= 0; }).slice(0, 6);
      out += '<div class="pkd-search"><div class="pkd-sinput"><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.8"></circle><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>'
        + '<input id="pkdQ" value="' + esc(D.q) + '" placeholder="Search today’s matches — player or tournament" autocomplete="off"></div>'
        + hits.map(function (m, i) {
          hitPrices(m);
          var t = startMs(m);
          return '<div class="pkd-hit' + (D.m && D.m.id === m.id ? ' on' : '') + (i < hits.length - 1 ? ' is-ruled' : '') + '" data-pkd="pickmatch" data-k="' + esc(m.id) + '"><span class="pkd-hit-l"><span class="pkd-hit-n">' + esc(m.p1 + ' v ' + m.p2) + '</span>'
            + '<span class="pkd-hit-s">' + esc(eventName(m) + (roundOf(m) ? ' ' + roundOf(m) : '') + ' ' + MID + ' ' + hhmmMs(t)) + '</span></span>'
            + '<span class="pkd-hit-p">' + C.f2(priceOf(m, 'a')) + '</span><span class="pkd-hit-p">' + C.f2(priceOf(m, 'b')) + '</span></div>';
        }).join('')
        + (hits.length ? '<span class="pkd-sfoot">Today’s slate ' + MID + ' bet105 per side ' + MID + ' matches leave the list at scheduled start</span>'
          : '<div class="pkd-hit-none">No match left on today’s slate' + (q ? ' for “' + esc(D.q) + '”' : '') + '</div>') + '</div>';
    }
    return out + '</div>';
  }
  // Selection · click a player — the two players; locked (0.55) once posted
  function selectionSection() {
    var newMode = D.mode === 'new';
    if (newMode ? (D.market === 'Outright' || !D.m) : D.pick.kind === 'outright') return '';
    var names = newMode ? [D.m.p1, D.m.p2] : [(D.pick.player_a || {}).name, (D.pick.player_b || {}).name];
    var sel = newMode ? D.sel : D.pick.selection;
    var px = newMode ? [mlPrice('a'), mlPrice('b')]
      : [sel === 'a' ? D.pick.posted_price : D.pick.opp_now_price, sel === 'b' ? D.pick.posted_price : D.pick.opp_now_price];
    var rows = ['a', 'b'].map(function (s, i) {
      var on = sel === s, other = px[1 - i], fav = px[i] != null && other != null && px[i] < other;
      return '<div class="pkd-selrow' + (on ? ' on' : '') + '"' + (newMode ? ' data-pkd="sel" data-k="' + s + '"' : '') + '><span class="pkd-selbar"></span><span class="pkd-av">' + esc(initials(names[i])) + '</span>'
        + '<span class="pkd-seln"><span class="pkd-seln-t">' + esc(names[i] || '—') + '</span>' + (fav ? '<span class="pkd-fav">FAV</span>' : '') + '</span>'
        + '<span class="pkd-selpx"><span class="pkd-selp">' + C.f2(px[i]) + '</span><span class="pkd-bk">bet105</span></span></div>';
    }).join('');
    return '<div class="pkd-sec pkd-sec6' + (newMode ? '' : ' pkd-off') + (newMode && !D.searchOpen ? ' pkd-sec--tight' : '') + '">'
      + caps('Selection ' + MID + ' click a player', newMode ? '<button type="button" class="pkd-link" data-pkd="changematch">Change match</button>' : '') + '<div class="pkd-sels">' + rows + '</div></div>';
  }
  var _hitLoad = {};
  function hitPrices(m) { var k = evKey(m); if (_hitLoad[k] || !window.LinePrices) return; _hitLoad[k] = 1; LinePrices.load(m.date, k).then(function () { if (D && D.searchOpen) paint(); }); }
  function priceOf(m, s) {
    if (!window.LinePrices) return null;
    var r = LinePrices.linePrice(evKey(m), s === 'a' ? m.p1Key : m.p2Key, 'ml', null, { date: m.date });
    return r && r.state === 'ok' ? r.price : null;
  }
  // Market · line · Bookmaker — locked (0.55) once posted
  function marketSection() {
    var newMode = D.mode === 'new', mk = curMarket(), book = newMode ? D.book : (BOOKS.indexOf(D.pick.book) >= 0 ? D.pick.book : 'Other');
    var chips = MARKETS.map(function (k) { return chipBtn(k, mk === k, 'market', k); }).join('');
    var custom = newMode ? D.marketCustom : (D.pick.market === 'Other' ? (D.pick.market_text || '') : '');
    var out = '<div class="pkd-sec' + (newMode ? '' : ' pkd-off') + '">' + caps('Market') + '<div class="pkd-chips">' + chips
      + '<input class="pkd-txt' + (custom ? ' is-filled' : '') + '" id="pkdMktCustom" value="' + esc(custom) + '" placeholder="Other market, e.g. Set handicap"></div>';
    if (newMode && !D.marketCustom && D.market === 'Outright') {
      out += '<div class="pkd-or">'
        + '<input class="pkd-in pkd-wide pkd-b6" id="pkdOrEvent" value="' + esc(D.orEvent) + '" placeholder="Event, e.g. Nitto ATP Finals · Turin">'
        + '<input class="pkd-in pkd-b7" id="pkdOrSel" value="' + esc(D.orSel) + '" placeholder="Selection, e.g. J. Sinner">'
        + '<input class="pkd-in pkd-mono" id="pkdOrSettles" value="' + esc(D.orSettles) + '" placeholder="Settles, e.g. 16 Nov">'
        + '<input class="pkd-in pkd-wide" id="pkdOrMarket" value="' + esc(D.orMarket) + '" placeholder="What wins, e.g. To win the tournament"></div>';
    }
    if (newMode && !D.marketCustom && (D.market === 'Games handicap' || D.market === 'Total games')) {
      var lineChips = '';
      if (D.market === 'Total games') {
        var lines = {}; ['over', 'under'].forEach(function (sd) {
          var r = window.LinePrices && D.m ? LinePrices.linePrice(evKey(D.m), sd, 'tg', null, { date: D.m.date }) : null;
          (r && r.ladder || []).filter(function (x) { return x.status === 'ok'; }).forEach(function (x) { lines[sd + '|' + x.line] = { side: sd, line: x.line }; });
        });
        lineChips = Object.keys(lines).map(function (k) { var x = lines[k];
          return chipBtn((x.side === 'over' ? 'Over ' : 'Under ') + x.line, !D.lineCustom && D.line === x.line && D.lineSide === x.side, 'line', x.side + '|' + x.line, true); }).join('');
      } else {
        lineChips = ladder().map(function (x) { var t = (x.line > 0 ? '+' : x.line < 0 ? MINUS : '') + Math.abs(x.line);
          return chipBtn(t, !D.lineCustom && D.line === x.line, 'line', '|' + x.line, true); }).join('');
      }
      out += '<div class="pkd-lines">' + lineChips + '<input class="pkd-txt pkd-line" id="pkdLineCustom" value="' + esc(D.lineCustom) + '" placeholder="' + (D.market === 'Games handicap' ? 'Other line, e.g. +4.5' : 'Other line, e.g. Over 23.5') + '"></div>'
        + '<span class="pkd-note">' + (lineChips ? 'Chips = lines Kibl quotes on bet105 right now (' + C.hhmm(new Date().toISOString()) + '). Type any other line in the box — +3, +4, Over 23.5 … — and the price is typed too.' : 'No feed for this market — type the line and the price.') + '</span>';
    }
    out += '<div class="pkd-bookblk">' + caps('Bookmaker') + '<div class="pkd-chips">' + BOOKS.map(function (b) { return chipBtn(b, book === b, 'book', b); }).join('')
      + (newMode && D.book === 'Other' ? '<input class="pkd-txt' + (D.bookCustom ? ' is-filled' : '') + '" id="pkdBook" value="' + esc(D.bookCustom) + '" placeholder="Book name">' : '') + '</div></div></div>';
    return out;
  }
  var LOCK = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M5 9h10v8H5zM7 9V6a3 3 0 016 0v3" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path></svg>';
  function priceSection() {
    if (D.mode !== 'new') {
      var p = D.pick;
      return '<div class="pkd-sec">' + caps('Posted price ' + MID + ' locked') + '<div class="pkd-pbox"><span class="pkd-px">' + C.f2(p.posted_price) + '</span>'
        + '<span class="pkd-psrc"><span class="pkd-psrc-a">' + esc((p.book || 'bet105') + ' ' + MID + ' ' + C.surname(((p.selection === 'b' ? p.player_b : p.player_a) || {}).name || '') + ' ' + MID + ' ' + C.marketLabel(p) + (p.line ? ' ' + p.line : '')) + '</span>'
        + '<span class="pkd-psrc-b">posted ' + esc(hhmmss(p.posted_at)) + '</span></span><span class="pkd-lock" title="Price is locked at posting">' + LOCK + '</span></div>'
        + '<span class="pkd-note">Price can never change after posting.</span></div>';
    }
    var q = feedQuote();
    if (q && !q.loading) {
      var src = 'bet105 ' + MID + ' ' + C.surname(selName()) + ' ' + MID + ' ' + D.market + (lineText() ? ' ' + lineText() : '');
      return '<div class="pkd-sec">' + caps('Price ' + MID + ' live bet105, read-only') + '<div class="pkd-pbox"><span class="pkd-px">' + C.f2(q.price) + '</span>'
        + '<span class="pkd-psrc"><span class="pkd-psrc-a">' + esc(src) + '</span><span class="pkd-psrc-b">' + esc(q.insertedOn ? hhmmss(q.insertedOn) : '—') + '</span></span>'
        + '<button type="button" class="pkd-refresh" data-pkd="refresh" title="Refresh price"><svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M16 10a6 6 0 11-1.8-4.3M16 3.5v3h-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></button></div>'
        + '<span class="pkd-note">Live bet105 price — read-only; refresh if it has moved. Pick another book or type a line Kibl doesn’t quote to enter a price by hand.</span></div>';
    }
    var typed = parseFloat(String(D.priceTyped || '').replace(',', '.')), bad = D.priceTyped !== '' && !(typed > 1);
    var mline = D.market === 'Outright' && !D.marketCustom
      ? bookName() + ' ' + MID + ' ' + (String(D.orSel || '').trim() || 'Selection') + ' ' + MID + ' ' + (String(D.orMarket || '').trim() || 'To win')
      : bookName() + ' ' + MID + ' ' + (C.surname(selName()) || '—') + ' ' + MID + ' ' + marketName() + (lineText() ? ' ' + lineText() : '');
    return '<div class="pkd-sec">' + caps('Price ' + MID + ' typed') + '<div class="pkd-pbox pkd-pbox--typed' + (bad ? ' is-bad' : '') + '">'
      + '<input class="pkd-pin" id="pkdPrice" inputmode="decimal" autocomplete="off" placeholder="2.10" value="' + esc(D.priceTyped) + '">'
      + '<span class="pkd-psrc"><span class="pkd-psrc-a">' + esc(mline) + '</span><span class="pkd-psrc-b">typed by you ' + MID + ' decimal odds</span></span><span class="pkd-manual">MANUAL</span></div>'
      + '<span class="pkd-note">' + (q && q.loading ? 'Reading the bet105 price… ' : '') + 'Typed price — not from a feed. Stored with source = manual and shown on the card as ' + esc(bookName()) + '; CLV still runs against the Pinnacle close.</span></div>';
  }
  function stakeSection() {
    var s = stakeVal(), p = D.mode === 'new' ? priceNow() : D.pick.posted_price, hint, bad = false;
    if (String(D.stake).trim() === '') { hint = 'Type the stake in % of bankroll'; bad = true; }
    else if (!stakeOk()) { hint = 'Stake is % of bankroll, 0.1 to 10'; bad = true; }
    else hint = p > 1 ? 'Wins → ' + C.u(s * (p - 1)) + ' ' + MID + ' loses → ' + C.u(-s) + ' ' + MID + ' at ' + C.f2(p) : 'Wins → — until a price is set ' + MID + ' loses → ' + C.u(-s);
    return '<div class="pkd-sec' + (D.mode === 'frozen' ? ' pkd-off' : '') + '">' + caps('Stake ' + MID + ' % of bankroll') + '<div class="pkd-stake"><div class="pkd-sbox"><input id="pkdStake" inputmode="decimal" autocomplete="off" placeholder="1" value="' + esc(D.stake) + '"' + (D.mode === 'frozen' ? ' disabled' : '') + '><span class="pkd-pct">%</span></div>'
      + '<span class="pkd-shint' + (bad ? ' is-bad' : '') + '">' + esc(hint) + '</span></div></div>';
  }
  function noteSection() {
    var n = String(D.note || '').length;
    return '<div class="pkd-sec' + (D.mode === 'frozen' ? ' pkd-off' : '') + '"><div class="pkd-lab"><span class="pkd-caps">Note</span><span class="pkd-count' + (n > 1900 ? ' is-warn' : '') + '">' + n.toLocaleString('en-GB') + ' / 2,000</span></div>'
      + '<textarea id="pkdNote" rows="6" maxlength="2000" placeholder="Why this pick — the full analysis, 6 to 10 sentences"' + (D.mode === 'frozen' ? ' disabled' : '') + '>' + esc(D.note) + '</textarea></div>';
  }
  function actions() {
    var out = '';
    if (D.mode === 'new') {
      out += '<div class="pkd-sum"><span class="pkd-caps pkd-caps10">You post</span><span class="pkd-sum-t">' + esc(summary()) + '</span></div>';
      out += '<div class="pkd-acts"><button type="button" class="pkd-primary" data-pkd="post"' + (valid() && !D.busy ? '' : ' aria-disabled="true"') + '>' + (D.busy ? 'Posting…' : 'Post pick') + '</button>'
        + '<button type="button" class="pkd-secondary" data-pkd="draft"' + (D.busy ? ' aria-disabled="true"' : '') + '>Save as draft</button></div>';
      out += '<span class="pkd-foot">Drafts are visible only to you and are never counted. A posted pick can be edited for 10 minutes (note and stake only) and voided with a reason; after that it is frozen.</span>';
    } else if (D.mode === 'edit') {
      if (D.voiding) {
        out += '<div class="pkd-sec">' + caps('Void · reason') + '<input class="pkd-in pkd-wide" id="pkdVoid" value="' + esc(D.voidReason) + '" placeholder="Why this pick is void"></div>'
          + '<div class="pkd-acts"><button type="button" class="pkd-primary" data-pkd="dovoid"' + (String(D.voidReason).trim() && !D.busy ? '' : ' aria-disabled="true"') + '>Void pick</button>'
          + '<button type="button" class="pkd-secondary" data-pkd="voidcancel">Cancel</button></div>';
      } else {
        out += '<div class="pkd-acts"><button type="button" class="pkd-primary" data-pkd="save"' + (valid() && !D.busy ? '' : ' aria-disabled="true"') + '>' + (D.busy ? 'Saving…' : 'Save changes') + '</button>'
          + '<button type="button" class="pkd-secondary" data-pkd="close">Cancel</button></div>';
      }
      out += '<span class="pkd-foot">Voiding asks for a reason; a voided pick shows VOID · 0% and stays in the ledger.</span>';
    } else {
      out += '<div class="pkd-acts"><span class="pkd-frozen">' + LOCK + 'Frozen ' + MID + ' posted ' + esc(C.hhmm(D.pick.posted_at)) + ' ' + MID + ' nothing can change</span></div>';
    }
    if (D.err) out += '<span class="pkd-err">' + esc(D.err) + '</span>';
    return out;
  }
  function paint() {
    var el = document.querySelector('#pkdOv .pkd'); if (!el || !D) return;
    var focus = document.activeElement && document.activeElement.id, sel = focus && document.activeElement.selectionStart;
    el.innerHTML = head() + banner() + '<div class="pkd-body">' + matchSection() + selectionSection() + marketSection()
      + priceSection() + stakeSection() + noteSection() + actions() + '</div>';
    if (focus) { var f = document.getElementById(focus); if (f) { f.focus(); try { if (sel != null) f.setSelectionRange(sel, sel); } catch (e) { /* not a text input */ } } }
  }
  // ── events ──
  function onInput(e) {
    if (!D) return;
    var id = e.target.id, v = e.target.value;
    if (id === 'pkdQ') D.q = v;
    else if (id === 'pkdMktCustom') {
      var chip = MARKETS.filter(function (k) { return k.toLowerCase() === String(v).trim().toLowerCase(); })[0];
      if (chip) { D.market = chip; D.marketCustom = ''; D.line = null; D.lineCustom = ''; D.priceTyped = ''; paint(); return; }
      D.marketCustom = v; D.priceTyped = '';
    }
    else if (id === 'pkdLineCustom') { D.lineCustom = v; D.priceTyped = ''; }
    else if (id === 'pkdPrice') D.priceTyped = v;
    else if (id === 'pkdStake') D.stake = v;
    else if (id === 'pkdNote') { D.note = v.slice(0, 2000); var c = document.querySelector('#pkdOv .pkd-count'); if (c) { c.textContent = D.note.length.toLocaleString('en-GB') + ' / 2,000'; c.classList.toggle('is-warn', D.note.length > 1900); } refreshActs(); return; }
    else if (id === 'pkdBook') D.bookCustom = v;
    else if (id === 'pkdOrEvent') D.orEvent = v; else if (id === 'pkdOrSel') D.orSel = v;
    else if (id === 'pkdOrSettles') D.orSettles = v; else if (id === 'pkdOrMarket') D.orMarket = v;
    else if (id === 'pkdVoid') { D.voidReason = v; refreshActs(); return; }
    paint();
  }
  function refreshActs() { var b = document.querySelector('#pkdOv [data-pkd="post"], #pkdOv [data-pkd="save"], #pkdOv [data-pkd="dovoid"]'); if (b) paint(); }
  function onClick(e) {
    var a = e.target.closest('[data-pkd]'); if (!a || !D) return;
    var act = a.getAttribute('data-pkd'), k = a.getAttribute('data-k');
    if (a.getAttribute('aria-disabled') === 'true') return;
    if (act === 'close') { close(); return; }
    if (act === 'cancelsearch') { if (D.m) D.searchOpen = false; }
    else if (act === 'changematch') { D.searchOpen = true; D.q = ''; }
    else if (act === 'pickmatch') { D.m = slate().filter(function (m) { return String(m.id) === k; })[0] || D.m; D.searchOpen = false; D.sel = 'a'; D.line = null; D.lineCustom = ''; D.priceTyped = ''; ensurePrices(D.m); }
    else if (act === 'sel') { D.sel = k; D.line = null; D.lineCustom = ''; D.priceTyped = ''; }
    else if (act === 'market') { D.market = k; D.marketCustom = ''; D.line = null; D.lineCustom = ''; D.priceTyped = ''; if (k === 'Outright') D.searchOpen = false; }
    else if (act === 'line') { var parts = k.split('|'); if (parts[0]) D.lineSide = parts[0]; D.line = +parts[1]; D.lineCustom = ''; D.priceTyped = ''; }
    else if (act === 'book') { D.book = k; D.priceTyped = ''; }
    else if (act === 'refresh') { if (D.m && window.LinePrices) { delete LinePrices._cache[String(evKey(D.m))]; ensurePrices(D.m); } }
    else if (act === 'voidask') D.voiding = true;
    else if (act === 'voidcancel') D.voiding = false;
    else if (act === 'post' || act === 'draft') { submit(act === 'draft'); return; }
    else if (act === 'save') { save(); return; }
    else if (act === 'dovoid') { doVoid(); return; }
    paint();
  }
  function done() {
    close(); if (window.PicksPage) PicksPage.reload(); if (typeof window.mxBetsRefresh === 'function') window.mxBetsRefresh();
    if (window.PicksShell && PicksShell.checkCount) PicksShell.checkCount();
  }
  function fail(err) { D.busy = false; D.err = (err && err.message) || 'Could not save — try again.'; paint(); }
  function submit(draft) {
    if (!draft && !valid()) return;
    D.busy = true; D.err = ''; paint();
    PicksStore.post(buildPick(), { draft: draft }).then(done, fail);
  }
  function save() { if (!valid()) return; D.busy = true; D.err = ''; paint(); PicksStore.edit(D.pick.id, { stake: stakeVal(), note: String(D.note || '') }).then(done, fail); }
  function doVoid() { D.busy = true; D.err = ''; paint(); PicksStore.voidPick(D.pick.id, D.voidReason).then(done, fail); }

  window.PicksDrawer = { openNew: openNew, openEdit: openEdit, close: close, isOpen: function () { return !!D; },
    _state: function () { return D; }, _buildPick: function () { return D ? buildPick() : null; }, _valid: function () { return D ? valid() : false; } };
})();
