// TEST-ONLY sandbox for the rebuilt Match analysis Overview (2026-11-23): the dashboard's Overview data layer (sliced with
// every top-level declaration it reaches, tools/ten334-overview-vm.mjs `closure`) + the real renderer maOverviewV2 from
// match-analysis-v2.js, over the REAL player-profile-v2.js (profileWindow). Used by tools/test-ten313-records.js and
// tools/test-overview-profile-parity.mjs only. Never loaded by the page.
import { readFileSync } from 'node:fs';
import { closure, topDecls, profileWindow } from './ten334-overview-vm.mjs';

const MA2_DEFAULT = readFileSync(new URL('../match-analysis-v2.js', import.meta.url), 'utf8');
const STUBS = ['ensurePlayerProfile', 'loadCareerHistory', 'fhLoadCloses', 'escapeHtml', 'aPaint', 'aBuilt', 'ovRenderPop', 'sfDbPxLoad'];

// src = the dashboard source, ma2 = the match-analysis-v2.js source (both may be mutated copies).
export function overviewV2VM(src, { profiles = {}, ma2 = MA2_DEFAULT } = {}) {
  // every dashboard declaration the Overview section of match-analysis-v2.js names
  const a = ma2.indexOf('function ovList('), b = ma2.indexOf('root.maOvPopV2');
  const decls = topDecls(src), seeds = ['buildYearlyTables', 'setOverviewTier', 'ovStateFor', '_ov', '_ovProfileSettled']
    .concat([...new Set(ma2.slice(a, b).match(/[A-Za-z_$][\w$]*/g))].filter(n => decls.has(n)));
  const body = closure(src, seeds, STUBS.concat(['playerProfiles']));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // eslint-disable-next-line no-new-func
  return new Function('window', 'playerProfiles', ...STUBS, `
    ${body}
    const __MA2 = (function(){ const window = {}; ${ma2}; return window; })();
    const maOverviewV2 = __MA2.maOverviewV2;
    return { buildYearlyTables, setOverviewTier, get _ov(){ return _ov; } };`)(
    profileWindow(profiles), profiles, () => Promise.resolve(false), () => Promise.resolve([]), () => Promise.resolve(null), esc, () => {}, () => true, () => {}, () => Promise.resolve());
}
