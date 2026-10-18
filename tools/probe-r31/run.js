// probe r31 — started-evidence as built vs the same join required to name the same event (tournament-identity.js)
const fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2]);
const TI = require(path.resolve('tournament-identity.js'));
const src = fs.readFileSync(path.resolve('tools/started-evidence.js'), 'utf8');
const anchor = "        return oppK && surnameOf(x.opponent).includes(oppK.surname);";
if (src.split(anchor).length !== 2) throw new Error('anchor');
const patched = src.replace(anchor, "        return oppK && surnameOf(x.opponent).includes(oppK.surname) && SAME(x.tournament, r.tournament, x.date, r.date);")
  .replace("const WINDOW = [-16, 3];", "const WINDOW = [-16, 3]; const SAME = global.__SAME;")
  .replace(/require\('\.\.\//g, "require('" + path.resolve('.') + "/").replace("if (require.main === module)", "if (false)");
const id = n => { try { return TI.identityKey(n); } catch (e) { return null; } };
global.__SAME = (a, b) => { const x = id(a), y = id(b); return !!x && !!y && x === y; };
fs.writeFileSync('tools/probe-r31/patched.js', patched);
const A = require(path.resolve('tools/started-evidence.js')).build(root);
const B = require(path.resolve('tools/probe-r31/patched.js')).build(root);
console.log('### counts before ' + JSON.stringify(A.counts));
console.log('### counts after  ' + JSON.stringify(B.counts));
const key = x => [x.date, x.winner, x.loser].join('|');
const bm = new Map(B.matches.map(x => [key(x), x]));
const changed = A.matches.filter(x => bm.get(key(x)).verdict !== x.verdict).map(x => ({ td: [x.date, x.tournament, x.round, x.winner, x.loser, x.comment], before: x.verdict, after: bm.get(key(x)).verdict,
  rows: [x.winnerRow, x.loserRow].map(r => r && r.row ? [r.row.date, r.row.tournament, r.row.round, r.row.src, r.row.walkover, r.row.retired] : r && r.why) }));
console.log('### changed ' + changed.length + ' ' + JSON.stringify(changed));
// every chosen career row whose event name does not resolve to Tennis-Data's: the names the identity table would need
const rej = [];
for (const x of A.matches) for (const r of [x.winnerRow, x.loserRow]) if (r && r.row && !global.__SAME(r.row.tournament, x.tournament)) rej.push([x.date, x.tournament, r.row.date, r.row.tournament, id(x.tournament), id(r.row.tournament)]);
console.log('### rejected pairings ' + rej.length + ' ' + JSON.stringify(rej));
