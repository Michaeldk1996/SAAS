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
//
// Detail panel score line: series.json carries the per-set games line (e.g.
// "6-4 7-5 6-4"), player POV — the actual games behind a total/handicap cover,
// not the set tally. Rendered verbatim; a dash when scores[] carried no games.

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
  // Effective card FAMILY, computed from type+subtype so grouping/filtering/badges are
  // correct regardless of the engine version that wrote series.json (fix #5). The former
  // 'firstset'/'setpat' families map here to the split 'setout' / 'setgames'.
  function famOf(st) {
    if (st.type === 'pattern') return 'setout';                 // first-set outcome
    if (st.type === 'setpat')  return st.firstSet ? 'setgames' : 'setout';
    return st.family || st.type;                                 // total/handicap/all/surface/style
  }
  var FAM_BADGE = {
    all: 'All comps', surface: 'Surface', style: 'Vs style',
    total: 'Total games', handicap: 'Handicap',
    setout: 'Set outcome', setgames: 'Set games',
  };
  // Card colour VALENCE (fix #2). Result runs have a genuine good/bad direction for the
  // player (win = green, loss = orange). Betting-LINE runs (total games, handicap) and
  // volatility set-shapes (went the distance, first-set games line) have NO good/bad —
  // over 21.5 isn't "better" than under 22.5, it's a different direction — so they are
  // coloured NEUTRAL, never green/orange, so the border can't misread as a verdict.
  function valence(st) {
    if (st.type === 'total' || st.type === 'handicap') return 'neutral';
    if (st.type === 'setpat' && (st.firstSet || st.subtype === 'went-the-distance')) return 'neutral';
    return st.direction === 'win' ? 'win' : 'loss';
  }
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
  var _view = null;       // current filtered+sorted view (index space for card clicks)
  var _active = false;
  var _mounted = false;

  var _filters = {
    level: 'all',         // all | tour | chal
    day: 'all',           // all | today | tomorrow
    dir: 'all',           // all | win | loss
    type: 'all',          // all | all-comp | surface | style | total | handicap | setout | setgames
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
      var wantFam = (f.type === 'all-comp') ? 'all' : f.type;
      if (famOf(st) !== wantFam) return false;
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
  // The match table shown INSIDE the overlay (founder 2026-09-07 fix #1): FOUR columns
  // — Date, Event, Opponent, Score — nothing truncated. The opponent is what tells a
  // member whether a 12-match run came against qualifiers or seeds. The score is the
  // set scores as played, tiebreaks included (e.g. "7-6(5) 6-4"), read straight from
  // the engine's `score` field; a missing field is a dash, never a guess. Newest first.
  function detailTableHtml(st) {
    var ms = Array.isArray(st.matches) ? st.matches.slice().reverse() : []; // newest first
    if (!ms.length) return '';
    var dash = '<span class="sr-dash">—</span>';
    var rows = ms.map(function (m) {
      var d = fmtDate(m.date) || m.date || dash;
      var tour = m.tournament ? esc(m.tournament) : dash;
      var opp = m.opponent ? esc(m.opponent) : dash;
      var score = m.score ? esc(m.score) : dash;
      return '<div class="sr-mrow">' +
        '<span class="sr-mdate">' + esc(d) + '</span>' +
        '<span class="sr-mtour">' + tour + '</span>' +
        '<span class="sr-mopp">' + opp + '</span>' +
        '<span class="sr-mscore">' + score + '</span>' +
      '</div>';
    }).join('');
    return '<div class="sr-mtable sr-mtable-4">' +
      '<div class="sr-mrow sr-mhead">' +
        '<span class="sr-mdate">Date</span>' +
        '<span class="sr-mtour">Event</span>' +
        '<span class="sr-mopp">Opponent</span>' +
        '<span class="sr-mscore">Score</span>' +
      '</div>' + rows +
    '</div>';
  }

  // ─── card render ──────────────────────────────────────────────────────────────
  // idx is the card's position in the current view — the whole card is the click
  // target (founder 2026-09-07) and carries it as data-card-idx so the click
  // handler can open the matches overlay for exactly this streak.
  function cardHtml(c, idx) {
    var p = c.player, st = c.streak, u = p.upcoming || {};
    var v = valence(st);
    var dirClass = v === 'win' ? 'sr-win' : (v === 'loss' ? 'sr-loss' : 'sr-neutral');
    var tierTxt = p.tier === 'tour' ? 'Tour' : 'Chal';
    var flag = emojiFlag(p.country);
    var rankTxt = (p.rank != null && p.rank !== '') ? ('#' + p.rank) : '<span class="sr-dash">—</span>';

    // badges: type, tier, plus the subtype (surface/archetype) where meaningful
    var badges = '<span class="sr-badge sr-badge-type">' + esc(FAM_BADGE[famOf(st)] || st.type) + '</span>' +
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
    // Played-match tag (fix #3): show whether the streak's OWN condition held —
    // CONTINUED / BROKEN — not the match result. Excluded (couldn't evaluate) reads
    // "not evaluable" and is left out of the summary counts. The set-tally result is
    // kept as a quiet secondary. Legacy data with no outcome falls back to the tally.
    var playedTag = '';
    if (u.played) {
      var oc = st.outcome;
      var resSmall = u.result ? ' <span class="sr-played-res">' + esc(u.result) + '</span>' : '';
      if (oc && oc.held === true)        playedTag = '<span class="sr-oc sr-oc-cont">Continued</span>' + resSmall;
      else if (oc && oc.held === false)  playedTag = '<span class="sr-oc sr-oc-broke">Broken</span>' + resSmall;
      else if (oc && oc.evaluable === false) playedTag = '<span class="sr-oc sr-oc-na" title="The played match could not be evaluated for this streak’s condition — excluded from the continued/broken count">Not evaluable</span>' + resSmall;
      else playedTag = '<span class="sr-played">played · ' + esc(u.result || 'result') + '</span>';
    }
    var upcoming =
      '<div class="sr-next">' +
        '<span class="sr-next-k">Next</span>' +
        '<span class="sr-next-v">' +
          (when ? '<b>' + esc(when) + '</b> · ' : '') +
          (u.tournament ? esc(u.tournament) + ' · ' : '') +
          (oppName ? 'vs ' + esc(oppName) + oppArch : '<span class="sr-dash">—</span>') +
        '</span>' + playedTag +
      '</div>';

    // Whole card is clickable when it has a match list to show. It opens the matches
    // in an overlay (never an inline expand — that reflowed the board). Keyboard-
    // reachable as a button; a quiet hint sits at the foot so the affordance reads.
    var hasDetail = Array.isArray(st.matches) && st.matches.length > 0;
    var clickAttrs = hasDetail
      ? ' role="button" tabindex="0" aria-haspopup="dialog"' +
        ' aria-label="Show the ' + esc(String(st.count)) + ' matches in this run"' +
        ' data-card-idx="' + esc(String(idx)) + '"'
      : '';
    var hint = hasDetail
      ? '<div class="sr-cardhint">Show the ' + esc(String(st.count)) + ' matches <span class="sr-chev">→</span></div>'
      : '';

    return '<article class="sr-card ' + dirClass + (hasDetail ? ' sr-has-detail' : '') + '" data-count="' + esc(String(st.count)) + '"' + clickAttrs + '>' +
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
        hint +
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
      '<label class="sr-flabel">Type</label>' + seg('type', [['all','All'],['all-comp','All comps'],['surface','Surface'],['style','Vs style'],['total','Total games'],['handicap','Handicap'],['setout','Set outcome'],['setgames','Set games']], f.type) +
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
    _view = view;  // card clicks index into this exact list
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

    root.innerHTML = filterBarHtml() + legendHtml() + outcomesSummaryHtml(view) + stamp + body + footerHtml();
    wireFilters(root);
  }

  // Border-colour legend (fix #2). The card's left border encodes what KIND of run it
  // is, and — for result runs only — its direction. Betting-line runs are neutral
  // because over/under and handicap have no good/bad side.
  function legendHtml() {
    return '<div class="sr-legend" aria-hidden="false">' +
      '<span class="sr-lgi"><span class="sr-lgsw sr-lgsw-win"></span>Winning run</span>' +
      '<span class="sr-lgi"><span class="sr-lgsw sr-lgsw-loss"></span>Losing run</span>' +
      '<span class="sr-lgi"><span class="sr-lgsw sr-lgsw-neutral"></span>Neutral run — betting lines (over/under, handicap) &amp; set-shape volatility: a direction, not good or bad</span>' +
    '</div>';
  }

  // CONTINUED/BROKEN summary (fix #3), shown only in the already-played view. Counts
  // over the played cards CURRENTLY in view whose condition could be evaluated; the
  // "not evaluable" cards are reported separately and excluded from the percentage —
  // never guessed (founder standing rule).
  function outcomesSummaryHtml(view) {
    if (!_filters.showPlayed) return '';
    var played = view.filter(function (c) {
      return c.player.upcoming && c.player.upcoming.played && c.streak.outcome;
    });
    if (!played.length) return '';
    var cont = 0, broke = 0, excl = 0;
    played.forEach(function (c) {
      var oc = c.streak.outcome;
      if (oc.held === true) cont++;
      else if (oc.held === false) broke++;
      else excl++;
    });
    var evald = cont + broke;
    var pct = evald ? Math.round(100 * cont / evald) : null;
    return '<div class="sr-outsum">' +
      '<span class="sr-outsum-k">Already-played conditions</span> ' +
      '<b>' + cont + '</b> continued · <b>' + broke + '</b> broken' +
      (evald ? ' · <b>' + pct + '%</b> held (' + evald + ' evaluated)' : '') +
      (excl ? ' · ' + excl + ' excluded (not evaluable)' : '') +
    '</div>';
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
    // Clickable streak detail (founder 2026-09-07): the WHOLE card opens the matches
    // in an overlay on top of the board — never an inline expand, which reflowed the
    // grid. Delegated on the persistent grid, wired ONCE (render() replaces the grid's
    // innerHTML each pass, but the grid element itself lives — re-adding would leak).
    if (!root._srCardWired) {
      root._srCardWired = true;
      root.addEventListener('click', function (e) {
        var card = e.target.closest('.sr-card.sr-has-detail');
        if (!card || !root.contains(card)) return;
        openOverlay(card.getAttribute('data-card-idx'));
      });
      root.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        var card = e.target.closest('.sr-card.sr-has-detail');
        if (!card || !root.contains(card)) return;
        e.preventDefault();
        openOverlay(card.getAttribute('data-card-idx'));
      });
    }
  }

  // ─── matches overlay ────────────────────────────────────────────────────────────
  // A single reusable dialog appended to <body>. Because it is position:fixed on top
  // of a full-screen backdrop, the board underneath never reflows — closing it leaves
  // the reader exactly where they were. Closes on click-outside, on the ✕, and on
  // Escape. Focus is moved in on open and restored to the card on close.
  var _ov = null, _ovReturnFocus = null;
  function ensureOverlay() {
    if (_ov) return _ov;
    var back = document.createElement('div');
    back.className = 'sr-ov-back';
    back.setAttribute('hidden', '');
    back.innerHTML =
      '<div class="sr-ov" role="dialog" aria-modal="true" aria-labelledby="srOvTitle" tabindex="-1">' +
        '<button class="sr-ov-close" type="button" aria-label="Close">✕</button>' +
        '<div class="sr-ov-head">' +
          '<div class="sr-ov-title" id="srOvTitle"></div>' +
          '<div class="sr-ov-sub"></div>' +
        '</div>' +
        '<div class="sr-ov-body"></div>' +
      '</div>';
    document.body.appendChild(back);
    // Click-outside: a click landing on the backdrop (not the panel) closes.
    back.addEventListener('click', function (e) { if (e.target === back) closeOverlay(); });
    back.querySelector('.sr-ov-close').addEventListener('click', closeOverlay);
    _ov = back;
    return back;
  }
  function onOvKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeOverlay(); } }
  function openOverlay(idxStr) {
    var idx = Number(idxStr);
    if (!_view || !Number.isFinite(idx) || !_view[idx]) return;
    var c = _view[idx], p = c.player, st = c.streak, u = p.upcoming || {};
    if (!(Array.isArray(st.matches) && st.matches.length)) return;
    var back = ensureOverlay();
    var panel = back.querySelector('.sr-ov');
    var flag = emojiFlag(p.country);
    var rankTxt = (p.rank != null && p.rank !== '') ? ('#' + p.rank) : '';
    back.querySelector('.sr-ov-title').innerHTML =
      (flag ? '<span class="sr-flag">' + flag + '</span>' : '') +
      esc(p.name || u.playerName || '—') +
      (rankTxt ? ' <span class="sr-ov-rank">' + esc(rankTxt) + '</span>' : '');
    back.querySelector('.sr-ov-sub').innerHTML = describe(st) +
      ' <span class="sr-ov-pool">· ' + esc(String(st.count)) + ' of ' + esc(String(st.pool)) +
      ' ' + (st.pool === 1 ? 'match' : 'matches') + '</span>';
    back.querySelector('.sr-ov-body').innerHTML = detailTableHtml(st);
    _ovReturnFocus = document.querySelector('.sr-card[data-card-idx="' + idxStr + '"]');
    back.removeAttribute('hidden');
    document.body.classList.add('sr-ov-open');
    document.addEventListener('keydown', onOvKey, true);
    if (panel && panel.focus) panel.focus();
  }
  function closeOverlay() {
    if (!_ov || _ov.hasAttribute('hidden')) return;
    _ov.setAttribute('hidden', '');
    document.body.classList.remove('sr-ov-open');
    document.removeEventListener('keydown', onOvKey, true);
    if (_ovReturnFocus && _ovReturnFocus.focus) _ovReturnFocus.focus();
    _ovReturnFocus = null;
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
