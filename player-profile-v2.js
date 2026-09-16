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

    // 1 · Career record — summed from careerByYear so it reconciles with the
    // Calendar box and the Career modal by construction (§4).
    var cw = 0, cl = 0;
    (p.careerByYear || []).forEach(function (y) {
      if (y && y.total) { cw += y.total.won || 0; cl += y.total.lost || 0; }
    });
    v.career = cw + cl
      ? { headline: recordText(cw, cl), support: rateText(cw, cl) + ' ' + MIDDOT + ' all surfaces' }
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

    // 6 · Splits — "best split" has NO definition in the export (a hard-coded
    // string) and the founder did not supply one. Left as a dash rather than
    // invented; the modal behind it is unaffected.
    v.splits = { headline: null, support: 'best split not defined' };

    // 7 · Market edge — ruling B needs a Pinnacle-with-archive-Bet365 rebuild;
    // the existing odds-performance shard is an AVERAGE ACROSS BOOKS and cannot
    // answer it. Dashed with the reason until that build lands.
    v.market = { headline: null, support: 'awaiting per-row book provenance' };

    // 8 · Playing profile — RULING 2: season win rate, knowingly the same
    // number as the header SEASON cell and the Calendar box.
    v.profile = (sw + sl)
      ? { headline: rateText(sw, sl), support: 'win rate this season ' + MIDDOT + ' all surfaces' }
      : { headline: null, support: 'no matches this season' };

    return v;
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
  // MOUNT
  // ═══════════════════════════════════════════════════════════════════════════
  var state = { key: null, ledgerOpen: false, surfaces: [], priceFilters: [], modal: null };

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
      '</div>';
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
      MARKET_NOTE: MARKET_NOTE
    }
  };
})();
