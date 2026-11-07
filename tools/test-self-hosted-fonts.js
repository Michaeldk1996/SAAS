#!/usr/bin/env node
// tools/test-self-hosted-fonts.js — the dashboard's two web fonts are served from this site (page speed, 7 Nov 2026).
// Holds: no Google Fonts request in the page; every @font-face is Hanken Grotesk or IBM Plex Mono with
// font-display: block (foundation.md: "loaded with display=block") and points at a woff2 in assets/fonts/ that exists;
// Hanken covers 400-800 and Plex Mono 400-700 in every subset (latin, latin-ext, vietnamese, cyrillic, cyrillic-ext as Google
// serves them); the preloaded file is one of them; the OFL licences ship beside the files; site-code.sh and the
// pipeline copy the folder and publish requires it. Controls: a missing file and a non-block face are caught.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  ' + detail : '')); } };

function faces(src) {
  return [...src.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const b = m[1];
    const g = (re) => ((b.match(re) || [])[1] || '').trim();
    return { family: g(/font-family:\s*'([^']+)'/), weight: g(/font-weight:\s*(\d+)/), display: g(/font-display:\s*([a-z]+)/),
      url: g(/url\((assets\/fonts\/[^)]+)\)/), range: g(/unicode-range:\s*([^;]+);/), raw: b };
  });
}
function verify(src, label) {
  const f = faces(src);
  const out = [];
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(src)) out.push('a Google Fonts URL is still in the page');
  if (f.length !== 40) out.push(`${f.length} @font-face rules (Google serves 40)`);
  for (const x of f) {
    if (!/^(Hanken Grotesk|IBM Plex Mono)$/.test(x.family)) out.push('family ' + x.family);
    if (x.display !== 'block') out.push(`${x.family} ${x.weight}: font-display ${x.display || 'missing'}`);
    if (!x.url || !fs.existsSync(path.join(ROOT, x.url)) || fs.statSync(path.join(ROOT, x.url)).size < 1000) out.push('missing file ' + (x.url || '(no url)'));
    if (!x.range) out.push(`${x.family} ${x.weight}: no unicode-range`);
  }
  // What Google Fonts serves for the page's request: Hanken 400-800, Plex Mono 400-700 (Plex Mono has no 800; the
  // browser synthesises it, as it did with Google's stylesheet).
  for (const [fam, ws] of [['Hanken Grotesk', ['400', '500', '600', '700', '800']], ['IBM Plex Mono', ['400', '500', '600', '700']]]) for (const w of ws) {
    const n = f.filter((x) => x.family === fam && x.weight === w).length;
    if (n < 4) out.push(`${fam} ${w}: ${n} subsets`);
  }
  return out;
}

const problems = verify(html, 'page');
check('every face is ours, display block, file present; Hanken 400-800 and Plex Mono 400-700 in every subset; no Google URL', problems.length === 0, problems.slice(0, 5).join('; '));
const pre = (html.match(/<link rel="preload" href="(assets\/fonts\/[^"]+\.woff2)" as="font" type="font\/woff2" crossorigin>/) || [])[1];
check('the preloaded font is one of the faces (crossorigin, woff2)', !!pre && faces(html).some((x) => x.url === pre), pre);
check('the OFL licences ship with the files', ['OFL-hankengrotesk.txt', 'OFL-ibmplexmono.txt'].every((f) => /SIL Open Font License/.test(fs.readFileSync(path.join(ROOT, 'assets/fonts', f), 'utf8'))));
const code = fs.readFileSync(path.join(ROOT, 'tools/site-code.sh'), 'utf8');
const pipe = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
const pub = fs.readFileSync(path.join(ROOT, 'tools/publish-site.mjs'), 'utf8');
check('site-code.sh and pipeline.yml copy assets/fonts/; publish requires the preloaded file',
  /cp assets\/fonts\/\*\.woff2 assets\/fonts\/OFL-\*\.txt "\$SITE\/assets\/fonts\/"/.test(code) && /cp assets\/fonts\/\*\.woff2 assets\/fonts\/OFL-\*\.txt _site\/assets\/fonts\//.test(pipe) && !!pre && pub.includes(`'${pre}'`));

// Controls: the checker catches a missing file, a swap-display face and a Google link put back.
const first = faces(html)[0];
check('CONTROL: a face pointing at a missing file is caught', verify(html.replace(first.url, 'assets/fonts/nope.woff2'), 'm').some((p) => /missing file/.test(p)));
check('CONTROL: a face with font-display: swap is caught', verify(html.replace('@font-face {' + first.raw, '@font-face {' + first.raw.replace('font-display: block', 'font-display: swap')), 'm').some((p) => /font-display swap/.test(p)));
check('CONTROL: a Google Fonts link put back is caught', verify(html.replace('</head>', '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet"></head>'), 'm').some((p) => /Google/.test(p)));

console.log(`\ntest-self-hosted-fonts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
