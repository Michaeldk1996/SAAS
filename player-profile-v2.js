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
//   4. Court speed= SUPERSEDED by N4 (2026-09-28): the site's one 3-band scheme,
//      courtSpeedCategory() on the 0-100 COURT_CONDITIONS index.  See SPEED_BANDS.
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
  var RANGLE = '›';  // U+203A, the "open this" affordance in the design
  var RARROW = '→';  // U+2192, the export's "leads to" arrow in the Situational labels
  var TIMES = '×';   // U+00D7 close glyph, never a lowercase x
  var DASH_COLOUR = 'var(--text-label)';

  // §5.2A row set and ORDER, from `Player Stat Boxes.dc.html`:1650 — Hard,
  // Grass, Clay, Indoors. README §5.2A gives a different order ("Hard, Clay,
  // Grass, Indoors"); the file wins per README §Fidelity. The ids are the keys
  // gridCells()/careerGridCells() return, so a row and its season-table column
  // are the same number by construction rather than by agreement.
  // TEN-384 · the reference's order (and README §5.2A's): Hard · Clay · Grass · Indoors.
  var CAREER_ROWS = [
    { id: 'hard', label: 'Hard' },
    { id: 'clay', label: 'Clay' },
    { id: 'grass', label: 'Grass' },
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
  // TEN-384 fix item 9 (founder 2026-10-05): ONE small-sample mark on every profile surface,
  // "small sample · n=X", never an asterisk. Every printed mark goes through this.
  function smallSampleText(n) { return 'small sample ' + MIDDOT + ' n=' + n; }
  // The visible form: mono 10px label grey, the same mark the 2026 tab's month rows print.
  function smallSampleHtml(n, extra) {
    return '<span data-pp2-small="' + n + '" style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;' +
      'font-weight:400;letter-spacing:0;text-transform:none;color:var(--text-label);white-space:nowrap;' +
      (extra || '') + '">' + smallSampleText(n) + '</span>';
  }
  // TEN-384 fx3 (founder D11, 2026-10-07): the mark sits UNDER the rate, in every table — the rate on its
  // own line, the mark right-aligned beneath it (the 2026 tab's month-row form). A row that carries one lets
  // its cells stretch so the first line stays level across the row and the mark takes the second.
  function rateOverMark(rateHtml, n, extra) {
    return '<span data-pp2-ratemark="' + n + '" style="display:flex;flex-direction:column;align-items:flex-end;' +
      'gap:2px;min-width:0;' + (extra || '') + '">' + rateHtml + smallSampleHtml(n) + '</span>';
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

  // ─── RULING N4 · court-speed label = the pipeline 3-band (founder 2026-09-28) ─
  // Every surface on the site labels court speed with ONE scheme:
  // courtSpeedCategory() on the 0-100 COURT_CONDITIONS index (<= 43 Slow,
  // <= 68 Medium, else Fast). The modal Tournament card, Key factors and the
  // Weather pace tile read the pipeline's stamp of it; the Tournament Report
  // calls the dashboard's copy. This module calls that same dashboard copy on
  // the same dashboard table, so it holds NO cut-offs of its own — a cut-off
  // written here is a second scheme waiting to drift.
  //
  // RETIRED by N4: the five Abstract-Speed quintile bands (Very slow ... Very
  // fast, 0.752/0.938/1.076/1.188) and the 2026-09-16 "grass is always Very
  // fast" rule. A grass venue now bands off its own index like any other, and a
  // grass row with no rated venue is unbanded and counted out loud like any
  // other. Evidence: TEN-312 document `n4-court-speed` (64 venues).
  var SPEED_BANDS = [
    { id: 'slow', label: 'Slow' },
    { id: 'med', label: 'Medium' },
    { id: 'fast', label: 'Fast' }
  ];
  var SPEED_BASIS = 'Court-speed index (0' + ENDASH + '100) of 64 rated venues: Slow ≤ 43 ' +
    MIDDOT + ' Medium ≤ 68 ' + MIDDOT + ' Fast';
  /**
   * The dashboard's COURT_CONDITIONS and courtSpeedCategory are top-level
   * declarations in an earlier classic script, so on the page they resolve as
   * bare globals; `window.*` is the injection point for a harness. Absent
   * either, nothing is banded — never a guessed band.
   */
  function speedScheme() {
    /* global COURT_CONDITIONS, courtSpeedCategory */
    var w = (typeof window !== 'undefined') ? window : {};
    var cc = (typeof COURT_CONDITIONS !== 'undefined') ? COURT_CONDITIONS : (w.COURT_CONDITIONS || null);
    var cat = (typeof courtSpeedCategory === 'function') ? courtSpeedCategory
      : (typeof w.courtSpeedCategory === 'function' ? w.courtSpeedCategory : null);
    return (cc && cat) ? { cc: cc, cat: cat } : null;
  }
  function bandByLabel(label) {
    for (var i = 0; i < SPEED_BANDS.length; i++) if (SPEED_BANDS[i].label === label) return SPEED_BANDS[i];
    return null;
  }
  /** A COURT_CONDITIONS venue key -> its band, through the site's one scheme. */
  function speedBandFor(venue) {
    var s = speedScheme();
    var c = (s && venue != null) ? s.cc[venue] : null;
    if (!c || c.speed == null) return null;
    return bandByLabel(s.cat(c.speed));
  }
  function speedBandForRow(m) {
    return m ? speedBandFor(m.venue) : null;
  }

  // ─── RULING 6 · match-stat provenance ──────────────────────────────────────
  // Winners and Unforced errors ARE native api-tennis fields ("Points:Winners",
  // "Points:Unforced errors"). Match Charting Project is therefore NOT needed for
  // them and its CC BY-NC-SA / R&D-only flag stays where it is.
  //
  // NET POINTS EXISTS TOO, and the claim that it did not was wrong. The earlier
  // "a full key census returns zero net-related fields" was run before the
  // stat_name casing fix and the Challenger sweep; re-run against the committed
  // floor it returns `Points:Net points won` on 1,674 of 3,493 populated
  // player-sides (47.9%), as a PERCENTAGE with won/total denominators preserved
  // in the entry's `raw` sub-object (e.g. {won:9,total:12} -> 75). Measured on the
  // deployed store the same field reads 712/3,321 (21.4%) — the sweep is what
  // more than doubles it. `kind` is 'pct' because that is what the repo's own
  // extractor already calls it (bsp-pipeline.js:2249), not a reading of the
  // values.
  //
  // That stale claim was not a harmless comment: it was rendered to the user as
  // "net points is not an api-tennis field at all" on a match sheet whose own
  // store carried the number. Under this repo's rules a dash means "we do not
  // hold this" — saying it about data we DO hold is the same defect as inventing
  // a value, pointed the other way.
  //
  // Founder ruling 2026-09-18 (Q2): "per match — read the field, dash on null. […]
  // Apply the same rule to Winners, UE and Net points." So all three are ordinary
  // field reads now; none of them is pre-declared absent. The ellipsis stands for the
  // whole-event-note sentence, implemented at wholeEventNote() below — it is marked
  // because an earlier version of this comment spliced the two halves into one
  // quotation and made the ruling read as though it had only two parts.
  var STAT_ROWS = [
    { key: 'Points:Winners', label: 'Winners', src: 'api-tennis' },
    { key: 'Points:Unforced errors', label: 'Unforced errors', src: 'api-tennis' },
    { key: 'Points:Net points won', label: 'Net points won', src: 'api-tennis' }
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
    // (`style-hover="background:var(--inner)"`, Player Stat Boxes
    // .dc.html:489). An inline style cannot express :hover, so it lands here,
    // scoped to the one class that carries it. The selected row sets its own
    // inline background, which outranks this.
    '.pp2-trow:hover{background:var(--tile-hover);}' +
    // A1/A3 · the box grid's responsive steps and the box hover border. Both are
    // states an inline style cannot express, so they land here with the rest.
    // The grid had NO media queries at all before this — the four-column track
    // was fixed at every width, down to a phone.
    //
    // `!important` is load-bearing and is NOT cargo-culted from the rule above
    // it. Unlike `.pp2-trow`, both of these elements carry the property inline
    // (`grid-template-columns:repeat(4,…)` on the grid, `border:1px solid …` on
    // the box), and an inline declaration outranks any selector. Measured: the
    // first version of these rules without it left the grid at four columns at
    // 640px and the hover border unchanged at color-mix(in srgb, var(--text) 9%, transparent) under a
    // real mouse — the probe caught both.
    '@media (max-width:1100px){.pp2-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;}}' +
    '@media (max-width:720px){.pp2-grid{grid-template-columns:minmax(0,1fr)!important;}}' +
    // TEN-384: clickable tile hover = --tile-hover + --edge-16; ribbon chip hover = --edge-24.
    '.pp2-box:hover{background:var(--tile-hover)!important;border-color:var(--edge-16)!important;}' +
    '.pp2-chip:hover{border-color:var(--edge-24)!important;}' +
    // §5.2B — every clickable record in the Career modal's season table. The
    // design file gives these cells `cursor:{{ y.cursor }}` but NO style-hover,
    // so the hover token is the one the same file uses for its other clickable
    // data row (.dc.html:489) rather than a colour invented here.
    '.pp2-crec{transition:background .12s ease,color .12s ease;}' +
    '.pp2-crec:hover{background:var(--tile-hover);color:var(--text);}' +
    // §5.4 item 14 — the heat cell's hover, verbatim from the design file's own
    // stylesheet (`Player Stat Boxes.dc.html`:24-26). A win cell goes to green
    // 0.42 with an inset ring, a loss cell to red, a level cell to white 0.14.
    // These need !important for the same reason the file uses it: the cell
    // carries its own inline background and an inline declaration outranks a
    // selector. The empty-month cell has no class and therefore no hover.
    // TEN-384 K5 · the reference's hover is one neutral lift for every cell: white 14% with an inset
    // white 22% ring (no green / red wash — the tint stays the flat 10%).
    '.calw:hover,.call:hover,.caln:hover{background:color-mix(in srgb, var(--text) 14%, transparent)!important;' +
    'color:var(--text)!important;box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--text) 22%, transparent)!important;}' +
    // ─── §5.6 item 15 · the bubble-chart x tick labels ───────────────────────
    // `tickLabel()` (Player Stat Boxes.dc.html:1546) drives four properties off a
    // HOVER state (`styleTick`) and swaps the abbreviation for the full archetype
    // name. Doing that through our state object would repaint the entire modal on
    // every pass of the pointer, so the lift is CSS and the text swap is a display
    // toggle over two spans. `.on` is the selected archetype, which the file lifts
    // the same way. Values are the file's: colour var(--text-label) -> var(--text), weight
    // 400 -> 700, border-bottom dotted color-mix(in srgb, var(--text) 22%, transparent) -> solid
    // color-mix(in srgb, var(--bar) 45%, transparent), background transparent -> var(--page), z-index 1 -> 3.
    // TEN-384: the reference's tick — Plex 10/600, 0.06em, --text-label; the
    // selected archetype (and a hovered one) goes white 700. The abbreviation
    // stays (the full name is the title); no chip, no rule under it.
    '.pp2-stk{position:absolute;top:8px;transform:translateX(-50%);cursor:pointer;z-index:1;' +
    'background:transparent;color:var(--text-label);' +
    "font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:0.06em;white-space:nowrap;}" +
    '.pp2-stk .pp2-stk-n{display:none;}' +
    '.pp2-stk:hover,.pp2-stk.on{color:var(--text);font-weight:700;z-index:3;}</style>';

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

  // ─── surface colours (README §4 / §9; grass aligned to var(--pos)) ────────────
  var SURF_COLOUR = { hard: 'var(--text-soft)', clay: 'var(--text-soft)', grass: 'var(--text-soft)', indoors: 'var(--text-soft)' };   // surfaces neutral (TEN-376)
  function surfColour(s) { return SURF_COLOUR[String(s || '').toLowerCase()] || 'var(--text-label)'; }

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
  //
  // TEN-384 fix item 10 (founder 2026-10-05): a two-part first name arrives as TWO initials
  // ("J. M. Cerundolo", "T. M. Etcheverry"). The prefix is the whole run of "X." initials, so the
  // surname is "Cerundolo" (not "M. Cerundolo") and the surname-first form is "Cerundolo J. M.".
  // fx4 item 6: an initial may be HYPHENATED ("J-L. Struff" -> surname "Struff", "Struff J-L."), and a dotted
  // double initial needs no space ("J.J. Wolf" -> "Wolf J. J.").
  var NAME_INITIALS_RE = /^((?:[A-Za-z](?:-[A-Za-z])?\.\s*)+)(\S.*)$/;
  function surnameOf(name) {
    var n = String(name || '').trim();
    var m = NAME_INITIALS_RE.exec(n);
    return m ? m[2] : n;
  }
  /** Every leading initial, spaced: "J. M. Cerundolo" -> "J. M."; "B. Shelton" -> "B."; none -> "". */
  function initialsOf(name) {
    var m = NAME_INITIALS_RE.exec(String(name || '').trim());
    return m ? spacedInitials(m[1]) : '';
  }
  /** "J.M. " / "J. M." -> "J. M." */
  function spacedInitials(run) {
    return String(run || '').replace(/\s+/g, '').split('.').filter(Boolean)
      .map(function (c) { return c + '.'; }).join(' ');
  }
  /** "B. Shelton" -> "Shelton B."; "J. M. Cerundolo" -> "Cerundolo J. M."; no initial prefix -> unchanged. */
  function surnameFirst(name) {
    var s = surnameOf(name), i = initialsOf(name);
    return i ? s + ' ' + i : s;
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

  // A walkover — given or received — is neither a win nor a loss (founder ruling
  // 2026-09-28, TEN-313, "as the ATP rules and the ATP website do"; supersedes the
  // 2026-08-04 "received = win"). recentForm carries the flag explicitly, so the
  // ribbon and ledger honour it instead of re-deriving from an empty score.
  function counts(m) { return !m.walkover; }

  // Recent form (founder TEN-383, 2026-10-04: "profile too"): a match outside the ATP's
  // official win-loss record is never a form row — not in the ribbon, its rate, the chips or
  // the full ledger. Laver Cup and the exhibitions are out; Davis Cup and United Cup stay.
  // The SAME list as the dashboard's FH_FORM_NOT_ATP_RECORD and the pipeline's
  // FORM_NOT_ATP_RECORD (test-ten330-form.mjs asserts the three sources are equal). Records
  // (header Season, Career record, its drills, the sheet lookup) keep every match.
  var FORM_NOT_ATP_RECORD = /laver cup|hopman cup|ultimate tennis showdown|\buts\b|six kings|exhibition|kooyong classic|mubadala world tennis/i;
  function inForm(m) { return !FORM_NOT_ATP_RECORD.test(String((m && m.tournament) || '')); }

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
  // TEN-384 fix item 13 (founder 2026-10-05: group name "ATP Indian Wells" -> "Indian Wells").
  // The "ATP " prefix is minted upstream: api-tennis' tournament_name, stored verbatim on every
  // recentForm and career-history row. The Calendar / Court speed drills already showed the
  // cleaned name (calSpine's evOf: the per-player vote onto Record per tournament's canonical
  // name, else calEventClean), while the ribbon, ledger, header and match panel printed the raw
  // feed string. ONE rule now names an event on every profile surface: the same vote, then the
  // same cleanup — so "ATP London" reads "Queen's Club" wherever Record per tournament does.
  function eventName(m, p) {
    var raw = String((m && m.tournament) || '');
    if (!raw) return DASH;
    var a = p ? eventAliasFor(p) : null;
    return (a && a[raw]) || calEventClean(raw) || DASH;
  }
  function eventAliasFor(p) {
    var ch = careerHistoryFor(p.key), th = p.tournamentHistory;
    if (eventAliasFor._k === p.key && eventAliasFor._ch === ch && eventAliasFor._th === th) return eventAliasFor._v;
    eventAliasFor._k = p.key; eventAliasFor._ch = ch; eventAliasFor._th = th;
    eventAliasFor._v = calNameMap(p);
    return eventAliasFor._v;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  // §1 Page frame + back link
  function renderBackLink() {
    return '' +
      '<a href="#" class="pp2-back" data-pp2="back" ' +
      'style="display:inline-flex;align-items:center;gap:9px;font-size:13.5px;font-weight:600;' +
      'color:var(--text-label);align-self:flex-start;text-decoration:none;">' +
      '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l-5 5 5 5"/></svg>' +
      'Back to Players</a>';
  }

  // §2 Header
  // TEN-384 fx4 item 2 · the header's "No. N" reads the SAME rank as the Players card: the host's live
  // standings (player-index.json, through pp2Bridge → window.pp2LiveRank) first, else the frozen
  // profile.rank (built per run and reused for up to 14 days — Ruud read No. 17 against card #24).
  function headerRank(p) {
    var live = null;
    try {
      if (typeof window !== 'undefined' && typeof window.pp2LiveRank === 'function') live = window.pp2LiveRank(p.key);
    } catch (e) { live = null; }
    if (live != null && live !== '' && isFinite(parseInt(live, 10)) && parseInt(live, 10) > 0) return String(parseInt(live, 10));
    return p.rank == null || p.rank === '' ? null : String(p.rank);
  }
  function renderHeader(p, ctx) {
    var rank = headerRank(p);
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
      run ? 'var(--text)' : DASH_COLOUR,   // TEN-384: Current run is white (the W/L letter carries the sign)
      run ? 'since ' + fmtDayMonth(run.since) : 'no matches on record'));

    // Last played
    cells.push(cell('Last played',
      last ? agoText(last.date) : DASH,
      last ? 'var(--text)' : DASH_COLOUR,
      last ? esc(eventName(last, p) + ' ' + roundLabel(last)) : 'no matches on record'));

    // Next match — fixture feed. Not held by player-profiles.json; when the
    // board's fixture store is not on the page this is a dash with the reason
    // the spec prescribes, never a fabricated "Tomorrow".
    var nx = ctx.nextMatch;
    cells.push(cell('Next match',
      nx && nx.label ? esc(nx.label) : DASH,
      nx ? 'var(--text)' : DASH_COLOUR,
      nx ? 'vs ' + (nx.opponent ? '<span style="font-weight:600;color:var(--text);">' + esc(initialSurname(nx.opponent)) + '</span>' : DASH)
        : 'no fixture on record'));

    // Season
    var sN = (sWon || 0) + (sLost || 0);
    cells.push(cell('Season',
      sN ? rateText(sWon, sLost) : DASH,
      sN ? 'var(--text)' : DASH_COLOUR,
      sN ? recordText(sWon, sLost) : 'no matches on record'));

    // TEN-384 (step 4, reference OFFICIAL VERSION 1): avatar 104, the name at 40/800 and ONE meta line under
    // it — archetype (white 700) · country · Age N · Elo N (mono, white). No "ATP No." pill: the rank lives
    // on the avatar badge. Elo is the Players card's own source (pgEloFor over elo-ratings.json, through
    // the host's pp2EloFor bridge); absent -> the part is left out rather than printed as a guess.
    var elo = typeof window.pp2EloFor === 'function' ? window.pp2EloFor(p.name) : null;
    var meta = [];
    meta.push('<span style="font-weight:700;color:' + (ctx.archetype ? 'var(--text)' : DASH_COLOUR) + ';">' +
      esc(ctx.archetype || DASH) + '</span>');
    meta.push('<span>' + esc(p.country || DASH) + '</span>');
    meta.push('<span>' + (p.age == null ? DASH : 'Age ' + esc(p.age)) + '</span>');
    meta.push('<span>Elo <span style="font-family:\'IBM Plex Mono\',monospace;color:' +
      (elo == null ? DASH_COLOUR : 'var(--text)') + ';">' + (elo == null ? DASH : esc(Math.round(Number(elo)))) +
      '</span></span>');
    return '' +
      '<div class="pp2-head" style="border-bottom:1px solid var(--line);padding-bottom:26px;' +
      'display:flex;align-items:flex-start;gap:28px;flex-wrap:wrap;">' +
      renderAvatar(p, rank) +
      '<div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:10px;">' +
        '<span class="pp2-name" style="font-size:40px;font-weight:800;letter-spacing:-0.8px;line-height:40px;' +
          'white-space:nowrap;color:var(--text);">' + esc(p.name) + '</span>' +
        '<span class="pp2-meta" style="font-size:14px;color:var(--text-label);">' +
          meta.join(' ' + MIDDOT + ' ') + '</span>' +
      '</div>' +
      // The four state cells sit on the avatar's baseline (reference: the strip's bottom = the avatar's
      // bottom), each with a 1px --line rule on its left that spans the cell's own text block only.
      '<div style="flex:none;align-self:flex-end;display:flex;align-items:flex-end;">' +
        cells.join('') +
      '</div>' +
      '</div>';

    /**
     * One live-state cell, with its leading rule.
     *
     * The rule is a sibling span rather than the cell's own border-left, so its
     * height is set by the TEXT and not by however tall the flex row has grown.
     * `align-items:center` on the pair centres it on the text block, which is
     * what the design capture shows (rule 54.5 CSS, text ink 50.0, ~3 above and
     * ~1.5 below).
     */
    function cell(label, value, colour, sub) {
      return '' +
        '<div class="pp2-cell" style="display:flex;flex-direction:column;justify-content:flex-end;gap:6px;' +
          'padding:0 20px;border-left:1px solid var(--line);">' +
        '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
          'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);white-space:nowrap;">' + label + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;' +
          'color:' + colour + ';white-space:nowrap;">' + value + '</div>' +
        '<div style="font-size:12px;color:var(--text-label);white-space:nowrap;">' + sub + '</div>' +
        '</div>';
    }
  }

  // TEN-384: 104px, initials (or the photo, same chain as the Players cards) on the avatar tone, and the
  // rank as a "No. N" badge — no blue fill. Founder Q3 (2026-10-05): avatar and badge = --selected with a
  // --edge-16 hairline; the badge keeps its 3px ring, in --page. Initials stay white.
  var AVATAR_TONE = 'var(--selected)';
  var RANK_TONE = 'var(--selected)';
  function renderAvatar(p, rank) {
    var photos = typeof window.photoCandidatesFor === 'function' ? (window.photoCandidatesFor(p.key) || []) : [];
    var img = photos.length
      ? '<img src="' + esc(photos[0]) + '" alt="" referrerpolicy="no-referrer" data-fb="' + esc(photos.slice(1).join('|')) + '" ' +
        // the host's own photo chain (defined beside photoCandidatesFor, as on the Players cards)
        'onerror="if(!avatarChainNext(this))this.style.display=\'none\'" ' +
        'style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;">'
      : '';
    return '' +
      '<div class="pp2-avatar" style="width:104px;height:104px;position:relative;flex:none;">' +
      '<div style="position:relative;width:100%;height:100%;box-sizing:border-box;border-radius:50%;display:flex;' +
        'align-items:center;justify-content:center;overflow:hidden;background:' + AVATAR_TONE + ';' +
        'border:1px solid var(--edge-16);font-family:\'IBM Plex Mono\',monospace;font-size:30px;' +
        'font-weight:700;color:var(--text);">' + esc(initials(p.name)) + img + '</div>' +
      (rank ? '<div class="pp2-rank" style="position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);' +
        'background:' + RANK_TONE + ';color:var(--text);font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;' +
        'font-weight:700;border-radius:999px;padding:3px 10px;border:1px solid var(--edge-16);white-space:nowrap;' +
        'box-shadow:0 0 0 3px var(--page);">No. ' + esc(rank) + '</div>' : '') +
      '</div>';
  }

  // §3 Recent-form ribbon
  function renderRibbon(ctx) {
    var rows = ctx.filtered;
    var last18 = rows.slice(-18);
    var r = formRate(last18);
    var chips = rows.slice(-6).reverse();

    // TEN-384: every strip cell opens that match's stats sheet, like the chips and the ledger rows.
    var strip = last18.map(function (m) {
      var w = !!m.won;
      return '<div class="pp2-strip-cell" ' + sheetHook(m.date + '|' + (m.opponent || '')) +
        'style="flex:1;height:22px;border-radius:5px;display:flex;align-items:center;' + sheetCursor() +
        'justify-content:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
        'background:' + (w ? 'color-mix(in srgb, var(--pos) 22%, transparent)' : 'color-mix(in srgb, var(--neg) 22%, transparent)') + ';' +
        'color:' + (w ? 'var(--pos)' : 'var(--neg)') + ';">' + (w ? 'W' : 'L') + '</div>';
    }).join('');

    var chipHtml = chips.map(function (m) {
      var w = !!m.won;
      return '<div class="pp2-chip" ' + sheetHook(m.date + '|' + (m.opponent || '')) +
        // TEN-384: card tone, no edge at rest (the transparent 1px keeps the box size); hover = --edge-24
        // (PP2_STYLE .pp2-chip:hover).
        'style="display:flex;gap:8px;padding:7px 10px;background:var(--card);border:1px solid transparent;' +
        'border-radius:8px;white-space:nowrap;flex:none;' + sheetCursor() + 'align-items:center;' +
        'transition:border-color .14s ease;">' +
        '<div style="width:20px;height:20px;border-radius:5px;display:flex;align-items:center;' +
          'justify-content:center;font-family:\'IBM Plex Mono\',monospace;font-size:10px;font-weight:700;' +
          'background:' + (w ? 'color-mix(in srgb, var(--pos) 16%, transparent)' : 'color-mix(in srgb, var(--neg) 16%, transparent)') + ';' +
          'color:' + (w ? 'var(--pos)' : 'var(--neg)') + ';">' + (w ? 'W' : 'L') + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:2px;">' +
          // Correction-pass item 4a: surname-first, as the export writes every
          // name that is not the subject.
          '<div style="font-size:12px;font-weight:700;">' +
            esc(m.opponent ? surnameFirst(m.opponent) : DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:var(--text-label);">' +
            esc(eventName(m, ctx.p) + ' ' + roundLabel(m)) + ' ' + MIDDOT + ' ' +
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
      // TEN-384: a top-level card — --card + --top-light, no outline.
      '<div class="pp2-ribbon" style="background:var(--card);box-shadow:var(--top-light);border:1px solid transparent;' +
      'border-radius:12px;' +
      'padding:16px 22px;display:grid;grid-template-columns:auto minmax(180px,1.2fr) auto minmax(0,2fr) auto;' +
      'gap:22px;align-items:center;">' +
        // reference: label then figure, 5px apart, the label on the strip's top line (no eyebrow margin)
        '<div style="white-space:nowrap;display:flex;flex-direction:column;gap:5px;">' +
          '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
            'text-transform:uppercase;color:var(--text-label);">Recent form</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:22px;font-weight:700;line-height:1;">' +
            '<span style="line-height:1;color:var(--text);">' + (r.n ? rateText0(r.won, r.lost) : DASH) + '</span> ' +
            '<span style="line-height:1;font-size:13px;font-weight:600;color:var(--text-label);">' +
              (r.n ? recordText(r.won, r.lost) : 'no matches on record') + '</span>' +
          '</div></div>' +
        '<div><div style="display:flex;gap:4px;">' + (strip || '') + '</div>' +
          eyebrow('last ' + last18.length + ' ' + MIDDOT + ' oldest → most recent') + '</div>' +
        '<div style="width:1px;height:44px;background:var(--line);"></div>' +
        '<div style="display:flex;gap:8px;overflow:hidden;' +
          '-webkit-mask-image:linear-gradient(90deg,var(--page) 82%,transparent);' +
          'mask-image:linear-gradient(90deg,var(--page) 82%,transparent);">' + chipHtml + '</div>' +
        // A link while it opens the ledger; "Hide ledger" is a toggle word, so white (foundation).
        '<a href="#" data-pp2="ledger" style="font-size:12.5px;font-weight:700;' +
          'color:' + (ctx.ledgerOpen ? 'var(--text)' : 'var(--link)') + ';' +
          'white-space:nowrap;text-decoration:none;">' +
          (ctx.ledgerOpen ? 'Hide ledger' : 'Full ledger →') + '</a>' +
      '</div>';
  }

  // Correction-pass items 12 + 15. This helper paints every eyebrow on the page
  // and had drifted three ways from the export's `.cap` class
  // (Player Profile.dc.html:25) — 10.5px vs 9.5px, 0.14em vs 0.16em, var(--text-label) vs
  // var(--text-label). One edit, page-wide reach.
  function eyebrow(text) {
    return '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);margin-top:6px;">' + text + '</div>';
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
  // Michael's ruling 2026-09-17T10:45Z item 2. bet365-history/2 entries carry an
  // explicit `cut` field saying WHICH timestamp the series was cut at, and
  // `cut === 'none'` means the fixture had no observed first ball, so the series
  // was stored UNCUT and its tail may be an in-play price. Only a series cut at
  // the trueStart is a close; anything else dashes.
  //
  // A /1 entry has no `cut` field at all. Those keep today's behaviour rather
  // than being blanked wholesale: they were cut at `trueStartTime or startTime`,
  // so ~96.4% of them are correct and the file no longer records which. Blanking
  // every historical close to fix 3.59% of them would be the bigger error, and
  // the /2 rewrite is what retires the ambiguity. Flagged to Michael, not slipped.
  function b365Close(entry, series) {
    if (entry && entry.cut && entry.cut !== 'trueStart') return null;
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
        // DAY BUCKET ONLY — never a cutoff. /2 split the collapsed `start` into
        // trueStart / startSched; either dates the fixture to within a day, and
        // the join already allows +-1 day. `f.start` is the /1 fallback.
        var day = b365DayOf(f.trueStart != null ? f.trueStart
          : (f.startSched != null ? f.startSched : f.start));
        if (!day) continue;
        var pair = a < b ? a + '|' + b : b + '|' + a;
        (out[pair] = out[pair] || []).push({
          day: day, a: a, b: b,
          closeA: b365Close(f, f.s1), closeB: b365Close(f, f.s2)
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
    // TEN-384 fix 6 · ONE price per match. Where the career match store holds this match (date +
    // opponent), the ledger takes calSpine()'s price — the Market edge close its join landed, else the
    // bet365 capture — the same row the Calendar, Court speed and Derived lines read, so a match cannot
    // be priced in one and dashed (or priced differently) in another. The date-only lookup below is
    // the fallback for a match the career store does not hold (or has not loaded).
    var sp = careerHistoryFor(p.key) ? pairKeyIndex(calSpine(p), function (r) { return r.date + '|' + oppKeyOf(r.opp); }) : {};
    return ledgerMatches(p).map(function (m) {
      var cs = sp[m.date + '|' + oppKeyOf(m.opponent)];
      if (cs) {
        if (cs.price == null && cs.oppPrice == null) {
          return { m: m, price: null, oppPrice: null, role: null, book: null, basis: null };
        }
        var both = cs.price != null && cs.oppPrice != null;
        return {
          m: m, price: cs.price, oppPrice: cs.oppPrice,
          role: cs.priceBasis === 'close' ? (cs.role || null)
            : (both ? (cs.price < cs.oppPrice ? 'fav' : cs.price > cs.oppPrice ? 'dog' : 'level') : null),
          book: cs.book || null, basis: cs.priceBasis
        };
      }
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
  // 'var(--inner)' : 'transparent'` (Player Profile.dc.html:1553). We
  // were drawing var(--viz-guide) on every chip, which reads as four
  // buttons rather than one control. The transparent border is kept (not
  // dropped) so the selected and unselected chips stay the same size.
  function ledgerChip(attr, id, label, on) {
    return '<span data-pp2="' + attr + '" data-v="' + esc(id) + '" ' +
      'style="font-size:12px;padding:7px 13px;border-radius:8px;cursor:pointer;white-space:nowrap;' +
      'font-weight:' + (on ? '700' : '600') + ';color:' + (on ? 'var(--text)' : 'var(--text-label)') + ';' +
      'background:' + (on ? 'var(--inner)' : 'transparent') + ';' +
      'border:1px solid ' + (on ? 'var(--edge-10)' : 'transparent') + ';">' +
      esc(label) + '</span>';
  }
  // TEN-384: the price filter, on its own Darker track (founder Q4: every filter) — on: --inner + --edge-10,
  // white, with a WHITE filled mark; off: no fill, no edge, grey words and a 10% outlined mark. Both on = union.
  function ledgerPriceChip(id, label, on) {
    return '<span data-pp2="ledger-price" data-v="' + esc(id) + '" ' +
      'style="display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:' + (on ? '700' : '600') + ';' +
      'padding:5px 10px;border-radius:8px;cursor:pointer;' +
      'color:' + (on ? 'var(--text)' : 'var(--text-label)') + ';' +
      'background:' + (on ? 'var(--inner)' : 'transparent') + ';' +
      'border:1px solid ' + (on ? 'var(--edge-10)' : 'transparent') + ';">' +
      '<span class="pp2-price-mark" style="width:11px;height:11px;box-sizing:border-box;border-radius:3px;flex:none;' +
        (on ? 'background:var(--text);border:1px solid var(--text);' : 'border:1px solid var(--edge-10);') + '"></span>' +
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

  // ─── TEN-384 · the full ledger, rebuilt to the step-4 reference ────────────
  // One head row (Date · W/L · Opponent · Rd · Sets · Set scores · H · A) over the founder's 8-column grid,
  // the rows grouped by event under "name  surface · W–L", the open row washed while its sheet is up, and
  // "See all N results" where the provenance footnote used to sit. Every row, every W/L square and every
  // strip cell opens the step-3 Match analysis stats sheet (openMatchSheet below).
  var LEDGER_GRID = 'display:grid;grid-template-columns:52px 12px minmax(140px,1fr) 44px 40px ' +
    'minmax(190px,1.2fr) 48px 48px;gap:0 10px;align-items:center;';
  // Founder Q4 (2026-10-05): the ledger filters sit on the Darker track (track --card + --edge-6; selected
  // --inner + --edge-10, white 700; idle grey) and the head rule is --edge-10.
  var LEDGER_FILTER_TRACK = 'align-self:flex-start;gap:2px;padding:2px;border-radius:9px;' +
    'background:var(--card);border:1px solid var(--edge-6);';
  var LEDGER_HEAD_RULE = 'var(--edge-10)';
  // Founder Q3: the open row's wash = --selected.
  var LEDGER_OPEN_TONE = 'var(--selected)';
  var MONO = 'font-family:\'IBM Plex Mono\',monospace;';

  function surfaceWord(s) {
    var k = String(s || '').toLowerCase();
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : DASH;
  }

  function renderLedger(p, ctx) {
    if (!ctx.ledgerOpen) return '';
    var rows = ctx.ledgerFiltered;
    // §4 reconciliation: "Recent-form ribbon W-L and % = the strip shown = the
    // ledger's last-N rows." The ribbon rates its last 18; this card must rate
    // the SAME 18, not the whole filtered set.
    var stripRows = rows.slice(-LEDGER_CAP);
    var r = formRate(stripRows.map(function (x) { return x.m; }));
    // TEN-384 (founder 2026-10-07) · while "See all N results" has the WHOLE window open, the head rates
    // every row the ledger lists (the same filtered form rows, the same Form rule: a walkover is neither a
    // win nor a loss); collapsed back, it returns to the strip's last LEDGER_CAP above. Filters narrow both.
    var allShown = !!state.ledgerExpanded && rows.length > LEDGER_CAP;
    var hr = allShown ? formRate(rows.map(function (x) { return x.m; })) : r;
    var surfOn = state.surfaces;
    var chips = LEDGER_SURFACES.map(function (s) {
      var on = s.id === 'all' ? !surfOn.length : surfOn.indexOf(s.id) >= 0;
      return ledgerChip('ledger-surf', s.id, s.label, on);
    }).join('');
    var priceChips = LEDGER_PRICES.map(function (x) {
      return ledgerPriceChip(x.id, x.label, state.priceFilters.indexOf(x.id) >= 0);
    }).join('');

    // Strip is the same slice the rate above was taken over (README §3), so the
    // two cannot disagree. Each cell opens its match's sheet.
    var strip = stripRows.map(function (x) {
      var w = !!x.m.won;
      return '<div class="pp2-strip-cell" ' + sheetHook(x.m.date + '|' + (x.m.opponent || '')) +
        'style="flex:1;height:26px;border-radius:5px;display:flex;align-items:center;' + sheetCursor() +
        'justify-content:center;' + MONO + 'font-size:10px;font-weight:700;' +
        'background:' + (w ? 'color-mix(in srgb, var(--pos) 22%, transparent)' : 'color-mix(in srgb, var(--neg) 22%, transparent)') + ';' +
        'color:' + (w ? 'var(--pos)' : 'var(--neg)') + ';">' + (w ? 'W' : 'L') + '</div>';
    }).join('');

    var head = '' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;' +
        'flex-wrap:wrap;margin-bottom:16px;">' +
        '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
          'text-transform:uppercase;color:var(--text-label);">Recent form ' + MIDDOT + ' full ledger</span>' +
        '<span style="' + MONO + 'font-size:12px;color:var(--text-label);">' +
          (hr.n ? '<span style="color:var(--text);font-weight:700;">' + rateText0(hr.won, hr.lost) + ' win</span> '
            : '<span style="color:' + DASH_COLOUR + ';font-weight:700;">' + DASH + '</span> ') +
          // TEN-384 fix 4 · the rate is over the strip's last LEDGER_CAP rows (the Form rule: ribbon = strip =
          // this rate) and "See all N results" counts the whole window, so the head names both: "last 18 of
          // 33 matches". Under the cap the two are one number and it reads "11 matches".
          // Expanded, the head rates every row listed, "89% win · 35 matches"; a walkover in the window is listed
          // but decides nothing, so the count names both, "89% win · 34 of 35 matches", and agrees with "See all 35".
          MIDDOT + ' ' + (allShown ? (rows.length > hr.n ? hr.n + ' of ' + rows.length : hr.n)
            : rows.length > r.n ? 'last ' + r.n + ' of ' + rows.length : r.n) + ' match' +
          ((allShown ? rows.length : rows.length > r.n ? rows.length : r.n) === 1 ? '' : 'es') + '</span>' +
      '</div>';

    var legend = '' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-label);">' +
        '<span style="display:inline-flex;align-items:center;gap:6px;">' +
          '<span style="width:10px;height:10px;border-radius:3px;background:color-mix(in srgb, var(--pos) 22%, transparent);"></span>Win</span>' +
        '<span style="display:inline-flex;align-items:center;gap:6px;">' +
          '<span style="width:10px;height:10px;border-radius:3px;background:color-mix(in srgb, var(--neg) 22%, transparent);"></span>Loss</span>' +
        '<span style="width:1px;height:14px;background:var(--edge-10);"></span>' +
        '<span class="pp2-price-track" style="display:inline-flex;' + LEDGER_FILTER_TRACK + '">' + priceChips + '</span>' +
      '</div>';

    var heads = '<div class="pp2-ledger-head" style="' + LEDGER_GRID + 'padding:0 8px 8px;' +
      'border-bottom:1px solid ' + LEDGER_HEAD_RULE + ';">' +
      ledgerEyebrow('Date', 'left') + '<span></span>' + ledgerEyebrow('Opponent', 'left') +
      ledgerEyebrow('Rd', 'left') + ledgerEyebrow('Sets', 'left') + ledgerEyebrow('Set scores', 'left') +
      ledgerEyebrow('H', 'right') + ledgerEyebrow('A', 'right') + '</div>';

    var body, foot = '';
    if (!rows.length) {
      // Our state (no reference example): the message stays, in a panel inside the card.
      body = '<div class="pp2-ledger-empty" style="background:var(--card);border:1px solid var(--edge-6);' +
        'border-radius:10px;padding:26px;margin-top:12px;text-align:center;font-size:13px;' +
        'color:var(--text-label);">No matches with these filters.</div>';
    } else {
      // Newest first, grouped by event. A group header repeats only when the
      // event changes, so a player who played one event twice in the window
      // gets two headers — which is what the export shows.
      var ordered = rows.slice().reverse();
      var shown = state.ledgerExpanded ? ordered : ordered.slice(0, LEDGER_CAP);
      var groups = [];
      shown.forEach(function (x) {
        var ev = eventName(x.m, p);
        var g = groups[groups.length - 1];
        if (!g || g.ev !== ev) groups.push(g = { ev: ev, surface: x.m.surface, rows: [] });
        g.rows.push(x);
      });
      body = '<div class="pp2-ledger-body">' + groups.map(function (g) {
        var rec = formRate(g.rows.map(function (x) { return x.m; }));
        return '<div class="pp2-ledger-event" style="display:flex;align-items:baseline;gap:10px;' +
            'padding:12px 8px 6px;border-top:1px solid var(--line);">' +
            '<span style="font-size:12.5px;font-weight:700;color:var(--text);">' + esc(g.ev) + '</span>' +
            '<span style="' + MONO + 'font-size:10.5px;color:var(--text-label);">' +
              esc(surfaceWord(g.surface)) + ' ' + MIDDOT + ' ' + rec.won + ENDASH + rec.lost + '</span>' +
          '</div>' +
          g.rows.map(ledgerRowHtml).join('');
      }).join('') + '</div>';
      // "See all N results" (the reference's footer). The ledger draws the last 18 of the recent-form
      // window; the button reveals the rest of that window, and is offered only when there is more to show
      // (an affordance promises content). N = every form row in the window under the current filters.
      if (ordered.length > LEDGER_CAP) {
        foot = '<div style="display:flex;justify-content:center;padding-top:16px;">' +
          '<span data-pp2="ledger-more" style="display:flex;align-items:center;gap:9px;font-size:13px;' +
            'font-weight:700;color:' + (state.ledgerExpanded ? 'var(--text)' : 'var(--link)') + ';' +
            'padding:10px 18px;border:1px solid var(--line);border-radius:11px;cursor:pointer;">' +
            (state.ledgerExpanded ? 'Show the last ' + LEDGER_CAP : 'See all ' + ordered.length + ' results') +
          '</span></div>';
      }
    }

    return '' +
      // A top-level card: --card + --top-light, no outline (the 1px transparent edge keeps the box size).
      '<div class="pp2-ledger" style="background:var(--card);box-shadow:var(--top-light);' +
        'border:1px solid transparent;border-radius:12px;padding:22px 24px;display:flex;flex-direction:column;">' +
        head +
        '<div class="pp2-ledger-filters" style="display:flex;flex-wrap:wrap;margin-bottom:16px;' +
          LEDGER_FILTER_TRACK + '">' + chips + '</div>' +
        (rows.length ? '<div style="display:flex;gap:4px;margin-bottom:8px;">' + strip + '</div>' : '') +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;' +
          'flex-wrap:wrap;margin-bottom:20px;">' +
          '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
            'text-transform:uppercase;color:var(--text-label);">oldest ' + RARROW + ' most recent</span>' + legend +
        '</div>' +
        // the column heads head rows; an empty filter result shows the message alone
        (rows.length ? heads : '') + body + foot +
      '</div>';
  }

  // The export's group-header labels are `.cap` with two overrides (8.5px,
  // var(--text-label)) — the tracking stays 0.16em, where this had drifted to 0.1em.
  function ledgerEyebrow(text, align) {
    return '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);text-align:' + align + ';">' +
      esc(text) + '</div>';
  }

  // "a - b" (the feed's sets count) -> "a–b"; null when the row holds none.
  function setsCountText(m) {
    var res = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String((m && m.result) || ''));
    return res ? res[1] + ENDASH + res[2] : null;
  }

  // fx4 item 4 · while the open player's shard loads, an unpriced H / A cell is blank, not a "no price" dash.
  // fx5 item 1 · and a PRICED cell is blank too: the bet365 capture price the row holds before the shard lands
  // is not the final join (the shard's close replaces it), so printing it then changing it is a claim
  // withdrawn. Every H / A cell keeps its width with a non-breaking space and paints once, from the final join.
  function ledgerOdds(v) {
    if (state.key != null && shardPending({ key: state.key })) return '&nbsp;';
    return oddsText(v);
  }
  function ledgerRowHtml(x) {
    var m = x.m;
    var id = m.date + '|' + (m.opponent || '');
    var w = !!m.won;
    var open = state.sheet === id;
    var sets = matchStatus(m) === 'wo' ? null : setsCountText(m);
    // The reference row names the OPPONENT only (surname-first, 12.5/600, white) — the subject is the page.
    // The result is carried by the W/L square, the sets colour and the score, never by the typography.
    return '<div class="pp2-ledger-row" ' + sheetHook(id) +
      'style="' + LEDGER_GRID + 'padding:7px 8px;border-top:1px solid var(--line);border-radius:6px;' +
      (open ? 'background:' + LEDGER_OPEN_TONE + ';' : '') + sheetCursor() + '">' +
      '<span style="' + MONO + 'font-size:11.5px;color:var(--text-label);">' + esc(fmtDotDate(m.date)) + '</span>' +
      '<span class="pp2-wl" style="width:8px;height:8px;border-radius:2px;background:' +
        (w ? 'var(--pos)' : 'var(--neg)') + ';"></span>' +
      '<span style="font-size:12.5px;font-weight:600;color:var(--text);min-width:0;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap;">' + esc(m.opponent ? surnameFirst(m.opponent) : DASH) + '</span>' +
      // Item 9: nowrap as well as the short code — a wrapped row is the defect.
      '<span style="' + MONO + 'font-size:11px;color:var(--text-label);white-space:nowrap;">' +
        esc(roundLabel(m)) + '</span>' +
      '<span style="' + MONO + 'font-size:12px;font-weight:700;white-space:nowrap;color:' +
        (sets ? (w ? 'var(--pos)' : 'var(--neg)') : DASH_COLOUR) + ';">' + (sets || DASH) + '</span>' +
      // Set scores two-space separated as the reference prints them (white-space:pre keeps the pair).
      '<span class="pp2-score" style="' + MONO + 'font-size:11.5px;color:var(--text-label);min-width:0;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:pre;">' + esc(scoreWithStatus(m, setScoreText(m, '  '))) + '</span>' +
      '<span style="' + MONO + 'font-size:11.5px;font-weight:700;text-align:right;color:' +
        (x.price == null ? DASH_COLOUR : 'var(--text)') + ';">' + ledgerOdds(x.price) + '</span>' +
      '<span style="' + MONO + 'font-size:11.5px;font-weight:400;text-align:right;color:var(--text-label);">' +
        ledgerOdds(x.oppPrice) + '</span>' +
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
   * DISPLAY ONLY. (The Streaks run counting that applied the TEN-313 walkover
   * ruling was removed with the Streaks tab — founder ruling Q1, TEN-384.)
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
    if (s.pTb == null || s.oTb == null) {
      // Archive (TML) rows carry the breaker as the source prints it: a single
      // parenthesised number, the points taken by the side that LOST it. That is
      // exactly what this function renders from the api-tennis pair below, so it
      // is used verbatim — never expanded into two per-side totals the source
      // never recorded.
      if (s.tbLo == null) return base;
      var lt = Number(s.tbLo);
      return isFinite(lt) ? base + '(' + lt + ')' : base;
    }
    var lo = Math.min(Number(s.pTb), Number(s.oTb));
    if (!isFinite(lo)) return base;
    return base + '(' + lo + ')';
  }
  /** Tiebreak sets on a row that carry no points — reported, never guessed. */
  function tiebreaksMissing(m) {
    return (m.sets || []).filter(function (s) {
      var tb = (s.p === 7 && s.o === 6) || (s.p === 6 && s.o === 7);
      // Two encodings carry breaker points now: the api-tennis pair (pTb/oTb)
      // and the archive's single parenthesised `tbLo`. A row holding either one
      // is NOT missing its tiebreak, so this must check both or it reports every
      // archive tiebreak as a hole.
      return tb && (s.pTb == null || s.oTb == null) && s.tbLo == null;
    }).length;
  }

  // §5 Eight stat boxes — box set RE-LOCKED 2026-09-17 (handoff v7, A1).
  //
  // Order, titles and per-box headline `size` are `Player Stat Boxes.dc.html`
  // :3222-3229 verbatim. Against the previous set: `season` and `tourn` swap
  // (2 <-> 3), `splits` and `styles` swap (5 <-> 6), and three boxes are renamed
  // -- Splits -> Draw record, Versus playing styles -> Matchup record, Playing
  // profile -> Live trading. Court speed gains the word "record".
  //
  // The eight ICON PATHS are byte-identical to the previous set; what changes is
  // which icon sits at which POSITION, because the boxes moved. Keying the icon
  // to `key` rather than to the slot is what makes that a no-op here.
  var BOXES = [
    { key: 'career', title: 'Career record', size: 26,
      icon: 'M6 4h8v3a4 4 0 01-8 0V4ZM10 11v3M7.5 16.5h5' },
    { key: 'season', title: 'Calendar record', size: 26,
      icon: 'M4 3h12v14H4zM4 7h12M8 3v14' },
    { key: 'tourn', title: 'Record per tournament', size: 30,
      icon: 'M4 5h12v4a6 6 0 01-12 0V5ZM10 15v2M7 18h6' },
    { key: 'speed', title: 'Court speed record', size: 22,
      icon: 'M3 14c3-6 11-6 14 0M10 4v3M6 6l2 2M14 6l-2 2' },
    { key: 'splits', title: 'Draw record', size: 20,
      icon: 'M4 15V9M8 15V5M12 15v-4M16 15V7' },
    { key: 'styles', title: 'Matchup record', size: 30,
      icon: 'M10 3v14M4 7l6-4 6 4v6l-6 4-6-4Z' },
    { key: 'market', title: 'Market edge', size: 26,
      icon: 'M3 13l4-5 3 3 4-6 3 4M3 17h14' },
    { key: 'profile', title: 'Live trading', size: 30,
      icon: 'M4 15V9M8 15V5M12 15v-4M16 15V7' }
  ];

  // TEN-384 (founder, step 4 item 5) supersedes A2's per-box `size`: "mono figure 26px (20px over 10
  // characters, 19px over 16)". The reference's own render applies the same length rule, so the figure size
  // now follows the FIGURE — the whole headline as printed, unit suffix included — at three fixed steps.
  // The per-box `size` field is no longer read.
  function headlineSize(text) {
    var n = String(text == null ? '' : text).length;
    return n > 16 ? 19 : n > 10 ? 20 : 26;
  }

  // TEN-384: the clickable tile (--card + --edge-7, hover --tile-hover + --edge-16 in PP2_STYLE), radius 12,
  // min-height 132, padding 16 16 14. Order: the title row (caps title left, 16px --text-label icon right),
  // the figure (mono 700, white — every tile, the unit included), and the 11.5px support line pinned to
  // the bottom. Founder Q4: the clickable tile — --edge-7 at rest, hover --tile-hover + --edge-16 (PP2_STYLE),
  // selected (its modal open) --edge-24.
  var TILE_EDGE = 'var(--edge-7)';
  var TILE_EDGE_SELECTED = 'var(--edge-24)';
  function renderBoxes(ctx) {
    var vals = ctx.boxVals;
    var cards = BOXES.map(function (b) {
      var v = vals[b.key] || {};
      // TEN-384 fx2 item 3 · a PENDING tile (its store still loading) claims nothing: the figure and the
      // support line keep their exact boxes (a non-breaking space at the same size / line-height, so
      // nothing shifts when the figure paints) and carry no dash and no sentence.
      var pend = !!v.pending;
      // TEN-384 fx6 item 8 (founder r2): a tile whose figure does not exist for this player (Draw record with
      // no career-splits entry) leaves the figure SLOT empty — the same non-breaking space a pending figure
      // keeps, so the tile height holds — and keeps its support line. Not a dash.
      var blankFig = pend || !!v.blankFigure;
      var head = blankFig ? '' : v.headline == null ? DASH : String(v.headline);
      var suffix = v.hlSuffix == null ? '' : String(v.hlSuffix);
      var sz = headlineSize(head + suffix);
      return '' +
        '<div class="pp2-box" data-pp2="box" data-box="' + b.key + '" ' +
        'style="position:relative;background:var(--card);border:1px solid ' +
          (state.modal === b.key ? TILE_EDGE_SELECTED : TILE_EDGE) + ';' +
        'border-radius:12px;padding:16px 16px 14px;display:flex;flex-direction:column;gap:8px;' +
        'min-height:132px;box-sizing:border-box;cursor:pointer;transition:border-color .14s,background .14s;">' +
        // the reference's title row is 21px (the icon sits in a text line box at its top); the title centres in it
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;height:21px;">' +
          '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
            'text-transform:uppercase;color:var(--text-label);min-width:0;white-space:nowrap;">' +
            esc(b.title) + '</span>' +
          '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
            'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
            'style="flex:none;align-self:flex-start;color:var(--text-label);">' +
            '<path d="' + b.icon + '"/></svg>' +
        '</div>' +
        '<div' + (pend ? ' data-pp2-pending="figure"' : '') + ' style="font-family:\'IBM Plex Mono\',monospace;font-weight:700;color:' +
          (v.headline == null ? DASH_COLOUR : 'var(--text)') + ';line-height:1;white-space:nowrap;' +
          'font-size:' + sz + 'px;">' + (blankFig ? '&nbsp;' : esc(head) + esc(suffix)) + '</div>' +
        '<div' + (pend || v.supportPending ? ' data-pp2-pending="support"' : '') + ' style="font-size:11.5px;color:var(--text-label);line-height:1.4;margin-top:auto;">' +
          (pend || v.supportPending ? '&nbsp;' : esc(v.support == null ? DASH : v.support)) + '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<div>' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:13px;">' +
          '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
            'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">Explore the profile</div>' +
          '<div style="font-size:12px;color:var(--text-label);">Click a box for the full breakdown</div>' +
        '</div>' +
        '<div class="pp2-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">' +
          cards + '</div>' +
      '</div>';
  }

  // §6 Key insights — the SPEC RULE, computed here (R2, founder 2026-09-17).
  //
  // What this replaced: `p.insights`, prose written by the pipeline
  // ("Return is a standout strength", "Clay is the strongest surface"). That
  // array carries an adjective and a tour-average comparison; it does not carry
  // the record or the signed gap the rule requires, and its candidate set is not
  // the ruled one (it ranged over Level and Round too). It is no longer read here.
  //
  // Per card: the split, its rate, its record, the comparison and the signed gap.
  // No adjectives. An insight may be negative — a red card is a real finding, not
  // a formatting accident. Fewer than three eligible -> fewer cards, never padded.
  //
  // RULING Q1 (founder, 2026-09-18) · "Apply the same rule to Key insights'
  // positive card so box and insights never disagree; negative findings stay
  // allowed in the insights as a separate card, worded plainly."
  //
  // Implemented as: the leading card IS the Draw record box's pick, the same
  // object bestSplit() hands the tile — not a re-selection that happens to agree
  // today. The remaining slots keep R2's |gap| ranking over the WIDER insight
  // vocabulary (surface included), so a negative finding still earns a card and
  // still reads as one: a red arrow, a signed pp, no adjective.
  //
  // RULING Q2 round 2 (2026-09-18) closes the contradiction round 1 reported.
  // Round 1's shape was: box picks from BOX_SPLIT_GROUPS, insights rank over a
  // WIDER vocabulary, so a positive SURFACE split could sit as a green card under
  // a dashed tile. The founder's answer:
  //
  //   "Restrict Key insights' positive card to the box's groups. Key insights may
  //    still carry a NEGATIVE surface finding, but the positive card must be
  //    selectable by the box, so the two can never contradict."
  //
  // Implemented as a sign-conditional filter, not a narrower vocabulary: every
  // card with a POSITIVE gap must come from a group the box could have picked
  // from; negative cards keep the full vocabulary, surface included. The lead is
  // still bestSplit()'s own object, so the tile and the lead card are the same
  // pick by construction rather than by agreement — and §12 now asserts exactly
  // that over the whole roster.
  //
  // The two populations carry two pooled baselines (draw splits vs all splits),
  // so each card NAMES the population its percentage was pooled over. An
  // unlabelled baseline that differs between two cards on one screen reads as a
  // bug; a labelled one reads as what it is, two scopes.
  // ── ITEM 5 (founder, 2026-09-19) · insight cards take a SENTENCE title ────
  //
  // "The design's cards are titled as sentences — 'Handles left-handers well'.
  //  Ours prints a label and a number."
  //
  // THE SPEC CONFLICTS WITH ITSELF INSIDE ONE SECTION, and that is what decides
  // the shape. README §6 gives three placeholder titles from the locked build —
  // "Strongly surface-dependent", "Undervalued by the market as a favourite",
  // "Standout solid baseliner profile" — every one of them an adjectival
  // sentence; then its production rule ends "state the split rate, its record,
  // the comparison and the signed gap. No adjectives." Read as a rule about
  // titles it contradicts all three of its own examples in the same paragraph.
  // Read as the last clause of the sentence enumerating what the BODY must
  // state, it is consistent: the body is evidence and carries no adjectives,
  // the title names the finding in plain language. That is the reading here,
  // and it is also what satisfies the founder's item 5.
  //
  // The titles are a FIXED TABLE, one row per member of the split vocabulary,
  // not a sentence assembled at render time. Two reasons. A generated title has
  // to choose a magnitude word from the gap, and any such word is a claim the
  // data does not make ("dominant" at what pp?). And the vocabulary is closed —
  // fourteen members, all of them here — so a table is complete, reviewable and
  // cannot surprise. The lefties row is the design's own string verbatim.
  //
  // An id outside the table falls back to the old label/rate shape rather than
  // to a guessed sentence: if the split vocabulary ever grows, the card reads
  // plainly and visibly un-narrated instead of silently mis-describing a split.
  var INSIGHT_TITLES = {
    'surface:Hard':          ['Strong on hard courts',            'Loses ground on hard courts'],
    'surface:Clay':          ['Strong on clay',                   'Loses ground on clay'],
    'surface:Grass':         ['Strong on grass',                  'Loses ground on grass'],
    'level:Grand Slams':     ['Rises at the Slams',               'Falls away at the Slams'],
    'level:Masters':         ['Rises at Masters level',           'Falls away at Masters level'],
    'level:Other Tours':     ['Strongest outside the big events', 'Weaker outside the big events'],
    'format:Best of 5':      ['Better over five sets',            'Weaker over five sets'],
    'format:Best of 3':      ['Better over three sets',           'Weaker over three sets'],
    'round:Finals':          ['Finishes finals off',              'Falls short in finals'],
    'round:Semi-finals':     ['Reliable in semi-finals',          'Stalls in semi-finals'],
    'round:Quarter-finals':  ['Reliable in quarter-finals',       'Stalls in quarter-finals'],
    'opponent:vs. Righties': ['Handles right-handers well',       'Struggles against right-handers'],
    'opponent:vs. Lefties':  ['Handles left-handers well',        'Struggles against left-handers'],
    'opponent:vs. Top 10':   ['Holds up against the top 10',      'Struggles against the top 10']
  };
  // The body is prose, so the split needs a prepositional phrase rather than the
  // bare chip label ("Clay" -> "on clay"). Same closed vocabulary, same keys.
  var INSIGHT_PHRASES = {
    'surface:Hard': 'on hard courts', 'surface:Clay': 'on clay', 'surface:Grass': 'on grass',
    'level:Grand Slams': 'at the Slams', 'level:Masters': 'at Masters events',
    'level:Other Tours': 'at the other tours',
    'format:Best of 5': 'over five sets', 'format:Best of 3': 'over three sets',
    'round:Finals': 'in finals', 'round:Semi-finals': 'in semi-finals',
    'round:Quarter-finals': 'in quarter-finals',
    'opponent:vs. Righties': 'against right-handers', 'opponent:vs. Lefties': 'against left-handers',
    'opponent:vs. Top 10': 'against the top 10'
  };

  // Q3 parked: the insight icon tile's fill, written once.
  var INSIGHT_ICON_TONE = 'var(--selected)';
  // TEN-384 fx2 item 6 · the empty state states the RIGHT reason, the same three facts the Draw record
  // tile separates (buildBoxVals): no split store for him at all -> "no split data on record" (absent
  // data is not a sample-size finding; Thompson read "No splits clear the ten-match minimum" with no
  // career-splits entry); splits held but none reaches n >= 10 -> the ten-match minimum; splits clear
  // the floor but none stands apart from his rate -> that, never the sample-size reason.
  // TEN-384 fx3 (founder ruling on item 7, 2026-10-07): step 4 ships WITH the career-splits rank cap, so a
  // profiled player outside it has NO splits entry. That is a build gap, not a sample: Draw record and Key
  // insights say "Splits not built for this player yet". The ten-match wording stays for a player whose
  // splits exist and none clears 10. A store that has not loaded (empty) claims nothing about the player.
  var SPLITS_NOT_BUILT = 'Splits not built for this player yet';
  // TEN-391 (founder, 2026-10-07): career splits are ONE FILE PER PLAYER, fetched when his profile opens
  // (bsp-consult-dashboard.html loadCareerSplitsFor). The host writes window.careerSplits[key] = his
  // object, or NULL when the server answered that no file exists — the only state that is "not built".
  // While his file is in flight (window.careerSplitsPending[key]), or the host has no answer for him yet
  // (a failed fetch settles nothing), every reader of it is PENDING and claims nothing. No pending map
  // (the Node harnesses) = settled, as before.
  function splitsNotBuilt(key) {
    var store = window.careerSplits;
    return !!store && Object.prototype.hasOwnProperty.call(store, String(key)) && store[String(key)] === null;
  }
  function splitsPending(key) {
    var m = window.careerSplitsPending, store = window.careerSplits || {};
    if (!m) return false;
    return !!m[String(key)] || !Object.prototype.hasOwnProperty.call(store, String(key));
  }
  // The pending copy of an empty-state sentence: the same box, a non-breaking space for the words.
  var SPLITS_PEND_HTML = '<span data-pp2-pending="splits">&nbsp;</span>';
  function insightsEmptyText(p) {
    if (splitsPending(p.key)) return SPLITS_PEND_HTML;
    // fx7 item 3 · the same words as the Draw tile and modal, no trailing period in any of the three.
    if (splitsNotBuilt(p.key)) return SPLITS_NOT_BUILT;
    if (pooledBaseline(p.key, 'career') == null) return 'No split data on record.';
    if (!rankedInsights(p, 'career', null, INSIGHT_GROUPS).length) return 'No splits clear the ten-match minimum.';
    return 'No split stands apart from his rate ' + baselinePopLabel() + '.';
  }
  function renderInsights(p) {
    var lead = bestSplit(p);
    var rest = rankedInsights(p, 'career', null, INSIGHT_GROUPS).filter(function (c) {
      if (lead && c.id === lead.pick.id) return false;
      // An EXACTLY zero gap is not a finding, and it must not be dressed as one.
      // The card's arrow keys off `gap >= 0`, so a zero painted GREEN — while the
      // box, which requires `gap > 0`, dashed. Measured on the real roster: 27
      // zero-gap candidates, and for 8 players that put a green card directly
      // under a dashed tile. Exactly the contradiction Q2 forbids, reachable with
      // today's data rather than a constructed one.
      //
      // It is common by construction, not a fluke: when a player has only Best of
      // 3 matches, the format partition IS that row, so its gap is exactly 0.
      //
      // Dropping it also honours "fewer than three eligible -> fewer cards, never
      // padded" — a split sitting exactly at his own rate is padding.
      if (c.gap === 0) return false;
      if (c.gap > 0 && BOX_SPLIT_GROUPS.indexOf(String(c.id).split(':')[0]) < 0) return false;
      return true;
    });
    var list = (lead ? [lead.pick] : []).concat(rest).slice(0, 3);
    if (!list.length) {
      return '<div><div style="font-size:22px;font-weight:800;letter-spacing:-0.015em;' +
        'margin-bottom:16px;">Key insights</div>' +
        '<div style="background:var(--card);box-shadow:var(--top-light);border-radius:12px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">' + insightsEmptyText(p) + '</div></div>';
    }
    var cards = list.map(function (ins) {
      // `> 0`, not `>= 0`. A zero gap is filtered out above; this is the second
      // lock, so that if a zero ever reaches here it cannot paint as a strength.
      var up = ins.gap > 0;
      var pair = INSIGHT_TITLES[ins.id];
      var title = pair ? pair[up ? 0 : 1] : ins.label + ' ' + MIDDOT + ' ' + rateText(ins.won, ins.lost);
      var phrase = INSIGHT_PHRASES[ins.id] || ins.label;
      // The 2026-09-18 Q3 ruling (blue / red icon fills) is superseded by TEN-384:
      // TEN-384 (step 4 item 9): the icon tile is the 36px insight tone with a WHITE icon — no green / red
      // fill. The arrow's direction still states the sign; the figures in the copy are plain text.
      // Up-and-right for a positive gap, down-and-right for a negative one, so the
      // glyph states the same fact the number does rather than contradicting it.
      var path = up ? 'M4 13l4-4 3 3 5-6M13 6h3v3' : 'M4 7l4 4 3-3 5 6M13 14h3v-3';
      return '' +
        // `data-insight`, deliberately OUTSIDE the data-pp2 vocabulary. data-pp2 is
        // this page's CLICK vocabulary and every hook in it must have a handler in
        // the mount — the affordance-promises-content rule. The export's §7
        // interaction table has no row for an insight card and the prototype's card
        // carries no onClick (unlike the tournament-detail close beside it), so the
        // card is inert by design; carrying it in the click vocabulary painted a
        // dead target, which is what the hook-coverage check caught.
        //
        // Do not name the click attribute literally in this comment: the coverage
        // check scans this file as SOURCE with a regex, so a mention in a comment
        // reads as a painted hook and fails the check on markup that is correct.
        '<div data-insight="' + esc(ins.id) + '" ' +
        // A top-level card: --card + --top-light, no outline.
        'style="height:100%;box-sizing:border-box;background:var(--card);box-shadow:var(--top-light);' +
        'border:1px solid transparent;' +
        'border-radius:12px;padding:24px 24px 26px;display:flex;flex-direction:column;gap:16px;">' +
          '<div style="width:36px;height:36px;border-radius:13px;display:flex;align-items:center;' +
            'justify-content:center;background:' + INSIGHT_ICON_TONE + ';color:var(--text);">' +
            // stroke on the PATH at 1.7, as the file writes it (:163), not on the
            // svg at 1.6 — a hairline difference is still a difference.
            '<svg width="16" height="16" viewBox="0 0 20 20" fill="none">' +
            '<path d="' + path + '" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
          '<div style="font-size:18.5px;font-weight:800;letter-spacing:-0.01em;line-height:1.25;color:var(--text);">' +
            esc(title) + '</div>' +
          '<div style="font-size:13.5px;color:var(--text-label);line-height:1.7;">' +
            // Everything README §6 requires of a body, in order and with no
            // adjective: the split RATE (one decimal, via rateText — the export's
            // own insight bodies read "58.3%", "23.8%"), its RECORD, the
            // COMPARISON, and the SIGNED GAP.
            //
            // "over N matches" is gone from the body, not lost: the record IS n
            // (95-14 is 109 matches), and the sentence read as two claims where
            // there is one. Same reasoning that shortened the tiles in item 3.
            'Wins ' + rateText(ins.won, ins.lost) + ' ' + esc(phrase) +
            ' (' + esc(recordText(ins.won, ins.lost)) + ') against ' +
            ins.baseline.toFixed(1) + '% ' + esc(ins.pop) + ' ' + EMDASH + ' ' +
            signed(ins.gap, 1, 'pp') + '.' +
          '</div>' +
        '</div>';
    }).join('');
    return '<div><div style="font-size:22px;font-weight:800;letter-spacing:-0.015em;' +
      'margin-bottom:16px;">Key insights</div>' +
      // minmax(0,1fr) rather than 1fr: with two cards the third column stays empty,
      // which is the honest shape of "fewer eligible" — stretching two across the
      // full width would read as three insights with one missing.
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:stretch;">' +
      cards + '</div></div>';
  }

  // ─── box headline/support values ───────────────────────────────────────────
  // Every value below is recomputed from the profile. A figure the data cannot
  // support is null -> the box renders a dash, never a placeholder.
  // ─── the three selectors the v7 re-lock needs ──────────────────────────────

  /**
   * Titles won in the CURRENT season, for box 2's support line.
   *
   * A title is an edition whose final was played and won. `tournViews` already
   * carries a per-tournament `titles` count, but that is a CAREER total and the
   * box asks for one season, so the editions are walked instead: an edition in
   * this year holding a won match whose round label is the final.
   *
   * Returns null (-> a dash, never a 0) when the tournament store has not
   * settled for this player -- "no titles" and "not loaded" are different facts
   * and 0 must not be allowed to stand for the second.
   */
  function titlesThisSeason(p) {
    var views = tournViews(p);
    if (!views || !views.length) return null;
    var y = currentYear(), n = 0;
    views.forEach(function (t) {
      (t.editions || []).forEach(function (e) {
        if (String(e.year) !== y) return;
        var won = (e.matches || []).some(function (m) {
          return m && m.won && isFinalRound(m.round);
        });
        if (won) n += 1;
      });
    });
    return n;
  }
  /** The final, by the round LABEL this page already normalises to (§8.17). */
  function isFinalRound(round) {
    return /^\s*(F|Final)\s*$/i.test(String(round == null ? '' : round));
  }

  /**
   * Box 3's "best event" -- RULING Q2 (founder, 2026-09-18).
   *
   * NO DEFINITION EXISTED IN THE EXPORT (§6 item 4); the prototype hardcodes
   * "Cincinnati". Phase A shipped an invented rule (highest win rate at n >= 10)
   * and reported it. The ruling replaces it:
   *
   *   candidates : PRICED events only -- n >= 10 matches carrying a Pinnacle
   *                CLOSING price. The unpriced record is not a candidate at all.
   *   selection  : best backing units (pinPl). Ties -> the larger priced n.
   *   none       : dash, "no event with 10+ priced matches".
   *
   * The headline is a units figure, so its population must BE the priced one --
   * the old rule could pick an event on a 15-match record and then headline a
   * P&L struck over three of them, or over none at all (Zverev's Olympic Games:
   * 9-1, "Pinnacle priced none of these", headline dashed). Ranking on the same
   * figure the headline prints removes that whole class.
   *
   * `pinN` is carried into the support line for the same reason: §3's "every
   * rate shows its record and n" applies to the units too, and the event's
   * overall record (which the modal row prints) is a WIDER population than the
   * units. Stating both is the only way the tile cannot be misread.
   */
  // TEN-384 fx3 (D10): the overall Backing over every priced event — the tile's fallback when no single
  // event clears ten priced matches. Null when nothing is priced (or the per-event join has not landed).
  // TEN-384 fx4 item 5 · the one switch for the tile's overall fallback (see buildBoxVals): false = W–L over
  // every event (pending the founder's Backing-source answer); true = the fx3 summed Backing units.
  var TOURN_TILE_SUMMED_UNITS = false;
  /** His W–L over every event Record per tournament lists (walkovers out), the same rows the modal sums. */
  function tournRecordAll(p) {
    var won = 0, lost = 0;
    (tournViews(p) || []).forEach(function (t) { won += t.won || 0; lost += t.lost || 0; });
    return { won: won, lost: lost };
  }
  /**
   * fx5 item 2 · true while the player's tournament-history shard is IN FLIGHT. The host marks it on
   * window.tourHistPending[key] (bsp-consult-dashboard.html loadPp2TourHist) and clears the mark when the
   * fetch settles, answered or not; the rows themselves land on p.tournamentHistory. An empty list read
   * while the mark is up is "not loaded", not "no tournaments": nothing reading the shard may claim the
   * empty state then. No mark (the Node harnesses, a settled fetch) = settled.
   */
  function tournHistPending(p) {
    if (!p || Array.isArray(p.tournamentHistory)) return false;
    var m = window.tourHistPending;
    return !!(m && m[String(p.key)]);
  }
  /** fx4 item 4 · true while the page's per-event Backing join has not answered for some listed event.
   *  fx5 item 2 · or while the shard that LISTS the events is still loading: some() over an empty list is
   *  false, which painted "no matches on record" before the rows arrived. */
  function tournBackingPending(p) {
    if (tournHistPending(p)) return true;
    if (typeof window.trProfileBacking !== 'function') return false;   // no join on this page (harnesses)
    return (tournViews(p) || []).some(function (t) { return t.backingPending; });
  }
  function tournOverall(p) {
    var pl = 0, pinN = 0, won = 0, lost = 0;
    (tournViews(p) || []).forEach(function (t) {
      won += t.won || 0; lost += t.lost || 0;
      if (t.pinN && t.pinPl != null) { pl += t.pinPl; pinN += t.pinN; }
    });
    return pinN ? { pl: Math.round(pl * 10) / 10, pinN: pinN, won: won, lost: lost } : null;
  }

  function bestEvent(p) {
    var views = tournViews(p);
    var best = null;
    (views || []).forEach(function (t) {
      if (!t.pinN || t.pinN < 10) return;       // priced gate, not the record gate
      if (t.pinPl == null) return;
      if (!best || t.pinPl > best.pinPl || (t.pinPl === best.pinPl && t.pinN > best.pinN)) {
        best = { display: t.display, won: t.won, lost: t.lost, n: t.n,
                 rate: t.n ? t.won / t.n : null, pinPl: t.pinPl, pinN: t.pinN };
      }
    });
    return best;
  }

  /**
   * Box 6's "best archetype": the first row of the modal's own list.
   *
   * styleRows() already sorts rate-descending with under-minimum rows pushed to
   * the bottom, so taking the head and re-checking the minimum yields exactly
   * the row the modal opens on -- the tile cannot name an archetype the list
   * below it ranks second.
   */
  function bestMatchup(p) {
    // TEN-384 fix item 8 (founder 2026-10-05): a tile HEADLINE comes only from a row of n >= 10
    // ("Matchup 6–0" was a 6-match row at the top of a rate-sorted list). The list keeps its own
    // n >= 5 minimum; the tile walks down it to the first row that clears ten (the next best).
    var rows = styleRows(p) || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], rn = r.won + r.lost;
      if (gateFor(rn) === GATE.FULL) return { label: r.axis.label, won: r.won, lost: r.lost, n: rn };
    }
    return null;
  }

  /**
   * Box 8's "from a set down": matches he lost the opening set and the record
   * he took from there.
   *
   * `recentForm` is the only store on this page holding ordered per-set scores.
   * The career spine's `sets` is a COUNT ("2 - 1") with no order in it, so it
   * cannot distinguish losing the first set from losing the third, and is not
   * consulted here. `scanned` is reported beside `n` so the tile states the
   * window it actually saw rather than implying the career.
   *
   * A walkover given is neither a win nor a loss (the same counts() ruling the
   * ribbon applies), and a match with no first set is not a match played from a
   * set down.
   */
  /**
   * The tour's own from-a-set-down rate — founder ruling 2026-09-19 item 6:
   * "follow the export: the tour gap, not the sample count."
   *
   * Pooled over the same population, and by the same method, as the Situational
   * panel's tour column (sitTour): every profile in the published roster that
   * carries ordered set scores, summed match by match at render time. NOT a
   * constant — the export's "6.4pp below tour" is mock copy and §3 bars both
   * reproducing it and inventing a replacement.
   *
   * Under founder ruling TOUR AVERAGE (2026-09-19): this is the average of the
   * N players we hold set scores for, not the ATP field, and N moves as the
   * store grows. The box's support line has no room for that caveat, so the
   * modal's footnote carries it — which is exactly what that ruling asks for.
   *
   * A pool under ten contributing players returns null and the caller falls back
   * to stating its own sample instead: a "tour gap" struck over four players is
   * a worse claim than no tour gap at all.
   */
  var _tourSetDown = null;
  function tourFromASetDown() {
    if (_tourSetDown !== null) return _tourSetDown;
    var map = playersMap();
    var won = 0, lost = 0, players = 0;
    Object.keys(map).forEach(function (k) {
      var r = fromASetDown(map[k]);
      if (!r || !r.n) return;
      players++; won += r.won; lost += r.lost;
    });
    var n = won + lost;
    _tourSetDown = (players >= 10 && n > 0)
      ? { pct: (100 * won / n), players: players, n: n }
      : { pct: null, players: players, n: n };
    return _tourSetDown;
  }

  function fromASetDown(p) {
    var rows = ledgerMatches(p);
    var scanned = 0, won = 0, lost = 0;
    rows.forEach(function (m) {
      var sets = m && m.sets;
      if (!sets || !sets.length) return;
      var s0 = sets[0];
      if (!s0 || s0.p == null || s0.o == null) return;
      scanned += 1;
      if (!counts(m)) return;
      if (Number(s0.p) >= Number(s0.o)) return;   // won or tied the opening set
      if (m.won) won += 1; else lost += 1;
    });
    var n = won + lost;
    return { won: won, lost: lost, n: n, scanned: scanned, gate: gateFor(n) };
  }

  // TEN-384 fx3 (D10) · the Live trading tile's OVERALL figure: his record over every counted match with an
  // ordered opening set (the same rows fromASetDown scans).
  function setScoredRecord(p) {
    var won = 0, lost = 0;
    ledgerMatches(p).forEach(function (m) {
      var s0 = m && m.sets && m.sets[0];
      if (!s0 || s0.p == null || s0.o == null || !counts(m)) return;
      if (m.won) won += 1; else lost += 1;
    });
    return { won: won, lost: lost, n: won + lost };
  }

  // TEN-384 fix item 8 · the Live trading tile's fallback when "from a set down" is under ten
  // matches. Candidates are the Situational table's own rows (same counts, same tour column the
  // modal prints), n >= 10 and a tour figure held; the largest gap to tour wins, ties to the larger
  // n. Null when no row qualifies, and the tile then says so rather than headlining a thin sample.
  function liveTileFallback(p) {
    var set = sitSetCounts(p), pbp = sitPbpFor(p), tour = sitTour(), best = null;
    SIT_GROUPS.forEach(function (g) {
      g[1].forEach(function (r) {
        var rec = r[2] === 'set' ? set.rows[r[0]] : (pbp ? pbp.rows[r[0]] : null);
        var t = tour.rows[r[0]];
        if (!rec || t == null) return;
        var n = rec.w + rec.l;
        if (gateFor(n) !== GATE.FULL) return;
        var gap = 100 * rec.w / n - t;
        if (!best || gap > best.gap || (gap === best.gap && n > best.n)) {
          best = { id: r[0], label: r[1].charAt(0).toLowerCase() + r[1].slice(1), w: rec.w, l: rec.l, n: n, gap: gap };
        }
      });
    });
    return best;
  }

  function buildBoxVals(p, ctx) {
    var v = {};

    // 1 · Career record — the careerByYear spine (founder ruling B). Summed from
    // the season rows, so it equals the Career modal total and the sum of its
    // surface rows identically, not approximately (§4).
    var ct = spineTotal(p);
    var fy = spineFirstYear(p);
    // v7 support string (`Player Stat Boxes.dc.html`:3222): "<rate> all-time ·
    // by surface and by season". Note "<rate> all-time" is ONE clause with no
    // separator -- the middot falls between it and the by-what phrase. The
    // "since <year>" tail of the previous line is gone; the file's second clause
    // names the modal's two axes instead.
    v.career = ct.n
      ? { headline: recordText(ct.won, ct.lost),
          support: rateText(ct.won, ct.lost) + ' all-time ' + MIDDOT +
            ' by surface and by season' }
      : { headline: null, support: 'no matches on record' };

    // 2 · Calendar record — current season. v7 moves this to slot 2 and rewrites
    // the support: "<year> season · all surfaces · N titles". The win rate is
    // dropped (it was the third printing of the same number on one screen) and a
    // TITLES count takes its place.
    var sr = (p.careerByYear || []).filter(function (y) {
      return String(y.year) === currentYear();
    })[0];
    var sw = sr && sr.total ? sr.total.won : 0, sl = sr && sr.total ? sr.total.lost : 0;
    var ti = titlesThisSeason(p);
    // fx5 item 2 · the titles count reads the tournament-history shard: while it loads the support line
    // keeps its box blank (supportPending) rather than print "— titles" and then a number.
    v.season = (sw + sl)
      ? { headline: recordText(sw, sl),
          supportPending: ti == null && tournHistPending(p),
          support: currentYear() + ' season ' + MIDDOT + ' all surfaces ' + MIDDOT + ' ' +
            (ti == null ? DASH + ' titles' : ti + (ti === 1 ? ' title' : ' titles')) }
      : { headline: null, support: 'no matches this season' };

    // 3 · Record per tournament — v7 moves this to slot 3 and replaces the
    // headline. It used to count events ("14 / tournaments on record"), which is
    // an inventory, not a result. The locked tile now reads the BACKING figure
    // for his best event, qualified by that event's own record:
    //   +4.2u  /  Record per tournament  /  Cincinnati · best event · 14–4 · 78%
    //
    // RULING Q2 (2026-09-18) · the candidate set is PRICED events only (Pinnacle
    // closing, n >= 10 priced) and the ranking figure is the backing units the
    // headline prints. See bestEvent(). The units are that event's Pinnacle-closing
    // P&L, the same `pinPl` the modal's "Backing him here" tile prints, so the tile
    // and the row it opens on cannot disagree -- and under the new gate the
    // headline can no longer dash while the support line names an event.
    var be = bestEvent(p);
    // fx4 item 4 · the per-event Backing (the page's row join, trProfileBacking) has not answered yet: the
    // tile claims nothing — no "no event with 10+ priced matches", no fallback that the best event would
    // replace a moment later — and paints once when the join lands.
    v.tourn = tournBackingPending(p) ? { headline: null, support: null, pending: true }
      : be
      ? {
          headline: signed(be.pinPl, 1),
          hlSuffix: 'u',
          hlSuffixColor: be.pinPl >= 0 ? 'var(--pos)' : 'var(--neg)',
          // ITEM 3 (2026-09-19) · five tokens wrapped to two lines and made this
          // row of cards 2.4 CSS taller than the other (measured: 142.4 v 140.0
          // on T. Griekspoor). The export's shape is four:
          //     Cincinnati · best event · 14-4 · 78%
          //
          // The token dropped is the RATE, not the priced count. Two reasons:
          // the rate is recoverable from the record standing next to it (12-10
          // IS 55%), whereas the priced n is the only thing on the tile that
          // says what the +16.3u headline was struck over; and the founder's
          // 2026-09-18 Q3 ruling is explicit — "keep '· N priced'". So the
          // fourth token is the n, and the whole-number rate ruling (§5.3 item
          // 9) now applies only where that rate still renders, in the modal.
          support: be.display + ' ' + MIDDOT + ' best event ' + MIDDOT + ' ' +
            recordText(be.won, be.lost) + ' ' + MIDDOT + ' ' + be.pinN + ' priced'
        }
      // TEN-384 fx3 (founder D10): no event clears ten priced -> the tile shows the OVERALL figure.
      // TEN-384 fx4 item 5: the founder's Backing-source question (match-closes vs Market edge rows) is open,
      // and a units figure SUMMED over every priced event can contradict the Market edge box. Until he
      // answers, the overall figure is his W–L over every event (headline the rate, support "all events ·
      // W–L"); per-event Backing (bestEvent above, the modal's column) is unchanged. The summed-units
      // fallback is kept whole behind ONE flag: TOURN_TILE_SUMMED_UNITS = true restores it exactly.
      : (function () {
          var all = TOURN_TILE_SUMMED_UNITS ? tournOverall(p) : null;
          if (TOURN_TILE_SUMMED_UNITS) {
            return all
              ? { headline: signed(all.pl, 1), hlSuffix: 'u', hlSuffixColor: all.pl >= 0 ? 'var(--pos)' : 'var(--neg)',
                  support: 'all events ' + MIDDOT + ' ' + recordText(all.won, all.lost) + ' ' + MIDDOT + ' ' + all.pinN + ' priced' }
              : { headline: null, support: 'no event with 10+ priced matches' };
          }
          var wl = tournRecordAll(p);
          return (wl.won + wl.lost)
            ? { headline: rateText0(wl.won, wl.lost), support: 'all events ' + MIDDOT + ' ' + recordText(wl.won, wl.lost) }
            : { headline: null, support: 'no matches on record' };
        }());

    // 4 · Court speed — FOUNDER RULING 2026-09-16: the headline is always one of
    // the PACE BANDS (since N4, 2026-09-28: Slow · Medium · Fast) or a
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
    // ITEM 2 (2026-09-19) · the headline slot carries a NUMBER, never a label.
    // The band name moves into the support line, which takes the design's own
    // three-token shape ("{label} · his best {thing} · {record}") — the same
    // shape Matchup record already uses one box along.
    //
    // ONE DEVIATION FROM THE CAPTURE, deliberate. The design's speed support
    // reads "clay courts · his best surface · 283-198 career" — a SURFACE. That
    // is the exact defect the founder ruled out on 2026-09-16 ("the headline is
    // always one of the five PACE BANDS ... It is never a surface name"), and
    // the box is Court SPEED. The capture has regressed to the pre-ruling
    // behaviour, so the ruling wins and the label stays a band.
    v.speed = speedBest
      ? { headline: rateText0(speedBest.band.won, speedBest.band.lost),
          support: speedBest.band.band.label + ' ' + MIDDOT + ' his best band ' + MIDDOT + ' ' +
            recordText(speedBest.band.won, speedBest.band.lost) }
      // The BOX has to make the same pending-vs-empty distinction the modal
      // makes, or the two contradict each other on one screen: with the store
      // unsettled every band is zero, speedBestBand() returns null, and the
      // card asserted "no speed band beats his rated-match rate" — a claim
      // about the player — while the modal it opens correctly said the store had
      // not loaded. Same defect class, same zero, one screen.
      : !careerHistorySettled(p.key)
        ? { headline: null, support: 'career match store not loaded' }
        // TEN-384 fx3 (founder D10): no band clears ten matches above his rated-match rate -> the OVERALL
        // figure (every speed-rated match, the modal's Career line), never a dash.
        : (function () {
            var bw = 0, bl = 0, any10 = false, prev = state.speedSurf;
            state.speedSurf = 'all';
            try {
              speedBands(p).forEach(function (b) {
                bw += b.won; bl += b.lost;
                if (gateFor(b.won + b.lost) === GATE.FULL) any10 = true;
              });
            } finally { state.speedSurf = prev; }
            // fx4 item 6 · the TRUE reason (the Draw record tile's wording): no band reaches ten matches, or
            // bands do but none beats his rated-match rate.
            return gateFor(bw + bl) === GATE.FULL || gateFor(bw + bl) === GATE.SMALL
              ? { headline: rateText0(bw, bl),
                  support: 'all rated courts ' + MIDDOT + ' ' + (any10 ? 'no band above it' : 'none at 10+ matches') +
                    ' ' + MIDDOT + ' ' + recordText(bw, bl) }
              : { headline: null, support: 'no speed-rated matches on record' };
          }());

    // 5 · Draw record (was "Splits", slot 6) — the headline is unchanged in KIND
    // (the split's label) but the support gains the record and restates the
    // sample: "best split · 75.0% · 45–15 · 60 matches".
    //
    // Two words left the line deliberately, both because the file's string drops
    // them: "biggest" -> "best", and the trailing "±Xpp vs his baseline" is gone.
    //
    // RULING Q1 (2026-09-18): the word stayed and the SELECTOR changed. It is now
    // bestSplit() -- largest POSITIVE gap at n >= 10, tie to the larger n, the same
    // rule Court speed uses. See bestPositiveSplit().
    //
    // ROUND 2 of the same ruling settles the two things round 1 got wrong:
    //   · the baseline is the POOLED candidate population, not the career spine
    //     (pooledBaseline) -- round 1's spine baseline dashed 370 of 428 players
    //     by comparing a split against a population it is not drawn from;
    //   · the baseline is PRINTED, in the founder's own string shape, so the gap
    //     is reproducible from the rows of the modal this tile opens:
    //       "best split · 75.0% · +9.1pp vs his 65.9% across his draw splits · 45-15"
    // The record carries n (45-15 IS sixty matches), so the trailing "· N matches"
    // the round-1 line repeated is gone -- the founder's example does not have it
    // and §3's "every rate shows its record and n" is satisfied by the record.
    var bs = bestSplit(p);
    var bsBase = boxSplitBaseline(p, 'career');
    // ITEM 2/3 (2026-09-19) · figure in the headline, label in the support, and
    // the line comes down from five tokens to the design's three.
    //
    // WHAT MOVED OFF THE TILE, and why that is safe: the round-2 Q1 ruling asked
    // for the baseline to be printed "so the gap is reproducible". That
    // disclosure is not lost — the Draw record modal's legend carries the same
    // pooled baseline, its record and its n, over the very rows the reader is
    // looking at, which is a better place to check an arithmetic claim than a
    // 10.5px line that wrapped to two. The tile keeps the rate and the record;
    // one click has the gap.
    v.splits = bs
      ? { headline: bs.pick.rate.toFixed(1) + '%',
          support: bs.pick.label + ' ' + MIDDOT + ' best split ' + MIDDOT + ' ' +
            recordText(bs.pick.won, bs.pick.lost) }
      // THREE different empty facts, three different sentences. Caught by reading
      // the rendered tile rather than the code: Giustino's splits store holds
      // eight tour matches, so the pooled baseline is a real 12.5% and the tile
      // read "no split above his 12.5% across his draw splits" — which asserts he
      // has splits that failed to beat the bar when in fact not one of them
      // reaches the ten-match floor. Same class as the Court speed
      // pending-vs-empty split: a claim about the player standing in for a claim
      // about the sample.
      //   no candidates at all   -> the store holds nothing for him
      //   none clear n >= 10     -> the sample, not the player
      //   none positive          -> the player, and it must name the bar
      // TEN-384 fx3: no career-splits entry -> "Splits not built for this player yet" (founder, item 7);
      // splits held but no split picked (none at n >= 10, or none above his rate) -> the OVERALL figure, his
      // rate across these splits (the modal's own baseline), never a dash (founder D10).
      // TEN-391: his splits file still in flight -> the pending tile (same box, no claim).
      : splitsPending(p.key)
        ? { headline: null, support: null, pending: true }
      : splitsNotBuilt(p.key)
        ? { headline: null, support: SPLITS_NOT_BUILT, blankFigure: true }
        : bsBase == null
          ? { headline: null, support: 'no split data on record' }
          : (function () {
              var pop = splitPopulation(p.key, 'career');
              var none10 = !rankedInsights(p, 'career', null, BOX_SPLIT_GROUPS).length;
              if (!pop || pop.n < 5) return { headline: null, support: 'no split clears the ten-match minimum' };
              return { headline: bsBase.toFixed(1) + '%',
                support: 'all splits ' + MIDDOT + ' ' + (none10 ? 'none at 10+ matches' : 'no split above it') +
                  ' ' + MIDDOT + ' ' + recordText(pop.won, pop.n - pop.won) };
            }());

    // 6 · Matchup record (was "Versus playing styles", slot 5) — the headline
    // CHANGES SUBJECT. It used to print his OWN archetype, a label that says
    // nothing about a result and duplicated the header badge; RULING 2 flagged
    // that and the v7 re-lock resolves it. The tile now reads the win rate
    // against the archetype he beats most often, qualified by which one:
    //   74%  /  Matchup record  /  Attacking Baseliner · his best archetype · 20–7
    //
    // Same rows and same rate-descending order as the modal list; the tile takes the first row
    // of n >= 10 (fix item 8), so it is always a row the list shows, at full sample.
    var bm = bestMatchup(p);
    v.styles = bm
      // Whole number, and this one was MEASURED rather than reasoned. The first
      // run of the phase-A probe failed verify step (d) here: the tile read
      // "81.0%" while the row it opens on read "81%" -- the same number in two
      // notations, which is exactly the tile-vs-modal disagreement (d) exists to
      // catch. The Matchup list has always rounded (`Math.round(100*tw/tn)`),
      // and the export's own tile shows "74%", so the tile follows the modal.
      ? { headline: rateText0(bm.won, bm.lost),
          support: bm.label + ' ' + MIDDOT + ' his best archetype ' + MIDDOT + ' ' +
            recordText(bm.won, bm.lost) }
      // TEN-384 fx3 (founder D10): no archetype clears ten -> the OVERALL figure over every labelled
      // opponent (the modal's Career line), never a dash and never a thin row.
      : (function () {
          var rw = 0, rl = 0;
          styleRows(p).forEach(function (r) { rw += r.won; rl += r.lost; });
          return (rw + rl) >= 5
            ? { headline: rateText0(rw, rl),
                support: 'all archetypes ' + MIDDOT + ' none at 10+ matches ' + MIDDOT + ' ' + recordText(rw, rl) }
            : { headline: null, support: (rw + rl) || styleRows(p).total ? 'no archetype clears the ten-match minimum' : 'no matches on record' };
        }());

    // 7 · Market edge — the shard built by build-market-edge.js: Pinnacle close,
    // archive-Bet365 close where Pinnacle is absent, labelled per row. The tour
    // baseline beside it is COMPUTED over the same archive (README §3 bars a
    // rounded constant), not the export's literal -3.79%.
    //
    // TEN-384 (founder): the tour clause is the SAME figure as the Market edge modal's All tile — the
    // Database-aggregate baseline (tourBaselineFor('all'), from tour-baselines.json, which the host
    // loads with the profile data), never the shard's own `tour.all`.
    var mk = marketFor(p.key);
    var tourAllBox = tourBaselineFor('all');
    v.market = marketPending(p.key) && !mk ? { headline: null, support: null, pending: true }
      : mk && mk.headline && mk.headline.yield != null
      ? { headline: neg(mk.headline.yield, 2, '%'),
          // fx2 item 3 (founder: "the tour line hidden until the data arrives, with no dash and no layout
          // shift"): no baseline yet -> the clause is left out (the line keeps its one-line box), never "tour —".
          support: 'flat-stake yield ' + MIDDOT + ' ' + mk.headline.n + ' priced' +
            (tourAllBox == null ? '' : ' ' + MIDDOT + ' tour ' + neg(tourAllBox, 2, '%')) }
      : { headline: null, support: 'no priced matches on record' };

    // 8 · Live trading (was "Playing profile") — the headline CHANGES SUBJECT,
    // and this is the second half of RULING 2's fix. It used to print the season
    // win rate: the same number as the header's SEASON cell and as box 2, three
    // printings of one figure on one screen, and a figure with nothing to do
    // with the in-play modal it opens. The locked tile reads an in-play state:
    //   8–19  /  Live trading  /  from a set down · 29.6% · 6.4pp below tour
    //
    // SOURCE AND ITS HORIZON. "From a set down" needs per-set SCORES in order,
    // not a set COUNT. The career spine carries only the count ("2 - 1"), so it
    // cannot answer this; `recentForm` is the one store holding ordered set
    // scores, and it is short (66 of Zverev's 775 rows). The subtitle of the
    // modal already states that horizon and the support line states its own n,
    // so the tile never implies the career.
    //
    // THE TOUR CLAUSE IS NOT WIRED. "6.4pp below tour" needs the ATP field's own
    // from-a-set-down rate over the same window, and no such aggregate exists in
    // any store this page reads. §3 bars a rounded constant and bars inventing
    // one, so the clause is dropped and its absence is named rather than filled.
    // TEN-384 fix item 8 (founder 2026-10-05): a tile headline only from a split of n >= 10. Under
    // ten matches from a set down, the tile falls back to the next best in-play state: the
    // Situational row of n >= 10 with the largest gap to its tour figure (liveTileFallback).
    var sd = fromASetDown(p);
    var sdFull = sd && sd.gate === GATE.FULL;
    var lf = sdFull ? null : liveTileFallback(p);
    v.profile = lf
      ? { headline: recordText(lf.w, lf.l),
          support: lf.label + ' ' + MIDDOT + ' ' + rateText(lf.w, lf.l) + ' ' + MIDDOT + ' ' +
            Math.abs(Math.round(lf.gap * 10) / 10).toFixed(1) + 'pp ' + (lf.gap < 0 ? 'below' : 'above') + ' tour' }
      : sdFull
      ? { headline: recordText(sd.won, sd.lost),
          // RULING item 6 (2026-09-19): the export's third clause is the TOUR
          // GAP, and it is now computable — see tourFromASetDown(). The sample
          // count it replaces moves into the modal, which is where the window
          // was always stated. Where the pool is too thin to strike a tour
          // figure the count comes back rather than a fabricated gap. (Fix item 8: this branch is
          // n >= 10 only, so no small-sample clause can reach the tile.)
          support: (function () {
            var head = 'from a set down';
            var rate = (100 * sd.won / sd.n);
            var tour = tourFromASetDown();
            var tail;
            if (tour.pct == null) {
              tail = sd.n + ' of ' + sd.scanned + ' with set scores';
            } else {
              var gap = rate - tour.pct;
              // The export writes the direction in words ("below tour"), so the
              // sign is carried by the word and the number stays unsigned.
              tail = Math.abs(Math.round(gap * 10) / 10).toFixed(1) + 'pp ' +
                (gap < 0 ? 'below' : 'above') + ' tour';
            }
            return head + ' ' + MIDDOT + ' ' + rateText(sd.won, sd.lost) + ' ' + MIDDOT + ' ' + tail;
          })() }
      // TEN-384 fx3 (founder D10): no in-play state clears ten -> the OVERALL figure, his record over every
      // match with set-by-set scores (the population the in-play states are cut from), never a dash.
      : (function () {
          var ov = setScoredRecord(p);
          return ov.n >= 5
            ? { headline: recordText(ov.won, ov.lost),
                support: 'all matches with set scores ' + MIDDOT + ' ' + rateText(ov.won, ov.lost) }
            : { headline: null, support: ov.n ? 'no in-play state clears the ten-match minimum' : 'no set-by-set scores on record' };
        }());

    return v;
  }

  // ─── splits (career-splits.json) ───────────────────────────────────────────
  // The Splits modal's own source. Players outside the builder's rank cap have no
  // row: the box, the modal and Key insights then say "Splits not built for this
  // player yet" (fx3, founder ruling on item 7), never a zero.
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

  // ── v7 §5.7: the Draw record modal no longer shows Surface ─────────────────
  //
  // "There is no Surface group — it was removed on 2026-09-17 because Career
  // record already carries by-surface; do not add it back." The A4 subtitle is
  // rewritten to match ("by level, format, round and opponent"), so the group
  // has to go or the header describes a body it does not have.
  //
  // It is removed from what the modal RENDERS, not from the vocabulary. The two
  // were the same list before and conflating them would have moved a block the
  // founder only asked me to verify: Key insights ranks over `splitCandidates`,
  // so deleting the surface members outright would have silently dropped every
  // surface insight off the page. Surface is still shown on this page — it is
  // the Career record modal's first block — so a surface insight is still a
  // legitimate finding and still eligible.
  var DRAW_GROUPS = SPLIT_GROUPS.filter(function (g) { return g.id !== 'surface'; });
  //
  // §5.7 also adds `Early rounds` to By round and `vs Top 50` to Opponent.
  //   · Early rounds is BUILT (TEN-384) as a render-only row recomposed from the
  //     Round of 16/32/64/128 numerators (earlyRoundsRow in the Draw section).
  //     It is not a member here, so the box / Key insights candidates are unchanged.
  //   · vs Top 50 is NOT shown: founder Q7 (2026-10-05) — Opponent runs through
  //     vs Top 10 only. career-splits.json holds no Top-50 split.
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
  function splitCandidates(key, scope, groups) {
    var sc = splitScope(key, scope);
    if (!sc) return [];
    var out = [];
    (groups || SPLIT_GROUPS).forEach(function (g) {
      g.members.forEach(function (m) {
        var r = sc[m];
        if (!r || r.W == null || r.L == null) return;
        out.push({ id: g.id + ':' + m, label: m, won: r.W, lost: r.L });
      });
    });
    return out;
  }
  // ── R2 (founder, 2026-09-17) · ONE rule, ONE function ─────────────────────
  // "The 'best split' selector and the Key insights selector are now one rule —
  // implement them off one shared function, not two that happen to agree today."
  //
  //   candidates : Surface, Format and Opponent only. Level and Round EXCLUDED.
  //   gate       : n >= 10.
  //   baseline   : the player's OWN career win rate — not the pooled rate of the
  //                candidate set, which is what pickByLargestGap() computes and
  //                which drifts as members enter and leave the set.
  //   selection  : largest |pp| against that baseline. May be negative.
  //   padding    : never. Fewer than three eligible -> fewer cards.
  //
  // pickByLargestGap() stays exactly as it is: it still backs the Court speed and
  // price-band pickers, whose baseline IS their own pooled rate by design. This is
  // a different rule for a different question, so it is a different function.
  var INSIGHT_MIN_N = 10;
  // ── RULING Q2 round 2 (founder, 2026-09-18) · the candidate sets ──────────
  //
  // "Restrict Key insights' positive card to the box's groups (format, level,
  //  round, opponent). Do not re-add Surface to Draw record — surface has its own
  //  box, modal and rows in Career record. Key insights may still carry a
  //  NEGATIVE surface finding, but the positive card must be selectable by the
  //  box, so the two can never contradict."
  //
  // That answers the question round 1 reported: the box's groups ARE the Draw
  // record modal's groups, all four of them. R2's exclusion of Level and Round
  // from the selector is superseded — the founder names them explicitly, and the
  // export's own example headline ("Other Tours") is a LEVEL member, so the
  // exclusion was always in tension with the design.
  //
  //   BOX_SPLIT_GROUPS — format, level, round, opponent. The box's candidates,
  //                      and the ONLY groups a POSITIVE insight card may come
  //                      from. Identical to what the modal renders, so the pick
  //                      is always reproducible from the rows behind the tile.
  //   INSIGHT_GROUPS   — the full split vocabulary, surface included. Negative
  //                      findings only, outside the box groups.
  var INSIGHT_GROUPS = SPLIT_GROUPS.map(function (g) { return g.id; });
  // R2's RULE is untouched and still lives in one function. What v7 forces apart
  // is the CANDIDATE SET, because the two callers now open two different modals
  // and the founder's verify step (d) requires a tile's headline to be a figure
  // the modal behind it actually shows:
  //
  //   Key insights  -> INSIGHT_GROUPS. Unchanged. Surface stays eligible because
  //                    Career record still shows by-surface on this page.
  //   Draw record   -> BOX_SPLIT_GROUPS = R2's groups minus the one §5.7 just
  //     box            removed from the modal. Level and round remain excluded
  //                    by R2, so what is left is format and opponent.
  //
  // RESOLVED by Q2 round 2: the box's set is the modal's set, verbatim. One list
  // derived from one constant, so a group added to or removed from the Draw
  // record modal moves the selector with it and the two cannot drift.
  var BOX_SPLIT_GROUPS = DRAW_GROUPS.map(function (g) { return g.id; });
  function insightCandidates(key, scope, groups) {
    var allow = groups || INSIGHT_GROUPS;
    return splitCandidates(key, scope).filter(function (c) {
      return allow.indexOf(String(c.id).split(':')[0]) >= 0;
    });
  }
  /**
   * The player's own career win rate, off the career spine (README §4's total).
   *
   * NO LONGER the insight/split baseline — see RULING Q1 round 2 below. The
   * renderer has no call site left; it is kept and exported for the RECONCILIATION
   * checks, which compare the split population against the spine to quantify how
   * much narrower the split store is (the −11.7pp finding). The earlier docstring
   * claimed the header and Career record print it — they do not; they compute
   * their own totals off spineTotal(). Corrected rather than deleted, because a
   * wrong reason for keeping code is how dead code survives the next audit.
   */
  function careerBaseline(p) {
    var t = spineTotal(p);
    var n = t.won + t.lost;
    return n ? (100 * t.won / n) : null;
  }

  // ── RULING Q1 round 2 (founder, 2026-09-18) · the baseline is the POOLED
  //    CANDIDATE POPULATION, not the career spine ────────────────────────────
  //
  // "Switch to the pooled candidate-population baseline (the Court-speed reading)
  //  AND print the baseline on the tile so the gap is reproducible. My 'vs his
  //  career rate' wording was wrong: comparing a split against a DIFFERENT
  //  population was the error, not the intent."
  //
  // Round 1 fixed the SIGN (best now means best) but kept the spine as baseline,
  // and that is what dashed 370 of 428 players: career-splits is a narrower and
  // harder population than the spine — pooled rate below spine rate for 209 of
  // 227 players, median -11.7pp — so almost nothing could clear a baseline drawn
  // from a population the splits do not cover.
  //
  // The rule is now literally speedBestBand()'s, transposed: pool over the SAME
  // candidate set you select from, weighted by match count (README §4, "pooled
  // figures weight by match count"), then take the largest positive gap at
  // n >= 10. Every number in the claim is then reproducible from the rows the
  // modal behind the tile prints — which is the whole point of printing it.
  // ── CORRECTION (clean-context review, 2026-09-18) · a row-weighted mean over
  //    OVERLAPPING groups is not a win rate ──────────────────────────────────
  //
  // The first cut of this ruling summed W and L across every candidate row and
  // divided. That is exactly what speedBestBand() does — but its BANDS PARTITION
  // their matches, and the split groups do not:
  //
  //   Zverev, career      W / n      what it is
  //     format          572 / 808    a COMPLETE partition of the split population
  //     surface         572 / 808    a second complete partition — same number
  //     level           545 / 765    incomplete: 43 matches at no listed level
  //     round           156 / 253    Finals/SF/QF only; early rounds absent
  //     opponent        631 / 954    OVER-counts: vs. Top 10 overlaps the
  //                                  handedness rows, so those matches count twice
  //
  // Summed, that is 2,780 row-slots over ~808 real matches, and the quotient
  // (68.49%) is a row-weighted mean, NOT his win rate over the population — the
  // low-rate rows (vs. Top 10, deep rounds) are counted two and three times, so
  // the mean sits BELOW the truth. Roster-wide the error is a median -1.37pp,
  // worst -8.93pp, which inflated every printed gap by a median +1.47pp and
  // advertised FOUR splits as a positive "best" when the player's record over the
  // population is flat or negative (B. Gojo, vs. Righties: printed +3.2pp, really
  // -0.4pp). That is the defect Q1 exists to remove, reintroduced by the baseline.
  //
  // So the baseline is a WIN RATE over a COMPLETE PARTITION. `format` is used —
  // Best of 5 + Best of 3 is every match the store holds — cross-checked against
  // `surface`, which is an independent partition of the same population: the two
  // agree exactly for 213 of 227 players on career and 227 of 227 on last52, and
  // in all 14 disagreements format is the larger, so format is also the safer.
  //
  // One consequence, and it is the point: the baseline no longer depends on WHICH
  // GROUPS the caller ranks over. The box and Key insights now quote one number,
  // the modal's "vs avg" column quotes the same number, and a split shows the
  // same signed pp wherever it appears.
  var POP_PARTITIONS = ['format', 'surface'];
  function partitionTotal(sc, groupId) {
    var g = SPLIT_GROUPS.filter(function (x) { return x.id === groupId; })[0];
    var w = 0, n = 0;
    if (!g || !sc) return { won: 0, n: 0 };
    g.members.forEach(function (m) {
      var r = sc[m];
      if (!r || r.W == null || r.L == null) return;
      w += r.W; n += r.W + r.L;
    });
    return { won: w, n: n };
  }
  /**
   * The player's win rate over the population his splits are drawn from, with the
   * partition it was measured on. Returns null when the store holds nothing —
   * "no population" and "a 0% population" are different facts.
   */
  function splitPopulation(key, scope) {
    var sc = splitScope(key, scope || 'career');
    if (!sc) return null;
    for (var i = 0; i < POP_PARTITIONS.length; i++) {
      var t = partitionTotal(sc, POP_PARTITIONS[i]);
      if (t.n) return { rate: 100 * t.won / t.n, won: t.won, n: t.n, via: POP_PARTITIONS[i] };
    }
    return null;
  }
  function pooledBaseline(key, scope) {
    var pop = splitPopulation(key, scope);
    return pop ? pop.rate : null;
  }
  // One population now, so one phrase. It stays a function because the string is
  // asserted in three places and a literal repeated four times is a drift waiting
  // to happen.
  function baselinePopLabel() { return 'across these splits'; }
  /**
   * Every eligible candidate, ranked by |gap| descending. `limit` slices; it never
   * pads. Returns [] when the player has no baseline or nothing clears n >= 10.
   *
   * `baseline` is pooled over the candidate set — INCLUDING members under the
   * n >= 10 floor, exactly as pickByLargestGap() and speedBestBand() pool. The
   * floor governs what may be SELECTED, not what the population is; excluding
   * thin splits from the pool would measure the gap against a population the
   * modal does not show.
   */
  function rankedInsights(p, scope, limit, groups) {
    var cands = insightCandidates(p.key, scope || 'career', groups);
    // Deliberately NOT derived from `cands`: the baseline is the population's win
    // rate, and the population does not change because the caller narrowed which
    // groups it will rank. This is what makes the box's pick and Key insights'
    // cards quote one number — the review found the group-dependent version could
    // put a green +1.3pp card under a dashed tile.
    var baseline = pooledBaseline(p.key, scope || 'career');
    if (baseline == null) return [];
    var pop = baselinePopLabel();
    var out = cands.map(function (c) {
      var n = c.won + c.lost;
      if (n < INSIGHT_MIN_N) return null;
      var rate = 100 * c.won / n;
      return { id: c.id, label: c.label, won: c.won, lost: c.lost, n: n,
        rate: rate, gap: rate - baseline, baseline: baseline, pop: pop };
    }).filter(Boolean);
    out.sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); });
    return limit == null ? out : out.slice(0, limit);
  }
  // ── RULING Q1 (founder, 2026-09-18) · "best" now MEANS best ───────────────
  // Phase A shipped the v7 locked word "best split" over R2's sign-BLIND
  // largest-|pp| selector, and the result was a tile reading
  //   "vs. Top 10 — best split · 40.8% · 60–87"
  // against a 70.9% career rate. That is Zverev's WORST split, labelled best.
  //
  // Founder ruled: keep the word, change the selector. The rule is now the one
  // Court speed already uses (speedBestBand, §8.3):
  //
  //   candidates : rankedInsights' set for the caller's groups (n >= 10 floor;
  //                round 2 moved the baseline to the POOLED candidate population
  //                — see pooledBaseline()).
  //   selection  : largest POSITIVE gap. Ties -> the larger n.
  //   none       : dash. "No positive split" is an honest answer; the least-bad
  //                split dressed up as a strength is not.
  //
  // ONE function, two callers — the box (BOX_SPLIT_GROUPS) and Key insights'
  // positive card (which takes the box's pick verbatim, see renderInsights), so
  // the tile and the card cannot name different splits. rankedInsights() is
  // untouched: it still ranks by |gap| and still surfaces NEGATIVE findings,
  // which stay allowed in Key insights as separate cards, worded plainly.
  function bestPositiveSplit(p, scope, groups) {
    var best = null;
    rankedInsights(p, scope || 'career', null, groups).forEach(function (c) {
      if (!(c.gap > 0)) return;                 // positive-only is the ruling
      if (!best || c.gap > best.gap || (c.gap === best.gap && c.n > best.n)) best = c;
    });
    return best;
  }
  /** The box's baseline, whether or not a pick clears the bar — the empty copy
   *  has to name the number the splits failed to beat, or the dash is unreadable.
   *  Now the population rate, so it is the SAME number the modal column and every
   *  insight card quote. */
  function boxSplitBaseline(p, scope) {
    return pooledBaseline(p.key, scope || 'career');
  }
  function bestSplit(p) {
    var top = bestPositiveSplit(p, 'career', BOX_SPLIT_GROUPS);
    return top ? { pick: top, baseline: top.baseline, pop: top.pop } : null;
  }

  // The band cut-offs, mirrored from build-market-edge.js's PRICE_BANDS so the
  // band -> match drill puts a row in the SAME band the shard counted it in. A
  // mirror of a builder constant is a thing that drifts silently, so the drill
  // prints its own reconciliation (the band's n against the rows matched) on
  // screen rather than trusting the two to agree.
  // The ladder is role-specific since the 8-band ruling (2026-09-18): a price
  // alone no longer names a band, because 1.95 is band `f165_199` for a favourite
  // and band `d200_249` for an underdog. Passing the role is not optional.
  // TEN-310 (2026-09-27): shards now stamp each row's `band` (the builder's own bucketing via
  // market-edge-core.js), and the drill reads that first. This mirror is the fallback for a row
  // without one, on the same rule: the half-open ladder, role = price < 2.00.
  function priceBandId(price, role) {
    if (price == null) return null;
    var MEC = window.MarketEdgeCore;
    if (MEC) {
      var i = MEC.bandOf(price);
      var ids = ['f101_120', 'f121_140', 'f141_164', 'f165_199', 'd200_249', 'd250_349', 'd350_599', 'd600_up'];
      return i < 0 ? null : ids[i];
    }
    if (role === 'fav') {
      return price <= 1.2 ? 'f101_120' : price <= 1.4 ? 'f121_140' : price <= 1.64 ? 'f141_164' : 'f165_199';
    }
    if (role === 'dog') {
      return price < 2.5 ? 'd200_249' : price < 3.5 ? 'd250_349' : price < 6.0 ? 'd350_599' : 'd600_up';
    }
    return null;
  }

  // ─── market edge (market-edge/{key}.json) ──────────────────────────────────
  // Lazy shard, same posture as the existing odds-performance shards: nothing is
  // fetched until the page asks. The module reads a store the host page fills so
  // this file owns no transport.
  function marketFor(key) {
    var store = window.marketEdge || {};
    return store[String(key)] || null;
  }
  // TEN-384 fx2 item 3 · LOADING IS NOT "NONE". The host marks a player's market-edge shard in flight
  // on window.marketEdgePending[key] (bsp-consult-dashboard.html _loadPp2MarketShard) and clears it
  // when the shard settles — answered or failed. While it is set, nothing reading the shard may claim
  // anything about the player: the box paints a neutral pending line (same height, no text), never
  // "no priced matches on record". No pending map (the Node harnesses) = settled.
  function marketPending(key) {
    var m = window.marketEdgePending;
    return !!(m && m[String(key)]);
  }
  // TEN-384 fx4 item 4 · the same pending state for EVERY surface that reads the shard (Calendar tiles, footer
  // and footnote, Court speed units, Matchup Backing): while the player's shard is in flight and not yet held,
  // each priced figure keeps its box with a non-breaking space (PEND_HTML) and no sentence claims anything.
  // The host repaints once when the shard settles (pp2RepaintIfOpen).
  function shardPending(p) {
    return !!p && marketPending(p.key) && !marketFor(p.key);
  }
  // fx5 item 6 · `line-height:inherit`: the page's `.pp2-scrim *` / `.pp2-main *` rule resets every nested element
  // to line-height normal, so the marker span inside a 24px/line-height-24 figure drew a 32px line box (the
  // Calendar tiles stood 102px pending against 94px painted). The painted figure is text in the PARENT, so the
  // marker takes the parent's line height and the pending box is the painted box exactly.
  var PEND_HTML = '<span data-pp2-pending="figure" style="line-height:inherit;">&nbsp;</span>';
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
    // TEN-384 Q4.6 · Record per tournament goes up to 1440px (the brief's words win over the reference's 1120).
    career: 820, tourn: 1440, season: 1180, speed: 1120,
    styles: 820, splits: 900, market: 1080, profile: 820
  };
  var CAREER_SUBTITLE = 'Record by surface and season, and his ratings against the field';
  function modalSubtitle(key, p, ctx) {
    var sn = shortName(p);
    var ct = spineTotal(p);
    switch (key) {
      // Item 2. The design string is "All-time record, by surface, indoors and by
      // season" — we had dropped "indoors", which is the one word that tells the
      // reader the Hard row is outdoor-only. The ruled scope label stays appended.
      // v7 §5.1 rewrote this to "Record by surface and season, and his ratings
      // against the field". RULING Q4 (founder, 2026-09-18) amends the locked
      // string in three ways, and every one of them is his wording:
      //
      //  (a) "indoors" is RE-ADDED. The Hard row is outdoor-only and the word is
      //      the only thing on this header that says so. Dropping it made the
      //      Indoors row and column unexplained.
      //  (b) "and his ratings against the field" is DROPPED until the Ratings tab
      //      lands in phase C, then restored VERBATIM. A subtitle that promises a
      //      tab the modal does not have is the same defect class as a dead click
      //      target. PHASE C: restore the clause exactly as quoted above.
      //  (c) the scope label "since <year>" is carried wherever the TILE's window
      //      is narrower than the GRID -- i.e. when dated match rows reach further
      //      back than the careerByYear spine this modal totals. Printed only when
      //      the two genuinely differ, so it is never noise.
      // TEN-384 fx6 item 7 (founder r2, 2026-10-07): "restore 'Record by surface and season, and his ratings
      // against the field'". The Ratings tab has landed (CAREER_TABS), so the phase-C restore is due: the
      // subtitle is that string EXACTLY, with no "indoors" re-add and no "since <year>" scope label (both
      // Q4 amendments are superseded by this ruling).
      case 'career': return CAREER_SUBTITLE;
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
      // v7 §5.1 drops "surface" from this list; §5.7 drops the group from the
      // body. Both halves are applied — the header and the body still describe
      // each other.
      case 'splits': return 'Record and win rate by level, format, round and opponent';
      case 'market': return 'How the market has priced him, and what backing him flat has returned';
      case 'speed': return 'Win rate by court pace band';
      // TEN-228 item 5 · the file's own BOXES subtitle, verbatim and static
      // (`Player Stat Boxes.dc.html`:2935). The previous string was a truthful
      // hedge about coverage; the coverage fact now lives in the footnote, where
      // §5.6's own note already carries it.
      case 'styles': return 'Win rate by opposing archetype ' + MIDDOT + ' minimum 5 matches';
      // §5.9. The subtitle names the SOURCE's window, not a career span — this
      // modal is the only block on the page fed by the point-by-point rollup and
      // its horizon is shorter than the ledger's.
      // v7 §5.1 replaces this with "In-play states and how he plays from them",
      // which describes the phase-C rebuild rather than today's hold/break body.
      // The locked string is taken, and the coverage count the old subtitle
      // carried is kept appended: it is the one fact on this header that stops
      // the reader reading the modal as the full career, and §5.9's own note
      // says the same thing in the body.
      // TEN-384: the reference's subtitle, without the coverage clause (inventory
      // C row 45). The pbp coverage it carried stays reachable on the Situational
      // head's tooltip.
      case 'profile': return 'In-play states and how he plays from them';
      default: return '';
    }
  }

  // TEN-228 item 5 · "Title 'Matchup record' (live: 'Versus playing styles')".
  //
  // REPORTED DIFFERENCE, and the reason this is an override rather than a rename
  // of the box: the FILE's own BOXES entry (`Player Stat Boxes.dc.html`:2935)
  // reads `title: 'Versus playing styles'`, and that same string is what renders
  // on the page TILE (renderBoxes -> b.title). The design screenshot attached to
  // the amendment shows "Matchup record" in the MODAL header, which is what the
  // founder is comparing against, and he asked for it under "SHELL". So the modal
  // takes the new title and the accepted §4 tile is left alone. If he wants the
  // tile renamed too it is one entry in this map away — asked in the report.
  // RESOLVED BY v7, and the override is gone. The note above asked whether the
  // TILE should be renamed too; the re-locked box object answers it directly --
  // `Player Stat Boxes.dc.html`:3227 now reads `title: 'Matchup record'`, so the
  // tile and the modal take the one name from the one place and the map that
  // held them apart is no longer needed. The same answer applies to `splits` and
  // `profile`, which v7 renames in the same way.
  // TEN-384 · the shared shell for all eight modals, measured on OFFICIAL VERSION 1 (inv B S1–S11, C 1–6):
  // header centred, gap 13, padding 20/22, --line rule; icon tile 34² r10 on --selected with a WHITE 17px
  // icon (foundation: icons are white — the reference's blue stroke is not taken); title 17/800 ls −0.17px;
  // close 32² r9, white 5% (--wash-5) + --line, a 14px SVG ×. Every <button> inside the card takes the
  // card's Hanken (font: inherit — the UA default was Arial), and an idle segment (`.pp2-seg-idle`) carries
  // no edge until it is hovered. The CSS lives here, with the shell, so the eight modals share one copy.
  var MODAL_SHELL_CSS = '<style>' +
    '.pp2-card button,.pp2-card input{font-family:inherit;}' +
    '.pp2-seg-idle{border-color:transparent!important;}' +
    '.pp2-seg-idle:hover{border-color:var(--line)!important;}' +
    '.pp2-tile{transition:background .12s ease,border-color .12s ease;}' +
    '.pp2-tile:hover{background:var(--tile-hover)!important;border-color:var(--edge-16)!important;}' +
    '.pp2-tile.on:hover{background:var(--card)!important;border-color:var(--edge-24)!important;}' +
    '.pp2-orow:hover>*{background:var(--tile-hover);}' +
    '</style>';
  function modalShell(key, p, ctx, body) {
    var box = BOXES.filter(function (b) { return b.key === key; })[0] || {};
    var title = box.title || '';
    return '' +
      '<div class="pp2-scrim" data-pp2="scrim" style="position:fixed;inset:0 0 0 var(--sf-side, 0px);background:var(--backdrop); backdrop-filter:blur(3px);' +
      'z-index:60;display:flex;align-items:flex-start;justify-content:center;' +
      'padding:28px 20px;overflow-y:auto;">' + MODAL_SHELL_CSS +
        '<div class="pp2-card" data-pp2="card" style="width:100%;max-width:' + (MODAL_WIDTH[key] || 900) + 'px;' +
        'background:var(--card);border:1px solid var(--edge-10);border-radius:16px;overflow:hidden;">' +
          '<div style="display:flex;gap:13px;padding:20px 22px;align-items:center;' +
            'border-bottom:1px solid var(--line);">' +
            '<span style="width:34px;height:34px;border-radius:10px;flex:none;display:flex;align-items:center;' +
              'justify-content:center;background:var(--selected);color:var(--text);">' +
              '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
              'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="' +
              (box.icon || '') + '"/></svg></span>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:17px;font-weight:800;letter-spacing:-0.17px;">' + esc(title) + '</div>' +
              '<div style="font-size:12.5px;color:var(--text-label);margin-top:2px;">' +
                esc(modalSubtitle(key, p, ctx)) + '</div>' +
            '</div>' +
            // The Draw record's "Career | Last 52" grain sits in the header (the reference's slot); its
            // builder lives in the Draw section (ana) — the shell only places it.
            (key === 'splits' && typeof drawGrainHtml === 'function' ? drawGrainHtml() : '') +
            '<button type="button" data-pp2="close" aria-label="Close" style="width:32px;height:32px;' +
              'border-radius:9px;background:var(--wash-5);border:1px solid var(--line);padding:0;' +
              'color:var(--text-label);cursor:pointer;flex:none;display:flex;align-items:center;' +
              'justify-content:center;' + (key === 'splits' ? 'margin-left:12px;' : 'margin-left:auto;') + '">' +
              '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
              '<path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.6" ' +
              'stroke-linecap="round"></path></svg></button>' +
          '</div>' +
          '<div style="padding:20px 22px 24px;">' + body + '</div>' +
        '</div>' +
      '</div>';
  }

  // ── TEN-384 · the in-modal controls, one builder for the record modals ─────
  // Tab track (Record | Ratings, Calendar | 2026): --card + --edge-6, r10, pad 3, gap 3; item 7/14 12px r8.
  // Small track (Window, Tier, Surface): --card + --edge-6, r9, pad 2, gap 3; item 5/12 11px r7.
  // Selected = --inner + --edge-10, white 700; idle = --text-label 600, no edge until hover (.pp2-seg-idle).
  function recSegBtn(hook, v, label, on, small, attr) {
    return '<button type="button" data-pp2="' + esc(hook) + '" data-v="' + esc(v) + '"' + (attr || '') +
      (on ? '' : ' class="pp2-seg-idle"') + ' style="cursor:pointer;white-space:nowrap;' +
      'padding:' + (small ? '5px 12px' : '7px 14px') + ';border-radius:' + (small ? 7 : 8) + 'px;' +
      'font-size:' + (small ? 11 : 12) + 'px;font-weight:' + (on ? 700 : 600) + ';line-height:normal;' +
      'color:' + (on ? 'var(--text)' : 'var(--text-label)') + ';' +
      'background:' + (on ? 'var(--inner)' : 'transparent') + ';' +
      'border:1px solid ' + (on ? 'var(--edge-10)' : 'transparent') + ';">' + esc(label) + '</button>';
  }
  function recSegTrack(inner, small) {
    return '<span style="display:flex;gap:3px;background:var(--card);border:1px solid var(--edge-6);' +
      'border-radius:' + (small ? 9 : 10) + 'px;padding:' + (small ? 2 : 3) + 'px;flex:none;">' + inner + '</span>';
  }
  function recCaps(text, extra) {
    return '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
      'text-transform:uppercase;color:var(--text-label);' + (extra || '') + '">' + text + '</span>';
  }
  // A caps label + its small track, as the reference pairs them ("WINDOW  Career | Last 52").
  function recLabelledSeg(label, inner) {
    return '<span style="display:flex;align-items:center;gap:8px;">' + recCaps(esc(label)) +
      recSegTrack(inner, true) + '</span>';
  }
  // The modal's first row: tabs left, controls right (margin-bottom 18, gap 12/18).
  function recTabRow(left, right) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px 18px;' +
      'flex-wrap:wrap;margin-bottom:18px;">' + left +
      (right ? '<span style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' + right + '</span>' : '') +
      '</div>';
  }
  // A panel inside the modal: --card + 1px --edge-6. `pos` joins two panels into one block the way the
  // reference does ('top' r16 16 0 0 with no bottom edge, 'bottom' r 0 0 16 16, else r16).
  function recPanel(inner, pos, pad) {
    var r = pos === 'top' ? '16px 16px 0 0' : pos === 'bottom' ? '0 0 16px 16px' : '16px';
    return '<div style="background:var(--card);border:1px solid var(--edge-6);' +
      (pos === 'top' ? 'border-bottom:0;' : '') + 'border-radius:' + r + ';padding:' + (pad || '20px 24px 22px') +
      ';min-width:0;">' + inner + '</div>';
  }
  // Panel head: caps label left, mono 12 meta right (margin-bottom 14).
  function recPanelHead(label, meta, mb) {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;' +
      'margin-bottom:' + (mb == null ? 14 : mb) + 'px;">' + recCaps(label) +
      (meta ? '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--text-label);' +
        'white-space:nowrap;">' + meta + '</span>' : '') + '</div>';
  }
  // A joined strip of tiles: one --card + --edge-6 r12 box, cells divided by --line.
  function recTileStrip(cells, mb) {
    return '<div style="display:grid;grid-template-columns:repeat(' + cells.length + ',minmax(0,1fr));gap:0;' +
      'background:var(--card);border:1px solid var(--edge-6);border-radius:12px;' +
      (mb == null ? 'margin-bottom:20px;' : 'margin-bottom:' + mb + 'px;') + '">' +
      cells.map(function (c, i) {
        return '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:7px;' +
          'padding:' + (c.pad || '14px 16px') + ';min-width:0;border-left:1px solid ' +
          (i ? 'var(--line)' : 'transparent') + ';">' + c.html + '</div>';
      }).join('') + '</div>';
  }
  // One strip cell: caps cap, mono 24/700 value, then whatever sub lines the caller passes.
  function recTileCell(cap, value, colour, subs) {
    return recCaps(esc(cap)) +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:24px;font-weight:700;line-height:24px;' +
        'color:' + (value === DASH ? DASH_COLOUR : (colour || 'var(--text)')) + ';white-space:nowrap;' +
        'max-width:100%;overflow:hidden;text-overflow:ellipsis;">' + value + '</span>' + (subs || '');
  }
  function recSub(text) {
    return '<span style="font-size:11px;color:var(--text-label);">' + esc(text) + '</span>';
  }

  // ─── the §5.2A record row, taken from the FILE rather than the README ──────
  //
  // Every value below is lifted from `Player Stat Boxes.dc.html` — the template
  // for the markup (grid `minmax(0,1fr) 300px 58px`, gap 16, radius 10, padding
  // 13x16, name 14/700, meta mono 11.5 var(--text-label) margin-top 4, bar track 16px
  // var(--wash-4) radius 4, rate mono 19/700) and `row()` at :1398 for
  // the fill, the background and the rate format. Three of those had drifted and
  // the founder caught all three:
  //
  //   FILL  the file computes ONE blue ramp for every row —
  //         blue at alpha clamp(0.25 .. 1 over a 40->74% win rate) — so the
  //         bar encodes the RATE. We were painting the SURFACE colour at a flat
  //         0.75, which encodes the category instead and leaves the strongest and
  //         weakest surface looking identical. Surface colours stay where the file
  //         puts them: the season-table column heads.
  //   RATE  the file prints `pct + '%'` over an integer percentage — a whole
  //         number. rateText() gives one decimal, right for the tables it was
  //         written for and wrong here.
  //   BG    `bg: thin ? 'var(--inner)' : 'var(--inner)'`. We drew no
  //         background at all, so the row sat flat on the modal card.
  //
  // The 5-9 band is the one value the file does NOT carry for this element:
  // `row()` is called with min=1 from the career box, so no career row ever
  // reaches it. README §9 says "rate var(--text-label), smaller, `small sample` mark"
  // without a size. 15px is the only shrink the export applies to a right-aligned
  // mono rate of its own accord (§5.5 band card). FLAGGED to the founder as a
  // choice, not a measurement — the single number here I could not read off the
  // file.
  var SMALL_RATE_PX = 15;
  // TEN-228 item 23, founder: "n < 5 -> name var(--text-label) (file colour)". He is right
  // and this was wrong: `Player Stat Boxes.dc.html`:1172 declares
  // `DIM = 'var(--text-label)'` and its shared `row()` (:1398) paints the under-minimum
  // NAME with DIM, not with FAINT. We had var(--text-label) — the file's FAINT, which it
  // reserves for the under-minimum RATE. One constant was doing two jobs.
  //
  // `row()` is shared by the career and styles boxes in the export exactly as
  // barRow() is here, so this corrects §5.2A's under-minimum rows too. Reported
  // rather than slipped in. The matching FAINT on the dashed RATE is NOT applied:
  // that cell reads DASH_COLOUR var(--text-label) today and changing it would restyle an
  // accepted surface on an instruction the founder did not give.
  var DIM_COLOUR = 'var(--text-label)';
  // ─── MINIMAL BAR — the founder's override of the export (2026-09-17) ────────
  //
  // The export's `row()` computes ONE blue ramp whose ALPHA encodes the rate
  // (blue at alpha 0.25..1 over a 40->74% win rate) on a 16px track. That
  // shipped and was then overridden: "Win rate is shown by length only; remove
  // the blue-ramp shading." So the rate is carried by the FILL WIDTH alone and
  // the colour carries the SAMPLE GATE instead — which is the one thing length
  // cannot say, because a 4-of-5 bar and a 40-of-50 bar are the same length.
  //
  //   n >= 10   var(--bar)   full rate
  //   n 5-9     var(--text-label)   small sample
  //   n < 5     no fill at all — only the track
  //
  // Track and fill are both 4px / radius 2 / no border, no shadow, no gradient.
  var BAR_TRACK_BG = 'var(--track)';
  var BAR_FULL = 'var(--bar)';
  var BAR_SMALL = 'var(--text-label)';
  // Takes the MATCH COUNT, not the percentage: the colour is a gate reading and
  // the gate is defined over n. Returns null where the gate paints no fill, so a
  // caller cannot accidentally render a transparent bar that still has a width.
  function barFillColour(n) {
    var g = gateFor(n);
    if (g === GATE.FULL) return BAR_FULL;
    if (g === GATE.SMALL) return BAR_SMALL;
    return null;
  }
  // opts: { label, meta, thinMeta, won, lost, hook, v, open, openBg, anchor,
  //         units, unitsColour, detail }
  //
  // TEN-228 §5.6 additions, all opt-in so §5.2A's shipped pixels are untouched
  // where they are not passed:
  //   thinMeta     the file's under-minimum meta ("N matches · below the
  //                five-match minimum"); without it `meta` is used for both.
  //   units        a mono 12px/700 line ABOVE the rate, which is what the file's
  //                right cell holds (`flex-direction:column; align-items:flex-end;
  //                gap:4px`). Absent -> the single-value cell renders unchanged.
  //   openBg       the selected-row background (amendment item 24). §5.2A ships
  //                with border-only selection, so this stays off there.
  //   anchor       a scroll target id, so a bubble click can bring its row into
  //                view (item 16).
  function barRow(opts) {
    var won = opts.won || 0, lost = opts.lost || 0;
    var n = won + lost;
    var g = gateFor(n);
    var pct = n ? 100 * won / n : null;
    // §9 gate, enforced at the one place this rate is printed:
    //   >=10  whole-number rate, 19px, var(--text)
    //   5-9   whole-number rate, var(--text-label), smaller, "small sample" mark
    //   1-4   NO rate (the W-L still shows in the meta line) and the row does not open
    //   0     em dash
    var rate, rateColour, ratePx, mark = '';
    if (g === GATE.FULL) { rate = Math.round(pct) + '%'; rateColour = 'var(--text)'; ratePx = 19; }
    else if (g === GATE.SMALL) {
      rate = Math.round(pct) + '%'; rateColour = 'var(--text-label)'; ratePx = SMALL_RATE_PX;
      // Fix item 9: the mark is "small sample · n=X" under the rate (the 2026 tab's form).
      mark = '<div style="display:flex;justify-content:flex-end;">' + smallSampleHtml(n) + '</div>';
    } else { rate = DASH; rateColour = DASH_COLOUR; ratePx = 19; }

    var thin = g === GATE.NONE || g === GATE.THIN;
    var clickable = !!opts.hook && !thin;
    var bg = thin ? 'var(--inner)' : 'var(--inner)';
    if (opts.open && opts.openBg) bg = 'var(--selected)';   // selection is a lift, never blue (TEN-376)
    return '' +
      '<div' + (clickable ? ' data-pp2="' + opts.hook + '" data-v="' + esc(String(opts.v)) + '"' : '') +
      (opts.anchor ? ' data-pp2-anchor="' + esc(String(opts.anchor)) + '"' : '') +
      ' style="display:grid;grid-template-columns:minmax(0,1fr) 300px 58px;gap:16px;align-items:center;' +
      'border-radius:10px;padding:13px 16px;' +
      'border:1px solid ' + (opts.open ? 'var(--edge-10)' : 'color-mix(in srgb, var(--text) 4.5%, transparent)') + ';' +
      'background:' + bg + ';' +
      (clickable ? 'cursor:pointer;' : '') + '">' +
        '<div style="min-width:0;"><div style="font-size:14px;font-weight:700;' +
          (thin ? 'color:' + DIM_COLOUR + ';' : '') + '">' + esc(opts.label) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:var(--text-label);' +
            'margin-top:4px;">' + esc((thin && opts.thinMeta) ? opts.thinMeta : opts.meta) + '</div></div>' +
        // Minimal bar: 4px track, 4px fill, radius 2 on both, one solid colour.
        // The grid's align-items:center does the vertical centring, so the track
        // needs no margin of its own.
        '<div style="height:4px;border-radius:2px;background:' + BAR_TRACK_BG + ';overflow:hidden;">' +
          (barFillColour(n)
            ? '<div style="height:4px;width:' + pct.toFixed(1) + '%;' +
              'background:' + barFillColour(n) + ';border-radius:2px;"></div>'
            : '') +
        '</div>' +
        (opts.units == null
          ? '<div style="text-align:right;font-family:\'IBM Plex Mono\',monospace;font-size:' + ratePx + 'px;' +
            'font-weight:700;color:' + rateColour + ';">' + rate + mark + '</div>'
          : '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;' +
              'color:' + (opts.unitsColour || 'var(--text-label)') + ';">' + esc(String(opts.units)) + '</span>' +
            '<span style="text-align:right;font-family:\'IBM Plex Mono\',monospace;' +
              'font-size:' + ratePx + 'px;font-weight:700;color:' + rateColour + ';">' +
              rate + mark + '</span>' +
            '</div>') +
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
  // ── the Last-52 window's surface cells ────────────────────────────────────
  //
  // §5.2 item 5, second half. The file's head control is `Career | Last 52`
  // (:3332), replacing the `Career | 2026` we shipped — see renderCareerModal.
  //
  // WHY THIS CANNOT COME OFF THE SPINE, and why it does not come off
  // career-splits either:
  //
  //   The spine is the provider's SEASON aggregate. A 52-week window crosses a
  //   year boundary, so no combination of season buckets can carve it — the
  //   window is simply not expressible in that store.
  //
  //   career-splits.json DOES carry a `last52` node, and using it would have been
  //   one line. It is the wrong store twice over. (a) Its surface list is
  //   Hard/Clay/Grass with NO Indoors, so it cannot fill the file's four-row
  //   ladder. (b) It is a measurably NARROWER population than the spine — the
  //   two disagree by a double-digit number of matches on most players — so the
  //   Career scope (spine) and the Last 52 scope (splits) would be two different
  //   populations under one control, and the §4 reconciliation would be checking
  //   one against the other. That is the exact failure the surface-row-vs-column
  //   rebuild already fixed once.
  //
  //   So the window is carved from the Calendar's dated rows — calSpine(), see
  //   last52Rows() (TEN-384 fix 1 + 2; it used to be drillSpine(), a second dated
  //   store that disagreed with the Calendar). Row and drill are one population by
  //   construction: the drill lists last52Rows() through the same filter.
  //
  // TWO THINGS IT CANNOT DO, both stated on the page rather than papered over:
  //
  //   a. INDOORS. (Superseded by TEN-384 fx6 item 1: the window carves Indoors out of its surfaces
  //      on the season table's court, see seasonCourts(); the Indoors drill lists those rows. Only a
  //      row whose court cannot be resolved stays under its surface.)
  //
  //   b. UNDATED MATCHES. Career-record matches with no dated match row cannot
  //      be placed in a 52-week window at all. They are counted with the
  //      Calendar's own calResidual() and the footnote says how many — an undated
  //      match is not a match that did not happen.
  function last52Cutoff() {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() - 364);
    return d.toISOString().slice(0, 10);
  }
  // TEN-384 fix 1 + 2 (founder 2026-10-07) · ONE DATED STORE. The window used to be carved from
  // drillSpine() (recentForm + undated tournamentHistory editions, one store per year), while the
  // Calendar reads career-history. Two stores, two answers: Alcaraz's Last 52 read 30–4 with "364
  // undated rows" while the Calendar held Nov 2025 4–1 inside the window and counted 76 undated
  // matches. The window is now the Calendar's own rows — calSpine(), career-history, every row dated —
  // cut at the same 364-day line, and the undated count is the Calendar's own calResidual(). So
  // Last 52 = Σ the Calendar's rows inside the window, and both blocks quote one undated figure.
  function last52Rows(p, tier) {
    var cut = last52Cutoff();
    return calSpine(p).filter(function (r) {
      if (!(r.date && r.date >= cut)) return false;
      return !tier || tier === 'all' || r.tier === tier;
    });
  }
  // Matches the Career record counts that carry no dated match row, under the Tier control: the tier's
  // career total minus that tier's dated rows inside the spine's years. Under 'all' this IS the
  // Calendar's calResidual().undated — the figure its footnote prints.
  function undatedFor(p, tier) {
    if (!tier || tier === 'all') return calResidual(p).undated;
    var tot = careerTierCells(p, tier).total;
    var n = tot ? (tot.won || 0) + (tot.lost || 0) : 0;
    // Only the seasons that carry the tier split count (pre-2021 rows hold the season total alone).
    var win = {};
    spineYears(p).forEach(function (y) { if (tierRowOf(y, tier)) win[String(y.year)] = 1; });
    var dated = calSpine(p).filter(function (r) { return r.tier === tier && win[String(r.year)]; }).length;
    // TEN-384 fx2 item 8 · NOT clamped. A negative count means the dated store holds MORE of this tier's
    // rows than the Career record counts — a reconciliation failure, not "0 undated". It is returned
    // signed so tools/test-ten384-figures-agree.js fails on it; the page prints the note only when > 0.
    return n - dated;
  }
  // TEN-384 fx6 item 1 + fx8 (founder r2, 2026-10-07: "split surfaces with the same field as the season table") ·
  // THE LAST 52 WINDOW FOLLOWS THE SEASON TABLE; the season table is not touched. Its Indoors column is
  // careerByYear's split (API-Tennis's tournament court type, counted per match by the pipeline:
  // bsp-pipeline.js buildAllTierYearly). The dated rows carry no tournament key, so that field cannot be read per
  // match; instead each dated row is classified so that its season's rows reproduce the table's split:
  //   * a season whose careerByYear row carries NO indoor split (Indoors "—": the pipeline counted no indoor
  //     match that season, FAA 2025) splits nothing — every row of that season counts under its surface, as the
  //     table does, whatever the odds archive says;
  //   * a season that carries the split, in this order:
  //       1. the odds archive's per-match Indoor / Outdoor column (calSpine `court`);
  //       2. else the archive court of the SAME event in the same season (a court is a tournament property);
  //       3. else a known event: COURT_KNOWN_INDOOR (Laver Cup, ATP Finals, Next Gen Finals — unpriced, so never
  //          in the archive) / COURT_KNOWN_OUTDOOR (the four Slams, United Cup, ATP Cup);
  //       4. else the season table itself: the indoor W–L the table holds on that surface beyond the rows already
  //          called Indoor must sit among that season's still court-less events of that surface. When exactly ONE
  //          set of whole events makes it up, those are Indoor and the rest Outdoor (zero left over -> all
  //          Outdoor). Several candidate sets, none, or more indoor already than the table holds -> the court
  //          stays unknown (null) and the row counts under its surface.
  // A window that opens mid-season reads that season's rows as classified over the WHOLE season, so the window's
  // rows of season S, per column, are a subset of S's classified rows, which equal the table's S cells less S's
  // undated matches. (fx7 had done the reverse — re-split the season table on this classifier — and was reverted.)
  // Returns an array parallel to calSpine(p): 'Indoor' | 'Outdoor' | null.
  var COURT_KNOWN_INDOOR = [
    { name: 'Laver Cup', re: /\blaver cup\b/i },
    { name: 'ATP Finals', re: /^\s*(atp\s+)?(nitto\s+)?(atp\s+)?(tour\s+)?finals\b/i },
    { name: 'Next Gen Finals', re: /\bnext\s*gen(eration)?\s+(atp\s+)?finals\b/i }
  ];
  var COURT_KNOWN_OUTDOOR = [
    { name: 'Australian Open', re: /^\s*(atp\s+)?australian open\b/i },
    { name: 'Roland Garros', re: /^\s*(atp\s+)?(roland garros|french open)\b/i },
    { name: 'Wimbledon', re: /^\s*(atp\s+)?wimbledon\b/i },
    { name: 'US Open', re: /^\s*(atp\s+)?us open\b/i },
    { name: 'United Cup', re: /^\s*(atp\s+)?united cup\b/i },
    { name: 'ATP Cup', re: /^\s*(atp\s+)?atp cup\b/i }
  ];
  function knownCourtOf(r) {
    var names = [r.event, r.tournament];
    function hit(list) {
      return list.some(function (k) { return names.some(function (n) { return n && k.re.test(String(n)); }); });
    }
    if (hit(COURT_KNOWN_INDOOR)) return 'Indoor';
    if (hit(COURT_KNOWN_OUTDOOR)) return 'Outdoor';
    return null;
  }
  function seasonCourts(p) {
    var sp = calSpine(p);
    var cby = (p && p.careerByYear) || null;
    if (seasonCourts._v === sp && seasonCourts._y === cby) return seasonCourts._c;
    // The season table's indoor split per season; a season absent here splits nothing.
    var seasons = {};
    (cby || []).forEach(function (y) { if (y && y.indoor) seasons[String(y.year)] = y; });
    // TEN-395 · step 0: a row that carries career-history's court flag is placed by it — the table's own per-match
    // count, so the season's flagged rows reproduce its Indoors exactly. Steps 1–4 place only the rows without it
    // (shards built before the flag); `fixed` keeps step 4 off the flagged rows.
    var fixed = sp.map(function (r) { return !!seasons[r.year] && r.seasonIndoor !== null && r.seasonIndoor !== undefined; });
    var courts = sp.map(function (r, i) {
      if (!seasons[r.year]) return null;
      if (fixed[i]) return r.seasonIndoor ? 'Indoor' : 'Outdoor';
      return r.court === 'Indoor' || r.court === 'Outdoor' ? r.court : null;
    });
    var evCourt = {};
    sp.forEach(function (r, i) {
      if (!courts[i] || fixed[i]) return;
      var k = r.year + '|' + r.event;
      evCourt[k] = evCourt[k] === undefined || evCourt[k] === courts[i] ? courts[i] : false;
    });
    sp.forEach(function (r, i) {
      if (courts[i] || !seasons[r.year]) return;
      courts[i] = evCourt[r.year + '|' + r.event] || knownCourtOf(r);
    });
    // Step 4 runs per season, surface AND tier where the season row carries the tier split (every 2021+ row:
    // careerByYear[].atp / .chitf each hold their own indoor record), so a Challenger indoor W–L is matched among
    // that season's Challenger events and an ATP one among its ATP events; the all-tier split is their sum.
    function groupOf(r) {
      var y = seasons[r.year];
      if (!y.atp && !y.chitf) return { k: r.year + '|*|' + r.surface, rec: y.indoor[r.surface] };
      if (r.tier !== 'atp' && r.tier !== 'chitf') return null;
      var t = y[r.tier];
      return { k: r.year + '|' + r.tier + '|' + r.surface, rec: t && t.indoor ? t.indoor[r.surface] : null };
    }
    var groups = {};
    sp.forEach(function (r, i) {
      if (!seasons[r.year] || !r.surface) return;
      var go = groupOf(r);
      if (!go) return;
      var g = groups[go.k] || (groups[go.k] = { rec: go.rec || { won: 0, lost: 0 }, all: [], tw: 0, tl: 0, w: 0, l: 0, ev: {} });
      if (!fixed[i]) g.all.push(i);
      if (r.won) g.tw++; else g.tl++;
      if (courts[i] === 'Indoor') { if (r.won) g.w++; else g.l++; return; }
      if (courts[i]) return;
      var e = g.ev[r.event] || (g.ev[r.event] = { w: 0, l: 0, idx: [] });
      if (r.won) e.w++; else e.l++;
      e.idx.push(i);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], tw = g.rec.won || 0, tl = g.rec.lost || 0;
      // What the table settles outright, over steps 1–3: an indoor record of 0–0 on this surface means no row of
      // it is indoor (the archive or a known-event list notwithstanding); an indoor record equal to the whole
      // surface record means every row is.
      if (!tw && !tl) { g.all.forEach(function (i) { courts[i] = 'Outdoor'; }); return; }
      if (tw === g.tw && tl === g.tl) { g.all.forEach(function (i) { courts[i] = 'Indoor'; }); return; }
      var rw = tw - g.w, rl = tl - g.l;
      var evs = Object.keys(g.ev).map(function (n) { return g.ev[n]; });
      if (!evs.length || rw < 0 || rl < 0) return;
      var force = seasonCourtForce(evs, rw, rl);
      if (!force) return;
      evs.forEach(function (e, j) {
        if (force[j] === null) return;
        e.idx.forEach(function (i) { courts[i] = force[j] ? 'Indoor' : 'Outdoor'; });
      });
    });
    seasonCourts._v = sp; seasonCourts._y = cby; seasonCourts._c = courts;
    return courts;
  }
  // Which events the leftover indoor W–L (rw, rl) forces, as one entry per event: true = in EVERY set of whole
  // events whose W–L sums to it (Indoor), false = in none (Outdoor), null = in some but not all (left unknown).
  // When exactly one set fits, every event is forced (fx6's unique fit). null when no set fits at all.
  function seasonCourtForce(evs, rw, rl) {
    var W = rw + 1, n = evs.length;
    function fits(skip, tw, tl) {
      if (tw < 0 || tl < 0) return false;
      var reach = []; for (var x = 0; x < W * (rl + 1); x++) reach.push(false);
      reach[0] = true;
      for (var k = 0; k < n; k++) {
        if (k === skip) continue;
        var e = evs[k];
        for (var l = tl - e.l; l >= 0; l--) for (var w = tw - e.w; w >= 0; w--) {
          if (reach[l * W + w]) reach[(l + e.l) * W + w + e.w] = true;
        }
      }
      return reach[tl * W + tw];
    }
    if (!fits(-1, rw, rl)) return null;
    return evs.map(function (e, j) {
      var inSome = fits(j, rw - e.w, rl - e.l), outSome = fits(j, rw, rl);
      return inSome && outSome ? null : inSome;
    });
  }
  // The window's surface key for a row and its resolved court: Indoor -> 'indoors', else its surface.
  function last52SurfOf(r, court) {
    if (!r) return null;
    if (court === 'Indoor') return 'indoors';
    return r.surface === 'clay' || r.surface === 'grass' || r.surface === 'hard' ? r.surface : null;
  }
  function last52GridCells(p, tier) {
    if (!careerHistorySettled(p.key) && !calSpine(p).length) return null;
    var cut = last52Cutoff();
    var rows = last52Rows(p, tier);
    var sp = calSpine(p), courts = seasonCourts(p);
    var out = { hard: null, grass: null, clay: null, indoors: null };
    var total = { won: 0, lost: 0 };
    rows.forEach(function (r) {
      var w = r.won ? 1 : 0, l = r.won ? 0 : 1;
      total.won += w; total.lost += l;
      var id = last52SurfOf(r, courts[sp.indexOf(r)]);
      if (!id) return;                       // no surface on record -> the residual
      if (!out[id]) out[id] = { won: 0, lost: 0 };
      out[id].won += w; out[id].lost += l;
    });
    return { cells: out, total: total, n: rows.length, cutoff: cut, undated: undatedFor(p, tier) };
  }
  // A Last-52 drill row, in the drill card's shape, from the same calSpine row the window counted.
  function last52DrillRow(r) {
    return {
      date: r.date, year: r.year, surface: r.surface, event: r.event, round: r.round, opp: r.opp,
      won: r.won, sets: r.sets, setScores: r.score, price: r.price, oppPrice: r.oppPrice,
      retired: r.retired, wo: r.wo, tier: r.tier, src: 'career', sheetId: r.sheetId, m: null
    };
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
    // TEN-391 · the ribbon's list now runs back to its 18th Form row (bsp-pipeline.js capRecentFormMatches), into
    // seasons whose drills read the edition store before. A season drill takes ONE store, and a form store that holds
    // only the tail of such a season would replace its edition rows with a partial list (measured on the deployed
    // roster: 16 player-seasons, Draper 2025 from 39 rows to 3). So the form store answers the seasons it answered
    // before — the current season and the seasons of the 10 most recent matches — with every row it now holds for them.
    var lr = ledgerRows(p), formYears = {};
    formYears[currentYear()] = true;
    lr.slice(-10).forEach(function (x) { formYears[String(x.m.date || '').slice(0, 4)] = true; });
    // 1. recentForm, through the LEDGER's own price join — item 19: one join,
    //    not a second lookup. ledgerRows() is the single place a price is chosen.
    lr.forEach(function (x) {
      var m = x.m;
      if (!formYears[String(m.date || '').slice(0, 4)]) return;
      var ev = String(m.tournament || '') || DASH, rd = roundLabel(m);   // raw feed name: drillKey's contract
      var k = drillKey(String(m.date).slice(0, 4), ev, m.opponent);
      seen[k] = true;
      out.push({
        date: m.date || null, year: String(m.date || '').slice(0, 4),
        surface: m.surface ? String(m.surface).toLowerCase() : null,
        event: eventName(m, p), round: rd, opp: m.opponent || null, won: !!m.won,   // fix item 13: display name
        sets: setsScoreOf(m), setScores: setScoreText(m),
        price: x.price, oppPrice: x.oppPrice, src: 'form', m: m
      });
    });
    // 2. tournamentHistory editions for everything the form window never saw.
    tournHistOf(p).forEach(function (t) {
      (t.editions || []).forEach(function (e) {
        (e.matches || []).forEach(function (mm) {
          if (mm.walkover) return;             // TEN-313: not a match played, so not in the cell either
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
  // `since` is the Last-52 window's cut-off (YYYY-MM-DD). It is the SAME filter
  // last52GridCells() counts with, so a windowed row and its drill card cannot
  // disagree. An undated row can never satisfy it, which is why it is excluded
  // from the count too rather than being listed under a record it is not in.
  function drillRows(p, surf, year, since) {
    // The Last-52 window lists the rows it counted (last52Rows), newest first like the spine.
    if (since) {
      var courts = seasonCourts(p);
      return calSpine(p).filter(function (r, i) {
        if (!(r.date && r.date >= since)) return false;
        if (year && r.year !== String(year)) return false;
        if (!surf) return true;
        return last52SurfOf(r, courts[i]) === surf;
      }).map(last52DrillRow).reverse();
    }
    var src = drillSourceMap(p);
    return drillSpine(p).filter(function (r) {
      if (year && r.year !== String(year)) return false;
      if (since && !(r.date && r.date >= since)) return false;
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
    // TEN-384 · under the Tier control a drill lists the rows that carry that tier; a row whose
    // per-match store holds no tier cannot be placed and is left out (the note's count says so).
    var tierOk = function (r) { return !opts.tier || opts.tier === 'all' || drillRowTier(r) === opts.tier; };
    // fx5 item 2 · a drill whose scope reads tournament-history edition rows (a career drill, or a year the
    // form store does not cover) lists nothing and states nothing while that shard loads — never "no
    // matches in the per-match store" — and paints once when it lands.
    var thPend = !opts.since && tournHistPending(p) && (!opts.year || drillSourceFor(p, opts.year) !== 'form');
    var rows = thPend ? [] : drillRows(p, opts.surf, opts.year, opts.since).filter(tierOk);
    var shown = rows.slice(0, DRILL_PAGE);
    var cellN = (opts.won || 0) + (opts.lost || 0);
    // Rows that are in the store for this scope but carry no surface. Only a
    // SURFACE drill can lose rows to that, so an all-matches drill asks nothing.
    var surfaceless = (opts.surf && opts.surf !== 'indoors')
      ? drillRows(p, null, opts.year, opts.since).filter(tierOk).filter(function (r) { return !r.surface; }).length
      : 0;
    var note = thPend ? '' : drillNote(rows.length, shown.length, cellN, opts.surf, surfaceless);

    var HEAD = [['Date', 'left'], ['', 'left'], ['Opponent', 'left'], ['Rd', 'left'],
                ['Sets', 'left'], ['Set scores', 'left'], ['H', 'right'], ['A', 'right']];
    var GRID = 'display:grid;grid-template-columns:46px 12px minmax(0,1.15fr) 38px 40px ' +
      'minmax(0,1.35fr) 48px 48px;gap:0 10px;align-items:center;';
    var head = HEAD.map(function (h) {
      return '<div style="position:sticky;top:0;background:var(--card);font-family:var(--font-words);' +
        'font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase; font-weight:700;color:var(--text-label);' +
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

    // TEN-384 C6 · the drill is a panel (--card + --edge-6, r11, 15/17), title 14/700, the record mono 12,
    // the note mono 10.5, and a caps CLOSE (Hanken 10.5/700/0.10em — caps labels are never mono).
    return '<div style="grid-column:1 / -1;background:var(--card);' +
      'border:1px solid var(--edge-6);border-radius:11px;' +
      'padding:15px 17px;margin:10px 0 14px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:11px;">' +
        '<div style="font-size:14px;font-weight:700;white-space:nowrap;">' + esc(opts.title) + '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--text-label);' +
          'white-space:nowrap;">' + esc(recordText(opts.won, opts.lost) + ' ' + MIDDOT + ' ' +
          cellN + ' matches') + '</div>' +
        '<div data-pp2-drill-note="1" style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;' +
          'color:var(--text-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' +
          esc(note) + '</div>' +
        '<button type="button" data-pp2="career-drill-close" style="margin-left:auto;background:none;' +
          'border:0;padding:1px 6px;color:var(--text-label);font-family:var(--font-words);font-size:10.5px;' +
          'font-weight:700;letter-spacing:0.10em;text-transform:uppercase;cursor:pointer;flex:none;">Close</button>' +
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
          'padding:9px 0 5px;border-top:1px solid var(--line);">' +
          '<div style="font-size:12.5px;font-weight:700;color:var(--text);white-space:nowrap;">' +
            esc(r.event || DASH) + '</div>' +
          '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:var(--text-label);' +
            'white-space:nowrap;">' + esc(eventMetaOf(r, pg.multiYear)) + '</div></div>';
      }
      var wl = r.won ? 'var(--pos)' : 'var(--neg)';
      // Only a form-sourced row has a match sheet to open — the sheet is keyed on
      // date|opponent and an edition row has no date. §3: do not advertise a click
      // that cannot land.
      var hook = (r.src === 'career' && r.sheetId) ? sheetHook(r.sheetId)
        : (r.src === 'form' && r.date) ? sheetHook(r.date + '|' + (r.opp || '')) : '';
      var cur = hook ? sheetCursor() : '';
      var cell = function (style, txt) {
        return '<div ' + hook + 'style="' + cur + style + '">' + txt + '</div>';
      };
      return grp +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:var(--text-label);padding:5px 0;',
             esc(r.date ? fmtDotDate(r.date) + '.' : DASH)) +
        cell('width:8px;height:8px;border-radius:2px;background:' + wl + ';', '') +
        cell('font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;' +
             'white-space:nowrap;padding:5px 0;', esc(r.opp ? initialSurname(r.opp) : DASH)) +   // fx3 D12: drills read "I. M. Surname"
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);padding:5px 0;',
             esc(r.round || DASH)) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;color:' + wl +
             ';padding:5px 0;', esc(r.sets || DASH)) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:var(--text-label);' +
             'white-space:nowrap;padding:5px 0;', esc(scoreWithStatus(r, r.setScores))) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;color:var(--text);' +
             'text-align:right;padding:5px 0;', oddsText(r.price)) +
        cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:var(--text-label);' +
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

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.2C CAREER RECORD — the RATINGS tab (`Player Stat Boxes.dc.html` :953-1065,
  //        geometry from `profileDNA()` :1255-1322)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The file gives the Career-record modal a two-tab row — `Record | Ratings`
  // (:3306) — and hangs the same `dna` block off BOTH this tab and the Live
  // trading box (:3439). This section is the data layer for it; the Live trading
  // box (item 3) will call the same functions rather than growing a second copy.
  //
  // SOURCE. `dna-apitennis-ratings.json` — TEN-103, api-tennis box scores only,
  // ATP main-tour singles (event_type 265), 2024-03-06 onward, NO Sackmann/TML.
  // 280 rated players of a 428 roster; Elo resolved for 261. Its five radar axes
  // (`_meta.radarAxes`) are EXACTLY the five the file draws — serve, return,
  // underPressure, dominanceRatio, elo — so no axis is invented and none is
  // dropped. The README's "Serve · Return · Pressure · Baseline · Net" loses
  // here, as the file wins everywhere; reported as a README-vs-file difference.
  //
  // The component TILES are the locked formula's own terms, not a new metric set.
  // Return (`_meta.lockedFormulas.return`) is a 4-term sum and the file draws 4;
  // underPressure is a 4-term sum and the file draws 4 — same four, in the file's
  // order. That is why "Break points converted" appears under both Return and
  // Under pressure: one figure, two readings, which is what the file's own
  // footnote says.
  //
  // TWO REPORTED DIFFERENCES ON THE SERVE GROUP, both resolved the file's way:
  //
  //  a. COUNT. The locked serve formula is a SIX-term sum (it includes hold%),
  //     but the file's serve list (:3480-3486) is FIVE tiles and has no hold%
  //     tile. The template's `hint-placeholder-count="6"` is a placeholder hint,
  //     not data — the tile list is authoritative. The file wins, so five tiles
  //     ship and `holdPct` is not drawn here. It is not lost: hold% is the whole
  //     subject of the Live trading hold/break heatmap. Reported, not restored.
  //
  //  b. UNIT. The file's last two serve tiles are "Ace rate" and "Double fault
  //     rate", both carrying a '%'. We do not hold an ace RATE — the locked
  //     formula is explicit that aces and DFs enter "raw per-match", and the
  //     store has `acesPerMatch`/`dfPerMatch` with no service-point denominator
  //     anywhere in it to build a rate from. Printing a per-match count under a
  //     "%" label would be a fabricated unit, which §3 forbids ahead of any
  //     fidelity rule, so the label states what the number is.
  //
  //     RULED 2026-09-19, confirming what shipped: "Relabel as what the store
  //     actually holds: per-match counts, not rates. 'Aces per match' and
  //     'Double faults per match'. No % sign anywhere. Do not synthesise a
  //     service-point denominator to make the export's label true — claim
  //     less, the plain label over the enhanced one."  The deviation from the
  //     export's "Ace rate %" is recorded in .ten206-design/RULED-DECISIONS.md.
  var DNA_AXES = [
    { key: 'serve', label: 'Serve', dp: 0 },
    { key: 'return', label: 'Return', dp: 1 },
    { key: 'underPressure', label: 'Under Pressure', dp: 1 },
    { key: 'dominanceRatio', label: 'Dominance Ratio', dp: 2 },
    { key: 'elo', label: 'Elo Rating', dp: 0 }
  ];
  // The Career modal has no surface control, so the node is the whole-field one.
  // 'All' is the DNA file's own union node, not a surface we picked.
  var DNA_SURFACE = 'All';
  // `_meta.inclusion` already gates the FILE at >10 sinceBase matches; this is the
  // per-scope render floor, the same >=10 the rest of §9 uses.
  var DNA_FLOOR = 10;
  var DNA_TILES = {
    // labels and ORDER are `Player Stat Boxes.dc.html` :3480-3498 verbatim, bar
    // the two unit-corrected serve labels noted above.
    serve: [
      { f: 'firstInPct', label: 'First serve in', dp: 1, unit: '%' },
      { f: 'firstWonPct', label: 'First serve points won', dp: 1, unit: '%' },
      { f: 'secondWonPct', label: 'Second serve points won', dp: 1, unit: '%' },
      { f: 'acesPerMatch', label: 'Aces per match', dp: 1, unit: '' },
      { f: 'dfPerMatch', label: 'Double faults per match', dp: 1, unit: '', lower: true }
    ],
    return: [
      { f: 'ret1stWonPct', label: '1st serve return points won', dp: 1, unit: '%' },
      { f: 'ret2ndWonPct', label: '2nd serve return points won', dp: 1, unit: '%' },
      { f: 'returnGamesWonPct', label: 'Return games won', dp: 1, unit: '%' },
      { f: 'bpConvPct', label: 'Break points converted', dp: 1, unit: '%' }
    ],
    underPressure: [
      { f: 'bpConvPct', label: 'Break points converted', dp: 1, unit: '%' },
      { f: 'bpSavedPct', label: 'Break points saved', dp: 1, unit: '%' },
      { f: 'tbWinPct', label: 'Tie breaks won', dp: 1, unit: '%' },
      { f: 'decWinPct', label: 'Deciding sets won', dp: 1, unit: '%' }
    ]
  };

  function dnaStore() { return window.dnaRatings || null; }
  // The head scope control is the ONE control for this modal (file :3321-3338
  // renders `headScopeTabs`, and sets `dnaScopeOn:false` so the DNA block's own
  // scope tabs are suppressed). 'career' maps to the file's `sinceBase` node.
  function dnaScope() { return state.careerScope === 'l52' ? 'last52' : 'sinceBase'; }
  function dnaRecordFor(p) {
    var st = dnaStore();
    if (!st || !st.byKey) return null;
    return st.byKey[String(p.key)] || null;
  }

  // Tour averages — §3 forbids a rounded constant, so every "Tour" figure on this
  // panel is the MEAN over the rated pool at the same surface and scope, computed
  // here from the file's own player rows. n is carried with it and printed.
  var _dnaTour = {};
  function dnaTourStats(scope) {
    var st = dnaStore();
    if (!st || !st.players) return null;
    if (_dnaTour[scope]) return _dnaTour[scope];
    var acc = {};
    function push(k, v) {
      if (v == null || !isFinite(v)) return;
      (acc[k] || (acc[k] = [])).push(v);
    }
    st.players.forEach(function (row) {
      var sf = row.surfaces && row.surfaces[DNA_SURFACE];
      if (!sf) return;
      var sc = sf[scope] || {};
      DNA_AXES.forEach(function (ax) {
        if (ax.key === 'elo') {
          if (sf.elo && sf.elo.rating != null) push('elo', sf.elo.rating);
          return;
        }
        var node = sc[ax.key];
        if (node && node.rating != null) push(ax.key, node.rating);
        if (node) {
          (DNA_TILES[ax.key] || []).forEach(function (t) {
            push(ax.key + '.' + t.f, node[t.f]);
          });
        }
      });
    });
    var out = {};
    Object.keys(acc).forEach(function (k) {
      var v = acc[k];
      out[k] = { mean: v.reduce(function (a, b) { return a + b; }, 0) / v.length, n: v.length };
    });
    _dnaTour[scope] = out;
    return out;
  }

  // TEN-319 (founder D6): the radar plots a TRUE percentile rank within a stated
  // population (`_meta.pctMethod`); the file publishes each population's sorted
  // values. Ranking by the builder's own rule, 100 × (below + ½·equal) / n, is
  // what lets the TOUR polygon sit at the tour mean's percentile, and a rating the
  // file holds no pct for still land where the builder would have put it.
  function dnaPop(scope, axKey) {
    var st = dnaStore();
    var m = st && st.meta;
    if (!m) return null;
    if (axKey === 'elo') return (m.eloPercentiles && m.eloPercentiles[DNA_SURFACE]) || null;
    var b = m.percentiles && m.percentiles[scope] && m.percentiles[scope][DNA_SURFACE];
    return (b && b[axKey]) || null;
  }
  function dnaPctFromPop(scope, axKey, rating) {
    var p = dnaPop(scope, axKey);
    var vals = p && p.values;
    if (rating == null || !vals || !vals.length) return null;
    var below = 0, equal = 0;
    vals.forEach(function (x) { if (x < rating) below++; else if (x === rating) equal++; });
    return 100 * (below + equal / 2) / vals.length;
  }

  // ── the resolved panel model ──────────────────────────────────────────────
  //
  // Returns null shapes rather than zeros throughout: a missing axis draws no
  // vertex value and dashes its row, per §3. `state` is one of
  //   'no-store'  the JSON has not loaded (a fact about the network)
  //   'unrated'   the player is outside the 280 rated (a fact about him)
  //   'thin'      rated, but under the floor at this scope
  //   'ok'
  function dnaModel(p) {
    var st = dnaStore();
    if (!st) return { state: 'no-store' };
    var rec = dnaRecordFor(p);
    if (!rec) return { state: 'unrated', roster: (st.meta && st.meta.rosterSize) || null,
      rated: (st.meta && st.meta.ratedPlayers) || null };
    var scope = dnaScope();
    var sf = rec.surfaces && rec.surfaces[DNA_SURFACE];
    var sc = (sf && sf[scope]) || {};
    var tour = dnaTourStats(scope) || {};
    var matches = (sc.sample && sc.sample.matches) || 0;

    var axes = DNA_AXES.map(function (ax) {
      var rating = null, pct = null;
      if (ax.key === 'elo') {
        // Elo carries no scope in the file — one rating per surface — so it does
        // not move between Career and Last 52. Said in the note rather than
        // silently drawn as if it had been rescoped.
        rating = (sf && sf.elo && sf.elo.rating != null) ? sf.elo.rating : null;
        pct = rating != null ? dnaPctFromPop(scope, 'elo', rating) : null;
        if (pct == null && sf && sf.elo && sf.elo.pct != null) pct = sf.elo.pct;
      } else {
        var node = sc[ax.key];
        rating = (node && node.rating != null) ? node.rating : null;
        pct = (node && node.pct != null) ? node.pct : dnaPctFromPop(scope, ax.key, rating);
      }
      var t = tour[ax.key] || null;
      var tPct = t ? dnaPctFromPop(scope, ax.key, t.mean) : null;
      return {
        key: ax.key, label: ax.label, dp: ax.dp,
        rating: rating, pct: pct,
        tour: t ? t.mean : null, tourN: t ? t.n : null, tourPct: tPct,
        delta: (rating != null && t) ? rating - t.mean : null,
        scoped: ax.key !== 'elo'
      };
    });
    var drawable = axes.filter(function (a) { return a.pct != null; }).length;
    return {
      state: matches >= DNA_FLOOR && drawable ? 'ok' : (drawable ? 'thin' : 'thin'),
      scope: scope, matches: matches, axes: axes,
      estimated: !!(sc.underPressure && sc.underPressure.estimated),
      sinceBaseMatches: ((sf && sf.sinceBase && sf.sinceBase.sample && sf.sinceBase.sample.matches) || 0),
      latest: rec.latestMatch || null,
      meta: st.meta || {},
      node: sc, tourStats: tour
    };
  }

  // ── geometry, lifted verbatim from `profileDNA()` :1276-1310 ───────────────
  //   cx 168 · cy 132 · R 96 · 72 degrees per axis from -90 · PAD 60 for the
  //   absolutely-positioned labels · web rings 1/0.75/0.5/0.25 · value label at
  //   max(0.3, frac)+0.12 · axis label at 1.14 with the file's three-way shift.
  var DNA_CX = 168, DNA_CY = 132, DNA_R = 96, DNA_PAD = 60;
  function dnaPt(i, frac) {
    var a = (-90 + i * 72) * Math.PI / 180;
    return [DNA_CX + Math.cos(a) * DNA_R * frac, DNA_CY + Math.sin(a) * DNA_R * frac];
  }
  function dnaPoly(fracs) {
    return fracs.map(function (v, i) {
      return dnaPt(i, v).map(function (n) { return n.toFixed(1); }).join(',');
    }).join(' ');
  }
  function dnaFmt(v, dp) {
    if (v == null) return DASH;
    return dp === 0 ? String(Math.round(v)) : (+v).toFixed(dp);
  }

  // ── the `Record | Ratings` tab row (`Player Stat Boxes.dc.html` :80-86) ────
  //   Wrapper: flex gap 3 · var(--inner) · 1px color-mix(in srgb, var(--text) 9%, transparent) · radius 10 ·
  //   padding 3 · margin-bottom 18 · width fit-content.
  //   Seg: padding 7/14 · radius 8 · 12px · 700/600 · var(--text) / var(--text-label) ·
  //   color-mix(in srgb, var(--bar) 16%, transparent) / transparent · color-mix(in srgb, var(--bar) 40%, transparent) /
  //   color-mix(in srgb, var(--text) 8%, transparent).
  //   Note the borders differ from the HEAD control's (:68), which drops to
  //   radius 9/7 and 11px — two different segmented controls, not one reused.
  var CAREER_TABS = [['record', 'Record'], ['ratings', 'Ratings']];
  // TEN-384 C1 · the Career record's first row, as the reference draws it: Record | Ratings on the tab
  // track at the left; caps WINDOW + Career | Last 52 and (Record tab only) caps TIER + All | ATP |
  // Challenger & ITF on small tracks at the right. The window used to sit in the modal header; the shell
  // no longer carries it. One window drives both tabs (the radar's scope under Ratings).
  function careerTabsHtml() {
    var tab = state.careerTab === 'ratings' ? 'ratings' : 'record';
    var tabs = recSegTrack(CAREER_TABS.map(function (t) {
      return recSegBtn('career-tab', t[0], t[1], tab === t[0], false);
    }).join(''), false);
    var right = headScopeHtml();
    if (tab === 'record') {
      right += recLabelledSeg('Tier', CAREER_TIERS.map(function (t) {
        return recSegBtn('career-tier', t[0], t[1], careerTier() === t[0], true);
      }).join(''));
    }
    return recTabRow(tabs, right);
  }

  // ── the WINDOW control, `Career | Last 52` — now in the tab row (TEN-384) ──
  function headScopeHtml() {
    return recLabelledSeg('Window', [['career', 'Career'], ['l52', 'Last 52']].map(function (t) {
      var on = (state.careerScope === 'l52' ? 'l52' : 'career') === t[0];
      return recSegBtn('career-scope', t[0], t[1], on, true, ' data-scope="' + t[0] + '"');
    }).join(''));
  }
  // ── the TIER control (TEN-384 C1) — the Match analysis Overview's tier handling (`cellForTier`,
  // OV_TIERS, OV_NO_SPLIT in the dashboard) applied to this player's careerByYear rows. 'all' reads a
  // row's all-tier figures; 'atp' / 'chitf' its tier split. A pre-2021 aggregate row carries no split,
  // so it dashes under ATP and Challenger & ITF with the Overview's own reason on hover — never an
  // invented split.
  var CAREER_TIERS = [['all', 'All'], ['atp', 'ATP'], ['chitf', 'Challenger & ITF']];
  var CAREER_NO_SPLIT = 'No tier split for this season: before 2021 we hold the season total only (All).';
  function careerTier() {
    return state.careerTier === 'atp' || state.careerTier === 'chitf' ? state.careerTier : 'all';
  }
  function careerTierWord(t) {
    return t === 'atp' ? 'ATP' : t === 'chitf' ? 'Challenger & ITF' : 'all tiers';
  }
  /** The row a tier reads (same shape as a careerByYear row), or null when the row holds no split. */
  function tierRowOf(y, tier) {
    if (!tier || tier === 'all') return y;
    var t = y && y[tier];
    if (!t) return null;
    return { year: y.year, total: t.total || null, clay: t.clay || null, hard: t.hard || null,
      grass: t.grass || null, indoor: t.indoor || null };
  }
  /** Carved season cells for a tier; every cell null where the row holds no split for it. */
  function tierGridCells(y, tier) {
    var r = tierRowOf(y, tier);
    if (!r) return { total: null, clay: null, hard: null, grass: null, indoors: null, noSplit: true };
    return gridCells(r);
  }
  /** Career footer cells for a tier: the same carve-out summed over the rows that carry the tier. */
  function careerTierCells(p, tier) {
    var out = { total: null, clay: null, hard: null, grass: null, indoors: null };
    var add = function (acc, r) {
      if (!r) return acc;
      if (!acc) return { won: r.won || 0, lost: r.lost || 0 };
      return { won: acc.won + (r.won || 0), lost: acc.lost + (r.lost || 0) };
    };
    spineYears(p).forEach(function (y) {
      var g = tierGridCells(y, tier);
      ['total', 'clay', 'hard', 'grass', 'indoors'].forEach(function (k) { out[k] = add(out[k], g[k]); });
    });
    return out;
  }
  /** A drill row's tier: 'atp' / 'chitf' where the per-match row carries one, else null (unknown). */
  function drillRowTier(r) {
    if (r && r.src === 'career') return r.tier || null;
    var t = r && r.m && r.m.tier ? String(r.m.tier).toLowerCase() : null;
    if (!t) return null;
    return t === 'atp' ? 'atp' : 'chitf';
  }

  // ── the tiles (`metric()` :2251-2263 verbatim, with the null branch kept) ──
  var DNA_GREEN = 'var(--pos)', DNA_RED = 'var(--neg)', DNA_FAINT = 'var(--text-label)';
  function dnaTile(spec, v, avg) {
    var unit = spec.unit || '';
    if (v == null || avg == null) {
      return { label: spec.label, value: DASH, delta: DASH,
        avg: avg == null ? DASH : dnaFmt(avg, spec.dp) + unit,
        color: DNA_FAINT, deltaColor: DNA_FAINT, weight: 600,
        bd: 'color-mix(in srgb, var(--text) 4.5%, transparent)', mark: spec.lower ? '↓ better' : '' };
    }
    var d = v - avg;
    var above = spec.lower ? d < 0 : d > 0;
    var level = Math.abs(d) < 0.15;
    return {
      label: spec.label,
      value: (+v).toFixed(1) + unit,
      delta: (d >= 0 ? '+' : MINUS) + Math.abs(d).toFixed(1),
      avg: (+avg).toFixed(1) + unit,
      color: 'var(--text)',
      deltaColor: level ? 'var(--text-label)' : (above ? DNA_GREEN : DNA_RED),
      weight: 700,
      mark: spec.lower ? '↓ better' : '',
      bd: 'color-mix(in srgb, var(--text) 4.5%, transparent)'
    };
  }
  function dnaTileHtml(t) {
    // TEN-384 R5 · a stat box inside the modal = --card + 1px --edge-6 (was --inner + 4.5%).
    return '<div style="background:var(--card);border:1px solid var(--edge-6);border-radius:10px;' +
      'padding:14px 15px;display:flex;flex-direction:column;align-items:center;text-align:center;">' +
      '<div style="display:flex;align-items:baseline;justify-content:center;gap:8px;">' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:21px;font-weight:' + t.weight +
          ';color:' + t.color + ';">' + esc(t.value) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;' +
          'color:' + t.deltaColor + ';">' + esc(t.delta) + '</span>' +
      '</div>' +
      '<div style="font-size:12.5px;font-weight:600;color:var(--text-soft);margin-top:6px;">' + esc(t.label) + '</div>' +
      '<div style="display:flex;align-items:baseline;justify-content:center;gap:8px;margin-top:4px;">' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:var(--text-label);">' +
          'tour average ' + esc(t.avg) + '</span>' +
        '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
          'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">' + esc(t.mark) + '</span>' +
      '</div>' +
    '</div>';
  }
  function dnaGroupHtml(label, tiles, first) {
    return '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);margin:' +
      (first ? '0 0 11px' : '22px 0 11px') + ';">' + esc(label) + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(216px,1fr));gap:10px;">' +
      tiles.map(dnaTileHtml).join('') + '</div>';
  }

  // ── §5.2C the rendered panel ──────────────────────────────────────────────
  function renderRatingsPanel(p) {
    var m = dnaModel(p);
    var sn = shortName(p);
    function stateBox(msg) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:' + DASH_COLOUR + ';line-height:1.6;">' + msg + '</div>';
    }
    if (m.state === 'no-store') {
      // Not loaded is not the same statement as not rated. §3.
      return stateBox('Ratings have not loaded.');
    }
    if (m.state === 'unrated') {
      return stateBox(esc(sn) + ' is not in the rated pool, so no rating can be shown.' +
        (m.rated && m.roster
          ? '<br>The ratings cover ' + m.rated + ' players of the ' + m.roster + '-player roster — ' +
            'entry needs more than 10 matches in the api-tennis box-score cache.'
          : ''));
    }

    var scopeWord = m.scope === 'last52' ? 'Last 52 weeks' : 'Career';
    var axes = m.axes;

    // The radar draws only where the axis HAS a percentile; a missing axis
    // collapses to the centre on the file's geometry, which would read as "worst
    // on tour". Those axes are dropped from the polygon and dashed in the table
    // instead, and the note says how many.
    var missing = axes.filter(function (a) { return a.pct == null; });
    var playerPoly = dnaPoly(axes.map(function (a) { return a.pct == null ? 0 : a.pct / 100; }));
    // ★ DEVIATION, REPORTED — the file draws the tour polygon at a FLAT 0.5 ring
    //   (:1292 `poly(AX.map(() => 0.5))`). Our percentile scale is p2->0/p98->100
    //   over the rated pool, on which the tour MEAN does not land on 0.5: measured
    //   on the All node it runs 43.1 (dominance ratio, career) to 57.7 (under
    //   pressure, last 52). Drawing the flat ring would put a player who is exactly
    //   average on dominance ratio OUTSIDE the "tour average" polygon. So the ring
    //   is drawn at each axis's true tour-mean percentile and the deviation is in
    //   the report for the founder to rule on.
    var tourPoly = dnaPoly(axes.map(function (a) {
      return a.tourPct == null ? 0.5 : a.tourPct / 100;
    }));
    var web = [1, 0.75, 0.5, 0.25].map(function (k) {
      return '<polygon points="' + dnaPoly(axes.map(function () { return k; })) + '" fill="none" ' +
        'stroke="var(--edge-6)" stroke-width="1"></polygon>';
    }).join('');
    var spokes = axes.map(function (a, i) {
      var xy = dnaPt(i, 1);
      return '<line x1="' + DNA_CX + '" y1="' + DNA_CY + '" x2="' + xy[0].toFixed(1) + '" y2="' +
        xy[1].toFixed(1) + '" stroke="var(--edge-6)" stroke-width="1"></line>';
    }).join('');
    var valueLabels = axes.map(function (a, i) {
      if (a.pct == null) return '';
      // TEN-384 R3 · the chip sits on the vertex, as the reference draws it, held inside 0.82 of the
      // radius so a near-100th-percentile vertex cannot push it into the axis label at 1.14.
      var xy = dnaPt(i, Math.min(0.82, Math.max(0.3, a.pct / 100)));
      return '<span style="position:absolute;left:' + (xy[0] + DNA_PAD).toFixed(1) + 'px;top:' +
        xy[1].toFixed(1) + 'px;transform:translate(-50%,-50%);font-family:\'IBM Plex Mono\',monospace;' +
        'font-size:10.5px;font-weight:700;color:var(--text);background:color-mix(in srgb, var(--page) 85%, transparent);padding:1px 4px;' +
        'border-radius:4px;white-space:nowrap;z-index:2;">' + esc(dnaFmt(a.rating, a.dp)) + '</span>';
    }).join('');
    var axisLabels = axes.map(function (a, i) {
      var xy = dnaPt(i, 1.14);
      var shift = i === 0 ? 'translate(-50%,-130%)'
        : xy[0] > DNA_CX + 4 ? 'translate(8px,-50%)'
        : xy[0] < DNA_CX - 4 ? 'translate(-100%,-50%) translateX(-8px)' : 'translate(-50%,20%)';
      return '<span style="position:absolute;left:' + (xy[0] + DNA_PAD).toFixed(1) + 'px;top:' +
        xy[1].toFixed(1) + 'px;transform:' + shift + ';font-family:var(--font-words);' +
        'font-size:10.5px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);' +
        'white-space:nowrap;">' + esc(a.label) + '</span>';
    }).join('');

    var HEADCELL = 'font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);';
    var CELL = 'padding:7px 0;border-top:1px solid var(--line);';
    var rows = axes.map(function (a) {
      // The file's own "level" band, scaled by the axis's decimal place (:1315).
      var lvl = a.delta != null && Math.abs(a.delta) < (a.dp === 2 ? 0.02 : 0.5);
      var deltaTxt = a.delta == null ? DASH
        : lvl ? DASH
        : (a.delta > 0 ? '+' : MINUS) + dnaFmt(Math.abs(a.delta), a.dp);
      var deltaCol = (a.delta == null || lvl) ? 'var(--text-label)' : (a.delta > 0 ? DNA_GREEN : DNA_RED);
      return '<span style="font-size:12px;color:var(--text-label);' + CELL + '">' + esc(a.label) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:400;' +
          'color:' + (a.rating == null ? DASH_COLOUR : 'var(--text)') + ';text-align:right;' + CELL + '">' +
          esc(dnaFmt(a.rating, a.dp)) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;' +
          'color:' + deltaCol + ';text-align:right;' + CELL + '">' + esc(deltaTxt) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:400;' +
          'color:var(--text-label);text-align:right;' + CELL + '">' + esc(dnaFmt(a.tour, a.dp)) + '</span>';
    }).join('');

    var tourN = (axes[0] && axes[0].tourN) || null;
    // Every clause here is a measured fact about THIS panel, not boilerplate: the
    // window, the pool the average is taken over, what Elo does not do, and what
    // is missing. §3 forbids a rounded constant; this is what replaces it.
    //
    // ── FOUNDER RULING 2026-09-19 · what "tour" means, in plain words ─────────
    // "Compute it over the … rated players and SAY SO on the page, in the
    //  footnote, in plain words: the average of the N players we rate, not the
    //  ATP field. State the real N at render time, not … hardcoded."
    //
    // This clause previously read "percentile vs the ATP field", which is the
    // claim the ruling forbids: the pool is the players carrying a DNA row, not
    // the tour. `tourN` is counted in dnaTourStats() by walking the live store
    // every render, so it moves as the store grows and is never a constant.
    // The TOUR column header and the tiles' "tour average X" line have no room
    // for the caveat, so the footnote below carries it for them.
    var note = scopeWord +
      (tourN ? ' ' + MIDDOT + ' tour figures are the average of the ' + tourN +
        ' players we rate, not the ATP field' : '') +
      ' ' + MIDDOT + ' Δ is his figure minus that average, in rating points';
    var foot = 'Ratings rest on ' + m.matches + ' match' + (m.matches === 1 ? '' : 'es') +
      ' with api-tennis box scores in this window' +
      (m.meta && m.meta.source ? ', ATP main-tour singles from 2024-03-06' : '') + '. ' +
      'Elo carries no window, so it reads the same under Career and Last 52. ' +
      'The delta carries the sign colour; a downward marker means lower is better. ' +
      'Break points converted appears in both Return and Under pressure — one figure, two ' +
      'readings. Anything not held reads as a dash. ' +
      // RULED 2026-09-19: the TOUR column head and each tile's "tour average X"
      // line have no room for the caveat, so it is carried here, in plain words.
      (tourN ? 'Every "tour" figure on this panel — the column, the tile lines and the '
        + 'dashed polygon — is the average of the ' + tourN + ' players we hold a rating '
        + 'for, not the ATP field. That count is read from the store at render time and '
        + 'grows as the store does. ' : '') +
      (m.estimated ? ' Under pressure is estimated from three of its four terms.' : '') +
      (missing.length ? ' ' + missing.length + ' of the five axes ' +
        (missing.length === 1 ? 'has' : 'have') + ' no rating in this window and ' +
        (missing.length === 1 ? 'is' : 'are') + ' left off the shape.' : '');

    var thin = m.state === 'thin';
    var shape = thin
      ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
          'text-align:center;font-size:12.5px;color:' + DASH_COLOUR + ';line-height:1.6;padding:0 40px;">' +
          m.matches + ' match' + (m.matches === 1 ? '' : 'es') + ' in this window — under the ' +
          DNA_FLOOR + '-match floor, so no shape is drawn.</div>'
      : axisLabels + valueLabels +
        '<svg width="336" height="272" viewBox="0 0 336 272" fill="none" ' +
          'style="display:block;position:absolute;left:60px;top:0;">' + web + spokes +
          // TEN-384 R2 · tour polygon white dashed 5 4 (as the reference); the player's shape is a
          // --bar line with no area fill (decisions §2 — no area fill on profile charts).
          '<polygon points="' + tourPoly + '" fill="none" stroke="var(--text)" stroke-width="1.6" ' +
            'stroke-dasharray="5 4"></polygon>' +
          '<polygon points="' + playerPoly + '" fill="none" stroke="var(--bar)" ' +
            'stroke-width="1.8"></polygon>' +
        '</svg>';

    var tiles = '';
    var node = m.node || {};
    var ts = m.tourStats || {};
    ['serve', 'return', 'underPressure'].forEach(function (ax, gi) {
      var label = ax === 'serve' ? 'Serve' : ax === 'return' ? 'Return' : 'Under pressure';
      var src = node[ax] || {};
      var list = DNA_TILES[ax].map(function (spec) {
        var t = ts[ax + '.' + spec.f];
        return dnaTile(spec, src[spec.f] == null ? null : src[spec.f], t ? t.mean : null);
      });
      tiles += dnaGroupHtml(label, list, gi === 0);
    });

    return '' +
      // TEN-384 R1 · the DNA panel = --card + --edge-6 (a panel inside the modal), r12, 18/20/16.
      '<div style="background:var(--card);border:1px solid var(--edge-6);border-radius:12px;' +
        'padding:18px 20px 16px;margin-bottom:20px;display:flex;flex-direction:column;gap:14px;">' +
        '<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;">' +
          '<span style="' + HEADCELL + '">Player DNA</span>' +
          '<span style="display:flex;align-items:center;gap:14px;margin-left:auto;">' +
            '<span style="display:flex;align-items:center;gap:6px;">' +
              '<span style="width:14px;height:2px;background:var(--bar);"></span>' +
              '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
                'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">' + esc(sn) + '</span>' +
            '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;">' +
              '<span style="width:14px;height:0;border-top:2px dashed var(--text);"></span>' +
              '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
                'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">Tour average</span>' +
            '</span>' +
          '</span>' +
        '</div>' +
        '<div style="position:relative;width:456px;max-width:100%;height:272px;margin:0 auto;">' +
          shape + '</div>' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) 74px 70px 62px;gap:0 12px;' +
          'align-items:center;border-top:1px solid var(--line);padding-top:10px;">' +
          '<span style="' + HEADCELL + '">Raw rating</span>' +
          '<span style="' + HEADCELL + 'text-align:right;">Player</span>' +
          '<span style="' + HEADCELL + 'text-align:right;">Δ vs tour</span>' +
          '<span style="' + HEADCELL + 'text-align:right;">Tour</span>' +
          rows +
        '</div>' +
        '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
          'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">' + esc(note) + '</div>' +
      '</div>' +
      tiles +
      '<div style="font-size:12px;color:var(--text-label);margin-top:16px;line-height:1.6;">' + esc(foot) + '</div>';
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
    // §5.2C item 5 — the file's `Record | Ratings` tab row. Under Ratings the record body is replaced by the
    // ratings panel, not stacked under it. TEN-384: the tab row also carries the Window (and, on Record,
    // the Tier) controls.
    if (state.careerTab === 'ratings') return careerTabsHtml() + renderRatingsPanel(p);

    var isL52 = state.careerScope === 'l52';
    var tier = careerTier();
    var tierWord = careerTierWord(tier);

    // ── the card's cells: the carved cells, so a row cannot disagree with its column ──
    var cells, total, l52 = null;
    if (isL52) {
      l52 = last52GridCells(p, tier);
      if (!l52) {
        // The dated store has not answered. Saying "0 matches" here would be a
        // claim about the player made from a fact about the network.
        return careerTabsHtml() +
          '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
            'text-align:center;font-size:13px;color:' + DASH_COLOUR + ';">' +
            (careerHistorySettled(p.key)
              ? 'No dated matches on record, so the last 52 weeks cannot be carved.'
              : 'The dated match store has not loaded.') + '</div>';
      }
      cells = l52.cells;
      total = l52.total;
    } else {
      var ctc = careerTierCells(p, tier);
      cells = { hard: ctc.hard, clay: ctc.clay, grass: ctc.grass, indoors: ctc.indoors };
      total = ctc.total || { won: 0, lost: 0 };
    }
    // The residual: whatever the carved rows do not account for (stated, never a row).
    var sw = 0, sl = 0;
    CAREER_ROWS.forEach(function (s) {
      var c = cells[s.id];
      if (c) { sw += c.won || 0; sl += c.lost || 0; }
    });
    var resid = { won: (total.won || 0) - sw, lost: (total.lost || 0) - sl };
    var residN = resid.won + resid.lost;
    var tn = (total.won || 0) + (total.lost || 0);
    var allRate = tn ? 100 * total.won / tn : null;

    // ── TEN-384 C2-C5 · the Match analysis Overview career card, profile variant ──
    // Read from the dashboard's ovColumnHtml (hero: mono 31/800 record, 14/700 rate, caps scope word; D2
    // gate on the rate) and built here in the reference's profile form: no name row and no tier segment
    // inside the card (both live in the tab row), and a Hard · Clay · Grass · Indoors table with W–L,
    // Win % and vs all. Gate (README §9 / D2): n ≥ 10 full; 5–9 grey + "small sample · n=X"; 1–4 the
    // W–L alone, no rate, no bar fill, the row does not open; 0 a dash.
    var heroRate = '';
    var hg = gateFor(tn);
    if (hg === GATE.FULL || hg === GATE.SMALL) {
      heroRate = '<span style="font-size:14px;font-weight:700;color:' +
        (hg === GATE.FULL ? 'var(--text)' : 'var(--text-label)') + ';"' +
        (hg === GATE.SMALL ? ' title="' + smallSampleText(tn) + '"' : '') + '>' +
        allRate.toFixed(1) + '%</span>';
      // fx4 item 6 (founder D11): with a 5–9 career the mark goes UNDER the rate, not beside it — a column
      // whose first line is the rate, so the rate keeps the hero's baseline and the mark takes a second line.
      if (hg === GATE.SMALL) {
        heroRate = '<span data-pp2-ratemark="' + tn + '" style="display:inline-flex;flex-direction:column;' +
          'align-items:flex-start;gap:2px;">' + heroRate + smallSampleHtml(tn) + '</span>';
      }
    }
    var scopeCaps = isL52 ? 'Last 52 weeks' : 'Career';
    var hero = '<div style="display:flex;align-items:baseline;gap:12px;">' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:31px;font-weight:800;line-height:31px;' +
        'letter-spacing:-0.62px;white-space:nowrap;color:' + (tn ? 'var(--text)' : DASH_COLOUR) + ';">' +
        (tn ? recordText(total.won, total.lost) : DASH) + '</span>' + heroRate +
      recCaps(scopeCaps) +
      '<span style="margin-left:auto;font-family:\'IBM Plex Mono\',monospace;font-size:12px;' +
        'color:var(--text-label);white-space:nowrap;">' + (tn ? tn.toLocaleString('en-US') + ' matches' : DASH) +
      '</span></div>';

    var SGRID = 'display:grid;grid-template-columns:64px minmax(0,1fr) 64px 60px 68px;gap:0 14px;' +
      'align-items:center;margin-top:20px;';
    var SHEAD = 'font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
      'text-transform:uppercase;color:var(--text-label);padding:0 0 8px;border-bottom:1px solid var(--line);';
    var shead = [['Surface', 'left'], ['Wins ' + MIDDOT + ' losses', 'left'], ['W' + ENDASH + 'L', 'right'],
      ['Win %', 'right'], ['vs all', 'right']].map(function (h) {
        return '<span style="' + SHEAD + 'text-align:' + h[1] + ';">' + h[0] + '</span>';
      }).join('');
    var srows = CAREER_ROWS.map(function (s) {
      var c = cells[s.id];
      var noIndoor = s.id === 'indoors' && !isL52 && c === null;
      var w = (c && !noIndoor) ? (c.won || 0) : 0, l = (c && !noIndoor) ? (c.lost || 0) : 0, n = w + l;
      var g = gateFor(n);
      var rated = g === GATE.FULL || g === GATE.SMALL;
      var pct = n ? 100 * w / n : null;
      var open = state.careerDrill && state.careerDrill.kind === 'surface' && state.careerDrill.surf === s.id;
      var can = rated;
      var why = noIndoor
        ? 'No court type on record'
        : (n && !rated ? n + ' match' + (n === 1 ? '' : 'es') + ' ' + MIDDOT + ' under the five-match minimum'
          : (g === GATE.SMALL ? smallSampleText(n) : ''));
      var fill = barFillColour(n);
      var vs = (rated && allRate != null) ? pct - allRate : null;
      var lift = open ? 'background:var(--selected);' : '';
      // fx3 (D11): a 5–9 row's cells stretch, so they stay level on the first line and the mark sits under the rate.
      var cellBase = 'padding:11px 0;border-bottom:1px solid var(--line);' + lift +
        (g === GATE.SMALL ? 'align-self:stretch;' : '');
      var shadow = function (first, last) {
        return open ? 'box-shadow:' + (first ? '-10px' : '-7px') + ' 0 0 0 var(--selected),' +
          (last ? '10px' : '7px') + ' 0 0 0 var(--selected);' : '';
      };
      var attrs = can ? ' data-pp2="career-surf" data-v="' + s.id + '"' : '';
      var cur = can ? 'cursor:pointer;' : '';
      var tip = why ? ' title="' + esc(why) + '"' : '';
      return '<span' + attrs + tip + ' data-pp2-srow="' + s.id + '" style="' + cellBase + shadow(true, false) + cur +
          'font-size:12.5px;color:' + (n || !noIndoor ? 'var(--text)' : 'var(--text-label)') + ';">' + esc(s.label) + '</span>' +
        '<span' + attrs + tip + ' style="' + cellBase + shadow(false, false) + cur + 'display:flex;align-self:stretch;' +
          (g === GATE.SMALL ? 'align-items:flex-start;padding-top:16px;' : 'align-items:center;') + '">' +
          '<span style="display:block;flex:1;height:6px;border-radius:3px;background:var(--track);overflow:hidden;">' +
            (fill && pct != null ? '<span style="display:block;height:6px;width:' + pct.toFixed(1) + '%;background:' +
              fill + ';"></span>' : '') + '</span></span>' +
        '<span' + attrs + tip + ' style="' + cellBase + shadow(false, false) + cur + 'text-align:right;' +
          'font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;color:var(--text-label);white-space:nowrap;">' +
          (n ? recordText(w, l) : DASH) + '</span>' +
        '<span' + attrs + tip + ' style="' + cellBase + shadow(false, false) + cur + 'text-align:right;' +
          'font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;white-space:nowrap;color:' +
          (g === GATE.FULL ? 'var(--text)' : 'var(--text-label)') + ';">' +
          (g === GATE.SMALL ? rateOverMark(pct.toFixed(1) + '%', n) : rated ? pct.toFixed(1) + '%' : DASH) + '</span>' +
        '<span' + attrs + tip + ' style="' + cellBase + shadow(false, true) + cur + 'text-align:right;' +
          'font-family:\'IBM Plex Mono\',monospace;font-size:12.5px;font-weight:700;white-space:nowrap;color:' +
          (vs == null || g !== GATE.FULL ? 'var(--text-label)'
            : vs > 0.05 ? 'var(--pos)' : vs < -0.05 ? 'var(--neg)' : 'var(--text-label)') + ';">' +
          (vs == null ? DASH : signed(vs, 1, 'pp')) + '</span>';
    }).join('');

    // fx3 (D11): no small-sample footnote line — the mark sits under the rate in the row itself.
    var noteBits = ['vs all = surface win rate minus the all-surface rate ' + MIDDOT + ' click a surface for its matches'];
    if (residN > 0) {
      noteBits.push('<span title="The gap between the provider’s season total and its own surface buckets, ' +
        'so no individual match carries a surface to look up.">' + residN + ' match' + (residN === 1 ? '' : 'es') +
        ' with no surface on record</span>');
    }
    if (isL52) {
      // The undated figure is the Calendar's own (calResidual) — one number for both blocks.
      noteBits.push(l52.n + ' dated match' + (l52.n === 1 ? '' : 'es') + ' since ' + esc(l52.cutoff) +
        ', the Calendar record’s rows inside the window' +
        (l52.undated > 0 ? ' ' + MIDDOT + ' ' + l52.undated + (l52.undated === 1 ? ' match carries' : ' matches carry') +
          ' no dated match row, so the window cannot place ' + (l52.undated === 1 ? 'it' : 'them') : ''));
    }
    var card = recPanel(
      recCaps(esc(scopeCaps + ' ' + (isL52 ? '' : 'record ') + MIDDOT + ' ' + tierWord).replace(/ {2}/g, ' '),
        'display:block;margin-bottom:12px;') +
      hero +
      '<div style="' + SGRID + '">' + shead + srows + '</div>' +
      '<div style="font-size:11px;color:var(--text-label);margin-top:12px;line-height:1.5;">' +
        noteBits.join(' ' + MIDDOT + ' ') + '</div>',
      'top', '22px 24px 24px');

    // ── C7 / C8 · Record by season — a joined panel under the card ─────────────
    var years = spineYears(p).slice().sort(function (a, b) {
      return String(b.year) < String(a.year) ? -1 : 1;
    });
    var ic = indoorCoverage(p);
    var indoorTip = !ic.rows ? '' : !ic.withCourt
      ? 'Indoors is a court type carved out of the surface rows and columns, so Hard, Clay and Grass here are ' +
        'outdoor only. No season on record carries court type yet, so it reads as a dash throughout.'
      : 'Indoors is a court type carved out of the surface rows and columns, so Hard, Clay and Grass here are ' +
        'outdoor only and the five columns still sum to the total. Court type reaches ' + ic.withCourt + ' of ' +
        ic.rows + ' seasons' + (ic.withCourt < ic.rows
          ? '; the older rows come from a season aggregate that carries none, and dash rather than reading ' +
            'as no indoor matches played' : '') + '.';
    var HEADS = [
      { label: 'Year', id: null },
      { label: 'Total', id: 'total' },
      { label: 'Clay', id: 'clay' },
      { label: 'Hard', id: 'hard' },
      { label: 'Indoors', id: 'indoors' },
      { label: 'Grass', id: 'grass' }
    ];
    var head = HEADS.map(function (h, i) {
      return '<div' + (h.id === 'indoors' && indoorTip ? ' title="' + esc(indoorTip) + '"' : '') +
        ' style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
        'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);' +
        'padding-bottom:11px;' + (i ? 'text-align:right;' : '') + '">' + h.label + '</div>';
    }).join('');

    // ── EVERY RECORD CLICKABLE (founder 2026-09-17, items 1 and 2) ────────────
    // A dash is inert and every cell that carries a record opens, however small: a list of 2 matches
    // is just those 2 matches. The n ≥ 5 gate lives where the claim is (the rate and the bar).
    function cellCan(rec) { return !!rec && ((rec.won || 0) + (rec.lost || 0)) > 0; }
    function cellAttrs(can, v) {
      return can ? ' class="pp2-crec" data-pp2="career-cell" data-v="' + esc(v) + '"' : '';
    }
    function drillTitleFor(surfId, scopeLabel) {
      var lab = surfId
        ? HEADS.filter(function (h) { return h.id === surfId; })[0].label
        : 'All matches';
      return lab + ' ' + MIDDOT + ' ' + scopeLabel;
    }
    function drillFor(scope, surfId, rec, scopeLabel) {
      return renderDrill(p, {
        surf: surfId, year: scope === 'career' ? null : scope, span: true, tier: tier,
        title: drillTitleFor(surfId, scopeLabel),
        won: rec ? rec.won || 0 : 0, lost: rec ? rec.lost || 0 : 0
      });
    }
    var MONO = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;';
    var body = years.map(function (y) {
      var g = tierGridCells(y, tier);
      var yearStr = String(y.year);
      var openCell = state.careerDrill && state.careerDrill.kind === 'cell' &&
        state.careerDrill.year === yearStr ? state.careerDrill.surf : null;
      var yearCan = cellCan(g.total);
      var cellsHtml = HEADS.slice(1).map(function (h) {
        var r = g[h.id];
        var txt = r ? (r.won || 0) + '/' + (r.lost || 0) : DASH;
        var can = cellCan(r);
        var on = openCell === (h.id === 'total' ? '' : h.id);
        var isTot = h.id === 'total';
        return '<div' + cellAttrs(can, yearStr + '|' + (isTot ? '' : h.id)) +
          (g.noSplit ? ' title="' + esc(CAREER_NO_SPLIT) + '"' : '') +
          ' style="' + MONO + 'font-size:' + (isTot ? 14 : 13) + 'px;font-weight:' + (isTot ? 700 : 600) + ';' +
          'letter-spacing:' + (isTot ? '-0.14px' : '-0.13px') + ';text-align:right;' +
          'padding:11px 0;border-top:1px solid var(--line);' +
          'color:' + (!r ? DIM_COLOUR : isTot || on ? 'var(--text)' : 'var(--text-soft)') + ';' +
          (can ? 'cursor:pointer;' : '') + '">' + txt + '</div>';
      }).join('');
      var drill = '';
      if (openCell !== null) {
        var surf = openCell || null;
        drill = drillFor(yearStr, surf, surf ? g[surf] : g.total, yearStr);
      }
      // 1a — the YEAR label opens the same drill as its Total cell.
      return '<div' + cellAttrs(yearCan, yearStr + '|') +
        ' style="' + MONO + 'font-size:13px;font-weight:700;' +
        'letter-spacing:0.26px;padding:11px 0;border-top:1px solid var(--line);' +
        'color:' + (yearCan ? 'var(--text)' : DIM_COLOUR) + ';' + (yearCan ? 'cursor:pointer;' : '') + '">' +
        esc(yearStr) + '</div>' + cellsHtml + drill;
    }).join('');

    var cf = careerTierCells(p, tier);
    // ── item 2 — the CAREER row opens too ─────────────────────────────────────
    var openCareerCell = state.careerDrill && state.careerDrill.kind === 'cell' &&
      state.careerDrill.year === 'career' ? state.careerDrill.surf : null;
    var careerCan = cellCan(cf.total);
    var footer = '<div' + cellAttrs(careerCan, 'career|') +
      ' style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:' +
      (openCareerCell === '' ? 'var(--text)' : 'var(--text-label)') + ';padding:15px 0 13px;' +
      (careerCan ? 'cursor:pointer;' : '') +
      'border-top:1px solid var(--line);">Career</div>' +
      HEADS.slice(1).map(function (h) {
        var r = cf[h.id];
        var can = cellCan(r);
        return '<div' + cellAttrs(can, 'career|' + (h.id === 'total' ? '' : h.id)) +
          ' style="' + MONO + 'font-size:14px;font-weight:700;letter-spacing:-0.14px;text-align:right;' +
          'padding:15px 0 13px;color:' + (r ? 'var(--text)' : DIM_COLOUR) + ';' + (can ? 'cursor:pointer;' : '') +
          'border-top:1px solid var(--line);">' +
          (r ? (r.won || 0) + '/' + (r.lost || 0) : DASH) + '</div>';
      }).join('') +
      (openCareerCell !== null
        ? drillFor('career', openCareerCell || null,
                   openCareerCell ? cf[openCareerCell] : cf.total, 'career')
        : '');
    // C6 · a surface row's drill opens under the season table, inside the season panel.
    var surfDrill = '';
    if (state.careerDrill && state.careerDrill.kind === 'surface') {
      var ds = state.careerDrill.surf;
      var dc = cells[ds] || null;
      surfDrill = renderDrill(p, {
        surf: ds, year: null, since: isL52 ? l52.cutoff : null, span: true, tier: tier,
        title: (CAREER_ROWS.filter(function (r) { return r.id === ds; })[0] || { label: ds }).label +
          ' ' + MIDDOT + ' ' + (isL52 ? 'last 52 weeks' : 'career'),
        won: dc ? dc.won || 0 : 0, lost: dc ? dc.lost || 0 : 0
      });
    }

    var season = recPanel(
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 6px;">' +
        recCaps('Record by season ' + MIDDOT + ' ' + esc(tierWord)) + recCaps('Wins / losses') + '</div>' +
      '<div style="font-size:12.5px;line-height:18.75px;color:var(--text-label);margin-bottom:14px;">' +
        'Click any record to browse those matches ' + EMDASH + ' a surface cell for that surface ' +
        'alone, the year for all of them.</div>' +
      '<div style="display:grid;grid-template-columns:auto repeat(5,minmax(0,1fr));gap:0 14px;' +
        'align-items:center;">' + head + body + footer + surfDrill + '</div>',
      'bottom', '20px 24px 22px');

    return careerTabsHtml() + card + season;
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
  // TEN-384 fx2 item 5 · ONE ROW PER EVENT, at read time. The served tournament-history shards were
  // written before the "London" -> "Queen's Club" alias (and "Hertogenbosch" -> "'s-Hertogenbosch")
  // landed, so they still carry both names over the SAME editions: Alcaraz London 11–1 + Queen's Club
  // 11–1; Thompson Queen's Club 5–4 + London 4–3 with overlapping seasons. Every reader of the shard
  // here (Record per tournament, the join, the name vote, the drill spine) reads this list instead:
  // rows whose names resolve to one identity (tournament-identity.js, the builders' own table) fold
  // into one, and a season held twice counts ONCE — the larger edition, never the two summed.
  // Memoised on the raw array's identity, so a shard landing later re-derives.
  function tournHistOf(p) {
    var raw = (p && p.tournamentHistory) || [];
    if (tournHistOf._raw === raw && tournHistOf._v) return tournHistOf._v;
    var TI = window.TournamentIdentity;
    var v = TI && typeof TI.mergeHistory === 'function' ? TI.mergeHistory(raw) : raw;
    tournHistOf._raw = raw; tournHistOf._v = v;
    return v;
  }
  function tournJoin(p) {
    var mk = marketFor(p.key);
    var ch = careerHistoryFor(p.key);
    if (tournJoin._k === p.key && tournJoin._mk === mk && tournJoin._ch === ch && tournJoin._v) {
      return tournJoin._v;
    }
    var th = tournHistOf(p);

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

    // 3 · per-tournament aggregates from the assigned market rows: the tier and
    //     surface the design's name column and SURFACE column need. BACKING is
    //     NOT summed here any more (founder Q8, 2026-09-30): it is the Match
    //     analysis Tournament tab's row-level join, read per event in tournViews
    //     through the page's trProfileBacking.
    var agg = {};
    function bucket(name) {
      return agg[name] || (agg[name] = {
        anyN: 0, surf: {}, level: {}, lastLevelYear: null, lastLevel: null
      });
    }
    mrows.forEach(function (r, i) {
      var name = owner[i];
      if (!name) return;
      var b = bucket(name);
      b.anyN++;
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
    if (g === GATE.SMALL) return 'var(--text-label)';
    return (100 * won / n) >= 55 ? 'var(--text)' : 'var(--text-soft)';   // blue is a fill, never text (TEN-376)
  }

  // One row per edition match, enriched and ordered newest-first. The stored
  // order is draw order (R128 -> F); the design lists the most recent match
  // first, so rows sort on ROUND DEPTH, which is chronological within a knockout
  // draw and does not depend on a date we may not hold.
  // TEN-384 fx4 · an event whose venue changes by year (the Olympics: 2012 grass, 2016 / 2021 hard, 2024
  // clay) takes each edition's surface from tournament-identity.js's EDITION_SURFACE, never the feed's one
  // per-tournament label (career-history writes "grass" on every "Olympic Games" row). null = no such map.
  function tournEditionSurface(name, year) {
    var TI = window.TournamentIdentity;
    return TI && typeof TI.editionSurface === 'function' ? TI.editionSurface(name, year) : null;
  }
  function tournEditionRows(p, t) {
    var j = tournJoin(p);
    return (t.editions || []).map(function (e) {
      var esf = tournEditionSurface(t.name, e.year);
      var ms = (e.matches || []).map(function (m, i) {
        var x = j.enrich[ekey(e.year, t.name, m.opp)] || {};
        // TEN-402 (founder 2026-10-08, one price join across the site): H / A = the page's per-event model row
        // (trProfilePriceOf → trProfileModel: the Database join, Pinnacle closing else Bet365 closing, retirements
        // settled on the ATP result) — the rows the Backing column and tile sum. Never the market shard's price.
        var jp = typeof window.trProfilePriceOf === 'function' ? window.trProfilePriceOf(p.key, p.name, t, m) : null;
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
          date: x.date || null, surface: esf || x.surface || null,
          setScores: x.setScores || null,
          price: jp && jp.price != null ? jp.price : null,
          oppPrice: jp && jp.price != null ? jp.oppPrice : null,
          book: jp && jp.price != null ? jp.book : null, sheetId: x.sheetId || null,
          retired: !!x.retired, walkover: !!(m.walkover || x.walkover)
        };
      });
      ms.sort(function (a, b) {
        if (a.depth !== b.depth) return a.depth - b.depth;    // F first
        return b.order - a.order;
      });
      var w = 0, l = 0;
      // TEN-313: a walkover (the row's own flag; 'WD' given, 'W' received) is not counted.
      ms.forEach(function (m) { if (m.walkover) return; if (m.res === 'W') w++; else if (m.res === 'L') l++; });
      return { year: e.year, finish: e.finish || null, won: w, lost: l, matches: ms };
    }).sort(function (a, b) { return Number(b.year) - Number(a.year); });
  }

  // The per-tournament view every column and tile reads, so the list row and its
  // open detail cannot disagree.
  function tournViews(p) {
    var j = tournJoin(p);
    return tournHistOf(p).map(function (t) {
      var eds = tournEditionRows(p, t);
      // §4: "Tournament W-L = sum of its listed editions". Recomputed from the
      // edition rows rather than trusting the stored pair — measured across the
      // whole roster, all 9,419 tournament rows agree, and this keeps it so.
      // TEN-313 (N2): n is matches PLAYED — a walkover row stays listed but is not one.
      var w = 0, l = 0, n = 0;
      eds.forEach(function (e) {
        w += e.won; l += e.lost;
        n += e.matches.filter(function (m) { return !m.walkover; }).length;
      });
      var b = j.agg[t.name] || null;
      var level = b && b.lastLevel ? b.lastLevel : null;
      var surf = null, best = 0;
      // fx4 · a per-year surface map (the Olympics) outranks the market vote and the career-history label:
      // the edition rows already carry the map's surface, so the vote below reads only them. A row spanning
      // years on different surfaces takes the existing rule for a multi-surface event — the surface holding
      // most of its matches (eds are newest-first, so a tie goes to the most recent edition).
      var TIm = window.TournamentIdentity;
      var perYear = !!(TIm && typeof TIm.hasEditionSurface === 'function' && TIm.hasEditionSurface(t.name));
      if (b && !perYear) Object.keys(b.surf).forEach(function (s) { if (b.surf[s] > best) { best = b.surf[s]; surf = s; } });
      // A tournament the market shard never reached still has a surface if any
      // of its matches carried one through career-history.
      if (!surf) {
        var votes = {};
        eds.forEach(function (e) { e.matches.forEach(function (m) {
          if (m.surface) votes[m.surface] = (votes[m.surface] || 0) + 1; }); });
        Object.keys(votes).forEach(function (s) { if (votes[s] > best) { best = votes[s]; surf = s; } });
      }
      var bestYears = (t.bestYears || []).slice().sort(function (a, c) { return c - a; });
      // BACKING (founder ruling 2026-10-08, TEN-402 — supersedes Q8's closes join):
      // each edition's main-draw matches joined to career-history and priced on the
      // DATABASE join (Pinnacle closing, else Bet365 closing, per match; retirements
      // settled on the official ATP result), flat 1u — computed by the page
      // (trProfileBacking → trProfileModel), the same model the Head to Head
      // Tournament card prints, so the two show one figure. null = the stores have
      // not answered yet (the column dashes, the tile says so).
      var bk = typeof window.trProfileBacking === 'function' ? window.trProfileBacking(p.key, p.name, t) : null;
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
        // ── RULING Q3 (founder, 2026-09-18) · the impossible pair is suppressed
        //    at the SOURCE, not at each print site ─────────────────────────────
        //
        // "24 played vs 28 priced is impossible. Until it's fixed, where priced n
        //  exceeds the played n, show the played record and dash the priced clause
        //  for that row rather than printing the impossible pair."
        //
        // `pinN` > `n` meant the market shard attributed more priced matches to
        // this event than the player has match rows in it — a join defect (539
        // rows across the roster), not a display choice. The Q8 row join prices
        // only the event's own main-draw rows, so it cannot exceed n; the guard
        // stays so no future source can print the impossible pair.
        // Zeroing pinN/pinPl here rather than at the four print sites means the
        // Backing column, the "Backing him here" tile, the box-3 headline and
        // bestEvent()'s candidacy all dash together: a units figure struck over a
        // population we know is wrong must not headline a tile, and a guard
        // applied at three of four sites is the defect in a new place.
        //
        // `pricedImpossible` survives so the detail tile can SAY why it dashed.
        // The played record is untouched — it is not the thing in doubt.
        pinPl: bk && bk.n && bk.n <= n ? bk.units : null,
        pinN: bk && bk.n <= n ? bk.n : 0,
        pinTxt: bk && bk.n && bk.n <= n ? bk.unitsTxt : null,
        vmTxt: bk && bk.n <= n ? bk.vmTxt : null,
        vmSmall: !!(bk && bk.small),
        pinBet365: bk ? bk.nb : 0,
        backingPending: !bk,
        backingFailed: !!(bk && bk.failed),
        pricedImpossible: !!(bk && bk.n > n),
        pricedClaimed: bk ? bk.n : 0,
        isSlam: isSlamTourn(t.name, level)
      };
    }).sort(tournOrder);
  }

  // ── FOUNDER RULING 2026-09-19 · the tournament list order is PINNED ─────────
  //
  // "162 positions moving with a 22-place jump is a member opening a page they
  //  know and finding it rearranged … Pin it to a stable, stated key and write
  //  the key into the spec."
  //
  // THE PINNED KEY:  matches played DESC -> last played DESC -> display name ASC
  //
  // What was actually wrong. The sort here was `b.n - a.n` alone. Array.sort is
  // stable, so every tie fell through to the order the DATA BUILDER emitted, and
  // career-backfill.js emits on `won + lost` tie-broken by merge sequence.
  // Measured on the deployed store: 11,664 of 13,012 rows (89.6%) sit in a tie
  // on match count, longest tie run 36. So ~90% of this list was ordered by
  // upstream merge order, which nobody chose and which any unrelated builder
  // change can reshuffle. The two trailing terms remove that: the display name
  // is unique per row, so the order is now TOTAL and the store's emission order
  // cannot reach the page at all.
  //
  // WHY THE COUNT IS STILL PRIMARY, STATED RATHER THAN HIDDEN.
  // This does NOT make the order immune to a record correction: a row that loses
  // a match still crosses its count band. Measured by replaying the WD fix under
  // each candidate key (rows that change position, deployed store):
  //
  //     matches desc + insertion (what shipped)      176 rows, max shift  7
  //     matches desc, lastYear, name  (THIS KEY)     426 rows, max shift 28
  //     lastYear desc, matches desc, name            141 rows, max shift  7
  //     lastYear desc, name asc                        0 rows   <- immune
  //     name asc                                       0 rows   <- immune
  //
  // Only a key that never reads the record is immune, and both of those collapse
  // to near-alphabetical: on today's data Sinner's list would open "Doha 2-1"
  // above "Wimbledon 27-4", and Zverev's would open on Acapulco. That is a worse
  // page every day in exchange for avoiding a reshuffle that only happens on a
  // data correction. So the count stays primary and the cost is written down.
  function tournOrder(a, b) {
    if (b.n !== a.n) return b.n - a.n;                         // biggest events first
    var ay = Number(a.lastYear) || 0, by = Number(b.lastYear) || 0;
    if (by !== ay) return by - ay;                             // then most recently played
    return String(a.display).localeCompare(String(b.display)); // then name -> total order
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

    // TEN-384 T2–T5 · the reference's table: Tournament · Surface · Best · W–L · Wins · losses (bar) ·
    // Win % · Backing, gap 0 12, 12px right gutter for the scrollbar; caps heads over a --line rule.
    var GRID = 'display:grid;grid-template-columns:minmax(0,1.2fr) 60px 72px 56px minmax(0,1fr) 52px 64px;' +
      'gap:0 12px;align-items:center;';
    var MONO = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;';
    var HEAD = [['Tournament', 'left'], ['Surface', 'left'], ['Best', 'left'],
                ['W' + ENDASH + 'L', 'right'], ['Wins ' + MIDDOT + ' losses', 'left'], ['Win %', 'right'],
                ['Backing', 'right']];
    var head = '<div style="' + GRID + 'padding:0 12px 0 0;">' +
      HEAD.map(function (h) {
        return '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
          'text-transform:uppercase;color:var(--text-label);text-align:' + h[1] + ';padding:0 0 8px;' +
          'border-bottom:1px solid var(--line);white-space:nowrap;"' +
          // TEN-325: Backing counts retirements, settled on the ATP result.
          (h[0] === 'Backing' && window.MarketEdgeCore ? ' data-ret-note="profile-backing" title="' + esc(window.MarketEdgeCore.RET_SETTLE_NOTE) + '"' : '') +
          '>' + esc(h[0]) + '</span>';
      }).join('') + '</div>';

    var rows = shown.map(function (t) {
      var open = state.tournOpen === t.name;
      var pin = t.pinN ? t.pinPl : null;
      var bp = tournBestParts(t.best);
      var fill = barFillColour(t.n);
      var pct = t.n ? 100 * t.won / t.n : null;
      var small = gateFor(t.n) === GATE.SMALL;
      return '<div style="flex:none;">' +
        '<div class="pp2-trow" data-pp2="tourn-row" data-t="' + esc(t.name) + '" style="' + GRID +
          (small ? 'align-items:start;' : '') +
          'padding:11px 0;cursor:pointer;border-top:1px solid var(--line);' +
          (open ? 'background:var(--selected);box-shadow:-10px 0 0 0 var(--selected),10px 0 0 0 var(--selected);' : '') + '">' +
          // TEN-384 fx3 (founder D11) · ONE small-sample mark, "small sample · n=X", UNDER the win rate (fx2
          // printed it after the event name). The row's cells sit on its first line; the mark takes a second
          // line under the rate. No asterisk anywhere, no footnote line.
          '<span style="display:flex;align-items:baseline;gap:8px;min-width:0;">' +
          '<span style="font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis;min-width:0;">' + esc(t.display) + '</span></span>' +
          '<span style="font-size:12px;color:var(--text-label);white-space:nowrap;">' +
            (t.surface ? esc(t.surface) : DASH) + '</span>' +
          '<span style="display:flex;align-items:baseline;gap:6px;white-space:nowrap;overflow:hidden;">' +
            (bp ? '<span title="' + esc(bp.label) + '" style="' + MONO + 'font-size:12px;font-weight:700;color:var(--text);">' + esc(bp.code) + '</span>' +
              (bp.year ? '<span style="' + MONO + 'font-size:11px;color:var(--text-label);">' + esc(bp.year) + '</span>' : '')
              : '<span style="color:' + DASH_COLOUR + ';">' + DASH + '</span>') + '</span>' +
          '<span style="' + MONO + 'font-size:12px;color:var(--text-label);text-align:right;white-space:nowrap;">' +
            recordText(t.won, t.lost) + '</span>' +
          // The bar is gated like every win-rate bar (barFillColour: --bar from 10, --text-label 5–9, none
          // under 5); the 1px --bar-2 tick marks 50%.
          '<span style="position:relative;display:flex;height:8px;border-radius:4px;overflow:hidden;' +
            (small ? 'margin-top:5px;' : '') +
            'background:color-mix(in srgb, var(--text) 10%, transparent);">' +
            (fill && pct != null ? '<span style="width:' + pct.toFixed(1) + '%;background:' + fill + ';"></span>' : '') +
            '<span style="position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--bar-2);"></span></span>' +
          (function () {
            var r = '<span style="' + MONO + 'font-size:13.5px;font-weight:700;text-align:right;' +
              'white-space:nowrap;color:' + winRateColour(t.won, t.lost) + ';">' + rateText0(t.won, t.lost) + '</span>';
            return small ? rateOverMark(r, t.n) : r;
          }()) +
          // Q3 · a SUPPRESSED row and a never-priced row both dash this column, and they are different
          // facts, so the suppressed one is marked here, not only inside the detail.
          '<span style="' + MONO + 'font-size:12px;font-weight:600;text-align:right;' +
            'white-space:nowrap;color:' + (pin == null ? DASH_COLOUR : pin >= 0 ? 'var(--pos)' : 'var(--neg)') + ';"' +
            (t.pricedImpossible ? ' title="Priced count (' + t.pricedClaimed + ') exceeds ' + t.n +
              ' matches played — withdrawn pending the odds-join fix"' : '') + '>' +
            (pin == null ? DASH : t.pinTxt || signed(pin, 1, 'u')) +
            (t.pricedImpossible
              ? '<span style="font-size:9px;color:var(--neg);margin-left:4px;">!</span>' : '') + '</span>' +
        '</div>' +
        (open ? renderTournDetail(p, t) : '') +
        '</div>';
    }).join('');

    // T2 · caps head left, a compact search right (220px, --inner, no edge, r9, 7/12, 14px icon, 12.5px).
    // T3 · the helper sentence, the list footnote and the in-detail explainer are removed.
    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px;">' +
        recCaps('Record per tournament ' + MIDDOT + ' career') +
        '<label style="display:flex;align-items:center;gap:9px;width:220px;box-sizing:border-box;' +
          'background:var(--inner);border:1px solid transparent;border-radius:9px;padding:7px 12px;">' +
          '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" style="flex:none;">' +
            '<circle cx="9" cy="9" r="6" stroke="var(--text-label)" stroke-width="1.7"></circle>' +
            '<path d="m14 14 3 3" stroke="var(--text-label)" stroke-width="1.7" stroke-linecap="round"></path></svg>' +
          '<input type="search" data-pp2="tourn-search" value="' + esc(state.tournQuery || '') + '" ' +
            'placeholder="Search a tournament" aria-label="Search a tournament" style="flex:1;background:transparent;' +
            'border:0;outline:none;font-family:inherit;font-size:12.5px;color:var(--text);min-width:0;padding:1px 2px;"></label>' +
      '</div>' +
      head +
      '<div style="max-height:calc(100vh - 250px);min-height:420px;overflow-y:auto;display:flex;' +
        'flex-direction:column;padding:0 12px 0 0;">' +
        // fx5 item 2 · while the tournament-history shard loads the list area stays empty (the frame keeps its
        // min-height): no empty-state sentence until the shard has answered. A settled, genuinely empty shard
        // says so; the search sentence is for a search that matched nothing.
        (shown.length ? rows : tournHistPending(p) ? '' :
          '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;margin-top:12px;' +
          'text-align:center;font-size:13px;color:var(--text-label);">' +
          (q ? 'No tournament matches that search.' : 'No tournaments on record.') + '</div>') +
      '</div>';
  }

  /**
   * "Semi-final 2026" → { code: 'SF', year: '2026', label: 'Semi-final' }. The reference prints the best
   * result as a draw code (W · F · SF · QF · R16 …); the store's finish words map one-to-one, and a word
   * we have no code for is printed as it is.
   */
  var TOURN_BEST_CODE = { 'Won': 'W', 'Final': 'F', 'Semi-final': 'SF', 'Quarter-final': 'QF',
    'Round of 16': 'R16', 'Round of 32': 'R32', 'Round of 64': 'R64', 'Round of 128': 'R128' };
  function tournBestParts(best) {
    if (!best) return null;
    var m = /^(.*?)\s+(\d{4})$/.exec(String(best));
    var word = m ? m[1] : String(best);
    if (!word) return null;
    return { code: TOURN_BEST_CODE[word] || word, year: m ? m[2] : null, label: word };
  }

  // TEN-384 T6 · a detail tile is one cell of a joined strip (recTileStrip): caps cap, mono 24/700 value,
  // an 11px Hanken sub. `value` is already-escaped markup.
  function tile(cap, value, sub, colour) {
    return { pad: '13px 12px', html: recTileCell(cap, value, colour,
      '<span style="font-size:11px;color:var(--text-label);">' + esc(sub == null ? '' : sub) + '</span>') };
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
    var pinTxt = t.pinN ? t.pinTxt || signed(t.pinPl, 1, 'u') : DASH;
    var pinColour = !t.pinN ? DASH_COLOUR : t.pinPl >= 0 ? 'var(--pos)' : 'var(--neg)';
    // The file's fifth-tile sub is "+3.4pt vs market". TEN-312 D6 gave it a
    // formula (win rate minus the de-vigged implied rate, n >= 5 priced) and
    // founder Q8 put the tile on the Tournament tab's rows, so the sub is that
    // tab's own text (trProfileBacking); below 5 priced it states the count.
    //
    // RULING Q3 · when the priced count exceeded the played count, tournViews()
    // zeroed it, and the sub has to say so rather than fall through to "Pinnacle
    // priced none of these" — which would be a claim about the archive when the
    // real fact is a claim about our join.
    // Founder Q8 (2026-09-30): the sub is the Tournament tab tile's own — "+Y.Ypt
    // vs market" (D6, from 5 priced; 5-9 a small sample), else the priced count.
    var pinSub = t.pricedImpossible
      ? 'priced count (' + t.pricedClaimed + ') exceeds ' + t.n + ' matches played ' + MIDDOT +
        ' odds join under investigation'
      : t.backingPending
        ? 'loading prices'
        : t.backingFailed
          ? 'prices unavailable'
          : t.vmTxt
            ? t.vmTxt + (t.vmSmall ? ' ' + MIDDOT + ' ' + smallSampleText(t.pinN) : '')
            : t.pinN
              ? t.pinN + ' priced ' + MIDDOT + ' closing price: Pinnacle, else Bet365'
              : 'none of these priced';
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
        (function () {
          var bp = tournBestParts(t.best);
          return tile('Best result', bp ? esc(bp.code) : DASH, (bp && bp.year ? bp.year + ' ' + MIDDOT + ' ' : '') + 'furthest here');
        })(),
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
      // Caps labels are Hanken, never mono caps (foundation).
      return '<span style="position:sticky;top:0;background:var(--card);font-family:var(--font-words);' +
        'font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:700;color:var(--text-label);' +
        'text-align:' + h[1] + ';padding:0 0 7px;">' + esc(h[0]) + '</span>';
    }).join('');

    var body = t.editions.map(function (e) {
      var grp = '<span style="grid-column:1 / -1;display:flex;align-items:center;gap:10px;' +
        'padding:12px 0 6px;">' +
        '<span style="font-size:12.5px;font-weight:700;white-space:nowrap;">' +
          esc(t.display + ' ' + e.year) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:var(--text-label);' +
          'white-space:nowrap;">' + esc((e.finish || DASH) + ' ' + MIDDOT + ' ' +
          recordText(e.won, e.lost)) + '</span></span>';
      return grp + e.matches.map(function (m) {
        var wl = m.won ? 'var(--pos)' : 'var(--neg)';
        // §3: only advertise a click the sheet can actually resolve. The sheet
        // looks the row up by "date|opponent" in the ledger and then the market
        // shard, so a row neither store reached has no sheet to open.
        var hook = m.sheetId ? sheetHook(m.sheetId) : '';
        var cur = hook ? sheetCursor() : '';
        // TEN-384 · every row sits on a --line rule, as the reference's match list does.
        var cell = function (style, txt) {
          return '<span ' + hook + 'style="' + cur + 'border-top:1px solid var(--line);' + style + '">' + txt + '</span>';
        };
        return '' +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);padding:5px 0;',
               m.date ? esc(fmtDotDate(m.date) + '.') : DASH) +
          cell('display:flex;align-items:center;align-self:stretch;',
               '<span style="width:8px;height:8px;border-radius:2px;background:' + wl + ';"></span>') +
          // ⚠️ NAME FORM — the export contradicts itself and the file wins here.
          // `Player Profile.dc.html`:838 writes the LEDGER's opponent surname-
          // first ("Shelton B."), which is what correction-pass items 4/8 ruled
          // and what renderDrill still does. `Player Stat Boxes.dc.html`:2325 —
          // the file that owns this modal (README §12) and the first file in the
          // founder's own precedence order — writes it initial-first
          // ("J. Sinner"). This block prints initial-first through initialSurname, the
          // rule every other drill uses (fx3 D12), so the feed's "J.J. Wolf" reads "J. J. Wolf".
          // fx5 item 4 · the opponent goes through the drills' one name rule ("J. J. Wolf", "J-L. Struff").
          cell('font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 0;',
               esc(m.opp ? initialSurname(m.opp) : DASH)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:var(--text-label);padding:5px 0;',
               esc(m.round || DASH)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;color:' + wl +
               ';padding:5px 0;', m.sets ? esc(m.sets) : (m.rawSets ? esc(m.rawSets) : DASH)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);white-space:nowrap;' +
               'padding:5px 0;', m.setScores ? esc(m.setScores) : DASH) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-soft);text-align:right;' +
               'padding:5px 0;', oddsText(m.price)) +
          cell('font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);text-align:right;' +
               'padding:5px 0;', oddsText(m.oppPrice));
      }).join('');
    }).join('');

    // TEN-384 T6 · the detail is a panel (--card + --edge-6, r10): caps "<Event> · career" + mono meta, the
    // five tiles as one joined strip, the match grid. The explainer footnote is removed; the one line that
    // stays is the stored-record disagreement, which is a data disclosure, not an explainer.
    return '<div data-pp2-tourn-detail="1" style="background:var(--card);border:1px solid var(--edge-6);border-radius:10px;' +
      'margin:7px 0 9px;padding:13px 15px;">' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:11px;margin-bottom:12px;">' +
        recCaps(esc(t.display) + ' ' + MIDDOT + ' career', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;') +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);' +
          'white-space:nowrap;flex:none;">' + esc(recordText(t.won, t.lost) + ' ' + MIDDOT + ' ' +
          rateText0(t.won, t.lost) + ' ' + MIDDOT + ' ' + n + ' matches listed') + '</span>' +
      '</div>' +
      recTileStrip(tiles, 14) +
      '<div style="max-height:calc(100vh - 430px);min-height:300px;overflow-y:auto;">' +
        '<div style="' + MGRID + '">' + mhead + body + '</div>' +
      '</div>' +
      (t.reconciles ? '' : '<div style="font-size:11px;color:var(--text-label);line-height:1.5;margin-top:10px;">' +
        'The stored record for this event reads ' + recordText(t.storedWon, t.storedLost) + ' against ' +
        recordText(t.won, t.lost) + ' in the editions listed.</div>') +
      '</div>';
  }

  // §5.7 Splits — THREE tabs (Results · Sets & Games · Service), per the export's
  // `modal.splits.tabBtns` / `resultsOn|setsOn|serviceOn`. Only Results was built;
  // the other two are new here.
  //
  // Columns, grids and labels are lifted verbatim from
  // `Player Stat Boxes.dc.html` rather than inferred:
  //   results  minmax(84px,1.25fr) repeat(4,…)  Record · Matches · Win rate · Vs avg
  //   sets     minmax(84px,1.25fr) repeat(4,…)  Tiebreaks · Games · Sets · Vs avg
  //   service  minmax(84px,1.25fr) repeat(5,…)  Matches · Aces · Dbl faults · Holds · Breaks
  //
  // Two different `Vs avg` columns, and they are NOT interchangeable. On Results
  // it is the gap to the player's own average MATCH win rate; on Sets & Games the
  // export names `r.setDev`, the gap to his own average SET win rate. Reusing the
  // match baseline there would print a plausible number measuring nothing.
  //
  // Service percentages are measured over MS (matches with recorded serve data),
  // never over M — which is exactly why `Matches` is the tab's first column: the
  // denominator is disclosed on the row that rests on it. Where the source
  // recorded none, the value is absent and dashes: "not measured" and "zero" are
  // different facts and must not look alike.
  var SPLIT_TABS = [
    { id: 'results', label: 'Results' },
    { id: 'sets', label: 'Sets & Games' },
    { id: 'service', label: 'Service' }
  ];
  // ── TEN-384 · Draw record, rebuilt to the reference (OFFICIAL VERSION 1) ───
  // Body: a caps scope label + mono population line, the Results | Sets & Games |
  // Service track on the right; then FOUR panels in two 422px columns (Level /
  // Format / By round left, Opponent right), each a --card + --edge-6 panel with
  // its own head row; then ONE footnote line. The Career | Last 52 grain lives in
  // the MODAL HEADER (drawGrainHtml, placed by the shared shell).
  //
  // Column tracks are the reference's, per tab (392px inside a 14px-padded panel):
  //   Results       name 200 · W–L 56 · Win % 54 · Vs avg 58
  //                 (shard r2, founder: the reference's W–L 48 is 7 Plex Mono 11.5 characters less 0.3px, so a
  //                 "124–141" wrapped onto two lines and a 4-digit career ("1044–199") cannot fit at all. The
  //                 column takes 8 characters (55.2px) from the name column; the panel's width is unchanged.)
  //   Sets & Games  name 138 · Tiebreaks 68 · Games 48 · Sets 48 · Vs avg 58
  //   Service       name 144 · M 26 · Aces 42 · DF 42 · Holds 48 · Breaks 50
  // The tab's headline rate(s) are Plex 13/700 white (Win %, Sets, Holds + Breaks);
  // supporting figures Plex 11.5 label; Vs avg Plex 12/700 signed.
  //
  // Founder Q7 (2026-10-05): Opponent runs through vs Top 10 only — no vs Top 50
  // row, dash or note (career-splits holds no Top-50 split).
  var SPLIT_TRACKS = {
    results: '200px 56px 54px 58px',
    sets: '138px 68px 48px 48px 58px',
    service: '144px 26px 42px 42px 48px 50px'
  };
  function pct1(v) { return v == null ? DASH : Number(v).toFixed(1) + '%'; }
  // "vs. Righties" (the store's category key) → "vs Righties" (the reference's label).
  function splitLabel(m) { return String(m).replace(/^vs\. /, 'vs '); }

  // ── Early rounds (By round), recomposed from NUMERATORS ────────────────────
  // career-splits carries Round of 16 / 32 / 64 / 128 as separate rows. Early
  // rounds is their union, and every figure it prints is recomposed from counts,
  // never averaged from percentages:
  //   W, L                 Σ W, Σ L
  //   sets / games / TB    Σ setW / Σ (setW+setL) etc. (the store's own numerators)
  //   MS                   Σ MS
  // The SERVICE percentages (aces, DF, holds, breaks) are stored as rates over
  // service points / games whose counts the store does not carry, so they cannot
  // be recomposed exactly: they print "—" on the Early rounds row (an MS-weighted
  // mean would be an estimate, and nothing on this page is estimated).
  var EARLY_ROUND_MEMBERS = ['Round of 16', 'Round of 32', 'Round of 64', 'Round of 128'];
  var EARLY_ROUNDS = 'Early rounds';
  function earlyRoundsRow(sc) {
    var acc = null;
    EARLY_ROUND_MEMBERS.forEach(function (m) {
      var r = sc && sc[m];
      if (!r || r.W == null || r.L == null) return;
      if (!acc) acc = { W: 0, L: 0, setW: 0, setL: 0, gameW: 0, gameL: 0, tbW: 0, tbL: 0, MS: 0, derived: true };
      acc.W += r.W; acc.L += r.L;
      acc.setW += r.setW || 0; acc.setL += r.setL || 0;
      acc.gameW += r.gameW || 0; acc.gameL += r.gameL || 0;
      acc.tbW += r.tbW || 0; acc.tbL += r.tbL || 0;
      acc.MS += r.MS || 0;
    });
    if (!acc) return null;
    function p(w, l) { return w + l ? Math.round(1000 * w / (w + l)) / 10 : null; }
    acc.M = acc.W + acc.L;
    acc.setPct = p(acc.setW, acc.setL);
    acc.gamePct = p(acc.gameW, acc.gameL);
    acc.tbPct = p(acc.tbW, acc.tbL);
    return acc;
  }
  /** The rows a Draw panel prints: the group's members, plus Early rounds under By round. */
  function drawRows(g, sc) {
    var rows = g.members.map(function (m) { return { label: splitLabel(m), r: sc[m] || null }; });
    if (g.id === 'round') rows.push({ label: EARLY_ROUNDS, r: earlyRoundsRow(sc) });
    return rows;
  }

  /**
   * The Sets tab's own baseline: this player's average SET win rate across the
   * splits in this scope, weighted by sets played. Computed off setW/setL, not
   * off match W/L — see the note above.
   */
  function setBaseline(sc) {
    var w = 0, t = 0;
    // DRAW_GROUPS, not the vocabulary: this baseline is the average of the rows
    // ON SCREEN, and the Vs avg column beside it is read against it. Averaging
    // over a Surface group the reader cannot see would make every deviation in
    // the column unverifiable from the modal.
    DRAW_GROUPS.forEach(function (g) {
      g.members.forEach(function (m) {
        var r = sc[m];
        if (!r || r.setW == null || r.setL == null) return;
        w += r.setW; t += r.setW + r.setL;
      });
    });
    return t ? (100 * w / t) : null;
  }

  // The darker-track segment of the reference (founder Q4.2): track --card +
  // --edge-6, radius 9, pad 2, gap 3; item pad 5/12, Hanken 11, radius 7;
  // selected --inner + --edge-10, white 700; idle --text-label 600, no edge.
  function drawSeg(hook, attr, items, active) {
    return '<span data-pp2-seg="' + hook + '" style="display:inline-flex;flex:none;gap:3px;padding:2px;' +
      'background:var(--card);border:1px solid var(--edge-6);border-radius:9px;">' +
      items.map(function (it) {
        var on = it[0] === active;
        return '<button type="button" data-pp2="' + hook + '" ' + attr + '="' + it[0] + '" ' +
          (on ? 'aria-pressed="true" ' : 'aria-pressed="false" ') +
          'style="padding:5px 12px;border-radius:7px;font-family:var(--font-words);font-size:11px;' +
          'white-space:nowrap;line-height:14px;cursor:pointer;' +
          'border:1px solid ' + (on ? 'var(--edge-10)' : 'transparent') + ';' +
          'background:' + (on ? 'var(--inner)' : 'transparent') + ';' +
          'color:' + (on ? 'var(--text)' : 'var(--text-label)') + ';font-weight:' + (on ? 700 : 600) + ';">' +
          esc(it[1]) + '</button>';
      }).join('') + '</span>';
  }

  /**
   * The Draw record's grain control, "Career | Last 52", for the MODAL HEADER.
   * The shared shell (rec, modalShell) places it for key 'splits'; it renders
   * nothing in the body.
   */
  function drawGrainHtml() {
    var scope = state.splitScope === 'last52' ? 'last52' : 'career';
    return drawSeg('split-scope', 'data-scope', [['career', 'Career'], ['last52', 'Last 52']], scope);
  }

  // ── Shard r2 (founder): why Level and By round sum short of Format ─────────
  // The splits builder counts every tour-level match (lv G M A F D) in the totals, but Level has rows for G, M
  // and A only, and By round for F SF QF R16–R128 only: Davis Cup (D) and Tour Finals / NextGen (F) matches have
  // no Level row, round-robin (RR, which is how the source codes Davis Cup rubbers too) and bronze-medal (BR, 9
  // matches over 7 players in splits-matches/ on 8 Oct) have no By round row.
  // Ruling: state it in the footnote, no new rows. Format (Best of 5 + Best of 3) is the complete partition, so
  // the gaps are Format total − Level sum and Format total − By round sum, over the scope shown. The scope holds
  // aggregates only (the per-match drawer shard is not loaded here), so it cannot say WHICH of the excluded
  // kinds a gap holds: the reason is the generic one. Both gaps 0 → no clause.
  var DRAW_ROUND_ROWS = ['Finals', 'Semi-finals', 'Quarter-finals'].concat(EARLY_ROUND_MEMBERS);
  function drawRowsSum(sc, labels) {
    return labels.reduce(function (a, m) {
      var r = sc && sc[m];
      return a + (r && r.W != null && r.L != null ? r.W + r.L : 0);
    }, 0);
  }
  function drawGaps(sc) {
    var fmt = DRAW_GROUPS.filter(function (g) { return g.id === 'format'; })[0];
    var lvl = DRAW_GROUPS.filter(function (g) { return g.id === 'level'; })[0];
    var total = drawRowsSum(sc, fmt.members);
    if (!total) return null;
    return { total: total, level: total - drawRowsSum(sc, lvl.members), round: total - drawRowsSum(sc, DRAW_ROUND_ROWS) };
  }
  function drawGapClause(sc) {
    var g = drawGaps(sc);
    if (!g || (g.level <= 0 && g.round <= 0)) return '';
    function nm(n) { return n + ' match' + (n === 1 ? '' : 'es'); }
    var parts = [];
    if (g.level > 0) parts.push('Level leaves out ' + nm(g.level));
    if (g.round > 0) parts.push(parts.length ? 'By round ' + g.round : 'By round leaves out ' + nm(g.round));
    var why = [];
    if (g.level > 0) why.push('Level has no row for Davis Cup or Tour Finals');
    if (g.round > 0) why.push((why.length ? 'By round has none' : 'By round has no row') + ' for round-robin or bronze-medal matches');
    return parts.join(', ') + ' (' + why.join('; ') + ')';
  }

  function renderSplitsModal(p) {
    var scope = state.splitScope === 'last52' ? 'last52' : 'career';
    var tab = SPLIT_TABS.filter(function (t) { return t.id === state.splitTab; })[0] || SPLIT_TABS[0];
    var sc = splitScope(p.key, scope);
    if (!sc) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">' +
        // fx6 item 8: the tile and the modal print the same words, no trailing period in either.
        (splitsPending(p.key) ? SPLITS_PEND_HTML
          : splitsNotBuilt(p.key) ? SPLITS_NOT_BUILT : 'No split data on record for this player.') + '</div>';
    }
    // ONE baseline since RULING Q1 round 2: the population win rate over a
    // complete partition (pooledBaseline), the same figure the box and Key
    // insights quote, so the tile's gap is reproducible from these rows. It is
    // disclosed in the footnote.
    var baseline = pooledBaseline(p.key, scope);
    var setBase = setBaseline(sc);
    var gapClause = drawGapClause(sc);
    var tracks = SPLIT_TRACKS[tab.id];
    var heads = tab.id === 'results' ? ['W' + ENDASH + 'L', 'Win %', 'Vs avg']
      : tab.id === 'sets' ? ['Tiebreaks', 'Games', 'Sets', 'Vs avg']
      : ['M', 'Aces', 'DF', 'Holds', 'Breaks'];

    var CAPS = 'font-family:var(--font-words);font-size:10.5px;letter-spacing:0.10em;' +
      'text-transform:uppercase;color:var(--text-label);';
    var CELL0 = 'padding:8px 0;border-top:1px solid var(--line);';
    var CELL = CELL0;   // fx3 (D11): a small-sample row's cells add align-self:stretch (see rowHtml)
    function headCell(t, first) {
      return '<span style="padding:0 0 8px;border-bottom:1px solid var(--line);' + CAPS +
        'font-weight:' + (first ? 800 : 700) + ';' + (first ? '' : 'text-align:right;') + '">' + esc(t) + '</span>';
    }
    // A supporting figure (Plex 11.5 label) or the tab's headline rate (Plex 13/700 white).
    function fig(txt, lead) {
      var dash = txt === DASH;
      // nowrap: an en dash is a line-break opportunity, so a W–L that overruns its track breaks AFTER the dash.
      return '<span style="' + CELL + 'text-align:right;white-space:nowrap;font-family:\'IBM Plex Mono\',monospace;' +
        (lead ? 'font-size:13px;font-weight:700;color:' + (dash ? DASH_COLOUR : 'var(--text)') + ';'
              : 'font-size:11.5px;color:var(--text-label);') + '">' + esc(txt) + '</span>';
    }
    function dev(gap) {
      return '<span style="' + CELL + 'text-align:right;font-family:\'IBM Plex Mono\',monospace;' +
        'font-size:12px;font-weight:700;color:' +
        (gap == null ? DASH_COLOUR : gap >= 0 ? 'var(--pos)' : 'var(--neg)') + ';">' +
        (gap == null ? DASH : signed(gap, 1, 'pp')) + '</span>';
    }
    function cnt(w, l) { return w == null || l == null ? null : w + ENDASH + l; }

    function rowHtml(row) {
      var r = row.r;
      var n = r ? (r.W || 0) + (r.L || 0) : 0;
      var cells, tip = [];
      CELL = (tab.id === 'results' && gateFor(n) === GATE.SMALL) ? CELL0 + 'align-self:stretch;' : CELL0;
      if (tab.id === 'results') {
        var gate = gateFor(n);
        var rate = r ? rateText(r.W, r.L) : DASH;
        var gap = (r && gate === GATE.FULL && baseline != null) ? (100 * r.W / n) - baseline : null;
        cells = fig(r ? recordText(r.W, r.L) : DASH, false) +
          // n 5–9: the rate prints in label grey (small sample); n < 5: dash.
          // fx3 (founder D11): the mark "small sample · n=X" under the grey rate.
          (gate === GATE.SMALL
            ? '<span style="' + CELL + 'font-family:\'IBM Plex Mono\',monospace;' +
              'font-size:13px;font-weight:700;color:var(--text-label);">' + rateOverMark(esc(rate), n) + '</span>'
            : fig(rate, true)) +
          dev(gap);
        if (r) tip.push(recordText(r.W, r.L) + ' over ' + n + ' match' + (n === 1 ? '' : 'es') +
          (gate === GATE.SMALL ? ' ' + MIDDOT + ' ' + smallSampleText(n) : gate === GATE.THIN ? ' ' + MIDDOT + ' under 5 matches, no rate' : ''));
      } else if (tab.id === 'sets') {
        // Set-level gate: the row is about sets, so it is gated on sets played.
        var setsN = r && r.setW != null ? r.setW + r.setL : 0;
        var sgap = (r && r.setPct != null && setsN >= INSIGHT_MIN_N && setBase != null)
          ? r.setPct - setBase : null;
        cells = fig(r ? pct1(r.tbPct) : DASH, false) + fig(r ? pct1(r.gamePct) : DASH, false) +
          fig(r ? pct1(r.setPct) : DASH, true) + dev(sgap);
        if (r) {
          if (cnt(r.tbW, r.tbL)) tip.push('tiebreaks ' + cnt(r.tbW, r.tbL));
          if (cnt(r.gameW, r.gameL)) tip.push('games ' + cnt(r.gameW, r.gameL));
          if (cnt(r.setW, r.setL)) tip.push('sets ' + cnt(r.setW, r.setL));
        }
      } else {
        var ms = r && r.MS != null ? r.MS : null;
        var est = !!(r && r.derived);   // Early rounds: rates not recomposable → dash
        cells = fig(ms == null ? DASH : String(ms), false) +
          fig(r && !est ? pct1(r.aPct) : DASH, false) + fig(r && !est ? pct1(r.dfPct) : DASH, false) +
          fig(r && !est ? pct1(r.hldPct) : DASH, true) + fig(r && !est ? pct1(r.brkPct) : DASH, true);
        if (r) {
          tip.push(recordText(r.W, r.L) + ' over ' + n + ' match' + (n === 1 ? '' : 'es') +
            (ms != null ? ' ' + MIDDOT + ' ' + ms + ' with serve data' : ''));
          if (!est && r.acesPM != null) tip.push(r.acesPM + ' aces and ' + r.dfPM + ' double faults a match');
          if (est) tip.push('the source stores these rates without their counts, so they cannot be combined across rounds');
        }
      }
      return '<span data-pp2-split="' + esc(row.label) + '"' + (tip.length ? ' title="' + esc(tip.join(' ' + MIDDOT + ' ')) + '"' : '') +
        ' style="' + CELL + 'font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;' +
        'white-space:nowrap;color:' + (r && n ? 'var(--text)' : DASH_COLOUR) + ';">' + esc(row.label) + '</span>' + cells;
    }
    function panel(g) {
      return '<div data-pp2-draw="' + g.id + '" style="background:var(--card);border:1px solid var(--edge-6);' +
        'border-radius:12px;padding:14px 14px 6px;">' +
        '<div style="display:grid;grid-template-columns:' + tracks + ';gap:0 8px;align-items:center;min-width:0;">' +
          headCell(g.label, true) + heads.map(function (h) { return headCell(h, false); }).join('') +
          drawRows(g, sc).map(rowHtml).join('') +
        '</div></div>';
    }
    function col(ids) {
      return '<div style="display:flex;flex-direction:column;gap:10px;min-width:0;">' +
        DRAW_GROUPS.filter(function (g) { return ids.indexOf(g.id) >= 0; }).map(panel).join('') + '</div>';
    }

    var meta = splitsFor(p.key);
    var popLine = scope === 'career'
      ? 'Every tour match on record ' + MIDDOT + ' ' + (meta && meta.matchesParsed != null ? meta.matchesParsed.toLocaleString('en-US') + ' matches' : DASH)
      : 'Rolling 12-month form ' + MIDDOT + ' ' + (meta && meta.last52Count != null ? meta.last52Count.toLocaleString('en-US') + ' matches' : DASH);

    return '' +
      '<div style="display:flex;flex-direction:column;gap:16px;min-width:0;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;">' +
          '<span style="display:flex;align-items:baseline;gap:8px;font-family:\'IBM Plex Mono\',monospace;' +
            'font-size:12px;color:var(--text-label);">' +
            '<span style="' + CAPS + 'font-weight:700;margin-right:16px;">' + (scope === 'career' ? 'Career' : 'Last 52') + '</span>' +
            '<span>' + esc(popLine) + '</span>' +
          '</span>' +
          drawSeg('split-tab', 'data-tab', SPLIT_TABS.map(function (t) { return [t.id, t.label]; }), tab.id) +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,422px));gap:10px;align-items:start;">' +
          col(['level', 'format', 'round']) + col(['opponent']) +
        '</div>' +
        '<div data-pp2-draw="note" style="font-size:12px;line-height:19.2px;color:var(--text-label);">' + legend() +
          (gapClause ? ' ' + MIDDOT + ' ' + esc(gapClause) : '') + '</div>' +
      '</div>';

    // One line each, the reference's wording. The Results line carries the
    // baseline the Vs avg column (and the box headline) is measured against.
    function legend() {
      if (tab.id === 'results') {
        return 'Record and matches played ' + MIDDOT + ' win rate ' + MIDDOT + ' vs avg is the gap to this ' +
          'player&#39;s average win rate across all splits' +
          (baseline == null ? '' : ' (' + baseline.toFixed(1) + '%)') + ' ' + MIDDOT + ' hover a row for raw counts';
      }
      if (tab.id === 'sets') {
        return 'TB% tiebreaks won ' + MIDDOT + ' GM% games won ' + MIDDOT + ' SET% sets won ' + MIDDOT +
          ' VS AVG is the gap to this player&#39;s average set win rate' +
          (setBase == null ? '' : ' (' + setBase.toFixed(1) + '%)') + ' ' + MIDDOT + ' hover a row for raw counts';
      }
      return 'Matches served ' + MIDDOT + ' aces and double faults as a share of service points ' + MIDDOT +
        ' holds and breaks as a share of games ' + MIDDOT + ' hover a row for the raw counts';
    }
  }

  // §5.8 Market edge — role cards, price bands, band drill, cumulative chart.
  //
  // ★ Founder ruling TEN-310, 2026-09-27, SUPERSEDING R1 (Pinnacle closing only):
  //   "Both use this tab's rules" — the same basis as the Match analysis Market edge
  //   tab: Pinnacle close, else Bet365 close (one book per match); favourite = price
  //   under 2.00; the half-open 8-band ladder of market-edge-core.js.
  //
  // The basis is enforced in build-market-edge.js (one `isYieldBasis` predicate at
  // every aggregation point) and locked by tools/test-market-edge-basis.js. This
  // renderer's job is to SAY which population each figure rests on, because the
  // ledger legitimately shows more priced rows than the headline counts and the
  // two numbers disagreeing is otherwise indistinguishable from a bug.
  //
  // Four pieces were missing from the build and are added here, all specified in
  // `Player Stat Boxes.dc.html`:
  //   * the "At 1u flat" figure on each role card (the file's second figure; the
  //     build showed a bare win rate — §6 item 2, founder default "the file wins")
  //   * the divergence bars, on role cards AND band rows
  //   * the band row -> match detail drill
  //   * the cumulative profit chart, with its Back|Fade and surface filters
  // ══════════════════════════════════════════════════════════════════════════
  // §5.8 · DERIVED LINES  (Market edge -> "Derived lines" tab)
  //
  // Founder brief 2026-09-18: "Everything in it is arithmetic on a scoreline."
  // Nothing here is a settled market and nothing here is a yield. Only the
  // favourite/underdog SPLIT needs a price: since TEN-310 (2026-09-27) the split is
  // the Market edge rule — favourite = his closing price under 2.00 — on the price
  // the career spine carries (its Pinnacle closing join). A row is a coverage rate:
  // how often his own scoreline landed on the right side of a line, never how a
  // bet settled.
  //
  // Ruling: RET and abandoned matches are EXCLUDED and counted in the note. A
  // games handicap off a match that stopped at 3-3 is not a handicap result.
  // Walkovers go with them: they have no scoreline at all.
  //
  // "AVG MARGIN" — the export ships literals, not a formula, so the definition
  // is derived from its own arithmetic rather than invented. In all six split
  // rows the printed total is the HIT-COUNT-WEIGHTED mean of its favourite and
  // underdog figures:
  //     -4.5 games  (31*7.9 + 8*5.6)/39  = 7.43  printed 7.4
  //     +2.5 games  (69*4.0 + 45*1.7)/114 = 3.09  printed 3.1
  //     -1.5 sets   (39*7.2 + 15*6.1)/54  = 6.89  printed 6.9
  // 6 of 6 reproduce. So: the mean games margin (his games minus his
  // opponent's) across the matches that HIT that line — not across the
  // denominator. Every sign and magnitude in the export's 30 literals agrees
  // (a 2-0 win +6.9, a 0-2 loss -6.4; a tighter line carries a bigger margin
  // than a looser one, because a looser line admits closer matches).
  var LINE_DEFS = {
    bo3: {
      label: 'best of 3', setsToWin: 2,
      groups: [
        ['Games handicap', [
          ['−4.5 games', 'gh', 4.5, -1], ['−2.5 games', 'gh', 2.5, -1],
          ['+2.5 games', 'gh', 2.5, 1], ['+4.5 games', 'gh', 4.5, 1]]],
        ['Set handicap', [['−1.5 sets', 'sh', 1.5, -1], ['+1.5 sets', 'sh', 1.5, 1]]],
        ['Total games', [
          ['over 22.5', 'tg', 22.5, 1], ['under 22.5', 'tg', 22.5, -1],
          ['over 20.5', 'tg', 20.5, 1]]],
        ['Match shape', [
          ['won 2–0', 'ms', [2, 0]], ['won 2–1', 'ms', [2, 1]],
          ['lost 1–2', 'ms', [1, 2]], ['lost 0–2', 'ms', [0, 2]]]]
      ]
    },
    bo5: {
      label: 'best of 5', setsToWin: 3,
      groups: [
        ['Games handicap', [
          ['−6.5 games', 'gh', 6.5, -1], ['−3.5 games', 'gh', 3.5, -1],
          ['+3.5 games', 'gh', 3.5, 1], ['+6.5 games', 'gh', 6.5, 1]]],
        ['Set handicap', [['−2.5 sets', 'sh', 2.5, -1], ['+2.5 sets', 'sh', 2.5, 1]]],
        ['Total games', [
          ['over 37.5', 'tg', 37.5, 1], ['under 37.5', 'tg', 37.5, -1],
          ['over 34.5', 'tg', 34.5, 1]]],
        ['Match shape', [
          ['won 3–0', 'ms', [3, 0]], ['won 3–1', 'ms', [3, 1]], ['won 3–2', 'ms', [3, 2]],
          ['lost 2–3', 'ms', [2, 3]], ['lost 1–3', 'ms', [1, 3]], ['lost 0–3', 'ms', [0, 3]]]]
      ]
    }
  };
  // Games and Set handicap carry the favourite/underdog split; Total games and
  // Match shape do not. Straight from the export's own data shape, where only
  // those two groups pass an array for `hit`.
  var LINE_SPLIT_KINDS = { gh: true, sh: true };

  /** Subject set counts for a spine row, or null when the row carries none. */
  // TEN-384 fx6 item 2 (founder r2) · A PER-SET LIST SHORT OF THE RESULT. Alcaraz's US Open 2021 v P. Gojowczyk
  // reads "3 - 2" with four per-set scores on file (5-7 6-1 5-7 6-2, the fifth set missing): counted off the
  // list it was a 2–2 "best of 3" match in no Match shape row (156 + 59 + 26 + 28 = 269 of 270). Where the
  // list holds fewer sets than the result, the result's own count decides (won 3–2, best of 5) and the row is
  // marked `partial`: its games lines are not evaluable (lineCoverage drops its games), never summed short.
  // fx7 item 2 · a per-set list LONGER than a decided result ("1 - 2" with 4-6 6-3 4-6 1-0 on file, Sinner's Monte
  // Carlo 2024 SF) read as a level 2–2 and was dropped as "level". The result decides the shape (lost 1–2) and the
  // junk is trimmed: the list keeps its COMPLETE sets (a side on 6+ games, not level: 1-0, 0-1 and 6-6 are not
  // sets). When those make up the result they are the row's sets (`sets`, read by lineGames); else the result's
  // count stands with no games (`partial`), as for a list that is short of the result.
  function lineSetCount(r) {
    var mm = String(r.sets || '').match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
    var a = mm ? +mm[1] : 0, b = mm ? +mm[2] : 0;
    if (r.setGames && r.setGames.length) {
      var w = 0, l = 0;
      for (var i = 0; i < r.setGames.length; i++) {
        var s = r.setGames[i];
        if (s.p == null || s.o == null) continue;
        if (+s.p > +s.o) w++; else if (+s.o > +s.p) l++;
      }
      if ((w || l) && a !== b && a + b > w + l) return { w: a, l: b, partial: true };
      if ((w || l) && a !== b && a + b < w + l) {
        var kept = r.setGames.filter(function (x) {
          return x.p != null && x.o != null && +x.p !== +x.o && Math.max(+x.p, +x.o) >= 6;
        });
        var kw = kept.filter(function (x) { return +x.p > +x.o; }).length;
        return kw === a && kept.length - kw === b ? { w: a, l: b, sets: kept } : { w: a, l: b, partial: true };
      }
      if (w || l) return { w: w, l: l };
    }
    if (!mm) return null;
    if (!a && !b) return null;
    return { w: a, l: b };
  }

  /** Subject games for/against, or null when the row carries no per-set games. */
  function lineGames(r, sets) {
    var list = sets || r.setGames;
    if (!list || !list.length) return null;
    var f = 0, a = 0, seen = 0;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.p == null || s.o == null) continue;
      f += +s.p; a += +s.o; seen++;
    }
    return seen ? { f: f, a: a } : null;
  }

  // ── TEN-384 · Derived lines rebuilt to the reference ──────────────────────
  // Three role tiles (All · As favourite · As underdog) FILTER the ledger: each
  // role is its own table over its own pool (favourite = closing price under
  // 2.00, the TEN-310 Market edge rule). The ledger is one row per line:
  //   Family (caps 800 + Plex "N matches", first row of the family only) ·
  //   Line (13/600 + a 9.5/700 caps small-sample slot) · Cover rate (6px track,
  //   --bar fill = the rate, a 65% tick in --bar-2) · Rate (Plex 14/700; ≥ 65%
  //   on a full sample is --pos text, no pill) · Record (Plex 12, hit–miss) ·
  //   Vs avg pp (Plex 12.5/600, signed).
  // VS AVG PP — definition (stated in the footnote with its value): this line's
  // cover rate minus the AVERAGE COVER RATE of every rated line in the same table
  // (same format, same role), an unweighted mean of the printed rows' rates, in
  // percentage points. Rows without a rate (n < 5) are not in the mean and dash.
  // Hit / Avg margin columns and the favourite / underdog sub-rows are gone.
  var LC_ROLES = [['all', 'All matches'], ['fav', 'As favourite'], ['dog', 'As underdog']];
  var LC_HOT = 65;

  /**
   * The Derived-lines model for one format and one role.
   *
   * Every row states its OWN denominator: a set handicap needs only the set
   * count, a games line needs the per-set games, so the two can differ.
   */
  function lineCoverage(p, fmt, role) {
    var def = LINE_DEFS[fmt] || LINE_DEFS.bo3;
    var spine = calSpine(p) || [];
    var excluded = 0, noScore = 0, unshaped = 0, pool = [];
    for (var i = 0; i < spine.length; i++) {
      var r = spine[i];
      if (r.retired || r.wo) { excluded++; continue; }
      var sc = lineSetCount(r);
      if (!sc) { noScore++; continue; }
      // Format from the scoreline itself, not from the tier: the winner of a
      // best-of-5 took three sets.
      var need = Math.max(sc.w, sc.l);
      if (need !== def.setsToWin) continue;
      // fx6 item 2 · a count that decides no shape (2–2 in this format) stays out of All and the note says so,
      // so the Match shape rows always sum to All matches.
      if (sc.w === sc.l) { unshaped++; continue; }
      var g = sc.partial ? null : lineGames(r, sc.sets);
      // TEN-310: favourite = price under 2.00 (the Market edge rule).
      var MEC = window.MarketEdgeCore;
      // A role needs a CLOSING price on the Market edge basis (`cents` set); a ledger pre-match capture
      // shows as H / A but is not a close, so the row counts as unpriced here and in the note.
      var rl = (r.cents != null && r.price != null && r.price >= 1.01)
        ? ((MEC ? MEC.isFavPrice(r.price) : r.price < 2) ? 'fav' : 'dog') : null;
      pool.push({ sc: sc, g: g, role: rl });
    }
    var all = pool.length;
    var favN = pool.filter(function (m) { return m.role === 'fav'; }).length;
    var dogN = pool.filter(function (m) { return m.role === 'dog'; }).length;
    var sel = role === 'fav' || role === 'dog' ? role : 'all';
    var sub = sel === 'all' ? pool : pool.filter(function (m) { return m.role === sel; });
    var withGames = sub.filter(function (m) { return !!m.g; }).length;

    function hits(m, kind, arg, dir) {
      if (kind === 'ms') return m.sc.w === arg[0] && m.sc.l === arg[1];
      if (kind === 'sh') {
        var sm = m.sc.w - m.sc.l;
        return dir < 0 ? sm > arg : sm > -arg;
      }
      if (!m.g) return null;               // games lines need per-set games
      if (kind === 'gh') {
        var gm = m.g.f - m.g.a;
        return dir < 0 ? gm > arg : gm > -arg;
      }
      var tot = m.g.f + m.g.a;
      return dir > 0 ? tot > arg : tot < arg;
    }
    function tally(kind, arg, dir) {
      var n = 0, hit = 0;
      for (var j = 0; j < sub.length; j++) {
        var h = hits(sub[j], kind, arg, dir);
        if (h === null) continue;          // not evaluable -> out of this row's n
        n++;
        if (h) hit++;
      }
      return { n: n, hit: hit };
    }
    var groups = def.groups.map(function (gr) {
      var rows = gr[1].map(function (spec) {
        return lineRow(spec[0], tally(spec[1], spec[2], spec[3]));
      });
      var needsGames = /Games handicap|Total games/.test(gr[0]);
      return { title: gr[0], n: needsGames ? withGames : sub.length, rows: rows };
    });
    // The table's own average cover rate (the Vs avg pp baseline).
    var rated = [];
    groups.forEach(function (g) { g.rows.forEach(function (r) { if (r.rate != null) rated.push(r.rate); }); });
    var avg = rated.length ? rated.reduce(function (a, b) { return a + b; }, 0) / rated.length : null;
    groups.forEach(function (g) {
      g.rows.forEach(function (r) { r.vs = (r.rate != null && avg != null) ? r.rate - avg : null; });
    });
    return {
      // TEN-384 fix 5 · All = As favourite + As underdog + unpriced, by construction; the note states the
      // unpriced count so the three tiles reconcile on the page.
      groups: groups, n: sub.length, all: all, favN: favN, dogN: dogN, unpriced: all - favN - dogN, role: sel,
      withGames: withGames, excluded: excluded, noScore: noScore, unshaped: unshaped, fmtLabel: def.label, avg: avg
    };
  }

  /** One ledger row's figures, on the sample gate (n < 5 dash, 5–9 small sample). */
  function lineRow(label, t) {
    var n = t.n, hit = t.hit;
    var g = n === 0 ? 'zero' : n < 5 ? 'hard' : n < 10 ? 'soft' : 'full';
    var rate = (g === 'full' || g === 'soft') ? hit / n * 100 : null;
    return {
      label: label, n: n, hit: hit, gate: g, rate: rate,
      hot: g === 'full' && rate >= LC_HOT,
      mark: g === 'soft' ? smallSampleText(n) : (g === 'hard' ? 'n < 5' : ''),
      record: n ? (hit + ENDASH + (n - hit)) : DASH
    };
  }

  var MARKET_TABS = [['winner', 'Match winner'], ['lines', 'Derived lines']];
  // The reference's darker-track segment (founder Q4.2), shared by the Market
  // edge tab row and the Bo3 | Bo5 control: track --card + --edge-6, radius 9,
  // pad 2, gap 3; item pad 5/12, Hanken 11; selected --inner + --edge-10, white
  // 700; idle --text-label 600, no edge.
  function mkSeg(hook, items, active) {
    return '<span data-pp2-seg="' + hook + '" style="display:inline-flex;flex:none;gap:3px;padding:2px;' +
      'background:var(--card);border:1px solid var(--edge-6);border-radius:9px;">' +
      items.map(function (t) {
        var on = active === t[0];
        return '<button type="button" data-pp2="' + hook + '" data-v="' + t[0] + '" ' +
          'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
          'style="cursor:pointer;white-space:nowrap;padding:5px 12px;border-radius:7px;line-height:14px;' +
          'font-family:var(--font-words);font-size:11px;font-weight:' + (on ? 700 : 600) + ';' +
          'color:' + (on ? 'var(--text)' : 'var(--text-label)') + ';' +
          'background:' + (on ? 'var(--inner)' : 'transparent') + ';' +
          'border:1px solid ' + (on ? 'var(--edge-10)' : 'transparent') + ';">' +
          esc(t[1]) + '</button>';
      }).join('') + '</span>';
  }
  /** The tab row: Match winner | Derived lines, with an optional right-hand slot. */
  function marketTabsHtml(right) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;min-height:32px;">' +
      mkSeg('market-tab', MARKET_TABS, state.marketTab === 'lines' ? 'lines' : 'winner') +
      (right || '') + '</div>';
  }
  var MK_CAPS = 'font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
    'text-transform:uppercase;color:var(--text-label);';
  var MK_MONO = 'font-family:\'IBM Plex Mono\',monospace;';

  /** A role tile — the clickable tile (--card + --edge-7; selected --edge-24). */
  function mkTile(hook, attr, id, on, inner, pad, gap) {
    return '<div data-pp2="' + hook + '" ' + attr + '="' + id + '" class="pp2-atile' + (on ? ' on' : '') + '" ' +
      'role="button" aria-pressed="' + (on ? 'true' : 'false') + '" ' +
      'style="cursor:pointer;display:flex;flex-direction:column;gap:' + gap + 'px;min-width:0;' +
      'padding:' + pad + ';border-radius:12px;background:var(--card);' +
      'border:1px solid ' + (on ? 'var(--edge-24)' : 'var(--edge-7)') + ';">' + inner + '</div>';
  }

  /** §5.8 Derived lines (TEN-384 reference build). */
  function renderLinesTab(p) {
    var fmt = state.lcFmt === 'bo5' ? 'bo5' : 'bo3';
    var role = state.lcRole === 'fav' || state.lcRole === 'dog' ? state.lcRole : 'all';
    var d = lineCoverage(p, fmt, role);
    var roleWord = role === 'fav' ? 'as favourite' : role === 'dog' ? 'as underdog' : 'all matches';
    var head = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;min-height:32px;">' +
      '<span style="' + MK_CAPS + '">Coverage by line ' + MIDDOT + ' ' + esc(d.fmtLabel) + ' ' + MIDDOT + ' ' + roleWord + '</span>' +
      mkSeg('lc-fmt', [['bo3', 'Best of 3'], ['bo5', 'Best of 5']], fmt) + '</div>';

    function pctOf(n) { return d.all ? Math.round(100 * n / d.all) + '% of ' + d.all.toLocaleString('en-US') : DASH; }
    var tiles = '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:18px;">' +
      LC_ROLES.map(function (t) {
        var on = role === t[0];
        var n = t[0] === 'fav' ? d.favN : t[0] === 'dog' ? d.dogN : d.all;
        var sub = t[0] === 'all' ? d.fmtLabel + ' ' + MIDDOT + ' set scores on record'
          : t[0] === 'fav' ? pctOf(d.favN) + ' ' + MIDDOT + ' closed under 2.00'
          : pctOf(d.dogN) + ' ' + MIDDOT + ' closed 2.00 or longer';
        return mkTile('lc-role', 'data-v', t[0], on,
          '<span style="' + MK_CAPS + '">' + esc(t[1]) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:24px;font-weight:700;line-height:24px;color:' +
            (on ? 'var(--text)' : 'var(--text-soft)') + ';">' + n.toLocaleString('en-US') + '</span>' +
          '<span style="font-size:11px;color:var(--text-label);">' + esc(sub) + '</span>',
          '14px 16px', 7);
      }).join('') + '</div>';

    if (!d.n) {
      return head + tiles +
        '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
          'text-align:center;font-size:13px;color:var(--text-label);">' +
          (d.all
            ? 'No completed ' + esc(d.fmtLabel) + ' match ' + roleWord + ' carries a scoreline and a closing price.'
            : 'No completed ' + esc(d.fmtLabel) + ' match on record carries a scoreline to derive a line from.') +
        '</div>';
    }

    var GRID = 'display:grid;grid-template-columns:92px 150px minmax(0,1fr) 64px 64px 92px;gap:0 12px;';
    var colHead = '<div style="' + GRID + 'align-items:end;padding:0 4px 8px;border-bottom:1px solid var(--line);">' +
      ['Family', 'Line', 'Cover rate', 'Rate', 'Record', 'Vs avg pp'].map(function (c, i) {
        return '<span style="' + MK_CAPS + (i > 2 ? 'text-align:right;' : '') + '">' + esc(c) + '</span>';
      }).join('') + '</div>';

    var body = d.groups.map(function (g) {
      return g.rows.map(function (r, i) {
        var fam = i ? '<span></span>'
          : '<span style="min-width:0;display:flex;flex-direction:column;">' +
              '<span style="' + MK_CAPS + 'font-weight:800;line-height:1.3;">' + esc(g.title) + '</span>' +
              '<span style="' + MK_MONO + 'font-size:10.5px;color:var(--text-label);margin-top:2px;">' +
                g.n.toLocaleString('en-US') + ' matches</span></span>';
        var fill = r.rate == null ? '' :
          '<span style="position:absolute;left:0;top:0;bottom:0;width:' + Math.max(0, Math.min(100, r.rate)).toFixed(1) +
          '%;background:var(--bar);border-radius:3px;"></span>';
        var bar = '<span style="position:relative;display:block;height:6px;border-radius:3px;background:var(--track);">' +
          fill + '<span style="position:absolute;left:' + LC_HOT + '%;top:-4px;bottom:-4px;width:1px;background:var(--bar-2);"></span></span>';
        var rateTxt = r.rate == null ? DASH : r.rate.toFixed(1) + '%';
        var rateInk = r.rate == null ? DASH_COLOUR : r.hot ? 'var(--pos)' : r.gate === 'soft' ? 'var(--text-label)' : 'var(--text)';
        var vsR = r.vs == null ? null : Math.round(r.vs * 10) / 10;
        var softRow = r.gate === 'soft';
        return '<div data-lc-line="' + esc(r.label) + '" style="' + GRID + (softRow ? 'align-items:start;' : 'align-items:center;') +
          'padding:9px 4px;border-top:1px solid var(--line);">' +
          fam +
          '<span style="display:flex;flex-direction:column;gap:2px;min-width:0;">' +
            '<span style="font-size:13px;font-weight:600;color:' + (r.n ? 'var(--text)' : DASH_COLOUR) + ';overflow:hidden;' +
              'text-overflow:ellipsis;white-space:nowrap;">' + esc(r.label) + '</span>' +
            // fx3 (founder D11): the small-sample mark moved UNDER the rate; the label keeps only "n < 5".
            (r.mark && !softRow ? '<span style="font-family:var(--font-words);font-size:9.5px;font-weight:700;line-height:1.2;' +
              'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);white-space:nowrap;">' +
              esc(r.mark) + '</span>' : '') +
          '</span>' +
          (softRow ? '<span style="display:block;margin-top:6px;">' + bar + '</span>' : bar) +
          (softRow
            ? '<span style="' + MK_MONO + 'font-size:14px;font-weight:700;color:' + rateInk + ';">' + rateOverMark(rateTxt, r.n) + '</span>'
            : '<span style="' + MK_MONO + 'font-size:14px;font-weight:700;text-align:right;color:' + rateInk + ';">' + rateTxt + '</span>') +
          '<span style="' + MK_MONO + 'font-size:12px;text-align:right;white-space:nowrap;color:var(--text-label);">' + r.record + '</span>' +
          '<span style="' + MK_MONO + 'font-size:12.5px;font-weight:600;text-align:right;color:' +
            (vsR == null ? DASH_COLOUR : vsR > 0 ? 'var(--pos)' : vsR < 0 ? 'var(--neg)' : 'var(--text-label)') + ';">' +
            (vsR == null ? DASH : (vsR > 0 ? '+' : vsR < 0 ? MINUS : '') + Math.abs(vsR).toFixed(1) + 'pp') + '</span>' +
        '</div>';
      }).join('');
    }).join('');

    // The reference's note, with this table's real counts and the Vs avg pp
    // baseline it states.
    var note = 'Lines are derived from set scores, not from settled markets ' + EMDASH + ' these are ' +
      'coverage rates, not results against a priced line. Bo3 and Bo5 are counted separately because the ' +
      'same line means a different bet in each. The tick on every bar marks ' + LC_HOT + '% cover. ' +
      'Vs avg pp is this line’s cover rate minus the average cover rate across all lines in this format and role' +
      (d.avg == null ? '' : ' (' + d.avg.toFixed(1) + '%)') + ', in points. ' +
      'Click All matches, As favourite or As underdog to switch the table.';
    note += ' As favourite and As underdog use the Market edge closing price (Pinnacle, else Bet365): ' +
      d.favN + ' + ' + d.dogN + (d.unpriced
        ? ' of ' + d.all + '; the other ' + d.unpriced + (d.unpriced === 1 ? ' carries' : ' carry') +
          ' no closing price and count under All matches only.'
        : ' = all ' + d.all + '.');
    if (d.excluded) note += ' ' + d.excluded + ' retired or abandoned ' + (d.excluded === 1 ? 'match is' : 'matches are') + ' excluded.';
    if (d.unshaped) note += ' ' + d.unshaped + (d.unshaped === 1 ? ' match is' : ' matches are') +
      ' excluded because the set score on file is level and decides no match shape.';
    if (d.withGames < d.n) note += ' Games lines rest on the ' + d.withGames + ' of ' + d.n + ' with per-set games.';
    return head + tiles + colHead + body +
      '<div data-lc="note" style="font-size:11.5px;line-height:18.4px;color:var(--text-label);margin-top:16px;">' + esc(note) + '</div>';
  }

  // ── Q8 · the tour baselines are the DATABASE's Tour aggregates ─────────────
  // Founder Q8 (2026-10-05): As favourite = the Database's Favourites All, As underdog =
  // Underdogs All, and the All tile = both sides of the same matches pooled. Those figures
  // come from `tour-baselines.json` (< 1 KB), written by build-database-yield.js in the SAME
  // run as the Database page's database-yield.json, so the two cannot drift (test-pp2-reconcile.js "Q8").
  // Founder ruling (2026-10-05): the host loads that file WITH the profile data, so the Market
  // edge box and tiles draw complete on first paint, and the profile never loads
  // database-yield.json (the Database page's 1.3 MB store). The host publishes it on
  // `window.tourBaselines`; until it has, or if it failed, the tour figures are absent (a dash),
  // never a stand-in from another population such as the shard's own `tour.all`.
  /** The tour yield (in %) for a role tile: 'all' | 'favourite' | 'underdog', or null. */
  function tourBaselineFor(id) {
    var tb = window.tourBaselines;
    var r = tb && tb.roles && tb.roles[id === 'favourite' || id === 'underdog' ? id : 'all'];
    return r && typeof r.yield === 'number' && isFinite(r.yield) ? 100 * r.yield : null;
  }
  /** "I. Surname" from either "I. Surname" or the shard's "Surname I.". */
  // fx4 item 6: the ONE "I. Surname" rule (initialSurname, the sheet hand-off's): "J.J. Wolf" -> "J. J. Wolf"
  // (was left unspaced), "Cerundolo J.M." -> "J. M. Cerundolo", "Struff J-L." -> "J-L. Struff".
  function mkOppName(name) {
    var s = String(name || '').trim();
    return s ? initialSurname(s) : s;
  }

  // Founder Q6 (TEN-384): Match winner renders as the reference — backing side,
  // all surfaces — with no Back | Fade and no surface control. The paths behind
  // them (state.marketSide / state.marketSurf, the 'market-side' / 'market-surf'
  // handlers, the fade mirror and the surface re-walk in cumulativeChart) are
  // kept; flip MKT_SHOW_FILTERS to render the controls again.
  var MKT_SHOW_FILTERS = false;

  function renderMarketModal(p) {
    var mk = marketFor(p.key);
    if (!mk && marketPending(p.key)) {
      // fx2 item 3 · still loading: say so, claim nothing about the player.
      return '<div data-pp2-pending="market" style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">Loading the priced matches.</div>';
    }
    if (!mk || !mk.headline || !mk.headline.n) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">' +
        'No priced matches on record. The odds archive is tour main-draw only, so a player ' +
        'whose record is Challenger or qualifying has no priced row here.</div>';
    }
    var mktTab = state.marketTab === 'lines' ? 'lines' : 'winner';
    if (mktTab === 'lines') return ANA_STYLE + marketTabsHtml() + renderLinesTab(p);

    var sel = state.marketRole || 'all';
    var side = MKT_SHOW_FILTERS && state.marketSide === 'fade' ? 'fade' : 'back';
    var surf = MKT_SHOW_FILTERS ? (state.marketSurf || 'all') : 'all';
    // Only rows on the basis may be summed (TEN-310: every banded priced row).
    var basisRows = (mk.matches || []).filter(function (m) { return m.inBasis; });
    var tourAll = tourBaselineFor('all');

    function sgn(v, dp, suf) { return v == null ? DASH : signed(v, dp, suf); }
    function ink(v) { return v == null ? DASH_COLOUR : v >= 0 ? 'var(--pos)' : 'var(--neg)'; }

    // The summary line (Plex 12, right of the tabs): the all-matches yield, record,
    // win rate, median odds and the tour figure.
    var H = mk.headline;
    var summary = '<span data-pp2-mk="summary" style="' + MK_MONO + 'font-size:12px;color:var(--text-label);white-space:nowrap;">' +
      'All matches ' + sgn(H.yield, 2, '%') + ' ' + MIDDOT + ' ' +
      recordText(H.wins, H.losses) + ' ' + MIDDOT + ' ' + (H.winRate == null ? DASH : Math.round(H.winRate) + '% win') + ' ' + MIDDOT +
      ' median odds ' + (mk.medianPrice == null ? DASH : mk.medianPrice.toFixed(2)) + ' ' + MIDDOT +
      ' tour ' + (tourAll == null ? DASH : neg(tourAll, 2, '%')) + '</span>';

    var cards = [
      { id: 'all', label: 'All matches', s: mk.roles.all },
      { id: 'favourite', label: 'As favourite', s: mk.roles.favourite },
      { id: 'underdog', label: 'As underdog', s: mk.roles.underdog }
    ].map(function (c) {
      var on = sel === c.id;
      var y = c.s.yield;
      var tourY = tourBaselineFor(c.id);
      var gap = (y == null || tourY == null) ? null : y - tourY;
      return mkTile('market-role', 'data-role', c.id, on,
        '<span style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">' +
          '<span style="' + MK_CAPS + 'color:var(--text);">' + c.label + '</span>' +
          '<span style="' + MK_MONO + 'font-size:11px;color:var(--text-label);">' + (c.s.n || 0).toLocaleString('en-US') + ' matches</span>' +
        '</span>' +
        '<span style="display:flex;align-items:baseline;gap:10px;">' +
          '<span style="' + MK_MONO + 'font-size:26px;font-weight:700;line-height:26px;color:' + ink(y) + ';">' +
            sgn(y, 2, '%') + '</span>' +
          '<span style="' + MK_MONO + 'font-size:12.5px;font-weight:700;color:' + ink(c.s.units) + ';">' +
            sgn(c.s.units, 1, 'u') + '</span>' +
        '</span>' +
        zeroBar(gap, 6, 6, 12) +
        '<span style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">' +
          '<span style="' + MK_MONO + 'font-size:11px;color:var(--text-label);">tour ' +
            (tourY == null ? DASH : neg(tourY, 2, '%')) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:12px;font-weight:700;color:' + ink(gap) + ';">' + sgn(gap, 2, 'pp') + '</span>' +
        '</span>',
        '14px 16px 13px', 10);
    }).join('');

    // Price sensitivity. The selected role tile filters the groups shown.
    var showGroups = sel === 'favourite' ? ['favourite'] : sel === 'underdog' ? ['underdog'] : ['favourite', 'underdog'];
    var BGRID = 'display:grid;grid-template-columns:minmax(0,1fr) 44px 60px 60px 341px 60px;gap:0 12px;';
    var maxAbs = 0;
    showGroups.forEach(function (g) {
      (mk.bands[g] || []).forEach(function (b) { if (b.yield != null) maxAbs = Math.max(maxAbs, Math.abs(b.yield)); });
    });
    // Bars are scaled to the largest |yield| on screen (it reaches 46% of the
    // track either side of break even), with a 5% floor so a flat table does not
    // blow small yields up to full width.
    var bandScale = 46 / Math.max(5, maxAbs);
    var groups = showGroups.map(function (g) {
      var bands = (mk.bands[g] || []).map(function (b) {
        var rate = b.winRate == null ? DASH : b.winRate.toFixed(1) + '%';
        var bid = g + ':' + b.id;
        var open = state.marketBand === bid;
        // A band with no matches stays LISTED with dashes and carries no hook.
        var openable = !!b.n;
        return '<div ' + (openable ? 'data-pp2="market-band" data-band="' + esc(bid) + '" class="pp2-mrow' + (open ? ' on' : '') + '" ' : '') +
          'style="' + BGRID + 'align-items:center;padding:10px 0;border-top:1px solid var(--line);' +
          (openable ? 'cursor:pointer;' : '') +
          (open ? 'background:var(--selected);box-shadow:-10px 0 0 var(--selected),10px 0 0 var(--selected);' : '') + '">' +
          '<span style="' + MK_MONO + 'font-size:13px;font-weight:700;white-space:nowrap;color:' +
            (b.n ? 'var(--text)' : DASH_COLOUR) + ';">' + esc(b.label) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:12px;color:var(--text-label);text-align:right;">' + (b.n || DASH) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:12px;color:var(--text-label);text-align:right;white-space:nowrap;">' +
            (b.n ? recordText(b.wins, b.losses) : DASH) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:13px;font-weight:700;text-align:right;color:' +
            (rate === DASH ? DASH_COLOUR : 'var(--text)') + ';">' + rate + '</span>' +
          bandBar(b.yield) +
          '<span style="' + MK_MONO + 'font-size:13px;font-weight:700;text-align:right;color:' + ink(b.yield) + ';">' +
            (b.yield == null ? DASH : signed(b.yield, 1, '%')) + '</span>' +
          '</div>' +
          (open ? bandDetail(g, b, bid) : '');
      }).join('');
      var gn = (mk.bands[g] || []).reduce(function (a, b) { return a + (b.n || 0); }, 0);
      return '<div style="display:flex;align-items:baseline;justify-content:space-between;padding:14px 0 4px;">' +
        '<span style="' + MK_CAPS + 'font-weight:800;">' + (g === 'favourite' ? 'As favourite' : 'As underdog') + '</span>' +
        '<span style="' + MK_MONO + 'font-size:10.5px;color:var(--text-label);">' + gn.toLocaleString('en-US') + ' matches</span>' +
        '</div>' + bands;
    }).join('');

    var lvl = mk.roles.level && mk.roles.level.n ? mk.roles.level.n : 0;
    var cov = mk.coverage || {};

    return ANA_STYLE + marketTabsHtml(summary) +
      '<div style="display:flex;flex-direction:column;gap:16px;min-width:0;">' +
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">' + cards + '</div>' +
        '<div data-pp2-mk="bands" style="min-width:0;">' +
          '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px;">' +
            '<span style="' + MK_CAPS + '">Price sensitivity ' + MIDDOT + ' his closing price</span>' +
            '<span style="' + MK_MONO + 'font-size:11px;color:var(--text-label);">click a band for its matches</span>' +
          '</div>' +
          '<div style="' + BGRID + 'align-items:center;">' +
            ['Band', 'n', 'W' + ENDASH + 'L', 'Won', 'Yield vs break even', 'Yield'].map(function (h, i) {
              return '<span style="padding:0 0 8px;border-bottom:1px solid var(--line);' + MK_CAPS +
                (i === 4 ? 'text-align:center;' : i ? 'text-align:right;' : '') + '">' + h + '</span>';
            }).join('') + '</div>' +
          groups + priceNote() +
        '</div>' +
        cumulativeChart() +
        bookNote() +
      '</div>';

    /** A signed bar from a 1px --bar-2 zero tick: pos = 50% + v·6% (clamped 4–96%). */
    function zeroBar(v, h, r, tickH) {
      var out = '<span style="position:relative;display:block;height:' + h + 'px;border-radius:' + (h / 2) + 'px;background:var(--track);">' +
        '<span style="position:absolute;left:50%;top:' + ((h - tickH) / 2) + 'px;height:' + tickH + 'px;width:1px;background:var(--bar-2);"></span>';
      if (v == null) return out + '</span>';
      var pos = Math.max(4, Math.min(96, 50 + v * 6));
      return out + '<span style="position:absolute;top:0;bottom:0;border-radius:' + r / 2 + 'px;left:' +
        (v >= 0 ? 50 : pos).toFixed(1) + '%;width:' + Math.abs(pos - 50).toFixed(1) + '%;background:' +
        (v >= 0 ? 'var(--pos)' : 'var(--neg)') + ';"></span></span>';
    }
    /** The band bar: no track, a full-height zero tick, a 6px signed fill. */
    function bandBar(v) {
      var out = '<span style="position:relative;display:block;height:18px;">' +
        '<span style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--bar-2);"></span>';
      if (v == null) return out + '</span>';
      var w = Math.min(48, Math.abs(v) * bandScale);
      return out + '<span style="position:absolute;top:6px;height:6px;border-radius:3px;' +
        (v >= 0 ? 'left:50%;' : 'right:50%;') + 'width:' + w.toFixed(2) + '%;background:' +
        (v >= 0 ? 'var(--pos)' : 'var(--neg)') + ';"></span></span>';
    }
    /**
     * The file's `priceNote`, templated to this player's real counts. "all" says
     * the bands COVER the banded population (favourite + underdog), not the
     * headline: a level close is neither role and is banded nowhere.
     */
    function priceNote() {
      var nFav = (mk.roles.favourite && mk.roles.favourite.n) || 0;
      var nDog = (mk.roles.underdog && mk.roles.underdog.n) || 0;
      var banded = nFav + nDog;
      var nBands = (mk.bands.favourite || []).length + (mk.bands.underdog || []).length;
      var him = esc(shortName(p));
      var txt;
      if (sel === 'favourite') {
        txt = 'Bands are set on his own closing price, across the ' + nFav + ' match' +
          (nFav === 1 ? '' : 'es') + ' that closed ' + him + ' under 2.00 (favourite).';
      } else if (sel === 'underdog') {
        txt = 'Bands are set on his own closing price, across the ' + nDog + ' match' +
          (nDog === 1 ? '' : 'es') + ' that closed ' + him + ' at 2.00 or longer (underdog).';
      } else {
        txt = 'Bands are set on his own closing price. The ' + numWord(nBands) + ' bands cover ' +
          (lvl ? 'the ' + banded : 'all ' + banded) + ' banded match' + (banded === 1 ? '' : 'es') +
          (lvl ? ' ' + MIDDOT + ' ' + lvl + ' level close' + (lvl === 1 ? '' : 's') +
            ' sit in neither role and are banded nowhere.' : '.');
      }
      var straddle = cov.bandStraddle || 0;
      if (straddle) {
        txt += ' ' + straddle + ' row' + (straddle === 1 ? '' : 's') + ' sit' + (straddle === 1 ? 's' : '') +
          ' in the outer band of ' + (straddle === 1 ? 'its' : 'their') + ' role at a price outside that ' +
          'band’s printed range.';
      }
      return '<div style="font-size:12px;line-height:19.2px;color:var(--text-label);margin-top:12px;">' + txt + '</div>';
    }
    function numWord(n) {
      return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
        'nine', 'ten'][n] || String(n);
    }
    /**
     * The one-line footnote: the split by book over the basis rows (every
     * figure on the page is struck on closing prices, Pinnacle, else Bet365),
     * the retirement settlement note, and the shard's build stamp.
     */
    function bookNote() {
      var ps = { n: 0, pl: 0 }, b3 = { n: 0, pl: 0 };
      basisRows.forEach(function (m) {
        var t = /^pinnacle/.test(String(m.book || '')) ? ps : b3;
        t.n++; t.pl += (m.pl || 0);
      });
      function y(t) { return t.n ? signed(100 * t.pl / t.n, 2, '%') : DASH; }
      var built = marketBuiltText(mk);
      return '<div data-pp2-mk="note" style="font-size:12px;line-height:19.2px;color:var(--text-label);">' +
        H.n + ' priced on closing prices (Pinnacle, else Bet365). Split by book: ' +
        y(ps) + ' across ' + ps.n.toLocaleString('en-US') + ' Pinnacle-priced matches, ' +
        y(b3) + ' across ' + b3.n.toLocaleString('en-US') + ' matches priced on Bet365. ' +
        'Tour = the Database Tour figures (ATP main tour, all surfaces, 2010 on).' +
        (lvl ? ' ' + lvl + ' level close' + (lvl === 1 ? '' : 's') + ' in All matches only.' : '') +
        (window.MarketEdgeCore ? ' <span data-ret-note="profile-me">' + esc(window.MarketEdgeCore.RET_SETTLE_NOTE) + '</span>' : '') +
        (built ? ' <span data-market-built style="' + MK_MONO + 'font-size:11px;">' + esc(marketBuiltText(mk)) + '</span>' : '') +
        '</div>';
    }
    /** The band row -> match drill. Reads the shard's own rows. */
    function bandDetail(group, b, bid) {
      var role = group === 'favourite' ? 'fav' : 'dog';
      var rows = basisRows.filter(function (m) {
        return m.role === role && (m.band || priceBandId(m.price, role)) === b.id;
      }).sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : 0; });
      var shown = rows.slice(0, 40);
      var list = shown.map(function (m) {
        return '<div style="display:grid;grid-template-columns:12px 72px minmax(0,1.4fr) 58px 52px 58px;' +
          'gap:0 10px;align-items:center;padding:6px 0;border-top:1px solid var(--line);">' +
          '<span style="width:8px;height:8px;border-radius:2px;background:' +
            (m.won ? 'var(--pos)' : 'var(--neg)') + ';"></span>' +
          '<span style="' + MK_MONO + 'font-size:11px;color:var(--text-label);">' + esc(styleMonthYear(m.date)) + '</span>' +
          '<span style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            esc(mkOppName(m.opp)) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:11px;color:var(--text-soft);text-align:right;">' +
            (m.price == null ? DASH : m.price.toFixed(2)) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:10.5px;color:var(--text-label);text-align:right;white-space:nowrap;">' + esc(shortRound(m.round)) + '</span>' +
          '<span style="' + MK_MONO + 'font-size:11.5px;font-weight:700;text-align:right;color:' +
            (m.pl >= 0 ? 'var(--pos)' : 'var(--neg)') + ';">' + signed(m.pl, 2, 'u') + '</span>' +
          '</div>';
      }).join('');
      var note = shown.length < rows.length
        ? 'showing ' + shown.length + ' of ' + rows.length + ' ' + MIDDOT + ' newest first'
        : rows.length + ' match' + (rows.length === 1 ? '' : 'es');
      // The drill must reconcile to the row that opened it; say so if not.
      var recon = rows.length === b.n ? '' :
        ' ' + MIDDOT + ' band counts ' + b.n + ', ' + rows.length + ' rows carry a matching price';
      return '<div data-pp2-mk="drill" style="background:var(--card);border:1px solid var(--edge-6);border-radius:10px;' +
        'padding:14px 16px 12px;margin:8px 0 10px;">' +
        '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px;">' +
          '<span style="display:flex;align-items:baseline;gap:10px;min-width:0;">' +
            '<span style="' + MK_CAPS + 'white-space:nowrap;">' + esc(b.label) + ' ' + MIDDOT + ' ' +
              (group === 'favourite' ? 'favourite' : 'underdog') + '</span>' +
            '<span style="' + MK_MONO + 'font-size:11.5px;color:var(--text-label);">' +
              recordText(b.wins, b.losses) + ' ' + MIDDOT + ' ' + note + recon + '</span>' +
          '</span>' +
          '<span style="' + MK_MONO + 'font-size:12.5px;font-weight:700;white-space:nowrap;color:' + ink(b.units) + ';">' +
            (b.units == null ? DASH : signed(b.units, 2, 'u')) + '</span>' +
        '</div>' +
        '<div class="pp2-yscroll" style="max-height:360px;overflow-y:auto;padding-right:12px;">' + list + '</div></div>';
    }
    /**
     * Cumulative units, the reference's panel: no area fill, dotted guides
     * (--viz-guide 2/6), the break-even rule (--viz-rule) with its caps label, an
     * end dot. The shard's rows are walked in date order on the BACK side; Fade
     * (its mirror) and the surface re-walk stay wired behind MKT_SHOW_FILTERS.
     */
    function cumulativeChart() {
      var rows = basisRows.filter(function (m) {
        if (surf !== 'all' && String(m.surface || '') !== surf) return false;
        if (sel === 'favourite') return m.role === 'fav';
        if (sel === 'underdog') return m.role === 'dog';
        return true;
      }).slice().sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : 0; });
      var pts = [], cents = 0;
      rows.forEach(function (m) {
        // Integer cents: float drift here is visible drift in the chart.
        var c = m.won ? Math.round(m.price * 100) - 100 : -100;
        cents += (side === 'fade' ? -c : c);
        pts.push({ d: m.date, c: cents / 100 });
      });
      var title = 'Cumulative units ' + MIDDOT + ' ' +
        (sel === 'favourite' ? 'when favourite' : sel === 'underdog' ? 'when underdog' : 'all priced matches') +
        (surf === 'all' ? '' : ' ' + MIDDOT + ' ' + surf) +
        (side === 'fade' ? ' ' + MIDDOT + ' fading' : '');
      var controls = !MKT_SHOW_FILTERS ? '' :
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
          mkSeg('market-side', [['back', 'Back'], ['fade', 'Fade']], side) +
          mkSeg('market-surf', [['all', 'All surfaces'], ['Hard', 'Hard'], ['Clay', 'Clay'], ['Grass', 'Grass']], surf) +
        '</div>';
      var last = pts.length ? pts[pts.length - 1].c : null;
      var PH = 260;
      var body;
      if (pts.length < 2) {
        body = '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
          'text-align:center;font-size:13px;color:var(--text-label);">' +
          (pts.length ? 'One priced match in this filter ' + EMDASH + ' a cumulative line needs at least two points.'
            : 'No priced matches in this filter.') + '</div>';
      } else {
        var W = 1000, Hh = PH;
        // The series opens at 0 before the first match, on the break-even rule.
        var series = [0].concat(pts.map(function (q) { return q.c; }));
        var lo = Math.min.apply(null, series), hi = Math.max.apply(null, series);
        var pad = (hi - lo) * 0.1 + 0.6;
        lo -= pad; hi += pad;
        var Y = function (v) { return (1 - (v - lo) / (hi - lo)) * Hh; };
        var X = function (i) { return (i / (series.length - 1)) * W; };
        var line = series.map(function (v, i) {
          return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        }).join(' ');
        var zeroY = Y(0);
        var span = hi - lo;
        var step = span > 40 ? 10 : span > 20 ? 5 : span > 10 ? 2 : 1;
        var grid = [];
        for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) {
          var gv = Math.round(v * 100) / 100;
          grid.push({ y: Y(gv), label: (gv > 0 ? '+' : gv < 0 ? MINUS : '') + Math.abs(gv) + 'u', zero: Math.abs(gv) < 1e-9 });
        }
        // One tick per season, at the index of that season's first priced row
        // (the x axis is match index, not time); a colliding label is dropped.
        var ticks = [], seenYear = {}, lastLeft = -99;
        pts.forEach(function (q, i) {
          var yr = String(q.d).slice(0, 4);
          if (!yr || seenYear[yr]) return;
          seenYear[yr] = 1;
          var leftPct = X(i + 1) / W * 100;
          if (leftPct - lastLeft < 4.5) return;
          lastLeft = leftPct;
          ticks.push({ leftPct: leftPct.toFixed(1) + '%', label: yr });
        });
        var endTop = Y(series[series.length - 1]);
        body =
          '<div style="display:flex;gap:10px;min-width:0;">' +
            '<div style="position:relative;width:40px;height:' + PH + 'px;flex:none;">' +
              grid.map(function (q) {
                return '<span style="position:absolute;right:0;top:' + q.y.toFixed(1) + 'px;transform:translateY(-50%);' +
                  MK_MONO + 'font-size:10px;color:var(--text-label);white-space:nowrap;">' + q.label + '</span>';
              }).join('') +
            '</div>' +
            '<div style="position:relative;flex:1;height:' + PH + 'px;min-width:0;">' +
              '<svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="none" ' +
                'style="position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible;">' +
                grid.filter(function (q) { return !q.zero; }).map(function (q) {
                  return '<line x1="0" x2="' + W + '" y1="' + q.y.toFixed(1) + '" y2="' + q.y.toFixed(1) + '" stroke="var(--viz-guide)" ' +
                    'stroke-width="1" stroke-dasharray="2 6" vector-effect="non-scaling-stroke"></line>';
                }).join('') +
                '<line x1="0" x2="' + W + '" y1="' + zeroY.toFixed(1) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--viz-rule)" ' +
                  'stroke-width="1" vector-effect="non-scaling-stroke"></line>' +
                '<path d="' + line + '" fill="none" stroke="var(--bar)" stroke-width="2" ' +
                  'stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>' +
              '</svg>' +
              '<span style="position:absolute;right:0;top:' + zeroY.toFixed(1) + 'px;transform:translateY(-130%);' +
                MK_CAPS + '">Break even</span>' +
              '<span style="position:absolute;left:100%;top:' + endTop.toFixed(1) + 'px;width:8px;height:8px;margin:-4px 0 0 -4px;' +
                'box-sizing:content-box;border-radius:50%;background:var(--bar);border:2px solid var(--line);transform:translate(-2px,-2px);"></span>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;margin-top:8px;">' +
            '<span style="width:40px;flex:none;"></span>' +
            '<div style="position:relative;flex:1;height:16px;min-width:0;border-top:1px solid var(--line);">' +
              ticks.map(function (t) {
                return '<span style="position:absolute;top:5px;left:' + t.leftPct + ';transform:translateX(-50%);' +
                  MK_MONO + 'font-size:10.5px;color:var(--text-label);">' + esc(t.label) + '</span>';
              }).join('') +
            '</div>' +
          '</div>';
      }
      return '<div data-pp2-mk="chart" style="background:var(--card);border:1px solid var(--edge-6);border-radius:12px;' +
        'padding:14px 16px 12px;min-width:0;">' +
        '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;">' +
          '<span style="display:flex;flex-direction:column;gap:5px;">' +
            '<span style="' + MK_CAPS + '">' + esc(title) + '</span>' +
            '<span style="' + MK_MONO + 'font-size:11px;color:var(--text-label);">flat 1u per match at closing odds ' + MIDDOT + ' ' +
              pts.length.toLocaleString('en-US') + ' match' + (pts.length === 1 ? '' : 'es') + '</span>' +
          '</span>' +
          '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">' +
            '<span style="' + MK_MONO + 'font-size:24px;font-weight:700;line-height:24px;color:' + ink(last) + ';">' +
              (last == null ? DASH : signed(last, 1, 'u')) + '</span>' +
            '<span style="' + MK_CAPS + '">Profit at 1u flat</span>' +
          '</span>' +
        '</div>' +
        controls + body + '</div>';
    }
  }

  // Build stamp (TEN-263 follow-up, founder 2026-09-24): "rebuilt 24 Sep 14:05Z" from the
  // shard's builtAt (build-market-edge.js, every pipeline run). No stamp, or one that does
  // not parse, prints nothing — never a guessed time.
  function marketBuiltText(mk) {
    var t = mk && typeof mk.builtAt === 'string' ? Date.parse(mk.builtAt) : NaN;
    if (!isFinite(t)) return '';
    var d = new Date(t), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return 'rebuilt ' + d.getUTCDate() + ' ' + mon + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + 'Z';
  }
  function marketPinnacleEnd(mk) {
    var m = (mk.coverage && mk.coverage.pinnacleEndByLevel) || {};
    var latest = null;
    Object.keys(m).forEach(function (k) { if (!latest || m[k] > latest) latest = m[k]; });
    return latest || DASH;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.4 CALENDAR RECORD — Calendar + 2026 tabs (TEN-384 Q1)
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
    var th = tournHistOf(p);
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
  var JOIN_WIN_0 = 2, JOIN_WIN_1 = 7, JOIN_WIN_2 = 14;
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
  function calSpine(p) {
    var ch = careerHistoryFor(p.key);
    var mk = marketFor(p.key);
    var b365 = window.bet365History;
    // fx6 item 6 · the page's match-closes shard (fhLoadCloses), bridged by the host; null until it lands.
    var cl = typeof window.pp2ClosesOf === 'function' ? window.pp2ClosesOf(p.key) : null;
    if (calSpine._k === p.key && calSpine._ch === ch && calSpine._mk === mk && calSpine._b === b365 &&
        calSpine._cl === cl && calSpine._v) {
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
      // TEN-384 (founder ruling 2026-10-07) · THE MARKET EDGE BASIS: every in-basis row of the Market
      // edge shard — Pinnacle closing, else Bet365 closing (build-market-edge.js `inBasis`) — prices the
      // row, not Pinnacle alone. One price per match on the page: Calendar yields, Court speed H / A and
      // units, Derived lines roles and Matchup units all read this one join, so they agree with the
      // Market edge box over the same matches.
      var pin = (hit && hit.inBasis !== false && hit.price != null &&
        hit.pl != null && isFinite(hit.pl)) ? hit : null;
      var rf = rfByDate[kd] || null;
      // TEN-384 fix 6 · where the Market edge shard holds no close, the bet365 pre-match capture (the
      // ledger's second source, b365PriceFor) prices the row for DISPLAY only (H / A): it carries no
      // P&L, so it never enters a yield, a unit or a favourite/underdog role. ledgerRows() reads this
      // row back, so the ledger and every modal show one price per match.
      // TEN-384 fx6 item 6 (founder r2) · Tokyo 2026 read "—" under H / A on all five rows: the shard is built from
      // the Tennis-Data archive (Alcaraz's last row 2026-09-09) and the bet365 capture's October file is empty,
      // while the page's own closes shard (match-closes/{key}.json, `cap` = our captured Pinnacle / Bet365 closes)
      // already held four of the five. Between the two, the row now takes the price EVERY other surface reads for
      // it — the Match analysis join (meRowFromCareer -> fhCloseFor, R8 book order), bridged as
      // window.pp2CareerClose. Display only, like the capture: no P&L, never a yield, unit or role basis.
      var cc = !pin && cl && typeof window.pp2CareerClose === 'function' ? window.pp2CareerClose(p.key, r) : null;
      var lr = pin ? null : (cc || b365PriceFor(p.name, { date: r.date, opponent: r.opponent }));
      return {
        date: r.date, year: y, mon: parseInt(r.date.slice(5, 7), 10) - 1,
        won: !!r.won,
        surface: r.surface ? String(r.surface).toLowerCase() : null,
        court: hit ? (hit.court || null) : null,
        // TEN-395 · career-history's own per-match court flag (bsp-pipeline.js playerMatchHistory): true = counted in
        // the season table's Indoors, by the table's own tournament_key join. null on a row built before the flag.
        seasonIndoor: typeof r.indoor === 'boolean' ? r.indoor : null,
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
        // Per-set games. `recentForm` is the richer row where it reaches (it
        // carries both sides' tiebreak totals), so it still wins; career-history
        // now carries its OWN subject-oriented `sets` array for every other row
        // — TEN-206 item 1 wrote it and nothing on this page read it, so the
        // column sat at recentForm's ~10% of the spine while the store held
        // ~99%. Same wiring-only shape as stylesStore and the whole-event note.
        // Fills as the shards rebuild: a data pass, not a render change.
        setGames: (rf && rf.sets && rf.sets.length) ? rf.sets
          : ((r.sets && r.sets.length) ? r.sets : null),
        score: (rf && rf.sets && rf.sets.length) ? setScoreText(rf, ', ')
          : ((r.sets && r.sets.length) ? setScoreText({ sets: r.sets }, ', ')
            : (r.result ? String(r.result) : DASH)),
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
        price: pin ? pin.price : (lr ? lr.price : null),
        oppPrice: pin ? (pin.oppPrice != null ? pin.oppPrice : null) : (lr ? lr.oppPrice : null),
        // Which source priced the row: 'close' = the Market edge basis (carries `cents`), 'prematch' =
        // the ledger's bet365 capture (H / A only), null = unpriced.
        // fx6: 'closes' = the page's match-closes join (H / A only, no P&L).
        priceBasis: pin ? 'close' : (lr && lr.price != null ? (lr === cc ? 'closes' : 'prematch') : null),
        book: pin ? (pin.book || null) : (lr ? lr.book : null),
        role: pin ? (pin.role || null) : null,
        // The Market edge row's own result and retirement flag, kept so the join can be audited
        // against career-history's `won` (tools/test-ten384-figures-agree.js "J").
        dateKind: r.src === 'archive' ? 'start' : 'match',   // archive rows carry the event's START date
        mkWon: pin ? !!pin.won : null, mkRet: pin ? !!pin.ret : null, mkDate: pin ? (pin.date || null) : null,
        // career-history's feed scope ('atp' / 'chitf'), the same split careerByYear's Tier rows carry —
        // the Career record's Tier control filters the dated window on it.
        tier: r.level === 'atp' ? 'atp' : r.level ? 'chitf' : null,
        // Integer cents: a float sum re-ordered moved a painted card by 0.01u
        // once already, so every P&L here is accumulated in whole cents and
        // divided only at the point it is printed.
        cents: pin ? Math.round(pin.pl * 100) : null,
        // Item 27 · WALKOVERS. career-history carries no walkover flag; the one
        // marker it has is an EMPTY result string (" - ") where no set was ever
        // played. recentForm does carry `walkover`, so it is preferred wherever
        // the ±0-day join reaches (66 of Zverev's 775 rows). Either signal sets
        // this flag; scoreWithStatus() prints it as "w/o".
        wo: !!(rf && rf.walkover) || !/\d/.test(String(r.result || '')),
        sheetId: r.date + '|' + (r.opponent || '')
      };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    calSpine._k = p.key; calSpine._ch = ch; calSpine._mk = mk; calSpine._b = b365; calSpine._cl = cl; calSpine._v = out;
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
  // TEN-384 fix 5/6 · the window tiers pair on a SHARED SURNAME TOKEN, not on oppKeyOf()'s one-key
  // surname. The two stores spell a multi-part name differently and oppKeyOf() cannot equate them:
  // market-edge (Tennis-Data) writes "Struff J.L.", "Ramos-Vinolas A.", "Mpetshi G.", "Del Potro J.M.",
  // career-history writes "J-L. Struff", "A. Ramos", "G. Mpetshi Perricard", "J. Martin del Potro".
  // Measured: 16 of Alcaraz's 353 Market edge rows and 21 of Thompson's 319 never joined, so the
  // Calendar's yield ran on fewer matches than the Market edge box. A token is a run of 4+ letters
  // (initials and "del" / "van" never count). The uniqueness rule is unchanged and still runs from
  // BOTH sides inside the window, so a looser key cannot pair an ambiguous match.
  function nameTokens(name) {
    var out = {};
    String(name || '').toLowerCase().split(/[^a-z]+/).forEach(function (t) { if (t.length >= 4) out[t] = 1; });
    return out;
  }
  function byToken(list, nameOf) {
    var m = {};
    for (var i = 0; i < list.length; i++) {
      var tk = nameTokens(nameOf(list[i]));
      for (var t in tk) if (Object.prototype.hasOwnProperty.call(tk, t)) (m[t] = m[t] || []).push(i);
    }
    return m;
  }
  function calWindowJoin(rows, mrows) {
    var out = {}, taken = {};
    var mTok = mrows.map(function (r) { return nameTokens(r.opp); });
    var sTok = rows.map(function (r) { return nameTokens(r.opponent); });
    var mBy = byToken(mrows, function (r) { return r.opp; });
    var sBy = byToken(rows, function (r) { return r.opponent; });
    function near(map, toks) {
      var seen = {}, idx = [];
      for (var t in toks) {
        if (!Object.prototype.hasOwnProperty.call(toks, t)) continue;
        (map[t] || []).forEach(function (i) { if (!seen[i]) { seen[i] = 1; idx.push(i); } });
      }
      return idx;
    }
    // Item 26's date fact, applied as a DIRECTION: an `archive` row of career-history (every row before
    // 2021 and the 2021 backfill; 80%+ of them dated on a Monday) carries the tournament's START date,
    // so the match itself is that day or later — never before it. A price dated before the start
    // belongs to the previous week's event: Djokovic's Rome 2016 final (dated Mon 9 May) is not the
    // Madrid final of Sun 8 May, and Carreno Busta's Rio 2017 (Mon 20 Feb) is not the Buenos Aires
    // semi-final of Sat 18 Feb. One day of slack, for an OPENING round only: the archive dates some
    // Sunday starts on the Monday (Sydney 2019: Thompson–Mannarino played Sun 6 Jan, dated Mon 7 Jan),
    // and the day before a start can hold a first match but never a quarter-final, semi or final.
    // A `fixtures` row carries the match's own date, so the window is symmetric there.
    function fits(spineIdx, mi, win) {
      var sd = dayNum(rows[spineIdx].date), md = dayNum(mrows[mi].date);
      if (sd == null || md == null) return false;
      if (Math.abs(md - sd) > win) return false;
      if (rows[spineIdx].src !== 'archive' || md >= sd) return true;
      var rc = roundClass(mrows[mi].round);
      return md === sd - 1 && rc !== 'F' && rc !== 'SF' && rc !== 'QF';
    }
    function pass(win, useRound) {
      for (var i = 0; i < rows.length; i++) {
        if (out[i]) continue;
        var r = rows[i], d = dayNum(r.date);
        if (d == null) continue;
        var cands = near(mBy, sTok[i]).filter(function (mi) {
          return fits(i, mi, win) && !taken[mi];
        });
        if (!cands.length) continue;
        // Back-check: which spine rows could also claim these candidates?
        var back = [];
        cands.forEach(function (mi) {
          near(sBy, mTok[mi]).forEach(function (si) {
            if (fits(si, mi, win) && back.indexOf(si) < 0) back.push(si);
          });
        });
        if (useRound && cands.length > 1) {
          var rc = roundClass(r.round);
          if (rc) {
            cands = cands.filter(function (mi) { return roundClass(mrows[mi].round) === rc; });
            back = back.filter(function (si) { return roundClass(rows[si].round) === rc; });
          }
        }
        if (cands.length === 1 && back.length === 1 && back[0] === i) {
          out[i] = mrows[cands[0]];
          taken[cands[0]] = true;
        }
      }
    }
    // TEN-384 · a same-day pass and a ±2-day pass run first: two brothers or a repeat opponent at
    // back-to-back events (F. and J. M. Cerundolo at Buenos Aires and Rio 2026, Lajovic at Buenos Aires
    // and Rio 2023) are ambiguous at ±7 but unique on the day or at ±2 from both sides. Every pass keeps
    // the both-sides uniqueness rule.
    pass(0, false);
    pass(JOIN_WIN_0, false);
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

  // ── FOUNDER 2026-09-18 · the two residual populations, measured apart ──────
  // The §4 footnote used to print one signed net (`scope.m - scope.n`). Two
  // different facts were being subtracted from each other:
  //
  //   undated : matches the CAREER RECORD counts that carry no dated match row,
  //             so no month can hold them. The grid is smaller than the tile.
  //   outside : dated match rows whose YEAR the career spine's window does not
  //             cover. The grid is larger than the tile.
  //
  // They are independent and can both be non-zero on the same player, where the
  // net is meaningless and can be exactly zero while both counts are large. The
  // window is the spine's own YEAR SET, not its first-to-last span, so a gap
  // year inside the window is counted correctly rather than assumed covered.
  function calResidual(p) {
    var win = {};
    spineYears(p).forEach(function (y) { win[String(y.year)] = 1; });
    var inWindow = 0, out = [];
    calSpine(p).forEach(function (r) {
      if (win[String(r.year)]) inWindow += 1; else out.push(String(r.year));
    });
    out.sort();
    var m = spineTotal(p).n;
    return {
      m: m,
      // SIGNED (TEN-384 fx2 item 8; it used to be clamped at zero). If the dated store ever held MORE
      // in-window rows than the spine totals, the negative is a third, different defect: it is never
      // printed as this one (calResidualNote prints only > 0) and never hidden either —
      // tools/test-ten384-figures-agree.js fails on a negative undated count.
      undated: m - inWindow,
      outside: out.length,
      from: out.length ? out[0] : null,
      to: out.length ? out[out.length - 1] : null
    };
  }
  /** Each clause only when its own count is non-zero; never a net. */
  function calResidualNote(r) {
    var parts = [];
    if (r.undated > 0) {
      parts.push(r.undated + (r.undated === 1 ? ' match carries' : ' matches carry') +
        ' no dated match row');
    }
    if (r.outside > 0) {
      var span = r.from === r.to ? r.from : r.from + ENDASH + r.to;
      parts.push(r.outside + (r.outside === 1 ? ' dated match falls' : ' dated matches fall') +
        ' outside the tile’s window (' + span + ')');
    }
    if (!parts.length) return '';
    return ' The career record above holds ' + r.m + ' matches ' + MIDDOT + ' ' +
      parts.join(' ' + MIDDOT + ' ') + '.';
  }

  // Year x month buckets over the filtered rows. `n`/`won`/`lost` count the
  // CAREER rows (item 1); `cents`/`priced` count only the priced subset (Market edge basis, TEN-384)
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

  // ═══════════════════════════════════════════════════════════════════════════
  // TEN-384 · CALENDAR RECORD (founder ruling Q1, 2026-10-05)
  // ═══════════════════════════════════════════════════════════════════════════
  // Tabs = Calendar (default) · 2026 on the Darker track. The Streaks tab is REMOVED (its tiles, the run
  // timeline, "What follows a run" and the code only it used). The Calendar tab is the reference's
  // two joined panels: (1) "Calendar form" — head, the four tiles as ONE joined strip, the heat grid with
  // a Season column and a Career row, the cell drill; (2) "By month" — the Priced sample head, the
  // findings strip, the zero-anchored "Vs other months" bars, the Swing row (ruling Q2) and the footer
  // rows. Every gate is the one the tab already had: tiles and findings full at n ≥ 10, grey +
  // "small sample · n=X" at 5–9 (fix item 9), a dash under 5; month yields and bars dash under five priced matches.
  // The 2026 tab's season. ONE constant drives both the tab's label and the rows it counts, so the
  // label can never name one season while the figures describe another.
  var CAL_SEASON = '2026';
  var CAL_TABS = [['calendar', 'Calendar'], [CAL_SEASON, CAL_SEASON]];
  function calTabOf() { return state.calTab === CAL_SEASON ? CAL_SEASON : 'calendar'; }
  function calSurfaceWord(surf) {
    if (!surf || surf === 'all') return 'all surfaces';
    var l = (CAL_SURFACES.filter(function (s) { return s.id === surf; })[0] || {}).label;
    return l ? l.toLowerCase() : surf;
  }
  function calTabRow() {
    var tab = calTabOf();
    var surf = state.calSurface || 'all';
    var tabs = recSegTrack(CAL_TABS.map(function (t) {
      return recSegBtn('cal-tab', t[0], t[1], tab === t[0], false);
    }).join(''), false);
    // The surface control belongs to the Calendar tab; the 2026 tab counts every match of the season.
    var right = tab === 'calendar' ? recLabelledSeg('Surface', CAL_SURFACES.map(function (s) {
      return recSegBtn('cal-surface', s.id, s.label, surf === s.id, true);
    }).join('')) : '';
    return recTabRow(tabs, right);
  }
  function renderSeasonModal(p) {
    if (calTabOf() === CAL_SEASON) return calTabRow() + renderCal2026Tab(p);
    if (!calSpine(p).length) {
      // PENDING BEFORE EMPTY (the guard the Streaks tab carried, moved here with it): an unsettled lazy
      // store and a player with no rows both come back empty; only the store can tell them apart.
      if (!careerHistorySettled(p.key)) {
        return calTabRow() + speedEmptyBox('The career match store has not loaded, so the calendar cannot be drawn yet.');
      }
      return calTabRow() + calEmpty('No dated career match rows on record, so there is no match to place in a calendar.');
    }
    return calTabRow() + renderCalTab(p);
  }
  // ── the 2026 tab (founder ruling, 2026-10-05 second card) ──────────────────────────────────────
  // Three tiles (Win–loss · Win rate · Best result, figures white), then "Month by month · 2026": one
  // ruled row per month he played, Jan → latest, each opening that month's matches on the profile
  // ledger grid. NO grid row, priced strip or Swing row here — those belong to the Calendar tab.
  //
  // Population: the SAME career spine the Calendar tab reads (calSpine), cut to CAL_SEASON and never
  // surface-filtered. Records count EVERY match — the Form rule's Laver Cup / exhibition exclusion
  // applies to the ribbon and the ledger only (founder), so it is not applied here.
  //
  // Best result = the deepest round reached at any event this season (a won final = the title, deeper
  // than a lost final). TIE RULE: equal depth goes to the more prestigious event (Grand Slam > Tour
  // Finals > Masters 1000 > ATP 500 > ATP 250 > anything else), then to the EARLIER event. Rows whose
  // round is not a draw round (team events, round robins, a dash) carry no depth and cannot win.
  // The month in the support line is the month the event STARTED (its first match on record), so an
  // Australian Open whose final falls on 1 February still reads "January".
  var CAL26_DEPTH = { W: 0, F: 1, SF: 2, QF: 3, R16: 4, R32: 5, R64: 6, R128: 7, R256: 8 };
  var CAL26_WORD = { W: 'title', F: 'final', SF: 'semi-final', QF: 'quarter-final', R16: 'round of 16',
    R32: 'round of 32', R64: 'round of 64', R128: 'round of 128', R256: 'round of 256' };
  var CAL26_SLAMS = { 'australian open': 1, 'roland garros': 1, 'french open': 1, 'wimbledon': 1, 'us open': 1 };
  function cal26Prestige(ev, level) {
    var l = String(level || '').toLowerCase();
    if (/grand slam/.test(l) || CAL26_SLAMS[String(ev || '').toLowerCase()]) return 5;
    if (/finals/.test(l) || /atp finals|tour finals/i.test(String(ev || ''))) return 4;
    if (/1000/.test(l)) return 3;
    if (/500/.test(l)) return 2;
    if (/250/.test(l)) return 1;
    return 0;
  }
  // "AO" style: the dashboard's hot-line tournament codes (FH_TCODE, the Match analysis's own map),
  // only where that map names the event; anything it does not name keeps our event name.
  function cal26Short(ev) {
    try {
      /* global FH_TCODE, psNormTour */
      if (typeof FH_TCODE === 'object' && FH_TCODE && typeof psNormTour === 'function') {
        var c = FH_TCODE[psNormTour(String(ev || ''))];
        if (c) return c;
      }
    } catch (e) { /* the host map is optional */ }
    return String(ev || DASH);
  }
  function cal26Rows(p) {
    return calSpine(p).filter(function (r) { return r.year === CAL_SEASON; });
  }
  function cal26Best(rows) {
    var evs = [], by = {};
    rows.forEach(function (r) {
      var k = r.event || DASH;
      if (!by[k]) { by[k] = { ev: k, rows: [], level: null }; evs.push(by[k]); }
      by[k].rows.push(r);
      if (r.level && !by[k].level) by[k].level = r.level;
    });
    var best = null;
    evs.forEach(function (e) {
      var deepest = null;
      e.rows.forEach(function (r) {
        var code = r.round === 'F' && r.won ? 'W' : r.round;
        if (!Object.prototype.hasOwnProperty.call(CAL26_DEPTH, code)) return;
        if (deepest == null || CAL26_DEPTH[code] < CAL26_DEPTH[deepest]) deepest = code;
      });
      if (deepest == null) return;
      var cand = { ev: e.ev, code: deepest, depth: CAL26_DEPTH[deepest], prestige: cal26Prestige(e.ev, e.level),
        start: e.rows[0].date, mon: e.rows[0].mon };
      if (!best || cand.depth < best.depth ||
        (cand.depth === best.depth && (cand.prestige > best.prestige ||
          (cand.prestige === best.prestige && cand.start < best.start)))) best = cand;
    });
    return best;
  }
  function cal26Months(rows) {
    var out = [];
    for (var m = 0; m < 12; m++) out.push({ m: m, won: 0, lost: 0, rows: [], events: [] });
    rows.forEach(function (r) {
      var x = out[r.mon];
      x[r.won ? 'won' : 'lost']++;
      x.rows.push(r);
      var sh = cal26Short(r.event);
      if (x.events.indexOf(sh) < 0) x.events.push(sh);
    });
    return out.filter(function (x) { return x.rows.length; });
  }
  // The month's matches as the profile ledger draws them: the ledger's own row (recentForm, with its
  // H / A) where the ledger holds that match, else the spine row mapped onto the ledger row's shape.
  function cal26LedgerRows(p, rows) {
    var idx = {};
    ledgerRows(p).forEach(function (x) {
      if (x.m && x.m.date) idx[x.m.date + '|' + oppKeyOf(x.m.opponent)] = x;
    });
    return rows.slice().reverse().map(function (r) {
      var hit = idx[r.date + '|' + oppKeyOf(r.opp)];
      if (hit) return { x: hit, r: r };
      return {
        r: r,
        x: {
          m: { date: r.date, opponent: r.opp, won: r.won, round: r.round, result: r.sets,
            sets: r.setGames || [], wo: r.wo, retired: r.retired, surface: r.surface },
          price: r.price, oppPrice: r.oppPrice
        }
      };
    });
  }
  function cal26Rate(x) {
    var n = x.won + x.lost;
    var g = gateFor(n);
    var MONO_R = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;text-align:right;';
    if (g === GATE.FULL) {
      return '<span data-pp2-cal26="rate" data-gate="full" style="' + MONO_R + 'font-size:13.5px;font-weight:700;' +
        'color:var(--text);">' + rateText0(x.won, x.lost) + '</span>';
    }
    if (g === GATE.SMALL) {
      return '<span data-pp2-cal26="rate" data-gate="small" style="display:flex;flex-direction:column;' +
        'align-items:flex-end;gap:2px;">' +
        '<span style="' + MONO_R + 'font-size:12.5px;font-weight:400;color:var(--text-label);">' +
          rateText0(x.won, x.lost) + '</span>' +
        smallSampleHtml(n) + '</span>';
    }
    return '<span data-pp2-cal26="rate" data-gate="thin" style="' + MONO_R + 'font-size:13.5px;font-weight:700;' +
      'color:' + DASH_COLOUR + ';">' + DASH + '</span>';
  }
  function renderCal2026Tab(p) {
    if (!calSpine(p).length && !careerHistorySettled(p.key)) {
      return speedEmptyBox('The career match store has not loaded, so the ' + CAL_SEASON + ' season cannot be drawn yet.');
    }
    var rows = cal26Rows(p);
    var won = 0, lost = 0;
    rows.forEach(function (r) { if (r.won) won++; else lost++; });
    var n = won + lost;
    var best = cal26Best(rows);
    var tiles = recTileStrip([
      { html: recTileCell('Win' + ENDASH + 'loss', n ? recordText(won, lost) : DASH, null,
        recSub(CAL_SEASON + ' season')) },
      { html: recTileCell('Win rate', rateText0(won, lost), null,
        recSub(n.toLocaleString('en-US') + ' ' + (n === 1 ? 'match' : 'matches'))) },
      { html: recTileCell('Best result', best ? esc(cal26Short(best.ev)) : DASH, null,
        recSub(best ? CAL26_WORD[best.code] + ' ' + MIDDOT + ' ' + MON_FULL[best.mon]
          : 'no draw round on record')) }
    ], 22);
    if (!n) {
      return recPanel(recPanelHead(CAL_SEASON + ' ' + MIDDOT + ' season', '0 matches') + tiles +
        calEmpty('No ' + CAL_SEASON + ' matches on record.'));
    }
    var months = cal26Months(rows);
    var open = state.cal26Month == null ? null : parseInt(state.cal26Month, 10);
    var MONO_W = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;';
    var list = months.map(function (x, i) {
      var on = open === x.m;
      var row = '<div data-pp2="cal26-month" data-v="' + x.m + '" style="display:grid;' +
          'grid-template-columns:minmax(0,1fr) 64px 150px 14px;gap:0 16px;align-items:center;padding:11px 10px;' +
          'border-top:1px solid ' + (i ? 'var(--edge-6)' : 'transparent') + ';border-radius:' + (on ? '8px' : '0') + ';' +
          'cursor:pointer;background:' + (on ? 'var(--selected)' : 'transparent') + ';">' +
        '<span style="display:flex;align-items:baseline;gap:10px;min-width:0;">' +
          '<span style="font-size:13.5px;font-weight:700;color:var(--text);">' + MON_FULL[x.m] + '</span>' +
          '<span style="font-size:11.5px;color:var(--text-label);overflow:hidden;text-overflow:ellipsis;' +
            'white-space:nowrap;">' + esc(x.events.join(' ' + MIDDOT + ' ')) + '</span></span>' +
        '<span style="' + MONO_W + 'font-size:13px;font-weight:700;color:var(--text);text-align:right;white-space:nowrap;">' +
          recordText(x.won, x.lost) + '</span>' +
        cal26Rate(x) +
        '<span style="font-size:15px;line-height:1;color:var(--text-label);text-align:right;' +
          (on ? 'transform:rotate(90deg);' : '') + '">&rsaquo;</span>' +
      '</div>';
      if (!on) return row;
      var heads = '<div class="pp2-ledger-head" style="' + LEDGER_GRID + 'padding:0 8px 8px;' +
        'border-bottom:1px solid ' + LEDGER_HEAD_RULE + ';">' +
        ledgerEyebrow('Date', 'left') + '<span></span>' + ledgerEyebrow('Opponent', 'left') +
        ledgerEyebrow('Rd', 'left') + ledgerEyebrow('Sets', 'left') + ledgerEyebrow('Set scores', 'left') +
        ledgerEyebrow('H', 'right') + ledgerEyebrow('A', 'right') + '</div>';
      var groups = [];
      cal26LedgerRows(p, x.rows).forEach(function (y) {
        var g = groups[groups.length - 1];
        if (!g || g.ev !== y.r.event) groups.push(g = { ev: y.r.event, surface: y.r.surface, rows: [] });
        g.rows.push(y);
      });
      var body = groups.map(function (g) {
        var gw = 0, gl = 0;
        g.rows.forEach(function (y) { if (y.r.won) gw++; else gl++; });
        return '<div style="display:flex;align-items:baseline;gap:10px;padding:12px 8px 6px;' +
            'border-top:1px solid var(--line);">' +
            '<span style="font-size:12.5px;font-weight:700;color:var(--text);">' + esc(g.ev || DASH) + '</span>' +
            '<span style="' + MONO_W + 'font-size:10.5px;color:var(--text-label);">' +
              esc(surfaceWord(g.surface)) + ' ' + MIDDOT + ' ' + gw + ENDASH + gl + '</span></div>' +
          g.rows.map(function (y) { return ledgerRowHtml(y.x); }).join('');
      }).join('');
      return row + '<div data-pp2-cal26="panel" style="background:var(--card);border:1px solid var(--edge-6);' +
        'border-radius:10px;padding:12px 12px 8px;margin:4px 0 10px;overflow-x:auto;">' +
        '<div style="min-width:640px;">' + heads + body + '</div></div>';
    }).join('');
    var foot = '<div style="margin-top:14px;font-size:11px;line-height:1.65;color:var(--text-label);max-width:900px;">' +
      'Every ' + CAL_SEASON + ' match on the career record counts, team events and exhibitions included. ' +
      'Month rates: 10 or more matches shows the rate in full; 5' + ENDASH + '9 is a small sample, greyed with ' +
      'its n; under 5 shows the W' + ENDASH + 'L only. Best result is the deepest round reached at any event ' +
      '(a won final is the title); a tie goes to the bigger event, then the earlier one, and the month is ' +
      'the one the event began in. Click a month for its matches.</div>';
    return recPanel(
      recPanelHead(CAL_SEASON + ' ' + MIDDOT + ' season', esc(n + ' ' + (n === 1 ? 'match' : 'matches'))) +
      tiles +
      recCaps('Month by month ' + MIDDOT + ' ' + CAL_SEASON, 'display:block;margin-bottom:8px;') +
      '<div data-pp2-cal26="list" style="max-height:420px;overflow-y:auto;">' + list + '</div>' + foot);
  }
  function calEmpty(text) {
    return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
      'text-align:center;font-size:13px;color:var(--text-label);margin-top:14px;">' + esc(text) + '</div>';
  }
  // ONE refusal sentence. The Indoors case has to keep saying WHY it is empty rather than reading as
  // "he never played indoors". `tail` is the clause that names the block.
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

  // ── the four tiles, one joined strip (K3) · founder 2026-10-05 correction ──────────────────────
  // Career yield · Best month · Worst month · Seasons on record. Every VALUE is white; only the pp
  // figure under Best / Worst month takes --pos / --neg. The month gate is the one these tiles had:
  // eligibility needs n ≥ 10 priced (the pp is computed from the priced rows, so the gate sits on
  // that sample); calPpLine() keeps the file's tileOf() greying for 5–9 and a dash below 5.
  function calPpLine(pp, n) {
    var full = n >= 10, some = n >= 5;
    var ppText = (pp == null || !some) ? DASH : signed(pp, 1, 'pp');
    var ppColour = (pp == null) ? DASH_COLOUR
      : full ? (pp > 0 ? 'var(--pos)' : pp < 0 ? 'var(--neg)' : 'var(--text-label)')
        : some ? 'var(--text-label)' : DASH_COLOUR;
    return '<span style="display:flex;align-items:baseline;justify-content:center;gap:5px;' +
      'font-family:\'IBM Plex Mono\',monospace;font-size:11px;">' +
      '<span data-pp2-cal="pp" style="font-weight:700;color:' + ppColour + ';">' + esc(ppText) + '</span>' +
      // TEN-384 fx2 item 4 · ONE small-sample mark: 5–9 reads "small sample · n=X", no asterisk.
      '<span style="color:var(--text-label);">' + esc(full || !some ? MIDDOT + ' n=' + n : smallSampleText(n)) + '</span>' +
      '</span>';
  }
  /** The Calendar tab's four tiles over `rows` (the surface-filtered career spine). */
  // Founder ruling 2026-10-07 · the Calendar's Career yield IS the Market edge box's figure: the shard's
  // own headline (Pinnacle closing, else Bet365 closing — the same `yield` and `n` buildBoxVals prints),
  // read directly so the two cannot drift even if the dated join ever fails to place a priced match.
  // Only on All surfaces (the box has no surface split); a surface tab rates its own priced rows.
  function calCareerYield(p, info) {
    var mk = p && (state.calSurface || 'all') === 'all' ? marketFor(p.key) : null;
    var h = mk && mk.headline;
    if (h && h.n && h.yield != null) return { y: h.yield, n: h.n, placed: info.priced };
    return { y: info.priced >= 5 ? info.careerY : null, n: info.priced, placed: info.priced };
  }
  function calTiles(rows, p) {
    if (!rows.length) {
      return [
        { html: recTileCell('Career yield', DASH, null, recSub('no matches on record')) },
        { html: recTileCell('Best month', DASH, null, recSub('no matches on record')) },
        { html: recTileCell('Worst month', DASH, null, recSub('no matches on record')) },
        { html: recTileCell('Seasons on record', DASH, null, recSub('no matches on record')) }
      ];
    }
    var info = calMonths(rows);
    // TEN-384 fix 3 (founder 2026-10-07) · ONE CALCULATION for the tiles and the footer: a month's figure
    // is its "vs other months" gap (`gap`, the footer's VS OTHERS row and bars) over its PRICED matches
    // (`priced`, the footer's N row). The tiles used to rank on `pp` (vs his own career yield) and quote
    // the priced n while the footer printed the gap over every match — Sep +24.2pp n=24 against
    // +26.3pp n=40. Eligible months are those with priced n ≥ 10, ranked on the gap.
    var monthIdx = info.months.filter(function (x) { return x.priced >= 10 && x.gap != null; })
      .sort(function (a, b) { return b.gap - a.gap; });
    var bestM = monthIdx[0] || null;
    var worstM = monthIdx.length > 1 ? monthIdx[monthIdx.length - 1] : null;
    // Career yield: mean P&L per priced match (calMonths' careerY), one decimal, WHITE whatever its
    // sign. Same floor as every yield on this tab: under five priced matches it dashes.
    var cyv = calCareerYield(p, info);
    var cy = cyv.n >= 5 ? cyv.y : null;
    if (shardPending(p)) {
      // fx4 item 4 · the shard is loading: the three priced tiles claim nothing (same boxes, no text).
      var pendSub = '<span data-pp2-pending="support" style="font-size:11px;color:var(--text-label);">&nbsp;</span>';
      return ['Career yield', 'Best month', 'Worst month'].map(function (cap) {
        return { html: recTileCell(cap, PEND_HTML, null, pendSub) };
      }).concat([{ html: recTileCell('Seasons on record', esc(String(info.seasons)), null,
        recSub(rows.length.toLocaleString('en-US') + ' ' + (rows.length === 1 ? 'match' : 'matches') + ' ' +
          MIDDOT + ' ' + info.seasons + ' ' + (info.seasons === 1 ? 'season' : 'seasons'))) }]);
    }
    function monthTile(cap, x, none) {
      return { html: recTileCell(cap, x ? esc(MON_FULL[x.m]) : DASH, null,
        x ? calPpLine(x.gap, x.priced) : recSub(none)) };
    }
    return [
      { html: recTileCell('Career yield', cy == null ? DASH : esc(signed(cy, 1, '%')), null,
        recSub(cyv.n ? cyv.n.toLocaleString('en-US') + ' priced ' +
          (cyv.n === 1 ? 'match' : 'matches') : 'no priced matches')) },
      monthTile('Best month', bestM, 'no month clears n=10 priced'),
      monthTile('Worst month', worstM, bestM ? 'one month clears n=10 priced' : 'no month clears n=10 priced'),
      { html: recTileCell('Seasons on record', esc(String(info.seasons)), null,
        recSub(rows.length.toLocaleString('en-US') + ' ' + (rows.length === 1 ? 'match' : 'matches') + ' ' +
          MIDDOT + ' ' + info.seasons + ' ' + (info.seasons === 1 ? 'season' : 'seasons'))) }
    ];
  }

  function renderCalTab(p) {
    var rows = calSpineFiltered(p);
    var surf = state.calSurface || 'all';
    var sw = calSurfaceWord(surf);
    // The head's span is the shown rows' own (a surface filter can start later than the career).
    var yrs = rows.map(function (r) { return String(r.year); }).sort();
    var y0 = yrs[0], y1 = yrs[yrs.length - 1];
    var spanTxt = y0 ? (y0 === y1 ? y0 : y0 + ENDASH + y1) : '';

    // The Indoors segment has no per-match source — same refusal, same wording as the Career drill.
    if (!rows.length) {
      var why = calNoRowsWhy(surf, 'so there is no match to place in a calendar.');
      return recPanel(
        recPanelHead('Calendar form ' + MIDDOT + ' career ' + MIDDOT + ' ' + esc(sw), '0 matches') +
        recTileStrip(calTiles(rows, p), 0) + calEmpty(why));
    }

    var info = calMonths(rows);
    var months = info.months;
    var seasons = info.seasons;
    var tiles = recTileStrip(calTiles(rows, p), 20);

    // ── the heat grid (K4) ──────────────────────────────────────────────────
    // `56px repeat(12) 72px`, gap 0 3; sticky heads on --card over a --line rule; year mono 12/700 white;
    // a cell is mono 11.5 in a r4 pill (pad 5 0, margin 3 0) tinted --pos / --neg at a flat 10%; an
    // empty month is the file's middot. Season column = that year's W–L; Career row = each month's W–L.
    var GRID_TRACK = 'display:grid;grid-template-columns:56px repeat(12,minmax(0,1fr)) 72px;gap:0 3px;' +
      'align-items:center;min-width:760px;';
    var HEAD_CELL = 'position:sticky;top:0;background:var(--card);padding:0 0 9px;' +
      'border-bottom:1px solid var(--line);font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);';
    var MONO = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;';
    var head =
      '<span style="' + HEAD_CELL + 'z-index:3;">Year</span>' +
      MON3.map(function (m) {
        return '<span style="' + HEAD_CELL + 'z-index:2;text-align:center;">' + m + '</span>';
      }).join('') +
      '<span style="' + HEAD_CELL + 'z-index:2;text-align:right;">Season</span>';

    var grid = info.grid;
    var body = grid.map(function (yr) {
      var yw = 0, yl = 0;
      var cells = yr.cells.map(function (c, m) {
        var n = c.won + c.lost;
        yw += c.won; yl += c.lost;
        // Item 13 — the empty month is the file's middot in var(--text-label), with no pointer.
        if (!n) {
          return '<span style="' + MONO + 'font-size:11.5px;text-align:center;color:var(--text-label);' +
            'padding:5px 0;margin:3px 0;cursor:default;">' + MIDDOT + '</span>';
        }
        var on = state.calCell === yr.year + '|' + m;
        // Item 12 — a FLAT 0.10 tint either side of .500 and `transparent` at .500; the open cell is
        // the selected tone.
        var bg = on ? 'var(--selected)'
          : c.won > c.lost ? 'color-mix(in srgb, var(--pos) 10%, transparent)'
            : c.won < c.lost ? 'color-mix(in srgb, var(--neg) 10%, transparent)' : 'transparent';
        var cls = c.won > c.lost ? 'calw' : c.won < c.lost ? 'call' : 'caln';
        return '<span class="' + cls + '" data-pp2="cal-cell" data-v="' + yr.year + '|' + m + '" ' +
          'style="' + MONO + 'font-size:11.5px;text-align:center;color:var(--text);background:' + bg + ';' +
          'border-radius:4px;padding:5px 0;margin:3px 0;cursor:pointer;white-space:nowrap;' +
          (on ? 'box-shadow:inset 0 0 0 1px var(--edge-16);' : '') +
          'transition:background .12s ease;">' + c.won + ENDASH + c.lost + '</span>';
      }).join('');
      return '<span style="' + MONO + 'font-size:12px;font-weight:700;color:var(--text);padding:7px 0;' +
          'border-bottom:1px solid var(--line);">' + esc(yr.year) + '</span>' + cells +
        '<span style="' + MONO + 'font-size:12px;font-weight:700;color:var(--text);text-align:right;' +
          'padding:7px 0;border-bottom:1px solid var(--line);white-space:nowrap;">' + yw + ENDASH + yl + '</span>';
    }).join('');
    var cw = 0, cl = 0;
    var careerRow = '<span style="padding:10px 0 0;border-top:1px solid var(--line);font-family:var(--font-words);' +
        'font-size:10.5px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">' +
        'Career</span>' +
      months.map(function (x) {
        cw += x.won; cl += x.lost;
        var n = x.won + x.lost;
        return '<span style="' + MONO + 'font-size:11.5px;font-weight:700;text-align:center;padding:10px 0 0;' +
          'border-top:1px solid var(--line);white-space:nowrap;color:' + (n ? 'var(--text)' : 'var(--text-label)') + ';">' +
          (n ? x.won + ENDASH + x.lost : MIDDOT) + '</span>';
      }).join('') +
      '<span style="' + MONO + 'font-size:12px;font-weight:700;text-align:right;padding:10px 0 0;' +
        'border-top:1px solid var(--line);white-space:nowrap;color:var(--text);">' + cw + ENDASH + cl + '</span>';

    var drill = renderCalDrill(p, rows);
    var top = recPanel(
      recPanelHead('Calendar form ' + MIDDOT + ' career ' + MIDDOT + ' ' + esc(sw),
        esc(rows.length.toLocaleString('en-US') + ' matches' + (spanTxt ? ' ' + MIDDOT + ' ' + spanTxt : ''))) +
      tiles +
      '<div style="overflow-x:auto;">' +
        '<div style="max-height:440px;overflow-y:auto;">' +
          '<div style="' + GRID_TRACK + '">' + head + body + careerRow + '</div></div></div>' +
      drill, 'top');

    // ── the Priced sample panel (K7) + footer ────────────────────────────────
    var resid = calResidual(p);
    var calPend = shardPending(p);
    var note = 'Grid cells are W' + ENDASH + 'L only, counted over the career match rows. The tint shows ' +
      'whether that month finished above .500 that season, not a yield comparison. ' +
      (function () {
        if (calPend) return '';   // fx4 item 4 · no priced claim while the shard loads
        var cyv = calCareerYield(p, info);
        var gap = (surf === 'all' && cyv.n > info.priced) ? cyv.n - info.priced : 0;
        return gap ? 'Career yield is the Market edge figure over all ' + cyv.n + ' priced matches; ' + gap +
          (gap === 1 ? ' of them carries' : ' of them carry') + ' no dated career row the calendar can place, so the ' +
          'months below rest on ' + info.priced + '. ' : '';
      }()) +
      (calPend ? ''
        : info.priced
        ? 'Yield and ' + esc('vs other months') + ' are computed across the ' + info.priced + ' priced ' +
          (info.priced === 1 ? 'match' : 'matches') + ' on the Market edge basis (closing price: Pinnacle, else ' +
          'Bet365); N counts them, and the Best / Worst month tiles quote the same figure. The grid ' +
          'covers all ' + rows.length + '. Rates show from five priced matches up; under five, a dash. '
        : 'None of these ' + rows.length + ' matches carries a closing price (Pinnacle, else Bet365), so ' +
          'every yield figure is a dash: the odds archive is ATP tour main draw only. ') +
      esc('Consistent') + ' counts, out of the ' + seasons + ' ' +
      (seasons === 1 ? 'season' : 'seasons') + ' on record, those in which the month finished above .500; ' +
      'a season with no matches that month counts as not above.' +
      // FOUNDER 2026-09-18: the two residual populations, stated separately — never a net.
      (surf !== 'all' ? '' : calResidualNote(resid));

    var bottom = recPanel(
      recPanelHead('By month ' + MIDDOT + ' career ' + MIDDOT + ' ' + esc(sw),
        calPend ? PEND_HTML
          : esc(info.priced.toLocaleString('en-US') + ' of ' + rows.length.toLocaleString('en-US') + ' matches ' +
          MIDDOT + ' flat 1u')) +
      renderCalFooter(info, rows, calPend) +
      '<div style="margin-top:16px;font-size:11px;line-height:1.65;color:var(--text-label);max-width:900px;">' +
        note + '</div>', 'bottom');

    return top + bottom;
  }

  // ── the cell drill (K6) ─────────────────────────────────────────────────
  // Under the grid inside the Calendar panel: a panel (--card + --edge-6, r10, 13/15); "April 2026 3–1",
  // the signed priced total mono 15/700 on the right, a 28px close (white 5% + --line); the eight-column
  // RD · EVENT · OPPONENT · SCORE · HOME · AWAY · P&L table, grouped by event.
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
    // plPct = plTot / n * 100 over the PRICED rows only — an unpriced row stays out of the count.
    var pct = priced ? cents / priced : null;
    var sign = cents > 0 ? 'var(--pos)' : cents < 0 ? 'var(--neg)' : 'var(--text-label)';
    var order = [], groups = {};
    cell.forEach(function (r) {
      var ev = r.event || DASH;
      if (order.indexOf(ev) < 0) { order.push(ev); groups[ev] = []; }
      groups[ev].push(r);
    });
    var dPend = shardPending(p);   // fx4 item 4 · prices still loading: the priced cells claim nothing
    var totalLine = dPend ? '' : priced
      ? signed(cents / 100, 2) + 'u ' + MIDDOT + ' ' + signed(pct, 1, '%') + ' ' + MIDDOT + ' ' +
        priced + ' priced'
      : DASH + ' ' + MIDDOT + ' no priced match in this month';
    var ROW_TRACK = 'display:grid;grid-template-columns:14px 44px minmax(0,1.1fr) minmax(0,1.3fr) ' +
      'minmax(0,1fr) 62px 62px 72px;gap:20px;';
    var HEAD = 'font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);';
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
          var pl = dPend ? '&nbsp;' : r.cents == null ? DASH : signed(r.cents / 100, 2);
          var plCol = r.cents == null ? DASH_COLOUR
            : r.cents > 0 ? 'var(--pos)' : r.cents < 0 ? 'var(--neg)' : 'var(--text-label)';
          return '<div ' + sheetHook(r.sheetId) + 'style="' + ROW_TRACK +
            'align-items:center;padding:6px 0;border-top:1px solid var(--line);' +
            sheetCursor() + '">' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;font-weight:700;' +
              'color:' + (r.won ? 'var(--pos)' : 'var(--neg)') + ';">' + (r.won ? 'W' : 'L') + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:var(--text-label);">' +
              esc(r.round || DASH) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);' +
              'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.event || DASH) + '</span>' +
            '<span style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;' +
              'white-space:nowrap;">' + esc(r.opp ? initialSurname(r.opp) : DASH) + '</span>' +   // fx3 D12: "I. M. Surname"
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;color:var(--text-label);' +
              'white-space:nowrap;">' + esc(scoreWithStatus(r, r.score)) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;' +
              'text-align:right;color:' + (r.price == null ? DASH_COLOUR : 'var(--text)') + ';">' +
              (r.price == null ? (dPend ? '&nbsp;' : DASH) : r.price.toFixed(2)) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;text-align:right;' +
              'color:' + (r.oppPrice == null ? DASH_COLOUR : 'var(--text-label)') + ';">' +
              (r.oppPrice == null ? (dPend ? '&nbsp;' : DASH) : r.oppPrice.toFixed(2)) + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;text-align:right;' +
              'color:' + plCol + ';">' + pl + '</span></div>';
        }).join('') + '</div>';
    }).join('');

    return '<div data-pp2-cal-drill="1" style="margin:12px 0 4px;background:var(--card);border:1px solid var(--edge-6);' +
      'border-radius:10px;padding:13px 15px;box-sizing:border-box;">' +
      '<div style="display:flex;align-items:baseline;gap:11px;margin-bottom:3px;">' +
        // K6 · the reference titles the drill with the short month ("Apr 2026").
        '<span style="font-size:13px;font-weight:700;">' + esc(MON3[dm] + ' ' + dy) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--text-label);white-space:nowrap;">' +
          recordText(won, cell.length - won) + '</span>' +
        '<span style="margin-left:auto;font-family:\'IBM Plex Mono\',monospace;font-size:15px;' +
          'font-weight:700;white-space:nowrap;color:' + (priced ? sign : DASH_COLOUR) + ';">' +
          (dPend ? '&nbsp;' : esc(totalLine)) + '</span>' +
        '<button type="button" data-pp2="cal-cell-close" aria-label="Close" style="align-self:center;margin-left:4px;' +
          'width:28px;height:28px;border-radius:8px;background:var(--wash-5);padding:0;' +
          'border:1px solid var(--line);color:var(--text-label);cursor:pointer;display:flex;' +
          'align-items:center;justify-content:center;">' +
          '<svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" ' +
          'stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg></button></div>' +
      '<div style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
        'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);margin-bottom:11px;' +
        'line-height:1.5;">' +
        esc(dy + ' ' + MIDDOT + ' ' + MON3[dm].toUpperCase() + ' ' + MIDDOT + ' ' +
          order.join(' ' + MIDDOT + ' ').toUpperCase() + ' ' + MIDDOT + ' ' +
          recordText(won, cell.length - won)) + '</div>' +
      colHead +
      '<div style="display:flex;flex-direction:column;gap:12px;width:100%;">' + body + '</div></div>';
  }

  // ── the footer (K8–K11) ──────────────────────────────────────────────────
  // The findings strip (a joined --card + --edge-6 r10 strip, --line dividers), then one 13-column track
  // (96px label column, gap 0 4): the zero-anchored "Vs other months" bars (96px, white 18% zero rule,
  // 12px bars rounded on the outer end only, ± scale labels), the Swing row (ruling Q2), and the
  // MONTH / N / YIELD / VS OTHERS / CONSISTENT rows.
  function renderCalFooter(info, rows, pend) {
    var months = info.months;
    var PEND_CELL = '&nbsp;';
    var GRID_TRACK = 'display:grid;grid-template-columns:96px repeat(12,minmax(0,1fr));gap:0 4px;' +
      'min-width:760px;align-items:end;';
    var LAB = 'font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);';
    var MONO = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;';
    var CELL = MONO + 'text-align:center;border-top:1px solid var(--line);padding:10px 0;';

    // Findings strip — per-surface yield against his career yield, priced subset, n ≥ 10 / 5–9 / < 5 gate.
    var findings = calFindings(rows);
    var strip = '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;' +
      'background:var(--card);border:1px solid var(--edge-6);border-radius:10px;overflow:hidden;">' +
      findings.map(function (d, i) {
        if (pend) {
          // fx4 item 4 · loading: the cap stays (a label, not a claim); name, figure and n keep their boxes.
          return '<span data-pp2-pending="finding" style="display:flex;flex-direction:column;align-items:center;' +
            'text-align:center;gap:6px;padding:15px 20px;border-left:1px solid ' + (i === 0 ? 'transparent' : 'var(--line)') + ';">' +
            '<span style="' + LAB + '">' + esc(d.cap) + '</span>' +
            '<span style="display:flex;align-items:baseline;gap:9px;">' +
              '<span style="font-size:13px;color:var(--text);">' + PEND_CELL + '</span>' +
              '<span style="' + MONO + 'font-size:15px;font-weight:700;">' + PEND_CELL + '</span></span>' +
            '<span style="' + LAB + '">' + PEND_CELL + '</span></span>';
        }
        var full = d.n >= 10, some = d.n >= 5;
        var val = (d.value == null || !some) ? DASH : signed(d.value, 1, 'pp');
        // The spread is a distance, not a direction: no sign, white.
        if (d.neutral && d.value != null && some) val = d.value.toFixed(1) + 'pp';
        return '<span style="display:flex;flex-direction:column;align-items:center;text-align:center;' +
          'gap:6px;padding:15px 20px;border-left:1px solid ' + (i === 0 ? 'transparent' : 'var(--line)') + ';">' +
          '<span style="' + LAB + '">' + esc(d.cap) + '</span>' +
          '<span style="display:flex;align-items:baseline;gap:9px;">' +
            '<span style="font-size:13px;color:var(--text);">' + esc(d.name) + '</span>' +
            '<span style="' + MONO + 'font-size:15px;font-weight:700;color:' +
              (d.value == null || !some ? DASH_COLOUR
                : full ? (d.neutral ? 'var(--text)' : d.value > 0 ? 'var(--pos)' : d.value < 0 ? 'var(--neg)' : 'var(--text-label)')
                  : 'var(--text-label)') + ';">' + esc(val) + '</span>' +
            '</span>' +
          (!full && some ? smallSampleHtml(d.n) : '<span style="' + LAB + '">n=' + d.n + '</span>') + '</span>';
      }).join('') + '</div>';

    // Vs other months — zero-anchored bars. A month's bar shows only where its figure clears the
    // five-priced gate (the same gate as the row below); otherwise the column is empty.
    function gapOk(x) { return !pend && x.gap != null && x.priced >= 5; }
    var maxGap = 0;
    months.forEach(function (x) { if (gapOk(x) && Math.abs(x.gap) > maxGap) maxGap = Math.abs(x.gap); });
    var HALF = 47.5;
    var chart = '<span style="' + LAB + 'padding:0 0 6px;">Vs other months</span>' +
      '<span style="grid-column:2 / -1;position:relative;display:grid;' +
        'grid-template-columns:repeat(12,minmax(0,1fr));gap:0 4px;height:96px;' +
        'border-bottom:1px solid var(--line);">' +
      '<span style="position:absolute;left:0;right:0;top:47.5px;height:1px;' +
        'background:color-mix(in srgb, var(--text) 18%, transparent);"></span>' +
      (maxGap ? '<span style="position:absolute;right:0;top:2px;' + MONO + 'font-size:9.5px;color:var(--text-label);">' +
          '+' + maxGap.toFixed(1) + '</span>' +
        '<span style="position:absolute;right:0;bottom:2px;' + MONO + 'font-size:9.5px;color:var(--text-label);">' +
          MINUS + maxGap.toFixed(1) + '</span>' : '') +
      months.map(function (x) {
        var ok = gapOk(x) && maxGap;
        var h = ok ? Math.abs(x.gap) / maxGap * HALF : 0;
        var col = !ok ? 'transparent' : x.gap > 0 ? 'var(--pos)' : x.gap < 0 ? 'var(--neg)' : 'var(--text-label)';
        return '<span style="position:relative;display:flex;flex-direction:column;">' +
          '<span style="flex:1;display:flex;align-items:flex-end;justify-content:center;">' +
            '<span style="width:12px;height:' + (ok && x.gap > 0 ? h.toFixed(1) : 0) + 'px;background:' + col +
              ';border-radius:2px 2px 0 0;"></span></span>' +
          '<span style="flex:1;display:flex;align-items:flex-start;justify-content:center;">' +
            '<span style="width:12px;height:' + (ok && x.gap < 0 ? h.toFixed(1) : 0) + 'px;background:' + col +
              ';border-radius:0 0 2px 2px;"></span></span></span>';
      }).join('') + '</span>';

    // SWING row — ruling Q2 (founder 2026-10-05): band colours on the BAR only — 4px, r2, 75% opacity,
    // --viz-hard / --viz-clay / --viz-grass / --viz-indoor, the same night and day — with the surface
    // name centred UNDER it in caps --text-label. fx6 item 5: the spans are the five FIXED tour bands
    // (calSurfaceSpans / CAL_SWING_BANDS), not derived from his rows.
    // fx4 item 4 · while the shard loads the whole tab paints once: the row keeps its height with no bar and
    // no label (one blank 12-month span).
    var spans = pend ? [{ surface: null, len: 12, label: '', colour: 'transparent' }] : calSurfaceSpans();
    var swingRow = '<span style="' + LAB + 'padding:10px 8px 8px 0;align-self:start;">Swing</span>' +
      spans.map(function (s) {
        return '<span style="grid-column:span ' + s.len + ';display:flex;flex-direction:column;' +
          'align-items:stretch;gap:5px;padding:10px 2px 8px;align-self:start;">' +
          '<span data-pp2-swing="' + esc(s.surface || '') + '" style="display:block;height:4px;border-radius:2px;' +
            'background:' + s.colour + ';opacity:0.75;"></span>' +
          '<span style="' + LAB + 'text-align:center;">' + (s.label ? esc(s.label) : '&nbsp;') + '</span></span>';
      }).join('');

    function dataRow(label, cellFor) {
      return '<span style="' + LAB + 'padding:10px 8px 10px 0;border-top:1px solid var(--line);align-self:stretch;">' +
        esc(label) + '</span>' + months.map(cellFor).join('');
    }
    var monthRow = dataRow('Month', function (x) {
      return '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
        'letter-spacing:0.10em;text-transform:uppercase;text-align:center;color:var(--text);padding:10px 0;' +
        'border-top:1px solid var(--line);">' + MON3[x.m] + '</span>';
    });
    // N = the month's PRICED matches, the sample its Yield and Vs others are computed on — the n the
    // Best / Worst month tiles quote, and Σ N = the panel head's priced count (TEN-384 fix 3).
    var nRow = dataRow('n', function (x) {
      return '<span data-pp2-cal-n="' + x.m + '" style="' + CELL + 'font-size:11.5px;color:var(--text-label);">' +
        (pend ? PEND_CELL : x.priced) + '</span>';
    });
    // YIELD is neutral white; only VS OTHERS carries the sign colour (15/700).
    var yieldRow = dataRow('Yield', function (x) {
      if (pend) return '<span style="' + CELL + 'font-size:11.5px;">' + PEND_CELL + '</span>';
      var soft = x.priced > 0 && x.priced < 5;
      return '<span style="' + CELL + 'font-size:11.5px;white-space:nowrap;' +
        'color:' + (x.yield == null || soft ? DASH_COLOUR : 'var(--text)') + ';">' +
        (x.yield == null || soft ? DASH : signed(x.yield, 1, '%')) + '</span>';
    });
    var gapRow = dataRow('Vs others', function (x) {
      if (pend) return '<span style="' + CELL + 'font-size:15px;font-weight:700;">' + PEND_CELL + '</span>';
      var dash = !gapOk(x);
      return '<span style="' + CELL + 'font-size:' + (dash ? '11.5px' : '15px') + ';' +
        'font-weight:' + (dash ? 400 : 700) + ';white-space:nowrap;color:' +
        (dash ? DASH_COLOUR : x.gap > 0 ? 'var(--pos)' : x.gap < 0 ? 'var(--neg)' : 'var(--text-label)') + ';">' +
        (dash ? DASH : signed(x.gap, 1, 'pp')) + '</span>';
    });
    // One segment per SEASON, lit (--bar 62%) where that month finished above .500, "above/seasons" under.
    var consRow = dataRow('Consistent', function (x) {
      var segs = '';
      for (var k = 0; k < info.seasons; k++) {
        segs += '<span style="flex:1;height:5px;border-radius:1px;background:' +
          (k < x.above ? 'color-mix(in srgb, var(--bar) 62%, transparent)'
            : 'color-mix(in srgb, var(--text) 6%, transparent)') + ';"></span>';
      }
      return '<span style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 2px;' +
        'border-top:1px solid var(--line);align-self:stretch;">' +
        '<span style="display:flex;gap:1px;width:100%;">' + segs + '</span>' +
        '<span style="' + MONO + 'font-size:10px;color:var(--text-label);">' +
          x.above + '/' + info.seasons + '</span></span>';
    });

    return strip +
      '<div style="margin:16px 0 0;overflow-x:auto;">' +
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
  var SWING_COLOUR = { hard: 'var(--viz-hard)', clay: 'var(--viz-clay)', grass: 'var(--viz-grass)',
    indoors: 'var(--viz-indoor)' };   // Calendar Swing band only (TEN-376 Q2.4)
  var SWING_LABEL = { hard: 'Hard', clay: 'Clay', grass: 'Grass', indoors: 'Indoors' };
  // TEN-384 fx6 item 5 (founder r2, 2026-10-07) · THE SWING ROW IS THE TOUR'S CALENDAR: five FIXED bands,
  // the same for every player — HARD Jan–Mar · CLAY Apr–May · GRASS Jun–Jul · HARD Aug–Sep · INDOORS Oct–Nov;
  // December carries no band. This replaces the per-month vote over the player's own rows (fix item 11, the
  // fx2 tie order) and the fx4 Oct–Nov any-indoor rule: a vote painted seven segments for Alcaraz, with
  // Clay over February (his Rio / Buenos Aires rows). The bars keep their look (4px, r2, 75%, band colour,
  // caps label under each bar); the two Hard bands stay two bands, each with its own label.
  // `mon` is 0-based (0 = January); `len` months per band.
  var CAL_SWING_BANDS = [
    { surface: 'hard', mon: 0, len: 3 }, { surface: 'clay', mon: 3, len: 2 }, { surface: 'grass', mon: 5, len: 2 },
    { surface: 'hard', mon: 7, len: 2 }, { surface: 'indoors', mon: 9, len: 2 }, { surface: null, mon: 11, len: 1 }
  ];
  /** The Swing row's spans: the five fixed tour bands and December's empty slot (rows are not read). */
  function calSurfaceSpans() {
    return CAL_SWING_BANDS.map(function (b) {
      return {
        surface: b.surface, len: b.len,
        label: b.surface ? SWING_LABEL[b.surface] : '',
        colour: b.surface ? SWING_COLOUR[b.surface] : 'transparent'
      };
    });
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
   * `cents` carries the closing P&L (Market edge basis) for the priced subset.
   *
   * N4 (2026-09-28) retired the grass-is-Very-fast rule: grass bands off its venue.
   */
  /**
   * The PRICED market-shard rows — the population §8.1 (Court speed) and §5.6
   * (Matchup record) BOTH used to count off, and which neither counts off now.
   *
   * No renderer calls this today; it is kept as the named accessor for the priced
   * shard, used by the reconciliation tests to assert the difference between the
   * two populations rather than to define either of them.
   *
   * The reason the split matters has not changed, only the resolution. The old
   * comment here argued §5.6 could not leave this shard because only
   * build-market-edge.js stamps `oppArchetype`. That was an argument about where
   * the LABEL comes from, not about which matches the modal is counting, and it
   * produced the founder's defect: an archetype record over 727 priced rows
   * standing in for a 775-match career. §5.6 now resolves the label client-side
   * (styleArchetypeOf) over calSpine(), and takes units from the priced subset
   * alone. Two populations, both stated on the card.
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
      // closing price (Market edge basis) contributes units, and `priced` counts exactly that subset.
      // Summing units over the banded count instead is the error the design guards
      // against with its own "on N listed" label.
      if (m.cents != null) { a.cents += m.cents; a.priced += 1; }
    });
    // TEN-384 Q5 · slowest to fastest (Slow · Medium · Fast), the order the reference lays its tiles
    // out in under "Slower courts … Faster courts" (README §5.5's order too). The win-rate sort the
    // vertical list used is retired with the list.
    var out = SPEED_BANDS.map(function (b) { return agg[b.id]; });
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
    return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
      'text-align:center;font-size:13px;color:var(--text-label);">' + copy + '</div>';
  }

  function renderSpeedModal(p) {
    var spPend = shardPending(p);   // fx4 item 4 · units and H / A claim nothing while the shard loads
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
    var MONO = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;';

    // TEN-384 Q4.5 · the surface chips sit on the Darker track (the lock covers every segmented control).
    var surf = state.speedSurf || 'all';
    var chips = recSegTrack(SPEED_SURFACES.map(function (s) {
      return recSegBtn('speed-surf', s.id, s.label, surf === s.id, true);
    }).join(''), true);

    // §8.10 · CAREER totals, in the chip row (P1). Summed from the SAME band objects the tiles render,
    // so the summary cannot disagree with them (§4): the count is Σ band matches — the RATED population,
    // not the career total — and the note carries the difference. Units are the priced subset and say so.
    var tw = 0, tl = 0, tcents = 0, tpriced = 0;
    bands.forEach(function (b) { tw += b.won; tl += b.lost; tcents += b.cents; tpriced += b.priced; });
    var tn = tw + tl;
    var surfLabel = surf === 'all' ? 'Career' : 'Career ' + MIDDOT + ' ' + surf;
    var trate = (gateFor(tn) === GATE.NONE || gateFor(tn) === GATE.THIN) ? DASH : Math.round(100 * tw / tn) + '%';
    var sep = '<span style="color:var(--text-label);">' + MIDDOT + '</span>';
    var summary = '<span data-pp2-speed-career="1" style="display:flex;align-items:baseline;gap:8px;' + MONO +
        'font-size:12px;color:var(--text-label);white-space:nowrap;">' +
      recCaps(esc(surfLabel)) +
      (tn ? '<span style="font-weight:700;color:var(--text);">' + recordText(tw, tl) + '</span>' + sep +
        '<span style="font-weight:700;color:' + (trate === DASH ? DASH_COLOUR : 'var(--text)') + ';">' + trate + '</span>' + sep +
        '<span>' + tn.toLocaleString('en-US') + ' matches</span>' + sep : '<span>' + DASH + '</span>' + sep) +
      '<span style="font-weight:700;color:' + (tpriced ? (tcents >= 0 ? 'var(--pos)' : 'var(--neg)') : DASH_COLOUR) + ';">' +
        (spPend ? '&nbsp;' : tpriced ? signed(tcents / 100, 1, 'u') : DASH) + '</span>' +
      // FILE vs §8.1, reported: units are the PRICED subset of the listed career rows, so the label names
      // the subset it summed.
      (!spPend && tpriced ? '<span style="font-size:10.5px;">on ' + tpriced + ' priced</span>' : '') +
    '</span>';

    // P2 / ruling Q5 · the three bands as three tiles side by side, slowest to fastest under a
    // "Slower courts … Faster courts" rule. A band that opens its matches is a clickable tile
    // (--card + --edge-7, hover --tile-hover + --edge-16, selected --edge-24); a band under the
    // five-match minimum is a stat box (--card + --edge-6) that does not open. Figures mono, labels
    // Hanken 10.5 caps, no surface colours.
    var sel = speedSelected(bands);
    var tiles = bands.map(function (b) {
      var n = b.won + b.lost;
      var gate = gateFor(n);
      var openable = gate !== GATE.NONE && gate !== GATE.THIN;
      var on = !!(sel && sel.band.id === b.band.id);
      // §8.8 · a WHOLE number.
      var rate = openable ? Math.round(100 * b.won / n) + '%' : DASH;
      var meta = !n
        ? 'no matches on record'
        : (gate === GATE.THIN
            ? n + ' match' + (n === 1 ? '' : 'es') + ' ' + MIDDOT + ' min 5'
            : recordText(b.won, b.lost) + ' ' + MIDDOT + ' ' +
              (gate === GATE.SMALL ? smallSampleText(n) : n + ' matches'));
      var edge = !openable ? 'var(--edge-6)' : on ? 'var(--edge-24)' : 'var(--edge-7)';
      return '<div' + (openable ? ' class="pp2-tile' + (on ? ' on' : '') + '" data-pp2="speed-band" data-v="' + b.band.id + '"' : '') +
        ' style="display:flex;flex-direction:column;gap:9px;min-width:0;padding:12px 14px 13px;border-radius:12px;' +
        'background:var(--card);border:1px solid ' + edge + ';cursor:' + (openable ? 'pointer' : 'default') + ';">' +
        '<span style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">' +
          recCaps(esc(b.band.label), 'color:' + (!openable ? 'var(--text-label)' : on ? 'var(--text)' : 'var(--text-soft)') + ';') +
          '<span style="' + MONO + 'font-size:11.5px;font-weight:700;white-space:nowrap;color:' +
            (b.priced && openable ? (b.cents >= 0 ? 'var(--pos)' : 'var(--neg)') : DASH_COLOUR) + ';">' +
            (spPend ? '&nbsp;' : b.priced && openable ? signed(b.cents / 100, 1, 'u') : DASH) + '</span></span>' +
        '<span style="' + MONO + 'font-size:24px;font-weight:700;line-height:24px;color:' +
          (rate === DASH || gate === GATE.SMALL ? 'var(--text-label)' : 'var(--text)') + ';">' + rate + '</span>' +
        '<span style="' + MONO + 'font-size:11px;color:var(--text-label);white-space:nowrap;overflow:hidden;' +
          'text-overflow:ellipsis;">' + esc(meta) + '</span>' +
      '</div>';
    }).join('');

    return '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px;flex-wrap:wrap;">' +
        chips + summary + '</div>' +
      '<div style="margin:0 0 16px;">' +
        '<div style="display:flex;justify-content:space-between;padding:0 0 8px;margin:0 0 10px;' +
          'border-bottom:1px solid var(--line);">' + recCaps('Slower courts') + recCaps('Faster courts') + '</div>' +
        '<div class="pp2-speed" style="display:grid;grid-template-columns:repeat(' + bands.length + ',minmax(0,1fr));gap:8px;">' +
          tiles + '</div>' +
      '</div>' +
      renderSpeedPanel(sel, bands) +
      renderSpeedNote(bands, total);
  }

  function renderSpeedPanel(sel, bands) {
    var spPend = state.key != null && shardPending({ key: state.key });   // fx4 item 4
    var MONO = 'font-family:\'IBM Plex Mono\',monospace;font-variant-numeric:tabular-nums;';
    // P3 · the match panel spans the modal: a panel (--card + --edge-6, r10, 14/16/12).
    var PANEL = 'background:var(--card);border:1px solid var(--edge-6);border-radius:10px;padding:14px 16px 12px;';
    if (!sel) {
      return '<div data-pp2-speed-panel="1" style="' + PANEL + '"><div style="border:1px dashed var(--edge-6);border-radius:10px;' +
        'padding:26px;text-align:center;font-size:13px;color:var(--text-label);">' +
        'No band clears the five-match minimum, so none opens.</div></div>';
    }
    // §8.11 · the header states the band's record, rate and n, then how much of it is on screen.
    var sn = sel.won + sel.lost;
    var srate = (gateFor(sn) === GATE.NONE || gateFor(sn) === GATE.THIN) ? DASH : Math.round(100 * sel.won / sn) + '%';
    var shown = sel.rows.length;
    var head = '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 12px;">' +
      '<span style="display:flex;align-items:baseline;gap:10px;min-width:0;">' +
        recCaps(esc(sel.band.label) + ' courts ' + MIDDOT + ' career', 'white-space:nowrap;') +
        '<span style="' + MONO + 'font-size:11.5px;color:var(--text-label);white-space:nowrap;">' +
          recordText(sel.won, sel.lost) + ' ' + MIDDOT + ' ' + srate + ' ' + MIDDOT + ' ' + sn + ' matches</span></span>' +
      '<span style="display:flex;align-items:baseline;gap:10px;flex:none;">' +
        '<span style="' + MONO + 'font-size:11px;color:var(--text-label);white-space:nowrap;">' +
          (shown < sn ? 'Showing ' + shown + ' of ' + sn : 'All ' + shown + ' matches') + '</span>' +
        '<span style="' + MONO + 'font-size:12.5px;font-weight:700;white-space:nowrap;color:' +
          (sel.priced ? (sel.cents >= 0 ? 'var(--pos)' : 'var(--neg)') : DASH_COLOUR) + ';">' +
          (spPend ? '&nbsp;' : sel.priced ? signed(sel.cents / 100, 1, 'u') : DASH) + '</span></span>' +
    '</div>';

    // Newest first, grouped by event — the design groups a run of matches under the
    // tournament they were played at rather than repeating the event on every row.
    var rows = sel.rows.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var out = '', lastGroup = null;
    rows.forEach(function (m) {
      var g = m.event + '|' + m.date.slice(0, 4);
      if (g !== lastGroup) {
        lastGroup = g;
        // §8.17 · title is "{Display name} {year}"; meta is "{surface} · {level}". Indoors REPLACES the
        // surface; the level is printed only when the real tier is on the match.
        var surfWord = m.court === 'Indoor'
          ? 'Indoors'
          : (m.surface ? String(m.surface).charAt(0).toUpperCase() + String(m.surface).slice(1) : null);
        out += '<div style="grid-column:1 / -1;display:flex;align-items:baseline;gap:10px;' +
          'padding:10px 0 4px;">' +
          // tournDisplayName(name, null) — the tier has its own meta, so it is not appended twice.
          '<span style="font-size:12.5px;font-weight:700;white-space:nowrap;">' +
            esc(tournDisplayName(m.event, null) + ' ' + m.date.slice(0, 4)) + '</span>' +
          '<span style="' + MONO + 'font-size:10.5px;color:var(--text-label);white-space:nowrap;">' +
            esc([surfWord, m.level].filter(Boolean).join(' ' + MIDDOT + ' ')) + '</span>' +
        '</div>';
      }
      var hook = sheetHook(m.sheetId || (m.date + '|' + m.opp));
      var cell = 'cursor:pointer;padding:6px 0;border-top:1px solid var(--line);';
      out +=
        '<span ' + hook + 'style="' + cell + MONO + 'font-size:11px;' +
          'color:var(--text-label);">' + esc(shortDate(m.date)) + '</span>' +
        // §8.14 · a coloured square, not a "W"/"L" letter.
        '<span ' + hook + 'style="' + cell + 'display:flex;align-items:center;align-self:stretch;">' +
          '<span style="width:8px;height:8px;border-radius:2px;background:' +
          (m.won ? 'var(--pos)' : 'var(--neg)') + ';"></span></span>' +
        // §8.15 · the opponent is the page's sans face, not mono.
        '<span ' + hook + 'style="' + cell + 'font-size:12.5px;overflow:hidden;text-overflow:ellipsis;' +
          'white-space:nowrap;">' + esc(m.opp ? initialSurname(m.opp) : DASH) + '</span>' +   // fx5 item 4: the drills' name rule
        // §8.16 · draw-size codes (roundLabel() via calSpine()).
        '<span ' + hook + 'style="' + cell + MONO + 'font-size:10.5px;' +
          'color:var(--text-label);">' + esc(m.round || DASH) + '</span>' +
        // §8.4 · SETS, from the player's side, coloured by result.
        '<span ' + hook + 'style="' + cell + MONO + 'font-size:11.5px;' +
          'font-weight:700;color:' + (m.sets ? (m.won ? 'var(--pos)' : 'var(--neg)') : DASH_COLOUR) + ';">' +
          esc(m.sets || DASH) + '</span>' +
        // §8.5 · SET SCORES — recentForm's per-set scores where the ±0-day join reaches; else a dash.
        '<span ' + hook + 'style="' + cell + MONO + 'font-size:11px;' +
          'color:' + ((perSetScore(m) || matchStatus(m)) ? 'var(--text-label)' : DASH_COLOUR) + ';white-space:nowrap;">' +
          esc(scoreWithStatus(m, perSetScore(m))) + '</span>' +
        '<span ' + hook + 'style="' + cell + MONO + 'font-size:11px;' +
          'color:var(--text-soft);text-align:right;">' + (m.price == null ? (spPend ? '&nbsp;' : DASH) : m.price.toFixed(2)) + '</span>' +
        '<span ' + hook + 'style="' + cell + MONO + 'font-size:11px;' +
          'color:var(--text-label);text-align:right;">' + (m.oppPrice == null ? (spPend ? '&nbsp;' : DASH) : m.oppPrice.toFixed(2)) + '</span>';
    });
    // §8.13 · one grid for the whole list, with the reference's ledger tracks and sticky caps heads.
    var HEAD = 'position:sticky;top:0;z-index:1;background:var(--card);padding:0 0 7px;border-bottom:1px solid var(--line);' +
      'font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;' +
      'color:var(--text-label);';
    var heads = [['Date', 'left'], ['', 'left'], ['Opponent', 'left'], ['Rd', 'left'], ['Sets', 'left'],
      ['Set scores', 'left'], ['H', 'right'], ['A', 'right']].map(function (h) {
        return '<span style="' + HEAD + 'text-align:' + h[1] + ';">' + h[0] + '</span>';
      }).join('');
    out = out ? '<div style="display:grid;grid-template-columns:48px 12px minmax(0,1fr) 36px 40px ' +
      'minmax(0,1.2fr) 46px 46px;gap:0 10px;align-items:center;">' + heads + out + '</div>' : '';

    return '<div data-pp2-speed-panel="1" style="' + PANEL + '">' +
      head +
      '<div style="max-height:522px;overflow-y:auto;padding:0 12px 0 0;">' +
        (out || '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
          'text-align:center;font-size:13px;color:var(--text-label);">No matches in this band.</div>') +
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
    parts.push('Units cover priced matches only ' + ENDASH + ' closing prices on the Market edge basis ' +
      '(Pinnacle, else Bet365). H and A show the ledger’s price for the same match, so a match priced ' +
      'only by the bet365 pre-match capture shows its prices and carries no units.');
    return '<div data-pp2-mu="note" style="font-size:12px;color:var(--text-label);margin-top:14px;line-height:19.2px;">' +
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
  // §5.6 MATCHUP RECORD  (TEN-228 amendment, founder 2026-09-17)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // SPINE (amendment item 1). This modal used to count off marketRows() — the
  // PRICED archive, 727 rows for Zverev — so a match needed a Pinnacle price
  // before the opponent's archetype could be counted at all. It now counts off
  // calSpine(), the identical career spine Calendar, Streaks and Court speed use
  // (775 for Zverev), and `cents` carries the Pinnacle-closing P&L for the priced
  // subset only. Same split §8.1 already makes: the LIST is career rows, the
  // UNITS are the priced subset, and the two are labelled separately so a reader
  // cannot take one count for the other.
  //
  // The old build's own comment argued the opposite — that pointing §5.6 at the
  // spine would leave eight structurally-intact, numerically-empty rows. That was
  // true only because the spine carries no `oppArchetype`; the fix is to resolve
  // the label here (styleArchetypeOf) rather than to keep the modal on the wrong
  // population. marketRows() is left in place as the named accessor for the
  // priced shard — no renderer calls it now; the tests use it to assert that the
  // two populations really are different.
  //
  // TAXONOMY (item 2). playing-styles.json, the board-finalised set the profile
  // header and matchup-matrix.json already name. Eight labels, carried verbatim.
  // No v5.2 exists in this repo (reported at recon and still true).

  /**
   * Serve-first to baseline-first — the design's x order — with All Court Elite
   * held out to the right of the divider as its own tier.
   *
   * ABBREVIATIONS: BS / BS+FS / BS+CB / AB / SB / ACE are the design's own
   * (`Player Stat Boxes.dc.html`:3068). CP and SD are NOT: the export never plots
   * Counterpuncher or Solid Defender because they were that placeholder player's
   * two under-minimum rows. They are derived here and flagged in the report
   * rather than presented as specified.
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

  // ─── opponent → archetype (item 2: "never guessed") ────────────────────────
  //
  // build-market-edge.js stamps `oppArchetype` on the priced rows through its own
  // server-side resolver. The career spine has no such column, so the same join
  // is made here, against the same file, under a refusal rule.
  //
  //   tier 1  EXACT display name.               Zverev 521 of 775 rows
  //   tier 2  surname key, unique on BOTH sides AND the initial agrees.   +13
  //
  // THE INITIAL GUARD IS LOAD-BEARING, not a formality. Measured on the deployed
  // stores, tier 2 without it silently labels:
  //     M. Zverev  -> A. Zverev      (Mischa taking Alexander's archetype)
  //     M. Ymer    -> E. Ymer        3 rows for Zverev, 4 for Sinner
  //     T. Bellucci-> M. Bellucci    3 rows
  //     G. Muller  -> A. Muller      2 rows
  // — 9 guessed rows for Zverev alone. With the guard, every tier-2 hit is a
  // pure punctuation/case difference on the SAME person:
  //     A. de Minaur -> A. De Minaur · R. Bautista Agut -> R. Bautista-Agut
  //     P. Carreno Busta -> P. Carreno-Busta · C. O'Connell (entity-escaped)
  // Anything else is counted UNLABELLED and says so in the footnote.
  var styleByName = null, styleBySurname = null;
  function styleStores() {
    if (styleByName) return;
    styleByName = {}; styleBySurname = {};
    var src = window.playingStyles;
    var list = (src && src.players) || (Array.isArray(src) ? src : []);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || !s.name || !s.archetype_label) continue;
      styleByName[s.name] = s.archetype_label;
      var k = oppKeyOf(s.name);
      (styleBySurname[k] = styleBySurname[k] || []).push(s);
    }
  }
  function styleInitialOf(name) {
    var m = /^([A-Za-z])[.\s]/.exec(String(name || '').trim());
    return m ? m[1].toLowerCase() : '';
  }
  function styleArchetypeOf(name) {
    styleStores();
    var n = String(name || '').trim();
    if (!n) return null;
    if (styleByName[n]) return styleByName[n];
    var c = styleBySurname[oppKeyOf(n)];
    if (!c || c.length !== 1) return null;                       // ambiguous -> refuse
    var a = styleInitialOf(n), b = styleInitialOf(c[0].name);
    if (!a || !b || a !== b) return null;                        // different person -> refuse
    return c[0].archetype_label;
  }

  /**
   * Per-archetype record over the CAREER SPINE, with the Pinnacle-priced subset
   * carried separately (item 1).
   *
   * Reconciliation (item 4), guaranteed by construction rather than by a check:
   *   Σ rows (including under-minimum) + `unlabelled` === `total` === career M,
   *   because every spine row lands in exactly one bucket or in `unlabelled`.
   *   The Career footer row sums THESE row objects, so it cannot disagree with
   *   the list above it, and a row's detail is `r.rows` itself.
   *
   * ORDER (item 22): win rate descending, under-minimum rows at the bottom — the
   * design's own D array is written that way and the two null-rate rows sit last.
   */
  function styleRows(p) {
    var spine = calSpine(p);
    if (styleRows._k === p.key && styleRows._s === spine && styleRows._ps === window.playingStyles &&
        styleRows._v) {
      return styleRows._v;
    }
    var agg = {};
    STYLE_AXIS.forEach(function (a) {
      agg[a.label] = { axis: a, won: 0, lost: 0, cents: 0, priced: 0, rows: [] };
    });
    var unlabelled = 0;
    spine.forEach(function (m) {
      var lab = styleArchetypeOf(m.opp);
      var a = lab && agg[lab];
      if (!a) { unlabelled += 1; return; }
      if (m.won) a.won += 1; else a.lost += 1;
      a.rows.push(m);
      // Units are the PRICED subset and nothing else (item 1, R1). `cents` is
      // set by calSpine() only where the join landed a Market edge CLOSING price (Pinnacle, else Bet365 —
      // founder TEN-384 B8); a bet365 pre-match snapshot never reaches it.
      if (m.cents != null) { a.cents += m.cents; a.priced += 1; }
    });
    var out = STYLE_AXIS.map(function (a) { return agg[a.label]; });
    out.sort(function (x, y) {
      var nx = x.won + x.lost, ny = y.won + y.lost;
      var ox = styleOpenable(nx), oy = styleOpenable(ny);
      if (ox !== oy) return ox ? -1 : 1;                 // under-minimum to the bottom
      if (!ox) return ny - nx;                           // then by size, largest first
      var d = (y.won / ny) - (x.won / nx);
      return d !== 0 ? d : (ny - nx);                    // rate desc, tie -> larger n
    });
    out.unlabelled = unlabelled;
    out.total = spine.length;
    styleRows._k = p.key; styleRows._s = spine; styleRows._ps = window.playingStyles;
    styleRows._v = out;
    return out;
  }
  /** n >= 5 — the modal's stated minimum. Plotted, openable and rate-bearing. */
  function styleOpenable(n) {
    var g = gateFor(n);
    return g !== GATE.NONE && g !== GATE.THIN;
  }

  function renderStylesModal(p) {
    var rows = styleRows(p);
    // PENDING BEFORE EMPTY — the same split §5.5 Court speed and §6.4 Streaks
    // already make, and the last surface that lacked it (audited 2026-09-18
    // across all six lazy stores x nine surfaces; this was the only gap).
    //
    // styleRows() counts opponents out of the career-history spine, so a store
    // that has not landed yields rows.total === 0 — exactly what a player with
    // no matches yields. Stating "No matches on record" off that zero turns a
    // network fact into a claim about the player, which §3 forbids outright.
    // Measured on keys 67 / 1980 / 2072: with the shard unsettled the modal
    // asserted it for all three, each of whom has 400+ real rows once it lands.
    // Only the store can tell the two apart, so it is asked first.
    if (!rows.total && !careerHistorySettled(p.key)) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">The career match store has not loaded, ' +
        'so no opponent can be archetyped yet.</div>';
    }
    if (!rows.total) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">No matches on record, ' +
        'so no opponent can be archetyped.</div>';
    }
    // fx4 item 4 · Backing reads the shard's closing prices: while it loads the units claim nothing.
    STYLE_PEND = shardPending(p);
    try {
      return ANA_STYLE + renderStyleBubbles(rows) + renderStyleList(rows) + renderStyleNote(rows);
    } finally { STYLE_PEND = false; }
  }

  // ─── the y scale (item 10) ─────────────────────────────────────────────────
  //
  // README §5.6 says "Y axis 40-80%". THE FILE DOES NOT: `Player Stat Boxes.dc
  // .html`:3073 sets `LO = 35, HI = 80` and prints ticks at 80/70/60/50/40, so
  // the 40% tick sits at 88.9% down the plot and the bottom 11.1% is PAD. That
  // padding is why the export's own 41% bubble is not cut in half by the axis.
  // Reported as a README-vs-file difference; the file wins, so the pad is kept.
  //
  // The founder's rule on top of it: extend the TICK range in 10pp steps when a
  // value falls outside it, regenerating ticks and gridlines; never clip, never
  // clamp. The old build clamped to 40-80 and pinned an 81% bubble to the top
  // edge, which is what he caught.
  //
  // `max >= hi` rather than `max > hi` is deliberate and is the one place this
  // resolves a conflict between two of his sentences. A value sitting exactly ON
  // the top tick has its centre on the plot's top border and half the disc
  // outside it — "outside 40-80" says leave it, "never clipped" says do not. The
  // harder rule wins: a boundary value extends. The bottom needs no such test
  // because the file's 5pp pad already holds a bubble at the low tick clear.
  var STYLE_TICK_LO = 40, STYLE_TICK_HI = 80, STYLE_PAD_LO = 5;
  // Founder ruling 2026-09-18 (gate cc69c6cf, option "pad"): the 240px track is
  // the amendment's item 8 and does NOT move; the drawable area is inset 12px at
  // the top instead. A >=98% value on a 40-100 axis used to seat its disc 8px
  // from the top rule, leaving the value label only 2px of the card's 14px gap
  // before the eyebrow. The inset buys that label the same 14px+ clearance every
  // other bubble already had, without shrinking the axis or clamping the value.
  // TEN-384: the reference's drawable plot is 200px; the 12px inset sits above it.
  var STYLE_PLOT_H = 212, STYLE_PLOT_PAD_TOP = 12;
  function styleScale(values) {
    var lo = STYLE_TICK_LO, hi = STYLE_TICK_HI;
    var min = null, max = null;
    values.forEach(function (v) {
      if (min == null || v < min) min = v;
      if (max == null || v > max) max = v;
    });
    if (min == null) { min = lo; max = hi - 1; }
    while (min < lo && lo > 0) lo -= 10;
    while (max >= hi && hi < 100) hi += 10;
    // hi has hit 100 and a value is still on or above it (a clean sweep, 100%).
    // Ticks stop at 100 — there is no 110% — so the SCALE takes the headroom.
    var padHi = max >= hi ? STYLE_PAD_LO : 0;
    var ticks = [];
    for (var t = hi; t >= lo; t -= 10) ticks.push(t);
    return { lo: lo, hi: hi, LO: lo - STYLE_PAD_LO, HI: hi + padHi, ticks: ticks };
  }

  /**
   * Bubble plot, rebuilt to the reference (TEN-384, OFFICIAL VERSION 1):
   *   panel   --card + --edge-6, radius 12, pad 14/16/12, 16px below
   *   head    caps "Win rate by archetype" + Plex 11 "dot size = matches ·
   *           serve-first → baseline-first" on the right
   *   plot    36px tick gutter (Plex 10, right-aligned) + the plot; dotted
   *           horizontal guides (--viz-guide, 2/6), the 50% EVEN rule
   *           (--viz-rule) with its caps label, a dashed divider before ACE
   *   dots    unselected: --bar 30% fill + 1px --bar ring; selected: solid --bar
   *   x       Plex 10/600 abbreviations (selected white 700); foot caps
   *           SERVE · BASELINE · ALL COURT
   * The 12px top inset (founder 2026-09-18) is kept: the drawable 200px is the
   * reference's, the inset sits above it so a ≥98% label never meets the head.
   */
  function renderStyleBubbles(rows) {
    var plotted = rows.filter(function (r) { return styleOpenable(r.won + r.lost); });
    var card = 'background:var(--card);border:1px solid var(--edge-6);border-radius:12px;' +
      'padding:14px 16px 12px;margin-bottom:16px;display:flex;flex-direction:column;gap:12px;min-width:0;';
    if (!plotted.length) {
      return '<div style="' + card + '">' + styleEyebrow() +
        '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">No archetype clears the five-match ' +
        'minimum, so the chart has nothing to plot.</div></div>';
    }
    // Plot order is the AXIS order (serve-first -> baseline-first), not the row
    // list's rate order — the x axis is a style spectrum and must not resort.
    var byAxis = STYLE_AXIS.map(function (a) {
      return plotted.filter(function (r) { return r.axis.label === a.label; })[0] || null;
    }).filter(Boolean);
    var regular = byAxis.filter(function (r) { return !r.axis.elite; });
    var elite = byAxis.filter(function (r) { return r.axis.elite; });

    var sc = styleScale(byAxis.map(function (r) { return 100 * r.won / (r.won + r.lost); }));
    function top(v) {
      var frac = (v - sc.LO) / (sc.HI - sc.LO);
      return (STYLE_PLOT_PAD_TOP +
        (1 - frac) * (STYLE_PLOT_H - STYLE_PLOT_PAD_TOP)).toFixed(1) + 'px';
    }

    var tickLabels = sc.ticks.map(function (t) {
      return '<span style="position:absolute;right:0;top:' + top(t) + ';transform:translateY(-50%);' +
        'font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:var(--text-label);">' + t + '%</span>';
    }).join('');
    // Dotted guides (foundation: --viz-guide, dash 2 / gap 6), drawn as a
    // repeating gradient so a 1px line stays crisp at any width.
    var gridlines = sc.ticks.map(function (t) {
      return '<span data-guide="' + t + '" style="position:absolute;left:0;right:0;top:' + top(t) + ';height:1px;' +
        'background-image:linear-gradient(to right, var(--viz-guide) 2px, transparent 2px);' +
        'background-size:8px 1px;"></span>';
    }).join('');

    // Disc diameter: 16px at n=0 to the 38px cap (n ≥ 47), as before.
    function bubbleSize(n) { return Math.round(Math.min(38, 16 + n / 47 * 22)); }
    function point(r, left) {
      var n = r.won + r.lost;
      var pct = 100 * r.won / n;
      var size = bubbleSize(n);
      var on = state.styleRow === r.axis.label;
      var tip = r.axis.label + ' ' + MIDDOT + ' ' + Math.round(pct) + '% ' + MIDDOT + ' n=' + n;
      return '<span data-pp2="style-row" data-v="' + esc(r.axis.label) + '" title="' + esc(tip) + '" ' +
        'style="cursor:pointer;position:absolute;left:' + left + ';top:' + top(pct) + ';' +
        'transform:translate(-50%,-50%);width:' + size + 'px;height:' + size + 'px;border-radius:50%;box-sizing:border-box;' +
        'background:' + (on ? 'var(--bar)' : 'color-mix(in srgb, var(--bar) 30%, transparent)') + ';' +
        'border:1px solid var(--bar);"></span>' +
        // The value sits 5.5px above the disc: translateY(-(r + 13)) on a centred label.
        '<span style="position:absolute;left:' + left + ';top:' + top(pct) + ';' +
        'transform:translate(-50%,-50%) translateY(-' + (size / 2 + 13) + 'px);' +
        'font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;font-weight:700;color:var(--text);' +
        'white-space:nowrap;pointer-events:none;">' + Math.round(pct) + '%</span>';
    }
    // The abbreviation is the tick; the full name is its title (and the row's).
    function xlabel(r, left) {
      var on = state.styleRow === r.axis.label;
      return '<span class="pp2-stk' + (on ? ' on' : '') + '" data-pp2="style-row" ' +
        'data-v="' + esc(r.axis.label) + '" title="' + esc(r.axis.label) + '" ' +
        'style="left:' + left + ';">' +
        '<span class="pp2-stk-a">' + esc(r.axis.abbr) + '</span>' +
        '<span class="pp2-stk-n">' + esc(r.axis.label) + '</span></span>';
    }

    var span = 80, step = span / (regular.length + 1);
    var pts = '', labels = '';
    regular.forEach(function (r, i) {
      var x = (step * (i + 1)).toFixed(1) + '%';
      pts += point(r, x); labels += xlabel(r, x);
    });
    elite.forEach(function (r) { pts += point(r, '92%'); labels += xlabel(r, '92%'); });

    var foot = 'position:absolute;top:30px;font-family:var(--font-words);font-weight:700;font-size:10.5px;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);white-space:nowrap;';

    return '<div data-pp2-mu="chart" style="' + card + '">' +
      styleEyebrow() +
      '<div style="display:grid;grid-template-columns:36px minmax(0,1fr);gap:0 10px;">' +
        '<div style="position:relative;height:' + STYLE_PLOT_H + 'px;">' + tickLabels + '</div>' +
        '<div style="position:relative;height:' + STYLE_PLOT_H + 'px;' +
          'border-left:1px solid var(--line);border-bottom:1px solid var(--line);">' +
          gridlines +
          (elite.length ? '<span style="position:absolute;left:86%;top:0;bottom:0;width:1px;' +
            'border-left:1px dashed var(--line);"></span>' : '') +
          // The EVEN rule (break-even, foundation --viz-rule) and its caps label.
          '<span data-even="1" style="position:absolute;left:0;right:0;top:' + top(50) + ';height:1px;' +
            'background:var(--viz-rule);"></span>' +
          '<span style="position:absolute;right:6px;top:' + top(50) + ';transform:translateY(-130%);' +
            'font-family:var(--font-words);font-size:10.5px;letter-spacing:0.10em;font-weight:700;' +
            'text-transform:uppercase;color:var(--text-label);">even</span>' +
          pts +
        '</div>' +
        '<span></span>' +
        '<div style="position:relative;height:44px;">' + labels +
          '<span style="' + foot + 'left:0;">Serve</span>' +
          '<span style="' + foot + 'left:66%;transform:translateX(-50%);">Baseline</span>' +
          (elite.length ? '<span style="' + foot + 'right:0;">All court</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function styleEyebrow() {
    return '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;">' +
      '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
      'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">' +
      'Win rate by archetype</span>' +
      '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);">' +
      'dot size = matches ' + MIDDOT + ' serve-first ' + RARROW + ' baseline-first</span></div>';
  }

  // ── the ledger table (TEN-384) ─────────────────────────────────────────────
  // Archetype (13.5/700 + Plex 10 code) · W–L (Plex 12 label) · Matches (Plex 12
  // label) · Win % (Plex 13.5/700 white) · Backing (Plex 12/600 signed units);
  // tracks 470/56/76/60/64, gap 12, 11px rows on --line. An under-minimum row is
  // listed ("4 · min 5"), dims to label grey, dashes Win % and Backing, and does
  // not open. The open row lifts to --selected, bled 10px each side.
  var STYLE_TRACKS = 'grid-template-columns:minmax(0,1fr) 56px 76px 60px 64px;gap:0 12px;';
  var STYLE_MONO = 'font-family:\'IBM Plex Mono\',monospace;';
  var STYLE_CAPS = 'font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
    'text-transform:uppercase;color:var(--text-label);';
  var STYLE_PEND = false;   // fx4 item 4 · set by renderStylesModal for the one render pass
  function styleUnits(cents, priced) {
    if (STYLE_PEND) return '&nbsp;';
    return priced ? signed(cents / 100, 2, 'u') : DASH;
  }
  function styleUnitsColour(cents, priced) {
    return priced ? (cents >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--text-label)';
  }
  function renderStyleList(rows) {
    var tw = 0, tl = 0, tcents = 0, tpriced = 0;
    var body = rows.map(function (r) {
      var n = r.won + r.lost;
      var ok = styleOpenable(n);
      var open = ok && state.styleRow === r.axis.label;
      tw += r.won; tl += r.lost; tcents += r.cents; tpriced += r.priced;
      var nameInk = ok ? 'var(--text)' : DIM_COLOUR;
      var hook = ok ? 'data-pp2="style-row" data-v="' + esc(r.axis.label) + '" ' : '';
      var row = '<div ' + hook + 'data-pp2-anchor="' + esc('style|' + r.axis.label) + '" ' +
        (ok ? 'class="pp2-mrow' + (open ? ' on' : '') + '" ' : '') +
        (ok ? '' : 'title="' + esc(n + ' matches ' + MIDDOT + ' below the five-match minimum') + '" ') +
        'style="display:grid;' + STYLE_TRACKS + 'align-items:center;padding:11px 0;' +
        'border-top:1px solid var(--line);' + (ok ? 'cursor:pointer;' : '') +
        (open ? 'background:var(--selected);box-shadow:-10px 0 0 var(--selected),10px 0 0 var(--selected);' : '') + '">' +
          '<span style="display:flex;align-items:baseline;gap:8px;min-width:0;">' +
            '<span style="font-size:13.5px;font-weight:700;color:' + nameInk + ';overflow:hidden;' +
              'text-overflow:ellipsis;white-space:nowrap;">' + esc(r.axis.label) + '</span>' +
            '<span style="flex:none;' + STYLE_MONO + 'font-size:10px;color:var(--text-label);">' + esc(r.axis.abbr) + '</span>' +
          '</span>' +
          '<span style="' + STYLE_MONO + 'font-size:12px;color:var(--text-label);text-align:right;white-space:nowrap;">' +
            (n ? recordText(r.won, r.lost) : DASH) + '</span>' +
          '<span style="' + STYLE_MONO + 'font-size:12px;color:var(--text-label);text-align:right;white-space:nowrap;">' +
            (ok ? String(n) : n + ' ' + MIDDOT + ' min 5') + '</span>' +
          '<span style="' + STYLE_MONO + 'font-size:13.5px;font-weight:700;text-align:right;color:' +
            (ok ? 'var(--text)' : 'var(--text-label)') + ';">' + (ok ? Math.round(100 * r.won / n) + '%' : DASH) + '</span>' +
          '<span style="' + STYLE_MONO + 'font-size:12px;font-weight:600;text-align:right;color:' +
            (ok ? styleUnitsColour(r.cents, r.priced) : 'var(--text-label)') + ';">' +
            (ok ? styleUnits(r.cents, r.priced) : DASH) + '</span>' +
        '</div>';
      return row + (open ? renderStyleDetail(r) : '');
    }).join('');

    // CAREER. Summed from the SAME row objects the list renders, so it cannot
    // disagree with them: Σ archetype rows = the RATED (labelled) population.
    var tn = tw + tl;
    var trate = styleOpenable(tn) ? Math.round(100 * tw / tn) + '%' : DASH;
    var total = '<div data-pp2-mu="career" style="display:grid;' + STYLE_TRACKS + 'align-items:center;padding:11px 0 0;' +
      'border-top:1px solid var(--line);">' +
      '<span style="' + STYLE_CAPS + '">Career</span>' +
      '<span style="' + STYLE_MONO + 'font-size:12px;color:var(--text-label);text-align:right;white-space:nowrap;">' +
        (tn ? recordText(tw, tl) : DASH) + '</span>' +
      '<span style="' + STYLE_MONO + 'font-size:12px;color:var(--text-label);text-align:right;white-space:nowrap;">' +
        tn + ' rated</span>' +
      '<span style="' + STYLE_MONO + 'font-size:13.5px;font-weight:700;text-align:right;color:' +
        (trate === DASH ? 'var(--text-label)' : 'var(--text)') + ';">' + trate + '</span>' +
      '<span style="' + STYLE_MONO + 'font-size:12px;font-weight:600;text-align:right;color:' +
        styleUnitsColour(tcents, tpriced) + ';">' + styleUnits(tcents, tpriced) + '</span>' +
    '</div>';

    // The summary line: the rated record and rate, the career match total the
    // list draws from (rated + unlabelled opponents), and the priced units.
    var dot = '<span style="' + STYLE_MONO + 'font-size:12px;color:var(--text-label);">' + MIDDOT + '</span>';
    var head = '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;">' +
      '<span style="' + STYLE_CAPS + '">Record by archetype ' + MIDDOT + ' career</span>' +
      '<span data-pp2-mu="summary" style="display:flex;align-items:baseline;gap:8px;' + STYLE_MONO + 'font-size:12px;color:var(--text-label);">' +
        '<span style="' + STYLE_CAPS + '">Career</span>' +
        '<span style="font-weight:700;color:var(--text);white-space:nowrap;">' + (tn ? recordText(tw, tl) : DASH) + '</span>' + dot +
        '<span style="font-weight:700;color:' + (trate === DASH ? 'var(--text-label)' : 'var(--text)') + ';">' + trate + '</span>' + dot +
        '<span>' + rows.total.toLocaleString('en-US') + ' matches</span>' + dot +
        '<span style="font-weight:700;color:' + styleUnitsColour(tcents, tpriced) + ';">' + styleUnits(tcents, tpriced) + '</span>' +
      '</span></div>';
    var heads = '<div style="display:grid;' + STYLE_TRACKS + 'align-items:center;">' +
      ['Archetype', 'W' + ENDASH + 'L', 'Matches', 'Win %', 'Backing'].map(function (h, i) {
        return '<span style="padding:0 0 8px;border-bottom:1px solid var(--line);' + STYLE_CAPS +
          (i ? 'text-align:right;' : '') + '">' + h + '</span>';
      }).join('') + '</div>';

    return '<div data-pp2-mu="list" style="display:flex;flex-direction:column;">' + head + heads + body + total + '</div>';
  }

  /**
   * The archetype drill (TEN-384): a --card + --edge-6 panel under the open row;
   * caps "<archetype> · career" + Plex record line, the signed units / yield /
   * priced count on the right; a table that scrolls inside 360px with sticky
   * heads. W/L is an 8px square (--pos / --neg), dates "Oct 2026", scores
   * space-separated. Every cell carries the match-sheet hook.
   */
  /** "I. Surname" — the reference's (and the step-3 sheet's) opponent form. */
  // fx3 (D12): the sheet hand-off's own rule, so a surname-first name ("Cerundolo J. M.") turns round whole.
  function styleOppName(name) {
    return initialSurname(name);
  }
  function renderStyleDetail(r) {
    var n = r.won + r.lost;
    var yield_ = r.priced ? (r.cents / 100) / r.priced * 100 : null;
    var plText = STYLE_PEND ? '&nbsp;' : r.priced
      ? signed(r.cents / 100, 2, 'u') + ' ' + MIDDOT + ' ' + signed(yield_, 1, '%') +
        ' ' + MIDDOT + ' ' + r.priced + ' priced'
      : DASH + ' ' + MIDDOT + ' 0 priced';
    var plColour = r.priced ? (r.cents >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--text-label)';

    var headCell = 'position:sticky;top:0;z-index:1;background:var(--card);padding:0 0 7px;' +
      'border-bottom:1px solid var(--line);' + STYLE_CAPS;
    // The first head cell is EMPTY — the W/L square carries no label.
    var heads = '<span style="' + headCell + '"></span>' +
      ['Date', 'Opponent', 'Event', 'Rd', 'Score'].map(function (h) {
        return '<span style="' + headCell + '">' + h + '</span>';
      }).join('') +
      ['Price', 'Opp', 'P&amp;L'].map(function (h) {
        return '<span style="' + headCell + 'text-align:right;">' + h + '</span>';
      }).join('');

    var cell = 'padding:6px 0;border-top:1px solid var(--line);';
    var mono = STYLE_MONO;
    var body = r.rows.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    }).map(function (m) {
      var hook = sheetHook(m.sheetId || (m.date + '|' + m.opp));
      var cur = sheetCursor();
      var s = perSetScore(m);
      var priced = m.price != null;
      return '' +
        '<span ' + hook + 'style="' + cur + cell + 'display:flex;align-items:center;">' +
          '<span title="' + (m.won ? 'Won' : 'Lost') + '" style="width:8px;height:8px;border-radius:2px;background:' +
          (m.won ? 'var(--pos)' : 'var(--neg)') + ';"></span></span>' +
        '<span ' + hook + 'style="' + cur + cell + mono + 'font-size:11px;color:var(--text-label);">' +
          esc(styleMonthYear(m.date)) + '</span>' +
        '<span ' + hook + 'style="' + cur + cell + 'font-size:12.5px;color:var(--text);overflow:hidden;' +
          'text-overflow:ellipsis;white-space:nowrap;">' +
          esc(m.opp ? styleOppName(m.opp) : DASH) + '</span>' +
        '<span ' + hook + 'style="' + cur + cell + 'font-size:12px;color:var(--text-label);overflow:hidden;' +
          'text-overflow:ellipsis;white-space:nowrap;">' +
          esc(tournDisplayName(m.event, null) || DASH) + '</span>' +
        '<span ' + hook + 'style="' + cur + cell + mono + 'font-size:10.5px;color:var(--text-label);">' +
          esc(m.round || DASH) + '</span>' +
        // Set scores where recentForm reaches, space-separated ("4-6 3-6"); the
        // retired/walkover marker either way; an honest dash outside that window.
        '<span ' + hook + 'style="' + cur + cell + mono + 'font-size:11px;white-space:nowrap;color:' +
          ((s || matchStatus(m)) ? 'var(--text-label)' : DASH_COLOUR) + ';">' +
          esc(scoreWithStatus(m, s ? s.replace(/,\s*/g, ' ') : s)) + '</span>' +
        '<span ' + hook + 'style="' + cur + cell + mono + 'font-size:11px;' +
          'text-align:right;color:' + (priced ? 'var(--text-soft)' : DASH_COLOUR) + ';">' +
          (priced ? m.price.toFixed(2) : STYLE_PEND ? '&nbsp;' : DASH) + '</span>' +
        '<span ' + hook + 'style="' + cur + cell + mono + 'font-size:11px;text-align:right;color:var(--text-label);">' +
          (m.oppPrice == null ? (STYLE_PEND ? '&nbsp;' : DASH) : m.oppPrice.toFixed(2)) + '</span>' +
        // The P&L carries no "u": the unit is stated once, in the header.
        '<span ' + hook + 'style="' + cur + cell + mono + 'font-size:11.5px;font-weight:700;' +
          'text-align:right;color:' +
          (m.cents == null ? DASH_COLOUR : (m.cents >= 0 ? 'var(--pos)' : 'var(--neg)')) + ';">' +
          (STYLE_PEND ? '&nbsp;' : m.cents == null ? DASH : signed(m.cents / 100, 2)) + '</span>';
    }).join('');

    return '<div data-pp2-mu="drill" style="background:var(--card);border:1px solid var(--edge-6);border-radius:10px;' +
      'padding:14px 16px 12px;margin:8px 0 10px;min-width:0;">' +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px;">' +
        '<span style="display:flex;align-items:baseline;gap:10px;min-width:0;">' +
          '<span style="' + STYLE_CAPS + 'white-space:nowrap;">' + esc(r.axis.label) + ' ' + MIDDOT + ' career</span>' +
          '<span style="' + mono + 'font-size:11.5px;color:var(--text-label);white-space:nowrap;">' +
            recordText(r.won, r.lost) + ' ' + MIDDOT + ' ' + (n ? Math.round(100 * r.won / n) + '%' : DASH) +
            ' ' + MIDDOT + ' ' + n + ' matches</span>' +
        '</span>' +
        '<span style="' + mono + 'font-size:12.5px;font-weight:700;white-space:nowrap;color:' +
          plColour + ';">' + plText + '</span>' +
      '</div>' +
      '<div class="pp2-yscroll" style="max-height:360px;overflow-y:auto;padding-right:12px;min-width:0;">' +
        '<div style="display:grid;grid-template-columns:12px 64px minmax(0,1.25fr) minmax(0,1fr) 36px ' +
          '128px 46px 46px 54px;gap:0 10px;align-items:center;">' + heads + body + '</div>' +
      '</div>' +
    '</div>';
  }
  /** The file's detail date: "Oct 2026" (`styleMatches()` -> `MONS[mi] + ' ' + yr`). */
  var STYLE_MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function styleMonthYear(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return DASH;
    return STYLE_MONS[parseInt(s.slice(5, 7), 10) - 1] + ' ' + s.slice(0, 4);
  }

  /**
   * Footnote (item 32): the design's sentence with real counts, plus ONE coverage
   * line. The old build's three-sentence roster explanation is gone — the founder
   * asked for the fact, not the essay.
   */
  function renderStyleNote(rows) {
    var thin = rows.filter(function (r) { return !styleOpenable(r.won + r.lost); }).length;
    var parts = ['Click an archetype for the matches behind it.'];
    if (thin) {
      parts.push((thin === 1 ? 'One sits' : thin + ' sit') + ' below the five-match minimum and ' +
        // EMDASH, not ENDASH. This is a PUNCTUATION dash in a sentence, not a
        // range: the design file and the README both write it U+2014 and item 32
        // quotes it that way. §3's "ranges en dash" rule does not reach here.
        // Caught by reading the rendered footnote, not the source.
        (thin === 1 ? 'stays' : 'stay') + ' listed with a dash rather than dropping out ' + EMDASH +
        ' an absent row reads as an absent opponent.');
    }
    var labelled = rows.total - rows.unlabelled;
    parts.push(labelled + ' of ' + rows.total + ' matches against a labelled opponent ' +
      MIDDOT + ' labels are current.');
    return '<div style="font-size:12px;color:var(--text-label);margin-top:14px;line-height:1.6;">' +
      parts.join(' ') + '</div>';
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
  //  * (Serve rating / Return rating used to be listed here as "needs hold%". The
  //    store's `raw` carries Games:Service/Return games won at 99.9% of sides, so both
  //    are now the house ratings from house-ratings.js — TEN-327, the same helper as
  //    the Match stats sheet. A missing component still dashes, never a partial sum.)
  //  * Point FRACTIONS under each value — NOT because the feed withholds them.
  //    Measured against the committed floor, `raw` carries a won/total pair for
  //    TWELVE of the 17 fields: the four serve/return rates, the three Points:*
  //    totals and the two Games:* rates at 99.9% of populated sides, break points
  //    saved and converted at 88.0%, and net points won at 47.9%. The FIVE without
  //    one are aces, double faults, winners and unforced errors — pure counts, which
  //    do not want a fraction — plus 1st serve percentage. 12 + 5 = 17. (An earlier
  //    version of this comment said 11 and "three pure counts" while naming four.)
  //    ⚠️ 1st serve percentage is NOT exempt by design: the locked export draws a
  //    frac() under it too (…LOCKED_v7/Player Profile.dc.html:1433), so that one row
  //    wants a denominator the feed does not give us — it would stay dashed.
  //    The export draws a frac() under each rate (Player Profile.dc.html:1447 is the
  //    net-points row), so this is WIREABLE and is currently the page's largest unmet
  //    §3 obligation ("every rate shows its record and n"). Left alone on purpose: it
  //    changes the sheet's per-row geometry and so belongs with the pixel gate, not
  //    folded into a data fix.
  //
  // NET POINTS WON is no longer in that list. It IS an api-tennis field
  // ("Points:Net points won", a percentage), present on 47.9% of populated
  // player-sides in the committed floor — see the STAT_ROWS note above for the
  // measurement and for why the previous census missed it. It is now read per
  // match and dashed on null like any other field, per the founder's Q2 ruling.
  var SHEET_SECTIONS = [
    { title: 'Service', rows: [
      { label: 'Serve rating', derived: 'serveRating', kind: 'rating' },
      { label: 'Aces', field: 'Service:Aces', kind: 'count' },
      { label: 'Double faults', field: 'Service:Double Faults', kind: 'count', lowerBetter: true },
      { label: '1st serve %', field: 'Service:1st serve percentage', kind: 'pct' },
      { label: '1st serve points won', field: 'Service:1st serve points won', kind: 'pct' },
      { label: '2nd serve points won', field: 'Service:2nd serve points won', kind: 'pct' },
      { label: 'Break points saved', field: 'Service:Break Points Saved', kind: 'pct' }
    ] },
    { title: 'Return', rows: [
      { label: 'Return rating', derived: 'returnRating', kind: 'rating' },
      { label: '1st return points won', field: 'Return:1st return points won', kind: 'pct' },
      { label: '2nd return points won', field: 'Return:2nd return points won', kind: 'pct' },
      { label: 'Break points converted', field: 'Return:Break Points Converted', kind: 'pct' }
    ] },
    { title: 'Points won', rows: [
      { label: 'Winners', field: 'Points:Winners', kind: 'count' },
      { label: 'Unforced errors', field: 'Points:Unforced errors', kind: 'count', lowerBetter: true },
      { label: 'Net points won', field: 'Points:Net points won', kind: 'pct' },
      { label: 'Service points won', derived: 'spw', kind: 'pct' },
      { label: 'Return points won', derived: 'rpw', kind: 'pct' }
    ] }
  ];

  // ─── Q2 third clause · the WHOLE-EVENT note ────────────────────────────────
  // Founder ruling 2026-09-18: "Add the whole-event note when an event is 0/n ('no
  // match at this event carries winners'), so a total absence reads as a feed gap
  // rather than a per-player one."
  //
  // The index is built at pipeline time (tools/build-event-stat-coverage.js) because
  // the claim is about the EVENT, and the page only ever loads one player — this
  // player's other opponents at the same tournament sit in other profiles the browser
  // never fetches. Computing it here would quietly narrow "no match at this event" to
  // "none of HIS matches at this event", which is the per-player reading the ruling
  // exists to remove.
  //
  // Absent index => no note. The sheet is unchanged rather than degraded: silence is
  // the honest output when we cannot substantiate the claim.
  var EVENT_NOTE_FIELDS = [
    { code: 'w', field: 'Points:Winners', label: 'winners' },
    { code: 'u', field: 'Points:Unforced errors', label: 'unforced errors' },
    { code: 'n_', field: 'Points:Net points won', label: 'net points' }
  ];
  function eventCoverage() { return window.matchStatEventCoverage || null; }
  function eventCoverageFor(eventKey) {
    var idx = eventCoverage();
    if (!idx || !idx.keys || !idx.events || eventKey == null) return null;
    var edition = idx.keys[String(eventKey)];
    if (!edition) return null;
    var e = idx.events[edition];
    return e ? { edition: edition, counts: e } : null;
  }
  /**
   * The sentence(s) to append when a ruled field dashed for THIS match and no match
   * at the whole edition carries it.
   *
   * Gated on n >= 2. An edition we hold one match for is 0/1 the moment that match
   * dashes, and calling that a feed gap is exactly the per-player-vs-feed confusion
   * the note is supposed to clear up rather than add to.
   */
  function wholeEventNote(eventKey, mine, theirs) {
    var cov = eventCoverageFor(eventKey);
    if (!cov || !(cov.counts.n >= 2)) return '';
    var gaps = [];
    for (var i = 0; i < EVENT_NOTE_FIELDS.length; i++) {
      var f = EVENT_NOTE_FIELDS[i];
      // Only speak about a field that actually dashed HERE. An event-wide absence is
      // not interesting on a row the reader can see a number on.
      var heldHere = (mine && mine[f.field] != null) || (theirs && theirs[f.field] != null);
      if (heldHere) continue;
      if (cov.counts[f.code] === 0) gaps.push(f.label);
    }
    if (!gaps.length) return '';
    var list = gaps.length === 1 ? gaps[0]
      : gaps.slice(0, -1).join(', ') + ' or ' + gaps[gaps.length - 1];
    var name = String(cov.edition).split('|')[0];
    var year = String(cov.edition).split('|')[1];
    return ' No match at ' + name + ' ' + year + ' carries ' + list +
      ' (' + cov.counts.n + ' matches on record), so this is a gap in the feed for the ' +
      'whole event rather than for this player.';
  }

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
    if (row.derived === 'serveRating' || row.derived === 'returnRating') {
      var H = (typeof window !== 'undefined' && window.HouseRatings) || null;
      if (!H || !mine) return null;
      var hr = H.fromBoxSide(mine);
      return row.derived === 'serveRating' ? hr.serve.v : hr.ret.v;
    }
    if (row.derived === 'spw') return spwPct(mine);
    if (row.derived === 'rpw') return rpwPct(mine, theirs);
    return num(mine && mine[row.field]);
  }
  function sheetText(row, v) {
    if (v == null) return DASH;
    return row.kind === 'pct' ? v.toFixed(1) + '%' : String(Math.round(v));
  }

  // ─── §3 · the record under every rate ──────────────────────────────────────
  //
  // README §9: "Every rate shows its record and n." The export draws a `frac()`
  // sub-line under each rate on the match sheet; we printed the rate alone.
  //
  // The denominators are NOT derived — api-tennis ships them. `matchStats.{side}.raw`
  // carries {won,total} for twelve fields, measured on the deployed store:
  //   1st/2nd serve points won · break points saved · 1st/2nd return points won ·
  //   break points converted · net points won · service/return/total points won ·
  //   service/return games won.
  // The earlier claim in this file that "the feed emits rates, not denominators"
  // was wrong and is what kept this unbuilt.
  //
  // `1st serve %` is the one rate with no denominator anywhere in `raw`, so it
  // keeps a blank sub-line rather than borrowing a plausible one — founder ruling
  // 2026-09-18 item 4: "1st serve % stays dashed where we hold no denominator."
  // A COUNT row (aces, double faults, winners, unforced errors) has no fraction
  // to show: the value IS the count, and printing "11/11" under it would invent a
  // denominator. Those return '' too.
  var FRAC_FIELDS = {
    spw: 'Points:Service Points Won',
    rpw: 'Points:Return Points Won'
  };
  function sheetFrac(row, side) {
    if (!side || row.kind !== 'pct') return '';
    var raw = side.raw;
    if (!raw) return '';
    var field = row.field || (row.derived ? FRAC_FIELDS[row.derived] : null);
    if (!field) return '';
    var r = raw[field];
    if (!r || r.won == null || r.total == null || !(Number(r.total) > 0)) return '';
    return String(r.won) + '/' + String(r.total);
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

  /**
   * Whether §8.2's page would show anything the sheet does not already.
   * Summary alone is worth opening ONLY when there is a set-by-set score to
   * draw; otherwise the page is the sheet header with less on it.
   */
  /**
   * The api-tennis event key behind a sheet id, or null.
   *
   * Exported so the HOST resolves it through this module's own row lookup rather
   * than re-implementing the id -> row join. Two implementations of one join is
   * how the sheet and the panel end up pointed at different matches.
   */
  function eventKeyForSheetId(id) {
    var p = profileFor(state.key);
    if (!p || !id) return null;
    var x = sheetRowFor(p, buildCtx(p), id);
    return x && x.m && x.m.eventKey != null ? x.m.eventKey : null;
  }

  function mpHasPanel(m) {
    if (!m) return false;
    var a = mpAvailable(m);
    if (a.points || a.stats) return true;
    return !!(m.sets && m.sets.length);
  }

  // ─── TEN-384 · the hand-off to the step-3 Match analysis stats sheet ───────
  //
  // The profile's own §8.1 sheet (renderSheet) is RETIRED (founder, step 4 item 3: "There's no separate
  // profile match sheet"). Chips, strip cells, ledger rows, every W/L cell and every drill row that carries a
  // sheet hook now open the ONE stats sheet built in step 3 — tabs Match · Key stats · Set N · Point by
  // point, opening on Key stats — through the host's `pp2OpenMatchSheet` bridge, which hands this payload to
  // `fhOpenSheet`. Names go over as "I. Surname" (the sheet's own form); the ribbon and ledger keep theirs.
  //
  // The row is the same row the clicked element drew: recentForm for the ribbon and the ledger (so the
  // sheet's price is the H / A the row printed), else career-history (dated, scored, keyed), else the
  // market-edge shard (dated and priced, no score — the sheet then prints no result line rather than a
  // walkover nobody recorded).
  // TEN-384 fx3 (founder D12): every initial travels — "J.J. Wolf" -> "J. J. Wolf" (was "J. Wolf"), and a
  // surname-first name with TWO initials turns round whole: "Cerundolo J. M." -> "J. M. Cerundolo" (was
  // "M. Cerundolo J."). Only the ledger and ribbon print "Surname I. M."; everywhere else is "I. M. Surname".
  function initialSurname(name) {
    var n = String(name || '').trim();
    if (!n) return DASH;
    var lead = NAME_INITIALS_RE.exec(n);                                    // "J. M. Cerundolo", "J.J. Wolf"
    if (lead) return spacedInitials(lead[1]) + ' ' + lead[2];
    if (/^[A-Z][A-Za-z-]{0,3}\.\s+\S/.test(n)) return n;                 // "C. Alcaraz", "J-L. Struff"
    var revRun = /^(.+?)\s+((?:[A-Z]\.\s*){2,})$/.exec(n);               // "Cerundolo J. M." -> "J. M. Cerundolo"
    if (revRun) return spacedInitials(revRun[2]) + ' ' + revRun[1];
    var rev = /^(.+?)\s+([A-Z][A-Za-z-]{0,3})\.$/.exec(n);                 // "Shelton B." -> "B. Shelton"
    if (rev) return rev[2] + '. ' + rev[1];
    var parts = n.split(/\s+/);                                             // "Carlos Alcaraz" -> "C. Alcaraz"
    return parts.length > 1 ? parts[0].charAt(0).toUpperCase() + '. ' + parts.slice(1).join(' ') : n;
  }
  // the book ids the ledger rows carry -> the sheet's { book, src } (the host's ME_PROFILE_BOOK, plus the
  // ledger's own bet365 pre-match capture, which it labels 'bet365')
  var SHEET_BOOK = { pinnacle: ['P', 'td'], 'pinnacle-capture': ['P', 'cap'], 'bet365-archive': ['B', 'td'],
    'bet365-capture': ['B', 'cap'], bet365: ['B', 'cap'] };
  function sheetPayload(p, ctx, id) {
    var x = sheetRowFor(p, ctx, id);
    if (!x) return null;
    var raw = x.m;
    if (x.fromShard || x.fromCareerHistory) {
      var ch = careerHistoryFor(p.key) || [];
      for (var i = 0; i < ch.length; i++) {
        var c = ch[i];
        if (c && c.date && c.date + '|' + (c.opponent || '') === id) { raw = c; break; }
      }
    }
    var walkover = !!(raw.walkover || raw.wo);
    var scored = walkover || !!(raw.sets && raw.sets.length) ||
      /^\s*\d+\s*-\s*\d+\s*$/.test(String(raw.result || ''));
    var bk = x.price != null && x.oppPrice != null ? (SHEET_BOOK[String(x.book || '').toLowerCase()] || null) : null;
    return {
      id: id,
      subjectKey: String(p.key),
      subjectName: initialSurname(p.name),
      oppName: initialSurname(raw.opponent || x.m.opponent),
      row: {
        date: raw.date, opponent: raw.opponent || x.m.opponent || null,
        opponentKey: raw.opponentKey != null ? raw.opponentKey : null,
        tournament: raw.tournament || x.m.tournament || null, round: raw.round || x.m.round || null,
        surface: raw.surface || x.m.surface || null, result: raw.result || null, won: !!raw.won,
        sets: raw.sets || null, retired: !!raw.retired, walkover: walkover,
        eventKey: raw.eventKey != null ? raw.eventKey : null, qualifying: !!raw.qualifying
      },
      price: bk ? Number(x.price) : null,
      oppPrice: bk ? Number(x.oppPrice) : null,
      book: bk ? bk[0] : null,
      src: bk ? bk[1] : null,
      scored: scored
    };
  }
  /** Opens the step-3 sheet for a sheet id; the clicked ledger row keeps the open wash until it closes. */
  function openMatchSheet(id) {
    var p = profileFor(state.key);
    if (!p || !id) return false;
    var payload = sheetPayload(p, buildCtx(p), id);
    if (!payload || !(typeof window.pp2OpenMatchSheet === 'function')) return false;
    if (!window.pp2OpenMatchSheet(payload)) return false;
    state.sheet = id;
    repaint();
    return true;
  }
  /** The host calls this when the sheet closes (✕, scrim, Escape, a sidebar click). */
  function sheetClosed() {
    if (state.sheet == null) return;
    state.sheet = null;
    repaint();
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // §8.2 MATCH PANEL + FULL-SCREEN MATCH PAGE
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // README §8.2: "Match panel (inline under a tournament fixture; also
  // full-screen `matchPage`)" — a centred `Summary | Stats | Points` segmented
  // control over one match. On the profile the full-screen variant is the
  // surface the export actually gates (`matchPageOn`, Player Profile.dc.html:326),
  // so the panel is built once and the page is a wrapper around it.
  //
  // THE DATA LAYER ALREADY EXISTED. Every feed this needs is published and was
  // already being fetched for the Live tab's match rows:
  //   pbp/{eventKey}.json        point log   · pbp-index.json        11,832 keys
  //   setstats/{eventKey}.json   per-set AND whole-match box scores
  //                              · setstats-index.json   4,889 keys
  //                              · matchstats-index.json 6,566 keys
  // So this is a renderer, not an integration: the host's existing
  // loadPbpShard/loadSetStatsShard/loadPbpIndex/... are reused and their answers
  // published onto the bridge. Opening a second copy of any of them is what the
  // ticket means by "reuse it, don't rebuild it".
  //
  // NO DEAD AFFORDANCES (founder, Phase A Q3). A tab is painted only where THIS
  // match carries its feed. Coverage is real but partial and uneven — measured on
  // the deployed indexes against real career rows:
  //     Zverev   775 rows · 399 keyed · 316 pbp · 222 match stats · 152 per-set
  //     Giustino 405 rows · 399 keyed · 283 pbp · 115 match stats ·  88 per-set
  //     Borges   365 rows · 365 keyed ·  22 pbp ·  19 match stats ·  17 per-set
  // so a match with a point log and no box score shows Summary | Points, and one
  // with neither shows Summary alone. Three tabs where two do nothing is worse
  // than one, and that is the ruling this follows.
  //
  // DURATION IS NOT HELD. The export's Summary carries a `Match time` row with a
  // total and a per-set breakdown. No source we hold carries either: api-tennis
  // gives `event_time` (a START time) and nothing else, and neither shard
  // carries a duration field — checked on both rather than assumed. The row is
  // rendered with dashes and the footnote says why, rather than being dropped:
  // it is one row of a spec'd layout, not a whole group, and the ticket's first
  // rule is to reproduce the layout. Never a zero, never a plausible default.

  var MP_TABS = [
    { id: 'summary', label: 'Summary' },
    { id: 'stats', label: 'Stats' },
    { id: 'points', label: 'Points' }
  ];

  function pbpIndex() { return window.pbpIndex || null; }
  function setStatsIndex() { return window.setStatsIndex || null; }
  function matchStatsIndex() { return window.matchStatsIndex || null; }
  function pbpShardFor(ek) {
    var s = window.pbpShards;
    return (s && ek != null && Object.prototype.hasOwnProperty.call(s, String(ek)))
      ? s[String(ek)] : undefined;   // undefined = not fetched, null = answered "nothing"
  }
  function setStatsShardFor(ek) {
    var s = window.setStatsShards;
    return (s && ek != null && Object.prototype.hasOwnProperty.call(s, String(ek)))
      ? s[String(ek)] : undefined;
  }

  /**
   * Orient a shard's two sides onto the subject. Proven by KEY, never by
   * position — the same contract renderSheet uses. A shard naming neither player
   * returns null rather than a coin flip that would hand the reader the other
   * man's numbers.
   */
  function mpOrient(shard, key) {
    if (!shard) return null;
    var pk = String(key);
    if (pk === String(shard.p1Key)) return { first: true };
    if (pk === String(shard.p2Key)) return { first: false };
    return null;
  }

  /** Which tabs this match can actually feed. */
  function mpAvailable(m) {
    var ek = m && m.eventKey;
    var out = { summary: true, stats: false, points: false };
    if (ek == null) return out;
    var pi = pbpIndex(), si = setStatsIndex(), mi = matchStatsIndex();
    var k = String(ek);
    // The index is the cheap answer and it is authoritative about EXISTENCE.
    // Where it has not loaded we fall back to the shard itself, so a slow index
    // hides a tab for one repaint rather than permanently.
    var pbp = pbpShardFor(ek);
    out.points = pi ? pi.has(k) : (pbp != null && !!pbp);
    var ss = setStatsShardFor(ek);
    out.stats = (si ? si.has(k) : false) || (mi ? mi.has(k) : false) ||
      (ss != null && !!ss) || !!statsFor(ek);
    return out;
  }

  /**
   * Per-set games for the Summary score rows.
   *
   * Source order is deliberate. The POINT LOG is preferred where it exists: each
   * set's last game carries the set's final `score`, so the games are read off
   * the same artefact the Points tab paints and the two can never disagree.
   * career-history's `sets` is the fallback — it reaches further back but is
   * still filling (the per-set-score fix needs a shard rebuild to land, and on
   * the deployed store Zverev has it on 376 of 775 rows and Borges on 0 of 365).
   * Returns null when neither holds it; the caller dashes rather than guessing.
   */
  /**
   * Split one set's `games` array into real games, the tiebreak's point
   * progression, and the set-closing marker.
   *
   * MEASURED on the deployed shard for the 2026 US Open final (12162596), set 2 —
   * 22 entries for a 12-game set:
   *     g1..g12   1-0 .. 6-6     each with a points[] array      <- real games
   *     g1..g9    1-0 .. 7-2     points[] EMPTY, `g` restarts    <- the TIEBREAK
   *     g13       7 - 6          one point, its score is " - "   <- set closer
   * This is the same shape build-situational.js hit ("Set N TieBreak", one row
   * per mini-serve). Painted naively, a tiebreak renders as nine extra games
   * with bogus scores and LOST SERVE badges on most of them.
   *
   * The discriminator is the POINTS, not the `g` counter: a real game always
   * carries at least one point with a real score string. An entry with none is
   * not a game. That also catches the closing marker, whose single point is the
   * blank " - ".
   *
   * The tiebreak's last entry carries the final tiebreak score (7-2 here), which
   * is where the export's `7-6(2)` superscript comes from. It is READ, never
   * derived from the rules of tennis.
   */
  function mpSplitSet(st) {
    var entries = (st && st.games) || [];
    var games = [], tb = [], closer = null;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var pts = (e.points || []).filter(function (p) {
        return p && String(p.s || '').replace(/[\s-]/g, '').length > 0;
      });
      if (pts.length) { games.push(e); continue; }
      // No real points. Either a tiebreak mini-point or the set closer — the
      // closer is the one whose score is the SET score (a games total one side
      // has won by at least 6), and it is always last.
      if (i === entries.length - 1) closer = e; else tb.push(e);
    }
    // A trailing entry that is plainly a tiebreak point (the set has not been
    // closed by it) belongs with the tiebreak rather than being called a closer.
    if (closer && !tb.length && !games.length) { tb.push(closer); closer = null; }
    return { games: games, tb: tb, closer: closer };
  }

  /** The loser's points in a tiebreak, read off its last recorded score. */
  function mpTbPoints(tb) {
    if (!tb || !tb.length) return null;
    var last = tb[tb.length - 1];
    var parts = String(last.score || '').split('-');
    var a = parseInt(String(parts[0]).replace(/[^0-9]/g, ''), 10);
    var b = parseInt(String(parts[1] || '').replace(/[^0-9]/g, ''), 10);
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.min(a, b);
  }

  function mpSetGames(m, shard, first) {
    var out = null;
    if (shard && Array.isArray(shard.sets) && shard.sets.length) {
      out = [];
      for (var i = 0; i < shard.sets.length; i++) {
        var st = shard.sets[i];
        var sp = mpSplitSet(st);
        // The set score is the CLOSER's when there is one (a tiebreak set ends
        // on it); otherwise the last real game's.
        var last = sp.closer || (sp.games.length ? sp.games[sp.games.length - 1] : null);
        if (!last || !last.score) { out.push({ a: null, b: null, tb: null }); continue; }
        var parts = String(last.score).split('-');
        var p1 = parseInt(String(parts[0]).replace(/[^0-9]/g, ''), 10);
        var p2 = parseInt(String(parts[1] || '').replace(/[^0-9]/g, ''), 10);
        out.push({
          a: first ? p1 : p2, b: first ? p2 : p1,
          // The export's superscript is the loser's tiebreak POINTS, read off
          // the log's own last tiebreak score — never reconstructed from the
          // rules of tennis.
          tb: mpTbPoints(sp.tb)
        });
      }
      return out;
    }
    if (m && Array.isArray(m.sets) && m.sets.length) {
      return m.sets.map(function (s) {
        var tb = null;
        if (s.pTb != null && s.oTb != null) tb = Math.min(Number(s.pTb), Number(s.oTb));
        else if (s.pTb != null) tb = Number(s.pTb);
        else if (s.oTb != null) tb = Number(s.oTb);
        return { a: s.p != null ? s.p : null, b: s.o != null ? s.o : null, tb: tb };
      });
    }
    return null;
  }

  function mpSeg(items, hook, active) {
    return '<div style="display:flex;justify-content:center;">' +
      '<div style="display:flex;gap:4px;background:var(--card);border:1px solid var(--edge-6);' +
        'border-radius:10px;padding:4px;">' +
      items.map(function (it) {
        var on = String(it.id) === String(active);
        return '<button type="button" data-pp2="' + hook + '" data-v="' + esc(String(it.id)) + '" ' +
          'style="white-space:nowrap;padding:' + (hook === 'mp-tab' ? '8px 15px' : '7px 14px') + ';' +
          'border-radius:7px;font-size:' + (hook === 'mp-tab' ? '12.5' : '12') + 'px;font-weight:' +
          (on ? 700 : 600) + ';color:' + (on ? 'var(--text)' : 'var(--text-label)') + ';background:' +
          (on ? 'color-mix(in srgb, var(--bar) 16%, transparent)' : 'transparent') + ';border:1px solid ' +
          (on ? 'color-mix(in srgb, var(--bar) 40%, transparent)' : 'var(--edge-6)') + ';cursor:pointer;font-family:inherit;">' +
          esc(it.label) + '</button>';
      }).join('') + '</div></div>';
  }

  var MP_CAP = 'font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
    'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);';

  // ─── Summary ───────────────────────────────────────────────────────────────
  function mpSummary(p, x, shard, first) {
    var m = x.m;
    var cells = mpSetGames(m, shard, first);
    var nSets = cells ? cells.length : 0;
    var cols = 'auto' + new Array(nSets + 1).join(' minmax(22px,auto)');
    var oppName = m.opponent ? surnameFirst(m.opponent) : DASH;
    var setsWon = { a: 0, b: 0 };
    (cells || []).forEach(function (c) {
      if (c.a == null || c.b == null) return;
      if (c.a > c.b) setsWon.a++; else if (c.b > c.a) setsWon.b++;
    });

    function row(name, isSubject) {
      var won = isSubject ? !!m.won : !m.won;
      var mine = isSubject ? 'a' : 'b';
      return '<div style="display:flex;align-items:center;">' +
        '<span style="width:14px;flex:none;"></span>' +
        '<span style="flex:1;min-width:0;font-size:13.5px;font-weight:700;color:' +
          (won ? 'var(--text)' : 'var(--text-label)') + ';overflow:hidden;text-overflow:ellipsis;' +
          'white-space:nowrap;">' + esc(name) + '</span>' +
        '<span style="display:grid;grid-template-columns:' + cols + ';gap:0 4px;align-items:center;' +
          'margin-left:8px;">' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:15px;font-weight:700;' +
            'text-align:center;margin-right:4px;padding:2px 6px;border-radius:5px;background:' +
            (won ? 'color-mix(in srgb, var(--bar) 16%, transparent)' : 'transparent') + ';color:var(--text);">' +
            (cells ? setsWon[mine] : DASH) + '</span>' +
          (cells || []).map(function (c) {
            var v = c[mine];
            return '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;' +
              'font-weight:700;text-align:center;color:var(--text-label);">' +
              (v == null ? DASH : v) +
              (c.tb != null ? '<sup style="font-size:9px;font-weight:600;margin-left:1px;">' +
                esc(String(c.tb)) + '</sup>' : '') +
              '</span>';
          }).join('') +
        '</span></div>';
    }

    var scoreBlock = cells
      ? row(shortName(p), true) + row(oppName, false)
      : '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:20px;' +
        'text-align:center;font-size:12.5px;color:var(--text-label);">No set-by-set score on record for ' +
        'this match, so the per-set columns cannot be drawn.</div>';

    // Match time: rendered, and dashed. See the note at the top of §8.2 — no
    // source we hold carries a duration, so every cell here is a dash and the
    // footnote names the reason. A zero here would read as a match that took no
    // time, which is exactly the fabrication the standing rules forbid.
    var timeRow = '<div style="display:flex;align-items:center;border-top:1px solid var(--line);' +
      'margin-top:10px;padding:12px 2px 8px;">' +
      '<span style="width:14px;flex:none;"></span>' +
      '<span style="flex:1;' + MP_CAP + '">Match time</span>' +
      '<span style="display:grid;grid-template-columns:' + cols + ';gap:0 4px;align-items:center;' +
        'margin-left:8px;">' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;font-weight:700;' +
          'text-align:center;margin-right:4px;color:' + DASH_COLOUR + ';">' + DASH + '</span>' +
        (cells || []).map(function () {
          return '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11.5px;' +
            'text-align:center;color:' + DASH_COLOUR + ';">' + DASH + '</span>';
        }).join('') +
      '</span></div>';

    var meta = [fmtDotDate(m.date), eventName(m, p),
      (x.fromShard ? shortRound(m.round) : roundLabel(m)),
      (m.surface ? String(m.surface) : null)]
      .filter(function (t) { return t && t !== DASH; }).join(' ' + MIDDOT + ' ');

    return '<div style="font-family:\'IBM Plex Mono\',monospace;text-align:center;font-size:11px;' +
        'color:var(--text-label);margin-bottom:16px;">' + esc(meta) + '</div>' +
      '<div style="max-width:560px;margin:0 auto;">' +
        '<div style="' + MP_CAP + 'margin-bottom:10px;">Score</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;padding:0 2px 4px;">' + scoreBlock + '</div>' +
        timeRow +
        '<div style="font-size:11px;color:var(--text-label);line-height:1.55;margin-top:10px;">' +
          'Match duration is not carried by any source we hold — api-tennis publishes a start ' +
          'time and no length, and neither the point log nor the box-score shard carries one — ' +
          'so the Match time row is a dash rather than a figure.' +
          (cells && shard ? ' Per-set games are read off this match&#39;s own point log.' : '') +
        '</div>' +
      '</div>';
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────
  //
  // ONE DELIBERATE DEVIATION FROM THE EXPORT, flagged rather than silent: the
  // export's Stats tab paints a single `Service` band because its placeholder row
  // list is serve-only. We hold Return and Points-won rows for the same match, and
  // the founder's rule is that where we hold a real figure and the mock does not,
  // ours wins. So all three of SHEET_SECTIONS' bands render, each in the export's
  // own band chrome. The band element is reproduced exactly; there are three of it.
  function mpStats(p, x, ssShard) {
    var m = x.m;
    var setKeys = (ssShard && ssShard.sets) ? Object.keys(ssShard.sets).sort(function (a, b) {
      return Number(a) - Number(b);
    }) : [];
    var segs = [{ id: 'match', label: 'Match' }].concat(setKeys.map(function (k) {
      return { id: k, label: 'Set ' + k };
    }));
    var sel = state.mpSet;
    if (sel !== 'match' && setKeys.indexOf(String(sel)) < 0) sel = 'match';

    var mine = null, theirs = null, sourceNote = '';
    if (sel === 'match') {
      // The whole-match box score has two possible homes and they are the same
      // numbers: the eager store the sheet reads, and the shard's `match` node.
      // Prefer the store so the panel and the sheet above it cannot disagree.
      var rec = statsFor(m.eventKey);
      if (rec) {
        var o = mpOrient(rec, p.key);
        if (o) { mine = o.first ? rec.matchStats.p1 : rec.matchStats.p2;
                 theirs = o.first ? rec.matchStats.p2 : rec.matchStats.p1; }
      }
      if (!mine && ssShard && ssShard.match) {
        var o2 = mpOrient(ssShard, p.key);
        if (o2) { mine = o2.first ? ssShard.match.p1 : ssShard.match.p2;
                  theirs = o2.first ? ssShard.match.p2 : ssShard.match.p1; }
      }
      sourceNote = 'Whole-match box score.';
    } else {
      var pair = ssShard && ssShard.sets ? ssShard.sets[String(sel)] : null;
      var o3 = mpOrient(ssShard, p.key);
      if (pair && o3) {
        mine = o3.first ? pair.p1 : pair.p2;
        theirs = o3.first ? pair.p2 : pair.p1;
      }
      sourceNote = 'Set ' + sel + ' only. Per-set rows reconcile to the match totals.';
    }

    if (!mine && !theirs) {
      return (segs.length > 1 ? mpSeg(segs, 'mp-set', sel) : '') +
        '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:24px;' +
        'text-align:center;font-size:12.5px;color:var(--text-label);margin-top:16px;">' +
        'No box score on record for this match' + (sel === 'match' ? '' : ' at set ' + sel) + '.</div>';
    }

    var names = '<div style="display:flex;justify-content:space-between;font-size:13px;' +
      'font-weight:700;margin:18px 0 12px;">' +
      '<span style="color:var(--text);">' + esc(shortName(p)) + '</span>' +
      '<span style="color:var(--text);">' + esc(m.opponent ? surnameFirst(m.opponent) : DASH) + '</span></div>';

    var bands = SHEET_SECTIONS.map(function (sec) {
      var rows = sec.rows.map(function (r) {
        var a = sheetValue(r, mine, theirs);
        var b = sheetValue(r, theirs, mine);
        var bars = sheetBars(a, b);
        return '<div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;color:' +
              (a == null ? DASH_COLOUR : 'var(--text)') + ';">' + sheetText(r, a) + '</span>' +
            '<span style="display:flex;flex-direction:column;align-items:center;gap:1px;">' +
              '<span style="' + MP_CAP + 'font-weight:600;letter-spacing:0.14em;font-size:9.5px;">' +
                esc(r.label) + '</span>' +
              (r.lowerBetter ? '<span style="font-size:10px;color:var(--text-label);">lower is better</span>' : '') +
            '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:13px;color:' +
              (b == null ? DASH_COLOUR : 'var(--text)') + ';">' + sheetText(r, b) + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:4px;height:6px;">' +
            '<span style="flex:1;display:flex;justify-content:flex-end;">' +
              '<span style="display:block;width:' + bars[0] + ';height:100%;background:var(--bar);' +
                'border-radius:3px;"></span></span>' +
            '<span style="flex:1;"><span style="display:block;width:' + bars[1] + ';height:100%;' +
              'background:var(--text);border-radius:3px;"></span></span>' +
          '</div></div>';
      }).join('');
      return '<div style="' + MP_CAP + 'text-align:center;padding:8px 0;background:var(--card);' +
        'border-radius:8px;margin:16px 0;">' + esc(sec.title) + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:14px;">' + rows + '</div>';
    }).join('');

    return (segs.length > 1 ? mpSeg(segs, 'mp-set', sel) : '') + names + bands +
      '<div style="font-size:11px;color:var(--text-label);line-height:1.55;margin-top:14px;">' +
        esc(sourceNote) + ' A stat the feed never recorded for this match shows a dash and an ' +
        'empty bar, never a zero.' +
        (segs.length > 1 ? '' : ' No per-set box score is on file for this match, so the set ' +
          'selector is not shown.') +
      '</div>';
  }

  // ─── Points ────────────────────────────────────────────────────────────────
  function mpPoints(p, x, shard, first) {
    var m = x.m;
    if (!shard || !Array.isArray(shard.sets) || !shard.sets.length) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:24px;' +
        'text-align:center;font-size:12.5px;color:var(--text-label);">No point log on record for this match.</div>';
    }
    var segs = shard.sets.map(function (s, i) {
      return { id: String(s.set != null ? s.set : i + 1), label: 'Set ' + (s.set != null ? s.set : i + 1) };
    });
    var sel = state.mpPointSet;
    if (segs.map(function (s) { return s.id; }).indexOf(String(sel)) < 0) sel = segs[0].id;
    var st = shard.sets.filter(function (s, i) {
      return String(s.set != null ? s.set : i + 1) === String(sel);
    })[0] || shard.sets[0];

    var subjIsP1 = !!first;
    // A tiebreak arrives as one pseudo-"game" per mini-point (see mpSplitSet).
    // Painted as games they would read as nine extra service games with bogus
    // scores and LOST SERVE badges on most of them, which is why the export
    // gives the tiebreak its own sub-block.
    var split = mpSplitSet(st);
    var games = split.games.map(function (g) {
      var parts = String(g.score || '').split('-');
      var g1 = String(parts[0] || '').trim(), g2 = String(parts[1] || '').trim();
      var gA = subjIsP1 ? g1 : g2, gB = subjIsP1 ? g2 : g1;
      var serverIsSubject = (g.server === 'p1') === subjIsP1;
      var winnerIsSubject = (g.winner === 'p1') === subjIsP1;
      // "LOST SERVE" is the server losing his own game — the export's own badge.
      var aLost = serverIsSubject && !winnerIsSubject;
      var bLost = !serverIsSubject && winnerIsSubject;
      var serveIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-label)" ' +
        'stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle>' +
        '<path d="M4 8a15 15 0 0116 0M4 16a15 15 0 0016 0"></path></svg>';
      var badge = '<span style="font-family:var(--font-words);text-transform:uppercase;font-size:10.5px;font-weight:700;' +
        'letter-spacing:0.10em;color:var(--neg);background:color-mix(in srgb, var(--neg) 10%, transparent);' +
        'border:1px solid color-mix(in srgb, var(--neg) 34%, transparent);border-radius:5px;padding:3px 8px;' +
        'white-space:nowrap;">LOST SERVE</span>';
      var pts = (g.points || []).map(function (pt, i, all) {
        // The running score is written from p1's side; flip it for the reader
        // whose page this is, so the left-hand number is always his.
        var sp = String(pt.s || '').split('-');
        var txt = subjIsP1 ? String(pt.s || '')
          : (String(sp[1] || '').trim() + ' - ' + String(sp[0] || '').trim());
        return '<span style="display:inline-flex;align-items:center;gap:5px;' +
          'font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--text-label);">' + esc(txt) +
          (pt.bp ? '<span style="font-size:8.5px;font-weight:700;color:var(--text-label);' +
            'background:var(--inner);border:none;' +
            'border-radius:4px;padding:1px 5px;">BP</span>' : '') +
          (pt.sp ? '<span style="font-size:8.5px;font-weight:700;color:var(--text);' +
            'background:var(--inner);border:1px solid var(--edge-10);' +
            'border-radius:4px;padding:1px 5px;">SP</span>' : '') +
          (pt.mp ? '<span style="font-size:8.5px;font-weight:700;color:var(--pos);' +
            'background:color-mix(in srgb, var(--pos) 14%, transparent);border:1px solid color-mix(in srgb, var(--pos) 40%, transparent);' +
            'border-radius:4px;padding:1px 5px;">MP</span>' : '') +
          (i < all.length - 1 ? '<span style="color:var(--text-label);">,</span>' : '') +
          '</span>';
      }).join('');
      return '<div style="padding:16px 4px;border-bottom:1px solid var(--line);">' +
        '<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;' +
          'margin-bottom:10px;">' +
          '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">' +
            (aLost ? badge : '') + (serverIsSubject ? serveIcon : '') + '</div>' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:9px;">' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:18px;font-weight:700;' +
              'color:' + (winnerIsSubject ? 'var(--text)' : 'var(--text-label)') + ';">' + esc(gA) + '</span>' +
            '<span style="color:var(--text-label);font-size:15px;">' + MIDDOT + '</span>' +
            '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:18px;font-weight:700;' +
              'color:' + (winnerIsSubject ? 'var(--text-label)' : 'var(--text)') + ';">' + esc(gB) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:flex-start;gap:8px;">' +
            (!serverIsSubject ? serveIcon : '') + (bLost ? badge : '') + '</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;align-items:center;">' +
          pts + '</div></div>';
    }).join('');

    var nGames = split.games.length;
    var tbPts = mpTbPoints(split.tb);
    // The export's tiebreak sub-block: a 10px/0.16em label, then the point rows.
    var tbBlock = split.tb.length ? (
      '<div style="font-family:var(--font-words); font-size:10.5px;letter-spacing:0.10em; text-transform:uppercase; font-weight:700;' +
        'text-transform:uppercase;color:var(--text-label);padding:14px 4px 8px;">Tiebreak' +
        (tbPts != null ? ' ' + MIDDOT + ' ' + esc(String(tbPts)) + ' to the loser' : '') + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:center;align-items:center;' +
        'padding:0 4px 14px;">' +
        split.tb.map(function (t, i) {
          var sp2 = String(t.score || '').split('-');
          var txt = subjIsP1 ? String(t.score || '')
            : (String(sp2[1] || '').trim() + ' - ' + String(sp2[0] || '').trim());
          return '<span style="display:inline-flex;align-items:center;gap:5px;' +
            'font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--text-label);">' + esc(txt) +
            (i < split.tb.length - 1 ? '<span style="color:var(--text-label);">,</span>' : '') + '</span>';
        }).join('') +
      '</div>') : '';
    return mpSeg(segs, 'mp-point-set', sel) +
      '<div style="background:var(--card);border:1px solid var(--edge-6);border-radius:9px;' +
        'text-align:center;font-size:10.5px;font-family:var(--font-words); letter-spacing:0.10em; text-transform:uppercase; font-weight:700;' +
        'color:var(--text);padding:11px;margin:10px 0 4px;">SET ' + esc(String(sel)) + ' ' + MIDDOT + ' ' +
        nGames + ' GAMES</div>' +
      '<div style="display:flex;flex-direction:column;">' + games + '</div>' + tbBlock +
      '<div style="font-size:11px;color:var(--text-label);line-height:1.55;margin-top:12px;">' +
        'The running score reads from ' + esc(shortName(p)) + '&#39;s side. BP, SP and MP are the ' +
        'feed&#39;s own break-, set- and match-point flags — they are not inferred from the score.' +
        (split.tb.length
          ? ' The feed records a tiebreak as one entry per mini-point rather than as a game, so ' +
            'those are listed separately above and are not counted among the ' + nGames + ' games.'
          : '') +
      '</div>';
  }

  /**
   * The panel itself — the export's `statPanel`, minus the page chrome, so the
   * inline and full-screen variants render the same object.
   */
  function renderMatchPanel(p, ctx, id) {
    var x = sheetRowFor(p, ctx, id);
    if (!x) return '';
    var m = x.m;
    var ek = m.eventKey;
    var avail = mpAvailable(m);
    var tabs = MP_TABS.filter(function (t) { return avail[t.id]; });
    var tab = tabs.filter(function (t) { return t.id === state.mpTab; })[0] || tabs[0];

    var shard = pbpShardFor(ek);
    var ssShard = setStatsShardFor(ek);
    var pending = (avail.points && shard === undefined) || (avail.stats && ssShard === undefined);
    var or = mpOrient(shard, p.key) || mpOrient(ssShard, p.key);
    var first = or ? or.first : true;

    var body;
    if (tab.id === 'summary') body = mpSummary(p, x, shard || null, first);
    else if (tab.id === 'stats') body = mpStats(p, x, ssShard || null);
    else body = mpPoints(p, x, shard || null, first);

    // A point log whose two sides name neither the subject nor his opponent is a
    // join error. Painting it would hand the reader the wrong man's points, so
    // the tab says so instead — the same refusal renderSheet makes.
    if (tab.id !== 'summary' && shard && !mpOrient(shard, p.key) && !mpOrient(ssShard, p.key)) {
      body = '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:24px;' +
        'text-align:center;font-size:12.5px;color:var(--text-label);">This match&#39;s log names neither ' +
        'player by key, so it cannot be oriented and is not shown.</div>';
    }

    return '<div style="margin:4px 0 10px;padding:16px 16px 8px;background:var(--card);' +
      'border:1px solid var(--edge-6);border-radius:12px;">' +
      (tabs.length > 1
        ? '<div style="margin-bottom:14px;">' + mpSeg(tabs, 'mp-tab', tab.id) + '</div>'
        : '') +
      body +
      (pending
        ? '<div style="font-size:11px;color:var(--text-label);text-align:center;padding:8px 0;">' +
          'Loading this match&#39;s log…</div>'
        : '') +
      (tabs.length < MP_TABS.length
        ? '<div style="font-size:11px;color:var(--text-label);line-height:1.55;margin-top:6px;">' +
          MP_TABS.filter(function (t) { return !avail[t.id]; })
            .map(function (t) { return t.label; }).join(' and ') +
          (tabs.length === MP_TABS.length - 1 ? ' is' : ' are') +
          ' not shown: no feed on file carries ' +
          (tabs.length === MP_TABS.length - 1 ? 'that' : 'those') + ' for this match.</div>'
        : '') +
      '</div>';
  }

  /**
   * §8.2 full-screen variant. `position:fixed; inset:0; z 80; var(--page); scroll`,
   * inner `max-width 1000px; padding 26px 34px 70px`, a `‹ Back to profile` link,
   * title `A v B` 26px/800 with the `v` in var(--text-label), meta mono 12 var(--text-label) — the
   * export's own values, read off Player Profile.dc.html:326-334.
   */
  function renderMatchPage(p, ctx) {
    if (!state.matchPage) return '';
    var x = sheetRowFor(p, ctx, state.matchPage);
    if (!x) return '';
    var m = x.m;
    var meta = [fmtDotDate(m.date), eventName(m, p),
      (x.fromShard ? shortRound(m.round) : roundLabel(m)),
      (m.surface ? String(m.surface) : null),
      (m.won ? 'Won' : 'Lost')]
      .filter(function (t) { return t && t !== DASH; }).join(' ' + MIDDOT + ' ');
    // No scrim hook: the page FILLS the viewport, so there is no outside to click.
    // A data-pp2 the mount cannot handle is a dead control, and the reconcile
    // suite's hook audit is what caught it here.
    return '<div style="position:fixed;inset:0;z-index:80;' +
      'background:var(--inner);overflow-y:auto;">' +
      '<div style="max-width:1000px;margin:0 auto;padding:26px 34px 70px;display:flex;' +
        'flex-direction:column;gap:18px;">' +
        '<button type="button" data-pp2="match-page-close" style="display:inline-flex;' +
          'align-items:center;gap:9px;font-size:13.5px;font-weight:600;color:var(--text-label);' +
          'align-self:flex-start;cursor:pointer;background:none;border:0;padding:0;' +
          'font-family:inherit;">' +
          '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
          '<path d="M12 5l-5 5 5 5" stroke="currentColor" stroke-width="1.7" ' +
          'stroke-linecap="round" stroke-linejoin="round"></path></svg>Back to profile</button>' +
        '<div style="display:flex;flex-direction:column;gap:5px;' +
          'border-bottom:1px solid var(--line);padding-bottom:18px;">' +
          '<span style="font-size:26px;font-weight:800;letter-spacing:-0.02em;">' +
            esc(shortName(p)) + ' <span style="color:var(--text-label);">v</span> ' +
            esc(m.opponent ? surnameFirst(m.opponent) : DASH) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:var(--text-label);">' +
            esc(meta) + '</span>' +
        '</div>' +
        renderMatchPanel(p, ctx, state.matchPage) +
      '</div></div>';
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
      body = '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:var(--text-label);">Not built yet.</div>';
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
  // Founder Q6 (TEN-384): the pop-up renders Hold | Break only. Flip to true to
  // bring the surface control back; every path behind it is still wired.
  var HB_SHOW_SURF = false;

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

  // ── THE EXPORT'S SHAPE, not ours ──────────────────────────────────────────
  // Founder, 2026-09-19: "the export is ONE grid toggled Hold|Break with a
  // GLOBAL column FIRST; we ship two stacked grids with ALL last. Build the
  // export's shape."
  //
  // Every value below is read off `Player Stat Boxes.dc.html` — the overlay
  // markup at :1125-1177 and the `holdBreak()` data model at :1326-1395 — not
  // off the capture and not off the README. The capture confirms them: its card
  // measures 684.0 CSS at DPR 2, and 684 / 0.9 (the browser zoom that frame was
  // taken at) is 760.0, the export's `max-width` exactly; its set-cell pitch
  // measures 174 device against the 174.2 the declared tracks predict.
  //
  // WHAT THE ENGINE STILL OWNS. `holdbreak-heatmap.js` is shared with the Live
  // tab, which is on the don't-touch list, so not one of these colours is
  // changed there — the engine keeps deciding the BAND and this renderer maps
  // its palette onto the export's. That matters beyond tidiness: the engine
  // bands BREAK at 30/18 where the export's `band()` uses 85/70 for both modes
  // (its mock only ever renders hold), and a break rate of 31% is a good one.
  // Ours is the correct thresholds; the note prints whichever pair is live.
  //
  // The engine's band background is the discriminator rather than its text
  // colour, because the engine greys the TEXT of a 5-9 cell and keeps its band
  // background — so the background is the only field that still carries the band
  // for a muted cell, which is exactly the cell the export wants muted-but-tinted.
  // ── TEN-384 · the pop-up rebuilt to the reference (OFFICIAL VERSION 1) ─────
  // The engine decides each set cell's colour from its GAP to the pair's own
  // all-sets rate (founder TEN-376 U3: green from +3 pts, red from −3, neutral
  // within; holdbreak-heatmap.js `gapBand`). This renderer only maps the engine's
  // `tag` ('up' | 'down' | 'even') and `gap` onto the reference's cell:
  //   full n ≥ 10   16% fill + 36% edge of the gap colour; figure Plex 14/700 in the
  //                 gap colour (white when even); sub "+7 pts" Plex 9.5 label
  //   muted n 5–9   8% fill + 16% edge; figure Plex 14/500 label; sub label at 70%
  //   raw n < 5     white 3% + --line; "2/2" Plex 14/500 label over "raw"
  //   none          white 2% + --line; "—" Plex 14/400 label
  // The all-sets cell is never tinted: white 3% + --line, figure white 700, "65/80".
  var HB_HUE = { up: 'var(--viz-up)', down: 'var(--viz-down)' };
  var HB_FAINT = 'var(--text-label)';
  var HB_NEUTRAL_BG = 'color-mix(in srgb, var(--text) 3%, transparent)';
  var HB_DEAD_BG = 'color-mix(in srgb, var(--text) 2%, transparent)';
  var HB_CELL = 'display:flex;flex-direction:column;align-items:center;gap:1px;border-radius:9px;padding:10px 0;';
  var HB_FIG = 'font-family:\'IBM Plex Mono\',monospace;font-size:14px;';
  var HB_SUB = 'font-family:\'IBM Plex Mono\',monospace;font-size:9.5px;';
  function hbTint(tag, fill, edge) {
    var hue = HB_HUE[tag];
    if (!hue) return null;
    return {
      bg: 'color-mix(in srgb, ' + hue + ' ' + fill + '%, transparent)',
      bd: 'color-mix(in srgb, ' + hue + ' ' + edge + '%, transparent)'
    };
  }
  /** The sample tier, read off the engine's own `frac` ('' dead, 'raw', 'won/n'). */
  function hbTier(c) {
    if (!c.frac) return 'none';
    if (c.frac === 'raw') return 'raw';
    var n = parseInt(String(c.frac).split('/')[1], 10);
    return isFinite(n) && n < 10 ? 'muted' : 'full';
  }
  function hbCellHtml(c) {
    var tier = hbTier(c);
    var bg, bd, fig, figStyle, sub = '', subInk = HB_FAINT;
    if (tier === 'none') {
      bg = HB_DEAD_BG; bd = 'var(--line)'; fig = DASH;
      figStyle = 'font-weight:400;color:' + HB_FAINT + ';';
    } else if (tier === 'raw') {
      bg = HB_NEUTRAL_BG; bd = 'var(--line)'; fig = c.pct; sub = 'raw';
      figStyle = 'font-weight:500;color:' + HB_FAINT + ';';
    } else {
      var muted = tier === 'muted';
      var t = hbTint(c.tag, muted ? 8 : 16, muted ? 16 : 36);
      bg = t ? t.bg : (muted ? HB_DEAD_BG : HB_NEUTRAL_BG);
      bd = t ? t.bd : 'var(--line)';
      fig = c.pct;
      figStyle = muted ? 'font-weight:500;color:' + HB_FAINT + ';'
        : 'font-weight:700;color:' + (HB_HUE[c.tag] || 'var(--text)') + ';';
      sub = hbEngine() ? hbEngine().gapText(c.gap) : '';
      if (muted) subInk = 'color-mix(in srgb, var(--text-label) 70%, transparent)';
    }
    return '' +
      '<span data-pp2="hb-cell" data-tier="' + tier + '" title="' + esc(c.tipHead +
        (c.tipRate ? ' ' + MIDDOT + ' ' + c.tipRate : '') +
        (c.tipNote ? ' ' + MIDDOT + ' ' + c.tipNote : '')) + '" ' +
      'style="' + HB_CELL + 'background:' + bg + ';border:1px solid ' + bd + ';">' +
        '<span style="' + HB_FIG + figStyle + '">' + esc(fig) + '</span>' +
        '<span style="' + HB_SUB + 'color:' + subInk + ';">' + esc(sub) + '</span>' +
      '</span>';
  }

  /** The ALL SETS cell — neutral, never gap-tinted (it IS the reference rate). */
  function hbGlobalCellHtml(r) {
    var dead = r.gPct === DASH;
    return '' +
      '<span data-hb="all" style="' + HB_CELL + 'background:' + (dead ? HB_DEAD_BG : HB_NEUTRAL_BG) + ';' +
        'border:1px solid var(--line);">' +
        '<span style="' + HB_FIG + 'font-weight:' + (dead ? 400 : 700) + ';color:' +
          (dead ? HB_FAINT : 'var(--text)') + ';">' + esc(r.gPct) + '</span>' +
        '<span style="' + HB_SUB + 'color:' + HB_FAINT + ';">' + esc(r.gFrac || '') + '</span>' +
      '</span>';
  }

  /** The reference's darker-track segment (Hold | Break), reused for the parked
   *  surface filter (founder Q6: keep, restyled). Track --card + --edge-6, radius 9,
   *  pad 3, gap 3; selected --inner + --edge-10, white 700; idle --text-label 600. */
  function hbSegHtml(hook, items, active) {
    return '<span data-pp2-seg="' + hook + '" style="display:inline-flex;gap:3px;background:var(--card);' +
      'border:1px solid var(--edge-6);border-radius:9px;padding:3px;">' +
      items.map(function (it) {
        var on = it.id === active;
        return '<button type="button" data-pp2="' + hook + '" data-v="' + esc(it.id) + '" ' +
          'style="cursor:pointer;padding:5px 14px;border-radius:7px;font-family:var(--font-words);font-size:11.5px;' +
          'font-weight:' + (on ? 700 : 600) + ';color:' + (on ? 'var(--text)' : 'var(--text-label)') + ';' +
          'background:' + (on ? 'var(--inner)' : 'transparent') + ';' +
          'border:1px solid ' + (on ? 'var(--edge-10)' : 'transparent') + ';">' +
          esc(it.label) + '</button>';
      }).join('') + '</span>';
  }

  var HB_MODES = [{ id: 'hold', label: 'Hold' }, { id: 'break', label: 'Break' }];

  /** "Game 1-2" (engine) → "Game 1–2" (en dash in a range); "svc" → "return" on Break. */
  function hbPairLabel(bucket) { return String(bucket || '').replace('-', ENDASH); }
  function hbPairSub(sub, mode) {
    return mode === 'break' ? String(sub || '').replace('svc game', 'return game') : String(sub || '');
  }

  /** ONE grid: Game pair · ALL SETS · hairline · Set 1–5. */
  function hbGridHtml(model, mode) {
    var HEAD = ['All sets', 'Set 1', 'Set 2', 'Set 3', 'Set 4', 'Set 5'];
    function headCell(t, left) {
      return '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
        'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);text-align:' +
        (left ? 'left' : 'center') + ';">' + esc(t) + '</span>';
    }
    // The 10px track between ALL SETS and Set 1 carries a 1x34 rule, so the two
    // halves of the row read as separate scales rather than one six-set run.
    var divider = '<span style="display:flex;justify-content:center;">' +
      '<span style="width:1px;height:34px;background:var(--edge-10);"></span></span>';

    var head = headCell('Game pair', true) + headCell(HEAD[0]) + '<span></span>' +
      HEAD.slice(1).map(function (h) { return headCell(h); }).join('');

    var rows = model.rows.map(function (r) {
      return '' +
        '<span data-hb="pair" style="display:flex;flex-direction:column;gap:2px;">' +
          '<span style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;">' +
            esc(hbPairLabel(r.bucket)) + '</span>' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;color:var(--text-label);">' +
            esc(hbPairSub(r.sub, mode)) + '</span>' +
        '</span>' +
        hbGlobalCellHtml(r) + divider + r.cells.map(hbCellHtml).join('');
    }).join('');

    return '<div class="pp2-hb-grid" style="display:grid;' +
      'grid-template-columns:132px 78px 10px repeat(5,minmax(0,1fr));gap:8px 7px;' +
      'align-items:center;">' + head + rows + '</div>';
  }

  /**
   * The 3-up strip — "Hold rate · all" / "Best pair" / "Weakest pair", all derived
   * from the engine's model (no new arithmetic store):
   *   · rate · all   = the engine's weighted global (its globalLabel figure), over
   *                    Σ won / Σ n of the six pairs' all-sets fractions
   *   · best/weakest = the pair with the highest / lowest ALL-SETS rate among pairs
   *                    on ten or more games (the full-sample gate; ties → the
   *                    larger n). No pair clears the gate → "—".
   */
  function hbStripModel(model) {
    var won = 0, n = 0, pairs = [];
    model.rows.forEach(function (r) {
      var m = /^(\d+)\/(\d+)$/.exec(String(r.gFrac || ''));
      if (!m) return;
      var w = +m[1], t = +m[2];
      won += w; n += t;
      // The pair's rate is the engine's own printed all-sets figure (gPct), never
      // re-derived here — this renderer computes no rate (ruling 7).
      var gp = parseInt(String(r.gPct), 10);
      if (t >= 10 && isFinite(gp)) pairs.push({ label: hbPairLabel(r.bucket), pct: gp, w: w, n: t });
    });
    var g = /(\d+(?:\.\d+)?)%/.exec(String(model.globalLabel || ''));
    function pick(dir) {
      var best = null;
      pairs.forEach(function (q) {
        if (!best || dir * (q.pct - best.pct) > 0 || (q.pct === best.pct && q.n > best.n)) best = q;
      });
      return best;
    }
    return { rate: g ? g[1] + '%' : DASH, won: won, n: n, best: pick(1), worst: pick(-1) };
  }
  function hbStripHtml(model, mode) {
    var st = hbStripModel(model);
    function cell(cap, val, sub, first) {
      return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:13px 16px;' +
        'text-align:center;min-width:0;border-left:1px solid ' + (first ? 'transparent' : 'var(--line)') + ';">' +
        '<span style="font-family:var(--font-words);font-size:10.5px;font-weight:700;letter-spacing:0.10em;' +
          'text-transform:uppercase;color:var(--text-label);">' + esc(cap) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:22px;font-weight:700;line-height:22px;' +
          'color:' + (val === DASH ? HB_FAINT : 'var(--text)') + ';">' + esc(val) + '</span>' +
        '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:var(--text-label);">' +
          esc(sub) + '</span></div>';
    }
    function pairSub(q) { return q ? q.label + ' ' + MIDDOT + ' ' + q.w + '/' + q.n : 'no pair on 10+ games'; }
    return '<div data-hb="strip" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));' +
      'background:var(--card);border:1px solid var(--edge-6);border-radius:12px;overflow:hidden;">' +
      cell((mode === 'break' ? 'Break' : 'Hold') + ' rate ' + MIDDOT + ' all', st.rate,
        st.n ? st.won + '/' + st.n + ' games' : DASH, true) +
      cell('Best pair', st.best ? st.best.pct + '%' : DASH, pairSub(st.best)) +
      cell('Weakest pair', st.worst ? st.worst.pct + '%' : DASH, pairSub(st.worst)) +
      '</div>';
  }

  /**
   * The heatmap pop-up, built to the reference's sheet (760, --card + --edge-10,
   * radius 14, pad 22/24/24, --shadow-modal):
   *   header  caps eyebrow "All surfaces · last 24 months · N service games",
   *           title 18/800, sub "C. Alcaraz · how often he held serve in each game
   *           pair, overall and by set"; right: Hold | Break + close
   *   strip   Hold rate · all / Best pair / Weakest pair
   *   grid    Game pair · All sets · Set 1–5
   * PARKED (founder Q6): our surface filter (All / Hard / Clay / Grass) has no home
   * in the reference. It stays, in the same darker-track chrome, under Hold | Break.
   * The old legend footnote is removed (reference has none); the 85/70 threshold
   * copy went with the absolute band it described.
   */
  function renderHeatSheet(p) {
    if (!state.heat) return '';
    var E = hbEngine();
    var HB = hbStore();
    var mode = state.hbMode === 'break' ? 'break' : 'hold';
    var surf = state.hbSurf || 'all';
    var sn = shortName(p);
    var model = null;

    var body;
    if (!E || !HB) {
      body = '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
        'text-align:center;font-size:13px;color:' + DASH_COLOUR + ';">Hold/break data is not loaded.</div>';
    } else {
      var cov = hbCoverage(p);
      if (!cov) {
        // Ruling 7: a player outside the rollup has NO per-game data. Say it in
        // words — sixty dashes read as a rendering fault, not as an absence.
        var rosterN = (HB.meta && HB.meta.players) || null;
        var winN = (HB.meta && HB.meta.windowMonths) || null;
        body = '<div style="border:1px dashed var(--edge-6);border-radius:10px;padding:26px;' +
          'text-align:center;font-size:13px;color:' + DASH_COLOUR + ';line-height:1.6;">' +
          esc(sn) + ' has no point-by-point data on record, so holds and breaks by game cannot be shown.' +
          (rosterN && winN ? '<br>The rollup covers ' + rosterN + ' players over the last ' +
            winN + ' months.' : '') + '</div>';
      } else {
        model = E.heatFor(HB, p.key, mode === 'break' ? 'BREAK' : 'HOLD', HB_BEST_OF, surf);
        body = hbStripHtml(model, mode) + hbGridHtml(model, mode);
      }
    }

    // The eyebrow reads the LIVE filter, the shard's own window and the games the
    // grid actually rests on (Σ n of the six pairs' all-sets fractions).
    var scopeSurf = surf === 'all' ? 'All surfaces'
      : (surf.charAt(0).toUpperCase() + surf.slice(1));
    var win = (HB && HB.meta && HB.meta.windowMonths) || null;
    var games = model ? hbStripModel(model).n : null;
    // The parse coverage the old footnote stated (matches reached, service games,
    // span), kept on the eyebrow's tooltip: the reference has no footnote, and
    // the count — never the career total — must stay reachable.
    var cv = E && HB ? hbCoverage(p) : null;
    var covTip = cv ? 'Parsed from ' + cv.matches + ' of ' + sn + '’s matches ' + MIDDOT + ' ' + cv.svcGames +
      ' service games' + (cv.from && cv.to ? ' ' + MIDDOT + ' ' + cv.from + ' ' + ENDASH + ' ' + cv.to : '') : '';
    var eyebrow = scopeSurf + (win ? ' ' + MIDDOT + ' last ' + win + ' months' : '') +
      (games ? ' ' + MIDDOT + ' ' + games.toLocaleString('en-US') + ' ' + (mode === 'break' ? 'return' : 'service') + ' games' : '');

    return '' +
      '<div class="pp2-sheet" data-pp2="heat-scrim" style="position:fixed;inset:0 0 0 var(--sf-side, 0px);z-index:80;' +
        'background:var(--backdrop); backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;' +
        'padding:40px 24px;overflow-y:auto;">' +
        '<div style="position:relative;width:100%;max-width:760px;background:var(--card);' +
          'border:1px solid var(--edge-10);border-radius:14px;padding:22px 24px 24px;box-shadow:var(--shadow-modal);' +
          'display:flex;flex-direction:column;gap:16px;">' +

          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">' +
            '<div style="display:flex;flex-direction:column;gap:6px;min-width:0;">' +
              '<span data-hb="eyebrow"' + (covTip ? ' title="' + esc(covTip) + '"' : '') + ' style="font-family:var(--font-words);font-size:10.5px;font-weight:700;' +
                'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);">' + esc(eyebrow) + '</span>' +
              '<span style="font-size:18px;font-weight:800;letter-spacing:-0.015em;color:var(--text);">' +
                'Hold / break heatmap</span>' +
              '<span style="font-size:12.5px;color:var(--text-label);">' + esc(p.name || sn) + ' ' + MIDDOT +
                ' how often he ' + (mode === 'break' ? 'broke serve' : 'held serve') +
                ' in each game pair, overall and by set</span>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none;">' +
              '<div style="display:flex;align-items:center;gap:12px;">' +
                hbSegHtml('hb-mode', HB_MODES, mode) +
                '<button type="button" data-pp2="heat-close" aria-label="Close" ' +
                  'style="background:var(--selected);border:1px solid var(--line);' +
                  'border-radius:8px;width:30px;height:30px;color:var(--text-label);font-size:15px;line-height:1;' +
                  'cursor:pointer;flex:none;">' + TIMES + '</button>' +
              '</div>' +
              // Founder Q6 (TEN-384): Hold | Break only. The surface filter's code
              // path (state.hbSurf, the 'hb-surf' handler, HB_SURFACES) is kept;
              // the control is simply not rendered while HB_SHOW_SURF is off.
              (HB_SHOW_SURF ? hbSegHtml('hb-surf', HB_SURFACES, surf) : '') +
            '</div>' +
          '</div>' +

          body +
        '</div>' +
      '</div>';
  }


  // ───────────────────────────────────────────────────────────────────────────
  // BUILD ITEM 2 · heatmap launcher + overlay
  //
  // The design shows a launcher card above the Situational table carrying a
  // headline hold figure and an "Open ›" affordance, with the grid itself in a
  // layer above the modal.
  //
  // REPORTED DEVIATION — the headline figure. The design card reads
  // "Hold 71.5%". That number is in no store we hold: C. Alcaraz's weighted hold
  // is 87.8% (all surfaces, 125 matches / 1,568 service games), the roster-wide
  // weighted hold is 79.6%, and his break is 31.3%. 71.5% matches neither, on any
  // of the four surfaces, so it is placeholder copy in the mock rather than a
  // figure to reproduce. The standing rule is "never fabricate or approximate",
  // so the card prints what the engine returns and the deviation is noted here
  // and in RULED-DECISIONS.md.
  //
  // The figure is `heatFor().globalLabel` verbatim — the engine's own weighted
  // sum over every bucket and set, the same string the grid's pill shows. This
  // renderer computes nothing, so the card and the grid behind it cannot
  // disagree.
  function hbLauncherHtml(p) {
    var E = hbEngine();
    var HB = hbStore();
    if (!E || !HB) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:12px;padding:18px;' +
        'font-size:12.5px;color:' + DASH_COLOUR + ';">Hold/break data is not loaded.</div>';
    }

    var cov = hbCoverage(p);
    var sn = shortName(p);

    // No per-game data at all. No button: an "Open ›" that opens an empty grid
    // is a worse answer than the sentence saying why there is nothing to open.
    if (!cov) {
      var rosterN = (HB.meta && HB.meta.players) || null;
      var winN = (HB.meta && HB.meta.windowMonths) || null;
      return '<div style="border:1px dashed var(--edge-6);border-radius:12px;padding:18px;' +
        'font-size:12.5px;color:' + DASH_COLOUR + ';line-height:1.6;">' +
        esc(sn) + ' has no point-by-point data on record, so holds and breaks by game cannot be shown.' +
        (rosterN && winN
          ? '<br>The rollup covers ' + rosterN + ' players over the last ' + winN + ' months.'
          : '') +
        '</div>';
    }

    var surf = state.hbSurf || 'all';
    var hold = E.heatFor(HB, p.key, 'HOLD', HB_BEST_OF, surf);
    // TEN-384 · the reference's entry tile: a clickable tile (--card + --edge-7,
    // hover --tile-hover + --edge-16, radius 12, pad 13/15), a 30px icon tile on
    // --selected with a --line edge and a white glyph, title 13.5/700, a Hanken
    // 11.5 sentence, and ONE mono figure on the right. No "Open ›", no caps pill.
    // The figure is the engine's weighted global (heatFor().globalLabel's number,
    // the same figure as the pop-up's "Hold rate · all"), worded "Hold 87.2%".
    var holdFig = /(\d+(?:\.\d+)?%|—)$/.exec(String(hold.globalLabel || ''));
    return '' + ANA_STYLE +
      '<div data-pp2="heat" class="pp2-atile" style="cursor:pointer;display:flex;align-items:center;' +
        'justify-content:space-between;gap:14px;background:var(--card);' +
        'border:1px solid var(--edge-7);border-radius:12px;padding:13px 15px;">' +
        '<span style="display:flex;align-items:center;gap:11px;min-width:0;">' +
          '<span style="width:30px;height:30px;border-radius:9px;box-sizing:border-box;' +
            'background:var(--selected);border:1px solid var(--line);' +
            'display:flex;align-items:center;justify-content:center;flex:none;color:var(--text);">' +
            '<svg width="12" height="12" viewBox="0 0 12 12" fill="none">' +
              '<rect x="0.8" y="0.8" width="4" height="4" stroke="currentColor" stroke-width="1.2"/>' +
              '<rect x="7.2" y="0.8" width="4" height="4" stroke="currentColor" stroke-width="1.2"/>' +
              '<rect x="0.8" y="7.2" width="4" height="4" stroke="currentColor" stroke-width="1.2"/>' +
              '<rect x="7.2" y="7.2" width="4" height="4" stroke="currentColor" stroke-width="1.2"/>' +
            '</svg>' +
          '</span>' +
          '<span style="display:flex;flex-direction:column;gap:3px;min-width:0;">' +
            '<span style="font-size:13.5px;font-weight:700;color:var(--text);">Hold / break heatmap</span>' +
            '<span style="font-size:11.5px;color:var(--text-label);">' +
              'Hold and break rate by service-game pair, set by set</span>' +
          '</span>' +
        '</span>' +
        '<span data-pp2-hold="' + esc(hold.globalLabel) + '" style="flex:none;font-family:\'IBM Plex Mono\',monospace;' +
          'font-size:13px;font-weight:700;color:var(--text);">Hold ' + esc(holdFig ? holdFig[1] : DASH) + '</span>' +
      '</div>';
  }

  // TEN-384 · hover states for ana's modals (Draw / Matchup / Market edge / Live
  // trading). Inline styles cannot express :hover, so the clickable-tile rule of the
  // foundation (hover --tile-hover + --edge-16) lands here, scoped to `.pp2-atile`.
  // The selected tile carries its own inline --edge-24, which `:not(.on)` leaves be.
  var ANA_STYLE = '<style>' +
    '.pp2-atile{transition:background .12s ease,border-color .12s ease;}' +
    '.pp2-atile:not(.on):hover{background:var(--tile-hover)!important;border-color:var(--edge-16)!important;}' +
    '.pp2-arow{transition:background .12s ease;}' +
    '.pp2-arow:hover{background:var(--tile-hover);}' +
    // Matchup ledger rows: hover lifts to --tile-hover, bled 10px like the open row.
    '.pp2-mrow:not(.on):hover{background:var(--tile-hover);box-shadow:-10px 0 0 var(--tile-hover),10px 0 0 var(--tile-hover);}' +
    // A table that scrolls inside a modal: the thin blended bar (white 13% thumb).
    '.pp2-yscroll::-webkit-scrollbar{width:9px;height:9px;}' +
    '.pp2-yscroll::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--text) 13%, transparent);border-radius:5px;}' +
    '.pp2-yscroll::-webkit-scrollbar-track{background:transparent;}' +
    '</style>';

  // ───────────────────────────────────────────────────────────────────────────
  // BUILD ITEM 3 · SITUATIONAL, scoped
  //
  // Rows, labels, group order and every display rule come from the LOCKED export
  // (`Player Stat Boxes.dc.html`:1630, `situational()`). Read them there, not
  // from the README.
  //
  // ── REPORTED CORRECTION TO THE RULING, with the measurement ────────────────
  // The ruling reads: "Ship the 8 pbp-backed rows unconditionally... The 7
  // set-score rows render ONLY where that player's shard carries per-set
  // scores." Measured against the DEPLOYED store (575 players, fetched
  // 2026-09-19T01:41:44Z), the availability runs the other way:
  //
  //   per-set outcomes (recentForm.matches[].sets) : 575 of 575 players
  //   point-by-point  (holdbreak roster)           : 315 of 575 players
  //   set-only (no pbp): 260    pbp-only: 0    neither: 0
  //
  // So the set rows are the ones available to EVERY player and the pbp rows are
  // the ones 260 players (45% of the roster) have none of. Shipping the pbp rows
  // unconditionally would print the "block of dashes" the same ruling forbids,
  // on nearly half the roster. The conditionality is therefore attached to the
  // pbp rows and the set rows ship for everyone. Same rule, correct side.
  //
  // Two further figures in the ruling could not be reproduced and are NOT built
  // to: the row split is 8 pbp + 6 set = 14 (the export has 14 rows, not 15),
  // and "Alcaraz has 68 matches of set-by-set" matches no source we hold — he
  // has 30 in recentForm, 125 in pbp and 395 in tournamentHistory (whose `score`
  // is the set TALLY "3 - 0", never a scoreline).
  //
  // ── COUNTING RULES, stated because they are judgement calls ────────────────
  // * Walkovers are excluded: no play happened, so there is no set to win. This
  //   is the same treatment the WD ruling gives a walkover given.
  // * Retirements are INCLUDED — the match has a real winner — but each row is
  //   computed only over matches that actually reached the set it asks about, so
  //   a match retired in set 1 never lands in a "set 2" denominator.
  // * "Won set 1 -> won 2-0" is a best-of-3 question, so best-of-five matches are
  //   out of its denominator. A slam is identified by name and any match that ran
  //   to four or five sets is best-of-five by construction.
  // * A match can appear in several rows. That is stated in the footnote.
  var SIT_GREEN = 'var(--pos)', SIT_RED = 'var(--neg)', SIT_FAINT = 'var(--text-label)';
  // Grid + eyebrow taken verbatim from the export (Player Stat Boxes.dc.html
  // :919 head, :933 rows). Measured off the founder's screenshot first and both
  // agree: our build had 1fr 62/74/62/72 at gap 10, which made every numeric
  // column 9-13px wider than the design and pushed RECORD 27px to its left.
  // TEN-384 · the reference's tracks (OFFICIAL VERSION 1, Live trading, 774 body):
  // label 470 · Record 64 · Rate 64 · Tour 56 · Vs tour 72, gap 0 12. The head row
  // carries the same tracks inside a 4px side padding (462 + 8 = 470).
  var SIT_TRACKS = 'grid-template-columns:minmax(0,1fr) 64px 64px 56px 72px;gap:0 12px;';
  var SIT_EYEBROW = "font-family:var(--font-words);font-size:10.5px;font-weight:700;"
    + 'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);';
  var SIT_CELLBD = 'border-top:1px solid var(--line);';
  var SIT_MUT = 'var(--text-label)', SIT_DIM = 'var(--text-label)', SIT_BRIGHT = 'var(--text)';

  var SIT_GROUPS = [
    ['Set outcomes', [
      ['winSet1', 'Win first set', 'set'],
      ['winSet2', 'Win set 2', 'set'],
      ['winSet3', 'Win set 3', 'set']
    ]],
    ['Break of serve', [
      ['brokenFirstSvc', 'Broken in first service game', 'pbp'],
      ['firstBreak', 'Get the first break of serve', 'pbp'],
      ['brokenBack', 'Broken back immediately after breaking', 'pbp'],
      ['breakBack', 'Broken, then break back before set end', 'pbp']
    ]],
    ['After set one', [
      ['wonS1WonMatch', 'Won set 1 ' + RARROW + ' won match', 'set'],
      ['lostS1WonS2', 'Lost set 1 ' + RARROW + ' won set 2', 'set'],
      ['wonS1Won20', 'Won set 1 ' + RARROW + ' won 2' + ENDASH + '0', 'set'],
      ['lostS1FirstBreakS2', 'Lost set 1, first break in set 2', 'pbp']
    ]],
    ['Serving for the set', [
      ['holdWinSet', 'Hold to win set (5' + ENDASH + '3, 5' + ENDASH + '4, 6' + ENDASH + '5)', 'pbp'],
      ['holdStaySet', 'Hold to stay in set (3' + ENDASH + '5, 4' + ENDASH + '5, 5' + ENDASH + '6)', 'pbp'],
      ['breakOppServing', 'Break opp. serving for set', 'pbp']
    ]]
  ];

  var SIT_SLAM = /^(australian open|french open|roland garros|wimbledon|us open)$/i;

  // The point-by-point store. Built CI-side by build-situational.js over the same
  // cache the hold/break rollup reads. Absent -> the pbp rows are omitted, never
  // dashed into place.
  function sitStore() { return window.situational || null; }

  function sitPbpFor(p) {
    var st = sitStore();
    var rec = st && st.players ? st.players[String(p.key)] : null;
    return rec && rec.rows ? rec : null;
  }

  // Per-set outcomes for one player, counted into the six set rows.
  function sitSetCounts(p) {
    var ms = (p && p.recentForm && p.recentForm.matches) || [];
    var rows = {}, n = 0;
    function add(id, won) {
      var r = rows[id] || (rows[id] = { w: 0, l: 0 });
      if (won) r.w++; else r.l++;
    }
    ms.forEach(function (m) {
      var sets = m && m.sets;
      if (!Array.isArray(sets) || !sets.length) return;
      if (m.walkover) return;                       // no play, no set to win
      n++;
      function tookSet(i) {
        var s = sets[i];
        if (!s || s.p == null || s.o == null) return null;
        if (s.p === s.o) return null;
        return s.p > s.o;
      }
      var s1 = tookSet(0), s2 = tookSet(1), s3 = tookSet(2);
      if (s1 !== null) add('winSet1', s1);
      if (s2 !== null) add('winSet2', s2);
      if (s3 !== null) add('winSet3', s3);
      if (s1 === true) add('wonS1WonMatch', !!m.won);
      if (s1 === false && s2 !== null) add('lostS1WonS2', s2);
      var bo5 = sets.length >= 4 || SIT_SLAM.test(String(m.tournament || '').trim());
      if (s1 === true && !bo5) add('wonS1Won20', !!m.won && sets.length === 2);
    });
    return { n: n, rows: rows };
  }

  // Tour figures. Ruling 2 applies here too: this is the average of the players
  // WE hold data for, not the ATP field, and the count is read at render time.
  // The set rows pool every player's recentForm; the pbp rows take the pooled
  // block the builder wrote, so the two never mix populations.
  var _sitTour = null;
  function sitTour() {
    if (_sitTour) return _sitTour;
    var map = playersMap();
    var keys = Object.keys(map);
    var acc = {}, players = 0;
    keys.forEach(function (k) {
      var c = sitSetCounts(map[k]);
      if (!c.n) return;
      players++;
      Object.keys(c.rows).forEach(function (id) {
        var a = acc[id] || (acc[id] = { w: 0, l: 0 });
        a.w += c.rows[id].w; a.l += c.rows[id].l;
      });
    });
    var out = { rows: {}, players: players, pbpPlayers: null };
    Object.keys(acc).forEach(function (id) {
      var t = acc[id].w + acc[id].l;
      out.rows[id] = t ? (acc[id].w / t) * 100 : null;
    });
    var st = sitStore();
    if (st && st.tour) {
      Object.keys(st.tour).forEach(function (id) {
        var t = st.tour[id];
        out.rows[id] = t && t.pct != null ? t.pct : null;
      });
      out.pbpPlayers = (st.meta && st.meta.players) || null;
    }
    _sitTour = out;
    return out;
  }

  // One row, painted to the reference (TEN-384): label Hanken 13/600 white with a
  // 9.5/700 caps SMALL-SAMPLE slot under it; Record Plex 12 label; Rate Plex 14/700
  // white; Tour Plex 12 label; Vs tour Plex 12.5/600 signed; 8px rows on --line.
  // The sample ladder is unchanged: n<5 shows the raw record and dashes the rate
  // (slot "n < 5"); 5-9 greys the rate and marks "small sample"; a missing tour
  // figure dashes BOTH tour columns, never a zero and never a blank.
  function sitRowHtml(label, rec, tourPct) {
    var w = rec ? rec.w : 0, l = rec ? rec.l : 0, n = w + l;
    var hard = n < 5, soft = n >= 5 && n < 10;
    var rate = n ? (w / n) * 100 : null;
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    var vs = (!hard && rate != null && tourPct != null) ? rate - tourPct : null;
    var vsR = vs == null ? null : r1(vs);
    // fx3 (founder D11): the small-sample mark sits UNDER the rate, not in the label's slot; the slot keeps
    // "n < 5" (and stays in the markup, empty, as before). A 5–9 row's cells stretch so its
    // figures share the label's first line and the mark takes the second.
    var slot = hard && n ? 'n < 5' : '';

    var cell = function (txt, colour, size, weight, markN) {
      return '<div style="text-align:right;font-family:\'IBM Plex Mono\',monospace;' +
        // nowrap (shard r2): the Record cell is a W–L, and an en dash is a line-break opportunity.
        'font-size:' + size + ';color:' + colour + ';padding:8px 0;white-space:nowrap;' + SIT_CELLBD +
        (soft ? 'align-self:stretch;' : '') +
        (weight ? 'font-weight:' + weight + ';' : '') + '">' +
        (markN ? rateOverMark(esc(txt), markN) : esc(txt)) + '</div>';
    };

    return '' +
      '<div style="display:grid;' + SIT_TRACKS + 'align-items:center;">' +
        // 19px left indent hangs each label under the group header's chevron.
        '<div style="display:flex;flex-direction:column;gap:2px;min-width:0;' +
          'padding:8px 4px 8px 19px;' + SIT_CELLBD + (soft ? 'align-self:stretch;' : '') + '">' +
          '<span style="font-size:13px;font-weight:600;color:' + (hard ? SIT_DIM : 'var(--text)') + ';' +
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(label) + '</span>' +
          // The slot is always present (empty when the sample is full), as in the
          // reference, so every row keeps the same 2px gap and height.
          '<span style="font-family:var(--font-words);font-size:9.5px;font-weight:700;' +
            'line-height:1.2;letter-spacing:0.10em;text-transform:uppercase;color:var(--text-label);' +
            'white-space:nowrap;">' + esc(slot) + '</span>' +
        '</div>' +
        cell(n ? w + ENDASH + l : DASH, SIT_MUT, '12px') +
        cell(hard || rate == null ? DASH : rate.toFixed(1) + '%',
          hard ? SIT_DIM : (soft ? SIT_MUT : SIT_BRIGHT), '14px', hard ? 400 : 700, soft ? n : 0) +
        cell(tourPct == null ? DASH : Math.round(tourPct) + '%', SIT_DIM, '12px') +
        cell(vsR == null ? DASH
          : (vsR > 0 ? '+' : vsR < 0 ? MINUS : '') + Math.abs(vsR).toFixed(1) + 'pp',
          vsR == null ? SIT_DIM : (vsR > 0 ? SIT_GREEN : vsR < 0 ? SIT_RED : SIT_MUT),
          '12.5px', 600) +
      '</div>';
  }

  // ONE head row for the whole table. TEN-384: the reference names the table in
  // the head row's first cell ("Situational · set-by-set data") instead of a 20px
  // title above it. `note` (the former footnote, the founder's wording verbatim:
  // what population the rows rest on and who "tour" is) rides on that cell as a
  // tooltip — the reference has no footnote, and the caveat must stay reachable.
  function sitHeadHtml(note) {
    var h = function (t) {
      return '<div style="text-align:right;' + SIT_EYEBROW + '">' + t + '</div>';
    };
    return '<div style="display:grid;' + SIT_TRACKS + 'align-items:flex-end;' +
      'padding:0 4px 8px;border-bottom:1px solid var(--line);margin-top:4px;">' +
      '<div data-sit="head"' + (note ? ' title="' + esc(note) + '"' : '') + ' style="' + SIT_EYEBROW + '">' +
        'Situational ' + MIDDOT + ' set-by-set data</div>' +
      h('Record') + h('Rate') + h('Tour') + h('Vs tour') + '</div>';
  }

  function renderSituational(p) {
    var set = sitSetCounts(p);
    var pbp = sitPbpFor(p);
    var tour = sitTour();
    var open = state.sitOpen || {};

    var groups = SIT_GROUPS.map(function (g) {
      var title = g[0];
      // A row is only present when its SOURCE is held for this player. A row
      // whose source is absent is not a dash — it is not a row.
      var rows = g[1].filter(function (r) {
        return r[2] === 'set' ? set.n > 0 : !!pbp;
      });
      return { title: title, rows: rows };
    }).filter(function (g) { return g.rows.length > 0; });

    // Nothing at all. Said in words, with no empty table.
    if (!groups.length) {
      return '<div style="border:1px dashed var(--edge-6);border-radius:12px;padding:18px;' +
        'font-size:12.5px;color:' + DASH_COLOUR + ';">' +
        esc(shortName(p)) + ' has no set-by-set or point-by-point data on record, so in-play ' +
        'states cannot be shown.</div>';
    }

    var body = groups.map(function (g) {
      var on = open[g.title] == null ? true : !!open[g.title];
      var rows = on ? g.rows.map(function (r) {
        var id = r[0], label = r[1], src = r[2];
        var rec = src === 'set' ? set.rows[id] : (pbp.rows[id] || null);
        return sitRowHtml(label, rec, tour.rows[id] == null ? null : tour.rows[id]);
      }).join('') : '';
      return '' +
        '<div style="display:flex;flex-direction:column;margin-top:-14px;">' +
          '<button type="button" data-pp2="sit-toggle" data-v="' + esc(g.title) + '" ' +
            'aria-expanded="' + (on ? 'true' : 'false') + '" ' +
            'style="display:flex;align-items:center;gap:9px;width:100%;background:none;' +
            'border:0;border-top:1px solid var(--line);padding:10px 4px 6px;' +
            'cursor:pointer;text-align:left;' + SIT_EYEBROW + 'font-weight:800;">' +
            '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="flex:none;' +
              'transform:rotate(' + (on ? '90deg' : '0deg') + ');transition:transform .14s ease;">' +
              '<path d="M3 1l4 4-4 4" stroke="var(--text-label)" stroke-width="1.6" ' +
              'stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            esc(g.title) +
          '</button>' +
          (on ? rows : '') +
        '</div>';
    }).join('');

    // The former footnote, the founder's wording verbatim (rows rest on the
    // matches with set-by-set data, not the career figure; counted per match;
    // tour = the players we hold, read at render time). TEN-384 removes the
    // visible footnote (the reference has none); it rides on the head as a title.
    var srcBits = [];
    if (set.n) srcBits.push(set.n + ' matches with set-by-set data');
    if (pbp && pbp.matches != null) srcBits.push(pbp.matches + ' with point-by-point data');
    var note = 'These rows rest on the ' + srcBits.join(' and ') + ' we hold for ' +
      shortName(p) + ', not the full career figure shown in Career record. ' +
      'Situations are counted per match, so a match can appear in several rows. ' +
      (tour.players
        ? 'Tour figures are the average of the ' + tour.players + ' players we hold set-by-set ' +
          'data for' + (tour.pbpPlayers ? ' (' + tour.pbpPlayers + ' for the point-by-point rows)' : '') +
          ', not the ATP field. '
        : '') +
      'Fewer than 5 matches shows the record only; 5' + ENDASH + '9 is marked a small sample. ' +
      'Nothing here is estimated.';

    // Each group pulls itself up by the parent's 14px gap (the reference's
    // margin:-14px), so the head row and the first group header sit flush.
    return sitHeadHtml(note) + body;
  }

  // The Live trading modal body: the heatmap launcher, then the Situational
  // table. The grid itself is a click away in the layer above.
  function renderProfileModal(p) {
    // TEN-384: launcher, then the Situational table, in one 14px-gap column (the
    // reference's body). The footnotes (Situational's and the box-8 set-down note)
    // are removed — the reference has none; setDownNote() stays for its callers.
    return '<div style="display:flex;flex-direction:column;gap:14px;">' +
      hbLauncherHtml(p) + renderSituational(p) + '</div>';
  }

  /**
   * The window and the population behind box 8's support line.
   *
   * Founder ruling item 6 moved the tour GAP onto the tile, which displaced the
   * sample count that used to state the window. It lands here rather than being
   * dropped: a rate over 30 of 775 matches that never says so is the thin-sample
   * failure the standing rules exist to prevent.
   *
   * The second sentence is founder ruling TOUR AVERAGE, applied to the one place
   * on this page where "tour" appears with no room for its own caveat.
   */
  function setDownNote(p) {
    var sd = fromASetDown(p);
    if (!sd || !sd.scanned) return '';
    var tour = tourFromASetDown();
    return '<div style="font-size:11.5px;color:var(--text-label);line-height:1.6;margin-top:14px;">' +
      'The box&#39;s &ldquo;from a set down&rdquo; record rests on the ' + sd.n + ' of ' +
      sd.scanned + ' matches on record that carry ordered set scores, not the career figure ' +
      'shown in Career record &mdash; the career spine stores a set COUNT, which cannot tell ' +
      'losing the first set from losing the third.' +
      (tour.pct == null
        ? ' No tour comparison is drawn: fewer than ten players in the store carry enough ' +
          'set scores to strike one.'
        : ' The tour figure it is measured against (' + tour.pct.toFixed(1) + '%) is the average ' +
          'of the ' + tour.players + ' players we hold set scores for, over ' + tour.n + ' such ' +
          'matches &mdash; not the ATP field. That count is read at render time and grows as the ' +
          'store does.') +
      '</div>';
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // MOUNT
  // ═══════════════════════════════════════════════════════════════════════════
  var state = {
    key: null, ledgerOpen: false, ledgerExpanded: false, heat: false,
    surfaces: [], priceFilters: [], modal: null,
    // §5.2 Career record. `careerTab` is the file's Record|Ratings row;
    // `careerScope` is the head control, now Career|Last 52 ('career'|'l52') —
    // it used to be Career|<current year>, which the file replaced. The two are
    // independent axes of one modal: switching tab must not reset the window.
    careerTab: 'record',
    careerScope: 'career', splitScope: 'career', marketRole: 'all',
    careerTier: 'all',   // TEN-384 · the Career record's Tier control (all | atp | chitf)
    // §5.8 Market edge. marketBand is "<group>:<bandId>" for the open drill;
    // marketSide is the cumulative chart's Back|Fade; marketSurf its surface
    // filter. Three independent controls on one modal — kept apart so switching
    // one never silently resets another.
    marketBand: null, marketSide: 'back', marketSurf: 'all',
    // §5.1 tab row for Market edge (`Match winner | Derived lines`, default
    // winner) and the Derived-lines Bo3|Bo5 grain. Separate state for the same
    // reason as the Career modal's two axes: switching tab must not reset the
    // format, and switching format must not throw you back to Match winner.
    marketTab: 'winner', lcFmt: 'bo3', lcRole: 'all',
    // §5.7 Splits. The scope switch (Career / Last 52 weeks) and the tab switch
    // (Results / Sets & Games / Service) are independent axes of the same table —
    // changing scope must not reset the tab, so they are separate state.
    splitTab: 'results',
    tournQuery: '', tournOpen: null,
    // §5.4 Calendar record. calSurface 'all' is the default segment; calCell is
    // "YYYY-m" (month index, not 1-based). calTab is 'calendar' | '2026' (TEN-384 Q1: Streaks removed).
    calTab: 'calendar', calSurface: 'all', calCell: null, cal26Month: null,
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
    hbSurf: 'all',
    // Hold|Break, the export's own toggle. Hold is the default (:1327,
    // `this.state.hbMode || 'hold'`). One grid, switched — not two stacked.
    hbMode: 'hold',
    // §8.2 match panel / full-screen match page. `matchPage` holds the same
    // sheet id the match sheet uses, so one row id addresses both surfaces.
    // The three sub-controls are separate state for the same reason the
    // Career modal's two axes are: switching tab must not reset the set
    // filter, and switching set must not throw you back to Summary.
    matchPage: null, mpTab: 'summary', mpSet: 'match', mpPointSet: null
  };

  function buildCtx(p) {
    var rows = ledgerMatches(p);
    // One filtered set, shared by the ribbon strip/rate/chips and the ledger.
    // README §3 requires them to agree, and the only way to guarantee that is
    // for both to read the same array rather than two parallel filter passes.
    var lrows = ledgerRows(p);
    var subj = shortName(p);
    lrows.forEach(function (x) { x.subjectName = subj; });
    var frows = lrows.filter(function (x) { return inForm(x.m); });   // TEN-383: the form rows
    var lfiltered = ledgerFiltered(frows);
    var ctx = {
      p: p,
      rows: rows,
      ledgerRows: lrows,
      formRows: frows,
      ledgerFiltered: lfiltered,
      filtered: lfiltered.map(function (x) { return x.m; }),
      archetype: archetypeFor(p.key),
      ledgerOpen: state.ledgerOpen,
      // TEN-384: the header's Next match, from the host's fixture feed (null when none / no host)
      nextMatch: typeof window.pp2NextMatchFor === 'function' ? window.pp2NextMatchFor(p.key) : null
    };
    ctx.boxVals = buildBoxVals(p, ctx);
    return ctx;
  }

  var PP2_FRAME_PAD = '4px 10px 22px';
  function build(p) {
    var ctx = buildCtx(p);
    return '' +
      PP2_STYLE +
      // TEN-384: the reference's profile frame is padding 26 34 70 from the content edge; the host's .pagewrap
      // already gives 22 24 48, so the module adds the difference (PP2_FRAME_PAD).
      '<div class="pp2-main" style="display:flex;flex-direction:column;gap:22px;max-width:1440px;' +
        'box-sizing:border-box;padding:' + PP2_FRAME_PAD + ';">' +
        renderBackLink() +
        renderHeader(p, ctx) +
        renderRibbon(ctx) +
        renderLedger(p, ctx) +
        renderBoxes(ctx) +
        renderInsights(p) +
      '</div>' +
      renderModal(p, ctx) +
      renderHeatSheet(p) +
      renderMatchPage(p, ctx);
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
    state.careerScope = 'career'; state.careerDrill = null; state.careerTab = 'record'; state.careerTier = 'all';
    state.splitScope = 'career'; state.marketRole = 'all'; state.lcRole = 'all';
    state.tournQuery = ''; state.tournOpen = null;
    state.calTab = 'calendar'; state.calSurface = 'all'; state.calCell = null; state.cal26Month = null;
    state.speedSurf = 'all'; state.speedBand = null;
    state.styleRow = null;
    state.hbSurf = 'all';
    state.hbMode = 'hold';
    state.heat = false;
    state.sitOpen = null;
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
    if (kind === 'heat-scrim' && e.target !== el) return;
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
    else if (kind === 'career-tier') { state.careerTier = v; state.careerDrill = null; }
    // The tab switch keeps the window (`careerScope`) — one control drives both
    // tabs, so resetting it here would silently re-scope the radar on a tab click.
    else if (kind === 'career-tab') { state.careerTab = v; state.careerDrill = null; }
    // §5.8 — the Market edge tab row. Switching tabs closes any open band drill,
    // which belongs to the Match winner tab; the Bo3|Bo5 grain is left alone, so
    // coming back to Derived lines finds the format the reader left it on.
    else if (kind === 'market-tab') { state.marketTab = v; state.marketBand = null; }
    else if (kind === 'lc-fmt') { state.lcFmt = v; }
    // TEN-384 · the Derived-lines role tiles filter the ledger.
    else if (kind === 'lc-role') { state.lcRole = (v === 'fav' || v === 'dog') ? v : 'all'; }
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
    else if (kind === 'split-tab') state.splitTab = el.getAttribute('data-tab');
    else if (kind === 'market-role') {
      // Changing the role card re-filters the band groups, so a band opened under
      // the previous filter would be left open under a group that is no longer
      // rendered — the drill would vanish with no close ever having been clicked.
      state.marketRole = el.getAttribute('data-role');
      state.marketBand = null;
    }
    else if (kind === 'market-band') state.marketBand = toggleVal(state.marketBand, el.getAttribute('data-band'));
    else if (kind === 'market-side') state.marketSide = el.getAttribute('data-side');
    else if (kind === 'market-surf') state.marketSurf = el.getAttribute('data-surf');
    else if (kind === 'tourn-row') state.tournOpen = toggleVal(state.tournOpen, el.getAttribute('data-t'));
    else if (kind === 'cal-tab') { state.calTab = v; state.calCell = null; }
    else if (kind === 'cal26-month') state.cal26Month = toggleVal(state.cal26Month, v);
    else if (kind === 'cal-surface') { state.calSurface = v; state.calCell = null; }
    else if (kind === 'cal-cell') state.calCell = toggleVal(state.calCell, v);
    // Item 17 · the drill's own × button. Separate from re-clicking the cell so
    // the close works with the grid scrolled away from the selected cell.
    else if (kind === 'cal-cell-close') state.calCell = null;
    else if (kind === 'speed-surf') { state.speedSurf = v; state.speedBand = null; }
    else if (kind === 'speed-band') state.speedBand = toggleVal(state.speedBand, v);
    // §5.6 item 16 · a bubble, its x label and its row all toggle the same
    // archetype. When the click OPENS one, the row is brought into view after the
    // repaint — a bubble sits above the fold on a long list, so without this the
    // detail opens somewhere the reader cannot see.
    else if (kind === 'style-row') {
      state.styleRow = toggleVal(state.styleRow, v);
      pendingStyleScroll = state.styleRow;
    }
    else if (kind === 'hb-surf') state.hbSurf = v;
    // Both segmented controls live inside the layer, so each repaints with
    // state.heat still true and the grid stays open under the reader.
    else if (kind === 'hb-mode') state.hbMode = (v === 'break' ? 'break' : 'hold');
    // Build item 2. The surface chips live inside the layer, so 'hb-surf'
    // repaints with state.heat still true and the grid stays open.
    else if (kind === 'heat') state.heat = true;
    else if (kind === 'heat-close' || kind === 'heat-scrim') state.heat = false;
    // Item 3. Groups default OPEN, so the stored value is only ever a close.
    else if (kind === 'sit-toggle') {
      var so = state.sitOpen || (state.sitOpen = {});
      so[v] = so[v] == null ? false : !so[v];
    }
    // §8.1 match sheet. The host is told which match opened so it can pull the
    // stats shard; the sheet paints its own "no stats on record" state until it
    // lands rather than blocking the open.
    // TEN-384: the step-3 sheet opens through the host (openMatchSheet repaints for the open-row wash).
    else if (kind === 'sheet') { openMatchSheet(v); return; }
    // §8.2 the full-screen match page. It opens FROM the sheet and replaces it:
    // two stacked full-viewport layers over one match would leave the reader
    // closing the same match twice. Opening resets the panel's two sub-controls,
    // because a set filter carried over from the previous match would point at a
    // set this one may not have.
    else if (kind === 'match-page') {
      state.matchPage = v || state.sheet;
      state.sheet = null;
      state.mpTab = 'summary'; state.mpSet = 'match'; state.mpPointSet = null;
      if (typeof window.onPp2MatchPageOpen === 'function') {
        window.onPp2MatchPageOpen(state.key, state.matchPage);
      }
    }
    else if (kind === 'match-page-close') state.matchPage = null;
    else if (kind === 'mp-tab') state.mpTab = v;
    else if (kind === 'mp-set') state.mpSet = v;
    else if (kind === 'mp-point-set') state.mpPointSet = v;
    else return;   // unknown hook: do nothing rather than repaint blindly
    repaint();
    if (pendingStyleScroll) { scrollToStyleRow(pendingStyleScroll); pendingStyleScroll = null; }
  }

  // §5.6 item 16. repaint() replaces innerHTML, so the anchor has to be found
  // again after it. The scroll parent is walked for rather than assumed: the
  // modal scrolls on the scrim today, and hard-coding that selector would break
  // silently the first time a modal grows its own overflow container.
  var pendingStyleScroll = null;
  function scrollToStyleRow(label) {
    if (!mounted) return;
    var el = mounted.querySelector('[data-pp2-anchor="' + cssAttrEscape('style|' + label) + '"]');
    if (!el) return;
    var sp = el.parentElement;
    while (sp && sp.scrollHeight <= sp.clientHeight + 4) sp = sp.parentElement;
    if (!sp || !sp.scrollTo) return;
    var t = el.getBoundingClientRect().top - sp.getBoundingClientRect().top + sp.scrollTop - 14;
    try { sp.scrollTo({ top: t, behavior: 'smooth' }); } catch (err) { sp.scrollTop = t; }
  }
  function cssAttrEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function onInput(e) {
    var el = e.target;
    if (!el || !el.getAttribute || el.getAttribute('data-pp2') !== 'tourn-search') return;
    state.tournQuery = el.value || '';
    repaint();
  }

  // TEN-376 S1: a sidebar click closes every profile layer (match page, sheet, heat, modal) before it navigates
  (window.sfOverlayClosers = window.sfOverlayClosers || []).push(function () {
    if (state.sheet != null && typeof window.pp2CloseMatchSheet === 'function') window.pp2CloseMatchSheet();
    if (!mounted || !(state.matchPage || state.sheet || state.heat || state.modal)) return;
    state.matchPage = null; state.sheet = null; state.heat = false; state.modal = null; state.careerDrill = null;
    repaint();
  });
  function onKey(e) {
    if (e.key !== 'Escape') return;
    // The step-3 sheet sits above everything and closes itself on Escape (capture phase, propagation
    // stopped), so this handler only ever sees the layers below it.
    if (state.matchPage) { state.matchPage = null; repaint(); return; }
    if (state.heat) { state.heat = false; repaint(); return; }
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
    sheetClosed: sheetClosed,
    // exported so the reconciliation check and the tests can call the same
    // code path the page uses, rather than a copy that can drift
    _internals: {
      // §5.3 tournament list order (pinned — see tournOrder)
      tournViews: tournViews,
      tournOrder: tournOrder,
      // §5.9 Ratings — the radar/tile model, exposed so the all-stores gate can
      // measure dnaRatings through the page's own accessor rather than by
      // counting rows in the file (the stylesStore failure shape).
      dnaModel: dnaModel,
      dnaTourStats: dnaTourStats,
      renderRatingsPanel: renderRatingsPanel,
      DNA_TILES: DNA_TILES,
      DNA_AXES: DNA_AXES,
      // §5.8 Market edge · Q8 tour baselines (TEN-384)
      tourBaselineFor: tourBaselineFor,
      hbStripModel: hbStripModel,
      earlyRoundsRow: earlyRoundsRow,
      drawGrainHtml: drawGrainHtml,
      // §5.8 Derived lines
      lineCoverage: lineCoverage,
      renderLinesTab: renderLinesTab,
      lineSetCount: lineSetCount,
      lineGames: lineGames,
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
      FORM_NOT_ATP_RECORD: FORM_NOT_ATP_RECORD,
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
      initialsOf: initialsOf,
      mkOppName: mkOppName,
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
      renderHeader: renderHeader,
      renderBoxes: renderBoxes,
      SPLIT_GROUPS: SPLIT_GROUPS,
      INSIGHT_TITLES: INSIGHT_TITLES,
      INSIGHT_PHRASES: INSIGHT_PHRASES,
      renderBackLink: renderBackLink,
      // TEN-384 · the hand-off to the step-3 stats sheet (renderSheet retired)
      sheetPayload: sheetPayload,
      openMatchSheet: openMatchSheet,
      initialSurname: initialSurname,
      build: buildCtx,
      buildHtml: build,
      boxValues: buildBoxVals,
      sheetRowFor: sheetRowFor,
      SHEET_SECTIONS: SHEET_SECTIONS,
      renderMatchPanel: renderMatchPanel,
      renderMatchPage: renderMatchPage,
      mpAvailable: mpAvailable,
      mpHasPanel: mpHasPanel,
      mpSetGames: mpSetGames,
      mpSplitSet: mpSplitSet,
      mpTbPoints: mpTbPoints,
      sheetFrac: sheetFrac,
      MP_TABS: MP_TABS,
      eventKeyForSheetId: eventKeyForSheetId,
      tourFromASetDown: tourFromASetDown,
      fromASetDown: fromASetDown,
      setDownNote: setDownNote,
      resetTourSetDownMemo: function () { _tourSetDown = null; },
      statsFor: statsFor,
      spwPct: spwPct,
      rpwPct: rpwPct,
      drFor: drFor,
      sheetValue: sheetValue,
      // Exported so tools/test-sheet-stat-dashing.js can assert what the user SEES,
      // not just what the reader returned. sheetValue() proves the field was read;
      // only sheetText() proves a withheld value reaches the page as the U+2212 dash
      // rather than a 0 or a plausible default.
      sheetText: sheetText,
      sheetBars: sheetBars,
      eventCoverageFor: eventCoverageFor,
      wholeEventNote: wholeEventNote,
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
      // drive the tabs and the surface segments through the SAME state the
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
      calTiles: calTiles,
      calFindings: calFindings,
      calSurfaceSpans: calSurfaceSpans, CAL_SWING_BANDS: CAL_SWING_BANDS,
      calWindowJoin: calWindowJoin,
      roundClass: roundClass,
      renderSpeedPanel: renderSpeedPanel,
      calScope: calScope,
      calResidual: calResidual,
      // TEN-384 fix 1 + 2 · the Last-52 window over the Calendar's rows
      last52Rows: last52Rows, seasonCourts: seasonCourts, tierGridCells: tierGridCells, knownCourtOf: knownCourtOf,
      COURT_KNOWN_INDOOR: COURT_KNOWN_INDOOR, COURT_KNOWN_OUTDOOR: COURT_KNOWN_OUTDOOR, careerTierCells: careerTierCells, last52GridCells: last52GridCells, last52Cutoff: last52Cutoff, undatedFor: undatedFor,
      calResidualNote: calResidualNote,
      renderCalDrill: renderCalDrill,
      renderCalFooter: renderCalFooter,
      renderSeasonModal: renderSeasonModal,
      renderCal2026Tab: renderCal2026Tab,
      cal26Best: cal26Best,
      cal26Months: cal26Months,
      cal26Rows: cal26Rows,
      cal26Short: cal26Short,
      CAL_SEASON: CAL_SEASON,
      tournBestParts: tournBestParts,
      CAL_TABS: CAL_TABS,
      spineYears: spineYears,
      pickByLargestGap: pickByLargestGap,
      splitCandidates: splitCandidates,
      bestSplit: bestSplit,
      bestPositiveSplit: bestPositiveSplit,
      // Kept as an alias: probes and the suite reference the old name, and a
      // silent rename would turn their assertions into `undefined is not a
      // function` rather than a failure that names the ruling.
      biggestSplit: bestSplit,
      biggestBand: biggestBand,
      // R2 · the one shared selector behind both Key insights and "best split",
      // exported so a probe can compare it against an independent recompute
      // rather than against itself.
      rankedInsights: rankedInsights,
      // Exported so ruling Q1's "the tile and the insights lead cannot disagree"
      // is asserted on the RENDERED card rather than on a re-run of the selector.
      renderInsights: renderInsights,
      insightCandidates: insightCandidates,
      careerBaseline: careerBaseline,
      pooledBaseline: pooledBaseline,
      splitPopulation: splitPopulation,
      boxSplitBaseline: boxSplitBaseline,
      baselinePopLabel: baselinePopLabel,
      // BOX_SPLIT_GROUPS is exported once, below with DRAW_GROUPS. It was listed
      // here too; a duplicate key in an object literal silently keeps the LAST
      // one, so the two could have drifted with nothing to say which was live.
      INSIGHT_GROUPS: INSIGHT_GROUPS,
      INSIGHT_MIN_N: INSIGHT_MIN_N,
      splitsFor: splitsFor,
      splitScope: splitScope,
      setBaseline: setBaseline,
      // §5.8 · the band cut-offs the drill mirrors from the builder.
      marketFor: marketFor,
      priceBandId: priceBandId,
      buildBoxVals: buildBoxVals,
      renderCareerModal: renderCareerModal,
      // §5.2 rebuild — exported so the harness asserts on the real functions
      // rather than re-deriving their logic, which is how a check goes vacuous.
      modalSubtitle: modalSubtitle,
      MODAL_WIDTH: MODAL_WIDTH,
      // v7 box re-lock — the harness asserts on the real box objects, so a
      // reordered or renamed set fails the test rather than the screenshot.
      BOXES: BOXES,
      headlineSize: headlineSize,
      DRAW_GROUPS: DRAW_GROUPS,
      BOX_SPLIT_GROUPS: BOX_SPLIT_GROUPS,
      titlesThisSeason: titlesThisSeason,
      bestEvent: bestEvent,
      bestMatchup: bestMatchup,
      liveTileFallback: liveTileFallback,
      eventName: eventName,
      smallSampleText: smallSampleText,
      fromASetDown: fromASetDown,
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
      renderSituational: renderSituational,
      sitSetCounts: sitSetCounts,
      sitTour: sitTour,
      sitRowHtml: sitRowHtml,
      sitPbpFor: sitPbpFor,
      SIT_GROUPS: SIT_GROUPS,
      hbLauncherHtml: hbLauncherHtml,
      renderHeatSheet: renderHeatSheet,
      hbCoverage: hbCoverage,
      hbEngine: hbEngine,
      hbStore: hbStore,
      HB_SURFACES: HB_SURFACES,
      HB_BEST_OF: HB_BEST_OF,
      // §5.6 Matchup record
      renderStylesModal: renderStylesModal,
      // Item 32's footnote. Exported so its dash lock can call the emitting
      // function directly: gating that check on "some player in the committed
      // store happens to carry a thin archetype row" made it vacuous the moment
      // the store's shape moved — it failed "this check never ran" for several
      // runs while the renderer itself was already correct.
      renderStyleNote: renderStyleNote,
      styleRows: styleRows,
      STYLE_AXIS: STYLE_AXIS,
      styleArchetypeOf: styleArchetypeOf,
      styleScale: styleScale,
      styleOpenable: styleOpenable,
      styleMonthYear: styleMonthYear,
      archetypeFor: archetypeFor,
      SPLIT_GROUPS: SPLIT_GROUPS,
      // TEN-384 fx2
      renderModal: renderModal, calPpLine: calPpLine, headerRank: headerRank,
      insightsEmptyText: insightsEmptyText, tournHistOf: tournHistOf,
      splitsPending: splitsPending, splitsNotBuilt: splitsNotBuilt,
      marketPending: marketPending, shardPending: shardPending, tournRecordAll: tournRecordAll,
      tournBackingPending: tournBackingPending,
      get TOURN_TILE_SUMMED_UNITS() { return TOURN_TILE_SUMMED_UNITS; },
      set TOURN_TILE_SUMMED_UNITS(v) { TOURN_TILE_SUMMED_UNITS = !!v; },
      state: state
    }
  };
})();
