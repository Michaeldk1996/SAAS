#!/usr/bin/env node
// Bet Tracker T1 page in a real headless Chrome, on the site's CODE set (tools/site-code.sh → a temp dir, so a file
// missing from the deploy list fails here too): the Betting nav group, the #tracker route, a new member's empty state,
// Log a bet (Single · Combination · 3-leg Parlay), settle WON / LOST / VOID, Lock, the manual Close + CLV on blur,
// reload persistence (same tab session), historical results loading as locked (new session), and the reference's
// measured values (`design_handoff_bet_tracker/Bet Tracker Page.dc.html` inline styles) at 1340 and 1180 px.
// No Chrome (CHROME_BIN unset and none found) → a loud SKIP, never a pass.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, detail ? '\n        ' + String(detail).slice(0, 900) : ''); } };

// ── wiring, no browser ──
const html = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
check('dashboard links bettracker-page.css', html.includes('<link rel="stylesheet" href="./bettracker-page.css">'));
check('dashboard loads bettracker-math → bettracker-store → bettracker-page, in that order',
  ['bettracker-math.js', 'bettracker-store.js', 'bettracker-page.js'].map(f => html.indexOf('<script src="' + f + '" defer></script>')).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])));
check('a tracker tab page exists', html.includes('<div class="tabpage" data-page="tracker"><div id="trackerRoot"></div></div>'));
const nav = html.slice(html.indexOf('<nav class="sf-nav" id="mainNav">'), html.indexOf('</nav>'));
const groups = [...nav.matchAll(/<div class="sf-group" role="group" aria-label="([^"]+)">/g)].map(m => m[1]);
check('sidebar groups: Analyse · Research · Insights · Betting', JSON.stringify(groups) === JSON.stringify(['Analyse', 'Research', 'Insights', 'Betting']), JSON.stringify(groups));
const betting = nav.slice(nav.indexOf('aria-label="Betting"'));
check('Betting = Picks · Bet Tracker, in that order', /data-tab="picks"[\s\S]*data-tab="tracker"/.test(betting) && !nav.slice(0, nav.indexOf('aria-label="Betting"')).includes('data-tab="picks"'));
check('Bet Tracker icon = README §Where it lives', betting.includes('<path d="M3.5 5.5h13v9h-13zM3.5 9h13M6.5 12h3M13 5.5v9"/>'));
check('short label "Tracker" carried on the row', betting.includes('data-short="Tracker"'));
const pipe = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8'), pub = readFileSync(join(ROOT, 'tools/publish-site.mjs'), 'utf8'), code = readFileSync(join(ROOT, 'tools/site-code.sh'), 'utf8');
for (const f of ['bettracker-math.js', 'bettracker-store.js', 'bettracker-page.js', 'bettracker-page.css', 'bettracker-import.js']) {
  check(`${f} in all three code deploy lists (+ the pipeline's MISSING assert)`, pipe.split(f).length - 1 === 2 && pub.includes(`'${f}'`) && code.includes(f));
}
check('no demo bets ship: the seed generator lives in the math test only', !/20261027|Challenger lab|Tennis 2026/.test(readFileSync(join(ROOT, 'bettracker-page.js'), 'utf8') + readFileSync(join(ROOT, 'bettracker-store.js'), 'utf8') + readFileSync(join(ROOT, 'bettracker-math.js'), 'utf8')));
check('dashboard loads bettracker-import.js after the store', html.indexOf('<script src="bettracker-import.js" defer></script>') > html.indexOf('<script src="bettracker-store.js" defer></script>'));
check('no member file in the repo: the importer ships no rows (only the synthetic fixture under tools/fixtures)', !/Napoleon Games|Unibet/.test(readFileSync(join(ROOT, 'bettracker-import.js'), 'utf8')));
check('only the store touches storage', !/localStorage|sessionStorage/.test(readFileSync(join(ROOT, 'bettracker-page.js'), 'utf8') + readFileSync(join(ROOT, 'bettracker-math.js'), 'utf8')));
check('night only: the page never reads the theme engine', !/sfTheme|data-theme/.test(readFileSync(join(ROOT, 'bettracker-page.js'), 'utf8') + readFileSync(join(ROOT, 'bettracker-page.css'), 'utf8')));

const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => existsSync(p));
if (!chrome) {
  console.log('  SKIP  the browser checks: no Chrome (set CHROME_BIN) — said out loud, not a pass');
} else await browser();
console.log(`bettracker-page: ${pass} pass, ${fail} fail`);
console.log(`EXIT=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);

async function browser() {
  const SITE = mkdtempSync(join(tmpdir(), 'bt-site-'));
  execFileSync('bash', [join(ROOT, 'tools/site-code.sh'), ROOT, SITE]);
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const p = normalize(join(SITE, u === '/' ? 'bsp-consult-dashboard.html' : u));
    if (!p.startsWith(SITE) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const dir = mkdtempSync(join(tmpdir(), 'bt-ch-'));
  const ch = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1512,982', `--user-data-dir=${join(dir, 'u')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const done = () => { try { ch.kill('SIGKILL'); } catch (e) { /* gone */ } server.close(); try { rmSync(SITE, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ } };
  try {
    const port = await new Promise((res, rej) => { let s = ''; const t = setTimeout(() => rej(new Error('no DevTools port')), 30000);
      ch.stderr.on('data', d => { s += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(s); if (m) { clearTimeout(t); res(+m[1]); } }); });
    const tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
    const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const wait = new Map(); const errors = [];
    const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    ws.addEventListener('message', e => { const m = JSON.parse(e.data);
      if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
      else if (m.method === 'Fetch.requestPaused') send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' });
      else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(`${d.url || ''} ${d.exception?.description || d.text}`); } });
    const E = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable');
    // signed out, the page is sent to auth.html: stay on the page (the tracker's store is the browser's own)
    await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.html*', resourceType: 'Document' }, { urlPattern: '*verify.html*', resourceType: 'Document' }] });
    const size = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: 982, deviceScaleFactor: 1, mobile: false });
    // a real document load every time (a new query string: the same URL + #tracker would only be a fragment hop)
    let loads = 0;
    const open = async () => {
      await E(`window.__btOld = 1`).catch(() => {});
      await send('Page.navigate', { url: BASE + 'bsp-consult-dashboard.html?load=' + (++loads) + '#tracker' });
      const t0 = Date.now();
      while (!(await E(`!window.__btOld && !!(window.TrackerPage && document.querySelector('#trackerRoot .bt-col'))`).catch(() => false))) {
        if (Date.now() - t0 > 60000) throw new Error('the Bet Tracker page never loaded' + (errors.length ? ' · page errors: ' + errors.join(' | ') : ''));
        await new Promise(r => setTimeout(r, 300));
      }
    };
    const T = (sel) => E(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent`);
    const click = (sel) => E(`(function(){ var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.dispatchEvent(new MouseEvent('click', {bubbles:true})); return true; })()`);
    const type = (sel, v) => E(`(function(){ var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
    const choose = (sel, v) => E(`(function(){ var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
    // color-mix() computes to color(srgb r g b / a): normalise to the reference's rgba() (channels × 255, rounded)
    const norm = (v) => String(v).replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g, (m, r, g, b, a) => {
      const c = [r, g, b].map(x => Math.round(parseFloat(x) * 255)); return a === undefined || a === '1' ? `rgb(${c.join(', ')})` : `rgba(${c.join(', ')}, ${parseFloat(a)})`; });
    const cs = async (sel, props) => { const v = await E(`(function(){ var el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; var s = getComputedStyle(el); return ${JSON.stringify(props)}.map(function(p){ return s.getPropertyValue(p); }); })()`); return v && v.map(norm); };

    await size(1340); await open();
    // ── a new member ──
    check('route #tracker shows the page, nav row active', await E(`document.querySelector('[data-page="tracker"]').classList.contains('active') && document.querySelector('#trackerTabBtn').classList.contains('active')`));
    check('one default bankroll "Bankroll 1"', JSON.stringify(await E(`[...document.querySelectorAll('.bt-bank-name')].map(e=>e.textContent)`)) === '["Bankroll 1"]');
    check('empty bankroll card: no bets yet · ROI — · Profit —', await E(`document.querySelector('.bt-bank-meta').textContent === 'no bets yet' && [...document.querySelectorAll('.bt-tile-fig')].every(e => e.textContent === '—')`));
    check('header badge: Certified ledger · nothing settled yet', (await T('.bt-cert')) === 'Certified ledger · nothing settled yet');
    check('ledger meta: 0 of 0 bets in the period · pending first · …', (await T('.bt-sub125')) === '0 of 0 bets in the period · pending first · settle a bet and every figure above recomputes');
    check('no month chips', await E(`!document.querySelector('.bt-months')`));
    check('no placeholder numbers: the empty ledger body is a dash', (await T('.bt-tr .bt-empty')) === '—');
    check('View segment renders Results · Insights · Staking', JSON.stringify(await E(`[...document.querySelectorAll('.bt-view')].map(e=>e.textContent)`)) === '["Results","Insights","Staking"]');
    await click('.bt-view[data-k="insights"]');
    check('Insights (new member): three verdict cards with their empty sentences, no numbers', JSON.stringify(await E(`[...document.querySelectorAll('.bt-vcard')].map(c=>[c.querySelector('.bt-vpl').textContent, c.querySelector('.bt-vtitle').textContent])`))
      === JSON.stringify([['—', 'No segment with 15+ bets is clearly profitable yet.'], ['—', 'No losing segment with 15+ bets in this period.'], ['—', 'Nothing under the sample floor is trending wrong.']]) && await E(`!document.querySelector('.bt-ledger')`));
    check('Insights (new member): the Closing-line dial reads — over "0 of 0 priced bets", no verdict', JSON.stringify(await E(`(function(){ var d=document.querySelector('.bt-dial'); return [d.querySelector('.bt-dial-fig').textContent, d.querySelector('.bt-dial-v').textContent, d.querySelector('.bt-dial-s').textContent]; })()`))
      === JSON.stringify(['—', '—', '0 of 0 priced bets beat the close · target 55%+']));
    check('Insights (new member): every dial is a dash or EARLY · n=0 — no judgement on no data', JSON.stringify(await E(`[...document.querySelectorAll('.bt-dial-v')].map(e=>e.textContent)`)) === JSON.stringify(['—', '—', 'EARLY · n=0']));
    check('Insights (new member): "0 of 0 checks need work · 0 bets · 3 not judged yet", not green', (await T('.bt-discsum')) === '0 of 0 checks need work · 0 bets · 3 not judged yet' && (await E(`document.querySelector('.bt-discsum-n').classList.contains('bt-lab')`)));
    await click('.bt-view[data-k="staking"]');
    check('Staking = the card frame with a single dash', (await T('.bt-frame')) === '—');
    await click('.bt-view[data-k="results"]');

    // ── the reference's measured values (inline styles of Bet Tracker Page.dc.html) ──
    const ref = [
      ['.bt-sec', ['padding-top', 'padding-left', 'padding-bottom', 'background-color'], ['32px', '40px', '60px', 'rgb(5, 6, 10)']],
      ['.bt-col', ['max-width', 'min-width', 'row-gap'], ['1340px', '960px', '16px']],
      ['.bt-stack', ['row-gap'], ['28px']],
      ['.bt-bank', ['width', 'padding-top', 'padding-left', 'padding-bottom', 'border-radius', 'background-color', 'border-top-color'], ['300px', '14px', '16px', '12px', '12px', 'rgb(14, 16, 25)', 'rgba(0, 122, 255, 0.65)']],
      ['.bt-bank-name', ['font-size', 'font-weight'], ['14px', '700']],
      ['.bt-tile', ['background-color', 'border-radius', 'padding-top', 'padding-left'], ['rgb(10, 13, 20)', '8px', '8px', '10px']],
      ['.bt-tile-fig', ['font-size', 'font-weight'], ['18px', '800']],
      ['.bt-addbank', ['width', 'border-top-style', 'border-top-color'], ['200px', 'dashed', 'rgba(255, 255, 255, 0.18)']],
      ['.bt-bankname', ['font-size', 'font-weight'], ['26px', '800']],
      ['.bt-cert', ['height', 'border-radius', 'background-color', 'border-top-color', 'color', 'font-size', 'font-weight'], ['24px', '7px', 'rgba(0, 122, 255, 0.12)', 'rgba(0, 122, 255, 0.35)', 'rgb(106, 154, 248)', '11.5px', '700']],
      ['.bt-cert .bt-seal', ['width', 'height', 'background-color'], ['12px', '12px', 'rgb(0, 122, 255)']],
      ['.bt-headmeta', ['font-size', 'color'], ['13px', 'rgb(163, 170, 190)']],
      ['.bt-logbtn', ['height', 'border-radius', 'background-color', 'font-size', 'font-weight'], ['36px', '10px', 'rgb(0, 122, 255)', '13px', '700']],
      ['.bt-hero', ['padding-top', 'padding-left', 'padding-bottom', 'border-radius', 'background-color'], ['22px', '24px', '18px', '12px', 'rgb(14, 16, 25)']],
      ['.bt-views', ['height', 'background-color', 'border-radius'], ['30px', 'rgb(12, 14, 22)', '9px']],
      ['.bt-view.on', ['font-size', 'font-weight', 'background-color', 'color'], ['12.5px', '700', 'rgb(27, 32, 49)', 'rgb(255, 255, 255)']],
      ['.bt-h16', ['font-size', 'font-weight'], ['16px', '800']],
      ['.bt-lf.on', ['font-size', 'font-weight', 'background-color', 'border-radius'], ['12px', '700', 'rgb(27, 32, 49)', '8px']],
      ['.bt-thead', ['height', 'background-color', 'padding-left', 'grid-template-columns'], ['28px', 'rgb(10, 13, 20)', '16px', null]],
      ['.bt-foot', ['font-size', 'padding-top', 'padding-bottom'], ['11.5px', '10px', '12px']]
    ];
    const measure = async (label) => {
      for (const [sel, props, want] of ref) {
        const got = await cs(sel, props);
        const ok = got && want.every((w, i) => w === null || got[i] === w);
        check(`${label}: ${sel} = reference`, ok, JSON.stringify({ got, want }));
      }
    };
    await measure('1340');

    // ── Log a Single · a Combination · a 3-leg Parlay ──
    await click('.bt-logbtn');
    check('Log a bet opens · button reads Close', !!(await T('.bt-log')) && (await T('.bt-logbtn')) === 'Close');
    check('Post bet fills its auto track to the panel edge (reference grid 150px 200px auto)', await E(`Math.abs(document.querySelector('#btPost').getBoundingClientRect().right - document.querySelector('.bt-row3').getBoundingClientRect().right) < 1`));
    check('Post bet greyed until valid', await E(`!document.querySelector('#btPost').classList.contains('is-ok')`));
    check('Odds read — until the leg is valid', (await T('#btOdds')) === '—');
    await type('[data-f="legtext"][data-i="0"]', 'A. de Minaur to win'); await type('[data-f="legodds"][data-i="0"]', '2.10');
    await type('[data-f="tour"]', 'Vienna'); await type('[data-f="stake"]', '1');
    check('Single: odds 2.10, Post live', (await T('#btOdds')) === '2.10' && await E(`document.querySelector('#btPost').classList.contains('is-ok')`));
    check('You post sentence verbatim', (await T('#btHint')) === 'You post: single · A. de Minaur to win · Match winner @ 2.10 · bet105 · 1% of bankroll · pre-match · wins → +1.10% · loses → −1.00%. It lands as pending; settle it in the ledger, then lock it.');
    await click('#btPost');
    check('posting closes the panel and lands a pending row', await E(`!document.querySelector('.bt-log') && document.querySelectorAll('.bt-tr.is-pending').length === 1`));
    await click('.bt-logbtn'); await click('.bt-segitem[data-k="type"][data-v="Combination"]');
    check('Combination: two leg rows labelled Leg 1 / Leg 2, odds label Combined odds', JSON.stringify(await E(`[...document.querySelectorAll('.bt-leg .bt-caps10')].map(e=>e.textContent)`)) === '["Leg 1","Leg 2"]');
    check('legs note before odds', (await T('#btLegsNote')) === 'Two legs, one ticket — the odds multiply (e.g. 1.30 × 1.20 = 1.56). All legs must win.');
    await type('[data-f="legtext"][data-i="0"]', 'J. Sinner to win'); await type('[data-f="legodds"][data-i="0"]', '1.30');
    await type('[data-f="legtext"][data-i="1"]', 'C. Alcaraz to win'); await type('[data-f="legodds"][data-i="1"]', '1.20');
    await type('[data-f="tour"]', 'Basel'); await type('[data-f="stake"]', '1.5');
    check('Combination: 1.30 × 1.20 = 1.56', (await T('#btOdds')) === '1.56' && (await T('#btLegsNote')) === 'Two legs, one ticket — the odds multiply: 1.30 × 1.20 = 1.56. All legs must win.');
    await click('#btPost');
    await click('.bt-logbtn'); await click('.bt-segitem[data-k="type"][data-v="Parlay"]'); await click('.bt-addleg');
    check('Parlay: three legs, a remove × on each', await E(`document.querySelectorAll('.bt-leg').length === 3 && document.querySelectorAll('.bt-legx').length === 3`));
    for (const [i, t, o] of [[0, 'Leg A', '1.50'], [1, 'Leg B', '1.40'], [2, 'Leg C', '1.30']]) { await type(`[data-f="legtext"][data-i="${i}"]`, t); await type(`[data-f="legodds"][data-i="${i}"]`, o); }
    await type('[data-f="stake"]', '0.5'); await choose('[data-f="book"]', 'Other');
    check('Other bookmaker reveals its typed field and blocks Post until filled', !!(await T('[data-f="bookOther"]') !== undefined) && await E(`!!document.querySelector('[data-f="bookOther"]') && !document.querySelector('#btPost').classList.contains('is-ok')`));
    await type('[data-f="bookOther"]', 'Local book');
    check('Parlay: 1.50 × 1.40 × 1.30 = 2.73', (await T('#btOdds')) === '2.73' && await E(`document.querySelector('#btPost').classList.contains('is-ok')`));
    await click('#btPost');
    check('three pending rows', await E(`document.querySelectorAll('.bt-tr.is-pending').length === 3`));
    check('parlay row meta carries Parlay · 3 legs', await E(`[...document.querySelectorAll('.bt-betmeta')].some(e => / · Parlay · 3 legs$/.test(e.textContent))`));
    check('pending rows: WON / LOST / VOID, Close a dash', await E(`[...document.querySelectorAll('.bt-tr.is-pending')].every(r => r.querySelectorAll('.bt-settle').length === 3 && r.querySelector('.bt-close').textContent === '—')`));

    // ── settle WON · LOST · VOID, lock one ──
    const rowSel = (txt) => `[...document.querySelectorAll('.bt-tr')].find(r => r.querySelector('.bt-bettext') && r.querySelector('.bt-bettext').textContent === ${JSON.stringify(txt)})`;
    const act = (txt, sel) => E(`(function(){ var r = ${rowSel(txt)}; var b = r && r.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.dispatchEvent(new MouseEvent('click', {bubbles:true})); return true; })()`);
    await act('A. de Minaur to win', '.bt-settle.is-won'); await act('J. Sinner to win + C. Alcaraz to win', '.bt-settle.is-lost'); await act('Leg A + Leg B + Leg C', '.bt-settle.is-void');
    check('settled rows: undo + Lock + chip', await E(`[...document.querySelectorAll('.bt-tr')].filter(r => r.querySelector('.bt-chip')).every(r => r.querySelector('.bt-undo') && r.querySelector('.bt-lock'))`));
    check('P/L (date desc, id desc): 0.0% · −1.5% · +1.1%', JSON.stringify(await E(`[...document.querySelectorAll('.bt-tr')].map(r => r.querySelector('.bt-pl').textContent)`)) === JSON.stringify(['0.0%', '−1.5%', '+1.1%']));
    check('header after settling: Certified · 0 of 3 results locked', (await T('.bt-cert')) === 'Certified · 0 of 3 results locked');
    check('settled rows take a Close input (the one-cell unlock)', await E(`document.querySelectorAll('.bt-closein').length === 3`));
    await E(`(function(){ var r = ${rowSel('J. Sinner to win + C. Alcaraz to win')}; var i = r.querySelector('.bt-closein'); i.focus(); i.value = '1.50'; i.dispatchEvent(new Event('input', {bubbles:true})); i.dispatchEvent(new FocusEvent('focusout', {bubbles:true})); })()`);
    check('Close 1.50 on blur → CLV +4.0% (1.56 ÷ 1.50 − 1)', await E(`(function(){ var r = ${rowSel('J. Sinner to win + C. Alcaraz to win')}; return r.querySelector('.bt-clv').textContent === '+4.0%' && r.querySelector('.bt-clv').classList.contains('bt-pos'); })()`));
    const closeIn = await cs('.bt-closein', ['height', 'background-color', 'border-top-color', 'border-radius', 'font-family']);
    check('Close input chrome = the form inputs (34px, inner, 10% ring, radius 8, mono)', closeIn && closeIn[0] === '34px' && closeIn[1] === 'rgb(10, 13, 20)' && closeIn[2] === 'rgba(255, 255, 255, 0.1)' && closeIn[3] === '8px' && /IBM Plex Mono/.test(closeIn[4]), JSON.stringify(closeIn));
    await act('A. de Minaur to win', '.bt-lock');
    check('locked row: chip + 13px seal, no undo, no buttons, Close read-only', await E(`(function(){ var r = ${rowSel('A. de Minaur to win')}; var s = r.querySelector('.bt-seal'); return !!s && getComputedStyle(s).width === '13px' && !r.querySelector('.bt-undo') && !r.querySelector('.bt-lock') && !r.querySelector('.bt-settle') && !r.querySelector('.bt-closein') && r.querySelector('.bt-close').textContent === '—'; })()`));
    check('header: Certified · 1 of 3 results locked', (await T('.bt-cert')) === 'Certified · 1 of 3 results locked');
    await act('Leg A + Leg B + Leg C', '.bt-undo');
    check('undo returns a row to pending', await E(`(function(){ var r = ${rowSel('Leg A + Leg B + Leg C')}; return r.classList.contains('is-pending') && r.querySelectorAll('.bt-settle').length === 3; })()`));
    await act('Leg A + Leg B + Leg C', '.bt-settle.is-void');
    check('month chip row: All · this month', await E(`document.querySelectorAll('.bt-mchip').length === 2`));
    await click('.bt-lf[data-k="won"]');
    check('ledger filter Won: 1 of 3', (await T('.bt-sub125')).startsWith('1 of 3 bets in the period'));
    await click('.bt-lf[data-k="all"]');

    // ── T2 · the hero: tiles, Period, Filters, View (three bets: WON 2.10 × 1 · LOST 1.5 · VOID; one close) ──
    check('hero: seven tiles in order', JSON.stringify(await E(`[...document.querySelectorAll('.bt-htile .bt-caps')].map(e=>e.textContent)`)) === JSON.stringify(['ROI', 'Record', 'Win rate', 'Avg CLV', 'Max drawdown', 'Best run', 'Worst run']));
    check('hero: Record 1–1 over "3 settled · 1 void"', JSON.stringify(await E(`(function(){ var t=[...document.querySelectorAll('.bt-htile')][1]; return [t.querySelector('.bt-htile-fig').textContent, t.querySelector('.bt-htile-sub').textContent]; })()`)) === JSON.stringify(['1–1', '3 settled · 1 void']));
    check('hero: Avg CLV "beat the close 1 of 1"', (await E(`[...document.querySelectorAll('.bt-htile')][3].querySelector('.bt-htile-sub').textContent`)) === 'beat the close 1 of 1');
    check('hero: profit = ledger P/L sum, sign-coloured', (await T('.bt-profit')) === '−0.4%' && (await E(`document.querySelector('.bt-profit').classList.contains('bt-neg')`)), await T('.bt-profit'));
    check('hero: curve meta "3 bets · peak … · now −0.4%"', /^3 bets · peak .+ · now −0\.4%$/.test(await T('.bt-curvemeta')), await T('.bt-curvemeta'));
    check('hero: curve path, the last point and the ticks are drawn', await E(`!!document.querySelector('.bt-curve .bt-line') && !!document.querySelector('.bt-lastpt') && document.querySelectorAll('.bt-yt').length > 1`));
    await click('.bt-trig[data-k="period"]');
    check('period menu: four options', JSON.stringify(await E(`[...document.querySelectorAll('.bt-menu-period .bt-mrow')].map(e=>e.firstChild.textContent)`)) === JSON.stringify(['Last 30 days', 'Last 90 days', 'Season', 'Custom range']));
    await click('.bt-mrow[data-k="custom"]');
    check('period menu: Custom range reveals two date inputs and stays open', await E(`document.querySelectorAll('.bt-menu-period .bt-date-in[type="date"]').length === 2`));
    await click('.bt-mrow[data-k="30d"]');
    check('period: a non-custom pick closes the menu and lights the trigger', !(await E(`!!document.querySelector('.bt-menu-period')`)) && (await T('.bt-trig[data-k="period"]')).startsWith('Last 30 days') && (await E(`document.querySelector('.bt-trig[data-k="period"]').classList.contains('on')`)));
    check('period: the header names it', (await T('.bt-headmeta')).includes('last 30 days shown'));
    await click('.bt-trig[data-k="filters"]');
    check('filters menu: Level · Odds band · Surface · Market', JSON.stringify(await E(`[...document.querySelectorAll('.bt-fgroup-l')].map(e=>e.textContent)`)) === JSON.stringify(['Level', 'Odds band', 'Surface', 'Market']));
    check('filters menu: ATP 500 counts all three bets', (await E(`document.querySelector('.bt-mrow[data-k="level"][data-v="ATP 500"] .bt-mrow-n').textContent`)) === '3');
    await click('.bt-mrow[data-k="surface"][data-v="Clay"]');
    check('filters: a zero row stays pickable and the label names it', (await T('.bt-trig[data-k="filters"]')).startsWith('Filters · Clay'));
    check('filters: counts are cross-adjusted (ATP 500 given Clay = 0, Clay given nothing else = 0)', (await E(`document.querySelector('.bt-mrow[data-k="level"][data-v="ATP 500"] .bt-mrow-n').textContent`)) === '0');
    check('filters: the header says "1 filter on, 0 of 3 bets"', (await T('.bt-headmeta')).endsWith('1 filter on, 0 of 3 bets'), await T('.bt-headmeta'));
    await click('.bt-reset');
    check('Reset filters clears the filters and the period back to Season', (await T('.bt-trig[data-k="filters"]')).startsWith('Filters') && !(await T('.bt-trig[data-k="filters"]')).includes('·') && (await T('.bt-trig[data-k="period"]')).startsWith('Season'));
    await click('.bt-trig[data-k="filters"]');
    check('the View segment: Results is on', (await T('.bt-view.on')).startsWith('Results'));

    // ── T3 · Calendar: today's cell, hover pop-up, pin, months table, month pop-up ──
    const ckey = await E(`(function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
    check('calendar: 182 day cells (26 weeks)', (await E(`document.querySelectorAll('.bt-hgrid .bt-hc').length`)) === 182);
    check('calendar: today = −0.4% → "−40" € on a 10,000 € bankroll, red', JSON.stringify(await E(`(function(){ var c=document.querySelector('.bt-hc[data-k="${ckey}"]'); return [c.firstChild.textContent, c.classList.contains('is-neg')]; })()`)) === JSON.stringify(['−40', true]));
    check('calendar: the pop-up is hidden until hover', (await E(`getComputedStyle(document.querySelector('.bt-hc[data-k="${ckey}"] .bt-hpop')).display`)) === 'none');
    check('calendar: the pop-up title + "3 settled · 1–1 · −0.4% = −40 €"', (await T(`.bt-hc[data-k="${ckey}"] .bt-hpop-s`)) === '3 settled · 1–1 · −0.4% = −40 €', await T(`.bt-hc[data-k="${ckey}"] .bt-hpop-s`));
    await click(`.bt-hc[data-k="${ckey}"]`);
    check('calendar: click pins the record box with the three bets and a white ring', (await E(`document.querySelectorAll('.bt-hrec .bt-hrec-r').length`)) === 3 && (await E(`getComputedStyle(document.querySelector('.bt-hc.is-sel')).boxShadow`)).includes('0px 0px 0px 2px'));
    await click('.bt-hrec-x');
    check('calendar: Close clears the pin', !(await E(`!!document.querySelector('.bt-hrec')`)));
    check('months table: this month, 3 settled, −0.4%', JSON.stringify(await E(`[...document.querySelectorAll('.bt-mrowt')].map(r=>[r.querySelector('.bt-mn').textContent, r.querySelector('.bt-mpl').textContent])`)) === JSON.stringify([['3', '−0.4%']]));
    await click('.bt-mrowt');
    check('month pop-up: four tiles P/L · ROI · Win rate · Avg CLV and three rows', JSON.stringify(await E(`[...document.querySelectorAll('.bt-mpop-tile .bt-caps')].map(e=>e.textContent)`)) === JSON.stringify(['P/L', 'ROI', 'Win rate', 'Avg CLV']) && (await E(`document.querySelectorAll('.bt-mpop-row').length`)) === 3);
    check('month pop-up: sub "3 settled bets · 1–1–1 void · 3.0% staked"', (await T('.bt-mpop-s')) === '3 settled bets · 1–1–1 void · 3.0% staked', await T('.bt-mpop-s'));
    check('month pop-up: a fixed overlay over the page', (await E(`getComputedStyle(document.querySelector('.bt-mpop')).position`)) === 'fixed');
    await click('.bt-mpop-tile');
    check('month pop-up: a click inside stays open', await E(`!!document.querySelector('.bt-mpop')`));
    await click('.bt-mpop');
    check('month pop-up: a click outside closes it', !(await E(`!!document.querySelector('.bt-mpop')`)));
    await click('.bt-mrowt'); await click('.bt-mpop-x');
    check('month pop-up: ✕ closes it', !(await E(`!!document.querySelector('.bt-mpop')`)));

    // ── T4 · Insights: the cut menu (8 cuts with counts), a cut in natural order, the total row, three dials ──
    await click('.bt-view[data-k="insights"]');
    check('insights: three verdict cards', (await E(`document.querySelectorAll('.bt-vcard').length`)) === 3);
    await click('.bt-trig[data-k="dim"]');
    check('breakdown: the cut menu lists the eight cuts', JSON.stringify(await E(`[...document.querySelectorAll('.bt-menu-dim .bt-mrow')].map(e=>e.firstChild.firstChild.textContent)`)) === JSON.stringify(['Market', 'Surface', 'Odds band', 'Level', 'Bookmaker', 'Timing', 'Situation', 'Weekday']));
    await click('.bt-mrow[data-k="odds"]');
    check('breakdown: Odds band rows in band order, head "Odds taken", total "All · odds band"', (await T('.bt-bhead .bt-caps10')) === 'Odds taken' && (await T('.bt-btot-l')) === 'All · odds band'
      && await E(`(function(){ var B=${JSON.stringify(['1.10 – 1.35','1.36 – 1.60','1.61 – 1.90','1.91 – 2.20','2.21 – 2.60','2.61 – 3.20','3.21 and up'])}; var n=[...document.querySelectorAll('.bt-brow .bt-bname')].map(e=>e.textContent); return n.length>0 && n.every((x,i)=>i===0||B.indexOf(x)>B.indexOf(n[i-1])); })()`));
    check('breakdown: the total row counts the settled bets', (await T('.bt-btot-n')) === '3');
    check('discipline: three dials with the README labels', JSON.stringify(await E(`[...document.querySelectorAll('.bt-dial-l')].map(e=>e.textContent)`)) === JSON.stringify(['Closing line', 'Stake after a loss', 'Third bet after two losses']));
    check('discipline: closing line judged on 1 priced bet', (await E(`document.querySelector('.bt-dial-s').textContent`)) === '1 of 1 priced bets beat the close · target 55%+');
    await click('.bt-view[data-k="results"]');

    // ── reload: everything is still there ──
    await open();
    check('reload: three bets', await E(`document.querySelectorAll('.bt-tr[data-bet]').length === 3`));
    check('reload: the locked row has no undo and no buttons', await E(`(function(){ var r = ${rowSel('A. de Minaur to win')}; return !!r.querySelector('.bt-seal') && !r.querySelector('.bt-undo') && !r.querySelector('.bt-lock') && !r.querySelector('.bt-settle'); })()`));
    check('reload: LOST + VOID still undoable in this tab session', await E(`['J. Sinner to win + C. Alcaraz to win','Leg A + Leg B + Leg C'].every(function(t){ var r = [...document.querySelectorAll('.bt-tr')].find(x => x.querySelector('.bt-bettext') && x.querySelector('.bt-bettext').textContent === t); return r && r.querySelector('.bt-undo'); })`));
    check('reload: the Close and its CLV survive', await E(`(function(){ var r = ${rowSel('J. Sinner to win + C. Alcaraz to win')}; return r.querySelector('.bt-closein').value === '1.50' && r.querySelector('.bt-clv').textContent === '+4.0%'; })()`));
    check('reload: chips WON / LOST / VOID', JSON.stringify(await E(`[...document.querySelectorAll('.bt-chip')].map(e=>e.textContent)`)) === '["VOID","LOST","WON"]');
    check('reload: bankroll card 3 settled', (await T('.bt-bank-meta')) === '3 settled');

    // ── 1180 px: the same reference values ──
    await size(1180); await open();
    await measure('1180');
    check('1180: column holds its 960px floor', (await E(`document.querySelector('.bt-col').getBoundingClientRect().width`)) >= 960);

    // ── a new tab session: historical results load as locked ──
    await E(`sessionStorage.clear()`); await open();
    check('new session: every settled result is locked (no undo anywhere)', await E(`!document.querySelector('.bt-undo') && document.querySelectorAll('.bt-seal.is-row').length === 3`));
    check('new session: Certified · 3 of 3 results locked', (await T('.bt-cert')) === 'Certified · 3 of 3 results locked');
    const night = await cs('.bt-card', ['background-color']), nightSec = await cs('.bt-sec', ['background-color']), nightLf = await cs('.bt-lf.on', ['background-color']);
    await E(`document.documentElement.setAttribute('data-theme', 'day')`);
    const day = await cs('.bt-card', ['background-color']), daySec = await cs('.bt-sec', ['background-color']), dayLf = await cs('.bt-lf.on', ['background-color']);
    check('Day theme leaves the page night-only (card · page · selected segment unchanged)', JSON.stringify([night, nightSec, nightLf]) === JSON.stringify([day, daySec, dayLf]) && day[0] === 'rgb(14, 16, 25)', JSON.stringify({ night, day }));
    // ── T1b · the Bet-Analytix import, on the synthetic fixture moved to this month (the console path) ──
    const now = new Date(), ymNow = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-';
    const csv = readFileSync(join(ROOT, 'tools/fixtures/bettracker-import-sample.csv'), 'utf8').replace(/2026-10-/g, ymNow);
    check('import: 10 bets stored', (await E(`TrackerPage.importText(${JSON.stringify(csv)}).stored`)) === 10);
    check('import: its bankroll is selected and named BSP Consult Bet-Analytix', (await T('.bt-bank.is-on .bt-bank-name')) === 'BSP Consult Bet-Analytix');
    check('import: header "9 settled since 14 Jan 2022 · 0 pending"', (await T('.bt-headmeta')).startsWith('9 settled since 14 Jan 2022 · 0 pending'), await T('.bt-headmeta'));
    check('import: the report line names the count', (await T('.bt-importmsg')).startsWith('Imported 10 bets into BSP Consult Bet-Analytix'));
    check('import: every imported result is unlocked (undo + Lock, no seal)', await E(`[...document.querySelectorAll('.bt-tr[data-bet]')].every(r => r.querySelector('.bt-undo') && r.querySelector('.bt-lock') && !r.querySelector('.bt-seal'))`));
    check('import: a blank market and bookmaker read —', await E(`(function(){ var r = [...document.querySelectorAll('.bt-tr')].find(x => x.querySelector('.bt-bettext') && x.querySelector('.bt-bettext').textContent.startsWith('Two legs')); return r.querySelector('.bt-market').textContent === '—' && r.querySelector('.bt-book').textContent === '—'; })()`));
    check('import: no "undefined" anywhere on the page', !(await E(`document.getElementById('trackerRoot').textContent.includes('undefined')`)));
    check('import: a second import is refused and says so', (await E(`TrackerPage.importText(${JSON.stringify(csv)}).reason`)) === 'already-imported' && (await T('.bt-importmsg')).startsWith('Import refused'));
    check('import: no Import CSV control for a non-admin', !(await E(`!!document.querySelector('.bt-import')`)));
    check('import: Avg CLV tile reads — over "no closing prices"', JSON.stringify(await E(`(function(){ var t=[...document.querySelectorAll('.bt-htile')][3]; return [t.querySelector('.bt-htile-fig').textContent, t.querySelector('.bt-htile-sub').textContent]; })()`)) === JSON.stringify(['—', 'no closing prices']));
    await click('.bt-view[data-k="insights"]');
    check('import: Closing-line dial — with "0 of 0 priced bets", never a verdict', JSON.stringify(await E(`(function(){ var d=document.querySelector('.bt-dial'); return [d.querySelector('.bt-dial-fig').textContent, d.querySelector('.bt-dial-v').textContent, d.querySelector('.bt-dial-s').textContent]; })()`))
      === JSON.stringify(['—', '—', '0 of 0 priced bets beat the close · target 55%+']));
    check('import: no "undefined" in Insights', !(await E(`document.getElementById('trackerRoot').textContent.includes('undefined')`)));
    await click('.bt-view[data-k="results"]');
    await E(`sessionStorage.clear()`); await open(); await click('.bt-bank[data-id="bet-analytix"]');
    check('new session: imported results stay unlocked', await E(`document.querySelectorAll('.bt-tr[data-bet] .bt-undo').length === 9 && !document.querySelector('.bt-tr[data-bet] .bt-seal')`));
    check('removeImport wipes it in one call', (await E(`TrackerPage.removeImport().removed`)) === 10);
    check('no page errors', errors.length === 0, errors.join('\n'));
  } catch (e) {
    check('browser run', false, e && e.stack || e);
  } finally { done(); }
}
