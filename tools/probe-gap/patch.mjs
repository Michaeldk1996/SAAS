// probe only: a copy of price-consistency.mjs that dumps every unpriced ATP main-draw career row (all years)
import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('tools/price-consistency.mjs', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) { console.error('anchor missing: ' + a); process.exit(1); } s = s.replace(a, b); };
rep("roundDisagree: 0, roundDisagreeEx: [] };", "roundDisagree: 0, roundDisagreeEx: [], dump: [] };");
rep("const why = sfDbNoPriceWhy(name, vs[i]);",
  "const why = sfDbNoPriceWhy(name, vs[i]); if (lv === 'ATP main draw' || lv === 'ATP qualifying') CV.dump.push({ k, name, date: x.date, opp: x.opponent, ok: okOf(x), t: x.tournament, r: x.round || null, won: !!x.won, lv, why, ek: x.eventKey || null, sets: x.sets || x.score || null, q1: (() => { try { const W = /^(quarter|semi|final|qualif)/i, F = /^1[/][0-9]+-finals$/i; if (!W.test(String(x.round || ''))) return null; const d0 = dn(x.date); let md = null; for (const r of career) { if (!r || r.tournament !== x.tournament) continue; const d = dn(r.date); if (d - d0 < -16 || d - d0 > 5) continue; if (F.test(String(r.round || '')) && (md == null || d < md)) md = d; } return md == null || d0 < md; } catch (e) { return 'ERR ' + e.message; } })(), cause: why === 'none' ? causeNotHeld(x, name) : null });");
rep("  if (COVON) { const top = Object.entries(CV.players)", `  CV.diag = [];
  for (const [dk, ev, opp] of [['1098', 'Adelaide', 'Ymer'], ['2167', 'Basel', 'Goffin'], ['358', 'Delray', 'Johnson'], ['1320', 'Doha', 'Mutawa'], ['371', 'Marrakech', 'Grenier']]) {
    const car = await careerOf(dk); if (!Array.isArray(car)) { CV.diag.push({ dk, none: true }); continue; }
    const cr = car.filter(x => x && String(x.tournament || '').includes(ev) && String(x.opponent || '').includes(opp)).map(x => ({ date: x.date, t: x.tournament, r: x.round, q: x.qualifying, ek: x.eventKey, won: x.won, opp: x.opponent, lv: x.level }));
    const nm = nameOf(dk), dr = [];
    db.names.forEach((n, i) => { if (n && (n[0] + n[1]).includes(opp.split(' ').pop()) && (n[0] + n[1]).includes(ourSur(nm).replace(/^./, c => c.toUpperCase()))) dr.push({ i, row: db.rows[i], n, t: db.meta.tournaments[db.rows[i][4]], rd: db.meta.rounds[db.rows[i][3]], ev: cr.length ? trSameEvent(cr[0].t, [db.meta.tournaments[db.rows[i][4]]]) : null }); });
    const vs = car.filter(x => x && x.date).map(x => ({ date: x.walkover ? null : x.date, won: !!x.won, round: x.round, opp: x.opponent }));
    J(vs, { full: nm }, null, db, null, car);
    const pv = car.filter(x => x && x.date).map((x, i) => [x, vs[i]]).filter(([x]) => String(x.tournament || '').includes(ev) && String(x.opponent || '').includes(opp)).map(([x, v]) => ({ date: x.date, r: x.round, price: v.price, book: v.book }));
    CV.diag.push({ dk, nm, cr, dr: dr.slice(0, 8), pv });
  }
  if (COVON) { const top = Object.entries(CV.players)`);
writeFileSync('tools/probe-gap/pc.mjs', s);
