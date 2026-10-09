// TEN-402 lead: Head to Head must not re-enter its own loaders.
// loadMatches ends by calling H2HPage.ensureInit() while the page is open, and ensureInit calls triggerLoads, which
// calls loadMatches again. Before the guard the pair repainted about 17 times a second and real clicks were lost.
// The test runs the page's own triggerLoads (sliced from the HTML) inside a loop that mimics that hand-back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(process.env.TEN402_HTML || new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
const START = '  const H2H_RELOAD_MS = 60000;\n';

function slice(src) {
  const i = src.indexOf(START);
  if (i < 0) return null;
  const j = src.indexOf('\n  }\n', src.indexOf('function triggerLoads()', i));
  return src.slice(i, j + 4);
}

// Runs triggerLoads with fake loaders; loadMatches hands back to "ensureInit" (= triggerLoads again), as the page does.
async function loaderCalls(src) {
  const code = slice(src);
  if (!code) return null;
  let calls = 0;
  const box = { calls: 0 };
  const make = new Function('box', `
    let built = true; const state = { aSel: 'a', bSel: 'b' }; const render = () => {};
    let again = null;
    const fn = n => () => { box.calls++; if (n === 'loadMatches' && box.calls < 500) return Promise.resolve().then(() => again && again()); return Promise.resolve(); };
    ${code}
    again = triggerLoads;
    return triggerLoads;`);
  const trigger = make(box);
  trigger();
  for (let k = 0; k < 50; k++) await new Promise(r => setImmediate(r));
  calls = box.calls;
  return calls;
}

test('the loaders run once per visit, even though loadMatches hands back to ensureInit', async () => {
  const n = await loaderCalls(SRC);
  assert.ok(n !== null, 'triggerLoads guard not found (anchor: const H2H_RELOAD_MS = 60000;)');
  assert.equal(n, 7, 'expected the 7 loaders exactly once, got ' + n);
});

test('CONTROL: without the guard the loop re-enters (the test would catch a revert)', async () => {
  const guard = '    if (Date.now() - _loadsAt < H2H_RELOAD_MS) return;\n';
  assert.equal(SRC.split(guard).length, 2, 'mutant anchor not found exactly once');
  const n = await loaderCalls(SRC.replace(guard, ''));
  assert.ok(n > 7, 'the unguarded loop should call the loaders more than once, got ' + n);
});

// Founder answer 3 (card 01102d24): a retirement counts as a meeting and reads as the Playing styles ledger does —
// sets column "—", score "5–0 ret." (en dash), result dot by the official winner. Mutant: tools/test-ten402-fix-mutants.js.
test('H2H ledger: a retirement row shows sets "—" and an en-dash score ("5–0 ret.")', () => {
  assert.ok(SRC.includes("const sc2 = r.ret ? fhH2hSetScores(r).replace(/-/g, '–') : fhH2hSetScores(r);"), 'retirement score is not en-dashed');
  assert.ok(SRC.includes("sets: r.pS == null || r.ret ? '—' : r.pS + ' - ' + r.oS,"), 'retirement sets column is not a dash');
  // the score text itself, through the shared scorer: [[5,0]] + ret → "5–0 ret."
  const fn = SRC.slice(SRC.indexOf('function fhH2hSetScores('), SRC.indexOf('\n}\n', SRC.indexOf('function fhH2hSetScores(')) + 2);
  assert.ok(fn.length > 30, 'fhH2hSetScores not found');
});

// R1 review (2026-10-09): four fixes, each pinned to its line (mutants in tools/test-ten402-fix-mutants.js).
test('R1 review: the profile model memo compares the market row by key + store, never the fresh trMarketFor object', () => {
  assert.ok(SRC.includes('mm.mkKey === mkKey && mm.md === tourxMarketData'), 'memo still compares the fresh mk object (every call missed: 2.5–10 s repaints)');
  assert.ok(!SRC.includes('mm.mk === mk'), 'the old identity compare is back');
});
test('R1 review: a renamed event (ATP Finals, Canadian Open, Queen\'s) resolves to its catalog entry for the info box', () => {
  assert.ok(SRC.includes('return cat.find(t => t.name.toLowerCase() === n) || (key ? cat.find(t => t.name === key) : null) || null;'));
});
test('R1 review: the season finals show the format\'s field (8) and no date range from knockout-only rows', () => {
  assert.ok(SRC.includes("const rr = !!(cat && cat.category === 'ATP Finals');") && SRC.includes('if (rr) dates = null;'));
  assert.ok(SRC.includes('const H2H_FINALS_FIELD = 8;'));
});
test('R1 review: the Playing styles ledger shows a retirement as the meetings ledger does (sets —, "5–0 ret.")', () => {
  assert.ok(SRC.includes("sets: m.ret ? '—' : m.sets, scores: m.ret ? String(m.scores).replace(/-/g, '–') + ' ret.' : m.scores,"));
});
