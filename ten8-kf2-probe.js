// Verifies Key Factors fix 2 — surface record labels carry season context AND the
// number underneath is actually that season's.
//
// The whole point of this fix is that the label used to imply a season the figure did
// not cover. So a probe that only checks the label says nothing. For every match on the
// board this re-derives the expected record straight from the player's form shard and
// demands the DOM match it cell-for-cell. A wrong-but-plausible number fails here.
//
// Vacuous-pass guards: asserts a non-zero number of matches probed, a non-zero number
// of surface cells read, and that at least one cell is in the seasonal branch (a build
// where every player fell through to the fallback would otherwise print all-green).
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A crashed earlier run leaves Chrome alive holding the OLD build. A second run on the
// same port cannot bind, so /json/list silently hands back the zombie's page and the
// probe grades code that is no longer on disk — which is how a negative control passes.
// Unique port per run, and kill anything of ours still listening before we start.
const PORT = 9400 + (process.pid % 300);
// NB: do not name this `URL` — it shadows the global URL constructor, and the resulting
// TypeError gets swallowed by the target-discovery try/catch, which then reports the
// perfectly healthy browser as "no debug target".
const TARGET_URL = process.argv[2] || 'http://127.0.0.1:8794/index.html';
const TARGET_PORT = TARGET_URL.replace(/^https?:\/\/[^:/]+:?/, '').split('/')[0] || '80';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { require('child_process').execSync(`pkill -f "ten8-kf2-probe-chrome" || true`, { stdio: 'ignore' }); } catch (e) {}
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
    '--disable-gpu', '--window-size=1600,2400', `--user-data-dir=/tmp/ten8-kf2-probe-chrome-${process.pid}`, TARGET_URL], { stdio: 'ignore' });
  const bail = (msg) => { console.log(msg); try { chrome.kill(); } catch (e) {} process.exit(1); };

  // Pin the target by URL — /json/list will happily hand back a page from an older
  // Chrome that is still alive on another port's profile.
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl && t.url.includes(TARGET_PORT));
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
  }
  if (!wsUrl) { console.log('FAIL: no debug target pinned to the verify server'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (m, p) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Runtime.enable', {});
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // Prove the attached page is running the build currently on disk. Comparing the live
  // function source against the file is the only check that actually catches a stale
  // browser — a URL match does not, because the zombie's URL is identical.
  let liveSrc = null;
  for (let i = 0; i < 60 && !liveSrc; i++) {
    const r = await evaluate(`(typeof akFormBlock === 'function' ? akFormBlock.toString() : '')`);
    if (typeof r === 'string' && r.length) liveSrc = r; else await sleep(500);
  }
  if (!liveSrc) bail('FAIL: akFormBlock never appeared in the attached page');
  const diskSrc = require('fs').readFileSync(__dirname + '/bsp-consult-dashboard.html', 'utf8');
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const marker = norm(liveSrc).slice(0, 400);
  if (!norm(diskSrc).includes(marker)) {
    bail('FAIL: attached page is running a DIFFERENT build than the file on disk (stale Chrome)');
  }
  console.log('build check: attached page matches the worktree file');

  // `matches` is a `let` binding, so it is NOT on window — read it by bare name.
  // JSON.stringify(null) is the truthy string "null", so a naive falsy check exits this
  // loop on the very first poll and reports an empty board as a load failure.
  let rows = null;
  for (let i = 0; i < 60 && !rows; i++) {
    const board = await evaluate(`JSON.stringify((typeof matches !== 'undefined' && Array.isArray(matches)) ? matches.map(x => ({id:x.id, p1:x.p1, p2:x.p2, p1Key:x.p1Key, p2Key:x.p2Key, surface:x.surface, date:x.date})) : null)`);
    if (typeof board === 'string' && board !== 'null') {
      const parsed = JSON.parse(board);
      if (Array.isArray(parsed) && parsed.length) rows = parsed;
    }
    if (!rows) await sleep(1000);
  }
  if (!rows) { console.log('FAIL: board matches never loaded'); chrome.kill(); process.exit(1); }
  console.log(`board matches: ${rows.length}`);
  if (!rows.length) { console.log('FAIL: zero matches on the board — vacuous'); chrome.kill(); process.exit(1); }

  let cells = 0, seasonal = 0, fallback = 0, bare = 0, mism = 0, opened = 0;
  const failures = [];

  for (const m of rows) {
    await evaluate(`(typeof openAnalysisModal === 'function' ? (openAnalysisModal(${JSON.stringify(m.id)}), 'ok') : 'no-fn')`);
    // Wait on the condition, not a fixed sleep: the form shards arrive async and the
    // block repaints when they land. A fixed sleep reads the "Loading…" state and lies.
    let painted = false;
    for (let i = 0; i < 40 && !painted; i++) {
      painted = await evaluate(`!!document.querySelector('#aSectionKey .akf-stat')`);
      if (!painted) await sleep(250);
    }
    if (!painted) { failures.push(`${m.p1} v ${m.p2}: form block never painted`); continue; }
    opened++;

    const cellsJson = await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('#aSectionKey .akf-col')).map(c => {
      const stats = Array.from(c.querySelectorAll('.akf-stat'));
      const surf = stats[1];
      return { name: (c.querySelector('.akf-nm')||{}).textContent, label: surf ? surf.querySelector('span').textContent : null, value: surf ? surf.querySelector('b').textContent : null };
    }))`);
    const got = JSON.parse(cellsJson || '[]');

    // Re-derive expected from the shard, independently of the page's own logic.
    const shardJson = await evaluate(`JSON.stringify(await Promise.all([${JSON.stringify(m.p1Key)}, ${JSON.stringify(m.p2Key)}].map(k =>
      fetch('form/' + k + '.json').then(r => r.ok ? r.json() : null).then(d => (d && d.matches) || null).catch(() => null))))`);
    const shards = JSON.parse(shardJson || '[]');
    const season = /^\d{4}/.test(String(m.date || '')) ? String(m.date).slice(0, 4) : String(new Date().getUTCFullYear());
    const surf = String(m.surface || '').toLowerCase();
    const surfName = surf ? surf[0].toUpperCase() + surf.slice(1) : 'Surface';

    got.forEach((cell, i) => {
      const rowsFor = shards[i];
      if (!rowsFor || !cell.label) return;
      cells++;
      const all = rowsFor.filter(r => String(r.surface || '').toLowerCase() === surf);
      const seas = all.filter(r => String(r.date || '').slice(0, 4) === season);
      let expLabel, expVal;
      if (all.length === 0) { expLabel = surfName; expVal = '—'; bare++; }
      else if (seas.length) { expLabel = `${surfName} ${season}`; expVal = `${seas.filter(r => r.won).length}–${seas.length - seas.filter(r => r.won).length}`; seasonal++; }
      else { expLabel = `${surfName} · last ${all.length}`; expVal = `${all.filter(r => r.won).length}–${all.length - all.filter(r => r.won).length}`; fallback++; }
      if (cell.label !== expLabel || cell.value !== expVal) {
        mism++;
        failures.push(`${m.p1} v ${m.p2} [${cell.name}]: label "${cell.label}" val "${cell.value}" — expected "${expLabel}" / "${expVal}"`);
      }
    });
    await evaluate(`(document.querySelector('.modal-analysis .amodal-close') || {click(){}}).click()`);
  }

  console.log(`matches opened with a painted form block: ${opened}/${rows.length}`);
  console.log(`surface cells checked: ${cells}  (seasonal ${seasonal} · fallback ${fallback} · no-rows ${bare})`);
  console.log(`cell mismatches: ${mism}`);
  console.log(`page exceptions: ${errors.length}${errors.length ? ' -> ' + errors.slice(0, 3).join(' | ') : ''}`);
  failures.slice(0, 12).forEach(f => console.log('  ! ' + f));

  // Vacuous-pass guards.
  const vacuous = [];
  if (opened === 0) vacuous.push('no match opened');
  if (cells === 0) vacuous.push('no surface cell read');
  if (seasonal === 0) vacuous.push('no cell took the seasonal branch — the fix is not exercised');
  if (vacuous.length) { console.log('FAIL (vacuous): ' + vacuous.join('; ')); chrome.kill(); process.exit(1); }

  const ok = mism === 0 && errors.length === 0 && opened === rows.length;
  console.log(ok ? 'PASS' : 'FAIL');
  chrome.kill();
  process.exit(ok ? 0 : 1);
})();
