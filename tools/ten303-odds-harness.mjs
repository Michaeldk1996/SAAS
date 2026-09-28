// TEN-303 — the Odds-tab renderer sliced out of bsp-consult-dashboard.html and run in a sandbox. Shared by
// test-ten303-odds-tab.mjs and the test-only pixel fixture (tools/ten303-pixel-fixture.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HTML = readFileSync(process.env.TEN303_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');   // the mutant runner points this at a mutated copy

export function slice(name, src = HTML) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
export function constSrc(name, src = HTML) {
  const start = src.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  return src.slice(start, src.indexOf(';\n', start) + 1);
}
export const CONSTS = ['ANALYSIS_P1_COLOR', 'ANALYSIS_P2_FILL', 'AODDS_STALE_MS', 'AODDS_LEGACY_BET365', 'AODDS_ORDER', 'AODDS_ALIAS', 'AODDS_AT_CLOCK', 'AODDS_CONFIG',
  'AODDS_BOOKS', 'AODDS_MARKET_TILES', 'AODDS_STEAM', 'AODDS_LINE_SHAPE', 'AODDS_DASH', 'AODDS_C', 'AODDS_RECV', 'AODDS_CHECKED'];
export const FNS = ['acctTzOffsetMin', 'cardStartMs', 'aOddsStartMs', 'escapeHtml', 'aOddsStep', 'aOddsBooksOf', 'aOddsHasSeries',
  'aOddsPulledAt', 'aOddsHM', 'aOddsDM', 'aOddsStamp', 'aOddsWhen', 'aOddsFmt', 'aOddsSrcTitle', 'aOddsGapsMs', 'aOddsInGap',
  'aOddsPairTicks', 'aOddsNoVig', 'aOddsRowsOf', 'aOddsMonotone', 'aOddsDispSeries', 'aOddsLinePaths', 'aOddsSparkSvg', 'aOddsMvChart', 'aOddsTipHtml',
  'aOddsStatusOf', 'aOddsBookTip', 'aOddsTipHide', 'initAOddsTips', 'renderOddsSection', 'aOddsSetMode', 'aOddsSetMarket',
  'aOddsOpenMv', 'aOddsCloseMv', 'buildOddsSection', 'aOddsMvHtml', 'akOddsMoveSvg'];

// The page's renderer in a sandbox. `over` replaces a const's source (e.g. a config under test).
export function build(src = HTML, over = {}) {
  const c = n => (over[n] != null ? `\nconst ${n} = ${over[n]};` : constSrc(n, src));
  return new Function(`
    ${CONSTS.map(c).join('\n')}
    let _aOdds = { m:null, novig:false, market:'Match Winner', mv:null };
    let _aoTipTimer = null, _aoTipFor = null;
    const SECTION = { innerHTML: '' };
    const document = { getElementById: id => (id === 'aSectionOdds' ? SECTION : null), addEventListener(){} };
    const newsTz = () => 'Europe/Brussels';
    const buildOddsReduced = () => 'REDUCED';
    const psEsc = x => String(x);
    const _ocsOf = m => (m && m.__testOcs) || null;
    ${FNS.map(n => slice(n, src)).join('\n')}
    return { buildOddsSection, aOddsRowsOf, aOddsLinePaths, aOddsMvChart, aOddsSparkSvg, aOddsSetMarket, aOddsSetMode, aOddsOpenMv,
             aOddsCloseMv, renderOddsSection, akOddsMoveSvg, aOddsBooksOf, cardStartMs, aOddsStartMs, AODDS_C, aOddsFmt, aOddsDispSeries,
             open: m => { _aOdds = { m, novig:false, market:'Match Winner', mv:null }; },
             state: () => _aOdds, section: () => SECTION.innerHTML };
  `)();
}

