// TEN-303 §5 — TEST-ONLY pixel fixture. Never loaded by the live page: it writes a standalone HTML
// file into an output directory you name, which only headless Chrome opens.
//
//   TZ=Europe/Brussels node tools/ten303-pixel-fixture.mjs <outDir>
//
// It feeds the SHIPPED renderer (sliced out of bsp-consult-dashboard.html, the same functions the tab
// runs) the design's own demo match and seed — Sinner v Alcaraz, the 7 books and 9 snapshots that
// `Odds Tab.dc.html`'s oddsFor() generates — inside the extract's wrapper card, with the spec's SOURCE
// palette (before the 12a mapping) so the geometry can be diffed against 01-odds-tab.png / 02-odds-tab.png.
// Writes tab.html (the tab) and popup.html (the Pinnacle pop-up open).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSTS, FNS, slice, constSrc } from './ten303-odds-harness.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node tools/ten303-pixel-fixture.mjs <outDir>'); process.exit(2); }
const dc = fs.readFileSync(path.join(ROOT, 'design', 'handoff-15-odds-tab', 'Odds Tab.dc.html'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');

// 1 · the design's demo data, by running its own oddsFor() (support.js / React stubbed; TS exposed).
const a = dc.indexOf('  oddsFor(AN, S) {'), b = dc.indexOf('\n  renderVals() {');
const body = dc.slice(a + '  oddsFor(AN, S) '.length, b).replace('      books, groups, chart,', '      __TS: TS, books, groups, chart,');
const oddsFor = new Function('React', 'AN', 'S', body.trim().replace(/^\{/, '').replace(/\}\s*$/, ''));
const AN = { seed: 'm0' + 'ATP Washington' + 'J. Sinner', aName: 'J. Sinner', bName: 'C. Alcaraz', aOdds: '1.54', bOdds: '2.62' };
const demo = oddsFor.call({ setState() {} }, { createElement: () => null }, AN, {});
const TS = demo.__TS.map(d => d.getTime());

// 2 · the demo as a shard: each book = one source with 9 snapshots per player.
const iso = ms => new Date(ms).toISOString();
const chart = { books: {}, meta: {} };
demo.books.forEach(bk => {
  chart.books[bk.name] = { p1: bk.aS.map((v, j) => [iso(TS[j]), v]), p2: bk.bS.map((v, j) => [iso(TS[j]), v]) };
  chart.meta[bk.name] = { source: 'demo', group: bk.cls, clock: 'book tick', checkedAt: iso(TS[TS.length - 1]) };
});
const m = { id: 'upcoming-0', p1: AN.aName, p2: AN.bName, startTs: iso(TS[TS.length - 1] + 3600e3),
  oddsMovement: { market: 'Match Winner', books: {}, chart } };
const BOOKS = JSON.stringify(demo.books.map(bk => ({ name: bk.name, group: bk.cls, sources: [bk.name] })));
// The spec's source palette (spec § Colour tokens + the per-element values), before the 12a mapping.
const SPEC_C = JSON.stringify({ a: '#6aaeff', b: '#e7e9ee', up: '#3dd68c', dn: '#e0616f', text: '#e7e9ee', sub: '#8b96b5', label: '#5b6880',
  label3: '#4b5672', caps: '#aab3c8', blue: '#5b9bff', sharp: '#82b4ff', soft: '#8b96b5', row: '#0e1019', pop: '#131623', segTrack: '#0a0d14',
  steamInk: '#06070a', segOnBg: 'rgba(91,155,255,0.16)', segOnBd: 'rgba(91,155,255,0.22)', segTrackBd: 'rgba(255,255,255,0.09)',
  tileBd: 'rgba(255,255,255,0.1)', tileOnBg: 'rgba(91,155,255,0.08)', tileOnBd: 'rgba(91,155,255,0.45)', booksBd: 'rgba(91,155,255,0.35)',
  hdrBd: 'rgba(255,255,255,0.06)', nameRule: 'rgba(255,255,255,0.08)', groupRule: 'rgba(255,255,255,0.06)', rowBd: 'rgba(255,255,255,0.05)',
  popBd: 'rgba(255,255,255,0.07)', panelBd: 'rgba(255,255,255,0.05)', closeBd: 'rgba(255,255,255,0.1)', tabBd: 'rgba(255,255,255,0.1)',
  tabOnBg: 'rgba(91,155,255,0.14)', tabOnBd: 'rgba(91,155,255,0.45)', tipBd: 'rgba(255,255,255,0.09)', backdrop: 'rgba(4,5,9,0.62)',
  popShadow: '0 30px 80px rgba(0,0,0,0.55)', tipShadow: '0 12px 32px rgba(0,0,0,0.5)', grid: 'rgba(255,255,255,0.07)',
  axis: 'rgba(255,255,255,0.12)', hw1: '1px', hw125: '1.25px' });
const over = { AODDS_BOOKS: BOOKS, AODDS_C: SPEC_C };
const consts = CONSTS.map(n => (over[n] ? `const ${n} = ${over[n]};` : constSrc(n, html))).join('\n');
const fns = FNS.map(n => slice(n, html)).join('\n');

const page = mv => `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{ box-sizing:border-box; } body{ margin:0; background:#06070a; -webkit-font-smoothing:antialiased; } ::-webkit-scrollbar{ width:10px; height:10px; } ::-webkit-scrollbar-thumb{ background:rgba(255,255,255,0.08); border-radius:6px; }</style>
</head><body>
<section style="min-height:100vh; background:#06070a; font-family:'Hanken Grotesk',sans-serif; color:#e7e9ee; padding:32px; display:flex; justify-content:center; align-items:flex-start;">
<div data-screen-label="Odds tab" style="width:100%; max-width:1262px; background:#0a0d14; border:1px solid rgba(255,255,255,0.09); border-radius:20px; padding:24px 28px;"><div id="aSectionOdds"></div></div></section>
<script>
Date.now = () => ${TS[TS.length - 1] + 60e3};           // the fixture's "now": one minute after the last snapshot
const newsTz = () => 'Europe/Brussels';
const buildOddsReduced = () => '';
const _ocsOf = () => null;
let _aoTipTimer = null, _aoTipFor = null;
${consts}
${fns}
let _aOdds = { m: ${JSON.stringify(m)}, novig: false, market: 'Match Winner', mv: ${JSON.stringify(mv)} };
document.getElementById('aSectionOdds').innerHTML = buildOddsSection(_aOdds.m);
document.fonts.ready.then(() => { document.body.setAttribute('data-ready', '1'); });
</script></body></html>`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'tab.html'), page(null));
fs.writeFileSync(path.join(OUT, 'popup.html'), page('Pinnacle'));
console.log(JSON.stringify({ out: OUT, books: demo.books.map(b => [b.name, b.aS[0], b.aS[8], b.bS[0], b.bS[8], b.marginLbl]), steam: demo.steam && demo.steam.text,
  first: new Date(TS[0]).toString(), last: new Date(TS[8]).toString() }, null, 1));
