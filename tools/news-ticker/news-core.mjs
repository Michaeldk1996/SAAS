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

// One player's stat clause. Each part appears only when its stored field exists; `used` says which did.
function statParts(ms, side, wueOk) {
  const s = (ms && ms[side]) || {}, raw = s.raw || {}, parts = [], fields = {};
  const aces = num(s['Service:Aces']);
  if (aces != null) { parts.push(`${aces} ${aces === 1 ? 'ace' : 'aces'}`); fields.aces = aces; }
  const w = num(s['Points:Winners']), ue = num(s['Points:Unforced errors']);
  if (wueOk && w != null && ue != null) { parts.push(`${w} winners`, `${ue} unforced errors`); fields.winners = w; fields.unforcedErrors = ue; }
  const bp = raw['Service:Break Points Saved'];
  if (bp && num(bp.won) != null && num(bp.total) != null && bp.total > 0) {
    parts.push(`saved ${bp.won} of ${bp.total} break ${bp.total === 1 ? 'point' : 'points'}`);
    fields.breakPointsSaved = bp.won; fields.breakPointsFaced = bp.total;
  }
  return { parts, fields };
}

// The fixed report template. h2h = { a, b, n } after this match (a = the winner's wins), or null (left out).
export function reportText(m, w, l, h2h) {
  const ms = m.matchStats || {};
  // winners / unforced errors all 0 on both sides = the feed did not track them (not a real zero)
  const tot = ['p1', 'p2'].reduce((t, k) => t + (num(ms[k] && ms[k]['Points:Winners']) || 0) + (num(ms[k] && ms[k]['Points:Unforced errors']) || 0), 0);
  const wueOk = tot > 0;
  const score = winnerScore(m, w), round = roundWords(m.tournamentRound);
  const fields = { score, round, retired: !!m.retired };
  let s1 = `${m[w]} beat ${m[l]}`;
  if (score) s1 += ` ${score}`;
  if (m.retired) s1 += ' (retirement)';
  if (round) s1 += ` in the ${round}`;
  s1 += '.';
  const out = [s1];
  const A = statParts(ms, w, wueOk), B = statParts(ms, l, wueOk);
  if (A.parts.length) { out.push(`${m[w]}: ${A.parts.join(', ')}.`); fields.winner = A.fields; }
  if (B.parts.length) { out.push(`${m[l]}: ${B.parts.join(', ')}.`); fields.loser = B.fields; }
  if (h2h && h2h.n >= 1) {
    fields.h2h = h2h;
    if (h2h.n === 1) out.push('It was their first meeting.');
    else if (h2h.a === h2h.b) out.push(`Their head-to-head is level at ${h2h.a}–${h2h.b}.`);
    else if (h2h.a > h2h.b) out.push(`${m[w]} leads their head-to-head ${h2h.a}–${h2h.b}.`);
    else out.push(`${m[l]} leads their head-to-head ${h2h.b}–${h2h.a}.`);
  }
  const used = { wue: !!(A.fields.winners != null || B.fields.winners != null), bp: !!(A.fields.breakPointsFaced || B.fields.breakPointsFaced), h2h: !!fields.h2h };
  return { text: out.join(' '), fields, used };
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
      tournament, round: roundWords(m.tournamentRound), timestamp: startIso(m), timestampKind: 'scheduled start of the match concerned',
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
