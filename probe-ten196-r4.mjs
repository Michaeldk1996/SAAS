// TEN-196 round 4 — verify the founder's `player-charts` -> `tournaments-only`
// ruling: the three Players panels go back to a CALENDAR axis while Tour and
// Tournaments keep the match index.
//
// Everything asserted here is read off what Chrome PAINTED and compared against a
// value this file recomputes from the raw artefacts (database-yield.json and
// database-yield-players.json). It imports NOTHING from the page or the builder.
//
// Two traps this workstream has already been caught by, and how they are avoided:
//   * "0 === 0" — an expectation derived from the same artefact it is testing.
//     Countered by pinning the archive-level counts as HARD LITERALS up front, so a
//     gutted artefact fails a precondition before anything derived runs.
//   * an assertion on an IMMUNE subject — last round both grouping assertions used
//     1:1 venues, which no merge bug could move. Here the basis change is only
//     visible on a player with IDLE STRETCHES, so the uniform-spacing assertion runs
//     on a player picked for having a gap season, and the probe says which.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2] || process.cwd();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, got, want) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL  ${name}\n        got:  ${got}\n        want: ${want}`); }
}
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

// ---------- independent recomputation (no page code) ----------
const DATA = JSON.parse(fs.readFileSync(path.join(WT, 'database-yield.json'), 'utf8'));
const NAMES = JSON.parse(fs.readFileSync(path.join(WT, 'database-yield-players.json'), 'utf8'));
const M = DATA.meta;

// HARD LITERAL preconditions. These are the archive-level facts every later
// expectation leans on; deriving them from DATA would make the suite pass against a
// gutted artefact. 41,667 is the founder-verified row count for this page.
console.log('\n-- preconditions (hard literals, not derived) --');
ok('archive row count is the literal 41,667', DATA.rows.length === 41667, DATA.rows.length, 41667);
ok('name table is 1:1 with rows', NAMES.names.length === DATA.rows.length, NAMES.names.length, DATA.rows.length);
ok('archive ends 2026 (dateRange[1])', String(M.dateRange[1]).slice(0, 4) === '2026', M.dateRange[1], '2026-…');

const dnum = di => { const s = '' + di; return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 86400000; };
const anchorHi = dnum(+('' + M.dateRange[1]).replace(/-/g, ''));

// Rebuild the per-player index from the raw rows — the page's own column order is
// public in the artefact's meta; nothing is imported.
const byPlayer = new Map();
for (let i = 0; i < DATA.rows.length; i++) {
  const r = DATA.rows[i], favWon = r[7], [w, l] = NAMES.names[i];
  const push = (n, rec) => { if (!n) return; if (!byPlayer.has(n)) byPlayer.set(n, []); byPlayer.get(n).push(rec); };
  push(w, { d: r[0], p: favWon ? r[5] : r[6], op: favWon ? r[6] : r[5], w: 1 });
  push(l, { d: r[0], p: favWon ? r[6] : r[5], op: favWon ? r[5] : r[6], w: 0 });
}

// Pick the SUBJECT deliberately, not for convenience: a long career (so the tick
// ladder has several steps) that contains at least one season with NO matches. On a
// match index an idle season occupies zero width; on a calendar axis it occupies a
// full year. A player without a gap cannot distinguish the two bases, and asserting
// on one would repeat last round's immune-subject defect.
function seasonsOf(recs) { return new Set(recs.map(v => Math.floor(v.d / 10000))); }
let subject = null, subjectGap = null;
const cands = [...byPlayer.entries()].filter(([, recs]) => recs.length >= 120)
  .sort((a, b) => b[1].length - a[1].length);
for (const [name, recs] of cands) {
  const ys = [...seasonsOf(recs)].sort((a, b) => a - b);
  const missing = [];
  for (let y = ys[0]; y <= ys[ys.length - 1]; y++) if (!seasonsOf(recs).has(y)) missing.push(y);
  if (missing.length) { subject = name; subjectGap = missing; break; }
}
const subjectIsGapped = !!subject;
if (!subject) subject = cands[0][0];   // reported honestly below if it happens
const recs = byPlayer.get(subject);

const minD = Math.min(...recs.map(v => dnum(v.d)));
const startYear = new Date(minD * 86400000).getUTCFullYear();
const d0 = Date.UTC(startYear, 0, 1) / 86400000;
const span = (Math.max(anchorHi, minD) - d0) || 1;
const endYear = new Date((d0 + span) * 86400000).getUTCFullYear();

function expectTicks(step) {
  const out = [];
  for (let y = startYear; y <= endYear; y += step) {
    const f = (Date.UTC(y, 0, 1) / 86400000 - d0) / span;
    if (f < 0 || f > 1) continue;
    out.push({ label: String(y), x: f });
  }
  return out;
}
function expectLadder(steps) { for (const s of steps) { const t = expectTicks(s); if (t.length >= 3) return t; } return expectTicks(steps[steps.length - 1]); }
const expMain = expectLadder([2, 1]);
const expSub = expectLadder([4, 2, 1]);

// Cumulative end value, back stance: +price-1 on a win, -1 on a loss.
function endU(rs) { let c = 0; for (const v of rs.slice().sort((a, b) => a.d - b.d)) c += v.w ? (v.p - 1) : -1; return c; }
const expEndAll = endU(recs);

console.log(`\nSubject: ${subject} — ${recs.length} matches, ${startYear}–${endYear}` +
  (subjectIsGapped ? `, idle season(s) ${subjectGap.join(', ')} (this is why he was chosen)` : ', NO idle season (see warning)'));
ok('subject has an idle season, so the two bases are distinguishable on him',
  subjectIsGapped, 'no gap found', 'at least one season with no matches');

// ---------- serve + drive real Chrome ----------
const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"p",name:"P",email:"p@x",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const preview = '_probe-r4.html';
fs.writeFileSync(path.join(WT, preview), src.replace(marker, marker + '\n' + stub));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + preview;
  const fp = path.join(WT, p);
  if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-r4-');
const dport = 9300 + Math.floor(port % 200);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
  '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });

async function cdpTarget() {
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); const pg = l.find(t => t.type === 'page'); if (pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl; } catch { }
    await sleep(200);
  }
  throw new Error('no CDP target');
}
function client(ws) {
  const s = new WebSocket(ws); let id = 0; const pend = new Map(); const logs = [];
  const ready = new Promise((res, rej) => { s.onopen = () => res(); s.onerror = rej; });
  s.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails?.text || ''));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => { const mid = ++id; pend.set(mid, res); s.send(JSON.stringify({ id: mid, method, params })); });
  return { ready, send, logs };
}
const c = client(await cdpTarget());
await c.ready;
await c.send('Page.enable'); await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1200, deviceScaleFactor: 1, mobile: false });
const ev = async expr => {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('eval threw ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};

await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/${preview}#/matches` });
await sleep(1500);

// Reachability: click the real nav button, do not unhide it.
const nav = await ev(`(function(){var b=document.getElementById('databaseTabBtn'); if(!b) return {err:'no button'};
  var cs=getComputedStyle(b), r=b.getBoundingClientRect();
  var hit=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
  return {display:cs.display, visibility:cs.visibility, w:Math.round(r.width), h:Math.round(r.height),
          hitIsSelf: !!(hit && (hit===b || b.contains(hit)))};})()`);
console.log('\n-- reachability --');
ok('Database nav button is displayed', nav.display !== 'none', nav.display, '!= none');
ok('Database nav button hit-tests to itself', nav.hitIsSelf === true, nav.hitIsSelf, true);
await ev(`document.getElementById('databaseTabBtn').click()`);
for (let i = 0; i < 80; i++) { if (await ev(`!!document.querySelector('#dbBody .db-card, #dbBody .db-bandgrid')`)) break; await sleep(250); }

// Tour tab keeps the match index — assert BEFORE touching Players.
const xcap = await ev(`(function(){var e=document.querySelector('[data-page="database"] .db-xcap'); return e? e.textContent.trim():null;})()`);
console.log('\n-- Tour/Tournaments keep the match index --');
ok('Tour .db-xcap still reads the match-index caption',
  xcap === 'Match index (chronological) · ticks mark season starts', JSON.stringify(xcap),
  '"Match index (chronological) · ticks mark season starts"');

// Drive to Players and pick the subject through the real search field.
await ev(`document.querySelector('#dbViewTabs button[data-dbview="players"]').click()`);
for (let i = 0; i < 100; i++) { if (await ev(`!!document.querySelector('[data-page="database"] input[placeholder^="Search players"]')`)) break; await sleep(250); }
const picked = await ev(`(function(){
  var inp=document.querySelector('[data-page="database"] input[placeholder^="Search players"]');
  if(!inp) return {err:'no search input'};
  inp.focus(); inp.value=${JSON.stringify(subject)};
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  return {typed:inp.value};})()`);
if (picked.err) { console.log('FATAL', picked.err); process.exit(1); }
await sleep(400);
// The result rows commit on mousedown (so the field's blur cannot beat the pick),
// so drive mousedown — clicking would assert against a handler the UI does not use.
const chose = await ev(`(function(){
  var rows=[...document.querySelectorAll('[data-page="database"] .db-pop .db-prow')];
  var hit=rows.filter(function(r){ var s=r.querySelector('span'); return s && s.textContent.trim()===${JSON.stringify(subject)}; })[0];
  if(!hit) return {clicked:false, rows:rows.length, first:(rows[0]&&rows[0].textContent||'').trim()};
  hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
  return {clicked:true, rows:rows.length};})()`);
if (!chose.clicked) { console.log('FATAL could not pick subject', JSON.stringify(chose)); chrome.kill(); server.close(); process.exit(1); }
for (let i = 0; i < 100; i++) { if (await ev(`!!document.querySelector('[data-page="database"] .db-pcmain')`)) break; await sleep(250); }

const paint = await ev(`(function(){
  var scope=document.querySelector('[data-page="database"]');
  var eyebrows=[...scope.querySelectorAll('.db-eyebrow')].map(function(e){return e.textContent.trim();});
  var cards=[...scope.querySelectorAll('.db-card')];
  var card=cards.filter(function(cd){ return cd.querySelector('.db-pcmain'); })[0];
  if(!card) return {err:'no player chart card'};
  function ladder(p){ return [...p.querySelectorAll('.db-pcticks > div')].map(function(d){
    return {label:d.textContent.trim(), left:parseFloat(d.style.left)}; }); }
  function pts(p){ var pl=p.querySelector('polyline'); if(!pl) return null;
    return pl.getAttribute('points').trim().split(/\\s+/).map(function(s){ return s.split(',').map(Number); }); }
  var main=card.querySelector('.db-pcmain');
  var subs=[...card.querySelectorAll('.db-pcpair > *')];
  var chip=scope.querySelector('.db-subject span');
  return {
    subject: chip? chip.textContent.trim(): null,
    eyebrow: (card.querySelector('.db-eyebrow')||{}).textContent || (eyebrows[0]||''),
    allEyebrows: eyebrows,
    aria: (main.querySelector('svg')||{}).getAttribute? main.querySelector('svg').getAttribute('aria-label'):null,
    mainTicks: ladder(main), subTicks: subs.length? ladder(subs[0]):[],
    sub2Ticks: subs.length>1? ladder(subs[1]):[],
    mainEnd: (main.querySelector('.db-pchead span')||{}).textContent || null,
    mainPts: pts(main), subPts: subs.length? pts(subs[0]):null,
    vlinesMain: [...main.querySelectorAll('svg line')].filter(function(l){ return l.getAttribute('y1')==='0'; })
                 .map(function(l){ return parseFloat(l.getAttribute('x1')); })
  };})()`);
if (paint.err) { console.log('FATAL', paint.err); chrome.kill(); server.close(); process.exit(1); }

console.log('\n-- Players panels are on a CALENDAR axis --');
ok('the picked subject is the one asserted on', paint.subject === subject, paint.subject, subject);
ok('Players eyebrow says "season axis"', /season axis/.test(paint.eyebrow), JSON.stringify(paint.eyebrow), 'contains "season axis"');
ok('Players eyebrow no longer claims "match index"', !/match index/i.test(paint.eyebrow), JSON.stringify(paint.eyebrow), 'no "match index"');
ok('Players svg aria-label no longer says "match index"', !/match index/i.test(paint.aria || ''), JSON.stringify(paint.aria), 'no "match index"');

console.log('\n-- tick ladder matches the independently computed calendar positions --');
ok('main ladder has the expected tick count', paint.mainTicks.length === expMain.length, paint.mainTicks.length, expMain.length);
ok('main ladder labels match', JSON.stringify(paint.mainTicks.map(t => t.label)) === JSON.stringify(expMain.map(t => t.label)),
  paint.mainTicks.map(t => t.label).join(','), expMain.map(t => t.label).join(','));
let tickMiss = 0, worst = 0;
paint.mainTicks.forEach((t, i) => {
  const want = expMain[i] ? expMain[i].x * 100 : null;
  if (want == null || !near(t.left, want, 0.01)) tickMiss++;
  if (want != null) worst = Math.max(worst, Math.abs(t.left - want));
});
ok('every main tick sits at (Jan1(y)-d0)/span, recomputed here', tickMiss === 0,
  `${tickMiss} off, worst ${worst.toFixed(4)}pp`, '0 off');
ok('sub ladder has the expected tick count', paint.subTicks.length === expSub.length, paint.subTicks.length, expSub.length);
const subMiss = paint.subTicks.filter((t, i) => !expSub[i] || !near(t.left, expSub[i].x * 100, 0.01)).length;
ok('every sub tick sits at its recomputed calendar position', subMiss === 0, subMiss, 0);
ok('both sub panels carry the identical ladder',
  JSON.stringify(paint.subTicks) === JSON.stringify(paint.sub2Ticks), 'differ', 'identical');
// Shared scale survives the basis change: a sub tick must land on a main tick.
const mainX = paint.mainTicks.map(t => t.left);
ok('every sub tick lands on a main-panel tick (shared scale)',
  paint.subTicks.every(t => mainX.some(x => near(x, t.left, 0.01))), 'a sub tick is off-ladder', 'all on-ladder');

console.log('\n-- the gridlines are UNIFORMLY spaced, which is the point of the ruling --');
// The ruling's stated benefit. On a match index these gaps vary with how busy each
// season was; on a calendar axis one tick step is one fixed number of days.
const gaps = [];
for (let i = 1; i < paint.mainTicks.length; i++) gaps.push(paint.mainTicks[i].left - paint.mainTicks[i - 1].left);
const gmin = Math.min(...gaps), gmax = Math.max(...gaps);
ok('main gridline gaps are equal to within 0.05pp', gaps.length >= 2 && (gmax - gmin) <= 0.05,
  `spread ${(gmax - gmin).toFixed(4)}pp over ${gaps.length} gaps (min ${gmin.toFixed(3)}, max ${gmax.toFixed(3)})`, '<= 0.05pp');
ok('vertical season gridlines are still drawn on the main panel',
  paint.vlinesMain.length === paint.mainTicks.length, paint.vlinesMain.length, paint.mainTicks.length);
const vMiss = paint.vlinesMain.filter((x, i) => !near(x, paint.mainTicks[i].left * 10, 0.2)).length;
ok('each gridline x1 matches its label position', vMiss === 0, vMiss, 0);

console.log('\n-- the curve is on the same basis, and its value is unchanged --');
ok('curve starts at or after x=0 and ends at or before x=1000',
  paint.mainPts[0][0] >= -0.01 && paint.mainPts[paint.mainPts.length - 1][0] <= 1000.01,
  `${paint.mainPts[0][0]}..${paint.mainPts[paint.mainPts.length - 1][0]}`, '0..1000');
// On a calendar axis the first match is NOT at x=0 (d0 is 1 Jan of that season),
// which is exactly what distinguishes it from the index basis.
const firstX = ((minD - d0) / span) * 1000;
ok('first vertex sits at the first MATCH DATE, not at x=0', near(paint.mainPts[0][0], firstX, 1.0),
  paint.mainPts[0][0], firstX.toFixed(1));
ok('x never goes backwards', paint.mainPts.every((p, i) => i === 0 || p[0] >= paint.mainPts[i - 1][0] - 1e-6), 'regression', 'monotonic');
const endTxt = (paint.mainEnd || '').trim();
ok('painted end value equals the independently recomputed total',
  near(parseFloat(endTxt), expEndAll, 0.06), endTxt, expEndAll.toFixed(1) + 'u');
ok('sub panel occupies a SUB-RANGE, not restretched to full width',
  paint.subPts && (paint.subPts[0][0] > 0.5 || paint.subPts[paint.subPts.length - 1][0] < 999.5),
  paint.subPts ? `${paint.subPts[0][0]}..${paint.subPts[paint.subPts.length - 1][0]}` : 'none', 'not 0..1000');

console.log('\n-- the uniform-spacing assertion is NOT vacuous --');
// Last round an assertion held correct constants against a subject no bug could
// move. So: recompute what THIS subject's ladder would have been on the match-index
// basis and show the same tolerance rejects it. If this ever passes, the spacing
// assertion above has stopped discriminating and is worthless.
const ordered = recs.slice().sort((a, b) => a.d - b.d);
const firstIx = new Map();
ordered.forEach((v, i) => { const y = Math.floor(v.d / 10000); if (!firstIx.has(y)) firstIx.set(y, i); });
const iYears = [...firstIx.keys()];
const iDen = (ordered.length - 1) || 1;
let iLad = [];
for (const stp of [2, 1]) { iLad = []; for (let k = 0; k < iYears.length; k += stp) iLad.push(firstIx.get(iYears[k]) / iDen * 100); if (iLad.length >= 3) break; }
const iGaps = []; for (let i = 1; i < iLad.length; i++) iGaps.push(iLad[i] - iLad[i - 1]);
const iSpread = Math.max(...iGaps) - Math.min(...iGaps);
ok('the same tolerance REJECTS the match-index ladder for this subject', iSpread > 0.05,
  `index-basis spread ${iSpread.toFixed(3)}pp`, '> 0.05pp (so the test discriminates)');

console.log('\n-- console --');
// Scoped honestly. These three are LOCAL-ENVIRONMENT artefacts, not page defects:
// Supabase creds are build-time placeholders in this preview and model-output.json
// is a pipeline artefact that is not in the repo. Anything else fails.
const LOCAL_ONLY = /SUPABASE|model-output\.json fetch failed|window\.LiveTab gate unavailable|favicon|preload/i;
const envLogs = c.logs.filter(l => LOCAL_ONLY.test(l));
const noisy = c.logs.filter(l => !LOCAL_ONLY.test(l));
console.log(`  (${envLogs.length} local-environment warning(s) ignored by name, listed for the record)`);
envLogs.forEach(l => console.log('      env: ' + l.slice(0, 120)));
ok('no console error attributable to the Database page', noisy.length === 0, noisy.slice(0, 4).join(' | ') || '0', '0');
ok('nothing in the console mentions the Database tab', !c.logs.some(l => /Database/i.test(l)),
  c.logs.filter(l => /Database/i.test(l))[0] || 'none', 'none');

console.log(`\n${pass + fail} assertions, ${pass} pass, ${fail} fail`);
if (fail) console.log('FAILED: ' + fails.join('; '));
try { fs.unlinkSync(path.join(WT, preview)); } catch { }
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
