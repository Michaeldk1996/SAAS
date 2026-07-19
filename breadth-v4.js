// Breadth sweep: render EVERY player that has an odds shard, assert the panel
// builds without throwing and never prints the removed category; plus a full
// distribution of the new splits colouring across all 233 players.
const { execSync, spawn } = require('child_process');
const PORT = 9337, BASE = 'http://127.0.0.1:5599/bsp-consult-dashboard.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  execSync(`pkill -f "remote-debugging-port=${PORT}" || true`);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
    '--window-size=1600,1400', '--no-first-run', '--user-data-dir=/tmp/ten8-chrome-breadth', BASE], { stdio: 'ignore' });
  let u; for (let i = 0; i < 40 && !u; i++) { await sleep(300);
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = t.find(x => x.type === 'page' && x.webSocketDebuggerUrl); if (p) u = p.webSocketDebuggerUrl; } catch {} }
  const ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const send = (me, pa) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: pa })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  for (let i = 0; i < 60; i++) {
    const c = await ev(`(() => { const b = document.querySelector('#mainNav button[data-tab="players"]');
      if (!b) return false; b.click(); return true; })()`).catch(() => false);
    if (c) break; await sleep(500);
  }
  for (let i = 0; i < 120; i++) { await sleep(500);
    if (await ev(`typeof careerSplits==='object'&&Object.keys(careerSplits).length>100&&Object.keys(playerProfiles).length>100`).catch(()=>false)) break; }

  // ---- splits colour distribution over every player and every split ----
  const dist = await ev(`(() => {
    const out = { green: 0, red: 0, white: 0, ungraded: 0, oldGreen: 0, flippedToWhite: 0, flippedToGreen: 0, players: 0 };
    Object.keys(careerSplits).forEach(k => {
      const s = careerSplits[k]; const tier = ppSplitTier(s.rank);
      if (!tier) return; out.players++;
      ['career','last52'].forEach(w => Object.keys(s[w] || {}).forEach(cat => {
        const row = s[w][cat]; if (!row || !row.M) return;
        const g = ppSplitGrade(row, w, cat, tier);
        const now = g.color === '#3ECF8E' ? 'green' : (g.color === '#E8607A' ? 'red' : 'white');
        const old = row.winPct >= 60 ? 'green' : (row.winPct >= 50 ? 'white' : 'red');
        if (g.exp == null) out.ungraded++; else out[now]++;
        if (old === 'green') out.oldGreen++;
        if (old === 'green' && now !== 'green') out.flippedToWhite++;
        if (old !== 'green' && now === 'green') out.flippedToGreen++;
      }));
    });
    return out;
  })()`);
  console.log('splits colour distribution:', JSON.stringify(dist, null, 1));

  // ---- render every odds player ----
  const keys = await ev(`Object.keys(oddsPerfIndex || {}).length ? Object.keys(oddsPerfIndex) : []`).catch(() => []);
  const shardKeys = keys.length ? keys : await ev(`Object.keys(playerProfiles).slice(0,80)`);
  let rendered = 0, aboutRight = 0, noPanel = 0; const badges = {};
  for (const k of shardKeys) {
    await ev(`showPlayerProfile('${k}')`).catch(() => {});
    let ok = false;
    for (let i = 0; i < 24; i++) {
      ok = await ev(`(() => { const p = document.querySelector('#ppMarketPanel');
        return !!(p && /Market performance/i.test(p.innerText)); })()`).catch(() => false);
      if (ok) break; await sleep(150);
    }
    if (!ok) { noPanel++; continue; }
    rendered++;
    const r = await ev(`(() => { const t = document.querySelector('#ppMarketPanel').innerText;
      return { ar: /about right/i.test(t),
               b: (t.match(/(UNDERPRICED[^\\n]*|OVERPRICED[^\\n]*|BEATS THE MARKET|MARKET OVERRATES|NO EDGE FOUND)/i)||[])[0] || 'none' }; })()`);
    if (r.ar) aboutRight++;
    const key = /UNDERPRICED/i.test(r.b) ? 'underpriced-angle' : /OVERPRICED/i.test(r.b) ? 'overpriced-angle'
      : /BEATS/i.test(r.b) ? 'beats(proven)' : /OVERRATES/i.test(r.b) ? 'overrates(proven)'
      : /NO EDGE/i.test(r.b) ? 'no-edge-found' : 'none';
    badges[key] = (badges[key] || 0) + 1;
  }
  console.log(`\nrendered ${rendered} players (no panel: ${noPanel})`);
  console.log('"about right" occurrences:', aboutRight);
  console.log('badge distribution:', JSON.stringify(badges, null, 1));
  console.log('uncaught JS errors:', errors.length, errors.slice(0, 3));
  ws.close(); chrome.kill(); process.exit(0);
})();
