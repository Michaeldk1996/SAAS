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
  ['a 2021 date cut-off', "    return dedupe(out).map(x => resolveQualifying(x, all)).filter(x => inPopulation(x) &&", "    return dedupe(out).map(x => resolveQualifying(x, all)).filter(x => String(x.date) >= '2021' && inPopulation(x) &&"],
  ['Challengers / ITF back in', "  const H2H_LEVELS = ['atp'];", "  const H2H_LEVELS = ['atp', 'chitf'];"],
  ['Hopman Cup and exhibitions back in', "  const ATP_RECORD_NOT_COUNTED = /hopman cup|ultimate tennis showdown|\\buts\\b|six kings|exhibition|kooyong classic|mubadala world tennis|", "  const ATP_RECORD_NOT_COUNTED = /$^|"],
  ['qualifying back in', "      && !x.qualifying && !/^qualif/i.test(String(x.round || ''))", "      && true"],
  ['walkovers counted', "  function played(rows) { return (rows || []).filter(x => !isWalkover(x)); }", "  function played(rows) { return rows || []; }"],
  ['dedupe off (Shanghai 2019 counted twice)', "    return drop.size ? rows.filter(x => !drop.has(x)) : rows;", "    return rows;"],
  ['the namesake rule dropped (a one-sided row credited to any same-named player)', "    const uniq = k => !!k && ((nkCount || {})[k] || 0) <= 1;", "    const uniq = k => !!k;"],
  ['ruling 3: the core infers a walkover from a 0 - 0 score again (a default, a 0 - 0 retirement read as one)', "    return !!(x && x.walkover);", "    return !!(x && (x.walkover || !/[1-9]/.test(String(x.result || ''))));"],
  ['Laver Cup excluded from H2H (ATP counts it)', "  const ATP_RECORD_NOT_COUNTED = /hopman cup|", "  const ATP_RECORD_NOT_COUNTED = /laver cup|hopman cup|"],
  ['the join\'s list no longer the exported ATP list (H2H_NOT_COUNTED a copy)', "  const H2H_NOT_COUNTED = ATP_RECORD_NOT_COUNTED;", "  const H2H_NOT_COUNTED = new RegExp(ATP_RECORD_NOT_COUNTED.source, 'i');"],
  // TEN-437 reconciliation fixes (founder 2026-10-16)
  // founder 2026-10-20: api-tennis key 34000 is D. E. Galan (1735)
  ['key alias: 34000 not folded into 1735 (the three Galan meetings out)', "  const API_KEY_ALIASES = Object.freeze({ '34000': '1735' });", "  const API_KEY_ALIASES = Object.freeze({});"],
  ['key alias: the join compares raw keys', "ck(r.oppKey) === ck(other.key)", "String(r.oppKey) === String(other.key)"],
  ['key alias: every key folded into 1735', "return Object.prototype.hasOwnProperty.call(API_KEY_ALIASES, s) ? API_KEY_ALIASES[s] : s; }", "return '1735'; }"],
  ['D1: qualifying read from the first row\'s label alone (both rows and the main-draw date ignored)',
    "  function resolveQualifying(x, all) {\n    const tw = x._twin, rX = rnd(x), rT = rnd(tw);", "  function resolveQualifying(x, all) { return x;\n    const tw = x._twin, rX = rnd(x), rT = rnd(tw);"],
  ['D2: the Asian Games counted', "mubadala world tennis|asian games|", "mubadala world tennis|"],
  ['D2: Davis Cup Group III/IV counted', "|davis cup.*group (iii|iv)\\b|davis cup g[34]\\b/i;", "/i;"],
  ['D3: a one-sided archive row credited on its name', "      if (r.src === 'archive') return !!up(r.oppId) && up(r.oppId) === up(other.id);", "      if (r.src === 'archive') return uniq(nkOther);"],
  ['D3: a feed row\'s api key ignored', "      if (r.oppKey != null && r.oppKey !== '') return other.key != null && ck(r.oppKey) === ck(other.key);", ""],
  ['D1: a same-day main-draw double read as qualifying (on-or-before instead of before)', "    if (md == null || d0 < md) return Object.assign({}, x, { qualifying: true });", "    if (md == null || d0 <= md) return Object.assign({}, x, { qualifying: true });"],
];
const PAGE_MUTANTS = [
  ['the Match analysis tab back on the api-tennis list (m.h2h)', "  return H2HCore.joinMeetings(sfH2hSide(m.p1Key, m.p1), sfH2hSide(m.p2Key, m.p2), ch[0], ch[1], sfH2hNkCount(), own);",
    "  return ((m.h2h && m.h2h.matches) || []).map(x => Object.assign({}, x, { won: x.p1Won, level: 'atp' }));"],
  ['a failed history load cached as an answer (Match analysis)', "      if (!c1.ok || !c2.ok){ m._fhH2hP = null;", "      if (false){ m._fhH2hP = null;"],
  ['a failed history load cached as an answer (H2H page)', "        if (!ra.ok || !rb.ok) { S.st = 'failed';", "        if (false) { S.st = 'failed';"],
  ['the H2H page loses its Retry', "<span class=\"seg h2hp-retry\" onclick=\"H2HPage._h2hRetry()\"", "<span class=\"seg h2hp-retry\""],
  ['a display read of m.h2h.record (a second source)', "function kfH2HCard(m){", "function kfH2HCard(m){ const _r = m.h2h && m.h2h.record;"],
  ['a team tie priced off a tour match\'s close', "!/davis cup|laver cup|atp cup|united cup/i.test(String(x.tournament || ''))", "true"],
  ['two meetings share one close (the pairing takes the first, not a dash)', "      if (cls.size !== grp.length) continue;", "      if (cls.size < 1) continue;"],
  ['the coverage line counts priced meetings only (Y ≠ the full H2H count)', "`${nP} of ${F.length} meetings priced`", "`${nP} of ${PR.length} meetings priced`"],
  ['D3: the tab passes no TML/ATP id', "id: key != null ? careerHistoryIdOf(key) : null", "id: null"],
  ['ruling 3: the page infers a walkover from an empty score again (a 0 - 0 retirement read as one)', "  // Founder 2026-10-22 (ruling 3): a walkover is the row's EXPLICIT flag", "  if (!r.wo && !r.sets && (r.pS == null || r.pS + r.oS === 0)) r.wo = true;\n  // Founder 2026-10-22 (ruling 3): a walkover is the row's EXPLICIT flag"],
  ['S1: Next Gen sets read with the 6-game set test (a retirement)', "const setDone = x => (ng ? Math.max(x[0], x[1]) === 4 : fhSetDone(x));", "const setDone = x => fhSetDone(x);"],
  ['S1: games counted on a Next Gen match', "    r.gA = r.gB = r.tot = r.diff = null;   // S1", "    r.tot = 0; r.diff = 0;   // S1"],
  ['S1: a games-based hot line reads a Next Gen match', "  if (def.need === 'games' && r.ng) return false;", ""],
  ['ruling 2 (corrected): the Form tab wired to the H2H list', "const FH_FORM_NOT_ATP_RECORD = new RegExp('laver cup|' + FH_FORM_EVENTS_NOT_COUNTED.source, 'i');", "const FH_FORM_NOT_ATP_RECORD = H2HCore.ATP_RECORD_NOT_COUNTED;"],
  ['ruling 3: a price group paired by round alone (RG 2020 QF handed Hamburg 2020 F\'s close)', "const ms = grp.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || (rk(a) || 0) - (rk(b) || 0))", "const ms = grp.slice().sort((a, b) => (rk(a) || 0) - (rk(b) || 0))"],
  ['ruling 3: ATP Cup / United Cup back in the window pairing', "!/davis cup|laver cup|atp cup|united cup/i.test(String(x.tournament || '')));\n    const cand", "!/davis cup|laver cup/i.test(String(x.tournament || '')));\n    const cand"],
  ['ruling 4: the Bet365 hover back to the source label', "const FH_B365_HOVER = 'Bet365 closing odds, Pinnacle not available';", "const FH_B365_HOVER = 'Bet365 close · Tennis-Data';"],
  ['item 4: the H2H page meeting rows lose the B marker', "            hTitle: h2hPriceTitle(r), aTitle: h2hPriceTitle(r), hMark: typeof fhPxMark === 'function' ? fhPxMark(r) : r.price != null && r.book === 'B' ? 'B' : '',", "            hTitle: h2hPriceTitle(r), aTitle: h2hPriceTitle(r), hMark: '',"],
  ['ruling 4: the H2H hover spreads to Form (fhSrcTitle)', "`${FH_BOOK.A} · ${r.src === 'od10' ? SF_OD10_HOVER : r.src === 'te' ? SF_TE_HOVER : SF_APPROX_HOVER}` : fhB365Approx(r) ? (r.src === 'atb' ? FH_B365_AT_HOVER : FH_B365_APPROX_HOVER) : r && r.book ?", "`${FH_BOOK.A} · ${r.src === 'od10' ? SF_OD10_HOVER : r.src === 'te' ? SF_TE_HOVER : SF_APPROX_HOVER}` : fhB365Approx(r) ? (r.src === 'atb' ? FH_B365_AT_HOVER : FH_B365_APPROX_HOVER) : r && r.book === 'B' ? FH_B365_HOVER : r && r.book ?"],
  ['board exclusion: the tab counts its own match while upcoming / live', "  const own = m.finalScore ? [] : [eventKeyOfMatch(m)].filter(x => x != null && x !== '');", "  const own = [];"],
  ['board exclusion: the tab still leaves its own match out once finished', "  const own = m.finalScore ? [] : [eventKeyOfMatch(m)].filter(x => x != null && x !== '');", "  const own = [eventKeyOfMatch(m)].filter(x => x != null && x !== '');"],
  ['board exclusion: the H2H page leaves out this week\'s board matches again', "      const nkF = fn('sfH2hNkCount');\n      const own = [];", "      const nkF = fn('sfH2hNkCount');\n      const own = (typeof matches !== 'undefined' ? matches : []).filter(x => x && x.finalScore).map(eventKeyOfMatch);"],
];
// Mutants applied to a copy of career-backfill.js / bsp-pipeline.js written NEXT TO the original (so its relative
// requires resolve), passed to the suite as TEN437_BACKFILL / TEN437_PIPELINE, and removed afterwards.
const BACKFILL_MUTANTS = [
  ['D4: a no-hard/clay/grass archive row skipped again', "      // TEN-437 D4 (founder 2026-10-16): a carpet or blank-surface match is still a match", "      if (!m.surface) continue;\n      // TEN-437 D4 (founder 2026-10-16): a carpet or blank-surface match is still a match"],
  ['D4: carpet read as no surface', "  if (s.includes('carpet')) return 'carpet';", ""],
  ['D3: archive rows without the opponent id', "        ...(m.oppId ? { oppId: String(m.oppId) } : {}),", ""],
];
const PIPELINE_MUTANTS = [
  ['S2: Tokyo 2021 back on the per-key surface', "2021: 'hard', ", ""],
  ['S2: the shard writer leaves cached Olympic rows on their old surface', "    for (const r of rows) { const os = olympicSurface(r.tournament, r.date); if (os) r.surface = os; }\n", ""],
  ['D3: the shard without its own id', "      ...(tmlIds.get(String(key)) ? { id: tmlIds.get(String(key)) } : {}),", ""],
  ['ruling 2 (corrected): the card\'s Form list wired to the H2H list', "\nconst FORM_NOT_ATP_RECORD = new RegExp('laver cup|' + FORM_EVENTS_NOT_COUNTED.source, 'i');\n", "\nconst FORM_NOT_ATP_RECORD = H2H_NOT_ATP_RECORD;\n"],
  ['ruling 2 (corrected): the pipeline\'s H2H list its own copy (the Form base — Asian Games counted)', "\nconst H2H_NOT_ATP_RECORD = require('./h2h-core.js').ATP_RECORD_NOT_COUNTED;\n", "\nconst H2H_NOT_ATP_RECORD = /hopman cup|ultimate tennis showdown|\\buts\\b|six kings|exhibition|kooyong classic|mubadala world tennis/i;\n"],
  ['board exclusion: the model counts its own match', "  const own = [ek(m)].filter(Boolean);", "  const own = [];"],
  ['model freeze: the model\'s H2H takes its own match once finished', "  const own = [ek(m)].filter(Boolean);", "  const own = m.finalScore ? [] : [ek(m)].filter(Boolean);"],
  // founder 2026-10-20: the freeze keyed by event key, a run-to-run store, ok:false frozen, nothing computed after the start
  ['model freeze (a): the board looked up by row id (past-<ek> never finds upcoming-<ek>)', "    const ek = modelEventKey(m.id), c = cand.get(ek);", "    const ek = modelEventKey(m.id), c = cand.get(String(m.id));"],
  ['model freeze (a): a file\'s pre-match entry filed under its row id', "add(modelEventKey(id), 'pre', e, e.computedAt || f.generatedAt, null);", "add(id, 'pre', e, e.computedAt || f.generatedAt, null);"],
  ['model freeze (b): the store not read', "  const cand = modelPreMatchCandidates({ store: readJ(MODEL_PREMATCH_PATH),", "  const cand = modelPreMatchCandidates({ store: null,"],
  ['model freeze (b): an entry off the board dropped from the store', "    if (Date.parse(e.lastSeen || e.at) >= keepFrom) entries[ek] = e;\n", ""],
  ['model freeze (b): the store not written', "  writeJsonAtomic(MODEL_PREMATCH_PATH, { v: 1, savedAt: nowIso, keepHours: MODEL_PREMATCH_KEEP_H, entries }, true);\n", ""],
  ['model freeze (b): a frozen entry re-frozen from a newer pre-match copy', "    if (c && c.frozen) { out[m.id] = c.frozen.entry; frozenKept++; continue; }\n", ""],
  ['model freeze (c): a prediction computed after the start', "    if (startedEks.has(ek)) {", "    if (false) {"],
  ['model freeze: a past- row with no score computed after its result', "\n    || /^past-/.test(String(m.id || ''))));", "));"],
  ['model freeze: a stale upcoming- row beside its past- row computed', "    if (startedEks.has(ek)) {", "    if (modelMatchStarted(m)) {"],
  ['model freeze: a frozen match shown upcoming again recomputed', "    if (c && c.frozen) { out[m.id] = c.frozen.entry; frozenKept++; continue; }", "    if (c && c.frozen && startedEks.has(ek)) { out[m.id] = c.frozen.entry; frozenKept++; continue; }"],
  ['model freeze: the store never expires', "const MODEL_PREMATCH_KEEP_H = 72;", "const MODEL_PREMATCH_KEEP_H = 1e9;"],
  ['model freeze: the LATEST frozenAt kept (a re-freeze replaces the first)', "if (!x.frozen || at < x.frozen.at)", "if (!x.frozen || at > x.frozen.at)"],
  ['model freeze: an on-board frozen entry\'s lastSeen not refreshed', "entries[ek] = { kind: 'frozen', at: e.frozenAt || (c && c.frozen && c.frozen.at), lastSeen: nowIso, entry: e };", "entries[ek] = { kind: 'frozen', at: e.frozenAt || (c && c.frozen && c.frozen.at), lastSeen: e.frozenAt, entry: e };"],
  ['model freeze (c): an ok:false pre-match entry not frozen', "      if (c && c.pre) {", "      if (c && c.pre && c.pre.entry.ok) {"],
  ['model freeze (c): a failed run before the start not stamped', "players: result.players || null, preMatch: true, computedAt: nowIso };", "players: result.players || null, preMatch: true };"],
  ['model freeze: an ok entry not stamped as pre-match', "      preMatch: true,\n      computedAt: nowIso,\n", ""],
  ['model freeze: the EARLIEST pre-match entry frozen', "if (!x.pre || at > x.pre.at)", "if (!x.pre || at < x.pre.at)"],
  ['model freeze: a pre-flag upcoming- entry not read', " || (e.preMatch === undefined && /^upcoming-/.test(id))", ""],
  ['model freeze: a pre-flag past- entry read as pre-match', "&& /^upcoming-/.test(id))", "&& /^(upcoming|past)-/.test(id))"],
];

// Mutants applied to a copy of pipeline.yml, passed to the suite as TEN437_WORKFLOW (founder 2026-10-20: the store's cache).
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
const WORKFLOW_MUTANTS = [
  ['workflow: the model pre-match store never saved', "      - name: Save the model pre-match store\n", "      - name: Save a cache\n"],
  ['workflow: the store saved only when every step passed', "        if: ${{ always() && hashFiles('model-prematch.json') != '' }}\n", "        if: ${{ hashFiles('model-prematch.json') != '' }}\n"],
  ['workflow: the store restored from one fixed key (never the previous run\'s)', "          restore-keys: |\n            model-prematch-v1-\n", ""],
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
for (const [name, from, to] of WORKFLOW_MUTANTS) {
  if (WORKFLOW.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'pipeline.yml');
  fs.writeFileSync(file, WORKFLOW.replace(from, to));
  const r = run({ TEN437_WORKFLOW: file });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; }
  else console.log(`✔ caught: ${name}`);
}
for (const [file, envName, list] of [['career-backfill.js', 'TEN437_BACKFILL', BACKFILL_MUTANTS], ['bsp-pipeline.js', 'TEN437_PIPELINE', PIPELINE_MUTANTS]]) {
  const SRC = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const [name, from, to] of list) {
    if (SRC.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
    const copy = path.join(ROOT, `.ten437-mut-${file}`);
    try {
      fs.writeFileSync(copy, SRC.replace(from, to));
      const r = run({ [envName]: copy });
      if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
    } finally { fs.rmSync(copy, { force: true }); }
  }
}
fs.rmSync(dir, { recursive: true, force: true });
const total = CORE_MUTANTS.length + PAGE_MUTANTS.length + WORKFLOW_MUTANTS.length + BACKFILL_MUTANTS.length + PIPELINE_MUTANTS.length;
console.log(`mutants: ${total - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
