// Match analysis rebuild 2026-11-23 — the Odds tab in a sandbox: the data model (aOddsRowsOf, AODDS_* config, the chart and
// tooltip helpers) sliced out of bsp-consult-dashboard.html, and the NEW renderer (oddsBuild / oddsMv = window.maOddsV2) run
// from match-analysis-v2.js in the same scope, so its free identifiers resolve to the sliced page code. Used by
// test-ten303-odds-tab.mjs and test-ten303-colours.mjs. TEN303_HTML / TEN303_V2: the mutant runner's mutated copies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HTML, slice, constSrc } from './ten303-odds-harness.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
export { HTML, slice, constSrc };
export const V2 = readFileSync(process.env.TEN303_V2 || join(HERE, 'match-analysis-v2.js'), 'utf8');
export const CONSTS = ['FH_AC', 'FH_MONO', 'KF_BOOK_PREF', 'AODDS_STALE_MS', 'AODDS_LEGACY_BET365', 'AODDS_ORDER', 'AODDS_ALIAS', 'AODDS_AT_CLOCK', 'AODDS_CONFIG',
  'AODDS_BOOKS', 'AODDS_MARKET_TILES', 'AODDS_STEAM', 'AODDS_LINE_SHAPE', 'AODDS_DASH', 'AODDS_C', 'AODDS_RECV', 'AODDS_CHECKED', 'AODDS_SIDES'];
// the page's Odds functions that the rebuild kept (the old table / pop-up / Key factors renderers were deleted)
export const FNS = ['acctTzOffsetMin', 'cardStartMs', 'aOddsStartMs', 'escapeHtml', 'aOddsStep', 'aOddsBooksOf', 'aOddsHasSeries',
  'aOddsPulledAt', 'aOddsHM', 'aOddsDM', 'aOddsStamp', 'aOddsWhen', 'aOddsFmt', 'aOddsMovePct', 'aOddsSrcTitle', 'aOddsGapsMs', 'aOddsInGap',
  'aOddsPairTicks', 'aOddsNoVig', 'aOddsRowsOf', 'aOddsMonotone', 'aOddsDispSeries', 'aOddsLinePaths', 'aOddsMvChart', 'aOddsTipHtml',
  'aOddsStatusOf', 'aOddsBookTip', 'aOddsTipHide', 'initAOddsTips', 'renderOddsSection', 'aOddsSetMode', 'aOddsSetMarket',
  'aOddsOpenMv', 'aOddsCloseMv', 'aOddsCardTile', 'buildOddsSection', 'kfOddsBook'];
// the rebuild's Odds code only (oddsMove … dayBands), for the source-level checks
export function v2OddsSrc(v2 = V2) { return v2.slice(v2.indexOf('  function oddsMove('), v2.indexOf('  // MARKET EDGE (LOCKED')); }

export function build(src = HTML, over = {}, v2 = V2) {
  const c = n => (over[n] != null ? `\nconst ${n} = ${over[n]};` : constSrc(n, src));
  return new Function(`
    ${CONSTS.map(c).join('\n')}
    let _aOdds = { m:null, novig:false, market:'Match Winner', mv:null };
    let _aoTipTimer = null, _aoTipFor = null;
    const SECTION = { innerHTML: '' };
    const document = { getElementById: id => (id === 'aSectionOdds' ? SECTION : null), addEventListener(){}, querySelectorAll: () => [] };
    const window = {};
    const newsTz = () => 'Europe/Brussels';
    const _ocsOf = m => (m && m.__testOcs) || null;
    const _streamNowOver = (m, o) => (m && m.__testStream) || null;
    const _mcNowPair = m => (m && m.__testNowPair) || null;
    ${FNS.map(n => slice(n, src)).join('\n')}
    ${v2}
    const maOddsV2 = window.maOddsV2;
    return { buildOddsSection, aOddsRowsOf, aOddsLinePaths, aOddsMvChart, aOddsCardTile, aOddsSetMarket, aOddsSetMode, aOddsOpenMv,
             aOddsCloseMv, renderOddsSection, kfOddsBook, aOddsBooksOf, cardStartMs, aOddsStartMs, AODDS_C, aOddsFmt, aOddsDispSeries,
             open: m => { _aOdds = { m, novig:false, market:'Match Winner', mv:null }; },
             state: () => _aOdds, section: () => SECTION.innerHTML };
  `)();
}
