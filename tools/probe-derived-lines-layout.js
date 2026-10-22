// tools/probe-derived-lines-layout.js — founder 2026-10-22 (Derived lines: nothing moves when a filter or card changes).
//
// Renders the Market edge → Derived lines tab in headless Chrome for every Window × Tier × format × card state (54) at
// several widths, and measures, per state: the title (text and box), every Window / Tier / format button, the three
// coverage cards, and the top edge of the table (or of the empty-state box). PASS = one layout per width.
//
// A BROWSER PROBE, run by hand — not wired into npm test (it launches Chrome ~270 times; layout needs a real engine).
// The structural half (fixed title, button and card width/height reserves, control order) is gated in npm test by
// tools/test-derived-lines-drill.js "S". Data: the pinned TEN-384 fixture plus the gate's constructed rows, so the
// states include empty tables (a "—" card subtitle) without any network.
//
// CONTROL: PP2_SRC=<an older player-profile-v2.js> node tools/probe-derived-lines-layout.js — 4af952d4c's build moves
// the table at 400 px (cards change height when a subtitle reads "—").
//
// Run: node tools/probe-derived-lines-layout.js [width …]      (default 1000 760 560 400 340)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((c) => fs.existsSync(c));
if (!CHROME) { console.log('SKIP · no Chrome on this machine — nothing measured (not a pass)'); process.exit(0); }
const SRC = process.env.PP2_SRC ? path.resolve(process.env.PP2_SRC) : path.join(L.ROOT, 'player-profile-v2.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const p = Object.assign({}, FX.profile, { tournamentHistory: FX.tournamentHistory });
const { I } = L.loadPp2({ src: SRC, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory },
  marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History });
const css = fs.readFileSync(path.join(L.ROOT, 'tokens.css'), 'utf8');
const widths = process.argv.slice(2).map(Number).filter(Boolean);
const WIDTHS = widths.length ? widths : [1000, 760, 560, 400, 340];
const states = [];
// founder 2026-10-23 · the Surface filter joins the states (Window × Tier × format × card × Surface = 270)
['career', 'l24', 'l52'].forEach((w) => ['all', 'atp', 'chitf'].forEach((t) => ['bo3', 'bo5'].forEach((f) => ['all', 'fav', 'dog'].forEach((r) =>
  ['all', 'hard', 'indoors', 'clay', 'grass'].forEach((sf) => states.push([w, t, f, r, sf]))))));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-layout-'));
const page = path.join(tmp, 'm.html');
const MEASURE = `const q=(s)=>[...document.querySelectorAll(s)];const R=(e)=>{if(!e)return null;const b=e.getBoundingClientRect();return [b.left,b.top,b.width,b.height].map(v=>Math.round(v*10)/10)};
  const cards=q('[data-pp2="lc-role"]');const title=document.querySelector('[data-lc="title"]')||document.querySelector('[data-pp2-seg="lc-fmt"]').parentNode.previousElementSibling;
  const o={title:[title.textContent,R(title)],btns:q('[data-pp2="lc-win"],[data-pp2="lc-tier"],[data-pp2="lc-fmt"],[data-pp2="lc-surf"]').map(b=>b.dataset.v+':'+R(b)),
    cards:cards.map(R),table:R(document.querySelector('[data-lc="table"]')||cards[0].parentNode.nextElementSibling).slice(0,2)};   // its top edge (left, top): an empty table is a shorter box
  document.getElementById('o').textContent='@@'+JSON.stringify(o)+'@@';`;
let bad = 0;
try {
  for (const width of WIDTHS) {
    const layouts = {};
    for (const [w, t, f, r, sf] of states) {
      Object.assign(I.state, { key: p.key, modal: 'market', marketTab: 'lines', lcFmt: f, lcRole: r, lcWin: w, lcTier: t, lcSurf: sf, lcDrill: null });
      fs.writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0;padding:16px;font-family:var(--font-words,sans-serif)} .wrap{box-sizing:border-box;width:${width - 32}px}</style></head>` +
        `<body><div class="wrap">${I.renderMarketModal(p)}</div><pre id="o"></pre><script>${MEASURE}</script></body></html>`);
      let dom;
      try { dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=2000', `--window-size=${width},1400`, '--dump-dom', 'file://' + page], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
      catch (e) { dom = String(e.stdout || ''); }
      const m = dom.split('@@')[1];
      if (!m) throw new Error('no measurement for ' + [w, t, f, r, sf].join('/') + ' at ' + width);
      const key = m.replace(/&amp;/g, '&');
      (layouts[key] = layouts[key] || []).push([w, t, f, r].join("/")); if (process.env.DUMP) console.log([w,t,f,r].join("/"), key);
    }
    const groups = Object.values(layouts);
    if (groups.length > 1) bad++;
    console.log(`  ${groups.length === 1 ? 'PASS' : 'FAIL'}  ${width}px · ${states.length} states → ${groups.length} layout(s) of title, controls, cards and table top` +
      (groups.length > 1 ? ' :: ' + groups.map((g) => g.length + ' (e.g. ' + g[0] + ')').join(' / ') : ''));
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(bad ? `\n${bad} width(s) move` : '\nnothing moves at any width');
process.exit(bad ? 1 : 0);
