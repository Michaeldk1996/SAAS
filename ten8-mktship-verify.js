#!/usr/bin/env node
/**
 * TEN-8 Market Performance redesign (zip 27) — render + interaction probe.
 *
 * Serves THIS worktree (cwd pinned and asserted, so a stray server from another
 * directory cannot 200 its way into a fake pass), drives a real player profile in
 * headless Chrome over CDP, and asserts the redesigned panel actually renders and
 * recomputes. Every assertion carries its own denominator: an .every() over an empty
 * list is treated as a failure, not a pass.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = 8747;
const PLAYER = process.argv[2] || '1905'; // Djokovic — widest shard (1270 sides)

const MIME = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'bsp-consult-dashboard.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(PORT, r));
  // Prove the server is OURS, serving THIS worktree: a leftover server on this port
  // from another directory would answer 200 and silently verify the wrong code.
  const marker = 'ppMktWinLabel';
  const body = await new Promise((ok, bad) => http.get(`http://127.0.0.1:${PORT}/bsp-consult-dashboard.html`, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => ok(s)); }).on('error', bad));
  if (!body.includes(marker)) { console.log(`FAIL: server on ${PORT} is not serving this worktree (no ${marker})`); process.exit(1); }
  console.log(`server ok — serving ${ROOT} (${(body.length / 1024).toFixed(0)} KB dashboard, marker present)`);

  // A per-run debug port, asserted free before launch. Pinning the target by URL is NOT
  // enough on its own: a previous run of THIS harness serves the identical URL, so a
  // leftover browser answers /json/list and hands back its own page, carrying that run's
  // ppState. That reads as a bizarre state bug in the product (a panel that starts
  // expanded, a toggle that closes it) when nothing is wrong with the code at all.
  const CDP_PORT = 9400 + (process.pid % 150);
  const portBusy = await new Promise(ok => {
    const probe = http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, r => { r.resume(); ok(true); });
    probe.on('error', () => ok(false));
    probe.setTimeout(1200, () => { probe.destroy(); ok(false); });
  });
  if (portBusy) { console.log(`FAIL: CDP port ${CDP_PORT} already in use — kill stale chrome first (pkill -f remote-debugging-port=${CDP_PORT})`); process.exit(1); }

  const udd = fs.mkdtempSync('/tmp/ten8-chrome-');
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${udd}`,
    '--window-size=1600,2400', '--no-first-run', '--no-default-browser-check',
    `http://127.0.0.1:${PORT}/bsp-consult-dashboard.html`,
  ], { stdio: 'ignore' });
  const killChrome = () => { try { chrome.kill('SIGKILL'); } catch (_) {} };
  process.on('exit', killChrome);
  process.on('SIGINT', () => { killChrome(); process.exit(130); });

  // Pin the target by URL AND to this browser's own port.
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await new Promise((ok, bad) => http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => ok(JSON.parse(s))); }).on('error', bad));
      target = list.find(t => t.type === 'page' && t.url.includes(`127.0.0.1:${PORT}/bsp-consult-dashboard.html`));
    } catch (_) { /* chrome not up yet */ }
  }
  if (!target) { console.log('FAIL: no CDP target matching our URL'); process.exit(1); }

  // Node 24 ships a global WebSocket, so CDP needs no npm install.
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception || {}).description);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' '));
  };
  const send = (method, params) => new Promise(ok => { const id = ++msgId; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');

  // Promise.resolve(...) so an async expression is awaited rather than stringified as a
  // bare Promise -- JSON.stringify(Promise) is "{}", which silently reads as an empty
  // result instead of an error.
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `Promise.resolve((() => { try { return (${expr}); } catch (e) { return { __err: String(e) }; } })()).then(v => JSON.stringify(v === undefined ? null : v)).catch(e => JSON.stringify({ __err: String(e) }))`,
      awaitPromise: true, returnByValue: true,
    });
    const v = r.result && r.result.result && r.result.result.value;
    return v === undefined || v === null ? undefined : JSON.parse(v);
  };

  // Poll for readiness rather than sleeping a fixed amount: the profile is only
  // clickable once the data load resolves, and a fixed sleep races that.
  const waitFor = async (expr, label, ms = 45000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await evalJs(expr);
      if (v) return v;
      await sleep(300);
    }
    console.log(`FAIL: timed out waiting for ${label}`);
    process.exit(1);
  };

  await waitFor("!!(typeof playerProfiles !== 'undefined' && playerProfiles && Object.keys(playerProfiles).length)", 'playerProfiles loaded');
  const nProfiles = await evalJs('Object.keys(playerProfiles).length');
  console.log(`profiles loaded: ${nProfiles}`);

  // The profile view lives inside the Players .tabpage, which is display:none until its
  // nav button is clicked. Rendering into a hidden tab still yields correct computed
  // styles, so skipping this step passes every assertion while measuring a 0x0 panel --
  // and produces an empty screenshot. Activate the tab first, THEN open the profile
  // (the nav handler calls showPlayerList(), which would reset an already-open profile).
  await evalJs(`(() => { const b = document.querySelector('#mainNav button[data-tab="players"]'); if (b) b.click(); return !!b; })()`);
  await waitFor(`document.querySelector('.tabpage[data-page="players"]').classList.contains('active')`, 'players tab active');
  await evalJs(`(showPlayerProfile('${PLAYER}'), 1)`);
  await waitFor(`!!document.getElementById('ppMarketPanel')`, 'ppMarketPanel painted');

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };


  // ---------------------------------------------------------------------------
  // What this ship changed, and nothing else:
  //   1. the price-band "See more" panels are gone
  //   2. the market window no longer leaks across a player switch
  // ---------------------------------------------------------------------------

  const panelText = () => evalJs(`(document.getElementById('ppMarketPanel')||{}).innerText || ''`);
  // The odds shard loads async and the profile repaints when it lands. Waiting only for
  // #ppMarketPanel catches the "Loading market performance..." placeholder, which has no
  // See-more control and no window chips -- i.e. it passes every check vacuously.
  const waitPanel = (who) => waitFor(
    `(() => { const e = document.getElementById('ppMarketPanel'); return !!e && !/Loading market performance/.test(e.innerText) && e.innerText.length > 400; })()`,
    `loaded market panel for ${who}`);
  const mktState  = () => evalJs(`({ win: ppState.mktWindow, split: ppState.mktSplit, more: ('mktMore' in ppState) })`);
  // Read the headline tile, so we can prove the window actually re-frames the numbers
  // rather than just flipping a chip's colour.
  const headline  = () => evalJs(`(() => {
    const t = document.querySelector('#ppMarketPanel .pp-odds-tiles > div');
    return t ? t.children[1].textContent.trim() : null;
  })()`);
  // An active window chip is tinted rgba(123,164,255,0.12) -- NOT the #3E7BFA the split
  // tabs use. Presets are 40/25/15 only, so an off-preset window (the slider) correctly
  // lights no chip at all; asserting "some chip is lit" for any N would be wrong.
  const chipOn = () => evalJs(`(() => {
    const c = [...document.querySelectorAll('#ppMarketPanel span[onclick^="setPpMktWindow("]')]
      .find(s => /^rgba\\(123, 164, 255/.test(getComputedStyle(s).backgroundColor));
    return c ? c.textContent.trim() : null;
  })()`);
  const winLabelTxt = () => evalJs(`(document.getElementById('ppMktWinLabel')||{}).textContent || ''`);

  // ---- 1. See more is gone -------------------------------------------------
  await waitPanel('initial player');
  const t0 = await panelText();
  check('market panel painted with real content', t0.length > 400, `${t0.length} chars`);
  check('no "See more" control in market panel', !/See more|Show less/i.test(t0));
  check('no price-band reliability copy', !/Heavy favourite|Big underdog|Slight underdog/i.test(t0));
  check('togglePpMktMore removed from global scope',
    (await evalJs(`typeof togglePpMktMore`)) === 'undefined');
  check('ppState carries no mktMore field', (await mktState()).more === false);

  // Recent form's own "See more" must survive — it shares the wording, not the block.
  // Recent form's own expander says "See all N results" -- different wording, and it
  // must survive untouched. Assert it OUTSIDE the market panel so the market removal
  // cannot be masked by it (or vice versa).
  check('Recent form expander untouched',
    (await evalJs(`(() => {
      const v = document.getElementById('playerProfileView').cloneNode(true);
      const m = v.querySelector('#ppMarketPanel'); if (m) m.remove();
      return /See all \\d+ results|Show less/i.test(v.innerText);
    })()`)) === true);

  // ---- 2. window reset across player switch --------------------------------
  // Pick a second player with a DIFFERENT priced-match count, so a leaked window
  // would visibly re-frame him. A pair with equal counts could pass vacuously.
  const cohort = await evalJs(`(() => {
    const out = [];
    for (const [k, v] of Object.entries(oddsPerfIndex)) {
      const p = playerProfiles[k];
      if (p && Number.isFinite(v.matches) && v.matches >= 30) out.push({ k, n: v.matches, nm: p.name });
    }
    return out.sort((a, b) => b.n - a.n);
  })()`);
  check('cohort of priced players is non-empty', cohort.length >= 3, `${cohort.length} players`);

  const A = cohort[0];
  const B = cohort[cohort.length - 1];
  check('A and B have different priced-match counts', A.n !== B.n, `${A.nm}=${A.n} vs ${B.nm}=${B.n}`);

  await evalJs(`(showPlayerProfile('${A.k}'), 1)`);
  await waitPanel(A.nm);
  const careerHeadA = await headline();

  // Set a narrow window on A and prove it took effect.
  await evalJs(`(setPpMktWindow(8), 1)`);
  await sleep(250);
  const stAfterSet = await mktState();
  const last8Head = await headline();
  check('window set to 8 on player A', String(stAfterSet.win) === '8', `mktWindow=${stAfterSet.win}`);
  check('narrow window actually re-frames the numbers (not a vacuous pass)',
    last8Head !== careerHeadA, `career=${careerHeadA} last8=${last8Head}`);
  // 8 is off-preset: the slider owns it and no chip should light.
  check('off-preset window lights no chip, and the slider label carries it',
    (await chipOn()) === null && /8/.test(await winLabelTxt()), `chip=${await chipOn()} label="${await winLabelTxt()}"`);
  // A preset window must light its own chip.
  await evalJs(`(setPpMktWindow(25), 1)`);
  await sleep(250);
  check('preset window lights its chip', /Last 25/.test(await chipOn() || ''), `active chip=${await chipOn()}`);
  await evalJs(`(setPpMktWindow(8), 1)`);
  await sleep(250);

  // Now switch player. THIS is the bug: before the fix, B opened on A's "Last 8".
  await evalJs(`(showPlayerProfile('${B.k}'), 1)`);
  await waitPanel(B.nm);
  const stB = await mktState();
  check('market window reset to career on player switch', stB.win === 'career', `mktWindow=${stB.win}`);
  check('split tab reset to default on player switch', stB.split === 'level', `mktSplit=${stB.split}`);
  const bText = await panelText();
  check('player B panel describes his FULL priced history',
    bText.includes(String(B.n)), `expected ${B.n} priced matches in copy`);
  check('player B panel is not framed as a last-8 window',
    !/his last 8 priced matches/i.test(bText));

  // Round trip: back to A must also be career, and match A's original career headline.
  await evalJs(`(showPlayerProfile('${A.k}'), 1)`);
  await waitPanel(A.nm + ' (return)');
  check('returning to A opens on career, matching its first paint',
    (await headline()) === careerHeadA, `${await headline()} vs ${careerHeadA}`);

  // ---- 3. breadth: panel must render clean for many real players -----------
  const sample = cohort.filter((_, i) => i % Math.max(1, Math.floor(cohort.length / 25)) === 0).slice(0, 25);
  let painted = 0, empty = [];
  for (const p of sample) {
    await evalJs(`(showPlayerProfile('${p.k}'), 1)`);
    try { await waitPanel(p.nm); } catch (_) {}
    const txt = await panelText();
    if (txt.length > 400 && !/Loading market performance/.test(txt)) painted++;
    else empty.push(`${p.nm}(${p.n})`);
  }
  check('market panel renders for every sampled player', painted === sample.length && sample.length >= 10,
    `${painted}/${sample.length} painted${empty.length ? ' — empty: ' + empty.join(', ') : ''}`);

  check('no uncaught JS exceptions during the whole run', consoleErrors.length === 0,
    consoleErrors.slice(0, 4).join(' | '));

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map(r => r.name).join('; ')); process.exit(1); }
  console.log('ALL GREEN');
  process.exit(0);
})();
