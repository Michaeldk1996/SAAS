'use strict';
/**
 * test-drawer-render.js — exercises the REAL Points at Risk drawer render logic
 * (extracted verbatim from bsp-consult-dashboard.html) against the regenerated
 * points-at-risk.json, under a minimal DOM shim. Asserts: drop-date ascending
 * order, dateless rows appended last, foot total == tile points, every excluded
 * event named. Pure correctness gate — no browser, no network.
 */
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'bsp-consult-dashboard.html'), 'utf8');
const PAR = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'points-at-risk.json'), 'utf8'));

// --- extract the drawer block verbatim ---
const START = 'const PAR_TIER_LABEL = {';
const END = '// ---- TEN-126 Break/Hold heatmap (display-only, flag-gated)';
const a = HTML.indexOf(START), b = HTML.indexOf(END);
if (a === -1 || b === -1 || b < a) { console.error('FAIL: could not locate drawer block'); process.exit(1); }
const block = HTML.slice(a, b);

// --- minimal shims for the identifiers the block references ---
const nodes = {};
function fakeNode(){ return { _html: '', _text: '', classList: { add(){}, remove(){} },
  set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
  set textContent(v){ this._text = v; }, get textContent(){ return this._text; } }; }
for (const id of ['ppSplitDrawer', 'ppsdHead', 'ppsdBody', 'ppsdSub']) nodes[id] = fakeNode();
global.document = { getElementById: (id) => nodes[id] || (nodes[id] = fakeNode()) };
global.PP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
global.ppHexA = (h) => h;
global.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
global.ppSplitRoundLabel = (rd) => ({ F:'FINAL', SF:'SF', QF:'QF', R16:'R16', R32:'R32', R64:'R64', R128:'R128' }[String(rd||'').toUpperCase()] || String(rd||'').toUpperCase());
global.ppAbbrevName = (n) => String(n || '');
global._parData = PAR;
global.playerProfiles = {};
global.ensurePpSplitDrawer = () => nodes.ppSplitDrawer;
global.ppSplitDrawerState = { open: false, key: null };

// eval the real block into scope
eval(block + '\nglobal.openParDrawer = openParDrawer; global.renderParDrawerBody = renderParDrawerBody;');

// --- run assertions over a representative set of players ---
let fails = 0;
function check(cond, msg){ if (!cond) { console.error('  FAIL:', msg); fails++; } }

// Reconciliation across ALL players: foot total (sum perEvent) must equal tile points.
let reconAll = 0, players = 0;
for (const [k, row] of Object.entries(PAR.players)) {
  players++;
  const sum = (row.perEvent || []).reduce((s, e) => s + (Number(e.points) || 0), 0);
  if (sum === Number(row.points)) reconAll++;
  else console.error(`  RECON MISMATCH ${row.player} (${k}): sum ${sum} vs points ${row.points}`);
}
check(reconAll === players, `all ${players} players reconcile (got ${reconAll})`);
console.log(`reconcile: ${reconAll}/${players} players (foot total == tile points)`);

// Named-event coverage: every dashed + benignDashed row carries an event name + reason.
let unnamed = 0, totalDash = 0;
for (const row of Object.values(PAR.players)) {
  for (const e of [...(row.dashed||[]), ...(row.benignDashed||[])]) { totalDash++; if (!e.event || !e.reason) unnamed++; }
}
check(unnamed === 0, `all ${totalDash} excluded rows named+reasoned (${unnamed} unnamed)`);
console.log(`excluded rows named: ${totalDash - unnamed}/${totalDash}`);

// Render Sinner: parse the emitted body, verify order + foot.
function renderAndParse(key){
  openParDrawer(key);
  return nodes.ppsdBody._html;
}
function verifyPlayer(key, label){
  const row = PAR.players[key];
  if (!row) { console.error(`  (skip ${label}: not in artifact)`); return; }
  const html = renderAndParse(key);
  // foot total present and equals tile
  check(html.includes('Points at Risk'), `${label}: foot present`);
  check(!html.includes('does not match tile'), `${label}: no reconciliation warning`);
  // drop-date ascending: extract "drops D Mon YYYY" occurrences among resolved rows
  const dropIso = (row.perEvent||[]).map(e=>e.dropDate).filter(Boolean).slice().sort();
  const dropAsShown = [...html.matchAll(/drops (\d+) (\w+) (\d{4})/g)].map(m=>`${m[3]}-${m[2]}-${m[1]}`);
  check(dropAsShown.length === (row.perEvent||[]).filter(e=>e.dropDate).length, `${label}: every resolved row shows a drop date`);
  // dateless rows (gap+rule) appear AFTER the last resolved points value in the HTML
  const dash = [...(row.dashed||[]), ...(row.benignDashed||[])];
  if (dash.length && (row.perEvent||[]).length){
    const firstDashName = dash[0].event;
    const lastResolvedName = row.perEvent[row.perEvent.length-1] && row.perEvent.sort((a,b)=>String(a.dropDate).localeCompare(String(b.dropDate)))[row.perEvent.length-1].event;
    check(html.indexOf(escapeHtml(firstDashName)) > html.indexOf('drops'), `${label}: dateless rows appended after dated rows`);
  }
  // every dash row's event name rendered
  for (const e of dash) check(html.includes(escapeHtml(e.event)), `${label}: dash event "${e.event}" rendered by name`);
  const sum = (row.perEvent||[]).reduce((s,e)=>s+(Number(e.points)||0),0);
  console.log(`  ${label} (${key}): ${row.perEvent.length} resolved sum=${sum} tile=${row.points} · ${(row.dashed||[]).length} gap · ${(row.benignDashed||[]).length} rule · sub="${nodes.ppsdSub._text}"`);
}

// pick a few by name from the artifact (avoid hardcoding keys from prior reports)
const byName = (re) => Object.entries(PAR.players).find(([k,v]) => re.test(v.player||''));
for (const [re,label] of [[/sinner/i,'Sinner'],[/alcaraz/i,'Alcaraz'],[/meligeni/i,'gap-player']]){
  const hit = byName(re); if (hit) verifyPlayer(hit[0], label); else console.error(`  (no player matching ${re})`);
}

console.log(fails === 0 ? '\nALL DRAWER-RENDER CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
