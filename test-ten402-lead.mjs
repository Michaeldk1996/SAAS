// TEN-402 lead: Head to Head must not re-enter its own loaders.
// loadMatches ends by calling H2HPage.ensureInit() while the page is open, and ensureInit calls triggerLoads, which
// calls loadMatches again. Before the guard the pair repainted about 17 times a second and real clicks were lost.
// The test runs the page's own triggerLoads (sliced from the HTML) inside a loop that mimics that hand-back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.equal(n, 6, 'expected the 6 loaders exactly once, got ' + n);
});

test('CONTROL: without the guard the loop re-enters (the test would catch a revert)', async () => {
  const guard = '    if (Date.now() - _loadsAt < H2H_RELOAD_MS) return;\n';
  assert.equal(SRC.split(guard).length, 2, 'mutant anchor not found exactly once');
  const n = await loaderCalls(SRC.replace(guard, ''));
  assert.ok(n > 6, 'the unguarded loop should call the loaders more than once, got ' + n);
});

// Founder answer 3 (card 01102d24): a retirement counts as a meeting and reads as the Playing styles ledger does —
// sets column "—", score "5–0 ret." (en dash), result square by the official winner. EXECUTED on the rebuilt renderers
// (tools/h2h-test-harness.js runs the shipped module). Mutants: tools/test-ten402-fix-mutants.js.
const HX = createRequire(import.meta.url)(join(dirname(fileURLToPath(import.meta.url)), 'tools/h2h-test-harness.js'));
const text = h => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const A = { key: '1', short: 'J. Sinner', full: 'J. Sinner', mono: 'JS' }, B = { key: '2', short: 'C. Alcaraz', full: 'C. Alcaraz', mono: 'CA' };
test('H2H ledger: a retirement row shows sets "—" and an en-dash score ("5–0 ret.")', () => {
  const h = HX.load({ html: SRC, globals: { loadSetStatsIndex: () => Promise.resolve(new Set()) } });
  const row = (date, won, sets, o) => Object.assign({ mid: 'm' + date, date, won, tourn: 'Cincinnati Open', surface: 'Hard', round: 'F', sets,
    pS: sets.filter(x => x[0] > x[1]).length, oS: sets.filter(x => x[0] < x[1]).length, price: null, oppPrice: null }, o || {});
  const F = [row('2024-08-18', true, [[6, 4], [7, 5]]), row('2025-08-18', true, [[5, 0]], { ret: true, pS: 1, oS: 0 })];
  h.state.h2hBox = true;
  const box = h.call(h.h2hBoxHTML, { a: A, b: B, h2h: { F, all: F, surf: 'all', aS: 'Sinner', bS: 'Alcaraz', aName: 'J. Sinner', bName: 'C. Alcaraz', aKey: '1', bKey: '2' } });
  const rows = [...box.matchAll(/data-fh-mid="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)].map(m => text(m[2]));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^18\.08\. Cincinnati Open Hard F — 5–0 ret\. — —$/, 'the retirement: sets "—", "5–0 ret."');
  assert.match(rows[1], /^18\.08\. Cincinnati Open Hard F 2–0 6-4, 7-5 — —$/, 'control: a completed meeting keeps its sets "2–0"');
});
test('R1 review: the Playing styles ledger shows a retirement as the meetings ledger does (sets —, "5–0 ret.")', () => {
  const h = HX.load({ html: SRC, globals: { _careerHistoryShards: {}, _sfDbJoinSt: 'loading', _sfDbJoinP: new Promise(() => {}) } });
  const rows = [{ won: true, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'Cincinnati Masters', result: '6-4 5-0 RET', date: '2025-08-07', round: 'F' },
    { won: true, opponent: 'Carlos Alcaraz', surface: 'hard', tournament: 'Basel', result: '6-4 7-5', date: '2024-10-21', round: 'F' }];
  const v = { a: A, b: B, styles: { sides: [{ p: A, R: { state: 'ready', oppLab: 'All Court Elite', avg: 50, rows } }, { p: B, R: { state: 'ready', oppLab: 'Big Server', avg: 50, rows: [] } }], arch: ['x', 'y'] } };
  const card = h.call(h.stylesCard, v);
  const led = [...card.matchAll(/<div class="seg x-row"[^>]*grid-template-columns:52px[^>]*>([\s\S]*?)<\/div>/g)].map(m => text(m[1]));
  assert.match(led[0], /^07\.08\. Alcaraz F 6–4, 5–0 ret\. — — — ›$/, 'a retirement after a set won: sets "—", never "1–0"');
  assert.match(led[1], /^21\.10\. Alcaraz F 6-4, 7-5 2–0 — — ›$/, 'control: a completed row keeps "2–0"');
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

