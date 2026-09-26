// TEN-285 recolour engine. Replayable: run against a fresh checkout of the
// listed files, it rewrites every colour literal whose role maps onto a 12a
// token and leaves the rest untouched (reported as unmapped).
//
//   node tools/theme-12a/recolour.mjs <repoRoot> [--write] [--report <dir>]
//
// IDEMPOTENT (TEN-286): a literal that already equals a 12a token value is final, and a
// definition of a 12a token (`--text:#EBF1F2`) is never re-mapped — so a run over its own
// output changes nothing. Before this rule a second pass re-mapped 266 lines (e.g. surface-inner
// -> surface, and `--text:#EBF1F2` -> `--text:var(--text)`, a self-reference).
// Locked by test-ten286-layout.mjs (two runs over the shipped files: zero edits each).
import fs from 'node:fs';
import { TOKENS } from './tokens.mjs';

const ROOT = process.argv[2];
const WRITE = process.argv.includes('--write');
export const FILES = ['bsp-consult-dashboard.html', 'player-profile-v2.js', 'live-tab.js', 'trading-report.js',
  'holdbreak-heatmap.js', 'series.js', 'series.css', 'price-history-box.js', 'kibl-now-stream.js', 'account.html'];

const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![-\w])|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+%?\s*)?\)/g;

export function parse(c) {
  c = c.toLowerCase().replace(/\s+/g, '');
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : 1, hex: true };
  }
  const m = c.match(/rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+%?))?\)/);
  const a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a, hex: false };
}
export const normKey = (p) => (p.a === 1 ? `rgb(${p.r},${p.g},${p.b})` : `rgba(${p.r},${p.g},${p.b},${p.a})`);
const TOKEN_VALUES = new Set(Object.values(TOKENS).filter(v => v !== 'transparent').map(v => normKey(parse(v))));

function hsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === R) h = ((G - B) / d) % 6; else if (mx === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, chroma: Math.max(r, g, b) - Math.min(r, g, b), mean: (r + g + b) / 3, max: Math.max(r, g, b) };
}

// ---- explicit variable-definition map (old design-system vars -> 12a) ----
export const VAR_MAP = {
  'bg': 'page', 'panel': 'surface', 'panel-2': 'surface-inner', 'border': 'line', 'header-bg': 'surface',
  'text': 'text', 'text-dim': 'text-sub', 'text-faint': 'label',
  'accent': 'periwinkle', 'accent-dim': 'navy', 'accent-hover': 'periwinkle',
  'court-clay': 'clay', 'court-grass': 'grass', 'court-hard': 'hard',
  'value-pos': 'positive', 'value-neg': 'negative',
  'mx-bg-input': 'input', 'mx-bg-table': 'surface', 'mx-hairline': 'line', 'mx-hairline-soft': 'line-soft',
  'mx-text-primary': 'text', 'mx-text-secondary': 'label', 'mx-text-tertiary': 'label', 'mx-text-faint': 'label',
  'mx-brand-blue': 'periwinkle', 'mx-brand-blue-text': 'periwinkle', 'mx-accent-green': 'positive',
  'mx-fav-odds': 'text', 'mx-dog-odds': 'text-soft',
  'mc-card': 'surface', 'mc-border-data': 'line', 'mc-border-subtle': 'line', 'mc-border-hover': 'line-open',
  'mc-text': 'text', 'mc-muted': 'label', 'mc-muted-2': 'label', 'mc-brand': 'periwinkle', 'mc-brand-deep': 'blue-ring',
  'mc-brand-wash': 'navy', 'mc-brand-tint': 'avatar', 'mc-player-a': 'periwinkle', 'mc-player-b': 'text-soft',
  'mc-pos': 'positive', 'mc-neg': 'negative', 'mc-hard': 'hard', 'mc-clay': 'clay', 'mc-grass': 'grass',
  'mc-comma-faint': 'label', 'mc-track': 'surface-inner',
  'sf-page': 'page', 'sf-sidebar': 'nav-panel', 'sf-card': 'surface', 'sf-border-subtle': 'line', 'sf-border-data': 'line',
  'sf-brand': 'periwinkle', 'sf-brand-tint': 'navy', 'sf-brand-wash': 'nav-hover', 'sf-text': 'text', 'sf-text-strong': 'text',
  'sf-text-3': 'nav-idle', 'sf-muted': 'label', 'sf-muted-2': 'label', 'sf-pos': 'positive',
  'db-fill': 'input', 'db-strip': 'surface-inner', 'db-surface': 'surface', 'db-bd': 'line', 'db-bd2': 'line',
  'db-txt': 'text', 'db-ctl': 'text-soft', 'db-emph': 'text-sub', 'db-sec': 'text-sub', 'db-mute': 'label', 'db-faint': 'label',
  'db-acc': 'periwinkle', 'db-pos': 'positive', 'db-neg': 'negative',
  'lt-p1': 'periwinkle',
  // deliberately unmapped (no token home, reported): court-*-dim, mx-accent-form, mc-warn, mc-pos-bg/bd,
  // mc-neg-bg/bd, db-seam, lt-p2
};

const POPUP_SEL = /modal|drawer|sheet|overlay|popover|dropdown|ddpanel|menu\b|-menu|mktlist|results|tip\b|-tip|tip-pop|elotip|hbtip|lvtip|tptip|searchlist|tzlist|suggest|listbox|-pop\b|sticky/i;
const TRACK_SEL = /track|bar-bg|meter-bg/i;
const BAR_SEL = /(^|[\s.>_-])(bar|bars|fill|prob|form|progress|meter|spark)/i;
const HOVER_SEL = /:hover|:focus/i;
const ACTIVE_SEL = /\.active|\.on\b|\.is-on|\.sel|selected|aria-selected|\.is-active|checked/i;
const SIDE_PROP = /^border-(top|right|bottom|left)(-color)?$/i;

function propClass(p) {
  p = (p || '').toLowerCase();
  if (p.startsWith('--')) return 'var';
  if (p === 'color' || p === '-webkit-text-fill-color' || p === 'caret-color' || p === 'text-decoration-color') return 'text';
  if (p === 'background' || p === 'background-color' || p === 'bg' || p === 'background-image') return 'bg';
  if (/^(border|outline|column-rule)/.test(p) || p === 'scrollbar-color') return 'line';
  if (p === 'fill' || p === 'flood-color') return 'fill';
  if (p === 'stroke') return 'stroke';
  if (/shadow/.test(p)) return 'shadow';
  if (p === 'stop-color' || p === 'gradient') return 'gradient';
  // JS variable / object-key names that say what the colour paints
  if (/(^|[a-z])(bg|back|background|chipbg|fillbg)$/i.test(p) || /^bg/i.test(p)) return 'bg';
  if (/(^|[a-z])(bd|bdr|border|rowbd|chipbd)$/i.test(p) || /^(bd|border)/i.test(p)) return 'line';
  return 'key:' + p;
}

function lastCompound(sel) {
  const first = sel.split(',').map((x) => x.trim()).filter(Boolean);
  return first.map((x) => x.split(/[\s>+~]+/).filter(Boolean).pop() || '').join(' ');
}
// Returns { token } or { skip: reason }
export function mapColour(lit, prop, sel, mode, body = '') {
  const p = parse(lit);
  if (TOKEN_VALUES.has(normKey(p))) return { skip: 'already-token' };
  const { h, chroma, mean, max } = hsl(p);
  const pc = propClass(prop);
  const s = sel || '';
  const key = pc.startsWith('key:') ? pc.slice(4) : '';

  if (pc === 'var') {
    const name = prop.slice(2);
    if (Object.prototype.hasOwnProperty.call(TOKENS, name)) return { skip: 'token-definition' };
    if (VAR_MAP[name]) return { token: VAR_MAP[name] };
    return { skip: 'var-unmapped' };
  }
  if (pc === 'shadow' || pc === 'gradient') return { skip: pc };

  const white = p.r >= 240 && p.g >= 240 && p.b >= 240;
  const blackA = p.a < 1 && max <= 14;
  const grey = !white && (hsl(p).mean < 42 ? (chroma <= 8 || (chroma <= 18 && h >= 200 && h <= 240)) : chroma <= 60);
  const blue = chroma > 60 && h >= 195 && h <= 240;
  const green = chroma > 60 && h >= 115 && h < 165;
  const teal = chroma > 60 && h >= 165 && h < 195;
  const red = chroma > 60 && (h >= 340 || h < 12);
  const amber = chroma > 60 && h >= 12 && h < 60;

  // semantic JS keys (surface maps, pos/neg maps) decide first
  if (key) {
    if (/^(hard)$/i.test(key)) return { token: 'hard' };
    if (/^(clay)$/i.test(key)) return { token: 'clay' };
    if (/^(grass)$/i.test(key)) return { token: 'grass' };
  }
  const tAlpha = (tok) => ({ token: tok });

  if (white) {
    if (p.a === 1) {
      if (pc === 'text' || /^(c|col|colour|color|fg|ink|txt|text)$/i.test(key)) return tAlpha('text');
      // value / dash colours handed to helpers (tile(), valueColor, DASH_COLOUR) are text ink;
      // a tick drawn with borders (::after) and a toggle knob are ink too (TEN-285 live audit)
      if (mode === 'js' && (pc === 'key:' || /valuecolor|dash_colour|colour|line-height/i.test(key))) return tAlpha('text');
      if (mode === 'css' && pc === 'line' && /::after|::before/.test(s)) return tAlpha('text');
      if (mode === 'css' && pc === 'bg' && /\.knob\b/.test(s)) return tAlpha('text');
      return { skip: 'white-solid-' + pc };
    }
    if (pc === 'line') {
      if (SIDE_PROP.test(prop)) return tAlpha('line-soft');
      if (p.a >= 0.2 || HOVER_SEL.test(s)) return tAlpha('line-open');
      return tAlpha('line');
    }
    if (pc === 'bg') {
      if (HOVER_SEL.test(s)) return tAlpha('nav-hover');
      // small round markers (dots) painted with a wash are data marks -> left for the (b) list
      if (/border-radius:\s*50%/.test(body) && /(width|height):\s*(\$\{[^}]*'(\d|10)px'|[1-9]px|10px)/.test(body) && !/width:\s*1px/.test(body)) return { skip: 'white-alpha-marker' };
      if (TRACK_SEL.test(s)) return tAlpha('bar-track');
      // a wash whose child fill is sized `width:${…}` / `width:' + … is a bar track (JS-built bars)
      if (mode === 'js' && /background:\s*$/.test(body.slice(0, body.indexOf(lit) >= 0 ? body.indexOf(lit) : 0)) && /height:\s*[1-9]px[^>]*>\s*<span[^>]*width:\s*(\$\{|' ?\+)/.test(body)) return tAlpha('bar-track');
      // a 1px-wide / 1px-tall element painted with a wash IS a divider rule
      if (/(^|[;{\s"'])(width|height)\s*:\s*(1|0\.5|0\.33)px/.test(body || s) || /(^|[\s.-])(rule|divider|hairline|sep)\b/i.test(lastCompound(s))) return tAlpha('line-soft');
      if (p.a <= 0.1) return tAlpha('surface-inner');
      return { skip: 'white-alpha-bg>0.1' };
    }
    return { skip: 'white-alpha-' + pc };
  }
  if (blackA) {
    if (pc === 'bg' && /position:\s*sticky/.test(body + s)) return tAlpha('popup');
    if (pc === 'bg' && p.a >= 0.5 && /position:\s*fixed|inset:\s*0|overlay|scrim|backdrop|modal/i.test(body + ' ' + s)) return tAlpha('backdrop');
    return { skip: 'black-alpha-' + pc };
  }
  if (p.a < 1) {
    // tinted alphas
    if (blue) {
      if (pc === 'bg') {
        if (HOVER_SEL.test(s)) return tAlpha('nav-hover');
        // a width-sized fill inside a bar is the bar itself, not a selection
        if (mode === 'js') { const pre = body.slice(0, Math.max(0, body.lastIndexOf(lit))); const tag = pre.slice(pre.lastIndexOf('<')); if (/width:\s*(\$\{|' ?\+)/.test(tag)) return tAlpha('periwinkle'); }
        if (p.a >= 0.1) return tAlpha('seg-active');
        return tAlpha('nav-hover');
      }
      if (pc === 'line') {
        if (HOVER_SEL.test(s)) return tAlpha('line-open');
        if (p.a >= 0.3 || ACTIVE_SEL.test(s)) return tAlpha('seg-active-line');
        return tAlpha('line-open');
      }
      return { skip: 'blue-alpha-' + pc };
    }
    if (grey && pc === 'line') return tAlpha(SIDE_PROP.test(prop) ? 'line-soft' : 'line');
    return { skip: 'tint-alpha-' + pc };
  }
  // solid colours
  if (grey) {
    if (pc === 'bg' || (key && /bg|back|surface|panel|card/i.test(key))) {
      if (mean < 42) {
        if (TRACK_SEL.test(s)) return tAlpha('bar-track');
        if (/sf-sidebar/.test(s)) return tAlpha('nav-panel');
        if (mode === 'js' && /position:\s*sticky/.test(s)) return tAlpha(/top:\s*0/.test(s) ? 'popup' : 'surface');
        if (mode === 'css' && POPUP_SEL.test(lastCompound(s))) return tAlpha('popup');
        if (mode === 'css' && /(^|[\s,])(html|body)\b|tabpage|^\[data-page="[a-z-]+"\]\s*$|:root/.test(lastCompound(s) + ' ' + s.trim())) return tAlpha('page');
        if (mean <= 9) return tAlpha('surface-inner');   // near-black inset (rows, wells) inside a box
        if (mean <= 12.5 && (p.r + p.g + p.b) < 36) return tAlpha('surface-inner');
        return tAlpha('surface');
      }
      if (/\.msig-bar\s*$/.test(s.trim())) return tAlpha('bar-track');   // Market Signal bar track (HANDOFF §1)
      return { skip: 'grey-mid-bg' };
    }
    if (pc === 'line') {
      if (mean < 30) return tAlpha('surface');           // cut-out ring in the card colour
      if (mean >= 90) {                                   // a solid marker/legend line, not a hairline
        if (mean >= 215) return tAlpha('text'); if (mean >= 190) return tAlpha('text-soft');
        if (mean >= 135) return tAlpha('text-sub'); return tAlpha('label');
      }
      return tAlpha(SIDE_PROP.test(prop) ? 'line-soft' : 'line');
    }
    // dark fills/strokes inside charts are knock-outs in the card colour
    if (mean < 42 && (pc === 'fill' || pc === 'stroke')) return tAlpha('surface');
    if (pc === 'text' || pc === 'fill' || pc === 'stroke' || pc.startsWith('key:')) {
      if (mean < 42) return tAlpha(pc === 'text' ? 'page' : 'surface');   // dark ink on a coloured pill = page (as the Upgrade button)
      if (mean >= 215) return tAlpha('text');
      if (mean >= 190) return tAlpha('text-soft');
      if (mean >= 135) return tAlpha('text-sub');
      return tAlpha('label');
    }
    return { skip: 'grey-' + pc };
  }
  if (blue) {
    if (mean < 90) {
      if (pc === 'bg') return tAlpha('navy');
      if (pc === 'line') return tAlpha('royal');
      return { skip: 'dark-blue-' + pc };
    }
    return tAlpha('periwinkle');
  }
  if (green) return tAlpha('positive');
  if (red) return tAlpha('negative');
  if (teal && (/grass/i.test(s) || /grass/i.test(key))) return tAlpha('grass');
  if (amber && (/clay/i.test(s) || /clay/i.test(key))) return tAlpha('clay');
  return { skip: (teal ? 'teal' : amber ? 'amber' : 'hue') + '-' + pc };
}

// ---------- context detection ----------
function cssRanges(file, src) {
  if (file.endsWith('.css')) return [[0, src.length]];
  if (file.endsWith('.js')) return [];
  const out = []; const re = /<style[^>]*>([\s\S]*?)<\/style>/g; let m;
  while ((m = re.exec(src))) out.push([m.index, m.index + m[0].length]);
  return out;
}
function propAt(src, i) {
  const pre = src.slice(Math.max(0, i - 400), i);
  // inside a gradient / shadow function?
  const lastDecl = pre.slice(Math.max(pre.lastIndexOf(';'), pre.lastIndexOf('{'), pre.lastIndexOf('}')) + 1);
  if (/gradient\(/i.test(lastDecl) && (lastDecl.match(/\(/g) || []).length > (lastDecl.match(/\)/g) || []).length) return 'gradient';
  if (/(box|text)-shadow\s*:|boxShadow\s*=|drop-shadow\(/i.test(lastDecl)) return 'box-shadow';
  if (/stop-color\s*=\s*["']?$|stop-color\s*:\s*$/i.test(pre)) return 'stop-color';
  // style="prop:${cond ? '#a' : '#b'}" — the property sits before the ${ interpolation
  const interp = pre.match(/((?:--)?[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*[^;:{}"'`]*\$\{[^{}]*$/);
  if (interp) return interp[1];
  let cut = -1;
  for (const ch of [';', '{', '}', '"', "'", '`', '\n', '(', ',']) cut = Math.max(cut, pre.lastIndexOf(ch));
  let rest = pre.slice(cut + 1);
  let m = rest.match(/((?:--)?[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*[^:]*$/);
  if (m) return m[1];
  // key:'#fff' / attr="#fff" / key = '#fff'
  const before = pre.slice(0, cut + 1);
  m = before.match(/([A-Za-z_$][\w$-]*)\s*[:=]\s*\(?\s*["'`]?$/);
  if (m) return m[1];
  // 'background:' + (on ? 'rgba(..)' : '#x')  (string-concatenated inline styles)
  {
    const mc = pre.slice(-260).match(/['"]((?:--)?[a-zA-Z][a-zA-Z0-9-]*)\s*:[^'"]*['"]\s*\+\s*\((?:[^'"()]|'[^']*'|"[^"]*")*['"]$/);
    if (mc) return mc[1];
  }
  // ternaries / assignments: bg: on ? 'rgba(..)' : '#x'  |  const bd = on ? '…' : '
  {
    const s2 = pre.slice(-220).replace(/'[^'\n]*'|"[^"\n]*"/g, '\u0001');
    const mm = s2.match(/([A-Za-z_$][\w$-]*)\s*(?:=(?!=)|:)\s*[^;{}=,]*$/);
    if (mm && /\?/.test(s2.slice(s2.lastIndexOf(mm[0])))) return mm[1];
  }
  // style="...; prop: X" split by ( or , inside function e.g. var(--x, #fff)
  m = pre.match(/((?:--)?[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*[^;:{}"'`]*$/);
  if (m) return m[1];
  return '';
}
function selectorAt(src, i, inCss) {
  if (inCss) {
    const open = src.lastIndexOf('{', i);
    const prevClose = Math.max(src.lastIndexOf('}', open), src.lastIndexOf('>', open) > open - 1 ? -1 : -1);
    let sel = src.slice(Math.max(prevClose, src.lastIndexOf('}', open)) + 1, open);
    sel = sel.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    return sel.slice(-200);
  }
  // JS/markup: nearest class=/className/ id= in the preceding 300 chars + the line
  const pre = src.slice(Math.max(0, i - 300), i);
  const cls = [...pre.matchAll(/class(?:Name)?=["'`]([^"'`]+)["'`]|id=["']([^"']+)["']|\.([a-z][\w-]{2,})\b/gi)].map((m) => m[1] || m[2] || m[3]);
  const lineStart = src.lastIndexOf('\n', i) + 1;
  return (cls.slice(-3).join(' ') + ' | ' + src.slice(lineStart, i).slice(-120)).trim();
}
export function commentRanges(file, src) {
  const out = []; let m;
  const re = file.endsWith('.js') ? /\/\*[\s\S]*?\*\//g : /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g;
  while ((m = re.exec(src))) {
    // A `/*` inside a `//` comment or inside an open string is NOT a comment opener
    // (`odds-archive/*.csv` in a // comment once swallowed 18 KB of live JS, TEN-285).
    if (m[0].startsWith('/*')) {
      const ls = src.lastIndexOf('\n', m.index) + 1, pre = src.slice(ls, m.index);
      const quotes = (q) => (pre.replace(/\\./g, '').split(q).length - 1) % 2 === 1;
      const inLineComment = /(^|[^:'"`\\])\/\//.test(pre) && !quotes("'") && !quotes('"');
      if (inLineComment || quotes("'") || quotes('"') || quotes('`')) { re.lastIndex = m.index + 2; continue; }
    }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}
function inRanges(r, i) { return r.some(([a, b]) => i >= a && i < b); }
function isSvgAttr(src, i) {
  const pre = src.slice(Math.max(0, i - 30), i);
  return /\b(fill|stroke|stop-color|flood-color)\s*=\s*["'`]?\$?\{?[^"'`]*$/.test(pre) && !/style\s*=/.test(pre);
}

const LINE_TOKENS = new Set(['line', 'line-soft', 'line-panel', 'line-open', 'line-avatar', 'seg-active-line', 'royal']);
// retired (pre-12a) variable names only: a 1px border already on a 12a token (--line*, --seg-active-line,
// --royal) is final — the design draws some rules at 1px on purpose (e.g. the Market Signal section rule).
const VAR_HAIRLINE_RE = /(^|[^\d.])1px(\s+(?:solid|dashed|dotted)\s+var\(--(?:border|mc-border-(?:data|subtle|hover)|sf-border-(?:data|subtle)|mx-hairline(?:-soft)?|db-bd2?)\b)/g;
// Data-visualisation cells the brief lists under (b) — heatmap cells keep their
// colours untouched and are reported, never re-toned.
const DATAVIZ_ZONES = {
  'holdbreak-heatmap.js': [['', null]],                                  // the whole cell engine
  'player-profile-v2.js': [['var HB_FAINT =', 'function hbSegHtml(']],   // hbCellHtml + hbGlobalCellHtml
};
function zones(file, src) {
  return (DATAVIZ_ZONES[file] || []).map(([a, b]) => {
    const s0 = a ? src.indexOf(a) : 0;
    if (s0 < 0) throw new Error(`dataviz anchor missing in ${file}: ${a}`);
    const e0 = b ? src.indexOf(b, s0) : src.length;
    if (e0 < 0) throw new Error(`dataviz end anchor missing in ${file}: ${b}`);
    return [s0, e0];
  });
}
export function recolourFile(file, src) {
  const css = cssRanges(file, src);
  const dz = zones(file, src);
  const comments = commentRanges(file, src);
  const hits = []; const edits = [];
  let out = ''; let last = 0; let m;
  COLOR_RE.lastIndex = 0;
  while ((m = COLOR_RE.exec(src))) {
    const i = m.index; const lit = m[0];
    // skip ids / anchors that look hex-ish: e.g. "#fad" in selectors or url fragments
    const prevCh = src[i - 1] || '';
    if (lit[0] === '#' && /[\w&-]/.test(prevCh)) continue;
    if (lit[0] === '#' && /url\(\s*['"]?$/.test(src.slice(Math.max(0, i - 8), i))) continue;
    const inCss = inRanges(css, i);
    // skip hex-looking tokens in CSS selectors (e.g. #add in an id selector)
    if (inCss && lit[0] === '#') {
      const nextBrace = src.indexOf('{', i), nextSemi = src.indexOf(';', i), nextClose = src.indexOf('}', i);
      if (nextBrace !== -1 && nextBrace < Math.min(nextSemi === -1 ? 1e12 : nextSemi, nextClose === -1 ? 1e12 : nextClose)) continue;
    }
    // skip HTML comments / JS comments
    const lineStart = src.lastIndexOf('\n', i) + 1;
    const lineTo = src.slice(lineStart, i);
    if (inRanges(comments, i)) continue;
    if (inRanges(dz, i)) { hits.push({ file, off: i, line: src.slice(0, i).split('\n').length, lit, key: normKey(parse(lit)), prop: '', sel: 'heatmap cell', mode: 'js', token: null, skip: 'dataviz-heatmap-cell' }); continue; }
    if (!inCss && /(^|[\s;{}])\/\/[^'"`]*$/.test(lineTo) && ((lineTo.split('//')[0].match(/['"`]/g) || []).length % 2 === 0)) continue;
    const prop = propAt(src, i);
    const sel = selectorAt(src, i, inCss);
    let body = '';
    if (inCss) { const o = src.lastIndexOf('{', i), c = src.indexOf('}', i); body = src.slice(o + 1, c === -1 ? i : c); }
    else { const l0 = src.lastIndexOf('\n', i); const ls = src.lastIndexOf('\n', l0 - 1) + 1, le = src.indexOf('\n', i); body = src.slice(Math.max(ls, i - 200), le === -1 ? src.length : Math.min(le, i + 120)); }
    const r = mapColour(lit, prop, sel, inCss ? 'css' : 'js', body);
    const p = parse(lit);
    let rep = null;
    if (r.token) {
      const tv = TOKENS[r.token];
      if (inCss) rep = `var(--${r.token})`;
      else {
        // JS / markup: literal value. Never turn a hex into an rgba/transparent in JS
        // (hexA()/`${c}38` concatenation would break) — report instead.
        if (p.hex && !tv.startsWith('#')) { rep = null; r.skip = 'js-hex-to-rgba:' + r.token; delete r.token; }
        else rep = tv.startsWith('#') ? tv.toLowerCase() : tv;   // hex is case-insensitive; the repo writes lowercase
      }
    }
    hits.push({ file, off: i, line: src.slice(0, i).split('\n').length, lit, key: normKey(p), prop, sel: sel.slice(0, 140), mode: inCss ? 'css' : 'js', token: r.token || null, skip: r.skip || null });
    if (rep) {
      let seg = src.slice(last, i);
      // hairline weight: `1px solid <line colour>` -> 0.33px (HANDOFF §1 Lines)
      let k = -1;
      if (LINE_TOKENS.has(r.token)) {
        const direct = /(^|[^\d.])1px(\s+(?:solid|dashed|dotted)\s*)$/.exec(seg);
        if (direct) k = last + direct.index + direct[1].length;
        else {
          // concatenated / interpolated: 'border:1px solid ' + (on ? '<colour>' : …)
          const back = src.slice(Math.max(last, i - 90), i);
          const mm2 = [...back.matchAll(/(?:border(?:-[a-z]+)?|outline)\s*:\s*(1px)\s+(?:solid|dashed|dotted)\b/g)].pop();
          if (mm2 && !/;/.test(back.slice(mm2.index))) k = Math.max(last, i - 90) + mm2.index + mm2[0].indexOf('1px');
        }
      }
      if (k >= last) { seg = seg.slice(0, k - last) + '0.33px' + seg.slice(k - last + 3); edits.push([k, k + 3, '0.33px']); }
      edits.push([i, i + lit.length, rep]);
      out += seg + rep; last = i + lit.length;
    }
  }
  out += src.slice(last);
  out = out.replace(VAR_HAIRLINE_RE, '$10.33px$2');
  // var-hairlines, recorded against the ORIGINAL offsets
  let mm; const re2 = new RegExp(VAR_HAIRLINE_RE.source, 'g');
  while ((mm = re2.exec(src))) { const k = mm.index + mm[1].length; edits.push([k, k + 3, '0.33px']); }
  return { out, hits, edits };
}

if (ROOT && import.meta.url === 'file://' + process.argv[1]) {
  const all = []; const allEdits = {};
  for (const f of FILES) {
    const path = `${ROOT}/${f}`;
    if (!fs.existsSync(path)) continue;
    const src = fs.readFileSync(path, 'utf8');
    const { out, hits, edits } = recolourFile(f, src);
    all.push(...hits);
    allEdits[f] = edits;
    if (WRITE) fs.writeFileSync(path, out);
  }
  const ri = process.argv.indexOf('--report');
  if (ri > 0) {
    const dir = process.argv[ri + 1]; fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/recolour-hits.json`, JSON.stringify(all));
    fs.writeFileSync(`${dir}/recolour-edits.json`, JSON.stringify(allEdits));
  }
  const edited = Object.values(allEdits).reduce((n, e) => n + e.length, 0);
  console.log(`edits ${edited}`);
  const mapped = all.filter((h) => h.token).length;
  console.log(`literals ${all.length} mapped ${mapped} unmapped ${all.length - mapped}`);
}
