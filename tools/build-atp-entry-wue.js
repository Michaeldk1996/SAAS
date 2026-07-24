// =================================================================
// @ATP_Entry OCR Winners/Unforced-Errors FALLBACK dataset builder
// -----------------------------------------------------------------
// Emits `atp-entry-wue.json` — a static, manually-refreshed fallback
// source of per-match Winners / Unforced-Errors totals, read by the
// pipeline ONLY when api-tennis has no W/UE data for a fixture (the
// ~20% gap, concentrated at ATP 250 level). See atp-entry-fallback.js
// for the join + priority logic.
//
// SOURCE: blue "@ATP_Entry" ATP Match Statistics cards (the ones with
// the forehand/backhand Winners/Errors wing-split panel), OCR-read by
// vision passes and reviewed on TEN-8 before being encoded here. Each
// card is one match; the card prints per-wing counts (FH/BH winners,
// FH/BH unforced errors). Layer #8 needs only the totals, so FH+BH are
// summed here; the wing split is retained for provenance/inspection.
//
// NOT AN AUTOMATED FEED. This is a founder-supplied screenshot corpus.
// To add a new tournament: append its cards below and re-run this
// script (`node tools/build-atp-entry-wue.js`).
// =================================================================
const fs = require('fs');
const path = require('path');

// --- input: one entry per card. players = [ [name, fhWin, bhWin, fhUE, bhUE], ... ]
// Values transcribed verbatim from the reviewed extraction table (TEN-8).
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

// Surname|first-initial key — identical reduction to the layer #8 baseline
// builder and classify-styles, so an abbreviated feed name ("T. M. Etcheverry")
// and the card's full name ("Tomas Martin Etcheverry") both collapse to the
// same key ("etcheverry|t").
function deaccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function nameKey(name) {
  const p = deaccent(name).toLowerCase().replace(/&nbsp;/g, ' ').replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}
function tourSlug(t) { return deaccent(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^atp\s+/, '').replace(/\s+/g, ''); }

const rows = [];
for (const c of CARDS) {
  const keys = c.players.map(pl => nameKey(pl[0]));
  if (keys.some(k => !k)) throw new Error(`unresolvable name in card ${c.card}`);
  const players = {};
  c.players.forEach(([name, fhWin, bhWin, fhUE, bhUE], i) => {
    players[keys[i]] = {
      name,
      fhWinners: fhWin, bhWinners: bhWin, fhUnforced: fhUE, bhUnforced: bhUE,
      winners: fhWin + bhWin,          // total winners  (layer #8 ratio numerator)
      unforcedErrors: fhUE + bhUE,     // total unforced (layer #8 ratio denominator)
    };
  });
  rows.push({
    tournament: c.tour,
    tourSlug: tourSlug(c.tour),
    round: c.round,
    card: c.card,
    // unordered pair key = the stable per-match join (two players meet at most
    // once in one tournament, so this is unique regardless of round labelling).
    matchKey: [...keys].sort().join('+'),
    players,
  });
}

// integrity: no duplicate (tournament,matchKey)
const seen = new Set();
for (const r of rows) {
  const id = r.tourSlug + '::' + r.matchKey;
  if (seen.has(id)) throw new Error(`duplicate match ${id}`);
  seen.add(id);
}

const out = {
  source: '@ATP_Entry ATP Match Statistics cards (blue, FH/BH wing-split panel), vision-OCR + reviewed on TEN-8',
  role: 'FALLBACK ONLY — used solely when api-tennis has no Winners/Unforced-Errors for a fixture. Never mixed with api-tennis for the same match.',
  note: 'Manually refreshed screenshot corpus, not an automated feed. Winners/UE totals only (a card has no total-points denominator, so winnersPct/unforcedErrorsPct are NOT derivable from this source).',
  tournaments: [...new Set(rows.map(r => r.tournament))],
  cards: rows.length,
  playerRows: rows.reduce((n, r) => n + Object.keys(r.players).length, 0),
  rows,
};

const outPath = path.join(__dirname, '..', 'atp-entry-wue.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${outPath}: ${out.cards} cards, ${out.playerRows} player rows, tournaments=${out.tournaments.join(', ')}`);
