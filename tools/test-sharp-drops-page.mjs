#!/usr/bin/env node
// Sharp drops page (beta, founder 2026-11-14; rules .claude/rules/sharp-drops.md) in a real headless Chrome, on the
// site's CODE set (tools/site-code.sh → a temp dir, so a file missing from the deploy list fails here too): the #sharp
// route, the beta gate, the founder's default rule on screen, the record filtered by the settings, saving, the Telegram
// link states. Fixture injected (the feed and the member's account are not reachable here). No Chrome → a loud SKIP.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  PASS ', name); } else { fail++; console.log('  FAIL ', name, detail ? '\n        ' + String(detail).slice(0, 400) : ''); } };

// ── wiring, no browser ──
const html = readFileSync(join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
check('dashboard links sharp-drops-page.css', html.includes('<link rel="stylesheet" href="./sharp-drops-page.css">'));
check('the core loads before the page', html.indexOf('<script src="sharp-drops-core.js" defer></script>') > 0
  && html.indexOf('<script src="sharp-drops-core.js" defer></script>') < html.indexOf('<script src="sharp-drops-page.js" defer></script>'));
check('a sharp tab page exists', html.includes('<div class="tabpage" data-page="sharp"><div id="sharpRoot"></div></div>'));
check('beta: no rail row (founder 2026-11-14: admins only, the #sharp link)', !/data-tab="sharp"/.test(html));
const pipe = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8'), pub = readFileSync(join(ROOT, 'tools/publish-site.mjs'), 'utf8'),
      sc = readFileSync(join(ROOT, 'tools/site-code.sh'), 'utf8');
for (const f of ['sharp-drops-core.js', 'sharp-drops-page.js', 'sharp-drops-page.css'])
  check(`${f} in all three code deploy lists`, (pipe.split(f).length - 1) >= 2 && pub.includes(`'${f}'`) && sc.includes(f));
const auth = readFileSync(join(ROOT, 'auth.js'), 'utf8');
check('auth.js stores sharpDrops cleaned by the core, never the bot’s link state', /updates\.sharpDrops = sd/.test(auth)
  && /SharpDropsCore\.normalize\(patch\.sharpDrops\.settings\)/.test(auth) && !/sd\.telegram\s*=/.test(auth));

const FIX = {
  user: { linkCode: 'SFY-ABC234', settings: {}, telegram: { linked: false } },
  feed: { generatedAt: '2026-11-14T10:00:00Z', alerts: [
    { id: 1, level: 'ATP', tournament: 'Testopen', player: 'Q. Halys', opponent: 'A. Fery', at: '2026-11-13T12:00:00Z', mins: 92, before: 1.70, price: 1.66, drop: 2.35, steps: 1, betAt: 1.755, kalshi: 1.72, close: 1.62, edge: 1.5, result: 'W', pl: 0.66 },
    { id: 2, level: 'CH', tournament: 'Testchall', player: 'C. Chall', opponent: 'H. Hall', at: '2026-11-13T11:00:00Z', mins: 40, before: 1.75, price: 1.70, drop: 2.86, steps: 2, betAt: 1.80, kalshi: null, close: 1.78, edge: -1.0, result: 'L', pl: -1 },
    { id: 3, level: 'ATP', tournament: 'Testopen', player: 'B. Big', opponent: 'D. Drop', at: '2026-11-13T10:00:00Z', mins: 60, before: 1.57, price: 1.50, drop: 4.46, steps: 3, betAt: 1.56, kalshi: null, close: null, edge: null, result: null, pl: null },
    { id: 4, level: 'ATP', tournament: 'Testopen', player: 'D. Dog', opponent: 'F. Fav', at: '2026-11-13T09:00:00Z', mins: 88, before: 2.40, price: 2.34, drop: 2.5, steps: 1, betAt: 2.45, kalshi: null, close: 2.30, edge: 2.0, result: 'L', pl: -1 },
    { id: 5, level: 'ITF', tournament: 'M25 Test', player: 'I. Itf', opponent: 'J. Jun', at: '2026-11-13T08:00:00Z', mins: 30, before: 1.64, price: 1.60, drop: 2.44, steps: 1, betAt: 1.70, kalshi: null, close: 1.55, edge: 3.0, result: 'W', pl: 0.6 }] }
};

const chrome = process.env.CHROME_BIN || ['/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) console.log('  SKIP  the browser checks: no Chrome (set CHROME_BIN) — said out loud, not a pass');
else await browser();
console.log(`sharp-drops-page: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

async function browser() {
  const SITE = mkdtempSync(join(tmpdir(), 'sharp-site-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'sharp-ch-'));
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
    await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.html*', resourceType: 'Document' }, { urlPattern: '*verify.html*', resourceType: 'Document' }] });
    await send('Page.navigate', { url: BASE + 'bsp-consult-dashboard.html#sharp' });
    const t0 = Date.now();
    while (!(await E(`!!window.SharpDropsPage && !!document.querySelector('#sharpRoot .sd-page')`).catch(() => false))) {
      if (Date.now() - t0 > 60000) throw new Error('the Sharp drops page never rendered');
      await new Promise(r => setTimeout(r, 300));
    }
    check('#sharp opens the sharp tab page', await E(`document.querySelector('.tabpage[data-page="sharp"]').classList.contains('active')`));
    check('signed out / not an admin: the beta message, no settings, no record', await E(`(() => { const t = document.getElementById('sharpRoot').textContent;
      return t.includes('in beta and not open yet') && !document.querySelector('#sharpRoot .sd-set') && !document.querySelector('#sharpRoot .sd-table'); })()`));
    await E(`SharpDropsPage._inject(${JSON.stringify(FIX)})`);
    const q = (js) => E(`(() => { const q = s => document.querySelector('#sharpRoot ' + s), qa = s => [...document.querySelectorAll('#sharpRoot ' + s)],
      pressed = s => qa(s + ' [aria-pressed="true"], ' + s + '[aria-pressed="true"]').map(b => b.textContent.trim()), rows = () => qa('.sd-table tbody tr').length,
      stat = l => { const s = qa('.sfh__stat').find(x => x.querySelector('.sfh__l').textContent === l); return s ? s.querySelector('.sfh__v').textContent : null; },
      click = (sel, txt) => { const b = qa(sel).find(x => x.textContent.trim().startsWith(txt)); b.click(); }; ${js} })()`);
    check('header: "Sharp drops"', await q(`return q('.sfh__title').textContent === 'Sharp drops'`));
    const def = await q(`return { lv: qa('.sd-chips [data-level][aria-pressed="true"]').map(b => b.dataset.level), drop: pressed('[data-seg="drop"]'),
      price: pressed('[data-seg="price"]'), win: pressed('[data-seg="window"]'), books: qa('[data-book][aria-pressed="true"]').map(b => b.dataset.book) }`);
    check('the founder default on screen: ATP + ATP Q + CH + CH Q, 2–3%, under 1.80, 3 h, Bet105 + Kalshi',
      JSON.stringify(def) === JSON.stringify({ lv: ['ATP', 'ATP Q', 'CH', 'CH Q'], drop: ['2–3%'], price: ['Under 1.80'], win: ['3 h'], books: ['Bet105', 'Kalshi'] }), JSON.stringify(def));
    check('books without a feed are disabled ("soon")', await q(`return qa('[data-book]:disabled').length === 5 && q('[data-book="Polymarket"]').textContent.includes('soon')`));
    check('the record shows only alerts that pass the settings (Halys, Chall — not the 4.5% drop, the 2.34 dog, the ITF)', await q(`return rows()`) === 2, await q(`return rows()`));
    check('header stats from the filtered rows: 2 alerts, 1 · 1, ROI −17.0%', await q(`return stat('Alerts') === '2' && stat('Won · Lost') === '1 · 1' && stat('ROI at Bet105') === '−17.0%'`),
      await q(`return [stat('Alerts'), stat('Won · Lost'), stat('ROI at Bet105')].join(' | ')`));
    check('a missing price is a dash, never 0 (Chall has no Kalshi price)', await q(`return qa('.sd-table tbody tr')[1].children[7].textContent === '—'`));
    check('Save is off until something changes', await q(`return q('[data-act="save"]').disabled`));
    await q(`click('[data-seg="price"] button', 'Any price')`);
    check('Any price → the 2.34 dog joins (3 rows), Save is on', await q(`return rows() === 3 && !q('[data-act="save"]').disabled`));
    await q(`click('[data-seg="drop"] button', '2% or more')`); await q(`q('[data-level="ITF"]').click()`);
    check('2% or more + ITF → all 5', await q(`return rows()`) === 5);
    await q(`q('[data-act="save"]').click()`);
    check('saving: Save goes off, "Saved." shown', await q(`return q('[data-act="save"]').disabled && q('[role="status"]').textContent.startsWith('Saved')`));
    await q(`q('[data-act="default"]').click()`);
    check('"Use the default rule" restores the founder default', await q(`return rows() === 2 && pressed('[data-seg="price"]')[0] === 'Under 1.80'`));
    check('the last level cannot be switched off (never an empty list)', await q(`['ATP','ATP Q','CH','CH Q'].forEach(l => q('[data-level="' + l + '"]').click());
      return qa('[data-level][aria-pressed="true"]').length === 1`));
    check('not linked: the link message with the member’s code', await q(`return q('#sdCode').textContent === '/start SFY-ABC234'`));
    await E(`SharpDropsPage._inject(Object.assign(${JSON.stringify(FIX)}, { user: { linkCode: 'SFY-ABC234', settings: {}, telegram: { linked: true, paused: false } } }))`);
    check('linked: "Linked." and no code', await q(`return q('.sd-state').textContent.startsWith('Linked.') && !q('#sdCode')`));
    await E(`SharpDropsPage._inject(Object.assign(${JSON.stringify(FIX)}, { user: { linkCode: 'SFY-ABC234', settings: {}, telegram: { linked: true, paused: true } } }))`);
    check('paused: says how to resume', await q(`return q('.sd-state').textContent.startsWith('Paused')`));
    await E(`SharpDropsPage._inject(Object.assign(${JSON.stringify(FIX)}, { feed: { generatedAt: '2026-11-14T10:00:00Z', alerts: [] } }))`);
    check('no alerts: a plain empty line, header dashes', await q(`return q('.sd-empty').textContent.startsWith('No alerts match') && stat('Won · Lost') === '—'`));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await E(`SharpDropsPage._inject(${JSON.stringify(FIX)})`);
    check('phone width: the page does not scroll sideways (the table scrolls in its own box)', await E(`document.querySelector('#sharpRoot .sd-page').scrollWidth <= document.querySelector('#sharpRoot .sd-page').clientWidth + 1`));
    check('no script errors on the page', !errors.filter(e => /sharp/i.test(e)).length, errors.join('\n'));
  } catch (e) { check('browser run', false, e.message); }
  finally { done(); }
}
