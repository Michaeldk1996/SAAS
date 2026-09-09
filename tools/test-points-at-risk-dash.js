// TEN-172 — Points at Risk tile dash-vs-zero ruling harness.
// Encodes the founder ruling of 2026-09-08: "A zero standing in for missing data
// is not acceptable on this product — no resolved events is a dash case."
//
// The 12 players that surfaced this were all one category: a row IS present in
// points-at-risk.json (so there is a real in-window footprint) but resolvedCount
// is 0, because every one of their events was excluded by the fail-closed
// round-integrity gate (US Open 2026, incomplete feed). points is then 0, and the
// tile rendered a bare "0" — indistinguishable from "nothing at risk".
//
// The two dash cases must stay distinguishable in the sub-line:
//   absent row              -> "No main-tour events in window"  (no footprint at all)
//   present row, 0 resolved -> "0 of N events resolved"         (footprint, none resolvable)
//
// Run: node tools/test-points-at-risk-dash.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ── The tile block lives inline in the profile builder (not exported), so lift
//    the source of the parRow/parValue/parSub computation and run it directly.
const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
const start = src.indexOf('const parRow = (typeof _parData');
assert(start !== -1, 'parRow block not found in bsp-consult-dashboard.html');
const end = src.indexOf('const tileDefs = [', start);
assert(end !== -1 && end > start, 'tileDefs terminator not found after parRow block');
const block = src.slice(start, end);
assert(/parValue/.test(block) && /parSub/.test(block), 'lifted block is missing parValue/parSub');

const tile = new Function('p', '_parData', `${block}\nreturn { value: parValue, sub: parSub };`);

const row = (over) => ({ player: 'X', points: 0, coverage: 'gap', resolvedCount: 0, gapCount: 1, benignDashCount: 0, ...over });
const data = (key, r) => ({ _meta: {}, players: r ? { [key]: r } : {} });

// ── Ruling: resolvedCount 0 dashes, never renders the bare 0. ────────────────
{
  const t = tile({ key: '657' }, data('657', row()));
  assert.strictEqual(t.value, '—', `resolvedCount 0 must dash, got ${JSON.stringify(t.value)}`);
  assert.strictEqual(t.sub, '0 of 1 event resolved');
}
// Same, when the only accounted-for events are dash-by-rule rather than gaps.
{
  const t = tile({ key: '391' }, data('391', row({ gapCount: 1, benignDashCount: 1 })));
  assert.strictEqual(t.value, '—');
  assert.strictEqual(t.sub, '0 of 2 events resolved', 'plural + benign dashes must be counted');
}
// A 0 that arrives as a string, or a missing/odd resolvedCount, must not slip
// through — and must land on the RIGHT dash reason. Asserting only `value` here
// would let `Number()` be dropped from the coercion: '0' is truthy, so the value
// still dashes while the sub-line silently falls back to "0 events · 1 gap" and
// the two dash reasons stop being distinguishable.
for (const over of [{ resolvedCount: '0' }, { resolvedCount: undefined }, { resolvedCount: null },
                    { resolvedCount: NaN }, { resolvedCount: 'abc' }, { resolvedCount: -2 }]) {
  const t = tile({ key: '1' }, data('1', row(over)));
  assert.strictEqual(t.value, '—', `resolvedCount ${JSON.stringify(over.resolvedCount)} must dash`);
  assert.strictEqual(t.sub, '0 of 1 event resolved',
    `resolvedCount ${JSON.stringify(over.resolvedCount)} must keep the unresolvable reason, got ${JSON.stringify(t.sub)}`);
}
// A non-numeric points must dash rather than print "null"/"undefined" at 26px.
for (const over of [{ resolvedCount: 3, points: null }, { resolvedCount: 3, points: undefined }]) {
  const t = tile({ key: '1' }, data('1', row(over)));
  assert.strictEqual(t.value, '—', `points ${JSON.stringify(over.points)} must dash, never print`);
}
// Defence in depth: a row with nothing resolved and nothing accounted for must
// not render the nonsense "0 of 0 events resolved". Unreachable from today's
// generator, but one cross-file invariant away.
{
  const t = tile({ key: '1' }, data('1', row({ gapCount: 0, benignDashCount: 0 })));
  assert.strictEqual(t.value, '—');
  assert.strictEqual(t.sub, 'No events resolved');
}

// ── The other dash case keeps its own, different reason string. ──────────────
{
  const t = tile({ key: 'gasquet' }, data('gasquet', null));
  assert.strictEqual(t.value, '—');
  assert.strictEqual(t.sub, 'No main-tour events in window');
}
// Pre-load must say Loading…, not dash-with-a-reason (the data may yet arrive).
{
  const t = tile({ key: 'x' }, null);
  assert.strictEqual(t.value, '—');
  assert.strictEqual(t.sub, 'Loading…');
}

// ── Regression guard: real totals still render, and still reconcile. ─────────
{
  const t = tile({ key: '2072' }, data('2072', row({ points: 10000, coverage: 'complete', resolvedCount: 13, gapCount: 0, benignDashCount: 1 })));
  assert.strictEqual(t.value, '10000', 'a complete row must still show its figure');
  assert.strictEqual(t.sub, '13 events · next 52wk');
}
{
  const t = tile({ key: '2382' }, data('2382', row({ points: 4160, coverage: 'partial', resolvedCount: 8, gapCount: 1, benignDashCount: 2 })));
  assert.strictEqual(t.value, '4160');
  assert.strictEqual(t.sub, '8 events · 1 gap');
}

// ── The mirror defect: a TRUE zero must survive. ─────────────────────────────
// 10 players in the live artifact have resolvedCount 1 and points 0 — a single
// first-round loss (R32 at a 250/500, or a qualifying early-round exit), which
// genuinely awards 0. For them "0 points at risk" is a correct, resolved figure,
// not missing data. Dashing those would hide a real number, so the dash must key
// off resolvedCount and never off points.
for (const over of [
  { resolvedCount: 1, points: 0, coverage: 'complete', gapCount: 0 },                       // R32 loss, 0 pts
  { resolvedCount: 1, points: 0, coverage: 'partial', gapCount: 1 },                        // same, plus a gap
]) {
  const t = tile({ key: 'z' }, data('z', row(over)));
  assert.strictEqual(t.value, '0', 'a resolved 0-point event is a true zero and must render as 0');
  assert.match(t.sub, /^1 event · /, `singular sub expected, got ${JSON.stringify(t.sub)}`);
}

// ── Blanket: the dash is driven by resolvedCount alone. ─────────────────────
for (const rc of [0, 1, 5]) {
  for (const pts of [0, 10, 4160]) {
    const t = tile({ key: 'k' }, data('k', row({ resolvedCount: rc, points: pts })));
    assert.strictEqual(t.value, rc === 0 ? '—' : String(pts),
      `resolvedCount=${rc} points=${pts} rendered ${JSON.stringify(t.value)}`);
  }
}

// ── Clickability must key off the ROW, not the value. ───────────────────────
// A dashing gap tile still has to open the drawer — that is the only place the
// excluded event is named ("US Open '26 · round-integrity gate failed"). Gating
// the click on parResolved would make the dash a dead end with no explanation.
// The tileDefs wiring sits outside the lifted block, so assert it at source.
{
  const defStart = src.indexOf("{ label: 'Points at Risk'");
  assert(defStart !== -1, "Points at Risk tileDef not found");
  // Search forward from the tileDef — an earlier `const tilesHtml` exists in the file.
  const def = src.slice(defStart, src.indexOf('const tilesHtml', defStart));
  assert(def.length > 0 && def.length < 600, `unexpected tileDef slice length ${def.length}`);
  const m = def.match(/onclick:\s*([^?]+)\?/);
  assert(m, 'Points at Risk tileDef has no conditional onclick');
  assert.strictEqual(m[1].trim(), 'parRow',
    `click must be gated on parRow alone (a dashed gap tile still opens the drawer), got ${JSON.stringify(m[1].trim())}`);
}

// ── The drawer foot obeys the same rule as the tile. ────────────────────────
// Founder confirmation confirmation:TEN-172:drawer-foot-dash:v1 (accepted
// 2026-09-08): with nothing resolved the foot renders "—", not "0". Without this
// the tile said "—" and the click-through said "0" — the two surfaces disagreeing
// about the same player. Runs the REAL drawer block under a minimal DOM shim.
{
  const A = src.indexOf('const PAR_TIER_LABEL = {');
  const B = src.indexOf('// ---- TEN-126 Break/Hold heatmap');
  assert(A !== -1 && B > A, 'drawer block not found in bsp-consult-dashboard.html');
  const drawerSrc = src.slice(A, B);

  const node = () => ({ _html: '', _text: '', classList: { add() {}, remove() {} },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text; } });
  const nodes = {};
  for (const id of ['ppSplitDrawer', 'ppsdHead', 'ppsdBody', 'ppsdSub']) nodes[id] = node();
  const sandbox = {
    document: { getElementById: (id) => nodes[id] || (nodes[id] = node()) },
    PP_MONTHS: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    ppHexA: (h) => h,
    escapeHtml: (s) => String(s == null ? '' : s),
    ppSplitRoundLabel: (rd) => String(rd || '').toUpperCase(),
    ppAbbrevName: (n) => String(n || ''),
    ensurePpSplitDrawer: () => nodes.ppSplitDrawer,
    ppSplitDrawerState: { open: false, key: null },
    playerProfiles: {}, _parData: null,
  };
  const names = Object.keys(sandbox);
  const render = new Function(...names,
    `${drawerSrc}\nreturn function(row){ renderParDrawerBody(row); return { body: document.getElementById('ppsdBody').innerHTML, foot: document.getElementById('ppsdBody').innerHTML.split('Points at Risk').pop() }; };`
  )(...names.map(n => sandbox[n]));

  // Nothing resolved, one named gap -> foot dashes, and the gap is still named.
  const gapRow = { player: 'D. Rincon', points: 0, coverage: 'gap', resolvedCount: 0, gapCount: 1,
    benignDashCount: 0, perEvent: [],
    dashed: [{ event: 'US Open', season: '2026', tier: 'GrandSlam', date: null, dropDate: null,
               reason: 'round-integrity gate failed: deepest round present is R16, not F' }],
    benignDashed: [] };
  const g = render(gapRow);
  assert(/US Open/.test(g.body) && /round-integrity gate failed/.test(g.body),
    'the excluded event must still be named by the drawer');
  assert(g.foot.includes('—'), `foot must dash when nothing resolved, got ${JSON.stringify(g.foot.slice(0, 200))}`);
  assert(!/>0</.test(g.foot), `foot must not print a bare 0, got ${JSON.stringify(g.foot.slice(0, 200))}`);
  assert(!/does not match tile/.test(g.body), 'dashing the foot must not trip the reconcile warning');

  // A genuine resolved 0 (lone first-round loss) still prints 0 in the foot.
  const trueZero = { player: 'M. Ymer', points: 0, coverage: 'complete', resolvedCount: 1, gapCount: 0,
    benignDashCount: 0, dashed: [], benignDashed: [],
    perEvent: [{ event: 'Stockholm', season: '2025', round: 'R32', points: 0, flags: [],
                 tier: 'ATP250', date: '2025-10-20', dropDate: '2026-10-19' }] };
  const z = render(trueZero);
  assert(/>0</.test(z.foot), `a resolved 0-point event must still foot as 0, got ${JSON.stringify(z.foot.slice(0, 200))}`);
  assert(!/does not match tile/.test(z.body), 'a true zero must reconcile');

  // Normal player still reconciles and prints the figure.
  const normal = { player: 'J. Sinner', points: 1500, coverage: 'complete', resolvedCount: 2, gapCount: 0,
    benignDashCount: 0, dashed: [], benignDashed: [],
    perEvent: [{ event: 'Beijing', season: '2025', round: 'W', points: 500, flags: [], tier: 'ATP500', date: '2025-10-05', dropDate: '2026-10-05' },
               { event: 'Paris', season: '2025', round: 'W', points: 1000, flags: [], tier: 'Masters1000', date: '2025-11-02', dropDate: '2026-11-02' }] };
  const n = render(normal);
  assert(n.foot.includes('1,500'), `normal foot must print the total, got ${JSON.stringify(n.foot.slice(0, 200))}`);
  assert(!/does not match tile/.test(n.body), 'normal player must reconcile');
}

console.log('TEN-172 points-at-risk dash rules: PASS (tile + drawer foot dash when nothing resolved, true zeros preserved, gap tiles clickable)');
