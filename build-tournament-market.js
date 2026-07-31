#!/usr/bin/env node
/*
 * build-tournament-market.js  (TEN-8 — Tournaments Overview §4/§5)
 * ---------------------------------------------------------------------------
 * Per-tournament market performance, computed from settled results-and-prices.
 *
 * Source: odds-archive/*.csv — tennis-data.co.uk closing prices (avgw/avgl =
 * average closing price across books for the match winner / loser). This is the
 * same settled set build-odds-performance.js reads; here we group BY TOURNAMENT
 * instead of by player. odds-archive/ is never fetched by the browser — it is
 * the raw source the build reads.
 *
 * For every completed match we take the favourite = the shorter closing price:
 *   - ROI backing favourites  flat 1u on the favourite every match, at its
 *                             closing price. yield = mean((won?price:0) - 1).
 *   - ROI backing underdogs   flat 1u on the underdog, same maths.
 *   - Favourite reliability   share of matches the favourite won.
 * The tour baseline is the same three figures pooled over EVERY archive match,
 * so the dashboard's interpretation lines compare against a real tour-wide
 * number, never an authored one.
 *
 * Tournaments below minMatches (or ones we cannot join to an archive name with
 * confidence — Canada alternates Montreal/Toronto under one sponsor string, the
 * ATP Finals venue moves) are omitted, so the dashboard em-dashes them.
 *
 * Emits tournament-market.json. No network calls; safe to run in CI.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ARCHIVE_DIR = path.join(ROOT, 'odds-archive');
const OUT = path.join(ROOT, 'tournament-market.json');
const MIN_MATCHES = 30;

// Dashboard tournament name -> every archive `tournament` string it has shipped
// under (sponsor names change season to season). Only high-confidence joins are
// listed; anything not here em-dashes. Montreal/Toronto and Turin (ATP Finals)
// are deliberately absent — their archive strings do not identify the city/venue.
const ALIAS = {
  'Australian Open': ['Australian Open'],
  'French Open': ['French Open'], 'Roland Garros': ['French Open'],
  'Wimbledon': ['Wimbledon'],
  'US Open': ['US Open'],
  'Indian Wells': ['BNP Paribas Open', 'Pacific Life Open'],
  'Miami': ['Sony Ericsson Open', 'Miami Open', 'NASDAQ-100 Open'],
  'Monte Carlo': ['Monte Carlo Masters'],
  'Madrid': ['Mutua Madrid Open', 'Madrid Masters', 'Mutua Madrileña Madrid Open'],
  'Rome': ["Internazionali BNL d'Italia", 'Telecom Italia Masters Roma', "Campionati Internazional d'Italia"],
  'Cincinnati': ['Western & Southern Financial Group Masters'],
  'Shanghai': ['Shanghai Masters'],
  'Paris': ['BNP Paribas Masters'],
  'Dubai': ['Dubai Tennis Championships', 'Dubai Championships', "Dubai Duty Free Men's Open"],
  'Doha': ['Qatar Exxon Mobil Open'],
  'Rotterdam': ['ABN AMRO World Tennis Tournament'],
  'Acapulco': ['Abierto Mexicano', 'Abierto Mexicano Mifel'],
  'Barcelona': ['Barcelona Open', 'Open Banco Sabadell', 'Open Sabadell Atlántico 2008', 'Open Seat Godo'],
  'Halle': ['Gerry Weber Open', 'Halle Open'],
  'London': ["Queen's Club Championships", 'AEGON Championships', 'Stella Artois'],
  'Washington': ['Citi Open', 'Legg Mason Classic'],
  'Winston-Salem': ['Winston-Salem Open at Wake Forest University'],
  'Vienna': ['Erste Bank Open', 'BA-CA Tennis Trophy', 'CA Tennis Trophy', 'Vienna Open'],
  'Basel': ['Swiss Indoors', 'Davidoff Swiss Indoors'],
  'Beijing': ['China Open'],
  'Tokyo': ['Rakuten Japan Open Tennis Championships', 'Japan Open', 'AIG Japan Open Tennis Championships', 'Japan Open Tennis Championships'],
  'Hamburg': ['Hamburg TMS', 'German Open Tennis Championships', 'International German Open', 'Hamburg Open', 'bet-at-home Open'],
  'Stuttgart': ['Mercedes Cup', 'Mercedes-Benz Cup', 'Stuttgart Open'],
  'Estoril': ['Estoril Open', 'Millennium Estoril Open', 'Millenium Estoril Open', 'Portugal Open'],
  'Marseille': ['Open 13'],
  'Montpellier': ['Open Sud de France'],
  'Metz': ['Open de Moselle'],
  'Stockholm': ['Stockholm Open'],
  'Gstaad': ['Suisse Open Gstaad', 'Allianz Suisse Open', 'Crédit Agricole Suisse Open Gstaad'],
  'Munich': ['BMW Open'],
  'Bastad': ['SkiStar Swedish Open', 'Catella Swedish Open', 'Nordea Open', 'Swedish Open', 'Synsam Swedish Open'],
  'Marrakech': ['Grand Prix Hassan II'],
  'Houston': ["U.S. Men's Clay Court Championships", "U.S.Men's Clay Court Championships"],
  'Newport': ['Hall of Fame Championships'],
  'Eastbourne': ['AEGON International', 'Eastbourne International'],
  'Hertogenbosch': ['Ricoh Open', 'Ordina Open', 'Topshelf Open', 'Unicef Open', 'Rosmalen Grass Court Championships'],
  'Auckland': ['Heineken Open', 'ASB Classic'],
  'Brisbane': ['Brisbane International'],
  'Chengdu': ['Chengdu Open'],
  'Geneva': ['Geneva Open'],
  'Cordoba': ['Cordoba Open'],
  'Rio de Janeiro': ['Rio Open'],
  'Buenos Aires': ['Argentina Open', 'Copa Claro', 'Copa Telmex', 'Movistar Open'],
  'Santiago': ['Chile Open', 'VTR Open', 'Royal Guard Open Chile', 'Bellsouth Open'],
  'Umag': ['Croatia Open', 'Studena Croatia Open', 'ATP Vegeta Croatia Open', 'Konzum Croatia Open'],
  'Kitzbuhel': ['Generali Open', 'Austrian Open'],
  'Delray Beach': ['Delray Beach Open', 'International Championships'],
  'Adelaide': ['Adelaide International'],
  'Lyon': ['Lyon Open', 'Open de Nice Côte d’Azur'],
  'Antwerp': ['European Open'],
  'Dallas': ['Dallas Open'],
  'Los Cabos': ['Los Cabos Open'],
  'Almaty': ['Almaty Open'],
  'Mallorca': ['Mallorca Championships'],
  'Hong Kong': ['Hong Kong Tennis Open'],
  'Hangzhou': ['Hangzhou Open'],
};

function parseCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const row = {}; header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
    return row;
  });
}

const num = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };

// A match contributes (favWon, favPrice, dogPrice) or null when unusable.
function contrib(r) {
  if ((r.comment || 'completed').toLowerCase() !== 'completed') return null;
  const aw = num(r.avgw); const al = num(r.avgl);
  if (!aw || !al || aw === al) return null;
  const favWon = aw < al; // winner's price is aw; if it was the shorter one the fav won
  return [favWon, Math.min(aw, al), Math.max(aw, al)];
}

function agg(cs) {
  const n = cs.length;
  if (!n) return null;
  let sf = 0, sd = 0, fw = 0;
  for (const [won, fp, dp] of cs) { sf += (won ? fp : 0) - 1; sd += (won ? 0 : dp) - 1; if (won) fw += 1; }
  return { n, roiFav: +(sf / n * 100).toFixed(1), roiDog: +(sd / n * 100).toFixed(1), favRel: Math.round(fw / n * 100) };
}

function main() {
  const rev = {};
  for (const [dash, arcs] of Object.entries(ALIAS)) for (const a of arcs) (rev[a] = rev[a] || []).push(dash);

  const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => /^\d{4}\.csv$/.test(f)).sort();
  if (!files.length) throw new Error(`no season CSVs in ${ARCHIVE_DIR}`);

  const all = [];
  const buck = {};
  for (const f of files) {
    for (const r of parseCsv(path.join(ARCHIVE_DIR, f))) {
      const c = contrib(r);
      if (!c) continue;
      all.push(c);
      const ds = rev[r.tournament];
      if (ds) for (const d of ds) (buck[d] = buck[d] || []).push(c);
    }
  }

  const baseline = agg(all);
  const tournaments = {};
  for (const [name, cs] of Object.entries(buck)) {
    const a = agg(cs);
    if (a && a.n >= MIN_MATCHES) tournaments[name] = a;
  }

  const out = {
    version: 1,
    builtAt: new Date().toISOString(),
    source: 'odds-archive/*.csv — tennis-data.co.uk average closing prices',
    priceBasis: 'average closing price across books (avgw/avgl); favourite = shorter price',
    note: 'Flat 1u yields and favourite win rate per tournament, pooled across all archive seasons. Baseline pooled over every archive match.',
    minMatches: MIN_MATCHES,
    baseline,
    tournaments,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
  console.log(`tournament-market.json: ${Object.keys(tournaments).length} tournaments with a real figure (>=${MIN_MATCHES} matches); baseline roiFav=${baseline.roiFav}% roiDog=${baseline.roiDog}% favRel=${baseline.favRel}% over ${baseline.n} matches.`);
}

main();
