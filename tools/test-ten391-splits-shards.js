'use strict';
// tools/test-ten391-splits-shards.js — TEN-391 (founder, 2026-10-07): career splits are ONE FILE PER
// PLAYER (career-splits/<key>.json) + a small tour file (career-splits-tour.json); nothing loads them up
// front; the rank cap is gone; "Splits not built for this player yet" only when his file genuinely
// does not exist.
//
// Every check drives the REAL code: the builder's writers and roster join (required), the dashboard's
// loader / tour readers (sliced out of bsp-consult-dashboard.html and executed), and the profile module
// (player-profile-v2.js, loaded through ten384-figures-lib). Data is a pinned fixture: 12 player
// objects cut verbatim from the deployed single career-splits.json (the last build before the split).
//
// Run: node tools/test-ten391-splits-shards.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const B = require('./build-career-splits.js');
const STORE = require('./career-splits-store.js');

const ROOT = L.ROOT;
const H = L.harness();
const T = L.text;
const DASH = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const OLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten391-career-splits', 'old-career-splits.json'), 'utf8'));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const NOT_BUILT = 'Splits not built for this player yet';

function slice(from, to, fromIdx) {
  const a = DASH.indexOf(from, fromIdx || 0);
  const b = DASH.indexOf(to, a + from.length);
  assert(a >= 0 && b > a, `slice "${from}" … "${to}" is not where it was`);
  return DASH.slice(a, b);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ten391-'));

console.log('TEN-391 — career splits: one file per player');

// ════════════════════════════════════════════════════════════════════════════
// 1 · the shard writer reproduces the old single file exactly (pinned fixture)
// ════════════════════════════════════════════════════════════════════════════
H.check('1 · each career-splits/<key>.json is byte-identical to players[key] of the old single file', () => {
  const dir = path.join(tmp(), 'career-splits');
  const w = B.writePlayerFiles(dir, OLD.players);
  const keys = Object.keys(OLD.players);
  assert.strictEqual(w.written, keys.length);
  for (const k of keys) {
    assert.strictEqual(fs.readFileSync(path.join(dir, k + '.json'), 'utf8'), JSON.stringify(OLD.players[k]), `${k}: bytes differ`);
  }
  assert.deepStrictEqual(STORE.loadAll(path.dirname(dir)).players, OLD.players, 'loadAll does not reassemble the old map');
  assert.deepStrictEqual(STORE.readPlayer('2382', path.dirname(dir)), OLD.players['2382']);
  assert.strictEqual(STORE.readPlayer('207', path.dirname(dir)), null, 'a player with no file must read null');
  return `${keys.length} players, Alcaraz ${fs.statSync(path.join(dir, '2382.json')).size} B, identical`;
});
H.check('1 · a rebuild removes the file of a player it no longer produces (the old file was replaced whole)', () => {
  const dir = path.join(tmp(), 'career-splits');
  B.writePlayerFiles(dir, OLD.players);
  const fewer = Object.assign({}, OLD.players); delete fewer['370'];
  const w = B.writePlayerFiles(dir, fewer);
  assert.strictEqual(w.removed, 1);
  assert(!fs.existsSync(path.join(dir, '370.json')), 'the dropped player still has a file');
});
H.mustFail('1 · control: a writer that rounds a figure is caught', () => {
  const dir = path.join(tmp(), 'career-splits');
  const bent = JSON.parse(JSON.stringify(OLD.players));
  bent['2382'].career.Hard.winPct = Math.round(bent['2382'].career.Hard.winPct);
  B.writePlayerFiles(dir, bent);
  assert.strictEqual(fs.readFileSync(path.join(dir, '2382.json'), 'utf8'), JSON.stringify(OLD.players['2382']));
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · the tour file's pooled rows serve the TOUR-WIDE readers exactly as the full map did
// ════════════════════════════════════════════════════════════════════════════
const POOLED = {};
Object.keys(OLD.players).forEach(k => { POOLED[k] = B.pooledRow(OLD.players[k]); });
function legacyBaselines(tour) {
  const src = slice('const PP_SPLIT_TIERS = [', 'function ppSplitExpected(');
  // eslint-disable-next-line no-new-func
  return new Function('careerSplitsTour', src + '\nreturn ppSplitBaselines();')(tour);
}
function engine() {
  const src = slice('var INS_MIN = {', '/* ---------------- The seven checks');
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn { insTourAverages, insTourOverall, insTourShape, insResetTourAverages };')();
}
H.check('2 · legacy tier medians (ppSplitBaselines, the real dashboard code) over `pooled` = over the full player objects', () => {
  const viaPool = legacyBaselines({ pooled: POOLED });
  const viaFull = legacyBaselines({ pooled: OLD.players });
  assert.deepStrictEqual(viaPool, viaFull);
  assert(Object.keys(viaPool.career).length > 5, 'no baselines at all — the check is vacuous');
  return `${Object.keys(viaPool.career).length} career / ${Object.keys(viaPool.last52).length} last-52 categories`;
});
H.check('2 · legacy tier medians: no tour file yet -> neutral (empty) and NOT cached', () => {
  const src = slice('const PP_SPLIT_TIERS = [', 'function ppSplitExpected(');
  // eslint-disable-next-line no-new-func
  const run = new Function('box', 'let careerSplitsTour = null;\n' + src +
    '\nconst a = ppSplitBaselines(); careerSplitsTour = box.tour; const b = ppSplitBaselines(); return { a, b };');
  const r = run({ tour: { pooled: POOLED } });
  assert.deepStrictEqual(r.a, { career: {}, last52: {} });
  assert(Object.keys(r.b.career).length > 5, 'the empty answer was cached past the pool landing');
});
H.check('2 · legacy Key insights tour averages (the real engine) over `pooled` = over the full player objects', () => {
  const E1 = engine(), E2 = engine();
  assert.deepStrictEqual(E1.insTourAverages(POOLED), E2.insTourAverages(OLD.players));
  assert.strictEqual(E1.insTourOverall(POOLED), E2.insTourOverall(OLD.players));
  assert.deepStrictEqual(E1.insTourShape(POOLED), E2.insTourShape(OLD.players));
});
H.check('2 · a pooled row carries only M / W / winPct, equal to the player file', () => {
  for (const [k, p] of Object.entries(OLD.players)) {
    assert.strictEqual(POOLED[k].rank, p.rank);
    for (const which of ['career', 'last52']) {
      for (const [cat, r] of Object.entries(p[which] || {})) {
        assert.deepStrictEqual(POOLED[k][which][cat], { M: r.M, W: r.W, winPct: r.winPct }, `${k} ${which} ${cat}`);
      }
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · the browser: the per-player loader is the ONLY path; nothing fetches career splits up front
// ════════════════════════════════════════════════════════════════════════════
function loaderHarness(respond) {
  const calls = [];
  const win = {};
  const fetch = url => { calls.push(url); return respond(url); };
  const src = DASH.slice(DASH.indexOf('let careerSplits = {};'), DASH.indexOf('// TEN-8 ASAP Sports', DASH.indexOf('let careerSplits = {};')));
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'fetch', 'ppState', 'ppRepaint', 'insResetTourAverages',
    'let ppSplitBaseCache = null;\n' + src +
    '\nreturn { loadCareerSplitsFor, loadCareerSplitsTour, store: () => careerSplits, tour: () => careerSplitsTour };')(
    win, fetch, { key: null }, () => {}, () => {});
  return { api, calls, win };
}
const ok = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });

(async () => {
  await H.checkAsync('3 · one fetch of career-splits/<key>.json per player; in flight it is marked pending; it lands on careerSplits[key]', async () => {
    let release;
    const h = loaderHarness(url => new Promise(r => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve(OLD.players['2382']) }); }));
    const a = h.api.loadCareerSplitsFor('2382');
    const b = h.api.loadCareerSplitsFor('2382');
    assert.deepStrictEqual(h.calls, ['./career-splits/2382.json']);
    assert.strictEqual(h.win.careerSplitsPending['2382'], true, 'not marked pending while in flight');
    assert(!('2382' in h.api.store()), 'settled before the answer');
    release(); await a; await b;
    assert.deepStrictEqual(h.api.store()['2382'], OLD.players['2382']);
    assert(!h.win.careerSplitsPending['2382'], 'still pending after it landed');
    await h.api.loadCareerSplitsFor('2382');
    assert.strictEqual(h.calls.length, 1, 'refetched a held player');
  });
  await H.checkAsync('3 · a 404 settles NULL (genuinely not built); a network failure settles nothing and retries', async () => {
    const h = loaderHarness(url => (/207/.test(url) ? notFound() : Promise.reject(new Error('offline'))));
    await h.api.loadCareerSplitsFor('207');
    assert.strictEqual(h.api.store()['207'], null, '404 not stored as null');
    await h.api.loadCareerSplitsFor('2382');
    assert(!('2382' in h.api.store()), 'a network failure was recorded as an answer');
    assert(!h.win.careerSplitsPending['2382'], 'a failed load left the pending mark');
    await h.api.loadCareerSplitsFor('2382');
    assert.strictEqual(h.calls.filter(u => /2382/.test(u)).length, 2, 'a failed load is not retried');
  });
  await H.checkAsync('3 · the tour file is its own small fetch, only on request', async () => {
    const h = loaderHarness(() => ok({ pooled: POOLED }));
    assert.deepStrictEqual(h.calls, [], 'something fetched at load time');
    await h.api.loadCareerSplitsTour(); await h.api.loadCareerSplitsTour();
    assert.deepStrictEqual(h.calls, ['./career-splits-tour.json']);
  });
  H.check('3 · no served file fetches the old career-splits.json; the dashboard load path starts no splits fetch', () => {
    const served = ['bsp-consult-dashboard.html', 'player-profile-v2.js'];
    for (const m of DASH.matchAll(/<script src="\.?\/?([^"]+\.js)"/g)) served.push(m[1]);
    for (const f of served) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert(!/fetch\([^)]*career-splits\.json/.test(s), `${f} fetches career-splits.json`);
      assert(!/['"`]\.\/career-splits\.json/.test(s), `${f} names ./career-splits.json`);
    }
    const heavy = DASH.slice(DASH.indexOf('const loadHeavyDatasets = () =>'));
    const body = heavy.slice(0, heavy.indexOf('};'));
    assert(!/[Ss]plits/.test(body), 'loadHeavyDatasets starts a splits load: ' + body);
    assert(!/function loadCareerSplits\(\)/.test(DASH), 'the eager loader is still defined');
    // The only callers: the v2 profile open, the H2H page's enrich, and the legacy profile (with the tour file).
    const callers = [...DASH.matchAll(/loadCareerSplitsTour\(\)/g)].length;
    assert.strictEqual(callers, 2, 'loadCareerSplitsTour is called from somewhere new (' + callers + ' sites incl. its own body)');
    const enrich = slice('  function enrich(pkey) {', '  function buildH2HData() {');
    assert(/fn\('loadCareerSplitsFor'\)/.test(enrich), 'the H2H page does not load the shown player\'s file');
    const v2 = slice('function pp2StartLoads(key){', 'function pp2MountNow(key){');
    assert(/pp2LoadSplits\(key\)/.test(v2) && /loadCareerSplitsFor\(key\)/.test(v2), 'the v2 profile open does not load his file');
    return served.length + ' served files scanned';
  });
  H.mustFail('3 · control: an eager splits fetch in loadHeavyDatasets is caught', () => {
    const body = 'loadPlayerProfiles(); loadCareerSplits(); loadAsapSignals();';
    assert(!/[Ss]plits/.test(body));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4 · "Splits not built for this player yet" ONLY when his file genuinely does not exist
  // ══════════════════════════════════════════════════════════════════════════
  function fx(extra) {
    const p = Object.assign({}, FX.profile);
    const m = L.loadPp2({ now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory },
      marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History, extra });
    return { I: m.I, W: m.W, p: m.I.profileFor ? m.I.profileFor(FX.key) : p };
  }
  const three = (I, p) => ({
    tile: I.boxValues(p, { rows: I.ledgerMatches(p) }).splits,
    insights: T(I.renderInsights(p)).replace(/Key insights/, '').trim(),
    modal: T(I.renderSplitsModal(p)).trim(),
  });
  H.check('4 · in flight: the Draw tile is PENDING, Key insights and the Draw modal say nothing', () => {
    const { I, p } = fx({ careerSplits: {}, careerSplitsPending: { [FX.key]: true } });
    const r = three(I, p);
    assert.strictEqual(r.tile.pending, true, 'tile not pending: ' + JSON.stringify(r.tile));
    assert.strictEqual(r.tile.support, null);
    assert.strictEqual(r.insights, '', 'Key insights claims "' + r.insights + '" while loading');
    assert.strictEqual(r.modal, '', 'the modal claims "' + r.modal + '" while loading');
  });
  H.check('4 · a failed fetch (no answer for him) is still pending, never "not built"', () => {
    const { I, p } = fx({ careerSplits: {}, careerSplitsPending: {} });
    const r = three(I, p);
    assert.strictEqual(r.tile.pending, true);
    assert(!/not built|No split/.test(r.insights + r.modal), r.insights + ' / ' + r.modal);
  });
  H.check('4 · the server answered "no file" (null): all three say "' + NOT_BUILT + '"', () => {
    const { I, p } = fx({ careerSplits: { [FX.key]: null }, careerSplitsPending: {} });
    const r = three(I, p);
    assert.strictEqual(r.tile.support, NOT_BUILT);
    assert.strictEqual(r.insights, NOT_BUILT);
    assert.strictEqual(r.modal, NOT_BUILT);
  });
  H.check('4 · his file is held: a figure, and "not built" nowhere; arrival flips the pending tile', () => {
    const { I, W, p } = fx({ careerSplits: {}, careerSplitsPending: { [FX.key]: true } });
    assert.strictEqual(three(I, p).tile.pending, true);
    // the host's loader landing: his object stored on the same store, the mark cleared (then one repaint)
    W.careerSplits[FX.key] = OLD.players['2840'];
    delete W.careerSplitsPending[FX.key];
    const r = three(I, p);
    assert(!r.tile.pending, 'still pending with his file held');
    assert(r.tile.headline != null, 'no Draw figure with his file held: ' + JSON.stringify(r.tile));
    assert(!/not built/.test(r.tile.support + r.insights + r.modal), 'held file reads "not built"');
    return 'Draw ' + r.tile.headline + ' · ' + r.tile.support;
  });
  H.check('4 · another player\'s file in the store says nothing about him (the old "store non-empty" rule is gone)', () => {
    const { I, p } = fx({ careerSplits: { 99999: OLD.players['2382'] }, careerSplitsPending: {} });
    assert(!/not built/.test(T(I.renderInsights(p)) + three(I, p).modal));
    assert.strictEqual(I.splitsNotBuilt(FX.key), false);
    assert.strictEqual(I.splitsPending(FX.key), true);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5 · the builder's roster join: no rank cap, no namesakes
  // ══════════════════════════════════════════════════════════════════════════
  const R = B.nameIndex([
    { full: 'Carlos Alcaraz', rank: 3 }, { full: 'Jordan Thompson', rank: 432 }, { full: 'Kai Thompson', rank: 2083 },
    { full: "Christopher O'Connell", rank: 400 }, { full: 'Diego Dedura Palomero', rank: 190 },
  ].map(e => e));
  const Lm = B.nameIndex(['Bu Yunchaokete', 'Fabio Fognini', 'Connor Henry Van Schalkwyk', 'Alejandro Hernandez', 'Antonio Hernandez']
    .map((full, order) => ({ full, order })));
  const cand = (name, ix) => B.resolveCandidates({ name }, ix, R, Lm);
  H.check('5 · rank > 250 resolves (Thompson 432, best-ranked namesake first); retired players resolve off TA\'s full list', () => {
    assert.strictEqual(cand('J. Thompson')[0].full, 'Jordan Thompson');
    assert.strictEqual(cand('C. Alcaraz')[0].via, 'rank');
    assert.strictEqual(cand('F. Fognini')[0].full, 'Fabio Fognini');
    assert.strictEqual(cand('Y. Bu', 'Yunchaokete Bu')[0].full, 'Bu Yunchaokete', 'word-order-free index name');
    assert.strictEqual(cand("C. O'Connell")[0].full, "Christopher O'Connell");
    assert.strictEqual(cand('D. Dedura')[0].full, 'Diego Dedura Palomero', 'double surname');
  });
  H.check('5 · initials the profile carries must fit: "C. S. van Schalkwyk" is not Connor Henry', () => {
    assert.deepStrictEqual(cand('C. S. van Schalkwyk'), []);
    assert.strictEqual(cand('C. H. van Schalkwyk')[0].full, 'Connor Henry Van Schalkwyk');
    const amb = cand('A. Hernandez');
    assert(amb.length === 2 && amb.every(c => c.ambiguous), 'two same-initial namesakes must be marked ambiguous');
  });
  H.check('5 · the identity check: ATP id where held, else age vs date of birth', () => {
    const meta = B.pageMeta("var fullname = 'Hubert Hurkacz'\nvar currentrank = 39\nvar dob = 19970211\nvar atp_id = 'HB71'\n");
    assert.deepStrictEqual(meta, { fullName: 'Hubert Hurkacz', atpId: 'HB71', dob: 19970211, currentRank: 39 });
    assert.strictEqual(B.identityCheck(meta, { age: 29 }, 'HB71', '20261007').by, 'atp-id');
    assert.strictEqual(B.identityCheck(meta, { age: 19 }, 'XX99', '20261007').ok, false, 'a wrong ATP id AND a wrong age passed');
    assert.strictEqual(B.identityCheck(meta, {}, 'XX99', '20261007').ok, false, 'a wrong ATP id with no age to decide passed');
    // M. Damm (1317, 23): the alias table holds his father's D214; the page matching his age is D0DT
    const jr = B.identityCheck({ atpId: 'D0DT', dob: 20030305 }, { age: 23 }, 'D214', '20261007');
    assert(jr.ok && /disagrees/.test(jr.note), 'a wrong alias overrode the age');
    assert.strictEqual(B.identityCheck({ atpId: 'martin-damm/d214', dob: 19720501 }, { age: 23 }, 'D214', '20261007').by, 'atp-id', 'slug ids');
    assert.strictEqual(B.identityCheck({ dob: 20080101 }, { age: 56 }, undefined, '20261007').by, 'none', 'the 56 placeholder age was used');
    assert.strictEqual(B.identityCheck(meta, { age: 29 }, undefined, '20261007').by, 'age');
    assert.strictEqual(B.identityCheck(meta, { age: 19 }, undefined, '20261007').ok, false, 'a 10-year age gap passed');
    assert.strictEqual(B.ageAt(19970211, '20260210'), 28);
    assert.strictEqual(B.ageAt(19970211, '20260211'), 29);
  });

  H.done();
})().catch((e) => { console.error(e); process.exit(1); });
