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
  ${slice('mcSigEloTitle')} ${slice('mcSigModelP')} ${slice('mcSigPolyUsd')} ${slice('mcSigLiqRec')} ${slice('mcSigPolyHtml')} ${slice('ocsNfd')} ${slice('mcSigSurKey')} ${slice('mcSigK')} ${slice('mcSigLast')} ${slice('mcSigPredRows')} ${slice('mcSigModelDress')} ${slice('mcSigRowHtml')} ${slice('mcSigBody')}
  return { mcSigBody };`)(vol);
const VOL = { generatedAt: '2026-11-01T10:05:00Z', byEvent: { '12166001': { slug: 'atp-tirante-bellucc-2026-11-01', volume: 1851.213744, volumeMl: 1700.5, liquidity: 22090.2256, liquidityAt: '2026-11-01T09:55:00Z' } } };
const up = { id: 'upcoming-12166001', p1: 'T. A. Tirante', p2: 'M. Bellucci', surface: 'hard', _oddsLoaded: true };
const done = { id: 'past-12166001', p1: 'T. A. Tirante', p2: 'M. Bellucci', surface: 'hard', finalScore: { winner: 'p1' } };
const names = h => [...h.matchAll(/mc-sg-name">([^<]*)</g)].map(x => x[1]);

test('founder design 2026-11-07: with no per-minute price row, a joined Polymarket market is a dash row whose hover carries the resting liquidity', () => {
  for (const m of [up, done]) {
    const h = S(VOL).mcSigBody(m);
    assert.equal(names(h).at(-1), 'Polymarket', 'the last of the eight rows');
    assert.equal(names(h).length, 8);
    assert.match(h, /title="Polymarket · no price read for this match · \$22\.1k resting \(read Sun 01 Nov, 09:55\)"/, 'liquidity in the hover only (CHANGES §2)');
    assert.doesNotMatch(h, /liquidity<\/span>|traded/, 'no liquidity line, no traded figure without a read');
  }
});
test('no market → "no market for this match"; a genuine 0 liquidity is $0', () => {
  assert.match(S(VOL).mcSigBody({ ...up, id: 'upcoming-999' }), /title="Polymarket · no market for this match"/);
  assert.match(S(null).mcSigBody(up), /title="Polymarket · no market for this match"/, 'file not loaded / missing');
  assert.match(S({ byEvent: { '12166001': { volume: 500, liquidity: null } } }).mcSigBody(up), /title="Polymarket · no market for this match"/, 'no liquidity → nothing claimed');
  assert.match(S({ byEvent: { '12166001': { volume: null, liquidity: 0 } } }).mcSigBody(up), /\$0 resting/, 'a genuine 0 is 0');
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
  ${slice('mcSigEloTitle')} ${slice('mcSigModelP')} ${slice('mcSigPolyUsd')} ${slice('mcSigLiqRec')} ${slice('mcSigPolyHtml')} ${slice('mcSigKalshiHtml')} ${slice('ocsNfd')} ${slice('mcSigSurKey')} ${slice('mcSigK')} ${slice('mcSigLast')} ${slice('mcSigPredRows')} ${slice('mcSigModelDress')} ${slice('mcSigRowHtml')} ${slice('mcSigBody')}
  return { mcSigBody };`)(vol, kvol);
const KV = { generatedAt: '2026-11-01T10:05:00Z', byEvent: { '12166001': { event: 'KXATPMATCH-26NOV01TIRBEL', contracts: 5590.03, liquidity: 431220.5 } } };
test('Kalshi sits before Polymarket, behind the second hairline; its liquidity rides in the hover', () => {
  const h = SK(VOL, KV).mcSigBody(up);
  assert.deepEqual(names(h).slice(-2), ['Kalshi', 'Polymarket']);
  assert.match(h, /mc-sg-lr rule dash" title="Kalshi · no price read for this match · \$431\.2k resting/);
  assert.doesNotMatch(h, /contracts/);
  assert.match(SK(VOL, { byEvent: { '12166001': { contracts: 12, liquidity: null } } }).mcSigBody(up), /title="Kalshi · no market for this match"/);
  assert.match(SK(VOL, KV).mcSigBody({ ...up, id: 'upcoming-999' }), /title="Kalshi · no market for this match"/);
});
