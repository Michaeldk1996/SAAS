// TEN-324 (TEN-312 N3, .claude/rules/modal-analysis.md §Overview career spine): the modal Overview's year table,
// career hero and tier toggle read careerByYear from the player-profile spine, never matches.json p?Yearly.
// The dashboard's Overview paint layer and the rebuilt renderer maOverviewV2 (match-analysis-v2.js, 2026-11-23) are
// EXECUTED against a fixture where the two sources disagree, so a builder that reads p?Yearly renders the wrong numbers
// and fails. The last test applies each mutation named on a
// check and fails if any survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overviewSpineVM } from './tools/ma2-overview-spine-vm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const MA2 = readFileSync(join(HERE, 'match-analysis-v2.js'), 'utf8');

// ---- fixture: the two sources disagree on every number ----
const cell = (won, lost) => ({ won, lost });
const row = (year, t, c, h, g, atp, chitf, allTier = true) => ({
  year, allTier, total: t, clay: c, hard: h, grass: g,
  atp: { total: atp, clay: null, hard: atp, grass: null }, chitf: { total: chitf, clay: null, hard: chitf, grass: null },
});
// careerByYear (profile spine). P1 career 50-15, P2 career 33-22.
const CBY = {
  101: [row('2025', cell(30, 10), cell(10, 4), cell(17, 5), cell(3, 1), cell(26, 8), cell(4, 2)),
        row('2024', cell(20, 5), cell(6, 2), cell(12, 2), cell(2, 1), cell(20, 5), null)],
  202: [row('2025', cell(21, 12), cell(5, 5), cell(14, 6), cell(2, 1), cell(13, 9), cell(8, 3)),
        row('2023', cell(12, 10), cell(4, 4), cell(7, 5), cell(1, 1), cell(12, 10), null)],
};
// matches.json p?Yearly — deliberately different everywhere (97-3 / 88-4 careers, different years).
const YEARLY = {
  p1Yearly: [row('2025', cell(61, 1), cell(20, 1), cell(40, 0), cell(1, 0), cell(59, 1), cell(2, 0)),
             row('2022', cell(36, 2), cell(11, 1), cell(24, 1), cell(1, 0), cell(36, 2), null)],
  p2Yearly: [row('2025', cell(88, 4), cell(30, 2), cell(55, 1), cell(3, 1), cell(80, 4), cell(8, 0))],
};
const MATCH = () => ({ id: 'm1', p1: 'A. One', p2: 'B. Two', p1Key: 101, p2Key: 202, ...YEARLY });

// The paint layer is sliced out of the dashboard and run with the real maOverviewV2 (tools/ma2-overview-spine-vm.mjs).
const profilesWithSpine = () => ({ 101: { name: 'A. One', careerByYear: CBY[101] }, 202: { name: 'B. Two', careerByYear: CBY[202] } });
// the 2026-11-23 design: each player's Career card prints his record big (26px) beside its rate; the Record by season
// table prints each year in its first column (bold mono, flex). Records use an en dash; read back as "w-l".
const heroes = html => [...html.matchAll(/font-size:26px; font-weight:700; line-height:1; color:[^;]+; white-space:nowrap;">(\d+)–(\d+)<\/span>/g)].map(x => x[1] + '-' + x[2]);
const years = html => [...html.matchAll(/display:flex; align-items:center; gap:6px;">(\d{4})/g)].map(x => x[1]);
const recs = html => html.replace(/(\d+)–(\d+)/g, '$1-$2');

// ---- the checks, each a function of the dashboard source so the mutants can re-run them ----
const CHECKS = {
  // Mutation: buildYearlyTables reads m.p1Yearly / m.p2Yearly (the pre-TEN-324 source).
  async 'year table and career hero come from careerByYear, not p?Yearly'(src, ma2) {
    const html = overviewSpineVM(src, { profiles: profilesWithSpine(), ma2 }).buildYearlyTables(MATCH());
    assert.deepEqual(heroes(html), ['50-15', '33-22'], 'career hero = Σ careerByYear');
    assert.deepEqual(years(html), ['2025', '2024', '2025', '2023'], 'year rows = careerByYear years (placeholders aside)');
    assert.ok(/>30-10</.test(recs(html)) && />21-12</.test(recs(html)), 'the 2025 totals are the profile rows');
    for (const n of ['61-1', '36-2', '88-4', '97-3', '2022']) assert.ok(!recs(html).includes(n), `no p?Yearly value (${n}) on the tab`);
  },
  // Mutation: the tier toggle's cell reader ignores careerByYear's tier split (reads p?Yearly's).
  async 'the tier toggle splits careerByYear'(src, ma2) {
    const vm = overviewSpineVM(src, { profiles: profilesWithSpine(), ma2 });
    await vm.A_TAB_BUILD.overview(MATCH());
    vm.setOverviewTier('atp');
    const atp = vm.painted.aSectionOverview;
    assert.deepEqual(heroes(atp), ['46-13', '25-19'], 'ATP career = Σ careerByYear.atp');
    vm.setOverviewTier('chitf');
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['4-2', '8-3']);
    for (const n of ['59-1', '80-4', '95-3']) assert.ok(!recs(atp + vm.painted.aSectionOverview).includes(n), `no p?Yearly tier value (${n})`);
    vm.setOverviewTier('all');
  },
  // Mutation: fall back to p?Yearly when the profile is not in memory (`ovCareerByYear(k) || m.p1Yearly`).
  async 'no profile in memory never paints p?Yearly: loading, then the spine once the shard lands'(src, ma2) {
    const profiles = {};
    const shard = k => new Promise(r => setTimeout(() => { if (CBY[k]) profiles[k] = { careerByYear: CBY[k] }; r(!!CBY[k]); }, 0));
    const vm = overviewSpineVM(src, { profiles, shard, ma2 });
    const m = MATCH();
    vm.A_TAB_BUILD.overview(m);
    const first = vm.painted.aSectionOverview;
    assert.ok(/Loading career records/.test(first), 'first paint is a loading line');
    assert.ok(!/61-1|88-4/.test(recs(first)));
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22'], 'the repaint after the shard lands reads the spine');
  },
  // Mutation: drop the still-loading guard (the player without a profile yet paints as "not yet on tour").
  async 'one profile in memory, the other still loading: a loading line, then both from the spine'(src, ma2) {
    const profiles = { 101: { careerByYear: CBY[101] } };
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = profiles[k] || { careerByYear: CBY[k] }; r(true); }, 0));
    const vm = overviewSpineVM(src, { profiles, shard, ma2 });
    vm.A_TAB_BUILD.overview(MATCH());
    assert.ok(/Loading career records/.test(vm.painted.aSectionOverview), 'no half-painted tab');
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22']);
  },
  // Mutation: ensureOverviewProfiles keeps a key "settled" after its profile left memory (e.g. an eager reload
  // replaced the map), so a reopen paints that player as "not yet on tour" until the shard lands.
  async 'a profile that left memory since the last open paints loading again, not an empty record'(src, ma2) {
    const profiles = profilesWithSpine();
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = profiles[k] || { careerByYear: CBY[k] }; r(true); }, 0));
    const vm = overviewSpineVM(src, { profiles, shard, ma2 });
    vm.A_TAB_BUILD.overview(MATCH());
    await new Promise(r => setTimeout(r, 5));
    delete profiles[101];
    vm.A_TAB_BUILD.overview(MATCH());
    assert.ok(/Loading career records/.test(vm.painted.aSectionOverview), 'reopen with the profile gone = loading');
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22']);
  },
  // Mutation: the Overview builder does not return its load (Download report prints the loading line).
  async 'the tab build returns a promise that settles only after the final paint (Download report waits for it)'(src, ma2) {
    const profiles = {};
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = { careerByYear: CBY[k] }; r(true); }, 3));
    const vm = overviewSpineVM(src, { profiles, shard, ma2 });
    const ret = vm.A_TAB_BUILD.overview(MATCH());
    assert.ok(ret && typeof ret.then === 'function', 'overview(m) returns a promise');
    await ret;
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22'], 'by the time it settles the table is painted');
  },
  // Mutation: setOverviewTier rebuilds straight from memory (no re-fetch) — after player-profiles.json replaced
  // the map without a shard-loaded player, a tier click paints that player as "not yet on tour".
  async 'a tier click after a profile left memory re-fetches it: loading, then the tier from the spine'(src, ma2) {
    const profiles = profilesWithSpine();
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = profiles[k] || { careerByYear: CBY[k] }; r(true); }, 3));
    const vm = overviewSpineVM(src, { profiles, shard, ma2 });
    await vm.A_TAB_BUILD.overview(MATCH());
    delete profiles[101];                       // the eager reload replaced the map; 101 was a shard-only profile
    vm.setOverviewTier('atp');
    assert.ok(/Loading career records/.test(vm.painted.aSectionOverview), 'loading, not an empty record');
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['46-13', '25-19']);
    vm.setOverviewTier('all');
  },
  // Mutation: drop the aBuilt guard (a late profile repaints the Overview of a modal since reopened on another match).
  async 'a late profile never repaints a modal that moved on to another match'(src, ma2) {
    const profiles = {};
    let open = true;
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = { careerByYear: CBY[k] }; r(true); }, 3));
    const vm = overviewSpineVM(src, { profiles, shard, built: () => open, ma2 });
    const done = vm.A_TAB_BUILD.overview(MATCH());
    open = false;                               // the modal was reopened on another match before the shards landed
    vm.painted.aSectionOverview = 'OTHER MATCH';
    await done;
    assert.equal(vm.painted.aSectionOverview, 'OTHER MATCH');
  },
  // Mutation: a player with no profile anywhere shows p?Yearly instead of the empty state.
  async 'a match whose players have no profile shows the empty state, not p?Yearly'(src, ma2) {
    const vm = overviewSpineVM(src, { profiles: {}, shard: () => Promise.resolve(false), ma2 });
    const m = MATCH();
    vm.A_TAB_BUILD.overview(m);
    await new Promise(r => setTimeout(r, 5));
    const html = vm.painted.aSectionOverview;
    assert.ok(/Year-by-year records need the stats source/.test(html), html.slice(0, 120));
    assert.ok(!/61-1|88-4/.test(recs(html)));
  },
};
for (const [name, fn] of Object.entries(CHECKS)) test(name, () => fn(HTML, MA2));

// Mutation: any modal code (or anything else in the dashboard) reads p1Yearly / p2Yearly again.
test('p?Yearly is read by nothing in the dashboard or match-analysis-v2.js', () => {
  for (const src of [HTML, MA2]) assert.deepEqual(src.match(/\bp[12]Yearly\b|\bp\$\{[^}]*\}Yearly\b|\[['"`]p[12]?Yearly/g), null);
});

// Each mutation must turn at least one check red.
// [file, label, from, to]: 'html' = the dashboard (the paint / load layer), 'ma2' = match-analysis-v2.js (maOverviewV2 reads
// careerByYear and draws the tier).
const MUTANTS = [
  ['ma2', 'read p?Yearly', 'y1 = ovCareerByYear(m.p1Key), y2 = ovCareerByYear(m.p2Key);', 'y1 = m.p1Yearly, y2 = m.p2Yearly;'],
  ['ma2', 'fall back to p?Yearly', 'y1 = ovCareerByYear(m.p1Key), y2 = ovCareerByYear(m.p2Key);', 'y1 = ovCareerByYear(m.p1Key) || m.p1Yearly, y2 = ovCareerByYear(m.p2Key) || m.p2Yearly;'],
  ['html', 'no repaint after the shard', "  return loaded.then(() => { if (aBuilt(m, 'overview')) aPaint('aSectionOverview', buildYearlyTables(m)); });", '  return loaded;'],
  ['html', 'builder does not return its load', '  overview(m){ return ovPaint(m); },', '  overview(m){ ovPaint(m); },'],
  ['html', 'tier click rebuilds without re-fetch', '  ovPaint(_ov.m);', "  aPaint('aSectionOverview', buildYearlyTables(_ov.m));"],
  ['html', 'no stale-match guard on the repaint', "if (aBuilt(m, 'overview')) aPaint('aSectionOverview', buildYearlyTables(m)); });", "aPaint('aSectionOverview', buildYearlyTables(m)); });"],
  ['html', 'a dropped profile stays "settled"', "    if (!ovCareerByYear(k)) _ovProfileSettled.delete(String(k));", ''],
  ['html', 'no shard fetch', 'Promise.resolve(ensurePlayerProfile(k))', 'Promise.resolve(false)'],
  ['ma2', 'no still-loading guard', "if ([[m.p1Key, y1], [m.p2Key, y2]].some(([k, y]) => !y && k != null && !_ovProfileSettled.has(String(k)))) return", 'if (false) return'],
  ['ma2', 'tier toggle ignores tier', "api.careerTierCells({ careerByYear: real }, tier)", "api.careerTierCells({ careerByYear: real }, 'all')"],
];
test(`mutants: ${MUTANTS.length} applied, every one caught`, async () => {
  const survived = [];
  for (const [file, label, from, to] of MUTANTS) {
    const base = file === 'ma2' ? MA2 : HTML;
    assert.equal(base.split(from).length, 2, `mutant anchor for "${label}" must occur exactly once in ${file}`);
    const mutated = base.replace(from, to), args = file === 'ma2' ? [HTML, mutated] : [mutated, MA2];
    let caught = false;
    for (const fn of Object.values(CHECKS)) { try { await fn(...args); } catch (e) { if (e instanceof assert.AssertionError) { caught = true; break; } throw e; } }
    if (!caught) survived.push(label);
  }
  assert.deepEqual(survived, [], 'mutants that survived');
});
