// TEN-206 §5.4 · independent recompute of the Calendar-record model.
//
// Deliberately NOT a copy of the renderer: this reads the deployed shards and
// rebuilds every published figure from the raw rows, so a number that agrees
// here and in the DOM has been derived twice from the same inputs by two
// different code paths. Run it against the CDP read-back, never instead of it.
//
// Formulas are the design file's, quoted at each site:
//   Player Stat Boxes.dc.html:2186-2206  monthly yield / other-eleven / DELTA
//   Player Stat Boxes.dc.html:2243-2260  win(start,len) adjacent-month stretches
//   Player Stat Boxes.dc.html:2261-2268  tileOf() sample gate + "N of M positive"
const BASE = process.env.PP2_BASE || 'https://michaeldk1996.github.io/SAAS';

async function j(p) { const r = await fetch(`${BASE}/${p}`, { cache: 'no-store' }); return r.ok ? r.json() : null; }

function oppKeyOf(name) {
  let s = String(name || '').trim();
  const c = s.indexOf(',');
  if (c > 0) s = s.slice(0, c);
  else if (/^[A-Za-z]\.\s+/.test(s)) s = s.replace(/^[A-Za-z]\.\s+/, '');
  else s = s.replace(/(\s+[A-Za-z]\.)+$/, '');
  return s.toLowerCase().replace(/[^a-z]/g, '');
}
function evKeyOf(name) {
  let s = String(name || '');
  const i = s.indexOf(' - ');
  if (i > 0) s = s.slice(0, i);
  s = s.replace(/^(ATP|WTA|ITF)\s+/i, '');
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function uniq(list, keyOf) {
  const m = {};
  for (const r of list) {
    const k = keyOf(r);
    if (Object.prototype.hasOwnProperty.call(m, k)) m[k] = null; else m[k] = r;
  }
  return m;
}

export async function model(key, surface = 'all') {
  const [prof, mk, ch] = await Promise.all([
    j(`profiles/${key}.json`), j(`market-edge/${key}.json`), j(`career-history/${key}.json`)]);
  // Deployed serves per-player shards; a local worktree serves only the eager
  // file. Same rows either way — the page itself unions the two stores the same
  // way, so reading whichever is present keeps this pointed at the same bytes
  // the browser saw.
  let p = prof && prof.profile;
  if (!p) {
    const eager = await j('player-profiles.json');
    p = eager && eager.players && eager.players[key];
  }
  if (!p) return null;
  const chRows = ((ch && ch.matches) || []).filter(r => r && /^\d{4}-\d{2}/.test(String(r.date)));
  const mkRows = (mk && mk.matches) || [];

  // display-name vote, as tournJoin() does it for the market shard
  const th = p.tournamentHistory || [];
  const thOwner = {};
  for (const t of th) for (const e of (t.editions || [])) for (const m of (e.matches || [])) {
    const k = `${e.year}|${oppKeyOf(m.opp)}`;
    if (!(k in thOwner)) thOwner[k] = t.name; else if (thOwner[k] !== t.name) thOwner[k] = null;
  }
  // The vote key has to be unique on BOTH sides. Two meetings with the same
  // opponent in one season (Zverev v Hurkacz 2026: United Cup and Halle) name
  // two different events, and taking either one renames the other's rows.
  const chCount = {};
  for (const r of chRows) {
    const k = `${String(r.date).slice(0, 4)}|${oppKeyOf(r.opponent)}`;
    chCount[k] = (chCount[k] || 0) + 1;
  }
  const votes = {};
  for (const r of chRows) {
    const k = `${String(r.date).slice(0, 4)}|${oppKeyOf(r.opponent)}`;
    if (chCount[k] !== 1) continue;
    const o = thOwner[k];
    if (!o) continue;
    (votes[r.tournament] = votes[r.tournament] || {})[o] = ((votes[r.tournament] || {})[o] || 0) + 1;
  }
  const alias = {};
  for (const ev of Object.keys(votes)) alias[ev] = Object.keys(votes[ev]).sort((a, b) => votes[ev][b] - votes[ev][a])[0];

  // price join · three tiers, each requiring uniqueness on BOTH sides
  const byDate = uniq(mkRows, r => `${r.date}|${oppKeyOf(r.opp)}`);
  const byEv = uniq(mkRows, r => `${String(r.date).slice(0, 4)}|${evKeyOf(alias[r.event] || r.event)}|${oppKeyOf(r.opp)}`);
  const byYear = uniq(mkRows, r => `${String(r.date).slice(0, 4)}|${oppKeyOf(r.opp)}`);
  const spDate = uniq(chRows, r => `${r.date}|${oppKeyOf(r.opponent)}`);
  const spEv = uniq(chRows, r => `${String(r.date).slice(0, 4)}|${evKeyOf(alias[r.tournament] || r.tournament)}|${oppKeyOf(r.opponent)}`);
  const spYear = uniq(chRows, r => `${String(r.date).slice(0, 4)}|${oppKeyOf(r.opponent)}`);

  const rows = chRows.map(r => {
    const y = String(r.date).slice(0, 4);
    const ev = evKeyOf(alias[r.tournament] || r.tournament);
    const o = oppKeyOf(r.opponent);
    let hit = null;
    if (spDate[`${r.date}|${o}`] && byDate[`${r.date}|${o}`]) hit = byDate[`${r.date}|${o}`];
    else if (spEv[`${y}|${ev}|${o}`] && byEv[`${y}|${ev}|${o}`]) hit = byEv[`${y}|${ev}|${o}`];
    else if (spYear[`${y}|${o}`] && byYear[`${y}|${o}`]) hit = byYear[`${y}|${o}`];
    // §5 book rule: Pinnacle closing only. Bet365 is a pre-match snapshot and is
    // never blended into a yield.
    const pin = hit && hit.book === 'pinnacle' && hit.price != null && hit.pl != null ? hit : null;
    return {
      date: r.date, year: y, m: parseInt(String(r.date).slice(5, 7), 10) - 1,
      won: !!r.won, surface: r.surface ? String(r.surface).toLowerCase() : null,
      event: alias[r.tournament] || r.tournament, round: r.round, opp: r.opponent,
      price: pin ? pin.price : null, oppPrice: pin ? pin.oppPrice : null,
      pl: pin ? pin.pl : null, court: hit ? hit.court : null
    };
  });

  const filt = surface === 'all' ? rows
    : surface === 'indoors' ? rows.filter(r => r.court === 'Indoor')
      : rows.filter(r => r.surface === surface);

  // grid
  const years = [...new Set(filt.map(r => r.year))].sort().reverse();
  const cells = {};
  for (const y of years) { cells[y] = []; for (let i = 0; i < 12; i++) cells[y].push({ w: 0, l: 0, pl: 0, n: 0, priced: 0 }); }
  for (const r of filt) {
    const c = cells[r.year][r.m];
    c[r.won ? 'w' : 'l']++; c.n++;
    if (r.pl != null) { c.pl += Math.round(r.pl * 100) / 100; c.priced++; }
  }

  // footer · N is the GRID count (item 1); yield/pp are the PRICED subset (item 2)
  const N = [], W = [], L = [], PLM = [], PN = [], ABOVE = [];
  for (let i = 0; i < 12; i++) { N[i] = 0; W[i] = 0; L[i] = 0; PLM[i] = 0; PN[i] = 0; ABOVE[i] = 0; }
  let seasons = 0;
  for (const y of years) {
    seasons++;
    for (let i = 0; i < 12; i++) {
      const c = cells[y][i];
      N[i] += c.n; W[i] += c.w; L[i] += c.l; PLM[i] += c.pl; PN[i] += c.priced;
      if (c.n && c.w > c.l) ABOVE[i]++;
    }
  }
  const totalPN = PN.reduce((a, b) => a + b, 0);
  const totalPL = PLM.reduce((a, b) => a + b, 0);
  const YLD = PN.map((n, i) => n ? 100 * PLM[i] / n : null);
  const CAREER_Y = totalPN ? 100 * totalPL / totalPN : null;
  // month vs the OTHER ELEVEN combined — .dc.html:2191-2196
  const DELTA = YLD.map((y, i) => {
    const on = totalPN - PN[i];
    if (y == null || !on) return null;
    return y - (100 * (totalPL - PLM[i]) / on);
  });
  // tile pp — .dc.html:2188 PP[i] = MY[i] - CAREER_Y, i.e. vs his OWN career yield
  const PP = YLD.map(y => (y == null || CAREER_Y == null) ? null : y - CAREER_Y);

  // stretches · win(start,len) for len 2..3, wrapping, match-weighted — :2243
  function win(start, len) {
    const idx = []; for (let k = 0; k < len; k++) idx.push((start + k) % 12);
    const nSum = idx.reduce((s, i) => s + PN[i], 0);
    const gridN = idx.reduce((s, i) => s + N[i], 0);
    const d = nSum ? idx.reduce((s, i) => s + (PP[i] == null ? 0 : PN[i] * PP[i]), 0) / nSum : null;
    let up = 0;
    for (const y of years) {
      let w = 0, l = 0;
      for (const i of idx) { w += cells[y][i].w; l += cells[y][i].l; }
      if (w > l) up++;
    }
    return { label: `${MON[idx[0]]}–${MON[idx[len - 1]]}`, n: nSum, gridN, d, up };
  }
  const WINS = [];
  for (let len = 2; len <= 3; len++) for (let s = 0; s < 12; s++) WINS.push(win(s, len));
  const ok = WINS.filter(w => w.n >= 10 && w.d != null).sort((a, b) => b.d - a.d);
  const monthIdx = PP.map((v, i) => i).filter(i => PN[i] >= 10 && PP[i] != null).sort((a, b) => PP[b] - PP[a]);

  // findings strip · per-surface yield vs the other surfaces — :2290
  // Surfaces only. "Indoors" is a court type and the career spine carries no
  // court column — the only court values here come from the priced join, so an
  // Indoors figure would be computed over a different population than the other
  // three and would not be comparable with them.
  const SURF = ['hard', 'clay', 'grass'];
  // "pp" in the file means vs his OWN career yield (:2290 "weighted to the
  // career yield"), not the raw surface yield.
  const sAgg = SURF.map(s => {
    const rs = rows.filter(r => r.surface === s);
    const pr = rs.filter(r => r.pl != null);
    const pl = pr.reduce((a, r) => a + Math.round(r.pl * 100) / 100, 0);
    return {
      s, n: pr.length, gridN: rs.length,
      yield: (pr.length && CAREER_Y != null) ? 100 * pl / pr.length - CAREER_Y : null
    };
  }).filter(x => x.yield != null);
  const ranked = sAgg.slice().sort((a, b) => b.yield - a.yield);

  return {
    key, name: p.name, surface,
    spine: (p.careerByYear || []).filter(y => y && y.total)
      .reduce((a, y) => a + (y.total.won || 0) + (y.total.lost || 0), 0),
    gridTotal: filt.length, span: years.length ? `${years[years.length - 1]}–${years[0]}` : null,
    seasons, pricedTotal: totalPN, careerYield: CAREER_Y,
    N, W, L, PN, YLD, DELTA, PP, ABOVE,
    colSums: { n: N.reduce((a, b) => a + b, 0), w: W.reduce((a, b) => a + b, 0), l: L.reduce((a, b) => a + b, 0) },
    tiles: {
      bestStretch: ok[0] || null, worstStretch: ok.length ? ok[ok.length - 1] : null,
      bestMonth: monthIdx.length ? { m: monthIdx[0], pp: PP[monthIdx[0]], n: PN[monthIdx[0]], above: ABOVE[monthIdx[0]] } : null,
      worstMonth: monthIdx.length ? { m: monthIdx[monthIdx.length - 1], pp: PP[monthIdx[monthIdx.length - 1]], n: PN[monthIdx[monthIdx.length - 1]], above: ABOVE[monthIdx[monthIdx.length - 1]] } : null
    },
    findings: { best: ranked[0] || null, worst: ranked.length ? ranked[ranked.length - 1] : null, surfaces: sAgg },
    cells
  };
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

if (import.meta.url === `file://${process.argv[1]}`) {
  const T = process.argv[2] ? [[process.argv[2], process.argv[2]]]
    : [['1980', 'Zverev #2'], ['1775', 'Martinez #132'], ['906', 'Krumich #256']];
  for (const [k, l] of T) {
    const r = await model(k);
    if (!r) { console.log(`${l}: no shard`); continue; }
    const f = (v, d = 1) => v == null ? '—' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(d);
    console.log(`\n══ ${l} · ${r.name} ══`);
    console.log(`  grid total ${r.gridTotal} · span ${r.span} · ${r.seasons} seasons`);
    console.log(`  careerByYear spine ${r.spine} · disclosed gap ${r.spine - r.gridTotal}`);
    console.log(`  priced (Pinnacle closing) ${r.pricedTotal} · career yield ${f(r.careerYield)}%`);
    console.log(`  column sums  N=${r.colSums.n}  W-L=${r.colSums.w}–${r.colSums.l}  (grid total ${r.gridTotal})`);
    console.log(`  RECON  Σ cells === grid total: ${r.colSums.n === r.gridTotal}`);
    console.log('  N     ', r.N.join(' '));
    console.log('  priced', r.PN.join(' '));
    console.log('  yield ', r.YLD.map(v => f(v)).join(' '));
    console.log('  vsOth ', r.DELTA.map(v => f(v)).join(' '));
    console.log('  above ', r.ABOVE.join(' '));
    const t = r.tiles;
    console.log(`  TILE best stretch  ${t.bestStretch ? `${t.bestStretch.label}  ${f(t.bestStretch.d)}pp  n=${t.bestStretch.n}  ${t.bestStretch.up} of ${r.seasons} positive` : '—'}`);
    console.log(`  TILE worst stretch ${t.worstStretch ? `${t.worstStretch.label}  ${f(t.worstStretch.d)}pp  n=${t.worstStretch.n}  ${t.worstStretch.up} of ${r.seasons} positive` : '—'}`);
    console.log(`  TILE best month    ${t.bestMonth ? `${MON[t.bestMonth.m]}  ${f(t.bestMonth.pp)}pp  n=${t.bestMonth.n}  ${t.bestMonth.above} of ${r.seasons} positive` : '—'}`);
    console.log(`  TILE worst month   ${t.worstMonth ? `${MON[t.worstMonth.m]}  ${f(t.worstMonth.pp)}pp  n=${t.worstMonth.n}  ${t.worstMonth.above} of ${r.seasons} positive` : '—'}`);
    console.log(`  FINDINGS best ${r.findings.best ? r.findings.best.s + ' ' + f(r.findings.best.yield) + '% n=' + r.findings.best.n : '—'} · worst ${r.findings.worst ? r.findings.worst.s + ' ' + f(r.findings.worst.yield) + '% n=' + r.findings.worst.n : '—'}`);
  }
}
