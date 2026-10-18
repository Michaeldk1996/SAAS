// probe only: a copy of price-consistency.mjs that dumps every unpriced ATP main-draw career row (all years)
import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('tools/price-consistency.mjs', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) { console.error('anchor missing: ' + a); process.exit(1); } s = s.replace(a, b); };
rep("roundDisagree: 0, roundDisagreeEx: [] };", "roundDisagree: 0, roundDisagreeEx: [], dump: [] };");
rep("const why = sfDbNoPriceWhy(name, vs[i]);",
  "const why = sfDbNoPriceWhy(name, vs[i]); if (lv === 'ATP main draw' || lv === 'ATP qualifying') CV.dump.push({ k, name, date: x.date, opp: x.opponent, ok: okOf(x), t: x.tournament, r: x.round || null, won: !!x.won, lv, why, ek: x.eventKey || null, sets: x.sets || x.score || null, cause: why === 'none' ? causeNotHeld(x, name) : null });");
writeFileSync('tools/probe-gap/pc.mjs', s);
