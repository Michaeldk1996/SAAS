/* bettracker-page.js — the Bet Tracker page, T1 (design_handoff_bet_tracker, LOCKED 2026-10-28): bankrolls strip,
 * header + Certified badge, Log a bet, the View segment, and the ledger (All / Pending / Won / Lost, month chips,
 * WON / LOST / VOID → undo → Lock). The hero, Calendar, Insights and Staking are later tasks: the View segment renders,
 * Insights and Staking show their card frame with a single dash.
 *
 * Nothing here computes a figure: every number comes from bettracker-math.js (window.BetTrackerMath), every read and
 * write goes through bettracker-store.js (window.BetTrackerStore) — this file never touches storage. Markup = the
 * reference template; values = bettracker-page.css. A new member sees one bankroll ("Bankroll 1") and no demo bets.
 */
(function () {
  'use strict';
  var M = window.BetTrackerMath, store = window.BetTrackerStore;
  if (!M || !store) return;
  // Dev only: `?seed=20261027` runs the page on the locked prototype's demo ledger (bettracker-seed.js) in a memory store,
  // today pinned to the prototype's 27 Oct 2026 — for side-by-side screenshots. Nothing is persisted; no nav entry.
  var SEED = (function () { var m = /[?&]seed=(\d+)/.exec(location.search || ''); return m ? +m[1] : null; })(), seedReady = false;
  function seedStore(done) {
    if (seedReady) return done();
    var s = document.createElement('script'); s.src = 'bettracker-seed.js';
    s.onload = function () {
      var mem = function () { var m = {}; return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; };
      var local = mem(), T = window.BetTrackerSeed.TODAY;
      local.setItem(window.BetTrackerStore.KEY, JSON.stringify(window.BetTrackerSeed.doc(SEED, window.BetTrackerStore.V)));
      store = window.BetTrackerStore.create({ local: local, session: mem(), now: function () { return new Date(T[0], T[1], T[2], 12); } });
      seedReady = true; done();
    };
    document.head.appendChild(s);
  }
  var DASH = M.DASH;
  var CHIP = { won: 'WON', lost: 'LOST', void: 'VOID' };
  var SEAL_SVG = '<svg viewBox="0 0 24 24" width="7" height="7" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"></path></svg>';
  var FORM0 = { legs: [{ text: '', odds: '' }], tour: '', market: 'Match winner', marketOther: '', level: '500', surface: 'Indoor hard', book: 'bet105', bookOther: '', stake: '', timing: 'pre', type: 'Single' };

  var NOF = function () { return { level: [], odds: [], surface: [], market: [] }; };
  var S = { bank: null, view: 'results', lf: 'all', month: null, logOpen: false, form: JSON.parse(JSON.stringify(FORM0)), banks: [], raw: [],
    period: 'season', range: null, filters: NOF(), menu: null, calOpen: undefined, openMonth: null, dim: 'market', vsPlan: null };
  function curBank() { return S.banks.find(function (b) { return b.id === S.bank; }) || S.banks[0]; }
  function appliedPlan() { var b = curBank(); return b && b.plan && M.plan(b.plan) ? b.plan : null; }
  // The Bet-Analytix import (T1b): admin only — the control is not in the design (reported); the console path is
  // TrackerPage.importText(csvText). The file is read in this browser and goes nowhere else.
  function isAdmin() { return typeof window.isBspAdmin === 'function' && !!window.isBspAdmin(); }
  var active = false, wired = false;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function root() { return document.getElementById('trackerRoot'); }
  function todayDate() { if (SEED) { var T = window.BetTrackerSeed.TODAY; return new Date(T[0], T[1], T[2]); } var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // a stored record ('YYYY-MM-DD') → the math's bet (a local-midnight Date)
  function asBet(r) { var b = Object.assign({}, r); b.date = M.parseDay(r.date); return b; }

  function load() {
    S.banks = store.listBanks();
    var live = S.banks.filter(function (b) { return !b.archived; });
    if (!S.bank || !S.banks.some(function (b) { return b.id === S.bank; })) S.bank = (live[0] || S.banks[0]).id;
    S.raw = store.listBets(null);
  }
  function betsOf(bankId) { return S.raw.filter(function (r) { return r.bank === bankId; }).map(asBet); }

  // ── markup (v26 template, Bet Tracker Page.dc.html lines 19–489) ─────────────────────────────────────────────────
  function bankrolls() {
    var live = S.banks.filter(function (b) { return !b.archived; }), arch = S.banks.filter(function (b) { return b.archived; });
    var cards = live.map(function (bk) {
      var c = M.bankCard(betsOf(bk.id));
      return '<div class="bt-bank' + (bk.id === S.bank ? ' is-on' : '') + '" data-act="bank" data-id="' + esc(bk.id) + '">'
        + '<div class="bt-bank-top"><span class="bt-bank-name">' + esc(bk.name) + '</span><span class="bt-bank-r"><span class="bt-bank-meta">' + esc(c.meta) + '</span>'
        + '<span class="bt-archive" data-act="archive" data-id="' + esc(bk.id) + '" title="Archive this bankroll — its bets stay, it leaves the strip">Archive</span></span></div>'
        + '<div class="bt-tiles2"><div class="bt-tile"><span class="bt-caps10">ROI</span><span class="bt-tile-fig bt-' + c.roiKind + '">' + esc(c.roi) + '</span></div>'
        + '<div class="bt-tile"><span class="bt-caps10">Profit %</span><span class="bt-tile-fig bt-' + c.profitKind + '">' + esc(c.profit) + '</span></div></div></div>';
    }).join('');
    var archived = arch.length ? '<div class="bt-archived"><span class="bt-caps">Archived</span>' + arch.map(function (bk) {
      return '<span class="bt-arch">' + esc(bk.name) + '<span class="bt-arch-meta">' + esc(M.bankCard(betsOf(bk.id)).archivedMeta) + '</span>'
        + '<span class="bt-restore" data-act="restore" data-id="' + esc(bk.id) + '">Restore</span>'
        + '<span class="bt-delete" data-act="delete" data-id="' + esc(bk.id) + '" title="Delete for good — only possible once archived">Delete</span></span>';
    }).join('') + '</div>' : '';
    return '<div class="bt-banks"><div class="bt-headrow"><span class="bt-caps">Bankrolls</span><span class="bt-banks-sub">One ledger each · pick one and the whole page follows · figures over the bankroll\'s whole life</span></div>'
      + '<div class="bt-strip">' + cards + '<div class="bt-addbank" data-act="addbank"><span class="bt-addbank-plus">+</span><span class="bt-addbank-lbl">Add bankroll</span></div></div></div>' + archived;
  }
  function seal(row) { return '<span class="bt-seal' + (row ? ' is-row' : '') + '"' + (row ? ' title="Locked result · certified, cannot be edited"' : '') + '>' + SEAL_SVG + '</span>'; }
  // F1 (Michael's unlock of README 7.1): the second line is the bankroll name only — no meta sentence, no import banner.
  function header(cur, all) {
    return '<div class="bt-head"><div class="bt-head-l"><div class="bt-title"><span class="bt-h1">Bet Tracker</span><span class="bt-cert" title="Every locked result is frozen — it cannot be edited or deleted. The blue seal on a ledger row marks a locked result.">'
      + seal(false) + esc(M.certText(all)) + '</span></div><div class="bt-headsub"><span class="bt-bankname">' + esc(cur.name) + '</span></div></div>'
      + (isAdmin() ? '<span class="bt-import" data-act="import" title="Admin · import a Bet-Analytix CSV export into its own bankroll">Import CSV</span>'
        + '<input type="file" accept=".csv,text/csv" class="bt-importfile" id="btImportFile" hidden>' : '')
      + '<span class="bt-logbtn" data-act="logtoggle">' + (S.logOpen ? 'Close' : '+ Log a bet') + '</span></div>';
  }
  function seg(key, pairs) {
    return '<div class="bt-segtrack">' + pairs.map(function (p) {
      return '<span class="bt-segitem' + (S.form[key] === p[0] ? ' on' : '') + '" data-act="seg" data-k="' + key + '" data-v="' + esc(p[0]) + '">' + esc(p[1]) + '</span>';
    }).join('') + '</div>';
  }
  function options(list, sel, keys) {
    return list.map(function (label, i) { var v = keys ? keys[i] : label; return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }).join('');
  }
  function field(label, inner) { return '<label class="bt-field"><span class="bt-caps10">' + esc(label) + '</span>' + inner + '</label>'; }
  function field(label, inner, extra) { return '<label class="bt-field' + (extra || '') + '"><span class="bt-caps10">' + esc(label) + '</span>' + inner + '</label>'; }
  function ticketHtml() {
    var T = M.ticket(S.form), c = M.formCheck(S.form);
    var kv = function (k, v, id) { return '<div class="bt-tk-row"><span class="bt-tk-k">' + k + '</span><span class="bt-tk-v"' + (id ? ' id="' + id + '"' : '') + '>' + esc(v) + '</span></div>'; };
    return '<span class="bt-tk-top"><span class="bt-caps10">Ticket</span><span class="bt-tk-pend">PENDING</span></span>'
      + '<div class="bt-tk-sel"><span class="bt-tk-name' + (T.hasSel ? '' : ' is-ph') + '">' + esc(T.sel) + '</span><span class="bt-tk-ctx">' + esc(T.ctx) + '</span></div>'
      + '<div class="bt-tk-kv">' + kv('Type', T.type) + kv('Market', T.market) + kv('Book', T.book) + kv('Odds', T.odds) + kv('Stake', T.stake) + '</div>'
      + '<div class="bt-tk-wl"><div class="bt-tk-tile"><span class="bt-caps10">Wins</span><span class="bt-tk-fig bt-' + T.winKind + '">' + esc(T.win) + '</span></div>'
      + '<div class="bt-tk-tile"><span class="bt-caps10">Loses</span><span class="bt-tk-fig bt-' + T.loseKind + '">' + esc(T.lose) + '</span></div></div>'
      + '<div class="bt-tk-foot"><span class="bt-post' + (c.valid ? ' is-ok' : '') + '" id="btPost" data-act="post">Post bet</span><span class="bt-tk-note">Posts as pending · settle in the ledger, then lock</span></div>';
  }
  function logPanel(cur) {
    var f = S.form, c = M.formCheck(f);
    var legs = f.legs.map(function (lg, i) {
      return '<div class="bt-leg">' + field(f.type === 'Single' ? 'Bet' : 'Leg ' + (i + 1), '<input class="bt-in" data-f="legtext" data-i="' + i + '" value="' + esc(lg.text) + '" placeholder="A. de Minaur to win">')
        + field('Odds', '<input class="bt-in bt-in-odds" data-f="legodds" data-i="' + i + '" value="' + esc(lg.odds) + '" placeholder="2.10">')
        + '<span class="bt-legx-slot">' + (f.type === 'Parlay' && f.legs.length > 2 ? '<span class="bt-legx" data-act="rmleg" data-i="' + i + '" title="Remove this leg">×</span>' : '') + '</span></div>';
    }).join('');
    var other = (f.market === 'Other' || f.book === 'Other') ? '<div class="bt-row2">'
      + (f.market === 'Other' ? field('Market · your own', '<input class="bt-in" data-f="marketOther" value="' + esc(f.marketOther) + '" placeholder="e.g. Most aces">') : '')
      + (f.book === 'Other' ? field('Bookmaker · your own', '<input class="bt-in" data-f="bookOther" value="' + esc(f.bookOther) + '" placeholder="your local book">') : '') + '</div>' : '';
    return '<div class="bt-card bt-log"><div class="bt-log-l"><div class="bt-log-head"><span class="bt-log-title"><span class="bt-log-h">Log a bet</span><span class="bt-log-bank">' + esc(cur.name) + '</span></span>'
      + '<span class="bt-log-x" data-act="logtoggle">✕</span></div>'
      + '<div class="bt-log-sec"><span class="bt-caps10">Selection</span><div class="bt-log-segs">' + seg('type', [['Single', 'Single'], ['Combination', 'Combination'], ['Parlay', 'Parlay']])
      + seg('timing', [['pre', 'Pre-match'], ['live', 'Live · in play']]) + '</div>' + legs
      + '<div class="bt-legfoot">' + (f.type === 'Parlay' ? '<span class="bt-addleg" data-act="addleg">+ Add a leg</span>' : '') + '<span class="bt-legsnote" id="btLegsNote">' + esc(M.legsNote(f)) + '</span></div></div>'
      + '<div class="bt-log-sec is-rule"><div class="bt-row1">' + field('Tournament', '<input class="bt-in" data-f="tour" value="' + esc(f.tour) + '" placeholder="Vienna">')
      + field('Level', '<select class="bt-in" data-f="level">' + options(M.LEVEL_KEYS.map(function (k) { return M.LEVEL[k]; }), f.level, M.LEVEL_KEYS) + '</select>')
      + field('Surface', '<select class="bt-in" data-f="surface">' + options(M.SURFACES, f.surface) + '</select>') + '</div>'
      + '<div class="bt-row2">' + field('Market', '<select class="bt-in" data-f="market">' + options(M.MARKETS.concat('Other — type it'), f.market, M.MARKETS.concat('Other')) + '</select>')
      + field('Bookmaker', '<select class="bt-in" data-f="book">' + options(M.BOOKS.concat('Other — type it'), f.book, M.BOOKS.concat('Other')) + '</select>') + '</div>' + other + '</div>'
      + '<div class="bt-log-sec is-rule"><div class="bt-row3">' + field('Stake · % of bankroll', '<input class="bt-in bt-in-odds" data-f="stake" value="' + esc(f.stake) + '" placeholder="1.0">', ' is-stake')
      + '<div class="bt-field"><span class="bt-caps10 bt-nowrap">' + (f.type === 'Single' ? 'Odds' : 'Combined odds') + '</span><span class="bt-odds' + (c.legsOk ? ' is-ok' : '') + '" id="btOdds">' + esc(c.oddsText) + '</span></div>'
      + '<span class="bt-hint' + (c.valid ? ' is-ok' : '') + '"><span id="btHint">' + esc(c.hint) + '</span>' + planHint() + '</span></div></div></div>'
      + '<div class="bt-ticket" id="btTicket">' + ticketHtml() + '</div></div>';
  }
  // The stake hint once a plan is applied: "{plan} says x.xx%" + Use, or "{plan} needs the odds first".
  function planStakeNow() {
    var ap = appliedPlan(); if (!ap) return null;
    var settled = betsOf(S.bank).filter(M.isSettled).sort(function (a, b) { return a.date - b.date || a.id - b.id; });
    return M.planStake(ap, settled, M.combinedOdds(S.form.legs));
  }
  function planHint() {
    var ap = appliedPlan(); if (!ap) return '';
    var ps = planStakeNow();
    return '<span class="bt-planhint" id="btPlanHint">' + (ps !== null ? esc(ap) + ' says ' + ps.toFixed(2) + '%<span class="bt-use" data-act="useplan">Use</span>' : esc(ap) + ' needs the odds first') + '</span>';
  }
  // ── 4 · hero (README §4): headline · Period · Filters · View · curve · seven tiles ──────────────────────────────
  var CARET = '<span class="bt-caret">▼</span>';
  var SLIDERS = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4"></path></svg>';
  function mrow(act, attrs, label, on, n, zero) {
    return '<span class="bt-mrow' + (on ? ' on' : '') + (zero ? ' is-zero' : '') + '" data-act="' + act + '"' + attrs + '>' + label
      + (n == null ? '<span class="bt-tick">' + (on ? '✓' : '') + '</span>' : '<span class="bt-mrow-r"><span class="bt-mrow-n">' + n + '</span><span class="bt-tick">' + (on ? '✓' : '') + '</span></span>') + '</span>';
  }
  // ── 4 · the hero canvas (README 7.1, v26): header · bankrolls · headline · All time / Period / Filters / View · curve · tiles
  var CARET = '<span class="bt-caret">▼</span>';
  var SLIDERS = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4"></path></svg>';
  function mrow(act, attrs, label, on, n, zero) {
    return '<span class="bt-mrow' + (on ? ' on' : '') + (zero ? ' is-zero' : '') + '" data-act="' + act + '"' + attrs + '>' + label
      + (n == null ? '<span class="bt-tick">' + (on ? '✓' : '') + '</span>' : '<span class="bt-mrow-r"><span class="bt-mrow-n">' + n + '</span><span class="bt-tick">' + (on ? '✓' : '') + '</span></span>') + '</span>';
  }
  var curveNow = null;   // the drawn curve, for the hover layer (local state, as the reference)
  function hero(cur, all, ctx) {
    var HT = M.heroTiles(M.stats(ctx.list), ctx.list), HC = M.heroCurve(ctx.list, ctx.today), D = M.discipline(ctx.list, M.MIN_SAMPLE);
    curveNow = HC;
    var perOn = S.menu === 'period' || (S.period !== 'season' && S.period !== 'all'), fOn = S.menu === 'filters' || ctx.nF > 0, allOn = S.period === 'all';
    var periods = Object.keys(M.PERIODS).map(function (k) { return mrow('period', ' data-k="' + k + '"', M.PERIODS[k], S.period === k); }).join('');
    var custom = S.period === 'custom' ? '<div class="bt-custom"><input type="date" class="bt-date-in" data-f="rangefrom" value="' + esc(ctx.range.from) + '">'
      + '<input type="date" class="bt-date-in" data-f="rangeto" value="' + esc(ctx.range.to) + '"></div>' : '';
    var pmenu = S.menu === 'period' ? '<div class="bt-menu bt-menu-period">' + periods + custom + '</div>' : '';
    var groups = M.filterMenu(ctx.all, ctx.perList, S.filters).map(function (g) {
      return '<div class="bt-fgroup"><span class="bt-fgroup-l">' + esc(g.label) + '</span>' + g.opts.map(function (o) {
        return mrow('filter', ' data-k="' + g.key + '" data-v="' + esc(o.label) + '"', esc(o.label), o.on, o.n, o.zero);
      }).join('') + '</div>';
    }).join('');
    var fmenu = S.menu === 'filters' ? '<div class="bt-menu bt-menu-filters">' + groups + '<div class="bt-mfoot"><span>' + esc(M.filtersFoot(ctx.list, ctx.perList))
      + '</span><span class="bt-reset" data-act="resetfilters">Reset filters</span></div></div>' : '';
    var v = function (k, label, extra) { return '<span class="bt-view' + (S.view === k ? ' on' : '') + '" data-act="view" data-k="' + k + '">' + label + (extra || '') + '</span>'; };
    var yl = HC.yTicks.map(function (t) { return '<line class="bt-yt' + (t.zero ? ' is-zero' : '') + '" x1="44" x2="1288" y1="' + t.y + '" y2="' + t.y + '"></line>'; }).join('');
    var svg = '<svg class="bt-curve-svg" viewBox="0 0 1292 240" width="100%" height="240" preserveAspectRatio="none"><defs><linearGradient id="btHgA" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" class="bt-stop0"></stop><stop offset="1" class="bt-stop1"></stop></linearGradient></defs>' + yl
      + (HC.path ? '<path class="bt-area" d="' + HC.area + '" fill="url(#btHgA)"></path><path class="bt-line" d="' + HC.path + '"></path>' : '')
      + (HC.ddX !== null ? '<circle class="bt-ddpt" cx="' + HC.ddX + '" cy="' + HC.ddY + '" r="3.5"></circle>' : '')
      + (HC.hasLast ? '<circle class="bt-lastpt" cx="' + HC.lastX + '" cy="' + HC.lastY + '" r="4"></circle>' : '') + '</svg>';
    var labels = HC.yTicks.map(function (t) { return '<span class="bt-ylab" style="top:' + t.top + '">' + esc(t.label) + '</span>'; }).join('')
      + HC.xTicks.map(function (t) { return '<span class="bt-xlab" style="left:' + t.left + '">' + esc(t.label) + '</span>'; }).join('');
    var tiles = HT.rows.map(function (r) {
      return '<div class="bt-htile"><span class="bt-caps bt-nowrap">' + esc(r.label) + '</span><span class="bt-htile-v"><span class="bt-htile-fig bt-' + r.kind + '">' + esc(r.value) + '</span><span class="bt-htile-when">' + esc(r.when) + '</span></span><span class="bt-htile-sub">' + esc(r.sub) + '</span></div>';
    }).join('');
    return '<div class="bt-card bt-hero">' + header(cur, all) + bankrolls()
      + '<div class="bt-hero-top"><div class="bt-hero-l"><span class="bt-caps">Profit · % of bankroll</span>'
      + '<span class="bt-profitrow"><span class="bt-profit bt-' + HT.profitKind + '">' + esc(HT.profit) + '</span><span class="bt-profitsub">' + esc(HT.profitSub) + '</span></span></div>'
      + '<div class="bt-hero-r"><span class="bt-curvemeta">' + esc(HC.meta) + '</span>'
      + '<span class="bt-trig bt-alltime' + (allOn ? ' on' : '') + '" data-act="alltime" title="The whole bankroll — from the first bet to today, no period cut">All time</span>'
      + '<span class="bt-rel"><span class="bt-trig' + (perOn ? ' on' : '') + '" data-act="menu" data-k="period">' + esc(M.PERIODS[S.period]) + CARET + '</span>' + pmenu + '</span>'
      + '<span class="bt-rel"><span class="bt-trig' + (fOn ? ' on' : '') + '" data-act="menu" data-k="filters">' + SLIDERS + esc(M.filtersLabel(S.filters)) + CARET + '</span>' + fmenu + '</span>'
      + '<span class="bt-views">' + v('results', 'Results') + v('insights', 'Insights', '<span class="bt-view-badge bt-' + D.badgeTone + '">' + esc(D.badge) + '</span>')
      + v('staking', 'Staking', appliedPlan() ? '<span class="bt-plandot"></span>' : '') + '</span></div></div>'
      + '<div class="bt-curve">' + svg + '<div class="bt-hov" id="btHov"></div><div class="bt-curve-hit" id="btCurveHit"></div>' + labels + '</div>'
      + '<div class="bt-ddrow"><span>○ red = deepest drawdown</span><span>' + esc(HC.ddNote) + '</span></div>'
      + '<div class="bt-htiles">' + tiles + '</div></div>';
  }
  // The curve hover (v26): a 1 px rule, a ringed dot and the 236 px tooltip — drawn into #btHov, no page re-render.
  function hoverAt(fx) {
    var el = document.getElementById('btHov'); if (!el || !curveNow || !curveNow.n) return;
    var H = M.curveHover(curveNow, fx, todayDate());
    var tip = '<div class="bt-hov-tip' + (H.flip ? ' is-flip' : '') + '" style="left:' + H.left + '"><div class="bt-hov-h"><span class="bt-hov-date">' + esc(H.date) + '</span><span class="bt-hov-idx">' + esc(H.idx) + '</span></div>'
      + '<div class="bt-hov-cumrow"><span class="bt-hov-cum bt-' + H.cumKind + '">' + esc(H.cum) + '</span><span class="bt-hov-lbl">bankroll</span></div>'
      + (H.bet ? '<div class="bt-hov-bet"><div class="bt-hov-betrow"><span class="bt-hov-sq bt-bg-' + H.bet.resKind + '"></span><span class="bt-hov-text">' + esc(H.bet.text) + '</span></div>'
        + '<span class="bt-hov-meta">' + esc(H.bet.meta) + '</span><div class="bt-hov-plrow"><span class="bt-hov-stake">' + esc(H.bet.stake) + '</span><span class="bt-hov-pl bt-' + H.bet.plKind + '">' + esc(H.bet.pl) + '</span></div></div>' : '') + '</div>';
    el.innerHTML = '<div class="bt-hov-rule" style="left:' + H.left + '"></div><div class="bt-hov-dot" style="left:' + H.left + '; top:' + H.top + '"></div>' + tip;
  }
  function onCurveMove(e) {
    var hit = e.target; if (!hit || hit.id !== 'btCurveHit') return;
    var r = hit.getBoundingClientRect(); hoverAt((e.clientX - r.left) / r.width * 1292);
  }
  function onCurveLeave(e) { if (e.target && e.target.id === 'btCurveHit') { var el = document.getElementById('btHov'); if (el) el.innerHTML = ''; } }
  function closeCell(b) {
    var editable = M.isSettled(b) && !M.isLocked(b);
    if (!editable) return '<span class="bt-close">' + (b.close ? b.close.toFixed(2) : DASH) + '</span>';
    return '<input class="bt-closein" data-f="close" data-id="' + b.id + '" inputmode="decimal" value="' + (b.close ? b.close.toFixed(2) : '') + '" aria-label="Closing price">';
  }
  function lane(b) {
    if (!M.isSettled(b)) {
      return '<span class="bt-lane"><span class="bt-settle is-won" data-act="settle" data-v="won" data-id="' + b.id + '">WON</span>'
        + '<span class="bt-settle is-lost" data-act="settle" data-v="lost" data-id="' + b.id + '">LOST</span>'
        + '<span class="bt-settle is-void" data-act="settle" data-v="void" data-id="' + b.id + '">VOID</span></span>';
    }
    var locked = M.isLocked(b);
    return '<span class="bt-lane is-set">' + (!locked ? '<span class="bt-undo" data-act="undo" data-id="' + b.id + '">undo</span>'
      + '<span class="bt-lock" data-act="lock" data-id="' + b.id + '" title="Lock this result for good — it can never be edited again">Lock</span>' : '')
      + '<span class="bt-chip is-' + b.res + '">' + CHIP[b.res] + '</span>' + (locked ? seal(true) : '') + '</span>';
  }
  function ledger(list) {
    var sorted = M.sortLedger(list), filt = M.ledgerFilter(sorted, S.lf, S.month), rows = filt.slice(0, M.LEDGER_ROWS);
    var lfs = [['all', 'All'], ['pending', 'Pending'], ['won', 'Won'], ['lost', 'Lost']].map(function (x) {
      return '<span class="bt-lf' + (S.lf === x[0] ? ' on' : '') + '" data-act="lf" data-k="' + x[0] + '">' + x[1] + '</span>';
    }).join('');
    // no month chips for an empty ledger (T1 brief: a new member sees none)
    var months = list.length ? '<div class="bt-months">' + M.ledgerMonths(list).map(function (m) {
      return '<span class="bt-mchip' + (S.month === m.month ? ' on' : '') + '" data-act="month" data-k="' + (m.month === null ? '' : m.month) + '"><span class="bt-mchip-top"><span class="bt-mchip-lbl">' + esc(m.label)
        + '</span><span class="bt-mchip-n">' + m.n + '</span></span><span class="bt-mchip-pl bt-' + m.plKind + '">' + esc(m.pl) + '</span></span>';
    }).join('') + '</div>' : '';
    var heads = ['Date', 'Bet', 'Market', 'Book', 'Odds', 'Close', 'CLV', 'Stake', 'Result', 'P/L'].map(function (h, i) { return '<span class="bt-caps10' + (i >= 4 ? ' bt-r' : '') + '">' + h + '</span>'; }).join('');
    var body = rows.map(function (b) {
      var r = b.res, c = M.clv(b), p = r ? M.pl(b) : null;
      return '<div class="bt-grid bt-tr' + (r ? '' : ' is-pending') + '" data-bet="' + b.id + '">'
        + '<span class="bt-c-date"><span class="bt-date">' + esc(M.fmtDY(b.date, todayDate())) + '</span><span class="bt-dow">' + M.dow(b.date) + '</span></span>'
        + '<span class="bt-c-bet"><span class="bt-bettext">' + esc(b.text) + '</span><span class="bt-betmeta">' + esc(M.betMeta(b)) + '</span></span>'
        + '<span class="bt-market">' + esc(b.market ? b.market + (b.line ? ' ' + b.line : '') : DASH) + '</span><span class="bt-book">' + esc(b.book || DASH) + '</span>'
        + '<span class="bt-oddsc">' + b.odds.toFixed(2) + '</span>' + closeCell(b)
        + '<span class="bt-clv bt-' + M.kind(c) + '">' + (c === null ? DASH : esc(M.sgn(c * 100))) + '</span>'
        + '<span class="bt-stake">' + b.stake.toFixed(1) + '%</span>' + lane(b)
        + '<span class="bt-pl bt-' + (r ? M.kind(p) : 'lab') + '">' + (r ? esc(M.sgn(p)) : DASH) + '</span></div>';
    }).join('');
    // no README copy for an empty ledger: a dash row (on the Claude Design handoff list)
    if (!rows.length) body = '<div class="bt-grid bt-tr"><span class="bt-empty">' + DASH + '</span></div>';
    return '<div class="bt-ledger"><div class="bt-ledger-head"><div class="bt-headrow"><span class="bt-h16">Ledger</span><span class="bt-sub125">' + esc(M.ledgerMeta(filt.length, list.length)) + '</span></div>'
      + '<div class="bt-lfs">' + lfs + '</div></div>' + months
      + '<div class="bt-card bt-table"><div class="bt-grid bt-thead">' + heads + '</div>' + body
      + '<div class="bt-foot"><span>' + esc(M.ledgerFoot(filt.length)) + '</span><span class="bt-export" title="Export is on the handoff list">Export CSV →</span></div></div></div>';
  }

  // ── 5 · Calendar (v26 README 7.4 "Month cards" + 7.5 month pop-up) ─────────────────────────────────────────────
  // The month tiles cover the shown period (Season → this season's months; All time → every month). The planner opens
  // on the current month — or, when it has no bets, on the latest month that does (the reference opens today's month).
  function calPhrase() { return S.period === 'season' ? 'this season' : S.period === 'all' ? 'since the first bet' : S.period === 'custom' ? 'in the period' : 'in the ' + M.PERIODS[S.period].toLowerCase(); }
  function calOpenKey(keys, today) {
    if (S.calOpen !== undefined) return S.calOpen;
    var cur = M.ym(today); return keys.indexOf(cur) >= 0 ? cur : keys.length ? keys[keys.length - 1] : null;
  }
  function dayPop(c) {
    return '<span class="bt-dpop' + (c.right ? ' is-right' : '') + (c.above ? ' is-above' : '') + '"><span class="bt-dpop-h"><span class="bt-dpop-t">' + esc(c.title) + '</span><span class="bt-dpop-s">' + esc(c.sub) + '</span></span>'
      + c.rows.map(function (r) {
        return '<span class="bt-dpop-r"><span class="bt-dpop-l"><span class="bt-dpop-text">' + esc(r.text) + '</span><span class="bt-dpop-meta">' + esc(r.meta) + '</span></span>'
          + '<span class="bt-dpop-res bt-' + r.resKind + '">' + esc(r.res) + '</span><span class="bt-dpop-pl bt-' + r.plKind + '">' + esc(r.pl) + '</span></span>';
      }).join('') + '</span>';
  }
  function calendar(ctx) {
    var keys = M.calendarView(ctx.perList, ctx.today, null, null).keys, openKey = calOpenKey(keys, ctx.today);
    var C = M.calendarView(ctx.perList, ctx.today, openKey, null, calPhrase());
    var dn = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (d) { return '<span class="bt-mc-dn">' + d + '</span>'; }).join('');
    var cards = C.cards.map(function (m) {
      return '<div class="bt-mcard' + (m.on ? ' on' : '') + '" data-act="calmonth" data-k="' + m.key + '"><div class="bt-mc-cal"><div class="bt-mc-row">' + dn + '</div>'
        + m.rows.map(function (r) {
          return '<div class="bt-mc-row">' + r.map(function (c) {
            var st = c.alpha !== null && (c.kind === 'pos' || c.kind === 'neg') ? ' style="background:color-mix(in srgb, var(--' + c.kind + ') ' + Math.round(c.alpha * 100) + '%, transparent)"' : '';
            return '<span class="bt-mc-c is-' + c.kind + (c.today ? ' is-today' : '') + '" title="' + esc(c.t) + '"' + st + '></span>';
          }).join('') + '</div>';
        }).join('') + '</div><div class="bt-mc-r"><span class="bt-mc-name">' + esc(m.name) + '</span><span class="bt-mc-pl bt-' + m.plKind + '">' + esc(m.pl) + '</span>'
        + '<span class="bt-mc-sub">' + esc(m.sub) + '</span><span class="bt-mc-foot"><span class="bt-mc-roil">ROI</span><span class="bt-mc-roir"><span class="bt-mc-roi bt-' + m.roiKind + '">' + esc(m.roi) + '</span>'
        + '<span class="bt-mc-chev">' + (m.on ? '▴' : '▾') + '</span></span></span></div></div>';
    }).join('');
    var O = C.open, panel = '';
    if (O) {
      var head = M.DN.map(function (d) { return '<span class="bt-pl-dn">' + d + '</span>'; }).join('') + '<span class="bt-pl-dn is-week">Week</span>';
      var rows = O.rows.map(function (r) {
        return '<div class="bt-pl-row">' + r.cells.map(function (c) {
          return '<span class="bt-pday is-' + c.bg + (c.today ? ' is-today' : '') + (c.has ? ' has' : '') + '"' + (c.has ? ' data-day="' + c.key + '"' : '') + '><span class="bt-pday-dt is-' + c.dtKind + '">' + esc(c.dt) + '</span>'
            + '<span class="bt-pday-b"><span class="bt-pday-short">' + esc(c.short) + '</span><span class="bt-pday-fig bt-' + c.figKind + '">' + esc(c.fig) + '</span></span>' + (c.has ? dayPop(c) : '') + '</span>';
        }).join('') + '<span class="bt-pweek"><span class="bt-pweek-n">' + esc(r.n) + '</span><span class="bt-pweek-pl bt-' + r.plKind + '">' + esc(r.pl) + '</span></span></div>';
      }).join('');
      var stats = O.stats.map(function (x) {
        return '<div class="bt-pst"><span class="bt-caps10">' + esc(x.l) + '</span><span class="bt-pst-v bt-' + x.k + '">' + esc(x.v) + '</span><span class="bt-pst-s">' + esc(x.s) + '</span></div>';
      }).join('');
      panel = '<div class="bt-opm"><div class="bt-opm-h"><span class="bt-opm-hl"><span class="bt-opm-t">' + esc(O.title) + '</span><span class="bt-opm-s">' + esc(O.sub) + '</span></span>'
        + '<span class="bt-opm-hr"><span class="bt-opm-full" data-act="openmonth" data-k="' + O.key + '">Full record →</span><span class="bt-opm-x" data-act="calclose">Close</span></span></div>'
        + '<div class="bt-opm-body"><div class="bt-planner"><div class="bt-pl-head">' + head + '</div>' + rows + '</div><div class="bt-pstats">' + stats + '</div></div></div>';
    }
    var omBets = S.openMonth === null ? [] : ctx.perList.filter(function (b) { return M.isSettled(b) && M.ym(b.date) === S.openMonth; }), pop = '';
    if (omBets.length) {
      var P = M.monthPop(S.openMonth, omBets, ctx.today);
      pop = '<div class="bt-mpop" data-act="monthclose"><div class="bt-mpop-sheet" data-stop="1"><div class="bt-mpop-h"><div class="bt-mpop-hl"><span class="bt-mpop-t">' + esc(P.title) + '</span><span class="bt-mpop-s">' + esc(P.sub) + '</span></div>'
        + '<span class="bt-mpop-x" data-act="monthclose">✕</span></div><div class="bt-mpop-stats">' + P.stats.map(function (x) {
          return '<div class="bt-mpop-tile"><span class="bt-caps">' + esc(x.l) + '</span><span class="bt-mpop-v bt-' + x.kind + '">' + esc(x.v) + '</span></div>';
        }).join('') + '</div><div class="bt-mpop-table"><div class="bt-mpgrid bt-mpop-head">' + ['Date', '', 'Bet', 'Market', 'Price', 'Close', 'CLV', 'Stake', 'Result', 'P/L'].map(function (h, i) {
          return '<span class="bt-caps' + (i >= 4 ? ' bt-r' : '') + '">' + h + '</span>'; }).join('') + '</div>'
        + P.rows.map(function (r) {
          return '<div class="bt-mpop-rw"><div class="bt-mpgrid bt-mpop-row"><span class="bt-mp-date">' + esc(r.date) + '</span><span class="bt-mp-sq bt-bg-' + r.resKind + '"></span>'
            + '<span class="bt-mp-bet"><span class="bt-mp-text">' + esc(r.text) + '</span><span class="bt-mp-meta">' + esc(r.meta) + '</span></span><span class="bt-mp-market">' + esc(r.market) + '</span>'
            + '<span class="bt-mp-odds">' + r.odds + '</span><span class="bt-mp-close">' + r.close + '</span><span class="bt-mp-clv bt-' + r.clvKind + '">' + esc(r.clv) + '</span><span class="bt-mp-stake">' + r.stake + '</span>'
            + '<span class="bt-mp-res bt-' + r.resKind + '">' + r.res + '</span><span class="bt-mp-pl bt-' + r.plKind + '">' + esc(r.pl) + '</span></div></div>';
        }).join('') + '</div><div class="bt-mpop-foot">Settled bets only · P/L and stake in % of bankroll · CLV = your price ÷ closing price − 1 · click outside to close</div></div></div>';
    }
    return '<div class="bt-cal"><div class="bt-headrow"><span class="bt-h16">Calendar</span><span class="bt-sub125">One tile a month, one cell a day · click a month for its record · hover a day for the bets we took · day figures in € on a 10,000 € bankroll.</span></div>'
      + '<div class="bt-card bt-calcard"><div class="bt-calhead"><span class="bt-calmeta">' + esc(C.meta) + '</span><span class="bt-calsum"><span class="bt-calsum-s">' + esc(M.PERIODS[S.period] + ' · ' + C.sumSub) + '</span>'
      + '<span class="bt-calsum-pl bt-' + C.sumKind + '">' + esc(C.sumPl) + '</span></span></div><div class="bt-mcards">' + cards + '</div>' + panel + '</div></div>' + pop;
  }
  // a planner day's pop-up is hover-only (the reference's calHov); Escape hides it too (F4)
  function onDayOver(e) { var d = e.target.closest && e.target.closest('.bt-pday.has'); if (!d || !root().contains(d)) return; if (!d.classList.contains('is-hov')) { clearDayHov(); d.classList.add('is-hov'); } }
  function onDayOut(e) { var d = e.target.closest && e.target.closest('.bt-pday.has'); if (d && !(e.relatedTarget && d.contains(e.relatedTarget))) d.classList.remove('is-hov'); }
  function clearDayHov() { var r = root(); if (r) r.querySelectorAll('.bt-pday.is-hov').forEach(function (x) { x.classList.remove('is-hov'); }); }

  // ── 6 · Insights (README §6): verdict cards · Breakdown · Discipline ────────────────────────────────────────────
  var TONE_VAR = { pos: 'pos', neg: 'neg', amber: 'amber' };
  function insights(ctx) {
    var V = M.verdicts(ctx.list, M.MIN_SAMPLE), B = M.breakdown(ctx.list, S.dim), D = M.disciplineView(ctx.list, M.MIN_SAMPLE, M.PERIODS[S.period]);
    var cards = V.map(function (v) {
      var col = 'var(--' + TONE_VAR[v.tone] + ')';
      return '<div class="bt-card bt-vcard"><svg class="bt-vspark" viewBox="0 0 380 70" preserveAspectRatio="none">' + (v.path ? '<path d="' + v.area + '" style="fill:color-mix(in srgb, ' + col + ' 35%, transparent)"></path>'
        + '<path d="' + v.path + '" fill="none" style="stroke:' + col + '" stroke-width="1.5"></path>' : '') + '</svg>'
        + '<div class="bt-vhead"><span class="bt-caps bt-' + v.tone + '">' + esc(v.kind) + '</span><span class="bt-vseg">' + esc(v.seg) + '</span></div>'
        + '<span class="bt-vpl bt-' + v.plKind + '">' + esc(v.pl) + '</span><span class="bt-vtitle">' + esc(v.title) + '</span>'
        + '<div class="bt-vfigs">' + v.figs.map(function (f) { return '<span class="bt-vfig"><span class="bt-caps10">' + esc(f.l) + '</span><span class="bt-vfig-v bt-' + f.kind + '">' + esc(f.v) + '</span></span>'; }).join('') + '</div>'
        + '<span class="bt-vspacer"></span></div>';
    }).join('');
    var dimOn = S.menu === 'dim';
    var dmenu = dimOn ? '<div class="bt-menu bt-menu-dim">' + B.menu.map(function (m) {
      return '<span class="bt-mrow' + (m.on ? ' on' : '') + '" data-act="dim" data-k="' + m.key + '"><span>' + esc(m.label) + '<span class="bt-mrow-n bt-dimn">' + m.count + '</span></span><span class="bt-tick">' + (m.on ? '✓' : '') + '</span></span>';
    }).join('') + '</div>' : '';
    var heads = '<span></span><span class="bt-caps10">' + esc(B.head) + '</span><span class="bt-caps10 bt-r">Bets</span><span class="bt-caps10 bt-r">W–L</span><span class="bt-caps10 bt-c">ROI · −40 ‥ +40</span>'
      + '<span class="bt-caps10 bt-r">ROI</span><span class="bt-caps10 bt-r">CLV</span><span class="bt-caps10 bt-r">P/L</span>';
    var rows = B.rows.map(function (r) {
      return '<div class="bt-bgrid bt-brow"><span class="bt-bmark bt-bg-' + r.bar.kind + '"></span><span class="bt-bname">' + esc(r.name) + '</span><span class="bt-bn">' + r.n + '</span><span class="bt-bwl">' + esc(r.wl) + '</span>'
        + '<span class="bt-roibar"><span class="bt-roitick"></span><span class="bt-roifill bt-bg-' + r.bar.kind + '" style="left:' + r.bar.left + ';width:' + r.bar.width + '"></span></span>'
        + '<span class="bt-broi bt-' + r.roiKind + '">' + esc(r.roi) + '</span><span class="bt-bclv bt-' + r.clvKind + '">' + esc(r.clv) + '</span><span class="bt-bpl bt-' + r.plKind + '">' + esc(r.pl) + '</span></div>';
    }).join('');
    var T = B.tot;
    var box = '<div class="bt-card bt-bdbox"><div class="bt-bdhead"><span class="bt-bdhl"><span class="bt-bdtitle">Breakdown</span><span class="bt-bdby">by</span><span class="bt-rel">'
      + '<span class="bt-trig' + (dimOn ? ' on' : '') + '" data-act="menu" data-k="dim">' + esc(B.label) + CARET + '</span>' + dmenu + '</span></span>'
      + '<span class="bt-bdsum"><span>' + T.n + ' bets · ' + esc(T.wl) + '</span><span>ROI <span class="bt-bdsum-roi bt-' + T.roiKind + '">' + esc(T.roi) + '</span></span><span>P/L <span class="bt-bdsum-pl bt-' + T.plKind + '">' + esc(T.pl) + '</span></span></span></div>'
      + '<div class="bt-bgrid bt-bhead">' + heads + '</div>' + rows
      + '<div class="bt-bgrid bt-btot"><span></span><span class="bt-btot-l">' + esc(B.totLabel) + '</span><span class="bt-btot-n">' + T.n + '</span><span class="bt-bwl">' + esc(T.wl) + '</span><span></span>'
      + '<span class="bt-broi bt-' + T.roiKind + '">' + esc(T.roi) + '</span><span class="bt-bclv bt-' + T.clvKind + '">' + esc(T.clv) + '</span><span class="bt-bpl bt-' + T.plKind + '">' + esc(T.pl) + '</span></div>'
      + '<div class="bt-bdfoot">' + esc(B.foot) + '</div></div>';
    var dials = D.checks.map(function (c) {
      var col = 'var(--' + (c.tone === 'lab' ? 'text-label' : c.tone) + ')';
      return '<div class="bt-dial" title="' + esc(c.body) + '"><div class="bt-dial-g"><svg viewBox="0 0 200 110" width="110" height="61"><path class="bt-dial-track" d="M20 100 A80 80 0 0 1 180 100"></path>'
        + (c.zone ? '<path class="bt-dial-zone" d="' + c.zone + '"></path>' : '') + '<path class="bt-dial-arc" d="' + c.arc + '" style="stroke:' + col + '"></path></svg><span class="bt-dial-fig">' + esc(c.fig) + '</span></div>'
        + '<div class="bt-dial-t"><span class="bt-dial-l">' + esc(c.label) + '</span><span class="bt-dial-v" style="color:' + col + '">' + esc(c.verdict) + '</span><span class="bt-dial-s">' + esc(c.short) + '</span></div></div>';
    }).join('');
    return '<div class="bt-ins"><div class="bt-headrow"><span class="bt-h16">Where it works · where it leaks</span><span class="bt-sub125">' + esc(B.meta) + '</span></div>'
      + '<div class="bt-vcards">' + cards + '</div>' + box + '</div>'
      + '<div class="bt-disc"><div class="bt-headrow"><span class="bt-h16">Discipline</span><span class="bt-sub125">Skill shows in the closing line and the stakes long before it shows in the P/L.</span></div>'
      + '<div class="bt-card bt-discbox"><div class="bt-dischead"><span class="bt-caps">' + esc(D.head) + '</span><span class="bt-discsum"><span class="bt-discsum-n bt-' + D.sumKind + '">' + esc(D.sum) + '</span> ' + esc(D.sumTxt) + '</span></div>'
      + '<div class="bt-dials">' + dials + '</div></div></div>';
  }

  // ── 7 · Staking (README §7): plan chips · your stakes vs a plan · deltas · explainers · Apply / Remove ────────────
  function staking(ctx) {
    var cur = curBank(), ap = appliedPlan(), Z = M.stakingView(ctx.list, S.vsPlan || M.DEFAULT_PLAN), on = ap === Z.other;
    var sw = function (k) { return 'background:var(--' + k + ')'; };
    var chips = Z.plans.map(function (p) {
      return '<span class="bt-pchip' + (p.on ? ' on' : '') + '" data-act="vsplan" data-k="' + esc(p.name) + '" title="' + esc(p.how) + '"><span class="bt-pchip-sw" style="' + sw(p.sw) + '"></span>' + esc(p.name) + '</span>';
    }).join('');
    var applied = ap ? '<span class="bt-applied">' + esc(ap + ' is on for ' + cur.name + ' · the next bet you log is pre-sized') + '</span><span class="bt-remove" data-act="removeplan">Remove</span>' : '';
    var ticks = Z.yTicks.map(function (t) { return '<line class="bt-yt' + (t.zero ? ' is-zero' : '') + '" x1="36" x2="1256" y1="' + t.y + '" y2="' + t.y + '"></line>'; }).join('');
    var svg = '<svg class="bt-sim-svg" viewBox="0 0 1256 226" width="100%" height="226" preserveAspectRatio="none">' + ticks
      + (Z.n ? '<path d="' + Z.area + '" style="fill:color-mix(in srgb, var(--' + Z.areaKind + ') 8%, transparent)"></path><path class="bt-simyou" d="' + Z.yourPath + '"></path>'
        + '<path class="bt-simplan" d="' + Z.otherPath + '" style="stroke:var(--' + Z.otherSw + ')"></path>' : '') + '</svg>'
      + Z.yTicks.map(function (t) { return '<span class="bt-simlab" style="top:' + t.top + '">' + esc(t.label) + '</span>'; }).join('');
    var deltas = Z.deltas.map(function (d) {
      return '<div class="bt-delta"><span class="bt-caps">' + esc(d.l) + '</span><span class="bt-delta-r"><span class="bt-delta-a">' + esc(d.a) + '</span><span class="bt-delta-arr">→</span>'
        + '<span class="bt-delta-b">' + esc(d.b) + '</span><span class="bt-delta-d bt-' + d.kind + '">' + esc(d.d) + '</span></span></div>';
    }).join('');
    return '<div class="bt-stk"><div class="bt-stk-top"><div class="bt-stk-hrow"><span class="bt-stk-hl"><span class="bt-h16 bt-nowrap">Staking strategy</span><span class="bt-sub125">Same bets and results, only the stake changes · pick a plan, read it against your stakes, apply it to this bankroll.</span></span>'
      + '<span class="bt-stk-hr">' + applied + '<span class="bt-apply' + (on ? ' is-on' : '') + '" data-act="applyplan">' + esc(on ? 'Applied to ' + cur.name : 'Apply ' + Z.other + ' to this bankroll') + '</span></span></div>'
      + '<div class="bt-pchips">' + chips + '</div></div>'
      + '<div class="bt-card bt-simcard"><div class="bt-simhead"><span class="bt-simtitle"><span class="bt-simkey" style="' + sw('tracker-ring') + '"></span>Your stakes<span class="bt-simvs">vs</span>'
      + '<span class="bt-simkey" style="' + sw(Z.otherSw) + '"></span>' + esc(Z.other) + '<span class="bt-simsub">· ' + esc(Z.otherSub) + '</span></span><span class="bt-simmeta">' + esc(Z.meta + ' · shaded = the gap · ' + Z.gapTxt) + '</span></div>'
      + '<div class="bt-simchart">' + svg + '</div><div class="bt-deltas">' + deltas + '</div>'
      + '<div class="bt-expl"><div class="bt-ex"><span class="bt-caps bt-ex-h"><span class="bt-ex-sw" style="' + sw('tracker-ring') + '"></span>Your stakes</span><span class="bt-ex-t">' + esc(Z.yourHow) + '</span></div>'
      + '<div class="bt-ex"><span class="bt-caps bt-ex-h"><span class="bt-ex-sw" style="' + sw(Z.otherSw) + '"></span>' + esc(Z.other) + '</span><span class="bt-ex-t">' + esc(Z.otherHow) + '</span><span class="bt-ex-w">' + esc(Z.otherWhen) + '</span></div>'
      + '<div class="bt-ex"><span class="bt-caps">The difference</span><span class="bt-ex-t">' + esc(Z.n ? Z.diffTxt : DASH) + '</span></div></div>'
      + '<div class="bt-simnote">' + esc(Z.note) + '</div></div></div>';
  }

  function render() {
    var el = root(); if (!el) return;
    var cur = S.banks.find(function (b) { return b.id === S.bank; }) || S.banks[0];
    var all = betsOf(cur.id), today = todayDate();
    // Custom range: opens on the bankroll's first bet → today (the reference hard-codes its demo season's dates)
    if (!S.range) S.range = { from: all.length ? dayKey(all[0].date) : dayKey(new Date(today.getFullYear(), 0, 1)), to: dayKey(today) };
    var win = M.periodWindow(S.period, S.range, today), perList = M.inPeriod(all, win), list = M.applyFilters(perList, S.filters);
    var ctx = { all: all, list: list, perList: perList, win: win, today: today, per: S.period, range: S.range, nF: M.nFilters(S.filters) };
    var view = S.view === 'results' ? ledger(list) + calendar(ctx) : S.view === 'insights' ? insights(ctx) : staking(ctx);
    el.innerHTML = '<section class="bt-sec"><div class="bt-col"><div class="bt-stack">'
      + hero(cur, all, ctx) + (S.logOpen ? logPanel(cur) : '') + view + '</div></div></section>';
  }
  // live form figures without a re-render (keeps the caret in the field being typed in)
  function refreshLog() {
    var c = M.formCheck(S.form), o = document.getElementById('btOdds'), p = document.getElementById('btPost'), h = document.getElementById('btHint'), n = document.getElementById('btLegsNote');
    if (o) { o.textContent = c.oddsText; o.classList.toggle('is-ok', c.legsOk); }
    if (p) p.classList.toggle('is-ok', c.valid);
    if (h) { h.textContent = c.hint; h.classList.toggle('is-ok', c.valid); }
    if (n) n.textContent = M.legsNote(S.form);
    var ph = document.getElementById('btPlanHint'); if (ph) ph.outerHTML = planHint();
    var tk = document.getElementById('btTicket'); if (tk) tk.innerHTML = ticketHtml();
  }

  // ── actions: every write goes through the store, then the page re-reads it ─────────────────────────────────────
  function rawOf(id) { return S.raw.find(function (r) { return r.id === id; }); }
  function saveRaw(id, patch) { var r = rawOf(id); if (!r) return; store.saveBet(Object.assign({}, r, patch)); load(); render(); }
  function post() {
    var bet = M.newBet(S.form, S.bank, todayDate(), store.nextId()); if (!bet) return;
    bet.date = dayKey(bet.date);
    if (!store.saveBet(bet).ok) return;
    var f = S.form;
    S.form = Object.assign({}, f, { legs: M.fitLegs([], f.type), tour: '', stake: '', marketOther: '', bookOther: '' });
    S.logOpen = false; load(); render();
  }
  function onClick(e) {
    var t = e.target.closest('[data-act]'); if (!t || !root().contains(t)) return;
    // the month pop-up: a click inside the sheet is not a click on the overlay
    if (t.dataset.act === 'monthclose' && t.classList.contains('bt-mpop') && e.target.closest('[data-stop]')) return;
    var a = t.dataset.act, id = t.dataset.id;
    if (a === 'bank') { S.bank = id; S.month = null; S.filters = NOF(); S.range = null; S.calOpen = undefined; S.openMonth = null; S.vsPlan = null; render(); }
    else if (a === 'archive') {
      e.stopPropagation();
      var bk = S.banks.find(function (b) { return b.id === id; }); store.saveBank(Object.assign({}, bk, { archived: true }));
      if (S.bank === id) { var rest = S.banks.filter(function (b) { return !b.archived && b.id !== id; }); if (rest[0]) S.bank = rest[0].id; }
      load(); render();
    }
    else if (a === 'restore') { var rb = S.banks.find(function (b) { return b.id === id; }); store.saveBank(Object.assign({}, rb, { archived: false })); load(); render(); }
    else if (a === 'delete') { if (store.deleteBank(id).ok) { load(); render(); } }
    else if (a === 'addbank') { var nid = 'b' + Date.now(); store.saveBank({ id: nid, name: 'New bankroll ' + (S.banks.length + 1), archived: false }); S.bank = nid; S.month = null; S.filters = NOF(); S.range = null; load(); render(); }
    else if (a === 'vsplan') { S.vsPlan = t.dataset.k; render(); }
    else if (a === 'applyplan') { var cb = curBank(); store.saveBank(Object.assign({}, cb, { plan: S.vsPlan || M.DEFAULT_PLAN })); load(); render(); }
    else if (a === 'removeplan') { var cb2 = curBank(); store.saveBank(Object.assign({}, cb2, { plan: null })); load(); render(); }
    else if (a === 'useplan') { var ps = planStakeNow(); if (ps !== null) { S.form = Object.assign({}, S.form, { stake: ps.toFixed(2) }); render(); } }
    else if (a === 'dim') { S.dim = t.dataset.k; S.menu = null; render(); }
    else if (a === 'calmonth') { var mk = +t.dataset.k; S.calOpen = calOpenKey(M.calendarView(betsOf(S.bank), todayDate(), null, null).keys, todayDate()) === mk ? null : mk; render(); }
    else if (a === 'calclose') { S.calOpen = null; render(); }
    else if (a === 'openmonth') { S.openMonth = +t.dataset.k; render(); }
    else if (a === 'monthclose') { S.openMonth = null; render(); }
    else if (a === 'menu') { S.menu = S.menu === t.dataset.k ? null : t.dataset.k; render(); }
    else if (a === 'alltime') { S.period = S.period === 'all' ? 'season' : 'all'; S.menu = null; S.month = null; render(); }
    else if (a === 'period') { S.period = t.dataset.k; if (S.period !== 'custom') S.menu = null; S.month = null; render(); }
    else if (a === 'filter') {
      var fk = t.dataset.k, fv = t.dataset.v, cur2 = S.filters[fk], nf = Object.assign({}, S.filters);
      nf[fk] = cur2.indexOf(fv) >= 0 ? cur2.filter(function (x) { return x !== fv; }) : cur2.concat(fv); S.filters = nf; render();
    }
    else if (a === 'resetfilters') { S.filters = NOF(); S.period = 'season'; render(); }
    else if (a === 'logtoggle') { S.logOpen = !S.logOpen; render(); }
    else if (a === 'seg') {
      var k = t.dataset.k, v = t.dataset.v; S.form = Object.assign({}, S.form); S.form[k] = v;
      if (k === 'type') S.form.legs = M.fitLegs(S.form.legs, v);
      render();
    }
    else if (a === 'addleg') { S.form = Object.assign({}, S.form, { legs: S.form.legs.concat({ text: '', odds: '' }) }); render(); }
    else if (a === 'rmleg') { var i = +t.dataset.i; S.form = Object.assign({}, S.form, { legs: S.form.legs.filter(function (x, j) { return j !== i; }) }); render(); }
    else if (a === 'post') post();
    else if (a === 'view') { S.view = t.dataset.k; render(); }
    else if (a === 'lf') { S.lf = t.dataset.k; render(); }
    else if (a === 'month') { var m = t.dataset.k === '' ? null : +t.dataset.k; S.month = S.month === m ? null : m; render(); }
    else if (a === 'settle') saveRaw(+id, { res: t.dataset.v });
    else if (a === 'undo') saveRaw(+id, { res: null });
    else if (a === 'lock') { store.lockBet(+id); load(); render(); }
    else if (a === 'import') { var fi = document.getElementById('btImportFile'); if (fi) fi.click(); }
  }
  function importText(text) {
    var I = window.BetTrackerImport; if (!I) return { ok: false, reason: 'no-importer' };
    var w = I.run(text, store, {}), r = w.report || {};
    // F1: no banner — the import's outcome is the return value (console path) and the bankroll strip itself
    if (w.ok) { S.bank = w.bankId; S.month = null; }
    load(); render();
    return w;
  }
  function onFile(e) {
    var t = e.target; if (!t || t.id !== 'btImportFile' || !t.files || !t.files[0]) return;
    var fr = new FileReader(); fr.onload = function () { importText(String(fr.result)); }; fr.readAsText(t.files[0]);
  }
  function onInput(e) {
    var t = e.target, f = t.dataset && t.dataset.f; if (!f || f === 'close' || !root().contains(t)) return;
    if (f === 'rangefrom' || f === 'rangeto') { if (e.type === 'change' && t.value) { S.range = Object.assign({}, S.range); S.range[f === 'rangefrom' ? 'from' : 'to'] = t.value; render(); } return; }
    if (f === 'legtext' || f === 'legodds') {
      var i = +t.dataset.i, key = f === 'legtext' ? 'text' : 'odds';
      S.form = Object.assign({}, S.form, { legs: S.form.legs.map(function (lg, j) { return j === i ? Object.assign({}, lg, (function () { var o = {}; o[key] = t.value; return o; })()) : lg; }) });
    } else { S.form = Object.assign({}, S.form); S.form[f] = t.value; }
    if (e.type === 'change' && (f === 'market' || f === 'book')) render(); else refreshLog();
  }
  // Close: a manual field until locked; CLV recomputes on blur. Empty = no close; anything not a price reverts.
  function onBlur(e) {
    var t = e.target; if (!t.dataset || t.dataset.f !== 'close' || !root().contains(t)) return;
    var id = +t.dataset.id, r = rawOf(id); if (!r) return;
    var v = String(t.value).trim(), close = v === '' ? null : parseFloat(v.replace(',', '.'));
    if (close !== null && !(isFinite(close) && close > 1)) { render(); return; }
    if (close !== null) close = +close.toFixed(2);
    if (close === r.close) return;
    saveRaw(id, { close: close });
  }
  function onKey(e) { var t = e.target; if (e.key === 'Enter' && t.dataset && t.dataset.f === 'close') t.blur(); }
  // F4 (Michael's unlock — the reference has no key handling): Escape closes what is open, through the site's one Escape
  // handler (esc-nav.js: a page registers its layers, it never binds its own key listener). One press closes one
  // layer, the topmost first: a menu (Period, Filters, the cut), a planner day's pop-up, the month / market pop-up,
  // then the Log-a-bet panel.
  (window.sfEscLayers = window.sfEscLayers || []).push(
    { id: 'bt-menu', z: 90, isOpen: function () { return active && !!S.menu; }, close: function () { S.menu = null; render(); } },
    { id: 'bt-day-pop', z: 100, isOpen: function () { return active && !!(root() && root().querySelector('.bt-pday.is-hov')); }, close: clearDayHov },
    { id: 'bt-month-pop', z: 74, isOpen: function () { return active && S.openMonth !== null; }, close: function () { S.openMonth = null; render(); } },
    { id: 'bt-mkt-pop', z: 74, isOpen: function () { return active && !!S.openMkt; }, close: function () { S.openMkt = null; render(); } },
    { id: 'bt-log', z: 72, isOpen: function () { return active && S.logOpen; }, close: function () { S.logOpen = false; render(); } });
  function wire() {
    if (wired) return; var el = root(); if (!el) return; wired = true;
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    el.addEventListener('change', onFile);
    el.addEventListener('focusout', onBlur);
    el.addEventListener('keydown', onKey);
    el.addEventListener('mousemove', onCurveMove);
    el.addEventListener('mouseover', onDayOver);
    el.addEventListener('mouseout', onDayOut);
    el.addEventListener('mouseleave', onCurveLeave, true);
  }

  function setActive(on) { active = !!on; if (!active) return; if (SEED && !seedReady) return seedStore(function () { setActive(active); }); wire(); load(); render(); }
  // #tracker — the page's deep link, the way Picks keeps #picks
  function applyHash() {
    if (location.hash !== '#tracker') return;
    if (typeof sfActivateTabRaw === 'function') sfActivateTabRaw('tracker', '#tracker');   // eslint-disable-line no-undef
    else { document.querySelectorAll('.tabpage').forEach(function (p) { p.classList.toggle('active', p.dataset.page === 'tracker'); }); setActive(true); }
  }
  // Settling or undoing re-renders the whole page (saveRaw → render), so the hero recomputes at once.
  window.TrackerPage = { setActive: setActive, render: render, _state: S, importText: importText,
    removeImport: function () { var w = store.removeImport('bet-analytix', 'bet-analytix'); load(); render(); return w; } };
  applyHash();
})();
