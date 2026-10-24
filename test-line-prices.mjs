// bet105-line-prices — the browser side: line-prices.js (the ONE lookup), the dashboard's Hot lines cell (fhLinePx, used by
// the H2H tab, the Key factors H2H card and the Head-to-head page) and Derived lines' cell (player-profile-v2.js lcLinePx),
// on one shard. Each check names the mutation that turns it red (applied to copies in the M* checks at the end).
//   1  exact line only: a line bet105 does not offer is a dash with the ladder on hover, never another line's price
//   2  stale: a shard last refreshed > 30 min ago dashes                   3  started dashes        4  suspended dashes
//   5  SAME line, SAME match, SAME price: Derived lines and all three Hot lines views read one value
//   6  right side: "Bublik −2.5" is Bublik's price even on the H2H page where Bublik is the row's player A
//   7  wiring: each of the three Hot lines call sites passes the price hook; the table puts it under the record
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(process.env.LPT_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const LPSRC = process.env.LPT_JS || join(HERE, 'line-prices.js');

const NOW = Date.parse('2026-10-24T12:10:00Z');
const SHARD = {
  v: 1, book: 'bet105', seenAt: '2026-10-24T12:00:00Z',
  fields: ['market', 'side', 'line', 'price', 'implied', 'status', 'open', 'openTs', 'maxLimit', 'insertedOn'],
  events: { '12173801': { p1Key: '1093', p2Key: '1895', lines: [
    ['gh', '1093', -3.5, 2.48, 0.388, 'ok', null, null, 3900, '2026-10-24T11:05:06Z'],
    ['gh', '1093', -3, 2.29, 0.4205, 'ok', 2.2, '2026-10-23T09:00:00Z', 3900, '2026-10-24T11:05:06Z'],
    ['gh', '1093', -2.5, 2.01, 0.4809, 'ok', null, null, 3900, '2026-10-24T11:05:06Z'],
    ['gh', '1895', 2.5, 1.862, 0.5191, 'ok', null, null, 3900, '2026-10-24T11:05:06Z'],
    ['gh', '1895', 3, 1.662, 0.5795, 'ok', null, null, 3900, '2026-10-24T11:05:06Z'],
    ['gh', '1895', -2.5, null, null, 'suspended', null, null, 3900, '2026-10-24T11:05:06Z'],
    ['gh', '1093', 2.5, null, null, 'suspended', null, null, 3900, '2026-10-24T11:05:06Z'],
    ['tg', 'over', 22.5, 1.66, 0.5809, 'ok', null, null, 2000, '2026-10-24T11:05:06Z'],
    ['tg', 'under', 22.5, 2.3, 0.4191, 'ok', null, null, 2000, '2026-10-24T11:05:06Z']] } }
};
function fresh(shard = SHARD, now = NOW) {
  delete require.cache[require.resolve(LPSRC)];
  const g = { fetch: async (u) => /2026-10-24\.json$/.test(u) ? { ok: true, json: async () => shard } : { ok: false } };
  const prevNow = Date.now; Date.now = () => now;
  const L = require(LPSRC);
  globalThis.window = Object.assign(globalThis.window || {}, { LinePrices: L, fetch: g.fetch });
  globalThis.fetch = g.fetch;
  return { L, restore: () => { Date.now = prevNow; } };
}

test('1-4: the lookup — exact line only; stale, started and suspended dash; loading is not a dash', async () => {
  const { L, restore } = fresh();
  try {
    assert.equal(L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' }).state, 'loading', 'before the shard loads: loading, never a dash or a price');
    await L.load('2026-10-24');
    const r = L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' });
    assert.equal(r.state, 'ok'); assert.equal(r.price, 2.29); assert.equal(L.faceText(r), '2.29 · 42%');
    assert.equal(r.open, 2.2); assert.equal(r.maxLimit, 3900);
    const miss = L.linePrice(12173801, '1093', 'gh', -4.5, { date: '2026-10-24' });
    assert.equal(miss.state, 'dash', '1: −4.5 is not offered (mutant: nearest-line fallback)'); assert.equal(miss.reason, 'not_offered');
    assert.equal(L.faceText(miss), '—', '1: the face never carries another line\'s price');
    assert.deepEqual(miss.ladder.filter(x => x.status === 'ok').map(x => x.line), [-3.5, -3, -2.5], '1: the offered ladder goes on the hover');
    assert.match(L.hoverLines(miss, 'Medvedev −4.5 games').join('\n'), /Offered: −3\.5 2\.48 · −3 2\.29 · −2\.5 2\.01/);
    assert.equal(L.linePrice(12173801, '1895', 'gh', -2.5, { date: '2026-10-24' }).reason, 'suspended', '4: suspended -> dash (mutant: no status check)');
    assert.equal(L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24', started: true }).reason, 'started', '3: started (mutant: ignore started)');
    assert.equal(L.linePrice(99, '1093', 'gh', -3, { date: '2026-10-24' }).reason, 'no_event');
    assert.equal(L.linePrice(null, '1093', 'gh', -3, { date: null }).reason, 'no_match');
    assert.equal(L.linePrice(12173801, '1093', null, null, { date: '2026-10-24' }).reason, 'no_market', 'Tiebreak in match has no bet105 market');
    assert.equal(L.linePrice(12173801, 'over', 'tg', 22.5, { date: '2026-10-24' }).price, 1.66);
    Date.now = () => NOW + 21 * 60000;     // the shard is now 31 minutes old
    assert.equal(L.linePrice(12173801, '1093', 'gh', -3, { date: '2026-10-24' }).reason, 'stale', '2: > 30 min since the last refresh (mutant: no staleness)');
  } finally { restore(); }
});

// ---- the dashboard's cell and Derived lines' cell, on the same shard ----
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
const constSrc = (name) => { const s = html.indexOf(`\nconst ${name} = `); return html.slice(s, html.indexOf('\n', s + 1)); };
function dash() {
  return new Function('LinePrices', `
    ${['escapeHtml', 'fhEsc', 'maTipHtml', 'fhLinePx', 'fhLinePxCtx', 'eventKeyOfMatch', 'fhH2hLineDefs'].map(slice).join('\n')}
    ${constSrc('FH_MONO')}
    const FH_H2H_SET1_MIRROR = true;
    return { fhLinePx, fhLinePxCtx, fhH2hLineDefs };`)(globalThis.window.LinePrices);
}
function pp2() {
  const sb = { FEATURE_PP2: true, playerProfiles: { players: {} }, matches: [], addEventListener() {}, LinePrices: globalThis.window.LinePrices,
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] } };
  const prev = globalThis.window; globalThis.window = sb;
  try { new Function('window', readFileSync(process.env.LPT_PP2 || join(HERE, 'player-profile-v2.js'), 'utf8'))(sb); } finally { globalThis.window = prev; }
  return sb.PlayerProfileV2._internals;
}
const face = h => (/data-lp-state="(\w+)"[^>]*>([^<]*)</.exec(h) || [])[2];

test('5-6: same line, same match, same price — Derived lines and the three Hot lines views; the right side everywhere', async () => {
  const { L, restore } = fresh();
  try {
    await L.load('2026-10-24');
    const D = dash(), P = pp2();
    const m = { id: 'upcoming-12173801', date: '2026-10-24', p1: 'D. Medvedev', p2: 'A. Bublik', p1Key: 1093, p2Key: 1895 };
    const defs = D.fhH2hLineDefs('Medvedev', 'Bublik');
    const A25 = defs.find(d => d.name === 'Medvedev −2.5 games'), O225 = defs.find(d => d.name === 'Over 22.5 games');
    // H2H tab and Key factors H2H card: the modal's match
    const ctx = D.fhLinePxCtx(m, null);
    const tab = face(D.fhLinePx(A25, ctx)), kf = face(D.fhLinePx(A25, D.fhLinePxCtx(m, null)));
    // Head-to-head page with BUBLIK as the page's player A: "Medvedev −2.5" is then the B line of fhH2hLineDefs(Bublik, Medvedev)
    const pageDefs = D.fhH2hLineDefs('Bublik', 'Medvedev');
    const B25 = pageDefs.find(d => d.name === 'Medvedev −2.5 games');
    const meet = L.meetingOf([m], 1895, 1093);
    const pageCtx = Object.assign(D.fhLinePxCtx(meet, null), meet.p1Key == 1895 ? {} : { aKey: meet.p2Key, bKey: meet.p1Key });
    const page = face(D.fhLinePx(B25, pageCtx));
    // Derived lines: Medvedev's −2.5 games row, his next match = this one
    const nx = { eventKey: 12173801, date: '2026-10-24', tour: 'ATP Vienna', round: 'R16', qualifying: false, live: false };
    const derived = face(P.lcLinePx({ key: 1093 }, 'bo3', { label: '−2.5 games', spec: ['−2.5 games', 'gh', 2.5, -1] }, nx));
    assert.equal(tab, '2.01 · 48%');
    assert.deepEqual([kf, page, derived], [tab, tab, tab], '5: one value on every view (mutant: any view reading its own source)');
    // 6: the other side of the same line is Bublik +2.5 — never what a Medvedev row shows
    assert.equal(face(D.fhLinePx(pageDefs.find(d => d.name === 'Bublik −2.5 games'), pageCtx)), '—', '6: Bublik −2.5 is suspended here: a dash, not Medvedev\'s price');
    assert.equal(face(D.fhLinePx(O225, ctx)), face(P.lcLinePx({ key: 1093 }, 'bo3', { label: 'over 22.5', spec: ['over 22.5', 'tg', 22.5, 1] }, nx)),
      'Over 22.5 is one price on both surfaces');
    assert.equal(face(D.fhLinePx(defs.find(d => d.name === 'Tiebreak in match'), ctx)), '—', 'a line with no bet105 market dashes');
    assert.equal(face(P.lcLinePx({ key: 1093 }, 'bo5', { label: '−3.5 games', spec: ['−3.5 games', 'gh', 3.5, -1] }, nx)), '—',
      'a Bo5 row against a Bo3 match dashes (the same line is a different bet)');
    assert.equal(face(P.lcLinePx({ key: 1093 }, 'bo3', { label: '−2.5 games', spec: ['−2.5 games', 'gh', 2.5, -1] }, null)), '—', 'no upcoming match -> dash');
  } finally { restore(); }
});

test('7: wiring — every Hot lines instance passes the price hook; the table renders it under the record', () => {
  assert.match(html, /price: x => fhLinePx\(x\.L, pxCtx\),\n    lineCls: k => `h2hl hl-\$\{k\}`/, 'H2H tab (mutant: hook removed)');
  assert.match(html, /\$\{x\.c\} of \$\{x\.n\}<\/span>\$\{fhLinePx\(x\.L, kfPx\)\}/, 'Key factors H2H card');
  assert.match(html, /price: x => fhLinePx\(x\.L, h2hPx\),/, 'Head-to-head page');
  assert.match(slice('fhHotLinesTable'), /class="fh-hl-cov"[^\n]*\n[^\n]*\n\s*\$\{opts\.price \? opts\.price\(x\) : ''\}/, 'the price sits in the Covered cell, under "x of n"');
  assert.match(html, /<script src="line-prices\.js"><\/script>\n<script src="player-profile-v2\.js"><\/script>/, 'the helper loads before the profile module');
  assert.doesNotMatch(html.slice(0, html.indexOf('<script src="line-prices.js">')), /line-prices\/[^'"`]*\.json/, 'no shard in the eager startup payload');
});
