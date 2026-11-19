// Lines field under the side, price-band, opponent-archetype and level filters (founder review 2026-11-18: "Field / Edge
// empty under As favourite: not normal, fix it"). lines-field.json (build-lines-field.js) covers format x surface x period
// only; these cuts need the Database price join, the archetype table and the tournament catalogue, which live in the page.
// So this runs the PAGE'S OWN tally (DatabaseTab.lnCutTally) in headless Chrome over the same roster build-lines-field.js
// uses (surface-ratings.json minus retired-players.json, name -> key by exact player-profiles.json name), and writes
// lines-field-cuts.json: cuts["fmt|surf|scope|P|X"][line] = [median rate, field size], a player in a line's field from
// LN_MIN_N matches on it (the page's rate gate). The page loads it only while such a filter is on.
// Usage: node tools/build-lines-field-cuts.mjs --site _site [--out _site/lines-field-cuts.json] [--base URL] [--limit N]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, statSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LIVE = arg('--base', null), SITE = resolve(arg('--site', '_site')), LIMIT = +arg('--limit', 0);
const OUT = arg('--out', join(SITE, 'lines-field-cuts.json'));
const PAGE = LIVE || existsSync(join(SITE, 'bsp-consult-dashboard.html')) ? 'bsp-consult-dashboard.html' : 'index.html';
const die = (m) => { console.error('build-lines-field-cuts FAILED: ' + m); process.exit(1); };

const BASE0 = LIVE ? LIVE.replace(/\/?$/, '/') : null;
const readJson = async (rel) => {
  if (BASE0) { const r = await fetch(BASE0 + rel, { cache: 'no-store' }); return r.ok ? r.json() : undefined; }
  const p = join(SITE, rel); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
};
// the roster, exactly as build-lines-field.js builds it
const ratings = await readJson('surface-ratings.json'), profiles = await readJson('player-profiles.json'), retired = await readJson('retired-players.json');
if (!ratings || !Array.isArray(ratings.players) || !ratings.players.length) die('surface-ratings.json missing or empty');
if (!profiles || !profiles.players) die('player-profiles.json missing');
if (!retired || !Array.isArray(retired.retired)) die('retired-players.json missing or has no retired[]');
const byName = {};
for (const k of Object.keys(profiles.players)) { const p = profiles.players[k]; if (p && p.name != null && !(p.name in byName)) byName[p.name] = String(k); }
const out0 = new Set(retired.retired.map(r => r && r.name).filter(Boolean));
let roster = ratings.players.map(p => p.name).filter(nm => !out0.has(nm) && byName[nm]).map(nm => [nm, byName[nm]]);
if (LIMIT) roster = roster.slice(0, LIMIT);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const p = normalize(join(SITE, u === '/' ? PAGE : u));
  if (!p.startsWith(SITE) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
});
if (!LIVE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = BASE0 || `http://127.0.0.1:${server.address().port}/`;

const dir = mkdtempSync(join(tmpdir(), 'lfc-'));
const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu',
  '--no-sandbox', `--user-data-dir=${join(dir, 'u')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const fail = (m) => { try { ch.kill('SIGKILL'); } catch (e) { /* gone */ } if (!LIVE) server.close(); die(m); };
ch.on('error', e => fail('Chrome did not start (' + e.message + ')'));
const port = await new Promise((res, rej) => { let s = ''; const t = setTimeout(() => rej(new Error('no DevTools port')), 30000);
  ch.stderr.on('data', d => { s += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(s); if (m) { clearTimeout(t); res(+m[1]); } }); }).catch(e => fail(e.message));
const tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const wait = new Map();
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  else if (m.method === 'Fetch.requestPaused') send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' }); });
const E = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
await send('Page.enable'); await send('Runtime.enable');
// a signed-out visit is sent to auth.html: this read-only build stays on the page (nothing is signed in or written)
await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.html*', resourceType: 'Document' }, { urlPattern: '*verify.html*', resourceType: 'Document' }] });
await send('Page.navigate', { url: BASE + PAGE });
const t0 = Date.now();
while (!(await E(`!!(window.DatabaseTab && window.DatabaseTab.lnCutTally && window.H2HPage && window.H2HPage.priceJoin && typeof sfDbJoinLoad === 'function')`).catch(() => false))) {
  if (Date.now() - t0 > 120000) fail('the page never exposed DatabaseTab.lnCutTally');
  await new Promise(r => setTimeout(r, 500));
}
let res;
try {
  res = await E(`(async () => {
    const roster = ${JSON.stringify(roster)};
    await sfDbJoinLoad();
    if (!(playerStyles && playerStyles.data)) await loadPlayerStyles();
    if (!(playerStyles && playerStyles.data)) throw new Error('playing-styles.json did not load: no archetype cut');
    const LNF = await DatabaseTab.lnLoadField();
    if (!LNF) throw new Error('lines-field.json did not load: the Last 52 weeks cutoff would differ from the base field');
    const MIN = LNF.minN, F = {}, failed = [];
    let players = 0;
    for (const [nm, k] of roster) {
      const ms = await loadCareerHistory(k).catch(() => null);
      // loadCareerHistory caches only an answered shard (a failed load resolves [] uncached): the cache tells the two apart
      if (!Array.isArray(ms) || !(String(k) in _careerHistoryShards)) { failed.push(nm); continue; }
      const T = DatabaseTab.lnCutTally(nm, ms);
      if (!T) { failed.push(nm + ' (no price join)'); continue; }
      players++;
      for (const ck in T) for (const ln in T[ck]) { const t = T[ck][ln]; if (t[1] >= MIN) ((F[ck] = F[ck] || {})[ln] = F[ck][ln] || []).push(t[0] / t[1] * 100); }
    }
    const med = a => { a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
    const cuts = {};
    for (const ck in F) { cuts[ck] = {}; for (const ln in F[ck]) cuts[ck][ln] = [Math.round(med(F[ck][ln]) * 1000) / 1000, F[ck][ln].length]; }
    return { cuts, players, failed, minN: MIN, l52Cutoff: LNF.l52Cutoff, dogBands: DatabaseTab.dogBands };
  })()`);
} catch (e) { fail(e.message); }
try { ch.kill('SIGKILL'); } catch (e) { /* gone */ } if (!LIVE) server.close();
// a shard that fails to load shifts every median: fail, as build-lines-field.js does
if (res.failed.length) die(res.failed.length + ' roster player(s) not tallied: ' + res.failed.slice(0, 5).join('; '));
const body = JSON.stringify({ _doc: 'Lines field under the side / price band / opponent archetype / level filters. cuts["fmt|surf|scope|P|X"][line] = [median cover %, field size]. Built by tools/build-lines-field-cuts.mjs from the page\'s own DatabaseTab.lnCutTally.',
  builtAt: new Date().toISOString(), l52Cutoff: res.l52Cutoff, minN: res.minN, dogBands: res.dogBands, players: res.players, cuts: res.cuts });
writeFileSync(OUT + '.tmp', body); renameSync(OUT + '.tmp', OUT);
console.log(`lines-field-cuts: ${res.players} players · ${Object.keys(res.cuts).length} cuts · ${body.length} B raw, ${gzipSync(body).length} B gzip -> ${OUT}`);
process.exit(0);
