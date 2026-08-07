// =================================================================
// SURFACE RATINGS (self-derived) — serve, return & under-pressure
// -----------------------------------------------------------------
// Produces three ratings PER SURFACE (Hard / Clay / Grass + All) in two
// DISTINCT scopes that are kept separate (never blended):
//    • career     — every qualifying match 2010→now
//    • last52      — matches within 364 days of the player's most recent match
//
// Source: the SAME Jeff-Sackmann-schema match data we already cache
// (Tennismylife/TML-Database mirror). Every number is our own derivation
// from public match results — NO ATP/Infosys scraping, no new licence.
//
//   SERVE RATING   = 1stIn% + 1stWon% + 2ndWon% + hold% + ace%
//   RETURN RATING  = 1stReturnWon% + 2ndReturnWon% + BPconverted% + returnGamesWon%
//                    (the four ATP/Infosys "Return" board components)
//   UNDER-PRESSURE = BPsaved% + BPconverted% + tiebreak% + decidingSet%
//                    (the four ATP "Under Pressure" board components)
//
// Components below a reliability floor are flagged (confidence + reliable),
// never invented. Career and last52 pools are ranked independently so each
// rating also carries a 0-100 pool-percentile index within its own bucket.
//
// Output: surface-ratings.json { generatedAt, source, method, floors, players:[...] }
// =================================================================
const fs = require('fs');
const path = require('path');

const TML_BASE = 'https://raw.githubusercontent.com/Tennismylife/TML-Database/master/';
const CACHE = path.join(__dirname, 'tml-cache');
const FROM_YEAR = 2010;
const TO_YEAR = 2026;
const SURFACES = ['Hard', 'Clay', 'Grass'];      // Carpet dropped (too few matches)
const LAST52_DAYS = 364;

// ---- Challenger fallback source (LIVE api-tennis event_type_key=281) ----------
// TML-Database is ATP main-tour only, so players who are thin at tour level (young
// or lower-ranked) never accumulate enough tiebreaks / deciding sets / break points
// to earn an Under-Pressure rating — and their serve/return sample is likewise thin.
// We fold in a Challenger sample ONLY for players thin at tour level, flagging those
// rows so provenance is always visible. Source is now LIVE api-tennis event 281
// (Challenger Men Singles), which carries the SAME full per-match serve/return/BP
// catalog and — unlike the retired static Milos191405/Tennis-ATP mirror (2018-2024) —
// includes 2025/26 and refreshes weekly via CI. The per-player fetch + contribution
// build lives in surface-ratings-chall-apitennis.js, which emits contribs in the exact
// addContribution shape, so the api sample flows through the identical discount + blend.
const { fetchChallengerContribs } = require('./surface-ratings-chall-apitennis.js');
const CHALL_FROM_YEAR = 2022;   // request window start (event 281 stats are dense 2024+)
// Resolve the api-tennis key the SAME way clutch-apitennis-supplement.js does: prefer
// process.env.API_TENNIS_KEY, else the first apitennis line in the project .env.
function loadApiKey() {
  if (process.env.API_TENNIS_KEY) return process.env.API_TENNIS_KEY.trim();
  for (const p of [path.join(process.env.HOME || '', 'bsp-consult-project', '.env'), path.join(__dirname, '.env')]) {
    if (!fs.existsSync(p)) continue;
    const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).find(l => /apitennis|api_tennis/i.test(l) && l.includes('='));
    if (line) return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('api-tennis key not found (set API_TENNIS_KEY or add an apitennis line to bsp-consult-project/.env)');
}
// Challenger-derived numbers are systematically inflated vs tour level (breaks come
// easier, holds come easier, pressure points convert more often against weaker fields),
// so every Challenger-sourced SUCCESS numerator we fold in — for serve, return AND
// under-pressure — is discounted by this factor before blending. Denominators (points,
// games, chances) are NOT discounted, only the success side, so a pure-Challenger rate
// lands at 0.9x its raw value. Founder ruling on TEN-8 (2026-08-07): 0.9. Env-overridable.
const CHALL_DISCOUNT = (() => { const v = parseFloat(process.env.CHALL_DISCOUNT); return Number.isFinite(v) ? v : 0.9; })();

// inclusion gate: any player with MORE THAN 10 ATP-level (surface) matches is rated
const INCLUDE_MIN_MATCHES = 11;
// career reliability floors — used only to flag confidence, NOT to include/exclude
const CAREER_MIN_MATCHES = 20;
const CAREER_MIN_SVPT = 400;
// last-52 floors (a single season per surface is inherently thinner)
const L52_MIN_MATCHES = 8;
const L52_MIN_SVPT = 150;
// per-component under-pressure floors (career scope; last52 uses half, floored at a small min)
const MIN_BP_FACED = 50;
const MIN_BP_CHANCE = 50;
const MIN_TB = 6;
const MIN_DEC = 5;

function deaccent(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// Normalise a name to lowercase alphanumeric tokens (apostrophes stripped, hyphens/dots → space).
function normTokens(name) {
  return deaccent(name).toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
// From a profile name ("R. Bautista-Agut", "T. M. Etcheverry") drop leading single-letter
// initials and return the surname tokens (["bautista","agut"], ["etcheverry"]).
function profileSurname(tokens) {
  let i = 0;
  while (i < tokens.length - 1 && tokens[i].length === 1) i++;
  return tokens.slice(i);
}
// True if `full` token array ends with the `suffix` token array (token-aligned).
function endsWithTokens(full, suffix) {
  if (suffix.length > full.length) return false;
  for (let i = 0; i < suffix.length; i++) {
    if (full[full.length - suffix.length + i] !== suffix[i]) return false;
  }
  return true;
}
function n(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }
function ymdToMs(ymd) {
  const s = String(ymd || '');
  if (!/^\d{8}$/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
  const t = Date.UTC(y, m, d);
  return Number.isFinite(t) ? t : null;
}

async function getCsv(year) {
  const file = path.join(CACHE, `${year}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, 'utf8');
  const res = await fetch(`${TML_BASE}${year}.csv`, { headers: { 'User-Agent': 'bsp-consult' } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.length < 50) return null;
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

const RETIRED = /\b(RET|W\/O|DEF|ABD|WALK|Walkover|Def)\b/i;
// Parse a winner-first score string into tiebreak + deciding-set outcomes.
function parseScore(score, bestOf) {
  const out = { tbPlayed: 0, tbWonByWinner: 0, decPlayed: 0, decWonByWinner: 0 };
  if (!score) return out;
  const retired = RETIRED.test(score);
  const tokens = score.trim().split(/\s+/);
  const sets = [];
  for (const tok of tokens) {
    const hasParen = tok.includes('(');
    const m = tok.replace(/\(.*?\)/g, '').match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const w = +m[1], l = +m[2];
    const isTb = hasParen || (Math.max(w, l) === 7 && Math.min(w, l) === 6);
    sets.push({ w, l, tb: isTb });
  }
  for (const s of sets) { if (s.tb) { out.tbPlayed++; if (s.w > s.l) out.tbWonByWinner++; } }
  if (!retired && bestOf) {
    if ((bestOf === 3 && sets.length === 3) || (bestOf === 5 && sets.length === 5)) {
      out.decPlayed = 1; out.decWonByWinner = 1;
    }
  }
  return out;
}

// one flat contribution per (player, match) — kept in memory for the two-scope pass
function newBucket() {
  return {
    matches: 0, svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, ace: 0, df: 0,
    bpFaced: 0, bpSaved: 0,
    oSvpt: 0, oFirstIn: 0, oFirstWon: 0, oSecondWon: 0, oSvGms: 0, oBpFaced: 0, oBpSaved: 0,
    tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0,
  };
}
function addContribution(b, c) {
  b.matches++;
  if (c.svpt) { b.svpt += c.svpt; b.firstIn += c.firstIn; b.firstWon += c.firstWon; b.secondWon += c.secondWon; b.ace += c.ace; b.df += c.df; }
  if (c.svGms) b.svGms += c.svGms;
  if (c.bpFaced != null) { b.bpFaced += c.bpFaced; b.bpSaved += c.bpSaved; }
  if (c.oSvpt) { b.oSvpt += c.oSvpt; b.oFirstIn += c.oFirstIn; b.oFirstWon += c.oFirstWon; b.oSecondWon += c.oSecondWon; }
  if (c.oSvGms) b.oSvGms += c.oSvGms;
  if (c.oBpFaced != null) { b.oBpFaced += c.oBpFaced; b.oBpSaved += c.oBpSaved; }
  b.tbPlayed += c.tbPlayed; b.tbWon += c.tbWon;
  b.decPlayed += c.decPlayed; b.decWon += c.decWon;
}

function round1(v) { return v == null ? null : +v.toFixed(1); }

// compute the three ratings from an aggregated bucket, honoring floors.
// `cb` (optional) is the SAME surface+scope Challenger/qualifying bucket — used only
// to top up Under-Pressure components the player is thin on at tour level.
function computeRatings(b, floors, cb) {
  const okSample = b.matches >= floors.minMatches && b.svpt >= floors.minSvpt;
  // Challenger fold-in for serve/return mirrors the under-pressure blend: a player whose
  // TOUR sample is unreliable (thin / lower-ranked — exactly those a single-tier tour
  // sample rates on too little data) has their Challenger serve/return sample folded in,
  // per component, with the success numerator discounted by CHALL_DISCOUNT. Reliable tour
  // players are left tour-only, so their existing ratings + pool percentiles are unchanged.
  const c = cb || newBucket();
  const srBlend = !!cb && !okSample;
  // Blend one rate component: (tourNum + discount*challNum) / (tourDen + challDen). Folds
  // Challenger only when srBlend is on and there is Challenger denominator to add; otherwise
  // returns the tour-only rate. `den` is the (blended) denominator, used for coverage guards.
  function rate(tNum, tDen, cNum, cDen) {
    if (srBlend && (cDen || 0) > 0) {
      const den = tDen + cDen;
      if (den > 0) return { pct: (tNum + CHALL_DISCOUNT * (cNum || 0)) / den * 100, chall: true, den };
    }
    return { pct: tDen > 0 ? tNum / tDen * 100 : null, chall: false, den: tDen };
  }
  // serve
  let serve = null;
  {
    const svptDen = b.svpt + (srBlend ? c.svpt : 0);
    const firstInDen = b.firstIn + (srBlend ? c.firstIn : 0);
    const svGmsDen = b.svGms + (srBlend ? c.svGms : 0);
    if (svptDen > 0 && firstInDen > 0 && svGmsDen > 0) {
      const fi = rate(b.firstIn, b.svpt, c.firstIn, c.svpt);
      const fw = rate(b.firstWon, b.firstIn, c.firstWon, c.firstIn);
      const sw = rate(b.secondWon, b.svpt - b.firstIn, c.secondWon, c.svpt - c.firstIn);
      const hd = rate(b.svGms - (b.bpFaced - b.bpSaved), b.svGms, c.svGms - (c.bpFaced - c.bpSaved), c.svGms);
      const ac = rate(b.ace, b.svpt, c.ace, c.svpt);
      const dfc = rate(b.df, b.svpt, c.df, c.svpt);
      const firstInPct = fi.pct, firstWonPct = fw.pct, secondWonPct = sw.pct != null ? sw.pct : 0;
      const holdPct = hd.pct, acePct = ac.pct != null ? ac.pct : 0, dfPct = dfc.pct != null ? dfc.pct : 0;
      serve = {
        firstInPct: round1(firstInPct), firstWonPct: round1(firstWonPct), secondWonPct: round1(secondWonPct),
        holdPct: round1(holdPct), acePct: round1(acePct), dfPct: round1(dfPct),
        // ATP-style Serve Rating: sum of the serve component percentages (no df penalty,
        // matching the official ATP/Infosys serve leaderboard build). df is still tracked.
        rating: round1(firstInPct + firstWonPct + secondWonPct + holdPct + acePct),
        inclChallenger: fi.chall || fw.chall || sw.chall || hd.chall || ac.chall,
      };
    }
  }
  // return
  let ret = null;
  {
    // ATP-style Return Rating = %1st-serve return points won + %2nd-serve return points won
    // + %break points converted + %return games won — the four Infosys ATP terms. Splitting
    // return points by serve type (instead of one blended figure) is what puts the rating on
    // the true ~140-160 ATP scale. Opponent 1st serves in (oFirstIn) is the denominator that
    // separates the two; every serve point that is not a 1st-serve-in is a 2nd-serve point.
    const oSvptDen = b.oSvpt + (srBlend ? c.oSvpt : 0);
    const oSvGmsDen = b.oSvGms + (srBlend ? c.oSvGms : 0);
    if (oSvptDen > 0 && oSvGmsDen > 0) {
      const oSecondPts = b.oSvpt - b.oFirstIn, coSecondPts = c.oSvpt - c.oFirstIn;
      const r1 = rate(b.oFirstIn - b.oFirstWon, b.oFirstIn, c.oFirstIn - c.oFirstWon, c.oFirstIn);
      const r2 = rate(oSecondPts - b.oSecondWon, oSecondPts, coSecondPts - c.oSecondWon, coSecondPts);
      const br = rate(b.oBpFaced - b.oBpSaved, b.oSvGms, c.oBpFaced - c.oBpSaved, c.oSvGms);
      const bc = rate(b.oBpFaced - b.oBpSaved, b.oBpFaced, c.oBpFaced - c.oBpSaved, c.oBpFaced);
      // overall return-points-won% retained for reference (not part of the ATP rating sum).
      const rp = rate(b.oSvpt - b.oFirstWon - b.oSecondWon, b.oSvpt, c.oSvpt - c.oFirstWon - c.oSecondWon, c.oSvpt);
      const ret1stWonPct = r1.pct != null ? r1.pct : 0, ret2ndWonPct = r2.pct != null ? r2.pct : 0;
      const breakPct = br.pct != null ? br.pct : 0, bpConvPct = bc.pct != null ? bc.pct : 0;
      const rptWonPct = rp.pct != null ? rp.pct : 0;
      ret = {
        ret1stWonPct: round1(ret1stWonPct), ret2ndWonPct: round1(ret2ndWonPct),
        rptWonPct: round1(rptWonPct), breakPct: round1(breakPct), bpConvPct: round1(bpConvPct),
        rating: round1(ret1stWonPct + ret2ndWonPct + breakPct + bpConvPct),
        inclChallenger: r1.chall || r2.chall || br.chall || bc.chall,
      };
    }
  }
  // under-pressure (each component floored independently). If a component is below its
  // tour-level floor, top it up with the player's Challenger/qualifying sample so thin
  // tour players still earn a reliable number — never inventing data, just widening the
  // coverage. Tour-only samples that already clear the floor are left untouched.
  // Blend Challenger data when the tour component is below its floor, OR when the
  // player's overall tour sample is unreliable (thin / lower-ranked) — those players
  // are exactly the ones a single-tier tour sample rates on too little data.
  function upComp(tourNum, tourDen, chNum, chDen, floor) {
    const blend = cb && (chDen || 0) > 0 && (tourDen < floor || !okSample);
    if (blend) {
      const den = tourDen + chDen;
      // discount the Challenger success side (same factor as serve/return) — breaks/holds/
      // clutch conversions come easier at Challenger level, so fold them in deflated.
      if (den >= floor && den > 0) return { pct: (tourNum + CHALL_DISCOUNT * (chNum || 0)) / den * 100, chall: true };
    }
    if (tourDen >= floor && tourDen > 0) return { pct: tourNum / tourDen * 100, chall: false };
    return { pct: null, chall: false };
  }
  const rBpSaved = upComp(b.bpSaved, b.bpFaced, cb ? cb.bpSaved : 0, cb ? cb.bpFaced : 0, floors.minBpFaced);
  const rBpConv  = upComp(b.oBpFaced - b.oBpSaved, b.oBpFaced, cb ? cb.oBpFaced - cb.oBpSaved : 0, cb ? cb.oBpFaced : 0, floors.minBpChance);
  const rTb      = upComp(b.tbWon, b.tbPlayed, cb ? cb.tbWon : 0, cb ? cb.tbPlayed : 0, floors.minTb);
  const rDec     = upComp(b.decWon, b.decPlayed, cb ? cb.decWon : 0, cb ? cb.decPlayed : 0, floors.minDec);
  const bpSavedPct = rBpSaved.pct, bpConvPct = rBpConv.pct, tbWinPct = rTb.pct, decWinPct = rDec.pct;
  const usedChall = rBpSaved.chall || rBpConv.chall || rTb.chall || rDec.chall;
  const upParts = [bpSavedPct, bpConvPct, tbWinPct, decWinPct];
  const present = upParts.filter(v => v != null);
  const haveUp = present.length;
  // ATP-style Under-Pressure Rating: the SUM of BP-saved% + BP-converted% + tiebreak% +
  // deciding-set% (~200-240), matching the ATP/Infosys Under Pressure leaderboard. Rated
  // when >= 3 of 4 components clear their floors; a player on 3 is scaled to the full
  // 4-component equivalent (mean of present * 4) so 3- and 4-component players stay on the
  // same ATP scale — the missing component is estimated from the present ones, never
  // fabricated from thin air. Deciding sets are the rarest event, so newer players
  // commonly land on 3 (BP saved / BP converted / tiebreak) and would otherwise be blank.
  const up = {
    bpSavedPct: round1(bpSavedPct), bpConvPct: round1(bpConvPct),
    tbWinPct: round1(tbWinPct), decWinPct: round1(decWinPct),
    rating: haveUp >= 3 ? round1(present.reduce((a, c) => a + c, 0) / haveUp * 4) : null,
    components: haveUp,
    inclChallenger: usedChall,
  };
  return {
    serve, return: ret, underPressure: up,
    reliable: okSample,
    confidence: okSample ? (usedChall ? 'med' : (haveUp >= 4 ? 'high' : haveUp >= 3 ? 'med' : 'low')) : 'low',
    sample: {
      matches: b.matches, svpt: b.svpt, bpFaced: b.bpFaced, bpChances: b.oBpFaced, tbPlayed: b.tbPlayed, decPlayed: b.decPlayed,
      // Challenger backing sample folded in for thin players (0 when tour sample is reliable / no Challenger match)
      challMatches: c.matches, challSvpt: c.svpt, challBpFaced: c.bpFaced, challBpChances: c.oBpFaced,
    },
  };
}

function pctOf(sortedArr, v) {
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedArr[mid] < v) lo = mid + 1; else hi = mid; }
  return sortedArr.length ? +(lo / sortedArr.length * 100).toFixed(1) : null;
}

(async () => {
  // ---- current-ATP pool from player-profiles.json
  // Each entry carries the surname tokens + first-initial for robust reconciliation.
  const prof = require('./player-profiles.json').players;
  const seen = new Set();
  const pool = [];
  for (const k in prof) {
    const nm = prof[k].name; if (!nm || seen.has(nm)) continue; seen.add(nm);
    const t = normTokens(nm); if (!t.length) continue;
    const sur = profileSurname(t);
    pool.push({ name: nm, rank: parseInt(prof[k].rank, 10) || 9999, fi: t[0][0], surname: sur, lastTok: sur[sur.length - 1] });
  }
  console.log(`Pool: ${pool.length} current-ATP players.`);

  // ---- read every CSV once → per-player list of match contributions {date, surface, ...}
  const byId = new Map();          // id -> { name, latest, contribs:[] }
  let scanned = 0;
  for (let y = FROM_YEAR; y <= TO_YEAR; y++) {
    const text = await getCsv(y);
    if (!text) { console.log(`  ${y}: missing`); continue; }
    const lines = text.split(/\r?\n/).filter(l => l.length);
    const H = lines[0].split(','); const ix = {}; H.forEach((h, i) => { ix[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const wId = c[ix.winner_id], lId = c[ix.loser_id];
      if (!wId || !lId) continue;
      const surface = (c[ix.surface] || '').trim();
      if (!SURFACES.includes(surface)) continue;
      const date = ymdToMs(c[ix.tourney_date]);
      const bestOf = parseInt(c[ix.best_of], 10) || null;
      const ps = parseScore(c[ix.score], bestOf);
      scanned++;

      const W = {
        svpt: n(c[ix.w_svpt]), firstIn: n(c[ix.w_1stIn]), firstWon: n(c[ix.w_1stWon]),
        secondWon: n(c[ix.w_2ndWon]), svGms: n(c[ix.w_SvGms]), ace: n(c[ix.w_ace]), df: n(c[ix.w_df]),
        bpFaced: n(c[ix.w_bpFaced]), bpSaved: n(c[ix.w_bpSaved]),
      };
      const L = {
        svpt: n(c[ix.l_svpt]), firstIn: n(c[ix.l_1stIn]), firstWon: n(c[ix.l_1stWon]),
        secondWon: n(c[ix.l_2ndWon]), svGms: n(c[ix.l_SvGms]), ace: n(c[ix.l_ace]), df: n(c[ix.l_df]),
        bpFaced: n(c[ix.l_bpFaced]), bpSaved: n(c[ix.l_bpSaved]),
      };

      // winner contribution (opponent = loser)
      const wc = {
        date, surface,
        svpt: W.svpt || 0, firstIn: W.firstIn || 0, firstWon: W.firstWon || 0, secondWon: W.secondWon || 0,
        svGms: W.svGms || 0, ace: W.ace || 0, df: W.df || 0,
        bpFaced: W.bpFaced, bpSaved: W.bpFaced != null ? (W.bpSaved || 0) : null,
        oSvpt: L.svpt || 0, oFirstIn: L.firstIn || 0, oFirstWon: L.firstWon || 0, oSecondWon: L.secondWon || 0, oSvGms: L.svGms || 0,
        oBpFaced: L.bpFaced, oBpSaved: L.bpFaced != null ? (L.bpSaved || 0) : null,
        tbPlayed: ps.tbPlayed, tbWon: ps.tbWonByWinner,
        decPlayed: ps.decPlayed, decWon: ps.decWonByWinner,
      };
      // loser contribution (opponent = winner)
      const lc = {
        date, surface,
        svpt: L.svpt || 0, firstIn: L.firstIn || 0, firstWon: L.firstWon || 0, secondWon: L.secondWon || 0,
        svGms: L.svGms || 0, ace: L.ace || 0, df: L.df || 0,
        bpFaced: L.bpFaced, bpSaved: L.bpFaced != null ? (L.bpSaved || 0) : null,
        oSvpt: W.svpt || 0, oFirstIn: W.firstIn || 0, oFirstWon: W.firstWon || 0, oSecondWon: W.secondWon || 0, oSvGms: W.svGms || 0,
        oBpFaced: W.bpFaced, oBpSaved: W.bpFaced != null ? (W.bpSaved || 0) : null,
        tbPlayed: ps.tbPlayed, tbWon: ps.tbPlayed - ps.tbWonByWinner,
        decPlayed: ps.decPlayed, decWon: ps.decPlayed - ps.decWonByWinner,
      };

      let aw = byId.get(wId); if (!aw) { aw = { name: c[ix.winner_name], latest: 0, contribs: [] }; byId.set(wId, aw); }
      let al = byId.get(lId); if (!al) { al = { name: c[ix.loser_name], latest: 0, contribs: [] }; byId.set(lId, al); }
      aw.contribs.push(wc); if (date && date > aw.latest) aw.latest = date;
      al.contribs.push(lc); if (date && date > al.latest) al.latest = date;
    }
  }
  console.log(`Scanned ${scanned} surface matches → ${byId.size} distinct players.`);

  // ---- Challenger fold-in → parallel challById store, LIVE from api-tennis event 281.
  // Source replaces the retired static Sackmann mirror. We resolve each pool player's
  // api-tennis player_key from the ATP get_standings list (same token normalisation used
  // to match TML ids), fetch that player's Challenger fixtures (event 281), and build
  // contributions in the identical addContribution shape. They are folded in ONLY for
  // players thin at tour level, and every success numerator is discounted by
  // CHALL_DISCOUNT at rating time (see computeRatings). Players outside the ATP ranking
  // list simply get no fold-in — same as a tour player with no Challenger match.
  const challById = new Map();     // id -> { name, latest, contribs:[] }
  const apiKey = loadApiKey();

  // 1) ATP standings → name→player_key index, keyed the SAME way as the TML/Sackmann join.
  let standings = [];
  {
    const url = `https://api.api-tennis.com/tennis/?method=get_standings&APIkey=${apiKey}&event_type=ATP`;
    const sres = await fetch(url);
    const sjson = sres.ok ? await sres.json() : null;
    standings = sjson && sjson.success && Array.isArray(sjson.result) ? sjson.result : [];
  }
  console.log(`Standings: ${standings.length} ATP ranking entries.`);
  const standIndex = new Map();   // `fi|lastToken` -> [{ playerKey, tokens, surname }]
  for (const s of standings) {
    if (!s || s.player_key == null) continue;
    const t = normTokens(s.player); if (!t.length) continue;
    const sur = profileSurname(t);
    const key = t[0][0] + '|' + sur[sur.length - 1];
    if (!standIndex.has(key)) standIndex.set(key, []);
    standIndex.get(key).push({ playerKey: s.player_key, tokens: t, surname: sur });
  }

  // 2) Resolve each pool player → api-tennis player_key (surname-suffix aligned).
  const candidates = [];
  const candSeen = new Set();
  let resolved = 0, unresolved = 0;
  for (const meta of pool) {
    const bucket = standIndex.get(meta.fi + '|' + meta.lastTok);
    const hits = bucket ? bucket.filter(e => endsWithTokens(e.tokens, meta.surname)) : [];
    if (!hits.length) { unresolved++; continue; }
    // prefer an exact full-token match, else the first surname-suffix match
    const exact = hits.find(e => e.tokens.length === (meta.surname.length + 1) &&
      endsWithTokens(e.tokens, meta.surname) && e.tokens[0][0] === meta.fi);
    const pick = exact || hits[0];
    resolved++;
    if (candSeen.has(pick.playerKey)) continue;   // another pool player already claimed this key
    candSeen.add(pick.playerKey);
    candidates.push({ playerKey: pick.playerKey, name: meta.name });
  }
  console.log(`Key resolution: ${resolved}/${pool.length} pool players resolved to an ATP player_key (${unresolved} unresolved), ${candidates.length} unique keys to fetch.`);

  // 3) surfaceMap: api-tennis tournament_key (numeric string) -> 'clay'|'hard'|'grass'.
  const surfaceMap = new Map();
  try {
    const tsurf = require('./tournament-surfaces.json').surfaces || {};
    for (const k in tsurf) { const v = tsurf[k]; if (v === 'clay' || v === 'hard' || v === 'grass') surfaceMap.set(String(k), v); }
  } catch (e) { console.log('  tournament-surfaces.json missing — Challenger fixtures fold into All-scope only.'); }
  console.log(`Surface map: ${surfaceMap.size} tournament_key→surface entries.`);

  // 4) Fetch Challenger contributions and populate challById (keyed by api:<player_key>).
  const dateStop = new Date().toISOString().slice(0, 10);
  const challContribs = await fetchChallengerContribs(candidates, {
    apiKey, fromYear: CHALL_FROM_YEAR, dateStop, surfaceMap, concurrency: 8, log: console.log,
  });
  let challScanned = 0, surfResolvedC = 0;
  for (const { playerKey, name, contribs } of challContribs) {
    if (!contribs || !contribs.length) continue;
    let latest = 0;
    for (const c of contribs) { if (c.date && c.date > latest) latest = c.date; if (c.surface) surfResolvedC++; }
    challScanned += contribs.length;
    challById.set('api:' + playerKey, { name, latest, contribs });
  }
  const surfPct = challScanned ? (surfResolvedC / challScanned * 100).toFixed(1) : '0.0';
  console.log(`Scanned ${challScanned} Challenger (event 281) surface matches → ${challById.size} distinct players (${surfResolvedC}/${challScanned} = ${surfPct}% surface-resolved).`);

  // ---- index TML ids by (first-initial | last-surname-token) for candidate pruning
  const tmlIndex = new Map();   // `fi|lastToken` -> [ids]
  const tmlTok = new Map();     // id -> { tokens, fi }
  for (const [id, a] of byId) {
    const t = normTokens(a.name); if (!t.length) continue;
    const fi = t[0][0];
    tmlTok.set(id, { tokens: t, fi });
    const key = fi + '|' + t[t.length - 1];
    if (!tmlIndex.has(key)) tmlIndex.set(key, []);
    tmlIndex.get(key).push(id);
  }
  // parallel index for the Challenger store (same token scheme)
  const challIndex = new Map();
  const challTok = new Map();
  for (const [id, a] of challById) {
    const t = normTokens(a.name); if (!t.length) continue;
    const fi = t[0][0];
    challTok.set(id, { tokens: t, fi });
    const key = fi + '|' + t[t.length - 1];
    if (!challIndex.has(key)) challIndex.set(key, []);
    challIndex.get(key).push(id);
  }

  const careerFloors = { minMatches: CAREER_MIN_MATCHES, minSvpt: CAREER_MIN_SVPT, minBpFaced: MIN_BP_FACED, minBpChance: MIN_BP_CHANCE, minTb: MIN_TB, minDec: MIN_DEC };
  const l52Floors = { minMatches: L52_MIN_MATCHES, minSvpt: L52_MIN_SVPT, minBpFaced: 20, minBpChance: 20, minTb: 4, minDec: 3 };

  const rows = [];
  for (const meta of pool) {
    // candidates share the first-initial + last surname token; then verify the
    // full surname suffix aligns (handles hyphens, middle initials, multi-word surnames).
    const cands = tmlIndex.get(meta.fi + '|' + meta.lastTok); if (!cands || !cands.length) continue;
    const matched = cands.filter(id => endsWithTokens(tmlTok.get(id).tokens, meta.surname));
    if (!matched.length) continue;
    matched.sort((x, y) => byId.get(y).contribs.length - byId.get(x).contribs.length);
    const a = byId.get(matched[0]);

    // match the SAME player in the Challenger store (token-aligned, best coverage)
    let ac = null;
    const cCands = challIndex.get(meta.fi + '|' + meta.lastTok);
    if (cCands && cCands.length) {
      const cMatched = cCands.filter(id => endsWithTokens(challTok.get(id).tokens, meta.surname));
      if (cMatched.length) {
        cMatched.sort((x, y) => challById.get(y).contribs.length - challById.get(x).contribs.length);
        ac = challById.get(cMatched[0]);
      }
    }
    // last-52 window is anchored to the player's most recent match across BOTH sources
    const latestAll = Math.max(a.latest || 0, ac ? ac.latest : 0);
    const cutoff = a.latest ? a.latest - LAST52_DAYS * 86400000 : null;
    const cutoffAll = latestAll ? latestAll - LAST52_DAYS * 86400000 : null;

    // aggregate career + last52, per surface + 'All' (tour level — primary)
    const scopes = { career: {}, last52: {} };
    const chall = { career: {}, last52: {} };
    for (const surf of [...SURFACES, 'All']) {
      scopes.career[surf] = newBucket(); scopes.last52[surf] = newBucket();
      chall.career[surf] = newBucket(); chall.last52[surf] = newBucket();
    }
    for (const c of a.contribs) {
      addContribution(scopes.career[c.surface], c);
      addContribution(scopes.career.All, c);
      if (cutoff != null && c.date != null && c.date >= cutoff) {
        addContribution(scopes.last52[c.surface], c);
        addContribution(scopes.last52.All, c);
      }
    }
    // Challenger contributions in a parallel, non-blended store (used only to top up
    // thin Under-Pressure components inside computeRatings).
    if (ac) {
      for (const c of ac.contribs) {
        // api-tennis contribs may carry surface:null (tournament_key not in the surface
        // map) — those fold into the All scope only, exactly like a surfaceless match.
        const hasSurf = SURFACES.includes(c.surface);
        if (hasSurf) addContribution(chall.career[c.surface], c);
        addContribution(chall.career.All, c);
        if (cutoffAll != null && c.date != null && c.date >= cutoffAll) {
          if (hasSurf) addContribution(chall.last52[c.surface], c);
          addContribution(chall.last52.All, c);
        }
      }
    }
    // inclusion gate: rate anyone with MORE THAN 10 career ATP-level matches.
    // (career-All reliability is still computed below, only as a confidence flag.)
    if (scopes.career.All.matches < INCLUDE_MIN_MATCHES) continue;

    const surfaces = {};
    for (const surf of [...SURFACES, 'All']) {
      surfaces[surf] = {
        career: computeRatings(scopes.career[surf], careerFloors, chall.career[surf]),
        last52: computeRatings(scopes.last52[surf], l52Floors, chall.last52[surf]),
      };
    }
    rows.push({ name: meta.name, rank: meta.rank, surfaces });
  }
  console.log(`Reconciled + qualified: ${rows.length} players.`);

  // ---- pool-percentile index per rating, within each surface+scope bucket
  const UP_COMPONENTS = ['bpSavedPct', 'bpConvPct', 'tbWinPct', 'decWinPct'];
  for (const surf of [...SURFACES, 'All']) {
    for (const scope of ['career', 'last52']) {
      // Serve & return are single composite ratings → percentile of the composite.
      for (const fam of ['serve', 'return']) {
        const vals = rows.map(r => { const b = r.surfaces[surf][scope][fam]; return b && b.rating != null ? b.rating : null; })
          .filter(v => v != null).sort((x, y) => x - y);
        for (const r of rows) {
          const b = r.surfaces[surf][scope][fam];
          if (b && b.rating != null) b.index = pctOf(vals, b.rating);
        }
      }
      // Under-pressure: the four components have very different baselines (BP-saved
      // ~60% vs BP-converted ~40%) and some players are missing one. Percentiling the
      // raw mean therefore distorts (strong-component players get flattered, weak-
      // component players get buried). Instead, rank EACH component within the pool,
      // then average the available component percentiles → apples-to-apples 0-100.
      const compSorted = {};
      for (const comp of UP_COMPONENTS) {
        compSorted[comp] = rows.map(r => r.surfaces[surf][scope].underPressure[comp])
          .filter(v => v != null).sort((x, y) => x - y);
      }
      for (const r of rows) {
        const u = r.surfaces[surf][scope].underPressure;
        if (!u || u.rating == null) continue;                 // gated at >= 3 components upstream
        const pcts = UP_COMPONENTS.map(comp => u[comp] != null ? pctOf(compSorted[comp], u[comp]) : null).filter(v => v != null);
        u.index = pcts.length ? +(pcts.reduce((a, c) => a + c, 0) / pcts.length).toFixed(1) : null;
      }
    }
  }

  // ---- sanity print: clay under-pressure top 10 (career)
  const clayUp = rows.filter(r => r.surfaces.Clay.career.underPressure.rating != null)
    .sort((a, b) => b.surfaces.Clay.career.underPressure.rating - a.surfaces.Clay.career.underPressure.rating);
  console.log('\n=== TOP 10 clay under-pressure (career) ===');
  clayUp.slice(0, 10).forEach((r, i) => {
    const u = r.surfaces.Clay.career.underPressure;
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(22)} up=${u.rating}  BPsv=${u.bpSavedPct} BPcv=${u.bpConvPct} TB=${u.tbWinPct} DEC=${u.decWinPct} [${r.surfaces.Clay.career.confidence}]`);
  });

  // ---- write output (atomic: temp + rename)
  rows.sort((a, b) => a.rank - b.rank);
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Self-derived — tour-level from Jeff Sackmann tennis_atp schema (Tennismylife/TML-Database), with a Challenger fallback sourced LIVE from api-tennis event_type_key=281 (Challenger Men Singles, dense 2024+, refreshed weekly) folded into serve, return AND under-pressure for players thin at tour level, Challenger success discounted x' + CHALL_DISCOUNT + ' — no ATP/Infosys data',
    scopes: { career: `${FROM_YEAR}-${TO_YEAR} all qualifying matches`, last52: `matches within ${LAST52_DAYS} days of each player's most recent match` },
    surfaces: [...SURFACES, 'All'],
    method: {
      serve: 'ATP-style Serve Rating = 1stIn% + 1stWon% + 2ndWon% + serviceGamesWon% + ace% (no df penalty, matching the ATP serve leaderboard build). Tour level is primary; players thin at tour level (unreliable tour sample) have their Challenger/qualifying serve sample folded in per component with the success side discounted x' + CHALL_DISCOUNT + ' (serve.inclChallenger flags those).',
      return: 'ATP-style Return Rating = 1stServeReturnWon% + 2ndServeReturnWon% + BPconverted% + returnGamesWon% (return points split by serve type to match the Infosys ATP Return leaderboard scale). Tour level is primary; players thin at tour level have their Challenger/qualifying return sample folded in per component with the success side discounted x' + CHALL_DISCOUNT + ' (return.inclChallenger flags those).',
      underPressure: 'ATP-style Under-Pressure Rating = sum of the components present scaled to the full 4-component equivalent (mean of BPsaved% / BPconverted% / tiebreak% / decidingSet% * 4, ~200-240); rated when >= 3 of 4 clear their floors so 3- and 4-component players share the ATP scale. Tour level is primary; any single component below its tour-level floor is topped up with the player\u2019s Challenger/qualifying sample (inclChallenger:true flags those buckets).',
      index: 'retained internally: 0-100 pool percentile within the same surface+scope bucket (serve/return rank the composite rating, under-pressure averages each component\u2019s own pool percentile). The board now displays the ATP-style ratings above, not this index.',
    },
    inclusion: `rated if career-All matches >= ${INCLUDE_MIN_MATCHES} (i.e. more than 10 ATP-level matches)`,
    floors: { career: careerFloors, last52: l52Floors },
    players: rows.map(r => ({ name: r.name, rank: r.rank, surfaces: r.surfaces })),
  };
  const dest = path.join(__dirname, 'surface-ratings.json');
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, dest);
  console.log(`\nWrote surface-ratings.json (${rows.length} players).`);
})();
