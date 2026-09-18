// TEN-225 flat-0% guard — LOCAL pre-push check, working tree over http.
//
// The point of running this before the push is the CONTROL: the same board is
// rendered twice, once with the guard neutered, so the run shows the guard
// changing an outcome. A probe that only reports the after-state cannot tell a
// working guard from a board that never had the defect on it.
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const DATA = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';
const PORT = 8731;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)],
  { cwd: process.env.WT_DIR, stdio: ['ignore', 'ignore', 'ignore'] });
await sleep(1200);

const AUTH_STUB = `
(function(){
  const user = { uid:'probe', email:'p@e.com', emailVerified:true, displayName:'P' };
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
     '--disable-gpu', '--user-data-dir=' + DATA + '/ten225-flat0-chrome', 'about:blank'],
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
const check = (n, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok || d === undefined ? '' : '  ' + JSON.stringify(d).slice(0, 400)}`); if (!ok) FAIL.push(n); };

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/bsp-consult-dashboard.html` });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  // Wait on the GLOBALS, not on a painted card. `.mx-match` appears while the
  // big inline block is still evaluating, so polling it raced the very symbol
  // under test and reported an absent guard on a page that has one.
  for (let i = 0; i < 200; i++) {
    if (await ev('typeof matches === "object" && matches && typeof _measurablePair === "function" && OCS.loaded')) break;
    await sleep(500);
  }
  console.log('TEN-225 flat-0% guard — LOCAL (working tree)');
  check('the guard is present in the page', await ev('typeof _measurablePair === "function"'));

  const scan = await ev(`(function(){
    const day = matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m) === 'today');
    const rows = day.map(m => {
      const p = _mcOpenNowPair(m);
      const o = _ocsOf(m);
      return { name: m.p1 + ' v ' + m.p2, score: moveNowScore(m),
               pair: p ? { o1: p.o1, n1: p.n1, o2: p.o2, n2: p.n2, book: p.book,
                           openTs: p.openTs, nowTs: p.nowTs } : null,
               ocsOpenTs: o ? (o.p1.openTs || o.p2.openTs) : null,
               ocsNowTs:  o ? (o.p1.nowTs  || o.p2.nowTs ) : null,
               ocsBook: o ? o.book : null,
               flatSameTs: !!(o && o.p1.open === o.p1.now && o.p2.open === o.p2.now
                              && (o.p1.openTs||o.p2.openTs) === (o.p1.nowTs||o.p2.nowTs)) };
    });
    return { n: day.length, rows };
  })()`);

  const oneSighting = scan.rows.filter(r => r.flatSameTs);
  console.log(`  today's fixtures ${scan.n}; single-sighting flat (open_ts === now_ts) ${oneSighting.length}`);
  oneSighting.forEach(r => console.log(`    ${r.name}  ${r.ocsBook}  ts ${String(r.ocsNowTs).slice(0,19)}  score=${r.score}  pair=${r.pair ? 'MEASURABLE' : 'suppressed'}`));
  check('NON-VACUITY: the board actually carries a single-sighting fixture to test', oneSighting.length > 0);
  check('every single-sighting fixture is suppressed (no 0% claim)',
        oneSighting.every(r => r.pair === null), oneSighting.filter(r => r.pair).slice(0, 3));
  check('and each scores as no-move-computable, not as a 0% move',
        oneSighting.every(r => r.score === -1 || r.score === -2),
        oneSighting.map(r => ({ n: r.name, s: r.score })).slice(0, 3));

  // The evidenced-flat bet365 cards must SURVIVE — the guard must not eat them.
  const evidencedFlat = scan.rows.filter(r => r.pair && r.pair.o1 === r.pair.n1 && r.pair.o2 === r.pair.n2);
  console.log(`  evidenced-flat kept (re-observed, genuinely 0%)  ${evidencedFlat.length}`);
  evidencedFlat.forEach(r => console.log(`    ${r.name}  ${r.pair.book}  ${r.pair.o1}/${r.pair.o2} score=${r.score}`));
  check('at least one evidenced-flat bet365 card KEEPS its 0% (guard is not a blanket)',
        evidencedFlat.length > 0);

  // CONTROL — neuter the guard and re-measure. The numbers must MOVE.
  const control = await ev(`(function(){
    const real = _measurablePair;
    window.__restore = real;
    _measurablePair = function(p){ return p; };          // guard off
    const day = matches.filter(m => !isFinishedMatch(m) && matchDayBucket(m) === 'today');
    const zeroPct = day.filter(m => { const s = moveNowScore(m); return s === 0; }).length;
    const measurable = day.filter(m => !!_mcOpenNowPair(m)).length;
    _measurablePair = real;                               // guard back on
    const zeroPctAfter = day.filter(m => { const s = moveNowScore(m); return s === 0; }).length;
    const measurableAfter = day.filter(m => !!_mcOpenNowPair(m)).length;
    return { zeroPct, measurable, zeroPctAfter, measurableAfter,
             restored: _measurablePair === window.__restore };
  })()`);
  console.log(`  CONTROL guard OFF: ${control.zeroPct} cards score exactly 0%, ${control.measurable} measurable pairs`);
  console.log(`  CONTROL guard ON : ${control.zeroPctAfter} cards score exactly 0%, ${control.measurableAfter} measurable pairs`);
  check('CONTROL: turning the guard off changes the 0% count (it is doing work)',
        control.zeroPct !== control.zeroPctAfter, control);
  check('CONTROL: the guard only ever REMOVES a 0% claim, never adds one',
        control.zeroPctAfter < control.zeroPct);
  check('CONTROL: the real guard was restored', control.restored === true);
} finally { c.close(); srv.kill(); }

console.log('');
if (FAIL.length) { console.log(`${FAIL.length} FAILED: ${JSON.stringify(FAIL)}`); process.exit(1); }
console.log('LOCAL flat-0% guard: all checks passed');
