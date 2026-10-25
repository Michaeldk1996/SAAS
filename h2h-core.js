/*
 * h2h-core.js — TEN-437. The ONE head-to-head meeting list for the whole site.
 *
 * Every surface that shows an H2H record, a meeting count or anything computed over a pair's meetings (Match analysis →
 * H2H tab, Key factors' H2H box, the Head to Head page, the Download report that prints them) builds its meetings
 * here, from both players' career-history shards (career-history/{key}.json: the api-tennis fixture window plus the TML
 * archive). The edge model's H2H layer reads it too: the pipeline hands it in as h2h.matches (`modelH2hMatches`,
 * founder ruling 2026-10-14). The single-source guard in test-ten437-h2h.mjs fails CI on any other reader.
 *
 * One pure module, loaded by the dashboard (<script src>, window.H2HCore) and required by Node (the golden-pair gate,
 * the pipeline reconciliation). No DOM, no fetch, no Date.now: the same rows give the same meetings everywhere.
 *
 * POPULATION = ATP's official H2H record, read off atptour.com's own H2H data on 2026-10-14 (TEN-437 report B):
 *   counted  — tour-level main draw (250/500/1000), Grand Slams, ATP Finals, Next Gen ATP Finals, Davis Cup (every
 *              stage), Olympics, ATP Cup, United Cup, Laver Cup (2017 on), retirements, defaults
 *   excluded — Challengers and ITF (career-history level 'chitf'), every qualifying round (read from BOTH players'
 *              rows: `resolveQualifying`), Hopman Cup, exhibitions (Six Kings Slam, UTS, …), the Asian Games and Davis Cup
 *              Group III/IV round-robins (absent from ATP's list); walkovers are listed (flagged) but never counted
 * Each rule is one constant below (H2H_LEVELS, ATP_RECORD_NOT_COUNTED = H2H_NOT_COUNTED — H2H only) or one line in
 * `inPopulation`.
 */
(function (root) {
  'use strict';

  // Node requires the identity table; the browser reads window.TournamentIdentity at CALL time (this file loads in
  // <head>, before tournament-identity.js at the end of <body>).
  const TI_NODE = (typeof module !== 'undefined' && module.exports) ? require('./tournament-identity.js') : null;
  const ti = () => TI_NODE || (root && root.TournamentIdentity) || null;

  // career-history `level`. ATP's record is tour level only: 'chitf' (Challenger / ITF) rows are listed by ATP under
  // "other tournaments" and never counted.
  const H2H_LEVELS = ['atp'];
  // The events ATP's record leaves out although the feed tags them as men's singles — the H2H population's list, read by
  // H2H ONLY (founder 2026-10-16: "ATP's rules apply to H2H only"; Form keeps its own list in the pipeline / dashboard).
  // ATP's own data (H2H endpoint + player-activity IsWinLossCountable, 2026-10-16): Hopman Cup, exhibitions, the Asian
  // Games (Z. Zhang 2023: 19–17, no Hangzhou) and Davis Cup Group III/IV (Vacherot 2021 Group III 4–0, ATP 2021 0–0) are
  // not counted; Laver Cup, Davis Cup Finals / Qualifiers / World Group I–II, ATP Cup, United Cup, the Olympics and the
  // Next Gen Finals are.
  const ATP_RECORD_NOT_COUNTED = /hopman cup|ultimate tennis showdown|\buts\b|six kings|exhibition|kooyong classic|mubadala world tennis|asian games|davis cup.*group (iii|iv)\b|davis cup g[34]\b/i;
  const H2H_NOT_COUNTED = ATP_RECORD_NOT_COUNTED;
  // De-duplication window, days from a keyless archive row (dated at the EVENT's start, TML) to the keyed api-tennis
  // row of the same match (dated on the match day): Shanghai 2019 SF is 07.10 in the archive and 12.10 in the feed,
  // a Slam final up to 14 days after its start. A match is never earlier than its event's start (−1 for time zones).
  const H2H_DEDUPE_WINDOW = [-1, 16];

  // Surname + first initial ("J. Sinner" → sinner|j): the roster's namesake count and the join's name test.
  function nameKey(nm) { const t = String(nm || '').toLowerCase().replace(/['’.\-]/g, ' ').split(' ').filter(Boolean); return t.length >= 2 ? t[t.length - 1] + '|' + t[0][0] : null; }
  // Namesake counts for a roster of full or short names (the uniqueness test for one-sided rows).
  function nameCounts(names) { const o = {}; (names || []).forEach(n => { const k = nameKey(n); if (k) o[k] = (o[k] || 0) + 1; }); return o; }

  function dayNum(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null; }
  function eventId(name) {
    const s = String(name || '');
    if (/davis cup/i.test(s)) return 'davis cup';
    if (/laver cup/i.test(s)) return 'laver cup';
    if (/united cup/i.test(s)) return 'united cup';
    if (/atp cup/i.test(s)) return 'atp cup';
    const T = ti(), c = T && T.canonicalTournament ? T.canonicalTournament(s) : null;
    return c && c.id ? c.id : s.toLowerCase().replace(/^atp\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // One round code from the archive's ("SF", "R16", "RR") and the feed's ("Semi-finals", "1/8-finals") spellings; null
  // when unknown (an unknown round never blocks a match, a known different one always does).
  function roundCode(r) {
    const s = String(r || '').trim().toLowerCase().replace(/^.* - /, '');
    if (!s) return null;
    if (/^(f|final|the final)$/.test(s)) return 'F';
    if (/^(sf|semi-?finals?|semifinals?)$/.test(s)) return 'SF';
    if (/^(qf|quarter-?finals?|quarterfinals?)$/.test(s)) return 'QF';
    if (/^(rr|round robin)$/.test(s)) return 'RR';
    const frac = /^1\/(\d+)-finals?$/.exec(s); if (frac) return 'R' + (2 * +frac[1]);
    const rn = /^r(\d+)$/.exec(s); if (rn) return 'R' + rn[1];
    return null;
  }

  // TEN-437 (3): one match seen twice — a keyless archive row and a keyed feed row (or two rows from the two players'
  // shards dated by the two conventions) — is ONE meeting. Same winner, same event, the keyed row within
  // H2H_DEDUPE_WINDOW of the keyless one, rounds not contradicting. The keyed row is kept (it carries the match day and
  // reaches the match-stats shards); a keyless row that matches two keyed rows is ambiguous and kept as its own meeting.
  // Only a row ONE side recorded can be the other side's copy (a match both histories hold was already paired by the
  // join), so a candidate pair is one-sided rows from opposite sides; a team tie (Davis Cup) never merges — its id folds
  // every tie of a year into one.
  const ONE_SIDED = { a: 'b', b: 'a' };
  function dedupe(rows) {
    const keyed = rows.filter(x => x.eventKey != null);
    const drop = new Set(), taken = new Set();
    rows.filter(x => x.eventKey == null && ONE_SIDED[x._how]).forEach(x => {
      const d0 = dayNum(x.date); if (d0 == null) return;
      const ev = eventId(x.tournament), rc = roundCode(x.round);
      if (ev === 'davis cup') return;
      const hits = keyed.filter(y => {
        if (taken.has(y) || y.won !== x.won || y._how !== ONE_SIDED[x._how]) return false;
        const d = dayNum(y.date); if (d == null || d - d0 < H2H_DEDUPE_WINDOW[0] || d - d0 > H2H_DEDUPE_WINDOW[1]) return false;
        if (eventId(y.tournament) !== ev) return false;
        const yr = roundCode(y.round);
        return !(rc && yr && rc !== yr);
      });
      if (hits.length === 1) { taken.add(hits[0]); drop.add(x); }
    });
    return drop.size ? rows.filter(x => !drop.has(x)) : rows;
  }

  // ATP's H2H list (see the header). A walkover stays in the LIST, flagged — ATP lists it and never counts it, and so do
  // we: `record` and `played` leave it out; a retirement or a default is a meeting.
  // TEN-437 D1: a qualifying round is read from BOTH players' rows of the match, never from the first one alone. api-tennis
  // files a qualifying draw under the main-draw key with the bracket's own words ("Semi-finals", "Final"); the history
  // builder re-tags the winner's row "Qualifying" (first-loss net) but cannot re-tag the loser's, and a lucky loser's
  // main-draw wins get the same tag (Kwon, Adelaide 2 2023). A word-round feed row is decided by the event's main-draw
  // start: the first certified main-draw round ("1/N-finals") either player played at that event within 21 days. Before
  // it = qualifying; on or after it = main draw (its round read from the row that names one). No such row in either
  // history = qualifying when either row says so. Team events and certified rounds are never qualifying by date.
  const WORD_ROUND = /^(quarter-?finals?|semi-?finals?|final|qualif\w*)$/i, FRAC_ROUND = /^1\/\d+\s*-?\s*finals?$/i;
  const TEAM_EVENT = /davis cup|laver cup|united cup|atp cup/i;
  const rnd = r => String((r && r.round) || '').trim().replace(/^.* - /, '');
  const qualTag = r => !!r && (!!r.qualifying || /^qualif/i.test(rnd(r)));
  function resolveQualifying(x, all) {
    const tw = x._twin, rX = rnd(x), rT = rnd(tw);
    if (x.src === 'archive' || TEAM_EVENT.test(String(x.tournament || ''))) return x;
    if (FRAC_ROUND.test(rX) || FRAC_ROUND.test(rT)) return Object.assign({}, x, { qualifying: false, round: FRAC_ROUND.test(rX) ? x.round : tw.round });
    if (!WORD_ROUND.test(rX) && !WORD_ROUND.test(rT)) return x;                       // RR, blank, archive-style codes
    const mainWord = [x, tw].filter(r => r && WORD_ROUND.test(rnd(r)) && !qualTag(r)).map(rnd)[0] || null;
    if (!mainWord) return Object.assign({}, x, { qualifying: true });                 // every row of it says Qualifying
    // the event's main draw, from both players' own rows: same tournament, same level, around this date
    const d0 = dayNum(x.date); let md = null, rr = false;
    if (d0 != null) for (const r of all) {
      if (!r || r.tournament !== x.tournament || String(r.level || '') !== String(x.level || '')) continue;
      const d = dayNum(r.date); if (d == null || d - d0 < -16 || d - d0 > 5) continue;
      if (/^(rr|round robin|)$/i.test(rnd(r))) rr = true;                                // the Finals' group stage carries no round
      if (FRAC_ROUND.test(rnd(r)) && (md == null || d < md)) md = d;
    }
    if (rr) return Object.assign({}, x, { qualifying: false, round: mainWord });      // round-robin event (Finals): no qualifying draw
    // no main-draw round for either player at this event: a QF/SF/F needs one before it (a bye still plays R2) => qualifying.
    // Strictly BEFORE the first main-draw round = qualifying; ON that day it is main draw — these are the two players' own
    // rows, so one of them played a main-draw round that day (a rain-delayed double after a bye: R2 and QF together).
    if (md == null || d0 < md) return Object.assign({}, x, { qualifying: true });
    return Object.assign({}, x, { qualifying: false, round: mainWord });
  }

  function inPopulation(x) {
    return H2H_LEVELS.includes(String(x.level || '').toLowerCase())
      && !x.qualifying && !/^qualif/i.test(String(x.round || ''))   // (D1: resolveQualifying has already read both rows)
      && !H2H_NOT_COUNTED.test(String(x.tournament || ''));
  }

  // api-tennis keys that are one player (founder 2026-10-20, TEN-437): a one-sided feed row whose oppKey is an alias is
  // credited to the player it names. D. E. Galan: his opponents' 2021–22 rows carry 34000, his own shard is 1735 (Bublik
  // Miami 2022, Tsitsipas and Davidovich Fokina US Open 2022). Add a pair only on a founder ruling.
  const API_KEY_ALIASES = Object.freeze({ '34000': '1735' });
  function canonKey(k) { if (k == null || k === '') return null; const s = String(k); return Object.prototype.hasOwnProperty.call(API_KEY_ALIASES, s) ? API_KEY_ALIASES[s] : s; }

  // A-oriented career rows for the pair (TEN-402's join, unchanged; TEN-437 moved it here from the H2H page and added
  // `dedupe` and the ATP population). A meeting = a row in A's file that names B (or carries an eventKey B's file
  // holds), paired with B's row for the same match: the same eventKey, else the same date, opposite results and each
  // row naming the other. Two rows that disagree (same eventKey, other date or the same result) count nowhere.
  // ownEks: finished board matches between the two never count (ruling 2026-09-24).
  // TEN-437 D3 (founder 2026-10-16): a row only ONE side records is credited on the opponent's IDENTITY, never on a name
  // alone — an archive row only when its `oppId` (TML/ATP id) equals the other player's `id`; a feed row on its `oppKey`
  // (api-tennis key) against the other player's `key`. A feed row from a profile cached before `oppKey` existed still
  // falls back to the roster-unique-name rule (TEN-263) until that profile rebuilds; an archive row never does.
  // a / b: { full, short, key, id } (names as the roster prints them; key = api-tennis key; id = the shard's TML/ATP id).
  function joinMeetings(a, b, chA, chB, nkCount, ownEks) {
    const nk = nameKey, nkA = nk(a.full), nkB = nk(b.full), ck = canonKey;
    const uniq = k => !!k && ((nkCount || {})[k] || 0) <= 1;
    const up = v => (v == null || v === '' ? null : String(v).toUpperCase());
    // Is this one-sided row (from the owner's file) about `other`? Identity first; the name rule only for a legacy feed row.
    const isAbout = (r, other, nkOther) => {
      if (r.src === 'archive') return !!up(r.oppId) && up(r.oppId) === up(other.id);
      if (r.oppKey != null && r.oppKey !== '') return other.key != null && ck(r.oppKey) === ck(other.key);
      return uniq(nkOther);
    };
    const A = Array.isArray(chA) ? chA : [], B = Array.isArray(chB) ? chB : [];
    const bEk = new Map(B.filter(y => y && y.eventKey != null).map(y => [String(y.eventKey), y]));
    const used = new Set(), bad = new Set(), seen = new Set(), out = [];
    const flip = y => Object.assign({}, y, { won: !y.won, opponent: b.short,
      result: String(y.result || '').replace(/^\s*(\d+)\s*-\s*(\d+)\s*$/, '$2 - $1'),
      sets: Array.isArray(y.sets) ? y.sets.map(s => Object.assign({}, s, { p: s.o, o: s.p, pTb: s.oTb, oTb: s.pTb })) : y.sets });
    const push = (x, how, y) => {
      const k = x.eventKey != null ? 'e' + x.eventKey : 'd' + x.date + '|' + (x.round || '');
      if (seen.has(k)) return;
      seen.add(k); out.push(Object.assign({}, x, { _how: how, _twin: y || null }));
    };
    A.forEach(x => {
      if (!x || typeof x.won !== 'boolean') return;
      const ek = x.eventKey != null ? String(x.eventKey) : null, named = nk(x.opponent) === nkB;
      if (!named && !(ek && bEk.has(ek))) return;
      let y = ek ? bEk.get(ek) : null;
      if (y && (y.date !== x.date || y.won === x.won)) { bad.add(y); return; }
      if (!y) {
        const ys = B.filter(z => z && !used.has(z) && z.date === x.date && typeof z.won === 'boolean' && z.won !== x.won && nk(z.opponent) === nkA);
        if (ys.length === 1) y = ys[0];
      }
      if (y) { used.add(y); push(x, 'both', y); }
      else if (named && isAbout(x, b, nkB)) push(x, 'a');
    });
    B.forEach(y => {
      if (!y || used.has(y) || bad.has(y) || typeof y.won !== 'boolean' || nk(y.opponent) !== nkA || !isAbout(y, a, nkA)) return;
      push(flip(y), 'b');
    });
    const own = new Set((ownEks || []).map(String));
    const all = A.concat(B);
    return dedupe(out).map(x => resolveQualifying(x, all)).filter(x => inPopulation(x) && !(x.eventKey != null && own.has(String(x.eventKey))))
      .sort((x, y) => String(x.date).localeCompare(String(y.date)));
  }

  // The meetings that count (walkovers out) and the record over them (A's wins first): n = the population.
  // A walkover = the row's EXPLICIT flag (api-tennis 'Walk Over', Sackmann/TML W/O) — founder 2026-10-22, ruling 3: never
  // an empty score. The same test the rows the pages draw apply (fhFinishRow), so a record here and a record on screen can
  // never disagree. A default ("Awarded") and a retirement before the first set finished are meetings (TEN-437).
  function isWalkover(x) {
    return !!(x && x.walkover);
  }
  function played(rows) { return (rows || []).filter(x => !isWalkover(x)); }
  function record(rows) { const p = played(rows), a = p.filter(x => x.won).length; return { a, b: p.length - a, n: p.length }; }

  const api = { H2H_LEVELS, ATP_RECORD_NOT_COUNTED, H2H_NOT_COUNTED, H2H_DEDUPE_WINDOW, API_KEY_ALIASES, canonKey, nameKey, nameCounts, eventId, roundCode, dedupe, resolveQualifying, inPopulation, joinMeetings, isWalkover, played, record };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.H2HCore = api;
})(typeof window !== 'undefined' ? window : this);
