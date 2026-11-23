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
  ${slice('mcSigEloTitle')} ${slice('mcSigModelP')} ${slice('mcSigPolyUsd')} ${slice('mcSigLiqRec')} ${slice('mcSigPolyHtml')} ${slice('ocsNfd')} ${slice('mcSigSurKey')} ${slice('mcSigK')} ${slice('mcSigLast')} ${slice('mcSigPredRows')} ${slice('mcSigModelDress')} ${slice('mcSigRowHtml')} ${slice('fhDayNum')} ${slice('fhEloKey')} ${slice('fhEloAt')} ${slice('mcSigEloPre')} ${slice('mcSigEloPreTitle')} ${slice('mcSigLastBefore')} const FH_ELO_MAX_AGE_DAYS = 7; let _mcSigEloHist = null; ${slice('mcSigBody')}
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
  assert.match(html, /const gOrd = g => \(g === 'sharp' \? 0 : g === 'prediction' \? 2 : 1\);/, 'listed after Soft');
  // Dropping Odds v2 (founder brief 2026-11-23): its feed carries no prediction market, so the page lists none (every
  // prediction-market element hidden); the roster is the books it has a source for
  const { createRequire } = await import('node:module');
  const DP = createRequire(import.meta.url)(join(HERE, 'drops-page.js'));
  assert.deepEqual(DP.BOOKS, [['Pinnacle', 'sharp'], ['Bet105', 'sharp'], ['Superbet', 'soft'], ['Napoleon Sports BE', 'soft']]);
  // Match analysis rebuild 2026-11-23: the Odds tab is drawn by maOddsV2 (match-analysis-v2.js), one box per group —
  // the old 'PREDICTION MARKET' caps label is now the box head "Prediction markets". Run it on a card with a Polymarket line.
  const { build } = await import('./tools/ma2-odds-vm.mjs');
  const now = Date.now(), iso = t => new Date(t).toISOString(), start = new Date(now + 6 * 3600e3), pad = n => String(n).padStart(2, '0');
  const chart = { books: {}, meta: {} };
  const put = (k, meta, a, b) => { chart.books[k] = { p1: [[iso(now - 3 * 3600e3), a]], p2: [[iso(now - 3 * 3600e3), b]] }; chart.meta[k] = Object.assign({ checkedAt: iso(now - 60e3) }, meta); };
  put('Pinnacle +30s', { source: 'Oddspapi', group: 'sharp', clock: 'book tick' }, 2.35, 1.66);
  put('Superbet', { source: 'odds-api.io', group: 'soft', clock: 'vendor updatedAt' }, 2.4, 1.6);
  put('Polymarket (odds-api.io)', { source: 'odds-api.io', group: 'prediction', clock: 'vendor updatedAt' }, 2.38, 1.7);
  const m = { id: 'upcoming-1', p1: 'J. Sinner', p2: 'C. Alcaraz', date: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`,
    time: `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}`, startTs: iso(start.getTime()),
    oddsMovement: { market: 'Match Winner', capturedAt: iso(now - 26 * 3600e3), books: {}, chart } };
  const P = build(); P.open(m);
  const tab = P.buildOddsSection(m), at = k => tab.indexOf(k);
  assert.ok(at('class="ma2-group" data-group="prediction"') > 0, 'the Odds tab draws a prediction-market group');
  assert.ok(/Prediction markets/.test(tab), 'the group head "Prediction markets"');
  assert.ok(at('data-group="soft"') > 0 && at('data-group="soft"') < at('data-group="prediction"'), 'listed after Soft');
  const pg = tab.slice(at('data-group="prediction"'));
  assert.ok(/data-book="Polymarket"/.test(pg), 'Polymarket is a row of that group');
  assert.ok(!/data-book="Polymarket"/.test(tab.slice(0, at('data-group="prediction"'))), 'never in Sharp or Soft');
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
  ${slice('mcSigEloTitle')} ${slice('mcSigModelP')} ${slice('mcSigPolyUsd')} ${slice('mcSigLiqRec')} ${slice('mcSigPolyHtml')} ${slice('mcSigKalshiHtml')} ${slice('ocsNfd')} ${slice('mcSigSurKey')} ${slice('mcSigK')} ${slice('mcSigLast')} ${slice('mcSigPredRows')} ${slice('mcSigModelDress')} ${slice('mcSigRowHtml')} ${slice('fhDayNum')} ${slice('fhEloKey')} ${slice('fhEloAt')} ${slice('mcSigEloPre')} ${slice('mcSigEloPreTitle')} ${slice('mcSigLastBefore')} const FH_ELO_MAX_AGE_DAYS = 7; let _mcSigEloHist = null; ${slice('mcSigBody')}
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
