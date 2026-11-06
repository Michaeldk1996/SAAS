// series.js — the Series page (TEN-168 engine, TEN-204 ledger; founder step 14 redesign TEN-427, 2026-10-10, night).
//
// Renders the current-streak cards for players on the Today's Matches slate (Today + Tomorrow) from series.json
// (built by build-series.js on every pipeline run). Rules: .claude/rules/series.md. Reference = OFFICIAL VERSION 1.html
// → Series; design file Series.dc.html (card 2b, filters 1c, pop-up header "Count tile"); its raw hexes are legacy.
//
// SOURCES (all read-only; nothing on this page is generated or seeded):
//   • streaks   ← series.json players[].streaks (every row, score and date is an api-tennis match); a started /
//                 finished next match → players[].asOfStart (the runs as they stood at its start, fix 1).
//   • slate     ← the Today's Matches day rule (matchDayBucket by date, the member's calendar day): a player's next
//                 match is his Today's Matches card when the board carries it (matches.json, by event key), else the
//                 series fixture itself (Challenger: the board carries ATP only). Today or Tomorrow, nothing else.
//   • next line ← that card's time (cardFmtStart, stennisfy.tz) · canonical event (sfEventName, dropped whole
//                 when the line does not fit) · "vs " + the opponent's shared display name (newsPlayerName).
//   • prices    ← the site's ONE price join (Database / Head to Head / Player Profile): database-yield.json rows via
//                 DatabaseTab.priceRows() → H2HPage.priceJoin (trDbJoinPx), Pinnacle closing, else Bet365 closing,
//                 retirements settled on the official ATP result. A row the join does not hold is "—".
//   • Updated   ← series.json generatedAt, HH:MM in stennisfy.tz (else the browser zone). Never the clock.
//
// Guard: window.FEATURE_SERIES must be truthy.

(function () {
  'use strict';

  if (!window.FEATURE_SERIES) return;

  var DATA_URL = './series.json';
  var MATCHES_URL = './matches.json';

  // ─── small local helpers ─────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  var DASH = '<span class="sr-dash">—</span>';

  // The shared display-name formatter (Player Profile / H2H / Live / Trading Report name of the key), else the feed's.
  function displayName(key, fallback) {
    if (typeof newsPlayerName === 'function') { try { return newsPlayerName(key, fallback) || fallback || ''; } catch (e) {} }
    return fallback || '';
  }
  // The canonical event-name table ("Shanghai Masters"), as Today's Matches prints it.
  function eventLabel(raw) {
    if (!raw) return '';
    if (typeof sfEventName === 'function') { try { return sfEventName(raw) || String(raw); } catch (e) {} }
    return String(raw);
  }
  // Initials avatars (override): the shared fhIni, as on Live, Model, Trading Report and the shell.
  function initialsOf(name) {
    if (typeof fhIni === 'function') { try { return fhIni(name); } catch (e) {} }
    var w = String(name || '').replace(/\./g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  // HH:MM in the member's zone (stennisfy.tz), else the browser zone.
  function zoneClock(ms) {
    if (ms == null || !isFinite(ms)) return null;
    var tz = (typeof newsTz === 'function' && newsTz()) || undefined;
    var f = function (z) {
      return new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: false })
        .format(new Date(ms)).replace(/^24/, '00');
    };
    try { return f(tz); } catch (e) { return f(undefined); }
  }
  // A start instant the way Today's Matches reads it (cardStartMs: startTs, else the api-tennis Berlin wall clock).
  function startMsOf(m) {
    if (!m) return NaN;
    if (typeof cardStartMs === 'function') { try { return cardStartMs(m); } catch (e) {} }
    return NaN;
  }
  function startClockOf(m) {
    if (typeof cardFmtStart === 'function') { try { var t = cardFmtStart(m, false); if (t && t !== '—') return t; } catch (e) {} }
    return null;
  }
  // Score line with en dashes ("6–4 7–6(5)"); the store writes hyphens.
  function scoreTxt(s) { return String(s || '').replace(/(\d)-(\d)/g, '$1–$2'); }

  // ─── plain-English streak description ────────────────────────────────────────
  // The reference's claim templates (Series.dc.html, founder round 2 fix 2): the match-result families read
  // "Won 8 straight" · "Won 6 straight on Clay" · "Lost 3 straight vs All Court Elite"; the line and set families
  // keep their own sentence ("Under 23.5 total games (best-of-3)", "Won the opening set", "First set under 9.5 games",
  // "Won by more than 1.5 games — covered −1.5", its "(best-of-3)" on the pop-up only — ruling handicap-bestof (a)).
  // N = the card's count (the as-of-start count, fix 1).
  var ARCH_LABEL = {}; // archetype labels ship already human-readable (playing-styles.json archetype_label)
  function streakVerb(dir) { return dir === 'win' ? 'Won' : 'Lost'; }
  function straightOf(st) { return streakVerb(st.direction) + ' ' + esc(String(st.count)) + ' straight'; }
  function boTxt(st) { return st.bestOf ? ('best-of-' + esc(String(st.bestOf))) : ''; }
  function bo(st) { return st.bestOf ? (' (' + boTxt(st) + ')') : ''; }
  function claimOf(st) {
    switch (st.type) {
      case 'all':
        return straightOf(st);
      case 'surface':
        return straightOf(st) + ' on ' + esc(cap(st.subtype));
      case 'style':
        return straightOf(st) + ' vs ' + esc(ARCH_LABEL[st.subtype] || st.subtype);
      case 'pattern':
        if (st.subtype === 'lost-first-set') return 'Lost the opening set';
        if (st.subtype === 'won-first-set')  return 'Won the opening set';
        return streakVerb(st.direction);
      case 'total':
        return (st.over ? 'Over ' : 'Under ') + esc(String(st.line)) + ' total games' + bo(st);
      case 'handicap':
        // the reference's "Won by more than 1.5 games — covered −1.5 (best-of-3)"; the losing side mirrors it. The
        // card drops "(best-of-N)" (standing founder ruling handicap-bestof (a), TEN-194); the pop-up keeps it.
        return st.cover
          ? 'Won by more than ' + esc(String(st.line)) + ' games — covered −' + esc(String(st.line))
          : 'Lost by more than ' + esc(String(st.line)) + ' games — failed to cover +' + esc(String(st.line));
      case 'setpat':
        if (st.subtype === 'won-2nd-set')        return 'Won the 2nd set';
        if (st.subtype === 'lost-2nd-set')       return 'Lost the 2nd set';
        if (st.subtype === 'straight-sets-win')  return 'Won in straight sets';
        if (st.subtype === 'straight-sets-loss') return 'Lost in straight sets';
        if (st.subtype === 'went-the-distance')  return 'Went the distance (reached the deciding set)';
        if (st.subtype === 'no-set-won')         return 'Failed to win a set';
        if (st.firstSet) return 'First set ' + (st.over ? 'over ' : 'under ') + esc(String(st.line)) + ' games';
        return streakVerb(st.direction);
      default:
        return streakVerb(st.direction);
    }
  }

  // ─── THE ONE ROW BUILDER (single source: the card's Avg price and the pop-up ledger) ─────────────────────────
  // Rows come back OLDEST FIRST (series.json's order); the pop-up reverses for display. Prices are READ from the
  // page's price join (PX, filled by priceBoard() from the site's one Database join) — never from series.json and
  // never computed here, so the card cannot show a price the ledger does not list.
  var SET_RE = /^(\d+)-(\d+)(?:\(\d+\))?$/;
  function setsOf(score) {
    var toks = String(score == null ? '' : score).trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return null;
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var m = SET_RE.exec(toks[i]);
      if (!m) return null;                     // one bad token invalidates the line
      out.push([Number(m[1]), Number(m[2])]);
    }
    return out;
  }
  // The games figure a line family is judged on, read off the same score string the row prints (total games, set-1
  // games, or the player's games margin). Never stored separately.
  function proofOf(st, m) {
    var s = setsOf(m && m.score);
    if (!s) return null;
    var fam = famOf(st), i, tot = 0, mine = 0, theirs = 0;
    if (fam === 'total') {
      for (i = 0; i < s.length; i++) tot += s[i][0] + s[i][1];
      return tot;
    }
    if (fam === 'handicap') {
      for (i = 0; i < s.length; i++) { mine += s[i][0]; theirs += s[i][1]; }
      return mine - theirs;
    }
    if (fam === 'setgames') return s[0][0] + s[0][1];
    return null;
  }
  // The price join's answer per match row object: { price, oppPrice, book } (book 'P' | 'B'), written by priceBoard().
  var PX = (typeof WeakMap === 'function') ? new WeakMap() : null;
  var BOOK_NAME = { P: 'Pinnacle', B: 'bet365', A: 'Pinnacle (approx.)' };   // house style (TEN-384: "Pinnacle", "bet365"); A = a snapshot (founder 2026-10-16)
  function pxOf(m) { return (PX && m && typeof m === 'object' && PX.get(m)) || null; }
  function streakRows(st) {
    var ms = Array.isArray(st.matches) ? st.matches : [];
    return ms.map(function (m) {
      var px = pxOf(m);
      // Founder ruling 2026-11-06 (series-v2 ruling 1): a row is priced when THE PLAYER's price exists; the opponent's
      // price is not required (it is shown, and counted only in the Favourite "n of N").
      var ok = !!(px && typeof px.price === 'number' && isFinite(px.price) && px.price > 1);
      var okOpp = ok && typeof px.oppPrice === 'number' && isFinite(px.oppPrice) && px.oppPrice > 1;
      return {
        date: m.date || null,
        event: m.tournament || null,
        opponent: m.opponent || null,
        score: m.score || null,
        won: (typeof m.won === 'boolean') ? m.won : null,
        proof: proofOf(st, m),
        price: ok ? px.price : null,
        oppPrice: okOpp ? px.oppPrice : null,
        book: ok ? (BOOK_NAME[px.book] || px.book || null) : null,
        src: ok ? (px.src || null) : null,   // hist / cap: our Pinnacle archive's close (founder 2026-10-16)
      };
    });
  }
  // ─── the sheet's figures (series-v2, 2026-11-06) — ONE builder for the card and the sheet ─────────────────────
  // Series tracks no P&L (README §0): the flat-1u ledger, its total and yield are gone. Every figure below is read off
  // streakRows(st) — the rows the sheet lists — so the card's Avg price can never differ from the sheet's AVG PRICE.
  var MATCH_RESULT_FAMS = { all: 1, surface: 1, style: 1 };
  function isMatchResultFam(st) { return !!MATCH_RESULT_FAMS[famOf(st)]; }
  // Summed in integer hundredths (exact, order-independent) — of the price AS THE ROW PRINTS IT (toFixed(2)). A snapshot
  // price can carry a third decimal: 1.595 prints "1.59" (its float is 1.5949…) while Math.round(1.595 * 100) is 160, so
  // rounding apart put the card a cent off the mean of the printed Home column (L. van Assche, live 6 Nov: 2.63 v 2.62).
  function cents(x) { return Math.round(Number(x.toFixed(2)) * 100); }
  // Avg price = the mean of THE PLAYER's own pre-match price (the sheet's Home column) over the rows where it exists —
  // favourite or underdog, every streak type, line streaks included. A missing price is out of the mean, never 0;
  // n of N travels with it (founder 2026-11-06: "(5/6)" after the price while some rows are unpriced).
  function avgPriceOf(st) {
    var rows = streakRows(st), sumC = 0, n = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].price != null) { sumC += cents(rows[i].price); n++; }
    }
    if (!n) return null;
    var v = Math.round(sumC / n) / 100;
    return { value: v.toFixed(2), n: n, of: rows.length };
  }
  function pricedOf(st) {
    var rows = streakRows(st), n = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].price != null) n++;
    return n;
  }
  // Favourite n of N: N = the rows where BOTH prices exist, n = those where the player's price is the shorter
  // (founder 2026-11-06 ruling 1). No row with both prices → null (a dash).
  function favOf(st) {
    var rows = streakRows(st), n = 0, of = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.price == null || r.oppPrice == null) continue;
      of++;
      if (r.price < r.oppPrice) n++;
    }
    return of ? { n: n, of: of } : null;
  }
  // Line mode (README §5.1 / §7): Total games, Set games (first set) and Handicap read their games figure off the score.
  // tg max = ⌈line × 1.5⌉, sg 13, hc 12. The handicap line is signed from the player's side: covered −h is a margin
  // above +h; failed to cover +h is a margin below −h.
  function lineSpecOf(st) {
    var fam = famOf(st), L = Number(st.line);
    if (!isFinite(L)) return null;
    if (fam === 'total') return { mode: 'tg', line: L, target: L, max: Math.ceil(L * 1.5), head: String(L), unit: 'Avg games' };
    if (fam === 'setgames') return { mode: 'sg', line: L, target: L, max: 13, head: String(L), unit: 'Avg games in set 1' };
    if (fam === 'handicap') {
      var cover = st.cover !== false;
      return { mode: 'hc', line: L, target: cover ? L : -L, max: 12, head: (cover ? '−' : '+') + L, unit: 'Avg games margin' };
    }
    return null;
  }
  function signedFig(v, mode, dp) {
    var t = Math.abs(v).toFixed(dp);
    if (mode !== 'hc') return v < 0 ? '−' + t : t;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + t;
  }
  // avg · range (min–max) · closest call (the row figure nearest the line; ties → the newest row, as the sheet lists it).
  function lineStatsOf(st) {
    var spec = lineSpecOf(st);
    if (!spec) return null;
    var rows = streakRows(st).slice().reverse(), figs = [];
    for (var i = 0; i < rows.length; i++) if (typeof rows[i].proof === 'number' && isFinite(rows[i].proof)) figs.push(rows[i].proof);
    if (!figs.length) return { spec: spec, n: 0, of: rows.length, avg: null, min: null, max: null, closest: null };
    var sum = 0, mn = figs[0], mx = figs[0], cl = figs[0];
    for (var j = 0; j < figs.length; j++) {
      var f = figs[j]; sum += f;
      if (f < mn) mn = f;
      if (f > mx) mx = f;
      if (Math.abs(f - spec.target) < Math.abs(cl - spec.target)) cl = f;
    }
    return { spec: spec, n: figs.length, of: rows.length, avg: sum / figs.length, min: mn, max: mx, closest: cl };
  }

  // ─── families ────────────────────────────────────────────────────────────────
  // Effective card FAMILY from type+subtype, so grouping/filtering is right for any engine version (fix #5).
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
  // Direction is a WORD (founder q2): no green / red on the cards. Betting lines and set-shape volatility read Neutral.
  function valence(st) {
    if (st.type === 'total' || st.type === 'handicap') return 'neutral';
    if (st.type === 'setpat' && (st.firstSet || st.subtype === 'went-the-distance')) return 'neutral';
    return st.direction === 'win' ? 'win' : 'loss';
  }
  var DIR_LABEL = { win: 'Winning run', loss: 'Losing run', neutral: 'Neutral' };

  // ─── date formatting ─────────────────────────────────────────────────────────
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(ymd) {
    if (!ymd || !YMD_RE.test(ymd)) return null;
    var p = ymd.split('-');
    var mi = Number(p[1]);
    // The regex admits month 00 and 13; MON[-1]/MON[12] would print "undefined". Unrenderable → null → a dash.
    if (!(mi >= 1 && mi <= 12)) return null;
    return Number(p[2]) + ' ' + MON[mi - 1] + ' ' + p[0];
  }
  function fmtTime(t) {
    var s = String(t || '').trim();
    return /^\d{1,2}:\d{2}/.test(s) ? s.slice(0, 5) : '';
  }
  // Card form: STARTED carries its four-digit year ("5 Aug 2026"), LAST is day + month ("13 Sep") — TEN-204 2.3.
  function fmtShort(ymd, withYear) {
    if (!ymd || !YMD_RE.test(ymd)) return null;
    var p = ymd.split('-');
    var mi = Number(p[1]);
    if (!(mi >= 1 && mi <= 12)) return null;   // month 00/13 → a dash, never "5 undefined"
    return Number(p[2]) + ' ' + MON[mi - 1] + (withYear ? ' ' + p[0] : '');
  }
  // True only when BOTH ends are renderable and their years differ (kept for tools/test-series-dates.js).
  function crossesYear(startYmd, lastYmd) {
    if (!fmtShort(startYmd) || !fmtShort(lastYmd)) return false;
    return String(startYmd).slice(0, 4) !== String(lastYmd).slice(0, 4);
  }
  // An unambiguous ISO instant only (V8's legacy parser invents years); else null.
  var ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/;
  function yearOfIso(iso) {
    if (!ISO_INSTANT_RE.test(String(iso == null ? '' : iso))) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return String(d.getUTCFullYear());
  }
  function priorYear(lastYmd, refIso) {
    var ry = yearOfIso(refIso);
    if (!ry || !fmtShort(lastYmd)) return false;
    return String(lastYmd).slice(0, 4) !== ry;
  }
  // STARTED = the run's first match (matches[] is oldest → newest and matches.length === count).
  function startedOf(st) {
    var ms = st.matches;
    return (Array.isArray(ms) && ms.length && ms[0] && ms[0].date) ? ms[0].date : null;
  }
  // UPDATED = series.json generatedAt (the last rebuild of the streak data), HH:MM in stennisfy.tz. Never the clock.
  function fmtUpdated(iso) {
    if (!iso || !ISO_INSTANT_RE.test(String(iso))) return null;
    var t = Date.parse(iso);
    return isFinite(t) ? zoneClock(t) : null;
  }

  // ─── state ───────────────────────────────────────────────────────────────────
  var _data = null;       // parsed series.json
  var _matches = null;    // Today's Matches board (matches.json)
  var _cards = null;      // flattened [{player, streak, slot}] once per data load
  var _view = null;       // current filtered+sorted view (index space for card clicks)
  var _active = false;
  var _mounted = false;
  var _pxState = 'idle';  // idle | loading | ready | failed — the Database join
  var _pxFailAt = 0, _pxGen = 0;
  var PX_RETRY_MS = 120000;          // a failed join is tried again on the next render after 2 min (step 13's shard retry)
  var _loadedAt = 0, _fetching = false, _slotTimer = null;
  var DATA_MAX_AGE_MS = 15 * 60000;  // a page show refetches series.json once the loaded copy is older than this
  var SLOT_TICK_MS = 5 * 60000;      // while shown, the slots (day word, already-played, start) are recomputed this often

  // series-v2 (founder 2026-11-06): the page opens on Level = ATP and Min length = 3+.
  var DEFAULTS = { level: 'tour', day: 'all', dir: 'all', type: 'all', minLen: 3, sort: 'longest', showPlayed: false };
  var _filters = Object.assign({}, DEFAULTS);   // level · day · dir · type · minLen · sort · showPlayed (one source: DEFAULTS)
  function styleFloor() { return (_data && _data.rules && _data.rules.viewFloorStyle) || 3; }

  // ─── item 1 · outcome-family de-duplication (founder 2026-09-12) ──────────────
  // A match-outcome run (all comps / surface / vs style) whose matches are a subset of a same-or-longer run of a
  // BROADER outcome family gets no card (Shelton's "Won 6" and "Won on Hard 6" over the same six matches).
  var OUTCOME_FAMILY = { all: 1, surface: 1, style: 1 };
  var OUTCOME_BREADTH = { all: 3, surface: 2, style: 1 };
  function memberKey(m) { return String(m && m.date) + '|' + String(m && m.opponent == null ? '' : m.opponent); }
  function memberSet(st) {
    var s = {};
    (Array.isArray(st.matches) ? st.matches : []).forEach(function (m) { s[memberKey(m)] = 1; });
    return s;
  }
  function isSubset(a, b) {
    for (var k in a) { if (Object.prototype.hasOwnProperty.call(a, k) && !b[k]) return false; }
    return true;
  }
  // Runs on the as-of-start streaks (fix 1) on every reslot: it FLAGS (c.suppressed), passesFilters drops.
  function suppressOutcomeDuplicates(cards) {
    var byPlayer = {};
    cards.forEach(function (c) { c.suppressed = null; });
    cards.forEach(function (c) {
      if (!c.streak || !OUTCOME_FAMILY[c.streak.type]) return;
      if (!(Array.isArray(c.streak.matches) && c.streak.matches.length)) return;
      var k = String(c.player.key != null ? c.player.key : c.player.name) + '|' + c.player.tier;
      (byPlayer[k] || (byPlayer[k] = [])).push(c);
    });
    Object.keys(byPlayer).forEach(function (k) {
      var group = byPlayer[k];
      if (group.length < 2) return;
      var sets = group.map(memberSetOf);
      group.forEach(function (a, i) {
        for (var j = 0; j < group.length; j++) {
          if (j === i) continue;
          var b = group[j];
          if (b.streak.count < a.streak.count) continue;
          if (!isSubset(sets[i], sets[j])) continue;
          if (OUTCOME_BREADTH[b.streak.type] <= OUTCOME_BREADTH[a.streak.type]) continue;   // only the narrower goes
          a.suppressed = 'subset-of-' + b.streak.type;
          return;
        }
      });
    });
    return cards;
  }
  function memberSetOf(c) { return memberSet(c.streak); }

  // ─── item 2 · the handicap card is −3.5 only (founder ruling `handicap-line` (a), 2026-09-12) ─────────────────
  var HANDICAP_DISPLAY_LINE = 3.5;
  function handicapLineAllowed(st) {
    if (st.type !== 'handicap') return true;
    return Number(st.line) === HANDICAP_DISPLAY_LINE;
  }

  // set 'now' = players[].streaks (the runs at the build); 'start' = players[].asOfStart (fix 1, the generator's runs
  // as they stood at the start of a started / finished next match).
  function flatten(data) {
    var out = [];
    (data.players || []).forEach(function (p) {
      [['now', p.streaks], ['start', p.asOfStart]].forEach(function (pair) {
        (Array.isArray(pair[1]) ? pair[1] : []).forEach(function (st) {
          // Non-negotiable guard: pool AND recency must both be present, else drop.
          if (st.pool == null || !st.lastDate || st.ageDays == null) return;
          if (!handicapLineAllowed(st)) return;    // item 2
          out.push({ player: p, base: st, streak: st, set: pair[0] });
        });
      });
    });
    // Suppression runs over the whole as-of-start set, before any view filter (reslot).
    return out;
  }

  // ─── fix 1 (founder round 2) · the streak AS IT STOOD AT THE START OF THE NEXT MATCH ─────────────────────────────
  // At the source: for a next match that had started or finished when series.json was built, the generator emits the
  // player's runs from his history strictly before that match (players[].asOfStart, every engine rule applied, recency
  // measured at its start; rules.asOfStart marks a build that does this). Show already-played shows THAT set for a
  // started / finished next match, in place of the post-match runs — so a run the match broke (J. Pinnington Jones
  // won 6, 8, 9 Oct, lost 10 Oct) still has its card. A next match that had not started at the build cannot be inside
  // the runs, so they show as built.
  var DAY_MS = 86400000;
  var SLAM_RE = /\b(australian open|french open|roland[\s-]?garros|wimbledon|us open)\b/i;   // the engine's isSlam
  function shownStreak(c) {
    var s = c.slot, p = c.player;
    if (c.set === 'start') return (s && s.played) ? c.base : null;
    if (!s || !s.played) return c.base;
    if (Array.isArray(p.asOfStart)) return null;                          // the generator's as-of-start set replaces it
    if (_data && _data.rules && _data.rules.asOfStart) return c.base;     // built before the match started
    return asOfStart(c.base, p, s);                                       // fallback: series.json predates the field
  }
  // FALLBACK (a series.json without rules.asOfStart): trim the post-match run on the page. Every row on or after the
  // next match's start goes: its own row (same event key) and everything after it; when the run does not carry that
  // key, rows dated after its date and, once it has started, rows on its date — except one whose start (the board card
  // with that event key) is known and earlier than the next match's. A run under its family's floor after the cut
  // (min length rules.minLen, pool rules.minPoolConditional for every family but all comps) or whose last remaining
  // row is older than rules.maxAgeDays at the match's start (Grand Slams exempt) is not shown — the engine would not
  // have emitted it at that instant. A run the match broke cannot be rebuilt here (it is not in the file).
  function boardStartOfKey(ek) {
    ek = String(ek || '');
    if (!ek || !Array.isArray(_matches)) return null;
    for (var i = 0; i < _matches.length; i++) {
      var m = _matches[i];
      if (m && String(m.id || '').replace(/^\D+-/, '') === ek) { var t = startMsOf(m); return isFinite(t) ? t : null; }
    }
    return null;
  }
  function asOfStart(st, p, slot) {
    var ms = Array.isArray(st.matches) ? st.matches : [];
    if (!ms.length || !slot) return st;
    var u = p.upcoming || {};
    var key = String(u.eventKey || ''), day = String(slot.date || u.date || '');
    var cut = -1, i;
    if (key) for (i = 0; i < ms.length; i++) { if (String(ms[i].eventKey || '') === key) { cut = i; break; } }
    if (cut < 0 && YMD_RE.test(day)) {
      for (i = 0; i < ms.length; i++) {
        var d = String(ms[i].date || '');
        if (d > day) { cut = i; break; }
        if (slot.played && d === day) {
          var rs = boardStartOfKey(ms[i].eventKey);
          if (!(rs != null && slot.startMs != null && rs < slot.startMs)) { cut = i; break; }
        }
      }
    }
    if (cut < 0) return st;
    var keep = ms.slice(0, cut), dropped = ms.length - cut;
    var r = (_data && _data.rules) || {};
    var minLen = (typeof r.minLen === 'number') ? r.minLen : 3;
    var minPool = (typeof r.minPoolConditional === 'number') ? r.minPoolConditional : 8;
    var maxAge = (typeof r.maxAgeDays === 'number') ? r.maxAgeDays : 45;
    var pool = (typeof st.pool === 'number') ? st.pool - dropped : st.pool;
    if (keep.length < minLen) return null;
    if (famOf(st) !== 'all' && typeof pool === 'number' && pool < minPool) return null;
    var last = keep[keep.length - 1];
    var atMs = slot.startMs != null ? slot.startMs : Date.parse(day + 'T00:00:00Z');
    var age = Math.floor((atMs - Date.parse(String(last.date) + 'T00:00:00Z')) / DAY_MS);
    var slam = SLAM_RE.test(String(last.tournament || ''));
    if (!(age <= maxAge) && !slam) return null;                           // recency at the start, not at the build
    var out = {};
    for (var k in st) if (Object.prototype.hasOwnProperty.call(st, k)) out[k] = st[k];
    out.matches = keep;
    out.count = keep.length;
    out.pool = pool;
    out.lastDate = last.date || null;
    out.lastTournament = last.tournament || null;
    out.ageDays = age;
    out.slamExempt = slam && age > maxAge;
    out.asOfStart = { droppedRows: dropped, fullCount: st.count };
    return out;
  }

  // ─── the slate: Today's Matches day rule; the board's card when it carries the match ────────────────────────────
  function boardMatchOf(p) {
    var u = p.upcoming || {}, ek = String(u.eventKey || '');
    if (!ek || !Array.isArray(_matches)) return null;
    for (var i = 0; i < _matches.length; i++) {
      var m = _matches[i];
      if (m && String(m.id || '').replace(/^\D+-/, '') === ek) return m;
    }
    return null;
  }
  // The day a fixture date falls on in the member's calendar (matchDayBucket — Today's Matches' own function).
  function dayBucketOf(date) {
    if (!date) return null;
    if (typeof matchDayBucket === 'function') { try { return matchDayBucket({ date: date }); } catch (e) {} }
    return null;
  }
  // One slot per card: the next match as the page shows it. null = not on the Today / Tomorrow slate.
  function slotOf(p) {
    var u = p.upcoming || {};
    var bm = boardMatchOf(p);
    var src = bm || { date: u.date, time: u.time };
    var day = dayBucketOf(src.date);
    if (day !== 'today' && day !== 'tomorrow') return null;
    var startMs = startMsOf(src);
    var now = Date.now();
    var isP1 = bm ? String(bm.p1Key) === String(p.key) : true;
    var oppKey = bm ? (isP1 ? bm.p2Key : bm.p1Key) : u.opponentKey;
    var oppFeed = bm ? (isP1 ? bm.p2 : bm.p1) : u.opponentName;
    var finished = bm ? (typeof isFinishedMatch === 'function' ? isFinishedMatch(bm) : (!bm.live && !!bm.finalScore)) : !!u.played;
    // Started: the board flags it live / interrupted; a match the board does not carry has started once its start
    // instant has passed (the deployed matches.json leaves a match out while it is in play — trading-report.md).
    var started = bm ? !!(bm.live || bm.interrupted) : (isFinite(startMs) && startMs <= now);
    return {
      day: day,
      date: u.date || src.date || null,   // the feed's own date (the format of the streak rows' dates)
      board: !!bm,
      startMs: isFinite(startMs) ? startMs : null,
      clock: startClockOf(src),
      event: eventLabel(bm ? bm.tour : u.tournament),
      opp: displayName(oppKey, oppFeed),
      played: !!(finished || started || u.played),
    };
  }

  function passesFilters(c, skipType, filters) {
    var p = c.player, st = c.streak, f = filters || _filters, s = c.slot;
    if (!s) return false;                                        // not on the Today / Tomorrow slate
    if (!st || c.suppressed) return false;                       // under its floor as of the next start, or a subset run
    if (p.tier !== 'tour' && p.tier !== 'chal') return false;    // Level is ATP / Challenger only (never ITF)
    if (f.level !== 'all' && p.tier !== f.level) return false;   // tour = ATP main tour, chal = Challenger (qualifying in)
    if (f.day !== 'all' && s.day !== f.day) return false;        // the scheduled date
    if (!f.showPlayed && s.played) return false;                 // unchecked: next match not yet started
    if (f.dir !== 'all' && st.direction !== f.dir) return false;
    if (!skipType && f.type !== 'all') {
      var wantFam = (f.type === 'all-comp') ? 'all' : f.type;
      if (famOf(st) !== wantFam) return false;
    }
    // View floor: the min-length control governs every type EXCEPT vs-style, floored at 3 by the founder.
    var floor = (st.type === 'style') ? styleFloor() : f.minLen;
    if (st.count < floor) return false;
    return true;
  }

  function sortCards(arr, filters) {
    if ((filters || _filters).sort === 'soonest') {
      // The real start instant (cardStartMs), not a display string; an unknown start sorts last.
      arr.sort(function (a, b) {
        var ka = a.slot && a.slot.startMs != null ? a.slot.startMs : Infinity;
        var kb = b.slot && b.slot.startMs != null ? b.slot.startMs : Infinity;
        if (ka !== kb) return ka - kb;
        return b.streak.count - a.streak.count;
      });
    } else {
      arr.sort(function (a, b) {
        if (b.streak.count !== a.streak.count) return b.streak.count - a.streak.count;
        return (b.streak.pool || 0) - (a.streak.pool || 0);   // tie-break: the bigger pool is the sturdier run
      });
    }
    return arr;
  }

  // ─── prices: the site's one Database join ───────────────────────────────────────────────────────────────────
  // Every row of a player's streaks is priced in ONE call per player (each distinct match once, so two cards that
  // share a match read the same price), through trDbJoinPx — the per-event model's own join (Database rows +
  // retirements behind the store's flag; H2HPage.priceJoin; Pinnacle closing, else Bet365 closing).
  function priceBoard() {
    if (_pxState === 'loading' || _pxState === 'ready') return;
    if (typeof sfDbJoinLoad !== 'function' || typeof trDbJoinPx !== 'function') { _pxState = 'failed'; _pxFailAt = Date.now(); render(); return; }
    _pxState = 'loading';
    var gen = ++_pxGen;   // a refetch of series.json starts a new generation; an older join's answer is dropped
    var players = (_data && _data.players) || [];
    var loadCh = function (p) {
      // Challenger runs are Challenger matches, which the Database (ATP main tour) never holds: no career fetch.
      if (p.tier !== 'tour' || typeof loadCareerHistory !== 'function') return Promise.resolve([]);
      return Promise.resolve(loadCareerHistory(p.key)).then(function (ch) { return Array.isArray(ch) ? ch : []; }, function () { return []; });
    };
    Promise.resolve().then(function () { return sfDbJoinLoad(); }).then(function () {
      return Promise.all(players.map(function (p) { return loadCh(p).then(function (ch) { return [p, ch]; }); }));
    }).then(function (pairs) {
      if (gen !== _pxGen) return;
      pairs.forEach(function (pc) {
        var p = pc[0], uniq = {}, list = [];
        (p.streaks || []).forEach(function (st) {
          (st.matches || []).forEach(function (m) {
            if (typeof m.won !== 'boolean') return;
            var k = String(m.date) + '|' + String(m.opponent || '') + '|' + (m.won ? 1 : 0);
            if (!uniq[k]) { uniq[k] = { date: m.date, won: m.won, opp: m.opponent || '', round: null, _ms: [] }; list.push(uniq[k]); }
            uniq[k]._ms.push(m);
          });
        });
        if (!list.length) return;
        trDbJoinPx(displayName(p.key, p.name), pc[1])(list);
        list.forEach(function (r) {
          var v = (r.price != null) ? { price: Number(r.price), oppPrice: r.oppPrice != null ? Number(r.oppPrice) : null, book: r.book, src: r.src || null } : null;
          r._ms.forEach(function (m) { if (PX) { if (v) PX.set(m, v); else PX.delete(m); } });
        });
      });
      _pxState = 'ready';
      render();
    }).catch(function (e) {
      if (gen !== _pxGen) return;
      console.warn('[series] price join failed:', e && e.message);
      _pxState = 'failed';
      _pxFailAt = Date.now();
      render();
    });
  }

  // ─── card render (2b) ────────────────────────────────────────────────────────────────────────────────────────
  // Player-first header (initials, name + mono rank, the Next line), count tile + claim with "type · direction" under
  // it, three ruled rows Started / Last / Avg price. The whole card opens the pop-up (no History link).
  function avgPriceHtml(st) {
    if (_pxState === 'idle' || _pxState === 'loading') return '';          // a price claims nothing while it loads
    if (_pxState === 'failed') return '<span class="sr-dash" title="Prices unavailable">—</span>';   // = the pop-up's line
    return avgPriceText(avgPriceOf(st), 'sr-avg-n') || DASH;   // the sheet's AVG PRICE, same builder, same "(n/N)"
  }
  function nextHtml(c) {
    var s = c.slot || {};
    var when = (s.day === 'today' ? 'Today' : s.day === 'tomorrow' ? 'Tomorrow' : '');
    // One line (founder round 3 item 2): the event is shown whole or not at all — never cut to "R…". It carries its
    // own " · " so fitNextLines can drop it whole when the line overflows, leaving "Next <day> <time> · vs <opponent>"
    // (the reference's form). The full line is the title tooltip.
    var full = [when + (s.clock ? ' ' + s.clock : '')];
    var html = '<span class="sr-next-t">' + esc(full[0]) + '</span>';
    if (s.event) { html += '<span class="sr-next-ev"> · ' + esc(s.event) + '</span>'; full.push(s.event); }
    html += '<span class="sr-next-opp"> · vs ' + (s.opp ? esc(s.opp) : DASH) + '</span>';
    full.push('vs ' + (s.opp || '—'));
    return '<span class="sr-next" title="' + esc('Next ' + full.join(' · ')) + '"><span class="sr-next-k">Next </span>' + html + '</span>';
  }
  // Measured after paint: a Next line wider than its box drops its event span whole (never an ellipsis inside it).
  function fitNextLines(root) {
    var lines = (root && typeof root.querySelectorAll === 'function') ? root.querySelectorAll('.sr-next') : [];
    for (var i = 0; i < lines.length; i++) {
      var el = lines[i], ev = el.querySelector('.sr-next-ev');
      if (ev && el.scrollWidth > el.clientWidth) ev.remove();
    }
  }
  // The grid's width decides which events fit: a render while the page is hidden (width 0) or a resize repaints once
  // the width settles. Width only — a repaint changes the height, never the width, so this cannot loop.
  var _ro = null, _roW = -1;
  function watchWidth(root) {
    if (_ro || typeof ResizeObserver !== 'function') return;
    _ro = new ResizeObserver(function (es) {
      var w = Math.round(es[0].contentRect.width);
      if (w === _roW) return;
      _roW = w;
      if (_active && _data && w > 0) render();
    });
    _ro.observe(root);
    // a web font landing after the paint widens the text: re-fit then too
    var fonts = document.fonts;
    if (fonts && typeof fonts.addEventListener === 'function') {
      fonts.addEventListener('loadingdone', function () { if (_active && _data) render(); });
    }
  }
  // Founder 2026-10-22: the player's photo over the initials, by player ID through the dashboard's one resolver.
  function photoOf(key, name) {
    return (key != null && typeof playerPhotoImg === 'function') ? playerPhotoImg(String(key), name) : '';   // eslint-disable-line no-undef
  }
  function cardHtml(c, idx) {
    var p = c.player, st = c.streak;
    var name = displayName(p.key, p.name || (p.upcoming && p.upcoming.playerName) || '');
    var rankTxt = (p.rank != null && p.rank !== '') ? esc('#' + p.rank) : '—';
    var startTxt = fmtShort(startedOf(st), true);
    var lastTxt = fmtShort(st.lastDate, false);
    var hasDetail = Array.isArray(st.matches) && st.matches.length > 0;
    var clickAttrs = hasDetail
      ? ' role="button" tabindex="0" aria-haspopup="dialog" aria-label="Show the ' + esc(String(st.count)) +
        ' matches in this run" data-card-idx="' + esc(String(idx)) + '"'
      : '';
    var row = function (k, v, cls) {
      return '<div class="sr-row"><span class="sr-row-k">' + k + '</span><span class="sr-row-v' + (cls || '') + '">' + v + '</span></div>';
    };
    return '<article class="sr-card' + (hasDetail ? ' sr-has-detail' : '') + '" data-count="' + esc(String(st.count)) + '"' + clickAttrs + '>' +
      '<div class="sr-chead">' +
        '<span class="sr-ava">' + esc(initialsOf(name)) + photoOf(p.key, name) + '</span>' +
        '<span class="sr-who">' +
          '<span class="sr-nameline"><span class="sr-pname">' + (name ? esc(name) : DASH) + '</span> ' +
            '<span class="sr-prank">' + rankTxt + '</span></span>' +
          nextHtml(c) +
        '</span>' +
      '</div>' +
      '<div class="sr-crow">' +
        '<span class="sr-tile"><span class="sr-tile-n">' + esc(String(st.count)) + '</span><span class="sr-tile-k">in a row</span></span>' +
        '<span class="sr-claimbox"><span class="sr-claim">' + claimOf(st) + '</span>' +
          '<span class="sr-claimsub">' + esc(FAM_BADGE[famOf(st)] || st.type) + ' · ' + esc(DIR_LABEL[valence(st)]) + '</span></span>' +
      '</div>' +
      '<div class="sr-rows">' +
        row('Started', startTxt ? esc(startTxt) : DASH) +
        row('Last', lastTxt ? esc(lastTxt) : DASH) +
        row('Avg price', avgPriceHtml(st), ' sr-row-v--b') +
      '</div>' +
    '</article>';
  }

  // ─── header (shared 35b .sfh) ────────────────────────────────────────────────────────────────────────────────
  var SUBTITLE = 'Current streaks for players scheduled today and tomorrow, each with the pool it was drawn from and the date of its latest match.';
  function headerHtml(view) {
    var stats = '';
    if (view) {
      var players = {};
      view.forEach(function (c) { players[String(c.player.key != null ? c.player.key : c.player.name)] = 1; });
      var longest = view.length ? view.reduce(function (m, c) { return Math.max(m, c.streak.count); }, 0) : null;
      var upd = fmtUpdated(_data && _data.generatedAt);
      var stat = function (k, v, cls) {
        return '<div class="sfh__stat"><span class="sfh__l">' + k + '</span><span class="sfh__v' + (cls || '') + '">' + v + '</span></div>';
      };
      stats = '<div class="sfh__stats">' +
        stat('Streaks', esc(String(view.length))) +
        stat('Players', esc(String(Object.keys(players).length))) +
        stat('Longest run', longest != null ? esc(String(longest)) : '—', longest != null ? '' : ' sfh__v--none') +
        stat('Updated', upd ? esc(upd) : '—', upd ? ' sfh__v--soft' : ' sfh__v--none') +
      '</div>';
    }
    return '<div class="sfh sr-head">' +
      '<div class="sfh__text"><h1 class="sfh__title">Series</h1><p class="sfh__sub">' + esc(SUBTITLE) + '</p></div>' +
      stats +
    '</div>';
  }

  // ─── filters (1c): the Type tab row, then Level · Day · Direction · Min length | Show already-played + Sort ────
  function seg(name, opts, cur) {
    return '<div class="sr-seg" data-seg="' + name + '">' + opts.map(function (o) {
      var on = String(o[0]) === String(cur);
      return '<button type="button" class="sr-segbtn' + (on ? ' active' : '') + '" aria-pressed="' + (on ? 'true' : 'false') +
        '" data-val="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  var TYPE_TABS = [['all', 'All'], ['all-comp', 'All comps'], ['surface', 'Surface'], ['style', 'Vs style'],
    ['total', 'Total games'], ['handicap', 'Handicap'], ['setout', 'Set outcome'], ['setgames', 'Set games']];
  // Counts follow every other filter and ignore the Type filter; "All" is the sum.
  function typeCounts() {
    var n = { total: 0 };
    (_cards || []).forEach(function (c) {
      if (!passesFilters(c, true)) return;
      var fam = 'f-' + famOf(c.streak);
      n[fam] = (n[fam] || 0) + 1;
      n.total++;
    });
    return n;
  }
  function filterBarHtml() {
    var f = _filters, n = typeCounts();
    var tabs = '<div class="sr-tabs" role="tablist">' + TYPE_TABS.map(function (t) {
      var fam = 'f-' + (t[0] === 'all-comp' ? 'all' : t[0]);
      var cnt = t[0] === 'all' ? n.total : (n[fam] || 0);
      var on = f.type === t[0];
      return '<button type="button" class="sr-tab' + (on ? ' active' : '') + '" role="tab" aria-selected="' + (on ? 'true' : 'false') +
        '" data-type="' + t[0] + '">' + esc(t[1]) + '<span class="sr-tab-n">' + esc(String(cnt)) + '</span></button>';
    }).join('') + '</div>';
    return '<div class="sr-filters">' + tabs +
      '<div class="sr-frow">' +
        seg('level', [['all', 'All'], ['tour', 'ATP'], ['chal', 'Challenger']], f.level) +
        seg('day', [['all', 'All'], ['today', 'Today'], ['tomorrow', 'Tomorrow']], f.day) +
        seg('dir', [['all', 'All'], ['win', 'Wins'], ['loss', 'Losses']], f.dir) +
        seg('minLen', [['3', '3+'], ['4', '4+'], ['5', '5+'], ['6', '6+'], ['7', '7+'], ['8', '8+']], String(f.minLen)) +
        '<span class="sr-fright">' +
          '<label class="sr-toggle"><input type="checkbox" data-toggle="showPlayed"' + (f.showPlayed ? ' checked' : '') + '>' +
            '<span class="sr-box" aria-hidden="true"></span><span>Show already-played</span></label>' +
          seg('sort', [['longest', 'Longest'], ['soonest', 'Soonest']], f.sort) +
        '</span>' +
      '</div>' +
    '</div>';
  }

  // ─── empty state ── (series-v2: the footnote paragraph and the engine-rules line are removed; the rules stand)
  function emptyHtml() {
    return '<div class="sr-empty"><span>No streaks match these filters.</span>' +
      '<button type="button" class="sr-clear" data-clear="1">Clear</button></div>';
  }

  // ─── render ──────────────────────────────────────────────────────────────────────────────────────────────────
  function render() {
    var root = document.getElementById('seriesGrid');
    if (!root) return;
    if (!_data) { root.innerHTML = headerHtml(null) + '<p class="sr-note">Loading streaks…</p>'; return; }
    if (_pxState === 'failed' && Date.now() - _pxFailAt > PX_RETRY_MS) priceBoard();   // retry a failed join
    if (!_cards) {
      _cards = flatten(_data);
      reslot();
    }
    var view = sortCards(_cards.filter(function (c) { return passesFilters(c, false); }));
    _view = view;  // card clicks index into this exact list
    var body = view.length
      ? '<div class="sr-cards">' + view.map(cardHtml).join('') + '</div>'
      : emptyHtml();
    root.innerHTML = headerHtml(view) + filterBarHtml() + body;   // series-v2: the page ends after the grid
    fitNextLines(root);
    watchWidth(root);
    wireFilters(root);
    if (_ov && !_ov.hasAttribute('hidden') && _ovCard) paintOverlay(_ovCard);   // prices landed while it was open
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
    root.querySelectorAll('.sr-tab').forEach(function (t) {
      t.addEventListener('click', function () { _filters.type = t.getAttribute('data-type'); render(); });
    });
    // `change`, not `click`: the visible box is a sibling span, the label forwards the click to the input.
    root.querySelectorAll('.sr-toggle input[data-toggle]').forEach(function (box) {
      box.addEventListener('change', function () {
        _filters[box.getAttribute('data-toggle')] = !!box.checked;
        render();
      });
    });
    var clr = root.querySelector('.sr-clear');
    if (clr) clr.addEventListener('click', clearFilters);
    // The whole card opens the pop-up. Delegated on the persistent grid, wired ONCE.
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
  function clearFilters() {
    Object.keys(DEFAULTS).forEach(function (k) { _filters[k] = DEFAULTS[k]; });
    render();
  }

  // ─── match sheet (series-v2, README §5): "Count tile" header, one row grammar, a bare foot ──────────────────────
  // Odds mode (all comps, surface, vs style, set outcome): Date · Event · Opponent · Score · Home · Away.
  // Line mode (Total games, Set games, Handicap): the same, then the games figure and a 72px bar with the line's tick.
  // Home = this player's pre-match price (bold), Away = the opponent's. No P&L, no total line, no foot note.
  function avgPriceText(ap, cls) {
    if (!ap) return null;
    return esc(ap.value) + (ap.n < ap.of ? ' <span class="' + cls + '">(' + esc(String(ap.n)) + '/' + esc(String(ap.of)) + ')</span>' : '');
  }
  function statCell(v, label, title) {
    return '<span class="sr-ov-stat"' + (title ? ' title="' + esc(title) + '"' : '') + '><span class="sr-ov-stat-v">' + v + '</span>' +
      '<span class="sr-ov-stat-k">' + esc(label) + '</span></span>';
  }
  var STAT_DIV = '<span class="sr-ov-stat-div"></span>';
  function statsTileHtml(st) {
    var ls = lineStatsOf(st);
    if (ls) {
      var m = ls.spec.mode, none = DASH;
      var dp1 = function (v) { return v == null ? none : esc(signedFig(v, m, 1)); };
      var int = function (v) { return esc(signedFig(v, m, 0)); };
      var range = ls.n ? (m === 'hc' && ls.min > 0 ? '+' + esc(String(ls.min)) + '–' + esc(String(ls.max)) : int(ls.min) + '–' + int(ls.max)) : none;
      return '<span class="sr-ov-stats">' +
        statCell(dp1(ls.avg), ls.spec.unit, ls.n < ls.of ? ls.n + ' of ' + ls.of + ' matches with a set score' : '') + STAT_DIV +
        statCell(range, 'Range') + STAT_DIV +
        statCell(ls.n ? int(ls.closest) : none, 'Closest call') +
      '</span>';
    }
    var pending = (_pxState === 'idle' || _pxState === 'loading');
    var failed = _pxState === 'failed';
    var ap = avgPriceOf(st), fv = favOf(st);
    var apTxt = pending ? '' : failed ? DASH : (avgPriceText(ap, 'sr-ov-stat-n') || DASH);
    var fvTxt = pending ? '' : (!failed && fv) ? esc(String(fv.n)) + ' of ' + esc(String(fv.of)) : DASH;
    return '<span class="sr-ov-stats">' +
      statCell(apTxt, 'Avg price', failed ? 'Prices unavailable' : (ap && ap.n < ap.of ? ap.n + ' of ' + ap.of + ' matches priced' : '')) + STAT_DIV +
      statCell(fvTxt, 'Favourite', fv ? 'Shorter price than the opponent in ' + fv.n + ' of the ' + fv.of + ' matches with both prices' : '') +
    '</span>';
  }
  function modalHeadHtml(st) {
    var spec = lineSpecOf(st), H = function (cls, t) { return '<span class="' + cls + '">' + t + '</span>'; };
    return '<div class="sr-mhead' + (spec ? ' sr-mline' : '') + '">' + H('sr-mres', '') + H('sr-mdate', 'Date') + H('sr-mtour', 'Event') +
      H('sr-mopp', 'Opponent') + H('sr-mscore', 'Score') + H('sr-mp1', 'Home') + H('sr-mp2', 'Away') +
      (spec ? H('sr-mlinehead', 'Line ' + esc(spec.head)) : '') +
    '</div>';
  }
  function pxCell(cls, v, title) {
    if (_pxState === 'idle' || _pxState === 'loading') return '<span class="' + cls + '"></span>';
    return '<span class="' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (v == null ? DASH : esc(v.toFixed(2))) + '</span>';
  }
  // Hover on Home / Away: "{player} 1.64 · {opp} 2.28 · <source>". The source keeps the join's own words, so a snapshot
  // still reads "not a confirmed close" (odds.md) — never the design's blanket "pre-match close".
  function srcTitleOf(r) {
    if (r.price == null) return (typeof window.trPxAfterOf === 'function') ? window.trPxAfterOf(r.date) : null;
    return r.book === BOOK_NAME.A ? r.book + ' · ' + ((typeof window.sfApproxHover === 'function' ? window.sfApproxHover(r) : r.src === 'od10' ? window.SF_OD10_HOVER : window.SF_APPROX_HOVER) || 'not a confirmed close')
      : r.book ? r.book + ' closing' + (r.src === 'hist' ? ' · from Pinnacle history' : r.src === 'cap' ? ' · captured' : '') : null;
  }
  function detailTableHtml(st, playerName) {
    var rows = streakRows(st).slice().reverse();   // newest first — a render choice, no value changes
    var spec = lineSpecOf(st);
    return rows.map(function (r) {
      var res = '<span class="sr-mres' + (r.won === true ? ' sr-w' : r.won === false ? ' sr-l' : '') + '"' +
        (r.won == null ? '' : ' title="' + (r.won ? 'Won' : 'Lost') + '"') + '></span>';
      var src = srcTitleOf(r);
      var title = r.price != null
        ? (playerName || 'Player') + ' ' + r.price.toFixed(2) + ' · ' + (r.opponent || 'Opponent') + ' ' + (r.oppPrice != null ? r.oppPrice.toFixed(2) : '—') + (src ? ' · ' + src : '')
        : src;
      var tail = '';
      if (spec) {
        var f = (typeof r.proof === 'number' && isFinite(r.proof)) ? r.proof : null;
        var w = f == null ? 0 : Math.max(0, Math.min(1, Math.abs(f) / spec.max));
        var t = Math.max(0, Math.min(1, spec.line / spec.max));
        tail = '<span class="sr-mfig">' + (f == null ? DASH : esc(signedFig(f, spec.mode, 0))) + '</span>' +
          '<span class="sr-mbar">' + (f == null ? '' : '<span class="sr-mbar-f" style="width:' + (w * 100).toFixed(2) + '%"></span>') +
          '<span class="sr-mbar-t" style="left:' + (t * 100).toFixed(2) + '%"></span></span>';
      }
      return '<div class="sr-mrow' + (spec ? ' sr-mline' : '') + '">' + res +
        '<span class="sr-mdate">' + (fmtDate(r.date) ? esc(fmtDate(r.date)) : DASH) + '</span>' +
        '<span class="sr-mtour">' + (r.event ? esc(eventLabel(r.event)) : DASH) + '</span>' +
        '<span class="sr-mopp">' + (r.opponent ? esc(r.opponent) : DASH) + '</span>' +
        '<span class="sr-mscore">' + (r.score ? esc(scoreTxt(r.score)) : DASH) + '</span>' +
        pxCell('sr-mp1', r.price, title) + pxCell('sr-mp2', r.oppPrice, title) + tail +
      '</div>';
    }).join('');
  }
  // The header: avatar · count tile · name + claim · caps "{rank} · {count} of {pool} matches[ · best of N]" · stats tile · ✕.
  function modalHeadInfoHtml(c) {
    var p = c.player, st = c.streak;
    var name = displayName(p.key, p.name || '');
    var line = claimOf(st).replace(/\s*\(best-of-\d\)/, '');
    var fmt = (st.bestOf && (st.type === 'total' || st.type === 'handicap')) ? ' · best of ' + st.bestOf : '';
    var rankTxt = (p.rank != null && p.rank !== '') ? '#' + p.rank : '—';
    return '<span class="sr-ov-ava">' + esc(initialsOf(name)) + photoOf(p.key, name) + '</span>' +
      '<span class="sr-ov-tile"><span class="sr-ov-tile-n">' + esc(String(st.count)) + '</span><span class="sr-ov-tile-k">in a row</span></span>' +
      '<span class="sr-ov-headl">' +
        '<span class="sr-ov-title" id="srOvTitle"><span class="sr-ov-name">' + esc(name || '—') + '</span>' +
          '<span class="sr-ov-line">' + line + '</span></span>' +
        '<span class="sr-ov-sub">' + esc(rankTxt) + ' · ' + esc(String(st.count)) + ' of ' + esc(String(st.pool)) + ' ' +
          (st.pool === 1 ? 'match' : 'matches') + esc(fmt) + '</span>' +
      '</span>' +
      statsTileHtml(st);
  }
  function popupHtml(c) {
    var name = displayName(c.player.key, c.player.name || '');
    return '<div class="sr-ov-head">' + modalHeadInfoHtml(c) +
        '<button class="sr-ov-close" type="button" aria-label="Close">✕</button></div>' +
      modalHeadHtml(c.streak) +
      '<div class="sr-ov-body">' + detailTableHtml(c.streak, name) + '</div>' +
      '<span class="sr-ov-foot"></span>';
  }

  var _ov = null, _ovReturnFocus = null, _ovCard = null;
  function ensureOverlay() {
    if (_ov) return _ov;
    var back = document.createElement('div');
    back.className = 'sr-ov-back';
    back.setAttribute('hidden', '');
    back.innerHTML = '<div class="sr-ov" role="dialog" aria-modal="true" aria-labelledby="srOvTitle" tabindex="-1"></div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (e) {
      if (e.target === back) { closeOverlay(); return; }
      if (e.target.closest && e.target.closest('.sr-ov-close')) closeOverlay();
    });
    _ov = back;
    return back;
  }
  // The Score track is the design's (112px odds, 100px line) and widens only when a row's score needs it: a five-set
  // line ("6–4 3–6 6–7(7) 7–5 6–4") runs past 112px in IBM Plex Mono 11.5px (0.6em = 6.9px a character), so the Home
  // column would overlap it. Head and rows share the one width, so the columns stay aligned. A data-driven exception.
  function scoreTrackPx(st) {
    var n = 0;
    (st.matches || []).forEach(function (m) { n = Math.max(n, scoreTxt(m.score).length); });
    return Math.max(lineSpecOf(st) ? 100 : 112, Math.ceil(n * 6.9) + 2);
  }
  function paintOverlay(c) {
    var panel = _ov && _ov.querySelector('.sr-ov');
    if (!panel) return;
    if (panel.style && panel.style.setProperty) panel.style.setProperty('--sr-score', scoreTrackPx(c.streak) + 'px');
    panel.innerHTML = popupHtml(c);
  }
  // Esc is one layer in the global handler (esc-nav.js); closeOverlay hands focus back to the card itself.
  (window.sfEscLayers = window.sfEscLayers || []).push({ id: 'series-overlay', z: 76,
    isOpen: function () { return !!(_ov && !_ov.hasAttribute('hidden')); }, close: function () { closeOverlay(); }, ownFocus: true });
  function openOverlay(idxStr) {
    var idx = Number(idxStr);
    if (!_view || !isFinite(idx) || !_view[idx]) return;
    var c = _view[idx];
    if (!(Array.isArray(c.streak.matches) && c.streak.matches.length)) return;
    var back = ensureOverlay();
    _ovCard = c;
    paintOverlay(c);
    _ovReturnFocus = document.querySelector('.sr-card[data-card-idx="' + idxStr + '"]');
    back.removeAttribute('hidden');
    document.body.classList.add('sr-ov-open');
    var panel = back.querySelector('.sr-ov');
    if (panel && panel.focus) panel.focus();
  }
  // A sidebar click closes this overlay before it navigates (TEN-376 S1; a no-op when closed).
  (window.sfOverlayClosers = window.sfOverlayClosers || []).push(function () { closeOverlay(); });
  function closeOverlay() {
    if (!_ov || _ov.hasAttribute('hidden')) return;
    _ov.setAttribute('hidden', '');
    _ovCard = null;
    document.body.classList.remove('sr-ov-open');
    if (_ovReturnFocus && _ovReturnFocus.focus) _ovReturnFocus.focus();
    _ovReturnFocus = null;
  }

  // ─── load / mount ────────────────────────────────────────────────────────────────────────────────────────────
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  function boardMatches() {
    try {
      if (typeof matches !== 'undefined' && Array.isArray(matches) && matches.length) return Promise.resolve(matches);  // eslint-disable-line no-undef
    } catch (e) { /* the board global is not in scope */ }
    return getJSON(MATCHES_URL).then(function (j) { return Array.isArray(j) ? j : (j && Array.isArray(j.matches) ? j.matches : []); },
      function () { return []; });
  }
  // The slot of every card (day word, already-played, start) against the clock and the board NOW.
  function reslot() {
    try {
      if (typeof matches !== 'undefined' && Array.isArray(matches) && matches.length) _matches = matches;  // eslint-disable-line no-undef
    } catch (e) { /* the board global is not in scope */ }
    if (!_cards) return;
    _cards.forEach(function (c) { c.slot = slotOf(c.player); c.streak = shownStreak(c); });
    suppressOutcomeDuplicates(_cards);
  }
  function fetchData() {
    _fetching = true;
    Promise.all([getJSON(DATA_URL), boardMatches()])
      .then(function (res) {
        _fetching = false;
        _data = res[0]; _matches = res[1]; _cards = null; _loadedAt = Date.now();
        _pxState = 'idle'; _pxGen++;   // new match rows: price them afresh
        render();
        priceBoard();
      })
      .catch(function (e) {
        _fetching = false;
        console.warn('[series] load failed:', e.message);
        if (_data) { reslot(); render(); return; }   // keep the last good copy; the next show tries again
        _mounted = false;   // the next visit retries
        var root = document.getElementById('seriesGrid');
        if (root) root.innerHTML = headerHtml(null) + '<p class="sr-note">Streak data is not available right now. It refreshes with the slate — check back shortly.</p>';
      });
  }
  function load() {
    if (_mounted) {
      reslot();
      render();
      if (_data && !_fetching && Date.now() - _loadedAt > DATA_MAX_AGE_MS) fetchData();
      return;
    }
    _mounted = true;
    render();  // "Loading…"
    fetchData();
  }
  function slotTick() {
    _slotTimer = null;
    if (!_active) return;
    reslot();
    render();
    _slotTimer = setTimeout(slotTick, SLOT_TICK_MS);
  }

  function setActive(isActive) {
    if (isActive && !_active) {
      _active = true; load();
      if (!_slotTimer) _slotTimer = setTimeout(slotTick, SLOT_TICK_MS);
    } else if (!isActive) {
      _active = false;
      if (_slotTimer) { clearTimeout(_slotTimer); _slotTimer = null; }
    }
  }

  (function revealNavTab() {
    var show = function () {
      var btn = document.getElementById('seriesTabBtn');
      if (btn) btn.style.display = '';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
    else show();
  })();

  // ─── Today's Matches "Streak on court" (step 15, README §1.2) ─────────────────────────────────────────────────
  // The Series list as the page builds it under its DEFAULTS (gating, floors, the 75-day rule, the outcome
  // de-duplication and the Longest ordering), cut to the cards whose next match is on `day`'s slate and not yet
  // started. Loads series.json quietly (no render) when the page has not been opened; the board is the dashboard's own.
  var _quietP = null;
  function loadQuiet() {
    if (_data) return Promise.resolve(true);
    if (!_quietP) _quietP = getJSON(DATA_URL).then(function (d) {
      if (!_data) { _data = d; _cards = null; _loadedAt = Date.now(); }
      return true;
    }, function (e) { _quietP = null; console.warn('[series] quiet load failed:', e.message); return false; });
    return _quietP;
  }
  function tileClaim(st) {
    var w = st.direction === 'win';
    if (st.type === 'all') return w ? 'wins in a row' : 'losses in a row';
    if (st.type === 'surface') return (w ? 'wins' : 'losses') + ' in a row on ' + cap(st.subtype);
    if (st.type === 'style') return (w ? 'wins' : 'losses') + ' in a row vs ' + (ARCH_LABEL[st.subtype] || st.subtype);
    var c = claimOf(st);   // the Series card's own claim, read on after the count: "Won the opening set" → "won the opening set"
    return c ? c.charAt(0).toLowerCase() + c.slice(1) : c;
  }
  function onCourt(day) {
    return loadQuiet().then(function (ok) {
      if (!ok || !_data) return null;
      if (!_cards) _cards = flatten(_data);
      reslot();
      var f = Object.assign({}, DEFAULTS, { level: 'all' });   // the tile counts every level, as before the ATP default
      // Only a player with a card on this slate (founder 2026-10-28): the slot must be a Today's Matches board card
      // (joined by event key), never a series-only fixture — the board is ATP, so a Challenger streak (Kasnikowski,
      // Sioux Falls) has no card to point at and never heads the tile or counts in "+N more".
      var view = sortCards(_cards.filter(function (c) { return c.slot && c.slot.board && c.slot.day === day && passesFilters(c, false, f); }), f);
      return view.map(function (c) {
        var bm = boardMatchOf(c.player);
        return { card: c, count: c.streak.count, claim: tileClaim(c.streak),
                 name: displayName(c.player.key, c.player.name), key: c.player.key != null ? String(c.player.key) : String(c.player.name),
                 opp: c.slot.opp, event: c.slot.event, matchId: bm ? bm.id : null };
      });
    });
  }
  // Open the Series page on that streak's card (its pop-up). The card is looked up in the rendered view; when the
  // member's own filters hide it, they go back to the defaults first so the card exists to open.
  function openStreak(card) {
    var btn = document.getElementById('seriesTabBtn');
    if (btn) btn.click();
    // Same player, same run (a refetch on the page show rebuilds the card objects, so identity is by value).
    var same = function (a) {
      var x = a.streak, y = card.streak;
      return a.player && card.player && String(a.player.key) === String(card.player.key) && x && y
        && x.type === y.type && x.subtype === y.subtype && x.line === y.line && x.over === y.over
        && x.direction === y.direction && x.count === y.count;
    };
    var find = function () { if (!_view) return -1; for (var k = 0; k < _view.length; k++) if (same(_view[k])) return k; return -1; };
    var tries = 0, reset = false;
    var go = function () {
      if (!_data || _fetching) { if (++tries < 60) setTimeout(go, 250); return; }
      var i = find();
      // Not in view: back to the defaults with the Level switched to the card's own (a Challenger streak opens on
      // Challenger) and already-played shown when its match has started — never a blank sheet.
      if (i < 0 && !reset) {
        reset = true;
        Object.keys(DEFAULTS).forEach(function (k) { _filters[k] = DEFAULTS[k]; });
        if (card.player && (card.player.tier === 'tour' || card.player.tier === 'chal')) _filters.level = card.player.tier;
        if (card.slot && card.slot.played) _filters.showPlayed = true;
        render(); i = find();
        if (i < 0) { _filters.level = 'all'; _filters.showPlayed = true; _filters.minLen = 3; render(); i = find(); }
      }
      if (i >= 0) openOverlay(String(i));
    };
    setTimeout(go, 0);
  }

  window.SeriesPage = {
    setActive: setActive,
    onCourt: onCourt,
    openStreak: openStreak,
    // read-only hooks for the test harness and the DoD probes (no behaviour)
    _view: function () { return _view; },
    _popupHtml: function (i) { return _view && _view[i] ? popupHtml(_view[i]) : null; },
    _pxState: function () { return _pxState; },
  };
})();
