#!/usr/bin/env node
/**
 * build-court-speed-map.js — TEN-206 §5.5, archive event name -> rated venue.
 *
 * The problem
 * -----------
 * The Court speed modal bands every match by the venue's Tennis Abstract speed.
 * COURT_CONDITIONS (bsp-pipeline.js) holds a real per-venue `abstractSpeed` for 64
 * venues, keyed by HOST CITY, because that is how api-tennis labels a tournament.
 * The odds archive labels the same events by SPONSOR ("BNP Paribas Open",
 * "Swiss Indoors", "Citi Open"). The pipeline's matcher is a plain substring test,
 * so against archive names it resolves only 41.5% of rows (16,429 of 39,615) —
 * and the misses are overwhelmingly venues we DO hold a rating for.
 *
 * Why this is derived and not hand-written
 * ----------------------------------------
 * Hand-authoring ~170 "sponsor name -> city" lines would be me asserting a join with
 * nothing to check it against, and the one time a name join was trusted on this repo
 * it silently put Medvedev at one indoor match. So the map is VOTED out of data we
 * already hold:
 *
 *   For every player, the archive rows and player-profiles.json `tournamentHistory`
 *   describe the SAME career. Key both by (year, opponent surname) and each archive
 *   event name collects votes for the api-tennis tournament name it co-occurs with.
 *   The api-tennis name is host-city shaped, so it feeds the existing matcher directly.
 *
 * Votes are canonicalised through the repo's own tournament-identity.js first,
 * otherwise "Rome" and "Rome Masters" split the same event's vote in half and the
 * margin test rejects a mapping that is in fact unanimous.
 *
 * Acceptance: the winner needs >= MIN_VOTES votes AND >= MARGIN x the runner-up.
 * Anything short stays UNMAPPED — those rows dash rather than guess. That is not a
 * theoretical guard: "European Open" is Antwerp in some years and Hamburg in others
 * (273 vs 144), and a plurality rule would have silently picked one.
 *
 * The surface guard
 * -----------------
 * A venue's abstractSpeed is a CURRENT reading (abstractSpeedYear, 2024-2025 for all
 * 64). Several venues changed surface inside the archive window — Madrid was indoor
 * hard before 2009 and clay after, Stuttgart clay before 2015 and grass after, Lyon
 * carpet then clay. Banding those older matches by today's rating would rate a clay
 * court off a grass reading.
 *
 * The era that survives is the one the RATING WAS TAKEN IN — the venue's (surface,
 * court) in its most recent archive seasons — not the era with the most rows. Those
 * are not the same thing and the difference is not academic: Stuttgart's clay era is
 * longer than its grass era (369 rows vs 297), so a modal rule keeps clay and then
 * bands it off a 2025 GRASS reading, which is the exact error the guard exists to
 * prevent. Rows outside the rating era are excluded from banding and counted, so the
 * page can say how many it set aside.
 *
 * This does NOT fix the residual: a venue that kept its surface still resurfaces over
 * twenty years and we hold one rating. The page states the rating year for that reason.
 *
 * Output: court-speed-map.json. Re-runnable and deterministic from the two inputs.
 * Usage: node build-court-speed-map.js [--quiet]
 */

const fs = require('fs');
const path = require('path');
const base = require('./build-odds-performance.js');
const { readCsv } = base;
const { canonicalTournament } = require('./tournament-identity.js');

const ROOT = __dirname;
const ARCHIVE_DIR = path.join(ROOT, 'odds-archive');
const PROFILES_PATH = path.join(ROOT, 'player-profiles.json');
const OUT_PATH = path.join(ROOT, 'court-speed-map.json');
const PIPELINE_PATH = path.join(ROOT, 'bsp-pipeline.js');

const SCHEMA_VERSION = 1;
/** A winner under twenty votes is a coincidence, not a mapping. */
const MIN_VOTES = 20;
/** Three-to-one over the runner-up. Below that the name is genuinely shared. */
const MARGIN = 3;

const quiet = process.argv.includes('--quiet');
const log = (m) => { if (!quiet) console.log(m); };

/**
 * COURT_CONDITIONS is a literal inside bsp-pipeline.js, which is a browser/pipeline
 * hybrid that cannot simply be required here. It is read as source and evaluated so
 * there is exactly ONE copy of the venue ratings in the repo — duplicating 64 venues
 * into a second file is how the two drift.
 */
function loadCourtConditions() {
  const src = fs.readFileSync(PIPELINE_PATH, 'utf8');
  const start = src.indexOf('const COURT_CONDITIONS = {');
  if (start < 0) throw new Error('COURT_CONDITIONS not found in bsp-pipeline.js');
  const end = src.indexOf('\n};', start);
  if (end < 0) throw new Error('COURT_CONDITIONS literal is unterminated');
  const literal = src.slice(start + 'const COURT_CONDITIONS = '.length, end + 2);
  // eslint-disable-next-line no-eval
  return eval('(' + literal + ')');
}

const deaccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** "F. Auger-Aliassime" (api-tennis) -> "auger-aliassime" */
const surnameProfile = (o) => deaccent(o).toLowerCase().replace(/^[a-z]\.\s*/, '').replace(/[^a-z\- ]/g, '').trim();
/** "Ancic M." (archive) -> "ancic" */
const surnameArchive = (o) => deaccent(o).toLowerCase().replace(/\s+[a-z]\.(\s*[a-z]\.)?$/, '').replace(/[^a-z\- ]/g, '').trim();

/**
 * Archive/api-tennis name -> COURT_CONDITIONS key, using the substring matcher the
 * pipeline already uses, then the repo's identity table in both directions so
 * "French Open" reaches the 'Roland Garros' rating (clay 0.68) instead of falling
 * through to nothing. It must NOT reach 'Paris' — that is Bercy, indoor hard 0.97.
 */
function makeVenueMatcher(ccKeys) {
  const canonOfKey = new Map(ccKeys.map((k) => [k, canonicalTournament(k).display]));
  return function venueOf(name) {
    const direct = ccKeys.find((k) => String(name || '').includes(k));
    if (direct) return direct;
    const canon = canonicalTournament(name).display;
    const viaCanon = ccKeys.find((k) => canon.includes(k));
    if (viaCanon) return viaCanon;
    for (const [k, c] of canonOfKey) if (c === canon) return k;
    return null;
  };
}

function main() {
  const CC = loadCourtConditions();
  const ccKeys = Object.keys(CC).filter((k) => CC[k].abstractSpeed != null);
  const venueOf = makeVenueMatcher(ccKeys);
  log(`rated venues: ${ccKeys.length}`);

  const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
  const players = profiles.players || profiles;

  // (year|opponent surname) -> canonical api-tennis tournament name, per player.
  // Built once per player so an archive row can ask "what event was this, upstream?"
  // Votes are cast on the identity KEY, not the display name: "'s-Hertogenbosch" and
  // "''s-Hertogenbosch" are one venue whose display strings differ by a stray quote,
  // and voting on display splits them 5-4 and loses the event to the margin test.
  const displayOf = new Map();   // identityKey -> a representative display name
  const perPlayerIndex = new Map();
  for (const key of Object.keys(players)) {
    const idx = new Map();
    for (const t of players[key].tournamentHistory || []) {
      const canon = canonicalTournament(t.name);
      if (!displayOf.has(canon.id)) displayOf.set(canon.id, canon.display);
      for (const ed of t.editions || []) {
        for (const m of ed.matches || []) idx.set(ed.year + '|' + surnameProfile(m.opp), canon.id);
      }
    }
    if (idx.size) perPlayerIndex.set(key, idx);
  }
  // archive surname -> the profile keys that could be that player. The archive carries
  // no id, so a surname shared by two profiled players votes in both — which is exactly
  // what the margin test is there to absorb.
  const bySurname = new Map();
  for (const key of Object.keys(players)) {
    const s = surnameProfile(players[key].name || '');
    if (!s) continue;
    if (!bySurname.has(s)) bySurname.set(s, []);
    bySurname.get(s).push(key);
  }

  const votes = new Map();       // archive event -> Map(identityKey -> votes)
  const eventRows = new Map();   // archive event -> row count
  const eventSurface = new Map();// archive event -> Map("Surface/Court" -> Map(year -> count))
  let archiveRows = 0;

  const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.csv')).sort();
  for (const f of files) {
    for (const row of readCsv(path.join(ARCHIVE_DIR, f))) {
      const event = (row.tournament || '').trim();
      if (!event || !row.date) continue;
      const year = +String(row.date).slice(0, 4);
      if (!year) continue;
      archiveRows += 1;
      eventRows.set(event, (eventRows.get(event) || 0) + 1);
      if (!eventSurface.has(event)) eventSurface.set(event, new Map());
      const sk = (row.surface || '?').trim() + '/' + ((row.court || '?').trim() || '?');
      const perYear = eventSurface.get(event);
      if (!perYear.has(sk)) perYear.set(sk, new Map());
      perYear.get(sk).set(year, (perYear.get(sk).get(year) || 0) + 1);

      // Both sides vote — each names the other as its opponent, so one archive row
      // can confirm the event from two independent profiles.
      for (const [self, other] of [[row.winner, row.loser], [row.loser, row.winner]]) {
        const cands = bySurname.get(surnameArchive(self)) || [];
        for (const pk of cands) {
          const idx = perPlayerIndex.get(pk);
          if (!idx) continue;
          const name = idx.get(year + '|' + surnameArchive(other));
          if (!name) continue;
          if (!votes.has(event)) votes.set(event, new Map());
          const v = votes.get(event);
          v.set(name, (v.get(name) || 0) + 1);
        }
      }
    }
  }
  log(`archive rows ${archiveRows}, distinct events ${eventRows.size}`);

  const derived = {};
  const ambiguous = [];
  for (const [event, v] of votes) {
    const ranked = [...v.entries()].sort((a, b) => b[1] - a[1]);
    const [topId, v1] = ranked[0];
    const v2 = ranked[1] ? ranked[1][1] : 0;
    const topName = displayOf.get(topId) || topId;
    const venue = venueOf(topName);
    if (!venue) continue; // upstream event identified, but we hold no rating for it
    if (v1 >= MIN_VOTES && v1 >= MARGIN * v2) {
      derived[event] = { venue, via: topName, votes: v1, runnerUp: v2, rows: eventRows.get(event) };
    } else {
      const runnerId = ranked[1] ? ranked[1][0] : null;
      ambiguous.push({ event, top: topName, votes: v1, runnerUp: runnerId ? (displayOf.get(runnerId) || runnerId) : null, runnerUpVotes: v2, rows: eventRows.get(event) });
    }
  }

  // Resolution for any archive event: its own name first (many already match), then
  // the derived vote. Identical order to the page's.
  const resolve = (event) => venueOf(event) || (derived[event] && derived[event].venue) || null;

  // ── surface guard ────────────────────────────────────────────────────────────
  // Pool every resolved event by venue, per (surface, court) and per year, then keep
  // the era the RATING was taken in — the surface the venue was playing in its most
  // recent archive season, at or after abstractSpeedYear where the archive reaches
  // that far. Not the era with the most rows: see the header note on Stuttgart.
  const byVenue = new Map();
  for (const [event] of eventRows) {
    const venue = resolve(event);
    if (!venue) continue;
    if (!byVenue.has(venue)) byVenue.set(venue, new Map());
    const agg = byVenue.get(venue);
    for (const [sk, years] of eventSurface.get(event)) {
      if (!agg.has(sk)) agg.set(sk, new Map());
      for (const [y, n] of years) agg.get(sk).set(y, (agg.get(sk).get(y) || 0) + n);
    }
  }
  const surfaceGuard = {};
  let excludedRows = 0;
  for (const [venue, agg] of byVenue) {
    if (agg.size < 2) continue;
    const total = (years) => [...years.values()].reduce((s, n) => s + n, 0);
    const lastYear = (years) => Math.max(...years.keys());
    // the venue's latest season on record decides; ties on year fall back to volume
    const ranked = [...agg.entries()].sort((a, b) => (lastYear(b[1]) - lastYear(a[1])) || (total(b[1]) - total(a[1])));
    const [keepKey, keepYears] = ranked[0];
    const dropped = ranked.slice(1);
    excludedRows += dropped.reduce((s, d) => s + total(d[1]), 0);
    surfaceGuard[venue] = {
      keep: keepKey,
      keptRows: total(keepYears),
      ratingYear: CC[venue] ? CC[venue].abstractSpeedYear : null,
      keptThrough: lastYear(keepYears),
      drop: dropped.map(([sk, years]) => ({ key: sk, rows: total(years), lastSeen: lastYear(years) })),
    };
  }

  let resolvedRows = 0;
  let substringRows = 0;
  for (const [event, count] of eventRows) {
    if (venueOf(event)) substringRows += count;
    if (resolve(event)) resolvedRows += count;
  }

  // ─── TEN-206 §8.1 · the CAREER-SPINE half of the join ──────────────────────
  // Everything above resolves ARCHIVE (sponsor-shaped) event names, because the
  // Court speed modal used to count its bands off the priced archive. §8.1 moves
  // the bands onto the career match rows — the same spine Calendar and Streaks
  // use — so the modal now has to resolve API-TENNIS (host-city-shaped) names as
  // well, and it has to do it in the BROWSER, where neither canonicalTournament()
  // nor COURT_CONDITIONS exists.
  //
  // Rather than port the matcher client-side, the names are resolved HERE and
  // shipped as a plain dictionary. The page does a lookup and no matching, so
  // there is exactly one implementation of "which venue is this" and it is this
  // file. A name absent from `apiNames` is unbandable BY CONSTRUCTION — the page
  // dashes it and counts it out loud, never guesses.
  // The spine presents TWO name shapes and they are not the same strings.
  // `tournamentHistory` says "Mutua Madrid Open"; the career-history shard the
  // Calendar/Streaks/Court-speed spine is actually built from says "ATP Madrid".
  // Both are enumerated, so a dictionary lookup on either resolves.
  const apiSeen = new Set();
  for (const key of Object.keys(players)) {
    for (const t of players[key].tournamentHistory || []) {
      const raw = String(t.name || '').trim();
      if (raw) apiSeen.add(raw);
    }
  }
  // career-history/ is a RUNTIME artifact (gitignored, rebuilt each pipeline run),
  // so it is read when present and skipped when not. Absent, every career-history
  // name falls through to the page's direct-substring tier, which costs ~1.7pp of
  // Zverev's rows — a smaller, stated loss rather than a hard failure.
  let chNames = 0;
  const CH_DIR = path.join(ROOT, 'career-history');
  if (fs.existsSync(CH_DIR)) {
    for (const f of fs.readdirSync(CH_DIR)) {
      if (!f.endsWith('.json')) continue;
      let shard;
      try { shard = JSON.parse(fs.readFileSync(path.join(CH_DIR, f), 'utf8')); } catch (e) { continue; }
      for (const r of (shard.matches || shard || [])) {
        const raw = String((r && r.tournament) || '').trim();
        if (raw && !apiSeen.has(raw)) { apiSeen.add(raw); chNames += 1; }
      }
    }
  }

  const apiNames = {};
  for (const raw of apiSeen) {
    // Same precedence the archive half uses: direct/canonical substring first,
    // then the voted table. The voted table is keyed by archive name, but an
    // api-tennis name that happens to appear there resolves for free.
    const v = venueOf(raw) || (derived[raw] && derived[raw].venue) || null;
    if (v && CC[v]) apiNames[raw] = v;
  }
  const apiCoverage = {
    distinctNames: apiSeen.size,
    fromCareerHistory: chNames,
    careerHistoryPresent: fs.existsSync(CH_DIR),
    resolvedNames: Object.keys(apiNames).length,
    basis: 'api-tennis tournamentHistory + career-history name -> rated venue, same matcher as the archive half',
  };
  log(`api-tennis names   : ${apiCoverage.resolvedNames} of ${apiSeen.size} distinct resolve to a rated venue` +
      ` (${chNames} names came from career-history/${apiCoverage.careerHistoryPresent ? '' : ' — ABSENT'})`);

  const out = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: new Date().toISOString(),
    basis: 'archive event name -> rated venue, voted from (year, opponent) co-occurrence with api-tennis tournamentHistory',
    acceptance: { minVotes: MIN_VOTES, marginOverRunnerUp: MARGIN },
    ratingBasis: 'Tennis Abstract abstractSpeed, COURT_CONDITIONS (bsp-pipeline.js), one current reading per venue',
    coverage: {
      archiveRows,
      distinctEvents: eventRows.size,
      substringOnlyRows: substringRows,
      resolvedRows,
      resolvedPct: Math.round((resolvedRows / archiveRows) * 1000) / 10,
      excludedBySurfaceGuard: excludedRows,
      derivedEntries: Object.keys(derived).length,
      ambiguousEvents: ambiguous.length,
    },
    /** event name -> { venue, via, votes, runnerUp, rows } */
    events: derived,
    /** left unmapped ON PURPOSE — a shared name, not a missing one */
    ambiguous: ambiguous.sort((a, b) => b.rows - a.rows),
    /** venue -> which (surface, court) is banded and which eras are set aside */
    surfaceGuard,
    /** rated venue -> the reading the bands are cut from (§8.1, browser-side) */
    venues: Object.fromEntries(ccKeys.map((k) => [k, {
      speed: CC[k].abstractSpeed,
      ratingYear: CC[k].abstractSpeedYear || null,
    }])),
    /** api-tennis tournament name -> rated venue; an absent name cannot be banded */
    apiNames,
    apiCoverage,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1));

  log(`substring only     : ${substringRows} (${(100 * substringRows / archiveRows).toFixed(1)}%)`);
  log(`+ identity + voted : ${resolvedRows} (${out.coverage.resolvedPct}%)`);
  log(`derived ${Object.keys(derived).length} events, left ambiguous ${ambiguous.length}`);
  log(`surface guard excludes ${excludedRows} rows (${(100 * excludedRows / archiveRows).toFixed(2)}%) across ${Object.keys(surfaceGuard).length} venues`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { loadCourtConditions, makeVenueMatcher, MIN_VOTES, MARGIN };
