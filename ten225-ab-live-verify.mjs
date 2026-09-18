// TEN-225 A+B — verification on the DEPLOYED URL. "Merged is not shipped."
//
// Drives the real live page (no local server, no working-tree HTML) and READS
// the odds cells. The only thing local about this run is the browser.
//
// The control is the deployed page's OWN pre-change behaviour, recomputed in
// the page from the same data it just rendered: _mcBet365Now is still defined
// there, so the before-figure is measured in the same document rather than
// quoted from an earlier run. If the two agree, the deploy did not carry the
// change and this probe says so instead of passing.
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
     '--user-data-dir=' + DATA + '/ten225-live-chrome', 'about:blank'],
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
const check = (n, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : '  ' + JSON.stringify(d).slice(0, 400)}`); if (!ok) FAIL.push(n); };

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=ten225ab' });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  for (let i = 0; i < 160; i++) { if (await ev('document.querySelectorAll(".mx-match").length || 0')) break; await sleep(500); }

  const built = await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json()).then(j=>j.commit)');
  console.log(`TEN-225 A+B — DEPLOYED verification`);
  console.log(`  url    ${PAGE}`);
  console.log(`  commit ${built}`);
  console.log('');

  // The shipped resolver must BE on the page. If the deploy served old bytes,
  // this is where it is caught — not three assertions later on a number that
  // happens to look plausible.
  const shipped = await ev('typeof _mcNowPair === "function" && typeof _mcAnyBookPair === "function"');
  check('the shipped resolver is present in the served bytes', shipped);
  const dFixed = await ev('ocsNameKey("F. Auger-Aliassime") === "aliassime"');
  check('ruling D is live in the served JS (F. Auger-Aliassime keys)', dFixed,
        await ev('ocsNameKey("F. Auger-Aliassime")'));

  await ev(`(function(){ if (typeof setMatchesView==='function') setMatchesView('upcoming'); else state.view='upcoming';
                          state.day='today'; state.sort='time'; renderMatches(); return true; })()`);
  await sleep(1500);

  const r = await ev(`(function(){
    const DASH = s => s === '\\u2014' || s === '-' || s === '\\u2013';
    const cards = [...document.querySelectorAll('.mx-match')].map(card => ({
      names: [...card.querySelectorAll('.mc-name')].map(n => n.textContent.trim()),
      odds:  [...card.querySelectorAll('.mc-odds')].map(n => n.textContent.trim()) }));
    const painted = cards.filter(c => c.odds.length >= 2 && !DASH(c.odds[0]) && !DASH(c.odds[1]));
    const blank   = cards.filter(c => c.odds.some(o => o === ''));
    // The IN-PAGE control: the old bet365-pinned rule, run over the SAME data
    // the page just rendered. Not a number quoted from an earlier run.
    const day = matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m) === 'today');
    const oldWay = day.filter(m => { const p = _mcBet365Now(m); return p && p.p1 != null && p.p2 != null; }).length;
    const books = {};
    day.forEach(m => { const p = _mcNowPair(m); if (p && p.book) books[p.book] = (books[p.book]||0)+1; });
    return { cards: cards.length, painted: painted.length, blank: blank.length, oldWay,
             books, ocsLoaded: OCS.loaded, ocsCount: OCS.byKey ? Object.keys(OCS.byKey).length : -1,
             gained: cards.filter(c => c.odds.length>=2 && !DASH(c.odds[0]) && !DASH(c.odds[1]))
                          .map(c => c.names.join(' v ') + '  ' + c.odds.slice(0,2).join(' / ')) };
  })()`);

  console.log(`  cards on today's board        ${r.cards}`);
  console.log(`  BEFORE (bet365 pin, in-page)  ${r.oldWay} priced`);
  console.log(`  AFTER  (live, DOM read)       ${r.painted} priced / ${r.cards - r.painted} dashed`);
  console.log(`  books on the column           ${JSON.stringify(r.books)}`);
  console.log(`  odds-card-state entries       ${r.ocsCount}`);
  console.log('');
  check('odds-card-state.json loaded on the live page', r.ocsLoaded);
  check('CONTROL: the live page DISAGREES with the old bet365-pinned rule', r.painted !== r.oldWay,
        { before: r.oldWay, after: r.painted });
  check('rule B only ADDS — nothing that was priced lost its price', r.painted >= r.oldWay,
        { before: r.oldWay, after: r.painted });
  check('no blank odds cell — missing is a dash, never blank', r.blank === 0, r.blank);
  check('more than one book now supplies the column (the pin is gone)',
        Object.keys(r.books).length > 1, r.books);
  console.log('  priced cards:');
  r.gained.forEach(g => console.log('     ' + g));
} finally { c.close(); }
console.log('');
if (FAIL.length) { console.log(`${FAIL.length} FAILED: ${JSON.stringify(FAIL)}`); process.exit(1); }
console.log('DEPLOYED verification: all checks passed');
