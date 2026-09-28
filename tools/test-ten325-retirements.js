#!/usr/bin/env node
/**
 * test-ten325-retirements.js — TEN-312 retirement ruling A (founder, 2026-09-28; TEN-325).
 *
 *   An in-match retirement is a priced match everywhere, settled at the listed closing price: a win at the
 *   winner's close, a loss at the retiree's. Walkovers count nowhere. Rules: .claude/rules/modal-analysis.md
 *   "Retirements in price figures", .claude/rules/modal-market-edge.md "Retirements settle at the listed price".
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
// 1.50, one loss by his own retirement at 1.80 (the archive's "Rrtired" typo), one walkover win and one "Awarded" win.
const ROWS = [
  '2025-03-01,Test Open,ATP250,Outdoor,Hard,1st Round,3,Tester A.,Alpha B.,10,20,Completed,1.4,3,1.4,3.1,1.4,3.1,1.38,3,file',
  '2025-03-02,Test Open,ATP250,Outdoor,Hard,2nd Round,3,Tester A.,Beta C.,10,30,Retired,1.5,2.6,1.5,2.7,1.5,2.7,1.48,2.6,file',
  '2025-03-03,Test Open,ATP250,Outdoor,Hard,Quarterfinals,3,Gamma D.,Tester A.,15,10,Rrtired,2.1,1.8,2.1,1.8,2.1,1.8,2.05,1.78,file',
  '2025-03-04,Test Open,ATP250,Outdoor,Hard,Semifinals,3,Tester A.,Delta E.,10,40,Walkover,1.3,3.6,1.3,3.6,1.3,3.6,1.28,3.5,file',
  '2025-03-05,Test Open,ATP250,Outdoor,Hard,The Final,3,Tester A.,Eps F.,10,50,Awarded,1.2,4.5,1.2,4.5,1.2,4.5,1.18,4.4,file',
];
function runBuilder(builderSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten325-'));
  for (const f of ['build-odds-performance.js', 'market-edge-core.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'build-market-edge.js'), builderSrc);
  fs.mkdirSync(path.join(dir, 'odds-archive'));
  fs.writeFileSync(path.join(dir, 'odds-archive', '2025.csv'), [HEAD].concat(ROWS).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'player-profiles.json'), JSON.stringify({ players: { 9001: { name: 'A. Tester' } } }));
  const r = spawnSync(process.execPath, [path.join(dir, 'build-market-edge.js'), '--quiet'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`builder exited ${r.status}: ${(r.stderr || '').slice(0, 400)}`);
  return JSON.parse(fs.readFileSync(path.join(dir, 'market-edge', '9001.json'), 'utf8'));
}
/** Violations of ruling A on the builder's shard for A. Tester. */
function checkBuilder(s) {
  const bad = [];
  const rows = s.matches.filter((m) => m.inBasis);
  // mutation: revert the builder's filter to `comment !== 'completed'` → n = 1
  if (rows.length !== 3) bad.push(`builder: ${rows.length} priced rows, want 3 (Completed + Retired + Rrtired; W/O and Awarded out)`);
  const d = (x) => rows.find((m) => m.date === x);
  // mutation: isRetiredComment matches only "retired" → the Rrtired row is dropped
  if (!d('2025-03-03')) bad.push('builder: the "Rrtired" row (archive typo) is not settled');
  // mutation: stop excluding walkovers (`&& !retired` → `|| true`) → the W/O / Awarded rows enter
  if (d('2025-03-04') || d('2025-03-05')) bad.push('builder: a walkover / Awarded row entered the price population');
  // mutation: drop `ret: !!s.ret` from the row → the tab cannot mark it
  if (!(d('2025-03-02') && d('2025-03-02').ret === true && d('2025-03-03') && d('2025-03-03').ret === true && d('2025-03-01') && d('2025-03-01').ret === false)) {
    bad.push('builder: rows do not carry ret = Tennis-Data "Retired"');
  }
  // settled at the listed close: +0.40 (completed) +0.50 (won by retirement) −1 (he retired) = −0.10u
  if (s.headline.n !== 3 || s.headline.units !== -0.1 || s.headline.wins !== 2) bad.push(`builder: headline n ${s.headline.n} W ${s.headline.wins} ${s.headline.units}u, want 3 · 2 · −0.10u`);
  if (d('2025-03-02') && d('2025-03-02').pl !== 0.5) bad.push('builder: a retired win at 1.50 does not settle at +0.50u');
  if (d('2025-03-03') && d('2025-03-03').pl !== -1) bad.push('builder: his retirement at 1.80 does not settle at −1u');
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
  const fns = ['escapeHtml', 'fhSafeId', 'ppCleanTournamentName', 'fhTournClean', 'fhSurfName', 'h2hRoundLabel', 'psRoundAbbr', 'fhRoundCode',
    'fhSetsFrom', 'psNormTour', 'fhBestOf', 'fhSetDone', 'fhFinishRow', 'fhDayNum', 'fhIsInitial', 'fhNameKey', 'fhPickBook', 'fhParseCloses',
    'fhCloseFor', 'fhRowFromForm'];
  const api = new Function(`${['FH_SLAMS', 'FH_BOOK_ORDER', 'FH_DASHC'].map((c) => constLine(c, src)).join('\n')}
    ${fns.map((f) => fnSrc(f, src)).join('\n')}
    return { fhRowFromForm, fhCloseFor, fhParseCloses };`)();
  const cl = api.fhParseCloses({ rows: [['2025-03-02', 'Beta C.', 1, 1.5, 2.7, null, null, 1, null], ['2025-03-03', 'Gamma D.', 0, 1.8, 2.1, null, null, 1, null]], cap: [] });
  return [
    { date: '2025-03-02', tournament: 'Test Open', surface: 'Hard', round: 'R32', opponent: 'C. Beta', won: true, result: '1 - 0', retired: true, sets: [{ p: 6, o: 3 }, { p: 2, o: 1 }] },
    { date: '2025-03-03', tournament: 'Test Open', surface: 'Hard', round: 'QF', opponent: 'D. Gamma', won: false, result: '0 - 1', retired: true, sets: [{ p: 4, o: 6 }, { p: 1, o: 2 }] },
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
  const pricedLine = /const priced = win\.filter\(r => r\.price != null\), np = priced\.length;/;
  if (!pricedLine.test(form)) bad.push('Form: the priced population is no longer "every row with a price" (a retirement would be unsettled)');
  // mutation: flat 1u voids retirements (`r.ret ? 0 : …`)
  if (!form.includes('flat: priceMetric(() => priced.reduce((s, r) => s + (r.won ? r.price - 1 : -1), 0)')) bad.push('Form: flat 1u is no longer won ? price − 1 : −1 over every priced row');
  // H2H Price range: every meeting with a price. mutation: `F.filter(r => r.price != null && !r.ret)`
  if (!/const PR = F\.filter\(r => r\.price != null\), nP = PR\.length;/.test(src)) bad.push('H2H: the Price range population is no longer "every meeting with a price"');
  // executed: the page's own Form rows for two retirements are priced, marked ret, and settle like the Market edge core
  const core = require(path.join(ROOT, 'market-edge-core.js'));
  let rows;
  try { rows = formRows(src); } catch (e) { bad.push(`Form: row builder failed: ${e.message}`); return bad; }
  if (!rows.every((r) => r.ret && r.price != null)) bad.push('Form: a feed-flagged retirement comes out unpriced or unmarked');
  const flat = rows.reduce((s, r) => s + (r.won ? r.price - 1 : -1), 0);
  const me = rows.reduce((s, r) => s + core.plCents(r), 0) / 100;
  if (Math.abs(flat - me) > 1e-9 || Math.abs(flat - -0.5) > 1e-9) bad.push(`Form flat 1u ${flat} ≠ Market edge ${me} (want −0.50u: +0.50 won by retirement, −1 retired)`);
  return bad;
}

// ---- run + controls ---------------------------------------------------------------------------------------
const BUILDER = fs.readFileSync(path.join(ROOT, 'build-market-edge.js'), 'utf8');
console.log('TEN-325 ruling A — retirements settle at the listed price');
const b = checkBuilder(runBuilder(BUILDER));
b.length ? b.forEach(fail) : ok('builder keeps Retired / Rrtired rows at their close, drops W/O and Awarded, marks ret');
const f = checkFormH2h(HTML);
f.length ? f.forEach(fail) : ok('Form and H2H settle retirements (priced = has a price; flat 1u = Market edge P&L)');

function controls() {
  const once = (src, from, to, name) => { if (src.split(from).length !== 2) throw new Error(`mutant anchor not unique/present: ${name}`); return src.replace(from, to); };
  const BM = [
    ['builder: back to "Completed" only', "if (row.comment && row.comment.toLowerCase() !== 'completed' && !retired)", "if (row.comment && row.comment.toLowerCase() !== 'completed')"],
    ['builder: typo row missed', "new Set(['retired', 'rrtired'])", "new Set(['retired'])"],
    ['builder: walkovers let in', "if (row.comment && row.comment.toLowerCase() !== 'completed' && !retired)", 'if (false)'],
    ['builder: ret not stamped', 'ret: !!s.ret,', ''],
  ];
  const HM = [
    ['Form: priced drops retirements', 'const priced = win.filter(r => r.price != null), np', 'const priced = win.filter(r => r.price != null && !r.ret), np'],
    ['Form: flat 1u voids retirements', 'flat: priceMetric(() => priced.reduce((s, r) => s + (r.won ? r.price - 1 : -1), 0)', 'flat: priceMetric(() => priced.reduce((s, r) => s + (r.ret ? 0 : r.won ? r.price - 1 : -1), 0)'],
    ['H2H: price range drops retirements', 'const PR = F.filter(r => r.price != null), nP', 'const PR = F.filter(r => r.price != null && !r.ret), nP'],
    ['Form rows: retirement unpriced', 'fhRowFromForm(x, selfKey, selfName, idx){', 'fhRowFromForm(x, selfKey, selfName, idx){ if (x.retired) x = Object.assign({}, x, { date: "1900-01-01" });'],
  ];
  let caught = 0;
  for (const [name, from, to] of BM) { if (checkBuilder(runBuilder(once(BUILDER, from, to, name))).length) caught++; else fail(`control survived: ${name}`); }
  for (const [name, from, to] of HM) { if (checkFormH2h(once(HTML, from, to, name)).length) caught++; else fail(`control survived: ${name}`); }
  console.log(`  mutants: ${caught} of ${BM.length + HM.length} caught`);
}
controls();
if (failures) { console.error(`test-ten325-retirements: ${failures} failure(s)`); process.exit(1); }
console.log('test-ten325-retirements: all checks pass');
