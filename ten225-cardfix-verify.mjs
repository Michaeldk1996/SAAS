#!/usr/bin/env node
// TEN-225 rulings 1, 2, 3, 4c — VERIFICATION.
//
// Hybrid server: the BRANCH's dashboard HTML against the DEPLOYED data files
// (matches.json + odds-card-state.json, fetched live by the caller into this
// worktree). Measuring the branch against the worktree's committed JSON would
// measure a store that is refreshed by cron and not by this push, which has
// voided an investigation on this codebase before.
//
// Every assertion is a MUTATION or a COUNT, never a source read:
//   1. countdown  — .mc-rel node count, and header heights before/after.
//   2. hover      — title attributes on the odds cells, and the drawer row.
//   3. sort       — the board's ORDER must change to descending |open->now| and
//                   an unpairable fixture must still be present, at the bottom.
//   4c. started   — a started fixture's drift column reads "Close", not "Now".
//
// A CONTROL runs first: the same probe against the DEPLOYED page, which must
// FAIL rulings 1-3. A probe that passes on the un-fixed build proves nothing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
               '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gz': 'application/gzip' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, p === '/' ? '/bsp-consult-dashboard.html' : p);
  if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten225-verify-'));
const dport = 9100 + Math.floor(process.pid % 400);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1500,1400', 'about:blank',
], { stdio: 'ignore' });

async function target() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
      const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP target');
}
function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = async (method, params = {}) => {
    await ready; const mid = ++id;
    return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  };
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

let fails = 0;
const R = [];
function check(label, pass, detail) {
  const line = `${pass ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  —  ' + detail : ''}`;
  R.push(line); console.log(line);
  if (!pass) fails++;
}

// Drive one page (branch or deployed) and return its measurements.
async function measure(url, label) {
  const c = client(await target());
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(window,'BSP',{configurable:true,
      get(){return window.__bsp;},
      set(v){window.__bsp=v;try{v.requireVerified=async()=>({ok:true,user:{email:'probe@local'}});v.requireAuth=async()=>true;}catch(e){}}});`,
  });
  await c.send('Page.navigate', { url });
  let ok = false;
  for (let i = 0; i < 140; i++) {
    await sleep(500);
    try {
      ok = await c.evaluate(`(Array.isArray(matches) && matches.length > 0
        && typeof _mcNowPair === 'function' && typeof OCS === 'object' && OCS.loaded === true)`);
    } catch {}
    if (ok) break;
  }
  if (!ok) throw new Error(`${label}: board never became ready`);

  const out = await c.evaluate(`(function(){
    const heads = [].slice.call(document.querySelectorAll('.mc-head'));
    const cards = [].slice.call(document.querySelectorAll('.match-card'));
    return {
      nMatches: matches.length,
      relNodes: document.querySelectorAll('.mc-rel').length,
      heads: heads.length,
      headsWrapped: heads.filter(h => h.getBoundingClientRect().height > 45).length,
      headHeights: heads.slice(0,4).map(h => Math.round(h.getBoundingClientRect().height)),
      headText: heads.slice(0,3).map(h => h.innerText.replace(/\\n/g,' ')),
      oddsCells: cards.length,
      oddsTitled: [].slice.call(document.querySelectorAll('.mc-oddswrap[title]')).length,
      oddsTotal: document.querySelectorAll('.mc-oddswrap').length,
      // The title is CORRECT only where we actually know a book. A dashed cell must
      // carry NO title — naming a book beside a price we are not showing is the
      // false-label failure this ruling exists to prevent. So the assertion is a
      // two-sided partition, not "titled >= n".
      titlePartition: (function(){
        const cells = [].slice.call(document.querySelectorAll('.mc-oddswrap'));
        let pricedTitled = 0, pricedUntitled = 0, dashedTitled = 0, dashedUntitled = 0;
        cells.forEach(c => {
          const priced = !/^\\s*[—-]\\s*$/.test((c.querySelector('.mc-odds')||{}).textContent || '');
          const titled = c.hasAttribute('title');
          if (priced && titled) pricedTitled++;
          else if (priced) pricedUntitled++;
          else if (titled) dashedTitled++;
          else dashedUntitled++;
        });
        return { pricedTitled, pricedUntitled, dashedTitled, dashedUntitled, total: cells.length };
      })(),
      sampleTitles: [].slice.call(document.querySelectorAll('.mc-oddswrap[title]')).slice(0,4).map(e => e.getAttribute('title')),
      hasMoveNowScore: typeof moveNowScore === 'function',
      hasRelStart: typeof relStartHtml === 'function',
      // Ruling 2's negative half: the book must NOT be on the card face. Searched
      // over the books actually in play on THIS board, not a hardcoded list, and
      // over innerText only — a title attribute is not face text, which is the
      // whole distinction the ruling draws.
      bookOnFace: (function(){
        const books = new Set();
        matches.forEach(m => { const p = _mcNowPair(m); if (p && p.book) books.add(p.book); });
        let hits = 0;
        cards.forEach(card => {
          const t = (card.innerText || '').toLowerCase();
          books.forEach(bk => { if (t.indexOf(String(bk).toLowerCase()) >= 0) hits++; });
        });
        return { books: [...books], hits };
      })(),
    };
  })()`);

  // sort behaviour — measured as a mutation of the rendered order
  const defaultPriced = await c.evaluate(`(function(){
    state.sort = 'time'; renderMatches();
    const cells = [].slice.call(document.querySelectorAll('.mc-odds'));
    return { priced: cells.filter(e => !/^\\s*[—-]\\s*$/.test(e.textContent||'')).length,
             total: cells.length };
  })()`);
  const sortOut = await c.evaluate(`(function(){
    // reset to the default sort first so the comparison is deterministic
    state.sort = 'time'; renderMatches();
    const idsBefore = [].slice.call(document.querySelectorAll('.match-card')).map(c=>c.dataset.id);
    document.querySelector('[data-mxsummary="drift"]').click();
    const idsAfter = [].slice.call(document.querySelectorAll('.match-card')).map(c=>c.dataset.id);
    const byId = {}; matches.forEach(m => byId[m.id] = m);
    const scoreOf = (id) => (typeof moveNowScore === 'function' && byId[id]) ? moveNowScore(byId[id])
                          : (typeof driftScore === 'function' && byId[id]) ? driftScore(byId[id]) : null;
    const scores = idsAfter.map(scoreOf).filter(s => s !== null);
    const monotone = scores.every((s,i) => i === 0 || scores[i-1] >= s);
    const nonZero = scores.filter(s => s > 0).length;
    return { sortState: state.sort, idsBefore, idsAfter,
             orderChanged: idsBefore.join(',') !== idsAfter.join(','),
             scores, monotone, nonZero,
             countBefore: idsBefore.length, countAfter: idsAfter.length,
             // ruling 4c — the per-card drift column header
             driftHeads: [].slice.call(document.querySelectorAll('.mc-colhead-drift'))
                           .map(h => h.innerText.replace(/\\s+/g,' ').trim()),
             // Same two-sided partition as the odds column: a drift cell carries a
             // provenance title exactly where a book is known (i.e. where the fixture
             // has any published/pinned odds at all), and none where it does not.
             driftPartition: (function(){
               const cells = [].slice.call(document.querySelectorAll('.mc-drifted'));
               let knownTitled = 0, knownUntitled = 0, unknownTitled = 0, unknownUntitled = 0;
               cells.forEach(c => {
                 const card = c.closest('.match-card');
                 const m = matches.find(x => x.id === (card && card.dataset.id));
                 const known = !!(m && ocsProvenance(m));
                 const titled = c.hasAttribute('title');
                 if (known && titled) knownTitled++;
                 else if (known) knownUntitled++;
                 else if (titled) unknownTitled++;
                 else unknownUntitled++;
               });
               return { knownTitled, knownUntitled, unknownTitled, unknownUntitled, total: cells.length };
             })(),
             startedCards: matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m)===state.day
                            && isFinite(cardStartMs(m)) && Date.now() >= cardStartMs(m))
                           .map(m => m.p1 + ' v ' + m.p2),
             // Per-LEG titles: a leg showing a price must be titled; a leg showing a
             // dash must not. Measured on the inner spans, not the wrapper — a
             // wrapper title is asserted over both legs including a dashed one.
             legTitles: (function(){
               const legs = [].slice.call(document.querySelectorAll('.mc-drifted__open, .mc-drifted__now'));
               let pricedTitled=0, pricedUntitled=0, dashedTitled=0, dashedUntitled=0;
               legs.forEach(e => {
                 const dashed = /^\s*[—-]\s*$/.test(e.textContent || '');
                 const titled = e.hasAttribute('title');
                 if (!dashed && titled) pricedTitled++;
                 else if (!dashed) pricedUntitled++;
                 else if (titled) dashedTitled++;
                 else dashedUntitled++;
               });
               return { pricedTitled, pricedUntitled, dashedTitled, dashedUntitled, total: legs.length };
             })(),
             wrapperTitles: document.querySelectorAll('.mc-drifted[title]').length,
             blankedLegs: (function(){
               const slate = matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m)===state.day);
               const out = [];
               slate.forEach(m => {
                 const face = _mcNowPair(m);
                 const pair = (typeof _mcOpenNowPair === 'function') ? _mcOpenNowPair(m) : null;
                 const hasOpen = _openAnchorOf(m,'p1') != null || _openAnchorOf(m,'p2') != null;
                 const ocs = _ocsOf(m);
                 const openBook = ocs ? ocs.book : ((m.openingOdds||{}).bookmaker || null);
                 ['p1','p2'].forEach(w => {
                   const faceV = face ? face[w] : null;
                   const driftV = pair ? (w==='p1'?pair.n1:pair.n2)
                                : (hasOpen || typeof _mcOpenNowPair !== 'function')
                                  ? _mcNowOf(m,w)
                                  : (face ? face[w] : null);
                   if (faceV != null && driftV == null)
                     out.push({ fx: m.p1+' v '+m.p2, side: w, face: faceV,
                                faceBook: face.book, openBook,
                                crossBook: !!(hasOpen && openBook && face.book
                                              && String(openBook).toLowerCase() !== String(face.book).toLowerCase()) });
                 });
               });
               return out;
             })(),
             driftLegsPriced: [].slice.call(document.querySelectorAll('.mc-drifted__now'))
               .filter(e => !/^\s*[—-]\s*$/.test(e.textContent||'')).length,
             driftLegsTotal: document.querySelectorAll('.mc-drifted__now').length,
             // Zero must never reach a price cell, a score, or the tile.
             zeroCells: [].slice.call(document.querySelectorAll('.mc-odds, .mc-drifted__open, .mc-drifted__now'))
                          .filter(e => /^\s*0(\.0+)?\s*$/.test(e.textContent||'')).length,
             // typeof-guarded: this same probe runs against the DEPLOYED build as the
             // control, and the control's whole job is to be a build that lacks these.
             // An unguarded call throws there and silently costs us the control.
             maxScore: (typeof moveNowScore === 'function')
               ? Math.max.apply(null, matches.filter(m=>!isFinishedMatch(m)).map(m=>moveNowScore(m)).concat([-1]))
               : null,
             tileText: (document.querySelector('[data-mxsummary="drift"]')||{}).innerText || '',
             ocsZeroRowsSeen: (function(){
               // Does the PUBLISHED file still contain zeros, and does _ocsOf neutralise them?
               let raw = 0, leaked = 0;
               Object.keys(OCS.byKey||{}).forEach(k => {
                 const e = OCS.byKey[k];
                 Object.keys(e.sides||{}).forEach(sk => {
                   ['open','now','close'].forEach(f => { if (e.sides[sk][f] === 0) raw++; });
                 });
               });
               matches.forEach(m => { const o=_ocsOf(m); if(!o) return;
                 ['p1','p2'].forEach(w => ['open','now','close'].forEach(f => { if (o[w][f] === 0) leaked++; })); });
               return { raw, leaked };
             })(),
    };
  })()`);

  // ruling 2 second half — the drawer row
  const drawer = await c.evaluate(`(function(){
    const m = matches.find(x => !isFinishedMatch(x) && _mcNowPair(x));
    if (!m) return { found:false };
    const html = buildOddsSection(m);
    const d = document.createElement('div'); d.innerHTML = html;
    const rows = [].slice.call(d.querySelectorAll('.aodds-brow')).map(r => r.innerText.replace(/\\s+/g,' ').trim());
    const pair = _mcNowPair(m);
    return { found:true, match: m.p1+' v '+m.p2, book: pair.book, rows,
             currentRow: rows.find(r => r.indexOf('Current') === 0) || null };
  })()`);

  c.close();
  return { ...out, sort: sortOut, drawer, defaultPriced };
}

try {
  console.log('=== CONTROL: the DEPLOYED build (must FAIL rulings 1-3) ===');
  let control = null;
  try {
    control = await measure('https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html', 'deployed');
    console.log(`  deployed: n=${control.nMatches} .mc-rel=${control.relNodes} wrappedHeads=${control.headsWrapped}/${control.heads}`);
    console.log(`  deployed: .mc-oddswrap[title]=${control.oddsTitled}/${control.oddsTotal}  moveNowScore=${control.hasMoveNowScore}`);
    console.log(`  deployed: sort monotone=${control.sort.monotone} nonZeroScores=${control.sort.nonZero} driftHeads=${JSON.stringify([...new Set(control.sort.driftHeads)])}`);
    console.log(`  deployed: drawer rows=${JSON.stringify(control.drawer.rows)}`);
    check('CONTROL — the deployed build does NOT satisfy these rulings (probe can fail)',
          control.relNodes > 0 || control.oddsTitled === 0 || !control.hasMoveNowScore,
          `rel=${control.relNodes}, titled=${control.oddsTitled}, moveNowScore=${control.hasMoveNowScore}`);
  } catch (e) {
    console.log('  CONTROL skipped: ' + e.message);
  }

  console.log('\n=== BRANCH: worktree code + deployed data ===');
  const b = await measure(`http://127.0.0.1:${PORT}/bsp-consult-dashboard.html`, 'branch');
  console.log(`  branch: n=${b.nMatches}`);
  console.log(`  branch head text: ${JSON.stringify(b.headText)}`);

  // ---- ruling 1
  check('R1 — no countdown node anywhere on the board', b.relNodes === 0, `.mc-rel nodes = ${b.relNodes} (deployed: ${control ? control.relNodes : 'n/a'})`);
  check('R1 — relStartHtml is gone, not merely unused', b.hasRelStart === false, `typeof relStartHtml = ${b.hasRelStart ? 'function' : 'undefined'}`);
  check('R1 — no card header wraps to a second line', b.headsWrapped === 0,
        `wrapped ${b.headsWrapped}/${b.heads} (deployed: ${control ? control.headsWrapped + '/' + control.heads : 'n/a'}); heights ${JSON.stringify(b.headHeights)}`);

  // ---- ruling 2
  const tp = b.titlePartition;
  check('R2 — every PRICED odds cell carries a hover title', tp.total > 0 && tp.pricedUntitled === 0 && tp.pricedTitled > 0,
        `priced+titled ${tp.pricedTitled}, priced+untitled ${tp.pricedUntitled} (of ${tp.total} cells); e.g. ${JSON.stringify(b.sampleTitles.slice(0,2))}`);
  check('R2 — a DASHED cell names no book', tp.dashedTitled === 0,
        `dashed+titled ${tp.dashedTitled}, dashed+untitled ${tp.dashedUntitled}`);
  check('R2 — the title names a real book', b.sampleTitles.length > 0 && b.sampleTitles.every(t => t && t.trim().length > 1),
        JSON.stringify(b.sampleTitles.slice(0, 3)));
  check('R2 — no book name is printed on a card FACE', b.bookOnFace.hits === 0,
        `${b.bookOnFace.hits} hit(s) across ${b.bookOnFace.books.length} books in play: ${b.bookOnFace.books.join(', ')}`);
  check('R2 — the drawer carries a Current row naming the book', !!(b.drawer.found && b.drawer.currentRow && b.drawer.currentRow.includes(b.drawer.book)),
        `${b.drawer.match}: ${JSON.stringify(b.drawer.currentRow)} (book ${b.drawer.book})`);

  // ---- ruling 3
  check('R3 — clicking the tile sets the drift sort', b.sort.sortState === 'drift', b.sort.sortState);
  check('R3 — the rendered order is descending by |open→now|', b.sort.monotone,
        `scores ${JSON.stringify(b.sort.scores.map(s => s === -1 ? -1 : +(s*100).toFixed(1)))}`);
  check('R3 — at least one fixture scores a real move (the order is not all-zero)', b.sort.nonZero > 0,
        `${b.sort.nonZero} of ${b.sort.scores.length} fixtures score > 0 (deployed all-zero: ${control ? control.sort.nonZero === 0 : 'n/a'})`);
  check('R3 — no fixture is HIDDEN by the sort', b.sort.countBefore === b.sort.countAfter,
        `${b.sort.countBefore} cards before, ${b.sort.countAfter} after`);
  check('R3 — unpairable fixtures sort to the BOTTOM', (() => {
          const s = b.sort.scores;
          const firstNeg = s.indexOf(-1);
          return firstNeg === -1 || s.slice(firstNeg).every(x => x === -1);
        })(), `first -1 at index ${b.sort.scores.indexOf(-1)} of ${b.sort.scores.length}`);

  // ---- ruling 4c
  // innerText is the RENDERED text, so a text-transform:uppercase header reads
  // "OPEN CLOSE" — matched case-insensitively rather than against the source string.
  const heads = [...new Set(b.sort.driftHeads)];
  const nClose = b.sort.driftHeads.filter(h => /close/i.test(h)).length;
  const nNow = b.sort.driftHeads.filter(h => /now/i.test(h)).length;
  check('R4c — exactly the started fixtures relabel their column to Close',
        nClose === b.sort.startedCards.length,
        `${nClose} card(s) read Close, ${b.sort.startedCards.length} started: ${JSON.stringify(b.sort.startedCards)}`);
  check('R4c — every other fixture still reads Now', nNow === b.sort.driftHeads.length - nClose && nNow > 0,
        `${nNow} read Now of ${b.sort.driftHeads.length} headers; distinct: ${JSON.stringify(heads)}`);
  // (The old wrapper-level title assertion is gone: clean-context review showed a
  //  wrapper title is asserted over BOTH legs, including a dashed one. Titles moved
  //  to the legs, and REV2/4 below is the stricter successor — it partitions every
  //  leg, so it cannot pass by titling nothing.)

  // ---- regressions found by the clean-context review pass
  const z = b.sort.ocsZeroRowsSeen;
  check('REV1 — no cell renders a ZERO price', b.sort.zeroCells === 0, `${b.sort.zeroCells} zero-valued price cell(s)`);
  check('REV1 — published zeros exist AND are neutralised at the door',
        z.raw > 0 && z.leaked === 0,
        `published file still carries ${z.raw} zero field(s); ${z.leaked} reach a resolver (control: raw>0 proves the guard is exercised, not vacuous)`);
  check('REV1 — no fabricated 100% move tops the sort', b.sort.maxScore !== null && b.sort.maxScore < 1,
        `max moveNowScore = ${b.sort.maxScore === null ? 'n/a' : (b.sort.maxScore*100).toFixed(1) + '%'}`);
  check('REV1 — the tile does not headline a 0.00', !/0\.00/.test(b.sort.tileText),
        JSON.stringify(b.sort.tileText.replace(/\n/g,' ').slice(0,110)));
  // Every leg the drift view blanks must be a CROSS-BOOK leg — the fixture has an
  // Open from one book and the board's only current price is another book's. Those
  // must dash: two cells either side of a drift arrow belonging to two books is the
  // blend both rulings forbid. Any OTHER blanked leg is the resolver-swap defect.
  const unexplained = b.sort.blankedLegs.filter(l => !l.crossBook);
  check('REV5 — every leg the drift view blanks is a CROSS-BOOK leg, not a resolver swap',
        unexplained.length === 0,
        `default priced ${b.defaultPriced.priced}/${b.defaultPriced.total}; drift priced ` +
        `${b.sort.driftLegsPriced}/${b.sort.driftLegsTotal}; ${b.sort.blankedLegs.length} blanked, ` +
        `${b.sort.blankedLegs.length - unexplained.length} cross-book, ${unexplained.length} unexplained` +
        (unexplained.length ? ' -> ' + JSON.stringify(unexplained.slice(0,4)) : '') +
        (control ? ` (deployed: ${control.sort.blankedLegs.length} blanked, ${control.sort.blankedLegs.filter(l=>!l.crossBook).length} unexplained)` : ''));
  const lt = b.sort.legTitles;
  check('REV2/4 — a drift LEG is titled iff it shows a price',
        lt.pricedUntitled === 0 && lt.dashedTitled === 0 && lt.pricedTitled > 0,
        `priced+titled ${lt.pricedTitled}, priced+untitled ${lt.pricedUntitled}, dashed+titled ${lt.dashedTitled}, dashed+untitled ${lt.dashedUntitled}`);
  check('REV4 — no title on the drift WRAPPER (it spans both legs incl. a dash)',
        b.sort.wrapperTitles === 0, `${b.sort.wrapperTitles} wrapper title(s)`);

  fs.writeFileSync('ten225-cardfix-verify.json', JSON.stringify({ branch: b, control }, null, 2));
  console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
  process.exitCode = fails === 0 ? 0 : 1;
} catch (e) {
  console.error('PROBE ERROR: ' + e.message);
  process.exitCode = 2;
} finally {
  chrome.kill(); server.close();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
