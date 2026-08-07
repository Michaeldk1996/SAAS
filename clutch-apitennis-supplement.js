// =================================================================
// UNDER-PRESSURE SUPPLEMENT (api-tennis) — sub-floor / Challenger players
// -----------------------------------------------------------------
// clutch-rating.js derives the ATP Under-Pressure four components from TML
// (Sackmann schema), which is TOUR-ONLY and career-aggregate. Young players and
// Challenger regulars (Merida Aguilar, Draxl, Tirante ...) never accrue enough
// TOUR matches to clear the floors, so their under-pressure row reads "No data".
//
// api-tennis DOES carry their Challenger + Tour matches with inline per-match
// statistics (Break Points Saved / Converted, plus per-set scores for tiebreaks
// and deciding sets). This builder reproduces the SAME four-component formula on
// that api-tennis data for the requested players, percentile-places them against
// the EXISTING clutch-rating.json pool (so the index means the same thing), and
// emits provisional rows flagged `source:"api-tennis"` + `provisional:true`.
//
// LEVEL HANDLING (founder ruling, TEN-8, 2026-08-07):
//   1. ATP-FIRST — for each component, if the player's ATP main-tour sample
//      alone clears the floor, use the ATP-only rate (no discount, no blend).
//   2. COMPONENT-SPECIFIC δ — otherwise, fall back to a denominator-weighted
//      blend of ATP + Challenger, where the Challenger rate is first discounted
//      by a PER-COMPONENT δ (not a flat haircut) measured by within-player
//      ATP-vs-Challenger differencing:
//        δ = { BP-saved 0.0, BP-converted 3.0, tiebreak 2.5, deciding-set 6.3 } pp
//   3. EXCLUDE ITF — ITF matches are dropped entirely from these ratings.
//
// Output: clutch-supplement.json (sidecar). Reads are metered — one
// get_fixtures per player.
// =================================================================
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.api-tennis.com/tennis/';
const WINDOW_START = '2019-01-01';
const WINDOW_STOP = process.env.SUPP_STOP || '2026-08-07';
// per-component reliability floors — identical to clutch-rating.js
const MIN_BP_FACED = 50, MIN_BP_CHANCE = 50, MIN_TB = 10, MIN_DEC = 8;
// component-specific Challenger→ATP discount (percentage points), founder-ruled.
const DELTA = { bpSavedPct: 0.0, bpConvPct: 3.0, tbWinPct: 2.5, decWinPct: 6.3 };
const RET = /\b(RET|W\/O|DEF|ABD|Walkover|Def)\b/i;

function apiKey() {
  // key lives in the bsp-consult-project checkout's .env (same project key)
  for (const p of [path.join(process.env.HOME, 'bsp-consult-project', '.env'), path.join(__dirname, '.env')]) {
    if (!fs.existsSync(p)) continue;
    const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).find(l => /apitennis|api_tennis/i.test(l) && l.includes('='));
    if (line) return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('api-tennis key not found');
}

// Classify an api-tennis fixture by competition tier. ITF is excluded from
// these ratings; Challenger carries the δ discount; everything else that is not
// ITF/Challenger is treated as full tour-level (Atp Singles, Grand Slam, etc.).
function levelOf(f) {
  const t = `${f.event_type_type || ''} ${f.tournament_name || ''}`;
  if (/itf/i.test(t)) return 'itf';
  if (/challenger/i.test(t)) return 'ch';
  if (/\batp\b|grand ?slam|masters|united cup|davis|olympic/i.test(t)) return 'atp';
  return 'other'; // unknown tier — excluded from ratings, logged
}

// Parse a per-set scores array. api-tennis encodes a tiebreak set as
// "7.7-6.4" (games.tiebreakPoints); "0-0" is an unplayed/walkover set. Floor to
// games. Returns per-side tiebreak + deciding-set outcomes for THIS player.
function parseScores(scores, iAmFirst, finalResult) {
  const out = { tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0 };
  if (!scores || !scores.length || RET.test(finalResult || '')) return out;
  let setsMe = 0, setsOpp = 0;
  for (const s of scores) {
    const gf = Math.floor(parseFloat(s.score_first)), gs = Math.floor(parseFloat(s.score_second));
    if (!Number.isFinite(gf) || !Number.isFinite(gs) || (gf === 0 && gs === 0)) continue;
    const me = iAmFirst ? gf : gs, opp = iAmFirst ? gs : gf;
    if (Math.max(me, opp) === 7 && Math.min(me, opp) === 6) { out.tbPlayed++; if (me > opp) out.tbWon++; }
    if (me > opp) setsMe++; else if (opp > me) setsOpp++;
  }
  const total = setsMe + setsOpp;
  const bestOf = total >= 4 ? 5 : 3;
  if ((bestOf === 3 && total === 3) || (bestOf === 5 && total === 5)) { out.decPlayed = 1; if (setsMe > setsOpp) out.decWon = 1; }
  return out;
}

function emptyAcc() {
  return { matches: 0, bpFaced: 0, bpSaved: 0, brkChances: 0, brkMade: 0, tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0 };
}

async function harvest(key, playerKey) {
  const url = `${API_BASE}?method=get_fixtures&APIkey=${key}&date_start=${WINDOW_START}&date_stop=${WINDOW_STOP}&player_key=${playerKey}`;
  const res = await fetch(url);
  const j = await res.json();
  const R = (j.result || []).filter(f => f.event_status === 'Finished');
  // Split accumulators by tier; ITF and unknown tiers are excluded from ratings.
  const acc = { atp: emptyAcc(), ch: emptyAcc() };
  const levelCount = { atp: 0, ch: 0, itf: 0, other: 0 };
  for (const f of R) {
    const stats = (f.statistics || []).filter(s => s.player_key === +playerKey && s.stat_period === 'match');
    if (!stats.length) continue;
    const bs = stats.find(s => s.stat_name === 'Break Points Saved');
    const bc = stats.find(s => s.stat_name === 'Break Points Converted');
    if (!bs && !bc) continue;
    const lvl = levelOf(f);
    levelCount[lvl] = (levelCount[lvl] || 0) + 1;
    if (lvl !== 'atp' && lvl !== 'ch') continue; // exclude ITF + unknown tiers
    const a = acc[lvl];
    a.matches++;
    if (bs && +bs.stat_total) { a.bpFaced += +bs.stat_total; a.bpSaved += +bs.stat_won; }
    if (bc && +bc.stat_total) { a.brkChances += +bc.stat_total; a.brkMade += +bc.stat_won; }
    const ps = parseScores(f.scores, f.first_player_key === +playerKey, f.event_final_result);
    a.tbPlayed += ps.tbPlayed; a.tbWon += ps.tbWon; a.decPlayed += ps.decPlayed; a.decWon += ps.decWon;
  }
  return { acc, levelCount };
}

// ATP-first + component-specific δ blend. Returns {pct, basis, denom} or null.
function component(atpWon, atpTot, chWon, chTot, floor, delta) {
  if (atpTot >= floor) {
    return { pct: +(atpWon / atpTot * 100).toFixed(1), basis: 'atp', denom: atpTot, atpDenom: atpTot, chDenom: 0 };
  }
  const tot = atpTot + chTot;
  if (tot >= floor && chTot > 0) {
    const atpRate = atpTot ? atpWon / atpTot * 100 : 0;
    const chRate = chWon / chTot * 100 - delta; // discount Challenger before pooling
    const blended = (atpRate * atpTot + chRate * chTot) / tot;
    return { pct: +blended.toFixed(1), basis: atpTot ? 'blend' : 'ch-disc', denom: tot, atpDenom: atpTot, chDenom: chTot };
  }
  return null;
}

function pctOf(sortedArr, v) {
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedArr[mid] < v) lo = mid + 1; else hi = mid; }
  return sortedArr.length ? lo / sortedArr.length * 100 : 0;
}

(async () => {
  const targets = JSON.parse(fs.readFileSync(process.env.TARGETS, 'utf8')); // [{key,name,full}]
  const key = apiKey();

  // Build percentile pool arrays from the EXISTING clutch-rating.json so a
  // provisional index means the same thing as a full-data one.
  const existing = require('./clutch-rating.json');
  const P = {};
  for (const comp of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) {
    P[comp] = existing.players.map(r => r[comp]).filter(v => v != null).sort((x, y) => x - y);
  }
  const existingNames = new Set(existing.players.map(p => p.name));

  const rows = [];
  for (const t of targets) {
    if (t.full == null) { console.log(`skip ${t.name} (no identity)`); continue; }
    let h;
    try { h = await harvest(key, t.key); }
    catch (e) { console.log(`  ERR ${t.name}: ${e.message}`); continue; }
    const { acc, levelCount } = h;
    const A = acc.atp, C = acc.ch;

    const cSaved = component(A.bpSaved, A.bpFaced, C.bpSaved, C.bpFaced, MIN_BP_FACED, DELTA.bpSavedPct);
    const cConv = component(A.brkMade, A.brkChances, C.brkMade, C.brkChances, MIN_BP_CHANCE, DELTA.bpConvPct);
    const cTb = component(A.tbWon, A.tbPlayed, C.tbWon, C.tbPlayed, MIN_TB, DELTA.tbWinPct);
    const cDec = component(A.decWon, A.decPlayed, C.decWon, C.decPlayed, MIN_DEC, DELTA.decWinPct);
    const cmp = { bpSavedPct: cSaved, bpConvPct: cConv, tbWinPct: cTb, decWinPct: cDec };

    const comp = {};
    const basis = {};
    for (const c of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) {
      comp[c] = cmp[c] ? cmp[c].pct : null;
      basis[c] = cmp[c] ? cmp[c].basis : null;
    }
    const parts = [];
    for (const c of ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct']) if (comp[c] != null) parts.push(pctOf(P[c], comp[c]));
    const clutchIndex = parts.length ? +(parts.reduce((s, v) => s + v, 0) / parts.length).toFixed(1) : null;
    const have = parts.length;
    // api-tennis provisional rows cap at 'med' regardless of basis (source
    // differs from the TML pool); <3 components → 'low'. `basis` records
    // whether each component is pure-ATP or δ-blended for transparency.
    const confidence = have >= 3 ? 'med' : 'low';
    // Abbreviated "I. Lastname" name so the resolvePlayer join matches on any format.
    const pp = t.full.trim().split(/\s+/);
    const abbrName = pp.length >= 2 ? `${pp[0][0]}. ${pp.slice(1).join(' ')}` : t.full;
    rows.push({
      name: abbrName, fullName: t.full, playerKey: t.key,
      clutchIndex, atpStyleRating: null,
      confidence,
      provisional: true, source: 'api-tennis',
      ...comp,
      basis,
      sample: {
        matches: A.matches + C.matches,
        atpMatches: A.matches, chMatches: C.matches, itfExcluded: levelCount.itf, otherExcluded: levelCount.other,
        bpFaced: A.bpFaced + C.bpFaced, bpChances: A.brkChances + C.brkChances,
        tbPlayed: A.tbPlayed + C.tbPlayed, decPlayed: A.decPlayed + C.decPlayed,
      },
      alreadyInPool: existingNames.has(abbrName),
    });
    const r = rows[rows.length - 1];
    console.log(`  ${t.full.padEnd(26)} idx=${clutchIndex == null ? 'null' : clutchIndex}  BPsv=${comp.bpSavedPct}(${basis.bpSavedPct}) BPcv=${comp.bpConvPct}(${basis.bpConvPct}) TB=${comp.tbWinPct}(${basis.tbWinPct}) DEC=${comp.decWinPct}(${basis.decWinPct})  [${have}/4 ${r.confidence}]  atp=${A.matches} ch=${C.matches} itf=${levelCount.itf}`);
  }

  const supp = {
    generatedAt: new Date().toISOString(),
    source: 'api-tennis per-match statistics (Tour + Challenger, ITF excluded) — provisional under-pressure for players below TML tour floors',
    method: 'Same four ATP Under-Pressure components as clutch-rating.js. ATP-first: use tour-only rate when its floor clears; otherwise denominator-weighted blend of ATP + Challenger with the Challenger rate discounted by a component-specific δ. ITF excluded. clutchIndex = mean percentile vs the existing clutch-rating.json pool.',
    floors: { minBpFaced: MIN_BP_FACED, minBpChances: MIN_BP_CHANCE, minTiebreaks: MIN_TB, minDecidingSets: MIN_DEC },
    challengerDelta: DELTA,
    itfExcluded: true,
    players: rows,
  };
  fs.writeFileSync(path.join(__dirname, 'clutch-supplement.json'), JSON.stringify(supp, null, 2));
  console.log(`\nWrote clutch-supplement.json (${rows.length} provisional players; ${rows.filter(r => r.clutchIndex != null).length} rated).`);
})();
