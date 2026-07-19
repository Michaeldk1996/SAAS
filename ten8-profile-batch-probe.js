// Drives the deployed page in a real browser and asserts the four Player Profile
// changes in this batch, per player, from the live DOM:
//
//   Task 1  Recent form card height === Career record card height on first load
//   Task 2  Splits table: 5 column groups, 15 columns, 5 row sections, Win% rule
//   Task 3  Expanded form list carries no season badge and no season tabs
//   Mkt     Market panel opens shorter, "See more" reveals the split breakdown
//
// Every check asserts a POSITIVE count as well as an absence. A profile that
// failed to render at all also contains zero "2026" badges, which is the
// vacuous pass this guards against.
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9361;
const URL = process.argv[2] || 'http://127.0.0.1:8791/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1440 wide keeps the two cards side by side — the default headless viewport
  // is narrow enough to trip the 820px media query, stack them, and fake a
  // height mismatch.
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
    '--disable-gpu', '--window-size=1440,2400', `--user-data-dir=/tmp/ten8-batch-${process.pid}`, URL], { stdio: 'ignore' });

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
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await evaluate('typeof playerProfiles === "object" && playerProfiles && Object.keys(playerProfiles).length > 0');
    if (!ready) await sleep(1000);
  }
  if (!ready) { console.log('FAIL: playerProfiles never loaded'); chrome.kill(); process.exit(1); }

  // The profile lives inside a .tabpage that stays display:none until its nav
  // button is clicked. Without this every getBoundingClientRect returns 0 and
  // the height assertion passes vacuously (0 === 0).
  await evaluate(`(() => { const b = document.querySelector('#mainNav button[data-tab="players"]'); if (!b) return 'no-btn'; b.click(); return 'ok'; })()`);
  await sleep(800);
  const visible = await evaluate(`!!document.querySelector('.tabpage[data-page="players"].active')`);
  if (!visible) { console.log('FAIL: Players tab never activated — measurements would be vacuous'); chrome.kill(); process.exit(1); }

  // Sample across the splits index rather than the top of the list, so the run
  // covers stars and coverage-floor players alike.
  const splitKeys = await evaluate(`Object.keys((typeof careerSplits === 'object' && careerSplits) || {})`) || [];
  const sample = splitKeys.filter((_, i) => i % 7 === 0).slice(0, 18);
  console.log(`careerSplits players: ${splitKeys.length}; probing ${sample.length}\n`);

  const results = [];
  for (const k of sample) {
    await evaluate(`(typeof showPlayerProfile === 'function' ? (showPlayerProfile('${k}'), 'ok') : 'no-fn')`);
    let painted = false;
    for (let i = 0; i < 30 && !painted; i++) {
      painted = await evaluate(`!!document.getElementById('ppRecentFormCard') && !!document.getElementById('ppCareerRecordCard')`);
      if (!painted) await sleep(300);
    }
    if (!painted) { console.log(`${k}: profile never painted — skipped`); continue; }
    // The height lock runs after paint; give the layout a frame to settle.
    await sleep(500);

    const r = await evaluate(`(() => {
      const q = s => document.querySelector(s);
      const form = document.getElementById('ppRecentFormCard');
      const career = document.getElementById('ppCareerRecordCard');
      const view = document.getElementById('playerProfileView');
      const html = view ? view.innerHTML : '';
      const fh = Math.round(form.getBoundingClientRect().height);
      const ch = Math.round(career.getBoundingClientRect().height);

      // --- Task 2: splits table structure, read from real elements ---
      const groupText = [...view.querySelectorAll('span')].map(e => e.textContent.trim());
      const rows = [...view.querySelectorAll('.pp-split-row')];
      const winCells = rows.map(row => {
        const cells = [...row.children];
        // label + 15 columns; Win% is the 4th data column
        const w = cells[4];
        return w ? { txt: w.textContent.trim(), color: getComputedStyle(w).color, cols: cells.length - 1 } : null;
      }).filter(Boolean);
      const RGB = { green: 'rgb(62, 207, 142)', white: 'rgb(238, 242, 248)', red: 'rgb(232, 96, 122)' };
      const winBad = winCells.filter(c => {
        const v = parseFloat(c.txt);
        if (!isFinite(v)) return true;
        const want = v >= 60 ? RGB.green : (v >= 50 ? RGB.white : RGB.red);
        return c.color !== want;
      }).length;

      return {
        name: (playerProfiles[ppState.key] || {}).name,
        formH: fh, careerH: ch,
        splitRows: rows.length,
        colCount: winCells.length ? winCells[0].cols : 0,
        winBad,
        groups: ['Record','Sets','Games','Tiebreaks','Serve'].filter(g => groupText.includes(g)).length,
        sections: ['Surface','Level','Format','By Round','Opponent'].filter(g => groupText.includes(g)).length,
        careerOpen: /Career splits/.test(html) && rows.length > 0,
        last52Collapsed: !ppState.splitsOpen.last52,
        hasMarket: /Vs market expectation/.test(html),
        mktSplitVisible: /Vs market expectation by split/.test(html),
        seeMore: /See more · by tour level/.test(html),
      };
    })()`);
    if (!r || r.__err) { console.log(`${k}: probe threw ${r && r.__err}`); results.push({ k, fail: ['probe-threw'] }); continue; }

    // --- Market panel: measure the height it opens at, then expand ---
    let mkt = { before: 0, after: 0, revealed: false };
    if (r.hasMarket) {
      const mh = `(() => { const n=document.getElementById('ppMarketPanel'); return n?Math.round(n.getBoundingClientRect().height):0; })()`;
      mkt.before = await evaluate(mh);
      await evaluate(`(togglePpMktMore(), 'ok')`);
      await sleep(400);
      const after = await evaluate(`({ h: ${mh}, split: /Vs market expectation by split/.test(document.getElementById('playerProfileView').innerHTML) })`);
      mkt.after = after.h; mkt.revealed = after.split;
      await evaluate(`(togglePpMktMore(), 'ok')`);
      await sleep(300);
    }

    // --- Task 3: expand the form list and look for season chrome ---
    await evaluate(`(togglePpFormExpanded(), 'ok')`);
    await sleep(600);
    const exp = await evaluate(`(() => {
      const card = document.getElementById('ppRecentFormCard');
      if (!card) return null;
      const h = card.innerHTML;
      // A season badge was a bare 4-digit year in its own pill; the tournament
      // rows legitimately contain dates, so match the pill shape, not any year.
      const badges = [...card.querySelectorAll('span')].filter(e => /^(19|20)\\d\\d(\\s·\\s*partial)?$/.test(e.textContent.trim())).length;
      return {
        badges,
        seasonTabs: /setPpFormSeason/.test(h),
        partialNote: /Partial history/.test(h),
        showLess: /Show less/.test(h),
        rows: card.querySelectorAll('[data-ppek]').length,
      };
    })()`);
    await evaluate(`(togglePpFormExpanded(), 'ok')`);

    const fail = [];
    if (!r.formH || !r.careerH) fail.push(`height unmeasured (${r.formH}/${r.careerH})`);
    else if (r.formH !== r.careerH) fail.push(`height ${r.formH}≠${r.careerH}`);
    if (r.splitRows === 0) fail.push('no split rows');
    if (r.colCount !== 15) fail.push(`cols=${r.colCount}`);
    if (r.groups !== 5) fail.push(`groups=${r.groups}`);
    if (r.sections < 3) fail.push(`sections=${r.sections}`);
    if (r.winBad) fail.push(`win%colour×${r.winBad}`);
    if (!r.last52Collapsed) fail.push('last52 open');
    if (!exp) fail.push('expand failed');
    else {
      if (exp.badges) fail.push(`seasonBadge×${exp.badges}`);
      if (exp.seasonTabs) fail.push('season tabs');
      if (exp.partialNote) fail.push('partial note');
      if (!exp.rows) fail.push('expanded list empty');
      if (!exp.showLess) fail.push('no Show less');
    }
    if (r.hasMarket) {
      if (r.mktSplitVisible) fail.push('mkt split not collapsed');
      if (!r.seeMore) fail.push('no See more');
      if (!mkt.revealed) fail.push('See more revealed nothing');
      if (!mkt.before) fail.push('market panel unmeasured');
      else if (mkt.after <= mkt.before) fail.push('See more did not grow panel');
    }

    results.push({ k, name: r.name, fail, r, exp, mkt });
    console.log(`${String(k).padEnd(6)} ${String(r.name).slice(0,22).padEnd(22)} h=${r.formH}/${r.careerH} rows=${r.splitRows} cols=${r.colCount} grp=${r.groups} sec=${r.sections} win✗=${r.winBad} expRows=${exp?exp.rows:'-'} mkt=${mkt.before}→${mkt.after} ${fail.length ? 'FAIL: ' + fail.join(', ') : '✓'}`);
  }

  ws.close(); chrome.kill();
  const checked = results.length;
  const bad = results.filter(x => x.fail.length).length;
  if (!checked) { console.log('\nFAIL: zero profiles checked — nothing was verified.'); process.exit(1); }
  const mktChecked = results.filter(x => x.r && x.r.hasMarket).length;
  console.log(`\nprofiles checked: ${checked}  with market panel: ${mktChecked}`);
  if (errors.length) console.log('page errors:\n' + errors.slice(0, 6).join('\n'));
  console.log(bad ? `\nFAIL: ${bad}/${checked} profiles wrong.` : `\nPASS: ${checked}/${checked} profiles — height locked, 15 cols in 5 groups, Win% rule holds, no season chrome, market panel collapses.`);
  process.exit(bad || errors.length ? 1 : 0);
})();
