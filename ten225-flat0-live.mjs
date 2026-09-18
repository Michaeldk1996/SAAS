// TEN-225 flat-0% guard — DEPLOYED verification. "Merged is not shipped."
//
// Reads the live page. Three things have to hold together, and the third is the
// one that makes this a verification rather than a screenshot:
//   1. every single-sighting fixture (open_ts === now_ts in the published file)
//      is suppressed — no 0% claim, no place in the tile's population;
//   2. the evidenced-flat bet365 cards KEEP their 0%, so the guard is a scalpel
//      and not a blanket that hides the honest zeros too;
//   3. the CONTROL: the guard is neutered in the live page and the board
//      re-measured, so the run shows it changing an outcome. Without that, a
//      board that simply had no single-sighting fixture today would pass
//      identically to a guard that does nothing.
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const ORIGIN = 'https://michaeldk1996.github.io/SAAS';
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
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
     '--disable-gpu', '--user-data-dir=' + DATA + '/ten225-flat0-live-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { const { res, rej } = waiters.get(m.id); waiters.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return { send: (m, p) => send(m, p, sessionId), close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

const FAIL = [];
const check = (n, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok || d === undefined ? '' : '  ' + JSON.stringify(d).slice(0, 450)}`); if (!ok) FAIL.push(n); };

// Independent read of the published file: which fixtures are single-sighting?
const rawOcs = await (await fetch(`${ORIGIN}/odds-card-state.json?cb=${Date.now()}`)).json();
const singleSighting = [];
for (const [k, e] of Object.entries(rawOcs.byKey || {})) {
  const sides = Object.values(e.sides || {});
  if (sides.length !== 2) continue;
  const flat = sides.every(s => s.open != null && s.now != null && s.open === s.now);
  const sameTs = sides.every(s => s.openTs && s.nowTs && s.openTs === s.nowTs);
  if (flat && sameTs) singleSighting.push({ key: k, book: e.book, ts: sides[0].nowTs });
}

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=flat0' });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  // Wait on the GLOBALS, not on a painted card: cards appear while the inline
  // block is still evaluating, which races the very symbol under test.
  for (let i = 0; i < 200; i++) {
    if (await ev('typeof matches === "object" && matches && typeof moveNowScore === "function" && OCS.loaded')) break;
    await sleep(500);
  }
  const commit = await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json()).then(j=>j.commit)');
  console.log('TEN-225 flat-0% guard — DEPLOYED');
  console.log(`  url     ${PAGE}`);
  console.log(`  commit  ${commit}`);
  console.log(`  ocs     generatedAt ${rawOcs.generatedAt}`);
  check('the guard is in the SERVED bytes', await ev('typeof _measurablePair === "function" && typeof _obsMs === "function"'));

  const scan = await ev(`(function(){
    const day = matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m) === 'today');
    return { n: day.length, rows: day.map(m => {
      const p = _mcOpenNowPair(m), o = _ocsOf(m);
      return { name: m.p1 + ' v ' + m.p2, key: ocsKeyOf(m), score: moveNowScore(m),
               measurable: !!p, book: p ? p.book : (o ? o.book : null),
               o1: p ? p.o1 : null, n1: p ? p.n1 : null, o2: p ? p.o2 : null, n2: p ? p.n2 : null };
    })};
  })()`);
  const keys = new Set(scan.rows.map(r => r.key));
  const onBoard = singleSighting.filter(s => keys.has(s.key));
  console.log(`  today's fixtures ${scan.n}; single-sighting rows in the published file ${singleSighting.length}, of them on today's board ${onBoard.length}`);
  onBoard.forEach(s => {
    const r = scan.rows.find(x => x.key === s.key);
    console.log(`    ${s.key}  ${s.book}  ts ${String(s.ts).slice(0,19)}  -> ${r ? (r.measurable ? 'MEASURABLE' : 'suppressed') + ' score=' + r.score : '(not on board)'}`);
  });
  check('NON-VACUITY: today\'s board carries a single-sighting fixture to test', onBoard.length > 0);
  check('every single-sighting fixture is suppressed on the live page',
        onBoard.every(s => { const r = scan.rows.find(x => x.key === s.key); return r && !r.measurable; }));
  check('and none of them scores as a 0% move',
        onBoard.every(s => { const r = scan.rows.find(x => x.key === s.key); return r && r.score !== 0; }));

  const evidencedFlat = scan.rows.filter(r => r.measurable && r.o1 === r.n1 && r.o2 === r.n2);
  console.log(`  evidenced-flat kept (re-observed, genuinely 0%)  ${evidencedFlat.length}`);
  evidencedFlat.forEach(r => console.log(`    ${r.name}  ${r.book}  ${r.o1}/${r.o2}  score=${r.score}`));
  check('the guard is a scalpel: evidenced-flat 0% cards survive', evidencedFlat.length > 0);

  const control = await ev(`(function(){
    const real = _measurablePair; window.__r = real;
    _measurablePair = function(p){ return p; };
    const day = matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m) === 'today');
    const offZero = day.filter(m => moveNowScore(m) === 0).length;
    const offPairs = day.filter(m => !!_mcOpenNowPair(m)).length;
    _measurablePair = real;
    const onZero = day.filter(m => moveNowScore(m) === 0).length;
    const onPairs = day.filter(m => !!_mcOpenNowPair(m)).length;
    return { offZero, offPairs, onZero, onPairs, restored: _measurablePair === window.__r };
  })()`);
  console.log(`  CONTROL guard OFF: ${control.offZero} cards at exactly 0%, ${control.offPairs} measurable pairs`);
  console.log(`  CONTROL guard ON : ${control.onZero} cards at exactly 0%, ${control.onPairs} measurable pairs`);
  check('CONTROL: neutering the guard on the LIVE page changes the outcome',
        control.offZero !== control.onZero || control.offPairs !== control.onPairs, control);
  check('CONTROL: the guard only removes a 0% claim, never adds one', control.onZero <= control.offZero);
  check('CONTROL: the real guard was restored', control.restored === true);

  // The tile must not name a suppressed fixture.
  await ev(`(function(){ state.sort='drift'; renderMatches(); return true; })()`);
  await sleep(1500);
  const tile = await ev(`(function(){
    const el = [...document.querySelectorAll('.mc-story')].find(n => /Biggest market move/i.test(n.textContent));
    if (!el) return { found:false };
    const ctx = el.querySelector('.mc-story__ctx');
    return { found:true, od: el.querySelector('.mc-story__od')?.textContent.trim() || null,
             who: ctx?.querySelector('strong')?.textContent.trim() || null,
             faint: el.querySelector('.mc-story__faint')?.textContent.trim() || null };
  })()`);
  const top = scan.rows.slice().sort((a,b) => b.score - a.score)[0];
  console.log(`  tile: ${tile.od}  ${tile.who}   |  top scoring card: ${top.name} ${(top.score*100).toFixed(1)}%`);
  check('the tile does not name a single-sighting fixture',
        !onBoard.some(s => { const r = scan.rows.find(x => x.key === s.key);
          return r && tile.who && r.name.toLowerCase().includes(String(tile.who).toLowerCase()); }));
} finally { c.close(); }

console.log('');
if (FAIL.length) { console.log(`${FAIL.length} FAILED: ${JSON.stringify(FAIL)}`); process.exit(1); }
console.log('DEPLOYED flat-0% guard: all checks passed');
