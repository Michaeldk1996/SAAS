// CDP probe for the ranking-relative splits colour + reworked market panel.
// No installs: Node's global WebSocket + system Chrome.
const { execSync, spawn } = require('child_process');

const PORT = 9333, BASE = 'http://127.0.0.1:5599/bsp-consult-dashboard.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  execSync(`pkill -f "remote-debugging-port=${PORT}" || true`);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--window-size=1600,1200',            // narrow default width stacks cards and fakes failures
    '--no-first-run', '--user-data-dir=/tmp/ten8-chrome-v4',
    '--disable-application-cache', '--disk-cache-size=1', BASE,
  ], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(300);
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = t.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch {}
  }
  if (!wsUrl) { console.log('FATAL: no CDP target'); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  });
  const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  // player-profiles.json is lazy-loaded when the Players tab opens, so the tab has
  // to be clicked BEFORE waiting for data — and clicking it is required anyway or
  // the .tabpage stays display:none and every measurement reads 0.
  for (let i = 0; i < 40; i++) {
    const clicked = await evalJs(`(() => { const b = document.querySelector('#mainNav button[data-tab="players"]');
      if (!b) return false; b.click(); return true; })()`).catch(() => false);
    if (clicked) break;
    await sleep(500);
  }
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    await sleep(500);
    // Bare identifiers, not window.*: these are top-level `let` bindings, which
    // live in script scope and never become window properties.
    ready = await evalJs(`!!(typeof careerSplits === 'object' && Object.keys(careerSplits).length > 100
      && typeof playerProfiles === 'object' && Object.keys(playerProfiles).length > 100)`).catch(() => false);
  }
  console.log(ready ? '✓ data loaded' : '✗ data never loaded');
  if (!ready) process.exit(1);

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
  // Poll a condition instead of sleeping. Every async step here (shard fetch,
  // ppRepaint) lands on its own schedule; fixed sleeps read half-built DOM.
  const waitFor = async (expr, label, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      if (await evalJs(expr).catch(() => false)) return true;
      await sleep(250);
    }
    console.log(`  (timed out waiting for: ${label})`);
    return false;
  };

  // ---------- 1. Baselines are real and tier-ordered ----------
  const base = await evalJs(`(() => {
    const b = ppSplitBaselines();
    const c = b.career['vs. Top 10'];
    return { t10: c.t10 && c.t10.exp, t50: c.t50 && c.t50.exp,
             hardT10: b.career.Hard.t10.exp, hardT100: b.career.Hard.t100.exp,
             cats: Object.keys(b.career).length };
  })()`);
  check('baselines computed client-side', base.cats >= 10, `${base.cats} categories`);
  check('vs-Top-10 baseline is tier-ordered', base.t10 > base.t50, `Top10 ${base.t10}% vs rank26-50 ${base.t50}%`);
  check('Hard baseline is tier-ordered', base.hardT10 > base.hardT100, `Top10 ${base.hardT10}% vs rank51-100 ${base.hardT100}%`);

  // ---------- 2. Grading flips the two cases the founder described ----------
  const grades = await evalJs(`(() => {
    const g = (key, cat) => {
      const s = careerSplits[String(key)];
      const tier = ppSplitTier(s.rank);
      const row = s.career[cat];
      const r = ppSplitGrade(row, 'career', cat, tier);
      const nm = r.color === '#3ECF8E' ? 'green' : (r.color === '#E8607A' ? 'red' : 'white');
      const old = row.winPct >= 60 ? 'green' : (row.winPct >= 50 ? 'white' : 'red');
      return { act: row.winPct, exp: r.exp, gap: r.gap, need: r.need, M: row.M, now: nm, old };
    };
    return { zvHard: g(1980,'Hard'), runeTop10: g(437,'vs. Top 10'), sinHard: g(2072,'Hard'), runeHard: g(437,'Hard') };
  })()`);
  const z = grades.zvHard, ru = grades.runeTop10;
  check('Zverev 69.2% on hard: green -> white (par for Top 10)',
    z.old === 'green' && z.now === 'white', `act ${z.act}% vs Top-10 median ${z.exp}%, gap +${z.gap.toFixed(1)}`);
  check('Rune 45.5% vs Top 10 at rank 81: red -> green',
    ru.old === 'red' && ru.now === 'green', `act ${ru.act}% vs rank51-100 median ${ru.exp}%, gap +${ru.gap.toFixed(1)}`);
  check('Sinner still green on hard', grades.sinHard.now === 'green', `act ${grades.sinHard.act}% vs ${grades.sinHard.exp}%`);

  // ---------- 3. Small samples never colour ----------
  const noise = await evalJs(`(() => {
    let colouredSmall = 0, total = 0;
    Object.keys(careerSplits).forEach(k => {
      const s = careerSplits[k], tier = ppSplitTier(s.rank);
      Object.keys(s.career || {}).forEach(cat => {
        const row = s.career[cat];
        if (!row || !row.M || row.M >= 10) return;
        total++;
        const g = ppSplitGrade(row, 'career', cat, tier);
        if (g.color !== '#eef2f8') colouredSmall++;
      });
    });
    return { colouredSmall, total };
  })()`);
  check('no row under 10 matches is ever coloured', noise.colouredSmall === 0, `${noise.total} sub-10-match rows, ${noise.colouredSmall} coloured`);

  // ---------- 4. Render the profile (must switch tab first or all sizes are 0) ----------
  await evalJs(`document.querySelector('#mainNav button[data-tab="players"]').click()`);
  await sleep(400);
  await evalJs(`showPlayerProfile('437')`);   // Rune: has odds shard + both roles
  // The odds shard is fetched async and the panel only renders once it lands, so
  // wait for real panel content. Acting at a fixed 900ms toggled "See more" while
  // perf was still absent, rendering an empty section — and the toggle label still
  // said "Show less", so a label-only assertion passed over empty content.
  await waitFor(`(() => { const p = document.querySelector('#ppMarketPanel');
    return !!(p && /Market performance/.test(p.innerText) && p.getBoundingClientRect().height > 100); })()`,
    'market panel populated');
  // expand both splits tables
  // career splits default to OPEN (ppState.splitsOpen.career = true) — toggling here would close them.

  const dom = await evalJs(`(() => {
    const pane = document.querySelector('.tabpage[data-page="players"]') || document.body;
    const txt = pane.innerText;
    const panel = document.querySelector('#ppMarketPanel');
    return {
      visible: !!(panel && panel.getBoundingClientRect().height > 0),
      panelH: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
      hasAboutRight: /priced about right|prices him about right|PRICED ABOUT RIGHT/i.test(txt),
      seeMoreExact: [...document.querySelectorAll('span[onclick*="togglePpMktMore"]')].map(e => e.textContent.trim()),
      hasRoleBlock: /Favourite vs underdog reliability/i.test(txt),
      hasMisprice: /Most underpriced:/i.test(txt) && /Most overpriced:/i.test(txt),
      hasImplied: /Market implied/i.test(txt),
      badge: (txt.match(/(↑ UNDERPRICED[^\\n]*|↓ OVERPRICED[^\\n]*|↑ BEATS THE MARKET|↓ MARKET OVERRATES|NO EDGE FOUND)/) || [])[0] || null,
      splitRows: document.querySelectorAll('.pp-split-row').length,
      winCellTitles: [...document.querySelectorAll('.pp-split-row span[title]')].slice(0,2).map(e => e.getAttribute('title')),
    };
  })()`);

  check('market panel renders with real height', dom.visible && dom.panelH > 100, `${dom.panelH}px`);
  check('"priced about right" is gone from the DOM', !dom.hasAboutRight);
  check('button reads exactly "See more"', dom.seeMoreExact.length === 1 && dom.seeMoreExact[0] === 'See more', JSON.stringify(dom.seeMoreExact));
  check('favourite-vs-underdog block present', dom.hasRoleBlock);
  check('block shows implied probability per role', dom.hasImplied);
  check('surface mispricing names both directions', dom.hasMisprice);
  check('badge names a specific angle', !!dom.badge, dom.badge);
  check('splits table rendered', dom.splitRows > 5, `${dom.splitRows} rows`);
  check('Win% cells carry the comparison in hover text',
    dom.winCellTitles.length > 0 && /median player/.test(dom.winCellTitles[0]), dom.winCellTitles[0]);

  // ---------- 5. See more actually reveals the band panels ----------
  // Poll for the repaint rather than sleeping a fixed 600ms: ppRepaint lands after
  // an await, and a fixed sleep read the pre-repaint DOM and reported a false failure.
  await evalJs(`togglePpMktMore()`);
  await waitFor(`(() => { const p = document.querySelector('#ppMarketPanel');
    return !!(p && /Vs market expectation by split/i.test(p.innerText)); })()`, 'split breakdown after See more');
  const more = await evalJs(`(() => {
    const t = document.querySelector('.tabpage[data-page="players"]').innerText;
    return { bands: /Favourite reliability/i.test(t) && /Underdog reliability/i.test(t),
             splits: /Vs market expectation by split/i.test(t),
             label: [...document.querySelectorAll('span[onclick*="togglePpMktMore"]')].map(e=>e.textContent.trim())[0] };
  })()`);
  check('See more reveals band reliability panels', more.bands);
  check('See more reveals the split breakdown', more.splits);
  check('toggle flips to "Show less"', more.label === 'Show less', more.label);

  // ---------- 6. A second player, to prove it is not one-player-shaped ----------
  await evalJs(`showPlayerProfile('2072')`);
  await waitFor(`(() => { const p = document.querySelector('#ppMarketPanel');
    return !!(p && /Market performance/.test(p.innerText)); })()`, 'Sinner panel populated');
  const p2 = await evalJs(`(() => {
    const t = document.querySelector('.tabpage[data-page="players"]').innerText;
    return { aboutRight: /about right/i.test(t), panel: !!document.querySelector('#ppMarketPanel'),
             badge: (t.match(/(↑ UNDERPRICED[^\\n]*|↓ OVERPRICED[^\\n]*|↑ BEATS THE MARKET|↓ MARKET OVERRATES|NO EDGE FOUND)/)||[])[0] };
  })()`);
  check('second player clean too (Sinner)', p2.panel && !p2.aboutRight, `badge: ${p2.badge}`);

  check('no uncaught JS errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('FAILED: ' + failed.map(f => f.name).join(', '));
  ws.close(); chrome.kill();
  process.exit(failed.length ? 1 : 0);
})();
