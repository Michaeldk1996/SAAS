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
  //
  // ─── FULL ROW SHAPE, verified cell by cell against the live page 2026-09-21 ──
  // 17 <td>s. The comment above described only as far as this parse reached; the
  // page publishes more, and the founder asked for the column-by-column read:
  //
  //    0 Elo Rank  · 1 Player · 2 Age · 3 Elo · 4 (spacer)
  //    5 hElo Rank · 6 hElo · 7 cElo Rank · 8 cElo · 9 gElo Rank · 10 gElo
  //   11 (spacer)  · 12 Peak Elo · 13 Peak Month · 14 (spacer) · 15 ATP Rank · 16 Log diff
  //
  // Sinner's row: 1 · Jannik Sinner · 24.8 · 2321.9 · · 1 · 2259.3 · 1 · 2211.8 ·
  // 1 · 2125.5 · · 2339.8 · 2026-05 · · 1 · 0.
  //
  //   TAKEN            Player, Elo, hElo/cElo/gElo and all three ranks (these
  //                    were ALREADY taken, not added now), Peak Elo, Peak Month.
  //   CAPTURED, UNUSED Age (group 3) — nothing on the site reads it and the
  //                    profile already carries an age from the feed.
  //   NOT READ         Elo Rank (col 0), which we instead infer from row order
  //                    below — equivalent while the report stays sorted by Elo
  //                    descending; ATP Rank and Log diff, which nothing asks for.
  //
  // THE PEAK TAIL IS OPTIONAL ON PURPOSE. Measured today: 550 of 550 rows carry
  // both Peak cells, so a REQUIRED tail would also match 550 and look identical.
  // But if the page ever blanks one cell, a required tail stops matching that row
  // and drops the PLAYER from the scrape entirely — trading a cosmetic gap for a
  // silent coverage loss. Optional means a missing peak is a dash on one column,
  // which is the standing rule.
  const re = /player\.cgi\?p=([^"]+)">([^<]+)<\/a><\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>([\d.]+)<\/td><td>\s*<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*>([\d.]+)<\/td>(?:<td>\s*<\/td><td[^>]*>([\d.]*)<\/td><td[^>]*>(\d{4}-\d{2})<\/td>)?/g;
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
    // Peak Elo is the OVERALL peak — the page carries no per-surface peak, so
    // this belongs beside the record, not inside `all`/`hard`/`clay`/`grass`.
    // Putting it in `all` would invite a reader to pair it with a surface rating
    // by symmetry, and that comparison is not defined.
    //
    // `peakMonth` is stored VERBATIM as the page prints it ("2026-05"). It is a
    // month, not a date: widening it to a day would invent precision the source
    // never published. A row with no peak gets `peak: null` — a dash, never 0
    // and never carried forward from a previous week's scrape.
    const peakRating = m[11] ? num(m[11]) : null;
    const rec = {
      all:   { rating: Math.round(overall), rank },
      hard:  { rating: num(m[6]), rank: num(m[5]) },
      clay:  { rating: num(m[8]), rank: num(m[7]) },
      grass: { rating: num(m[10]), rank: num(m[9]) },
      peak:  peakRating == null ? null : { rating: peakRating, month: m[12] || null },
    };
    const k = eloKey(name);
    if (k) { ratings[k] = Math.round(overall); elo[k] = rec; }
    const t = lastToken(name);
    if (t) { tokCount[t] = (tokCount[t] || 0) + 1; tokElo[t] = Math.round(overall); tokSurface[t] = rec; }
  }
  // last-token-only fallbacks, ONLY for tokens unique in the report (avoids Cerundolo x2 collisions)
  const bySurname = {}, bySurnameElo = {};
  for (const t in tokCount) if (tokCount[t] === 1) { bySurname[t] = tokElo[t]; bySurnameElo[t] = tokSurface[t]; }

  const withPeak = Object.values(elo).filter(r => r.peak).length;
  console.log(`Parsed ${rows} Elo rows -> ${Object.keys(ratings).length} keyed (overall + surface), ${Object.keys(bySurname).length} unique-token fallbacks.`);
  // Stated every run with its denominator, because a peak column that silently
  // thins is exactly the failure a single blended number would hide.
  console.log(`  peak Elo present on ${withPeak}/${Object.keys(elo).length} keyed players.`);

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'tennisabstract.com/reports/atp_elo_ratings.html',
    refresh: 'weekly (Mondays)',
    count: rows,
    ratings,       // back-compat: "lastToken|firstInitial" -> overall Elo (integer)
    bySurname,     // back-compat: unique last-token -> overall Elo
    // TEN-243 (founder 2026-09-21): `peak` is {rating, month} or null, and it is
    // the OVERALL peak — the source publishes no per-surface peak.
    //
    // NO vs-peak IS STORED. The delta is current minus peak, and "current" is
    // the open question: the Ratings board's Elo column follows the surface
    // pill, so a stored delta would have to pick a surface and bake that choice
    // into the store. The two source numbers live here; whoever renders it
    // decides which current it subtracts from, and says so on screen.
    elo,           // "lastToken|firstInitial" -> {all,hard,clay,grass,peak}
    bySurnameElo,  // fallback: unique last-token -> {all,hard,clay,grass,peak}
  };
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, OUT);
  console.log(`Wrote elo-ratings.json (${rows} players).`);
})();
