#!/usr/bin/env node
/**
 * ten206-phaseA-probe.mjs — the PHASE A ship gate, read off a real browser.
 *
 * WHAT THIS ASSERTS, and why each one is here rather than in the unit suite:
 *
 *   A1  the eight boxes, in the v7 order, with the v7 titles          — DOM order
 *   A2  each headline's COMPUTED font-size is the per-box `size`      — computed
 *       style, not the source constant: the char-length rule this replaces lived
 *       in the renderer, so reading the constant back would prove nothing
 *   A3  box chrome (bg, border, radius, padding, gap, min-height, icon)— computed
 *   A4  every box opens; modal title, subtitle and max-width per §5.1 — driven
 *   A6  no tile shows a bare 0 / 0% where the figure is unwired       — text
 *   (d) every box headline is the figure its modal opens on           — recomputed
 *
 * The reconciliation step is the point. It re-derives each headline from the
 * RENDERED MODAL rather than from the JSON that fed it, because the failure this
 * is built to catch is a tile and its modal disagreeing — which looks perfectly
 * fine in a screenshot of either one alone.
 *
 * Run against the hybrid server (branch code + deployed data), never the local
 * worktree alone: see ten206-hybrid-server.mjs for why that distinction cost a
 * whole run once.
 *
 * Usage: node ten206-phaseA-probe.mjs <baseUrl> <key> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8732').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WANT = [
  { key: 'career',  title: 'Career record',         size: 26, width: 820,
    // RULING Q4 (2026-09-18): "indoors" is back, the Ratings clause is gone
    // until phase C, and a "· since <year>" tail rides on a CONDITION -- so this
    // is a PREFIX match with the two amendments asserted explicitly below.
    subtitlePrefix: 'Record by surface, indoors and by season' },
  { key: 'season',  title: 'Calendar record',       size: 26, width: 1180 },
  { key: 'tourn',   title: 'Record per tournament', size: 30, width: 1120,
    subtitle: 'Career win–loss at every event he has played' },
  { key: 'speed',   title: 'Court speed record',    size: 22, width: 1120,
    subtitle: 'Win rate by court pace band' },
  { key: 'splits',  title: 'Draw record',           size: 20, width: 900,
    subtitle: 'Record and win rate by level, format, round and opponent' },
  { key: 'styles',  title: 'Matchup record',        size: 30, width: 820,
    subtitle: 'Win rate by opposing archetype · minimum 5 matches' },
  { key: 'market',  title: 'Market edge',           size: 26, width: 1080,
    subtitle: 'How the market has priced him, and what backing him flat has returned' },
  { key: 'profile', title: 'Live trading',          size: 30, width: 820 }
];

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; fails.push(`${name} :: ${detail}`); console.log(`  FAIL  ${name}  -- ${detail}`); }
}

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

const dport = 9500 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'phaseA-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });

for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}
const pp2 = await ev(`typeof FEATURE_PP2 !== 'undefined' ? !!FEATURE_PP2 : (window.FEATURE_PP2 === true)`);
console.log(`BASE=${BASE}  FEATURE_PP2=${pp2}  keys=${KEYS.join(',')}\n`);
if (!pp2) { console.log('ABORT: V2 renderer is not the default on this build.'); process.exit(1); }

const report = [];

for (const key of KEYS) {
  const got = await ev(`typeof ensurePlayerProfile === 'function'
    ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { console.log(`${key}: ERROR profiles/${key}.json did not load`); fail += 1; continue; }
  await ev(`(typeof showPlayerProfileV2 === 'function' ? showPlayerProfileV2 : showPlayerProfile)(${JSON.stringify(key)})`);
  for (let i = 0; i < 160; i++) {
    if (await ev(`!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}])`)) break;
    await sleep(250);
  }
  await sleep(900);

  const name = await ev(`(function(){var h=document.querySelector('.pp2-main');
    return h?(h.textContent||'').replace(/\\s+/g,' ').replace(/^\\s*Back to Players\\s*/,'').trim().slice(0,40):'';})()`);
  console.log(`\n═══ ${key} · ${name} ═══`);

  // ── the hidden-subtree trap, closed before a single style is read ─────────
  //
  // The profile mounts inside a `.tabpage` that the dashboard leaves at
  // `display:none` until its nav shows it, and this page has no router to do
  // that for us. getComputedStyle() on an unlaid-out subtree returns the
  // SPECIFIED value, so every "computed" assertion below would have read back
  // the very inline string it was meant to verify and passed on markup the
  // browser never laid out. The first run of this probe did exactly that: it
  // reported the 4-column grid as 3 columns because it was parsing the literal
  // text "repeat(4, minmax(0px, 1fr))".
  //
  // So: reveal the ancestor, then REFUSE TO MEASURE unless the boxes have real
  // width. The guard is the failing control — without it the probe is green on
  // a page that painted nothing.
  await ev(`(function(){
    var el = document.querySelector('.pp2-main');
    while (el && el !== document.body) {
      if (getComputedStyle(el).display === 'none') el.style.display = 'block';
      el = el.parentElement;
    }
  })()`);
  await sleep(350);
  const laid = await ev(`(function(){
    var g = document.querySelector('.pp2-grid'), b = document.querySelector('[data-pp2="box"]');
    return { gridW: g ? g.offsetWidth : 0, boxW: b ? b.offsetWidth : 0 };
  })()`);
  ok(`${key} · the box grid is actually laid out (not a hidden subtree)`,
    laid.gridW > 600 && laid.boxW > 100, `gridW=${laid.gridW} boxW=${laid.boxW}`);
  if (!(laid.gridW > 600)) { console.log('  ABORT: nothing below this is a real measurement.'); continue; }

  // ── A1/A2/A3 · the tiles as the browser actually lays them out ────────────
  const tiles = await ev(`(function(){
    return Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]')).map(function(b){
      var cs = getComputedStyle(b);
      var kids = b.children;                       // svg, headline, title, support
      var hl = b.querySelector('div[style*="IBM Plex Mono"]');
      var divs = Array.prototype.filter.call(kids, function(n){ return n.tagName === 'DIV'; });
      var hcs = hl ? getComputedStyle(hl) : null;
      var sufEl = hl ? hl.querySelector('span') : null;
      return {
        key: b.getAttribute('data-box'),
        headline: hl ? (hl.textContent||'').trim() : null,
        headlineSize: hcs ? Math.round(parseFloat(hcs.fontSize)) : null,
        headlineWeight: hcs ? hcs.fontWeight : null,
        headlineColour: hcs ? hcs.color : null,
        suffix: sufEl ? (sufEl.textContent||'').trim() : null,
        suffixColour: sufEl ? getComputedStyle(sufEl).color : null,
        title: divs[1] ? (divs[1].textContent||'').trim() : null,
        titleSize: divs[1] ? getComputedStyle(divs[1]).fontSize : null,
        support: divs[2] ? (divs[2].textContent||'').trim() : null,
        supportSize: divs[2] ? getComputedStyle(divs[2]).fontSize : null,
        supportColour: divs[2] ? getComputedStyle(divs[2]).color : null,
        bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        radius: cs.borderTopLeftRadius, padding: cs.paddingTop + ' ' + cs.paddingLeft,
        gap: cs.rowGap, minH: cs.minHeight
      };
    });
  })()`);

  ok(`${key} · eight boxes in the v7 order`,
    JSON.stringify(tiles.map(t => t.key)) === JSON.stringify(WANT.map(w => w.key)),
    `got ${tiles.map(t => t.key).join(',')}`);

  // Count RESOLVED tracks: a laid-out grid reports pixel widths ("252px 252px
  // ..."), so a token count is only meaningful once the guard above has passed.
  const grid = await ev(`(function(){var g=document.querySelector('.pp2-grid');
    if(!g)return null;var cs=getComputedStyle(g);var t=cs.gridTemplateColumns;
    return {raw:t, cols:t.split(/\\s+/).filter(function(x){return /px$/.test(x);}).length, gap:cs.gap};})()`);
  ok(`${key} · grid resolves to 4 columns, gap 12px`,
    grid && grid.cols === 4 && grid.gap === '12px', JSON.stringify(grid));

  // A1's responsive steps, driven by actually resizing the viewport rather than
  // by reading the rule back out of the stylesheet — a media query that never
  // matches reads identically to one that does.
  for (const [w, want] of [[1000, 2], [640, 1], [1440, 4]]) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(260);
    const cols = await ev(`(function(){var g=document.querySelector('.pp2-grid');
      return g ? getComputedStyle(g).gridTemplateColumns.split(/\\s+/)
        .filter(function(x){return /px$/.test(x);}).length : 0;})()`);
    if (w !== 1440) {
      ok(`${key} · at ${w}px the grid is ${want} column${want > 1 ? 's' : ''}`,
        cols === want, `got ${cols}`);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(200);

  // A3 hover border — set on the class, so it needs a real :hover to observe.
  const hover = await ev(`(function(){
    var b = document.querySelector('[data-pp2="box"]');
    if (!b) return null;
    var before = getComputedStyle(b).borderTopColor;
    return { before: before };
  })()`);
  // The box has to be UNDER the cursor, so it has to be on screen first: the
  // tile sits below the fold at 1440×1000 and the first attempt dispatched the
  // move at a negative y, hovering nothing and reporting the resting border.
  const at = await ev(`(function(){
    var b = document.querySelector('[data-pp2="box"]');
    b.scrollIntoView({ block: 'center' });
    var r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
             onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
  })()`);
  ok(`${key} · the hover target is on screen before the move`, at.onScreen,
    `rect centre ${at.x},${at.y}`);
  await send('Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await sleep(260);
  const hovered = await ev(`(function(){var b=document.querySelector('[data-pp2="box"]');
    return getComputedStyle(b).borderTopColor;})()`);
  ok(`${key} · box hover border is rgba(91,155,255,0.35)`,
    hovered === 'rgba(91, 155, 255, 0.35)' && hovered !== hover.before,
    `resting ${hover.before} -> hovered ${hovered}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });

  for (const w of WANT) {
    const t = tiles.filter(x => x.key === w.key)[0];
    if (!t) { ok(`${key} · ${w.key} present`, false, 'tile missing'); continue; }
    ok(`${key} · ${w.key} title "${w.title}"`, t.title === w.title, `got "${t.title}"`);
    ok(`${key} · ${w.key} headline ${w.size}px`, t.headlineSize === w.size,
      `computed ${t.headlineSize}px on "${t.headline}"`);
    // A3 chrome, identical on all eight
    ok(`${key} · ${w.key} chrome`,
      t.bg === 'rgb(10, 13, 20)' && t.radius === '10px' &&
      t.padding === '18px 16px' && t.gap === '7px' && t.minH === '140px' &&
      t.supportSize === '10.5px' && t.titleSize === '13.5px',
      `bg=${t.bg} r=${t.radius} p=${t.padding} gap=${t.gap} minH=${t.minH} sup=${t.supportSize} ttl=${t.titleSize}`);
    // A6 · a dash is #4b5672 and a figure is never a bare zero
    if (t.headline === '—') {
      ok(`${key} · ${w.key} dash is #4b5672`, t.headlineColour === 'rgb(75, 86, 114)',
        `got ${t.headlineColour}`);
    } else {
      ok(`${key} · ${w.key} headline is not a bare zero`,
        !/^(0|0\.0%|0%|0–0)$/.test(t.headline), `headline reads "${t.headline}"`);
    }
    report.push({ player: name, box: w.key, title: t.title,
      headline: t.headline, size: t.headlineSize, support: t.support });
  }

  // the one coloured headline (A1)
  const tn = tiles.filter(x => x.key === 'tourn')[0];
  const coloured = tiles.filter(x => x.suffix);
  ok(`${key} · tourn is the ONLY coloured headline`,
    coloured.length <= 1 && (!coloured.length || coloured[0].key === 'tourn'),
    `coloured: ${coloured.map(c => c.key).join(',') || 'none'}`);
  if (tn && tn.suffix) {
    ok(`${key} · tourn suffix is a unit letter tinted by sign`,
      tn.suffix === 'u' &&
      (tn.suffixColour === 'rgb(61, 214, 140)' || tn.suffixColour === 'rgb(224, 97, 111)'),
      `suffix="${tn.suffix}" colour=${tn.suffixColour}`);
  }

  // ── A4 + (d) · open every box, read the shell, reconcile the headline ─────
  for (const w of WANT) {
    await ev(`(function(){var b=document.querySelector('[data-pp2="box"][data-box=${JSON.stringify(w.key)}]');
      if(b) b.click();})()`);
    await sleep(450);
    const modal = await ev(`(function(){
      var sc = document.querySelector('[data-pp2="scrim"]');
      if (!sc) return null;
      var card = sc.querySelector('[data-pp2="card"]');
      var head = card ? card.firstElementChild : null;
      var ttl = head ? head.querySelector('div[style*="font-weight:800"]') : null;
      var sub = ttl && ttl.nextElementSibling ? ttl.nextElementSibling : null;
      var body = card ? card.lastElementChild : null;
      return {
        title: ttl ? (ttl.textContent||'').trim() : null,
        subtitle: sub ? (sub.textContent||'').trim() : null,
        maxWidth: card ? getComputedStyle(card).maxWidth : null,
        rows: body ? body.querySelectorAll('div').length : 0,
        text: body ? (body.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 4000) : ''
      };
    })()`);
    if (!modal) { ok(`${key} · ${w.key} opens`, false, 'no scrim'); continue; }
    ok(`${key} · ${w.key} modal title "${w.title}"`, modal.title === w.title, `got "${modal.title}"`);
    ok(`${key} · ${w.key} modal max-width ${w.width}px`, modal.maxWidth === w.width + 'px',
      `got ${modal.maxWidth}`);
    if (w.subtitle) {
      ok(`${key} · ${w.key} subtitle is the v7 string`, modal.subtitle === w.subtitle,
        `got "${modal.subtitle}"`);
    }
    if (w.subtitlePrefix) {
      const sub = modal.subtitle || '';
      ok(`${key} · ${w.key} subtitle starts with the ruled Q4 string`,
        sub.startsWith(w.subtitlePrefix), `got "${sub}"`);
      ok(`${key} · ${w.key} subtitle carries "indoors"`, /\bindoors\b/.test(sub), `got "${sub}"`);
      ok(`${key} · ${w.key} subtitle does NOT promise the phase-C Ratings tab`,
        !/ratings against the field/.test(sub), `got "${sub}"`);
      // The scope label is conditional, so assert the CONDITION, not the string:
      // present iff the grid reaches further back than the career spine.
      const scope = await ev(`(function(){
        var I = window.PlayerProfileV2 && window.PlayerProfileV2._internals;
        if (!I) return null;
        var p = Object.assign({ key: ${JSON.stringify(String(key))} },
          (window.playerProfiles.players || {})[${JSON.stringify(String(key))}]);
        var cs = I.calScope(p), fy = I.spineFirstYear(p);
        return { from: cs.from, fy: fy };
      })()`);
      if (scope && scope.from && scope.fy) {
        const narrower = String(scope.from) < String(scope.fy);
        ok(`${key} · ${w.key} scope label matches the window (grid ${scope.from}, spine ${scope.fy})`,
          /· since \d{4}$/.test(sub) === narrower, `got "${sub}", narrower=${narrower}`);
      }
    }
    // A modal that opens empty is the failure this catches — but an HONEST
    // empty state is not empty, it is a stated reason. Rincon has no
    // career-splits row at all (only 227 of 428 profiled players do), and his
    // Draw record correctly renders one div saying so. That must pass; a blank
    // body must not.
    const emptyReason = /no .{0,40}(on record|for this player|minimum|not loaded)/i.test(modal.text);
    ok(`${key} · ${w.key} modal painted a body (or stated why it is empty)`,
      modal.rows > 3 || (emptyReason && modal.text.length > 15),
      `${modal.rows} divs, text="${modal.text.slice(0, 90)}"`);

    // ── verify step (d) · the headline IS the figure the modal opens on ─────
    const tile = tiles.filter(x => x.key === w.key)[0];
    if (tile && tile.headline && tile.headline !== '—') {
      if (w.key === 'career') {
        // RECOMPUTED, not string-matched. §5.2B prints the season grid as
        // "W/L" with a slash while the tile prints an en-dash record, so the
        // two are the same number in two locked notations and a substring test
        // would fail on a page that is entirely correct — which is what the
        // first run of this probe did. The real §4 assertion is arithmetic:
        // sum every season row and compare to the tile.
        // Read the season table by GEOMETRY, not by text. §5.2B renders it as a
        // flat CSS grid — every cell is a sibling div with no row wrapper — so
        // `textContent` concatenates the cells with no separator at all
        // ("…—2/2201759/2316/4…"), which is genuinely ambiguous to parse and is
        // how the first version of this check reported zero season rows on a
        // table that was rendering perfectly. Cells are grouped into rows by
        // their offsetTop and the Total column is taken as the first "w/l" cell
        // on each row.
        const sum = await ev(`(function(){
          var sc = document.querySelector('[data-pp2="scrim"]');
          var body = sc && sc.querySelector('[data-pp2="card"]').lastElementChild;
          if (!body) return null;
          var cells = Array.prototype.slice.call(body.querySelectorAll('div'))
            .filter(function (d) { return !d.children.length; })
            .map(function (d) { var r = d.getBoundingClientRect();
                                return { t: (d.textContent||'').trim(),
                                         mid: r.top + r.height / 2, left: r.left }; });
          // Grouped on the vertical CENTRE with a tolerance, not on an exact
          // top. The Career footer sets its own padding and weight, so its label
          // and its figures do not share a pixel-identical top and an exact-top
          // bucket split that one row in two — which is why the footer read null
          // while all twelve season rows summed correctly.
          cells.sort(function (a, b) { return a.mid - b.mid; });
          var rows = [], cur = null;
          cells.forEach(function (c) {
            if (!cur || Math.abs(c.mid - cur.mid) > 9) { cur = { mid: c.mid, cells: [] }; rows.push(cur); }
            cur.cells.push(c);
          });
          var w = 0, l = 0, n = 0, footW = null, footL = null;
          rows.forEach(function (rw) {
            var row = rw.cells.sort(function (a, b) { return a.left - b.left; });
            // The label is not reliably the leftmost cell — the Career footer's
            // label sits in the second column — so the row is scanned for a
            // label, and the Total is the first w/l cell to the RIGHT of it.
            var li = -1;
            for (var i = 0; i < row.length; i++) {
              if (/^(Career|20\\d\\d)$/.test(row[i].t)) { li = i; break; }
            }
            if (li < 0) return;
            var wl = null;
            for (var j = li + 1; j < row.length; j++) {
              var m = row[j].t.match(/^(\\d+)\\/(\\d+)$/);
              if (m) { wl = m; break; }
            }
            if (!wl) return;
            if (row[li].t === 'Career') { footW = +wl[1]; footL = +wl[2]; return; }
            w += +wl[1]; l += +wl[2]; n += 1;
          });
          return { footW: footW, footL: footL, sumW: w, sumL: l, seasons: n };
        })()`);
        const tileW = Number(tile.headline.split('–')[0]);
        const tileL = Number(tile.headline.split('–')[1]);
        ok(`${key} · career: tile = modal footer = sum of ${sum && sum.seasons} season rows`,
          sum && sum.footW === tileW && sum.footL === tileL &&
          sum.sumW === tileW && sum.sumL === tileL,
          `tile ${tileW}/${tileL} · footer ${sum && sum.footW}/${sum && sum.footL} · ` +
          `rows ${sum && sum.sumW}/${sum && sum.sumL} over ${sum && sum.seasons} seasons`);
      } else if (w.key === 'season' || w.key === 'profile') {
        // Reported, not gated: `season` states its figure as calendar cells and
        // `profile` opens on a body phase C has not rebuilt yet. Named here so
        // the gap is visible rather than silently skipped.
        const inBody = modal.text.indexOf(tile.headline) > -1;
        console.log(`  NOTE  ${key} · ${w.key} headline "${tile.headline}" ` +
          `${inBody ? 'found' : 'NOT found'} verbatim in the modal body (reported, not gated)`);
      } else {
        const fig = tile.headline.replace(/u$/, '');
        ok(`${key} · ${w.key} headline "${tile.headline}" appears in its own modal`,
          modal.text.indexOf(fig) > -1, `"${fig}" absent from the ${w.key} body`);
      }
    }
    await ev(`(function(){var c=document.querySelector('[data-pp2="close"]'); if(c) c.click();})()`);
    await sleep(220);
  }
}

console.log(`\n────────────────────────────────────────────────`);
console.log(`PASS ${pass}   FAIL ${fail}   JS errors ${errors.length}`);
if (errors.length) errors.slice(0, 6).forEach(e => console.log('  JS  ' + e));
if (fails.length) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('\nTILE TABLE');
for (const r of report) {
  console.log(`  ${(r.player+'                    ').slice(0,18)} ${(r.box+'        ').slice(0,8)} ` +
    `${(String(r.size)+'px  ').slice(0,5)} ${(r.headline+'                 ').slice(0,17)} | ${r.title} | ${r.support}`);
}
fs.writeFileSync('phaseA-report.json', JSON.stringify({ pass, fail, errors, fails, report }, null, 2));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
