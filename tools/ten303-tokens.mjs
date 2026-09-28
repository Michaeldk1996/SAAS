// TEN-314 (TEN-312 D1) — the Match analysis modal's ONE colour file, read the way the browser reads it.
// Shared by test-ten303-colours.mjs and test-ten304-weather-tab.mjs:
//   tokens(theme)            every custom property the token file sets on `.ma-theme` (Night) or with the Day override
//   resolve(value, theme)    a colour value as the modal renders it: var() chains and
//                            `color-mix(in srgb, <c> p%, transparent)` resolved to #RRGGBB / RGBA(r,g,b,a) (upper case)
//   modalLiterals(html)      every hex / rgb(a) literal in the modal's code: the top-level declarations reachable from
//                            the modal's entry points (the reach.py walk of TEN-314 phase 1) + every <style> rule whose
//                            selector targets the modal. `transparent` / `currentColor` are not literals.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TOKEN_CSS = readFileSync(process.env.TEN314_TOKENS || join(HERE, 'match-analysis-tokens.css'), 'utf8');

function block(css, selector) {
  const at = css.indexOf(selector + '{');
  if (at < 0) throw new Error('token block missing: ' + selector);
  let d = 0, i = css.indexOf('{', at);
  for (; i < css.length; i++) { if (css[i] === '{') d++; else if (css[i] === '}' && --d === 0) break; }
  return css.slice(css.indexOf('{', at) + 1, i).replace(/\/\*[\s\S]*?\*\//g, '');
}
function props(body) {
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
export function tokens(theme = 'night', css = TOKEN_CSS) {
  const night = props(block(css, '.ma-theme'));
  return theme === 'day' ? Object.assign({}, night, props(block(css, '.ma-theme[data-ma-theme="day"]'))) : night;
}

const up = s => String(s).replace(/\s+/g, '').toUpperCase();
function rgba(v) {           // '#RRGGBB' | 'rgba(r,g,b,a)' -> [r,g,b,a]
  const s = up(v);
  let m = /^#([0-9A-F]{6})$/.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^RGBA?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  return null;
}
function fmt(c) {
  if (c[3] === 1) return '#' + c.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `RGBA(${c[0]},${c[1]},${c[2]},${+c[3].toFixed(4)})`;
}
// A value as the modal paints it. Non-colour values (a shadow, a gradient) come back with their var()s substituted.
export function resolve(value, theme = 'night', T = tokens(theme), depth = 0) {
  if (depth > 20) throw new Error('var() cycle at ' + value);
  let v = String(value).trim();
  v = v.replace(/var\(--([\w-]+)\)/g, (_, n) => {
    if (!(n in T)) throw new Error(`--${n} is not set by the token file`);
    return resolve(T[n], theme, T, depth + 1);
  });
  v = v.replace(/color-mix\(in srgb,\s*([^%]+?)\s+([\d.]+)%\s*,\s*transparent\)/g, (all, c, p) => {
    const x = rgba(c); if (!x) throw new Error('color-mix of a non-colour: ' + all);
    return fmt([x[0], x[1], x[2], x[3] * p / 100]);
  });
  const c = rgba(v);
  return c ? fmt(c) : v;
}

// ---- the grep: no literal colour in the modal's code ----
const COL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const ROOTS = ['openAnalysisModal', 'A_TAB_BUILD', 'A_TAB_REVISIT', 'aShowTab', 'aBuildForReport', 'printAnalysisReport'];
// the modal's exits to other surfaces (the player profile, the Edge model, the board) are not the modal
const EXITS = ['openPlayerProfileFromMatch', 'showPlayerProfile', 'openEdgeModelFromMatch', 'openEdgeModel', 'render',
  'loadPointsAtRisk', 'renderNews', 'loadAsapSignals', '_mcNowPair'];
export function modalDecls(html) {
  const lines = html.split('\n'), starts = [];
  let inScript = false;
  lines.forEach((l, i) => {
    if (/<script(?![^>]*src)[^>]*>/.test(l)) inScript = true;
    if (l.includes('</script>')) inScript = false;
    const m = inScript && /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
    if (m) starts.push([m[1] || m[2], i + 1]);
  });
  const by = new Map();
  starts.forEach(([n, s], k) => { const e = k + 1 < starts.length ? starts[k + 1][1] - 1 : lines.length; if (!by.has(n)) by.set(n, []); by.get(n).push([n, s, e]); });
  const body = d => lines.slice(d[1] - 1, d[2]).join('\n');
  const seen = new Set(ROOTS), q = [...ROOTS];
  while (q.length) {
    const n = q.shift();
    for (const d of by.get(n) || []) for (const tok of new Set(body(d).match(/[A-Za-z_$][\w$]*/g))) {
      if (by.has(tok) && !seen.has(tok) && !EXITS.includes(tok)) { seen.add(tok); q.push(tok); }
    }
  }
  return { lines, decls: [...seen].flatMap(n => by.get(n) || []) };
}
const MODAL_SEL = /\.modal-analysis|#analysisModal|#aSection|#fhSheet|#mePop|#aoddsTip|\.aox-|\.wx-|\.me-|\.atourn|\.yr-|\.tprogress|\.aodds|\.akeycard|\.arr-badge|\.psx-|\.alivebar/;
export function modalLiterals(html) {
  const out = [];
  const { lines, decls } = modalDecls(html);
  for (const d of decls) for (let ln = d[1]; ln <= d[2]; ln++) {
    const L = lines[ln - 1];
    for (const m of L.matchAll(COL)) {
      if (m[0][0] === '#' && /[\w&-]/.test(L[m.index - 1] || '')) continue;   // an id / entity, not a colour
      out.push({ where: d[0], line: ln, lit: m[0] });
    }
  }
  for (const sm of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = sm[1].replace(/\/\*[\s\S]*?\*\//g, c => ' '.repeat(c.length));
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = r[1].trim();
      if (!MODAL_SEL.test(sel)) continue;
      for (const m of r[2].matchAll(COL)) out.push({ where: sel.slice(0, 80), line: html.slice(0, sm.index).split('\n').length, lit: m[0] });
    }
  }
  return out;
}
