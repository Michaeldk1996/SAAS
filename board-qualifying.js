// Founder 2026-10-31 (publish-and-qualifying): qualifying matches are SHOWN on Today's Matches, never hidden, and
// carry their own label (`Q1`, `Q2`, else `Qualifying`) and their own tournament chip.
//
// api-tennis's `event_qualification` flag is not enough on its own: the Paris Masters 2026 qualifying rows (31 Oct)
// arrive with `event_qualification: null` and no round, under the main draw's tournament key (1725). So a fixture is
// qualifying when
//   (1) the feed flags it (`event_qualification === 'True'`)                                      basis 'flag'
//   (2) or its event's OFFICIAL main draw (draws.json, the ATP supervisor's protennislive sheet) starts AFTER the
//       fixture's date, and
//       (a) the qualifying sheet is posted and both players are on it                               basis 'qual-sheet'
//       (b) the qualifying sheet is not posted and neither player is on the posted main-draw sheet  basis 'before-main-draw'
// The fixture's event is found through the ATP tier map (api-tennis tournament_key -> ATP id -> draws.json entry).
// No sheet for the event, or a fixture on / after the main-draw start: only the flag decides.
//
// Round: never guessed. The feed names a qualifying bracket's rounds with main-draw words ("Semi-finals", "Final").
// With a posted qualifying sheet the bracket depth is known (rounds = log2(qualifying size / qualifier places)), so
// "Final" is the last round (Q<rounds>), "Semi-finals" the one before, and so on. Anything less -> no round (the card
// reads "Qualifying").
(function (root) {
  'use strict';

  // ATP id from a tier-map event's atptour.com URL (".../tournaments/paris/352/overview")
  function atpIdOf(e) { const m = String((e && e.source_url) || '').match(/\/tournaments\/[^/]+\/(\d+)\//); return m ? m[1] : null; }

  // tournament_key (string) -> draws.json tournament entry
  function buildIndex(draws, tierMap) {
    const out = {};
    const T = (draws && draws.tournaments) || {};
    for (const e of Object.values((tierMap && tierMap.events) || {})) {
      const id = atpIdOf(e);
      if (!id || !T[id]) continue;
      for (const k of (e.tournament_keys || [])) out[String(k)] = T[id];
    }
    return out;
  }

  function keysOf(sheet) {
    return new Set(((sheet && sheet.slots) || []).map(s => (s && s.playerKey != null ? String(s.playerKey) : '')).filter(Boolean));
  }
  function qualifierPlaces(main) {
    return ((main && main.slots) || []).filter(s => s && (s.entry === 'Q' || /qualifier/i.test(String(s.name || '')))).length;
  }
  const ROUND_FROM_END = { 'final': 0, 'semi-finals': 1, 'semifinals': 1, 'quarter-finals': 2, 'quarterfinals': 2 };
  function roundWord(r) { const s = String(r || '').split(' - ').pop().trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(ROUND_FROM_END, s) ? ROUND_FROM_END[s] : null; }

  // -> { qualifying: boolean, round: 'Q1' | 'Q2' | … | null, basis: 'flag' | 'qual-sheet' | 'before-main-draw' | null }
  function classify(f, index) {
    const flag = f && f.event_qualification === 'True';
    const draw = f && index ? index[String(f.tournament_key)] : null;
    let basis = flag ? 'flag' : null;
    if (!flag && draw && draw.startDate && f.event_date && String(f.event_date) < String(draw.startDate)) {
      const a = String(f.first_player_key || ''), b = String(f.second_player_key || '');
      const q = draw.qualifying || {}, m = draw.main || {};
      if (q.status === 'posted') {
        const qk = keysOf(q);
        if (a && b && qk.has(a) && qk.has(b)) basis = 'qual-sheet';
      } else if (m.status === 'posted') {
        const mk = keysOf(m);
        if (a && b && !mk.has(a) && !mk.has(b)) basis = 'before-main-draw';
      }
    }
    if (!basis) return { qualifying: false, round: null, basis: null };
    let round = null;
    const k = roundWord(f.tournament_round);
    const q = draw && draw.qualifying, places = draw && qualifierPlaces(draw.main);
    if (k != null && q && q.status === 'posted' && q.size > 0 && places > 0) {
      const rounds = Math.log2(q.size / places);
      if (Number.isInteger(rounds) && rounds - k >= 1) round = 'Q' + (rounds - k);
    }
    return { qualifying: true, round, basis };
  }

  const api = { buildIndex, classify, atpIdOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BoardQualifying = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
