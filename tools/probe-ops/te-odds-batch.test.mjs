import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teb-'));
process.env.TE_CACHE = path.join(tmp, 'cache'); process.env.TE_ODDS_OUT = path.join(tmp, 'out'); process.env.TE_OPS = path.join(tmp, 'ops'); process.env.TE_DELAY_MS = '0'; process.env.TE_NET_WAIT_MS = '0';
const M = await import('./te-odds-batch.mjs');
let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok', n); };
// --- real rows (results list 2025-07-20, log of the row-shape check)
const LIST = `<table><tr class="head flags"><td class="t-name" colspan="2"><a href="/umag/2025/atp-men/"><span class="fl fl-hr">&nbsp;</span>Umag</a></td><td class="course">H</td></tr>
<tr id="r12" class="one fRow bott"><td class="first time" rowspan="2">11:40</td><td class="t-name"><a href="/player/bublik-43f80/">Bublik A.</a> (2)</td><td class="result">2</td><td class="coursew" rowspan="2">1.28</td><td class="course" rowspan="2">3.71</td><td rowspan="2"><a href="/match-detail/?id=2962629" title="Click for match detail">info</a></td></tr>
<tr id="r12b" class="one"><td class="t-name"><a href="/player/cerundolo-08df6/">Cerundolo J.</a></td><td class="result">1</td></tr>
<tr class="head flags"><td class="t-name" colspan="2"><a href="/m15-monastir/2025/atp-men/">ITF M15 Monastir</a></td></tr>
<tr id="r13" class="two fRow bott"><td class="first time" rowspan="2">10:00</td><td class="t-name"><a href="/player/bublik-x/">Bublik A.</a></td><td rowspan="2"><a href="/match-detail/?id=999" title="x">info</a></td></tr>
<tr id="r13b" class="two"><td class="t-name"><a href="/player/cer-x/">Cerundolo J.</a></td></tr>
<tr class="head flags"><td class="t-name" colspan="2"><a href="/granby-challenger/2025/atp-men/">Granby challenger</a></td></tr>
<tr id="r14" class="one fRow bott"><td class="first time" rowspan="2">18:00</td><td class="t-name"><a href="/player/de-jong-57322/">De Jong J.</a></td><td rowspan="2"><a href="/match-detail/?id=555" title="x">info</a></td></tr>
<tr id="r14b" class="one"><td class="t-name"><a href="/player/davidovich-fokina/">Davidovich Fokina A.</a></td></tr></table>` + 'x'.repeat(3000);
const ROW10 = `<tr class="one">
<td class="first tl"><a href="https://x" class="icons"><span class="i eLink">&nbsp;</span><span class="t">Pinnacle</span></a></td>
<td class="k1"><div class="odds-in odown">1.36<div class="odds-change-div"><table cellspacing="0"><tr><td>20.07. 11:18</td><td class="bold">1.36</td><td class="diff-down">-0.01</td></tr><tr><td>20.07. 09:00</td><td class="bold">1.37</td><td class="diff-down">-0.01</td></tr><tr><td colspan="3" class="title">Opening odds</td></tr><tr><td>19.07. 07:48</td><td class="bold">1.38</td><td class="diff-down">&nbsp</td></tr></table></div></div></td>
<td class="k2"><div class="odds-in">2.90</div></td>
</tr>`;
const DETAIL = (k1, k2, date) => `<div id="center"><table><tr><td>${k1} - ${k2} ${date} , 11:40, Umag, final, clay</td></tr></table></div>
<table class="result " cellspacing="0"><tbody><tr class="head"><td class="tl"> </td><td class="k1">${k1}</td><td class="k2">${k2}</td></tr>
<tr class="two"><td class="first tl"><a href="https://y" class="icons"><span class="t">bet365</span></a></td><td class="k1"><div class="odds-in">1.35</div></td><td class="k2"><div class="odds-in">2.84</div></td></tr>
${ROW10}</tbody></table><table class="result"><tbody><tr class="head"><td>Over/Under</td></tr></tbody></table>` + 'y'.repeat(3000);

t('list: pairs rN + rNb, tournament header, names, ITF tagged by header', () => {
  const L = M.listMatches(LIST);
  assert.equal(L.length, 3);
  assert.deepEqual([L[0].teId, L[0].p1.name, L[0].p2.name, L[0].tour, L[0].time], ['2962629', 'Bublik A.', 'Cerundolo J.', 'Umag', '11:40']);
  assert.match(L[1].tour, /ITF/);
});
t('names: TE "Surname I." / full first names vs api-tennis "I. Surname"; brothers and namesakes apart', () => {
  assert(M.samePlayer('Bublik A.', 'A. Bublik'));
  assert(M.samePlayer('Davidovich Fokina A.', 'A. Davidovich Fokina'));
  assert(M.samePlayer('Millman John', 'J. Millman'));
  assert(M.samePlayer('Cerundolo Juan Manuel', 'J. M. Cerundolo'));
  assert(!M.samePlayer('Cerundolo J.', 'F. Cerundolo'));
  assert(!M.samePlayer('Martin A.', 'A. Lopez San Martin'));
  assert(M.samePlayer('Carreno Busta P.', 'P. Carreno'));
  assert(!M.samePlayer('Zverev M.', 'A. Zverev'));
  assert(!M.samePlayer('De Jong J.', 'J. Jong'));
  assert(M.samePlayer("O Connell C.", "C. O'Connell"));
  assert(M.samePlayer('Wu Tung-Lin', 'Wu Tung-Lin'));
  assert(M.samePlayer('Wu T.', 'Wu Tung-Lin'));
  assert(M.samePlayer('Cerundolo Juan Manuel', 'J. M. Cerundolo'));
  assert(!M.samePlayer('Cerundolo Juan Manuel', 'F. Cerundolo'), 'a brother through a full first name');
  assert(!M.samePlayer('Zverev Mischa', 'A. Zverev'), 'a brother through a full first name');
  assert(M.samePlayer('Zverev Alexander', 'A. Zverev'));
});
t('match page: Pinnacle last + open with times, a side with no tooltip = never moved, books listed', () => {
  const mp = M.matchPage(DETAIL('Bublik Alexander', 'Cerundolo Juan Manuel', '20.07.2025'));
  assert.deepEqual(mp.books, ['bet365', 'Pinnacle']);
  assert.equal(mp.date, '2025-07-20');
  assert.deepEqual(mp.pin.k1, { last: 1.36, lastTs: '20.07. 11:18', open: 1.38, openTs: '19.07. 07:48', moves: 2 });
  assert.deepEqual(mp.pin.k2, { last: 2.9, lastTs: null, open: 2.9, openTs: null, moves: 0 });
});
t('Prague -> UTC through the tz database: CEST +2, CET +1, December stamp on a January match', () => {
  assert.equal(M.pragueToUtc('20.07. 11:18', '2025-07-20'), '2025-07-20T09:18:00Z');
  assert.equal(M.pragueToUtc('10.11. 11:18', '2025-11-10'), '2025-11-10T10:18:00Z');
  assert.equal(M.pragueToUtc('31.12. 23:30', '2025-01-02'), '2024-12-31T22:30:00Z');
  assert.equal(M.pragueToUtc(null, '2025-01-02'), null);
});
t('error page = STOP', () => {
  assert(M.isErrorPage(403, 'x'.repeat(5000))); assert(M.isErrorPage(200, 'short'));
  assert(M.isErrorPage(200, 'Attention Required' + 'x'.repeat(5000))); assert(!M.isErrorPage(200, 'x'.repeat(5000)));
});
// a full batch on fakes: join, ambiguity, ITF never read, orientation, stop on an error page
const OPS = process.env.TE_OPS; fs.mkdirSync(path.join(OPS, 'te-targets'), { recursive: true });
const tg = [
  { ek: '1', level: 'ch', date: '2025-07-20', a: 'J. Cerundolo', b: 'A. Bublik', close: { p1: 2.9, p2: 1.36, startTs: '2025-07-20T09:40:00Z' } },   // reversed order on TE
  { ek: '2', level: 'ch', date: '2025-07-20', a: 'J. De Jong', b: 'A. Davidovich Fokina' },
  { ek: '3', level: 'ch', date: '2025-07-20', a: 'X. Nobody', b: 'Y. Noone' },
];
fs.writeFileSync(path.join(OPS, 'te-targets', 't.json'), JSON.stringify({ rows: tg }));
const seen = [];
const fake = (bad) => async (url) => { seen.push(url); const u = new URL(url);
  if (bad && u.pathname === '/match-detail/' && u.searchParams.get('id') === '555') return { status: 403, text: async () => 'blocked' };
  if (u.pathname === '/results/') return { status: 200, text: async () => (u.searchParams.get('day') === '20' ? LIST : 'z'.repeat(4000)) };
  if (u.searchParams.get('id') === '2962629') return { status: 200, text: async () => DETAIL('Bublik Alexander', 'Cerundolo Juan Manuel', '20.07.2025') };
  if (u.searchParams.get('id') === '555') return { status: 200, text: async () => DETAIL('De Jong Jesper', 'Davidovich Fokina Alejandro', '20.07.2025').replace(/Pinnacle/, 'Unibet') };
  return { status: 404, text: async () => '' }; };
const doc = await M.runBatch({ id: 'calib-01', file: 't.json', from: '2025-07-20', to: '2025-07-20' }, { fetchImpl: fake(false), today: '2026-10-19' });
t('batch: lists read for d-1..d+1, joined both ways, oriented to api-tennis, ITF page never read', () => {
  assert.equal(doc.complete, true);
  assert.equal(seen.filter((u) => u.includes('/results/')).length, 3);
  assert(!seen.some((u) => u.includes('id=999')), 'the ITF match page was read');
  const r1 = doc.rows.find((r) => r.ek === '1');
  assert.equal(r1.status, 'joined'); assert.equal(r1.pin.p1, 2.9); assert.equal(r1.pin.p2, 1.36);
  assert.equal(r1.pin.p2Ts, '2025-07-20T09:18:00Z'); assert.equal(r1.pin.open.p2, 1.38); assert.equal(r1.pin.p1Ts, null);
  assert.match(r1.pageSha256, /^[0-9a-f]{64}$/);
  const r2 = doc.rows.find((r) => r.ek === '2'); assert.equal(r2.status, 'joined'); assert.equal(r2.pin, null);   // no Pinnacle on the page: a dash
  assert.equal(doc.rows.find((r) => r.ek === '3').status, 'not found');
  assert.equal(doc.summary.joined, 2); assert.equal(doc.summary.pinnacle, 1);
  assert.equal(doc.calibration.n, 1); assert.equal(doc.calibration.exact, 1); assert.equal(doc.calibration.lastChangeToStartMin.median, 22);
  console.log('   ' + M.line(doc).split('\n').join('\n   '));
});
t('ambiguous: two TE matches of one pair within the window = no row', () => {
  const L2 = LIST.replace('id="r14"', 'id="r14"').replace('</table>', `<tr class="head flags"><td class="t-name" colspan="2"><a href="/x-challenger/2025/atp-men/">X challenger</a></td></tr><tr id="r20" class="one"><td class="first time">1:00</td><td class="t-name"><a href="/player/a/">De Jong J.</a></td><td><a href="/match-detail/?id=777">info</a></td></tr><tr id="r20b"><td class="t-name"><a href="/player/b/">Davidovich Fokina A.</a></td></tr></table>`);
  assert.equal(M.listMatches(L2).filter((m) => /De Jong/.test(m.p1.name)).length, 2);
  globalThis.__L2 = L2;
});
fs.rmSync(process.env.TE_CACHE, { recursive: true, force: true }); seen.length = 0;
const fakeAmb = async (url) => { const u = new URL(url); seen.push(url);
  if (u.pathname === '/results/') return { status: 200, text: async () => (u.searchParams.get('day') === '20' ? globalThis.__L2 : 'z'.repeat(4000)) };
  return fake(false)(url); };
const d3 = await M.runBatch({ id: 'x-01', file: 't.json', from: '2025-07-20', to: '2025-07-20' }, { fetchImpl: fakeAmb, today: '2026-10-19' });
t('ambiguous in a batch: no row, no match page read, both candidates named', () => {
  const r2 = d3.rows.find((r) => r.ek === '2'); assert.equal(r2.status, 'ambiguous'); assert.deepEqual(r2.candidates.sort(), ['555', '777']);
  assert(!seen.some((u) => /id=(555|777)/.test(u)));
  assert.equal(d3.rows.find((r) => r.ek === '1').status, 'joined');
});
// stop on the first error page, nothing retried, partial kept
fs.rmSync(process.env.TE_CACHE, { recursive: true, force: true }); seen.length = 0;
const d2 = await M.runBatch({ id: 'calib-01', file: 't.json', from: '2025-07-20', to: '2025-07-20' }, { fetchImpl: fake(true), today: '2026-10-19' });
t('STOP on the first error PAGE, never retried, the file says so', () => {
  assert.equal(d2.complete, false); assert.match(d2.summary.stop, /HTTP 403/);
  assert.equal(seen.filter((u) => u.includes('id=555')).length, 1);
  assert.match(M.line(d2), /STOP/);
});

// ── the calib-01 v1 bug (founder 2026-10-20: 103 of 103 "page disagrees") ──────────────────────────────────────────
const PAD = '<script>' + 'v'.repeat(5000) + '</script>';
const REAL_SHAPE = (k1, k2, date) => `<div id="center">${PAD}<table class="result gDetail"><tbody><tr><th class="plName"><a href="/player/bublik-43f80/">Bublik Alexander</a></th>` +
  `<td>${date} , 11:40, Gstaad, final, clay</td><th class="plName"><a href="/player/cerundolo-08df6/">Cerundolo Juan Manuel</a></th></tr></tbody></table></div>` +
  `<table class="result" cellspacing="0"><tbody><tr class="head"><td class="tl"> </td><td class="k1 first">${k1}</td><td class="k2 first">${k2}</td></tr>${ROW10}</tbody></table>` + 'y'.repeat(3000);
t('v1 failure modes this fix covers (a SHAPE, not a real page): the date beyond 4,000 characters of #center, k1 / k2 cells with extra classes', () => {
  const html = REAL_SHAPE('Bublik Alexander', 'Cerundolo Juan Manuel', '20.07.2025');
  const L = M.legacyPageCheck(html); assert.equal(L.date, null); assert.equal(L.k1, '');      // the control: v1 sees nothing
  const mp = M.matchPage(html);
  assert.equal(mp.date, '2025-07-20'); assert.equal(mp.k1, 'Bublik Alexander'); assert.deepEqual(mp.players, ['Bublik Alexander', 'Cerundolo Juan Manuel']);
  const c = M.pageCheck(mp, { a: 'J. Cerundolo', b: 'A. Bublik', date: '2025-07-20' });
  assert.equal(c.ok, true); assert.equal(c.orientation, 'ba'); assert.equal(c.orientedBy, 'odds head');
});
t('page check: the header alone checks the names; a wrong player, a wrong date or two sources in different orders still disagree', () => {
  const noHead = M.matchPage(REAL_SHAPE('', '', '20.07.2025'));
  const c = M.pageCheck(noHead, { a: 'A. Bublik', b: 'J. Cerundolo', date: '2025-07-21' }); assert.equal(c.ok, true); assert.equal(c.orientedBy, 'match header');
  assert.equal(M.pageCheck(noHead, { a: 'A. Bublik', b: 'F. Cerundolo', date: '2025-07-20' }).ok, false);   // brother
  assert.match(M.pageCheck(noHead, { a: 'A. Bublik', b: 'J. Cerundolo', date: '2025-07-23' }).why.join(), /more than 1 day/);
  const swapped = M.matchPage(REAL_SHAPE('Cerundolo Juan Manuel', 'Bublik Alexander', '20.07.2025'));
  assert.match(M.pageCheck(swapped, { a: 'A. Bublik', b: 'J. Cerundolo', date: '2025-07-20' }).why.join(), /different orders/);
});
// network failure: tried again (NET_TRIES), an error PAGE never
const netFake = (failTimes) => { let n = 0; return async (url) => { const u = new URL(url);
  if (u.pathname === '/match-detail/' && u.searchParams.get('id') === '2962629' && n++ < failTimes) { seen.push(url); throw new TypeError('fetch failed'); }
  return fake(false)(url); }; };
fs.rmSync(process.env.TE_CACHE, { recursive: true, force: true }); seen.length = 0;
const dn1 = await M.runBatch({ id: 'n-01', file: 't.json', from: '2025-07-20', to: '2025-07-20' }, { fetchImpl: netFake(2), today: '2026-10-19' });
t('network failure: tried again, joined on the third try, the retries counted', () => {
  assert.equal(dn1.complete, true); assert.equal(dn1.rows.find((r) => r.ek === '1').status, 'joined');
  assert.equal(seen.filter((u) => u.includes('id=2962629')).length, 3); assert.equal(dn1.summary.netRetries, 2);
});
fs.rmSync(process.env.TE_CACHE, { recursive: true, force: true }); seen.length = 0;
const dn2 = await M.runBatch({ id: 'n-02', file: 't.json', from: '2025-07-20', to: '2025-07-20' }, { fetchImpl: netFake(9), today: '2026-10-19' });
t('network failure 3 times: STOP, the cache and the file kept', () => {
  assert.equal(dn2.complete, false); assert.match(dn2.summary.stop, /network error .*3 tries/);
  assert.equal(seen.filter((u) => u.includes('id=2962629')).length, M.NET_TRIES);
});
t('an error PAGE is still a STOP on the first answer (the 403 above: 1 request)', () => {
  assert.equal(d2.summary.netRetries, 0); assert.match(d2.summary.stop, /HTTP 403/);
});
// offline re-check: the cache only, never a request
M.setOffline(true); seen.length = 0;
const neverFetch = async (url) => { seen.push(url); throw new Error('offline mode made a request'); };
const doff = await M.runBatch({ id: 'n-02', file: 't.json', from: '2025-07-20', to: '2025-07-20' }, { fetchImpl: neverFetch, today: '2026-10-19' });
t('--offline: no request at all; stops at the first page not in the cache and says so', () => {
  assert.equal(seen.length, 0); assert.match(doff.summary.offline, /not in the cache/);
  assert(fs.existsSync(path.join(process.env.TE_ODDS_OUT, 'n-02.offline.json')));
});
M.setOffline(false);

t('flags: a value-less flag last on the line, or before another flag, takes its default (the --save-fixtures crash)', () => {
  assert.equal(M.argOf(['node', 'x', 'calib-01', '--offline', '--save-fixtures'], '--save-fixtures', 'DEF'), 'DEF');
  assert.equal(M.argOf(['node', 'x', '--save-fixtures', '--explain', '3'], '--save-fixtures', 'DEF'), 'DEF');
  assert.equal(M.argOf(['node', 'x', '--save-fixtures', '/tmp/fx'], '--save-fixtures', 'DEF'), '/tmp/fx');
  assert.equal(M.argOf(['node', 'x', '--explain', '3'], '--explain', 9), '3');
  assert.equal(M.argOf(['node', 'x'], '--hours', 8), 8);
});
// the CLI end to end: --offline --explain 3 --save-fixtures (last), on a cache with one batch's pages, no request
{
  const { execFileSync } = await import('node:child_process');
  const plan = { batches: [{ id: 'cli-01', file: 't.json', from: '2025-07-20', to: '2025-07-20', targets: 3, estRequests: 5 }] };
  fs.writeFileSync(path.join(OPS, 'te-targets', 'batches.json'), JSON.stringify(plan));
  fs.rmSync(process.env.TE_CACHE, { recursive: true, force: true });
  await M.runBatch({ id: 'cli-warm', file: 't.json', from: '2025-07-20', to: '2025-07-20' }, { fetchImpl: fake(false), today: '2026-10-19' });   // fills the cache
  const fxdir = path.join(OPS, 'tools', 'fixtures', 'te-calib');
  const out = execFileSync(process.execPath, [new URL('./te-odds-batch.mjs', import.meta.url).pathname, 'cli-01', '--offline', '--explain', '3', '--save-fixtures'],
    { env: { ...process.env }, encoding: 'utf8' });
  t('CLI: --offline --explain 3 --save-fixtures writes the pages and pages.json into tools/fixtures/te-calib, no crash', () => {
    assert.match(out, /OFFLINE re-check/); assert.match(out, /saved \d+ cached match pages/);
    const pj = JSON.parse(fs.readFileSync(path.join(fxdir, 'pages.json'), 'utf8'));
    assert(pj.pages.length >= 1); for (const p of pj.pages) assert(fs.existsSync(path.join(fxdir, `match-${p.teId}.html`)));
  });
}
// real cached pages from calib-01 (private fixtures in this repo, written by `--offline --save-fixtures`)
const FX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'te-calib');
if (!fs.existsSync(path.join(FX, 'pages.json'))) {
  console.log(`SKIP (out loud): no real calib-01 pages in ${FX} yet — run the offline re-check with --save-fixtures and commit them`);
} else {
  const P = JSON.parse(fs.readFileSync(path.join(FX, 'pages.json'), 'utf8')).pages;
  t(`real calib-01 pages (${P.length}): v1 rejected every one; the current check joins them with the right names and date`, () => {
    assert(P.length >= 3, 'fewer than 3 real pages');
    for (const x of P) {
      const html = fs.readFileSync(path.join(FX, `match-${x.teId}.html`), 'utf8');
      const L = M.legacyPageCheck(html);
      const v1ok = ((M.samePlayer(L.k1, x.a) && M.samePlayer(L.k2, x.b)) !== (M.samePlayer(L.k1, x.b) && M.samePlayer(L.k2, x.a))) && !!L.date && Math.abs(Date.parse(L.date) - Date.parse(x.date)) <= 864e5;
      assert.equal(v1ok, false, `v1 accepted ${x.teId}: the control is not a control`);
      const c = M.pageCheck(M.matchPage(html), x);
      assert.equal(c.ok, true, `${x.teId}: ${c.why.join('; ')}`);
    }
  });
}
console.log(`${ok} checks passed`);
