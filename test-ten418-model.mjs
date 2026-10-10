// TEN-418 step 12 (founder 2026-10-10): the Stennisfy Model page redesign. The SHIPPED Model renderer (the block from
// `let edgeCurrentId` to the end of renderEdgeModel in bsp-consult-dashboard.html) runs for real, with the page's own
// price, name and move helpers, against a frozen real board row + its model run (tools/fixtures/ten418-model.json:
// L. Darderi v S. Tsitsipas, Shanghai, 10 Oct 2026, run 04:51Z). Every check names the mutation that turns it red
// (tools/test-ten418-mutants.js). Rules: .claude/rules/stennisfy-model.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN418_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const FIX = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten418-model.json'), 'utf8'));
const BLOCK = (() => {
  const a = html.indexOf('let edgeCurrentId = null;\n'), b = html.indexOf('\n// Form cell for the FORM column.', a);
  assert.ok(a > 0 && b > a, 'the Model renderer block');
  return html.slice(a, b);
})();
const PAGE = (() => { const a = html.indexOf('<div class="tabpage" data-page="edge">'); return html.slice(a, html.indexOf('<div class="modal-overlay" id="favModal">', a)); })();
const CSS = (() => { const a = html.indexOf('/* ── TEN-418 step 12'); return html.slice(a, html.indexOf('</style>', a)); })();
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, 'function ' + name);
  const nl = html.indexOf('\n', at + 1), line = html.slice(at + 1, nl);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  let depth = 0, i = html.indexOf('{', at);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const block = name => { const a = html.indexOf('const ' + name + ' = {'); return html.slice(a, html.indexOf('\n};\n', a) + 3); };
const HELPERS = [block('MX_BOOK_LABELS'), fn('mxBookLabel'), fn('mxOddsTxt'), fn('mxMovePct'), fn('playerInitials'), fn('newsTz'), fn('newsPlayerName')].join('\n');
const NOW = Date.parse('2026-10-10T05:00:00Z');   // 3.5 h before the 08:30Z start: inside the 30 h display window

function boot(opts = {}) {
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', textContent: '', className: '' });
  ['edgeBody', 'edgeHeadSub', 'edgeHeadStats', 'edgeRailList', 'edgeRailN'].forEach(el);
  const navBtn = { matches: sel => sel === '.is-locked' && !!opts.free };
  const calls = { scrollBy: [], scrollIntoView: 0, dd: null, profile: [] };
  const rowEl = { getBoundingClientRect: () => ({ top: 1400, height: 40 }), parentElement: null, classList: { remove() {} }, scrollIntoView() { calls.scrollIntoView++; } };
  const document = {
    getElementById: id => (id.startsWith('emLayer-') ? (els.edgeBody.innerHTML.includes(`id="${id}"`) ? rowEl : null) : (els[id] || null)),
    querySelector: sel => (sel === '.sf-nav [data-tab="edge"]' ? navBtn : null),
    querySelectorAll: () => [],
  };
  const M = JSON.parse(JSON.stringify(opts.m || FIX.m1)), M2 = JSON.parse(JSON.stringify(FIX.m2));
  M.p1 = 'Darderi L.';   // a vendor spelling: the page must print the profile's (shared formatter), never the feed's
  const E = JSON.parse(JSON.stringify(opts.e || FIX.e1));
  const board = FIX.board.map(id => (id === M.id ? M : id === M2.id ? M2 : { id, p1: 'X. A' + id.slice(-2), p2: 'Y. B' + id.slice(-2), p1Key: null, p2Key: null, tour: 'ATP Shanghai', tournamentRound: 'ATP Shanghai - 1/32-finals', date: '2026-10-10', time: '10:30' }));
  const ctx = {
    document, window: { innerHeight: 982, scrollTo() {}, scrollBy: o => calls.scrollBy.push(o) },
    localStorage: { getItem: k => (k === 'stennisfy.tz' ? 'UTC' : null) },
    getComputedStyle: () => ({ overflowY: 'visible' }), MutationObserver: undefined, console,
    setTimeout: () => 0, clearTimeout() {}, fetch: () => Promise.resolve({ ok: false }),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    matches: board.concat([{ id: 'past-12160000', p1: 'Z. Done', p2: 'Z. Over', tour: 'ATP Shanghai', date: '2026-10-09', time: '10:00' }]), modelOutput: { generatedAt: FIX.generatedAt, matches: { [M.id]: E, [M2.id]: FIX.e2 }, analysisOn: opts.analysisOn === true }, modelOutputLoaded: true,
    getFiltered: () => board.slice(), playerProfiles: { 8781: { name: FIX.names.p1 }, 1906: { name: FIX.names.p2 } },
    ppStyleFor: (n, k) => (String(k) === '8781' ? { archetype_label: FIX.styles[0] } : String(k) === '1906' ? { archetype_label: FIX.styles[1] } : null),
    psArchFor: id => { if (!id) return null; let a = ctx.PS_ARCHETYPES.find(x => x.name === id); if (!a) { a = { name: id }; ctx.PS_ARCHETYPES.push(a); } return a; }, sfEventName: raw => (raw === 'ATP Shanghai' ? 'Shanghai Masters' : raw),
    PS_ARCHETYPES: [], PS_PAGE_MIN_N: 30, psMatrixData: { matrix: {} }, psCellFor: () => (opts.cell === undefined ? { pct: 38, n: 1259 } : opts.cell),
    roundBadgeText: r => (/1\/32-finals/.test(r || '') ? 'R64' : null), TR_RESULT: { R64: 'Round of 64' },
    sfDdRender: (id, cfg) => { calls.dd = cfg; }, cardStartMs: m => Date.parse(m.date + 'T08:30:00Z'), cardFmtStart: () => '08:30',
    matchDayBucket: () => 'today', aOddsStartMs: m => Date.parse(m.date + 'T08:30:00Z'), openPlayerProfileFromMatch: k => calls.profile.push(k),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(HELPERS + '\n' + BLOCK + '\nthis.API = { renderEdgeModel, openEdgeModel, edgeOddInput, edgeJumpLayer, edgeSharp, edgeBestSoft, edgeLayerRows, edgeParseOdd, edgeToggleLayers, edgeToggleLayer, edgeGenerate, edgeAiState, get open(){ return [edgeLayersOpen, edgeLayerOpen]; } };', ctx);
  const api = ctx.API;
  api.render = (id = M.id) => { api.openEdgeModel(id); return els.edgeBody.innerHTML; };
  return { api, els, calls, M, E, ctx };
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('header: title, layer sentence from the engine, Matches = the board list, Layers active, Updated = the model run (not the clock)', () => {
  const { api, els } = boot();
  api.render();
  assert.match(PAGE, /<h1 class="sfh__title">Stennisfy Model<\/h1>/);
  assert.equal(els.edgeHeadSub.textContent, 'Fair prices from 14 weighted layers, against the market.');
  const t = text(els.edgeHeadStats.innerHTML);
  assert.match(t, /^Matches 12 Layers active 9\/14 Updated 04:51$/, t);   // R1 fix 1: 14 everywhere
  assert.match(els.edgeHeadStats.innerHTML, /title="Model run 10 Oct, 04:51:34"/);
});

test('rail: Today’s Matches list (same list, count, order), grouped under the canonical event, shared names, selected row', () => {
  const { api, els, calls } = boot();
  api.render();
  assert.equal(els.edgeRailN.textContent, '12 of 12');
  const rows = [...els.edgeRailList.innerHTML.matchAll(/onclick="edgeRailPick\('([^']+)'\)"/g)].map(x => x[1]);
  assert.deepEqual(rows, FIX.board, 'every board match, in board order');
  assert.match(els.edgeRailList.innerHTML, /<span class="em-caps em-rail-gl">Shanghai Masters<\/span>/);
  assert.match(els.edgeRailList.innerHTML, /class="em-rail-row on" onclick="edgeRailPick\('upcoming-12169478'\)">\s*<span class="em-rail-nm">L\. Darderi v S\. Tsitsipas<\/span>\s*<span class="em-rail-meta">R64 · Today 08:30<\/span>/);
  assert.equal(JSON.stringify(calls.dd.options.map(o => o.label)), JSON.stringify(['All tournaments', 'Shanghai Masters']));
});

test('match header: initials, shared name, ELO · step-9 style (mirrored), Tournament · Surface · Round · Format', () => {
  const { api } = boot();
  const t = text(api.render());
  assert.match(t, /^LD L\. Darderi Elo 1830 · Attacking Baseliner vs S\. Tsitsipas Big Server \+ Complete Baseliner · Elo 1884 ST Tournament Shanghai Masters Surface Hard Round Round of 64 Format Best of 3/);
});

test('prices: Pinnacle else bet365; best soft never Pinnacle; open → now · move is mxMovePct on the 2 dp prices', () => {
  const { api, M } = boot();
  const h = api.render();
  assert.equal(api.edgeSharp(M).name, 'Pinnacle');
  assert.equal(api.edgeBestSoft(M, 'p1').key, 'bet365', 'Pinnacle 3.01 is the highest quote on Darderi, but it is not a soft book');
  assert.match(text(h), /Pinnacle −2\.8pp 2\.94 → 3\.03 · \+3\.1%/);
  const noPin = JSON.parse(JSON.stringify(M)); delete noPin.bookNow.Pncl; delete noPin.bookOpens.Pncl;
  assert.equal(api.edgeSharp(noPin).name, 'Bet365', 'no Pinnacle → Bet365');
  assert.ok(api.edgeBestSoft(noPin, 'p1').key !== 'bet365', 'the sharp tile’s book is not also the best soft');
  const pulled = JSON.parse(JSON.stringify(M)); delete pulled.bookNow.Pncl;
  assert.equal(api.edgeSharp(pulled).name, 'Bet365', 'Pinnacle with no price now falls to Bet365');
  assert.match(text(h), /best soft scans William Hill, Bet365, Marathon, Betfair, BetVictor, SBOBET, 1xBet, Betano/);
  assert.match(text(h), /Pinnacle margin now 2\.9% , soft at open 4\.8% \(Bet365\) \/ 4\.9% \(Betano\)/, 'one margin source: the Soft open rows (R1 fix 5)');
  assert.match(text(h), /Best soft −3\.1pp Bet365 Pinnacle −2\.8pp/, 'gaps from the fair % as printed (R1 fix 6)');
  assert.match(text(h), /Soft open Bet365 · 4\.8% 3\.00 \+2\.7pp Pinnacle open 8 Oct · 11:22 · 3\.5% 2\.94 \+1\.6pp Pinnacle now −0\.8pp since open · 2\.9% 3\.03 \+2\.4pp Model base 34\.5% · no margin 2\.90/);
});

test('fair price: editing an odd re-computes its gap in place; empty, ≤ 1.00 and non-numbers read —, never NaN', () => {
  const { api, els } = boot();
  api.render();
  const gap = { textContent: '', className: '' };
  els['emGap-soft-p1'] = gap;
  for (const [v, want, cls] of [['3.40', '+0.8pp', 'em-pos'], ['3,00', '−3.1pp', 'em-neg'], ['', '—', 'em-zero'], ['1.00', '—', 'em-zero'], ['0.9', '—', 'em-zero'], ['abc', '—', 'em-zero'], ['2.5x', '—', 'em-zero']]) {
    api.edgeOddInput({ value: v }, 'upcoming-12169478', 'soft', 'p1');
    assert.equal(gap.textContent, want, `typed "${v}"`);
    assert.equal(gap.className, 'em-gap ' + cls);
  }
  assert.ok(!/NaN/.test(api.render()), 'no NaN after a bad edit');
  assert.match(api.render(), /value="2\.5x"/, 'the typed text survives a re-render');
});

test('value layers: 14 rows by weight then shift; real figures; plain Why that agrees with Data quality; strip click scrolls the container', () => {
  const { api, calls } = boot();
  const rows = JSON.parse(JSON.stringify(api.edgeLayerRows(boot().E).map(r => [r.a.key, r.w.word, r.q])));
  assert.deepEqual(rows.slice(0, 4), [['styleMatchup', 'Highest', 'Poor'], ['subjective', 'Highest', 'Poor'], ['surface', 'High', 'Good'], ['clutch', 'Medium-high', 'Medium']]);
  assert.equal(rows.length, 14, 'every engine layer is a row, the format split included (R1 fix 1)');
  let h = api.render();
  assert.match(text(h), /Value layers Data quality behind each adjustment folded into the price 9 of 14 active 6 good 6 medium 2 poor/);
  assert.equal((h.match(/class="em-seg-q /g) || []).length, 14, 'the strip has 14 segments');
  assert.ok(!/em-lrow/.test(h), 'the breakdown opens on demand');
  api.edgeJumpLayer('surface');
  h = api.render();
  assert.equal(JSON.stringify(api.open), JSON.stringify([true, 'surface']));
  assert.equal(calls.scrollIntoView, 0); assert.equal(calls.scrollBy.length, 1);
  // R1 fixes 2 + 3: the players' real figures; the Why in plain words; one state in the label and the sentence
  assert.match(text(h), /Surface record High 44 ?% 63 ?% S\. Tsitsipas \+1\.0pp Why Hard-court record 44 ?% vs 63 ?% over career and the last 52 weeks, each against their own career baseline\. Data quality Good The inputs behind this layer are complete for both players in this match\./);
  for (const [k, a, b] of [['clutch', '29', '74'], ['serve', '258.0', '303.5'], ['winnerUE', '0.89', '1.05'], ['fatigue', '4.0', '8.0'], ['qualityForm', '−22.0', '−8.0'], ['h2h', '0', '1']])
    assert.match(h, new RegExp(`id="emLayer-${k}"[\\s\\S]*?<span class="em-sc">${a.replace('.', '\\.')}</span>[\\s\\S]*?<span class="em-sc">${b.replace('.', '\\.')}</span>`), k + ' figures');
  assert.ok(!/career\+52wk|recency-wtd|Nₑₓ|rel-to-archetype/.test(h), 'no engine shorthand on the page');
  api.edgeToggleLayer('formatSplit');
  assert.match(text(api.render()), /Format split \(Bo5\) Medium-high — — Gated — Why Best of 3 ?: this layer applies to best-of-five only\. Data quality Medium The layer does not apply to a best-of-three match\./);
  api.edgeToggleLayer('weather');
  assert.match(text(api.render()), /Weather \/ conditions Medium-high — — Gated — Why Switched off for every match until the match-time fix and an indoor check are both in\. Data quality Medium The layer is switched off by a model rule for every match, not by missing data\./);
  api.edgeToggleLayer('subjective');
  assert.match(text(api.render()), /Manual context Highest — — No data — Why No analyst note is attached to this match, so the layer stays neutral\./, 'one name: Manual context');
  api.edgeToggleLayer('styleMatchup');
  assert.match(text(api.render()), /Why Attacking Baseliner v Big Server \+ Complete Baseliner: Attacking Baseliner wins 38% of 1,259 matches\. The model does not read playing styles yet, so the layer is off\./);
  assert.match(text(api.render()), /Style matchup Highest — — Off — Why [^]*?Data quality Medium The model does not read playing styles yet, so this layer is off for every match \(TEN-419\)\./, 'labels known: Off, Medium, one story (review)');
  // an even row (inputs in, no shift): Good + "Even", never "No data / Poor"
  const ev = JSON.parse(JSON.stringify(FIX.e1)); const fa = ev.stage2.adjustments.find(x => x.key === 'fatigue');
  Object.assign(fa, { applied: false, confidence: 'none', direction: 'neutral', signal: 0, deltaP1: 0, detail: '10d load even on Hard: 6s/3m=6.0u vs 7s/3m=7.0u (gap -1.0u < 2).' });
  const evb = boot({ e: ev }); evb.api.render(); evb.api.edgeJumpLayer('fatigue');
  assert.match(text(evb.api.render()), /Fatigue \(recent load\) Medium-high 6\.0 7\.0 Even 0\.0pp Why Match load over the last 10 days: L\. Darderi 6 sets in 3 matches \( ?6\.0 units\), S\. Tsitsipas 7 sets in 3 matches \( ?7\.0 units\)\. The loads are too close for the layer to move the price\. Data quality Good/);
  const thin = boot({ cell: { pct: null, n: 12 } }); thin.api.render(); thin.api.edgeJumpLayer('styleMatchup');
  assert.match(text(thin.api.render()), /Why Attacking Baseliner v Big Server \+ Complete Baseliner: 12 matches, under 30\./, 'the pair cell under 30, with its count');
});

test('biggest movers + Pro gating: the Upgrade line is Free-only', () => {
  const pro = boot();
  let t = text(pro.api.render());
  assert.match(t, /Biggest movers The three factors that moved the price most 1\. Under pressure S\. Tsitsipas \+1\.4pp 2\. Serve strength S\. Tsitsipas \+1\.3pp 3\. Winner \/ unforced-error ratio S\. Tsitsipas \+1\.1pp/);
  assert.ok(!/Upgrade to Pro/.test(t), 'no upgrade line on Pro');
  const free = boot({ free: true });
  assert.match(free.api.render(), /<a class="sf-upgrade em-btn" href="account\.html">Upgrade to Pro to unlock all factors<\/a>/);
});

test('analysis: OFF = no section for anyone; when on: cached text for Pro with stamp, Free = Players + the shared Upgrade, failure keeps Generate', async () => {
  const P = ['One 1.53.', 'Two.', 'Three.', 'Four.', 'Five.'];
  const e = JSON.parse(JSON.stringify(FIX.e1)); e.summary = { ok: true, text: P.join('\n\n'), generatedAt: '2026-10-10T05:12:00Z' };
  for (const free of [false, true]) assert.ok(!/Stennisfy Analysis/.test(boot({ e, free }).api.render()), 'switch off (founder 2026-10-10): no section, Pro or Free');
  const none = boot({ analysisOn: true });
  assert.match(none.api.render(), /Generate Stennisfy Analysis/, 'on, nothing cached: Pro gets the empty state + Generate');
  assert.ok(!/Stennisfy Analysis/.test(boot({ analysisOn: true, free: true }).api.render()), 'Free cannot generate');
  const pro = text(boot({ e, analysisOn: true }).api.render());
  assert.match(pro, /Players One 1\.53\. Matchup Two\. Tournament Three\. Keys Four\. Verdict Five\. Stennisfy Analysis is generated by Stennisfy’s proprietary model and is for informational purposes only\. Generated 05:12/, 'cached text shown to Pro');
  assert.match(pro, /↻ Regenerate/);
  const fr = boot({ e, analysisOn: true, free: true }).api.render();
  assert.match(text(fr), /Players One 1\.53\. Upgrade to Pro to unlock the full analysis/);
  assert.ok(!/Matchup Two|↻ Regenerate|Generated 05:12|em-ai-fade/.test(fr), 'Free: no second paragraph, no Regenerate, no stamp, no fade');
  assert.equal((fr.match(/class="sf-upgrade em-btn"/g) || []).length, 2, 'one button style: the shared Upgrade');
  const g = boot({ analysisOn: true });
  g.ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ generatedAt: 'x', analysisOn: true, matches: { 'upcoming-12169478': Object.assign({}, FIX.e1, { summary: { ok: false } }) } }) });
  g.api.render(); g.api.edgeGenerate('upcoming-12169478');
  for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r));
  const t = text(g.api.render());
  assert.match(t, /Generate Stennisfy Analysis Couldn’t generate the analysis\. Try again\./, 'a failed generate keeps the section');
  const r = boot({ e, analysisOn: true });
  r.ctx.fetch = g.ctx.fetch;
  r.api.render(); r.api.edgeGenerate('upcoming-12169478');
  for (let i = 0; i < 4; i++) await new Promise(z => setImmediate(z));
  assert.match(text(r.api.render()), /Players One 1\.53\./, 'Regenerate keeps the analysis when the newer run has none');
});

test('no model price (R1 fix 14): header + Market context book rows, no Model base, one grey line; never an Elo-only price', () => {
  const { api, els } = boot();
  const t = text(api.render('upcoming-12169534'));
  assert.match(t, /Market context · match winner/);
  assert.match(t, /No model price for this match yet\.$/);
  assert.ok(!/Model base|Fair price|Value layers|Biggest movers|edge = model/.test(t));
  assert.match(text(els.edgeHeadStats.innerHTML), /Layers active — Updated —/);
});

test('data: no sample data, no page sidebar, no Market Signal block; colour: links --link only, names white, amber only on quality', () => {
  assert.ok(!/sample data/i.test(PAGE + BLOCK + CSS), 'no "sample data" note');
  assert.ok(!/edge-subtab|Back to dashboard|Player ratings/.test(PAGE + BLOCK), 'the page owns no navigation of its own');
  assert.ok(!/buildMarketSignalBlock|Market Signal/.test(BLOCK));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS.replace(/'\\25BE'/g, '')), 'no raw colours');
  assert.match(CSS, /\.em-plink\{ color:var\(--text\); text-decoration:none; cursor:pointer; \}/);
  assert.match(CSS, /\.em-link\{ color:var\(--link\);/);
  assert.equal((CSS.match(/var\(--link\)/g) || []).length, 1, '--link on .em-link only');
  assert.equal((CSS.match(/var\(--amber\)/g) || []).length, 2, 'amber = the quality strip / dot and the quality label only');
  assert.ok(!/outline:[^;]*var\(--bar\)|box-shadow:[^;]*var\(--bar\)|border[^;]*var\(--bar\)/.test(CSS), 'no blue rings or outlines');
  assert.match(CSS, /\.em-odd:focus, \.em-odd:focus-visible\{ border-color:var\(--edge-16\); outline:none; box-shadow:none; \}/);
});

test('the analysis generator reads the page’s own rules, character for character', () => {
  const src = readFileSync(join(HERE, 'h2h-model/summary.js'), 'utf8');
  const a = src.indexOf('// >>> page rules'), b = src.indexOf('// <<< page rules');
  const copy = src.slice(src.indexOf('\n', a) + 1, b);
  for (const name of ['edgeQuote', 'edgeBookName', 'edgeSharp', 'edgeSoftBooks', 'edgeBestSoft', 'edgeNoVig', 'edgeGapOf', 'edgeWeightTag', 'edgeCovState', 'edgeEven', 'edgeFigures', 'edgeNotThisFormat', 'edgeQuality', 'edgeVisibleAdjs', 'edgeLayerName', 'edgeSigned', 'edgeCourt', 'edgeEventPart', 'edgeWhyText', 'mxBookLabel'])
    assert.ok(copy.includes(fn(name)), `${name}: summary.js copy differs from the page`);
  for (const c of ['MX_BOOK_LABELS']) assert.ok(copy.includes(block(c)), c);
  for (const line of ["const EDGE_SHARP = [['Pncl', 'Pinnacle'], ['bet365', 'Bet365']];", "const EDGE_LAYER_NAMES = { subjective: 'Manual context' };"]) {
    assert.ok(html.includes(line), 'page: ' + line); assert.ok(copy.includes(line), 'summary.js: ' + line);
  }
  const require = createRequire(import.meta.url);
  assert.equal(require('./h2h-model/config.js').summary.enabled, false, 'founder 2026-10-10: Stennisfy Analysis is off (no Claude calls)');
  const facts = require('./h2h-model/summary.js').buildFacts(FIX.e1, FIX.m1);
  assert.deepEqual(facts.market.bestSoft, { 'L. Darderi': { book: 'Bet365', price: 3, gapPP: -3.1 }, 'S. Tsitsipas': { book: 'Betano', price: 1.44, gapPP: 0.4 } });
  assert.deepEqual(facts.market.sharpNowGapPP, { 'L. Darderi': -2.8, 'S. Tsitsipas': -0.1 }, 'the page’s own gaps, not the model’s guess');
  const pipe = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');
  assert.match(pipe, /\} else if \(priorSum && priorSum\.ok\) \{\n[^}]*entry\.summary = Object\.assign\(\{\}, priorSum, \{ lastError: s\.reason \}\);/, 'a failed regeneration keeps the last good analysis');
  assert.equal(facts.market.sharpBook, 'Pinnacle');
  assert.deepEqual(facts.biggestMovers.map(x => x.shiftPP), [1.4, 1.3, 1.1]);
  assert.equal(facts.match.round, 'Round of 64');
  assert.ok(!JSON.stringify(facts).includes('Shanghai'), 'no event name for the model to repeat');
  assert.equal(facts.layersShown, 14, 'the analysis counts the same 14 layers');
  assert.match(pipe, /analysisOn: !!require\('\.\/h2h-model\/config'\)\.summary\.enabled,/, 'the one switch reaches the page');
  assert.match(pipe, /update\(JSON\.stringify\(\[m\.id, fr\.p1 && fr\.p1\.odds, fr\.p2 && fr\.p2\.odds\]\)\)/, 'cached per match until the shown fair price changes');
});
