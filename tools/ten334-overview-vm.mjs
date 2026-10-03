// TEN-334 — TEST-ONLY sandbox for the Match analysis Overview tab: slices the REAL builder (bsp-consult-dashboard.html) and
// the shared helpers it calls (sample gate, segmented control, shade tokens) and executes them against a fixture. Used by
// test-ten324-overview-spine.mjs and test-ten334-overview.mjs. Never loaded by the page. Regenerates nothing.
export function fnSrc(name, src) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 1);
}
export function objSrc(decl, src) {
  const start = src.indexOf(`\n${decl} = {`);
  if (start < 0) throw new Error(`${decl} not found`);
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 2);
}
export function lineSrc(decl, src) {
  const m = src.match(new RegExp(`\\n${decl.replace(/[$]/g, '\\$&')} = [^\\n]*`));
  if (!m) throw new Error(`${decl} not found`);
  return m[0];
}
const FNS = ['cellForTier', 'sumCellsTier', 'alignYearlyPair', 'ovCareerByYear', 'ensureOverviewProfiles', 'ovPaint', 'buildYearlyTables',
  'setOverviewTier', 'ovStateFor', 'ovListable', 'ovRec', 'ovCellHtml', 'ovColumnHtml',
  'tourxSampleGate', 'maGate', 'maPct', 'maRate', 'maSmallNote', 'maRateHtml', 'maGateBar', 'maSeg', 'fhEsc'];
const LINES = ['const _ovProfileSettled', 'const MA_GREY', 'const MA_SMALL_NOTE', 'const OV_TIERS', 'const OV_SURFS', 'const OV_GRID', 'const OV_MONO',
  'const OV_NO_LIST', 'const ovSeasonYear', 'let _ov'];
const OBJS = ['const OV_C', 'const MA_SEG', 'const A_TAB_BUILD'];
// profiles = the playerProfiles map; shard(k) models ensurePlayerProfile (may add a profile, resolves true/false);
// built(m, tab) models aBuilt. Returns the builder API plus `painted` (aPaint by id) and `_ov` (the tab's state).
export function overviewVM(src, { profiles = {}, shard = () => Promise.resolve(false), built = () => true } = {}) {
  const painted = {};
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const api = new Function('playerProfiles', 'ensurePlayerProfile', 'loadCareerHistory', 'fhLoadCloses', 'escapeHtml', 'aPaint', 'aBuilt', 'ovRenderPop', `
    ${LINES.map(l => lineSrc(l, src)).join('')}
    ${OBJS.map(o => objSrc(o, src)).join('\n')}
    ${FNS.map(f => fnSrc(f, src)).join('\n')}
    return { buildYearlyTables, setOverviewTier, A_TAB_BUILD, ovColumnHtml, cellForTier, get _ov(){ return _ov; } };`)(
    profiles, k => shard(String(k)), () => Promise.resolve([]), () => Promise.resolve(null), esc,
    (id, html) => { painted[id] = html; }, (m, tab) => built(m, tab), () => {});
  return Object.assign(api, { painted });
}

// A top-level declaration's full source: `function x(…){…}`, or `const|let x = …;` up to its statement end (brackets balanced,
// strings / template literals / comments skipped).
function declAt(src, start) {
  let i = start, d = 0, s = null, esc = false, tplDepth = [];
  const isFn = /^(async )?function /.test(src.slice(start, start + 15));
  for (; i < src.length; i++) {
    const ch = src[i];
    if (s) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (s === '`' && ch === '$' && src[i + 1] === '{') { tplDepth.push(d); d++; s = null; i++; continue; }
      if (ch === s) s = null;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i) - 1; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { s = ch; continue; }
    if (ch === '/' && /[(,=:[!&|?{};+\n]\s*$/.test(src.slice(Math.max(start, i - 30), i))) {   // a regex literal
      let cls = false; for (i++; i < src.length; i++) { const c = src[i]; if (c === '\\') { i++; continue; } if (c === '[') cls = true; else if (c === ']') cls = false; else if (c === '/' && !cls) break; }
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') d++;
    else if (ch === '}' || ch === ')' || ch === ']') {
      d--;
      if (ch === '}' && tplDepth.length && tplDepth[tplDepth.length - 1] === d) { tplDepth.pop(); s = '`'; continue; }
      if (isFn && d === 0 && ch === '}') return src.slice(start, i + 1);
    } else if (!isFn && d === 0 && (ch === ';' || (ch === '\n' && /[;}\])]\s*$/.test(src.slice(start, i)) && !/^\s*[.?:+\-|&]/.test(src.slice(i + 1, i + 40))))) return src.slice(start, i + 1);
  }
  throw new Error('unterminated declaration at ' + start);
}
// Every top-level declaration of the dashboard's main scripts, by name.
export function topDecls(src) {
  const out = new Map();
  const re = /\n((?:async )?function ([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=)/g;
  let m;
  while ((m = re.exec(src))) { const name = m[2] || m[3]; (out.get(name) || out.set(name, []).get(name)).push(m.index + 1); }
  return out;
}
// Slice `seeds` plus every top-level declaration they reach (transitively), minus `stubs`; returns the source in file order.
export function closure(src, seeds, stubs = []) {
  // only the <script> block that declares the first seed (the page's main script): other blocks reuse short local names
  const at = src.indexOf(`\nfunction ${seeds[0]}(`), a = src.lastIndexOf('<script', at), b = src.indexOf('</script>', at);
  const decls = new Map([...topDecls(src)].map(([n, is]) => [n, is.find(i => i > a && i < b)]).filter(([, i]) => i != null));
  const skip = new Set(stubs), got = new Map(), todo = [...seeds];
  while (todo.length) {
    const n = todo.pop();
    if (got.has(n) || skip.has(n) || !decls.has(n)) continue;
    const body = declAt(src, decls.get(n));
    got.set(n, body);
    for (const id of new Set(body.match(/[A-Za-z_$][\w$]*/g) || [])) if (decls.has(id) && !got.has(id) && !skip.has(id)) todo.push(id);
  }
  return [...got.entries()].sort((a, b) => decls.get(a[0]) - decls.get(b[0])).map(e => e[1]).join('\n');
}
