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

  // Year-end / rename
  'next gen atp finals': 'Next Gen Finals',
};

// name -> { id, display }. Unmapped names keep their own (normalized) identity and
// a prefix-stripped display, so non-fragmented tournaments behave exactly as before.
function canonicalTournament(name) {
  const k = identityKey(name);
  const display = CANONICAL_ALIASES[k];
  if (display) return { id: identityKey(display), display };
  return { id: k, display: String(name || '').replace(/^(ATP|WTA|ITF|Challenger)\s+/i, '').trim() };
}

module.exports = { canonicalTournament, identityKey, CANONICAL_ALIASES };
