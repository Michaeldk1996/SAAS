/* picks-page.js — the Picks page, read-only (boards 1a–1e, 1i, 1j of `design_handoff_picks`, LOCKED 2026-10-27).
 *
 * Reads picks.json (static; today the design's demo rows, `fixture: true`) and renders it with the figures from
 * picks-core.js. Nothing here computes a number: every price, CLV, P/L and record figure comes from PicksCore, or is a
 * dash. Values = the export's inline styles (picks-page.css). The page header is the shared 35b header (.sfh); the
 * controls row is the landed Today's Matches shell (picks-page.css "controls" block, locked by
 * tools/test-picks-page.mjs against the Matches page's computed styles).
 *
 * Reached by URL only (#picks): no nav link yet (Task 3). Not built here (Tasks 2 / 3): the Post-a-pick drawer, "+ Pick",
 * the Bets today tile, the nav dot, the admin badge. Gating is visual only (window.sfPlan === 'pro' → Pro); the demo
 * rows are public in picks.json, so the blur hides nothing that matters until real picks and access control ship.
 */
(function () {
  'use strict';
  var C = window.PicksCore;
  if (!C) return;
  var DASH = C.DASH, MID = '·';

  var S = {
    data: null, failed: false, loading: null,
    tab: 'upcoming', day: null, period: '30d', view: 'cards', sort: { key: 'date', dir: -1 },
    tourn: null, tournOpen: false, q: '', noteOpen: {}, stars: {}
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function root() { return document.getElementById('picksRoot'); }
  function isPro() { return window.sfPlan === 'pro'; }
  function today() {
    if (S.data && S.data.fixture && S.data.as_of_day) return S.data.as_of_day;   // a fixture pins its own day
    return C.brusselsDay(new Date().toISOString());
  }
  function rows() { return (S.data && Array.isArray(S.data.picks)) ? S.data.picks : []; }
  function mobile() { return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches); }

  function load() {
    if (S.loading) return S.loading;
    S.loading = fetch('./picks.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        S.data = d && Array.isArray(d.picks) ? d : null; S.failed = !S.data;
        if (!S.day) S.day = today();
        render();
      });
    return S.loading;
  }

  // ── match routing (SPEC §5.6): a card opens its match only when the board holds exactly that match — joined on BOTH
  // player ids and the day (never on surnames alone). The demo rows carry no player id, so they never route. ──────────
  function boardMatch(p) {
    if (!p || C.isOutright(p) || typeof matchById !== 'function' || typeof matches === 'undefined') return null;   // eslint-disable-line no-undef
    var a = p.player_a && p.player_a.id, b = p.player_b && p.player_b.id;
    if (a == null || b == null) return null;
    var hit = (matches || []).filter(function (m) {   // eslint-disable-line no-undef
      return m && m.date === p.date && ((m.p1Key === a && m.p2Key === b) || (m.p1Key === b && m.p2Key === a));
    });
    return hit.length === 1 ? hit[0] : null;
  }
  function openMatch(id) {
    var p = rows().find(function (x) { return x.id === id; }), m = boardMatch(p);
    if (!m || typeof openAnalysisModal !== 'function') return;   // eslint-disable-line no-undef
    var retired = p.result && p.result.retired;
    openAnalysisModal(m.id, C.isSettled(p) && !retired ? 'matchstats' : 'key');   // eslint-disable-line no-undef
  }

  // ── atoms ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function tag(text, cls) { return '<span class="pk-tag' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</span>'; }
  function typeTag(p) { return tag(C.typeTag(p), C.isOutright(p) ? 'pk-tag--or' : ''); }
  function chip(p) { var c = C.statusChip(p); return tag(c.text, 'pk-chip--' + c.kind); }
  function sgnCls(x) { return 'pk-s-' + C.sgnKind(x); }
  var STAR = '<svg width="14" height="14" viewBox="0 0 20 20"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5L10 14.2l-4.5 2.4.9-5L2.8 8.1l5-.7z" stroke-width="1.5" stroke-linejoin="round"></path></svg>';
  var PRO = '<span class="pk-pro">PRO</span>';

  function gatedOf(p) { return !isPro() && (p.status === 'posted' || p.status === 'live') && p.date === today(); }

  function playerRow(p, side, opts) {
    var q = side === 'a' ? p.player_a : p.player_b; if (!q) return '';
    var picked = p.selection === side, win = C.winnerSide(p), dim = win && win !== side;
    var w = win ? (win === side ? 800 : 600) : (picked ? 700 : 600);
    var fav = !opts.outright && C.favSide(p) === side, lt = picked ? C.lineTag(p) : '';
    var sc = C.scoreSide(p, side), score = '';
    if (sc && C.isSettled(p)) {
      score = '<span class="pk-score"><span class="pk-sw' + (win === side ? ' is-win' : '') + '">' + sc.setsWon + '</span><span class="pk-score-rule"></span><span class="pk-sets">'
        + sc.cells.map(function (c) { return '<span class="pk-set' + (c.won ? ' is-won' : '') + '">' + esc(c.v) + (c.tb ? '<span class="pk-tb">' + esc(c.tb) + '</span>' : '') + '</span>'; }).join('')
        + '</span></span>';
    }
    return '<div class="pk-pl"><span class="pk-bar' + (picked ? ' is-on' : '') + '"></span>'
      + '<span class="pk-av' + (dim ? ' is-loser' : '') + '">' + esc(q.initials || '') + '</span>'
      + '<span class="pk-pl-n"><span class="pk-name' + (dim ? ' is-dim' : '') + '" style="font-weight:' + w + '" data-stop="1">' + esc(q.name) + '</span>'
      + (fav ? '<span class="pk-fav">FAV</span>' : '') + (lt ? '<span class="pk-line">' + esc(lt) + '</span>' : '') + '</span>'
      + score + '</div>';
  }

  function trailHtml(p, forceFour) {
    var t = C.trail(p, forceFour); if (!t) return '';
    var stopLabel = function (col, s) { return '<span class="pk-tl" style="grid-column:' + col + '">' + s + '</span>'; };
    var seg = function (c) { return '<span class="pk-seg" style="background:' + c + '"></span>'; };
    if (t.stops === 3) {
      return '<div class="pk-trail pk-trail--3">'
        + '<span class="pk-t-open">' + C.f2(t.open) + '</span>' + seg(t.segs[0])
        + '<span class="pk-t-posted">' + C.f2(t.posted) + '</span>' + seg(t.segs[1])
        + '<span class="pk-t-close3' + (t.close == null ? ' is-none' : '') + '">' + C.f2(t.close) + '</span>'
        + stopLabel(1, 'Open') + stopLabel(3, 'Posted') + stopLabel(5, 'Close') + '</div>';
    }
    return '<div class="pk-trail pk-trail--4">'
      + '<span class="pk-t-open">' + C.f2(t.open) + '</span>' + seg(t.segs[0])
      + '<span class="pk-t-posted">' + C.f2(t.posted) + '</span>' + seg(t.segs[1])
      + '<span class="pk-t-now">' + C.f2(t.now) + '</span>' + seg(t.segs[2])
      + '<span class="pk-t-close4' + (t.close == null ? ' is-none' : '') + '">' + C.f2(t.close) + '</span>'
      + stopLabel(1, 'Open') + stopLabel(3, 'Posted') + stopLabel(5, t.nowLabel) + stopLabel(7, 'Close') + '</div>';
  }
  function metaLine(p) {
    var clv = C.clvOf(p), mf = C.modelFair(p.model_pct);
    var modelBlur = !isPro() && !C.isSettled(p) ? ' is-blur' : '';
    return '<div class="pk-meta"><span>CLV</span><span class="pk-mono12 ' + (clv == null ? 'pk-s-zero' : sgnCls(clv)) + '">' + C.pct(clv) + '</span>'
      + '<span>' + MID + '</span><span>Stennisfy</span><span class="pk-mono12 pk-w' + modelBlur + '">' + C.f2(mf) + '</span>'
      + '<span>' + MID + '</span><span>Stake</span><span class="pk-mono12 pk-w">' + esc(C.stakeText(p.stake)) + '</span></div>';
  }
  function betLineHtml(p) {
    return '<div class="pk-bl"><span class="pk-bl-t">' + esc(C.betLine(p)) + '</span><span class="pk-at">@</span>'
      + '<span class="pk-bl-p">' + C.f2(p.posted_price) + '</span><span class="pk-bk">bet105</span></div>';
  }
  function noteText(p) { return (p.note || '') + (p.status === 'void' ? C.voidTail(p) : ''); }
  function footHtml(p, gated, open, pad) {
    var left = gated
      ? '<span class="pk-unlock">' + PRO + '<a class="pk-link" href="account.html" data-stop="1">Unlock today’s picks →</a></span>'
      : (p.note ? '<span class="pk-foot-l"><span class="pk-toggle" data-act="note" data-id="' + esc(p.id) + '">' + (open ? 'Hide analysis' : 'Read the analysis')
        + ' <span class="pk-tchev' + (open ? ' is-open' : '') + '">▾</span></span></span>' : '<span></span>');
    var routed = !!boardMatch(p);
    return '<div class="pk-foot' + (pad || '') + '">' + left + '<span class="pk-link pk-openmatch' + (routed ? '' : ' is-inert') + '"'
      + (routed ? ' data-act="open" data-id="' + esc(p.id) + '"' : ' title="This match is not on the board"') + '>Open match →</span></div>';
  }

  // ── the pick card (SPEC §5) ────────────────────────────────────────────────────────────────────────────────────
  function card(p) {
    var outright = C.isOutright(p), settled = C.isSettled(p), gated = gatedOf(p);
    var open = !gated && !!S.noteOpen[p.id], blur = gated ? ' is-blur' : '', routed = !!boardMatch(p);
    var dim = p.status === 'lost' || p.status === 'void' ? ' is-dim' : '';
    var pl = C.plText(p), plOf = p.status === 'void' ? 0 : C.plOf(p);
    var head = '<div class="pk-hd">'
      + '<span class="pk-star' + (S.stars[p.id] ? ' is-on' : '') + '" data-act="star" data-id="' + esc(p.id) + '" title="Favourite">' + STAR + '</span>'
      + typeTag(p)
      + (outright ? '' : '<span class="pk-surf">' + esc(p.surface || DASH) + '</span>')
      + '<span class="pk-tourn">' + esc(outright ? p.event : p.tournament) + '</span>'
      + (outright ? '' : '<span class="pk-round">' + esc(p.round || DASH) + '</span><span class="pk-time">' + C.hhmm(p.scheduled_at) + '</span>')
      + '<span class="pk-hd-r">' + (pl ? '<span class="pk-pl-v ' + sgnCls(plOf) + '">' + pl + '</span>' : '') + chip(p) + '</span></div>';
    var players = outright ? playerRow(p, 'a', { outright: true }) : playerRow(p, 'a', {}) + playerRow(p, 'b', {});
    var right = betLineHtml(p);
    if (outright) {
      right += '<div class="pk-or"><span>Posted ' + C.hhmm(p.posted_at) + ' ' + MID + ' bet105 ' + MID + ' Stake <span class="pk-mono pk-w pk-b7">' + esc(C.stakeText(p.stake)) + '</span></span>'
        + '<span class="pk-ell">Settles ' + C.dayMonthShort(p.settles_at) + ' ' + MID + ' no open / now / close for outrights</span></div>';
    } else {
      right += trailHtml(p) + metaLine(p);
    }
    var body = '<div class="pk-body' + (settled ? ' is-settled' : '') + dim + '">'
      + '<div class="pk-players' + blur + '">' + players + '</div><span class="pk-div"></span>'
      + '<div class="pk-right' + blur + '">' + right + '</div></div>';
    var note = open ? '<div class="pk-note' + dim + '">' + esc(noteText(p)) + '</div>' : '';
    return '<div class="pk-card' + (p.status === 'lost' ? ' is-lost' : '') + (routed ? ' is-routed' : '') + '" data-card="' + esc(p.id) + '">'
      + head + body + note + footHtml(p, gated, open) + '</div>';
  }

  // ── the mobile card (SPEC §9, board 1j) ────────────────────────────────────────────────────────────────────────
  function mcard(p) {
    var outright = C.isOutright(p), gated = gatedOf(p), open = !gated && !!S.noteOpen[p.id], blur = gated ? ' is-blur' : '';
    var dim = p.status === 'lost' || p.status === 'void' ? ' is-dim' : '';
    var pl = C.plText(p), plOf = p.status === 'void' ? 0 : C.plOf(p);
    var head = '<div class="pk-hd pk-hd--m">'
      + (outright ? '' : '<span class="pk-surf">' + esc(p.surface || DASH) + '</span>')
      + '<span class="pk-tourn">' + esc(outright ? p.event : p.tournament) + '</span>'
      + (outright ? '' : '<span class="pk-round">' + esc(p.round || DASH) + '</span><span class="pk-time">' + C.hhmm(p.scheduled_at) + '</span>')
      + '<span class="pk-hd-r">' + (pl ? '<span class="pk-pl-v ' + sgnCls(plOf) + '">' + pl + '</span>' : '') + chip(p) + '</span></div>';
    var players = outright ? playerRow(p, 'a', { outright: true }) : playerRow(p, 'a', {}) + playerRow(p, 'b', {});
    var panel = betLineHtml(p) + (outright
      ? '<div class="pk-or"><span>Posted ' + C.hhmm(p.posted_at) + ' ' + MID + ' bet105 ' + MID + ' Stake <span class="pk-mono pk-w pk-b7">' + esc(C.stakeText(p.stake)) + '</span></span><span class="pk-ell">Settles ' + C.dayMonthShort(p.settles_at) + ' ' + MID + ' no open / now / close for outrights</span></div>'
      : trailHtml(p, true) + metaLine(p));
    var note = open ? '<div class="pk-note pk-note--m' + dim + '">' + esc(noteText(p)) + '</div>' : '';
    return '<div class="pk-card pk-card--m' + (p.status === 'lost' ? ' is-lost' : '') + '" data-card="' + esc(p.id) + '">' + head
      + '<div class="pk-mplayers' + blur + dim + '">' + players + '</div>'
      + '<div class="pk-mpanel' + blur + dim + '">' + panel + '</div>' + note + footHtml(p, gated, open, open ? ' pk-foot--m' : ' pk-foot--m is-closed') + '</div>';
  }

  // ── bets box (SPEC §4) ─────────────────────────────────────────────────────────────────────────────────────────
  function betsBox(list) {
    var b = C.betsBox(list, S.tab, S.day, today()); if (!b.show) return '';
    var settled = S.tab === 'completed';
    var rowsH = list.map(function (p, i) {
      var g = gatedOf(p) ? ' is-blur' : '';
      return '<div class="pk-bx-row' + (settled ? ' is-settled' : '') + (i === list.length - 1 ? ' is-last' : '') + '">' + typeTag(p)
        + '<span class="pk-bx-bet"><span class="pk-bx-line' + g + '">' + esc(C.betLine(p)) + '</span>'
        + '<span class="pk-bx-sub"><span class="pk-mono">' + C.hhmm(p.posted_at) + '</span> ' + MID + ' ' + esc(C.whereText(p)) + '</span></span>'
        + '<span class="pk-bx-price' + g + '">' + C.f2(p.posted_price) + '</span>'
        + '<span class="pk-bx-stake">' + esc(C.stakeText(p.stake)) + '</span>'
        + (settled ? '<span class="pk-bx-res">' + chip(p) + '</span>' : '') + '</div>';
    }).join('');
    return '<div class="pk-box"><div class="pk-box-hd"><span class="pk-caps">' + esc(b.title) + '</span><span class="pk-box-meta">' + esc(b.meta) + '</span></div>'
      + (settled ? '<div class="pk-bx-heads"><span>Type</span><span>Bet</span><span class="r">Price</span><span class="r">Stake</span><span class="r">Result</span></div>' : '')
      + rowsH + '</div>';
  }

  // ── header + Record strip (SPEC §2) ────────────────────────────────────────────────────────────────────────────
  function header() {
    var rec = C.record(rows(), S.period, today());
    var seg = Object.keys(C.PERIODS).map(function (k) {
      return '<button type="button" class="pk-per' + (S.period === k ? ' on' : '') + '" data-act="period" data-k="' + k + '" title="' + esc(C.PERIODS[k].hover) + '">' + esc(C.PERIODS[k].label) + '</button>';
    }).join('');
    var stats = rec.stats.map(function (s) {
      return '<div class="sfh__stat"><span class="sfh__l">' + esc(s.label) + '</span><span class="sfh__v pk-rv pk-s-' + (s.kind === 'plain' ? 'plain' : s.kind) + '">' + esc(s.value) + '</span></div>';
    }).join('');
    return '<div class="sfh pk-head"><div class="sfh__text"><h1 class="sfh__title">Picks</h1>'
      + '<p class="sfh__sub">Hand-picked daily from the Stennisfy model and strategy.</p></div>'
      + '<div class="pk-rec"><div class="pk-pers" role="tablist" aria-label="Record period">' + seg + '</div>'
      + '<div class="pk-recstats" data-act="record" title="Open the record" role="button" tabindex="0">' + stats
      + '<div class="sfh__stat"><span class="sfh__l">Settled</span><span class="sfh__v pk-rv pk-settled' + (rec.thin ? ' is-thin' : '') + '">' + esc(rec.settledText)
      + ' <span class="pk-gt">›</span></span></div></div></div></div>';
  }

  // ── controls (SPEC §3) — the landed Today's Matches shell grammar ──────────────────────────────────────────────
  function stripDays() {
    var t = today(), lo = C.addDays(t, -2), hi = C.addDays(t, 1);
    if (S.day < lo) lo = S.day; else if (S.day > hi) lo = C.addDays(S.day, -3);
    return [0, 1, 2, 3].map(function (i) { return C.addDays(lo, i); });
  }
  function tournaments() {
    var set = {};
    C.picksFor(rows(), S.tab, S.day).forEach(function (p) { var n = C.isOutright(p) ? p.event : p.tournament; if (n) set[n] = 1; });
    return Object.keys(set).sort();
  }
  function controls() {
    var t = today();
    var tabs = [['upcoming', 'Upcoming'], ['completed', 'Completed']].map(function (x) {
      return '<button type="button" role="tab" class="pk-tab' + (S.tab === x[0] ? ' on' : '') + '" aria-selected="' + (S.tab === x[0]) + '" data-act="tab" data-k="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    var days = stripDays().map(function (d) {
      return '<button type="button" class="pk-day' + (d === S.day ? ' on' : '') + '" data-act="day" data-k="' + d + '">' + (d === t ? 'Today' : esc(C.dayLabel(d))) + '</button>';
    }).join('');
    var ts = tournaments(), menu = '';
    if (S.tournOpen) {
      menu = '<div class="pk-tmenu" role="listbox">' + ['All tournaments'].concat(ts).map(function (n, i) {
        var on = i === 0 ? !S.tourn : S.tourn === n;
        return '<button type="button" class="pk-topt' + (on ? ' on' : '') + '" data-act="tsel" data-k="' + (i === 0 ? '' : esc(n)) + '">' + esc(n) + '</button>';
      }).join('') + '</div>';
    }
    return '<div class="pk-row1"><div class="pk-tabs" role="tablist" aria-label="Picks view">' + tabs + '</div>'
      + '<button type="button" class="pk-chev" data-act="prev" aria-label="Previous day">‹</button>'
      + '<div class="pk-days">' + days + '</div>'
      + '<button type="button" class="pk-chev" data-act="next" aria-label="Next day">›</button></div>'
      + '<div class="pk-row2"><span class="pk-tdd"><button type="button" class="pk-tpill' + (S.tourn ? ' on' : '') + '" data-act="tourn" aria-haspopup="listbox">' + esc(S.tourn || 'All tournaments') + '</button>' + menu + '</span>'
      + '<label class="pk-search"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.6"></circle><path d="M13.5 13.5 17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>'
      + '<input type="search" id="pkSearch" placeholder="Search for a player…" value="' + esc(S.q) + '" autocomplete="off"></label></div>';
  }

  // ── Record view (SPEC §7) ──────────────────────────────────────────────────────────────────────────────────────
  var COLS = [['date', 'Date', ''], ['match', 'Match', ''], ['pick', 'Pick', ''], ['posted', 'Posted', 'r'], ['close', 'Close', 'r'], ['clv', 'CLV', 'r'], ['result', 'Result', ''], ['pl', 'P/L', 'r']];
  function recordView() {
    var rec = C.record(rows(), S.period, today());
    var led = C.sortLedger(rec.rows.map(C.ledgerRow), S.sort.key, S.sort.dir);
    var heads = COLS.map(function (c) {
      var on = S.sort.key === c[0];
      return '<span class="pk-lh' + (c[2] ? ' r' : '') + (on ? ' on' : '') + '" data-act="sort" data-k="' + c[0] + '">' + c[1] + '<span class="pk-arrow">' + (on ? (S.sort.dir < 0 ? '▼' : '▲') : '') + '</span></span>';
    }).join('');
    var body = led.map(function (r) {
      var mark = r.status === 'won' ? 'is-w' : r.status === 'lost' ? 'is-l' : 'is-v';
      return '<div class="pk-lr"><span class="pk-ld">' + esc(r.dateText) + '</span>'
        + '<span class="pk-l2"><span class="pk-lm">' + esc(r.match) + '</span><span class="pk-lsub">' + esc(r.event) + '</span></span>'
        + '<span class="pk-l2"><span class="pk-lp">' + esc(r.pick) + '</span><span class="pk-lsub">' + esc(r.market) + '</span></span>'
        + '<span class="pk-lpost r">' + C.f2(r.posted) + '</span><span class="pk-lclose r">' + C.f2(r.close) + '</span>'
        + '<span class="pk-lclv r ' + (r.clv == null ? 'pk-s-zero' : sgnCls(r.clv)) + '">' + C.pct(r.clv) + '</span>'
        + '<span class="pk-lres"><span class="pk-sq ' + mark + '"></span><span class="pk-lrt">' + esc(r.result) + '</span></span>'
        + '<span class="pk-lpl r ' + sgnCls(r.pl) + '">' + C.u(r.pl) + '</span></div>';
    }).join('');
    // Totals repeat the strip: a thin period shows dashes there too, with the count.
    var thin = rec.thin;
    var total = '<div class="pk-lt"><span class="pk-caps">Total</span><span class="pk-lt-n">' + rec.n + ' settled ' + MID + ' ' + esc(rec.title) + '</span><span></span><span></span><span></span>'
      + '<span class="pk-lclv r ' + (thin || rec.avgClv == null ? 'pk-s-zero' : sgnCls(rec.avgClv)) + '">' + (thin ? DASH : C.pct(rec.avgClv)) + '</span>'
      + '<span class="pk-lt-wl">' + (thin ? DASH : rec.w + C.EN + rec.l + ' ' + MID + ' ROI ' + C.pct(rec.roi)) + '</span>'
      + '<span class="pk-lt-pl r ' + (thin ? 'pk-s-zero' : sgnCls(rec.profit)) + '">' + (thin ? DASH : C.u(rec.profit, 1)) + '</span></div>';
    return '<div class="pk-rtop"><span class="pk-back" data-act="back" role="button" tabindex="0">‹ Back to picks</span>'
      + '<span class="pk-rmeta">' + esc(rec.title) + ' ' + MID + ' settled picks only ' + MID + ' <span class="pk-mono">' + rec.n + '</span> rows</span></div>'
      + '<div class="pk-ledger"><div class="pk-lhead">' + heads + '</div>' + body + total + '</div>';
  }

  function emptyPanel(e) {
    return '<div class="pk-empty"><span class="pk-empty-t">' + esc(e.title) + '</span>' + (e.sub ? '<span class="pk-empty-s">' + esc(e.sub) + '</span>' : '') + '</div>';
  }

  function render() {
    var el = root(); if (!el) return;
    if (!S.data) {
      el.innerHTML = S.failed ? header() + emptyPanel({ title: 'Picks could not be loaded.', sub: '' }) : '';
      return;
    }
    if (S.view === 'record') { el.innerHTML = header() + recordView(); return; }
    var list = C.picksFor(rows(), S.tab, S.day);
    var all = list.length;
    if (S.tourn) list = list.filter(function (p) { return (C.isOutright(p) ? p.event : p.tournament) === S.tourn; });
    if (S.q) {
      var q = fold(S.q);
      list = list.filter(function (p) { return [p.player_a, p.player_b].some(function (x) { return x && fold(x.name).indexOf(q) >= 0; }); });
    }
    var t = today(), main;
    if (!all) main = emptyPanel(C.emptyState(S.tab, S.day, t));
    else if (!list.length) main = emptyPanel({ title: 'No bets match this filter.', sub: '' });
    else main = betsBox(list) + '<div class="pk-grid">' + list.map(mobile() ? mcard : card).join('') + '</div>';
    var focus = document.activeElement && document.activeElement.id === 'pkSearch';
    el.innerHTML = header() + controls() + main;
    if (focus) { var i = document.getElementById('pkSearch'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  // ── events (one delegated handler) ─────────────────────────────────────────────────────────────────────────────
  function onClick(e) {
    var a = e.target.closest('[data-act]');
    var cardEl = e.target.closest('[data-card]');
    if (!a) {
      if (S.tournOpen && !e.target.closest('.pk-tdd')) { S.tournOpen = false; render(); }
      if (cardEl && !e.target.closest('[data-stop]')) openMatch(cardEl.getAttribute('data-card'));
      return;
    }
    var act = a.getAttribute('data-act'), k = a.getAttribute('data-k'), id = a.getAttribute('data-id');
    e.stopPropagation();
    if (act === 'note') S.noteOpen[id] = !S.noteOpen[id];
    else if (act === 'star') S.stars[id] = !S.stars[id];
    else if (act === 'open') { openMatch(id); return; }
    else if (act === 'tab') { S.tab = k; S.tournOpen = false; }                 // tab switch keeps tournament + date
    else if (act === 'day') { S.day = k; S.tournOpen = false; }
    else if (act === 'prev') S.day = C.addDays(S.day, -1);
    else if (act === 'next') S.day = C.addDays(S.day, 1);
    else if (act === 'period') S.period = k;
    else if (act === 'record') { S.view = 'record'; window.scrollTo(0, 0); }
    else if (act === 'back') S.view = 'cards';
    else if (act === 'sort') S.sort = C.nextSort(S.sort, k);
    else if (act === 'tourn') S.tournOpen = !S.tournOpen;
    else if (act === 'tsel') { S.tourn = k || null; S.tournOpen = false; }
    render();
  }
  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-act="record"],[data-act="back"]')) { e.preventDefault(); e.target.click(); }
  }
  function onInput(e) { if (e.target.id === 'pkSearch') { S.q = e.target.value; render(); } }

  var wired = false, active = false;
  function wire() {
    var el = root(); if (!el || wired) return;
    wired = true;
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('input', onInput);
    if (window.matchMedia) {
      var mq = window.matchMedia('(max-width: 640px)');
      var re = function () { if (active) render(); };
      if (mq.addEventListener) mq.addEventListener('change', re); else if (mq.addListener) mq.addListener(re);
    }
  }
  // The tournament menu is a layer: Esc closes it (the one Esc handler, esc-nav.js).
  (globalThis.sfEscLayers = globalThis.sfEscLayers || []).push({ id: 'picks-tournament-menu', z: 30,
    isOpen: function () { return active && S.tournOpen; }, close: function () { S.tournOpen = false; render(); } });

  function setActive(on) {
    active = !!on;
    if (!active) { S.tournOpen = false; return; }
    wire();
    if (S.data) render(); else load();
  }
  // #picks — the page's only entry until the nav link lands (Task 3). The tab page is shown without a nav button.
  function applyHash() {
    if (location.hash !== '#picks') return;
    if (typeof sfActivateTabRaw === 'function') sfActivateTabRaw('picks', '#picks');   // eslint-disable-line no-undef
    else {
      document.querySelectorAll('.tabpage').forEach(function (p) { p.classList.toggle('active', p.dataset.page === 'picks'); });
      setActive(true);
    }
  }
  window.PicksPage = { setActive: setActive, render: render, _state: S };
  window.addEventListener('hashchange', applyHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyHash); else applyHash();
})();
