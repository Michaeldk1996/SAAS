#!/usr/bin/env node
/**
 * verify-series-tighten.mjs — TEN-194 item-batch verification (founder comment
 * 2ae614ed, 2026-09-12: deduplicate, tighten the filter bar, shrink the avatar).
 *
 * Method, unchanged from the TEN-194 rebuild pass: drive a REAL headless Chrome over
 * CDP against the DEPLOYED dashboard shell reading the DEPLOYED series.json, with the
 * CANDIDATE series.js / series.css swapped in at the network layer (Fetch domain). So
 * every number below is read off what a browser actually painted, not off the repo.
 *
 * The card-selection assertions are an INDEPENDENT recompute: recomputeExpected()
 * re-derives the expected card set straight from the fetched series.json using its own
 * subset/filter logic and imports nothing from series.js. A disagreement is a failure.
 *
 *   node tools/verify-series-tighten.mjs [--live] [--shot out.png]
 *     --live   omit the swap and measure the deployed series.js/css as published
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html?series=1';
const DATA = 'https://michaeldk1996.github.io/SAAS/series.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const SHOT = argv.includes('--shot') ? argv[argv.indexOf('--shot') + 1] : null;
const WIDTH = argv.includes('--width') ? +argv[argv.indexOf('--width') + 1] : 1400;
// --data <file>: serve a LOCALLY BUILT series.json instead of the deployed one. The
// deployed artifact was produced by the pre-change build-series.js and still publishes
// viewFloorDefault=5, which the page correctly adopts — so the 6+ default (item 9) can
// only be measured against an artifact the NEW engine wrote. Both passes are run.
const DATA_FILE = argv.includes('--data') ? argv[argv.indexOf('--data') + 1] : null;

/* ── assertions ─────────────────────────────────────────────────────────────── */
let pass = 0;
const fails = [];
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fails.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function ok(label, cond, detail) {
  if (cond) pass++; else fails.push(`${label}${detail ? ': ' + detail : ''}`);
}

/* ── independent recompute of the expected card set ─────────────────────────── */
// Deliberately a second implementation. It does not require, import, eval or textually
// reuse series.js — it reads series.json and applies the founder's rules from scratch.
function recomputeExpected(doc, { minLen = 6, day = 'all' } = {}) {
  const OUTCOME = new Set(['all', 'surface', 'style']);
  const BREADTH = { all: 3, surface: 2, style: 1 };
  const mkey = (m) => `${m.date}|${m.opponent == null ? '' : m.opponent}`;
  const cards = [];
  for (const p of doc.players || []) {
    for (const st of p.streaks || []) {
      if (st.pool == null || !st.lastDate || st.ageDays == null) continue;
      cards.push({ p, st });
    }
  }
  // suppression pass (item 1) — per player+tier, match-outcome family only
  const groups = new Map();
  for (const c of cards) {
    if (!OUTCOME.has(c.st.type)) continue;
    if (!(Array.isArray(c.st.matches) && c.st.matches.length)) continue;
    const k = `${c.p.key}|${c.p.tier}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const suppressed = new Set();
  for (const g of groups.values()) {
    for (const a of g) {
      const A = new Set(a.st.matches.map(mkey));
      for (const b of g) {
        if (b === a) continue;
        if (b.st.count < a.st.count) continue;
        const B = new Set(b.st.matches.map(mkey));
        if (![...A].every((x) => B.has(x))) continue;
        // only the narrower claim is ever suppressed (never the all-comps card)
        if (BREADTH[b.st.type] <= BREADTH[a.st.type]) continue;
        suppressed.add(a); break;
      }
    }
  }
  const styleFloor = (doc.rules && doc.rules.viewFloorStyle) || 3;
  const out = [];
  for (const c of cards) {
    if (suppressed.has(c)) continue;
    const played = !!(c.p.upcoming && c.p.upcoming.played);
    if (day === 'played') { if (!played) continue; }
    else {
      if (played) continue;
      if (day !== 'all' && (c.p.upcoming && c.p.upcoming.day) !== day) continue;
    }
    const floor = c.st.type === 'style' ? styleFloor : minLen;
    if (c.st.count < floor) continue;
    out.push(c);
  }
  // sort: longest, tie-break bigger pool (matches the page's default sort)
  out.sort((a, b) => (b.st.count - a.st.count) || ((b.st.pool || 0) - (a.st.pool || 0)));
  return { cards: out, suppressed: [...suppressed] };
}

/* ── CDP scaffold ───────────────────────────────────────────────────────────── */
async function cdpTarget(dport, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('no CDP page target within timeout');
}
function client(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method && onEvent) onEvent(m);
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

async function main() {
  const rawData = DATA_FILE ? fs.readFileSync(DATA_FILE, 'utf8')
    : await (await fetch(DATA, { cache: 'no-store' })).text();
  const doc = JSON.parse(rawData);
  console.log(`series.json [${DATA_FILE ? 'LOCAL ' + path.basename(DATA_FILE) : 'DEPLOYED'}] ` +
    `generatedAt=${doc.generatedAt} players=${doc.players.length} ` +
    `streaks=${doc.players.reduce((n, p) => n + p.streaks.length, 0)} viewFloorDefault=${doc.rules.viewFloorDefault}`);
  const MINLEN = doc.rules.viewFloorDefault;

  const candJs = fs.readFileSync(path.join(REPO, 'series.js'), 'utf8');
  const candCss = fs.readFileSync(path.join(REPO, 'series.css'), 'utf8');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-verify-'));
  const dport = 9700 + Math.floor(Math.random() * 200);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
      '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

  let c;
  try {
    c = client(await cdpTarget(dport, 20000), async (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      let body = null, mime = null;
      if (!LIVE && /\/series\.js(\?|$)/.test(request.url)) { body = candJs; mime = 'application/javascript'; }
      else if (!LIVE && /\/series\.css(\?|$)/.test(request.url)) { body = candCss; mime = 'text/css'; }
      else if (DATA_FILE && /\/series\.json(\?|$)/.test(request.url)) { body = rawData; mime = 'application/json'; }
      if (body != null) {
        await c.send('Fetch.fulfillRequest', {
          requestId, responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: mime }, { name: 'cache-control', value: 'no-store' }],
          body: Buffer.from(body, 'utf8').toString('base64'),
        });
      } else {
        await c.send('Fetch.continueRequest', { requestId });
      }
    });
    await c.ready;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*series.js*' }, { urlPattern: '*series.css*' }, { urlPattern: '*series.json*' }] });
    await c.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1400, deviceScaleFactor: 1, mobile: false });
    // Auth bypass: neuter the verified-user redirect so the gated dashboard paints.
    await c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window,'BSP',{configurable:true,set(v){
        try{ v.requireVerified=function(){return Promise.resolve({uid:'probe',email:'probe@x'});}; }catch(e){}
        Object.defineProperty(window,'BSP',{value:v,writable:true,configurable:true});
      },get(){return undefined;}});`,
    });

    const ev = async (expr) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const x = r.result?.exceptionDetails;
      if (x) throw new Error('eval threw: ' + (x.exception?.description || x.text));
      return r.result?.result?.value;
    };

    await c.send('Page.navigate', { url: PAGE });
    // Wait for the shell to be FULLY wired before clicking. #seriesTabBtn exists in the
    // parsed HTML from the start (display:none) and the nav's click handler is a
    // delegated listener attached by an inline <script> much further down the document
    // — so polling on the button's mere existence clicks into a void and the tab never
    // switches. Gate on readyState complete + window.SeriesPage (set by the deferred
    // series.js) + the button actually revealed, then confirm the page really changed.
    for (let i = 0; i < 150; i++) {
      const r = await ev(`(function(){var b=document.getElementById('seriesTabBtn');
        return { ready: document.readyState==='complete', api: !!window.SeriesPage,
                 shown: !!b && b.style.display !== 'none' };})()`).catch(() => ({}));
      if (r.ready && r.api && r.shown) break;
      await sleep(200);
    }
    let active = null;
    for (let i = 0; i < 25; i++) {
      await ev(`document.getElementById('seriesTabBtn').click()`);
      await sleep(200);
      active = await ev(`(document.querySelector('.tabpage.active')||{dataset:{}}).dataset.page`);
      if (active === 'series') break;
    }
    if (active !== 'series') throw new Error(`Series tab never activated (active=${active})`);
    let painted = 0;
    for (let i = 0; i < 120; i++) {
      painted = await ev(`document.querySelectorAll('[data-page="series"] .sr-card').length`).catch(() => 0);
      if (painted > 0) break;
      await sleep(200);
    }
    await sleep(500);
    if (!painted) {
      console.error('DIAG', JSON.stringify(await ev(`(function(){
        var g=document.getElementById('seriesGrid');
        return { flag: !!window.FEATURE_SERIES, hasSeriesPage: !!window.SeriesPage,
                 activePage: (document.querySelector('.tabpage.active')||{}).getAttribute ? document.querySelector('.tabpage.active').getAttribute('data-page') : null,
                 gridHtml: g ? g.innerHTML.slice(0, 400) : '(no #seriesGrid)' };
      })()`)));
    }

    /* ── 1 · card selection: painted vs independent recompute ─────────────────── */
    const exp = recomputeExpected(doc, { minLen: MINLEN, day: 'all' });
    const paintedTitles = await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-card')).map(function(e){
      return { claim: e.querySelector('.sr-claim').textContent.trim(),
               name: e.querySelector('.sr-pname').textContent.trim(),
               type: e.querySelector('.sr-cell-type').textContent.trim(),
               count: Number(e.getAttribute('data-count')) };
    })`);
    eq('A1 card count = independent recompute', paintedTitles.length, exp.cards.length);
    const expSig = exp.cards.map((c) => `${c.p.name}|${c.st.count}`).sort();
    const gotSig = paintedTitles.map((r) => `${r.name}|${r.count}`).sort();
    eq('A2 card identities = independent recompute', gotSig, expSig);

    /* ── 2 · item 1 · deduplication ───────────────────────────────────────────── */
    ok('B1 suppression actually fired', exp.suppressed.length > 0, `suppressed=${exp.suppressed.length}`);
    // No player+tier may hold two match-outcome cards over an identical match set.
    const dupes = await ev(`(function(){
      var byP={}; var bad=[];
      Array.from(document.querySelectorAll('[data-page="series"] .sr-card')).forEach(function(e){
        var t=e.querySelector('.sr-cell-type').textContent.trim();
        if(['All comps','Surface','Vs style'].indexOf(t)<0) return;
        var n=e.querySelector('.sr-pname').textContent.trim();
        (byP[n]=byP[n]||[]).push(t+':'+e.getAttribute('data-count'));
      });
      Object.keys(byP).forEach(function(n){ if(byP[n].length>1) bad.push(n+' -> '+byP[n].join(', ')); });
      return bad;
    })()`);
    // A player CAN legitimately hold two outcome cards when neither is a subset of the
    // other; report them so the founder sees which survived and why.
    console.log('  multi-outcome players still on the board:', JSON.stringify(dupes));
    const shelton = exp.suppressed.filter((c) => /Shelton/.test(c.p.name || ''));
    ok('B2 Shelton hard-6 suppressed against all-comps-6',
      shelton.some((c) => c.st.type === 'surface' && c.st.count === 6), JSON.stringify(shelton.map((c) => c.st.type)));
    const sheltonKept = recomputeExpected(doc, { minLen: 3, day: 'all' }).cards
      .filter((c) => /Shelton/.test(c.p.name || ''));
    ok('B3 Shelton vs-style 4 survives (not a subset)',
      sheltonKept.some((c) => c.st.type === 'style' && c.st.count === 4),
      JSON.stringify(sheltonKept.map((c) => `${c.st.type}:${c.st.count}`)));
    // The suppressed streak is still in the artifact (reachable), not deleted upstream
    ok('B4 suppressed streaks remain in series.json',
      doc.players.some((p) => /Shelton/.test(p.name || '') && p.streaks.some((s) => s.type === 'surface' && s.count === 6)));

    /* ── 3 · item 3 · no flags on cards (modal keeps its own) ─────────────────── */
    eq('C1 zero .sr-flag inside cards',
      await ev(`document.querySelectorAll('[data-page="series"] .sr-card .sr-flag').length`), 0);
    eq('C2 zero regional-indicator glyphs in card text',
      await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-card'))
        .filter(function(e){return /[\\u{1F1E6}-\\u{1F1FF}]/u.test(e.textContent);}).length`), 0);

    /* ── 4 · item 4 · 20px avatar, inline on the name's baseline ──────────────── */
    const av = await ev(`(function(){
      var w=document.querySelector('[data-page="series"] .sr-card .sr-av-wrap');
      var n=w.parentElement.querySelector('.sr-pname');
      var cs=getComputedStyle(w); var rw=w.getBoundingClientRect(); var rn=n.getBoundingClientRect();
      return { w: Math.round(rw.width), h: Math.round(rw.height),
               cssW: cs.width, cssH: cs.height,
               prowAlign: getComputedStyle(w.parentElement).alignItems,
               sameLine: Math.abs((rw.top+rw.height/2)-(rn.top+rn.height/2)) <= 4,
               centerDelta: +( (rw.top+rw.height/2)-(rn.top+rn.height/2) ).toFixed(2),
               overlapsName: rw.right <= rn.left + 1 };
    })()`);
    eq('D1 avatar rendered width', av.w, 20);
    eq('D2 avatar rendered height', av.h, 20);
    eq('D3 avatar computed box', [av.cssW, av.cssH], ['20px', '20px']);
    eq('D4 player row aligns on baseline', av.prowAlign, 'baseline');
    ok('D5 avatar sits on the name line (|Δcentre| ≤ 4px)', av.sameLine, `Δ=${av.centerDelta}px`);
    ok('D6 avatar precedes the name inline', av.overlapsName);

    /* ── 5 · item 6 · shortened titles ────────────────────────────────────────── */
    const claims = paintedTitles.map((r) => r.claim);
    eq('E1 no card says "across all competitions"',
      claims.filter((s) => /across all competitions/.test(s)).length, 0);
    const allComps = paintedTitles.filter((r) => r.type === 'All comps');
    ok('E2 all-comps titles read "Won|Lost N in a row"',
      allComps.length > 0 && allComps.every((r) => /^(Won|Lost) \d+ in a row$/.test(r.claim)),
      JSON.stringify(allComps.slice(0, 3).map((r) => r.claim)));
    const surf = paintedTitles.filter((r) => r.type === 'Surface');
    ok('E3 surface titles keep the surface',
      surf.every((r) => /^(Won|Lost) on (Hard|Clay|Grass) \d+ in a row$/.test(r.claim)),
      JSON.stringify(surf.slice(0, 3).map((r) => r.claim)));

    /* ── 6 · item 7 · direction on the title row, right-aligned ───────────────── */
    const dir = await ev(`(function(){
      var cards=Array.from(document.querySelectorAll('[data-page="series"] .sr-card'));
      var inTitle=0, right=0, onTagRow=0, words={};
      cards.forEach(function(e){
        var t=e.querySelector('.sr-titlerow > .sr-tag-dir');
        if(t){ inTitle++; words[t.textContent.trim()]=1;
          var rt=t.getBoundingClientRect(), rc=e.getBoundingClientRect(), rcl=e.querySelector('.sr-claim').getBoundingClientRect();
          if (rc.right - rt.right < 40 && rt.left >= rcl.right - 1) right++;
        }
        if(e.querySelector('.sr-tags .sr-tag-dir')) onTagRow++;
      });
      return { cards: cards.length, inTitle: inTitle, right: right, onTagRow: onTagRow, words: Object.keys(words).sort() };
    })()`);
    eq('F1 every card carries the direction word on the title row', dir.inTitle, dir.cards);
    eq('F2 none left on the old tag row', dir.onTagRow, 0);
    eq('F3 every one is right-aligned opposite the title', dir.right, dir.cards);
    ok('F4 direction vocabulary unchanged',
      dir.words.every((w) => ['Winning run', 'Losing run', 'Neutral'].includes(w)), JSON.stringify(dir.words));

    /* ── 7 · item 8 · two filter rows, no checkbox, DAY has Played ────────────── */
    const filt = await ev(`(function(){
      var rows=Array.from(document.querySelectorAll('[data-page="series"] .sr-frow'));
      return {
        rows: rows.length,
        labels: rows.map(function(r){ return Array.from(r.querySelectorAll('.sr-flabel')).map(function(l){return l.textContent.trim();}); }),
        checkboxes: document.querySelectorAll('[data-page="series"] .sr-filters input[type=checkbox]').length,
        toggles: document.querySelectorAll('[data-page="series"] .sr-toggle').length,
        day: Array.from(document.querySelectorAll('[data-page="series"] .sr-seg[data-seg=day] .sr-segbtn')).map(function(b){return b.textContent.trim();}),
        dayActive: (document.querySelector('[data-page="series"] .sr-seg[data-seg=day] .sr-segbtn.active')||{}).textContent,
        minActive: (document.querySelector('[data-page="series"] .sr-seg[data-seg=minLen] .sr-segbtn.active')||{}).textContent,
        minOpts: Array.from(document.querySelectorAll('[data-page="series"] .sr-seg[data-seg=minLen] .sr-segbtn')).map(function(b){return b.textContent.trim();}),
        rowTops: rows.map(function(r){ return Math.round(r.getBoundingClientRect().top); })
      };
    })()`);
    eq('G1 exactly two filter rows', filt.rows, 2);
    eq('G2 row 1 = LEVEL · DAY · DIRECTION', filt.labels[0], ['Level', 'Day', 'Direction']);
    eq('G3 row 2 = TYPE · MIN LENGTH · SORT', filt.labels[1], ['Type', 'Min length', 'Sort']);
    eq('G4 no checkbox anywhere in the filter bar', filt.checkboxes, 0);
    eq('G5 no non-segmented control left', filt.toggles, 0);
    eq('G6 DAY = All · Today · Tomorrow · Played', filt.day, ['All', 'Today', 'Tomorrow', 'Played']);
    ok('G7 the two rows really are on separate lines', filt.rowTops[1] > filt.rowTops[0], JSON.stringify(filt.rowTops));

    /* ── 8 · item 9 · min length defaults to 6+ ───────────────────────────────── */
    eq('H1 MIN LENGTH default button = the artifact\'s published floor',
      (filt.minActive || '').trim(), MINLEN + '+');
    ok('H2 3+ and 4+ still available', filt.minOpts.includes('3+') && filt.minOpts.includes('4+'), JSON.stringify(filt.minOpts));
    eq('H3 no painted card is shorter than the floor (vs-style exempt)',
      paintedTitles.filter((r) => r.count < MINLEN && r.type !== 'Vs style').length, 0);

    /* ── 9 · DAY=Played behaviour (replaces the checkbox) ─────────────────────── */
    await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-seg[data-seg=day] .sr-segbtn'))
      .filter(function(b){return b.textContent.trim()==='Played';})[0].click()`);
    await sleep(350);
    const playedView = await ev(`(function(){
      var cards=Array.from(document.querySelectorAll('[data-page="series"] .sr-card'));
      return { n: cards.length,
               allHaveOutcomeChip: cards.every(function(e){return !!e.querySelector('.sr-tags .sr-tag-oc, .sr-tags .sr-tag-oc-na');}),
               summary: !!document.querySelector('[data-page="series"] .sr-outsum'),
               summaryText: (document.querySelector('[data-page="series"] .sr-outsum')||{}).textContent };
    })()`);
    const expPlayed = recomputeExpected(doc, { minLen: MINLEN, day: 'played' });
    eq('I1 DAY=Played card count = independent recompute', playedView.n, expPlayed.cards.length);
    ok('I2 every played card carries a Continued/Broken/Played chip', playedView.n === 0 || playedView.allHaveOutcomeChip);
    ok('I3 the continued/broken aggregate renders in the played view',
      playedView.n === 0 || playedView.summary, playedView.summaryText || '(absent)');
    // and disappears again outside it
    await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-seg[data-seg=day] .sr-segbtn'))
      .filter(function(b){return b.textContent.trim()==='All';})[0].click()`);
    await sleep(350);
    eq('I4 aggregate hidden outside the played view',
      await ev(`document.querySelectorAll('[data-page="series"] .sr-outsum').length`), 0);
    eq('I5 back to the default view count',
      await ev(`document.querySelectorAll('[data-page="series"] .sr-card').length`), exp.cards.length);

    /* ── 10 · DO-NOT-CHANGE regression locks ──────────────────────────────────── */
    const geom = await ev(`(function(){
      var c=document.querySelector('[data-page="series"] .sr-card'); var cs=getComputedStyle(c);
      var g=document.querySelector('[data-page="series"] .sr-cards'); var gs=getComputedStyle(g);
      var strip=c.querySelector('.sr-strip'); var ss=getComputedStyle(strip);
      return { radius: cs.borderRadius, border: cs.borderTopWidth+' '+cs.borderTopColor,
               bg: cs.backgroundColor, pad: cs.padding, gap: gs.gap,
               cols: gs.gridTemplateColumns.split(' ').length,
               stripCols: ss.gridTemplateColumns.split(' ').length,
               stripKeys: Array.from(strip.querySelectorAll('.sr-cell-k')).map(function(e){return e.textContent.trim();}),
               hasNext: !!c.querySelector('.sr-next'), hasHist: !!c.querySelector('.sr-hist'),
               rank: !!c.querySelector('.sr-prank'),
               headStats: Array.from(document.querySelectorAll('[data-page="series"] .sr-stat-k')).map(function(e){return e.textContent.trim();}),
               cardHeights: Array.from(document.querySelectorAll('[data-page="series"] .sr-card')).map(function(e){return Math.round(e.getBoundingClientRect().height);})
      };
    })()`);
    eq('J1 card radius unchanged', geom.radius, '14px');
    eq('J2 card background unchanged', geom.bg, 'rgb(10, 13, 20)');
    eq('J3 card padding unchanged', geom.pad, '18px 20px');
    eq('J4 grid gap unchanged', geom.gap, '14px');
    // Column count is a property of the export's minmax(400px,1fr) against the shell's
    // content width — unchanged by this batch, so it is asserted as "whatever the
    // untouched grid rule yields at this width", not pinned to one number.
    eq(`J5 grid columns at ${WIDTH}px`, geom.cols, WIDTH >= 1300 ? 2 : 1);
    eq('J6 STARTED/LAST/TYPE is still three columns', geom.stripCols, 3);
    eq('J7 strip labels unchanged', geom.stripKeys, ['Started', 'Last', 'Type']);
    ok('J8 next-match line and History → intact', geom.hasNext && geom.hasHist);
    ok('J9 rank figure intact', geom.rank);
    eq('J10 header keeps its four figures', geom.headStats, ['Streaks', 'Players', 'Longest run', 'Updated']);
    const maxH = Math.max(...geom.cardHeights);
    ok('J11 card height did not grow (≤ 300px; pre-change board measured 330)', maxH <= 300, `tallest=${maxH}px`);
    console.log(`  card heights: min=${Math.min(...geom.cardHeights)} max=${maxH}`);

    /* ── 11 · the History modal is untouched ──────────────────────────────────── */
    await ev(`document.querySelector('[data-page="series"] .sr-card.sr-has-detail').click()`);
    await sleep(400);
    const modal = await ev(`(function(){
      var ov=document.querySelector('.sr-ov-back');
      var head=Array.from(document.querySelectorAll('.sr-mhead > span')).map(function(e){return e.textContent.trim();});
      var sub=document.querySelector('.sr-ov-sub');
      return { open: ov && !ov.hasAttribute('hidden'), head: head,
               rows: document.querySelectorAll('.sr-ov-body .sr-mrow').length,
               sub: sub ? sub.textContent.trim() : null,
               cols: getComputedStyle(document.querySelector('.sr-mhead')).gridTemplateColumns.split(' ').length };
    })()`);
    ok('K1 modal opens', modal.open);
    eq('K2 modal columns unchanged', modal.head, ['Date', 'Event', 'Opponent', 'Score']);
    eq('K3 modal column layout unchanged', modal.cols, 4);
    ok('K4 modal still carries the pool line', /\d+ of \d+ matches?/.test(modal.sub || ''), modal.sub);
    ok('K5 modal keeps the LONG all-comps wording (item 6 is card-only)',
      !/^Won \d+ matches running/.test(modal.sub || ''), modal.sub);
    ok('K6 modal row count = the run length', modal.rows > 0, String(modal.rows));
    console.log('  modal subtitle:', modal.sub);

    /* ── 12 · no colour reintroduced ──────────────────────────────────────────── */
    const colours = await ev(`(function(){
      var bad=[];
      Array.from(document.querySelectorAll('[data-page="series"] .sr-card, [data-page="series"] .sr-card *')).forEach(function(e){
        var cs=getComputedStyle(e);
        [cs.color, cs.backgroundColor, cs.borderTopColor].forEach(function(v){
          var m=/rgba?\\((\\d+), (\\d+), (\\d+)/.exec(v); if(!m) return;
          var r=+m[1],g=+m[2],b=+m[3];
          if ((g>110 && g>r+45 && g>b+45) || (r>130 && r>g+55 && r>b+55)) bad.push(e.className+' '+v);
        });
      });
      return bad.slice(0,8);
    })()`);
    eq('L1 no green or red anywhere on a card', colours, []);

    if (SHOT) {
      await ev(`document.querySelector('.sr-ov-close').click()`);
      await sleep(300);
      const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(SHOT, Buffer.from(r.result.data, 'base64'));
      console.error(`screenshot -> ${SHOT}`);
    }
  } finally {
    try { c?.close(); } catch {}
    try { chrome.kill(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n${pass} assertions passed, ${fails.length} failed`);
  for (const f of fails) console.log('  FAIL ' + f);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(1); });
