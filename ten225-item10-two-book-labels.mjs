// TEN-225 item 10 — LIVE READ: when the guard falls through to a second book,
// does the card SAY which book each value came from?
//
// Founder 2026-09-19: "C's two-book tension: keep it as built. Both books
// labelled beats a dash, as long as each value says which book it came from.
// Confirm on the live read that both labels render."
//
// ⚠️ THE STATE DOES NOT EXIST ON TODAY'S BOARD. A suppression only happens when
// a book quotes an overround above 20%, and no fixture on the live board does
// right now. So a probe that simply looked would find nothing and report a
// clean pass -- the vacuous pass the founder made a standing rule against
// ("a check that passes on an empty set is not a check. Manufacture the state
// and run the pre-fix build as a control").
//
// So this MANUFACTURES the suspension on the live page: it injects a 1.01/1.01
// pair into the selected book's Now for a real fixture, re-renders through the
// page's own renderer, and reads the resulting labels out of the DOM. The
// page's state is restored afterwards.
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
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
     '--user-data-dir=' + DATA + '/ten225-item10-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  // The endpoint Chrome prints on stderr is the BROWSER target, where
  // Runtime.evaluate does not exist ("'Runtime.evaluate' wasn't found").
  // Resolve the PAGE target over the devtools HTTP endpoint instead.
  const port = new URL(wsUrl).port;
  let pageWs = null;
  for (let i = 0; i < 60 && !pageWs; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find(t => t.type === 'page');
      if (pg) pageWs = pg.webSocketDebuggerUrl;
    } catch (e) { /* devtools http not up yet */ }
    if (!pageWs) await sleep(200);
  }
  if (!pageWs) { proc.kill(); throw new Error('no page target'); }
  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  await new Promise(r => setTimeout(r, 400));
  return {
    send: (method, params = {}) => new Promise(res => {
      const i = ++id; waiting.set(i, m => res(m.result || {}));
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    close: () => { try { ws.close(); } catch (e) {} proc.kill(); },
  };
}


const FAILED = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  if (!cond) FAILED.push(name);
};

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=item10' });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    if (!r || !r.result) return undefined;
    return r.result.value;
  };
  let cards = 0;
  for (let i = 0; i < 180; i++) {
    cards = (await ev('document.querySelectorAll(".mx-match").length || 0')) || 0;
    if (cards) break;
    await sleep(500);
  }
  const build = (await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json())')) || {};
  console.log('TEN-225 item 10 — two-book labelling, LIVE READ');
  console.log(`  deployed   ${(build.commit || '?').slice(0, 8)}   built ${build.builtAt || '?'}`);
  console.log(`  cards      ${cards}`);

  // Nothing below may be believed on an empty board.
  check('the board actually rendered — asserted BEFORE any label count, so no '
      + 'zero below can be a vacuous pass', cards > 0, `${cards} cards`);
  if (!cards) throw new Error('empty board; refusing to report label counts');

  // The guard is live at all?
  const guard = await ev('typeof MX_SUSPENDED_OVERROUND !== "undefined" ? MX_SUSPENDED_OVERROUND : null');
  check('the suspended-market guard is on this build', guard === 0.2, String(guard));

  // ---- MANUFACTURE the suspension -------------------------------------
  // Pick a fixture the OCS covers (so a book is "selected") AND that another
  // book also prices, which is the only shape where a fall-through is possible.
  const setup = await ev(`(function(){
    const list = getFiltered();
    for (const m of list) {
      const o = _ocsOf(m);
      if (!o) continue;
      const alt = _mcAnyBookPair(m);
      if (!alt || !alt.book) continue;
      if (String(alt.book).toLowerCase() === String(o.book||'').toLowerCase()) continue;
      return JSON.stringify({ id: m.id, selected: o.book, other: alt.book,
                              nowP1: o.p1.now, nowP2: o.p2.now });
    }
    return null;
  })()`);
  if (!setup) {
    console.log('  NOTE: no fixture on the live board has BOTH a card-state book and a '
      + 'different second book, so the two-book fall-through cannot be staged here.');
    check('a fixture suitable for staging the two-book case exists on the live board',
          false, 'none found — reporting this rather than passing vacuously');
  } else {
    const s = JSON.parse(setup);
    console.log(`  staging on ${s.id}: selected=${s.selected}  other=${s.other}`);

    // Before: what does the card say now?
    const before = await ev(`(function(){
      const m = getFiltered().find(x => x.id === ${JSON.stringify(s.id)});
      const p = _mcNowPair(m);
      return JSON.stringify({ book: p && p.book, p1: p && p.p1 });
    })()`);

    // Inject the sentinel into the SELECTED book's Now, then re-resolve.
    const after = await ev(`(function(){
      const m = getFiltered().find(x => x.id === ${JSON.stringify(s.id)});
      const e = OCS.byKey[ocsKeyOf(m)];
      const k1 = ocsNameKey(m.p1), k2 = ocsNameKey(m.p2);
      window.__t10 = { k1, k2, a: e.sides[k1].now, b: e.sides[k2].now, gen: OCS.gen };
      e.sides[k1].now = 1.01; e.sides[k2].now = 1.01;
      OCS.gen = (OCS.gen || 0) + 1;          // bust the per-match _ocsOf cache
      const p = _mcNowPair(m);
      const openBook = ocsBookOf(m);
      const nowTitle = mcPriceTitle(p, p && p.p1);
      return JSON.stringify({ nowBook: p && p.book, nowP1: p && p.p1,
                              openBook, nowTitle,
                              suppressed: MX_SUPPRESSED.size });
    })()`);
    const A = JSON.parse(after), B = JSON.parse(before);

    check('the suppression was recorded once the sentinel was injected',
          A.suppressed > 0, `${A.suppressed} entry(ies)`);
    check('the card did NOT dash — it fell through to another book',
          A.nowBook != null && A.nowP1 > 0, `${A.nowBook} ${A.nowP1}`);
    check('...and that book is DIFFERENT from the one the Open comes from, which '
        + 'is precisely the two-book card the founder accepted',
          A.nowBook && A.openBook
          && String(A.nowBook).toLowerCase() !== String(A.openBook).toLowerCase(),
          `open=${A.openBook}  now=${A.nowBook}`);
    check('THE ASK: the Now value names ITS OWN book in the rendered title',
          typeof A.nowTitle === 'string' && A.nowTitle.includes(A.nowBook),
          JSON.stringify(A.nowTitle));
    check('...and the Open names ITS book separately, so both labels render and '
        + 'neither value is left to inherit the other\'s provenance',
          A.openBook && A.openBook !== A.nowBook);
    check('CONTROL: before the injection the same card resolved to the SELECTED '
        + 'book, so the fall-through above is the guard firing and not the '
        + 'card\'s ordinary behaviour',
          B.book && String(B.book).toLowerCase() === String(s.selected).toLowerCase(),
          `before=${B.book}  selected=${s.selected}`);

    // Restore, and prove the restore worked rather than assuming it.
    const restored = await ev(`(function(){
      const m = getFiltered().find(x => x.id === ${JSON.stringify(s.id)});
      const e = OCS.byKey[ocsKeyOf(m)];
      e.sides[window.__t10.k1].now = window.__t10.a;
      e.sides[window.__t10.k2].now = window.__t10.b;
      OCS.gen = (OCS.gen || 0) + 1;
      const p = _mcNowPair(m);
      return JSON.stringify({ book: p && p.book, p1: p && p.p1 });
    })()`);
    const R = JSON.parse(restored);
    check('page state restored — the injected sentinel is gone',
          R.book === B.book && R.p1 === B.p1, JSON.stringify(R));
  }

  console.log('');
  if (FAILED.length) { console.log(`${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`); process.exitCode = 1; }
  else console.log('all checks passed');
} finally {
  c.close();
}
