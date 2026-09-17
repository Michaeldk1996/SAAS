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
  var EMDASH = '—';  // the same glyph used as PUNCTUATION, not as a missing value
  var DASH_COLOUR = '#4b5672';

  // §5.2A row set and ORDER, from `Player Stat Boxes.dc.html`:1650 — Hard,
  // Grass, Clay, Indoors. README §5.2A gives a different order ("Hard, Clay,
  // Grass, Indoors"); the file wins per README §Fidelity. The ids are the keys
  // gridCells()/careerGridCells() return, so a row and its season-table column
  // are the same number by construction rather than by agreement.
  var CAREER_ROWS = [
    { id: 'hard', label: 'Hard' },
    { id: 'grass', label: 'Grass' },
    { id: 'clay', label: 'Clay' },
    { id: 'indoors', label: 'Indoors' }
  ];

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
  // Correction-pass item 3. The export is NOT whole-number throughout: it calls
  // .toFixed(0) on exactly two values — `ribbonPct` (Player Profile.dc.html:1835)
  // and `formPct` (:1827, the ledger header) — and .toFixed(1) in ~40 other
  // places. A global change would be wrong, so this is a second formatter used by
  // those two call sites only, sharing rateText's sample gate.
  function rateText0(won, lost) {
    var n = (won || 0) + (lost || 0);
    var g = gateFor(n);
    if (g === GATE.NONE || g === GATE.THIN) return DASH;
    return (100 * won / n).toFixed(0) + '%';
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
  function bandById(id) {
    for (var i = 0; i < SPEED_BANDS.length; i++) if (SPEED_BANDS[i].id === id) return SPEED_BANDS[i];
    return null;
  }

  // ─── RULING · grass is always Very fast (founder, 2026-09-16) ───────────────
  // Grass courts are classified Very fast REGARDLESS of their Tennis Abstract
  // rating. The quintile cut-offs above still govern every other venue. This is
  // deliberately unconditional: it also bands the grass rows we hold no Abstract
  // reading for, which previously fell into the `unbanded` shortfall.
  // Case-insensitive on purpose. This rule used to read only market-edge rows,
  // whose surface is title-cased ("Grass"); §8.1 feeds it the CAREER SPINE, which
  // lower-cases its surface ("grass"). A strict === here silently stopped applying
  // the founder's ruling to every grass match on the page while every band still
  // looked plausible — the test suite's grass check is what surfaced it.
  function speedBandForRow(m) {
    if (!m) return null;
    if (String(m.surface || '').toLowerCase() === 'grass') return bandById('vfast');
    return speedBandFor(m.speed);
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
  // ─── correction-pass §0.2 · the one shared rule behind "renders larger" ─────
  //
  // The founder read the live page as visibly larger than the export at the same
  // viewport. It is not font-size, zoom, DPR or column width — all four already
  // match (html 16px, body 14px, zoom 1, transform none; the live content column
  // is 2.8% WIDER, the opposite direction). The dashboard shell sets
  // `body { line-height: 1.5 }`; the export sets none, i.e. `normal`. Measured
  // live, a 14px line box is 21px under the shell vs 18px at normal — every line
  // 16.7% taller, compounding over the header, the two-line ribbon chips and 18
  // ledger rows. A single-line ledger row measured 38px against a ~30px pitch in
  // the founder's own design screenshot.
  //
  // Founder ruling (gate 4ce54369, option lh-0): SCOPE it. `body` is shared by
  // Matches, Live, Series and H2H, so the override lands on this page's own
  // roots only and nothing else re-flows.
  var PP2_STYLE =
    '<style>.pp2-main,.pp2-main *,.pp2-scrim,.pp2-scrim *,.pp2-sheet,.pp2-sheet *' +
    // Blocks that DO want a leading (the provenance notes, the insight bodies)
    // already carry an inline line-height, and an inline declaration outranks any
    // selector — so they are unaffected and only the inherited 1.5 is undone.
    '{line-height:normal;}' +
    // §5.3 item 7 — the file gives the tournament row a hover fill
    // (`style-hover="background:rgba(255,255,255,0.02)"`, Player Stat Boxes
    // .dc.html:489). An inline style cannot express :hover, so it lands here,
    // scoped to the one class that carries it. The selected row sets its own
    // inline background, which outranks this.
    '.pp2-trow:hover{background:rgba(255,255,255,0.02);}' +
    // §5.2B — every clickable record in the Career modal's season table. The
    // design file gives these cells `cursor:{{ y.cursor }}` but NO style-hover,
    // so the hover token is the one the same file uses for its other clickable
    // data row (.dc.html:489) rather than a colour invented here.
    '.pp2-crec{transition:background .12s ease,color .12s ease;}' +
    '.pp2-crec:hover{background:rgba(255,255,255,0.02);color:#5b9bff;}' +
    // §5.4 item 14 — the heat cell's hover, verbatim from the design file's own
    // stylesheet (`Player Stat Boxes.dc.html`:24-26). A win cell goes to green
    // 0.42 with an inset ring, a loss cell to red, a level cell to white 0.14.
    // These need !important for the same reason the file uses it: the cell
    // carries its own inline background and an inline declaration outranks a
    // selector. The empty-month cell has no class and therefore no hover.
    '.calw:hover{background:rgba(61,214,140,0.42)!important;color:#fff!important;' +
    'box-shadow:inset 0 0 0 1px rgba(61,214,140,0.75)!important;}' +
    '.call:hover{background:rgba(224,97,111,0.42)!important;color:#fff!important;' +
    'box-shadow:inset 0 0 0 1px rgba(224,97,111,0.75)!important;}' +
    '.caln:hover{background:rgba(255,255,255,0.14)!important;color:#fff!important;' +
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,0.22)!important;}' +
    // §5.4 Streaks item 8 — the run timeline scrolls sideways at a FIXED bar
    // pitch, so it needs the export's own scrollbar (Player Profile.dc.html:30:
    // 9px, thumb rgba(255,255,255,0.13) radius 5, transparent track). The page
    // has no global rule for it, so it lands here scoped to the one container.
    '.pp2-xscroll::-webkit-scrollbar{width:9px;height:9px;}' +
    '.pp2-xscroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.13);border-radius:5px;}' +
    '.pp2-xscroll::-webkit-scrollbar-track{background:transparent;}</style>';

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
  // window.playerProfiles is the WHOLE file ({meta, players}), not the players
  // map — the host page bridges it in that shape and archetypeFor() already
  // read it that way. This accessor used to index the file directly, so it
  // returned undefined for every key; it was dead code, which is the only
  // reason that never showed. One shape, one accessor.
  function playersMap() {
    var store = window.playerProfiles;
    return (store && store.players) || {};
  }
  function profileFor(key) {
    return playersMap()[String(key)] || null;
  }

  // §8 match sheet / match panel / full-screen match page are NOT built yet.
  // The export makes ribbon chips, court-speed rows and style-detail rows open
  // a match sheet; until that exists those elements must not advertise a click.
  // This repo's rule is that an affordance promises content (see the Recent-form
  // chevron gate), so the hook and the pointer cursor are emitted only when the
  // sheet exists. Flip this constant when §8 lands — nothing else changes.
  var MATCH_SHEET_BUILT = true;
  function sheetHook(id) {
    return MATCH_SHEET_BUILT ? 'data-pp2="sheet" data-v="' + esc(id) + '" ' : '';
  }
  function sheetCursor() { return MATCH_SHEET_BUILT ? 'cursor:pointer;' : ''; }
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
  // ─── correction-pass items 4 + 8 · NAME FORMS ──────────────────────────────
  // The export writes the subject as a bare surname ("Martinez") and everyone
  // else surname-first ("Shelton B."). Our feed names arrive as "B. Shelton".
  //
  // This is a re-ORDER of the two parts the feed already separates at the ". ",
  // NOT a token swap on the surname: api-tennis reorders multi-part surnames
  // (see the name-order scramble that breaks the Wikidata photo join), so
  // splitting "Felipe Meligeni Alves" on whitespace would mint a wrong name.
  // Everything after the "initial + full stop" prefix is carried through intact,
  // including multi-word surnames like "Van De Zandschulp".
  function surnameOf(name) {
    var n = String(name || '').trim();
    var m = /^([A-Za-z])\.\s+(.+)$/.exec(n);
    return m ? m[2] : n;
  }
  function initialOf(name) {
    var m = /^([A-Za-z])\.\s+/.exec(String(name || '').trim());
    return m ? m[1] : '';
  }
  /** "B. Shelton" -> "Shelton B."; a name with no initial prefix is unchanged. */
  function surnameFirst(name) {
    var s = surnameOf(name), i = initialOf(name);
    return i ? s + ' ' + i + '.' : s;
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
  // Correction-pass item 7. The ledger column is dd.mm (mono) in the export;
  // the header's prose subs stay "12 Sep" — the export uses both forms and they
  // are not interchangeable, so they get separate formatters.
  function fmtDotDate(iso) {
    var s = String(iso || '');
    if (s.length < 10) return DASH;
    return s.slice(8, 10) + '.' + s.slice(5, 7);
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

  // ─── correction-pass item 9 · ROUND SHORT CODES ────────────────────────────
  //
  // `window.RoundClassify` is undefined on the deployed page — round-classify.js
  // exists only at tools/points-at-risk/round-classify.js, is not in the deploy
  // allowlist and exports no `shortLabel`. So roundLabel() always fell through to
  // the raw feed tail and printed "Semi-finals" / "1/16-finals" into a 44px track
  // with white-space:normal: 16 of Zverev's 18 ledger rows wrapped to two lines,
  // which is most of the row-height defect the founder reported.
  //
  // The mapping has two halves and only the first is unambiguous:
  //   * F / SF / QF / R16 are fixed points of any draw, whatever its size.
  //   * Anything earlier is draw-RELATIVE in the export ("3R", "2R", "1R") and
  //     therefore needs the draw size, which no store we hold carries.
  //
  // So the draw size is DERIVED FROM THE DATA, and used only where it is PROVEN:
  // an edition qualifies when the roster's own rows show an unbroken chain of
  // rounds from the largest observed round down to the Final. R128→R64→R32→R16→
  // QF→SF→F at a Slam proves a 128 draw; a lone R32 row at a Challenger proves
  // nothing, and those rows keep the round-of-N code (R32/R64/R128) rather than a
  // guessed "1R" — a wrong round number is exactly what the standing rule forbids.
  // Measured on the committed roster: 11,340 of 11,340 rows map to a code, and
  // 5,069 of 5,850 pre-R16 rows (86.6%) sit at an edition with a proven draw.
  //
  // ROUND_OF_N mirrors round-classify.js's roundShort() — the module is CommonJS
  // under tools/ and cannot be required in the browser. test-pp2-reconcile.js
  // loads the real SSOT and asserts the two agree on every round string in the
  // roster, so the copy cannot drift.
  var ROUND_FRAC = { '2': 'SF', '4': 'QF', '8': 'R16', '16': 'R32', '32': 'R64', '64': 'R128', '128': 'R256' };
  var ROUND_WORD = { '16': 'R16', '32': 'R32', '64': 'R64', '128': 'R128', '256': 'R256' };
  var CODE_N = { F: 2, SF: 4, QF: 8, R16: 16, R32: 32, R64: 64, R128: 128, R256: 256 };
  function roundOfN(round) {
    if (!round) return '';
    var r = String(round);
    if (r.indexOf(' - ') >= 0) r = r.split(' - ').pop();
    r = r.trim();
    var frac = r.match(/1\/(\d+)/);
    if (frac) return ROUND_FRAC[frac[1]] || r;
    if (/semi[-\s]?final/i.test(r)) return 'SF';
    if (/quarter[-\s]?final/i.test(r)) return 'QF';
    var ro = r.match(/round of (\d+)/i);
    if (ro) return ROUND_WORD[ro[1]] || ('R' + ro[1]);
    if (/final/i.test(r)) return 'F';
    return r;
  }
  // Qualifying is its own ladder and never draw-relative. recentForm carries no
  // qualifying row today (censused: 0 of 11,340), so this is the guard that keeps
  // one from being numbered as a main-draw round if the feed ever emits one.
  function qualifyingCode(round) {
    var s = String(round || '');
    if (!/qualif/i.test(s)) return null;
    var n = s.match(/(\d)\s*(?:st|nd|rd|th)?\s*(?:round)?\s*$/i);
    return n ? 'Q' + n[1] : 'Q';
  }

  // Proven draw size per "tournament|year", derived across the WHOLE roster —
  // one player only ever sees his own rounds, so the evidence has to be pooled.
  // Rebuilt when the store identity changes (the lazy loaders reassign it).
  var _drawIdx = null, _drawIdxSrc = null;
  function drawIndex() {
    var store = window.playerProfiles;
    if (_drawIdx && _drawIdxSrc === store) return _drawIdx;
    var seen = {};
    var players = playersMap();
    for (var k in players) {
      if (!Object.prototype.hasOwnProperty.call(players, k)) continue;
      var ms = (players[k] && players[k].recentForm && players[k].recentForm.matches) || [];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!m || !m.date || !m.tournament) continue;
        if (qualifyingCode(m.round)) continue;
        var code = roundOfN(m.round);
        if (!CODE_N[code]) continue;
        var ek = m.tournament + '|' + String(m.date).slice(0, 4);
        (seen[ek] = seen[ek] || {})[code] = true;
      }
    }
    var out = {};
    for (var ev in seen) {
      if (!Object.prototype.hasOwnProperty.call(seen, ev)) continue;
      out[ev] = provenDraw(seen[ev]);
    }
    _drawIdx = out; _drawIdxSrc = store;
    return out;
  }
  // A draw size is proven only by an UNBROKEN chain down to the Final. Any hole
  // (or a missing Final) leaves it 0 and the row keeps its round-of-N code.
  function provenDraw(set) {
    if (!set.F) return 0;
    var max = 0;
    for (var c in set) { if (CODE_N[c] > max) max = CODE_N[c]; }
    for (var n = max; n >= 2; n /= 2) {
      var code = n === 2 ? 'F' : n === 4 ? 'SF' : n === 8 ? 'QF' : 'R' + n;
      if (!set[code]) return 0;
    }
    return max;
  }
  // §8.16 (founder, 2026-09-17) — DRAW-SIZE codes, everywhere.
  //
  // This used to convert a proven draw back into a draw-RELATIVE ordinal: at a
  // 128 draw, R32 was printed "3R", R64 "2R", R128 "1R". The comment justified it
  // as the export's own convention, and that reading was wrong — `Player Stat
  // Boxes.dc.html` writes "R32" and "R64" verbatim in its Court speed rows, never
  // an nR form. Measured on the rendered page: Roland Garros 2026 printed
  // F · SF · QF · R16 · 3R · 2R · 1R.
  //
  // The round-of-N code is now returned directly, which makes the draw index
  // unnecessary here. It is deliberately a change to the SHARED labeller rather
  // than a Court-speed-local one: the founder's rule is that the ledger, the
  // tournament modal, the calendar and this list all agree, and four surfaces
  // agreeing is only guaranteed by one implementation.
  function roundLabel(m) {
    var q = qualifyingCode(m && m.round);
    if (q) return q;
    return roundOfN(m && m.round) || DASH;
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
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l-5 5 5 5"/></svg>' +
      'Back to Players</a>';
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
      return '<div class="pp2-chip" ' + sheetHook(m.date + '|' + (m.opponent || '')) +
        'style="display:flex;gap:8px;padding:7px 10px;border:1px solid rgba(255,255,255,0.08);' +
        'border-radius:8px;white-space:nowrap;flex:none;' + sheetCursor() + 'align-items:center;">' +
        '<div style="width:20px;height:20px;border-radius:5px;display:flex;align-items:center;' +
          'justify-content:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
          'background:' + (w ? 'rgba(61,214,140,0.16)' : 'rgba(224,97,111,0.16)') + ';' +
          'color:' + (w ? '#3dd68c' : '#e0616f') + ';">' + (w ? 'W' : 'L') + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:2px;">' +
          // Correction-pass item 4a: surname-first, as the export writes every
          // name that is not the subject.
          '<div style="font-size:12px;font-weight:700;">' +
            esc(m.opponent ? surnameFirst(m.opponent) : DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#5b6880;">' +
            esc(eventName(m) + ' ' + roundLabel(m)) + ' ' + MIDDOT + ' ' +
            // Correction-pass item 4b: the export's chip meta is the SET SCORES
            // (space-joined — Player Profile.dc.html:1838 replaces its own ", "),
            // not recentForm's "3 - 1" sets COUNT, which is what we were printing.
            // Feed SCORE strings keep their hyphens — the design file renders
            // '7-5' that way and that is the tennis convention. The en-dash rule
            // in §3 governs W-L RECORDS, not scorelines. Tagged so the typography
            // check can tell the two apart.
            '<span class="pp2-score">' + esc(setScoreText(m, ' ')) + '</span></div>' +
        '</div></div>';
    }).join('');

    return '' +
      '<div style="background:#0a0d14;border:1px solid rgba(255,255,255,0.09);border-radius:12px;' +
      'padding:16px 22px;display:grid;grid-template-columns:auto minmax(180px,1.2fr) auto minmax(0,2fr) auto;' +
      'gap:22px;align-items:center;">' +
        '<div style="white-space:nowrap;">' + eyebrow('Recent form') +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:22px;font-weight:700;line-height:1;">' +
            '<span style="color:#5b9bff;">' + (r.n ? rateText0(r.won, r.lost) : DASH) + '</span> ' +
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

  // Correction-pass items 12 + 15. This helper paints every eyebrow on the page
  // and had drifted three ways from the export's `.cap` class
  // (Player Profile.dc.html:25) — 10.5px vs 9.5px, 0.14em vs 0.16em, #4b5672 vs
  // #5b6880. One edit, page-wide reach.
  function eyebrow(text) {
    return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
      'letter-spacing:0.16em;text-transform:uppercase;color:#5b6880;margin-top:6px;">' + text + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §4 FULL LEDGER (toggled from the ribbon)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Rows are recentForm.matches — the ONLY per-match source that carries a date
  // and is already subject-relative. It is a rolling window, not a career: the
  // card is titled "Recent form" for that reason and the subtitle prints the
  // real row count, never a career total.
  //
  // H / A COLUMNS. recentForm carries no price, so the two odds columns are
  // joined from the player's market-edge shard BY DATE. Founder ruling 1 fixes
  // the orientation product-wide: H is the SUBJECT, A is the opponent — so H is
  // the shard's `price` and A its `oppPrice`, with no positional guessing.
  //
  // The join is deliberately strict. A date with anything other than exactly one
  // priced row is left as a dash: the shard has no opponent key, so a day on
  // which two rows exist cannot be resolved to this match, and the archive is
  // tour main-draw only, so most Challenger rows have no priced partner at all.
  // A dash here means "not priced", and §3 forbids inventing one.
  var LEDGER_CAP = 18;
  function ledgerPriceIndex(key) {
    var mk = marketFor(key);
    var rows = (mk && mk.matches) || [];
    var byDate = {};
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].date;
      if (!d) continue;
      if (byDate[d] === undefined) byDate[d] = rows[i];
      else byDate[d] = null;   // ambiguous day — never guess which match it was
    }
    return byDate;
  }
  // ─── correction-pass item 11 · the second price source ─────────────────────
  //
  // The founder read the ledger as "dashes on every row". Measured, it was 7
  // priced / 11 dashed for Zverev, and the split is a clean date cut: everything
  // to 12 Jul priced, everything from 5 Aug dashed. That is the Tennis-Data
  // archive ending — build-market-edge.js records archiveLatest 2026-07-26. His
  // screenshot showed the top of the ledger, which is entirely post-cutoff.
  //
  // So the fix is a SOURCE, not a join. `bet365-history/YYYY-MM.json` is our own
  // capture: a reduced per-fixture bet365 match-winner series whose last point is
  // pinned to the last quote at or before the fixture start — never in-play.
  // Index: 10,662 fixtures, 2026-03 → 2026-09, 81.2% coverage.
  //
  // ⚠️ This is a bet365 PRE-MATCH last price, not a Pinnacle close. §5 forbids
  // blending the two in the Market edge headline and nothing here touches that
  // modal — the ledger labels its rows per book and the card note names both
  // sources with their counts, which is the same posture build-market-edge.js
  // already takes for its per-row Pinnacle / archive-Bet365 choice.
  //
  // The join is stricter than the archive's: the archive shard carries no
  // opponent key, so it can only match on date and a duplicated date dashes. The
  // capture carries BOTH names ("Zverev, Alexander"), so it matches on the
  // surname PAIR plus the date, and the date is allowed ±1 day because `start`
  // is a UTC timestamp while recentForm's date is the tournament's local day.
  function b365Norm(name) {
    var s = String(name || '');
    var c = s.indexOf(',');
    if (c >= 0) s = s.slice(0, c);            // capture form: "Surname, First"
    else s = surnameOf(s);                     // feed form: "A. Zverev"
    return s.toLowerCase().replace(/[^a-z]/g, '');
  }
  function b365Close(series) {
    if (!series || !series.length) return null;
    var last = series[series.length - 1];
    var v = last && last[1];
    return v == null || !isFinite(Number(v)) ? null : Number(v);
  }
  function b365DayOf(epochSeconds) {
    var d = new Date(Number(epochSeconds) * 1000);
    if (!isFinite(d.getTime())) return null;
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') +
      '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  var _b365Idx = null, _b365Src = null;
  function b365Index() {
    var store = window.bet365History;
    if (_b365Idx && _b365Src === store) return _b365Idx;
    var out = {};
    for (var month in (store || {})) {
      if (!Object.prototype.hasOwnProperty.call(store, month)) continue;
      var fx = (store[month] && store[month].fixtures) || {};
      for (var id in fx) {
        if (!Object.prototype.hasOwnProperty.call(fx, id)) continue;
        var f = fx[id];
        var a = b365Norm(f.p1), b = b365Norm(f.p2);
        if (!a || !b) continue;
        var day = b365DayOf(f.start);
        if (!day) continue;
        var pair = a < b ? a + '|' + b : b + '|' + a;
        (out[pair] = out[pair] || []).push({
          day: day, a: a, b: b, closeA: b365Close(f.s1), closeB: b365Close(f.s2)
        });
      }
    }
    _b365Idx = out; _b365Src = store;
    return out;
  }
  function b365PriceFor(subjName, m) {
    var s = b365Norm(subjName), o = b365Norm(m && m.opponent);
    if (!s || !o || !m || !m.date) return null;
    var list = b365Index()[s < o ? s + '|' + o : o + '|' + s];
    if (!list) return null;
    var hits = list.filter(function (r) { return dayGap(r.day, m.date) <= 1; });
    // Two capture fixtures for one surname pair within two days cannot be told
    // apart — dash rather than pick one.
    if (hits.length !== 1) return null;
    var h = hits[0];
    var mine = h.a === s ? h.closeA : h.closeB;
    var theirs = h.a === s ? h.closeB : h.closeA;
    if (mine == null && theirs == null) return null;
    return { price: mine, oppPrice: theirs, book: 'bet365' };
  }
  function dayGap(a, b) {
    var x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z');
    if (!isFinite(x) || !isFinite(y)) return Infinity;
    return Math.abs(x - y) / 86400000;
  }

  // Attaches price/role to each ledger row. Rows neither source priced keep
  // price null, which both the odds columns and the price filters read as "not
  // held" rather than as a role.
  function ledgerRows(p) {
    var idx = ledgerPriceIndex(p.key);
    return ledgerMatches(p).map(function (m) {
      var mk = idx[m.date] || null;
      if (mk && mk.price != null) {
        return {
          m: m,
          price: mk.price,
          oppPrice: mk.oppPrice != null ? mk.oppPrice : null,
          role: mk.role || null,
          book: mk.book || null,
          basis: 'close'
        };
      }
      // Archive silent (or ambiguous on that date) — fall back to the capture.
      var cap = b365PriceFor(p.name, m);
      if (cap) {
        return {
          m: m, price: cap.price, oppPrice: cap.oppPrice,
          // The capture carries no favourite/underdog role of its own; derive it
          // only when both sides are held, never from one price alone.
          role: (cap.price != null && cap.oppPrice != null)
            ? (cap.price < cap.oppPrice ? 'fav' : cap.price > cap.oppPrice ? 'dog' : 'level')
            : null,
          book: 'bet365', basis: 'prematch'
        };
      }
      return { m: m, price: null, oppPrice: null, role: null, book: null, basis: null };
    });
  }

  var LEDGER_SURFACES = [
    { id: 'all', label: 'All' },
    { id: 'grass', label: 'Grass' },
    { id: 'hard', label: 'Hard' },
    { id: 'clay', label: 'Clay' }
  ];
  var LEDGER_PRICES = [
    { id: 'fav', label: 'Favourite' },
    { id: 'dog', label: 'Underdog' }
  ];

  // Correction-pass item 6. The export is a SEGMENTED control: the selected chip
  // carries the fill and the border, the rest carry neither — `bd: on ?
  // 'rgba(91,155,255,0.45)' : 'transparent'` (Player Profile.dc.html:1553). We
  // were drawing rgba(255,255,255,0.12) on every chip, which reads as four
  // buttons rather than one control. The transparent border is kept (not
  // dropped) so the selected and unselected chips stay the same size.
  function ledgerChip(attr, id, label, on) {
    return '<span data-pp2="' + attr + '" data-v="' + esc(id) + '" ' +
      'style="font-size:12px;padding:7px 13px;border-radius:8px;cursor:pointer;white-space:nowrap;' +
      'font-weight:' + (on ? '700' : '600') + ';color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
      'background:' + (on ? 'rgba(91,155,255,0.22)' : 'transparent') + ';' +
      'border:1px solid ' + (on ? 'rgba(91,155,255,0.45)' : 'transparent') + ';">' +
      esc(label) + '</span>';
  }
  function ledgerPriceChip(id, label, on) {
    return '<span data-pp2="ledger-price" data-v="' + esc(id) + '" ' +
      'style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;' +
      'padding:5px 10px;border-radius:8px;cursor:pointer;' +
      'color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
      'background:' + (on ? 'rgba(91,155,255,0.18)' : 'transparent') + ';' +
      'border:1px solid ' + (on ? 'rgba(91,155,255,0.45)' : 'rgba(255,255,255,0.12)') + ';">' +
      '<span style="width:11px;height:11px;border-radius:3px;flex:none;' +
        (on ? 'background:#5b9bff;' : 'border:1px solid rgba(255,255,255,0.22);') + '"></span>' +
      esc(label) + '</span>';
  }

  // Ledger rows carry their own price, so the price filter is applied here
  // rather than in applyFilters() — which keys only on surface and is shared
  // with callers that have no shard loaded.
  function ledgerFiltered(rows) {
    var surf = state.surfaces;
    var prices = state.priceFilters;
    return rows.filter(function (r) {
      if (surf.length && surf.indexOf(String(r.m.surface || '').toLowerCase()) < 0) return false;
      if (prices.length && (!r.role || prices.indexOf(r.role) < 0)) return false;
      return true;
    });
  }

  function oddsText(v) {
    return v == null ? DASH : Number(v).toFixed(2);
  }

  function renderLedger(p, ctx) {
    if (!ctx.ledgerOpen) return '';
    var all = ctx.ledgerRows;
    var rows = ctx.ledgerFiltered;
    // §4 reconciliation: "Recent-form ribbon W-L and % = the strip shown = the
    // ledger's last-N rows." The ribbon rates its last 18; this card must rate
    // the SAME 18, not the whole filtered set. Rating all of them printed
    // "75.0% win · 20 matches" over an 18-square strip — two different figures
    // for one claim, on the same screen.
    var stripRows = rows.slice(-LEDGER_CAP);
    var r = formRate(stripRows.map(function (x) { return x.m; }));
    var surfOn = state.surfaces;
    var chips = LEDGER_SURFACES.map(function (s) {
      var on = s.id === 'all' ? !surfOn.length : surfOn.indexOf(s.id) >= 0;
      return ledgerChip('ledger-surf', s.id, s.label, on);
    }).join('');
    var priceChips = LEDGER_PRICES.map(function (x) {
      return ledgerPriceChip(x.id, x.label, state.priceFilters.indexOf(x.id) >= 0);
    }).join('');

    // Strip is the same slice the rate above was taken over (README §3), so the
    // two cannot disagree.
    var strip = stripRows.map(function (x) {
      var w = !!x.m.won;
      return '<div style="flex:1;height:26px;border-radius:5px;display:flex;align-items:center;' +
        'justify-content:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
        'background:' + (w ? 'rgba(61,214,140,0.22)' : 'rgba(224,97,111,0.22)') + ';' +
        'color:' + (w ? '#3dd68c' : '#e0616f') + ';">' + (w ? 'W' : 'L') + '</div>';
    }).join('');

    var head = '' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;' +
        'flex-wrap:wrap;margin-bottom:14px;">' +
        '<div style="font-size:20px;font-weight:800;letter-spacing:-0.015em;">Recent form</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#5b6880;">' +
          '<span style="color:#5b9bff;font-weight:700;">' + rateText0(r.won, r.lost) + ' win</span> ' +
          MIDDOT + ' ' + r.n + ' match' + (r.n === 1 ? '' : 'es') + '</div>' +
      '</div>';

    var legend = '' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
        '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#4b5672;">' +
          '<span style="width:10px;height:10px;border-radius:3px;background:rgba(61,214,140,0.22);"></span>Win</span>' +
        '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#4b5672;">' +
          '<span style="width:10px;height:10px;border-radius:3px;background:rgba(224,97,111,0.22);"></span>Loss</span>' +
        '<span style="width:1px;height:14px;background:rgba(255,255,255,0.12);"></span>' +
        priceChips +
      '</div>';

    var body;
    if (!rows.length) {
      body = '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">No matches with these filters.</div>';
    } else {
      // Newest first, grouped by event. A group header repeats only when the
      // event changes, so a player who played one event twice in the window
      // gets two headers — which is what the export shows.
      var ordered = rows.slice().reverse();
      var shown = state.ledgerExpanded ? ordered : ordered.slice(0, LEDGER_CAP);
      var lastEvent = null;
      var out = '';
      shown.forEach(function (x) {
        var ev = eventName(x.m);
        if (ev !== lastEvent) {
          lastEvent = ev;
          out += '<div style="display:grid;grid-template-columns:52px minmax(150px,1fr) 44px ' +
            'minmax(160px,0.9fr) 48px 48px;gap:10px;background:rgba(91,155,255,0.12);border-radius:7px;' +
            'padding:7px 8px;margin-top:12px;align-items:center;">' +
            '<div style="grid-column:1/3;display:flex;align-items:center;gap:8px;">' +
              '<span style="width:7px;height:7px;border-radius:2px;flex:none;background:' +
                surfColour(x.m.surface) + ';"></span>' +
              '<span style="font-size:12.5px;font-weight:800;">' + esc(ev) + '</span>' +
            '</div>' +
            ledgerEyebrow('Rd', 'left') + ledgerEyebrow('Result', 'left') +
            ledgerEyebrow('H', 'right') + ledgerEyebrow('A', 'right') +
          '</div>';
        }
        out += ledgerRowHtml(x);
      });
      var capped = !state.ledgerExpanded && ordered.length > LEDGER_CAP;
      body = '<div style="' + (capped ? 'max-height:560px;overflow-y:auto;' : '') + '">' + out + '</div>';
      if (ordered.length > LEDGER_CAP) {
        body += '<div style="display:flex;justify-content:center;margin-top:14px;">' +
          '<span data-pp2="ledger-more" style="font-size:13px;font-weight:700;color:#5b9bff;' +
            'padding:10px 18px;border:1px solid rgba(91,155,255,0.35);border-radius:11px;cursor:pointer;">' +
            (state.ledgerExpanded ? 'Show less' : 'See all ' + ordered.length + ' results') + '</span>' +
        '</div>';
      }
    }

    // Provenance for the two odds columns: how many of the shown rows the
    // archive actually priced. A column of dashes with no explanation reads as
    // a broken join, which is exactly the failure mode this page keeps hitting.
    var priced = rows.filter(function (x) { return x.price != null; }).length;
    var closes = rows.filter(function (x) { return x.basis === 'close'; }).length;
    var pre = rows.filter(function (x) { return x.basis === 'prematch'; }).length;
    // Two sources, never pooled into one claim: the archive close and our own
    // bet365 pre-match capture are different artefacts and the note says which
    // supplied how many, with the reason the rest are dashes.
    var note = 'H / A are subject first ' + MIDDOT + ' ' + priced + ' of ' + rows.length +
      ' rows priced' + (priced ? ' (' + closes + ' archive closing, ' + pre +
      ' bet365 pre-match)' : '') + '.';
    if (priced < rows.length) {
      note += ' The odds archive is tour main-draw only, ends 2026-07-26 and carries no opponent ' +
        'key, so a date it never priced — or priced twice — falls through to the bet365 capture, ' +
        'which starts 2026-03. A row neither source holds is left as a dash rather than guessed.';
    }

    return '' +
      '<div class="pp2-ledger" style="background:#0a0d14;border:1px solid rgba(255,255,255,0.09);' +
        'border-radius:12px;padding:22px 24px;display:flex;flex-direction:column;">' +
        head +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">' + chips + '</div>' +
        (rows.length ? '<div style="display:flex;gap:4px;">' + strip + '</div>' : '') +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;' +
          'flex-wrap:wrap;margin-top:6px;">' +
          eyebrow('oldest ' + '→' + ' most recent') + legend +
        '</div>' +
        body +
        '<div style="font-size:11px;color:#4b5361;line-height:1.55;margin-top:13px;">' +
          esc(note) + ' Window: ' + all.length + ' match' + (all.length === 1 ? '' : 'es') +
          ' on record in this player’s recent-form feed.</div>' +
      '</div>';
  }

  // The export's group-header labels are `.cap` with two overrides (8.5px,
  // #8b96b5) — the tracking stays 0.16em, where this had drifted to 0.1em.
  function ledgerEyebrow(text, align) {
    return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:8.5px;font-weight:600;' +
      'letter-spacing:0.16em;text-transform:uppercase;color:#8b96b5;text-align:' + align + ';">' +
      esc(text) + '</div>';
  }

  function ledgerRowHtml(x) {
    var m = x.m;
    // ── the bold-name bug (founder, 2026-09-16) ───────────────────────────────
    // Emphasis was keyed on who WON, so a loss bolded the opponent: his Cincinnati
    // 19.08 row read "Zverev – Paul T." with Paul T. bold on Zverev's own page.
    // The subject of the page is always the bold name, whatever the result and
    // whatever position he is listed in. The result already has three other
    // carriers on this row (the W/L dot, the sets colour, the score), so nothing
    // is lost by taking it off the typography.
    var sub = 'font-size:13px;font-weight:700;color:#e7e9ee;';
    var opp = 'font-size:13px;font-weight:400;color:#8b96b5;';
    // Correction-pass item 13: the export aligns the row's cells on `center`
    // (this read `baseline`) and sets the OUTER name span to 13px, which the
    // two inner spans then inherit — this inherited the card's 14px.
    return '<div class="pp2-ledger-row" ' + sheetHook(m.date + '|' + (m.opponent || '')) +
      'style="display:grid;grid-template-columns:52px minmax(150px,1fr) 44px minmax(160px,0.9fr) ' +
      '48px 48px;gap:10px;padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);' +
      'border-radius:6px;align-items:center;' + sheetCursor() + '">' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;">' +
        esc(fmtDotDate(m.date)) + '</span>' +
      '<span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
        // Item 8: the subject is a bare surname, the opponent surname-first.
        '<span style="' + sub + '">' + esc(surnameOf(x.subjectName || '') || 'Subject') + '</span>' +
        '<span style="font-size:13px;color:#3f4860;"> ' + ENDASH + ' </span>' +
        '<span style="' + opp + '">' +
          esc(m.opponent ? surnameFirst(m.opponent) : DASH) + '</span></span>' +
      // Item 9: nowrap as well as the short code — a code alone would still wrap
      // if a future feed string failed to map, and a wrapped row is the defect.
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;' +
        'white-space:nowrap;">' + esc(roundLabel(m)) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8b96b5;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          esc(scoreWithStatus(m, setScoreText(m))) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;' +
        'text-align:right;color:#e7e9ee;">' + oddsText(x.price) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;' +
        'text-align:right;color:#5b6880;">' + oddsText(x.oppPrice) + '</span>' +
    '</div>';
  }

  // Per-set scores, already subject-relative in recentForm (`p` = the subject's
  // games). Hyphens are correct here — §3's en-dash rule governs W-L records,
  // not scorelines, and the design file renders '7-5' that way.
  //
  // Correction-pass item 10, two parts:
  //  * separator — the export joins with ", " ("6-3, 7-6(2), 5-7, 6-2"), we
  //    joined with a bare space.
  //  * tiebreak points — a previous pass reported these as "not held at all".
  //    That was wrong: recentForm's set objects carry `pTb`/`oTb` on 4,439 of
  //    27,451 sets in the committed roster, against 4,591 sets that finished
  //    7-6 or 6-7 — so 96.7% of tiebreak sets have their points and the other
  //    3.3% print "7-6" with no bracket, never an invented margin.
  // The bracket shows the LOSER's points, which is the convention the export's
  // own strings follow ("7-6(2)" = the 7-6 set won on a 7-2 breaker).
  /**
   * §item 27 display · the match-status suffix (founder, approved 2026-09-17):
   * "ret." after the score on a retirement, "w/o" on a walkover.
   *
   * Two stores, two field names, one helper. Ledger rows come from recentForm and
   * carry `walkover`; career-spine rows (drills, Court speed, the match sheet)
   * carry `wo`, which calSpine() derives from recentForm's flag OR from a result
   * string with no digit in it. Reading only one of the two names would tag the
   * suffix on two surfaces and silently skip the other, which is exactly how the
   * ledger and the drill came to disagree about set counts before.
   *
   * DISPLAY ONLY. Run counting is untouched — calRuns() still applies the
   * founder's walkover ruling (received = a win and stays in the sequence, given =
   * neither and is stepped over), and this helper is not on that path.
   *
   * A walkover has no score to suffix — nothing was played — so it REPLACES the
   * score rather than trailing it. Printing "— w/o" would read as a missing
   * scoreline next to a status; "w/o" is the whole fact.
   */
  function matchStatus(m) {
    if (!m) return null;
    if (m.wo || m.walkover) return 'wo';
    if (m.retired) return 'ret';
    return null;
  }
  function scoreWithStatus(m, text) {
    var st = matchStatus(m);
    if (st === 'wo') return 'w/o';
    var base = (text == null || text === '') ? DASH : String(text);
    if (st !== 'ret') return base;
    // A retirement with no scoreline on record is still a retirement.
    return base === DASH ? 'ret.' : base + ' ret.';
  }

  function setScoreText(m, sep) {
    var sets = m.sets || [];
    if (!sets.length) return m.result ? String(m.result) : DASH;
    return sets.map(setText).join(sep == null ? ', ' : sep);
  }
  function setText(s) {
    var base = s.p + '-' + s.o;
    if (s.pTb == null || s.oTb == null) return base;
    var lo = Math.min(Number(s.pTb), Number(s.oTb));
    if (!isFinite(lo)) return base;
    return base + '(' + lo + ')';
  }
  /** Tiebreak sets on a row that carry no points — reported, never guessed. */
  function tiebreaksMissing(m) {
    return (m.sets || []).filter(function (s) {
      var tb = (s.p === 7 && s.o === 6) || (s.p === 6 && s.o === 7);
      return tb && (s.pTb == null || s.oTb == null);
    }).length;
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

    // 4 · Court speed — FOUNDER RULING 2026-09-16: the headline is always one of
    // the five PACE BANDS (Very slow · Slow · Medium · Fast · Very fast) or a
    // dash. It is never a surface name. It used to read "Grass courts" because
    // it ranked p.surfaces by win rate, which is a different taxonomy from the
    // thing the box is named after; the box is Court SPEED, so it headlines a
    // speed band.
    //
    // §8.3 tightened the rule the founder set here: the headline is the largest
    // POSITIVE gap between a band's win rate and his win rate over ALL speed-rated
    // matches, n >= 10, ties to the larger n. The previous rule took the highest
    // banded rate outright, which headlines a band even when it is no better than
    // the player's own average — a "best surface" that is not actually a strength.
    //
    // speedBestBand() is the single implementation, shared with the modal's default
    // selection, so the box and the panel behind it cannot name different bands.
    // It is computed over the UNFILTERED population on purpose: the box has no
    // surface chip, so it must not inherit one from the last-opened modal.
    var speedBest = null;
    (function () {
      var prevSurf = state.speedSurf;
      state.speedSurf = 'all';
      try { speedBest = speedBestBand(speedBands(p)); }
      finally { state.speedSurf = prevSurf; }
    }());
    v.speed = speedBest
      ? { headline: speedBest.band.band.label,
          support: Math.round(100 * speedBest.band.won / speedBest.n) + '% ' + MIDDOT + ' ' +
            recordText(speedBest.band.won, speedBest.band.lost) + ' ' + MIDDOT + ' ' +
            speedBest.n + ' matches' }
      : { headline: null, support: 'no speed band beats his rated-match rate at ten matches or more' };

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
  // playing-styles.json is a LIST keyed by display NAME, not an object keyed by
  // player key — every other store this page reads is key-shaped and this one is
  // not. It was previously left as an unassigned `stylesStore`, so archetypeFor
  // returned null for all 428 players and box 5's headline was permanently dashed
  // while looking exactly like a legitimate "not held". Indexed by name on first
  // use, through the key -> name step the profile already carries.
  var stylesByName = null;
  function styleIndex() {
    if (stylesByName) return stylesByName;
    stylesByName = {};
    var src = window.playingStyles;
    var list = (src && src.players) || (Array.isArray(src) ? src : []);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].name) stylesByName[list[i].name] = list[i];
    }
    return stylesByName;
  }
  function archetypeFor(key) {
    var players = (window.playerProfiles && window.playerProfiles.players) || {};
    var p = players[String(key)];
    if (!p || !p.name) return null;
    var rec = styleIndex()[p.name];
    if (!rec) return null;
    // v5.1 labels verbatim — no renaming, no "Pure"/"High-Risk" qualifiers
    // (those appear only in the README and do not exist in the taxonomy).
    return rec.archetype_label || null;
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
      // Item 2. The design string is "All-time record, by surface, indoors and by
      // season" — we had dropped "indoors", which is the one word that tells the
      // reader the Hard row is outdoor-only. The ruled scope label stays appended.
      case 'career': return 'All-time record, by surface, indoors and by season' +
        (fy ? ' ' + MIDDOT + ' since ' + fy : '');
      // §3: the export's "678 matches · 2016-2026" is placeholder copy; both
      // halves are real counts here or the clause is dropped entirely.
      // Item 2. Reverted to the design string verbatim (README §5.1). The
      // previous wording ("every event Zverev's record carries") was a truthful
      // hedge about coverage, but the export wins — and the same fact is now
      // stated in the modal's own footnote where it belongs.
      case 'tourn': return 'Career win' + ENDASH + 'loss at every event he has played';
      // Item 3 · M is the GRID's own total and the span is the grid's first and
      // last year, so the subtitle and the cells can never disagree. It used to
      // read the careerByYear spine (819 for Zverev) against a 727-cell grid,
      // and carried no span at all.
      case 'season': return (function () {
        var sc = calScope(p);
        if (!sc.n) return 'Where in the calendar his results sit';
        return 'Where in the calendar his results sit ' + MIDDOT + ' ' + sc.n + ' matches' +
          (sc.from ? ' ' + MIDDOT + ' ' + (sc.from === sc.to ? sc.from : sc.from + ENDASH + sc.to) : '');
      })();
      case 'splits': return 'Record and win rate by surface, level, format, round and opponent';
      case 'market': return 'How the market has priced him, and what backing him flat has returned';
      case 'speed': return 'Win rate by court pace band';
      case 'styles': return 'Win rate against each playing style ' + possessive(sn) + ' record covers';
      // §5.9. The subtitle names the SOURCE's window, not a career span — this
      // modal is the only block on the page fed by the point-by-point rollup and
      // its horizon is shorter than the ledger's.
      case 'profile': return (function () {
        var c = hbCoverage(p);
        return c
          ? 'Holds and breaks by service game ' + MIDDOT + ' ' + c.matches + ' matches with point-by-point data'
          : 'Holds and breaks by service game';
      })();
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

  // ─── the §5.2A record row, taken from the FILE rather than the README ──────
  //
  // Every value below is lifted from `Player Stat Boxes.dc.html` — the template
  // for the markup (grid `minmax(0,1fr) 300px 58px`, gap 16, radius 10, padding
  // 13x16, name 14/700, meta mono 11.5 #4b5672 margin-top 4, bar track 16px
  // rgba(255,255,255,0.04) radius 4, rate mono 19/700) and `row()` at :1398 for
  // the fill, the background and the rate format. Three of those had drifted and
  // the founder caught all three:
  //
  //   FILL  the file computes ONE blue ramp for every row —
  //         rgba(91,155,255, clamp(0.25 .. 1 over a 40->74% win rate)) — so the
  //         bar encodes the RATE. We were painting the SURFACE colour at a flat
  //         0.75, which encodes the category instead and leaves the strongest and
  //         weakest surface looking identical. Surface colours stay where the file
  //         puts them: the season-table column heads.
  //   RATE  the file prints `pct + '%'` over an integer percentage — a whole
  //         number. rateText() gives one decimal, right for the tables it was
  //         written for and wrong here.
  //   BG    `bg: thin ? 'rgba(255,255,255,0.012)' : '#06070a'`. We drew no
  //         background at all, so the row sat flat on the modal card.
  //
  // The 5-9 band is the one value the file does NOT carry for this element:
  // `row()` is called with min=1 from the career box, so no career row ever
  // reaches it. README §9 says "rate #5b6880, smaller, `small sample` mark"
  // without a size. 15px is the only shrink the export applies to a right-aligned
  // mono rate of its own accord (§5.5 band card). FLAGGED to the founder as a
  // choice, not a measurement — the single number here I could not read off the
  // file.
  var SMALL_RATE_PX = 15;
  var DIM_COLOUR = '#3f4860';
  // ─── MINIMAL BAR — the founder's override of the export (2026-09-17) ────────
  //
  // The export's `row()` computes ONE blue ramp whose ALPHA encodes the rate
  // (rgba(91,155,255, 0.25..1 over a 40->74% win rate)) on a 16px track. That
  // shipped and was then overridden: "Win rate is shown by length only; remove
  // the blue-ramp shading." So the rate is carried by the FILL WIDTH alone and
  // the colour carries the SAMPLE GATE instead — which is the one thing length
  // cannot say, because a 4-of-5 bar and a 40-of-50 bar are the same length.
  //
  //   n >= 10   #5b9bff   full rate
  //   n 5-9     #5b6880   small sample
  //   n < 5     no fill at all — only the track
  //
  // Track and fill are both 4px / radius 2 / no border, no shadow, no gradient.
  var BAR_TRACK_BG = 'rgba(255,255,255,0.06)';
  var BAR_FULL = '#5b9bff';
  var BAR_SMALL = '#5b6880';
  // Takes the MATCH COUNT, not the percentage: the colour is a gate reading and
  // the gate is defined over n. Returns null where the gate paints no fill, so a
  // caller cannot accidentally render a transparent bar that still has a width.
  function barFillColour(n) {
    var g = gateFor(n);
    if (g === GATE.FULL) return BAR_FULL;
    if (g === GATE.SMALL) return BAR_SMALL;
    return null;
  }
  // opts: { label, meta, won, lost, hook, v, open, detail }
  function barRow(opts) {
    var won = opts.won || 0, lost = opts.lost || 0;
    var n = won + lost;
    var g = gateFor(n);
    var pct = n ? 100 * won / n : null;
    // §9 gate, enforced at the one place this rate is printed:
    //   >=10  whole-number rate, 19px, #e7e9ee
    //   5-9   whole-number rate, #5b6880, smaller, "small sample" mark
    //   1-4   NO rate (the W-L still shows in the meta line) and the row does not open
    //   0     em dash
    var rate, rateColour, ratePx, mark = '';
    if (g === GATE.FULL) { rate = Math.round(pct) + '%'; rateColour = '#e7e9ee'; ratePx = 19; }
    else if (g === GATE.SMALL) {
      rate = Math.round(pct) + '%'; rateColour = '#5b6880'; ratePx = SMALL_RATE_PX;
      mark = '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;' +
        'letter-spacing:0.12em;text-transform:uppercase;color:#4b5672;">small sample</div>';
    } else { rate = DASH; rateColour = DASH_COLOUR; ratePx = 19; }

    var thin = g === GATE.NONE || g === GATE.THIN;
    var clickable = !!opts.hook && !thin;
    return '' +
      '<div' + (clickable ? ' data-pp2="' + opts.hook + '" data-v="' + esc(String(opts.v)) + '"' : '') +
      ' style="display:grid;grid-template-columns:minmax(0,1fr) 300px 58px;gap:16px;align-items:center;' +
      'border-radius:10px;padding:13px 16px;' +
      'border:1px solid ' + (opts.open ? 'rgba(91,155,255,0.4)' : 'rgba(255,255,255,0.07)') + ';' +
      'background:' + (thin ? 'rgba(255,255,255,0.012)' : '#06070a') + ';' +
      (clickable ? 'cursor:pointer;' : '') + '">' +
        '<div style="min-width:0;"><div style="font-size:14px;font-weight:700;' +
          (thin ? 'color:' + DIM_COLOUR + ';' : '') + '">' + esc(opts.label) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#4b5672;' +
            'margin-top:4px;">' + esc(opts.meta) + '</div></div>' +
        // Minimal bar: 4px track, 4px fill, radius 2 on both, one solid colour.
        // The grid's align-items:center does the vertical centring, so the track
        // needs no margin of its own.
        '<div style="height:4px;border-radius:2px;background:' + BAR_TRACK_BG + ';overflow:hidden;">' +
          (barFillColour(n)
            ? '<div style="height:4px;width:' + pct.toFixed(1) + '%;' +
              'background:' + barFillColour(n) + ';border-radius:2px;"></div>'
            : '') +
        '</div>' +
        '<div style="text-align:right;font-family:\'IBM Plex Mono\',monospace;font-size:' + ratePx + 'px;' +
          'font-weight:700;color:' + rateColour + ';">' + rate + mark +
        '</div>' +
      '</div>' + (opts.detail || '');
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

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.2 DRILL SPINE — the per-match rows behind a surface row or a season cell
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The design opens a drill under any record and lists DATE · OPPONENT · RD ·
  // SETS · SET SCORES · H · A. We hold TWO per-match stores and neither one can
  // fill that alone. Measured on the deployed file:
  //
  //   recentForm.matches          Zverev 66 rows. Carries date, surface,
  //                               tournament, round, per-set scores, tier — i.e.
  //                               every column. Covers a rolling window only
  //                               (all 66 fall in 2026/late-2025).
  //   tournamentHistory editions  Zverev 829 rows. Carries event, edition YEAR,
  //                               round, opponent and a sets score. Carries NO
  //                               date, NO surface, NO per-set scores, NO price.
  //
  // So a drill is built from whichever store can answer the question asked:
  //   * a SURFACE drill needs per-match surface -> recentForm only;
  //   * a YEAR (Total) drill needs only the year -> both, form preferred.
  //
  // Rows from the edition store therefore dash their date, set scores and prices.
  // That is the §3 rule applied honestly ("a dash only when no source holds it"),
  // not a gap being papered over — and the drill header states the shortfall
  // rather than letting a partial list read as complete.
  //
  // ⚠️ The edition store does NOT reconcile with the season table. Zverev 2023:
  // season row 56-26, editions 55-27. Martinez 2023: season row 44-35, editions
  // 9-16. The season table is the provider's season aggregate and is the ruled
  // spine (§4), so it stays the headline; the drill reports its own count against
  // it. Raised to the founder as gate item (ii) — this is the one thing standing
  // between "records open" and "records open and reconcile".
  // The dedup key deliberately EXCLUDES the round.
  //
  // The two stores do not spell it the same way: recentForm goes through
  // roundLabel(), which renders early rounds draw-relative ("3R"), while the
  // edition store carries the raw draw code ("R32"). Keying on the round made
  // every shared match look like two matches. Measured on the deployed page:
  // Zverev's 2026 Total drill listed 98 rows against a 66-match season cell,
  // and all 32 edition rows were duplicates of form rows.
  //
  // year + event + opponent identifies a match: a player meets a given opponent
  // at a given event in a given year at most once outside a round robin, and the
  // round-robin events seed one group meeting.
  function drillKey(year, event, opp) {
    return String(year) + '|' +
      String(event || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' +
      surnameOf(String(opp || '')).toLowerCase();
  }
  function drillSpine(p) {
    if (drillSpine._k === p.key && drillSpine._v) return drillSpine._v;
    var out = [], seen = {};
    // 1. recentForm, through the LEDGER's own price join — item 19: one join,
    //    not a second lookup. ledgerRows() is the single place a price is chosen.
    ledgerRows(p).forEach(function (x) {
      var m = x.m;
      var ev = eventName(m), rd = roundLabel(m);
      var k = drillKey(String(m.date).slice(0, 4), ev, m.opponent);
      seen[k] = true;
      out.push({
        date: m.date || null, year: String(m.date || '').slice(0, 4),
        surface: m.surface ? String(m.surface).toLowerCase() : null,
        event: ev, round: rd, opp: m.opponent || null, won: !!m.won,
        sets: setsScoreOf(m), setScores: setScoreText(m),
        price: x.price, oppPrice: x.oppPrice, src: 'form', m: m
      });
    });
    // 2. tournamentHistory editions for everything the form window never saw.
    (p.tournamentHistory || []).forEach(function (t) {
      (t.editions || []).forEach(function (e) {
        (e.matches || []).forEach(function (mm) {
          var k = drillKey(e.year, t.name, mm.opp);
          if (seen[k]) return;
          seen[k] = true;
          out.push({
            date: null, year: String(e.year),
            surface: null,                       // no surface on this store, by measurement
            event: t.name || null, round: mm.round || null, opp: mm.opp || null,
            won: mm.res === 'W', sets: mm.score || null, setScores: null,
            price: null, oppPrice: null, src: 'edition', m: null
          });
        });
      });
    });
    // Most recent first; undated (edition) rows sort after the dated ones of the
    // same year, because an unknown date cannot claim a position among known ones.
    out.sort(function (a, b) {
      if (a.year !== b.year) return a.year < b.year ? 1 : -1;
      if (!!a.date !== !!b.date) return a.date ? -1 : 1;
      if (a.date && b.date) return a.date < b.date ? 1 : -1;
      return 0;
    });
    drillSpine._k = p.key; drillSpine._v = out;
    return out;
  }
  // "3 - 1" from the per-set array — the design's SETS column.
  function setsScoreOf(m) {
    var sets = (m && m.sets) || [];
    if (!sets.length) return m && m.result ? String(m.result) : null;
    var w = 0, l = 0;
    sets.forEach(function (s) { if ((s.p || 0) > (s.o || 0)) w++; else if ((s.o || 0) > (s.p || 0)) l++; });
    return w + ' - ' + l;
  }

  // ─── PROGRESSIVE DRILL PAGING ───────────────────────────────────────────────
  //
  // "All · career" is 1,463 rows for Djokovic — the largest list on the deployed
  // roster. Painting all of them costs ~13k DOM nodes on open, and the old
  // DRILL_CAP of 200 made the rest UNREACHABLE, which the founder ruled out
  // ("no freezing, no cut-off list: all M matches must be reachable").
  //
  // So the card paints one page and appends the next as the list scrolls. The
  // append writes into the LIVE grid rather than going through repaint(), for
  // one concrete reason: repaint() rebuilds the whole profile string and the
  // scroll container with it, which resets scrollTop to 0 — the user would be
  // yanked to the top of the list every time it grew.
  var DRILL_PAGE = 150;
  // DOM lifetime, deliberately NOT part of `state`: this tracks how much of the
  // open card has been painted, which dies with the card. Only one drill is ever
  // open (the handlers enforce it), so a single pager cannot be clobbered.
  var drillPager = null;

  // ONE STORE PER YEAR — never the union.
  //
  // Deduping the two stores by (year, event, opponent) took Zverev's 2026 Total
  // drill from 98 rows to 74 against a 66-match cell, but it did not reach zero,
  // and a roster census found 282 of 1,329 year-cells (21.2%) still listing MORE
  // matches than the record above them — worst case Norrie 2021, 85 rows against
  // a 36-match cell. That residue is not a key problem: the two stores genuinely
  // disagree about how many matches a season held (Zverev 2021: season row 33-6,
  // edition rows 62-15), so no key can reconcile them.
  //
  // Mixing two stores that disagree cannot produce a trustworthy count, so a year
  // takes ONE of them. recentForm wins where it has anything for that year: it is
  // dated, subject-relative, carries per-set scores and is the store the ledger's
  // price join is built over. Where it is silent, the edition store is all we hold.
  // A year the form store covers only partly then reads "Showing 13 of 81" — a
  // coverage statement, which is true, rather than 94 rows, which is not.
  // year -> 'form' | 'edition', memoised per player. Built once over the spine
  // rather than re-scanned per call: the career drills ask this for every row.
  function drillSourceMap(p) {
    if (drillSourceMap._k === p.key && drillSourceMap._v) return drillSourceMap._v;
    var m = {};
    drillSpine(p).forEach(function (r) {
      if (r.src === 'form') m[r.year] = 'form';
      else if (!m[r.year]) m[r.year] = 'edition';
    });
    drillSourceMap._k = p.key; drillSourceMap._v = m;
    return m;
  }
  function drillSourceFor(p, year) {
    if (!year) return null;
    return drillSourceMap(p)[String(year)] || 'edition';
  }
  // The one-store-per-year rule is applied PER ROW-YEAR, not per drill. A career
  // drill therefore equals the sum of its own year drills by construction — the
  // reconciliation the founder asked for in item 4 — instead of quietly unioning
  // two stores that disagree the moment the scope widens past one season.
  function drillRows(p, surf, year) {
    var src = drillSourceMap(p);
    return drillSpine(p).filter(function (r) {
      if (year && r.year !== String(year)) return false;
      if (r.src !== (src[r.year] || 'edition')) return false;
      if (!surf) return true;
      // Indoors is a COURT TYPE carved out of the surfaces; recentForm carries a
      // surface but no court type, so an Indoors drill has no per-match source at
      // all and must say so rather than silently listing hard-court matches.
      if (surf === 'indoors') return false;
      return r.surface === surf;
    });
  }

  // The drill card (README §5.2B) — used by both the surface rows and the season
  // cells, so the two cannot drift apart.
  // The note is the design's own field (`mkDrill().note`, Player Stat Boxes
  // .dc.html:3173). Two things can make a list shorter than the record above it
  // and they are NOT the same statement, so the note distinguishes them:
  //   * the per-match store does not hold those matches  -> a coverage shortfall
  //   * the page has not painted them YET                -> "scroll for more"
  // Collapsing the two would let a paging cut read as missing data.
  // `surfaceless` is the count of rows that ARE in the store for this scope but
  // carry no surface, so a surface drill cannot claim them. Measured on Zverev
  // 2025: the year drill lists all 81 matches and the Clay drill listed none —
  // and the first draft said "no matches in the per-match store for this record",
  // which is false. The matches are stored; the SURFACE is what is missing, and
  // those are different defects with different fixes. A reason has to be true.
  function drillNote(rowsN, paintedN, cellN, surf, surfaceless) {
    if (!rowsN) {
      if (surf === 'indoors') return 'no per-match court type on record';
      if (surfaceless) {
        // "in scope", not "here": these rows belong to the YEAR (or career), not
        // to this surface — no one can say which surface they were played on,
        // which is the whole reason they cannot appear.
        return 'the ' + surfaceless + ' match' + (surfaceless === 1 ? '' : 'es') +
          ' in scope carr' + (surfaceless === 1 ? 'ies' : 'y') + ' no surface';
      }
      return 'no matches in the per-match store for this record';
    }
    if (paintedN < rowsN) {
      return 'Showing ' + paintedN + ' of ' + rowsN + ' ' + MIDDOT + ' scroll for more';
    }
    if (rowsN < cellN) {
      return 'Showing ' + rowsN + ' of ' + cellN + ' ' + MIDDOT +
        (surfaceless
          ? ' ' + surfaceless + ' more in scope carry no surface'
          : ' the rest are not in the per-match store');
    }
    if (rowsN > cellN) {
      // OVERFLOW — the list holds MORE than the record it sits under.
      //
      // Do NOT name a cause here. The first draft of this note called it a
      // double-count in the per-match store; checking one case showed the
      // opposite. Norrie 2021: the season row reads 36 matches, the per-match
      // store holds 85 across 30 events, and 85 is the number that matches his
      // actual 2021. It is the provider's season aggregate that is short, not
      // the match list that is long. Which source is wrong varies, so the note
      // states the DISAGREEMENT and leaves the cause to the report.
      return rowsN + ' matches on record here against a ' + cellN +
        '-match season row ' + MIDDOT + ' the two sources disagree';
    }
    return 'All ' + rowsN + ' matches';
  }
  function renderDrill(p, opts) {
    var rows = drillRows(p, opts.surf, opts.year);
    var shown = rows.slice(0, DRILL_PAGE);
    var cellN = (opts.won || 0) + (opts.lost || 0);
    // Rows that are in the store for this scope but carry no surface. Only a
    // SURFACE drill can lose rows to that, so an all-matches drill asks nothing.
    var surfaceless = (opts.surf && opts.surf !== 'indoors')
      ? drillRows(p, null, opts.year).filter(function (r) { return !r.surface; }).length
      : 0;
    var note = drillNote(rows.length, shown.length, cellN, opts.surf, surfaceless);

    var HEAD = [['Date', 'left'], ['', 'left'], ['Opponent', 'left'], ['Rd', 'left'],
                ['Sets', 'left'], ['Set scores', 'left'], ['H', 'right'], ['A', 'right']];
    var GRID = 'display:grid;grid-template-columns:46px 12px minmax(0,1.15fr) 38px 40px ' +
      'minmax(0,1.35fr) 48px 48px;gap:0 10px;align-items:center;';
    var head = HEAD.map(function (h) {
      return '<div style="position:sticky;top:0;background:#06070a;font-family:\'IBM Plex Mono\',monospace;' +
        'font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4b5672;' +
        'text-align:' + h[1] + ';padding:0 0 7px;">' + esc(h[0]) + '</div>';
    }).join('');

    // The pager reuses THIS builder for every appended page, so a scrolled-in row
    // is byte-identical to a first-page one. `pg.lastEvent` carries the event
    // grouping across the page boundary — reset it and the first row of page two
    // would repeat a group header that is already on screen.
    var body = drillBodyHtml(rows, 0, shown.length, drillPager = {
      rows: rows, next: shown.length, lastEvent: null, cellN: cellN, surf: opts.surf,
      surfaceless: surfaceless,
      // A career-scope drill lists every edition of an event, so "Australian Open"
      // heads a group once per year. Without the year in the meta the reader cannot
      // tell 2019's group from 2024's.
      multiYear: !opts.year
    });

    return '<div style="' + (opts.span ? 'grid-column:1 / -1;' : '') + 'background:#06070a;' +
      'border:1px solid rgba(91,155,255,0.3);border-radius:' + (opts.span ? 11 : 10) + 'px;' +
      'padding:' + (opts.span ? '15px 17px' : '13px 15px') + ';margin:10px 0 14px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:11px;">' +
        '<div style="font-size:14px;font-weight:700;">' + esc(opts.title) + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#8b96b5;' +
          'white-space:nowrap;">' + esc(recordText(opts.won, opts.lost) + ' ' + MIDDOT + ' ' +
          cellN + ' matches') + '</div>' +
        '<div data-pp2-drill-note="1" style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;' +
          'color:#4b5672;white-space:nowrap;">' + esc(note) + '</div>' +
        '<button type="button" data-pp2="career-drill-close" style="margin-left:auto;background:none;' +
          'border:0;color:#5b6880;font-size:11px;font-family:\'IBM Plex Mono\',monospace;' +
          'letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;">Close</button>' +
      '</div>' +
      (shown.length
        ? '<div data-pp2-drill-scroll="1" style="max-height:340px;overflow-y:auto;">' +
            '<div data-pp2-drill-grid="1" style="' + GRID + '">' + head + body + '</div></div>'
        : '') +
      '</div>';
  }
  // One page of drill rows. `pg` is the pager, mutated in place so the caller can
  // ask "how far have I painted" without re-deriving it from the DOM.
  function drillBodyHtml(rows, from, to, pg) {
    return rows.slice(from, to).map(function (r) {
      var grp = '';
      // Group on event AND year when the scope spans years, or two editions of the
      // same event that happen to sort next to each other would merge into one.
      var gk = pg.multiYear ? r.year + '|' + r.event : r.event;
      if (gk !== pg.lastEvent) {
        pg.lastEvent = gk;
        grp = '<div style="grid-column:1 / -1;display:flex;align-items:center;gap:10px;' +
          'padding:9px 0 5px;border-top:1px solid rgba(255,255,255,0.07);">' +
          '<div style="font-size:12.5px;font-weight:700;color:#e7e9ee;white-space:nowrap;">' +
            esc(r.event || DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#4b5672;' +
            'white-space:nowrap;">' + esc(eventMetaOf(r, pg.multiYear)) + '</div></div>';
      }
      var wl = r.won ? '#3dd68c' : '#e0616f';
      // Only a form-sourced row has a match sheet to open — the sheet is keyed on
      // date|opponent and an edition row has no date. §3: do not advertise a click
      // that cannot land.
      var hook = (r.src === 'form' && r.date) ? sheetHook(r.date + '|' + (r.opp || '')) : '';
      var cur = hook ? sheetCursor() : '';
      var cell = function (style, txt) {
        return '<div ' + hook + 'style="' + cur + style + '">' + txt + '</div>';
      };
      return grp +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#5b6880;padding:5px 0;',
             esc(r.date ? fmtDotDate(r.date) + '.' : DASH)) +
        cell('width:8px;height:8px;border-radius:2px;background:' + wl + ';', '') +
        cell('font-size:12.5px;color:#e7e9ee;overflow:hidden;text-overflow:ellipsis;' +
             'white-space:nowrap;padding:5px 0;', esc(r.opp ? surnameFirst(r.opp) : DASH)) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;padding:5px 0;',
             esc(r.round || DASH)) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;color:' + wl +
             ';padding:5px 0;', esc(r.sets || DASH)) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#8b96b5;' +
             'white-space:nowrap;padding:5px 0;', esc(scoreWithStatus(r, r.setScores))) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;color:#e7e9ee;' +
             'text-align:right;padding:5px 0;', oddsText(r.price)) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#4b5672;' +
             'text-align:right;padding:5px 0;', oddsText(r.oppPrice));
    }).join('');
  }

  // Scroll-driven append. Installed with capture:true because `scroll` does not
  // bubble — a delegated listener on the mount root never sees it otherwise.
  function onDrillScroll(e) {
    var sc = e.target;
    if (!sc || !sc.getAttribute || !sc.getAttribute('data-pp2-drill-scroll')) return;
    var pg = drillPager;
    if (!pg || pg.next >= pg.rows.length) return;
    // 240px of runway — append before the user reaches the end, not after.
    if (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 240) return;
    var grid = sc.querySelector('[data-pp2-drill-grid]');
    if (!grid) return;
    var to = Math.min(pg.rows.length, pg.next + DRILL_PAGE);
    grid.insertAdjacentHTML('beforeend', drillBodyHtml(pg.rows, pg.next, to, pg));
    pg.next = to;
    var noteEl = sc.parentNode && sc.parentNode.querySelector('[data-pp2-drill-note]');
    if (noteEl) noteEl.textContent = drillNote(pg.rows.length, pg.next, pg.cellN, pg.surf, pg.surfaceless);
  }
  // "2024 · Clay · ATP" under the event group row. Only stated where held — the
  // design's example reads "Australian Open · Hard · Grand Slam", but the level
  // word is not in either per-match store (recentForm carries `tier`, which is
  // atp/challenger, not the 250/500/1000/Slam level), so the tier is what we can
  // truthfully print. Reported rather than approximated.
  function eventMetaOf(r, withYear) {
    var bits = [];
    if (withYear && r.year) bits.push(r.year);
    if (r.surface) bits.push(r.surface.charAt(0).toUpperCase() + r.surface.slice(1));
    if (r.m && r.m.tier) bits.push(String(r.m.tier).toUpperCase() === 'ATP' ? 'ATP' : String(r.m.tier));
    return bits.join(' ' + MIDDOT + ' ');
  }

  // §5.2 Career record — surface rows over the spine + Record by season.
  // §5.2 Career record — surface rows + Record by season, rebuilt to the FILE.
  //
  // The founder rejected the first build on 19 counts. The three that changed the
  // DATA rather than the paint:
  //
  //  (4/6) The surface rows and the season table were reading DIFFERENT splits.
  //        The rows used the provider's raw per-surface buckets; the table carves
  //        the indoor matches out into their own column. Measured live on Zverev:
  //        the Hard ROW read 337-151 while the Hard COLUMN read 295-134 and
  //        Indoors read 42-17 — and 295+42 = 337 exactly. Two true numbers under
  //        one label. Both now come from the SAME carved cells, so the row set is
  //        Hard · Grass · Clay · Indoors and each row equals its own column.
  //
  //    (4) Row ORDER is the file's, not the README's. `Player Stat Boxes.dc.html`
  //        :1650 lists Hard, Grass, Clay, Indoors; README §5.2A says "Hard, Clay,
  //        Grass, Indoors". The file wins (README §Fidelity says so explicitly).
  //        Reported as a README-vs-file difference.
  //
  //    (5) "Unrecorded surface" was never a design row and is gone. It is a
  //        FOOTNOTE now, so the rows still reconcile to the career total.
  //        The founder asked for those matches to be resolved through the
  //        tournament surface map first. Measured: they cannot be, for two
  //        independent reasons, and neither is fixable at this layer.
  //          a. There are no matches to resolve. The residual is an ARITHMETIC
  //             gap inside the provider's own season aggregate — Zverev 2025
  //             reads total 56-25 while its own surface buckets sum to 54-25.
  //             No match identity is attached to the missing 2.
  //          b. Even given identities, the join does not exist. The surface map
  //             is keyed by `tournament_key` (10,280 numeric ids); the per-match
  //             store carries only an event NAME. 0 of 203 residual-year matches
  //             joined, for both sampled players.
  //        So: before 6 matches, after 6 matches, reason stated on the page.
  function renderCareerModal(p, ctx) {
    var scopeYear = state.careerScope === 'season' ? currentYear() : null;

    // ── rows: the carved cells, so a row cannot disagree with its column ──────
    var cells, total;
    if (scopeYear) {
      var yr = spineYears(p).filter(function (y) { return String(y.year) === String(scopeYear); })[0];
      cells = yr ? gridCells(yr) : { total: null, hard: null, grass: null, clay: null, indoors: null };
      total = yr && yr.total ? { won: yr.total.won || 0, lost: yr.total.lost || 0 } : { won: 0, lost: 0 };
    } else {
      cells = careerGridCells(p);
      var ct0 = spineTotal(p);
      total = { won: ct0.won, lost: ct0.lost };
    }
    // The footnoted residual: whatever the carved rows do not account for.
    var sw = 0, sl = 0;
    CAREER_ROWS.forEach(function (s) {
      var c = cells[s.id];
      if (c) { sw += c.won || 0; sl += c.lost || 0; }
    });
    var resid = { won: (total.won || 0) - sw, lost: (total.lost || 0) - sl };
    var residN = resid.won + resid.lost;

    var rows = CAREER_ROWS.map(function (s) {
      var c = cells[s.id];
      var w = c ? (c.won || 0) : 0, l = c ? (c.lost || 0) : 0, n = w + l;
      var open = state.careerDrill && state.careerDrill.kind === 'surface' &&
                 state.careerDrill.surf === s.id;
      return barRow({
        label: s.label,
        meta: c === null && s.id === 'indoors'
          ? 'no court type on record'
          : (n ? recordText(w, l) + ' ' + MIDDOT + ' ' + n + ' matches' : 'no matches on record'),
        won: w, lost: l,
        hook: 'career-surf', v: s.id, open: open,
        detail: open ? renderDrill(p, {
          surf: s.id, year: scopeYear,
          title: s.label + ' ' + MIDDOT + ' ' + (scopeYear || 'career'),
          won: w, lost: l, span: false
        }) : ''
      });
    }).join('');

    // ── Record by season ─────────────────────────────────────────────────────
    var years = spineYears(p).slice().sort(function (a, b) {
      return String(b.year) < String(a.year) ? -1 : 1;
    });
    var HEADS = [
      { label: 'Year', colour: '#4b5672', id: null },
      { label: 'Total', colour: '#8b96b5', id: 'total' },
      { label: 'Clay', colour: '#e8a84e', id: 'clay' },
      { label: 'Hard', colour: '#4db8ff', id: 'hard' },
      { label: 'Indoors', colour: '#c6ccdb', id: 'indoors' },
      { label: 'Grass', colour: '#3dd68c', id: 'grass' }
    ];
    var head = HEADS.map(function (h, i) {
      return '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;' +
        'letter-spacing:0.18em;text-transform:uppercase;color:' + h.colour + ';' +
        'padding-bottom:11px;' + (i ? 'text-align:right;' : '') + '">' + h.label + '</div>';
    }).join('');

    // ── EVERY RECORD CLICKABLE (founder 2026-09-17, items 1 and 2) ────────────
    //
    // The gate is the design file's, not §9's. `pick()` (Player Stat Boxes
    // .dc.html:3179) guards on ONE thing — `if (!val || val === DASH) return;` —
    // so a dash is inert and every cell that carries a record opens, however
    // small. That is right for a drill and wrong for a RATE: §9's n>=5 gate
    // exists because a 1-of-2 win rate is a claim a 2-match sample cannot make,
    // whereas a list of 2 matches is just those 2 matches. The gate therefore
    // moved to where the claim is — the bar (item 3) still greys at 5-9 and
    // paints nothing under 5.
    function cellCan(rec) { return !!rec && ((rec.won || 0) + (rec.lost || 0)) > 0; }
    // The design's season cell carries no `style-hover` at all; the only hover the
    // file defines for a clickable data row is `background:rgba(255,255,255,0.02)`
    // (.dc.html:489), already carried by `.pp2-trow`. Reused rather than invented.
    function cellAttrs(can, v) {
      return can ? ' class="pp2-crec" data-pp2="career-cell" data-v="' + esc(v) + '"' : '';
    }
    function drillTitleFor(surfId, scopeLabel) {
      // The file's own title expression: `(surf ? Capitalised : 'All matches')
      // + ' · ' + scope`. The founder's note writes it "All · career"; the file
      // writes "All matches · career" and he ruled the export wins outside item 3.
      var lab = surfId
        ? HEADS.filter(function (h) { return h.id === surfId; })[0].label
        : 'All matches';
      return lab + ' ' + MIDDOT + ' ' + scopeLabel;
    }
    // One drill, one renderer, for a season row and the career row alike.
    function drillFor(scope, surfId, rec, scopeLabel) {
      return renderDrill(p, {
        surf: surfId, year: scope === 'career' ? null : scope, span: true,
        title: drillTitleFor(surfId, scopeLabel),
        won: rec ? rec.won || 0 : 0, lost: rec ? rec.lost || 0 : 0
      });
    }

    var body = years.map(function (y) {
      var g = gridCells(y);
      var yearStr = String(y.year);
      var openCell = state.careerDrill && state.careerDrill.kind === 'cell' &&
        state.careerDrill.year === yearStr ? state.careerDrill.surf : null;
      var yearCan = cellCan(g.total);
      var cellsHtml = HEADS.slice(1).map(function (h) {
        var r = g[h.id];
        var txt = r ? (r.won || 0) + '/' + (r.lost || 0) : DASH;
        // A dash is inert — clicking a dash must not paint an empty card.
        var can = cellCan(r);
        var on = openCell === (h.id === 'total' ? '' : h.id);
        return '<div' + cellAttrs(can, yearStr + '|' + (h.id === 'total' ? '' : h.id)) +
          ' style="font-family:\'IBM Plex Mono\',monospace;font-size:' + (h.id === 'total' ? 14 : 13) + 'px;' +
          (h.id === 'total' ? 'font-weight:700;' : '') + 'font-variant-numeric:tabular-nums;text-align:right;' +
          'padding:11px 0;border-top:1px solid rgba(255,255,255,0.05);' +
          (r ? '' : 'color:' + DIM_COLOUR + ';') + (can ? 'cursor:pointer;' : '') +
          (on ? 'color:#5b9bff;' : '') + '">' + txt + '</div>';
      }).join('');
      var drill = '';
      if (openCell !== null) {
        var surf = openCell || null;
        drill = drillFor(yearStr, surf, surf ? g[surf] : g.total, yearStr);
      }
      // 1a — the YEAR label opens the same drill as its Total cell (the file gives
      // both `y.onYear`).
      return '<div' + cellAttrs(yearCan, yearStr + '|') +
        ' style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;' +
        'letter-spacing:0.02em;padding:11px 0;border-top:1px solid rgba(255,255,255,0.05);' +
        (yearCan ? 'cursor:pointer;' : 'color:' + DIM_COLOUR + ';') +
        (openCell === '' ? 'color:#5b9bff;' : '') + '">' +
        esc(yearStr) + '</div>' + cellsHtml + drill;
    }).join('');

    var ct = spineTotal(p);
    var cf = careerGridCells(p);
    // Footer label is the file's EYEBROW (mono 10/700 0.18em uppercase #8b96b5),
    // not a 13px body word — item 15.
    // ── item 2 — the CAREER row opens too ────────────────────────────────────
    // The file makes every footer cell clickable (`c.onClick`, .dc.html:1009) with
    // the same `pick()` guard; the label is ours, because the founder asked for
    // "CAREER label or TOTAL cell". Scope sentinel is the literal "career", which
    // cannot collide with a year.
    var openCareerCell = state.careerDrill && state.careerDrill.kind === 'cell' &&
      state.careerDrill.year === 'career' ? state.careerDrill.surf : null;
    var careerCan = cellCan(ct);
    var footer = '<div' + cellAttrs(careerCan, 'career|') +
      ' style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
      'letter-spacing:0.18em;text-transform:uppercase;color:' +
      (openCareerCell === '' ? '#5b9bff' : '#8b96b5') + ';padding:15px 0 13px;' +
      (careerCan ? 'cursor:pointer;' : '') +
      'border-top:1px solid rgba(255,255,255,0.18);">Career</div>' +
      HEADS.slice(1).map(function (h) {
        var r = h.id === 'total' ? ct : cf[h.id];
        var can = cellCan(r);
        var on = openCareerCell === (h.id === 'total' ? '' : h.id);
        return '<div' + cellAttrs(can, 'career|' + (h.id === 'total' ? '' : h.id)) +
          ' style="font-family:\'IBM Plex Mono\',monospace;font-size:' + (h.id === 'total' ? 14 : 13) + 'px;' +
          'font-weight:700;font-variant-numeric:tabular-nums;text-align:right;padding:15px 0 13px;' +
          (r ? '' : 'color:' + DIM_COLOUR + ';') + (can ? 'cursor:pointer;' : '') +
          (on ? 'color:#5b9bff;' : '') +
          'border-top:1px solid rgba(255,255,255,0.18);">' +
          (r ? (r.won || 0) + '/' + (r.lost || 0) : DASH) + '</div>';
      }).join('') +
      (openCareerCell !== null
        ? drillFor('career', openCareerCell || null,
                   openCareerCell ? cf[openCareerCell] : ct, 'career')
        : '');

    var fy = spineFirstYear(p);
    var ic = indoorCoverage(p);
    return '' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:11px;">' +
        eyebrow(scopeYear ? scopeYear + ' by surface' : 'Career by surface') +
        '<div style="display:flex;gap:3px;background:#0a0d13;border:1px solid rgba(255,255,255,0.09);' +
          'border-radius:9px;padding:2px;margin-left:auto;">' +
          scopeBtn('career', 'Career', state.careerScope !== 'season') +
          scopeBtn('season', currentYear(), state.careerScope === 'season') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:7px;">' + rows + '</div>' +
      // Item 5 — the residual as a footnote, with the reason it cannot be resolved.
      (residN
        ? '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#4b5672;' +
            'margin-top:10px;">' + residN + ' match' + (residN === 1 ? '' : 'es') +
            ' with no surface on record</div>'
        : '') +
      // §5.2B header line — title + the "WINS / LOSSES" eyebrow the founder
      // found missing (item 11), then the file's helper copy (item 12).
      '<div style="display:flex;align-items:baseline;justify-content:space-between;margin:24px 0 6px;">' +
        '<div style="font-size:20px;font-weight:800;">Record by season</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:0.12em;' +
          'text-transform:uppercase;color:#4b5672;">Wins / losses</div>' +
      '</div>' +
      '<div style="font-size:13px;color:#5b6880;line-height:1.5;margin-bottom:14px;">' +
        'Click any record to browse those matches ' + EMDASH + ' a surface cell for that surface ' +
        'alone, the year for all of them.</div>' +
      '<div style="display:grid;grid-template-columns:auto repeat(5,minmax(0,1fr));gap:0 14px;' +
        'align-items:center;">' + head + body + footer + '</div>' +
      '<div style="font-size:11px;color:#5b6880;margin-top:14px;line-height:1.6;">' +
        'Season rows are the record we hold per year' + (fy ? ' from ' + fy : '') +
        '; the career line is their sum, so the two always agree. ' +
        (residN
          ? 'The ' + residN + ' footnoted match' + (residN === 1 ? '' : 'es') + ' above ' +
            (residN === 1 ? 'is' : 'are') + ' the gap between the provider’s season total and ' +
            'its own surface buckets, so no individual match carries a surface to look up. '
          : '') +
        (function () {
          if (!ic.rows) return '';
          if (!ic.withCourt) {
            return 'Indoors is a court type carved out of the surface rows and columns, so Hard, ' +
              'Clay and Grass here are outdoor only. No season on record carries court type yet, ' +
              'so it reads as a dash throughout.';
          }
          return 'Indoors is a court type carved out of the surface rows and columns, so Hard, Clay ' +
            'and Grass here are outdoor only and the five columns still sum to the total. Court type ' +
            'reaches ' + ic.withCourt + ' of ' + ic.rows + ' seasons' +
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

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.3 RECORD PER TOURNAMENT — data layer
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The modal's spine is `tournamentHistory`: it is the only store that groups
  // matches by EVENT and by EDITION, and the box headline ("N tournaments on
  // record") counts its rows. But it is also the thinnest — an edition match
  // carries only `{res, round, opp, oppKey, score}`. Every other column the
  // design asks for (date, surface, price, set scores, tier) has to be joined
  // in from a store that holds it:
  //
  //   career-history/{key}.json   775 rows for Zverev, 2013-2026. date, surface,
  //                               level, tournament, round, result. NO set
  //                               scores (the pipeline drops fixture.scores when
  //                               it writes the shard), NO price.
  //   market-edge/{key}.json      727 rows. date, event, level, surface, venue,
  //                               opp, price, oppPrice, book, pl. THE price
  //                               source, and the only one carrying a book.
  //   recentForm.matches          53 rows, rolling window. The ONLY per-set
  //                               score source, and the only `retired`/`walkover`
  //                               flags we hold.
  //
  // All three key differently from the edition store, so everything below joins
  // on ONE derived key — year + opponent surname — and refuses to guess when
  // that key is not unique. See oppKeyOf() for why a surname needs three name
  // shapes ("B. Bonzi", "Martinez P.", "Zverev, Alexander").
  //
  // ⚠️ Do NOT join these stores on the event NAME. They use three different
  // event vocabularies: tournamentHistory says "Madrid", market-edge says
  // "Mutua Madrid Open", career-history says "Madrid". Measured on Zverev: 7 of
  // 59 market events name-match tournamentHistory. The name join is 12%; the
  // year+surname join is 99.3%.
  function oppKeyOf(name) {
    var s = String(name || '').trim();
    var c = s.indexOf(',');
    if (c > 0) s = s.slice(0, c);                              // "Zverev, Alexander"
    else if (/^[A-Za-z]\.\s+/.test(s)) s = s.replace(/^[A-Za-z]\.\s+/, '');   // "B. Bonzi"
    else s = s.replace(/(\s+[A-Za-z]\.)+$/, '');               // "Diaz Acosta F."
    return s.toLowerCase().replace(/[^a-z]/g, '');
  }
  function tkey(year, opp) { return String(year) + '|' + oppKeyOf(opp); }

  // The event half of the strong key. career-history and recentForm write the
  // same events three ways ("Vienna", "ATP Vienna", "ATP Finals - Turin"), so
  // the prefix and the trailing " - <city>" come off before comparison. This
  // normalises a LOOKUP only — it never merges two tournamentHistory rows, so
  // no published W-L can move because of it.
  function evKeyOf(name) {
    var s = String(name || '');
    var i = s.indexOf(' - ');
    if (i > 0) s = s.slice(0, i);
    s = s.replace(/^(ATP|WTA|ITF)\s+/i, '');
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function ekey(year, event, opp) {
    return String(year) + '|' + evKeyOf(event) + '|' + oppKeyOf(opp);
  }

  // ─── why the key is year + EVENT + surname, and not year + surname ─────────
  //
  // Measured on Zverev's 740 edition rows: keying on (year, surname) alone
  // leaves 353 of them — 48% — sharing a key with another row, because a top
  // player meets the same opponent several times a season at different events.
  // §3 forbids picking one of an ambiguous pair, so half the rows would dash
  // their date and price. Adding the event takes the collision down to 2 rows.
  //
  // The event is not always spelled the same way in both stores, so the join
  // falls back to (year, surname) when the event key misses AND that weaker key
  // is unique on both sides. Zverev 740 rows: 700 on the event key, 11 on the
  // fallback, 29 unmatched (96.1%). Martinez 203: 198 / 4 / 1 (99.5%).
  function pairIndex(list, yearOf, eventOf, oppOf) {
    var byEvent = {}, byYear = {};
    function put(map, k, row) {
      if (Object.prototype.hasOwnProperty.call(map, k)) map[k] = null;
      else map[k] = row;
    }
    for (var i = 0; i < list.length; i++) {
      var r = list[i], y = yearOf(r);
      put(byEvent, ekey(y, eventOf(r), oppOf(r)), r);
      put(byYear, tkey(y, oppOf(r)), r);
    }
    return { byEvent: byEvent, byYear: byYear };
  }

  function careerHistoryFor(key) {
    var store = window.careerHistory || {};
    return store[String(key)] || null;
  }

  /**
   * Has the career-history fetch for this player SETTLED?
   *
   * `careerHistoryFor()` cannot answer this: it returns null both for "the shard
   * has not come back yet" and for "the shard came back with nothing", and those
   * two are different facts about our data. The host settles the key by writing
   * `window.careerHistory[key] = rows || []` (bsp-consult-dashboard.html
   * `loadPp2CareerHistory`) — and its catch is silent, so a THROWN fetch leaves
   * the key absent forever too. Absent therefore means in-flight or failed;
   * present means settled, empty or not.
   *
   * The fetch is unconditional on profile open (`showPlayerProfileV2` calls
   * `loadPp2CareerHistory(key)` on every mount), so "absent" cannot mean
   * "nobody asked" and this predicate cannot spin forever on a real open.
   *
   * Why it exists: §5.5 printed "No matches on record, so no court can be rated."
   * off `!speedRows(p).length`, which is true of an unsettled store. On a slow or
   * failed shard the modal stated a FACT ABOUT THE PLAYER that came from a fact
   * about the network — the plausible-default class the missing-data ruling
   * forbids. Measured: a cold open through the hybrid server read 0 rows where a
   * warm one read 775, and the modal asserted "no matches on record" for Zverev.
   */
  function careerHistorySettled(key) {
    var store = (typeof window !== 'undefined') ? window.careerHistory : null;
    if (!store) return false;
    return Object.prototype.hasOwnProperty.call(store, String(key));
  }

  // Per-player join of all four stores. Memoised on the player key AND on the
  // identity of the two lazy stores, because both land after first paint and a
  // cache keyed on the player alone would freeze the pre-fetch (empty) state.
  function tournJoin(p) {
    var mk = marketFor(p.key);
    var ch = careerHistoryFor(p.key);
    if (tournJoin._k === p.key && tournJoin._mk === mk && tournJoin._ch === ch && tournJoin._v) {
      return tournJoin._v;
    }
    var th = p.tournamentHistory || [];

    // 1 · every edition match, keyed. A key claimed by two different tournaments
    //     is dropped rather than attributed to one of them.
    var thOwner = {};
    th.forEach(function (t) {
      (t.editions || []).forEach(function (e) {
        (e.matches || []).forEach(function (m) {
          var k = tkey(e.year, m.opp);
          if (!Object.prototype.hasOwnProperty.call(thOwner, k)) thOwner[k] = t.name;
          else if (thOwner[k] !== t.name) thOwner[k] = null;
        });
      });
    });

    // 2 · market rows -> a tournament. Two passes: the unambiguous key join
    //     first, then a per-player event-name alias VOTED from what that join
    //     proved. The alias never crosses players, so a merge that is right for
    //     one player's history cannot leak into another's.
    var mrows = (mk && mk.matches) || [];
    var mCount = {};
    mrows.forEach(function (r) {
      var k = tkey(String(r.date || '').slice(0, 4), r.opp);
      mCount[k] = (mCount[k] || 0) + 1;
    });
    var owner = new Array(mrows.length);
    var votes = {};
    mrows.forEach(function (r, i) {
      var k = tkey(String(r.date || '').slice(0, 4), r.opp);
      if (mCount[k] !== 1) return;                 // ambiguous on the market side
      var t = thOwner[k];
      if (!t) return;                              // absent or ambiguous on the th side
      owner[i] = t;
      var v = votes[r.event] = votes[r.event] || {};
      v[t] = (v[t] || 0) + 1;
    });
    var alias = {};
    Object.keys(votes).forEach(function (ev) {
      var v = votes[ev];
      alias[ev] = Object.keys(v).sort(function (a, b) { return v[b] - v[a]; })[0];
    });
    mrows.forEach(function (r, i) { if (!owner[i] && alias[r.event]) owner[i] = alias[r.event]; });

    // 3 · per-tournament aggregates from the assigned market rows: BACKING
    //     (Pinnacle closing only, §5 / item 12), plus the tier and surface the
    //     design's name column and SURFACE column need.
    var agg = {};
    function bucket(name) {
      return agg[name] || (agg[name] = {
        pinPl: 0, pinN: 0, anyN: 0, surf: {}, level: {}, lastLevelYear: null, lastLevel: null
      });
    }
    mrows.forEach(function (r, i) {
      var name = owner[i];
      if (!name) return;
      var b = bucket(name);
      b.anyN++;
      if (r.book === 'pinnacle' && r.pl != null && isFinite(r.pl)) { b.pinPl += r.pl; b.pinN++; }
      if (r.surface) b.surf[r.surface] = (b.surf[r.surface] || 0) + 1;
      var y = String(r.date || '').slice(0, 4);
      if (r.level) {
        b.level[r.level] = (b.level[r.level] || 0) + 1;
        // A tournament can change tier (Munich ATP 250 -> ATP 500). The design
        // shows ONE tier, so it is the most recent one, not the most common.
        if (!b.lastLevelYear || y > b.lastLevelYear) { b.lastLevelYear = y; b.lastLevel = r.level; }
      }
    });

    // 4 · per-match enrichment. Each store is indexed on BOTH keys and the
    //     edition row asks for the strong one first. A row the edition side
    //     itself cannot key uniquely is never enriched, in either direction.
    var edRows = [];
    th.forEach(function (t) {
      (t.editions || []).forEach(function (e) {
        (e.matches || []).forEach(function (m) { edRows.push({ y: e.year, t: t.name, o: m.opp }); });
      });
    });
    var edIdx = pairIndex(edRows,
      function (r) { return r.y; }, function (r) { return r.t; }, function (r) { return r.o; });

    var chIdx = pairIndex((ch || []).filter(function (r) { return r && r.date; }),
      function (r) { return String(r.date).slice(0, 4); },
      function (r) { return r.tournament; },
      function (r) { return r.opponent; });
    // The market shard's event vocabulary is its own, so its rows are indexed
    // under the tournamentHistory name step 2 assigned them, not under `event`.
    var mkTagged = mrows.map(function (r, i) {
      return { r: r, ev: owner[i] || r.event };
    });
    var mkIdx = pairIndex(mkTagged,
      function (x) { return String(x.r.date || '').slice(0, 4); },
      function (x) { return x.ev; },
      function (x) { return x.r.opp; });
    var rfIdx = pairIndex(ledgerRows(p),
      function (x) { return String(x.m.date || '').slice(0, 4); },
      function (x) { return x.m.tournament; },
      function (x) { return x.m.opponent; });

    // Resolve one edition row against one store: strong key if unique on both
    // sides, else the weak key if unique on both sides, else nothing.
    function pick(idx, ke, ky) {
      if (edIdx.byEvent[ke] && idx.byEvent[ke]) return idx.byEvent[ke];
      if (edIdx.byYear[ky] && idx.byYear[ky]) return idx.byYear[ky];
      return null;
    }

    var enrich = {};
    var joinStats = { rows: 0, strong: 0, weak: 0, none: 0 };
    edRows.forEach(function (r) {
      var ke = ekey(r.y, r.t, r.o), ky = tkey(r.y, r.o);
      var e = enrich[ke] = enrich[ke] || {};
      joinStats.rows++;
      var got = false;

      var c = pick(chIdx, ke, ky);
      if (c) {
        e.date = c.date; e.surface = c.surface || null; e.level = c.level || null;
        e.sheetId = c.date + '|' + (c.opponent || '');
        got = true;
      }

      var mx = pick(mkIdx, ke, ky);
      if (mx) {
        var mrow = mx.r;
        if (!e.date) e.date = mrow.date;
        if (!e.surface) e.surface = mrow.surface || null;
        e.price = mrow.price != null ? mrow.price : null;
        e.oppPrice = mrow.oppPrice != null ? mrow.oppPrice : null;
        e.book = mrow.book || null;
        e.sheetId = mrow.date + '|' + (mrow.opp || '');
        got = true;
      }

      var x = pick(rfIdx, ke, ky);
      if (x) {
        var m = x.m;
        e.date = m.date || e.date;
        if (m.surface) e.surface = String(m.surface);
        e.setScores = setScoreText(m, ', ');
        e.retired = !!m.retired; e.walkover = !!m.walkover;
        // recentForm is the ledger's own price join and outranks the shard: it
        // is the one place a price is chosen (correction-pass item 19).
        if (x.price != null) { e.price = x.price; e.oppPrice = x.oppPrice; e.book = x.book; }
        e.sheetId = m.date + '|' + (m.opponent || '');
        got = true;
      }

      if (!got) joinStats.none++;
      else if (edIdx.byEvent[ke] && (chIdx.byEvent[ke] || mkIdx.byEvent[ke] || rfIdx.byEvent[ke])) joinStats.strong++;
      else joinStats.weak++;
    });

    var out = { agg: agg, enrich: enrich, alias: alias, marketRows: mrows.length,
                marketAssigned: owner.filter(Boolean).length, joinStats: joinStats,
                hasMarket: !!mk, hasCareerHistory: !!ch };
    tournJoin._k = p.key; tournJoin._mk = mk; tournJoin._ch = ch; tournJoin._v = out;
    return out;
  }

  // ─── display names (item 10) ───────────────────────────────────────────────
  // The design writes "Roland Garros", "Cincinnati Masters 1000", "Indian Wells
  // Masters 1000", "Estoril ATP 250" — a COMMON event name plus its tier, and no
  // tier on a Slam. Our feed already stores city names, so the map below holds
  // only the names that genuinely differ; everything else falls through to the
  // feed name (item 10: "unknown -> feed name, logged").
  //
  // ⚠️ It deliberately does NOT merge the feed's fragmented pairs ("Indian Wells"
  // / "Indian Wells Masters", "Rome" / "Rome Masters"). Those are two rows in the
  // store with two different W-L records; collapsing them by name would change a
  // published number on a guess. See the report — they are listed with counts.
  var EVENT_DISPLAY = { 'French Open': 'Roland Garros' };
  var EVENT_DISPLAY_UNKNOWN = {};
  var SLAM_NAMES = { 'Australian Open': 1, 'French Open': 1, 'Roland Garros': 1,
                     'Wimbledon': 1, 'US Open': 1 };
  function tournDisplayName(name, level) {
    var base = EVENT_DISPLAY[name];
    if (!base) { EVENT_DISPLAY_UNKNOWN[name] = true; base = String(name || ''); }
    if (!level || level === 'Grand Slam') return base;
    // "Rome Masters" already carries the tier word; appending "Masters 1000"
    // would read as a stutter. The bare "Rome" row takes the suffix.
    if (/\b(Masters|Finals)$/.test(base)) return base;
    return base + ' ' + level;
  }
  function isSlamTourn(name, level) {
    return level === 'Grand Slam' || !!SLAM_NAMES[name];
  }

  // §9 win-rate colour in tables: >= 55% accent, otherwise neutral value.
  function winRateColour(won, lost) {
    var n = (won || 0) + (lost || 0);
    var g = gateFor(n);
    if (g === GATE.NONE || g === GATE.THIN) return DASH_COLOUR;
    if (g === GATE.SMALL) return '#5b6880';
    return (100 * won / n) >= 55 ? '#5b9bff' : '#c6ccdb';
  }

  // One row per edition match, enriched and ordered newest-first. The stored
  // order is draw order (R128 -> F); the design lists the most recent match
  // first, so rows sort on ROUND DEPTH, which is chronological within a knockout
  // draw and does not depend on a date we may not hold.
  function tournEditionRows(p, t) {
    var j = tournJoin(p);
    return (t.editions || []).map(function (e) {
      var ms = (e.matches || []).map(function (m, i) {
        var x = j.enrich[ekey(e.year, t.name, m.opp)] || {};
        var nm = normaliseEdition(m);
        var code = qualifyingCode(m.round) || roundOfN(m.round) || String(m.round || '');
        return {
          year: e.year, res: m.res, won: m.res === 'W', opp: m.opp || null,
          round: code, rawRound: m.round || null, order: i,
          depth: CODE_N[code] != null ? CODE_N[code] : 999,
          sets: nm.oriented ? (nm.subjSets + ' - ' + nm.oppSets) : null,
          rawSets: nm.raw || null, oriented: nm.oriented,
          totalSets: nm.oriented ? (nm.subjSets + nm.oppSets) : null,
          qualifying: !!qualifyingCode(m.round),
          date: x.date || null, surface: x.surface || null,
          setScores: x.setScores || null,
          price: x.price != null ? x.price : null,
          oppPrice: x.oppPrice != null ? x.oppPrice : null,
          book: x.book || null, sheetId: x.sheetId || null,
          retired: !!x.retired, walkover: !!x.walkover
        };
      });
      ms.sort(function (a, b) {
        if (a.depth !== b.depth) return a.depth - b.depth;    // F first
        return b.order - a.order;
      });
      var w = 0, l = 0;
      ms.forEach(function (m) { if (m.res === 'W') w++; else if (m.res === 'L') l++; });
      return { year: e.year, finish: e.finish || null, won: w, lost: l, matches: ms };
    }).sort(function (a, b) { return Number(b.year) - Number(a.year); });
  }

  // The per-tournament view every column and tile reads, so the list row and its
  // open detail cannot disagree.
  function tournViews(p) {
    var j = tournJoin(p);
    return (p.tournamentHistory || []).map(function (t) {
      var eds = tournEditionRows(p, t);
      // §4: "Tournament W-L = sum of its listed editions". Recomputed from the
      // edition rows rather than trusting the stored pair — measured across the
      // whole roster, all 9,419 tournament rows agree, and this keeps it so.
      var w = 0, l = 0, n = 0;
      eds.forEach(function (e) { w += e.won; l += e.lost; n += e.matches.length; });
      var b = j.agg[t.name] || null;
      var level = b && b.lastLevel ? b.lastLevel : null;
      var surf = null, best = 0;
      if (b) Object.keys(b.surf).forEach(function (s) { if (b.surf[s] > best) { best = b.surf[s]; surf = s; } });
      // A tournament the market shard never reached still has a surface if any
      // of its matches carried one through career-history.
      if (!surf) {
        var votes = {};
        eds.forEach(function (e) { e.matches.forEach(function (m) {
          if (m.surface) votes[m.surface] = (votes[m.surface] || 0) + 1; }); });
        Object.keys(votes).forEach(function (s) { if (votes[s] > best) { best = votes[s]; surf = s; } });
      }
      var bestYears = (t.bestYears || []).slice().sort(function (a, c) { return c - a; });
      return {
        name: t.name,
        display: tournDisplayName(t.name, level),
        level: level,
        surface: surf ? surf.charAt(0).toUpperCase() + surf.slice(1).toLowerCase() : null,
        won: w, lost: l, n: n,
        storedWon: t.won || 0, storedLost: t.lost || 0,
        reconciles: w === (t.won || 0) && l === (t.lost || 0),
        // item 8 — the best result carries the year of its most recent edition.
        best: t.bestResult ? (bestYears.length ? t.bestResult + ' ' + bestYears[0] : t.bestResult) : null,
        titles: t.titles || 0,
        lastYear: eds.length ? eds[0].year : (t.lastYear || null),
        editions: eds,
        pinPl: b && b.pinN ? b.pinPl : null,
        pinN: b ? b.pinN : 0,
        isSlam: isSlamTourn(t.name, level)
      };
    }).sort(function (a, b) { return b.n - a.n; });
  }

  // Over 3.5 sets (item 15): best-of-5 COMPLETED main-draw matches only.
  // Retirements and walkovers are excluded where a flag exists, and Slam
  // qualifying is best-of-3 so it is excluded outright. A match whose stored
  // score would not orient has no set count and is not counted either way — it
  // reduces M, it never quietly lands in the "under" bucket.
  function over35Of(views) {
    var over = 0, tot = 0, unknown = 0;
    views.forEach(function (v) {
      v.editions.forEach(function (e) {
        e.matches.forEach(function (m) {
          if (m.qualifying || m.retired || m.walkover) return;
          if (m.totalSets == null) { unknown++; return; }
          tot++;
          if (m.totalSets >= 4) over++;
        });
      });
    });
    return { over: over, tot: tot, unknown: unknown, pct: tot ? 100 * over / tot : null };
  }

  // §5.3 Record per tournament — rebuilt to `Player Stat Boxes.dc.html`:475-541
  // (markup) and :2323-2430 (the row/tile model). Every length, colour and grid
  // track below is the file's own inline style.
  function renderTournModal(p) {
    var views = tournViews(p);
    var q = String(state.tournQuery || '').toLowerCase();
    var shown = q
      ? views.filter(function (t) {
          return t.display.toLowerCase().indexOf(q) >= 0 || t.name.toLowerCase().indexOf(q) >= 0;
        })
      : views;

    var GRID = 'display:grid;grid-template-columns:minmax(0,1.6fr) 74px 96px 56px 52px 58px;gap:0 14px;' +
      'align-items:center;';
    var HEAD = [['Tournament', 'left'], ['Surface', 'left'], ['Best result', 'left'],
                ['W' + ENDASH + 'L', 'right'], ['Win%', 'right'], ['Backing', 'right']];
    var head = '<div style="' + GRID + 'padding:14px 10px 0;">' +
      HEAD.map(function (h) {
        return '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:0.1em;' +
          'text-transform:uppercase;color:#4b5672;text-align:' + h[1] + ';padding-bottom:9px;">' +
          esc(h[0]) + '</span>';
      }).join('') + '</div>';

    var rows = shown.map(function (t) {
      var open = state.tournOpen === t.name;
      var pin = t.pinN ? t.pinPl : null;
      return '<div style="flex:none;">' +
        '<div class="pp2-trow" data-pp2="tourn-row" data-t="' + esc(t.name) + '" style="' + GRID +
          'padding:11px 10px;cursor:pointer;border-top:1px solid rgba(255,255,255,0.06);' +
          'background:' + (open ? 'rgba(91,155,255,0.1)' : 'transparent') + ';">' +
          '<span style="font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis;">' + esc(t.display) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;' +
            'white-space:nowrap;">' + (t.surface ? esc(t.surface) : DASH) + '</span>' +
          '<span style="font-size:12px;color:#8b96b5;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis;">' + (t.best ? esc(t.best) : DASH) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;' +
            'text-align:right;white-space:nowrap;">' + recordText(t.won, t.lost) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;text-align:right;' +
            'white-space:nowrap;color:' + winRateColour(t.won, t.lost) + ';">' +
            rateText0(t.won, t.lost) +
            (gateFor(t.n) === GATE.SMALL
              ? ' <span style="font-size:9px;color:' + DASH_COLOUR + ';">small</span>' : '') + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;text-align:right;' +
            'white-space:nowrap;color:' + (pin == null ? DASH_COLOUR : pin >= 0 ? '#3dd68c' : '#e0616f') + ';">' +
            (pin == null ? DASH : signed(pin, 1, 'u')) + '</span>' +
        '</div>' +
        (open ? renderTournDetail(p, t) : '') +
        '</div>';
    }).join('');

    var j = tournJoin(p);
    return '' +
      '<div style="font-size:13.5px;color:#5b6880;margin-bottom:16px;line-height:1.5;">Search a ' +
        'tournament to see ' + esc(possessive(shortName(p))) + ' full career win' + ENDASH +
        'loss record there.</div>' +
      '<label style="display:flex;align-items:center;gap:12px;background:#06070a;' +
        'border:1px solid rgba(255,255,255,0.09);border-radius:12px;padding:14px 18px;">' +
        '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" style="flex:none;">' +
          '<circle cx="9" cy="9" r="6" stroke="#5b6880" stroke-width="1.7"></circle>' +
          '<path d="m14 14 3 3" stroke="#5b6880" stroke-width="1.7" stroke-linecap="round"></path></svg>' +
        '<input type="search" data-pp2="tourn-search" value="' + esc(state.tournQuery || '') + '" ' +
          'placeholder="Search a tournament..." style="flex:1;background:transparent;border:0;' +
          'outline:none;font-family:inherit;font-size:14px;color:#e7e9ee;min-width:0;"></label>' +
      head +
      '<div style="max-height:calc(100vh - 250px);min-height:420px;overflow-y:auto;display:flex;' +
        'flex-direction:column;">' +
        (shown.length ? rows :
          '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
          'text-align:center;font-size:13px;color:#5b6880;">No tournament matches that search.</div>') +
      '</div>' +
      '<div style="font-size:11px;color:#5b6880;margin-top:14px;line-height:1.6;">' +
        'Each W' + ENDASH + 'L is the sum of the editions listed beneath it. Backing is a flat 1u ' +
        'stake at the Pinnacle closing price, so an event Pinnacle never priced shows a dash rather ' +
        'than a zero' + (j.hasMarket ? '' : ' (the price shard has not loaded)') + '. ' +
        'This block is the tournament record we hold per event and does not sum to the career ' +
        'total above ' + MIDDOT + ' it carries only events with stored edition detail.</div>';
  }

  function tile(cap, value, sub, colour) {
    return '<div style="background:#0a0d14;border:1px solid rgba(255,255,255,0.09);border-radius:11px;' +
      'padding:14px 15px;display:flex;flex-direction:column;align-items:center;text-align:center;' +
      'gap:8px;min-width:0;">' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.12em;text-transform:uppercase;color:#5b6880;">' + esc(cap) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:23px;font-weight:700;' +
        'line-height:1.05;color:' + (colour || '#fff') + ';overflow:hidden;text-overflow:ellipsis;">' +
        value + '</span>' +
      '<span style="font-size:10.5px;color:#4b5672;">' + esc(sub == null ? '' : sub) + '</span>' +
      '</div>';
  }

  function renderTournDetail(p, t) {
    var views = tournViews(p);
    var n = 0;
    t.editions.forEach(function (e) { n += e.matches.length; });

    // ── the five tiles, from the FILE (:2381-2418) ──────────────────────────
    // README §5.3 gives a DIFFERENT non-Slam set ("Titles won", "Win rate");
    // the file's is W-L record / Best result / Sets won / Last played / Backing
    // him here. README §Fidelity makes the file the authority, so the file wins
    // and the difference is in the report.
    var pinTxt = t.pinN ? signed(t.pinPl, 1, 'u') : DASH;
    var pinColour = !t.pinN ? DASH_COLOUR : t.pinPl >= 0 ? '#3dd68c' : '#e0616f';
    // The file's fifth-tile sub is "+3.4pt vs market" — a prototype constant
    // with no formula anywhere in the export. §3 forbids inventing one, so the
    // sub states the priced count instead (item 12: "partly priced -> keep the
    // figure and add the priced count in the detail").
    // Deliberately NOT "N of M priced": the priced count comes from the market
    // shard and M from the edition list, and the two stores do not agree on how
    // many matches an event held (Zverev's Australian Open: 46 shard rows, 42
    // edition rows). Printing them as a fraction would invent a shortfall.
    var pinSub = t.pinN
      ? t.pinN + ' priced ' + MIDDOT + ' Pinnacle closing'
      : 'Pinnacle priced none of these';
    var backTile = tile('Backing him here', pinTxt, pinSub, pinColour);
    var wlTile = tile('W' + ENDASH + 'L record', recordText(t.won, t.lost),
      rateText0(t.won, t.lost) + ' ' + MIDDOT + ' main draw');

    var tiles;
    if (t.isSlam) {
      var slams = views.filter(function (v) { return v.isSlam; });
      var sw = 0, sl = 0;
      slams.forEach(function (v) { sw += v.won; sl += v.lost; });
      var here = over35Of([t]);
      var all = over35Of(slams);
      var oOver = all.over - here.over, oTot = all.tot - here.tot;
      var oPct = oTot ? 100 * oOver / oTot : null;
      var gap = (here.pct != null && oPct != null) ? here.pct - oPct : null;
      tiles = [
        wlTile,
        tile('Grand Slam career', recordText(sw, sl),
          rateText0(sw, sl) + ' ' + MIDDOT + ' ' + slams.length +
          (slams.length === 1 ? ' major' : ' majors') + ' on record'),
        tile('Over 3.5 sets ' + MIDDOT + ' this event',
          here.pct == null ? DASH : Math.round(here.pct) + '%',
          here.tot ? here.over + ' of ' + here.tot + ' matches went over'
                   : 'no completed match with a readable score'),
        tile('Over 3.5 sets ' + MIDDOT + ' other majors',
          oPct == null ? DASH : Math.round(oPct) + '%',
          oTot ? oOver + ' of ' + oTot + ' went over ' + MIDDOT + ' ' +
                 (gap == null ? DASH : signed(gap, 1, 'pp')) + ' vs this event'
               : 'no other major on record'),
        backTile
      ];
    } else {
      // The file reads its "Sets won" off the SETS string ("2 - 1"), so this
      // does the same: the subject's sets are its first half and the total is
      // both halves. A row that would not orient contributes to neither.
      var sW = 0, sT = 0;
      t.editions.forEach(function (e) { e.matches.forEach(function (m) {
        if (!m.oriented) return;
        var parts = String(m.sets).split(' - ');
        sW += Number(parts[0]); sT += m.totalSets;
      }); });
      tiles = [
        wlTile,
        tile('Best result', t.best || DASH, 'furthest here'),
        tile('Sets won', sT ? Math.round(100 * sW / sT) + '%' : DASH,
          sT ? sW + ' of ' + sT + ' sets listed' : 'no readable set count'),
        tile('Last played', t.lastYear == null ? DASH : String(t.lastYear),
          t.editions.length + (t.editions.length === 1 ? ' edition listed' : ' editions listed')),
        backTile
      ];
    }

    // ── the match grid (file :512-536) ──────────────────────────────────────
    var MGRID = 'display:grid;grid-template-columns:48px 12px minmax(0,1.1fr) 36px 40px ' +
      'minmax(0,1.3fr) 46px 46px;gap:0 10px;align-items:center;';
    var MHEAD = [['Date', 'left'], ['', 'left'], ['Opponent', 'left'], ['Rd', 'left'],
                 ['Sets', 'left'], ['Set scores', 'left'], ['H', 'right'], ['A', 'right']];
    var mhead = MHEAD.map(function (h) {
      return '<span style="position:sticky;top:0;background:#06070a;font-family:\'IBM Plex Mono\',' +
        'monospace;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#4b5672;' +
        'text-align:' + h[1] + ';padding:0 0 7px;">' + esc(h[0]) + '</span>';
    }).join('');

    var body = t.editions.map(function (e) {
      var grp = '<span style="grid-column:1 / -1;display:flex;align-items:center;gap:10px;' +
        'padding:9px 0 5px;border-top:1px solid rgba(255,255,255,0.07);">' +
        '<span style="font-size:12.5px;font-weight:700;white-space:nowrap;">' +
          esc(t.display + ' ' + e.year) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#4b5672;' +
          'white-space:nowrap;">' + esc((e.finish || DASH) + ' ' + MIDDOT + ' ' +
          recordText(e.won, e.lost)) + '</span></span>';
      return grp + e.matches.map(function (m) {
        var wl = m.won ? '#3dd68c' : '#e0616f';
        // §3: only advertise a click the sheet can actually resolve. The sheet
        // looks the row up by "date|opponent" in the ledger and then the market
        // shard, so a row neither store reached has no sheet to open.
        var hook = m.sheetId ? sheetHook(m.sheetId) : '';
        var cur = hook ? sheetCursor() : '';
        var cell = function (style, txt) {
          return '<span ' + hook + 'style="' + cur + style + '">' + txt + '</span>';
        };
        return '' +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;padding:5px 0;',
               m.date ? esc(fmtDotDate(m.date) + '.') : DASH) +
          cell('width:8px;height:8px;border-radius:2px;background:' + wl + ';', '') +
          // ⚠️ NAME FORM — the export contradicts itself and the file wins here.
          // `Player Profile.dc.html`:838 writes the LEDGER's opponent surname-
          // first ("Shelton B."), which is what correction-pass items 4/8 ruled
          // and what renderDrill still does. `Player Stat Boxes.dc.html`:2325 —
          // the file that owns this modal (README §12) and the first file in the
          // founder's own precedence order — writes it initial-first
          // ("J. Sinner"). So this block carries the feed form unchanged. The
          // page is internally inconsistent as a result; that is reported, not
          // silently reconciled in either direction.
          cell('font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 0;',
               esc(m.opp || DASH)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;padding:5px 0;',
               esc(m.round || DASH)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;color:' + wl +
               ';padding:5px 0;', m.sets ? esc(m.sets) : (m.rawSets ? esc(m.rawSets) : DASH)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8b96b5;white-space:nowrap;' +
               'padding:5px 0;', m.setScores ? esc(m.setScores) : DASH) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#c6ccdb;text-align:right;' +
               'padding:5px 0;', oddsText(m.price)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;text-align:right;' +
               'padding:5px 0;', oddsText(m.oppPrice));
      }).join('');
    }).join('');

    var priced = 0, dated = 0, scored = 0;
    t.editions.forEach(function (e) { e.matches.forEach(function (m) {
      if (m.price != null) priced++;
      if (m.date) dated++;
      if (m.setScores) scored++;
    }); });

    return '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:10px;' +
      'margin:7px 0 9px;padding:13px 15px;">' +
      '<div style="display:flex;align-items:center;gap:11px;margin-bottom:9px;">' +
        '<span style="font-size:13px;font-weight:700;white-space:nowrap;">' + esc(t.display) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8b96b5;' +
          'white-space:nowrap;flex:none;">' + esc(recordText(t.won, t.lost) + ' ' + MIDDOT + ' ' +
          rateText0(t.won, t.lost) + ' ' + MIDDOT + ' showing ' + n + ' matches') + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:4px 0 12px;">' +
        tiles.join('') + '</div>' +
      '<div style="max-height:calc(100vh - 430px);min-height:300px;overflow-y:auto;">' +
        '<div style="' + MGRID + '">' + mhead + body + '</div>' +
      '</div>' +
      '<div style="font-size:10.5px;color:#4b5672;line-height:1.5;margin-top:10px;">' +
        'Sets are oriented from ' + esc(shortName(p)) + '&#39;s side off the result, not the feed&#39;s ' +
        'listing order. Dates reach ' + dated + ' of ' + n + ' rows and prices ' + priced + ' of ' + n +
        '; set scores reach ' + scored + ' of ' + n + ' because the career shard stores a match result ' +
        'but not its per-set scores.' +
        (t.reconciles ? '' : ' The stored record for this event reads ' +
          recordText(t.storedWon, t.storedLost) + ' against ' + recordText(t.won, t.lost) +
          ' in the editions listed.') +
      '</div>' +
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

  // ─── RULING cal-1 · THE SPINE MOVED OFF THE ARCHIVE (founder, 2026-09-17) ──
  //
  // cal-0 (above) built the grid from the priced archive because it was the only
  // DATED store the run had looked at. Item 1 of the 2026-09-17 comment overrides
  // it: "GRID = CAREER MATCH ROWS ... Do NOT build the grid from the priced
  // archive." Re-measured against the deployed shards before any of this was
  // written (ten206-cal-measure.mjs):
  //
  //   careerByYear            the ruled §4 career spine. Season AGGREGATES only —
  //                           no match rows at all, so it cannot fill a month.
  //   tournamentHistory       829 edition rows for Zverev and NOT ONE carries a
  //                           date; an edition knows its YEAR and nothing finer.
  //                           A month grid cannot be built from it at any price.
  //   career-history/{key}    775 rows for Zverev, 361 for Martinez, 355 for
  //                           Krumich — and 775/775, 361/361, 355/355 carry a
  //                           full ISO date. Dated, subject-relative, every
  //                           ruled level (Zverev atp 775; Martinez atp 242 +
  //                           chitf 119). THIS is the career match-row store.
  //
  // So the grid is career-history. It is the same store §5.3 already joins for
  // its date column and the same store the match sheet already reads (item 21),
  // so no new fetch and no new join vocabulary enters the page.
  //
  // WHAT DOES NOT RECONCILE, and is disclosed rather than papered over: the
  // career match rows are FEWER than the careerByYear spine — Zverev 775 vs 819
  // (gap 44, 5.4%), Krumich 355 vs 362 (gap 7, 1.9%), Martinez 361 vs 675
  // (gap 314, 46.5%). The founder's own re-verify item (e) allows "Σ grid cells =
  // subtitle M = career total (or disclosed gap)". Item 3 fixes M as the GRID's
  // total, so M is the row count and the gap is stated under the grid. Never the
  // union of the two stores — measured, they disagree about how many matches a
  // season held, and unioning them fabricates matches (Norrie 2021: 36 vs 85).
  var CAL_SURFACES = [
    { id: 'all', label: 'All surfaces' }, { id: 'hard', label: 'Hard' },
    { id: 'clay', label: 'Clay' }, { id: 'grass', label: 'Grass' },
    { id: 'indoors', label: 'Indoors' }
  ];

  // The priced archive, dated and sorted. Since ruling cal-2 NOTHING in this
  // modal renders from it — both tabs read calSpine() — but it stays exported as
  // the negative control the spine locks compare against: a test that only knows
  // the new count cannot tell a correct spine from a coincidence, whereas one
  // that also holds the OLD count catches a silent revert.
  function calMarketRows(p) {
    var mk = marketFor(p.key);
    if (!mk || !mk.matches) return [];
    return mk.matches.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  // ── the display-name map (item 20) ────────────────────────────────────────
  // career-history's event vocabulary is its own third one: it writes "Rome
  // Masters", "Miami Masters", "ATP Indian Wells", "ATP French Open" AND
  // "Roland Garros" for events tournamentHistory calls "Rome", "Miami",
  // "Indian Wells", "French Open". The founder asked for the tournament modal's
  // name map, and tournJoin() builds one by VOTING a tournamentHistory name per
  // foreign event name off the (year, opponent-surname) join. Same method here,
  // same per-player scope — an alias proven on one player's history can never
  // leak into another's. Measured: Zverev 763/775 rows named (98.5%), Martinez
  // 270/361 (74.8%). A row the vote cannot name keeps its own cleaned name
  // rather than a guess.
  function calNameMap(p) {
    var th = p.tournamentHistory || [];
    var owner = {};
    th.forEach(function (t) {
      (t.editions || []).forEach(function (e) {
        (e.matches || []).forEach(function (m) {
          var k = tkey(e.year, m.opp);
          if (!Object.prototype.hasOwnProperty.call(owner, k)) owner[k] = t.name;
          else if (owner[k] !== t.name) owner[k] = null;
        });
      });
    });
    // The vote key must be unambiguous on BOTH sides, not just on the
    // tournamentHistory side. Caught by the CDP read-back, not by the suite:
    // Zverev met Hurkacz twice in 2026 — United Cup in January and Halle in
    // June — so (2026, hurkacz) named two events, tournamentHistory happened to
    // own it as "Halle", and the January United Cup rows were rendering under a
    // June grass event. One wrong name is fabrication, so an ambiguous key now
    // votes for nothing and the row falls back to its own cleaned name.
    var chRows = (careerHistoryFor(p.key) || []).filter(function (r) { return r && r.date; });
    var chCount = {};
    chRows.forEach(function (r) {
      var k = tkey(String(r.date).slice(0, 4), r.opponent);
      chCount[k] = (chCount[k] || 0) + 1;
    });
    var votes = {};
    chRows.forEach(function (r) {
      var k = tkey(String(r.date).slice(0, 4), r.opponent);
      if (chCount[k] !== 1) return;
      var o = owner[k];
      if (!o) return;
      var v = votes[r.tournament] = votes[r.tournament] || {};
      v[o] = (v[o] || 0) + 1;
    });
    var out = {};
    Object.keys(votes).forEach(function (ev) {
      var v = votes[ev];
      out[ev] = Object.keys(v).sort(function (a, b) { return v[b] - v[a]; })[0];
    });
    return out;
  }
  // The fallback for an unvoted name: strip the prefixes and suffixes the store
  // itself appends. This is a DISPLAY cleanup on one string, never a merge — no
  // two rows are pooled because of it, so no published W-L can move.
  function calEventClean(name) {
    var s = String(name || '').trim();
    var i = s.indexOf(' - ');
    if (i > 0) s = s.slice(0, i);
    s = s.replace(/^(ATP|WTA|ITF)\s+/i, '');
    s = s.replace(/\s+(Challenger(\s+Men)?|Masters)$/i, '');
    return s || null;
  }

  // ── the priced join (item 2) ──────────────────────────────────────────────
  // §5's book rule, unchanged: PINNACLE CLOSING ONLY. A bet365 row is a
  // pre-match snapshot and is never blended into a yield, so it is not consulted
  // here at all. Three key tiers, each requiring uniqueness on BOTH sides, so an
  // ambiguous pair is dropped rather than resolved by picking one (§3):
  //   1. (date, surname)              both stores are dated   Zverev 348
  //   2. (year, eventKey, surname)    the §5.3 strong key     Zverev  +79
  //   3. (year, surname)              the §5.3 weak fallback  Zverev  +70
  // 497 of 775 rows priced for Zverev (64.1%), 168 of 361 for Martinez (46.5%),
  // 0 of 355 for Krumich — a Challenger-only career the ATP-main-draw archive
  // never covers, which is exactly why the yield layer has to be able to dash
  // while the grid still renders in full.
  // ─── RULING-FREE FACT, item 26: career-history dates are TOURNAMENT-START ──
  // dates before 2021, not match dates. Measured on Zverev's 775 rows, the
  // weekday of `date` by season:
  //     2016  66 of 68 Monday      2019  65 of 69 Monday
  //     2017  72 of 79 Monday      2020  35 of 39 Monday
  //     2018  73 of 79 Monday      2021+ uniform across all seven weekdays
  // market-edge (Tennis-Data) carries the real match date throughout. So the
  // exact-date tier CANNOT fire for any pre-2021 match, which is exactly the
  // era the founder flagged: St. Petersburg 2016 reads 2016-09-19 in the spine
  // (the Monday) against 2016-09-23 / 09-24 in the archive. The (year, event)
  // tier then misses too because the two stores name events differently
  // ("St. Petersburg" vs "St. Petersburg Open", "Beijing" vs "China Open",
  // "Nice" vs "Open de Nice Cote d'Azur"), and the (year, surname) fallback is
  // ambiguous whenever the pair met twice in a season. Hence Youzhny, Berdych,
  // Thiem and Sock all dashed inside one seven-match run.
  //
  // The fix is a DATE-WINDOW tier, and it keeps §3's refusal posture: a pairing
  // is taken only when it is unique from BOTH sides inside the window.
  //   tier 4  +/- 7 days,  no tie-break
  //   tier 5  +/- 14 days, ties broken on round CLASS (F / SF / QF / RR only —
  //           numbered rounds are NOT comparable across draw sizes, R32 is the
  //           "3rd Round" at a Masters and the "2nd Round" at a 250)
  // Validated against market-edge's own `won` column, which the join never
  // reads: 602 of 602 joined rows agree on the result for Zverev, 168 of 168
  // for Martinez. Zero mismatches at any window we measured.
  // Zverev ATP main draw inside the archive's range: 490/657 -> 602/657.
  var JOIN_WIN_1 = 7, JOIN_WIN_2 = 14;
  function dayNum(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var t = Date.parse(s + 'T00:00:00Z');
    return isFinite(t) ? Math.round(t / 86400000) : null;
  }
  /** F / SF / QF / RR, or null where the label is a numbered round. */
  function roundClass(label) {
    var t = String(label || '').toLowerCase().replace(/[\s-]/g, '');
    if (t.indexOf('roundrobin') >= 0 || t === 'rr') return 'RR';
    if (t.indexOf('semi') >= 0) return 'SF';
    if (t.indexOf('quarter') >= 0 || t.indexOf('1/4') >= 0 || t === 'qf') return 'QF';
    if (t === 'f' || t === 'final' || t === 'thefinal') return 'F';
    return null;
  }
  function bySurname(list, nameOf) {
    var m = {};
    for (var i = 0; i < list.length; i++) {
      var k = oppKeyOf(nameOf(list[i]));
      if (!m[k]) m[k] = [];
      m[k].push(list[i]);
    }
    return m;
  }
  function calSpine(p) {
    var ch = careerHistoryFor(p.key);
    var mk = marketFor(p.key);
    if (calSpine._k === p.key && calSpine._ch === ch && calSpine._mk === mk && calSpine._v) {
      return calSpine._v;
    }
    var alias = calNameMap(p);
    var rows = (ch || []).filter(function (r) {
      return r && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date);
    });
    var mrows = (mk && mk.matches) || [];
    function evOf(r) { return alias[r.tournament] || calEventClean(r.tournament); }
    var mkByDate = pairKeyIndex(mrows, function (r) { return r.date + '|' + oppKeyOf(r.opp); });
    var mkByEv = pairKeyIndex(mrows, function (r) {
      return ekey(String(r.date).slice(0, 4), alias[r.event] || r.event, r.opp);
    });
    var mkByYear = pairKeyIndex(mrows, function (r) { return tkey(String(r.date).slice(0, 4), r.opp); });
    var spByDate = pairKeyIndex(rows, function (r) { return r.date + '|' + oppKeyOf(r.opponent); });
    var spByEv = pairKeyIndex(rows, function (r) { return ekey(String(r.date).slice(0, 4), evOf(r), r.opponent); });
    var spByYear = pairKeyIndex(rows, function (r) { return tkey(String(r.date).slice(0, 4), r.opponent); });
    // recentForm is the only per-set score source we hold (66 of Zverev's 775
    // rows, 54 of Martinez's 361), so the drill's SCORE column falls back to the
    // store's own sets-score string and dashes when neither holds anything.
    var rfByDate = pairKeyIndex(ledgerMatches(p).filter(function (m) { return m && m.date; }),
      function (m) { return m.date + '|' + oppKeyOf(m.opponent); });

    // Tiers 4 + 5 run as a pre-pass so the windows can see every spine row at
    // once — a window tier needs both populations, not one row at a time. The
    // result is a plain index -> market-row map consulted after the three
    // exact-key tiers fail.
    var win = calWindowJoin(rows, mrows);

    var out = rows.map(function (r, ri) {
      var y = String(r.date).slice(0, 4);
      var kd = r.date + '|' + oppKeyOf(r.opponent);
      var ke = ekey(y, evOf(r), r.opponent);
      var ky = tkey(y, r.opponent);
      var hit = null;
      if (spByDate[kd] && mkByDate[kd]) hit = mkByDate[kd];
      else if (spByEv[ke] && mkByEv[ke]) hit = mkByEv[ke];
      else if (spByYear[ky] && mkByYear[ky]) hit = mkByYear[ky];
      else if (win[ri]) hit = win[ri];
      var pin = (hit && hit.book === 'pinnacle' && hit.price != null &&
        hit.pl != null && isFinite(hit.pl)) ? hit : null;
      var rf = rfByDate[kd] || null;
      return {
        date: r.date, year: y, mon: parseInt(r.date.slice(5, 7), 10) - 1,
        won: !!r.won,
        surface: r.surface ? String(r.surface).toLowerCase() : null,
        court: hit ? (hit.court || null) : null,
        event: evOf(r),
        // §8.17 · the REAL tier, and only the real one. career-history's own
        // `level` column holds 'atp'/'chitf' — a feed scope, not a tour tier — and
        // the founder's rule is explicit that it must never stand in for one. The
        // archive row carries the genuine tier ("Masters 1000", "Grand Slam",
        // "ATP 500"), so the level travels with the JOIN and is null wherever the
        // join did not land. A group row then prints its surface alone rather than
        // inventing a tier for it.
        level: hit ? (hit.level || null) : null,
        // The raw feed name, kept beside the display name because the court-speed
        // dictionary is keyed on what the STORE says ("ATP Cincinnati"), while
        // `event` is the aliased display name ("Cincinnati"). Resolving on both is
        // what closes the last 1.7pp of Zverev's spine.
        tournament: r.tournament || null,
        round: roundLabel({ round: r.round, date: r.date, tournament: r.tournament }),
        opp: r.opponent || null,
        score: rf ? setScoreText(rf, ', ') : (r.result ? String(r.result) : DASH),
        // §8.4 · SETS, from the player's own side. career-history's `result` is
        // already subject-oriented, and 88,097 of 89,719 rows (98.2%) are a clean
        // two-integer count agreeing with `won`. This is the column that read "—"
        // on every row of the live screenshot, and filling it needed no pipeline
        // change at all.
        //
        // "0 - 0" is excluded, and only "0 - 0": all 428 such rows carry the
        // walkover or retired flag, so the string means "no set was played" rather
        // than "he lost every set". Printing it would invent a 0-0 scoreline for a
        // match that never started.
        //
        // Counts that TIE ("1 - 1") or contradict `won` ("1 - 0" on a loss) are
        // KEPT. They look wrong and are not: 485 of 521 ties and 107 of 123
        // contradictions are retirements, where the set count genuinely does not
        // decide the match. The colour keys off `won`, never off the count, so a
        // retirement still reads red for the player who retired.
        sets: (function () {
          var mm = String(r.result || '').match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
          if (!mm) return null;
          if (+mm[1] === 0 && +mm[2] === 0) return null;
          return String(r.result);
        }()),
        retired: !!r.retired,
        price: pin ? pin.price : null,
        oppPrice: pin ? (pin.oppPrice != null ? pin.oppPrice : null) : null,
        // Integer cents: a float sum re-ordered moved a painted card by 0.01u
        // once already, so every P&L here is accumulated in whole cents and
        // divided only at the point it is printed.
        cents: pin ? Math.round(pin.pl * 100) : null,
        // Item 27 · WALKOVERS. career-history carries no walkover flag; the one
        // marker it has is an EMPTY result string (" - ") where no set was ever
        // played. recentForm does carry `walkover`, so it is preferred wherever
        // the ±0-day join reaches (66 of Zverev's 775 rows). Either signal sets
        // this flag; calRuns() then applies the founder's ruling — a walkover
        // RECEIVED is a win and stays in the sequence, a walkover GIVEN is
        // neither and is stepped over without breaking the run.
        wo: !!(rf && rf.walkover) || !/\d/.test(String(r.result || '')),
        sheetId: r.date + '|' + (r.opponent || '')
      };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    calSpine._k = p.key; calSpine._ch = ch; calSpine._mk = mk; calSpine._v = out;
    return out;
  }
  /**
   * Tiers 4 + 5 of the odds join (item 26). Returns { spineIndex: marketRow }.
   *
   * Both passes require the pairing to be unique from BOTH directions inside
   * the window, which is the same refusal §3 already imposes on the exact-key
   * tiers — an ambiguous pair is dropped, never resolved by picking one. Pass 2
   * widens the window and is allowed ONE tie-break: round class, and only the
   * four labels that mean the same thing at every draw size.
   *
   * A market row claimed by pass 1 is off the table for pass 2 (`taken`), so
   * the wider window cannot re-use a price that already belongs to a match.
   */
  function calWindowJoin(rows, mrows) {
    var out = {}, taken = {};
    var mBy = bySurname(mrows, function (r) { return r.opp; });
    var sBy = bySurname(rows, function (r) { return r.opponent; });
    function pass(win, useRound) {
      for (var i = 0; i < rows.length; i++) {
        if (out[i]) continue;
        var r = rows[i], d = dayNum(r.date);
        if (d == null) continue;
        var sn = oppKeyOf(r.opponent);
        var cands = (mBy[sn] || []).filter(function (m, mi) {
          var md = dayNum(m.date);
          return md != null && Math.abs(md - d) <= win && !taken[sn + '#' + mi];
        });
        if (!cands.length) continue;
        // Back-check: which spine rows could also claim these candidates?
        var back = (sBy[sn] || []).filter(function (q) {
          var qd = dayNum(q.date);
          if (qd == null) return false;
          for (var c = 0; c < cands.length; c++) {
            var cd = dayNum(cands[c].date);
            if (cd != null && Math.abs(cd - qd) <= win) return true;
          }
          return false;
        });
        if (useRound && cands.length > 1) {
          var rc = roundClass(r.round);
          if (rc) {
            cands = cands.filter(function (m) { return roundClass(m.round) === rc; });
            back = back.filter(function (q) { return roundClass(q.round) === rc; });
          }
        }
        if (cands.length === 1 && back.length === 1) {
          out[i] = cands[0];
          var list = mBy[sn] || [];
          for (var k = 0; k < list.length; k++) if (list[k] === cands[0]) taken[sn + '#' + k] = true;
        }
      }
    }
    pass(JOIN_WIN_1, false);
    pass(JOIN_WIN_2, true);
    return out;
  }

  // One value per key; a key seen twice is poisoned to null so neither side can
  // claim it. Same posture as pairIndex(), on a single key rather than two.
  function pairKeyIndex(list, keyOf) {
    var m = {};
    for (var i = 0; i < list.length; i++) {
      var k = keyOf(list[i]);
      if (Object.prototype.hasOwnProperty.call(m, k)) m[k] = null;
      else m[k] = list[i];
    }
    return m;
  }
  function calSpineFiltered(p) {
    var rows = calSpine(p);
    var s = state.calSurface || 'all';
    if (s === 'all') return rows;
    // Indoors is a COURT TYPE, not a surface, and career-history carries no
    // court column — the §5.2 drill already refuses an Indoors drill for exactly
    // this reason ("no per-match court type on record"). Filling it from the
    // priced join instead would show 497 of 775 rows under a heading that claims
    // all of them, and would break Σ cells = M. So the segment renders its own
    // empty state and says why, matching the ruled §5.2 behaviour.
    if (s === 'indoors') return [];
    return rows.filter(function (r) { return r.surface === s; });
  }
  function calScope(p) {
    var rows = calSpine(p);
    return {
      n: rows.length,
      m: spineTotal(p).n,
      from: rows.length ? rows[0].year : null,
      to: rows.length ? rows[rows.length - 1].year : null,
      priced: rows.filter(function (r) { return r.cents != null; }).length
    };
  }

  // Year x month buckets over the filtered rows. `n`/`won`/`lost` count the
  // CAREER rows (item 1); `cents`/`priced` count only the Pinnacle subset
  // (item 2), so one cell carries both scopes without conflating them.
  function calGrid(rows) {
    var years = {};
    rows.forEach(function (r) {
      if (!years[r.year]) {
        years[r.year] = [];
        for (var i = 0; i < 12; i++) years[r.year].push({ won: 0, lost: 0, cents: 0, priced: 0 });
      }
      var c = years[r.year][r.mon];
      c[r.won ? 'won' : 'lost']++;
      if (r.cents != null) { c.cents += r.cents; c.priced++; }
    });
    return Object.keys(years).sort(function (a, b) { return b < a ? -1 : 1; })
      .map(function (y) { return { year: y, cells: years[y] }; });
  }

  // Per-calendar-month totals pooled across seasons plus the design's three
  // derived figures, each quoted from `Player Stat Boxes.dc.html`:
  //   yield      :2188  MY[i] = CAREER_Y + PP[i]        month yield, priced rows
  //   gap        :2191  DELTA = MY[i] - OTHER[i]        vs the OTHER ELEVEN
  //   pp         :2188  PP[i] = MY[i] - CAREER_Y        vs his OWN career yield
  //   consistent :2215  seasons in which t[0] > t[1]; a season with no matches
  //                     that month counts as NOT above
  // The footer's "VS OTHER MONTHS" row is DELTA and the tiles are PP — the file
  // uses two different baselines and they are not interchangeable.
  function calMonths(rows) {
    var grid = calGrid(rows);
    var out = [];
    for (var m = 0; m < 12; m++) out.push({ m: m, won: 0, lost: 0, cents: 0, priced: 0, above: 0 });
    grid.forEach(function (yr) {
      yr.cells.forEach(function (c, m) {
        out[m].won += c.won; out[m].lost += c.lost;
        out[m].cents += c.cents; out[m].priced += c.priced;
        if (c.won + c.lost > 0 && c.won > c.lost) out[m].above++;
      });
    });
    var totalP = 0, totalC = 0;
    out.forEach(function (x) { totalP += x.priced; totalC += x.cents; });
    // Mean P&L in whole cents per priced match. That number IS the yield in
    // percent — mean(pl) x 100 — which is why nothing is multiplied by 100
    // below and why the design's `plPct = plTot / n * 100` is the same figure.
    var careerY = totalP ? totalC / totalP : null;
    out.forEach(function (x) {
      x.n = x.won + x.lost;
      x.seasons = grid.length;
      x.yield = x.priced ? x.cents / x.priced : null;
      var on = totalP - x.priced;
      var other = on ? (totalC - x.cents) / on : null;
      x.gap = (x.yield == null || other == null) ? null : x.yield - other;
      x.pp = (x.yield == null || careerY == null) ? null : x.yield - careerY;
    });
    return { months: out, seasons: grid.length, grid: grid, priced: totalP, careerY: careerY };
  }

  // ── the tile metrics (item 7), transcribed from :2243-2268 ────────────────
  //   const win = (start, len) => {
  //     const idx = []; for (let k = 0; k < len; k++) idx.push((start + k) % 12);
  //     const nSum = idx.reduce((s, i) => s + N[i], 0);
  //     const d = nSum ? idx.reduce((s, i) => s + N[i] * PP[i], 0) / nSum : 0;
  //     let seasonsUp = 0;
  //     cells.forEach(row => { ... if (t[0] > t[1]) seasonsUp++; });
  //     return { label: MON[idx[0]] + '–' + MON[idx[len-1]], n: nSum, d, up: seasonsUp };
  //   };
  //   for (let len = 2; len <= 3; len++) for (let s = 0; s < 12; s++) WINS.push(win(s, len));
  //   const okWins = WINS.filter(w => w.n >= 10).sort((x, y) => y.d - x.d);
  //   const bestW = okWins[0], worstW = okWins[okWins.length - 1];
  //   const monthIdx = PP.map((v, i) => i).filter(i => N[i] >= 10).sort((x, y) => PP[y] - PP[x]);
  //
  // So: a stretch is a run of 2 or 3 ADJACENT months, wrapping at December; its
  // pp is the match-weighted mean of the member months' pp, which is identical
  // to (stretch yield − career yield); and eligibility is n >= 10. The file's
  // `N` is its priced count (its whole grid is priced), and the pp being
  // averaged is a yield, so `n` here is the PRICED count — the sample gate sits
  // on the sample the number is actually computed from. That is also what makes
  // the founder's "never show a 1-match −100%" hold.
  function calStretches(info) {
    var months = info.months, wins = [];
    for (var len = 2; len <= 3; len++) {
      for (var s = 0; s < 12; s++) {
        var idx = [], k;
        for (k = 0; k < len; k++) idx.push((s + k) % 12);
        var nSum = 0, acc = 0, gridN = 0;
        idx.forEach(function (i) {
          nSum += months[i].priced;
          gridN += months[i].n;
          if (months[i].pp != null) acc += months[i].priced * months[i].pp;
        });
        var up = 0;
        info.grid.forEach(function (yr) {
          var w = 0, l = 0;
          idx.forEach(function (i) { w += yr.cells[i].won; l += yr.cells[i].lost; });
          if (w > l) up++;
        });
        wins.push({
          label: MON3[idx[0]] + ENDASH + MON3[idx[len - 1]],
          n: nSum, gridN: gridN, d: nSum ? acc / nSum : null, up: up
        });
      }
    }
    var ok = wins.filter(function (w) { return w.n >= 10 && w.d != null; })
      .sort(function (a, b) { return b.d - a.d; });
    return { best: ok[0] || null, worst: ok.length ? ok[ok.length - 1] : null };
  }

  // Win/loss runs over the dated sequence, oldest first.
  //
  // Item 27 · the founder's walkover ruling is applied HERE and nowhere else: a
  // walkover RECEIVED is a win (it arrives as won:true and is simply kept), a
  // walkover GIVEN is neither a win nor a loss, so it is stepped over — the run
  // either side of it continues rather than being broken by a match that was
  // never played. calRunsSkipped() reports how many rows that removed, because
  // it is the one thing that can make Sum(run lengths) differ from M.
  function calRuns(rows) {
    var runs = [];
    rows.forEach(function (r) {
      if (r.wo && !r.won) return;                    // walkover given: neither
      var res = r.won ? 'W' : 'L';
      var last = runs[runs.length - 1];
      if (last && last.res === res) { last.len++; last.to = r.date; last.rows.push(r); }
      else runs.push({ res: res, len: 1, from: r.date, to: r.date, rows: [r] });
    });
    return runs;
  }
  function calRunsSkipped(rows) {
    return rows.filter(function (r) { return r.wo && !r.won; }).length;
  }
  /** The rows calRuns() actually sequenced, in the same order. */
  function calRunRows(rows) {
    return rows.filter(function (r) { return !(r.wo && !r.won); });
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
  // Items 8 + 9. The file's segmented control is `display:inline-flex` with
  // gap:3px and NO align-self — it takes content width and sits left because it
  // is inline, not because anything pushes it. `bd` on the selected chip is
  // rgba(91,155,255,0.22) (:3018), not the 0.4 we were drawing. Two sizes: the
  // tab control is 6px 14px / 12px (:114), the surface control 5px 11px / 11px
  // (:124).
  function calSegBtn(attr, id, label, on, small) {
    return '<button type="button" data-pp2="' + esc(attr) + '" data-v="' + esc(id) + '" ' +
      'style="padding:' + (small ? '5px 11px' : '6px 14px') + ';border-radius:7px;' +
      'font-size:' + (small ? '11px' : '12px') + ';font-weight:' + (on ? 700 : 600) + ';' +
      'color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
      'background:' + (on ? 'rgba(91,155,255,0.16)' : 'transparent') + ';' +
      'border:1px solid ' + (on ? 'rgba(91,155,255,0.22)' : 'transparent') + ';' +
      'white-space:nowrap;cursor:pointer;font-family:inherit;">' + esc(label) + '</button>';
  }
  function calSegWrap(inner, small, margin) {
    return '<div style="display:inline-flex;gap:3px;background:#0a0d13;' +
      'border:1px solid rgba(255,255,255,0.09);border-radius:9px;padding:3px;' +
      (margin ? 'margin-bottom:' + margin + ';' : '') + '">' + inner + '</div>';
  }

  // Item 4 · ORDER. The file puts the four tiles FIRST (`modal.hasCareerTiles`,
  // :85-100) and the Calendar|Streaks control AFTER them (:113). We had the tabs
  // first and full-width. The tiles belong to the Calendar tab only —
  // `hasCareerTiles: open === 'season' && (S.seasonTab||'Calendar')==='Calendar'`
  // (:2967) — so on the Streaks tab the control moves back to the top by itself.
  function renderSeasonModal(p) {
    var tab = state.calTab === 'streaks' ? 'streaks' : 'calendar';
    var seg = calSegWrap(
      calSegBtn('cal-tab', 'calendar', 'Calendar', tab === 'calendar') +
      calSegBtn('cal-tab', 'streaks', 'Streaks', tab === 'streaks'), false, '16px');
    if (tab === 'streaks') {
      // The guard is on the FILTERED rows, not the whole spine: a surface a
      // player has no match on leaves the run maths with n=0, and every rate
      // downstream of it is 0/0. It printed "undefined" into the DOM.
      if (!calSpineFiltered(p).length) {
        return seg + calEmpty(calNoRowsWhy(state.calSurface || 'all',
          'so there is no dated row to place in a run.'));
      }
      // Re-verify item 1 · the file puts the four tiles FIRST and the
      // Calendar|Streaks control UNDER them on this tab too (Player Stat
      // Boxes.dc.html:104 tiles, :114 control) — the same order the Calendar
      // tab was already ruled into. `seg` is therefore handed to the renderer
      // rather than concatenated ahead of it.
      return renderStreakTab(p, seg);
    }
    if (!calSpine(p).length) {
      return seg + calEmpty('No dated career match rows on record, so there is no match to place in a calendar.');
    }
    return renderCalTab(p, seg);
  }
  function calEmpty(text) {
    return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
      'text-align:center;font-size:13px;color:#5b6880;margin-top:14px;">' + esc(text) + '</div>';
  }
  // ONE refusal sentence for BOTH tabs. Since ruling cal-2 the two tabs read the
  // same rows, so an empty segment has the same cause on either — and the
  // Indoors case has to keep saying WHY it is empty rather than reading as "he
  // never played indoors". `tail` is the clause that names the block.
  function calNoRowsWhy(surf, tail) {
    if (surf === 'indoors') {
      return 'No per-match court type on record. Indoors is a court type carved out of the surfaces, and the ' +
        'career match rows carry a surface but no court column — the Career record drill refuses an ' +
        'Indoors drill for the same reason.';
    }
    if (!surf || surf === 'all') return 'No dated career match rows on record, ' + tail;
    var label = (CAL_SURFACES.filter(function (s) { return s.id === surf; })[0] || {}).label;
    return 'No career match rows on ' + (label || 'this surface') + ' on record, ' + tail;
  }
  // ─── RULING cal-2 · THE STREAKS SPINE MOVED TOO (founder, 2026-09-17) ──────
  //
  // cal-1 moved the Calendar tab onto the career match rows and left Streaks on
  // the priced archive, because the brief listed Streaks as don't-touch. That
  // left one modal sitting on two populations (Zverev: 775 career rows against
  // 727 priced archive rows), which the scope note had to confess in words. The
  // founder ruled "move it now in this branch; re-measure every run length", so
  // both tabs now read calSpineFiltered() and this note states the one scope.
  //
  // What the move costs, stated rather than hidden: a run's PRICE and P&L come
  // from the Pinnacle closing join, which covers a SUBSET of the career rows
  // (Zverev 497 of 775, Krumich 0 of 355). An unpriced row keeps its place in
  // the run — it is a real match and dropping it would break the sequence — and
  // dashes its two money columns. The run's P&L is therefore summed over the
  // priced rows it contains and labelled with that count.
  // Item 24 · the FILE's footnote (:2021), with this player's real values in the
  // three slots. Its last clause — "the archive carries no match dates, so a
  // run's span reads to the month" — is dropped because our rows DO carry full
  // ISO dates; spans still read to the month, as the design draws them. The
  // sentence that replaces it is the priced-coverage disclosure the standing
  // rule requires, which is what makes the dashes in HOME/AWAY/P&L legible.
  function calStreakScopeNote(p, seqN, skipped, pr) {
    var rows = calSpineFiltered(p);
    var priced = rows.filter(function (r) { return r.cents != null; }).length;
    var txt = 'Runs count all ' + seqN + ' matches on record regardless of whether a closing ' +
      'price exists. Expected runs of five or more, and both expected longest figures, are ' +
      'derived from this player’s own career win rate (' + (pr * 100).toFixed(1) + '%) and ' +
      'match count (' + seqN + '), not a tour average. ' +
      priced + ' of ' + rows.length + ' carry a Pinnacle closing price; an unpriced match still ' +
      'counts in its run and dashes its price and P&L.' +
      // Only stated when it actually happened, so the sentence can never read as
      // boilerplate on a player it does not apply to.
      (skipped ? ' ' + skipped + (skipped === 1 ? ' walkover' : ' walkovers') + ' given ' +
        (skipped === 1 ? 'is' : 'are') + ' excluded from the sequence — neither a win nor a ' +
        'loss — so the run either side of ' + (skipped === 1 ? 'it' : 'them') + ' continues.' : '');
    return '<div style="margin-top:18px;font-size:11px;line-height:1.65;color:#5b6880;' +
      'max-width:900px;">' + esc(txt) + '</div>';
  }

  // ── the four tiles (items 5-7) ───────────────────────────────────────────
  // `Player Stat Boxes.dc.html`:88-99 — a bordered box, centred, gap 8px, and a
  // WHITE value (`valueColor: '#fff'`, :2262) whatever the sign. The sign lives
  // on the pp only. The gate is the file's tileOf(): full colour at k >= 10,
  // greyed with a "*" at 5-9, a dash below 5.
  function calDesignTile(cap, value, pp, n, repeat) {
    var full = n >= 10, some = n >= 5;
    var ppText = (pp == null || !some) ? DASH : signed(pp, 1, 'pp');
    var ppColour = (pp == null) ? DASH_COLOUR
      : full ? (pp > 0 ? '#3dd68c' : pp < 0 ? '#e0616f' : '#8b96b5')
        : some ? '#5b6880' : DASH_COLOUR;
    var mark = full ? '' : (some ? '*' : '');
    return '<div style="background:#0a0d14;border:1px solid rgba(255,255,255,0.09);border-radius:12px;' +
      'padding:15px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;' +
      'gap:8px;min-width:0;">' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;">' + esc(cap) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:26px;font-weight:700;line-height:1;' +
        'color:' + (value === DASH ? DASH_COLOUR : '#fff') + ';">' + esc(value) + '</span>' +
      '<span style="display:flex;align-items:baseline;justify-content:center;gap:5px;' +
        'font-family:\'IBM Plex Mono\',monospace;font-size:11px;">' +
        '<span style="font-weight:700;color:' + ppColour + ';">' + esc(ppText) + '</span>' +
        '<span style="color:#4b5672;">' + esc(MIDDOT + ' n=' + n) + '</span>' +
        '<span style="font-size:9px;color:#4b5672;">' + mark + '</span></span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#5b6880;">' +
        esc(repeat) + '</span></div>';
  }

  function renderCalTab(p, seg) {
    var rows = calSpineFiltered(p);
    var surf = state.calSurface || 'all';
    var scope = calScope(p);
    var eyebrowRow = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;">Calendar form ' + MIDDOT + ' career</span>' +
      calSegWrap(CAL_SURFACES.map(function (s) {
        return calSegBtn('cal-surface', s.id, s.label, surf === s.id, true);
      }).join(''), true, null) + '</div>';

    // The Indoors segment has no per-match source. Same refusal, same wording as
    // the ruled §5.2 drill — not a new behaviour invented here.
    if (!rows.length) {
      var why = calNoRowsWhy(surf, 'so there is no match to place in a calendar.');
      return calTiles4(DASH, DASH, DASH, DASH, 0) + seg + eyebrowRow + calEmpty(why);
    }

    var info = calMonths(rows);
    var months = info.months;
    var seasons = info.seasons;
    var stretch = calStretches(info);
    // monthIdx — :2257. Eligible months are those with priced n >= 10, ranked on
    // pp (vs his own career yield), NOT on the footer's vs-other-months figure.
    var monthIdx = months.filter(function (x) { return x.priced >= 10 && x.pp != null; })
      .sort(function (a, b) { return b.pp - a.pp; });
    var bestM = monthIdx[0] || null;
    var worstM = monthIdx.length ? monthIdx[monthIdx.length - 1] : null;

    function posOf(up) { return up + ' of ' + seasons + ' positive'; }
    var tiles = '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;' +
      'margin-bottom:20px;">' +
      calDesignTile('Best stretch', stretch.best ? stretch.best.label : DASH,
        stretch.best ? stretch.best.d : null, stretch.best ? stretch.best.n : 0,
        stretch.best ? posOf(stretch.best.up) : 'no stretch clears n=10 priced') +
      calDesignTile('Worst stretch', stretch.worst ? stretch.worst.label : DASH,
        stretch.worst ? stretch.worst.d : null, stretch.worst ? stretch.worst.n : 0,
        stretch.worst ? posOf(stretch.worst.up) : 'no stretch clears n=10 priced') +
      calDesignTile('Best month', bestM ? MON_FULL[bestM.m] : DASH,
        bestM ? bestM.pp : null, bestM ? bestM.priced : 0,
        bestM ? posOf(bestM.above) : 'no month clears n=10 priced') +
      calDesignTile('Worst month', worstM ? MON_FULL[worstM.m] : DASH,
        worstM ? worstM.pp : null, worstM ? worstM.priced : 0,
        worstM ? posOf(worstM.above) : 'no month clears n=10 priced') + '</div>';

    // ── the heat grid (items 10-15) ─────────────────────────────────────────
    // Track and gap are the file's: 86px repeat(12,minmax(0,1fr)), gap 0 6px,
    // min-width 880px (:127). The YEAR header (:128) was missing entirely. Cells
    // carry NO border-radius in the file and the row pitch comes from
    // `padding:7px 0` plus a 1px top rule, which is what makes the rows flush.
    var GRID_TRACK = 'display:grid;grid-template-columns:86px repeat(12,minmax(0,1fr));gap:0 6px;min-width:880px;';
    var HEAD_CELL = 'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
      'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;';
    var head =
      '<span style="position:sticky;top:0;left:0;z-index:3;background:#0a0d14;' + HEAD_CELL +
        'padding:8px 8px 8px 10px;">Year</span>' +
      MON3.map(function (m) {
        return '<span style="position:sticky;top:0;z-index:2;background:#0a0d14;' + HEAD_CELL +
          'text-align:center;padding:8px 0;">' + m + '</span>';
      }).join('');

    var grid = info.grid;
    var body = grid.map(function (yr) {
      return '<span style="position:sticky;left:0;z-index:1;background:#0a0d14;' +
        'font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;color:#8b96b5;' +
        'padding:7px 8px 7px 10px;border-top:1px solid rgba(255,255,255,0.05);">' + esc(yr.year) + '</span>' +
        yr.cells.map(function (c, m) {
          var n = c.won + c.lost;
          // Item 13 — the empty month is the file's middot in #4b5672, with no
          // pointer and no click target, not an em dash.
          if (!n) {
            return '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;text-align:center;' +
              'color:#4b5672;padding:7px 0;border-top:1px solid rgba(255,255,255,0.05);' +
              'cursor:default;">' + MIDDOT + '</span>';
          }
          var on = state.calCell === yr.year + '|' + m;
          // Item 12 — a FLAT 0.10 tint either side of .500 (GREENW / REDW,
          // :2086) and `transparent` at .500. We were ramping the alpha to 0.42
          // with the win rate, which is the file's HOVER value, not its fill.
          var bg = on ? 'rgba(91,155,255,0.18)'
            : c.won > c.lost ? 'rgba(61,214,140,0.10)'
              : c.won < c.lost ? 'rgba(224,97,111,0.10)' : 'transparent';
          var cls = c.won > c.lost ? 'calw' : c.won < c.lost ? 'call' : 'caln';
          return '<span class="' + cls + '" data-pp2="cal-cell" data-v="' + yr.year + '|' + m + '" ' +
            'style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;text-align:center;' +
            'color:' + (on ? '#fff' : '#e7e9ee') + ';background:' + bg + ';' +
            'outline:' + (on ? '1px solid #5b9bff' : 'none') + ';outline-offset:-1px;' +
            'padding:7px 0;border-top:1px solid rgba(255,255,255,0.05);cursor:pointer;' +
            'transition:background .12s ease,color .12s ease;">' +
            c.won + ENDASH + c.lost + '</span>';
        }).join('');
    }).join('');

    var drill = renderCalDrill(p, rows);
    var footer = renderCalFooter(info, rows);

    // Item 31 — one short scope sentence, the design's wording adapted to real
    // counts, and the long archive paragraph gone.
    var gap = scope.m - scope.n;
    var note = 'Grid cells are W' + ENDASH + 'L only, counted over the career match rows. The tint shows ' +
      'whether that month finished above .500 that season, not a yield comparison. ' +
      (info.priced
        ? 'Yield and ' + esc('vs other months') + ' are computed across the ' + info.priced + ' priced ' +
          (info.priced === 1 ? 'match' : 'matches') + ' (Pinnacle closing); the grid covers all ' +
          rows.length + '.'
        : 'None of these ' + rows.length + ' matches carries a Pinnacle closing price, so every yield ' +
          'figure is a dash: the odds archive is ATP tour main draw only.') + ' ' +
      esc('Consistent') + ' counts, out of the ' + seasons + ' ' +
      (seasons === 1 ? 'season' : 'seasons') + ' on record, those in which the month finished above .500; ' +
      'a season with no matches that month counts as not above.' +
      // The gap runs BOTH ways and both directions have to be stated. The
      // career spine is careerByYear, which is a window, so for a player whose
      // dated rows reach further back the grid is LARGER than the record above
      // it. Printing the clause only when the grid is smaller would leave that
      // reader with two totals and no explanation.
      (surf !== 'all' ? ''
        : gap > 0
          ? ' The career record above holds ' + scope.m + ' matches; ' + gap +
            ' of them carry no dated match row and cannot be placed in a month.'
          : gap < 0
            ? ' The career record above holds ' + scope.m + ' matches, fewer than the grid: it is a ' +
              'season window and the dated match rows reach ' + (-gap) + ' matches further back.'
            : '');

    return tiles + seg + eyebrowRow +
      '<div style="overflow-x:auto;">' +
      '<div style="max-height:400px;overflow-y:scroll;scrollbar-gutter:stable;">' +
      '<div style="' + GRID_TRACK + '">' + head + body + '</div></div>' +
      drill + footer +
      '<div style="margin-top:16px;font-size:11px;line-height:1.65;color:#5b6880;max-width:900px;">' +
      note + '</div></div>';
  }
  // Four dashed tiles, for the states where a surface holds nothing at all.
  function calTiles4(a, b, c, d, n) {
    return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;' +
      'margin-bottom:20px;">' +
      calDesignTile('Best stretch', a, null, n, 'no matches on record') +
      calDesignTile('Worst stretch', b, null, n, 'no matches on record') +
      calDesignTile('Best month', c, null, n, 'no matches on record') +
      calDesignTile('Worst month', d, null, n, 'no matches on record') + '</div>';
  }

  // ── the cell drill (items 16-23) ─────────────────────────────────────────
  // Template at :146-188. Everything below is that markup with our rows in it:
  // the eyebrow tournament line (item 18), the eight-column head (item 19), the
  // W/L LETTER rather than a dot, the SCORE column, HOME bold / AWAY dim, and a
  // P&L with no "u" suffix (item 20). Rows are grouped by event in first-seen
  // order with a 12px gap between groups (item 21).
  function renderCalDrill(p, rows) {
    if (!state.calCell) return '';
    var parts = String(state.calCell).split('|');
    var dy = parts[0], dm = parseInt(parts[1], 10);
    var cell = rows.filter(function (r) { return r.year === dy && r.mon === dm; });
    if (!cell.length) return '';
    var won = 0, cents = 0, priced = 0;
    cell.forEach(function (r) {
      if (r.won) won++;
      if (r.cents != null) { cents += r.cents; priced++; }
    });
    // plPct = plTot / n * 100 (:2163) over the PRICED rows only — item 22 keeps
    // an unpriced row out of the count it is not part of.
    var pct = priced ? cents / priced : null;
    var sign = cents > 0 ? '#3dd68c' : cents < 0 ? '#e0616f' : '#8b96b5';
    var order = [], groups = {};
    cell.forEach(function (r) {
      var ev = r.event || DASH;
      if (order.indexOf(ev) < 0) { order.push(ev); groups[ev] = []; }
      groups[ev].push(r);
    });
    var totalLine = priced
      ? signed(cents / 100, 2) + 'u ' + MIDDOT + ' ' + signed(pct, 1, '%') + ' ' + MIDDOT + ' ' +
        priced + ' priced'
      : DASH + ' ' + MIDDOT + ' no priced match in this month';
    var ROW_TRACK = 'display:grid;grid-template-columns:14px 44px minmax(0,1.1fr) minmax(0,1.3fr) ' +
      'minmax(0,1fr) 62px 62px 72px;gap:20px;';
    var HEAD = 'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
      'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;';
    var colHead = '<div style="' + ROW_TRACK + 'margin:0 0 10px;width:100%;">' +
      '<span></span>' +
      '<span style="' + HEAD + '">Rd</span>' +
      '<span style="' + HEAD + '">Event</span>' +
      '<span style="' + HEAD + '">Opponent</span>' +
      '<span style="' + HEAD + '">Score</span>' +
      '<span style="' + HEAD + 'text-align:right;">Home</span>' +
      '<span style="' + HEAD + 'text-align:right;">Away</span>' +
      '<span style="' + HEAD + 'text-align:right;">P&amp;L</span></div>';

    var body = order.map(function (ev) {
      return '<div style="display:flex;flex-direction:column;gap:1px;">' +
        groups[ev].map(function (r) {
          var pl = r.cents == null ? DASH : signed(r.cents / 100, 2);
          var plCol = r.cents == null ? DASH_COLOUR
            : r.cents > 0 ? '#3dd68c' : r.cents < 0 ? '#e0616f' : '#8b96b5';
          return '<div ' + sheetHook(r.sheetId) + 'style="' + ROW_TRACK +
            'align-items:center;padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);' +
            sheetCursor() + '">' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;' +
              'color:' + (r.won ? '#3dd68c' : '#e0616f') + ';">' + (r.won ? 'W' : 'L') + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;">' +
              esc(r.round || DASH) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8a93a6;' +
              'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.event || DASH) + '</span>' +
            '<span style="font-size:12.5px;color:#e7e9ee;overflow:hidden;text-overflow:ellipsis;' +
              'white-space:nowrap;">' + esc(r.opp ? surnameFirst(r.opp) : DASH) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#8b96b5;' +
              'white-space:nowrap;">' + esc(scoreWithStatus(r, r.score)) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;' +
              'text-align:right;color:' + (r.price == null ? DASH_COLOUR : '#e7e9ee') + ';">' +
              (r.price == null ? DASH : r.price.toFixed(2)) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;text-align:right;' +
              'color:' + (r.oppPrice == null ? DASH_COLOUR : '#5b6880') + ';">' +
              (r.oppPrice == null ? DASH : r.oppPrice.toFixed(2)) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;text-align:right;' +
              'color:' + plCol + ';">' + pl + '</span></div>';
        }).join('') + '</div>';
    }).join('');

    return '<div style="margin:12px 0 4px;background:#06070a;border:1px solid rgba(91,155,255,0.3);' +
      'border-radius:10px;padding:13px 15px;box-sizing:border-box;">' +
      '<div style="display:flex;align-items:baseline;gap:11px;margin-bottom:3px;">' +
        '<span style="font-size:13px;font-weight:700;">' + esc(MON_FULL[dm] + ' ' + dy) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#8b96b5;">' +
          recordText(won, cell.length - won) + '</span>' +
        '<span style="margin-left:auto;font-family:\'IBM Plex Mono\',monospace;font-size:15px;' +
          'font-weight:700;white-space:nowrap;color:' + (priced ? sign : DASH_COLOUR) + ';">' +
          esc(totalLine) + '</span>' +
        '<button type="button" data-pp2="cal-cell-close" style="align-self:center;margin-left:4px;' +
          'width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.05);' +
          'border:1px solid rgba(255,255,255,0.09);color:#8b96b5;cursor:pointer;display:flex;' +
          'align-items:center;justify-content:center;">' +
          '<svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" ' +
          'stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg></button></div>' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:600;' +
        'letter-spacing:0.12em;text-transform:uppercase;color:#5b6880;margin-bottom:11px;' +
        'line-height:1.5;">' +
        esc(dy + ' ' + MIDDOT + ' ' + MON3[dm].toUpperCase() + ' ' + MIDDOT + ' ' +
          order.join(' ' + MIDDOT + ' ').toUpperCase() + ' ' + MIDDOT + ' ' +
          recordText(won, cell.length - won)) + '</div>' +
      colHead +
      '<div style="display:flex;flex-direction:column;gap:12px;width:100%;">' + body + '</div></div>';
  }

  // ── the footer (items 24-31) ─────────────────────────────────────────────
  // Template at :190-249. Five data rows on the SAME 13-column track as the
  // grid — MONTH, N, YIELD, VS OTHER MONTHS, CONSISTENT — under a 66px swing
  // chart and a surface-span SWING row, with the three-column findings strip
  // above them. Every one of those was missing live except N/YIELD/VS/CONSISTENT.
  function renderCalFooter(info, rows) {
    var months = info.months;
    var GRID_TRACK = 'display:grid;grid-template-columns:86px repeat(12,minmax(0,1fr));gap:0 6px;' +
      'min-width:880px;align-items:end;';
    var LAB = 'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
      'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;';
    var CELL = 'font-family:\'IBM Plex Mono\',monospace;text-align:center;' +
      'border-top:1px solid rgba(255,255,255,0.05);padding:13px 0;';

    // Findings strip — :236-248 and the figures at :2290-2306. Per-surface yield
    // against the other surfaces combined, on the priced subset, with the
    // file's own n>=10 / 5-9 / <5 gate.
    var findings = calFindings(rows);
    var strip = '<div style="margin:18px 0 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));' +
      'gap:0;background:transparent;border:1px solid rgba(255,255,255,0.09);border-radius:10px;' +
      'overflow:hidden;">' + findings.map(function (d, i) {
        var full = d.n >= 10, some = d.n >= 5;
        var val = (d.value == null || !some) ? DASH : signed(d.value, 1, 'pp');
        return '<span style="display:flex;flex-direction:column;align-items:center;text-align:center;' +
          'gap:6px;padding:15px 20px;border-left:1px solid ' +
          (i === 0 ? 'transparent' : 'rgba(255,255,255,0.09)') + ';">' +
          '<span style="' + LAB + '">' + esc(d.cap) + '</span>' +
          '<span style="display:flex;align-items:baseline;gap:9px;">' +
            '<span style="font-size:13px;color:#e8ecf4;">' + esc(d.name) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:' + (full ? '15px' : '11px') +
              ';font-weight:' + (full ? 700 : 400) + ';color:' +
              (d.value == null || !some ? DASH_COLOUR
                : full ? (d.neutral ? '#e8ecf4' : d.value > 0 ? '#3dd68c' : d.value < 0 ? '#e0616f' : '#8b96b5')
                  : '#5b6880') + ';">' + esc(val) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;color:#4b5672;">' +
              (full ? '' : some ? '*' : '') + '</span></span>' +
          '<span style="' + LAB + '">n=' + d.n + '</span></span>';
      }).join('') + '</div>';

    // Swing chart — :191-206. 66px band, a mid rule, 9px bars scaled on the
    // largest |vs other months|, and a 5px #4b5672 dot where the figure is not
    // held (the file's `barDot`).
    var maxGap = 0;
    months.forEach(function (x) { if (x.gap != null && Math.abs(x.gap) > maxGap) maxGap = Math.abs(x.gap); });
    var chart = '<span></span>' +
      '<span style="grid-column:2 / -1;position:relative;display:grid;' +
        'grid-template-columns:repeat(12,minmax(0,1fr));gap:0 6px;height:66px;align-items:center;">' +
      '<span style="position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(255,255,255,0.12);"></span>' +
      months.map(function (x) {
        var inner;
        if (x.gap == null || !maxGap) {
          inner = '<span style="position:relative;width:5px;height:5px;border-radius:50%;background:#4b5672;"></span>';
        } else {
          var h = (Math.abs(x.gap) / maxGap * 30).toFixed(1);
          inner = '<span style="position:absolute;left:50%;transform:translateX(-50%);' +
            (x.gap > 0 ? 'bottom' : 'top') + ':50%;width:9px;height:' + h + 'px;background:' +
            (x.gap > 0 ? '#3dd68c' : x.gap < 0 ? '#e0616f' : '#8b96b5') + ';border-radius:2px;"></span>';
        }
        return '<span style="position:relative;height:100%;display:flex;align-items:center;' +
          'justify-content:center;">' + inner + '</span>';
      }).join('') + '</span>';

    // SWING row — :214-222. The file hard-codes five spans; ours are DERIVED:
    // each month is labelled with the surface that carries most of its career
    // rows, and adjacent months sharing that surface merge into one span. No
    // month is given a surface its own matches do not show.
    var spans = calSurfaceSpans(rows);
    var swingRow = '<span style="' + LAB + 'padding:0 8px 8px 10px;">Swing</span>' +
      spans.map(function (s) {
        return '<span style="grid-column:span ' + s.len + ';display:flex;flex-direction:column;' +
          'gap:6px;padding:0 3px 8px;">' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;font-weight:600;' +
            'letter-spacing:0.12em;text-transform:uppercase;text-align:center;color:' + s.colour + ';">' +
            esc(s.label) + '</span>' +
          '<span style="display:block;height:4px;border-radius:2px;background:' + s.colour +
            ';opacity:0.75;"></span></span>';
      }).join('');

    function dataRow(label, cellFor, extraLab) {
      return '<span style="' + LAB + (extraLab || '') + 'padding:13px 8px 13px 10px;">' + esc(label) + '</span>' +
        months.map(cellFor).join('');
    }
    var monthRow = dataRow('Month', function (x) {
      return '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:600;' +
        'letter-spacing:0.1em;text-transform:uppercase;text-align:center;color:#8b96b5;padding:13px 0;' +
        'border-top:1px solid rgba(255,255,255,0.07);">' + MON3[x.m] + '</span>';
    });
    var nRow = dataRow('n', function (x) {
      return '<span style="' + CELL + 'font-size:11.5px;color:' + (x.n ? '#5b6880' : '#4b5672') + ';">' +
        x.n + '</span>';
    });
    // Item 28 — YIELD is the file's neutral #e7e9ee, not sign-coloured. Only
    // VS OTHER MONTHS carries the sign colour (item 29, 15px/700).
    var yieldRow = dataRow('Yield', function (x) {
      var soft = x.priced > 0 && x.priced < 5;
      return '<span style="' + CELL + 'font-size:' + (soft ? '11px' : '11.5px') + ';white-space:nowrap;' +
        'color:' + (x.yield == null || soft ? DASH_COLOUR : '#e7e9ee') + ';">' +
        (x.yield == null || soft ? DASH : signed(x.yield, 1, '%')) + '</span>';
    });
    var gapRow = dataRow('Vs other months', function (x) {
      var soft = x.priced > 0 && x.priced < 5;
      var dash = x.gap == null || soft;
      return '<span style="' + CELL + 'font-size:' + (dash ? '11px' : '15px') + ';' +
        'font-weight:' + (dash ? 400 : 700) + ';white-space:nowrap;color:' +
        (dash ? DASH_COLOUR : x.gap > 0 ? '#3dd68c' : x.gap < 0 ? '#e0616f' : '#8b96b5') + ';">' +
        (dash ? DASH : signed(x.gap, 1, 'pp')) + '</span>';
    });
    // Item 30 — one segment per SEASON, filled where that month finished above
    // .500, with "above/seasons" under it. The design's "8 of 14" prose is gone.
    var consRow = dataRow('Consistent', function (x) {
      var segs = '';
      for (var k = 0; k < info.seasons; k++) {
        segs += '<span style="flex:1;height:6px;border-radius:1px;background:' +
          (k < x.above ? 'rgba(91,155,255,0.62)' : 'rgba(255,255,255,0.07)') + ';"></span>';
      }
      return '<span style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:13px 3px;' +
        'border-top:1px solid rgba(255,255,255,0.05);">' +
        '<span style="display:flex;gap:1px;width:100%;">' + segs + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;color:#5b6880;">' +
          x.above + '/' + info.seasons + '</span></span>';
    }, 'align-self:start;');

    return strip +
      '<div style="margin:14px 0 0;">' +
      '<div style="' + GRID_TRACK + '">' +
      chart + swingRow + monthRow + nRow + yieldRow + gapRow + consRow +
      '</div></div>';
  }

  // BEST SWING / WORST SWING / SURFACE SPREAD (:2290-2306). The design's figures
  // are a placeholder array; the definition it encodes is a per-surface yield
  // ranked against the others, and the spread is the best minus the worst.
  function calFindings(rows) {
    var out = [];
    var agg = {};
    SURF_ORDER.forEach(function (s) { agg[s] = { cents: 0, n: 0 }; });
    var allC = 0, allN = 0;
    rows.forEach(function (r) {
      if (r.cents == null) return;
      allC += r.cents; allN++;
      if (!r.surface || !agg[r.surface]) return;
      agg[r.surface].cents += r.cents; agg[r.surface].n++;
    });
    // The file labels these "pp", and its SW array is commented "weighted to the
    // career yield" — so the figure is the surface's yield MINUS his own career
    // yield, the same baseline the tiles use, not the raw yield. The spread is
    // unaffected either way (the baseline cancels), which is exactly why a raw
    // yield rendered under a "pp" label would have gone unnoticed.
    var careerY = allN ? allC / allN : null;
    var list = SURF_ORDER.filter(function (s) { return agg[s].n > 0; }).map(function (s) {
      return {
        s: s, n: agg[s].n,
        yield: careerY == null ? null : agg[s].cents / agg[s].n - careerY
      };
    }).filter(function (x) { return x.yield != null; })
      .sort(function (a, b) { return b.yield - a.yield; });
    var hi = list[0] || null, lo = list.length ? list[list.length - 1] : null;
    var nTot = list.reduce(function (a, x) { return a + x.n; }, 0);
    out.push({
      cap: 'Best swing', name: hi ? SPINE_LABEL[hi.s] : DASH,
      value: hi ? hi.yield : null, n: hi ? hi.n : 0
    });
    out.push({
      cap: 'Worst swing', name: lo ? SPINE_LABEL[lo.s] : DASH,
      value: lo ? lo.yield : null, n: lo ? lo.n : 0
    });
    out.push({
      cap: 'Surface spread', name: '',
      value: (hi && lo && hi !== lo) ? hi.yield - lo.yield : null,
      n: nTot, neutral: true
    });
    return out;
  }
  var SURF_ORDER = ['hard', 'clay', 'grass'];
  var SWING_COLOUR = { hard: '#4db8ff', clay: '#e8a84e', grass: '#7fae9a' };
  // The SWING row's spans, derived. A month takes the surface holding most of
  // its career rows; a month with no rows takes none and breaks the span.
  function calSurfaceSpans(rows) {
    var per = [];
    var i;
    for (i = 0; i < 12; i++) per.push({});
    rows.forEach(function (r) {
      if (!r.surface) return;
      per[r.mon][r.surface] = (per[r.mon][r.surface] || 0) + 1;
    });
    var dom = per.map(function (c) {
      var keys = Object.keys(c);
      if (!keys.length) return null;
      return keys.sort(function (a, b) { return c[b] - c[a]; })[0];
    });
    var out = [];
    for (i = 0; i < 12; i++) {
      var last = out[out.length - 1];
      if (last && last.surface === dom[i]) { last.len++; continue; }
      out.push({
        surface: dom[i], len: 1,
        label: dom[i] ? SPINE_LABEL[dom[i]] : '',
        colour: dom[i] ? (SWING_COLOUR[dom[i]] || '#c6ccdb') : 'transparent'
      });
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.4 STREAKS TAB — rebuilt to `Player Stat Boxes.dc.html`:104-357
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // README-vs-FILE differences found in §5.4 "Streaks tab", all resolved the
  // file's way (§0: the file wins), all four reported:
  //   a. README lists the tiles as "Longest win run, Longest loss run, Current,
  //      …". The file's strip (:2001-2006) is Runs of 5+ / Longest win run /
  //      Longest loss run / Expected longest. There is no "Current" tile.
  //   b. README's run-detail title is "W5 · Barcelona → Madrid". The file
  //      (:1942) builds "Winning run · 10 matches" / "Losing run · N matches".
  //   c. README's baseline row reads "All matches". The file (:2014) writes
  //      "baseline".
  //   d. README puts the Calendar|Streaks control at the "Top". The file puts
  //      the four tiles above it (:104 vs :114).
  // One founder-vs-file difference, also resolved the file's way: the tile sub
  // line is asked for in #5b6880 and the file (:109) sets `font-size:10.5px;
  // color:#4b5672` with no font-family, i.e. Hanken at #4b5672.

  var STREAK_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /**
   * Item 5 · a run's span ALWAYS carries its year and reads to the month, the
   * file's `span()` (:1865) and `sp` (:1938). The two differ only in spacing
   * around the dash — the tile is tight ("Jul–Sep 2018"), the detail eyebrow is
   * spaced ("JUL – SEP 2018") — so one formatter with a flag, not two.
   */
  function runSpan(r, spaced) {
    if (!r) return DASH;
    var a = String(r.from), b = String(r.to);
    var m1 = STREAK_MON[+a.slice(5, 7) - 1], y1 = a.slice(0, 4);
    var m2 = STREAK_MON[+b.slice(5, 7) - 1], y2 = b.slice(0, 4);
    var d = spaced ? ' ' + ENDASH + ' ' : ENDASH;
    if (y1 === y2) return (m1 === m2 ? m1 : m1 + d + m2) + ' ' + y1;
    return m1 + ' ' + y1 + d + m2 + ' ' + y2;
  }

  // Items 2-4 · the file's tile (:106-110): a bordered box, centred, gap 8px,
  // a WHITE 26px value whatever the sign (no green/red on this tab), and a sub
  // in the page font at 10.5px/#4b5672 rather than mono.
  function streakTile(cap, value, sub) {
    return '<div style="background:#0a0d14;border:1px solid rgba(255,255,255,0.09);' +
      'border-radius:12px;padding:15px 16px;display:flex;flex-direction:column;' +
      'align-items:center;text-align:center;gap:8px;min-width:0;box-sizing:border-box;">' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;">' + esc(cap) + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:26px;font-weight:700;' +
        'line-height:1;color:' + (value === DASH ? DASH_COLOUR : '#fff') + ';">' + esc(value) + '</span>' +
      '<span style="font-size:10.5px;color:#4b5672;">' + esc(sub) + '</span></div>';
  }

  // ── items 19-23 · WHAT FOLLOWS A RUN ─────────────────────────────────────
  //
  // The file's b2 block is the ONE part of this tab whose figures are marked
  // "placeholder figures for the design pass — see report" (:1983). Its note
  // (:2015) is the whole specification, and it is quoted here rather than
  // paraphrased:
  //
  //   "State is evaluated on the match immediately prior. A five-match win run
  //    contributes three observations to 'after W3+'. Record covers all 678
  //    matches; yield covers priced matches only, so the two denominators
  //    differ."
  //
  // Read literally, the observation is the NEXT match and the state is how many
  // consecutive same-result matches preceded it. Walk W W W W W: the 2nd match
  // is observed after W1, the 3rd after W2, the 4th after W3+, the 5th after
  // W4 = W3+, and the match that ended the run after W5 = W3+. Three in W3+ —
  // the sentence is a test of the shape, and this implementation passes it.
  var FOLLOW_STATES = ['W1', 'W2', 'W3+', 'L1', 'L2', 'L3+'];
  function followStats(rows) {
    var seq = calRunRows(rows);
    var acc = {};
    FOLLOW_STATES.forEach(function (s) { acc[s] = { w: 0, l: 0, cents: 0, priced: 0 }; });
    var base = { w: 0, l: 0, cents: 0, priced: 0 };
    var res = null, len = 0;
    for (var i = 0; i < seq.length; i++) {
      var m = seq[i];
      if (i > 0) {
        var b = acc[res + (len >= 3 ? '3+' : String(len))];
        if (b) {
          if (m.won) b.w++; else b.l++;
          if (m.cents != null) { b.cents += m.cents; b.priced++; }
        }
      }
      if (m.won) base.w++; else base.l++;
      if (m.cents != null) { base.cents += m.cents; base.priced++; }
      var r = m.won ? 'W' : 'L';
      if (r === res) len++; else { res = r; len = 1; }
    }
    return { rows: acc, base: base };
  }
  // The file's gate() (:1979-1982), applied per column against its OWN
  // denominator: full figure at n>=10, the same figure plus a "*" at 5-9, the
  // figure suppressed under 5 (the record beside it still carries the W-L), a
  // dash at 0.
  function followGate(k) {
    if (!k) return { show: 'dash', mark: '' };
    if (k >= 10) return { show: 'full', mark: '' };
    if (k >= 5) return { show: 'full', mark: '*' };
    return { show: 'hide', mark: '' };
  }
  /** cents/priced IS the percentage yield: 100 cents = 1 unit = 100% of stake. */
  function followYield(b) { return b.priced ? b.cents / b.priced : null; }

  function renderFollowsCard(rows, n) {
    var f = followStats(rows);
    var baseY = followYield(f.base);
    var HEAD = 'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
      'letter-spacing:0.2em;text-transform:uppercase;color:#3f4860;padding-bottom:9px;';
    var TRACK = 'display:grid;grid-template-columns:118px 176px minmax(56px,0.6fr) ' +
      'minmax(76px,1fr) minmax(86px,1fr) minmax(72px,0.8fr);gap:0 16px;width:100%;align-items:stretch;';
    var MONO = 'font-family:\'IBM Plex Mono\',monospace;';
    var RULE = 'border-top:1px solid rgba(255,255,255,0.05);';
    var BRULE = 'border-top:1px solid rgba(255,255,255,0.09);';
    var head = ['State', 'Next match', 'n', 'Yield', 'Vs baseline', 'n priced']
      .map(function (h, i) {
        return '<span style="' + HEAD + (i >= 2 ? 'text-align:right;' : '') + '">' + esc(h) + '</span>';
      }).join('');

    var body = FOLLOW_STATES.map(function (id) {
      var b = f.rows[id];
      var nAll = b.w + b.l;
      var g = followGate(nAll);
      var y = followYield(b), yg = followGate(b.priced);
      var vsOk = b.priced >= 5 && y != null && baseY != null;
      var vs = vsOk ? y - baseY : null;
      var rate = g.show === 'full' ? (b.w / nAll * 100).toFixed(1) + '%'
        : g.show === 'dash' ? DASH : '';
      var yTxt = yg.show === 'full' && y != null ? signed(y, 1, '%')
        : yg.show === 'dash' ? DASH : '';
      var yCol = yg.show === 'full' && y != null
        ? (y > 0 ? '#3dd68c' : y < 0 ? '#e0616f' : '#8b96b5') : DASH_COLOUR;
      return '<span style="display:flex;align-items:center;font-size:15px;font-weight:800;' +
          'letter-spacing:-0.015em;color:#e7e9ee;padding:11px 0;' + RULE + '">after ' + esc(id) + '</span>' +
        '<span style="display:flex;flex-direction:column;gap:4px;justify-content:center;padding:11px 0;' + RULE + '">' +
          '<span style="display:flex;align-items:baseline;gap:8px;">' +
            '<span style="' + MONO + 'font-size:11px;color:#8b96b5;">' +
              esc(nAll ? 'W' + b.w + ENDASH + 'L' + b.l : DASH) + '</span>' +
            '<span style="' + MONO + 'font-size:13px;color:' +
              (g.show === 'full' ? '#e7e9ee' : DASH_COLOUR) + ';">' + esc(rate) + '</span>' +
            '<span style="' + MONO + 'font-size:9px;color:#4b5672;">' + g.mark + '</span></span>' +
          '<span style="display:flex;height:5px;border-radius:2px;overflow:hidden;' +
            'background:rgba(224,97,111,0.28);">' +
            '<span style="width:' + (nAll ? (b.w / nAll * 100).toFixed(1) : 0) + '%;' +
            'background:rgba(61,214,140,0.55);"></span></span></span>' +
        '<span style="display:flex;align-items:center;justify-content:flex-end;' + MONO +
          'font-size:11px;color:#5b6880;padding:11px 0;' + RULE + '">' + nAll + '</span>' +
        '<span style="display:flex;align-items:baseline;justify-content:flex-end;gap:3px;padding:11px 0;' + RULE + '">' +
          '<span style="' + MONO + 'font-size:12px;color:' + yCol + ';">' + esc(yTxt) + '</span>' +
          '<span style="' + MONO + 'font-size:9px;color:#4b5672;">' + yg.mark + '</span></span>' +
        '<span style="display:flex;align-items:center;justify-content:flex-end;' + MONO +
          'font-size:17px;font-weight:700;color:' +
          (vsOk ? (vs > 0 ? '#3dd68c' : vs < 0 ? '#e0616f' : '#8b96b5') : DASH_COLOUR) +
          ';padding:11px 0;' + RULE + '">' + (vsOk ? esc(signed(vs, 1, 'pp')) : DASH) + '</span>' +
        '<span style="display:flex;align-items:center;justify-content:flex-end;' + MONO +
          'font-size:11px;color:#5b6880;padding:11px 0;' + RULE + '">' + b.priced + '</span>';
    }).join('');

    var bn = f.base.w + f.base.l;
    var baseRow =
      '<span style="display:flex;align-items:center;font-size:15px;font-weight:800;' +
        'letter-spacing:-0.015em;color:#8b96b5;padding:11px 0;' + BRULE + '">baseline</span>' +
      '<span style="display:flex;align-items:baseline;gap:8px;padding:11px 0;' + BRULE + '">' +
        '<span style="' + MONO + 'font-size:11.5px;color:#8b96b5;">' +
          esc(bn ? 'W' + f.base.w + ENDASH + 'L' + f.base.l : DASH) + '</span>' +
        '<span style="' + MONO + 'font-size:11px;color:#8b96b5;">' +
          esc(bn ? (f.base.w / bn * 100).toFixed(1) + '%' : DASH) + '</span></span>' +
      '<span style="display:flex;align-items:center;justify-content:flex-end;' + MONO +
        'font-size:11px;color:#5b6880;padding:7px 0;' + BRULE + '">' + bn + '</span>' +
      '<span style="display:flex;align-items:center;justify-content:flex-end;' + MONO +
        'font-size:11px;color:#8b96b5;padding:7px 0;' + BRULE + '">' +
        (baseY == null ? DASH : esc(signed(baseY, 1, '%'))) + '</span>' +
      '<span style="display:flex;align-items:center;justify-content:flex-end;' + MONO +
        'font-size:11px;color:#4b5672;padding:7px 0;' + BRULE + '">' + DASH + '</span>' +
      '<span style="display:flex;align-items:center;justify-content:flex-end;' + MONO +
        'font-size:11px;color:#5b6880;padding:7px 0;' + BRULE + '">' + f.base.priced + '</span>';

    // Item 23 · the file's own note, with this player's real counts in it.
    var note = 'State is evaluated on the match immediately prior. A five-match win run ' +
      'contributes three observations to ' + '“after W3+”' + '. Record covers all ' + n +
      ' matches; yield covers the ' + f.base.priced + ' priced matches only, so the two ' +
      'denominators differ.';

    return '<div style="margin-top:26px;display:grid;grid-template-columns:minmax(0,1fr);gap:14px;' +
      'align-items:stretch;"><div style="background:#0a0d14;border:1px solid rgba(255,255,255,0.09);' +
      'border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;min-width:0;' +
      'box-sizing:border-box;">' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;margin-bottom:10px;">' +
        'What follows a run ' + MIDDOT + ' career</div>' +
      '<div style="' + TRACK + '">' + head + body + baseRow + '</div>' +
      '<div style="margin-top:auto;padding-top:12px;font-size:11px;line-height:1.65;color:#5b6880;">' +
        esc(note) + '</div></div></div>';
  }

  function renderStreakTab(p, seg) {
    // Ruling cal-2: the CAREER spine, the same rows the Calendar tab counts.
    // Item 25 · M is calSpineFiltered().length for the tiles, the timeline, the
    // footnote AND the modal subtitle (modalSubtitle 'season' reads calScope(),
    // which is the same array). The 819 the founder saw is `careerByYear`, a
    // different store that the subtitle stopped reading in the Calendar pass —
    // it is not a second M, and nothing on this tab counts it.
    var rows = calSpineFiltered(p);
    var runs = calRuns(rows);
    var skipped = calRunsSkipped(rows);
    var seqN = rows.length - skipped;              // Sum(run lengths), by construction
    var n = rows.length;
    var wins = calRunRows(rows).filter(function (r) { return r.won; }).length;
    var pr = seqN ? wins / seqN : 0;
    var longestW = runs.filter(function (r) { return r.res === 'W'; })
      .sort(function (a, b) { return b.len - a.len; })[0] || null;
    var longestL = runs.filter(function (r) { return r.res === 'L'; })
      .sort(function (a, b) { return b.len - a.len; })[0] || null;
    var obs5 = runs.filter(function (r) { return r.len >= 5; }).length;
    // Item 28 · every expected figure comes from the file's own script, quoted
    // in expectedRuns5()/expectedLongest() above, over THIS player's rate and
    // match count — never a tour average. The loss-run expectation is the same
    // Erdos-Renyi form with p and (1-p) exchanged (:1877-1878).
    var exp5 = expectedRuns5(seqN, pr);
    var expW = expectedLongest(seqN, pr);
    var expL = expectedLongest(seqN, 1 - pr);

    var tiles = '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;' +
      'margin-bottom:20px;">' +
      streakTile('Runs of 5+', String(obs5),
        (exp5 == null ? '' : 'expected ' + exp5 + ' ' + MIDDOT + ' ') + runs.length + ' runs') +
      streakTile('Longest win run', longestW ? String(longestW.len) : DASH, runSpan(longestW, false)) +
      streakTile('Longest loss run', longestL ? String(longestL.len) : DASH,
        longestL ? (expL == null ? '' : 'expected ' + expL + ' ' + MIDDOT + ' ') + runSpan(longestL, false) : DASH) +
      streakTile('Expected longest', expW == null ? DASH : String(expW),
        expW == null ? 'undefined at this win rate'
          : 'at ' + (pr * 100).toFixed(1) + '% over ' + seqN + ' matches') + '</div>';

    // ── items 6-11 · the run timeline ────────────────────────────────────────
    // One chart around ONE mid rule (:263-272): the container is 140px with the
    // rule absolutely at top:50%, and each bar is a 6px column of three spans
    // whose heights place it above or below 68px. The previous build used
    // justify-content, which pinned win bars to the container floor instead of
    // the rule and split the chart into two disconnected strips.
    var maxRun = runs.reduce(function (a, x) { return Math.max(a, x.len); }, 1);
    var RW = 7;                                     // 6px bar + 1px gap (:1894)
    var bars = runs.map(function (x, i) {
      var hh = Math.max(3, Math.round(x.len / maxRun * 68));
      var on = state.calRun === i;
      var up = x.res === 'W';
      var col = up ? (on ? '#3dd68c' : 'rgba(61,214,140,0.62)')
        : (on ? '#e0616f' : 'rgba(224,97,111,0.55)');
      return '<span data-pp2="cal-run" data-v="' + i + '" title="' + esc(x.res + x.len) + '" ' +
        'style="width:6px;flex:none;height:100%;display:flex;flex-direction:column;cursor:pointer;">' +
        '<span style="display:block;height:' + (up ? (68 - hh) : 68) + 'px;"></span>' +
        '<span style="display:block;height:' + hh + 'px;background:' + col + ';border-radius:1px;' +
          'transition:background .14s ease;"></span>' +
        '<span style="display:block;height:' + (up ? 68 : (68 - hh)) + 'px;"></span></span>';
    }).join('');
    // Item 9 · year ticks, one per season, each as wide as the runs that STARTED
    // in it (:1895-1896) so the tick lines up with the first bar of that year.
    var yrOrder = [], yrCount = {};
    runs.forEach(function (x) {
      var y = String(x.from).slice(0, 4);
      if (!yrCount[y]) { yrCount[y] = 0; yrOrder.push(y); }
      yrCount[y]++;
    });
    var ticks = yrOrder.map(function (y) {
      return '<span style="width:' + (yrCount[y] * RW) + 'px;flex:none;box-sizing:border-box;' +
        'border-left:1px solid rgba(255,255,255,0.09);font-family:\'IBM Plex Mono\',monospace;' +
        'font-size:9.5px;font-weight:600;letter-spacing:0.12em;color:#5b6880;padding:6px 0 0 5px;">' +
        esc(y) + '</span>';
    }).join('');

    var timeline =
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:26px 0 12px;">' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
          'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;">Run timeline ' +
          MIDDOT + ' career order</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#4b5672;">' +
          runs.length + ' runs ' + MIDDOT + ' longest ' + maxRun + '</span></div>' +
      '<div class="pp2-xscroll" style="overflow-x:auto;padding-bottom:4px;">' +
        '<div style="width:' + (runs.length * RW - 1) + 'px;">' +
          '<div style="position:relative;display:flex;align-items:center;gap:1px;height:140px;">' +
            '<span style="position:absolute;left:0;right:0;top:50%;height:1px;' +
              'background:rgba(255,255,255,0.12);"></span>' + bars + '</div>' +
          '<div style="display:flex;">' + ticks + '</div></div></div>';

    // ── items 12-18 · the run detail ────────────────────────────────────────
    var detail = '<div style="margin:12px 0 0;font-family:\'IBM Plex Mono\',monospace;font-size:10px;' +
      'letter-spacing:0.1em;text-transform:uppercase;color:#4b5672;">Click a run for its matches</div>';
    var sel = runs[state.calRun];
    if (sel) {
      // Integer cents, per the money rule the rest of this modal already follows
      // — a float sum re-ordered moved a painted card by 0.01u once already.
      var spc = 0, spn = 0;
      sel.rows.forEach(function (r) { if (r.cents != null) { spc += r.cents; spn++; } });
      // Item 14 · units AND yield AND the priced count, all three (:1944). Yield
      // is units/priced, the same cents-per-priced-match figure the Calendar
      // drill prints, so the two panels cannot drift apart.
      var syld = spn ? spc / spn : null;
      var plLine = spn
        ? signed(spc / 100, 2) + 'u ' + MIDDOT + ' ' + signed(syld, 1, '%') + ' ' + MIDDOT + ' ' +
          spn + ' priced'
        : DASH + ' ' + MIDDOT + ' no priced match in this run';
      var TRACK = 'display:grid;grid-template-columns:14px 36px minmax(0,1.1fr) minmax(0,1fr) ' +
        '104px 48px 48px 56px;gap:0 14px;align-items:center;';
      var HEAD = 'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;padding-bottom:7px;';
      // The OPPONENT cell is the one column the file leaves in the page font
      // (:300) — every other cell is mono — so the shared part stops short of
      // font-family and each cell adds its own.
      var CELL = 'padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);';
      var MONOF = 'font-family:\'IBM Plex Mono\',monospace;';
      var colHead = '<span></span>' +
        '<span style="' + HEAD + '">Rd</span>' +
        '<span style="' + HEAD + '">Event</span>' +
        '<span style="' + HEAD + '">Opponent</span>' +
        '<span style="' + HEAD + '">Score</span>' +
        '<span style="' + HEAD + 'text-align:right;">Home</span>' +
        '<span style="' + HEAD + 'text-align:right;">Away</span>' +
        '<span style="' + HEAD + 'text-align:right;">P&amp;L</span>';
      // Item 18 · EVERY cell of a row carries the sheet hook, because the grid
      // is one flat track (the file has no row wrapper here, :296-305) and a
      // hook on a wrapper that does not exist would open nothing.
      var body = sel.rows.map(function (r) {
        var m = sheetHook(r.sheetId) + 'style="' + sheetCursor() + CELL + MONOF;
        var t = sheetHook(r.sheetId) + 'style="' + sheetCursor() + CELL;
        var plCol = r.cents == null ? DASH_COLOUR
          : r.cents > 0 ? '#3dd68c' : r.cents < 0 ? '#e0616f' : '#8b96b5';
        return '<span ' + m + 'font-size:11px;font-weight:700;color:' +
            (r.won ? '#3dd68c' : '#e0616f') + ';">' + (r.won ? 'W' : 'L') + '</span>' +
          '<span ' + m + 'font-size:10.5px;color:#5b6880;">' + esc(r.round || DASH) + '</span>' +
          '<span ' + m + 'font-size:11px;color:#8a93a6;overflow:hidden;text-overflow:ellipsis;' +
            'white-space:nowrap;">' + esc(r.event || DASH) + '</span>' +
          '<span ' + t + 'font-size:12.5px;color:#e7e9ee;overflow:hidden;' +
            'text-overflow:ellipsis;white-space:nowrap;">' +
            esc(r.opp ? surnameFirst(r.opp) : DASH) + '</span>' +
          '<span ' + m + 'font-size:11.5px;color:#8b96b5;white-space:nowrap;">' +
            esc(scoreWithStatus(r, r.score)) + '</span>' +
          '<span ' + m + 'font-size:11.5px;font-weight:700;text-align:right;color:' +
            (r.price == null ? DASH_COLOUR : '#e7e9ee') + ';">' +
            (r.price == null ? DASH : r.price.toFixed(2)) + '</span>' +
          '<span ' + m + 'font-size:11.5px;text-align:right;color:' +
            (r.oppPrice == null ? DASH_COLOUR : '#5b6880') + ';">' +
            (r.oppPrice == null ? DASH : r.oppPrice.toFixed(2)) + '</span>' +
          '<span ' + m + 'font-size:11.5px;text-align:right;color:' + plCol + ';">' +
            (r.cents == null ? DASH : signed(r.cents / 100, 2)) + '</span>';
      }).join('');
      detail = '<div style="margin:12px 0 0;box-sizing:border-box;background:#06070a;' +
        'border:1px solid rgba(91,155,255,0.3);border-radius:10px;padding:12px 14px;">' +
        '<div style="display:flex;align-items:baseline;gap:11px;margin-bottom:2px;">' +
          '<span style="font-size:12.5px;font-weight:700;">' +
            esc((sel.res === 'W' ? 'Winning run' : 'Losing run') + ' ' + MIDDOT + ' ' + sel.len +
              (sel.len === 1 ? ' match' : ' matches')) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:600;' +
            'letter-spacing:0.12em;text-transform:uppercase;color:#5b6880;">' +
            esc(runSpan(sel, true)) + '</span>' +
          '<span style="margin-left:auto;font-family:\'IBM Plex Mono\',monospace;font-size:15px;' +
            'font-weight:700;text-align:right;white-space:nowrap;color:' +
            (spn === 0 ? DASH_COLOUR : spc > 0 ? '#3dd68c' : spc < 0 ? '#e0616f' : '#8b96b5') + ';">' +
            esc(plLine) + '</span></div>' +
        '<div style="' + TRACK + 'margin-top:10px;">' + colHead + body + '</div></div>';
    }

    return tiles + seg + timeline + detail + renderFollowsCard(rows, seqN) +
      calStreakScopeNote(p, seqN, skipped, pr);
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

  /**
   * §8.1 · venue -> Tennis Abstract reading, for a CAREER-SPINE row.
   *
   * The dictionary is built by build-court-speed-map.js, which resolves every name
   * it can see with the full matcher (substring, then canonical identity, then the
   * voted table) and ships the answer. Nothing is matched here: a name either has a
   * venue in the table or it is unbandable, and there is no third outcome the page
   * can invent. `direct` exists only as a floor for a name the table has never seen
   * — a tournament added after the map was last built — and is the same plain
   * `includes` test the builder's own first tier uses.
   */
  function speedInfoFor(display, raw, surface, court) {
    var map = (typeof window !== 'undefined') ? window.courtSpeedMap : null;
    if (!map || !map.venues) return null;
    var venue = null, names = map.apiNames || {};
    if (raw && names[raw]) venue = names[raw];
    else if (display && names[display]) venue = names[display];
    else {
      var keys = Object.keys(map.venues);
      for (var i = 0; i < keys.length; i++) {
        if ((raw && String(raw).indexOf(keys[i]) > -1) ||
            (display && String(display).indexOf(keys[i]) > -1)) { venue = keys[i]; break; }
      }
    }
    if (!venue || !map.venues[venue]) return null;
    // Surface guard, the same one build-market-edge.js applies: a row from an era
    // the venue no longer plays is NOT banded off today's reading (Stuttgart's clay
    // years cannot be rated by a 2025 grass number). The guard key is
    // "Surface/Court", and the career spine knows its court only where the odds
    // join landed — so the surface half is always checked and the court half only
    // when we actually hold one. Guarding on a court we do not know would silently
    // unband most of the spine, which is the opposite of the guard's purpose.
    var guard = (map.surfaceGuard || {})[venue];
    if (guard && guard.keep) {
      var keep = String(guard.keep).split('/');
      var sTitle = surface ? String(surface).charAt(0).toUpperCase() + String(surface).slice(1) : null;
      if (sTitle && keep[0] && keep[0] !== '?' && sTitle !== keep[0]) return null;
      if (court && keep[1] && keep[1] !== '?' && String(court) !== keep[1]) return null;
    }
    return { venue: venue, speed: map.venues[venue].speed, ratingYear: map.venues[venue].ratingYear };
  }

  /**
   * §8.1 · the population the bands are counted from.
   *
   * This used to return the market-edge shard — the PRICED archive, 727 rows for
   * Zverev — which meant a match needed a bet365 price before it could be called a
   * fast-court match. That is the wrong test: a match needs its VENUE's rating to be
   * banded, and its price only to contribute units. So the bands now count off
   * calSpine(), the identical spine Calendar and Streaks use (775 for Zverev), and
   * `cents` carries the Pinnacle P&L for the priced subset.
   *
   * Grass keeps the founder's 2026-09-16 ruling: always Very fast, rating or not.
   */
  /**
   * The PRICED market-shard rows — §5.6's population, and what speedRows() used to
   * return before §8.1 moved Court speed onto the career spine.
   *
   * These two populations must not be conflated again. §5.6 keys every row on
   * `oppArchetype`, which only build-market-edge.js stamps, and sums `pl` off the
   * row itself; the career spine carries neither. Pointing §5.6 at the spine leaves
   * its eight archetype rows structurally intact and numerically empty — eight
   * labels reading 0-0 — which looks like a player who has never met anyone rather
   * than like a broken join. It is split out under its own name so the next person
   * to repoint one modal cannot silently take the other with it.
   */
  function marketRows(p) {
    var mk = marketFor(p.key);
    return (mk && mk.matches) ? mk.matches : [];
  }

  function speedRows(p) {
    var spine = calSpine(p);
    var map = (typeof window !== 'undefined') ? window.courtSpeedMap : null;
    if (speedRows._k === p.key && speedRows._s === spine && speedRows._m === map && speedRows._v) {
      return speedRows._v;
    }
    var out = spine.map(function (r) {
      var info = speedInfoFor(r.event, r.tournament, r.surface, r.court);
      return {
        date: r.date, year: r.year, won: r.won, surface: r.surface, court: r.court,
        event: r.event, level: r.level, round: r.round, opp: r.opp,
        sets: r.sets, score: r.score, retired: r.retired, wo: r.wo,
        price: r.price, oppPrice: r.oppPrice, cents: r.cents,
        venue: info ? info.venue : null,
        speed: info ? info.speed : null,
        ratingYear: info ? info.ratingYear : null,
        sheetId: r.sheetId
      };
    });
    speedRows._k = p.key; speedRows._s = spine; speedRows._m = map; speedRows._v = out;
    return out;
  }

  function speedSurfaceMatch(m, surf) {
    if (surf === 'all') return true;
    // Indoors is a COURT TYPE carved out of the court column, not a surface. The
    // spine knows its court only where the odds join landed, so this chip filters a
    // smaller population than the others by construction — the chip's own count
    // states what it found rather than implying the rest are outdoor.
    if (surf === 'Indoors') return String(m.court || '') === 'Indoor';
    return String(m.surface || '').toLowerCase() === String(surf).toLowerCase();
  }

  /**
   * Bands for the current surface chip. Returns every band including empty ones —
   * §5.5 keeps under-minimum bands listed with a dash rather than dropping them,
   * because an absent band reads as an absent court, not an absent sample.
   */
  function speedBands(p) {
    var surf = state.speedSurf || 'all';
    var agg = {};
    SPEED_BANDS.forEach(function (b) { agg[b.id] = { band: b, won: 0, lost: 0, cents: 0, priced: 0, rows: [] }; });
    var unbanded = 0, scoped = 0;
    speedRows(p).forEach(function (m) {
      if (!speedSurfaceMatch(m, surf)) return;
      scoped += 1;
      var b = speedBandForRow(m);
      if (!b) { unbanded += 1; return; }
      var a = agg[b.id];
      if (m.won) a.won += 1; else a.lost += 1;
      a.rows.push(m);
      // §8.1 splits the two scopes that used to coincide. Every row here is a CAREER
      // row, so `rows.length` is the banded match count; only the subset carrying a
      // Pinnacle price contributes units, and `priced` counts exactly that subset.
      // Summing units over the banded count instead is the error the design guards
      // against with its own "on N listed" label.
      if (m.cents != null) { a.cents += m.cents; a.priced += 1; }
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
    out.scoped = scoped;
    return out;
  }

  /**
   * §8.3 · the best band — ONE definition, used by both the box headline and the
   * modal's default selection, so the two can never name different bands.
   *
   * "Largest POSITIVE gap between the band's win rate and his win rate over all
   * speed-rated matches, n >= 10, tie -> larger n; none -> dash." The baseline is
   * deliberately his rated-match rate and not his career rate: the bands only
   * partition rated matches, so measuring the gap against a population the bands
   * do not cover would credit a band for the venues we cannot rate.
   *
   * Positive-only is load-bearing. A player with no band above his own baseline has
   * no "best" court speed, and the honest answer there is a dash — not the least-bad
   * band dressed up as a strength.
   */
  function speedBestBand(bands) {
    var bw = 0, bl = 0;
    bands.forEach(function (b) { bw += b.won; bl += b.lost; });
    var base = (bw + bl) ? bw / (bw + bl) : null;
    if (base == null) return null;
    var best = null;
    bands.forEach(function (b) {
      var n = b.won + b.lost;
      if (n < 10) return;
      var gap = (b.won / n) - base;
      if (gap <= 0) return;
      if (!best || gap > best.gap || (gap === best.gap && n > best.n)) {
        best = { band: b, gap: gap, n: n };
      }
    });
    return best;
  }

  /** The band the panel shows: the current selection if it can open, else §8.3's best. */
  function speedSelected(bands) {
    var openable = bands.filter(function (b) { return gateFor(b.won + b.lost) !== GATE.NONE && gateFor(b.won + b.lost) !== GATE.THIN; });
    var cur = state.speedBand;
    var hit = cur && openable.filter(function (b) { return b.band.id === cur; })[0];
    if (hit) return hit;
    var best = speedBestBand(bands);
    if (best && openable.indexOf(best.band) > -1) return best.band;
    return openable[0] || null;
  }

  /** The §5.5 empty box, so the pending and settled copies cannot drift apart. */
  function speedEmptyBox(copy) {
    return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
      'text-align:center;font-size:13px;color:#5b6880;">' + copy + '</div>';
  }

  function renderSpeedModal(p) {
    var bands = speedBands(p);
    var total = speedRows(p).length;
    // PENDING IS CHECKED BEFORE EMPTY, and the order is the whole point: a zero
    // row count is what an unsettled store and a genuinely empty one look like
    // from here, and only the store itself can tell them apart. Reversing these
    // two branches re-states a network fact as a fact about the player.
    if (!total && !careerHistorySettled(p.key)) {
      return speedEmptyBox('The career match store has not loaded, so no court can be rated yet.');
    }
    if (!total) {
      return speedEmptyBox('No matches on record, so no court can be rated.');
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
      var on = !!(sel && sel.band.id === b.band.id);
      // §8.8 · a WHOLE number. rateText() prints one decimal ("73.0%") and the
      // design prints "72%", so the gate is reused for the decision and the
      // rounding is done here rather than loosening a shared formatter every other
      // block depends on.
      var rate = (gate === GATE.NONE || gate === GATE.THIN) ? DASH : Math.round(100 * b.won / n) + '%';
      var meta = !n
        ? 'no matches on record'
        : (gate === GATE.THIN
            ? recordText(b.won, b.lost) + ' ' + MIDDOT + ' ' + n + ' match' + (n === 1 ? '' : 'es') + ' ' + MIDDOT + ' under minimum'
            : recordText(b.won, b.lost) + ' ' + MIDDOT + ' ' + n + ' matches' +
              (gate === GATE.SMALL ? ' ' + MIDDOT + ' small sample' : ''));
      return '<div' + (openable ? ' data-pp2="speed-band" data-v="' + b.band.id + '"' : '') +
        ' style="position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;' +
        'border-radius:9px;padding:11px 13px;align-items:center;' +
        'border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'rgba(255,255,255,0.07)') + ';' +
        'background:' + (on ? 'rgba(91,155,255,0.10)' : (openable ? '#06070a' : 'rgba(255,255,255,0.012)')) + ';' +
        'cursor:' + (openable ? 'pointer' : 'default') + ';">' +
        // §8.7 · units sit ABSOLUTE in the card's top-right corner, not stacked
        // above the rate in the right-hand column.
        '<span style="position:absolute;top:6px;right:9px;font-family:\'IBM Plex Mono\',monospace;' +
          'font-size:10px;font-weight:700;color:' +
          (b.priced ? (b.cents >= 0 ? '#3dd68c' : '#e0616f') : DASH_COLOUR) + ';">' +
          (b.priced ? signed(b.cents / 100, 1, 'u') : DASH) + '</span>' +
        '<div style="min-width:0;">' +
          '<div style="font-size:13px;font-weight:700;white-space:nowrap;color:' +
            (gate === GATE.THIN || gate === GATE.NONE ? '#5b6880' : (on ? '#e7e9ee' : '#c6ccdb')) + ';">' +
            esc(b.band.label) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#4b5672;' +
            'margin-top:3px;white-space:nowrap;">' + esc(meta) + '</div>' +
        '</div>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;color:' +
          (rate === DASH ? '#3f4860' : gate === GATE.SMALL ? '#8b96b5' : '#e7e9ee') + ';">' + rate + '</span>' +
      '</div>';
    }).join('');

    // §8.10 · CAREER totals. Summed from the SAME band objects the cards render, so
    // the row cannot disagree with the list above it (§4 reconciliation): the match
    // count is Σ band matches — the RATED population, not the career total — and the
    // footnote below carries the difference.
    var tw = 0, tl = 0, tcents = 0, tpriced = 0;
    bands.forEach(function (b) { tw += b.won; tl += b.lost; tcents += b.cents; tpriced += b.priced; });
    var tn = tw + tl;
    var surfLabel = (state.speedSurf || 'all') === 'all' ? 'Career' : 'Career ' + MIDDOT + ' ' + state.speedSurf;
    var trate = (gateFor(tn) === GATE.NONE || gateFor(tn) === GATE.THIN) ? DASH : Math.round(100 * tw / tn) + '%';
    var footer = '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;' +
      'padding:12px 13px 0;margin-top:6px;border-top:1px solid rgba(255,255,255,0.09);align-items:center;">' +
      '<div style="min-width:0;">' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
          'letter-spacing:0.14em;text-transform:uppercase;color:#5b6880;white-space:nowrap;">' +
          esc(surfLabel) + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#4b5672;' +
          'margin-top:4px;white-space:nowrap;">' + (tn ? tn + ' matches' : DASH) + '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">' +
        '<span style="display:flex;align-items:baseline;gap:6px;">' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:600;color:' +
            (tpriced ? (tcents >= 0 ? '#3dd68c' : '#e0616f') : DASH_COLOUR) + ';">' +
            (tpriced ? signed(tcents / 100, 1, 'u') : DASH) + '</span>' +
          // FILE vs §8.1, reported: the .dc.html labels this "on N listed", where
          // every listed row was priced by construction. §8.1 separates the two —
          // the list is CAREER rows, units are the PRICED subset — so "listed"
          // would now name a number the units were not summed over. The word is
          // changed to keep the label true to its figure; the geometry is the
          // file's, untouched.
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;color:#4b5672;white-space:nowrap;">' +
            (tpriced ? 'on ' + tpriced + ' priced' : '') + '</span>' +
        '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:600;color:' +
          (trate === DASH ? DASH_COLOUR : '#8b96b5') + ';">' + trate + '</span>' +
      '</div>' +
    '</div>';

    return '' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">' + chips + '</div>' +
      '<div class="pp2-speed" style="display:grid;grid-template-columns:268px minmax(0,1fr);gap:18px;align-items:start;">' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' + cards + footer + '</div>' +
        renderSpeedPanel(sel, bands) +
      '</div>' +
      renderSpeedNote(bands, total);
  }

  function renderSpeedPanel(sel, bands) {
    if (!sel) {
      return '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:10px;' +
        'overflow:hidden;"><div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;' +
        'padding:26px;margin:18px;text-align:center;font-size:13px;color:#5b6880;">' +
        'No band clears the five-match minimum, so none opens.</div></div>';
    }
    // §8.11 · the header states the band's record, rate and n, then how much of it
    // is on screen. The old build put SPEED_BASIS here instead; the founder moved
    // that sentence to the footnote, where a basis note belongs.
    var sn = sel.won + sel.lost;
    var srate = (gateFor(sn) === GATE.NONE || gateFor(sn) === GATE.THIN) ? DASH : Math.round(100 * sel.won / sn) + '%';
    var shown = sel.rows.length;
    var head = '<div style="display:flex;align-items:center;gap:11px;padding:13px 16px;' +
      'border-bottom:1px solid rgba(255,255,255,0.07);">' +
      '<span style="font-size:13.5px;font-weight:700;white-space:nowrap;">' + esc(sel.band.label) + ' courts</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#8b96b5;' +
        'white-space:nowrap;flex:none;">' +
        recordText(sel.won, sel.lost) + ' ' + MIDDOT + ' ' + srate + ' ' + MIDDOT + ' ' + sn + ' matches</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#4b5672;' +
        'white-space:nowrap;flex:none;margin-left:auto;">' +
        (shown < sn ? 'Showing ' + shown + ' of ' + sn : 'All ' + shown + ' matches') + '</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;' +
        'white-space:nowrap;flex:none;color:' +
        (sel.priced ? (sel.cents >= 0 ? '#3dd68c' : '#e0616f') : DASH_COLOUR) + ';">' +
        (sel.priced ? signed(sel.cents / 100, 1, 'u') : DASH) + '</span>' +
    '</div>';

    // Newest first, grouped by event — the design groups a run of matches under the
    // tournament they were played at rather than repeating the event on every row.
    var rows = sel.rows.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var out = '', lastGroup = null;
    rows.forEach(function (m) {
      var g = m.event + '|' + m.date.slice(0, 4);
      if (g !== lastGroup) {
        lastGroup = g;
        // §8.17 · title is "{Display name} {year}"; meta is "{surface} · {level}".
        // Indoors REPLACES the surface rather than being appended to it — the old
        // build printed "Hard · Indoors", which reads as two surfaces. The level is
        // printed only when the real tier is on the match; career-history's own
        // 'atp'/'chitf' scope is never substituted for one.
        var surfWord = m.court === 'Indoor'
          ? 'Indoors'
          : (m.surface ? String(m.surface).charAt(0).toUpperCase() + String(m.surface).slice(1) : null);
        out += '<div style="grid-column:1 / -1;display:flex;align-items:center;gap:10px;' +
          'padding:8px 0 4px;border-top:1px solid rgba(255,255,255,0.07);">' +
          // tournDisplayName(name, level) APPENDS the tier ("Rome" -> "Rome Masters
          // 1000"), which §5.3 wants because its rows carry no separate meta line.
          // Here the tier already has its own column, so passing the level prints it
          // twice — "Rome Masters 1000 2026 · Clay · Masters 1000", measured in the
          // browser. The design's own group titles ("Estoril", "Madrid Masters")
          // carry no tier either. Passing null takes the display-name map alone.
          '<span style="font-size:12.5px;font-weight:700;white-space:nowrap;">' +
            esc(tournDisplayName(m.event, null) + ' ' + m.date.slice(0, 4)) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#4b5672;white-space:nowrap;">' +
            esc([surfWord, m.level].filter(Boolean).join(' ' + MIDDOT + ' ')) + '</span>' +
        '</div>';
      }
      var hook = sheetHook(m.sheetId || (m.date + '|' + m.opp));
      var cell = 'cursor:pointer;padding:5px 0;';
      out +=
        '<span ' + hook + 'style="' + cell + 'font-family:\'IBM Plex Mono\',monospace;font-size:11px;' +
          'color:#5b6880;">' + esc(shortDate(m.date)) + '</span>' +
        // §8.14 · a coloured square dot, not a "W"/"L" letter.
        '<span ' + hook + 'style="cursor:pointer;width:8px;height:8px;border-radius:2px;background:' +
          (m.won ? '#3dd68c' : '#e0616f') + ';"></span>' +
        // §8.15 · the opponent is the page's sans face, not mono.
        '<span ' + hook + 'style="' + cell + 'font-size:12.5px;overflow:hidden;text-overflow:ellipsis;' +
          'white-space:nowrap;">' + esc(m.opp || DASH) + '</span>' +
        // §8.16 · draw-size codes. calSpine() already labels through roundLabel(),
        // which resolves R16/R32/R64/R128 from the proven draw size — the old build
        // read the ARCHIVE's prose ("1st Round") and printed R1-R4 at the Slams.
        '<span ' + hook + 'style="' + cell + 'font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;' +
          'color:#5b6880;">' + esc(m.round || DASH) + '</span>' +
        // §8.4 · SETS, from the player's side, coloured by result.
        '<span ' + hook + 'style="' + cell + 'font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;' +
          'font-weight:700;color:' + (m.sets ? (m.won ? '#3dd68c' : '#e0616f') : DASH_COLOUR) + ';">' +
          esc(m.sets || DASH) + '</span>' +
        // §8.5 · SET SCORES. career-history carries none (0 of 89,719 rows); the only
        // per-set source we hold is recentForm, which calSpine() already joins on
        // ±0 days. Outside that rolling window this dashes with a stated reason
        // rather than inventing a scoreline.
        '<span ' + hook + 'style="' + cell + 'font-family:\'IBM Plex Mono\',monospace;font-size:11px;' +
          'color:' + ((perSetScore(m) || matchStatus(m)) ? '#8b96b5' : DASH_COLOUR) + ';white-space:nowrap;">' +
          esc(scoreWithStatus(m, perSetScore(m))) + '</span>' +
        '<span ' + hook + 'style="' + cell + 'font-family:\'IBM Plex Mono\',monospace;font-size:11px;' +
          'color:#c6ccdb;text-align:right;">' + (m.price == null ? DASH : m.price.toFixed(2)) + '</span>' +
        '<span ' + hook + 'style="' + cell + 'font-family:\'IBM Plex Mono\',monospace;font-size:11px;' +
          'color:#5b6880;text-align:right;">' + (m.oppPrice == null ? DASH : m.oppPrice.toFixed(2)) + '</span>';
    });
    // §8.13 · one grid for the whole list. The group rows span it with
    // `grid-column:1/-1`, which is why they are emitted into the same container
    // rather than sitting between per-row grids as they used to.
    out = out ? '<div style="display:grid;grid-template-columns:52px 12px minmax(0,1.1fr) 38px 44px ' +
      'minmax(0,1.3fr) 48px 48px;gap:0 10px;align-items:center;">' + out + '</div>' : '';

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
    var parts = [];
    // §8.2 · the under-minimum sentence appears ONLY when a band is under five, and
    // it is the design's own wording. The design shows exactly one such band, so it
    // hard-codes the sentence; a real career can have several, hence the loop.
    bands.forEach(function (b) {
      var n = b.won + b.lost;
      if (!n || gateFor(n) !== GATE.THIN) return;
      parts.push(b.band.label + ' courts have ' + numWord(n) + ' match' + (n === 1 ? '' : 'es') +
        ' on record, short of the five-match minimum ' + ENDASH +
        ' the band reads as a dash and does not open.');
    });
    // §8.2 · the shortfall, with the counts that make it checkable. `scoped` is the
    // population AFTER the surface chip, so the sentence stays true on every chip
    // rather than quoting a career total under a filtered list.
    var scoped = bands.scoped == null ? total : bands.scoped;
    if (bands.unbanded) {
      parts.push(bands.unbanded + ' of ' + scoped + ' matches sit at a venue without a Tennis Abstract ' +
        'rating, or in an era before the venue&#39;s current surface, and are not banded.');
    }
    var map = (typeof window !== 'undefined') ? window.courtSpeedMap : null;
    if (!map) {
      // The "not wired" case kept distinct from "he has none": a pending or failed
      // fetch of the venue map unbands every row, and saying so is the difference
      // between an honest empty state and a silent lie about our own data.
      parts.push('The court-speed venue map has not loaded, so no match can be banded yet.');
    }
    parts.push('Units cover priced matches only ' + ENDASH + ' Pinnacle closing prices, the listed rows.');
    return '<div style="font-size:12px;color:#4b5672;margin-top:14px;line-height:1.6;">' +
      parts.join(' ') + '</div>';
  }
  /** The design writes the under-minimum count as a word ("three matches"). */
  var NUM_WORDS = ['zero', 'one', 'two', 'three', 'four'];
  function numWord(n) { return NUM_WORDS[n] || String(n); }

  /**
   * §8.5 · the per-set scoreline, or null.
   *
   * calSpine() falls back to the SET COUNT when recentForm holds nothing for a row,
   * so `score` is not evidence of per-set data on its own. The two shapes are told
   * apart by their spacing, which is how the stores themselves write them: a set
   * COUNT is spaced ("2 - 1"), a per-set score is not ("6-3, 4-6"). Requiring the
   * unspaced form means a walkover's " - " and a retirement's "1 - 1" both dash
   * here instead of appearing as a scoreline that was never played.
   */
  function perSetScore(m) {
    var s = m && m.score ? String(m.score) : '';
    if (!s || s === DASH || s === m.sets) return null;
    return /\d+-\d+/.test(s) ? s : null;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.6 VERSUS PLAYING STYLES
  // ═══════════════════════════════════════════════════════════════════════════
  // Taxonomy: the board-finalised v5.1 set in playing-styles.json, which
  // matchup-matrix.json also names as its own source. Eight labels, carried
  // verbatim. The ticket asks for "v5.2 names and IDs exactly" — no v5.2 exists in
  // this repo (reported at recon); the prototype's own row labels are v5.1 verbatim,
  // so the export and our data already agree.
  //
  // Source: market-edge rows, which build-market-edge.js now stamps with the
  // OPPONENT's archetype using the same name resolver that joins the row's subject.
  //
  // Coverage is the honest constraint and the modal states it. The labelled roster is
  // the CURRENT 250 players, so a long career's early opponents are mostly unlabelled
  // by construction: Djokovic 424 of 1,277, against a 75.8% median for players whose
  // careers sit inside the roster era.

  /**
   * Serve-first to baseline-first, the design's x order, with All Court Elite held
   * out to the right of the divider as its own tier.
   *
   * ABBREVIATIONS: BS / BS+FS / BS+CB / AB / SB / ACE are the design's own. CP and SD
   * are NOT — the export never plots Counterpuncher or Solid Defender (they were that
   * player's two under-minimum rows), so those two are derived here and flagged in the
   * report rather than presented as specified.
   */
  var STYLE_AXIS = [
    { label: 'Big Server', abbr: 'BS' },
    { label: 'Big Server + First Strike', abbr: 'BS+FS' },
    { label: 'Big Server + Complete Baseliner', abbr: 'BS+CB' },
    { label: 'Attacking Baseliner', abbr: 'AB' },
    { label: 'Solid Baseliner', abbr: 'SB' },
    { label: 'Counterpuncher', abbr: 'CP', derivedAbbr: true },
    { label: 'Solid Defender', abbr: 'SD', derivedAbbr: true },
    { label: 'All Court Elite', abbr: 'ACE', elite: true }
  ];

  /** Per-archetype record over the priced rows, plus the rows carrying no label. */
  function styleRows(p) {
    var agg = {};
    STYLE_AXIS.forEach(function (a) { agg[a.label] = { axis: a, won: 0, lost: 0, pl: 0, rows: [] }; });
    var unlabelled = 0;
    // §5.6 reads the PRICED market rows, not the Court speed spine — see
    // marketRows() for why the two must stay apart.
    marketRows(p).forEach(function (m) {
      var a = m.oppArchetype && agg[m.oppArchetype];
      if (!a) { unlabelled += 1; return; }
      if (m.won) a.won += 1; else a.lost += 1;
      a.pl += (m.pl == null ? 0 : m.pl);
      a.rows.push(m);
    });
    var out = STYLE_AXIS.map(function (a) { return agg[a.label]; });
    out.unlabelled = unlabelled;
    return out;
  }

  function renderStylesModal(p) {
    var rows = styleRows(p);
    var total = marketRows(p).length;
    if (!total) {
      return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">No priced matches on record, ' +
        'so no opponent can be archetyped.</div>';
    }
    return renderStyleBubbles(rows) + renderStyleList(rows) + renderStyleNote(rows, total);
  }

  /**
   * Bubble plot. Y is fixed 40-80% as the design specifies, so a rate outside that
   * range is CLAMPED for position and still printed exactly — a bubble pinned to the
   * axis is honest about its value; a silently rescaled axis is not.
   */
  function renderStyleBubbles(rows) {
    var plotted = rows.filter(function (r) {
      var n = r.won + r.lost;
      return gateFor(n) !== GATE.NONE && gateFor(n) !== GATE.THIN;
    });
    if (!plotted.length) {
      return '<div style="background:#06070a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;' +
        'padding:20px 22px 16px;margin-bottom:16px;">' +
        '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">No archetype clears the five-match ' +
        'minimum, so the chart has nothing to plot.</div></div>';
    }
    // The design's radius is 16 + n/47*22, where 47 was that player's busiest
    // archetype — placeholder scale, not a constant. Re-derived from this player's max
    // so the biggest bubble still lands at 38px.
    var maxN = plotted.reduce(function (m, r) { return Math.max(m, r.won + r.lost); }, 1);
    var regular = plotted.filter(function (r) { return !r.axis.elite; });
    var elite = plotted.filter(function (r) { return r.axis.elite; });

    var ticks = [80, 70, 60, 50, 40].map(function (t) {
      var y = (80 - t) / 40 * 100;
      return '<div style="position:absolute;right:calc(100% + 6px);top:' + y + '%;transform:translateY(-50%);' +
        'font-size:10px;color:#4b5672;">' + t + '%</div>' +
        '<div style="position:absolute;left:0;right:0;top:' + y + '%;height:1px;background:' +
        (t === 50 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.05)') + ';"></div>' +
        (t === 50 ? '<div style="position:absolute;left:4px;top:' + y + '%;transform:translateY(-130%);' +
          'font-family:\'IBM Plex Mono\',monospace;font-size:9px;color:#5b6880;">even</div>' : '');
    }).join('');

    function bubble(r, leftPct) {
      var n = r.won + r.lost;
      var rate = 100 * r.won / n;
      var clamped = Math.max(40, Math.min(80, rate));
      var y = (80 - clamped) / 40 * 100;
      var size = 16 + (n / maxN) * 22;
      var op = 0.25 + ((clamped - 40) / 40) * 0.75;
      return '<div data-pp2="style-row" data-v="' + esc(r.axis.label) + '" ' +
        'style="position:absolute;left:' + leftPct + '%;top:' + y + '%;transform:translate(-50%,-50%);' +
        'cursor:pointer;">' +
        '<div style="position:absolute;left:50%;bottom:' + (size / 2 + 4).toFixed(1) + 'px;' +
          'transform:translateX(-50%);font-family:\'IBM Plex Mono\',monospace;font-size:12px;' +
          'font-weight:700;color:#e7e9ee;white-space:nowrap;">' + rate.toFixed(0) + '%</div>' +
        '<div style="width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;border-radius:50%;' +
          'background:rgba(91,155,255,' + op.toFixed(2) + ');border:1px solid rgba(91,155,255,0.5);"></div>' +
        '</div>';
    }
    function xlabel(r, leftPct) {
      var on = state.styleRow === r.axis.label;
      return '<div data-pp2="style-row" data-v="' + esc(r.axis.label) + '" ' +
        'style="position:absolute;left:' + leftPct + '%;top:6px;transform:translateX(-50%);' +
        'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:0.08em;cursor:pointer;' +
        'white-space:nowrap;padding:2px 5px;border-radius:4px;' +
        (on ? 'background:rgba(91,155,255,0.16);font-weight:700;border-bottom:1px solid #5b9bff;color:#e7e9ee;'
            : 'color:#5b6880;') + '">' + esc(r.axis.abbr) + '</div>';
    }

    var bubbles = '', labels = '';
    regular.forEach(function (r, i) {
      var x = regular.length === 1 ? 43 : 8 + (i / (regular.length - 1)) * 70;
      bubbles += bubble(r, x); labels += xlabel(r, x);
    });
    elite.forEach(function (r) { bubbles += bubble(r, 92); labels += xlabel(r, 92); });

    return '<div style="background:#06070a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;' +
      'padding:20px 22px 16px;margin-bottom:16px;">' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;font-weight:600;' +
        'letter-spacing:0.14em;text-transform:uppercase;color:#4b5672;margin-bottom:16px;">' +
        'Win rate by archetype ' + MIDDOT + ' bubble size is match count</div>' +
      '<div style="display:grid;grid-template-columns:52px 1fr;">' +
        '<div style="position:relative;">' +
          '<div style="position:absolute;left:8px;top:50%;transform:translateY(-50%) rotate(-90deg);' +
            'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:0.14em;' +
            'text-transform:uppercase;color:#4b5672;white-space:nowrap;">Win rate</div>' +
        '</div>' +
        '<div>' +
          '<div style="position:relative;height:240px;border-left:1px solid rgba(255,255,255,0.12);' +
            'border-bottom:1px solid rgba(255,255,255,0.12);">' +
            ticks +
            (elite.length ? '<div style="position:absolute;left:86%;top:0;bottom:0;width:0;' +
              'border-left:1px dashed rgba(255,255,255,0.14);"></div>' : '') +
            bubbles +
          '</div>' +
          '<div style="position:relative;height:26px;">' + labels + '</div>' +
          '<div style="display:flex;justify-content:space-between;font-family:\'IBM Plex Mono\',monospace;' +
            'font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#3f4860;margin-top:2px;">' +
            '<span>Serve</span><span>Baseline</span><span>Archetype</span></div>' +
        '</div>' +
      '</div></div>';
  }

  /** Row list, §5.2A spec (1fr 300px 58px). All eight kept — dashed when under gate. */
  function renderStyleList(rows) {
    var tw = 0, tl = 0, tpl = 0;
    var body = rows.map(function (r) {
      var n = r.won + r.lost;
      var gate = gateFor(n);
      var open = state.styleRow === r.axis.label;
      var openable = gate !== GATE.NONE && gate !== GATE.THIN;
      tw += r.won; tl += r.lost; tpl += r.pl;
      var rate = rateText(r.won, r.lost);
      var row = '<div' + (openable ? ' data-pp2="style-row" data-v="' + esc(r.axis.label) + '"' : '') +
        ' style="display:grid;grid-template-columns:1fr 300px 58px;gap:0 12px;padding:7px 0;' +
        'border-top:1px solid rgba(255,255,255,0.04);align-items:baseline;' +
        'cursor:' + (openable ? 'pointer' : 'default') + ';' +
        (open ? 'background:rgba(91,155,255,0.06);' : '') + '">' +
        '<div style="font-size:12.5px;font-weight:700;color:' + (openable ? '#e7e9ee' : '#3f4860') + ';">' +
          esc(r.axis.label) + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:#8b96b5;text-align:right;">' +
          (n ? recordText(r.won, r.lost) + ' ' + MIDDOT + ' ' + n + ' matches' : 'no matches on record') + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;text-align:right;' +
          'color:' + (rate === DASH ? DASH_COLOUR : gate === GATE.SMALL ? '#8b96b5' : '#e8ecf4') + ';">' +
          rate + '</div>' +
      '</div>';
      return row + (open ? renderStyleDetail(r) : '');
    }).join('');

    var totalRow = '<div style="display:grid;grid-template-columns:1fr 300px 58px;gap:0 12px;padding:9px 0;' +
      'border-top:1px solid rgba(255,255,255,0.09);align-items:baseline;">' +
      '<div style="font-size:12.5px;font-weight:600;color:#8b96b5;">Career</div>' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:600;color:#8b96b5;' +
        'text-align:right;">' + recordText(tw, tl) + ' ' + MIDDOT + ' ' +
        '<span style="color:' + (tpl >= 0 ? '#3dd68c' : '#e0616f') + ';">' + signed(tpl, 1, 'u') + '</span></div>' +
      '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:600;text-align:right;' +
        'color:' + (rateText(tw, tl) === DASH ? DASH_COLOUR : '#8b96b5') + ';">' + rateText(tw, tl) + '</div>' +
    '</div>';
    return body + totalRow;
  }

  function renderStyleDetail(r) {
    var rows = r.rows.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var out = rows.map(function (m) {
      return '<div ' + sheetHook(m.date + '|' + m.opp) +
        'style="display:grid;grid-template-columns:16px 64px 1.1fr 1fr 38px 104px 48px 48px 58px;gap:0 8px;' +
        'padding:5px 0;border-top:1px solid rgba(255,255,255,0.04);align-items:baseline;' + sheetCursor() +
        'font-family:\'IBM Plex Mono\',monospace;font-size:11px;">' +
        '<span style="color:' + (m.won ? '#3dd68c' : '#e0616f') + ';">' + (m.won ? 'W' : 'L') + '</span>' +
        '<span style="color:#5b6880;">' + esc(m.date) + '</span>' +
        '<span style="font-family:inherit;color:#e8ecf4;">' + esc(m.opp) + '</span>' +
        '<span style="font-family:inherit;color:#8b96b5;">' + esc(m.event) + '</span>' +
        '<span style="color:#5b6880;">' + esc(shortRound(m.round)) + '</span>' +
        '<span style="color:' + DASH_COLOUR + ';">' + DASH + '</span>' +
        '<span style="text-align:right;color:#e8ecf4;">' + (m.price == null ? DASH : m.price.toFixed(2)) + '</span>' +
        '<span style="text-align:right;color:#5b6880;">' + (m.oppPrice == null ? DASH : m.oppPrice.toFixed(2)) + '</span>' +
        '<span style="text-align:right;font-weight:700;color:' + (m.pl >= 0 ? '#3dd68c' : '#e0616f') + ';">' +
          signed(m.pl, 2, 'u') + '</span>' +
      '</div>';
    }).join('');
    return '<div style="background:#06070a;border:1px solid rgba(91,155,255,0.3);border-radius:11px;' +
      'padding:10px 14px;margin:6px 0 10px;max-height:420px;overflow-y:auto;">' + out + '</div>';
  }

  function renderStyleNote(rows, total) {
    var thin = rows.filter(function (r) { var n = r.won + r.lost; return n > 0 && n < 5; });
    var parts = ['Click an archetype for the matches behind it.'];
    if (thin.length) {
      parts.push((thin.length === 1 ? 'One sits' : thin.length + ' sit') + ' below the five-match minimum and ' +
        (thin.length === 1 ? 'stays' : 'stay') + ' listed with a dash rather than dropping out ' + ENDASH +
        ' an absent row reads as an absent opponent.');
    }
    if (rows.unlabelled) {
      parts.push(rows.unlabelled + ' of ' + total + ' priced matches were against an opponent who carries no ' +
        'archetype. The labelled roster is the current 250 players, so a long career&#39;s early opponents are ' +
        'mostly absent by construction, not by omission.');
    }
    return '<div style="font-size:12px;color:#4b5672;margin-top:14px;line-height:1.6;">' + parts.join(' ') + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §8.1 MATCH SHEET (correction-pass item 14)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Opened from a ledger row or a ribbon chip. MATCH_SHEET_BUILT gates the hook
  // and the pointer cursor; it is now true, so the affordance and the content
  // ship together (this repo's rule — an affordance promises content).
  //
  // SOURCE. historical-match-stats.json, keyed by the api-tennis event key that
  // recentForm already carries on every row (`eventKey`), with `p1Key`/`p2Key`
  // giving the orientation — so this is a key join, not a name join, and none of
  // the name-scramble traps apply. It is a pipeline CACHE that was never in the
  // deploy allowlist; pipeline.yml now copies it and the host fetches it lazily
  // on the first sheet open.
  //
  // COVERAGE IS THE HONEST CONSTRAINT and the sheet states it per section.
  // Committed roster: 1,811 of 11,340 recentForm rows (16.0%) carry a stats
  // block; api-tennis only began populating the statistics block in 2024.
  //
  // WHAT WE DO NOT HOLD, and why each dashes rather than being estimated:
  //  * Serve rating / Return rating — the repo's own definitions
  //    (dna-apitennis-ratings.js) need hold% and return-games-won%, which this
  //    per-match store does not carry. Dashed, never a partial sum.
  //  * Net points won — does not exist in api-tennis at all (a full census found
  //    zero net keys, including the nested `raw` object). Never derived from
  //    winners.
  //  * Point FRACTIONS under each value — the feed emits rates, not denominators.
  var SHEET_SECTIONS = [
    { title: 'Service', rows: [
      { label: 'Serve rating', held: false, why: 'rating formula needs hold%' },
      { label: 'Aces', field: 'Service:Aces', kind: 'count' },
      { label: 'Double faults', field: 'Service:Double Faults', kind: 'count', lowerBetter: true },
      { label: '1st serve %', field: 'Service:1st serve percentage', kind: 'pct' },
      { label: '1st serve points won', field: 'Service:1st serve points won', kind: 'pct' },
      { label: '2nd serve points won', field: 'Service:2nd serve points won', kind: 'pct' },
      { label: 'Break points saved', field: 'Service:Break Points Saved', kind: 'pct' }
    ] },
    { title: 'Return', rows: [
      { label: 'Return rating', held: false, why: 'rating formula needs return-games-won%' },
      { label: '1st return points won', field: 'Return:1st return points won', kind: 'pct' },
      { label: '2nd return points won', field: 'Return:2nd return points won', kind: 'pct' },
      { label: 'Break points converted', field: 'Return:Break Points Converted', kind: 'pct' }
    ] },
    { title: 'Points won', rows: [
      { label: 'Winners', field: 'Points:Winners', kind: 'count' },
      { label: 'Unforced errors', field: 'Points:Unforced errors', kind: 'count', lowerBetter: true },
      { label: 'Net points won', held: false, why: 'not an api-tennis field' },
      { label: 'Service points won', derived: 'spw', kind: 'pct' },
      { label: 'Return points won', derived: 'rpw', kind: 'pct' }
    ] }
  ];

  function statsStore() { return window.matchStats || null; }
  function statsFor(eventKey) {
    var s = statsStore();
    if (!s || eventKey == null) return null;
    var row = s[String(eventKey)];
    return row && row.matchStats ? row : null;
  }
  function num(v) { return v == null || v === '' || !isFinite(Number(v)) ? null : Number(v); }
  /** Service points won % — the exact weighted mean of the two serve rates. */
  function spwPct(side) {
    if (!side) return null;
    var inPct = num(side['Service:1st serve percentage']);
    var w1 = num(side['Service:1st serve points won']);
    var w2 = num(side['Service:2nd serve points won']);
    if (inPct == null || w1 == null || w2 == null) return null;
    var f = inPct / 100;
    return f * w1 + (1 - f) * w2;
  }
  /** Return points won % — same composition, weighted by the OPPONENT's 1st-in. */
  function rpwPct(side, opp) {
    if (!side || !opp) return null;
    var oppIn = num(opp['Service:1st serve percentage']);
    var r1 = num(side['Return:1st return points won']);
    var r2 = num(side['Return:2nd return points won']);
    if (oppIn == null || r1 == null || r2 == null) return null;
    var f = oppIn / 100;
    return f * r1 + (1 - f) * r2;
  }
  // Dominance ratio, using the repo's OWN definition verbatim
  // (dna-apitennis-ratings.js:411 — "returnPtsWon% / (100 − servicePtsWon%)").
  // Not a new metric and not a new normalisation.
  function drFor(side, opp) {
    var r = rpwPct(side, opp), s = spwPct(side);
    if (r == null || s == null) return null;
    var denom = 100 - s;
    if (!(denom > 0)) return null;
    return r / denom;
  }
  function sheetValue(row, mine, theirs) {
    if (row.held === false) return null;
    if (row.derived === 'spw') return spwPct(mine);
    if (row.derived === 'rpw') return rpwPct(mine, theirs);
    return num(mine && mine[row.field]);
  }
  function sheetText(row, v) {
    if (v == null) return DASH;
    return row.kind === 'pct' ? v.toFixed(1) + '%' : String(Math.round(v));
  }
  /** Bars are a share of the pair, and only drawn when BOTH sides are held. */
  function sheetBars(a, b) {
    if (a == null || b == null) return ['0%', '0%'];
    var t = Math.abs(a) + Math.abs(b);
    if (!(t > 0)) return ['0%', '0%'];
    return [(100 * Math.abs(a) / t).toFixed(1) + '%', (100 * Math.abs(b) / t).toFixed(1) + '%'];
  }

  /**
   * The row a sheet id ("2026-09-13|B. Shelton") points at, or null.
   *
   * Two populations open the sheet and they are NOT the same rows. The ledger and
   * the ribbon draw recentForm — a rolling window that carries the api-tennis
   * `eventKey`, so those sheets can reach the stats store. The court-speed and
   * playing-styles drills draw the market-edge shard, which runs back to 2004 and
   * carries no event key at all. Both must open, because the founder asked for
   * "any drill row"; the shard-sourced sheet paints its header from the shard and
   * says why every stat row is a dash, rather than opening blank.
   */
  function sheetRowFor(p, ctx, id) {
    var rows = ctx.ledgerRows || [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var m = rows[i].m;
      if (m.date + '|' + (m.opponent || '') === id) return rows[i];
    }
    var mk = marketFor(p.key);
    var mrows = (mk && mk.matches) || [];
    for (i = 0; i < mrows.length; i++) {
      var r = mrows[i];
      if (r.date + '|' + (r.opp || '') !== id) continue;
      return {
        m: {
          date: r.date, opponent: r.opp || null, tournament: r.event || null,
          round: r.round || null, surface: r.surface || null, won: !!r.won,
          sets: [], result: null, eventKey: null
        },
        price: r.price != null ? r.price : null,
        oppPrice: r.oppPrice != null ? r.oppPrice : null,
        role: r.role || null, book: r.book || null,
        basis: r.price != null ? 'close' : null,
        fromShard: true
      };
    }
    // §5.3 item 21 · third source. The tournament modal dates 97% of its rows
    // but only 81% of them reach a ledger or market row, so without this a row
    // would carry a pointer cursor and open nothing. career-history is dated and
    // subject-relative; it carries no per-set score and no price, and the sheet
    // already renders both of those as dashes with a stated reason.
    var chRows = careerHistoryFor(p.key) || [];
    for (i = 0; i < chRows.length; i++) {
      var c = chRows[i];
      if (!c || !c.date) continue;
      if (c.date + '|' + (c.opponent || '') !== id) continue;
      return {
        m: {
          date: c.date, opponent: c.opponent || null, tournament: c.tournament || null,
          round: c.round || null, surface: c.surface || null, won: !!c.won,
          sets: [], result: c.result || null, eventKey: c.eventKey || null
        },
        price: null, oppPrice: null, role: null, book: null, basis: null,
        fromCareerHistory: true
      };
    }
    return null;
  }

  function renderSheet(p, ctx) {
    if (!state.sheet) return '';
    var x = sheetRowFor(p, ctx, state.sheet);
    if (!x) return '';
    var m = x.m;
    var rec = statsFor(m.eventKey);
    var mine = null, theirs = null;
    if (rec) {
      var subjIsP1 = String(rec.p1Key) === String(p.key);
      var subjIsP2 = String(rec.p2Key) === String(p.key);
      // Orientation must be PROVEN by the key. A row whose keys name neither the
      // subject nor his opponent is a join error, and painting it either way
      // would hand the reader the wrong player's match.
      if (subjIsP1 || subjIsP2) {
        mine = subjIsP1 ? rec.matchStats.p1 : rec.matchStats.p2;
        theirs = subjIsP1 ? rec.matchStats.p2 : rec.matchStats.p1;
      }
    }

    var won = !!m.won;
    var priceLine;
    if (x.price != null && x.oppPrice != null) {
      priceLine = (x.basis === 'close' ? 'Closing ' : 'Pre-match ') +
        Number(x.price).toFixed(2) + ' v ' + Number(x.oppPrice).toFixed(2) +
        ' ' + MIDDOT + ' P&L ' + signed(won ? (Number(x.price) - 1) : -1, 2, 'u');
    } else {
      priceLine = 'No price on record';
    }

    var head = '' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">' +
        '<div style="display:flex;flex-direction:column;gap:5px;min-width:0;">' +
          '<span style="font-size:17px;font-weight:800;letter-spacing:-0.015em;">' +
            esc(surnameOf(p.name)) + ' v ' +
            esc(m.opponent ? surnameFirst(m.opponent) : DASH) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;letter-spacing:0.06em;' +
            // The two populations label rounds differently: recentForm carries the
            // api-tennis feed string (roundLabel), the shard carries the archive's
            // own prose (shortRound). Using one map on both prints raw prose.
            'color:#5b6880;">' + esc(fmtDotDate(m.date) + ' ' + MIDDOT + ' ' + eventName(m) + ' ' +
            MIDDOT + ' ' + (x.fromShard ? shortRound(m.round) : roundLabel(m)) + ' ' + MIDDOT + ' ' +
            (m.surface ? String(m.surface) : DASH)) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:16px;flex:none;">' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:14px;font-weight:700;' +
              'color:' + (won ? '#3dd68c' : '#e0616f') + ';">' +
              esc(((won ? 'Won ' : 'Lost ') +
                scoreWithStatus(m, (m.sets && m.sets.length) ? setScoreText(m, ' ') : ''))
                .replace(' ' + DASH, '').trim()) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;">' +
              esc(priceLine) + '</span>' +
          '</div>' +
          '<span data-pp2="sheet-close" style="background:rgba(255,255,255,0.05);' +
            'border:1px solid rgba(255,255,255,0.12);border-radius:8px;width:30px;height:30px;' +
            'color:#8b96b5;font-size:15px;line-height:1;cursor:pointer;display:flex;' +
            'align-items:center;justify-content:center;">' + '×' + '</span>' +
        '</div>' +
      '</div>';

    var dA = drFor(mine, theirs), dB = drFor(theirs, mine);
    var dr = '' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);' +
        'align-items:center;gap:14px;background:#06070a;border:1px solid rgba(255,255,255,0.08);' +
        'border-radius:10px;padding:13px 16px;">' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:24px;font-weight:700;' +
          'color:' + (dA == null ? DASH_COLOUR : '#5b9bff') + ';">' +
          (dA == null ? DASH : dA.toFixed(2)) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
          'letter-spacing:0.16em;text-transform:uppercase;color:#8b96b5;">Dominance ratio</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:24px;font-weight:700;' +
          'text-align:right;color:' + (dB == null ? DASH_COLOUR : '#e7e9ee') + ';">' +
          (dB == null ? DASH : dB.toFixed(2)) + '</span>' +
      '</div>';

    var held = 0, total = 0;
    var sections = SHEET_SECTIONS.map(function (sec) {
      var rows = sec.rows.map(function (row) {
        var a = sheetValue(row, mine, theirs);
        var b = sheetValue(row, theirs, mine);
        total++; if (a != null) held++;
        var bars = sheetBars(a, b);
        return '' +
          '<div style="display:flex;flex-direction:column;gap:6px;">' +
            '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);' +
              'align-items:baseline;gap:12px;">' +
              '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;' +
                'color:' + (a == null ? DASH_COLOUR : '#5b9bff') + ';">' + sheetText(row, a) + '</span>' +
              '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;' +
                'letter-spacing:0.14em;text-transform:uppercase;color:#8b96b5;text-align:center;">' +
                esc(row.label) + '</span>' +
              '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;' +
                'text-align:right;color:' + (b == null ? DASH_COLOUR : '#e7e9ee') + ';">' +
                sheetText(row, b) + '</span>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
              '<span style="display:flex;justify-content:flex-end;height:7px;' +
                'background:rgba(255,255,255,0.05);border-radius:4px;">' +
                '<span style="height:7px;width:' + bars[0] + ';background:#5b9bff;border-radius:4px;">' +
                '</span></span>' +
              '<span style="display:flex;height:7px;background:rgba(255,255,255,0.05);' +
                'border-radius:4px;"><span style="height:7px;width:' + bars[1] +
                ';background:rgba(255,255,255,0.75);border-radius:4px;"></span></span>' +
            '</div>' +
          '</div>';
      }).join('');
      return '' +
        '<div style="display:flex;flex-direction:column;gap:13px;">' +
          '<span style="display:block;text-align:center;font-family:\'IBM Plex Mono\',monospace;' +
            'font-size:9.5px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;' +
            'color:#5b6880;background:#06070a;border:1px solid rgba(255,255,255,0.07);' +
            'border-radius:8px;padding:8px 0;">' + esc(sec.title) + '</span>' + rows +
        '</div>';
    }).join('');

    var note;
    if (x.fromShard) {
      note = 'This row comes from the odds archive, which carries no match key, so no per-match ' +
        'stats can be joined to it. The header, result and price above are the archive’s own.';
    } else if (!rec) {
      note = 'No per-match stats on record for this match. api-tennis only populates its ' +
        'statistics block from 2024, so older matches carry none.';
    } else if (!mine) {
      note = 'The stats row for this fixture names neither player by key, so it is not shown — ' +
        'a mis-oriented sheet would put the opponent’s numbers under this player’s name.';
    } else {
      note = held + ' of ' + total + ' rows held for this match. Serve rating and Return rating ' +
        'need hold% and return-games-won%, which the per-match feed does not carry; net points ' +
        'is not an api-tennis field at all. Service and Return points won are composed from the ' +
        'serve rates on this row. Dominance ratio uses our own definition, return points won ' +
        'over service points lost.';
    }

    return '' +
      '<div class="pp2-sheet" data-pp2="sheet-scrim" style="position:fixed;inset:0;z-index:80;' +
        'background:rgba(3,5,9,0.72);display:flex;align-items:flex-start;justify-content:center;' +
        'padding:40px 24px;overflow-y:auto;">' +
        '<div style="position:relative;width:100%;max-width:760px;background:#0a0d14;' +
          'border:1px solid rgba(91,155,255,0.3);border-radius:14px;padding:22px 24px 26px;' +
          'display:flex;flex-direction:column;gap:16px;box-shadow:0 30px 80px rgba(0,0,0,0.6);">' +
          head + dr + sections +
          '<div style="font-size:11px;color:#4b5361;line-height:1.55;">' + esc(note) + '</div>' +
        '</div>' +
      '</div>';
  }

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
    else if (k === 'styles') body = renderStylesModal(p);
    else if (k === 'profile') body = renderProfileModal(p);
    else {
      // Not yet built. The modal opens and says so — a box that silently does
      // nothing reads as a broken page.
      body = '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:#5b6880;">Not built yet.</div>';
    }
    return modalShell(k, p, ctx, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.9 PLAYING PROFILE — hold/break heatmap
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // FOUNDER RULING 7 (2026-09-16): "we already built a hold/break heatmap for
  // live bets. Reuse that same data source and logic for the pre-match heatmap
  // in Playing profile. Don't build a second engine. Coverage should hold for
  // most players; where a player's matches lack the per-game data, the heatmap
  // states its match count, like the Situational rows. Never estimate."
  //
  // So this block computes NOTHING. Every figure comes from window.HoldBreakHeatmap
  // (holdbreak-heatmap.js), the engine lifted out of the Live tab; this is a
  // renderer over the model it returns. tools/test-holdbreak-engine.js proves the
  // Live tab still renders exactly what it did before that extraction.
  //
  // SOURCE: holdbreak.json — the nightly 24-month rollup built from the keyed
  // point-by-point cache (build-holdbreak.js). Founder rulings TEN-107 fix its
  // window (24M), its axis (six service-game ordinals within the set) and its
  // set split (S1..S5). None of those is re-litigated here.
  //
  // BEST-OF: the Live tab knows the match it is rendering, so it dims the sets
  // that format cannot reach. A career profile spans best-of-3 and best-of-5, so
  // there is no single format to dim by — we pass 5 and let the real cell counts
  // speak. A player who has never played a fifth set shows n=0 there and dashes,
  // which is the truth; dimming it "set not played in this format" would not be.
  var HB_BEST_OF = 5;

  // The shard carries all / hard / clay / grass. It does NOT carry an indoor
  // split (the Indoors carve-out lives on the api-tennis court_type join, not in
  // the point-by-point rollup), so there is deliberately no Indoors chip here —
  // an empty chip would imply we hold something we do not.
  var HB_SURFACES = [
    { id: 'all', label: 'All' },
    { id: 'hard', label: 'Hard' },
    { id: 'clay', label: 'Clay' },
    { id: 'grass', label: 'Grass' }
  ];

  function hbEngine() { return window.HoldBreakHeatmap || null; }
  function hbStore() { return window.holdbreak || null; }

  // Provenance for the modal footer. Returns null when we hold nothing for this
  // player, so the caller can say "no per-game data" rather than print a zero.
  function hbCoverage(p) {
    var E = hbEngine();
    if (!E) return null;
    var c = E.coverageFor(hbStore(), p.key);
    return c && c.held ? c : null;
  }

  // One cell of the grid. The engine has already applied the sample ladder and
  // chosen the text; this only paints it. `c.pct` is already '—', 'won/n' or
  // 'NN%' — it is never re-derived here, so the figure and the colour cannot
  // disagree with the Live tab's.
  function hbCellHtml(c) {
    return '' +
      '<div data-pp2="hb-cell" title="' + esc(c.tipHead + (c.tipRate ? ' ' + MIDDOT + ' ' + c.tipRate : '') +
        (c.tipNote ? ' ' + MIDDOT + ' ' + c.tipNote : '')) + '" ' +
      'style="border:1px solid ' + c.bd + ';background:' + c.bg + ';border-radius:8px;padding:8px 4px;' +
      'text-align:center;min-width:0;opacity:' + c.opacity + ';">' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-weight:700;line-height:1;' +
          'font-size:' + c.size + ';color:' + c.color + ';">' + esc(c.pct) + '</div>' +
        (c.frac && c.frac !== 'raw'
          ? '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;margin-top:3px;' +
            'color:rgba(231,233,238,0.55);">' + esc(c.frac) + '</div>'
          : '') +
      '</div>';
  }

  function hbPanelHtml(title, sub, model) {
    var cols = '96px repeat(5,minmax(0,1fr)) 74px';
    var head = '<div style="display:grid;grid-template-columns:' + cols + ';gap:6px;margin-bottom:7px;">' +
      '<span></span>' +
      [1, 2, 3, 4, 5].map(function (s) {
        return '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:0.1em;' +
          'text-transform:uppercase;color:#5b6880;text-align:center;">Set ' + s + '</span>';
      }).join('') +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;letter-spacing:0.1em;' +
        'text-transform:uppercase;color:#5b6880;text-align:center;">All</span>' +
      '</div>';

    var rows = model.rows.map(function (r) {
      return '<div style="display:grid;grid-template-columns:' + cols + ';gap:6px;margin-bottom:6px;' +
        'align-items:stretch;">' +
        '<div style="display:flex;flex-direction:column;justify-content:center;">' +
          '<span style="font-size:11.5px;font-weight:700;color:#c6ccdb;">' + esc(r.bucket) + '</span>' +
          '<span style="font-size:9px;color:#4b5672;">' + esc(r.sub) + '</span>' +
        '</div>' +
        r.cells.map(hbCellHtml).join('') +
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
          'border-left:1px solid rgba(255,255,255,0.07);">' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;' +
            'color:' + r.gColor + ';">' + esc(r.gPct) + '</span>' +
          (r.gFrac ? '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;color:#4b5672;">' +
            esc(r.gFrac) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    return '<div style="border:1px solid rgba(255,255,255,0.07);border-radius:14px;background:#070a10;' +
      'padding:15px 16px;min-width:0;">' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px;">' +
        '<span style="font-size:13.5px;font-weight:800;color:#e7e9ee;">' + esc(title) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:#5b6880;">' +
          esc(sub) + '</span>' +
      '</div>' + head + rows + '</div>';
  }

  function renderProfileModal(p) {
    var E = hbEngine();
    var HB = hbStore();
    // The store is not wired / has not loaded. Say so — an empty grid would read
    // as "this player has no data", which is a different and untrue statement.
    if (!E || !HB) {
      return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:' + DASH_COLOUR + ';">' +
        'Hold/break data is not loaded.</div>';
    }

    var cov = hbCoverage(p);
    var sn = shortName(p);
    var surf = state.hbSurf || 'all';

    // Ruling 7: "where a player's matches lack the per-game data, the heatmap
    // states its match count, like the Situational rows." A player outside the
    // shard's roster has NO per-game data at all — that is stated in words, with
    // no grid, rather than drawn as 60 dashes that look like a rendering fault.
    if (!cov) {
      var rosterN = (HB.meta && HB.meta.players) || null;
      var winN = (HB.meta && HB.meta.windowMonths) || null;
      return '<div style="border:1px dashed rgba(255,255,255,0.12);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:' + DASH_COLOUR + ';line-height:1.6;">' +
        esc(sn) + ' has no point-by-point data on record, so holds and breaks by game cannot be shown.' +
        (rosterN && winN
          ? '<br>The rollup covers ' + rosterN + ' players over the last ' + winN + ' months.'
          : '') +
        '</div>';
    }

    var chips = HB_SURFACES.map(function (s) {
      var on = surf === s.id;
      return '<button type="button" data-pp2="hb-surf" data-v="' + s.id + '" style="padding:6px 13px;' +
        'border-radius:8px;font-size:11.5px;cursor:pointer;color:' + (on ? '#e7e9ee' : '#5b6880') + ';' +
        'background:' + (on ? 'rgba(91,155,255,0.16)' : 'transparent') + ';' +
        'border:1px solid ' + (on ? 'rgba(91,155,255,0.4)' : 'rgba(255,255,255,0.08)') + ';">' +
        esc(s.label) + '</button>';
    }).join('');

    var hold = E.heatFor(HB, p.key, 'HOLD', HB_BEST_OF, surf);
    var brk = E.heatFor(HB, p.key, 'BREAK', HB_BEST_OF, surf);

    var surfLabel = surf === 'all' ? 'all surfaces' : surf + ' only';
    // Every count printed below is the shard's own, never a career figure: the
    // parse reached `matches` matches and `svcGames` service games. Printing
    // "75 matches" beside a career total of 1,200 would be a coverage claim we
    // cannot make, so both the number and what it counts are spelled out.
    var note = 'Point-by-point parsed for ' + cov.matches + ' of ' + esc(sn) + '’s matches ' +
      MIDDOT + ' ' + cov.svcGames + ' service games ' + MIDDOT + ' ' +
      (cov.from && cov.to ? cov.from + ' ' + ENDASH + ' ' + cov.to : cov.windowMonths + '-month window') +
      '. Cells with fewer than 5 service games show the raw count instead of a rate; ' +
      '5' + ENDASH + '9 are greyed as a small sample. Nothing here is estimated.';

    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;' +
        'flex-wrap:wrap;margin-bottom:14px;">' +
        '<div style="font-size:12.5px;color:#5b6880;line-height:1.5;max-width:560px;">' +
          'How often ' + esc(sn) + ' holds serve, and breaks on return, as the service games run ' +
          'deeper into a set. Rows are his own service-game order within the set; columns are the set.' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + chips + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;">' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;padding:4px 10px;' +
          'border-radius:7px;background:rgba(255,255,255,0.04);color:#c6ccdb;">' +
          esc(hold.globalLabel) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;padding:4px 10px;' +
          'border-radius:7px;background:rgba(255,255,255,0.04);color:#c6ccdb;">' +
          esc(brk.globalLabel) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;padding:4px 10px;' +
          'border-radius:7px;color:#5b6880;">' + esc(surfLabel) + '</span>' +
      '</div>' +
      '<div class="pp2-hb-grids" style="display:grid;grid-template-columns:1fr;gap:14px;">' +
        hbPanelHtml('Service holds', 'hold %', hold) +
        hbPanelHtml('Return breaks', 'break %', brk) +
      '</div>' +
      '<div style="font-size:11px;color:#4b5361;line-height:1.55;margin-top:13px;">' + note + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUNT
  // ═══════════════════════════════════════════════════════════════════════════
  var state = {
    key: null, ledgerOpen: false, ledgerExpanded: false,
    surfaces: [], priceFilters: [], modal: null,
    careerScope: 'career', splitScope: 'career', marketRole: 'all',
    tournQuery: '', tournOpen: null,
    // §5.4 Calendar record. calSurface 'all' is the default segment; calCell is
    // "YYYY-m" (month index, not 1-based) and calRun is an index into calRuns().
    calTab: 'calendar', calSurface: 'all', calCell: null, calRun: null,
    // §5.5 Court speed. speedBand null means "let the modal pick the best openable
    // band" rather than defaulting to a band the player may have never played.
    speedSurf: 'all', speedBand: null,
    // §5.6 Versus playing styles. styleRow is the opened archetype LABEL (v5.1
    // verbatim), so the bubble, its x label and the row all key on one value.
    styleRow: null,
    // §5.9 Playing profile. The hold/break shard's surface node — 'all' unless
    // the reader picks one. Deliberately separate from `surfaces` (the ledger
    // filter) and `speedSurf`: those key on api-tennis surface names, this keys
    // on the shard's own node names, and conflating them would silently read the
    // wrong node.
    hbSurf: 'all'
  };

  function build(p) {
    var rows = ledgerMatches(p);
    // One filtered set, shared by the ribbon strip/rate/chips and the ledger.
    // README §3 requires them to agree, and the only way to guarantee that is
    // for both to read the same array rather than two parallel filter passes.
    var lrows = ledgerRows(p);
    var subj = shortName(p);
    lrows.forEach(function (x) { x.subjectName = subj; });
    var lfiltered = ledgerFiltered(lrows);
    var ctx = {
      rows: rows,
      ledgerRows: lrows,
      ledgerFiltered: lfiltered,
      filtered: lfiltered.map(function (x) { return x.m; }),
      archetype: archetypeFor(p.key),
      ledgerOpen: state.ledgerOpen,
      nextMatch: null
    };
    ctx.boxVals = buildBoxVals(p, ctx);

    return '' +
      PP2_STYLE +
      '<div class="pp2-main" style="display:flex;flex-direction:column;gap:22px;max-width:1440px;">' +
        renderBackLink() +
        renderHeader(p, ctx) +
        renderRibbon(ctx) +
        renderLedger(p, ctx) +
        renderBoxes(ctx) +
        renderInsights(p) +
      '</div>' +
      renderModal(p, ctx) +
      renderSheet(p, ctx);
  }

  function applyFilters(rows) {
    var surf = state.surfaces;
    if (!surf.length) return rows;
    return rows.filter(function (m) {
      return surf.indexOf(String(m.surface || '').toLowerCase()) >= 0;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUNT — the host page's entry point
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Until this existed the module was a pure render function reachable only from
  // the tests: no <script src>, no event wiring, nothing on the page. Every
  // interactive affordance it paints (20 hook kinds) writes module state and
  // repaints, so the wiring belongs here with the state rather than in the
  // dashboard — the host only has to hand over a container and a key.

  var mounted = null;   // the container the delegated listeners are bound to

  // A fresh player must not inherit the previous player's open drawers. This is
  // the same rule the legacy renderer follows (ppState reset in
  // showPlayerProfile) and it exists because a "Last 8" or an open tournament
  // silently reframes a different career.
  function resetState(key) {
    state.key = String(key);
    state.ledgerOpen = false; state.ledgerExpanded = false;
    state.surfaces = []; state.priceFilters = []; state.modal = null;
    state.careerScope = 'career'; state.careerDrill = null;
    state.splitScope = 'career'; state.marketRole = 'all';
    state.tournQuery = ''; state.tournOpen = null;
    state.calTab = 'calendar'; state.calSurface = 'all'; state.calCell = null; state.calRun = null;
    state.speedSurf = 'all'; state.speedBand = null;
    state.styleRow = null;
    state.hbSurf = 'all';
    state.sheet = null;
  }

  function toggleIn(list, id) {
    var i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    return list;
  }
  function toggleVal(cur, id) { return String(cur) === String(id) ? null : id; }

  function repaint() {
    if (!mounted || !state.key) return;
    var p = profileFor(state.key);
    if (!p) return;
    // The search field is the one control that cannot survive a full repaint
    // untouched — innerHTML destroys the focused node, so the caret is captured
    // and restored. Everything else is stateless markup.
    var active = document.activeElement;
    var hadSearch = active && active.getAttribute &&
      active.getAttribute('data-pp2') === 'tourn-search';
    var caret = hadSearch ? active.selectionStart : null;
    mounted.innerHTML = build(p);
    if (hadSearch) {
      var next = mounted.querySelector('[data-pp2="tourn-search"]');
      if (next) {
        next.focus();
        if (caret != null) { try { next.setSelectionRange(caret, caret); } catch (e) { /* non-text input */ } }
      }
    }
  }

  // Every hook is a pure state write followed by one repaint. Nothing below
  // computes a figure — if a handler ever needs to, it belongs in a renderer.
  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-pp2]') : null;
    if (!el || !mounted.contains(el)) return;
    var kind = el.getAttribute('data-pp2');
    var v = el.getAttribute('data-v');

    // The scrim only closes when the click landed on the scrim itself; a click
    // that bubbled up out of the card must not close the modal (README §5.1).
    if (kind === 'scrim' && e.target !== el) return;
    if (kind === 'sheet-scrim' && e.target !== el) return;
    if (kind === 'card' || kind === 'hb-cell') return;   // inert: container / tooltip only

    if (kind === 'back') {
      e.preventDefault();
      if (typeof window.showPlayerList === 'function') window.showPlayerList();
      return;
    }

    e.preventDefault();
    if (kind === 'ledger') { state.ledgerOpen = !state.ledgerOpen; state.ledgerExpanded = false; }
    else if (kind === 'ledger-more') state.ledgerExpanded = !state.ledgerExpanded;
    else if (kind === 'ledger-surf') {
      // 'All' is not a member — it is the empty selection, so picking it clears
      // rather than adding a fifth surface that would match nothing.
      if (v === 'all') state.surfaces = []; else toggleIn(state.surfaces, v);
    }
    else if (kind === 'ledger-price') toggleIn(state.priceFilters, v);
    else if (kind === 'box') state.modal = el.getAttribute('data-box');
    else if (kind === 'close' || kind === 'scrim') { state.modal = null; state.careerDrill = null; }
    else if (kind === 'career-scope') { state.careerScope = el.getAttribute('data-scope'); state.careerDrill = null; }
    // §5.2A — a surface row toggles its own drill; opening one closes the other.
    else if (kind === 'career-surf') {
      state.careerDrill = (state.careerDrill && state.careerDrill.kind === 'surface' &&
        state.careerDrill.surf === v) ? null : { kind: 'surface', surf: v, year: null };
    }
    // §5.2B — `data-v` is "<scope>|<surf>", where scope is a year or the literal
    // "career" and surf is empty for the Total column. Clicking the same cell
    // closes it; clicking another switches, which falls out of comparing the
    // whole descriptor rather than just the scope. `state.careerDrill` holds ONE
    // descriptor, so the year rows, the career row and the surface bar rows all
    // evict each other — "only one drill open at a time" is structural.
    else if (kind === 'career-cell') {
      var parts = String(v || '').split('|');
      var want = { kind: 'cell', year: parts[0], surf: parts[1] || '' };
      var cur = state.careerDrill;
      state.careerDrill = (cur && cur.kind === 'cell' && cur.year === want.year &&
        cur.surf === want.surf) ? null : want;
    }
    else if (kind === 'career-drill-close') state.careerDrill = null;
    else if (kind === 'split-scope') state.splitScope = el.getAttribute('data-scope');
    else if (kind === 'market-role') state.marketRole = el.getAttribute('data-role');
    else if (kind === 'tourn-row') state.tournOpen = toggleVal(state.tournOpen, el.getAttribute('data-t'));
    else if (kind === 'cal-tab') state.calTab = v;
    else if (kind === 'cal-surface') { state.calSurface = v; state.calCell = null; state.calRun = null; }
    else if (kind === 'cal-cell') state.calCell = toggleVal(state.calCell, v);
    // Item 17 · the drill's own × button. Separate from re-clicking the cell so
    // the close works with the grid scrolled away from the selected cell.
    else if (kind === 'cal-cell-close') state.calCell = null;
    else if (kind === 'cal-run') state.calRun = state.calRun === Number(v) ? null : Number(v);
    else if (kind === 'speed-surf') { state.speedSurf = v; state.speedBand = null; }
    else if (kind === 'speed-band') state.speedBand = toggleVal(state.speedBand, v);
    else if (kind === 'style-row') state.styleRow = toggleVal(state.styleRow, v);
    else if (kind === 'hb-surf') state.hbSurf = v;
    // §8.1 match sheet. The host is told which match opened so it can pull the
    // stats shard; the sheet paints its own "no stats on record" state until it
    // lands rather than blocking the open.
    else if (kind === 'sheet') {
      state.sheet = v;
      if (typeof window.onPp2SheetOpen === 'function') window.onPp2SheetOpen(state.key, v);
    }
    else if (kind === 'sheet-close' || kind === 'sheet-scrim') state.sheet = null;
    else return;   // unknown hook: do nothing rather than repaint blindly
    repaint();
  }

  function onInput(e) {
    var el = e.target;
    if (!el || !el.getAttribute || el.getAttribute('data-pp2') !== 'tourn-search') return;
    state.tournQuery = el.value || '';
    repaint();
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    // The sheet sits above the modal, so Escape closes the topmost layer only.
    if (state.sheet) { state.sheet = null; repaint(); return; }
    if (state.modal) { state.modal = null; repaint(); }
  }

  // Bound once per container. Re-opening a different player re-uses the same
  // listeners — rebinding on every open is how duplicate-handler bugs start.
  function mount(container, key) {
    if (!container) return false;
    var p = profileFor(key);
    if (!p) return false;
    if (mounted !== container) {
      if (mounted) {
        mounted.removeEventListener('click', onClick);
        mounted.removeEventListener('input', onInput);
        mounted.removeEventListener('scroll', onDrillScroll, true);
      }
      container.addEventListener('click', onClick);
      container.addEventListener('input', onInput);
      // capture:true — `scroll` does not bubble, so a delegated listener on the
      // container never fires without it. This is what feeds the drill pager.
      container.addEventListener('scroll', onDrillScroll, true);
      if (!mount._key) { document.addEventListener('keydown', onKey); mount._key = true; }
      mounted = container;
    }
    resetState(key);
    repaint();
    return true;
  }

  window.PlayerProfileV2 = {
    render: build,
    mount: mount,
    repaint: repaint,
    // exported so the reconciliation check and the tests can call the same
    // code path the page uses, rather than a copy that can drift
    _internals: {
      normaliseEdition: normaliseEdition,
      editionScoreText: editionScoreText,
      speedBandFor: speedBandFor,
      speedBandForRow: speedBandForRow,
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
      // §4 Full ledger
      ledgerRows: ledgerRows,
      ledgerFiltered: ledgerFiltered,
      ledgerPriceIndex: ledgerPriceIndex,
      renderLedger: renderLedger,
      setScoreText: setScoreText,
      setText: setText,
      tiebreaksMissing: tiebreaksMissing,
      LEDGER_CAP: LEDGER_CAP,
      MATCH_SHEET_BUILT: MATCH_SHEET_BUILT,
      // correction pass
      PP2_STYLE: PP2_STYLE,
      rateText0: rateText0,
      fmtDotDate: fmtDotDate,
      surnameOf: surnameOf,
      surnameFirst: surnameFirst,
      roundOfN: roundOfN,
      roundLabel: roundLabel,
      qualifyingCode: qualifyingCode,
      provenDraw: provenDraw,
      drawIndex: drawIndex,
      eyebrow: eyebrow,
      ledgerEyebrow: ledgerEyebrow,
      ledgerChip: ledgerChip,
      ledgerRowHtml: ledgerRowHtml,
      renderRibbon: renderRibbon,
      renderBackLink: renderBackLink,
      // §8.1 match sheet
      renderSheet: renderSheet,
      sheetRowFor: sheetRowFor,
      SHEET_SECTIONS: SHEET_SECTIONS,
      statsFor: statsFor,
      spwPct: spwPct,
      rpwPct: rpwPct,
      drFor: drFor,
      sheetValue: sheetValue,
      sheetBars: sheetBars,
      // item 11 — the bet365 capture fallback
      b365Norm: b365Norm,
      b365Index: b365Index,
      b365PriceFor: b365PriceFor,
      b365Close: b365Close,
      b365DayOf: b365DayOf,
      // mount
      resetState: resetState,
      onClick: onClick,
      profileFor: profileFor,
      STAT_ROWS: STAT_ROWS,
      MARKET_NOTE: MARKET_NOTE,
      spineTotal: spineTotal,
      spineBySurface: spineBySurface,
      spineFirstYear: spineFirstYear,
      gridCells: gridCells,
      careerGridCells: careerGridCells,
      carveIndoor: carveIndoor,
      indoorCoverage: indoorCoverage,
      // §5.4 Calendar record (ruling cal-1). `state` is exported so the tests can
      // drive the Streaks tab and the surface segments through the SAME state the
      // page mutates — otherwise those branches are unreachable and would be
      // covered only by inspection.
      state: state,
      calMarketRows: calMarketRows,
      calNoRowsWhy: calNoRowsWhy,
      calSpine: calSpine,
      calSpineFiltered: calSpineFiltered,
      calNameMap: calNameMap,
      calGrid: calGrid,
      calMonths: calMonths,
      calStretches: calStretches,
      calFindings: calFindings,
      calSurfaceSpans: calSurfaceSpans,
      calRuns: calRuns,
      calRunRows: calRunRows,
      calRunsSkipped: calRunsSkipped,
      calWindowJoin: calWindowJoin,
      roundClass: roundClass,
      runSpan: runSpan,
      followStats: followStats,
      followGate: followGate,
      followYield: followYield,
      renderSpeedPanel: renderSpeedPanel,
      renderStreakTab: renderStreakTab,
      renderFollowsCard: renderFollowsCard,
      calScope: calScope,
      renderCalDrill: renderCalDrill,
      renderCalFooter: renderCalFooter,
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
      // §5.2 rebuild — exported so the harness asserts on the real functions
      // rather than re-deriving their logic, which is how a check goes vacuous.
      modalSubtitle: modalSubtitle,
      barFillColour: barFillColour,
      BAR_FULL: BAR_FULL,
      BAR_SMALL: BAR_SMALL,
      BAR_TRACK_BG: BAR_TRACK_BG,
      barRow: barRow,
      drillRows: drillRows,
      drillSpine: drillSpine,
      drillSourceFor: drillSourceFor,
      drillNote: drillNote,
      drillBodyHtml: drillBodyHtml,
      onDrillScroll: onDrillScroll,
      DRILL_PAGE: DRILL_PAGE,
      renderDrill: renderDrill,
      CAREER_ROWS: CAREER_ROWS,
      ENDASH: ENDASH,
      renderTournModal: renderTournModal,
      // §5.3 rebuild — the harness asserts on the real join and the real view
      // model, not on a re-derivation of them.
      renderTournDetail: renderTournDetail,
      tournJoin: tournJoin,
      tournViews: tournViews,
      tournDisplayName: tournDisplayName,
      over35Of: over35Of,
      winRateColour: winRateColour,
      oppKeyOf: oppKeyOf,
      EVENT_DISPLAY: EVENT_DISPLAY,
      EVENT_DISPLAY_UNKNOWN: EVENT_DISPLAY_UNKNOWN,
      renderSplitsModal: renderSplitsModal,
      renderMarketModal: renderMarketModal,
      // §5.5 Court speed
      renderSpeedModal: renderSpeedModal,
      matchStatus: matchStatus,
      scoreWithStatus: scoreWithStatus,
      speedRows: speedRows,
      marketRows: marketRows,
      speedBands: speedBands,
      // Exported so the pending-vs-empty truth table is testable against the
      // real predicate rather than a copy of it in the test.
      careerHistorySettled: careerHistorySettled,
      speedSelected: speedSelected,
      speedBestBand: speedBestBand,
      speedInfoFor: speedInfoFor,
      perSetScore: perSetScore,
      speedSurfaceMatch: speedSurfaceMatch,
      SPEED_SURFACES: SPEED_SURFACES,
      shortDate: shortDate,
      shortRound: shortRound,
      // §5.9 Playing profile — hold/break heatmap (founder ruling 7)
      renderProfileModal: renderProfileModal,
      hbCoverage: hbCoverage,
      hbEngine: hbEngine,
      hbStore: hbStore,
      HB_SURFACES: HB_SURFACES,
      HB_BEST_OF: HB_BEST_OF,
      // §5.6 Versus playing styles
      renderStylesModal: renderStylesModal,
      styleRows: styleRows,
      STYLE_AXIS: STYLE_AXIS,
      archetypeFor: archetypeFor,
      SPLIT_GROUPS: SPLIT_GROUPS,
      state: state
    }
  };
})();
