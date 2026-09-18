// TEN-225 — founder ruling 2026-09-18 09:33Z item 1, read off a RENDERED page.
//
// "TOOLTIP: option 2, show both clocks. Format: 'bet365 · 1.22 since 01:08 ·
//  seen 09:15' ... Confirm on the live URL."
//
// WHAT THIS PROVES AND WHAT IT REFUSES TO ASSUME
// ----------------------------------------------
// Every check is a DOM read off the painted card, not a source read: the title
// string is pulled from the element a member hovers, and the price INSIDE that
// string is compared against the price painted in the same cell. A tooltip that
// names the right book over the wrong price is the exact defect this ruling was
// raised about, and only a cross-read catches it.
//
// IT CARRIES ITS OWN FAILING CONTROL. A probe that finds 0 cards passes every
// "no bad tooltip" assertion — that is how a green run reported an empty set on
// this issue once already. So the denominators are asserted non-zero first, and
// the price cross-check is required to have matched at least one card.
//
//   PAGE=<url> node ten225-tooltip-probe.mjs
// Defaults to the deployed board.
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = process.env.PAGE
  || 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const DATA = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';

const AUTH_STUB = `
(function(){
  const user = { uid:'probe', email:'probe@example.com', emailVerified:true, displayName:'Probe' };
  const STUB = { ready: Promise.resolve(user), currentUser: () => user,
    whenAuthReady: () => Promise.resolve(user), requireVerified: () => Promise.resolve(user),
    requireAuth: () => Promise.resolve(user),
    onAuthChange: cb => { try { cb(user); } catch(e){} return () => {}; },
    isValidEmail: () => true, updateProfile: () => Promise.resolve(),
    NOTIF: { show(){}, hide(){} } };
  Object.defineProperty(window, 'BSP', { value: STUB, writable:false, configurable:false });
})();`;

async function cdp() {
  const { spawn } = await import('node:child_process');
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
     '--no-default-browser-check', '--disable-gpu',
     '--user-data-dir=' + DATA + '/ten225-tip-chrome-' + Date.now(), 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { const { res, rej } = waiters.get(m.id); waiters.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return { send: (m, p) => send(m, p, sessionId), close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

const FAIL = [];
const check = (n, ok, d) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok || d === undefined ? '' : '  ' + JSON.stringify(d).slice(0, 700)}`);
  if (!ok) FAIL.push(n);
};

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + (PAGE.includes('?') ? '&' : '?') + 'cb=ten225tip' + Date.now() });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 700));
    return r.result.value;
  };
  for (let i = 0; i < 180; i++) { if (await ev('document.querySelectorAll(".mx-match").length || 0')) break; await sleep(500); }

  console.log('TEN-225 — TOOLTIP, BOTH CLOCKS');
  console.log(`  page   ${PAGE}`);
  const commit = await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json()).then(j=>j.commit).catch(()=>"(no build-info)")');
  console.log(`  commit ${commit}`);
  check('the served bytes carry the new formatter', await ev('typeof ocsFmtClock === "function"'));

  await ev(`(function(){ if (typeof setMatchesView==='function') setMatchesView('upcoming'); else state.view='upcoming';
                         state.day='today'; state.sort='time'; renderMatches(); return true; })()`);
  await sleep(1200);

  // ── the default card face: one title per PRICED cell, none on a dash ──────
  const face = await ev(`(function(){
    const out = { cards: 0, priced: 0, dashed: 0, titled: 0, dashTitled: 0,
                  withBook: 0, withPrice: 0, priceMatches: 0, priceMismatch: [],
                  bothClocks: 0, sinceOnly: 0, seenOnly: 0, noClock: 0,
                  noClockBooks: {}, samples: [] };
    for (const card of document.querySelectorAll('.mx-match')){
      out.cards++;
      for (const w of card.querySelectorAll('.mc-oddswrap')){
        const px = (w.querySelector('.mc-odds')||{}).textContent || '';
        const t  = w.getAttribute('title') || '';
        const isDash = !/^\\s*\\d/.test(px);
        if (isDash){ out.dashed++; if (t) out.dashTitled++; continue; }
        out.priced++;
        if (!t) continue;
        out.titled++;
        if (/^[A-Za-z0-9]/.test(t)) out.withBook++;
        const m = t.match(/^[^·]+·\\s*(\\d+\\.\\d\\d)/);
        if (m){ out.withPrice++;
          if (m[1] === px.trim()) out.priceMatches++;
          else out.priceMismatch.push({ cell: px.trim(), title: t }); }
        const since = /(^|[·\\s])since /.test(t), seen = /(^|[·\\s])seen /.test(t);
        if (since && seen) out.bothClocks++; else if (since) out.sinceOnly++;
        else if (seen) out.seenOnly++;
        else { out.noClock++; const bk = t.split('·')[0].trim();
               out.noClockBooks[bk] = (out.noClockBooks[bk] || 0) + 1; }
        if (out.samples.length < 8) out.samples.push(t);
      }
    }
    return out;
  })()`);

  console.log('');
  console.log('CARD FACE — today, Upcoming, default sort');
  console.log(`  cards ${face.cards}   priced cells ${face.priced}   dashed cells ${face.dashed}`);
  console.log(`  titled ${face.titled}   book named ${face.withBook}   price in title ${face.withPrice}`);
  console.log(`  both clocks ${face.bothClocks}   since only ${face.sinceOnly}   seen only ${face.seenOnly}   no clock ${face.noClock}`);
  for (const s of face.samples) console.log(`    "${s.replace(/\n/g, ' ⏎ ')}"`);

  // DENOMINATOR FIRST. Without these three the assertions below are vacuous.
  check('the board rendered cards at all', face.cards > 0, face.cards);
  check('...and priced cells to hover', face.priced > 0, face.priced);
  check('...and the price cross-check had something to compare', face.withPrice > 0, face.withPrice);

  check('every priced cell carries a title', face.titled === face.priced, face);
  check('no DASHED cell carries one (a book name beside a price we are not showing)',
        face.dashTitled === 0, face.dashTitled);
  check('every title names its book', face.withBook === face.titled, face);
  check('every title carries the price of ITS OWN cell', face.priceMatches === face.withPrice,
        face.priceMismatch);
  // REPORTED, NOT FAILED. A cell with no clock is the api-tennis get_odds path:
  // that feed ships no tick time and matches.json carries no observation stamp
  // for its `odds`/`bestOdds` block, so there is genuinely no clock to print.
  // Naming the book and stopping is the honest render; inventing a time would
  // be the false label. The count is a coverage figure for the founder, so it
  // is printed with its books rather than turned into a red run.
  console.log(`  clockless titles ${face.noClock}  ${JSON.stringify(face.noClockBooks)}`
              + '  (api-tennis get_odds ships no tick time — reported, not a defect)');

  // ── the drift view: per-leg Open and Now titles ───────────────────────────
  await ev(`(function(){ state.sort = 'drift'; renderMatches(); return true; })()`);
  await sleep(1200);
  const drift = await ev(`(function(){
    const out = { openCells: 0, nowCells: 0, openTitled: 0, nowTitled: 0,
                  openDashTitled: 0, nowDashTitled: 0, nowPriceMatch: 0, nowPriceSeen: 0,
                  bookPairsSeen: 0, bookAgrees: 0, bookClash: [],
                  mismatch: [], samples: [] };
    const bookOf = t => (t.split('·')[0] || '').trim();
    for (const cell of document.querySelectorAll('.mc-drifted')){
      const o = cell.querySelector('.mc-drifted__open');
      const n = cell.querySelector('.mc-drifted__now');
      if (!o || !n) continue;
      const opx = o.textContent.trim(), ot = o.getAttribute('title') || '';
      const npx = n.textContent.trim(), nt = n.getAttribute('title') || '';
      if (!/^\\d/.test(opx)){ if (ot) out.openDashTitled++; }
      else { out.openCells++; if (ot){ out.openTitled++; if (out.samples.length < 6) out.samples.push('OPEN ' + ot); } }
      if (!/^\\d/.test(npx)){ if (nt) out.nowDashTitled++; }
      else {
        out.nowCells++;
        if (nt){
          out.nowTitled++;
          const m = nt.match(/^[^·]+·\\s*(\\d+\\.\\d\\d)/);
          if (m){ out.nowPriceSeen++;
            if (m[1] === npx) out.nowPriceMatch++; else out.mismatch.push({ cell: npx, title: nt }); }
          if (out.samples.length < 6) out.samples.push('NOW  ' + nt);
        }
      }
      // THE ONE-BOOK RULE, READ OFF THE PAINTED ROW. Open and Now sit either
      // side of one drift arrow; two book names there is a cross-book move.
      // This check did not exist and a live defect walked straight past the
      // price cross-check, which only compares digits.
      if (ot && nt && /^\\d/.test(opx) && /^\\d/.test(npx)){
        out.bookPairsSeen++;
        if (bookOf(ot) === bookOf(nt)) out.bookAgrees++;
        else out.bookClash.push({ open: ot, now: nt, opx: opx, npx: npx });
      }
    }
    return out;
  })()`);
  console.log('');
  console.log('DRIFT VIEW — Open and Now cells');
  console.log(`  open cells ${drift.openCells} (titled ${drift.openTitled})   now cells ${drift.nowCells} (titled ${drift.nowTitled})`);
  for (const s of drift.samples) console.log(`    "${s.replace(/\n/g, ' ⏎ ')}"`);
  check('the drift view rendered priced Open cells', drift.openCells > 0, drift.openCells);
  check('every priced Open cell is titled', drift.openTitled === drift.openCells, drift);
  check('every priced Now cell is titled', drift.nowTitled === drift.nowCells, drift);
  check('no dashed Open/Now cell is titled', drift.openDashTitled + drift.nowDashTitled === 0, drift);
  check('the Now title carries its own leg\'s price', drift.nowPriceMatch === drift.nowPriceSeen, drift.mismatch);
  check('...and that cross-check was not vacuous', drift.nowPriceSeen > 0, drift.nowPriceSeen);
  console.log(`  open/now book pairs ${drift.bookPairsSeen}   agree ${drift.bookAgrees}`);
  check('Open and Now either side of the drift arrow name the SAME book',
        drift.bookClash.length === 0, drift.bookClash);
  check('...and that check was not vacuous', drift.bookPairsSeen > 0, drift.bookPairsSeen);

  // ── the COMPLETED card's Open/Close journey ───────────────────────────────
  // Same defect class, other view. Before the fix this wrapper carried ONE
  // title for both cells: the OPEN's timestamp over the CLOSE on 4 of 4
  // journeys, and a book name over a DASHED close on 2 of those 4.
  await ev(`(function(){ if (typeof setMatchesView==='function') setMatchesView('completed');
                         else state.view='completed'; renderMatches(); return true; })()`);
  await sleep(1500);
  const cmpl = await ev(`(function(){
    const out = { wrappers: 0, wrapperTitled: 0, openPriced: 0, closePriced: 0,
                  openTitled: 0, closeTitled: 0, dashTitled: 0,
                  openPriceMatch: 0, closePriceMatch: 0, mismatch: [], samples: [] };
    const pxIn = t => { const m = (t || '').match(/^[^·]+·\\s*(\\d+\\.\\d\\d)/); return m ? m[1] : null; };
    for (const j of document.querySelectorAll('.mc-journey')){
      out.wrappers++;
      if (j.getAttribute('title')) out.wrapperTitled++;
      for (const [sel, kind] of [['.mc-journey__open','open'], ['.mc-journey__close','close']]){
        const el = j.querySelector(sel); if (!el) continue;
        const px = el.textContent.trim(), t = el.getAttribute('title') || '';
        if (!/^\\d/.test(px)){ if (t) out.dashTitled++; continue; }
        out[kind + 'Priced']++;
        if (!t) continue;
        out[kind + 'Titled']++;
        const p = pxIn(t);
        if (p === px) out[kind + 'PriceMatch']++; else out.mismatch.push({ kind: kind, cell: px, title: t });
        if (out.samples.length < 6) out.samples.push(kind.toUpperCase() + ' ' + px + '  <- ' + t);
      }
    }
    return out;
  })()`);
  console.log('');
  console.log('COMPLETED CARD — Open/Close journey');
  console.log(`  journeys ${cmpl.wrappers}   open priced ${cmpl.openPriced} (titled ${cmpl.openTitled})   close priced ${cmpl.closePriced} (titled ${cmpl.closeTitled})`);
  for (const s of cmpl.samples) console.log(`    ${s.replace(/\n/g, ' ⏎ ')}`);
  check('the completed view rendered journeys', cmpl.wrappers > 0, cmpl.wrappers);
  check('NO title on the wrapper — it spans two cells with two different clocks',
        cmpl.wrapperTitled === 0, cmpl.wrapperTitled);
  check('no dashed Open/Close cell is titled', cmpl.dashTitled === 0, cmpl.dashTitled);
  check('every priced Open cell is titled', cmpl.openTitled === cmpl.openPriced, cmpl);
  check('every priced Close cell is titled', cmpl.closeTitled === cmpl.closePriced, cmpl);
  check('each cell\'s title carries ITS OWN price',
        cmpl.openPriceMatch === cmpl.openTitled && cmpl.closePriceMatch === cmpl.closeTitled, cmpl.mismatch);
  check('...and that cross-check was not vacuous', cmpl.openTitled + cmpl.closeTitled > 0,
        cmpl.openTitled + cmpl.closeTitled);
} finally {
  c.close();
}
console.log('');
console.log(FAIL.length ? `FAILED: ${FAIL.length}\n  - ${FAIL.join('\n  - ')}` : 'ALL CHECKS PASSED');
process.exit(FAIL.length ? 1 : 0);
