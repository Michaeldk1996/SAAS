// =================================================================
// @ATP_Entry Winners/Unforced-Errors HARVESTER  (Layer #8 fallback)
// -----------------------------------------------------------------
// Emits `atp-entry-wue.json` — the per-match Winners / Unforced-Errors
// fallback source, read by the pipeline ONLY when api-tennis has no
// W/UE for a fixture (the ~20% gap, concentrated at ATP-250 level).
// See atp-entry-fallback.js for the runtime join + source-priority.
//
// WHAT THIS HARVESTER AUTOMATES (founder spec, TEN-8 2026-07-24):
//   1. Takes the reviewed @ATP_Entry card corpus (CARDS below): per-wing
//      FH/BH Winners + Unforced Errors, one card = one match.
//   2. Sums FH+BH to per-player totals (winners, unforcedErrors).
//   3. JOINS each card to its api-tennis match record on (tournament,
//      player-pair) to pull the TOTAL-POINTS denominator. api-tennis
//      is missing Winners/UE for these 250 matches but STILL carries
//      "Total Points Won" (verified live: Muller v Navone, Kitzbühel,
//      event 12147454 — Winners/UE empty, Total Points Won stat_total
//      = 103). That denominator is what makes the percentages derivable.
//   4. DERIVES the founder's five fields per player and stores them:
//        winners            = FH + BH winners
//        unforcedErrors     = FH + BH unforced
//        winnersUnforcedRatio = winners / unforcedErrors        (W/UE)
//        winnersPct         = winners / totalPoints  * 100       (Winners %)
//        unforcedErrorsPct  = unforcedErrors / totalPoints * 100 (UE %)
//   5. Counts every api-tennis READ via tools/apitennis-read-counter.js
//      (one windowed get_fixtures covers a whole draw — a full harvest
//      costs a handful of reads, not one-per-match) and prints coverage.
//
// STILL MANUAL — the card VALUES. Acquiring the @ATP_Entry card images
// from X and OCR-reading them needs X API credentials this environment
// does not have (no X/twitter key in .env). Until those land, the CARDS
// table is transcribed + reviewed on TEN-8; everything downstream of the
// card values is automated here. To add a tournament: append its cards,
// add its date window to DENOMINATOR_WINDOWS, and re-run this script.
//
//   node tools/build-atp-entry-wue.js            # fetch denominators + build
//   node tools/build-atp-entry-wue.js --offline  # build with null pcts (no api-tennis)
// =================================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ReadCounter } = require('./apitennis-read-counter');
// Reuse the runtime key + ratio logic verbatim so a card and its live
// fixture can never reduce to different keys (build-time / run-time drift
// is the classic silent-miss bug in this join).
const { nameKey, tourSlug, ratioOf } = require('../atp-entry-fallback');

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';
const EVENT_TYPE_ATP_SINGLES = 265;

// Date windows that cover every card's match. api-tennis caps a single
// get_fixtures at a 7-day range, so one window per ~week of play. Both
// current tournaments (Estoril, Kitzbühel) fall inside one window.
const DENOMINATOR_WINDOWS = [
  ['2026-07-20', '2026-07-26'],
];

// --- input: one entry per reviewed card. players = [ [name, fhWin, bhWin, fhUE, bhUE], ... ]
const CARDS = [
  // ---- Millennium Estoril Open — ATP 250 ----
  { tour: 'Estoril', round: 'R1', card: 'HNrMapUWoAAbdZp', players: [['Tiago Torres',8,4,4,7],['Nikoloz Basilashvili',5,6,17,17]] },
  { tour: 'Estoril', round: 'R1', card: 'HNro6HYWwAAbUyV', players: [['Titouan Droguet',10,6,13,4],['Camilo Ugo Carabelli',21,3,19,13]] },
  { tour: 'Estoril', round: 'R1', card: 'HNsSn6uWYAAuYG3', players: [['Frederico Ferreira Silva',27,3,37,20],['Luca Van Assche',17,8,18,27]] },
  { tour: 'Estoril', round: 'R1', card: 'HNsz4zxWsAAwNlX', players: [['Henrique Rocha',22,2,27,18],['Pedro Martinez',13,5,8,13]] },
  { tour: 'Estoril', round: 'R1', card: 'HNwbgw_WAAITwiS', players: [['Vilius Gaubas',9,4,10,5],['Pablo Carreno Busta',17,6,6,7]] },
  { tour: 'Estoril', round: 'R1', card: 'HNwet2xXEAE9_XR', players: [['Nuno Borges',12,3,5,8],['Orlando Luz',12,4,17,6]] },
  { tour: 'Estoril', round: 'R1', card: 'HNxFiGuXEAAYzh0', players: [['Stan Wawrinka',18,4,30,26],['Roman Andres Burruchaga',12,7,28,16]] },
  { tour: 'Estoril', round: 'R1', card: 'HNxb8EnXsAAuf4I', players: [['Botic van de Zandschulp',9,4,11,10],['Jaime Faria',3,1,11,9]] },
  { tour: 'Estoril', round: 'R2', card: 'HN1YrXuXgAIV3Tl', players: [['Hugo Gaston',8,4,15,5],['Titouan Droguet',6,0,20,13]] },
  { tour: 'Estoril', round: 'R2', card: 'HN1_eQvXMAAqs90', players: [['Nuno Borges',19,5,35,15],['Roman Andres Burruchaga',18,3,20,10]] },
  { tour: 'Estoril', round: 'R2', card: 'HN2dqNuW8AAueOs', players: [['Alejandro Tabilo',10,6,17,10],['Tiago Torres',10,7,9,5]] },
  { tour: 'Estoril', round: 'R2', card: 'HN3EkNbWUAA3qeP', players: [['Kyrian Jacquet',27,18,23,16],['Alexander Blockx',17,6,10,8]] },
  { tour: 'Estoril', round: 'R2', card: 'HN6-aqgXgAMwwA6', players: [['Jaime Faria',8,4,8,13],['Gonzalo Bueno',7,0,10,12]] },
  { tour: 'Estoril', round: 'R2', card: 'HN6tqQiXIAAip39', players: [['Luca Van Assche',15,6,13,13],['Pablo Carreno Busta',14,5,20,10]] },
  { tour: 'Estoril', round: 'R2', card: 'HN77MXZXYAEi5mv', players: [['Pedro Martinez',4,2,12,7],['Luciano Darderi',10,3,6,2]] },
  { tour: 'Estoril', round: 'R2', card: 'HN7hS6mXMAAkpzO', players: [['Andrey Rublev',16,6,7,3],['Timofey Skatov',2,3,8,6]] },
  // ---- Generali Open Kitzbühel — ATP 250 ----
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNqlOITWIAADSVR', players: [['Alexandre Muller',5,2,12,14],['Mariano Navone',8,5,3,11]] },
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNr-X-UWYAACC8D', players: [['Vit Kopriva',17,10,28,20],['Ignacio Buse',9,9,18,16]] },
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNrMsbcWsAEbZh7', players: [['Lukas Neumayer',3,6,13,7],['Yannick Hanfmann',14,11,13,17]] },
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNrodrjWMAAZl-R', players: [['Joel Schwaerzler',11,5,18,6],['Jurij Rodionov',11,2,12,6]] },
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNw9wBxWEAEWMWo', players: [['Daniel Altmaier',16,5,10,6],['Raphael Collignon',10,2,9,11]] },
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNwbOZXXUAAdgdC', players: [['Jan-Lennard Struff',16,9,23,19],['Alexander Shevchenko',11,5,11,12]] },
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNwbwE4WMAAEhmR', players: [['Sebastian Baez',11,10,18,11],['Miomir Kecmanovic',16,7,20,18]] },
  { tour: 'Kitzbuhel', round: 'R1', card: 'HNwmHnGX0AEXOpN', players: [['Alex Molcan',1,1,7,6],['Sebastian Ofner',15,2,8,21]] },
  { tour: 'Kitzbuhel', round: 'R2', card: 'HN02gLUWsAAaP3E', players: [['Quentin Halys',10,2,12,2],['Valentin Vacherot',11,4,11,8]] },
  { tour: 'Kitzbuhel', round: 'R2', card: 'HN19NbBWYAAxZa3', players: [['Alexander Bublik',14,3,12,13],['Facundo Diaz Acosta',6,4,8,7]] },
  { tour: 'Kitzbuhel', round: 'R2', card: 'HN1KxHSXcAAiD2j', players: [['Jan-Lennard Struff',5,4,14,8],['Mariano Navone',5,7,5,5]] },
  { tour: 'Kitzbuhel', round: 'R2', card: 'HN1nvhTWEAA2FNk', players: [['Tomas Martin Etcheverry',12,2,14,5],['Jurij Rodionov',10,4,18,12]] },
  { tour: 'Kitzbuhel', round: 'QF', card: 'HN6-SMsXwAArACj', players: [['Tomas Martin Etcheverry',9,4,11,5],['Ignacio Buse',5,6,15,19]] },
  { tour: 'Kitzbuhel', round: 'QF', card: 'HN6tIpwWgAEoeoV', players: [['Mariano Navone',5,3,10,6],['Quentin Halys',13,4,16,8]] },
  { tour: 'Kitzbuhel', round: 'QF', card: 'HN6tdHvWsAASyxD', players: [['Yannick Hanfmann',11,7,7,10],['Sebastian Baez',7,3,8,12]] },
  { tour: 'Kitzbuhel', round: 'QF', card: 'HN7KalJXEAAT1os', players: [['Alexander Bublik',15,0,11,6],['Alex Molcan',3,4,7,6]] },
];

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);

// Total points PLAYED in a match = the "Total Points Won" stat_total (match
// period). It is a match-level constant (both players' rows carry the same
// stat_total; the two stat_won values sum to it), so either player's row works.
function totalPointsFromFixture(fixture) {
  const stats = Array.isArray(fixture.statistics) ? fixture.statistics : [];
  const row = stats.find(s => s.stat_period === 'match' && /^total points won$/i.test(s.stat_name || ''));
  const n = row ? parseInt(row.stat_total, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Build a (tourSlug::sortedPairKey) -> { totalPoints, eventKey } index of the
// api-tennis denominators, counting every read. Returns { index, counter }.
async function fetchDenominators() {
  const counter = new ReadCounter({ label: 'api-tennis' });
  const index = new Map();
  if (!API_TENNIS_KEY) return { index, counter, skipped: true };
  for (const [start, stop] of DENOMINATOR_WINDOWS) {
    const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${API_TENNIS_KEY}`
      + `&date_start=${start}&date_stop=${stop}&event_type_key=${EVENT_TYPE_ATP_SINGLES}`;
    const json = await counter.get(url);
    const fixtures = Array.isArray(json && json.result) ? json.result : [];
    for (const f of fixtures) {
      const k1 = nameKey(f.event_first_player);
      const k2 = nameKey(f.event_second_player);
      if (!k1 || !k2) continue;
      const totalPoints = totalPointsFromFixture(f);
      if (totalPoints == null) continue; // no denominator on this fixture -> skip
      const key = `${tourSlug(f.tournament_name)}::${[k1, k2].sort().join('+')}`;
      // First scored copy wins; a later, statless duplicate must not clobber it.
      if (!index.has(key)) index.set(key, { totalPoints, eventKey: f.event_key });
    }
  }
  return { index, counter, skipped: false };
}

async function main() {
  const offline = process.argv.includes('--offline');
  const { index, counter, skipped } = offline
    ? { index: new Map(), counter: new ReadCounter({ label: 'api-tennis' }), skipped: true }
    : await fetchDenominators();

  const rows = [];
  const unjoined = [];
  for (const c of CARDS) {
    const keys = c.players.map(pl => nameKey(pl[0]));
    if (keys.some(k => !k)) throw new Error(`unresolvable name in card ${c.card}`);
    const slug = tourSlug(c.tour);
    const pairKey = [...keys].sort().join('+');
    const denom = index.get(`${slug}::${pairKey}`) || null;
    if (!denom && !skipped) unjoined.push(`${c.tour}/${c.round}/${c.card} (${pairKey})`);

    const players = {};
    c.players.forEach(([name, fhWin, bhWin, fhUE, bhUE], i) => {
      const winners = fhWin + bhWin;              // total winners (FH + BH)
      const unforcedErrors = fhUE + bhUE;         // total unforced (FH + BH)
      const totalPoints = denom ? denom.totalPoints : null;
      players[keys[i]] = {
        name,
        fhWinners: fhWin, bhWinners: bhWin, fhUnforced: fhUE, bhUnforced: bhUE,
        winners,
        unforcedErrors,
        // Founder's five fields — nulls stay honest when no denominator joined.
        winnersUnforcedRatio: ratioOf(winners, unforcedErrors),   // winners / UE
        winnersPct: pct(winners, totalPoints),                    // winners / total points
        unforcedErrorsPct: pct(unforcedErrors, totalPoints),      // UE / total points
      };
    });
    rows.push({
      tournament: c.tour,
      tourSlug: slug,
      round: c.round,
      card: c.card,
      matchKey: pairKey,
      // api-tennis denominator provenance (null when the join missed).
      apiTennisEventKey: denom ? denom.eventKey : null,
      totalPointsPlayed: denom ? denom.totalPoints : null,
      players,
    });
  }

  // integrity: no duplicate (tournament, matchKey)
  const seen = new Set();
  for (const r of rows) {
    const id = r.tourSlug + '::' + r.matchKey;
    if (seen.has(id)) throw new Error(`duplicate match ${id}`);
    seen.add(id);
  }

  const joined = rows.filter(r => r.totalPointsPlayed != null).length;
  const out = {
    source: '@ATP_Entry ATP Match Statistics cards (blue, FH/BH wing-split panel), vision-OCR + reviewed on TEN-8',
    role: 'FALLBACK ONLY — used solely when api-tennis has no Winners/Unforced-Errors for a fixture. Never mixed with api-tennis for the same match.',
    note: 'Winners/UE totals come from the @ATP_Entry card; the Winners% / UE% denominator (total points played) is joined from the api-tennis match record on (tournament, player-pair). Percentages are null for any card whose api-tennis fixture was not found.',
    tournaments: [...new Set(rows.map(r => r.tournament))],
    cards: rows.length,
    playerRows: rows.reduce((n, r) => n + Object.keys(r.players).length, 0),
    denominatorSource: skipped ? null : 'api-tennis get_fixtures Total Points Won (stat_total, match period)',
    cardsJoinedToDenominator: skipped ? 0 : joined,
    apiTennisReads: counter.reads,
    rows,
  };

  const outPath = path.join(__dirname, '..', 'atp-entry-wue.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

  counter.printSummary();
  console.log(`\nwrote ${outPath}`);
  console.log(`  ${out.cards} cards, ${out.playerRows} player rows, tournaments=${out.tournaments.join(', ')}`);
  if (skipped) {
    console.log('  denominator join SKIPPED (--offline or no API_TENNIS_KEY) — winnersPct/unforcedErrorsPct are null');
  } else {
    console.log(`  denominator join: ${joined}/${rows.length} cards matched an api-tennis fixture with Total Points Won`);
    if (unjoined.length) {
      console.log(`  UNJOINED cards (no denominator — percentages null):`);
      for (const u of unjoined) console.log(`    - ${u}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
