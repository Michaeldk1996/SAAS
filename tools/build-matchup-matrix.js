#!/usr/bin/env node
// =============================================================================
// Build the archetype matchup matrix on the BOARD-FINALIZED v5.1 labels (TEN-12).
//
// WHY THIS EXISTS: classify-styles.js emits matchup-matrix.json keyed on the
// retired machine taxonomy (big_server, attacking_baseliner, ...), then
// tools/apply-board-archetypes.js overwrites playing-styles.json with the board
// labels but does NOT touch the matrix. So the deployed matrix was keyed on a
// taxonomy the site no longer shows. This step REBUILDS matchup-matrix.json on
// the exact `archetype_label` strings a member can see on the site.
//
// WHAT IT DOES (board decision, TEN-12, 2026-08-26 — three locked confirmations):
//   1. PRIMARIES = the 8 distinct `archetype_label` strings, taken from the
//      DEPLOYED playing-styles.json (249 labelled players), NOT the 263-row
//      canonical tools/board-archetypes.json. The 14 held debutants are below the
//      classifier's 20-match / 400-serve-point floor and have no match sample, so
//      the matrix reproduces exactly the counts a member sees on the page.
//   2. FULL 8x8 INCLUDING THE DIAGONAL. Same-archetype cells (e.g. Attacking
//      Baseliner vs Attacking Baseliner — the most-opened matchup on the board)
//      are populated at 50% by construction with the real match count `n`: two
//      players of one archetype is a coin flip on STYLE, which is itself useful
//      information a member wants stated rather than a blank cell.
//   3. VARIETY IS IGNORED. `variety` is a modifier chip, not a 9th category;
//      "Attacking Baseliner + Variety Player" counts as Attacking Baseliner. The
//      matrix keys purely on the base `archetype_label` string.
//
// Per-cell `n` is always surfaced (below-floor cells show n with pct=null).
// Match pool = both endpoints in the 249 labelled set, over the TML window
// 2000-2026. Join is by surname + first-initial (accent-folded), the same match
// rule tools/apply-board-archetypes.js uses.
//
// Idempotent. Meant to run in the daily refresh RIGHT AFTER
// tools/apply-board-archetypes.js. Reads tml-cache/*.csv (already populated by
// classify-styles.js in the same run).
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STYLES = path.join(ROOT, 'playing-styles.json');
const TML_CACHE = path.join(ROOT, 'tml-cache');
const OUT = path.join(ROOT, 'matchup-matrix.json');
// TEN-88 option B: per-player CAREER meeting shards — the detail view under the
// "Personally" career record. One shard per player, lazily fetched, keyed by the
// SAME surname|initial the byPlayer aggregate uses, so the row list reconciles to
// the Personally `n` by construction. matchup-matrix.json stays byte-identical —
// these are separate files (the shards carry the heavy per-meeting rows).
const OUT_MEET_DIR = path.join(ROOT, 'style-meetings');
const OUT_MEET_INDEX = path.join(ROOT, 'style-meetings-index.json');
// TEN-88 option B supplement: the community TML mirror stops publishing the
// current season past mid-January, so the career-meetings pool loses ~99% of the
// live season (the Fery-vs-Cobolli "no meetings" gap). This flat cache of the
// season's finished ATP fixtures (written by tools/fetch-apitennis-fixtures.js)
// is folded into the CAREER split ONLY — the aggregate matrix cells stay
// TML-only and byte-stable. Absent cache => TML-only build (no throw).
const API_SUPP = path.join(TML_CACHE, 'apitennis-2026.json');
// Canonical tournament_key -> surface map (built by bsp-pipeline.js, corrections
// applied). Used to give api-supplement rows the SAME surface tag TML rows carry
// so a member can't tell which source a meeting row came from.
const SURFACE_MAP = path.join(ROOT, 'tournament-surfaces.json');
const SUPP_DEDUP_TOL_DAYS = 1;   // TML tourney_date vs api event_date drift by <=1 day (TZ/attribution)

const FROM_YEAR = 2000, TO_YEAR = 2026;   // must match classify-styles.js window
const MATRIX_MIN_N = 20;                   // off-diagonal cell needs this many real matches

// Stable primary order for the emitted grid (serve family first, then baseline
// families, then the elite/defensive tail). Any label present in the data but
// missing here is appended; any listed-but-absent label is dropped.
const PRIMARY_ORDER = [
  'Big Server',
  'Big Server + First Strike',
  'Big Server + Complete Baseliner',
  'Attacking Baseliner',
  'Solid Baseliner',
  'Counterpuncher',
  'Solid Defender',
  'All Court Elite',
];

// ---- name matching (mirrors tools/apply-board-archetypes.js) ----
function fold(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
function norm(name) { return String(name || '').trim().replace(/\.(?=\S)/g, '. '); }
function parts(name) {
  const toks = norm(name).split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return [null, toks];
  return [toks[0], toks.slice(1)];
}
const initialOf = ft => { const f = fold(ft); return f ? f[0] : null; };
const skey = st => fold(st.join(''));                     // full surname (all tokens after the first)
const lastkey = st => (st.length ? fold(st[st.length - 1]) : '');

// Build a name -> label index from the labelled roster. Primary key is
// surname+initial; a last-token+initial key is a fallback for multi-token
// surnames. Collisions inside the labelled set are marked AMBIGUOUS and never
// resolve (so we never mis-assign a match).
function buildLabelIndex(players) {
  const surnInit = new Map(), lastInit = new Map();
  const AMB = Symbol('ambiguous');
  const put = (m, k, label) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, label);
    else if (m.get(k) !== label) m.set(k, AMB);   // same key, different label -> ambiguous
  };
  for (const p of players) {
    const [ft, st] = parts(p.name);
    const ini = initialOf(ft || (st[0] || ''));
    put(surnInit, skey(st) + '|' + ini, p.archetype_label);
    put(lastInit, lastkey(st) + '|' + ini, p.archetype_label);
  }
  const lookup = name => {
    const [ft, st] = parts(name);
    const ini = initialOf(ft || (st[0] || ''));
    let v = surnInit.get(skey(st) + '|' + ini);
    if (v === undefined) v = lastInit.get(lastkey(st) + '|' + ini);
    return v === undefined || v === AMB ? null : v;
  };
  return { lookup };
}

function surfaceOf(raw) {
  const s = String(raw || '').toLowerCase();
  return s.includes('clay') ? 'clay' : s.includes('grass') ? 'grass' : s.includes('hard') ? 'hard' : 'other';
}

// TML tourney_date is YYYYMMDD; the client's row renderer keys/sorts on an ISO
// date string, so normalise here.
function isoDate(raw) {
  const s = String(raw || '').trim();
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : (s || null);
}
// TML scores are winner-perspective ("6-7(5) 6-2 6-1"). A meeting row is shown
// from the SUBJECT player's side, so a loss must read loser-first. Flip each set
// token's two game counts while preserving the tie-break suffix "(5)" and any
// trailing "RET"/"W/O" marker.
function flipScore(score) {
  const s = String(score || '').trim();
  if (!s) return s;
  return s.split(/\s+/).map(tok => {
    const m = tok.match(/^(\d+)-(\d+)(\(\d+\))?$/);
    return m ? `${m[2]}-${m[1]}${m[3] || ''}` : tok;   // non-set tokens (RET, W/O) pass through
  }).join(' ');
}

// ---- closing-odds join (TEN-88 #2 odds) ----
// Tennis-Data odds-archive/<year>.csv carries a closing price per match. Each
// meeting row is tagged with the closing odds of BOTH players (subject + opponent)
// so the row can show them. Per the founder's ruling the book is NOT labelled on
// the row — it is a closing price for context, not a sharp reference we price
// against. Book policy:
//   2026+  -> Bet365 (b365w/b365l): Pinnacle dropped current-season coverage.
//   <=2025 -> Pinnacle (psw/psl) primary, Bet365 fallback where Pinnacle absent.
// No price on either side (unmatched / team event / spelling residue) => dash.
const ODDS_DIR = path.join(ROOT, 'odds-archive');
// odds-archive names are "Surname(s) I." (surname first); the roster/TML key is
// "Firstname Surname". Reduce both to the SAME surname|initial space so they join.
function oddsKey(name) {
  const t = psEloNorm(name).split(' ').filter(Boolean);
  const i = t.findIndex(x => x.length === 1);          // first single-letter token = first-name initial
  if (i <= 0) return null;                              // no initial, or nothing before it
  return t[i - 1] + '|' + t[i];                         // last surname word + first initial
}
function oddsNum(s) { const v = parseFloat(s); return Number.isFinite(v) && v > 1 ? +v.toFixed(2) : null; }
// pairKey(sorted surname|initial) -> [ {date, wkey, lkey, cols:{psw,psl,b365w,b365l}} ]
function buildOddsIndex() {
  const idx = new Map();
  let files = 0, rows = 0;
  for (const f of (fs.existsSync(ODDS_DIR) ? fs.readdirSync(ODDS_DIR) : [])) {
    if (!/^\d{4}\.csv$/.test(f)) continue;
    files++;
    const lines = fs.readFileSync(path.join(ODDS_DIR, f), 'utf8').split(/\r?\n/).filter(l => l.length);
    if (!lines.length) continue;
    const H = lines[0].split(','); const ix = {}; H.forEach((h, i) => { ix[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const wk = oddsKey(c[ix.winner]), lk = oddsKey(c[ix.loser]);
      if (!wk || !lk || wk === lk) continue;
      const pk = [wk, lk].sort().join('~');
      const rec = { date: c[ix.date] || null, wkey: wk, lkey: lk,
        cols: { psw: c[ix.psw], psl: c[ix.psl], b365w: c[ix.b365w], b365l: c[ix.b365l] } };
      (idx.get(pk) || idx.set(pk, []).get(pk)).push(rec); rows++;
    }
  }
  return { idx, files, rows };
}
// Return the closing odds oriented to the actual match winner/loser, or nulls.
function oddsLookup(oddsIdx, winnerCK, loserCK, isoStr, year) {
  if (!winnerCK || !loserCK) return { w: null, l: null };
  const cands = oddsIdx.get([winnerCK, loserCK].sort().join('~'));
  if (!cands || !cands.length) return { w: null, l: null };
  let rec = cands[0];
  if (cands.length > 1 && isoStr) {                    // same pair met >once -> nearest date
    let best = Infinity;
    for (const r of cands) { const d = daysApart(r.date, isoStr); if (d < best) { best = d; rec = r; } }
  }
  const pick = (winnerCol) => {
    const ps = oddsNum(winnerCol ? rec.cols.psw : rec.cols.psl);
    const b3 = oddsNum(winnerCol ? rec.cols.b365w : rec.cols.b365l);
    return year >= 2026 ? b3 : (ps != null ? ps : b3);
  };
  if (rec.wkey === winnerCK) return { w: pick(true),  l: pick(false) };
  if (rec.wkey === loserCK)  return { w: pick(false), l: pick(true)  };   // sources disagree on winner
  return { w: null, l: null };
}

// ---- api-supplement helpers (TEN-88 option B) ----
// api-tennis encodes a tie-break set as decimals in `scores`: "7.7"/"6.5" means
// 7 games (tb 7) vs 6 games (tb 5), i.e. the tennis score 7-6(5) — the suffix is
// the LOSER's tie-break points, perspective-independent. Rebuild the game-level
// string in FIRST-PLAYER order (the same order TML scores are stored in before
// bump() flips them), so the row renderer shows an identical "6-7(5) 6-2 6-1".
function apiScoreP1(sets) {
  return (sets || []).map(pair => {
    const a = String(pair[0] == null ? '' : pair[0]).split('.');
    const b = String(pair[1] == null ? '' : pair[1]).split('.');
    const tie = a[1] != null || b[1] != null;
    if (tie) return `${a[0]}-${b[0]}(${Math.min(Number(a[1] || 0), Number(b[1] || 0))})`;
    return `${a[0]}-${b[0]}`;
  }).join(' ');
}
// Winner-perspective score (what TML stores): flip to winner-first if p2 won, then
// append the same RET marker TML carries for a retirement so the two are identical.
function apiScoreWinnerPerspective(sets, winner, status) {
  let s = apiScoreP1(sets);
  if (winner === '2') s = flipScore(s);
  if (status === 'Retired') s = (s + ' RET').trim();
  return s;
}
function daysApart(a, b) {
  const t1 = Date.parse(a + 'T00:00:00Z'), t2 = Date.parse(b + 'T00:00:00Z');
  return (!Number.isFinite(t1) || !Number.isFinite(t2)) ? Infinity : Math.abs(t1 - t2) / 86400000;
}
// api round is "Brisbane - 1/16-finals" (tournament-prefixed) or ""; strip the
// prefix. Round is stored but not shown in the row, so this is best-effort.
function apiRound(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const i = s.indexOf(' - ');
  return (i >= 0 ? s.slice(i + 3) : s).trim() || null;
}

// ---- client-parity player key (TEN-88 #2) ----
// The per-player split (`byPlayer`) is looked up on the front end by the SAME
// surname|initial key the dashboard already builds for every player
// (psEloNorm -> styleKey in bsp-consult-dashboard.html). These two helpers are a
// byte-for-byte mirror of that pair — keep them in sync so a career record keys
// to the right player card.
function psEloNorm(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function clientKey(name) {
  const p = psEloNorm(name).split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}

function main() {
  const styles = JSON.parse(fs.readFileSync(STYLES, 'utf8'));
  const labelled = (styles.players || []).filter(p => p.archetype_label);
  if (!labelled.length) throw new Error('no labelled players in playing-styles.json — run apply-board-archetypes.js first');

  // Establish the primary set from the DEPLOYED roster.
  const present = new Set(labelled.map(p => p.archetype_label));
  const PRIMARIES = PRIMARY_ORDER.filter(l => present.has(l));
  for (const l of present) if (!PRIMARIES.includes(l)) PRIMARIES.push(l);   // append any unexpected label

  const playerCount = {};
  for (const l of PRIMARIES) playerCount[l] = 0;
  for (const p of labelled) playerCount[p.archetype_label]++;

  const { lookup } = buildLabelIndex(labelled);

  // ---- per-player career split (TEN-88 #2) ----
  // Keyed by client key (surname|initial). A client key that two DIFFERENT
  // labelled players collapse onto is dropped, so we never merge two players'
  // records under one card. This is the same collision the front-end byKey has,
  // so nothing is lost that the client could have distinguished anyway.
  const CK_AMB = Symbol('ck_amb');
  const byClientKey = new Map();
  for (const p of labelled) {
    const k = clientKey(p.name);
    if (!k) continue;
    if (!byClientKey.has(k)) byClientKey.set(k, { name: p.name, label: p.archetype_label });
    else { const cur = byClientKey.get(k); if (cur !== CK_AMB && cur.name !== p.name) byClientKey.set(k, CK_AMB); }
  }
  const byPlayer = {};                       // clientKey -> { name, vs: { <oppLabel>: {w,l} } }
  const meetings = {};                        // clientKey -> { name, vs: { <oppLabel>: [rows] } }
  let bpCounted = 0;
  // Closing-odds index (built once) + row-level coverage counters for the report.
  const { idx: oddsIdx, files: oddsFiles, rows: oddsSrcRows } = buildOddsIndex();
  const odds = { rows: 0, priced: 0, rows26: 0, priced26: 0 };
  // Canonical display name for an api opponent. api-tennis AND the roster both
  // store abbreviated names ("F. Cobolli"); TML rows carry the FULL name
  // ("Flavio Cobolli"), and the row renderer's psShortName() keeps a full name
  // intact but strips an abbreviated one to a bare surname — so an un-normalised
  // api row is a visible tell. TML is the authoritative full-name source, so we
  // harvest full names from it (below, in the TML loop) and map api opponents
  // through here; a player never seen in TML falls back to their api name.
  //
  // A surname|initial key can collapse two DISTINCT TML entities — e.g. active
  // Casper Ruud and his retired father Christian Ruud both key to `ruud|c`
  // (TEN-121). Harvesting first-write-wins over the ascending 2000->2026 scan
  // printed the earliest entity (the father, 2000) as the label for the son's
  // 2026 opponents. Instead prefer the MOST-RECENTLY-ACTIVE entity, tracked by
  // TML player_id: the current-tour (rostered) player is by construction the
  // latest to appear, so their full name wins. Each entry stores {id,name,year};
  // a later year overwrites, and a later row of the SAME id refreshes that id's
  // spelling without letting an older-entity row reclaim the key.
  const fullNameByCK = new Map();
  const ckMultiEntity = new Set();            // keys where >1 distinct player_id collided
  const harvestName = (k, id, name, year) => {
    if (!k || !name) return;
    const sid = String(id || '');
    const cur = fullNameByCK.get(k);
    if (!cur) { fullNameByCK.set(k, { id: sid, name, year }); return; }
    if (sid && cur.id && sid !== cur.id) ckMultiEntity.add(k);
    if (year > cur.year || (year === cur.year && sid === cur.id)) {
      fullNameByCK.set(k, { id: sid, name, year });
    }
  };
  const canonicalName = (name) => {
    const k = clientKey(name);
    const e = k && fullNameByCK.get(k);
    return (e && e.name) || name;
  };
  // Dedup index for the api supplement: pairKey (sorted client-key pair) -> [dates].
  // TML tourney_date and api event_date drift by <=1 day, so the api ingest drops a
  // fixture whose pair matches a TML meeting within SUPP_DEDUP_TOL_DAYS.
  const pairKey = (a, b) => { const ca = clientKey(a), cb = clientKey(b); return (ca && cb) ? [ca, cb].sort().join('~') : null; };
  const tmlPairDates = new Map();
  // bump() owns BOTH the w/l aggregate and the per-meeting row so they can never
  // drift: every counted endpoint increments the count AND pushes exactly one row
  // under the same key, so meetings[k].vs[opp].length === byPlayer[k].vs[opp].(w+l).
  const bump = (name, oppLabel, won, meeting) => {
    const k = clientKey(name);
    if (!k) return;
    const slot = byClientKey.get(k);
    if (!slot || slot === CK_AMB) return;    // subject not a unique labelled player
    const e = byPlayer[k] || (byPlayer[k] = { name: slot.name, vs: {} });
    const v = e.vs[oppLabel] || (e.vs[oppLabel] = { w: 0, l: 0 });
    if (won) { v.w++; } else { v.l++; }
    bpCounted++;
    const me = meetings[k] || (meetings[k] = { name: slot.name, vs: {} });
    const list = me.vs[oppLabel] || (me.vs[oppLabel] = []);
    // Row shape mirrors the api-tennis form-shard row the client already renders
    // (won/opponent/surface/tournament/result/date), MINUS eventKey — TML carries
    // no api-tennis key, so these rows are static (never open a box-score panel).
    // Closing odds are stored winner/loser on the meta; render them from the
    // SUBJECT's side (self = this player's price, opp = the opponent's price).
    const oddsSelf = won ? meeting.wodds : meeting.lodds;
    const oddsOpp  = won ? meeting.lodds : meeting.wodds;
    list.push({
      won: !!won,
      opponent: meeting.opponent,
      surface: meeting.surface,
      tournament: meeting.tournament,
      result: won ? meeting.score : flipScore(meeting.score),
      date: meeting.date,
      round: meeting.round || null,
      oddsSelf: oddsSelf == null ? null : oddsSelf,
      oddsOpp: oddsOpp == null ? null : oddsOpp,
    });
    odds.rows++;
    if (oddsSelf != null || oddsOpp != null) odds.priced++;
    if (String(meeting.date || '').slice(0, 4) >= '2026') { odds.rows26++; if (oddsSelf != null || oddsOpp != null) odds.priced26++; }
  };

  // ---- tally matches where BOTH endpoints resolve to a labelled primary ----
  const wins = {}, winsSurf = {};
  const SURFACES = ['hard', 'clay', 'grass'];
  for (const A of PRIMARIES) { wins[A] = {}; for (const B of PRIMARIES) wins[A][B] = 0; }
  for (const s of SURFACES) { winsSurf[s] = {}; for (const A of PRIMARIES) { winsSurf[s][A] = {}; for (const B of PRIMARIES) winsSurf[s][A][B] = 0; } }

  let tmlTotal = 0, counted = 0;
  const surfaceCounted = { hard: 0, clay: 0, grass: 0 };
  for (let y = FROM_YEAR; y <= TO_YEAR; y++) {
    const f = path.join(TML_CACHE, `${y}.csv`);
    if (!fs.existsSync(f)) { console.log(`  TML ${y}: missing`); continue; }
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.length);
    if (!lines.length) continue;
    const H = lines[0].split(','); const ix = {}; H.forEach((h, i) => { ix[h] = i; });
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const wn = c[ix.winner_name], ln = c[ix.loser_name];
      if (!wn || !ln) continue;
      // Harvest TML full names (the api supplement renders opponents through these).
      // Prefer the most-recently-active entity per surname|initial key (see note
      // at fullNameByCK): pass the TML player_id and the row's year.
      const _kw = clientKey(wn); harvestName(_kw, c[ix.winner_id], wn, y);
      const _kl = clientKey(ln); harvestName(_kl, c[ix.loser_id], ln, y);
      tmlTotal++;
      const wl = lookup(wn), ll = lookup(ln);
      if (!wl || !ll) continue;                 // at least one endpoint outside the deployed pool
      wins[wl][ll]++; counted++;
      // Same pool, split per player: the winner beat an `ll`-archetype opponent;
      // the loser lost to a `wl`-archetype opponent. All surfaces pooled.
      const surf = surfaceOf(c[ix.surface]);
      const meta = {
        surface: surf === 'other' ? null : surf,
        tournament: c[ix.tourney_name] || null,
        score: c[ix.score] || '',
        date: isoDate(c[ix.tourney_date]),
        round: c[ix.round] || null,
      };
      const _od = oddsLookup(oddsIdx, _kw, _kl, meta.date, y);   // winner/loser closing odds
      meta.wodds = _od.w; meta.lodds = _od.l;
      bump(wn, ll, true,  { ...meta, opponent: ln });
      bump(ln, wl, false, { ...meta, opponent: wn });
      if (winsSurf[surf]) { winsSurf[surf][wl][ll]++; surfaceCounted[surf]++; }
      // Record this meeting's pair+date so the api supplement can dedup against it.
      const pk = pairKey(wn, ln); if (pk && meta.date) { (tmlPairDates.get(pk) || tmlPairDates.set(pk, []).get(pk)).push(meta.date); }
    }
  }

  // ---- api-tennis current-season supplement (TEN-88 option B) ----
  // Folded into the CAREER split (byPlayer + meeting shards) ONLY; the aggregate
  // `wins`/`winsSurf` matrix stays TML-only so published matrix cells are unchanged.
  // Both endpoints must resolve to a labelled primary (same pool rule as TML); a
  // fixture already covered by TML (pair within +/-1 day) is dropped; Walk Over is
  // excluded (not a played match); Retired counts. Fields are normalised on ingest
  // (canonical names, TML-format score, tournament_key -> surface) so a member
  // cannot tell a supplemented row from a TML one.
  // TEN-121: report the collision resolution so a regression is visible in logs.
  {
    const rc = fullNameByCK.get('ruud|c'), ch = fullNameByCK.get('chung|h');
    console.log(`  name-canonical: ${fullNameByCK.size} keys, ${ckMultiEntity.size} multi-entity keys resolved to most-recent; ruud|c -> "${rc ? rc.name : '-'}" (${rc ? rc.year : '-'}), chung|h -> "${ch ? ch.name : '-'}" (${ch ? ch.year : '-'}).`);
  }
  const supp = { loaded: false, walkover: 0, unlabelled: 0, deduped: 0, added: 0, noWinner: 0, surfaced: 0, matrix: 0 };
  if (fs.existsSync(API_SUPP)) {
    supp.loaded = true;
    const cache = JSON.parse(fs.readFileSync(API_SUPP, 'utf8'));
    const surfMap = fs.existsSync(SURFACE_MAP)
      ? new Map(Object.entries(JSON.parse(fs.readFileSync(SURFACE_MAP, 'utf8')).surfaces || {}))
      : new Map();
    for (const r of (cache.fixtures || [])) {
      if (r.status === 'Walk Over') { supp.walkover++; continue; }
      if (!r.winner || !r.date) { supp.noWinner++; continue; }
      const wl = lookup(r.p1), ll = lookup(r.p2);       // p1/p2 archetypes (winner not yet applied)
      if (!wl || !ll) { supp.unlabelled++; continue; }  // at least one endpoint outside the deployed pool
      const pk = pairKey(r.p1, r.p2);
      const tmlDates = pk ? tmlPairDates.get(pk) : null;
      if (tmlDates && tmlDates.some(d => daysApart(d, r.date) <= SUPP_DEDUP_TOL_DAYS)) { supp.deduped++; continue; }
      const p1won = r.winner === '1';
      const winLabel = p1won ? wl : ll, loseLabel = p1won ? ll : wl;
      const winName = canonicalName(p1won ? r.p1 : r.p2), loseName = canonicalName(p1won ? r.p2 : r.p1);
      const surf = surfMap.get(String(r.tournament_key)) || null;   // 'clay'|'hard'|'grass'|null
      if (surf) supp.surfaced++;
      const _oy = Number(String(r.date).slice(0, 4)) || TO_YEAR;
      const _od = oddsLookup(oddsIdx, clientKey(winName), clientKey(loseName), r.date, _oy);
      const meta = {
        surface: surf,
        tournament: r.tournament || null,
        score: apiScoreWinnerPerspective(r.sets, r.winner, r.status),   // winner-perspective, TML format
        date: r.date,
        round: apiRound(r.round),
        wodds: _od.w, lodds: _od.l,
      };
      // Winner beat a `loseLabel` opponent; loser lost to a `winLabel` opponent.
      bump(winName,  loseLabel, true,  { ...meta, opponent: loseName });
      bump(loseName, winLabel,  false, { ...meta, opponent: winName });
      // Fold the supplement into the AGGREGATE matrix too (founder ruling
      // 2026-08-27: a matrix that stops mid-January describes a field that has
      // moved on). Same pool rule as TML — both endpoints already resolved to a
      // labelled primary above. Surface tally only when the fixture is surfaced.
      wins[winLabel][loseLabel]++; supp.matrix++;
      if (surf && winsSurf[surf]) { winsSurf[surf][winLabel][loseLabel]++; surfaceCounted[surf]++; }
      supp.added++;
    }
    console.log(`  api supplement: +${supp.added} matches (deduped ${supp.deduped}, walkover ${supp.walkover}, unlabelled ${supp.unlabelled}, surfaced ${supp.surfaced}/${supp.added}).`);
  } else {
    console.log('  api supplement: cache absent — TML-only build.');
  }

  // ---- assemble grid (full NxN incl. diagonal) ----
  const cell = (W, A, B) => {
    if (A === B) return { pct: 50, n: W[A][B], note: 'same archetype — coin flip on style' };
    const aw = W[A][B], bw = W[B][A], nAB = aw + bw;
    return { pct: nAB >= MATRIX_MIN_N ? +(aw / nAB * 100).toFixed(0) : null, n: nAB };
  };
  const build = W => {
    const m = {};
    for (const A of PRIMARIES) { m[A] = {}; for (const B of PRIMARIES) m[A][B] = cell(W, A, B); }
    return m;
  };
  const matrix = build(wins);
  const matrixBySurface = {}; for (const s of SURFACES) matrixBySurface[s] = build(winsSurf[s]);

  const retention = tmlTotal ? +(counted / tmlTotal * 100).toFixed(1) : 0;
  const bigServerN = PRIMARIES.filter(l => l.startsWith('Big Server'))
    .reduce((acc, A) => acc + PRIMARIES.reduce((s, B) => s + (A === B ? wins[A][B] : wins[A][B] + wins[B][A]) / (A === B ? 1 : 2), 0), 0);

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'Computed from board-finalized v5.1 archetype labels (playing-styles.json) x TML match results',
    window: `${FROM_YEAR}-${TO_YEAR}`,
    note: 'Win% of row archetype vs column, over matches where BOTH players are in the deployed labelled roster. Full grid incl. the diagonal: same-archetype cells are 50% by construction (coin flip on style) and carry the real match count n. Off-diagonal cells below the sample floor show n but no pct. TEN-88 (2026-08-27 ruling): the current-season api-tennis supplement is now folded into the aggregate matrix as well as the per-player split, so published cells track the live season instead of stopping mid-January.',
    varietyNote: 'Keyed on the 8 base archetype labels only. The `variety` modifier is ignored — "X + Variety Player" counts as X.',
    bigServerFloorNote: 'The bare "Big Server" primary is the thinnest bucket (' + (playerCount['Big Server'] || 0) + ' players). If a future review moves any of them, its off-diagonal cells can fall below the sample floor — watch this row. All Court Elite (' + (playerCount['All Court Elite'] || 0) + ' players) x Big Server is already below the floor and correctly shows n with no pct.',
    minSampleN: MATRIX_MIN_N,
    rosterBasis: 'deployed',
    playersLabelled: labelled.length,
    playerCountByPrimary: playerCount,
    matchesCounted: counted + supp.matrix,
    tmlMatchesCounted: counted,
    supplementMatchesInMatrix: supp.matrix,
    matchesInWindow: tmlTotal,
    retentionPct: retention,
    archetypes: Object.fromEntries(PRIMARIES.map(k => [k, { en: k }])),
    matrix,
    surfaceNote: 'matrixBySurface splits the same construction by court surface (hard/clay/grass). Same floor per surface; carpet/unknown dropped.',
    surfaceMatchesCounted: surfaceCounted,
    matrixBySurface,
    byPlayerNote: 'TEN-88 #2: per-player CAREER record vs each opponent archetype, all surfaces pooled, over both endpoints in the deployed labelled roster. Pool = TML tour history (2000-2026) SUPPLEMENTED with the current-season finished ATP fixtures from api-tennis (TEN-88 option B) — the TML mirror stops mid-January, so without the supplement the live season is ~99% absent. The two sources are deduped on roster-identity pair within 1 day, and api rows are field-normalised (canonical names, TML-format score, tournament_key->surface) so a row is source-agnostic. As of the 2026-08-27 ruling the same supplement is also folded into the aggregate matrix/matrixBySurface cells above (both were TML-only before). Each meeting row also carries closing odds for both players (oddsSelf/oddsOpp): Bet365 for 2026, Pinnacle (Bet365 fallback) before, unlabelled per ruling, dash where no price. Keyed by surname|initial (the dashboard\'s player key); value is { name, vs: { <archetype_label>: {w,l} } }. Ambiguous keys (two labelled players collapsing to one key) are omitted. n is often small — the client applies a sample ladder (n>=10 shows %, 5-9 small-sample, <5 W-L only, 0 dash), and only counts matches vs a CLASSIFIED opponent.',
    byPlayerSupplement: { source: 'api-tennis 2026 finished fixtures', loaded: supp.loaded, matchesAdded: supp.added, foldedIntoMatrix: supp.matrix, dedupedAgainstTml: supp.deduped, walkoverExcluded: supp.walkover, dedupTolDays: SUPP_DEDUP_TOL_DAYS },
    oddsCoverage: {
      note: 'Closing odds per meeting row, both players. Book unlabelled (founder ruling): Bet365 for 2026, Pinnacle (Bet365 fallback) for earlier years; dash where no price. Coverage = share of meeting rows with a price on at least one side.',
      sourceFiles: oddsFiles, sourceRows: oddsSrcRows,
      rows: odds.rows, priced: odds.priced,
      pricedPct: odds.rows ? +(odds.priced / odds.rows * 100).toFixed(1) : 0,
      rows2026: odds.rows26, priced2026: odds.priced26,
      priced2026Pct: odds.rows26 ? +(odds.priced26 / odds.rows26 * 100).toFixed(1) : 0,
    },
    byPlayerPlayers: Object.keys(byPlayer).length,
    byPlayerEndpointsCounted: bpCounted,
    byPlayer,
  };

  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, OUT);

  // ---- per-player meeting shards (TEN-88 option B) ----
  // Filename is the client key with '|' -> '-' (the pipe is awkward in a URL/path);
  // the client applies the identical transform to styleKey(name). Rows sorted
  // newest-first to match the form list's convention.
  const slugOf = k => k.replace(/\|/g, '-');
  fs.rmSync(OUT_MEET_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_MEET_DIR, { recursive: true });
  const index = [];
  let meetRows = 0;
  for (const k of Object.keys(meetings).sort()) {
    const rec = meetings[k];
    for (const opp of Object.keys(rec.vs)) {
      rec.vs[opp].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      meetRows += rec.vs[opp].length;
    }
    const slug = slugOf(k);
    fs.writeFileSync(path.join(OUT_MEET_DIR, `${slug}.json`),
      JSON.stringify({ key: k, name: rec.name, vs: rec.vs }) + '\n');
    index.push(slug);
  }
  index.sort();
  fs.writeFileSync(OUT_MEET_INDEX, JSON.stringify(index) + '\n');

  // Reconciliation invariant: every (player, oppLabel) meeting list length MUST
  // equal that cell's byPlayer w+l. If this ever fails the detail list would
  // disagree with the "Personally" record above it — the exact thing TEN-88 fixes.
  let mism = 0;
  for (const k of Object.keys(byPlayer)) {
    const agg = byPlayer[k].vs, det = (meetings[k] && meetings[k].vs) || {};
    for (const opp of Object.keys(agg)) {
      const want = agg[opp].w + agg[opp].l, got = (det[opp] || []).length;
      if (want !== got) { console.error(`RECONCILE MISMATCH ${k} vs ${opp}: byPlayer=${want} rows=${got}`); mism++; }
    }
  }
  if (mism) throw new Error(`${mism} meeting-shard reconciliation mismatches — refusing to write a detail list that disagrees with the career record`);

  // ---- console sanity ----
  console.log(`Wrote matchup-matrix.json — ${PRIMARIES.length} primaries, ${counted}/${tmlTotal} matches (${retention}% retention).`);
  console.log(`Per-player split: ${Object.keys(byPlayer).length} players, ${bpCounted} player-endpoints (TML ${counted} + api-supp ${supp.added} = ${counted + supp.added} matches x2 = ${(counted + supp.added) * 2} endpoints before ambiguous/unkeyed drops).`);
  console.log(`Meeting shards: ${index.length} players, ${meetRows} rows, reconciled clean vs byPlayer.`);
  console.log('Players per primary:');
  for (const l of PRIMARIES) console.log(`  ${String(playerCount[l]).padStart(3)}  ${l}`);
  console.log('Below-floor off-diagonal cells (n < ' + MATRIX_MIN_N + '):');
  let thin = 0;
  for (const A of PRIMARIES) for (const B of PRIMARIES) {
    if (A === B) continue;
    if (A < B) { const nAB = wins[A][B] + wins[B][A]; if (nAB < MATRIX_MIN_N) { console.log(`  n=${nAB}  ${A}  x  ${B}`); thin++; } }
  }
  if (!thin) console.log('  (none)');
}

main();
