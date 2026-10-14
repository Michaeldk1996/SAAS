// TEN-437 — every guard in test-ten437-h2h.mjs must FAIL when the behaviour it locks is reverted. Each mutant is applied
// to a copy of h2h-core.js (TEN437_CORE) or of the page (TEN437_HTML) and the suite is run against it; a mutant that
// leaves the suite green is a vacuous test and fails this runner. For the core mutants it also prints how many golden
// pairs (and how many of the 18 Phase 1 scale-table pairs) each one breaks — the founder's "which mutation turns it red".
// Anchors must occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const CORE = fs.readFileSync(path.join(ROOT, 'h2h-core.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const G = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/ten437/h2h-golden-pairs.json'), 'utf8'));
const SUITE = path.join(ROOT, 'test-ten437-h2h.mjs');

const CORE_MUTANTS = [
  // one mutant may carry several [from, to] edits (both sides of the join)
  ['the eventKey-only join back (keyless archive rows skipped on both sides — the TEN-437 root cause)', [
    ["    A.forEach(x => {\n      if (!x || typeof x.won !== 'boolean') return;", "    A.forEach(x => {\n      if (!x || typeof x.won !== 'boolean' || x.eventKey == null) return;"],
    ["      if (!y || used.has(y) || bad.has(y) || typeof y.won !== 'boolean'", "      if (!y || y.eventKey == null || used.has(y) || bad.has(y) || typeof y.won !== 'boolean'"]]],
  ['a 2021 date cut-off', "    return dedupe(out).filter(x => inPopulation(x) &&", "    return dedupe(out).filter(x => String(x.date) >= '2021' && inPopulation(x) &&"],
  ['Challengers / ITF back in', "  const H2H_LEVELS = ['atp'];", "  const H2H_LEVELS = ['atp', 'chitf'];"],
  ['Hopman Cup and exhibitions back in', "  const H2H_NOT_COUNTED = /hopman cup|ultimate tennis showdown|\\buts\\b|six kings|exhibition|kooyong classic|mubadala world tennis/i;", "  const H2H_NOT_COUNTED = /$^/;"],
  ['qualifying back in', "      && !x.qualifying && !/^qualif/i.test(String(x.round || ''))", "      && true"],
  ['walkovers counted', "  function played(rows) { return (rows || []).filter(x => !isWalkover(x)); }", "  function played(rows) { return rows || []; }"],
  ['dedupe off (Shanghai 2019 counted twice)', "    return drop.size ? rows.filter(x => !drop.has(x)) : rows;", "    return rows;"],
  ['the namesake rule dropped (a one-sided row credited to any same-named player)', "    const uniq = k => !!k && ((nkCount || {})[k] || 0) <= 1;", "    const uniq = k => !!k;"],
  ['a 0 - 0 default read as a walkover (ATP counts defaults)', "    if (x.defaulted) return false;", "    if (false) return false;"],
  ['Laver Cup excluded (ATP counts it)', "  const H2H_NOT_COUNTED = /hopman cup|", "  const H2H_NOT_COUNTED = /laver cup|hopman cup|"],
];
const PAGE_MUTANTS = [
  ['the Match analysis tab back on the api-tennis list (m.h2h)', "  return H2HCore.joinMeetings(sfH2hSide(m.p1Key, m.p1), sfH2hSide(m.p2Key, m.p2), ch[0], ch[1], sfH2hNkCount(), own);",
    "  return ((m.h2h && m.h2h.matches) || []).map(x => Object.assign({}, x, { won: x.p1Won, level: 'atp' }));"],
  ['a failed history load cached as an answer (Match analysis)', "      if (!c1.ok || !c2.ok){ m._fhH2hP = null;", "      if (false){ m._fhH2hP = null;"],
  ['a failed history load cached as an answer (H2H page)', "        if (!ra.ok || !rb.ok) { S.st = 'failed';", "        if (false) { S.st = 'failed';"],
  ['the H2H page loses its Retry', "<span class=\"seg h2hp-retry\" onclick=\"H2HPage._h2hRetry()\"", "<span class=\"seg h2hp-retry\""],
  ['a display read of m.h2h.record (a second source)', "function kfH2HCard(m){", "function kfH2HCard(m){ const _r = m.h2h && m.h2h.record;"],
  ['a team tie priced off a tour match\'s close', "!/davis cup|laver cup/i.test(String(x.tournament || ''))", "true"],
  ['two meetings share one close (the pairing takes the first, not a dash)', "      if (cls.size !== grp.length) continue;", "      if (cls.size < 1) continue;"],
  ['the coverage line counts priced meetings only (Y ≠ the full H2H count)', "`${nP} of ${F.length} meetings priced`", "`${nP} of ${PR.length} meetings priced`"],
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten437-mut-'));
const run = env => spawnSync(process.execPath, ['--test', SUITE], { env: Object.assign({}, process.env, { DOTENV_CONFIG_QUIET: 'true' }, env), encoding: 'utf8' });
{ const r = run({}); if (r.status !== 0) { console.error('✖ the suite is red on the unmutated code — mutants are meaningless\n' + r.stdout.slice(-2000)); process.exit(1); }
  console.log('✔ control: the unmutated code passes'); }
const PHASE1 = new Set(G.pairs.slice(0, 18).map(p => p.a.short + '|' + p.b.short));
let survived = 0;
const edits = (from, to) => (Array.isArray(from) ? from : [[from, to]]);
for (const [name, from, to] of CORE_MUTANTS) {
  const E = edits(from, to);
  if (E.some(([f]) => CORE.split(f).length !== 2)) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  // one file per mutant: require() caches by real path (macOS tmp is a symlink), so a reused name would serve the first
  const file = path.join(dir, `h2h-core-${CORE_MUTANTS.indexOf(CORE_MUTANTS.find(x => x[0] === name))}.js`);
  fs.writeFileSync(file, E.reduce((src, [f, t]) => src.replace(f, t), CORE));
  fs.copyFileSync(path.join(ROOT, 'tournament-identity.js'), path.join(dir, 'tournament-identity.js'));
  const M = require(file);
  let bad = 0, bad18 = 0;
  for (const p of G.pairs) {
    const r = M.record(M.joinMeetings(p.a, p.b, p.chA, p.chB, p.nk, [])), want = p.knownGap ? p.knownGap.ours : p.atp;
    if (r.a !== want.a || r.b !== want.b) { bad++; if (PHASE1.has(p.a.short + '|' + p.b.short)) bad18++; }
  }
  const r = run({ TEN437_CORE: file });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; }
  else console.log(`✔ caught: ${name} — ${bad} of ${G.pairs.length} golden pairs diverge (${bad18} of the 18 scale-table pairs)`);
}
for (const [name, from, to] of PAGE_MUTANTS) {
  if (HTML.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, HTML.replace(from, to));
  const r = run({ TEN437_HTML: file });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; }
  else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${CORE_MUTANTS.length + PAGE_MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
