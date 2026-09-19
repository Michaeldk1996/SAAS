#!/usr/bin/env node
'use strict';
/**
 * TEN-206 — durable home for historical-match-stats.json.
 * Founder ruling 2026-09-18 (Q2): "commit it back daily, same pattern as
 * player-profiles-cache.json.gz. A floor that drifts until an eviction halves
 * coverage isn't a floor."
 *
 * Founder ruling 2026-09-18 (Q1, follow-up): the committed floor is PLAIN MINIFIED
 * JSON, not gzip — "flat 5.3 MB/yr against 8.1–88.9, and git can delta it. 3.46 MB
 * uncompressed is fine. Predictable beats smaller-on-a-good-day." A gzip stream
 * cannot be delta-compressed past its first changed byte, so each daily refresh
 * commits a whole fresh blob and the yearly cost swings on whether that day's edits
 * happened to be a pure append. Plain JSON deltas either way.
 *
 * WHY THE FLOOR IS ITS OWN PATH and not simply the tracked
 * historical-match-stats.json. The Actions cache restores INTO that path before the
 * pipeline reads it (that clobber is the original bug this store exists to fix), so
 * a floor living at the same path would be overwritten before hydrate() could union
 * the two. Two paths is what makes "restored cache UNION committed floor" expressible
 * at all. Plain-vs-gzip was the founder's call; one-path-vs-two is forced.
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
 *   hydrate — before the pipeline runs. UNIONs the committed floor with whatever the
 *             Actions cache restored, entry by entry, keeping the DEEPER box score
 *             for each eventKey. Union, not replace: both copies are append-only
 *             views of the same population and taking either one whole throws away
 *             real requests.
 *   freeze  — after the deploy has published. Minifies to the committed floor.
 *
 * TWO GUARDS, AND BYTE-IDENTITY IS ONLY THE FIRST. freeze() writes minified with no
 * trailing newline, over numeric-like keys that V8 orders ascending and
 * deterministically, so a run that caches no new match reproduces the floor
 * byte-for-byte and git finds nothing to commit. Plain JSON makes that argument
 * shorter than gzip did — no compressor state or header left to reason about.
 *
 * ⚠️ That argument bounds the IDLE case ONLY, and this file previously concluded from
 * it that no day-guard was needed. That was wrong. The store changes on the ACTIVE
 * runs, and the pipeline fires ~150 times a day — measured from the sibling
 * commit-back bots, which land ~150 commits a day each. Re-measured at that cadence:
 *
 *     120 commits/day    plain   227 MB/yr     gz  6,207 MB/yr
 *       1 commit /day    plain   5.7 MB/yr     gz      7.6 MB/yr
 *
 * 227 MB/yr is over the founder's ~150 MB/yr line, and his ruling says "commit it
 * back DAILY". So the workflow's commit-back step carries a day-guard keyed on the
 * floor's own git commit date — see pipeline.yml. The stamp is deliberately NOT a
 * field inside the store: this file is keyed by eventKey, and a non-eventKey key
 * would pollute every consumer that walks Object.keys(), including the census, all
 * four guards below, and the page's own lookup.
 *
 * The plain-vs-gzip ordering is unchanged by any of this, and in fact widens: gzip
 * cannot be delta-compressed past its first changed byte, so it pays a full fresh
 * blob on every commit at any cadence.
 */

const fs = require('fs');
const path = require('path');

const PLAIN = 'historical-match-stats.json';
// The committed floor. Plain minified JSON per the founder's Q1 ruling, and on its
// own path because the Actions cache owns PLAIN — see the header note.
const FLOOR = 'historical-match-stats.floor.json';

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
  const [a, b] = sideDepths(matchStats);
  return a < 0 && b < 0 ? -1 : a + b;
}

/**
 * The SAME count, kept per player — and this, not depth(), is what the guards
 * compare.
 *
 * A single summed number is not safe as a merge currency: a sheet carrying 7 p1
 * fields and 0 p2 fields outranks one carrying 3 and 3, so an "upgrade" can wipe
 * a player's whole side while the total goes up. That is not hypothetical —
 * eventKey 12153350 is already in the store with an empty p2. Comparing the two
 * sides independently makes a merge an upgrade only when NEITHER side loses.
 *
 * Verified against the 2026 Challenger sweep before tightening: of its 469 real
 * upgrades, per-side gating would have blocked 0.
 */
function sideDepths(matchStats) {
  if (!matchStats) return [-1, -1];
  return ['p1', 'p2'].map((side) => {
    const s = matchStats[side];
    if (!s) return -1;
    let n = 0;
    for (const [k, v] of Object.entries(s)) {
      if (k === 'raw') continue;
      if (v != null) n++;
    }
    return n;
  });
}

// b is an acceptable replacement for a: neither player's side gets shallower.
function notShallower(a, b) {
  const [a1, a2] = sideDepths(a);
  const [b1, b2] = sideDepths(b);
  return b1 >= a1 && b2 >= a2;
}

// b is a strict upgrade on a: no side lost, at least one side gained.
function strictlyDeeper(a, b) {
  const [a1, a2] = sideDepths(a);
  const [b1, b2] = sideDepths(b);
  return b1 >= a1 && b2 >= a2 && (b1 > a1 || b2 > a2);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return null; }
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
  let sheet = 0, agg = 0, oneSided = 0;
  for (const k of keys) {
    const ms = store[k] && store[k].matchStats;
    if (!ms || !ms.p1) continue;
    sheet++;
    // BOTH sides. The first version of this counted ms.p1 only, which made it
    // structurally unable to see a sheet with an empty p2 — and one is already in
    // the store (eventKey 12153350, a Brownsburg qualifier the feed published for
    // one player). A coverage number that cannot go down when half a match goes
    // missing is not a coverage number.
    if (['p1', 'p2'].every((s) => ms[s] && AGG_FIELDS.every((f) => ms[s][f] != null))) agg++;
    if (!ms.p2 || Object.keys(ms.p2).length === 0) oneSided++;
  }
  const pct = (x) => (sheet ? `${((100 * x) / sheet).toFixed(1)}%` : '—');
  return `${keys.length} entries, ${sheet} with a sheet, agg ${pct(agg)}` +
    (oneSided ? `, ${oneSided} one-sided` : '');
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
    if (!cur || strictlyDeeper(cur && cur.matchStats, b[k] && b[k].matchStats)) out[k] = b[k];
  }
  return out;
}

// The URL the guard in pipeline.yml compares against. Same constant, same
// question: "is anything we have already served about to disappear?"
const LIVE_URL = 'https://michaeldk1996.github.io/SAAS/historical-match-stats.json';

/**
 * The DEPLOYED store, or null if it cannot be read.
 *
 * ⚠️ WHY THIS EXISTS. hydrate() unioned the committed floor with the restored
 * Actions cache and nothing else — so an eventKey that is LIVE but is in neither
 * (the harvest window rolled past it, and the floor is only refreshed once a
 * day) was simply absent from the build. `Assert site completeness` then refused
 * the deploy, correctly, because that key's box score would have vanished from
 * the page.
 *
 * MEASURED 2026-09-19: five consecutive pipeline runs (#3739, #3741, #3742,
 * #3746, #3748, #3750) failed exactly that way, each naming a DIFFERENT key
 * (12143895, then 12143247) while publishing a store LARGER than the floor
 * (2622/2134 against 2122/1747). Not a shrinking store — rolling churn. Every
 * unrelated change was stuck behind it.
 *
 * The fix is to make the publisher SATISFY the gate, not to weaken the gate.
 * mergeStores is union, upgrade-only, so folding the live store in can only ADD
 * an entry or deepen one; it can never drop or shallow anything. The gate is
 * untouched and is still the thing that would catch a real regression.
 *
 * FAILS OPEN. A network problem here must not turn a deploy red — the guard
 * downstream is the fail-closed half. 30 s, matching the guard's own timeout.
 */
async function readLive() {
  try {
    const r = await fetch(LIVE_URL, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    return d && typeof d === 'object' ? d : null;
  } catch (e) {
    console.log(`::warning title=match-stats live store unreadable::could not read the `
      + `deployed store (${e.message}); hydrating from floor + cache only. If a live `
      + `key has aged out of both, the completeness gate will refuse this deploy.`);
    return null;
  }
}

function hydrate(root) {
  const plainPath = path.join(root, PLAIN);
  const floorPath = path.join(root, FLOOR);
  const fromFloor = readJson(floorPath);
  if (!fromFloor) {
    // Loud, because the working path is gitignored: with no readable floor and no
    // warm Actions cache there is no box-score store at all, and the Player Profile
    // match sheet would publish blank rather than fail. Not fatal here (the deploy
    // must not go red on it) — the guard that must catch this is npm test, before
    // the commit.
    console.log(`::error title=match-stats floor unreadable::${FLOOR} is absent or corrupt — the match-stat store has no committed floor this run.`);
    return 0;
  }
  const fromPlain = readJson(plainPath);
  if (!fromPlain) {
    fs.writeFileSync(plainPath, JSON.stringify(fromFloor));
    console.log(`hydrate: ${PLAIN} <- ${FLOOR} (${census(fromFloor)}); nothing was restored.`);
    return 1;
  }
  const merged = mergeStores(fromFloor, fromPlain);
  fs.writeFileSync(plainPath, JSON.stringify(merged));
  console.log(
    `hydrate: ${PLAIN} = restored (${census(fromPlain)}) UNION committed ${FLOOR} ` +
    `(${census(fromFloor)}) -> ${census(merged)}.`
  );
  return 1;
}

// A refusal is a real event and must never read like an idle run. freeze() is
// invoked with `|| true` in CI (it may not cost a deploy), so the only channel
// left is the annotation — bare console.log made "coverage tried to go backwards"
// and "nothing changed today" look identical in the log.
function refuse(reason) {
  console.log(`::error title=match-stats floor refused::${reason}`);
  return 0;
}

function freeze(root, opts) {
  const bootstrap = !!(opts && opts.bootstrap);
  const plainPath = path.join(root, PLAIN);
  const floorPath = path.join(root, FLOOR);
  const live = readJson(plainPath);
  if (!live) {
    console.log(`freeze: ${PLAIN} absent or unreadable — nothing to freeze.`);
    return 0;
  }
  const committed = readJson(floorPath);

  // NO FLOOR = REFUSE, unless explicitly bootstrapping. Every guard below is a
  // comparison against the committed floor, so a missing or corrupt floor used to
  // skip all of them — and that is exactly the state in which the live store is
  // least trustworthy. The full path: unreadable floor -> hydrate writes no plain
  // file -> the pipeline starts from {} and caches only today's board -> freeze
  // commits those few entries as the new floor, permanently. Refusing leaves the
  // floor broken (loudly, and npm test fails on it) instead of destroying it.
  //
  // "Corrupt" survives the format change. Plain JSON cannot fail to gunzip, but it
  // can still be truncated by a killed writer or mangled by a bad merge resolution,
  // and readJson() returns null on exactly that — so this guard has the same teeth
  // it had against a corrupt .gz.
  if (!committed) {
    if (!bootstrap) {
      return refuse(`${FLOOR} is absent or corrupt. Refusing to mint a new floor from the live store — an unreadable floor is when the live store is least trustworthy. Re-run with --bootstrap if this store really is the first one.`);
    }
    console.log(`freeze: no committed floor and --bootstrap given — minting one from ${PLAIN}.`);
  }

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
      return refuse(
        `live store has FEWER entries (${liveN}) than the committed floor (${commN}). ` +
        `The cache is append-only, so this is a broken hydrate, not a legitimate shrink.`
      );
    }
    // Containment guard. Counting is not the same as containing: a store that drops
    // one key and adds another is the same size and has silently lost a match. The
    // 354 recorded provider-misses here are the easiest to lose that way, because a
    // missing key and a `matchStats:null` key both score -1 on any depth comparison
    // and so slip past the depth guard below.
    const lost = Object.keys(committed).filter((k) => !(k in live));
    if (lost.length) {
      return refuse(
        `${lost.length} eventKey(s) present in the committed floor are MISSING from the ` +
        `live store (e.g. ${lost.slice(0, 3).join(', ')}). The floor may not lose a match.`
      );
    }
    // Depth guard, the shrink guard's other half. An equal-sized store can still be
    // strictly worse: re-running the per-match path over keys the tier sweep had
    // already deepened would rewrite sheets with shallower ones at the same count.
    // Compared PER SIDE — see sideDepths(); a summed depth lets one player's whole
    // side be wiped as long as the other side gained more.
    const shallower = Object.keys(committed).filter(
      (k) => !notShallower(committed[k] && committed[k].matchStats, live[k] && live[k].matchStats)
    );
    if (shallower.length) {
      return refuse(
        `${shallower.length} entr(ies) are SHALLOWER than the committed floor on at least ` +
        `one player's side (e.g. ${shallower.slice(0, 3).join(', ')}). Coverage may not go ` +
        `backwards; run hydrate first.`
      );
    }
  }

  // Minified, with no trailing newline: identical content must produce identical
  // bytes so git sees no change on a run that cached no new match. This is the
  // once-a-day guard, and it is the whole reason freeze() re-serialises instead of
  // copying the working file — bsp-pipeline.js writes that one pretty-printed.
  const buf = Buffer.from(JSON.stringify(live), 'utf8');
  fs.writeFileSync(floorPath, buf);
  console.log(`freeze: ${FLOOR} <- ${PLAIN} (${census(live)}, ${(buf.length / 1e6).toFixed(3)} MB).`);
  return 1;
}

/**
 * hydrate(), then UNION the deployed store on top. Separate from hydrate() so
 * the synchronous, network-free path stays testable exactly as it was.
 */
async function hydrateWithLive(root) {
  const rc = hydrate(root);
  if (!rc) return rc;                      // no floor: hydrate already said so
  const live = await readLive();
  if (!live) return rc;
  const plainPath = path.join(root, PLAIN);
  const cur = readJson(plainPath);
  if (!cur) return rc;
  const merged = mergeStores(cur, live);
  const before = Object.keys(cur).length, after = Object.keys(merged).length;
  fs.writeFileSync(plainPath, JSON.stringify(merged));
  console.log(`hydrate: UNION deployed store (${census(live)}) -> ${census(merged)}; `
    + `${after - before} key(s) recovered that had aged out of both the floor and the cache.`);
  return 1;
}

if (require.main === module) {
  const cmd = process.argv[2];
  const root = process.env.MATCH_STATS_ROOT || process.cwd();
  // The workflow runs both with `|| true`, so the exit code is advisory rather than
  // fatal — but it is still the difference between "nothing to do" and "I refused",
  // and a later caller that drops the `|| true` gets the right behaviour for free.
  if (cmd === 'hydrate') { hydrateWithLive(root).then(rc => { process.exitCode = rc ? 0 : 1; }); }
  else if (cmd === 'freeze') process.exitCode = freeze(root, { bootstrap: process.argv.includes('--bootstrap') }) ? 0 : 1;
  else { console.error('usage: match-stats-store.js <hydrate|freeze> [--bootstrap]'); process.exit(2); }
}

module.exports = { PLAIN, FLOOR, LIVE_URL, depth, sideDepths, notShallower, strictlyDeeper, census, mergeStores, hydrate, hydrateWithLive, readLive, freeze };
