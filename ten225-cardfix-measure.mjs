#!/usr/bin/env node
// TEN-225 card-behaviour rulings 1-4 — BASELINE MEASUREMENT on the DEPLOYED board.
//
// Answers the founder's two counting questions off the live page, using the
// page's OWN resolvers (_mcNowPair / _openAnchorOf / _ocsOf) rather than a
// re-implementation — a second implementation of the ladder would measure the
// probe, not the board.
//
//   3. why only 6 of 32 fixtures qualify for Open -> Now, broken down:
//      no Open / no Now / Open and Now from different books / already started.
//   4b. Open-without-Now, with a reason per fixture.
//
// Also dumps the card-header text and the odds-cell DOM so rulings 1 and 2
// (countdown string, book name on the card face) are measured rather than
// assumed from the source.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.argv[2] || 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten225-cardfix-'));
const port = 9300 + Math.floor(process.pid % 400);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1500,1400', 'about:blank',
], { stdio: 'ignore' });

async function target() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP target');
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = async (method, params = {}) => {
    await ready;
    const mid = ++id;
    return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  };
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

try {
  const c = client(await target());
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(window,'BSP',{configurable:true,
      get(){return window.__bsp;},
      set(v){window.__bsp=v;try{v.requireVerified=async()=>({ok:true,user:{email:'probe@local'}});v.requireAuth=async()=>true;}catch(e){}}});`,
  });
  await c.send('Page.navigate', { url: URL });

  // Wait for the board to have both matches AND the published card state.
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      // `matches` and `OCS` are top-level `let`/`const` in a classic script, so they
      // live in script scope and are NOT window properties — reading them off `window`
      // returns undefined forever. Bare identifiers resolve correctly in Runtime.evaluate.
      ready = await c.evaluate(`(Array.isArray(matches) && matches.length > 0
        && typeof _mcNowPair === 'function' && typeof OCS === 'object' && OCS.loaded === true)`);
    } catch {}
    if (ready) break;
  }
  if (!ready) {
    console.log('DIAG ' + await c.evaluate(`JSON.stringify({href:location.href,
      nMatches:(typeof matches!=='undefined'?matches.length:'undef'),
      ocs: (typeof OCS!=='undefined'? OCS.loaded : 'undef'),
      hasResolver: typeof window._mcNowPair})`));
    throw new Error('board never became ready');
  }

  const buildInfo = await c.evaluate(`fetch('./build-info.json',{cache:'no-cache'}).then(r=>r.text()).catch(e=>'ERR '+e.message)`);
  console.log('BUILD-INFO ' + String(buildInfo).replace(/\s+/g, ' ').slice(0, 300));
  console.log('OCS generatedAt ' + await c.evaluate(`String(OCS.generatedAt)`));

  // ---------------------------------------------------------------- ruling 3
  // The Open -> Now qualification, per fixture, over TODAY's upcoming slate —
  // the same population the Biggest-market-move box is computed over
  // (daySlate = !isFinishedMatch && matchDayBucket === state.day).
  const report = await c.evaluate(`(function(){
    const slate = matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m) === state.day);
    const rows = slate.map(m => {
      const o = _ocsOf(m);
      const pair = _mcNowPair(m);
      const openP1 = _openAnchorOf(m,'p1'), openP2 = _openAnchorOf(m,'p2');
      const drvP1  = _openDerivedOf(m,'p1'), drvP2 = _openDerivedOf(m,'p2');
      const nowP1  = _mcNowOf(m,'p1'),  nowP2 = _mcNowOf(m,'p2');
      const startMs = cardStartMs(m);
      const started = isFinite(startMs) && Date.now() >= startMs;
      // book that produced the OPEN, and the book that produced the NOW
      const openBook = o ? (o.book || null) : ((m.openingOdds && m.openingOdds.bookmaker) || null);
      const nowBook  = pair ? (pair.book || null) : null;
      return {
        id: m.id, p1: m.p1, p2: m.p2, tour: m.tour, date: m.date, time: m.time,
        live: !!m.live, started,
        ocs: !!o, ocsBook: o ? o.book : null, ocsSource: o ? o.source : null,
        openP1, openP2, drvP1, drvP2, nowP1, nowP2,
        openBook, nowBook,
        vendorPin: _openPinIsVendor(m),
        hasOpen: (openP1 != null || openP2 != null),
        hasOpenBothLegs: (openP1 != null && openP2 != null),
        hasDerivedOpen: (drvP1 != null || drvP2 != null),
        hasNow: (nowP1 != null || nowP2 != null),
        hasNowBothLegs: (nowP1 != null && nowP2 != null),
        // What the BOX actually requires today: _openDerivedOf AND _mcNowOf on the
        // same side, both non-null, open>0.
        qualifies: ['p1','p2'].some(w => {
          const oo = _openDerivedOf(m,w), cc = _mcNowOf(m,w);
          return oo != null && cc != null && oo > 0 && oddsPctDelta(oo,cc).pct !== 0;
        }),
      };
    });
    // Would clicking Drift change the order? driftScore is open->CLOSE.
    const driftScores = slate.map(m => driftScore(m));
    return { n: slate.length, day: state.day, view: state.view, rows,
             driftAllZero: driftScores.every(s => s === 0),
             driftScores };
  })()`);

  fs.writeFileSync('ten225-cardfix-baseline.json', JSON.stringify(report, null, 2));
  const R = report.rows;
  console.log(`\nTODAY'S UPCOMING SLATE  n=${report.n}  (day=${report.day}, view=${report.view})`);
  console.log(`qualifying for Open -> Now : ${R.filter(r => r.qualifies).length} of ${report.n}`);
  console.log(`driftScore() all zero      : ${report.driftAllZero}  <- if true, clicking Drift cannot reorder`);

  // Mutually exclusive reason buckets, in the founder's order.
  const bucket = (r) => {
    if (r.qualifies) return 'qualifies';
    if (r.started) return 'already started';
    if (!r.hasOpen) return 'no Open';
    if (r.hasOpen && !r.hasDerivedOpen) return 'Open is a vendor (api-tennis) pin, excluded from drift';
    if (!r.hasNow) return 'no Now';
    if (r.openBook && r.nowBook && r.openBook !== r.nowBook) return 'Open and Now from different books';
    return 'other';
  };
  const tally = {};
  R.forEach(r => { const b = bucket(r); (tally[b] = tally[b] || []).push(r); });
  console.log('\nRULING 3 — why a fixture does not qualify:');
  Object.entries(tally).sort((a, b) => b[1].length - a[1].length)
    .forEach(([k, v]) => console.log(`  ${String(v.length).padStart(3)}  ${k}`));

  // ---------------------------------------------------------------- ruling 4b
  const own = R.filter(r => r.hasOpen && !r.hasNow);
  console.log(`\nRULING 4b — Open without Now: ${own.length} of ${report.n}`);
  own.forEach(r => {
    const reason = r.started ? 'started (Now correctly withheld)'
      : r.ocs ? `selected book ${r.ocsBook} has no current price`
      : 'no book pair on the board feed';
    console.log(`  ${r.p1} v ${r.p2}  [${r.tour}]  open=${r.openP1}/${r.openP2} book=${r.openBook || '—'} :: ${reason}`);
  });

  // started fixtures — ruling 4c
  const started = R.filter(r => r.started);
  console.log(`\nRULING 4c — started fixtures on the upcoming slate: ${started.length} of ${report.n}`);
  started.forEach(r => console.log(`  ${r.p1} v ${r.p2}  open=${r.openP1}/${r.openP2}  now=${r.nowP1}/${r.nowP2}  ocsClose=${JSON.stringify((function(){return null})())}`));

  // ------------------------------------------------------- rulings 1 + 2 DOM
  const dom = await c.evaluate(`(function(){
    const cards = [].slice.call(document.querySelectorAll('.match-card'));
    return cards.slice(0,6).map(card => ({
      head: (card.querySelector('.mc-head')||{}).innerText || '',
      headHtml: (card.querySelector('.mc-head')||{}).innerHTML || '',
      headRects: (function(){ const h=card.querySelector('.mc-head'); if(!h) return null;
        const r=h.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height)}; })(),
      oddsCells: [].slice.call(card.querySelectorAll('.mc-oddswrap,.mc-journey,.mc-drifted'))
                   .map(e => ({txt:e.innerText.replace(/\\n/g,' | '), title: e.getAttribute('title')||null})),
      rel: (card.querySelector('.mc-rel')||{}).innerText || null,
    }));
  })()`);
  console.log('\nRULING 1 + 2 — live card DOM (first 6 cards):');
  dom.forEach((d, i) => {
    console.log(`  [${i}] head="${d.head.replace(/\n/g, ' ')}"  (${d.headRects ? d.headRects.w + 'x' + d.headRects.h : '?'})  mc-rel=${JSON.stringify(d.rel)}`);
    d.oddsCells.forEach(o => console.log(`        odds cell: "${o.txt}"  title=${JSON.stringify(o.title)}`));
  });
  const relCount = await c.evaluate(`document.querySelectorAll('.mc-rel').length`);
  const twoLineHeads = await c.evaluate(`[].slice.call(document.querySelectorAll('.mc-head'))
      .filter(h => h.getBoundingClientRect().height > 40).length`);
  console.log(`\n  .mc-rel countdown nodes on the board : ${relCount}`);
  console.log(`  .mc-head taller than 40px (wrapped)  : ${twoLineHeads} of ${await c.evaluate(`document.querySelectorAll('.mc-head').length`)}`);

  // Does the book name appear anywhere on a card FACE (not a title attr)?
  const bookOnFace = await c.evaluate(`(function(){
    const books = new Set();
    matches.forEach(m => { const p = _mcNowPair(m); if (p && p.book) books.add(p.book); });
    const out = [];
    [].slice.call(document.querySelectorAll('.match-card')).forEach(card => {
      const t = card.innerText;
      books.forEach(b => { if (t.toLowerCase().indexOf(b.toLowerCase()) >= 0) out.push({card: (card.querySelector('.mc-name')||{}).innerText, book: b}); });
    });
    return { books: [...books], hits: out };
  })()`);
  console.log(`  books in play: ${bookOnFace.books.join(', ')}`);
  console.log(`  book name rendered on a card FACE: ${bookOnFace.hits.length} hit(s)` +
              (bookOnFace.hits.length ? ' -> ' + JSON.stringify(bookOnFace.hits.slice(0, 5)) : ''));

  // ------------------------------------------- ruling 3: does clicking sort?
  const orderBefore = await c.evaluate(`[].slice.call(document.querySelectorAll('.match-card')).map(c=>c.dataset.id).join(',')`);
  await c.evaluate(`document.querySelector('[data-mxsummary="drift"]').click()`);
  await sleep(600);
  const orderAfter = await c.evaluate(`[].slice.call(document.querySelectorAll('.match-card')).map(c=>c.dataset.id).join(',')`);
  const sortState = await c.evaluate(`state.sort`);
  console.log(`\nRULING 3 — click Biggest market move:`);
  console.log(`  state.sort after click : ${sortState}`);
  console.log(`  card order CHANGED     : ${orderBefore !== orderAfter}`);
  fs.writeFileSync('ten225-cardfix-order.json', JSON.stringify({ orderBefore, orderAfter, sortState }, null, 2));

  c.close();
} catch (e) {
  console.error('PROBE ERROR: ' + e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
