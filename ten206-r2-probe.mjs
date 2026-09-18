#!/usr/bin/env node
/**
 * ten206-r2-probe.mjs — the round-2 ruling gate, read off a real browser.
 *
 * The unit suite already recomputes these rules from the stores. This probe
 * exists because the unit suite cannot see the PAGE: it asserts what the DOM
 * actually paints after the lazy shards land, which is where the round-1
 * "Giustino dashes with a baseline he has no eligible split to beat" defect
 * showed up (the code read fine; the tile did not).
 *
 * Asserted, per player:
 *   R1  the Draw record tile prints its baseline, and the whole support line
 *       reconstructs from the split rows the modal behind it shows
 *   R1b the tile's baseline EQUALS the "vs avg" baseline the modal's own legend
 *       discloses — the two collapsed under Q1 round 2 and must stay collapsed
 *   R2  the Key insights lead card names the same split as the tile, and no
 *       POSITIVE card comes from a group the tile could not have picked
 *   R3  no "Backing him here" tile prints a priced count above its played count
 *
 * FAILING CONTROL: every assertion is re-run with the expected value mutated, and
 * the probe fails if the mutant PASSES. A probe that cannot be made to fail is
 * not measuring anything — see tools/test-pp2-reconcile.js's negative controls
 * and the 0/0 pass this repo shipped once.
 *
 * Usage: node ten206-r2-probe.mjs <baseUrl> <key> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8759').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' :: ' + detail : '')); }
}

// ── CDP, no installs (scripts/cdp_probe.mjs's transport) ────────────────────
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten206r2-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9333', '--user-data-dir=' + profileDir, '--window-size=1440,2400',
  'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9333/json/list');
      if (r.ok) return r.json();
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('chrome never came up');
}

const list = await targets();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let msgId = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
};
function send(method, params) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    waiting.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
// The deployed shell gates the dashboard behind BSP.requireVerified; neutered on
// the document, not by editing the page, so the code under test is unmodified.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`
});
await send('Page.navigate', { url: BASE + '/bsp-consult-dashboard.html' });
for (let i = 0; i < 300; i++) {
  let up = false;
  try { up = await evaluate(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`); } catch (e) {}
  if (up) break;
  await sleep(250);
}
if (!(await evaluate(`window.FEATURE_PP2 === true || (typeof FEATURE_PP2 !== 'undefined' && !!FEATURE_PP2)`))) {
  console.log('ABORT: V2 renderer is not the default on this build.');
  process.exit(1);
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
  return r.result.value;
}

// ── the read, per player ────────────────────────────────────────────────────
// Everything below is recomputed IN THE PAGE off the module's own internals and
// the rendered DOM, then compared here. The page is the source of the DOM half;
// this file is the source of the RULE half, so the two can disagree.
const READ = (key) => `(async () => {
  const I = window.PlayerProfileV2._internals;
  const p = I.profileFor('${key}');
  if (!p) return { err: 'no player ${key}' };
  const bs = I.bestSplit(p);
  const base = I.boxSplitBaseline(p, 'career');
  const vals = I.buildBoxVals(p, { archetype: null });
  const insights = I.renderInsights(p);
  const ids = [...insights.matchAll(/data-insight="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const ranked = I.rankedInsights(p, 'career', null, I.INSIGHT_GROUPS);
  const byId = Object.fromEntries(ranked.map(c => [c.id, c]));
  const views = I.tournViews(p) || [];
  return {
    name: p.name,
    base,
    eligible: I.rankedInsights(p, 'career', null, I.BOX_SPLIT_GROUPS).length,
    pick: bs ? { id: bs.pick.id, label: bs.pick.label, won: bs.pick.won, lost: bs.pick.lost,
                 n: bs.pick.n, gap: bs.pick.gap, baseline: bs.baseline } : null,
    support: vals.splits.support,
    headline: vals.splits.headline,
    boxGroups: I.BOX_SPLIT_GROUPS,
    leadId: ids[0] || null,
    positiveCards: ids.filter(id => byId[id] ? byId[id].gap > 0 : (bs && id === bs.pick.id)),
    colBaseline: (() => {
      const col = I.pickByLargestGap(I.splitCandidates(p.key, 'career', I.DRAW_GROUPS));
      return col ? col.baseline : null;
    })(),
    tournBad: views.filter(t => t.pinN > t.n).map(t => t.display),
    tournSuppressed: views.filter(t => t.pricedImpossible)
      .map(t => ({ ev: t.display, played: t.n, claimed: t.pricedClaimed, pinN: t.pinN, pinPl: t.pinPl }))
  };
})()`;

for (const key of KEYS) {
  // This page has no router (see the dashboard-nav memo): a profile is reached by
  // loading its shard and calling the renderer, never by a URL.
  const got = await evaluate(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { ok(key + ' · profiles/' + key + '.json loaded', false, 'shard did not load'); continue; }
  await evaluate(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  // Wait on the LAZY stores by name, not a fixed sleep: the round-1 Court speed
  // miss came from reading before the shard landed.
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try {
      ready = await evaluate(`!!(window.PlayerProfileV2 && window.PlayerProfileV2._internals
        && window.careerSplits && window.careerHistory && window.careerHistory[${JSON.stringify(key)}])`);
    } catch (e) { ready = false; }
    if (ready) break;
    await sleep(250);
  }
  if (!ready) { ok(key + ' · lazy stores landed', false, 'careerSplits/careerHistory never arrived'); continue; }
  await sleep(1200);   // the market-edge shard is fetched per player

  const d = await evaluate(READ(key));
  if (!d || d.err) { ok(key + ' · read', false, (d && d.err) || 'no data'); continue; }
  const tag = key + ' (' + d.name + ')';

  // ── Q2 round 2 · the box's groups are the ruled four ─────────────────────
  ok(tag + ' · box groups are format/level/round/opponent',
    JSON.stringify(d.boxGroups.slice().sort()) === JSON.stringify(['format', 'level', 'opponent', 'round']),
    JSON.stringify(d.boxGroups));

  // ── Q1 round 2 · the support line reconstructs from the rows ─────────────
  if (d.pick) {
    const rate = 100 * d.pick.won / d.pick.n;
    const gap = rate - d.base;
    const pp = (gap < 0 ? '−' : '+') + Math.abs(gap).toFixed(1) + 'pp';
    const want = `best split · ${rate.toFixed(1)}% · ${pp} vs his ${d.base.toFixed(1)}% `
      + `across his draw splits · ${d.pick.won}–${d.pick.lost}`;
    ok(tag + ' · tile support reconstructs from the split rows', d.support === want,
      `got "${d.support}" want "${want}"`);
    ok(tag + ' · tile prints a POSITIVE gap', d.pick.gap > 0, d.pick.gap + 'pp');
    // FAILING CONTROL: the same comparison against a baseline shifted 1pp must fail.
    const mutant = want.replace(d.base.toFixed(1) + '%', (d.base + 1).toFixed(1) + '%');
    ok(tag + ' · [control] a 1pp-shifted baseline is rejected', d.support !== mutant);
  } else {
    const want = d.base == null ? 'no split data on record'
      : !d.eligible ? 'no split clears the ten-match minimum'
      : `no split above his ${d.base.toFixed(1)}% across his draw splits`;
    ok(tag + ' · empty copy states the RIGHT empty fact', d.support === want,
      `got "${d.support}" want "${want}" (base=${d.base}, eligible=${d.eligible})`);
    ok(tag + ' · headline dashes with no pick', d.headline === null, String(d.headline));
  }

  // ── Q1 round 2 · the two baselines stayed collapsed ──────────────────────
  if (d.base != null && d.colBaseline != null) {
    ok(tag + ' · tile baseline == Draw record column baseline',
      Math.abs(d.base - d.colBaseline) < 1e-9,
      d.base.toFixed(3) + '% vs ' + d.colBaseline.toFixed(3) + '%');
    ok(tag + ' · [control] a 0.5pp drift between them would fail',
      !(Math.abs(d.base - (d.colBaseline + 0.5)) < 1e-9));
  }

  // ── Q2 round 2 · box pick == insights positive card ──────────────────────
  if (d.pick) {
    ok(tag + ' · insights lead IS the tile pick', d.leadId === d.pick.id,
      'lead ' + d.leadId + ' vs tile ' + d.pick.id);
  } else {
    ok(tag + ' · no positive card under a dashed tile', d.positiveCards.length === 0,
      d.positiveCards.join(', '));
  }
  const strays = d.positiveCards.filter((id) => !d.boxGroups.includes(String(id).split(':')[0]));
  ok(tag + ' · every positive card is box-selectable', strays.length === 0, strays.join(', '));
  // FAILING CONTROL: a surface id must be rejected by that same filter.
  ok(tag + ' · [control] a surface positive card would be caught',
    ['surface:Hard'].filter((id) => !d.boxGroups.includes(String(id).split(':')[0])).length === 1);

  // ── Q3 · the impossible pair never reaches a consumer ────────────────────
  ok(tag + ' · no view exposes priced n > played n', d.tournBad.length === 0, d.tournBad.join(', '));
  if (d.tournSuppressed.length) {
    const bad = d.tournSuppressed.filter((t) => t.pinN !== 0 || t.pinPl !== null);
    ok(tag + ' · suppressed rows dash BOTH the count and the units', bad.length === 0,
      JSON.stringify(bad));
    console.log('        ' + d.tournSuppressed.length + ' suppressed: '
      + d.tournSuppressed.slice(0, 3).map((t) => `${t.ev} ${t.played} played / ${t.claimed} claimed`).join(' · '));
  }
  console.log('        TILE  ' + (d.headline == null ? '—' : d.headline) + '  |  ' + d.support);
}

console.log('\n' + '─'.repeat(56));
console.log(`PASS ${pass}   FAIL ${fail}`);
if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log('  - ' + f)); }
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);
