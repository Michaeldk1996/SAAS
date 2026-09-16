// TEN-207 — tournamentHistory lazy-shard split: regression lock.
//
// tournamentHistory was HALF of player-profiles.json (measured 2026-09-16:
// 5.67 MB of 11.24 MB across 428 players; 1359 KB -> 658 KB gzipped on the eager
// path). It now ships as one shard per player, fetched on profile open.
//
// METHOD — this harness locks the four things that would break SILENTLY, i.e.
// the site keeps rendering and nothing complains:
//
//   1. NON-MUTATING publish. The lite view must not strip the field off the
//      in-memory store: backfillMatchesTournamentHistory() runs AFTER the write
//      and reads playerProfiles.players. A `delete` there would empty the
//      Today's-Matches embedded histories with no error anywhere.
//   2. The field actually leaves the published file. If a later edit reverts the
//      write to the full object the site works perfectly — we just pay the
//      ~700 KB again, forever, unnoticed.
//   3. The client fetch path MATCHES the builder's output path. A mismatch is a
//      404 per player: the record card just stays empty, which is visually
//      identical to a player with no history. (This repo has shipped that exact
//      class before — a new file 404ing live while every test passed.)
//   4. The H2H page can SEE the shard cache. _tourHistShards is a main-script
//      `const`, so it is not on window; the H2H IIFE reads it through the
//      __h2hEnv getter bridge. Without the bridge entry the lookup throws /
//      returns undefined and h2hFromHist — the only source of pre-2021 meetings
//      — renders "never met" for pairs that have met.
//
// Run: node tools/test-tournament-history-shards.js   (wired into `npm test`)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const checks = [];
const ok = (name) => checks.push(name);

// ── lift · the builder, executed for real in a scratch cwd ───────────────────
const pipeline = require(path.join(ROOT, 'bsp-pipeline.js'));
const { writeTournamentHistoryShards, profilesWithoutTournamentHistory } = pipeline;
assert.ok(typeof writeTournamentHistoryShards === 'function',
  'bsp-pipeline.js must export writeTournamentHistoryShards');
assert.ok(typeof profilesWithoutTournamentHistory === 'function',
  'bsp-pipeline.js must export profilesWithoutTournamentHistory');

const HIST = (name, year, rounds) => ({
  name, lastYear: year, won: rounds.filter(r => r.res === 'W').length,
  lost: rounds.filter(r => r.res === 'L').length,
  editions: [{ year, matches: rounds }],
});
const fixture = () => ({
  tourAverage: { dna: {}, stats: {} },
  players: {
    // two tournaments / three match rows
    '101': { key: 101, name: 'A. Player', tournamentHistory: [
      HIST('Wimbledon', 2023, [{ res: 'W', round: 'R32', opp: 'X', oppKey: '9' }, { res: 'L', round: 'R16', opp: 'Y', oppKey: '8' }]),
      HIST('US Open', 2022, [{ res: 'W', round: 'F', opp: 'Z', oppKey: '7' }]),
    ] },
    // one tournament / one row
    '102': { key: 102, name: 'B. Player', tournamentHistory: [
      HIST('Miami', 2024, [{ res: 'L', round: 'R64', opp: 'Q', oppKey: '6' }]),
    ] },
    // no history at all — must get NO shard and NO index entry
    '103': { key: 103, name: 'C. Player', tournamentHistory: [] },
    '104': { key: 104, name: 'D. Player' },
  },
});

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ten207-'));
const cwd0 = process.cwd();
let index, lite, store;
try {
  process.chdir(scratch);
  store = fixture();
  index = writeTournamentHistoryShards(store.players, {});
  lite = profilesWithoutTournamentHistory(store);

  // ── 1 · shards written, one per player WITH history, and only those ────────
  const written = fs.readdirSync(path.join(scratch, 'tournament-history')).sort();
  assert.deepStrictEqual(written, ['101.json', '102.json'],
    `expected shards for 101 and 102 only, got ${written.join(', ')}`);
  ok('one shard per player with history; none for players without');

  // Shard CONTENT round-trips the rows — not just "a file exists".
  const s101 = JSON.parse(fs.readFileSync(path.join(scratch, 'tournament-history', '101.json'), 'utf8'));
  assert.strictEqual(s101.key, '101');
  assert.deepStrictEqual(s101.tournamentHistory, fixture().players['101'].tournamentHistory,
    'shard must carry the tournamentHistory rows verbatim');
  ok('shard round-trips the rows verbatim');

  // ── 2 · the index counts match the data (it drives the header count) ───────
  assert.deepStrictEqual(index, { '101': { n: 2, m: 3 }, '102': { n: 1, m: 1 } },
    `index must count tournaments (n) and match rows (m); got ${JSON.stringify(index)}`);
  const onDisk = JSON.parse(fs.readFileSync(path.join(scratch, 'tournament-history-index.json'), 'utf8'));
  assert.deepStrictEqual(onDisk.players, index, 'written index must equal the returned index');
  ok('index n/m recomputed from the rows, and matches what is written');

  // ── 3 · NON-MUTATING: the source store still carries the field ─────────────
  // This is the trap. writeCareerHistoryShards may `delete` its carrier because
  // nothing reads careerMatches afterwards; backfillMatchesTournamentHistory
  // DOES read this one, after the write.
  assert.ok(Array.isArray(store.players['101'].tournamentHistory)
    && store.players['101'].tournamentHistory.length === 2,
    'writeTournamentHistoryShards must NOT strip tournamentHistory off the in-memory store');
  ok('builder is non-mutating (later in-process readers still see the field)');

  // ── 4 · the published view really sheds it, and keeps everything else ──────
  const stillCarrying = Object.keys(lite.players).filter(k => lite.players[k].tournamentHistory !== undefined);
  assert.deepStrictEqual(stillCarrying, [],
    `lite profiles must not carry tournamentHistory; ${stillCarrying.join(', ')} still do`);
  assert.strictEqual(lite.players['101'].name, 'A. Player', 'lite view must keep every other field');
  assert.deepStrictEqual(lite.tourAverage, { dna: {}, stats: {} }, 'lite view must keep top-level siblings');
  assert.ok(store.players['101'].tournamentHistory, 'profilesWithoutTournamentHistory must not mutate its input');
  ok('published view sheds tournamentHistory and nothing else');

  // ── 5 · the split actually saves bytes (the whole point of the ticket) ─────
  const fullBytes = Buffer.byteLength(JSON.stringify(store));
  const liteBytes = Buffer.byteLength(JSON.stringify(lite));
  assert.ok(liteBytes < fullBytes, 'lite view must be smaller than the full store');
  ok(`lite view is smaller (${fullBytes} -> ${liteBytes} bytes on the fixture)`);
} finally {
  process.chdir(cwd0);
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ── 6 · client fetch path == builder output path (the silent-404 class) ──────
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const shardFetch = html.match(/fetch\(`\.\/([a-z-]+)\/\$\{pk\}\.json`/g) || [];
assert.ok(shardFetch.some(m => m.includes('tournament-history/')),
  'dashboard must fetch ./tournament-history/${pk}.json — the dir bsp-pipeline.js writes');
assert.ok(/fetch\('\.\/tournament-history-index\.json'/.test(html),
  'dashboard must fetch ./tournament-history-index.json');
ok('client fetch paths match the builder output paths');

// The index must be loaded with the other heavy datasets, or tourHistCount() is
// always 0 and the record card reads "0 on record" for every player forever.
assert.ok(/const loadHeavyDatasets = \(\) => \{[^}]*loadTourHistIndex\(\)/.test(html),
  'loadTourHistIndex() must be called from loadHeavyDatasets()');
ok('index is loaded on startup with the other heavy datasets');

// ── 7 · the __h2hEnv bridge exposes the shard cache to the H2H IIFE ──────────
const envLine = (html.match(/window\.__h2hEnv = \{[^\n]*\};/) || [''])[0];
assert.ok(/tourHistShards:\s*\(\)\s*=>\s*_tourHistShards/.test(envLine),
  '__h2hEnv must expose tourHistShards — _tourHistShards is a main-script const, '
  + 'invisible to the H2H IIFE without the bridge, and h2hFromHist() is the only '
  + 'source of pre-2021 meetings');
assert.ok(/DV\('tourHistShards'\)/.test(html),
  'the H2H adapter must read the cache through DV(), not by touching the const directly');
ok('H2H reads the shard cache through the __h2hEnv bridge');

// ── 8 · pending is distinguishable from empty (no false "no record" copy) ────
// EXECUTE the two predicates rather than grepping for them. A source-text check
// here passed against `if (false && ppCareerHistoryPending(p))` during the
// mutation run — the identifier was still in the right place, so the ordering
// regex was satisfied while the guard was dead. Run the real bytes instead.
const liftFn = (name) => {
  const m = html.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `could not lift ${name}() out of the dashboard — the harness is stale`);
  return m[0];
};
const sandbox = { _tourHistShards: {}, _index: {} };
sandbox.tourHistCount = (k) => (sandbox._index[String(k)] || {}).n || 0;
// eslint-disable-next-line no-new-func
new Function('env', `with (env) { ${liftFn('ppCareerHistory')} ${liftFn('ppCareerHistoryPending')}
  env.ppCareerHistory = ppCareerHistory; env.ppCareerHistoryPending = ppCareerHistoryPending; }`)(sandbox);
const { ppCareerHistory, ppCareerHistoryPending } = sandbox;

const P = { key: 101, name: 'A. Player' };
// (a) index says 2 tournaments, shard not back yet -> PENDING, and no rows.
sandbox._index = { '101': { n: 2, m: 3 } }; sandbox._tourHistShards = {};
assert.strictEqual(ppCareerHistoryPending(P), true,
  'a player the index lists but whose shard has not landed must read as PENDING — '
  + 'otherwise the card tells the user we hold no record when we simply have not fetched it');
assert.deepStrictEqual(ppCareerHistory(P), [], 'no rows until the shard lands');
// (b) shard landed -> not pending, rows served from the cache.
const rows = [{ name: 'Wimbledon' }, { name: 'US Open' }];
sandbox._tourHistShards = { '101': rows };
assert.strictEqual(ppCareerHistoryPending(P), false, 'a landed shard is not pending');
assert.deepStrictEqual(ppCareerHistory(P), rows, 'rows come from the shard cache');
// (c) genuinely no history: index has no entry -> not pending, so the honest
//     "not on record" copy is reachable and is NOT suppressed forever.
sandbox._index = {}; sandbox._tourHistShards = {};
assert.strictEqual(ppCareerHistoryPending({ key: 999 }), false,
  'a player absent from the index must NOT read as pending, or the card spins forever');
// (d) a shard that came back empty/404 -> not pending (the fetch is settled).
sandbox._index = { '101': { n: 2, m: 3 } }; sandbox._tourHistShards = { '101': null };
assert.strictEqual(ppCareerHistoryPending(P), false, 'a settled-but-empty shard is not pending');
// (e) inline history still wins, so an older profiles file keeps working.
sandbox._index = {}; sandbox._tourHistShards = {};
const inline = [{ name: 'Miami' }];
assert.deepStrictEqual(ppCareerHistory({ key: 7, tournamentHistory: inline }), inline,
  'a profile carrying tournamentHistory inline must still render it');
assert.strictEqual(ppCareerHistoryPending({ key: 7, tournamentHistory: inline }), false,
  'inline history is never pending');
ok('pending-vs-empty predicate executed: 5-case truth table holds');

// Ordering still matters (pending must be checked before the empty copy), but it
// is asserted on the EXACT guard form so a dead-coded guard cannot satisfy it.
const resultFn = (html.match(/function ppTournamentResultHtml[\s\S]*?\n\}/) || [''])[0];
const pendingAt = resultFn.indexOf('if (ppCareerHistoryPending(p)){');
// ASCII-only needle on purpose: the copy is written with ’/— escapes in
// the source, so matching the rendered curly punctuation finds nothing and this
// check would pass vacuously.
const emptyAt = resultFn.indexOf('on record for this player yet');
assert.ok(emptyAt > -1, 'could not locate the "not on record" empty state — the lift is stale');
assert.ok(pendingAt > -1, 'the pending guard must be a live `if (ppCareerHistoryPending(p)){`');
assert.ok(pendingAt < emptyAt, 'the pending check must come BEFORE the "not on record" empty state');
ok('loading state is checked before the "not on record" copy');

// ── 9 · deploy publishes index AND dir, and asserts both (allowlist class) ───
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
assert.ok(/cp tournament-history-index\.json _site\//.test(wf),
  'pipeline.yml must copy tournament-history-index.json into _site');
assert.ok(/cp -r tournament-history _site\//.test(wf),
  'pipeline.yml must copy the tournament-history shard dir into _site');
assert.ok(/tournament-history-index\.json \\/.test(wf),
  'tournament-history-index.json must be in the assert-completeness list');
assert.ok(/-d _site\/tournament-history \]/.test(wf),
  'the shard dir must be asserted non-empty, like style-meetings/');
ok('deploy copies and asserts both the index and the shard dir');

console.log(`TEN-207 tournament-history shard lock — ${checks.length} checks passed:`);
checks.forEach(c => console.log(`  ✓ ${c}`));
