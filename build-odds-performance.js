#!/usr/bin/env node
/**
 * Build per-player market-performance shards from the committed odds archive.
 *
 * Reads odds-archive/*.csv (see mirror-odds-archive.py) plus player-profiles.json, and
 * writes odds-performance/{key}.json + odds-performance-index.json. Shards are lazy --
 * nothing here is loaded until a profile modal opens, so this adds no page-load cost.
 *
 * What the numbers mean, and what they deliberately do NOT claim:
 *
 *   The archive carries ONE price per bookmaker per match -- "the most recent before play
 *   starts". There is no opening price, so true closing line value (open->close movement)
 *   is not computable and nothing here is called CLV. What we can measure is how a player
 *   performed against what the closing market expected of him, which is what these fields
 *   describe.
 *
 *   expectedWinRate  de-vigged implied probability from the closing average price, averaged
 *                    over his matches. Two-way de-vig: p = (1/o) / (1/o + 1/oOpp), which
 *                    strips the bookmaker margin so the baseline is a fair probability
 *                    rather than one that sums to ~105%.
 *   vsMarket         actualWinRate - expectedWinRate, in percentage points. Positive means
 *                    he won more often than the closing market priced him to.
 *   roi              flat 1-unit stake on this player every match at the average closing
 *                    price. roiBest uses the best price available across books instead.
 *   z / ci95         vsMarket carries real variance; a +4pp edge over 35 matches is noise.
 *                    The UI must not present a delta without its interval.
 *
 * Coverage is tour-level only -- the archive has no Challengers and no ITF -- so players
 * outside roughly the top 150 will not clear MIN_MATCHES. That is by design: we hide the
 * block rather than render a confident-looking number off a handful of matches.
 *
 * Usage: node build-odds-performance.js [--min 30] [--quiet]
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ARCHIVE_DIR = path.join(ROOT, 'odds-archive');
const OUT_DIR = path.join(ROOT, 'odds-performance');
const INDEX_PATH = path.join(ROOT, 'odds-performance-index.json');
const PROFILES_PATH = path.join(ROOT, 'player-profiles.json');

/** Below this many priced matches the profile block is hidden entirely. */
const MIN_MATCHES = 30;

/** Bumping this invalidates consumers the same way PROFILE_SCHEMA_VERSION does. */
const ODDS_PERF_SCHEMA_VERSION = 1;

const SURFACES = ['Hard', 'Clay', 'Grass'];

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter((l) => l.length);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    // The archive writer quotes any field containing a comma (tournament names do).
    const cells = [];
    let cur = '';
    let quoted = false;
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
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Name join
// ---------------------------------------------------------------------------

/**
 * Both sides are initial+surname, just mirrored: we store "D. Schwartzman", the archive
 * stores "Schwartzman D.". Collapse each to `surname|initials` with ALL initials kept --
 * keying on the first initial alone silently merges distinct players (Aragone J./J.C.,
 * Galan D./D.E., Lu Y./Y.H.), the same class of bug as the middle-name drop that lost
 * Vallejo from career-splits.
 */
function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normToken(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z]/g, '');
}

function isInitialToken(tok) {
  // "D." / "J-L." / "Pe." / "Dar." -- an initial group is short and dot-terminated.
  return /\.$/.test(tok) && stripAccents(tok).replace(/[^A-Za-z]/g, '').length <= 3;
}

/** Our side: "D. Schwartzman", "J-L. Struff", "Wu Tung-Lin" (no initial at all). */
function keyFromOurName(name) {
  const toks = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const initialToks = [];
  let i = 0;
  while (i < toks.length && isInitialToken(toks[i])) initialToks.push(toks[i++]);
  let surnameToks = toks.slice(i);
  let initials = initialToks.map((t) => normToken(t)).join('');
  if (!surnameToks.length) return null;
  if (!initials && surnameToks.length > 1) {
    // "Wu Tung-Lin": no dotted initial, so the trailing given name supplies them.
    initials = surnameToks.slice(1).map((t) => t.split(/[-\s]/).map((p) => normToken(p)[0] || '').join('')).join('');
    surnameToks = surnameToks.slice(0, 1);
  }
  return { surname: surnameToks.map(normToken).join(' '), initials };
}

/** Archive side: "Schwartzman D.", "Alvarez Valdes L.C.", "Struff J.L." */
function keyFromArchiveName(name) {
  const toks = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const initialToks = [];
  while (toks.length && isInitialToken(toks[toks.length - 1])) initialToks.unshift(toks.pop());
  if (!toks.length) return null;
  return {
    surname: toks.map(normToken).join(' '),
    initials: initialToks.map((t) => normToken(t)).join(''),
  };
}

const fullKey = (k) => (k ? `${k.surname}|${k.initials}` : null);

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const num = (v) => {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
};

const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

/** Two-way de-vig: strip the bookmaker margin so the two probabilities sum to 1. */
function devig(priceFor, priceAgainst) {
  if (!priceFor || !priceAgainst) return null;
  const a = 1 / priceFor;
  const b = 1 / priceAgainst;
  const total = a + b;
  return total > 0 ? a / total : null;
}

function emptyBucket() {
  return { matches: 0, wins: 0, expSum: 0, varSum: 0, profit: 0, profitBest: 0 };
}

function addToBucket(b, won, p, price, priceBest) {
  b.matches += 1;
  if (won) b.wins += 1;
  b.expSum += p;
  b.varSum += p * (1 - p);
  b.profit += won ? price - 1 : -1;
  b.profitBest += won ? priceBest - 1 : -1;
}

function summarize(b, minMatches) {
  if (!b || b.matches < minMatches) return null;
  const n = b.matches;
  const actual = (b.wins / n) * 100;
  const expected = (b.expSum / n) * 100;
  const delta = actual - expected;
  // Standard error of the win-count under the market's own probabilities, in points.
  const se = (Math.sqrt(b.varSum) / n) * 100;
  return {
    matches: n,
    wins: b.wins,
    losses: n - b.wins,
    actualWinRate: round1(actual),
    expectedWinRate: round1(expected),
    vsMarket: round1(delta),
    // 95% interval on vsMarket. If it straddles zero the player is indistinguishable
    // from correctly priced, and the UI must say so rather than showing a bare number.
    ci95: [round1(delta - 1.96 * se), round1(delta + 1.96 * se)],
    z: se > 0 ? Math.round((delta / se) * 100) / 100 : null,
    roi: round1((b.profit / n) * 100),
    roiBest: round1((b.profitBest / n) * 100),
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const minIdx = args.indexOf('--min');
  const minMatches = minIdx >= 0 ? parseInt(args[minIdx + 1], 10) : MIN_MATCHES;
  const quiet = args.includes('--quiet');
  const log = (...a) => { if (!quiet) console.log(...a); };

  const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')).players || {};

  // Our players, indexed by full key and by surname for the prefix fallback.
  const byFullKey = new Map();
  const bySurname = new Map();
  Object.entries(profiles).forEach(([key, p]) => {
    const k = keyFromOurName(p.name);
    if (!k) return;
    const entry = { key, name: p.name, rank: parseInt(p.rank, 10) || null, k };
    byFullKey.set(fullKey(k), entry);
    if (!bySurname.has(k.surname)) bySurname.set(k.surname, []);
    bySurname.get(k.surname).push(entry);
  });

  const seasons = fs.readdirSync(ARCHIVE_DIR).filter((f) => /^\d{4}\.csv$/.test(f)).sort();
  if (!seasons.length) throw new Error(`no season files in ${ARCHIVE_DIR} -- run mirror-odds-archive.py first`);

  const buckets = new Map(); // our player key -> { all, surface{}, role{}, season{} }
  const ambiguous = new Map();
  const stats = { rows: 0, priced: 0, incomplete: 0, matchedSides: 0 };

  function resolve(archiveName) {
    const k = keyFromArchiveName(archiveName);
    if (!k) return null;
    const exact = byFullKey.get(fullKey(k));
    if (exact) return exact;
    // One side may record fewer initials than the other ("Struff J." vs "Struff J.L.").
    // Accept a prefix match only when exactly one of our players can possibly be meant --
    // otherwise we would be guessing between two real people.
    const candidates = (bySurname.get(k.surname) || []).filter((c) => {
      const a = c.k.initials;
      const b = k.initials;
      return a && b && (a.startsWith(b) || b.startsWith(a));
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) ambiguous.set(archiveName, candidates.map((c) => c.name));
    return null;
  }

  function bucketsFor(playerKey) {
    if (!buckets.has(playerKey)) {
      buckets.set(playerKey, { all: emptyBucket(), surface: {}, role: {}, season: {} });
    }
    return buckets.get(playerKey);
  }

  seasons.forEach((file) => {
    const season = file.slice(0, 4);
    readCsv(path.join(ARCHIVE_DIR, file)).forEach((row) => {
      stats.rows += 1;
      // Retirements and walkovers are ~3.5% of a season and bias the result: the price
      // was struck for a match that was never really played out.
      if (row.comment && row.comment.toLowerCase() !== 'completed') { stats.incomplete += 1; return; }

      const aw = num(row.avgw);
      const al = num(row.avgl);
      if (!aw || !al) return;
      stats.priced += 1;

      const pWin = devig(aw, al);
      const pLose = devig(al, aw);
      if (pWin === null || pLose === null) return;

      const bestW = num(row.maxw) || aw;
      const bestL = num(row.maxl) || al;
      const surface = SURFACES.includes(row.surface) ? row.surface : null;

      [
        { name: row.winner, won: true, p: pWin, price: aw, best: bestW, fav: aw < al },
        { name: row.loser, won: false, p: pLose, price: al, best: bestL, fav: al < aw },
      ].forEach((side) => {
        const player = resolve(side.name);
        if (!player) return;
        stats.matchedSides += 1;
        const b = bucketsFor(player.key);
        addToBucket(b.all, side.won, side.p, side.price, side.best);
        if (surface) {
          b.surface[surface] = b.surface[surface] || emptyBucket();
          addToBucket(b.surface[surface], side.won, side.p, side.price, side.best);
        }
        const role = side.fav ? 'favourite' : 'underdog';
        b.role[role] = b.role[role] || emptyBucket();
        addToBucket(b.role[role], side.won, side.p, side.price, side.best);
        b.season[season] = b.season[season] || emptyBucket();
        addToBucket(b.season[season], side.won, side.p, side.price, side.best);
      });
    });
  });

  // Emit shards.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const coverage = [];
  const index = {};
  let shipped = 0;

  buckets.forEach((b, playerKey) => {
    const profile = profiles[playerKey];
    const overall = summarize(b.all, minMatches);
    coverage.push({ key: playerKey, name: profile && profile.name, rank: parseInt(profile && profile.rank, 10) || null, matches: b.all.matches });
    if (!overall) return; // below the gate -- no shard, so the UI has nothing to render

    // Sub-splits need a sample too, but a smaller one; a surface with 8 matches is still
    // worth showing next to a 200-match overall, so long as its own interval is shown.
    const subMin = Math.max(10, Math.round(minMatches / 3));
    const bySurface = {};
    Object.entries(b.surface).forEach(([s, v]) => { const r = summarize(v, subMin); if (r) bySurface[s] = r; });
    const byRole = {};
    Object.entries(b.role).forEach(([r, v]) => { const s = summarize(v, subMin); if (s) byRole[r] = s; });
    const bySeason = {};
    Object.entries(b.season).forEach(([y, v]) => { const s = summarize(v, subMin); if (s) bySeason[y] = s; });

    const shard = {
      version: ODDS_PERF_SCHEMA_VERSION,
      key: playerKey,
      name: profile && profile.name,
      source: 'tennis-data.co.uk closing prices, mirrored to odds-archive/',
      priceBasis: 'average closing price across books, de-vigged',
      note: 'No opening prices exist in this source, so this is performance against the closing market, not closing line value.',
      minMatches,
      overall,
      bySurface,
      byRole,
      bySeason,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${playerKey}.json`), JSON.stringify(shard));
    index[playerKey] = { matches: overall.matches, vsMarket: overall.vsMarket, roi: overall.roi };
    shipped += 1;
  });

  fs.writeFileSync(INDEX_PATH, JSON.stringify({
    version: ODDS_PERF_SCHEMA_VERSION,
    builtAt: new Date().toISOString(),
    minMatches,
    seasons: seasons.map((f) => f.slice(0, 4)),
    players: index,
  }));

  // Report -- coverage by rank band is the number that decides whether this feature is
  // worth showing at all, so it gets printed every run rather than hidden behind a flag.
  const bands = [[1, 50], [51, 100], [101, 150], [151, 250], [251, 9999]];
  const ranked = Object.entries(profiles).map(([key, p]) => ({
    key, rank: parseInt(p.rank, 10) || null, matches: (buckets.get(key) || { all: { matches: 0 } }).all.matches,
  })).filter((r) => r.rank);

  log(`\nParsed ${stats.rows} archive rows across ${seasons.length} seasons`);
  log(`  ${stats.incomplete} retired/walkover excluded, ${stats.priced} priced, ${stats.matchedSides} player-sides joined`);
  log(`\nShards written: ${shipped} of ${Object.keys(profiles).length} profiled players (gate: >=${minMatches} priced matches)`);
  log('\nCoverage by rank band:');
  bands.forEach(([lo, hi]) => {
    const inBand = ranked.filter((r) => r.rank >= lo && r.rank <= hi);
    if (!inBand.length) return;
    const passing = inBand.filter((r) => r.matches >= minMatches).length;
    const med = inBand.map((r) => r.matches).sort((a, b) => a - b)[Math.floor(inBand.length / 2)];
    log(`  rank ${String(lo).padStart(3)}-${hi === 9999 ? '+  ' : String(hi).padStart(3)}: ${String(passing).padStart(3)}/${String(inBand.length).padEnd(3)} pass gate (${(100 * passing / inBand.length).toFixed(1)}%), median ${med} matches`);
  });
  if (ambiguous.size) {
    log(`\n${ambiguous.size} archive name(s) left unjoined as ambiguous (two of our players could be meant):`);
    Array.from(ambiguous.entries()).slice(0, 10).forEach(([n, c]) => log(`  ${n} -> ${c.join(' / ')}`));
  }
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { keyFromOurName, keyFromArchiveName, devig, summarize };
