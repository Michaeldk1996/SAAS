// Reconciliation for the rebuilt Career modal, over the DEPLOYED profile file —
// the one the site serves, not the committed copy (they differ: 137 vs 428
// players, 548 vs 0 rows carrying court type).
//
// Recomputes every figure from the raw season rows INDEPENDENTLY of the renderer,
// then asserts the rendered DOM carries those same numbers. A check that read the
// renderer's own arithmetic back out would prove nothing.
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('/tmp/dep-pp.json', 'utf8'));
const PLAYERS = raw.players;
// Same loader shape as tools/test-pp2-reconcile.js, so this script and the unit
// suite are exercising the module identically.
const sandbox = { FEATURE_PP2: true, playerProfiles: { players: PLAYERS }, console };
globalThis.window = sandbox;
const src = fs.readFileSync('player-profile-v2.js', 'utf8');
new Function('window', src)(sandbox);
const I = sandbox.PlayerProfileV2 && sandbox.PlayerProfileV2._internals;
if (!I || !I.state) throw new Error('export shape: ' + Object.keys(sandbox.PlayerProfileV2 || {}).join(','));

// ─── independent recompute, straight off careerByYear ───────────────────────
function independent(p) {
  const years = (p.careerByYear || []).filter(y => y && y.total);
  let tw = 0, tl = 0;
  const col = { clay: null, hard: null, grass: null, indoors: null };
  const add = (a, r) => (!r ? a : (a ? { won: a.won + (r.won || 0), lost: a.lost + (r.lost || 0) }
                                     : { won: r.won || 0, lost: r.lost || 0 }));
  const carve = (s, i) => {
    if (!s) return null;
    if (!i) return s;
    const w = (s.won || 0) - (i.won || 0), l = (s.lost || 0) - (i.lost || 0);
    return (w + l) > 0 ? { won: w, lost: l } : null;
  };
  years.forEach((y) => {
    tw += y.total.won || 0; tl += y.total.lost || 0;
    const ind = y.indoor || null;
    col.clay = add(col.clay, carve(y.clay, ind && ind.clay));
    col.hard = add(col.hard, carve(y.hard, ind && ind.hard));
    col.grass = add(col.grass, carve(y.grass, ind && ind.grass));
    col.indoors = add(col.indoors, ind ? ind.total : null);
  });
  const n = r => (r ? r.won + r.lost : 0);
  const rowsN = n(col.clay) + n(col.hard) + n(col.grass) + n(col.indoors);
  return { total: { won: tw, lost: tl }, n: tw + tl, col, rowsN, residual: (tw + tl) - rowsN };
}

const TARGETS = [
  ['1980', 'A. Zverev (top-10)'],
  ['1775', 'P. Martinez'],
];
// a Challenger-heavy player: pick the one with the largest chitf share
let best = null;
for (const k of Object.keys(PLAYERS)) {
  const cy = PLAYERS[k].careerByYear || [];
  let ch = 0, tot = 0;
  cy.forEach((y) => {
    if (!y || !y.total) return;
    tot += (y.total.won || 0) + (y.total.lost || 0);
    if (y.chitf && y.chitf.total) ch += (y.chitf.total.won || 0) + (y.chitf.total.lost || 0);
  });
  if (tot > 60 && (!best || ch / tot > best.share)) best = { k, share: ch / tot, name: PLAYERS[k].name };
}
if (best) TARGETS.push([best.k, best.name + ' (Challenger-heavy, ' + (best.share * 100).toFixed(0) + '% ch/itf)']);

let fail = 0;
for (const [key, label] of TARGETS) {
  const p = PLAYERS[key];
  if (!p) { console.log('MISSING', key); fail++; continue; }
  const ind = independent(p);
  I.state.key = key; I.state.careerScope = 'career'; I.state.careerDrill = null;
  const html = I.renderCareerModal(p, { archetype: null });

  const order = [...html.matchAll(/<div style="min-width:0;"><div style="font-size:14px;font-weight:700;[^"]*">([^<]+)</g)].map(m => m[1]);
  const footnote = (html.match(/(\d+) match(?:es)? with no surface on record/) || [])[1];
  const rec = s => (ind.col[s] ? ind.col[s].won + '–' + ind.col[s].lost : null);

  console.log('\n═══', label, '(' + p.name + ')');
  console.log('  career total          ', ind.total.won + '–' + ind.total.lost, '=', ind.n, 'matches');
  console.log('  Σ carved surface rows ', ind.rowsN, '+ footnote', ind.residual, '=', ind.rowsN + ind.residual);
  console.log('  row order rendered    ', JSON.stringify(order));
  console.log('  Hard', rec('hard'), '| Grass', rec('grass'), '| Clay', rec('clay'), '| Indoors', rec('indoors'));
  console.log('  footnote rendered     ', footnote == null ? '(none)' : footnote + ' matches');

  const checks = [
    ['Σ rows + footnote = career total', ind.rowsN + ind.residual === ind.n],
    ['row order is Hard·Grass·Clay·Indoors', JSON.stringify(order) === JSON.stringify(['Hard', 'Grass', 'Clay', 'Indoors'])],
    ['no "Unrecorded surface" row', !/Unrecorded surface/.test(html)],
    ['footnote matches the residual', Number(footnote || 0) === ind.residual],
    ['subtitle carries "indoors"', /by surface, indoors and by season/.test(I.modalSubtitle('career', p, {}))],
    ['bars are all on the blue ramp', (html.match(/width:[\d.]+%;background:([^;]+);/g) || [])
      .every(f => /rgba\(91,155,255,/.test(f))],
    ['no one-decimal rate in the rows', !/font-size:19px;font-weight:700;color:#e7e9ee;">\d+\.\d+%/.test(html)],
    ['surface rows open', /data-pp2="career-surf"/.test(html)],
    ['season cells open', /data-pp2="career-cell"/.test(html)],
    ['WINS / LOSSES eyebrow present', /">Wins \/ losses</.test(html)],
    ['file helper copy present', /Click any record to browse those matches/.test(html)],
  ];
  // each surface ROW must equal its own season-table COLUMN
  for (const s of ['hard', 'grass', 'clay', 'indoors']) {
    const c = ind.col[s];
    if (!c) continue;
    const n = c.won + c.lost;
    checks.push(['row ' + s + ' = column ' + c.won + '–' + c.lost,
      html.includes(c.won + '–' + c.lost + ' · ' + n + ' matches')]);
  }
  for (const [name, ok] of checks) {
    console.log('   ', ok ? 'PASS' : 'FAIL', name);
    if (!ok) fail++;
  }
}
console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL RECONCILED'));
process.exit(fail ? 1 : 0);
