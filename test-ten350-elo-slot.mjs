// TEN-350 (TEN-312 follow-ups, founder bbe5c072 §2.4) — the Form and H2H rows' visible Elo slot, and names never cut.
// Drives the REAL code: the TEN-263 block is sliced out of bsp-consult-dashboard.html (TEN350_HTML overrides the file,
// for tools/test-ten350-mutants.js) and executed; the layout check renders that output in headless Chrome.
//   · wiring: the slot after the name shows the opponent's Elo AT THE MATCH DATE (ruling D-12), never the current Elo,
//     and a dash with the reason on hover when no snapshot qualifies — on both tabs
//   · layout: at the 1296 px viewport (Form / H2H section 936 px wide, measured on the deployed modal) a long real name
//     (Davidovich Fokina, Van De Zandschulp, Gueymard Wayenburg, Mpetshi Perricard) is never truncated
// Chrome: CHROME_BIN, else the macOS install, else `google-chrome` on PATH (the CI runner; live-probes.yml uses it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN350_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const HOUSE_RATINGS_SRC = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function sliceBlock() {
  const a = html.indexOf('/* =====================================================================\n   TEN-263 ');
  const b = html.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */');
  assert.ok(a > 0 && b > a, 'TEN-263 block not found between its sentinels');
  return html.slice(a, b);
}
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const HELPERS = ['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'maRoundName', 'eventKeyOfMatch'];
// The page's own code with its outside world stubbed (as test-ten263.mjs); `doc` = a document stub for node, '' in Chrome.
const code = doc => `${doc}
  const playerProfiles = {};
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){} function ensureFormRows(m){ return Promise.resolve(m); }
  function loadCareerHistory(){ return Promise.resolve([]); } function ensureStyleMeetings(m){ return Promise.resolve(m); }
  function ensurePsMatrix(){ return Promise.resolve(); } function ppStyleFor(){ return null; } function psArchFor(){ return null; }
  function styleMeetRowsFor(){ return []; } function openPlayerProfileFromMatch(){} function aGoTab(){}
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${HELPERS.map(slice).join('\n')}
  ${sliceBlock()}
  function buildFormSection(m){ return fhBuildForm(m); } function buildH2HSection(m){ return fhBuildH2H(m); }
  return { fhBuildForm, fhBuildH2H };`;
const S = new Function(code(`const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; },
    querySelectorAll(){ return []; }, head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };`))();

// ── fixtures: real long names; an Elo history whose LATEST snapshot is the "current" Elo (1990 / 1750 / 1720) ──
const hist = { conflicts: {}, snapshots: [
  { asOf: '2025-05-28', ratings: { 'fokina|a': 1850 }, ambiguous: [] },
  { asOf: '2026-07-13', ratings: { 'fokina|a': 1880, 'zandschulp|b': 1700, 'wayenburg|s': 1610 }, ambiguous: [] },
  { asOf: '2026-09-21', ratings: { 'fokina|a': 1990, 'zandschulp|b': 1750, 'wayenburg|s': 1720, 'perricard|g': 1800 }, ambiguous: [] } ] };
const fr = (date, opp, won, extra) => Object.assign({ opponent: opp, opponentKey: null, date, tournament: 'Umag', round: 'ATP Umag - 1/8-finals', surface: 'hard',
  result: won ? '2 - 0' : '1 - 2', won, sets: won ? [{ p: 6, o: 4 }, { p: 7, o: 6 }] : [{ p: 6, o: 7 }, { p: 6, o: 3 }, { p: 4, o: 6 }], retired: false, walkover: false,
  qualifying: false, tier: 'atp', eventKey: null }, extra || {});
function formMatch() {
  const rows = [fr('2026-07-18', 'A. Davidovich Fokina', true, { eventKey: 1 }), fr('2026-07-16', 'B. Van De Zandschulp', false, { eventKey: 2 }),
    fr('2026-07-15', 'S. Gueymard Wayenburg', true, { eventKey: 3 }), fr('2026-07-09', 'G. Mpetshi Perricard', true, { eventKey: 4 })];
  return { id: 'upcoming-350', p1: 'J. Sinner', p2: 'H. Hurkacz', p1Key: 1, p2Key: 2, surface: 'hard', date: '2026-09-29',
    p1RecentFormMatches: rows, p2RecentFormMatches: rows.slice(0, 2), _fhFormData: true, _fhCloses: [null, null], _fhElo: hist };
}
function h2hMatch() {
  const ch1 = [
    { eventKey: 10, date: '2025-06-01', level: 'atp', tournament: 'Lyon', round: 'Final', won: true, result: '2 - 0', surface: 'hard', sets: [{ p: 6, o: 4 }, { p: 6, o: 4 }] },
    { eventKey: 20, date: '2026-03-09', level: 'atp', tournament: 'Indian Wells', round: '1/16-finals', won: false, result: '1 - 2', surface: 'hard', sets: [{ p: 6, o: 7 }, { p: 6, o: 3 }, { p: 4, o: 6 }] },
    { eventKey: 30, date: '2022-07-14', level: 'atp', tournament: 'Umag', round: '1/8-finals', won: true, result: '2 - 0', surface: 'hard', sets: [{ p: 6, o: 2 }, { p: 6, o: 2 }] }];
  return { id: 'upcoming-351', p1: 'H. Hurkacz', p2: 'A. Davidovich Fokina', p1Key: 1, p2Key: 2, surface: 'hard', date: '2026-09-29', h2h: null,
    _fhH2hData: true, _fhCloses: [null, null], p1RecentFormMatches: [], p2RecentFormMatches: [], _fhElo: hist,
    _fhCh: [ch1, ch1.map(x => ({ eventKey: x.eventKey, date: x.date, won: !x.won }))] };
}
// TEN-380 Q5 (founder 2026-10-03): no Elo in any match row (README §5 grid). The opponent's Elo at the match date lives
// in the Form bar tooltip ("v Opponent · Elo N"), with the reason on hover when no snapshot qualifies.
const tipElos = h => [...h.matchAll(/v ([^<]+)<\/span><span class="fh-tip-elo" title="([^"]*)"[^>]*>Elo ([^<]+)<\/span>/g)]
  .map(x => ({ opp: x[1].replace(/&#39;/g, "'"), title: x[2], txt: x[3] }));

// Mutations: fhEloAt reads the newest snapshot (`if (a != null && a < d)` → `if (a != null)` — the current Elo) · the
// tooltip's Elo loses its reason (the title dropped) · the dash prints blank · an Elo span back in the row renderer.
test('Form: the bar tooltip shows the opponent\'s Elo at the match date, never the current Elo; a dash with its reason; no Elo in the rows', () => {
  const h = S.fhBuildForm(formMatch());
  const T = tipElos(h);
  const by = Object.fromEntries(T.map(x => [x.txt === '—' ? 'dash' : x.txt, x]));
  assert.ok(by['1880'] && by['1700'] && by['1610'] && by.dash, 'Elo at each match date: ' + JSON.stringify(T.map(x => x.txt)));
  assert.match(by['1880'].title, /^Elo 1880 at the time of the match \(Tennis Abstract weekly snapshot of 13 Jul 2026\)$/);
  assert.equal(by.dash.title, 'Elo — at the time of the match: no Elo snapshot in the 7 days before the match', 'the dash says why on hover');
  assert.ok(!T.some(x => /1990|1750|1720/.test(x.txt)), 'the current Elo never stands in');
  assert.ok(!/ma-row-elo|data-elo/.test(h), 'TEN-380 Q5: no Elo slot in any row');
});
test('H2H: no Elo in the meeting rows (TEN-380 Q5); the current Elo never appears', () => {
  const h = S.fhBuildH2H(h2hMatch());
  assert.ok(!/ma-row-elo|data-elo/.test(h), 'no Elo slot in any meeting row');
  assert.ok(!/>1990</.test(h), 'the current Elo (1990) never stands in');
});

// ── layout: headless Chrome at the deployed geometry ──
function chromeBin() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) if (spawnSync('which', [b]).status === 0) return b;
  return null;
}
async function inChrome(pageHtml, expr) {
  const bin = chromeBin();
  assert.ok(bin, 'no Chrome on this machine: set CHROME_BIN (a RUNNER problem, not a page problem)');
  const dir = mkdtempSync(join(tmpdir(), 'ten350-'));
  const file = join(dir, 'page.html'); writeFileSync(file, pageHtml);
  const ch = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1296,900', `--user-data-dir=${join(dir, 'u')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Every wait is bounded: a Chrome that crashes or hangs fails this test in seconds, never stalls the deploy gate.
  const timers = [];
  const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => timers.push(setTimeout(() => rej(new Error(`Chrome: ${what} took over ${ms / 1000} s`)), ms)))]);
  let ws;
  try {
    const port = await within(new Promise((res, rej) => { let b = ''; ch.once('error', rej);
      ch.once('exit', c => rej(new Error('Chrome exited (' + c + ') before DevTools was up')));
      ch.stderr.on('data', d => { b += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(b); if (m) res(+m[1]); }); }), 30000, 'start');
    const tg = (await within(fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()), 10000, '/json')).find(t => t.type === 'page');
    ws = new WebSocket(tg.webSocketDebuggerUrl);
    const dead = new Promise((_, rej) => { ws.addEventListener('close', () => rej(new Error('Chrome: DevTools socket closed'))); ws.addEventListener('error', () => rej(new Error('Chrome: DevTools socket error'))); });
    dead.catch(() => {});
    await within(Promise.race([new Promise(r => ws.addEventListener('open', r)), dead]), 10000, 'socket open');
    let id = 0; const w = new Map();
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
    const send = (method, params = {}) => within(Promise.race([new Promise(res => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }), dead]), 30000, method);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1296, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = new Promise(r => ws.addEventListener('message', e => { if (JSON.parse(e.data).method === 'Page.loadEventFired') r(); }));
    await send('Page.navigate', { url: pathToFileURL(file).href }); await within(Promise.race([loaded, dead]), 30000, 'page load');
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  } finally {
    try { ws && ws.close(); } catch {}
    // Chrome can still be writing its profile as it dies: wait for the exit (bounded), then a tolerant remove.
    if (ch.exitCode === null && ch.signalCode === null) { const gone = new Promise(r => ch.once('exit', r)); ch.kill('SIGKILL'); await within(gone, 5000, 'exit').catch(() => {}); }
    timers.forEach(clearTimeout);
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}
// Mutations: Form loses `fullNames` (the README §5 grid's 78 px+ Opponent track then cuts a long name with an ellipsis) ·
// names that never wrap (the name span gains `white-space:nowrap` → it runs into the Rd column).
test('layout at 1296 px: long real names are never truncated or overlapped on Form or H2H (Davidovich Fokina, Van De Zandschulp…)', async () => {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  // TEN-376 Foundation: match-analysis-tokens.css is deleted; the ONE token file is tokens.css, linked ahead of the page styles.
  const tokens = readFileSync(join(HERE, 'tokens.css'), 'utf8');
  const page = `<!doctype html><html data-theme="night"><head><meta charset="utf-8"><style>${tokens}</style><style>${styles}</style></head><body>
    <div id="analysisModal" class="ma-theme" data-ma-theme="night"><div id="aSectionForm" style="width:936px;"></div><div id="aSectionH2H" style="width:936px;"></div></div>
    <script>window.__T = (function(){ ${code('')} })();</script></body></html>`;
  const res = await inChrome(page, `(() => {
    const fm = ${JSON.stringify(formMatch())}, hm = ${JSON.stringify(h2hMatch())};
    document.getElementById('aSectionForm').innerHTML = __T.fhBuildForm(fm);
    document.getElementById('aSectionH2H').innerHTML = __T.fhBuildH2H(hm);
    const read = sec => [...document.querySelectorAll('#' + sec + ' .ma-row')].map(row => {
      const cell = row.children[2], next = row.children[3], name = row.querySelector('.fh-opp');
      const c = cell.getBoundingClientRect(), n = next.getBoundingClientRect();
      const inCell = el => !el || [...el.getClientRects()].every(q => q.left >= c.left - 0.5 && q.right <= c.right + 0.5);
      // a word broken across two lines is a cut name too ("Davidov-/ich"): every word of the name must sit on one line
      let split = 0; const tn = name && name.firstChild;
      if (tn && tn.nodeType === 3) { let at = 0; for (const wd of tn.textContent.split(' ')) { const rg = document.createRange(); rg.setStart(tn, at); rg.setEnd(tn, at + wd.length);
        if (rg.getClientRects().length > 1) split++; at += wd.length + 1; } }
      return { name: name && name.textContent, split, rowW: row.getBoundingClientRect().width, cellW: c.width, overflow: cell.scrollWidth - cell.clientWidth,
        overlap: c.right - n.left, nameIn: inCell(name),
        ellipsis: [cell, name].some(e => e && getComputedStyle(e).textOverflow === 'ellipsis' && getComputedStyle(e).overflow !== 'visible') };
    });
    return { form: read('aSectionForm'), h2h: read('aSectionH2H') };
  })()`);
  const FORM = ['Davidovich Fokina A.', 'Van De Zandschulp B.', 'Gueymard Wayenburg S.', 'Mpetshi Perricard G.'];
  assert.ok(res.form.length >= 4 && res.h2h.length === 3, `rows rendered (Form ${res.form.length}, H2H ${res.h2h.length})`);
  assert.ok(res.form[0].rowW < 500 && res.h2h[0].rowW > 800, `the deployed geometry: two Form lists side by side (row ${res.form[0].rowW} px), one H2H list (row ${res.h2h[0].rowW} px)`);
  for (const r of res.form.concat(res.h2h)) {
    const who = `${r.name} (row ${r.rowW} px, cell ${r.cellW.toFixed(1)} px)`;
    assert.ok(r.overflow <= 1, `${who}: the name overflows its cell by ${r.overflow} px`);
    assert.equal(r.split, 0, `${who}: ${r.split} word(s) of the name broken across lines`);
    assert.ok(r.nameIn, `${who}: the name outside its cell`);
    assert.ok(r.overlap <= 0.5, `${who}: the cell runs ${r.overlap.toFixed(1)} px into the Rd column`);
    assert.ok(!r.ellipsis, `${who}: an ellipsis can cut the name`);
  }
  assert.deepEqual(res.form.slice(0, 4).map(r => r.name), FORM, 'the full names are in the DOM, uncut');
  assert.deepEqual(res.h2h.map(r => r.name), ['Indian Wells', 'Lyon', 'Umag'], 'TEN-380: the Event column, newest first');
});
