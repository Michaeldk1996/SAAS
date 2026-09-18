// TEN-225 Part 3 — render probe for the Open/Now/Close wiring.
//
// Drives the real page in headless Chrome over CDP and READS the cells. A
// screenshot proves it painted; only a read proves the right price landed on
// the right player.
//
// Two populations, deliberately:
//   A. a completed fixture odds-card-state.json does NOT cover -> must render
//      an em dash under BOTH column headers (the founder's Part 3d blank).
//   B. a completed fixture it DOES cover -> must render the PUBLISHED prices,
//      with each price on its own player, and the book + Open time in the cell
//      title.
//
// B is what makes A meaningful. A passes trivially on a build where the file
// never loads at all, so the probe is wrong without it — the "failing control"
// rule (a probe once passed 0/0 on a known-broken build).
//
// Usage: node ten225-wire-probe.mjs <base-url>
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] || 'http://127.0.0.1:8765';
const PAGE = `${BASE}/bsp-consult-dashboard.html`;

const AUTH_STUB = `
(function(){
  const user = { uid:'probe', email:'probe@example.com', emailVerified:true,
                 displayName:'Probe' };
  const STUB = {
    ready: Promise.resolve(user), currentUser: () => user,
    whenAuthReady: () => Promise.resolve(user),
    requireVerified: () => Promise.resolve(user),
    requireAuth: () => Promise.resolve(user),
    onAuthChange: cb => { try { cb(user); } catch(e){} return () => {}; },
    isValidEmail: () => true, updateProfile: () => Promise.resolve(),
    NOTIF: { show(){}, hide(){} },
  };
  Object.defineProperty(window, 'BSP',
    { value: STUB, writable:false, configurable:false });
})();`;

async function cdp() {
  const { spawn } = await import('node:child_process');
  const CHROME = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(p => { try { return require('node:fs').existsSync(p); } catch { return false; } })
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--user-data-dir=' +
      (process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp') + '/ten225-chrome',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => {
    const m = /ws:\/\/[^\s]+/.exec(String(d));
    if (m && !wsUrl) wsUrl = m[0];
  });
  for (let i = 0; i < 100 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiters.has(msg.id)) {
      const { res, rej } = waiters.get(msg.id); waiters.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return {
    send: (m, p) => send(m, p, sessionId),
    close: () => { try { ws.close(); } catch {} proc.kill(); },
  };
}

const FAIL = [];
const check = (name, cond, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  ' + JSON.stringify(detail)}`);
  if (!cond) FAIL.push(name);
};

const c = await cdp();
try {
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE });

  const evalJs = async expr => {
    const r = await c.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };

  // Wait for the board, then step to the Results (completed) view.
  for (let i = 0; i < 120; i++) {
    const n = await evalJs('document.querySelectorAll(".mx-match").length || 0');
    if (n > 0) break;
    await sleep(500);
  }
  // setMatchesView is the page's own switch (the Results tab button calls it);
  // driving the real entry point rather than poking `state` is what keeps this
  // a test of the shipped path. `state.day='all'` after it, because the
  // committed matches.json spans several days and the landing day may hold no
  // finished fixture at all — an empty day would make every assertion below
  // vacuous, which is the failure mode this probe exists to avoid.
  await evalJs(`(function(){
    if (typeof setMatchesView === 'function') setMatchesView('completed');
    else state.view = 'completed';
    // Land on a day that actually HOLDS a finished fixture, read off the data
    // rather than assumed. The committed matches.json is a rolling ~3-day file
    // and the landing day often has none; a day with no completed match makes
    // every assertion below vacuously true, which is the exact failure this
    // probe exists to catch.
    const fin = matches.filter(m => isFinishedMatch(m));
    if (fin.length) state.day = matchDayBucket(fin[0]);
    renderMatches();
    return true;
  })()`);
  await sleep(1200);

  const ocsLoaded = await evalJs('typeof OCS !== "undefined" && OCS.loaded === true');
  check('odds-card-state.json fetch was attempted', ocsLoaded);
  const published = await evalJs('typeof OCS === "undefined" ? -2 : (OCS.byKey ? Object.keys(OCS.byKey).length : -1)');
  console.log(`  ..   published matches in the file: ${published}`);

  // Read every completed card's two odds cells straight from the DOM, across
  // EVERY day bucket that holds a finished fixture. One day is not the
  // population: the committed file's three completed matches sit on two
  // different days, and a single-day read silently examined two of them.
  const cards = await evalJs(`(function(){
    const days = [...new Set(matches.filter(m => isFinishedMatch(m)).map(m => matchDayBucket(m)))];
    const seen = new Map();
    days.forEach(d => {
      state.day = d; renderMatches();
      document.querySelectorAll('.mx-match.cmpl').forEach(card => {
        const id = card.getAttribute('data-id');
        if (seen.has(id)) return;
        seen.set(id, {
          id,
          names: [...card.querySelectorAll('.mc-name')].map(e => e.textContent.trim()),
          cells: [...card.querySelectorAll('.mc-journey')].map(j => ({
            open:  (j.querySelector('.mc-journey__open')  || {}).textContent || '',
            close: (j.querySelector('.mc-journey__close') || {}).textContent || '',
            title: j.getAttribute('title') || '',
            html:  j.innerHTML.length,
          })),
        });
      });
    });
    if (days.length) { state.day = days[0]; renderMatches(); }
    return [...seen.values()];
  })()`);
  console.log(`  ..   completed cards read across every finished day: ${cards.length}`);
  if (!cards.length) {
    console.log('  ..   diagnostics:', JSON.stringify(await evalJs(`(function(){
      return { view: state.view, day: state.day, sort: state.sort,
               matches: matches.length,
               finished: matches.filter(m => isFinishedMatch(m)).length,
               anyCard: document.querySelectorAll('.mx-match').length,
               days: [...new Set(matches.map(m => matchDayBucket(m)))] };
    })()`)));
  }
  check('the Results view actually rendered completed cards', cards.length > 0, cards.length);
  // Print the cells. A pass/fail line says the rule held; the cells are what
  // let a reader see WHICH state each card was in — in particular that a
  // dash-both card was actually on screen and not merely permitted.
  cards.forEach(c0 => c0.cells.forEach((x, i) =>
    console.log(`  ..   ${c0.id} ${String(c0.names[i] || '?').padEnd(22)} `
      + `open=${JSON.stringify(x.open)} close=${JSON.stringify(x.close)} title=${JSON.stringify(x.title)}`)));
  // `cells.length === 2` is load-bearing, not decoration. `[].every(...)` is
  // TRUE, so without it this assertion passes on the pre-change build — where
  // the both-absent card rendered ZERO cells, which is the blank it is supposed
  // to catch. Measured: origin/main gives past-12163897 n=0 cells; this branch
  // gives it two em dashes.
  const dashBoth = cards.filter(c0 => c0.cells.length === 2
    && c0.cells.every(x => x.open === '—' && x.close === '—'));
  check('at least one card exercised the both-absent path (the Part 3d blank)',
        dashBoth.length > 0,
        'no uncovered completed fixture on this day — the dash rule was not exercised');

  // Founder Part 3d / item 1b: dashes, never blanks.
  const blank = cards.flatMap(c0 => c0.cells.filter(x => !x.open.trim() || !x.close.trim())
    .map(x => ({ id: c0.id, x })));
  check('every completed card shows a value or an em dash under BOTH headers',
        blank.length === 0, blank.slice(0, 5));
  const twoCells = cards.filter(c0 => c0.cells.length !== 2);
  check('every completed card has exactly two odds cells (one per player)',
        twoCells.length === 0, twoCells.slice(0, 3).map(c0 => ({ id: c0.id, n: c0.cells.length })));

  // THE CONTROL. Feed the page a published fixture built from a card that is on
  // screen, re-render, and assert the price moved to the right player. Without
  // this the check above passes on a build where the file never loads.
  const control = await evalJs(`(function(){
    const card = document.querySelector('.mx-match.cmpl');
    if (!card) return { ok:false, why:'no completed card' };
    const m = matches.find(x => String(x.id) === card.getAttribute('data-id'));
    if (!m) return { ok:false, why:'card id not in matches' };
    const k = ocsKeyOf(m);
    if (!k) return { ok:false, why:'match is unkeyable: ' + m.p1 + ' / ' + m.p2 };
    const k1 = ocsNameKey(m.p1), k2 = ocsNameKey(m.p2);
    OCS.byKey = Object.assign({}, OCS.byKey || {});
    OCS.byKey[k] = { book:'probe-book', source:'oddspapi', tsKind:'book-tick',
      startTsSource:'oddspapi', sides: {
        [k1]: { open:1.11, openTs:'2026-09-17T09:00:00Z', now:null, nowTs:null,
                close:1.22, closeTs:'2026-09-17T12:00:00Z' },
        [k2]: { open:7.77, openTs:'2026-09-17T09:00:00Z', now:null, nowTs:null,
                close:8.88, closeTs:'2026-09-17T12:00:00Z' } } };
    OCS.gen++;
    renderMatches();
    const c2 = document.querySelector('.mx-match.cmpl[data-id="' + m.id + '"]');
    const cells = [...c2.querySelectorAll('.mc-journey')].map(j => ({
      open:(j.querySelector('.mc-journey__open')||{}).textContent,
      close:(j.querySelector('.mc-journey__close')||{}).textContent,
      title:j.getAttribute('title')||'' }));
    return { ok:true, id:m.id, p1:m.p1, p2:m.p2, k1, k2, cells };
  })()`);
  if (!control.ok) {
    check('CONTROL: a published fixture could be injected', false, control);
  } else {
    check('CONTROL: player 1 shows the published open 1.11',
          control.cells[0].open === '1.11', control.cells);
    check('CONTROL: player 2 shows the published open 7.77',
          control.cells[1].open === '7.77', control.cells);
    check('CONTROL: player 1 shows the published close 1.22',
          control.cells[0].close === '1.22', control.cells);
    check('CONTROL: player 2 shows the published close 8.88',
          control.cells[1].close === '8.88', control.cells);
    check('CONTROL: the book name reaches the cell title',
          control.cells[0].title.includes('probe-book'), control.cells[0].title);
    check('CONTROL: the Open timestamp reaches the cell title',
          /\d/.test(control.cells[0].title.replace('probe-book', '')),
          control.cells[0].title);
  }

  // THE ORIENTATION CONTROL. Publish the two sides under the SWAPPED surname
  // keys and assert the prices swap with them. A renderer that read the
  // published object positionally would print the same two numbers in the same
  // two cells here, and the check above would not notice.
  if (control.ok) {
    const swapped = await evalJs(`(function(){
      const m = matches.find(x => String(x.id) === ${JSON.stringify(String(control.id))});
      const k = ocsKeyOf(m), k1 = ocsNameKey(m.p1), k2 = ocsNameKey(m.p2);
      OCS.byKey[k].sides = {
        [k1]: { open:7.77, openTs:'2026-09-17T09:00:00Z', now:null, nowTs:null,
                close:8.88, closeTs:'2026-09-17T12:00:00Z' },
        [k2]: { open:1.11, openTs:'2026-09-17T09:00:00Z', now:null, nowTs:null,
                close:1.22, closeTs:'2026-09-17T12:00:00Z' } };
      OCS.gen++; renderMatches();
      const c2 = document.querySelector('.mx-match.cmpl[data-id="' + m.id + '"]');
      return [...c2.querySelectorAll('.mc-journey')].map(j =>
        (j.querySelector('.mc-journey__open')||{}).textContent);
    })()`);
    check('CONTROL: swapping the published surname keys swaps the prices',
          swapped[0] === '7.77' && swapped[1] === '1.11', swapped);
  }

  // 3a — the Upcoming Open slot: the match-detail panel must APPEAR and dash,
  // not vanish, on a fixture with no opening price on file.
  const modal = await evalJs(`(function(){
    const up = matches.find(m => !m.finalScore);
    if (!up) return { ok:false, why:'no upcoming match in matches.json' };
    if (typeof openAnalysisModal !== 'function') return { ok:false, why:'no openAnalysisModal' };
    openAnalysisModal(up.id);
    return { ok:true, id: up.id, p1: up.p1, p2: up.p2,
             hasOpenPin: !!(up.openingOdds && up.openingOdds.p1 != null) };
  })()`);
  if (!modal.ok) {
    check('3a: an upcoming match could be opened', false, modal);
  } else {
    await sleep(900);
    const panel = await evalJs(`(function(){
      const tab = [...document.querySelectorAll('[data-atab]')]
        .find(e => /odds/i.test(e.getAttribute('data-atab')||''));
      if (tab) tab.click();
      return true;
    })()`);
    await sleep(700);
    const rows = await evalJs(`(function(){
      return [...document.querySelectorAll('.aodds-brow')].map(r => ({
        label: (r.querySelector('.aob-name b')||{}).textContent || '',
        meta:  (r.querySelector('.aob-name span')||{}).textContent || '',
        vals:  [...r.querySelectorAll('.aodds-price')].map(e => e.textContent) }));
    })()`);
    const opening = rows.find(r => /opening/i.test(r.label));
    check('3a: the Opening row is present on an upcoming match detail',
          !!opening, rows);
    if (opening) {
      check('3a: it shows a price or an em dash on both sides, never blank',
            opening.vals.length === 2 && opening.vals.every(v => v.trim().length > 0),
            opening);
    }
    check('3a: a Closing row is NOT dashed onto an unplayed match',
          !rows.some(r => /closing/i.test(r.label)), rows);
  }
} finally {
  c.close();
}

console.log('');
if (FAIL.length) { console.log(`FAILED ${FAIL.length}: ${FAIL.join(', ')}`); process.exit(1); }
console.log('all render assertions pass');
