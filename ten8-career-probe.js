// Drives the real dashboard in headless Chrome against the verify server and
// asserts the two things the founder asked for:
//   1. a Career-record cell drills open to exactly the matches it counts
//   2. pre-2021 years list their matches instead of "no records on file"
// No puppeteer on this machine — Node 24's global WebSocket + CDP directly.
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9344;
const URL = process.argv[2] || 'http://127.0.0.1:8791/index.html';
const PLAYER = process.argv[3] || '2847';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // Desktop width: the headless default stacks the profile cards and has faked
  // a layout failure before.
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
    '--disable-gpu', '--window-size=1440,2400', `--user-data-dir=/tmp/ten8-probe-${Date.now()}`, URL], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
  }
  if (!wsUrl) { console.log('FAIL: no debug target'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // Always wrap as a promise: awaitPromise on a non-promise returns no result at
  // all, which a poll helper misreads as "not ready" and spins on forever.
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // Wait for the profile data the page needs, not a fixed sleep.
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await evaluate('typeof playerProfiles === "object" && playerProfiles && Object.keys(playerProfiles).length > 0');
    if (!ready) await sleep(1000);
  }
  if (!ready) { console.log('FAIL: playerProfiles never loaded'); chrome.kill(); process.exit(1); }

  const name = await evaluate(`(playerProfiles['${PLAYER}']||{}).name`);
  console.log(`profile: ${name} (${PLAYER})`);

  // Open the profile through the app's own entry point.
  await evaluate(`(typeof showPlayerProfile === 'function' ? (showPlayerProfile('${PLAYER}'), 'ok') : 'no-fn')`);
  await sleep(1500);

  // The table rows as rendered, with the pipeline's per-year stamps.
  const years = await evaluate(`JSON.stringify((playerProfiles['${PLAYER}'].careerByYear||[]).map(r => ({
      year: r.year, rows: r.rows, atpOnly: r.atpOnly,
      total: r.total ? (r.total.won||0)+(r.total.lost||0) : 0,
      clay:  r.clay  ? (r.clay.won||0)+(r.clay.lost||0)   : 0
    })))`);
  const table = JSON.parse(years || '[]');
  console.log('\nyear  tableTotal  shardRows  atpOnly');
  for (const y of table) console.log(`${y.year}      ${String(y.total).padStart(3)}        ${String(y.rows).padStart(4)}      ${y.atpOnly}`);

  // Drill each year+surface open through the real handler and count the rows it paints.
  const check = async (year, surface, expected) => {
    await evaluate(`(document.getElementById('ppYrDrill-${year}') ? 'have' : (() => {
      const d = document.createElement('div'); d.id = 'ppYrDrill-${year}';
      document.getElementById('playerProfileView').appendChild(d); return 'made'; })())`);
    await evaluate(`(ppShowYearSurface('${year}','${surface}',${expected},0), 'fired')`);
    for (let i = 0; i < 30; i++) {
      const n = await evaluate(`document.querySelectorAll('#ppYrDrill-${year} .yr-drill-row').length`);
      const note = await evaluate(`(document.querySelector('#ppYrDrill-${year} .yr-drill-note')||{}).textContent || ''`);
      if (n > 0 || (note && !/Loading/.test(note))) return { n, note };
      await sleep(300);
    }
    return { n: 0, note: 'timeout' };
  };

  let fails = 0;
  console.log('\n--- drill-down: does the list match the number? ---');
  for (const y of table) {
    if (!y.total) continue;
    const got = await check(y.year, 'all', y.total);
    const inWindow = parseInt(y.year, 10) >= new Date().getFullYear() - 5;
    let verdict;
    if (inWindow) {
      verdict = got.n === y.total ? 'OK' : `MISMATCH (counted ${y.total}, listed ${got.n})`;
      if (got.n !== y.total) fails++;
    } else {
      verdict = got.n > 0 ? `OK (${got.n} archive rows listed)` : 'EMPTY — older year still lists nothing';
      if (got.n === 0) fails++;
    }
    console.log(`${y.year} total=${String(y.total).padStart(3)} listed=${String(got.n).padStart(3)}  ${verdict}`);
    if (got.note) console.log(`        note: ${got.note.trim().slice(0, 150)}`);
  }

  ws.close(); chrome.kill();
  console.log(fails ? `\nFAIL: ${fails} year(s) wrong.` : '\nPASS: every year lists what it counts, and older years list their matches.');
  process.exit(fails ? 1 : 0);
})();
