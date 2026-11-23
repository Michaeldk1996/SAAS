// TEN-310 — the Market edge tab's data layer and renderer, sliced out of bsp-consult-dashboard.html
// and run in a sandbox with the real market-edge-core.js. Shared by test-ten310-market-edge.mjs and
// tools/ten310-market-edge-counts.mjs. Nothing here re-implements a rule: every function is the page's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
// The mutant runner points TEN310_HTML / TEN310_CORE at mutated copies.
export const HTML = readFileSync(process.env.TEN310_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
export const CORE_PATH = process.env.TEN310_CORE || join(HERE, 'market-edge-core.js');

export function slice(name, src = HTML) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  // a one-line function is taken whole (a brace scanner cannot tell `{` inside a regex literal)
  const eol = src.indexOf('\n', start + 1);
  const line = src.slice(start, eol);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
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

export function loadCore() {
  const req = createRequire(import.meta.url);
  delete req.cache[req.resolve(CORE_PATH)];
  return req(CORE_PATH);
}

const DATA_CONSTS = ['FH_SLAMS', 'FH_BOOK_ORDER', 'FH_DASHC', 'ME_NONSTD_EVENT', 'ME_PROFILE_BOOK', 'ME_TD_ROUND'];
const DATA_FNS = ['escapeHtml', 'fhSafeId', 'ppCleanTournamentName', 'fhTournClean', 'fhSurfName', 'h2hRoundLabel', 'maRoundName', 'psRoundAbbr',
  'fhRoundCode', 'fhSetsFrom', 'psNormTour', 'fhBestOf', 'fhSetDone', 'fhFinishRow', 'fhLevelOf', 'fhDayNum', 'fhIsInitial',
  'fhNameKey', 'fhPickBook', 'fhParseCloses', 'fhCloseFor', 'meRowFromCareer', 'meRowsFor', 'meWinnerRows'];

/** The page's data layer: { meRowsFor, fhParseCloses, core }. */
export function buildData({ src = HTML } = {}) {
  const core = loadCore();
  const api = new Function('MarketEdgeCore', `
    ${DATA_CONSTS.map((n) => constSrc(n, src)).join('\n')}
    ${DATA_FNS.map((n) => slice(n, src)).join('\n')}
    return { meRowsFor, meRowFromCareer, fhParseCloses, meWinnerRows };
  `)(core);
  return Object.assign(api, { core });
}

// Match analysis rebuild (2026-11-23): the tab renderer is match-analysis-v2.js (maMarketEdgeV2 / maMeBandPopV2 /
// maMeLinePopV2); the data layer (meStateFor, meModels, the D2 gate maRate / maRateHtml / maGateBar, fhSrcTitle …) still
// lives in the dashboard. The v2 file runs inside the same sandbox, so its bare global names resolve to the page's slices.
export const V2_PATH = process.env.TEN310_V2 || join(HERE, 'match-analysis-v2.js');
export const V2 = readFileSync(V2_PATH, 'utf8');
const UI_CONSTS = ['FH_DASHC', 'FH_MONO', 'FH_MONS', 'FH_BOOK', 'FH_SRC', 'FH_B365_HOVER', 'FH_B365_APPROX_HOVER', 'FH_B365_AT_HOVER',
  'MA_GREY', 'MA_SMALL_NOTE', 'ME_NOPRICE_MSG', 'ME_BO3_MSG'];
const UI_FNS = ['escapeHtml', 'fhDayNum', 'psShortName', 'fhSurname', 'fhEsc', 'fhRefDay', 'fhLongDate', 'fhOdd', 'fhB365Approx', 'fhSrcTitle', 'aHeaderOdds', 'meStateFor',
  'meSg', 'meDMY', 'meModels', 'meBookNote', 'buildMarketEdgeSection', 'tourxSampleGate', 'maGate', 'maPct', 'maRate', 'maRateHtml', 'maGateBar', 'maSmallNote'];

/** The page's data layer + the v2 renderer. ui.render(m, S, rows, states) → { E, MM, html, band(k), line(k, scope) }. */
export function buildUI({ src = HTML, v2 = V2 } = {}) {
  const data = buildData({ src });
  const window = { MarketEdgeCore: data.core };
  const ui = new Function('window', `
    let _me = null;
    // TEN-380 review item 4: the header (and so Market edge's "today") reads the match card's pair; the fixture carries it as m.cardNow
    // (a fixture without cardNow stands its bestOdds in as the card pair, so the older fixtures keep their meaning)
    function _mcNowPair(m){ if (!m) return null; if ('cardNow' in m) return m.cardNow; const b = m.bestOdds; return b && b.p1 && b.p2 ? { p1: b.p1.price, p2: b.p2.price } : null; }
    ${UI_CONSTS.map((n) => constSrc(n, src)).join('\n')}
    ${UI_FNS.map((n) => slice(n, src)).join('\n')}
    ${v2}
    const maMarketEdgeV2 = window.maMarketEdgeV2, maMeBandPopV2 = window.maMeBandPopV2, maMeLinePopV2 = window.maMeLinePopV2;
    function render(m, S, rows, states){
      _me = meStateFor(m);
      Object.assign(_me.S, S || {});
      _me.data = rows; _me.state = states || rows.map(r => (r ? 'ready' : 'loading'));
      _me.idx = { ms: new Set(), ss: new Set(), pbp: new Set() }; _me.rowMap = {};
      const MM = meModels(_me);
      return { E: _me, MM, html: buildMarketEdgeSection(m),
        band: key => { _me.S.meBand = key; const h = maMeBandPopV2(_me, meModels(_me)); _me.S.meBand = null; return h; },
        line: (key, sc) => { _me.S.meLine = key; _me.S.meLineScope = sc || 'all'; const h = maMeLinePopV2(_me, meModels(_me)); _me.S.meLine = null; return h; } };
    }
    return { render, aHeaderOdds };
  `)(window);
  return Object.assign(ui, data);
}
