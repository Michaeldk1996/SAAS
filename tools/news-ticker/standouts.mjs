// News ticker — what stood out in a match (founder 2026-11-12: "mention things that stand out in the match and just
// not blindly repeat statistics … compare it to his baseline").
//
// Code decides what stands out; the model only words it (humanise.mjs). Each unit is one template sentence carrying the
// match figure AND the player's own baseline, with a tone (good / bad for that player) the wording may reflect.
//
//   baseline   surface-ratings.json (the Database → Ratings store): the player's rates on this match's surface over his
//              last 52 weeks; with fewer than MIN_BASE matches there, his career on the surface; then his last 52 weeks on
//              all surfaces; else no comparison (never a guess). n is stored on the item.
//   standout   a serve / return rate at least `gap` points away from that baseline, on enough points in the match
//   notable    counts that say something by themselves: 10+ aces, 5+ double faults, 30+ winners or unforced errors,
//              break points (none faced; all or none saved from 3+; 8+ faced)
//
// The thresholds are the builder's defaults, pending the founder's tuning.
export const MIN_BASE = 30;
export const RULES = [
  // metric, match rate key, match count key (raw) | null, baseline path, gap (points), min points in the match, wording
  { id: 'firstWon', stat: 'Service:1st serve points won', base: ['serve', 'firstWonPct'], gap: 8, minPts: 20, what: 'of his first-serve points', higherGood: true },
  { id: 'secondWon', stat: 'Service:2nd serve points won', base: ['serve', 'secondWonPct'], gap: 10, minPts: 12, what: 'of his second-serve points', higherGood: true },
  { id: 'ret1Won', stat: 'Return:1st return points won', base: ['return', 'ret1stWonPct'], gap: 8, minPts: 20, what: 'of the points on first-serve return', higherGood: true },
  { id: 'ret2Won', stat: 'Return:2nd return points won', base: ['return', 'ret2ndWonPct'], gap: 10, minPts: 12, what: 'of the points on second-serve return', higherGood: true },
];
export const FIRST_IN = { id: 'firstIn', stat: 'Service:1st serve percentage', base: ['serve', 'firstInPct'], gap: 8 };
export const SERVE_LOST_MAX = 10, SERVE_PTS_MIN = 30;   // "lost only N points on serve": at most 10, from 30+ served
export const SERVE_MAX = 3;   // figures in one serve sentence
export const LOSER_MAX = 2;   // the loser gets ONE sentence: at most his two worst numbers
export const NOTABLE = { aces: 10, doubleFaults: 5, winners: 30, unforcedErrors: 30, bpAllOrNone: 3, bpMany: 8 };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const SURF = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };

// -> { node, label, scope, surface, matches } | null
export function baselineFor(ratings, key, surface) {
  const p = ((ratings && ratings.players) || []).find((x) => String(x.key) === String(key));
  if (!p || !p.surfaces) return null;
  const S = SURF[String(surface || '').toLowerCase().replace(/^indoor\s+/, '')], s = S && S.toLowerCase();
  const tries = [];
  if (S) tries.push([S, 'last52', `on ${s} over the last 52 weeks`], [S, 'career', `on ${s} in his career`]);
  tries.push(['All', 'last52', 'on all surfaces over the last 52 weeks']);
  for (const [surf, scope, label] of tries) {
    const node = p.surfaces[surf] && p.surfaces[surf][scope], n = node && node.sample && num(node.sample.matches);
    if (node && n != null && n >= MIN_BASE) return { node, label, scope, surface: surf, matches: n };
  }
  return null;
}

const join = (parts) => (parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]);
const toneOf = (tones) => { const g = tones.includes('good'), b = tones.includes('bad'); return g && !b ? 'good' : (b && !g ? 'bad' : null); };

// One player's sentences (name = the card name), each grouping the numbers that belong together (founder 2026-11-12:
// "He served well with 14 aces and XX% first serve points won"):
//   serve      aces (10+), first serves in (standout), first-serve points won (always, once the serve is news; with the
//              baseline when it is a standout), second-serve points won (standout), double faults (5+)
//   return     first / second-serve return points won (standouts)
//   pressure   break points (none faced; all or none saved from 3+; 8+ faced)
//   rally      winners and unforced errors (30+ of either)
// The baseline is named in full the first time a player's figure is compared with it; after that it is "his usual N%".
// -> [{ text, tone: 'good'|'bad'|null, kind: 'serve'|'return'|'bp'|'count', fields: [...] }]
export function standoutUnits(ms, side, name, base, { bp = null, wueOk = true, loser = false } = {}) {
  if (loser) return loserUnit(ms, side, name, base, { bp, wueOk });
  const s = (ms && ms[side]) || {}, raw = s.raw || {}, out = [];
  let named = false;
  // "compared with his 27% average on hard over the last 52 weeks"; after the first time, "compared with his usual 51%"
  const vs = (x, y) => { const t = named ? `compared with his usual ${y}%` : `compared with his ${y}% average ${base.label}`; named = true; return t; };
  const rate = (r) => {   // -> { x, y, d, c, standout } | null
    const v = num(s[r.stat]), c = raw[r.stat];
    if (v == null || !c || num(c.total) == null || c.total < r.minPts) return null;
    const b = base ? num(base.node[r.base[0]] && base.node[r.base[0]][r.base[1]]) : null, x = Math.round(v), y = b == null ? null : Math.round(b);
    return { x, y, c, standout: y != null && Math.abs(x - y) >= r.gap, good: y != null && x > y };
  };
  const R = Object.fromEntries(RULES.map((r) => [r.id, rate(r)]));
  const fi = num(s[FIRST_IN.stat]), fb = base ? num(base.node.serve && base.node.serve.firstInPct) : null;
  const firstIn = fi != null && fb != null && Math.abs(Math.round(fi) - Math.round(fb)) >= FIRST_IN.gap ? { x: Math.round(fi), y: Math.round(fb) } : null;
  const aces = num(s['Service:Aces']), df = num(s['Service:Double Faults']);
  const bigAces = aces != null && aces >= NOTABLE.aces, manyDf = df != null && df >= NOTABLE.doubleFaults;
  const meta = (metric, o) => ({ metric, ...o, ...(base && o.baseline != null ? { scope: base.scope, surface: base.surface, n: base.matches } : {}) });

  // points lost on serve: news when it is very few (founder 2026-11-12: "he only lost 7 points on serve")
  const sp = raw['Points:Service Points Won'], lostServe = sp && num(sp.total) != null && num(sp.won) != null && sp.total >= SERVE_PTS_MIN ? sp.total - sp.won : null;
  const fewLost = lostServe != null && lostServe <= SERVE_LOST_MAX;
  // ---- serve ---- (at most SERVE_MAX figures in the sentence: the strongest ones, in a fixed reading order)
  if (fewLost || bigAces || manyDf || firstIn || (R.firstWon && R.firstWon.standout) || (R.secondWon && R.secondWon.standout)) {
    const c = [];   // { w: weight, make: () => text, tone, field }
    if (fewLost) {
      const c1 = raw['Service:1st serve points won'], c2 = raw['Service:2nd serve points won'];
      const a = c1 && num(c1.total) != null ? c1.total - c1.won : null, b = c2 && num(c2.total) != null ? c2.total - c2.won : null;
      const split = a != null && b != null && a + b === lostServe ? ` (${a} on his first serve, ${b} on his second)` : '';
      c.push({ w: 9, tone: 'good', make: () => `lost only ${lostServe} ${lostServe === 1 ? 'point' : 'points'} on serve${split}`, field: meta('servePointsLost', { value: lostServe, total: sp.total }) });
    }
    if (bigAces) c.push({ w: 4 + aces / 100, tone: 'good', make: () => `hit ${aces} aces`, field: meta('aces', { value: aces }) });
    if (firstIn) c.push({ w: 2 + Math.abs(firstIn.x - firstIn.y) / FIRST_IN.gap, tone: firstIn.x > firstIn.y ? 'good' : 'bad', make: () => `landed ${firstIn.x}% of his first serves, ${vs(firstIn.x, firstIn.y)}`, field: meta('firstIn', { value: firstIn.x, baseline: firstIn.y }) });
    if (R.firstWon && !(fewLost && !R.firstWon.standout)) { const r = R.firstWon;
      c.push({ w: r.standout ? 2 + Math.abs(r.x - r.y) / 8 : 1, tone: r.standout ? (r.good ? 'good' : 'bad') : null, make: () => `won ${r.x}% of his first-serve points (${r.c.won} of ${r.c.total})${r.standout ? ', ' + vs(r.x, r.y) : ''}`,
        field: meta('firstWon', { value: r.x, won: r.c.won, total: r.c.total, ...(r.standout ? { baseline: r.y } : {}) }) }); }
    if (R.secondWon && R.secondWon.standout) { const r = R.secondWon;
      c.push({ w: 2 + Math.abs(r.x - r.y) / 10, tone: r.good ? 'good' : 'bad', make: () => `won ${r.x}% of his second-serve points (${r.c.won} of ${r.c.total}), ${vs(r.x, r.y)}`, field: meta('secondWon', { value: r.x, won: r.c.won, total: r.c.total, baseline: r.y }) }); }
    if (manyDf) c.push({ w: 4 + df / 100, tone: 'bad', make: () => `made ${df} double faults`, field: meta('doubleFaults', { value: df }) });
    const keep = new Set([...c].sort((x, y) => y.w - x.w).slice(0, SERVE_MAX)), kept = c.filter((x) => keep.has(x));
    out.push({ text: `${name} ${join(kept.map((x) => x.make()))}.`, tone: toneOf(kept.map((x) => x.tone).filter(Boolean)), kind: 'serve', fields: kept.map((x) => x.field) });
  }
  // ---- return ----
  const rets = [['ret1Won', 'against the first serve'], ['ret2Won', 'against the second serve']].filter(([id]) => R[id] && R[id].standout);
  if (rets.length) {
    const parts = [], tones = [], fields = [];
    for (const [id, what] of rets) { const r = R[id]; parts.push(`${parts.length ? '' : 'won '}${r.x}% of the points ${what} (${r.c.won} of ${r.c.total}), ${vs(r.x, r.y)}`); tones.push(r.good ? 'good' : 'bad');
      fields.push(meta(id, { value: r.x, won: r.c.won, total: r.c.total, baseline: r.y })); }
    out.push({ text: `${name} ${join(parts)}.`, tone: toneOf(tones), kind: 'return', fields });
  }
  // ---- pressure ----
  if (bp) {
    const { saved, faced } = bp, f = [{ metric: 'breakPoints', saved, faced }];
    if (faced === 0) out.push({ tone: 'good', kind: 'bp', text: `${name} faced no break points.`, fields: f });
    else if (faced >= NOTABLE.bpAllOrNone && (saved === faced || saved === 0)) out.push({ tone: saved === faced ? 'good' : 'bad', kind: 'bp', text: `${name} saved ${saved} of ${faced} break points.`, fields: f });
    else if (faced >= NOTABLE.bpMany) out.push({ tone: null, kind: 'bp', text: `${name} saved ${saved} of ${faced} break points.`, fields: f });
  }
  // ---- rally ----
  const w = num(s['Points:Winners']), ue = num(s['Points:Unforced errors']);
  if (wueOk && w != null && ue != null && (w >= NOTABLE.winners || ue >= NOTABLE.unforcedErrors)) {
    out.push({ tone: w > ue ? 'good' : (ue > w ? 'bad' : null), kind: 'count', text: `${name} hit ${w} winners and made ${ue} unforced errors.`, fields: [{ metric: 'winnersErrors', winners: w, unforcedErrors: ue }] });
  }
  return out;
}

// The loser (founder 2026-11-12: "just say what really went wrong for the loser without losing too much time on him"):
// ONE sentence, his worst numbers only — at most LOSER_MAX, the furthest below his own baseline first. Nothing that went
// well, nothing neutral. No bad number = no sentence.
function loserUnit(ms, side, name, base, { bp = null, wueOk = true } = {}) {
  const s = (ms && ms[side]) || {}, raw = s.raw || {}, cands = [];
  const WHAT = { firstWon: 'of his first-serve points', secondWon: 'of his second-serve points', ret1Won: 'of the points against the first serve', ret2Won: 'of the points against the second serve' };
  if (base) {
    for (const r of RULES) {
      const v = num(s[r.stat]), c = raw[r.stat], b = num(base.node[r.base[0]] && base.node[r.base[0]][r.base[1]]);
      if (v == null || b == null || !c || num(c.total) == null || c.total < r.minPts) continue;
      const x = Math.round(v), y = Math.round(b);
      if (y - x < r.gap) continue;
      cands.push({ score: (y - x) / r.gap, y, clause: `won ${x}% ${WHAT[r.id]} (${c.won} of ${c.total})`, field: { metric: r.id, value: x, won: c.won, total: c.total, baseline: y, scope: base.scope, surface: base.surface, n: base.matches } });
    }
    const fi = num(s[FIRST_IN.stat]), fb = num(base.node.serve && base.node.serve.firstInPct);
    if (fi != null && fb != null && Math.round(fb) - Math.round(fi) >= FIRST_IN.gap) cands.push({ score: (Math.round(fb) - Math.round(fi)) / FIRST_IN.gap, y: Math.round(fb), clause: `landed ${Math.round(fi)}% of his first serves`,
      field: { metric: 'firstIn', value: Math.round(fi), baseline: Math.round(fb), scope: base.scope, surface: base.surface, n: base.matches } });
  }
  const df = num(s['Service:Double Faults']);
  if (df != null && df >= NOTABLE.doubleFaults) cands.push({ score: df / NOTABLE.doubleFaults, clause: `made ${df} double faults`, field: { metric: 'doubleFaults', value: df } });
  if (bp && bp.faced >= NOTABLE.bpAllOrNone && bp.saved === 0) cands.push({ score: 1.5, clause: `saved ${bp.saved} of ${bp.faced} break points`, kind: 'bp', field: { metric: 'breakPoints', saved: bp.saved, faced: bp.faced } });
  const w = num(s['Points:Winners']), ue = num(s['Points:Unforced errors']);
  if (wueOk && w != null && ue != null && ue >= NOTABLE.unforcedErrors && ue > w) cands.push({ score: ue / NOTABLE.unforcedErrors, clause: `made ${ue} unforced errors against ${w} winners`, field: { metric: 'winnersErrors', winners: w, unforcedErrors: ue } });
  if (!cands.length) return [];
  cands.sort((a, b) => b.score - a.score);
  const top = cands.slice(0, LOSER_MAX);
  let named = false;
  const parts = top.map((c) => { if (c.y == null) return c.clause; const t = named ? `${c.clause}, compared with his usual ${c.y}%` : `${c.clause}, compared with his ${c.y}% average ${base.label}`; named = true; return t; });
  return [{ text: `${name} ${join(parts)}.`, tone: 'bad', kind: top.length === 1 && top[0].kind === 'bp' ? 'bp' : 'loser', fields: top.map((c) => c.field) }];
}
