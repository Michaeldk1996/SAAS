// Stennisfy Model page — handoff design_handoff_stennisfy_model (founder brief 2026-11-16, pixel for pixel; first built
// TEN-418 step 12, founder 2026-10-10). The SHIPPED Model renderer (the block from
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
const CSS = (() => { const a = html.indexOf('/* ── Stennisfy Model page — handoff'); return html.slice(a, html.indexOf('</style>', a)); })();
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
const HELPERS = [block('MX_BOOK_LABELS'), fn('mxBookLabel'), fn('mxOddsTxt'), fn('mxMovePct'), fn('playerInitials'), fn('newsTz'), fn('newsPlayerName'), fn('mxIsQual'), fn('mxRoundLabel')].join('\n');
const NOW = Date.parse('2026-10-10T05:00:00Z');   // 3.5 h before the 08:30Z start: inside the 30 h display window

function boot(opts = {}) {
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', textContent: '', className: '' });
  ['edgeBody', 'edgeHeadQ', 'edgeRail'].forEach(el);
  const navBtn = { matches: sel => sel === '.is-locked' && !!opts.free };
  const calls = { scrollBy: [], scrollIntoView: 0, dd: null, profile: [], b105: {}, pairFor: [] };
  const rowEl = { getBoundingClientRect: () => ({ top: 1400, height: 40 }), parentElement: null, classList: { remove() {} }, scrollIntoView() { calls.scrollIntoView++; } };
  const document = {
    getElementById: id => id.startsWith('emB105-') ? (calls.b105[id] = calls.b105[id] || { id, outerHTML: '' }) : (id.startsWith('emLayer-') ? (els.edgeBody.innerHTML.includes(`id="${id}"`) ? rowEl : null) : (els[id] || null)),
    querySelector: sel => (sel === '.sf-nav [data-tab="edge"]' ? navBtn : null),
    querySelectorAll: () => [], addEventListener() {}, body: { appendChild() {} }, createElement: () => ({ addEventListener() {}, setAttribute() {}, style: {} }),
  };
  const M = JSON.parse(JSON.stringify(opts.m || FIX.m1)), M2 = JSON.parse(JSON.stringify(FIX.m2));
  M.p1 = 'Darderi L.';   // a vendor spelling: the page must print the profile's (shared formatter), never the feed's
  const E = JSON.parse(JSON.stringify(opts.e || FIX.e1));
  const board = FIX.board.map(id => (id === M.id ? M : id === M2.id ? M2 : { id, p1: 'X. A' + id.slice(-2), p2: 'Y. B' + id.slice(-2), p1Key: null, p2Key: null, tour: 'ATP Shanghai', tournamentRound: 'ATP Shanghai - 1/32-finals', date: '2026-10-10', time: '10:30' }));
  const ctx = {
    document, window: { innerHeight: 982, scrollTo() {}, scrollBy: o => calls.scrollBy.push(o),
      KiblNow: opts.kibl === undefined ? undefined : { enabled: true, pairFor: (m, book) => { calls.pairFor.push([m && m.id, book]); return typeof opts.kibl === 'function' ? opts.kibl(m) : opts.kibl; } } },
    localStorage: { getItem: k => (k === 'stennisfy.tz' ? 'UTC' : null) },
    getComputedStyle: () => ({ overflowY: 'visible' }), MutationObserver: undefined, console,
    setTimeout: () => 0, clearTimeout() {}, fetch: () => Promise.resolve({ ok: false }),
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    matches: opts.noBoard ? [] : board.concat([{ id: 'past-12160000', p1: 'Z. Done', p2: 'Z. Over', tour: 'ATP Shanghai', date: '2026-10-09', time: '10:00' }]), modelOutput: { generatedAt: FIX.generatedAt, matches: { [M.id]: E, [M2.id]: FIX.e2 }, analysisOn: opts.analysisOn === true }, modelOutputLoaded: true,
    state: opts.state, matchesLoadedOnce: opts.loadedOnce !== false, isFinishedMatch: m => /^past-/.test(m.id),
    getFiltered: () => (opts.filtered ? opts.filtered(ctx.state, ctx.matches) : board.slice()), playerProfiles: { 8781: { name: FIX.names.p1 }, 1906: { name: FIX.names.p2 } },
    ppStyleFor: (n, k) => (String(k) === '8781' ? { archetype_label: FIX.styles[0] } : String(k) === '1906' ? { archetype_label: FIX.styles[1] } : null),
    psArchFor: id => { if (!id) return null; let a = ctx.PS_ARCHETYPES.find(x => x.name === id); if (!a) { a = { name: id }; ctx.PS_ARCHETYPES.push(a); } return a; }, sfEventName: raw => (raw === 'ATP Shanghai' ? 'Shanghai Masters' : raw),
    PS_ARCHETYPES: [], PS_PAGE_MIN_N: 30, psMatrixData: { matrix: {} }, psCellFor: () => (opts.cell === undefined ? { pct: 38, n: 1259 } : opts.cell),
    roundBadgeText: r => (/1\/32-finals/.test(r || '') ? 'R64' : null), TR_RESULT: { R64: 'Round of 64' },
    sfDdRender: (id, cfg) => { calls.dd = cfg; }, cardStartMs: m => Date.parse(m.date + 'T08:30:00Z'), cardFmtStart: () => '08:30',
    matchDayBucket: () => 'today', aOddsStartMs: m => Date.parse(m.date + 'T08:30:00Z'), openPlayerProfileFromMatch: k => calls.profile.push(k),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const block = opts.staleMin != null ? BLOCK.replace('const EDGE_PIN_STALE_MIN = 120;', `const EDGE_PIN_STALE_MIN = ${opts.staleMin};`) : BLOCK;
  vm.runInContext(HELPERS + '\n' + block + '\nthis.API = { renderEdgeModel, openEdgeModel, edgeOddInput, edgeJumpLayer, edgeSharp, edgeBestSoft, edgeLayerRows, edgeParseOdd, edgeWhyText, edgeToggleLayers, edgeToggleLayer, edgeGenerate, edgeAiState, edgeB105Line, edgeB105Paint, openEdgeModelTab, edgeShowAllUpcoming, edgeVerdicts, edgeLayerView, edgeRailToggle, edgeRailSetTour, edgeB105PopHtml, get scopeAll(){ return edgeScopeAll; }, get open(){ return [edgeLayersOpen, edgeLayerOpen]; } };', ctx);
  const api = ctx.API;
  api.render = (id = M.id) => { api.openEdgeModel(id); return els.edgeBody.innerHTML; };
  return { api, els, calls, M, E, ctx };
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\u2011/g, '-').replace(/\s+/g, ' ').trim();


// ── page head + rail ──────────────────────────────────────────────────────
test('page head: the reference head (title, one line, "?"); the "?" names the layer count; no stat header, no Updated (founder 2026-11-16)', () => {
  const { api, els } = boot();
  api.render();
  assert.match(PAGE, /<h1 class="sm-title">Stennisfy Model<\/h1>\s*<p class="sm-sub">Our fair price for every match, set against the market\.<\/p>/);
  assert.match(els.edgeHeadQ.title, /then folds in 14 value layers\. The adjusted fair price is compared with Pinnacle and the best soft book\.$/);
  assert.ok(!/Model run|Updated/.test(els.edgeHeadQ.title + PAGE), 'no Updated on this page');
  assert.ok(!/class="sfh/.test(PAGE), 'no shared stat header on this page (the reference draws none)');
});
test('rail: Today’s Matches list in board order, the canonical event as group head with "surface · count", shared names, round · day time, one dropdown', () => {
  const { api, els } = boot();
  api.render();
  const h = els.edgeRail.innerHTML;
  assert.match(text(h), /^Matches 12 matches All tournaments › Shanghai Masters 12 X\. A87/, 'group meta = the first row’s surface (none on this synthetic row) · count');
  const rows = [...h.matchAll(/onclick="edgeRailPick\('([^']+)'\)"/g)].map(x => x[1]);
  assert.deepEqual(rows, FIX.board, 'every board match, in board order');
  assert.match(h, /<div class="sm-mrow sm-seg on"[^>]*onclick="edgeRailPick\('upcoming-12169478'\)"[\s\S]*?L\. Darderi <span class="v">v<\/span> S\. Tsitsipas<\/span>\s*<span class="sm-mrow-m">R64 · Today <span class="sm-mono">08:30<\/span>/);
  assert.ok(!/sm-dd-m/.test(h), 'the dropdown opens on demand');
  api.edgeRailToggle();
  assert.equal(text(els.edgeRail.innerHTML.match(/<span class="sm-dd-m"[\s\S]*?<\/span><\/span><\/span>/)[0]), 'All tournaments 12 Shanghai Masters 12');
  api.edgeRailSetTour('ATP Shanghai');
  assert.match(text(els.edgeRail.innerHTML), /^Matches 12 of 12 matches Shanghai Masters ›/);
  assert.ok(!/sm-dd-m/.test(els.edgeRail.innerHTML), 'a pick closes the menu');
  assert.ok(!/search|Reset|Today Tomorrow/i.test(text(els.edgeRail.innerHTML).replace(/Today \d\d:\d\d/g, '')), 'no search, day switch or Reset (dead code in the reference)');
});

// ── match header ──────────────────────────────────────────────────────────
test('match header: avatars, shared names, step-9 style + Elo, the four pills, Head to Head with the pair', () => {
  const { api } = boot();
  const h = api.render();
  assert.match(text(h), /^LD L\. Darderi Attacking Baseliner Elo 1830 vs S\. Tsitsipas Big Server \+ Complete Baseliner Elo 1884 ST Tournament Shanghai Masters Surface Hard Round Round of 64 Format Best of 3 Head to Head ›/);
  assert.match(h, /<span class="sm-av em-av s48 a">/, 'player one: the 48px avatar, blue ring');
  assert.match(h, /href="\?a=8781&amp;b=1906" onclick="edgeGoH2H\(event,'8781','1906'\)">Head to Head/);
  assert.match(html, /sessionStorage\.setItem\('stn_h2h_pair', JSON\.stringify\(\{ a, b \}\)\)/);
  assert.ok(!/text-overflow:ellipsis/.test(CSS.slice(CSS.indexOf('.sm-mh-nm'), CSS.indexOf('.sm-mh-sub'))), 'names wrap, never an ellipsis');
});

// ── market context ────────────────────────────────────────────────────────
test('market context: Pinnacle else Bet365, best soft never Pinnacle or an exchange; edges = base − the book’s no-vig; four rows', () => {
  const { api, M } = boot();
  const t = text(api.render());
  assert.equal(api.edgeSharp(M).name, 'Pinnacle');
  assert.equal(api.edgeBestSoft(M, 'p1').key, 'bet365', 'Pinnacle 3.01 is the highest quote on Darderi, but it is not a soft book');
  const noPin = JSON.parse(JSON.stringify(M)); delete noPin.bookNow.Pncl; delete noPin.bookOpens.Pncl;
  assert.equal(api.edgeSharp(noPin).name, 'Bet365', 'no Pinnacle → Bet365');
  assert.ok(api.edgeBestSoft(noPin, 'p1').key !== 'bet365', 'the sharp tile’s book is not also the best soft');
  const pulled = JSON.parse(JSON.stringify(M)); delete pulled.bookNow.Pncl;
  assert.equal(api.edgeSharp(pulled).name, 'Bet365', 'Pinnacle with no price now falls to Bet365');
  const ex = JSON.parse(JSON.stringify(M)); ex.bookNow['Betfair Exchange'] = { p1: 9.5, p2: 9.5 };
  assert.equal(api.edgeBestSoft(ex, 'p1').key, 'bet365', 'an exchange never counts as a soft book (R2 fix 4)');
  assert.match(t, /LD L\. Darderi 2\.90 Model base 34\.5% · 65\.5% ST S\. Tsitsipas 1\.53 Edge Odds Book Odds Edge \+2\.7pp 3\.00 Soft open Bet365 \/ Betano · margin 4\.8% \/ 4\.9% 1\.42 −1\.6pp \+2\.7pp 3\.00 Soft now margin 4\.8% \/ 4\.5% 1\.44 −0\.9pp \+1\.6pp 2\.94 Pinnacle open 8 Oct · 11:22 · margin 3\.5% 1\.44 −1\.6pp \+2\.4pp 3\.03 Pinnacle now L\. Darderi −0\.8pp since open · margin 2\.9% 1\.43 −2\.4pp Soft book Bet365 \/ Betano · market opened 8 Oct · 11:22/);
  api.edgeSetMkView && api.edgeSetMkView('pct');
});
test('market context: Implied % shows the no-vig % and the model base as %, the odds under "Model base"', () => {
  const b = boot(); b.api.render(); b.ctx.edgeMkView = 'pct';
  vm.runInContext("edgeMkView = 'pct'", b.ctx);
  const t = text(b.api.render());
  assert.match(t, /L\. Darderi 34\.5% Model base 2\.90 · 1\.53 ST S\. Tsitsipas 65\.5% Edge Implied Book Implied Edge \+2\.7pp 31\.8% Soft open/);
  assert.ok(!/NaN/.test(t));
  vm.runInContext("edgeMkView = 'odds'", b.ctx);
});
test('market context: the anchor read time is in the "?" (Pinnacle from api-tennis, the pipeline read)', () => {
  const h = boot().api.render();
  assert.match(h, /The model anchors to Pinnacle’s quote from api-tennis, read 10 Oct, 04:49:51\./);
  const noPin = JSON.parse(JSON.stringify(FIX.m1)); delete noPin.bookNow.Pncl;
  assert.doesNotMatch(boot({ m: noPin }).api.render(), /anchors to Pinnacle’s quote/);
});

// ── fair price & value ────────────────────────────────────────────────────
test('fair price: the model’s fair odd and %, gaps from the fair % as printed (R1 fix 6), Pinnacle open in the sub line', () => {
  const t = text(boot().api.render());
  assert.match(t, /LD L\. Darderi No value 3\.31 Adjusted fair 30\.2% 69\.8% ST S\. Tsitsipas No value 1\.43 Gap Odds Book Odds Gap −3\.1pp Best soft Bet365 \/ Betano \+0\.4pp −2\.8pp Pinnacle open 2\.94 · 1\.44 −0\.1pp/);
});
test('fair price: editing an odd re-computes its own gap in place; empty, ≤ 1.00 and non-numbers read —, never NaN', () => {
  const { api, els } = boot();
  api.render();
  const gap = { textContent: '', className: '' };
  els['emGap-soft-p1'] = gap;
  for (const [v, want, cls] of [['3.40', '+0.8pp', 'pos'], ['3,00', '−3.1pp', 'neg'], ['', '—', ''], ['1.00', '—', ''], ['0.9', '—', ''], ['abc', '—', ''], ['2.5x', '—', '']]) {
    api.edgeOddInput({ value: v }, 'upcoming-12169478', 'soft', 'p1');
    assert.equal(gap.textContent, want, `typed "${v}"`);
    assert.equal(gap.className, 'sm-ep ' + cls);
  }
  assert.ok(!/NaN/.test(api.render()), 'no NaN after a bad edit');
  assert.match(api.render(), /value="2\.5x"/, 'the typed text survives a re-render');
});
test('verdicts: the model’s own flags (live thresholds), one per side; a typed odd never moves them', () => {
  const { api, E } = boot();
  const f = e => JSON.parse(JSON.stringify(api.edgeVerdicts(e)));
  const no = f(E), ed = s => Math.max(...[E.stage3.sharp && E.stage3.sharp.edge && E.stage3.sharp.edge[s], E.stage3.soft && E.stage3.soft.edge && E.stage3.soft.edge[s]].filter(x => x != null), -Infinity);
  const dec = ed('p1') >= ed('p2') ? 'p1' : 'p2';
  assert.equal(no[dec].c, 'neg', 'no flag: red "No value" on the side with the larger edge');
  assert.equal(no[dec === 'p1' ? 'p2' : 'p1'].c, '', 'grey on the other');
  const sharp = JSON.parse(JSON.stringify(E)); sharp.stage3.flags = [{ type: 'Sharp Value', side: 'p2' }, { type: 'Soft Book Value', side: 'p2' }];
  assert.deepEqual(f(sharp), { p1: { t: 'Market side', c: '' }, p2: { t: 'Sharp value', c: 'pos' } });
  const soft = JSON.parse(JSON.stringify(E)); soft.stage3.flags = [{ type: 'Soft Book Value', side: 'p1' }];
  assert.deepEqual(f(soft), { p1: { t: 'Soft book value', c: 'pos' }, p2: { t: 'Market side', c: '' } });
  const b = boot({ e: sharp }); b.api.render();
  b.api.edgeOddInput({ value: '9.99' }, 'upcoming-12169478', 'pin', 'p1');
  assert.match(text(b.api.render()), /S\. Tsitsipas Sharp value/, 'typed odds change gaps only');
  assert.ok(!/stage3\.flags\s*=|flags\.push/.test(BLOCK), 'the page never writes a flag');
});
test('fair price: no step line between base and adjusted fair (founder 2026-11-16: follow the design)', () => {
  assert.ok(!/edgeFairStepTip|calibration \(temperature/.test(BLOCK));
});

// ── value layers ──────────────────────────────────────────────────────────
test('value layers: 14 rows by weight then shift; strip by quality (gated / not this format = Not applicable); legend counts; active = applied', () => {
  const { api, calls } = boot();
  const rows = JSON.parse(JSON.stringify(api.edgeLayerRows(boot().E).map(r => [r.a.key, r.w.word, r.q])));
  assert.deepEqual(rows.slice(0, 4), [['styleMatchup', 'Highest', 'Poor'], ['subjective', 'Highest', 'Poor'], ['surface', 'High', 'Good'], ['clutch', 'Medium-high', 'Medium']]);
  assert.equal(rows.length, 14, 'every engine layer is a row, the format split included (R1 fix 1)');
  let h = api.render();
  assert.match(text(h), /Value layers Data quality behind each adjustment folded into the price 9 of 14 layers active \?/);
  assert.equal((h.match(/class="sm-sg q-/g) || []).length, 14, 'the strip has 14 segments');
  assert.match(text(h), /6 good data 3 medium 3 poor 2 not applicable Show all 14 layers ▾/);
  assert.match(h, /Weather \/ conditions · Not applicable · switched off<\/i>/);
  assert.ok(!/class="sm-lr/.test(h), 'the breakdown opens on demand');
  api.edgeJumpLayer('surface');
  h = api.render();
  assert.equal(JSON.stringify(api.open), JSON.stringify([true, 'surface']));
  assert.equal(calls.scrollIntoView, 0); assert.equal(calls.scrollBy.length, 1);
  assert.match(text(h), /Hide the layer breakdown ▾ LD L\. Darderi 2 layers in his favour \+1\.3pp Net adjustment \+4\.3pp toward S\. Tsitsipas ST S\. Tsitsipas 7 layers in his favour \+5\.6pp Shift Rating Layer Rating Shift/);
  assert.match(text(h), /44% Surface record High weight · good data 63% \+1\.0pp › Why High weight Favours S\. Tsitsipas Hard-court record 44% vs 63% over career and the last 52 weeks, each against their own career baseline\. Data quality Good The inputs behind this layer are complete for both players in this match\./);
  assert.match(h, /id="emLayer-surface"/);
});
test('value layers: the players’ real figures, the one it favours white, the shift pill on that side only; level under 0.05pp', () => {
  const { api } = boot();
  api.edgeToggleLayers(); const h = api.render();
  for (const [k, a, b] of [['clutch', '29', '74'], ['serve', '258.0', '303.5'], ['winnerUE', '0.89', '1.05'], ['fatigue', '4.0', '8.0'], ['qualityForm', '−22.0pp', '−8.0pp'], ['h2h', '0', '1']]) {
    const row = h.match(new RegExp(`id="emLayer-${k}"[\\s\\S]*?<span class="sm-chev">`))[0];
    const r = [...row.matchAll(/<span class="sm-rt([^"]*)">([^<]*)<\/span>/g)].map(x => [x[1].trim(), x[2]]);
    assert.deepEqual(r.map(x => x[1]), [a, b], k + ' figures');
    const sp = [...row.matchAll(/<span class="sm-sp( on)?">([^<]*)<\/span>/g)].map(x => x[2]);
    assert.equal(sp.filter(Boolean).length, 1, k + ': one shift pill, on the helped side');
    const leadSide = sp[0] ? 0 : 1;
    assert.equal(r[leadSide][0], 'lead', k + ': the favoured figure is white 700'); assert.equal(r[1 - leadSide][0], '', k + ': the other soft');
  }
  assert.match(html, /^const EDGE_LEVEL_PP = 0\.05;/m, 'the level threshold is one named constant');
  const ev = JSON.parse(JSON.stringify(FIX.e1)); const fa = ev.stage2.adjustments.find(x => x.key === 'fatigue');
  Object.assign(fa, { applied: true, deltaP1: 0.0004, direction: 'p1', confidence: 'med' });
  const lv = boot({ e: ev }); lv.api.edgeToggleLayers();
  const row = lv.api.render().match(/id="emLayer-fatigue"[\s\S]*?<span class="sm-chev">/)[0];
  assert.match(text(row), /Medium-high weight · good data · level/, '0.04pp counts as level');
  assert.ok(!/sm-sp on/.test(row), 'no pill on a level layer');
});
test('value layers: inactive and not-applicable rows: dashes, no pill, the reason in the sub line; Why / Data quality are the live texts', () => {
  const { api } = boot();
  api.edgeToggleLayer('formatSplit'); api.edgeToggleLayers();
  let t = text(api.render());
  assert.match(t, /— Format split \(Bo5\) Not applicable · best of 3 — › Why Medium-high weight Not applicable Best of 3 ?: this layer applies to best-of-five only\. Data quality Not applicable The layer does not apply to a best-of-three match\./);
  api.edgeToggleLayer('weather');
  assert.match(text(api.render()), /Weather \/ conditions Not applicable · switched off — › Why Medium-high weight Not applicable Switched off for every match until the match-time fix and an indoor check are both in\. Data quality Not applicable The layer is switched off by a model rule for every match, not by missing data\./);
  api.edgeToggleLayer('subjective');
  assert.match(text(api.render()), /— Manual context Highest weight · no analyst note — › Why Highest weight No data No analyst note is attached to this match, so the layer stays neutral\./, 'one name: Manual context');
  api.edgeToggleLayer('styleMatchup');
  assert.match(text(api.render()), /Style matchup Highest weight · no data — › Why Highest weight No data On the Playing Styles grid, Attacking Baseliners win 38% of 1,259 matches against Big Server \+ Complete Baseliners\. The model doesn’t read playing styles yet, so this layer doesn’t move the price\. Data quality Poor The model doesn’t read playing styles yet\./);
  api.edgeToggleLayer('qualityForm');
  assert.match(text(api.render()), /Why Medium-high weight Favours S\. Tsitsipas Win rate against top-50 opponents minus the player’s overall win rate, in percentage points \(recent matches weigh more\): L\. Darderi −22\.0pp over \d+ top-50 matches, S\. Tsitsipas −8\.0pp over \d+\. On hard courts, top-50 win rate there minus top-50 win rate overall: L\. Darderi −8\.3pp over 21 matches, S\. Tsitsipas −1\.7pp over 228\./, 'the number says what it is, who is who, true minus (R2 fix 3, R3 fix 3)');
  const all = api.render();
  assert.ok(!/career\+52wk|recency-wtd|Nₑₓ|rel-to-archetype/.test(all), 'no engine shorthand on the page');
  assert.ok(!/TEN-\d/.test(text(all)), 'no ticket numbers on the page (R3 fix 1)');
  assert.ok(!/Gated|17 layers|Home \/ Away/.test(text(all)), 'never "Gated", "17 layers", "Home / Away"');
  const fl = { key: 'qualityForm', applied: true, detail: 'Career top50 dev -2.1pp(133m) vs -4.0pp(40m); Hard top50 dev -2.1pp(133m) vs +0.0pp(5m).' };
  assert.match(api.edgeWhyText(fl, { p1: 'A. One', p2: 'B. Two' }), /A\. One −2\.1pp over 133 matches, B\. Two under 10 top-50 matches there \(not counted\)\./, 'a court figure under the engine floor is not shown as measured (review)');
  const ev = JSON.parse(JSON.stringify(FIX.e1)); const fa = ev.stage2.adjustments.find(x => x.key === 'fatigue');
  Object.assign(fa, { applied: false, confidence: 'none', direction: 'neutral', signal: 0, deltaP1: 0, detail: '10d load even on Hard: 6s/3m=6.0u vs 7s/3m=7.0u (gap -1.0u < 2).' });
  const evb = boot({ e: ev }); evb.api.render(); evb.api.edgeJumpLayer('fatigue');
  assert.match(text(evb.api.render()), /6\.0 Fatigue \(recent load\) Medium-high weight · good data · level 7\.0 › Why Medium-high weight Even Match load over the last 10 days: L\. Darderi 6 sets in 3 matches \(6\.0 units\), S\. Tsitsipas 7 sets in 3 matches \(7\.0 units\)\. The loads are too close for the layer to move the price\. Data quality Good/);
  const thin = boot({ cell: { pct: null, n: 12 } }); thin.api.render(); thin.api.edgeJumpLayer('styleMatchup');
  assert.match(text(thin.api.render()), /Attacking Baseliner v Big Server \+ Complete Baseliner: 12 matches, under 30\./, 'the pair cell under 30, with its count');
});
test('sub lines break only after a separator: no plain space or hyphen inside a part', () => {
  const { api } = boot(); api.edgeToggleLayers();
  const subs = [...api.render().matchAll(/<span class="sm-ln-s"><span[^>]*><\/span>([^<]*)<\/span>/g)].map(x => x[1]);
  assert.equal(subs.length, 14);
  for (const s of subs) for (const part of s.split('\u00a0· ')) assert.ok(!/[ -]/.test(part), JSON.stringify(part));
});

// ── biggest movers ────────────────────────────────────────────────────────
test('biggest movers: the three largest moves, share = their shifts over every moved layer’s, a row opens its layer', () => {
  const { api } = boot();
  const t = text(api.render());
  assert.match(t, /Biggest movers The three layers that moved the price most · Hard 55% of the total shift \? Layer Favours Shift 1 Under pressure Medium-high weight · 29 v 74 ST S\. Tsitsipas \+1\.4pp › 2 Serve strength Medium-high weight · 258\.0 v 303\.5 ST S\. Tsitsipas \+1\.3pp › 3 Winner \/ unforced-error ratio Medium weight · 0\.89 v 1\.05 ST S\. Tsitsipas \+1\.1pp ›$/);
  const moved = boot().E.stage2.adjustments.filter(a => a.applied && Math.abs(a.deltaP1) * 100 >= 0.05).map(a => Math.abs(a.deltaP1));
  const top = moved.slice().sort((a, b) => b - a).slice(0, 3);
  assert.equal(Math.round(top.reduce((s, x) => s + x, 0) / moved.reduce((s, x) => s + x, 0) * 100), 55, 'the share recomputed from the run');
  assert.match(api.render(), /onclick="edgeJumpLayer\('clutch'\)"/);
  assert.ok(!/Upgrade to Pro/.test(boot({ free: true }).api.render()), 'no Upgrade to Pro on the page (removed by the client)');
});

// ── Bet105 ────────────────────────────────────────────────────────────────
var B105 = (p1, p2, live = true) => ({ p1, p2, book: 'bet105', live, sideAt: { p1: '2026-10-10T04:58:10.000Z', p2: '2026-10-10T04:57:40.000Z' } });
test('Bet105 line: the derivation — prices ÷ 0.9956, no-vig = the pair’s own, the older side’s time, both legs or nothing', () => {
  const { api, M } = boot({ kibl: B105(3.0, 1.42) });
  const bl = api.edgeB105Line(M);
  assert.deepEqual([+(bl.p1).toFixed(4), +(bl.p2).toFixed(4)], [+(3.0 / 0.9956).toFixed(4), +(1.42 / 0.9956).toFixed(4)]);
  const nv = (1 / 3.0) / (1 / 3.0 + 1 / 1.42);
  assert.ok(Math.abs(bl.nv.p1 - nv) < 1e-12 && Math.abs(bl.nv.p1 + bl.nv.p2 - 1) < 1e-12);
  assert.equal(bl.at, '2026-10-10T04:57:40.000Z', 'the Kibl time of the OLDER side');
  assert.equal(boot({ kibl: { p1: 3.0, p2: null, book: 'bet105', live: true } }).api.edgeB105Line(M), null, 'one leg = no line');
  assert.equal(boot({ kibl: null }).api.edgeB105Line(M), null, 'no pair = no line');
  assert.equal(boot().api.edgeB105Line(M), null, 'no stream on the page = no line');
  const started = JSON.parse(JSON.stringify(M)); started.date = '2026-10-09';
  const s = boot({ kibl: B105(3.0, 1.42) });
  assert.equal(s.api.edgeB105Line(started), null, 'a started match has no line');
  const live = JSON.parse(JSON.stringify(M)); live.live = true;
  assert.equal(s.api.edgeB105Line(live), null, 'a live match has no line');
  s.api.edgeB105Line(M);
  assert.ok(s.calls.pairFor.length > 0 && s.calls.pairFor.every(([, b]) => b === 'bet105'), 'asks the stream for Bet105 only');
});
test('Bet105 row: the margin-removed price, read only; gap = the fair % as printed − the line’s no-vig; stale = dashes', () => {
  const { api, E } = boot({ kibl: B105(3.0, 1.42) });
  const h = api.render();
  const row = h.match(/<div class="sm-row"><span><\/span><span class="sm-ep[^"]*" id="emB105-g-p1">[\s\S]*?<span><\/span><\/div>/)[0];
  const nv = (1 / 3.0) / (1 / 3.0 + 1 / 1.42), g = Math.round(E.stage3.fair.p1.prob * 1000) / 10 - nv * 100;
  assert.match(text(row), new RegExp('^' + (g < 0 ? '−' : '\\+') + Math.abs(g).toFixed(1) + 'pp 3\\.01 Bet105 margin removed 1\\.43 '), text(row));
  assert.ok(!/<input/.test(row), 'Bet105 is not editable');
  assert.match(row, /title="bet105’s price with its fixed 0\.44% margin removed/);
  const st = text(boot({ kibl: B105(3.0, 1.42, false) }).api.render().match(/<span class="sm-ep[^"]*" id="emB105-g-p1">[\s\S]*?<span><\/span><\/div>/)[0]);
  assert.match(st, /^— — Bet105 margin removed — —$/, 'a stale stream is a dash everywhere');
  const mk = h.slice(h.indexOf('sm-card sm-mk'), h.indexOf('sm-card sm-vl'));
  assert.ok(mk.length > 100 && !/bet105/i.test(mk), 'no Bet105 row in Market context (the handoff: four rows)');
});
test('Bet105 row: a stream change repaints the two cells and gaps in place; the fair price never moves', () => {
  let pair = B105(3.0, 1.42);
  const { api, els, calls } = boot({ kibl: () => pair });
  api.render();
  const cells = calls.b105;
  const fairBefore = text(els.edgeBody.innerHTML).match(/Adjusted fair [0-9.]+% [0-9.]+%/)[0];
  pair = B105(3.2, 1.36);
  els.edgeBody.innerHTML += '<!--sentinel-->';
  api.edgeB105Paint();
  assert.match(els.edgeBody.innerHTML, /<!--sentinel-->$/, 'the body is not re-rendered (an odd being typed survives)');
  assert.equal(cells['emB105-v-p1'].textContent, '3.21'); assert.equal(cells['emB105-v-p2'].textContent, '1.37');
  assert.equal(text(els.edgeBody.innerHTML).match(/Adjusted fair [0-9.]+% [0-9.]+%/)[0], fairBefore);
  pair = null; api.edgeB105Paint();
  assert.equal(cells['emB105-v-p1'].textContent, '—', 'the pair gone: a dash');
});
test('Bet105 pop-up: the Today’s Matches data path on margin-removed prices; ledger newest first, deltas from the row before', () => {
  const { api } = boot();
  const rows = [{ at: Date.parse('2026-10-09T10:00:00Z'), price: 3.0 }, { at: Date.parse('2026-10-09T12:00:00Z'), price: 3.1 }, { at: Date.parse('2026-10-10T01:00:00Z'), price: 3.05 }];
  vm.runInContext("window.PriceHistoryBox = { fmtWhen: t => new Date(t).toISOString().slice(5,16), fmtDelta: d => (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(3) }", api.__ctx || boot().ctx);
  const h = api.edgeB105PopHtml('L. Darderi', rows, 3.05, null);
  assert.match(text(h), /^Odds movement Bet105 · margin removed L\. Darderi 3\.00 → 3\.05 \+1\.7% 2 moves /);
  assert.match(text(api.edgeB105PopHtml('L. Darderi', [], null, 'Price history unavailable')), /— → — Price history unavailable$/);
  assert.match(BLOCK, /rows = raw\.filter\(r => r\.price >= 1\.01\)\.map\(r => \(\{ at: r\.at, price: r\.price \/ EDGE_B105_K \}\)\);/, 'the ledger is the margin-removed price');
  assert.match(BLOCK, /PH\.changesOnly\(PH\.sideRows\(payload, ocsNameKey\(m\[s\]\), ocsNameKey\)\.filter\(r => !isFinite\(st\) \|\| r\.at <= st\)\)/, 'the shared rows, cut at the start');
  assert.match(BLOCK, /const up = r\.bottom \+ 400 > vh && r\.top > 400;/, 'above the odd when within 400px of the bottom');
  assert.match(BLOCK, /edgePopTimer = setTimeout\(edgeB105Hide, 160\)/, '160 ms leave delay');
});
test('Bet105 line: isolation — the derived price lives on the Model page only', () => {
  const { execFileSync } = createRequire(import.meta.url)('child_process');
  const files = execFileSync('git', ['ls-files'], { cwd: HERE, encoding: 'utf8' }).split('\n')
    .filter(f => /\.(js|mjs|py|html|sql|yml)$/.test(f) && !/^(test-|tools\/test-|tools\/fixtures\/|design|\.ten)/.test(f) && f !== 'bsp-consult-dashboard.html');
  const hits = files.filter(f => { try { return /EDGE_B105_K|bet105 \(margin removed\)|Pinnacle line \(from Bet105\)|0\.9956/.test(readFileSync(join(HERE, f), 'utf8')); } catch { return false; } });
  assert.deepEqual(hits, [], 'no other page, pipeline file or builder carries the derived line');
  assert.doesNotMatch(html.replace(BLOCK, ''), /EDGE_B105_K|edgeB105/, 'the dashboard uses it inside the Model block only');
});

// ── gates, empty states ───────────────────────────────────────────────────
test('no model price (R1 fix 14): header + Market context book rows, model base a dash, one line; never an Elo-only price', () => {
  const t = text(boot().api.render('upcoming-12169534'));
  assert.match(t, /Market context/);
  assert.match(t, /Y\. Bu — Model base — · — CR C\. Ruud —/, 'no model base price without a model');
  assert.match(t, /No model price for this match yet\.$/);
  assert.ok(!/Fair price|Value layers|Biggest movers/.test(t));
});
test('anchor stale gate: a Pinnacle read older than 120 min dashes the model price and says how old; the Bet105 line never stands in', () => {
  const old = JSON.parse(JSON.stringify(FIX.m1)); old.bookNow.Pncl.seenAt = '2026-10-10T01:50:00.000Z';
  const t = text(boot({ m: old, kibl: B105(3.0, 1.42) }).api.render());
  assert.match(t, /Pinnacle quote stale \(3h 10m\)\. No model price until the next read\.$/, t);
  assert.doesNotMatch(t, /Value layers|Adjusted fair/);
  const edge = (min) => { const x = JSON.parse(JSON.stringify(FIX.m1)); x.bookNow.Pncl.seenAt = new Date(NOW - min * 60000).toISOString(); return x; };
  assert.match(text(boot({ m: edge(120) }).api.render()), /Adjusted fair/, 'exactly 120 min: priced');
  assert.match(text(boot({ m: edge(121) }).api.render()), /Pinnacle quote stale \(2h 1m\)/, '121 min: dashed');
  assert.match(html, /^const EDGE_PIN_STALE_MIN = 120;/m);
});
test('display gate: a state-3 match is not priced', () => {
  const e = JSON.parse(JSON.stringify(FIX.e1)); e.stage1.baseState.state = 3;
  assert.match(text(boot({ e }).api.render()), /No model price for this match yet\.$/);
});
test('analysis: OFF = no section for anyone (the switch is model-output.json analysisOn)', () => {
  const e = JSON.parse(JSON.stringify(FIX.e1)); e.summary = { ok: true, text: 'One.\n\nTwo.', generatedAt: '2026-10-10T05:12:00Z' };
  for (const free of [false, true]) assert.ok(!/Stennisfy Analysis/.test(boot({ e, free }).api.render()));
  assert.match(boot({ analysisOn: true }).api.render(), /Generate Stennisfy Analysis/, 'the switch still works when turned on');
});
const boardPredicate = (st, all) => all.filter(m => {
  if (st.view === 'completed') return /^past-/.test(m.id);
  if (/^past-/.test(m.id)) return false;
  if (st.day !== 'today' && st.day !== 'all') return false;
  if (st.search && !m.p1.toLowerCase().includes(st.search.toLowerCase())) return false;
  return !st.tournaments.size || st.tournaments.has(m.tour);
});
test('empty view: the reason, the board count and the model run — never "no matches on the board" while fixtures exist', () => {
  const S = { day: 'tomorrow', view: 'upcoming', search: '', surface: 'all', tournaments: new Set() };
  const { api, els, ctx } = boot({ state: S, filtered: (s, all) => boardPredicate(s, all) });
  api.openEdgeModelTab();
  const t = text(els.edgeBody.innerHTML);
  assert.match(t, /This page follows the Today’s Matches view, which has no matches \(Upcoming · Tomorrow\)\. 12 upcoming matches are on the board\. Model last run 10 Oct · 04:51\. Show all upcoming matches/);
  assert.match(text(els.edgeRail.innerHTML), /No matches in this view\./);
  api.edgeShowAllUpcoming();
  assert.match(text(els.edgeRail.innerHTML), /^Matches 12 matches/);
  assert.deepEqual([ctx.state.day, ctx.state.view], ['tomorrow', 'upcoming'], 'Today’s Matches state restored');
  api.openEdgeModelTab(); assert.equal(api.scopeAll, false);
});
test('empty board: no upcoming match / not loaded yet / load failed each say so', () => {
  const S = () => ({ day: 'today', view: 'upcoming', search: '', surface: 'all', tournaments: new Set() });
  let b = boot({ state: S(), filtered: () => [], noBoard: true });
  b.api.openEdgeModelTab();
  assert.equal(text(b.els.edgeBody.innerHTML), 'No matches on the board right now. The Stennisfy Model prices each match as soon as the board has fixtures. Model last run 10 Oct · 04:51.');
  b = boot({ state: S(), filtered: () => [], noBoard: true, loadedOnce: false });
  b.api.openEdgeModelTab();
  assert.equal(text(b.els.edgeBody.innerHTML), 'Loading the match board…');
});

// ── look ──────────────────────────────────────────────────────────────────
test('look: the export’s colours as --sm-* tokens only; no sample data; player one blue ring, player two white; links blue', () => {
  assert.ok(!/sample data/i.test(PAGE + BLOCK + CSS), 'no "sample data" note');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(CSS), 'no raw colours in the page CSS');
  const tok = readFileSync(join(HERE, 'tokens.css'), 'utf8');
  for (const [k, v] of [['--sm-page', '#0D0E16'], ['--sm-card', '#0E1019'], ['--sm-inner', '#0C0E16'], ['--sm-raised', '#131623'], ['--sm-text', '#E7E9EE'], ['--sm-soft', '#C6CCDB'], ['--sm-body', '#C9CDD9'], ['--sm-muted', '#8B96B5'], ['--sm-blue', '#5B9BFF'], ['--sm-blue-hov', '#82B4FF'], ['--sm-pos', '#3DD68C'], ['--sm-neg', '#E0616F'], ['--sm-q-good', '#5CCB84'], ['--sm-q-med', '#E8A84E'], ['--sm-q-poor', '#E06266']])
    assert.match(tok, new RegExp(k + ':\\s+' + v + ';'), k);
  assert.match(CSS, /\.sm-av\.a\{ box-shadow:0 0 0 2px var\(--sm-blue\); \}/);
  assert.match(CSS, /\.sm-av\{[^}]*box-shadow:0 0 0 2px var\(--sm-text\);/);
  assert.match(CSS, /\.sm-plink\{ cursor:pointer; color:var\(--sm-text\) !important;/, 'names white, underline on hover');
  assert.match(CSS, /\.sm-odd:focus\{ border-color:var\(--sm-blue\) !important; \}/);
  assert.match(CSS, /\.sm-card\{ background:var\(--sm-card\); border:1\.25px solid color-mix\(in srgb, var\(--sm-white\) 6%, transparent\); border-radius:14px; padding:24px 26px;/);
  assert.match(CSS, /\.sm-rail\{ width:244px;/);
});
test('the analysis generator reads the page’s own rules, character for character', () => {
  const src = readFileSync(join(HERE, 'h2h-model/summary.js'), 'utf8');
  const a = src.indexOf('// >>> page rules'), b = src.indexOf('// <<< page rules');
  const copy = src.slice(src.indexOf('\n', a) + 1, b);
  for (const name of ['edgeQuote', 'edgeBookName', 'edgeSharp', 'edgeSoftBooks', 'edgeBestSoft', 'edgeNoVig', 'edgeGapOf', 'edgeWeightTag', 'edgeCovState', 'edgeEven', 'edgeFigures', 'edgeNotThisFormat', 'edgeQuality', 'edgeVisibleAdjs', 'edgeLayerName', 'edgeSigned', 'edgeCourt', 'edgeEventPart', 'edgeWhyText', 'mxBookLabel'])
    assert.ok(copy.includes(fn(name)), `${name}: summary.js copy differs from the page`);
  const require = createRequire(import.meta.url);
  assert.equal(require('./h2h-model/config.js').summary.enabled, false, 'founder 2026-10-10: Stennisfy Analysis is off (no Claude calls)');
});
