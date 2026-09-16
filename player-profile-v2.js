// player-profile-v2.js — TEN-206 Player Profile rebuild.
//
// Recreates the `design_handoff_player_profile` export in this dashboard's own
// patterns (an IIFE module behind a feature flag, same shape as series.js /
// trading-report.js). The prototype's authoring format (.dc.html, <x-dc>,
// <sc-for>, renderVals, support.js) is NOT ported — the template was read as a
// spec for markup and styling, the script as a data model.
//
// Guard: window.FEATURE_PP2 must be truthy. With the flag OFF the legacy
// buildPlayerProfileHtml renderer is untouched and nothing changes live.
//
// ── Founder rulings encoded here (TEN-206 gate, answered 2026-09-16) ──────────
//   1. HOME/AWAY  = subject player, product-wide.  See normaliseEdition() — the
//      stored `score` is in FEED LISTING ORDER, so it is re-oriented from the
//      recorded result, never read positionally.
//   2. Tiles      = build both headlines exactly as designed (the "Versus
//      playing styles" own-archetype headline and the thrice-shown season win
//      rate are intentional).
//   3. DNA radar  = plot is pct/100, tour ring flat at 0.5, labels show the RAW
//      rating.  dna-apitennis-ratings.json `pct` is already a percentile
//      (p2->0, p98->100), so no new normalisation is invented.
//   4. Court speed= derived from the REAL Tennis Abstract speed values we hold
//      (COURT_CONDITIONS.abstractSpeed, 64 venues).  See SPEED_BANDS.
//   5. Taxonomy   = archetype v5.1 (v5.2 does not exist in this repo).
//   6. Winners/UE = api-tennis native fields, not Match Charting Project.
//   7. Market     = Pinnacle closing, falling back to archive-Bet365 closing,
//      labelled PER ROW.  (Not wired in this module yet — see MARKET_NOTE.)
//
// ── Standing rule ────────────────────────────────────────────────────────────
// Missing data is a dash, never a zero and never a plausible default. Every
// rate carries its record and n. Sample gate per README §9 / DESIGN §5.

(function () {
  'use strict';

  if (!window.FEATURE_PP2) return;

  // ─── typography constants the spec fixes (README §3 data rules) ─────────────
  var MINUS = '−';   // U+2212, never a hyphen
  var ENDASH = '–';  // ranges
  var MIDDOT = '·';  // separators
  var DASH = '—';    // the "not held" em dash
  var DASH_COLOUR = '#4b5672';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Signed numbers use U+2212 for the minus, per README §3.
  function signed(n, dp, suffix) {
    if (n == null || !isFinite(n)) return DASH;
    var v = Number(n).toFixed(dp == null ? 1 : dp);
    var neg = v.charAt(0) === '-';
    if (neg) v = v.slice(1);
    return (neg ? MINUS : '+') + v + (suffix || '');
  }
  function neg(n, dp, suffix) {
    if (n == null || !isFinite(n)) return DASH;
    var v = Number(n).toFixed(dp == null ? 1 : dp);
    return v.replace(/^-/, MINUS) + (suffix || '');
  }

  // ─── sample-size gate (README §9) ──────────────────────────────────────────
  // n >= 10  full rate
  // 5..9     greyed + "small sample"
  // 1..4     W-L only, the row does not open
  // 0        em dash + "no matches on record"
  var GATE = { FULL: 'full', SMALL: 'small', THIN: 'thin', NONE: 'none' };
  function gateFor(n) {
    if (!n) return GATE.NONE;
    if (n < 5) return GATE.THIN;
    if (n < 10) return GATE.SMALL;
    return GATE.FULL;
  }
  // A rate is only ever PRINTED when the gate allows it. Everything else is a
  // dash — this is the single choke point, so no caller can leak a bare 0%.
  function rateText(won, lost) {
    var n = (won || 0) + (lost || 0);
    var g = gateFor(n);
    if (g === GATE.NONE || g === GATE.THIN) return DASH;
    return (100 * won / n).toFixed(1) + '%';
  }
  function recordText(won, lost) {
    if (won == null && lost == null) return DASH;
    return (won || 0) + ENDASH + (lost || 0);
  }

  // The pipeline writes insight prose with ASCII-hyphen records ("315-178
  // career", "1-8 across the last 9"). §3 requires ranges to use an en dash.
  // A census of all 849 hyphenated pairs across the roster found every one to
  // be a W-L RECORD — none is a set or game score — so the swap is safe here.
  // It is deliberately NOT applied to feed score strings: the design file
  // renders those with hyphens ('7-5', '2-0'), which is the tennis convention.
  function endashRecords(text) {
    return String(text == null ? '' : text).replace(/(\d+)-(\d+)/g, '$1' + ENDASH + '$2');
  }

  // ─── RULING 1 · orientation ────────────────────────────────────────────────
  // tournamentHistory edition rows carry only {res, round, opp, oppKey, score}.
  // The `score` string is in the FEED'S LISTING ORDER, not subject-first:
  // measured across all 42,706 stored edition rows, only 31.1% of W-rows read
  // first-higher. There is no isFirst flag to key on — but there does not need
  // to be one. `res` already records the outcome from the SUBJECT's side, so
  // the subject's set count is the higher number on a win and the lower on a
  // loss. That is a derivation from data we hold, not an assumption about
  // ordering.
  //
  // Known limit, deliberately surfaced rather than papered over: a win BY
  // RETIREMENT can leave the subject with the lower set count, and these rows
  // carry no `retired` flag (recentForm does; tournamentHistory does not). Such
  // a row orients backwards. It is flagged `oriented:false` so the renderer can
  // show the raw string instead of a confidently wrong one.
  function normaliseEdition(m) {
    var parts = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(m && m.score || ''));
    var out = {
      res: m.res, round: m.round, opp: m.opp, oppKey: m.oppKey,
      raw: m.score, subjSets: null, oppSets: null, oriented: false
    };
    if (!parts) return out;                       // unparsed -> dash, never a guess
    var a = +parts[1], b = +parts[2];
    if (a === b) return out;                      // tie -> cannot orient
    var hi = Math.max(a, b), lo = Math.min(a, b);
    if (m.res === 'W') { out.subjSets = hi; out.oppSets = lo; out.oriented = true; }
    else if (m.res === 'L') { out.subjSets = lo; out.oppSets = hi; out.oriented = true; }
    return out;
  }
  function editionScoreText(n) {
    if (!n.oriented) return n.raw ? esc(n.raw) : DASH;
    return n.subjSets + ENDASH + n.oppSets;
  }

  // ─── RULING 4 · court-speed bands ──────────────────────────────────────────
  // The design needs five bands; the repo's only prior definition has three
  // (courtSpeedCategory: <=43 Slow, <=68 Medium, else Fast) over a DERIVED
  // 0-100 index. Founder ruled the bands come from Abstract Speed — which we
  // genuinely hold: COURT_CONDITIONS carries a real per-venue `abstractSpeed`
  // (Tennis Abstract AS, 64 venues, 59 of them 2025 values) plus per-year
  // as2023/as2024/as2025.
  //
  // Cut-offs are the QUINTILES of those 64 real AS values, computed once and
  // frozen here so a venue added later cannot silently re-band a player's
  // history. Same disclosure posture as the existing terciles: a derived split
  // of real data, labelled as such, not presented as a sourced band.
  //   n per band: 13 / 13 / 12 / 13 / 13
  var SPEED_BANDS = [
    { id: 'vslow', label: 'Very slow', max: 0.752 },
    { id: 'slow', label: 'Slow', max: 0.938 },
    { id: 'med', label: 'Medium', max: 1.076 },
    { id: 'fast', label: 'Fast', max: 1.188 },
    { id: 'vfast', label: 'Very fast', max: Infinity }
  ];
  var SPEED_BASIS = 'Tennis Abstract speed, quintiles of 64 rated venues';
  function speedBandFor(abstractSpeed) {
    if (abstractSpeed == null || !isFinite(abstractSpeed)) return null;
    for (var i = 0; i < SPEED_BANDS.length; i++) {
      if (abstractSpeed <= SPEED_BANDS[i].max) return SPEED_BANDS[i];
    }
    return SPEED_BANDS[SPEED_BANDS.length - 1];
  }

  // ─── RULING 6 · match-stat provenance ──────────────────────────────────────
  // Winners and Unforced errors ARE native api-tennis fields ("Points:Winners",
  // "Points:Unforced errors") — measured present on 1,356 of 1,964 populated
  // player-sides in historical-match-stats.json (69.0%). Match Charting Project
  // is therefore NOT needed for them and its CC BY-NC-SA / R&D-only flag stays
  // where it is.
  //
  // NET POINTS does not exist in api-tennis. A full key census of the store
  // returns zero net-related fields. It is dashed with a stated reason — never
  // estimated, never derived from winners.
  var STAT_ROWS = [
    { key: 'Points:Winners', label: 'Winners', src: 'api-tennis' },
    { key: 'Points:Unforced errors', label: 'Unforced errors', src: 'api-tennis' },
    { key: null, label: 'Net points won', src: null,
      why: 'not carried by api-tennis' }
  ];

  var MARKET_NOTE =
    'Pinnacle closing prices, falling back to archive-Bet365 closing where ' +
    'Pinnacle is absent, labelled per row.';

  // ─── RULING · career spine (TEN-206 gate 2, answered 2026-09-16) ────────────
  // Founder ruled B: careerByYear is the spine, labelled "since <first year>".
  //
  // The three candidates disagreed and none could be quietly preferred:
  //   careerByYear      per-season rows with per-surface splits and match counts
  //   surfaces.*.record the external get_players aggregate — 1.38x larger at the
  //                     median (399/427 players) with NO match rows behind it, so
  //                     every Career drill would be dead
  //   tournamentHistory sparser again (Jacquet reads 4-7 against a 98-74 season
  //                     record)
  // careerByYear is the only one that reconciles BY CONSTRUCTION — the career
  // total is defined as the sum of the season rows, so §4's first chain holds
  // identically rather than approximately. Its cost is honest and stated on the
  // page: it is a window, not a whole career, so every headline built on it
  // carries "since <year>".
  //
  // Second-order finding, measured: total != clay+hard+grass for 40 of 427
  // players (77 matches in all, at most 5 for any one player) — matches whose
  // surface the feed never recorded. Rather than let the surface rows silently
  // fall short of the total, the residual is emitted as its OWN labelled row.
  // §4 then holds exactly, and nothing is invented to make it hold.
  var SPINE_SURFACES = ['hard', 'clay', 'grass'];
  var SPINE_LABEL = { hard: 'Hard', clay: 'Clay', grass: 'Grass', other: 'Unrecorded surface' };

  function spineYears(p) {
    return (p.careerByYear || []).filter(function (y) { return y && y.total; });
  }
  function spineFirstYear(p) {
    var ys = spineYears(p).map(function (y) { return String(y.year); }).sort();
    return ys.length ? ys[0] : null;
  }
  function spineTotal(p) {
    var w = 0, l = 0;
    spineYears(p).forEach(function (y) { w += y.total.won || 0; l += y.total.lost || 0; });
    return { won: w, lost: l, n: w + l };
  }
  // Surface rows over the spine, INCLUDING the labelled residual. Sum is the
  // career total by construction — the §4 chain, not a coincidence.
  function spineBySurface(p, year) {
    var rows = spineYears(p).filter(function (y) { return !year || String(y.year) === String(year); });
    var out = { hard: { won: 0, lost: 0 }, clay: { won: 0, lost: 0 }, grass: { won: 0, lost: 0 }, other: { won: 0, lost: 0 } };
    var tw = 0, tl = 0;
    rows.forEach(function (y) {
      tw += y.total.won || 0; tl += y.total.lost || 0;
      SPINE_SURFACES.forEach(function (s) {
        if (y[s]) { out[s].won += y[s].won || 0; out[s].lost += y[s].lost || 0; }
      });
    });
    SPINE_SURFACES.forEach(function (s) { tw -= out[s].won; tl -= out[s].lost; });
    out.other.won = tw; out.other.lost = tl;
    return out;
  }

  // ─── RULING · biggest split / biggest band (TEN-206 gates 2 + 3) ───────────
  // Gate 2 (sel-0): use the Key-insights rule for BOTH — the split whose win
  // rate differs from the player's OWN baseline by the largest |pp|, with
  // n >= 10. That is now the one selection rule on this page, so the Splits
  // headline, the Market band headline and Key insights cannot drift apart.
  //
  // Gate 3 (bw-0): that rule is sign-BLIND, so under the label "best split" it
  // can select the player's WORST split — Alcaraz's vs. Top 10 at -11.7pp is his
  // most distinctive split, not his best. Founder ruled: keep the rule, fix the
  // word. Everything user-facing now reads "biggest", which is what |pp| means.
  // Only the label changed; test-pp2-reconcile §12 pins the selection itself,
  // including a case where the pick is negative and the word must still hold.
  //
  // "His own baseline" is the pooled rate over the SAME scope the candidates are
  // drawn from, weighted by match count (README §4: "pooled figures weight by
  // match count") — not an unweighted mean of the split rates, which would let a
  // 10-match split pull the baseline as hard as a 200-match one.
  function pickByLargestGap(cands) {
    var num = 0, den = 0;
    cands.forEach(function (c) { num += c.won; den += c.won + c.lost; });
    if (!den) return null;
    var baseline = 100 * num / den;
    var best = null;
    cands.forEach(function (c) {
      var n = c.won + c.lost;
      if (n < 10) return;                       // the rule's own floor, not a guess
      var rate = 100 * c.won / n;
      var gap = rate - baseline;
      if (!best || Math.abs(gap) > Math.abs(best.gap)) {
        best = { id: c.id, label: c.label, won: c.won, lost: c.lost, n: n, rate: rate, gap: gap };
      }
    });
    return best ? { pick: best, baseline: baseline } : null;
  }

  // ─── surface colours (README §4 / §9; grass aligned to #3dd68c) ────────────
  var SURF_COLOUR = { hard: '#4db8ff', clay: '#e8a84e', grass: '#3dd68c', indoors: '#c6ccdb' };
  function surfColour(s) { return SURF_COLOUR[String(s || '').toLowerCase()] || '#5b6880'; }

  // ─── data access ───────────────────────────────────────────────────────────
  function profileFor(key) {
    var store = window.playerProfiles || {};
    return store[String(key)] || null;
  }
  // Short name for templated copy: the export hard-codes "Jodar's" in helper
  // text; production must substitute the real player's short name.
  function shortName(p) {
    var n = String(p && p.name || '');
    var i = n.indexOf('. ');
    return i >= 0 ? n.slice(i + 2) : n;
  }
  function possessive(name) {
    return name + (/s$/i.test(name) ? "'" : "'s");
  }
  function initials(name) {
    var n = String(name || '');
    var i = n.indexOf('. ');
    var surname = i >= 0 ? n.slice(i + 2) : n;
    return surname.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }

  // recentForm.matches is the only per-match source that carries a DATE, and it
  // is already subject-relative (`won`, and the score string reversed upstream).
  // Sort defensively rather than trusting file order — the ribbon strip is
  // specified oldest -> most recent and the chips are the six most recent.
  function ledgerMatches(p) {
    var raw = (p && p.recentForm && p.recentForm.matches) || [];
    var rows = raw.slice().filter(function (m) {
      // §3: no completed match dated after today. Gate at render, do not trust
      // the source — the prototype itself shipped an "Oct 2026 Barcelona" row.
      return m && m.date && m.date <= todayISO();
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return rows;
  }
  function todayISO() {
    // new Date() with no argument is the fabrication trap that has bitten this
    // repo before (a year invented at render time). It is used here ONLY to
    // bound "not in the future", never to mint a displayed year.
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }
  function currentYear() { return String(new Date().getFullYear()); }

  // A pre-match walkover GIVEN is neither a win nor a loss (founder ruling
  // 2026-08-04, CLAUDE.md). recentForm carries the flag explicitly, so the
  // ribbon and ledger honour it instead of re-deriving from an empty score.
  function counts(m) { return !(m.walkover && !m.won); }

  function formRate(rows) {
    var w = 0, l = 0;
    rows.forEach(function (m) {
      if (!counts(m)) return;
      if (m.won) w++; else l++;
    });
    return { won: w, lost: l, n: w + l };
  }

  // ─── current run (header cell 1) ───────────────────────────────────────────
  function currentRun(rows) {
    var i = rows.length - 1, run = 0, won = null, since = null;
    for (; i >= 0; i--) {
      if (!counts(rows[i])) continue;
      if (won === null) won = !!rows[i].won;
      if (!!rows[i].won !== won) break;
      run++; since = rows[i].date;
    }
    if (!run) return null;
    return { won: won, n: run, since: since };
  }

  function fmtDayMonth(iso) {
    if (!iso) return DASH;
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var p = String(iso).split('-');
    if (p.length !== 3) return DASH;
    return String(+p[2]) + ' ' + MON[+p[1] - 1];
  }
  function daysAgo(iso) {
    if (!iso) return null;
    var then = Date.parse(iso + 'T00:00:00Z');
    var now = Date.parse(todayISO() + 'T00:00:00Z');
    if (!isFinite(then) || !isFinite(now)) return null;
    return Math.round((now - then) / 86400000);
  }
  function agoText(iso) {
    var d = daysAgo(iso);
    if (d == null) return DASH;
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return d + ' days ago';
  }

  // Round label straight off the feed string ("ATP Barcelona - 1/8-finals").
  // round-classify.js is the SSOT for round naming elsewhere; reuse it when the
  // page global is present rather than minting a second taxonomy here.
  function roundLabel(m) {
    if (window.RoundClassify && typeof window.RoundClassify.shortLabel === 'function') {
      var r = window.RoundClassify.shortLabel(m.round);
      if (r) return r;
    }
    var s = String(m.round || '');
    var i = s.lastIndexOf(' - ');
    return i >= 0 ? s.slice(i + 3) : s;
  }
  function eventName(m) {
    return String(m.tournament || '') || DASH;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  // §1 Page frame + back link
  function renderBackLink() {
    return '' +
      '<a href="#" class="pp2-back" data-pp2="back" ' +
      'style="display:inline-flex;align-items:center;gap:9px;font-size:13.5px;font-weight:600;' +
      'color:#5b6880;align-self:flex-start;text-decoration:none;">' +
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l-6 6 6 6"/></svg>' +
      'Players</a>';
  }

  // §2 Header
  function renderHeader(p, ctx) {
    var rank = p.rank == null || p.rank === '' ? null : String(p.rank);
    var rows = ctx.rows;
    var run = currentRun(rows);
    var last = null;
    for (var i = rows.length - 1; i >= 0; i--) { if (counts(rows[i])) { last = rows[i]; break; } }

    var seasonRow = (p.careerByYear || []).filter(function (y) {
      return String(y.year) === currentYear();
    })[0];
    var sWon = seasonRow && seasonRow.total ? seasonRow.total.won : null;
    var sLost = seasonRow && seasonRow.total ? seasonRow.total.lost : null;

    var cells = [];

    // Current run
    cells.push(cell('Current run',
      run ? (run.won ? 'W' : 'L') + run.n : DASH,
      run ? (run.won ? '#3dd68c' : '#e0616f') : DASH_COLOUR,
      run ? 'since ' + fmtDayMonth(run.since) : 'no matches on record'));

    // Last played
    cells.push(cell('Last played',
      last ? agoText(last.date) : DASH,
      last ? '#e8ecf4' : DASH_COLOUR,
      last ? esc(eventName(last) + ' ' + roundLabel(last)) : 'no matches on record'));

    // Next match — fixture feed. Not held by player-profiles.json; when the
    // board's fixture store is not on the page this is a dash with the reason
    // the spec prescribes, never a fabricated "Tomorrow".
    var nx = ctx.nextMatch;
    cells.push(cell('Next match',
      nx ? esc(nx.label) : DASH,
      nx ? '#e8ecf4' : DASH_COLOUR,
      nx ? 'vs ' + (nx.opponent ? esc(nx.opponent) : DASH) : 'no fixture on record'));

    // Season
    var sN = (sWon || 0) + (sLost || 0);
    cells.push(cell('Season',
      sN ? rateText(sWon, sLost) : DASH,
      sN ? '#e8ecf4' : DASH_COLOUR,
      sN ? recordText(sWon, sLost) : 'no matches on record'));

    return '' +
      '<div class="pp2-head" style="border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:26px;' +
      'display:flex;align-items:flex-start;gap:28px;flex-wrap:wrap;">' +
      renderAvatar(p, rank) +
      '<div style="flex:1;min-width:280px;display:flex;flex-direction:column;gap:11px;">' +
        '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
          '<span style="font-size:44px;font-weight:800;letter-spacing:-0.02em;line-height:1;white-space:nowrap;">' +
            esc(p.name) + '</span>' +
          (rank ? '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:600;' +
            'color:#5b6880;background:rgba(159,178,212,0.1);border:1px solid rgba(159,178,212,0.32);' +
            'border-radius:8px;padding:6px 12px;white-space:nowrap;">ATP No. ' + esc(rank) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:18px;font-weight:700;color:' +
          (ctx.archetype ? '#e7e9ee' : DASH_COLOUR) + ';">' +
          esc(ctx.archetype || DASH) + '</div>' +
        '<div style="display:flex;align-items:center;gap:14px;font-size:14px;color:#5b6880;">' +
          '<span>' + esc(p.country || DASH) + '</span>' +
          '<span style="width:1px;height:13px;background:rgba(255,255,255,0.16);"></span>' +
          '<span>' + (p.age == null ? DASH : 'Age ' + esc(p.age)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div style="flex:none;align-self:stretch;display:flex;align-items:stretch;">' +
        cells.join('') +
      '</div>' +
      '</div>';

    function cell(label, value, colour, sub) {
      return '' +
        '<div style="display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:0 20px;' +
        'border-left:1px solid rgba(255,255,255,0.09);">' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
          'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;white-space:nowrap;">' + label + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;' +
          'color:' + colour + ';white-space:nowrap;">' + value + '</div>' +
        '<div style="font-size:12px;color:#5b6880;white-space:nowrap;">' + sub + '</div>' +
        '</div>';
    }
  }

  function renderAvatar(p, rank) {
    return '' +
      '<div style="width:118px;height:118px;position:relative;flex:none;">' +
      '<div style="width:100%;height:100%;border-radius:50%;display:flex;align-items:center;' +
        'justify-content:center;background:linear-gradient(155deg,rgba(91,155,255,0.22),rgba(91,155,255,0.05));' +
        'border:1px solid rgba(91,155,255,0.35);font-family:\'IBM Plex Mono\',monospace;font-size:34px;' +
        'font-weight:700;color:#6aaeff;">' + esc(initials(p.name)) + '</div>' +
      (rank ? '<div style="position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);' +
        'background:#5b9bff;color:#fff;font-family:\'IBM Plex Mono\',monospace;font-size:12px;' +
        'font-weight:700;border-radius:999px;padding:3px 11px;border:2px solid #06070a;">' +
        esc(rank) + '</div>' : '') +
      '</div>';
  }

  // §3 Recent-form ribbon
  function renderRibbon(ctx) {
    var rows = ctx.filtered;
    var last18 = rows.slice(-18);
    var r = formRate(last18);
    var chips = rows.slice(-6).reverse();

    var strip = last18.map(function (m) {
      var w = !!m.won;
      return '<div style="flex:1;height:22px;border-radius:5px;display:flex;align-items:center;' +
        'justify-content:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
        'background:' + (w ? 'rgba(61,214,140,0.22)' : 'rgba(224,97,111,0.22)') + ';' +
        'color:' + (w ? '#3dd68c' : '#e0616f') + ';">' + (w ? 'W' : 'L') + '</div>';
    }).join('');

    var chipHtml = chips.map(function (m) {
      var w = !!m.won;
      return '<div class="pp2-chip" data-pp2="sheet" data-ev="' + esc(m.eventKey || '') + '" ' +
        'style="display:flex;gap:8px;padding:7px 10px;border:1px solid rgba(255,255,255,0.08);' +
        'border-radius:8px;white-space:nowrap;flex:none;cursor:pointer;align-items:center;">' +
        '<div style="width:20px;height:20px;border-radius:5px;display:flex;align-items:center;' +
          'justify-content:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
          'background:' + (w ? 'rgba(61,214,140,0.16)' : 'rgba(224,97,111,0.16)') + ';' +
          'color:' + (w ? '#3dd68c' : '#e0616f') + ';">' + (w ? 'W' : 'L') + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:2px;">' +
          '<div style="font-size:12px;font-weight:700;">' + esc(m.opponent || DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#5b6880;">' +
            esc(eventName(m) + ' ' + roundLabel(m)) + ' ' + MIDDOT + ' ' +
            // Feed SCORE strings keep their hyphens — the design file renders
            // '7-5' / '2-0' that way and that is the tennis convention. The
            // en-dash rule in §3 governs W-L RECORDS, not scorelines. Tagged
            // so the typography check can tell the two apart.
            '<span class="pp2-score">' +
              (m.result && m.result !== '-' ? esc(m.result) : DASH) + '</span></div>' +
        '</div></div>';
    }).join('');

    return '' +
      '<div style="background:#0a0d14;border:1px solid rgba(255,255,255,0.09);border-radius:12px;' +
      'padding:16px 22px;display:grid;grid-template-columns:auto minmax(180px,1.2fr) auto minmax(0,2fr) auto;' +
      'gap:22px;align-items:center;">' +
        '<div style="white-space:nowrap;">' + eyebrow('Recent form') +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:22px;font-weight:700;line-height:1;">' +
            '<span style="color:#5b9bff;">' + (r.n ? rateText(r.won, r.lost) : DASH) + '</span> ' +
            '<span style="font-size:13px;font-weight:600;color:#5b6880;">' +
              (r.n ? recordText(r.won, r.lost) : 'no matches on record') + '</span>' +
          '</div></div>' +
        '<div><div style="display:flex;gap:4px;">' + (strip || '') + '</div>' +
          eyebrow('last ' + last18.length + ' ' + MIDDOT + ' oldest → most recent') + '</div>' +
        '<div style="width:1px;height:44px;background:rgba(255,255,255,0.09);"></div>' +
        '<div style="display:flex;gap:8px;overflow:hidden;' +
          '-webkit-mask-image:linear-gradient(90deg,#000 82%,transparent);' +
          'mask-image:linear-gradient(90deg,#000 82%,transparent);">' + chipHtml + '</div>' +
        '<a href="#" data-pp2="ledger" style="font-size:12.5px;font-weight:700;color:#5b9bff;' +
          'white-space:nowrap;text-decoration:none;">' +
          (ctx.ledgerOpen ? 'Hide ledger' : 'Full ledger →') + '</a>' +
      '</div>';
  }

  function eyebrow(text) {
    return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;font-weight:600;' +
      'letter-spacing:0.14em;text-transform:uppercase;color:#4b5672;margin-top:6px;">' + text + '</div>';
  }

  // §5 Eight stat boxes
  var BOXES = [
    { key: 'career', title: 'Career record', icon: 'M6 4h8v3a4 4 0 01-8 0V4ZM10 11v3M7.5 16.5h5' },
    { key: 'tourn', title: 'Record per tournament', icon: 'M4 5h12v4a6 6 0 01-12 0V5ZM10 15v2M7 18h6' },
    { key: 'season', title: 'Calendar record', icon: 'M4 3h12v14H4zM4 7h12M8 3v14' },
    { key: 'speed', title: 'Court speed', icon: 'M3 14c3-6 11-6 14 0M10 4v3M6 6l2 2M14 6l-2 2' },
    { key: 'styles', title: 'Versus playing styles', icon: 'M10 3v14M4 7l6-4 6 4v6l-6 4-6-4Z' },
    { key: 'splits', title: 'Splits', icon: 'M4 15V9M8 15V5M12 15v-4M16 15V7' },
    { key: 'market', title: 'Market edge', icon: 'M3 13l4-5 3 3 4-6 3 4M3 17h14' },
    { key: 'profile', title: 'Playing profile', icon: 'M4 15V9M8 15V5M12 15v-4M16 15V7' }
  ];

  // Headline size rule (README §5): <=10 chars 30px, 11-16 chars 23px, >16 19px.
  function headlineSize(text) {
    var n = String(text || '').length;
    return n <= 10 ? 30 : n <= 16 ? 23 : 19;
  }

  function renderBoxes(ctx) {
    var vals = ctx.boxVals;
    var cards = BOXES.map(function (b) {
      var v = vals[b.key] || {};
      var head = v.headline == null ? DASH : String(v.headline);
      var sz = headlineSize(head);
      return '' +
        '<div class="pp2-box" data-pp2="box" data-box="' + b.key + '" ' +
        'style="position:relative;background:#0a0d14;border:1px solid rgba(255,255,255,0.09);' +
        'border-radius:10px;padding:18px 16px;display:flex;flex-direction:column;gap:7px;' +
        'min-height:140px;cursor:pointer;transition:border-color .14s;">' +
        '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
          'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
          'style="position:absolute;top:14px;right:14px;color:rgba(91,155,255,0.3);">' +
          '<path d="' + b.icon + '"/></svg>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-weight:700;color:' +
          (v.headline == null ? DASH_COLOUR : '#fff') + ';line-height:1;padding-right:28px;' +
          'font-size:' + sz + 'px;">' + esc(head) + '</div>' +
        '<div style="font-size:13.5px;font-weight:700;margin-top:4px;">' + esc(b.title) + '</div>' +
        '<div style="font-size:10.5px;color:#4b5672;line-height:1.4;margin-top:auto;">' +
          esc(v.support == null ? DASH : v.support) + '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;font-weight:600;' +
            'letter-spacing:0.14em;text-transform:uppercase;color:#4b5672;">Explore the profile</div>' +
          '<div style="font-size:12px;color:#4b5672;">Click a box for the full breakdown</div>' +
        '</div>' +
        '<div class="pp2-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">' +
          cards + '</div>' +
      '</div>';
  }

  // §6 Key insights — README rule: the split whose win rate differs from the
  // player's OWN baseline by the largest |pp| with n >= 10. The stored
  // `insights` array is prose written by the pipeline and does not carry the
  // record/gap the spec requires, so it is rendered only when it supplies both.
  function renderInsights(p) {
    var list = (p.insights || []).slice(0, 3);
    if (!list.length) {
      return '<div><div style="font-size:22px;font-weight:800;letter-spacing:-0.015em;' +
        'margin-bottom:16px;">Key insights</div>' +
        '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">No splits clear the ten-match minimum.</div></div>';
    }
    var cards = list.map(function (ins) {
      var green = ins.accent === 'green';
      var col = green ? '#3dd68c' : '#e0616f';
      var bg = green ? 'rgba(61,214,140,0.14)' : 'rgba(224,97,111,0.14)';
      return '' +
        '<div style="height:100%;background:#0a0d14;border:1px solid rgba(255,255,255,0.09);' +
        'border-radius:12px;padding:24px 24px 26px;display:flex;flex-direction:column;gap:16px;">' +
          '<div style="width:36px;height:36px;border-radius:13px;display:flex;align-items:center;' +
            'justify-content:center;background:' + bg + ';color:' + col + ';">' +
            '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
            'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M4 7l4 4 3-3 5 6M13 14h3v-3"/></svg></div>' +
          '<div style="font-size:18.5px;font-weight:800;letter-spacing:-0.01em;line-height:1.25;color:#fff;">' +
            esc(endashRecords(ins.title)) + '</div>' +
          '<div style="font-size:13.5px;color:#5b6880;line-height:1.7;">' +
            esc(endashRecords(ins.text)) + '</div>' +
        '</div>';
    }).join('');
    return '<div><div style="font-size:22px;font-weight:800;letter-spacing:-0.015em;' +
      'margin-bottom:16px;">Key insights</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:stretch;">' +
      cards + '</div></div>';
  }

  // ─── box headline/support values ───────────────────────────────────────────
  // Every value below is recomputed from the profile. A figure the data cannot
  // support is null -> the box renders a dash, never a placeholder.
  function buildBoxVals(p, ctx) {
    var v = {};

    // 1 · Career record — the careerByYear spine (founder ruling B). Summed from
    // the season rows, so it equals the Career modal total and the sum of its
    // surface rows identically, not approximately (§4).
    var ct = spineTotal(p);
    var fy = spineFirstYear(p);
    v.career = ct.n
      ? { headline: recordText(ct.won, ct.lost),
          support: rateText(ct.won, ct.lost) + ' ' + MIDDOT + ' all surfaces' +
            (fy ? ' ' + MIDDOT + ' since ' + fy : '') }
      : { headline: null, support: 'no matches on record' };

    // 2 · Record per tournament
    var nT = (p.tournamentHistory || []).length;
    v.tourn = nT
      ? { headline: String(nT), support: 'tournaments on record' }
      : { headline: null, support: 'no tournaments on record' };

    // 3 · Calendar record — current season
    var sr = (p.careerByYear || []).filter(function (y) {
      return String(y.year) === currentYear();
    })[0];
    var sw = sr && sr.total ? sr.total.won : 0, sl = sr && sr.total ? sr.total.lost : 0;
    v.season = (sw + sl)
      ? { headline: recordText(sw, sl),
          support: currentYear() + ' season ' + MIDDOT + ' win rate ' + rateText(sw, sl) }
      : { headline: null, support: 'no matches this season' };

    // 4 · Court speed — the FILE's headline is the best SURFACE (the README's
    // "Fast courts" is a pace band and the two taxonomies disagree; the file
    // wins per §0). Best surface by win rate among surfaces clearing the gate.
    var best = null;
    Object.keys(p.surfaces || {}).forEach(function (s) {
      var rec = p.surfaces[s] && p.surfaces[s].record;
      if (!rec) return;
      var n = (rec.won || 0) + (rec.lost || 0);
      if (gateFor(n) !== GATE.FULL) return;
      var pct = 100 * rec.won / n;
      if (!best || pct > best.pct) best = { surf: s, pct: pct, rec: rec, n: n };
    });
    v.speed = best
      ? { headline: best.surf + ' courts',
          support: best.pct.toFixed(1) + '% ' + MIDDOT + ' ' +
            recordText(best.rec.won, best.rec.lost) + ' ' + MIDDOT + ' ' + best.n + ' matches' }
      : { headline: null, support: 'no surface clears the ten-match minimum' };

    // 5 · Versus playing styles — RULING 2: the headline is his OWN archetype,
    // by design, even though the modal behind it reads by OPPOSING archetype.
    v.styles = ctx.archetype
      ? { headline: ctx.archetype, support: 'style signature' }
      : { headline: null, support: 'no archetype on record' };

    // 6 · Splits — "biggest split" has a definition: the founder ruled the
    // Key-insights rule governs it (largest |pp| vs his own baseline, n >= 10).
    var bs = biggestSplit(p);
    v.splits = bs
      ? { headline: bs.pick.label,
          support: 'biggest split ' + MIDDOT + ' ' + bs.pick.rate.toFixed(1) + '% ' + MIDDOT + ' ' +
            bs.pick.n + ' matches ' + MIDDOT + ' ' + signed(bs.pick.gap, 1, 'pp') + ' vs his baseline' }
      : { headline: null, support: 'no split clears the ten-match minimum' };

    // 7 · Market edge — the shard built by build-market-edge.js: Pinnacle close,
    // archive-Bet365 close where Pinnacle is absent, labelled per row. The tour
    // baseline beside it is COMPUTED over the same archive (README §3 bars a
    // rounded constant), not the export's literal -3.79%.
    var mk = marketFor(p.key);
    v.market = mk && mk.headline && mk.headline.yield != null
      ? { headline: neg(mk.headline.yield, 2, '%'),
          support: 'flat-stake yield ' + MIDDOT + ' ' + mk.headline.n + ' priced ' + MIDDOT +
            ' tour ' + neg(mk.tour && mk.tour.all ? mk.tour.all.yield : null, 2, '%') }
      : { headline: null, support: 'no priced matches on record' };

    // 8 · Playing profile — RULING 2: season win rate, knowingly the same
    // number as the header SEASON cell and the Calendar box.
    v.profile = (sw + sl)
      ? { headline: rateText(sw, sl), support: 'win rate this season ' + MIDDOT + ' all surfaces' }
      : { headline: null, support: 'no matches this season' };

    return v;
  }

  // ─── splits (career-splits.json) ───────────────────────────────────────────
  // The Splits modal's own source. 227 of the 428 profiled players have a row —
  // the rest render the box as a dash with "no split clears the ten-match
  // minimum", never a zero.
  //
  // Group order and labels are the design's (README §5.7), and every member is
  // taken from career-splits' own category vocabulary. "Carpet" is in the file's
  // `categories` list but is absent from every player's payload and from the
  // design, so it is not a row here.
  var SPLIT_GROUPS = [
    { id: 'surface', label: 'Surface', members: ['Hard', 'Clay', 'Grass'] },
    { id: 'level', label: 'Level', members: ['Grand Slams', 'Masters', 'Other Tours'] },
    { id: 'format', label: 'Format', members: ['Best of 5', 'Best of 3'] },
    { id: 'round', label: 'By round', members: ['Finals', 'Semi-finals', 'Quarter-finals'] },
    { id: 'opponent', label: 'Opponent', members: ['vs. Righties', 'vs. Lefties', 'vs. Top 10'] }
  ];
  function splitsFor(key) {
    var store = window.careerSplits || {};
    return store[String(key)] || null;
  }
  function splitScope(key, scope) {
    var s = splitsFor(key);
    if (!s) return null;
    return (scope === 'last52' ? s.last52 : s.career) || null;
  }
  // Candidates for the "biggest split" selection: every named split in the five
  // groups that the scope actually carries. A split the file omits is absent,
  // not zero.
  function splitCandidates(key, scope) {
    var sc = splitScope(key, scope);
    if (!sc) return [];
    var out = [];
    SPLIT_GROUPS.forEach(function (g) {
      g.members.forEach(function (m) {
        var r = sc[m];
        if (!r || r.W == null || r.L == null) return;
        out.push({ id: g.id + ':' + m, label: m, won: r.W, lost: r.L });
      });
    });
    return out;
  }
  function biggestSplit(p) {
    return pickByLargestGap(splitCandidates(p.key, 'career'));
  }

  // ─── market edge (market-edge/{key}.json) ──────────────────────────────────
  // Lazy shard, same posture as the existing odds-performance shards: nothing is
  // fetched until the page asks. The module reads a store the host page fills so
  // this file owns no transport.
  function marketFor(key) {
    var store = window.marketEdge || {};
    return store[String(key)] || null;
  }
  // Biggest price band, by the SAME rule the founder ruled for biggest split.
  function biggestBand(key) {
    var mk = marketFor(key);
    if (!mk || !mk.bands) return null;
    var cands = [];
    ['favourite', 'underdog'].forEach(function (g) {
      (mk.bands[g] || []).forEach(function (b) {
        if (b.n == null) return;
        cands.push({ id: g + ':' + b.id, label: b.label + ' ' + MIDDOT + ' ' + g, won: b.wins, lost: b.losses });
      });
    });
    return pickByLargestGap(cands);
  }

  // ─── archetype (v5.1) ──────────────────────────────────────────────────────
  var stylesStore = null;
  function archetypeFor(key) {
    if (!stylesStore) return null;
    var rec = stylesStore[String(key)];
    if (!rec) return null;
    // v5.1 labels verbatim — no renaming, no "Pure"/"High-Risk" qualifiers
    // (those appear only in the README and do not exist in the taxonomy).
    return rec.archetype || rec.label || rec.primary || null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODALS (README §5.1 shell + §5.2/§5.3/§5.7/§5.8 bodies)
  // ═══════════════════════════════════════════════════════════════════════════

  var MODAL_WIDTH = {
    career: 820, tourn: 1120, season: 1180, speed: 1120,
    styles: 820, splits: 900, market: 1080, profile: 820
  };
  function modalSubtitle(key, p, ctx) {
    var sn = shortName(p);
    var fy = spineFirstYear(p);
    var ct = spineTotal(p);
    switch (key) {
      case 'career': return 'All-time record, by surface and by season' + (fy ? ' ' + MIDDOT + ' since ' + fy : '');
      // §3: the export's "678 matches · 2016-2026" is placeholder copy; both
      // halves are real counts here or the clause is dropped entirely.
      case 'tourn': return 'Career win' + ENDASH + 'loss at every event ' + possessive(sn) + ' record carries';
      case 'season': return 'Where in the calendar his results sit' +
        (ct.n ? ' ' + MIDDOT + ' ' + ct.n + ' matches' : '');
      case 'splits': return 'Record and win rate by surface, level, format, round and opponent';
      case 'market': return 'How the market has priced him, and what backing him flat has returned';
      case 'speed': return 'Win rate by court pace band';
      default: return '';
    }
  }

  function modalShell(key, p, ctx, body) {
    var title = (BOXES.filter(function (b) { return b.key === key; })[0] || {}).title || '';
    return '' +
      '<div class="pp2-scrim" data-pp2="scrim" style="position:fixed;inset:0;background:rgba(4,5,9,0.76);' +
      'backdrop-filter:blur(3px);z-index:60;display:flex;align-items:flex-start;justify-content:center;' +
      'padding:28px 20px;overflow-y:auto;">' +
        '<div class="pp2-card" data-pp2="card" style="width:100%;max-width:' + (MODAL_WIDTH[key] || 900) + 'px;' +
        'background:#0a0d14;border:1px solid rgba(91,155,255,0.24);border-radius:16px;overflow:hidden;">' +
          '<div style="display:flex;gap:13px;padding:20px 22px;align-items:flex-start;' +
            'border-bottom:1px solid rgba(255,255,255,0.08);">' +
            '<div style="width:34px;height:34px;border-radius:10px;flex:none;display:flex;align-items:center;' +
              'justify-content:center;background:rgba(91,155,255,0.14);color:#5b9bff;">' +
              '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
              'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="' +
              ((BOXES.filter(function (b) { return b.key === key; })[0] || {}).icon || '') + '"/></svg></div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:17px;font-weight:800;">' + esc(title) + '</div>' +
              '<div style="font-size:12.5px;color:#5b6880;margin-top:2px;">' +
                esc(modalSubtitle(key, p, ctx)) + '</div>' +
            '</div>' +
            '<button type="button" data-pp2="close" aria-label="Close" style="width:32px;height:32px;' +
              'border-radius:9px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);' +
              'color:#8b96b5;cursor:pointer;font-size:15px;line-height:1;">×</button>' +
          '</div>' +
          '<div style="padding:20px 22px 24px;">' + body + '</div>' +
        '</div>' +
      '</div>';
  }

  // A record row with a bar track — the shared row spec (README §5.2A), reused by
  // the Career surface rows and the Splits table so the two cannot drift.
  function barRow(label, meta, won, lost, colour) {
    var n = (won || 0) + (lost || 0);
    var g = gateFor(n);
    var pct = n ? 100 * won / n : 0;
    var rate = rateText(won, lost);
    return '' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) 300px 58px;gap:16px;align-items:center;' +
      'border-radius:10px;padding:13px 16px;border:1px solid rgba(255,255,255,0.07);">' +
        '<div><div style="font-size:14px;font-weight:700;' +
          (g === GATE.NONE ? 'color:' + DASH_COLOUR + ';' : '') + '">' + esc(label) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#4b5672;">' +
            esc(meta) + '</div></div>' +
        '<div style="height:16px;border-radius:4px;background:rgba(255,255,255,0.04);overflow:hidden;">' +
          (n ? '<div style="height:100%;width:' + pct.toFixed(1) + '%;background:' + colour + ';opacity:0.75;"></div>' : '') +
        '</div>' +
        '<div style="text-align:right;font-family:\'IBM Plex Mono\',monospace;font-size:19px;font-weight:700;' +
          'color:' + (rate === DASH ? DASH_COLOUR : '#e8ecf4') + ';">' + rate +
          (g === GATE.SMALL ? '<div style="font-size:9px;font-weight:600;letter-spacing:0.12em;' +
            'text-transform:uppercase;color:#4b5672;">small sample</div>' : '') +
        '</div>' +
      '</div>';
  }

  // ─── RULING · Indoors column (TEN-206 gate 3) ───────────────────────────────
  // The gate offered four columns + a footnote, five columns of dashes, or a
  // pipeline ticket. The founder picked none and corrected the premise: "We
  // should have it through api tennis." He was right. API-Tennis spells indoor
  // events "Hard (Indoor)" / "Clay (Indoor)" / "Grass (Indoor)" — 680 of 10,280
  // tournaments — and OUR normaliser was collapsing them to a bare surface. The
  // pipeline now keeps a `courts` map and careerByYear rows carry an `indoor`
  // breakdown; see tools/test-indoor-court.js.
  //
  // The column is a CARVE-OUT, not a fifth peer: an indoor hard match is hard
  // AND indoor, so listing both inclusively would double-count and break the
  // "columns sum to Total" chain the founder's spine ruling established. Hard,
  // Clay and Grass therefore render OUTDOOR-only here and Indoors takes the
  // rest. Measured on live fixtures: indoor is 12-17% of a top player's window
  // and, for all three sampled, falls entirely inside Hard.
  //
  // Pre-window rows (before currentYear-5) come from the provider's ATP season
  // aggregate, which has no court type at all. Those dash — `indoor: null` is
  // deliberately distinct from a 0-0 record.
  function carveIndoor(surfRec, indRec) {
    if (!surfRec) return null;
    if (!indRec) return surfRec;
    var won = (surfRec.won || 0) - (indRec.won || 0);
    var lost = (surfRec.lost || 0) - (indRec.lost || 0);
    return (won + lost) > 0 ? { won: won, lost: lost } : null;
  }
  function gridCells(y) {
    var ind = y.indoor || null;
    return {
      total: y.total,
      clay: carveIndoor(y.clay, ind && ind.clay),
      hard: carveIndoor(y.hard, ind && ind.hard),
      grass: carveIndoor(y.grass, ind && ind.grass),
      // No court-type source for this row -> dash, not a zero record.
      indoors: ind ? ind.total : null
    };
  }
  // Career footer: the same carve-out summed over the rows that can carry it.
  function careerGridCells(p) {
    var out = { clay: null, hard: null, grass: null, indoors: null };
    var add = function (acc, r) {
      if (!r) return acc;
      if (!acc) return { won: r.won || 0, lost: r.lost || 0 };
      return { won: acc.won + (r.won || 0), lost: acc.lost + (r.lost || 0) };
    };
    spineYears(p).forEach(function (y) {
      var g = gridCells(y);
      out.clay = add(out.clay, g.clay);
      out.hard = add(out.hard, g.hard);
      out.grass = add(out.grass, g.grass);
      out.indoors = add(out.indoors, g.indoors);
    });
    return out;
  }
  // How many spine rows can actually carry the column — the number the footnote
  // quotes, so the page states its own coverage instead of implying completeness.
  function indoorCoverage(p) {
    var rows = spineYears(p);
    return {
      rows: rows.length,
      withCourt: rows.filter(function (y) { return !!y.indoor; }).length,
      window: rows.filter(function (y) { return y.allTier !== false; }).length
    };
  }

  // §5.2 Career record — surface rows over the spine + Record by season.
  function renderCareerModal(p, ctx) {
    var scopeYear = state.careerScope === 'season' ? currentYear() : null;
    var bys = spineBySurface(p, scopeYear);
    var rows = ['hard', 'clay', 'grass', 'other'].map(function (s) {
      var r = bys[s];
      var n = r.won + r.lost;
      // The residual row exists only when the feed actually lost a surface. A
      // zero residual is not a row — it would read as a real, empty category.
      if (s === 'other' && n === 0) return '';
      return barRow(SPINE_LABEL[s],
        n ? recordText(r.won, r.lost) + ' ' + MIDDOT + ' ' + n + ' matches' : 'no matches on record',
        r.won, r.lost, surfColour(s));
    }).join('');

    var years = spineYears(p).slice().sort(function (a, b) {
      return String(b.year) < String(a.year) ? -1 : 1;
    });
    var head = '<div style="display:grid;grid-template-columns:auto repeat(5,minmax(0,1fr));gap:0 14px;">' +
      ['Year', 'Total', 'Clay', 'Hard', 'Indoors', 'Grass'].map(function (h, i) {
        var col = ['#4b5672', '#8b96b5', '#e8a84e', '#4db8ff', '#c6ccdb', '#3dd68c'][i];
        return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;' +
          'letter-spacing:0.18em;text-transform:uppercase;color:' + col + ';' +
          (i ? 'text-align:right;' : '') + '">' + h + '</div>';
      }).join('');
    var body = years.map(function (y) {
      var g = gridCells(y);
      var cells = ['total', 'clay', 'hard', 'indoors', 'grass'].map(function (c) {
        var r = g[c];
        var txt = r ? (r.won || 0) + '/' + (r.lost || 0) : DASH;
        return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:' + (c === 'total' ? 14 : 13) + 'px;' +
          (c === 'total' ? 'font-weight:700;' : '') + 'font-variant-numeric:tabular-nums;text-align:right;' +
          'padding:11px 0;border-top:1px solid rgba(255,255,255,0.05);' +
          (r ? '' : 'color:#3f4860;') + '">' + txt + '</div>';
      }).join('');
      return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;padding:11px 0;' +
        'border-top:1px solid rgba(255,255,255,0.05);">' + esc(String(y.year)) + '</div>' + cells;
    }).join('');
    var ct = spineTotal(p);
    var cs = spineBySurface(p, null);
    var cf = careerGridCells(p);
    var footer = '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;' +
      'padding:15px 0 13px;border-top:1px solid rgba(255,255,255,0.18);">Career</div>' +
      ['total', 'clay', 'hard', 'indoors', 'grass'].map(function (c) {
        var r = c === 'total' ? ct : (c === 'indoors' ? cf.indoors : cf[c]);
        return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:' + (c === 'total' ? 14 : 13) + 'px;' +
          'font-weight:700;font-variant-numeric:tabular-nums;text-align:right;padding:15px 0 13px;' +
          (r ? '' : 'color:#3f4860;') +
          'border-top:1px solid rgba(255,255,255,0.18);">' +
          (r ? (r.won || 0) + '/' + (r.lost || 0) : DASH) + '</div>';
      }).join('') + '</div>';

    var fy = spineFirstYear(p);
    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
        eyebrow(scopeYear ? scopeYear + ' by surface' : 'Career by surface') +
        '<div style="display:flex;gap:2px;background:#0a0d13;border:1px solid rgba(255,255,255,0.09);' +
          'border-radius:9px;padding:2px;">' +
          scopeBtn('career', 'Career', state.careerScope !== 'season') +
          scopeBtn('season', currentYear(), state.careerScope === 'season') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' + rows + '</div>' +
      '<div style="font-size:20px;font-weight:800;margin:24px 0 4px;">Record by season</div>' +
      '<div style="font-size:13px;color:#5b6880;margin-bottom:10px;">Wins / losses' +
        (fy ? ' ' + MIDDOT + ' every season on record from ' + fy : '') + '.</div>' +
      head + body + footer +
      // The spine is a window and the page says so rather than implying a whole
      // career. It is also the reason the surface rows can carry a residual.
      '<div style="font-size:11px;color:#5b6880;margin-top:14px;line-height:1.6;">' +
        'Season rows are the record we hold per year' + (fy ? ' from ' + fy : '') +
        '; the career line is their sum, so the two always agree. ' +
        (cs.other.won + cs.other.lost
          ? 'A separate ' + (cs.other.won + cs.other.lost) + '-match row carries matches whose ' +
            'surface the feed never recorded, so the surface rows still add up to the career total. '
          : '') +
        (function () {
          // The column's own coverage, stated rather than implied. Court type
          // reaches only the fixtures-era rows; the provider's season aggregate
          // behind the older rows carries none, so those read as a dash.
          var ic = indoorCoverage(p);
          if (!ic.rows) return '';
          if (!ic.withCourt) {
            return 'Indoors is a court type carved out of the surface columns, so Hard, Clay and ' +
              'Grass here are outdoor only. No season on record carries court type yet, so the ' +
              'column reads as a dash throughout.';
          }
          return 'Indoors is a court type carved out of the surface columns, so Hard, Clay and Grass ' +
            'here are outdoor only and the five columns still sum to the total. Court type reaches ' +
            ic.withCourt + ' of ' + ic.rows + ' seasons' +
            (ic.withCourt < ic.rows
              ? '; the older rows come from a season aggregate that carries none, and dash rather ' +
                'than reading as no indoor matches played'
              : '') + '.';
        })() +
      '</div>';

    function scopeBtn(id, label, on) {
      return '<button type="button" data-pp2="career-scope" data-scope="' + id + '" style="padding:5px 12px;' +
        'border-radius:7px;font-size:11px;border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'transparent') + ';' +
        'background:' + (on ? 'rgba(91,155,255,0.16)' : 'transparent') + ';color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
        'font-weight:' + (on ? 700 : 600) + ';cursor:pointer;">' + esc(label) + '</button>';
    }
  }

  // §5.3 Record per tournament.
  function renderTournModal(p) {
    var list = (p.tournamentHistory || []).slice().sort(function (a, b) {
      var an = (a.won || 0) + (a.lost || 0), bn = (b.won || 0) + (b.lost || 0);
      return bn - an;
    });
    var q = String(state.tournQuery || '').toLowerCase();
    var shown = q ? list.filter(function (t) { return String(t.name || '').toLowerCase().indexOf(q) >= 0; }) : list;

    var head = '<div style="display:grid;grid-template-columns:minmax(0,1.6fr) 74px 96px 56px 52px;gap:0 14px;">' +
      ['Tournament', 'Seasons', 'Best result', 'W' + ENDASH + 'L', 'Win%'].map(function (h, i) {
        return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;' +
          'letter-spacing:0.1em;text-transform:uppercase;color:#4b5672;' + (i >= 3 ? 'text-align:right;' : '') +
          '">' + h + '</div>';
      }).join('') + '</div>';

    var rows = shown.map(function (t) {
      var n = (t.won || 0) + (t.lost || 0);
      // §4: "Tournament W-L = sum of its listed editions". Recomputed here from
      // the edition rows rather than trusting the stored pair — measured across
      // the whole roster, all 9,419 tournament rows agree, and this keeps it so.
      var ew = 0, el = 0;
      (t.editions || []).forEach(function (e) {
        (e.matches || []).forEach(function (m) { if (m.res === 'W') ew++; else if (m.res === 'L') el++; });
      });
      var reconciles = ew === (t.won || 0) && el === (t.lost || 0);
      var best = (t.editions || []).map(function (e) { return e.finish; }).filter(Boolean)[0] || DASH;
      var span = t.firstYear && t.lastYear
        ? (t.firstYear === t.lastYear ? String(t.firstYear) : t.firstYear + ENDASH + t.lastYear) : DASH;
      return '<div class="pp2-trow" data-pp2="tourn-row" data-t="' + esc(t.name) + '" ' +
        'style="display:grid;grid-template-columns:minmax(0,1.6fr) 74px 96px 56px 52px;gap:0 14px;' +
        'padding:11px 10px;border-top:1px solid rgba(255,255,255,0.06);cursor:pointer;align-items:center;">' +
        '<div style="font-size:13.5px;font-weight:700;">' + esc(t.name) +
          (reconciles ? '' : ' <span style="color:' + DASH_COLOUR + ';font-size:10px;">editions incomplete</span>') + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;">' + span + '</div>' +
        '<div style="font-size:12px;color:#8b96b5;">' + esc(best) + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;text-align:right;">' +
          recordText(ew, el) + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;text-align:right;color:' +
          (gateFor(n) === GATE.FULL ? '#e8ecf4' : DASH_COLOUR) + ';">' + rateText(ew, el) + '</div>' +
        '</div>' + (state.tournOpen === t.name ? renderTournDetail(t) : '');
    }).join('');

    return '' +
      '<div style="font-size:13px;color:#5b6880;margin-bottom:12px;">Search a tournament to see ' +
        esc(possessive(shortName(p))) + ' full career win' + ENDASH + 'loss record there.</div>' +
      '<input type="search" data-pp2="tourn-search" value="' + esc(state.tournQuery || '') + '" ' +
        'placeholder="Search a tournament..." style="width:100%;background:#06070a;' +
        'border:1px solid rgba(255,255,255,0.09);border-radius:12px;padding:14px 18px;font-size:14px;' +
        'color:#e7e9ee;margin-bottom:14px;box-sizing:border-box;">' +
      head +
      (shown.length ? rows :
        '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">No tournament matches that search.</div>') +
      '<div style="font-size:11px;color:#5b6880;margin-top:14px;line-height:1.6;">' +
        'Each W' + ENDASH + 'L is the sum of the editions listed beneath it. ' +
        'This block is the tournament record we hold per event and does not sum to the career ' +
        'total above ' + MIDDOT + ' it carries only events with stored edition detail.</div>';
  }

  function renderTournDetail(t) {
    var eds = (t.editions || []).slice();
    return '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:10px;' +
      'margin:7px 0 9px;padding:13px 15px;">' +
      eds.map(function (e) {
        var ms = (e.matches || []).map(function (m) {
          var nm = normaliseEdition(m);
          var w = m.res === 'W';
          return '<div style="display:grid;grid-template-columns:12px 36px minmax(0,1.3fr) 60px;gap:0 12px;' +
            'align-items:center;padding:5px 0;">' +
            '<div style="width:7px;height:7px;border-radius:50%;background:' + (w ? '#3dd68c' : '#e0616f') + ';"></div>' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;">' +
              esc(m.round || DASH) + '</div>' +
            '<div style="font-size:12.5px;">' + esc(m.opp || DASH) + '</div>' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8b96b5;text-align:right;">' +
              editionScoreText(nm) + '</div>' +
            '</div>';
        }).join('');
        return '<div style="margin-bottom:10px;">' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:600;' +
            'letter-spacing:0.12em;text-transform:uppercase;color:#4b5672;margin-bottom:4px;">' +
            esc(String(e.year)) + ' ' + MIDDOT + ' ' + esc(e.finish || DASH) + '</div>' + ms + '</div>';
      }).join('') +
      '<div style="font-size:10.5px;color:#4b5672;line-height:1.5;">Set scores are shown from ' +
        'this player&#39;s side. A score the feed left unparseable is printed as stored rather than ' +
        'turned round on a guess.</div>' +
      '</div>';
  }

  // §5.7 Splits.
  function renderSplitsModal(p) {
    var scope = state.splitScope === 'last52' ? 'last52' : 'career';
    var sc = splitScope(p.key, scope);
    if (!sc) {
      return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">No split data on record for this player.</div>';
    }
    var cands = splitCandidates(p.key, scope);
    var picked = pickByLargestGap(cands);
    var baseline = picked ? picked.baseline : null;

    var head = '<div style="display:grid;grid-template-columns:minmax(84px,1.25fr) repeat(4,1fr);gap:0 10px;">' +
      ['', 'Record', 'Matches', 'Win rate', 'Vs avg'].map(function (h, i) {
        return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;' +
          'letter-spacing:0.12em;text-transform:uppercase;color:#4b5672;' + (i ? 'text-align:right;' : '') +
          '">' + h + '</div>';
      }).join('') + '</div>';

    var groups = SPLIT_GROUPS.map(function (g) {
      var rows = g.members.map(function (m) {
        var r = sc[m];
        var n = r ? (r.W || 0) + (r.L || 0) : 0;
        var gate = gateFor(n);
        var rate = r ? rateText(r.W, r.L) : DASH;
        var gap = (r && gate === GATE.FULL && baseline != null) ? (100 * r.W / n) - baseline : null;
        return '<div style="display:grid;grid-template-columns:minmax(84px,1.25fr) repeat(4,1fr);gap:0 10px;' +
          'padding:7px 0;border-top:1px solid rgba(255,255,255,0.04);align-items:baseline;">' +
          '<div style="font-size:12.5px;font-weight:700;white-space:nowrap;' +
            (n ? '' : 'color:' + DASH_COLOUR + ';') + '">' + esc(m) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#8b96b5;text-align:right;">' +
            (r ? recordText(r.W, r.L) : DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#5b6880;text-align:right;">' +
            (n ? n : 'no matches on record') + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;text-align:right;color:' +
            (rate === DASH ? DASH_COLOUR : gate === GATE.SMALL ? '#8b96b5' : '#e8ecf4') + ';">' + rate + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:14px;font-weight:700;text-align:right;color:' +
            (gap == null ? DASH_COLOUR : gap >= 0 ? '#3dd68c' : '#e0616f') + ';">' +
            (gap == null ? DASH : signed(gap, 1, 'pp')) + '</div>' +
          '</div>';
      }).join('');
      return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#4b5672;padding:14px 0 6px;' +
        'border-top:1px solid rgba(255,255,255,0.06);">' + g.label + '</div>' + rows;
    }).join('');

    var n52 = splitsFor(p.key);
    return '' +
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px;flex-wrap:wrap;">' +
        '<div style="display:flex;gap:2px;background:#0a0d13;border:1px solid rgba(255,255,255,0.09);' +
          'border-radius:9px;padding:2px;">' +
          scopeBtn('career', 'Career', scope === 'career') +
          scopeBtn('last52', 'Last 52 weeks', scope === 'last52') +
        '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;font-weight:600;' +
          'letter-spacing:0.12em;text-transform:uppercase;color:#4b5672;">' +
          (scope === 'career'
            ? 'Every tour match on record ' + MIDDOT + ' ' + (n52 && n52.matchesParsed != null ? n52.matchesParsed + ' matches' : DASH)
            : 'Rolling 12-month form ' + MIDDOT + ' ' + (n52 && n52.last52Count != null ? n52.last52Count + ' matches' : DASH)) +
        '</div>' +
      '</div>' +
      head + groups +
      '<div style="font-size:11.5px;color:#4b5672;margin-top:12px;line-height:1.6;">' +
        'Record and matches played ' + MIDDOT + ' win rate ' + MIDDOT + ' vs avg is the gap to this ' +
        'player&#39;s own win rate across all splits in this scope' +
        (baseline == null ? '' : ' (' + baseline.toFixed(1) + '%), weighted by match count') + '. ' +
        'A split under ten matches shows its record and a dash for the gap.' +
      '</div>';

    function scopeBtn(id, label, on) {
      return '<button type="button" data-pp2="split-scope" data-scope="' + id + '" style="padding:5px 12px;' +
        'border-radius:7px;font-size:11px;border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'transparent') + ';' +
        'background:' + (on ? 'rgba(91,155,255,0.16)' : 'transparent') + ';color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
        'font-weight:' + (on ? 700 : 600) + ';cursor:pointer;">' + esc(label) + '</button>';
    }
  }

  // §5.8 Market edge — role cards, price bands, book note, cumulative chart.
  function renderMarketModal(p) {
    var mk = marketFor(p.key);
    if (!mk || !mk.headline || !mk.headline.n) {
      return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">' +
        'No priced matches on record. The odds archive is tour main-draw only, so a player ' +
        'whose record is Challenger or qualifying has no priced row here.</div>';
    }
    var sel = state.marketRole || 'all';
    var tourY = mk.tour && mk.tour.all ? mk.tour.all.yield : null;

    var cards = [
      { id: 'all', label: 'All matches', s: mk.roles.all },
      { id: 'favourite', label: 'As favourite', s: mk.roles.favourite },
      { id: 'underdog', label: 'As underdog', s: mk.roles.underdog }
    ].map(function (c) {
      var on = sel === c.id;
      var y = c.s.yield;
      var gap = (y == null || tourY == null) ? null : y - tourY;
      return '<div data-pp2="market-role" data-role="' + c.id + '" style="border-radius:12px;padding:18px 20px;' +
        'display:flex;flex-direction:column;gap:14px;cursor:pointer;' +
        'background:' + (on ? 'rgba(91,155,255,0.08)' : 'transparent') + ';' +
        'border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'rgba(255,255,255,0.08)') + ';">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">' +
          '<div style="font-size:17px;font-weight:800;">' + c.label + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;color:#8b96b5;">' +
            c.s.n + '</div></div>' +
        '<div style="display:flex;gap:18px;">' + fig('Yield', y == null ? DASH : neg(y, 2, '%'), y) +
          fig('Win rate', c.s.winRate == null ? DASH : c.s.winRate.toFixed(1) + '%', null) + '</div>' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">' +
          '<div style="font-size:13.5px;color:#8b96b5;">Vs tour ' +
            (tourY == null ? DASH : neg(tourY, 2, '%')) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:21px;font-weight:700;color:' +
            (gap == null ? DASH_COLOUR : gap >= 0 ? '#3dd68c' : '#e0616f') + ';">' +
            (gap == null ? DASH : signed(gap, 2, 'pp')) + '</div></div>' +
        '</div>';
    }).join('');

    var groups = ['favourite', 'underdog'].map(function (g) {
      var bands = (mk.bands[g] || []).map(function (b) {
        var rate = b.winRate == null ? DASH : b.winRate.toFixed(1) + '%';
        return '<div style="display:grid;grid-template-columns:minmax(96px,1.1fr) 52px 66px 62px 74px;gap:0 10px;' +
          'padding:9px 4px;border-bottom:1px solid rgba(255,255,255,0.05);align-items:baseline;">' +
          '<div style="font-size:14px;font-weight:700;' + (b.n ? '' : 'color:' + DASH_COLOUR + ';') + '">' +
            esc(b.label) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;color:#8b96b5;' +
            'text-align:right;">' + (b.n || DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;color:#8b96b5;' +
            'text-align:right;">' + (b.n ? recordText(b.wins, b.losses) : DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;text-align:right;' +
            'color:' + (rate === DASH ? DASH_COLOUR : '#e8ecf4') + ';">' + rate + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:14px;font-weight:700;text-align:right;' +
            'color:' + (b.yield == null ? DASH_COLOUR : b.yield >= 0 ? '#3dd68c' : '#e0616f') + ';">' +
            (b.yield == null ? DASH : neg(b.yield, 2, '%')) + '</div>' +
          '</div>';
      }).join('');
      var gn = (mk.bands[g] || []).reduce(function (a, b) { return a + (b.n || 0); }, 0);
      return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:700;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#8b96b5;padding:14px 4px 6px;">' +
        (g === 'favourite' ? 'Favourite' : 'Underdog') + ' ' + MIDDOT + ' ' + gn + '</div>' + bands;
    }).join('');

    var bk = mk.headline.book || { pinnacle: 0, bet365: 0 };
    var lvl = mk.roles.level && mk.roles.level.n ? mk.roles.level.n : 0;

    return '' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;letter-spacing:0.06em;' +
        'color:#5b6880;margin-bottom:14px;">All priced matches ' + MIDDOT + ' ' + mk.headline.n +
        ' priced ' + MIDDOT + ' median odds ' + (mk.medianPrice == null ? DASH : mk.medianPrice.toFixed(2)) +
        ' ' + MIDDOT + ' tour baseline ' + (tourY == null ? DASH : neg(tourY, 2, '%')) + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">' + cards + '</div>' +
      '<div style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px 20px 16px;' +
        'margin-top:16px;">' +
        '<div style="font-size:17px;font-weight:800;margin-bottom:10px;">Price sensitivity</div>' +
        '<div style="display:grid;grid-template-columns:minmax(96px,1.1fr) 52px 66px 62px 74px;gap:0 10px;' +
          'border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:6px;">' +
          ['', 'n', 'Record', 'Win rate', 'Yield'].map(function (h, i) {
            return '<div style="font-size:10px;font-weight:600;color:#5b6880;' +
              (i ? 'text-align:right;' : '') + '">' + h + '</div>';
          }).join('') + '</div>' + groups +
      '</div>' +
      // §5's book rule, stated on the page rather than assumed. The counts are
      // this player's own, not a roster-wide claim.
      '<div style="border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 16px;' +
        'margin-top:16px;font-size:12.5px;color:#5b6880;line-height:1.65;">' +
        'Every price is a <b>closing</b> price from the Tennis-Data archive. ' +
        'Pinnacle where Pinnacle priced the match (' + bk.pinnacle + ' of ' + mk.headline.n + '), ' +
        'Bet365&#39;s archive close where it did not (' + bk.bet365 + '). ' +
        'Pinnacle stops at ' + esc(marketPinnacleEnd(mk)) + ', which is why the fallback exists. ' +
        'The de-vig always uses both prices from the same book. ' +
        'Bet365 pre-match snapshots from the live odds feed are a different artefact and are ' +
        'not blended into anything above.' +
        (lvl ? ' ' + lvl + ' match' + (lvl === 1 ? '' : 'es') + ' closed at exactly the same price on ' +
          'both sides — neither favourite nor underdog — and sit in the all-matches card only.' : '') +
      '</div>';

    function fig(cap, val, colourVal) {
      return '<div><div style="font-family:\'IBM Plex Mono\',monospace;font-size:24px;font-weight:700;color:' +
        (colourVal == null ? '#e8ecf4' : colourVal >= 0 ? '#3dd68c' : '#e0616f') + ';">' + val + '</div>' +
        '<div style="font-size:9px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;' +
        'color:#4b5672;margin-top:3px;">' + cap + '</div></div>';
    }
  }

  function marketPinnacleEnd(mk) {
    var m = (mk.coverage && mk.coverage.pinnacleEndByLevel) || {};
    var latest = null;
    Object.keys(m).forEach(function (k) { if (!latest || m[k] > latest) latest = m[k]; });
    return latest || DASH;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.4 CALENDAR RECORD — Calendar + Streaks tabs
  // ---------------------------------------------------------------------------
  // RULING cal-0 (TEN-206 gate 3, answered 2026-09-16). The heat grid needs a
  // DATED row per match and nothing else we hold provides one: careerByYear is
  // year-level, and recentForm's earliest date is 2026 for 363 of 428 players.
  // The founder ruled: build it from the market-edge dated rows and label the
  // scope, rather than hold the block or dash it.
  //
  // The same ruling DROPS §4's "Calendar grid total = career total". It cannot
  // hold: odds-archive is ATP tour MAIN DRAW only, so the grid is a labelled
  // SUBSET of the spine, never its equal (Alcaraz 337 of 353; Jacquet 12 of
  // 172). What replaced the equality is the subset relation plus a visible
  // "N of M" label — both asserted in test-pp2-reconcile §14, so the scope can
  // never silently widen or the label silently disappear.
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Every priced row this player has, oldest first. These are the ONLY dated
  // career rows we hold, which is the whole reason for ruling cal-0.
  function calRows(p) {
    var mk = marketFor(p.key);
    if (!mk || !mk.matches) return [];
    return mk.matches.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  // The surface segment. "Indoors" is a COURT type, not a surface — it reads the
  // archive's `court` column (100% populated over 2004-2026, measured), so it
  // overlaps Hard/Clay/Grass rather than sitting beside them. The note under the
  // grid says so; it is not presented as a fourth surface.
  var CAL_SURFACES = [
    { id: 'all', label: 'All surfaces' }, { id: 'hard', label: 'Hard' },
    { id: 'clay', label: 'Clay' }, { id: 'grass', label: 'Grass' },
    { id: 'indoors', label: 'Indoors' }
  ];
  function calFiltered(p) {
    var rows = calRows(p);
    var s = state.calSurface || 'all';
    if (s === 'all') return rows;
    if (s === 'indoors') return rows.filter(function (r) { return r.court === 'Indoor'; });
    return rows.filter(function (r) { return String(r.surface || '').toLowerCase() === s; });
  }
  // The scope label ruling cal-0 requires — with one correction the ruling could
  // not have anticipated. cal-0 asked for "tour main draw, N of M". For 345 of
  // 356 players that is true. For 11 it INVERTS: the spine is a window, not a
  // career (Mannarino's careerByYear starts at 2015), while the archive reaches
  // back to 2004 — so Djokovic shows 1,277 priced rows against a 601-match
  // spine. "1277 of 601" is not a scope label, it is a false claim of nesting.
  //
  // The two sets are OVERLAPPING, not nested: the archive is narrower by tier
  // (tour main draw only) and deeper in time. So both numbers are still shown —
  // which is what the ruling was for — but as two scopes side by side rather
  // than as a fraction. Flagged to the founder; the "of M" wording is his call.
  function calScope(p) {
    var rows = calRows(p);
    return {
      n: rows.length,
      m: spineTotal(p).n,
      from: rows.length ? String(rows[0].date).slice(0, 4) : null,
      to: rows.length ? String(rows[rows.length - 1].date).slice(0, 4) : null,
      nested: rows.length <= spineTotal(p).n
    };
  }
  function calScopeText(p) {
    var c = calScope(p);
    if (!c.n) return 'no priced matches on record';
    return 'tour main draw ' + MIDDOT + ' ' + c.n + ' priced ' + MIDDOT + ' ' +
      (c.from === c.to ? c.from : c.from + ENDASH + c.to) +
      ' ' + MIDDOT + ' career record above holds ' + c.m;
  }

  // Year x month buckets over the filtered rows.
  function calGrid(rows) {
    var years = {};
    rows.forEach(function (r) {
      var y = String(r.date).slice(0, 4);
      var m = parseInt(String(r.date).slice(5, 7), 10) - 1;
      if (!/^\d{4}$/.test(y) || !(m >= 0 && m < 12)) return;
      if (!years[y]) { years[y] = []; for (var i = 0; i < 12; i++) years[y].push({ won: 0, lost: 0, pl: 0 }); }
      var c = years[y][m];
      c[r.won ? 'won' : 'lost']++;
      if (typeof r.pl === 'number') c.pl += r.pl;
    });
    return Object.keys(years).sort(function (a, b) { return b < a ? -1 : 1; })
      .map(function (y) { return { year: y, cells: years[y] }; });
  }

  // Per-calendar-month totals pooled across seasons, plus the design's own two
  // derived figures. Both definitions are the .dc.html's, quoted in the report:
  //   yield gap  = this month's yield vs the OTHER ELEVEN months combined
  //   consistent = seasons on record in which this month finished above .500;
  //                a season with no matches that month counts as NOT above.
  function calMonths(rows) {
    var grid = calGrid(rows);
    var out = [];
    for (var m = 0; m < 12; m++) out.push({ m: m, won: 0, lost: 0, pl: 0, above: 0 });
    grid.forEach(function (yr) {
      yr.cells.forEach(function (c, m) {
        out[m].won += c.won; out[m].lost += c.lost; out[m].pl += c.pl;
        if (c.won + c.lost > 0 && c.won / (c.won + c.lost) > 0.5) out[m].above++;
      });
    });
    var totalN = 0, totalU = 0;
    out.forEach(function (x) { totalN += x.won + x.lost; totalU += x.pl; });
    out.forEach(function (x) {
      var n = x.won + x.lost;
      x.n = n;
      x.seasons = grid.length;
      x.yield = n ? 100 * x.pl / n : null;
      var on = totalN - n;
      var other = on ? 100 * (totalU - x.pl) / on : null;
      x.gap = (x.yield == null || other == null) ? null : x.yield - other;
    });
    return { months: out, seasons: grid.length, grid: grid };
  }

  // Win/loss runs over the dated sequence, oldest first.
  function calRuns(rows) {
    var runs = [];
    rows.forEach(function (r) {
      var res = r.won ? 'W' : 'L';
      var last = runs[runs.length - 1];
      if (last && last.res === res) { last.len++; last.to = r.date; last.rows.push(r); }
      else runs.push({ res: res, len: 1, from: r.date, to: r.date, rows: [r] });
    });
    return runs;
  }
  // The design's Erdos-Renyi longest-run approximation, transcribed from the
  // .dc.html script (§6.4 asked for the definition behind "expected longest"
  // and "runs of 5+" — it exists there, and this is it, not a reinvention):
  //   expected longest run = log_{1/p}(n(1-p)) + gamma/ln(1/p) - 1/2
  //   expected runs of 5+  = n(1-p)p^5 + n·p(1-p)^5
  // Degenerate rates (p = 0 or 1) make both undefined — they return null and the
  // tile shows a dash, rather than an Infinity rendered as a number.
  function expectedLongest(n, p) {
    if (!n || !(p > 0 && p < 1)) return null;
    var lg = Math.log(1 / p);
    return Math.round(Math.log(n * (1 - p)) / lg + 0.5772 / lg - 0.5);
  }
  function expectedRuns5(n, p) {
    if (!n || !(p > 0 && p < 1)) return null;
    return Math.round(n * (1 - p) * Math.pow(p, 5) + n * p * Math.pow(1 - p, 5));
  }

  function calTile(cap, value, sub, colour) {
    return '<div style="background:#0a0d14;border-radius:12px;padding:15px 16px;text-align:center;">' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;letter-spacing:0.14em;' +
        'text-transform:uppercase;color:#4b5672;">' + esc(cap) + '</div>' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:26px;font-weight:700;margin-top:4px;' +
        'color:' + (value === DASH ? DASH_COLOUR : (colour || '#e8ecf4')) + ';">' + esc(value) + '</div>' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;margin-top:3px;">' +
        esc(sub) + '</div></div>';
  }
  function calSegBtn(attr, id, label, on) {
    return '<button type="button" data-pp2="' + attr + '" data-v="' + esc(id) + '" style="padding:6px 14px;' +
      'border-radius:7px;font-size:12px;border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'transparent') + ';' +
      'background:' + (on ? 'rgba(91,155,255,0.16)' : 'transparent') + ';color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
      'font-weight:' + (on ? 700 : 600) + ';cursor:pointer;">' + esc(label) + '</button>';
  }

  function renderSeasonModal(p) {
    var tab = state.calTab === 'streaks' ? 'streaks' : 'calendar';
    var seg = '<div style="display:flex;gap:2px;background:#0a0d13;border:1px solid rgba(255,255,255,0.09);' +
      'border-radius:9px;padding:3px;align-self:flex-start;">' +
      calSegBtn('cal-tab', 'calendar', 'Calendar', tab === 'calendar') +
      calSegBtn('cal-tab', 'streaks', 'Streaks', tab === 'streaks') + '</div>';
    var scopeNote = '<div style="font-size:11px;color:#5b6880;margin-top:14px;line-height:1.6;">' +
      'This block is built from the priced tour archive ' + MIDDOT + ' ' + esc(calScopeText(p)) + '. ' +
      'It is a subset of the career record above, not the whole of it: the archive covers ATP tour ' +
      'main draw only, so qualifying and Challenger matches are absent by scope, not missing. ' +
      '&ldquo;Indoors&rdquo; is a court type and overlaps Hard, Clay and Grass rather than sitting beside them. ' +
      'Rates show at full size from five matches up; under five show W' + ENDASH + 'L only and a dash for the rate.' +
      '</div>';
    if (!calRows(p).length) {
      return seg + '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;margin-top:14px;">No priced matches on record, ' +
        'so there is no dated row to place in a calendar.</div>';
    }
    return seg + (tab === 'calendar' ? renderCalTab(p) : renderStreakTab(p)) + scopeNote;
  }

  function renderCalTab(p) {
    var rows = calFiltered(p);
    var info = calMonths(rows);
    var months = info.months;
    var withN = months.filter(function (x) { return x.n > 0 && x.gap != null; });
    var bestM = withN.slice().sort(function (a, b) { return b.gap - a.gap; })[0] || null;
    var worstM = withN.slice().sort(function (a, b) { return a.gap - b.gap; })[0] || null;
    // "Best / worst stretch": the highest- and lowest-yielding SEASON on record.
    // The prototype's stretch is a seeded constant; a season is the only span
    // this data defines without inventing a window.
    var seasons = info.grid.map(function (yr) {
      var w = 0, l = 0, pl = 0;
      yr.cells.forEach(function (c) { w += c.won; l += c.lost; pl += c.pl; });
      return { year: yr.year, won: w, lost: l, n: w + l, yield: (w + l) ? 100 * pl / (w + l) : null };
    }).filter(function (s) { return s.n > 0; });
    var byY = seasons.slice().sort(function (a, b) { return b.yield - a.yield; });
    var bestS = byY[0] || null, worstS = byY[byY.length - 1] || null;

    function mTile(cap, x) {
      if (!x) return calTile(cap, DASH, 'no month clears a comparison', null);
      return calTile(cap, MON_FULL[x.m], signed(x.gap, 1, 'pp') + ' ' + MIDDOT + ' n=' + x.n +
        ' ' + MIDDOT + ' ' + x.above + ' of ' + x.seasons, x.gap > 0 ? '#3dd68c' : x.gap < 0 ? '#e0616f' : null);
    }
    function sTile(cap, s) {
      if (!s || s.yield == null) return calTile(cap, DASH, 'no season on record', null);
      return calTile(cap, s.year, neg(s.yield, 1, '%') + ' ' + MIDDOT + ' ' + recordText(s.won, s.lost),
        s.yield > 0 ? '#3dd68c' : s.yield < 0 ? '#e0616f' : null);
    }
    var tiles = '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0 18px;">' +
      sTile('Best stretch', bestS) + sTile('Worst stretch', worstS) +
      mTile('Best month', bestM) + mTile('Worst month', worstM) + '</div>';

    var surfSeg = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
      eyebrow('Calendar form ' + MIDDOT + ' career') +
      '<div style="display:flex;gap:2px;background:#0a0d13;border:1px solid rgba(255,255,255,0.09);' +
      'border-radius:9px;padding:3px;">' +
      CAL_SURFACES.map(function (s) {
        return calSegBtn('cal-surface', s.id, s.label, (state.calSurface || 'all') === s.id);
      }).join('') + '</div></div>';

    var grid = calGrid(rows);
    var head = '<div style="display:contents;">' +
      '<div style="position:sticky;left:0;top:0;z-index:3;background:#0a0d14;"></div>' +
      MON3.map(function (m) {
        return '<div style="position:sticky;top:0;z-index:2;background:#0a0d14;font-family:\'IBM Plex Mono\',monospace;' +
          'font-size:9px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#4b5672;' +
          'text-align:center;padding:6px 0;">' + m + '</div>';
      }).join('') + '</div>';
    var body = grid.map(function (yr) {
      return '<div style="position:sticky;left:0;z-index:1;background:#0a0d14;font-family:\'IBM Plex Mono\',monospace;' +
        'font-size:11.5px;font-weight:700;padding:7px 8px 7px 0;">' + esc(yr.year) + '</div>' +
        yr.cells.map(function (c, m) {
          var n = c.won + c.lost;
          var open = state.calCell === yr.year + '-' + m;
          var bg = 'transparent';
          if (n) {
            var r = c.won / n;
            bg = r > 0.5 ? 'rgba(61,214,140,' + (0.10 + 0.32 * (r - 0.5) * 2).toFixed(3) + ')'
              : r < 0.5 ? 'rgba(224,97,111,' + (0.10 + 0.32 * (0.5 - r) * 2).toFixed(3) + ')'
                : 'rgba(255,255,255,0.07)';
          }
          return '<div ' + (n ? 'data-pp2="cal-cell" data-v="' + yr.year + '-' + m + '" ' : '') +
            'style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;text-align:center;padding:7px 0;' +
            'border-radius:4px;background:' + bg + ';' + (n ? 'cursor:pointer;' : 'color:#3f4860;') +
            (open ? 'box-shadow:inset 0 0 0 1px rgba(91,155,255,0.75);' : '') + '">' +
            (n ? c.won + ENDASH + c.lost : DASH) + '</div>';
        }).join('');
    }).join('');

    var drill = '';
    if (state.calCell) {
      var parts = String(state.calCell).split('-');
      var dy = parts[0], dm = parseInt(parts[1], 10);
      var cellRows = rows.filter(function (r) {
        return String(r.date).slice(0, 4) === dy && parseInt(String(r.date).slice(5, 7), 10) - 1 === dm;
      });
      if (cellRows.length) {
        var cw = cellRows.filter(function (r) { return r.won; }).length;
        var cpl = cellRows.reduce(function (a, r) { return a + (typeof r.pl === 'number' ? r.pl : 0); }, 0);
        drill = '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:10px;' +
          'margin-top:12px;padding:13px 15px;">' +
          '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">' +
            '<div style="font-size:14px;font-weight:700;">' + esc(MON_FULL[dm] + ' ' + dy) +
              ' <span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#8b96b5;' +
              'font-weight:400;">' + recordText(cw, cellRows.length - cw) + '</span></div>' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;color:' +
              (cpl > 0 ? '#3dd68c' : cpl < 0 ? '#e0616f' : '#8b96b5') + ';">' +
              signed(cpl, 2, 'u') + '</div></div>' +
          cellRows.map(function (r) {
            return '<div style="display:grid;grid-template-columns:14px 44px minmax(0,1.1fr) minmax(0,1.3fr) 62px 72px;' +
              'gap:0 14px;align-items:center;padding:5px 0;">' +
              '<div style="width:7px;height:7px;border-radius:50%;background:' +
                (r.won ? '#3dd68c' : '#e0616f') + ';"></div>' +
              '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;">' +
                esc(r.round || DASH) + '</div>' +
              '<div style="font-size:12.5px;">' + esc(r.event || DASH) + '</div>' +
              '<div style="font-size:12.5px;color:#8b96b5;">' + esc(r.opp || DASH) + '</div>' +
              '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;text-align:right;color:#8b96b5;">' +
                (r.price != null ? r.price.toFixed(2) : DASH) + '</div>' +
              '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;text-align:right;color:' +
                (r.pl > 0 ? '#3dd68c' : r.pl < 0 ? '#e0616f' : '#8b96b5') + ';">' +
                (typeof r.pl === 'number' ? signed(r.pl, 2, 'u') : DASH) + '</div></div>';
          }).join('') + '</div>';
      }
    }

    // Month footer — the two derived rows whose definitions the .dc.html fixes.
    var foot = '<div style="display:grid;grid-template-columns:86px repeat(12,minmax(0,1fr));gap:0 6px;' +
      'min-width:880px;margin-top:16px;border-top:1px solid rgba(255,255,255,0.09);padding-top:10px;">' +
      [['n', function (x) { return x.n ? String(x.n) : DASH; }, null],
       ['Yield', function (x) { return x.yield == null ? DASH : neg(x.yield, 1, '%'); },
         function (x) { return x.yield == null ? DASH_COLOUR : x.yield > 0 ? '#3dd68c' : x.yield < 0 ? '#e0616f' : '#8b96b5'; }],
       ['Vs other months', function (x) { return x.gap == null ? DASH : signed(x.gap, 1, 'pp'); },
         function (x) { return x.gap == null ? DASH_COLOUR : x.gap > 0 ? '#3dd68c' : x.gap < 0 ? '#e0616f' : '#8b96b5'; }],
       ['Consistent', function (x) { return x.seasons ? x.above + ' of ' + x.seasons : DASH; }, null]
      ].map(function (row) {
        return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;' +
          'letter-spacing:0.12em;text-transform:uppercase;color:#4b5672;padding:5px 0;">' + row[0] + '</div>' +
          months.map(function (x) {
            return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;text-align:center;' +
              'padding:5px 0;color:' + (row[2] ? row[2](x) : '#8b96b5') + ';">' + esc(row[1](x)) + '</div>';
          }).join('');
      }).join('') + '</div>';

    return tiles + surfSeg +
      '<div style="overflow:auto;max-height:400px;">' +
      '<div style="display:grid;grid-template-columns:86px repeat(12,minmax(0,1fr));gap:0 6px;min-width:880px;">' +
      head + body + '</div></div>' + drill +
      '<div style="overflow-x:auto;">' + foot + '</div>' +
      '<div style="font-size:11px;color:#5b6880;margin-top:12px;line-height:1.6;">' +
        'Grid cells are W' + ENDASH + 'L only. The tint shows whether that month finished above .500 that ' +
        'season, not a yield comparison. ' + esc('Vs other months') + ' compares a month&#39;s yield to the ' +
        'other eleven combined, weighted by matches. ' + esc('Consistent') + ' counts, out of the seasons on ' +
        'record, those in which the month finished above .500; a season with no matches that month counts as ' +
        'not above.</div>';
  }

  function renderStreakTab(p) {
    var rows = calFiltered(p);
    var runs = calRuns(rows);
    var n = rows.length;
    var wins = rows.filter(function (r) { return r.won; }).length;
    var pr = n ? wins / n : 0;
    var longestW = runs.filter(function (r) { return r.res === 'W'; })
      .sort(function (a, b) { return b.len - a.len; })[0] || null;
    var longestL = runs.filter(function (r) { return r.res === 'L'; })
      .sort(function (a, b) { return b.len - a.len; })[0] || null;
    var obs5 = runs.filter(function (r) { return r.len >= 5; }).length;
    var exp5 = expectedRuns5(n, pr);
    var expW = expectedLongest(n, pr);
    function span(r) {
      if (!r) return DASH;
      return fmtDayMonth(r.from) + (r.from === r.to ? '' : ' ' + ENDASH + ' ' + fmtDayMonth(r.to));
    }
    var tiles = '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0 18px;">' +
      calTile('Runs of 5+', String(obs5),
        exp5 == null ? runs.length + ' runs' : 'expected ' + exp5 + ' ' + MIDDOT + ' ' + runs.length + ' runs', null) +
      calTile('Longest win run', longestW ? String(longestW.len) : DASH, span(longestW), longestW ? '#3dd68c' : null) +
      calTile('Longest loss run', longestL ? String(longestL.len) : DASH, span(longestL), longestL ? '#e0616f' : null) +
      calTile('Expected longest', expW == null ? DASH : String(expW),
        expW == null ? 'undefined at this win rate'
          : 'at ' + (pr * 100).toFixed(1) + '% over ' + n + ' matches', null) + '</div>';

    var maxRun = runs.reduce(function (a, x) { return Math.max(a, x.len); }, 1);
    var bars = runs.map(function (x, i) {
      var hh = Math.max(3, Math.round(x.len / maxRun * 68));
      var on = state.calRun === i;
      var up = x.res === 'W';
      return '<div data-pp2="cal-run" data-v="' + i + '" title="' + esc(x.res + x.len) + '" ' +
        'style="width:6px;margin-right:1px;height:140px;display:flex;flex-direction:column;' +
        'justify-content:' + (up ? 'flex-end' : 'flex-start') + ';cursor:pointer;flex:0 0 auto;">' +
        (up ? '<div style="height:' + (68 - hh) + 'px;"></div>' : '<div style="height:68px;"></div>') +
        '<div style="height:' + hh + 'px;background:' +
          (up ? (on ? '#3dd68c' : 'rgba(61,214,140,0.62)') : (on ? '#e0616f' : 'rgba(224,97,111,0.62)')) +
          ';"></div></div>';
    }).join('');

    var detail = '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;letter-spacing:0.1em;' +
      'text-transform:uppercase;color:#4b5672;margin-top:10px;">Click a run for its matches</div>';
    var sel = runs[state.calRun];
    if (sel) {
      var spl = sel.rows.reduce(function (a, r) { return a + (typeof r.pl === 'number' ? r.pl : 0); }, 0);
      detail = '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:10px;' +
        'margin-top:12px;padding:12px 14px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">' +
          '<div style="font-size:14px;font-weight:700;">' + esc(sel.res + sel.len) + ' ' + MIDDOT + ' ' +
            esc(sel.rows[0].event || DASH) +
            (sel.rows.length > 1 ? ' &rarr; ' + esc(sel.rows[sel.rows.length - 1].event || DASH) : '') +
            ' <span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;' +
            'font-weight:400;">' + esc(span(sel)) + '</span></div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;color:' +
            (spl > 0 ? '#3dd68c' : spl < 0 ? '#e0616f' : '#8b96b5') + ';">' + signed(spl, 2, 'u') + '</div></div>' +
        sel.rows.map(function (r) {
          return '<div style="display:grid;grid-template-columns:14px 36px minmax(0,1.1fr) minmax(0,1fr) 56px 56px;' +
            'gap:0 14px;align-items:center;padding:4px 0;">' +
            '<div style="width:7px;height:7px;border-radius:50%;background:' +
              (r.won ? '#3dd68c' : '#e0616f') + ';"></div>' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;">' +
              esc(r.round || DASH) + '</div>' +
            '<div style="font-size:12.5px;">' + esc(r.event || DASH) + '</div>' +
            '<div style="font-size:12.5px;color:#8b96b5;">' + esc(r.opp || DASH) + '</div>' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;text-align:right;color:#8b96b5;">' +
              (r.price != null ? r.price.toFixed(2) : DASH) + '</div>' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;text-align:right;color:' +
              (r.pl > 0 ? '#3dd68c' : r.pl < 0 ? '#e0616f' : '#8b96b5') + ';">' +
              (typeof r.pl === 'number' ? signed(r.pl, 2, 'u') : DASH) + '</div></div>';
        }).join('') + '</div>';
    }

    return tiles +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        eyebrow('Run timeline ' + MIDDOT + ' career order') +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;">' +
          runs.length + ' runs ' + MIDDOT + ' longest ' + maxRun + '</div></div>' +
      '<div style="overflow-x:auto;"><div style="display:flex;align-items:stretch;' +
        'background:linear-gradient(to bottom,transparent 68px,rgba(255,255,255,0.09) 68px,' +
        'rgba(255,255,255,0.09) 69px,transparent 69px);">' + bars + '</div></div>' +
      detail;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.5 COURT SPEED
  // ═══════════════════════════════════════════════════════════════════════════
  // Source: the market-edge shard rows, which build-market-edge.js now stamps with
  // `venue` and `speed` from court-speed-map.json. A row carries speed:null when we
  // hold no Abstract rating for its venue OR the row predates the venue's current
  // surface (Stuttgart's clay era cannot be banded off a 2025 grass reading). Those
  // rows are COUNTED OUT LOUD under the band list, never dropped silently — an
  // unexplained shortfall against the Career tile reads as a broken page.
  //
  // Two scopes live in this modal on purpose, and the design says so itself: the
  // band record/n covers every banded match, while units cover only the rows listed
  // in the panel, labelled "on N listed" (`speedTotal.unitsSub` in the .dc.html).

  /** Surface chips. "Indoors" is a carve-out of the court column, not a surface. */
  var SPEED_SURFACES = [
    { id: 'all', label: 'All' },
    { id: 'Hard', label: 'Hard' },
    { id: 'Clay', label: 'Clay' },
    { id: 'Grass', label: 'Grass' },
    { id: 'Indoors', label: 'Indoors' }
  ];

  function speedRows(p) {
    var mk = marketFor(p.key);
    return (mk && mk.matches) ? mk.matches : [];
  }

  function speedSurfaceMatch(m, surf) {
    if (surf === 'all') return true;
    if (surf === 'Indoors') return String(m.court || '') === 'Indoor';
    return String(m.surface || '') === surf;
  }

  /**
   * Bands for the current surface chip. Returns every band including empty ones —
   * §5.5 keeps under-minimum bands listed with a dash rather than dropping them,
   * because an absent band reads as an absent court, not an absent sample.
   */
  function speedBands(p) {
    var surf = state.speedSurf || 'all';
    var agg = {};
    SPEED_BANDS.forEach(function (b) { agg[b.id] = { band: b, won: 0, lost: 0, pl: 0, priced: 0, rows: [] }; });
    var unbanded = 0;
    speedRows(p).forEach(function (m) {
      if (!speedSurfaceMatch(m, surf)) return;
      if (m.speed == null) { unbanded += 1; return; }
      var b = speedBandFor(m.speed);
      if (!b) { unbanded += 1; return; }
      var a = agg[b.id];
      if (m.won) a.won += 1; else a.lost += 1;
      a.rows.push(m);
      // Every archive row is priced by construction (an unpriced row never reaches a
      // shard), so `listed` and `priced` coincide here. They are still counted
      // separately: the day a non-archive row set feeds this modal they diverge, and
      // a units figure silently summed over a different n is the bug that hides.
      if (m.pl != null) { a.pl += m.pl; a.priced += 1; }
    });
    var out = SPEED_BANDS.map(function (b) { return agg[b.id]; });
    // FILE over README: README §5.5 lists the bands slowest-to-fastest, but the
    // .dc.html returns them fast(72) · medium(66) · vslow(61) · slow(54) · vfast(—)
    // — win rate descending, with un-rateable bands last. The file wins.
    out.sort(function (x, y) {
      var nx = x.won + x.lost, ny = y.won + y.lost;
      var rx = gateFor(nx) === GATE.NONE || gateFor(nx) === GATE.THIN ? null : x.won / nx;
      var ry = gateFor(ny) === GATE.NONE || gateFor(ny) === GATE.THIN ? null : y.won / ny;
      if (rx == null && ry == null) return ny - nx;
      if (rx == null) return 1;
      if (ry == null) return -1;
      return ry - rx;
    });
    out.unbanded = unbanded;
    return out;
  }

  /** The band the panel shows: the current selection if it can open, else the best that can. */
  function speedSelected(bands) {
    var openable = bands.filter(function (b) { return gateFor(b.won + b.lost) !== GATE.NONE && gateFor(b.won + b.lost) !== GATE.THIN; });
    var cur = state.speedBand;
    var hit = cur && openable.filter(function (b) { return b.band.id === cur; })[0];
    return hit || openable[0] || null;
  }

  function renderSpeedModal(p) {
    var bands = speedBands(p);
    var total = speedRows(p).length;
    if (!total) {
      return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">No priced matches on record, so no court can be rated.</div>';
    }

    var chips = SPEED_SURFACES.map(function (s) {
      var on = (state.speedSurf || 'all') === s.id;
      return '<button type="button" data-pp2="speed-surf" data-v="' + s.id + '" style="padding:6px 13px;' +
        'border-radius:8px;font-size:11.5px;cursor:pointer;color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
        'background:' + (on ? 'rgba(91,155,255,0.16)' : 'transparent') + ';' +
        'border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'rgba(255,255,255,0.08)') + ';">' +
        esc(s.label) + '</button>';
    }).join('');

    var sel = speedSelected(bands);
    var cards = bands.map(function (b) {
      var n = b.won + b.lost;
      var gate = gateFor(n);
      var openable = gate !== GATE.NONE && gate !== GATE.THIN;
      var on = sel && sel.band.id === b.band.id;
      var rate = rateText(b.won, b.lost);
      return '<div' + (openable ? ' data-pp2="speed-band" data-v="' + b.band.id + '"' : '') +
        ' style="display:grid;grid-template-columns:1fr auto;gap:10px;border-radius:9px;padding:11px 13px;' +
        'align-items:center;border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'rgba(255,255,255,0.08)') + ';' +
        'background:' + (on ? 'rgba(91,155,255,0.10)' : 'transparent') + ';' +
        'cursor:' + (openable ? 'pointer' : 'default') + ';">' +
        '<div>' +
          '<div style="font-size:13px;font-weight:700;color:' + (openable ? '#e7e9ee' : '#3f4860') + ';">' +
            esc(b.band.label) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#4b5672;margin-top:3px;">' +
            (n ? recordText(b.won, b.lost) + ' ' + MIDDOT + ' ' + n + ' matches' : 'no matches on record') +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;color:' +
            (b.priced ? (b.pl >= 0 ? '#3dd68c' : '#e0616f') : DASH_COLOUR) + ';">' +
            (b.priced ? signed(b.pl, 1, 'u') : DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;margin-top:2px;color:' +
            (rate === DASH ? DASH_COLOUR : gate === GATE.SMALL ? '#8b96b5' : '#e8ecf4') + ';">' + rate + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Career footer. Summed from the SAME band objects the cards render, so the
    // footer cannot disagree with the list above it (§4).
    var tw = 0, tl = 0, tpl = 0, tpriced = 0;
    bands.forEach(function (b) { tw += b.won; tl += b.lost; tpl += b.pl; tpriced += b.priced; });
    var tn = tw + tl;
    var surfLabel = (state.speedSurf || 'all') === 'all' ? 'Career' : 'Career ' + MIDDOT + ' ' + state.speedSurf;
    var footer = '<div style="display:grid;grid-template-columns:1fr auto;gap:10px;padding:11px 13px;' +
      'border-top:1px solid rgba(255,255,255,0.09);margin-top:2px;align-items:center;">' +
      '<div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
          'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;">' + esc(surfLabel) + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#4b5672;margin-top:4px;">' +
          (tn ? tn + ' matches' : DASH) + '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div><span style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:600;color:' +
          (tpriced ? (tpl >= 0 ? '#3dd68c' : '#e0616f') : DASH_COLOUR) + ';">' +
          (tpriced ? signed(tpl, 1, 'u') : DASH) + '</span> ' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;color:#4b5672;">' +
          (tpriced ? 'on ' + tpriced + ' listed' : '') + '</span></div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:600;color:' +
          (rateText(tw, tl) === DASH ? DASH_COLOUR : '#8b96b5') + ';">' + rateText(tw, tl) + '</div>' +
      '</div>' +
    '</div>';

    return '' +
      '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px;">' + chips + '</div>' +
      '<div class="pp2-speed" style="display:grid;grid-template-columns:268px minmax(0,1fr);gap:18px;">' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' + cards + footer + '</div>' +
        renderSpeedPanel(sel) +
      '</div>' +
      renderSpeedNote(bands, total);
  }

  function renderSpeedPanel(sel) {
    if (!sel) {
      return '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:10px;' +
        'overflow:hidden;"><div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;' +
        'padding:26px;margin:18px;text-align:center;font-size:13px;color:#5b6880;">' +
        'No band clears the five-match minimum, so none opens.</div></div>';
    }
    var head = '<div style="display:flex;align-items:center;gap:12px;padding:13px 16px;' +
      'border-bottom:1px solid rgba(255,255,255,0.07);">' +
      '<span style="font-size:13.5px;font-weight:700;white-space:nowrap;">' + esc(sel.band.label) + ' courts</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#8b96b5;flex:none;">' +
        recordText(sel.won, sel.lost) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#4b5672;margin-left:auto;' +
        'flex:none;">' + esc(SPEED_BASIS) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;flex:none;color:' +
        (sel.priced ? (sel.pl >= 0 ? '#3dd68c' : '#e0616f') : DASH_COLOUR) + ';">' +
        (sel.priced ? signed(sel.pl, 1, 'u') : DASH) + '</span>' +
    '</div>';

    // Newest first, grouped by event — the design groups a run of matches under the
    // tournament they were played at rather than repeating the event on every row.
    var rows = sel.rows.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var out = '', lastGroup = null;
    rows.forEach(function (m) {
      var g = m.event + '|' + m.date.slice(0, 4);
      if (g !== lastGroup) {
        lastGroup = g;
        out += '<div style="display:flex;gap:8px;align-items:baseline;padding:12px 0 5px;">' +
          '<span style="font-size:11.5px;font-weight:700;color:#c6ccdb;">' + esc(m.event) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;color:#4b5672;">' +
            esc([m.surface, m.court === 'Indoor' ? 'Indoors' : null, m.level, m.date.slice(0, 4)]
              .filter(Boolean).join(' ' + MIDDOT + ' ')) + '</span>' +
          (m.venue && m.venue !== m.event
            ? '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;color:#3f4860;">' +
              esc(m.venue) + '</span>' : '') +
        '</div>';
      }
      out += '<div data-pp2="sheet" data-v="' + esc(m.date + '|' + m.opp) + '" ' +
        'style="display:grid;grid-template-columns:52px 12px 1.1fr 38px 44px 1.3fr 48px 48px;gap:0 8px;' +
        'padding:6px 0;border-top:1px solid rgba(255,255,255,0.04);align-items:baseline;cursor:pointer;' +
        'font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;">' +
        '<span style="color:#5b6880;">' + esc(shortDate(m.date)) + '</span>' +
        '<span style="color:' + (m.won ? '#3dd68c' : '#e0616f') + ';">' + (m.won ? 'W' : 'L') + '</span>' +
        '<span style="font-family:inherit;color:#e8ecf4;">' + esc(m.opp) + '</span>' +
        '<span style="color:#5b6880;">' + esc(shortRound(m.round)) + '</span>' +
        // Set counts and set scores: the odds archive drops Tennis-Data's per-set
        // columns at ingest, so neither is held for these rows. Dashed, not guessed.
        '<span style="color:' + DASH_COLOUR + ';">' + DASH + '</span>' +
        '<span style="color:' + DASH_COLOUR + ';">' + DASH + '</span>' +
        '<span style="text-align:right;color:#e8ecf4;">' + (m.price == null ? DASH : m.price.toFixed(2)) + '</span>' +
        '<span style="text-align:right;color:#5b6880;">' + (m.oppPrice == null ? DASH : m.oppPrice.toFixed(2)) + '</span>' +
      '</div>';
    });

    return '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:10px;overflow:hidden;">' +
      head +
      '<div style="height:calc(100vh - 340px);min-height:340px;max-height:560px;overflow-y:auto;padding:12px 18px;">' +
        (out || '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
          'text-align:center;font-size:13px;color:#5b6880;">No matches in this band.</div>') +
      '</div></div>';
  }

  /**
   * The note carries the two things this modal cannot show and must not hide: the
   * bands that fell under the minimum, and the matches no band could rate.
   */
  function renderSpeedNote(bands, total) {
    var thin = bands.filter(function (b) {
      var n = b.won + b.lost;
      return n > 0 && (gateFor(n) === GATE.THIN);
    });
    var parts = [];
    thin.forEach(function (b) {
      var n = b.won + b.lost;
      parts.push(b.band.label + ' courts have ' + n + ' match' + (n === 1 ? '' : 'es') + ' on record, ' +
        'short of the five-match minimum ' + ENDASH + ' the band reads as a dash and does not open.');
    });
    if (bands.unbanded) {
      parts.push(bands.unbanded + ' of ' + total + ' priced matches sit at a venue with no Tennis Abstract ' +
        'rating, or in an era before the venue&#39;s current surface, and are not banded.');
    }
    parts.push('Bands are ' + SPEED_BASIS + '. Units are the listed rows only.');
    return '<div style="font-size:12px;color:#4b5672;margin-top:14px;line-height:1.6;">' +
      parts.join(' ') + '</div>';
  }

  /** "2024-01-05" -> "05.01." — the design's row date format. */
  function shortDate(d) {
    var s = String(d || '');
    return s.length >= 10 ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' : DASH;
  }
  /** Archive round labels are draw-relative prose; the design's column is 38px wide. */
  var ROUND_SHORT = {
    '1st Round': 'R1', '2nd Round': 'R2', '3rd Round': 'R3', '4th Round': 'R4',
    'Quarterfinals': 'QF', 'Semifinals': 'SF', 'The Final': 'F', 'Round Robin': 'RR'
  };
  function shortRound(r) { return ROUND_SHORT[r] || (r == null ? DASH : String(r)); }

  function renderModal(p, ctx) {
    var k = state.modal;
    if (!k) return '';
    var body;
    if (k === 'career') body = renderCareerModal(p, ctx);
    else if (k === 'tourn') body = renderTournModal(p);
    else if (k === 'season') body = renderSeasonModal(p);
    else if (k === 'splits') body = renderSplitsModal(p);
    else if (k === 'market') body = renderMarketModal(p);
    else if (k === 'speed') body = renderSpeedModal(p);
    else {
      // Not yet built. The modal opens and says so — a box that silently does
      // nothing reads as a broken page.
      body = '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">Not built yet.</div>';
    }
    return modalShell(k, p, ctx, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUNT
  // ═══════════════════════════════════════════════════════════════════════════
  var state = {
    key: null, ledgerOpen: false, surfaces: [], priceFilters: [], modal: null,
    careerScope: 'career', splitScope: 'career', marketRole: 'all',
    tournQuery: '', tournOpen: null,
    // §5.4 Calendar record. calSurface 'all' is the default segment; calCell is
    // "YYYY-m" (month index, not 1-based) and calRun is an index into calRuns().
    calTab: 'calendar', calSurface: 'all', calCell: null, calRun: null,
    // §5.5 Court speed. speedBand null means "let the modal pick the best openable
    // band" rather than defaulting to a band the player may have never played.
    speedSurf: 'all', speedBand: null
  };

  function build(p) {
    var rows = ledgerMatches(p);
    var ctx = {
      rows: rows,
      filtered: applyFilters(rows),
      archetype: archetypeFor(p.key),
      ledgerOpen: state.ledgerOpen,
      nextMatch: null
    };
    ctx.boxVals = buildBoxVals(p, ctx);

    return '' +
      '<div class="pp2-main" style="display:flex;flex-direction:column;gap:22px;max-width:1440px;">' +
        renderBackLink() +
        renderHeader(p, ctx) +
        renderRibbon(ctx) +
        renderBoxes(ctx) +
        renderInsights(p) +
      '</div>' +
      renderModal(p, ctx);
  }

  function applyFilters(rows) {
    var surf = state.surfaces;
    if (!surf.length) return rows;
    return rows.filter(function (m) {
      return surf.indexOf(String(m.surface || '').toLowerCase()) >= 0;
    });
  }

  window.PlayerProfileV2 = {
    render: build,
    // exported so the reconciliation check and the tests can call the same
    // code path the page uses, rather than a copy that can drift
    _internals: {
      normaliseEdition: normaliseEdition,
      editionScoreText: editionScoreText,
      speedBandFor: speedBandFor,
      SPEED_BANDS: SPEED_BANDS,
      SPEED_BASIS: SPEED_BASIS,
      gateFor: gateFor,
      rateText: rateText,
      recordText: recordText,
      endashRecords: endashRecords,
      headlineSize: headlineSize,
      currentRun: currentRun,
      formRate: formRate,
      ledgerMatches: ledgerMatches,
      STAT_ROWS: STAT_ROWS,
      MARKET_NOTE: MARKET_NOTE,
      spineTotal: spineTotal,
      spineBySurface: spineBySurface,
      spineFirstYear: spineFirstYear,
      gridCells: gridCells,
      careerGridCells: careerGridCells,
      carveIndoor: carveIndoor,
      indoorCoverage: indoorCoverage,
      // §5.4 Calendar record (ruling cal-0). `state` is exported so the tests can
      // drive the Streaks tab and the surface segments through the SAME state the
      // page mutates — otherwise those branches are unreachable and would be
      // covered only by inspection.
      state: state,
      calRows: calRows,
      calFiltered: calFiltered,
      calGrid: calGrid,
      calMonths: calMonths,
      calRuns: calRuns,
      calScope: calScope,
      calScopeText: calScopeText,
      expectedLongest: expectedLongest,
      expectedRuns5: expectedRuns5,
      renderSeasonModal: renderSeasonModal,
      spineYears: spineYears,
      pickByLargestGap: pickByLargestGap,
      splitCandidates: splitCandidates,
      biggestSplit: biggestSplit,
      biggestBand: biggestBand,
      buildBoxVals: buildBoxVals,
      renderCareerModal: renderCareerModal,
      renderTournModal: renderTournModal,
      renderSplitsModal: renderSplitsModal,
      renderMarketModal: renderMarketModal,
      // §5.5 Court speed
      renderSpeedModal: renderSpeedModal,
      speedRows: speedRows,
      speedBands: speedBands,
      speedSelected: speedSelected,
      speedSurfaceMatch: speedSurfaceMatch,
      SPEED_SURFACES: SPEED_SURFACES,
      shortDate: shortDate,
      shortRound: shortRound,
      SPLIT_GROUPS: SPLIT_GROUPS,
      state: state
    }
  };
})();
