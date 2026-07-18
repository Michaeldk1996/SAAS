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

  // Row shape: ...player.cgi?p=ID">First&nbsp;Last</a></td><td align=right>AGE</td><td align=right>ELO</td>
  const re = /player\.cgi\?p=([^"]+)">([^<]+)<\/a><\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>([\d.]+)<\/td>/g;
  const ratings = {};                 // "lastToken|firstInitial" -> elo
  const tokCount = {};                // lastToken -> count (for unique fallback)
  const tokElo = {};                  // lastToken -> elo (last seen)
  let m, rows = 0;
  while ((m = re.exec(html))) {
    const name = m[2].replace(/&nbsp;/g, ' ').trim();
    const elo = parseFloat(m[4]);
    if (!Number.isFinite(elo)) continue;
    const k = eloKey(name);
    if (k) ratings[k] = Math.round(elo);
    const t = lastToken(name);
    if (t) { tokCount[t] = (tokCount[t] || 0) + 1; tokElo[t] = Math.round(elo); }
    rows++;
  }
  // last-token-only fallback, ONLY for tokens unique in the report (avoids Cerundolo x2 collisions)
  const bySurname = {};
  for (const t in tokCount) if (tokCount[t] === 1) bySurname[t] = tokElo[t];

  console.log(`Parsed ${rows} Elo rows -> ${Object.keys(ratings).length} keyed, ${Object.keys(bySurname).length} unique-token fallbacks.`);

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'tennisabstract.com/reports/atp_elo_ratings.html',
    refresh: 'weekly (Mondays)',
    count: rows,
    ratings,     // primary lookup: "lastToken|firstInitial" -> Elo (integer)
    bySurname,   // fallback: unique last-token -> Elo
  };
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, OUT);
  console.log(`Wrote elo-ratings.json (${rows} players).`);
})();
