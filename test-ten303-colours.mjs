// TEN-303 follow-up (founder, 2026-09-27, comment 2b0ef96f) — the Match analysis modal on the Odds tab matches
// the DESIGN EXPORT's colours, not the 12a re-tone. Locks:
//   1. every Odds-tab colour token equals the value in `Odds Tab - Spec.md` ("Colour tokens used on this tab"),
//      read from the spec file itself (mutant: a value mapped through 12a again, e.g. text #EBF1F2);
//   2. the RENDERED nav-selected background (the last rule the cascade applies) is the design hex #171D2F, and the
//      modal surface is the design's #0B0C13 (mutant: the 12a --seg-active / --popup rule back on top);
//   3. the 12a engine leaves both design-verbatim zones alone (mutant: the DESIGN_ZONES exemption removed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, constSrc } from './tools/ten303-odds-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(process.env.TEN303_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');   // mutant runner: a mutated copy
const SPEC = readFileSync(join(HERE, 'design/handoff-15-odds-tab/Odds Tab - Spec.md'), 'utf8');
const norm = v => String(v).replace(/\s+/g, '').toUpperCase();

// Spec table row -> the AODDS_C key(s) that carry it.
const SPEC_KEYS = { 'Player A': ['a'], 'Player B': ['b'], 'Up': ['up'], 'Down': ['dn'], 'Text': ['text'], 'Muted 1': ['sub', 'soft'],
  'Muted 2': ['label'], 'Muted 3': ['label3'], 'Header caps': ['caps'], 'Blue': ['blue'], 'Sharp heading': ['sharp'],
  'Row / tile bg': ['row'], 'Row hover bg': ['rowHover'], 'Pop-up bg': ['pop'], 'Segmented bg': ['segTrack'] };

test('1: every Odds-tab colour token is the Odds Tab - Spec.md value, verbatim (no 12a mapping)', () => {
  const sec = SPEC.slice(SPEC.indexOf('## Colour tokens used on this tab'), SPEC.indexOf('## Layout'));
  const rows = [...sec.matchAll(/^\| ([^|]+?) \| (#[0-9A-Fa-f]{6}) \|/gm)].map(m => [m[1].trim(), m[2]]);
  assert.equal(rows.length, Object.keys(SPEC_KEYS).length, 'spec table rows: ' + rows.map(r => r[0]));
  const C = build().AODDS_C;
  for (const [name, hex] of rows) for (const k of SPEC_KEYS[name]) assert.equal(norm(C[k]), norm(hex), `${name} (${k})`);
  // the prose values the spec gives outside the table (§1–§6) — a sample that the 12a map used to change
  const prose = { segOnBg: 'rgba(91,155,255,0.16)', tileBd: 'rgba(255,255,255,0.1)', tileOnBd: 'rgba(91,155,255,0.45)',
    rowBd: 'rgba(255,255,255,0.05)', backdrop: 'rgba(4,5,9,0.62)', steamInk: '#06070A', hw125: '1.25px' };
  for (const [k, v] of Object.entries(prose)) { assert.ok(SPEC.replace(/\s/g, '').toUpperCase().includes(norm(v)), `spec states ${v}`); assert.equal(norm(C[k]), norm(v), k); }
});

// The page's stylesheet rules, in document order, as [selector, declarations].
function rules(src) {
  const out = [];
  for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const r of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([r[1].trim(), r[2]]);
  }
  return out;
}
function applied(src, selector, prop) {
  let v = null;
  for (const [sel, body] of rules(src)) {
    if (!sel.split(',').map(s => s.trim()).includes(selector)) continue;
    const d = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(body); if (d) v = d[1].trim();
  }
  return v;
}
const rootVar = (src, name) => new RegExp('--' + name + ':\\s*([^;]+);').exec(src)[1].trim();
const resolve = (src, v) => { const m = /^var\(--([\w-]+)\)$/.exec(v || ''); return m ? rootVar(src, m[1]) : v; };

test('2: the rendered nav-selected background is the design #171D2F; the modal surface is the design #0B0C13', () => {
  const navSel = resolve(HTML, applied(HTML, '.modal-analysis .asidenav-item.active', 'background'));
  assert.equal(norm(navSel), '#171D2F');
  assert.equal(norm(resolve(HTML, applied(HTML, '.modal-analysis', 'background'))), '#0B0C13');
  assert.equal(norm(applied(HTML, '.modal-analysis .asidenav-item', 'color')), '#5B6880');
  assert.equal(norm(applied(HTML, '.modal-analysis .asidenav-item:hover', 'background')), 'RGBA(255,255,255,0.04)');
  // review fold-in: text the Odds tab does not colour itself inherits the design #E7E9EE (not the 12a #EBF1F2)
  assert.equal(norm(applied(HTML, '#aSectionOdds', 'color')), '#E7E9EE');
  assert.equal(norm(applied(HTML, '.modal-analysis .ahead2 .close', 'color')), '#5B6880');
  assert.equal(norm(applied(HTML, '.modal-analysis .asidenav-download', 'border-top-color')), 'RGBA(255,255,255,0.07)');
  // mutant: the 12a rule re-appended after the design block wins the cascade again
  const m = HTML.replace('</body>', '<style>.modal-analysis .asidenav-item.active{ background:var(--seg-active); }</style></body>');
  assert.equal(norm(resolve(m, applied(m, '.modal-analysis .asidenav-item.active', 'background'))), '#0B1C4E', 'mutant survived');
});

test('3: the 12a engine skips both design-verbatim zones (AODDS_C and the modal block)', async () => {
  const { recolourFile } = await import('./tools/theme-12a/recolour.mjs');
  const r = recolourFile('bsp-consult-dashboard.html', HTML);
  const out = r.out != null ? r.out : r.src != null ? r.src : r;
  const text = typeof out === 'string' ? out : HTML;
  assert.equal(constSrc('AODDS_C', text), constSrc('AODDS_C', HTML), 'AODDS_C re-toned by the engine');
  const blk = s => s.slice(s.indexOf('<style id="design-verbatim-analysis">'), s.indexOf('</style>', s.indexOf('<style id="design-verbatim-analysis">')));
  assert.equal(blk(text), blk(HTML), 'the modal block re-toned by the engine');
  // mutant: with the exemption gone the engine maps the spec literals (e.g. #E7E9EE -> the 12a text)
  const src = readFileSync(join(HERE, 'tools/theme-12a/recolour.mjs'), 'utf8');
  const d = mkdtempSync(join(tmpdir(), 'ten303col-'));
  try {
    const mut = src.replace("['const AODDS_C = {', '\\n};'],", '').replace(/from '\.\/tokens\.mjs'/, `from '${join(HERE, 'tools/theme-12a/tokens.mjs')}'`);
    assert.notEqual(mut, src, 'mutant anchor');
    writeFileSync(join(d, 'recolour.mjs'), mut);
    const M = await import(join(d, 'recolour.mjs'));
    const mo = M.recolourFile('bsp-consult-dashboard.html', HTML);
    const mtext = typeof mo === 'string' ? mo : (mo.out != null ? mo.out : mo.src);
    assert.notEqual(constSrc('AODDS_C', mtext), constSrc('AODDS_C', HTML), 'mutant survived: the engine left AODDS_C alone without the exemption');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
