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

// Source .html files the pipeline copies into _site/ (any `cp … _site/…` line).
function publishedHtml(yml) {
  const out = new Set();
  for (const line of yml.split('\n')) {
    const m = line.match(/^\s*cp\s+(.+?)\s+_site\/\S*/);
    if (!m) continue;
    for (const tok of m[1].split(/\s+/)) if (/^[\w.-]+\.html$/.test(tok)) out.add(tok);
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
  if (/class="wm"|BSP CONSULT/i.test(block[1])) p.push('old wordmark still present');
  const rule = html.match(new RegExp(`\\.${container} img\\s*\\{([^}]*)\\}`));
  if (!rule) return [...p, `no .${container} img rule`];
  const css = rule[1];
  if (!/(^|;)\s*height:\s*26px/.test(css)) p.push('height is not 26px');
  if (!/width:\s*auto/.test(css)) p.push('width is not auto');
  for (const bad of ['border', 'box-shadow', 'border-radius', 'background', 'object-fit'])
    if (new RegExp(`(^|[;\\s])${bad}\\s*:`).test(css)) p.push(`box property ${bad} on the logo`);
  return p;
}

const LOCKUPS = [['verify.html', 'brand-id'], ['funnel.html', 'brand']];

test('the published page list is read from the pipeline and is not empty', () => {
  const pages = publishedHtml(PIPELINE);
  for (const f of ['bsp-consult-dashboard.html', 'auth.html', 'account.html', 'funnel.html', 'verify.html', 'admin.html'])
    assert.ok(pages.includes(f), `${f} missing from ${pages}`);
  // mutant: a newly published page is picked up
  assert.ok(publishedHtml(PIPELINE + '\n          cp newpage.html _site/\n').includes('newpage.html'));
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

test('verify.html and funnel.html show the full logo at 26px with no box and no old wordmark', () => {
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
  };
  for (const [name, html] of Object.entries(mutants))
    assert.notDeepEqual(lockupProblems(html, 'brand-id'), [], `mutant survived: ${name}`);
});
