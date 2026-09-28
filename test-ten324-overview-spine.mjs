// TEN-324 (TEN-312 N3, .claude/rules/modal-analysis.md §Overview career spine): the modal Overview's year table,
// career hero and tier toggle read careerByYear from the player-profile spine, never matches.json p?Yearly.
// The builder is sliced out of the dashboard and EXECUTED against a fixture where the two sources disagree, so a
// builder that reads p?Yearly renders the wrong numbers and fails. The last test applies each mutation named on a
// check and fails if any survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name, src) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 1);
}
function objSrc(decl, src) {
  const start = src.indexOf(`\n${decl} = {`);
  if (start < 0) throw new Error(`${decl} not found`);
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 2);
}

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

// Slice the Overview builder and its helpers and run them. `profiles` is the playerProfiles map; `shard(k)` models
// ensurePlayerProfile: it may add a profile to the map and resolves true/false.
function overviewVM(src, { profiles = {}, shard = () => Promise.resolve(false), built = () => true } = {}) {
  const fns = ['cellClass', 'cellText', 'cellForTier', 'sumCellsTier', 'yrSurfCell', 'buildYearlyTable', 'alignYearlyPair',
    'ovCareerByYear', 'ensureOverviewProfiles', 'ovPaint', 'buildYearlyTables', 'setOverviewTier',
    // the TEN-314 sample gate the hero's rates and bars go through (real code, not stubs)
    'tourxSampleGate', 'maGate', 'maPct', 'maRate', 'maSmallNote', 'maRateHtml', 'maGateBar'];
  const settledDecl = src.match(/\nconst _ovProfileSettled = [^\n]*/);
  const consts = ['MA_GREY', 'MA_SMALL_NOTE'].map(c => src.match(new RegExp(`\\nconst ${c} = [^\\n]*`))[0]).join('');
  const painted = {};
  const byId = {};
  const document = { getElementById: id => (byId[id] = byId[id] || { innerHTML: '' }) };
  const api = new Function('document', 'playerProfiles', 'ensurePlayerProfile', 'loadCareerHistory', 'seasonSurfaceBlockHtml',
    'ANALYSIS_P1_RGBA', 'ANALYSIS_P2_RGBA', 'aPaint', 'aBuilt', `
    let overviewTier = 'all', _overviewMatch = null; const _openOverviewDrill = {};
    ${settledDecl ? settledDecl[0] : ''}
    ${consts}
    ${fns.map(f => slice(f, src)).join('\n')}
    ${objSrc('const A_TAB_BUILD', src)}
    return { buildYearlyTables, setOverviewTier, A_TAB_BUILD };`)(
    document, profiles, k => shard(String(k)), () => {}, () => '', a => `rgba(1,1,1,${a})`, a => `rgba(2,2,2,${a})`,
    (id, html) => { painted[id] = html; }, (m, tab) => built(m, tab));
  return { ...api, painted, byId };
}
const profilesWithSpine = () => ({ 101: { name: 'A. One', careerByYear: CBY[101] }, 202: { name: 'B. Two', careerByYear: CBY[202] } });
const heroes = html => [...html.matchAll(/<span class="rec"[^>]*>(\d+-\d+)<\/span>/g)].map(x => x[1]);
const years = html => [...html.matchAll(/<td class="yr-year">(\d{4})/g)].map(x => x[1]);

// ---- the checks, each a function of the dashboard source so the mutants can re-run them ----
const CHECKS = {
  // Mutation: buildYearlyTables reads m.p1Yearly / m.p2Yearly (the pre-TEN-324 source).
  async 'year table and career hero come from careerByYear, not p?Yearly'(src) {
    const html = overviewVM(src, { profiles: profilesWithSpine() }).buildYearlyTables(MATCH());
    assert.deepEqual(heroes(html), ['50-15', '33-22'], 'career hero = Σ careerByYear');
    assert.deepEqual(years(html), ['2025', '2024', '2025', '2023'], 'year rows = careerByYear years (placeholders aside)');
    assert.ok(html.includes('>30-10<') && html.includes('>21-12<'), 'the 2025 totals are the profile rows');
    for (const n of ['61-1', '36-2', '88-4', '97-3', '2022']) assert.ok(!html.includes(n), `no p?Yearly value (${n}) on the tab`);
  },
  // Mutation: the tier toggle's cell reader ignores careerByYear's tier split (reads p?Yearly's).
  async 'the tier toggle splits careerByYear'(src) {
    const vm = overviewVM(src, { profiles: profilesWithSpine() });
    await vm.A_TAB_BUILD.overview(MATCH());
    vm.setOverviewTier('atp');
    const atp = vm.painted.aSectionOverview;
    assert.deepEqual(heroes(atp), ['46-13', '25-19'], 'ATP career = Σ careerByYear.atp');
    vm.setOverviewTier('chitf');
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['4-2', '8-3']);
    for (const n of ['59-1', '80-4', '95-3']) assert.ok(!(atp + vm.painted.aSectionOverview).includes(n), `no p?Yearly tier value (${n})`);
    vm.setOverviewTier('all');
  },
  // Mutation: fall back to p?Yearly when the profile is not in memory (`ovCareerByYear(k) || m.p1Yearly`).
  async 'no profile in memory never paints p?Yearly: loading, then the spine once the shard lands'(src) {
    const profiles = {};
    const shard = k => new Promise(r => setTimeout(() => { if (CBY[k]) profiles[k] = { careerByYear: CBY[k] }; r(!!CBY[k]); }, 0));
    const vm = overviewVM(src, { profiles, shard });
    const m = MATCH();
    vm.A_TAB_BUILD.overview(m);
    const first = vm.painted.aSectionOverview;
    assert.ok(/Loading career records/.test(first), 'first paint is a loading line');
    assert.ok(!/61-1|88-4/.test(first));
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22'], 'the repaint after the shard lands reads the spine');
  },
  // Mutation: drop the still-loading guard (the player without a profile yet paints as "not yet on tour").
  async 'one profile in memory, the other still loading: a loading line, then both from the spine'(src) {
    const profiles = { 101: { careerByYear: CBY[101] } };
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = profiles[k] || { careerByYear: CBY[k] }; r(true); }, 0));
    const vm = overviewVM(src, { profiles, shard });
    vm.A_TAB_BUILD.overview(MATCH());
    assert.ok(/Loading career records/.test(vm.painted.aSectionOverview), 'no half-painted tab');
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22']);
  },
  // Mutation: ensureOverviewProfiles keeps a key "settled" after its profile left memory (e.g. an eager reload
  // replaced the map), so a reopen paints that player as "not yet on tour" until the shard lands.
  async 'a profile that left memory since the last open paints loading again, not an empty record'(src) {
    const profiles = profilesWithSpine();
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = profiles[k] || { careerByYear: CBY[k] }; r(true); }, 0));
    const vm = overviewVM(src, { profiles, shard });
    vm.A_TAB_BUILD.overview(MATCH());
    await new Promise(r => setTimeout(r, 5));
    delete profiles[101];
    vm.A_TAB_BUILD.overview(MATCH());
    assert.ok(/Loading career records/.test(vm.painted.aSectionOverview), 'reopen with the profile gone = loading');
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22']);
  },
  // Mutation: the Overview builder does not return its load (Download report prints the loading line).
  async 'the tab build returns a promise that settles only after the final paint (Download report waits for it)'(src) {
    const profiles = {};
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = { careerByYear: CBY[k] }; r(true); }, 3));
    const vm = overviewVM(src, { profiles, shard });
    const ret = vm.A_TAB_BUILD.overview(MATCH());
    assert.ok(ret && typeof ret.then === 'function', 'overview(m) returns a promise');
    await ret;
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['50-15', '33-22'], 'by the time it settles the table is painted');
  },
  // Mutation: setOverviewTier rebuilds straight from memory (no re-fetch) — after player-profiles.json replaced
  // the map without a shard-loaded player, a tier click paints that player as "not yet on tour".
  async 'a tier click after a profile left memory re-fetches it: loading, then the tier from the spine'(src) {
    const profiles = profilesWithSpine();
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = profiles[k] || { careerByYear: CBY[k] }; r(true); }, 3));
    const vm = overviewVM(src, { profiles, shard });
    await vm.A_TAB_BUILD.overview(MATCH());
    delete profiles[101];                       // the eager reload replaced the map; 101 was a shard-only profile
    vm.setOverviewTier('atp');
    assert.ok(/Loading career records/.test(vm.painted.aSectionOverview), 'loading, not an empty record');
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(heroes(vm.painted.aSectionOverview), ['46-13', '25-19']);
    vm.setOverviewTier('all');
  },
  // Mutation: drop the aBuilt guard (a late profile repaints the Overview of a modal since reopened on another match).
  async 'a late profile never repaints a modal that moved on to another match'(src) {
    const profiles = {};
    let open = true;
    const shard = k => new Promise(r => setTimeout(() => { profiles[k] = { careerByYear: CBY[k] }; r(true); }, 3));
    const vm = overviewVM(src, { profiles, shard, built: () => open });
    const done = vm.A_TAB_BUILD.overview(MATCH());
    open = false;                               // the modal was reopened on another match before the shards landed
    vm.painted.aSectionOverview = 'OTHER MATCH';
    await done;
    assert.equal(vm.painted.aSectionOverview, 'OTHER MATCH');
  },
  // Mutation: a player with no profile anywhere shows p?Yearly instead of the empty state.
  async 'a match whose players have no profile shows the empty state, not p?Yearly'(src) {
    const vm = overviewVM(src, { profiles: {}, shard: () => Promise.resolve(false) });
    const m = MATCH();
    vm.A_TAB_BUILD.overview(m);
    await new Promise(r => setTimeout(r, 5));
    const html = vm.painted.aSectionOverview;
    assert.ok(/Year-by-year records need the stats source/.test(html), html.slice(0, 120));
    assert.ok(!/61-1|88-4/.test(html));
  },
};
for (const [name, fn] of Object.entries(CHECKS)) test(name, () => fn(HTML));

// Mutation: any modal code (or anything else in the dashboard) reads p1Yearly / p2Yearly again.
test('p?Yearly is read by nothing in the dashboard', () => {
  assert.deepEqual(HTML.match(/\bp[12]Yearly\b|\bp\$\{[^}]*\}Yearly\b|\[['"`]p[12]?Yearly/g), null);
});

// Each mutation must turn at least one check red.
const MUTANTS = [
  ['read p?Yearly', 'const y1 = ovCareerByYear(m.p1Key), y2 = ovCareerByYear(m.p2Key);', 'const y1 = m.p1Yearly, y2 = m.p2Yearly;'],
  ['fall back to p?Yearly', 'const y1 = ovCareerByYear(m.p1Key), y2 = ovCareerByYear(m.p2Key);', 'const y1 = ovCareerByYear(m.p1Key) || m.p1Yearly, y2 = ovCareerByYear(m.p2Key) || m.p2Yearly;'],
  ['no repaint after the shard', "  return loaded.then(() => { if (aBuilt(m, 'overview')) aPaint('aSectionOverview', buildYearlyTables(m)); });", '  return loaded;'],
  ['builder does not return its load', '  overview(m){ return ovPaint(m); },', '  overview(m){ ovPaint(m); },'],
  ['tier click rebuilds without re-fetch', '  if (_overviewMatch) ovPaint(_overviewMatch);', "  if (_overviewMatch) aPaint('aSectionOverview', buildYearlyTables(_overviewMatch));"],
  ['no stale-match guard on the repaint', "if (aBuilt(m, 'overview')) aPaint('aSectionOverview', buildYearlyTables(m)); });", "aPaint('aSectionOverview', buildYearlyTables(m)); });"],
  ['a dropped profile stays "settled"', "    if (!ovCareerByYear(k)) _ovProfileSettled.delete(String(k));", ''],
  ['no shard fetch', 'Promise.resolve(ensurePlayerProfile(k))', 'Promise.resolve(false)'],
  ['no still-loading guard', "  if ([[m.p1Key, y1], [m.p2Key, y2]].some(([k, y]) => !y && k != null && !_ovProfileSettled.has(String(k)))) {", '  if (false) {'],
  ['tier toggle ignores tier', "  if (tier === 'all') return r[surf] || null;", '  return r[surf] || null;'],
];
test(`mutants: ${MUTANTS.length} applied, every one caught`, async () => {
  const survived = [];
  for (const [label, from, to] of MUTANTS) {
    assert.equal(HTML.split(from).length, 2, `mutant anchor for "${label}" must occur exactly once`);
    const mutant = HTML.replace(from, to);
    let caught = false;
    for (const fn of Object.values(CHECKS)) { try { await fn(mutant); } catch (e) { if (e instanceof assert.AssertionError) { caught = true; break; } throw e; } }
    if (!caught) survived.push(label);
  }
  assert.deepEqual(survived, [], 'mutants that survived');
});
