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
  var DASH = M.DASH;
  var CHIP = { won: 'WON', lost: 'LOST', void: 'VOID' };
  var SEAL_SVG = '<svg viewBox="0 0 24 24" width="7" height="7" fill="none" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"></path></svg>';
  var FORM0 = { legs: [{ text: '', odds: '' }], tour: '', market: 'Match winner', marketOther: '', level: '500', surface: 'Indoor hard', book: 'bet105', bookOther: '', stake: '', timing: 'pre', type: 'Single' };

  var NOF = function () { return { level: [], odds: [], surface: [], market: [] }; };
  var S = { bank: null, view: 'results', lf: 'all', month: null, logOpen: false, form: JSON.parse(JSON.stringify(FORM0)), banks: [], raw: [], importMsg: '',
    period: 'season', range: null, filters: NOF(), menu: null, openDay: null, openMonth: null };
  // The Bet-Analytix import (T1b): admin only — the control is not in the design (reported); the console path is
  // TrackerPage.importText(csvText). The file is read in this browser and goes nowhere else.
  function isAdmin() { return typeof window.isBspAdmin === 'function' && !!window.isBspAdmin(); }
  var active = false, wired = false;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function root() { return document.getElementById('trackerRoot'); }
  function todayDate() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
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

  // ── markup (template lines 19–417) ──────────────────────────────────────────────────────────────────────────────
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
      + '<div class="bt-strip">' + cards + '<div class="bt-addbank" data-act="addbank"><span class="bt-addbank-plus">+</span><span class="bt-addbank-lbl">Add bankroll</span></div></div>' + archived + '</div>';
  }
  function seal(row) { return '<span class="bt-seal' + (row ? ' is-row' : '') + '"' + (row ? ' title="Locked result · certified, cannot be edited"' : '') + '>' + SEAL_SVG + '</span>'; }
  function header(cur, all, ctx) {
    return '<div class="bt-head"><div class="bt-head-l"><span class="bt-caps">Bet Tracker</span>'
      + '<span class="bt-title"><span class="bt-bankname">' + esc(cur.name) + '</span><span class="bt-cert" title="Every locked result is frozen — it cannot be edited or deleted. The blue seal on a ledger row marks a locked result.">'
      + seal(false) + esc(M.certText(all)) + '</span></span>'
      + '<span class="bt-headmeta">' + esc(M.headMeta(all, ctx.list, ctx.perList, ctx.per, ctx.win, ctx.range, ctx.nF, ctx.today)) + '</span>'
      + (S.importMsg ? '<span class="bt-importmsg">' + esc(S.importMsg) + '</span>' : '') + '</div>'
      + '<div class="bt-head-r">' + (isAdmin() ? '<span class="bt-import" data-act="import" title="Admin · import a Bet-Analytix CSV export into its own bankroll">Import CSV</span>'
        + '<input type="file" accept=".csv,text/csv" class="bt-importfile" id="btImportFile" hidden>' : '')
      + '<span class="bt-logbtn" data-act="logtoggle">' + (S.logOpen ? 'Close' : '+ Log a bet') + '</span></div></div>';
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
  function logPanel(cur) {
    var f = S.form, c = M.formCheck(f);
    var legs = f.legs.map(function (lg, i) {
      return '<div class="bt-leg"><span class="bt-caps10">' + (f.type === 'Single' ? 'Bet' : 'Leg ' + (i + 1)) + '</span>'
        + '<input class="bt-in" data-f="legtext" data-i="' + i + '" value="' + esc(lg.text) + '" placeholder="A. de Minaur to win">'
        + '<input class="bt-in bt-mono" data-f="legodds" data-i="' + i + '" value="' + esc(lg.odds) + '" placeholder="odds 2.10">'
        + (f.type === 'Parlay' && f.legs.length > 2 ? '<span class="bt-legx" data-act="rmleg" data-i="' + i + '" title="Remove this leg">×</span>' : '') + '</div>';
    }).join('');
    var other = (f.market === 'Other' || f.book === 'Other') ? '<div class="bt-rowother">'
      + (f.market === 'Other' ? field('Market · your own', '<input class="bt-in" data-f="marketOther" value="' + esc(f.marketOther) + '" placeholder="e.g. Most aces">') : '')
      + (f.book === 'Other' ? field('Bookmaker · your own', '<input class="bt-in" data-f="bookOther" value="' + esc(f.bookOther) + '" placeholder="your local book">') : '') + '</div>' : '';
    return '<div class="bt-log"><div class="bt-log-head"><span class="bt-caps">Log a bet · ' + esc(cur.name) + '</span>'
      + '<div class="bt-log-segs"><span class="bt-seglbl">Type</span>' + seg('type', [['Single', 'Single'], ['Combination', 'Combination'], ['Parlay', 'Parlay']])
      + '<span class="bt-seglbl is-gap">Placed</span>' + seg('timing', [['pre', 'Pre-match'], ['live', 'Live · in play']]) + '</div></div>'
      + '<div class="bt-legs">' + legs + (f.type === 'Parlay' ? '<span class="bt-addleg" data-act="addleg">+ Add a leg</span>' : '')
      + '<span class="bt-legsnote" id="btLegsNote">' + esc(M.legsNote(f)) + '</span></div>'
      + '<div class="bt-row1">' + field('Tournament', '<input class="bt-in" data-f="tour" value="' + esc(f.tour) + '" placeholder="Vienna">')
      + field('Level', '<select class="bt-in" data-f="level">' + options(M.LEVEL_KEYS.map(function (k) { return M.LEVEL[k]; }), f.level, M.LEVEL_KEYS) + '</select>')
      + field('Surface', '<select class="bt-in" data-f="surface">' + options(M.SURFACES, f.surface) + '</select>') + '</div>'
      + '<div class="bt-row2">' + field('Market', '<select class="bt-in" data-f="market">' + options(M.MARKETS.concat('Other — type it'), f.market, M.MARKETS.concat('Other')) + '</select>')
      + field('Bookmaker', '<select class="bt-in" data-f="book">' + options(M.BOOKS.concat('Other — type it'), f.book, M.BOOKS.concat('Other')) + '</select>') + '</div>'
      + '<div class="bt-row3"><div class="bt-field"><span class="bt-caps10">' + (f.type === 'Single' ? 'Odds' : 'Combined odds') + '</span><span class="bt-odds' + (c.legsOk ? ' is-ok' : '') + '" id="btOdds">' + esc(c.oddsText) + '</span></div>'
      + field('Stake · %', '<input class="bt-in bt-mono" data-f="stake" value="' + esc(f.stake) + '" placeholder="1.0">')
      + '<span class="bt-post' + (c.valid ? ' is-ok' : '') + '" id="btPost" data-act="post">Post bet</span></div>'
      + other + '<span class="bt-hint' + (c.valid ? ' is-ok' : '') + '" id="btHint">' + esc(c.hint) + '</span></div>';
  }
  // ── 4 · hero (README §4): headline · Period · Filters · View · curve · seven tiles ──────────────────────────────
  var CARET = '<span class="bt-caret">▼</span>';
  var SLIDERS = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4"></path></svg>';
  function mrow(act, attrs, label, on, n, zero) {
    return '<span class="bt-mrow' + (on ? ' on' : '') + (zero ? ' is-zero' : '') + '" data-act="' + act + '"' + attrs + '>' + label
      + (n == null ? '<span class="bt-tick">' + (on ? '✓' : '') + '</span>' : '<span class="bt-mrow-r"><span class="bt-mrow-n">' + n + '</span><span class="bt-tick">' + (on ? '✓' : '') + '</span></span>') + '</span>';
  }
  function hero(ctx) {
    var HT = M.heroTiles(M.stats(ctx.list)), HC = M.heroCurve(ctx.list, ctx.today), D = M.discipline(ctx.list, M.MIN_SAMPLE);
    var perOn = S.menu === 'period' || S.period !== 'season', fOn = S.menu === 'filters' || ctx.nF > 0;
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
      return '<div class="bt-htile"><span class="bt-caps bt-nowrap">' + esc(r.label) + '</span><span class="bt-htile-fig bt-' + r.kind + '">' + esc(r.value) + '</span><span class="bt-htile-sub">' + esc(r.sub) + '</span></div>';
    }).join('');
    return '<div class="bt-card bt-hero"><div class="bt-hero-top"><div class="bt-hero-l"><span class="bt-caps">Profit · % of bankroll</span>'
      + '<span class="bt-profitrow"><span class="bt-profit bt-' + HT.profitKind + '">' + esc(HT.profit) + '</span><span class="bt-profitsub">' + esc(HT.profitSub) + '</span></span></div>'
      + '<div class="bt-hero-r"><span class="bt-curvemeta">' + esc(HC.meta) + '</span>'
      + '<span class="bt-rel"><span class="bt-trig' + (perOn ? ' on' : '') + '" data-act="menu" data-k="period">' + esc(M.PERIODS[S.period]) + CARET + '</span>' + pmenu + '</span>'
      + '<span class="bt-rel"><span class="bt-trig' + (fOn ? ' on' : '') + '" data-act="menu" data-k="filters">' + SLIDERS + esc(M.filtersLabel(S.filters)) + CARET + '</span>' + fmenu + '</span>'
      + '<span class="bt-views">' + v('results', 'Results') + v('insights', 'Insights', '<span class="bt-view-badge bt-' + D.badgeTone + '">' + esc(D.badge) + '</span>')
      + v('staking', 'Staking', S.appliedPlan ? '<span class="bt-plandot"></span>' : '') + '</span></div></div>'
      + '<div class="bt-curve">' + svg + labels + '</div>'
      + '<div class="bt-ddrow"><span>○ red = deepest drawdown</span><span>' + esc(HC.ddNote) + '</span></div>'
      + '<div class="bt-htiles">' + tiles + '</div></div>';
  }
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

  // ── 5 · Calendar (README §5): 26-week heat grid + pinned record · months table · month pop-up ─────────────────
  function tint(kindName, pct) { return 'background:color-mix(in srgb, var(--' + kindName + ') ' + pct + '%, transparent)'; }
  function dayRows(rows, cls) {
    return rows.map(function (r) {
      return '<span class="' + cls + '"><span class="bt-dr-t"><span class="bt-dr-text">' + esc(r.text) + '</span><span class="bt-dr-meta">' + esc(r.meta) + '</span></span>'
        + '<span class="bt-dr-res bt-' + r.resKind + '">' + esc(r.res) + '</span><span class="bt-dr-pl bt-' + r.plKind + '">' + esc(r.pl) + '</span></span>';
    }).join('');
  }
  function calendar(ctx) {
    var H = M.heatGrid(ctx.all, ctx.today), open = null;
    var cells = H.cells.map(function (c) {
      var sel = S.openDay === c.key && c.has; if (sel) open = c;
      var style = c.tone === 'pos' || c.tone === 'neg' ? tint(c.tone, Math.round(c.alpha * 100)) : '';
      var pop = c.has ? '<span class="bt-hpop' + (c.flip ? ' is-flip' : '') + '"><span class="bt-hpop-h"><span class="bt-hpop-t">' + esc(c.title) + '</span><span class="bt-hpop-s">' + esc(c.sub) + '</span></span>'
        + dayRows(c.rows, 'bt-hpop-r') + '<span class="bt-hpop-f">Click the day to pin it</span></span>' : '';
      return '<span class="bt-hc is-' + c.tone + (c.has ? ' has' : '') + (sel ? ' is-sel' : '') + '"' + (c.has ? ' data-act="day" data-k="' + c.key + '"' : ' title="' + esc(c.t) + '"')
        + (style ? ' style="' + style + '"' : '') + '>' + esc(c.fig) + pop + '</span>';
    }).join('');
    var rec = open ? '<div class="bt-hrec"><div class="bt-hrec-h"><span class="bt-hrec-hl"><span class="bt-hrec-t">' + esc(open.title) + '</span><span class="bt-hrec-s">' + esc(open.sub) + '</span></span>'
      + '<span class="bt-hrec-x" data-act="dayclose">Close</span></div>' + dayRows(open.rows, 'bt-hrec-r') + '</div>' : '';
    var heat = '<div class="bt-card bt-heat"><div class="bt-hmonths">' + H.months.map(function (m) { return '<span style="left:' + m.left + '">' + esc(m.label) + '</span>'; }).join('') + '</div>'
      + '<div class="bt-hbody"><div class="bt-hdays">' + H.days.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div><div class="bt-hgrid">' + cells + '</div></div>' + rec
      + '<div class="bt-hfoot"><span>' + esc(H.meta) + '</span><span class="bt-legend"><span>loss</span><span class="bt-sw" style="' + tint('neg', 85) + '"></span><span class="bt-sw" style="' + tint('neg', 35) + '"></span>'
      + '<span class="bt-sw is-flat"></span><span class="bt-sw" style="' + tint('pos', 35) + '"></span><span class="bt-sw" style="' + tint('pos', 85) + '"></span><span>win · figure = € that day</span></span></div></div>';
    var MT = M.monthsTable(ctx.all, ctx.today);
    var months = '<div class="bt-card bt-mtab"><div class="bt-mgrid bt-mhead"><span class="bt-caps10">Month</span><span class="bt-caps10 bt-r">Bets</span><span class="bt-caps10 bt-c">ROI</span><span class="bt-caps10 bt-r">P/L</span></div>'
      + MT.map(function (m) {
        return '<div class="bt-mgrid bt-mrowt' + (S.openMonth === m.key ? ' is-open' : '') + '" data-act="openmonth" data-k="' + m.key + '"><span class="bt-mname">' + esc(m.name) + '</span><span class="bt-mn">' + m.n + '</span>'
          + '<span class="bt-roibar"><span class="bt-roitick"></span><span class="bt-roifill bt-bg-' + m.bar.kind + '" style="left:' + m.bar.left + ';width:' + m.bar.width + '"></span></span><span class="bt-mpl bt-' + m.plKind + '">' + esc(m.pl) + '</span></div>';
      }).join('') + '</div>';
    var om = MT.find(function (m) { return m.key === S.openMonth; }), pop = '';
    if (om) {
      var P = M.monthPop(om.key, om.bets, ctx.today);
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
    return '<div class="bt-cal"><div class="bt-headrow"><span class="bt-h16">Calendar</span><span class="bt-sub125">Last 26 weeks, one cell a day · the figure is that day\'s result in € on a 10,000 € bankroll · hover a day for its bets, click to pin the record. Months on the right over the whole season — click one for its full record.</span></div>'
      + '<div class="bt-calgrid">' + heat + months + '</div></div>' + pop;
  }

  function render() {
    var el = root(); if (!el) return;
    var cur = S.banks.find(function (b) { return b.id === S.bank; }) || S.banks[0];
    var all = betsOf(cur.id), today = todayDate();
    // Custom range: opens on the bankroll's first bet → today (the reference hard-codes its demo season's dates)
    if (!S.range) S.range = { from: all.length ? dayKey(all[0].date) : dayKey(new Date(today.getFullYear(), 0, 1)), to: dayKey(today) };
    var win = M.periodWindow(S.period, S.range, today), perList = M.inPeriod(all, win), list = M.applyFilters(perList, S.filters);
    var ctx = { all: all, list: list, perList: perList, win: win, today: today, per: S.period, range: S.range, nF: M.nFilters(S.filters) };
    var view = S.view === 'results' ? ledger(list) + calendar(ctx) : '<div class="bt-card bt-frame">' + DASH + '</div>';
    el.innerHTML = '<section class="bt-sec"><div class="bt-col"><div class="bt-stack">'
      + bankrolls() + header(cur, all, ctx) + (S.logOpen ? logPanel(cur) : '') + hero(ctx) + view + '</div></div></section>';
  }
  // live form figures without a re-render (keeps the caret in the field being typed in)
  function refreshLog() {
    var c = M.formCheck(S.form), o = document.getElementById('btOdds'), p = document.getElementById('btPost'), h = document.getElementById('btHint'), n = document.getElementById('btLegsNote');
    if (o) { o.textContent = c.oddsText; o.classList.toggle('is-ok', c.legsOk); }
    if (p) p.classList.toggle('is-ok', c.valid);
    if (h) { h.textContent = c.hint; h.classList.toggle('is-ok', c.valid); }
    if (n) n.textContent = M.legsNote(S.form);
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
    if (a === 'bank') { S.bank = id; S.month = null; S.filters = NOF(); S.range = null; S.openDay = null; S.openMonth = null; render(); }
    else if (a === 'archive') {
      e.stopPropagation();
      var bk = S.banks.find(function (b) { return b.id === id; }); store.saveBank(Object.assign({}, bk, { archived: true }));
      if (S.bank === id) { var rest = S.banks.filter(function (b) { return !b.archived && b.id !== id; }); if (rest[0]) S.bank = rest[0].id; }
      load(); render();
    }
    else if (a === 'restore') { var rb = S.banks.find(function (b) { return b.id === id; }); store.saveBank(Object.assign({}, rb, { archived: false })); load(); render(); }
    else if (a === 'delete') { if (store.deleteBank(id).ok) { load(); render(); } }
    else if (a === 'addbank') { var nid = 'b' + Date.now(); store.saveBank({ id: nid, name: 'New bankroll ' + (S.banks.length + 1), archived: false }); S.bank = nid; S.month = null; S.filters = NOF(); S.range = null; load(); render(); }
    else if (a === 'day') { S.openDay = S.openDay === t.dataset.k ? null : t.dataset.k; render(); }
    else if (a === 'dayclose') { S.openDay = null; render(); }
    else if (a === 'openmonth') { S.openMonth = +t.dataset.k; render(); }
    else if (a === 'monthclose') { S.openMonth = null; render(); }
    else if (a === 'menu') { S.menu = S.menu === t.dataset.k ? null : t.dataset.k; render(); }
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
    S.importMsg = w.ok ? 'Imported ' + w.stored + ' bets into BSP Consult Bet-Analytix · ' + r.settled + ' settled · ' + r.pending + ' pending'
      : 'Import refused · ' + (w.reason === 'already-imported' ? 'this bankroll already holds the import (TrackerPage.removeImport() wipes it first)' : w.reason === 'file' ? 'the file does not read as a Bet-Analytix export' : w.reason);
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
  function wire() {
    if (wired) return; var el = root(); if (!el) return; wired = true;
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    el.addEventListener('change', onFile);
    el.addEventListener('focusout', onBlur);
    el.addEventListener('keydown', onKey);
  }

  function setActive(on) { active = !!on; if (!active) return; wire(); load(); render(); }
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
