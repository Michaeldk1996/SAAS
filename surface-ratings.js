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
//   SERVE RATING   = 1stIn% + 1stWon% + 2ndWon% + hold% + ace% − df%
//   RETURN RATING  = returnPtsWon% + break%
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

// ---- Challenger / qualifying fallback source (Jeff-Sackmann schema) ----------
// TML-Database is ATP main-tour only, so players who are thin at tour level (young
// or lower-ranked) never accumulate enough tiebreaks / deciding sets / break points
// to earn an Under-Pressure rating. Sackmann's qual_chall files give the SAME schema
// for Challenger + Grand-Slam/Masters qualifying — a genuinely different, deeper
// coverage. We fold these in ONLY for components a player is thin on at tour level,
// and flag those rows so the provenance is always visible. Same CC BY-NC-SA licence,
// internal-derivation only. Reachable Sackmann fork mirror (JeffSackmann org is not
// fetchable in the build env): Milos191405/Tennis-ATP, years 2018-2024.
const CHALL_BASE = 'https://raw.githubusercontent.com/Milos191405/Tennis-ATP/master/tennis_atp/';
const CHALL_CACHE = path.join(__dirname, 'chall-cache');
const CHALL_FROM_YEAR = 2018;
const CHALL_TO_YEAR = 2024;

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

async function getChallCsv(year) {
  const file = path.join(CHALL_CACHE, `qual_chall_${year}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, 'utf8');
  const res = await fetch(`${CHALL_BASE}atp_matches_qual_chall_${year}.csv`, { headers: { 'User-Agent': 'bsp-consult' } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.length < 50) return null;
  if (!fs.existsSync(CHALL_CACHE)) fs.mkdirSync(CHALL_CACHE, { recursive: true });
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
    oSvpt: 0, oFirstWon: 0, oSecondWon: 0, oSvGms: 0, oBpFaced: 0, oBpSaved: 0,
    tbPlayed: 0, tbWon: 0, decPlayed: 0, decWon: 0,
  };
}
function addContribution(b, c) {
  b.matches++;
  if (c.svpt) { b.svpt += c.svpt; b.firstIn += c.firstIn; b.firstWon += c.firstWon; b.secondWon += c.secondWon; b.ace += c.ace; b.df += c.df; }
  if (c.svGms) b.svGms += c.svGms;
  if (c.bpFaced != null) { b.bpFaced += c.bpFaced; b.bpSaved += c.bpSaved; }
  if (c.oSvpt) { b.oSvpt += c.oSvpt; b.oFirstWon += c.oFirstWon; b.oSecondWon += c.oSecondWon; }
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
  // serve
  let serve = null;
  if (b.svpt > 0 && b.firstIn > 0 && b.svGms > 0) {
    const firstInPct = b.firstIn / b.svpt * 100;
    const firstWonPct = b.firstWon / b.firstIn * 100;
    const secondPts = b.svpt - b.firstIn;
    const secondWonPct = secondPts > 0 ? b.secondWon / secondPts * 100 : 0;
    const holdPct = (b.svGms - (b.bpFaced - b.bpSaved)) / b.svGms * 100;
    const acePct = b.ace / b.svpt * 100;
    const dfPct = b.df / b.svpt * 100;
    serve = {
      firstInPct: round1(firstInPct), firstWonPct: round1(firstWonPct), secondWonPct: round1(secondWonPct),
      holdPct: round1(holdPct), acePct: round1(acePct), dfPct: round1(dfPct),
      rating: round1(firstInPct + firstWonPct + secondWonPct + holdPct + acePct - dfPct),
    };
  }
  // return
  let ret = null;
  if (b.oSvpt > 0 && b.oSvGms > 0) {
    const rptWonPct = (1 - (b.oFirstWon + b.oSecondWon) / b.oSvpt) * 100;
    const breakPct = b.oBpFaced > 0 ? (b.oBpFaced - b.oBpSaved) / b.oSvGms * 100 : 0;
    ret = { rptWonPct: round1(rptWonPct), breakPct: round1(breakPct), rating: round1(rptWonPct + breakPct) };
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
      if (den >= floor && den > 0) return { pct: (tourNum + (chNum || 0)) / den * 100, chall: true };
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
  // Rate on the components that clear their floors (>= 3 of 4), using the MEAN of the
  // present components so 3- and 4-component players share one 0-100 scale — the missing
  // component is never invented. Deciding sets are the rarest event, so newer players
  // commonly land on 3 (BP saved / BP converted / tiebreak) and would otherwise be blank.
  const up = {
    bpSavedPct: round1(bpSavedPct), bpConvPct: round1(bpConvPct),
    tbWinPct: round1(tbWinPct), decWinPct: round1(decWinPct),
    rating: haveUp >= 3 ? round1(present.reduce((a, c) => a + c, 0) / haveUp) : null,
    components: haveUp,
    inclChallenger: usedChall,
  };
  return {
    serve, return: ret, underPressure: up,
    reliable: okSample,
    confidence: okSample ? (usedChall ? 'med' : (haveUp >= 4 ? 'high' : haveUp >= 3 ? 'med' : 'low')) : 'low',
    sample: { matches: b.matches, svpt: b.svpt, bpFaced: b.bpFaced, bpChances: b.oBpFaced, tbPlayed: b.tbPlayed, decPlayed: b.decPlayed },
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
        oSvpt: L.svpt || 0, oFirstWon: L.firstWon || 0, oSecondWon: L.secondWon || 0, oSvGms: L.svGms || 0,
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
        oSvpt: W.svpt || 0, oFirstWon: W.firstWon || 0, oSecondWon: W.secondWon || 0, oSvGms: W.svGms || 0,
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

  // ---- Challenger/qualifying scan (pressure fields only) → parallel challById store.
  // Same schema, so only the Under-Pressure inputs are captured; serve/return are never
  // sourced from Challenger data (kept tour-level to preserve the existing ratings).
  const challById = new Map();     // id -> { name, latest, contribs:[] }
  let challScanned = 0;
  for (let y = CHALL_FROM_YEAR; y <= CHALL_TO_YEAR; y++) {
    const text = await getChallCsv(y);
    if (!text) { console.log(`  chall ${y}: missing`); continue; }
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
      challScanned++;
      const wBpF = n(c[ix.w_bpFaced]), wBpS = n(c[ix.w_bpSaved]);
      const lBpF = n(c[ix.l_bpFaced]), lBpS = n(c[ix.l_bpSaved]);
      // winner contribution (opponent = loser)
      const wc = {
        date, surface, svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, ace: 0, df: 0,
        bpFaced: wBpF, bpSaved: wBpF != null ? (wBpS || 0) : null,
        oSvpt: 0, oFirstWon: 0, oSecondWon: 0, oSvGms: 0,
        oBpFaced: lBpF, oBpSaved: lBpF != null ? (lBpS || 0) : null,
        tbPlayed: ps.tbPlayed, tbWon: ps.tbWonByWinner,
        decPlayed: ps.decPlayed, decWon: ps.decWonByWinner,
      };
      // loser contribution (opponent = winner)
      const lc = {
        date, surface, svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, ace: 0, df: 0,
        bpFaced: lBpF, bpSaved: lBpF != null ? (lBpS || 0) : null,
        oSvpt: 0, oFirstWon: 0, oSecondWon: 0, oSvGms: 0,
        oBpFaced: wBpF, oBpSaved: wBpF != null ? (wBpS || 0) : null,
        tbPlayed: ps.tbPlayed, tbWon: ps.tbPlayed - ps.tbWonByWinner,
        decPlayed: ps.decPlayed, decWon: ps.decPlayed - ps.decWonByWinner,
      };
      let aw = challById.get(wId); if (!aw) { aw = { name: c[ix.winner_name], latest: 0, contribs: [] }; challById.set(wId, aw); }
      let al = challById.get(lId); if (!al) { al = { name: c[ix.loser_name], latest: 0, contribs: [] }; challById.set(lId, al); }
      aw.contribs.push(wc); if (date && date > aw.latest) aw.latest = date;
      al.contribs.push(lc); if (date && date > al.latest) al.latest = date;
    }
  }
  console.log(`Scanned ${challScanned} Challenger/qual surface matches → ${challById.size} distinct players.`);

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
        addContribution(chall.career[c.surface], c);
        addContribution(chall.career.All, c);
        if (cutoffAll != null && c.date != null && c.date >= cutoffAll) {
          addContribution(chall.last52[c.surface], c);
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
    source: 'Self-derived from Jeff Sackmann tennis_atp schema — tour-level (Tennismylife/TML-Database) with Challenger/qualifying fallback (Milos191405/Tennis-ATP, ' + CHALL_FROM_YEAR + '-' + CHALL_TO_YEAR + ') for thin Under-Pressure components — no ATP/Infosys data',
    scopes: { career: `${FROM_YEAR}-${TO_YEAR} all qualifying matches`, last52: `matches within ${LAST52_DAYS} days of each player's most recent match` },
    surfaces: [...SURFACES, 'All'],
    method: {
      serve: 'serveRating = 1stIn% + 1stWon% + 2ndWon% + hold% + ace% − df% (tour level only)',
      return: 'returnRating = returnPtsWon% + break% (tour level only)',
      underPressure: 'upRating = mean of the ATP Under-Pressure components present (BPsaved% / BPconverted% / tiebreak% / decidingSet%); rated when >= 3 of 4 clear their floors. Tour level is primary; any single component below its tour-level floor is topped up with the player\u2019s Challenger/qualifying sample (inclChallenger:true flags those buckets).',
      index: '0-100 pool percentile within the same surface+scope bucket; serve/return rank the composite rating, under-pressure averages each component\u2019s own pool percentile (so different component baselines and missing components do not distort)',
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
