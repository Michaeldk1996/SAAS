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
export function standoutUnits(ms, side, name, base, { bp = null, wueOk = true } = {}) {
  const s = (ms && ms[side]) || {}, raw = s.raw || {}, out = [];
  let named = false;
  const vs = (x, y) => { const t = `${x > y ? 'above' : 'below'} his ${named ? 'usual ' : ''}${y}%${named ? '' : ' ' + base.label}`; named = true; return t; };
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

  // ---- serve ----
  if (bigAces || manyDf || firstIn || (R.firstWon && R.firstWon.standout) || (R.secondWon && R.secondWon.standout)) {
    const parts = [], tones = [], fields = [];
    if (bigAces) { parts.push(`hit ${aces} aces`); tones.push('good'); fields.push(meta('aces', { value: aces })); }
    if (firstIn) { parts.push(`landed ${firstIn.x}% of his first serves, ${vs(firstIn.x, firstIn.y)}`); tones.push(firstIn.x > firstIn.y ? 'good' : 'bad'); fields.push(meta('firstIn', { value: firstIn.x, baseline: firstIn.y })); }
    if (R.firstWon) { const r = R.firstWon; parts.push(`won ${r.x}% of his first-serve points (${r.c.won} of ${r.c.total})${r.standout ? ', ' + vs(r.x, r.y) : ''}`); if (r.standout) tones.push(r.good ? 'good' : 'bad');
      fields.push(meta('firstWon', { value: r.x, won: r.c.won, total: r.c.total, ...(r.standout ? { baseline: r.y } : {}) })); }
    if (R.secondWon && R.secondWon.standout) { const r = R.secondWon; parts.push(`won ${r.x}% of his second-serve points (${r.c.won} of ${r.c.total}), ${vs(r.x, r.y)}`); tones.push(r.good ? 'good' : 'bad');
      fields.push(meta('secondWon', { value: r.x, won: r.c.won, total: r.c.total, baseline: r.y })); }
    if (manyDf) { parts.push(`made ${df} double faults`); tones.push('bad'); fields.push(meta('doubleFaults', { value: df })); }
    out.push({ text: `${name} ${join(parts)}.`, tone: toneOf(tones), kind: 'serve', fields });
  }
  // ---- return ----
  const rets = [['ret1Won', 'first-serve return'], ['ret2Won', 'second-serve return']].filter(([id]) => R[id] && R[id].standout);
  if (rets.length) {
    const parts = [], tones = [], fields = [];
    for (const [id, what] of rets) { const r = R[id]; parts.push(`${parts.length ? '' : 'won '}${r.x}% of the points on ${what} (${r.c.won} of ${r.c.total}), ${vs(r.x, r.y)}`); tones.push(r.good ? 'good' : 'bad');
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
