// PROBE ONLY: the approved per-source gate, simulated on two builds' ledgers.
// A source may shrink only if every row that leaves it moved to another source (logged) or is listed with a reason;
// the total priced count must never drop.
import { readFileSync } from 'node:fs';
const [a, b, label] = process.argv.slice(2);
const J = f => JSON.parse(readFileSync(f, 'utf8'));
const A = J(a), B = J(b);
const grp = s => s === 'db' || s === 'ret' || s === 'tie' ? s : s.includes('l') ? 'lower' : s.includes('t') ? 'team' : 'pre2010';
const ix = L => new Map(L.map(r => [r.id, r]));
const ia = ix(A.ledger), ib = ix(B.ledger);
const outc = new Map(B.outcomes.map(o => [String(o.id), o])), drop = new Map(B.drop.map(d => [d.id, d]));
const moves = [], reasons = [], unacc = [];
for (const [id, r] of ia) {
  const n = ib.get(id);
  if (n) { if (n.book !== r.book) moves.push([r, n]); continue; }
  const o = r.fx != null && outc.get(String(r.fx)), d = drop.get(id.replace(/^l\|/, ''));
  if (o) reasons.push([r, o.reason + (o.cands ? ' · candidates ' + JSON.stringify(o.cands) : '')]);
  else if (d) reasons.push([r, d.reason]);
  else unacc.push(r);
}
const added = [...ib.keys()].filter(k => !ia.has(k)).length;
const cnt = L => { const c = {}; for (const r of L) { const k = grp(r.set) + ' · book ' + r.book; c[k] = (c[k] || 0) + 1; } return c; };
const ca = cnt(A.ledger), cb = cnt(B.ledger);
const fmt = r => `${r.d || r.id.split('|')[1]} ${r.w || r.id.split('|')[2]} v ${r.l || r.id.split('|')[3]}${r.ev ? ' · ' + r.ev : ''} (${grp(r.set)}, book ${r.book})`;
const ok = !unacc.length && B.ledger.length >= A.ledger.length;
console.log(`== GATE ${label}: total ${A.ledger.length} -> ${B.ledger.length} (${B.ledger.length - A.ledger.length >= 0 ? '+' : ''}${B.ledger.length - A.ledger.length}) · moved ${moves.length} · left with a reason ${reasons.length} · unaccounted ${unacc.length} · new ${added} => ${ok ? 'PASS' : 'REFUSE'}${B.ledger.length < A.ledger.length ? ' (total dropped)' : ''}${unacc.length ? ' (unaccounted rows)' : ''}`);
for (const k of [...new Set([...Object.keys(ca), ...Object.keys(cb)])].sort()) if ((ca[k] || 0) !== (cb[k] || 0)) console.log(`   source ${k}: ${ca[k] || 0} -> ${cb[k] || 0}`);
const mv = {}; for (const [o, n] of moves) { const k = `${grp(o.set)} ${o.book}->${n.book}`; mv[k] = (mv[k] || 0) + 1; } console.log('   moves', JSON.stringify(mv));
for (const [o, n] of moves.slice(0, +(process.env.MAXSHOW || 12))) console.log(`   MOVED  ${fmt(o)} -> book ${n.book}`);
for (const [o, why] of reasons.slice(0, 40)) console.log(`   REASON ${fmt(o)}: ${why}`);
for (const r of unacc.slice(0, 40)) console.log(`   UNACCOUNTED ${fmt(r)}`);
