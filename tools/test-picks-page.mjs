#!/usr/bin/env node
// Picks page — LOCK 2026-10-30 (design_handoff_picks: CHANGES_2026-10-30 > SIDEBAR_NAV > CHANGES_2026-10-29 > SPEC) in a
// real headless Chrome, on the site's CODE set (tools/site-code.sh → a temp dir, so a file missing from the deploy list
// fails here too): #picks route, Upcoming bands + header stats, Completed ledger + record strip, the analysis sheet,
// gating, the Record view, the empty states, typed markets, the "+ Post a pick" button (the only place a pick is posted),
// the Picks count badge, the drawer, the mobile card, and the controls / band values against the reference (with a
// negative control that must break them). Demo picks come from tools/fixtures/picks-demo.json (injected — real picks
// live in Firestore). No Chrome (CHROME_BIN unset and none found) → a loud SKIP, never a pass.
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
check('dashboard links picks-page.css', html.includes('<link rel="stylesheet" href="./picks-page.css">'));
check('dashboard loads picks-core → picks-store → picks-page → picks-drawer → picks-shell, in that order',
  ['picks-core.js', 'picks-store.js', 'picks-page.js', 'picks-drawer.js', 'picks-shell.js'].map(f => html.indexOf('<script src="' + f + '" defer></script>')).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])));
check('a picks tab page exists', html.includes('<div class="tabpage" data-page="picks"><div id="picksRoot"></div></div>'));
check('the Picks rail row opens the Betting group (founder 2026-10-28: moved from Analyse)', /<div class="sf-glabel">Betting<\/div>\n(?:\s*<!--[^\n]*-->\n)?\s*<button class="sf-item" data-tab="picks" id="picksTabBtn" aria-label="Picks">/.test(html));
const pipe = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8'), pub = readFileSync(join(ROOT, 'tools/publish-site.mjs'), 'utf8');
for (const f of ['picks-core.js', 'picks-store.js', 'picks-page.js', 'picks-drawer.js', 'picks-shell.js', 'picks-page.css']) {
  check(`${f} in all three code deploy lists`, pipe.includes(f) && pub.includes(`'${f}'`) && readFileSync(join(ROOT, 'tools/site-code.sh'), 'utf8').includes(f));
}
// Task 2: picks live in Firestore behind firestore.rules — no picks file is published (the demo rows are a test fixture)
check('no picks file is published (no picks.json in any deploy list)', !/picks\.json/.test(pipe + pub + readFileSync(join(ROOT, 'tools/site-code.sh'), 'utf8')) && !existsSync(join(ROOT, 'picks.json')));
check('the store is read before the page script (picks-store.js precedes picks-page.js)', html.indexOf('src="picks-store.js"') > 0 && html.indexOf('src="picks-store.js"') < html.indexOf('src="picks-page.js"'));
// founder 2026-10-30, override 1: picks are posted only from the Picks page — no "+ Pick" on match cards or the
// analysis modal header, and the per-member new-pick dot is replaced by the count badge
const shell = readFileSync(join(ROOT, 'picks-shell.js'), 'utf8');
check('no "+ Pick" on match cards or the analysis header (no pkPlusHtml, no .pk-plus anywhere)', !/pkPlusHtml|pk-plus/.test(html + shell + readFileSync(join(ROOT, 'picks-page.js'), 'utf8')));
check('no new-pick dot (replaced by the count badge)', !/pk-dot/.test(shell + readFileSync(join(ROOT, 'picks-page.css'), 'utf8')));
// founder 2026-10-30: the browser never autofills the drawer's price and stake (a Fils pick was posted at Jodar's price)
const drawerSrc = readFileSync(join(ROOT, 'picks-drawer.js'), 'utf8');
const autofillOff = src => ['pkdPrice', 'pkdStake'].every(id => new RegExp('<input[^>]*id="' + id + '"[^>]*autocomplete="off"').test(src));
check('drawer: autocomplete="off" on the price and stake boxes', autofillOff(drawerSrc));
check('MUTANT caught: the price box without autocomplete="off"', !autofillOff(drawerSrc.replace(/(id="pkdPrice"[^>]*?) autocomplete="off"/, '$1')));
// founder 2026-10-30 (research and development): the admin edits / voids / deletes any pick at any time; the note has no cap
const pageSrc0 = readFileSync(join(ROOT, 'picks-page.js'), 'utf8');
const editAnyTime = src => /function editLink\(p\) \{\s*if \(!isAdmin\(\) \|\| !p \|\| p\._teaser\) return '';/.test(src) && !/min left/.test(src);
check('page: the admin Edit link is on every pick, no 10-minute window', editAnyTime(pageSrc0));
check('MUTANT caught: Edit only on posted picks again', !editAnyTime(pageSrc0.replace("if (!isAdmin() || !p || p._teaser) return '';", "if (!isAdmin() || !p || p._teaser || p.status !== 'posted') return '';")));
const noCap = src => !/maxlength=|2,000|\.slice\(0, 2000\)|length [<>]=? ?2000/.test(src);
check('drawer: no note cap (no maxlength, no 2,000, no slice)', noCap(drawerSrc));
check('MUTANT caught: the note sliced at 2,000 again', !noCap(drawerSrc.replace('D.note = v;', 'D.note = v.slice(0, 2000);')));
const storeSrc = readFileSync(join(ROOT, 'picks-store.js'), 'utf8');
check('store: delete removes the pick and its teaser in one batch', /function remove\(id\)[\s\S]*?b\.delete\(s\.db\.collection\('picks'\)\.doc\(id\)\);\s*b\.delete\(s\.db\.collection\('picks_public'\)\.doc\(id\)\);/.test(storeSrc));
check('the synthetic ledger is in no deploy list', !/picks-synthetic-ledger/.test(pipe + pub + readFileSync(join(ROOT, 'tools/site-code.sh'), 'utf8')));

const chrome = process.env.CHROME_BIN || ['/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) {
  console.log('  SKIP  the browser checks: no Chrome (set CHROME_BIN) — said out loud, not a pass');
} else await browser();
console.log(`picks-page: ${pass} pass, ${fail} fail`);
console.log(`EXIT=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);

async function browser() {
  const SITE = mkdtempSync(join(tmpdir(), 'picks-site-'));
  execFileSync('bash', [join(ROOT, 'tools/site-code.sh'), ROOT, SITE]);
  const FIXTURE = readFileSync(join(ROOT, 'tools/fixtures/picks-demo.json'), 'utf8');   // injected: the store is not reachable here
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const p = normalize(join(SITE, u === '/' ? 'bsp-consult-dashboard.html' : u));
    if (!p.startsWith(SITE) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const dir = mkdtempSync(join(tmpdir(), 'picks-ch-'));
  // --hide-scrollbars: Linux Chrome (the code gate) draws a 15 px classic scrollbar that macOS overlays; widths are
  // checked against the reference's 1512 / 390 frames, which have none (gate run 40485549063: card 656.5 ≠ 664)
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
    // signed out, the page is sent to auth.html: this read-only check stays on the page (nothing is signed in)
    await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.html*', resourceType: 'Document' }, { urlPattern: '*verify.html*', resourceType: 'Document' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + 'bsp-consult-dashboard.html#picks' });
    const t0 = Date.now();
    while (!(await E(`!!window.PicksPage`).catch(() => false))) {
      if (Date.now() - t0 > 60000) throw new Error('the Picks page never loaded');
      await new Promise(r => setTimeout(r, 300));
    }
    check('signed out, the store yields nothing: no card, no picks file fetched', await E(`document.querySelectorAll('#picksRoot .pk-card').length === 0`));
    // the demo fixture and the reference are drawn in Europe/Brussels: pin the member zone there (founder 2026-10-30,
    // override 2 — Picks reads stennisfy.tz, else the browser's zone, never a hard-coded Brussels)
    await E(`localStorage.setItem('stennisfy.tz', 'Europe/Brussels')`);
    await E(`PicksPage._inject(${FIXTURE})`);
    const R = (js) => E(`(() => { const S = PicksPage._state, q = s => document.querySelector('#picksRoot ' + s), qa = s => [...document.querySelectorAll('#picksRoot ' + s)],
      txt = e => { if (!e) return null; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), out = []; let t; while ((t = w.nextNode())) { const v = t.nodeValue.replace(/\\s+/g, ' ').trim(); if (v) out.push(v); } return out.join(' '); }, cs = (e, p) => e ? getComputedStyle(e)[p] : null;
      const set = (o) => { Object.assign(S, o); PicksPage.render(); }; ${js} })()`);

    // The plan arrives late (the auth paint calls sfPlanLocks on every auth change): a plan change must re-render the page.
    // One synchronous evaluation, so the real auth paint cannot interleave. (Gate run 40506098717: a late paint reset
    // window.sfPlan between two steps of this test — the page itself never re-rendered for it.)
    const pc = await E(`(() => { const blur = () => document.querySelectorAll('#picksRoot .pk-b2.is-blur').length;
      PicksPage._state.tab = 'upcoming'; PicksPage._state.view = 'cards';
      window.sfPlanLocks({ plan: 'free' }); const free = blur(); window.sfPlanLocks({ plan: 'pro' }); const pro = blur();
      window.sfPlanLocks(null); const out = blur(); return { free, pro, out }; })()`);
    check('a plan change re-renders: Free → 5 blurred bands, Pro → 0, signed out → 5', pc.free === 5 && pc.pro === 0 && pc.out === 5, JSON.stringify(pc));
    // From here every scenario sets its own plan; pin it so a late auth paint cannot change it mid-test.
    await E(`(() => { window.__pkPlan = null; Object.defineProperty(window, 'sfPlan', { configurable: true, get() { return window.__pkPlan; }, set() {} }); })()`);

    check('#picks opens the Picks tab page', await E(`[...document.querySelectorAll('.tabpage.active')].map(p => p.dataset.page).join(',')`) === 'picks');
    check('#picks lights the Picks rail row', await E(`(document.querySelector('#mainNav button.active') || {}).dataset?.tab === 'picks'`));
    // a click on the rail row from another page opens Picks and writes #picks; a click elsewhere clears it
    const nav = await E(`(() => { document.querySelector('#mainNav button[data-tab="matches"]').click(); const a = [location.hash, document.querySelector('.tabpage.active').dataset.page];
      document.querySelector('#mainNav button[data-tab="picks"]').click(); const b = [location.hash, document.querySelector('.tabpage.active').dataset.page]; return { a, b }; })()`);
    check('rail: Picks row opens Picks with #picks; leaving clears it', nav.a[0] !== '#picks' && nav.a[1] === 'matches' && nav.b[0] === '#picks' && nav.b[1] === 'picks', JSON.stringify(nav));

    // 1a · Upcoming, Pro: one band per bet, header stats, no date strip / search / tournaments
    const a = await R(`window.__pkPlan = 'pro'; set({ tab: 'upcoming', view: 'cards', sheet: null });
      return { title: txt(q('.sfh__title')), sub: txt(q('.sfh__sub')), stats: qa('.pk-tstats .sfh__stat').map(txt), bands: qa('.pk-band').map(b => b.dataset.sheet),
        head: txt(q('.pk-bands-hd')), tabs: qa('.pk-tab').map(txt), tsub: txt(q('.pk-tsub')), old: qa('.pk-day, .pk-search, .pk-tpill, .pk-chev, .pk-card').length, blur: qa('.is-blur').length,
        p1: txt(q('[data-sheet="p1"]')), p2tl: qa('[data-sheet="p2"] .pk-bt-l').map(txt), o1: txt(q('[data-sheet="o1"] .pk-b5')), tag: txt(q('[data-sheet="p1"] .pk-tag')),
        fav: txt(q('[data-sheet="p1"] .pk-fav')?.closest('.pk-bp')), page: cs(q('.pk-page'), 'maxWidth'), minH: cs(document.querySelector('.tabpage[data-page="picks"]'), 'minHeight') }; `);
    const zone = await R(`window.__pkPlan = 'pro'; localStorage.setItem('stennisfy.tz', 'Asia/Makassar'); set({ tab: 'upcoming', view: 'cards', sheet: null });
      const mk = txt(q('[data-sheet="p1"] .pk-b3-s')); localStorage.setItem('stennisfy.tz', 'Europe/Brussels'); set({}); return { mk, br: txt(q('[data-sheet="p1"] .pk-b3-s')) };`);
    check('override 2: times read the member zone (Makassar 16:41 · 03:30, Brussels 09:41 · 20:30), never a fixed Brussels', /posted 16:41/.test(zone.mk) && /posted 09:41/.test(zone.br) && zone.mk !== zone.br, JSON.stringify(zone));
    check('1a header copy', a.title === 'Picks' && a.sub === 'Hand-picked daily from the Stennisfy model and strategy.', JSON.stringify(a).slice(0, 300));
    check('1a header stats Bets today · Match · Outright · Staked · If all land', a.stats.join(' | ') === 'BETS TODAY 5 | MATCH 3 | OUTRIGHT 2 | STAKED 5% | IF ALL LAND +6.4%' || a.stats.join(' | ') === 'Bets today 5 | Match 3 | Outright 2 | Staked 5% | If all land +6.4%', a.stats.join(' | '));
    check('1a five bands, head "Open · 5 bets" + "all at bet105 · click a bet for the analysis"', a.bands.length === 5 && a.head === 'Open · 5 bets all at bet105 · click a bet for the analysis', JSON.stringify([a.bands, a.head]));
    check('1a two tabs, sub "Today"; no dates, day chips, tournaments, search or cards', a.tabs.join('|') === 'Upcoming|Completed' && a.tsub === 'Today' && a.old === 0, JSON.stringify(a));
    check('1a Pro: nothing blurred', a.blur === 0, a.blur);
    check('1a band: tag · players · bet line @ price bet105 · posted time · stake · trail · CLV', /^WINNER MB M\. Berrettini TE T\. M\. Etcheverry FAV Berrettini to win @ 2\.02 bet105 posted 09:41 · Vienna Open R32 · 20:30 Stake 1% 1\.95 2\.02 2\.10 — Open Posted Now Close CLV —$/.test(a.p1), a.p1);
    check('1a FAV on the lower current price (Etcheverry)', /Etcheverry/.test(a.fav), a.fav);
    check('1a live band labels Now as Last', a.p2tl.join('|') === 'Open|Posted|Last|Close', a.p2tl.join('|'));
    check('1a outright band: "Open position" + settles line, no trail', a.o1 === 'Open position Settles 16 Nov · no open / now / close for outrights', a.o1);
    check('1a shared 1340 column: the page is 1420 wide with 40 px gutters; the tab page fills the screen (empty-day glow)', a.page === '1420px' && a.minH !== '0px' && a.minH !== 'auto', JSON.stringify([a.page, a.minH]));

    // band + controls = the reference's values (CHANGES_2026-10-30 §1 / SPEC §3), with a negative control
    const REFV = `const want = {
        'band': ['.pk-band', { backgroundColor: 'rgb(14, 16, 25)', borderTopWidth: '1px', borderRadius: '14px', paddingTop: '12px', paddingLeft: '18px', columnGap: '18px', cursor: 'pointer' }],
        'tabs track': ['.pk-tabs', { backgroundColor: 'rgb(23, 27, 40)', borderTopWidth: '0px', borderRadius: '10px', paddingTop: '3px', columnGap: '3px' }],
        'tab on': ['.pk-tab.on', { backgroundColor: 'rgb(27, 32, 49)', borderTopColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '8px', paddingTop: '7px', paddingLeft: '14px', fontSize: '12.5px', fontWeight: '700' }],
        'tab off': ['.pk-tab:not(.on)', { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(163, 170, 190)', fontWeight: '600' }],
        'tab sub': ['.pk-tsub', { fontSize: '12.5px', color: 'rgb(163, 170, 190)' }],
        'type tag': ['.pk-band .pk-tag', { height: '20px', paddingLeft: '8px', borderRadius: '6px', fontSize: '10px', fontWeight: '700' }] };
      const diffs = []; let n = 0;
      for (const [name, [sel, props]] of Object.entries(want)) { const el = q(sel); if (!el) { diffs.push(name + ': missing'); continue; }
        const c = getComputedStyle(el); for (const [k, v] of Object.entries(props)) { n++; if (c[k] !== v) diffs.push(name + ' ' + k + ': ' + c[k] + ' ≠ ' + v); } }
      const cols = getComputedStyle(q('.pk-band')).gridTemplateColumns.split(' ');
      if (cols.length !== 9 || cols[0] !== '118px' || cols[2] !== '1px' || cols[4] !== '64px' || cols[6] !== '300px' || cols[8] !== '56px') diffs.push('band grid: ' + cols.join(' '));
      return { n, diffs };`;
    await E(`Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]).then(() => 1)`);
    const rv = await R(`set({ view: 'cards', tab: 'upcoming' }); ${REFV}`);
    check(`band + controls = the reference's values (${rv.n} computed properties + the band grid)`, rv.n >= 25 && rv.diffs.length === 0, rv.diffs.join('\n        '));
    const ctl = await R(`const st = document.createElement('style'); st.id = 'pk-neg'; st.textContent = '[data-page="picks"] .pk-band{ background:var(--card); grid-template-columns: 1fr 1fr } [data-page="picks"] .pk-tab.on{ background:var(--inner) }'; document.head.appendChild(st);
      const r = (() => { ${REFV} })(); st.remove(); return r;`);
    check('negative control: a card-tone band on a two-column grid breaks the check', ctl.diffs.some(x => /band backgroundColor/.test(x)) && ctl.diffs.some(x => /band grid/.test(x)) && ctl.diffs.some(x => /tab on backgroundColor/.test(x)), JSON.stringify(ctl.diffs));

    // the analysis sheet: any band or ledger row opens it; Esc / ✕ / the scrim close it
    const sh = await R(`set({ tab: 'upcoming', sheet: null }); q('[data-sheet="p1"] .pk-b3').click(); const o = { open: !!document.querySelector('.pk-sh'), t: txt(document.querySelector('.pk-sh')) };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); o.esc = !document.querySelector('.pk-sh') && S.sheet == null;
      q('[data-sheet="p1"]').click(); document.querySelector('.pk-sh .pk-sh-x').click(); o.x = !document.querySelector('.pk-sh');
      q('[data-sheet="p1"]').click(); document.querySelector('.pk-sh-pn, .pk-sh .pk-sh-r')?.click(); o.inner = !!document.querySelector('.pk-sh');
      q('[data-sheet="p1"] .pk-star').click(); o.star = !document.querySelector('.pk-sh') || o.inner; set({ sheet: null }); return o;`);
    check('sheet: a band click opens it with the bet, the trail and the analysis', sh.open && /Berrettini to win/.test(sh.t) && /Open 1\.95 Posted 2\.02 Now 2\.10 Close —/i.test(sh.t.replace(/\s+/g, ' ').replace(/OPEN|POSTED|NOW|CLOSE/g, m => m[0] + m.slice(1).toLowerCase())) && /Analysis/i.test(sh.t), sh.t);
    check('sheet: Esc closes it, ✕ closes it, a click inside keeps it open', sh.esc && sh.x && sh.inner, JSON.stringify(sh));
    // founder 2026-10-30: player photos on the cards and in the analysis (by player ID through playerPhotoImg, monogram under it)
    const PH = `window.__phWas = window.playerPhotoImg; window.playerPhotoImg = (k, n) => '<img class="sf-ph" data-k="' + k + '" alt="' + n + '">';
      const ids = { p1: [104745, 207989], p3: [206173, 208029] }; S.fixture.picks.forEach(p => { const v = ids[p.id]; if (v) { p.player_a.id = v[0]; p.player_b.id = v[1]; } });
      set({ tab: 'upcoming', view: 'cards', sheet: null }); const o = { band: qa('[data-sheet="p1"] .pk-bp-av img.sf-ph').map(i => i.dataset.k), mono: txt(q('[data-sheet="p1"] .pk-bp-av')),
        noId: qa('[data-sheet="p2"] .pk-bp-av img').length, pos: cs(q('[data-sheet="p1"] .pk-bp-av'), 'position') };
      set({ sheet: 'p3' }); o.sheet = [...document.querySelectorAll('.pk-sh .pk-sh-av img.sf-ph')].map(i => i.dataset.k); o.sheetMono = txt(document.querySelector('.pk-sh .pk-sh-av'));
      set({ sheet: null }); window.__pkPlan = 'free'; set({ tab: 'upcoming' }); o.gated = qa('.pk-band.is-gated img.sf-ph').length; o.gatedN = qa('.pk-band.is-gated').length;
      window.__pkPlan = 'pro'; S.fixture.picks.forEach(p => { if (ids[p.id]) { p.player_a.id = null; p.player_b.id = null; } }); window.playerPhotoImg = window.__phWas; set({}); return o;`;
    const ph = await R(PH);
    check('cards: each player\'s photo by his ID over his monogram; no ID → monogram only', JSON.stringify(ph.band) === '["104745","207989"]' && ph.mono === 'MB TE'.split(' ')[0] && ph.noId === 0 && ph.pos === 'relative', JSON.stringify(ph));
    check('analysis: the backed player\'s photo (Musetti, side b) beside the bet line', JSON.stringify(ph.sheet) === '["208029"]' && ph.sheetMono === 'FC', JSON.stringify(ph));
    check('a gated (non-Pro) card carries no photo — it never names the pick', ph.gatedN > 0 && ph.gated === 0, JSON.stringify(ph));
    const gmut = pageSrc0.replace('var ph = !gated && q &&', 'var ph = q &&');
    check('MUTANT caught: a gated card shows the photo', gmut !== pageSrc0 && await (async () => {
      await E(`(0, eval)(${JSON.stringify(gmut)}); PicksPage._inject(${FIXTURE}); 1`); const m = await R(PH);
      await E(`(0, eval)(${JSON.stringify(pageSrc0)}); PicksPage._inject(${FIXTURE}); 1`); return m.gated > 0; })());
    // MUTANT: the sheet shows player a whatever the selection → the analysis check must go red
    const pageSrc = readFileSync(join(ROOT, 'picks-page.js'), 'utf8'), pmut = pageSrc.replace("(p.selection === 'b' ? p.player_b : p.player_a)", 'p.player_a');
    check('MUTANT caught: the analysis photo ignores the selection', pmut !== pageSrc && await (async () => {
      await E(`(0, eval)(${JSON.stringify(pmut)}); PicksPage._inject(${FIXTURE}); 1`); const m = await R(PH);
      await E(`(0, eval)(${JSON.stringify(pageSrc)}); PicksPage._inject(${FIXTURE}); 1`); return JSON.stringify(m.sheet) !== '["208029"]'; })());

    // 1d · non-Pro: bands blurred, not clickable, PRO + unlock
    const d = await R(`window.__pkPlan = 'free'; set({ tab: 'upcoming', sheet: null });
      const out = { blurred: qa('.pk-band .pk-b2.is-blur').length, line: qa('.pk-band .pk-b3-l.is-blur').length, unlock: qa('.pk-band .pk-unlock').map(txt), filter: cs(q('.pk-b2.is-blur'), 'filter'),
        sel: cs(q('.pk-b2.is-blur'), 'userSelect'), cur: cs(q('.pk-band'), 'cursor') }; q('.pk-band').click(); out.sheet = !!document.querySelector('.pk-sh'); return out;`);
    check('1d non-Pro: every band blurs players + bet line, PRO "Unlock today’s picks →"', d.blurred === 5 && d.line === 5 && d.unlock.length === 5 && d.unlock.every(t => t === 'PRO Unlock today’s picks →'), JSON.stringify(d));
    check('1d non-Pro: blur(5px), no select, default cursor, a click opens no sheet', d.filter === 'blur(5px)' && d.sel === 'none' && d.cur === 'default' && !d.sheet, JSON.stringify(d));

    // 1c · Completed = the history ledger (non-Pro still: settled is never blurred) + the Record strip in the header
    const c = await R(`set({ tab: 'completed', sheet: null });
      return { rows: qa('.pk-hr').map(r => r.dataset.sheet), blur: qa('.is-blur').length, day: txt(q('.pk-hday')), chips: qa('.pk-rchip').map(txt), heads: txt(q('.pk-hh')),
        strip: qa('.pk-recstats .sfh__stat').map(txt), pers: qa('.pk-per').map(txt), tstats: qa('.pk-tstats').length, bands: qa('.pk-band').length, tsub: qa('.pk-tsub').length };`);
    check('1c Completed: four ledger rows, newest day first, never blurred', c.rows.length === 4 && c.blur === 0 && c.bands === 0, JSON.stringify(c));
    check('1c day head "Mon 26 · 4 bets · 2–1 · 1 void" + P/L', /^Mon 26 4 bets · 2–1 · 1 void \+/.test(c.day), c.day);
    check('1c result chips WON / LOST / VOID', c.chips.slice().sort().join('|') === 'LOST|VOID|WON|WON', c.chips.join('|'));
    check('1c header carries the Record strip (30 d · 90 d · Season), not today\'s stats', c.pers.join('|') === '30 d|90 d|Season' && c.tstats === 0 && c.strip.length === 5 && c.tsub === 0, JSON.stringify(c));
    const cs1 = await R(`q('[data-sheet="s1"]').click(); const t = txt(document.querySelector('.pk-sh')); const res = !!document.querySelector('.pk-sh .pk-sh-res'); set({ sheet: null }); return { t, res };`);
    check('1c a ledger row opens the sheet with the settled block (result, score)', cs1.res && /WON/.test(cs1.t) && /F\. Cerundolo/.test(cs1.t), cs1.t);

    // empty states
    const em = await R(`const keep = S.fixture.picks; S.fixture.picks = []; set({ tab: 'upcoming' }); const up = txt(q('.pk-empty')); set({ tab: 'completed' }); const done = txt(q('.pk-empty'));
      S.fixture.picks = keep; set({ tab: 'upcoming' }); return { up, done };`);
    check('empty Upcoming: "No open bets right now" + the reference line', em.up === 'No open bets right now Posted picks stay here until their match ends, then move to Completed.', em.up);
    check('empty Completed: "No bets settled in the last 30 days."', em.done === 'No bets settled in the last 30 days.', em.done);

    // typed market (override 2): never a dash — the tag, the bet line, the sheet; the stored record is read as it is
    const ty = await R(`window.__pkPlan = 'pro'; const b = JSON.parse(JSON.stringify(S.fixture.picks.find(p => p.id === 'p1'))); Object.assign(b, { id: 'tb1', market: 'Other', market_text: 'Tiebreak', line: null, selection: 'b' });
      S.fixture.picks.push(b); set({ tab: 'upcoming', sheet: null }); const o = { tag: txt(q('[data-sheet="tb1"] .pk-tag')), line: txt(q('[data-sheet="tb1"] .pk-b3-t')) };
      q('[data-sheet="tb1"]').click(); o.sheet = txt(document.querySelector('.pk-sh')); set({ sheet: null }); S.fixture.picks.pop(); PicksPage.render(); return o;`);
    check('typed market: tag TIEBREAK, bet line "Etcheverry · Tiebreak", the sheet says the same', ty.tag === 'TIEBREAK' && ty.line === 'Etcheverry · Tiebreak' && /Etcheverry · Tiebreak/.test(ty.sheet), JSON.stringify(ty));

    // 1e · Record view (from the header strip)
    const e = await R(`set({ view: 'cards', tab: 'completed' }); q('.pk-recstats').click();
      return { rows: qa('.pk-lr').length, heads: qa('.pk-lh').map(txt), meta: txt(q('.pk-rmeta')), total: txt(q('.pk-lt')), ctrls: qa('.pk-ctrl').length, on: txt(q('.pk-lh.on')), back: txt(q('.pk-back')) };`);
    check('1e Record view replaces controls + ledger; header stays', e.ctrls === 0 && e.rows === 4 && e.back === '‹ Back to picks', JSON.stringify(e));
    check('1e heads Date · Match · Pick · Posted · Close · CLV · Result · P/L, date ▼ active', e.heads.join('|') === 'Date ▼|Match|Pick|Posted|Close|CLV|Result|P/L' && e.on === 'Date ▼', e.heads.join('|'));
    check('1e meta "Last 30 d · settled picks only · 4 rows"', e.meta === 'Last 30 d · settled picks only · 4 rows', e.meta);
    check('1e total row repeats the thin strip (dashes, with the count)', e.total === 'Total 4 settled · Last 30 d — — —', e.total);
    const so = await R(`q('.pk-lh:nth-child(6)').click(); const a1 = qa('.pk-lr .pk-lclv').map(txt); const on = txt(q('.pk-lh.on')); q('.pk-lh:nth-child(6)').click(); const a2 = qa('.pk-lr .pk-lclv').map(txt);
      q('.pk-back').click(); return { a1, a2, on, back: !!q('.pk-ctrl') };`);
    check('1e sort: a new head sorts descending, the same head flips', so.on === 'CLV ▼' && so.a1.join(' ') === '+1.9% +0.3% −1.8% −11.5%' && so.a2.join(' ') === '−11.5% −1.8% +0.3% +1.9%', JSON.stringify(so));
    check('1e back to picks restores the controls', so.back);
    const hov = await R(`set({}); return qa('.pk-per').map(b => b.title);`);
    check('period hover: Season = "1 January to today"', hov[2] === '1 January to today' && /30 days/.test(hov[0]) && /90 days/.test(hov[1]), JSON.stringify(hov));

    // the Picks count badge (SIDEBAR_NAV): today's posted + live bets on the Live count chip; hidden at 0
    const bd = await E(`(() => { const day = '2026-10-27', rows = PicksPage._state.fixture.picks; const n = PicksShell.todayCount(rows, day); PicksShell.setCount(n);
      const b = document.querySelector('#mainNav button[data-tab="picks"] .sf-ico .pk-count'); const o = { n, txt: b && b.textContent, chip: b && b.classList.contains('sf-count'), bg: b && getComputedStyle(b).backgroundColor };
      PicksShell.setCount(0); o.gone = !document.querySelector('#mainNav .pk-count'); return o; })()`);
    check('count badge: 5 bets today (posted + live, settled not counted) on the Live chip (#007AFF); gone at 0', bd.n === 5 && bd.txt === '5' && bd.chip && bd.bg === 'rgb(0, 122, 255)' && bd.gone, JSON.stringify(bd));

    // ── the Post-a-pick drawer (admin). The store's writes are stubbed: nothing reaches Firestore.
    const DR = (js) => E(`(() => { const q = s => document.querySelector('#pkdOv ' + s), qa = s => [...document.querySelectorAll('#pkdOv ' + s)],
      txt = e => { if (!e) return null; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), out = []; let t; while ((t = w.nextNode())) { const v = t.nodeValue.replace(/\\s+/g, ' ').trim(); if (v) out.push(v); } return out.join(' '); },
      type = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
      click = sel => q(sel).click(), dis = sel => q(sel).getAttribute('aria-disabled') === 'true'; ${js} })()`);
    await E(`(() => { const t = Date.now() + 3 * 3600e3;
      window.__pkMatch = { id: 'upcoming-999001', date: new Date(t).toISOString().slice(0, 10), time: '20:30', startTs: new Date(t).toISOString(), p1: 'M. Berrettini', p2: 'T. M. Etcheverry',
        p1Key: 111, p2Key: 222, tour: 'ATP Vienna', tournamentRound: 'ATP Vienna - 1/16-finals', surface: 'hard', valueSnapshot: { fairP1: 0.58, fairP2: 0.42, ts: new Date().toISOString() } };
      matches.push(window.__pkMatch); window.__pkCalls = []; window.__pkAdminWas = window.isBspAdmin; window.isBspAdmin = () => true;
      PicksStore.post = (pick, opts) => { window.__pkCalls.push(['post', pick, opts]); return Promise.resolve('id1'); };
      PicksStore.edit = (id, patch) => { window.__pkCalls.push(['edit', id, patch]); return Promise.resolve(); };
      PicksStore.voidPick = (id, why) => { window.__pkCalls.push(['void', id, why]); return Promise.resolve(); };
      PicksStore.remove = (id) => { window.__pkCalls.push(['remove', id]); return Promise.resolve(); };
      PicksPage.reload = () => Promise.resolve(); })()`);
    // founder 2026-10-28/30: the admin posts from the Picks page only — "+ Post a pick" at the end of the tabs row, admin
    // only (on both tabs), opening the drawer on its match search. Mutant: the button drawn for every member.
    const pp = await R(`const was = PicksStore.isAdmin; set({ view: 'cards', tab: 'upcoming' });
      PicksStore.isAdmin = () => false; PicksPage.render(); const out = { member: qa('.pk-post').length };
      PicksStore.isAdmin = () => true; set({ tab: 'completed' }); out.done = qa('.pk-ctrl .pk-post').length; set({ tab: 'upcoming' }); const b = q('.pk-ctrl .pk-post'); out.admin = b ? txt(b) : null;
      out.last = b === q('.pk-ctrl').lastElementChild; out.bg = cs(b, 'backgroundColor'); out.h = cs(b, 'height'); out.r = cs(b, 'borderRadius');
      if (b) b.click(); const ov = document.getElementById('pkdOv');
      out.title = ov && ov.querySelector('.pkd-title') ? ov.querySelector('.pkd-title').textContent.trim() : null; out.search = !!(ov && ov.querySelector('#pkdQ'));
      if (window.PicksDrawer) PicksDrawer.close(); PicksStore.isAdmin = was; PicksPage.render(); return out;`);
    check('"+ Post a pick": admin only, last in the tabs row on both tabs, #007AFF 38 px r10, opens the drawer on its match search',
      pp.member === 0 && pp.done === 1 && pp.admin === 'Post a pick' && pp.last && pp.bg === 'rgb(0, 122, 255)' && pp.h === '38px' && pp.r === '10px' && pp.title === 'Post a pick' && pp.search, JSON.stringify(pp));
    const d1 = await DR(`PicksDrawer.openNew(window.__pkMatch); const a = { title: txt(q('.pkd-title')), meta: txt(q('.pkd-meta')), sels: qa('.pkd-selrow').length, on: txt(q('.pkd-selrow.on .pkd-seln')),
        typed: !!q('#pkdPrice'), manual: txt(q('.pkd-manual')), postOff: dis('[data-pkd="post"]'), chips: qa('[data-pkd="market"]').map(txt),
        ac: [q('#pkdPrice').getAttribute('autocomplete'), q('#pkdStake').getAttribute('autocomplete')] };
      type('#pkdPrice', '2.10'); type('#pkdStake', '1'); type('#pkdNote', 'Indoor serve edge.');
      a.hint = txt(q('.pkd-shint')); a.postOn = !dis('[data-pkd="post"]'); a.sum = txt(q('.pkd-sum-t')); a.pick = PicksDrawer._buildPick(); return a;`);
    check('1f drawer opens on the match: title, meta, two selection rows, the first player selected', d1.title === 'Post a pick' && /Hard Vienna Open R32/.test(d1.meta) && d1.sels === 2 && d1.on === 'M. Berrettini', JSON.stringify(d1).slice(0, 400));
    check('1f eleven market chips (CHANGES 10-29 §6)', d1.chips.length === 11, JSON.stringify(d1.chips));
    check('1f price + stake boxes are autocomplete="off" in the rendered drawer', d1.ac.join(',') === 'off,off', JSON.stringify(d1.ac));
    check('1f2 no feed price → a typed price tagged MANUAL; Post off until it is valid', d1.typed && d1.manual === 'MANUAL' && d1.postOff, JSON.stringify(d1).slice(0, 300));
    check('stake helper: "Wins → +1.1% · loses → −1% · at 2.10"; Post on', d1.hint === 'Wins → +1.1% · loses → −1% · at 2.10' && d1.postOn, d1.hint);
    check('"You post" summary', d1.sum === 'M. Berrettini to win @ 2.10 bet105 · 1%', d1.sum);
    const pk = d1.pick;
    check('the posted pick carries the match identity read from the board (event key + both player ids)', pk.kind === 'match' && pk.match_id === 999001 && pk.player_a.id === 111 && pk.player_b.id === 222
      && pk.player_a.name === 'M. Berrettini' && pk.tournament === 'Vienna Open' && pk.round === 'R32' && pk.surface === 'Hard' && /T/.test(pk.scheduled_at), JSON.stringify(pk));
    check('...the founder\'s fields only: selection, market, price (manual), stake, note; model % from the board snapshot', pk.selection === 'a' && pk.market === 'Match winner' && pk.line === null
      && pk.price_source === 'manual' && pk.posted_price === 2.1 && pk.stake === 1 && pk.note === 'Indoor serve edge.' && pk.model_pct === 58, JSON.stringify(pk));
    check('...no computed field leaves the browser (open / now / close / CLV / P/L / status / result)', ['open_price', 'now_price', 'opp_now_price', 'close_price', 'opp_close_price', 'clv', 'pl_pct', 'status', 'result', 'posted_at'].every(k => !(k in pk)), Object.keys(pk).join(','));
    // founder 2026-10-30: a typed market keeps the player clicked (the Michelsen pick was stored on his opponent); a typed
    // name that is a chip name selects that chip
    const TM = `PicksDrawer.openNew(window.__pkMatch); qa('[data-pkd="market"]').find(b => b.textContent === 'Total games').click(); type('#pkdMktCustom', 'Tiebreak');
      qa('.pkd-selrow')[1].click(); type('#pkdPrice', '2.40'); type('#pkdStake', '1');
      const o = { pick: PicksDrawer._buildPick(), sum: txt(q('.pkd-sum-t')), lbl: txt(q('.pkd-price .pkd-caps, .pkd-plbl')) };
      type('#pkdMktCustom', 'set betting'); o.chip = txt(q('[data-pkd="market"].on')); o.pick2 = PicksDrawer._buildPick(); PicksDrawer.close(); return o;`;
    const tm = await DR(TM);
    check('typed market: stored as Other + its text, on the player clicked (b), bet line "Etcheverry · Tiebreak"', tm.pick.market === 'Other' && tm.pick.market_text === 'Tiebreak' && tm.pick.selection === 'b' && /Etcheverry · Tiebreak/.test(tm.sum), JSON.stringify(tm).slice(0, 500));
    check('typed text that is a chip name selects that chip', tm.chip === 'Set betting' && tm.pick2.market === 'Set betting' && !tm.pick2.market_text, JSON.stringify([tm.chip, tm.pick2.market, tm.pick2.market_text]));
    const d2 = await DR(`PicksDrawer.openNew(window.__pkMatch); type('#pkdPrice', '2.10'); type('#pkdStake', '1'); click('[data-pkd="post"]'); return new Promise(r => setTimeout(() => r({ calls: window.__pkCalls.map(c => [c[0], c[2]]), open: PicksDrawer.isOpen() }), 50));`);
    check('Post pick → PicksStore.post(pick, not a draft) → the drawer closes', d2.calls.length === 1 && d2.calls[0][0] === 'post' && d2.calls[0][1].draft === false && !d2.open, JSON.stringify(d2));
    const d3 = await DR(`PicksDrawer.openNew(window.__pkMatch); type('#pkdStake', '12'); const bad = { hint: txt(q('.pkd-shint')), off: dis('[data-pkd="post"]') };
      [...document.querySelectorAll('#pkdOv [data-pkd="market"]')].find(b => b.textContent === 'Outright').click();
      const o = { sels: qa('.pkd-selrow').length, inputs: qa('.pkd-or input').length };
      type('#pkdStake', '2'); type('#pkdPrice', '3.50'); o.offNoEvent = dis('[data-pkd="post"]');
      type('#pkdOrEvent', 'Nitto ATP Finals · Turin'); type('#pkdOrSel', 'J. Sinner'); type('#pkdOrSettles', '16 Nov'); type('#pkdOrMarket', 'To win the tournament');
      o.on = !dis('[data-pkd="post"]'); o.pick = PicksDrawer._buildPick(); PicksDrawer.close(); return { bad, o };`);
    check('stake outside 0.1–10 → "Stake is % of bankroll, 0.1 to 10", Post off', d3.bad.hint === 'Stake is % of bankroll, 0.1 to 10' && d3.bad.off, JSON.stringify(d3.bad));
    check('1f3 Outright: no match, no players; four typed fields; Post only with event + selection', d3.o.sels === 0 && d3.o.inputs === 4 && d3.o.offNoEvent && d3.o.on, JSON.stringify(d3.o).slice(0, 300));
    check('1f3 outright pick: event, what wins, settles 16 Nov, typed price', d3.o.pick.kind === 'outright' && d3.o.pick.event === 'Nitto ATP Finals · Turin' && d3.o.pick.market_text === 'To win the tournament'
      && /^\d{4}-11-16$/.test(d3.o.pick.settles_at) && d3.o.pick.posted_price === 3.5 && d3.o.pick.player_b === null && d3.o.pick.price_source === 'manual', JSON.stringify(d3.o.pick));
    const d4 = await DR(`const p = { id: 'pk1', kind: 'match', status: 'posted', posted_at: new Date(Date.now() - 3 * 60000).toISOString(), posted_price: 2.02, stake: 1, note: 'n', book: 'bet105',
        selection: 'a', market: 'Match winner', line: null, tournament: 'Vienna Open', round: 'R32', surface: 'Hard', scheduled_at: new Date(Date.now() + 3600e3).toISOString(),
        player_a: { name: 'M. Berrettini', initials: 'MB' }, player_b: { name: 'T. M. Etcheverry', initials: 'TE' } };
      PicksDrawer.openEdit(p); const e = { title: txt(q('.pkd-title')), ban: txt(q('.pkd-ban')), selOff: !!q('.pkd-sec.pkd-off .pkd-selrow') };
      type('#pkdStake', '1.5'); click('[data-pkd="save"]');
      return new Promise(r => setTimeout(() => { const c = window.__pkCalls.slice(-1)[0]; PicksDrawer.openEdit(p); click('[data-pkd="voidask"]'); e.voidOff = dis('[data-pkd="dovoid"]');
        type('#pkdVoid', 'Wrong line posted'); click('[data-pkd="dovoid"]');
        setTimeout(() => r({ e, save: c, v: window.__pkCalls.slice(-1)[0] }), 50); }, 50));`);
    check('1g edit (founder 2026-10-30): "Edit pick", no time window in the banner, Void + Delete offered, selection locked', d4.e.title === 'Edit pick' && /note and stake/.test(d4.e.ban) && !/editable for|minute/.test(d4.e.ban) && /Void pick…/.test(d4.e.ban) && /Delete pick…/.test(d4.e.ban) && d4.e.selOff, JSON.stringify(d4.e));
    check('1g Save changes → PicksStore.edit(id, { stake, note }) only', d4.save[0] === 'edit' && d4.save[1] === 'pk1' && JSON.stringify(Object.keys(d4.save[2]).sort()) === '["note","stake"]' && d4.save[2].stake === 1.5, JSON.stringify(d4.save));
    check('1g Void pick… needs a reason → PicksStore.voidPick(id, reason)', d4.e.voidOff && d4.v[0] === 'void' && d4.v[1] === 'pk1' && d4.v[2] === 'Wrong line posted', JSON.stringify(d4.v));
    const d5 = await DR(`PicksDrawer.openEdit({ id: 'pk2', kind: 'match', status: 'won', posted_at: new Date(Date.now() - 2 * 86400e3).toISOString(), posted_price: 2.02, stake: 1, note: 'n',
        selection: 'b', market: 'Other', market_text: 'Tiebreak', player_a: { name: 'B. Vacherot' }, player_b: { name: 'A. Michelsen' } });
      const f = { title: txt(q('.pkd-title')), stakeOff: q('#pkdStake').disabled, save: !!q('[data-pkd="save"]'), body: txt(document.getElementById('pkdOv')),
        noteMax: q('#pkdNote').getAttribute('maxlength') };
      const long = 'x'.repeat(3000); type('#pkdNote', long); f.count = txt(q('.pkd-count')); f.saveOn = !dis('[data-pkd="save"]'); click('[data-pkd="save"]');
      f.saved = (window.__pkCalls.slice(-1)[0] || [])[2]; f.savedLen = f.saved && f.saved.note.length;
      PicksDrawer.openEdit({ id: 'pk2', kind: 'match', status: 'won', posted_at: new Date(Date.now() - 2 * 86400e3).toISOString(), posted_price: 2.02, stake: 1, note: 'n',
        selection: 'b', market: 'Other', market_text: 'Tiebreak', player_a: { name: 'B. Vacherot' }, player_b: { name: 'A. Michelsen' } });
      click('[data-pkd="delask"]'); f.delAsk = txt(q('.pkd-acts')); click('[data-pkd="dodel"]'); f.del = window.__pkCalls.slice(-1)[0];
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.escClosed = !PicksDrawer.isOpen(); return f;`);
    check('1h (founder 2026-10-30) a settled pick two days old still opens "Edit pick" with stake and Save — no freeze', d5.title === 'Edit pick' && !d5.stakeOff && d5.save, JSON.stringify(d5).slice(0, 300));
    check('note has no limit: no maxlength, a 3,000-character note counts "3,000 characters", saves whole', d5.noteMax === null && d5.count === '3,000 characters' && d5.saveOn && d5.savedLen === 3000, JSON.stringify({ m: d5.noteMax, c: d5.count, on: d5.saveOn, n: d5.savedLen }));
    check('Delete pick… asks first, then PicksStore.remove(id) — delete, not void', /Delete pick/.test(d5.delAsk) && /Cancel/.test(d5.delAsk) && d5.del && d5.del[0] === 'remove' && d5.del[1] === 'pk2', JSON.stringify({ a: d5.delAsk, d: d5.del }));
    check('1h a frozen typed-market pick reads its market, never a dash ("Michelsen · Tiebreak")', /Michelsen · Tiebreak/.test(d5.body), d5.body);
    check('Esc closes the drawer (the one Esc handler)', d5.escClosed, JSON.stringify(d5).slice(0, 200));
    // MUTANT: the drawer reads the Total games side for a typed market (the Michelsen bug) — the typed-market check must go red
    const mutSrc = drawerSrc.replace("selection: D.market === 'Total games' && !D.marketCustom ?", "selection: D.market === 'Total games' ?");
    check('MUTANT caught: a typed market stored on the Total games side', mutSrc !== drawerSrc && await (async () => {
      await E(`(0, eval)(${JSON.stringify(mutSrc)}); 1`); const m = await DR(TM); await E(`(0, eval)(${JSON.stringify(drawerSrc)}); 1`); return m.pick.selection !== 'b'; })());
    await E(`(() => { window.isBspAdmin = window.__pkAdminWas; matches.splice(matches.indexOf(window.__pkMatch), 1); })()`);

    // 1j · mobile 390: the mobile card
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await new Promise(r => setTimeout(r, 300));
    const mo = await R(`window.__pkPlan = 'pro'; set({ tab: 'upcoming', view: 'cards', sheet: null }); return { m: qa('.pk-card--m').length, bands: qa('.pk-band').length, star: qa('.pk-card--m .pk-star').length,
        panel: cs(q('[data-card="p1"] .pk-mpanel'), 'backgroundColor'), w: q('[data-card="p1"]').getBoundingClientRect().width, scroll: document.documentElement.scrollWidth };`);
    check('1j mobile: one card per bet, no bands, no star; inner panel = --inner-band #0D1017', mo.m === 5 && mo.bands === 0 && mo.star === 0 && mo.panel === 'rgb(13, 16, 23)', JSON.stringify(mo));
    check('1j mobile: card fits 390 with a 16 px gutter', Math.abs(mo.w - 358) < 1, mo.w);
    check('1j mobile: no horizontal page scroll at 390', mo.scroll <= 390, mo.scroll);
    await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 1, mobile: false });

    const own = errors.filter(x => /picks-(core|page)/.test(x));
    check('no exceptions from picks-core.js / picks-page.js', own.length === 0, own.join('\n'));
  } finally { done(); }
}
