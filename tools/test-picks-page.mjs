#!/usr/bin/env node
// Picks page (read-only) in a real headless Chrome, on the site's CODE set (tools/site-code.sh → a temp dir, so a file
// missing from the deploy list fails here too): #picks route, boards 1a / 1b / 1c / 1d / 1e / 1i / 1j states from
// the demo fixture (tools/fixtures/picks-demo.json, injected — real picks live in Firestore), gating, the analysis toggle, the Record view, the four empty strings, tab switch keeping tournament + date,
// the mobile card, and the controls row = the landed Today's Matches shell (computed-style parity, with a negative
// control that must break it). No Chrome (CHROME_BIN unset and none found) → a loud SKIP, never a pass.
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
    await E(`PicksPage._inject(${FIXTURE})`);
    const R = (js) => E(`(() => { const S = PicksPage._state, q = s => document.querySelector('#picksRoot ' + s), qa = s => [...document.querySelectorAll('#picksRoot ' + s)],
      txt = e => { if (!e) return null; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), out = []; let t; while ((t = w.nextNode())) { const v = t.nodeValue.replace(/\\s+/g, ' ').trim(); if (v) out.push(v); } return out.join(' '); }, cs = (e, p) => e ? getComputedStyle(e)[p] : null;
      const set = (o) => { Object.assign(S, o); PicksPage.render(); }; ${js} })()`);

    // The plan arrives late (the auth paint calls sfPlanLocks on every auth change): a plan change must re-render the page.
    // One synchronous evaluation, so the real auth paint cannot interleave. (Gate run 40506098717: a late paint reset
    // window.sfPlan between two steps of this test — the page itself never re-rendered for it.)
    const pc = await E(`(() => { const blur = () => document.querySelectorAll('#picksRoot .pk-players.is-blur').length;
      PicksPage._state.tab = 'upcoming'; PicksPage._state.day = PicksPage._state.fixture.as_of_day; PicksPage._state.view = 'cards';
      window.sfPlanLocks({ plan: 'free' }); const free = blur(); window.sfPlanLocks({ plan: 'pro' }); const pro = blur();
      window.sfPlanLocks(null); const out = blur(); return { free, pro, out }; })()`);
    check('a plan change re-renders: Free → 5 blurred, Pro → 0, signed out → 5', pc.free === 5 && pc.pro === 0 && pc.out === 5, JSON.stringify(pc));
    // From here every scenario sets its own plan; pin it so a late auth paint cannot change it mid-test.
    await E(`(() => { window.__pkPlan = null; Object.defineProperty(window, 'sfPlan', { configurable: true, get() { return window.__pkPlan; }, set() {} }); })()`);

    check('#picks opens the Picks tab page', await E(`[...document.querySelectorAll('.tabpage.active')].map(p => p.dataset.page).join(',')`) === 'picks');
    check('#picks lights the Picks rail row', await E(`(document.querySelector('#mainNav button.active') || {}).dataset?.tab === 'picks'`));
    // a click on the rail row from another page opens Picks and writes #picks; a click elsewhere clears it
    const nav = await E(`(() => { document.querySelector('#mainNav button[data-tab="matches"]').click(); const a = [location.hash, document.querySelector('.tabpage.active').dataset.page];
      document.querySelector('#mainNav button[data-tab="picks"]').click(); const b = [location.hash, document.querySelector('.tabpage.active').dataset.page]; return { a, b }; })()`);
    check('rail: Picks row opens Picks with #picks; leaving clears it', nav.a[0] !== '#picks' && nav.a[1] === 'matches' && nav.b[0] === '#picks' && nav.b[1] === 'picks', JSON.stringify(nav));

    // 1a · Today with picks (Pro)
    const a = await R(`window.__pkPlan = 'pro'; set({ tab: 'upcoming', day: S.fixture.as_of_day, view: 'cards', tourn: null, q: '', noteOpen: {} });
      return { title: txt(q('.sfh__title')), sub: txt(q('.sfh__sub')), cards: qa('.pk-card').length, box: txt(q('.pk-box-hd .pk-caps')), meta: txt(q('.pk-box-meta')), rows: qa('.pk-bx-row').length,
        blur: qa('.is-blur').length, chip0: txt(q('.pk-card .pk-hd-r .pk-tag')), days: qa('.pk-day').map(txt), on: txt(q('.pk-day.on')), tabs: qa('.pk-tab').map(txt),
        p1trail: txt(q('[data-card="p1"] .pk-trail')), p2label: txt(q('[data-card="p2"] .pk-trail .pk-tl:nth-of-type(3)')), p2tl: qa('[data-card="p2"] .pk-tl').map(txt),
        meta1: txt(q('[data-card="p1"] .pk-meta')), fav: qa('[data-card="p1"] .pk-fav').length, favName: txt(q('[data-card="p1"] .pk-pl:nth-child(2) .pk-name')),
        orRight: txt(q('[data-card="o1"] .pk-or')), orHead: txt(q('[data-card="o1"] .pk-hd')), noteShown: qa('.pk-note').length, cardW: q('.pk-card').getBoundingClientRect().width,
        settled: txt(q('.pk-settled')), settledC: cs(q('.pk-settled'), 'color'), recVals: qa('.pk-rv').map(txt) }; `);
    check('1a header copy', a.title === 'Picks' && a.sub === 'Hand-picked daily from the Stennisfy model and strategy.', JSON.stringify(a));
    check('1a five cards, bets box "Today · 5 bets", five rows', a.cards === 5 && a.box === 'Today · 5 bets' && a.rows === 5, JSON.stringify(a));
    check('1a bets box meta', a.meta === '5% staked · 2 outright · posted time · line @ bet105 price · stake', a.meta);
    check('1a Pro: nothing blurred', a.blur === 0, a.blur);
    check('1a date strip = today−2 … today+1, Today selected', a.days.join('|') === 'Sun 25|Mon 26|Today|Wed 28' && a.on === 'Today', a.days.join('|'));
    check('1a tabs Upcoming · Completed', a.tabs.join('|') === 'Upcoming|Completed');
    check('1a posted card: Open → Posted → Now → Close, close dashed', a.p1trail === '1.95 2.02 2.10 — Open Posted Now Close', a.p1trail);
    check('1a live card labels Now as Last', a.p2tl.join('|') === 'Open|Posted|Last|Close', a.p2tl.join('|'));
    check('1a meta line CLV — · Stennisfy 1.72 · Stake 1%', a.meta1 === 'CLV — · Stennisfy 1.72 · Stake 1%', a.meta1);
    check('1a FAV on the lower current price (Etcheverry)', a.fav === 1 && /Etcheverry/.test(a.favName), JSON.stringify([a.fav, a.favName]));
    check('1a outright: no trail, settles line, no surface/round/time', /Posted 08:50 · bet105 · Stake 0.5%/.test(a.orRight) && /Settles 16 Nov · no open \/ now \/ close for outrights/.test(a.orRight)
      && !/Hard|R32|:\d\d$/.test(a.orHead.replace(/POSTED \d\d:\d\d/, '')), a.orRight + ' | ' + a.orHead);
    check('1a analysis hidden until opened', a.noteShown === 0);
    check('1a card is 664 px at 1512', Math.abs(a.cardW - 664) < 0.6, a.cardW);
    check('1a thin record: four dashes, n=4 · thin in amber', a.recVals.slice(0, 4).join('') === '————' && /^n=4 · thin/.test(a.settled) && a.settledC === 'rgb(232, 168, 78)', JSON.stringify([a.recVals, a.settledC]));

    const n = await R(`window.__pkPlan = 'pro'; set({}); q('[data-card="p3"] .pk-toggle').click(); return { note: txt(q('[data-card="p3"] .pk-note')), cue: txt(q('[data-card="p3"] .pk-toggle')),
      ws: cs(q('[data-card="p3"] .pk-note'), 'whiteSpace') };`);
    check('analysis opens with the full note, "Hide analysis"', /^I’m going for Cobolli here\./.test(n.note) && /For me that drop is justified/.test(n.note) && /^Hide analysis/.test(n.cue) && n.ws === 'pre-line', JSON.stringify(n).slice(0, 300));

    // 1d · non-Pro
    const d = await R(`window.__pkPlan = 'free'; set({ noteOpen: {} });
      return { blurredCards: qa('.pk-card').filter(c => c.querySelector('.pk-players.is-blur') && c.querySelector('.pk-right.is-blur')).length,
        headBlur: qa('.pk-hd.is-blur, .pk-foot.is-blur, .pk-hd .is-blur').length, unlock: qa('.pk-unlock').map(txt), toggles: qa('.pk-toggle').length,
        boxBlur: qa('.pk-bx-line.is-blur').length + qa('.pk-bx-price.is-blur').length, filter: cs(q('.pk-players.is-blur'), 'filter'), sel: cs(q('.pk-players.is-blur'), 'userSelect') };`);
    check('1d non-Pro: every posted/live card blurs the player block and right column', d.blurredCards === 5, JSON.stringify(d));
    check('1d header, chips and footer stay readable', d.headBlur === 0, d.headBlur);
    check('1d footer = PRO + "Unlock today’s picks →", no analysis toggle', d.unlock.length === 5 && d.unlock.every(t => t === 'PRO Unlock today’s picks →') && d.toggles === 0, JSON.stringify(d.unlock));
    check('1d bets box line + price blurred', d.boxBlur === 10, d.boxBlur);
    check('1d blur = blur(5px), no select', d.filter === 'blur(5px)' && d.sel === 'none', d.filter + ' ' + d.sel);

    // 1c · Completed, Mon 26 (non-Pro still: settled is never blurred)
    const c = await R(`set({ tab: 'completed', day: '2026-10-26' });
      return { cards: qa('.pk-card').length, blur: qa('.is-blur').length, box: txt(q('.pk-box-hd .pk-caps')), meta: txt(q('.pk-box-meta')), heads: qa('.pk-bx-heads span').map(txt),
        res: qa('.pk-bx-res').map(txt), chips: qa('.pk-card .pk-hd-r').map(txt), lostBg: cs(q('[data-card="s2"]'), 'backgroundColor'), lostDim: cs(q('[data-card="s2"] .pk-body'), 'opacity'),
        wonDim: cs(q('[data-card="s1"] .pk-body'), 'opacity'), tl: qa('[data-card="s1"] .pk-tl').map(txt), cells: qa('[data-card="s4"] .pk-pl:first-child .pk-set').map(e => e.classList.contains('is-won') ? 'W' : 'l').join(''),
        tb: qa('[data-card="s4"] .pk-tb').map(txt).join(','), voidCells: qa('[data-card="s3"] .pk-set.is-won').length, s2loser: cs(q('[data-card="s2"] .pk-pl:nth-child(2) .pk-name'), 'fontWeight'),
        s2win: cs(q('[data-card="s2"] .pk-pl:first-child .pk-name'), 'fontWeight'), rightCol: q('[data-card="s1"] .pk-right').getBoundingClientRect().width };`);
    check('1c four settled cards, never blurred (non-Pro)', c.cards === 4 && c.blur === 0, JSON.stringify(c));
    check('1c bets box "Mon 26 · settled · 4 bets", meta 2–1 · 1 void · 4.5% staked', c.box === 'Mon 26 · settled · 4 bets' && c.meta === '2–1 · 1 void · 4.5% staked', c.box + ' | ' + c.meta);
    check('1c caps head row Type · Bet · Price · Stake · Result', c.heads.join('|') === 'Type|Bet|Price|Stake|Result');
    check('1c WON / LOST / VOID chips, P/L beside them', c.res.join('|') === 'WON|LOST|VOID|WON' && c.chips.join('|') === '+0.88% WON|−1% LOST|0% VOID|+1.05% WON', c.chips.join('|'));
    check('1c lost card = --lost-card #0E1119, lost/void body at 0.78', c.lostBg === 'rgb(14, 17, 25)' && c.lostDim === '0.78' && c.wonDim === '1', JSON.stringify([c.lostBg, c.lostDim, c.wonDim]));
    check('1c settled trail = Open · Posted · Close, column 224', c.tl.join('|') === 'Open|Posted|Close' && Math.abs(c.rightCol - 224) < 0.6, JSON.stringify([c.tl, c.rightCol]));
    check('1c set cells coloured per set, tiebreak on the winner\'s cell', c.cells === 'lWlWW' && c.tb === '3,8', c.cells + ' ' + c.tb);
    check('1c retired set: no cell won', c.voidCells === 0);
    check('1c settled weights: winner 800, loser 600', c.s2win === '800' && c.s2loser === '600', c.s2win + '/' + c.s2loser);

    // the four empty strings (1b manufactured: Today with no picks)
    const em = await R(`const out = {}; const keep = S.fixture.picks;
      set({ tab: 'upcoming', day: S.fixture.as_of_day }); S.fixture.picks = []; PicksPage.render(); out.today = [txt(q('.pk-empty')), qa('.pk-unlock').length, qa('.pk-box').length];
      S.fixture.picks = keep; set({ tab: 'completed', day: S.fixture.as_of_day }); out.done = txt(q('.pk-empty'));
      set({ tab: 'upcoming', day: '2026-10-28' }); out.future = txt(q('.pk-empty'));
      set({ tab: 'completed', day: '2026-10-25' }); out.past = txt(q('.pk-empty')); return out;`);
    check('1b empty today: only "No bets posted yet today", no upsell, no box', em.today[0] === 'No bets posted yet today' && em.today[1] === 0 && em.today[2] === 0, JSON.stringify(em.today));
    check('empty: completed today', em.done === 'No bets settled yet today. Today’s picks are under Upcoming until their match ends.', em.done);
    check('empty: future day', em.future === 'No bets posted yet for Wed 28.', em.future);
    check('empty: other past day', em.past === 'No bets this day.', em.past);

    // tab switch keeps tournament + date
    const tk = await R(`window.__pkPlan = 'pro'; set({ tab: 'upcoming', day: S.fixture.as_of_day, tourn: null }); q('.pk-tpill').click(); const opts = qa('.pk-topt').map(txt);
      qa('.pk-topt').find(b => txt(b) === 'Vienna Open').click(); const n1 = qa('.pk-card').length; q('.pk-tab:not(.on)').click();
      return { opts, n1, tab: S.tab, tourn: S.tourn, day: S.day, pill: txt(q('.pk-tpill')) };`);
    check('tournament menu lists the day\'s tournaments; Vienna Open filters to 1', tk.opts[0] === 'All tournaments' && tk.opts.includes('Vienna Open') && tk.n1 === 1, JSON.stringify(tk));
    check('tab switch keeps tournament + date', tk.tab === 'completed' && tk.tourn === 'Vienna Open' && tk.day === '2026-10-27' && tk.pill === 'Vienna Open', JSON.stringify(tk));
    const sr = await R(`set({ tab: 'upcoming', tourn: null, q: 'cobol' }); const n = qa('.pk-card').length; set({ q: '' }); return n;`);
    check('search finds players (Cobolli: 2 picks)', sr === 2, sr);

    // 1e · Record view
    const e = await R(`set({ view: 'cards' }); q('.pk-recstats').click();
      return { rows: qa('.pk-lr').length, heads: qa('.pk-lh').map(txt), meta: txt(q('.pk-rmeta')), first: txt(q('.pk-lr')), total: txt(q('.pk-lt')), ctrls: qa('.pk-row1').length,
        on: txt(q('.pk-lh.on')), back: txt(q('.pk-back')) };`);
    check('1e Record view replaces controls + cards; header stays', e.ctrls === 0 && e.rows === 4 && e.back === '‹ Back to picks', JSON.stringify(e));
    check('1e heads Date · Match · Pick · Posted · Close · CLV · Result · P/L, date ▼ active', e.heads.join('|') === 'Date ▼|Match|Pick|Posted|Close|CLV|Result|P/L' && e.on === 'Date ▼', e.heads.join('|'));
    check('1e meta "Last 30 d · settled picks only · 4 rows"', e.meta === 'Last 30 d · settled picks only · 4 rows', e.meta);
    check('1e row: date · match · pick · prices · CLV · result · P/L', e.first.startsWith('26 Oct') && /M?\w/.test(e.first), e.first);
    check('1e total row repeats the thin strip (dashes, with the count)', e.total === 'Total 4 settled · Last 30 d — — —', e.total);
    const so = await R(`q('.pk-lh:nth-child(6)').click(); const a1 = qa('.pk-lr .pk-lclv').map(txt); const on = txt(q('.pk-lh.on')); q('.pk-lh:nth-child(6)').click(); const a2 = qa('.pk-lr .pk-lclv').map(txt);
      q('.pk-back').click(); return { a1, a2, on, back: !!q('.pk-row1') };`);
    check('1e sort: a new head sorts descending, the same head flips', so.on === 'CLV ▼' && so.a1.join(' ') === '+1.9% +0.3% −1.8% −11.5%' && so.a2.join(' ') === '−11.5% −1.8% +0.3% +1.9%', JSON.stringify(so));
    check('1e back to picks restores the controls', so.back);

    // controls = the Picks reference (founder ruling 2026-10-27: design wins on every visual — drawn to the export, not
    // the landed Matches shell). Values read from the reference's inline styles; a negative control must break the check.
    const REFV = `const want = {
        'tabs track': ['.pk-tabs', { backgroundColor: 'rgb(23, 27, 40)', borderTopWidth: '0px', borderRadius: '10px', paddingTop: '3px', columnGap: '3px' }],
        'tab on': ['.pk-tab.on', { backgroundColor: 'rgb(27, 32, 49)', borderTopColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '8px', paddingTop: '7px', paddingLeft: '14px', fontSize: '12.5px', fontWeight: '700' }],
        'tab off': ['.pk-tab:not(.on)', { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(163, 170, 190)', fontWeight: '600' }],
        'chevron': ['.pk-chev', { backgroundColor: 'rgb(23, 27, 40)', borderRadius: '8px', width: '30px', height: '30px', fontSize: '14px', color: 'rgb(163, 170, 190)' }],
        'day on': ['.pk-day.on', { borderBottomWidth: '2px', paddingTop: '8px', paddingRight: '12px', paddingBottom: '9px', fontSize: '13.5px', fontWeight: '700' }],
        'day off': ['.pk-day:not(.on)', { color: 'rgb(163, 170, 190)', fontWeight: '600', borderBottomColor: 'rgba(0, 0, 0, 0)' }],
        'tournament pill': ['.pk-tpill', { backgroundColor: 'rgb(23, 27, 40)', borderTopWidth: '0px', borderRadius: '10px', paddingTop: '9px', paddingLeft: '16px', fontSize: '12.5px', fontWeight: '600', color: 'rgb(163, 170, 190)' }],
        'search box': ['.pk-search', { backgroundColor: 'rgb(23, 27, 40)', borderTopWidth: '0px', borderRadius: '10px', paddingTop: '10px', paddingLeft: '14px', columnGap: '9px', fontSize: '13px' }] };
      const diffs = []; let n = 0;
      for (const [name, [sel, props]] of Object.entries(want)) { const el = q(sel); if (!el) { diffs.push(name + ': missing'); continue; }
        const c = getComputedStyle(el); for (const [k, v] of Object.entries(props)) { n++; if (c[k] !== v) diffs.push(name + ' ' + k + ': ' + c[k] + ' ≠ ' + v); } }
      const h1 = q('.pk-tabs').getBoundingClientRect().height, h2 = q('.pk-search').getBoundingClientRect().height;
      return { n, diffs, h1, h2, fonts: document.fonts.check('12.5px "Hanken Grotesk"') && document.fonts.check('13px "Hanken Grotesk"') };`;
    await E(`Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 8000))]).then(() => 1)`);
    const rv = await R(`set({ view: 'cards', tab: 'upcoming', day: S.fixture.as_of_day }); ${REFV}`);
    check(`controls row = the reference's values (${rv.n} computed properties)`, rv.n >= 40 && rv.diffs.length === 0, rv.diffs.join('\n        '));
    // heights are font metrics: measured on the reference with Hanken Grotesk loaded (tabs track 38.5, search 37)
    if (!rv.fonts) console.log('  SKIP  controls heights: Hanken Grotesk did not load (no network for Google Fonts) — said out loud, not a pass');
    else check('controls heights = the reference (tabs track 38.5, search 37)', Math.abs(rv.h1 - 38.5) < 0.6 && Math.abs(rv.h2 - 37) < 0.6, JSON.stringify([rv.h1, rv.h2]));
    const ctl = await R(`const st = document.createElement('style'); st.id = 'pk-neg'; st.textContent = '[data-page="picks"] .pk-tabs{ background:var(--card); border:1px solid var(--edge-6) } [data-page="picks"] .pk-tab.on{ background:var(--inner) }'; document.head.appendChild(st);
      const r = (() => { ${REFV} })(); st.remove(); return r;`);
    check('negative control: the landed Matches shell values break the check', ctl.diffs.some(x => /tabs track backgroundColor/.test(x)) && ctl.diffs.some(x => /tab on backgroundColor/.test(x)), JSON.stringify(ctl.diffs));
    const hov = await R(`set({}); return qa('.pk-per').map(b => b.title);`);
    check('period hover: Season = "1 January to today"', hov[2] === '1 January to today' && /30 days/.test(hov[0]) && /90 days/.test(hov[1]), JSON.stringify(hov));

    // ── Task 2: the Post-a-pick drawer (admin) and "+ Pick" (board 1k). The store's writes are stubbed: nothing reaches Firestore.
    const DR = (js) => E(`(() => { const q = s => document.querySelector('#pkdOv ' + s), qa = s => [...document.querySelectorAll('#pkdOv ' + s)],
      txt = e => { if (!e) return null; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), out = []; let t; while ((t = w.nextNode())) { const v = t.nodeValue.replace(/\\s+/g, ' ').trim(); if (v) out.push(v); } return out.join(' '); },
      type = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
      click = sel => q(sel).click(), dis = sel => q(sel).getAttribute('aria-disabled') === 'true'; ${js} })()`);
    await E(`(() => { const t = Date.now() + 3 * 3600e3;
      window.__pkMatch = { id: 'upcoming-999001', date: new Date(t).toISOString().slice(0, 10), time: '20:30', startTs: new Date(t).toISOString(), p1: 'M. Berrettini', p2: 'T. M. Etcheverry',
        p1Key: 111, p2Key: 222, tour: 'ATP Vienna', tournamentRound: 'ATP Vienna - 1/16-finals', surface: 'hard', valueSnapshot: { fairP1: 0.58, fairP2: 0.42, ts: new Date().toISOString() } };
      matches.push(window.__pkMatch); window.__pkAdminWas = window.isBspAdmin; window.__pkCalls = [];
      PicksStore.post = (pick, opts) => { window.__pkCalls.push(['post', pick, opts]); return Promise.resolve('id1'); };
      PicksStore.edit = (id, patch) => { window.__pkCalls.push(['edit', id, patch]); return Promise.resolve(); };
      PicksStore.voidPick = (id, why) => { window.__pkCalls.push(['void', id, why]); return Promise.resolve(); };
      PicksPage.reload = () => Promise.resolve(); })()`);
    check('"+ Pick" is not drawn for a non-admin', await E(`(window.isBspAdmin = () => false, pkPlusHtml(window.__pkMatch)) === ''`));
    const plus = await E(`(() => { window.isBspAdmin = () => true; return { up: pkPlusHtml(window.__pkMatch), done: pkPlusHtml(Object.assign({}, window.__pkMatch, { finalScore: { winner: 'p1' } })) }; })()`);
    check('"+ Pick" for the admin on an upcoming match only', /class="pk-plus"/.test(plus.up) && />\+<\/span>Pick</.test(plus.up) && plus.done === '', JSON.stringify(plus));
    const d1 = await DR(`PicksDrawer.openNew(window.__pkMatch); const a = { title: txt(q('.pkd-title')), meta: txt(q('.pkd-meta')), sels: qa('.pkd-selrow').length, on: txt(q('.pkd-selrow.on .pkd-seln')),
        typed: !!q('#pkdPrice'), manual: txt(q('.pkd-manual')), postOff: dis('[data-pkd="post"]') };
      type('#pkdPrice', '2.10'); type('#pkdStake', '1'); type('#pkdNote', 'Indoor serve edge.');
      a.hint = txt(q('.pkd-shint')); a.postOn = !dis('[data-pkd="post"]'); a.sum = txt(q('.pkd-sum-t')); a.pick = PicksDrawer._buildPick(); return a;`);
    check('1f drawer opens on the match: title, meta, two selection rows, the first player selected', d1.title === 'Post a pick' && /Hard Vienna Open R32/.test(d1.meta) && d1.sels === 2 && d1.on === 'M. Berrettini', JSON.stringify(d1).slice(0, 400));
    check('1f2 no feed price → a typed price tagged MANUAL; Post off until it is valid', d1.typed && d1.manual === 'MANUAL' && d1.postOff, JSON.stringify(d1).slice(0, 300));
    check('stake helper: "Wins → +1.1% · loses → −1% · at 2.10"; Post on', d1.hint === 'Wins → +1.1% · loses → −1% · at 2.10' && d1.postOn, d1.hint);
    check('"You post" summary', d1.sum === 'M. Berrettini to win @ 2.10 bet105 · 1%', d1.sum);
    const pk = d1.pick;
    check('the posted pick carries the match identity read from the board (event key + both player ids)', pk.kind === 'match' && pk.match_id === 999001 && pk.player_a.id === 111 && pk.player_b.id === 222
      && pk.player_a.name === 'M. Berrettini' && pk.tournament === 'Vienna Open' && pk.round === 'R32' && pk.surface === 'Hard' && /T/.test(pk.scheduled_at), JSON.stringify(pk));
    check('...the founder\'s fields only: selection, market, price (manual), stake, note; model % from the board snapshot', pk.selection === 'a' && pk.market === 'Match winner' && pk.line === null
      && pk.price_source === 'manual' && pk.posted_price === 2.1 && pk.stake === 1 && pk.note === 'Indoor serve edge.' && pk.model_pct === 58, JSON.stringify(pk));
    check('...no computed field leaves the browser (open / now / close / CLV / P/L / status / result)', ['open_price', 'now_price', 'opp_now_price', 'close_price', 'opp_close_price', 'clv', 'pl_pct', 'status', 'result', 'posted_at'].every(k => !(k in pk)), Object.keys(pk).join(','));
    const d2 = await DR(`click('[data-pkd="post"]'); return new Promise(r => setTimeout(() => r({ calls: window.__pkCalls.map(c => [c[0], c[2]]), open: PicksDrawer.isOpen() }), 50));`);
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
      PicksDrawer.openEdit(p); const e = { title: txt(q('.pkd-title')), ban: txt(q('.pkd-ban')), lock: txt(q('.pkd-sec .pkd-caps')), selOff: !!q('.pkd-sec.pkd-off .pkd-selrow') };
      type('#pkdStake', '1.5'); click('[data-pkd="save"]');
      return new Promise(r => setTimeout(() => { const c = window.__pkCalls.slice(-1)[0]; PicksDrawer.openEdit(p); click('[data-pkd="voidask"]'); e.voidOff = dis('[data-pkd="dovoid"]');
        type('#pkdVoid', 'Wrong line posted'); click('[data-pkd="dovoid"]');
        setTimeout(() => r({ e, save: c, v: window.__pkCalls.slice(-1)[0] }), 50); }, 50));`);
    check('1g edit: "Edit pick", banner "editable for 7 more minutes · note and stake only", selection locked', d4.e.title === 'Edit pick' && /editable for 7 more minutes · note and stake only/.test(d4.e.ban) && d4.e.selOff, JSON.stringify(d4.e));
    check('1g Save changes → PicksStore.edit(id, { stake, note }) only', d4.save[0] === 'edit' && d4.save[1] === 'pk1' && JSON.stringify(Object.keys(d4.save[2]).sort()) === '["note","stake"]' && d4.save[2].stake === 1.5, JSON.stringify(d4.save));
    check('1g Void pick… needs a reason → PicksStore.voidPick(id, reason)', d4.e.voidOff && d4.v[0] === 'void' && d4.v[1] === 'pk1' && d4.v[2] === 'Wrong line posted', JSON.stringify(d4.v));
    const d5 = await DR(`PicksDrawer.openEdit({ id: 'pk2', kind: 'match', status: 'posted', posted_at: new Date(Date.now() - 20 * 60000).toISOString(), posted_price: 2.02, stake: 1, note: 'n',
        selection: 'a', market: 'Match winner', player_a: { name: 'A' }, player_b: { name: 'B' } });
      const f = { title: txt(q('.pkd-title')), line: txt(q('.pkd-frozen')), stakeOff: q('#pkdStake').disabled, save: !!q('[data-pkd="save"]') };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.escClosed = !PicksDrawer.isOpen(); return f;`);
    check('1h frozen after 10 min: "Pick · frozen", nothing can change, no Save', d5.title === 'Pick · frozen' && /nothing can change/.test(d5.line) && d5.stakeOff && !d5.save, JSON.stringify(d5));
    check('Esc closes the drawer (the one Esc handler)', d5.escClosed, JSON.stringify(d5));
    await E(`(() => { window.isBspAdmin = window.__pkAdminWas; matches.splice(matches.indexOf(window.__pkMatch), 1); })()`);

    // 1j · mobile 390
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await new Promise(r => setTimeout(r, 300));
    const mo = await R(`window.__pkPlan = 'pro'; set({ tab: 'upcoming', day: S.fixture.as_of_day, view: 'cards', tourn: null, q: '' }); const up = { m: qa('.pk-card--m').length, star: qa('.pk-card--m .pk-star').length,
        type: qa('.pk-card--m .pk-hd .pk-tag').filter(t => !/pk-chip--/.test(t.className)).length, panel: cs(q('[data-card="p1"] .pk-mpanel'), 'backgroundColor'), w: q('[data-card="p1"]').getBoundingClientRect().width,
        scroll: document.documentElement.scrollWidth };
      set({ tab: 'completed', day: '2026-10-26' }); const st = qa('[data-card="s1"] .pk-tl').map(txt); return { up, st };`);
    check('1j mobile card: no star, no type tag, inner panel = --inner-band #0D1017', mo.up.m === 5 && mo.up.star === 0 && mo.up.type === 0 && mo.up.panel === 'rgb(13, 16, 23)', JSON.stringify(mo));
    check('1j mobile: settled keeps the four-stop trail (Last)', mo.st.join('|') === 'Open|Posted|Last|Close', mo.st.join('|'));
    check('1j mobile: card fits 390 with a 16 px gutter', Math.abs(mo.up.w - 358) < 1, mo.up.w);
    check('1j mobile: no horizontal page scroll at 390', mo.up.scroll <= 390, mo.up.scroll);
    await send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 1, mobile: false });

    const own = errors.filter(x => /picks-(core|page)/.test(x));
    check('no exceptions from picks-core.js / picks-page.js', own.length === 0, own.join('\n'));
  } finally { done(); }
}
