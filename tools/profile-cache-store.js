#!/usr/bin/env node
'use strict';
/**
 * TEN-206 — durable home for the player-profile caches.
 * Founder ruling Q2(d) ch-1, 2026-09-16: "key per day + commit one gzipped file daily."
 *
 * WHY THIS EXISTS
 * ---------------
 * player-profiles-cache.json was already tracked in git — 57.4 MB of pretty-printed
 * JSON, last committed 2026-07-22, holding 467 players at schema v7 with 95 shells
 * (no careerByYear) and every entry 56 days past its 14-day TTL. CI restores the
 * Actions cache over it, so nobody noticed; but the moment that cache misses (LRU
 * eviction at the 10 GiB repo ceiling, or a 7-day idle expiry) the checkout's July
 * copy IS what the pipeline builds from and publishes. The committed copy is not a
 * spare — it is the floor, and the floor had rotted.
 *
 * So the durable copy stays in git, but it is (a) gzipped and minified rather than
 * 57 MB pretty, and (b) refreshed once a day by the pipeline instead of by hand.
 *
 * TWO SUBCOMMANDS
 *   hydrate  — before the pipeline runs. Picks the NEWER of {restored Actions cache,
 *              committed .gz} by fetchedAt and leaves it at the plain path. Without
 *              the comparison a stale warm cache would shadow a freshly committed
 *              rebuild for up to 14 days.
 *   freeze   — after the pipeline runs. Minifies + gzips (-n, no mtime header, so
 *              identical content produces an identical blob) and rewrites the .gz
 *              ONLY if the committed copy's fetchedAt is from an earlier UTC day.
 *              That day-guard is what makes it one commit per day rather than one
 *              per 10-minute run: the content changes every run (seed profiles are
 *              rebuilt with a fresh builtAt each time), so "commit if changed" alone
 *              would commit ~144 times a day.
 *
 * Both are best-effort by design: a missing or corrupt .gz warns and leaves whatever
 * the Actions cache restored. Neither may ever be the reason a deploy goes red —
 * the fail-closed roster gate (tools/test-roster-gate.js) is what stops a bad
 * roster, and it works off the built artifact, not off this store.
 */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// The pairs we keep. Plain path is what bsp-pipeline.js reads/writes; .gz is the
// committed durable copy.
const PAIRS = [
  { plain: 'player-profiles-cache.json', gz: 'player-profiles-cache.json.gz' },
  { plain: 'player-tournament-history.json', gz: 'player-tournament-history.json.gz' },
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function readGzJson(file) {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  } catch (err) {
    return null;
  }
}

// Every store we keep carries a top-level fetchedAt stamp. A file without one is
// treated as infinitely old so that anything stamped beats it — never the reverse,
// which would let an unstamped blob win by accident.
function stampOf(obj) {
  const s = obj && typeof obj === 'object' ? obj.fetchedAt : null;
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function countPlayers(obj) {
  const players = obj && obj.players && typeof obj.players === 'object' ? obj.players : null;
  return players ? Object.keys(players).length : (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);
}

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Schema-version census, so a store's QUALITY is visible in the run log and not just
// its entry count. 493 entries is not automatically better than 470 — measured
// 2026-09-16, the first CI run under this store kept a 493-entry warm cache over the
// 470-entry v14 floor purely on age, and nothing in the log said what those 493 were.
function census(obj) {
  const players = (obj && obj.players) || {};
  const byVersion = {};
  let shells = 0;
  for (const k of Object.keys(players)) {
    const e = players[k];
    const v = e && e.v !== undefined ? e.v : 'none';
    byVersion[v] = (byVersion[v] || 0) + 1;
    if (e && e.profile && !e.profile.careerByYear) shells++;
  }
  const parts = Object.keys(byVersion).sort().map((v) => `v${v}:${byVersion[v]}`);
  return `${Object.keys(players).length} entries [${parts.join(' ')}] shells:${shells}`;
}

// Highest numeric schema version present in a store, or null if it has none.
// Non-numeric / absent `v` is ignored rather than coerced: an unversioned entry
// is not evidence of any version.
function maxSchemaVersion(obj) {
  const players = (obj && obj.players) || {};
  let max = null;
  for (const k of Object.keys(players)) {
    const v = players[k] && players[k].v;
    if (typeof v === 'number' && Number.isFinite(v) && (max === null || v > max)) max = v;
  }
  return max;
}

// SCHEMA DRIFT — the live store carries a version the committed floor does not.
//
// TEN-243, founder-authorised 2026-09-21. The once-per-UTC-day guard below is
// there so an idle day does not churn the committed blob. After a schema bump it
// does something else entirely: the last PRE-bump run claims the day's stamp, so
// the run that actually builds the new schema cannot commit any of it, and every
// run for the rest of the day re-hydrates the old floor, rejects all of it, and
// rebuilds from scratch. Measured twice on the v14 -> v15 bump — runs 4057 and
// 4059 hydrated the identical `660 entries [v14:660]` and wrote 560 then 561.
// That is a stall, not a slow convergence.
//
// So a day-stamp does not hold back a version advance. The condition is read
// from the DATA on both sides — no flag, no hand-set argument, nothing to leave
// on — and it is strictly one-way: it fires only when live is AHEAD of committed,
// never on a downgrade.
function schemaDrift(live, committed) {
  const liveMax = maxSchemaVersion(live);
  const committedMax = maxSchemaVersion(committed);
  if (liveMax === null) return null;                       // nothing to advance to
  if (committedMax !== null && liveMax <= committedMax) return null;
  return { liveMax, committedMax };
}

// Per-entry comparison. A profile built by NEWER code wins outright — that is what
// PROFILE_SCHEMA_VERSION exists to say, and an old-schema entry serves numbers from a
// superseded formula however recently it was touched. Only within one version does
// recency decide.
function betterEntry(a, b) {
  if (!a) return b;
  if (!b) return a;
  const va = typeof a.v === 'number' ? a.v : -1;
  const vb = typeof b.v === 'number' ? b.v : -1;
  if (va !== vb) return va > vb ? a : b;
  const ta = Date.parse(a.builtAt || '') || 0;
  const tb = Date.parse(b.builtAt || '') || 0;
  return ta >= tb ? a : b;
}

// UNION, not replace. Both stores are append-only views of the same population, so
// taking one whole and discarding the other throws away real work: on 2026-09-16 the
// committed floor held a 470-player v14 rebuild that cost 2,360 api-tennis requests,
// and CI's warm cache was newer by five minutes. Age alone would have discarded the
// rebuild the next morning. Merging cannot lose an entry and cannot downgrade one.
function mergeStores(a, b) {
  const pa = (a && a.players) || {};
  const pb = (b && b.players) || {};
  const players = {};
  for (const k of Object.keys(pa)) players[k] = pa[k];
  for (const k of Object.keys(pb)) players[k] = betterEntry(players[k], pb[k]);
  const stamps = [stampOf(a), stampOf(b)].filter((s) => s !== null);
  return {
    fetchedAt: stamps.length ? new Date(Math.max.apply(null, stamps)).toISOString() : undefined,
    players,
  };
}

function hydrate(root) {
  let changed = 0;
  for (const pair of PAIRS) {
    const plainPath = path.join(root, pair.plain);
    const gzPath = path.join(root, pair.gz);
    const fromGz = readGzJson(gzPath);
    if (!fromGz) {
      console.log(`hydrate: ${pair.gz} absent or unreadable — leaving ${pair.plain} as restored.`);
      continue;
    }
    const fromPlain = readJson(plainPath);
    if (!fromPlain) {
      fs.writeFileSync(plainPath, JSON.stringify(fromGz));
      changed++;
      console.log(`hydrate: ${pair.plain} <- ${pair.gz} (${census(fromGz)}); nothing was restored.`);
      continue;
    }
    const merged = mergeStores(fromGz, fromPlain);
    fs.writeFileSync(plainPath, JSON.stringify(merged));
    changed++;
    console.log(
      `hydrate: ${pair.plain} = restored (${census(fromPlain)}) ` +
      `UNION committed ${pair.gz} (${census(fromGz)}) -> ${census(merged)}.`
    );
  }
  return changed;
}

function freeze(root, opts) {
  const force = !!(opts && opts.force);
  const today = utcDay(Date.now());
  let written = 0;
  for (const pair of PAIRS) {
    const plainPath = path.join(root, pair.plain);
    const gzPath = path.join(root, pair.gz);
    const live = readJson(plainPath);
    if (!live) {
      console.log(`freeze: ${pair.plain} absent or unreadable — nothing to freeze.`);
      continue;
    }
    const liveStamp = stampOf(live);
    if (liveStamp === null) {
      console.log(`freeze: ${pair.plain} carries no fetchedAt — refusing to freeze an unstamped store.`);
      continue;
    }
    const committed = readGzJson(gzPath);
    const committedStamp = stampOf(committed);
    const drift = schemaDrift(live, committed);
    if (drift) {
      console.log(
        `freeze: ${pair.gz} SCHEMA DRIFT — live carries v${drift.liveMax}, committed floor is at ` +
        `${drift.committedMax === null ? 'no version' : 'v' + drift.committedMax}. Overriding the ` +
        `once-per-UTC-day guard: holding the floor at the old schema for the rest of the day is the ` +
        `stall, not a saving.`
      );
    }
    if (!force && !drift && committedStamp !== null && utcDay(committedStamp) === today) {
      console.log(`freeze: ${pair.gz} already carries today's stamp (${utcDay(committedStamp)}) — skipping (one per UTC day).`);
      continue;
    }
    if (committedStamp !== null && liveStamp < committedStamp) {
      console.log(
        `freeze: refusing to overwrite ${pair.gz} — committed copy (${committed.fetchedAt}) ` +
        `is NEWER than the live one (${live.fetchedAt}).`
      );
      continue;
    }
    // Shrink guard. bsp-pipeline.js only ever ADDS to cachedPlayers (it loads the
    // whole file and never deletes a key), so the live store is monotone and a
    // smaller one means the chain broke upstream — almost certainly a hydrate that
    // failed, leaving the pipeline to start from {} and rebuild only today's board.
    // Without this, one bad run would quietly cut the committed floor from 470
    // players to ~137 and the next cache miss would inherit the cut.
    if (committed !== null) {
      const liveCount = countPlayers(live);
      const committedCount = countPlayers(committed);
      if (liveCount < committedCount) {
        console.log(
          `freeze: refusing to overwrite ${pair.gz} — live store has FEWER entries ` +
          `(${liveCount}) than the committed floor (${committedCount}). The cache is ` +
          `append-only, so this is a broken hydrate, not a legitimate shrink.`
        );
        continue;
      }
    }
    // -n: no mtime/name in the gzip header, so identical content hashes identically
    // and git sees no change on a genuinely idle day.
    const buf = zlib.gzipSync(Buffer.from(JSON.stringify(live), 'utf8'), { level: 9 });
    fs.writeFileSync(gzPath, buf);
    written++;
    console.log(
      `freeze: ${pair.gz} <- ${pair.plain} (${census(live)}, ` +
      `fetchedAt ${live.fetchedAt}, ${(buf.length / 1e6).toFixed(2)} MB gzipped).`
    );
  }
  return written;
}

if (require.main === module) {
  const cmd = process.argv[2];
  const root = process.env.PROFILE_CACHE_ROOT || process.cwd();
  if (cmd === 'hydrate') {
    hydrate(root);
  } else if (cmd === 'freeze') {
    freeze(root, { force: process.argv.includes('--force') });
  } else {
    console.error('usage: profile-cache-store.js <hydrate|freeze> [--force]');
    process.exit(2);
  }
}

module.exports = { PAIRS, hydrate, freeze, stampOf, countPlayers, utcDay, maxSchemaVersion, schemaDrift };
