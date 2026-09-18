#!/usr/bin/env node
'use strict';
/**
 * TEN-206 — durable home for historical-match-stats.json.
 * Founder ruling 2026-09-18 (Q2): "commit it back gzipped daily, same pattern as
 * player-profiles-cache.json.gz. A floor that drifts until an eviction halves
 * coverage isn't a floor."
 *
 * WHY THIS EXISTS
 * ---------------
 * historical-match-stats.json is the Player Profile match-sheet's box-score store.
 * It was tracked in git but NEVER committed back, so the tracked copy was a fossil
 * floor: on 2026-09-18 it held 1,082 entries against the 2,002 actually deployed.
 * The Actions cache hid that — until the repo hit its 10 GiB ceiling and an LRU
 * eviction meant the run rebuilt from the fossil and the page's stat coverage
 * silently halved. Pinning the cache key to the file's content hash (pipeline.yml)
 * fixed the shadowing half; this fixes the drift half.
 *
 * TWO SUBCOMMANDS, mirroring tools/profile-cache-store.js
 *   hydrate — before the pipeline runs. UNIONs the committed .gz with whatever the
 *             Actions cache restored, entry by entry, keeping the DEEPER box score
 *             for each eventKey. Union, not replace: both copies are append-only
 *             views of the same population and taking either one whole throws away
 *             real requests.
 *   freeze  — after the deploy has published. Minifies + gzips to the committed .gz.
 *
 * NO DAY-GUARD, ON PURPOSE. profile-cache-store.js needs one because seed profiles
 * are rebuilt with a fresh builtAt every run, so its content differs on all ~144
 * runs a day and "commit if changed" would commit ~144 times. This store has no
 * such stamp: bsp-pipeline.js writes it with JSON.stringify over numeric-like keys
 * (V8 orders those ascending, deterministically), so a run that caches no new match
 * reproduces the file byte-for-byte. With gzip written at level 9 and no mtime
 * header, an idle run therefore produces an IDENTICAL blob and git finds nothing to
 * commit. The content is the guard. Measured cost of the resulting ~340 commits a
 * year: 8.1 MB/yr when days are pure-append, 88.9 MB/yr in the pessimistic case
 * where each day also scatters edits through the file (a gzip stream cannot be
 * delta-compressed past its first changed byte). Both are inside the founder's
 * ~150 MB/yr line; see the TEN-206 report for the plain-minified alternative,
 * which measures 5.3 MB/yr in BOTH cases.
 */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const PLAIN = 'historical-match-stats.json';
const GZ = 'historical-match-stats.json.gz';

/**
 * How much box score an entry actually carries — the merge currency.
 *
 * Counts populated leaf fields across BOTH players and deliberately ignores the
 * `raw` sub-object, which is re-derived from the same feed rows and would double
 * count. `null` scores -1 so that a recorded provider-miss is strictly below an
 * empty-but-present sheet and can always be upgraded.
 *
 * Exported because tools/backfill-match-stats-sweep.js merges with the identical
 * rule. Two copies of a comparison like this is how one of them silently starts
 * letting coverage go backwards.
 */
function depth(matchStats) {
  if (!matchStats) return -1;
  let n = 0;
  for (const side of ['p1', 'p2']) {
    const s = matchStats[side];
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (k === 'raw') continue;
      if (v != null) n++;
    }
  }
  return n;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return null; }
}

function readGzJson(file) {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); } catch (err) { return null; }
}

// Coverage census, so the store's QUALITY shows in the run log and not just its
// entry count. A 2,002-entry store where 354 are recorded provider-misses is not
// the same artifact as a 2,002-entry store where 1,648 are — and only one of those
// two numbers moving is what a backfill is supposed to prove.
const AGG_FIELDS = [
  'Points:Service Points Won', 'Points:Return Points Won',
  'Games:Service games won', 'Games:Return games won',
];
function census(store) {
  const keys = Object.keys(store || {});
  let sheet = 0, agg = 0;
  for (const k of keys) {
    const ms = store[k] && store[k].matchStats;
    if (!ms || !ms.p1) continue;
    sheet++;
    if (AGG_FIELDS.every((f) => ms.p1[f] != null)) agg++;
  }
  const pct = (x) => (sheet ? `${((100 * x) / sheet).toFixed(1)}%` : '—');
  return `${keys.length} entries, ${sheet} with a sheet, agg ${pct(agg)}`;
}

/**
 * UNION, upgrade-only. Cannot lose an eventKey and cannot shallow one: for every
 * key present in either store the deeper sheet wins, ties go to the incumbent.
 */
function mergeStores(a, b) {
  const out = {};
  for (const k of Object.keys(a || {})) out[k] = a[k];
  for (const k of Object.keys(b || {})) {
    const cur = out[k];
    if (!cur || depth(b[k] && b[k].matchStats) > depth(cur && cur.matchStats)) out[k] = b[k];
  }
  return out;
}

function hydrate(root) {
  const plainPath = path.join(root, PLAIN);
  const gzPath = path.join(root, GZ);
  const fromGz = readGzJson(gzPath);
  if (!fromGz) {
    // Loud, because the plain file is gitignored: with no readable .gz and no warm
    // Actions cache there is no box-score store at all, and the Player Profile match
    // sheet would publish blank rather than fail. Not fatal here (the deploy must not
    // go red on it) — the guard that must catch this is npm test, before the commit.
    console.log(`::error title=match-stats floor unreadable::${GZ} is absent or corrupt — the match-stat store has no committed floor this run.`);
    return 0;
  }
  const fromPlain = readJson(plainPath);
  if (!fromPlain) {
    fs.writeFileSync(plainPath, JSON.stringify(fromGz));
    console.log(`hydrate: ${PLAIN} <- ${GZ} (${census(fromGz)}); nothing was restored.`);
    return 1;
  }
  const merged = mergeStores(fromGz, fromPlain);
  fs.writeFileSync(plainPath, JSON.stringify(merged));
  console.log(
    `hydrate: ${PLAIN} = restored (${census(fromPlain)}) UNION committed ${GZ} ` +
    `(${census(fromGz)}) -> ${census(merged)}.`
  );
  return 1;
}

function freeze(root) {
  const plainPath = path.join(root, PLAIN);
  const gzPath = path.join(root, GZ);
  const live = readJson(plainPath);
  if (!live) {
    console.log(`freeze: ${PLAIN} absent or unreadable — nothing to freeze.`);
    return 0;
  }
  const committed = readGzJson(gzPath);

  // Shrink guard. The pipeline only ever ADDS keys to this cache (it loads the whole
  // file and never deletes one), so the live store is monotone and a smaller one means
  // the chain broke upstream — almost certainly a hydrate that failed, leaving the run
  // to start from {} and cache only today's board. Without this, one bad run cuts the
  // committed floor and the next cache miss inherits the cut. That is precisely the
  // failure this whole store exists to stop, so it must not be reintroducible by it.
  if (committed) {
    const liveN = Object.keys(live).length;
    const commN = Object.keys(committed).length;
    if (liveN < commN) {
      console.log(
        `freeze: refusing to overwrite ${GZ} — live store has FEWER entries (${liveN}) ` +
        `than the committed floor (${commN}). The cache is append-only, so this is a ` +
        `broken hydrate, not a legitimate shrink.`
      );
      return 0;
    }
    // Depth guard, the shrink guard's other half. An equal-sized store can still be
    // strictly worse: re-running the per-match path over keys the tier sweep had
    // already deepened would rewrite sheets with shallower ones at the same count.
    let shallower = 0;
    for (const k of Object.keys(committed)) {
      if (depth(live[k] && live[k].matchStats) < depth(committed[k] && committed[k].matchStats)) shallower++;
    }
    if (shallower > 0) {
      console.log(
        `freeze: refusing to overwrite ${GZ} — ${shallower} entr(ies) are SHALLOWER than ` +
        `the committed floor. Coverage may not go backwards; run hydrate first.`
      );
      return 0;
    }
  }

  // level 9 + no mtime header, so identical content hashes identically and git sees
  // no change on a run that cached no new match. This is the once-a-day guard.
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(live), 'utf8'), { level: 9 });
  fs.writeFileSync(gzPath, buf);
  console.log(`freeze: ${GZ} <- ${PLAIN} (${census(live)}, ${(buf.length / 1e6).toFixed(3)} MB gzipped).`);
  return 1;
}

if (require.main === module) {
  const cmd = process.argv[2];
  const root = process.env.MATCH_STATS_ROOT || process.cwd();
  if (cmd === 'hydrate') hydrate(root);
  else if (cmd === 'freeze') freeze(root);
  else { console.error('usage: match-stats-store.js <hydrate|freeze>'); process.exit(2); }
}

module.exports = { PLAIN, GZ, depth, census, mergeStores, hydrate, freeze };
