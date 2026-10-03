#!/usr/bin/env node
// TEN-376 (founder, 2026-10-03; README §10 item 1): tokens.css is the ONLY place a colour value lives.
// Every page / stylesheet / script the pipeline publishes is scanned for a raw colour — hex (#rgb, #rrggbb,
// #rrggbbaa), rgb()/rgba(), hsl()/hsla() — and the build fails on any hit. Colours are written as
// var(--token) or color-mix(in srgb, var(--token) N%, transparent).
//   Not scanned: tokens.css (the token file), assets/ (provider marks and logos are files, not UI code — U4),
//   and the pages the founder scoped OUT of step 1 (Q3): funnel.html, admin.html, admin-config.js.
//   The file list is read from pipeline.yml's `cp` lines, so a newly published file is linted automatically.
// Usage: node tools/lint-raw-colours.mjs [--self-test]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_OF_STEP1 = new Set(['funnel.html', 'admin.html', 'admin-config.js']);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const FUNC = /\b(?:rgba?|hsla?)\(\s*[\d.]/g;
// '#' + 3 hex chars that is not a colour: a URL fragment / element id in a selector or a JS string
// ('#add', location.hash === '#abc'). Only these exact contexts are skipped; anything else is a colour.
const NOT_COLOUR_BEFORE = /(?:getElementById\(|querySelector(?:All)?\(|location\.hash\s*===?\s*|href=)['"]?$/;

export function publishedFiles(root = ROOT) {
  const yml = fs.readFileSync(path.join(root, '.github/workflows/pipeline.yml'), 'utf8');
  const names = new Set();
  for (const line of yml.split('\n')) {
    if (!/^\s*cp\s/.test(line)) continue;
    for (const tok of line.trim().split(/\s+/).slice(1)) {
      if (/^[A-Za-z0-9_.-]+\.(?:html|css|js)$/.test(tok)) names.add(tok);
    }
  }
  // the dashboard is published as index.html too; its <script src> / <link href> files are part of the page
  const dash = fs.readFileSync(path.join(root, 'bsp-consult-dashboard.html'), 'utf8');
  for (const m of dash.matchAll(/(?:src|href)="\.?\/?([A-Za-z0-9_.-]+\.(?:js|css))"/g)) names.add(m[1]);
  return [...names].filter(n => n !== 'tokens.css' && !OUT_OF_STEP1.has(n) && fs.existsSync(path.join(root, n))).sort();
}

export function scan(text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(HEX)) {
      if (NOT_COLOUR_BEFORE.test(line.slice(0, m.index))) continue;
      hits.push({ line: i + 1, value: m[0] });
    }
    for (const m of line.matchAll(FUNC)) hits.push({ line: i + 1, value: line.slice(m.index, line.indexOf(')', m.index) + 1) });
  });
  return hits;
}

function selfTest() {
  // a planted colour in each form must be caught; token expressions and non-colour '#' must not be
  const caught = ['color:#5B9BFF;', 'background:#fff', 'border:1px solid rgba(255,255,255,0.06)', 'fill="#0e1019cc"', 'hsl(210, 50%, 50%)']
    .every(s => scan(s).length === 1);
  const clean = ["color:var(--text);", "background:color-mix(in srgb, var(--pos) 12%, transparent);",
    "document.getElementById('add')", "location.hash === '#abc'", "font-weight:700"].every(s => scan(s).length === 0);
  return caught && clean;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!selfTest()) { console.error('lint-raw-colours: SELF-TEST FAILED (scanner misses a planted colour or flags a token)'); process.exit(2); }
  if (process.argv.includes('--self-test')) { console.log('lint-raw-colours: self-test ok'); process.exit(0); }
  const files = publishedFiles();
  if (files.length < 10) { console.error(`lint-raw-colours: only ${files.length} published files found — the file list is broken, not clean`); process.exit(2); }
  let total = 0;
  for (const f of files) {
    const hits = scan(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    total += hits.length;
    for (const h of hits.slice(0, 20)) console.error(`${f}:${h.line}  raw colour ${h.value}`);
    if (hits.length > 20) console.error(`${f}: … ${hits.length - 20} more`);
  }
  if (total) { console.error(`lint-raw-colours: ${total} raw colour(s) outside tokens.css in ${files.length} published files — use a token`); process.exit(1); }
  console.log(`lint-raw-colours: 0 raw colours in ${files.length} published files (tokens.css is the only colour file)`);
}
