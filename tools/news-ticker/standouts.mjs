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
export const MAX_PER_PLAYER = 3;

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

// -> [{ text, tone: 'good'|'bad'|null, kind, field }] for one player (name = the card name), strongest first
export function standoutUnits(ms, side, name, base, { bp = null, wueOk = true } = {}) {
  const s = (ms && ms[side]) || {}, raw = s.raw || {}, out = [];
  if (base) {
    const cands = [];
    for (const r of RULES) {
      const v = num(s[r.stat]), c = raw[r.stat], b = num(base.node[r.base[0]] && base.node[r.base[0]][r.base[1]]);
      if (v == null || b == null || !c || num(c.total) == null || c.total < r.minPts) continue;
      const x = Math.round(v), y = Math.round(b), d = x - y;
      if (Math.abs(d) < r.gap) continue;
      cands.push({ score: Math.abs(d) / r.gap, tone: (d > 0) === r.higherGood ? 'good' : 'bad', kind: 'rate',
        text: `${name} won ${x}% ${r.what} (${c.won} of ${c.total}), ${d > 0 ? 'above' : 'below'} his ${y}% ${base.label}.`,
        field: { metric: r.id, value: x, won: c.won, total: c.total, baseline: y, scope: base.scope, surface: base.surface, n: base.matches } });
    }
    const fi = num(s[FIRST_IN.stat]), fb = num(base.node.serve && base.node.serve.firstInPct);
    if (fi != null && fb != null && Math.abs(Math.round(fi) - Math.round(fb)) >= FIRST_IN.gap) {
      const x = Math.round(fi), y = Math.round(fb);
      cands.push({ score: Math.abs(x - y) / FIRST_IN.gap, tone: x > y ? 'good' : 'bad', kind: 'rate',
        text: `${name} landed ${x}% of his first serves, ${x > y ? 'above' : 'below'} his ${y}% ${base.label}.`,
        field: { metric: 'firstIn', value: x, baseline: y, scope: base.scope, surface: base.surface, n: base.matches } });
    }
    cands.sort((a, b) => b.score - a.score);
    // the baseline is named in full once per player; his next figure reads "his usual 51%" (the same baseline)
    const top = cands.slice(0, 2);
    if (top[1]) top[1].text = top[1].text.replace(` ${base.label}.`, '.').replace(/ his (\d+)%\.$/, ' his usual $1%.');
    out.push(...top);
  }
  if (bp) {
    const { saved, faced } = bp;
    if (faced === 0) out.push({ tone: 'good', kind: 'bp', text: `${name} faced no break points.`, field: { metric: 'breakPoints', saved, faced } });
    else if (faced >= NOTABLE.bpAllOrNone && (saved === faced || saved === 0)) out.push({ tone: saved === faced ? 'good' : 'bad', kind: 'bp', text: `${name} saved ${saved} of ${faced} break points.`, field: { metric: 'breakPoints', saved, faced } });
    else if (faced >= NOTABLE.bpMany) out.push({ tone: null, kind: 'bp', text: `${name} saved ${saved} of ${faced} break points.`, field: { metric: 'breakPoints', saved, faced } });
  }
  const aces = num(s['Service:Aces']), df = num(s['Service:Double Faults']);
  if (aces != null && aces >= NOTABLE.aces) out.push({ tone: 'good', kind: 'count', text: `${name} hit ${aces} aces.`, field: { metric: 'aces', value: aces } });
  if (df != null && df >= NOTABLE.doubleFaults) out.push({ tone: 'bad', kind: 'count', text: `${name} made ${df} double faults.`, field: { metric: 'doubleFaults', value: df } });
  const w = num(s['Points:Winners']), ue = num(s['Points:Unforced errors']);
  if (wueOk && w != null && ue != null && (w >= NOTABLE.winners || ue >= NOTABLE.unforcedErrors)) {
    out.push({ tone: w > ue ? 'good' : (ue > w ? 'bad' : null), kind: 'count', text: `${name} hit ${w} winners and made ${ue} unforced errors.`, field: { metric: 'winnersErrors', winners: w, unforcedErrors: ue } });
  }
  return out.slice(0, MAX_PER_PLAYER);
}
