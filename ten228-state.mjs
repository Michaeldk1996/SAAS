#!/usr/bin/env node
/**
 * ten228-state.mjs — START-STATE measurement on the DEPLOYED site.
 *
 * Reads, out of a real browser, exactly what §5.5/5.6/5.7/5.8/5.9/§6 render
 * TODAY, so the build that follows is measured against fact rather than against
 * the brief's prose. A read, not a screenshot.
 *
 * Usage: node ten228-state.mjs <baseUrl> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://michaeldk1996.github.io/SAAS';
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '1775', '370'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

const dport = 9700 + Math.floor((Date.now() / 1000) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ten228-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1512,982', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || JSON.stringify(d)).slice(0, 600));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });

for (let i = 0; i < 240; i++) {
  if (await ev(`!!(window.PlayerProfileV2 && window.PlayerProfileV2._internals)
    && typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles || {}).length > 0`)) break;
  await sleep(250);
}

console.log(`=== base ${BASE} ===`);
console.log('build-info: ' + JSON.stringify(await ev(`fetch('./build-info.json').then(r=>r.json()).then(j=>j.commit.slice(0,8)+' @ '+j.builtAt)`)));

// ── R4 · search index -------------------------------------------------------
const search = await ev(`(async function(){
  await loadPlayerIndex();
  var idx = playerIndex || [];
  var noProf = idx.filter(function(r){ return !r.hasProfile; });
  // The claim R4 makes is about the RENDERED result, so render one.
  var probe = noProf[0];
  renderPlayerSearch(probe ? probe.name.slice(0,6) : 'zzzz');
  var box = document.getElementById('playerSearchResults');
  var items = Array.prototype.slice.call(box.querySelectorAll('.psearch-item'));
  return {
    total: idx.length, noProfile: noProf.length,
    probeName: probe && probe.name,
    rendered: items.map(function(el){ return {
      text: el.innerText.replace(/\\s+/g,' ').trim(),
      clickable: !!el.getAttribute('onclick'),
      cls: el.className }; }).slice(0,4)
  };
})()`);
console.log('\n--- R4 search ---');
console.log(`  index ${search.total} players · ${search.noProfile} with NO profile shard`);
console.log(`  probe "${search.probeName}" ->`);
search.rendered.forEach(r => console.log(`    [${r.clickable ? 'clickable' : 'dead'}] ${r.text}  (${r.cls})`));

// ── per player --------------------------------------------------------------
for (const key of KEYS) {
  const got = await ev(`ensurePlayerProfile(${JSON.stringify(key)})`);
  if (!got) { console.log(`\n### ${key}: profiles/${key}.json did not load`); continue; }
  await ev(`showPlayerProfileV2(${JSON.stringify(key)})`);
  for (let i = 0; i < 160; i++) {
    if (await ev(`!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}])`)) break;
    await sleep(250);
  }
  const r = await ev(`(function(){
    var I = window.PlayerProfileV2._internals, k = ${JSON.stringify(key)};
    var p = I.profileFor(k); if (!p) return { error: 'no profile' };
    var spine = I.calSpine(p);
    var withSets = spine.filter(function(m){ return m.sets && m.sets.length; }).length;
    var out = { name: p.name, spine: spine.length, spineWithSets: withSets };
    // R5(b)(c) — SETS / SET SCORES coverage over the deployed store
    var rf = (p.recentForm && p.recentForm.matches) || [];
    out.recentForm = rf.length;
    out.rfWithSets = rf.filter(function(m){ return m.sets && m.sets.length; }).length;
    var ch = (window.careerHistory && window.careerHistory[k]) || [];
    out.careerHistory = ch.length;
    out.chWithSets = ch.filter(function(m){ return m.sets && m.sets.length; }).length;
    out.chSrc = ch.reduce(function(a,m){ a[m.src||'?'] = (a[m.src||'?']||0)+1; return a; }, {});
    // §5.7 splits — which tabs exist
    var sp = I.splitsFor ? I.splitsFor(k) : null;
    out.splits = sp ? Object.keys(sp) : null;
    out.splitsCareerKeys = sp && sp.career ? Object.keys(sp.career).length : 0;
    // §5.8 market
    var mk = I.marketFor ? I.marketFor(k) : null;
    out.market = mk ? { n: mk.headline && mk.headline.n, book: mk.headline && mk.headline.book,
      bands: mk.bands ? (mk.bands.favourite||[]).length + (mk.bands.underdog||[]).length : 0,
      curve: (mk.curve||[]).length, matches: (mk.matches||[]).length,
      basis: mk.priceBasis } : null;
    // §6 key insights — what the page actually prints
    out.insights = (p.insights||[]).map(function(x){ return (x.title||'') + ' | ' + (x.text||''); });
    // §5.9 playing profile
    out.dna = p.dna ? Object.keys(p.dna) : null;
    out.statsAll = p.statsAll ? Object.keys(p.statsAll).length : 0;
    out.surfacesAgg = p.surfaces ? Object.keys(p.surfaces) : null;
    return out;
  })()`);
  if (r.error) { console.log(`\n### ${key}: ${r.error}`); continue; }
  console.log(`\n### ${r.name} (${key})`);
  console.log(`  spine ${r.spine} · rows carrying sets[] ${r.spineWithSets} (${(100*r.spineWithSets/Math.max(1,r.spine)).toFixed(1)}%)`);
  console.log(`  recentForm ${r.recentForm} (sets ${r.rfWithSets}) · careerHistory ${r.careerHistory} (sets ${r.chWithSets}) src ${JSON.stringify(r.chSrc)}`);
  console.log(`  splits scopes ${JSON.stringify(r.splits)} · career members ${r.splitsCareerKeys}`);
  console.log(`  market ${JSON.stringify(r.market)}`);
  console.log(`  dna axes ${JSON.stringify(r.dna)} · statsAll keys ${r.statsAll} · surfaces ${JSON.stringify(r.surfacesAgg)}`);
  console.log(`  insights (${r.insights.length}):`);
  r.insights.forEach(t => console.log(`    - ${t}`));

  // Drive the eight boxes and read each modal's headline text.
  // Re-query the box on every iteration: closing a modal repaints the grid, so a
  // NodeList captured once holds DETACHED nodes from the second box on and every
  // click after the first lands on nothing. That reads as "seven modals do not
  // open" — a probe artifact, not a page defect.
  const modals = await ev(`(async function(){
    var out = [];
    var names = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'))
      .map(function(el){ return el.getAttribute('data-box'); });
    for (var i = 0; i < names.length; i++) {
      var box = document.querySelector('[data-pp2="box"][data-box="' + names[i] + '"]');
      if (!box) { out.push({ box: names[i], len: 0, head: '(box gone)' }); continue; }
      box.click();
      await new Promise(function(r){ setTimeout(r, 1200); });
      var scrim = document.querySelector('[data-pp2="scrim"]');
      var txt = scrim ? scrim.innerText.replace(/\\s+/g,' ').trim() : '(no scrim)';
      out.push({ box: names[i], len: txt.length, head: txt.slice(0, 300) });
      var close = scrim && scrim.querySelector('[data-pp2="close"]');
      if (close) close.click(); else if (scrim) scrim.click();
      await new Promise(function(r){ setTimeout(r, 200); });
    }
    return out;
  })()`);
  console.log('  --- modals ---');
  (modals || []).forEach(m => console.log(`   [${m.box}] ${m.len}ch :: ${m.head}`));
}

try { ws.close(); } catch { /* closing */ }
chrome.kill();
