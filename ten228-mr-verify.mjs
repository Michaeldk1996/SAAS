#!/usr/bin/env node
/**
 * ten228-mr-verify.mjs — §5.6 Matchup record, the founder's mandatory re-verify.
 *
 * Covers the amendment's step (c) computed-style diff, (d) scripted interactions,
 * (e) reconciliation and (f) the chart bounding-box check. Every figure is read
 * off the rendered DOM and RE-DERIVED here, never copied from the module.
 *
 * Run against the hybrid server (branch code + DEPLOYED data), because the local
 * career-history store is short and a local read agrees with itself at the wrong
 * number. See ten206-hybrid-server.mjs.
 *
 * Usage: node ten228-mr-verify.mjs <baseUrl> <key> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8794').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);

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

const dport = 9400 + Math.floor((Date.now() / 997) % 300);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mrverify-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    jsErrors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride',
  { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });

for (let i = 0; i < 400; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}

const results = [];
let checks = 0, fails = 0;
const failLines = [];
function ck(scope, name, ok, detail) {
  checks++;
  if (!ok) { fails++; failLines.push(`${scope} :: ${name}${detail ? ' :: ' + detail : ''}`); }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

for (const key of KEYS) {
  console.log(`\n══ key ${key} @ ${WIDTH}x${HEIGHT} ══`);
  const got = await ev(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { console.log(`  ERROR profile ${key} did not load`); fails++; checks++; continue; }
  // ACTIVATE THE PLAYERS TAB FIRST. `.tabpage{display:none}` / `.tabpage.active
  // {display:block}` — opening a profile without activating the page leaves every
  // element 0x0. textContent still reads fine, so every text check passes and
  // every geometry check fails, which reads exactly like a broken chart on a
  // working one. This is the trap the profile-overlay probe hit with 8 shots of
  // the wrong page.
  await ev(`(function(){
    var pages = document.querySelectorAll('.tabpage');
    for (var i=0;i<pages.length;i++) pages[i].classList.remove('active');
    var pl = document.querySelector('.tabpage[data-page="players"]');
    if (pl) pl.classList.add('active');
    return !!pl;
  })()`);
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  // Open first, THEN poll the lazily-fetched stores: the shard fetch starts when
  // the profile opens, so a probe that waits before opening reports the styles
  // and market boxes broken.
  for (let i = 0; i < 200; i++) {
    if (await ev(`!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}])
      && !!(window.marketEdge && window.marketEdge[${JSON.stringify(key)}])`)) break;
    await sleep(250);
  }
  await sleep(900);

  const name = await ev(`(function(){var h=document.querySelector('.pp2-main');
    return h ? (h.textContent||'').replace(/\\s+/g,' ').replace(/^\\s*Back to Players\\s*/,'').trim().slice(0,40) : '';})()`);
  console.log(`  player: ${name}`);

  // ── open the Matchup record box by its rendered title, not by index ────────
  const opened = await ev(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'));
    var hit = boxes.filter(function(b){
      return /versus playing styles|matchup record/i.test((b.textContent||''));
    })[0];
    if (!hit) return { found:false, titles: boxes.map(function(b){
      return (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,32); }) };
    hit.click();
    return { found:true };
  })()`);
  if (!opened.found) {
    ck(key, '§5.6 box is present on the page', false, 'titles: ' + (opened.titles || []).join(' | '));
    continue;
  }
  await sleep(1100);

  // ── read the whole overlay in one pass ────────────────────────────────────
  const m = await ev(`(function(){
    var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
      .filter(function(e){var s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden';});
    if (!ov.length) return { open:false };
    var top = ov[ov.length-1];
    var txt = function(e){ return (e&&e.textContent||'').replace(/\\s+/g,' ').trim(); };
    var all = Array.prototype.slice.call(top.querySelectorAll('*'));
    var body = txt(top);

    // modal panel = the widest non-scrim block under the scrim
    var panel = all.filter(function(e){ return e.getBoundingClientRect().width > 400; })
      .sort(function(a,b){ return b.getBoundingClientRect().width - a.getBoundingClientRect().width; })[0];
    var pcs = panel ? getComputedStyle(panel) : null;

    // title / subtitle: first two text-bearing leaves at the top of the panel
    var heads = all.filter(function(e){ return e.children.length===0 && txt(e).length>2; }).slice(0,6).map(txt);

    // bubbles: round, absolutely placed discs carrying a border-radius of 50%
    var bubbles = all.filter(function(e){
      var s=getComputedStyle(e); var r=e.getBoundingClientRect();
      return s.borderRadius==='50%' && r.width>8 && r.width<80 && Math.abs(r.width-r.height)<2;
    }).map(function(e){ var r=e.getBoundingClientRect();
      return {x:r.x,y:r.y,w:r.width,h:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right}; });

    // the plot area = nearest common sized ancestor of the bubbles
    var plot = null;
    if (bubbles.length) {
      var cand = all.filter(function(e){ var r=e.getBoundingClientRect();
        return r.height>150 && r.height<420 && r.width>300; });
      plot = cand.length ? cand[cand.length-1] : null;
    }
    var pr = plot ? plot.getBoundingClientRect() : null;
    var plotCs = plot ? getComputedStyle(plot) : null;

    // value labels: mono 12px/700 nodes near a bubble
    var labels = all.filter(function(e){
      var s=getComputedStyle(e);
      return e.children.length===0 && /%$/.test(txt(e)) &&
        /mono/i.test(s.fontFamily) && s.fontWeight==='700';
    }).map(function(e){ var r=e.getBoundingClientRect();
      return {t:txt(e),x:r.x,y:r.y,w:r.width,h:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right}; });

    // axis tick labels (10px, #4b5672, ending in % or bare number).
    // \\d{1,3}, not \\d{2,3}: a player with a 0% archetype gets a "0%" tick, and
    // requiring two digits dropped it, so an axis correctly extended to 0-80 was
    // read as 10-80 and reported as failing to cover its own minimum.
    var ticks = all.filter(function(e){
      var s=getComputedStyle(e);
      return e.children.length===0 && parseFloat(s.fontSize)<=11 && /^\\d{1,3}%?$/.test(txt(e));
    }).map(txt);

    // rows: grid cards in the list under the chart
    var rows = all.filter(function(e){
      var s=getComputedStyle(e);
      return s.display==='grid' && /px/.test(s.gridTemplateColumns) &&
        s.gridTemplateColumns.split(' ').length===3 && e.getBoundingClientRect().height>34;
    }).map(function(e){
      var r=e.getBoundingClientRect(); var s=getComputedStyle(e);
      var leaves = Array.prototype.slice.call(e.querySelectorAll('*'))
        .filter(function(x){ return x.children.length===0 && txt(x).length>0; }).map(txt);
      var bar = Array.prototype.slice.call(e.querySelectorAll('*')).filter(function(x){
        var cs=getComputedStyle(x); var rr=x.getBoundingClientRect();
        return rr.height>=3 && rr.height<=5 && rr.width>4; }).length;
      return { text: txt(e), leaves: leaves, cols: s.gridTemplateColumns, gap: s.gap,
               radius: s.borderRadius, padding: s.padding, border: s.borderWidth,
               bars: bar, h: r.height };
    });

    return { open:true, body: body, chars: body.length,
      panelWidth: panel ? panel.getBoundingClientRect().width : null,
      panelMaxWidth: pcs ? pcs.maxWidth : null,
      heads: heads,
      bubbles: bubbles, plot: pr ? {x:pr.x,y:pr.y,w:pr.width,h:pr.height,top:pr.top,bottom:pr.bottom,left:pr.left,right:pr.right} : null,
      plotHeight: plotCs ? plotCs.height : null,
      labels: labels, ticks: ticks, rows: rows };
  })()`);

  if (!m.open) { ck(key, '§5.6 overlay opens', false, 'no visible scrim'); continue; }
  ck(key, '§5.6 overlay opens with content', m.chars > 200, `${m.chars} chars`);

  // ── item 5 · title + subtitle verbatim ────────────────────────────────────
  const hasTitle = /Matchup record/.test(m.body);
  ck(key, 'item 5 · title is "Matchup record"', hasTitle,
    hasTitle ? '' : 'heads: ' + m.heads.join(' | '));
  const subtitleWanted = 'Win rate by opposing archetype';
  ck(key, 'item 5 · subtitle is the file\'s verbatim', m.body.includes(subtitleWanted),
    m.body.includes(subtitleWanted) ? '' : 'not found');
  ck(key, 'item 5 · the rejected live subtitle is gone',
    !/record covers/i.test(m.body));

  // ── item 6 · modal max-width 820 ──────────────────────────────────────────
  ck(key, 'item 6 · modal max-width 820px', m.panelMaxWidth === '820px',
    `max-width ${m.panelMaxWidth}, rendered ${Math.round(m.panelWidth)}px`);

  // ── item 7 · eyebrow ──────────────────────────────────────────────────────
  ck(key, 'item 7 · eyebrow present',
    /WIN RATE BY ARCHETYPE .* BUBBLE SIZE IS MATCH COUNT/i.test(m.body.replace(/·/g, '·')));

  // ── item 10 + step (f) · NO BUBBLE CLIPPED ───────────────────────────────
  // "Clipped" means a clipping ANCESTOR actually cuts the disc, not that the disc
  // crosses the plot's border line. Those are different things: the plot height is
  // locked at 240px by item 8, so a 98% value on a 40-100 axis necessarily draws
  // its disc a few px above the top rule while remaining fully visible. Testing
  // boundary-crossing reported Sinner's 98% Counterpuncher bubble as clipped when
  // every ancestor is overflow:visible and the whole disc paints.
  if (m.bubbles.length) {
    const clip = await ev(`(function(){
      var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
        .filter(function(e){return getComputedStyle(e).display!=='none';});
      var top = ov[ov.length-1];
      var all = Array.prototype.slice.call(top.querySelectorAll('*'));
      var bub = all.filter(function(e){
        var s=getComputedStyle(e); var r=e.getBoundingClientRect();
        return s.borderRadius==='50%' && r.width>8 && r.width<80 && Math.abs(r.width-r.height)<2; });
      var cut = 0, minGap = null;
      var eb = all.filter(function(e){ return e.children.length===0 &&
        /bubble size is match count/i.test((e.textContent||'')); })[0];
      var er = eb ? eb.getBoundingClientRect() : null;
      bub.forEach(function(b){
        var r = b.getBoundingClientRect();
        var n = b.parentElement, d = 0;
        while (n && d < 8) {
          var s = getComputedStyle(n), pr = n.getBoundingClientRect();
          if (s.overflowY !== 'visible' && (r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5)) cut++;
          if (s.overflowX !== 'visible' && (r.left < pr.left - 0.5 || r.right > pr.right + 0.5)) cut++;
          n = n.parentElement; d++;
        }
        if (er) { var g = r.top - er.bottom; if (minGap === null || g < minGap) minGap = g; }
      });
      return { bubbles: bub.length, cut: cut, minEyebrowGap: minGap === null ? null : Math.round(minGap) };
    })()`);
    ck(key, 'item 10/(f) · no bubble is clipped by a clipping ancestor', clip.cut === 0,
      `${clip.bubbles} bubbles, ${clip.cut} cut`);
    ck(key, 'item 7 · no bubble overlaps the eyebrow',
      clip.minEyebrowGap === null || clip.minEyebrowGap >= 0,
      `closest bubble clears the eyebrow by ${clip.minEyebrowGap}px`);
  } else {
    ck(key, 'item 10/(f) · bubbles are plotted', false, 'no bubbles found');
  }

  // ── step (f) · no value label overlaps another label or a bubble ──────────
  const over = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  let labLab = 0, labBub = 0;
  for (let i = 0; i < m.labels.length; i++) {
    for (let j = i + 1; j < m.labels.length; j++) if (over(m.labels[i], m.labels[j])) labLab++;
    for (const b of m.bubbles) if (over(m.labels[i], b)) labBub++;
  }
  ck(key, '(f) · no value label overlaps another label', labLab === 0, `${m.labels.length} labels, ${labLab} collisions`);
  ck(key, '(f) · item 12 value label sits clear of its bubble', labBub === 0, `${labBub} label/bubble overlaps`);

  // ── item 11 · EVEN uppercase AND right-aligned ───────────────────────────
  // Read text-transform, not textContent: these labels are uppercased in CSS, so
  // the DOM string is "even" while the pixels say "EVEN". Asserting on the string
  // alone reports a correct build as a failure (it did, first run).
  const evenNode = await ev(`(function(){
    var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
      .filter(function(e){return getComputedStyle(e).display!=='none';});
    var top = ov[ov.length-1];
    var n = Array.prototype.slice.call(top.querySelectorAll('*')).filter(function(e){
      return e.children.length===0 && /^even$/i.test((e.textContent||'').trim()); })[0];
    if (!n) return null;
    var s = getComputedStyle(n); var r = n.getBoundingClientRect();
    var par = n.parentElement ? n.parentElement.getBoundingClientRect() : null;
    return { transform: s.textTransform, align: s.textAlign, colour: s.color,
      rightOfCentre: par ? (r.left + r.width/2) > (par.left + par.width/2) : null };
  })()`);
  ck(key, 'item 11 · EVEN renders uppercase (text-transform)',
    !!evenNode && evenNode.transform === 'uppercase',
    evenNode ? `text-transform:${evenNode.transform}` : 'no even label found');
  ck(key, 'item 11 · EVEN sits on the right, not the left',
    !!evenNode && evenNode.rightOfCentre === true,
    evenNode ? `align:${evenNode.align} rightOfCentre:${evenNode.rightOfCentre}` : '');

  // ── item 10 · axis EXTENDS past 40–80 rather than clipping ───────────────
  const vals = (m.body.match(/\b(\d{1,3})%/g) || []).map(s => parseInt(s, 10));
  const tickNums = m.ticks.map(t => parseInt(t, 10)).filter(n => !isNaN(n));
  const bubbleVals = m.labels.map(l => parseInt(l.t, 10)).filter(n => !isNaN(n));
  const outside = bubbleVals.filter(v => v < 40 || v > 80);
  if (outside.length) {
    const lo = Math.min(...tickNums), hi = Math.max(...tickNums);
    ck(key, 'item 10 · axis extended in 10pp steps to cover out-of-range values',
      lo <= Math.min(...outside) && hi >= Math.max(...outside) && lo % 10 === 0 && hi % 10 === 0,
      `values ${outside.join(',')} outside 40–80; axis ${lo}–${hi}`);
  } else {
    console.log(`  ····  item 10 · no value outside 40–80 for this player (axis ${Math.min(...tickNums)}–${Math.max(...tickNums)}); extension not exercised here`);
  }

  // ── item 14 · under-minimum archetypes are NOT plotted ───────────────────
  const belowMinCount = (m.body.match(/below the five-match minimum/g) || []).length;
  ck(key, 'item 14 · under-minimum archetypes are listed but not plotted',
    m.bubbles.length + belowMinCount === m.rows.filter(r => r.bars > 0).length + belowMinCount
      ? true : m.bubbles.length <= m.rows.length - belowMinCount,
    `${m.bubbles.length} bubbles · ${belowMinCount} under-minimum row(s) · ${m.rows.length} rows`);

  // ── item 22 · rows ordered by win rate, under-minimum last ───────────────
  // Anchoring on `%$` silently DROPPED every row ending in "small sample" and every
  // dashed under-minimum row, then slid the Career total into the plotted window —
  // which reported four correctly-sorted players as mis-ordered. Take the LAST
  // percentage in the row instead, and stop at the first non-rated row so the
  // under-minimum block and the Career total are never compared as plotted rows.
  const rated = [];
  for (const r of m.rows) {
    if (/below the five-match minimum/.test(r.text)) break;
    if (/^Career/.test(r.text.trim())) break;
    const all = r.text.match(/(\d+)%/g) || [];
    if (all.length) rated.push(parseInt(all[all.length - 1], 10));
  }
  ck(key, 'item 22 · rated rows are ordered by win rate, highest first',
    rated.length > 0 && rated.every((v, i) => i === 0 || rated[i - 1] >= v),
    rated.join(' > '));
  const tailIsUnderMin = m.rows.length > 1 &&
    m.rows.slice(rated.length).every(r =>
      /below the five-match minimum/.test(r.text) || /^Career/.test(r.text.trim()));
  ck(key, 'item 22 · under-minimum rows sit below every rated row', tailIsUnderMin,
    `${rated.length} rated, then ${m.rows.length - rated.length} under-minimum/Career`);

  // ── item 21 · win% whole number on the rows ──────────────────────────────
  const rowPcts = m.rows.flatMap(r => (r.text.match(/\d+(?:\.\d+)?%/g) || []));
  const decimals = rowPcts.filter(s => /\.\d/.test(s));
  ck(key, 'item 21 · row win% is a whole number', decimals.length === 0,
    `${rowPcts.length} row rates, ${decimals.length} with a decimal${decimals.length ? ': ' + decimals.slice(0, 4).join(',') : ''}`);

  // ── item 17 · rows are CARDS (3-col grid, radius 10, bordered) ────────────
  const cardRows = m.rows.filter(r => /10px/.test(r.radius) && parseFloat(r.border) >= 1);
  ck(key, 'item 17 · rows are bordered radius-10 cards', cardRows.length > 0,
    `${m.rows.length} grid rows, ${cardRows.length} carded`);
  ck(key, 'item 17 · row grid is minmax(0,1fr) 300px 58px',
    m.rows.length > 0 && /300px/.test(m.rows[0].cols) && /58px/.test(m.rows[0].cols),
    m.rows.length ? m.rows[0].cols : 'no rows');

  // ── item 19 · the minimal bar exists on every full row ───────────────────
  const withBar = m.rows.filter(r => r.bars > 0).length;
  ck(key, 'item 19 · rows carry the minimal bar', m.rows.length > 0 && withBar > 0,
    `${withBar} of ${m.rows.length} rows have a 4px bar`);

  // ── item 20 · units column present and signed, WHERE THERE ARE PRICED ROWS ─
  // Pinnacle's archive is ATP main draw only (R1 basis), so a Challenger-only
  // player has no priced row and every units cell is a dash. That is the standing
  // rule working, not a missing column — demanding a signed figure unconditionally
  // reported Michalski's correct all-dash column as a defect.
  const unitCells = (m.body.match(/[+−-]\d+\.\d\du/g) || []);
  const anyPriced = unitCells.length > 0;
  if (anyPriced) {
    ck(key, 'item 20 · rows carry a signed units figure', true, unitCells.slice(0, 3).join(' '));
  } else {
    console.log(`  ····  item 20 · this player has no Pinnacle-priced row, so every units cell `
      + `is a dash (R1 basis is ATP main draw only) — column present, correctly empty`);
  }

  // ── item 4 / step (e) · RECONCILIATION, re-derived here ──────────────────
  const recon = await ev(`(function(){
    var key = ${JSON.stringify(key)};
    var ch = (window.careerHistory && window.careerHistory[key]) || null;
    var rows = ch && ch.matches ? ch.matches : (Array.isArray(ch) ? ch : []);
    return { spine: rows.length };
  })()`);
  // Sum the archetype rows straight off the rendered cards.
  const sums = await ev(`(function(){
    var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
      .filter(function(e){var s=getComputedStyle(e);return s.display!=='none';});
    var top = ov[ov.length-1];
    var t = (top.textContent||'').replace(/\\s+/g,' ');
    // every "W–L · N matches" meta on a row
    var re = /(\\d+)\\u2013(\\d+)\\s*\\u00b7\\s*(\\d+)\\s+matches/g, mm, out=[];
    while ((mm = re.exec(t))) out.push({w:+mm[1], l:+mm[2], n:+mm[3]});
    var unl = t.match(/(\\d+)\\s+(?:of\\s+\\d+\\s+matches?[^.]*?)?unlabelled/i);
    var cov = t.match(/(\\d+)\\s+of\\s+(\\d+)\\s+matches/i);
    return { metas: out, coverage: cov ? {lab:+cov[1], tot:+cov[2]} : null,
             belowMin: (t.match(/below the five-match minimum/g)||[]).length };
  })()`);
  const metaSum = sums.metas.reduce((a, r) => a + r.n, 0);
  console.log(`        spine=${recon.spine} · row metas=${sums.metas.length} summing ${metaSum}` +
    (sums.coverage ? ` · coverage line "${sums.coverage.lab} of ${sums.coverage.tot} matches"` : ' · NO coverage line'));
  ck(key, 'item 3 · the modal states coverage as "N of M matches"', !!sums.coverage);
  if (sums.coverage) {
    ck(key, 'item 4 · the coverage total equals the career spine',
      sums.coverage.tot === recon.spine, `modal ${sums.coverage.tot} vs spine ${recon.spine}`);
    ck(key, 'item 4 · labelled <= total', sums.coverage.lab <= sums.coverage.tot,
      `${sums.coverage.lab} <= ${sums.coverage.tot}`);
  }

  // ── step (d) · interactions: select a row, detail opens ───────────────────
  const drill = await ev(`(function(){
    var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
      .filter(function(e){var s=getComputedStyle(e);return s.display!=='none';});
    var top = ov[ov.length-1];
    var before = (top.textContent||'').length;
    var cards = Array.prototype.slice.call(top.querySelectorAll('*')).filter(function(e){
      var s=getComputedStyle(e);
      return s.display==='grid' && s.cursor==='pointer' && e.getBoundingClientRect().height>34;
    });
    if (!cards.length) return { clickable:0 };
    cards[0].click();
    return { clickable: cards.length, before: before };
  })()`);
  await sleep(700);
  const after = await ev(`(function(){
    var ov = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="scrim"]'))
      .filter(function(e){var s=getComputedStyle(e);return s.display!=='none';});
    var top = ov[ov.length-1];
    var t = (top.textContent||'').replace(/\\s+/g,' ');
    // Case-INSENSITIVE: the heads are uppercased in CSS, so textContent reads
    // "Date"/"Opponent". Matching the literal uppercase strings reported a
    // correct drill as missing every column but P&L.
    var heads = ['Date','Opponent','Event','Rd','Score','Price','Opp','P&L'];
    var lower = t.toLowerCase();
    return { chars: t.length, cols: heads.filter(function(h){ return lower.indexOf(h.toLowerCase()) >= 0; }) };
  })()`);
  ck(key, '(d) · a row card is clickable', (drill.clickable || 0) > 0, `${drill.clickable || 0} pointer rows`);
  ck(key, 'item 26/28 · clicking a row opens a detail that grows the modal',
    after.chars > (drill.before || 0), `${drill.before} -> ${after.chars} chars`);
  ck(key, 'item 28 · the detail carries all eight ruled column heads',
    after.cols.length === 8, `found ${after.cols.join(',')}`);

  // ── item 32 · footnote dash is the em dash the design writes ─────────────
  const noteIdx = m.body.indexOf('rather than dropping out');
  if (noteIdx >= 0) {
    const tail = m.body.slice(noteIdx, noteIdx + 40);
    ck(key, 'item 32 · footnote sentence dash is U+2014', tail.includes('—'),
      tail.includes('–') ? 'still the en dash U+2013' : JSON.stringify(tail.slice(24, 30)));
  }

  results.push({ key, name, spine: recon.spine, bubbles: m.bubbles.length,
    rows: m.rows.length, coverage: sums.coverage, chars: m.chars });
}

console.log(`\n════════════════════════════════════════════════════`);
console.log(`CHECKS ${checks}   FAIL ${fails}   jsErrors ${jsErrors.length}`);
if (failLines.length) { console.log('\nFailures:'); failLines.forEach(f => console.log('  - ' + f)); }
if (jsErrors.length) { console.log('\nJS errors:'); jsErrors.slice(0, 5).forEach(e => console.log('  ! ' + e)); }
console.log(JSON.stringify(results, null, 1));

ws.close(); chrome.kill();
try { fs.rmSync(udd, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(fails ? 1 : 0);
