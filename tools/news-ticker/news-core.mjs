import { standoutUnits } from './standouts.mjs';
// News ticker sample — the pure rules (no network, no clock). Tested by tools/test-news-ticker.mjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const QS = require('../quotes/quote-speaker.cjs');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// "ATP Stockholm - 1/8-finals" -> "round of 16". An unknown round is returned as the feed wrote it.
const ROUND = { '1/64-finals': 'round of 128', '1/32-finals': 'round of 64', '1/16-finals': 'round of 32', '1/8-finals': 'round of 16',
  '1/4-finals': 'quarter-finals', 'quarter-finals': 'quarter-finals', '1/2-finals': 'semi-finals', 'semi-finals': 'semi-finals', 'final': 'final' };
export function roundWords(tr) {
  const raw = String(tr || '').split(' - ').pop().trim();
  if (!raw) return null;
  return ROUND[raw.toLowerCase()] || raw;
}

// Set scores from the winner's side: "6-1, 6-4". null when a set has no numeric games.
export function winnerScore(m, w) {
  const l = w === 'p1' ? 'p2' : 'p1';
  const sets = (m.finalScore && m.finalScore.sets) || [];
  if (!sets.length || sets.some((s) => num(s[w]) == null || num(s[l]) == null)) return null;
  return sets.map((s) => `${s[w]}-${s[l]}`).join(', ');
}

// Break points for one side: the box score's own count when it has one, else the point-by-point count (pbp-facts).
// -> { saved, faced, source } or null
export function breakPoints(ms, side, pbp) {
  const bp = ms && ms[side] && ms[side].raw && ms[side].raw['Service:Break Points Saved'];
  if (bp && num(bp.won) != null && num(bp.total) != null && bp.total > 0) return { saved: bp.won, faced: bp.total, source: 'box score' };
  const p = pbp && pbp.bp && pbp.bp[side];
  if (p && num(p.faced) != null) return { saved: p.saved, faced: p.faced, source: 'point-by-point' };
  return null;
}

// One player's stat clause. Each part appears only when its stored field exists.
function statParts(ms, side, wueOk, pbp) {
  const s = (ms && ms[side]) || {}, parts = [], fields = {};
  const aces = num(s['Service:Aces']);
  if (aces != null) { parts.push(`${aces} ${aces === 1 ? 'ace' : 'aces'}`); fields.aces = aces; }
  const w = num(s['Points:Winners']), ue = num(s['Points:Unforced errors']);
  if (wueOk && w != null && ue != null) { parts.push(`${w} winners`, `${ue} unforced errors`); fields.winners = w; fields.unforcedErrors = ue; }
  const bp = breakPoints(ms, side, pbp);
  if (bp) {
    parts.push(bp.faced === 0 ? 'faced no break points' : `saved ${bp.saved} of ${bp.faced} break ${bp.faced === 1 ? 'point' : 'points'}`);
    fields.breakPointsSaved = bp.saved; fields.breakPointsFaced = bp.faced; fields.breakPointsSource = bp.source;
  }
  return { parts, fields };
}

const ord = (n) => { const v = n % 100, s = ['th', 'st', 'nd', 'rd']; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const times = (n) => (n === 1 ? '' : n === 2 ? ' twice' : ` ${n} times`);
export const LONGEST_RUN_MIN = 4;   // a run shorter than this is not printed
export const RUN_ALWAYS = 7;        // a run this long is printed even without a turning point
export const QUICK_MIN = 60, LONG_MIN = 180;   // minutes: when a duration is worth printing
const SET_WORD = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };

// The fixed report template (v2). Every clause is a stored field or a count of stored rows; a clause with nothing
// behind it is not written. opts: { h2h: {a,b,n} after this match (a = winner's wins) | null, round: words | null,
// pbp: pbpFacts() | null, score: scoreFacts() | null, duration: minutes | null (both ends observed) }
export function reportText(m, w, l, opts = {}) {
  const { h2h = null, pbp = null, score: sf = null, duration = null } = opts;
  const ms = m.matchStats || {};
  // winners / unforced errors all 0 on both sides = the feed did not track them (not a real zero)
  const tot = ['p1', 'p2'].reduce((t, k) => t + (num(ms[k] && ms[k]['Points:Winners']) || 0) + (num(ms[k] && ms[k]['Points:Unforced errors']) || 0), 0);
  // the same winners AND unforced-error counts on both sides is the feed repeating one player's line, not a match fact
  const same = ['Points:Winners', 'Points:Unforced errors'].every((k) => num(ms.p1 && ms.p1[k]) != null && num(ms.p1 && ms.p1[k]) === num(ms.p2 && ms.p2[k]));
  const wueOk = tot > 0 && !same;
  const score = winnerScore(m, w), round = opts.round !== undefined ? opts.round : roundWords(m.tournamentRound);
  const fields = { score, round, retired: !!m.retired };
  let s1 = `${m[w]} beat ${m[l]}`;
  if (h2h && h2h.n >= 1) { fields.h2h = h2h; s1 += h2h.n === 1 ? ' in their first meeting' : ` for the ${ord(h2h.a)} time in ${h2h.n} meetings`; }
  if (score) s1 += `${fields.h2h ? ',' : ''} ${score}`;
  if (m.retired) s1 += ' (retirement)';
  if (round) s1 += ` in the ${round}`;
  // the duration is always stored; it is PRINTED only when it says something (founder 2026-11-12: "58 minutes should
  // be mentioned, 84 minutes is not an added value"): a straight-sets best-of-three inside QUICK_MIN, or a match of LONG_MIN+
  if (num(duration) != null) {
    fields.durationMinutes = duration;
    const nSets = ((m.finalScore && m.finalScore.sets) || []).length;
    if (nSets === 2 && duration <= QUICK_MIN) { s1 += ` in just ${duration} minutes`; fields.durationPrinted = 'quick'; }
    else if (duration >= LONG_MIN) { s1 += ` in ${duration} minutes`; fields.durationPrinted = 'long'; }
  }
  s1 += '.';
  const out = [s1], facts = {};
  if (sf && sf.fromSetDown) { out.push(`${m[w]} came from a set down.`); facts.fromSetDown = true; }
  if (sf && sf.tiebreakSets && sf.tiebreakSets.length) {
    facts.tiebreakSets = sf.tiebreakSets;
    for (const t of sf.tiebreakSets) out.push(`Set ${t.set} went to a tiebreak, won by ${m[t.winner]}.`);
  }
  if (pbp) {
    for (const k of [w, l]) {
      const fm = pbp.brokenForMatch[k], fset = pbp.brokenForSet[k], f400 = pbp.brokenFrom400[k];
      if (fm > 0) { out.push(`${m[k]} was broken${times(fm)} when serving for the match.`); (facts.brokenForMatch = facts.brokenForMatch || {})[k] = fm; }
      if (fset > 0) {   // which set: "serving for the first set" (founder 2026-11-12)
        const at = (pbp.brokenForSetAt && pbp.brokenForSetAt[k]) || [];
        if (at.length === fset && new Set(at).size === fset) for (const n of at) out.push(`${m[k]} was broken when serving for the ${SET_WORD[n] || `set ${n}`} set.`);
        else out.push(`${m[k]} was broken${times(fset)} when serving for a set.`);
        (facts.brokenForSet = facts.brokenForSet || {})[k] = fset; if (at.length) (facts.brokenForSetAt = facts.brokenForSetAt || {})[k] = at;
      }
      if (f400 > 0) { out.push(`${m[k]} was broken${times(f400)} from 40-0 up.`); (facts.brokenFrom400 = facts.brokenFrom400 || {})[k] = f400; }
    }
    if (pbp.opening) { const o = pbp.opening; out.push(`${m[o.side]} saved ${o.saved} break ${o.saved === 1 ? 'point' : 'points'} in the opening game.`); facts.openingGame = o; }
    // a run of games is printed only with what makes it matter: where it started (founder 2026-11-12: "5 games in a
    // row … you don't know when and it looks a bit lost there")
    const lr = pbp.longestRun;
    if (lr && lr.side && lr.n >= LONGEST_RUN_MIN) {
      facts.longestRun = lr;
      const who = m[lr.side], setW = lr.set ? SET_WORD[lr.set] : null;
      if (lr.toTheEnd && lr.n >= 5) out.push(`${who} won the last ${lr.n} games of the match.`);
      else if (setW && lr.from && lr.from.me < lr.from.opp) out.push(`${who} won ${lr.n} games in a row from ${lr.from.me}-${lr.from.opp} down in the ${setW} set.`);
      else if (setW && lr.afterBeingBroken) out.push(`${who} won ${lr.n} games in a row straight after being broken in the ${setW} set.`);
      else if (lr.n >= RUN_ALWAYS) out.push(setW && lr.from ? `${who} won ${lr.n} games in a row from ${lr.from.me}-${lr.from.opp} in the ${setW} set.` : `${who} won ${lr.n} games in a row.`);
    }
  }
  if (Object.keys(facts).length) fields.facts = facts;
  const A = statParts(ms, w, wueOk, pbp), B = statParts(ms, l, wueOk, pbp);
  const tones = out.map(() => null), kinds = out.map(() => null);
  // What stood out (standouts.mjs): each player's rates against his own baseline + the counts that say something. When
  // there is at least one, the full stat line is not printed; with none (no baseline, nothing notable) it still is.
  // the winner first; a figure of his is not told again from the loser's side (his 80% of first-serve points won IS the
  // loser's 20% against the first serve). The winner plays again unless this was the final: "something to watch".
  const MIRROR = { firstWon: 'ret1Won', secondWon: 'ret2Won', ret1Won: 'firstWon', ret2Won: 'secondWon' };
  let U = null;
  if (opts.baselines) {
    const uw = standoutUnits(ms, w, m[w], opts.baselines[w] || null, { bp: breakPoints(ms, w, pbp), wueOk, watch: round !== 'final' });
    const skip = new Set(uw.flatMap((u) => u.fields.map((f) => MIRROR[f.metric]).filter(Boolean)));
    U = { [w]: uw, [l]: standoutUnits(ms, l, m[l], opts.baselines[l] || null, { bp: breakPoints(ms, l, pbp), wueOk, loser: true, skip }) };
  }
  if (U && U[w].length + U[l].length > 0) {
    fields.standouts = [];
    for (const k of [w, l]) for (const u of U[k]) { out.push(u.text); tones.push(u.tone); kinds.push(u.kind); for (const f of u.fields) fields.standouts.push({ player: k === w ? 'winner' : 'loser', tone: u.tone, ...f }); }
    if (A.parts.length) fields.winner = A.fields;
    if (B.parts.length) fields.loser = B.fields;
  } else {
    if (A.parts.length) { out.push(`${m[w]}: ${A.parts.join(', ')}.`); tones.push(null); kinds.push(null); fields.winner = A.fields; }
    if (B.parts.length) { out.push(`${m[l]}: ${B.parts.join(', ')}.`); tones.push(null); kinds.push(null); fields.loser = B.fields; }
  }
  const used = { wue: !!(A.fields.winners != null || B.fields.winners != null), bpSides: [A, B].filter((x) => x.fields.breakPointsFaced != null).length,
    h2h: !!fields.h2h, pbp: !!pbp, duration: fields.durationMinutes != null };
  return { text: out.join(' '), sentences: out, tones, kinds, fields, used };
}

// Our ONE H2H list (H2HCore.joinMeetings over both career-history shards), counted only when it already holds this
// match — otherwise the "after this match" figure would be a guess, so null.
export function h2hAfter(H2HCore, m, w, l, shardW, shardL, names, eventKey) {
  if (!shardW || !shardL) return null;
  const nk = H2HCore.nameCounts(names || []);
  const side = (k, s) => ({ full: m[k], short: m[k], key: m[k + 'Key'] != null ? String(m[k + 'Key']) : null, id: (s && s.id) || null });
  let rows;
  try { rows = H2HCore.played(H2HCore.joinMeetings(side(w, shardW), side(l, shardL), shardW.matches || [], shardL.matches || [], nk, [])); }
  catch (e) { return null; }
  if (!rows.some((x) => x.eventKey != null && String(x.eventKey) === String(eventKey))) return null;
  const a = rows.filter((x) => x.won).length;
  return { a, b: rows.length - a, n: rows.length };
}

// Status items from the board alone. Each carries its basis.
export function statusItems(cards, { ek, startIso, tournament, base }) {
  const out = [];
  const done = cards.filter((m) => m.finalScore && m.finalScore.winner);
  const mk = (m, id, playerSide, category, text, basis) => {
    const o = playerSide === 'p1' ? 'p2' : 'p1';
    return { id, type: 'status', playerId: String(m[playerSide + 'Key']), opponentId: String(m[o + 'Key']), player: m[playerSide], opponent: m[o],
      tournament, round: roundWords(m.tournamentRound), timestamp: startIso(m), timestampKind: 'scheduled',
      category, text, basis, sourceName: 'Stennisfy match data (api-tennis fixture status)', sourceUrl: `${base}/matches.json`, sourceRef: m.id,
      language: 'en', translated: false };
  };
  for (const m of done) {
    const w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1', round = roundWords(m.tournamentRound);
    const stage = m.qualifying ? 'qualifying' : 'main draw';
    if (m.walkover) {
      out.push(mk(m, `status-wo-${ek(m)}`, l, 'Withdrawals',
        `${m[l]} gave a walkover to ${m[w]} in the ${stage}${round ? ' ' + round : ''}; the match was not played.`, 'api-tennis status "Walk Over"'));
    } else if (m.retired) {
      const sc = winnerScore(m, w);
      out.push(mk(m, `status-ret-${ek(m)}`, l, 'Withdrawals',
        `${m[l]} retired against ${m[w]}${sc ? ' at ' + sc : ''} in the ${stage}${round ? ' ' + round : ''}.`, 'api-tennis status "Retired"'));
    }
  }
  // qualifying finals on the board: the winner qualified; a loser who then has a main-draw card is a lucky loser
  const inMain = new Map();
  cards.filter((m) => !m.qualifying).forEach((m) => ['p1', 'p2'].forEach((k) => { if (m[k + 'Key'] != null && !inMain.has(String(m[k + 'Key']))) inMain.set(String(m[k + 'Key']), m); }));
  for (const m of done.filter((x) => x.qualifying && /final$/i.test(String(x.tournamentRound || '').trim()) && !/\d\/\d/.test(String(x.tournamentRound).split(' - ').pop()))) {
    if (m.walkover) continue;
    const w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1', sc = winnerScore(m, w);
    out.push(mk(m, `status-q-${ek(m)}`, w, 'Qualifying', `${m[w]} qualified for the main draw, beating ${m[l]}${sc ? ' ' + sc : ''} in the final qualifying round.`,
      'won the qualifying final (api-tennis result)'));
    if (inMain.has(String(m[l + 'Key']))) {
      out.push(mk(m, `status-ll-${ek(m)}`, l, 'Qualifying', `${m[l]} lost in the final qualifying round and has a main-draw match: a lucky loser.`,
        'derived: lost the qualifying final, then listed in a main-draw fixture (api-tennis does not flag lucky losers)'));
    }
  }
  return out;
}

// ---- quotes ---------------------------------------------------------------------------------------------------------
// Only typography is folded (curly quotes, dashes, non-breaking spaces, runs of whitespace). Words are never touched.
export const foldText = (s) => String(s || '').replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"')
  .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

// A quote passes only when its whole text is found, in order, in the fetched source text.
export function verbatimIn(quote, sourceText) {
  const q = foldText(quote), s = foldText(sourceText);
  return q.length >= 12 && s.includes(q);
}

// Speaker -> exactly one entrant of this tournament (the tournament-quotes rule: surname or its last whole words, the
// initial separates namesakes). entrants: Map(key -> "L. Musetti").
export function resolvePlayer(name, entrants) {
  const t = QS.fold(name).split(' ').filter(Boolean);
  if (!t.length) return { status: 'none', key: null };
  const hits = [];
  entrants.forEach((n, k) => {
    const p = QS.parts(n), sur = p.sur.split(' ');
    for (let take = Math.min(sur.length, t.length); take >= 1; take--) {
      if (t.slice(t.length - take).join(' ') === sur.slice(sur.length - take).join(' ') && take === sur.length) {
        const given = t.slice(0, t.length - take);
        hits.push({ key: k, ok: !given.length || !p.ini || given[0][0] === p.ini });
        break;
      }
    }
  });
  const ok = hits.filter((h) => h.ok);
  if (ok.length === 1) return { status: 'one', key: ok[0].key };
  return { status: ok.length > 1 ? 'several' : 'none', key: null };
}

// Pull direct-speech spans (>= 25 characters between double quotes) out of plain text.
export function quotedSpans(text) {
  const out = [], re = /["“]([^"“”]{25,})["”]/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].trim());
  return out;
}
