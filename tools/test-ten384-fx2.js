// tools/test-ten384-fx2.js — TEN-384 fix round 2 (fx2, 2026-10-07): the review of ship candidate bfa68f21.
//
// Every check runs on PINNED inputs (committed fixtures, sliced page code, a fake clock), so it is identical in
// every checkout, CI included. Each one fails on bfa68f21 — the control: `FX2_BASE=bfa68f21 node
// tools/test-ten384-fx2.js` runs the same checks against that commit's player-profile-v2.js,
// bsp-consult-dashboard.html and tournament-identity.js (read with `git show`).
//
//   2 · stale deferred mount   leaving the Players list (Back, a page switch, another profile) while the first
//                              paint waits on the market-edge shard cancels the mount: no profile appears over
//                              the list, no scrollTo(0, 0) on another page.
//   3 · first paint            every per-profile load starts at CLICK time, in parallel with the shard; a box
//                              whose shard is still loading claims nothing (no dash, no "no priced matches on
//                              record") in the same box geometry, and paints once when the shard lands.
//   5 · one row per event      a served tournament-history shard's same-identity rows (London / Queen's Club,
//                              Hertogenbosch / 's-Hertogenbosch, NextGen Finals / Next Gen Finals - Milan) fold
//                              into one; a season held twice counts once (the larger edition, never summed).
//   6 · Key insights reason    no career-splits entry → "No split data on record.", never the sample-size reason.
//
// Run: node tools/test-ten384-fx2.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const ROOT = L.ROOT;
const BASE = process.env.FX2_BASE || null;
function srcOf(rel) {
  if (!BASE) return path.join(ROOT, rel);
  const f = path.join(os.tmpdir(), 'fx2-control-' + BASE + '-' + rel.replace(/\//g, '_'));
  fs.writeFileSync(f, execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + rel], { maxBuffer: 64 << 20 }));
  return f;
}
const PP2 = srcOf('player-profile-v2.js');
const DASH = fs.readFileSync(srcOf('bsp-consult-dashboard.html'), 'utf8');
// eslint-disable-next-line import/no-dynamic-require
const TI = require(srcOf('tournament-identity.js'));
const H = L.harness();
console.log('TEN-384 fx2 — ' + (BASE ? 'CONTROL against ' + BASE : 'working tree'));

// ════════════════════════════════════════════════════════════════════════════
// 2 + 3 · the host's mount path, sliced from bsp-consult-dashboard.html and driven with a fake clock
// ════════════════════════════════════════════════════════════════════════════
function sliceMount() {
  const from = DASH.indexOf('const PP2_FIRST_PAINT_WAIT_MS');
  const fn = DASH.indexOf('function showPlayerList(){', from);
  const to = DASH.indexOf('\n}\n', fn);
  assert(from > 0 && fn > from && to > fn, 'the mount block (PP2_FIRST_PAINT_WAIT_MS … showPlayerList) is not where it was');
  return DASH.slice(from, to + 2);
}
function mountHarness() {
  const timers = [];
  const calls = [];
  const el = id => ({ id, style: { display: id === 'playerListView' ? '' : 'none' }, innerHTML: '' });
  const els = { playerListView: el('playerListView'), playerProfileView: el('playerProfileView') };
  const playersPage = { active: true, classList: { contains: c => c === 'active' && playersPage.active } };
  const doc = {
    getElementById: id => els[id] || null,
    querySelector: q => (/data-page="players"/.test(q) ? playersPage : null)
  };
  const win = {
    marketEdge: {},
    PlayerProfileV2: { mount(view, key) { calls.push('mount:' + key); view.innerHTML = 'profile ' + key; return true; } },
    scrollTo() { calls.push('scrollTo'); }
  };
  let releaseShard = null;
  const stub = name => (k) => { calls.push(name + ':' + (k == null ? '' : k)); return Promise.resolve(); };
  const env = {
    document: doc, window: win, setTimeout: (f) => { timers.push(f); return timers.length; },
    playerProfiles: { 207: { key: '207', name: 'J. Thompson' }, 2382: { key: '2382', name: 'C. Alcaraz' } },
    ppState: { key: null },
    loadPp2MarketShard: k => new Promise((r) => { calls.push('shard:' + k); releaseShard = () => { win.marketEdge[k] = { headline: { n: 1 } }; r(); }; }),
    pp2Bridge: () => calls.push('bridge'), tourBaselines: {}, loadTourBaselines: () => Promise.resolve(null),
    loadPp2Bet365: stub('bet365'), loadPp2CareerHistory: stub('careerHistory'), loadPp2TourHist: stub('tourHist'),
    loadPp2Closes: stub('closes'), loadPp2SpeedMap: stub('speedMap'), loadPp2Dna: stub('dna'),
    pp2RepaintIfOpen() {}, closePpSplitDrawer() {}, pp2FlagOn: () => true,
    loadPointsAtRisk() {}, buildPlayerProfileHtml: () => 'legacy', ppSyncCareerHeight() {}, ppUpgradeFormRows() {}
  };
  const names = Object.keys(env);
  // eslint-disable-next-line no-new-func
  const api = new Function(...names, sliceMount() +
    '\nreturn { showPlayerProfileV2, showPlayerList, showPlayerProfile, cancel: typeof pp2CancelPendingMount === "function" ? pp2CancelPendingMount : null };')(
    ...names.map(n => env[n]));
  const flush = async () => { while (timers.length) timers.shift()(); for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { api, calls, els, playersPage, flush, release: () => releaseShard && releaseShard(), env };
}
const profileShown = h => h.els.playerProfileView.style.display !== 'none' || h.calls.some(c => /^mount:/.test(c));

async function mountChecks() {
  await H.checkAsync('2 · Back to Players within the first-paint wait cancels the deferred mount (no profile over the list, no scroll)', async () => {
    const h = mountHarness();
    h.api.showPlayerProfileV2('207');
    h.api.showPlayerList();                  // the reader goes back before the 2.5 s cap
    await h.flush();                          // the cap fires (Thompson's shard still loading)
    assert(!profileShown(h), 'Thompson\'s profile mounted over the list: ' + h.calls.filter(c => /mount|scroll/.test(c)).join(', '));
    assert(!h.calls.includes('scrollTo'), 'the page scrolled after the reader left');
    assert.strictEqual(h.els.playerListView.style.display, '', 'the list is hidden');
    return 'open 207 → Back → cap fires: list stays, no mount, no scroll';
  });
  await H.checkAsync('2 · a page switch within the wait cancels the deferred mount', async () => {
    const h = mountHarness();
    h.api.showPlayerProfileV2('207');
    h.playersPage.active = false;             // the sidebar moved to another page (the nav handler)
    if (h.api.cancel && /pp2CancelPendingMount\(\)/.test(DASH.slice(DASH.indexOf("getElementById('mainNav').addEventListener('click'"),
      DASH.indexOf("getElementById('mainNav').addEventListener('click'") + 600))) h.api.cancel();
    await h.flush();
    h.release(); await h.flush();
    assert(!profileShown(h), 'the profile mounted on another page: ' + h.calls.filter(c => /mount|scroll/.test(c)).join(', '));
    assert(!h.calls.includes('scrollTo'), 'another page was scrolled to the top');
    return 'open 207 → switch page → cap and shard land: nothing mounts, nothing scrolls';
  });
  await H.checkAsync('2 · opening another player within the wait mounts only the second one', async () => {
    const h = mountHarness();
    h.api.showPlayerProfileV2('207');
    h.api.showPlayerProfileV2('2382');
    await h.flush();
    const mounts = h.calls.filter(c => /^mount:/.test(c));
    assert.deepStrictEqual(mounts, ['mount:2382'], 'mounted ' + mounts.join(', '));
    return 'mounts: ' + mounts.join(', ');
  });
  await H.checkAsync('2 · the deferred mount still lands when the reader stays (the cancel is not a blanket off-switch)', async () => {
    const h = mountHarness();
    h.api.showPlayerProfileV2('207');
    h.release(); await h.flush();
    assert.deepStrictEqual(h.calls.filter(c => /^mount:/.test(c)), ['mount:207']);
    assert(h.calls.includes('scrollTo'));
  });
  await H.checkAsync('3 · every per-profile load starts at click time, in parallel with the market shard (not after the wait)', async () => {
    const h = mountHarness();
    h.api.showPlayerProfileV2('207');          // synchronously: nothing has resolved, no timer has fired
    const want = ['careerHistory:207', 'tourHist:207', 'closes:207', 'speedMap:207', 'bet365:207', 'dna:'];
    const missing = want.filter(w => !h.calls.includes(w));
    assert.deepStrictEqual(missing, [], 'not started at click time: ' + missing.join(', ') + ' (calls: ' + h.calls.join(', ') + ')');
    await h.flush();
    want.forEach(w => assert.strictEqual(h.calls.filter(c => c === w).length, 1, w + ' started more than once'));
    return 'started at click: ' + want.join(', ');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · the box claims nothing while its shard loads (player-profile-v2.js, pinned fixture)
// ════════════════════════════════════════════════════════════════════════════
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
function fxModule(opts) {
  const p = Object.assign({}, FX.profile, { tournamentHistory: (opts && opts.th) || FX.tournamentHistory });
  const m = L.loadPp2({
    src: PP2, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory },
    marketEdge: opts && opts.noShard ? {} : { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History,
    extra: Object.assign({ TournamentIdentity: TI }, (opts && opts.extra) || {})
  });
  return { I: m.I, W: m.W, p };
}
function marketTile(html) {
  const i = html.indexOf('data-box="market"');
  assert(i > 0, 'no Market edge tile');
  const j = html.indexOf('<div class="pp2-box"', i + 20);
  return html.slice(i, j > 0 ? j : i + 3000);
}
H.check('3 · a Market edge box whose shard is still loading claims nothing: no dash, no "no priced matches", same geometry', () => {
  const { I, W, p } = fxModule({ noShard: true, extra: { marketEdgePending: { [FX.key]: true } } });
  const pend = marketTile(I.renderBoxes({ boxVals: I.boxValues(p, { rows: I.ledgerMatches(p) }) }));
  const t = L.text(pend);
  assert(!/no priced matches/i.test(t), 'the loading box states "no priced matches on record"');
  assert(!/—/.test(t), 'the loading box prints a dash');
  assert(/data-pp2-pending="figure"/.test(pend) && /data-pp2-pending="support"/.test(pend), 'no neutral pending figure / support line');
  // the shard lands: the same tile paints its figure, in the same two boxes (same font-size and line-height)
  W.marketEdge[FX.key] = FX.marketEdge; delete W.marketEdgePending[FX.key];
  const done = marketTile(I.renderBoxes({ boxVals: I.boxValues(p, { rows: I.ledgerMatches(p) }) }));
  assert(!/data-pp2-pending/.test(done), 'still pending after the shard landed');
  const geo = h => (h.match(/font-size:\d+px;"|line-height:[\d.]+;margin-top:auto;/g) || []).join(' ');
  assert.strictEqual(geo(pend), geo(done), 'the pending tile and the painted tile differ in geometry');
  const doneText = L.text(done);
  assert(/flat-stake yield · 255 priced/.test(doneText), 'the painted tile: ' + doneText);
  assert(!/tour —/.test(doneText), 'a missing tour baseline prints "tour —" (the ruling: hidden until it arrives)');
  return 'pending: figure + support blank (same 26px / 1.4 boxes) → landed: "' + doneText.replace(/^.*?Market edge /, '').trim() + '"';
});
H.check('3 · the Market edge modal opened while the shard loads says it is loading, not "No priced matches on record"', () => {
  const { I, p } = fxModule({ noShard: true, extra: { marketEdgePending: { [FX.key]: true } } });
  const t = L.text(I.renderMarketModal(p));
  assert(!/No priced matches on record/.test(t), 'the modal states a fact about the player while loading');
});
H.check('3 · a SETTLED empty shard still says "no priced matches on record" (pending is not a blanket blank)', () => {
  const { I, p } = fxModule({ noShard: true });
  const t = L.text(marketTile(I.renderBoxes({ boxVals: I.boxValues(p, { rows: I.ledgerMatches(p) }) })));
  assert(/no priced matches on record/.test(t), t);
});
H.check('3 · the host marks the shard in flight and clears the mark when it settles (bsp-consult-dashboard.html)', () => {
  const f = DASH.indexOf('async function _loadPp2MarketShard(key){');
  const body = DASH.slice(f, DASH.indexOf('\n}\n', f));
  const set = body.indexOf('window.marketEdgePending'), fetchAt = body.indexOf('await fetch('), clear = body.indexOf('delete window.marketEdgePending[k]');
  assert(set > 0 && set < fetchAt, 'the shard is not marked in flight before the fetch');
  assert(clear > fetchAt, 'the in-flight mark is not cleared after the shard settles');
});

// ════════════════════════════════════════════════════════════════════════════
// 5 · Record per tournament: one row per event, a season counted once
// ════════════════════════════════════════════════════════════════════════════
H.check('5 · tournament-identity: London ≡ Queen\'s Club, Hertogenbosch ≡ \'s-Hertogenbosch, NextGen Finals ≡ Next Gen Finals - Milan', () => {
  const id = n => TI.canonicalTournament(n).id;
  assert.strictEqual(id('London'), id("Queen's Club"));
  assert.strictEqual(id('ATP London'), id("Queen's Club"));
  assert.strictEqual(id('Hertogenbosch'), id("'s-Hertogenbosch"));
  assert.strictEqual(id('NextGen Finals'), id('Next Gen Finals - Milan'));
  assert.notStrictEqual(id('London Olympics'), id("Queen's Club"), 'the Olympics merged into Queen\'s');
  assert.notStrictEqual(id('Adelaide 2'), id('Adelaide'), 'a same-city second event merged');
});
const E = (year, res, finish) => ({ year, finish, matches: res.split('').map((r, i) => ({ res: r, round: 'R' + i, opp: 'O' + year + i, oppKey: '', score: '' })) });
H.check('5 · overlapping seasons count ONCE (the larger edition), never summed — the Thompson shape', () => {
  assert.strictEqual(typeof TI.mergeHistory, 'function', 'tournament-identity.js has no mergeHistory');
  const rows = [
    { name: "Queen's Club", won: 5, lost: 4, titles: 0, bestResult: 'Semi-final', editions: [E(2025, 'L', 'Round of 32'), E(2024, 'WWWL', 'Semi-final'), E(2023, 'WL', 'Round of 16'), E(2017, 'WL', 'Round of 16')] },
    { name: 'London', won: 4, lost: 3, titles: 0, bestResult: 'Semi-final', editions: [E(2025, 'L', 'Round of 32'), E(2024, 'WWL', 'Quarter-final'), E(2023, 'WL', 'Round of 16')] },
    { name: 'Halle', won: 1, lost: 1, editions: [E(2024, 'WL', 'Round of 16')] }
  ];
  const out = TI.mergeHistory(rows);
  assert.strictEqual(out.length, 2, 'not one row per event: ' + out.map(t => t.name).join(', '));
  const q = out.find(t => t.name === "Queen's Club");
  assert(q, 'the merged row is not named Queen\'s Club');
  assert.deepStrictEqual([q.won, q.lost], [5, 4], `merged ${q.won}–${q.lost}; summing the duplicates would read 9–7`);
  assert.strictEqual(q.editions.find(e => e.year === 2024).matches.length, 4, '2024 kept the smaller edition');
  assert.deepStrictEqual([q.bestResult, q.bestYears], ['Semi-final', [2024]]);
  assert.strictEqual(out.find(t => t.name === 'Halle'), rows[2], 'a row with no twin was rebuilt');
  assert.strictEqual(TI.mergeHistory(out).length, 2, 'not idempotent');
});
H.check('5 · [fixture] Record per tournament lists one Queen\'s Club, one \'s-Hertogenbosch, one Next Gen Finals (S. Korda, the served shard)', () => {
  const { I, p } = fxModule();
  const v = I.tournViews(p);
  const names = v.map(t => t.name);
  ['London', 'Hertogenbosch', 'NextGen Finals', 'Next Gen Finals - Milan'].forEach(n => assert(names.indexOf(n) < 0, `"${n}" is still its own row`));
  const q = v.find(t => t.name === "Queen's Club"), h = v.find(t => t.name === "'s-Hertogenbosch"), g = v.find(t => t.name === 'Next Gen Finals');
  assert(q && h && g, 'a merged row is missing');
  assert.deepStrictEqual([q.won, q.lost, h.won, h.lost, g.won, g.lost], [6, 2, 4, 1, 4, 1]);
  // the list's played total = the shard's distinct (season, event identity) editions, each counted once
  const seen = {}; let played = 0;
  FX.tournamentHistory.forEach(t => (t.editions || []).forEach((e) => {
    const k = TI.canonicalTournament(t.name).id + '|' + e.year;
    const n = (e.matches || []).filter(m => !m.walkover).length;
    played += Math.max(0, n - (seen[k] || 0)); seen[k] = Math.max(seen[k] || 0, n);
  }));
  assert.strictEqual(v.reduce((a, t) => a + t.n, 0), played, 'Σ Record per tournament played ≠ the distinct editions');
  // and the modal prints it once
  I.state.modal = 'tourn'; I.state.key = p.key;
  const t = L.text(I.renderModal(p, I.build(p)));
  I.state.modal = null;
  assert(!/ London /.test(t) && (t.match(/Queen’s Club|Queen's Club/g) || []).length >= 1, 'the modal still lists London');
  return `${FX.tournamentHistory.length} served rows → ${v.length} events · Queen's Club 6–2 · 's-Hertogenbosch 4–1 · Next Gen Finals 4–1 · Σ played ${played}`;
});
H.check('5 · the page loads tournament-identity.js, publishes it, and folds every served shard through it', () => {
  assert(/<script src="tournament-identity\.js"><\/script>/.test(DASH), 'no <script src="tournament-identity.js">');
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
  assert(/^\s*cp tournament-identity\.js _site\//m.test(yml), 'pipeline.yml does not publish tournament-identity.js (it would 404)');
  const f = DASH.indexOf('function loadTourHistShard(playerKey){');
  assert(/TI\.mergeHistory\(th\)/.test(DASH.slice(f, f + 1600)), 'loadTourHistShard does not fold the shard');
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · Key insights: absent data is not a sample-size finding
// ════════════════════════════════════════════════════════════════════════════
H.check('6 · no career-splits entry → Key insights says "No split data on record.", not the ten-match minimum', () => {
  const { I, p } = fxModule({ extra: { careerSplits: {} } });
  const t = L.text(I.renderInsights(p));
  assert(!/ten-match minimum/.test(t), 'states a sample-size reason for absent data: ' + t.trim());
  assert(/No split data on record\./.test(t), t.trim());
});
H.check('6 · splits held but none reaches n >= 10 → the ten-match minimum (the one case that wording is true)', () => {
  const sc = {};
  ['Hard', 'Clay', 'Grass', 'Best of 3', 'Best of 5'].forEach((m) => { sc[m] = { W: 3, L: 2 }; });
  const { I, p } = fxModule({ extra: { careerSplits: { [FX.key]: { career: sc } } } });
  const t = L.text(I.renderInsights(p));
  assert(/No splits clear the ten-match minimum\./.test(t), t.trim());
});

(async () => { await mountChecks(); H.done(); })().catch((e) => { console.error(e); process.exit(1); });
