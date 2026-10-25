// The ONE quote-speaker rule (founder rulings 2026-10-23/24, .claude/rules/player-photos.md). Used by
// tools/quotes/build-tournament-quotes.mjs, which writes the result into tournament-quotes.json; the page only reads it.
//
// A DATED quote's speaker resolves against THAT tournament's entrants for the quote's own season — never the roster:
//   - the tournament store's edition (tournament-profiles.json allEditionMatches: every keyed player), else Sackmann's
//     main draw for a season the store does not hold (quote-entrants.json `main`);
//   - plus Sackmann's qualifying entrants (quote-entrants.json `qual`, for quote matching only).
// The speaker's surname (case- and accent-insensitive) must equal one candidate's surname or its last whole word(s). When
// several share it, the speaker's initial separates them only if it leaves exactly one. Exactly one candidate = resolved
// (its ID may be null: a matched entrant with no ID chain shows the monogram). Zero, several, or no entrant list =
// unresolved. Never a mapping, never a "most likely" pick. An undated quote is not resolved at all.
'use strict';

const PROFILE_ALIAS = { 'Roland Garros': 'French Open' };

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[.,'’-]/g, ' ').replace(/\s+/g, ' ').trim();
// "T. Daniel" -> { ini: 't', sur: 'daniel' }; "J. M. Cerundolo" -> { ini: 'j', sur: 'cerundolo' }; "Tsitsipas" -> { ini: '', sur: 'tsitsipas' }
function parts(n) {
  const t = fold(n).split(' ').filter(Boolean);
  let i = 0;
  while (i < t.length - 1 && t[i].length === 1) i++;
  return { ini: i > 0 ? t[0][0] : '', sur: t.slice(i).join(' ') };
}

// -> { status: 'entrant' | 'ambiguous' | 'unmatched' | 'no-entrants' | 'undated', key, candidates }
function resolveSpeaker(cell, eventName, year, stores) {
  if (year == null) return { status: 'undated', key: null, candidates: [] };
  const profiles = (stores && stores.profiles) || {};
  const entrants = (stores && stores.entrants) || {};
  const prof = profiles[eventName] || profiles[PROFILE_ALIAS[eventName]] || null;
  const ed = prof ? (prof.allEditionMatches || []).find((e) => String(e.season) === String(year)) : null;
  const qe = entrants[eventName + '|' + year] || {};
  if (!ed && !qe.main && !qe.qual) return { status: 'no-entrants', key: null, candidates: [] };
  const q = parts(cell);
  if (!q.sur) return { status: 'unmatched', key: null, candidates: [] };
  const cands = [];
  // founder 2026-10-24: the speaker's surname is the entrant's surname or its LAST WHOLE WORD(S) — "Fokina" = Davidovich
  // Fokina, "Aliassime" = Auger-Aliassime (a hyphen splits words) — never part of a word ("Kina" is not Fokina)
  const sur = q.sur.split(' ');
  const tailIs = (words) => words.length >= sur.length && words.slice(words.length - sur.length).join(' ') === q.sur;
  if (ed) {
    const ent = new Map();
    (ed.matches || []).forEach((x) => { if (x.p1Key != null) ent.set(String(x.p1Key), x.p1); if (x.p2Key != null) ent.set(String(x.p2Key), x.p2); });
    ent.forEach((n, k) => { const p = parts(n); if (tailIs(p.sur.split(' '))) cands.push({ key: k, ini: p.ini, name: n }); });
  }
  // Sackmann entrants are full names ("Daniel Evans"): the speaker's surname is their tail, the initial their first letter
  const full = (e) => { const t = fold(e.name).split(' ').filter(Boolean);
    if (t.length > sur.length && tailIs(t)) cands.push({ key: e.key == null ? null : String(e.key), ini: t[0][0], name: e.name }); };
  if (!ed) (qe.main || []).forEach(full);
  (qe.qual || []).forEach(full);
  let hits = cands;
  if (hits.length > 1 && q.ini) { const by = hits.filter((c) => c.ini === q.ini); if (by.length === 1) hits = by; }
  if (hits.length === 1) return { status: 'entrant', key: hits[0].key, candidates: [hits[0].name] };
  return { status: hits.length ? 'ambiguous' : 'unmatched', key: null, candidates: hits.map((c) => c.name) };
}

module.exports = { resolveSpeaker, parts, fold, PROFILE_ALIAS };
