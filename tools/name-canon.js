'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ONE name normaliser, used to canonicalise BOTH sides of a player-name join.
//
// FOUNDER RULING 2026-09-19:
//   "Build a proper name normaliser at the source: canonicalise BOTH sides to
//    one form, handle the multi-part surnames (Moreno De Alboran, Meligeni
//    Alves, Pacheco Mendez, A. Gomez, K. Trotter, Pinnington Jones) and the
//    Mccabe/McCabe casing.  Do NOT join on surname alone anywhere, ever."
//
// WHY A ROSTER LOOKUP AND NOT A PURE TRANSFORM
// ────────────────────────────────────────────
// The profile store writes initial-last ("J. P. Ficovich"); the Challenger
// classifier writes full names ("Juan Pablo Ficovich"). You cannot convert one
// to the other with a pure function, because the split between given names and
// surname is not recoverable from the string:
//
//     Juan Pablo Ficovich        -> J. P. Ficovich        (surname = 1 token)
//     Nicolas Moreno De Alboran  -> N. Moreno De Alboran  (surname = 3 tokens)
//
// Both are "first token + rest" by shape, and abbreviating "the rest" is right
// for one and wrong for the other. So the roster supplies the SEGMENTATION, and
// this module supplies the matching rule.
//
// THE MATCHING RULE
// ─────────────────
//   surname  = the LAST token, compared exactly
//   givens   = every preceding token, compared PREFIX-WISE, position by position,
//              over min(len_a, len_b) tokens
//
// Prefix-wise is what makes an abbreviation match its expansion ("f" ~ "felipe",
// "j" ~ "jack") while still separating two players who share an initial. That
// second property is the whole reason this is not a first-initial comparison:
//
//     Dali Blanch     -> givens ["dali"]
//     Dar. Blanch     -> givens ["dar"]     (Darwin, a DIFFERENT player)
//
// "dali" and "dar" are not prefixes of each other, so they do not match. A
// first-initial key (the old `surname|initial` shape) collapses both to
// `blanch|d` and would paint Dali's archetype onto Darwin. The store writes
// "Dar." precisely to disambiguate two Blanches, and this rule respects it.
//
// AND THE UNIQUENESS GUARD
// ────────────────────────
// A resolution is returned ONLY when exactly one roster row is compatible. Two
// or more candidates means the name is genuinely ambiguous and the caller gets
// null — blank is correct, a wrong archetype on a real player is not.
// ─────────────────────────────────────────────────────────────────────────────

// Lowercasing is also what folds the Mccabe/McCabe casing difference.
function canonName(name) {
  const s = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // deaccent
    .toLowerCase()
    .replace(/['’]/g, '')                           // O'Connell -> oconnell
    .replace(/[.\-]/g, ' ')                              // "J. P." / hyphens -> tokens
    .replace(/\s+/g, ' ')
    .trim();
  const parts = s.split(' ').filter(Boolean);
  if (parts.length < 2) return null;                     // a lone token is not a name
  return { surname: parts[parts.length - 1], givens: parts.slice(0, -1) };
}

// Never surname-alone: a compatible pair must agree on the surname AND on at
// least one given-name token.
function namesCompatible(a, b) {
  if (!a || !b) return false;
  if (a.surname !== b.surname) return false;
  const n = Math.min(a.givens.length, b.givens.length);
  if (!n) return false;                                  // surname-only -> refuse
  for (let i = 0; i < n; i++) {
    const x = a.givens[i], y = b.givens[i];
    if (!(x.startsWith(y) || y.startsWith(x))) return false;
  }
  return true;
}

// roster: { key -> { name } } (the profile store shape). Bucketed on surname so
// resolution is a short scan, never a full sweep.
function buildRosterIndex(roster) {
  const bySurname = new Map();
  for (const key of Object.keys(roster || {})) {
    const row = roster[key];
    const name = row && row.name;
    const c = canonName(name);
    if (!c) continue;
    if (!bySurname.has(c.surname)) bySurname.set(c.surname, []);
    bySurname.get(c.surname).push({ key, name, canon: c });
  }
  return bySurname;
}

// -> { key, name } when exactly one roster row is compatible, else null.
// `null` covers both "nobody" (off-roster) and "more than one" (ambiguous);
// callers that need to tell them apart use resolveNameDetailed.
function resolveName(name, index) {
  const r = resolveNameDetailed(name, index);
  return r.status === 'resolved' ? r.match : null;
}

function resolveNameDetailed(name, index) {
  const c = canonName(name);
  if (!c) return { status: 'unparseable', match: null, candidates: [] };
  const bucket = index.get(c.surname) || [];
  const cands = bucket.filter(r => namesCompatible(c, r.canon));
  if (cands.length === 1) return { status: 'resolved', match: cands[0], candidates: cands };
  if (cands.length > 1) return { status: 'ambiguous', match: null, candidates: cands };
  return { status: 'absent', match: null, candidates: [] };
}

module.exports = { canonName, namesCompatible, buildRosterIndex, resolveName, resolveNameDetailed };
