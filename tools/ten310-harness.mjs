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

const DATA_CONSTS = ['FH_SLAMS', 'FH_BOOK_ORDER', 'FH_DASHC', 'ME_NONSTD_EVENT'];
const DATA_FNS = ['escapeHtml', 'fhSafeId', 'ppCleanTournamentName', 'fhTournClean', 'fhSurfName', 'h2hRoundLabel', 'psRoundAbbr',
  'fhRoundCode', 'fhSetsFrom', 'psNormTour', 'fhBestOf', 'fhSetDone', 'fhFinishRow', 'fhLevelOf', 'fhDayNum', 'fhIsInitial',
  'fhNameKey', 'fhPickBook', 'fhParseCloses', 'fhCloseFor', 'meRowFromCareer', 'meRowsFor'];

/** The page's data layer: { meRowsFor, fhParseCloses, core }. */
export function buildData({ src = HTML } = {}) {
  const core = loadCore();
  const api = new Function('MarketEdgeCore', `
    ${DATA_CONSTS.map((n) => constSrc(n, src)).join('\n')}
    ${DATA_FNS.map((n) => slice(n, src)).join('\n')}
    return { meRowsFor, meRowFromCareer, fhParseCloses };
  `)(core);
  return Object.assign(api, { core });
}

const UI_CONSTS = ['FH_MONO', 'FH_MONS', 'FH_BOOK', 'FH_SRC', 'AODDS_C', 'ME_C', 'ME_NOPRICE_MSG', 'mePct0', 'mePct1', 'meUC', 'meSegT', 'ME_CARD',
  'ME_TITLE', 'ME_COLH', 'ME_FOOT', 'ME_HINT', 'ME_PGRID', 'ME_BCOLS', 'ME_LCOLS', 'meScopeLbl', 'meLoadingRow', 'meStatBox', 'ME_BAND_TCOLS', 'ME_LINE_TCOLS'];
const UI_FNS = ['escapeHtml', 'fhDayNum', 'psShortName', 'fhSurname', 'fhEsc', 'fhRefDay', 'fhLongDate', 'fhOdd', 'fhSrcTitle', 'aOddsTipHtml', 'aHeaderOdds', 'meStateFor',
  'meSg', 'meDMY', 'meModels', 'meSegHtml', 'meScopeSeg', 'meBandsCol', 'mePriceCard', 'meChartCard', 'meLinesCol', 'meLinesCard', 'mePillTip',
  'buildMarketEdgeSection', 'meSheetOk', 'meScoreTxt', 'mePopShell', 'meBookNote', 'meRowsHtml', 'meTableHead', 'meCommonCells', 'meBandPopHtml', 'meLinePopHtml'];

/** The page's data layer + renderer. ui.render(m, S, rowsA, rowsB) → { html, band(k), line(k) }. */
export function buildUI({ src = HTML } = {}) {
  const data = buildData({ src });
  const window = { MarketEdgeCore: data.core };
  const ui = new Function('window', `
    let _me = null;
    ${UI_CONSTS.map((n) => constSrc(n, src)).join('\n')}
    ${UI_FNS.map((n) => slice(n, src)).join('\n')}
    function render(m, S, rows, states){
      _me = meStateFor(m);
      Object.assign(_me.S, S || {});
      _me.data = rows; _me.state = states || rows.map(r => (r ? 'ready' : 'loading'));
      _me.idx = { ms: new Set(), ss: new Set(), pbp: new Set() }; _me.rowMap = {};
      const MM = meModels(_me);
      return { E: _me, MM, html: buildMarketEdgeSection(m),
        band: key => { _me.S.meBand = key; const h = meBandPopHtml(_me, meModels(_me)); _me.S.meBand = null; return h; },
        line: (key, sc) => { _me.S.meLine = key; _me.S.meLineScope = sc || 'all'; const h = meLinePopHtml(_me, meModels(_me)); _me.S.meLine = null; return h; } };
    }
    return { render, aHeaderOdds };
  `)(window);
  return Object.assign(ui, data);
}
