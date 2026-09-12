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
  // The export states the claim WITHOUT its length, then prints the length beside
  // it in accent blue ("Under 23.5 total games (best-of-3)" + "12 in a row"). So
  // the claim builder below is count-free and runLabel() supplies the blue half.
  // The modal restores the long form as "{claim} — {n} matches running" (export §5).
  var ARCH_LABEL = {}; // archetype labels ship already human-readable in the taxonomy
  function streakVerb(dir) { return dir === 'win' ? 'Won' : 'Lost'; }
  function running(n) { return n + ' matches running'; }
  function boTxt(st) { return st.bestOf ? ('best-of-' + esc(String(st.bestOf))) : ''; }
  function bo(st) { return st.bestOf ? (' (' + boTxt(st) + ')') : ''; }
  function runLabel(n) { return n === 1 ? '1 match' : (n + ' in a row'); }
  // Count-free claim. Every branch of the former describe() survives verbatim minus
  // its embedded count, so no streak family loses its wording. Best-of stays inside
  // the claim (never-blend rule) — ruling q3 dropped the separate best-of BADGE, not
  // the format qualifier that makes a games line mean one thing.
  //
  // Item 6 (founder 2026-09-12): the all-competitions title drops "across all
  // competitions" — the TYPE cell two rows down already reads "All comps", so the
  // long form repeated it. "Won on Hard" keeps its surface (not in TYPE) and
  // "Won vs {archetype}" keeps its styles (they ARE the information). The MODAL is
  // explicitly out of scope for that ruling, so it keeps the long form via
  // claimLong() below — the card shortens, the History header does not.
  function claimOf(st) {
    switch (st.type) {
      case 'all':
        return streakVerb(st.direction);
      case 'surface':
        return streakVerb(st.direction) + ' on ' + esc(cap(st.subtype));
      case 'style':
        return streakVerb(st.direction) + ' vs ' + esc(ARCH_LABEL[st.subtype] || st.subtype);
      case 'pattern':
        if (st.subtype === 'lost-first-set') return 'Lost the opening set';
        if (st.subtype === 'won-first-set')  return 'Won the opening set';
        return streakVerb(st.direction);
      case 'total':
        return (st.over ? 'Over ' : 'Under ') + esc(String(st.line)) + ' total games' + bo(st);
      case 'handicap':
        // Item 2 + ruling `handicap-bestof` (a), 2026-09-12: the CARD drops the
        // "(best-of-N)" qualifier — "Covered −3.5 games". Format-locking is unchanged
        // as a data guarantee (a bo3 run still never renders on a bo5 match, see
        // isRelevant/formatLocked); it simply stops being printed here. The History
        // modal keeps it via claimLong() below, because the founder scoped the modal
        // out ("The History modal does not change; it is correct as built"), so the
        // reader still has one place to see the format the run was built on.
        return st.cover
          ? 'Covered −' + esc(String(st.line)) + ' games'
          : 'Beaten by more than ' + esc(String(st.line)) + ' games';
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
  // Long form, modal only. The History modal is out of item 6's scope ("does not
  // change in any respect"), so it keeps the pre-shortening wording verbatim — and
  // out of item 2's scope too, so the handicap claim keeps its "(best-of-N)" here.
  function claimLong(st) {
    if (st.type === 'all') return streakVerb(st.direction) + ' across all competitions';
    if (st.type === 'handicap') return claimOf(st) + bo(st);
    return claimOf(st);
  }
  function describe(st) { return claimLong(st) + ' — ' + running(st.count); }

  // ─── item 5 · the run reference sub-line (founder 2026-09-12) ────────────────
  // "A run length stated alone is the equivalent of a bare percentage — the reader
  // can't tell whether six is remarkable for this player." Beneath the title:
  //
  //     longest since 2021 9 · 4th time at 6+
  //
  // Both halves come from build-series.js's streakReference(), which enumerates every
  // run of THIS streak's own condition across the player's history window using the
  // engine's own conditionHeld(). Nothing is computed here — the card cannot invent a
  // reference the artifact doesn't carry.
  //
  // Ruling `reference-label` (a): NAME the window rather than call it "career". It is
  // five calendar years AND tier-scoped, so "career" would be a false claim (Lajovic,
  // ATP #167, has 78 in-tier matches in it because only his Challenger matches count).
  // The year is read from rules.referenceWindow.sinceYear — the artifact's own record
  // of the window it searched — never from the browser clock, so the label reads the
  // same in Sydney and in Los Angeles and can never name a window we didn't query.
  //
  // Ruling `reference-lone` (a): a run that is the only one ever to reach its own
  // length prints as-is — "longest 9 · 1st time at 9+" — rather than being reworded or
  // truncated. 12 of 117 streaks read that way on the 2026-09-12 board.
  //
  // Item 5: "Both components required. If either is unavailable for a streak type, the
  // sub-line renders — rather than showing half." A missing reference (a pre-item-5
  // artifact, or an enumeration that failed its self-check) and an unnameable window
  // both land there. Never half a sub-line, never a guessed year.
  function ordinal(n) {
    var t = n % 100, d = n % 10;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + (d === 1 ? 'st' : (d === 2 ? 'nd' : (d === 3 ? 'rd' : 'th')));
  }
  function referenceSinceYear() {
    var rw = _data && _data.rules && _data.rules.referenceWindow;
    var y = rw && rw.sinceYear;
    return (typeof y === 'number' && isFinite(y) && y > 1900 && y < 2200) ? y : null;
  }
  function posInt(v) { return typeof v === 'number' && isFinite(v) && v > 0 && v === Math.floor(v); }
  function referenceHtml(st) {
    var ref = st && st.reference, since = referenceSinceYear();
    if (!ref || since == null || !posInt(ref.longest) || !posInt(ref.occurrences) || !posInt(st.count)) {
      return '<div class="sr-ref sr-ref--none">—</div>';
    }
    return '<div class="sr-ref">longest since ' + esc(String(since)) + ' ' + esc(String(ref.longest)) +
      ' · ' + esc(ordinal(ref.occurrences)) + ' time at ' + esc(String(st.count)) + '+</div>';
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
  // Direction, as a WORD (founder ruling q2, 2026-09-12 — "follow the export").
  // The export forbids green/red on this page: "direction is carried by a word, not
  // a colour". The same three-way split the old colour bar encoded survives intact,
  // it is just spelled out. Result runs have a genuine good/bad direction for the
  // player; betting-LINE runs (total games, handicap) and volatility set-shapes
  // (went the distance, first-set games line) have NO good/bad — over 21.5 isn't
  // "better" than under 22.5, it's a different direction — so they read Neutral.
  // Do NOT reintroduce a sign colour here.
  function valence(st) {
    if (st.type === 'total' || st.type === 'handicap') return 'neutral';
    if (st.type === 'setpat' && (st.firstSet || st.subtype === 'went-the-distance')) return 'neutral';
    return st.direction === 'win' ? 'win' : 'loss';
  }
  var DIR_LABEL = { win: 'Winning run', loss: 'Losing run', neutral: 'Neutral' };

  // ─── date / age formatting ───────────────────────────────────────────────────
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(ymd) {
    if (!ymd || !YMD_RE.test(ymd)) return null;
    var p = ymd.split('-');
    var mi = Number(p[1]);
    // The regex admits month 00 and 13; MON[-1]/MON[12] would print the literal
    // string "undefined" into a user-visible cell. Unrenderable → null → a dash.
    if (!(mi >= 1 && mi <= 12)) return null;
    return Number(p[2]) + ' ' + MON[mi - 1] + ' ' + p[0];
  }
  // fmtAge() lived here and rendered the card's "(2w ago)" alongside LAST. The export
  // gives LAST a bare day+month cell, so the age has no slot and the helper became dead
  // code — removed rather than left to rot. Recoverable from git if the age comes back.
  function fmtTime(t) {
    var s = String(t || '').trim();
    return /^\d{1,2}:\d{2}/.test(s) ? s.slice(0, 5) : '';
  }
  // Card strip form: day + month, year stripped (export §3.3 "rendered short").
  // Founder ruling `last-year` (2026-09-12, option a): the year comes back ONLY when
  // the run itself crosses a year boundary — maxGapDays is 75 and Slams are exempt
  // from the recency cap, so "Started 5 Dec / Last 12 Jan" is reachable and would
  // otherwise read as one year. Same-year runs keep the export's bare day + month.
  function fmtShort(ymd, withYear) {
    if (!ymd || !YMD_RE.test(ymd)) return null;
    var p = ymd.split('-');
    var mi = Number(p[1]);
    if (!(mi >= 1 && mi <= 12)) return null;   // month 00/13 → a dash, never "5 undefined"
    return Number(p[2]) + ' ' + MON[mi - 1] + (withYear ? ' ’' + p[0].slice(2) : '');
  }
  // True only when BOTH ends are RENDERABLE and their years differ. Gated on
  // fmtShort rather than a looser regex of its own: if one end can't render it
  // becomes a dash, and a lone "’27" beside a dash says nothing about a crossing.
  function crossesYear(startYmd, lastYmd) {
    if (!fmtShort(startYmd) || !fmtShort(lastYmd)) return false;
    return String(startYmd).slice(0, 4) !== String(lastYmd).slice(0, 4);
  }
  // Founder ruling `prior-year` (ask 1c9de573, 2026-09-12, option a). `last-year` only
  // fires on a CROSSING, which leaves the sibling case uncovered: the Slam recency
  // exemption has no upper age bound, so a Sep-2026 US Open run can still be on the
  // board in Jan 2027 reading a bare "Started 26 Aug / Last 13 Sep" — wholly in a past
  // year, unmarked, and the card's old "(4mo ago)" has no slot in the export to judge
  // it by. So the year ALSO appears whenever LAST is not in the snapshot's own year.
  //
  // The reference is generatedAt's year, NOT the client clock: the page must read the
  // same in every timezone and must never disagree with the data it is painting — a
  // reader in UTC+13 on 1 Jan would otherwise see years the artifact doesn't support.
  // UTC to match the UPDATED clock. No usable generatedAt → no prior-year marking
  // (crossesYear still applies); a year is never guessed.
  // V8's legacy date parser INVENTS a year rather than failing: new Date('Sep 12') is
  // 2001 and new Date('0') is 1999, either of which would silently year-stamp the whole
  // board off a reference year that appears nowhere in the data. And a timestamp with no
  // Z or offset is read in the BROWSER's zone, reintroducing the per-timezone divergence
  // this helper exists to prevent. So accept only an unambiguous instant — a 4-digit-year
  // ISO date, and where a time is present an explicit Z or offset — and fall to null
  // otherwise. build-series.js writes new Date().toISOString(), which always qualifies.
  var ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/;
  function yearOfIso(iso) {
    if (!ISO_INSTANT_RE.test(String(iso == null ? '' : iso))) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return String(d.getUTCFullYear());
  }
  // Gated on fmtShort for the same reason crossesYear is: an unrenderable LAST is a
  // dash, and a dash must not drag a lone year onto the STARTED cell beside it.
  //
  // The reverse direction is ASYMMETRIC ON PURPOSE — founder ruling `lone-year`
  // (ask fc48bac5, 2026-09-12, option a: "keep it — a lone year on LAST is true and
  // useful; lock it with a test"). This rule is a property of LAST alone, so when
  // STARTED is unrenderable the card paints "Started — / Last 12 Sep ’26": a year on
  // one cell. That is kept. "Both cells or neither" was this file's own symmetry
  // preference, never the ruling — suppressing the year here would delete the very
  // signal prior-year exists to restore, on the card that already knows least.
  // Unreachable from today's pipeline (build-series.js always emits a non-empty
  // matches[], and 0 of 117 live streaks lack one), so tools/test-series-dates.js is
  // the only thing holding it — see the `lone-year` block there.
  function priorYear(lastYmd, refIso) {
    var ry = yearOfIso(refIso);
    if (!ry || !fmtShort(lastYmd)) return false;
    return String(lastYmd).slice(0, 4) !== ry;
  }
  // STARTED (founder ruling q5, 2026-09-12). series.json stores no startDate; the run's
  // first match IS its start. matches[] is written oldest→newest by build-series.js and
  // matches.length === count, so matches[0].date is the first match OF THE RUN — for a
  // gap-cut streak that is the start of the cut run, not a pre-layoff origin. Derived,
  // never guessed: no matches → a dash.
  function startedOf(st) {
    var ms = st.matches;
    return (Array.isArray(ms) && ms.length && ms[0] && ms[0].date) ? ms[0].date : null;
  }
  // UPDATED (founder ruling q6): the clock off generatedAt, in UTC, so a reader can
  // answer "is this today's slate?" at a glance. The export hardcoded "now".
  function fmtUpdated(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var hh = String(d.getUTCHours()); if (hh.length < 2) hh = '0' + hh;
    var mm = String(d.getUTCMinutes()); if (mm.length < 2) mm = '0' + mm;
    return hh + ':' + mm + ' UTC';
  }

  // ─── state ───────────────────────────────────────────────────────────────────
  var _data = null;       // parsed series.json
  var _cards = null;      // flattened [{player, streak}] once
  var _view = null;       // current filtered+sorted view (index space for card clicks)
  var _active = false;
  var _mounted = false;

  var _filters = {
    level: 'all',         // all | tour | chal
    // Item 8 (founder 2026-09-12): the Show-already-played CHECKBOX is gone and its
    // job is now a fourth DAY option. That removes the only control on the page that
    // wasn't a segmented control, and it makes the played view mutually exclusive with
    // the upcoming ones — which it always was in practice.
    //   all / today / tomorrow → NOT-yet-played fixtures (the old checkbox-off state)
    //   played                 → already-played fixtures only, any day
    day: 'all',           // all | today | tomorrow | played
    dir: 'all',           // all | win | loss
    type: 'all',          // all | all-comp | surface | style | total | handicap | setout | setgames
    // Item 9 (founder 2026-09-12): the default min-length moves 5+ → 6+. "A five-match
    // win run is unremarkable and fills the page with cards that don't earn one." The
    // 3+/4+/5+ buttons stay, so nothing becomes unreachable — only the default view
    // tightens. THIS literal is the default; load() no longer adopts the artifact's
    // rules.viewFloorDefault (see the note there — a failed build serves a seed carrying
    // 5 and would silently revert the ruling). build-series.js carries the same 6.
    minLen: 6,
    sort: 'longest',      // longest | soonest
  };
  function styleFloor() { return (_data && _data.rules && _data.rules.viewFloorStyle) || 3; }

  // ─── item 1 · outcome-family de-duplication (founder 2026-09-12) ──────────────
  // "A streak whose matches are a subset of a same-length streak in the same outcome
  // family does not get a card." B. Shelton held `Won 6` (all comps) and `Won on Hard
  // 6` over the IDENTICAL six matches — all six were on hard, so the surface run *is*
  // the all-comps run counted twice.
  //
  // Scoped to the MATCH-OUTCOME family only — all comps, surface, vs style. Covering a
  // handicap is a different event from winning a match, so a win streak and a handicap
  // streak of the same length over the same matches are two findings, not one repeated.
  // Handicap / set outcome / set games are never collapsed against these or each other.
  //
  // This is a SUPPRESSION PASS on detection's output, not a change to detection:
  // build-series.js is untouched, every suppressed streak stays in series.json, and the
  // run is still reachable from the surviving card's History modal and the player page.
  //
  // The founder stated a SECOND rule alongside the subset one — "a surface streak earns
  // a card only when it is LONGER than that player's all-comps run" — and it is NOT
  // implemented here. Only the subset rule is. The two are not equivalent, and the
  // difference is a live founder question, reported rather than resolved:
  //   · Subset keeps Shelton's `Won vs Big Server + Complete Baseliner 4`. It starts
  //     12 Aug, a month before his all-comps 6 begins, so it is not a subset. The
  //     longer-than-all-comps rule would delete it — and item 6 explicitly keeps that
  //     card's title. (That sentence was written about SURFACE, not vs-style, so reading
  //     it across to the style card is a stretch either way.)
  //   · The reverse gap is real too: two DISJOINT runs, e.g. an all-comps losing run of 4
  //     and a shorter clay losing run of 3 that ended earlier, are not in a subset
  //     relation, so the shorter surface card survives here where the founder's sentence
  //     would drop it. The clean-context review found exactly that shape (P. Brunclik) in
  //     the committed seed artifact — 0 occurrences on today's live board, which is why
  //     the earlier version of this comment wrongly said the two rules "agree everywhere
  //     except one card". They agree on today's board; they are not the same rule.
  // Implemented: subset only. Awaiting the founder's ruling on the second sentence.
  var OUTCOME_FAMILY = { all: 1, surface: 1, style: 1 };
  // Breadth, for the tie-break when two runs cover the IDENTICAL match set: the broader
  // claim survives. all-comps > surface > vs-style.
  var OUTCOME_BREADTH = { all: 3, surface: 2, style: 1 };
  // A run member is identified by (date, opponent). series.json's matches[] carries no
  // eventKey, and a player cannot play two opponents on one date in one tier. Measured on
  // the live artifact of 2026-09-12: 0 collisions across 117 streaks / 472 run members.
  // (An earlier draft of this comment said 1435 — that figure is the date count from the
  // unrelated comment further down this file, measured on a different snapshot. Caught by
  // the clean-context review; two numbers in one sentence cannot come from one artifact.)
  function memberKey(m) { return String(m && m.date) + '|' + String(m && m.opponent == null ? '' : m.opponent); }
  function memberSet(st) {
    var s = {};
    (Array.isArray(st.matches) ? st.matches : []).forEach(function (m) { s[memberKey(m)] = 1; });
    return s;
  }
  function isSubset(a, b) {          // every key of a present in b
    for (var k in a) { if (Object.prototype.hasOwnProperty.call(a, k) && !b[k]) return false; }
    return true;
  }
  function suppressOutcomeDuplicates(cards) {
    var byPlayer = {};
    cards.forEach(function (c) {
      if (!OUTCOME_FAMILY[c.streak.type]) return;
      // A run with no member list can't be compared and is never suppressed.
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
          // Only the NARROWER claim is ever deleted. Without this the rule reads both
          // ways round and can eat the all-comps card: a player who wins 8 straight on
          // clay with one hard loss buried inside has an all-comps run of 6 whose six
          // matches are all clay — a strict subset of the clay 8. "Won 6 in a row" and
          // "Won on Clay 8 in a row" are two findings, and the founder's rule exists to
          // delete the repeated one, not the broader one. Zero occurrences on today's
          // board (all 27 suppressions are surface-inside-all-comps), so this changes
          // nothing measurable now — it stops the rule misfiring on a slate we haven't
          // seen yet.
          if (OUTCOME_BREADTH[b.streak.type] <= OUTCOME_BREADTH[a.streak.type]) continue;
          a.suppressed = 'subset-of-' + b.streak.type;
          return;
        }
      });
    });
    return cards.filter(function (c) { return !c.suppressed; });
  }
  function memberSetOf(c) { return memberSet(c.streak); }

  // ─── item 2 · the handicap card is −3.5 only (founder 2026-09-12) ─────────────
  // Ruling `handicap-line` (a): "Drop the −1.5/−5.5 fallback — −3.5 only, family
  // disappears on thin days."
  //
  // The engine already PREFERS 3.5 (fix #4, 2026-09-07: priority 3.5 > 5.5 > 1.5), so a
  // card arriving here on any other line means that player has no qualifying −3.5 run.
  // The ruling is therefore not a relabel — it removes the fallback, and on a thin day
  // the family has nothing to say. Measured on the 2026-09-12 board: −1.5 is cleared by
  // 94.6% of won matches and by 79 of 79 straight-sets bo3 wins, so a −1.5 cover run is
  // a straight-sets winner's win streak restated; −3.5 is cleared by 79.8%.
  //
  // Enforced HERE rather than in the engine, exactly as item 1's dedup is: the −1.5 run
  // stays in series.json and stays reachable, it just never gets a card. Reversible
  // without a data rebuild.
  var HANDICAP_DISPLAY_LINE = 3.5;
  function handicapLineAllowed(st) {
    if (st.type !== 'handicap') return true;
    return Number(st.line) === HANDICAP_DISPLAY_LINE;
  }

  function flatten(data) {
    var out = [];
    (data.players || []).forEach(function (p) {
      (p.streaks || []).forEach(function (st) {
        // Non-negotiable guard: pool AND recency must both be present, else drop.
        if (st.pool == null || !st.lastDate || st.ageDays == null) return;
        if (!handicapLineAllowed(st)) return;    // item 2
        out.push({ player: p, streak: st });
      });
    });
    // Suppression runs ONCE over the whole emitted set, before any view filter, so the
    // board can't resurrect a duplicate by narrowing the filters.
    return suppressOutcomeDuplicates(out);
  }

  function passesFilters(c) {
    var p = c.player, st = c.streak, f = _filters;
    if (f.level !== 'all' && p.tier !== f.level) return false;
    // Item 8: DAY absorbed the Show-already-played checkbox. `played` is the only
    // option that shows fixtures that have already been played; the other three all
    // hide them, exactly as the unchecked box did.
    var played = !!(p.upcoming && p.upcoming.played);
    if (f.day === 'played') { if (!played) return false; }
    else {
      if (played) return false;
      if (f.day !== 'all' && (p.upcoming && p.upcoming.day) !== f.day) return false;
    }
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
      // `|| m.date` used to sit in the middle here, printing the RAW string when
      // fmtDate couldn't render it — so a malformed "2026-13-05" appeared verbatim in
      // the modal while the card beside it showed a dash for the same value. Dead code
      // against real data (all 1435 date values in the live artifact are strict
      // YYYY-MM-DD with a valid month) and against the standing rule everywhere else:
      // unrenderable is unknown, and unknown is a dash.
      var d = fmtDate(m.date) ? esc(fmtDate(m.date)) : dash;
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
    // Column header is rendered once by ensureOverlay(), outside this scroll pane.
    return rows;
  }

  // ─── card render ──────────────────────────────────────────────────────────────
  // idx is the card's position in the current view — the whole card is the click
  // target (founder 2026-09-07) and carries it as data-card-idx so the click
  // handler can open the matches overlay for exactly this streak.
  // Card structure is the export's, top to bottom (export §3):
  //   claim + blue run length → reference sub-line (item 5) → player row → tag row →
  //   STARTED/LAST/TYPE strip → next match · History →
  // Removed by founder ruling on 2026-09-12: the big count column and its colour
  // (q2), the 3px valence bar (q2), the POOL cell — modal only now (q1), and the
  // tier / opponent-archetype / Grand-Slam / best-of-badge chips (q3). The tag row
  // is the export's own data-model row, finally rendered (README open item #4).
  function cardHtml(c, idx) {
    var p = c.player, st = c.streak, u = p.upcoming || {};
    var dash = '<span class="sr-dash">—</span>';
    var rankTxt = (p.rank != null && p.rank !== '') ? ('#' + esc(String(p.rank))) : dash;

    // 1 · title row — claim + run length on the left, the direction WORD right-aligned
    // opposite it (item 7, founder 2026-09-12). It previously sat under the player name,
    // in the slot that reads as player metadata; direction is a property of the RUN, so
    // it now sits on the run's own row. Still a word, never a colour (ruling q2).
    var claim = '<div class="sr-cardtop">' +
        '<div class="sr-claim">' + claimOf(st) +
          ' <span class="sr-run">' + esc(runLabel(st.count)) + '</span></div>' +
        '<span class="sr-tag sr-tag-dir">' + esc(DIR_LABEL[valence(st)]) + '</span>' +
      '</div>';

    // 1b · reference sub-line, directly beneath the title (item 5). The run length
    // stays where it was, in the title; this says what that length is worth for this
    // player. Tucked to the title by a negative margin so it reads as a sub-line
    // rather than as a fourth block of the card.
    var refLine = referenceHtml(st);

    // 2 · player row — 20px avatar INLINE with the name on the same baseline (item 4),
    // name, rank. The flag is gone (item 3): nationality changes no read on this page
    // and was the card's only decorative element. emojiFlag survives for the History
    // modal, which is explicitly out of scope.
    var prow =
      '<div class="sr-prow">' + avatarHtml(p) +
        '<span class="sr-pid">' +
          '<span class="sr-pname">' + esc(p.name || u.playerName || '—') + '</span>' +
          '<span class="sr-prank">' + rankTxt + '</span>' +
        '</span>' +
      '</div>';

    // 3 · tag row — already-played view only now that direction has moved up. Whether
    // the streak's OWN condition held: Continued / Broken / Not evaluable is the
    // condition, never the match result; "not evaluable" is excluded from the
    // aggregate rather than guessed. No sign colour on any of them (ruling q2).
    var tags = '';
    if (u.played) {
      var oc = st.outcome;
      if (oc && oc.held === true)             tags += '<span class="sr-tag sr-tag-oc">Continued</span>';
      else if (oc && oc.held === false)       tags += '<span class="sr-tag sr-tag-oc">Broken</span>';
      else if (oc && oc.evaluable === false)  tags += '<span class="sr-tag sr-tag-oc-na" title="The played match could not be evaluated for this streak’s condition — excluded from the continued/broken count">Not evaluable</span>';
      else                                    tags += '<span class="sr-tag sr-tag-oc-na">Played</span>';
      if (u.result) tags += '<span class="sr-played-res">' + esc(u.result) + '</span>';
    }
    // Empty on an upcoming card now that direction has left this row — and an empty
    // .sr-tags would still cost the card 12px of flex gap. "Do not increase card
    // height": no chips, no row.
    var tagRow = tags ? '<div class="sr-tags">' + tags + '</div>' : '';

    // 4 · STARTED · LAST · TYPE
    var startYmd = startedOf(st);
    // Ruling `last-year` (a) OR ruling `prior-year` (a) — a run that straddles a year
    // end, or one whose LAST sits outside the snapshot's own year. showYear is a single
    // flag fed to both cells, so whenever both ends are renderable the year lands on
    // both and they stay readable against each other. An end that CANNOT render is a
    // dash and simply drops its year — which is how ruling `lone-year` (a) produces
    // "Started — / Last 12 Sep ’26" rather than being special-cased.
    var showYear = crossesYear(startYmd, st.lastDate) ||
                   priorYear(st.lastDate, _data && _data.generatedAt);
    var startTxt = fmtShort(startYmd, showYear);
    var lastTxt = fmtShort(st.lastDate, showYear);
    // A year-bearing strip is 84px of mono in the LAST cell, which does NOT fit the
    // export's 1.2fr column below ~364px — measured eliding to "12 Jan ’…", a
    // corrupted date and strictly worse than the bare day+month it replaces. The
    // modifier lets series.css relax ONLY these cards on narrow viewports; same-year
    // cards keep the export's three-column geometry untouched.
    var strip =
      '<div class="sr-strip' + (showYear ? ' sr-strip--yr' : '') + '">' +
        '<span class="sr-cell"><span class="sr-cell-k">Started</span>' +
          '<span class="sr-cell-v">' + (startTxt ? esc(startTxt) : dash) + '</span></span>' +
        '<span class="sr-cell"><span class="sr-cell-k">Last</span>' +
          '<span class="sr-cell-v">' + (lastTxt ? esc(lastTxt) : dash) + '</span></span>' +
        '<span class="sr-cell"><span class="sr-cell-k">Type</span>' +
          '<span class="sr-cell-v sr-cell-type">' + esc(FAM_BADGE[famOf(st)] || st.type) + '</span></span>' +
      '</div>';

    // Whole card is clickable when it has a match list to show. It opens the matches
    // in an overlay (never an inline expand — that reflowed the board). Keyboard-
    // reachable as a button.
    var hasDetail = Array.isArray(st.matches) && st.matches.length > 0;
    var clickAttrs = hasDetail
      ? ' role="button" tabindex="0" aria-haspopup="dialog"' +
        ' aria-label="Show the ' + esc(String(st.count)) + ' matches in this run"' +
        ' data-card-idx="' + esc(String(idx)) + '"'
      : '';

    // 5 · footer: next match (time · vs opponent — the export drops the tour
    // segment; the tournament is still in the modal's Event column) and History →.
    // The opponent slot dashes when the fixture has no opponent yet, rather than
    // vanishing — otherwise "opponent unknown" is indistinguishable from "we don't
    // print the opponent here" (standing rule: missing data is a dash).
    // "History →" is gated on hasDetail: without a match list the card is not
    // clickable, not focusable and opens nothing, so advertising it would be a dead
    // affordance — the same guard the pre-rebuild card applied to its hint row.
    var when = (u.day ? cap(u.day) : '') + (fmtTime(u.time) ? ' ' + fmtTime(u.time) : '');
    var nextBits = [];
    if (when) nextBits.push(esc(when));
    nextBits.push(u.opponentName ? 'vs ' + esc(u.opponentName) : 'vs ' + dash);
    var foot =
      '<div class="sr-foot">' +
        '<span class="sr-next">' + nextBits.join(' · ') + '</span>' +
        (hasDetail ? '<span class="sr-hist">History →</span>' : '') +
      '</div>';

    return '<article class="sr-card' + (hasDetail ? ' sr-has-detail' : '') + '" data-count="' + esc(String(st.count)) + '"' + clickAttrs + '>' +
      claim + refLine + prow + tagRow + strip + foot +
    '</article>';
  }

  // ─── header card (export §1) ───────────────────────────────────────────────────
  // The four stats are live and recount on every filter change: STREAKS is the card
  // count in view, PLAYERS the distinct players inside it, LONGEST RUN the max count
  // (a dash when the view is empty, never 0), UPDATED the clock off generatedAt.
  var SUBTITLE = 'Current streaks for players scheduled today and tomorrow — runs of wins or ' +
    'losses against a playing style, on a surface, straight across all competitions, or on the ' +
    'opening set. Every streak carries the pool it was drawn from and the date of its most ' +
    'recent match. A streak that can’t show both isn’t here.';
  // The title half renders from the FIRST paint, before any data exists. The shell no
  // longer carries a static <h1>, so gating the whole header behind `_data` would leave
  // the loading and fetch-failure states as one unlabelled sentence floating in the tab
  // — the only page in the shell whose document heading depends on a network response.
  // `view` is null on those paints; the four live stats are simply omitted, never zeroed.
  function headerHtml(view) {
    var dash = '<span class="sr-dash">—</span>';
    var stats = '';
    if (view) {
      var players = {};
      view.forEach(function (c) { players[c.player.key || c.player.name] = 1; });
      var longest = view.length ? view.reduce(function (m, c) { return Math.max(m, c.streak.count); }, 0) : null;
      var upd = fmtUpdated(_data && _data.generatedAt);
      var stat = function (k, v, cls) {
        return '<div class="sr-stat"><span class="sr-stat-k">' + k + '</span>' +
               '<span class="sr-stat-v' + (cls ? ' ' + cls : '') + '">' + v + '</span></div>';
      };
      stats = '<div class="sr-stats">' +
        stat('Streaks', esc(String(view.length))) +
        stat('Players', esc(String(Object.keys(players).length))) +
        stat('Longest run', longest != null ? esc(String(longest)) : dash, 'sr-accent') +
        stat('Updated', upd ? esc(upd) : dash, 'sr-soft') +
      '</div>';
    }
    return '<div class="sr-head">' +
      '<div><h1 class="sr-h1">Series</h1><p class="sr-subtitle">' + SUBTITLE + '</p></div>' +
      stats +
    '</div>';
  }

  // ─── filter bar (export §2 — two segmented rows, labels inline; item 8 removed the
  //     checkbox that used to sit on row 2) ────────────────────────────────────────
  function seg(name, opts, cur) {
    return '<div class="sr-seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button type="button" class="sr-segbtn' + (o[0] === cur ? ' active' : '') + '"' +
        ' aria-pressed="' + (o[0] === cur ? 'true' : 'false') + '" data-val="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function fgroup(label, name, opts, cur) {
    return '<span class="sr-fgroup"><span class="sr-flabel">' + esc(label) + '</span>' + seg(name, opts, cur) + '</span>';
  }
  // Item 8 (founder 2026-09-12): three rows plus a checkbox collapse to exactly two
  // segmented rows — LEVEL · DAY · DIRECTION, then TYPE · MIN LENGTH · SORT. The
  // Show-already-played checkbox is gone; `Played` is now DAY's fourth option, which
  // leaves every control on the page the same kind of thing.
  function filterBarHtml() {
    var f = _filters;
    return '<div class="sr-filters">' +
      '<div class="sr-frow">' +
        fgroup('Level', 'level', [['all','All'],['tour','ATP'],['chal','Challenger']], f.level) +
        fgroup('Day', 'day', [['all','All'],['today','Today'],['tomorrow','Tomorrow'],['played','Played']], f.day) +
        fgroup('Direction', 'dir', [['all','All'],['win','Wins'],['loss','Losses']], f.dir) +
      '</div>' +
      '<div class="sr-frow">' +
        fgroup('Type', 'type', [['all','All'],['all-comp','All comps'],['surface','Surface'],['style','Vs style'],['total','Total games'],['handicap','Handicap'],['setout','Set outcome'],['setgames','Set games']], f.type) +
        fgroup('Min length', 'minLen', [['3','3+'],['4','4+'],['5','5+'],['6','6+'],['7','7+'],['8','8+']], String(f.minLen)) +
        fgroup('Sort', 'sort', [['longest','Longest'],['soonest','Soonest']], f.sort) +
      '</div>' +
    '</div>';
  }

  // ─── render ────────────────────────────────────────────────────────────────────
  function render() {
    var root = document.getElementById('seriesGrid');
    if (!root) return;
    if (!_data) { root.innerHTML = headerHtml(null) + '<p class="sr-empty">Loading streaks…</p>'; return; }
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

    // Export order: header card → filter rows → card grid → footnote block. The
    // already-played aggregate sits between the filters and the grid, where it reads
    // as a summary OF the view DAY=Played just opened (it renders only then).
    root.innerHTML = headerHtml(view) + filterBarHtml() + outcomesSummaryHtml(view) +
                     body + footnoteHtml(stamp) + footerHtml();
    wireFilters(root);
  }

  // Footnote block (export §4): the direction sentence — which replaced the colour
  // legend when the valence bar came off (ruling q2) — then the methodology line.
  function footnoteHtml(stamp) {
    return '<div class="sr-footnote">' +
      // "in the tag row" was true until item 7 moved the direction word onto the title
      // row, opposite the streak title. The footnote is on the DO-NOT-CHANGE list, so
      // this is the smallest edit that keeps it from pointing at a row that no longer
      // carries it — four words, reported to the founder rather than done quietly.
      '<p class="sr-fn-dir">Direction shows as a word beside the run length — <b>Winning run</b>, ' +
      '<b>Losing run</b>, <b>Neutral</b>. Betting lines (over/under, handicap) and set-shape ' +
      'volatility are a direction, not good or bad.</p>' + stamp +
    '</div>';
  }

  // CONTINUED/BROKEN summary (fix #3), shown only in the already-played view. Counts
  // over the played cards CURRENTLY in view whose condition could be evaluated; the
  // "not evaluable" cards are reported separately and excluded from the percentage —
  // never guessed (founder standing rule).
  function outcomesSummaryHtml(view) {
    if (_filters.day !== 'played') return '';   // item 8: the checkbox became DAY=Played
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
    // One sentence reworded 2026-09-12 on the founder's `footer-note` ruling (option a):
    // ruling q1 moved POOL off the card into the modal, so "Every card shows both" had
    // gone false. The guarantee behind it is unchanged — flatten still drops a streak
    // with no pool — so only the claim about where you READ it moved.
    return '<footer class="sr-footer">' +
      '<h3>How to read the Series page</h3>' +
      '<p>Every row here is a streak — a run of results that already happened. That is the whole of it. A streak describes the past; it does not forecast the next match. The player who has won five in a row is not owed a sixth.</p>' +
      '<p>Read two numbers before you read anything else. <b>The pool:</b> how many matches the run was drawn from — five wins from eight is worth a look; five from two hundred is a coincidence you were always going to find. <b>The date:</b> when the most recent match in the run was played — form is a live thing, and a run whose last match was months ago is history, not a signal. Every streak carries both, and a streak that can’t show both doesn’t appear. The card gives you the dates; open it to see the pool its run was drawn from.</p>' +
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
    // Export §5: header (name + rank, claim + pool beneath, ✕ right) → sticky column
    // header → scrolling rows. The column header lives OUTSIDE the scroll pane so
    // DATE/EVENT/OPPONENT/SCORE stay visible on a 12-row run.
    back.innerHTML =
      '<div class="sr-ov" role="dialog" aria-modal="true" aria-labelledby="srOvTitle" tabindex="-1">' +
        '<div class="sr-ov-head">' +
          '<span class="sr-ov-headl">' +
            '<span class="sr-ov-title" id="srOvTitle"></span>' +
            '<span class="sr-ov-sub"></span>' +
          '</span>' +
          '<button class="sr-ov-close" type="button" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="sr-mhead">' +
          '<span class="sr-mdate">Date</span>' +
          '<span class="sr-mtour">Event</span>' +
          '<span class="sr-mopp">Opponent</span>' +
          '<span class="sr-mscore">Score</span>' +
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
      '<span>' + (flag ? '<span class="sr-flag">' + flag + '</span>' : '') +
        esc(p.name || u.playerName || '—') + '</span>' +
      '<span class="sr-ov-rank">' + (rankTxt ? esc(rankTxt) : '<span class="sr-dash">—</span>') + '</span>';
    // POOL lives here and only here now (founder ruling q1, 2026-09-12): the card no
    // longer carries it, so this line is the one place a reader sees what the run was
    // drawn from. The engine still refuses to emit a streak without it.
    back.querySelector('.sr-ov-sub').innerHTML = describe(st) +
      ' <span class="sr-ov-sep">·</span> <span class="sr-ov-pool">' + esc(String(st.count)) + ' of ' + esc(String(st.pool)) +
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
        // The default min-length used to be ADOPTED from j.rules.viewFloorDefault here.
        // That line is gone, and its removal is the whole of item 9 actually landing.
        // The clean-context review measured the consequence: build-series.js now emits 6,
        // but the artifact a reader is served is whatever the last successful pipeline run
        // wrote — and pipeline.yml runs the Series build with `continue-on-error` + `|| true`,
        // so ANY failed build falls back to the committed series.json seed, which carries
        // viewFloorDefault: 5. Adopting from the artifact therefore silently reverts the
        // founder's 6+ default to 5+ on every failed build, with no signal.
        // The floor is a VIEW choice — item 9 is explicitly about the page — so the page
        // owns it. build-series.js keeps VIEW_FLOOR_DEFAULT = 6 for its own reporting
        // (`defaultViewCards`) and the two are kept in step by hand; the probe asserts the
        // painted default is 6 against a literal, not against the artifact's own field.
        render();
      })
      .catch(function (e) {
        console.warn('[series] load failed:', e.message);
        var root = document.getElementById('seriesGrid');
        // Keep the heading here too — a bare sentence with no title reads as a broken
        // page rather than a temporarily empty one.
        if (root) root.innerHTML = headerHtml(null) + '<p class="sr-empty">Streak data is not available right now. It refreshes with the daily slate — check back shortly.</p>';
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
