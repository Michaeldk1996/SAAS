// TEN-285 — founder rulings of 2026-09-26 on the brand outside the dashboard:
//   1. favicon: ring-transparent.png is the favicon on EVERY published page
//   2. verify.html + funnel.html: the old lockup (ring in a navy tile + the
//      "BSP CONSULT / Tennis edge" wordmark) is replaced by logo-dark-transparent.png
//      at 26px tall, width auto, with no box — as the dashboard sidebar.
//
// "Every published page" is read from the pipeline's site-assembly `cp` lines, not
// hard-coded, so a page added to the site later without a favicon fails here.
// Every check re-runs against a mutant; a mutant that survives fails.
//
// Run: node --test test-ten285-brand.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(HERE, f), 'utf8');
const PIPELINE = read('.github/workflows/pipeline.yml');

// Source .html files the pipeline copies into _site/: every `cp … _site/…` command,
// wherever it sits on a line (after `&&`, `;`, `||` too), with cp/mv/rsync alike.
function publishedHtml(yml) {
  const out = new Set();
  for (const line of yml.split('\n')) {
    for (const cmd of line.split(/&&|\|\||;/)) {
      const m = cmd.match(/^\s*(?:cp|mv|rsync)\s+(?:-\S+\s+)*(.+?)\s+_site\/\S*(?:\s+\d?>>?\s*\S+)*\s*$/);
      if (!m) continue;
      for (const tok of m[1].split(/\s+/)) if (/^[\w.-]+\.html$/.test(tok)) out.add(tok);
    }
  }
  return [...out].sort();
}

const ICON_RE = /<link\b[^>]*\brel=["']?(?:shortcut\s+)?icon["']?[^>]*>/gi;
// Problems with the favicon on one page's source; [] = pass.
function faviconProblems(html) {
  const head = (html.match(/<head[\s>][\s\S]*?<\/head>/i) || [''])[0];
  const links = head.match(ICON_RE) || [];
  const all = html.match(ICON_RE) || [];
  const p = [];
  if (links.length !== 1) p.push(`${links.length} icon links in <head> (want 1)`);
  if (all.length !== links.length) p.push('icon link outside <head>');
  if (links[0] && !/href=["']assets\/ring-transparent\.png["']/.test(links[0])) p.push(`wrong href: ${links[0]}`);
  if (links[0] && !/type=["']image\/png["']/.test(links[0])) p.push('missing type="image/png"');
  return p;
}

// Problems with the brand lockup on verify/funnel; [] = pass.
// `container` is the class wrapping the logo; its `img` rule must be 26px tall,
// width auto, and carry no box (border / shadow / radius / fixed width).
function lockupProblems(html, container) {
  const p = [];
  const block = html.match(new RegExp(`<div class="${container}">([\\s\\S]*?)</div>`));
  if (!block) return [`no .${container} block`];
  const imgs = block[1].match(/<img\b[^>]*>/g) || [];
  if (imgs.length !== 1) p.push(`${imgs.length} imgs in .${container}`);
  if (imgs[0] && !/src="assets\/logo-dark-transparent\.png"/.test(imgs[0])) p.push(`logo src: ${imgs[0]}`);
  // text nodes only: the logo's alt="Stennisfy" is not a wordmark
  if (/class="wm"|BSP CONSULT/i.test(block[1]) || />[^<]*\b(?:stennisfy|analytics)\b/i.test(block[1])) p.push('old wordmark still present');
  if (/class="[^"]*\btile\b/.test(block[1])) p.push('old tile still present');
  if (/<svg\b/i.test(block[1])) p.push('an svg mark beside the logo');
  // the old tile/wordmark CSS, and a box drawn by the wrapper instead of the img
  if (/(?<![\w-])\.(?:tile|wm)\b[^{}]*\{/.test(html)) p.push('old .tile/.wm CSS still present');
  for (const [, r] of html.matchAll(new RegExp(`(?<![\\w-])\\.${container}\\s*\\{([^}]*)\\}`, 'g')))
    for (const bad of ['border', 'box-shadow', 'border-radius', 'background', 'outline'])
      if (new RegExp(`(^|[;\\s])${bad}\\s*:`).test(r)) p.push(`box property ${bad} on the .${container} wrapper`);
  // EVERY rule targeting the logo (media queries included) plus any inline style.
  const rules = [...html.matchAll(new RegExp(`\\.${container} img\\s*\\{([^}]*)\\}`, 'g'))].map(m => m[1]);
  if (!rules.length) return [...p, `no .${container} img rule`];
  if (imgs[0] && /\bstyle=/.test(imgs[0])) p.push('inline style on the logo');
  for (const extra of rules.slice(1)) {
    if (/(^|[;\s])height\s*:\s*(?!26px)/.test(extra)) p.push('a second rule changes the logo height');
    if (/(^|[;\s])(?:max-|min-)?width\s*:\s*(?!auto)/.test(extra)) p.push('a second rule changes the logo width');
    if (/(^|[;\s])(?:transform|outline)\s*:/.test(extra)) p.push('a second rule transforms or outlines the logo');
    for (const bad of ['border', 'box-shadow', 'border-radius', 'background', 'object-fit'])
      if (new RegExp(`(^|[;\\s])${bad}\\s*:`).test(extra)) p.push(`box property ${bad} in a later .${container} img rule`);
  }
  const css = rules[0];
  if (!/(^|;)\s*height:\s*26px/.test(css)) p.push('height is not 26px');
  if (!/width:\s*auto/.test(css)) p.push('width is not auto');
  if (/(^|[;\s])(?:max-|min-)width\s*:/.test(css)) p.push('a max/min width squashes the logo');
  for (const bad of ['border', 'box-shadow', 'border-radius', 'background', 'object-fit', 'outline', 'transform'])
    if (new RegExp(`(^|[;\\s])${bad}\\s*:`).test(css)) p.push(`box property ${bad} on the logo`);
  return p;
}

// auth.html joined 2026-09-26 (founder: "Put our new logo there")
const LOCKUPS = [['verify.html', 'brand-id'], ['funnel.html', 'brand'], ['auth.html', 'brand']];

test('the published page list is read from the pipeline and is not empty', () => {
  const pages = publishedHtml(PIPELINE);
  for (const f of ['bsp-consult-dashboard.html', 'auth.html', 'account.html', 'funnel.html', 'verify.html', 'admin.html'])
    assert.ok(pages.includes(f), `${f} missing from ${pages}`);
  // mutant: a newly published page is picked up
  for (const shape of ['cp newpage.html _site/', 'mkdir -p _site && cp newpage.html _site/', 'true; cp -f newpage.html _site/x/',
                       'mv newpage.html _site/', 'rsync -a newpage.html _site/', 'cp newpage.html x.js _site/ 2>/dev/null || true'])
    assert.ok(publishedHtml(PIPELINE + `\n          ${shape}\n`).includes('newpage.html'), `missed: ${shape}`);
});

test('every published page has exactly one ring-transparent.png favicon in <head>', () => {
  for (const f of publishedHtml(PIPELINE)) assert.deepEqual(faviconProblems(read(f)), [], f);
});

test('favicon check kills its mutants', () => {
  const good = read('auth.html');
  const link = good.match(ICON_RE)[0];
  const mutants = {
    removed: good.replace(link, ''),
    duplicated: good.replace(link, link + link),
    wrongFile: good.replace('assets/ring-transparent.png"', 'assets/bsp-logo.jpg"'),
    noType: good.replace(' type="image/png"', ''),
    inBody: good.replace(link, '').replace('<body', link + '<body'),
    unpublishedPage: '<html><head><title>x</title></head><body></body></html>',
  };
  for (const [name, html] of Object.entries(mutants))
    assert.notDeepEqual(faviconProblems(html), [], `mutant survived: ${name}`);
});

test('the pipeline ships both logo PNGs into _site/assets', () => {
  assert.match(PIPELINE, /cp assets\/logo-dark-transparent\.png assets\/ring-transparent\.png _site\/assets\//);
});

test('verify.html, funnel.html and auth.html show the full logo at 26px with no box and no old wordmark', () => {
  for (const [f, c] of LOCKUPS) assert.deepEqual(lockupProblems(read(f), c), [], f);
});

test('lockup check kills its mutants', () => {
  const good = read('verify.html');
  const rule = good.match(/\.brand-id img\s*\{[^}]*\}/)[0];
  const mutants = {
    ringBack: good.replace('src="assets/logo-dark-transparent.png"', 'src="assets/ring-transparent.png"'),
    wordmarkBack: good.replace('<img src="assets/logo-dark-transparent.png" alt="Stennisfy">',
      '<img src="assets/logo-dark-transparent.png" alt="Stennisfy">\n<div class="wm"><b>BSP CONSULT</b></div>'),
    tileBack: good.replace(rule, '.brand-id img{ display:block; height:26px; width:auto; border:1px solid rgba(62,123,250,0.35); border-radius:10px; }'),
    shadowBack: good.replace(rule, '.brand-id img{ display:block; height:26px; width:auto; box-shadow:0 0 0 3px rgba(62,123,250,0.12); }'),
    wrongHeight: good.replace(rule, '.brand-id img{ display:block; height:38px; width:auto; }'),
    fixedWidth: good.replace(rule, '.brand-id img{ display:block; height:26px; width:38px; }'),
    mediaTile: good.replace('</style>', '@media (max-width:600px){ .brand-id img{ height:40px; border-radius:10px } }\n</style>'),
    mediaWidth: good.replace('</style>', '@media (max-width:600px){ .brand-id img{ width:38px } }\n</style>'),
    mediaScale: good.replace('</style>', '@media (max-width:600px){ .brand-id img{ transform:scale(1.4) } }\n</style>'),
    inlineStyle: good.replace('<img src="assets/logo-dark-transparent.png" alt="Stennisfy">', '<img src="assets/logo-dark-transparent.png" alt="Stennisfy" style="border:1px solid #333">'),
  };
  for (const [name, html] of Object.entries(mutants))
    assert.notDeepEqual(lockupProblems(html, 'brand-id'), [], `mutant survived: ${name}`);
});

// auth.html's old lockup was a 'T' tile + STENNISFY/ANALYTICS; the reviewer's missed shapes
test('auth lockup check kills the old tile / wordmark in every shape', () => {
  const good = read('auth.html');
  const img = '<img src="assets/logo-dark-transparent.png" alt="Stennisfy">';
  const rule = '.brand img{ display:block; height:26px; width:auto; }';
  const mut = {
    tileBefore: good.replace(img, '<div class="tile">T</div>\n        ' + img),
    tileAfter: good.replace(img, img + '\n        <div class="tile">T</div>'),
    wordmark: good.replace(img, img + '\n        <div class="wm"><b>STENNISFY</b><small>ANALYTICS</small></div>'),
    bareWordmark: good.replace(img, img + '<b>STENNISFY</b><small>ANALYTICS</small>'),
    svgMark: good.replace(img, '<svg viewBox="0 0 10 10"></svg>' + img),
    tileCss: good.replace(rule, rule + '\n  .brand .tile{ width:38px; height:38px; border-radius:10px; }'),
    wrapperBox: good.replace('.brand{ display:flex; align-items:center; gap:11px; margin-bottom:34px; }',
      '.brand{ display:flex; align-items:center; gap:11px; margin-bottom:34px; background:#10131f; border-radius:10px; }'),
    squashed: good.replace(rule, '.brand img{ display:block; height:26px; width:auto; max-width:60px; }'),
    outlined: good.replace(rule, '.brand img{ display:block; height:26px; width:auto; outline:1px solid #333; }'),
  };
  for (const [name, html] of Object.entries(mut)) {
    assert.notEqual(html, good, `mutant ${name} did not mutate`);
    assert.notDeepEqual(lockupProblems(html, 'brand'), [], `mutant survived: ${name}`);
  }
});

// ── funnel footer (founder 2026-09-26): the ring with no box, and the © line names Stennisfy ──
function footerProblems(html) {
  const p = [];
  const block = html.match(/<div class="footer-brand">([\s\S]*?)<\/div>/);
  if (!block) return ['no .footer-brand block'];
  const imgs = block[1].match(/<img\b[^>]*>/g) || [];
  if (imgs.length !== 1 || !/src="assets\/ring-transparent\.png"/.test(imgs[0])) p.push('the footer mark is not the ring');
  // inline style may only set object-fit (the ring PNG is 144x154)
  const inline = imgs[0] && (imgs[0].match(/\bstyle="([^"]*)"/) || [])[1];
  if (inline && /(^|[;\s])(?:border|border-radius|box-shadow|background|outline|width|height)\s*:/.test(inline)) p.push('inline box/size on the footer ring');
  if (!/<span>© 2026 Stennisfy<\/span>/.test(block[1])) p.push('the © line does not read "© 2026 Stennisfy"');
  if (/BSP Consult|Tennis edge/i.test(block[1])) p.push('the old brand is still in the footer');
  const rules = [...html.matchAll(/\.footer-brand img\s*\{([^}]*)\}/g)].map(m => m[1]);
  if (!rules.length) p.push('no .footer-brand img rule');
  else if (!/(^|[;\s])width:\s*28px/.test(rules[0]) || !/(^|[;\s])height:\s*28px/.test(rules[0])) p.push('the footer ring is not 28x28');
  for (const r of rules.slice(1)) if (/(^|[;\s])(?:max-|min-)?(?:width|height)\s*:/.test(r)) p.push('a later rule resizes the footer ring');
  for (const r of rules) for (const bad of ['border', 'border-radius', 'box-shadow', 'background', 'outline'])
    if (new RegExp(`(^|[;\\s])${bad}\\s*:`).test(r)) p.push(`the footer ring has a box (${bad})`);
  return p;
}
test('funnel footer: the ring with no box, "© 2026 Stennisfy"', () => {
  const good = read('funnel.html');
  assert.deepEqual(footerProblems(good), []);
  const mut = {
    tileBack: good.replace('.footer-brand img{ display:block; width:28px; height:28px; }', '.footer-brand img{ display:block; width:28px; height:28px; border-radius:8px; border:1px solid rgba(62,123,250,0.3); }'),
    oldText: good.replace('<span>© 2026 Stennisfy</span>', '<span>© 2026 BSP Consult · Tennis edge</span>'),
    inlineBox: good.replace(/(<div class="footer-brand">\s*<img src="assets\/ring-transparent\.png"[^>]*?style=")/, '$1border:1px solid #333; border-radius:8px; '),
    resized: good.replace('.footer-brand img{ display:block; width:28px; height:28px; }', '.footer-brand img{ display:block; width:40px; height:40px; }'),
    laterResize: good.replace('.footer-brand span{', '.footer-brand img{ height:40px }\n  .footer-brand span{'),
    secondRuleBox: good.replace('.footer-brand span{', '.footer-brand img{ border-radius:8px }\n  .footer-brand span{'),
  };
  for (const [name, html] of Object.entries(mut)) { assert.notEqual(html, good, `mutant ${name} did not mutate`); assert.notDeepEqual(footerProblems(html), [], `mutant survived: ${name}`); }
});
