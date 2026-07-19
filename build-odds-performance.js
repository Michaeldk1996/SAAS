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
const ODDS_PERF_SCHEMA_VERSION = 3;

const SURFACES = ['Hard', 'Clay', 'Grass'];

/**
 * The "current form" window is his last N PRICED MATCHES, not a calendar window.
 *
 * A calendar window is the wrong shape for this feature: measured over the archive,
 * "last 24 months" is 50 matches for a busy top-20 player but 12 for someone who spent
 * a season injured -- so the same label means a solid read for one player and noise for
 * another, and 54 of 164 players fall under the sample gate entirely. A rolling
 * match count holds the SAMPLE fixed and lets the timespan vary, which is the honest
 * trade: every player's number carries the same reliability.
 *
 * N=40 is where the two curves cross. It keeps 154/164 players (a 24-month calendar
 * window keeps 110) at a median 95% interval of +/-14.3pp on vsMarket, and spans a
 * median 16.7 months -- recent enough to be about current form. N=25 would cover all
 * 164 but widens the interval to +/-18.1pp, which is too loose to call anyone hot or cold.
 */
const RECENT_MATCHES = 40;

/**
 * The source renamed its tiers twice over 22 seasons ("International" -> "ATP250",
 * "International Gold" -> "ATP500", "Masters" -> "Masters 1000"). Bucketing on the raw
 * string would split one player's Masters record across two labels and drop both below
 * the sample gate, so collapse to the modern names first.
 */
const LEVEL_ALIASES = {
  'Grand Slam': 'Grand Slam',
  'Masters Cup': 'Tour Finals',
  Masters: 'Masters 1000',
  'Masters 1000': 'Masters 1000',
  'International Gold': 'ATP 500',
  ATP500: 'ATP 500',
  International: 'ATP 250',
  ATP250: 'ATP 250',
};
const LEVEL_ORDER = ['Grand Slam', 'Tour Finals', 'Masters 1000', 'ATP 500', 'ATP 250'];

/** Opponent-strength bands. Rank is the opponent's ATP rank at the time of the match. */
const OPP_BANDS = [
  { id: 'top10', label: 'Top 10', test: (r) => r <= 10 },
  { id: 'r11_25', label: 'Rank 11-25', test: (r) => r <= 25 },
  { id: 'r26_50', label: 'Rank 26-50', test: (r) => r <= 50 },
  { id: 'r51_100', label: 'Rank 51-100', test: (r) => r <= 100 },
  { id: 'r100plus', label: 'Outside 100', test: () => true },
];

/**
 * Favourite-reliability bands, keyed on HIS OWN de-vigged price. "How often does he lose
 * a match he was priced to win" is only a meaningful question band by band: losing 1 in 3
 * as a 1.90 favourite is normal, losing 1 in 3 as a 1.20 favourite is a disaster. Each
 * band therefore carries what the market expected of it, not just what he did.
 */
const FAV_BANDS = [
  { id: 'heavy', label: 'Heavy favourite', sub: 'shorter than 1.30', test: (price) => price < 1.3 },
  { id: 'clear', label: 'Clear favourite', sub: '1.30 - 1.60', test: (price) => price < 1.6 },
  { id: 'slight', label: 'Slight favourite', sub: '1.60 - 2.00', test: (price) => price < 2.0 },
];

/**
 * Underdog reliability -- the mirror of the above, and the more valuable half. The
 * favourite-longshot bias means the market's error is concentrated in the dogs:
 * measured across the archive, 4.00+ shots win 14.6% against an implied 16.2%, while
 * the 1.90-2.50 band is actually fair (45.9% vs 43.6%). "Does he beat his price when
 * he is the one being written off" is therefore a different question band by band.
 *
 * Three bands, not the four the price ladder suggests: an underdog is by definition
 * priced above his opponent, so a sub-1.90 underdog needs the opponent above 1.90 too
 * -- that is a near-pick'em, and the median player has ZERO of them. A fourth band
 * would render as a permanently empty row.
 */
const DOG_BANDS = [
  { id: 'slightdog', label: 'Slight underdog', sub: '1.90 - 2.50', test: (price) => price < 2.5 },
  { id: 'cleardog', label: 'Clear underdog', sub: '2.50 - 4.00', test: (price) => price < 4.0 },
  { id: 'bigdog', label: 'Big underdog', sub: '4.00 and longer', test: () => true },
];

/**
 * Round stage replaces the indoor/outdoor and 3-vs-5-set splits. Those two answered a
 * question nobody asks of a betting page (a player's indoor record is a surface story,
 * already told above it), whereas "does he hold up once the draw gets hard" is a
 * pricing question. Collapsed to three stages because the source's round vocabulary
 * changes across seasons and per-round buckets are far too thin to survive the gate.
 */
const ROUND_STAGES = [
  { id: 'early', label: 'R1 - R2', test: (r) => /^(1st|2nd) Round$/.test(r) },
  { id: 'middle', label: 'R3 - Quarter-final', test: (r) => /^(3rd|4th) Round$/.test(r) || /Quarterfinal/i.test(r) },
  { id: 'late', label: 'Semi-final and final', test: (r) => /Semifinal|The Final|Final/i.test(r) },
];

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
  return { matches: 0, wins: 0, expSum: 0, varSum: 0, profit: 0, profitBest: 0, priceSum: 0, priceBestSum: 0 };
}

function addToBucket(b, won, p, price, priceBest) {
  b.matches += 1;
  if (won) b.wins += 1;
  b.expSum += p;
  b.varSum += p * (1 - p);
  b.profit += won ? price - 1 : -1;
  b.profitBest += won ? priceBest - 1 : -1;
  // Carried so the line-shopping block can quote a real price gap ("1.94 average vs 2.03
  // best") rather than only the ROI difference, which is unreadable without the prices.
  b.priceSum += price;
  b.priceBestSum += priceBest;
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
    avgPrice: Math.round((b.priceSum / n) * 100) / 100,
    avgPriceBest: Math.round((b.priceBestSum / n) * 100) / 100,
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
  const stats = { rows: 0, priced: 0, incomplete: 0, impossible: 0, matchedSides: 0 };

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
      buckets.set(playerKey, {
        all: emptyBucket(), surface: {}, role: {}, season: {},
        level: {}, oppRank: {}, favBand: {}, dogBand: {}, round: {},
        // The rolling window needs the tail of his career in date order, which is only
        // knowable once every season file has been read -- so keep the sides and slice
        // them after the pass rather than accumulating a bucket during it.
        sides: [],
      });
    }
    return buckets.get(playerKey);
  }

  // archiveLatest is still reported so the UI can say how stale the mirror is -- the
  // form window no longer depends on it, because it is a match count now, not a date.
  let archiveLatest = '';
  const parsedSeasons = new Map();
  seasons.forEach((file) => {
    const rows = readCsv(path.join(ARCHIVE_DIR, file));
    parsedSeasons.set(file, rows);
    rows.forEach((r) => { if (r.date && r.date > archiveLatest) archiveLatest = r.date; });
  });

  seasons.forEach((file) => {
    const season = file.slice(0, 4);
    parsedSeasons.get(file).forEach((row) => {
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

      // The source carries a handful of corrupt prices, and they are not harmless: one
      // row has Opelka beating Isner at 161.0 with a best price of 1.68, and that single
      // cell supplied +70 of his +74.4% career ROI -- the highest figure on the whole
      // feature was a typo. The tell is internal contradiction: the best price across
      // books can never be SHORTER than the average across the same books. 32 sides in
      // 55,545 fail it. Drop them rather than clamping, because when the two disagree
      // this badly there is no way to know which of the pair is the sound one.
      if (bestW < aw || bestL < al) { stats.impossible += 1; return; }

      const surface = SURFACES.includes(row.surface) ? row.surface : null;
      const level = LEVEL_ALIASES[row.series] || null;
      const stage = (ROUND_STAGES.find((x) => x.test(String(row.round || ''))) || {}).id || null;
      const wr = num(row.wrank);
      const lr = num(row.lrank);

      [
        { name: row.winner, won: true, p: pWin, price: aw, best: bestW, fav: aw < al, oppRank: lr },
        { name: row.loser, won: false, p: pLose, price: al, best: bestL, fav: al < aw, oppRank: wr },
      ].forEach((side) => {
        const player = resolve(side.name);
        if (!player) return;
        stats.matchedSides += 1;
        const b = bucketsFor(player.key);
        const add = (bucket) => addToBucket(bucket, side.won, side.p, side.price, side.best);
        const into = (group, k) => { if (k == null) return; group[k] = group[k] || emptyBucket(); add(group[k]); };
        add(b.all);
        into(b.surface, surface);
        into(b.role, side.fav ? 'favourite' : 'underdog');
        into(b.season, season);
        into(b.level, level);
        into(b.round, stage);
        // An opponent with no recorded rank is unranked/qualifier-era, not "outside 100" --
        // folding those in would flatter the weakest band, so they are dropped instead.
        into(b.oppRank, side.oppRank ? (OPP_BANDS.find((x) => x.test(side.oppRank)) || {}).id : null);
        // Reliability is only defined on the side of the market he was actually on.
        if (side.fav) into(b.favBand, (FAV_BANDS.find((x) => x.test(side.price)) || {}).id);
        else into(b.dogBand, (DOG_BANDS.find((x) => x.test(side.price)) || {}).id);
        b.sides.push({ date: row.date, won: side.won, p: side.p, price: side.price, best: side.best, fav: side.fav, surface });
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

    // v2 splits. Each is gated on its own sample, so a player who has never played a
    // Tour Final simply has no Tour Finals row -- the UI renders what is there.
    const summarizeGroup = (group, order) => {
      const out = {};
      const keys = order ? order.filter((k) => group[k]) : Object.keys(group);
      keys.forEach((k) => { const s = summarize(group[k], subMin); if (s) out[k] = s; });
      return out;
    };
    const byLevel = summarizeGroup(b.level, LEVEL_ORDER);
    const byRound = summarizeGroup(b.round, ROUND_STAGES.map((x) => x.id));
    const byOppRank = summarizeGroup(b.oppRank, OPP_BANDS.map((x) => x.id));
    const favReliability = summarizeGroup(b.favBand, FAV_BANDS.map((x) => x.id));
    const dogReliability = summarizeGroup(b.dogBand, DOG_BANDS.map((x) => x.id));

    // Current form = his last RECENT_MATCHES priced matches. Sorted here because season
    // files are read in order but are not guaranteed to be sorted within a file.
    const ordered = b.sides.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const tail = ordered.slice(-RECENT_MATCHES);
    const recentBucket = emptyBucket();
    const recentSurface = {};
    const recentRole = {};
    tail.forEach((s) => {
      addToBucket(recentBucket, s.won, s.p, s.price, s.best);
      const push = (group, k) => {
        if (k == null) return;
        group[k] = group[k] || emptyBucket();
        addToBucket(group[k], s.won, s.p, s.price, s.best);
      };
      push(recentSurface, s.surface);
      push(recentRole, s.fav ? 'favourite' : 'underdog');
    });
    // Still gated: a player who only ever had 31 priced matches has a "last 40" that is
    // really his whole career, and labelling that "current form" would be a lie.
    const recent = tail.length >= RECENT_MATCHES ? summarize(recentBucket, subMin) : null;
    const recentBySurface = recent ? summarizeGroup(recentSurface, SURFACES) : {};
    const recentByRole = recent ? summarizeGroup(recentRole, ['underdog', 'favourite']) : {};
    const recentSpan = recent && tail.length ? { from: tail[0].date, to: tail[tail.length - 1].date } : null;

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
      byLevel,
      byRound,
      byOppRank,
      favReliability,
      dogReliability,
      recent,
      recentBySurface,
      recentByRole,
      recentWindow: recent ? { matches: RECENT_MATCHES, from: recentSpan.from, to: recentSpan.to } : null,
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
    archiveLatest,
    recentWindow: { matches: RECENT_MATCHES },
    players: index,
  }));

  // Report -- coverage by rank band is the number that decides whether this feature is
  // worth showing at all, so it gets printed every run rather than hidden behind a flag.
  const bands = [[1, 50], [51, 100], [101, 150], [151, 250], [251, 9999]];
  const ranked = Object.entries(profiles).map(([key, p]) => ({
    key, rank: parseInt(p.rank, 10) || null, matches: (buckets.get(key) || { all: { matches: 0 } }).all.matches,
  })).filter((r) => r.rank);

  log(`\nParsed ${stats.rows} archive rows across ${seasons.length} seasons`);
  log(`  ${stats.incomplete} retired/walkover excluded, ${stats.impossible} dropped for best<avg price, ${stats.priced} priced, ${stats.matchedSides} player-sides joined`);
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
