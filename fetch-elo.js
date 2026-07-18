// =================================================================
// TENNIS ABSTRACT ELO FETCHER
// -----------------------------------------------------------------
// Downloads the ATP Elo ratings report from tennisabstract.com (which
// refreshes weekly, on Mondays), parses the rating table, and writes a
// local elo-ratings.json keyed by name so the dashboard can show each
// player's live Elo WITHOUT hitting tennisabstract at runtime (per the
// project rule: download + parse + cache locally, never query live).
//
// Run this once a week (Monday) to refresh. Output is atomic (temp+rename).
// =================================================================
const fs = require('fs');
const path = require('path');

const SRC = 'https://tennisabstract.com/reports/atp_elo_ratings.html';
const CACHE = path.join(__dirname, 'tml-cache', 'atp_elo.html');
const OUT = path.join(__dirname, 'elo-ratings.json');

// Shared with the dashboard's lookup — keep the two in sync.
// Normalizes to lowercase ascii, initials/hyphens/apostrophes flattened to spaces.
function eloNorm(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // deaccent
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/['’]/g, '')                                 // drop apostrophes (O'Connell)
    .replace(/[.\-]/g, ' ')                                   // initials / hyphens -> space
    .replace(/\s+/g, ' ').trim();
}
// Key on LAST surname token + first initial — robust to two-word first names
// ("Soon Woo Kwon"), compound first initials ("J-L. Struff") and compound
// surnames ("Davidovich Fokina" -> fokina|a on both sides).
function eloKey(name) {
  const p = eloNorm(name).split(' ').filter(Boolean);
  if (p.length < 2) return null;
  return p[p.length - 1] + '|' + p[0][0];
}
function lastToken(name) {
  const p = eloNorm(name).split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1];
}

(async () => {
  let html;
  const res = await fetch(SRC, { headers: { 'User-Agent': 'bsp-consult' } }).catch(e => null);
  if (res && res.ok) {
    html = await res.text();
    if (html && html.length > 5000) {
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, html);
      console.log(`Fetched ${SRC} (${html.length} bytes), cached.`);
    } else { html = null; }
  }
  if (!html) {
    if (fs.existsSync(CACHE)) { html = fs.readFileSync(CACHE, 'utf8'); console.log('Fetch failed — using cached copy.'); }
    else { console.error('Fetch failed and no cache available. Aborting.'); process.exit(1); }
  }

  // Row shape (columns in order): ...player.cgi?p=ID">First&nbsp;Last</a></td>
  //   <td>AGE</td><td>ELO</td><td></td>       (overall Elo, then a spacer cell)
  //   <td>hRank</td><td>hElo</td>             (hard Elo rank + rating)
  //   <td>cRank</td><td>cElo</td>             (clay Elo rank + rating)
  //   <td>gRank</td><td>gElo</td>             (grass Elo rank + rating)
  // The report is sorted by overall Elo descending, so overall rank == row order.
  const re = /player\.cgi\?p=([^"]+)">([^<]+)<\/a><\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>([\d.]+)<\/td><td>\s*<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td>/g;
  const ratings = {};                 // "lastToken|firstInitial" -> overall elo (back-compat)
  const elo = {};                     // "lastToken|firstInitial" -> {all,hard,clay,grass}: {rating,rank}
  const tokCount = {};                // lastToken -> count (for unique fallback)
  const tokElo = {};                  // lastToken -> overall elo (last seen)
  const tokSurface = {};              // lastToken -> surface record (last seen)
  let m, rows = 0;
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n) : null; };
  while ((m = re.exec(html))) {
    const name = m[2].replace(/&nbsp;/g, ' ').trim();
    const overall = parseFloat(m[4]);
    if (!Number.isFinite(overall)) continue;
    rows++;
    const rank = rows;                 // overall Elo rank = position in the sorted report
    const rec = {
      all:   { rating: Math.round(overall), rank },
      hard:  { rating: num(m[6]), rank: num(m[5]) },
      clay:  { rating: num(m[8]), rank: num(m[7]) },
      grass: { rating: num(m[10]), rank: num(m[9]) },
    };
    const k = eloKey(name);
    if (k) { ratings[k] = Math.round(overall); elo[k] = rec; }
    const t = lastToken(name);
    if (t) { tokCount[t] = (tokCount[t] || 0) + 1; tokElo[t] = Math.round(overall); tokSurface[t] = rec; }
  }
  // last-token-only fallbacks, ONLY for tokens unique in the report (avoids Cerundolo x2 collisions)
  const bySurname = {}, bySurnameElo = {};
  for (const t in tokCount) if (tokCount[t] === 1) { bySurname[t] = tokElo[t]; bySurnameElo[t] = tokSurface[t]; }

  console.log(`Parsed ${rows} Elo rows -> ${Object.keys(ratings).length} keyed (overall + surface), ${Object.keys(bySurname).length} unique-token fallbacks.`);

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'tennisabstract.com/reports/atp_elo_ratings.html',
    refresh: 'weekly (Mondays)',
    count: rows,
    ratings,       // back-compat: "lastToken|firstInitial" -> overall Elo (integer)
    bySurname,     // back-compat: unique last-token -> overall Elo
    elo,           // "lastToken|firstInitial" -> {all,hard,clay,grass}: {rating,rank}
    bySurnameElo,  // fallback: unique last-token -> {all,hard,clay,grass}: {rating,rank}
  };
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, OUT);
  console.log(`Wrote elo-ratings.json (${rows} players).`);
})();
