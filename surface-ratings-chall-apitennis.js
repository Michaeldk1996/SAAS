// =================================================================
// Live api-tennis Challenger source for surface-ratings.js
// -----------------------------------------------------------------
// WHY: surface-ratings.js folds Challenger/qualifying serve/return/under-pressure
//   sample into thin-at-tour players, but its only Challenger source is the static
//   Milos191405/Tennis-ATP mirror which STOPS at 2024 — so a 2025/26 Challenger
//   regular (e.g. Blockx, 56 finished 2025-26 Challenger matches) contributes
//   nothing current. api-tennis event_type_key=281 (Challenger Men Singles) carries
//   the SAME full per-match serve/return/BP catalog live (verified 2026-08-07). This
//   module fetches, per roster player, that player's Challenger fixtures via one
//   ranged request each and emits contributions in the EXACT shape surface-ratings.js
//   already consumes (see addContribution / the static challenger scan), so the api
//   sample is folded through the identical discount + blend math with zero divergence.
//
// Stat mapping — period='match' rows only; match stat_name case-INSENSITIVELY
//   (the feed lowercased names at the 2025/26 boundary), stat_type exactly:
//     svpt      = Points  / Service Points Won        .stat_total
//     firstIn   = Service / 1st Serve Points Won       .stat_total  (1st serves in)
//     firstWon  = Service / 1st Serve Points Won       .stat_won
//     secondWon = Service / 2nd Serve Points Won       .stat_won
//     ace       = Service / Aces                       .stat_value
//     df        = Service / Double Faults              .stat_value
//     svGms     = Games   / Service Games Won          .stat_total  (service games played)
//     bpFaced   = Service / Break Points Saved         .stat_total
//     bpSaved   = Service / Break Points Saved         .stat_won
//   Return/opponent-serve fields (o*) come from the OPPONENT's block in the same
//   fixture — every fixture carries both players' stat rows.
// =================================================================
const API_BASE = 'https://api.api-tennis.com/tennis/';
const CHALL_EVENT_TYPE = 281;   // Challenger Men Singles

// One player, a date range, statistics inline — mirrors bsp-pipeline / styles supplement.
// TEN-254 (2026-09-23): returns `{ ok, rows, reason }` — NOT a bare array.
//
// ⚠️ WHY THE SHAPE CHANGED. This used to return `[]` for BOTH "the player genuinely
// has no Challenger matches" and "api-tennis refused the call", and the caller
// collapsed the two with `if (!fx || !fx.length) continue`. Two consequences:
//
//   1. 17 of the 40 zero-Challenger players on the board were not real zeros — they
//      were never-fetched — and nothing downstream could tell the difference.
//   2. ⚠️ `!data.success` returned `[]`. An UNPAID api-tennis key answers HTTP 200
//      with a falsy `success` and `cod 1006`, so an unpaid key would have produced
//      384 "genuine empties" and published a store with ZERO Challenger data as a
//      clean success — exactly the "never publish a thinner store as a success"
//      failure. `!data.success` is now an ERROR, not an empty.
//
// ok:false is a REFUSAL (transport, HTTP, unparseable body, or success-falsy).
// ok:true with rows:[] is a real, trustworthy "no Challenger matches in the window".
async function fetchPlayerChallengerFixtures(apiKey, playerKey, dateStart, dateStop) {
  const url = `${API_BASE}?method=get_fixtures&APIkey=${apiKey}&date_start=${dateStart}&date_stop=${dateStop}&player_key=${playerKey}&event_type_key=${CHALL_EVENT_TYPE}`;
  let res;
  try { res = await fetch(url); } catch (e) { return { ok: false, rows: null, reason: 'transport' }; }
  if (!res) return { ok: false, rows: null, reason: 'no-response' };
  if (!res.ok) return { ok: false, rows: null, reason: 'http-' + res.status };
  let data;
  try { data = await res.json(); } catch (e) { return { ok: false, rows: null, reason: 'unparseable' }; }
  if (!data) return { ok: false, rows: null, reason: 'empty-body' };
  if (!data.success) {
    // Carry the vendor code so a quota/entitlement refusal is diagnosable, but NEVER
    // the URL or the key — the key rides in the query string.
    const code = data.cod != null ? String(data.cod) : (data.error != null ? 'error' : 'no-success');
    return { ok: false, rows: null, reason: 'api-refused:' + code };
  }
  return { ok: true, rows: Array.isArray(data.result) ? data.result : [], reason: null };
}

function pickStat(rows, type, name) {
  const nl = name.toLowerCase();
  return rows.find(s => s.stat_type === type && String(s.stat_name).toLowerCase() === nl);
}
function int(v) { if (v == null) return null; const x = parseInt(String(v).replace('%', ''), 10); return Number.isFinite(x) ? x : null; }

// Build one player's serve block for a single fixture from its match-period stat rows.
// Returns null if the essential counters (service points + 1st-serve points) are absent.
function serveBlock(matchRows, playerKey) {
  const rows = matchRows.filter(s => String(s.player_key) === String(playerKey) && String(s.stat_period || 'match') === 'match');
  if (!rows.length) return null;
  const svptRow = pickStat(rows, 'Points', 'Service Points Won');
  const firstRow = pickStat(rows, 'Service', '1st Serve Points Won');
  const secondRow = pickStat(rows, 'Service', '2nd Serve Points Won');
  const svGmsRow = pickStat(rows, 'Games', 'Service Games Won');
  const aceRow = pickStat(rows, 'Service', 'Aces');
  const dfRow = pickStat(rows, 'Service', 'Double Faults');
  const bpRow = pickStat(rows, 'Service', 'Break Points Saved');
  const svpt = int(svptRow && svptRow.stat_total);
  const firstIn = int(firstRow && firstRow.stat_total);
  const firstWon = int(firstRow && firstRow.stat_won);
  if (svpt == null || firstIn == null) return null;   // no serve sample -> skip fixture
  return {
    svpt, firstIn, firstWon: firstWon || 0,
    secondWon: int(secondRow && secondRow.stat_won) || 0,
    svGms: int(svGmsRow && svGmsRow.stat_total) || 0,
    ace: int(aceRow && aceRow.stat_value) || 0,
    df: int(dfRow && dfRow.stat_value) || 0,
    bpFaced: int(bpRow && bpRow.stat_total),           // may be null -> addContribution guards
    bpSaved: bpRow && bpRow.stat_total != null ? (int(bpRow.stat_won) || 0) : null,
  };
}

// Reconstruct tiebreak / deciding-set outcomes for the player from the per-set scores
// array. Best-effort: a set is a tiebreak if the higher game count is 7 and the lower 6;
// the deciding set is the last set of a completed best-of match.
function scoreOutcomes(fixture, meIsFirst) {
  const out = { tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0 };
  const scores = Array.isArray(fixture.scores) ? fixture.scores.filter(s => s && (s.score_first != null)) : [];
  if (!scores.length) return out;
  const sets = scores.map(s => {
    const a = parseInt(s.score_first, 10), b = parseInt(s.score_second, 10);
    return { me: meIsFirst ? a : b, op: meIsFirst ? b : a };
  }).filter(s => Number.isFinite(s.me) && Number.isFinite(s.op))
    // api-tennis pads `scores` to 5 sets with unplayed 0-0 rows; drop them before any
    // length/deciding-set logic (a real played set always has a winner with >=6 games).
    .filter(s => !(s.me === 0 && s.op === 0));
  for (const s of sets) {
    const hi = Math.max(s.me, s.op), lo = Math.min(s.me, s.op);
    if (hi === 7 && lo === 6) { out.tbPlayed++; if (s.me > s.op) out.tbWon++; }
  }
  const retired = /\b(RET|W\/O|DEF|ABD|WALK|Def)\b/i.test(String(fixture.event_final_result || ''));
  if (!retired && (sets.length === 3 || sets.length === 5)) {
    const last = sets[sets.length - 1];
    out.decPlayed = 1; out.decWon = last.me > last.op ? 1 : 0;
  }
  return out;
}

function ymdToMs(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

// Build the full contribution list for one player's fixtures.
function buildContribs(fixtures, playerKey, surfaceMap) {
  const contribs = [];
  for (const f of fixtures) {
    if (!Array.isArray(f.statistics) || !f.statistics.length) continue;
    // opponent key = whichever side is not the player
    const oppKey = String(f.first_player_key) === String(playerKey) ? f.second_player_key : f.first_player_key;
    const meIsFirst = String(f.first_player_key) === String(playerKey);
    const mine = serveBlock(f.statistics, playerKey);
    const opp = serveBlock(f.statistics, oppKey);
    if (!mine) continue;                                // no serve sample for the player
    const smRaw = surfaceMap.get(String(f.tournament_key));
    const surface = smRaw === 'clay' ? 'Clay' : smRaw === 'hard' ? 'Hard' : smRaw === 'grass' ? 'Grass' : null;
    const ps = scoreOutcomes(f, meIsFirst);
    contribs.push({
      date: ymdToMs(f.event_date), surface,           // surface may be null -> All-scope only
      svpt: mine.svpt, firstIn: mine.firstIn, firstWon: mine.firstWon, secondWon: mine.secondWon,
      svGms: mine.svGms, ace: mine.ace, df: mine.df,
      bpFaced: mine.bpFaced, bpSaved: mine.bpSaved,
      oSvpt: opp ? opp.svpt : 0, oFirstIn: opp ? opp.firstIn : 0, oFirstWon: opp ? opp.firstWon : 0,
      oSecondWon: opp ? opp.secondWon : 0, oSvGms: opp ? opp.svGms : 0,
      oBpFaced: opp ? opp.bpFaced : null, oBpSaved: opp ? opp.bpSaved : null,
      tbPlayed: ps.tbPlayed, tbWon: ps.tbWon, decPlayed: ps.decPlayed, decWon: ps.decWon,
    });
  }
  return contribs;
}

// TEN-254: the FAIL-LOUD threshold. If more than this share of the player fetches is
// REFUSED by api-tennis, the caller must abort rather than commit a thinner store.
//
// 2% chosen against the measured shape of a healthy run: run 12 (2026-09-23) fetched
// 384 of 384 with zero refusals, so the normal value is 0%. 2% of 384 is ~7 calls, so
// one or two transient 5xx do not fail a nightly build — while a quota or entitlement
// refusal fails EVERY call (100%) and trips this on the first handful. That is the
// shape we want: tolerate flakiness, catch systemic.
const MAX_REFUSAL_RATE = 0.02;

// Public API. candidates: [{ playerKey, name }].
// Returns { contribs: [{ playerKey, name, contribs }], resolvedKeys: Set, refusals, fetched, refusalRate, reasons }.
//
// ⚠️ NO LONGER a bare array, and no longer "best-effort". A refused fetch is recorded,
// not silently skipped: `resolvedKeys` is what surface-ratings.js turns into
// `challResolved`, and `refusalRate` is what makes the run exit 1 instead of
// publishing a store whose Challenger side quietly vanished.
async function fetchChallengerContribs(candidates, opts) {
  const { apiKey, fromYear, dateStop, surfaceMap, concurrency = 6, log = () => {} } = opts;
  const dateStart = `${fromYear}-01-01`;
  const out = [];
  const resolvedKeys = new Set();          // fetch SUCCEEDED (even if it returned no matches)
  const reasons = new Map();               // reason -> count, for the abort message
  let i = 0, fetched = 0, refusals = 0, withData = 0, totalMatches = 0;
  async function worker() {
    while (i < candidates.length) {
      const idx = i++;
      const c = candidates[idx];
      const r = await fetchPlayerChallengerFixtures(apiKey, c.playerKey, dateStart, dateStop);
      fetched++;
      if (!r || !r.ok) {
        refusals++;
        const why = (r && r.reason) || 'unknown';
        reasons.set(why, (reasons.get(why) || 0) + 1);
        continue;                          // NOT resolved — stays out of resolvedKeys
      }
      // A successful fetch that returned no matches is a REAL zero, and the player is
      // resolved. That distinction is the whole point of this change.
      resolvedKeys.add(String(c.playerKey));
      if (!r.rows.length) continue;
      const contribs = buildContribs(r.rows, c.playerKey, surfaceMap);
      if (contribs.length) { withData++; totalMatches += contribs.length; out.push({ playerKey: c.playerKey, name: c.name, contribs }); }
      if (fetched % 25 === 0) log(`  chall-api: ${fetched}/${candidates.length} fetched, ${refusals} refused, ${withData} with data, ${totalMatches} matches`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  const refusalRate = fetched ? refusals / fetched : 0;
  log(`chall-api: ${fetched} fetched, ${refusals} refused (${(refusalRate * 100).toFixed(2)}%), ` +
      `${resolvedKeys.size} resolved -> ${withData} players with Challenger data, ${totalMatches} matches total.`);
  if (reasons.size) log(`  chall-api refusal reasons: ${[...reasons].map(([k, v]) => k + '×' + v).join(', ')}`);
  return { contribs: out, resolvedKeys, refusals, fetched, refusalRate, reasons, maxRefusalRate: MAX_REFUSAL_RATE };
}

module.exports = { fetchChallengerContribs, fetchPlayerChallengerFixtures, buildContribs, serveBlock };
