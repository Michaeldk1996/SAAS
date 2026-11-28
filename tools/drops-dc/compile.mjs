// Compile the locked design template (Dropping Odds v2.dc.html, final 2026-11-27) into a string renderer.
// node tools/drops-dc/compile.mjs "<design_handoff_dropping_odds_final_2026-11-27>/site/Dropping Odds v2.dc.html" <out.js>
// The output is the f-view part of drops-page.js (dcDesk, dcDrawer, DC_HOVER_CSS); the handoff folder is not committed.
// - {{ a.b }} -> esc(v.a.b) (loop vars in scope); sc-for list/as -> map/join; sc-if value -> ternary
// - onClick/onMouseEnter/onMouseLeave/onMouseMove/onChange="{{ f }}" -> data-dc-<ev>="${H(f)}" (delegated in the page)
// - style-hover="css" -> a generated class .dxh<N>:hover { css !important }
// - every literal colour in markup -> var(--token) from COLOURS (an unmapped colour fails the build)
// - hint-* attributes dropped; elements with overflow:auto|scroll get data-dc-scroll (scroll kept across renders)
import fs from 'node:fs';
import { COLOURS, mapColours } from './colours.mjs';

const src = fs.readFileSync(process.argv[2], 'utf8');
let body = src.slice(src.indexOf('</helmet>') + 9, src.indexOf('</x-dc>'));
// Production bindings the sample file writes as literals (each replacement must hit exactly the stated count)
const cut = body.indexOf('<sc-if value="{{ drawerOpen }}"');
let desk = body.slice(0, cut), drw = body.slice(cut);
function sub(s, from, to, n) { const k = s.split(from).length - 1; if (k !== n) throw new Error(`"${from}" found ${k}x, expected ${n}`); return s.split(from).join(to); }
desk = sub(desk, '>Sharp · Pinnacle</span>', '>{{ r.shLbl }}</span>', 2);   // the sharp source: Pinnacle, else Bet105 (no margin)
desk = sub(desk, '<a data-doarchive href="Dropping Odds Archive.dc.html"', '<sc-if value="{{ hasArchive }}"><a data-doarchive href="{{ archiveHref }}" onClick="{{ openArchive }}"', 1);
desk = sub(desk, 'Biggest moves of the past days ›</a>', 'Biggest moves of the past days ›</a></sc-if>', 1);
desk = sub(desk, 'vs {{ r.oName }} · {{ r.ev }}', 'vs {{ r.oName }}{{ r.evSep }}', 2);   // no event (no board card): the segment is left out (drops.md)
desk = sub(desk, 'Prices that have shortened since they opened. Sharp and soft books are read separately.', 'Prices that have shortened since we first recorded them. Sharp and soft books are read separately.', 1);   // founder 2026-11-28
desk = sub(desk, '<div style="position:absolute; top:calc(100% + 6px); right:0; min-width:220px;', '<div data-dc-menu style="position:absolute; top:calc(100% + 6px); right:0; min-width:220px;', 1);
drw = sub(drw, '>Sharp · Pinnacle</span>', '>{{ dr.shLbl }}</span>', 1);
drw = sub(drw, '<a href="Match Analysis v2.dc.html"', '<a role="button" tabindex="0" onClick="{{ dr.openMA }}"', 1);
body = desk + drw;

// --- tokenizer ---
function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    if (s.startsWith('<!--', i)) { i = s.indexOf('-->', i) + 3; continue; }
    if (s[i] === '<' && /[a-zA-Z\/]/.test(s[i + 1] || '')) {
      let j = i + 1, q = null;
      for (; j < s.length; j++) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; }
      const raw = s.slice(i + 1, j); i = j + 1;
      if (raw[0] === '/') { out.push({ t: 'close', name: raw.slice(1).trim().toLowerCase() }); continue; }
      const selfClose = raw.endsWith('/');
      const m = /^([a-zA-Z][\w-]*)/.exec(raw); const name = m[1];
      const attrs = []; const re = /([\w:-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g; re.lastIndex = m[0].length; let a;
      while ((a = re.exec(raw.replace(/\/$/, '')))) attrs.push([a[1], a[2] ?? a[3] ?? null]);
      out.push({ t: 'open', name, lname: name.toLowerCase(), attrs, selfClose });
      continue;
    }
    let j = s.indexOf('<', i + 1); while (j >= 0 && !/[a-zA-Z\/!]/.test(s[j + 1] || '')) j = s.indexOf('<', j + 1);
    if (j < 0) j = s.length;
    out.push({ t: 'text', v: s.slice(i, j) }); i = j;
  }
  return out;
}
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr']);   // SVG shapes are closed in the file and must stay closed (HTML nests an unclosed one)
function parse(toks) {
  const root = { name: '#root', kids: [] }, st = [root];
  for (const k of toks) {
    const top = st[st.length - 1];
    if (k.t === 'text') top.kids.push({ text: k.v });
    else if (k.t === 'open') {
      const n = { name: k.name, lname: k.lname, attrs: k.attrs, kids: [] }; top.kids.push(n);
      if (!k.selfClose && !VOID.has(k.lname)) st.push(n);
    } else {
      if (VOID.has(k.name)) continue;
      let i = st.length - 1; while (i > 0 && st[i].lname !== k.name) i--;
      if (i > 0) st.length = i;
    }
  }
  return root;
}

// --- codegen ---
const hover = []; let hoverN = 0;
const EVS = { onclick: 'click', onmouseenter: 'enter', onmouseleave: 'leave', onmousemove: 'move', onchange: 'change' };
const expr = (s, scope) => s.trim().replace(/^\{\{\s*|\s*\}\}$/g, '').split('.').map((p, i) => (i === 0 && !scope.has(p) ? 'v.' + p : p)).join('.');
function interp(str, scope, escape = true) {
  // literal parts: colours mapped; holes: escaped values
  const parts = str.split(/(\{\{[^}]*\}\})/);
  return parts.map((p) => /^\{\{/.test(p) ? '${' + (escape ? 'E(' : '(') + expr(p, scope) + ')}' : mapColours(p).replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${')).join('');
}
function gen(n, scope) {
  if (n.text != null) return interp(n.text, scope);
  if (n.lname === 'sc-for') {
    const list = n.attrs.find((a) => a[0] === 'list')[1], as = n.attrs.find((a) => a[0] === 'as')[1];
    const s2 = new Set(scope); s2.add(as);
    return '${(' + expr(list, scope) + '||[]).map((' + as + ')=>`' + n.kids.map((k) => gen(k, s2)).join('') + '`).join(\'\')}';
  }
  if (n.lname === 'sc-if') {
    const val = n.attrs.find((a) => a[0] === 'value')[1];
    return '${' + expr(val, scope) + '?`' + n.kids.map((k) => gen(k, scope)).join('') + '`:\'\'}';
  }
  if (n.lname === 'dc-import') return '';
  let a = '', cls = '';
  // SVG paint attributes cannot read var(): a token (or a value hole) moves into the style
  const PAINT = new Set(['stroke', 'fill', 'stop-color']);
  const paint = n.attrs.filter(([k, val]) => PAINT.has(k.toLowerCase()) && val != null && (/\{\{/.test(val) || /var\(/.test(mapColours(val))));
  if (paint.length) {
    const extra = paint.map(([k, val]) => k + ':' + val).join('; ');
    const st = n.attrs.find(([k]) => k.toLowerCase() === 'style');
    if (st) st[1] = st[1].replace(/;?\s*$/, '; ') + extra; else n.attrs.push(['style', extra]);
    n.attrs = n.attrs.filter((x) => !paint.includes(x));
  }
  for (const [k, val] of n.attrs) {
    const lk = k.toLowerCase();
    if (lk.startsWith('hint-')) continue;
    if (EVS[lk]) { a += ` data-dc-${EVS[lk]}="\${H(${expr(val, scope)})}"`; continue; }
    if (lk === 'style-hover') { const c = 'dxh' + (++hoverN); hover.push(`.${c}:hover{${mapColours(val).split(';').filter((x) => x.trim()).map((x) => x.trim() + ' !important').join(';')}}`); cls += ' ' + c; continue; }
    if (val == null) { a += ' ' + k; continue; }
    if (lk === 'style' && /overflow(-y)?:\s*(auto|scroll)/.test(val)) a += ' data-dc-scroll';
    a += ` ${k}="${interp(val, scope)}"`;
  }
  if (cls) a += ` class="${cls.trim()}"`;
  const open = `<${n.name}${a}>`;
  if (VOID.has(n.lname)) return open;
  return open + n.kids.map((k) => gen(k, scope)).join('') + `</${n.name}>`;
}
const root = parse(tokenize(body));
const top = root.kids.find((k) => k.name === 'div');
// named blocks: the sc-if branches under the root div
const blocks = {};
for (const k of top.kids) if (k.lname === 'sc-if') blocks[k.attrs.find((a) => a[0] === 'value')[1].replace(/[{} ]/g, '')] = k;
const fn = (name, nodes) => `  function ${name}(v, H, E) { return \`${nodes.map((k) => gen(k, new Set())).join('')}\`; }\n`;
// desktop: the inner column of <main>; mobile: the whole branch; drawer: the whole branch
const main = blocks.isDesk.kids.find((k) => k.name === 'main');
const col = main.kids.find((k) => k.name === 'div');
let out = '  // ─── generated by tools/drops-dc/compile.mjs from the locked design template — do not edit by hand ───\n';
out += fn('dcDesk', [col]);
// mobile: unchanged in the final days (README §7) — the v2 phone layout stays
out += fn('dcDrawer', blocks.drawerOpen.kids);
out += '  var DC_HOVER_CSS = ' + JSON.stringify(hover.join('\n')) + ';\n';
fs.writeFileSync(process.argv[3], out);
console.log('ok', Object.keys(blocks).join(','), 'hover', hoverN, 'bytes', out.length);
