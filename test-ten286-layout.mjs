// TEN-286 — the 12a design's structure, type and spacing, locked on the shipped source.
//
// Source of truth: design/reference/portal-12a.html (the LOCKED 12a export, founder ruling
// 2026-09-26), measured in headless Chrome relative to the portal frame. The values below are
// that file's COMPUTED styles (its label text "#10131F / 6%" is stale and never a source).
// The live measurement (review A–F) is the proof the page renders them; this suite is the
// regression lock: every check re-runs against a named mutant, and a surviving mutant fails.
//
// TEN-376 Foundation (founder, 2026-10-03): 12a keeps LAYOUT only (.claude/rules/theme-12a.md). Every colour the
// suite pinned is now the foundation token for the same role (.claude/rules/foundation.md, tokens.css); the type
// and size values the foundation re-ruled are updated too (caps labels Hanken 10.5/700/0.10em, sidebar items r8,
// header-card subtitles max-width 640, no Today dot, all borders 1px, top-level cards no outline + --top-light).
//
// Run: node --test test-ten286-layout.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(HERE, f), 'utf8');
const DASH = read('bsp-consult-dashboard.html');
const ACCT = read('account.html');
const PIPE = read('.github/workflows/pipeline.yml');

// ── a tiny CSS reader: top-level rules of every <style> block, in source order ─────────
// (rules inside @media are skipped: this suite locks the desktop 1440px layout)
function cssRules(html) {
  const out = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    let i = 0, depth = 0, start = 0, sel = null;
    while (i < css.length) {
      const c = css[i];
      if (c === '{') {
        if (depth === 0) { sel = css.slice(start, i).trim(); start = i + 1; }
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          if (sel && !sel.startsWith('@')) out.push({ sel, body: css.slice(start, i) });
          start = i + 1; sel = null;
        } else if (depth < 0) depth = 0;
      }
      i++;
    }
  }
  return out;
}
const splitSel = s => s.split(',').map(x => x.trim().replace(/\s+/g, ' '));
// the value of `prop` in the LAST rule (source order) whose selector list contains `sel`
function effective(html, sel, prop) {
  let v = null;
  for (const r of cssRules(html)) {
    if (!splitSel(r.sel).includes(sel)) continue;
    for (const d of r.body.split(';')) {
      const k = d.indexOf(':'); if (k < 0) continue;
      if (d.slice(0, k).trim() === prop) v = d.slice(k + 1).trim().replace(/\s*!important$/, '');
    }
  }
  return v;
}

// ── the design's computed values (portal-12a.html, DPR-independent authored values) ─────
const M = '[data-page="matches"]';
const SPEC = [
  // app shell (both pages carry it; the dashboard uses buttons, account.html anchors)
  ['.sf-sidebar', 'width', '252px'], ['.sf-sidebar', 'padding', '18px 0 18px 18px'], ['.sf-sidebar', 'line-height', 'normal'],
  ['.sf-panel', 'padding', '20px 12px 14px'], ['.sf-panel', 'border-radius', '22px'], ['.sf-panel', 'background', 'var(--card)'],
  ['.sf-panel', 'border', '1px solid transparent'], ['.sf-panel', 'box-shadow', 'var(--top-light)'],   // top-level card: no outline + top light ['.sf-brand', 'margin', '0 8px 26px'], ['.sf-logo', 'height', '26px'],
  ['.sf-nav', 'gap', '3px'], ['.sf-foot', 'padding-top', '24px'], ['.sf-foot', 'gap', '10px'],
  ['.sf-userchip', 'padding', '6px 8px'], ['.sf-userchip', 'gap', '10px'], ['.sf-userav', 'width', '30px'], ['.sf-userav', 'font-size', '11px'],
  ['.sf-username', 'font-size', '12px'], ['.sf-userplan', 'font-size', '10.5px'],
  ['.sf-upgrade', 'background', 'var(--pro)'], ['.sf-upgrade', 'color', 'var(--pro-text)'], ['.sf-upgrade', 'border-radius', '10px'],
  // board
  [`${M}.tabpage.active`, 'padding', '30px 40px 70px'], [`${M}.tabpage.active`, 'gap', '22px'], [`${M}.tabpage.active`, 'line-height', 'normal'],
  [`${M} .mx-titlerow`, 'padding', '22px 26px'], [`${M} .mx-titlerow`, 'border-radius', '12px'], [`${M} .mx-titlerow`, 'gap', '28px'],
  [`${M} .mx-h1`, 'font-size', '29px'], [`${M} .mx-h1`, 'font-weight', '800'], [`${M} .mx-h1`, 'letter-spacing', '-0.015em'],
  [`${M} .mx-subtitle`, 'font-size', '13.5px'], [`${M} .mx-subtitle`, 'line-height', '1.55'], [`${M} .mx-subtitle`, 'max-width', '640px'],   // foundation: header-card subtitles max 640
  [`${M} .mx-daytabsrow`, 'gap', '12px'], [`${M} .mx-viewseg button`, 'padding', '7px 14px'],
  [`${M} .mx-daytabschevron`, 'width', '30px'], [`${M} .mx-daytabschevron`, 'font-size', '16px'],
  [`${M} .mx-daytabs`, 'gap', '4px'], [`${M} .mx-daytabs button`, 'padding', '8px 14px 10px'], [`${M} .mx-daytabs button`, 'gap', '6px'],
  [`${M} .mx-daytabs button`, 'margin', '0'], [`${M} .mx-daytabs button:not(.mx-daypill)::before`, 'width', '5px'],
  [`${M} .mx-daytabs button::before`, 'display', 'none'],   // README §5.2: plain date rail, no Today dot (was the blue-ring dot)
  [`${M} .mc-story`, 'padding', '15px 19px'], [`${M} .mc-story`, 'gap', '8px'], [`${M} .mc-story__lbl`, 'font-size', '10.5px'],
  [`${M} .mc-story__lbl`, 'letter-spacing', '0.10em'], [`${M} .mc-story__lbl`, 'font-family', 'var(--font-words)'], [`${M} .mc-story__lbl`, 'font-weight', '700'], [`${M} .mc-story__od`, 'font-size', '20px'], [`${M} .mc-story__od`, 'letter-spacing', 'normal'],
  [`${M} .mx-chip`, 'padding', '9px 16px'], [`${M} .mx-chip`, 'font-weight', '600'],
  [`${M} .mx-searchwrap`, 'padding', '10px 14px'], [`${M} .mx-searchwrap`, 'gap', '9px'], [`${M} .mx-sortbtn`, 'padding', '10px 15px'],
  [`${M} #matchlist`, 'align-items', 'stretch'],   // founder ruling TEN-270 (odds.md): equal-height cards — NOT the design's start
  [`${M} .match-card .mc-head`, 'padding', '11px 16px'], [`${M} .match-card .mc-round`, 'padding', '2px 6px'],
  [`${M} .match-card .mc-round`, 'font-size', '10.5px'], [`${M} .match-card .mc-colhead-inline`, 'grid-template-columns', '1px 104px 96px'],
  [`${M} .match-card .mc-colhead-inline .lbl`, 'font-size', '10.5px'], [`${M} .match-card .mc-colhead-inline .lbl`, 'letter-spacing', '0.10em'],   // caps label
  [`${M} .mc-players.up .mc-row`, 'grid-template-columns', 'minmax(0,1fr) 1px 104px 96px'], [`${M} .mc-players.up .mc-row`, 'padding', '11px 16px'],
  [`${M} .match-card .mc-name`, 'font-size', '14px'], [`${M} .match-card .mc-odds`, 'font-size', '19px'], [`${M} .match-card .mc-odds`, 'font-weight', '800'],
  [`${M} .match-card .mc-form__track`, 'width', '52px'], [`${M} .match-card .mc-form__track`, 'height', '6px'], [`${M} .match-card .mc-form`, 'gap', '9px'],
  [`${M} .match-card .mc-foot`, 'padding', '10px 16px'], [`${M} .match-card .mc-foot`, 'gap', '12px'],
  [`${M} .match-card .mc-msig`, 'letter-spacing', '0.06em'], [`${M} .match-card .mc-msig .chev`, 'font-size', '11px'],
  [`${M} .match-card.sig-open .mc-msig .chev`, 'transform', 'rotate(180deg)'],
  [`${M} .mc-sig-src`, 'width', '76px'], [`${M} .mc-sig-liq`, 'width', '72px'], [`${M} .mc-sig-bar__dog`, 'background', 'var(--bar-2)'],
  [`${M} .mc-sig-group + .mc-sig-group`, 'border-top', '1px solid var(--line)'],
  ['.mc-promo', 'padding', '13px 20px'], ['.mc-promo', 'gap', '16px'], ['.mc-promo__lead', 'gap', '12px'],
  ['.mc-promo__icon', 'background', 'var(--inner)'], ['.mc-promo__icon', 'color', 'var(--text)'], ['.mc-promo__badge', 'background', 'var(--inner)'],   // badge = FAV treatment
];
const ACCT_SPEC = SPEC.filter(([s]) => s.startsWith('.sf-') && !s.startsWith('.sf-nav button'))
  .concat([['.sf-nav a', 'padding', '10px 12px'], ['.sf-nav a', 'border-radius', '8px'], ['.sf-nav a', 'font-size', '13.5px'], ['.sf-nav a', 'color', 'var(--text-label)']]);
const DASH_NAV = [['.sf-nav button', 'padding', '10px 12px'], ['.sf-nav button', 'border-radius', '8px'], ['.sf-nav button', 'font-size', '13.5px'],
  ['.sf-nav button', 'font-weight', '600'], ['.sf-nav button', 'color', 'var(--text-label)']];   // foundation: sidebar items r8, idle = --text-label

function specProblems(html, spec) {
  const p = [];
  for (const [sel, prop, want] of spec) { const got = effective(html, sel, prop); if (got !== want) p.push(`${sel} { ${prop}: ${got} } want ${want}`); }
  return p;
}

test('the dashboard carries the 12a layout values + foundation colours (shell + board)', () => {
  assert.deepEqual(specProblems(DASH, SPEC.concat(DASH_NAV)), []);
});
test('account.html carries the same shell (12a layout, foundation colours)', () => {
  assert.deepEqual(specProblems(ACCT, ACCT_SPEC), []);
});
test('spec lock kills its mutants', () => {
  const mut = {
    sidebar250: DASH.replace('width:252px; box-sizing:border-box; display:flex;', 'width:250px; box-sizing:border-box; display:flex;'),
    rowGrid: DASH.replace('grid-template-columns:minmax(0,1fr) 1px 104px 96px;', 'grid-template-columns:minmax(0,1fr) 104px 96px;'),
    formBarLong: DASH.replace('.mc-form__track{ width:52px;', '.mc-form__track{ width:78px;'),
    laterOverride: DASH.replace('</body>', `<style>${M} .match-card .mc-foot{ padding:14px 20px; }</style></body>`),
    upgradeHollow: DASH.replace('</body>', '<style>.sf-upgrade{ background:none; }</style></body>'),
  };
  for (const [name, html] of Object.entries(mut)) assert.notDeepEqual(specProblems(html, SPEC.concat(DASH_NAV)), [], `mutant survived: ${name}`);
});

// ── rulings: 252 on both pages, no ANALYSE label, no chevron, user row → account.html ───
function shellRulings(html) {
  const p = [];
  if (/class="sf-navlabel"/.test(html)) p.push('ANALYSE label present');
  if (/sf-chev/.test(html)) p.push('user-row chevron present');
  const row = /<a class="sf-userchip"[^>]*href="([^"]+)"/.exec(html);
  if (!row || row[1] !== 'account.html') p.push(`user row href ${row && row[1]}`);
  return p;
}
test('rulings: no ANALYSE label, no chevron, the user row links to account.html (both pages)', () => {
  assert.deepEqual(shellRulings(DASH), []); assert.deepEqual(shellRulings(ACCT), []);
  const mut = {
    chevronBack: DASH.replace('</span>\n    </a>\n    <a class="sf-upgrade"', '</span>\n      <span class="sf-chev" aria-hidden="true">›</span>\n    </a>\n    <a class="sf-upgrade"'),
    labelBack: DASH.replace('<nav class="sf-nav" id="mainNav">', '<div class="sf-navlabel">Analyse</div>\n  <nav class="sf-nav" id="mainNav">'),
    rowToMenu: ACCT.replace('<a class="sf-userchip" href="account.html">', '<a class="sf-userchip" href="#menu">'),
  };
  for (const [name, html] of Object.entries(mut)) assert.notDeepEqual(shellRulings(html), [], `mutant survived: ${name}`);
});

// ── C · nav glyphs, element for element (frozen from the design's rendered SVGs) ───────
const GLYPHS = {
  'Matches': [['path', 'M3 6.5h14M3 10h14M3 13.5h14']],
  'Live': [['path', 'M10 8.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3M6.8 6.8a4.5 4.5 0 000 6.4M13.2 6.8a4.5 4.5 0 010 6.4M4.6 4.6a7.6 7.6 0 000 10.8M15.4 4.6a7.6 7.6 0 010 10.8']],
  'Trading Report': [['path', 'M3.5 15.5 7 10l3 2.5 4-7M13 3.5h3.5V7']],
  // TEN-294: the 12a portal reference carries Dropping Odds between Trading Report and Series
  'Dropping Odds': [['path', 'M3.5 5.5 8 10l3-2.5 5.5 6M16.5 9.5v4h-4']],
  'Series': [['path', 'M3 14.5c2.5 0 3.2-3.4 5-3.4s2.3 2.2 4 2.2 2.6-4.8 5-4.8']],
  'Players': [['path', 'M10 10a3 3 0 100-6 3 3 0 000 6ZM4.5 16a5.5 5.5 0 0111 0']],
  'Head to Head': [['path', 'M7 4v12M13 4v12M3.5 8.5h3M13.5 11.5h3']],
  'Tournaments': [['path', 'M6 4h8v3a4 4 0 01-8 0V4ZM10 11v3M7.5 16.5h5']],
  'Database': [['path', 'M10 3.4c3 0 5.4.8 5.4 1.9v9.4c0 1.1-2.4 1.9-5.4 1.9s-5.4-.8-5.4-1.9V5.3c0-1.1 2.4-1.9 5.4-1.9ZM4.6 5.3c0 1.1 2.4 1.9 5.4 1.9s5.4-.8 5.4-1.9M4.6 10c0 1.1 2.4 1.9 5.4 1.9s5.4-.8 5.4-1.9']],
  'Stennisfy Model': [['path', 'M10 3l1.9 3.9 4.3.6-3.1 3 .7 4.3L10 16.8 6.3 18.8l.7-4.3-3.1-3 4.3-.6z']],
  'Playing Styles': [['path', 'M4 15V9M8 15V5M12 15v-4M16 15V7']],
  'News': [['path', 'M4 5h9v10H4zM13 8h3v5.5a1.5 1.5 0 01-3 0zM6 8h5M6 11h5']],
};
function glyphProblems(html) {
  const nav = html.slice(html.indexOf('<nav class="sf-nav" id="mainNav">'), html.indexOf('</nav>', html.indexOf('<nav class="sf-nav" id="mainNav">')));
  const got = {}; const p = [];
  for (const m of nav.matchAll(/<button[^>]*data-tab="[^"]+"[^>]*>(<svg[\s\S]*?<\/svg>)([^<]+)<\/button>/g)) {
    const els = [...m[1].matchAll(/<(path|circle|ellipse|line|rect|polyline)\b([^>]*?)\/?>/g)].map(e => [e[1], (/\bd="([^"]*)"/.exec(e[2]) || /cx="[^"]*"/.exec(e[2]) || [''])[1] || e[2].trim()]);
    if (!/viewBox="0 0 20 20"/.test(m[1])) p.push(`${m[2].trim()}: viewBox`);
    got[m[2].trim()] = els;
  }
  for (const [label, want] of Object.entries(GLYPHS)) if (JSON.stringify(got[label]) !== JSON.stringify(want)) p.push(`${label}: ${JSON.stringify(got[label])}`);
  if (Object.keys(got).length !== Object.keys(GLYPHS).length) p.push(`nav has ${Object.keys(got).length} items`);
  return p;
}
test('C · all 12 nav glyphs are the design paths, element for element', () => {
  assert.deepEqual(glyphProblems(DASH), []);
  const mut = {
    liveCircle: DASH.replace('<svg viewBox="0 0 20 20" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8.5a1.5', '<svg viewBox="0 0 20 20" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.2"/><path d="M10 8.5a1.5'),
    oldTrading: DASH.replace('M3.5 15.5 7 10l3 2.5 4-7M13 3.5h3.5V7', 'M3 16V4M3 16h14M7 13l3-4 3 2 3.5-5'),
    dropsGlyph: DASH.replace('M3.5 5.5 8 10l3-2.5 5.5 6M16.5 9.5v4h-4', 'M3.5 5.5 8 10l3-2.5 5.5 6'),
  };
  for (const [name, html] of Object.entries(mut)) assert.notDeepEqual(glyphProblems(html), [], `mutant survived: ${name}`);
});

// ── tokens: ONE colour file (TEN-376 Foundation; replaces the 12a :root block both pages carried) ──
// Both pages load ./theme.js then ./tokens.css first in <head>; neither page re-declares a foundation token globally
// (a scoped §6 variant such as the H2H white bars is allowed); no retired 12a token is defined or read; and tokens.css
// (Night) carries the foundation values.
const TOKENS_CSS = read('tokens.css');
const FOUNDATION = { page: '#090B12', card: '#10131D', inner: '#171B28', selected: '#1B2031', 'tile-hover': '#141824',
  text: '#FFFFFF', 'text-soft': '#DDE0EA', 'text-label': '#A3AABE', bar: '#007AFF', 'bar-2': 'rgba(0,122,255,0.45)', link: '#6A9AF8',
  pro: '#2F52D6', 'pro-text': '#F2F3F7', pos: '#5CCB84', neg: '#E06266', 'serve-ball': '#EAF928',
  'edge-6': 'rgba(255,255,255,0.06)', 'edge-7': 'rgba(255,255,255,0.07)', 'edge-10': 'rgba(255,255,255,0.10)', 'edge-16': 'rgba(255,255,255,0.16)',
  'edge-24': 'rgba(255,255,255,0.24)', line: 'rgba(255,255,255,0.05)', track: 'rgba(255,255,255,0.06)', 'open-card': 'rgba(143,170,255,0.28)',
  'top-light': 'inset 0 1px 0 rgba(143,170,255,0.05)', 'font-words': "'Hanken Grotesk',sans-serif", 'font-nums': "'IBM Plex Mono',monospace" };
// the 12a token names the foundation retired (the old block's names that tokens.css does not define)
const RETIRED = ['nav-panel', 'surface', 'surface-inner', 'popup', 'line-soft', 'line-panel', 'line-open', 'line-avatar', 'text-sub', 'label',
  'nav-idle', 'nav-icon-idle', 'blue-ring', 'periwinkle', 'navy', 'royal', 'lime', 'bar-track', 'bar-dog', 'seg-active', 'seg-active-line',
  'clay', 'positive', 'nav-hover', 'nav-active', 'nav-active-line', 'avatar', 'promo-tile', 'promo-glyph'];
const nightTokens = css => {
  const T = {};
  for (const b of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/day/.test(b[1])) continue;
    for (const m of b[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) T[m[1]] = m[2].trim();
  }
  return T;
};
function headOrder(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  const th = head.indexOf('<script src="./theme.js"></script>'), tk = head.indexOf('<link rel="stylesheet" href="./tokens.css">');
  const firstOther = Math.min(...[/<link rel="stylesheet"(?! href="\.\/tokens\.css")/, /<style/, /<script(?! src="\.\/theme\.js")/]
    .map(re => { const m = re.exec(head); return m ? m.index : Infinity; }));
  return th >= 0 && tk > th && firstOther > tk;
}
function tokenProblems(dash, acct, tokensCss = TOKENS_CSS) {
  const p = [];
  const T = nightTokens(tokensCss), names = new Set(Object.keys(T));
  for (const [name, html] of [['dashboard', dash], ['account.html', acct]]) {
    if (!headOrder(html)) p.push(`${name}: <head> does not load ./theme.js then ./tokens.css before anything else`);
    for (const r of html.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}<>]*)\{([^{}]*)\}/g)) {
      if (!/^(?:[\s,]*(?::root|html|\[data-theme[^\]]*\]))+[\s,]*$/.test(r[1])) continue;   // global scope only; §6 scoped variants allowed
      for (const d of r[2].matchAll(/--([\w-]+)\s*:/g)) if (names.has(d[1])) p.push(`${name}: re-declares --${d[1]} globally`);
    }
    for (const k of RETIRED) if (new RegExp(`var\\(\\s*--${k}\\s*[,)]|--${k}\\s*:`).test(html.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''))) p.push(`${name}: retired 12a token --${k}`);
  }
  const n = v => String(v).replace(/\s+/g, '').toLowerCase();
  for (const [k, v] of Object.entries(FOUNDATION)) if (!T[k] || n(T[k]) !== n(v)) p.push(`tokens.css --${k} = ${T[k]} want ${v}`);
  return p;
}
test('tokens: one colour file (tokens.css) loaded first on both pages, no page re-declares it, no 12a token left', () => {
  assert.deepEqual(tokenProblems(DASH, ACCT), []);
  const mut = {
    drift: [DASH, ACCT.replace('</style>', '  :root{ --text-label:#A3AABF; }\n</style>')],
    staleCard: [DASH, ACCT, TOKENS_CSS.replace('--card:        #10131D;', '--card:        #0E1019;')],
    proLost: [DASH, ACCT, TOKENS_CSS.replace(/\n\s*--pro:[^\n]*/, '')],
    notLoaded: [DASH, ACCT.replace('<link rel="stylesheet" href="./tokens.css">', '')],
    loadedLate: [DASH.replace('<link rel="stylesheet" href="./tokens.css">', '').replace('</head>', '<link rel="stylesheet" href="./tokens.css">\n</head>'), ACCT],
    periwinkleBack: [DASH.replace('</style>', '  .ten286-probe{ color:var(--periwinkle); }\n</style>'), ACCT],
  };
  for (const [name, [d, a, t]] of Object.entries(mut)) {
    assert.ok(d !== DASH || a !== ACCT || (t && t !== TOKENS_CSS), `mutant ${name} must change something`);
    assert.notDeepEqual(tokenProblems(d, a, t), [], `mutant survived: ${name}`);
  }
});

// ── the reference file is versioned and never published ─────────────────────────────
const REF_SHA = 'eca997f9cd1b5ac8f55ca96a6c685bceb0ff61bccd795eafea8699878bdfede9';
function refProblems(pipe) {
  const p = [];
  if (createHash('sha256').update(readFileSync(join(HERE, 'design/reference/portal-12a.html'))).digest('hex') !== REF_SHA) p.push('reference file changed');
  for (const line of pipe.split('\n')) {
    if (!/_site/.test(line)) continue;
    if (/\bdesign\b\//.test(line) || /\bcp\s+-[a-zA-Z]*r[a-zA-Z]*\s+\.(\s|\/)/.test(line) || /rsync[^\n]*\s\.\/?\s/.test(line)) p.push('publishes design/ or the whole tree: ' + line.trim());
  }
  return p;
}
test('design/reference/portal-12a.html is the committed reference and the pipeline never publishes it', () => {
  assert.deepEqual(refProblems(PIPE), []);
  const mut = { publishRef: PIPE + '\n          cp design/reference/portal-12a.html _site/\n', copyTree: PIPE + '\n          cp -r . _site/\n' };
  for (const [name, pipe] of Object.entries(mut)) assert.notDeepEqual(refProblems(pipe), [], `mutant survived: ${name}`);
});

// ── no dead CSS: nothing overridden by an identical later rule, no orphan custom property ──
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
function deadCount(pageHtml, name) {
  const d = mkdtempSync(join(tmpdir(), 'dead286-'));
  try {
    writeFileSync(join(d, name), pageHtml);
    if (name !== 'account.html') copyFileSync(join(HERE, 'account.html'), join(d, 'account.html'));
    for (const f of ['player-profile-v2.js', 'live-tab.js', 'trading-report.js', 'series.js', 'holdbreak-heatmap.js', 'price-history-box.js', 'kibl-now-stream.js', 'auth.js', 'series.css', 'drops-page.js', 'drops-page.css', 'theme.js', 'tokens.css'])
      try { copyFileSync(join(HERE, f), join(d, f)); } catch {}
    const r = spawnSync('python3', [join(HERE, 'tools/css-dead-declarations.py'), join(d, name)], { encoding: 'utf8' });
    const m = /: (\d+) dead declarations, (\d+) emptied rules/.exec(r.stdout || '');
    if (!m) throw new Error('tool output: ' + r.stdout + r.stderr);
    return +m[1] + +m[2];
  } finally { rmSync(d, { recursive: true, force: true }); }
}
test('no dead CSS on either page (tools/css-dead-declarations.py finds nothing)', () => {
  assert.equal(deadCount(DASH, 'bsp-consult-dashboard.html'), 0);
  assert.equal(deadCount(ACCT, 'account.html'), 0);
  // mutants: a shadowed duplicate declaration, an orphan variable
  assert.ok(deadCount(DASH.replace('</body>', `<style>${M} .mx-chip{ padding:1px; }\n${M} .mx-chip{ padding:9px 16px; }</style></body>`), 'bsp-consult-dashboard.html') > 0, 'mutant survived: shadowed');
  const orphan = ACCT.replace('</style>', '  :root{ --orphan-286:#123456; }\n</style>');
  assert.notEqual(orphan, ACCT, 'the orphan mutant must actually change the page');
  assert.ok(deadCount(orphan, 'account.html') > 0, 'mutant survived: orphan var');
});

// ── no hard-coded colour hides in the shipped files (TEN-376) ────────────────────────────────────────────
// The TEN-285 12a recolour engine and tokeniser mapped literals onto the 12a palette (and re-wrote 1px hairlines to
// 0.33px); the foundation retired that palette, so their fixed point is no longer the ruling. The foundation
// equivalent is the one colour lint (tools/lint-raw-colours.mjs, first step of npm test): every file below carries
// zero raw colours — hex, rgb(a), hsl(a) — and a literal planted in CSS text or a style attribute is caught.
import { scan as rawColours } from './tools/lint-raw-colours.mjs';
const SHIPPED = ['bsp-consult-dashboard.html', 'player-profile-v2.js', 'live-tab.js', 'trading-report.js', 'holdbreak-heatmap.js',
  'series.js', 'series.css', 'price-history-box.js', 'kibl-now-stream.js', 'account.html', 'drops-page.js', 'drops-page.css'];
const rawIn = (mutate) => SHIPPED.flatMap(f => { let s = read(f); if (mutate && f === 'bsp-consult-dashboard.html') s = mutate(s); return rawColours(s).map(h => `${f}:${h.line} ${h.value}`); });
test('no raw colour in the shipped files: tokens.css is the only colour file (was: the 12a recolour engine\'s fixed point)', () => {
  assert.deepEqual(rawIn(), []);
  assert.equal(rawIn(s => s.replace('</style>', '  .ten286-probe{ color:#e7e9ee; }\n</style>')).length, 1, 'mutant survived: a retired palette literal in CSS');
});
test('no colour value is hard-coded in a style attribute (was: the 12a tokeniser finds nothing to rewrite)', () => {
  assert.equal(rawIn(s => s.replace('</body>', '<div style="color:#6e7a93">x</div></body>')).length, 1, 'mutant survived: a hard-coded label colour in a style attribute');
  assert.equal(rawIn(s => s.replace('</body>', '<div style="border:1px solid rgba(255,255,255,0.06)">x</div></body>')).length, 1, 'mutant survived: an rgba hairline');
});
