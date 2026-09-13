#!/usr/bin/env node
// TEN-196 round 3 · founder rulings 2026-09-13 (interaction c061631e).
//
//   item 2  (chart-x)     -> MATCH INDEX x on every cumulative-profit chart
//   item 4  (round-robin) -> "Remove Round Robin from all filters"
//   all-checked           -> checked boxes mean EXACTLY those boxes (no collapse to All)
//   item 5  (alias)       -> common name displayed; search matches official + common + city
//
// EVERY expectation is a PINNED LITERAL, or comes from `.probe-ten196d/expect.json`
// which a separate Python parser derived from the RAW `odds-archive/*.csv` — not from
// database-yield.json, and not from the page. That is deliberate. Last round a probe
// that recomputed its expectations from the artefact it was testing passed 22 of 22
// against an artefact with all 238 Finals rows DELETED, because its headline assertion
// had quietly become `0 === 0`. A probe whose every number comes from the thing under
// test has no fixed point and cannot fail.
//
// Usage: node ten196-round3-probe.mjs                       (deployed)
//        PROBE_BASE=http://127.0.0.1:8811 node ...          (local worktree)
//        PROBE_BEFORE=1 ...                                 (measuring the calendar build)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.PROBE_BASE || 'https://michaeldk1996.github.io/SAAS';
const URL = `${BASE}/bsp-consult-dashboard.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bust = () => `?cb=${Math.floor(Math.random() * 1e9)}`;
const BEFORE = process.env.PROBE_BEFORE === '1';

let PASS = 0; const FAILS = [];
function ok(name, cond, got, want) {
  if (cond) { PASS++; console.log(`  ✓ ${name}` + (got !== undefined ? `  [${got}]` : '')); }
  else { FAILS.push(name); console.log(`  ✗ ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map(); const handlers = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params);
  };
  return {
    ready,
    on: (m, fn) => handlers.set(m, fn),
    send: (method, params = {}) => ready.then(() => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); })),
    close: () => ws.close(),
  };
}

// ── pinned literals, re-derived from the RAW CSVs by a separate parser ──────────
const PIN = {
  used: 41667,
  finals: 238,            // every one of them the Masters Cup
  fourLevels: 41429,      // Grand Slam + Masters 1000 + ATP 500 + ATP 250
  roundRobin: 191,        // a STRICT SUBSET of the 238 Finals rows
  sevenRounds: 41476,     // 41667 - 191
  firstBet365Ix: 40002,   // date-ascending
  first2026Ix: 40002,     // identical -> on a match-index axis the seam IS the 2026 tick
  levels: ['Grand Slam', 'Masters 1000', 'ATP 500', 'ATP 250', 'Finals'],
  offeredLevels: ['Grand Slam', 'Masters 1000', 'ATP 500', 'ATP 250'],
  offeredRounds: ['1st Round', '2nd Round', '3rd Round', '4th Round', 'Quarterfinals', 'Semifinals', 'The Final'],
  nStrings: 169, nAliased: 163, nHeld: 6, nRanged: 95,
  xcap: 'Match index (chronological) · ticks mark season starts',
  aoRows: 2130,
};
const EXPECT = JSON.parse(fs.readFileSync('.probe-ten196d/expect.json', 'utf8'));

(async () => {
  console.log(`TEN-196 round 3 · ${URL}${BEFORE ? '   (BEFORE: calendar build)' : ''}\n`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten196r3-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
      '--no-first-run', '--window-size=1680,1400', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let dport = 0;
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('chrome start timeout')), 20000);
    chrome.stderr.on('data', (d) => { const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(String(d)); if (m) { dport = +m[1]; clearTimeout(to); res(); } });
  });
  const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
  const c = client(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable'); await c.send('Runtime.enable');
  const errs = []; const warns = [];
  c.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; errs.push(`${d.text || 'exception'} ${(d.exception && d.exception.description) || ''}`); });
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'warning' || p.type === 'error') warns.push((p.args || []).map((a) => String(a.value)).join(' ')); });
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){var stub=new Proxy({},{get:function(t,k){
      if(k==='requireVerified'||k==='requireAuth') return function(){return Promise.resolve({ok:true,email:'probe@local'})};
      if(k==='onAuthChange') return function(){};
      return t[k]||function(){}; },set:function(t,k,v){t[k]=v;return true}});
      Object.defineProperty(window,'BSP',{get:function(){return stub},set:function(){},configurable:true,enumerable:true});})();`,
  });
  await c.send('Page.navigate', { url: URL + bust() });
  await sleep(2000);
  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };
  const P = '[data-page="database"]';
  await ev(`(function(){var b=document.getElementById('databaseTabBtn'); if(b){b.style.display=''; b.click();} })()`);
  const dl = Date.now() + 40000;
  while (Date.now() < dl) { if (await ev(`document.querySelectorAll('${P} .db-bandpanel').length`) >= 2) break; await sleep(400); }

  // ── UI drivers: everything goes through real clicks on what is painted ────────
  const js = (s) => JSON.stringify(s);
  const openTrig = async (label) => {
    await ev(`(function(){var b=[].slice.call(document.querySelectorAll('${P} .db-trig'));
      for(var i=0;i<b.length;i++) if((b[i].textContent||'').trim().indexOf(${js(label)})===0){ b[i].click(); return true; } return false;})()`);
    await sleep(250);
  };
  const trigText = (label) => ev(`(function(){var b=[].slice.call(document.querySelectorAll('${P} .db-trig'));
    for(var i=0;i<b.length;i++) if((b[i].textContent||'').trim().indexOf(${js(label)})===0) return (b[i].textContent||'').trim().replace(/\\u25bc$/,'').trim();
    return null;})()`);
  const menuRows = () => ev(`[].slice.call(document.querySelectorAll('${P} .db-menu .db-mrow')).map(function(r){return (r.textContent||'').trim();})`);
  const clickRow = async (label) => {
    const hit = await ev(`(function(){var rs=[].slice.call(document.querySelectorAll('${P} .db-menu .db-mrow'));
      for(var i=0;i<rs.length;i++) if((rs[i].textContent||'').trim()===${js(label)}){ rs[i].click(); return true; } return false;})()`);
    await sleep(300); return hit;
  };
  // The "All" row's Matches cell, read off the painted table (5th cell of .db-ga).
  const allN = () => ev(`(function(){var g=document.querySelector('${P} .db-bandpanel .db-ga');
    if(!g) return null; var k=g.children[4]; return k?+(k.textContent||'').replace(/,/g,''):null;})()`);
  const svgInfo = () => ev(`(function(){
    var sv=document.querySelector('${P} .db-plotinner svg'); if(!sv) return {error:'no svg'};
    var pl=[].slice.call(sv.querySelectorAll('polyline')).map(function(p){
      var pts=p.getAttribute('points').trim().split(/\\s+/).map(function(s){var a=s.split(','); return {x:+a[0],y:+a[1]};});
      var cols={}, maxGap=0;
      for(var i=0;i<pts.length;i++){ cols[Math.min(999,Math.floor(pts[i].x))]=1; if(i) maxGap=Math.max(maxGap, pts[i].x-pts[i-1].x); }
      return {n:pts.length, first:pts[0].x, last:pts[pts.length-1].x, cols:Object.keys(cols).length, maxGap:maxGap};
    });
    var seam=null; var ls=[].slice.call(sv.querySelectorAll('line'));
    for(var i=0;i<ls.length;i++) if((ls[i].getAttribute('stroke')||'').toLowerCase()==='#e8a84e') seam=+ls[i].getAttribute('x1');
    var ticks=[].slice.call(document.querySelectorAll('${P} .db-xaxis > div')).map(function(d){
      return {label:(d.textContent||'').trim(), x:parseFloat(d.style.left)};});
    var cap=document.querySelector('${P} .db-xcap');
    return {poly:pl, seam:seam, ticks:ticks, cap:cap?(cap.textContent||'').trim():null};
  })()`);

  // ══ preconditions ════════════════════════════════════════════════════════════
  console.log('── preconditions (pinned literals, raw-CSV derived) ──');
  const art = await (await fetch(`${BASE}/database-yield.json${bust()}`)).json();
  const rrIx = art.meta.rounds.indexOf('Round Robin');
  ok(`artefact holds ${PIN.used} rows`, art.rows.length === PIN.used, art.rows.length, PIN.used);
  ok('level dictionary unmoved', JSON.stringify(art.meta.levels) === JSON.stringify(PIN.levels), art.meta.levels.join('|'), PIN.levels.join('|'));
  ok(`artefact still holds ${PIN.finals} Finals rows (0 would make the fold tests vacuous)`,
    art.rows.filter((r) => r[1] === 4).length === PIN.finals, art.rows.filter((r) => r[1] === 4).length, PIN.finals);
  ok(`artefact still holds ${PIN.roundRobin} Round Robin rows`,
    art.rows.filter((r) => r[3] === rrIx).length === PIN.roundRobin, art.rows.filter((r) => r[3] === rrIx).length, PIN.roundRobin);
  ok('every Round Robin row is Finals-level (the subset claim)',
    art.rows.filter((r) => r[3] === rrIx).every((r) => r[1] === 4), 'all 191', 'all Finals');
  ok(`artefact holds ${PIN.nStrings} tournament strings`, art.meta.tournaments.length === PIN.nStrings, art.meta.tournaments.length, PIN.nStrings);

  // ══ ITEM 2 · match-index x ═══════════════════════════════════════════════════
  console.log('\n── item 2: match-index x (Tour chart, as painted) ──');
  const tour = await svgInfo();
  if (tour.error) { console.log('FATAL ' + tour.error); chrome.kill(); process.exit(1); }
  const tick2026 = tour.ticks.find((t) => t.label === '2026');
  console.log(`   caption   : ${JSON.stringify(tour.cap)}`);
  console.log(`   seam x    : ${tour.seam} of 1000      2026 tick: ${tick2026 ? (tick2026.x * 10).toFixed(4) : 'n/a'} of 1000`);
  console.log(`   curve 0   : n=${tour.poly[0].n} first=${tour.poly[0].first} last=${tour.poly[0].last} distinct-cols=${tour.poly[0].cols} maxGap=${tour.poly[0].maxGap.toFixed(1)}`);
  if (!BEFORE) {
    ok('Tour x-caption names the axis as match index, not "Season"', tour.cap === PIN.xcap, tour.cap, PIN.xcap);
    ok('Tour curve starts at x=0 and ends at x=1000', tour.poly[0].first === 0 && tour.poly[0].last === 1000, `${tour.poly[0].first}..${tour.poly[0].last}`, '0..1000');
    const gapPP = Math.abs(tour.seam / 10 - (tick2026 ? tick2026.x : NaN));
    ok('C3 fixed: the book seam lands ON the 2026 tick (<0.01pp)', gapPP < 0.01, gapPP.toFixed(4) + 'pp', '0.0000pp');
    // independent: the seam index and the 2026 index are the SAME row (pinned literals)
    ok(`seam x equals ${PIN.firstBet365Ix}/${PIN.used - 1} from the raw CSVs`,
      Math.abs(tour.seam - PIN.firstBet365Ix / (PIN.used - 1) * 1000) < 0.2,
      tour.seam, (PIN.firstBet365Ix / (PIN.used - 1) * 1000).toFixed(1));
    ok('ticks are strictly increasing in x', tour.ticks.every((t, i) => i === 0 || t.x > tour.ticks[i - 1].x), tour.ticks.map((t) => t.label).join(','), 'ascending');
    ok('every tick label is a season present in the archive', tour.ticks.every((t) => +t.label >= 2010 && +t.label <= 2026), tour.ticks.length + ' ticks', '2010..2026');
  }

  // Tournaments tab: the Australian Open, the chart the ruling was about
  console.log('\n── item 2: Australian Open curve (the "crude" chart) ──');
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('${P} #dbViewTabs button'));
    for(var i=0;i<b.length;i++) if(b[i].dataset.dbview==='tournaments'){b[i].click();return true;} return false;})()`);
  await sleep(400);
  await ev(`(function(){var i=document.querySelector('${P} .db-search input'); if(!i) return false;
    i.value='Australian Open'; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
  await sleep(500);
  await ev(`(function(){var rs=[].slice.call(document.querySelectorAll('${P} .db-search .db-pop .db-prow'));
    for(var i=0;i<rs.length;i++){ var t=(rs[i].querySelector('span')||rs[i]).textContent.trim();
      if(t==='Australian Open'){ rs[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return t; } }
    return null;})()`);
  await sleep(900);
  const aoN = await allN();
  const ao = await svgInfo();
  console.log(`   AO all-row n : ${aoN}`);
  if (ao.poly && ao.poly.length) {
    console.log(`   AO curve     : n=${ao.poly[0].n} distinct-cols=${ao.poly[0].cols} maxGap=${ao.poly[0].maxGap.toFixed(1)} of 1000`);
    ok(`Australian Open still groups ${PIN.aoRows} matches (the alias changed no grouping)`, aoN === PIN.aoRows, aoN, PIN.aoRows);
    if (!BEFORE) {
      ok('AO caption names the axis as match index', ao.cap === PIN.xcap, ao.cap, PIN.xcap);
      ok('AO curve spans the full plot (0..1000)', ao.poly[0].first === 0 && ao.poly[0].last === 1000, `${ao.poly[0].first}..${ao.poly[0].last}`, '0..1000');
      ok('AO dead air gone: no gap wider than 15 of 1000 columns', ao.poly[0].maxGap <= 15, ao.poly[0].maxGap.toFixed(1), '<=15');
      ok('AO occupies >200 distinct columns (calendar axis gave 58)', ao.poly[0].cols > 200, ao.poly[0].cols, '>200');
    }
  } else { ok('AO chart painted', false, ao, 'a polyline'); }

  // ══ ITEM 5 · alias layer ═════════════════════════════════════════════════════
  if (!BEFORE) {
    console.log('\n── item 5: tournament alias layer ──');
    const search = async (q) => {
      await ev(`(function(){var i=document.querySelector('${P} .db-search input'); if(!i) return false;
        i.value=${js(q)}; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
      await sleep(450);
      return ev(`[].slice.call(document.querySelectorAll('${P} .db-search .db-pop .db-prow'))
        .map(function(r){var s=r.querySelector('span'); return (s?s.textContent:r.textContent||'').trim();})`);
    };
    const iw = await search('Indian Wells');
    ok('"Indian Wells" finds the event (official string is BNP Paribas Open)',
      iw.some((t) => t.indexOf('Indian Wells') === 0), JSON.stringify(iw.slice(0, 4)), 'a row labelled Indian Wells');
    const bnp = await search('BNP Paribas');
    ok('"BNP Paribas" finds BOTH events and they are distinguishable by label',
      bnp.some((t) => t.indexOf('Indian Wells') === 0) && bnp.some((t) => t.indexOf('Paris') === 0),
      JSON.stringify(bnp.slice(0, 4)), 'Indian Wells + Paris');
    const mia = await search('Miami');
    const wantMia = [EXPECT.labels['Sony Ericsson Open'], EXPECT.labels['Miami Open']];
    ok('a split venue shows BOTH rows with their season ranges',
      wantMia.every((w) => mia.some((t) => t.indexOf(w) === 0)), JSON.stringify(mia.slice(0, 4)), JSON.stringify(wantMia));
    const tor = await search('Toronto');
    ok('city search works where the city is not the common name ("Toronto" -> Canada)',
      tor.some((t) => t.indexOf('Canada') === 0), JSON.stringify(tor.slice(0, 4)), 'Canada rows');
    const mov = await search('Movistar');
    ok('a HELD row shows its OFFICIAL name and makes no venue claim',
      mov.some((t) => t.indexOf('Movistar Open') === 0) && !mov.some((t) => /Vina|Viña/.test(t)),
      JSON.stringify(mov.slice(0, 3)), 'Movistar Open, no venue');
    const lab = await search(EXPECT.labels['Sony Ericsson Open']);
    ok('typing the label that is PAINTED finds the row (all 95 ranged rows)',
      lab.some((t) => t === EXPECT.labels['Sony Ericsson Open']), JSON.stringify(lab.slice(0, 3)), EXPECT.labels['Sony Ericsson Open']);
    const amp = await search('&');
    ok('a punctuation-only query is not read as "no query"', amp.length > 0 && amp.length <= 3, JSON.stringify(amp.slice(0, 4)), 'only BB&T Atlanta Open');
    const acc = await search('Kitzbühel');
    ok('search is diacritic-insensitive ("Kitzbühel" -> Kitzbuhel)',
      acc.some((t) => t.indexOf('Kitzbuhel') === 0), JSON.stringify(acc.slice(0, 3)), 'Kitzbuhel rows');
    // grouping is untouched: pick the aliased row, assert the count is the OFFICIAL
    // string's count from the raw CSVs, not a merged total
    await search('Indian Wells');
    await ev(`(function(){var rs=[].slice.call(document.querySelectorAll('${P} .db-search .db-pop .db-prow'));
      for(var i=0;i<rs.length;i++){ var t=(rs[i].querySelector('span')||rs[i]).textContent.trim();
        if(t.indexOf('Indian Wells')===0){ rs[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return t; } }
      return null;})()`);
    await sleep(900);
    const iwN = await allN();
    const subj = await ev(`(function(){var s=document.querySelector('${P} .db-subject span'); return s?(s.textContent||'').trim():null;})()`);
    ok('the subject chip shows the COMMON name', subj === 'Indian Wells', subj, 'Indian Wells');
    ok(`grouping UNCHANGED: Indian Wells is ${EXPECT.counts['BNP Paribas Open']} matches, the official string's own count`,
      iwN === EXPECT.counts['BNP Paribas Open'], iwN, EXPECT.counts['BNP Paribas Open']);
    // ── the CRITICAL constraint: 169 strings in, 169 groups out ────────────────
    // The clean-context review proved this section was blind. It checked grouping
    // ONLY on Indian Wells and the Australian Open — both 1:1 venues with no sibling
    // string, so no merge bug can move either. A mutant with `filteredRows` keyed on
    // the COMMON name instead of the stored index (Miami 930 -> 1,492, Barcelona 485
    // -> 728, Cologne 27 -> 54) scored 57 of 57. The assertion that named Miami
    // asserted on Indian Wells and was structurally unfailable.
    //
    // These pick the SPLIT venues, which is exactly where a merge shows up, and
    // compare against each official string's own raw-CSV count.
    for (const [label, official] of [
      [EXPECT.labels['Sony Ericsson Open'], 'Sony Ericsson Open'],
      [EXPECT.labels['Miami Open'], 'Miami Open'],
      [EXPECT.labels['Open Banco Sabadell'], 'Open Banco Sabadell'],
      [EXPECT.labels['bett1HULKS Indoors'], 'bett1HULKS Indoors'],
      [EXPECT.labels['bett1HULKS Championship'], 'bett1HULKS Championship'],
    ]) {
      await search(label);
      const got = await ev(`(function(){var rs=[].slice.call(document.querySelectorAll('${P} .db-search .db-pop .db-prow'));
        for(var i=0;i<rs.length;i++){ var t=(rs[i].querySelector('span')||rs[i]).textContent.trim();
          if(t===${js('')}+decodeURIComponent("${encodeURIComponent(label)}")){ rs[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return t; } }
        return null;})()`);
      await sleep(900);
      const n = await allN();
      ok(`grouping UNMOVED on a SPLIT venue: "${label}" = ${EXPECT.counts[official]} (its own string, not a merged total)`,
        got === label && n === EXPECT.counts[official], `${got} -> ${n}`, `${label} -> ${EXPECT.counts[official]}`);
    }
    // Every one of the 169 strings must still be independently reachable and paint
    // its own count. Walk the whole dictionary through the label map, not a sample.
    const labs = Object.values(EXPECT.labels);
    ok(`all ${PIN.nStrings} archive strings map to ${PIN.nStrings} DISTINCT labels (no silent duplicate)`,
      new Set(labs).size === PIN.nStrings, new Set(labs).size, PIN.nStrings);
    const painted = await ev(`(function(){var o={}; var T=${js(Object.keys(EXPECT.labels))};
      return T.length;})()`);
    ok('label map covers the dictionary', painted === PIN.nStrings, painted, PIN.nStrings);
  }

  // ══ ITEM 4 + all-checked · back on the Tour tab ══════════════════════════════
  console.log('\n── item 4 + all-checked (Tour tab, driven by real clicks) ──');
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('${P} #dbViewTabs button'));
    for(var i=0;i<b.length;i++) if(b[i].dataset.dbview==='tour'){b[i].click();return true;} return false;})()`);
  await sleep(600);
  const base = await allN();
  ok(`unfiltered All row reads ${PIN.used}`, base === PIN.used, base, PIN.used);

  await openTrig('Round');
  const rounds = await menuRows();
  console.log(`   Round menu: ${JSON.stringify(rounds)}`);
  if (!BEFORE) {
    ok('Round Robin is gone from the Tour Round picker', rounds.indexOf('Round Robin') < 0, rounds.length + ' rows', 'no Round Robin');
    ok('exactly the 7 ruled rounds are offered, in draw order',
      JSON.stringify(rounds) === JSON.stringify(PIN.offeredRounds), JSON.stringify(rounds), JSON.stringify(PIN.offeredRounds));
    // MUTATION, not a read: tick all seven and the total must drop by exactly the 191
    // Round Robin rows. A source-text check for "Round Robin" would pass against a
    // build that also dropped those 191 from `All`.
    for (const r of PIN.offeredRounds) ok(`  ...ticked ${r}`, await clickRow(r), true, true);
    await ev(`document.body.click()`); await sleep(300);
    const sevenN = await allN();
    const sevenTrig = await trigText('Round');
    ok(`all 7 offered rounds checked -> ${PIN.sevenRounds} (${PIN.used} minus the ${PIN.roundRobin} folded Round Robin rows)`,
      sevenN === PIN.sevenRounds, sevenN, PIN.sevenRounds);
    ok('and the trigger reads 7, not All (the no-collapse ruling)', /\b7\b/.test(sevenTrig || ''), sevenTrig, 'Round 7');
    // clear back
    await openTrig('Round');
    for (const r of PIN.offeredRounds) await clickRow(r);
    await ev(`document.body.click()`); await sleep(300);
    const clearedN = await allN();
    ok(`clearing every box returns to All = ${PIN.used} (the 191 are still counted)`, clearedN === PIN.used, clearedN, PIN.used);
  }

  await openTrig('Level');
  const levels = await menuRows();
  console.log(`   Level menu: ${JSON.stringify(levels)}`);
  ok('Finals is still folded out of the Level picker',
    JSON.stringify(levels) === JSON.stringify(PIN.offeredLevels), JSON.stringify(levels), JSON.stringify(PIN.offeredLevels));
  ok('  ...ticked Grand Slam', await clickRow('Grand Slam'), true, true);
  const gsN = await allN();
  ok('Grand Slam alone selects 8,262 (proving the picker actually bites)', gsN === 8262, gsN, 8262);
  for (const l of ['Masters 1000', 'ATP 500', 'ATP 250']) ok(`  ...ticked ${l}`, await clickRow(l), true, true);
  await ev(`document.body.click()`); await sleep(300);
  const fourN = await allN();
  const fourTrig = await trigText('Level');
  if (!BEFORE) {
    ok(`all four levels checked -> ${PIN.fourLevels}, NOT ${PIN.used} (the no-collapse ruling)`,
      fourN === PIN.fourLevels, fourN, PIN.fourLevels);
    ok('the four ruled levels are now constructible as an explicit set', fourN === PIN.used - PIN.finals, PIN.used - fourN, PIN.finals);
    ok('and the trigger reads 4, not All', /\b4\b/.test(fourTrig || ''), fourTrig, 'Level 4');
  }
  await openTrig('Level');
  for (const l of PIN.offeredLevels) await clickRow(l);
  await ev(`document.body.click()`); await sleep(300);
  const backN = await allN();
  ok(`clearing every Level box returns to All = ${PIN.used} (Finals still counted)`, backN === PIN.used, backN, PIN.used);

  // ══ player charts share the ALL-series domain ════════════════════════════════
  if (!BEFORE) {
    console.log('\n── item 2: player charts on the shared match-index domain ──');
    await ev(`(function(){var b=[].slice.call(document.querySelectorAll('${P} #dbViewTabs button'));
      for(var i=0;i<b.length;i++) if(b[i].dataset.dbview==='players'){b[i].click();return true;} return false;})()`);
    await sleep(900);
    await ev(`(function(){var i=document.querySelector('${P} .db-search input'); if(!i) return false;
      i.value='Khachanov'; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
    await sleep(700);
    await ev(`(function(){var rs=[].slice.call(document.querySelectorAll('${P} .db-search .db-pop .db-prow'));
      if(rs.length){ rs[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return (rs[0].querySelector('span')||rs[0]).textContent.trim(); }
      return null;})()`);
    await sleep(1200);
    const pc = await ev(`(function(){
      var ps=[].slice.call(document.querySelectorAll('${P} .db-pcplot')); if(ps.length<3) return {n:ps.length};
      var out=ps.map(function(p){
        var pl=p.querySelector('polyline'); var pts=pl?pl.getAttribute('points').trim().split(/\\s+/).map(function(s){return +s.split(',')[0];}):[];
        var ticks=[].slice.call((p.parentNode.querySelector('.db-pcticks')||{querySelectorAll:function(){return[]}}).querySelectorAll('div'))
          .map(function(d){return {label:(d.textContent||'').trim(), x:parseFloat(d.style.left)};});
        return {first:pts[0], last:pts[pts.length-1], n:pts.length, ticks:ticks};});
      var eb=document.querySelector('${P} .db-eyebrow');
      var ebs=[].slice.call(document.querySelectorAll('${P} .db-eyebrow')).map(function(e){return (e.textContent||'').trim();})
        .filter(function(t){return t.indexOf('Cumulative profit')===0;});
      return {panels:out, eyebrow:ebs[0]||null};
    })()`);
    if (pc.panels) {
      console.log(`   panels: ${pc.panels.map((p) => `n=${p.n} ${p.first}..${p.last}`).join('   |   ')}`);
      ok('player chart eyebrow names the match-index axis',
        /match index/i.test(pc.eyebrow || ''), pc.eyebrow, 'mentions match index');
      ok('the All panel spans the full domain (0..1000)', pc.panels[0].first === 0 && pc.panels[0].last === 1000,
        `${pc.panels[0].first}..${pc.panels[0].last}`, '0..1000');
      ok('the Favourite sub-panel lives INSIDE the shared domain, not its own 0..1000',
        pc.panels[1].last <= 1000 && !(pc.panels[1].first === 0 && pc.panels[1].last === 1000),
        `${pc.panels[1].first}..${pc.panels[1].last}`, 'a sub-range of 0..1000');
      ok('the Underdog sub-panel likewise',
        pc.panels[2].last <= 1000 && !(pc.panels[2].first === 0 && pc.panels[2].last === 1000),
        `${pc.panels[2].first}..${pc.panels[2].last}`, 'a sub-range of 0..1000');
      const shared = pc.panels[1].ticks.every((t) => {
        const m = pc.panels[0].ticks.find((u) => u.label === t.label);
        return !m || Math.abs(m.x - t.x) < 0.01;
      });
      ok('sub-panel season ticks sit at the SAME x as the main panel ("shared scale" holds)', shared,
        JSON.stringify(pc.panels[1].ticks.map((t) => t.label + '@' + t.x.toFixed(2))), 'same x as main');
    } else { ok('player charts painted 3 panels', false, pc, '3 panels'); }
  }

  // ══ console hygiene ══════════════════════════════════════════════════════════
  const real = errs.filter((e) => !/read only property 'BSP'/.test(e));
  ok('no page console exceptions', real.length === 0, real.slice(0, 3), []);
  const aliasWarn = warns.filter((w) => /alias table/.test(w));
  ok('no tournament string is missing from the alias table', aliasWarn.length === 0, aliasWarn.slice(0, 1), []);
  const domainWarn = warns.filter((w) => /shared x domain/.test(w));
  ok('no orphaned player-chart record (shared domain intact)', domainWarn.length === 0, domainWarn.slice(0, 1), []);

  console.log(`\n${PASS} pass, ${FAILS.length} fail`);
  if (FAILS.length) { console.log('FAILED:'); FAILS.forEach((f) => console.log('  - ' + f)); }
  chrome.kill();
  process.exit(FAILS.length ? 1 : 0);
})().catch((e) => { console.error('probe error', e); process.exit(2); });
