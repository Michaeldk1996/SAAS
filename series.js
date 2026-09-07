// series.js — TEN-168 Series page front-end.
//
// Renders the current-streak cards for players scheduled today/tomorrow from
// series.json (built offline by build-series.js). A streak is a backward-looking
// artifact, so every card carries the two things the founder made non-negotiable:
// the POOL the run was drawn from and the DATE + age of its most-recent match. A
// streak that can't show both is never emitted by the engine and never rendered
// here.
//
// This shares the Trading Report's foundations so a later merge is wiring, not a
// rewrite: the SAME photo chain (page globals photoCandidatesFor ->
// resolveProfilePhotoUrl -> avatarChainNext, ATP alias first), the SAME tier
// separation (tour / chal, tier visible on every card, never blended), and the
// SAME "missing data is a dash, never a zero" discipline.
//
// Guard: window.FEATURE_SERIES must be truthy. Deploying with the flag OFF (or
// ?series=0 / localStorage stennisfy.flags.series=0) changes nothing live.

(function () {
  'use strict';

  if (!window.FEATURE_SERIES) return;

  var DATA_URL = './series.json';

  // ─── small local helpers (kept module-local, not page globals) ───────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // Country full-name -> ISO2 -> regional-indicator flag. Ported verbatim from
  // trading-report.js so both surfaces read the identical flag from the identical
  // source (player-profiles country string). An unmapped country -> no flag, never
  // a wrong one.
  var NAME2ISO = {
    'Argentina':'AR','Australia':'AU','Austria':'AT','Belarus':'BY','Belgium':'BE',
    'Bolivia':'BO','Bosnia and Herzegovina':'BA','Brazil':'BR','Bulgaria':'BG',
    'Canada':'CA','Chile':'CL','China':'CN','Chinese Taipei':'TW','Colombia':'CO',
    'Croatia':'HR','Cyprus':'CY','Czechia':'CZ','Czech Republic':'CZ','Denmark':'DK',
    'Dominican Republic':'DO','Ecuador':'EC','Egypt':'EG','Estonia':'EE','Finland':'FI',
    'France':'FR','Georgia':'GE','Germany':'DE','Great Britain':'GB','United Kingdom':'GB',
    'Greece':'GR','Hong Kong':'HK','Hungary':'HU','Iceland':'IS','India':'IN','Indonesia':'ID',
    'Iran':'IR','Ireland':'IE','Israel':'IL','Italy':'IT','Japan':'JP','Jordan':'JO',
    'Kazakhstan':'KZ','Korea':'KR','South Korea':'KR','Kosovo':'XK','Kuwait':'KW',
    'Latvia':'LV','Lebanon':'LB','Lithuania':'LT','Luxembourg':'LU','Mexico':'MX',
    'Moldova':'MD','Monaco':'MC','Montenegro':'ME','Morocco':'MA','Netherlands':'NL',
    'New Zealand':'NZ','North Macedonia':'MK','Norway':'NO','Paraguay':'PY','Peru':'PE',
    'Philippines':'PH','Poland':'PL','Portugal':'PT','Qatar':'QA','Romania':'RO',
    'Russia':'RU','Saudi Arabia':'SA','Serbia':'RS','Slovakia':'SK','Slovenia':'SI',
    'South Africa':'ZA','Spain':'ES','Sweden':'SE','Switzerland':'CH','Taiwan':'TW',
    'Thailand':'TH','Tunisia':'TN','Turkey':'TR','Türkiye':'TR','Ukraine':'UA',
    'United States':'US','USA':'US','Uruguay':'UY','Uzbekistan':'UZ','Venezuela':'VE',
    'Zimbabwe':'ZW',
  };
  function emojiFlag(country) {
    var iso = country && NAME2ISO[country];
    if (!iso || iso.length !== 2) return '';
    return iso.toUpperCase().replace(/./g, function (c) {
      return String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0));
    });
  }

  function initials(name) {
    if (typeof playerInitials === 'function') { try { return playerInitials(name); } catch (e) {} }
    var s = String(name || '').trim();
    if (!s) return '?';
    var parts = s.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // The ONE photo chain, reused from the profile pages exactly as the Trading
  // Report does: ATP official alias -> Wikimedia override -> api-tennis logo ->
  // monogram. Guarded so a missing page global degrades to the monogram.
  function avatarHtml(row) {
    var mono = '<span class="sr-mono">' + esc(initials(row.name)) + '</span>';
    var cands = [];
    try {
      var fb = (typeof resolveProfilePhotoUrl === 'function') ? resolveProfilePhotoUrl(row.key, row.name) : null;
      if (typeof photoCandidatesFor === 'function') {
        cands = photoCandidatesFor(row.key, fb);
      } else {
        if (typeof atpPhotoFor === 'function')      cands.push(atpPhotoFor(row.key));
        if (typeof photoOverrideFor === 'function') cands.push(photoOverrideFor(row.key));
        if (fb)                                     cands.push(fb);
      }
    } catch (e) { /* fall through to monogram */ }
    cands = (cands || []).filter(Boolean);
    if (!cands.length) return '<span class="sr-av-wrap">' + mono + '</span>';
    var src = cands[0];
    var rest = cands.slice(1).join('|');
    return '<span class="sr-av-wrap">' + mono +
           '<img class="sr-av" src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
           'data-fb="' + esc(rest) + '" ' +
           'onerror="if(!(typeof avatarChainNext===\'function\'&&avatarChainNext(this)))this.style.display=\'none\'"></span>';
  }

  // ─── plain-English streak description ────────────────────────────────────────
  var ARCH_LABEL = {}; // archetype labels ship already human-readable in the taxonomy
  function streakVerb(dir) { return dir === 'win' ? 'Won' : 'Lost'; }
  function describe(st) {
    var n = st.count;
    var run = n + (n === 1 ? ' match' : ' in a row');
    switch (st.type) {
      case 'all':
        return streakVerb(st.direction) + ' ' + (n === 1 ? '1 match' : n + ' in a row') + ' — all competitions';
      case 'surface':
        return streakVerb(st.direction) + ' ' + n + ' straight on ' + esc(cap(st.subtype));
      case 'style':
        return streakVerb(st.direction) + ' ' + n + ' straight vs ' + esc(ARCH_LABEL[st.subtype] || st.subtype);
      case 'pattern':
        if (st.subtype === 'lost-first-set') return 'Lost the opening set — ' + n + ' matches running';
        if (st.subtype === 'won-first-set')  return 'Won the opening set — ' + n + ' matches running';
        return streakVerb(st.direction) + ' ' + run;
      default:
        return streakVerb(st.direction) + ' ' + run;
    }
  }
  var TYPE_BADGE = { all: 'All comps', surface: 'Surface', style: 'Vs style', pattern: 'First set' };

  // ─── date / age formatting ───────────────────────────────────────────────────
  function fmtDate(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    var p = ymd.split('-');
    var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return Number(p[2]) + ' ' + MON[Number(p[1]) - 1] + ' ' + p[0];
  }
  function fmtAge(days) {
    if (days == null || !isFinite(days)) return null;
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    if (days < 60) return Math.round(days / 7) + 'w ago';
    return Math.round(days / 30) + 'mo ago';
  }
  function fmtTime(t) {
    var s = String(t || '').trim();
    return /^\d{1,2}:\d{2}/.test(s) ? s.slice(0, 5) : '';
  }

  // ─── state ───────────────────────────────────────────────────────────────────
  var _data = null;       // parsed series.json
  var _cards = null;      // flattened [{player, streak}] once
  var _active = false;
  var _mounted = false;

  var _filters = {
    level: 'all',         // all | tour | chal
    day: 'all',           // all | today | tomorrow
    dir: 'all',           // all | win | loss
    type: 'all',          // all | all(comp) | surface | style | pattern  -> stored as engine type or 'all'
    minLen: 3,            // >= this
    sort: 'longest',      // longest | soonest
    showPlayed: false,    // hide matches already played by default
  };

  function flatten(data) {
    var out = [];
    (data.players || []).forEach(function (p) {
      (p.streaks || []).forEach(function (st) {
        // Non-negotiable guard: pool AND recency must both be present, else drop.
        if (st.pool == null || !st.lastDate || st.ageDays == null) return;
        out.push({ player: p, streak: st });
      });
    });
    return out;
  }

  function passesFilters(c) {
    var p = c.player, st = c.streak, f = _filters;
    if (f.level !== 'all' && p.tier !== f.level) return false;
    if (f.day !== 'all' && (p.upcoming && p.upcoming.day) !== f.day) return false;
    if (f.dir !== 'all' && st.direction !== f.dir) return false;
    // UI 'all' = every type; UI 'all-comp' = the engine's all-competitions type
    // ('all'). Translate so the two 'all' meanings don't collide.
    if (f.type !== 'all') {
      var wantType = (f.type === 'all-comp') ? 'all' : f.type;
      if (st.type !== wantType) return false;
    }
    if (st.count < f.minLen) return false;
    if (!f.showPlayed && p.upcoming && p.upcoming.played) return false;
    return true;
  }

  function sortCards(arr) {
    var f = _filters;
    if (f.sort === 'soonest') {
      arr.sort(function (a, b) {
        var da = (a.player.upcoming && a.player.upcoming.date) || '9999';
        var db = (b.player.upcoming && b.player.upcoming.date) || '9999';
        if (da !== db) return da < db ? -1 : 1;
        var ta = (a.player.upcoming && a.player.upcoming.time) || '';
        var tb = (b.player.upcoming && b.player.upcoming.time) || '';
        if (ta !== tb) return ta < tb ? -1 : 1;
        return b.streak.count - a.streak.count;
      });
    } else {
      arr.sort(function (a, b) {
        if (b.streak.count !== a.streak.count) return b.streak.count - a.streak.count;
        // tie-break: bigger pool is the sturdier run
        return (b.streak.pool || 0) - (a.streak.pool || 0);
      });
    }
    return arr;
  }

  // ─── card render ──────────────────────────────────────────────────────────────
  function cardHtml(c) {
    var p = c.player, st = c.streak, u = p.upcoming || {};
    var dirClass = st.direction === 'win' ? 'sr-win' : 'sr-loss';
    var tierTxt = p.tier === 'tour' ? 'Tour' : 'Chal';
    var flag = emojiFlag(p.country);
    var rankTxt = (p.rank != null && p.rank !== '') ? ('#' + p.rank) : '<span class="sr-dash">—</span>';

    // badges: type, tier, plus the subtype (surface/archetype) where meaningful
    var badges = '<span class="sr-badge sr-badge-type">' + esc(TYPE_BADGE[st.type] || st.type) + '</span>' +
                 '<span class="sr-badge sr-badge-tier">' + tierTxt + '</span>';
    if (st.type === 'surface' && st.subtype) badges += '<span class="sr-badge">' + esc(cap(st.subtype)) + '</span>';
    if (st.type === 'style' && st.subtype)   badges += '<span class="sr-badge">' + esc(ARCH_LABEL[st.subtype] || st.subtype) + '</span>';

    // pool + recency — both mandatory, both always shown
    var lastD = fmtDate(st.lastDate) || st.lastDate;
    var age = fmtAge(st.ageDays);
    var slam = st.slamExempt ? ' <span class="sr-slam" title="Most-recent match was a Grand Slam — exempt from the 45-day recency cap">· Grand Slam</span>' : '';
    var poolRecency =
      '<div class="sr-facts">' +
        '<span class="sr-fact"><span class="sr-fact-k">Pool</span><span class="sr-fact-v">' + esc(String(st.pool)) + ' ' + (st.pool === 1 ? 'match' : 'matches') + '</span></span>' +
        '<span class="sr-fact"><span class="sr-fact-k">Last</span><span class="sr-fact-v">' + esc(lastD) + (age ? ' <span class="sr-ago">(' + esc(age) + ')</span>' : '') + slam + '</span></span>' +
      '</div>';

    // upcoming match line
    var when = (u.day ? cap(u.day) : '') + (fmtTime(u.time) ? ' ' + fmtTime(u.time) : '');
    var oppName = u.opponentName || '';
    var playedTag = u.played ? '<span class="sr-played">played · ' + esc(u.result || 'result') + '</span>' : '';
    var upcoming =
      '<div class="sr-next">' +
        '<span class="sr-next-k">Next</span>' +
        '<span class="sr-next-v">' +
          (when ? '<b>' + esc(when) + '</b> · ' : '') +
          (u.tournament ? esc(u.tournament) + ' · ' : '') +
          (oppName ? 'vs ' + esc(oppName) : '<span class="sr-dash">—</span>') +
        '</span>' + playedTag +
      '</div>';

    return '<article class="sr-card ' + dirClass + '">' +
      '<div class="sr-count"><span class="sr-num">' + esc(String(st.count)) + '</span>' +
        '<span class="sr-dir">' + (st.direction === 'win' ? 'wins' : 'losses') + '</span></div>' +
      '<div class="sr-body">' +
        '<div class="sr-phead">' + avatarHtml(p) +
          '<div class="sr-pinfo">' +
            '<div class="sr-pname">' + (flag ? '<span class="sr-flag">' + flag + '</span>' : '') + esc(p.name || u.playerName || '—') + '</div>' +
            '<div class="sr-prank">' + rankTxt + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="sr-desc">' + describe(st) + '</div>' +
        '<div class="sr-badges">' + badges + '</div>' +
        poolRecency +
        upcoming +
      '</div>' +
    '</article>';
  }

  // ─── filter bar ────────────────────────────────────────────────────────────────
  function seg(name, opts, cur) {
    return '<div class="sr-seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button class="sr-segbtn' + (o[0] === cur ? ' active' : '') + '" data-val="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function filterBarHtml() {
    var f = _filters;
    return '<div class="sr-filters">' +
      '<label class="sr-flabel">Level</label>' + seg('level', [['all','All'],['tour','ATP'],['chal','Challenger']], f.level) +
      '<label class="sr-flabel">Day</label>' + seg('day', [['all','All'],['today','Today'],['tomorrow','Tomorrow']], f.day) +
      '<label class="sr-flabel">Direction</label>' + seg('dir', [['all','All'],['win','Wins'],['loss','Losses']], f.dir) +
      '<label class="sr-flabel">Type</label>' + seg('type', [['all','All'],['all-comp','All comps'],['surface','Surface'],['style','Vs style'],['pattern','First set']], f.type) +
      '<label class="sr-flabel">Min length</label>' + seg('minLen', [['3','3+'],['4','4+'],['5','5+'],['6','6+']], String(f.minLen)) +
      '<label class="sr-flabel">Sort</label>' + seg('sort', [['longest','Longest'],['soonest','Soonest']], f.sort) +
      '<label class="sr-toggle"><input type="checkbox" id="srShowPlayed"' + (f.showPlayed ? ' checked' : '') + '> Show already-played</label>' +
    '</div>';
  }

  // ─── render ────────────────────────────────────────────────────────────────────
  function render() {
    var root = document.getElementById('seriesGrid');
    if (!root) return;
    if (!_data) { root.innerHTML = '<p class="sr-empty">Loading streaks…</p>'; return; }
    if (!_cards) _cards = flatten(_data);

    var view = sortCards(_cards.filter(passesFilters));
    var meta = _data.rules || {};
    var gen = _data.generatedAt ? new Date(_data.generatedAt) : null;

    var stamp = '<p class="sr-stamp">' +
      esc(String(view.length)) + ' streak' + (view.length === 1 ? '' : 's') +
      ' · min length ' + esc(String(meta.minLen != null ? meta.minLen : _filters.minLen)) +
      ' · recency cap ' + esc(String(meta.maxAgeDays != null ? meta.maxAgeDays : '45')) + 'd (Grand Slams exempt)' +
      ' · pool floor ' + esc(String(meta.minPoolConditional != null ? meta.minPoolConditional : '8')) + ' for conditional types' +
      (gen ? ' · data ' + esc(gen.toISOString().slice(0, 10)) : '') +
    '</p>';

    var body = view.length
      ? '<div class="sr-cards">' + view.map(cardHtml).join('') + '</div>'
      : '<p class="sr-empty">No streaks match these filters. A streak only shows if it clears the min length, the pool floor, and the recency cap — that is the honesty guard, not a data gap.</p>';

    root.innerHTML = filterBarHtml() + stamp + body + footerHtml();
    wireFilters(root);
  }

  function footerHtml() {
    // Founder-approved (2026-09-07) honesty note. Rendered at the foot of the page.
    return '<footer class="sr-footer">' +
      '<h3>How to read the Series page</h3>' +
      '<p>Every row here is a streak — a run of results that already happened. That is the whole of it. A streak describes the past; it does not forecast the next match. The player who has won five in a row is not owed a sixth.</p>' +
      '<p>Read two numbers before you read anything else. <b>The pool:</b> how many matches the run was drawn from — five wins from eight is worth a look; five from two hundred is a coincidence you were always going to find. <b>The date:</b> when the most recent match in the run was played — form is a live thing, and a run whose last match was months ago is history, not a signal. Every card shows both, and a streak that can’t show both doesn’t appear.</p>' +
      '<p>Scan enough players across enough angles and long runs turn up by chance alone. That is exactly why the pool and the date are non-negotiable here, and why I would rather show you a short honest streak than a long manufactured one. Use this to find a situation worth a second look — then go and do the work. It is a place to start an argument, not to end one.</p>' +
    '</footer>';
  }

  function wireFilters(root) {
    root.querySelectorAll('.sr-seg').forEach(function (segEl) {
      segEl.addEventListener('click', function (e) {
        var b = e.target.closest('.sr-segbtn');
        if (!b) return;
        var key = segEl.getAttribute('data-seg');
        var val = b.getAttribute('data-val');
        _filters[key] = (key === 'minLen') ? Number(val) : val;
        render();
      });
    });
    var cb = root.querySelector('#srShowPlayed');
    if (cb) cb.addEventListener('change', function () { _filters.showPlayed = cb.checked; render(); });
  }

  // ─── load / mount ────────────────────────────────────────────────────────────
  function load() {
    if (_mounted) { render(); return; }
    _mounted = true;
    render();  // shows "Loading…"
    fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { _data = j; _cards = null; render(); })
      .catch(function (e) {
        console.warn('[series] load failed:', e.message);
        var root = document.getElementById('seriesGrid');
        if (root) root.innerHTML = '<p class="sr-empty">Streak data is not available right now. It refreshes with the daily slate — check back shortly.</p>';
      });
  }

  function setActive(isActive) {
    if (isActive && !_active) { _active = true; load(); }
    else if (!isActive) { _active = false; }
  }

  (function revealNavTab() {
    var show = function () {
      var btn = document.getElementById('seriesTabBtn');
      if (btn) btn.style.display = '';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  })();

  window.SeriesPage = { setActive: setActive };
})();
