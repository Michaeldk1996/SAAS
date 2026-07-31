#!/usr/bin/env node
/**
 * extract-export-styles.mjs — one-time computed-style extraction of the design export.
 *
 * The design export under design-export/*.html is a set of self-contained Framer
 * bundles: each file ships gzipped resources + a React/Babel template that only
 * becomes a real DOM after the page's own JavaScript runs in a browser. Reading the
 * bundle statically gives you AUTHORED values (and only after unpacking the gzip);
 * this script renders each page in headless Chromium and records COMPUTED values —
 * what the browser actually resolved — for every element, in every state reachable
 * without a login.
 *
 * Output:
 *   design-export/computed-styles.json  — keyed by page-state, then by CSS selector path
 *   design-export/tokens-observed.json  — distinct colour / font-size / font-weight /
 *                                          border-radius / spacing values with usage counts
 *
 * The export is READ-ONLY source: this script never writes into design-export/*.html.
 *
 * Prerequisite (kept out of package.json so the production/pipeline dependency
 * set and CI are untouched — this is a one-time reference-generation tool):
 *   npm i -D playwright && npx playwright install chromium
 *
 * Usage: node tools/extract-export-styles.mjs
 *   (optional) EXTRACT_DATE=YYYY-MM-DD  — stamp a fixed extraction date.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const EXPORT_DIR = path.join(REPO, 'design-export');

// ── Fixed extraction basis ──────────────────────────────────────────────────
// Width the export was designed at. The README pins the standard page content
// container to max-width 1360px and the Match Analysis modal card to max-width
// 1500px; 1440 is the canonical desktop design width that seats the sidebar +
// 1360 content at their designed maxima. Recorded in the output metadata so every
// consumer knows the basis for the bounding boxes.
const VIEWPORT = { width: 1440, height: 900 };
const EXPORT_COMMIT = 'd0ec493';
// Extraction date is passed in (Date.now() is intentionally avoided so re-runs are
// reproducible); falls back to the value baked here at authoring time.
const EXTRACTION_DATE = process.env.EXTRACT_DATE || '2026-07-31';

// The 34 computed properties the task requires, per element.
const STYLE_PROPS = [
  'padding', 'margin', 'width', 'height', 'minWidth', 'maxWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'textTransform', 'color', 'backgroundColor', 'backgroundImage',
  'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'gap', 'rowGap', 'columnGap', 'display', 'flexDirection', 'alignItems',
  'justifyContent', 'opacity', 'boxShadow', 'fill', 'stroke', 'strokeWidth',
];

// ── Page-state plan ─────────────────────────────────────────────────────────
// Each "session" is one page load. Within a session we capture one or more named
// states; actions accumulate in order (mirroring real use), so e.g. the modal is
// opened once and each tab click captures a fresh state. `interaction: true` marks
// a state that required a click/fill to reach (default states need none). Clicks
// are best-effort: a failure is recorded per state and never aborts the session.
const SESSIONS = [
  {
    file: 'login.html',
    captures: [
      { name: 'login', actions: [] },
      // Note: the "Use phone instead" control renders but is inert in this export
      // (clicking it changes no content — phone entry is not implemented in the
      // build; export-report.md lists only Verify as login's second state), so it
      // is not captured as a distinct state.
    ],
  },
  {
    file: 'login.html',
    captures: [
      {
        name: 'login-verify', interaction: true,
        actions: [{ fill: ['input', 'analyst@example.com'] }, { click: 'Continue with email' }],
      },
    ],
  },
  {
    file: 'matches-upcoming.html',
    captures: [
      { name: 'matches-upcoming', actions: [] },
      { name: 'matches-completed', interaction: true, actions: [{ click: 'Completed' }] },
    ],
  },
  {
    file: 'matches-upcoming.html',
    captures: [
      { name: 'modal-key-factors', interaction: true, actions: [{ click: 'See full analysis' }, { click: 'Key factors' }] },
      { name: 'modal-playing-style', interaction: true, actions: [{ click: 'Playing style' }] },
      { name: 'modal-form', interaction: true, actions: [{ click: 'Form' }] },
      { name: 'modal-h2h', interaction: true, actions: [{ click: 'H2H' }] },
      { name: 'modal-match-stats', interaction: true, actions: [{ click: 'Match Stats' }] },
      { name: 'modal-progression', interaction: true, actions: [{ click: 'Progression' }] },
      { name: 'modal-overview', interaction: true, actions: [{ click: 'Overview' }] },
      { name: 'modal-tournament', interaction: true, actions: [{ click: 'Tournament' }] },
      { name: 'modal-weather', interaction: true, actions: [{ click: 'Weather' }] },
      { name: 'modal-odds', interaction: true, actions: [{ click: 'Odds' }] },
    ],
  },
  {
    file: 'matches-upcoming.html',
    captures: [
      { name: 'nav-players', interaction: true, actions: [{ nav: 'Players' }] },
      { name: 'nav-tournaments', interaction: true, actions: [{ nav: 'Tournaments' }] },
      { name: 'tournaments-reports', interaction: true, actions: [{ click: 'Reports' }] },
    ],
  },
  {
    file: 'news.html',
    captures: [
      { name: 'news-reading', actions: [] },
      { name: 'news-compact', interaction: true, actions: [{ click: 'Compact' }] },
      { name: 'news-withdrawals', interaction: true, actions: [{ click: 'Withdrawals & Injuries' }] },
    ],
  },
  {
    file: 'stennisfy-model.html',
    captures: [
      { name: 'stennisfy-match-model', actions: [] },
      { name: 'stennisfy-player-ratings', interaction: true, actions: [{ click: 'Player ratings' }] },
    ],
  },
  {
    file: 'playing-styles.html',
    captures: [
      { name: 'playing-styles', actions: [] },
    ],
  },
  {
    file: 'player-profile.html',
    captures: [
      { name: 'player-profile', actions: [] },
      { name: 'player-profile-clay', interaction: true, actions: [{ click: 'Clay' }] },
      { name: 'player-profile-hard', interaction: true, actions: [{ click: 'Hard' }] },
      { name: 'player-profile-grass', interaction: true, actions: [{ click: 'Grass' }] },
    ],
  },
  {
    file: 'account-settings.html',
    captures: [
      { name: 'account-settings', actions: [] },
      { name: 'account-settings-fractional', interaction: true, actions: [{ click: 'Fractional' }] },
    ],
  },
];

// ── Render helpers ──────────────────────────────────────────────────────────
// The bundle unpacks and React renders asynchronously with no explicit "done"
// signal; poll until the element count stops changing.
async function waitStable(page, { max = 60, step = 400, needed = 4 } = {}) {
  let prev = -1, stable = 0;
  for (let i = 0; i < max; i++) {
    await page.waitForTimeout(step);
    const n = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => prev);
    if (n === prev) { if (++stable >= needed) break; } else stable = 0;
    prev = n;
  }
  return prev;
}

// Click an element by its exact visible text, falling back to a contains match.
// Scoped to the first visible hit. Returns true on success.
async function doClick(page, text) {
  const tries = [
    page.getByText(text, { exact: true }).filter({ visible: true }).first(),
    page.getByText(text, { exact: false }).filter({ visible: true }).first(),
  ];
  for (const loc of tries) {
    try {
      await loc.click({ timeout: 4000 });
      return true;
    } catch { /* try next */ }
  }
  return false;
}

// Sidebar nav items share the .sbseg class; click the one whose text matches.
async function doNav(page, text) {
  try {
    await page.locator('.sbseg', { hasText: text }).first().click({ timeout: 4000 });
    return true;
  } catch {
    return doClick(page, text);
  }
}

async function runActions(page, actions) {
  const failures = [];
  for (const a of actions) {
    let ok = false;
    if (a.click) ok = await doClick(page, a.click);
    else if (a.nav) ok = await doNav(page, a.nav);
    else if (a.fill) {
      try { await page.locator(a.fill[0]).first().fill(a.fill[1], { timeout: 4000 }); ok = true; }
      catch { ok = false; }
    }
    if (!ok) failures.push(a.click || a.nav || (a.fill && `fill ${a.fill[0]}`));
    await waitStable(page, { max: 12, needed: 2 });
  }
  return failures;
}

// ── The in-page extractor ───────────────────────────────────────────────────
// Runs in the browser: walks every element, builds a unique nth-child selector
// path, and reads the required computed properties + bounding box.
function EXTRACT_FN(props) {
  const clsOf = (el) => {
    const c = el.className;
    if (c == null) return '';
    if (typeof c === 'string') return c;
    if (typeof c.baseVal === 'string') return c.baseVal; // SVGAnimatedString
    return String(c);
  };
  const selectorOf = (el) => {
    const seg = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML') {
      const parent = cur.parentNode;
      let idx = 1;
      if (parent) {
        let s = cur;
        while ((s = s.previousElementSibling)) idx++;
      }
      seg.unshift(cur.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      cur = parent;
    }
    return 'html>' + seg.join('>');
  };
  const out = {};
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of props) styles[p] = cs[p];
    const r = el.getBoundingClientRect();
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    out[selectorOf(el)] = {
      tagName: tag.toLowerCase(),
      className: clsOf(el),
      textContent: text,
      bbox: {
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      },
      styles,
    };
  }
  return out;
}

async function extract(page) {
  return page.evaluate(EXTRACT_FN, STYLE_PROPS);
}

// ── Token aggregation ───────────────────────────────────────────────────────
function makeTokenBucket() {
  return { colors: {}, fontSizes: {}, fontWeights: {}, borderRadii: {}, spacing: {} };
}
function bump(map, key) {
  if (key == null) return;
  const k = String(key).trim();
  if (!k) return;
  map[k] = (map[k] || 0) + 1;
}
const COLOR_TRANSPARENT = 'rgba(0, 0, 0, 0)';
function collectTokens(bucket, styles) {
  // Colours: any resolved colour property (skip fully-transparent "no colour"
  // and "none"; a literal black rgb(0,0,0) is a real value and is kept).
  for (const prop of ['color', 'backgroundColor', 'borderColor', 'fill', 'stroke']) {
    const v = styles[prop];
    if (v && v !== COLOR_TRANSPARENT && v !== 'none') {
      // borderColor computed can be a 4-value shorthand; split it.
      for (const part of v.split(/\s+(?![^(]*\))/)) bump(bucket.colors, part);
    }
  }
  bump(bucket.fontSizes, styles.fontSize);
  bump(bucket.fontWeights, styles.fontWeight);
  // Radii: shorthand may carry up to 4 values.
  if (styles.borderRadius && styles.borderRadius !== '0px') {
    for (const part of styles.borderRadius.split(/\s+/)) if (part !== '0px') bump(bucket.borderRadii, part);
  }
  // Spacing: individual padding / margin / gap values.
  for (const prop of ['padding', 'margin', 'gap', 'rowGap', 'columnGap']) {
    const v = styles[prop];
    if (!v || v === 'normal' || v === 'auto') continue;
    for (const part of v.split(/\s+/)) {
      if (part === '0px') continue;
      bump(bucket.spacing, part);
    }
  }
}
// Sort a {value: count} map into a descending-count object.
function sortMap(map) {
  return Object.fromEntries(
    Object.entries(map).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Verify export files exist before launching the browser.
  const files = [...new Set(SESSIONS.map((s) => s.file))];
  for (const f of files) {
    if (!fs.existsSync(path.join(EXPORT_DIR, f))) {
      throw new Error(`Export file missing: ${f}`);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const pages = {};        // stateName -> { selector -> record }
  const pageStates = {};   // stateName -> metadata
  const unreachable = [];  // { state, reason }
  const tokens = makeTokenBucket();

  for (const session of SESSIONS) {
    const url = pathToFileURL(path.join(EXPORT_DIR, session.file)).href;
    const ctx = await browser.newPage({ viewport: VIEWPORT });
    const consoleErrors = [];
    ctx.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 160)));
    try {
      await ctx.goto(url, { waitUntil: 'load', timeout: 60000 });
      await waitStable(ctx);
    } catch (err) {
      for (const cap of session.captures) unreachable.push({ state: cap.name, reason: `page load failed: ${err.message}` });
      await ctx.close();
      continue;
    }

    let allFailures = [];
    for (const cap of session.captures) {
      const failures = await runActions(ctx, cap.actions);
      allFailures = allFailures.concat(failures);
      // If this capture's own actions all failed (and it needed them), the state
      // wasn't reached — record why, but still capture whatever is on screen.
      const iframeCount = ctx.frames().length - 1;
      let records;
      try {
        records = await extract(ctx);
      } catch (err) {
        unreachable.push({ state: cap.name, reason: `extract failed: ${err.message}` });
        continue;
      }
      pages[cap.name] = records;
      for (const rec of Object.values(records)) collectTokens(tokens, rec.styles);
      pageStates[cap.name] = {
        file: session.file,
        requiredInteraction: !!cap.interaction,
        interactionSteps: cap.actions.map((a) => a.click || a.nav || (a.fill && `fill:${a.fill[0]}`)).filter(Boolean),
        elementCount: Object.keys(records).length,
        actionFailures: failures,
        iframeCount,
      };
      if (failures.length) {
        unreachable.push({ state: cap.name, reason: `interaction click(s) not found: ${failures.join(', ')} (captured surrounding state instead)` });
      }
      if (iframeCount > 0) {
        pageStates[cap.name].note = `${iframeCount} nested iframe(s) present — only the main document was extracted`;
      }
    }
    await ctx.close();
  }

  await browser.close();

  const metadata = {
    description: 'Computed styles of the Stennisfy design export, extracted with headless Chromium (Playwright).',
    viewportWidth: VIEWPORT.width,
    viewportHeight: VIEWPORT.height,
    viewportRationale: 'Standard desktop design width; seats the 1360px max content container and sidebar at their designed maxima (README: content max-width 1360px, modal card 1500px).',
    extractionDate: EXTRACTION_DATE,
    exportCommit: EXPORT_COMMIT,
    tool: 'playwright headless chromium',
    styleProperties: STYLE_PROPS,
    colourFormat: 'computed rgb()/rgba() (browser-resolved, not authored hex)',
    pageStateCount: Object.keys(pages).length,
    totalElements: Object.values(pages).reduce((n, p) => n + Object.keys(p).length, 0),
    unreachable,
    inertControls: [
      'login.html "Use phone instead": renders but clicking changes no content (phone entry not implemented in the export); no distinct state captured.',
    ],
    notes: [
      'Standalone tournaments.html is intentionally absent from the export; Tournaments is an in-app view of matches-upcoming.html and is captured as nav-tournaments / tournaments-reports.',
      'No page mounted nested iframes at this viewport, so every state reflects a single-document extraction.',
    ],
  };

  const computed = { metadata, pageStates, pages };
  const tokensOut = {
    metadata: {
      ...Object.fromEntries(Object.entries(metadata).filter(([k]) => ['viewportWidth', 'extractionDate', 'exportCommit', 'colourFormat'].includes(k))),
      note: 'Distinct computed values across every extracted page-state, with the number of elements using each. Counts are per-element occurrences (a 4-value shorthand contributes each distinct part). This is the token set AS BUILT (computed), which differs from the authored hex census in export-report.md.',
    },
    colors: sortMap(tokens.colors),
    fontSizes: sortMap(tokens.fontSizes),
    fontWeights: sortMap(tokens.fontWeights),
    borderRadii: sortMap(tokens.borderRadii),
    spacing: sortMap(tokens.spacing),
  };

  fs.writeFileSync(path.join(EXPORT_DIR, 'computed-styles.json'), JSON.stringify(computed, null, 2));
  fs.writeFileSync(path.join(EXPORT_DIR, 'tokens-observed.json'), JSON.stringify(tokensOut, null, 2));

  // Console summary.
  console.log(`\nExtracted ${metadata.pageStateCount} page-states, ${metadata.totalElements} elements total.`);
  console.log('States:', Object.keys(pages).join(', '));
  if (unreachable.length) {
    console.log('\nCould not reach / partial:');
    for (const u of unreachable) console.log(`  - ${u.state}: ${u.reason}`);
  }
  console.log('\nWrote design-export/computed-styles.json and design-export/tokens-observed.json');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
