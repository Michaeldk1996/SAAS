// TEST-ONLY sandbox for test-ten324-overview-spine.mjs: the dashboard's Overview data and paint layer (ovPaint,
// ensureOverviewProfiles, setOverviewTier, A_TAB_BUILD.overview — sliced with every top-level declaration they reach via
// tools/ten334-overview-vm.mjs `closure`) + the real renderer maOverviewV2 from match-analysis-v2.js, over the REAL
// player-profile-v2.js (profileWindow). Unlike tools/ten313-overview-v2-vm.mjs, the shard fetch, aBuilt and aPaint are
// the caller's, so the load / repaint order can be driven. Never loaded by the page.
import { readFileSync } from 'node:fs';
import { closure, topDecls, objSrc, profileWindow } from './ten334-overview-vm.mjs';

const MA2_DEFAULT = readFileSync(new URL('../match-analysis-v2.js', import.meta.url), 'utf8');
const STUBS = ['ensurePlayerProfile', 'loadCareerHistory', 'fhLoadCloses', 'escapeHtml', 'aPaint', 'aBuilt', 'ovRenderPop', 'sfDbPxLoad'];

// src = the dashboard source, ma2 = the match-analysis-v2.js source (either may be a mutated copy).
// profiles = the playerProfiles map; shard(k) models ensurePlayerProfile; built(m, tab) models aBuilt.
export function overviewSpineVM(src, { profiles = {}, shard = () => Promise.resolve(false), built = () => true, ma2 = MA2_DEFAULT } = {}) {
  const painted = {};
  const a = ma2.indexOf('function ovList('), b = ma2.indexOf('root.maOvPopV2');
  const decls = topDecls(src), seeds = ['ovPaint', 'ensureOverviewProfiles', 'buildYearlyTables', 'setOverviewTier', 'ovStateFor', '_ov', '_ovProfileSettled']
    .concat([...new Set(ma2.slice(a, b).match(/[A-Za-z_$][\w$]*/g))].filter(n => decls.has(n)));
  const body = closure(src, seeds, STUBS.concat(['playerProfiles', 'A_TAB_BUILD']));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'playerProfiles', ...STUBS, `
    ${body}
    ${objSrc('const A_TAB_BUILD', src)}
    const __MA2 = (function(){ const window = {}; ${ma2}; return window; })();
    const maOverviewV2 = __MA2.maOverviewV2;
    return { buildYearlyTables, setOverviewTier, A_TAB_BUILD, get _ov(){ return _ov; } };`)(
    profileWindow(profiles), profiles, k => shard(String(k)), () => Promise.resolve([]), () => Promise.resolve(null), esc,
    (id, html) => { painted[id] = html; }, (m, tab) => built(m, tab), () => {}, () => Promise.resolve());
  return Object.assign(api, { painted });
}
