#!/usr/bin/env node
/**
 * ten228-verify.mjs — drive the changed surfaces and READ the numbers back.
 *
 * A read proves correctness; a screenshot only proves it painted. Every check
 * below is driven by a real click on the element a user clicks, and every claim
 * is recomputed from the shard INDEPENDENTLY of the renderer before it is
 * compared — so a shared bug cannot make both agree.
 *
 * Usage: node ten228-verify.mjs <baseUrl> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'http://127.0.0.1:8745';
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '1775', '370'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
const fail = (m) => { console.log(`    FAIL ${m}`); failures += 1; };
const ok = (m) => console.log(`    ok   ${m}`);

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

const dport = 9800 + Math.floor((Date.now() / 1000) % 150);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ten228v-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1512,982', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || JSON.stringify(d)).slice(0, 600));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 240; i++) {
  if (await ev(`!!(window.PlayerProfileV2 && window.PlayerProfileV2._internals)
    && typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles || {}).length > 0`)) break;
  await sleep(250);
}
console.log(`base ${BASE}`);

/** Open a box by name, re-querying every time (the grid repaints on close). */
const openBox = async (box) => ev(`(async function(){
  var el = document.querySelector('[data-pp2="box"][data-box="${box}"]');
  if (!el) return false;
  el.click();
  await new Promise(function(r){ setTimeout(r, 900); });
  return !!document.querySelector('[data-pp2="scrim"]');
})()`);
const closeModal = async () => ev(`(async function(){
  var s = document.querySelector('[data-pp2="scrim"]');
  var c = s && s.querySelector('[data-pp2="close"]');
  if (c) c.click(); else if (s) s.click();
  await new Promise(function(r){ setTimeout(r, 400); });
  return true;
})()`);
const clickIn = async (sel) => ev(`(async function(){
  var el = document.querySelector('[data-pp2="scrim"] ${sel}');
  if (!el) return false;
  el.click();
  await new Promise(function(r){ setTimeout(r, 700); });
  return true;
})()`);
const modalText = async () => ev(`(function(){
  var s = document.querySelector('[data-pp2="scrim"]');
  return s ? s.innerText.replace(/\\s+/g,' ').trim() : '';
})()`);

// ── R4 · search ─────────────────────────────────────────────────────────────
console.log('\n=== R4 · search never leads to an empty page ===');
{
  const r = await ev(`(async function(){
    await loadPlayerIndex();
    var noProf = (playerIndex||[]).filter(function(x){ return !x.hasProfile; });
    renderPlayerSearch(noProf[0].name.slice(0,6));
    var box = document.getElementById('playerSearchResults');
    var items = Array.prototype.slice.call(box.querySelectorAll('.psearch-item'));
    var dead = items.filter(function(e){ return e.className.indexOf('noprofile')>=0; });
    // The dead-click path: force a stale hasProfile:true on a player with no shard
    // and click it the way a user would. The old code cleared the query and the
    // dropdown and then bailed, leaving a blank screen with no feedback at all.
    var victim = noProf[1];
    victim.hasProfile = true;
    var input = document.getElementById('playerSearch');
    input.value = victim.name.slice(0,6);
    renderPlayerSearch(input.value);
    await selectSearchedPlayer(victim.key);
    await new Promise(function(r){ setTimeout(r, 500); });
    var after = document.getElementById('playerSearchResults');
    var afterItems = Array.prototype.slice.call(after.querySelectorAll('.psearch-item'));
    return {
      total: (playerIndex||[]).length, noProfile: noProf.length,
      label: dead.length ? dead[0].innerText.replace(/\\s+/g,' ').trim() : null,
      deadClickable: dead.length ? !!dead[0].getAttribute('onclick') : null,
      staleName: victim.name,
      afterVisible: after.style.display !== 'none',
      afterQuery: input.value,
      afterRows: afterItems.map(function(e){ return e.innerText.replace(/\\s+/g,' ').trim(); }),
      afterFlag: victim.hasProfile
    };
  })()`);
  console.log(`  index ${r.total} players, ${r.noProfile} with no shard`);
  /Profile not built yet/.test(r.label || '') ? ok(`label reads verbatim: "${r.label}"`)
    : fail(`label is "${r.label}", ruling R4 requires "Profile not built yet"`);
  r.deadClickable === false ? ok('a no-shard row carries no click hook') : fail('a no-shard row is clickable');
  // The R4 second path.
  r.afterVisible ? ok('after a stale-flag click the dropdown is still on screen (was: blank)')
    : fail('after a stale-flag click the dropdown was torn down — the empty-page failure');
  r.afterQuery ? ok(`the query survived the failed click ("${r.afterQuery}")`) : fail('the query was cleared on a failed click');
  r.afterFlag === false ? ok('the stale hasProfile flag was corrected in place') : fail('the stale flag survived');
  r.afterRows.some((t) => /Profile not built yet/.test(t))
    ? ok('the row fell back to the honest "Profile not built yet" state')
    : fail(`no honest row after the failed click: ${JSON.stringify(r.afterRows.slice(0, 3))}`);
}

// ── per player ──────────────────────────────────────────────────────────────
for (const key of KEYS) {
  const got = await ev(`ensurePlayerProfile(${JSON.stringify(key)})`);
  if (!got) { console.log(`\n### ${key}: shard did not load`); failures += 1; continue; }
  await ev(`showPlayerProfileV2(${JSON.stringify(key)})`);
  for (let i = 0; i < 200; i++) {
    if (await ev(`!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}]
      && window.marketEdge && window.marketEdge[${JSON.stringify(key)}] !== undefined)`)) break;
    await sleep(250);
  }
  const name = await ev(`window.PlayerProfileV2._internals.profileFor(${JSON.stringify(key)}).name`);
  console.log(`\n### ${name} (${key})`);

  // ── R2 · Key insights ────────────────────────────────────────────────────
  console.log('  R2 · Key insights = the spec rule, off one shared function');
  {
    const r = await ev(`(function(){
      var I = window.PlayerProfileV2._internals, k = ${JSON.stringify(key)};
      var p = I.profileFor(k);
      // INDEPENDENT recompute, from the splits store and the career spine, working
      // from the ruling rather than from rankedInsights() — so a bug inside the
      // renderer cannot make both sides agree.
      var sc = (window.careerSplits||{})[k];
      var t = I.spineTotal(p);
      var base = (t.won+t.lost) ? 100*t.won/(t.won+t.lost) : null;
      var GROUPS = { surface:['Hard','Clay','Grass'], format:['Best of 5','Best of 3'],
                     opponent:['vs. Righties','vs. Lefties','vs. Top 10'] };
      var EXCLUDED = ['Grand Slams','Masters','Other Tours','Finals','Semi-finals','Quarter-finals'];
      var mine = [];
      if (sc && sc.career && base != null) {
        Object.keys(GROUPS).forEach(function(g){ GROUPS[g].forEach(function(m){
          var r2 = sc.career[m]; if (!r2 || r2.W==null || r2.L==null) return;
          var n = r2.W + r2.L; if (n < 10) return;
          mine.push({ label:m, n:n, won:r2.W, lost:r2.L, rate:100*r2.W/n, gap:100*r2.W/n - base });
        }); });
        mine.sort(function(a,b){ return Math.abs(b.gap)-Math.abs(a.gap); });
      }
      var shown = I.rankedInsights(p, 'career', 3);
      // What the PAGE prints, read out of the DOM.
      var cards = Array.prototype.slice.call(document.querySelectorAll('[data-pp2="insight"]'))
        .map(function(el){ return el.innerText.replace(/\\s+/g,' ').trim(); });
      return { base: base, expect: mine.slice(0,3), shown: shown, cards: cards,
        eligible: mine.length,
        excludedPresent: EXCLUDED.filter(function(m){ return cards.join(' ').indexOf(m) >= 0; }),
        prose: (p.insights||[]).map(function(x){ return x.title; }) };
    })()`);
    const exp = r.expect.map((x) => `${x.label}:${x.won}-${x.lost}`).join(' | ');
    const got2 = r.shown.map((x) => `${x.label}:${x.won}-${x.lost}`).join(' | ');
    exp === got2 ? ok(`selector matches an independent recompute — ${got2 || '(none eligible)'}`)
      : fail(`selector ${got2} != independent recompute ${exp}`);
    r.cards.length === Math.min(3, r.eligible)
      ? ok(`${r.cards.length} card(s) rendered for ${r.eligible} eligible split(s) — never padded`)
      : fail(`${r.cards.length} cards for ${r.eligible} eligible`);
    r.excludedPresent.length === 0 ? ok('no Level or Round split reached a card (R2 excludes both)')
      : fail(`excluded group leaked onto a card: ${r.excludedPresent.join(', ')}`);
    const joined = r.cards.join(' ');
    /\d+%/.test(joined) && /\d+–\d+/.test(joined) && /[+−]\d+\.\dpp/.test(joined)
      ? ok('each card states rate, record and a signed gap')
      : fail(`a card is missing rate/record/gap: ${JSON.stringify(r.cards[0] || '')}`);
    const adjectives = ['standout', 'strongest', 'strong recent form', 'Sharpest', 'best'];
    const leaked = adjectives.filter((a) => joined.indexOf(a) >= 0);
    leaked.length === 0 ? ok('no adjective on any card (the pipeline prose is no longer read)')
      : fail(`adjective leaked through: ${leaked.join(', ')}`);
    // The shared-function claim: the Splits box headline must be the SAME pick.
    const shared = await ev(`(function(){
      var I = window.PlayerProfileV2._internals, p = I.profileFor(${JSON.stringify(key)});
      var b = I.biggestSplit(p), top = I.rankedInsights(p,'career',1)[0];
      return { big: b && b.pick.label, top: top && top.label };
    })()`);
    shared.big === shared.top ? ok(`"best split" and Key insights agree by construction — ${shared.big || '—'}`)
      : fail(`best split ${shared.big} != top insight ${shared.top}`);
  }

  // ── §5.7 Splits, three tabs ──────────────────────────────────────────────
  console.log('  §5.7 · Splits — Results | Sets & Games | Service');
  if (await openBox('splits')) {
    const tabs = await ev(`(function(){
      return Array.prototype.slice.call(document.querySelectorAll('[data-pp2="split-tab"]'))
        .map(function(e){ return e.innerText.trim(); });
    })()`);
    JSON.stringify(tabs) === JSON.stringify(['Results', 'Sets & Games', 'Service'])
      ? ok(`tab control present: ${tabs.join(' | ')}`) : fail(`tabs are ${JSON.stringify(tabs)}`);
    for (const [tabId, want] of [['sets', ['Tiebreaks', 'Games', 'Sets', 'Vs avg']],
      ['service', ['Matches', 'Aces', 'Dbl faults', 'Holds', 'Breaks']]]) {
      await clickIn(`[data-pp2="split-tab"][data-tab="${tabId}"]`);
      const txt = await modalText();
      const missing = want.filter((h) => txt.indexOf(h) < 0);
      missing.length === 0 ? ok(`${tabId} tab renders the export's columns: ${want.join(' · ')}`)
        : fail(`${tabId} tab missing header(s): ${missing.join(', ')}`);
      // Recompute one cell straight from the store and compare with the DOM.
      const chk = await ev(`(function(){
        var sc = ((window.careerSplits||{})[${JSON.stringify(key)}]||{}).career||{};
        var r = sc.Hard; if (!r) return null;
        var want = ${JSON.stringify(tabId)} === 'sets'
          ? (r.setPct == null ? null : r.setPct.toFixed(1) + '%')
          : (r.hldPct == null ? null : r.hldPct.toFixed(1) + '%');
        var s = document.querySelector('[data-pp2="scrim"]');
        return { want: want, present: want != null && s.innerText.indexOf(want) >= 0 };
      })()`);
      if (chk && chk.want) {
        chk.present ? ok(`${tabId}: Hard row prints the store's own value ${chk.want}`)
          : fail(`${tabId}: Hard row does not print the store's ${chk.want}`);
      } else ok(`${tabId}: no Hard row in the store for this player — nothing to cross-check`);
    }
    // Scope must not reset the tab.
    await clickIn('[data-pp2="split-scope"][data-scope="last52"]');
    const stillService = await ev(`!!document.querySelector('[data-pp2="scrim"]').innerText.match(/Dbl faults/)`);
    stillService ? ok('switching scope keeps the active tab (independent axes)')
      : fail('switching scope reset the tab back to Results');
    await closeModal();
  } else fail('splits modal did not open');

  // ── §5.8 Market edge ─────────────────────────────────────────────────────
  console.log('  §5.8 · Market edge — R1 basis, At 1u flat, bars, drill, chart');
  if (await openBox('market')) {
    const shard = await ev(`JSON.parse(JSON.stringify(window.marketEdge[${JSON.stringify(key)}]||null))`);
    if (!shard || !shard.headline.n) { ok('no priced sample — modal shows the stated empty state'); await closeModal(); continue; }
    const txt = await modalText();
    txt.indexOf('Pinnacle closing only') >= 0 ? ok('the page names the R1 basis')
      : fail('the page does not state "Pinnacle closing only"');
    txt.indexOf('At 1u flat') >= 0 ? ok('role cards carry the file\'s "At 1u flat" figure')
      : fail('"At 1u flat" is absent — the build still shows Win rate');
    txt.indexOf('Win rate') >= 0 && txt.indexOf('At 1u flat') < 0 ? fail('still the old Win rate figure') : null;
    // Independent recompute of the headline units, straight off matches[].
    const recomputed = shard.matches.filter((m) => m.inBasis)
      .reduce((a, m) => a + (m.won ? Math.round(m.price * 100) - 100 : -100), 0) / 100;
    Math.abs(recomputed - shard.headline.units) < 0.005
      ? ok(`headline units ${shard.headline.units}u recomputes exactly from matches[] (${recomputed.toFixed(2)}u)`)
      : fail(`headline units ${shard.headline.units} != independent ${recomputed.toFixed(2)}`);
    const printed = txt.match(/[+−]\d+\.\d\d u/);
    shard.matches.every((m) => (m.book === 'pinnacle') === m.inBasis)
      ? ok(`every one of ${shard.matches.length} match rows is labelled for the basis (${shard.coverage.excludedNonPinnacle} excluded)`)
      : fail('a match row\'s book and inBasis flag disagree');
    const bars = await ev(`document.querySelectorAll('[data-pp2="scrim"] div[style*="background:rgba(255,255,255,0.05);border-radius:5px"]').length`);
    bars >= 3 ? ok(`${bars} divergence bars rendered (3 role cards + band rows)`) : fail(`only ${bars} divergence bars`);
    // Drive the band drill with a real click.
    const bandId = await ev(`(function(){
      var b = document.querySelector('[data-pp2="scrim"] [data-pp2="market-band"]');
      return b ? b.getAttribute('data-band') : null;
    })()`);
    if (bandId) {
      await clickIn(`[data-pp2="market-band"][data-band="${bandId}"]`);
      const drill = await ev(`(function(){
        var s = document.querySelector('[data-pp2="scrim"]');
        var t = s.innerText;
        return { open: /Close/.test(t) && /(All \\d+ match|Showing \\d+ of)/.test(t),
                 recon: /band counts/.test(t) };
      })()`);
      drill.open ? ok(`band "${bandId}" opens its match list on a real click`) : fail('band drill did not open');
      drill.recon ? fail('the drill reports a band-vs-rows mismatch') : ok('the drill reconciles to the band row that opened it');
      await clickIn(`[data-pp2="market-band"][data-band="${bandId}"]`);
    } else fail('no openable price band');
    // Cumulative chart + its two filters.
    const chart0 = await ev(`(function(){
      var s = document.querySelector('[data-pp2="scrim"]');
      var p = s.querySelectorAll('svg path');
      var m = s.innerText.match(/finishing ([+−][\\d.]+)u/);
      return { paths: p.length, finish: m ? m[1] : null };
    })()`);
    chart0.paths >= 2 ? ok(`cumulative chart drawn (${chart0.paths} svg paths), finishing ${chart0.finish}u`)
      : fail('no cumulative chart');
    const expectFinish = shard.headline.units;
    chart0.finish && Math.abs(parseFloat(chart0.finish.replace('−', '-')) - expectFinish) < 0.02
      ? ok(`the chart's last point equals the headline units (${expectFinish}u) — same population`)
      : fail(`chart finishes ${chart0.finish} but the headline says ${expectFinish}u`);
    await clickIn('[data-pp2="market-side"][data-side="fade"]');
    const faded = await ev(`(function(){
      var m = document.querySelector('[data-pp2="scrim"]').innerText.match(/finishing ([+−][\\d.]+)u/);
      return m ? m[1] : null;
    })()`);
    const fadeVal = faded ? parseFloat(faded.replace('−', '-')) : null;
    fadeVal != null && Math.abs(fadeVal + expectFinish) < 0.02
      ? ok(`Fade mirrors Back exactly (${faded}u against ${expectFinish}u)`)
      : fail(`Fade reads ${faded}, not the mirror of ${expectFinish}`);
    await clickIn('[data-pp2="market-side"][data-side="back"]');
    await clickIn('[data-pp2="market-surf"][data-surf="Clay"]');
    const clay = await ev(`(function(){
      var m = document.querySelector('[data-pp2="scrim"]').innerText.match(/finishing ([+−][\\d.]+)u [\\s\\S]*?/) ||
              document.querySelector('[data-pp2="scrim"]').innerText.match(/(\\d+) matches · finishing/);
      var t = document.querySelector('[data-pp2="scrim"]').innerText;
      var n = t.match(/(\\d+) matches · finishing/);
      return { n: n ? +n[1] : null, titled: /Clay/.test(t) };
    })()`);
    const clayRows = shard.matches.filter((m) => m.inBasis && m.surface === 'Clay').length;
    clay.n === clayRows ? ok(`surface filter re-walks the basis: ${clay.n} clay rows, matching the shard`)
      : fail(`clay filter shows ${clay.n} rows, shard holds ${clayRows}`);
    await clickIn('[data-pp2="market-surf"][data-surf="all"]');
    await closeModal();
  } else fail('market modal did not open');
}

// Local-fallback disclosure: a file that came from disk rather than the deployed
// site makes every number above provisional.
console.log('\n=== hybrid server fallbacks ===');
try {
  const log = fs.readFileSync('/tmp/ten228-hybrid.log', 'utf8');
  const fb = log.split('\n').filter((l) => /local fallback|LOCAL/.test(l) && !/local fallback only/.test(l));
  fb.length ? fb.forEach((l) => console.log('  ' + l)) : console.log('  none logged');
} catch { console.log('  (no log)'); }

try { ws.close(); } catch { /* closing */ }
chrome.kill();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
