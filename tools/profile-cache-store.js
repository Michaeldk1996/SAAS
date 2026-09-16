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
    const gzStamp = stampOf(fromGz);
    const plainStamp = stampOf(fromPlain);
    if (fromPlain && plainStamp !== null && (gzStamp === null || plainStamp >= gzStamp)) {
      console.log(
        `hydrate: keeping restored ${pair.plain} (${countPlayers(fromPlain)} entries, ` +
        `fetchedAt ${fromPlain.fetchedAt}) — not older than committed ${pair.gz}.`
      );
      continue;
    }
    fs.writeFileSync(plainPath, JSON.stringify(fromGz));
    changed++;
    console.log(
      `hydrate: ${pair.plain} <- ${pair.gz} (${countPlayers(fromGz)} entries, ` +
      `fetchedAt ${fromGz.fetchedAt}); restored copy was ` +
      (fromPlain ? `older (${fromPlain.fetchedAt || 'unstamped'})` : 'absent') + '.'
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
    if (!force && committedStamp !== null && utcDay(committedStamp) === today) {
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
      `freeze: ${pair.gz} <- ${pair.plain} (${countPlayers(live)} entries, ` +
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

module.exports = { PAIRS, hydrate, freeze, stampOf, countPlayers, utcDay };
