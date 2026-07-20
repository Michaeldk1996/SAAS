// Verifies Key Factors fix 3 — every bento block's size, position and inset matches
// the design file (handoff_key_factors, zip 24), and the Odds block carries the
// movement chart.
//
// This measures the RENDERED geometry, not the stylesheet. A CSS grep would pass on a
// rule that never applies (the whole tab is scoped to .modal-analysis, and a block
// rendered outside that scope silently keeps the old look — that exact trap cost us the
// form panel once). So every assertion here reads getBoundingClientRect /
// getComputedStyle off the live DOM, for every match on the board.
//
// Design geometry being asserted, straight out of the .dc.html:
//   grid          columns 1.25fr 1fr 1fr, gap 14px
//   cards         padding 18px 19px; tall + full-width 18px 20px; border alpha 0.07
//   placement     Style col1 rows1-2 · Form col2r1 · H2H col3r1
//                 Tournament col2r2 · Odds col3r2  (these two were mirrored before)
//   weather       slim strip, padding 13px 20px
//   progression   full width, 150px label column, 6 stats
//   analysis      #0c0e13, border alpha 0.09, padding 20px 22px
//
// Vacuous-pass guards: asserts a non-zero board, a non-zero number of modals actually
// opened, and that the Progression and Odds-chart branches were each exercised at least
// once. An empty selector list makes .every() return true, so "all green over zero
// blocks" is the failure mode this file is written against.
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9700 + (process.pid % 200);
const TARGET_URL = process.argv[2] || 'http://127.0.0.1:8797/index.html';
// Pin on the port for a local verify server, on the host for a real origin — the old
// port-only form computed '80' for an https URL and matched nothing.
const TARGET_NEEDLE = (TARGET_URL.match(/^https?:\/\/([^/]+)/) || [])[1] || TARGET_URL;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1.5 : tol);

(async () => {
  try { require('child_process').execSync(`pkill -f "ten8-kf3-probe-chrome" || true`, { stdio: 'ignore' }); } catch (e) {}
  // Width matters: the tab has 1000px and 680px breakpoints that collapse the grid to
  // 2 and 1 columns. A narrow headless viewport would stack every block and the
  // column-placement assertions would pass against a layout no user sees.
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox',
    '--disable-gpu', '--window-size=1600,2400', `--user-data-dir=/tmp/ten8-kf3-probe-chrome-${process.pid}`, TARGET_URL], { stdio: 'ignore' });
  const bail = (msg) => { console.log(msg); try { chrome.kill(); } catch (e) {} process.exit(1); };

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl && t.url.includes(TARGET_NEEDLE));
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
  }
  if (!wsUrl) bail('FAIL: no debug target pinned to the verify server');

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (m, p) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Runtime.enable', {});
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // A crashed earlier probe leaves Chrome alive holding the OLD build; the URL is
  // identical, so only comparing live source against the file catches it.
  let liveSrc = null;
  for (let i = 0; i < 60 && !liveSrc; i++) {
    const r = await evaluate(`(typeof buildKeyFactorsSection === 'function' ? buildKeyFactorsSection.toString() : '')`);
    if (typeof r === 'string' && r.length) liveSrc = r; else await sleep(500);
  }
  if (!liveSrc) bail('FAIL: buildKeyFactorsSection never appeared in the attached page');
  const diskSrc = require('fs').readFileSync(__dirname + '/bsp-consult-dashboard.html', 'utf8');
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  if (!norm(diskSrc).includes(norm(liveSrc).slice(0, 300))) {
    bail('FAIL: attached page is running a DIFFERENT build than the file on disk (stale Chrome)');
  }
  console.log('build check: attached page matches the worktree file');

  let rows = null;
  for (let i = 0; i < 60 && !rows; i++) {
    const board = await evaluate(`JSON.stringify((typeof matches !== 'undefined' && Array.isArray(matches)) ? matches.map(x => ({id:x.id, p1:x.p1, p2:x.p2})) : null)`);
    if (typeof board === 'string' && board !== 'null') {
      const parsed = JSON.parse(board);
      if (Array.isArray(parsed) && parsed.length) rows = parsed;
    }
    if (!rows) await sleep(1000);
  }
  if (!rows) bail('FAIL: board matches never loaded');
  console.log(`board matches: ${rows.length}`);

  const fails = [];
  let opened = 0, gridChecked = 0, cardsMeasured = 0;
  let progSeen = 0, oddsChartSeen = 0, analysisSeen = 0, stripSeen = 0;
  let col2Checked = 0, tallChecked = 0, col2Ran = 0, tallRan = 0;

  for (const m of rows) {
    await evaluate(`(typeof openAnalysisModal === 'function' ? (openAnalysisModal(${JSON.stringify(m.id)}), 'ok') : 'no-fn')`);
    // Wait on the condition, not a fixed sleep — the shards land async and the bento
    // repaints when they do. A fixed sleep grades the loading state.
    let painted = false;
    for (let i = 0; i < 40 && !painted; i++) {
      painted = await evaluate(`!!document.querySelector('#aSectionKey .akbento .akb')`);
      if (!painted) await sleep(250);
    }
    if (!painted) { fails.push(`${m.p1} v ${m.p2}: bento never painted`); continue; }
    // The per-match odds shard loads lazily and repaints the Odds block when it
    // lands. Measuring before that reads as "no odds history" on a board where every
    // match carries six books of it — so wait for the shard, then measure.
    for (let i = 0; i < 40; i++) {
      const books = await evaluate(`(() => { const x = (typeof matches !== 'undefined' ? matches : []).find(y => y.id === ${JSON.stringify(m.id)}); return x && x.oddsMovement && x.oddsMovement.books ? Object.keys(x.oddsMovement.books).length : 0; })()`);
      if (books) break;
      await sleep(300);
    }
    await sleep(350);
    opened++;

    const snap = await evaluate(`JSON.stringify((() => {
      const grid = document.querySelector('#aSectionKey .akbento');
      if (!grid) return null;
      const gs = getComputedStyle(grid);
      const cards = Array.from(grid.querySelectorAll(':scope > .akb')).map(el => {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        return {
          label: (el.querySelector('.akb-label') || {}).textContent || '',
          cls: el.className,
          left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10,
          top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10,
          w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
          padT: cs.paddingTop, padL: cs.paddingLeft, padR: cs.paddingRight,
          border: cs.borderTopColor, bg: cs.backgroundColor,
          hasOddsChart: !!el.querySelector('.ako-move svg'),
          progStats: el.querySelectorAll('.akp-stat').length,
        };
      });
      return { cols: gs.gridTemplateColumns, gap: gs.columnGap, gridW: Math.round(grid.getBoundingClientRect().width * 10) / 10, cards };
    })())`);
    if (!snap || snap === 'null') { fails.push(`${m.p1} v ${m.p2}: no bento grid`); continue; }
    const g = JSON.parse(snap);
    const tag = `${m.p1} v ${m.p2}`;

    // --- grid: 1.25 : 1 : 1 and a 14px gutter ---
    const colPx = g.cols.split(/\s+/).map(parseFloat).filter(Number.isFinite);
    if (colPx.length !== 3) {
      fails.push(`${tag}: grid has ${colPx.length} columns, design has 3`);
    } else {
      const ratio = colPx[0] / colPx[1];
      if (!near(ratio, 1.25, 0.03)) fails.push(`${tag}: column ratio ${ratio.toFixed(3)}, design 1.25`);
      if (!near(colPx[1], colPx[2], 1)) fails.push(`${tag}: columns 2 and 3 differ (${colPx[1]} vs ${colPx[2]})`);
      gridChecked++;
    }
    if (!near(parseFloat(g.gap), 14)) fails.push(`${tag}: grid gap ${g.gap}, design 14px`);

    const by = label => g.cards.find(c => c.label.toLowerCase().startsWith(label));
    const style = by('playing style'), form = by('recent form'), h2h = by('head to head');
    const tourn = by('tournament'), odds = by('odds'), prog = by('progression');

    // --- placement: the assertion the mirrored order actually broke ---
    // Tournament must share Form's column (col 2) and Odds must share H2H's (col 3).
    if (form && tourn) {
      col2Ran++;
      if (!near(form.left, tourn.left)) fails.push(`${tag}: Tournament left ${tourn.left} != Form left ${form.left} (not in column 2)`);
      else col2Checked++;
    }
    if (h2h && odds && !near(h2h.left, odds.left)) {
      fails.push(`${tag}: Odds left ${odds.left} != H2H left ${h2h.left} (not in column 3)`);
    }
    // Style is the tall feature: it must start at the grid's left edge and run past
    // the first row — i.e. at least to the bottom of whatever sits at col2 row2.
    if (style && tourn) {
      tallRan++;
      if (style.bottom < tourn.bottom - 2) fails.push(`${tag}: Style block does not span both rows (bottom ${style.bottom} < ${tourn.bottom})`);
      else tallChecked++;
      if (style.w <= form.w) fails.push(`${tag}: Style feature (${style.w}) is not wider than Form (${form.w}) — 1.25fr not applied`);
    }

    // --- per-card inset and border ---
    for (const c of g.cards) {
      cardsMeasured++;
      const wide = /akb-wide/.test(c.cls), tall = /akb-tall/.test(c.cls);
      const strip = /akb-strip/.test(c.cls), analysis = /akb-analysis/.test(c.cls), side = /akb-side/.test(c.cls);
      if (strip) {
        stripSeen++;
        if (!near(parseFloat(c.padT), 13)) fails.push(`${tag}/${c.label}: strip padding-top ${c.padT}, design 13px`);
        if (!near(parseFloat(c.padL), 20)) fails.push(`${tag}/${c.label}: strip padding-left ${c.padL}, design 20px`);
      } else if (analysis) {
        analysisSeen++;
        if (!near(parseFloat(c.padT), 20)) fails.push(`${tag}/${c.label}: analysis padding-top ${c.padT}, design 20px`);
        if (!near(parseFloat(c.padL), 22)) fails.push(`${tag}/${c.label}: analysis padding-left ${c.padL}, design 22px`);
        if (c.bg.replace(/\s/g, '') !== 'rgb(12,14,19)') fails.push(`${tag}/${c.label}: analysis bg ${c.bg}, design #0c0e13`);
        if (!/0\.09/.test(c.border)) fails.push(`${tag}/${c.label}: analysis border ${c.border}, design alpha 0.09`);
      } else {
        if (!near(parseFloat(c.padT), 18)) fails.push(`${tag}/${c.label}: padding-top ${c.padT}, design 18px`);
        const wantX = (wide || tall || side) ? 20 : 19;
        if (!near(parseFloat(c.padL), wantX)) fails.push(`${tag}/${c.label}: padding-left ${c.padL}, design ${wantX}px`);
        if (!/0\.07/.test(c.border)) fails.push(`${tag}/${c.label}: border ${c.border}, design alpha 0.07`);
      }
      // Full-width blocks must actually span the grid.
      if (wide && !near(c.w, g.gridW, 2)) fails.push(`${tag}/${c.label}: full-width block is ${c.w} of ${g.gridW}`);
    }

    // --- progression block ---
    if (prog) {
      progSeen++;
      if (prog.progStats !== 6) fails.push(`${tag}: Progression shows ${prog.progStats} stats, design 6`);
      if (!/akb-wide/.test(prog.cls)) fails.push(`${tag}: Progression is not full-width`);
    }
    // --- odds movement chart (the second half of fix 3) ---
    if (odds && odds.hasOddsChart) oddsChartSeen++;

    await evaluate(`(document.querySelector('.modal-analysis .amodal-close') || {click(){}}).click()`);
    await sleep(60);
  }

  if (fails.length) {
    console.log(`FAIL: ${fails.length} geometry mismatches`);
    fails.slice(0, 25).forEach(f => console.log('  - ' + f));
    chrome.kill(); process.exit(1);
  }

  // --- vacuous-pass guards ---
  if (!opened) bail('FAIL: zero modals opened — every assertion above was vacuous');
  if (!gridChecked) bail('FAIL: grid columns never measured');
  if (!cardsMeasured) bail('FAIL: zero cards measured');
  if (!col2Ran) bail('FAIL: the column-2 placement assertion never ran (no card had both Form and Tournament)');
  if (!tallRan) bail('FAIL: the tall-span assertion never ran');
  if (!progSeen) bail('FAIL: the Progression block never rendered on any match — cannot claim it works');
  // Measured after the odds shard has landed, so this is real coverage. It was 0
  // when measured at first paint — that was a race, not a missing feed.
  if (oddsChartSeen !== opened) bail(`FAIL: odds movement chart rendered on ${oddsChartSeen} of ${opened} matches`);
  if (!analysisSeen) bail('FAIL: the analysis block never rendered');
  if (!stripSeen) bail('FAIL: the weather strip never rendered');

  console.log(`modals opened: ${opened}/${rows.length}`);
  console.log(`cards measured: ${cardsMeasured} · grids: ${gridChecked} · col2 placements: ${col2Checked} · tall spans: ${tallChecked}`);
  console.log(`progression blocks: ${progSeen} · odds charts: ${oddsChartSeen}/${opened} · analysis: ${analysisSeen} · weather strips: ${stripSeen}`);
  if (fails.length) {
    console.log(`\nFAIL: ${fails.length} geometry mismatches`);
    fails.slice(0, 25).forEach(f => console.log('  - ' + f));
    chrome.kill(); process.exit(1);
  }
  console.log('\nPASS: bento geometry matches the design on every match on the board');
  chrome.kill(); process.exit(0);
})();
