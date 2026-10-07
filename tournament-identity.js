// =================================================================
// TOURNAMENT IDENTITY (canonical lookup)
// -----------------------------------------------------------------
// One real ATP event reaches us under several display names:
//   - api-tennis labels the record by HOST CITY, so the Canadian Open is
//     "Montreal" in one year and "Toronto" the next, and every Masters 1000 is
//     just "Cincinnati"/"Madrid"/... .
//   - the TML archive (pre-2021 backfill) labels the same Masters events
//     "Cincinnati Masters"/"Madrid Masters"/... and the Canadian Open
//     "Canada Masters".
//   - accents / case / stray punctuation differ between feeds
//     ("Costa do Sauipe" vs "Costa Do Sauipe", "'s-Hertogenbosch").
// The per-tournament career record used to key on the raw display string, so
// these split into two or three separate rows and each half under-reported the
// player's true record (e.g. Zverev's Canadian Open fragmented into
// Montreal 4-2 + Toronto 5-2 + Canada Masters 9-3, double-counting 2019).
//
// canonicalTournament(name) collapses every known variant to ONE identity so
// the record builders (bsp-pipeline.js fetchPlayerCareerHistory + the TML merge
// in career-backfill.js) group on identity, not display, and the existing
// "API year wins" de-dup finally fires across the merged set.
//
// This is a LOOKUP, not a per-player correction — no player names appear here.
// Same-city SECOND events keep their distinguishing digit ("Adelaide 2",
// "Stuttgart 1") and stay separate on purpose: merging those would be the
// opposite bug.
// =================================================================

// Wrapped so the browser copy adds ONE global (window.TournamentIdentity), not eight.
(function () {

function deaccent(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Identity key: strip tour prefix, deaccent, lowercase, collapse punctuation to
// spaces. Digits are KEPT so "Adelaide 2" never merges into "Adelaide".
function identityKey(name) {
  let s = deaccent(String(name || '')).toLowerCase()
    .replace(/^(atp|wta|itf|challenger)\s+/, '').trim();
  return s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Explicit same-event aliases, keyed by identityKey(variant) -> canonical display
// name. Only names that are genuinely the SAME event are listed. Grouped by why.
const CANONICAL_ALIASES = {
  // Grand Slam name variant
  'roland garros': 'French Open',

  // Masters 1000 — api-tennis uses the bare city, TML appends "Masters".
  'cincinnati masters': 'Cincinnati',
  'indian wells masters': 'Indian Wells',
  'madrid masters': 'Madrid',
  'miami masters': 'Miami',
  'monte carlo masters': 'Monte Carlo',
  'paris masters': 'Paris',
  'rome masters': 'Rome',
  'shanghai masters': 'Shanghai',
  'hamburg masters': 'Hamburg',

  // Canada Masters — alternates host city year to year (Montreal/Toronto) AND
  // has been rebranded repeatedly (Rogers Cup -> National Bank Open), while
  // api-tennis currently labels it "ATP Canadian Open". The TML archive calls
  // it "Canada Masters", which is the label we keep. All of these are the SAME
  // Masters 1000 — without every alias here the pre-2021 TML editions (e.g.
  // Zverev's 2017 title over Federer, 2018) never merge into the live card,
  // which is labelled "Canadian Open", so the record reads low.
  'montreal': 'Canada Masters',
  'toronto': 'Canada Masters',
  'canada masters': 'Canada Masters',
  'canadian open': 'Canada Masters',
  'national bank open': 'Canada Masters',
  'rogers cup': 'Canada Masters',
  'canada': 'Canada Masters',

  // Year-end championship — ONE event under four names. Founder ruling
  // 2026-09-18: "Tour Finals, Masters Cup, Finals - Turin and Finals are all
  // the same event", display name "Tour Finals".
  //   tour finals   21 rows ·  65 eds · 230 matches · 2009–2024
  //   finals        15 rows ·  16 eds ·  60 matches · 2015–2025
  //   finals turin  10 rows ·  20 eds ·  30 matches · 2021–2025
  //   masters cup    2 rows ·   3 eds ·  11 matches · 2007–2008
  // Measured on the deployed store: "Finals - Turin" and "Tour Finals" carry
  // 24 IDENTICAL match rows across 8 players in 2021-2024 (100% overlap), and
  // "Finals" duplicates "Finals - Turin" 5 more times in 2025. Those matches
  // were counted twice everywhere a tournament row is summed.
  //
  // 'finals' is a bare key and looks risky — it is not. identityKey() matches
  // the WHOLE normalized string, and every other year-end-ish event keys
  // longer: "next gen finals", "nextgen finals", "davis cup finals rr ita vs
  // bel". tools/test-tournament-identity.js locks that, both directions.
  'tour finals': 'Tour Finals',
  'masters cup': 'Tour Finals',
  'finals turin': 'Tour Finals',
  finals: 'Tour Finals',

  // Queen's Club — api-tennis labels it by HOST CITY ("ATP London" / "London"), the TML
  // archive by venue ("Queen's Club"). ONE grass ATP 500 (TEN-384 fix item 12, founder
  // 2026-10-05: "London + Queen's Club duplicate -> one event, surface Grass"). Measured over
  // every career-history shard: all 458 "London"/"ATP London" rows and all 235 "Queen's Club"
  // rows are grass, in June. Before this alias the profile listed both rows with the SAME
  // 2023-2025 matches (Alcaraz: London 11-1 and Queen's Club 11-1), so the join could own
  // neither and both lost their surface.
  // 'london' is a whole-string key: "London Olympics" (July) keys longer and stays separate;
  // the 2009-2020 year-end event at the O2 arrives as "Tour Finals" / "Masters Cup".
  london: "Queen's Club",
  'queen s club': "Queen's Club",
  'queens club': "Queen's Club",

  // 's-Hertogenbosch (Libema Open, grass) — the TML archive writes "'s-Hertogenbosch", api-tennis
  // "Hertogenbosch"; identityKey keeps the leading "s", so the two keyed apart and a profile listed
  // both with the SAME 2019-2025 matches (Thompson: 's-Hertogenbosch 9-5 + Hertogenbosch 9-4).
  // TEN-384 fx2 item 5. One event, one row.
  hertogenbosch: "'s-Hertogenbosch",
  's hertogenbosch': "'s-Hertogenbosch",

  // Year-end / rename
  'next gen atp finals': 'Next Gen Finals',
  // TEN-384 fx2 item 5 (same class): the archive writes "NextGen Finals", api-tennis "Next Gen Finals -
  // Milan"; one event (Korda 2021: NextGen Finals 4-1 + Next Gen Finals - Milan 1-1, the same season).
  'nextgen finals': 'Next Gen Finals',
  'next gen finals milan': 'Next Gen Finals',

  // TEN-384 fx3 (same class as item 12): the 2021 Melbourne summer event, written "Great Ocean Road Open"
  // by one feed and "Melbourne (Great Ocean Road Open)" by the other; the profile listed both with the
  // SAME 2021 matches (Alcaraz 2-1 twice, Thompson 3-1 twice).
  'melbourne great ocean road open': 'Great Ocean Road Open',
  // TEN-384 fx4 (same class): the 2021 Murray River Open, the same pair of spellings — measured: 44 shards
  // hold BOTH "Murray River Open" and "Melbourne (Murray River Open)" over the same 2021 edition.
  'melbourne murray river open': 'Murray River Open',
  // TEN-384 fx4 (same class): the 2022 Melbourne Summer Set, written "Melbourne (Summer Set)" by one feed and
  // bare "Melbourne" by the other — 18 shards hold both over the SAME 2022 edition (Thompson 1-1 twice).
  // Bare 'melbourne' is a whole-string key, measured over every served tournament-history shard: it occurs
  // ONLY as the 2022 Summer Set (18 shards, 2022 only). The other Melbourne events key longer and stay
  // apart: "Melbourne (Great Ocean Road Open)", "Melbourne (Murray River Open)"; the Australian Open is
  // "Australian Open".
  melbourne: 'Melbourne (Summer Set)',
  'melbourne summer set': 'Melbourne (Summer Set)',

  // TEN-384 fx4 · the OLYMPICS. One event (a quadrennial edition), written "Olympic Games" by api-tennis and
  // "<City> Olympics" by the archive: Alcaraz listed "Olympic Games" (Grass, 5-1) AND "Paris Olympics" (-,
  // 5-1) over the SAME 2024 edition. Measured over every served shard: 58 hold "Olympic Games" 2024, 58
  // "Paris Olympics" 2024; 43 hold "Olympic Games" 2020 and 44 "Tokyo Olympics" 2021 — the SAME Tokyo
  // Games (postponed to 2021; api-tennis files them under season 2020, see EDITION_YEAR). One identity, one
  // row across years; the surface comes from EDITION_SURFACE per year, never the feed's single
  // per-tournament label (career-history writes "grass" on all 224 "Olympic Games" rows, 2021 and 2024).
  // None of these keys is a bare city: "London Olympics" keys longer than 'london' (Queen's Club).
  'olympic games': 'Olympic Games',
  olympics: 'Olympic Games',
  'beijing olympics': 'Olympic Games',
  'london olympics': 'Olympic Games',
  'rio olympics': 'Olympic Games',
  'tokyo olympics': 'Olympic Games',
  'paris olympics': 'Olympic Games',
};

// TEN-384 fx4 · per-YEAR facts of an identity whose editions differ year to year. Keyed by identity id.
//   EDITION_YEAR    · the feed's season label → the year the edition was PLAYED. The Tokyo Games were
//                     played in 2021; api-tennis files them as season 2020, the archive as 2021.
//   EDITION_SURFACE · the surface each edition was played on (a fact of the venue that year, not a vote).
//     2008 Beijing hard · 2012 London (Wimbledon) grass · 2016 Rio hard · 2021 Tokyo hard · 2024 Paris
//     (Roland Garros) clay.
const EDITION_YEAR = {
  'olympic games': { 2020: 2021 },
};
const EDITION_SURFACE = {
  'olympic games': { 2008: 'hard', 2012: 'grass', 2016: 'hard', 2020: 'hard', 2021: 'hard', 2024: 'clay' },
};
function editionYear(name, year) {
  const m = EDITION_YEAR[canonicalTournament(name).id];
  const y = Number(year);
  return m && m[y] != null ? m[y] : year;
}
/** The surface an edition was played on, when the identity's surface varies by year; else null (unknown here). */
function editionSurface(name, year) {
  const m = EDITION_SURFACE[canonicalTournament(name).id];
  if (!m) return null;
  return m[Number(year)] || null;
}
function hasEditionSurface(name) {
  return !!EDITION_SURFACE[canonicalTournament(name).id];
}

// name -> { id, display }. Unmapped names keep their own (normalized) identity and
// a prefix-stripped display, so non-fragmented tournaments behave exactly as before.
function canonicalTournament(name) {
  const k = identityKey(name);
  const display = CANONICAL_ALIASES[k];
  if (display) return { id: identityKey(display), display };
  return { id: k, display: String(name || '').replace(/^(ATP|WTA|ITF|Challenger)\s+/i, '').trim() };
}

// ── mergeHistory · the SERVED shards, canonicalised at read time (TEN-384 fx2 item 5) ──────────
// The builder groups on identity, but a tournament-history shard written before an alias landed
// still carries one row per name: Alcaraz "London" 11-1 AND "Queen's Club" 11-1 over the SAME three
// editions. Summing them double-counts every match. mergeHistory(rows) folds rows whose names
// resolve to one identity into ONE row named by the canonical display; per SEASON, the duplicate
// editions count ONCE — the edition with the larger record (more matches played, then more rows)
// is kept, never the two summed. A row with no twin is returned untouched (same object), so a
// shard with no duplicates renders exactly as before. Pure; the input is never mutated.
const FINISH_RANK = {
  Won: 9, Final: 8, 'Semi-final': 7, 'Quarter-final': 6, RR: 5,
  'Round of 16': 4, 'Round of 32': 3, 'Round of 64': 2, 'Round of 128': 1,
};
function editionSize(e) {
  const ms = (e && e.matches) || [];
  return { played: ms.filter(m => !m.walkover).length, rows: ms.length };
}
function mergeHistory(rows) {
  if (!Array.isArray(rows)) return rows;
  const groups = new Map();
  rows.forEach((t) => {
    const id = canonicalTournament(t && t.name).id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(t);
  });
  const out = [];
  const done = new Set();
  rows.forEach((t) => {
    const id = canonicalTournament(t && t.name).id;
    if (done.has(id)) return;
    done.add(id);
    const g = groups.get(id);
    // fx4: an identity with an EDITION_YEAR rule (the Olympics) re-years its editions even when the shard
    // holds one row, so "Olympic Games" 2020 and "Tokyo Olympics" 2021 are one season.
    const reYear = EDITION_YEAR[id] ? (e => (editionYear(g[0].name, e.year) !== e.year
      ? Object.assign({}, e, { year: editionYear(g[0].name, e.year) }) : e)) : null;
    const needsReYear = !!reYear && g.some(r => (r.editions || []).some(e => reYear(e) !== e));
    if (g.length === 1 && !needsReYear) { out.push(g[0]); return; }
    const byYear = new Map();
    g.forEach(r => (r.editions || []).forEach((e0) => {
      const e = reYear ? reYear(e0) : e0;
      const y = String(e.year);
      const held = byYear.get(y);
      if (!held) { byYear.set(y, e); return; }
      const a = editionSize(held), b = editionSize(e);
      if (b.played > a.played || (b.played === a.played && b.rows > a.rows)) byYear.set(y, e);
    }));
    const editions = Array.from(byYear.values()).sort((a, b) => Number(b.year) - Number(a.year));
    let won = 0, lost = 0, best = null, bestRank = -1;
    editions.forEach((e) => {
      (e.matches || []).forEach((m) => {
        if (m.walkover) return;
        if (m.res === 'W') won++; else if (m.res === 'L') lost++;
      });
      const r = FINISH_RANK[e.finish];
      if (r != null && r > bestRank) { bestRank = r; best = e.finish; }
    });
    if (best == null) {   // editions carry no ranked finish: the best stored word wins
      g.forEach((r) => {
        const k = FINISH_RANK[r.bestResult];
        if (k != null && k > bestRank) { bestRank = k; best = r.bestResult; }
      });
    }
    const years = editions.map(e => Number(e.year)).filter(y => isFinite(y));
    out.push(Object.assign({}, g[0], {
      name: canonicalTournament(g[0].name).display,
      mergedFrom: g.map(r => r.name),
      won, lost,
      firstYear: years.length ? Math.min.apply(null, years) : (g[0].firstYear || null),
      lastYear: years.length ? Math.max.apply(null, years) : (g[0].lastYear || null),
      titles: editions.filter(e => e.finish === 'Won').length,
      bestResult: best,
      bestYears: best == null ? [] : editions.filter(e => e.finish === best).map(e => Number(e.year)),
      editions,
    }));
  });
  return out;
}

const TOURNAMENT_IDENTITY = { canonicalTournament, identityKey, CANONICAL_ALIASES, mergeHistory, FINISH_RANK,
  editionYear, editionSurface, hasEditionSurface, EDITION_YEAR, EDITION_SURFACE };
// Node (builders, tests) and the browser (player-profile-v2.js, the dashboard's shard loader) read
// the SAME table: a second copy in the page would drift from the one the builders group on.
if (typeof module !== 'undefined' && module.exports) module.exports = TOURNAMENT_IDENTITY;
if (typeof window !== 'undefined') window.TournamentIdentity = TOURNAMENT_IDENTITY;
}());
