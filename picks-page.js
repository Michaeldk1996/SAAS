/* picks-page.js — the Picks page, LOCKED 2026-10-30 (`design_handoff_picks`: CHANGES_2026-10-30 > SIDEBAR_NAV >
 * CHANGES_2026-10-29 > SPEC > README). Upcoming = one full-width band per open bet with today's numbers in the header;
 * Completed = the settled history ledger with the Record strip in the header; any band or ledger row opens the analysis
 * sheet; the Record view; the mobile card. Posting is only through "+ Post a pick" here (founder 2026-10-30, override 1).
 *
 * Reads the picks store (picks-store.js: Firestore `picks` / `picks_public`, access by firestore.rules) and renders it
 * with the figures from picks-core.js. Nothing here computes a number: every price, CLV, P/L and record figure comes
 * from PicksCore, or is a dash. Values = the export's inline styles (picks-page.css).
 *
 * Roles (founder 2026-10-27: real roles, no preview switch): the admin (isBspAdmin) sees everything and posts / edits;
 * a Pro member (window.sfPlan === 'pro') sees today's picks; any other member gets the teaser of today's picks (blurred
 * over placeholders — the real pick never reaches the browser) and every settled pick. Tests inject a fixture with
 * PicksPage._inject (tools/fixtures/picks-demo.json).
 */
(function () {
  'use strict';
  var C = window.PicksCore;
  if (!C) return;
  var DASH = C.DASH, MID = '·';
  var REFRESH_MS = 60000;   // the store is re-read while the page is open (the pipeline fills Now / Close / results)
  var HIST_PAGE_ROWS = 10;  // the Completed ledger pages by whole days, ~10 rows a page (reference, user 2026-10-30)

  var S = {
    fixture: null, byDay: {}, settled: null, failed: false, loading: {}, role: null,
    tab: 'upcoming', period: '30d', view: 'cards', sort: { key: 'date', dir: -1 }, stars: {}, sheet: null, histPage: 1
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function root() { return document.getElementById('picksRoot'); }
  function isAdmin() { return !S.fixture && !!(window.PicksStore && PicksStore.isAdmin()); }
  function isPro() { return window.sfPlan === 'pro' || isAdmin(); }
  function today() {
    if (S.fixture && S.fixture.as_of_day) return S.fixture.as_of_day;   // a fixture pins its own day
    return C.viewDay(new Date().toISOString());   // the member-zone day (founder 2026-10-30, override 2)
  }
  // A teaser row (a non-Pro member's view of today's pick) is drawn over placeholders, blurred: never the real pick.
  var HIDDEN = { id: null, name: 'Pick hidden', initials: '··' };
  function shown(p) {
    if (!p._teaser) return p;
    return Object.assign({}, p, { player_a: HIDDEN, player_b: p.kind === 'outright' ? null : HIDDEN, market_text: p.kind === 'outright' ? 'Pick hidden' : null });
  }
  function rows() {
    if (S.fixture) return S.fixture.picks || [];
    var seen = {}, out = [];
    Object.keys(S.byDay).forEach(function (d) { (S.byDay[d] || []).forEach(function (p) { if (!seen[p.id]) { seen[p.id] = 1; out.push(shown(p)); } }); });
    (S.settled || []).forEach(function (p) { if (!seen[p.id]) { seen[p.id] = 1; out.push(p); } });
    return out;
  }
  // Upcoming reads today and tomorrow in the member zone; the store is keyed by the Brussels `date`, so every stored day
  // either side is read and each pick is placed by C.pickDay. Completed reads the settled store.
  function days() { var t = today(), out = []; [t, C.addDays(t, 1)].forEach(function (d) { C.storedDaysAround(d).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); }); return out; }
  function loaded() { return !!S.fixture || (S.settled != null && days().every(function (d) { return S.byDay[d] != null; })); }
  function mobile() { return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches); }

  // the Record's widest window: Season (1 January) or 90 days back, whichever is earlier
  function settledFrom() { var t = today(), y = t.slice(0, 4) + '-01-01', d90 = C.addDays(t, -90); return y < d90 ? y : d90; }
  function load(force) {
    if (S.fixture || !window.PicksStore) { render(); return Promise.resolve(); }
    var jobs = [];
    days().forEach(function (day) {
      if (!force && S.byDay[day] != null) return;
      if (!S.loading[day]) S.loading[day] = PicksStore.loadDay(day).then(function (r) { S.byDay[day] = r.rows; S.role = r.role; })
        .catch(function () { S.failed = true; S.byDay[day] = S.byDay[day] || []; }).then(function () { delete S.loading[day]; });
      jobs.push(S.loading[day]);
    });
    if (force || S.settled == null) {
      if (!S.loading._settled) S.loading._settled = PicksStore.loadSettled(settledFrom()).then(function (r) { S.settled = r; })
        .catch(function () { S.failed = true; S.settled = S.settled || []; }).then(function () { delete S.loading._settled; });
      jobs.push(S.loading._settled);
    }
    return Promise.all(jobs).then(render);
  }
  function reload() { S.byDay = {}; S.settled = null; return load(true); }

  // ── match routing (SPEC §5.6): a card opens its match only when the board holds exactly that match — joined on BOTH
  // player ids and the day (never on surnames alone). The demo rows carry no player id, so they never route. ──────────
  function boardMatch(p) {
    if (!p || C.isOutright(p) || typeof matchById !== 'function' || typeof matches === 'undefined') return null;   // eslint-disable-line no-undef
    if (p.match_id != null) {
      var byKey = (matches || []).filter(function (m) { return m && /-(\d+)$/.test(String(m.id)) && String(m.id).match(/-(\d+)$/)[1] === String(p.match_id); });   // eslint-disable-line no-undef
      if (byKey.length === 1) return byKey[0];
    }
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

  // a teaser is always gated; a real open pick of today is gated for a non-Pro view (a fixture renders both states)
  function gatedOf(p) { return !!p._teaser || (!isPro() && (p.status === 'posted' || p.status === 'live') && C.pickDay(p) === today()); }

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
      + avHtml(q, 'pk-av' + (dim ? ' is-loser' : ''), gatedOf(p))
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
  // admin only: "Edit" on every pick at any time (founder 2026-10-30, research and development — replaces board 1i's
  // ten-minute countdown link): note + stake, void, or delete, in the drawer
  function editLink(p) {
    if (!isAdmin() || !p || p._teaser) return '';
    return '<span class="pk-edit" data-act="edit" data-id="' + esc(p.id) + '" data-stop="1">Edit</span>';
  }
  // a player's circle: the monogram, with his ATP photo over it when the pick carries his player ID (player-photos.md:
  // one resolver, by ID, never by name). A gated card never carries a photo: under the blur it would name the pick.
  function avHtml(q, cls, gated) {
    var ph = !gated && q && q.id != null && q.id !== '' && typeof window.playerPhotoImg === 'function' ? window.playerPhotoImg(q.id, q.name) : '';
    return '<span class="' + cls + '">' + esc((q && q.initials) || '') + ph + '</span>';
  }
  function footHtml(p, gated, open, pad) {
    var left = gated
      ? '<span class="pk-unlock">' + PRO + '<a class="pk-link" href="account.html" data-stop="1">Unlock today’s picks →</a></span>'
      : '<span class="pk-foot-l"><span class="pk-toggle" data-act="sheet" data-id="' + esc(p.id) + '">Read the analysis <span class="pk-tchev">▾</span></span>' + editLink(p) + '</span>';
    var routed = !!boardMatch(p);
    return '<div class="pk-foot' + (pad || '') + '">' + left + '<span class="pk-link pk-openmatch' + (routed ? '' : ' is-inert') + '"'
      + (routed ? ' data-act="open" data-id="' + esc(p.id) + '"' : ' title="This match is not on the board"') + '>Open match →</span></div>';
  }

  // ── Upcoming band (CHANGES 10-30 §1, "2a Quiet ink") ────────────────────────────────────────────────────────────
  // star + type tag · players · | · bet · stake · | · trail (or outright two-liner / PRO unlock when gated) · | · CLV
  function bandPlayer(p, side) {
    var q = side === 'a' ? p.player_a : p.player_b; if (!q) return '';
    var picked = p.selection === side, fav = !C.isOutright(p) && C.favSide(p) === side, lt = picked ? C.lineTag(p) : '';
    return '<div class="pk-bp"><span class="pk-bp-bar' + (picked ? ' is-on' : '') + '"></span>' + avHtml(q, 'pk-bp-av' + (picked ? ' is-on' : ''), gatedOf(p))
      + '<span class="pk-bp-n' + (picked ? ' is-on' : '') + '" data-stop="1">' + esc(q.name) + '</span>'
      + (fav ? '<span class="pk-fav">FAV</span>' : '') + (lt ? '<span class="pk-line">' + esc(lt) + '</span>' : '') + '</div>';
  }
  function bandTrail(p) {
    var t = C.trail(p, true); if (!t) return '';
    var seg = function (c) { return '<span class="pk-bt-seg" style="background:' + c + '"></span>'; };
    return '<div class="pk-bt"><span class="pk-bt-open">' + C.f2(t.open) + '</span>' + seg(t.segs[0])
      + '<span class="pk-bt-posted">' + C.f2(t.posted) + '</span>' + seg(t.segs[1])
      + '<span class="pk-bt-now">' + C.f2(t.now) + '</span>' + seg(t.segs[2])
      + '<span class="pk-bt-close" style="color:' + (t.close == null ? 'var(--text-label)' : t.segs[2]) + '">' + C.f2(t.close) + '</span>'
      + '<span class="pk-bt-l" style="grid-column:1">Open</span><span class="pk-bt-l" style="grid-column:3">Posted</span>'
      + '<span class="pk-bt-l" style="grid-column:5">' + esc(t.nowLabel) + '</span><span class="pk-bt-l" style="grid-column:7">Close</span></div>';
  }
  // dayWord: the pick's day ("Today", "Tue 28") when the open bets span more than one day, else '' (board 1a `where`)
  function band(p, dayWord) {
    var gated = gatedOf(p), outright = C.isOutright(p), blur = gated ? ' is-blur' : '', clv = C.clvOf(p);
    var where = (dayWord ? dayWord + ' ' + MID + ' ' : '') + (outright ? (p.event || DASH) : C.whereText(p));
    var trail = gated
      ? '<span class="pk-unlock pk-unlock--band">' + PRO + '<a class="pk-link" href="account.html" data-stop="1">Unlock today’s picks →</a></span>'
      : outright ? '<div class="pk-bor"><span class="pk-bor-t">Open position</span><span class="pk-bor-s">Settles ' + esc(C.dayMonthShort(p.settles_at)) + ' ' + MID + ' no open / now / close for outrights</span></div>'
      : bandTrail(p);
    return '<div class="pk-band' + (gated ? ' is-gated' : '') + '"' + (gated ? '' : ' data-sheet="' + esc(p.id) + '" role="button" tabindex="0"') + '>'
      + '<span class="pk-b1"><span class="pk-star' + (S.stars[p.id] ? ' is-on' : '') + '" data-act="star" data-id="' + esc(p.id) + '" title="Favourite">' + STAR + '</span>' + typeTag(p) + '</span>'
      + '<div class="pk-b2' + blur + '">' + bandPlayer(p, 'a') + (outright ? '' : bandPlayer(p, 'b')) + '</div><span class="pk-brule"></span>'
      + '<div class="pk-b3"><div class="pk-b3-l' + blur + '"><span class="pk-b3-t">' + esc(C.betLine(p)) + '</span><span class="pk-at">@</span>'
      + '<span class="pk-b3-p">' + C.f2(p.posted_price) + '</span><span class="pk-bk">' + esc(p.book || 'bet105') + '</span></div>'
      + '<span class="pk-b3-s"><span class="pk-mono">posted ' + C.hhmm(p.posted_at) + '</span> ' + MID + ' ' + esc(where) + '</span></div>'
      + '<div class="pk-b4"><span class="pk-bcap">Stake</span><span class="pk-b4-v">' + esc(C.stakeText(p.stake)) + '</span></div><span class="pk-brule"></span>'
      + '<div class="pk-b5">' + trail + '</div><span class="pk-brule"></span>'
      + '<div class="pk-b6"><span class="pk-bcap">CLV</span><span class="pk-b6-v ' + (clv == null ? 'pk-s-zero' : sgnCls(clv)) + '">' + C.pct(clv) + '</span></div></div>';
  }
  function upcomingView(list) {
    var t = today(), byDay = {};
    list.forEach(function (p) { var d = C.pickDay(p); (byDay[d] = byDay[d] || []).push(p); });
    var ds = Object.keys(byDay).sort(), many = ds.length > 1;
    if (mobile()) return '<div class="pk-mlist">' + list.map(mcard).join('') + '</div>';
    // ONE group, as board 1a draws it (6 open bets over Today and Tue 28 under "Open · 6 bets"): today first, then the
    // coming days; when the bets span more than one day each band's second line names its day (the reference's
    // `where`). CHANGES_2026-10-30 §1 says the per-day heads are "unchanged"; the board outranks it (PROMPT order).
    var n = list.length, ordered = [];
    ds.forEach(function (d) { ordered = ordered.concat(byDay[d]); });
    var dayWord = function (p) { if (!many) return ''; var d = C.pickDay(p); return d === t ? 'Today' : C.dayLabel(d); };
    return '<div class="pk-bands"><div class="pk-bands-hd"><span class="pk-caps">Open ' + MID + ' ' + n + (n === 1 ? ' bet' : ' bets') + '</span>'
      + '<span class="pk-bands-m">all at bet105 ' + MID + ' click a bet for the analysis</span></div>'
      + ordered.map(function (p) { return band(p, dayWord(p)); }).join('') + '</div>';
  }

  // ── Completed · history ledger (CHANGES 10-29 §5) ───────────────────────────────────────────────────────────────
  function resultChip(p) { var c = C.statusChip(p); return '<span class="pk-rchip pk-chip--' + c.kind + '">' + esc(c.text) + '</span>'; }
  function histRow(p) {
    var clv = C.clvOf(p), pl = p.status === 'void' ? 0 : C.plOf(p);
    return '<div class="pk-hr" data-sheet="' + esc(p.id) + '" role="button" tabindex="0">' + typeTag(p)
      + '<span class="pk-hr-bet"><span class="pk-hr-t">' + esc(C.betLine(p)) + '</span><span class="pk-hr-s"><span class="pk-mono">' + C.hhmm(p.posted_at) + '</span> ' + MID + ' ' + esc(C.whereText(p)) + '</span></span>'
      + '<span class="pk-hr-posted">' + C.f2(p.posted_price) + '</span><span class="pk-hr-close">' + C.f2(C.closeOf(p)) + '</span>'
      + '<span class="pk-hr-clv ' + (clv == null ? 'pk-s-zero' : sgnCls(clv)) + '">' + C.pct(clv) + '</span>'
      + '<span class="pk-hr-stake">' + esc(C.stakeText(p.stake)) + '</span>'
      + '<span class="pk-hr-pl ' + sgnCls(pl) + '">' + esc(C.plText(p) || DASH) + '</span>' + resultChip(p) + '<span class="pk-hr-gt">›</span></div>';
  }
  function completedView(list) {
    if (!list.length) return emptyPanel({ title: 'No bets settled in the last 30 days.', sub: '' });
    var w = list.filter(function (p) { return p.status === 'won'; }).length, l = list.filter(function (p) { return p.status === 'lost'; }).length;
    var pl = list.reduce(function (a, p) { var x = C.plOf(p); return a + (x || 0); }, 0);
    var withC = list.map(C.clvOf).filter(function (x) { return x != null; });
    var avg = withC.length ? withC.reduce(function (a, x) { return a + x; }, 0) / withC.length : null;
    var byDay = [], idx = {};
    list.forEach(function (p) { var d = C.pickDay(p); if (idx[d] == null) { idx[d] = byDay.length; byDay.push([]); } byDay[idx[d]].push(p); });
    // whole days, ~HIST_PAGE_ROWS rows a page
    var pages = [], cur = [], n = 0;
    byDay.forEach(function (ps) { if (cur.length && n >= HIST_PAGE_ROWS) { pages.push(cur); cur = []; n = 0; } cur.push(ps); n += ps.length; });
    if (cur.length) pages.push(cur);
    var pg = Math.min(Math.max(1, S.histPage), pages.length);
    var body = (pages[pg - 1] || []).map(function (ps) {
      var dw = ps.filter(function (p) { return p.status === 'won'; }).length, dl = ps.filter(function (p) { return p.status === 'lost'; }).length;
      var dv = ps.filter(function (p) { return p.status === 'void'; }).length, dpl = ps.reduce(function (a, p) { return a + (C.plOf(p) || 0); }, 0);
      return '<div class="pk-hday"><span class="pk-hday-d">' + esc(C.dayLabel(C.pickDay(ps[0]))) + '</span><span class="pk-hday-m">' + ps.length + (ps.length === 1 ? ' bet' : ' bets') + ' ' + MID + ' ' + dw + C.EN + dl + (dv ? ' ' + MID + ' ' + dv + ' void' : '') + '</span>'
        + '<span class="pk-hday-pl ' + sgnCls(dpl) + '">' + C.u(dpl, 1) + '</span></div>' + ps.map(histRow).join('');
    }).join('');
    var pager = pages.length > 1 ? '<div class="pk-pager"><span class="pk-pg' + (pg > 1 ? '' : ' is-off') + '" data-act="hprev">‹ Previous</span><span class="pk-pg-t">Page ' + pg + ' of ' + pages.length + '</span>'
      + '<span class="pk-pg' + (pg < pages.length ? '' : ' is-off') + '" data-act="hnext">Next ›</span></div>' : '';
    return '<div class="pk-hist"><div class="pk-hist-hd"><span class="pk-caps">Settled ' + MID + ' last 30 days ' + MID + ' ' + list.length + (list.length === 1 ? ' bet' : ' bets') + '</span>'
      + '<span class="pk-hist-m">' + w + C.EN + l + ' ' + MID + ' ' + C.u(pl, 1) + ' ' + MID + ' CLV ' + C.pct(avg) + '</span></div>'
      + '<div class="pk-hh"><span>Type</span><span>Bet</span><span class="r">Posted</span><span class="r">Close</span><span class="r">CLV</span><span class="r">Stake</span><span class="r">P/L</span><span class="r">Result</span><span></span></div>'
      + body + pager + '<div class="pk-hist-ft">Click a bet to open it: score, open → posted → close, CLV and the analysis. Older than 30 days: the Record ledger (header).</div></div>';
  }

  // ── analysis sheet (CHANGES 10-29 §4 + 10-30 §3) ────────────────────────────────────────────────────────────────
  function stop(label, val, cls) { return '<div class="pk-sh-st' + (cls || '') + '"><span class="pk-sh-l">' + label + '</span>' + val + '</div>'; }
  function tile(label, val, cls) { return '<div class="pk-sh-tile"><span class="pk-sh-tl">' + label + '</span><span class="pk-sh-tv' + (cls ? ' ' + cls : '') + '">' + val + '</span></div>'; }
  // the analysis sheet's photo is the backed player's (founder 2026-10-30); a totals / outright pick backs player a
  function pickedPlayer(p) { return (p.selection === 'b' ? p.player_b : p.player_a) || null; }
  function sheetHtml(p) {
    if (!p) return '';
    var outright = C.isOutright(p), settled = C.isSettled(p), clv = C.clvOf(p), mf = C.modelFair(p.model_pct);
    var modelBlur = !isPro() && !settled ? ' is-blur' : '', t = C.trail(p, true);
    var chipC = C.statusChip(p);
    var headRow = typeTag(p) + (outright ? '' : '<span class="pk-sh-surf">' + esc(p.surface || DASH) + '</span>')
      + '<span class="pk-sh-tourn">' + esc(outright ? p.event : p.tournament) + '</span>'
      + (outright ? '' : '<span class="pk-round">' + esc(p.round || DASH) + '</span><span class="pk-sh-time">' + C.hhmm(p.scheduled_at) + '</span>')
      + '<span class="pk-sh-r">' + editLink(p) + '<span class="pk-rchip pk-chip--' + chipC.kind + (settled ? '' : ' is-posted') + '">' + esc(chipC.text) + '</span><span class="pk-sh-x" data-act="sheetclose" title="Close">×</span></span>';
    var meta = '<span>Posted ' + C.hhmm(p.posted_at) + ' ' + MID + ' ' + esc(C.whereText(p)) + '</span>'
      + '<span>Stake <span class="pk-sh-mv">' + esc(C.stakeText(p.stake)) + '</span></span>'
      + '<span>Stennisfy <span class="pk-sh-mv' + modelBlur + '">' + C.f2(mf) + '</span></span>'
      + (t ? '<span>CLV <span class="pk-sh-mv ' + (clv == null ? 'pk-s-zero' : sgnCls(clv)) + '">' + C.pct(clv) + '</span></span>' : '');
    var block = '';
    if (settled && !outright) {
      var pl = p.status === 'void' ? 0 : C.plOf(p), win = C.winnerSide(p);
      var players = ['a', 'b'].map(function (side) {
        var q = side === 'a' ? p.player_a : p.player_b; if (!q) return '';
        var picked = p.selection === side, sc = C.scoreSide(p, side), isW = win === side;
        var bar = picked ? (p.status === 'won' ? 'is-w' : p.status === 'lost' ? 'is-l' : '') : '';
        var sets = sc ? '<span class="pk-sh-sets"><span class="pk-sh-sw' + (isW ? ' is-win' : '') + '">' + sc.setsWon + '</span><span class="pk-sh-rule"></span>'
          + sc.cells.map(function (c) { return '<span class="pk-sh-set' + (c.won ? ' is-won' : '') + '">' + esc(c.v) + (c.tb ? '<sup>' + esc(c.tb) + '</sup>' : '') + '</span>'; }).join('') + '</span>' : '';
        return '<div class="pk-sh-pl"><span class="pk-sh-bar ' + bar + '"></span><span class="pk-sh-pn' + (isW ? ' is-win' : '') + '">' + esc(q.name) + '</span>' + sets + '</div>';
      }).join('');
      var tr = t ? '<div class="pk-sh-trail">' + stop('Open', '<span class="pk-sh-o">' + C.f2(t.open) + '</span>') + '<span class="pk-sh-seg" style="background:' + t.segs[0] + '"></span>'
        + stop('Posted', '<span class="pk-sh-p16">' + C.f2(t.posted) + '</span>', ' is-c') + '<span class="pk-sh-seg" style="background:' + C.trailColour(t.posted, t.close) + '"></span>'
        + stop('Close', '<span class="pk-sh-c" style="color:' + (t.close == null ? 'var(--text-label)' : C.trailColour(t.posted, t.close)) + '">' + C.f2(t.close) + '</span>', ' is-r') + '</div>' : '';
      block = '<div class="pk-sh-set-blk"><div class="pk-sh-res"><span class="pk-sh-cap">Result</span>' + players + '</div>'
        + '<div class="pk-sh-right">' + tr + '<div class="pk-sh-tiles pk-sh-tiles--4">' + tile('CLV', C.pct(clv), clv == null ? 'pk-s-zero' : sgnCls(clv))
        + tile('Stennisfy', C.f2(mf)) + tile('Stake', esc(C.stakeText(p.stake))) + tile('P/L', esc(C.plText(p) || DASH), sgnCls(pl)) + '</div></div></div>';
    } else if (!settled && t) {
      block = '<div class="pk-sh-live"><div class="pk-sh-pr"><span class="pk-sh-cap">Price ' + MID + ' bet105</span><div class="pk-sh-trail">'
        + stop('Open', '<span class="pk-sh-o">' + C.f2(t.open) + '</span>') + '<span class="pk-sh-seg" style="background:' + t.segs[0] + '"></span>'
        + stop('Posted', '<span class="pk-sh-p14">' + C.f2(t.posted) + '</span>', ' is-c') + '<span class="pk-sh-seg" style="background:' + t.segs[1] + '"></span>'
        + stop(esc(t.nowLabel), '<span class="pk-sh-p16">' + C.f2(t.now) + '</span>', ' is-c') + '<span class="pk-sh-seg" style="background:' + t.segs[2] + '"></span>'
        + stop('Close', '<span class="pk-sh-c" style="color:' + (t.close == null ? 'var(--text-label)' : t.segs[2]) + '">' + C.f2(t.close) + '</span>', ' is-r') + '</div></div>'
        + '<div class="pk-sh-tiles pk-sh-tiles--3">' + tile('CLV', C.pct(clv), clv == null ? 'pk-s-zero' : sgnCls(clv))
        + tile('Stennisfy', C.f2(mf), modelBlur.trim()) + tile('Stake', esc(C.stakeText(p.stake))) + '</div></div>';
    }
    var note = noteText(p);
    var analysis = (block ? '<div class="pk-sh-acap">Analysis</div>' : '')
      + '<div class="pk-sh-note' + (block ? '' : ' is-top') + '">' + esc(note || 'No analysis stored for this pick.') + '</div>';
    return '<div class="pk-sh-ov" data-act="sheetclose"><div class="pk-sh" role="dialog" aria-modal="true" aria-label="Analysis" data-stop="1">'
      + '<div class="pk-sh-hd"><div class="pk-sh-row1">' + headRow + '</div><div class="pk-sh-betrow">' + avHtml(pickedPlayer(p), 'pk-sh-av') + '<div class="pk-sh-bet">' + esc(C.betLine(p)) + '</div></div><div class="pk-sh-meta">' + meta + '</div></div>'
      + '<div class="pk-sh-body">' + block + analysis + '</div></div></div>';
  }
  function openSheet(id) {
    var p = rows().find(function (x) { return x.id === id; });
    if (!p || gatedOf(p)) return;
    S.sheet = id; render();
  }

  // ── header (CHANGES 10-30 §2): Upcoming = today's numbers; Completed / Record = the Record strip ────────────────
  function header(list) {
    var right;
    if (S.tab === 'upcoming' && S.view !== 'record') {
      var todays = list.filter(function (p) { return C.pickDay(p) === today(); });
      right = '<div class="pk-tstats">' + C.todayStats(todays).map(function (s) {
        return '<div class="sfh__stat"><span class="sfh__l">' + esc(s.label) + '</span><span class="sfh__v pk-tv pk-tv--' + s.kind + '">' + esc(s.value) + '</span></div>';
      }).join('') + '</div>';
    } else {
      var rec = C.record(rows(), S.period, today());
      var seg = Object.keys(C.PERIODS).map(function (k) {
        return '<button type="button" class="pk-per' + (S.period === k ? ' on' : '') + '" data-act="period" data-k="' + k + '" title="' + esc(C.PERIODS[k].hover) + '">' + esc(C.PERIODS[k].label) + '</button>';
      }).join('');
      var stats = rec.stats.map(function (s) {
        return '<div class="sfh__stat"><span class="sfh__l">' + esc(s.label) + '</span><span class="sfh__v pk-rv pk-s-' + (s.kind === 'plain' ? 'plain' : s.kind) + '">' + esc(s.value) + '</span></div>';
      }).join('');
      right = '<div class="pk-rec"><div class="pk-pers" role="tablist" aria-label="Record period">' + seg + '</div>'
        + '<div class="pk-recstats" data-act="record" title="Open the record" role="button" tabindex="0">' + stats
        + '<div class="sfh__stat"><span class="sfh__l">Settled</span><span class="sfh__v pk-rv pk-settled' + (rec.thin ? ' is-thin' : '') + '">' + esc(rec.settledText)
        + ' <span class="pk-gt">›</span></span></div></div></div>';
    }
    return '<div class="sfh pk-head"><div class="sfh__text"><h1 class="sfh__title">Picks</h1>'
      + '<p class="sfh__sub">Hand-picked daily from the Stennisfy model and strategy.</p></div>' + right + '</div>';
  }

  // ── controls (CHANGES 10-29 §1): two tabs + sub, "+ Post a pick" right (admin) ─────────────────────────────────
  function controls(list) {
    var tabs = [['upcoming', 'Upcoming'], ['completed', 'Completed']].map(function (x) {
      return '<button type="button" role="tab" class="pk-tab' + (S.tab === x[0] ? ' on' : '') + '" aria-selected="' + (S.tab === x[0]) + '" data-act="tab" data-k="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    var nd = {}; list.forEach(function (p) { nd[C.pickDay(p)] = 1; });
    var k = Object.keys(nd).length;
    var sub = S.tab === 'upcoming' ? (k > 1 ? 'Today and the next ' + (k - 1) + (k - 1 === 1 ? ' day' : ' days') : 'Today') : '';
    return '<div class="pk-ctrl"><div class="pk-tabs" role="tablist">' + tabs + '</div>' + (sub ? '<span class="pk-tsub">' + esc(sub) + '</span>' : '')
      + '<span class="pk-flex"></span>' + postBtn() + '</div>';
  }
  // Founder 2026-10-28/30: the admin posts ONLY from the Picks page (the match-card / analysis-header "+ Pick" is gone).
  // Admin only, by the store's role (not isAdmin(), which a demo fixture turns off for editing its fake rows).
  function postBtn() {
    if (!(window.PicksStore && PicksStore.isAdmin())) return '';
    return '<button type="button" class="pk-post" data-act="post" title="Post a pick"><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>Post a pick</button>';
  }

  // ── the mobile card (SPEC §9, board 1j) ────────────────────────────────────────────────────────────────────────
  function mcard(p) {
    var outright = C.isOutright(p), gated = gatedOf(p), open = false, blur = gated ? ' is-blur' : '';
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

  var shownPlan = null;   // the plan the page was last drawn for (see the sfPlanLocks wrap below)
  function render() {
    var el = root(); if (!el) return;
    shownPlan = window.sfPlan || null;
    var page = '<div class="pk-page">';
    if (!loaded()) {
      el.innerHTML = page + (S.failed ? header([]) + emptyPanel({ title: 'Picks could not be loaded.', sub: '' }) : '') + '</div>';
      return;
    }
    var t = today(), up = C.upcoming(rows(), t), main;
    if (S.view === 'record') main = recordView();
    else if (S.tab === 'upcoming') main = controls(up) + (up.length ? upcomingView(up) : emptyPanel(C.emptyState('upcoming', t, t)));
    else main = controls(up) + completedView(C.history(rows(), t));
    var sheet = S.sheet ? sheetHtml(rows().find(function (x) { return x.id === S.sheet; })) : '';
    el.innerHTML = page + header(up) + main + '</div>' + sheet;
  }

  // ── events (one delegated handler) ─────────────────────────────────────────────────────────────────────────────
  function onClick(e) {
    var a = e.target.closest('[data-act]');
    if (!a) {
      var sh = e.target.closest('[data-sheet]');
      if (sh && !e.target.closest('[data-stop]')) openSheet(sh.getAttribute('data-sheet'));
      return;
    }
    if (a.getAttribute('data-act') === 'sheetclose' && e.target.closest('[data-stop]') && !e.target.closest('.pk-sh-x')) return;   // a click inside the sheet
    var act = a.getAttribute('data-act'), k = a.getAttribute('data-k'), id = a.getAttribute('data-id');
    e.stopPropagation();
    if (act === 'star') S.stars[id] = !S.stars[id];
    else if (act === 'sheet') { openSheet(id); return; }
    else if (act === 'sheetclose') S.sheet = null;
    else if (act === 'open') { openMatch(id); return; }
    else if (act === 'tab') { S.tab = k; S.histPage = 1; }
    else if (act === 'period') S.period = k;
    else if (act === 'record') { S.view = 'record'; window.scrollTo(0, 0); }
    else if (act === 'back') S.view = 'cards';
    else if (act === 'sort') S.sort = C.nextSort(S.sort, k);
    else if (act === 'hprev') S.histPage = Math.max(1, S.histPage - 1);
    else if (act === 'hnext') S.histPage = S.histPage + 1;
    else if (act === 'post') { if (window.PicksDrawer) PicksDrawer.openNew(); return; }
    else if (act === 'edit') { if (window.PicksDrawer) PicksDrawer.openEdit(rows().find(function (x) { return x.id === id; })); return; }
    render();
  }
  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-act="record"],[data-act="back"],[data-sheet]')) { e.preventDefault(); e.target.click(); }
  }

  var wired = false, active = false;
  function wire() {
    var el = root(); if (!el || wired) return;
    wired = true;
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    if (window.matchMedia) {
      var mq = window.matchMedia('(max-width: 640px)');
      var re = function () { if (active) render(); };
      if (mq.addEventListener) mq.addEventListener('change', re); else if (mq.addListener) mq.addListener(re);
    }
  }
  // The analysis sheet is a layer: Esc closes it (the one Esc handler, esc-nav.js), as does a rail click.
  (globalThis.sfEscLayers = globalThis.sfEscLayers || []).push({ id: 'picks-sheet', z: 60,
    isOpen: function () { return active && !!S.sheet; }, close: function () { S.sheet = null; render(); } });
  (window.sfOverlayClosers = window.sfOverlayClosers || []).push(function () { if (S.sheet) { S.sheet = null; if (active) render(); } });

  function setActive(on) {
    active = !!on;
    if (!active) { S.sheet = null; return; }
    wire();
    if (loaded()) render();
    load(true);
    if (!S.timer && !S.fixture) S.timer = setInterval(function () { if (active && !document.hidden) load(true); }, REFRESH_MS);
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
  // The plan arrives after first paint: the auth paint calls window.sfPlanLocks(u) on every auth change (the shared
  // sf-menu block, identical on account.html, so it is wrapped here rather than edited). A plan change re-renders the
  // page, so a Pro member never sits on a blurred card rendered while the account was still loading (Matches does the
  // same through renderMatches).
  if (typeof window.sfPlanLocks === 'function' && !window.sfPlanLocks._picks) {
    var planLocks = window.sfPlanLocks;
    window.sfPlanLocks = function () {
      var r = planLocks.apply(this, arguments);
      if (active && (window.sfPlan || null) !== shownPlan) reload();   // a new plan is a new role: re-read the store
      return r;
    };
    window.sfPlanLocks._picks = true;
  }
  // tests and the screenshot harness inject a fixture (the store is not reachable from a headless clone)
  function inject(fx) { S.fixture = fx; C.useStoredDay(!!fx); if (S.timer) { clearInterval(S.timer); S.timer = null; } render(); }
  window.PicksPage = { setActive: setActive, render: render, reload: reload, _inject: inject, _state: S, _rows: rows };
  window.addEventListener('hashchange', applyHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyHash); else applyHash();
})();
