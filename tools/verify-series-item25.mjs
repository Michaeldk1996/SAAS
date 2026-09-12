#!/usr/bin/env node
/**
 * verify-series-item25.mjs — TEN-194 items 2 and 5, measured off a real browser.
 *
 * Rulings under test (ask a37a68e9, answered 2026-09-12, all option (a)):
 *   handicap-line   — a handicap card ships ONLY at −3.5; no −1.5/−5.5 fallback.
 *   handicap-bestof — the card drops "(best-of-N)"; the modal keeps it.
 *   reference-label — the sub-line NAMES the window ("longest since 2021 9"), and the
 *                     year comes from the artifact, never the clock.
 *   reference-lone  — a first-ever run at this length prints "1st time at N+" in full.
 *
 * METHOD. Real headless Chrome over CDP against the DEPLOYED dashboard shell, with the
 * CANDIDATE series.js / series.css swapped in at the network layer, exactly as the
 * rebuild passes did. Every figure below is read off what the browser painted.
 *
 * TWO PASSES, because item 5 has two live states and only one of them exists today:
 *   pass A "withref"  — the artifact the NEXT pipeline run will publish: real
 *                       references attached by tools/verify-series-reference.mjs.
 *   pass B "noref"    — the DEPLOYED artifact as it stands, which predates item 5.
 *                       This is what the page meets between the JS deploy and the next
 *                       build, and item 5 rules it a dash. Measuring it is the point.
 *
 * The expected sub-line text is derived INDEPENDENTLY here — its own ordinal, its own
 * label assembly, reading series.json — and imports nothing from series.js.
 *
 *   node tools/verify-series-item25.mjs --data <withref.json> [--live] [--width N]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html?series=1';
const DATA = 'https://michaeldk1996.github.io/SAAS/series.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const WIDTH = argv.includes('--width') ? +argv[argv.indexOf('--width') + 1] : 1400;
const WITHREF = argv.includes('--data') ? argv[argv.indexOf('--data') + 1] : null;
if (!WITHREF) { console.error('--data <withref.json> is required (produce it with tools/verify-series-reference.mjs --out)'); process.exit(2); }

let pass = 0;
const fails = [];
const eq = (l, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else fails.push(`${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const ok = (l, cond, detail) => { if (cond) pass++; else fails.push(`${l}${detail ? ': ' + detail : ''}`); };

/* ── independent expectation ─────────────────────────────────────────────────── */
// Its own ordinal. Written from the English rule, not copied from series.js.
function ord(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// The card set the page should paint, re-derived from the artifact: the drop guard,
// item 1's subset suppression, item 2's −3.5-only rule, the view floor, the sort.
function expectCards(doc, minLen) {
  const OUTCOME = new Set(['all', 'surface', 'style']);
  const BREADTH = { all: 3, surface: 2, style: 1 };
  const mkey = (m) => `${m.date}|${m.opponent == null ? '' : m.opponent}`;
  const cards = [];
  for (const p of doc.players || []) {
    for (const st of p.streaks || []) {
      if (st.pool == null || !st.lastDate || st.ageDays == null) continue;
      if (st.type === 'handicap' && Number(st.line) !== 3.5) continue;   // item 2
      cards.push({ p, st });
    }
  }
  const groups = new Map();
  for (const c of cards) {
    if (!OUTCOME.has(c.st.type) || !(Array.isArray(c.st.matches) && c.st.matches.length)) continue;
    const k = `${c.p.key}|${c.p.tier}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const suppressed = new Set();
  for (const g of groups.values()) {
    for (const a of g) {
      const A = new Set(a.st.matches.map(mkey));
      for (const b of g) {
        if (b === a || b.st.count < a.st.count) continue;
        const B = new Set(b.st.matches.map(mkey));
        if (![...A].every((x) => B.has(x))) continue;
        if (BREADTH[b.st.type] <= BREADTH[a.st.type]) continue;
        suppressed.add(a); break;
      }
    }
  }
  const styleFloor = (doc.rules && doc.rules.viewFloorStyle) || 3;
  const out = cards.filter((c) => {
    if (suppressed.has(c)) return false;
    if (c.p.upcoming && c.p.upcoming.played) return false;
    return c.st.count >= (c.st.type === 'style' ? styleFloor : minLen);
  });
  out.sort((a, b) => (b.st.count - a.st.count) || ((b.st.pool || 0) - (a.st.pool || 0)));
  return { cards: out, suppressed: suppressed.size };
}
// The sub-line the card should carry, assembled from scratch.
function expectRef(doc, st) {
  const y = doc.rules && doc.rules.referenceWindow && doc.rules.referenceWindow.sinceYear;
  const r = st.reference;
  const posInt = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0;
  if (typeof y !== 'number' || !r || !posInt(r.longest) || !posInt(r.occurrences)) return '—';
  return `longest since ${y} ${r.longest} · ${ord(r.occurrences)} time at ${st.count}+`;
}

/* ── CDP scaffold (same as the rebuild passes) ───────────────────────────────── */
async function cdpTarget(dport, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('no CDP page target within timeout');
}
function client(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method && onEvent) onEvent(m);
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

// serve: { js, css } to swap in instead of the repo's candidate files. Pass the
// DEPLOYED bytes here to measure the published build — never by writing them over the
// working tree, which leaves the repo wrong if the process is killed mid-run.
async function drive(rawData, fn, serve, width) {
  const candJs = (serve && serve.js) || fs.readFileSync(path.join(REPO, 'series.js'), 'utf8');
  const candCss = (serve && serve.css) || fs.readFileSync(path.join(REPO, 'series.css'), 'utf8');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-i25-'));
  const dport = 9700 + Math.floor(Math.random() * 200);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
      '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let c;
  try {
    c = client(await cdpTarget(dport, 20000), async (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      let body = null, mime = null;
      if (!LIVE && /\/series\.js(\?|$)/.test(request.url)) { body = candJs; mime = 'application/javascript'; }
      else if (!LIVE && /\/series\.css(\?|$)/.test(request.url)) { body = candCss; mime = 'text/css'; }
      else if (/\/series\.json(\?|$)/.test(request.url)) { body = rawData; mime = 'application/json'; }
      if (body != null) {
        await c.send('Fetch.fulfillRequest', {
          requestId, responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: mime }, { name: 'cache-control', value: 'no-store' }],
          body: Buffer.from(body, 'utf8').toString('base64'),
        });
      } else await c.send('Fetch.continueRequest', { requestId });
    });
    await c.ready;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*series.js*' }, { urlPattern: '*series.css*' }, { urlPattern: '*series.json*' }] });
    await c.send('Emulation.setDeviceMetricsOverride', { width: width || WIDTH, height: 1600, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window,'BSP',{configurable:true,set(v){
        try{ v.requireVerified=function(){return Promise.resolve({uid:'probe',email:'probe@x'});}; }catch(e){}
        Object.defineProperty(window,'BSP',{value:v,writable:true,configurable:true});
      },get(){return undefined;}});`,
    });
    const ev = async (expr) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      const x = r.result?.exceptionDetails;
      if (x) throw new Error('eval threw: ' + (x.exception?.description || x.text));
      return r.result?.result?.value;
    };
    await c.send('Page.navigate', { url: PAGE });
    for (let i = 0; i < 150; i++) {
      const r = await ev(`(function(){var b=document.getElementById('seriesTabBtn');
        return { ready: document.readyState==='complete', api: !!window.SeriesPage,
                 shown: !!b && b.style.display !== 'none' };})()`).catch(() => ({}));
      if (r.ready && r.api && r.shown) break;
      await sleep(200);
    }
    let active = null;
    for (let i = 0; i < 25; i++) {
      await ev(`document.getElementById('seriesTabBtn').click()`);
      await sleep(200);
      active = await ev(`(document.querySelector('.tabpage.active')||{dataset:{}}).dataset.page`);
      if (active === 'series') break;
    }
    if (active !== 'series') throw new Error(`Series tab never activated (active=${active})`);
    for (let i = 0; i < 120; i++) {
      if (await ev(`document.querySelectorAll('[data-page="series"] .sr-card').length`).catch(() => 0)) break;
      await sleep(200);
    }
    await sleep(500);
    return await fn(ev);
  } finally { try { c && c.close(); } catch {} chrome.kill('SIGKILL'); }
}

/* ── main ────────────────────────────────────────────────────────────────────── */
const withRefRaw = fs.readFileSync(WITHREF, 'utf8');
const withRef = JSON.parse(withRefRaw);
const deployedRaw = await (await fetch(DATA, { cache: 'no-store' })).text();
const deployed = JSON.parse(deployedRaw);
const MINLEN = 6;   // item 9's default, asserted as a literal, never read back from the artifact

const nHcapAll = withRef.players.reduce((n, p) => n + p.streaks.filter((s) => s.type === 'handicap').length, 0);
const nHcap35 = withRef.players.reduce((n, p) => n + p.streaks.filter((s) => s.type === 'handicap' && Number(s.line) === 3.5).length, 0);
console.log(`pass A artifact ${WITHREF}`);
console.log(`  generatedAt=${withRef.generatedAt} streaks=${withRef.players.reduce((n, p) => n + p.streaks.length, 0)} ` +
  `sinceYear=${withRef.rules.referenceWindow && withRef.rules.referenceWindow.sinceYear}`);
console.log(`  handicap streaks in artifact: ${nHcapAll} total, ${nHcap35} at −3.5\n`);

/* ── PASS A · the artifact the next build will publish ───────────────────────── */
const A = await drive(withRefRaw, async (ev) => {
  const exp = expectCards(withRef, MINLEN);
  const rows = await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-card')).map(function(e){
    var ref = e.querySelector('.sr-ref');
    var top = e.querySelector('.sr-cardtop');
    var cs  = ref ? getComputedStyle(ref) : null;
    return {
      name: e.querySelector('.sr-pname').textContent.trim(),
      claim: e.querySelector('.sr-claim').textContent.trim(),
      type: e.querySelector('.sr-cell-type').textContent.trim(),
      count: Number(e.getAttribute('data-count')),
      ref: ref ? ref.textContent.trim() : null,
      refIsNone: ref ? ref.classList.contains('sr-ref--none') : null,
      afterTop: !!(ref && top && top.nextElementSibling === ref),
      beforeProw: !!(ref && ref.nextElementSibling && ref.nextElementSibling.classList.contains('sr-prow')),
      font: cs ? cs.fontFamily : null, size: cs ? cs.fontSize : null, color: cs ? cs.color : null,
      width: ref ? Math.round(ref.getBoundingClientRect().width) : null,
      scrollW: ref ? ref.scrollWidth : null, clientW: ref ? ref.clientWidth : null,
    };
  })`);
  return { rows, exp, gridText: await ev(`document.getElementById('seriesGrid').textContent`) };
});

eq('A1 card count = independent recompute', A.rows.length, A.exp.cards.length);
const expSig = A.exp.cards.map((c) => `${c.p.name}|${c.st.count}`).sort();
eq('A2 card identities = independent recompute', A.rows.map((r) => `${r.name}|${r.count}`).sort(), expSig);

// item 5 · every painted sub-line equals the independently-assembled expectation
const bySig = new Map();
A.exp.cards.forEach((c) => bySig.set(`${c.p.name}|${c.st.count}|${c.st.type}|${c.st.subtype || ''}`, c));
let refMatched = 0; const refBad = [];
for (const r of A.rows) {
  const cand = A.exp.cards.filter((c) => c.p.name === r.name && c.st.count === r.count);
  const hit = cand.find((c) => expectRef(withRef, c.st) === r.ref);
  if (hit) refMatched++;
  else refBad.push(`${r.name} ${r.count} painted "${r.ref}" — candidates ${JSON.stringify(cand.map((c) => expectRef(withRef, c.st)))}`);
}
eq('A3 every painted sub-line = independent recompute', refMatched, A.rows.length);
if (refBad.length) refBad.slice(0, 6).forEach((b) => console.log('    ' + b));

ok('A4 no card dashed its sub-line on the built artifact',
  A.rows.every((r) => r.refIsNone === false), `dashed=${A.rows.filter((r) => r.refIsNone).length}`);
ok('A5 the sub-line sits directly beneath the title', A.rows.every((r) => r.afterTop), 'a card has it elsewhere');
ok('A6 the player row follows the sub-line', A.rows.every((r) => r.beforeProw), 'a card has something between them');

// item 5's stated styling, off the PAINTED element
ok('A7 mono', A.rows.every((r) => /IBM Plex Mono|monospace/.test(r.font)), A.rows[0] && A.rows[0].font);
eq('A8 14px, same as the STARTED/LAST values', [...new Set(A.rows.map((r) => r.size))], ['14px']);
eq('A9 #5b6880', [...new Set(A.rows.map((r) => r.color))], ['rgb(91, 104, 128)']);
// The sub-line is the longest mono string on the card; if it elides, the reference is
// corrupted rather than merely tight — the same failure the year-bearing strip had.
const clipped = A.rows.filter((r) => r.scrollW > r.clientW + 1);
eq('A10 no sub-line is clipped at 1400px', clipped.length, 0);

// ruling reference-lone (a), on real cards
const lonePainted = A.rows.filter((r) => /· 1st time at/.test(r.ref || ''));
ok('A11 reference-lone (a) exercised on real data', lonePainted.length > 0, `lone cards painted=${lonePainted.length}`);
ok('A12 a lone run still prints BOTH halves',
  lonePainted.every((r) => /^longest since \d{4} \d+ · 1st time at \d+\+$/.test(r.ref)),
  JSON.stringify(lonePainted.slice(0, 3).map((r) => r.ref)));

// ruling reference-label (a): the window is named, "career" never appears
ok('A13 no card says "career"', !/career/i.test(A.gridText), 'the word "career" is on the board');
ok('A14 every sub-line names the window year from the artifact',
  A.rows.every((r) => r.ref.startsWith(`longest since ${withRef.rules.referenceWindow.sinceYear} `)),
  JSON.stringify(A.rows.filter((r) => !r.ref.startsWith('longest since ')).slice(0, 3).map((r) => r.ref)));

// item 2 · handicap
const hcapPainted = A.rows.filter((r) => r.type === 'Handicap');
ok('A15 the −3.5-only rule actually had something to suppress', nHcapAll > nHcap35,
  `artifact holds ${nHcapAll} handicap streaks, ${nHcap35} at −3.5 — nothing to remove, assertion would be vacuous`);
eq('A16 no painted handicap card is off −3.5',
  hcapPainted.filter((r) => !/−3\.5/.test(r.claim)).map((r) => r.claim), []);
eq('A17 no handicap card prints "(best-of-N)"',
  hcapPainted.filter((r) => /best-of/.test(r.claim)).map((r) => r.claim), []);
// …and the qualifier did not vanish from the family that keeps it.
const totals = A.rows.filter((r) => r.type === 'Total games');
ok('A18 the total-games family keeps its "(best-of-N)"',
  totals.length === 0 || totals.every((r) => /best-of-\d/.test(r.claim)),
  `totals painted=${totals.length} ` + JSON.stringify(totals.slice(0, 3).map((r) => r.claim)));

/* ── PASS A2 · narrow-viewport stress ────────────────────────────────────────
 * The sub-line is the longest mono string on the card and it is `nowrap`. The
 * year-bearing date strip taught the lesson: a mono cell that elides prints a
 * CORRUPTED value, strictly worse than the thing it replaced.
 *
 * A plain "is anything clipped?" sweep DOES NOT TEST THAT, and the clean-context
 * review proved it: the grid track's automatic min-content minimum lets the card GROW
 * to fit a nowrap string rather than clip it, so the check is always-true. The real
 * risk is therefore the opposite one — a card wider than its track pushing the PAGE
 * into horizontal scroll, which is a visible defect on a phone.
 *
 * So this stresses the worst case deliberately: every sub-line is lengthened to the
 * longest shape the format can produce (3-digit longest, 3-digit ordinal, 3-digit
 * count), and both failure modes are measured — elision AND page overflow.
 */
const stress = JSON.parse(withRefRaw);
for (const p of stress.players) for (const st of p.streaks) {
  if (st.reference) { st.reference.longest = 188; st.reference.occurrences = 112; }
}
const stressRaw = JSON.stringify(stress);
const WIDTHS = [1600, 1400, 1200, 1024, 820, 640, 420, 360, 320];
const clipReport = [];
for (const w of WIDTHS) {
  const r = await drive(stressRaw, async (ev) => ({
    n: await ev(`document.querySelectorAll('[data-page="series"] .sr-ref').length`),
    clipped: await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-ref'))
      .filter(function(e){ return e.scrollWidth > e.clientWidth + 1; })
      .map(function(e){ return e.textContent.trim(); })`),
    overflow: await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`),
    // The page DOES overflow horizontally below ~640px, on the deployed build too — the
    // offender is item 8's filter bar (.sr-fgroup / .sr-seg, right edge 605px at every
    // narrow width), measured identical with and without this change. So the assertion
    // that isolates ITEM 5 is about the card column, not the document: does anything the
    // sub-line touches push past the viewport?
    cardOver: await ev(`(function(){ var w = document.documentElement.clientWidth, n = 0;
      document.querySelectorAll('[data-page="series"] .sr-card, [data-page="series"] .sr-ref')
        .forEach(function(e){ if (e.getBoundingClientRect().right > w + 1) n++; });
      return n; })()`),
    widest: await ev(`Math.max.apply(null, Array.from(document.querySelectorAll('[data-page="series"] .sr-card'))
      .map(function(e){ return Math.round(e.getBoundingClientRect().width); }).concat([0]))`),
    sample: await ev(`(document.querySelector('[data-page="series"] .sr-ref')||{}).textContent`),
  }), null, w);
  clipReport.push(`${w}px: ${r.clipped.length}/${r.n} elided, ${r.cardOver} card/sub-line past the fold, widest card ${r.widest}px (page overflow ${r.overflow}px — pre-existing, filter bar)`);
  ok(`A2-${w}a no sub-line elides at ${w}px (worst-case text)`, r.clipped.length === 0, JSON.stringify(r.clipped.slice(0, 2)));
  ok(`A2-${w}b no card or sub-line extends past the viewport at ${w}px`, r.cardOver === 0,
    `${r.cardOver} elements past the fold — widest card ${r.widest}px, sample sub-line ${JSON.stringify(r.sample)}`);
}

/* ── PASS C · the handicap family, made visible ──────────────────────────────
 * At the 6+ default the handicap family is EMPTY today (both qualifying runs on the
 * board are −1.5, which is precisely what ruling handicap-line (a) removes). An empty
 * set satisfies A16/A17 without demonstrating anything, so this pass drops the Min
 * length filter to 3+ through the real filter bar — the same control the reader uses —
 * and re-measures with actual handicap cards on the board.
 */
const C = await drive(withRefRaw, async (ev) => {
  await ev(`(function(){var s=document.querySelector('[data-page="series"] .sr-seg[data-seg="minLen"]');
    s.querySelector('.sr-segbtn[data-val="3"]').click();})()`);
  await sleep(400);
  return {
    minLenActive: await ev(`document.querySelector('[data-page="series"] .sr-seg[data-seg="minLen"] .sr-segbtn.active').getAttribute('data-val')`),
    rows: await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-card')).map(function(e){
      var ref=e.querySelector('.sr-ref');
      return { claim: e.querySelector('.sr-claim').textContent.trim(),
               type: e.querySelector('.sr-cell-type').textContent.trim(),
               name: e.querySelector('.sr-pname').textContent.trim(),
               count: Number(e.getAttribute('data-count')),
               ref: ref ? ref.textContent.trim() : null };
    })`),
  };
});
eq('C0 the filter bar really moved to 3+', C.minLenActive, '3');
const cHcap = C.rows.filter((r) => r.type === 'Handicap');
const cExp = expectCards(withRef, 3);
eq('C1 card count at 3+ = independent recompute', C.rows.length, cExp.cards.length);
ok('C2 handicap cards are now actually on the board', cHcap.length > 0, `handicap painted=${cHcap.length}`);
eq('C3 every painted handicap card is −3.5',
  cHcap.filter((r) => !/^Covered −3\.5 games |^Beaten by more than 3\.5 games /.test(r.claim + ' ')).map((r) => r.claim), []);
eq('C4 no painted handicap card carries "(best-of-N)"', cHcap.filter((r) => /best-of/.test(r.claim)).map((r) => r.claim), []);
// The artifact at this floor still HOLDS −1.5 runs that would have qualified — so the
// absence above is the rule firing, not a thin slate.
const wouldHave = [];
for (const p of withRef.players) for (const st of p.streaks) {
  if (st.type !== 'handicap' || Number(st.line) === 3.5) continue;
  if (st.pool == null || !st.lastDate || st.ageDays == null) continue;
  if (p.upcoming && p.upcoming.played) continue;
  if (st.count >= 3) wouldHave.push(`${p.name} −${st.line} ×${st.count}`);
}
ok('C5 the rule had real cards to remove at this floor', wouldHave.length > 0,
  `nothing off −3.5 qualified at 3+, so C3 proves nothing — ${JSON.stringify(wouldHave)}`);
eq('C6 none of those reached the board',
  C.rows.filter((r) => r.type === 'Handicap' && /−(1\.5|5\.5)/.test(r.claim)).map((r) => r.claim), []);
const cTot = C.rows.filter((r) => r.type === 'Total games');
ok('C7 the total-games family still carries "(best-of-N)" at this floor',
  cTot.length > 0 && cTot.every((r) => /best-of-\d/.test(r.claim)),
  `totals=${cTot.length} ` + JSON.stringify(cTot.slice(0, 3).map((r) => r.claim)));

/* ── PASS D · the DEPLOYED series.js, same artifact, as a before/after ────────
 * Item 2 is a removal, and a removal is only demonstrable against what was there. This
 * runs the page as published today — no candidate swap — over the same artifact and
 * the same 3+ floor, so the two card sets are comparable line for line.
 */
const liveJs = await (await fetch('https://michaeldk1996.github.io/SAAS/series.js', { cache: 'no-store' })).text();
const liveCss = await (await fetch('https://michaeldk1996.github.io/SAAS/series.css', { cache: 'no-store' })).text();
const D = await drive(withRefRaw, async (ev) => {
  await ev(`(function(){var s=document.querySelector('[data-page="series"] .sr-seg[data-seg="minLen"]');
    s.querySelector('.sr-segbtn[data-val="3"]').click();})()`);
  await sleep(400);
  return {
    rows: await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-card')).map(function(e){
      return { claim: e.querySelector('.sr-claim').textContent.trim(),
               type: e.querySelector('.sr-cell-type').textContent.trim(),
               name: e.querySelector('.sr-pname').textContent.trim() };
    })`),
    hasRef: await ev(`!!document.querySelector('[data-page="series"] .sr-ref')`),
  };
}, { js: liveJs, css: liveCss });
const dHcap = D.rows.filter((r) => r.type === 'Handicap');
ok('D1 the deployed page DOES paint the fallback lines today',
  dHcap.some((r) => /−(1\.5|5\.5)/.test(r.claim)),
  `deployed handicap cards: ${JSON.stringify(dHcap.map((r) => r.claim))}`);
ok('D2 the deployed page has no reference sub-line', D.hasRef === false, 'the deployed build already has one');
ok('D3 the candidate removed exactly the off-−3.5 handicap cards, nothing else',
  D.rows.length - C.rows.length === dHcap.filter((r) => /−(1\.5|5\.5)/.test(r.claim)).length,
  `deployed ${D.rows.length} − candidate ${C.rows.length} = ${D.rows.length - C.rows.length}, ` +
  `off-3.5 deployed handicap cards = ${dHcap.filter((r) => /−(1\.5|5\.5)/.test(r.claim)).length}`);

/* ── PASS B · today's deployed artifact, which has no references ─────────────── */
const B = await drive(deployedRaw, async (ev) => ({
  rows: await ev(`Array.from(document.querySelectorAll('[data-page="series"] .sr-card')).map(function(e){
    var ref = e.querySelector('.sr-ref'); var cs = ref ? getComputedStyle(ref) : null;
    return { name: e.querySelector('.sr-pname').textContent.trim(),
             ref: ref ? ref.textContent.trim() : null,
             none: ref ? ref.classList.contains('sr-ref--none') : null,
             color: cs ? cs.color : null };
  })`),
  gridText: await ev(`document.getElementById('seriesGrid').textContent`),
}));
ok('B0 the deployed artifact really has no references',
  deployed.players.every((p) => p.streaks.every((s) => s.reference === undefined)),
  'the deployed artifact already carries references — pass B is no longer the pre-build state');
ok('B1 the board still paints without references', B.rows.length > 0, `cards=${B.rows.length}`);
eq('B2 every card dashes its sub-line', B.rows.filter((r) => r.ref !== '—').map((r) => r.name), []);
eq('B3 the dash carries the item\'s own colour', [...new Set(B.rows.map((r) => r.color))], ['rgb(75, 86, 114)']);
ok('B4 no half a sub-line anywhere', !/longest|time at/.test(B.gridText), 'a partial reference painted');

/* ── report ──────────────────────────────────────────────────────────────────── */
console.log(`pass A — ${A.rows.length} cards painted (recompute ${A.exp.cards.length}, item-1 suppressed ${A.exp.suppressed})`);
console.log(`  handicap cards painted: ${hcapPainted.length}${hcapPainted.length ? ' — ' + hcapPainted.map((r) => r.claim).join(' | ') : ' (family empty — ruling handicap-line (a)\'s stated consequence)'}`);
console.log(`  lone "1st time at N+" cards: ${lonePainted.length}`);
console.log(`  sample sub-lines: ${A.rows.slice(0, 4).map((r) => JSON.stringify(r.ref)).join(', ')}`);
console.log(`  clipping sweep: ${clipReport.join(' · ')}`);
console.log(`pass C — Min length 3+, candidate build: ${C.rows.length} cards, ${cHcap.length} handicap`);
console.log(`  handicap claims painted: ${JSON.stringify(cHcap.map((r) => r.claim))}`);
console.log(`  off-−3.5 runs that qualified at 3+ and were removed: ${JSON.stringify(wouldHave)}`);
console.log(`pass D — Min length 3+, DEPLOYED build, same artifact: ${D.rows.length} cards, ${dHcap.length} handicap`);
console.log(`  deployed handicap claims: ${JSON.stringify(dHcap.map((r) => r.claim))}`);
console.log(`  delta ${D.rows.length} → ${C.rows.length} = −${D.rows.length - C.rows.length}, all of them off-−3.5 handicap cards`);
console.log(`pass B — ${B.rows.length} cards painted off the deployed (pre-item-5) artifact, all dashed\n`);
console.log(`${pass} assertions passed, ${fails.length} failed`);
fails.forEach((f) => console.log('  ✗ ' + f));
process.exit(fails.length ? 1 : 0);
