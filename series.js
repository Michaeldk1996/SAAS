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
  function running(n) { return n + ' matches running'; }
  function boTxt(st) { return st.bestOf ? ('best-of-' + st.bestOf) : ''; }
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
        if (st.subtype === 'lost-first-set') return 'Lost the opening set — ' + running(n);
        if (st.subtype === 'won-first-set')  return 'Won the opening set — ' + running(n);
        return streakVerb(st.direction) + ' ' + run;
      case 'total':
        return (st.over ? 'Over ' : 'Under ') + esc(String(st.line)) + ' total games (' + boTxt(st) + ') — ' + running(n);
      case 'handicap':
        return st.cover
          ? 'Won by more than ' + esc(String(st.line)) + ' games — covered −' + esc(String(st.line)) + ' (' + boTxt(st) + '), ' + running(n)
          : 'Beaten by more than ' + esc(String(st.line)) + ' games (' + boTxt(st) + ') — ' + running(n);
      case 'setpat':
        if (st.subtype === 'won-2nd-set')        return 'Won the 2nd set — ' + running(n);
        if (st.subtype === 'lost-2nd-set')       return 'Lost the 2nd set — ' + running(n);
        if (st.subtype === 'straight-sets-win')  return 'Won in straight sets — ' + running(n);
        if (st.subtype === 'straight-sets-loss') return 'Lost in straight sets — ' + running(n);
        if (st.subtype === 'went-the-distance')  return 'Went the distance (reached the deciding set) — ' + running(n);
        if (st.subtype === 'no-set-won')         return 'Failed to win a set — ' + running(n);
        if (st.firstSet) return 'First set ' + (st.over ? 'over ' : 'under ') + esc(String(st.line)) + ' games — ' + running(n);
        return streakVerb(st.direction) + ' ' + run;
      default:
        return streakVerb(st.direction) + ' ' + run;
    }
  }
  var TYPE_BADGE = {
    all: 'All comps', surface: 'Surface', style: 'Vs style', pattern: 'First set',
    total: 'Total games', handicap: 'Handicap', setpat: 'Set pattern',
  };
  // The count block reads "wins"/"losses" only for true result streaks; the line
  // and set-pattern types count matches meeting a condition, not wins.
  function countUnit(st) {
    if (st.type === 'all' || st.type === 'surface' || st.type === 'style') {
      return st.direction === 'win' ? 'wins' : 'losses';
    }
    return st.count === 1 ? 'match' : 'matches';
  }

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
    type: 'all',          // all | all-comp | surface | style | pattern | total | handicap | setpat
    // Default min-length = the founder's view FLOOR (5). Overwritten from the data's
    // rules.viewFloorDefault on load. Buttons can drop BELOW it (the engine emits
    // from 3). vs-style is exempt and floored at 3 (see passesFilters / styleFloor).
    minLen: 5,
    sort: 'longest',      // longest | soonest
    showPlayed: false,    // hide matches already played by default
  };
  function styleFloor() { return (_data && _data.rules && _data.rules.viewFloorStyle) || 3; }

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
    // View floor: the min-length button governs every type EXCEPT vs-style, which
    // the founder floored at 3 ("relevance already filters it"). Style therefore
    // ignores a raised button and always shows from its own floor.
    var floor = (st.type === 'style') ? styleFloor() : f.minLen;
    if (st.count < floor) return false;
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

  // ─── clickable detail: the matches behind the streak ─────────────────────────
  // Founder (2026-09-07): a member should be able to click a card and see the
  // matches that make the run — date, opponent, tournament, surface, and the score
  // line that satisfied the condition. That is what turns a number into something a
  // bettor can judge (18 running vs Challenger fields ≠ 18 vs the top 20). Rendered
  // as an in-card expansion, never a separate page. Guarded: no matches → no panel
  // (older series.json without the field simply shows no toggle, never a broken UI).
  function detailHtml(st) {
    var ms = Array.isArray(st.matches) ? st.matches.slice().reverse() : []; // newest first
    if (!ms.length) return '';
    var rows = ms.map(function (m) {
      var d = fmtDate(m.date) || m.date || '—';
      var won = m.won === true;
      var res = (m.won == null) ? '·' : (won ? 'W' : 'L');
      var opp = m.opponent ? esc(m.opponent) : '<span class="sr-dash">—</span>';
      var tour = m.tournament ? esc(m.tournament) : '<span class="sr-dash">—</span>';
      var surf = m.surface ? esc(cap(m.surface)) : '<span class="sr-dash">—</span>';
      var score = m.score ? esc(m.score) : '<span class="sr-dash">—</span>';
      return '<div class="sr-mrow">' +
        '<span class="sr-mres ' + (m.won == null ? '' : (won ? 'w' : 'l')) + '">' + res + '</span>' +
        '<span class="sr-mdate">' + esc(d) + '</span>' +
        '<span class="sr-mopp">vs ' + opp + '</span>' +
        '<span class="sr-mtour">' + tour + '</span>' +
        '<span class="sr-msurf">' + surf + '</span>' +
        '<span class="sr-mscore">' + score + '</span>' +
      '</div>';
    }).join('');
    return '<div class="sr-detail">' +
      '<div class="sr-detail-head">The ' + esc(String(st.count)) + ' matches in this run — most recent first</div>' +
      '<div class="sr-mtable">' +
        '<div class="sr-mrow sr-mhead">' +
          '<span class="sr-mres"></span><span class="sr-mdate">Date</span>' +
          '<span class="sr-mopp">Opponent</span><span class="sr-mtour">Tournament</span>' +
          '<span class="sr-msurf">Surface</span><span class="sr-mscore">Score</span>' +
        '</div>' + rows +
      '</div></div>';
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
    // Best-of is shown on total/handicap rows so the never-blend rule is visible: a
    // "22.5 games" run means something different across formats, so the row says which.
    if ((st.type === 'total' || st.type === 'handicap') && st.bestOf) badges += '<span class="sr-badge">Best of ' + esc(String(st.bestOf)) + '</span>';

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
    // Opponent archetype makes the vs-style relevance self-evident and auditable:
    // a "vs Counterpuncher" run is only shown when tonight's opponent IS one.
    var oppArch = u.opponentArch ? ' <span class="sr-opparch">· ' + esc(ARCH_LABEL[u.opponentArch] || u.opponentArch) + '</span>' : '';
    var playedTag = u.played ? '<span class="sr-played">played · ' + esc(u.result || 'result') + '</span>' : '';
    var upcoming =
      '<div class="sr-next">' +
        '<span class="sr-next-k">Next</span>' +
        '<span class="sr-next-v">' +
          (when ? '<b>' + esc(when) + '</b> · ' : '') +
          (u.tournament ? esc(u.tournament) + ' · ' : '') +
          (oppName ? 'vs ' + esc(oppName) + oppArch : '<span class="sr-dash">—</span>') +
        '</span>' + playedTag +
      '</div>';

    var hasDetail = Array.isArray(st.matches) && st.matches.length > 0;
    var detailToggle = hasDetail
      ? '<button class="sr-toggle-detail" type="button" aria-expanded="false">' +
          'Show the ' + esc(String(st.count)) + ' matches <span class="sr-chev">▾</span></button>'
      : '';
    var detail = hasDetail ? detailHtml(st) : '';

    return '<article class="sr-card ' + dirClass + (hasDetail ? ' sr-has-detail' : '') + '" data-count="' + esc(String(st.count)) + '">' +
      '<div class="sr-count"><span class="sr-num">' + esc(String(st.count)) + '</span>' +
        '<span class="sr-dir">' + esc(countUnit(st)) + '</span></div>' +
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
        detailToggle +
        detail +
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
      '<label class="sr-flabel">Type</label>' + seg('type', [['all','All'],['all-comp','All comps'],['surface','Surface'],['style','Vs style'],['pattern','First set'],['total','Total games'],['handicap','Handicap'],['setpat','Set patterns']], f.type) +
      '<label class="sr-flabel">Min length</label>' + seg('minLen', [['3','3+'],['4','4+'],['5','5+'],['6','6+'],['7','7+'],['8','8+']], String(f.minLen)) +
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
      ' · min length ' + esc(String(_filters.minLen)) + '+ (vs-style ' + esc(String(styleFloor())) + '+)' +
      ' · one card per player per family' +
      ' · recency cap ' + esc(String(meta.maxAgeDays != null ? meta.maxAgeDays : '45')) + 'd (Grand Slams exempt)' +
      ' · pool floor ' + esc(String(meta.minPoolConditional != null ? meta.minPoolConditional : '8')) + ' for conditional & line types' +
      ' · best-of never blended (games lines locked to the match format)' +
      ' · only streaks that bear on the scheduled match' +
      (gen ? ' · data ' + esc(gen.toISOString().slice(0, 10)) : '') +
    '</p>';

    var body = view.length
      ? '<div class="sr-cards">' + view.map(cardHtml).join('') + '</div>'
      : emptyHtml();

    root.innerHTML = filterBarHtml() + stamp + body + footerHtml();
    wireFilters(root);
  }

  // Two honest empty states. When the engine emitted nothing for the slate, the
  // page is quiet by design — every streak now has to bear on a scheduled match,
  // so an empty board means nothing lined up, not a data gap. When cards exist but
  // the current filters exclude them all, say so and point back at the filters.
  function emptyHtml() {
    var quiet = !_cards || _cards.length === 0;
    if (quiet) {
      return '<p class="sr-empty">No live streaks bear on today or tomorrow’s matches. ' +
        'A run only appears here when it actually applies to what a player plays next — a vs-style run only if tonight’s opponent plays that style, a surface run only if the match is on that surface. ' +
        'Most days that is a short list, and an empty one means nothing is lined up right now — not missing data.</p>';
    }
    return '<p class="sr-empty">No streaks match these filters. ' +
      'Everything shown here already bears on a scheduled match; widen the level, day, direction, type or min length above to see more.</p>';
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
    // Clickable streak detail: toggle the in-card match panel (founder 2026-09-07).
    root.querySelectorAll('.sr-toggle-detail').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.sr-card');
        if (!card) return;
        var open = card.classList.toggle('sr-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        var n = card.getAttribute('data-count') || '';
        btn.innerHTML = open
          ? 'Hide matches <span class="sr-chev">▴</span>'
          : 'Show the ' + esc(n) + ' matches <span class="sr-chev">▾</span>';
      });
    });
  }

  // ─── load / mount ────────────────────────────────────────────────────────────
  function load() {
    if (_mounted) { render(); return; }
    _mounted = true;
    render();  // shows "Loading…"
    fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        _data = j; _cards = null;
        // Adopt the engine's view floor as the default button (never from memory).
        if (j && j.rules && j.rules.viewFloorDefault != null) _filters.minLen = j.rules.viewFloorDefault;
        render();
      })
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
