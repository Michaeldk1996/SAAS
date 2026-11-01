// Founder 2026-11-01: the Market Signal panel shows Polymarket's total traded on the match as ONE line under the
// six-row Step 15 grid. Executes the shipped mcSigBody + mcSigPolyHtml with polymarket.json's shape.
// Checks: a joined card shows "Polymarket · $1,851 traded" after the grid, on Upcoming and Completed; the six rows are
// unchanged; a card polymarket.json does not list, a missing file and a negative / absent volume show nothing (never a
// zero, never a guess); the hover names the source and the read time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const S = (vol) => new Function('vol', `
  const window = { sfPlan: null };
  const eloRatings = { taLastUpdate: '2026-10-26', elo: {} };
  const _ocsOf = () => null, _mcPinClose = () => null, mxPinCloseAgeMin = () => null, mxJClose = () => null;
  const cardStartMs = m => m.__start, newsTz = () => 'UTC';
  let polymarketVol = vol;
  ${slice('eventKeyOfMatch')} ${slice('psEsc')} ${slice('psEloNorm')} ${slice('mxOddsTxt')} ${slice('mxSurname')} ${slice('mxIsPro')}
  ${slice('mcSigReady')} ${slice('mcSigPair')} ${slice('mcSigImp')} ${slice('mcSigFirst')} ${slice('mcSigClock')}
  ${slice('mcSigEloRec')} ${slice('mcSigEloLast')} ${slice('mcSigEloStaleText')} ${slice('mcSigEloP')} ${slice('mcSigFair')} ${slice('mcSigElo')}
  ${slice('mcSigEloTitle')} ${slice('mcSigModelP')} ${slice('mcSigPolyUsd')} ${slice('mcSigPolyHtml')} ${slice('mcSigBody')}
  return { mcSigBody };`)(vol);
const VOL = { generatedAt: '2026-11-01T10:05:00Z', byEvent: { '12166001': { slug: 'atp-tirante-bellucc-2026-11-01', volume: 1851.213744, volumeMl: 1700.5, liquidity: 22090.2256 } } };
const up = { id: 'upcoming-12166001', p1: 'T. A. Tirante', p2: 'M. Bellucci', surface: 'hard', _oddsLoaded: true };
const done = { id: 'past-12166001', p1: 'T. A. Tirante', p2: 'M. Bellucci', surface: 'hard', finalScore: { winner: 'p1' } };
const names = h => [...h.matchAll(/mc-sg-name">([^<]*)</g)].map(x => x[1]);

test('a joined card: one Polymarket line under the grid, Upcoming and Completed', () => {
  for (const m of [up, done]) {
    const h = S(VOL).mcSigBody(m);
    assert.match(h, /<div class="mc-sg-poly"[^>]*>.*Polymarket<\/span><\/span><span class="mc-sg-polyv">\$1,851 traded · \$22,090 liquidity<\/span><\/div>/);
    assert.equal(names(h).at(-1), 'Polymarket', 'the line comes after the six rows');
    assert.equal((h.match(/class="mc-sg-row(?: dash)?"/g) || []).length, 6, 'the six grid rows are unchanged');
    assert.match(h, /title="Polymarket · traded = total traded on this match, every market; liquidity = the match-winner market's whole order book \(Polymarket's own figures\) · read [^"]+"/);
  }
});
test('no line without a confident Polymarket match: another card, no file, no volume', () => {
  assert.doesNotMatch(S(VOL).mcSigBody({ ...up, id: 'upcoming-999' }), /Polymarket/);
  assert.doesNotMatch(S(null).mcSigBody(up), /Polymarket/, 'file not loaded / missing');
  assert.doesNotMatch(S({ byEvent: { '12166001': { volume: null } } }).mcSigBody(up), /Polymarket/, 'no volume → nothing, never $0');
  assert.match(S({ byEvent: { '12166001': { volume: 500, liquidity: null } } }).mcSigBody(up), /\$500 traded<\/span>/, 'no liquidity → traded alone, never "$0 liquidity"');
});
test('the toggle loads polymarket.json once and repaints the open panel', () => {
  const t = slice('toggleSig');
  assert.match(t, /if \(m && \(!polymarketVol \|\| !kalshiVol\)\) Promise\.all\(\[loadPolymarket\(\), loadKalshi\(\)\]\)\.then\(/);
  assert.match(slice('loadPolymarket'), /fetch\('\.\/polymarket\.json'/);
});
test('Polymarket is its own group, "Prediction market", on the Odds tab and the Dropping Odds box (cards say "Polymarket")', async () => {
  assert.match(html, /\{ name: 'Polymarket', group: 'prediction', sources: \['Polymarket \(odds-api\.io\)'\] \}/);
  assert.match(html, /'Polymarket \(odds-api\.io\)': \{ group: 'prediction'/);
  assert.match(html, /\['prediction', 'PREDICTION MARKET', C\.soft\]/, 'the Odds tab group label');
  assert.match(html, /const gOrd = g => \(g === 'sharp' \? 0 : g === 'prediction' \? 2 : 1\);/, 'listed after Soft');
  const vm = await import('node:vm');
  const js = readFileSync(join(HERE, 'drops-page.js'), 'utf8');
  const bc = js.slice(js.indexOf('var SHARP_BOOKS'), js.indexOf('var GROUP_NAME'));
  const ctx = {}; vm.runInNewContext(bc + '; this.bookCls = bookCls;', ctx);
  assert.deepEqual(['Polymarket', 'Polymarket (odds-api.io)', 'Superbet', 'Bet105', 'Betfair Exchange'].map(ctx.bookCls),
    ['prediction', 'prediction', 'soft', 'sharp', 'sharp']);
  assert.match(js, /var GROUP_NAME = \{ sharp: 'Sharp', soft: 'Soft', prediction: 'Prediction market' \};/);
});
const SK = (vol, kvol) => new Function('vol', 'kvol', `
  const window = { sfPlan: null };
  const eloRatings = { taLastUpdate: '2026-10-26', elo: {} };
  const _ocsOf = () => null, _mcPinClose = () => null, mxPinCloseAgeMin = () => null, mxJClose = () => null;
  const cardStartMs = m => m.__start, newsTz = () => 'UTC';
  let polymarketVol = vol, kalshiVol = kvol;
  ${slice('eventKeyOfMatch')} ${slice('psEsc')} ${slice('psEloNorm')} ${slice('mxOddsTxt')} ${slice('mxSurname')} ${slice('mxIsPro')}
  ${slice('mcSigReady')} ${slice('mcSigPair')} ${slice('mcSigImp')} ${slice('mcSigFirst')} ${slice('mcSigClock')}
  ${slice('mcSigEloRec')} ${slice('mcSigEloLast')} ${slice('mcSigEloStaleText')} ${slice('mcSigEloP')} ${slice('mcSigFair')} ${slice('mcSigElo')}
  ${slice('mcSigEloTitle')} ${slice('mcSigModelP')} ${slice('mcSigPolyUsd')} ${slice('mcSigPolyHtml')} ${slice('mcSigKalshiHtml')} ${slice('mcSigBody')}
  return { mcSigBody };`)(vol, kvol);
const KV = { generatedAt: '2026-11-01T10:05:00Z', byEvent: { '12166001': { event: 'KXATPMATCH-26NOV01TIRBEL', contracts: 5590.03, liquidity: 431220.5 } } };
test('Kalshi: one line under Polymarket — contracts traded and the whole match-winner book', () => {
  const h = SK(VOL, KV).mcSigBody(up);
  assert.match(h, /<span class="mc-sg-name">Kalshi<\/span><\/span><span class="mc-sg-polyv">5,590 contracts traded · \$431,221 liquidity<\/span>/);
  assert.deepEqual(names(h).slice(-2), ['Polymarket', 'Kalshi']);
  assert.equal((h.match(/mc-sg-rule/g) || []).length, 1, 'ONE rule above the prediction-market pair');
  const k = SK(null, KV).mcSigBody(up);
  assert.equal((k.match(/mc-sg-rule/g) || []).length, 1, 'Kalshi alone carries the rule');
  assert.doesNotMatch(SK(VOL, { byEvent: { '12166001': { contracts: null } } }).mcSigBody(up), /Kalshi/, 'no contracts → no line, never 0');
  assert.match(SK(null, { byEvent: { '12166001': { contracts: 12, liquidity: null } } }).mcSigBody(up), /12 contracts traded<\/span>/);
  assert.doesNotMatch(SK(VOL, KV).mcSigBody({ ...up, id: 'upcoming-999' }), /Kalshi/);
});
