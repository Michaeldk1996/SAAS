// Dropping Odds → Arbitrage (founder 2026-11-01): executes the shipped arb-page.js on the engine's arb_now() shape.
// Checks: header stats count the engine's lists; an arbitrage card shows both legs (after-fee price for a prediction
// market, its liquidity, "bookmaker" for a book), the profit, the stakes and the retirement warning only when flagged;
// divergences list price, fair and % above fair; every match's fair price; empty / loading / failed states say so (no
// number invented); the page wires a Drops | Arbitrage switch and publishes arb-page.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('./arb-page.js', import.meta.url), 'utf8');
function page(data, failed = false) {
  const w = { newsTz: () => 'UTC' };
  vm.runInNewContext(src, { window: w, globalThis: w, newsTz: () => 'UTC' });
  w.ArbPage._st.data = data; w.ArbPage._st.failed = failed;
  return w.ArbPage;
}
const D = { at: '2026-11-02T08:00:00Z', config: { arbMin: 1, divMin: 5, minLiq: 100 },
  fair: [{ eventKey: 1, first: 'Q. Halys', second: 'A. Fery', start: '2026-11-02T12:00:00Z', fairFirst: 1.95, fairSecond: 2.053,
    sources: [{ source: 'Bet105', effFirst: 1.9, effSecond: 2 }, { source: 'Kalshi', effFirst: 2.399, effSecond: 2.14 }, { source: 'Superbet', effFirst: 2.2, effSecond: 1.8 }] }],
  divergences: [{ eventKey: 1, first: 'Q. Halys', second: 'A. Fery', start: '2026-11-02T12:00:00Z', source: 'Kalshi', group: 'prediction', side: 'first',
    player: 'Q. Halys', price: 2.5, eff: 2.399, liq: 400, fair: 1.95, edge: 23.03 }],
  arbs: [{ eventKey: 1, first: 'Q. Halys', second: 'A. Fery', start: '2026-11-02T12:00:00Z', profit: 9.07, stakeFirst: 45.5, stakeSecond: 54.5,
    legFirst: { source: 'Kalshi', group: 'prediction', price: 2.5, eff: 2.399, liq: 400, at: '2026-11-02T07:59:00Z' },
    legSecond: { source: 'Bet105', group: 'sharp', price: 2, eff: 2, liq: null, at: '2026-11-02T07:58:00Z' }, retirementFlag: true }] };

test('header: the engine\'s counts and its read time', () => {
  const h = page(D).headerHtml();
  assert.match(h, /<h1 class="sfh__title">Arbitrage<\/h1>/);
  assert.match(h, /Arbs<\/span><span class="sfh__v">1</); assert.match(h, /Divergences<\/span><span class="sfh__v">1</);
  assert.match(h, /Matches<\/span><span class="sfh__v">1</); assert.match(h, /Updated<\/span><span class="sfh__v sfh__v--soft">08:00</);
});
test('an arbitrage card: both legs, fee, liquidity, profit, stakes, the retirement warning', () => {
  const b = page(D).bodyHtml();
  assert.match(b, /<span class="ar-profit">\+9\.1%<\/span>/);
  assert.match(b, /Back Q\. Halys<\/span><span class="ar-leg-src">Kalshi<\/span><span class="ar-px">2\.50<span class="ar-fee">after fee 2\.40<\/span><\/span><span class="ar-liq">\$400 at price/);
  assert.match(b, /Back A\. Fery<\/span><span class="ar-leg-src">Bet105<\/span><span class="ar-px">2\.00<\/span><span class="ar-liq">bookmaker/);
  assert.match(b, /Stakes 45\.5% \/ 54\.5%/);
  assert.match(b, /class="ar-flag">Retirement rules differ/);
  const nf = page({ ...D, arbs: [{ ...D.arbs[0], retirementFlag: false }] }).bodyHtml();
  assert.doesNotMatch(nf, /ar-flag/, 'no flag when the engine sets none');
});
test('divergence row and fair table', () => {
  const b = page(D).bodyHtml();
  assert.match(b, /<span class="r ar-px">2\.50<span class="ar-fee">after fee 2\.40<\/span><\/span><span class="r ar-px">1\.95<\/span><span class="r ar-edge">\+23\.0%<\/span><span class="r">\$400<\/span>/);
  assert.match(b, /1\.95 \/ 2\.05<\/span><span class="ar-srcs"><span class="ar-src"><b>Kalshi<\/b> 2\.40 \/ 2\.14<\/span><span class="ar-src"><b>Superbet<\/b> 2\.20 \/ 1\.80/);
});
test('empty, loading and failed states invent nothing', () => {
  const e = page({ ...D, arbs: [], divergences: [], fair: [] }).bodyHtml();
  assert.match(e, /No arbitrage above \+1\.0% after fees right now\./);
  assert.match(e, /No price \+5\.0% or more above the fair price right now\./);
  assert.match(e, /No upcoming ATP match has a live Bet105 price right now\./);
  assert.match(page(null).bodyHtml(), /Loading prices…/);
  assert.match(page(null, true).bodyHtml(), /Arbitrage data unavailable\./);
  assert.match(page(null).headerHtml(), /Arbs<\/span><span class="sfh__v sfh__v--none">—</);
});
test('wiring: Drops | Arbitrage switch, script loaded before drops-page.js, published', () => {
  const dp = readFileSync(new URL('./drops-page.js', import.meta.url), 'utf8');
  assert.match(dp, /seg\('Drops', st\.view === 'drops', 'view', 'drops'\)/);
  assert.match(dp, /seg\('Arbitrage', st\.view === 'arb', 'view', 'arb'\)/);
  assert.match(dp, /case 'view':/);
  const html = readFileSync(new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="arb-page\.js" defer><\/script>\n<script src="drops-page\.js" defer><\/script>/);
  assert.match(readFileSync(new URL('./tools/site-code.sh', import.meta.url), 'utf8'), /arb-page\.js/);
});
