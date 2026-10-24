// PROBE ONLY: instrument a builder copy (argv[2]) and build-match-closes.js with a per-match source ledger.
const fs = require('fs');
const rep = (f, a, b) => { let s = fs.readFileSync(f, 'utf8'); if (!s.includes(a)) { console.error(`patch: anchor missing in ${f}: ${a.slice(0, 60)}`); process.exit(1); } fs.writeFileSync(f, s.replace(a, b)); };
const mc = 'build-match-closes.js';
if (!fs.readFileSync(mc, 'utf8').includes('__PROBE')) {
  rep(mc, "    if (trueStart == null) { stats.capNoStart++; continue; }", "    const __o = (reason, k1, k2) => (stats.outcomes || (stats.outcomes = [])).push({ id, reason, p1: v.p1, p2: v.p2, k1: k1 || null, k2: k2 || null, cat: v.cat }); // __PROBE\n    if (trueStart == null) { stats.capNoStart++; __o('no start'); continue; }");
  rep(mc, "if (!k1 || !k2 || k1 === k2) { stats.capUnresolved++; continue; }", "if (!k1 || !k2 || k1 === k2) { stats.capUnresolved++; __o('name not resolved', k1, k2); continue; }");
  rep(mc, "if (a == null || b == null) { stats.capOneSided++; continue; }", "if (a == null || b == null) { stats.capOneSided++; __o('one side only', k1, k2); continue; }");
  rep(mc, "out.push({ date: isoDay(trueStart), k1, k2,", "out.push({ id, date: isoDay(trueStart), k1, k2,");
  rep(mc, "      return keys.length === 1 ? keys[0] : null;", "      candMap.set(s, keys); return keys.length === 1 ? keys[0] : null;");
  rep(mc, "    return more.length === 1 ? more[0] : null;", "    candMap.set(s, more); return more.length === 1 ? more[0] : null;");
  rep(mc, "  const first = (s) =>", "  const candMap = new Map();\n  const first = (s) =>");
  rep(mc, "  return {\n    comma,", "  return {\n    comma, candMap,");
}
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
s = s.replace(/mc\.capturedBet365\(LOWER_B365_ROOT, (mc\.makeCommaResolver\([^;]*?\)), st\)/, '(global.__RES = $1, global.__ST = st, mc.capturedBet365(LOWER_B365_ROOT, global.__RES, st))');
if (!s.includes('global.__RES')) { console.error('patch: resolver anchor'); process.exit(1); }
fs.writeFileSync(f, s);
rep(f, "_names: [x.opponent, won], _self: c.n1 }, 6);", "_names: [x.opponent, won], _self: c.n1, _fx: c.id }, 6);");
rep(f, "    if (hits.length !== 1) { lower.b365.noCareerRow++; continue; }", "    if (hits.length !== 1) { lower.b365.noCareerRow++; (st.outcomes || (st.outcomes = [])).push({ id: c.id, reason: hits.length ? 'two career rows' : 'no career row', k1: c.k1, k2: c.k2, p1: c.n1, p2: c.n2 }); continue; }");
rep(f, "for (const r of lowerBest.values()) {\n  const dI =", "global.__LK = []; global.__LDROP = [];\nfor (const [__k, r] of lowerBest.entries()) {\n  const dI =");
rep(f, "!r.loser.trim()) { lower.dropped++; continue; }", "!r.loser.trim()) { lower.dropped++; global.__LDROP.push({ id: __k, book: r.book, fx: r._fx || null, reason: 'no display name' }); continue; }");
rep(f, "  lower.rows++; lower.byLevel[r.level]", "  global.__LK[xRaw.length - 1] = { id: __k, fx: r._fx || null, wk: r.winnerKey || null, lk: r.loserKey || null };\n  lower.rows++; lower.byLevel[r.level]");
rep(f, "writeAtomic(OUT_MASTER,", `{ // __PROBE ledger: one id per priced match + its book; lower rows keyed as lowerBest keys them
  const L = []; const add = (set, d, w, l, book, extra) => L.push(Object.assign({ id: set + '|' + d + '|' + w + '|' + l, set, book }, extra || {}));
  rows.forEach((r, i) => add('db', r[0], names[i][0], names[i][1], r[8]));
  retRaw.forEach(x => add('ret', x[0], x[9], x[10], x[8])); tieRaw.forEach(x => add('tie', x[0], x[9], x[10], x[8]));
  xRaw.forEach((x, i) => { const lk = global.__LK[i]; if (lk) L.push({ id: 'l|' + lk.id, set: 'x' + x[11], book: x[8], fx: lk.fx, wk: lk.wk, lk: lk.lk, d: x[0], w: x[9], l: x[10], ev: x[4] }); else add('x' + x[11], x[0], x[9], x[10], x[8]); });
  const outc = ((global.__ST || {}).outcomes || []).map(o => Object.assign(o, { cands: o.reason === 'name not resolved' ? [o.p1, o.p2].map(n => [n, (global.__RES.candMap.get(String(n).trim()) || [])]) : undefined }));
  fs.writeFileSync(path.join(OUT_DIR, 'ledger.json'), JSON.stringify({ ledger: L, drop: global.__LDROP, outcomes: outc }));
}
writeAtomic(OUT_MASTER,`);
console.log('patched', f);
