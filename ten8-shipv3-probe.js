// Verifies the founder's "remove line shopping, ship the rest" change in a real
// browser: opens the Market performance panel for a spread of players and asserts
// (1) the line-shopping block is gone everywhere, and (2) every OTHER v3 block
// still paints. Positive counts are asserted too — a panel that failed to render
// at all would also contain zero "Line shopping", which is the vacuous pass.
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9351;
const URL = process.argv[2] || 'http://127.0.0.1:8791/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
    '--disable-gpu', '--window-size=1440,2400', `--user-data-dir=/tmp/ten8-shipv3-${process.pid}`, URL], { stdio: 'ignore' });

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
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception || {}).description);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (m, p) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Runtime.enable', {});
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await evaluate('typeof playerProfiles === "object" && playerProfiles && Object.keys(playerProfiles).length > 0');
    if (!ready) await sleep(1000);
  }
  if (!ready) { console.log('FAIL: playerProfiles never loaded'); chrome.kill(); process.exit(1); }

  // Every player with an odds shard is a candidate; sample across the index so
  // the check is not just the top-ranked handful.
  const keys = JSON.parse(await evaluate(`JSON.stringify(Object.keys(await (await fetch('odds-performance-index.json')).json().then(j => j.players || j)))`) || '[]');
  const sample = keys.filter((_, i) => i % 8 === 0).slice(0, 20);
  console.log(`odds shards: ${keys.length}; probing ${sample.length}`);

  let fails = 0, panels = 0;
  for (const k of sample) {
    await evaluate(`(typeof showPlayerProfile === 'function' ? (showPlayerProfile('${k}'), 'ok') : 'no-fn')`);
    // Wait for the odds panel itself, not a fixed sleep.
    let html = '';
    for (let i = 0; i < 25; i++) {
      html = await evaluate(`(document.getElementById('playerProfileView')||{}).innerHTML || ''`) || '';
      if (/Vs market expectation/.test(html) && !/Loading/.test(html.slice(html.indexOf('Vs market expectation'), html.indexOf('Vs market expectation') + 400))) break;
      await sleep(300);
    }
    if (!/Vs market expectation/i.test(html)) { console.log(`${k}: no market panel (player may be under the gate) — skipped`); continue; }
    panels++;
    const name = await evaluate(`(playerProfiles['${k}']||{}).name`);
    const hit = (String(html).match(/.{60}(line shopping|at best price).{60}/gi) || [])[0];
    const bad = !!hit;
    if (bad) console.log('   HIT: ' + hit.replace(/\s+/g, ' '));
    const has = {
      tiles: /Flat-stake ROI/.test(html),
      surface: /Vs market expectation by surface/.test(html),
      underdog: /underdog/i.test(html),
      rolling: /Last \d+ matches|rolling count/i.test(html),
      splits: /Performance splits|>Round</i.test(html),
    };
    const missing = Object.entries(has).filter(([, v]) => !v).map(([kk]) => kk);
    if (bad || missing.length) fails++;
    console.log(`${String(k).padEnd(6)} ${String(name).padEnd(24)} lineShopping=${bad ? 'PRESENT ✗' : 'gone ✓'}  ${missing.length ? 'MISSING: ' + missing.join(',') : 'all v3 blocks ✓'}`);
  }

  ws.close(); chrome.kill();
  if (!panels) { console.log('\nFAIL: zero market panels rendered — nothing was actually checked.'); process.exit(1); }
  if (errors.length) console.log('\npage errors:\n' + errors.slice(0, 5).join('\n'));
  console.log(fails ? `\nFAIL: ${fails}/${panels} panels wrong.` : `\nPASS: ${panels} panels — line shopping gone, every other v3 block still paints.`);
  process.exit(fails || errors.length ? 1 : 0);
})();
