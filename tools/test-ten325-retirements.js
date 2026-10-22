#!/usr/bin/env node
/**
 * test-ten325-retirements.js — retirements in price figures, founder ruling 2026-10-22 (ruling 4; replaces TEN-312
 * ruling A): every priced retirement settles on PINNACLE's rule, whichever book priced it — first set completed → the
 * bet stands (a win at the winner's close, a loss at the retiree's); not completed (6-6 in the first-set tiebreak
 * included) → void, prices shown, no units; no stored set scores → no units, listed by name. Walkovers count nowhere.
 * Rules: .claude/rules/modal-analysis.md "Retirements in price figures — Pinnacle rules".
 *
 * 1. The player-profile Market edge builder (the rows the Match analysis tab's Match winner view and the
 *    per-event Backing tile read) keeps Tennis-Data "Retired" rows. Drives the REAL build-market-edge.js main()
 *    over a synthetic archive in a temp dir — never a copy of its rule.
 * 2. Form and H2H already settle retirements: their priced populations are `price != null` only and their
 *    flat 1u is the same formula as the Market edge core. Executed on the page's own row builders.
 *
 * Each check names the mutation that turns it red; `controls()` applies each one to a copy and requires red.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
let failures = 0;
const fail = (msg) => { console.error(`  FAIL ${msg}`); failures += 1; };
const ok = (msg) => console.log(`  ok   ${msg}`);

// ---- 1. the builder, end to end --------------------------------------------------------------------------
const HEAD = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
// A. Tester (key 9001) plays five priced matches: one completed win at 1.40, one win by the opponent's retirement at
// 1.50 AFTER the first set (stands), one loss by his own retirement at 1.80 DURING the first set (the archive's "Rrtired"
// typo; void), one walkover win and one "Awarded" win. The first sets come from started-evidence.json (ruling 4).
const ROWS = [
  '2025-03-01,Test Open,ATP250,Outdoor,Hard,1st Round,3,Tester A.,Alpha B.,10,20,Completed,1.4,3,1.4,3.1,1.4,3.1,1.38,3,file',
  '2025-03-02,Test Open,ATP250,Outdoor,Hard,2nd Round,3,Tester A.,Beta C.,10,30,Retired,1.5,2.6,1.5,2.7,1.5,2.7,1.48,2.6,file',
  '2025-03-03,Test Open,ATP250,Outdoor,Hard,Quarterfinals,3,Gamma D.,Tester A.,15,10,Rrtired,2.1,1.8,2.1,1.8,2.1,1.8,2.05,1.78,file',
  '2025-03-04,Test Open,ATP250,Outdoor,Hard,Semifinals,3,Tester A.,Delta E.,10,40,Walkover,1.3,3.6,1.3,3.6,1.3,3.6,1.28,3.5,file',
  '2025-03-05,Test Open,ATP250,Outdoor,Hard,The Final,3,Tester A.,Eps F.,10,50,Awarded,1.2,4.5,1.2,4.5,1.2,4.5,1.18,4.4,file',
];
// Founder ruling 2026-10-17: Market edge reads the ONE master file build-database-yield.js writes, so the chain is driven
// end to end — the real Database builder over the synthetic archive, then the real Market edge builder over its master.
const EVIDENCE = { matches: [], retired: [
  { date: '2025-03-02', tournament: 'Test Open', winner: 'Tester A.', loser: 'Beta C.', fs: 'c' },
  { date: '2025-03-03', tournament: 'Test Open', winner: 'Gamma D.', loser: 'Tester A.', fs: 'i' }] };
function runBuilder(builderSrc, dbSrc = DB_BUILDER, evidence = EVIDENCE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten325-'));
  if (evidence) fs.writeFileSync(path.join(dir, 'started-evidence.json'), JSON.stringify(evidence));
  for (const f of ['build-odds-performance.js', 'market-edge-core.js', 'td-identity.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'build-market-edge.js'), builderSrc);
  fs.writeFileSync(path.join(dir, 'build-database-yield.js'), dbSrc);
  fs.mkdirSync(path.join(dir, 'odds-archive'));
  fs.writeFileSync(path.join(dir, 'odds-archive', '2025.csv'), [HEAD].concat(ROWS).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'player-profiles.json'), JSON.stringify({ players: { 9001: { name: 'A. Tester' } } }));
  const d = spawnSync(process.execPath, [path.join(dir, 'build-database-yield.js')], { encoding: 'utf8' });
  if (d.status !== 0) throw new Error(`database builder exited ${d.status}: ${(d.stderr || '').slice(0, 400)}`);
  const r = spawnSync(process.execPath, [path.join(dir, 'build-market-edge.js'), '--quiet'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`builder exited ${r.status}: ${(r.stderr || '').slice(0, 400)}`);
  return JSON.parse(fs.readFileSync(path.join(dir, 'market-edge', '9001.json'), 'utf8'));
}
/** Violations of ruling 4 on the builder's shard for A. Tester. */
function checkBuilder(s) {
  const bad = [];
  const rows = s.matches.filter((m) => m.inBasis);
  const all = (x) => s.matches.find((m) => m.date === x);
  // mutation: void rows stay on the basis → n = 3
  if (rows.length !== 2) bad.push(`builder: ${rows.length} priced rows, want 2 (Completed + the Retired that stands; the void Rrtired, W/O and Awarded out)`);
  const d = (x) => rows.find((m) => m.date === x);
  if (!d('2025-03-02') || d('2025-03-02').settle !== 'stands') bad.push('builder: the retirement after the first set does not stand');
  // mutation: isRetiredComment matches only "retired" → the Rrtired row is an ordinary loss, priced −1u
  const v = all('2025-03-03');
  if (!v || v.settle !== 'void' || v.pl !== null || v.inBasis !== false || v.price !== 1.8) bad.push(`builder: the retirement during the first set is not void with its price shown (${JSON.stringify(v)})`);
  // mutation: stop excluding walkovers (`&& !retired` → `|| true`) → the W/O / Awarded rows enter
  if (d('2025-03-04') || d('2025-03-05')) bad.push('builder: a walkover / Awarded row entered the price population');
  // mutation: drop `ret: !!s.ret` from the row → the tab cannot mark it
  if (!(d('2025-03-02') && d('2025-03-02').ret === true && v && v.ret === true && d('2025-03-01') && d('2025-03-01').ret === false)) {
    bad.push('builder: rows do not carry ret = Tennis-Data "Retired"');
  }
  // Pinnacle rules: +0.40 (completed) +0.50 (won by retirement after the first set); the void loss carries nothing = +0.90u
  if (s.headline.n !== 2 || s.headline.units !== 0.9 || s.headline.wins !== 2) bad.push(`builder: headline n ${s.headline.n} W ${s.headline.wins} ${s.headline.units}u, want 2 · 2 · +0.90u`);
  if (d('2025-03-02') && d('2025-03-02').pl !== 0.5) bad.push('builder: a retired win at 1.50 after the first set does not settle at +0.50u');
  return bad;
}
/** No evidence file: every retirement carries no units (never guessed), listed in the index by name. */
function checkNoEvidence(s) {
  const bad = [];
  ['2025-03-02', '2025-03-03'].forEach((x) => { const r = s.matches.find((m) => m.date === x);
    if (!r || r.settle !== 'no-sets' || r.pl !== null || r.inBasis !== false) bad.push(`builder, no evidence: ${x} is not "no-sets" with no units (${JSON.stringify(r)})`); });
  if (s.headline.n !== 1) bad.push(`builder, no evidence: headline n ${s.headline.n}, want 1 (the completed match only)`);
  return bad;
}

// ---- 2. Form and H2H: already settled, kept -------------------------------------------------------------
function fnSrc(name, src) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(start, i + 1);
}
function constLine(name, src) { const s = src.indexOf(`\nconst ${name} = `); return src.slice(s, src.indexOf(';\n', s) + 1); }
/** The page's Form row builder + close picker, executed: a feed-flagged retirement comes out priced. */
function formRows(src) {
  const fns = ['escapeHtml', 'fhSafeId', 'ppCleanTournamentName', 'fhTournClean', 'fhSurfName', 'h2hRoundLabel', 'maRoundName', 'psRoundAbbr', 'fhRoundCode',
    'fhSetsFrom', 'psNormTour', 'fhBestOf', 'fhSetDone', 'fhFinishRow', 'fhDayNum', 'fhIsInitial', 'fhNameKey', 'fhPickBook', 'fhParseCloses',
    'fhCloseFor', 'fhRowFromForm'];
  const api = new Function(`${['FH_SLAMS', 'FH_BOOK_ORDER', 'FH_DASHC'].map((c) => constLine(c, src)).join('\n')}
    ${fns.map((f) => fnSrc(f, src)).join('\n')}
    return { fhRowFromForm, fhCloseFor, fhParseCloses };`)();
  const cl = api.fhParseCloses({ rows: [['2025-03-02', 'Beta C.', 1, 1.5, 2.7, null, null, 1, null], ['2025-03-03', 'Gamma D.', 0, 1.8, 2.1, null, null, 1, null]], cap: [] });
  return [
    { date: '2025-03-02', tournament: 'Test Open', surface: 'Hard', round: 'R32', opponent: 'C. Beta', won: true, result: '1 - 0', retired: true, sets: [{ p: 6, o: 3 }, { p: 2, o: 1 }] },
    { date: '2025-03-03', tournament: 'Test Open', surface: 'Hard', round: 'QF', opponent: 'D. Gamma', won: false, result: '0 - 1', retired: true, sets: [{ p: 4, o: 6 }, { p: 1, o: 2 }] },
    // ruling 4: retired during the first set (3-2) — void
    { date: '2025-03-03', tournament: 'Test Open', surface: 'Hard', round: 'QF', opponent: 'D. Gamma', won: false, result: '0 - 0', retired: true, sets: [{ p: 3, o: 2 }] },
  ].map((x, i) => {
    const r = api.fhRowFromForm(x, '9001', 'A. Tester', i);
    const c = api.fhCloseFor(cl, r.date, r.opp, r.won, r.oppKey, r.ek);
    if (c) { r.price = c.price; r.oppPrice = c.oppPrice; r.book = c.book; }
    return r;
  });
}
function checkFormH2h(src) {
  const bad = [];
  const form = fnSrc('fhFormPlayer', src);
  // Form's priced population and flat 1u, as the page computes them. mutation: `win.filter(r => r.price != null && !r.ret)`
  const pricedLine = /const priced = win\.filter\(r => r\.price != null && fhSettles\(r\)\), np = priced\.length;/;
  if (!pricedLine.test(form)) bad.push('Form: the priced population no longer settles retirements on Pinnacle rules (fhSettles)');
  // mutation: flat 1u voids retirements (`r.ret ? 0 : …`)
  if (!form.includes('flat: priceMetric(() => priced.reduce((s, r) => s + (r.won ? r.price - 1 : -1), 0)')) bad.push('Form: flat 1u is no longer won ? price − 1 : −1 over every priced row');
  // H2H Price range: every meeting with a price. mutation: `F.filter(r => r.price != null && !r.ret)`
  if (!/const PR = F\.filter\(r => r\.price != null\), nP = PR\.length;/.test(src)) bad.push('H2H: the Price range population is no longer "every meeting with a price"');
  // executed: the page's own Form rows for two retirements are priced, marked ret, and settle like the Market edge core
  const core = require(path.join(ROOT, 'market-edge-core.js'));
  let rows;
  try { rows = formRows(src); } catch (e) { bad.push(`Form: row builder failed: ${e.message}`); return bad; }
  if (!rows.every((r) => r.ret && r.price != null)) bad.push('Form: a feed-flagged retirement comes out unpriced or unmarked');
  const st = rows.map((r) => core.retSettlement(r));
  if (st.join() !== 'stands,stands,void') bad.push(`Form: Pinnacle rules read ${st.join()} (want stands, stands, void)`);
  const settled = rows.filter((r) => core.inWinner(r));
  const flat = settled.reduce((s, r) => s + (r.won ? r.price - 1 : -1), 0);
  const me = settled.reduce((s, r) => s + core.plCents(r), 0) / 100;
  if (settled.length !== 2 || Math.abs(flat - me) > 1e-9 || Math.abs(flat - -0.5) > 1e-9) bad.push(`Form flat 1u ${flat} over ${settled.length} ≠ Market edge ${me} (want −0.50u over 2: +0.50, −1; the void row out)`);
  return bad;
}

// ---- 3. the settlement label (founder 2026-09-28, TEN-314 comment 70fb039e) ------------------------------
// "Settle on the ATP result only … Wherever retirements are counted in profit (Market edge, Form, H2H, Tournament
// Backing), add a tooltip or footnote: 'Retirements settled on the official ATP result.'" One source: the core's
// RET_SETTLE_NOTE. The Market edge tab's two footnotes are checked RENDERED in test-ten310-market-edge.mjs; here: the
// exact text, and that H2H and both profile sites print the core's constant (never a copy of the words).
const NOTE = 'Retirements settle on Pinnacle rules for all rows.';
const PROFILE = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
function checkLabel(coreSrc, html, profile) {
  const bad = [];
  const m = /const RET_SETTLE_NOTE = '([^']*)';/.exec(coreSrc);
  if (!m || m[1] !== NOTE) bad.push(`core: RET_SETTLE_NOTE is ${m ? JSON.stringify(m[1]) : 'missing'}, not the founder's text`);
  if (!/const api = \{[^}]*\bRET_SETTLE_NOTE\b/.test(coreSrc)) bad.push('core: RET_SETTLE_NOTE is not exported');
  if (!/data-ret-note="h2h"[^`]*\$\{fhEsc\(globalThis\.MarketEdgeCore\.RET_SETTLE_NOTE\)\}/.test(html)) bad.push('H2H: the Price range card does not print the settlement note');
  if (!/data-ret-note="profile-me">' \+ esc\(window\.MarketEdgeCore\.RET_SETTLE_NOTE\)/.test(profile)) bad.push('profile: the Market edge line does not print the settlement note');
  if (!/data-ret-note="profile-backing" title="' \+ esc\(window\.MarketEdgeCore\.RET_SETTLE_NOTE\)/.test(profile)) bad.push('profile: the Backing column has no settlement tooltip');
  // one source: no surface spells the words out itself
  if (html.includes(NOTE) || profile.includes(NOTE)) bad.push('a surface hard-codes the note instead of reading RET_SETTLE_NOTE');
  return bad;
}
const CORE = fs.readFileSync(path.join(ROOT, 'market-edge-core.js'), 'utf8');
const l = checkLabel(CORE, HTML, PROFILE);
l.length ? l.forEach(fail) : ok('the settlement note: one constant, printed on H2H, profile Market edge and profile Backing');

// ---- run + controls ---------------------------------------------------------------------------------------
const BUILDER = fs.readFileSync(path.join(ROOT, 'build-market-edge.js'), 'utf8');
const DB_BUILDER = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
console.log('Ruling 4 (2026-10-22) — retirements settle on Pinnacle rules');
const b = checkBuilder(runBuilder(BUILDER));
b.length ? b.forEach(fail) : ok('builder: after the first set the bet stands, during it void (price shown, no units); W/O and Awarded out; ret marked');
const ne = checkNoEvidence(runBuilder(BUILDER, DB_BUILDER, null));
ne.length ? ne.forEach(fail) : ok('builder: no first-set evidence → no units, never guessed');
const f = checkFormH2h(HTML);
f.length ? f.forEach(fail) : ok('Form settles on Pinnacle rules (a void retirement leaves the priced population); H2H price range keeps every price');

function controls() {
  const once = (src, from, to, name) => { if (src.split(from).length !== 2) throw new Error(`mutant anchor not unique/present: ${name}`); return src.replace(from, to); };
  // [name, from, to, which builder]: the population filter lives in the master's builder now (build-database-yield.js)
  const BM = [
    ['master: back to "Completed" only', "const RETIRED = new Set(['Retired', 'Rrtired']);", 'const RETIRED = new Set([]);', 'db'],
    ['builder: typo row missed', "new Set(['retired', 'rrtired'])", "new Set(['retired'])", 'me'],
    ['master: non-results let in', "else if (!RESULT_STANDS.has(comment) && !completedNonResult) { bucket.edge++; if (!startedNonResult) return; }", 'else if (false) { bucket.edge++; }', 'db'],
    ['builder: ret not stamped', 'ret: !!s.ret,', '', 'me'],
    ['builder: void rows stay on the basis', "core.bandOf(side.price) >= 0 && core.retSettlement(side) !== 'void' &&", "core.bandOf(side.price) >= 0 && true &&", 'me'],
  ];
  const HM = [
    ['Form: void retirements priced again', 'const priced = win.filter(r => r.price != null && fhSettles(r)), np', 'const priced = win.filter(r => r.price != null), np'],
    ['Form: flat 1u voids retirements', 'flat: priceMetric(() => priced.reduce((s, r) => s + (r.won ? r.price - 1 : -1), 0)', 'flat: priceMetric(() => priced.reduce((s, r) => s + (r.ret ? 0 : r.won ? r.price - 1 : -1), 0)'],
    ['H2H: price range drops retirements', 'const PR = F.filter(r => r.price != null), nP', 'const PR = F.filter(r => r.price != null && !r.ret), nP'],
    ['Form rows: retirement unpriced', 'fhRowFromForm(x, selfKey, selfName, idx){', 'fhRowFromForm(x, selfKey, selfName, idx){ if (x.retired) x = Object.assign({}, x, { date: "1900-01-01" });'],
  ];
  const LM = [
    ['label: wording changed', "RET_SETTLE_NOTE = 'Retirements settle on Pinnacle rules for all rows.'", "RET_SETTLE_NOTE = 'Retirements settled on the official ATP result.'", 'core'],
    ['label: not exported', 'const api = { matchFormat, RET_SETTLE_NOTE, ', 'const api = { matchFormat, ', 'core'],
    ['label: H2H footnote dropped', 'data-ret-note="h2h"', 'data-x="h2h"', 'html'],
    ['label: profile Market edge line dropped', 'data-ret-note="profile-me"', 'data-x="profile-me"', 'profile'],
    ['label: Backing tooltip dropped', "' data-ret-note=\"profile-backing\" title=\"' + esc(window.MarketEdgeCore.RET_SETTLE_NOTE) + '\"'", "''", 'profile'],
    ['label: hard-coded copy', 'data-ret-note="h2h" style', 'data-ret-note="h2h" title="Retirements settle on Pinnacle rules for all rows." style', 'html'],
  ];
  let caught = 0;
  for (const [name, from, to, where] of LM) {
    const src = { core: CORE, html: HTML, profile: PROFILE };
    src[where] = once(src[where], from, to, name);
    if (checkLabel(src.core, src.html, src.profile).length) caught++; else fail(`control survived: ${name}`);
  }
  for (const [name, from, to, w] of BM) {
    const out = w === 'db' ? runBuilder(BUILDER, once(DB_BUILDER, from, to, name)) : runBuilder(once(BUILDER, from, to, name));
    if (checkBuilder(out).length) caught++; else fail(`control survived: ${name}`);
  }
  for (const [name, from, to] of HM) { if (checkFormH2h(once(HTML, from, to, name)).length) caught++; else fail(`control survived: ${name}`); }
  console.log(`  mutants: ${caught} of ${LM.length + BM.length + HM.length} caught`);
}
controls();
if (failures) { console.error(`test-ten325-retirements: ${failures} failure(s)`); process.exit(1); }
console.log('test-ten325-retirements: all checks pass');
