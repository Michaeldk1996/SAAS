'use strict';
// 2026-10-25: the early cut (Database book 9 / market-edge 'pinnacle-early', the "E" fill) is never a Pinnacle close.
// Every place that splits rows by book must give it a bucket — the snapshot one — or it throws (the page's Database
// agg() had byb[9] undefined → "Cannot read properties of undefined (reading 'n')", which failed the pre-publish
// reconcile on the first build carrying E rows). Runs the REAL sliced functions; each check names its mutation.
// Run: node tools/test-early-cut-books.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, g) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (g !== undefined ? ' :: ' + JSON.stringify(g) : '')); } };
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
function grabAt(src, sig, from) {
  const i = src.indexOf(sig, from || 0); if (i < 0) throw new Error('missing ' + sig);
  let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return { code: src.slice(i, k + 1), end: k }; }
  throw new Error('unbalanced ' + sig);
}
// both copies of the page's agg() (Database page + the H2H / profile copy)
let at = 0, copies = 0;
for (;;) {
  const i = html.indexOf('function agg(slice){', at); if (i < 0) break;
  const { code, end } = grabAt(html, 'function agg(slice){', at); at = end;
  const med = grabAt(html, 'function median(a){', html.lastIndexOf('function median(a){', i)).code;
  const box = {}; vm.createContext(box); vm.runInContext(med + '\n' + code + '\nthis.agg = agg;', box);
  copies++;
  // Mutation: drop the 9 from the snapshot bucket → byb[9] undefined → throws → red.
  let r = null, err = null; try { r = box.agg([{ p: 1.5, w: 1, b: 0 }, { p: 2.0, w: 0, b: 9 }, { p: 1.8, w: 1, b: 5 }, { p: 1.9, w: 0, b: 1 }]); } catch (e) { err = e.message; }
  ok(`page agg() copy ${copies}: a book-9 row is counted, in the snapshot bucket (never Pinnacle)`, !err && r.n === 4 && r.book.ap && r.book.ap.n === 2 && r.book.ps.n === 1, err || r && r.book);
}
ok('the Database page agg() was found and run', copies === 1, copies);
{ // the per-player records' aggRecs (Player tab) — the second place the page splits rows by book
  const i = html.indexOf('function aggRecs(recs, fading){');
  const code = grabAt(html, 'function aggRecs(recs, fading){').code, med = grabAt(html, 'function median(a){', html.lastIndexOf('function median(a){', i)).code;
  const box = {}; vm.createContext(box); vm.runInContext(med + '\n' + code + '\nthis.aggRecs = aggRecs;', box);
  let r = null, err = null; try { r = box.aggRecs([{ p: 1.5, op: 2.6, w: 1, b: 0 }, { p: 2.0, op: 1.8, w: 0, b: 9 }]); } catch (e) { err = e.message; }
  // Mutation: drop the 9 from aggRecs' snapshot bucket → throws → red.
  ok('page aggRecs(): a book-9 row is counted (no throw)', !err && r.n === 2, err || r);
}
// market edge: the headline book mix
const me = fs.readFileSync(path.join(ROOT, 'build-market-edge.js'), 'utf8');
const addTo = grabAt(me, 'function addTo(a, side) {').code;
const mbox = { core: { plCents: () => 0 } }; vm.createContext(mbox); vm.runInContext(addTo + '\nthis.addTo = addTo;', mbox);
const a = { n: 0, wins: 0, expSum: 0, varSum: 0, profitCents: 0, priceCents: 0, pinnacle: 0, bet365: 0, approx: 0 };
['pinnacle', 'pinnacle-early', 'pinnacle-approx-od10', 'bet365-archive'].forEach(book => mbox.addTo(a, { book, price: 1.8, p: 0.5, won: true }));
// Mutation: count pinnacle-early under pinnacle → pinnacle 2 → red.
ok('market edge: the early cut counts with the snapshots, never as a Pinnacle close', a.pinnacle === 1 && a.approx === 2 && a.bet365 === 1, a);
// profile: the book note
const pp = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
ok('profile book note: pinnacle-early is in the snapshot count', /\(\/\^pinnacle-approx\/\.test\(String\(m\.book \|\| ''\)\) \|\| m\.book === 'pinnacle-early'\) \? ap/.test(pp));
// reconcile: the label set knows the book
const rc = fs.readFileSync(path.join(ROOT, 'tools', 'test-pp2-reconcile.js'), 'utf8');
ok('the pre-publish reconcile labels pinnacle-early and splits it as a snapshot', /'pinnacle-approx-od10', 'pinnacle-early'\]\)/.test(rc) && /m\.book === 'pinnacle-early';/.test(rc));
console.log(`\nearly-cut-books: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
